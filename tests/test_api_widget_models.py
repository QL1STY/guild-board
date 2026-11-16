"""The widgets' core views over the API (the five widgets plan, Task 2): the Calendar's and Endgame resets' models answer from the
demo at start, and neither is gated by the Characters pages' hidden features."""

import pytest
from fastapi.testclient import TestClient

from guildboard import characters
from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"


@pytest.fixture
def core(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


def test_the_calendar_answers_from_the_demo_at_start(client, core):
    answer = client.get("/api/calendar").json()
    assert answer["read"] is True and answer["read_at"] is not None
    assert [b["kind"] for b in answer["banners"]] == ["character", "weapon", "character", "weapon"]
    assert answer["banners"][0]["name"] == "Skirk · Escoffier" and answer["banners"][0]["faces"][0]["icon"] is None
    assert len(answer["events"]) == 4 and answer["left"] == 1  # one is running and not finished; one is done
    assert set(answer["events"][0]) == {
        "id", "name", "starts", "ends", "finished", "primogems", "explored", "double", "soon", "status", "source",
    }
    assert [m["mode"] for m in answer["endgame"]] == ["abyss", "theater", "stygian"]
    assert core.calendar_model() == answer


def test_the_endgame_resets_answer_from_the_demo_at_start(client):
    answer = client.get("/api/endgame-resets").json()
    assert answer["read_at"] is not None
    assert [(m["mode"], m["played"], m["stale"]) for m in answer["modes"]] == [
        ("abyss", True, False), ("theater", True, False), ("stygian", True, False),
    ]
    assert answer["modes"][0]["stars"] is not None and answer["modes"][2]["difficulty"] is not None
    assert answer["not_played"] == 0


def test_neither_route_is_gated_by_the_hidden_characters_features(client, monkeypatch):
    monkeypatch.setattr(characters, "ENDGAME", False)
    assert client.get("/api/endgame-resets").json()["modes"]
    assert client.get("/api/calendar").json()["endgame"]


def test_the_models_follow_the_cores_clock(client, clock):
    clock.advance(days=40)  # every demo cycle and event is over
    answer = client.get("/api/endgame-resets").json()
    assert [m["stale"] for m in answer["modes"]] == [True, True, True] and answer["not_played"] == 0
    assert client.get("/api/calendar").json()["left"] == 0


def test_next_up_answers_from_the_demo_at_start(client, core):
    answer = client.get("/api/next-up").json()
    assert answer["items"] and answer["ready"] >= 0
    assert all(set(item) == {"kind", "name", "at", "ready", "count", "mode", "icon", "started_at"} for item in answer["items"])
    kinds = {item["kind"] for item in answer["items"]}
    assert {"daily", "weekly"} <= kinds
    assert answer == core.next_up_model()
    ready = [item["ready"] for item in answer["items"]]
    assert ready == sorted(ready, reverse=True)  # the ready ones first


def test_next_up_builds_the_endgame_resets_once(core, monkeypatch):
    from guildboard import core as core_module
    from guildboard.views import calendar as calendar_module

    built = []
    real = core_module.build_endgame_resets

    def counted(*args, **kwargs):
        built.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(core_module, "build_endgame_resets", counted)
    monkeypatch.setattr(calendar_module, "build_endgame_resets", counted)
    core.next_up_model()
    assert len(built) == 1


def test_next_up_follows_the_cores_clock_and_lists_no_event_that_is_over(client, clock):
    first = client.get("/api/next-up").json()
    assert any(item["kind"] == "event" for item in first["items"])  # the demo has one running and not finished
    clock.advance(days=40)
    later = client.get("/api/next-up").json()
    assert not any(item["kind"] in ("event", "banner") for item in later["items"])
