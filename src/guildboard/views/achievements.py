"""The Achievements page model: the list, what is left of it, and the player's progress on each stage."""
from __future__ import annotations

import collections
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from typing import Any, Mapping

from guildboard.achievements.catalog import Catalog, Stage
from guildboard.achievements.notes import AchievementNotes, wiki_link
from guildboard.store import ProgressRow, Store, iso

VIEWS = ("left", "done", "all")


@dataclass(frozen=True)
class Query:
    view: str = "left"            # one of VIEWS
    category: str | None = None   # a Category.key; None opens on the first category with something left
    pinned: bool = False          # the pinned achievements, from every category, whatever the view
    search: str = ""              # names and descriptions, from every category, within the view
    unlisted: bool = False        # instead of achievements, the progress on stages the list does not hold
    # Groups (by their first stage's id) that stay whatever the view or Pinned decides: the page keeps the cards the
    # player changed until the player moves on, so a tick in Left does not move the next card up under the pointer.
    keep: frozenset[int] = frozenset()


def _when(moment: datetime | None) -> str | None:
    return None if moment is None else iso(moment)


def _category(catalog: Catalog, wanted: str | None, left: Mapping[str, int]) -> str | None:
    """The category asked for when the list has it, or else the first with something left, or else the first."""
    keys = [category.key for category in catalog.categories]
    if wanted in keys:
        return wanted
    return next((key for key in keys if left.get(key)), keys[0] if keys else None)


def _chosen(
    catalog: Catalog, query: Query, category: str | None, done: set[int], pinned: set[int]
) -> list[tuple[Stage, ...]]:
    """The achievements the page shows, in list order, each with all of its stages.

    Pinned keeps those with a pinned stage, whatever the view; otherwise the view decides. A group in query.keep stays
    whatever either decides. A search keeps those with it in a stage's name or description. Both look in every
    category; without either, the page shows one category.
    """
    if query.unlisted:
        return []

    def stays(stages: tuple[Stage, ...]) -> bool:
        if stages[0].id in query.keep:
            return True
        if query.pinned:
            return any(stage.id in pinned for stage in stages)
        if query.view == "left":
            return any(stage.id not in done for stage in stages)
        if query.view == "done":
            return any(stage.id in done for stage in stages)
        return True

    groups = [catalog.group(stage.id) for stage in catalog.stages if stage.order == 1]
    groups = [stages for stages in groups if stays(stages)]
    needle = query.search.strip().casefold()
    if needle:
        return [
            stages for stages in groups
            if any(needle in stage.name.casefold() or needle in stage.description.casefold() for stage in stages)
        ]
    if query.pinned:
        return groups
    return [stages for stages in groups if stages[0].category == category]


def _stage(
    notes: AchievementNotes, stage: Stage, row: ProgressRow | None, parts_done: Mapping[int, datetime]
) -> dict[str, Any]:
    return {
        "id": stage.id,
        "name": stage.name,
        "description": stage.description,
        "reward": stage.reward,
        "version": stage.version,
        "status": "not_started" if row is None else row.status,
        "done_at": None if row is None else _when(row.done_at),
        "pinned": row is not None and row.pinned,
        "note": "" if row is None else row.note,
        "parts": [
            {"label": label, "done_at": _when(parts_done.get(index))}
            for index, label in enumerate(notes.parts(stage))
        ],
        "wiki": wiki_link(notes, stage),
    }


def _unlisted(
    stage_id: int, row: ProgressRow | None, parts_done: Mapping[int, datetime], count: int | None
) -> dict[str, Any]:
    """The progress kept on a stage the list does not hold. Status and note are as for a stage without a row when it
    has only parts or a count."""
    return {
        "id": stage_id,
        "status": "not_started" if row is None else row.status,
        "note": "" if row is None else row.note,
        "pinned": row is not None and row.pinned,
        "parts": len(parts_done),
        "count": count,
    }


def achievement_totals(catalog: Catalog, store: Store) -> dict[str, int]:
    """The ticked stages and what is left (spec 7.4), as the Achievements page's top line and the Board say them."""
    done = {stage_id for stage_id, row in store.progress().items() if row.status == "done"}
    left = [stage for stage in catalog.stages if stage.id not in done]
    return {
        "stages": len(catalog.stages),
        "done": len(catalog.stages) - len(left),
        "left": len(left),
        "primogems_left": sum(stage.reward for stage in left),
    }


def build_achievements(catalog: Catalog, notes: AchievementNotes, store: Store, query: Query) -> dict[str, Any]:
    if query.view not in VIEWS:
        raise ValueError(f"unknown view: {query.view}")
    rows, parts, counts = store.progress(), store.parts(), store.counters()
    done = {stage_id for stage_id, row in rows.items() if row.status == "done"}
    pinned = {stage_id for stage_id, row in rows.items() if row.pinned}
    left = [stage for stage in catalog.stages if stage.id not in done]
    stages_in = collections.Counter(stage.category for stage in catalog.stages)
    left_in = collections.Counter(stage.category for stage in left)
    names = {category.key: category.name for category in catalog.categories}
    current = _category(catalog, query.category, left_in)
    # Progress is kept by id, apart from the list (spec 6.3): a row, checklist parts, or a count, which is kept under
    # the id of its achievement's first stage. A stage with any of them that the list does not hold is unlisted.
    # A row that is not started, with no pin and no note, as unticking leaves it, and a count of 0 keep nothing.
    def kept(stage_id: int) -> bool:
        row = rows.get(stage_id)
        in_row = row is not None and (row.status != "not_started" or row.pinned or bool(row.note))
        return in_row or bool(parts.get(stage_id)) or counts.get(stage_id, 0) > 0

    unlisted = sorted(
        stage_id for stage_id in {*rows, *parts, *counts} if catalog.stage(stage_id) is None and kept(stage_id)
    )

    def group(stages: tuple[Stage, ...]) -> dict[str, Any]:
        first = stages[0]
        counter = notes.counter(catalog, first.id)
        return {
            "id": first.id,
            "name": first.name,
            "category": names[first.category],
            "counter": None if counter is None else {
                "value": counts.get(first.id, 0), "unit": counter.unit, "unit_one": counter.unit_one,
                "targets": list(counter.targets),
            },
            "stages": [_stage(notes, stage, rows.get(stage.id), parts.get(stage.id, {})) for stage in stages],
        }

    return {
        "query": {**asdict(replace(query, category=current)), "keep": sorted(query.keep)},
        "totals": achievement_totals(catalog, store),
        "categories": [
            {
                "key": category.key, "name": category.name,
                "stages": stages_in[category.key], "left": left_in[category.key],
            }
            for category in catalog.categories
        ],
        "pinned": len({stage.group for stage in catalog.stages if stage.id in pinned}),
        "unlisted": len(unlisted),
        "unlisted_rows": [
            _unlisted(stage_id, rows.get(stage_id), parts.get(stage_id, {}), counts.get(stage_id))
            for stage_id in unlisted
        ] if query.unlisted else [],
        "undo": store.newest_change_label(),  # the change an undo would put back, which the page can offer
        "groups": [group(stages) for stages in _chosen(catalog, query, current, done, pinned)],
    }
