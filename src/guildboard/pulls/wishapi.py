"""HoYoverse's wish history, one page at a time (the Pulls design, sections 2 and 4).

A page is asked for with every parameter of the link the game cached, the key and its version among them, as the game's
own Wish → History page asks for it; only the language, the wish type, the page's size and the last record already read
are set here. The answer comes newest first, 20 records a page.

The link's key opens the player's history for about a day, and it is treated as the HoYoLAB token is (H4): it goes only
to HISTORY_URL, through netpolicy, and never into an error, a log line or an answer. The reads of the game's cache
registered it as a secret, so that the log masks it should it ever be written; nothing here writes it. An error's text
is the sentence the player sees, and the log says what happened without the address that holds the key.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone, tzinfo
from typing import Any, Callable
from urllib.parse import urlencode

from guildboard import netpolicy
from guildboard.gameday import server_tz
from guildboard.pulls import POOL_OF
from guildboard.pulls.gamecache import WishLink
from guildboard.store import WishRow

log = logging.getLogger(__name__)

# The history of every overseas server, Europe's included.
HISTORY_URL = "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog"
PAGE_SIZE = 20  # the records a page holds; a page with fewer is a wish type's last
PAUSE_SECONDS = 0.5  # between two requests of an import
DEFAULT_REGION = "os_euro"  # whose server time a record's time is in, when the link names no region it knows
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"  # a record's time, in its server's time: "2026-10-12 21:14:03"
WHOLE = re.compile(r"[0-9]{1,19}")
LARGEST_ID = 2**63 - 1  # what the database keeps as a whole number

KEY_SENTENCE = "Open Wish → History in the game, then press Import again."


class WishApiError(Exception):
    """A page could not be had. Its text is the sentence the player sees, and nothing else."""

    sentence = "The import failed unexpectedly. See the log file."

    def __init__(self) -> None:
        super().__init__(self.sentence)


class KeyExpired(WishApiError):
    """HoYoverse says the link's key is older than it accepts (-101)."""

    sentence = KEY_SENTENCE


class KeyInvalid(WishApiError):
    """HoYoverse does not accept the link's key (-100)."""

    sentence = KEY_SENTENCE


class TooFrequent(WishApiError):
    """HoYoverse says there were too many requests (-110)."""

    sentence = "HoYoverse says there were too many requests. Wait a minute, then press Import again."


class Offline(WishApiError):
    """HoYoverse could not be reached, or the connection broke."""

    sentence = "HoYoverse could not be reached. Check the connection and try again."


class Unexpected(WishApiError):
    """Any other answer code, or an answer of a shape this cannot read. The log says which."""


ANSWER_ERRORS: dict[int, type[WishApiError]] = {-100: KeyInvalid, -101: KeyExpired, -110: TooFrequent}


@dataclass(frozen=True)
class Page:
    rows: tuple[WishRow, ...]  # newest first; each with import_id 0, which the importer fills


def page_url(link: WishLink, gacha_type: str, end_id: str) -> str:
    """The history's address for one page of a wish type: every parameter of the link, in English, and the records
    older than `end_id` ("0" for the newest)."""
    query = dict(link.query)
    query.update(lang="en-us", gacha_type=gacha_type, size=str(PAGE_SIZE), end_id=end_id)
    return f"{HISTORY_URL}?{urlencode(query)}"


def _server_time(link: WishLink) -> tzinfo:
    """The time zone of the server the link is for: its records' times are in it."""
    try:
        return server_tz(link.query.get("region") or DEFAULT_REGION)
    except ValueError:  # a region Guild Board does not know
        return server_tz(DEFAULT_REGION)


def _whole(value: Any) -> int | None:
    """A record's id or uid: digits that the database can keep as a whole number."""
    if not isinstance(value, str) or not WHOLE.fullmatch(value) or int(value) > LARGEST_ID:
        return None
    return int(value)


def _row(record: Any, pool: str, server: tzinfo) -> WishRow | None:
    """One record as the store keeps it; None when it is not a record this can read."""
    if not isinstance(record, dict):
        return None
    wish_id, uid = _whole(record.get("id")), _whole(record.get("uid"))
    gacha_type, name, item_type = record.get("gacha_type"), record.get("name"), record.get("item_type")
    rank, time = record.get("rank_type"), record.get("time")
    texts = (gacha_type, name, item_type, time)
    if wish_id is None or uid is None or not all(isinstance(text, str) and text for text in texts):
        return None
    if rank not in ("3", "4", "5"):
        return None
    try:
        moment = datetime.strptime(time, TIME_FORMAT)
    except ValueError:
        return None
    return WishRow(
        id=wish_id, uid=uid, gacha_type=gacha_type, pool=POOL_OF.get(gacha_type, pool), name=name,
        item_type=item_type, rank=int(rank), time=time,
        at=moment.replace(tzinfo=server).astimezone(timezone.utc), import_id=0,
    )


def _cut_short(error: ValueError) -> bool:
    """Whether an answer that cannot be read stops short, as one does when the connection drops in its middle: its JSON
    ends inside a string or before it is whole, or its text in the middle of a character. An answer that is whole and
    still not JSON (a page of HTML, say) is not."""
    if isinstance(error, UnicodeDecodeError):
        return error.reason == "unexpected end of data"
    if isinstance(error, json.JSONDecodeError):
        return error.msg.startswith("Unterminated string") or error.pos >= len(error.doc.rstrip())
    return False


def _read(body: bytes, link: WishLink, gacha_type: str, pool: str) -> Page | WishApiError:
    """The page an answer holds, or the error it means. Nothing of the answer's own text is logged: HoYoverse may repeat
    the key in it, and a cut copy of the key would not be masked."""
    try:
        answer = json.loads(body)
    except ValueError as error:  # not JSON, or not text at all
        if _cut_short(error):
            log.warning("HoYoverse's wish history answer for wish type %s was cut short.", gacha_type)
            return Offline()
        answer = None
    if not isinstance(answer, dict):
        log.warning("HoYoverse's wish history gave an answer that is not JSON, for wish type %s.", gacha_type)
        return Unexpected()
    retcode = answer.get("retcode")
    whole = isinstance(retcode, int) and not isinstance(retcode, bool)
    if whole and retcode in ANSWER_ERRORS:
        log.info("HoYoverse's wish history answered retcode %s for wish type %s.", retcode, gacha_type)
        return ANSWER_ERRORS[retcode]()
    if not whole or retcode != 0:
        shown = retcode if whole else f"of the kind {type(retcode).__name__}"
        log.warning("HoYoverse's wish history answered retcode %s for wish type %s.", shown, gacha_type)
        return Unexpected()
    data = answer.get("data")
    records = data.get("list") if isinstance(data, dict) else None
    if not isinstance(records, list):
        log.warning("HoYoverse's wish history gave a page without its list, for wish type %s.", gacha_type)
        return Unexpected()
    server = _server_time(link)
    rows = [_row(record, pool, server) for record in records]
    if any(row is None for row in rows):
        log.warning("HoYoverse's wish history gave a record Guild Board cannot read, for wish type %s.", gacha_type)
        return Unexpected()
    return Page(tuple(sorted(rows, key=lambda row: row.id, reverse=True)))


def history_fetch(url: str) -> bytes:
    """The history's own read: through netpolicy, and following no redirect, as the key goes to HISTORY_URL alone."""
    return netpolicy.fetch_hoyoverse(url, follow_redirects=False)


def fetch_page(
    link: WishLink,
    gacha_type: str,
    end_id: str,
    pool: str,
    fetch: Callable[[str], bytes] = history_fetch,
) -> Page:
    """One page of a wish type's history: the records older than `end_id`, newest first. A record of a type outside
    the six is counted in `pool`, the pool of the type asked for. Raises a WishApiError, whose text is the sentence the
    player sees; a failure of the connection, or an answer it cut short, is Offline."""
    try:
        body = fetch(page_url(link, gacha_type, end_id))
    except OSError as error:  # the connection, and HoYoverse's server answering with an HTTP error
        log.warning(
            "HoYoverse's wish history could not be reached for wish type %s (%s).",
            gacha_type, netpolicy.what_failed(error),
        )
        problem: WishApiError = Offline()
    except Exception as error:  # an answer larger than allowed, or a redirect, which the history never follows
        log.warning(
            "HoYoverse's wish history could not be read for wish type %s (%s).", gacha_type, netpolicy.what_failed(error)
        )
        problem = Unexpected()
    else:
        read = _read(body, link, gacha_type, pool)
        if isinstance(read, Page):
            return read
        problem = read
    # Raised here, after the failure was handled, so that the error carries nothing of the failure: no address, and so
    # no key, stays with it.
    raise problem
