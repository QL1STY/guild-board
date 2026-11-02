"""The only module that talks to HoYoLAB.

It refuses every host outside HoYoverse's domains (H5), calls nothing but read methods (H6),
and keeps the raw response of every request it makes.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
from dataclasses import replace
from datetime import datetime
from typing import Any, Callable, Literal, Mapping, Sequence
from urllib.parse import urljoin, urlsplit

import aiohttp
import genshin
from genshin.client.components.calculator.calculator import (
    Calculator,
    CharacterResolver,
    TalentResolver,
    WeaponResolver,
)
from genshin.client.manager import managers
from genshin.models.genshin import constants as genshin_constants

from guildboard import netpolicy
from guildboard.gameday import server_tz
from guildboard.pulls.gamecache import MintedLink, minted_link
from guildboard.records import (
    CalcTarget,
    DataSwitchOff,
    FetchResult,
    GameAccount,
    LoginNeeded,
    Offline,
    RateLimited,
    RawResponse,
    SourceError,
    Unexpected,
    VerificationNeeded,
)
from guildboard.sources import hoyolab_normalize as norm
from guildboard.tokenstore import StoredToken, TokenStore

log = logging.getLogger(__name__)

READ_METHODS = frozenset(
    {
        "get_game_accounts",
        "get_partial_genshin_user",
        "get_genshin_notes",
        "get_genshin_characters",
        "get_genshin_detailed_characters",  # character/detail: every owned character's build, read only
        "batch_compute",  # the batch calculator, read only, with explicit levels (see `_batch_compute`)
        "get_genshin_spiral_abyss",
        "get_imaginarium_theater",
        "get_stygian_onslaught",
        "get_genshin_diary",
        "request_ledger",  # the diary's detail log, read only
        "get_genshin_event_calendar",
        "get_reward_info",  # the daily check-in: whether today's is claimed, and how many this month
        "get_monthly_rewards",  # and this month's rewards
    }
)
DETAIL_BATCH = 100  # characters in one detail request: all of an account's, in practice
DIARY_PRIMOGEMS = int(genshin.models.DiaryType.PRIMOGEMS)  # the detail log of primogems, not of Mora
DIARY_DETAIL_PAGE = 100  # entries a page, as genshin's own paginator asks
DIARY_DETAIL_MOST_PAGES = 30  # a month's pages at most

_SWITCH_OFF_RETCODE = 10102

# The livestream codes: HoYoLAB's public guide page for Genshin, read without any login.
LIVESTREAM_URL = "https://bbs-api-os.hoyolab.com/community/painter/wapi/circle/channel/guide/material?game_id=2"
LIVESTREAM_HEADERS = {"x-rpc-app_version": "4.0.0", "x-rpc-client_type": "4", "x-rpc-language": "en-us"}
COOLDOWN_WAIT = 6.0  # seconds before the one retry after HoYoverse says codes are being sent too fast
# What a redeem needs: the cookie token, and one of the two ids that name the account.
_REDEEM_TOKEN = "cookie_token_v2"
_REDEEM_IDS = ("account_id_v2", "account_mid_v2")
# The history keys from the login: the two kinds of key HoYoverse gives, the wish history's and the game's own history
# logs', and the answer codes that say the login itself is refused.
KEY_KINDS = ("webview_gacha", "csc")
GAME_BIZ = "hk4e_global"
_LOGIN_REFUSED = frozenset({-100, 10001, -1071})

# Errors that say something about the connection, the allowlist or HoYoLAB's answer code. Any other
# error raised after an answer has arrived means that the answer itself could not be read.
_NOT_ABOUT_THE_SHAPE = (
    SourceError,
    netpolicy.HostNotAllowed,
    genshin.errors.GenshinException,
    aiohttp.ClientError,
    asyncio.TimeoutError,
    OSError,
)


async def _no_third_party_lookup(*args: Any, **kwargs: Any) -> None:
    """Replaces genshin.py's character-name download, which contacts hosts outside the allowlist."""
    return None


genshin.utility.update_characters_any = _no_third_party_lookup
genshin.utility.extdb.update_characters_any = _no_third_party_lookup
# With the download switched off, the library still needs the language to exist in its name table.
genshin_constants.CHARACTER_NAMES.setdefault("en-us", {})

# The library wraps its request function in retries of its own: seven attempts after "too many
# requests", five after a dropped connection. Whether to try again is decided by the sync rules,
# so the adapter uses the undecorated function and every call sends exactly one request.
_single_request = inspect.unwrap(managers.BaseCookieManager._request)


def guard_trace() -> aiohttp.TraceConfig:
    """An aiohttp trace that stops any request, or redirect, to a host outside HoYoverse's domains."""

    async def on_start(session: Any, context: Any, params: Any) -> None:
        netpolicy.check_hoyoverse(str(params.url))

    async def on_redirect(session: Any, context: Any, params: Any) -> None:
        headers = params.response.headers
        target = headers.get("Location") or headers.get("URI")  # aiohttp follows either header
        if target:
            netpolicy.check_hoyoverse(urljoin(str(params.url), target))

    trace = aiohttp.TraceConfig()
    trace.on_request_start.append(on_start)
    trace.on_request_redirect.append(on_redirect)
    return trace


class GuardedCookies(managers.CookieManager):
    """The library's cookie manager, with the host guard on every session and without hidden retries."""

    def create_session(self, **kwargs: Any) -> aiohttp.ClientSession:
        kwargs["trace_configs"] = [*kwargs.get("trace_configs", []), guard_trace()]
        return super().create_session(**kwargs)

    async def _request(self, *args: Any, **kwargs: Any) -> Any:
        return await _single_request(self, *args, **kwargs)


def endpoint_name(url: str) -> str:
    path = urlsplit(url).path
    marker = "/api/"
    return path.split(marker, 1)[1] if marker in path else path.rsplit("/", 1)[-1]


class RecordingClient(genshin.Client):
    """The library's client. It checks the host before sending and keeps every raw response."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.captured: list[RawResponse] = []

    async def request(self, url: Any, **kwargs: Any) -> Any:
        netpolicy.check_hoyoverse(str(url))
        data = await super().request(url, **kwargs)
        self.captured.append(RawResponse(endpoint_name(str(url)), data))
        return data


def make_client(
    cookies: Mapping[str, str],
    uid: int | None,
    on_cookie_update: Callable[[Mapping[str, str]], None] | None,
) -> RecordingClient:
    client = RecordingClient(
        dict(cookies), uid=uid, game=genshin.Game.GENSHIN, lang="en-us", region=genshin.Region.OVERSEAS
    )
    # The library's constructor sets its logger's level to NOTSET, so that the logger would take the root's, and at
    # DEBUG its lines name every request's address and body. It is set back to what setup_logging sets it to.
    logging.getLogger("genshin").setLevel(logging.WARNING)
    client.cookie_manager = GuardedCookies(dict(cookies))
    client.on_cookie_update = on_cookie_update
    return client


async def _batch_compute(client: Any, targets: Sequence[CalcTarget]) -> Any:
    """Ask HoYoLAB's batch calculator what the targets need, and nothing else. Every level is given explicitly, so the
    library makes no request of its own to find them, and it is the only calculator request there is: its answer says
    whether the player's calculator sync is on, and Guild Board never switches it on."""
    batch = client.batch_calculator()
    for target in targets:
        # The builder takes explicit levels. They are given as the library's resolvers, which the builder's own setters
        # would make, so that no method of the library with a name that suggests a write is called here.
        builder = Calculator(client)
        builder.character = CharacterResolver(target.character_id, target.level[0], target.level[1])
        if target.weapon is not None:
            builder.weapon = WeaponResolver(*target.weapon)
        if target.talents:
            builder.talents = TalentResolver()
            for talent in target.talents:
                builder.talents.add_talent(*talent)
        batch.add_character(builder)
    return await batch.calculate()


async def call(client: Any, method: str, *args: Any, **kwargs: Any) -> Any:
    """Call one of the library's read methods. Anything else is refused (H6)."""
    if method not in READ_METHODS:
        raise Unexpected(f"{method} is not a read method.")
    if method == "batch_compute":
        return await _batch_compute(client, *args, **kwargs)
    return await getattr(client, method)(*args, **kwargs)


async def raw_of(client: Any, method: str, *args: Any, **kwargs: Any) -> Any:
    """The raw response of the request `method` makes, even when the library cannot use it."""
    before = len(client.captured)
    try:
        await call(client, method, *args, **kwargs)
    except _NOT_ABOUT_THE_SHAPE:
        raise
    except Exception as error:
        if len(client.captured) == before:
            raise
        log.warning("the library could not use the answer to %s (%s); reading the raw response", method, type(error).__name__)
    if len(client.captured) == before:
        raise Unexpected(f"{method} returned no data.")
    return client.captured[-1].body


def translate(error: BaseException) -> SourceError:
    """Turn a library or network error into one of Guild Board's source errors. Messages are plain English."""
    if isinstance(error, SourceError):
        return error
    if isinstance(error, netpolicy.HostNotAllowed):
        return Unexpected(f"A request to {error} was blocked.")
    if isinstance(error, genshin.errors.GeetestError):
        return VerificationNeeded("HoYoLAB asked for a verification check.")
    if isinstance(error, genshin.errors.InvalidCookies):
        return LoginNeeded("HoYoLAB no longer accepts the saved login.")
    if isinstance(error, (genshin.errors.VisitsTooFrequently, genshin.errors.TooManyRequests)):
        return RateLimited("HoYoLAB says there were too many requests. Guild Board will try again at the next sync.")
    if isinstance(error, genshin.errors.InternalDatabaseError):
        return Offline("HoYoLAB is not answering properly right now.")
    if isinstance(error, genshin.errors.GenshinException):
        if isinstance(error, genshin.errors.DataNotPublic) or error.retcode == _SWITCH_OFF_RETCODE:
            return DataSwitchOff(
                "HoYoLAB reports that this data is switched off. Turn on the Battle Chronicle and "
                "Real-Time Notes in your HoYoLAB privacy settings."
            )
        return Unexpected(f"HoYoLAB answered with error {error.retcode}.")
    if isinstance(error, (aiohttp.ClientError, asyncio.TimeoutError, OSError)):
        return Offline("HoYoLAB could not be reached.")
    return Unexpected("The sync failed unexpectedly. See the log file.")


def _detail_of(group: str, normalize: Callable[..., Any], *raw: Any) -> Any:
    """A group's detail for the Characters pages, or None. It is kept beside the group's summary and never costs it: when
    the detail cannot be read, the log says so and the summary stays."""
    try:
        return normalize(*raw)
    except Exception as error:
        log.warning("the %s detail could not be read (%s); the summary stays", group, type(error).__name__)
        return None


def _brief(error: BaseException) -> str:
    return " ".join(str(error).split())[:300]


def _explained(doing: str, error: BaseException) -> SourceError:
    """Translate an error. When all the player is told is "unexpected", the original goes to the log."""
    translated = translate(error)
    if type(translated) is Unexpected and translated is not error:
        log.error("%s failed: %s: %s", doing, type(error).__name__, _brief(error), exc_info=error)
    return translated


def redeem_result(error: BaseException) -> str:
    """The result a library error stands for when a code is redeemed: one of the codes module's results. Where the
    library's class is not specific, HoYoverse's own answer code decides."""
    errors = genshin.errors
    if isinstance(error, errors.RedemptionClaimed):
        return "already"
    if isinstance(error, errors.RedeemGameLevelTooLow):
        return "low_ar"
    if isinstance(error, errors.InvalidCookies):
        return "login"
    retcode = getattr(error, "retcode", None)
    if retcode in (-2001, -2006):  # expired, or used as often as it may be
        return "expired"
    if isinstance(error, (errors.RedemptionInvalid, errors.RedemptionRegionLock)) or retcode in (-2003, -2004, -2014):
        return "invalid"
    if retcode in (-2011, -2021):
        return "low_ar"
    if retcode in (-2017, -2018):
        return "already"
    return "failed"


def checkin_result(error: BaseException) -> str:
    """The result a library error stands for when the day's reward is claimed: one of the check-in module's results."""
    errors = genshin.errors
    if isinstance(error, errors.AlreadyClaimed):
        return "already"
    if isinstance(error, (errors.GeetestError, errors.DailyGeetestTriggered)):
        return "verify"  # Guild Board never solves a check: the player claims on HoYoLAB's own page
    if isinstance(error, errors.InvalidCookies):
        return "login"
    return "failed"


def _whole(value: Any) -> int:
    """A count from the guide's JSON, 0 where it is none."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(int(value), 0)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


def _primogems_of(bonus: dict[str, Any]) -> int:
    """The primogems a code of the guide gives: the reward named or drawn as a Primogem, else 0 (the amount could not
    be told). A code's rewards are fields of the code itself or entries of a list inside it."""
    candidates: list[Any] = [bonus]
    for value in bonus.values():
        if isinstance(value, list):
            candidates.extend(value)
    for item in candidates:
        if not isinstance(item, dict):
            continue
        label = " ".join(str(item.get(key, "")) for key in ("name", "icon_bitmap", "icon_url", "icon", "img")).lower()
        if "primogem" in label:
            for key in ("bonus_num", "num", "count", "amount", "quantity"):
                if key in item:
                    return _whole(item[key])
    return 0


def parse_livestream(body: bytes | str) -> list[dict[str, Any]]:
    """The codes of the guide's answer, `{"code", "primogems"}` each. Any other shape gives []: the module is absent
    when no livestream is on."""
    try:
        data = json.loads(body)
        modules = data["data"]["modules"]
        found: list[dict[str, Any]] = []
        for module in modules:
            group = module.get("exchange_group") if isinstance(module, dict) else None
            if not isinstance(group, dict):
                continue
            for bonus in group.get("bonuses") or []:
                if not isinstance(bonus, dict) or str(bonus.get("code_status", "ON")).upper() == "OFF":
                    continue
                code = bonus.get("exchange_code") or bonus.get("code")
                if isinstance(code, str) and code.strip():
                    found.append({"code": code.strip().upper(), "primogems": _primogems_of(bonus)})
        return found
    except (ValueError, KeyError, TypeError, AttributeError):
        log.info("the livestream codes could not be read from HoYoLAB's answer")
        return []


class HoyolabSource:
    def __init__(
        self,
        tokens: TokenStore,
        client_factory: Callable[..., Any] = make_client,
        *,
        fetch: Callable[..., bytes] = netpolicy.fetch_hoyoverse,
        sleep: Callable[[float], Any] = asyncio.sleep,
        mint: Callable[[Mapping[str, str], bytes], bytes] = netpolicy.fetch_authkey,
        calculator_targets: Callable[[], Sequence[CalcTarget]] = lambda: (),
    ) -> None:
        self._tokens = tokens
        self._client_factory = client_factory
        self._fetch = fetch
        self._sleep = sleep
        self._mint = mint
        # What the batch calculator is asked for each focus character (the Characters plan, Task S2): none until then.
        self._calculator_targets = calculator_targets

    def can_mint(self) -> bool:
        """Whether the stored login can be given a history key: it holds the cookie token."""
        token = self._tokens.load()
        return token is not None and _REDEEM_TOKEN in token.cookies

    async def mint_key(self, auth_appid: Literal["webview_gacha", "csc"]) -> MintedLink | None:
        """A read-only key for the logged-in account's wish history ("webview_gacha") or the game's own history logs
        ("csc"), which HoYoverse gives the stored login (netpolicy.fetch_authkey), as a link the importers read with,
        with the account and server it was given for. It lasts about a day. The key is registered as a secret before
        anything else is done with it, held in the link alone (whose repr leaves it out), and never logged, stored or
        returned by the API. None when the login has no cookie token, or the key could not be had; LoginNeeded when
        HoYoverse refuses the login itself."""
        if auth_appid not in KEY_KINDS:
            raise ValueError(f"{auth_appid} is not a kind of history key.")
        token = self._tokens.load()
        if token is None or _REDEEM_TOKEN not in token.cookies:
            return None
        what = "the wish history's key" if auth_appid == "webview_gacha" else "the game history's key"
        body = json.dumps(
            {"game_uid": str(token.uid), "region": token.server, "game_biz": GAME_BIZ, "auth_appid": auth_appid}
        ).encode()
        try:
            raw = await asyncio.to_thread(self._mint, token.cookies, body)
        except Exception as error:
            log.info("HoYoverse could not give %s (%s).", what, netpolicy.what_failed(error))
            return None
        try:
            answer = json.loads(raw)
        except ValueError:
            answer = None
        retcode = answer.get("retcode") if isinstance(answer, dict) else None
        data = answer.get("data") if isinstance(answer, dict) else None
        written = data.get("authkey") if isinstance(data, dict) else None
        if retcode == 0 and isinstance(written, str) and written:
            link = minted_link(written, auth_appid, token.uid, token.server)  # registered as a secret here
            log.info("HoYoverse gave %s for the stored login.", what)
            return link
        # Nothing of the answer but its code is logged: it may repeat the key.
        shown = retcode if isinstance(retcode, int) and not isinstance(retcode, bool) else "missing"
        if retcode in _LOGIN_REFUSED:
            log.warning("HoYoverse refused the stored login when asked for %s (retcode %s).", what, shown)
            raise LoginNeeded("HoYoLAB no longer accepts the saved login.")
        log.warning("HoYoverse did not give %s (retcode %s).", what, shown)
        return None

    async def checkin_status(self) -> dict[str, Any]:
        """The daily check-in as HoYoLAB has it: `claimed_today`, `claimed_days` and this month's `rewards`. Only reads."""
        token = self._tokens.load()
        if token is None:
            raise LoginNeeded("Not logged in to HoYoLAB.")
        client = self._client_factory(token.cookies, token.uid, self._tokens.update_cookies)
        try:
            info = await call(client, "get_reward_info", game=genshin.Game.GENSHIN)
            rewards = await call(client, "get_monthly_rewards", game=genshin.Game.GENSHIN)
        except Exception as error:
            raise _explained("reading the daily check-in", error) from error
        return {
            "claimed_today": bool(info.signed_in),
            "claimed_days": int(info.claimed_rewards),
            "rewards": [{"name": item.name, "amount": item.amount, "icon": item.icon} for item in rewards],
        }

    async def claim_checkin(self) -> str:
        """Claim today's reward and say what came of it (the check-in module's results). This is one of the two requests
        that change anything on the account, beside `redeem`, sent once for each press of Claim and never otherwise. It
        is not tried again: a press that got no answer shows on the next read. The login's values are never logged."""
        token = self._tokens.load()
        if token is None:
            return "login"
        client = self._client_factory(token.cookies, token.uid, self._tokens.update_cookies)
        try:
            await client.claim_daily_reward(game=genshin.Game.GENSHIN, reward=False)
            return "claimed"
        except Exception as error:
            result = checkin_result(error)
            if result != "already":
                log.warning("the daily check-in was not claimed (%s, %s: %s)", result, type(error).__name__, _brief(error))
            return result

    async def redeem(self, code: str) -> str:
        """Redeem one gift code for the logged-in account and say what came of it (the codes module's results). This is
        one of the two requests that change anything on the account, beside `claim_checkin`, and the core sends it only
        for a code the player typed, pasted or clicked. The login's values are never logged."""
        token = self._tokens.load()
        if token is None or _REDEEM_TOKEN not in token.cookies or not any(n in token.cookies for n in _REDEEM_IDS):
            return "login"
        # The cookies an answer sets go to the store with the login the client was made with (TokenStore.update_cookies).
        client = self._client_factory(
            token.cookies, token.uid, lambda cookies: self._tokens.update_cookies(cookies, since=token)
        )
        for attempt in (1, 2):
            try:
                await client.redeem_code(code, token.uid, game=genshin.Game.GENSHIN)
                return "redeemed"
            except genshin.errors.RedemptionCooldown:
                if attempt == 1:
                    await self._sleep(COOLDOWN_WAIT)
                    continue
                return "failed"
            except Exception as error:
                result = redeem_result(error)
                if result == "login":
                    # HoYoverse's own answer says whether the login or something else was refused; the cookies are
                    # never part of it.
                    log.warning(
                        "a gift code was refused for the login (%s, retcode %s: %s)",
                        type(error).__name__, getattr(error, "retcode", None), _brief(error),
                    )
                if result == "failed":
                    log.warning("a gift code could not be redeemed (%s: %s)", type(error).__name__, _brief(error))
                return result
        return "failed"

    async def livestream_codes(self) -> list[dict[str, Any]]:
        """The codes HoYoLAB's guide lists now, `{"code", "primogems"}` each. Public: no login is sent."""
        body = await asyncio.to_thread(self._fetch, LIVESTREAM_URL, headers=LIVESTREAM_HEADERS)
        return parse_livestream(body)

    async def list_accounts(self, cookies: Mapping[str, str]) -> list[GameAccount]:
        client = self._client_factory(cookies, None, None)
        try:
            raw = await raw_of(client, "get_game_accounts")
        except Exception as error:
            raise _explained("reading the game accounts", error) from error
        return norm.normalize_accounts(raw)

    async def fetch(self, group: str, *, now: datetime, first_time: bool = False) -> FetchResult:
        token = self._tokens.load()
        if token is None:
            raise LoginNeeded("Not logged in to HoYoLAB.")
        # The cookies an answer sets go to the store with the login the client was made with (TokenStore.update_cookies).
        client = self._client_factory(
            token.cookies, token.uid, lambda cookies: self._tokens.update_cookies(cookies, since=token)
        )
        try:
            build = await getattr(self, f"_{group}")(client, token, now, first_time)
        except _NOT_ABOUT_THE_SHAPE as error:
            raise _explained(f"fetching the {group} data", error) from error
        except Exception as error:
            if not client.captured:
                raise _explained(f"fetching the {group} data", error) from error
            return self._unreadable(group, now, client, error)
        try:
            record = build()
        except Exception as error:
            return self._unreadable(group, now, client, error)
        return FetchResult(group, now, tuple(client.captured), record)

    @staticmethod
    def _unreadable(group: str, now: datetime, client: Any, error: BaseException) -> FetchResult:
        """An answer arrived and could not be read. It is kept, so nothing is thrown away."""
        log.warning("the %s data could not be read (%s: %s)", group, type(error).__name__, _brief(error))
        problem = f"HoYoLAB's {group} data has an unexpected shape."
        return FetchResult(group, now, tuple(client.captured), None, problem)

    # Each of these makes the requests for one group and returns a function that builds the record.

    async def _overview(self, client: Any, token: StoredToken, now: datetime, first_time: bool) -> Callable[[], Any]:
        raw = await raw_of(client, "get_partial_genshin_user", token.uid)
        return lambda: norm.normalize_overview(raw)

    async def _notes(self, client: Any, token: StoredToken, now: datetime, first_time: bool) -> Callable[[], Any]:
        raw = await call(client, "get_genshin_notes", token.uid, autoauth=False, return_raw_data=True)
        return lambda: norm.normalize_notes(raw, now)

    async def _characters(self, client: Any, token: StoredToken, now: datetime, first_time: bool) -> Callable[[], Any]:
        raw = await raw_of(client, "get_genshin_characters", token.uid)
        # The details of every owned character follow the list, which names them. They come back raw, so that the
        # library's own parse can never lose an answer that was received.
        owned = raw.get("list") if isinstance(raw, Mapping) else None
        if not isinstance(owned, list):
            raise ValueError("the character list is missing")
        ids = [norm.character_id(item) for item in owned if isinstance(item, Mapping)]
        ids = [ident for ident in ids if ident is not None]
        details = [
            await call(
                client, "get_genshin_detailed_characters", token.uid,
                characters=ids[start:start + DETAIL_BATCH], return_raw_data=True,
            )
            for start in range(0, len(ids), DETAIL_BATCH)
        ]

        calculation = await self._calculation(client, token)

        def build() -> Any:
            record = norm.normalize_characters(raw)
            builds = norm.normalize_builds(norm.merge_details(details))
            return replace(record, builds=builds, calculator=self._calculator_record(calculation))

        return build

    async def _calculation(self, client: Any, token: StoredToken) -> tuple[Any, tuple[CalcTarget, ...]] | None:
        """The batch calculator's raw answer for the focus characters, with what was asked, or None: when there is no
        focus there is no request. It helps the pages and never costs them the builds: when it cannot be had, the log
        says what kind of failure it was (never what the answer said) and the builds stay. A verification check, a
        refused login, too many requests or a blocked address stops the run, as it would from any other read."""
        targets = tuple(self._calculator_targets())
        if not targets:
            return None
        try:
            return await raw_of(client, "batch_compute", targets), targets
        except Exception as error:
            if isinstance(error, netpolicy.HostNotAllowed) or isinstance(
                translate(error), (VerificationNeeded, LoginNeeded, RateLimited)
            ):
                raise
            log.warning("the calculator could not be read (%s); the builds stay", type(error).__name__)
            return None

    @staticmethod
    def _calculator_record(calculation: tuple[Any, tuple[CalcTarget, ...]] | None) -> Any:
        if calculation is None:
            return None
        try:
            return norm.normalize_calculator(*calculation)
        except Exception as error:
            log.warning("the calculator's answer could not be read (%s); the builds stay", type(error).__name__)
            return None

    async def _endgame(self, client: Any, token: StoredToken, now: datetime, first_time: bool) -> Callable[[], Any]:
        abyss = await call(client, "get_genshin_spiral_abyss", token.uid, raw=True)
        theater = await call(client, "get_imaginarium_theater", token.uid, raw=True)
        stygian = await call(client, "get_stygian_onslaught", token.uid, raw=True)
        return lambda: replace(
            norm.normalize_endgame(abyss, theater, stygian),
            detail=_detail_of("endgame", norm.normalize_endgame_detail, abyss, theater, stygian),
        )

    async def _diary(self, client: Any, token: StoredToken, now: datetime, first_time: bool) -> Callable[[], Any]:
        today = now.astimezone(server_tz(token.server)).date()
        months = [(today.month - 1 - back) % 12 + 1 for back in range(3 if first_time else 2)]
        raws = [await raw_of(client, "get_genshin_diary", token.uid, month=month) for month in months]
        pages = await self._diary_detail(client, token, months)
        return lambda: norm.normalize_diary(
            raws, today, norm.normalize_diary_entries(pages, server_tz(token.server)), token.uid
        )

    async def _diary_detail(self, client: Any, token: StoredToken, months: list[int]) -> list[Any]:
        """The diary's detail log of primogems for the same months (the ledger design, section 0): every income entry
        with its time, what gave it and how many. It helps the month totals and never costs them: when it cannot be
        read, the log says why and the totals stay."""
        pages: list[Any] = []
        try:
            for month in months:
                for page in range(1, DIARY_DETAIL_MOST_PAGES + 1):
                    raw = await raw_of(
                        client, "request_ledger", token.uid, game=genshin.Game.GENSHIN, detail=True, month=month,
                        params={"type": DIARY_PRIMOGEMS, "current_page": page, "page_size": DIARY_DETAIL_PAGE},
                    )
                    pages.append(raw)
                    listed = raw.get("list") if isinstance(raw, Mapping) else None
                    if not isinstance(listed, list) or len(listed) < DIARY_DETAIL_PAGE:
                        break
        except Exception as error:
            log.warning("the diary's detail could not be read (%s); the month totals stay", type(error).__name__)
        return pages

    async def _calendar(self, client: Any, token: StoredToken, now: datetime, first_time: bool) -> Callable[[], Any]:
        raw = await raw_of(client, "get_genshin_event_calendar", token.uid)
        return lambda: replace(
            norm.normalize_calendar(raw), detail=_detail_of("calendar", norm.normalize_calendar_detail, raw)
        )
