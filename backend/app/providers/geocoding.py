"""City search via the Open-Meteo geocoding API (GeoNames data, free, no key)."""

from __future__ import annotations

from typing import Any

import httpx

from ..core import SourceError, cache, check_simulated_failure, client

SOURCE = "Open-Meteo Geocoding"
BASE = "https://geocoding-api.open-meteo.com/v1"


def _city(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw["id"],
        "name": raw.get("name"),
        "admin1": raw.get("admin1"),
        "admin2": raw.get("admin2"),
        "country": raw.get("country"),
        "country_code": raw.get("country_code"),
        "latitude": raw["latitude"],
        "longitude": raw["longitude"],
        "timezone": raw.get("timezone"),
        "population": raw.get("population"),
    }


async def _get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    check_simulated_failure("geocoding", SOURCE)
    try:
        resp = await client().get(f"{BASE}/{path}", params=params)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SourceError(SOURCE, f"{SOURCE} did not respond ({type(exc).__name__}).") from exc


async def search(query: str, limit: int = 10) -> list[dict[str, Any]]:
    async def fetch():
        data = await _get("search", {"name": query, "count": limit, "language": "en", "format": "json"})
        # Only populated places with a timezone are useful for weekend planning.
        return [_city(r) for r in data.get("results", []) if r.get("timezone")]

    results, _ = await cache.get_or_set(f"geo:search:{query.lower()}:{limit}", 86400, fetch)
    return results


async def get_city(city_id: int) -> dict[str, Any]:
    async def fetch():
        data = await _get("get", {"id": city_id})
        if not data.get("id") or not data.get("timezone"):
            raise SourceError(SOURCE, "That city could not be found.")
        return _city(data)

    city, _ = await cache.get_or_set(f"geo:get:{city_id}", 86400, fetch)
    return city
