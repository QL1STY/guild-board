"""Where "now" comes from. Everything that needs the time takes a Clock, so tests can supply their own."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime:
        """The current time, timezone-aware, in UTC."""
        ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class ShiftedClock:
    """Real time, moved by an offset. Demo mode uses it, so that tests can start at a chosen instant
    and move time forward without waiting."""

    def __init__(self, start: datetime | None = None, base: Clock | None = None) -> None:
        if start is not None and start.tzinfo is None:
            raise ValueError("start must be timezone-aware")
        self._base: Clock = base or SystemClock()
        self._offset = start - self._base.now() if start is not None else timedelta(0)

    def now(self) -> datetime:
        return self._base.now() + self._offset

    def advance(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("the demo clock only moves forward")
        self._offset += timedelta(seconds=seconds)
