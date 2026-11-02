import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import UNEXPECTED_REQUEST, create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from support import AccountSource, FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
DISPLAYS = [
    {"name": r"\\.\DISPLAY1", "label": "Display 1, 2560 x 1440 (main display)", "primary": True},
    {"name": r"\\.\DISPLAY2", "label": "Display 2, 1920 x 1080", "primary": False},
]


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


def _published(queue) -> list[dict]:
    seen = []
    while not queue.empty():
        seen.append(queue.get_nowait())
    return seen


def test_overlay_status_without_a_shell(client, core):
    expected = {"available": False, "hotkey": "Ctrl+Alt+G", "hotkey_state": "none", "displays": [], "display": ""}
    assert client.get("/api/overlay").json() == expected
    assert core.overlay_status() == expected


def test_the_shell_reports_displays_and_the_hotkey(client, core):
    queue = core.bus.subscribe()
    core.overlay_shell(DISPLAYS, "taken")
    assert client.get("/api/overlay").json() == {
        "available": True, "hotkey": "Ctrl+Alt+G", "hotkey_state": "taken", "displays": DISPLAYS, "display": "",
    }
    assert _published(queue) == [{"type": "overlay_changed"}]
    core.overlay_shell(DISPLAYS[:1], "held")  # the next report replaces the last
    answer = client.get("/api/overlay").json()
    assert (answer["hotkey_state"], answer["displays"]) == ("held", DISPLAYS[:1])
    assert _published(queue) == [{"type": "overlay_changed"}]
    core.overlay_status()["displays"][0]["label"] = "changed by whoever read it"
    assert core.overlay_status()["displays"] == DISPLAYS[:1]  # what is read is a copy


def test_the_status_gives_the_hotkey_and_the_display_the_settings_hold(client, core):
    core.overlay_shell(DISPLAYS, "held")
    client.put("/api/settings", json={"overlay_hotkey": "shift+win+f9", "overlay_display": DISPLAYS[1]["name"]})
    answer = client.get("/api/overlay").json()
    assert (answer["hotkey"], answer["display"]) == ("Shift+Win+F9", DISPLAYS[1]["name"])


def test_the_shell_reports_one_of_three_hotkey_states_and_a_wrong_one_changes_nothing(client, core):
    for state in ("held", "taken", "none"):
        core.overlay_shell(DISPLAYS, state)
        assert client.get("/api/overlay").json()["hotkey_state"] == state
    queue = core.bus.subscribe()
    with pytest.raises(ValueError, match="held, taken or none"):
        core.overlay_shell([], "stolen")
    assert client.get("/api/overlay").json()["displays"] == DISPLAYS  # the last good report stays
    assert _published(queue) == []


def test_demo_line_publishes(client, core):
    queue = core.bus.subscribe()
    answer = client.post("/api/demo/line", json={"text": "Teapot is ready."})
    assert (answer.status_code, answer.json()) == (200, {"text": "Teapot is ready."})
    assert _published(queue) == [{"type": "overlay_line", "text": "Teapot is ready."}]
    for bad in ({}, {"text": 5}, {"text": None}, {"line": "Teapot is ready."}):
        refused = client.post("/api/demo/line", json=bad)
        assert (refused.status_code, refused.json()) == (422, {"error": UNEXPECTED_REQUEST}), bad
    assert _published(queue) == []
    half = client.post(  # half of an emoji, which JSON can carry
        "/api/demo/line", content=b'{"text": "Fish \\ud83d"}', headers={"Content-Type": "application/json"}
    )
    assert (half.status_code, half.json()) == (200, {"text": "Fish \ufffd"})
    assert _published(queue) == [{"type": "overlay_line", "text": "Fish \ufffd"}]


def test_demo_line_does_not_exist_in_live_mode(tmp_path, clock):
    core = Core(
        AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        queue = core.bus.subscribe()
        answer = client.post("/api/demo/line", json={"text": "Teapot is ready."})
        assert (answer.status_code, answer.json()) == (404, {"error": "Not found."})
        assert _published(queue) == []
    core.store.close()
