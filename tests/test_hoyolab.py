import asyncio
import copy
import inspect
import logging
import re
from datetime import datetime, timezone
from types import SimpleNamespace

import aiohttp
import genshin
import pydantic
import pytest
import yarl
from genshin.client.components.calculator.calculator import BatchCalculator

import json
from urllib.parse import quote, quote_plus

import hoyolab_samples as samples
from guildboard import logging_setup, netpolicy
from guildboard.pulls.gamecache import KEY, KEY_VERSION
from guildboard.records import (
    CalcTarget,
    CalendarRecord,
    CharactersRecord,
    DataSwitchOff,
    GameAccount,
    LoginNeeded,
    Offline,
    OverviewRecord,
    RateLimited,
    RawResponse,
    Unexpected,
    VerificationNeeded,
)
from guildboard.sources import hoyolab
from guildboard.tokenstore import StoredToken, TokenStore

UTC = timezone.utc
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)
COOKIES = {"ltoken_v2": "v2_SECRET-VALUE-0123456789", "ltuid_v2": "123456"}

ENDPOINTS = {
    "get_partial_genshin_user": "index",
    "get_genshin_notes": "dailyNote",
    "get_genshin_characters": "character/list",
    "get_genshin_detailed_characters": "character/detail",
    "batch_compute": "batch_compute",
    "get_genshin_spiral_abyss": "spiralAbyss",
    "get_imaginarium_theater": "role_combat",
    "get_stygian_onslaught": "hard_challenge",
    "get_genshin_diary": "month_info",
    "get_genshin_event_calendar": "act_calendar",
    "request_ledger": "month_detail",
    "get_game_accounts": "getUserGameRolesByCookie",
    "get_reward_info": "info",
    "get_monthly_rewards": "home",
}


def _responses() -> dict[str, object]:
    return {
        "get_partial_genshin_user": samples.INDEX,
        "get_genshin_notes": samples.DAILY_NOTE,
        "get_genshin_characters": samples.CHARACTER_LIST,
        "get_genshin_detailed_characters": samples.CHARACTER_DETAIL,
        "get_genshin_spiral_abyss": samples.SPIRAL_ABYSS,
        "get_imaginarium_theater": samples.ROLE_COMBAT,
        "get_stygian_onslaught": samples.HARD_CHALLENGE,
        "get_genshin_diary": {10: samples.MONTH_INFO_OCT, 9: samples.MONTH_INFO_SEP, 8: samples.MONTH_INFO_AUG},
        "get_genshin_event_calendar": samples.ACT_CALENDAR,
        "get_game_accounts": samples.ACCOUNTS,
    }


class FakeClient:
    """Stands in for the genshin client: answers the nine read methods from canned raw responses."""

    def __init__(self, responses: dict[str, object] | None = None) -> None:
        self.responses = responses if responses is not None else _responses()
        self.captured: list[RawResponse] = []
        self.calls: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, method: str):
        if method not in ENDPOINTS or method not in self.responses:  # the detail log, unless a test gives it
            raise AttributeError(method)

        async def answer(*args, **kwargs):
            self.calls.append((method, args, kwargs))
            response = self.responses[method]
            if method == "get_genshin_diary" and isinstance(response, dict):
                response = response[kwargs["month"]]
            if callable(response):
                response = response(**kwargs)
            if isinstance(response, BaseException):
                raise response
            self.captured.append(RawResponse(ENDPOINTS[method], response))
            return response

        return answer


@pytest.fixture
def tokens(tmp_path) -> TokenStore:
    store = TokenStore(tmp_path / "token.bin")
    store.save(StoredToken(dict(COOKIES), 700000001, "os_euro", "Traveler"))
    return store


def _source(tokens, client) -> hoyolab.HoyolabSource:
    return hoyolab.HoyolabSource(tokens, client_factory=lambda cookies, uid, on_update: client)


async def test_third_party_lookups_are_switched_off():
    assert genshin.utility.update_characters_any is hoyolab._no_third_party_lookup
    assert genshin.utility.extdb.update_characters_any is hoyolab._no_third_party_lookup
    assert await genshin.utility.update_characters_any("en-us", lenient=True) is None


async def test_guard_refuses_other_hosts():
    on_start = hoyolab.guard_trace().on_request_start[0]
    with pytest.raises(netpolicy.HostNotAllowed):
        await on_start(None, None, SimpleNamespace(url=yarl.URL("https://gi.yatta.moe/api/v2/en/avatar")))
    with pytest.raises(netpolicy.HostNotAllowed):  # the list is downloaded without cookies, never by this client
        await on_start(None, None, SimpleNamespace(url=yarl.URL(netpolicy.ACHIEVEMENT_LIST_URL)))
    await on_start(None, None, SimpleNamespace(url=yarl.URL("https://sg-public-api.hoyolab.com/x")))


async def test_guard_refuses_redirects_to_other_hosts():
    on_redirect = hoyolab.guard_trace().on_request_redirect[0]
    source = yarl.URL("https://www.hoyolab.com/a")

    def params(location):
        return SimpleNamespace(url=source, response=SimpleNamespace(headers={"Location": location}))

    with pytest.raises(netpolicy.HostNotAllowed):
        await on_redirect(None, None, params("https://evil.example/x"))
    with pytest.raises(netpolicy.HostNotAllowed):
        await on_redirect(None, None, params(netpolicy.ACHIEVEMENT_LIST_URL))
    await on_redirect(None, None, params("/somewhere/else"))
    await on_redirect(None, None, SimpleNamespace(url=source, response=SimpleNamespace(headers={})))


async def test_guarded_cookie_manager_adds_the_guard():
    session = hoyolab.GuardedCookies(dict(COOKIES)).create_session()
    try:
        assert len(session.trace_configs) == 1
    finally:
        await session.close()


async def test_client_checks_the_host_before_sending(monkeypatch):
    sent: list[str] = []

    async def parent_request(self, url, **kwargs):
        sent.append(str(url))
        return {"ok": 1}

    monkeypatch.setattr(genshin.Client, "request", parent_request)
    client = hoyolab.make_client(COOKIES, 700000001, None)
    assert isinstance(client.cookie_manager, hoyolab.GuardedCookies)
    with pytest.raises(netpolicy.HostNotAllowed):
        await client.request("https://evil.example/x")
    with pytest.raises(netpolicy.HostNotAllowed):
        await client.request(netpolicy.ACHIEVEMENT_LIST_URL)
    assert sent == []
    url = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/index"
    assert await client.request(url) == {"ok": 1}
    assert sent == [url]
    assert client.captured == [RawResponse("index", {"ok": 1})]


def test_endpoint_name():
    assert hoyolab.endpoint_name("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote") == "dailyNote"
    assert hoyolab.endpoint_name("https://x.hoyolab.com/event/game_record/genshin/api/character/list?a=1") == "character/list"
    assert hoyolab.endpoint_name("https://sg-hk4e-api.hoyolab.com/event/ysledgeros/month_info") == "month_info"


async def test_only_read_methods_can_be_called():
    assert hoyolab.READ_METHODS == frozenset(ENDPOINTS)
    client = FakeClient()
    with pytest.raises(Unexpected):
        await hoyolab.call(client, "redeem_code", "GENSHINGIFT")
    with pytest.raises(Unexpected):
        await hoyolab.call(client, "update_settings", 3, True)
    assert client.calls == []


def test_source_file_calls_the_library_only_through_the_allowlist():
    source = inspect.getsource(hoyolab)
    # No direct method call on the client, except the library's builder of the batch calculator, inside `_batch_compute`
    # alone, and the two writes the player asks for: redeeming a gift code and claiming the day's reward.
    assert re.findall(r"\bclient\.[a-z_]+\(", source) == [
        "client.batch_calculator(", "client.claim_daily_reward(", "client.redeem_code(",
    ]
    assert "client.batch_calculator(" in inspect.getsource(hoyolab._batch_compute)
    named = re.findall(r'(?:call|raw_of)\(\s*client,\s*"([a-z_]+)"', source)
    assert set(named) == set(hoyolab.READ_METHODS)


def test_translate_errors():
    errors = genshin.errors
    cases = [
        (errors.GeetestError({"retcode": 10035}), VerificationNeeded),
        (errors.InvalidCookies({"retcode": -100}), LoginNeeded),
        (errors.DataNotPublic({"retcode": 10102}), DataSwitchOff),
        (errors.GenshinException({"retcode": 10102}, "Real-time notes are not enabled."), DataSwitchOff),
        (errors.VisitsTooFrequently({"retcode": -110}), RateLimited),
        (errors.TooManyRequests({"retcode": 10101}), RateLimited),
        (errors.InternalDatabaseError({"retcode": -1}), Offline),
        (errors.GenshinException({"retcode": 12345, "message": "odd"}), Unexpected),
        (aiohttp.ClientConnectionError("down"), Offline),
        (asyncio.TimeoutError(), Offline),
        (netpolicy.HostNotAllowed("evil.example"), Unexpected),
        (RuntimeError("anything"), Unexpected),
    ]
    for error, expected in cases:
        translated = hoyolab.translate(error)
        assert type(translated) is expected, error
        assert "SECRET" not in str(translated)
    assert str(hoyolab.translate(errors.GenshinException({"retcode": 12345}))) == "HoYoLAB answered with error 12345."
    assert "evil.example" in str(hoyolab.translate(netpolicy.HostNotAllowed("evil.example")))
    already = Offline("No connection.")
    assert hoyolab.translate(already) is already


async def test_fetch_without_a_token_needs_login(tmp_path):
    source = hoyolab.HoyolabSource(TokenStore(tmp_path / "none.bin"), client_factory=lambda *a: FakeClient())
    with pytest.raises(LoginNeeded):
        await source.fetch("overview", now=NOW)


async def test_fetch_overview(tokens):
    client = FakeClient()
    result = await _source(tokens, client).fetch("overview", now=NOW)
    assert isinstance(result.record, OverviewRecord)
    assert result.record.counters["oculi.cryo"] == 42.0
    assert (result.group, result.fetched_at, result.problem) == ("overview", NOW, None)
    assert result.raw == (RawResponse("index", samples.INDEX),)
    assert client.calls == [("get_partial_genshin_user", (700000001,), {})]


async def test_fetch_notes_never_switches_settings_on(tokens):
    client = FakeClient()
    result = await _source(tokens, client).fetch("notes", now=NOW)
    assert result.record.resin == 142
    assert client.calls == [("get_genshin_notes", (700000001,), {"autoauth": False, "return_raw_data": True})]


async def test_fetch_endgame_uses_raw_responses(tokens):
    client = FakeClient()
    result = await _source(tokens, client).fetch("endgame", now=NOW)
    assert [mode.score for mode in result.record.modes] == [36.0, 10.0, 5.0]
    assert [(name, kwargs) for name, _, kwargs in client.calls] == [
        ("get_genshin_spiral_abyss", {"raw": True}),
        ("get_imaginarium_theater", {"raw": True}),
        ("get_stygian_onslaught", {"raw": True}),
    ]
    assert [raw.endpoint for raw in result.raw] == ["spiralAbyss", "role_combat", "hard_challenge"]


async def test_fetch_diary_reads_two_months_and_three_the_first_time(tokens):
    client = FakeClient()
    usual = await _source(tokens, client).fetch("diary", now=NOW)
    assert [kwargs["month"] for _, _, kwargs in client.calls] == [10, 9]
    assert [(m.year, m.month) for m in usual.record.months] == [(2026, 9), (2026, 10)]
    client = FakeClient()
    first = await _source(tokens, client).fetch("diary", now=NOW, first_time=True)
    assert [kwargs["month"] for _, _, kwargs in client.calls] == [10, 9, 8]
    assert [m.primogems for m in first.record.months] == [5920, 7340, 3180]
    assert len(first.raw) == 3


def _detail(month: int, current_page: int, count: int) -> dict:
    return {
        "uid": 700000001, "region": "os_euro", "data_month": month, "current_page": current_page,
        "list": [{"action_id": 1, "action": "Daily Commission reward", "time": f"2026-{month:02d}-12 04:30:00",
                  "num": 60}] * count,
    }


async def test_the_diary_reads_its_detail_log_of_primogems_page_by_page(tokens):
    client = FakeClient()
    sizes = {(10, 1): 100, (10, 2): 3, (9, 1): 1}
    client.responses["request_ledger"] = lambda month, params, **_: _detail(
        month, params["current_page"], sizes[(month, params["current_page"])]
    )
    result = await _source(tokens, client).fetch("diary", now=NOW)
    detail = [kwargs for method, _, kwargs in client.calls if method == "request_ledger"]
    assert [(kwargs["month"], kwargs["params"]["current_page"]) for kwargs in detail] == [(10, 1), (10, 2), (9, 1)]
    assert all(kwargs["detail"] is True and kwargs["params"]["type"] == 1 for kwargs in detail)
    assert len(result.record.entries) == 104 and result.record.uid == 700000001
    first = result.record.entries[0]
    assert (first.time, first.action, first.amount) == ("2026-10-12 04:30:00", "Daily Commission reward", 60)
    assert first.at == datetime(2026, 10, 12, 3, 30, tzinfo=UTC)  # server time, Europe's


async def test_a_diary_detail_that_fails_keeps_the_month_totals(tokens):
    client = FakeClient()
    client.responses["request_ledger"] = genshin.errors.VisitsTooFrequently({"retcode": 10101, "message": "slow"})
    result = await _source(tokens, client).fetch("diary", now=NOW)
    assert [m.month for m in result.record.months] == [9, 10] and result.record.entries == ()


async def test_diary_months_wrap_around_january(tokens):
    client = FakeClient()
    client.responses["get_genshin_diary"] = {
        number: {"data_month": number, "month_data": {"current_primogems": number}} for number in (1, 12, 11)
    }
    january = datetime(2027, 1, 5, 8, 0, tzinfo=UTC)
    result = await _source(tokens, client).fetch("diary", now=january, first_time=True)
    assert [kwargs["month"] for _, _, kwargs in client.calls] == [1, 12, 11]
    assert [(m.year, m.month) for m in result.record.months] == [(2026, 11), (2026, 12), (2027, 1)]


async def test_fetch_characters_and_calendar(tokens):
    client = FakeClient()
    source = _source(tokens, client)
    characters = (await source.fetch("characters", now=NOW)).record
    assert isinstance(characters, CharactersRecord) and (characters.owned, characters.level90) == (3, 2)
    calendar = (await source.fetch("calendar", now=NOW)).record
    assert isinstance(calendar, CalendarRecord) and (calendar.banners, calendar.events) == (3, 4)


async def test_the_characters_group_reads_the_list_then_the_details_of_every_owned_character(tokens):
    client = FakeClient()
    result = await _source(tokens, client).fetch("characters", now=NOW)
    assert [(method, args) for method, args, _ in client.calls] == [
        ("get_genshin_characters", (700000001,)),
        ("get_genshin_detailed_characters", (700000001,)),
    ]
    # The ids come from the list, and the answer comes back raw, so the library's own parse cannot lose it.
    assert client.calls[1][2] == {"characters": [10000002, 10000021, 10000089], "return_raw_data": True}
    assert [raw.endpoint for raw in result.raw] == ["character/list", "character/detail"]
    assert result.record.builds is not None
    assert [build.name for build in result.record.builds.builds] == ["Sandrone", "Kamisato Ayaka"]
    assert result.record.calculator is None  # no focus, so no calculator (Task S2)


async def test_no_owned_character_means_no_detail_request(tokens):
    client = FakeClient(dict(_responses(), get_genshin_characters={"list": []}))
    result = await _source(tokens, client).fetch("characters", now=NOW)
    assert [method for method, _, _ in client.calls] == ["get_genshin_characters"]
    assert result.record.owned == 0 and result.record.builds.builds == ()


async def test_a_long_list_is_asked_for_in_batches(tokens, monkeypatch):
    monkeypatch.setattr(hoyolab, "DETAIL_BATCH", 2)
    client = FakeClient()
    await _source(tokens, client).fetch("characters", now=NOW)
    asked = [kwargs["characters"] for method, _, kwargs in client.calls if method == "get_genshin_detailed_characters"]
    assert asked == [[10000002, 10000021], [10000089]]


async def test_an_unreadable_detail_answer_keeps_its_raw_and_reports_a_problem(tokens):
    broken = {"avatars": "moved"}
    client = FakeClient(dict(_responses(), get_genshin_detailed_characters=broken))
    result = await _source(tokens, client).fetch("characters", now=NOW)
    assert result.record is None
    assert result.problem == "HoYoLAB's characters data has an unexpected shape."
    assert [raw.endpoint for raw in result.raw] == ["character/list", "character/detail"]
    assert result.raw[1].body == broken


SANDRONE_TARGET = CalcTarget(samples.SANDRONE_ID, (90, 90), (14520, 90, 90), ((10, 9, 10), (11, 10, 10), (12, 10, 10)))
UNOWNED_TARGET = CalcTarget(10000052, (1, 90), None, ())


class CalculatorClient(FakeClient):
    """A client whose batch calculator is the library's own builder, with the request replaced by a record of what it
    would send. Any other calculator call (a `with_current_*` builder reaches for the character's details) is an
    attribute this client does not have."""

    def __init__(self, answer: object = None, **kwargs) -> None:
        super().__init__(**kwargs)
        self.answer = samples.BATCH_COMPUTE if answer is None else answer
        self.sent: list[list[dict]] = []

    def batch_calculator(self, **kwargs):
        return BatchCalculator(self, **kwargs)

    async def _execute_batch_calculator(self, data, *, lang=None):
        self.sent.append([dict(item) for item in data])
        if isinstance(self.answer, BaseException):
            raise self.answer
        self.captured.append(RawResponse("batch_compute", self.answer))


def _with_targets(tokens, client, *targets):
    return hoyolab.HoyolabSource(
        tokens, client_factory=lambda cookies, uid, on_update: client, calculator_targets=lambda: targets
    )


async def test_the_calculator_is_asked_for_each_focus_character_at_the_highest_targets(tokens):
    client = CalculatorClient()
    result = await _with_targets(tokens, client, SANDRONE_TARGET, UNOWNED_TARGET).fetch("characters", now=NOW)
    assert client.sent == [[
        {
            "avatar_id": samples.SANDRONE_ID, "avatar_level_current": 90, "avatar_level_target": 90,
            "weapon": {"id": 14520, "level_current": 90, "level_target": 90},
            "skill_list": [
                {"id": 10, "level_current": 9, "level_target": 10},
                {"id": 11, "level_current": 10, "level_target": 10},
                {"id": 12, "level_current": 10, "level_target": 10},
            ],
        },
        {"avatar_id": 10000052, "avatar_level_current": 1, "avatar_level_target": 90},  # not owned: from level 1
    ]]
    # Explicit levels only: the builders that read the character's details first were never touched.
    assert not [name for name, _, _ in client.calls if name.startswith(("get_calculator", "get_character_details"))]
    assert [raw.endpoint for raw in result.raw] == ["character/list", "character/detail", "batch_compute"]
    assert result.record.calculator.has_user_info is True
    assert result.record.calculator.targets == {
        samples.SANDRONE_ID: {"level": 90, "weapon": 90, "talent": 10},
        10000052: {"level": 90},
    }


async def test_the_calculator_comes_after_the_details_and_only_for_a_focus(tokens):
    client = CalculatorClient()
    await _with_targets(tokens, client, SANDRONE_TARGET).fetch("characters", now=NOW)
    assert [method for method, _, _ in client.calls] == ["get_genshin_characters", "get_genshin_detailed_characters"]
    assert len(client.sent) == 1  # one request for all the focus characters


async def test_no_focus_means_no_calculator_request(tokens):
    client = CalculatorClient()
    result = await _with_targets(tokens, client).fetch("characters", now=NOW)
    assert client.sent == [] and result.record.calculator is None
    assert [raw.endpoint for raw in result.raw] == ["character/list", "character/detail"]


async def test_a_calculator_that_fails_keeps_the_builds(tokens, caplog):
    client = CalculatorClient(genshin.errors.GenshinException({"retcode": 12345, "message": "SECRET-DETAIL"}))
    with caplog.at_level(logging.INFO, logger="guildboard.sources.hoyolab"):
        result = await _with_targets(tokens, client, SANDRONE_TARGET).fetch("characters", now=NOW)
    assert result.record.calculator is None and len(result.record.builds.builds) == 2
    assert "GenshinException" in caplog.text and "SECRET-DETAIL" not in caplog.text  # the kind, not the answer


@pytest.mark.parametrize(
    "error, expected",
    [
        (genshin.errors.GeetestError({"retcode": 10035}), VerificationNeeded),
        (genshin.errors.InvalidCookies({"retcode": -100}), LoginNeeded),
        (genshin.errors.VisitsTooFrequently({"retcode": -110}), RateLimited),
        (netpolicy.HostNotAllowed("evil.example"), Unexpected),
    ],
)
async def test_a_calculator_that_asks_for_a_check_refuses_the_login_or_says_too_many_stops_the_run(tokens, error, expected):
    # These are what stop a sync and keep it stopped until the player deals with them: the calculator is no exception.
    client = CalculatorClient(error)
    with pytest.raises(expected):
        await _with_targets(tokens, client, SANDRONE_TARGET).fetch("characters", now=NOW)


async def test_a_calculator_answer_that_cannot_be_read_keeps_the_builds(tokens):
    client = CalculatorClient({"unrelated": 1})
    result = await _with_targets(tokens, client, SANDRONE_TARGET).fetch("characters", now=NOW)
    assert result.record.calculator is None and len(result.record.builds.builds) == 2
    assert result.raw[-1] == RawResponse("batch_compute", {"unrelated": 1})  # still archived


async def test_the_calculator_is_a_read_method_and_the_builders_that_reach_for_details_are_never_named():
    assert "batch_compute" in hoyolab.READ_METHODS
    source = inspect.getsource(hoyolab)
    for forbidden in ("with_current", "_get_calculator_items", "get_calculator_", "get_character_details", "autoauth=True"):
        assert forbidden not in source, forbidden


def test_the_client_is_reached_by_name_only_by_call_and_the_batch_calculators_builder_by_a_plain_call():
    # The scan of direct calls sees the one plain call of the library's builder of the batch calculator, which only
    # `_batch_compute` makes, reached only through `call("batch_compute")`. A method reached by a name cannot be seen by that
    # scan, so it is pinned here: `call`'s `getattr(client, method)`, for the read methods alone, and nothing else.
    source = inspect.getsource(hoyolab)
    assert re.findall(r"getattr\(\s*client,\s*(\w+)\s*\)", source) == ["method"]
    assert "getattr(client, method)" in inspect.getsource(hoyolab.call)
    assert "getattr(client" not in inspect.getsource(hoyolab._batch_compute)
    assert re.findall(r"\bclient\.batch_calculator\(", source) == ["client.batch_calculator("]
    assert not hasattr(hoyolab, "_BATCH_BUILDER")
    assert re.findall(r"\b_batch_compute\(", source) == ["_batch_compute(", "_batch_compute("]  # defined, and called by call
    assert "_batch_compute(" in inspect.getsource(hoyolab.call)


async def test_the_endgame_and_calendar_groups_carry_their_details_beside_their_summaries(tokens):
    client = FakeClient(dict(
        _responses(), get_genshin_spiral_abyss=samples.SPIRAL_ABYSS_FLOORS,
        get_stygian_onslaught=samples.HARD_CHALLENGE_BOSSES, get_genshin_event_calendar=samples.ACT_CALENDAR_DETAIL,
    ))
    source = _source(tokens, client)
    endgame = (await source.fetch("endgame", now=NOW)).record
    assert [mode.score for mode in endgame.modes] == [36.0, 10.0, 5.0]  # the summaries as they were
    assert endgame.detail.abyss_stars == 36 and len(endgame.detail.abyss_halves) == 3
    assert endgame.detail.stygian_bosses[0].advantage == ("Cryo", "Dendro")
    calendar = (await source.fetch("calendar", now=NOW)).record
    assert (calendar.banners, calendar.events) == (3, 3)
    assert calendar.detail.theater_text.startswith("Cryo, Pyro and Anemo") and len(calendar.detail.banners) == 2


async def test_a_detail_that_cannot_be_read_never_costs_the_summary(tokens, monkeypatch, caplog):
    def explode(*raw):
        raise OverflowError("odd")

    monkeypatch.setattr(hoyolab.norm, "normalize_endgame_detail", explode)
    monkeypatch.setattr(hoyolab.norm, "normalize_calendar_detail", explode)
    source = _source(tokens, FakeClient())
    with caplog.at_level(logging.WARNING, logger="guildboard.sources.hoyolab"):
        endgame = (await source.fetch("endgame", now=NOW)).record
        calendar = (await source.fetch("calendar", now=NOW)).record
    assert endgame.detail is None and [mode.score for mode in endgame.modes] == [36.0, 10.0, 5.0]
    assert calendar.detail is None and calendar.banners == 3
    assert "endgame detail could not be read (OverflowError)" in caplog.text


async def test_unreadable_shape_keeps_the_raw_response(tokens):
    broken = copy.deepcopy(samples.INDEX)
    del broken["stats"]
    client = FakeClient(dict(_responses(), get_partial_genshin_user=broken))
    result = await _source(tokens, client).fetch("overview", now=NOW)
    assert result.record is None
    assert result.problem == "HoYoLAB's overview data has an unexpected shape."
    assert result.raw == (RawResponse("index", broken),)


async def test_library_parse_failure_still_uses_the_raw_response(tokens):
    class StrictClient(FakeClient):
        async def get_partial_genshin_user(self, *args, **kwargs):
            self.captured.append(RawResponse("index", samples.INDEX))
            raise pydantic.ValidationError.from_exception_data("PartialGenshinUserStats", [])

    result = await _source(tokens, StrictClient()).fetch("overview", now=NOW)
    assert result.record.counters["achievements"] == 1318.0


async def test_library_errors_are_translated_in_fetch(tokens):
    captcha = genshin.errors.GeetestError({"retcode": 10035})
    client = FakeClient(dict(_responses(), get_genshin_spiral_abyss=captcha))
    with pytest.raises(VerificationNeeded):
        await _source(tokens, client).fetch("endgame", now=NOW)
    expired = genshin.errors.InvalidCookies({"retcode": -100})
    client = FakeClient(dict(_responses(), get_partial_genshin_user=expired))
    with pytest.raises(LoginNeeded):
        await _source(tokens, client).fetch("overview", now=NOW)


async def test_list_accounts(tokens):
    seen: list[tuple] = []
    client = FakeClient()

    def factory(cookies, uid, on_update):
        seen.append((dict(cookies), uid, on_update))
        return client

    accounts = await hoyolab.HoyolabSource(tokens, client_factory=factory).list_accounts(COOKIES)
    assert accounts == [
        GameAccount(700000001, "Traveler", "os_euro", 60),
        GameAccount(800000002, "Lumine", "os_asia", 45),
    ]
    assert seen == [(COOKIES, None, None)]
    rejected = FakeClient(dict(_responses(), get_game_accounts=genshin.errors.InvalidCookies({"retcode": -100})))
    with pytest.raises(LoginNeeded):
        await hoyolab.HoyolabSource(tokens, client_factory=lambda *a: rejected).list_accounts(COOKIES)


async def test_cookie_updates_are_saved(tokens):
    handed: list[object] = []

    def factory(cookies, uid, on_update):
        handed.append(on_update)
        return FakeClient()

    await hoyolab.HoyolabSource(tokens, client_factory=factory).fetch("calendar", now=NOW)
    handed[0]({"ltoken_v2": "v2_FRESH-VALUE-9876543210", "ltuid_v2": "123456"})
    assert tokens.load().cookies["ltoken_v2"] == "v2_FRESH-VALUE-9876543210"


def test_making_a_client_keeps_the_librarys_logger_quiet():
    # NET-11: the library's client sets its logger's level to NOTSET when it is made, so that the logger would take the
    # root's; at DEBUG its lines name every request's address and body. make_client sets it back as setup_logging does.
    library, root = logging.getLogger("genshin"), logging.getLogger()
    before = (library.level, root.level)
    try:
        library.setLevel(logging.WARNING)
        root.setLevel(logging.DEBUG)
        hoyolab.make_client(COOKIES, 700000001, None)
        assert library.getEffectiveLevel() == logging.WARNING
    finally:
        library.setLevel(before[0])
        root.setLevel(before[1])


async def test_a_cookie_update_from_a_client_of_the_login_before_cannot_write_it_back(tokens):
    # L16: each client hands its updates over with the login it was made with, so that one still running when the
    # player logs in again writes nothing of the login before over the new one, while a client of the login stored
    # now has its answers kept.
    handed: list[object] = []

    def factory(cookies, uid, on_update):
        handed.append(on_update)
        return FakeClient()

    source = hoyolab.HoyolabSource(tokens, client_factory=factory)
    await source.fetch("calendar", now=NOW)
    fresh = {**COOKIES, "ltoken_v2": "v2_FRESH-LOGIN-0123456789"}
    tokens.save(StoredToken(dict(fresh), 700000001, "os_euro", "Traveler"))
    handed[0]({**COOKIES, "cookie_token_v2": "v2_SET-FOR-THE-LOGIN-BEFORE-0123"})
    assert tokens.load().cookies == fresh
    await source.fetch("calendar", now=NOW)
    handed[1]({**fresh, "cookie_token_v2": "v2_SET-BY-HOYOLAB-0123456789"})
    assert tokens.load().cookies == {**fresh, "cookie_token_v2": "v2_SET-BY-HOYOLAB-0123456789"}


async def test_guard_refuses_redirects_named_by_the_uri_header():
    on_redirect = hoyolab.guard_trace().on_request_redirect[0]
    source = yarl.URL("https://www.hoyolab.com/a")

    def params(headers):
        return SimpleNamespace(url=source, response=SimpleNamespace(headers=headers))

    with pytest.raises(netpolicy.HostNotAllowed):
        await on_redirect(None, None, params({"URI": "https://evil.example/x"}))
    with pytest.raises(netpolicy.HostNotAllowed):
        await on_redirect(None, None, params({"Location": "", "URI": "https://evil.example/x"}))
    await on_redirect(None, None, params({"URI": "https://act.hoyoverse.com/x"}))


async def test_any_library_failure_after_the_answer_keeps_the_raw_response(tokens):
    body = {"avatars": "moved"}

    class ChokingClient(FakeClient):
        async def get_genshin_characters(self, *args, **kwargs):
            self.captured.append(RawResponse("character/list", body))
            raise KeyError("list")

    result = await _source(tokens, ChokingClient()).fetch("characters", now=NOW)
    assert result.record is None
    assert result.problem == "HoYoLAB's characters data has an unexpected shape."
    assert result.raw == (RawResponse("character/list", body),)


async def test_a_failure_inside_a_raw_call_keeps_what_was_received(tokens):
    class ChokingClient(FakeClient):
        async def get_stygian_onslaught(self, *args, **kwargs):
            self.captured.append(RawResponse("hard_challenge", {"is_unlock": True}))
            raise KeyError("data")

    result = await _source(tokens, ChokingClient()).fetch("endgame", now=NOW)
    assert result.record is None
    assert result.problem == "HoYoLAB's endgame data has an unexpected shape."
    assert [raw.endpoint for raw in result.raw] == ["spiralAbyss", "role_combat", "hard_challenge"]


async def test_any_failure_while_building_the_record_is_an_unreadable_shape(tokens, monkeypatch):
    def explode(raw):
        raise OverflowError("cannot convert float infinity to integer")

    monkeypatch.setattr(hoyolab.norm, "normalize_overview", explode)
    result = await _source(tokens, FakeClient()).fetch("overview", now=NOW)
    assert result.record is None
    assert result.problem == "HoYoLAB's overview data has an unexpected shape."
    assert result.raw == (RawResponse("index", samples.INDEX),)


async def test_a_hoyolab_error_after_an_earlier_answer_is_still_that_error(tokens):
    captcha = genshin.errors.GeetestError({"retcode": 10035})
    client = FakeClient(dict(_responses(), get_imaginarium_theater=captcha))
    with pytest.raises(VerificationNeeded):
        await _source(tokens, client).fetch("endgame", now=NOW)


async def test_an_unexpected_failure_is_written_to_the_log(tokens, caplog):
    class BrokenClient(FakeClient):
        async def get_genshin_characters(self, *args, **kwargs):
            raise RuntimeError("boom inside the library")

    with caplog.at_level(logging.WARNING, logger="guildboard.sources.hoyolab"):
        with pytest.raises(Unexpected) as error:
            await _source(tokens, BrokenClient()).fetch("characters", now=NOW)
    assert str(error.value) == "The sync failed unexpectedly. See the log file."
    assert "RuntimeError" in caplog.text  # "see the log file" must point at something
    assert "boom inside the library" in caplog.text


async def test_an_unknown_hoyolab_error_code_is_written_to_the_log(tokens, caplog):
    odd = genshin.errors.GenshinException({"retcode": 12345, "message": "something new"})
    client = FakeClient(dict(_responses(), get_partial_genshin_user=odd))
    with caplog.at_level(logging.WARNING, logger="guildboard.sources.hoyolab"):
        with pytest.raises(Unexpected):
            await _source(tokens, client).fetch("overview", now=NOW)
    assert "12345" in caplog.text
    assert "something new" in caplog.text


# ---------------------------------------------------------------- gift codes

REDEEM_COOKIES = {**COOKIES, "cookie_token_v2": "v2_OTHER-0123456789", "account_id_v2": "123456"}


class RedeemClient:
    """Stands in for the client of a redeem: answers each call from a script, an error to raise or None."""

    def __init__(self, *script) -> None:
        self.script = list(script)
        self.calls: list[tuple] = []
        self.captured: list[RawResponse] = []

    async def redeem_code(self, code, uid=None, *, game=None):
        self.calls.append((code, uid, game))
        step = self.script.pop(0)
        if step is not None:
            raise step


def _wire_error(retcode: int) -> Exception:
    try:
        genshin.errors.raise_for_retcode({"retcode": retcode, "message": "x"})
    except genshin.errors.GenshinException as error:
        return error
    raise AssertionError(retcode)


def _redeemer(tmp_path, client, cookies=REDEEM_COOKIES, slept=None):
    store = TokenStore(tmp_path / "token.bin")
    store.save(StoredToken(dict(cookies), 700000001, "os_euro", "Traveler"))

    async def sleep(seconds):
        if slept is not None:
            slept.append(seconds)

    return hoyolab.HoyolabSource(store, client_factory=lambda cookies, uid, on_update: client, sleep=sleep)


@pytest.mark.parametrize(
    "error, result",
    [
        (None, "redeemed"),
        (_wire_error(-2017), "already"),
        (_wire_error(-2018), "already"),
        (_wire_error(-2001), "expired"),
        (_wire_error(-2006), "expired"),
        (_wire_error(-2003), "invalid"),
        (_wire_error(-2004), "invalid"),
        (_wire_error(-2008), "invalid"),
        (_wire_error(-2011), "low_ar"),
        (_wire_error(-2021), "low_ar"),
        (genshin.errors.InvalidCookies({"retcode": -100}), "login"),
        (genshin.errors.GenshinException({"retcode": -2017}), "already"),
        (genshin.errors.GenshinException({"retcode": 12345}), "failed"),
        (aiohttp.ClientConnectionError("down"), "failed"),
        (asyncio.TimeoutError(), "failed"),
        (netpolicy.HostNotAllowed("evil.example"), "failed"),
    ],
)
async def test_each_library_error_maps_to_its_result(tmp_path, error, result):
    client = RedeemClient(error)
    assert await _redeemer(tmp_path, client).redeem("GENSHINGIFT") == result
    assert client.calls == [("GENSHINGIFT", 700000001, genshin.Game.GENSHIN)]  # one request, for this account


async def test_a_cooldown_waits_and_tries_once_more(tmp_path):
    slept: list[float] = []
    client = RedeemClient(_wire_error(-2016), None)
    assert await _redeemer(tmp_path, client, slept=slept).redeem("A") == "redeemed"
    assert (len(client.calls), slept) == (2, [hoyolab.COOLDOWN_WAIT])
    client = RedeemClient(_wire_error(-2016), _wire_error(-2016))
    assert await _redeemer(tmp_path, client, slept=slept).redeem("A") == "failed"
    assert len(client.calls) == 2


async def test_a_login_without_the_redeem_cookies_makes_no_request(tmp_path):
    client = RedeemClient()
    assert await _redeemer(tmp_path, client, cookies=COOKIES).redeem("A") == "login"
    without = hoyolab.HoyolabSource(TokenStore(tmp_path / "none.bin"), client_factory=lambda *a: client)
    assert await without.redeem("A") == "login"
    assert client.calls == []


async def test_an_unknown_error_is_logged_without_the_login(tmp_path, caplog):
    caplog.set_level(logging.WARNING)
    assert await _redeemer(tmp_path, RedeemClient(RuntimeError("odd"))).redeem("A") == "failed"
    assert "RuntimeError" in caplog.text
    assert not any(value in caplog.text for value in REDEEM_COOKIES.values())


# The guide's answer in the shape public parsers expect: modules[].exchange_group.bonuses[] with a code, a status, and
# the reward as an icon with an amount. It could not be checked live on 2026-10-26 (no livestream was on).
GUIDE = {
    "retcode": 0,
    "data": {
        "modules": [
            {"module_type": 1},
            {
                "exchange_group": {
                    "bonuses": [
                        {"exchange_code": "abc123", "code_status": "ON",
                         "icon_bitmap": "https://x.hoyoverse.com/Primogem.png", "bonus_num": 60},
                        {"exchange_code": "MORA1", "code_status": "ON",
                         "icon_bitmap": "https://x.hoyoverse.com/Mora.png", "bonus_num": 50000},
                        {"exchange_code": "GONE1", "code_status": "OFF", "bonus_num": 5},
                        {"exchange_code": "nested", "rewards": [
                            {"name": "Hero's Wit", "bonus_num": 3}, {"name": "Primogem", "num": "40"}]},
                    ]
                }
            },
        ]
    },
}


async def test_the_livestream_codes_are_read_from_the_guide():
    import json

    asked = []

    def fetch(url, **kwargs):
        asked.append((url, kwargs["headers"]))
        return json.dumps(GUIDE).encode()

    source = hoyolab.HoyolabSource(None, fetch=fetch)
    assert await source.livestream_codes() == [
        {"code": "ABC123", "primogems": 60}, {"code": "MORA1", "primogems": 0}, {"code": "NESTED", "primogems": 40},
    ]
    assert asked[0][0] == hoyolab.LIVESTREAM_URL
    assert asked[0][0].startswith("https://bbs-api-os.hoyolab.com/") and "cookie" not in str(asked[0][1]).lower()


@pytest.mark.parametrize(
    "body",
    [b"", b"not json", b"[]", b'{"data": null}', b'{"data": {"modules": [{"exchange_group": null}]}}',
     b'{"data": {"modules": [{"exchange_group": {"bonuses": "x"}}]}}', b'{"data": {"modules": 5}}'],
)
def test_a_malformed_guide_answer_gives_no_codes(body):
    assert hoyolab.parse_livestream(body) == []


async def test_either_account_id_cookie_will_do_for_a_redeem(tmp_path):
    base = {"ltoken_v2": "v2_X-0123456789", "cookie_token_v2": "v2_Y-0123456789"}
    assert await _redeemer(tmp_path, RedeemClient(None), cookies={**base, "account_mid_v2": "m"}).redeem("A") == "redeemed"
    client = RedeemClient()
    assert await _redeemer(tmp_path, client, cookies=base).redeem("A") == "login"
    assert client.calls == []


async def test_a_refused_login_is_logged_with_hoyoverses_answer_and_no_cookie(tmp_path, caplog):
    caplog.set_level(logging.WARNING)
    error = genshin.errors.InvalidCookies({"retcode": -1071, "message": "Please log in"})
    assert await _redeemer(tmp_path, RedeemClient(error)).redeem("A") == "login"
    line = next(r.getMessage() for r in caplog.records if "refused for the login" in r.getMessage())
    assert "InvalidCookies" in line and "retcode -1071" in line and "Cookies are not valid" in line
    assert not any(value in caplog.text for value in REDEEM_COOKIES.values())


# ---------------------------------------------------------------- the history keys from the login

MINT_COOKIES = {**REDEEM_COOKIES, "account_mid_v2": "m-0123456789", "lrsag": "L-0123456789"}
MINTED = "MINTED-KEY/0123+456789=="  # decoded; the answer writes it URL-encoded


def _minter(tmp_path, answers, cookies=MINT_COOKIES):
    """A source whose mint request answers from `answers` in turn: bytes, or an error to raise."""
    store = TokenStore(tmp_path / "token.bin")
    store.save(StoredToken(dict(cookies), 700000001, "os_euro", "Traveler"))
    sent: list[tuple[dict, bytes]] = []

    def mint(sent_cookies, body):
        sent.append((dict(sent_cookies), body))
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    return hoyolab.HoyolabSource(store, mint=mint), sent


def _minted_answer(key: str = MINTED) -> bytes:
    data = {"sign_type": 2, "authkey_ver": 1, "authkey": quote(key, safe="")}
    return json.dumps({"retcode": 0, "message": "OK", "data": data}).encode()


async def test_a_key_is_minted_from_the_login_and_held_as_a_secret(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    logging_setup.forget_secrets()
    try:
        source, sent = _minter(tmp_path, [_minted_answer(), _minted_answer("OTHER-KEY-0123456789")])
        assert source.can_mint()
        minted = await source.mint_key("webview_gacha")
        assert (minted.uid, minted.region) == (700000001, "os_euro")  # the account it was given for
        link = minted.link
        assert json.loads(sent[0][1]) == {
            "game_uid": "700000001", "region": "os_euro", "game_biz": "hk4e_global", "auth_appid": "webview_gacha",
        }
        assert sent[0][0] == MINT_COOKIES  # netpolicy.fetch_authkey picks the ones it sends
        # The key decoded, with what the history asks for beside it; the link's repr leaves it out.
        assert link.query[KEY] == MINTED and link.query[KEY_VERSION] == "1"
        assert {name: link.query[name] for name in ("sign_type", "auth_appid", "region", "game_biz")} == {
            "sign_type": "2", "auth_appid": "webview_gacha", "region": "os_euro", "game_biz": "hk4e_global",
        }
        assert "MINTED" not in repr(link)
        # Registered in every form it may be seen in: decoded, as the answer wrote it, and encoded again.
        for form in (MINTED, quote(MINTED, safe=""), quote_plus(MINTED)):
            assert logging_setup.redact(f"x {form} y") == "x [redacted] y"
        csc = (await source.mint_key("csc")).link
        assert csc.query["auth_appid"] == "csc" and json.loads(sent[1][1])["auth_appid"] == "csc"
        assert "MINTED" not in caplog.text and "OTHER-KEY" not in caplog.text
    finally:
        logging_setup.forget_secrets()


async def test_no_key_is_asked_for_without_the_cookie_token(tmp_path):
    source, sent = _minter(tmp_path, [], cookies=COOKIES)
    assert not source.can_mint()
    assert await source.mint_key("webview_gacha") is None
    assert sent == []
    with pytest.raises(ValueError):
        await source.mint_key("something_else")


async def test_a_refused_login_is_login_needed_and_other_failures_give_no_key(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    refused = json.dumps({"retcode": -100, "message": "Please login", "data": None}).encode()
    other = json.dumps({"retcode": -502002, "message": "no", "data": None}).encode()
    source, sent = _minter(tmp_path, [
        refused, other, b"<html>", ConnectionError("down"), json.dumps({"retcode": 0, "data": {}}).encode(),
    ])
    with pytest.raises(LoginNeeded):
        await source.mint_key("csc")
    for _ in range(4):
        assert await source.mint_key("webview_gacha") is None
    assert len(sent) == 5
    assert "retcode -502002" in caplog.text
    assert not any(value in caplog.text for value in MINT_COOKIES.values())
