import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.achievements.catalog import bundled_catalog, version_key
from guildboard.achievements.notes import load_notes
from guildboard.achievements.progress import Progress
from guildboard.history import History
from guildboard.records import (
    GROUPS,
    CalendarRecord,
    CharactersRecord,
    DiaryRecord,
    EndgameRecord,
    NotesRecord,
    Offline,
    OverviewRecord,
)
from guildboard.sources import demo
from guildboard.sources.demo import (
    DEMO_ACCOUNT, DEMO_SERVER, DemoSource, build, seed_achievements, seed_appearances, seed_banners, seed_board,
    seed_history, seed_timers, seed_wishes,
)
from guildboard.board.layouts import Layouts
from guildboard.gameday import game_day, server_tz
from guildboard.metrics import EARNED_KEY, MONTH_PREFIX, Point, diary_sources
from guildboard.pulls import ALL_POOLS
from guildboard.config import AppPaths
from guildboard.core import Core
from support import FakeSleep
from guildboard.store import Store, iso
from guildboard.timers.presets import load_presets
from guildboard.timers.timers import Timers

UTC = timezone.utc
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)


def test_same_instant_gives_the_same_data():
    for group in GROUPS:
        assert build(group, NOW) == build(group, NOW)


def test_counters_never_go_down():
    previous = build("overview", NOW - timedelta(days=30))
    moment = NOW - timedelta(days=30)
    while moment < NOW:
        moment += timedelta(hours=6)
        current = build("overview", moment)
        for name, value in previous.counters.items():
            assert current.counters[name] >= value, (name, moment)
        before = {region.id: region.pct for region in previous.regions}
        for region in current.regions:
            assert region.pct >= before.get(region.id, 0.0), (region.name, moment)
        previous = current


def test_overview_shape():
    overview = build("overview", NOW)
    assert isinstance(overview, OverviewRecord)
    assert overview.nickname == DEMO_ACCOUNT.nickname
    assert overview.server == DEMO_SERVER
    assert {name for name in overview.counters if name.startswith("chests.")} == {
        "chests.common", "chests.exquisite", "chests.precious", "chests.luxurious", "chests.remarkable",
    }
    assert "oculi.cryo" in overview.counters
    by_name = {region.name: region for region in overview.regions}
    assert 0 < by_name["Snezhnaya"].pct < 100
    assert by_name["Fontaine"].pct == 100.0
    assert by_name["Chenyu Vale"].parent_id == by_name["Liyue"].id
    for region in overview.regions:
        assert 0.0 <= region.pct <= 100.0
        for area in region.areas:
            assert 0.0 <= area.pct <= 100.0


def test_snezhnaya_appears_when_it_opens():
    before = build("overview", datetime(2026, 8, 11, 12, 0, tzinfo=UTC))
    after = build("overview", datetime(2026, 8, 13, 12, 0, tzinfo=UTC))
    assert "Snezhnaya" not in {region.name for region in before.regions}
    assert "oculi.cryo" not in before.counters
    assert "Snezhnaya" in {region.name for region in after.regions}
    assert "oculi.cryo" in after.counters


def test_each_group_builds_its_record_type():
    expected = {
        "overview": OverviewRecord,
        "notes": NotesRecord,
        "characters": CharactersRecord,
        "endgame": EndgameRecord,
        "diary": DiaryRecord,
        "calendar": CalendarRecord,
    }
    for group, record_type in expected.items():
        assert isinstance(build(group, NOW), record_type)
    endgame = build("endgame", NOW)
    assert [mode.mode for mode in endgame.modes] == ["abyss", "theater", "stygian"]
    assert endgame.modes[0].period_start == "2026-09-16T03:00:00+00:00"
    assert endgame.modes[0].period_end == "2026-10-16T02:59:59+00:00"


def test_unknown_group_is_rejected():
    with pytest.raises(ValueError):
        build("inventory", NOW)


def test_diary_first_time_reads_one_more_month():
    usual = build("diary", NOW)
    first = build("diary", NOW, first_time=True)
    assert [(m.year, m.month) for m in usual.months] == [(2026, 9), (2026, 10)]
    assert [(m.year, m.month) for m in first.months] == [(2026, 8), (2026, 9), (2026, 10)]
    for month in first.months:
        assert sum(source.amount for source in month.sources) == month.primogems


def test_the_demo_notes_carry_five_expeditions_the_transformer_and_realm_currencys_time():
    record = build("notes", NOW)
    assert (len(record.expeditions), record.expeditions_max) == (5, 5)
    assert [expedition.back_at is None for expedition in record.expeditions] == [True, True, True, False, False]
    assert [expedition.back_at for expedition in record.expeditions[3:]] == [
        "2026-10-13T10:00:00+00:00", "2026-10-13T13:30:00+00:00",
    ]
    assert (record.transformer_obtained, record.transformer_ready_at) == (True, "2026-10-16T12:00:00+00:00")
    assert record.realm_currency_full_at == "2026-10-13T18:00:00+00:00"
    assert {expedition.icon_url for expedition in record.expeditions} == {""}  # the demo downloads no pictures


async def test_fetch_wraps_the_record_with_a_raw_copy():
    result = await DemoSource().fetch("notes", now=NOW)
    assert result.group == "notes"
    assert result.fetched_at == NOW
    assert result.record == build("notes", NOW)
    assert result.raw[0].endpoint == "demo/notes"
    assert result.raw[0].body["resin_max"] == 200
    assert await DemoSource().list_accounts({}) == [DEMO_ACCOUNT]


async def test_fault_is_raised():
    source = DemoSource()
    source.fault = Offline("No connection.")
    with pytest.raises(Offline):
        await source.fetch("overview", now=NOW)


def test_seed_history_fills_ninety_days(store):
    seed_history(store, NOW)
    history = History(store)
    assert history.tracking_since() == date(2026, 7, 15)
    assert store.runs_since(datetime(2026, 1, 1, tzinfo=UTC)) == 85
    assert store.value_at_or_before("stats.achievements", date(2026, 10, 12)) is not None
    assert store.day_values(["stats.achievements"], date(2026, 10, 13), date(2026, 10, 13)) == {"stats.achievements": {}}
    days = history.daily_change(["stats.days_active"], date(2026, 7, 15), date(2026, 10, 12))
    gaps = [day.day.isoformat() for day in days if not day.has_data]
    assert gaps == ["2026-07-17", "2026-07-28", "2026-07-29", "2026-08-22", "2026-09-19"]
    assert set(store.group_states()) == set(GROUPS)
    assert all(not state.needs_retry for state in store.group_states().values())
    playtime = history.playtime_minutes(date(2026, 9, 13), date(2026, 10, 12), DEMO_SERVER)
    assert 20 * 60 < sum(playtime.values()) < 60 * 60
    assert store.latest_point_value("diary.primogems.earned") > 0


def test_the_demo_diary_has_sources(store):
    seed_history(store, NOW)
    months = {key[len(MONTH_PREFIX):] for key, total in store.latest_values(MONTH_PREFIX).items() if total > 0}
    sources = diary_sources(store)
    assert {"2026-08", "2026-09", "2026-10"} <= months  # the months the next version's estimate reads from
    for month in months:
        names = set(sources[month])
        assert any("event" in name for name in names), month
        assert any("quest" in name for name in names), month
        assert sum(sources[month].values()) == store.latest_point_value(f"{MONTH_PREFIX}{month}"), month
    # Each source is a made-up part of the month, named as HoYoLAB's diary names them.
    assert {name for month in sources.values() for name in month} <= {
        "events", "quests", "daily_activity", "spiral_abyss", "adventure", "mail", "other",
    }


def test_seeding_is_deterministic():
    first, second = Store.in_memory(), Store.in_memory()
    seed_history(first, NOW)
    seed_history(second, NOW)
    for key in ("stats.chests.common", "explore.13.pct", "diary.primogems.earned", "stats.days_active"):
        assert first.latest_point_value(key) == second.latest_point_value(key)
    assert first.last_session() == second.last_session()
    first.close()
    second.close()


def test_seeding_is_one_transaction(store):
    commits: list[str] = []
    store._conn.set_trace_callback(lambda sql: commits.append(sql) if sql.strip().upper().startswith("COMMIT") else None)
    seed_history(store, NOW)
    assert len(commits) == 1


def test_an_interrupted_seed_leaves_nothing(store, monkeypatch):
    calls = {"count": 0}
    real_build = demo.build

    def failing_build(group, now, first_time=False):
        calls["count"] += 1
        if calls["count"] == 40:
            raise RuntimeError("interrupted")
        return real_build(group, now, first_time)

    monkeypatch.setattr(demo, "build", failing_build)
    with pytest.raises(RuntimeError):
        seed_history(store, NOW)
    assert store.first_game_day() is None
    assert store.recent_runs() == []
    assert store.last_session() is None


async def test_a_slow_demo_account_takes_its_time():
    source = DemoSource()
    assert source.delay == 0.0
    source.delay = 0.05
    started = time.perf_counter()
    await source.fetch("notes", now=NOW)
    assert time.perf_counter() - started >= 0.04


def test_the_demo_progress_is_made_up_the_same_way_every_time(store):
    catalog = bundled_catalog()
    now = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    seed_achievements(store, catalog, now)
    rows = store.progress()
    assert all(rows.get(s.id) is None or rows[s.id].status != "done" for s in catalog.stages if version_key(s.version) >= (7, 0))
    assert {i for i, r in rows.items() if r.pinned} == {84508, 84512, 82057}
    assert store.counters() == {82055: 37, 84512: 3}
    assert store.parts() == {84508: {0: now, 1: now}}
    assert rows[84508].note == "Little Fei is the last one."
    done = sum(1 for r in rows.values() if r.status == "done")
    other = Store.in_memory()
    seed_achievements(other, catalog, now)
    assert sum(1 for r in other.progress().values() if r.status == "done") == done
    other.close()


def test_the_demo_progress_is_one_transaction_that_clears_the_undo_history(store):
    store.push_change("Ticked Zoo Tycoon", {"progress": {}, "parts": {}, "counters": {}}, NOW)
    commits: list[str] = []
    store._conn.set_trace_callback(lambda sql: commits.append(sql) if sql.strip().upper().startswith("COMMIT") else None)
    seed_achievements(store, bundled_catalog(), NOW)
    assert len(commits) == 1
    assert store.pop_change() is None  # an undo cannot reach back past the rows the seeding wrote


def test_the_demo_timers_and_days_are_each_one_transaction_that_clears_the_undo_history(store, clock):
    catalog, notes = bundled_catalog(), load_notes()
    timers = Timers(store, clock, Progress(store, lambda: catalog, notes, clock), load_presets(), lambda: DEMO_SERVER,
                    lambda: "3_days")
    commits: list[str] = []
    store._conn.set_trace_callback(lambda sql: commits.append(sql) if sql.strip().upper().startswith("COMMIT") else None)
    for seed in (lambda: seed_timers(store, timers, NOW), lambda: seed_appearances(store, catalog, notes, NOW)):
        store.push_change("Ticked Zoo Tycoon", {"progress": {}, "parts": {}, "counters": {}}, NOW)
        commits.clear()
        seed()
        assert len(commits) == 1
        assert store.pop_change() is None  # an undo cannot reach back past the rows the seeding wrote
    # With no default pre-set in use, the seeding adds every one it needs.
    assert sorted(row.preset or row.name for row in store.timers()) == [
        "Parametric Transformer", "Shrine visits", "fishing.cider_lake_1", "fishing.luhua_pool", "hilichurl",
        "teapot.jade_field", "teapot.luxuriant_glebe", "teapot.orderly_meadow",
    ]
    assert len(store.appearances()) == 3


def test_the_demo_board_holds_a_note_once(store, clock):
    layouts = Layouts(store, clock)
    seed_board(store, layouts)
    assert layouts.data("start-notes") == {"text": "Fishing: Luhua Pool comes back on Friday."}
    layouts.put_data("start-notes", {"text": "Mine now"})
    seed_board(store, layouts)  # a later start
    assert layouts.data("start-notes") == {"text": "Mine now"}


def test_a_demo_core_starts_with_its_note(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core.layouts.data("start-notes") == {"text": "Fishing: Luhua Pool comes back on Friday."}
    finally:
        core.store.close()


# ---------------------------------------------------------------------------------------------- Pulls (the Pulls plan, Task 5)


def _server_day(moment: datetime) -> date:
    return moment.astimezone(server_tz(DEMO_SERVER)).date()


def test_the_demo_history_is_the_same_every_time_and_once(store):
    uid = DEMO_ACCOUNT.uid
    seed_wishes(store, NOW)
    rows = store.wishes(uid)
    assert len(rows) == 387
    assert Counter(row.pool for row in rows) == {"character": 219, "weapon": 23, "standard": 120, "chronicled": 5, "novice": 20}
    assert sum(1 for row in rows if row.gacha_type == "400") == 21  # every tenth of the character event's
    assert [row.id for row in rows] == [1_700_000_000_000_000_000 + n for n in range(1, 388)]
    assert [row.at for row in rows] == sorted(row.at for row in rows)  # the ids grow with the times
    assert (_server_day(rows[0].at), _server_day(rows[-1].at)) == (date(2026, 5, 16), date(2026, 10, 12))
    assert all(row.time == row.at.astimezone(server_tz(DEMO_SERVER)).strftime("%Y-%m-%d %H:%M:%S") for row in rows)
    fives = [(row.pool, row.name, _server_day(row.at)) for row in rows if row.rank == 5]
    assert fives == [
        ("character", "Skirk", date(2026, 6, 24)),
        ("standard", "Wolf's Gravestone", date(2026, 8, 15)),
        ("character", "Qiqi", date(2026, 9, 2)),
    ]
    character = store.wishes(uid, "character")
    assert [n for n, row in enumerate(character, start=1) if row.rank == 5] == [77, 158]
    assert max(n for n, row in enumerate(character, start=1) if row.rank == 4) == 212
    assert [row.name for row in character if row.rank == 4][:4] == ["Bennett", "Xingqiu", "Fischl", "Sucrose"]
    assert [row.name for row in character if row.rank == 3][:3] == ["Cool Steel", "Harbinger of Dawn", "Slingshot"]
    weapon = store.wishes(uid, "weapon")
    assert [n for n, row in enumerate(weapon, start=1) if row.rank >= 4] == [10, 20]
    assert _server_day(weapon[0].at) == date(2026, 10, 1)
    assert _server_day(store.wishes(uid, "standard")[0].at) == date(2026, 5, 20)
    assert {_server_day(row.at) for row in store.wishes(uid, "chronicled")} == {date(2026, 7, 2)}
    novice = store.wishes(uid, "novice")
    assert ({_server_day(row.at) for row in novice}, novice[9].name, novice[9].rank) == ({date(2026, 5, 16)}, "Noelle", 4)

    [run] = store.wish_imports()
    assert (run.outcome, run.uid, run.found, run.pages, run.pools, run.started_at) == ("ok", uid, 387, 20, ALL_POOLS, NOW)
    account = store.pulls_account(uid)
    window = iso(NOW - timedelta(days=180))  # the window the seeded run gives, which the corrections are for
    assert account.corrections == {pool: {"pity": 0, "guaranteed": False, "from": window} for pool in ALL_POOLS}
    assert (account.charted_weapon, account.chronicled_path) == ("Azurelight", "")
    assert (account.balance_primogems, account.balance_fates, account.balance_set_at) == (9840, 14, NOW)
    [entry] = store.wishlist(uid)
    assert (entry.name, entry.kind, entry.about, entry.copies) == ("Citlali", "character", date(2026, 11, 11), 1)

    seed_wishes(store, NOW + timedelta(days=1))  # a later start seeds nothing
    assert (store.wish_count(uid), len(store.wish_imports()), len(store.wishlist(uid))) == (387, 1, 1)
    other = Store.in_memory()
    seed_wishes(other, NOW)
    assert other.wishes(uid) == rows
    other.close()


def test_the_demo_s_dates_follow_the_seed_s_now(store):
    # Started on the real clock, the demo has a running banner and a history up to yesterday, as it has at the tests'
    # now, where every time is the one the brief gives.
    uid, later = DEMO_ACCOUNT.uid, NOW + timedelta(days=40, hours=5, minutes=7, seconds=3)
    shift = later - NOW
    other = Store.in_memory()
    for into, now in ((store, NOW), (other, later)):
        seed_wishes(into, now)
        seed_banners(into, now)
    first, second = store.wishes(uid), other.wishes(uid)
    assert [b.at - a.at for a, b in zip(first, second)] == [shift] * 387
    assert [(a.id, a.name, a.rank, a.gacha_type) for a in first] == [(b.id, b.name, b.rank, b.gacha_type) for b in second]
    assert all(row.time == row.at.astimezone(server_tz(DEMO_SERVER)).strftime("%Y-%m-%d %H:%M:%S") for row in second)
    assert [(b.starts_at - a.starts_at, b.ends_at - a.ends_at) for a, b in zip(store.banners(), other.banners())] == [
        (shift, shift)
    ] * 3
    [run] = other.wish_imports()
    account = other.pulls_account(uid)
    assert (run.started_at, account.balance_set_at) == (later, later)
    assert account.corrections["weapon"]["from"] == iso(later - timedelta(days=180))
    [entry] = other.wishlist(uid)
    assert entry.about == date(2026, 11, 11) + timedelta(days=40)  # forty game days on
    other.close()


def test_the_demo_wishes_and_banners_are_each_one_transaction(store):
    commits: list[str] = []
    store._conn.set_trace_callback(lambda sql: commits.append(sql) if sql.strip().upper().startswith("COMMIT") else None)
    seed_wishes(store, NOW)
    assert len(commits) == 1
    commits.clear()
    seed_banners(store, NOW)
    assert len(commits) == 1


def test_the_demo_cards_read_as_the_mockup(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        model = core.pulls.model()
        assert (model["uid"], model["account_uid"]) == (DEMO_ACCOUNT.uid, DEMO_ACCOUNT.uid)
        character, weapon, standard, chronicled = model["pity"]
        assert (character["pity"], character["known"], character["guarantee"], character["four"]) == (61, True, "guaranteed", 7)
        assert (weapon["pity"], weapon["known"], weapon["path"]) == (23, True, {"item": "Azurelight", "points": 0, "max": 1})
        assert (standard["pity"], standard["known"]) == (44, True)
        assert (chronicled["pity"], chronicled["path"]) == (5, {"item": "", "points": 0, "max": 1})
        history = model["history"]
        # Three 5★ in all; the average reads the character event's two, Skirk at 77 and Qiqi at 81.
        assert (history["count"], history["fives"], history["average_pity"], history["won"], history["lost"]) == (387, 3, 79, 1, 1)
        assert model["savings"]["pulls"] == 75
        assert [entry["name"] for entry in model["wishlist"]] == ["Citlali"]
        assert [entry["banner"]["name"] for entry in model["planner"]] == [
            "Void Star's Advent", "La Chanson Cerise", "Epitome Invocation",
        ]
        # A sync on the day the balance was set adds that day's income to the diary. It was earned before the balance
        # was typed, so the balance holds it already (ruling R16): still 75 pulls.
        earned = core.store.latest_point_value(EARNED_KEY) or 0.0
        today = game_day(NOW, DEMO_SERVER)
        core.store.add_points(None, NOW + timedelta(minutes=5), today, [Point(EARNED_KEY, earned + 260.0)])
        assert core.pulls.model()["savings"]["pulls"] == 75
    finally:
        core.store.close()


def test_the_demo_has_the_welkin_moon_and_its_next_version_comes_from_the_made_up_diary(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core.store.pulls_account(DEMO_ACCOUNT.uid).welkin is True
        assert core.store.pulls_account(DEMO_ACCOUNT.uid).gnostic_hymn is False
        savings = core.pulls.model()["savings"]
        assert savings["owned"] == {"welkin": True, "gnostic_hymn": False}
        ledger = savings["next"]
        assert (ledger["number"], ledger["starts_on"], ledger["ends_on"]) == ("7.2", "2026-11-04", "2026-12-16")
        # August's and September's events and quests of the made-up diary, 4,788 and 2,013 over their 61 days, times 42.
        assert [(row["key"], row["primogems"], row["on"], row["estimated"]) for row in ledger["rows"]] == [
            ("commissions", 2520, True, False), ("events", 3290, True, True), ("endgame", 3050, True, False),
            ("update", 600, True, False), ("quests", 1380, True, True), ("welkin", 3780, True, False),
            ("gnostic_hymn", 680, False, False),
        ]
        assert (ledger["primogems"], ledger["fates"], ledger["pulls"], ledger["events_typed"]) == (14620, 0, 91, None)
    finally:
        core.store.close()


def test_the_demo_banners_end_ten_days_after_the_demo_start(store):
    seed_banners(store, NOW)
    banners = store.banners()
    assert [(banner.name, banner.pool, banner.featured) for banner in banners] == [
        ("Void Star's Advent", "character", ("Skirk",)),
        ("La Chanson Cerise", "character", ("Escoffier",)),
        ("Epitome Invocation", "weapon", ("Azurelight", "Symphonist of Scents")),
    ]
    for banner in banners:
        assert (banner.starts_at, banner.ends_at) == (datetime(2026, 9, 23, 5, tzinfo=UTC), datetime(2026, 10, 24, 6, tzinfo=UTC))
        assert (banner.art_url, banner.read_at) == ("", NOW)  # the demo downloads nothing
        assert banner.ends_at - NOW == timedelta(days=10, hours=22)
    seed_banners(store, NOW + timedelta(days=1))  # a later start keeps them as they are
    assert store.banners() == banners
