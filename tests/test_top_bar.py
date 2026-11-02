"""The core's fields for the top bar and the undo note (the top bar and undo design, sections 3, 4 and 6): the profile
picture, Resin's full time, the syncs today, the savings, and an undo that reaches only this visit."""
from __future__ import annotations

import hashlib
import re
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from guildboard import metrics
from guildboard.api.app import create_app
from guildboard.api.icons import IconCache
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.metrics import Label
from guildboard.records import OverviewRecord
from guildboard.sources import hoyolab_normalize as norm
from guildboard.sync.policy import DAILY_CAP, MIN_GAP
from hoyolab_samples import INDEX
from pulls_history import keep_demo_like
from support import AccountSource, FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
PICTURE = "https://act-webstatic.hoyoverse.com/x/head.png"


def _core(tmp_path, clock, *, demo: bool = True) -> Core:
    return Core(
        AppPaths(tmp_path / "data"), demo=demo, clock=clock, source=None if demo else AccountSource(),
        sleep=FakeSleep(clock), process_lister=lambda: set(),
    )


@pytest.fixture
def core(tmp_path, clock):
    core = _core(tmp_path, clock)
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


def _record(picture_url: str = "") -> OverviewRecord:
    return OverviewRecord("Traveler", "os_euro", 60, {}, (), picture_url=picture_url)


# ---------------------------------------------------------------- the profile picture
def test_overview_keeps_the_picture_link():
    raw = {**INDEX, "role": {**INDEX["role"], "game_head_icon": PICTURE}}
    assert norm.normalize_overview(raw).picture_url == PICTURE
    without = {**INDEX, "role": {key: value for key, value in INDEX["role"].items() if key != "game_head_icon"}}
    assert norm.normalize_overview(without).picture_url == ""


def test_overview_labels_the_picture():
    _, labels = metrics.overview(_record(PICTURE))
    assert Label("account.picture", "Profile picture", "account", None, PICTURE, 0) in labels
    _, labels = metrics.overview(_record(""))
    assert all(label.key != "account.picture" for label in labels)


def test_status_names_the_picture(core, clock):
    assert core.status()["account"]["picture_url"] is None  # the demo's record has no link
    doc = {"nickname": "Traveler", "adventure_rank": 60, "picture_url": PICTURE}
    core.store.set_latest_doc("overview", clock.now(), doc)
    digest = hashlib.sha256(PICTURE.encode()).hexdigest()[:8]
    assert core.status()["account"]["picture_url"] == f"/api/icon/account.picture?v={digest}"
    assert re.fullmatch(r"/api/icon/account\.picture\?v=[0-9a-f]{8}", core.status()["account"]["picture_url"])
    core.store.set_latest_doc("overview", clock.now(), {**doc, "picture_url": ""})
    assert core.status()["account"]["picture_url"] is None


def test_icon_route_refuses_a_picture_elsewhere(core, client, tmp_path, clock):
    def fetch(url: str) -> bytes:
        raise AssertionError(f"a picture from {url} must not be fetched")

    core.icons = IconCache(tmp_path / "icons", fetch)
    elsewhere = Label("account.picture", "Profile picture", "account", None, "https://example.com/head.png", 0)
    core.store.upsert_labels([elsewhere], clock.now())
    assert client.get("/api/icon/account.picture").status_code == 404


# ---------------------------------------------------------------- the syncs today, Resin, the savings
def test_status_counts_the_syncs_today(core, clock):
    before = core.status()["sync"]
    assert (before["daily_cap"], before["manual_gap_seconds"]) == (DAILY_CAP, int(MIN_GAP.total_seconds()))
    assert (before["daily_cap"], before["manual_gap_seconds"]) == (24, 300)
    assert before["runs_today"] == core.scheduler.runs_today()
    now = clock.now()
    for started in (now, now + timedelta(minutes=1), now - timedelta(days=3)):
        core.store.finish_run(core.store.start_run("manual", started), started, "ok")
    skipped = core.store.start_run("manual", now)
    core.store.finish_run(skipped, now, "skipped")  # a skipped run is no sync
    assert core.status()["sync"]["runs_today"] == before["runs_today"] + 2


def test_status_carries_resin_full_at(core, clock):
    notes = core.store.latest_doc("notes")[1]
    assert core.status()["account"]["resin_full_at"] == notes["resin_full_at"] is not None
    core.store.set_latest_doc("notes", clock.now(), {**notes, "resin_full_at": "2026-10-13T20:00:00+00:00"})
    assert core.status()["account"]["resin_full_at"] == "2026-10-13T20:00:00+00:00"
    core.store.set_latest_doc("notes", clock.now(), {**notes, "resin_full_at": None})
    assert core.status()["account"]["resin_full_at"] is None


def test_status_carries_the_savings(tmp_path, clock):
    core = _core(tmp_path, clock, demo=False)
    try:
        keep_demo_like(core.store)
        assert core.status()["savings"] is None  # no balance typed yet
        core.pulls.set_balance(12000, 3)
        assert core.status()["savings"] == {"primogems": 12000, "fates": 3, "pulls": 78}
    finally:
        core.store.close()


def test_a_planner_that_fails_does_not_fail_the_status(core, monkeypatch, caplog):
    def broken():
        raise RuntimeError("the planner broke")

    monkeypatch.setattr(core.pulls, "balance_estimate", broken)
    with caplog.at_level("ERROR", logger="guildboard.core"):
        status = core.status()
    assert status["savings"] is None  # the plate falls back to "Set on Pulls"; everything else still answers
    assert status["sync"]["state"] is not None
    assert "the savings could not be worked out" in caplog.text


def test_no_balance_typed_reads_no_wishes(tmp_path, clock, monkeypatch):
    core = _core(tmp_path, clock, demo=False)
    try:
        keep_demo_like(core.store)
        monkeypatch.setattr(core.pulls, "_wishes", lambda uid: pytest.fail("the wishes are read without a balance"))
        assert core.pulls.balance_estimate() is None
    finally:
        core.store.close()


# ---------------------------------------------------------------- undo reaches only this visit
def test_undo_says_whether_more_is_left(client):
    client.post("/api/achievements/stage/81732", json={"status": "done"})
    client.post("/api/achievements/stage/81732", json={"status": "not_started"})
    first = client.post("/api/achievements/undo")
    assert first.json()["more"] is True
    last = client.post("/api/achievements/undo")
    assert last.json()["more"] is False
    assert last.json()["undone"]


async def test_undo_reaches_only_this_visit(tmp_path, clock):
    first = _core(tmp_path, clock)
    with TestClient(create_app(first, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": first.launch_secret}, follow_redirects=False)
        assert client.post("/api/achievements/stage/81732", json={"status": "done"}).status_code == 200
    first.store.close()
    second = _core(tmp_path, clock)  # a restart on the same data folder
    second.start()
    try:
        await second.scheduler.idle()
        with TestClient(create_app(second, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": second.launch_secret}, follow_redirects=False)
            nothing = client.post("/api/achievements/undo")
        assert nothing.status_code == 409 and nothing.json() == {"error": "There is nothing to undo."}
    finally:
        await second.stop()
