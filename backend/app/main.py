from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import recommend, settings_store
from .core import SourceError, cache, close_client, utcnow_iso
from .providers import geocoding, places, weather
from .weekend import local_now, target_weekend

log = logging.getLogger("planner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
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
    items = recommend.pick_activities(found["candidates"], wctx)
    return {
        "status": "ok" if items else "none_found",
        "items": items,
        "weather_summary": wctx["summary"],
        "weather_considered": wctx["known"],
        "retrieved_at": found["retrieved_at"],
        "cached": found["cached"],
        "attempts": found["attempts"],
    }


@app.get("/api/cities/{city_id}/restaurant")
async def city_restaurant(city_id: int):
    c = (await _city_context(city_id))["city"]
    found = await places.find(
        c["latitude"], c["longitude"], "restaurant", lambda cands: recommend.pick_restaurant(cands) is not None
    )
    item = recommend.pick_restaurant(found["candidates"])
    return {
        "status": "ok" if item else "none_found",
        "item": item,
        "retrieved_at": found["retrieved_at"],
        "cached": found["cached"],
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
    updated = settings_store.update(patch)
    cache.clear()  # provider choice/keys changed — don't serve results from the old config
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
