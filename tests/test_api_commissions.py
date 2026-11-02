from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.metrics import Label
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
UNKNOWN_REGION = "Unknown region. Use mondstadt, liyue, inazuma, sumeru, fontaine or natlan."
NOT_A_COMMISSION = "This achievement is not a daily commission one."
MARKED = "Marked All's Well That Ends Well as appeared today"


@pytest.fixture
def core(tmp_path, clock):
    paths = AppPaths(tmp_path / "data")
    core = Core(paths, demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


def _events(queue) -> list[str]:
    seen = []
    while not queue.empty():
        seen.append(queue.get_nowait()["type"])
    return seen


def _card(client, stage_id: int) -> dict:
    model = client.get("/api/commissions").json()
    return next(card for card in model["cards"] + model["done"] if card["id"] == stage_id)


def test_the_model_opens_on_the_region_in_settings(client):
    model = client.get("/api/commissions").json()
    assert model["region"] == "liyue"
    # What the demo has left in Liyue, in the list's order.
    assert [card["name"] for card in model["cards"]] == ["Pirates! Argh!", "All's Well That Ends Well", "Swordseeker"]
    assert [region["key"] for region in model["regions"]] == [
        "mondstadt", "liyue", "inazuma", "sumeru", "fontaine", "natlan",
    ]
    client.put("/api/settings", json={"commission_region": "sumeru"})
    assert client.get("/api/commissions").json()["region"] == "sumeru"
    assert client.get("/api/commissions", params={"region": "inazuma"}).json()["region"] == "inazuma"


def test_the_model_names_the_regions_emblem_where_exploration_gave_it_a_picture(client, core, clock):
    # The demo's regions have no picture, so there is no address to name: the Board's widget draws the region's sign.
    assert client.get("/api/commissions").json()["region_icon"] is None
    emblem = Label("explore.3", "Liyue", "region", None, "https://act-webstatic.hoyoverse.com/emblem.png", 1)
    core.store.upsert_labels([emblem], clock.now())
    assert client.get("/api/commissions").json()["region_icon"] == "/api/icon/explore.3"
    assert client.get("/api/commissions", params={"region": "inazuma"}).json()["region_icon"] is None


def test_an_unknown_region_is_refused(client):
    for region in ("snezhnaya", "Liyue", ""):
        answer = client.get("/api/commissions", params={"region": region})
        assert (answer.status_code, answer.json()) == (422, {"error": UNKNOWN_REGION}), region


def test_appeared_today_is_answered_once_a_game_day_and_undo_takes_it_back(client, core):
    queue = core.bus.subscribe()
    answer = client.post("/api/commissions/84524/appeared")
    assert (answer.status_code, answer.json()) == (200, {"change": MARKED})
    assert _events(queue) == ["achievements_changed"]
    assert (_card(client, 84524)["appeared_today"], _card(client, 84524)["last_appeared"]) == (True, "2026-10-13")
    again = client.post("/api/commissions/84524/appeared")
    assert (again.status_code, again.json()) == (409, {"error": "It is marked as appeared today already."})
    assert _events(queue) == []  # a refusal tells the pages nothing
    assert client.post("/api/achievements/undo").json() == {"undone": MARKED, "more": False}
    assert (_card(client, 84524)["appeared_today"], _card(client, 84524)["last_appeared"]) == (False, None)


def test_the_models_today_turns_at_4_oclock_server_time(client, clock):
    clock.set(datetime(2026, 10, 14, 2, 59, tzinfo=timezone.utc))  # 03:59 on the demo's Europe server: still the 13th
    client.post("/api/commissions/84524/appeared")
    assert client.get("/api/commissions").json()["today"] == "2026-10-13"
    assert _card(client, 84524)["appeared_today"] is True
    clock.set(datetime(2026, 10, 14, 3, 0, tzinfo=timezone.utc))  # 04:00 server time: a new game day
    assert client.get("/api/commissions").json()["today"] == "2026-10-14"
    assert (_card(client, 84524)["appeared_today"], _card(client, 84524)["last_appeared"]) == (False, "2026-10-13")


def test_a_stage_that_is_not_a_commission_one_is_refused(client):
    for stage_id in (82055, 999999):  # the Unusual Hilichurl's first stage, and no achievement at all
        answer = client.post(f"/api/commissions/{stage_id}/appeared")
        assert (answer.status_code, answer.json()) == (404, {"error": NOT_A_COMMISSION})
