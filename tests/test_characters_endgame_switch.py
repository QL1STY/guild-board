"""Endgame's own switch (`characters.ENDGAME`): shipped off, with its code and tests kept. While it is off its routes answer
404 and the status says so for the interface; with it on they are back. Your week is gone (the Plan design, section 3): its
routes answer 404 always and the status no longer carries its switch."""
from __future__ import annotations

import importlib.util

import pytest
from fastapi.testclient import TestClient

import characters_samples as samples
from characters_service_support import SUNDAY, build_record, calculator, keep_builds, keep_notes
from characters_shape import problem_with
from guildboard import characters
from guildboard.api.app import create_app
from guildboard.config import AppPaths, load_settings, settings_from_dict
from guildboard.core import Core
from support import AccountSource, FakeClock, FakeSleep

PORT = 4321
WEEK_ROUTES = (
    ("GET", "/api/week", None),
    ("PUT", "/api/week/ticks", {"day": "2026-10-25", "task": "x", "done": True}),
)
ENDGAME_ROUTES = (
    ("GET", "/api/endgame", None),
    ("PUT", "/api/endgame/theater", {"elements": ["Pyro", "Hydro", "Geo"]}),
    ("DELETE", "/api/endgame/theater", None),
)


@pytest.fixture
def endgame_off(monkeypatch):
    monkeypatch.setattr(characters, "ENDGAME", False)


@pytest.fixture
def core(tmp_path):
    clock = FakeClock(SUNDAY)
    core = Core(
        AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(),
        sleep=FakeSleep(clock), process_lister=lambda: set(),
    )
    keep_builds(core.store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    keep_notes(core.store, clock.now())
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, PORT), base_url=f"http://127.0.0.1:{PORT}") as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


def test_endgame_has_its_own_switch_off_as_shipped():
    """Read from a fresh copy of the module, since the conftest turns it on for every test."""
    spec = importlib.util.spec_from_file_location("shipped_characters", characters.__file__)
    shipped = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shipped)
    assert shipped.ENDGAME is False
    assert not hasattr(shipped, "WEEK_AND_ENDGAME")


@pytest.mark.parametrize(("method", "path", "body"), WEEK_ROUTES)
def test_your_week_is_gone_its_routes_answer_404_with_everything_on(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 404


@pytest.mark.parametrize(("method", "path", "body"), ENDGAME_ROUTES)
def test_with_endgame_off_its_routes_answer_404(endgame_off, client, method, path, body):
    answer = client.request(method, path, json=body)
    assert answer.status_code == 404 and "error" in answer.json()


@pytest.mark.parametrize(("method", "path", "body"), ENDGAME_ROUTES)
def test_with_endgame_on_its_routes_answer(client, method, path, body):
    assert client.request(method, path, json=body).status_code in (200, 422)


def test_with_endgame_off_the_roster_the_profile_the_planner_and_the_focus_still_answer(endgame_off, client):
    assert client.get("/api/characters").status_code == 200
    assert client.get("/api/characters/sandrone").status_code == 200
    assert client.get("/api/characters/sandrone/plan").status_code == 200
    answer = client.put("/api/focus", json={"characters": ["sandrone"]})
    assert answer.status_code == 200 and problem_with(answer.json(), "Roster") is None   # the roster, not a week
    assert [entry["key"] for entry in client.get("/api/characters").json()["entries"] if entry["focus"] is not None] == ["sandrone"]
    assert client.get("/api/characters/sandrone/plan").json()["plan"]["talents"]["normal"] == 10


def test_the_status_tells_the_interface_whether_endgame_is_on_and_no_longer_carries_the_weeks_switch(client, monkeypatch):
    status = client.get("/api/status").json()
    assert status["endgame"] is True and "week_and_endgame" not in status
    monkeypatch.setattr(characters, "ENDGAME", False)
    assert client.get("/api/status").json()["endgame"] is False


def test_the_notice_switches_are_gone_and_a_settings_file_that_still_holds_them_loads(tmp_path):
    assert not any(name.startswith("characters_notice") for name in settings_from_dict({}).to_dict())
    path = tmp_path / "settings.json"
    path.write_text(
        '{"commission_region": "inazuma", "characters_notice_weekly": false, "characters_notice_domain": true,'
        ' "characters_notice_ready": false}', encoding="utf-8",
    )
    loaded = load_settings(path)
    assert loaded.commission_region == "inazuma"
    assert not any(name.startswith("characters_notice") for name in loaded.to_dict())
