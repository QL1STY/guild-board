"""Exact primogems from the game's own history, then the diary's detail; a day of neither is empty, never estimated
from the diary's running total (the ledger design, section 0; the plan's Review Focus 1 and 2)."""
from datetime import date, datetime, timedelta, timezone

from guildboard.gameday import game_day_start
from guildboard.history import History
from guildboard.ledger import income
from guildboard.metrics import EARNED_KEY, Point
from guildboard.pulls.savings import Balance, balance_now
from guildboard.store import DiaryActionRow, LedgerRow

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))


def _at(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)


_ids = iter(range(1, 10_000))


def keep(store, *entries: tuple[str, int, str]) -> None:
    store.keep_ledger_entries(
        LedgerRow(UID, "primogem", next(_ids), time, _at(time), amount, reason) for time, amount, reason in entries
    )


OLDEST = ("2026-10-01 12:00:00", 60, "Daily Commission reward")  # the history starts mid-day: 1 October is partial


def test_the_oldest_day_is_not_covered(store):
    keep(store, OLDEST, ("2026-10-05 10:00:00", 60, "Daily Commission reward"))
    assert income.covered_from(store, UID, SERVER) == date(2026, 10, 2)
    earned = income.earned_by_day(store, UID, SERVER, date(2026, 9, 30), date(2026, 10, 6))
    assert date(2026, 10, 1) not in earned and date(2026, 10, 6) not in earned  # after the newest entry's day
    assert earned[date(2026, 10, 3)] == {"commissions": 0, "welkin": 0, "events": 0, "endgame": 0, "other": 0}
    assert earned[date(2026, 10, 5)]["commissions"] == 60


def test_a_welkin_day_is_150(store):
    keep(store, OLDEST, ("2026-10-03 05:10:00", 60, "Daily Commission reward"),
         ("2026-10-03 04:00:02", 90, "Blessing of the Welkin Moon daily reward"))
    day = income.earned_by_day(store, UID, SERVER, date(2026, 10, 3), date(2026, 10, 3))[date(2026, 10, 3)]
    assert {group: amount for group, amount in day.items() if amount} == {"commissions": 60, "welkin": 90}


def test_an_entry_at_0359_belongs_to_the_day_before(store):
    keep(store, OLDEST, ("2026-10-04 03:59:59", 90, "Blessing of the Welkin Moon daily reward"),
         ("2026-10-04 04:00:00", 60, "Daily Commission reward"))
    earned = income.earned_by_day(store, UID, SERVER, date(2026, 10, 3), date(2026, 10, 4))
    assert earned[date(2026, 10, 3)]["welkin"] == 90 and earned[date(2026, 10, 3)]["commissions"] == 0
    assert earned[date(2026, 10, 4)]["commissions"] == 60 and earned[date(2026, 10, 4)]["welkin"] == 0


def test_bought_primogems_and_spending_are_not_earned(store):
    keep(store, OLDEST, ("2026-10-03 10:00:00", 1090, "Exchanged Genesis Crystals for Primogems"),
         ("2026-10-03 11:00:00", -1600, "Shop purchase"), ("2026-10-03 12:00:00", 400, "Event reward"))
    day = income.earned_by_day(store, UID, SERVER, date(2026, 10, 3), date(2026, 10, 3))[date(2026, 10, 3)]
    assert sum(day.values()) == 400 and day["events"] == 400


def test_diary_detail_fills_the_days_the_game_does_not_cover(store):
    keep(store, OLDEST, ("2026-10-05 10:00:00", 60, "Daily Commission reward"))
    store.keep_diary_actions(UID, [
        DiaryActionRow(UID, "2026-09-30 12:00:00", _at("2026-09-30 12:00:00"), "Daily Commission reward", 60, 0),
        DiaryActionRow(UID, "2026-09-30 13:00:00", _at("2026-09-30 13:00:00"), "Something new", 5, 0),
        DiaryActionRow(UID, "2026-10-03 12:00:00", _at("2026-10-03 12:00:00"), "Event reward", 999, 0),  # covered
    ])
    earned = income.earned_by_day(store, UID, SERVER, date(2026, 9, 30), date(2026, 10, 3))
    assert earned[date(2026, 9, 30)]["commissions"] == 60 and earned[date(2026, 9, 30)]["other"] == 5
    assert date(2026, 10, 1) not in earned  # the partial day, from neither
    assert earned[date(2026, 10, 3)]["events"] == 0  # the game's own log wins where it covers


def test_the_day_before_the_first_month_of_diary_detail_is_not_exact(store):
    # Only October's detail was read: its first four hours belong to 30 September's game day, of which they are a part.
    store.keep_diary_actions(UID, [
        DiaryActionRow(UID, "2026-10-01 02:00:00", _at("2026-10-01 02:00:00"), "Daily Commission reward", 60, 0),
        DiaryActionRow(UID, "2026-10-02 12:00:00", _at("2026-10-02 12:00:00"), "Event reward", 400, 0),
    ])
    earned = income.earned_by_day(store, UID, SERVER, date(2026, 9, 25), date(2026, 10, 3))
    assert date(2026, 9, 30) not in earned
    assert earned[date(2026, 10, 2)]["events"] == 400


def test_a_month_of_exact_days_is_split_by_group_and_adds_up_to_its_value(store):
    keep(store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"),
         ("2026-10-04 10:00:00", 400, "Event reward"), ("2026-10-04 11:00:00", 90, "Blessing of the Welkin Moon daily reward"))
    # The diary's running total rises 300 on 1 October, a day the game's log does not cover whole: no estimate of it.
    for day, value in ((date(2026, 9, 30), 1000), (date(2026, 10, 1), 1300)):
        store.add_points(None, game_day_start(day, SERVER) + timedelta(hours=20), day, [Point(EARNED_KEY, value)])
    today = date(2026, 10, 4)
    months = dict(income.month_values(store, UID, SERVER, {"2026-10": 2508, "2026-08": 1800}, today, 6))
    sources = income.month_sources(store, UID, SERVER, "2026-10", today)
    assert sources == [("Events", 400), ("Daily commissions", 150), ("Blessing of the Welkin Moon", 90)]
    assert sum(amount for _, amount in sources) == months["2026-10"] == 640
    assert months["2026-08"] == 1800  # a month without exact days keeps the diary's own total
    assert income.month_sources(store, UID, SERVER, "2026-08", today) is None


def test_stats_month_sources_follow_the_months_value_not_the_diarys(store):
    from guildboard.records import DiaryMonth, DiaryRecord, DiarySource, FetchResult
    from guildboard.sync.apply import apply_result
    from guildboard.views.stats import build_stats

    keep(store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"),
         ("2026-10-04 10:00:00", 400, "Event reward"))
    record = DiaryRecord((DiaryMonth(2026, 10, 2508, (DiarySource("Daily Activity", 2508),)),))
    run = store.start_run("startup", _at("2026-10-04 13:00:00"))
    apply_result(store, run, FetchResult("diary", _at("2026-10-04 13:00:00"), (), record), SERVER)
    model = build_stats(store, History(store), date(2026, 10, 4), SERVER, "30", uid=UID)["primogems"]
    month = model["months"][-1]
    assert month["ym"] == "2026-10"
    assert sum(source["amount"] for source in model["sources"]) == month["value"]
    assert [source["name"] for source in model["sources"]][:2] == ["Events", "Daily commissions"]
    # Without the account, the diary's own month and sources stay.
    alone = build_stats(store, History(store), date(2026, 10, 4), SERVER, "30")["primogems"]
    assert alone["sources"] == [{"name": "Daily Activity", "amount": 2508}]


def test_days_without_an_exact_record_are_empty_never_estimated(store):
    keep(store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"))
    for day, value in ((date(2026, 9, 29), 1000), (date(2026, 9, 30), 1100), (date(2026, 10, 1), 1300)):
        store.add_points(None, game_day_start(day, SERVER) + timedelta(hours=20), day, [Point(EARNED_KEY, value)])
    # 4 October: the diary's total may have risen, but the game's log has not reached it yet.
    days = income.earned_days(store, UID, SERVER, date(2026, 9, 30), date(2026, 10, 4))
    assert [(d.day.day, d.value, d.no_data, d.groups is not None) for d in days] == [
        (30, 0, True, False), (1, 0, True, False), (2, 0, False, True), (3, 150, False, True), (4, 0, True, False),
    ]


def test_pace_counts_only_the_exact_days(store):
    keep(store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"),
         ("2026-10-04 10:00:00", 50, "Daily Commission reward"))
    for day, value in ((date(2026, 9, 29), 1000), (date(2026, 10, 5), 9000)):
        store.add_points(None, game_day_start(day, SERVER) + timedelta(hours=20), day, [Point(EARNED_KEY, value)])
    # 2, 3 and 4 October are covered: 0, 150 and 50. The diary's rise is never counted.
    assert income.pace(store, UID, SERVER, date(2026, 10, 5)) == 200 / 3
    assert income.pace(store, None, SERVER, date(2026, 10, 5)) is None


def test_net_since_counts_in_and_out_and_the_fates_bought(store):
    keep(store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"),
         ("2026-10-03 11:00:00", -1600, "Shop purchase"))
    assert income.net_since(store, UID, _at("2026-10-02 00:00:00")) == (-1450, 10)


def test_savings_with_the_ledger_takes_spending_off_once(store):
    balance = Balance(1000, 0, _at("2026-10-02 08:00:00"))
    keep(store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"),
         ("2026-10-03 11:00:00", -1600, "Shop purchase"))
    net, fates = income.net_since(store, UID, balance.set_at)
    estimate = balance_now(balance, net, 10, fates_bought=fates)
    assert (estimate.primogems, estimate.fates) == (0, 0)  # 1000 + 150 − 1600, clamped; 10 bought, 10 wished


def test_a_diary_sync_keeps_its_detail_once_and_out_of_the_latest_document(store):
    from guildboard.records import DiaryEntry, DiaryMonth, DiaryRecord, FetchResult
    from guildboard.sync.apply import apply_result

    twin = DiaryEntry("2026-10-03 12:00:00", _at("2026-10-03 12:00:00"), "Adventure", 5)
    record = DiaryRecord((DiaryMonth(2026, 10, 10, ()),), (twin, twin), UID)
    run = store.start_run("startup", _at("2026-10-03 13:00:00"))
    for _ in range(2):
        apply_result(store, run, FetchResult("diary", _at("2026-10-03 13:00:00"), (), record), SERVER)
    kept = store.diary_actions(UID, _at("2026-10-03 04:00:00"), _at("2026-10-04 04:00:00"))
    assert [row.n for row in kept] == [0, 1]
    assert "entries" not in store.latest_doc("diary")[1]


def test_wishes_after_the_logs_newest_entry_keep_todays_rule():
    # 10 Fates bought and 10 wished within the log; 2 more wished after its newest entry, their Fates not seen.
    balance = Balance(5000, 0, _at("2026-10-02 08:00:00"))
    estimate = balance_now(balance, -1450, 12, fates_bought=10, wishes_after_log=2)
    assert (estimate.primogems, estimate.fates) == (5000 - 1450 - 2 * 160, 0)
    # Fates over from Starglitter within the log are not charged; those after it are, beyond what is left.
    estimate = balance_now(Balance(5000, 3, balance.set_at), -1450, 12, fates_bought=10, wishes_after_log=2)
    assert (estimate.primogems, estimate.fates) == (3550, 1)


def test_the_planner_charges_the_wishes_after_the_logs_newest_entry(tmp_path, clock):
    from guildboard.config import AppPaths
    from guildboard.core import Core
    from guildboard.pulls.rules import Wish
    from guildboard.store import PullsAccountRow
    from support import AccountSource, FakeSleep

    core = Core(
        AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    try:
        keep(core.store, OLDEST, ("2026-10-03 10:00:00", 150, "Daily Commission reward"),
             ("2026-10-03 11:00:00", -1600, "Shop purchase"))
        account = PullsAccountRow(UID, "", "", 5000, 0, _at("2026-10-02 08:00:00"), {}, {})
        wishes = [
            Wish(index, "character", "301", "Sword", "weapon", 3, _at(time))
            for index, time in enumerate(["2026-10-03 11:30:00"] * 10 + ["2026-10-04 12:00:00"] * 2, start=1)
        ]
        estimate = core.pulls._estimate(account, {"character": wishes}, SERVER, date(2026, 10, 4))
        assert (estimate.primogems, estimate.fates, estimate.wishes) == (5000 - 1450 - 2 * 160, 0, 12)
    finally:
        core.store.close()


def test_savings_without_coverage_keeps_todays_rule():
    balance = Balance(1000, 2, datetime(2026, 10, 2, tzinfo=timezone.utc))
    assert balance_now(balance, 150, 4) == balance_now(balance, 150, 4, fates_bought=None)
    estimate = balance_now(balance, 150, 4)
    assert (estimate.primogems, estimate.fates) == (1150 - 320, 0)


def test_a_week_with_days_without_a_record_is_marked_and_an_empty_one_is_no_data():
    from guildboard.views.stats import _primogem_column

    full = {"commissions": 60, "welkin": 0, "events": 0, "endgame": 0, "other": 0}
    monday = date(2026, 10, 5)
    some = [income.EarnedDay(monday, 60, full, False), income.EarnedDay(monday + timedelta(days=1), 0, None, True)]
    column = _primogem_column(monday, some)
    assert (column["value"], column["no_data"], column["after_gap"], column["groups"]["commissions"]) == (60, False, True, 60)
    assert "estimate" not in column
    none = [income.EarnedDay(monday, 0, None, True)]
    assert (_primogem_column(monday, none)["no_data"], _primogem_column(monday, none)["after_gap"]) == (True, False)
