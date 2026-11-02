import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.store import iso
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
NO_OFFSET = "Give the time with its offset, for example 2026-10-20T10:00:00+02:00."


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


def _timer(client, key: str) -> dict:
    return next(timer for timer in client.get("/api/timers").json()["timers"] if timer["preset"] == key)


def _events(queue) -> list[str]:
    seen = []
    while not queue.empty():
        seen.append(queue.get_nowait()["type"])
    return seen


def test_the_timers_model_lists_the_default_pre_sets_and_what_can_be_added(client):
    model = client.get("/api/timers").json()
    assert model["fishing"] == "3_days"
    hilichurl = _timer(client, "hilichurl")
    assert {key: hilichurl[key] for key in ("own", "name", "place", "rule", "about", "state", "ready_at", "bell")} == {
        "own": False, "name": "Unusual Hilichurl", "place": "", "rule": {"kind": "hours", "hours": 12},
        "about": "Up to two appear in 12 hours, and it comes back 12 hours after the second is defeated",
        "state": "running", "ready_at": "2026-10-13T18:00:00+00:00", "bell": True,
    }
    # The demo defeated it 2 hours before its clock's 08:00.
    assert (hilichurl["visits"], hilichurl["cleared_at"], hilichurl["started_at"]) == (
        None, "2026-10-13T06:00:00+00:00", "2026-10-13T06:00:00+00:00",
    )
    assert hilichurl["icon"] == "/api/icon/timer.hilichurl"  # HoYoLAB's picture, through the icon cache
    # The demo has killed it 37 times, and ticked its 1 and 20 stages.
    assert hilichurl["achievement"] == {
        "id": 82055, "name": "...Well, That Was Strange",
        "stages": [
            {"id": 82055, "status": "done"}, {"id": 82056, "status": "done"}, {"id": 82057, "status": "in_progress"},
        ],
        "counter": {"value": 37, "unit": "kills", "unit_one": "kill", "targets": [1, 20, 50], "cleared_adds": True},
    }
    offered = {preset["key"]: preset for preset in model["presets"]}
    assert offered["fishing.wangshu_inn"] == {
        "key": "fishing.wangshu_inn", "name": "Fishing spot · Wangshu Inn, Liyue", "group": "Fishing spots",
        "region": "liyue",
    }
    assert "hilichurl" not in offered and "fishing.luhua_pool" not in offered  # in use already


def test_cleared_on_the_hilichurl_counts_a_kill_and_undo_takes_it_back(client, core, clock):
    hilichurl = _timer(client, "hilichurl")
    queue = core.bus.subscribe()
    answer = client.post(f"/api/timers/{hilichurl['id']}/cleared", json={})
    assert answer.json() == {"change": "Cleared Unusual Hilichurl"}
    assert {"timers_changed", "achievements_changed"} <= set(_events(queue))
    now = clock.now()
    cleared = _timer(client, "hilichurl")
    assert (cleared["state"], cleared["ready_at"], cleared["cleared_at"], cleared["started_at"]) == (
        "running", iso(now.replace(hour=20)), iso(now), iso(now),
    )
    assert cleared["achievement"]["counter"]["value"] == 38
    assert client.post("/api/achievements/undo").json() == {"undone": "Cleared Unusual Hilichurl", "more": False}
    assert {"timers_changed", "achievements_changed"} <= set(_events(queue))
    assert _timer(client, "hilichurl")["achievement"]["counter"]["value"] == 37


def test_cleared_on_a_teapot_field_adds_nothing_and_its_card_counts_the_items_itself(client):
    """One harvest gathers several items, as many as were planted, so a teapot field's Cleared counts nothing (spec 9.1).
    The model says so, and the card sets the count with the achievement's own counter, as the Achievements page does."""
    jade = _timer(client, "teapot.jade_field")
    assert jade["achievement"]["counter"] == {
        "value": 0, "unit": "", "unit_one": None, "targets": [40, 200, 800], "cleared_adds": False,
    }
    client.post(f"/api/timers/{jade['id']}/cleared", json={})
    assert _timer(client, "teapot.jade_field")["achievement"]["counter"]["value"] == 0
    answer = client.post(f"/api/achievements/counter/{jade['achievement']['id']}", json={"value": 12})
    assert answer.status_code == 200
    assert _timer(client, "teapot.jade_field")["achievement"]["counter"]["value"] == 12


def test_an_own_timer_is_made_changed_and_removed(client):
    two_days = {"kind": "hours", "hours": 48}
    made = client.post("/api/timers", json={"name": "Walk the dog", "rule": two_days, "visits": 3})
    timer_id = made.json()["id"]
    assert made.json() == {"id": timer_id, "change": "Added the timer Walk the dog"}
    own = next(timer for timer in client.get("/api/timers").json()["timers"] if timer["id"] == timer_id)
    assert (own["own"], own["preset"], own["about"], own["visits"], own["achievement"]) == (
        True, None, None, {"done": 0, "of": 3}, None,
    )
    weekly = {"name": "Walk the cat", "place": "", "rule": {"kind": "weekly"}, "visits": None}
    changed = client.put(f"/api/timers/{timer_id}", json=weekly)
    assert changed.json() == {"change": "Changed the timer Walk the cat"}
    assert client.post(f"/api/timers/{timer_id}/bell", json={"on": False}).json() == {
        "change": "Turned off the reminder for Walk the cat",
    }
    assert client.delete(f"/api/timers/{timer_id}").json() == {"change": "Removed the timer Walk the cat"}
    assert all(timer["id"] != timer_id for timer in client.get("/api/timers").json()["timers"])


def test_a_pre_set_can_be_added_once(client):
    added = client.post("/api/timers", json={"preset": "fishing.wangshu_inn"})  # a spot the demo does not use
    assert added.json()["change"] == "Added the timer Fishing spot · Wangshu Inn, Liyue"
    # Never cleared, it is ready with no times, and comes after the ready ones that were cleared, longest ready first.
    spot = _timer(client, "fishing.wangshu_inn")
    assert {key: spot[key] for key in ("state", "ready_at", "cleared_at", "started_at", "visits")} == {
        "state": "ready", "ready_at": None, "cleared_at": None, "started_at": None, "visits": None,
    }
    timers = client.get("/api/timers").json()["timers"]
    assert [timer["preset"] for timer in timers if timer["state"] == "ready"] == [
        "fishing.luhua_pool", "teapot.jade_field", "fishing.wangshu_inn",
    ]
    again = client.post("/api/timers", json={"preset": "fishing.wangshu_inn"})
    assert (again.status_code, again.json()) == (409, {"error": "This pre-set timer is in use already."})
    unknown = client.post("/api/timers", json={"preset": "fishing.atlantis"})
    assert (unknown.status_code, unknown.json()) == (404, {"error": "There is no pre-set timer with this name."})


def test_a_time_without_its_offset_is_refused(client, clock):
    timer_id = _timer(client, "hilichurl")["id"]
    for at in ("2026-10-13T07:00:00", "yesterday", 5, None):
        answer = client.post(f"/api/timers/{timer_id}/cleared", json={"at": at})
        assert (answer.status_code, answer.json()) == (422, {"error": NO_OFFSET}), at
    earlier = client.post(f"/api/timers/{timer_id}/cleared", json={"at": "2026-10-13T08:00:00+02:00"})
    assert earlier.json() == {"change": "Cleared Unusual Hilichurl"}  # 06:00 UTC, two hours before the clock
    past = client.post(f"/api/timers/{timer_id}/ready", json={"at": iso(clock.now())})
    assert (past.status_code, past.json()) == (422, {"error": "A ready time is later than now."})


def test_refusals_say_why(client):
    hilichurl = _timer(client, "hilichurl")["id"]
    cases = [
        (client.post("/api/timers/999/cleared", json={}), 404, "There is no timer with this number."),
        (client.put(f"/api/timers/{hilichurl}", json={"name": "Wei", "place": "", "rule": {"kind": "weekly"}}), 409,
         "A pre-set timer keeps its name and its rule."),
        (client.post("/api/timers", json={"name": "", "rule": {"kind": "weekly"}}), 422,
         "A timer's name is 1 to 60 characters."),
        (client.post("/api/timers", json={"name": "Walk the dog", "rule": {"kind": "monthly"}}), 422,
         "A timer comes back after a number of hours, after daily resets, or at the weekly reset."),
        (client.post("/api/timers", json={"name": "Walk the dog", "rule": {"kind": "weekly"}, "visits": 1}), 422,
         "A timer has 2 to 50 visits, or none."),
        (client.post("/api/timers", json={"name": 5, "rule": {"kind": "weekly"}}), 422,
         "This request does not have the expected shape."),
        (client.post(f"/api/timers/{hilichurl}/bell", json={"on": "yes"}), 422, "Give on as true or false."),
    ]
    for answer, status, sentence in cases:
        assert (answer.status_code, answer.json()) == (status, {"error": sentence})


def test_the_achievements_model_counts_the_ready_timers(client):
    ready = [timer for timer in client.get("/api/timers").json()["timers"] if timer["state"] == "ready"]
    assert client.get("/api/achievements").json()["special"]["timers_ready"] == len(ready)
    client.post(f"/api/timers/{ready[0]['id']}/cleared", json={})
    assert client.get("/api/achievements").json()["special"]["timers_ready"] == len(ready) - 1


def test_a_test_notification_goes_to_the_shell_when_there_is_one(client, core):
    assert client.post("/api/notifications/test").json() == {"sent": False}  # no shell: the core alone in a browser
    sent: list[tuple[str, str]] = []
    core.notifier = lambda kind, text: sent.append((kind, text)) is None
    core.has_tray = True
    assert client.post("/api/notifications/test").json() == {"sent": True}
    assert sent == [("test", "This is a test notification from Guild Board.")]


def test_settings_take_the_region_the_fishing_rule_and_notifications(client):
    changes = {"commission_region": "sumeru", "fishing_rule": "next_reset", "notifications": False}
    saved = client.put("/api/settings", json=changes).json()
    assert {key: saved[key] for key in changes} == changes
    assert client.get("/api/timers").json()["fishing"] == "next_reset"


def test_the_pin_puts_a_timer_on_the_board_and_takes_it_off(client, core):
    hilichurl = _timer(client, "hilichurl")
    path = f"/api/timers/{hilichurl['id']}/pin"
    undo_before = core.store.newest_change_label()
    queue = core.bus.subscribe()
    assert client.post(path, json={"on": True}).json() == {"pinned": True}
    assert "layout_changed" in _events(queue)
    assert _timer(client, "hilichurl")["pinned"] is True
    assert client.get("/api/layouts/board").json()["widgets"][-1]["settings"] == {"timer": hilichurl["id"]}
    assert client.post(path, json={"on": True}).json() == {"pinned": True}
    assert _events(queue) == []  # pinned already: nothing changed
    assert client.post(path, json={"on": False}).json() == {"pinned": False}
    assert _timer(client, "hilichurl")["pinned"] is False
    assert core.store.newest_change_label() == undo_before  # the pin is no change to undo
    unknown = client.post("/api/timers/999/pin", json={"on": True})
    assert (unknown.status_code, unknown.json()) == (404, {"error": "There is no timer with this number."})
    assert client.post(path, json={"on": "yes"}).json() == {"error": "Give on as true or false."}


def test_reading_the_timers_reads_progress_and_counts_once_however_many_timers(core, monkeypatch):
    # The Board's timer widgets read the timers at every event. Reading all progress again for each timer took about a
    # third of a second with the player's 88 timers (spec section 25), and each widget would pay it again.
    reads = {"progress": 0, "counters": 0}
    for name in reads:
        original = getattr(core.store, name)

        def counted(*args, _name=name, _original=original, **kwargs):
            reads[_name] += 1
            return _original(*args, **kwargs)

        monkeypatch.setattr(core.store, name, counted)
    model = core.timers_model()
    assert len([timer for timer in model["timers"] if timer["achievement"] is not None]) > 1
    assert reads == {"progress": 1, "counters": 1}
