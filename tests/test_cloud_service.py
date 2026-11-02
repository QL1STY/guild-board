"""`Online` on its own: its view, what it does at a start, and when the pages hear of a change."""
import asyncio
import threading
import urllib.error

import pytest

from cloud_fakes import USER_ID, FakeCloud, answer, token_answer
from guildboard.cloud.demo import DemoOnline
from guildboard.cloud.models import OnlineRefused
from guildboard.cloud.service import Online
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.events import EventBus

PROFILE = ("GET", "/rest/v1/profiles")
EXCHANGE = ("POST", "/auth/v1/token?grant_type=pkce")
ENSURE = ("POST", "/rest/v1/rpc/ensure_profile")
REFRESH = ("POST", "/auth/v1/token?grant_type=refresh_token")


def _online(tmp_path, clock, cloud: FakeCloud, opened: list[str] | None = None) -> Online:
    return Online(
        CloudStore(tmp_path / "cloud.bin"), EventBus(), clock, fetch=cloud,
        open_browser=(opened if opened is not None else []).append,
    )


def _session(clock, *, left: float = 3600) -> CloudSession:
    return CloudSession("ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + left, USER_ID, "Nova", "5120")


def _saved(tmp_path, clock, **kwargs) -> CloudSession:
    session = _session(clock, **kwargs)
    CloudStore(tmp_path / "cloud.bin").save(session)
    return session


def _events(queue) -> list[str]:
    heard = []
    while not queue.empty():
        heard.append(queue.get_nowait()["type"])
    return heard


async def test_a_start_signed_out_sends_nothing(tmp_path, clock):
    cloud = FakeCloud()
    await _online(tmp_path, clock, cloud).look()
    assert cloud.requests == []


async def test_a_start_signed_in_looks_at_the_profile(tmp_path, clock):
    _saved(tmp_path, clock)
    cloud = FakeCloud({PROFILE: answer(200, [{"name": "Nova", "discriminator": "5120"}])})
    online = _online(tmp_path, clock, cloud)
    await online.look()
    assert cloud.sent() == [
        f"GET /rest/v1/profiles?select=name,discriminator,picture_url,ar,uid,find_by_uid,pins,sharing&user_id=eq.{USER_ID}"
    ]
    assert online.view()["state"] == "signed_in" and online.view()["offline"] is False


async def test_a_new_name_from_another_device_is_kept(tmp_path, clock):
    session = _saved(tmp_path, clock)
    online = _online(tmp_path, clock, FakeCloud({PROFILE: answer(200, [{"name": "Nova Vale", "discriminator": "0007"}])}))
    await online.look()
    assert (online.view()["name"], online.view()["tag"]) == ("Nova Vale", "0007")
    kept = CloudStore(tmp_path / "cloud.bin").load()
    assert (kept.name, kept.tag, kept.access_token) == ("Nova Vale", "0007", session.access_token)


async def test_a_start_with_the_server_away_stays_signed_in_and_says_offline(tmp_path, clock):
    _saved(tmp_path, clock)
    online = _online(tmp_path, clock, FakeCloud({PROFILE: answer(540, b"paused")}))
    await online.look()
    view = online.view()
    assert (view["state"], view["offline"], view["name"]) == ("signed_in", True, "Nova")


async def test_a_start_with_the_refresh_refused_says_sign_in_again(tmp_path, clock):
    _saved(tmp_path, clock, left=-1)
    online = _online(tmp_path, clock, FakeCloud({REFRESH: answer(400, {"error_code": "refresh_token_not_found"})}))
    await online.look()
    assert online.view()["state"] == "sign_in_again"


async def test_a_profile_that_is_gone_says_sign_in_again(tmp_path, clock):
    # Delete my online data, on another device: the session lives on here for a while, and nothing behind it.
    _saved(tmp_path, clock)
    online = _online(tmp_path, clock, FakeCloud({PROFILE: answer(200, [])}))
    await online.look()
    assert online.view()["state"] == "sign_in_again"


async def test_a_refused_look_changes_nothing(tmp_path, clock):
    _saved(tmp_path, clock)
    online = _online(tmp_path, clock, FakeCloud({PROFILE: answer(404, {"message": "no such table"})}))
    await online.look()
    view = online.view()
    assert (view["state"], view["offline"], view["message"]) == ("signed_in", False, None)


@pytest.mark.parametrize("rows", [[{"name": 7, "discriminator": "5120"}], [{"name": "Nova"}], ["text"]])
async def test_a_broken_row_changes_nothing(tmp_path, clock, rows):
    _saved(tmp_path, clock)
    online = _online(tmp_path, clock, FakeCloud({PROFILE: answer(200, rows)}))
    await online.look()
    assert (online.view()["name"], online.view()["tag"]) == ("Nova", "5120")


def test_the_waiting_state_ends_by_itself(tmp_path, clock):
    online = _online(tmp_path, clock, FakeCloud())
    online.begin_sign_in(4321)
    assert online.view()["state"] == "waiting"
    clock.advance(minutes=10, seconds=1)
    assert online.view()["state"] == "signed_out"


def test_a_second_press_opens_a_new_sign_in(tmp_path, clock):
    opened: list[str] = []
    online = _online(tmp_path, clock, FakeCloud(), opened)
    online.begin_sign_in(4321)
    online.begin_sign_in(4321)
    assert len(opened) == 2 and opened[0] != opened[1]
    assert online.view()["state"] == "waiting"


def test_a_press_clears_the_last_message(tmp_path, clock):
    online = _online(tmp_path, clock, FakeCloud())
    online._open_browser = lambda address: False
    online.begin_sign_in(4321)
    assert online.view()["message"] is not None
    online._open_browser = lambda address: True
    online.begin_sign_in(4321)
    assert (online.view()["state"], online.view()["message"]) == ("waiting", None)


def test_a_browser_that_raises_says_so_and_nothing_waits(tmp_path, clock):
    online = _online(tmp_path, clock, FakeCloud())

    def refuse(address):
        raise OSError("no browser")

    online._open_browser = refuse
    online.begin_sign_in(4321)
    view = online.view()
    assert (view["state"], view["message"]) == ("signed_out", "The browser could not be opened. Try again.")


async def test_a_sign_in_shows_as_waiting_until_it_has_its_name(tmp_path, clock):
    # While the exchange's session is kept and the profile is asked for, a page reads no half-made account.
    seen: list[str] = []

    class Watching(FakeCloud):
        def __call__(self, path, **kwargs):
            seen.append(online.view()["state"])
            return super().__call__(path, **kwargs)

    cloud = Watching({
        EXCHANGE: token_answer(), ENSURE: answer(200, {"name": "Nova", "discriminator": "5120"}),
    })
    opened: list[str] = []
    online = _online(tmp_path, clock, cloud, opened)
    online.begin_sign_in(4321)
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    assert await online.finish_sign_in(nonce, "THE-CODE-0123456789") is True
    assert seen == ["waiting", "waiting"]
    assert online.view()["state"] == "signed_in"


def _nonce(opened: list[str], index: int = -1) -> str:
    return opened[index].rsplit("%2F", 1)[-1].split("&", 1)[0]


async def _until(condition, tries: int = 500) -> None:
    for _ in range(tries):
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("it did not happen")


async def test_a_loss_from_before_a_new_sign_in_does_not_end_it(tmp_path, clock):
    # The server refused the old session, and a request of it was still on its way, waiting for its own refresh, when the
    # player signed in again: that refusal is the old session's, and says nothing of the new one (the audit's CLD-8).
    CloudStore(tmp_path / "cloud.bin").save(
        CloudSession("OLD-ACCESS-0123456789", "OLD-REFRESH-0123456789", clock.now().timestamp() - 1, USER_ID, "Nova", "5120")
    )
    held, release, refreshes = threading.Event(), threading.Event(), []

    class Slow(FakeCloud):
        def __call__(self, path, **kwargs):
            if "grant_type=refresh_token" in path:
                refreshes.append(path)
                if len(refreshes) == 2:  # the second waits until the new sign-in is done
                    held.set()
                    release.wait(5)
            return super().__call__(path, **kwargs)

    cloud = Slow({
        REFRESH: answer(400, {"error": "invalid_grant"}), EXCHANGE: token_answer(),
        ENSURE: answer(200, {"name": "Nova", "discriminator": "5120"}), ("POST", "/rest/v1/rpc/make_invite"): answer(200, "CODE"),
    })
    opened: list[str] = []
    online = _online(tmp_path, clock, cloud, opened)
    await online.look()
    assert online.view()["state"] == "sign_in_again"
    late = asyncio.ensure_future(online.invite_link())  # still on the old session
    await _until(held.is_set)
    online.begin_sign_in(4321)
    assert await online.finish_sign_in(_nonce(opened), "THE-CODE-0123456789") is True
    release.set()
    with pytest.raises(OnlineRefused):
        await late
    assert online.view()["state"] == "signed_in"


async def test_a_profile_asks_nothing_while_the_session_is_lost(tmp_path, clock):
    _saved(tmp_path, clock)
    cloud = FakeCloud({PROFILE: answer(200, [])})  # no row: the account was deleted on another device
    online = _online(tmp_path, clock, cloud)
    await online.look()
    assert online.view()["state"] == "sign_in_again"
    sent = len(cloud.requests)
    with pytest.raises(OnlineRefused) as refused:
        await online.your_profile()
    assert refused.value.sentence == "Sign in again first." and len(cloud.requests) == sent


async def test_a_second_press_during_the_exchange_does_not_leave_it_waiting(tmp_path, clock):
    # The player pressed Sign in again while the first sign-in was being finished: once one has finished, nothing waits.
    held, release = threading.Event(), threading.Event()

    class Slow(FakeCloud):
        def __call__(self, path, **kwargs):
            if "grant_type=pkce" in path:
                held.set()
                release.wait(5)
            return super().__call__(path, **kwargs)

    cloud = Slow({EXCHANGE: token_answer(), ENSURE: answer(200, {"name": "Nova", "discriminator": "5120"})})
    opened: list[str] = []
    online = _online(tmp_path, clock, cloud, opened)
    online.begin_sign_in(4321)
    finishing = asyncio.ensure_future(online.finish_sign_in(_nonce(opened), "THE-CODE-0123456789"))
    await _until(held.is_set)
    online.begin_sign_in(4321)  # the second press
    assert len(opened) == 2
    release.set()
    assert await finishing is True
    assert online.view()["state"] == "signed_in"


async def test_a_session_gone_while_its_profile_was_asked_for_finishes_nothing(tmp_path, clock):
    store = CloudStore(tmp_path / "cloud.bin")

    class SignedOutMeanwhile(FakeCloud):
        def __call__(self, path, **kwargs):
            if "ensure_profile" in path:
                store.delete()
            return super().__call__(path, **kwargs)

    cloud = SignedOutMeanwhile({EXCHANGE: token_answer(), ENSURE: answer(200, {"name": "Nova", "discriminator": "5120"})})
    opened: list[str] = []
    online = Online(store, EventBus(), clock, fetch=cloud, open_browser=opened.append)
    online.begin_sign_in(4321)
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    assert await online.finish_sign_in(nonce, "THE-CODE-0123456789") is False
    assert online.view()["state"] == "signed_out"
    assert not (tmp_path / "cloud.bin").exists()


@pytest.mark.parametrize("row", [None, [], {"name": "Nova"}, {"name": 1, "discriminator": "5120"}, "text"])
async def test_a_broken_profile_answer_finishes_nothing(tmp_path, clock, row):
    cloud = FakeCloud({EXCHANGE: token_answer(), ENSURE: answer(200, row)})
    opened: list[str] = []
    online = _online(tmp_path, clock, cloud, opened)
    online.begin_sign_in(4321)
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    assert await online.finish_sign_in(nonce, "THE-CODE-0123456789") is False
    assert online.view()["state"] == "signed_out"
    assert not (tmp_path / "cloud.bin").exists()


async def test_the_pages_hear_of_a_change_and_only_of_a_change(tmp_path, clock):
    _saved(tmp_path, clock)
    cloud = FakeCloud({PROFILE: [
        answer(200, [{"name": "Nova", "discriminator": "5120"}]), answer(200, [{"name": "Nova", "discriminator": "5120"}]),
        answer(503),
    ]})
    bus = EventBus()
    heard = bus.subscribe()
    online = Online(CloudStore(tmp_path / "cloud.bin"), bus, clock, fetch=cloud, open_browser=lambda address: None)
    await online.look()
    await online.look()
    assert _events(heard) == []  # nothing changed
    await online.look()
    assert _events(heard) == ["online_changed"]  # offline now
    await online.look()
    assert _events(heard) == []  # still offline


async def test_a_sign_in_and_a_sign_out_are_heard(tmp_path, clock):
    cloud = FakeCloud({
        EXCHANGE: token_answer(), ENSURE: answer(200, {"name": "Nova", "discriminator": "5120"}),
        ("POST", "/auth/v1/logout"): answer(204),
    })
    bus = EventBus()
    heard = bus.subscribe()
    opened: list[str] = []
    online = Online(CloudStore(tmp_path / "cloud.bin"), bus, clock, fetch=cloud, open_browser=opened.append)
    online.begin_sign_in(4321)
    assert _events(heard) == ["online_changed"]
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    await online.finish_sign_in(nonce, "THE-CODE-0123456789")
    assert "online_changed" in _events(heard)
    await online.sign_out()
    assert _events(heard) == ["online_changed"]


async def test_a_look_comes_back_online(tmp_path, clock):
    _saved(tmp_path, clock)
    cloud = FakeCloud({PROFILE: [urllib.error.URLError("no route"), answer(200, [{"name": "Nova", "discriminator": "5120"}])]})
    online = _online(tmp_path, clock, cloud)
    await online.look()
    assert online.view()["offline"] is True
    await online.look()
    assert online.view()["offline"] is False


async def test_stop_ends_a_waiting_sign_in(tmp_path, clock):
    opened: list[str] = []
    online = _online(tmp_path, clock, FakeCloud(), opened)
    online.begin_sign_in(4321)
    await online.stop()
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    assert await online.finish_sign_in(nonce, "THE-CODE-0123456789") is False
    assert online.view()["state"] == "signed_out"


async def test_stop_writes_a_session_that_could_not_be_written_before(tmp_path, clock, monkeypatch):
    # A refresh rotates the token, and a write that failed leaves the spent one in the file until the next refresh. Quitting
    # before that would have the next start say Sign in again, so stop tries the write once more.
    path = tmp_path / "cloud.bin"
    store = CloudStore(path)
    with monkeypatch.context() as broken:
        broken.setattr("guildboard.cloud.session.os.replace", lambda *args: (_ for _ in ()).throw(OSError("held")))
        with pytest.raises(OSError):
            store.save(_session(clock))
    assert not path.exists()
    online = Online(store, EventBus(), clock, fetch=FakeCloud(), open_browser=[].append)
    await online.stop()
    assert CloudStore(path).load() == _session(clock)


FRIEND = "00000000-0000-0000-0000-00000000000b"
OVERVIEW = ("POST", "/rest/v1/rpc/friends_overview")
COMPARE = ("POST", "/rest/v1/rpc/compare_keys")


async def test_compare_reuses_keys_within_fresh_seconds(tmp_path, clock):
    # Compare reads again at each event of the core, and each read asked the project what the two share (the audit's WEB-6):
    # an answer this new is used again, as the friends list is, and only a friend's own.
    _saved(tmp_path, clock)
    riley = {"user_id": FRIEND, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None, "presence": None,
             "stats": {"wishes": {"pity": 1}}, "pins": [], "compare": True}
    cloud = FakeCloud({
        PROFILE: answer(200, [{"name": "Nova", "discriminator": "5120", "sharing": ["wishes"]}]),
        OVERVIEW: answer(200, {"friends": [riley], "incoming": [], "outgoing": []}), COMPARE: answer(200, ["wishes"]),
        ("POST", "/rest/v1/rpc/set_sharing"): answer(204),
    })
    online = _online(tmp_path, clock, cloud)
    for _ in range(5):
        assert (await online.compare_model(FRIEND))["keys"] == ["wishes"]
        clock.advance(seconds=10)
    assert len([line for line in cloud.sent() if "compare_keys" in line]) == 1
    clock.advance(seconds=10)  # 60 seconds after the first: it is asked again
    await online.compare_model(FRIEND)
    assert len([line for line in cloud.sent() if "compare_keys" in line]) == 2
    await online.set_sharing([])  # what the player shares changed: what was said of it is not used again
    cloud.answers[COMPARE] = answer(200, [])
    assert (await online.compare_model(FRIEND))["keys"] == []
    assert len([line for line in cloud.sent() if "compare_keys" in line]) == 3


def test_the_tokens_are_masked_from_the_moment_it_is_built(tmp_path, clock):
    from guildboard import logging_setup

    _saved(tmp_path, clock)
    logging_setup.forget_secrets()  # a new start
    try:
        _online(tmp_path, clock, FakeCloud())
        assert logging_setup.redact("ACCESS-0123456789 REFRESH-0123456789") == "[redacted] [redacted]"
    finally:
        logging_setup.forget_secrets()


async def test_the_demos_account_goes_through_its_states(clock):
    bus = EventBus()
    heard = bus.subscribe()
    online = DemoOnline(bus, clock)
    view = online.view()
    assert view["state"] == "signed_in" and view["offline"] is False and view["message"] is None
    assert view["invite"] is None and view["sync"] is None
    await online.run()
    assert _events(heard) == []
    await online.sign_out()
    assert (online.view()["state"], online.view()["name"], online.view()["tag"]) == ("signed_out", None, None)
    assert _events(heard) == ["online_changed"]
    online.begin_sign_in(4321)
    assert online.view()["state"] == "signed_in"
    assert _events(heard) == ["online_changed"]
    await online.delete_account()
    assert online.view()["state"] == "signed_out"
    assert await online.finish_sign_in("any", "any") is False
    await online.stop()
