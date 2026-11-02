"""The sync rules, as pure functions: given the clock and what happened before, may a sync run, and for which groups?"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Mapping

from guildboard.gameday import game_day
from guildboard.records import GROUPS
from guildboard.store import GroupState

MIN_GAP = timedelta(minutes=5)
DAILY_CAP = 24
STARTUP_STALE = timedelta(hours=3)

# None: every run. A timedelta: at most once per that long. "game_day": at most once per game day.
CADENCE: dict[str, timedelta | str | None] = {
    "overview": None,
    "notes": None,
    "characters": timedelta(hours=6),
    "endgame": timedelta(hours=12),
    "diary": "game_day",
    "calendar": "game_day",
}


@dataclass(frozen=True)
class PolicyState:
    now: datetime
    last_run_at: datetime | None
    last_ok_at: datetime | None
    runs_today: int
    groups: Mapping[str, GroupState]
    paused: bool
    blocked: str | None
    server: str


@dataclass(frozen=True)
class Decision:
    run: bool
    reason: str
    groups: tuple[str, ...] = ()
    wait_seconds: int = 0


def due_groups(state: PolicyState) -> tuple[str, ...]:
    due = []
    for group in GROUPS:
        known = state.groups.get(group)
        if known is None or known.last_ok_at is None or known.needs_retry:
            due.append(group)
            continue
        cadence = CADENCE[group]
        elapsed = state.now - known.last_ok_at
        if cadence is None or elapsed < timedelta(0):
            # A negative elapsed time means the clock was set back; fetch rather than wait for it to catch up.
            due.append(group)
        elif cadence == "game_day":
            if game_day(state.now, state.server) != game_day(known.last_ok_at, state.server):
                due.append(group)
        elif elapsed >= cadence:
            due.append(group)
    return tuple(due)


def decide(trigger: str, state: PolicyState) -> Decision:
    if state.blocked is not None:
        return Decision(False, state.blocked)
    if state.paused:
        return Decision(False, "paused")
    if trigger == "startup" and state.last_ok_at is not None:
        if timedelta(0) <= state.now - state.last_ok_at <= STARTUP_STALE:
            return Decision(False, "fresh")
    if state.last_run_at is not None:
        since = state.now - state.last_run_at
        if timedelta(0) <= since < MIN_GAP:
            return Decision(False, "cooldown", (), math.ceil((MIN_GAP - since).total_seconds()))
    if state.runs_today >= DAILY_CAP:
        return Decision(False, "daily_cap")
    groups = due_groups(state)
    if trigger == "post_session" and "characters" not in groups:
        # The player most likely changed builds while playing, so the sync after a session reads them again.
        groups = tuple(group for group in GROUPS if group in groups or group == "characters")
    return Decision(True, "ok", groups)
