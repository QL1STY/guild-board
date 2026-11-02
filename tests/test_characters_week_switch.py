"""The switch that hides Your week and Endgame (`characters.WEEK_AND_ENDGAME`): shipped off, with their code and tests kept.
While it is off the routes answer 404, the Today widget is not offered, the status says so for the interface, and the notices'
loop sends nothing; with it on, all of them are back."""
from __future__ import annotations

import asyncio
import importlib.util

import pytest
from fastapi.testclient import TestClient

import characters_samples as samples
from characters_service_support import SUNDAY, build_record, calculator, keep_builds, keep_notes
from characters_shape import problem_with
from guildboard import characters
from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from support import AccountSource, FakeClock, FakeSleep
from test_characters_notices_loop import SUNDAY_EVENING, focused

PORT = 4321
OFF_ROUTES = (
    ("GET", "/api/week", None),
    ("PUT", "/api/week/ticks", {"day": "2026-10-25", "task": "x", "done": True}),
    ("GET", "/api/endgame", None),
    ("PUT", "/api/endgame/theater", {"elements": ["Pyro", "Hydro", "Geo"]}),
    ("DELETE", "/api/endgame/theater", None),
)


@pytest.fixture
def off(monkeypatch):
    monkeypatch.setattr(characters, "WEEK_AND_ENDGAME", False)


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


def test_the_switch_is_off_as_shipped():
    """Read from a fresh copy of the module, since the conftest turns it on for every test."""
    spec = importlib.util.spec_from_file_location("shipped_characters", characters.__file__)
    shipped = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shipped)
    assert shipped.WEEK_AND_ENDGAME is False


@pytest.mark.parametrize(("method", "path", "body"), OFF_ROUTES)
def test_with_it_off_the_week_and_endgame_routes_answer_404(off, client, method, path, body):
    answer = client.request(method, path, json=body)
    assert answer.status_code == 404 and "error" in answer.json()


@pytest.mark.parametrize(("method", "path", "body"), OFF_ROUTES)
def test_with_it_on_the_week_and_endgame_routes_answer(client, method, path, body):
    assert client.request(method, path, json=body).status_code in (200, 422)


def test_with_it_off_the_roster_the_profile_the_planner_and_the_focus_still_answer(off, client):
    assert client.get("/api/characters").status_code == 200
    assert client.get("/api/characters/sandrone").status_code == 200
    assert client.get("/api/characters/sandrone/plan").status_code == 200
    answer = client.put("/api/focus", json={"characters": ["sandrone"]})
    assert answer.status_code == 200 and problem_with(answer.json(), "Roster") is None   # the roster, not the week
    assert [entry["key"] for entry in client.get("/api/characters").json()["entries"] if entry["focus"] is not None] == ["sandrone"]
    assert client.get("/api/characters/sandrone/plan").json()["plan"]["talents"]["normal"] == 10


def test_the_status_tells_the_interface_whether_they_are_on(core, client, monkeypatch):
    assert client.get("/api/status").json()["week_and_endgame"] is True
    monkeypatch.setattr(characters, "WEEK_AND_ENDGAME", False)
    assert client.get("/api/status").json()["week_and_endgame"] is False


async def test_with_it_off_no_notice_is_sent_and_the_loop_does_not_look(off, store, clock, tmp_path):
    service, shown = await focused(store, FakeClock(SUNDAY_EVENING), tmp_path)
    assert service.check() == [] and shown == []
    slept: list[float] = []
    gate = asyncio.Event()

    async def sleep(seconds: float) -> None:
        slept.append(seconds)
        await gate.wait()

    service, shown = await focused(store, FakeClock(SUNDAY_EVENING), tmp_path / "loop", sleep=sleep)
    task = asyncio.create_task(service.run())
    for _ in range(50):
        await asyncio.sleep(0)
        if slept:
            break
    assert slept == [900.0] and shown == []   # it looked at the art and the wiki, and sent nothing
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def test_with_it_on_the_notices_come_back(store, tmp_path):
    service, shown = await focused(store, FakeClock(SUNDAY_EVENING), tmp_path)
    assert "weekly" in service.check() and shown != []
