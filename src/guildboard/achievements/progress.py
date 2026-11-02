"""The player's progress: ticking, pins, notes, parts and counts, each of which can be undone. The timers and the days
a commission appeared keep their changes in the same undo history, so one Undo line serves every category.

Undo stays exact because of one rule: every write to achievement_progress, achievement_parts, achievement_counters,
timers, timer_events or commission_log goes through Progress.undoable, which records what it replaces, or else clears
the undo history in the same transaction. The import (importers.apply_import), the rows that come from another PC
(cloud/sync.py) and the demo's seeding do the latter, with Store.clear_changes(). An undo could otherwise put back a row that a
later write had changed, and lose that write. Two
writes need neither: adding rows that no recorded change refers to, as the default pre-set timers are added once, and
the reminders' mark of the ready time they reminded about, which an undo puts back with the ready time it belongs to.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, replace
from datetime import date, datetime
from typing import Any, Callable, Iterator, Mapping, Sequence

from guildboard.achievements.catalog import Catalog, Stage
from guildboard.achievements.notes import AchievementNotes
from guildboard.clock import Clock
from guildboard.store import ProgressRow, Store, TimerEvent, TimerRow, iso, parse_iso

STATUSES = ("not_started", "in_progress", "done")
MAX_NOTE = 2000
MAX_COUNT = 10_000_000
NOT_A_COUNT = f"A count is a whole number from 0 to {MAX_COUNT:,}."


class ProgressError(ValueError):
    """A change was refused. The message is fit to show to the player."""


class UnknownAchievement(ProgressError):
    """The number is not a stage of the current list."""


class BadChange(ProgressError):
    """The change makes no sense, for example a part the stage does not have."""


class Progress:
    """The player's changes to their progress. Each one is recorded with what it replaces, so that it can be undone,
    and returns its label, for the line with Undo that the page shows after it.

    Only the player ticks: a checklist or a count that is complete does not tick its stage.
    """

    def __init__(self, store: Store, catalog: Callable[[], Catalog], notes: AchievementNotes, clock: Clock) -> None:
        self._store = store
        self._catalog = catalog  # asked at every change, because a list update can replace the list
        self._notes = notes
        self._clock = clock

    def set_status(self, stage_id: int, status: str) -> str:
        """Tick, untick or mark in progress. Ticking a stage also ticks the earlier stages of its achievement."""
        catalog = self._catalog()
        stage = _listed(catalog, stage_id)
        if status not in STATUSES:
            raise BadChange("A status is not_started, in_progress or done.")
        rows, now = self._store.progress(), self._clock.now()
        if status == "done":
            stages = [*self._earlier_not_done(catalog, stage, rows), stage]
            changed = [_ticked(rows.get(s.id), s.id, now) for s in stages]
            return self._write_rows(f"Ticked {stage.name}", rows, changed, now)
        old = rows.get(stage_id)
        if status == "in_progress":
            label = f"Marked {stage.name} as in progress"
        elif old is not None and old.status == "done":
            label = f"Unticked {stage.name}"
        else:  # a stage that was not done, such as one in progress, was never ticked
            label = f"Marked {stage.name} as not started"
        return self._write_rows(label, rows, [_changed(old, stage_id, now, status=status, done_at=None)], now)

    def set_pinned(self, stage_id: int, pinned: bool) -> str:
        stage = _listed(self._catalog(), stage_id)
        label = f"Pinned {stage.name}" if pinned else f"Unpinned {stage.name}"
        return self._change_row(label, stage_id, pinned=pinned)

    def unpin_achievement(self, group_id: int) -> str:
        """Unpin every pinned stage of an achievement, named by its first stage's id, as one change, which one Undo
        takes back. Pin on the page is the whole achievement's: it shows pressed while any of its stages is pinned."""
        stages = self._catalog().group(group_id)
        if not stages:
            raise UnknownAchievement("There is no achievement with this number.")
        rows, now = self._store.progress(), self._clock.now()
        pinned = [rows[s.id] for s in stages if s.id in rows and rows[s.id].pinned]
        if not pinned:
            raise BadChange("Nothing of this achievement is pinned.")
        changed = [_changed(row, row.stage_id, now, pinned=False) for row in pinned]
        return self._write_rows(f"Unpinned {stages[0].name}", rows, changed, now)

    def set_note(self, stage_id: int, note: str) -> str:
        """Keep the player's note on a stage, without the spaces around it. Those spaces do not count towards its
        length."""
        stage = _listed(self._catalog(), stage_id)
        note = note.strip()
        if len(note) > MAX_NOTE:
            raise BadChange(f"A note can be at most {MAX_NOTE:,} characters long.")
        return self._change_row(f"Changed the note on {stage.name}", stage_id, note=note)

    def set_part(self, stage_id: int, part: int, done: bool) -> str:
        """Tick or untick a part of the stage's checklist. Parts are numbered from 0, in the list's order."""
        stage = _listed(self._catalog(), stage_id)
        if not 0 <= part < len(self._notes.parts(stage)):
            raise BadChange("This achievement has no part with this number.")
        now = self._clock.now()
        old = self._store.parts().get(stage_id, {}).get(part)
        label = f"Ticked a part of {stage.name}" if done else f"Unticked a part of {stage.name}"
        before = {str(stage_id): {str(part): iso(old) if old is not None else None}}
        with self.undoable(label, now, parts=before):
            self._store.put_part(stage_id, part, (old or now) if done else None)  # a part done already keeps its day
        return label

    def set_counter(self, group_id: int, value: int) -> str:
        """Set the count of an achievement that counts something, such as kills. The count belongs to the whole
        achievement, named by its first stage's id, and is compared with each stage's target."""
        catalog = self._catalog()
        stage = _listed(catalog, group_id)
        if self._notes.counter(catalog, group_id) is None:
            raise BadChange("This achievement counts nothing.")
        if not 0 <= value <= MAX_COUNT:
            raise BadChange(NOT_A_COUNT)
        now = self._clock.now()
        label = f"Set the count of {stage.name} to {value:,}"
        with self.undoable(label, now, counters={str(group_id): self._store.counters().get(group_id)}):
            self._store.put_counter(group_id, value, now)
        return label

    def undo(self) -> str | None:
        """Put back what the newest recorded change replaced. Its label, or None when there is nothing to undo."""
        now = self._clock.now()
        with self._store.transaction():
            change = self._store.pop_change()
            if change is None:
                return None
            label, before = change
            rows = before["progress"]
            self._store.drop_progress([int(stage_id) for stage_id, row in rows.items() if row is None])
            self._store.put_progress([_as_row(row) for row in rows.values() if row is not None])
            for stage_id, parts in before["parts"].items():
                for part, done_at in parts.items():
                    self._store.put_part(int(stage_id), int(part), parse_iso(done_at) if done_at else None)
            for group_id, value in before["counters"].items():
                self._store.put_counter(int(group_id), value, now)
            # Records from before plan 2A-2 hold neither timers nor appearances.
            for timer_id, saved in before.get("timers", {}).items():
                if saved["row"] is None:
                    self._store.drop_timer(int(timer_id))
                else:
                    self._store.put_timer(_timer_row(saved["row"]))
                    self._store.replace_timer_events(int(timer_id), [_timer_event(e) for e in saved["events"]])
            for stage_id, days in before.get("appearances", {}).items():
                for day, at in days.items():
                    self._store.put_appearance(int(stage_id), date.fromisoformat(day), parse_iso(at) if at else None)
        return label

    # ------------------------------------------------------------------ helpers
    def _earlier_not_done(self, catalog: Catalog, stage: Stage, rows: Mapping[int, ProgressRow]) -> list[Stage]:
        """The earlier stages of the achievement that are not done yet. Ticking a stage ticks them too, because the
        game awards the stages in order, except for an achievement that Guild Board's notes mark as not in order.
        Stages done already are left as they are, with their tick's time and where it came from."""
        if stage.group in self._notes.not_in_order:
            return []
        done = {stage_id for stage_id, row in rows.items() if row.status == "done"}
        return [s for s in catalog.group(stage.group) if s.order < stage.order and s.id not in done]

    def _change_row(self, label: str, stage_id: int, **fields: Any) -> str:
        """Change some fields of one stage's row."""
        rows, now = self._store.progress(), self._clock.now()
        return self._write_rows(label, rows, [_changed(rows.get(stage_id), stage_id, now, **fields)], now)

    def _write_rows(
        self, label: str, old: Mapping[int, ProgressRow], new: Sequence[ProgressRow], now: datetime
    ) -> str:
        """Write the new rows, recording the ones they replace. `old` holds the stages' rows before the change."""
        before = {str(row.stage_id): _as_dict(old.get(row.stage_id)) for row in new}
        with self.undoable(label, now, progress=before):
            self._store.put_progress(new)
        return label

    @contextmanager
    def undoable(self, label: str, now: datetime, **before: Any) -> Iterator[dict[str, Any]]:
        """Let a change write, and record it with what it replaced. Both share one transaction: the change and its
        record are kept together, or neither is. The block gets the record, to add what it learns as it writes, such
        as the id of a timer it makes.

        `before` holds what the change touches, by id: under "progress" a row as a dict, under "parts" a part's iso
        time, under "counters" a count, under "timers" `timer_record`'s dict, and under "appearances" each game day's
        iso time; None where there was none.
        """
        record = {"progress": {}, "parts": {}, "counters": {}, "timers": {}, "appearances": {}, **before}
        with self._store.transaction():
            yield record
            self._store.push_change(label, record, now)


def _listed(catalog: Catalog, stage_id: int) -> Stage:
    """The stage with this id in the current list. Only those can be changed."""
    stage = catalog.stage(stage_id)
    if stage is None:
        raise UnknownAchievement("There is no achievement with this number.")
    return stage


def _changed(old: ProgressRow | None, stage_id: int, now: datetime, **fields: Any) -> ProgressRow:
    """A stage's row after the player changed `fields`. A stage that has no row yet starts as not started."""
    row = old if old is not None else ProgressRow(stage_id, "not_started", None, False, "", "player", now)
    return replace(row, source="player", updated_at=now, **fields)


def _ticked(old: ProgressRow | None, stage_id: int, now: datetime) -> ProgressRow:
    """A stage's row after the player ticked it: done since now, or since its old tick when it was done already."""
    done_at = old.done_at if old is not None and old.status == "done" else now
    return _changed(old, stage_id, now, status="done", done_at=done_at)


def _as_dict(row: ProgressRow | None) -> dict[str, Any] | None:
    """A row as the undo history keeps it: a dict, with its times as iso strings. None when there is no row."""
    if row is None:
        return None
    done_at = iso(row.done_at) if row.done_at is not None else None
    return {**asdict(row), "done_at": done_at, "updated_at": iso(row.updated_at)}


def _as_row(data: Mapping[str, Any]) -> ProgressRow:
    """The row that _as_dict kept."""
    done_at = parse_iso(data["done_at"]) if data["done_at"] else None
    return ProgressRow(**{**data, "done_at": done_at, "updated_at": parse_iso(data["updated_at"])})


_TIMER_TIMES = ("ready_override", "notified_ready_at", "created_at", "updated_at")


def timer_record(row: TimerRow | None, events: Sequence[TimerEvent] = ()) -> dict[str, Any]:
    """A timer as the undo history keeps it under "timers": its row and every Cleared of it, times as iso strings.
    A row of None says there was no timer, and an undo drops the one there is."""
    if row is None:
        return {"row": None, "events": []}
    times = {name: iso(getattr(row, name)) if getattr(row, name) is not None else None for name in _TIMER_TIMES}
    kept = [{**asdict(e), "at": iso(e.at), "recorded_at": iso(e.recorded_at)} for e in events]
    return {"row": {**asdict(row), **times}, "events": kept}


def _timer_row(data: Mapping[str, Any]) -> TimerRow:
    """The row that timer_record kept."""
    times = {name: parse_iso(data[name]) if data[name] else None for name in _TIMER_TIMES}
    return TimerRow(**{**data, **times})


def _timer_event(data: Mapping[str, Any]) -> TimerEvent:
    return TimerEvent(**{**data, "at": parse_iso(data["at"]), "recorded_at": parse_iso(data["recorded_at"])})
