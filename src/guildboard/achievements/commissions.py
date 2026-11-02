"""The achievements that come from daily commissions, and Appeared today: the game days each one's commission came up.

A day is marked once, and the mark goes into the Achievements page's undo history through Progress.undoable. "Today" is
the game day, which turns at 04:00 server time, so 03:59 still belongs to the day before (spec 11.1).
"""
from __future__ import annotations

from typing import Callable

from guildboard.achievements.catalog import Catalog
from guildboard.achievements.notes import AchievementNotes
from guildboard.achievements.progress import Progress, ProgressError
from guildboard.clock import Clock
from guildboard.gameday import game_day
from guildboard.store import Store


class NotACommission(ProgressError):
    """The stage comes from no daily commission, as far as the list and Guild Board's notes know."""


class AlreadyToday(ProgressError):
    """The stage is marked as appeared in this game day already."""


def commission_stages(catalog: Catalog, notes: AchievementNotes) -> dict[int, str]:
    """By stage, the region of each one that comes from a daily commission: the list's, or else the notes' for one the
    list does not mark. The stages the notes found not to come from commissions are left out, whatever the list says."""
    stages: dict[int, str] = {}
    for stage in catalog.stages:
        note = notes.commissions.get(stage.id)
        region = stage.region or (note.region if note is not None else None)
        if region is not None and stage.id not in notes.not_commissions:
            stages[stage.id] = region
    return stages


class Commissions:
    def __init__(
        self,
        store: Store,
        catalog: Callable[[], Catalog],
        notes: AchievementNotes,
        progress: Progress,
        clock: Clock,
        server: Callable[[], str],
    ) -> None:
        self._store = store
        self._catalog = catalog  # asked at every change, because a list update can replace the list
        self._notes = notes
        self._progress = progress
        self._clock = clock
        self._server = server

    def appeared(self, stage_id: int) -> str:
        """Mark that the achievement's commission came up in today's game day. A second mark that day is refused."""
        catalog = self._catalog()
        stage = catalog.stage(stage_id)
        if stage is None or stage_id not in commission_stages(catalog, self._notes):
            raise NotACommission("This achievement is not a daily commission one.")
        now = self._clock.now()
        day = game_day(now, self._server())
        if day in self._store.appearances().get(stage_id, {}):
            raise AlreadyToday("It is marked as appeared today already.")
        label = f"Marked {stage.name} as appeared today"
        with self._progress.undoable(label, now, appearances={str(stage_id): {day.isoformat(): None}}):
            self._store.put_appearance(stage_id, day, now)
        return label
