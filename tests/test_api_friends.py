"""What a player shares, through the API: the switches, the pins and the profile (the online plan, Task B2), and the
friends themselves (Task B3)."""
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from cloud_fakes import USER_ID, FakeCloud, answer
from guildboard.api.app import create_app
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.store import iso
from guildboard.tokenstore import StoredToken, TokenStore
from support import AccountSource, FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
PROFILE = ("GET", "/rest/v1/profiles")
PROFILE_UPDATE = ("PATCH", "/rest/v1/profiles")
SET_SHARING = ("POST", "/rest/v1/rpc/set_sharing")
SET_PINS = ("POST", "/rest/v1/rpc/set_pins")
RENAME = ("POST", "/rest/v1/rpc/rename_profile")
UPLOAD = ("POST", "/rest/v1/shared_stats")
OVERVIEW = ("POST", "/rest/v1/rpc/friends_overview")
REQUEST = ("POST", "/rest/v1/rpc/send_friend_request")
ANSWER = ("POST", "/rest/v1/rpc/answer_friend_request")
REMOVE = ("POST", "/rest/v1/rpc/remove_friend")
COMPARE = ("POST", "/rest/v1/rpc/compare_keys")
SET_UID = ("POST", "/rest/v1/rpc/set_uid")
OFFLINE = "The server could not be reached, so nothing changed. Try again later."
NOT_READ = "The server could not be reached. Try again later."
TAKEN = "uid_taken"  # set_uid's refusal when an account that can be found by the UID holds it
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24  # the first bytes of a picture, which is what the icon cache keeps
FRIEND_ID = "00000000-0000-0000-0000-00000000000b"
ASKER_ID = "00000000-0000-0000-0000-00000000000c"
RILEY = {
    "user_id": FRIEND_ID, "name": "Riley", "tag": "7687", "has_picture": True, "ar": 58, "uid": 712345312,
    "presence": {"state": "in_game", "since": "2026-10-13T07:00:00+00:00", "seen_seconds": 12},
    "stats": {
        "primogems": {"now": 1, "months": []},
        "playtime": {
            "week_hours": 2.0, "days30_hours": 3.0, "weeks": [1.0, 1.5, 0.5, 2.5, 3.0, 2.0], "week_start": "2026-10-12",
            "longest_run": 1,
        },
        "wishes": {"pity": 3, "five_stars_90d": 1},
        "spending": {"month_total": 40.0, "month": "2026-10", "currency": "PLN"},
    },
    "pins": ["wishes"], "compare": True,
}
OLA_CARD = {"user_id": ASKER_ID, "name": "Kira", "tag": "0412", "has_picture": False, "ar": 41}
OVERVIEW_ROWS = {"friends": [RILEY], "incoming": [OLA_CARD], "outgoing": []}


def own_row(**changes) -> dict:
    return {
        "name": "Nova", "discriminator": "5120", "picture_url": None, "ar": None, "uid": None, "find_by_uid": False,
        "pins": [], "sharing": [], **changes,
    }


class Page:
    """A signed-in live core with a HoYoLAB login, and a page that has the session cookie."""

    def __init__(self, tmp_path, clock, cloud: FakeCloud, *, login: bool = True) -> None:
        paths = AppPaths(tmp_path / "data")
        paths.ensure()
        CloudStore(paths.cloud_path).save(
            CloudSession("ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 3600, USER_ID, "Nova", "5120")
        )
        if login:
            TokenStore(paths.token_path).save(StoredToken({"ltoken_v2": "made-up"}, 700000001, "os_euro", "Traveler"))
        self.cloud, self.clock = cloud, clock
        self.core = Core(
            paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
            cloud_fetch=cloud, open_browser=lambda address: None,
        )
        self.client = TestClient(create_app(self.core, PORT), base_url=BASE)

    def __enter__(self) -> "Page":
        self.client.__enter__()
        self.client.get("/launch", params={"k": self.core.launch_secret}, follow_redirects=False)
        return self

    def __exit__(self, *exc: object) -> None:
        self.client.__exit__(*exc)
        self.core.store.close()

    def turn(self) -> None:
        self.client.portal.call(self.core.online.turn)


def _sent(cloud: FakeCloud, *names: str) -> list[str]:
    return [line for line in cloud.sent() if any(name in line for name in names)]


def test_every_stat_starts_off(tmp_path, clock):
    with Page(tmp_path, clock, FakeCloud({PROFILE: answer(200, [own_row()])})) as page:
        model = page.client.get("/api/profile").json()
    assert (model["sharing"], model["pins"], model["find_by_uid"]) == ([], [], False)
    assert (model["name"], model["tag"], model["server"]) == ("Nova", "5120", "os_euro")
    assert _sent(page.cloud, "shared_stats", "set_sharing", "set_pins") == []


def test_your_profile_holds_this_pcs_stats_also_for_what_is_off(tmp_path, clock):
    with Page(tmp_path, clock, FakeCloud({PROFILE: answer(200, [own_row(sharing=["status", "primogems"], uid=700000001)])})) as page:
        model = page.client.get("/api/profile").json()
    assert set(model) == {
        "name", "tag", "uid", "server", "status", "since", "find_by_uid", "sharing", "pins", "stats",
    }
    assert model["uid"] == 700000001 and model["sharing"] == ["status", "primogems"]
    assert "wishes" in model["stats"] and "primogems" in model["stats"]
    assert (model["status"], model["since"]) == ("open", iso(clock.now()))


def test_sharing_on_uploads_only_switched_on_keys(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), SET_SHARING: answer(204), UPLOAD: answer(201),
    })
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/sharing", json={"keys": ["status", "primogems", "wishes"]})
        assert reply.status_code == 200
        assert reply.json()["sharing"] == ["status", "primogems", "wishes"]
    assert cloud.sent()[-2:] == ["POST /rest/v1/rpc/set_sharing", "POST /rest/v1/shared_stats"]
    assert cloud.body(-2) == {"p_keys": ["status", "primogems", "wishes"]}
    rows = cloud.body(-1)
    assert sorted(row["key"] for row in rows) == ["primogems", "wishes"]  # Status is a switch, and no stat
    assert all(set(row) == {"user_id", "key", "value"} and row["user_id"] == USER_ID for row in rows)


def test_a_key_turned_off_is_not_uploaded_again(tmp_path, clock):
    # With Status shared, so that the stats go up with the first pass (with it off, they wait for the day's minute).
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row(sharing=["status", "primogems", "wishes"])]), SET_SHARING: answer(204),
        UPLOAD: answer(201), PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS),
        ("POST", "/rest/v1/rpc/heartbeat"): answer(204), SET_UID: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.turn()
        assert sorted(row["key"] for row in cloud.body(_at(cloud, "shared_stats"))) == ["primogems", "wishes"]
        assert page.client.put("/api/profile/sharing", json={"keys": ["status", "primogems"]}).status_code == 200
        assert cloud.sent()[-1] == "POST /rest/v1/rpc/set_sharing"  # nothing new came on, so nothing goes up


def test_a_key_turned_on_again_goes_up_again(tmp_path, clock):
    # Turning it off deleted the row on the server, so what was sent before says nothing about what is there now.
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row(sharing=["wishes"])]), SET_SHARING: answer(204), UPLOAD: answer(201),
        PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS), SET_UID: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.turn()
        page.client.put("/api/profile/sharing", json={"keys": []})
        page.client.put("/api/profile/sharing", json={"keys": ["wishes"]})
    assert cloud.sent()[-1] == "POST /rest/v1/shared_stats" and [row["key"] for row in cloud.body(-1)] == ["wishes"]


def test_an_upload_that_fails_after_the_switch_leaves_the_switch_on(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(200, [own_row()]), SET_SHARING: answer(204), UPLOAD: answer(503)})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/sharing", json={"keys": ["wishes"]})
        assert reply.status_code == 200 and reply.json()["sharing"] == ["wishes"]


def test_a_switch_that_could_not_change_stays_as_it_was(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(200, [own_row(sharing=["primogems"])]), SET_SHARING: answer(503)})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/sharing", json={"keys": []})
        assert (reply.status_code, reply.json()) == (503, {"error": OFFLINE})
        assert page.client.get("/api/profile").json()["sharing"] == ["primogems"]
        assert page.client.get("/api/online").json()["offline"] is True
    assert _sent(cloud, "shared_stats") == []


def test_a_name_and_the_uid_switch_change_on_the_server_or_not_at_all(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), RENAME: answer(503), SET_UID: answer(503),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.client.get("/api/profile")
        reply = page.client.put("/api/profile/name", json={"name": "Nova Vale"})
        assert (reply.status_code, reply.json()) == (503, {"error": OFFLINE})
        reply = page.client.put("/api/profile/find-by-uid", json={"on": True})
        assert (reply.status_code, reply.json()) == (503, {"error": OFFLINE})
        model = page.client.get("/api/profile").json()
        assert (model["name"], model["find_by_uid"]) == ("Nova", False)
        assert page.client.get("/api/online").json()["name"] == "Nova"


def test_a_new_name_comes_back_with_its_number(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), RENAME: answer(200, own_row(name="Nova Vale", discriminator="0007")),
    })
    with Page(tmp_path, clock, cloud) as page:
        model = page.client.put("/api/profile/name", json={"name": "Nova Vale"}).json()
        assert (model["name"], model["tag"]) == ("Nova Vale", "0007")
        view = page.client.get("/api/online").json()
        assert (view["name"], view["tag"]) == ("Nova Vale", "0007")
    assert cloud.body(-1) == {"p_name": "Nova Vale"}


def test_a_name_that_breaks_the_rule_says_so(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(200, [own_row()]), RENAME: answer(400, {"message": "invalid_name"})})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/name", json={"name": "a.b"})
    assert (reply.status_code, reply.json()) == (409, {"error": "Use 2 to 20 letters, digits, spaces, _ or -."})


def test_a_rename_with_the_account_gone_is_a_lost_session(tmp_path, clock):
    # rename_profile says not_signed_in when the row is gone: an account deleted on another device.
    cloud = FakeCloud({PROFILE: answer(200, [own_row()]), RENAME: answer(400, {"message": "not_signed_in"})})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/name", json={"name": "Nova Vale"})
        assert reply.status_code == 409 and reply.json() == {"error": "Sign in again first."}
        assert page.client.get("/api/online").json()["state"] == "sign_in_again"


def test_the_uid_switch_goes_up_through_set_uid(tmp_path, clock):
    # The UID and its switch are written by set_uid alone, which keeps a UID unique only among the players who can be found by
    # it (the audit's SQL-2): the profile's columns take neither by a PATCH any more.
    cloud = FakeCloud({PROFILE: answer(200, [own_row(uid=700000001)]), SET_UID: answer(204)})
    with Page(tmp_path, clock, cloud) as page:
        page.client.get("/api/profile")
        model = page.client.put("/api/profile/find-by-uid", json={"on": True}).json()
    assert model["find_by_uid"] is True
    assert cloud.sent()[-1] == "POST /rest/v1/rpc/set_uid" and cloud.body(-1) == {"p_uid": 700000001, "p_find": True}


@pytest.mark.parametrize("message, sentence", [
    ("uid_taken", "Another Guild Board account can be found by this UID. Turn off Find me by UID to keep it on yours."),
    ("lookup_limit", "Wait a second and try again."),
    ("invalid_uid", "A UID has 9 or 10 digits."),
])
def test_a_refused_uid_switch_says_why_and_stays(tmp_path, clock, message, sentence):
    cloud = FakeCloud({PROFILE: answer(200, [own_row(uid=700000001)]), SET_UID: answer(400, {"code": "P0001", "message": message})})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/find-by-uid", json={"on": True})
        assert (reply.status_code, reply.json()) == (409, {"error": sentence})
        assert page.client.get("/api/profile").json()["find_by_uid"] is False


def test_a_pin_needs_a_shared_stat_and_at_most_three(tmp_path, clock):
    shared = ["status", "primogems", "playtime", "endgame", "account"]
    cloud = FakeCloud({PROFILE: answer(200, [own_row(sharing=shared)]), SET_PINS: answer(204)})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/pins", json={"keys": ["primogems", "wishes"]})
        assert (reply.status_code, reply.json()) == (409, {"error": "Only a stat you share can be pinned."})
        reply = page.client.put("/api/profile/pins", json={"keys": ["status"]})
        assert (reply.status_code, reply.json()) == (409, {"error": "Only a stat you share can be pinned."})
        reply = page.client.put("/api/profile/pins", json={"keys": ["primogems", "playtime", "endgame", "account"]})
        assert (reply.status_code, reply.json()) == (409, {"error": "You can pin three stats at most."})
        assert _sent(cloud, "set_pins") == []
        model = page.client.put("/api/profile/pins", json={"keys": ["endgame", "primogems"]}).json()
    assert model["pins"] == ["endgame", "primogems"]
    assert cloud.body(-1) == {"p_keys": ["endgame", "primogems"]}


def test_a_refused_pin_on_the_server_keeps_the_pins(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row(sharing=["primogems"], pins=["primogems"])]),
        SET_PINS: answer(400, {"message": "pin_not_shared"}),
    })
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.put("/api/profile/pins", json={"keys": []})
        assert (reply.status_code, reply.json()) == (409, {"error": "Only a stat you share can be pinned."})
        assert page.client.get("/api/profile").json()["pins"] == ["primogems"]


def test_a_key_turned_off_takes_its_pin(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row(sharing=["primogems", "wishes"], pins=["wishes", "primogems"])]),
        SET_SHARING: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        model = page.client.put("/api/profile/sharing", json={"keys": ["primogems"]}).json()
    assert model["pins"] == ["primogems"]


@pytest.mark.parametrize("url, body", [
    ("/api/profile/sharing", {"keys": "primogems"}),
    ("/api/profile/sharing", {"keys": ["gallery"]}),
    ("/api/profile/sharing", {"keys": [1]}),
    ("/api/profile/sharing", {}),
    ("/api/profile/pins", {"keys": None}),
    ("/api/profile/find-by-uid", {"on": "yes"}),
    ("/api/profile/name", {"name": 7}),
    ("/api/profile/name", {"name": "x" * 200}),
])
def test_a_body_of_the_wrong_shape_is_refused_and_nothing_goes_out(tmp_path, clock, url, body):
    cloud = FakeCloud()
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.put(url, json=body).status_code == 422
    assert cloud.requests == []


def test_the_profile_needs_a_session(tmp_path, clock):
    with Page(tmp_path, clock, FakeCloud({("POST", "/auth/v1/logout"): answer(204)})) as page:
        page.client.post("/api/online/sign-out")
        assert page.client.get("/api/profile").status_code == 409
        assert page.client.put("/api/profile/sharing", json={"keys": []}).status_code == 409


def test_a_profile_never_read_with_the_server_away_says_so(tmp_path, clock):
    with Page(tmp_path, clock, FakeCloud({PROFILE: answer(503)})) as page:
        reply = page.client.get("/api/profile")
        assert (reply.status_code, reply.json()) == (503, {"error": NOT_READ})


def test_the_uid_goes_up_once_known_and_a_taken_uid_says_so(tmp_path, clock):
    picture = "https://act-webstatic.hoyoverse.com/a.png"
    cloud = FakeCloud({
        PROFILE: [answer(200, [own_row()]), answer(200, [own_row(uid=700000001, ar=58, picture_url=picture)])],
        SET_UID: answer(204), PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"adventure_rank": 58, "picture_url": picture})
        page.turn()
        assert cloud.body(_at(cloud, "set_uid")) == {"p_uid": 700000001, "p_find": False}
        assert cloud.body(_at(cloud, "PATCH")) == {"ar": 58, "picture_url": picture}
        before = len(_sent(cloud, "PATCH", "set_uid"))
        clock.advance(minutes=5)
        page.turn()
        assert len(_sent(cloud, "PATCH", "set_uid")) == before  # the server holds them now: they go up once

    taken = FakeCloud({
        PROFILE: answer(200, [own_row(find_by_uid=True)]), SET_UID: answer(400, {"code": "P0001", "message": TAKEN}),
        PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS),
    })
    with Page(tmp_path / "another", clock, taken) as page:
        page.turn()
        assert taken.body(_at(taken, "set_uid")) == {"p_uid": 700000001, "p_find": True}
        assert page.client.get("/api/online").json()["message"] == (
            "Another Guild Board account can be found by this UID. Turn off Find me by UID to keep it on yours."
        )
        sent = len(_sent(taken, "set_uid"))
        clock.advance(minutes=5)
        page.turn()
        assert len(_sent(taken, "set_uid")) == sent  # asking again would be refused again


def test_a_uid_refused_as_taken_goes_up_again_once_the_switch_changes(tmp_path, clock):
    # A UID is unique only among the players who can be found by it: with the switch off, the one refused can be held.
    cloud = FakeCloud({
        PROFILE: [answer(200, [own_row(find_by_uid=True)]), answer(200, [own_row()])],
        OVERVIEW: answer(200, OVERVIEW_ROWS), PROFILE_UPDATE: answer(204),
        SET_UID: [answer(400, {"code": "P0001", "message": TAKEN}), answer(204)],
    })
    with Page(tmp_path, clock, cloud) as page:
        page.turn()
        assert page.client.put("/api/profile/find-by-uid", json={"on": False}).status_code == 200
        assert cloud.body(-1) == {"p_uid": None, "p_find": False}
        clock.advance(minutes=5)
        page.turn()
        last = max(index for index, line in enumerate(cloud.sent()) if "set_uid" in line)
        assert cloud.body(last) == {"p_uid": 700000001, "p_find": False}
        assert page.client.get("/api/online").json()["message"] is None


def test_a_taken_uid_leaves_the_rest_of_the_profile_going_up(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, OVERVIEW_ROWS), PROFILE_UPDATE: answer(204),
        SET_UID: answer(400, {"code": "P0001", "message": TAKEN}),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"adventure_rank": 58})
        page.turn()
    assert cloud.body(_at(cloud, "PATCH")) == {"ar": 58}


@pytest.mark.parametrize("refused, again", [
    ({"code": "P0001", "message": "lookup_limit"}, True),  # the second set_uid shares with the lookups, used up: next pass
    ({"code": "23505", "message": 'duplicate key value violates unique constraint "profiles_uid_findable"'}, False),
    ({"code": "P0001", "message": "invalid_uid"}, False),  # a UID the table does not take is not asked for again
])
def test_a_uid_the_server_refuses_leaves_the_rest_going_up(tmp_path, clock, refused, again):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, OVERVIEW_ROWS), PROFILE_UPDATE: answer(204),
        SET_UID: answer(400, refused),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"adventure_rank": 58})
        page.turn()
        assert cloud.body(_at(cloud, "PATCH")) == {"ar": 58}
        clock.advance(minutes=5)
        page.turn()
    assert len(_sent(cloud, "set_uid")) == (2 if again else 1)


def test_the_uid_and_its_switch_never_go_by_patch(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, OVERVIEW_ROWS), PROFILE_UPDATE: answer(204),
        SET_UID: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"adventure_rank": 58})
        page.turn()
        page.client.put("/api/profile/find-by-uid", json={"on": True})
        page.client.put("/api/profile/find-by-uid", json={"on": False})
    patched = [cloud.body(index) for index, line in enumerate(cloud.sent()) if line.startswith("PATCH ")]
    assert patched and not any({"uid", "find_by_uid"} & set(body) for body in patched)


def test_another_game_accounts_profile_is_left_alone(tmp_path, clock):
    # A second PC with another game account: the profile keeps the UID it holds, and neither its AR nor its stats change.
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row(uid=800000002, ar=30, sharing=["wishes"])]), OVERVIEW: answer(200, OVERVIEW_ROWS),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"adventure_rank": 58})
        page.turn()
    assert _sent(cloud, "PATCH", "shared_stats") == []


@pytest.mark.parametrize("link", [
    "https://evil.example/a.png", "http://hoyolab.com/a.png", "https://hoyolab.com.evil.example/a.png",
    "https://hoyolab.com/" + "x" * 481,  # 501 letters, one past what the table takes
])
def test_a_picture_the_table_would_refuse_stays_home(tmp_path, clock, link):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS), SET_UID: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"picture_url": link})
        page.turn()
    assert _sent(cloud, "PATCH") == []  # nothing else had changed: only the UID went up, through set_uid


def test_a_picture_of_500_letters_goes_up(tmp_path, clock):
    link = "https://hoyolab.com/" + "x" * 480
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS), SET_UID: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"picture_url": link})
        page.turn()
    assert cloud.body(_at(cloud, "PATCH")) == {"picture_url": link}


@pytest.mark.parametrize("rank", [0, 61, -3])
def test_an_adventure_rank_the_table_would_refuse_stays_home(tmp_path, clock, rank):
    # The table takes an AR of 1 to 60 (0004): one outside would refuse the picture beside it at every pass.
    link = "https://hoyolab.com/a.png"
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), PROFILE_UPDATE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS), SET_UID: answer(204),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.core.store.set_latest_doc("overview", clock.now(), {"adventure_rank": rank, "picture_url": link})
        page.turn()
    assert cloud.body(_at(cloud, "PATCH")) == {"picture_url": link}


# ---------------------------------------------------------------------------------------------- the friends (Task B3)


def test_the_friends_page_reads_the_list(tmp_path, clock):
    cloud = FakeCloud({OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        model = page.client.get("/api/friends").json()
    assert set(model) == {"me", "friends", "incoming", "outgoing", "read_at", "stale"}
    assert model["me"] == {"name": "Nova", "tag": "5120"}
    assert model["incoming"] == [OLA_CARD] and model["outgoing"] == []
    riley = model["friends"][0]
    assert (riley["status"], riley["pills"], riley["compare"]) == ("in_game", ["wishes"], True)
    assert (model["read_at"], model["stale"]) == (iso(clock.now()), False)


def test_fresh_one_asks_again(tmp_path, clock):
    cloud = FakeCloud({OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        page.client.get("/api/friends")
        clock.advance(seconds=60)
        page.client.get("/api/friends")
        assert len(_sent(cloud, "friends_overview")) == 1
        page.client.get("/api/friends", params={"fresh": 1})
        assert len(_sent(cloud, "friends_overview")) == 2


@pytest.mark.parametrize("code, sentence", [
    ("no_such_tag", "No player has that tag."),
    ("no_such_uid", "No player can be found by that UID."),
])
def test_a_lookup_that_finds_nobody_answers_with_its_code(tmp_path, clock, code, sentence):
    # These two come back as the function's answer, not as a refusal, so that the lookup stays counted (0002_friends.sql).
    cloud = FakeCloud({REQUEST: answer(200, code), OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.post("/api/friends/request", json={"query": "Nobody#0001"})
    assert (reply.status_code, reply.json()) == (409, {"error": sentence})
    assert _sent(cloud, "friends_overview") == []


@pytest.mark.parametrize("code, sentence", [
    ("request_limit", "You sent 20 requests today. Try again tomorrow."),
    ("lookup_limit", "Wait a second and try again."),
    ("friend_limit", "You have 200 friends, the most Guild Board allows."),
    ("own_tag", "That is your own tag."),
    ("already_friends", "You are already friends."),
    # Also the answer for 30 days after the player declined, when the Outgoing list shows nothing (0004).
    ("already_sent", "This player has a request from you, or declined one in the last 30 days."),
    ("incoming_full", "This player has too many friend requests waiting. Try again later."),  # 0004's cap of 50
    ("something_new", "The server refused this. Try again later."),
])
def test_a_refused_request_says_why(tmp_path, clock, code, sentence):
    cloud = FakeCloud({REQUEST: answer(400, {"message": code})})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.post("/api/friends/request", json={"query": "Riley#7687"})
    assert (reply.status_code, reply.json()) == (409, {"error": sentence})


def test_a_request_sent_gives_the_new_list(tmp_path, clock):
    cloud = FakeCloud({REQUEST: answer(200, "sent"), OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        model = page.client.post("/api/friends/request", json={"query": "Riley#7687"}).json()
    assert model["friends"][0]["name"] == "Riley"
    assert cloud.sent() == ["POST /rest/v1/rpc/send_friend_request", "POST /rest/v1/rpc/friends_overview"]
    assert cloud.body(0) == {"p_query": "Riley#7687"}


def test_a_request_with_the_server_away_says_so(tmp_path, clock):
    cloud = FakeCloud({REQUEST: answer(503)})
    with Page(tmp_path, clock, cloud) as page:
        reply = page.client.post("/api/friends/request", json={"query": "Riley#7687"})
    assert (reply.status_code, reply.json()) == (503, {"error": OFFLINE})


def test_accept_decline_and_remove_go_to_the_server(tmp_path, clock):
    cloud = FakeCloud({ANSWER: answer(204), REMOVE: answer(204), OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.post(f"/api/friends/{ASKER_ID}/accept").status_code == 200
        assert cloud.body(-2) == {"p_user": ASKER_ID, "p_accept": True}
        assert page.client.post(f"/api/friends/{ASKER_ID}/decline").status_code == 200
        assert cloud.body(-2) == {"p_user": ASKER_ID, "p_accept": False}
        assert page.client.delete(f"/api/friends/{FRIEND_ID}").status_code == 200
        assert cloud.body(-2) == {"p_user": FRIEND_ID}


def test_a_friend_gives_their_profile_and_nobody_else_does(tmp_path, clock):
    cloud = FakeCloud({OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.get(f"/api/friends/{FRIEND_ID}").json()["friend"]["name"] == "Riley"
        assert page.client.get(f"/api/friends/{ASKER_ID}").status_code == 404  # a request is no friend


def test_compare_keeps_only_keys_both_share(tmp_path, clock):
    # Riley shares three stats; compare_keys names two. The third doesn't reach the page, whichever side it is on.
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row(sharing=["primogems", "playtime", "endgame"], ar=60, picture_url="https://hoyolab.com/a.png")]),
        OVERVIEW: answer(200, OVERVIEW_ROWS), COMPARE: answer(200, ["primogems", "playtime"]),
    })
    with Page(tmp_path, clock, cloud) as page:
        model = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
    assert set(model) == {"me", "friend", "keys", "mine", "week_start", "read_at", "stale"}
    assert model["keys"] == ["primogems", "playtime"]
    assert set(model["friend"]["stats"]) == {"primogems", "playtime"}
    assert set(model["mine"]) == {"primogems", "playtime"}
    assert model["friend"]["pills"] == []  # wishes is pinned, and not for this page
    assert model["me"] == {
        "user_id": USER_ID, "name": "Nova", "tag": "5120", "has_picture": True, "ar": 60, "status": "open",
        "since": iso(clock.now()),
    }
    assert cloud.body(_at(cloud, "compare_keys")) == {"p_friend": FRIEND_ID}


def _at(cloud: FakeCloud, what: str) -> int:
    return next(index for index, line in enumerate(cloud.sent()) if what in line)


def test_compare_names_the_week_by_the_servers_reset(tmp_path, clock):
    # 03:45 on a Monday on Europe's server is still Sunday's game day, so this is the week that began seven days ago.
    clock.set(datetime(2026, 10, 12, 2, 45, tzinfo=timezone.utc))
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, OVERVIEW_ROWS), COMPARE: answer(200, ["playtime"]),
    })
    with Page(tmp_path, clock, cloud) as page:
        before = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
        clock.advance(minutes=30)  # 04:15: the reset has passed
        after = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
    assert (before["week_start"], after["week_start"]) == ("2026-10-05", "2026-10-12")


def test_compare_reads_keys_in_either_of_postgrests_shapes(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, OVERVIEW_ROWS),
        COMPARE: answer(200, [{"compare_keys": "wishes"}]),
    })
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()["keys"] == ["wishes"]


def test_compare_with_someone_who_is_no_friend_is_refused(tmp_path, clock):
    cloud = FakeCloud({OVERVIEW: answer(200, OVERVIEW_ROWS)})
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.get(f"/api/friends/{ASKER_ID}/compare").status_code == 404
    assert _sent(cloud, "compare_keys") == []


def test_a_friends_picture_comes_through_the_icons(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(200, [{"picture_url": "https://act-webstatic.hoyoverse.com/a.png"}])})
    with Page(tmp_path, clock, cloud) as page:
        asked: list[str] = []
        page.core.icons._fetch = lambda url: asked.append(url) or PNG
        reply = page.client.get(f"/api/friends/{FRIEND_ID}/picture")
    assert (reply.status_code, reply.content, asked) == (200, PNG, ["https://act-webstatic.hoyoverse.com/a.png"])
    assert cloud.sent() == [f"GET /rest/v1/profiles?select=picture_url&user_id=eq.{FRIEND_ID}"]


@pytest.mark.parametrize("link", [
    "https://evil.example/a.png",
    "https://sg-public-api.hoyolab.com/event/game_record/card/a.png",  # on HoYoverse's domains, and no picture host
])
def test_a_friends_picture_outside_the_picture_hosts_is_refused(tmp_path, clock, link):
    cloud = FakeCloud({PROFILE: answer(200, [{"picture_url": link}])})
    with Page(tmp_path, clock, cloud) as page:
        asked: list[str] = []
        page.core.icons._fetch = lambda url: asked.append(url) or PNG
        assert page.client.get(f"/api/friends/{FRIEND_ID}/picture").status_code == 404
    assert asked == []


def test_a_picture_that_cannot_be_fetched_is_not_asked_again_for_a_day(tmp_path, clock):
    # A page shows a friend's picture each time it draws them: one that could not be fetched, or was no picture, is asked of
    # HoYoverse again a day later (the audit's NET-7).
    link = "https://act-webstatic.hoyoverse.com/a.png"
    cloud = FakeCloud({PROFILE: answer(200, [{"picture_url": link}])})
    with Page(tmp_path, clock, cloud) as page:
        asked: list[str] = []
        seconds = {"now": 0.0}
        page.core.icons._fetch = lambda url: asked.append(url) or b"<html>not found</html>"
        page.core.icons._now = lambda: seconds["now"]
        for _ in range(3):
            assert page.client.get(f"/api/friends/{FRIEND_ID}/picture").status_code == 404
        assert asked == [link]
        seconds["now"] += 24 * 3600
        page.core.icons._fetch = lambda url: asked.append(url) or PNG
        assert page.client.get(f"/api/friends/{FRIEND_ID}/picture").content == PNG
    assert asked == [link, link]


def test_a_stranger_has_no_picture(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(200, [])})  # row level security leaves no row
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.get(f"/api/friends/{FRIEND_ID}/picture").status_code == 404


@pytest.mark.parametrize("user", [
    "not-an-id", "00000000-0000-0000-0000-00000000000b&select=*", "00000000-0000-0000-0000-00000000000B%00",
    "or=(a.eq.1)", "..", "user_id=neq.x",
])
def test_an_address_that_names_no_player_reaches_nothing(tmp_path, clock, user):
    cloud = FakeCloud()
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.get(f"/api/friends/{user}/picture").status_code == 404
        assert page.client.get(f"/api/friends/{user}/compare").status_code == 404
        assert page.client.post(f"/api/friends/{user}/accept").status_code == 404
        assert page.client.delete(f"/api/friends/{user}").status_code == 404
    assert cloud.requests == []


@pytest.mark.parametrize("body", [{}, {"query": 7}, {"query": "x" * 200}])
def test_a_request_of_the_wrong_shape_is_refused(tmp_path, clock, body):
    cloud = FakeCloud()
    with Page(tmp_path, clock, cloud) as page:
        assert page.client.post("/api/friends/request", json=body).status_code == 422
    assert cloud.requests == []


def test_signed_out_there_are_no_friends_to_read(tmp_path, clock):
    cloud = FakeCloud({("POST", "/auth/v1/logout"): answer(204)})
    with Page(tmp_path, clock, cloud) as page:
        page.client.post("/api/online/sign-out")
        sent = len(cloud.requests)
        for reply in (
            page.client.get("/api/friends"), page.client.get(f"/api/friends/{FRIEND_ID}"),
            page.client.post("/api/friends/request", json={"query": "Riley#7687"}),
            page.client.post(f"/api/friends/{FRIEND_ID}/accept"), page.client.delete(f"/api/friends/{FRIEND_ID}"),
        ):
            assert (reply.status_code, reply.json()) == (409, {"error": "Sign in first."})
        assert len(cloud.requests) == sent


@pytest.mark.parametrize("reason", ["lost", "quiet"])
def test_a_picture_asks_nothing_of_a_server_that_wont_answer(tmp_path, clock, reason):
    # A page with five friends would ask five times over for each of its pictures.
    cloud = FakeCloud({PROFILE: answer(200, []) if reason == "lost" else answer(503)})
    with Page(tmp_path, clock, cloud) as page:
        page.client.portal.call(page.core.online.look)
        sent = len(cloud.requests)
        assert page.client.get(f"/api/friends/{FRIEND_ID}/picture").status_code == 404
    assert len(cloud.requests) == sent


def test_a_lost_session_keeps_the_last_list_marked_old(tmp_path, clock):
    cloud = FakeCloud({
        OVERVIEW: [answer(200, OVERVIEW_ROWS), answer(200, {})], PROFILE: answer(200, []),
    })
    with Page(tmp_path, clock, cloud) as page:
        page.client.get("/api/friends")
        page.client.portal.call(page.core.online.look)
        assert page.client.get("/api/online").json()["state"] == "sign_in_again"
        clock.advance(seconds=60)  # long enough for a fresh ask to read again, were it to
        model = page.client.get("/api/friends", params={"fresh": 1}).json()
    assert model["stale"] is True and model["friends"][0]["name"] == "Riley"
    assert len(_sent(cloud, "friends_overview")) == 1


def test_a_lost_session_keeps_a_friend_and_compare_marked_old(tmp_path, clock):
    # The design's section 5: the online parts go quiet, and friends show their last known state, marked as old. Compare can't
    # ask compare_keys, so it goes by what the two sides last said they share.
    cloud = FakeCloud({
        OVERVIEW: answer(200, OVERVIEW_ROWS), PROFILE: [answer(200, [own_row(sharing=["primogems", "wishes"])]), answer(200, [])],
    })
    with Page(tmp_path, clock, cloud) as page:
        read_at = page.client.get("/api/friends").json()["read_at"]
        page.client.get("/api/profile")
        page.client.portal.call(page.core.online.look)
        assert page.client.get("/api/online").json()["state"] == "sign_in_again"
        sent = len(cloud.requests)
        clock.advance(seconds=60)
        profile = page.client.get(f"/api/friends/{FRIEND_ID}").json()
        compare = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
        assert len(cloud.requests) == sent
    assert (profile["friend"]["name"], profile["read_at"], profile["stale"]) == ("Riley", read_at, True)
    assert (compare["friend"]["name"], compare["read_at"], compare["stale"]) == ("Riley", read_at, True)
    assert compare["keys"] == ["primogems", "wishes"] and set(compare["mine"]) == {"primogems", "wishes"}


def test_the_list_kept_after_a_lost_session_ages_with_the_calendar(tmp_path, clock):
    # A friend's play time names its week, and their spending its month. The list kept is read again at every page, against
    # that day's date: two weeks on, Riley's last upload is no longer this week's, on the Friends list, on his profile and on
    # Compare alike (the online plan, Task C0).
    cloud = FakeCloud({
        OVERVIEW: answer(200, OVERVIEW_ROWS), COMPARE: answer(200, ["playtime", "spending"]),
        PROFILE: [answer(200, [own_row(sharing=["playtime", "spending"])]), answer(200, [])],
    })
    with Page(tmp_path, clock, cloud) as page:
        page.client.get("/api/friends")
        page.client.get("/api/profile")
        page.client.portal.call(page.core.online.look)
        assert page.client.get("/api/online").json()["state"] == "sign_in_again"
        sent = len(cloud.requests)

        now = page.client.get(f"/api/friends/{FRIEND_ID}").json()["friend"]["stats"]
        assert now["playtime"] == RILEY["stats"]["playtime"] and now["spending"] == RILEY["stats"]["spending"]

        clock.advance(days=14)  # Tuesday the 27th: the week of Monday the 26th, in the same month
        listed = page.client.get("/api/friends").json()["friends"][0]["stats"]
        profile = page.client.get(f"/api/friends/{FRIEND_ID}").json()["friend"]["stats"]
        compare = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
        aged = {
            "week_hours": None, "days30_hours": None, "weeks": [0.5, 2.5, 3.0, 2.0, None, None], "week_start": "2026-10-26",
            "longest_run": 1,
        }
        for stats in (listed, profile, compare["friend"]["stats"]):
            assert stats["playtime"] == aged
            assert stats["spending"] == RILEY["stats"]["spending"]  # still October
        assert compare["week_start"] == aged["week_start"]  # the chart names its columns from this, and the last is this week

        clock.advance(days=7)  # Tuesday 3 November: the total of October is not this month's
        later = page.client.get("/api/friends").json()["friends"][0]["stats"]
        assert later["spending"] == {"month_total": None, "month": "2026-11", "currency": "PLN"}
        assert later["playtime"]["weeks"] == [2.5, 3.0, 2.0, None, None, None]
        assert later["primogems"] == RILEY["stats"]["primogems"] and later["wishes"] == RILEY["stats"]["wishes"]
        assert len(cloud.requests) == sent  # nothing was asked of the server


def test_compare_asks_nothing_of_a_server_that_is_away(tmp_path, clock):
    # A page open on Compare reads it each minute: the five quiet minutes after a failure hold for it too (Review Focus 1).
    cloud = FakeCloud({
        OVERVIEW: answer(200, OVERVIEW_ROWS), PROFILE: [answer(200, [own_row(sharing=["wishes"])]), answer(503)],
    })
    with Page(tmp_path, clock, cloud) as page:
        page.client.get("/api/friends")
        page.client.get("/api/profile")
        page.client.portal.call(page.core.online.look)
        sent = len(cloud.requests)
        model = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
        assert len(cloud.requests) == sent
    assert (model["keys"], model["stale"]) == (["wishes"], True)


def test_a_friend_and_compare_say_how_old_they_are(tmp_path, clock):
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, OVERVIEW_ROWS), COMPARE: answer(200, ["wishes"]),
    })
    with Page(tmp_path, clock, cloud) as page:
        profile = page.client.get(f"/api/friends/{FRIEND_ID}").json()
        compare = page.client.get(f"/api/friends/{FRIEND_ID}/compare").json()
    assert (profile["read_at"], profile["stale"]) == (iso(clock.now()), False)
    assert (compare["read_at"], compare["stale"]) == (iso(clock.now()), False)


@pytest.mark.parametrize("number", [
    pytest.param("1" + "0" * 5000, id="an integer of 5,001 digits, which fits in a stat as 1e5000"),
    pytest.param("1" + "0" * 400 + ".5", id="a fraction too large for a float"),
])
def test_one_friends_impossible_number_costs_the_player_nothing(tmp_path, clock, number):
    # One accepted friend, one number in one stat, as a real server gives it back. It used to make the whole list unreadable,
    # so that the server counted as away for the friends, the sync and the player's own status, and with no list the page had
    # no friend to remove; or it came through as infinity, which the answer to a request sent refuses to write.
    body = json.dumps(OVERVIEW_ROWS).replace('"now": 1,', f'"now": {number},').encode()
    assert number.encode() in body
    cloud = FakeCloud({
        PROFILE: answer(200, [own_row()]), OVERVIEW: answer(200, body), REMOVE: answer(204), REQUEST: answer(200, "sent"),
    })
    with Page(tmp_path, clock, cloud) as page:
        response = page.client.get("/api/friends")
        assert response.status_code == 200
        model = response.json()
        assert page.client.get("/api/online").json()["offline"] is False
        [friend] = model["friends"]
        assert (friend["name"], friend["stats"]["primogems"]["now"], model["stale"]) == ("Riley", None, False)
        assert friend["stats"]["wishes"]["pity"] == 3  # the rest of what they share stands
        assert page.client.post("/api/friends/request", json={"query": "Kira#0412"}).status_code == 200
        assert page.client.delete(f"/api/friends/{FRIEND_ID}").status_code == 200  # and the player can remove them
