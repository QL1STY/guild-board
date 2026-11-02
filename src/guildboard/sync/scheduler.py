"""Turns events into sync runs: start-up, after a session, on request, and on an interval while the game runs."""
from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable, Coroutine

from guildboard.clock import Clock
from guildboard.config import Settings
from guildboard.events import EventBus
from guildboard.store import Store
from guildboard.sync.policy import DAILY_CAP, Decision, PolicyState, decide
from guildboard.sync.runner import SyncRunner

log = logging.getLogger(__name__)

POST_SESSION_DELAY = 180.0

SKIP_MESSAGES = {
    "fresh": "The last sync is less than 3 hours old.",
    "cooldown": "A sync ran less than 5 minutes ago.",
    "daily_cap": "The daily limit of 24 syncs is reached.",
    "paused": "Syncing is paused.",
    "busy": "A sync is already running.",
    "verification_needed": "HoYoLAB is waiting for a verification check.",
    "login_needed": "A HoYoLAB login is needed.",
}

_BLOCKING_STATES = ("verification_needed", "login_needed")


def local_midnight(now: datetime) -> datetime:
    """The start of the local calendar day that `now` falls in."""
    return now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)


class SyncScheduler:
    def __init__(
        self,
        runner: SyncRunner,
        store: Store,
        clock: Clock,
        bus: EventBus,
        *,
        settings: Callable[[], Settings],
        server: Callable[[], str],
        has_token: Callable[[], bool],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        day_start: Callable[[datetime], datetime] = local_midnight,
    ) -> None:
        self._runner = runner
        self._store = store
        self._clock = clock
        self._bus = bus
        self._settings = settings
        self._server = server
        self._has_token = has_token
        self._sleep = sleep
        self._day_start = day_start
        self._state = "ok"
        self.message: str | None = None
        self._block: str | None = None
        self._busy = False
        self._next_at: datetime | None = None
        self._post_task: asyncio.Task[None] | None = None
        self._interval_task: asyncio.Task[None] | None = None
        self._runs: set[asyncio.Task[None]] = set()
        self._restore_block()

    def _restore_block(self) -> None:
        """A captcha or a rejected login stays in force across restarts, until the player deals with it."""
        last = self._store.last_finished_run()
        if last is not None and last.error_kind in _BLOCKING_STATES:
            self._block = self._state = last.error_kind
            self.message = last.message

    # ------------------------------------------------------------------ what the interface shows
    def current_state(self) -> str:
        if self._busy:
            return "syncing"
        if not self._has_token():
            return "login_needed"
        if self._block is not None:
            return self._block
        if self._settings().sync_paused:
            return "paused"
        return self._state

    def next_sync_at(self) -> datetime | None:
        return self._next_at

    def manual_wait_seconds(self) -> int:
        decision = decide("manual", self._policy_state())
        return decision.wait_seconds if decision.reason == "cooldown" else 0

    def seconds_until_runs_count_again(self) -> int:
        """Once the day's runs are all spent, the seconds until the day's count starts again at midnight; 0 before that."""
        if self.runs_today() < DAILY_CAP:
            return 0
        now = self._clock.now()
        return max(1, math.ceil((self._day_start(now) + timedelta(days=1) - now).total_seconds()))

    def publish_state(self) -> None:
        self._bus.publish("state_changed", state=self.current_state(), message=self.message)

    # ------------------------------------------------------------------ triggers
    async def trigger(self, kind: str) -> Decision:
        decision = self._evaluate(kind)
        if decision.run:
            await self._execute(kind, decision)
        return decision

    def request(self, kind: str) -> Decision:
        decision = self._evaluate(kind)
        if decision.run:
            task = asyncio.create_task(self._execute(kind, decision))
            self._runs.add(task)
            task.add_done_callback(self._runs.discard)
        return decision

    def request_group(self, group: str) -> int | None:
        """Ask for a run of one group, within the sync's limits (the 5 minutes between runs and the 24 a day). None
        when a run has started. Otherwise the minutes to wait, rounded up: to the end of the gap, a minute while a sync
        is under way, or until the day's count starts again at midnight. 0 when no waiting will do, because the sync
        is paused or stopped for the login or a verification check: the player must deal with that first."""
        decision = self._evaluate("manual")
        if decision.run:
            task = asyncio.create_task(self._execute("manual", replace(decision, groups=(group,))))
            self._runs.add(task)
            task.add_done_callback(self._runs.discard)
            return None
        if decision.reason == "cooldown":
            return max(1, math.ceil(decision.wait_seconds / 60))
        if decision.reason == "daily_cap":
            now = self._clock.now()
            return max(1, math.ceil(self.seconds_until_runs_count_again() / 60))
        return 1 if decision.reason == "busy" else 0

    def runs_today(self) -> int:
        """The syncs that ran since the day began, which the daily limit counts."""
        return self._store.runs_since(self._day_start(self._clock.now()))

    def _policy_state(self) -> PolicyState:
        now = self._clock.now()
        return PolicyState(
            now=now,
            last_run_at=self._store.last_run_started(),
            last_ok_at=self._store.last_ok_at(),
            runs_today=self.runs_today(),
            groups=self._store.group_states(),
            paused=self._settings().sync_paused,
            blocked=self._block or (None if self._has_token() else "login_needed"),
            server=self._server(),
        )

    def _evaluate(self, kind: str) -> Decision:
        decision = Decision(False, "busy") if self._busy else decide(kind, self._policy_state())
        if decision.run:
            self._busy = True  # reserved at once, so a second trigger in the same instant is refused
        else:
            message = SKIP_MESSAGES.get(decision.reason, decision.reason)
            self._store.add_skipped(kind, self._clock.now(), message)
        return decision

    async def _execute(self, kind: str, decision: Decision) -> None:
        outcome = "failed"
        try:
            self._bus.publish("sync_started", trigger=kind)
            self.publish_state()
            result = await self._runner.run(kind, decision.groups)
            outcome = result.outcome
            self._state, self.message = result.state, result.message
            if result.state in _BLOCKING_STATES:
                self._block = result.state
        except Exception:
            log.exception("a sync run stopped unexpectedly")
            self._state, self.message = "error", "The sync stopped unexpectedly. See the log file."
        finally:
            self._busy = False
        self._bus.publish("sync_finished", outcome=outcome)
        self.publish_state()

    def running_syncs(self) -> list[asyncio.Task[None]]:
        """The sync runs under way, for whoever waits for them to end without owning them."""
        return [task for task in self._runs if not task.done()]

    def block(self, state: str, message: str) -> None:
        """Stop syncing, with a sentence the pages show, until the player deals with it (`clear_block`)."""
        self._block = self._state = state
        self.message = message
        self.publish_state()

    def clear_block(self) -> None:
        self._block = None
        if self._state in _BLOCKING_STATES:
            self._state, self.message = "ok", None
        self.publish_state()

    # ------------------------------------------------------------------ game events and timers
    def on_game_started(self) -> None:
        self._cancel_post()
        self._cancel_interval()
        minutes = self._settings().in_session_interval_min
        if minutes:
            self._interval_task = asyncio.create_task(self._interval_loop(minutes))

    def on_game_stopped(self, counted: bool = True) -> None:
        self._cancel_interval()
        self._cancel_post()
        if counted:
            self._next_at = self._clock.now() + timedelta(seconds=POST_SESSION_DELAY)
            self._post_task = asyncio.create_task(self._post_session())

    async def _post_session(self) -> None:
        await self._sleep(POST_SESSION_DELAY)
        self._next_at = None
        self._post_task = None
        self.request("post_session")

    async def _interval_loop(self, minutes: int) -> None:
        # The timers only wait and then ask for a run; the run itself is a separate task,
        # so cancelling a timer can never interrupt a sync that is under way.
        while True:
            self._next_at = self._clock.now() + timedelta(minutes=minutes)
            await self._sleep(minutes * 60.0)
            self.request("interval")

    def _cancel_post(self) -> None:
        if self._post_task is not None:
            self._post_task.cancel()
            self._post_task = None
        self._next_at = None

    def _cancel_interval(self) -> None:
        if self._interval_task is not None:
            self._interval_task.cancel()
            self._interval_task = None
        self._next_at = None

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self._store.fail_running_runs(self._clock.now())
        self.request("startup")

    async def stop(self) -> None:
        timers = [task for task in (self._post_task, self._interval_task) if task is not None]
        self._cancel_post()
        self._cancel_interval()
        runs = list(self._runs)
        for task in runs:
            task.cancel()
        await asyncio.gather(*timers, *runs, return_exceptions=True)

    async def idle(self) -> None:
        """Wait for the pending after-session timer and every background run. Tests use this."""
        while self._post_task is not None or self._runs:
            waiting: list[asyncio.Task[Any]] = list(self._runs)
            if self._post_task is not None:
                waiting.append(self._post_task)
            await asyncio.gather(*waiting, return_exceptions=True)
            # A run that has ended is taken out of the set by its done callback, which runs on the loop's next turn: a
            # gather of tasks already done ends at once, without one, and would come back to the same tasks forever.
            await asyncio.sleep(0)
