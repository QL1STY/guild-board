"""The timers: the pre-sets in use and the player's own, with every change the player makes to them.

Each change goes into the Achievements page's undo history through Progress.undoable, with the timer as it was. A
timer's ready time is worked out when it is read, from its rule and its latest Cleared, unless Set ready time gave one:
so a change of the fishing setting moves every fishing spot at once, with nothing written.
"""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Callable, Sequence

from guildboard.achievements.catalog import Catalog
from guildboard.achievements.progress import MAX_COUNT, Progress, timer_record
from guildboard.clock import Clock
from guildboard.store import Store, TimerEvent, TimerRow, iso
from guildboard.timers.presets import Preset, Presets
from guildboard.timers.rules import Rule, parse_rule, ready_at, rule_json

MAX_NAME = 60
MAX_STEPS = 50
CLEARED_DAYS_BACK = 30   # how long ago "Cleared earlier" can go
READY_DAYS_AHEAD = 90    # how far away "Set ready time" can go
DEFAULTS_ADDED = "timers.defaults_added"
NO_TIMER = "There is no timer with this number."


class TimerError(ValueError):
    """A change to a timer was refused. The message is fit to show to the player."""


class UnknownTimer(TimerError):
    """No timer, or no pre-set, by that number or name."""


class TimerConflict(TimerError):
    """The change does not fit the timer as it is."""


class Timers:
    def __init__(
        self,
        store: Store,
        clock: Clock,
        progress: Progress,
        presets: Presets,
        server: Callable[[], str],
        fishing: Callable[[], str],
    ) -> None:
        self._store = store
        self._clock = clock
        self._progress = progress
        self._presets = presets
        self._server = server
        self._fishing = fishing  # the fishing setting, asked whenever a fishing spot's ready time is worked out

    # ------------------------------------------------------------------ reading
    def preset(self, row: TimerRow) -> Preset | None:
        return self._presets.presets.get(row.preset) if row.preset is not None else None

    def name(self, row: TimerRow) -> str:
        preset = self.preset(row)
        if preset is not None:
            return preset.name
        return row.name or str(row.preset)  # a pre-set a later file no longer holds keeps its key for a name

    def about(self, row: TimerRow) -> str:
        """A pre-set's rule in words, which for a fishing spot follows the fishing setting."""
        preset = self.preset(row)
        return self._presets.about(preset, self._fishing()) if preset is not None else ""

    def presets(self) -> list[Preset]:
        """Every pre-set, in the file's order."""
        return list(self._presets.presets.values())

    def rule(self, row: TimerRow) -> Rule:
        preset = self.preset(row)
        if preset is not None:
            return preset.rule
        return parse_rule(json.loads(row.rule)) if row.rule else Rule("hours", 24)

    def ready_at(self, row: TimerRow, events: Sequence[TimerEvent]) -> datetime | None:
        """Set ready time's, else the rule applied to the latest Cleared, else None for a timer never cleared."""
        if row.ready_override is not None:
            return row.ready_override
        if not events:
            return None
        return ready_at(self.rule(row), max(event.at for event in events), self._server(), self._fishing())

    def state(self, row: TimerRow, events: Sequence[TimerEvent], now: datetime) -> str:
        if row.steps is not None and len(events) >= row.steps:
            return "finished"
        ready = self.ready_at(row, events)
        return "running" if ready is not None and ready > now else "ready"

    # ------------------------------------------------------------------ the first start
    def ensure_defaults(self, catalog: Catalog) -> None:
        """Once: the default pre-sets whose achievements still have stages left. A pre-set the player removes later
        stays removed. Nothing is recorded for undo: no recorded change refers to rows that did not exist. Nor is a line left
        for sync: these are the app's rows and not the player's change, and a PC that has only these has nothing of its own."""
        if self._store.meta(DEFAULTS_ADDED) is not None:
            return
        now = self._clock.now()
        done = {stage for stage, row in self._store.progress().items() if row.status == "done"}
        in_use = {row.preset for row in self._store.timers()}
        with self._store.applying_sync():
            for preset in self._presets.presets.values():
                listed = [stage for stage in preset.stages if catalog.stage(stage) is not None]
                if preset.default and preset.key not in in_use and not all(stage in done for stage in listed):
                    self._store.add_timer(TimerRow(0, preset.key, "", "", "", None, True, None, None, now, now))
            self._store.set_meta(DEFAULTS_ADDED, iso(now))

    # ------------------------------------------------------------------ changes
    def create(self, name: str, place: str, rule: Rule, steps: int | None) -> tuple[int, str]:
        name, place = _name(name), _place(place)
        _check_steps(steps)
        now = self._clock.now()
        label = f"Added the timer {name}"
        row = TimerRow(0, None, name, place, json.dumps(rule_json(rule)), steps, True, None, None, now, now)
        with self._progress.undoable(label, now) as record:
            timer_id = self._store.add_timer(row)
            record["timers"][str(timer_id)] = timer_record(None)
        return timer_id, label

    def add_preset(self, key: str) -> tuple[int, str]:
        preset = self._presets.presets.get(key)
        if preset is None:
            raise UnknownTimer("There is no pre-set timer with this name.")
        if any(row.preset == key for row in self._store.timers()):
            raise TimerConflict("This pre-set timer is in use already.")
        now = self._clock.now()
        label = f"Added the timer {preset.name}"
        with self._progress.undoable(label, now) as record:
            timer_id = self._store.add_timer(TimerRow(0, key, "", "", "", None, True, None, None, now, now))
            record["timers"][str(timer_id)] = timer_record(None)
        return timer_id, label

    def cleared(self, timer_id: int, at: datetime | None = None) -> str:
        """Start the countdown: now, or at the time the player gives for when they forgot to press it. On a running
        timer it starts again and counts again. A pre-set with a counter adds one to it, in the same change."""
        row, events = self._timer(timer_id)
        now = self._clock.now()
        if at is None:
            at = now
        elif at > now:
            raise TimerError("A timer cannot be cleared in the future.")
        elif at < now - timedelta(days=CLEARED_DAYS_BACK):
            raise TimerError(f"A timer can be cleared at most {CLEARED_DAYS_BACK} days ago.")
        if self.state(row, events, now) == "finished":
            raise TimerConflict("This timer has done all its visits.")
        preset = self.preset(row)
        counter = preset.counter if preset is not None else None
        before = {"timers": {str(timer_id): timer_record(row, events)}}
        if counter is not None:
            before["counters"] = {str(counter): self._store.counters().get(counter)}
        label = f"Cleared {self.name(row)}"
        with self._progress.undoable(label, now, **before):
            self._store.add_timer_event(timer_id, at, now, "player")
            self._store.put_timer(replace(row, ready_override=None, updated_at=now))
            if counter is not None:
                self._store.put_counter(counter, min(MAX_COUNT, self._store.counters().get(counter, 0) + 1), now)
        return label

    def set_ready(self, timer_id: int, at: datetime) -> str:
        """Match the game's own timer: the teapot shows the time left."""
        row, events = self._timer(timer_id)
        now = self._clock.now()
        if at <= now:
            raise TimerError("A ready time is later than now.")
        if at > now + timedelta(days=READY_DAYS_AHEAD):
            raise TimerError(f"A ready time is at most {READY_DAYS_AHEAD} days away.")
        label = f"Set when {self.name(row)} is ready"
        with self._progress.undoable(label, now, timers={str(timer_id): timer_record(row, events)}):
            self._store.put_timer(replace(row, ready_override=at, updated_at=now))
        return label

    def edit(self, timer_id: int, *, name: str, place: str, rule: Rule, steps: int | None) -> str:
        row, events = self._timer(timer_id)
        if row.preset is not None:
            raise TimerConflict("A pre-set timer keeps its name and its rule.")
        name, place = _name(name), _place(place)
        _check_steps(steps)
        now = self._clock.now()
        label = f"Changed the timer {name}"
        changed = replace(row, name=name, place=place, rule=json.dumps(rule_json(rule)), steps=steps, updated_at=now)
        with self._progress.undoable(label, now, timers={str(timer_id): timer_record(row, events)}):
            self._store.put_timer(changed)
        return label

    def set_bell(self, timer_id: int, on: bool) -> str:
        row, events = self._timer(timer_id)
        now = self._clock.now()
        label = f"Turned {'on' if on else 'off'} the reminder for {self.name(row)}"
        with self._progress.undoable(label, now, timers={str(timer_id): timer_record(row, events)}):
            self._store.put_timer(replace(row, bell=on, updated_at=now))
        return label

    def remove(self, timer_id: int) -> str:
        """Remove a timer with its history; the undo puts both back."""
        row, events = self._timer(timer_id)
        now = self._clock.now()
        label = f"Removed the timer {self.name(row)}"
        with self._progress.undoable(label, now, timers={str(timer_id): timer_record(row, events)}):
            self._store.drop_timer(timer_id)
        return label

    def _timer(self, timer_id: int) -> tuple[TimerRow, list[TimerEvent]]:
        row = self._store.timer(timer_id)
        if row is None:
            raise UnknownTimer(NO_TIMER)
        return row, self._store.timer_events(timer_id)


def _name(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= MAX_NAME:
        raise TimerError(f"A timer's name is 1 to {MAX_NAME} characters.")
    return name


def _place(place: str) -> str:
    place = place.strip()
    if len(place) > MAX_NAME:
        raise TimerError(f"A place is at most {MAX_NAME} characters.")
    return place


def _check_steps(steps: int | None) -> None:
    if steps is None:
        return
    if not isinstance(steps, int) or isinstance(steps, bool) or not 2 <= steps <= MAX_STEPS:
        raise TimerError(f"A timer has 2 to {MAX_STEPS} visits, or none.")
