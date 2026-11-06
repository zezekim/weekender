"""Weekend forecast from Open-Meteo (free, no key; optional commercial key)."""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx

from .. import settings_store
from ..core import SourceError, cache, check_simulated_failure, client, utcnow_iso

SOURCE = "Open-Meteo Forecast"

# WMO weather interpretation codes -> (label, icon key)
WMO: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "clear"),
    1: ("Mainly clear", "clear"),
    2: ("Partly cloudy", "partly"),
    3: ("Overcast", "cloudy"),
    45: ("Fog", "fog"),
    48: ("Freezing fog", "fog"),
    51: ("Light drizzle", "drizzle"),
    53: ("Drizzle", "drizzle"),
    55: ("Heavy drizzle", "drizzle"),
    56: ("Freezing drizzle", "drizzle"),
    57: ("Freezing drizzle", "drizzle"),
    61: ("Light rain", "rain"),
    63: ("Rain", "rain"),
    65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "rain"),
    67: ("Heavy freezing rain", "rain"),
    71: ("Light snow", "snow"),
    73: ("Snow", "snow"),
    75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"),
    80: ("Rain showers", "rain"),
    81: ("Rain showers", "rain"),
    82: ("Violent rain showers", "rain"),
    85: ("Snow showers", "snow"),
    86: ("Heavy snow showers", "snow"),
    95: ("Thunderstorm", "storm"),
    96: ("Thunderstorm with hail", "storm"),
    99: ("Thunderstorm with hail", "storm"),
}

DAILY = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "precipitation_probability_max",
    "wind_speed_10m_max",
    "uv_index_max",
    "sunrise",
    "sunset",
]
HOURLY = ["temperature_2m", "precipitation_probability", "weather_code"]


def _endpoint() -> tuple[str, dict[str, str]]:
    key = settings_store.get("open_meteo_api_key")
    if key:
        return "https://customer-api.open-meteo.com/v1/forecast", {"apikey": key}
    return "https://api.open-meteo.com/v1/forecast", {}


WET_ICONS = {"rain", "drizzle", "storm", "snow"}


def best_window(hours: list[dict[str, Any]]) -> dict[str, str] | None:
    """Longest daytime run (08:00–20:00) with a low chance of rain and no wet weather."""
    best: tuple[int, int] | None = None
    start = None
    daytime = [h for h in hours if 8 <= int(h["time"][11:13]) <= 20]
    for i, h in enumerate(daytime + [None]):
        dry = h is not None and (h["precip_probability"] or 0) < 30 and h["icon"] not in WET_ICONS
        if dry and start is None:
            start = i
        elif not dry and start is not None:
            if best is None or i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    if not best or best[1] - best[0] < 2:  # under two dry hours isn't a window worth naming
        return None
    first, last = daytime[best[0]], daytime[best[1] - 1]
    return {"start": first["time"], "end": f"{last['time'][:11]}{int(last['time'][11:13]) + 1:02d}:00"}


def uv_note(uv: float | None) -> str | None:
    if uv is None:
        return None
    if uv >= 8:
        return "Very high UV. Sunscreen, hats and shade at midday."
    if uv >= 6:
        return "High UV. Pack sunscreen and hats."
    if uv >= 3:
        return "Moderate UV. Sunscreen for longer stretches outside."
    return None


def assess(day: dict[str, Any]) -> dict[str, Any]:
    """Classify a day for activity planning. Thresholds are deliberately simple."""
    prob = day.get("precip_probability")
    total = day.get("precip_sum") or 0
    wet = day["icon"] in {"rain", "storm", "snow"} or (prob is not None and prob >= 50) or total >= 2
    tmax = day.get("temp_max")
    cold = tmax is not None and tmax < 5
    hot = tmax is not None and tmax > 32
    return {"wet": wet, "cold": cold, "hot": hot, "outdoor_friendly": not (wet or cold or hot)}


async def weekend_forecast(lat: float, lon: float, tz: str, saturday: date, sunday: date) -> dict[str, Any]:
    check_simulated_failure("weather", SOURCE)
    url, extra = _endpoint()
    params = {
        "latitude": round(lat, 4),
        "longitude": round(lon, 4),
        "timezone": tz,
        "start_date": saturday.isoformat(),
        "end_date": sunday.isoformat(),
        "daily": ",".join(DAILY),
        "hourly": ",".join(HOURLY),
        **extra,
    }

    async def fetch():
        try:
            resp = await client().get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SourceError(SOURCE, f"{SOURCE} did not respond ({type(exc).__name__}).") from exc
        if "daily" not in data:
            raise SourceError(SOURCE, data.get("reason") or "Forecast not available for these dates.")
        return {"data": data, "retrieved_at": utcnow_iso()}

    cache_key = f"wx:{params['latitude']}:{params['longitude']}:{saturday}"
    result, status = await cache.get_or_set(cache_key, 1800, fetch, stale_for=12 * 3600)
    data = result["data"]
    daily, units, hourly = data["daily"], data["daily_units"], data.get("hourly", {})

    days = []
    for i, iso in enumerate(daily["time"]):
        code = daily["weather_code"][i]
        label, icon = WMO.get(code, ("Unknown conditions", "cloudy"))
        all_hours = [
            {
                "time": t,
                "temp": hourly["temperature_2m"][j],
                "precip_probability": hourly["precipitation_probability"][j],
                "icon": WMO.get(hourly["weather_code"][j], ("", "cloudy"))[1],
            }
            for j, t in enumerate(hourly.get("time", []))
            if t.startswith(iso)
        ]
        hours = [h for h in all_hours if 8 <= int(h["time"][11:13]) <= 20 and int(h["time"][11:13]) % 2 == 0]
        day = {
            "date": iso,
            "code": code,
            "condition": label,
            "icon": icon,
            "temp_max": daily["temperature_2m_max"][i],
            "temp_min": daily["temperature_2m_min"][i],
            "precip_sum": daily["precipitation_sum"][i],
            "precip_probability": daily["precipitation_probability_max"][i],
            "wind_max": daily["wind_speed_10m_max"][i],
            "uv_max": daily["uv_index_max"][i],
            "sunrise": daily["sunrise"][i],
            "sunset": daily["sunset"][i],
            "hourly": hours,
            "best_window": best_window(all_hours),
            "uv_note": uv_note(daily["uv_index_max"][i]),
        }
        day["assessment"] = assess(day)
        days.append(day)

    return {
        "days": days,
        "units": {
            "temperature": units.get("temperature_2m_max", "°C"),
            "precipitation": units.get("precipitation_sum", "mm"),
            "wind": units.get("wind_speed_10m_max", "km/h"),
        },
        "source": {
            "name": SOURCE,
            "url": "https://open-meteo.com/",
            "retrieved_at": result["retrieved_at"],
            "cached": status != "fresh",
            "stale": status == "stale",
        },
    }
