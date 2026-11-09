"""The Ledger page's figures and history (the ledger plan, Task 6, as revised), and its routes."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths, Settings
from guildboard.core import Core
from guildboard.ledger.reasons import DEFAULT_PRICES
from guildboard.pulls.savings import Estimate
from guildboard.store import DiaryActionRow, LedgerRow, WishRow
from guildboard.views.ledger import build_history, build_ledger
from support import AccountSource, FakeSleep

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))
TODAY = date(2026, 10, 27)
PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"

_ids = iter(range(1, 100_000))


def keep(store, kind: str, time: str, amount: int, reason: str, name: str = "", rarity: int = 0) -> None:
    at = datetime.strptime(time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)
    store.keep_ledger_entries([LedgerRow(UID, kind, next(_ids), time, at, amount, reason, name, rarity)])


def ledger(store, settings=None, **more):
    return build_ledger(store, UID, SERVER, TODAY, settings or Settings(), {"state": "idle"}, **more)


def history(store, uid, kind, before, limit, rank=0):
    return build_history(store, uid, kind, before, limit, rank, server=SERVER)


def estimate(primogems: int = 10_255, pulls: int = 37) -> Estimate:
    return Estimate(primogems=primogems, fates=0, income=0, wishes=0, pulls=pulls)


def day_of(model, day: str) -> dict:
    return next(entry for entry in model["days"] if entry["day"] == day)


def test_an_empty_ledger_says_so(store):
    model = build_ledger(store, None, SERVER, TODAY, Settings(), {"state": "idle"})
    assert model["empty"] is True and model["spent"]["total"] == 0 and model["artifacts"]["per_run"] is None
    assert ledger(store)["empty"] is True


def test_spent_counts_packs_exactly_and_prices_them_in_the_currency(store):
    keep(store, "crystal", "2026-08-01 10:00:00", 1960, "Obtained via purchase")  # 980, the first-time double
    keep(store, "crystal", "2026-09-01 10:00:00", 1090, "Obtained via purchase")  # 980 again
    keep(store, "crystal", "2026-09-02 10:00:00", 300, "Purchased Blessing of the Welkin Moon")
    keep(store, "crystal", "2026-09-03 10:00:00", -1090, "Exchanged Genesis Crystals for Primogems")
    keep(store, "primogem", "2026-09-05 10:00:00", 680, "BP reward")
    spent = ledger(store, Settings(spending_currency="EUR"))["spent"]
    eur = DEFAULT_PRICES["EUR"]
    assert spent["rows"] == [
        {"id": "welkin", "label": "Blessing of the Welkin Moon", "count": 1, "each": eur["welkin"],
         "total": eur["welkin"]},
        {"id": "c980", "label": "980 + 110 Genesis Crystals", "count": 2, "each": eur["c980"],
         "total": round(2 * eur["c980"], 2)},
        {"id": "gnostic_hymn", "label": "Gnostic Hymn", "count": 1, "each": eur["gnostic_hymn"],
         "total": eur["gnostic_hymn"]},
    ]
    assert (spent["currency"], spent["welkins"], spent["packs"], spent["gnostic_hymns"]) == ("EUR", 1, 2, 1)
    assert spent["since"] == "2026-08-01"
    assert spent["total"] == round(eur["welkin"] + 2 * eur["c980"] + eur["gnostic_hymn"], 2)


def test_a_players_price_overrides_the_default(store):
    keep(store, "crystal", "2026-09-02 10:00:00", 300, "Purchased Blessing of the Welkin Moon")
    spent = ledger(store, Settings(spending_currency="PLN", spending_prices={"PLN": {"welkin": 19.99}}))["spent"]
    assert spent["rows"][0]["each"] == 19.99 and spent["total"] == 19.99


def test_the_price_list_names_every_pack_and_its_default_in_each_currency(store):
    # Settings › Extras › "Edit prices" shows these beside the player's corrections, which it keeps apart.
    prices = ledger(store, Settings(spending_prices={"PLN": {"welkin": 19.99}}))["prices"]
    assert [pack["id"] for pack in prices["packs"]] == [
        "welkin", "c60", "c300", "c980", "c1980", "c3280", "c6480", "gnostic_hymn",
    ]
    assert prices["packs"][0] == {"id": "welkin", "label": "Blessing of the Welkin Moon"}
    assert prices["defaults"] == DEFAULT_PRICES and prices["defaults"]["PLN"]["welkin"] != 19.99


def test_month_splits_earned_bought_and_out(store):
    keep(store, "primogem", "2026-10-01 03:59:00", 999, "Event reward")  # September's last game day, and the oldest entry (ids grow with time)
    keep(store, "primogem", "2026-10-02 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-02 11:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "primogem", "2026-10-03 11:00:00", 1090, "Exchanged Genesis Crystals for Primogems")
    keep(store, "primogem", "2026-10-04 11:00:00", -3200, "Shop purchase")
    keep(store, "primogem", "2026-10-05 11:00:00", -50, "Original Resin replenishment")
    month = ledger(store)["month"]
    assert (month["earned"], month["bought"], month["out"]) == (150, 1090, 3250)
    assert month["top_out"] == [{"label": "Intertwined Fates", "amount": 3200}, {"label": "Resin", "amount": 50}]


def test_artifacts_luck_is_none_when_runs_cannot_be_told(store):
    keep(store, "artifact", "2026-10-20 10:00:00", 1, "Obtained from Mystic Offering", "Flower", 5)
    artifacts = ledger(store)["artifacts"]
    assert artifacts["per_run"] is None and artifacts["runs"] == 0 and artifacts["five_other"] == 1
    assert artifacts["top_domain"] is None and artifacts["typical"] == 1.07


def test_artifacts_luck_per_domain_run(store):
    tree = "Revitalized Petrified Tree (Domain)"
    keep(store, "resin", "2026-10-20 10:00:00", -40, tree)  # a condensed run: 2
    keep(store, "resin", "2026-10-20 10:05:00", -20, tree)
    keep(store, "resin", "2026-10-20 10:10:00", -20, "Violet Court (Domain)")  # a talent domain: no artifacts
    keep(store, "resin", "2026-09-01 10:10:00", -20, tree)  # older than 30 days
    for rarity in (5, 5, 5, 4):
        keep(store, "artifact", "2026-10-20 10:06:00", 1, tree, "Flower", rarity)
    keep(store, "artifact", "2026-10-21 10:00:00", -1, "Artifact enhancement material", "Feather", 5)
    keep(store, "artifact", "2026-10-21 10:01:00", -1, "Artifact decomposition", "Cup", 4)
    keep(store, "artifact", "2026-10-21 10:02:00", 1, "Opened treasure chest", "Cup", 4)
    artifacts = ledger(store)["artifacts"]
    assert artifacts == {
        "five_domain": 3, "top_domain": "Revitalized Petrified Tree", "five_other": 0, "four_other": 1,
        "fed": 2, "fed_five": 1, "per_run": 1.0, "typical": 1.07, "runs": 3,
    }


def test_history_pages_with_before_and_says_more(store):
    for n in range(5):
        keep(store, "resin", f"2026-10-2{n} 10:00:00", -20, "Ley Line Blossom challenge reward")
    first = history(store, UID, "resin", None, 3)
    assert [entry["time"] for entry in first["entries"]] == [
        "2026-10-24 10:00:00", "2026-10-23 10:00:00", "2026-10-22 10:00:00",
    ]
    assert first["more"] is True and isinstance(first["entries"][0]["id"], str)
    assert set(first["entries"][0]) == {
        "id", "time", "reason", "name", "rarity", "amount", "title", "source", "detail",
    }
    rest = history(store, UID, "resin", int(first["entries"][-1]["id"]), 3)
    assert len(rest["entries"]) == 2 and rest["more"] is False


def test_history_entries_carry_a_title_and_a_source(store):
    keep(store, "primogem", "2026-10-20 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-20 11:00:00", -1600, "Shop purchase")
    first, second = history(store, UID, "primogem", None, 5)["entries"]
    assert (second["title"], second["source"]) == ("Daily commissions", "commissions")
    assert (first["title"], first["source"]) == ("Shop purchase", "shop")


# ---------------------------------------------------------------- the model's blocks: days, month, commissions, wishes

def test_days_run_over_six_calendar_months_to_today(store):
    keep(store, "primogem", "2026-10-26 10:00:00", 60, "Daily Commission reward")
    days = ledger(store)["days"]
    assert days[0]["day"] == "2026-05-01" and days[-1]["day"] == "2026-10-27"
    assert len(days) == 180
    assert set(days[0]) == {"day", "earned", "spent", "held", "known", "moments"}


def test_held_walks_back_from_pulls_estimate(store):
    keep(store, "primogem", "2026-10-24 10:00:00", 60, "Daily Commission reward")  # the oldest: whole days from the 25th
    keep(store, "primogem", "2026-10-25 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-26 10:00:00", -1600, "Shop purchase")
    keep(store, "primogem", "2026-10-26 12:00:00", 150, "Event reward")
    keep(store, "primogem", "2026-10-27 10:00:00", 150, "Event reward")
    model = ledger(store, estimate=estimate(10_255))
    assert [day_of(model, d)["held"] for d in ("2026-10-27", "2026-10-26", "2026-10-25")] == [10_255, 10_105, 11_555]
    yesterday = day_of(model, "2026-10-26")
    assert (yesterday["earned"], yesterday["spent"]) == (150, 1600)


def test_no_typed_balance_gives_no_held(store):
    keep(store, "primogem", "2026-10-24 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-27 10:00:00", 150, "Event reward")
    assert {day["held"] for day in ledger(store)["days"]} == {None}


def test_days_outside_the_log_are_unknown(store):
    keep(store, "primogem", "2026-10-24 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-27 10:00:00", 150, "Event reward")
    model = ledger(store, estimate=estimate())
    for day in ("2026-09-15", "2026-10-24"):  # before the log, and the day it starts part-way
        entry = day_of(model, day)
        assert (entry["known"], entry["earned"], entry["spent"], entry["moments"]) == (False, 0, 0, []), day
    assert day_of(model, "2026-10-25")["known"] is True and day_of(model, "2026-10-25")["earned"] == 0
    assert day_of(model, "2026-10-27")["earned"] == 150


def test_the_diary_makes_a_day_known_with_its_earned(store):
    keep(store, "primogem", "2026-10-26 10:00:00", 60, "Daily Commission reward")
    when = datetime(2026, 10, 10, 12, 0, 0, tzinfo=EURO)
    store.keep_diary_actions(UID, [
        DiaryActionRow(UID, "2026-10-10 12:00:00", when.astimezone(timezone.utc), "Event reward", 420, 0),
    ])
    entry = day_of(ledger(store), "2026-10-10")
    assert (entry["known"], entry["earned"], entry["spent"]) == (True, 420, 0)


def test_an_entry_before_four_belongs_to_the_day_before(store):
    keep(store, "primogem", "2026-10-09 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-12 02:30:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-13 04:00:00", 20, "Opened treasure chest")
    model = ledger(store)
    assert day_of(model, "2026-10-11")["earned"] == 60
    assert day_of(model, "2026-10-12")["earned"] == 0 and day_of(model, "2026-10-13")["earned"] == 20  # 04:00 starts the 13th


def test_moments_are_entries_of_300_or_more(store):
    keep(store, "primogem", "2026-10-09 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-12 10:00:00", 800, "Obtained from Imaginarium Theater")
    keep(store, "primogem", "2026-10-12 11:00:00", -1600, "Shop purchase")
    keep(store, "primogem", "2026-10-12 12:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-12 13:00:00", -299, "Original Resin replenishment")
    assert day_of(ledger(store), "2026-10-12")["moments"] == [
        {"title": "Imaginarium Theater", "amount": 800}, {"title": "Shop purchase", "amount": -1600},
    ]


def test_month_sources_longest_first_and_previous_same_days(store):
    keep(store, "primogem", "2026-08-31 10:00:00", 1, "Opened treasure chest")  # the log starts
    keep(store, "primogem", "2026-09-05 10:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "primogem", "2026-09-26 10:00:00", 300, "Event reward")
    keep(store, "primogem", "2026-09-26 11:00:00", 5000, "Exchanged Genesis Crystals for Primogems")  # never earned
    keep(store, "primogem", "2026-09-28 10:00:00", 999, "Event reward")  # after the 27th: not the same days
    keep(store, "primogem", "2026-10-02 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-03 10:00:00", 420, "Event reward")
    keep(store, "primogem", "2026-10-04 10:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "primogem", "2026-10-05 10:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "primogem", "2026-10-06 10:00:00", -1600, "Shop purchase")
    keep(store, "primogem", "2026-10-07 10:00:00", -160, "Shop purchase")
    month = ledger(store)["month"]
    assert month["sources"] == [
        {"group": "events", "label": "Events", "amount": 420},
        {"group": "welkin", "label": "Blessing of the Welkin Moon", "amount": 180},
        {"group": "commissions", "label": "Daily commissions", "amount": 60},
    ]
    assert sum(source["amount"] for source in month["sources"]) == month["earned"] == 660
    assert month["previous"] == {
        "earned": 390,
        "sources": {"commissions": 0, "welkin": 90, "events": 300, "endgame": 0, "other": 0},
    }
    assert month["fates_bought"] == 11
    assert (month["bought"], month["out"]) == (0, 1760)


def test_the_months_earned_is_its_days_as_stats_sums_them(store):
    from guildboard.ledger import income

    keep(store, "primogem", "2026-10-15 12:00:00", 100, "Event reward")  # the oldest: its day is cut part-way, not counted
    keep(store, "primogem", "2026-10-16 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-17 10:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "primogem", "2026-10-17 11:00:00", -160, "Shop purchase")
    keep(store, "primogem", "2026-10-17 12:00:00", 1090, "Exchanged Genesis Crystals for Primogems")
    keep(store, "primogem", "2026-10-20 10:00:00", 20, "Opened treasure chest")
    when = datetime(2026, 10, 10, 12, 0, 0, tzinfo=EURO)
    store.keep_diary_actions(UID, [  # a day of the diary alone, in this month
        DiaryActionRow(UID, "2026-10-10 12:00:00", when.astimezone(timezone.utc), "Event reward", 420, 0),
    ])
    model = ledger(store)
    month_days = [day for day in model["days"] if day["day"].startswith("2026-10")]
    assert model["month"]["earned"] == sum(day["earned"] for day in month_days) == 420 + 60 + 90 + 20
    assert model["month"]["earned"] == income.month_values(store, UID, SERVER, {}, TODAY, 1)[-1][1]
    assert sum(source["amount"] for source in model["month"]["sources"]) == model["month"]["earned"]
    assert (model["month"]["bought"], model["month"]["out"]) == (1090, 160)  # these two stay the log's own
    assert model["wishes"]["earned"] == 590 // 160


def test_commission_days_done_missed_unknown_future(store):
    keep(store, "primogem", "2026-10-01 12:00:00", 60, "Daily Commission reward")  # the oldest: 1 October is partial
    for day in (2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23, 24, 25, 26):
        keep(store, "primogem", f"2026-10-{day:02d} 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-27 09:00:00", 90, "Blessing of the Welkin Moon daily reward")  # today, not done yet
    calendar = ledger(store)["commissions"]
    states = {entry["day"]: entry["state"] for entry in calendar["days"]}
    assert calendar["month"] == "2026-10" and len(calendar["days"]) == 31
    assert states["2026-10-01"] == "unknown"  # the day the log starts part-way
    assert states["2026-10-02"] == "done" and states["2026-10-05"] == "missed" and states["2026-10-17"] == "missed"
    assert states["2026-10-27"] == "unknown"  # today, not done yet: not missed
    assert states["2026-10-28"] == "future" and states["2026-10-31"] == "future"
    assert calendar["missed"] == 4  # the 5th, 17th, 18th and 19th
    # The run of the 6th to the 16th is 11 days, and the run since the 20th is 7, to yesterday; the 27th does not break it.
    assert (calendar["streak_now"], calendar["longest"]) == (7, 11)


def test_a_day_done_today_counts_in_the_streak(store):
    keep(store, "primogem", "2026-10-20 10:00:00", 60, "Daily Commission reward")  # the oldest: the 20th is partial
    keep(store, "primogem", "2026-10-21 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-22 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-27 10:00:00", 60, "Daily Commission reward")  # the 23rd to 26th: covered, missed
    calendar = ledger(store)["commissions"]
    states = {entry["day"]: entry["state"] for entry in calendar["days"]}
    assert states["2026-10-20"] == "unknown" and states["2026-10-21"] == "done" and states["2026-10-26"] == "missed"
    assert (calendar["streak_now"], calendar["longest"], calendar["missed"]) == (1, 2, 4)


def test_wishes_take_pulls_numbers(store):
    keep(store, "primogem", "2026-10-02 10:00:00", 1, "Opened treasure chest")
    keep(store, "primogem", "2026-10-03 10:00:00", 500, "Event reward")
    keep(store, "primogem", "2026-10-04 10:00:00", 90, "Blessing of the Welkin Moon daily reward")
    run = store.start_wish_import(datetime(2026, 10, 20, tzinfo=timezone.utc))
    for n, (pool, when) in enumerate([
        ("character", "2026-10-05 10:00:00"), ("weapon", "2026-10-10 10:00:00"), ("standard", "2026-10-11 10:00:00"),
        ("character", "2026-10-01 03:00:00"),  # September's last game day, but October on the server's clock
        ("character", "2026-09-30 10:00:00"),
    ]):
        at = datetime.strptime(when, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO)
        store.add_wishes([WishRow(900 + n, UID, "301", pool, "Item", "Character", 3, when, at, run)])
    pity = {"now": 41, "soft": 74, "hard": 90}
    wishes = ledger(store, estimate=estimate(pulls=37), pity=pity)["wishes"]
    assert wishes == {"earned": 3, "made": 4, "in_hand": 37, "pity": pity}  # (500 + 90) // 160; Pulls' month is the clock's
    # With no balance typed and no pity, Pulls gives none and the card says so.
    assert ledger(store)["wishes"] == {"earned": 3, "made": 4, "in_hand": None, "pity": None}


def test_spent_month_total_and_note(store):
    assert ledger(store)["spent"]["month_note"] == "nothing" and ledger(store)["spent"]["month_total"] == 0.0
    keep(store, "crystal", "2026-09-02 10:00:00", 300, "Purchased Blessing of the Welkin Moon")
    assert ledger(store)["spent"]["month_note"] == "nothing"  # last month's does not count
    keep(store, "crystal", "2026-10-05 10:00:00", 300, "Purchased Blessing of the Welkin Moon")
    spent = ledger(store, Settings(spending_currency="EUR"))["spent"]
    assert (spent["month_total"], spent["month_note"]) == (DEFAULT_PRICES["EUR"]["welkin"], "one Welkin")
    keep(store, "crystal", "2026-10-06 10:00:00", 1960, "Obtained via purchase")
    keep(store, "crystal", "2026-10-07 10:00:00", 1090, "Obtained via purchase")
    spent = ledger(store, Settings(spending_currency="EUR"))["spent"]
    assert spent["month_note"] == "one Welkin and two crystal packs"
    assert spent["month_total"] == round(DEFAULT_PRICES["EUR"]["welkin"] + 2 * DEFAULT_PRICES["EUR"]["c980"], 2)
    keep(store, "primogem", "2026-10-08 10:00:00", 680, "BP reward")
    assert ledger(store)["spent"]["month_note"] == "one Welkin, two crystal packs and one Gnostic Hymn"


# ---------------------------------------------------------------- the other views: crystals, resin and artifacts

WK = "Purchased Blessing of the Welkin Moon"
EXCHANGE = "Exchanged Genesis Crystals for Primogems"
TREE = "Revitalized Petrified Tree (Domain)"


def days_of(model, block: str) -> dict:
    return {entry["day"]: entry for entry in model[block]}


def test_every_new_block_runs_over_the_same_six_months(store):
    keep(store, "primogem", "2026-10-26 10:00:00", 60, "Daily Commission reward")
    model = ledger(store)
    for block in ("crystal_days", "resin_days", "artifact_days"):
        assert [entry["day"] for entry in model[block]] == [entry["day"] for entry in model["days"]], block
        assert not any(entry["known"] for entry in model[block]), block  # no entry of that kind: nothing is known


def test_crystal_days_are_bought_and_spent(store):
    keep(store, "crystal", "2026-10-01 10:00:00", 300, WK)  # the log's oldest entry: that day is cut part-way
    keep(store, "crystal", "2026-10-02 10:00:00", 300, WK)
    keep(store, "crystal", "2026-10-09 19:42:00", 1090, "Obtained via purchase")
    keep(store, "crystal", "2026-10-09 19:48:00", -1090, EXCHANGE)
    keep(store, "crystal", "2026-10-12 21:05:00", -60, "Shop purchase")
    keep(store, "crystal", "2026-10-13 03:30:00", -60, "Shop purchase")  # before 04:00: still the 12th
    days = days_of(ledger(store), "crystal_days")
    assert set(days["2026-10-02"]) == {"day", "known", "bought", "welkin", "spent", "by_use", "held"}
    assert (days["2026-10-01"]["known"], days["2026-10-01"]["bought"]) == (False, 0)
    assert (days["2026-10-02"]["known"], days["2026-10-02"]["bought"], days["2026-10-02"]["welkin"]) == (True, 300, 300)
    nine = days["2026-10-09"]
    assert (nine["bought"], nine["welkin"], nine["spent"], nine["by_use"]) == (1090, 0, 1090, {"exchange": 1090})
    twelve = days["2026-10-12"]
    assert (twelve["spent"], twelve["by_use"]) == (120, {"shop": 120})
    # Past the newest entry of the log (and the newest primogem entry) nothing is known.
    assert days["2026-10-13"]["known"] is False and days["2026-10-27"]["known"] is False


def test_a_kinds_days_end_at_its_own_newest_entry(store):
    # The crystal log's import stopped on the 3rd while the primogems' went on: nothing is known of the crystals after it.
    keep(store, "crystal", "2026-10-02 10:00:00", 300, WK)
    keep(store, "crystal", "2026-10-03 10:00:00", 300, WK)
    keep(store, "primogem", "2026-10-27 10:00:00", 60, "Daily Commission reward")
    days = days_of(ledger(store), "crystal_days")
    assert days["2026-10-03"]["known"] is True and days["2026-10-03"]["bought"] == 300
    assert days["2026-10-04"]["known"] is False and days["2026-10-27"]["known"] is False and days["2026-10-02"]["known"] is False


def test_a_weekly_boss_is_neither_a_domain_run_nor_a_five_star_chance(store):
    # A Trounce Domain is written "(Domain)" and costs 30 or 60: counted as 3 domain runs, a 60 would halve the luck per run.
    keep(store, "resin", "2026-10-20 10:00:00", -20, "Ley Line Blossom challenge reward")  # the oldest
    keep(store, "resin", "2026-10-21 10:00:00", -20, TREE)
    keep(store, "resin", "2026-10-21 10:05:00", -60, "Confront Stormterror (Domain)")
    keep(store, "resin", "2026-10-21 10:10:00", -40, "Trounce Blossom challenge reward")
    keep(store, "artifact", "2026-10-21 10:01:00", 1, TREE, "Flower", 5)
    model = ledger(store)
    day = days_of(model, "resin_days")["2026-10-21"]
    assert day["by_use"] == {"domain": 20, "weekly": 60, "boss": 40}
    assert day["runs"] == {"domain": 1, "weekly": 1, "boss": 1}
    assert model["resin_month"]["domain_runs"] == 1 and model["resin_month"]["weekly"] == {"cheap": 0, "full": 1, "other": 0}
    assert model["artifact_month"]["runs"] == 1 and model["artifact_month"]["per_run"] == 1.0
    assert model["artifacts"]["runs"] == 1  # the 30 days' luck counts it the same way


def test_crystal_days_carry_a_held_that_is_none_until_a_balance_answers(store, monkeypatch):
    from guildboard.ledger import balances

    keep(store, "crystal", "2026-10-02 10:00:00", 300, WK)
    keep(store, "crystal", "2026-10-03 10:00:00", 300, WK)
    days = ledger(store)["crystal_days"]
    assert {day["held"] for day in days} == {None}  # no crystal balance is kept today
    asked = []

    def typed(kind, days, **more):
        asked.append(kind)
        return {day: 1_000 + index for index, day in enumerate(days)} if kind == "crystal" else None

    monkeypatch.setattr(balances, "held_by_day", typed)
    held = ledger(store)["crystal_days"]
    assert "crystal" in asked and held[0]["held"] == 1_000 and held[-1]["held"] == 1_000 + len(held) - 1


def test_resin_days_by_use_and_runs(store):
    keep(store, "resin", "2026-10-20 03:50:00", -20, TREE)  # the oldest: the 19th, cut part-way
    keep(store, "resin", "2026-10-21 10:00:00", -40, TREE)  # a condensed run: two
    keep(store, "resin", "2026-10-21 10:05:00", -20, TREE)
    keep(store, "resin", "2026-10-21 10:10:00", -20, "Ley Line Blossom challenge reward")
    keep(store, "resin", "2026-10-21 10:15:00", -40, "Anemo Hypostasis challenge reward")
    keep(store, "resin", "2026-10-21 10:20:00", -30, "Confront Stormterror (Domain)")
    keep(store, "resin", "2026-10-21 10:25:00", -40, "Item crafting material")
    keep(store, "resin", "2026-10-22 03:59:00", -20, TREE)  # still the 21st
    keep(store, "resin", "2026-10-22 04:00:00", -20, TREE)
    days = days_of(ledger(store), "resin_days")
    assert days["2026-10-19"]["known"] is False and days["2026-10-20"]["known"] is True  # the 19th is cut part-way
    twenty_one = days["2026-10-21"]
    assert set(twenty_one) == {"day", "known", "spent", "by_use", "runs"}
    assert twenty_one["known"] is True and twenty_one["spent"] == 40 + 20 + 20 + 40 + 30 + 40 + 20
    assert twenty_one["by_use"] == {"domain": 80, "ley": 20, "boss": 40, "weekly": 30, "condensed": 40}
    assert twenty_one["runs"] == {"domain": 4, "ley": 1, "boss": 1, "weekly": 1, "condensed": 1}
    assert days["2026-10-22"]["spent"] == 20
    assert days["2026-10-23"]["known"] is False  # the log ends the 22nd and no primogem entry reaches further


def test_artifact_days_count_five_stars_only(store):
    keep(store, "artifact", "2026-10-19 10:00:00", 1, TREE, "Flower", 5)  # the oldest
    keep(store, "artifact", "2026-10-21 10:00:00", 1, TREE, "Flower of Life", 5)
    keep(store, "artifact", "2026-10-21 10:01:00", 1, TREE, "Plume", 4)
    keep(store, "artifact", "2026-10-21 10:02:00", 1, "Obtained from Mystic Offering", "Sands", 5)
    keep(store, "artifact", "2026-10-21 21:40:00", -1, "Artifact enhancement material", "Goblet", 5)
    keep(store, "artifact", "2026-10-21 21:41:00", -1, "Artifact enhancement material", "Circlet", 4)
    keep(store, "artifact", "2026-10-21 22:05:00", -1, "Artifact decomposition", "Cup", 5)
    keep(store, "artifact", "2026-10-22 03:00:00", 1, TREE, "Night", 5)  # the 21st
    keep(store, "primogem", "2026-10-27 10:00:00", 60, "Daily Commission reward")
    days = days_of(ledger(store), "artifact_days")
    day = days["2026-10-21"]
    assert set(day) == {"day", "known", "five_domain", "five_other", "fed", "salvaged", "names"}
    assert (day["five_domain"], day["five_other"], day["fed"], day["salvaged"]) == (2, 1, 1, 1)
    assert day["names"] == ["Flower of Life", "Sands", "Night"]
    assert days["2026-10-20"]["known"] is True and days["2026-10-20"]["five_domain"] == 0
    assert days["2026-10-19"]["known"] is False


def test_the_crystal_month(store):
    keep(store, "crystal", "2026-10-05 10:00:00", 300, WK)
    keep(store, "crystal", "2026-10-09 10:00:00", 1090, "Obtained via purchase")
    keep(store, "crystal", "2026-10-20 10:00:00", 3880, "Obtained via purchase")
    month = ledger(store)["crystal_month"]
    # A single Welkin: 30 days from the day it was bought.
    assert month["welkin"] == {"start": "2026-10-05", "end": "2026-11-03", "days": 30}
    assert month["packs"] == [
        {"day": "2026-10-09", "label": "980 + 110 Genesis Crystals"},
        {"day": "2026-10-20", "label": "3280 + 600 Genesis Crystals"},
    ]
    later = build_ledger(store, UID, SERVER, date(2026, 12, 20), Settings(), {"state": "idle"})["crystal_month"]
    assert later == {"welkin": None, "packs": []}  # it ran out, and nothing was bought this month


def test_a_welkin_bought_while_one_runs_stacks_after_it(store):
    keep(store, "crystal", "2026-10-01 10:00:00", 300, WK)  # 1 to 30 October
    keep(store, "crystal", "2026-10-25 10:00:00", 300, WK)  # day 25 of it: adds 30 days after the 30th
    welkin = ledger(store)["crystal_month"]["welkin"]
    assert welkin == {"start": "2026-10-01", "end": "2026-11-29", "days": 60}
    # Bought twice on the same day, the game stacks both.
    keep(store, "crystal", "2026-10-26 10:00:00", 300, WK)
    assert ledger(store)["crystal_month"]["welkin"] == {"start": "2026-10-01", "end": "2026-12-29", "days": 90}


def test_a_welkin_bought_after_the_last_ran_out_starts_a_block_of_its_own(store):
    keep(store, "crystal", "2026-09-01 10:00:00", 300, WK)  # 1 to 30 September
    keep(store, "crystal", "2026-10-05 10:00:00", 300, WK)
    assert ledger(store)["crystal_month"]["welkin"] == {"start": "2026-10-05", "end": "2026-11-03", "days": 30}
    # Bought while it runs: it stacks, one block.
    keep(store, "crystal", "2026-10-06 10:00:00", 300, WK)
    assert ledger(store)["crystal_month"]["welkin"] == {"start": "2026-10-05", "end": "2026-12-03", "days": 60}
    # With only the September one, nothing runs today.
    only = build_ledger(store, UID, SERVER, date(2026, 10, 4), Settings(), {"state": "idle"})["crystal_month"]
    assert only["welkin"] is None


def test_resin_and_artifact_months(store):
    valley = "Valley of Remembrance (Domain)"
    keep(store, "resin", "2026-09-30 10:00:00", -20, TREE)  # last month: not counted
    keep(store, "resin", "2026-10-05 10:00:00", -40, TREE)
    keep(store, "resin", "2026-10-05 10:05:00", -20, valley)
    keep(store, "resin", "2026-10-05 10:10:00", -20, "Violet Court (Domain)")  # a talent domain
    keep(store, "resin", "2026-10-05 10:15:00", -30, "Confront Stormterror (Domain)")  # a weekly boss: no domain run
    keep(store, "resin", "2026-10-05 10:16:00", -60, "Confront Stormterror (Domain)")
    keep(store, "resin", "2026-10-05 10:17:00", -40, "Trounce Blossom challenge reward")  # a boss
    for rarity in (5, 5, 4):
        keep(store, "artifact", "2026-10-05 10:06:00", 1, TREE, "Flower", rarity)
    keep(store, "artifact", "2026-10-05 10:07:00", 1, valley, "Plume", 4)
    resin = ledger(store)["resin_month"]
    assert resin == {
        "domains": [
            {"name": "Revitalized Petrified Tree", "runs": 2, "artifacts": True},
            {"name": "Valley of Remembrance", "runs": 1, "artifacts": True},
            {"name": "Violet Court", "runs": 1, "artifacts": False},
        ],
        "domain_runs": 4, "artifact_runs": 3, "weekly": {"cheap": 1, "full": 1, "other": 0},
    }
    artifacts = ledger(store)["artifact_month"]
    assert artifacts == {
        "domains": [
            {"name": "Revitalized Petrified Tree", "five": 2, "runs": 2},
            {"name": "Valley of Remembrance", "five": 0, "runs": 1},
        ],
        "runs": 3, "five_domain": 2, "per_run": 0.67, "typical": 1.07,
    }


def test_the_blocks_are_empty_for_no_account(store):
    model = build_ledger(store, None, SERVER, TODAY, Settings(), {"state": "idle"})
    assert not any(entry["known"] for entry in model["resin_days"] + model["crystal_days"] + model["artifact_days"])
    assert model["resin_month"]["domains"] == [] and model["artifact_month"]["per_run"] is None
    assert model["crystal_month"] == {"welkin": None, "packs": []}


def test_history_rows_name_their_own_sources(store):
    keep(store, "crystal", "2026-10-09 19:42:00", 1090, "Obtained via purchase")
    keep(store, "crystal", "2026-10-09 19:48:00", -1090, EXCHANGE)
    keep(store, "crystal", "2026-10-12 21:05:00", -60, "Shop purchase")
    keep(store, "resin", "2026-10-12 21:05:00", -20, TREE)
    keep(store, "resin", "2026-10-12 21:06:00", -40, "Item crafting material")
    keep(store, "artifact", "2026-10-12 21:07:00", 1, TREE, "Flower", 5)
    keep(store, "artifact", "2026-10-12 21:08:00", -1, "Artifact enhancement material", "Plume", 5)
    keep(store, "primogem", "2026-10-12 21:09:00", -50, "Original Resin replenishment")

    def sources(kind: str) -> list[str]:
        return [entry["source"] for entry in history(store, UID, kind, None, 10)["entries"]]

    assert sources("crystal") == ["shop", "exchange", "bought"]
    assert sources("resin") == ["condensed", "domain"]
    assert sources("artifact") == ["fed", "domain"]
    assert sources("primogem") == ["resin"]
    crystals = history(store, UID, "crystal", None, 10)["entries"]
    assert [entry["detail"] for entry in crystals] == ["", "", "980 + 110 Genesis Crystals"]


def test_history_can_keep_five_stars_only(store):
    for rarity, day in ((5, 11), (4, 11), (5, 12), (3, 12)):
        keep(store, "artifact", f"2026-10-{day} 21:07:00", 1, TREE, "Flower", rarity)
    rows = history(store, UID, "artifact", None, 10, 5)["entries"]
    assert [entry["rarity"] for entry in rows] == [5, 5]
    page = history(store, UID, "artifact", None, 1, 5)
    assert len(page["entries"]) == 1 and page["more"] is True


def test_a_page_of_history_ends_at_the_edge_of_a_game_day(store):
    # 6 chests on the 20th (one after midnight, before 04:00, still the 20th), 2 on the 19th, 1 on the 18th: a page of 4
    # would end inside the 20th; it reads on to the day's end, so the day's net and its folded chests are whole.
    keep(store, "primogem", "2026-10-18 12:00:00", 5, "Opened treasure chest")
    keep(store, "primogem", "2026-10-19 12:00:00", 5, "Opened treasure chest")
    keep(store, "primogem", "2026-10-19 13:00:00", 5, "Opened treasure chest")
    for hour in ("10:00:00", "11:00:00", "12:00:00", "13:00:00", "14:00:00"):
        keep(store, "primogem", f"2026-10-20 {hour}", 10, "Opened treasure chest")
    keep(store, "primogem", "2026-10-21 02:30:00", 10, "Opened treasure chest")  # the 20th still
    first = history(store, UID, "primogem", None, 4)
    assert [entry["time"][:10] for entry in first["entries"]] == ["2026-10-21"] + ["2026-10-20"] * 5
    assert first["more"] is True
    rest = history(store, UID, "primogem", int(first["entries"][-1]["id"]), 4)
    assert [entry["time"][:10] for entry in rest["entries"]] == ["2026-10-19", "2026-10-19", "2026-10-18"]
    assert rest["more"] is False
    # A log that is nothing but one day: the page reads to its end, and there is no more.
    whole = history(store, UID, "primogem", int(rest["entries"][-1]["id"]) + 1, 1)
    assert [entry["time"][:10] for entry in whole["entries"]] == ["2026-10-18"] and whole["more"] is False


def test_a_page_that_ends_on_an_edge_says_more_only_if_there_is(store):
    keep(store, "resin", "2026-10-19 12:00:00", -20, TREE)
    keep(store, "resin", "2026-10-20 12:00:00", -20, TREE)
    keep(store, "resin", "2026-10-20 13:00:00", -20, TREE)
    page = history(store, UID, "resin", None, 1)
    assert len(page["entries"]) == 2 and page["more"] is True
    assert history(store, UID, "resin", None, 3)["more"] is False


def test_the_history_route_takes_a_rank(tmp_path, clock):
    core = _core(tmp_path, clock)
    try:
        with opened(core) as client:
            assert client.get("/api/ledger/history?kind=artifact&rank=5").status_code == 200
            assert client.get("/api/ledger/history?kind=artifact&rank=2").status_code == 422
    finally:
        core.store.close()


def test_pulls_balance_of_another_account_is_not_the_ledgers(tmp_path, clock):
    # The ledger shows the login's account; Pulls shows the one whose wishes were imported last. Another account's typed
    # balance must not stand for this one's.
    other = 800000002
    core = _core(tmp_path, clock)
    try:
        core.store.set_meta("account_uid", str(UID))
        keep(core.store, "primogem", "2026-10-25 10:00:00", 60, "Daily Commission reward")
        keep(core.store, "primogem", "2026-10-26 10:00:00", 60, "Daily Commission reward")
        run = core.store.start_wish_import(datetime(2026, 10, 20, tzinfo=timezone.utc))
        when = datetime(2026, 10, 5, 10, tzinfo=EURO)
        core.store.add_wishes(
            [WishRow(1, other, "301", "character", "Item", "Character", 3, "2026-10-05 10:00:00", when, run)]
        )
        assert core.pulls.uid() == other and core.ledger_uid() == UID
        core.pulls.set_balance(5000, 3)
        model = core.ledger()
        assert model["uid"] == UID
        assert {day["held"] for day in model["days"]} == {None}
        assert model["wishes"]["in_hand"] is None and model["wishes"]["pity"] is None
    finally:
        core.store.close()


# ---------------------------------------------------------------- the routes, and the demo

def _core(tmp_path: Path, clock, *, demo: bool = False) -> Core:
    return Core(
        AppPaths(tmp_path / "data"), demo=demo, clock=clock, source=None if demo else AccountSource(),
        sleep=FakeSleep(clock), process_lister=lambda: set(),
    )


@contextmanager
def opened(core: Core):
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


def test_the_history_route_refuses_what_it_does_not_know(tmp_path, clock):
    core = _core(tmp_path, clock)
    try:
        with opened(core) as client:
            for query in ("kind=weapon", "kind=resin&before=x", "kind=resin&before=99999999999999999999"):
                assert client.get(f"/api/ledger/history?{query}").status_code == 422, query
            answer = client.get("/api/ledger/history?kind=resin&limit=500").json()
            assert answer == {"entries": [], "more": False}
            assert client.get("/api/ledger").json()["empty"] is True
    finally:
        core.store.close()


def test_the_api_never_returns_a_key(tmp_path, clock):
    from guildboard.pulls.importer import _Kept
    from ledger_samples import csc_link

    marker = "API-CSC-MARKER-0123456789"
    core = _core(tmp_path, clock)
    try:
        core.wish_import._kept_ledger = _Kept(csc_link(marker), clock.now() + timedelta(hours=1), uid=UID)
        with opened(core) as client:
            body = client.get("/api/ledger").text
            assert marker not in body and '"auto": {' in body.replace('":{', '": {')
            assert marker not in client.get("/api/pulls").text
    finally:
        core.wish_import._kept_ledger = None
        core.store.close()


def test_import_model_cadence_follows_the_login(tmp_path, clock):
    core = _core(tmp_path, clock)
    try:
        for login, run_state, minutes in (
            ("on", "on", 30), ("on", "minting", 30), ("on", "failed", 30), ("refused", "on", None), (None, "on", None),
        ):
            core.wish_import._login = lambda login=login: login
            core.wish_import._login_run = run_state
            assert core.ledger()["import"]["every_minutes"] == minutes, (login, run_state)
    finally:
        core.store.close()


def test_the_ledgers_cadence_holds_while_its_own_kept_link_lives(tmp_path, clock):
    # The core's AUTO_EVERY update reads the Feedback link too (WishImporter.auto_update): the ledger page updates itself
    # while its link lives, with no login and no wish link. The Pulls page does not.
    from guildboard.pulls.importer import _Kept
    from ledger_samples import csc_link

    core = _core(tmp_path, clock)
    try:
        run = core.wish_import
        run._login = lambda: None
        assert core.ledger()["import"]["every_minutes"] is None
        run._kept_ledger = _Kept(csc_link("MARKER-KEY-0123456789"), clock.now() + timedelta(hours=1), uid=UID)
        assert core.ledger()["import"]["every_minutes"] == 30
        assert run.state()["every_minutes"] is None  # the Pulls page's block is its wish link's and the login's alone
        clock.advance(hours=1)  # the link's day is over
        assert core.ledger()["import"]["every_minutes"] is None
    finally:
        core.wish_import._kept_ledger = None
        core.store.close()


def test_demo_ledger_is_full(tmp_path, clock):
    core = _core(tmp_path, clock, demo=True)
    try:
        with opened(core) as client:
            model = client.get("/api/ledger").json()
            assert model["empty"] is False and model["uid"] == UID and model["last_import"] is not None
            assert model["spent"]["welkins"] >= 3 and model["spent"]["packs"] == 2 and model["spent"]["total"] > 0
            assert model["month"]["earned"] > 0 and model["month"]["top_out"]
            assert model["artifacts"]["five_domain"] > 0 and model["artifacts"]["per_run"] is not None
            # Every new block is filled on the demo's data.
            days = model["days"]
            assert len(days) > 150 and days[-1]["known"] is True
            assert all(day["held"] is not None for day in days) and any(day["moments"] for day in days)
            assert days[-1]["held"] == core.pulls.balance_estimate().primogems
            month = model["month"]
            assert month["sources"] and month["previous"]["earned"] > 0 and month["fates_bought"] >= 0
            assert sum(source["amount"] for source in month["sources"]) == month["earned"]
            commissions = model["commissions"]
            assert {"done", "missed"} <= {day["state"] for day in commissions["days"]}
            assert commissions["longest"] >= commissions["streak_now"] >= 0 and commissions["longest"] > 0
            wishes = model["wishes"]
            assert wishes["earned"] == month["earned"] // 160 and wishes["made"] > 0
            assert wishes["in_hand"] == core.pulls.balance_estimate().pulls
            assert wishes["pity"] == {"now": core.pulls.states(UID)["character"].pity, "soft": 74, "hard": 90}
            assert model["spent"]["month_total"] >= 0 and model["spent"]["month_note"]
            for kind in ("primogem", "crystal", "resin", "artifact"):
                assert client.get(f"/api/ledger/history?kind={kind}").json()["entries"], kind
            # The bosses and the weekly bosses' Trounce Domains are in the demo's resin, the shop's crystals under its reason.
            resin_uses = {use for day in model["resin_days"] for use in day["by_use"]}
            assert {"domain", "boss", "weekly", "condensed"} <= resin_uses
            shop = [entry for entry in client.get("/api/ledger/history?kind=crystal&limit=100").json()["entries"] if entry["source"] == "shop"]
            assert shop and {entry["reason"] for entry in shop} == {"Shop purchase"}
            days = client.get("/api/stats?range=30").json()["primogem_days"]
            welkin = [column["groups"]["welkin"] for column in days["columns"] if "groups" in column]
            assert len(welkin) >= 29 and set(welkin[:-1]) == {90}
            assert client.post("/api/pulls/import").json() == {"started": True}
            for _ in range(500):
                if not core.wish_import.running:
                    break
                import time
                time.sleep(0.01)
            assert core.wish_import.ledger_state()["state"] == "done"
            assert core.wish_import.ledger_state()["message"] is not None
    finally:
        core.store.close()
