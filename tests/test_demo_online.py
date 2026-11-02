"""The demo has friends: the same models as the real thing, from made-up values, with no client at all (the online plan, Task
B5; the design, section 11)."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from characters_shape import problem_with as _problem_with
from cloud_fakes import USER_ID, FakeCloud, answer
from guildboard import netpolicy
from guildboard.api.app import create_app
from guildboard.cloud import STAT_KEYS
from guildboard.cloud.demo import DemoOnline
from guildboard.cloud.models import OnlineRefused
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.events import EventBus
from guildboard.tokenstore import StoredToken, TokenStore
from support import AccountSource, FakeSleep

ONLINE_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "onlinetypes.ts"
NAMES = (
    "OnlineState", "OnlineView", "StatKey", "ShareKey", "StatValues", "Stats", "FriendStatus", "Card", "Friend", "FriendsModel",
    "FriendProfile", "YourProfile", "CompareModel",
)
PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
RILEY = "00000000-0000-4000-8000-000000007687"
KIRA = "00000000-0000-4000-8000-000000000412"
MILO = "00000000-0000-4000-8000-000000003391"
NOVA = "00000000-0000-4000-8000-000000005120"


def problem_with(value, name: str) -> str | None:
    return _problem_with(value, name, ONLINE_TS, NAMES)


@pytest.fixture
def demo(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        yield client
    core.store.close()


def _friend(client: TestClient, name: str) -> dict:
    return next(friend for friend in client.get("/api/friends").json()["friends"] if friend["name"] == name)


def test_the_demo_gives_the_same_shape_as_the_real_thing(demo, tmp_path, clock):
    for model, name in (
        (demo.get("/api/friends").json(), "FriendsModel"),
        (demo.get(f"/api/friends/{RILEY}").json(), "FriendProfile"),
        (demo.get(f"/api/friends/{MILO}").json(), "FriendProfile"),
        (demo.get("/api/profile").json(), "YourProfile"),
        (demo.get(f"/api/friends/{RILEY}/compare").json(), "CompareModel"),
        (demo.get("/api/online").json(), "OnlineView"),
    ):
        assert problem_with(model, name) is None, name

    # The same check of the real thing: a core on a made-up server, with a login, and the models it gives.
    paths = AppPaths(tmp_path / "live")
    paths.ensure()
    TokenStore(paths.token_path).save(StoredToken({"ltoken_v2": "made-up"}, 700000001, "os_euro", "Traveler"))
    CloudStore(paths.cloud_path).save(
        CloudSession("ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 3600, USER_ID, "Nova", "5120")
    )
    riley = {
        "user_id": RILEY, "name": "Riley", "tag": "7687", "has_picture": True, "ar": 58, "uid": 712345312,
        "presence": {"state": "in_game", "since": "2026-10-13T07:00:00+00:00", "seen_seconds": 12},
        "stats": {
            "wishes": {"pity": 3, "five_stars_90d": 1},
            # From a Guild Board that does not date them: the core ages them, and what the page is given has the dates.
            "playtime": {"week_hours": 2.0, "days30_hours": 3.0, "weeks": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], "longest_run": 1},
            "spending": {"month_total": 5.0, "currency": "PLN"},
        },
        "pins": ["wishes"], "compare": True,
    }
    cloud = FakeCloud({
        ("GET", "/rest/v1/profiles"): answer(200, [{
            "name": "Nova", "discriminator": "5120", "picture_url": None, "ar": 41, "uid": 700000001, "find_by_uid": True,
            "pins": ["wishes"], "sharing": ["status", "wishes"],
        }]),
        ("POST", "/rest/v1/rpc/friends_overview"): answer(200, {
            "friends": [riley], "incoming": [], "outgoing": [
                {"user_id": KIRA, "name": "Elena", "tag": "0031", "has_picture": False, "ar": None},
            ],
        }),
        ("POST", "/rest/v1/rpc/compare_keys"): answer(200, ["wishes"]),
    })
    live = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
                cloud_fetch=cloud, open_browser=lambda address: None)
    with TestClient(create_app(live, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": live.launch_secret}, follow_redirects=False)
        for model, name in (
            (client.get("/api/friends").json(), "FriendsModel"),
            (client.get(f"/api/friends/{RILEY}").json(), "FriendProfile"),
            (client.get("/api/profile").json(), "YourProfile"),
            (client.get(f"/api/friends/{RILEY}/compare").json(), "CompareModel"),
            (client.get("/api/online").json(), "OnlineView"),
        ):
            assert problem_with(model, name) is None, name
    live.store.close()


def test_the_demo_account_uses_about_a_sixth_of_its_room(demo):
    usage = demo.get("/api/online").json()["usage"]
    assert usage["has_place"] is True and usage["seats_full"] is False
    assert round(usage["rows_held"] / usage["rows_limit"], 2) == round(usage["bytes_held"] / usage["bytes_limit"], 2) == 0.17
    demo.post("/api/demo/online", json={"state": "signed_out"})
    assert demo.get("/api/online").json()["usage"] is None


def test_the_four_players_of_the_design(demo):
    assert demo.get("/api/online").json()["tag"] == "2048"
    model = demo.get("/api/friends").json()
    assert model["me"] == {"name": "Traveler", "tag": "2048"}
    assert {(friend["name"], friend["tag"], friend["status"]) for friend in model["friends"]} == {
        ("Riley", "7687", "in_game"), ("Kira", "0412", "open"), ("Milo", "3391", "offline"),
    }
    assert [(card["name"], card["tag"]) for card in model["incoming"]] == [("Nova", "5120")]
    assert model["outgoing"] == [] and model["stale"] is False


def test_milo_is_offline_and_shares_nothing(demo):
    milo = _friend(demo, "Milo")
    assert (milo["stats"], milo["pills"], milo["compare"]) == ({}, [], False)
    assert milo["last_seen"] is not None and milo["since"] is None


def test_compare_works_against_riley(demo):
    model = demo.get(f"/api/friends/{RILEY}/compare").json()
    assert model["keys"] == ["primogems", "playtime", "achievements", "endgame", "account"]
    assert set(model["friend"]["stats"]) == set(model["mine"]) == set(model["keys"])
    assert model["mine"]["primogems"]["now"] - model["friend"]["stats"]["primogems"]["now"] == 1720  # "You +1,720"
    assert model["friend"]["stats"]["playtime"]["week_hours"] - model["mine"]["playtime"]["week_hours"] == 3  # "Riley +3 h"
    assert [row["month"] for row in model["mine"]["primogems"]["months"]][-1] == "2026-10"
    assert len(model["friend"]["stats"]["playtime"]["weeks"]) == 6
    assert model["week_start"] == "2026-10-12"  # the clock's Tuesday is in the week that began on Monday
    assert (model["me"]["name"], model["me"]["tag"]) == ("Traveler", "2048")


def test_the_demos_friends_are_never_old(demo, clock):
    # A real friend's numbers age with the calendar (the online plan, Task C0). The demo's are always of the week and the month
    # it is, so that its pictures keep their numbers, also for a demo left open across a Monday.
    first = _friend(demo, "Riley")["stats"]["playtime"]
    assert (first["week_hours"], first["days30_hours"], first["week_start"]) == (21.0, 58.0, "2026-10-12")
    assert _friend(demo, "Kira")["stats"]["playtime"]["week_hours"] == 9.0
    clock.advance(days=40)  # Sunday 22 November
    later = _friend(demo, "Riley")["stats"]["playtime"]
    assert (later["week_hours"], later["days30_hours"], later["weeks"]) == (21.0, 58.0, first["weeks"])
    compare = demo.get(f"/api/friends/{RILEY}/compare").json()
    assert later["week_start"] == compare["week_start"] == compare["mine"]["playtime"]["week_start"] == "2026-11-16"
    assert demo.get("/api/profile").json()["stats"]["spending"]["month"] == "2026-11"
    assert _friend(demo, "Kira")["stats"]["playtime"]["week_hours"] == 9.0


def test_every_stat_of_the_demos_player_has_its_shape(demo):
    assert tuple(demo.get("/api/profile").json()["stats"]) == STAT_KEYS


def test_a_switch_changes_the_demos_memory_alone(demo):
    assert "wishes" not in demo.get("/api/profile").json()["sharing"]
    keys = demo.get(f"/api/friends/{RILEY}/compare").json()["keys"]
    model = demo.put("/api/profile/sharing", json={"keys": ["status", "wishes", "primogems"]}).json()
    assert model["sharing"] == ["status", "primogems", "wishes"]
    assert model["pins"] == ["primogems"]  # the pins of the stats that went off went with them
    assert demo.get(f"/api/friends/{RILEY}/compare").json()["keys"] == ["primogems"]
    assert keys != ["primogems"]


def test_with_no_stat_in_common_compare_is_off(demo):
    demo.put("/api/profile/sharing", json={"keys": ["status"]})
    assert _friend(demo, "Riley")["compare"] is False


def test_the_demos_pins_keep_the_rules(demo):
    reply = demo.put("/api/profile/pins", json={"keys": ["wishes"]})
    assert (reply.status_code, reply.json()) == (409, {"error": "Only a stat you share can be pinned."})
    reply = demo.put("/api/profile/pins", json={"keys": ["primogems", "playtime", "endgame", "account"]})
    assert (reply.status_code, reply.json()) == (409, {"error": "You can pin three stats at most."})
    assert demo.put("/api/profile/pins", json={"keys": ["account"]}).json()["pins"] == ["account"]


def test_the_uid_switch_and_the_name_change_the_memory(demo):
    assert demo.put("/api/profile/find-by-uid", json={"on": True}).json()["find_by_uid"] is True
    model = demo.put("/api/profile/name", json={"name": "Lumine"}).json()
    assert (model["name"], model["tag"]) == ("Lumine", "2048")
    assert demo.get("/api/online").json()["name"] == "Lumine"
    reply = demo.put("/api/profile/name", json={"name": "a.b"})
    assert (reply.status_code, reply.json()) == (409, {"error": "Use 2 to 20 letters, digits, spaces, _ or -."})


def test_accept_moves_ola_into_the_list(demo):
    model = demo.post(f"/api/friends/{NOVA}/accept").json()
    assert model["incoming"] == [] and "Nova" in {friend["name"] for friend in model["friends"]}
    assert problem_with(model, "FriendsModel") is None


def test_decline_removes_the_request(demo):
    model = demo.post(f"/api/friends/{NOVA}/decline").json()
    assert model["incoming"] == [] and "Nova" not in {friend["name"] for friend in model["friends"]}


def test_remove_friend_changes_the_memory(demo):
    assert "Kira" not in {friend["name"] for friend in demo.delete(f"/api/friends/{KIRA}").json()["friends"]}
    assert demo.get(f"/api/friends/{KIRA}").status_code == 404


@pytest.mark.parametrize("query, sentence", [
    ("Nobody#0001", "No player has that tag."),
    ("712345312", "No player can be found by that UID."),
    ("Traveler#2048", "That is your own tag."),
    ("riley#7687", "You are already friends."),
])
def test_a_request_is_refused_as_the_real_thing_is(demo, query, sentence):
    reply = demo.post("/api/friends/request", json={"query": query})
    assert (reply.status_code, reply.json()) == (409, {"error": sentence})


def test_a_known_tag_sends_a_request(demo):
    model = demo.post("/api/friends/request", json={"query": "Elena#0031"}).json()
    assert [(card["name"], card["tag"]) for card in model["outgoing"]] == [("Elena", "0031")]
    reply = demo.post("/api/friends/request", json={"query": "Elena#0031"})
    assert (reply.status_code, reply.json()) == (
        409, {"error": "This player has a request from you, or declined one in the last 30 days."},
    )
    assert demo.delete(f"/api/friends/{model['outgoing'][0]['user_id']}").json()["outgoing"] == []


def test_asking_one_who_asked_accepts_them(demo):
    model = demo.post("/api/friends/request", json={"query": "Nova#5120"}).json()
    assert model["incoming"] == [] and "Nova" in {friend["name"] for friend in model["friends"]}


def test_an_invite_shows_who_it_is_from_and_sends_only_on_the_press(demo):
    link = demo.post("/api/friends/invite-link").json()["link"]
    assert link.startswith(f"https://{netpolicy.CLOUD_HOST}/functions/v1/invite?c=")
    demo.post("/api/demo/online", json={"state": "invite"})
    view = demo.get("/api/online").json()
    assert view["invite"] == {"name": "Nova", "tag": "5120", "has_picture": False, "ar": 41}
    model = demo.post("/api/friends/invite").json()
    assert "Nova" in {friend["name"] for friend in model["friends"]}
    assert demo.get("/api/online").json()["invite"] is None
    reply = demo.post("/api/friends/invite")
    assert (reply.status_code, reply.json()) == (409, {"error": "This invite was used or has expired. Ask for a new one."})


def test_an_invite_can_be_dropped(demo):
    demo.post("/api/demo/online", json={"state": "invite"})
    assert demo.delete("/api/friends/invite").json()["invite"] is None


def test_the_demo_can_show_a_link_that_was_used(demo):
    view = demo.post("/api/demo/online", json={"state": "invite_gone"}).json()
    assert (view["invite"], view["message"]) == (None, "This invite was used or has expired. Ask for a new one.")
    assert demo.delete("/api/friends/invite").json()["message"] is None


@pytest.mark.parametrize("state", ["signed_out", "waiting", "sign_in_again", "signed_in"])
def test_the_demo_shows_each_state(demo, state):
    assert demo.post("/api/demo/online", json={"state": state}).json()["state"] == state
    assert demo.get("/api/online").json()["state"] == state
    assert (demo.get("/api/online").json()["name"] is None) == (state in ("signed_out", "waiting"))


def test_signed_out_the_demo_has_no_friends_to_read(demo):
    demo.post("/api/demo/online", json={"state": "signed_out"})
    assert demo.get("/api/friends").status_code == 409
    assert demo.get("/api/profile").status_code == 409


def test_the_demo_can_show_the_server_away(demo):
    # A switch that could not change: the picture of it, and the browser test that the page puts the switch back.
    assert demo.post("/api/demo/online", json={"state": "offline"}).json()["offline"] is True
    before = demo.get("/api/profile").json()["sharing"]
    reply = demo.put("/api/profile/sharing", json={"keys": []})
    assert reply.status_code == 503 and "could not be reached" in reply.json()["error"]
    assert demo.get("/api/profile").json()["sharing"] == before
    assert demo.get("/api/friends").json()["stale"] is True
    assert demo.post("/api/demo/online", json={"state": "signed_in"}).json()["offline"] is False


def test_after_a_lost_session_the_demos_friends_stay_marked_old(demo):
    demo.post("/api/demo/online", json={"state": "sign_in_again"})
    for path in ("/api/friends", f"/api/friends/{RILEY}", f"/api/friends/{RILEY}/compare"):
        assert demo.get(path).json()["stale"] is True, path
    reply = demo.post(f"/api/friends/{NOVA}/accept")
    assert (reply.status_code, reply.json()) == (409, {"error": "Sign in again first."})


def test_a_state_the_demo_does_not_know_is_refused(demo):
    assert demo.post("/api/demo/online", json={"state": "asleep"}).status_code == 422


def test_the_route_is_the_demos_alone(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set(), cloud_fetch=FakeCloud(), open_browser=lambda address: None)
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        assert client.post("/api/demo/online", json={"state": "signed_out"}).status_code == 404
    core.store.close()


async def test_the_demo_holds_no_client(clock):
    online = DemoOnline(EventBus(), clock)
    assert not any("client" in name.lower() or "fetch" in name.lower() for name in vars(online))
    with pytest.raises(OnlineRefused):
        await online.friend_profile("00000000-0000-4000-8000-00000000dead")
    assert await online.friend_picture(RILEY) is None  # the page falls back to its sign, and nothing is fetched
