"""Shared plumbing: HTTP client, TTL cache, source metadata and errors."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import httpx

from . import settings_store

USER_AGENT = "FamilyWeekendPlanner/1.0 (Ashlex assessment demo)"

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=5.0),
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def user_agent() -> str:
    email = settings_store.get("contact_email")
    return f"{USER_AGENT} {email}".strip() if email else USER_AGENT


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class SourceError(Exception):
    """A data source failed or returned unusable data. Message is user-safe."""

    def __init__(self, source: str, message: str):
        super().__init__(message)
        self.source = source
        self.message = message


def check_simulated_failure(target: str, source: str) -> None:
    if target in settings_store.get("simulate_failure"):
        raise SourceError(source, f"{source} is unavailable (simulated outage enabled in Settings).")


class TTLCache:
    """Tiny in-process cache so we stay polite to free public APIs."""

    def __init__(self, maxsize: int = 512):
        self._data: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._maxsize = maxsize

    async def get_or_set(self, key: str, ttl: float, factory: Callable[[], Awaitable[Any]]) -> tuple[Any, bool]:
        """Return (value, from_cache). Failures are never cached."""
        hit = self._data.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1], True
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._data.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1], True
            value = await factory()
            if len(self._data) >= self._maxsize:
                self._data.pop(next(iter(self._data)))
            self._data[key] = (time.monotonic() + ttl, value)
            return value, False

    def clear(self) -> None:
        self._data.clear()


cache = TTLCache()
