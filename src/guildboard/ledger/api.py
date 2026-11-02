"""The game's own history logs, one page at a time (the ledger design, sections 0 and 4).

A page is asked for with every parameter of the self-service link the game wrote when the player opened Feedback, its
key among them, as the game's own history page asks for it; only the key's version, the sign type, the language, the
page's size and the last entry already read are set here. The answer comes newest first, 20 entries a page.

The link's key is treated as the wish key is (H4): it goes only to LEDGER_URL's logs and GetUserInfo, through
netpolicy, following no redirect, and never into an error, a log line or an answer. Nothing of HoYoverse's answer is
logged, as it may repeat the key. An error's text is the sentence the player sees, and it is raised after the failure
is handled, so that it carries no address.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, tzinfo
from typing import Any, Callable
from urllib.parse import urlencode

from guildboard import netpolicy
from guildboard.gameday import server_tz
from guildboard.ledger import LEDGER_URL, endpoint
from guildboard.pulls.gamecache import KEY_VERSION, WishLink
from guildboard.pulls.wishapi import (
    DEFAULT_REGION, LARGEST_ID, PAGE_SIZE, TIME_FORMAT, WHOLE, KeyExpired, KeyInvalid, Offline, TooFrequent,
    Unexpected, WishApiError,
)
from guildboard.store import LedgerRow

log = logging.getLogger(__name__)

USER_INFO = "GetUserInfo"  # names the account a key belongs to

NO_LEDGER_LINK = (
    "To read your primogem, crystal, resin and artifact history, open Feedback from the Paimon menu in the game once, "
    "then press Import again. Guild Board only reads it."
)
LEDGER_EXPIRED = "The history link from Feedback has expired. Open Feedback in the game again, then press Import."
LEDGER_REFUSED = "The history link from Feedback was not accepted. Open Feedback in the game again, then press Import."


class LedgerKeyExpired(KeyExpired):
    """HoYoverse says the self-service key timed out."""

    sentence = LEDGER_EXPIRED


class LedgerKeyInvalid(KeyInvalid):
    """HoYoverse does not accept the self-service key."""

    sentence = LEDGER_REFUSED


# "auth key time out" is HoYoverse's own answer to an old key (the check with the player, 2026-10-27).
_TIMED_OUT = ("time out", "timeout", "timed out", "expire")


@dataclass(frozen=True)
class LedgerPage:
    rows: tuple[LedgerRow, ...]  # newest first


def _url(link: WishLink, name: str, **more: str) -> str:
    query = dict(link.query)
    query.update({KEY_VERSION: "1"}, sign_type="2", lang="en", **more)
    return f"{LEDGER_URL}{name}?{urlencode(query)}"


def entry_url(link: WishLink, kind: str, end_id: str) -> str:
    """A log's address for one page: every parameter of the link, in English, the entries older than `end_id`."""
    return _url(link, endpoint(kind), size=str(PAGE_SIZE), end_id=end_id)


def user_url(link: WishLink) -> str:
    """The address that names the account the link's key belongs to."""
    return _url(link, USER_INFO)


def ledger_fetch(url: str) -> bytes:
    """The logs' own read: through netpolicy, following no redirect, as the key goes to the logs alone."""
    return netpolicy.fetch_hoyoverse(url, follow_redirects=False)


def _refused(retcode: int, message: Any) -> WishApiError:
    """The error a refusal means. The message is only looked at, never kept or logged."""
    if retcode == -101:
        return LedgerKeyExpired()
    if retcode == -110:
        return TooFrequent()
    if retcode == -1 and isinstance(message, str) and any(word in message.casefold() for word in _TIMED_OUT):
        return LedgerKeyExpired()
    if retcode in (-1, -100):
        return LedgerKeyInvalid()
    return Unexpected()


def _data(body: bytes, what: str) -> Any:
    """The answer's data, or the error it means."""
    try:
        answer = json.loads(body)
    except ValueError:
        answer = None
    if not isinstance(answer, dict):
        log.warning("HoYoverse's %s gave an answer that is not JSON.", what)
        return Unexpected()
    retcode = answer.get("retcode")
    if not isinstance(retcode, int) or isinstance(retcode, bool):
        log.warning("HoYoverse's %s gave an answer without its code.", what)
        return Unexpected()
    if retcode != 0:
        log.info("HoYoverse's %s answered retcode %s.", what, retcode)
        return _refused(retcode, answer.get("message"))
    return answer.get("data")


def _whole(value: Any) -> int | None:
    text = str(value) if isinstance(value, (str, int)) and not isinstance(value, bool) else ""
    if not WHOLE.fullmatch(text) or int(text) > LARGEST_ID:
        return None
    return int(text)


def _signed(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    try:
        return int(str(value).strip())
    except ValueError:
        return None


def _server_time(link: WishLink, region: str | None) -> tzinfo:
    for name in (region, link.query.get("region"), DEFAULT_REGION):
        if name:
            try:
                return server_tz(name)
            except ValueError:  # a region Guild Board does not know
                continue
    return server_tz(DEFAULT_REGION)


def _row(record: Any, kind: str, uid: int, server: tzinfo) -> LedgerRow | None:
    if not isinstance(record, dict):
        return None
    entry_id, amount = _whole(record.get("id")), _signed(record.get("add_num"))
    time, reason = record.get("datetime"), record.get("reason")
    if entry_id is None or amount is None or not isinstance(time, str) or not isinstance(reason, str):
        return None
    try:
        moment = datetime.strptime(time, TIME_FORMAT)
    except ValueError:
        return None
    name = record.get("name")
    rarity = _whole(record.get("quality")) or 0
    return LedgerRow(
        uid, kind, entry_id, time, moment.replace(tzinfo=server).astimezone(timezone.utc), amount, reason,
        name if isinstance(name, str) else "", rarity if rarity <= 5 else 0,
    )


def _ask(url: str, what: str, fetch: Callable[[str], bytes]) -> bytes:
    """The answer's body, or the error of the connection; raised after it is handled, carrying no address."""
    try:
        return fetch(url)
    except OSError as error:  # the connection, and HoYoverse's server answering with an HTTP error
        log.warning("HoYoverse's %s could not be reached (%s).", what, netpolicy.what_failed(error))
        problem: WishApiError = Offline()
    except Exception as error:  # an answer larger than allowed, or a redirect, which the logs never follow
        log.warning("HoYoverse's %s could not be read (%s).", what, netpolicy.what_failed(error))
        problem = Unexpected()
    raise problem


def fetch_page(
    link: WishLink, kind: str, end_id: str, uid: int, fetch: Callable[[str], bytes] = ledger_fetch,
    region: str | None = None,
) -> LedgerPage:
    """One page of a kind's log: the entries older than `end_id`, newest first, kept for `uid`, their times in the
    server time of `region` (else the link's, else Europe's). Raises a WishApiError whose text is the player's
    sentence."""
    what = f"{kind} history"
    data = _data(_ask(entry_url(link, kind, end_id), what, fetch), what)
    if isinstance(data, WishApiError):
        raise data
    records = data.get("list") if isinstance(data, dict) else None
    if not isinstance(records, list):
        log.warning("HoYoverse's %s gave a page without its list.", what)
        raise Unexpected()
    server = _server_time(link, region)
    rows = [_row(record, kind, uid, server) for record in records]
    if any(row is None for row in rows):
        log.warning("HoYoverse's %s gave an entry Guild Board cannot read.", what)
        raise Unexpected()
    return LedgerPage(tuple(sorted(rows, key=lambda row: row.id, reverse=True)))  # type: ignore[arg-type, union-attr]


def fetch_user(link: WishLink, fetch: Callable[[str], bytes] = ledger_fetch) -> tuple[int, str]:
    """The account the link's key belongs to, and its server's region (Europe's when it names none it knows)."""
    what = "account of the history link"
    data = _data(_ask(user_url(link), what, fetch), what)
    if isinstance(data, WishApiError):
        raise data
    uid = _whole(data.get("uid")) if isinstance(data, dict) else None
    if uid is None:
        log.warning("HoYoverse's %s did not name the account.", what)
        raise Unexpected()
    region = data.get("region")
    try:
        server_tz(region)
    except (ValueError, TypeError):
        region = DEFAULT_REGION
    return uid, region
