"""Freely licensed photos for places, via Wikidata (P18 "image") and Wikimedia Commons.

Only places whose OpenStreetMap record links to a Wikidata item can get a photo,
so a photo is always of that specific place. Every photo carries its author,
licence and a link to its Commons page. Failures are silent: cards simply fall
back to their icon.
"""

from __future__ import annotations

import re
from html import unescape
from typing import Any

import httpx

from ..core import SourceError, cache, client

WIKIDATA = "https://www.wikidata.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
TIMEOUT = httpx.Timeout(8.0, connect=4.0)
# Image hosts the page's Content-Security-Policy allows (see Caddyfile).
ALLOWED_HOSTS = ("https://upload.wikimedia.org/", "https://thumb.wikimedia.org/")


def _plain(html: str | None, limit: int = 80) -> str | None:
    if not html:
        return None
    text = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html))).strip()
    return (text[: limit - 1] + "…") if len(text) > limit else text or None


async def _get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        resp = await client().get(url, params={**params, "format": "json"}, timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SourceError("Wikimedia", f"Wikimedia did not respond ({type(exc).__name__}).") from exc


async def _fetch(qids: list[str]) -> dict[str, dict[str, Any] | None]:
    entities = (await _get(WIKIDATA, {"action": "wbgetentities", "ids": "|".join(qids), "props": "claims"})).get("entities", {})
    files: dict[str, str] = {}
    for qid in qids:
        try:
            files[qid] = "File:" + entities[qid]["claims"]["P18"][0]["mainsnak"]["datavalue"]["value"]
        except (KeyError, IndexError, TypeError):
            pass
    found: dict[str, dict[str, Any] | None] = {qid: None for qid in qids}
    if not files:
        return found

    data = (
        await _get(
            COMMONS,
            {
                "action": "query",
                "titles": "|".join(files.values()),
                "prop": "imageinfo",
                "iiprop": "url|extmetadata",
                "iiurlwidth": 960,
            },
        )
    ).get("query", {})
    normalized = {n["from"]: n["to"] for n in data.get("normalized", [])}
    by_title = {p.get("title"): p for p in data.get("pages", {}).values()}
    for qid, title in files.items():
        page = by_title.get(normalized.get(title, title)) or {}
        info = (page.get("imageinfo") or [None])[0]
        if not info or not info.get("thumburl", "").startswith(ALLOWED_HOSTS):
            continue
        meta = info.get("extmetadata", {})
        found[qid] = {
            "url": info["thumburl"],
            "width": info.get("thumbwidth"),
            "height": info.get("thumbheight"),
            "credit": _plain(meta.get("Artist", {}).get("value")) or "Wikimedia Commons contributor",
            "license": _plain(meta.get("LicenseShortName", {}).get("value"), 40),
            "page": info.get("descriptionurl"),
        }
    return found


async def attach(items: list[dict[str, Any]]) -> None:
    """Add a `photo` (or None) to every item, in place. Never raises."""
    qids = sorted({i["wikidata"] for i in items if i.get("wikidata")})
    photos: dict[str, dict[str, Any] | None] = {}
    if qids:
        try:
            # One batched lookup, cached for a week; keyed by the set of items.
            photos, _ = await cache.get_or_set(f"photos:{'|'.join(qids)}", 7 * 86400, lambda: _fetch(qids), stale_for=60 * 86400)
        except SourceError:
            photos = {}
    for i in items:
        i["photo"] = photos.get(i.get("wikidata") or "")
