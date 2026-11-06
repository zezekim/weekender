"""Optional keyed place providers, configured from the Settings page.

* Geoapify Places — OSM-based, free tier (3,000 requests/day) with a key.
* Google Places (New) — adds ratings and a "good for children" flag; paid
  beyond Google's monthly free usage, so it is opt-in.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from .. import settings_store
from ..core import SourceError, client
from ..recommend import haversine_km
from .osm import ACTIVITY_RADIUS_KM, RESTAURANT_RADIUS_KM, candidate_from_tags

# --------------------------------------------------------------------------- Geoapify

GEOAPIFY_ACTIVITY = ",".join(
    [
        "entertainment.zoo",
        "entertainment.aquarium",
        "entertainment.museum",
        "entertainment.planetarium",
        "entertainment.theme_park",
        "entertainment.water_park",
        "entertainment.miniature_golf",
        "leisure.playground",
    ]
)
GEOAPIFY_RESTAURANT = "catering.restaurant.italian,catering.restaurant.pizza"


async def geoapify(lat: float, lon: float, kind: str) -> list[dict[str, Any]]:
    key = settings_store.get("geoapify_api_key")
    if not key:
        raise SourceError("Geoapify", "No Geoapify API key configured.")
    radius = (ACTIVITY_RADIUS_KM if kind == "activity" else RESTAURANT_RADIUS_KM) * 1000
    try:
        resp = await client().get(
            "https://api.geoapify.com/v2/places",
            params={
                "categories": GEOAPIFY_ACTIVITY if kind == "activity" else GEOAPIFY_RESTAURANT,
                "filter": f"circle:{lon},{lat},{radius}",
                "bias": f"proximity:{lon},{lat}",
                "limit": 100,
                "apiKey": key,
            },
        )
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except httpx.HTTPStatusError as exc:
        raise SourceError("Geoapify", f"Geoapify returned HTTP {exc.response.status_code} (check the API key).") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise SourceError("Geoapify", f"Geoapify did not respond ({type(exc).__name__}).") from exc

    out = []
    for f in features:
        p = f.get("properties", {})
        raw = (p.get("datasource") or {}).get("raw") or {}
        tags = {k: str(v) for k, v in raw.items() if isinstance(v, (str, int, float))}
        tags.setdefault("name", p.get("name") or "")
        if kind == "restaurant" and "cuisine" not in tags:
            cats = p.get("categories", [])
            tags["cuisine"] = "italian" if "catering.restaurant.italian" in cats else "pizza"
        c = candidate_from_tags(
            tags, p["lat"], p["lon"], (lat, lon), raw.get("osm_type", "n"), raw.get("osm_id", p.get("place_id")),
            "Geoapify (OpenStreetMap data)", kind, p.get("address_line2") or p.get("formatted"),
        )
        if c:
            out.append(c)
    return out


# --------------------------------------------------------------------------- Google Places

GOOGLE_FIELDS = ",".join(
    "places." + f
    for f in [
        "id", "displayName", "formattedAddress", "location", "rating", "userRatingCount",
        "googleMapsUri", "websiteUri", "types", "goodForChildren", "businessStatus",
    ]
)
# (text query, our category, Google types that confirm the match)
GOOGLE_ACTIVITY_QUERIES = [
    ("children's museum", "childrens_museum", {"museum"}),
    ("science museum for kids", "science_center", {"museum", "science_museum"}),
    ("aquarium", "aquarium", {"aquarium"}),
    ("zoo", "zoo", {"zoo", "wildlife_park"}),
    ("indoor playground", "indoor_play", {"amusement_center", "playground", "indoor_playground"}),
]


async def _google_search(key: str, lat: float, lon: float, query: str, radius_m: int, included_type: str | None = None):
    body: dict[str, Any] = {
        "textQuery": query,
        "maxResultCount": 10,
        "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": float(radius_m)}},
    }
    if included_type:
        body.update(includedType=included_type, strictTypeFiltering=True)
    resp = await client().post(
        "https://places.googleapis.com/v1/places:searchText",
        json=body,
        headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELDS},
    )
    resp.raise_for_status()
    return resp.json().get("places", [])


def _google_candidate(p: dict[str, Any], origin: tuple[float, float]) -> dict[str, Any] | None:
    loc = p.get("location") or {}
    if p.get("businessStatus") not in (None, "OPERATIONAL") or "latitude" not in loc:
        return None
    return {
        "id": f"google:{p['id']}",
        "name": (p.get("displayName") or {}).get("text"),
        "latitude": loc["latitude"],
        "longitude": loc["longitude"],
        "distance_km": round(haversine_km(origin[0], origin[1], loc["latitude"], loc["longitude"]), 2),
        "address": p.get("formattedAddress"),
        "website": p.get("websiteUri"),
        "opening_hours": None,
        "rating": p.get("rating"),
        "rating_count": p.get("userRatingCount", 0),
        "good_for_children": p.get("goodForChildren"),
        "tags": {},
        "notable": (p.get("userRatingCount") or 0) > 1000,
        "source": {"name": "Google Places", "url": p.get("googleMapsUri"), "license": "Google Maps"},
    }


async def google(lat: float, lon: float, kind: str) -> list[dict[str, Any]]:
    key = settings_store.get("google_places_api_key")
    if not key:
        raise SourceError("Google Places", "No Google Places API key configured.")
    try:
        if kind == "restaurant":
            places = await _google_search(key, lat, lon, "Italian restaurant", RESTAURANT_RADIUS_KM * 1000, "italian_restaurant")
            return [
                {**c, "cuisine": "italian", "cuisine_kind": "italian"}
                for c in (_google_candidate(p, (lat, lon)) for p in places)
                if c and c.get("distance_km", 99) <= RESTAURANT_RADIUS_KM * 1.5
            ]
        results = await asyncio.gather(
            *(_google_search(key, lat, lon, q, ACTIVITY_RADIUS_KM * 1000) for q, _, _ in GOOGLE_ACTIVITY_QUERIES)
        )
    except httpx.HTTPStatusError as exc:
        raise SourceError("Google Places", f"Google Places returned HTTP {exc.response.status_code} (check the API key).") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise SourceError("Google Places", f"Google Places did not respond ({type(exc).__name__}).") from exc

    out, seen = [], set()
    for (_, category, types), places in zip(GOOGLE_ACTIVITY_QUERIES, results):
        for p in places:
            if p.get("id") in seen or not types & set(p.get("types", [])):
                continue
            c = _google_candidate(p, (lat, lon))
            if c and c["distance_km"] <= ACTIVITY_RADIUS_KM * 1.5:
                seen.add(p["id"])
                out.append({**c, "category": category})
    return out
