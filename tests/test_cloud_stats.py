"""What a player can share: each stat as the online plan's contract has it, made from what this PC already knows."""
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.cloud import STAT_KEYS
from guildboard.cloud.stats import collect_stats, profile_facts
from guildboard.config import AppPaths, Settings
from guildboard.core import Core
from guildboard.ledger.reasons import BP_REWARD, DEFAULT_PRICES
from guildboard.metrics import EARNED_KEY, Point, month_key
from guildboard.store import LedgerRow, Store, WishRow
from guildboard.tokenstore import StoredToken, TokenStore
from guildboard.views.ledger import spent_in
from support import AccountSource, FakeSleep

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))


def _number_or_none(value) -> bool:
    return value is None or (isinstance(value, (int, float)) and not isinstance(value, bool))


@pytest.fixture
def demo_core(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    yield core
    core.store.close()


@pytest.fixture
def live_core(tmp_path, clock):
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(StoredToken({"ltoken_v2": "made-up"}, UID, SERVER, "Traveler"))
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    core.store.set_meta("account_uid", str(UID))  # as the first login does
    yield core
    core.store.close()


def test_collect_stats_has_the_contracts_shape(demo_core):
    stats = collect_stats(demo_core)
    assert tuple(stats) == STAT_KEYS
    assert {key: set(value) for key, value in stats.items()} == {
        "primogems": {"now", "months"},
        "playtime": {"week_hours", "days30_hours", "weeks", "week_start", "longest_run"},
        "achievements": {"ticked", "total"},
        "endgame": {"abyss_stars", "theater_act", "stygian"},
        "account": {"days_active", "characters", "chests"},
        "wishes": {"pity", "five_stars_90d"},
        "spending": {"month_total", "month", "currency"},
    }
    months = stats["primogems"]["months"]
    assert [row["month"] for row in months] == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert all(set(row) == {"month", "earned"} and _number_or_none(row["earned"]) for row in months)
    assert len(stats["playtime"]["weeks"]) == 6 and all(_number_or_none(week) for week in stats["playtime"]["weeks"])
    words = ("months", "weeks", "currency", "week_start", "month")  # the rest of a stat is numbers
    for key, value in stats.items():
        assert all(_number_or_none(number) for name, number in value.items() if name not in words), key
    assert stats["spending"]["currency"] == "PLN"
    for key, value in stats.items():
        # The database allows 1,024 bytes of jsonb, which takes about half as much again as this text: shared_stats.sql has the size.
        assert len(json.dumps(value)) < 512, key
    json.dumps(stats)


def test_the_demos_stats_say_something(demo_core):
    stats = collect_stats(demo_core)
    assert stats["achievements"]["total"] > stats["achievements"]["ticked"] > 0
    assert stats["account"]["characters"] == 96 and stats["account"]["days_active"] > 1700
    assert stats["account"]["chests"] > 4000
    assert stats["wishes"]["pity"] is not None and stats["wishes"]["five_stars_90d"] is not None
    assert stats["playtime"]["days30_hours"] > 0 and stats["playtime"]["longest_run"] > 0


def test_a_stat_with_nothing_behind_it_is_none(live_core):
    stats = collect_stats(live_core)
    assert stats["primogems"]["now"] is None
    assert [row["earned"] for row in stats["primogems"]["months"]] == [None] * 6
    assert stats["playtime"] == {
        "week_hours": None, "days30_hours": None, "weeks": [None] * 6, "week_start": "2026-10-12", "longest_run": None,
    }
    assert stats["endgame"] == {"abyss_stars": None, "theater_act": None, "stygian": None}
    assert stats["account"] == {"days_active": None, "characters": None, "chests": None}
    assert stats["wishes"] == {"pity": None, "five_stars_90d": None}
    assert stats["spending"] == {"month_total": None, "month": "2026-10", "currency": "PLN"}
    # The list of achievements is installed, so its count is known, and no tick is a true nought.
    assert stats["achievements"]["ticked"] == 0 and stats["achievements"]["total"] > 0


def test_playtime_names_its_week_and_spending_its_month(demo_core):
    # Neither holds a date of its own, and a friend's Guild Board that last uploaded long ago would show an old week as this
    # one (the online plan, Task C0): they name the week of the last of the six, and the month of the total. No other stat
    # carries a date: one refreshed each day would tell friends that this PC was on, with Status off.
    stats = collect_stats(demo_core)
    assert stats["playtime"]["week_start"] == "2026-10-12"  # the demo's clock is a Tuesday, in the week of Monday the 12th
    assert stats["spending"]["month"] == "2026-10"
    assert {key for key, value in stats.items() if "week_start" in value or "month" in value} == {"playtime", "spending"}


def test_the_week_and_the_month_are_the_game_days(live_core, clock):
    # A game day starts at 04:00 on the server, which is on Europe's clock here.
    clock.set(datetime(2026, 10, 31, 23, 30, tzinfo=timezone.utc))  # 00:30 on Sunday the 1st: still Saturday's game day
    stats = collect_stats(live_core)
    assert (stats["playtime"]["week_start"], stats["spending"]["month"]) == ("2026-10-26", "2026-10")
    clock.advance(hours=4)  # 04:30 on Sunday the 1st: the reset has passed
    stats = collect_stats(live_core)
    assert (stats["playtime"]["week_start"], stats["spending"]["month"]) == ("2026-10-26", "2026-11")
    clock.advance(hours=20)  # 00:30 on Monday the 2nd: still Sunday's game day
    assert collect_stats(live_core)["playtime"]["week_start"] == "2026-10-26"
    clock.advance(hours=4)  # 04:30 on Monday
    assert collect_stats(live_core)["playtime"]["week_start"] == "2026-11-02"


def test_the_week_is_named_also_when_nothing_was_tracked(live_core):
    # The same shape every time: a friend's page reads the date, not whether there were numbers.
    assert collect_stats(live_core)["playtime"]["week_start"] == "2026-10-12"


def _keep_primogems(store: Store, *entries: tuple[str, int]) -> None:
    def at(text: str) -> datetime:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)

    store.keep_ledger_entries(
        LedgerRow(UID, "primogem", number, time, at(time), amount, "Daily Commission reward")
        for number, (time, amount) in enumerate(entries, start=1)
    )


def test_the_months_follow_the_game_days_of_the_server(live_core, clock):
    # 04:00 on the server is when a game day starts, so 03:59 on the first of a month still belongs to the month before.
    clock.set(datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc))
    _keep_primogems(
        live_core.store,
        ("2026-09-20 12:00:00", 1), ("2026-10-01 03:59:00", 60), ("2026-10-01 04:00:00", 90), ("2026-10-02 12:00:00", 10),
    )
    months = {row["month"]: row["earned"] for row in collect_stats(live_core)["primogems"]["months"]}
    assert months["2026-09"] == 60
    assert months["2026-10"] == 100
    assert months["2026-08"] is None


def test_the_months_are_the_ones_stats_shows(live_core, clock):
    # A friend who has just installed Guild Board: the first sync reads each month's total from the diary, while the running
    # total starts at nought, so what Guild Board saw itself is far less than the month came to. A friend reads what Stats says.
    clock.set(datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc))
    live_core.store.add_points(None, clock.now(), date(2026, 10, 20), [
        Point(month_key(2026, 9), 7200.0), Point(month_key(2026, 10), 9880.0), Point(EARNED_KEY, 0.0),
    ])
    shown = {row["ym"]: row["value"] for row in live_core.stats()["primogems"]["months"]}
    months = {row["month"]: row["earned"] for row in collect_stats(live_core)["primogems"]["months"]}
    assert months["2026-10"] == shown["2026-10"] == 9880
    assert months["2026-09"] == shown["2026-09"] == 7200
    assert months["2026-08"] is None


def test_the_balance_is_the_typed_one_moved_on(demo_core):
    demo_core.pulls.set_balance(16040, 0)
    estimate = demo_core.pulls.balance_estimate()
    assert estimate is not None and collect_stats(demo_core)["primogems"]["now"] == estimate.primogems


def test_a_week_before_the_tracking_began_is_none(live_core, clock):
    clock.set(datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc))  # a Tuesday
    live_core.store.add_points(
        None, datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc), date(2026, 10, 7), [Point("stats.days_active", 10.0)]
    )
    session = live_core.store.open_session(datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc), started_before_tool=False)
    live_core.store.touch_session(session, datetime(2026, 10, 19, 13, 0, tzinfo=timezone.utc))
    playtime = collect_stats(live_core)["playtime"]
    assert playtime["weeks"] == [None, None, None, 0.0, 0.0, 3.0]  # 5 October's week is the first that was tracked
    assert playtime["week_hours"] == 3.0 and playtime["days30_hours"] == 3.0 and playtime["longest_run"] == 1


def test_the_wishes_are_the_character_banners_and_the_last_90_days(live_core, clock):
    clock.set(datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc))
    import_id = live_core.store.start_wish_import(clock.now())

    def wish(number: int, gacha_type: str, pool: str, rank: int, days_ago: int) -> WishRow:
        at = clock.now() - timedelta(days=days_ago)
        return WishRow(number, UID, gacha_type, pool, "Skirk", "Character", rank, at.strftime("%Y-%m-%d %H:%M:%S"), at, import_id)

    live_core.store.add_wishes([
        wish(1, "301", "character", 5, 91), wish(2, "301", "character", 5, 89), wish(3, "301", "character", 3, 2),
        wish(4, "301", "character", 3, 2), wish(5, "301", "character", 3, 2),
        wish(6, "302", "weapon", 5, 3), wish(7, "302", "weapon", 3, 2),
    ])
    assert collect_stats(live_core)["wishes"] == {"pity": 3, "five_stars_90d": 2}


def test_spent_in_counts_the_packs_of_those_days(store):
    settings = Settings()

    def keep(number: int, time: str, amount: int, reason: str, kind: str = "crystal") -> None:
        at = datetime.strptime(time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)
        store.keep_ledger_entries([LedgerRow(UID, kind, number, time, at, amount, reason)])

    keep(1, "2026-09-30 22:00:00", 8080, "Obtained via purchase")
    keep(2, "2026-10-01 01:00:00", 330, "Obtained via purchase")
    keep(3, "2026-10-31 23:00:00", 300, "Purchased Blessing of the Welkin Moon")
    keep(4, "2026-11-01 00:00:00", 1090, "Obtained via purchase")
    keep(5, "2026-10-15 12:00:00", -160, "Exchanged Genesis Crystals for Primogems")  # bought nothing
    keep(6, "2026-10-16 12:00:00", 680, BP_REWARD, "primogem")  # a Gnostic Hymn counts too
    prices = DEFAULT_PRICES["PLN"]
    total, currency = spent_in(store, UID, settings, date(2026, 10, 1), date(2026, 10, 31))
    assert (total, currency) == (round(prices["c300"] + prices["welkin"] + prices["gnostic_hymn"], 2), "PLN")
    assert spent_in(store, None, settings, date(2026, 10, 1), date(2026, 10, 31)) == (0.0, "PLN")
    assert spent_in(store, UID, Settings(spending_currency="EUR"), date(2026, 10, 1), date(2026, 10, 1))[1] == "EUR"


def test_the_facts_of_the_profile_come_from_the_overview(live_core, clock):
    assert profile_facts(live_core) == {"uid": UID, "ar": None, "picture_url": None}
    live_core.store.set_latest_doc(
        "overview", clock.now(), {"adventure_rank": 58, "picture_url": "https://act-webstatic.hoyoverse.com/a.png"}
    )
    assert profile_facts(live_core) == {
        "uid": UID, "ar": 58, "picture_url": "https://act-webstatic.hoyoverse.com/a.png",
    }


def test_without_a_login_there_are_no_facts(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())
    try:
        assert profile_facts(core) is None
    finally:
        core.store.close()
