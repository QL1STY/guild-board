from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.maptabs import DEFAULT_URL
from guildboard.tokenstore import StoredToken
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
FISHING = "https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=en-us#/map/2?shown_types=5&zoom=-1.00"


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


def test_the_map_page_starts_with_one_tab_and_says_the_demo_has_no_session(client):
    model = client.get("/api/map").json()
    assert [tab["name"] for tab in model["tabs"]] == ["Map"]
    assert model["signed_in"] is False and model["has_shell"] is False and model["can_reopen"] is False


def test_tabs_are_opened_renamed_duplicated_closed_and_opened_again(client):
    model = client.post("/api/map/tabs", json={"url": FISHING}).json()
    fishing = model["active"]
    assert client.get(f"/api/map/tabs/{fishing}").json() == {"url": FISHING}
    model = client.put(f"/api/map/tabs/{fishing}", json={"name": "Fishing"}).json()
    assert [tab["name"] for tab in model["tabs"]] == ["Map", "Fishing"]
    model = client.post(f"/api/map/tabs/{fishing}/duplicate").json()
    assert [tab["name"] for tab in model["tabs"]] == ["Map", "Fishing", "Fishing 2"]
    model = client.delete(f"/api/map/tabs/{model['active']}").json()
    assert model["can_reopen"] is True and model["active"] == fishing
    model = client.post("/api/map/reopen").json()
    assert [tab["name"] for tab in model["tabs"]] == ["Map", "Fishing", "Fishing 2"]
    first = model["tabs"][0]["id"]
    assert client.put("/api/map/active", json={"id": first}).json()["active"] == first


def test_a_foreign_address_opens_the_default_map_and_bad_requests_are_refused(client):
    model = client.post("/api/map/tabs", json={"url": "https://example.net/"}).json()
    assert client.get(f"/api/map/tabs/{model['active']}").json() == {"url": DEFAULT_URL}
    assert client.get("/api/map/tabs/999").status_code == 404
    assert client.put("/api/map/tabs/999", json={"name": "x"}).json() == {"error": "There is no such tab."}
    assert client.put(f"/api/map/tabs/{model['active']}", json={"name": "x" * 41}).status_code == 422
    assert client.put(f"/api/map/tabs/{model['active']}", json={"name": 5}).status_code == 422
    assert client.put("/api/map/active", json={"id": "1"}).status_code == 422
    assert client.post("/api/map/reopen").json() == {"error": "There is no closed tab to open again."}


def test_the_shell_hears_of_changes_and_of_the_area_and_the_pages_only_of_changes(core, client):
    heard = []
    core.map_listeners.append(heard.append)
    queue = core.bus.subscribe()
    client.post("/api/map/tabs", json={"url": FISHING})
    assert len(heard) == 1 and [t["url"] for t in heard[0]["tabs"]] == [DEFAULT_URL, FISHING]
    assert _events(queue) == ["map_changed"]
    area = {"x": 5, "y": 6, "w": 700, "h": 500, "hidden": False}
    assert client.put("/api/map/viewport", json={"area": area}).json() == {"ok": True}
    assert heard[-1]["viewport"] == {"x": 5.0, "y": 6.0, "w": 700.0, "h": 500.0, "hidden": False}
    assert _events(queue) == []  # the area is for the shell alone
    assert client.put("/api/map/viewport", json={"area": {"x": 1}}).status_code == 422
    assert client.put("/api/map/viewport", json={}).status_code == 422
    client.put("/api/map/viewport", json={"area": None})
    assert heard[-1]["viewport"] is None


def test_a_listener_that_fails_does_not_fail_the_request(core, client):
    def broken(snapshot):
        raise RuntimeError("boom")

    core.map_listeners.append(broken)
    assert client.post("/api/map/tabs").status_code == 200


def test_what_the_shell_reports_changes_the_page_only_when_the_page_shows_it(core):
    queue = core.bus.subscribe()
    tab = core.maptabs.model()["active"]
    core.map_seen(tab, FISHING, "")
    assert _events(queue) == []
    core.map_seen(tab, FISHING, "Teyvat Interactive Map - HoYoLAB")
    core.map_failed(tab, True)
    core.map_failed(tab, True)
    assert _events(queue) == ["map_changed", "map_changed"]
    assert core.map_model()["tabs"][0] == {"id": tab, "name": "Teyvat", "custom": False, "failed": True}


def test_the_session_for_the_map_comes_only_from_a_stored_login(core):
    assert core.map_session() is None  # the demo has no login
    assert core.map_role() is None


def test_the_role_for_the_map_is_the_stored_logins_game_account(core):
    token = StoredToken({"ltuid_v2": "1"}, 700000001, "os_euro", "Traveler")
    core.auth = SimpleNamespace(current=lambda: token)  # the demo has no Auth: this is a login
    assert core.map_role() == {"uid": "700000001", "region": "os_euro"}
    assert core.map_session() == {"ltuid_v2": "1"}


async def test_a_login_or_a_logout_tells_the_shell_and_the_page(core):
    heard = []
    core.map_listeners.append(heard.append)
    queue = core.bus.subscribe()
    assert core.map_snapshot()["session"] == 0
    core._auth_changed()  # what Auth calls after a login and after a logout
    assert heard[-1]["session"] == 1  # the shell reads the session again, and the views sign in or out
    assert "map_changed" in _events(queue)  # the page's account chip follows


def test_rename_with_half_an_emoji_stays_readable(client, core):
    from guildboard.maptabs import MapTabs

    tab = client.get("/api/map").json()["active"]
    sent = client.put(f"/api/map/tabs/{tab}", content=r'{"name": "Fish \ud83d"}', headers={"Content-Type": "application/json"})
    assert sent.status_code == 200
    names = [t["name"] for t in client.get("/api/map").json()["tabs"]]
    assert names == ["Fish \ufffd"]
    assert [t["name"] for t in MapTabs(core.store).model()["tabs"]] == ["Fish \ufffd"]  # and after a restart
    # What an older Guild Board saved: the name was kept with half an emoji in it.
    core.store.set_meta("map_tabs", r'{"tabs":[{"id":1,"name":"Old \ud83d","title":"Teyvat \ud83d - HoYoLAB","url":"x"}],"active":1,"next":2}')
    assert client.get("/api/map").status_code == 200
    assert [t["name"] for t in MapTabs(core.store).model()["tabs"]] == ["Old \ufffd"]
