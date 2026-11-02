"""Reminders: when a timer whose bell is on becomes ready, one reminder names it (spec 10): a Windows notification and,
while the game runs, a line over the game. Core.remind gives each by its own setting.

Timers that become ready together, or while Guild Board was off or the PC slept, share one notification. A ready time
is reminded about once: each timer keeps the ready time its last reminder was for, and only a later one reminds again.
Quick timers (spec 9.5) remind the same way, once each, in the same notification.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Awaitable, Callable, Sequence

from guildboard.clock import Clock
from guildboard.events import EventBus
from guildboard.store import Store, TimerEvent
from guildboard.timers.quick import QuickTimers, quick_name
from guildboard.timers.timers import Timers

log = logging.getLogger(__name__)

MAX_NAMES = 5
TEST_TEXT = "This is a test notification from Guild Board."


def reminder_text(names: Sequence[str]) -> str:
    """One sentence for every timer that became ready, naming at most five of them."""
    if len(names) == 1:
        return f"{names[0]} is ready."
    shown, more = list(names[:MAX_NAMES]), len(names) - MAX_NAMES
    if more > 0:
        return f"{', '.join(shown)} and {more} more are ready."
    return f"{', '.join(shown[:-1])} and {shown[-1]} are ready."


class Reminders:
    def __init__(
        self,
        timers: Timers,
        store: Store,
        clock: Clock,
        bus: EventBus,
        *,
        enabled: Callable[[], bool],
        notify: Callable[[str, str], bool],
        quick: QuickTimers,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        longest_wait: float = 30.0,
    ) -> None:
        self._timers = timers
        self._quick = quick  # the quick timers, which remind in the same notification (spec 9.5)
        self._store = store
        self._clock = clock
        self._bus = bus
        self._enabled = enabled  # whether a reminder is given any way: Windows notifications, or lines over the game
        self._notify = notify
        self._sleep = sleep
        # The watch looks again at least this often, so that a PC that slept, or a clock that jumped, is noticed.
        self._longest_wait = longest_wait
        self._ready: set[int] | None = None  # the timers that were ready at the last look; None before the first
        self._woken = asyncio.Event()

    def check(self) -> list[int]:
        """Remind about every timer that is due, in one notification, and say which ones were. A timer is due when
        its bell is on and it became ready at a time later than the one its last reminder was for. With
        notifications and lines off, nothing is sent, but the timers count as reminded, so that turning them on again
        brings no burst of old reminders. The pages are told when a timer became ready since the last look."""
        now = self._clock.now()
        by_timer = self._events_by_timer()
        ready_now: set[int] = set()
        due: list[tuple[datetime, str, int]] = []
        for row in self._store.timers():
            events = by_timer.get(row.id, [])
            if self._timers.state(row, events, now) != "ready":
                continue
            ready_now.add(row.id)
            at = self._timers.ready_at(row, events)
            if not row.bell or at is None:
                continue
            if row.notified_ready_at is None or at > row.notified_ready_at:
                due.append((at, self._timers.name(row), row.id))
        due.sort()
        quick_due = self._quick.due()
        if due or quick_due:
            if self._enabled():
                quick_named = ((q.ready_at, quick_name(q.seconds)) for q in quick_due)
                named = sorted([*((at, name) for at, name, _ in due), *quick_named])
                # A reminder about quick timers alone opens the Board, where they are; any other opens Timers.
                self._notify("reminder" if due else "quick", reminder_text([name for _, name in named]))
            with self._store.transaction():
                for at, _, timer_id in due:
                    self._store.set_notified(timer_id, at)
                self._store.set_quick_notified([q.id for q in quick_due])
        if self._ready is not None and ready_now - self._ready:
            self._bus.publish("timers_changed")
        self._ready = ready_now
        return [timer_id for _, _, timer_id in due]

    def wake(self) -> None:
        """Look again now: a timer changed, a setting changed, or the demo clock moved."""
        self._woken.set()

    async def run(self) -> None:
        while True:
            self._woken.clear()  # before the look: a wake while it runs makes the wait after it end at once
            try:
                self.check()
            except Exception:  # a failed look must not end the watch
                log.exception("the timers could not be checked for reminders")
            try:
                wait = self._next_wait()
            except Exception:  # nor must a wait that cannot be worked out: the watch looks again after the longest one
                log.exception("the next reminder could not be worked out")
                wait = self._longest_wait
            await self._wait(wait)

    def _next_wait(self) -> float:
        """How long until the soonest ready time of a timer that will remind, at most the longest wait."""
        now = self._clock.now()
        wait = self._longest_wait
        by_timer = self._events_by_timer()
        for row in self._store.timers():
            events = by_timer.get(row.id, [])
            at = self._timers.ready_at(row, events)
            if row.bell and at is not None and at > now and self._timers.state(row, events, now) == "running":
                wait = min(wait, (at - now).total_seconds())
        quick_at = self._quick.soonest()
        if quick_at is not None:
            wait = min(wait, max(0.0, (quick_at - now).total_seconds()))
        return wait

    async def _wait(self, wait: float) -> None:
        """For `wait` seconds, or until a wake."""
        sleeping = asyncio.ensure_future(self._sleep(wait))
        woken = asyncio.ensure_future(self._woken.wait())
        try:
            await asyncio.wait({sleeping, woken}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in (sleeping, woken):
                task.cancel()
            await asyncio.gather(sleeping, woken, return_exceptions=True)

    def _events_by_timer(self) -> dict[int, list[TimerEvent]]:
        by_timer: dict[int, list[TimerEvent]] = {}
        for event in self._store.timer_events():
            by_timer.setdefault(event.timer_id, []).append(event)
        return by_timer
