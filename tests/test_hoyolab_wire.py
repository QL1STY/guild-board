"""The adapter with the real genshin client underneath, and a fake wire in place of the network.

These tests pin what the pinned library puts on the wire, so an upgrade that changes it fails here.
Nothing in this module contacts HoYoLAB.
"""
import http.cookies
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import aiohttp
import pytest
import yarl
from genshin.client.manager import managers

import hoyolab_samples as samples
from guildboard import netpolicy
from guildboard.records import GROUPS, CalcTarget, DataSwitchOff, Offline, RateLimited, RawResponse
from guildboard.sources import hoyolab
from guildboard.tokenstore import StoredToken, TokenStore

UTC = timezone.utc
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)
COOKIES = {"ltoken_v2": "v2_SECRET-VALUE-0123456789", "ltuid_v2": "123456"}
MONTHS = {10: samples.MONTH_INFO_OCT, 9: samples.MONTH_INFO_SEP, 8: samples.MONTH_INFO_AUG}


def ok(data: object) -> dict:
    return {"retcode": 0, "message": "OK", "data": data}


class _Response:
    def __init__(self, payload: object) -> None:
        self._payload = payload
        self.content_type = "application/json"
        self.cookies = http.cookies.SimpleCookie()
        self.headers: dict[str, str] = {}
        self.status = 200

    async def json(self, **kwargs):
        return self._payload

    async def text(self, **kwargs):
        return json.dumps(self._payload)


class _Pending:
    """One request on the fake wire: the host guard runs first, exactly as aiohttp would run it."""

    def __init__(self, wire: "Wire", traces: list, method: str, url: str, kwargs: dict) -> None:
        self._wire, self._traces, self._method, self._url, self._kwargs = wire, traces, method, url, kwargs

    async def __aenter__(self) -> _Response:
        for trace in self._traces:
            for callback in trace.on_request_start:
                await callback(None, None, SimpleNamespace(url=yarl.URL(self._url)))
        self._wire.requests.append((self._method, self._url))
        answer = self._wire.answer(self._url, self._kwargs)
        if isinstance(answer, BaseException):
            raise answer
        return _Response(answer)

    async def __aexit__(self, *exc: object) -> None:
        return None


class _Session:
    def __init__(self, wire: "Wire", traces: list) -> None:
        self._wire, self._traces = wire, traces

    async def __aenter__(self) -> "_Session":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    def request(self, method: str, url: object, **kwargs):
        return _Pending(self._wire, self._traces, method, str(url), kwargs)


class Wire:
    """Answers each endpoint with the sample response, unless the test put something else in `instead`."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str]] = []
        self.instead: dict[str, object] = {}
        self.sync_off = False

    def answer(self, url: str, kwargs: dict) -> object:
        path = yarl.URL(url).path
        for ending, special in self.instead.items():
            if path.endswith(ending):
                return special
        if path.endswith("/month_info"):
            return ok(MONTHS[int((kwargs.get("params") or {})["month"])])
        if path.endswith("/month_detail"):  # the diary's detail log: one short page a month
            params = kwargs.get("params") or {}
            assert params["type"] == 1 and params["current_page"] == 1 and params["page_size"] == 100
            return ok({"uid": 700000001, "region": "os_euro", "data_month": int(params["month"]), "list": [
                {"action_id": 1, "action": "Daily Commission reward", "time": "2026-10-12 04:30:00", "num": 60},
            ]})
        answers = {
            "/index": samples.INDEX,
            "/dailyNote": samples.DAILY_NOTE,
            "/character/list": samples.CHARACTER_LIST,
            "/character/detail": samples.CHARACTER_DETAIL,
            "/batch_compute": samples.BATCH_COMPUTE_SYNC_OFF if self.sync_off else samples.BATCH_COMPUTE,
            "/spiralAbyss": samples.SPIRAL_ABYSS,
            "/role_combat": samples.ROLE_COMBAT,
            "/hard_challenge": {"data": samples.HARD_CHALLENGE, "is_unlock": True},
            "/act_calendar": samples.ACT_CALENDAR,
            "/getUserGameRolesByCookie": samples.ACCOUNTS,
        }
        for ending, data in answers.items():
            if path.endswith(ending):
                return ok(data)
        raise AssertionError(f"the adapter asked for something unexpected: {url}")

    def sent(self) -> list[tuple[str, str]]:
        """What went out, as (method, last part of the path)."""
        return [(method, yarl.URL(url).path.rsplit("/api/", 1)[-1].rsplit("/", 1)[-1]) for method, url in self.requests]


@pytest.fixture
def wire(monkeypatch) -> Wire:
    wire = Wire()
    monkeypatch.setattr(
        managers.BaseCookieManager, "create_session",
        lambda self, **kwargs: _Session(wire, kwargs.get("trace_configs", [])),
    )
    return wire


@pytest.fixture
def source(tmp_path) -> hoyolab.HoyolabSource:
    tokens = TokenStore(tmp_path / "token.bin")
    tokens.save(StoredToken(dict(COOKIES), 700000001, "os_euro", "Traveler"))
    return hoyolab.HoyolabSource(tokens)


async def test_a_first_sync_stays_on_hoyoverse_hosts_and_known_endpoints(wire, source):
    for group in GROUPS:
        result = await source.fetch(group, now=NOW, first_time=True)
        assert result.record is not None, group
    await source.list_accounts(COOKIES)
    assert all(netpolicy.is_hoyoverse(url) for _, url in wire.requests)
    assert wire.sent() == [
        ("GET", "index"),
        ("GET", "dailyNote"),
        ("POST", "list"),  # the character list is read with a POST
        ("POST", "detail"),  # and so are the owned characters' details, in one request
        ("GET", "spiralAbyss"),
        ("GET", "role_combat"),
        ("GET", "hard_challenge"),
        ("GET", "month_info"),
        ("GET", "month_info"),
        ("GET", "month_info"),
        ("GET", "month_detail"),  # the diary's detail log of the same months (the ledger design, section 0)
        ("GET", "month_detail"),
        ("GET", "month_detail"),
        ("POST", "act_calendar"),  # so is the event calendar
        ("GET", "getUserGameRolesByCookie"),
    ]


async def test_the_wire_sends_the_list_and_then_one_detail_request(wire, source):
    result = await source.fetch("characters", now=NOW)
    assert wire.sent() == [("POST", "list"), ("POST", "detail")]
    detail = [url for _, url in wire.requests][1]
    assert detail.endswith("/event/game_record/genshin/api/character/detail") and netpolicy.is_hoyoverse(detail)
    assert [raw.endpoint for raw in result.raw] == ["character/list", "character/detail"]
    assert result.raw[1].body == samples.CHARACTER_DETAIL
    assert [build.name for build in result.record.builds.builds] == ["Sandrone", "Kamisato Ayaka"]


def _focused(tmp_path) -> hoyolab.HoyolabSource:
    tokens = TokenStore(tmp_path / "token.bin")
    tokens.save(StoredToken(dict(COOKIES), 700000001, "os_euro", "Traveler"))
    target = CalcTarget(samples.SANDRONE_ID, (90, 90), (14520, 90, 90), ((10, 9, 10), (11, 10, 10), (12, 10, 10)))
    return hoyolab.HoyolabSource(tokens, calculator_targets=lambda: (target,))


async def test_the_wire_never_sends_to_the_calculators_auth_address(wire, tmp_path):
    result = await _focused(tmp_path).fetch("characters", now=NOW)
    assert wire.sent() == [("POST", "list"), ("POST", "detail"), ("POST", "batch_compute")]
    assert not [url for _, url in wire.requests if "auth" in yarl.URL(url).path]
    calculator = [url for _, url in wire.requests][2]
    assert yarl.URL(calculator).host == "sg-public-api.hoyolab.com" and calculator.endswith("/v3/batch_compute")
    assert netpolicy.is_hoyoverse(calculator)
    assert result.record.calculator.has_user_info is True


async def test_with_sync_off_the_wire_still_asks_only_for_the_amounts(wire, tmp_path):
    wire.sync_off = True  # HoYoLAB answers with has_user_info false, and the library does not ask to switch it on
    result = await _focused(tmp_path).fetch("characters", now=NOW)
    assert wire.sent() == [("POST", "list"), ("POST", "detail"), ("POST", "batch_compute")]
    assert not [url for _, url in wire.requests if "auth" in yarl.URL(url).path]
    assert result.record.calculator.has_user_info is False
    assert result.record.calculator.items[samples.SANDRONE_ID][0].amount == 1700000


async def test_a_too_many_requests_answer_is_sent_once(wire, source):
    wire.instead["/index"] = {"retcode": -110, "message": "Visits too frequently"}
    with pytest.raises(RateLimited):
        await source.fetch("overview", now=NOW)
    assert wire.sent() == [("GET", "index")]  # the library must not retry underneath the sync rules


async def test_a_dropped_connection_is_tried_once_per_call(wire, source):
    wire.instead["/index"] = aiohttp.ClientConnectionError("the connection was dropped")
    with pytest.raises(Offline):
        await source.fetch("overview", now=NOW)
    assert wire.sent() == [("GET", "index")]  # retrying is the sync runner's decision, not the library's


async def test_switched_off_notes_cause_no_second_request(wire, source):
    wire.instead["/dailyNote"] = {"retcode": 10102, "message": "Data is not public for the user"}
    with pytest.raises(DataSwitchOff):
        await source.fetch("notes", now=NOW)
    assert wire.sent() == [("GET", "dailyNote")]  # nothing is sent that would switch the setting on


async def test_an_answer_the_library_cannot_use_is_still_archived(wire, source):
    wire.instead["/character/list"] = ok({"avatars": []})  # the list moved: the library raises KeyError
    characters = await source.fetch("characters", now=NOW)
    assert characters.record is None
    assert characters.problem == "HoYoLAB's characters data has an unexpected shape."
    assert characters.raw == (RawResponse("character/list", {"avatars": []}),)

    wire.instead["/hard_challenge"] = ok({"is_unlock": True})  # no "data" inside: KeyError in a raw call
    endgame = await source.fetch("endgame", now=NOW)
    assert endgame.record is None
    assert [raw.endpoint for raw in endgame.raw] == ["spiralAbyss", "role_combat", "hard_challenge"]

    wire.instead["/index"] = ok(None)  # no data at all: TypeError in the library
    overview = await source.fetch("overview", now=NOW)
    assert overview.record is None
    assert overview.raw == (RawResponse("index", None),)
