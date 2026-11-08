"""The Pulls page's model (the Pulls plan, Task 4), read through the planner of a live core: the cards, the banners, the
history, the savings and the forecast, the planner's chances and the wishlist's chain, worked out by hand on the history
of pulls_history.py."""
from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.gameday import server_tz
from guildboard.metrics import EARNED_KEY, Point
from guildboard.pulls import ALL_POOLS, POOLS
from guildboard.pulls.nextversion import NextVersion, Row, load_reference, next_version
from guildboard.pulls.planner import PullsRefused
from guildboard.pulls.rules import PoolState, Wish, pool_state
from guildboard.pulls.savings import ChainEntry, Estimate, chain, chance_within, convolve, forecast, pulls_to_featured
from guildboard.store import BannerRow, DiaryActionRow, PullsAccountRow, WikiItemRow, WishlistRow, WishRow, iso
from guildboard.views.pulls import PullsData, build_pulls, four_counts, wish_kind
from pulls_history import (
    BANNERS_END,
    DEMO_BANNERS,
    FIRST_ID,
    NOW,
    OTHER_UID,
    UID,
    WINDOW,
    at,
    corrected,
    demo_like_history,
    keep,
    keep_demo_like,
    pool_run,
)
from pulls_shape import problem_with
from support import AccountSource, FakeSleep

CHRONICLED_BANNER = BannerRow(
    9004, "Chronicled Wish", "chronicled", ("Shenhe", "Ganyu"), "", DEMO_BANNERS[0].starts_at, BANNERS_END, NOW
)
# A next version that offers nothing, for the tests of the chances alone: the pulls by any day are then the estimate's.
NOTHING_NEXT = NextVersion("7.2", date(2026, 11, 4), date(2026, 12, 16), ())
LEDGER_KEYS = ["commissions", "events", "endgame", "update", "quests", "welkin", "gnostic_hymn"]


@pytest.fixture
def core(tmp_path, clock):
    core = Core(
        AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    yield core
    core.store.close()


def earn(core: Core, amount: int, *days: date, hour: int = 12) -> None:
    """The diary's detail: `amount` primogems from the commissions on each of `days`, at `hour` of the server's clock."""
    tz = server_tz(core.server())
    rows = []
    for day in days:
        moment = datetime(day.year, day.month, day.day, hour, tzinfo=tz)
        rows.append(DiaryActionRow(UID, moment.strftime("%Y-%m-%d %H:%M:%S"), moment.astimezone(timezone.utc),
                                   "Daily Commission reward", amount, 0))
    core.store.keep_diary_actions(UID, rows)


def days_from(first: date, last: date) -> list[date]:
    return [first + timedelta(days=n) for n in range((last - first).days + 1)]


def wiki_items(core: Core, *items: tuple[str, str, int]) -> None:
    for kind in ("character", "weapon"):
        core.store.replace_wiki_items(
            kind,
            [WikiItemRow(kind, name, rank, f"https://act-webstatic.hoyoverse.com/{n}.png", str(n), NOW)
             for n, (item_kind, name, rank) in enumerate(items) if item_kind == kind],
        )


def test_the_model_is_empty_before_any_import(core):
    model = core.pulls.model()
    assert model["uid"] is None
    assert model["account_uid"] is None
    assert model["pity"] == []
    assert model["history"]["count"] == 0
    assert model["savings"]["set"] is None
    assert (model["history"]["rows"], model["history"]["more"], model["history"]["fives"]) == ([], False, 0)
    assert (model["planner"], model["wishlist"], model["history_from"]) == ([], [], None)
    # The importer's live state (its day-long link) replaces this block in the route; the planner's has the same keys.
    assert model["import"] == {
        "state": "idle", "last_at": None, "found": 0, "pages": 0, "pool": None, "message": None,
        "auto": None, "auto_stopped": None, "login": None, "every_minutes": None,
    }
    assert model["savings"]["pulls"] is None and model["savings"]["estimated"] is None
    # Without an account the ledger still names the next version, with the switches off and no total.
    savings = model["savings"]
    assert savings["owned"] == {"welkin": False, "gnostic_hymn": False} and savings["by_next_end"] is None
    assert (savings["next"]["number"], savings["achievements_pulls"]) == ("7.2", savings["achievements_left"] // 160)
    assert (model["history"]["months"], model["history"]["typical_average"]) == ([], 62.3)
    assert problem_with(model) is None


def test_the_model_has_the_four_cards_and_the_history(core):
    keep_demo_like(core.store)
    model = core.pulls.model()
    assert model["uid"] == UID
    assert [card["pool"] for card in model["pity"]] == list(POOLS)
    character, weapon, standard, chronicled = model["pity"]
    assert (character["pity"], character["known"], character["guarantee"], character["four"]) == (61, True, "guaranteed", 7)
    assert (character["hard"], character["soft"], character["wishes"], character["path"]) == (90, 74, 219, None)
    assert character["last_five"] == {"name": "Qiqi", "pity": 81, "at": iso(at("2026-09-02T18:00"))}
    assert character["correction"] == {"pity": 0, "guaranteed": False}
    # Every wish was kept after the run's start − 180 days: the cards' history starts there, as the correction's does.
    assert {card["from"] for card in model["pity"]} == {iso(WINDOW)}
    assert weapon["path"] == {"item": "Azurelight", "points": 0, "max": 1}
    assert (weapon["pity"], weapon["four"], weapon["guarantee"], weapon["hard"], weapon["soft"]) == (23, 3, "fifty", 80, 63)
    assert (standard["pity"], standard["four"], standard["guarantee"], standard["path"]) == (44, 8, "none", None)
    assert (chronicled["pity"], chronicled["path"]) == (5, {"item": "", "points": 0, "max": 1})
    # The chronicled wish's five hold no 4★: its count is the wishes since the window, at least (ruling R22).
    assert [(card["four"], card["four_known"]) for card in model["pity"]] == [(7, True), (3, True), (8, True), (5, False)]
    history = model["history"]
    assert history["count"] == 387
    assert history["rows"][0]["at"] > history["rows"][1]["at"]
    assert len(history["rows"]) == 100
    assert history["more"]
    # Skirk a won 50/50 at 77 and Qiqi a lost one at 81: the character event's average of 79. Wolf's Gravestone, the
    # standard wish's 5★ at 76, is one of the 3 fives and in no average: the luck reads the character event alone.
    assert (history["fives"], history["average_pity"], history["won"], history["lost"]) == (3, 79, 1, 1)
    assert history["typical_average"] == 62.3
    assert 0 < history["luckier_than"] < 1
    assert model["history_from"] == iso(NOW - timedelta(days=180))
    assert model["import"] == {
        "state": "done", "last_at": iso(NOW), "found": 387, "pages": 20, "pool": None, "message": None,
        "auto": None, "auto_stopped": None, "login": None, "every_minutes": None,
    }


def test_the_banners_carry_their_cards_and_the_planner_its_chances(core):
    keep_demo_like(core.store)
    model = core.pulls.model()
    banners = model["banners"]
    assert [banner["name"] for banner in banners] == [row.name for row in DEMO_BANNERS]
    assert all(banner["running"] for banner in banners)
    assert [banner["pity"]["pool"] for banner in banners] == ["character", "character", "weapon"]
    assert banners[0]["art"] is None  # the demo's banners have no art; the page draws the sign
    assert banners[2]["featured"] == ["Azurelight", "Symphonist of Scents"]
    skirk, escoffier, epitome = model["planner"]
    assert [entry["banner"]["name"] for entry in model["planner"]] == [row.name for row in DEMO_BANNERS]
    budget = skirk["pulls_by_then"]
    assert budget == model["savings"]["forecast"]["pulls"]  # the default forecast is by these banners' end
    guaranteed = pulls_to_featured("character", 61, True)
    assert skirk["chance"] == pytest.approx(chance_within(guaranteed, budget))
    two = convolve(guaranteed, pulls_to_featured("character", 0, False))
    assert skirk["second"] == pytest.approx(chance_within(two, budget))
    assert (skirk["certain_within"], escoffier["certain_within"]) == (29, 29)
    charted = pulls_to_featured("weapon", 23, False, path_points=0, charted=True)
    assert epitome["chance"] == pytest.approx(chance_within(charted, budget))
    assert epitome["certain_within"] == 137


def test_each_planner_entry_has_the_icon_of_the_5_star_it_is_for(core):
    # As a wishlist entry and a history row have theirs: the wiki's icon of the featured 5★ the entry is for, the
    # charted weapon on the weapon banner, else none, and the page draws the sign.
    keep_demo_like(core.store, charted="Symphonist of Scents")
    wiki_items(core, ("character", "Skirk", 5), ("weapon", "Azurelight", 5), ("weapon", "Symphonist of Scents", 5))
    model = core.pulls.model()
    assert [(entry["banner"]["name"], entry["icon"]) for entry in model["planner"]] == [
        ("Void Star's Advent", "/api/icon/wish.character.skirk"),
        ("La Chanson Cerise", None),  # the wiki's lists do not hold Escoffier
        ("Epitome Invocation", "/api/icon/wish.weapon.symphonist-of-scents"),
    ]
    assert problem_with(model) is None


def test_the_history_rows_say_each_five_and_four_star(core):
    keep_demo_like(core.store)
    wiki_items(core, ("character", "Qiqi", 5))
    page = core.pulls.history(None, 500)
    assert page["more"] is False
    assert len(page["rows"]) == 387
    by_name: dict[str, dict] = {}
    for row in page["rows"]:
        by_name.setdefault(row["name"], row)  # the newest row of each name
    qiqi, skirk, wolf = by_name["Qiqi"], by_name["Skirk"], by_name["Wolf's Gravestone"]
    assert (qiqi["pity"], qiqi["result"], qiqi["pool"], qiqi["pool_label"]) == (81, "lost", "character", "Character event")
    assert qiqi["icon"] == "/api/icon/wish.character.qiqi"
    assert (skirk["pity"], skirk["result"], skirk["icon"]) == (77, "won", None)
    assert (wolf["pity"], wolf["result"], wolf["kind"], wolf["pool_label"]) == (76, None, "weapon", "Standard")
    assert (by_name["Noelle"]["pity"], by_name["Noelle"]["rank"], by_name["Noelle"]["pool"]) == (10, 4, "novice")
    assert (by_name["Bennett"]["pity"], by_name["Bennett"]["result"]) == (9, None)
    assert (by_name["The Flute"]["pity"], by_name["Cool Steel"]["pity"], by_name["Cool Steel"]["rank"]) == (10, None, 3)
    assert isinstance(qiqi["id"], str) and int(qiqi["id"]) > 2**53  # past what the page's numbers hold exactly
    assert all(problem_with(row, "HistoryRow") is None for row in page["rows"])
    older = core.pulls.history(int(page["rows"][99]["id"]), 50)
    assert [row["id"] for row in older["rows"]] == [row["id"] for row in page["rows"][100:150]]
    assert older["more"]


def test_a_history_no_run_finished_is_not_read_as_complete(core):
    # A first import that Guild Board's closing cut short: its wishes are kept, and its run ends as failed with no pool.
    keep(core.store, [*pool_run("weapon", 23, "2026-10-01T10:00", "2026-10-11T10:00", fours=(10, 20))], finished=False)
    core.store.fail_running_wish_imports(NOW)
    weapon = core.pulls.model()["pity"][1]
    assert (weapon["pity"], weapon["known"], weapon["guarantee"]) == (23, False, "unknown")  # "at least 23"
    # A run that finished the character event alone says nothing of the others, kept or not.
    keep(core.store, [*pool_run("character", 30, "2026-10-12T10:00", "2026-10-12T11:00")], first_id=2 * 10**18,
         pools=("character",))
    character, weapon, standard, _ = core.pulls.model()["pity"]
    assert (character["pity"], character["known"]) == (30, False)  # its window reaches before what it found
    assert (weapon["pity"], weapon["known"], weapon["guarantee"]) == (23, False, "unknown")
    assert (standard["pity"], standard["known"], standard["guarantee"]) == (0, False, "none")


def test_the_model_names_a_history_of_another_uid(core):
    core.store.set_meta("account_uid", "700000001")
    keep(core.store, [*pool_run("character", 30, "2026-10-01T10:00", "2026-10-10T10:00")], uid=OTHER_UID)
    model = core.pulls.model()
    assert model["uid"] == 700000002
    assert model["account_uid"] == 700000001
    assert model["history"]["count"] == 30


def test_the_forecast_date_defaults_to_the_end_of_the_running_banners(core):
    keep_demo_like(core.store)
    forecast = core.pulls.model()["savings"]["forecast"]
    assert (forecast["by"], forecast["default_by"], forecast["days"]) == ("2026-10-24", True, 11)
    chosen = core.pulls.model(date(2026, 11, 11))["savings"]["forecast"]
    assert (chosen["by"], chosen["default_by"], chosen["days"]) == ("2026-11-11", False, 29)
    assert core.pulls.model(date(2026, 10, 13))["savings"]["forecast"]["days"] == 0  # today is a day too
    core.store.replace_banners([])
    assert core.pulls.model()["savings"]["forecast"]["by"] == "2026-10-13"


def test_a_forecast_date_before_today_is_refused_by_the_planner(core):
    with pytest.raises(PullsRefused, match="^Choose today or a later day.$"):
        core.pulls.model(date(2026, 10, 12))


def test_a_forecast_without_income_adds_nothing_and_says_so(core):
    keep_demo_like(core.store)
    core.pulls.set_balance(9840, 14)
    savings = core.pulls.model()["savings"]
    assert savings["income_per_day"] is None
    estimated = savings["estimated"]
    assert estimated == {"primogems": 9840, "fates": 14, "income": 0, "wishes": 0}
    assert savings["pulls"] == 14 + 9840 // 160
    # By 24 Oct, before the next version starts: the estimate alone. The unfinished achievements are outside it.
    assert savings["achievements_left"] > 0
    assert savings["forecast"]["pulls"] == estimated["fates"] + estimated["primogems"] // 160
    assert savings["set"] == {"primogems": 9840, "fates": 14, "set_at": iso(NOW)}


def test_the_income_is_the_exact_days_never_the_diary_s_running_total(core, clock):
    keep_demo_like(core.store)
    # The diary's running total rises 3,900, which is never counted: only the days its detail records are.
    core.store.add_points(None, at("2026-09-14T20:00"), date(2026, 9, 14), [Point(EARNED_KEY, 1000.0)])
    core.store.add_points(None, at("2026-10-12T20:00"), date(2026, 10, 12), [Point(EARNED_KEY, 4900.0)])
    core.pulls.set_balance(9840, 14)
    assert core.pulls.model()["savings"]["income_per_day"] is None
    earn(core, 130, *days_from(date(2026, 10, 1), date(2026, 10, 12)))
    savings = core.pulls.model()["savings"]
    assert savings["income_per_day"] == 130.0  # 130 on each of the 12 days recorded
    assert savings["estimated"]["income"] == 0
    assert savings["forecast"]["pulls"] == 14 + (9840 + 130 * 11) // 160  # the pace for the 11 days to 24 Oct
    # What was earned on the day the balance was set is in it (ruling R16); the event wishes imported after it are
    # taken off.
    earn(core, 130, date(2026, 10, 13), hour=13)
    keep(core.store, [*pool_run("character", 3, "2026-10-13T09:00", "2026-10-13T09:02"),
                      *pool_run("standard", 2, "2026-10-13T09:03", "2026-10-13T09:04")], first_id=2 * 10**18)
    estimated = core.pulls.model()["savings"]["estimated"]
    assert estimated == {"primogems": 9840, "fates": 11, "income": 0, "wishes": 3}
    # The days recorded from the next day on are added.
    clock.advance(days=1)
    earn(core, 130, date(2026, 10, 14))
    estimated = core.pulls.model()["savings"]["estimated"]
    assert estimated == {"primogems": 9840 + 130, "fates": 11, "income": 130, "wishes": 3}


def test_the_model_carries_the_ledger(core, clock):
    keep_demo_like(core.store)
    clock.set(datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc))
    # No balance typed yet: the rows of 7.2 are there, and the total is not.
    savings = core.pulls.model()["savings"]
    assert savings["by_next_end"] is None and savings["owned"] == {"welkin": False, "gnostic_hymn": False}
    ledger = savings["next"]
    assert (ledger["number"], ledger["starts_on"], ledger["ends_on"]) == ("7.2", "2026-11-04", "2026-12-16")
    assert [row["key"] for row in ledger["rows"]] == LEDGER_KEYS
    assert (ledger["primogems"], ledger["fates"], ledger["pulls"], ledger["events_typed"]) == (6170, 0, 38, None)
    # The diary: 226 primogems a day recorded, and quests of 620 in August and 400 in September.
    earn(core, 226, *days_from(date(2026, 9, 25), date(2026, 10, 23)))
    core.store.add_points(
        None, at("2026-10-23T20:00"), date(2026, 10, 23),
        [
            Point("diary.primogems.source.2026-08.quests", 620.0),
            Point("diary.primogems.source.2026-09.quests", 400.0),
        ],
    )
    core.pulls.set_balance(9840, 14)
    core.pulls.set_settings({"welkin": True, "events_typed": {"version": "7.2", "primogems": 2330}})
    savings = core.pulls.model()["savings"]
    assert savings["income_per_day"] == 226.0
    assert savings["owned"] == {"welkin": True, "gnostic_hymn": False}
    ledger = savings["next"]
    assert ledger["rows"] == [
        {"key": "commissions", "primogems": 2520, "fates": 0, "on": True, "estimated": False},
        {"key": "events", "primogems": 2330, "fates": 0, "on": True, "estimated": False},
        {"key": "endgame", "primogems": 3050, "fates": 0, "on": True, "estimated": False},
        {"key": "update", "primogems": 600, "fates": 0, "on": True, "estimated": False},
        {"key": "quests", "primogems": 700, "fates": 0, "on": True, "estimated": True},
        {"key": "welkin", "primogems": 3780, "fates": 0, "on": True, "estimated": False},
        {"key": "gnostic_hymn", "primogems": 680, "fates": 4, "on": False, "estimated": False},
    ]
    assert (ledger["primogems"], ledger["fates"], ledger["pulls"], ledger["events_typed"]) == (12980, 0, 81, 2330)
    # The total: the 75 pulls now, the pace for the 11 days to 4 Nov, and all of 7.2.
    assert savings["by_next_end"] == (9840 + 226 * 11 + 12980) // 160 + 14 == 172
    # The Gnostic Hymn adds its primogems, and its 4 fates arrive with the days of 7.2.
    core.pulls.set_settings({"gnostic_hymn": True})
    savings = core.pulls.model()["savings"]
    assert savings["owned"] == {"welkin": True, "gnostic_hymn": True}
    assert (savings["next"]["primogems"], savings["next"]["fates"], savings["next"]["pulls"]) == (13660, 4, 89)
    assert savings["by_next_end"] == (9840 + 226 * 11 + 13660) // 160 + 14 + 4 == 180
    # A count typed for another version is not 7.2's.
    core.pulls.set_settings({"events_typed": {"version": "7.2", "primogems": None}})
    core.pulls.set_settings({"events_typed": {"version": "7.3", "primogems": 1}})
    events = core.pulls.model()["savings"]["next"]["rows"][1]
    assert events == {"key": "events", "primogems": 0, "fates": 0, "on": True, "estimated": True}


def test_the_planners_chances_use_the_same_estimate(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        model = core.pulls.model()
        savings = model["savings"]
        ledger = savings["next"]
        next_ = NextVersion(
            ledger["number"], date.fromisoformat(ledger["starts_on"]), date.fromisoformat(ledger["ends_on"]),
            tuple(Row(**row) for row in ledger["rows"]),
        )
        estimated = savings["estimated"]
        estimate = Estimate(
            estimated["primogems"], estimated["fates"], estimated["income"], estimated["wishes"], savings["pulls"]
        )

        def pulls_by(day: date) -> int:
            return forecast(estimate, savings["income_per_day"], date(2026, 10, 13), day, next_)

        [entry] = model["wishlist"]
        assert entry["pulls_by_then"] == pulls_by(date.fromisoformat(entry["about"]))
        assert entry["about"] == "2026-11-11" and entry["pulls_by_then"] != pulls_by(date(2026, 10, 24))
        assert [planned["pulls_by_then"] for planned in model["planner"]] == [pulls_by(date(2026, 10, 24))] * 3
        assert savings["forecast"]["pulls"] == pulls_by(date(2026, 10, 24))
        assert savings["by_next_end"] == pulls_by(next_.ends_on)
        # A later day is more pulls, never fewer, and the chosen day is the forecast's.
        chosen = core.pulls.model(date(2027, 1, 6))
        assert chosen["savings"]["forecast"]["pulls"] == pulls_by(date(2027, 1, 6)) > pulls_by(date(2026, 12, 16))
    finally:
        core.store.close()


def test_the_months_run_from_the_oldest_wish_to_this_month(core, clock):
    clock.set(datetime(2026, 3, 5, 8, 0, tzinfo=timezone.utc))
    keep(
        core.store,
        [
            *pool_run("novice", 1, "2025-10-05T10:00", "2025-10-05T10:00"),
            *pool_run("standard", 2, "2025-10-10T10:00", "2025-10-11T10:00"),
            *pool_run("character", 3, "2025-12-10T10:00", "2025-12-12T10:00"),
            *pool_run("weapon", 1, "2025-12-20T10:00", "2025-12-20T10:00"),
            *pool_run("chronicled", 1, "2026-02-14T10:00", "2026-02-14T10:00"),
        ],
        now=clock.now(),
    )
    quiet = {"character": 0, "weapon": 0, "standard": 0, "chronicled": 0}
    assert core.pulls.model()["history"]["months"] == [
        {"month": "2025-10", **quiet, "standard": 3},  # the beginners' wish counts with the standard one
        {"month": "2025-11", **quiet},
        {"month": "2025-12", **quiet, "character": 3, "weapon": 1},
        {"month": "2026-01", **quiet},
        {"month": "2026-02", **quiet, "chronicled": 1},
        {"month": "2026-03", **quiet},
    ]


def test_the_months_follow_the_servers_clock(core, clock):
    # The server is Europe's, one hour ahead of UTC: 23:00 UTC on 31 Jan is the first minute of February there.
    clock.set(datetime(2026, 2, 10, 8, 0, tzinfo=timezone.utc))
    keep(
        core.store,
        [
            *pool_run("character", 1, "2025-12-31T23:30", "2025-12-31T23:30"),
            *pool_run("character", 1, "2026-01-31T22:59", "2026-01-31T22:59"),
            *pool_run("weapon", 1, "2026-01-31T23:00", "2026-01-31T23:00"),
        ],
        now=clock.now(),
    )
    months = core.pulls.model()["history"]["months"]
    assert [(row["month"], row["character"], row["weapon"]) for row in months] == [("2026-01", 2, 0), ("2026-02", 0, 1)]
    assert core.pulls.model()["history"]["count"] == 3


def test_an_unknown_guarantee_is_counted_as_a_fifty_fifty(core):
    keep(core.store, pool_run("character", 40, "2026-10-01T10:00", "2026-10-10T10:00"))
    core.store.replace_banners([DEMO_BANNERS[0]])
    model = core.pulls.model()
    card = model["pity"][0]
    assert (card["pity"], card["known"], card["guarantee"]) == (40, False, "unknown")
    entry = model["planner"][0]
    assert entry["certain_within"] == 140
    assert entry["chance"] == pytest.approx(
        chance_within(pulls_to_featured("character", 40, False), entry["pulls_by_then"])
    )


def test_a_chart_counts_only_while_its_banner_runs(core, clock):
    keep_demo_like(core.store)
    core.store.replace_banners(DEMO_BANNERS[:2])
    model = core.pulls.model()
    assert model["pity"][1]["path"] == {"item": "", "points": 0, "max": 1}
    assert [entry["banner"]["pool"] for entry in model["planner"]] == ["character", "character"]
    # A weapon banner of other weapons does not count the chart either.
    others = replace(DEMO_BANNERS[2], featured=("Symphonist of Scents", "Lightbearing Moonshard"))
    core.store.replace_banners([*DEMO_BANNERS[:2], others])
    model = core.pulls.model()
    assert model["pity"][1]["path"]["item"] == ""
    assert [entry["banner"]["pool"] for entry in model["planner"]] == ["character", "character"]
    # Once the banners end, nothing runs: no chart counts and the planner is empty.
    core.store.replace_banners(DEMO_BANNERS)
    clock.set(BANNERS_END)
    model = core.pulls.model()
    assert model["pity"][1]["path"]["item"] == ""
    assert model["planner"] == []
    assert not any(banner["running"] for banner in model["banners"])


def test_a_weapon_on_the_wishlist_starts_from_the_weapon_card(core):
    keep_demo_like(core.store)
    wiki_items(core, ("character", "Citlali", 5), ("weapon", "Azurelight", 5))
    core.pulls.add_wish("Citlali", "character", date(2026, 11, 11), 1)
    core.pulls.add_wish("Azurelight", "weapon", date(2026, 11, 20), 1)
    citlali, azurelight = core.pulls.model()["wishlist"]
    assert (azurelight["pool"], azurelight["rank"], azurelight["icon"]) == ("weapon", 5, "/api/icon/wish.weapon.azurelight")
    first = [pulls_to_featured("character", 61, True), pulls_to_featured("weapon", 23, False, path_points=0, charted=True)]
    later = [pulls_to_featured("character", 0, False), pulls_to_featured("weapon", 0, False)]
    budgets = [citlali["pulls_by_then"], azurelight["pulls_by_then"]]
    expected = chain([ChainEntry(budget, f, l, 1) for budget, f, l in zip(budgets, first, later)])
    assert citlali["chance"] == pytest.approx(expected[0])
    assert azurelight["chance"] == pytest.approx(expected[1])
    # Certain within the character's 29 and then the weapon's 137 from its card (from a count of 0 it would be 160).
    assert (citlali["certain_within"], azurelight["certain_within"]) == (29, 29 + 137)


def test_a_wishlist_entry_the_wiki_does_not_know_counts_as_its_kind_and_a_four_star_takes_no_pulls(core):
    keep_demo_like(core.store)
    wiki_items(core, ("character", "Ororon", 4))
    core.pulls.add_wish("Ororon", "character", date(2026, 11, 1), 2)
    core.pulls.add_wish("Someone New", "weapon", date(2026, 11, 11), 1)
    core.pulls.add_wish("A New Face", "character", date(2026, 11, 20), 1)
    ororon, weapon, character = core.pulls.model()["wishlist"]
    assert (ororon["rank"], ororon["chance"], ororon["certain_within"]) == (4, 0.0, None)
    assert ororon["icon"] == "/api/icon/wish.character.ororon"
    # A 5★ the wiki lacks is of the kind typed: the weapon is the weapon event's, from the weapon card, and it leaves
    # the character card to the character after it.
    assert (weapon["rank"], weapon["pool"], weapon["icon"], weapon["certain_within"]) == (5, "weapon", None, 137)
    assert (character["rank"], character["pool"], character["certain_within"]) == (5, "character", 137 + 29)
    first = [pulls_to_featured("weapon", 23, False, path_points=0, charted=True), pulls_to_featured("character", 61, True)]
    later = [pulls_to_featured("weapon", 0, False), pulls_to_featured("character", 0, False)]
    entries = [ChainEntry(entry["pulls_by_then"], f, l, 1) for entry, f, l in zip((weapon, character), first, later)]
    assert [weapon["chance"], character["chance"]] == pytest.approx(chain(entries))


def test_a_wishlist_entry_coming_soon_says_so_until_the_wiki_lists_them(core):
    keep_demo_like(core.store)
    core.pulls.add_wish("tsaritsa", "character", date(2026, 12, 16), 3)
    core.pulls.add_wish("A New Face", "character", date(2026, 12, 20), 1)
    tsaritsa, other = core.pulls.model()["wishlist"]
    assert (tsaritsa["soon"], other["soon"]) == (True, False)  # the coming-soon list, in any case
    assert tsaritsa["rank"] == 5 and tsaritsa["certain_within"] is not None  # counted as a 5★ meanwhile
    wiki_items(core, ("character", "Tsaritsa", 5))
    assert core.pulls.model()["wishlist"][0]["soon"] is False


def _weapon_state(five: str, path_item: str) -> PoolState:
    """The weapon card of a running banner: a 5★ `five` inside it at the 30th wish, then 10 more: pity 10."""
    drawn = [
        *pool_run("weapon", 30, "2026-09-25T10:00", "2026-10-05T10:00", five=five, fours=(10, 20)),
        *pool_run("weapon", 10, "2026-10-06T10:00", "2026-10-10T10:00", fours=()),
    ]
    wishes = [Wish(FIRST_ID + n, d.pool, d.gacha_type, d.name, wish_kind(d.item_type), d.rank, d.at)
              for n, d in enumerate(drawn, start=1)]
    return pool_state("weapon", wishes, window_start=None, correction=None, path_item=path_item,
                      banner_start=DEMO_BANNERS[2].starts_at)


def test_a_weapon_entry_counts_the_fate_point_only_until_its_banner_ends():
    weapon = _weapon_state("Symphonist of Scents", "Azurelight")
    assert (weapon.pity, weapon.guarantee, weapon.path_points) == (10, "fifty", 1)  # a point now
    states = {pool: pool_state(pool, [], window_start=None, correction=None) for pool in ALL_POOLS}
    states["weapon"] = weapon

    def entry_on(about: date) -> dict:
        data = PullsData(
            uid=UID, account_uid=UID, now=NOW, today=date(2026, 10, 13), server="os_euro", states=states,
            account=PullsAccountRow(UID, "Azurelight", "", 0, 60, NOW, {}, {}), last_run=None,
            banners=DEMO_BANNERS, wiki={("weapon", "Azurelight"): WikiItemRow("weapon", "Azurelight", 5, "", "1", NOW)},
            rows=[], more=False, count=40, four_counts={}, estimate=Estimate(0, 60, 0, 0, 60), per_day=None,
            achievements_left=0, next_version=NOTHING_NEXT, by=date(2026, 10, 24), default_by=True,
            wishlist=[WishlistRow(1, UID, "Azurelight", "weapon", about, 1, 1, NOW)],
        )
        [entry] = build_pulls(data)["wishlist"]
        assert entry["pulls_by_then"] == 60
        return entry

    # Past the banner's end the point is gone: the card's count and its 75/25 carry over, charted on the entry's own.
    later = entry_on(date(2026, 12, 15))
    assert later["chance"] == pytest.approx(0.4179, abs=1e-4)
    assert later["certain_within"] == 150
    assert entry_on(date(2026, 10, 25))["certain_within"] == 150
    # Up to the banner's last day the point makes the next 5★ the charted one.
    for about in (date(2026, 10, 24), date(2026, 10, 20)):
        within = entry_on(about)
        assert within["certain_within"] == 70
        assert within["chance"] == pytest.approx(chance_within(pulls_to_featured("weapon", 10, False, path_points=1), 60))


def _weapon_banner_history(core: Core, five: str, charted: str) -> None:
    drawn = [
        *pool_run("weapon", 40, "2026-09-25T10:00", "2026-10-05T10:00", five=five, fours=(10, 20, 30)),
        *pool_run("weapon", 10, "2026-10-06T10:00", "2026-10-10T10:00", fours=()),
    ]
    keep(core.store, drawn)
    core.store.put_pulls_account(PullsAccountRow(UID, charted, "", None, None, None, {"weapon": corrected()}, {}))
    core.store.replace_banners(DEMO_BANNERS)


def _weapon_entry(core: Core) -> dict:
    [entry] = [entry for entry in core.pulls.model()["planner"] if entry["banner"]["pool"] == "weapon"]
    return entry


def test_a_new_chart_resets_the_fate_point(core):
    _weapon_banner_history(core, "Azurelight", "Azurelight")
    assert core.pulls.model()["pity"][1]["path"] == {"item": "Azurelight", "points": 0, "max": 1}  # got on its path
    # Charted again on the other weapon: the game resets the point, which the history alone would count for Azurelight.
    core.pulls.set_settings({"charted_weapon": "Symphonist of Scents"})
    assert core.store.pulls_account(UID).points["weapon"] == {"points": 0, "at": NOW}
    assert core.pulls.model()["pity"][1]["path"] == {"item": "Symphonist of Scents", "points": 0, "max": 1}
    assert _weapon_entry(core)["certain_within"] == 150
    # Points given with the chart are the game's own; taking the chart away resets them too.
    core.pulls.set_settings({"charted_weapon": "Azurelight", "points": {"weapon": 1}})
    assert core.pulls.model()["pity"][1]["path"] == {"item": "Azurelight", "points": 1, "max": 1}
    core.pulls.set_settings({"charted_weapon": ""})
    assert core.store.pulls_account(UID).points["weapon"] == {"points": 0, "at": NOW}
    # The same chart given again changes nothing.
    core.pulls.set_settings({"charted_weapon": "Azurelight", "points": {"weapon": 1}})
    core.pulls.set_settings({"charted_weapon": "Azurelight"})
    assert core.store.pulls_account(UID).points["weapon"] == {"points": 1, "at": NOW}


def test_a_first_chart_keeps_the_point_the_history_counts(core):
    # The player charted in the game, wished, and sets the chart here afterwards.
    _weapon_banner_history(core, "Symphonist of Scents", "")
    core.pulls.set_settings({"charted_weapon": "Azurelight"})
    assert "weapon" not in core.store.pulls_account(UID).points
    assert core.pulls.model()["pity"][1]["path"] == {"item": "Azurelight", "points": 1, "max": 1}
    assert _weapon_entry(core)["certain_within"] == 70
    # The chronicled wish's path likewise: a first path keeps its point. A path counts only while a chronicled wish runs,
    # so a new one resets the point then, and not before.
    core.pulls.set_settings({"chronicled_path": "Shenhe"})
    assert "chronicled" not in core.store.pulls_account(UID).points
    core.pulls.set_settings({"chronicled_path": "Ganyu"})
    assert "chronicled" not in core.store.pulls_account(UID).points
    core.store.replace_banners([*DEMO_BANNERS, CHRONICLED_BANNER])
    core.pulls.set_settings({"chronicled_path": "Shenhe"})
    assert core.store.pulls_account(UID).points["chronicled"] == {"points": 0, "at": NOW}


@pytest.mark.parametrize("stored", ["Lightbearing Moonshard", "Azurelite"])
def test_a_chart_that_did_not_count_keeps_the_point_the_history_counts(core, stored):
    # Last banner's chart, still kept when this one started, or a name typed wrong: neither counted, so replacing it
    # resets nothing. The player charted in the game, got an off-path 5★, imported, and sets the chart here now.
    _weapon_banner_history(core, "Symphonist of Scents", stored)
    assert core.pulls.model()["pity"][1]["path"] == {"item": "", "points": 0, "max": 1}
    core.pulls.set_settings({"charted_weapon": "Azurelight"})
    assert "weapon" not in core.store.pulls_account(UID).points
    assert core.pulls.model()["pity"][1]["path"] == {"item": "Azurelight", "points": 1, "max": 1}
    assert _weapon_entry(core)["certain_within"] == 70


def test_the_switches_and_a_typed_events_count_are_kept_per_uid(core):
    keep_demo_like(core.store)
    other = PullsAccountRow(OTHER_UID, "", "", None, None, None, {}, {}, True, True, {"7.2": 1000})
    core.store.put_pulls_account(other)
    core.pulls.set_settings({"welkin": True, "events_typed": {"version": "7.2", "primogems": 2330}})
    account = core.store.pulls_account(UID)
    assert (account.welkin, account.gnostic_hymn, account.events_typed) == (True, False, {"7.2": 2330})
    assert core.store.pulls_account(OTHER_UID) == other  # the second uid's row is untouched
    # Another setting leaves them as they are, and a count for another version is kept beside the first.
    core.pulls.set_settings({"gnostic_hymn": True, "charted_weapon": "Symphonist of Scents"})
    core.pulls.set_settings({"events_typed": {"version": "7.3", "primogems": 0}})
    account = core.store.pulls_account(UID)
    assert (account.welkin, account.gnostic_hymn, account.events_typed) == (True, True, {"7.2": 2330, "7.3": 0})
    assert account.charted_weapon == "Symphonist of Scents"
    # A null takes a version's count away; taking away one that is not there changes nothing.
    core.pulls.set_settings({"events_typed": {"version": "7.2", "primogems": None}})
    assert core.store.pulls_account(UID).events_typed == {"7.3": 0}
    core.pulls.set_settings({"events_typed": {"version": "7.2", "primogems": None}})
    assert core.store.pulls_account(UID).events_typed == {"7.3": 0}
    core.pulls.set_settings({"welkin": False})
    assert (core.store.pulls_account(UID).welkin, core.store.pulls_account(UID).gnostic_hymn) == (False, True)
    assert core.store.pulls_account(OTHER_UID) == other


def test_a_refused_switch_value_keeps_nothing_of_its_request(core):
    keep_demo_like(core.store)
    kept = core.store.pulls_account(UID)
    for bad in (
        {"welkin": "yes"}, {"gnostic_hymn": 1}, {"events_typed": "7.2"}, {"events_typed": {"version": "7.2"}},
        {"events_typed": {"version": "7.2", "primogems": -1}}, {"events_typed": {"version": "7.2", "primogems": 100_001}},
        {"events_typed": {"version": "7.2", "primogems": 12.5}}, {"events_typed": {"version": "7.2", "primogems": True}},
        {"events_typed": {"version": 7.2, "primogems": 5}}, {"events_typed": {"version": "later", "primogems": 5}},
    ):
        with pytest.raises(ValueError):
            core.pulls.set_settings({"charted_weapon": "Symphonist of Scents", "gnostic_hymn": True, **bad})
        assert core.store.pulls_account(UID) == kept, bad
    core.pulls.set_settings({"events_typed": {"version": "7.2", "primogems": 100_000}})  # the top of the range is fine
    core.pulls.set_settings({"events_typed": {"version": "7.2", "primogems": 0}})
    assert core.store.pulls_account(UID).events_typed == {"7.2": 0}


def test_a_correction_holds_only_for_the_window_it_was_given_for(core, clock):
    keep_demo_like(core.store, corrections=False)
    core.pulls.set_settings({"corrections": {"weapon": {"pity": 10, "guaranteed": True}}})
    assert core.store.pulls_account(UID).corrections["weapon"] == {"pity": 10, "guaranteed": True, "from": iso(WINDOW)}
    weapon = core.pulls.model()["pity"][1]
    assert (weapon["pity"], weapon["known"], weapon["guarantee"]) == (33, True, "guaranteed")
    assert weapon["correction"] == {"pity": 10, "guaranteed": True}
    # An import 200 days later, past the 180 the history reaches: the window moved, and the correction was for the old
    # one. The card reads "at least" again; the correction is kept, and not used.
    clock.advance(days=200)
    keep(core.store, pool_run("weapon", 5, "2027-04-29T10:00", "2027-04-30T10:00", fours=()), first_id=2 * 10**18,
         now=clock.now())
    weapon = core.pulls.model()["pity"][1]
    assert (weapon["pity"], weapon["known"], weapon["guarantee"], weapon["correction"]) == (5, False, "unknown", None)
    assert "weapon" in core.store.pulls_account(UID).corrections
    # A correction kept without its window is not used either.
    account = core.store.pulls_account(UID)
    core.store.put_pulls_account(replace(account, corrections={"weapon": {"pity": 10, "guaranteed": True}}))
    assert core.pulls.model()["pity"][1]["known"] is False


def test_a_correction_is_anchored_at_the_oldest_wish_kept_and_counts_the_sliver_before_180_days(core):
    # HoYoverse keeps six months, a few days past 180: the first import kept three wishes from before its start − 180
    # days, the last of them a 5★ Qiqi, a lost 50/50. The history starts at the oldest of them: the correction the player
    # sets is the state before it, and the three count from it.
    sliver = pool_run("character", 3, "2026-04-13T10:00", "2026-04-14T10:00", five="Qiqi", fours=())
    later = pool_run("character", 40, "2026-05-01T10:00", "2026-10-12T10:00")
    keep(core.store, [*sliver, *later])
    oldest = iso(at("2026-04-13T10:00"))
    assert NOW - timedelta(days=180) > at("2026-04-14T10:00")  # the sliver lies before the run's 180 days
    core.pulls.set_settings({"corrections": {"character": {"pity": 10, "guaranteed": False}}})
    assert core.store.pulls_account(UID).corrections["character"] == {"pity": 10, "guaranteed": False, "from": oldest}
    model = core.pulls.model()
    character = model["pity"][0]
    # Qiqi at the correction's 10 + 3, a lost 50/50: guaranteed since, 40 wishes on.
    assert (character["pity"], character["known"], character["guarantee"]) == (40, True, "guaranteed")
    assert character["last_five"]["pity"] == 13
    assert character["correction"] == {"pity": 10, "guaranteed": False}
    # The card names where its history starts, which the form's "Before …: pity" says; history_from is the same.
    assert character["from"] == oldest and model["history_from"] == oldest
    assert problem_with(model) is None


def test_history_from_is_the_earliest_window_a_run_finished(core):
    assert core.pulls.model()["history_from"] is None
    # The character event was finished 100 days before the run that finished every pool: its window reaches further.
    keep(core.store, pool_run("character", 10, "2026-06-01T10:00", "2026-06-02T10:00"), now=NOW - timedelta(days=100),
         pools=("character",))
    keep(core.store, pool_run("weapon", 5, "2026-10-01T10:00", "2026-10-02T10:00", fours=()), first_id=2 * 10**18)
    assert core.pulls.model()["history_from"] == iso(NOW - timedelta(days=280))


def demo_like_data() -> PullsData:
    """The data of the page for the demo-like history, built by hand with no store: a balance of 9,840 primogems and 14
    fates set on 13 Oct, no pace read, 1,850 primogems left in the achievements, the real next version (7.2, no
    switches) and the three banners of 23 Sep."""
    drawn = demo_like_history()
    rows = [
        WishRow(FIRST_ID + n, UID, d.gacha_type, d.pool, d.name, d.item_type, d.rank, "", d.at, 1)
        for n, d in enumerate(drawn, start=1)
    ]
    wishes = {pool: [Wish(r.id, r.pool, r.gacha_type, r.name, wish_kind(r.item_type), r.rank, r.at)
                     for r in rows if r.pool == pool] for pool in ALL_POOLS}
    states = {
        pool: pool_state(
            pool, wishes[pool], window_start=None, correction=None,
            path_item="Azurelight" if pool == "weapon" else "", banner_start=DEMO_BANNERS[2].starts_at,
        )
        for pool in ALL_POOLS
    }
    today = date(2026, 10, 13)
    return PullsData(
        uid=UID, account_uid=UID, now=NOW, today=today, server="os_euro", states=states,
        account=PullsAccountRow(UID, "Azurelight", "", 9840, 14, NOW, {}, {}), last_run=None,
        banners=DEMO_BANNERS, wiki={}, rows=rows[::-1][:100], more=True, count=387, four_counts=four_counts(wishes),
        estimate=Estimate(9840, 14, 0, 0, 75), per_day=None, achievements_left=1850,
        next_version=next_version(today, DEMO_BANNERS, {}, False, False, {}, load_reference()),
        by=date(2026, 10, 24), default_by=True,
        wishlist=[WishlistRow(1, UID, "Citlali", "character", date(2026, 11, 11), 1, 1, NOW)],
    )


def test_the_view_builds_the_shape_without_a_store():
    data = demo_like_data()
    model = build_pulls(data)
    assert problem_with(model) is None
    # By 24 Oct, before 7.2 starts on 4 Nov: the estimate alone, with no pace and without the achievements' 1,850.
    assert model["savings"]["forecast"] == {"by": "2026-10-24", "pulls": 14 + 9840 // 160, "default_by": True, "days": 11}
    assert [(card["pool"], card["pity"], card["guarantee"]) for card in model["pity"]] == [
        ("character", 61, "guaranteed"), ("weapon", 23, "fifty"), ("standard", 44, "none"), ("chronicled", 5, "fifty"),
    ]
    assert [entry["banner"]["ann_id"] for entry in model["planner"]] == [row.ann_id for row in DEMO_BANNERS]
    assert model["history"]["rows"][0]["id"] == str(data.rows[0].id)
    empty = build_pulls(replace(data, uid=None))
    assert (empty["pity"], empty["planner"], empty["wishlist"], empty["history"]["rows"]) == ([], [], [], [])
    assert all(banner["pity"] is None for banner in empty["banners"])


def test_the_unfinished_achievements_are_outside_every_estimate():
    with_them, without = demo_like_data(), replace(demo_like_data(), achievements_left=0)
    model, bare = build_pulls(with_them), build_pulls(without)
    assert (model["savings"]["achievements_left"], model["savings"]["achievements_pulls"]) == (1850, 11)
    assert (bare["savings"]["achievements_left"], bare["savings"]["achievements_pulls"]) == (0, 0)
    # Nothing else of the model changes: the total, the forecast, the planner's chances and the wishlist's.
    for part in (model, bare):
        del part["savings"]["achievements_left"], part["savings"]["achievements_pulls"]
    assert model == bare
    # By the next version's end: (9840 + 7.2's 6,170 without switches or diary) // 160 + 14, and not a pull for the 1,850.
    assert model["savings"]["by_next_end"] == (9840 + 6170) // 160 + 14 == 114
    # The demo's 5,815 primogems left are 36 pulls, shown under the total and out of it.
    shown = build_pulls(replace(with_them, achievements_left=5815))["savings"]
    assert (shown["achievements_left"], shown["achievements_pulls"], shown["by_next_end"]) == (5815, 36, 114)


def test_the_model_has_the_page_s_shape(core):
    assert problem_with(core.pulls.model()) is None
    keep_demo_like(core.store)
    core.pulls.set_balance(9840, 14)
    core.pulls.add_wish("Citlali", "character", date(2026, 11, 11), 1)
    model = core.pulls.model()
    assert model["savings"]["set"] is not None and model["wishlist"] and model["planner"]
    assert problem_with(model) is None


def test_the_model_is_the_pages_type_field_for_field(core):
    # The model holds the Pulls second pass's fields (the ledger, the luck's typical figure, the months, the importer's
    # day-long link) and web/src/types.ts names every one of them: the check is exact, no key more and none fewer.
    assert problem_with(core.pulls.model()) is None  # the empty model
    keep_demo_like(core.store)
    core.pulls.set_balance(9840, 14)
    assert problem_with(core.pulls.model()) is None


def test_the_pages_type_takes_the_importers_day_long_link_in_each_of_its_states(core):
    model = core.pulls.model()
    until, tick = "2026-10-14T07:52:00+00:00", "2026-10-13T08:22:00+00:00"
    for block in (
        {"auto": None, "auto_stopped": None},
        {"auto": {"until": until, "last_at": None}, "auto_stopped": None},
        {"auto": {"until": until, "last_at": tick}, "auto_stopped": None},
        {"auto": None, "auto_stopped": "expired"},
    ):
        assert problem_with({**model, "import": {**model["import"], **block}}) is None, block
    # What the type does not name is not taken: a reason it has no word for, and a link with a field more.
    assert problem_with({**model, "import": {**model["import"], "auto_stopped": "refused"}}) is not None
    assert problem_with({**model, "import": {**model["import"], "auto": {"until": until, "last_at": None, "n": 1}}}) is not None


def test_the_pages_type_takes_the_next_version_with_no_number_and_with_a_typed_count(core):
    keep_demo_like(core.store)
    core.pulls.set_balance(9840, 14)
    model = core.pulls.model()
    version = model["savings"]["next"]
    for change in ({"number": None}, {"events_typed": 2400}):
        varied = {**model, "savings": {**model["savings"], "next": {**version, **change}}}
        assert problem_with(varied) is None, change
    # A row the type has no key for is not taken.
    stray = {**model, "savings": {**model["savings"], "next": {**version, "rows": [{**version["rows"][0], "key": "pass"}]}}}
    assert problem_with(stray) is not None
