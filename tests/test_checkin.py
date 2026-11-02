"""The daily check-in (the daily check-in design): the day that turns over at midnight in UTC+8, the status read in the
background, the one claim on the player's press, its results, and the routes."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

import genshin
import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.checkin import LOOK_GAP, RESULT_TEXT, WEBSITE, CheckIn, CheckInRefused, next_reset
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.records import LoginNeeded
from guildboard.sources import hoyolab
from guildboard.tokenstore import StoredToken, TokenStore
from support import AccountSource, FakeClock, FakeSleep

UID = "700000001"
COOKIES = {"ltoken_v2": "v2_SECRET-VALUE-0123456789", "cookie_token_v2": "v2_OTHER-0123456789", "account_id_v2": "1"}
NOW = datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc)
PORT = 4321
REWARDS = [{"name": "Primogem", "amount": 20, "icon": "https://upload-static.hoyoverse.com/a.png"},
           {"name": "Mora", "amount": 5000, "icon": "https://upload-static.hoyoverse.com/b.png"},
           {"name": "Hero's Wit", "amount": 3, "icon": "https://upload-static.hoyoverse.com/c.png"}]


def status(claimed_today: bool = False, days: int = 1) -> dict:
    return {"claimed_today": claimed_today, "claimed_days": days, "rewards": list(REWARDS)}


class Source:
    """Answers the status from `state` and each claim from `answers`; a claim that succeeds moves the state on."""

    def __init__(self, state: dict | Exception | None = None, answers: tuple = ("claimed",)) -> None:
        self.state = status() if state is None else state
        self.answers = list(answers)
        self.claims = 0
        self.reads = 0

    async def checkin_status(self) -> dict:
        self.reads += 1
        if isinstance(self.state, Exception):
            raise self.state
        return dict(self.state)

    async def claim_checkin(self) -> str:
        self.claims += 1
        result = self.answers.pop(0)
        if result == "claimed":
            self.state = status(True, self.state["claimed_days"] + 1)
        return result


def _checkin(source: Source, clock: FakeClock | None = None, *, ready: bool = True) -> tuple[CheckIn, list[str]]:
    published: list[str] = []
    checkin = CheckIn(source, clock or FakeClock(NOW), lambda: published.append("changed"), ready=lambda: ready)
    return checkin, published


def test_the_day_turns_over_at_midnight_in_utc_plus_8():
    assert next_reset(datetime(2026, 11, 2, 15, 59, tzinfo=timezone.utc)) == datetime(2026, 11, 2, 16, 0, tzinfo=timezone.utc)
    assert next_reset(datetime(2026, 11, 2, 16, 0, tzinfo=timezone.utc)) == datetime(2026, 11, 3, 16, 0, tzinfo=timezone.utc)


async def test_a_look_gives_the_month_and_today():
    checkin, published = _checkin(Source())
    assert checkin.model()["read"] is False
    await checkin.look()
    model = checkin.model()
    assert model["read"] is True and model["claimed_today"] is False and model["claimed_days"] == 1
    assert [reward["name"] for reward in model["rewards"]] == ["Primogem", "Mora", "Hero's Wit"]
    assert model["rewards"][1]["icon"] == "/api/checkin/icon/1"  # never HoYoverse's own address: the interface loads nothing
    assert model["next_reset"] == "2026-11-02T16:00:00+00:00"
    assert model["website"] == WEBSITE
    assert published


async def test_looks_keep_their_gap_unless_the_day_turned_over():
    source = Source()
    clock = FakeClock(NOW)
    checkin, _ = _checkin(source, clock)
    await checkin.look()
    await checkin.look()
    assert source.reads == 1
    clock.advance(seconds=LOOK_GAP + 1)
    await checkin.look()
    assert source.reads == 2
    clock.advance(minutes=5)
    await checkin.look()
    assert source.reads == 2
    clock.set(NOW.replace(hour=16, minute=1))  # past midnight in UTC+8, well inside the gap of the last look
    await checkin.look()
    assert source.reads == 3


async def test_a_new_day_never_shows_yesterdays_claim():
    source = Source(status(True, 4))
    clock = FakeClock(NOW)
    checkin, _ = _checkin(source, clock)
    await checkin.look()
    assert checkin.model()["claimed_today"] is True
    clock.set(NOW.replace(hour=16, minute=1))
    model = checkin.model()
    assert model["read"] is False and model["claimed_today"] is False


async def test_nothing_is_asked_before_the_login_and_the_consent():
    source = Source()
    checkin, _ = _checkin(source, ready=False)
    await checkin.look()
    assert source.reads == 0
    assert checkin.model()["ready"] is False
    with pytest.raises(CheckInRefused):
        await checkin.claim()
    assert source.claims == 0


async def test_a_failed_look_says_so_once_and_keeps_nothing_old():
    source = Source(LoginNeeded("HoYoLAB no longer accepts the saved login."))
    checkin, published = _checkin(source)
    await checkin.look()
    assert checkin.model()["read"] is False and checkin.model()["read_failed"] is True
    published.clear()
    await checkin.look()  # inside the retry's gap: nothing is asked and the page is not told again
    assert source.reads == 1 and published == []


async def test_a_claim_sends_one_request_and_moves_the_day_on():
    source = Source()
    checkin, _ = _checkin(source)
    await checkin.look()
    model = await checkin.claim()
    assert source.claims == 1
    assert model["claimed_today"] is True and model["claimed_days"] == 2 and model["result"] == "claimed"
    assert model["text"] == RESULT_TEXT["claimed"]


async def test_a_claim_counts_even_when_the_read_after_it_fails():
    source = Source()
    checkin, _ = _checkin(source)
    await checkin.look()
    real = source.claim_checkin

    async def claim_then_fail() -> str:
        result = await real()
        source.state = OSError("offline")
        return result

    source.claim_checkin = claim_then_fail  # type: ignore[method-assign]
    model = await checkin.claim()
    assert model["claimed_today"] is True and model["claimed_days"] == 2


async def test_a_claimed_day_is_not_claimed_again():
    source = Source(status(True, 4))
    checkin, _ = _checkin(source)
    await checkin.look()
    await checkin.claim()
    assert source.claims == 0


async def test_two_presses_at_once_send_one_claim():
    source = Source(answers=("claimed", "claimed"))
    real = source.claim_checkin

    async def slow() -> str:
        await asyncio.sleep(0.01)
        return await real()

    source.claim_checkin = slow  # type: ignore[method-assign]
    checkin, _ = _checkin(source)
    await checkin.look()
    await asyncio.gather(checkin.claim(), checkin.claim())
    assert source.claims == 1


@pytest.mark.parametrize("result", ["verify", "login", "failed"])
async def test_a_refused_claim_keeps_the_day_open_and_says_why(result):
    source = Source(answers=(result,))
    checkin, _ = _checkin(source)
    await checkin.look()
    model = await checkin.claim()
    assert model["claimed_today"] is False and model["result"] == result and model["text"] == RESULT_TEXT[result]
    assert source.claims == 1  # never tried again by itself


async def test_already_claimed_on_the_website_shows_as_claimed():
    source = Source(answers=("already",))
    checkin, _ = _checkin(source)
    await checkin.look()
    source.state = status(True, 2)  # claimed on the website since the last look
    model = await checkin.claim()
    assert model["claimed_today"] is True and model["result"] == "already"


async def test_the_result_of_yesterday_is_gone_on_a_new_day():
    source = Source(answers=("failed",))
    clock = FakeClock(NOW)
    checkin, _ = _checkin(source, clock)
    await checkin.look()
    await checkin.claim()
    clock.set(NOW.replace(hour=16, minute=1))
    assert checkin.model()["result"] is None


# ---------------------------------------------------------------- the source


class Client:
    """Stands in for the client of a claim: answers from a script, an error to raise or None."""

    def __init__(self, answer: BaseException | None = None) -> None:
        self.answer = answer
        self.claims: list[dict] = []

    async def claim_daily_reward(self, **kwargs):
        self.claims.append(kwargs)
        if self.answer is not None:
            raise self.answer

    async def get_reward_info(self, **kwargs):
        return genshin.models.DailyRewardInfo(False, 6)

    async def get_monthly_rewards(self, **kwargs):
        return [genshin.models.DailyReward(name="Primogem", cnt=20, icon="https://upload-static.hoyoverse.com/a.png")]


def _source(tmp_path, client: Client) -> hoyolab.HoyolabSource:
    tokens = TokenStore(tmp_path / "token.bin")
    tokens.save(StoredToken(dict(COOKIES), int(UID), "os_euro", "Traveler"))
    return hoyolab.HoyolabSource(tokens, lambda *_: client)


async def test_the_source_reads_the_status(tmp_path):
    assert await _source(tmp_path, Client()).checkin_status() == {
        "claimed_today": False, "claimed_days": 6,
        "rewards": [{"name": "Primogem", "amount": 20, "icon": "https://upload-static.hoyoverse.com/a.png"}],
    }


@pytest.mark.parametrize(("error", "result"), [
    (None, "claimed"),
    (genshin.errors.AlreadyClaimed({"retcode": -5003}), "already"),
    (genshin.errors.GeetestError({"retcode": 10035}), "verify"),
    (genshin.errors.DailyGeetestTriggered({"retcode": 0}, gt="g", challenge="c"), "verify"),
    (genshin.errors.InvalidCookies({"retcode": -100}), "login"),
    (genshin.errors.GenshinException({"retcode": -500}), "failed"),
    (OSError("offline"), "failed"),
])
async def test_the_claim_results(tmp_path, error, result):
    client = Client(error)
    assert await _source(tmp_path, client).claim_checkin() == result
    assert client.claims == [{"game": genshin.Game.GENSHIN, "reward": False}]


async def test_a_claim_without_a_login_sends_nothing(tmp_path):
    client = Client()
    source = hoyolab.HoyolabSource(TokenStore(tmp_path / "token.bin"), lambda *_: client)
    assert await source.claim_checkin() == "login"
    assert client.claims == []


# ---------------------------------------------------------------- the routes


class LiveSource(AccountSource):
    async def checkin_status(self):
        return status()

    async def claim_checkin(self):
        return "claimed"


def _core(tmp_path, *, demo=False) -> Core:
    clock = FakeClock(NOW)
    core = Core(
        AppPaths(tmp_path / "data"), demo=demo, clock=clock, source=None if demo else LiveSource(),
        sleep=FakeSleep(clock), process_lister=lambda: set(),
    )
    core.settings.risk_acknowledged = True
    if not demo:
        core.tokens.save(StoredToken(dict(COOKIES), int(UID), "os_euro", "Traveler"))
    return core


def _session(core: Core) -> TestClient:
    return TestClient(create_app(core, PORT), base_url=f"http://127.0.0.1:{PORT}")


def _read(client: TestClient) -> dict:
    for _ in range(50):  # the look runs in the background: the page hears of its result
        model = client.get("/api/checkin").json()
        if model["read"]:
            return model
        time.sleep(0.02)
    raise AssertionError("the status was never read")


def _logged_in(client: TestClient, core: Core) -> None:
    assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303


def test_the_demo_claims_in_its_own_memory_alone(tmp_path):
    core = _core(tmp_path, demo=True)
    with _session(core) as client:
        _logged_in(client, core)
        model = _read(client)
        assert model["claimed_today"] is False and len(model["rewards"]) == 30
        answer = client.post("/api/checkin/claim")
        assert answer.status_code == 200
        assert answer.json()["result"] == "claimed" and answer.json()["claimed_today"] is True
        assert answer.json()["claimed_days"] == model["claimed_days"] + 1


def test_a_claim_without_a_login_is_refused(tmp_path):
    core = _core(tmp_path)
    core.tokens.delete()
    with _session(core) as client:
        _logged_in(client, core)
        answer = client.post("/api/checkin/claim")
    assert answer.status_code == 409 and answer.json() == {"error": RESULT_TEXT["login"]}


def test_a_picture_of_no_reward_is_404(tmp_path):
    core = _core(tmp_path)
    with _session(core) as client:
        _logged_in(client, core)
        assert client.get("/api/checkin/icon/7").status_code == 404


def test_the_web_page_of_the_check_in_may_open_outside():
    from guildboard.shell.dashboard import opens_outside

    assert opens_outside(WEBSITE)
