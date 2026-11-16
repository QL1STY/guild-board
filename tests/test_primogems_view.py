"""The Primogems widget's model (the five widgets plan, Task 6; the widgets design, 2.2) and its route."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.store import DiaryActionRow, LedgerRow
from guildboard.views.primogems import build_primogems
from support import AccountSource, FakeSleep

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))
TODAY = date(2026, 10, 28)  # a Wednesday: the week began on Monday the 26th
PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"

_ids = iter(range(1, 100_000))


def keep(store, time: str, amount: int, reason: str, kind: str = "primogem") -> None:
    at = datetime.strptime(time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)
    store.keep_ledger_entries([LedgerRow(UID, kind, next(_ids), time, at, amount, reason, "", 0)])


def model(store, uid=UID, today=TODAY):
    return build_primogems(store, uid, SERVER, today)


def covering(store, first_day: str = "2026-10-01") -> None:
    """The game's log, its oldest entry on `first_day`: it covers whole the days after that one."""
    keep(store, f"{first_day} 10:00:00", 60, "Daily Commission reward")


def test_before_any_import_it_says_so_and_holds_nothing(store):
    assert model(store) == {
        "imported": False, "read_at": None, "today": None, "week": None, "days": None, "month": None,
    }
    assert model(store, uid=None)["imported"] is False


def test_crystals_alone_are_not_an_import_of_the_primogem_log(store):
    keep(store, "2026-10-20 10:00:00", 300, "Purchased Blessing of the Welkin Moon", kind="crystal")
    assert model(store)["imported"] is False


def test_today_and_the_week_are_the_sums_of_known_days(store):
    covering(store)
    keep(store, "2026-10-26 10:00:00", 60, "Daily Commission reward")
    keep(store, "2026-10-26 11:00:00", 800, "Spiral Abyss reward")
    keep(store, "2026-10-27 10:00:00", 60, "Daily Commission reward")
    keep(store, "2026-10-28 10:00:00", 160, "Event reward")
    keep(store, "2026-10-28 12:00:00", -1600, "Shop purchase")  # spending is never earned
    keep(store, "2026-10-28 13:00:00", 1090, "Exchanged Genesis Crystals for Primogems")  # bought is never earned
    result = model(store)
    assert result["imported"] is True
    assert result["today"] == 160 and result["week"] == 60 + 800 + 60 + 160


def test_the_week_starts_at_mondays_reset(store):
    covering(store)
    keep(store, "2026-10-25 10:00:00", 999, "Event reward")  # Sunday: last week's
    keep(store, "2026-10-26 02:00:00", 40, "Event reward")  # before Monday's 04:00: still Sunday's game day
    keep(store, "2026-10-26 04:00:00", 70, "Event reward")  # Monday's
    keep(store, "2026-10-28 10:00:00", 160, "Event reward")
    result = model(store)
    assert result["week"] == 70 + 160 and result["today"] == 160


def test_days_are_the_last_seven_game_days_today_last(store):
    covering(store)
    keep(store, "2026-10-22 10:00:00", 60, "Daily Commission reward")
    keep(store, "2026-10-28 10:00:00", 160, "Event reward")
    days = model(store)["days"]
    assert [day["day"] for day in days] == [f"2026-10-{n}" for n in range(22, 29)]
    assert days[0] == {"day": "2026-10-22", "earned": 60, "known": True}
    assert days[1] == {"day": "2026-10-23", "earned": 0, "known": True}  # covered, nothing came in: a real 0
    assert days[-1] == {"day": "2026-10-28", "earned": 160, "known": True}


def test_a_day_nothing_covers_is_not_known_and_adds_nothing(store):
    keep(store, "2026-10-24 10:00:00", 60, "Daily Commission reward")  # the oldest entry: its own day is cut part-way
    keep(store, "2026-10-28 10:00:00", 60, "Daily Commission reward")
    result = model(store)
    by_day = {day["day"]: day for day in result["days"]}
    assert by_day["2026-10-24"] == {"day": "2026-10-24", "earned": 0, "known": False}
    assert by_day["2026-10-22"]["known"] is False
    assert by_day["2026-10-26"] == {"day": "2026-10-26", "earned": 0, "known": True}
    assert by_day["2026-10-28"] == {"day": "2026-10-28", "earned": 60, "known": True}
    assert result["today"] == 60 and result["week"] == 60


def test_today_is_none_when_the_log_does_not_reach_it(store):
    covering(store)
    keep(store, "2026-10-26 10:00:00", 60, "Daily Commission reward")  # the newest entry: the 26th is the last covered day
    result = model(store)
    assert result["today"] is None and result["week"] is None
    assert result["days"][-1] == {"day": "2026-10-28", "earned": 0, "known": False}
    assert result["month"] is not None  # the month's other days are still known


def test_the_diary_covers_a_day_the_log_does_not(store):
    covering(store, "2026-10-26")
    keep(store, "2026-10-28 10:00:00", 60, "Daily Commission reward")
    when = datetime(2026, 10, 10, 12, 0, 0, tzinfo=EURO)
    store.keep_diary_actions(
        UID, [DiaryActionRow(UID, "2026-10-10 12:00:00", when.astimezone(timezone.utc), "Event reward", 420, 0)]
    )
    month = model(store)["month"]
    assert month["total"] == 420 + 60 and {s["group"]: s["amount"] for s in month["sources"]} == {
        "events": 420, "commissions": 60,
    }


def test_the_month_by_source_is_the_ledgers_largest_first(store):
    covering(store)
    keep(store, "2026-10-12 10:00:00", 60, "Daily Commission reward")
    keep(store, "2026-10-13 10:00:00", 60, "Daily Commission reward")
    keep(store, "2026-10-14 10:00:00", 800, "Spiral Abyss reward")
    keep(store, "2026-10-15 10:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "2026-10-16 10:00:00", 90, "Event reward")
    keep(store, "2026-10-17 10:00:00", 30, "Opened treasure chest")
    month = model(store)["month"]
    assert month["ym"] == "2026-10" and month["name"] == "October"
    assert month["sources"] == [  # largest first; the tie of 90 in GROUPS order; the covering entry's day is cut
        {"group": "endgame", "label": "Spiral Abyss and Theater", "amount": 800},
        {"group": "commissions", "label": "Daily commissions", "amount": 120},
        {"group": "welkin", "label": "Blessing of the Welkin Moon", "amount": 90},
        {"group": "events", "label": "Events", "amount": 90},
        {"group": "other", "label": "Other", "amount": 30},
    ]
    assert month["total"] == 800 + 120 + 90 + 90 + 30


def test_a_month_with_no_known_day_is_none(store):
    keep(store, "2026-09-01 10:00:00", 60, "Daily Commission reward")
    keep(store, "2026-09-05 10:00:00", 60, "Daily Commission reward")
    result = model(store, today=date(2026, 10, 28))
    # The log's newest entry is in September: October has no exact day.
    assert result["imported"] is True and result["month"] is None and result["today"] is None


def test_the_time_of_the_last_import_is_read_at(store):
    covering(store)
    assert model(store)["read_at"] is None
    when = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)
    store.record_ledger_import(UID, "primogem", when, 3, "ok", None)
    assert model(store)["read_at"] == "2026-10-28T09:00:00+00:00"


# ---------------------------------------------------------------- the route, and the demo

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


def test_the_route_before_an_import(tmp_path, clock):
    core = _core(tmp_path, clock)
    try:
        with opened(core) as client:
            answer = client.get("/api/primogems").json()
            assert answer["imported"] is False and answer["days"] is None and answer["month"] is None
    finally:
        core.store.close()


def test_the_demo_has_primogems_to_show(tmp_path, clock):
    core = _core(tmp_path, clock, demo=True)
    try:
        with opened(core) as client:
            answer = client.get("/api/primogems").json()
            ledger = client.get("/api/ledger").json()
            assert answer["imported"] is True and answer["read_at"] is not None
            assert len(answer["days"]) == 7 and answer["days"][-1]["day"] == ledger["days"][-1]["day"]
            assert answer["days"][-1]["earned"] == ledger["days"][-1]["earned"]
            assert answer["today"] == answer["days"][-1]["earned"] and answer["week"] >= answer["today"]
            assert answer["month"]["sources"] == ledger["month"]["sources"]
            assert answer["month"]["total"] == ledger["month"]["earned"]
    finally:
        core.store.close()
