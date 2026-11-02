"""The Daily commissions category's model: a region's commission achievements still to do, the commissions to look for,
and the days each one appeared (spec 11.1), and the address of the region's emblem, which the Board's Commissions to look
for widget draws (look pass spec 9.4)."""
from __future__ import annotations

import collections
from datetime import date, datetime
from typing import Any, Mapping

from guildboard.achievements.catalog import Catalog, Stage
from guildboard.achievements.commissions import commission_stages
from guildboard.achievements.notes import AchievementNotes
from guildboard.config import REGION_NAMES, REGIONS
from guildboard.gameday import game_day
from guildboard.store import ProgressRow, Store, iso


def _when(moment: datetime | None) -> str | None:
    return None if moment is None else iso(moment)


def _done(rows: Mapping[int, ProgressRow]) -> set[int]:
    return {stage_id for stage_id, row in rows.items() if row.status == "done"}


def count_left(catalog: Catalog, notes: AchievementNotes, store: Store, region: str) -> int:
    """How many commission achievements are left in a region, for the Daily commissions category's count on the
    Achievements page."""
    done = _done(store.progress())
    stages = commission_stages(catalog, notes)
    return sum(1 for stage_id, where in stages.items() if where == region and stage_id not in done)


def _hoyolab(store: Store, today: date, server: str) -> dict[str, Any] | None:
    """HoYoLAB's count of the day's finished commissions, from the newest Real-Time Notes when they were read in this
    game day. A count read before the 04:00 reset is the day before's."""
    notes = store.latest_doc("notes")
    if notes is None or game_day(notes[0], server) != today:
        return None
    read_at, doc = notes
    return {"done": int(doc["commissions_done"]), "of": int(doc["commissions_max"]), "at": iso(read_at)}


def _region_icon(store: Store, region: str) -> str | None:
    """The address of the region's emblem, which the icon cache serves: the exploration region of the same name
    (exploration labels are stored with the kind region and the key explore.<id>). A region with a parent is a part of
    another, such as Dragonspine, so only the top-level one counts. None before exploration is read, and when HoYoLAB
    gave the region no picture, as in the demo: the interface then draws the region's sign."""
    name = REGION_NAMES[region]
    for key, label in store.labels("region").items():
        if label.label == name and label.parent_key is None and label.icon_url:
            return f"/api/icon/{key}"
    return None


def _card(
    notes: AchievementNotes, stage: Stage, row: ProgressRow | None, parts_done: Mapping[int, datetime],
    days: Mapping[date, datetime], today: date,
) -> dict[str, Any]:
    note = notes.commissions.get(stage.id)
    parts = notes.parts(stage)
    order = note is not None and note.order
    return {
        "id": stage.id,
        "name": stage.name,
        "description": stage.description,
        "reward": stage.reward,
        # the commission names the list gives, or else the notes'
        "quests": list(stage.quests or (note.quests if note is not None else ())),
        "parts": [
            {"index": index, "name": name, "done_at": _when(parts_done.get(index))} for index, name in enumerate(parts)
        ],
        "order": order,
        # in a chain, the first part not done; parts done in any order have none
        "next_part": next((index for index in range(len(parts)) if index not in parts_done), None) if order else None,
        "how": (note.how or None) if note is not None else None,
        "first": (note.first or None) if note is not None else None,
        "status": "not_started" if row is None else row.status,
        "pinned": row is not None and row.pinned,
        "appeared_today": today in days,
        "last_appeared": max(days).isoformat() if days else None,
    }


def build_commissions(
    catalog: Catalog, notes: AchievementNotes, store: Store, region: str, today: date, server: str, now: datetime
) -> dict[str, Any]:
    if region not in REGIONS:
        raise ValueError(f"unknown region: {region}")
    rows, parts, appearances = store.progress(), store.parts(), store.appearances()
    done = _done(rows)
    regions = commission_stages(catalog, notes)
    left = collections.Counter(where for stage_id, where in regions.items() if stage_id not in done)
    cards = [
        _card(notes, stage, rows.get(stage.id), parts.get(stage.id, {}), appearances.get(stage.id, {}), today)
        for stage in catalog.stages if regions.get(stage.id) == region
    ]
    to_do = [card for card in cards if card["status"] != "done"]
    return {
        "region": region,
        "region_icon": _region_icon(store, region),
        "today": today.isoformat(),
        "regions": [{"key": key, "name": REGION_NAMES[key], "left": left[key]} for key in REGIONS],
        "hoyolab": _hoyolab(store, today, server),
        "looking_for": sorted({quest for card in to_do for quest in card["quests"]}),
        "cards": to_do,
        "done": [card for card in cards if card["status"] == "done"],
    }
