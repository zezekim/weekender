from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import recommend, settings_store
from .core import SourceError, cache, close_client, utcnow_iso
from .providers import geocoding, osm, photos, places, weather
from .recommend import haversine_km
from .weekend import local_now, target_weekend

mimetypes.add_type("application/manifest+json", ".webmanifest")

log = logging.getLogger("planner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))


# Popular cities are fetched in the background so demos and first visits are instant.
# Paris, Tokyo, Sydney, Springfield (MO), Portland (OR). Set PREWARM_CITIES="" to disable.
DEFAULT_PREWARM = "2988507,1850147,2147714,4409896,5746545"


async def prewarm_loop() -> None:
    ids = [int(x) for x in os.environ.get("PREWARM_CITIES", DEFAULT_PREWARM).split(",") if x.strip().isdigit()]
    if not ids:
        return
    await asyncio.sleep(15)
    while True:
        for city_id in ids:
            for fn in (city_weather, city_activities, city_restaurant):
                try:
                    await fn(city_id)
                except Exception as exc:  # noqa: BLE001 — warming is best effort
                    log.info("prewarm %s/%s skipped: %s", city_id, fn.__name__, exc)
        log.info("prewarmed %d cities", len(ids))
        await asyncio.sleep(3 * 3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(prewarm_loop())
    yield
    task.cancel()
    await close_client()


app = FastAPI(title="Family Weekend Planner", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.exception_handler(SourceError)
async def source_error_handler(_: Request, exc: SourceError):
    log.warning("source failure: %s — %s", exc.source, exc.message)
    return JSONResponse(status_code=503, content={"error": "source_unavailable", "source": exc.source, "message": exc.message})


# --------------------------------------------------------------------------- public API


@app.get("/api/health")
async def health():
    return {"ok": True, "time": utcnow_iso()}


@app.get("/api/cities")
async def search_cities(q: str = Query(min_length=2, max_length=80)):
    return {"results": await geocoding.search(q.strip()), "source": {"name": geocoding.SOURCE, "url": "https://open-meteo.com/en/docs/geocoding-api"}}


@app.get("/api/cities/nearest")
async def nearest_city(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    """Closest known city to the visitor. Coordinates are rounded to ~1 km and not stored."""
    place = await osm.reverse_locality(lat, lon)
    if not place:
        raise HTTPException(404, "We couldn’t find a city near you.")
    name, country = place
    results = await geocoding.search(name, 10)
    ranked = sorted(
        (r for r in results if not country or r["country_code"] == country),
        key=lambda r: haversine_km(lat, lon, r["latitude"], r["longitude"]),
    )
    if not ranked or haversine_km(lat, lon, ranked[0]["latitude"], ranked[0]["longitude"]) > 60:
        raise HTTPException(404, "We couldn’t find a city near you.")
    return {"city": ranked[0]}


async def _city_context(city_id: int) -> dict[str, Any]:
    city = await geocoding.get_city(city_id)
    now = local_now(city["timezone"])
    saturday, sunday = target_weekend(now.date())
    return {"city": city, "now": now, "saturday": saturday, "sunday": sunday}


@app.get("/api/cities/{city_id}")
async def city_overview(city_id: int):
    ctx = await _city_context(city_id)
    return {
        "city": ctx["city"],
        "local_time": ctx["now"].isoformat(timespec="minutes"),
        "weekend": {"saturday": ctx["saturday"].isoformat(), "sunday": ctx["sunday"].isoformat()},
    }


async def _forecast(ctx: dict[str, Any]) -> dict[str, Any]:
    c = ctx["city"]
    return await weather.weekend_forecast(c["latitude"], c["longitude"], c["timezone"], ctx["saturday"], ctx["sunday"])


@app.get("/api/cities/{city_id}/weather")
async def city_weather(city_id: int):
    return await _forecast(await _city_context(city_id))


@app.get("/api/cities/{city_id}/activities")
async def city_activities(city_id: int):
    ctx = await _city_context(city_id)
    try:
        days = (await _forecast(ctx))["days"]
    except SourceError:
        days = None  # still recommend, but say the weather was not considered
    wctx = recommend.weather_context(days)
    c = ctx["city"]
    found = await places.find(c["latitude"], c["longitude"], "activity", lambda cands: len(cands) >= 2)
    items, alternates = recommend.rank_activities(found["candidates"], wctx)
    await photos.attach(items + alternates)
    return {
        "status": "ok" if items else "none_found",
        "items": items,
        "alternates": alternates,
        "weather_summary": wctx["summary"],
        "weather_considered": wctx["known"],
        "retrieved_at": found["retrieved_at"],
        "cached": found["cached"],
        "stale": found["stale"],
        "attempts": found["attempts"],
    }


@app.get("/api/cities/{city_id}/restaurant")
async def city_restaurant(city_id: int):
    c = (await _city_context(city_id))["city"]
    found = await places.find(
        c["latitude"], c["longitude"], "restaurant", lambda cands: recommend.pick_restaurant(cands) is not None
    )
    ranked = recommend.rank_restaurants(found["candidates"])
    await photos.attach(ranked)
    return {
        "status": "ok" if ranked else "none_found",
        "item": ranked[0] if ranked else None,
        "alternates": ranked[1:],
        "retrieved_at": found["retrieved_at"],
        "cached": found["cached"],
        "stale": found["stale"],
        "attempts": found["attempts"],
    }


# --------------------------------------------------------------------------- admin API (behind Authelia)


def require_admin(request: Request) -> str:
    """Caddy only forwards here after Authelia approves, and it strips any
    client-supplied Remote-User header, so its presence proves authentication.
    """
    user = request.headers.get("Remote-User")
    if user:
        return user
    if os.environ.get("ADMIN_AUTH_DISABLED") == "1":  # local `uvicorn` development only
        return "dev"
    raise HTTPException(status_code=401, detail="Authentication required")


@app.get("/api/admin/settings")
async def get_settings(user: str = Depends(require_admin)):
    return {"user": user, "settings": settings_store.public_view()}


@app.put("/api/admin/settings")
async def put_settings(patch: dict[str, Any], user: str = Depends(require_admin)):
    before = settings_store.public_view()
    updated = settings_store.update(patch)
    data_affecting = ("secrets", "places_provider", "overpass_urls")
    if any(before[k] != updated[k] for k in data_affecting):
        cache.clear()  # keys or providers changed — don't serve results from the old config
    log.info("settings updated by %s", user)
    return {"user": user, "settings": updated}


@app.post("/api/admin/test/{target}")
async def test_source(target: str, _: str = Depends(require_admin)):
    from .providers import keyed, osm

    lat, lon = 51.5072, -0.1276  # London: dense data everywhere
    checks = {
        "geocoding": lambda: geocoding.search("London", 1),
        "weather": lambda: weather.weekend_forecast(lat, lon, "Europe/London", *target_weekend(local_now("Europe/London").date())),
        "geoapify": lambda: keyed.geoapify(lat, lon, "restaurant"),
        "google": lambda: keyed.google(lat, lon, "restaurant"),
        "overpass": lambda: osm.overpass(lat, lon, "restaurant"),
        "nominatim": lambda: osm.nominatim(lat, lon, "restaurant"),
    }
    if target not in checks:
        raise HTTPException(404, "Unknown source")
    try:
        result = await checks[target]()
    except SourceError as exc:
        return {"ok": False, "message": exc.message}
    count = len(result) if isinstance(result, list) else len(result.get("days", []))
    return {"ok": True, "message": f"Responded with {count} result(s)."}


@app.post("/api/admin/cache/clear")
async def clear_cache(_: str = Depends(require_admin)):
    cache.clear()
    return {"ok": True}


# --------------------------------------------------------------------------- SPA


if (STATIC_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    candidate = (STATIC_DIR / path).resolve()
    if path and candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = STATIC_DIR / "index.html"
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Frontend not built"}, status_code=404)
