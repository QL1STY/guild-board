"""Each cycle of the three endgame modes, kept on this PC (the Stats design, 3.5): made from the raw archive's bodies of
the three endpoints, written after a sync that read them and filled once from the past, and never a sync kind."""
import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import endgame_samples
from guildboard.characters.demo import demo_endgame_cycles
from guildboard.cloud.sync import BY_TABLE, KINDS
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.endgame_cycles import FILLED, backfill_once, cycles_from_raw, record_latest
from guildboard.records import FetchResult, RawResponse
from guildboard.sources import hoyolab_normalize as norm
from guildboard.sources.demo import DEMO_SERVER
from guildboard.store import Store, iso
from guildboard.sync.policy import PolicyState, due_groups
from guildboard.tokenstore import StoredToken
from support import AccountSource, FakeSleep

UTC = timezone.utc
ABYSS, THEATER, STYGIAN = endgame_samples.abyss(), endgame_samples.theater(), endgame_samples.stygian()
OCT_30 = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)  # the October Theater and Luminous Battlefront are still open
NOV_6 = datetime(2026, 11, 6, 6, 48, tzinfo=UTC)  # both have ended; November's Theater is open
COOKIES = {"ltoken_v2": "v2_SECRET-VALUE-0123456789", "ltuid_v2": "123456"}


def _stamp(seconds: int) -> str:
    return iso(datetime.fromtimestamp(seconds, UTC))


def _october_bodies() -> tuple[dict, dict, dict]:
    """The three answers as they were on 30 October: the Abyss four battles in, October's Theater the current season and
    Luminous Battlefront the newest of the Stygian Onslaught."""
    abyss = {**endgame_samples.abyss(), "total_battle_times": 4, "total_win_times": 4}
    theater = endgame_samples.theater()
    october = theater["data"][1]
    october["schedule"]["schedule_type"] = 1
    theater["data"] = [october]
    stygian = endgame_samples.stygian()
    stygian["data"] = stygian["data"][1:]
    return abyss, theater, stygian


def _november_bodies() -> tuple[dict, dict, dict]:
    """The answers of 6 November, with October's Theater thinner than it was: HoYoLAB keeps less of a season that ended."""
    theater = endgame_samples.theater()
    theater["data"][1]["detail"] = {}
    theater["data"][1]["has_detail_data"] = False
    return endgame_samples.abyss(), theater, endgame_samples.stygian()


def _archive(store: Store, at: datetime, bodies: tuple[dict, dict, dict]) -> None:
    run = store.start_run("startup", at)
    for endpoint, body in zip(("spiralAbyss", "role_combat", "hard_challenge"), bodies):
        store.add_raw(run, "endgame", endpoint, at, body)
    store.finish_run(run, at, "ok")


def _rows(store: Store) -> dict[tuple[str, str], object]:
    return {(row.mode, row.cycle): row for row in store.endgame_cycles()}


# ---------------------------------------------------------------- what a cycle is made of


def test_cycles_from_raw_holds_every_season_with_data():
    rows = cycles_from_raw(ABYSS, THEATER, STYGIAN)
    assert {(r.mode, r.cycle) for r in rows} >= {("stygian", "5269012"), ("theater", "31")}
    assert all(r.mode != "stygian" or r.detail["bosses"] for r in rows)   # a season without data is no cycle
    # October's Theater, an older season with data, is a cycle too; the Stygian season not yet played is none.
    assert {(r.mode, r.cycle) for r in rows} == {
        ("abyss", "124"), ("theater", "31"), ("theater", "30"), ("stygian", "5269012"),
    }


def test_each_cycle_keeps_its_dates_and_its_modes_detail_as_json():
    rows = {(r.mode, r.cycle): r for r in cycles_from_raw(ABYSS, THEATER, STYGIAN, read_at=NOV_6)}
    abyss = rows[("abyss", "124")]
    assert (abyss.starts, abyss.ends, abyss.read_at) == (_stamp(1792119600), _stamp(1794797999), NOV_6)
    assert (abyss.detail["stars"], abyss.detail["battles"], abyss.detail["wins"]) == (36, 6, 6)
    assert abyss.detail["ranks"][0]["kind"] == "strike" and abyss.detail["ranks"][0]["value"] == 1352944
    assert abyss.detail["halves"][0]["foes"][0]["level"] == 88 and ["9-1", 3] in abyss.detail["chambers"]
    october = rows[("theater", "30")]
    assert (october.starts, october.ends) == (_stamp(1790823600), _stamp(1793501999))
    assert october.detail["medals"] == [True] * 10 and october.detail["medal_count"] == 10
    assert (october.detail["difficulty"], october.detail["acts"], october.detail["flowers"]) == ("Visionary", 10, 1180)
    assert october.detail["ranks"][0] == {
        "kind": "damage", "value": 825629, "avatar_id": 10000133,
        "icon": "https://act-webstatic.hoyoverse.com/hk4e/e20200928calculate/item_icon/6a4458ea/fa05b88a6c300212d427cda810d52b94.png",
    }
    stygian = rows[("stygian", "5269012")]
    assert (stygian.starts, stygian.ends) == (_stamp(1790758800), _stamp(1793674799))
    assert (stygian.detail["season"], stygian.detail["seconds"], stygian.detail["difficulty"]) == ("Luminous Battlefront", 280, 5)
    assert stygian.detail["medal"] == "UI_LeyLineChallenge_Medal_5" and stygian.detail["bosses"][0]["icon"].endswith(".png")
    # The dates are the row's own columns, and the next season belongs to no cycle.
    for row in rows.values():
        assert not {"starts", "ends", "next"} & set(row.detail)
        assert json.loads(json.dumps(row.detail)) == row.detail  # as the table gives it back


def test_a_mode_with_nothing_played_has_no_cycle():
    assert cycles_from_raw({**ABYSS, "total_battle_times": 0}, None, None) == []
    assert cycles_from_raw(None, {"data": []}, {"data": []}) == []
    assert cycles_from_raw(None, None, None) == []
    # The library's list of seasons reads as the archive's whole answer does.
    assert cycles_from_raw(None, None, STYGIAN["data"], read_at=NOV_6) == cycles_from_raw(None, None, STYGIAN, read_at=NOV_6)


# ---------------------------------------------------------------- recording and filling


def test_record_latest_writes_the_newest_read_and_keeps_an_ended_cycle_as_last_read(store):
    assert record_latest(store, OCT_30) == 0  # nothing read yet
    _archive(store, OCT_30, _october_bodies())
    assert record_latest(store, OCT_30) == 3
    rows = _rows(store)
    assert set(rows) == {("abyss", "124"), ("theater", "30"), ("stygian", "5269012")}
    assert rows[("abyss", "124")].detail["battles"] == 4 and rows[("abyss", "124")].read_at == OCT_30

    _archive(store, NOV_6, _november_bodies())
    assert record_latest(store, NOV_6) == 2  # the Abyss, still open, and November's Theater, new
    rows = _rows(store)
    assert rows[("abyss", "124")].detail["battles"] == 6 and rows[("abyss", "124")].read_at == NOV_6
    assert rows[("theater", "31")].read_at == NOV_6
    # October's Theater and Luminous Battlefront ended before the second read: they stay as read while they were open.
    assert rows[("theater", "30")].read_at == OCT_30 and rows[("theater", "30")].detail["ranks"]
    assert rows[("stygian", "5269012")].read_at == OCT_30


def test_a_cycle_first_read_after_its_end_is_kept_as_that_read(store):
    _archive(store, NOV_6, _november_bodies())
    assert record_latest(store, NOV_6) == 4
    assert _rows(store)[("theater", "30")].read_at == NOV_6
    assert record_latest(store, NOV_6 + timedelta(hours=3)) == 2  # the Abyss and November's Theater, both open, again


def test_backfill_runs_once_and_keeps_an_ended_cycle_as_last_read(store, clock):
    clock.set(NOV_6 + timedelta(hours=1))
    _archive(store, OCT_30, _october_bodies())
    _archive(store, NOV_6, _november_bodies())
    assert backfill_once(store, clock.now()) == 5  # three on 30 October, then the Abyss again and November's Theater
    rows = _rows(store)
    assert set(rows) == {("abyss", "124"), ("theater", "30"), ("theater", "31"), ("stygian", "5269012")}
    assert rows[("abyss", "124")].read_at == NOV_6 and rows[("abyss", "124")].detail["battles"] == 6
    assert rows[("theater", "30")].read_at == OCT_30 and rows[("theater", "30")].detail["seconds"] == 544
    assert rows[("stygian", "5269012")].read_at == OCT_30
    assert store.meta(FILLED) == iso(clock.now())
    # Once only: what the archive holds later is the syncs' to record.
    _archive(store, NOV_6 + timedelta(days=1), _november_bodies())
    assert backfill_once(store, clock.now()) == 0
    assert _rows(store) == rows


def test_an_empty_archive_is_filled_once_too(store, clock):
    assert backfill_once(store, clock.now()) == 0 and store.meta(FILLED) is not None
    assert store.endgame_cycles() == []


def test_the_cycles_are_ordered_by_their_end(store):
    _archive(store, NOV_6, _november_bodies())
    record_latest(store, NOV_6)
    ends = [row.ends for row in store.endgame_cycles()]
    assert ends == sorted(ends) and [row.cycle for row in store.endgame_cycles("theater")] == ["30", "31"]


def test_the_cycle_table_is_not_a_sync_kind():
    assert "endgame_cycles" not in BY_TABLE
    assert all(kind.table != "endgame_cycles" for kind in KINDS)


# ---------------------------------------------------------------- the core


def _endgame_result(at: datetime) -> FetchResult:
    raw = (RawResponse("spiralAbyss", ABYSS), RawResponse("role_combat", THEATER), RawResponse("hard_challenge", STYGIAN))
    record = replace(
        norm.normalize_endgame(ABYSS, THEATER, STYGIAN["data"]),
        detail=norm.normalize_endgame_detail(ABYSS, THEATER, STYGIAN["data"]),
    )
    return FetchResult("endgame", at, raw, record)


def _live_core(paths: AppPaths, clock, source=None) -> Core:
    return Core(paths, demo=False, clock=clock, source=source or AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())


async def test_a_live_core_keeps_the_cycles_a_sync_reads(tmp_path, clock):
    clock.set(NOV_6)
    source = AccountSource()
    source.will("endgame", _endgame_result(NOV_6))
    core = _live_core(AppPaths(tmp_path / "data"), clock, source)
    try:
        core.tokens.save(StoredToken(dict(COOKIES), 700000001, "os_euro", "Traveler"))
        assert core.store.endgame_cycles() == []
        await core.scheduler.trigger("manual")
        assert ("endgame", False) in source.calls
        assert {(row.mode, row.cycle) for row in core.store.endgame_cycles()} == {
            ("abyss", "124"), ("theater", "31"), ("theater", "30"), ("stygian", "5269012"),
        }
    finally:
        core.store.close()


def test_a_live_core_fills_the_cycles_from_the_archive_once_at_start(tmp_path, clock):
    clock.set(NOV_6 + timedelta(hours=1))
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    store = Store.open(paths.db_path, paths.backups_dir, clock.now())
    _archive(store, OCT_30, _october_bodies())
    store.close()
    core = _live_core(paths, clock)
    try:
        assert {(row.mode, row.cycle) for row in core.store.endgame_cycles()} == {
            ("abyss", "124"), ("theater", "30"), ("stygian", "5269012"),
        }
        assert core.store.meta(FILLED) is not None
    finally:
        core.store.close()


def _due(store: Store, now: datetime) -> tuple[str, ...]:
    return due_groups(PolicyState(now, None, None, 0, store.group_states(), False, None, "os_euro"))


def test_the_first_start_after_the_update_reads_the_endgame_again_once(tmp_path, clock):
    # 1.0.1 read the endgame an hour ago, and kept a detail without the Endgame card's fields: the first start of this
    # version makes the endgame due, so that the next sync reads it again however recent that read is.
    clock.set(NOV_6)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    store = Store.open(paths.db_path, paths.backups_dir, clock.now())
    store.mark_group_ok("endgame", NOV_6 - timedelta(hours=1))
    assert "endgame" not in _due(store, NOV_6)
    store.close()
    core = _live_core(paths, clock)
    try:
        assert "endgame" in _due(core.store, NOV_6)
        core.store.mark_group_ok("endgame", NOV_6)  # as the next sync does
    finally:
        core.store.close()
    # Once only: the starts after it leave the endgame to its 12 hours.
    clock.advance(hours=1)
    again = _live_core(paths, clock)
    try:
        assert "endgame" not in _due(again.store, clock.now())
    finally:
        again.store.close()


def test_the_demo_keeps_the_current_cycle_of_each_mode_and_two_before(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        now = iso(clock.now())
        for mode in ("abyss", "theater", "stygian"):
            rows = core.store.endgame_cycles(mode)
            assert len(rows) == 3, mode
            assert rows[-1].starts <= now <= rows[-1].ends, mode  # the current one, last
            assert all(earlier.ends < later.starts for earlier, later in zip(rows, rows[1:])), mode
        assert core.store.endgame_cycles() == sorted(core.store.endgame_cycles(), key=lambda row: row.ends)
    finally:
        core.store.close()


def test_the_demos_cycles_have_no_pictures():
    # The demo has no pictures (the Characters plan): every icon of its cycles is empty, and its pages draw their signs.
    rows = demo_endgame_cycles(datetime(2026, 11, 6, 6, 0, tzinfo=UTC), DEMO_SERVER)
    assert {row.mode for row in rows} == {"abyss", "theater", "stygian"} and len(rows) == 9

    def icons(value: object) -> list[str]:
        if isinstance(value, dict):
            return [v for k, v in value.items() if k == "icon"] + [i for v in value.values() for i in icons(v)]
        if isinstance(value, list):
            return [i for v in value for i in icons(v)]
        return []

    found = [icon for row in rows for icon in icons(row.detail)]
    assert found and set(found) == {""}
    abyss = next(row for row in rows if row.mode == "abyss")
    assert abyss.detail["ranks"] and abyss.detail["halves"][0]["foes"]
