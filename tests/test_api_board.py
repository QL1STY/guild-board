import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import UNEXPECTED_REQUEST, create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
SHAPE = "A layout is a list of at most 60 widgets, each with an id, a type, a size and its settings."


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


def test_the_board_layout_is_read_and_saved_through_the_api(client, core):
    queue = core.bus.subscribe()
    widgets = client.get("/api/layouts/board").json()["widgets"]
    saved = client.put("/api/layouts/board", json={"revision": 0, "widgets": widgets[:2]}).json()
    assert (saved["revision"], saved["saved"], len(saved["widgets"])) == (1, True, 2)
    assert "layout_changed" in _events(queue)
    refused = client.put("/api/layouts/board", json={"revision": 0, "widgets": []})
    assert (refused.status_code, refused.json()) == (409, {"error": "The Board changed meanwhile. Look at it again."})
    assert client.get("/api/layouts/elsewhere").json() == {"error": "There is no such place."}
    assert client.get("/api/layouts/elsewhere").status_code == 404
    wrong = {"revision": "1", "widgets": []}
    assert client.put("/api/layouts/board", json=wrong).json() == {"error": UNEXPECTED_REQUEST}
    bad = client.put("/api/layouts/board", json={"revision": 1, "widgets": [{"id": "a"}]})
    assert bad.status_code == 422


def _places(queue) -> list[str]:
    """The place that each layout_changed event names."""
    seen = []
    while not queue.empty():
        event = queue.get_nowait()
        if event["type"] == "layout_changed":
            seen.append(event["place"])
    return seen


def test_the_overlay_layout_is_read_and_saved_through_the_api(client):
    start = client.get("/api/layouts/overlay").json()
    assert (start["place"], start["revision"], start["saved"]) == ("overlay", 0, False)
    assert [(widget["id"], widget.get("pinned")) for widget in start["widgets"]] == [
        ("start-ov-timers", True), ("start-ov-clock", None), ("start-ov-quick", None), ("start-ov-commissions", None),
    ]
    widgets = [{**start["widgets"][1], "pinned": True}, {**start["widgets"][2], "pinned": False}]
    saved = client.put("/api/layouts/overlay", json={"revision": 0, "widgets": widgets}).json()
    assert (saved["revision"], saved["saved"], saved["widgets"]) == (1, True, widgets)
    assert client.get("/api/layouts/overlay").json() == saved
    assert client.get("/api/layouts/board").json()["revision"] == 0  # the Board is a layout of its own
    stale = client.put("/api/layouts/overlay", json={"revision": 0, "widgets": []})
    assert (stale.status_code, stale.json()) == (409, {"error": "The overlay changed meanwhile. Look at it again."})
    for pinned in ("yes", 1, None):  # a widget is pinned or it is not
        bad = client.put("/api/layouts/overlay", json={"revision": 1, "widgets": [{**widgets[0], "pinned": pinned}]})
        assert (bad.status_code, bad.json()) == (422, {"error": SHAPE})
    assert client.get("/api/layouts/overlay").json() == saved


def test_a_save_says_which_place_changed(client, core):
    queue = core.bus.subscribe()
    assert client.put("/api/layouts/overlay", json={"revision": 0, "widgets": []}).status_code == 200
    assert client.put("/api/layouts/board", json={"revision": 0, "widgets": []}).status_code == 200
    timer = client.get("/api/timers").json()["timers"][0]["id"]
    assert client.post(f"/api/timers/{timer}/pin", json={"on": True}).json() == {"pinned": True}
    assert _places(queue) == ["overlay", "board", "board"]  # a pin puts a widget on the Board
    assert client.put("/api/layouts/overlay", json={"revision": 0, "widgets": []}).status_code == 409
    assert _places(queue) == []  # a save that is refused changes nothing


def test_the_launch_link_opens_the_overlay(core):
    with TestClient(create_app(core, PORT), base_url=BASE) as fresh:
        response = fresh.get("/launch", params={"k": core.launch_secret, "to": "overlay"}, follow_redirects=False)
        assert (response.status_code, response.headers["location"]) == (303, "/#/overlay")


def test_a_widgets_data_is_read_and_saved_through_the_api(client, core):
    queue = core.bus.subscribe()
    answer = client.put("/api/widgets/start-notes/data", json={"data": {"text": "Mint"}})
    assert answer.json() == {"data": {"text": "Mint"}}
    assert client.get("/api/widgets/start-notes/data").json() == {"data": {"text": "Mint"}}
    assert client.get("/api/widgets/start-clock/data").json() == {"data": None}
    assert _events(queue) == []  # only the widget reads its own data
    unknown = client.put("/api/widgets/notes-9/data", json={"data": {}})
    assert (unknown.status_code, unknown.json()) == (404, {"error": "There is no widget with this id."})
    assert client.put("/api/widgets/start-notes/data", json={"text": "Mint"}).json() == {"error": UNEXPECTED_REQUEST}


def test_quick_timers_through_the_api(client, core):
    queue = core.bus.subscribe()
    made = client.post("/api/quick-timers", json={"seconds": 300}).json()
    assert [item["id"] for item in client.get("/api/quick-timers").json()["quick_timers"]] == [made["id"]]
    assert "timers_changed" in _events(queue)
    refused = client.post("/api/quick-timers", json={"seconds": 0})
    assert (refused.status_code, refused.json()) == (422, {"error": "A quick timer runs from 1 second to 12 hours."})
    assert client.post("/api/quick-timers", json={}).json() == {"error": "A quick timer runs from 1 second to 12 hours."}
    assert client.delete(f"/api/quick-timers/{made['id']}").json() == {"dismissed": made["id"]}
    assert "timers_changed" in _events(queue)
    gone = client.delete(f"/api/quick-timers/{made['id']}")
    assert (gone.status_code, gone.json()) == (404, {"error": "There is no quick timer with this number."})


def test_the_board_model_through_the_api(client, core):
    assert client.get("/api/board").json() == core.board_model()
