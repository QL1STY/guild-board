"""The month model (the Stats design, section 5): the five numbers, the records and the parts of a month, each only where
its source reaches the month."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.gameday import game_day_start
from guildboard.history import History
from guildboard.metrics import MONTH_PREFIX, Point
from guildboard.store import EndgameCycleRow, LedgerRow, ProgressRow, WikiItemRow, WishRow
from guildboard.pulls.rules import Wish, pool_state
from guildboard.views import months
from guildboard.views.months import build_month, first_month, month_list, ticked_achievement_days
from guildboard.views.stats import build_stats
from support import AccountSource, FakeSleep

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))
TODAY = date(2026, 11, 6)


LATER = {
    "part": "Playtime and achievements", "since": "19 Oct 2026",
    "text": "Playtime and achievements are tracked from 19 Oct 2026.",
}
# The endgame's note names its first cycle whole, never joined with the others (a cycle counts in the month it ends).
ENDGAME_LATER = {
    "part": "Endgame", "since": "19 Oct 2026",
    "text": "Endgame cycles count in the month they end. The first one kept ran from 30 Sep to 19 Oct 2026.",
}

def at(text: str) -> datetime:
    """A moment given on the server's clock (Europe, UTC+1), in UTC."""
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)


_ids = iter(range(1, 100_000))
IMPORTED = "2026-11-05 12:00:00"  # when the wish histories of the tests were last imported, unless a test says otherwise


def import_run(store, finished: str = IMPORTED) -> int:
    """An import of the wish history that finished ok at `finished`: the history covers the days up to it."""
    run = store.start_wish_import(at(finished) - timedelta(minutes=1))
    store.finish_wish_import(run, at(finished), "ok", UID, 0, 1, None, ())
    return run


def wish(store, when: str, *, rank: int = 3, pool: str = "character", name: str | None = None, run: int | None = None):
    gacha = {"character": "301", "weapon": "302", "standard": "200", "novice": "100", "chronicled": "500"}[pool]
    run = run if run is not None else import_run(store)
    store.add_wishes([
        WishRow(
            next(_ids), UID, gacha, pool, name or f"Item {rank}", "Character", rank, when, at(when), run,
        )
    ])


def wishes(store, when: str, count: int, **kwargs) -> None:
    run = import_run(store)
    for second in range(count):
        wish(store, when[:-2] + f"{second:02d}", run=run, **kwargs)


def primogems(store, *entries: tuple[str, int, str]) -> None:
    store.keep_ledger_entries(
        LedgerRow(UID, "primogem", next(_ids), time, at(time), amount, reason) for time, amount, reason in entries
    )


def resin(store, *entries: tuple[str, int, str]) -> None:
    store.keep_ledger_entries(
        LedgerRow(UID, "resin", next(_ids), time, at(time), amount, reason) for time, amount, reason in entries
    )


def session(store, start: str, end: str) -> None:
    identity = store.open_session(at(start), False)
    store.touch_session(identity, at(end))


def tracking(store, day: date) -> None:
    store.add_points(None, game_day_start(day, SERVER) + timedelta(hours=1), day, [Point("stats.days_active", 1.0)])


def complete_states(store) -> dict:
    """The wishes' states with every history read as complete, as the rules read a history built by hand."""
    rows = store.wishes(UID)
    states = {}
    for pool in ("character", "weapon", "standard", "chronicled", "novice"):
        kept = [
            Wish(r.id, r.pool, r.gacha_type, r.name, "character", r.rank, r.at, r.import_id) for r in rows if r.pool == pool
        ]
        states[pool] = pool_state(pool, kept, window_start=None, correction=None)
    return states


def noon(day: date) -> datetime:
    return game_day_start(day, SERVER) + timedelta(hours=12)


def build(store, ym: str, today: date = TODAY, states=None, now: datetime | None = None):
    states = complete_states(store) if states is None else states
    return build_month(store, History(store), UID, SERVER, ym, today, states, now or noon(today))


def tile_ids(month) -> list[str]:
    return [tile["id"] for tile in month["tiles"]]


def tile(month, tile_id: str) -> dict:
    return next(t for t in month["tiles"] if t["id"] == tile_id)


# ---------------------------------------------------------------------------------------------- what a month holds


def test_a_wishes_only_month(store):
    wish(store, "2025-10-13 10:00:00", rank=3)
    wish(store, "2025-10-13 10:00:01", rank=5, name="Furina")
    month = build(store, "2025-10")
    assert tile_ids(month) == ["wishes"]
    assert tile(month, "wishes")["value"] == 2
    assert month["days"] is None
    assert [record["id"] for record in month["records"]] == ["luckiest"]
    assert month["sources"] == [] and month["resin"] == [] and month["endgame"] == []
    assert month["since"] == [{"part": "Wishes", "since": "13 Oct 2025", "text": "Wishes are tracked from 13 Oct 2025."}]
    assert month["label"] == "October 2025" and month["so_far"] is False


def test_a_source_that_does_not_reach_a_month_leaves_its_parts_out(store):
    # Sessions begin on 19 Oct 2026: September has no time, no days, no calendar, no longest session. It is not a 0.
    tracking(store, date(2026, 10, 19))
    session(store, "2026-10-19 20:00:00", "2026-10-19 21:00:00")
    wish(store, "2026-09-10 10:00:00")
    month = build(store, "2026-09")
    assert tile_ids(month) == ["wishes"]
    assert month["days"] is None and month["records"] == []


def test_a_real_zero_is_a_zero(store):
    wish(store, "2025-10-13 10:00:00", run=import_run(store, "2025-12-15 10:00:00"))
    month = build(store, "2025-11")  # an import after November: the history covers it, and no wish was made
    assert tile(month, "wishes")["value"] == 0
    assert month["pulls"] == {"banners": [], "fives": []}


def test_a_full_month_has_its_five_numbers(store):
    tracking(store, date(2026, 9, 1))
    session(store, "2026-10-03 20:00:00", "2026-10-03 22:30:00")
    session(store, "2026-10-04 20:00:00", "2026-10-04 21:00:00")
    session(store, "2026-10-05 20:00:00", "2026-10-05 20:30:00")
    primogems(
        store,
        ("2026-09-20 12:00:00", 60, "Daily Commission reward"),
        ("2026-10-03 12:00:00", 60, "Daily Commission reward"),
        ("2026-10-04 12:00:00", 150, "Welkin Moon"),
        ("2026-10-31 12:00:00", 60, "Daily Commission reward"),
    )
    wishes(store, "2026-10-10 10:00:00", 4)
    store.put_progress([
        ProgressRow(1, "done", at("2026-10-12 12:00:00"), False, "", "player", at("2026-10-12 12:00:00")),
    ])
    month = build(store, "2026-10", today=date(2026, 11, 20))
    assert tile_ids(month) == ["time", "days", "primogems", "wishes", "achievements"]
    assert (tile(month, "time")["value"], tile(month, "time")["unit"]) == (240, "minutes")
    assert tile(month, "days")["value"] == 3
    assert tile(month, "primogems")["value"] == 270
    assert tile(month, "wishes")["value"] == 4
    assert tile(month, "achievements")["value"] == 1
    records = {record["id"]: record for record in month["records"]}
    assert records["longest_session"]["value"] == 150 and records["longest_session"]["when"] == "3 Oct"
    assert records["best_primogem_day"]["value"] == 150 and records["best_primogem_day"]["when"] == "4 Oct"
    assert records["longest_run"]["value"] == 3 and records["longest_run"]["when"] == "3–5 Oct"
    assert [day["minutes"] for day in month["days"][:6]] == [0, 0, 150, 60, 30, 0]
    assert len(month["days"]) == 31 and month["days"][2]["level"] == 4
    assert month["sources"] == [
        {"name": "Blessing of the Welkin Moon", "amount": 150}, {"name": "Daily commissions", "amount": 120},
    ]


def test_imported_achievements_count_in_no_month(store):
    imported = at("2026-10-20 19:43:13")
    store.add_import("astra", "save.json", "f1", {}, imported)
    store.put_progress([
        *(ProgressRow(i, "done", imported, False, "", "astra", imported) for i in (1, 2, 3)),
        ProgressRow(10, "done", at("2026-10-21 10:00:00"), False, "", "player", at("2026-10-21 10:00:00")),
        ProgressRow(11, "done", at("2026-10-25 10:00:00"), False, "", "player", at("2026-10-25 10:00:00")),
        # Edited after the import by hand, and so a "player" row: its time is still the import's, so it is no tick.
        ProgressRow(12, "done", imported, False, "", "player", at("2026-10-22 10:00:00")),
        # Not done: no done_at to count.
        ProgressRow(13, "in_progress", None, False, "", "player", at("2026-10-22 10:00:00")),
    ])
    tracking(store, date(2026, 10, 19))
    month = build(store, "2026-10")
    assert tile(month, "achievements")["value"] == 2
    days = ticked_achievement_days(store, SERVER, date(2026, 10, 1), date(2026, 10, 31))
    assert days == [date(2026, 10, 21), date(2026, 10, 25)]
    assert ticked_achievement_days(store, SERVER, date(2026, 10, 22), date(2026, 10, 31)) == [date(2026, 10, 25)]


def test_the_comparison_of_a_past_month_is_the_month_before(store):
    tracking(store, date(2026, 8, 1))
    session(store, "2026-09-03 20:00:00", "2026-09-03 21:00:00")
    session(store, "2026-10-03 20:00:00", "2026-10-03 23:00:00")
    month = build(store, "2026-10")
    assert month["compare_label"] == "vs September"
    assert tile(month, "time")["delta"] == 120
    assert tile(month, "days")["delta"] == 0


def test_the_current_month_compares_with_the_same_days_before(store):
    tracking(store, date(2026, 9, 1))
    session(store, "2026-10-03 20:00:00", "2026-10-03 21:00:00")  # in 1-6 Oct
    session(store, "2026-10-20 20:00:00", "2026-10-20 23:00:00")  # after the 6th: not in the comparison
    session(store, "2026-11-02 20:00:00", "2026-11-02 22:00:00")
    month = build(store, "2026-11", today=date(2026, 11, 6))
    assert month["so_far"] is True and month["compare_label"] == "vs 1–6 Oct"
    assert tile(month, "time")["value"] == 120
    assert tile(month, "time")["delta"] == 60  # 120 minutes against the 60 of 1-6 Oct, not the 240 of all October


def test_a_first_month_that_begins_inside_has_nothing_to_compare_with(store):
    session(store, "2026-10-20 20:00:00", "2026-10-20 21:00:00")
    tracking(store, date(2026, 10, 19))
    month = build(store, "2026-11", today=date(2026, 11, 6))
    assert tile(month, "time")["delta"] is None  # October is only partly tracked
    october = build(store, "2026-10")
    assert tile(october, "time")["delta"] is None
    assert october["since"] == [
        {"part": "Time in Teyvat", "since": "19 Oct 2026", "text": "Time in Teyvat is tracked from 19 Oct 2026."},
        {"part": "Achievements", "since": "19 Oct 2026", "text": "Achievements are tracked from 19 Oct 2026."},
    ]


def test_month_edges_follow_the_reset(store):
    # 02:00 to 03:00 on the server's 1 Nov is still the game day of 31 Oct (the reset is at 04:00).
    tracking(store, date(2026, 10, 1))
    session(store, "2026-11-01 02:00:00", "2026-11-01 03:00:00")
    october, november = build(store, "2026-10"), build(store, "2026-11")
    assert tile(october, "time")["value"] == 60 and tile(november, "time")["value"] == 0
    assert october["days"][30]["minutes"] == 60  # 31 October
    # A session over the reset is cut at it: the longest session of October is the part before 04:00.
    session(store, "2026-11-01 03:30:00", "2026-11-01 05:00:00")
    october = build(store, "2026-10")
    assert tile(october, "time")["value"] == 90
    assert {r["id"]: r for r in october["records"]}["longest_session"]["value"] == 60


def test_primogems_match_the_overview(store):
    tracking(store, date(2026, 8, 1))
    primogems(
        store,
        ("2026-08-30 12:00:00", 60, "Daily Commission reward"),
        ("2026-09-02 12:00:00", 60, "Daily Commission reward"),
        ("2026-09-15 12:00:00", 150, "Welkin Moon"),
        ("2026-10-02 12:00:00", 40, "Event reward"),
        ("2026-10-03 12:00:00", -160, "Wish purchase"),
        ("2026-10-04 12:00:00", 300, "HoYoverse Top-Up Center Reward"),
    )
    overview = build_stats(store, History(store), date(2026, 10, 20), SERVER, "30", uid=UID)["primogems"]["months"]
    assert {"2026-09", "2026-10"} <= {m["ym"] for m in overview}
    for entry in overview:
        month = build(store, entry["ym"], today=date(2026, 10, 20))
        assert tile(month, "primogems")["value"] == entry["value"], entry["ym"]
    assert tile(build(store, "2026-10", today=date(2026, 10, 20)), "primogems")["value"] == 40  # not the spent or bought


def keep_diary(store, year: int, month: int, total: int, *sources: tuple[str, int]) -> None:
    from guildboard.records import DiaryMonth, DiaryRecord, DiarySource, FetchResult
    from guildboard.sync.apply import apply_result

    record = DiaryRecord((DiaryMonth(year, month, total, tuple(DiarySource(n, a) for n, a in sources)),))
    run = store.start_run("startup", at("2026-10-05 12:00:00"))
    apply_result(store, run, FetchResult("diary", at("2026-10-05 12:00:00"), (), record), SERVER)


def test_primogems_of_a_diary_only_month_match_the_overview(store):
    keep_diary(store, 2026, 9, 4120, ("Daily Activity", 4120))
    overview = build_stats(store, History(store), date(2026, 10, 20), SERVER, "30", uid=UID)["primogems"]["months"]
    assert [(m["ym"], m["value"]) for m in overview][0] == ("2026-09", 4120)
    month = build(store, "2026-09", today=date(2026, 10, 20))
    assert tile(month, "primogems")["value"] == 4120
    assert month["sources"] == [{"name": "Daily Activity", "amount": 4120}]
    assert "records" in month and all(r["id"] != "best_primogem_day" for r in month["records"])  # no day is known


def test_a_month_with_exact_days_gives_their_groups_not_the_diarys(store):
    primogems(store, ("2026-09-30 12:00:00", 1, "x"), ("2026-10-03 12:00:00", 150, "Daily Commission reward"))
    keep_diary(store, 2026, 10, 2508, ("Daily Activity", 2508))
    month = build(store, "2026-10", today=date(2026, 10, 20))
    assert tile(month, "primogems")["value"] == 150
    assert month["sources"] == [{"name": "Daily commissions", "amount": 150}]


# ---------------------------------------------------------------------------------------------- the rest of a month


def test_the_luckiest_five_star_is_the_lowest_known_pity(store):
    run = store.start_wish_import(at("2026-10-02 10:00:00"))
    for second in range(40):  # 40 pulls, then a 5-star: pity 41
        wish(store, f"2026-10-02 10:00:{second:02d}", run=run)
    wish(store, "2026-10-02 10:01:00", rank=5, name="Furina", run=run)
    for second in range(9):
        wish(store, f"2026-10-03 10:00:{second:02d}", run=run)
    wish(store, "2026-10-03 10:01:00", rank=5, name="Nahida", run=run)  # pity 10
    month = build(store, "2026-10")
    luckiest = {r["id"]: r for r in month["records"]}["luckiest"]
    assert (luckiest["name"], luckiest["value"], luckiest["when"]) == ("Nahida", 10, "3 Oct")
    assert [(f["name"], f["pity"]) for f in month["pulls"]["fives"]] == [("Furina", 41), ("Nahida", 10)]
    assert month["pulls"]["banners"] == [{"label": "Character event", "kind": "character", "wishes": 51}]
    assert [f["pool"] for f in month["pulls"]["fives"]] == ["character", "character"]


def test_an_unknown_pity_is_never_the_luckiest(store):
    run = store.start_wish_import(at("2026-10-02 10:00:00"))
    wish(store, "2026-10-02 10:00:00", rank=5, name="Furina", run=run)
    wish(store, "2026-10-02 10:00:01", rank=3, run=run)
    rows = store.wishes(UID)
    kept = [Wish(r.id, r.pool, r.gacha_type, r.name, "character", r.rank, r.at, r.import_id) for r in rows]
    # A window that starts after the 5-star: its count is not known.
    state = pool_state("character", kept, window_start=at("2026-10-02 10:00:01"), correction=None)
    assert state.fives[0].pity is None
    month = build(store, "2026-10", states={"character": state})
    assert [r["id"] for r in month["records"]] == []
    assert month["pulls"]["fives"][0]["pity"] is None and month["pulls"]["fives"][0]["name"] == "Furina"


def test_the_faces_of_the_five_stars(store):
    store.replace_wiki_items("character", [WikiItemRow("character", "Furina", 5, "https://x/f.png", "1", at("2026-10-01 00:00:00"))])
    wish(store, "2026-10-02 10:00:00", rank=5, name="Furina")
    wish(store, "2026-10-02 10:00:01", rank=5, name="Unlisted")
    faces = tile(build(store, "2026-10"), "wishes")["faces"]
    assert faces == [{"name": "Furina", "icon": "/api/icon/wish.character.furina"}, {"name": "Unlisted", "icon": None}]


def test_resin_spent_and_primogem_sources(store):
    primogems(store, ("2026-09-30 12:00:00", 1, "Daily Commission reward"), ("2026-10-05 12:00:00", 60, "Daily Commission reward"))
    resin(
        store,
        ("2026-09-30 12:00:00", -20, "Domain"),
        ("2026-10-05 12:00:00", -40, "Domain"),
        ("2026-10-06 12:00:00", -60, "Boss"),
        ("2026-10-07 12:00:00", -40, "Domain"),
        ("2026-10-08 12:00:00", 60, "Resin refill"),
        ("2026-11-01 12:00:00", -20, "Domain"),
    )
    month = build(store, "2026-10")
    assert month["resin"] == [{"name": "Domain", "amount": 80}, {"name": "Boss", "amount": 60}]


def test_the_endgame_cycles_that_ended_in_the_month(store):
    def cycle(mode, number, starts, ends, **detail):
        store.put_endgame_cycle(EndgameCycleRow(mode, number, starts, ends, detail, at("2026-10-01 12:00:00")))

    cycle("abyss", "123", "2026-09-15T20:00:00+00:00", "2026-10-15T20:00:00+00:00", stars=34)
    cycle("theater", "30", "2026-10-01T02:00:00+00:00", "2026-10-31T20:00:00+00:00", acts=8, difficulty="Hard")
    cycle("stygian", "5", "2026-10-01T02:00:00+00:00", "2026-11-30T20:00:00+00:00", difficulty=4)
    cycle("abyss", "124", "2026-10-15T20:00:00+00:00", "2026-11-15T20:00:00+00:00", stars=36)
    # A cycle counts once its end time has passed: on its last day, before the end, it is still open.
    assert build(store, "2026-11", today=date(2026, 11, 15), now=at("2026-11-15 20:00:00"))["endgame"] == []
    october = build(store, "2026-10")
    assert october["endgame"] == [
        {"mode": "abyss", "label": "Spiral Abyss", "result": "34 of 36 stars"},
        {"mode": "theater", "label": "Imaginarium Theater", "result": "Act 8 reached"},
    ]
    assert build(store, "2026-11")["endgame"] == []  # the abyss of 15 Nov is still open on 6 Nov
    assert build(store, "2026-11", today=date(2026, 11, 20))["endgame"] == [
        {"mode": "abyss", "label": "Spiral Abyss", "result": "36 of 36 stars"},
    ]
    # The endgame is kept from the end of its first cycle, 15 Oct, which is inside October; the note names the cycle whole.
    note = {
        "part": "Endgame", "since": "15 Oct 2026",
        "text": "Endgame cycles count in the month they end. The first one kept ran from 15 Sep to 15 Oct 2026.",
    }
    assert october["since"] == [note]
    assert build(store, "2026-09")["since"] == [note]
    assert build(store, "2026-11", today=date(2026, 11, 20))["since"] == []


# ---------------------------------------------------------------------------------------------- the list of months


def test_the_first_month_is_the_earliest_any_source_reaches(store):
    history = History(store)
    assert first_month(store, history, UID, SERVER) is None
    assert month_list(store, history, UID, SERVER, TODAY, {}) == []
    tracking(store, date(2026, 10, 19))
    assert first_month(store, history, UID, SERVER) == "2026-10"
    wish(store, "2025-10-13 10:00:00")
    assert first_month(store, history, UID, SERVER) == "2025-10"
    primogems(store, ("2026-04-30 12:00:00", 60, "Daily Commission reward"))
    assert first_month(store, history, UID, SERVER) == "2025-10"


def test_the_list_runs_to_the_current_month_and_marks_the_thin_ones(store):
    wish(store, "2026-08-13 10:00:00")
    tracking(store, date(2026, 10, 19))
    session(store, "2026-10-20 20:00:00", "2026-10-20 21:00:00")
    listed = month_list(store, History(store), UID, SERVER, TODAY, {})
    assert [(m["ym"], m["label"], m["year"], m["current"]) for m in listed] == [
        ("2026-08", "Aug", 2026, False), ("2026-09", "Sep", 2026, False),
        ("2026-10", "Oct", 2026, False), ("2026-11", "Nov", 2026, True),
    ]
    # August and September have the wishes alone; October and November have the wishes, time, days and achievements
    # (tracked from 19 Oct): three or more of the five numbers is not thin.
    assert [m["thin"] for m in listed] == [True, True, False, False]
    assert month_list(store, History(store), UID, SERVER, TODAY, {}) == listed


def test_two_numbers_are_thin(store):
    wish(store, "2026-10-13 10:00:00")
    primogems(store, ("2026-09-30 12:00:00", 1, "x"), ("2026-10-20 12:00:00", 60, "Daily Commission reward"))
    month = build(store, "2026-10")
    assert tile_ids(month) == ["primogems", "wishes"]
    assert {m["ym"]: m["thin"] for m in month_list(store, History(store), UID, SERVER, TODAY, {})}["2026-10"] is True


def test_three_numbers_are_not_thin(store):
    wish(store, "2026-10-13 10:00:00")
    session(store, "2026-10-20 20:00:00", "2026-10-20 21:00:00")  # a session with no tracked points: time and days
    month = build(store, "2026-10")
    assert tile_ids(month) == ["time", "days", "wishes"]
    assert {m["ym"]: m["thin"] for m in month_list(store, History(store), UID, SERVER, TODAY, {})}["2026-10"] is False


def test_a_wish_at_2am_on_the_first_counts_in_the_month_before(store):
    # 02:00 on the server's 1 Nov is still the game day of 31 Oct.
    wish(store, "2026-11-01 02:00:00")
    wish(store, "2026-11-01 04:00:00")
    assert tile(build(store, "2026-10"), "wishes")["value"] == 1
    assert tile(build(store, "2026-11"), "wishes")["value"] == 1


def test_the_wish_history_covers_the_days_up_to_its_last_import(store):
    wish(store, "2026-09-10 10:00:00", run=import_run(store, "2026-10-05 12:00:00"))
    october, november = build(store, "2026-10"), build(store, "2026-11")
    # October is ended inside by the import: its count is up to then, and it compares with nothing.
    assert tile(october, "wishes")["value"] == 0 and tile(october, "wishes")["delta"] is None
    # November is wholly after the last import: no wishes, no pulls, no luckiest, not a 0.
    assert "wishes" not in tile_ids(november)
    assert november["pulls"] == {"banners": [], "fives": []}
    assert all(r["id"] != "luckiest" for r in november["records"])
    listed = {m["ym"]: m["thin"] for m in month_list(store, History(store), UID, SERVER, TODAY, {})}
    assert listed["2026-11"] is True  # no numbers at all
    # A run that failed is no coverage.
    run = store.start_wish_import(at("2026-11-02 10:00:00"))
    store.finish_wish_import(run, at("2026-11-02 10:01:00"), "failed", UID, 0, 0, "x", ())
    assert "wishes" not in tile_ids(build(store, "2026-11"))


def test_a_thin_month_names_the_parts_that_begin_later(store):
    wish(store, "2025-10-13 10:00:00")
    primogems(store, ("2026-04-30 12:00:00", 1, "x"), ("2026-05-20 12:00:00", 60, "Daily Commission reward"))
    tracking(store, date(2026, 10, 19))
    store.put_endgame_cycle(EndgameCycleRow("abyss", "1", "2026-09-30T20:00:00+00:00", "2026-10-19T20:00:00+00:00", {"stars": 3}, at("2026-10-01 12:00:00")))
    may = build(store, "2026-05")
    assert tile_ids(may) == ["primogems", "wishes"]
    assert may["since"] == [LATER, ENDGAME_LATER]
    # Different dates are different lines; a source that began inside the month keeps its own form.
    resin(store, ("2026-05-10 12:00:00", -20, "Domain"), ("2026-05-12 12:00:00", -20, "Domain"))
    assert build(store, "2026-04")["since"] == [
        {"part": "Primogems", "since": "1 May 2026", "text": "Primogems are tracked from 1 May 2026."},
        {"part": "Resin", "since": "11 May 2026", "text": "Resin is tracked from 11 May 2026."},
        LATER,
        ENDGAME_LATER,
    ]
    # A source that begins inside the month has its note with the year too, so the notes of a month read alike.
    assert build(store, "2026-05")["since"][:2] == [
        {"part": "Resin spent", "since": "11 May 2026", "text": "Resin spent is tracked from 11 May 2026."}, LATER,
    ]


# ---------------------------------------------------------------------------------------------- the core and the API


@pytest.fixture
def core(tmp_path, clock):
    core = Core(
        AppPaths(tmp_path / "data"), demo=True, clock=clock, source=None, sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, 4321), base_url="http://127.0.0.1:4321") as client:
        response = client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        assert response.status_code == 303
        yield client


def test_an_unknown_month_falls_back_to_the_newest(client):
    client.post("/api/sync")
    newest = client.get("/api/stats/month").json()
    assert newest["months"][-1]["current"] is True
    assert newest["month"]["ym"] == newest["months"][-1]["ym"] and newest["month"]["so_far"] is True
    for ym in ("1999-01", "banana", "2026-13", ""):
        assert client.get("/api/stats/month", params={"ym": ym}).json()["month"]["ym"] == newest["month"]["ym"]
    earlier = newest["months"][0]["ym"]
    assert client.get("/api/stats/month", params={"ym": earlier}).json()["month"]["ym"] == earlier
