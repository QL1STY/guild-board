"""The one interface a Ledger view draws a balance through (the Ledger revamp design, section 8a)."""
from datetime import date, datetime, timedelta, timezone

from guildboard.ledger import balances
from guildboard.pulls.savings import Estimate
from guildboard.store import DiaryActionRow, LedgerRow

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))
TODAY = date(2026, 10, 27)

_ids = iter(range(1, 100_000))


def _at(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)


def keep(store, time: str, amount: int, reason: str = "Event reward") -> None:
    store.keep_ledger_entries([LedgerRow(UID, "primogem", next(_ids), time, _at(time), amount, reason)])


def estimate(primogems: int) -> Estimate:
    return Estimate(primogems=primogems, fates=0, income=0, wishes=0, pulls=primogems // 160)


def held(store, days, kind="primogem", at=None):
    return balances.held_by_day(
        kind, days, store=store, uid=UID, server=SERVER, today=TODAY, estimate=at if at is not None else estimate(10_255)
    )


def test_balances_has_no_held_for_crystals(store):
    keep(store, "2026-10-26 10:00:00", 60)
    for kind in ("crystal", "resin", "artifact", "fate"):
        assert held(store, [TODAY], kind) is None


def test_no_balance_typed_gives_none(store):
    keep(store, "2026-10-26 10:00:00", 60)
    assert balances.held_by_day("primogem", [TODAY], store=store, uid=UID, server=SERVER, today=TODAY, estimate=None) is None
    assert balances.held_by_day(
        "primogem", [TODAY], store=store, uid=None, server=SERVER, today=TODAY, estimate=estimate(10)
    ) is None


def test_held_walks_back_from_pulls_estimate(store):
    keep(store, "2026-10-24 10:00:00", 60)  # the oldest entry: the log covers whole days from the 25th
    keep(store, "2026-10-25 10:00:00", 60)
    keep(store, "2026-10-26 10:00:00", -1600, "Shop purchase")
    keep(store, "2026-10-26 12:00:00", 150)
    keep(store, "2026-10-27 10:00:00", 150)
    days = [date(2026, 10, 25), date(2026, 10, 26), TODAY]
    assert held(store, days) == {date(2026, 10, 25): 11_555, date(2026, 10, 26): 10_105, TODAY: 10_255}


def test_held_counts_bought_primogems_and_uses_the_diary_where_only_it_covers(store):
    keep(store, "2026-10-26 10:00:00", 1090, "Exchanged Genesis Crystals for Primogems")
    keep(store, "2026-10-27 10:00:00", 60, "Daily Commission reward")
    # 20 October is a day of the diary alone; 21 to 25 hold nothing the game's log or the diary knows.
    store.keep_diary_actions(UID, [
        DiaryActionRow(UID, "2026-10-20 12:00:00", _at("2026-10-20 12:00:00"), "Event reward", 400, 0),
        DiaryActionRow(UID, "2026-10-02 12:00:00", _at("2026-10-02 12:00:00"), "Event reward", 1, 0),
    ])
    result = held(store, [date(2026, 10, 19), date(2026, 10, 20), date(2026, 10, 25), date(2026, 10, 26)])
    assert result[date(2026, 10, 26)] == 10_255 - 60  # the 27th's net is taken off
    assert result[date(2026, 10, 25)] == 10_195 - 1090  # bought ones are in the balance
    assert result[date(2026, 10, 20)] == 9_105  # 21 to 25 net 0
    assert result[date(2026, 10, 19)] == 9_105 - 400  # the 20th's diary earned


def test_held_leaves_out_the_days_after_today(store):
    keep(store, "2026-10-27 10:00:00", 60)
    assert held(store, [TODAY, date(2026, 10, 28)]) == {TODAY: 10_255}
    assert held(store, [date(2026, 10, 28)]) == {}
