"""OpenStreetMap place search: Overpass (rich, tag-based) and Nominatim (fallback).

Both are free community services with strict fair-use policies, so results are
cached and Nominatim calls are throttled to one per second.
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any

import httpx

from .. import settings_store
from ..core import SourceError, client, user_agent
from ..recommend import classify_activity, cuisine_kind, haversine_km, osm_address

ACTIVITY_RADIUS_KM = 15
RESTAURANT_RADIUS_KM = 6


def bbox(lat: float, lon: float, km: float) -> tuple[float, float, float, float]:
    dlat = km / 111.0
    dlon = km / (111.0 * max(0.2, abs(math.cos(math.radians(lat)))))
    return lat - dlat, lon - dlon, lat + dlat, lon + dlon


def osm_url(osm_type: str, osm_id: int | str) -> str:
    kind = {"N": "node", "W": "way", "R": "relation"}.get(str(osm_type).upper()[:1], osm_type)
    return f"https://www.openstreetmap.org/{kind}/{osm_id}"


def candidate_from_tags(
    tags: dict[str, str],
    lat: float,
    lon: float,
    origin: tuple[float, float],
    osm_type: str,
    osm_id: int | str,
    source_name: str,
    kind: str,
    address: str | None = None,
) -> dict[str, Any] | None:
    name = tags.get("name:en") or tags.get("name")
    if not name:
        return None
    base = {
        "id": f"osm:{osm_type}:{osm_id}",
        "name": name,
        "latitude": lat,
        "longitude": lon,
        "distance_km": round(haversine_km(origin[0], origin[1], lat, lon), 2),
        "address": address or osm_address(tags),
        "website": tags.get("website") or tags.get("contact:website") or tags.get("url"),
        "opening_hours": tags.get("opening_hours"),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "tags": tags,
        "notable": bool(tags.get("wikidata") or tags.get("wikipedia")),
        "source": {"name": source_name, "url": osm_url(osm_type, osm_id), "license": "© OpenStreetMap contributors (ODbL)"},
    }
    if kind == "activity":
        category = classify_activity(tags, name)
        if not category:
            return None
        return {**base, "category": category}
    ck = cuisine_kind(tags.get("cuisine"), name)
    return {**base, "cuisine": tags.get("cuisine"), "cuisine_kind": ck}


# --------------------------------------------------------------------------- Overpass

KID_MUSEUM_RE = "child|kid|kinder|enfant|niñ|bambin|crian|discover|explor|toy|scien|wissen|technik|natur|dino"


def _activity_query(b: tuple[float, float, float, float]) -> str:
    s, w, n, e = (round(x, 5) for x in b)
    return f"""[out:json][timeout:9][bbox:{s},{w},{n},{e}];
(
  nwr["tourism"~"^(zoo|aquarium|theme_park)$"]["name"];
  nwr["amenity"~"^(planetarium|aquarium)$"]["name"];
  nwr["tourism"="museum"]["museum"~"children|science|technology|natural_history|nature"]["name"];
  nwr["tourism"="museum"]["name"~"{KID_MUSEUM_RE}",i];
  nwr["leisure"~"^(water_park|indoor_play|trampoline_park|miniature_golf)$"]["name"];
);
out center tags 150;
nwr["leisure"="playground"]["name"];
out center tags 30;
nwr["leisure"="park"]["name"]["wikidata"];
out center tags 30;"""


def _restaurant_query(b: tuple[float, float, float, float]) -> str:
    s, w, n, e = (round(x, 5) for x in b)
    return f"""[out:json][timeout:9][bbox:{s},{w},{n},{e}];
nwr["amenity"="restaurant"]["cuisine"~"italian|pizza",i]["name"];
out center tags 150;"""


OVERPASS_BUDGET_S = 10.0


async def _overpass_one(url: str, query: str) -> dict[str, Any]:
    resp = await client().post(
        url, data={"data": query}, headers={"User-Agent": user_agent()}, timeout=httpx.Timeout(OVERPASS_BUDGET_S, connect=4.0)
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("remark") and not data.get("elements"):
        raise ValueError(data["remark"][:120])
    return data


async def overpass(lat: float, lon: float, kind: str) -> list[dict[str, Any]]:
    """Race the configured mirrors; first good answer wins, the rest are cancelled."""
    radius = ACTIVITY_RADIUS_KM if kind == "activity" else RESTAURANT_RADIUS_KM
    query = (_activity_query if kind == "activity" else _restaurant_query)(bbox(lat, lon, radius))
    urls = settings_store.get("overpass_urls")[:3]
    tasks = {asyncio.create_task(_overpass_one(u, query)): u for u in urls}
    errors, data = [], None
    try:
        for fut in asyncio.as_completed(tasks, timeout=OVERPASS_BUDGET_S + 1):
            try:
                data = await fut
                break
            except (httpx.HTTPError, ValueError) as exc:
                errors.append(type(exc).__name__)
    except asyncio.TimeoutError:
        errors.append("TimeoutError")
    finally:
        for t in tasks:
            t.cancel()
    if data is None:
        raise SourceError(
            "OpenStreetMap Overpass", f"All {len(urls)} Overpass servers failed or timed out ({', '.join(sorted(set(errors)))})."
        )
    out = []
    for el in data.get("elements", []):
        plat = el.get("lat") or el.get("center", {}).get("lat")
        plon = el.get("lon") or el.get("center", {}).get("lon")
        if plat is None or plon is None:
            continue
        c = candidate_from_tags(el.get("tags", {}), plat, plon, (lat, lon), el["type"], el["id"], "OpenStreetMap (Overpass)", kind)
        if c:
            out.append(c)
    return out


# --------------------------------------------------------------------------- Nominatim

_nominatim_lock = asyncio.Lock()
_nominatim_last = 0.0

ACTIVITY_PHRASES = ["aquarium", "zoo", "planetarium", "museum", "theme park", "playground"]
RESTAURANT_QUERIES = ["italian restaurant", "pizzeria", "trattoria"]


async def _nominatim(params: dict[str, Any]) -> list[dict[str, Any]]:
    global _nominatim_last
    async with _nominatim_lock:  # usage policy: max 1 request per second
        wait = 1.05 - (time.monotonic() - _nominatim_last)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            resp = await client().get(
                "https://nominatim.openstreetmap.org/search",
                params={"format": "jsonv2", "extratags": 1, "addressdetails": 1, "namedetails": 1, "bounded": 1, "limit": 20, "accept-language": "en", **params},
                headers={"User-Agent": user_agent()},
            )
        finally:
            _nominatim_last = time.monotonic()
    resp.raise_for_status()
    return resp.json()


def _nominatim_address(a: dict[str, str]) -> str | None:
    street = " ".join(filter(None, [a.get("house_number"), a.get("road")]))
    city = a.get("city") or a.get("town") or a.get("village") or a.get("suburb")
    return ", ".join(filter(None, [street, " ".join(filter(None, [a.get("postcode"), city]))])) or None


async def nominatim(lat: float, lon: float, kind: str) -> list[dict[str, Any]]:
    radius = ACTIVITY_RADIUS_KM if kind == "activity" else RESTAURANT_RADIUS_KM
    s, w, n, e = bbox(lat, lon, radius)
    viewbox = f"{w},{n},{e},{s}"
    queries = (
        [{"amenity": p, "viewbox": viewbox} for p in ACTIVITY_PHRASES]
        if kind == "activity"
        else [{"q": q, "viewbox": viewbox} for q in RESTAURANT_QUERIES]
    )
    out, seen, failures = [], set(), 0
    for params in queries:
        try:
            rows = await _nominatim(params)
        except (httpx.HTTPError, ValueError):
            failures += 1
            continue
        for r in rows:
            key = (r.get("osm_type"), r.get("osm_id"))
            if key in seen:
                continue
            seen.add(key)
            names = r.get("namedetails") or {}
            tags = {**(r.get("extratags") or {}), r.get("category", ""): r.get("type", ""), "name": r.get("name") or ""}
            if names.get("name:en"):
                tags["name:en"] = names["name:en"]
            if kind == "restaurant" and r.get("type") != "restaurant":
                continue
            c = candidate_from_tags(
                tags, float(r["lat"]), float(r["lon"]), (lat, lon), r["osm_type"], r["osm_id"],
                "OpenStreetMap (Nominatim)", kind, _nominatim_address(r.get("address") or {}),
            )
            if c:
                out.append(c)
    if failures == len(queries):
        raise SourceError("OpenStreetMap Nominatim", "Nominatim search did not respond.")
    return out
