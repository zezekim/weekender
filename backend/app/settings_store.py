"""Runtime settings, editable from the protected /settings page.

Values are persisted to a JSON file inside the data volume (mode 0600) and
fall back to environment variables. Secrets are never returned in full to
the browser — only whether they are set and their last four characters.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
SETTINGS_FILE = DATA_DIR / "settings.json"

SECRET_FIELDS = {
    "geoapify_api_key": "GEOAPIFY_API_KEY",
    "google_places_api_key": "GOOGLE_PLACES_API_KEY",
    "open_meteo_api_key": "OPEN_METEO_API_KEY",
}

PLACES_PROVIDERS = ("auto", "google", "geoapify", "osm")
FAILURE_TARGETS = ("geocoding", "weather", "places")

DEFAULT_OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

_lock = threading.Lock()


def _load_file() -> dict[str, Any]:
    try:
        return json.loads(SETTINGS_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_file(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, SETTINGS_FILE)


def get(name: str) -> Any:
    """Resolve a setting: settings file first, then environment, then default."""
    data = _load_file()
    if name in SECRET_FIELDS:
        return data.get(name) or os.environ.get(SECRET_FIELDS[name]) or None
    if name == "places_provider":
        value = data.get(name) or os.environ.get("PLACES_PROVIDER", "auto")
        return value if value in PLACES_PROVIDERS else "auto"
    if name == "overpass_urls":
        urls = data.get(name) or os.environ.get("OVERPASS_URLS", "")
        parsed = [u.strip() for u in urls.split(",") if u.strip()] if isinstance(urls, str) else urls
        return parsed or DEFAULT_OVERPASS
    if name == "contact_email":
        return data.get(name) or os.environ.get("CONTACT_EMAIL", "")
    if name == "simulate_failure":
        return [t for t in data.get(name, []) if t in FAILURE_TARGETS]
    raise KeyError(name)


def _mask(value: str | None) -> dict[str, Any]:
    if not value:
        return {"set": False, "hint": None}
    return {"set": True, "hint": f"••••{value[-4:]}" if len(value) > 8 else "••••"}


def public_view() -> dict[str, Any]:
    data = _load_file()
    secrets = {}
    for field, env in SECRET_FIELDS.items():
        source = "settings" if data.get(field) else ("env" if os.environ.get(env) else None)
        secrets[field] = {**_mask(get(field)), "source": source}
    return {
        "secrets": secrets,
        "places_provider": get("places_provider"),
        "overpass_urls": get("overpass_urls"),
        "contact_email": get("contact_email"),
        "simulate_failure": get("simulate_failure"),
    }


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial update. For secrets: None = keep, "" = clear, str = set."""
    with _lock:
        data = _load_file()
        for field in SECRET_FIELDS:
            if field in patch and patch[field] is not None:
                value = str(patch[field]).strip()
                if value:
                    data[field] = value
                else:
                    data.pop(field, None)
        if patch.get("places_provider") in PLACES_PROVIDERS:
            data["places_provider"] = patch["places_provider"]
        if isinstance(patch.get("overpass_urls"), list):
            data["overpass_urls"] = [
                u.strip() for u in patch["overpass_urls"] if isinstance(u, str) and u.strip().startswith("https://")
            ]
        if isinstance(patch.get("contact_email"), str):
            data["contact_email"] = patch["contact_email"].strip()[:200]
        if isinstance(patch.get("simulate_failure"), list):
            data["simulate_failure"] = [t for t in patch["simulate_failure"] if t in FAILURE_TARGETS]
        _save_file(data)
    return public_view()
