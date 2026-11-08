import pytest
from fastapi.testclient import TestClient

from guildboard import __version__
from guildboard.api.app import create_app
from guildboard.config import AppPaths, Settings, load_settings
from guildboard.core import Core, SettingRefused
from guildboard.hotkeys import hotkey_problem
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
LETTER = "Ctrl+Alt+E types a letter on your keyboard. Choose another key."


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


def test_a_refused_hotkey_says_why_and_saves_nothing(client, core):
    queue, heard = core.bus.subscribe(), []
    core.settings_listeners.append(heard.append)
    refused = client.put("/api/settings", json={"overlay_hotkey": "Ctrl+Alt+E", "overlay_opacity": 80})
    assert (refused.status_code, refused.json()) == (422, {"detail": LETTER})
    assert client.get("/api/settings").json()["overlay_opacity"] == 100
    assert load_settings(core.paths.settings_path) == Settings(last_seen_version=__version__)  # nothing reached the file but the version a first start records
    assert (heard, _events(queue)) == ([], [])  # and nobody was told of a change


@pytest.mark.parametrize("text", ["Ctrl+", "G", "Shift+G", "Ctrl+Alt+Z", "Ctrl+Alt+F13", ""])
def test_each_refused_hotkey_gives_its_own_problem(client, text):
    refused = client.put("/api/settings", json={"overlay_hotkey": text})
    assert (refused.status_code, refused.json()) == (422, {"detail": hotkey_problem(text)})
    assert client.get("/api/settings").json()["overlay_hotkey"] == "Ctrl+Alt+G"


def test_core_refuses_a_hotkey_with_a_problem_before_it_saves_anything(core):
    with pytest.raises(SettingRefused, match="A hotkey needs Ctrl, Alt or Win"):
        core.update_settings({"notifications": False, "overlay_hotkey": "Shift+G"})
    assert core.settings.notifications is True


def test_a_hotkey_is_kept_as_its_canonical_text_and_is_not_read_as_refused(client, core):
    saved = client.put("/api/settings", json={"overlay_hotkey": "alt+ctrl+k"}).json()
    assert saved["overlay_hotkey"] == "Ctrl+Alt+K"
    assert client.get("/api/settings").json()["overlay_hotkey"] == "Ctrl+Alt+K"
    assert load_settings(core.paths.settings_path).overlay_hotkey == "Ctrl+Alt+K"


def test_the_overlay_settings_are_saved(client, core):
    changes = {
        "overlay_hotkey": "Ctrl+Shift+F9", "overlay_display": r"\\.\DISPLAY2", "overlay_opacity": 60,
        "overlay_pinned": False, "overlay_lines": False, "overlay_size": 175,
    }
    saved = client.put("/api/settings", json=changes).json()
    assert {key: saved[key] for key in changes} == changes
    assert client.get("/api/settings").json() == saved
    assert load_settings(core.paths.settings_path).to_dict() == saved


def test_a_value_the_overlay_settings_do_not_accept_leaves_the_setting_as_it_was(client):
    chosen = {
        "overlay_hotkey": "Ctrl+Shift+F9", "overlay_display": "DISPLAY2", "overlay_opacity": 80, "overlay_pinned": False,
        "overlay_size": 125,
    }
    client.put("/api/settings", json=chosen)
    for refused in (
        {"overlay_opacity": 49}, {"overlay_opacity": "90"}, {"overlay_display": "d" * 65}, {"overlay_display": 2},
        {"overlay_pinned": "yes"}, {"overlay_hotkey": 5}, {"overlay_size": 110}, {"overlay_size": "150"},
        {"overlay_size": 0},  # 0 was "Automatic", which is gone
    ):
        saved = client.put("/api/settings", json=refused).json()
        assert {key: saved[key] for key in chosen} == chosen, refused


def test_the_page_sizes_are_saved_and_a_size_that_is_not_a_step_leaves_them(client, core):
    for name in ("page_size", "page_size_maximized"):
        assert client.get("/api/settings").json()[name] == 100
    assert client.put("/api/settings", json={"page_size_maximized": 80}).json()["page_size_maximized"] == 80
    assert client.put("/api/settings", json={"page_size": 110}).json()["page_size"] == 110
    kept = load_settings(core.paths.settings_path)
    assert (kept.page_size, kept.page_size_maximized) == (110, 80)
    for refused in (85, "90", 0, None, True):
        saved = client.put("/api/settings", json={"page_size": refused, "page_size_maximized": refused}).json()
        assert (saved["page_size"], saved["page_size_maximized"]) == (110, 80), refused
    # The window's size is about this PC: it never leaves a line for sync.
    assert [row for row in core.store.sync_outbox(1000) if row.kind == "settings"] == []


def test_the_spending_settings_are_saved_and_a_bad_price_list_leaves_them(client, core):
    answer = client.put("/api/settings", json={"spending_currency": "EUR", "spending_prices": {"EUR": {"c60": 1.09}}})
    assert answer.status_code == 200
    assert (core.settings.spending_currency, core.settings.spending_prices) == ("EUR", {"EUR": {"c60": 1.09}})
    client.put("/api/settings", json={"spending_currency": "GBP", "spending_prices": {"EUR": {"c60": -1}}})
    assert (core.settings.spending_currency, core.settings.spending_prices) == ("EUR", {"EUR": {"c60": 1.09}})


def test_the_picture_quality_is_high_until_the_player_chooses_and_takes_only_its_three_words(client, core):
    assert client.get("/api/settings").json()["picture_quality"] == "high"
    for quality in ("medium", "low", "high"):
        assert client.put("/api/settings", json={"picture_quality": quality}).json()["picture_quality"] == quality
        assert load_settings(core.paths.settings_path).picture_quality == quality
    client.put("/api/settings", json={"picture_quality": "low"})
    for refused in ("ultra", "", "High", 3, None, ["low"]):
        saved = client.put("/api/settings", json={"picture_quality": refused}).json()
        assert saved["picture_quality"] == "low", refused


def test_there_is_no_smooth_animations_setting_any_more(client, core):
    # The Qt build's frame limit is gone with Qt: the window draws at the monitor's rate. A request that names the old key
    # changes nothing and the setting is not offered.
    assert "smooth_animations" not in client.get("/api/settings").json()
    saved = client.put("/api/settings", json={"smooth_animations": True}).json()
    assert "smooth_animations" not in saved
    assert "smooth_animations" not in core.paths.settings_path.read_text(encoding="utf-8")


def test_a_settings_change_is_an_event(client, core):
    queue = core.bus.subscribe()
    assert client.put("/api/settings", json={"overlay_lines": False}).json()["overlay_lines"] is False
    assert _events(queue) == ["settings_changed"]


def test_the_event_comes_after_the_listeners_have_heard_the_change(core):
    queue, seen = core.bus.subscribe(), []
    core.settings_listeners.append(lambda settings: seen.append(queue.qsize()))  # the shell applies the change here
    core.update_settings({"overlay_lines": False})
    assert (seen, queue.qsize()) == ([0], 1)
