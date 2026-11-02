"""The online client on a fake wire: it refreshes itself, and tells offline from refused."""
import asyncio
import logging
import time
import urllib.error
from dataclasses import replace

import pytest

from cloud_fakes import USER_ID, FakeCloud, answer, token_answer
from guildboard.cloud import CLOUD_KEY
from guildboard.cloud.client import CloudClient, CloudOffline, CloudRefused, SessionLost, tokens_from
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.netpolicy import RedirectRefused, ResponseTooLarge

NOW = 1_800_000_000.0
ACCESS, REFRESH = "ACCESS-0123456789", "REFRESH-0123456789"
SESSION = CloudSession(ACCESS, REFRESH, NOW + 3600, USER_ID, "Nova", "5120")
EXPIRED = CloudSession(ACCESS, REFRESH, NOW - 1, USER_ID, "Nova", "5120")
REFRESHING = ("POST", "/auth/v1/token?grant_type=refresh_token")
SELECTING = ("GET", "/rest/v1/profiles")


def _client(tmp_path, cloud: FakeCloud, session: CloudSession | None = SESSION) -> tuple[CloudClient, CloudStore]:
    store = CloudStore(tmp_path / "cloud.bin")
    if session is not None:
        store.save(session)
    return CloudClient(store, fetch=cloud, now=lambda: NOW), store


def _refreshes(cloud: FakeCloud) -> list[str]:
    return [line for line in cloud.sent() if "grant_type=refresh_token" in line]


# ---------------------------------------------------------------- what is sent

CALLS = {
    "rpc": lambda client: client.rpc("heartbeat", {"p_state": "open"}),
    "select": lambda client: client.select("profiles", "select=name"),
    "upsert": lambda client: client.upsert("shared_stats", [{"key": "wishes"}]),
    "update": lambda client: client.update("profiles", "user_id=eq.x", {"ar": 58}),
    "delete": lambda client: client.delete("shared_stats", "key=eq.wishes"),
}
WIRE = {
    "rpc": ("POST", "/rest/v1/rpc/heartbeat", {"p_state": "open"}),
    "select": ("GET", "/rest/v1/profiles?select=name", None),
    "upsert": ("POST", "/rest/v1/shared_stats", [{"key": "wishes"}]),
    "update": ("PATCH", "/rest/v1/profiles?user_id=eq.x", {"ar": 58}),
    "delete": ("DELETE", "/rest/v1/shared_stats?key=eq.wishes", None),
}


def _answering_all() -> FakeCloud:
    return FakeCloud({
        ("POST", "/rest/v1/rpc/"): answer(204), ("GET", "/rest/v1/"): answer(200, []),
        ("POST", "/rest/v1/shared_stats"): answer(201), ("PATCH", "/rest/v1/"): answer(204),
        ("DELETE", "/rest/v1/"): answer(204),
    })


@pytest.mark.parametrize("name", CALLS)
async def test_every_request_carries_the_key_and_the_session(tmp_path, name):
    cloud = _answering_all()
    client, _ = _client(tmp_path, cloud)
    await CALLS[name](client)
    [(method, path, headers, _)] = cloud.requests
    assert (method, path) == WIRE[name][:2]
    assert cloud.body() == WIRE[name][2]
    assert headers["apikey"] == CLOUD_KEY
    assert headers["Authorization"] == f"Bearer {ACCESS}"


@pytest.mark.parametrize("name, prefer", [
    ("upsert", "resolution=merge-duplicates,return=minimal"), ("update", "return=minimal"), ("delete", "return=minimal"),
])
async def test_writes_ask_for_no_answer_and_an_upsert_merges(tmp_path, name, prefer):
    cloud = _answering_all()
    client, _ = _client(tmp_path, cloud)
    await CALLS[name](client)
    assert cloud.requests[0][2]["Prefer"] == prefer


@pytest.mark.parametrize("name", ["rpc", "select"])
async def test_a_read_and_a_function_want_their_answer(tmp_path, name):
    cloud = _answering_all()
    client, _ = _client(tmp_path, cloud)
    await CALLS[name](client)
    assert "Prefer" not in cloud.requests[0][2]


async def test_a_body_says_it_is_json(tmp_path):
    cloud = _answering_all()
    client, _ = _client(tmp_path, cloud)
    await CALLS["rpc"](client)
    assert cloud.requests[0][2]["Content-Type"] == "application/json"


async def test_rpc_gives_the_functions_answer(tmp_path):
    cloud = FakeCloud({("POST", "/rest/v1/rpc/ensure_profile"): answer(200, {"name": "Nova", "discriminator": "5120"})})
    client, _ = _client(tmp_path, cloud)
    assert await client.rpc("ensure_profile", {"p_name": "Nova"}) == {"name": "Nova", "discriminator": "5120"}
    assert cloud.body() == {"p_name": "Nova"}


@pytest.mark.parametrize("given, body", [(None, {}), ({}, {})])
async def test_rpc_without_arguments_sends_an_empty_object(tmp_path, given, body):
    cloud = FakeCloud({("POST", "/rest/v1/rpc/delete_my_account"): answer(204)})
    client, _ = _client(tmp_path, cloud)
    assert await client.rpc("delete_my_account", given) is None  # a void function answers with nothing
    assert cloud.body() == body


async def test_select_gives_the_rows(tmp_path):
    cloud = FakeCloud({SELECTING: answer(200, [{"name": "Nova"}])})
    client, _ = _client(tmp_path, cloud)
    assert await client.select("profiles", "select=name") == [{"name": "Nova"}]


async def test_exchange_asks_for_a_session_with_the_code_and_the_verifier(tmp_path):
    cloud = FakeCloud({("POST", "/auth/v1/token?grant_type=pkce"): token_answer()})
    client, _ = _client(tmp_path, cloud, session=None)
    answered = await client.exchange("the-code", "the-verifier")
    assert answered["access_token"] == "NEW-ACCESS-0123456789"
    [(method, path, headers, _)] = cloud.requests
    assert (method, path) == ("POST", "/auth/v1/token?grant_type=pkce")
    assert cloud.body() == {"auth_code": "the-code", "code_verifier": "the-verifier"}
    assert headers["apikey"] == CLOUD_KEY and "Authorization" not in headers


async def test_a_refused_exchange_gives_its_code(tmp_path):
    cloud = FakeCloud({("POST", "/auth/v1/token"): answer(403, {"code": 403, "error_code": "flow_state_expired", "msg": "x"})})
    client, _ = _client(tmp_path, cloud, session=None)
    with pytest.raises(CloudRefused) as refused:
        await client.exchange("the-code", "the-verifier")
    assert refused.value.code == "flow_state_expired"


async def test_a_broken_exchange_answer_is_offline(tmp_path):
    cloud = FakeCloud({("POST", "/auth/v1/token"): answer(200, b"<html>")})
    client, _ = _client(tmp_path, cloud, session=None)
    with pytest.raises(CloudOffline):
        await client.exchange("the-code", "the-verifier")


async def test_sign_out_ends_this_devices_session_alone(tmp_path):
    cloud = FakeCloud({("POST", "/auth/v1/logout"): answer(204)})
    client, _ = _client(tmp_path, cloud)
    await client.sign_out()
    [(method, path, headers, _)] = cloud.requests
    assert (method, path) == ("POST", "/auth/v1/logout?scope=local")
    assert headers["Authorization"] == f"Bearer {ACCESS}"


async def test_without_a_session_nothing_is_sent(tmp_path):
    cloud = FakeCloud()
    client, _ = _client(tmp_path, cloud, session=None)
    with pytest.raises(SessionLost):
        await client.select("profiles", "select=name")
    assert cloud.requests == []


# ---------------------------------------------------------------- the refresh

async def test_an_expired_session_refreshes_first_and_keeps_the_new_tokens(tmp_path):
    cloud = FakeCloud({REFRESHING: token_answer(expires_in=1800), SELECTING: answer(200, [])})
    client, store = _client(tmp_path, cloud, EXPIRED)
    await client.select("profiles", "select=name")
    assert cloud.sent() == ["POST /auth/v1/token?grant_type=refresh_token", "GET /rest/v1/profiles?select=name"]
    assert cloud.body(0) == {"refresh_token": REFRESH}
    assert cloud.requests[0][2]["apikey"] == CLOUD_KEY and "Authorization" not in cloud.requests[0][2]
    assert cloud.requests[1][2]["Authorization"] == "Bearer NEW-ACCESS-0123456789"
    expected = CloudSession("NEW-ACCESS-0123456789", "NEW-REFRESH-0123456789", NOW + 1800, USER_ID, "Nova", "5120")
    assert store.load() == expected
    assert CloudStore(tmp_path / "cloud.bin").load() == expected  # on disk, not just in memory


@pytest.mark.parametrize("left, refreshed", [(11, False), (10, True), (9, True)])
async def test_a_session_about_to_end_refreshes_first(tmp_path, left, refreshed):
    cloud = FakeCloud({REFRESHING: token_answer(), SELECTING: answer(200, [])})
    client, _ = _client(tmp_path, cloud, CloudSession(ACCESS, REFRESH, NOW + left, USER_ID, "Nova", "5120"))
    await client.select("profiles", "select=name")
    assert bool(_refreshes(cloud)) is refreshed


async def test_two_calls_at_once_refresh_once(tmp_path):
    cloud = FakeCloud({REFRESHING: token_answer(), SELECTING: answer(200, [])})
    client, _ = _client(tmp_path, cloud, EXPIRED)
    await asyncio.gather(client.select("profiles", "select=name"), client.select("profiles", "select=ar"))
    assert len(_refreshes(cloud)) == 1
    assert len(cloud.requests) == 3


async def test_a_401_refreshes_and_tries_once_more(tmp_path):
    cloud = FakeCloud({REFRESHING: token_answer(), SELECTING: [answer(401, {"message": "JWT expired"}), answer(200, [])]})
    client, store = _client(tmp_path, cloud)
    assert await client.select("profiles", "select=name") == []
    assert cloud.sent() == [
        "GET /rest/v1/profiles?select=name", "POST /auth/v1/token?grant_type=refresh_token",
        "GET /rest/v1/profiles?select=name",
    ]
    assert cloud.requests[0][2]["Authorization"] == f"Bearer {ACCESS}"
    assert cloud.requests[2][2]["Authorization"] == "Bearer NEW-ACCESS-0123456789"
    assert store.load().access_token == "NEW-ACCESS-0123456789"


async def test_two_401s_at_once_refresh_once(tmp_path):
    # The refresh token is spent by the first refresh, so a second one would be refused.
    cloud = FakeCloud({
        REFRESHING: [token_answer(), answer(400, {"error_code": "refresh_token_already_used"})],
        SELECTING: [answer(401), answer(401), answer(200, [])],
    })
    client, _ = _client(tmp_path, cloud)
    await asyncio.gather(client.select("profiles", "select=name"), client.select("profiles", "select=ar"))
    assert len(_refreshes(cloud)) == 1


async def test_a_second_401_is_session_lost(tmp_path):
    cloud = FakeCloud({REFRESHING: token_answer(), SELECTING: answer(401)})
    client, store = _client(tmp_path, cloud)
    with pytest.raises(SessionLost):
        await client.select("profiles", "select=name")
    assert len(cloud.requests) == 3
    assert store.load() is not None


async def test_a_refused_refresh_is_session_lost(tmp_path):
    cloud = FakeCloud({REFRESHING: answer(400, {"error_code": "refresh_token_not_found"})})
    client, store = _client(tmp_path, cloud, EXPIRED)
    with pytest.raises(SessionLost):
        await client.select("profiles", "select=name")
    assert cloud.sent() == ["POST /auth/v1/token?grant_type=refresh_token"]
    assert store.load() == EXPIRED
    assert (tmp_path / "cloud.bin").exists()


@pytest.mark.parametrize("outcome", [
    answer(429, {"error_code": "over_request_rate_limit"}), answer(503), answer(540), urllib.error.URLError("no route"),
    answer(200, b"<html>"), answer(200, {"access_token": "only-this"}), answer(200, [1]),
])
async def test_a_refresh_that_got_no_real_answer_is_offline_and_keeps_the_session(tmp_path, outcome):
    # Only a refusal of the refresh token means signing in again.
    cloud = FakeCloud({REFRESHING: outcome})
    client, store = _client(tmp_path, cloud, EXPIRED)
    with pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")
    assert store.load() == EXPIRED


async def test_signing_out_during_a_refresh_does_not_bring_the_session_back(tmp_path):
    store_holder = {}

    class SignedOutMeanwhile(FakeCloud):
        def __call__(self, path, **kwargs):
            store_holder["store"].delete()
            return super().__call__(path, **kwargs)

    cloud = SignedOutMeanwhile({REFRESHING: token_answer()})
    client, store = _client(tmp_path, cloud, EXPIRED)
    store_holder["store"] = store
    with pytest.raises(SessionLost):
        await client.select("profiles", "select=name")
    assert store.load() is None
    assert not (tmp_path / "cloud.bin").exists()


async def test_a_refresh_whose_file_cannot_be_written_keeps_the_new_session(tmp_path, monkeypatch):
    # The server has rotated the refresh token, which works once: a file another program holds (an antivirus) must not lose
    # the new one, or the next refresh sends the spent token and the player has to sign in again (the audit's CLD-7).
    cloud = FakeCloud({REFRESHING: token_answer(), SELECTING: answer(200, [])})
    client, store = _client(tmp_path, cloud, EXPIRED)

    def refuse(*args):
        raise PermissionError("another program holds the file")

    monkeypatch.setattr("guildboard.cloud.session.os.replace", refuse)
    assert await client.select("profiles", "select=name") == []  # the request goes on, with the new session
    assert cloud.requests[-1][2]["Authorization"] == "Bearer NEW-ACCESS-0123456789"
    assert store.load().refresh_token == "NEW-REFRESH-0123456789"
    assert not (tmp_path / "cloud.bin.tmp").exists()  # and no second copy of it is left
    monkeypatch.undo()
    store.save(replace(store.load(), name="Nova Vale"))  # the next save writes the newest to the file
    assert CloudStore(tmp_path / "cloud.bin").load().refresh_token == "NEW-REFRESH-0123456789"


async def test_a_name_kept_during_a_refresh_keeps_the_new_tokens_too(tmp_path):
    # The server spent the old refresh token when it answered, so dropping its answer would end the session.
    store_holder = {}

    class RenamedMeanwhile(FakeCloud):
        def __call__(self, path, **kwargs):
            if "grant_type=refresh_token" in path:
                store = store_holder["store"]
                store.save(replace(store.load(), name="Nova Vale"))
            return super().__call__(path, **kwargs)

    cloud = RenamedMeanwhile({REFRESHING: token_answer(), SELECTING: answer(200, [])})
    client, store = _client(tmp_path, cloud, EXPIRED)
    store_holder["store"] = store
    await client.select("profiles", "select=name")
    kept = store.load()
    assert (kept.name, kept.access_token, kept.refresh_token) == (
        "Nova Vale", "NEW-ACCESS-0123456789", "NEW-REFRESH-0123456789",
    )


def test_the_tokens_end_by_this_pcs_clock():
    assert tokens_from(token_answer("a", "b", expires_in=60)[1], NOW) == {
        "access_token": "a", "refresh_token": "b", "expires_at": NOW + 60,
    }


@pytest.mark.parametrize("broken", [
    None, [], {}, {"access_token": "a", "refresh_token": "b"}, {"access_token": "", "refresh_token": "b", "expires_in": 1},
    {"access_token": 1, "refresh_token": "b", "expires_in": 1}, {"access_token": "a", "refresh_token": None, "expires_in": 1},
    {"access_token": "a", "refresh_token": "b", "expires_in": "soon"},
])
def test_a_broken_token_answer_is_offline(broken):
    with pytest.raises(CloudOffline):
        tokens_from(broken, NOW)


# ---------------------------------------------------------------- the server's clock

async def test_the_servers_clock_is_learned_from_its_answers(tmp_path):
    # Each answer's Date says the server's time in whole seconds, and the outbox's stamps are this PC's own clock, which the
    # difference is measured against (the audit's CLD-2). Each answer with a date measures it again.
    ahead = {"seconds": 125.0}
    cloud = FakeCloud({SELECTING: answer(200, [])}, server_clock=lambda: time.time() + ahead["seconds"])
    client, _ = _client(tmp_path, cloud)
    assert client.server_ahead() == 0.0  # nothing is known before an answer
    await client.select("profiles", "select=name")
    assert abs(client.server_ahead() - 125.0) <= 1.0
    ahead["seconds"] = -3600.0
    await client.select("profiles", "select=name")
    assert abs(client.server_ahead() + 3600.0) <= 1.0
    ahead["seconds"] = 0.0
    await client.select("profiles", "select=name")
    assert client.server_ahead() == 0.0  # within what a whole second can tell: the clocks agree


async def test_a_request_that_took_long_does_not_measure_the_servers_clock(tmp_path):
    # A PC that slept in the middle of a request would measure half the sleep as the server's offset (the review of WP-4,
    # minor 1): an answer that came more than ten seconds after the request left says nothing about the clocks.
    wall = {"now": 1_000_000.0}
    server = {"now": 1_000_000.0 + 125}
    cloud = FakeCloud({SELECTING: answer(200, [])}, server_clock=lambda: server["now"])
    store = CloudStore(tmp_path / "cloud.bin")
    store.save(SESSION)
    client = CloudClient(store, fetch=cloud, now=lambda: NOW, wall=lambda: wall["now"])
    await client.select("profiles", "select=name")
    assert abs(client.server_ahead() - 125.0) <= 1.0
    ticks = iter([1_000_000.0, 1_000_000.0 + 3600])  # the PC's clock when the request left, and when the answer came
    client._wall = lambda: next(ticks)
    server["now"] = 1_000_000.0
    await client.select("profiles", "select=name")
    assert abs(client.server_ahead() - 125.0) <= 1.0  # what the last quick answer said

async def test_an_answer_with_no_date_keeps_what_the_last_one_said(tmp_path):
    cloud = FakeCloud({SELECTING: answer(200, [])}, server_clock=lambda: time.time() - 90)
    client, _ = _client(tmp_path, cloud)
    await client.select("profiles", "select=name")
    cloud.server_clock = None
    await client.select("profiles", "select=name")
    assert abs(client.server_ahead() + 90.0) <= 1.0
    # A refusal and a server error tell the time too: the server answered.
    cloud.server_clock = lambda: time.time() + 300
    cloud.answers[SELECTING] = answer(503)
    with pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")
    assert abs(client.server_ahead() - 300.0) <= 1.0


# ---------------------------------------------------------------- failures

@pytest.mark.parametrize("status", [500, 502, 503, 540])
async def test_a_paused_project_is_offline(tmp_path, status):
    cloud = FakeCloud({SELECTING: answer(status, b"<html>The project is paused</html>")})
    client, _ = _client(tmp_path, cloud)
    with pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")


@pytest.mark.parametrize("error", [
    urllib.error.URLError("no route"), TimeoutError("timed out"), ConnectionError("the answer was cut short"),
    ConnectionResetError(), ResponseTooLarge("larger than allowed"), RedirectRefused("evil.example"),
])
async def test_no_answer_is_offline(tmp_path, error):
    client, _ = _client(tmp_path, FakeCloud({SELECTING: error}))
    with pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")


async def test_an_answer_that_is_no_json_is_offline(tmp_path):
    client, _ = _client(tmp_path, FakeCloud({SELECTING: answer(200, b"<html>"), ("POST", "/rest/v1/rpc/x"): answer(200, b"<")}))
    with pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")
    with pytest.raises(CloudOffline):
        await client.rpc("x")


async def test_select_that_gets_no_list_is_offline(tmp_path):
    client, _ = _client(tmp_path, FakeCloud({SELECTING: answer(200, {"not": "a list"})}))
    with pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")


@pytest.mark.parametrize("status, body, code", [
    (400, {"code": "P0001", "details": None, "hint": None, "message": "request_limit"}, "request_limit"),
    (403, {"code": "42501", "message": "permission denied for table invites"}, "permission denied for table invites"),
    (409, {"code": "23505", "message": 'duplicate key value violates unique constraint "profiles_uid_findable"'},
     'duplicate key value violates unique constraint "profiles_uid_findable"'),
    (400, {"code": 400, "error_code": "bad_jwt", "msg": "a sentence"}, "bad_jwt"),
    (400, {"code": 400, "msg": "a sentence"}, "a sentence"),
    (400, {"error": "invalid_grant", "error_description": "a sentence"}, "invalid_grant"),
    (404, b"Not found", "refused"),
    (400, [1], "refused"),
    (400, {"message": 7}, "refused"),
])
async def test_a_4xx_gives_its_code(tmp_path, status, body, code):
    cloud = FakeCloud({("POST", "/rest/v1/rpc/x"): answer(status, body)})
    client, _ = _client(tmp_path, cloud)
    with pytest.raises(CloudRefused) as refused:
        await client.rpc("x")
    assert refused.value.code == code
    assert len(cloud.requests) == 1  # a refusal is not tried again


async def test_a_refusal_carries_its_details(tmp_path):
    # sync_full has two causes, which only PostgREST's details tell apart (0004): the account's share, or the whole project.
    refusal = {"code": "P0001", "message": "sync_full", "details": "project_full", "hint": None}
    cloud = FakeCloud({("POST", "/rest/v1/rpc/sync_push"): answer(400, refusal)})
    client, _ = _client(tmp_path, cloud)
    with pytest.raises(CloudRefused) as refused:
        await client.rpc("sync_push", {"p_rows": []})
    assert (refused.value.code, refused.value.state, refused.value.detail) == ("sync_full", "P0001", "project_full")
    cloud.answers[("POST", "/rest/v1/rpc/sync_push")] = answer(400, {"code": "P0001", "message": "sync_full", "details": None})
    with pytest.raises(CloudRefused) as refused:
        await client.rpc("sync_push", {"p_rows": []})
    assert refused.value.detail == ""


@pytest.mark.parametrize("outcome, raised", [
    (answer(500, b"BODY-MARKER"), CloudOffline),
    (answer(400, {"message": "BODY-MARKER"}), CloudRefused),
    (urllib.error.URLError("https://example.invalid/BODY-MARKER"), CloudOffline),
])
async def test_a_failure_logs_no_body(tmp_path, caplog, outcome, raised):
    client, _ = _client(tmp_path, FakeCloud({SELECTING: outcome}))
    with caplog.at_level(logging.DEBUG, logger="guildboard"), pytest.raises(raised):
        await client.select("profiles", "select=name")
    assert "BODY-MARKER" not in caplog.text


async def test_an_answer_with_nan_reads_it_as_nothing_and_one_nested_too_deep_is_offline(tmp_path):
    # NaN and the infinities are no JSON a page can be sent, and a nesting deep enough refuses the reader itself (the audit's
    # CLD-10): neither may escape as anything but an answer that makes no sense.
    rpc = ("POST", "/rest/v1/rpc/friends_overview")
    client, _ = _client(tmp_path, FakeCloud({rpc: answer(200, b'{"a": NaN, "b": [Infinity, -Infinity], "c": 1}')}))
    assert await client.rpc("friends_overview") == {"a": None, "b": [None, None], "c": 1}
    deep = b"[" * 100_000 + b"]" * 100_000
    client, _ = _client(tmp_path, FakeCloud({rpc: answer(200, deep)}))
    with pytest.raises(CloudOffline):
        await client.rpc("friends_overview")
    client, _ = _client(tmp_path, FakeCloud({rpc: answer(400, deep)}))
    with pytest.raises(CloudRefused) as refused:
        await client.rpc("friends_overview")
    assert (refused.value.code, refused.value.state) == ("refused", "")


async def test_a_failure_says_what_failed_in_the_log(tmp_path, caplog):
    client, _ = _client(tmp_path, FakeCloud({SELECTING: urllib.error.URLError("no route")}))
    with caplog.at_level(logging.WARNING, logger="guildboard"), pytest.raises(CloudOffline):
        await client.select("profiles", "select=name")
    assert "URLError" in caplog.text


async def test_offline_hides_the_failures_own_text(tmp_path):
    client, _ = _client(tmp_path, FakeCloud({SELECTING: urllib.error.URLError("https://example.invalid/MARKER")}))
    with pytest.raises(CloudOffline) as offline:
        await client.select("profiles", "select=name")
    assert "MARKER" not in str(offline.value) and offline.value.__cause__ is None and offline.value.__suppress_context__


@pytest.mark.parametrize("number", [
    pytest.param("1" + "0" * 5000, id="an integer Python refuses to read"),
    pytest.param("1" + "0" * 400 + ".5", id="a fraction that reads as infinity"),
    pytest.param("1e400", id="a short one that reads as infinity"),
])
async def test_a_number_nothing_could_hold_is_no_number_and_the_answer_stands(tmp_path, number):
    # A stat is another player's to fill, and the table takes any number. One of them must not cost the rest of the answer.
    body = f'{{"now": {number}, "name": "Riley", "kept": [16040, -3, 18.5, 712345312]}}'.encode()
    client, _ = _client(tmp_path, FakeCloud({("POST", "/rest/v1/rpc/friends_overview"): answer(200, body)}))
    assert await client.rpc("friends_overview") == {"now": None, "name": "Riley", "kept": [16040, -3, 18.5, 712345312]}
