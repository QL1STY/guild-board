"""Store one fetch result: raw archive, points, labels and the group's latest document."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict

from guildboard import metrics
from guildboard.gameday import game_day
from guildboard.metrics import DIARY_PREFIX, Label, Point
from guildboard.records import (
    CharactersRecord,
    DiaryRecord,
    EndgameRecord,
    FetchResult,
    NotesRecord,
    OverviewRecord,
    Record,
)
from guildboard.store import DiaryActionRow, Store


# The characters group's raw bodies are large (every character's build), so the archive keeps only the newest few.
CHARACTERS_RAW_KEPT = 10


def _points_for(store: Store, record: Record) -> tuple[list[Point], list[Label]]:
    if isinstance(record, OverviewRecord):
        return metrics.overview(record)
    if isinstance(record, NotesRecord):
        return metrics.notes(record), metrics.notes_labels(record)
    if isinstance(record, CharactersRecord):
        return metrics.characters(record), []
    if isinstance(record, EndgameRecord):
        return metrics.endgame(record), []
    if isinstance(record, DiaryRecord):
        return metrics.diary(record, store.latest_values(DIARY_PREFIX)), []
    return [], []


def diary_actions(record: DiaryRecord) -> list[DiaryActionRow]:
    """The diary's detail entries as the store keeps them: identical entries of the same second numbered from 0, so
    that reading the same month again keeps nothing twice."""
    seen: Counter[tuple[str, str, int]] = Counter()
    rows = []
    for entry in record.entries:
        twin = (entry.time, entry.action, entry.amount)
        rows.append(DiaryActionRow(record.uid, entry.time, entry.at, entry.action, entry.amount, seen[twin]))
        seen[twin] += 1
    return rows


def apply_result(store: Store, run_id: int, result: FetchResult, server: str) -> None:
    for raw in result.raw:
        store.add_raw(run_id, result.group, raw.endpoint, result.fetched_at, raw.body)
    if result.group == "characters" and result.raw:
        store.trim_raw("characters", CHARACTERS_RAW_KEPT)
    if result.raw:
        store.trim_old_raw(result.fetched_at, lambda when: game_day(when, server))
    if result.record is None:
        return
    points, labels = _points_for(store, result.record)
    if points:
        store.add_points(run_id, result.fetched_at, game_day(result.fetched_at, server), points)
    if labels:
        store.upsert_labels(labels, result.fetched_at)
    doc = asdict(result.record)
    if isinstance(result.record, DiaryRecord):
        if result.record.entries and result.record.uid:
            store.keep_diary_actions(result.record.uid, diary_actions(result.record))
        doc.pop("entries", None)  # kept in their own table, not in the latest document
    store.set_latest_doc(result.group, result.fetched_at, doc)
