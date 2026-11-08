"""Each cycle of the three endgame modes, kept on this PC (the Stats design, 3.5).

Only the newest endgame detail is kept with the group's latest document, and the Months and the Year need every cycle of
the year. So each cycle the player has a record in gets a row of `endgame_cycles`, made from the raw archive's bodies of
the three endpoints: after a sync that read them (`record_latest`), and once from the days the archive kept before this
table was there (`backfill_once`). The raw archive is read here and nowhere else.

A row is replaced while its cycle is open; a cycle that has ended stays as last read while it was open, for HoYoLAB keeps
less of a season once it is over. The table is no sync kind: it is made of HoYoLAB's responses, which never go to the
online project.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from guildboard.records import EndgameDetailRecord
from guildboard.sources.hoyolab_normalize import normalize_endgame_cycles
from guildboard.store import EndgameCycleRow, Store, iso, parse_iso

GROUP = "endgame"
# The modes in the order the three endpoints are named, each with its endpoint in the raw archive.
ENDPOINTS = (("abyss", "spiralAbyss"), ("theater", "role_combat"), ("stygian", "hard_challenge"))
FILLED = "endgame_cycles_filled"  # meta: when the table was filled from the archive, which is done once
_OWN_COLUMNS = ("starts", "ends", "next")  # the detail's fields a row keeps apart, or not at all


def cycle_row(mode: str, cycle: str, record: EndgameDetailRecord, read_at: datetime) -> EndgameCycleRow | None:
    """The row of a cycle of `mode` from an endgame detail that holds it: the detail's fields of the mode without the
    mode's prefix, as JSON, and its dates as columns of their own. None when the cycle has no dates, which leave it no
    place among the others."""
    prefix = f"{mode}_"
    fields = {name[len(prefix):]: value for name, value in asdict(record).items() if name.startswith(prefix)}
    starts, ends = fields.get("starts"), fields.get("ends")
    if not starts or not ends:
        return None
    detail = {name: value for name, value in fields.items() if name not in _OWN_COLUMNS}
    return EndgameCycleRow(mode, cycle, starts, ends, json.loads(json.dumps(detail)), read_at)


def cycles_from_raw(
    abyss_raw: Any, theater_raw: Any, stygian_raw: Any, read_at: datetime | None = None,
) -> list[EndgameCycleRow]:
    """Every cycle the three answers hold in which the player has a record, the older Theater and Stygian seasons too,
    as rows read at `read_at` (now, when it is not given). An answer may be None."""
    at = read_at or datetime.now(timezone.utc)
    cycles = normalize_endgame_cycles(abyss_raw, theater_raw, stygian_raw)
    found = (cycle_row(mode, cycle, record, at) for mode, cycle, record in cycles)
    return [row for row in found if row is not None]


def _keep(store: Store, rows: list[EndgameCycleRow], kept: dict[tuple[str, str], EndgameCycleRow]) -> int:
    """Write the rows that are news: a cycle not kept yet, or one read again while it is open, by a read no older than
    the one kept. `kept` follows what is written. How many were written."""
    written = 0
    for row in rows:
        before = kept.get((row.mode, row.cycle))
        if before is not None and not (before.read_at <= row.read_at <= parse_iso(row.ends)):
            continue
        store.put_endgame_cycle(row)
        kept[(row.mode, row.cycle)] = row
        written += 1
    return written


def _kept(store: Store) -> dict[tuple[str, str], EndgameCycleRow]:
    return {(row.mode, row.cycle): row for row in store.endgame_cycles()}


def _answers(mode: str, body: Any) -> tuple[Any, Any, Any]:
    """One endpoint's answer in its place among the three."""
    abyss, theater, stygian = (body if name == mode else None for name, _ in ENDPOINTS)
    return abyss, theater, stygian


def record_latest(store: Store, now: datetime) -> int:
    """After a sync that read the endgame: the cycles of the newest body of each endpoint, as read `now`. How many rows
    were written."""
    rows = []
    for mode, endpoint in ENDPOINTS:
        newest = store.raw_bodies_of(GROUP, endpoint, limit=1)
        if newest:
            rows += cycles_from_raw(*_answers(mode, newest[0][1]), read_at=now)
    with store.transaction():
        return _keep(store, rows, _kept(store))


def backfill_once(store: Store, now: datetime) -> int:
    """Once for a database: every body the archive kept of the three endpoints, oldest first, each as read when it was
    fetched, so that each cycle stays as last read while it was open. Nothing is done again once it was, whatever the
    archive holds later: that is the syncs' to record. How many rows were written.

    That once is the first start after the update that brought the table, and the endgame detail kept then is the older
    version's, without the Endgame card's fields: the endgame group is made due as well, so that the next sync reads it
    again whatever its 12 hours say (the mark a failed read leaves, which the next good read clears)."""
    if store.meta(FILLED) is not None:
        return 0
    kept = _kept(store)
    written = 0
    with store.transaction():
        for mode, endpoint in ENDPOINTS:
            for read_at, body in store.raw_bodies_of(GROUP, endpoint):
                written += _keep(store, cycles_from_raw(*_answers(mode, body), read_at=read_at), kept)
        store.mark_group_failed(GROUP)
        store.set_meta(FILLED, iso(now))
    return written
