"""The core's task: presence each minute, the stats and the friends every five, and quiet after a failure (the online plan,
Task B3; Review Focus 1)."""
import asyncio
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from cloud_fakes import USER_ID, FakeCloud, answer, token_answer
from guildboard.cloud.models import friend_from, pills_of, status_of
from guildboard.cloud.service import Local, Online
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.events import EventBus
from guildboard.gameday import game_day
from guildboard.store import iso
from support import FakeSleep

PROFILE = ("GET", "/rest/v1/profiles")
PROFILE_UPDATE = ("PATCH", "/rest/v1/profiles")
SET_UID = ("POST", "/rest/v1/rpc/set_uid")
HEARTBEAT = ("POST", "/rest/v1/rpc/heartbeat")
OVERVIEW = ("POST", "/rest/v1/rpc/friends_overview")
UPLOAD = ("POST", "/rest/v1/shared_stats")
LOGOUT = ("POST", "/auth/v1/logout")
EXCHANGE = ("POST", "/auth/v1/token?grant_type=pkce")
ENSURE = ("POST", "/rest/v1/rpc/ensure_profile")
NOBODY = {"friends": [], "incoming": [], "outgoing": []}
TODAY = date(2026, 10, 13)  # the game day of the clock fixture


class Enough(Exception):
    """Ends a loop that would run for as long as Guild Board does."""


class Sleeps(FakeSleep):
    """A sleep that moves the clock, and ends the loop after so many."""

    def __init__(self, clock, count: int) -> None:
        super().__init__(clock)
        self.left = count

    async def __call__(self, seconds: float) -> None:
        if self.left <= 0:
            raise Enough
        self.left -= 1
        await super().__call__(seconds)


def own_row(**changes) -> dict:
    return {
        "name": "Nova", "discriminator": "5120", "picture_url": None, "ar": None, "uid": None, "find_by_uid": False,
        "pins": [], "sharing": [], **changes,
    }


def scripted(*sharing: str, **more) -> FakeCloud:
    return FakeCloud({
        PROFILE: answer(200, [own_row(sharing=list(sharing))]), HEARTBEAT: answer(204), OVERVIEW: answer(200, NOBODY),
        UPLOAD: answer(201), PROFILE_UPDATE: answer(204), SET_UID: answer(204), **more,
    })


def _online(tmp_path, clock, cloud, *, sleep=None, signed_in: bool = True, opened=None, **local) -> Online:
    store = CloudStore(tmp_path / "cloud.bin")
    if signed_in:
        store.save(CloudSession(
            "ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 365 * 86_400, USER_ID, "Nova", "5120",
        ))
    return Online(
        store, EventBus(), clock, fetch=cloud, open_browser=(opened if opened is not None else []).append,
        sleep=sleep or FakeSleep(clock), local=Local(**local),
    )


async def _run(online: Online) -> None:
    with pytest.raises(Enough):
        await online.run()


def _count(cloud: FakeCloud, what: str) -> int:
    return sum(what in line for line in cloud.sent())


def _facts() -> dict:
    return {"uid": 700000001, "ar": 58, "picture_url": None}


def _beats(cloud: FakeCloud) -> list[dict]:
    return [json.loads(body) for method, path, _, body in cloud.requests if "heartbeat" in path]


class Game:
    """The game as `Local.game` reads it: running or not, and since when."""

    def __init__(self, started: datetime | None) -> None:
        self.started = started

    def __call__(self) -> tuple[bool, datetime | None]:
        return (self.started is not None, self.started)


async def test_no_heartbeat_while_the_game_is_closed(tmp_path, clock):
    # Nothing a friend can see may say when the PC is on or Guild Board is open: no game, no heartbeat, and never "open".
    cloud = scripted("status")
    online = _online(tmp_path, clock, cloud, game=Game(None))
    for _ in range(3):
        await online.turn()
        clock.advance(minutes=1)
    assert _beats(cloud) == []
    assert all(b"open" not in (body or b"") for method, path, _, body in cloud.requests)  # and no body says "open" either


async def test_heartbeat_in_game_and_one_end_beat(tmp_path, clock):
    cloud = scripted("status")
    started = clock.now() - timedelta(minutes=42)
    game = Game(started)
    online = _online(tmp_path, clock, cloud, game=game)
    for _ in range(2):
        await online.turn()
        clock.advance(minutes=1)
    game.started = None  # the game stops
    for _ in range(2):
        await online.turn()
        clock.advance(minutes=1)
    assert _beats(cloud) == [{"p_state": "in_game", "p_since": iso(started)}] * 3  # two while it ran, the end beat
    await online.turn()
    assert len(_beats(cloud)) == 3  # and nothing after it until the game runs again
    game.started = clock.now()
    await online.turn()
    assert _beats(cloud)[-1] == {"p_state": "in_game", "p_since": iso(game.started)} and len(_beats(cloud)) == 4


async def test_start_mid_game_beats_in_game_with_the_games_start(tmp_path, clock):
    cloud = scripted("status")
    started = clock.now() - timedelta(hours=3)
    online = _online(tmp_path, clock, cloud, game=Game(started))
    await online.turn()
    assert _beats(cloud) == [{"p_state": "in_game", "p_since": iso(started)}]


async def test_failed_end_beat_is_not_retried(tmp_path, clock):
    cloud = scripted("status")
    started = clock.now() - timedelta(minutes=5)
    game = Game(started)
    online = _online(tmp_path, clock, cloud, game=game)
    await online.turn()
    game.started = None
    clock.advance(minutes=1)
    cloud.answers[HEARTBEAT] = answer(503)
    await online.turn()  # the end beat, refused: the core is quiet for five minutes
    assert len(_beats(cloud)) == 2
    cloud.answers[HEARTBEAT] = answer(204)
    for _ in range(8):  # well past the quiet window, which would let a retry go
        clock.advance(minutes=1)
        await online.turn()
    assert len(_beats(cloud)) == 2  # the one while it ran, and the end beat once


async def test_a_late_end_beat_is_dropped(tmp_path, clock):
    # The game stops, the PC sleeps: the first turn that reaches the beat, ten minutes on, says nothing of the game.
    cloud = scripted("status")
    game = Game(clock.now() - timedelta(minutes=5))
    online = _online(tmp_path, clock, cloud, game=game)
    await online.turn()
    game.started = None
    clock.advance(minutes=10)
    await online.turn()
    clock.advance(minutes=1)
    await online.turn()
    assert len(_beats(cloud)) == 1  # only the one while it ran


async def test_no_end_beat_after_a_quiet_window(tmp_path, clock):
    cloud = scripted("status")
    game = Game(clock.now() - timedelta(minutes=5))
    online = _online(tmp_path, clock, cloud, game=game)
    await online.turn()
    assert len(_beats(cloud)) == 1
    game.started = None
    cloud.answers[OVERVIEW] = answer(503)
    clock.advance(minutes=5)
    await online.turn()  # a step fails: the turn ends before the beat, and the core is quiet for five minutes
    cloud.answers[OVERVIEW] = answer(200, NOBODY)
    for _ in range(8):
        clock.advance(minutes=1)
        await online.turn()
    assert len(_beats(cloud)) == 1  # the beat came to be reached long after the game stopped: it says nothing


async def test_sign_out_in_game_leaves_no_end_beat_for_the_next_account(tmp_path, clock):
    cloud = scripted("status")
    cloud.answers[LOGOUT] = answer(204)
    game = Game(clock.now() - timedelta(minutes=5))
    online = _online(tmp_path, clock, cloud, game=game)
    await online.turn()
    assert len(_beats(cloud)) == 1
    await online.sign_out()
    game.started = None
    online._store.save(CloudSession(
        "ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 365 * 86_400, USER_ID, "Nova", "5120",
    ))
    clock.advance(seconds=30)
    await online.turn()
    assert len(_beats(cloud)) == 1


async def test_no_heartbeat_while_status_is_off(tmp_path, clock):
    cloud = scripted("primogems")
    await _run(_online(tmp_path, clock, cloud, sleep=Sleeps(clock, 5)))
    assert _count(cloud, "heartbeat") == 0


async def test_a_refused_heartbeat_ends_nothing(tmp_path, clock):
    # Status turned off on another device, before this one has looked again.
    cloud = scripted("status")
    cloud.answers[HEARTBEAT] = answer(403, {"message": "new row violates row-level security policy"})
    online = _online(tmp_path, clock, cloud, sleep=Sleeps(clock, 2), game=Game(clock.now()))
    await _run(online)
    assert _count(cloud, "heartbeat") == 3
    assert online.view()["offline"] is False


async def test_a_refusal_ends_nothing_else(tmp_path, clock):
    # A step the server refused says nothing of the server: the friends are still read, and the heartbeat still goes.
    cloud = scripted("status")
    cloud.answers[PROFILE_UPDATE] = answer(400, {"message": "refused"})
    cloud.answers[SET_UID] = answer(400, {"message": "refused"})
    online = _online(tmp_path, clock, cloud, profile=_facts, game=Game(clock.now()))
    await online.turn()
    assert _count(cloud, "friends_overview") == 1 and _count(cloud, "heartbeat") == 1


async def test_stats_wait_when_status_shared_but_game_closed(tmp_path, clock, monkeypatch):
    # With Status shared, a number that changed on each pass while the game is closed would say when the PC is on: it follows
    # the once-a-game-day rule, as with Status off. The minute is drawn from what is left of the game day.
    monkeypatch.setattr("guildboard.cloud.service.random.randrange", lambda count: count // 2)
    cloud = scripted("status", "primogems")
    values = {"primogems": {"now": 0}}
    online = _online(tmp_path, clock, cloud, stats=lambda: values, profile=_facts, game=Game(None))
    for turn in range(6):  # a half hour: well short of the minute drawn
        values["primogems"] = {"now": turn}
        await online.turn()
        clock.advance(minutes=5)
    assert _count(cloud, "shared_stats") == 0


async def test_stats_go_up_at_most_every_five_minutes_and_only_when_changed(tmp_path, clock):
    # With Status shared and the game running: with it off, or the game closed, they go up once a game day (below).
    cloud = scripted("status", "primogems", "wishes")
    values = {"primogems": {"now": 1}, "wishes": {"pity": 2}, "endgame": {"abyss_stars": 36}}
    online = _online(tmp_path, clock, cloud, stats=lambda: values, profile=_facts, game=Game(clock.now()))
    await online.turn()
    assert _count(cloud, "shared_stats") == 1
    assert {row["key"]: row["value"] for row in cloud.body(-1 - _after(cloud, "shared_stats"))} == {
        "primogems": {"now": 1}, "wishes": {"pity": 2},
    }

    values["primogems"] = {"now": 2}
    for _ in range(4):  # a minute at a time, four minutes: a new value waits
        clock.advance(minutes=1)
        await online.turn()
    assert _count(cloud, "shared_stats") == 1

    clock.advance(minutes=1)
    await online.turn()
    assert _count(cloud, "shared_stats") == 2
    assert [row["key"] for row in cloud.body(-1 - _after(cloud, "shared_stats"))] == ["primogems"]  # what changed, alone

    for _ in range(5):  # nothing changed: nothing goes up
        clock.advance(minutes=1)
        await online.turn()
    assert _count(cloud, "shared_stats") == 2


async def test_with_status_off_changed_stats_go_up_at_most_once_a_day(tmp_path, clock, monkeypatch):
    # With Status off, a friend who watched the shared numbers change would learn when the PC was on: what changed goes up once
    # a game day, at a minute of it drawn at random (the player's decision, 2026-11-01, item 4). Three days of turns, five
    # minutes apart, with a value that changes at each. The draw is fixed: one in the day's last minutes falls after its last
    # turn, and that day sends nothing, which "at most once a day" allows and this test's "each day" does not.
    monkeypatch.setattr("guildboard.cloud.service.random.randrange", lambda count: count // 2)
    cloud = scripted("primogems")
    values = {"primogems": {"now": 0}}
    online = _online(
        tmp_path, clock, cloud, stats=lambda: values, profile=_facts, server=lambda: "os_euro",
        today=lambda: game_day(clock.now(), "os_euro"),
    )
    sent_at = []
    for turn in range(3 * 24 * 12):
        values["primogems"] = {"now": turn}
        before = _count(cloud, "shared_stats")
        await online.turn()
        if _count(cloud, "shared_stats") > before:
            sent_at.append(clock.now())
        clock.advance(minutes=5)
    days = [game_day(moment, "os_euro") for moment in sent_at]
    assert len(days) == len(set(days))  # never twice in a game day
    assert {date(2026, 10, 13), date(2026, 10, 14), date(2026, 10, 15)} <= set(days)  # and on each day the PC was on


def _card_online(tmp_path, clock, cloud, *, ar, game):
    return _online(
        tmp_path, clock, cloud, profile=lambda: {"uid": 700000001, "ar": ar(), "picture_url": None}, game=game,
        server=lambda: "os_euro", today=lambda: game_day(clock.now(), "os_euro"),
    )


def _carded(*sharing: str) -> FakeCloud:
    cloud = scripted(*sharing)
    cloud.answers[PROFILE] = answer(200, [own_row(sharing=list(sharing), ar=50, uid=700000001)])
    return cloud


async def test_an_ar_change_with_the_game_closed_waits_for_the_days_minute(tmp_path, clock, monkeypatch):
    # Friends see the card: the moment an AR changed would say when the PC came on. It waits as the stats do.
    monkeypatch.setattr("guildboard.cloud.service.random.randrange", lambda count: count // 2)
    cloud = _carded("status")
    online = _card_online(tmp_path, clock, cloud, ar=lambda: 58, game=Game(None))
    started = clock.now()
    patched_at = None
    for _ in range(12 * 12):
        await online.turn()
        if _count(cloud, "PATCH") and patched_at is None:
            patched_at = clock.now()
            break
        clock.advance(minutes=5)
    assert patched_at is not None and patched_at - started > timedelta(hours=8)  # not on the next pass: at the drawn minute


async def test_an_ar_change_in_game_goes_up_on_the_next_pass(tmp_path, clock):
    cloud = _carded("status")
    online = _card_online(tmp_path, clock, cloud, ar=lambda: 58, game=Game(clock.now()))
    await online.turn()
    assert _count(cloud, "PATCH") == 1 and cloud.body(-1 - _after(cloud, "PATCH")) == {"ar": 58}


async def test_an_ar_change_with_status_off_waits_too(tmp_path, clock):
    cloud = _carded("primogems")
    online = _card_online(tmp_path, clock, cloud, ar=lambda: 58, game=Game(clock.now()))
    await online.turn()
    assert _count(cloud, "PATCH") == 0


async def test_the_first_sign_in_sends_the_profile_at_once(tmp_path, clock):
    # No card yet: signing in is the player's own act, and the profile goes up with the game closed and Status off.
    cloud = scripted()
    online = _card_online(tmp_path, clock, cloud, ar=lambda: 58, game=Game(None))
    await online.turn()
    assert _count(cloud, "PATCH") == 1 and _count(cloud, "set_uid") == 1


async def test_a_pc_that_starts_late_in_the_game_day_does_not_send_when_it_starts(tmp_path, clock, monkeypatch):
    # The minute is drawn from what is left of the game day: drawn over the whole day, a PC that comes on in the evening had
    # passed it already, and its upload fell at the moment Guild Board was opened, which is what the draw is there to hide.
    monkeypatch.setattr("guildboard.cloud.service.random.randrange", lambda count: count // 2)
    clock.set(datetime(2026, 10, 13, 22, 0, tzinfo=timezone.utc))  # 23:00 on the server's clock (UTC+1), 19 hours into the game day
    cloud = scripted("primogems")
    values = {"primogems": {"now": 0}}
    online = _online(
        tmp_path, clock, cloud, stats=lambda: values, profile=_facts, server=lambda: "os_euro",
        today=lambda: game_day(clock.now(), "os_euro"),
    )
    await online.turn()
    assert _count(cloud, "shared_stats") == 0  # not when it starts
    for minute in range(5, 150, 5):  # the minute drawn is the middle of the five hours that are left: two and a half in
        clock.advance(minutes=5)
        values["primogems"] = {"now": minute}
        await online.turn()
    assert _count(cloud, "shared_stats") == 0
    clock.advance(minutes=5)
    await online.turn()
    assert _count(cloud, "shared_stats") == 1  # and it goes up then
    for minute in range(5, 120, 5):  # the day's pass is spent, to the end of the game day (03:00 UTC)
        clock.advance(minutes=5)
        values["primogems"] = {"now": 1000 + minute}
        await online.turn()
    assert _count(cloud, "shared_stats") == 1


async def test_with_status_on_changed_stats_go_up_with_each_pass(tmp_path, clock):
    # Status says the game runs anyway: while it does, the numbers change as they did.
    cloud = scripted("status", "primogems")
    values = {"primogems": {"now": 0}}
    online = _online(tmp_path, clock, cloud, stats=lambda: values, profile=_facts, game=lambda: (True, clock.now()))
    for turn in range(3):
        values["primogems"] = {"now": turn}
        await online.turn()
        clock.advance(minutes=5)
    assert _count(cloud, "shared_stats") == 3


def _after(cloud: FakeCloud, what: str) -> int:
    """How many requests came after the last one that names `what`."""
    lines = cloud.sent()
    return next(index for index, line in enumerate(reversed(lines)) if what in line)


async def test_a_key_turned_off_on_another_device_goes_up_when_it_comes_back(tmp_path, clock):
    # Turning it off there deleted the row, so the same value is news again. (With Status shared and the game running, so that it goes at once.)
    cloud = scripted("status", "wishes")
    online = _online(tmp_path, clock, cloud, stats=lambda: {"wishes": {"pity": 2}}, profile=_facts, game=lambda: (True, clock.now()))
    await online.turn()
    assert _count(cloud, "shared_stats") == 1
    cloud.answers[PROFILE] = answer(200, [own_row(sharing=["status"])])
    clock.advance(minutes=5)
    await online.turn()
    cloud.answers[PROFILE] = answer(200, [own_row(sharing=["status", "wishes"])])
    clock.advance(minutes=5)
    await online.turn()
    assert _count(cloud, "shared_stats") == 2


async def test_a_key_that_comes_on_goes_up_alone(tmp_path, clock):
    # The others keep to their five minutes, however much they changed.
    cloud = scripted("wishes")
    cloud.answers[("POST", "/rest/v1/rpc/set_sharing")] = answer(204)
    values = {"wishes": {"pity": 1}, "primogems": {"now": 1}}
    online = _online(tmp_path, clock, cloud, stats=lambda: values, profile=_facts)
    await online.turn()
    values["wishes"] = {"pity": 2}
    await online.set_sharing(["primogems", "wishes"])
    assert [row["key"] for row in cloud.body(-1)] == ["primogems"]


async def test_with_no_stat_on_nothing_is_worked_out(tmp_path, clock):
    worked: list[int] = []
    online = _online(tmp_path, clock, scripted("status"), stats=lambda: worked.append(1) or {}, profile=_facts)
    await online.turn()
    assert worked == []


async def test_a_failed_upload_is_sent_again(tmp_path, clock):
    cloud = scripted("status", "wishes")
    cloud.answers[UPLOAD] = [answer(503), answer(201)]
    online = _online(tmp_path, clock, cloud, stats=lambda: {"wishes": {"pity": 2}}, profile=_facts, game=lambda: (True, clock.now()))
    await online.turn()
    clock.advance(minutes=5)
    await online.turn()
    assert _count(cloud, "shared_stats") == 2


async def test_the_friends_are_read_every_five_minutes_and_on_a_fresh_ask(tmp_path, clock):
    cloud = scripted()
    online = _online(tmp_path, clock, cloud, sleep=Sleeps(clock, 10))
    await _run(online)  # now, and ten minutes on: at 0, 5 and 10
    assert _count(cloud, "friends_overview") == 3

    clock.advance(seconds=60)
    await online.friends_model(fresh=True)
    assert _count(cloud, "friends_overview") == 4


async def test_a_plain_ask_uses_what_the_last_read_gave(tmp_path, clock):
    cloud = scripted()
    online = _online(tmp_path, clock, cloud)
    await online.friends_model()
    clock.advance(minutes=4)
    await online.friends_model()
    assert _count(cloud, "friends_overview") == 1


async def test_a_fresh_ask_within_55_seconds_uses_the_cache(tmp_path, clock):
    cloud = scripted()
    online = _online(tmp_path, clock, cloud)
    await online.friends_model(fresh=True)
    clock.advance(seconds=54)
    await online.friends_model(fresh=True)
    assert _count(cloud, "friends_overview") == 1
    clock.advance(seconds=1)
    await online.friends_model(fresh=True)
    assert _count(cloud, "friends_overview") == 2


async def test_the_loop_waits_after_a_failure(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(540, b"paused")})
    online = _online(tmp_path, clock, cloud, sleep=Sleeps(clock, 10))
    await _run(online)
    assert len(cloud.requests) == 3  # at 0, 5 and 10 minutes: one try each, and nothing in between
    assert online.view()["offline"] is True and online.view()["state"] == "signed_in"


async def test_a_fresh_ask_keeps_quiet_after_a_failure(tmp_path, clock):
    # The page asks each minute: that must not make a storm while the project is paused.
    cloud = scripted()
    online = _online(tmp_path, clock, cloud)
    await online.friends_model()
    cloud.answers[OVERVIEW] = answer(503)
    clock.advance(minutes=1)
    await online.friends_model(fresh=True)
    for _ in range(3):
        clock.advance(minutes=1)
        await online.friends_model(fresh=True)
    assert _count(cloud, "friends_overview") == 2
    clock.advance(minutes=2)
    await online.friends_model(fresh=True)
    assert _count(cloud, "friends_overview") == 3


async def test_the_server_coming_back_clears_offline(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PROFILE] = [answer(503), answer(200, [own_row()])]
    bus = EventBus()
    heard = bus.subscribe()
    online = _online(tmp_path, clock, cloud)
    online._bus = bus
    await online.turn()
    assert online.view()["offline"] is True and heard.get_nowait()["type"] == "online_changed"
    clock.advance(minutes=5)
    await online.turn()
    assert online.view()["offline"] is False and heard.get_nowait()["type"] == "online_changed"


async def test_the_server_stays_away_until_it_answers(tmp_path, clock):
    # A try after the quiet is no news yet: Settings keeps saying so until something has come back.
    seen: list[bool] = []

    class Watching(FakeCloud):
        def __call__(self, path, **kwargs):
            seen.append(online.view()["offline"])
            return super().__call__(path, **kwargs)

    online = _online(tmp_path, clock, Watching({PROFILE: answer(503)}))
    await online.turn()
    clock.advance(minutes=5)
    await online.turn()
    assert seen == [False, True]


async def test_a_heartbeat_and_a_read_tell_the_pages_nothing(tmp_path, clock):
    cloud = scripted("status")
    bus = EventBus()
    heard = bus.subscribe()
    online = _online(tmp_path, clock, cloud, sleep=Sleeps(clock, 6))
    online._bus = bus
    await _run(online)
    assert heard.empty()


async def test_nothing_goes_out_after_sign_out(tmp_path, clock):
    cloud = scripted("status", "wishes")
    cloud.answers[LOGOUT] = answer(204)
    online = _online(tmp_path, clock, cloud, stats=lambda: {"wishes": {"pity": 2}}, profile=_facts)
    await online.turn()
    await online.sign_out()
    sent = len(cloud.requests)
    for _ in range(10):
        clock.advance(minutes=1)
        await online.turn()
    assert len(cloud.requests) == sent


async def test_the_loop_sleeps_until_a_sign_in_wakes_it(tmp_path, clock):
    cloud = scripted("status")
    cloud.answers[EXCHANGE] = token_answer()
    cloud.answers[ENSURE] = answer(200, {"name": "Nova", "discriminator": "5120"})
    opened: list[str] = []
    online = _online(tmp_path, clock, cloud, signed_in=False, opened=opened, sleep=Sleeps(clock, 0), game=Game(clock.now()))
    task = asyncio.create_task(online.run())
    for _ in range(50):
        await asyncio.sleep(0)
    assert cloud.requests == [] and not task.done()

    online.begin_sign_in(4321)
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    assert await online.finish_sign_in(nonce, "THE-CODE-0123456789") is True
    with pytest.raises(Enough):
        await asyncio.wait_for(task, 5)
    assert _count(cloud, "heartbeat") == 1


async def test_a_new_sign_in_keeps_nothing_of_the_last_session(tmp_path, clock):
    # A lost session, and then a sign-in that may be another Discord account's: what the last one read or sent is not its.
    riley = {"user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None,
             "presence": None, "stats": {}, "pins": [], "compare": False}
    cloud = scripted("status", "wishes")
    cloud.answers[OVERVIEW] = answer(200, {**NOBODY, "friends": [riley]})
    cloud.answers[EXCHANGE] = token_answer()
    cloud.answers[ENSURE] = answer(200, {"name": "Elena", "discriminator": "0031"})
    opened: list[str] = []
    online = _online(
        tmp_path, clock, cloud, opened=opened, stats=lambda: {"wishes": {"pity": 2}}, profile=_facts,
        game=lambda: (True, clock.now()),
    )
    await online.turn()
    assert len((await online.friends_model())["friends"]) == 1

    cloud.answers[PROFILE] = answer(200, [])
    clock.advance(minutes=5)
    await online.turn()
    assert online.view()["state"] == "sign_in_again"

    cloud.answers[PROFILE] = answer(200, [own_row(name="Elena", discriminator="0031", sharing=["status", "wishes"])])
    cloud.answers[OVERVIEW] = answer(200, NOBODY)
    online.begin_sign_in(4321)
    nonce = opened[0].rsplit("%2F", 1)[-1].split("&", 1)[0]
    assert await online.finish_sign_in(nonce, "THE-CODE-0123456789") is True
    assert (await online.friends_model())["friends"] == []
    uploads = _count(cloud, "shared_stats")
    await online.turn()
    assert _count(cloud, "shared_stats") == uploads + 1  # the same stat, unchanged, and still news to this account


async def test_a_lost_session_ends_the_turns(tmp_path, clock):
    cloud = FakeCloud({PROFILE: answer(200, [])})  # the account was deleted on another device
    online = _online(tmp_path, clock, cloud, sleep=Sleeps(clock, 1))
    task = asyncio.create_task(online.run())
    for _ in range(50):
        await asyncio.sleep(0.001)
    assert online.view()["state"] == "sign_in_again"
    assert len(cloud.requests) == 1 and not task.done()  # it waits for a new sign-in, and asks nothing more
    task.cancel()


async def test_a_turn_that_fails_does_not_end_the_loop_or_the_sync(tmp_path, clock):
    # A turn reads this PC's own facts, and one of those can fail (a database another program held past the wait, say). The
    # loop's end would cancel the sync loop beside it, and nothing would start either again until Guild Board restarts.
    from test_cloud_sync import LAYOUT, Bench, scripted as sync_scripted

    cloud = sync_scripted()
    cloud.answers[OVERVIEW] = answer(200, NOBODY)
    cloud.answers[HEARTBEAT] = answer(204)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    real, turns, looks = bench.online.turn, [], 0

    async def flaky() -> None:
        turns.append(1)
        if len(turns) == 1:
            raise RuntimeError("database is locked")
        await real()

    async def spin(seconds: float) -> None:
        nonlocal looks
        looks += 1
        if looks > 30:
            raise Enough
        clock.advance(seconds=seconds)
        await asyncio.sleep(0)

    bench.online.turn = flaky
    bench.online._sleep = spin
    with pytest.raises(Enough):
        await bench.online.run()
    assert len(turns) > 1  # the turns went on after the one that failed
    assert len(bench.sent("sync_push")) == 1  # and so did the sync beside them


async def test_a_stat_that_cant_be_worked_out_ends_nothing_else(tmp_path, clock):
    cloud = scripted("status", "wishes")

    def broken() -> dict:
        raise RuntimeError("a stat could not be worked out")

    online = _online(tmp_path, clock, cloud, sleep=Sleeps(clock, 1), stats=broken, profile=_facts, game=Game(clock.now()))
    await _run(online)
    assert _count(cloud, "heartbeat") == 2 and _count(cloud, "friends_overview") == 1


async def test_after_a_hoyolab_logout_the_last_values_stay(tmp_path, clock):
    cloud = scripted("status", "wishes")
    online = _online(tmp_path, clock, cloud, stats=lambda: {"wishes": {"pity": 2}}, profile=lambda: None)
    await online.turn()
    assert _count(cloud, "shared_stats") == 0 and _count(cloud, "PATCH") == 0
    assert _count(cloud, "heartbeat") == 0  # the game is not running: nothing says that Guild Board is


def test_offline_after_three_minutes():
    assert status_of({"state": "in_game", "seen_seconds": 180}) == "in_game"
    assert status_of({"state": "open", "seen_seconds": 12}) == "offline"  # an old client's row: never shown as open
    assert status_of({"state": "in_game", "seen_seconds": 181}) == "offline"


def test_open_row_reads_offline_without_time(clock):
    # An old client may still write "open", however fresh: no friend sees that Guild Board is open, nor when it was last seen.
    presence = {"state": "open", "since": "2026-10-13T07:00:00+00:00", "seen_seconds": 10}
    assert status_of(presence) == "offline"
    friend = friend_from({**RILEY_ROW, "presence": presence}, clock.now(), TODAY)
    assert (friend["status"], friend["since"], friend["last_seen"]) == ("offline", None, None)


def test_a_friend_who_hides_status_is_not_called_offline(clock):
    assert status_of(None) is None
    friend = friend_from({
        "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None, "presence": None,
        "stats": {}, "pins": [], "compare": False,
    }, clock.now(), TODAY)
    assert (friend["status"], friend["since"], friend["last_seen"]) == (None, None, None)


def test_a_friend_says_when_they_were_last_seen(clock):
    row = {
        "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": True, "ar": 58, "uid": 712345312,
        "presence": {"state": "in_game", "since": "2026-10-13T07:00:00+00:00", "seen_seconds": 200},
        "stats": {"primogems": {"now": 1}}, "pins": ["primogems"], "compare": True,
    }
    friend = friend_from(row, clock.now(), TODAY)
    assert friend == {
        "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": True, "ar": 58, "uid": 712345312,
        "status": "offline", "since": None, "last_seen": iso(clock.now() - timedelta(seconds=200)),
        "stats": {"primogems": {"now": 1}}, "pills": ["primogems"], "compare": True,
    }
    row["presence"]["seen_seconds"] = 12
    friend = friend_from(row, clock.now(), TODAY)
    assert (friend["status"], friend["since"]) == ("in_game", "2026-10-13T07:00:00+00:00")


def test_a_row_the_page_has_no_shape_for_goes_no_further(clock):
    # A changed client can send anything the database takes: friends are trusted with their own numbers, and no more.
    friend = friend_from({
        "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None, "presence": None,
        "stats": {"primogems": "not an object", "gallery": {"x": 1}, "wishes": {"pity": 1}}, "pins": ["primogems"], "compare": True,
    }, clock.now(), TODAY)
    assert friend["stats"] == {"wishes": {"pity": 1}} and friend["pills"] == ["wishes"]


RILEY_ROW = {
    "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None,
    "presence": {"state": "open", "since": "2026-10-13T07:00:00+00:00", "seen_seconds": 12}, "stats": {}, "pins": [],
    "compare": False,
}


@pytest.mark.parametrize("presence", [
    {"state": "open", "since": None},  # no seconds since the last heartbeat
    {"state": "open", "seen_seconds": "12"},
    {"state": "open", "seen_seconds": True},
    {"state": "open", "seen_seconds": None},  # what NaN reads as
    {"state": "open", "seen_seconds": 1e18},  # past any time a PC can name
    {"state": 7, "seen_seconds": 12},
    {"state": "open", "seen_seconds": 12, "since": 5},
])
async def test_a_friend_row_with_an_unreadable_presence_is_dropped(tmp_path, clock, presence):
    # A changed client can write any presence the table takes: one that cannot be read leaves out that friend alone, and the
    # list, a friend's profile and Compare still answer (the audit's CLD-10).
    other = {**RILEY_ROW, "user_id": "00000000-0000-0000-0000-00000000000d", "name": "Odd", "presence": presence}
    cloud = scripted()
    cloud.answers[OVERVIEW] = answer(200, {"friends": [other, RILEY_ROW], "incoming": [7, "x"], "outgoing": {"a": 1}})
    online = _online(tmp_path, clock, cloud)
    model = await online.friends_model()
    assert [friend["name"] for friend in model["friends"]] == ["Riley"]
    assert (model["incoming"], model["outgoing"]) == ([], [])  # and a list of requests that holds no rows is empty
    assert (await online.friend_profile(USER_ID))["friend"]["status"] == "offline"


async def test_a_refused_read_is_marked_old(tmp_path, clock):
    # The server answered, so nothing is quiet and it isn't offline: the list is old all the same.
    cloud = scripted()
    online = _online(tmp_path, clock, cloud)
    await online.friends_model()
    cloud.answers[OVERVIEW] = answer(400, {"message": "refused"})
    clock.advance(minutes=1)
    assert (await online.friends_model(fresh=True))["stale"] is True
    assert online.view()["offline"] is False


async def test_old_friends_are_marked_old(tmp_path, clock):
    cloud = scripted()
    riley = {
        "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None, "presence": None,
        "stats": {}, "pins": [], "compare": False,
    }
    cloud.answers[OVERVIEW] = [answer(200, {**NOBODY, "friends": [riley]}), answer(503)]
    online = _online(tmp_path, clock, cloud)
    first = await online.friends_model()
    assert (first["stale"], first["read_at"], len(first["friends"])) == (False, iso(clock.now()), 1)
    read_at = first["read_at"]
    clock.advance(minutes=1)
    second = await online.friends_model(fresh=True)
    assert (second["stale"], second["read_at"], len(second["friends"])) == (True, read_at, 1)
    assert online.view()["offline"] is True


async def test_nothing_read_yet_with_the_server_away_is_empty_and_old(tmp_path, clock):
    online = _online(tmp_path, clock, FakeCloud({OVERVIEW: answer(503)}))
    model = await online.friends_model()
    assert model == {
        "me": {"name": "Nova", "tag": "5120"}, "friends": [], "incoming": [], "outgoing": [], "read_at": None, "stale": True,
    }


def test_the_default_pills_follow_pin_order():
    every = {key: {} for key in ("spending", "wishes", "account", "achievements", "endgame", "playtime", "primogems")}
    assert pills_of([], every) == ["primogems", "playtime", "endgame"]
    assert pills_of([], {"wishes": {}, "spending": {}}) == ["wishes", "spending"]
    assert pills_of([], {}) == []
    assert pills_of(["wishes", "account"], every) == ["wishes", "account"]  # the player's own, in their order
    assert pills_of(["wishes", "account"], {"account": {}}) == ["account"]  # a pinned stat with no row yet
