"""Quick timers (spec 9.5): short one-off timers the Quick timer widget starts, of seconds, minutes or a few hours.

They remind like timers, in the same notification as the timers ready with them (timers/reminders.py), survive a
restart, and stay until they are dismissed. They are not part of the undo history.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from guildboard.clock import Clock
from guildboard.store import QuickTimerRow, Store, iso

MAX_QUICK_SECONDS = 43_200  # 12 hours
MAX_QUICK_TIMERS = 20
RANGE = "A quick timer runs from 1 second to 12 hours."
TOO_MANY = "At most 20 quick timers can run at once."
UNKNOWN = "There is no quick timer with this number."


class QuickTimerError(ValueError):
    """A quick timer Guild Board does not start. The message is fit to show."""


class UnknownQuickTimer(LookupError):
    pass


def quick_name(seconds: int) -> str:
    """"Quick timer · 1 h 30 min": the parts of its time that are not zero, as reminders and the widget name it."""
    hours, rest = divmod(seconds, 3600)
    minutes, left = divmod(rest, 60)
    parts = [f"{value} {unit}" for value, unit in ((hours, "h"), (minutes, "min"), (left, "s")) if value]
    return "Quick timer · " + " ".join(parts)


class QuickTimers:
    def __init__(self, store: Store, clock: Clock) -> None:
        self._store = store
        self._clock = clock

    def start(self, seconds: object) -> int:
        """Start a quick timer now, to the whole second, as the store keeps times."""
        if not (isinstance(seconds, int) and not isinstance(seconds, bool) and 1 <= seconds <= MAX_QUICK_SECONDS):
            raise QuickTimerError(RANGE)
        if len(self._store.quick_timers()) >= MAX_QUICK_TIMERS:
            raise QuickTimerError(TOO_MANY)
        started = self._clock.now().replace(microsecond=0)
        return self._store.add_quick_timer(seconds, started, started + timedelta(seconds=seconds))

    def dismiss(self, quick_id: int) -> None:
        if not self._store.drop_quick_timer(quick_id):
            raise UnknownQuickTimer(UNKNOWN)

    def model(self) -> dict[str, Any]:
        """Every quick timer, the soonest ready first, running or ready."""
        now = self._clock.now()
        return {"quick_timers": [
            {
                "id": row.id, "seconds": row.seconds, "name": quick_name(row.seconds),
                "started_at": iso(row.started_at), "ready_at": iso(row.ready_at),
                "state": "ready" if row.ready_at <= now else "running",
            }
            for row in self._store.quick_timers()
        ]}

    def due(self) -> list[QuickTimerRow]:
        """The quick timers that are ready and not yet reminded about."""
        now = self._clock.now()
        return [row for row in self._store.quick_timers() if row.ready_at <= now and not row.notified]

    def soonest(self) -> datetime | None:
        """The soonest ready time still ahead, which the reminder watch waits for."""
        now = self._clock.now()
        return min((row.ready_at for row in self._store.quick_timers() if row.ready_at > now and not row.notified),
                   default=None)
