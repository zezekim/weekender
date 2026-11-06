"""Shared plumbing: HTTP client, persistent cache, source metadata and errors."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
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


class Cache:
    """SQLite-backed cache in the data volume, so results survive restarts and deploys.

    Fresh entries are served until `ttl`. If refreshing fails with a SourceError,
    an expired entry up to `stale_for` seconds old is served instead and marked
    "stale", so the UI can say "last checked 2 hours ago" rather than show nothing.
    Failures themselves are never cached.
    """

    def __init__(self, path: Path):
        self._path = path
        self._db: sqlite3.Connection | None = None
        self._db_lock = threading.Lock()
        self._key_locks: dict[str, asyncio.Lock] = {}

    def _conn(self) -> sqlite3.Connection:
        if self._db is None:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, stored REAL, expires REAL, value TEXT)")
        return self._db

    def _read(self, key: str) -> tuple[float, float, Any] | None:
        with self._db_lock:
            row = self._conn().execute("SELECT stored, expires, value FROM cache WHERE key = ?", (key,)).fetchone()
        return (row[0], row[1], json.loads(row[2])) if row else None

    def _write(self, key: str, ttl: float, value: Any) -> None:
        now = time.time()
        with self._db_lock:
            self._conn().execute(
                "INSERT OR REPLACE INTO cache (key, stored, expires, value) VALUES (?, ?, ?, ?)",
                (key, now, now + ttl, json.dumps(value)),
            )

    async def get_or_set(
        self, key: str, ttl: float, factory: Callable[[], Awaitable[Any]], stale_for: float = 0
    ) -> tuple[Any, str]:
        """Return (value, status) where status is "fresh", "cached" or "stale"."""
        hit = self._read(key)
        if hit and hit[1] > time.time():
            return hit[2], "cached"
        lock = self._key_locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._read(key)
            if hit and hit[1] > time.time():
                return hit[2], "cached"
            try:
                value = await factory()
            except SourceError:
                if hit and stale_for and time.time() - hit[0] < stale_for:
                    return hit[2], "stale"
                raise
            self._write(key, ttl, value)
            return value, "fresh"

    def clear(self) -> None:
        with self._db_lock:
            self._conn().execute("DELETE FROM cache")


cache = Cache(settings_store.DATA_DIR / "cache.sqlite3")
