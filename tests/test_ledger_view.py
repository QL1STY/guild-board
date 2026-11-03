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
from guildboard.store import LedgerRow
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


def ledger(store, settings=None):
    return build_ledger(store, UID, SERVER, TODAY, settings or Settings(), {"state": "idle"})


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
    keep(store, "primogem", "2026-10-02 10:00:00", 60, "Daily Commission reward")
    keep(store, "primogem", "2026-10-02 11:00:00", 90, "Blessing of the Welkin Moon daily reward")
    keep(store, "primogem", "2026-10-03 11:00:00", 1090, "Exchanged Genesis Crystals for Primogems")
    keep(store, "primogem", "2026-10-04 11:00:00", -3200, "Shop purchase")
    keep(store, "primogem", "2026-10-05 11:00:00", -50, "Original Resin replenishment")
    keep(store, "primogem", "2026-10-01 03:59:00", 999, "Event reward")  # September's last game day
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
    first = build_history(store, UID, "resin", None, 3)
    assert [entry["time"] for entry in first["entries"]] == [
        "2026-10-24 10:00:00", "2026-10-23 10:00:00", "2026-10-22 10:00:00",
    ]
    assert first["more"] is True and isinstance(first["entries"][0]["id"], str)
    assert set(first["entries"][0]) == {"id", "time", "reason", "name", "rarity", "amount"}
    rest = build_history(store, UID, "resin", int(first["entries"][-1]["id"]), 3)
    assert len(rest["entries"]) == 2 and rest["more"] is False


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
            for kind in ("primogem", "crystal", "resin", "artifact"):
                assert client.get(f"/api/ledger/history?kind={kind}").json()["entries"], kind
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
