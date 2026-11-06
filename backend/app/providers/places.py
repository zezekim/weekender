"""Provider chain for places: try each configured source until one yields results.

Every attempt is reported back so the UI can say e.g. "Overpass timed out,
results came from Nominatim instead".
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from .. import settings_store
from ..core import SourceError, cache, check_simulated_failure, utcnow_iso
from . import keyed, osm

Provider = Callable[[float, float, str], Awaitable[list[dict[str, Any]]]]

PROVIDERS: dict[str, tuple[str, Provider]] = {
    "google": ("Google Places", keyed.google),
    "geoapify": ("Geoapify", keyed.geoapify),
    "overpass": ("OpenStreetMap Overpass", osm.overpass),
    "nominatim": ("OpenStreetMap Nominatim", osm.nominatim),
}


# Circuit breaker: after a provider fails, skip it for a while instead of making
# every visitor wait for the same timeout.
COOLDOWN_S = 180
_failed_at: dict[str, float] = {}


def provider_order() -> list[str]:
    choice = settings_store.get("places_provider")
    has_google = bool(settings_store.get("google_places_api_key"))
    has_geoapify = bool(settings_store.get("geoapify_api_key"))
    free = ["overpass", "nominatim"]
    if choice == "google" and has_google:
        return ["google", *(["geoapify"] if has_geoapify else []), *free]
    if choice == "geoapify" and has_geoapify:
        return ["geoapify", *free]
    if choice == "osm":
        return free
    # auto: prefer keyed sources when configured, always keep the free fallbacks
    return [*(["google"] if has_google else []), *(["geoapify"] if has_geoapify else []), *free]


async def find(lat: float, lon: float, kind: str, accept: Callable[[list[dict[str, Any]]], bool]) -> dict[str, Any]:
    """Return {"candidates", "source", "attempts"}; raises SourceError if every provider failed."""
    check_simulated_failure("places", "Places data")
    attempts: list[dict[str, Any]] = []
    order = provider_order()
    for key in order:
        label, fn = PROVIDERS[key]
        since = time.monotonic() - _failed_at.get(key, -1e9)
        if since < COOLDOWN_S and key != order[-1]:  # always give the last resort a real try
            attempts.append({"provider": label, "ok": False, "detail": f"Skipped — it failed {int(since)}s ago; retrying after a short cooldown."})
            continue

        async def fetch(fn=fn):
            return {"candidates": await fn(lat, lon, kind), "retrieved_at": utcnow_iso()}

        try:
            result, cached = await cache.get_or_set(f"places:{key}:{kind}:{lat:.3f}:{lon:.3f}", 6 * 3600, fetch)
        except SourceError as exc:
            if key not in ("google", "geoapify"):  # keyed errors are usually config, not outages
                _failed_at[key] = time.monotonic()
            attempts.append({"provider": label, "ok": False, "detail": exc.message})
            continue
        if not accept(result["candidates"]):
            attempts.append({"provider": label, "ok": True, "detail": "Responded, but had no suitable matches nearby."})
            continue
        _failed_at.pop(key, None)
        attempts.append({"provider": label, "ok": True, "detail": "Used for these results."})
        return {
            "candidates": result["candidates"],
            "retrieved_at": result["retrieved_at"],
            "cached": cached,
            "attempts": attempts,
        }
    if all(not a["ok"] for a in attempts):
        raise SourceError("Places data", "Every places source failed: " + " ".join(a["detail"] for a in attempts))
    return {"candidates": [], "retrieved_at": utcnow_iso(), "cached": False, "attempts": attempts}
