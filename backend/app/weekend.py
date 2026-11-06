from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

SATURDAY = 5


def target_weekend(today: date) -> tuple[date, date]:
    """Next Saturday on or after `today` (Sunday rolls to the following Saturday)."""
    saturday = today + timedelta(days=(SATURDAY - today.weekday()) % 7)
    return saturday, saturday + timedelta(days=1)


def local_now(tz: str) -> datetime:
    return datetime.now(ZoneInfo(tz))
