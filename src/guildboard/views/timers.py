"""The Timers category's model: every timer in use with its state, and the pre-sets that can still be added."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Mapping, Sequence

from guildboard.achievements.catalog import Catalog
from guildboard.achievements.notes import AchievementNotes
from guildboard.store import ProgressRow, Store, TimerEvent, TimerRow, iso
from guildboard.timers.presets import Preset
from guildboard.timers.rules import length_hours, rule_json
from guildboard.timers.timers import Timers

STATE_ORDER = {"ready": 0, "running": 1, "finished": 2}


def _when(moment: datetime | None) -> str | None:
    return None if moment is None else iso(moment)


def _events_by_timer(store: Store) -> dict[int, list[TimerEvent]]:
    by_timer: dict[int, list[TimerEvent]] = {}
    for event in store.timer_events():
        by_timer.setdefault(event.timer_id, []).append(event)
    return by_timer


def count_ready(timers: Timers, store: Store, now: datetime) -> int:
    """How many timers are ready, for the Timers category's count on the Achievements page."""
    by_timer = _events_by_timer(store)
    return sum(1 for row in store.timers() if timers.state(row, by_timer.get(row.id, []), now) == "ready")


def _achievement(
    preset: Preset | None, catalog: Catalog, notes: AchievementNotes, rows: Mapping[int, ProgressRow],
    counts: Mapping[int, int],
) -> dict[str, Any] | None:
    """The achievement a pre-set serves, with what its card needs to say how far it is: each stage's status, and its
    count when it counts something. `cleared_adds` says whether Cleared adds one to that count, as the hilichurl's does;
    where it does not, as for the items a teapot field gives, the card counts with + and − itself. `rows` and `counts`
    are the progress and the counts, read once for all the timers."""
    first = catalog.stage(preset.stages[0]) if preset is not None and preset.stages else None
    if first is None:
        return None
    counter = notes.counter(catalog, first.group)
    return {
        "id": first.group,
        "name": first.name,
        "stages": [
            {"id": stage.id, "status": rows[stage.id].status if stage.id in rows else "not_started"}
            for stage in catalog.group(first.group)
        ],
        "counter": None if counter is None else {
            "value": counts.get(first.group, 0), "unit": counter.unit, "unit_one": counter.unit_one,
            "targets": list(counter.targets), "cleared_adds": preset.counter == first.group,
        },
    }


def _timer(
    timers: Timers, row: TimerRow, events: Sequence[TimerEvent], catalog: Catalog, notes: AchievementNotes,
    progress: Mapping[int, ProgressRow], counts: Mapping[int, int], fishing: str, now: datetime,
) -> dict[str, Any]:
    preset = timers.preset(row)
    rule = timers.rule(row)
    ready = timers.ready_at(row, events)
    cleared = max((event.at for event in events), default=None)
    if row.ready_override is None:
        started = cleared  # the countdown runs from the latest Cleared
    else:  # Set ready time: a rule of real hours says when the countdown began; a reset gives no start
        hours = length_hours(rule, fishing)
        started = row.ready_override - timedelta(hours=hours) if hours is not None else None
    return {
        "id": row.id,
        "preset": row.preset,
        "own": row.preset is None,
        "name": timers.name(row),
        "place": preset.place if preset is not None else row.place,
        "rule": rule_json(rule),
        "about": timers.about(row) if preset is not None else None,
        "state": timers.state(row, events, now),
        "ready_at": _when(ready),
        "started_at": _when(started),
        "cleared_at": _when(cleared),
        "visits": None if row.steps is None else {"done": len(events), "of": row.steps},
        "bell": row.bell,
        "icon": f"/api/icon/timer.{preset.key}" if preset is not None and preset.icon else None,
        "achievement": _achievement(preset, catalog, notes, progress, counts),
    }


def build_timers(
    timers: Timers, catalog: Catalog, notes: AchievementNotes, store: Store, fishing: str, now: datetime,
    pinned: frozenset[int] = frozenset(),
) -> dict[str, Any]:
    """`pinned` are the timers on the Board as One timer widgets (board/layouts.py), whose cards show Pin to Board
    pressed."""
    by_timer = _events_by_timer(store)
    rows = store.timers()
    progress, counts = store.progress(), store.counters()  # once, not once a timer: the Board reads at every event
    items = [
        {
            **_timer(timers, row, by_timer.get(row.id, []), catalog, notes, progress, counts, fishing, now),
            "pinned": row.id in pinned,
        }
        for row in rows
    ]

    # Ready ones first, those ready longest at the top and those never cleared last; then the running ones, soonest
    # first; then the finished ones.
    def order(item: dict[str, Any]) -> tuple[Any, ...]:
        ready = item["ready_at"]
        return STATE_ORDER[item["state"]], ready is None, ready or "", item["name"]

    in_use = {row.preset for row in rows}
    offers = [
        {"key": preset.key, "name": preset.name, "group": preset.group, "region": preset.region}
        for preset in timers.presets() if preset.key not in in_use
    ]
    return {"fishing": fishing, "timers": sorted(items, key=order), "presets": offers}
