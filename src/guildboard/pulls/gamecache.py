r"""The two reads of the game's own files that give the wish-history links (the Pulls design, section 4).

Only when the player presses Import, Guild Board reads two files of the game's, each read-only, and nothing else in the
game's folders:

- the game's log, %USERPROFILE%\AppData\LocalLow\miHoYo\Genshin Impact\output_log.txt, from which it takes only the path
  of the game's data folder;
- the web cache in that folder, webCaches\<version>\Cache\Cache_Data\data_2, from which it takes only the wish-history
  links.

The same two reads also give the self-service links (auth_appid=csc) that the game writes into its log, and its cache,
when the player opens Feedback from the Paimon menu: their key opens the game's own history logs (the ledger design,
section 0). They are found, registered and held exactly as the wish links are.

Nothing is written, copied or moved there. Finding the newest version folder lists one folder, webCaches, and asks for
the time and the size of a file, which opens none. The two files are the only ones opened, and the test of this module
pins that. While the game runs, its browser engine holds the web cache open with the right to delete it, and so refuses
an open that does not share deleting, as Python's own open does not; each of the two is opened with the right to read
it alone, sharing reading, writing and deleting with the game (found at the check with the player, 2026-10-24).

The browser engine's disk cache reuses freed space, so the newest link is not always the last in data_2: it can lie
early in the file, with older links after it. Here they are found one for each key, the last in the file first, as
Paimon.moe's script tries them, and the importer tries every one in that order until one answers. A link's `timestamp`
parameter is not when it was made: at the check with the player the link that answered had an earlier one than five
that were too old, and lay furthest into the file of them.

A link holds a key, `authkey`, that opens the player's wish history for about a day. It is treated as the HoYoLAB
token is: never written to the database or returned by the local API; held in memory, never on disk: for the import
and, when the import ended well, for up to a day after it, to import the new wishes with it (the second pass design,
section 5). Those later imports read no file: these two reads are made on the press alone. From the moment a link is
first tried until it is let go, its key is registered with logging_setup, as the link writes it, decoded and encoded
again, so that no log carries it (register_key, forget_key); a link that is found and never tried is never
registered, so that the log's mask holds the keys in use and no more.
"""
from __future__ import annotations

import _winapi
import errno
import logging
import msvcrt
import os
import re
import stat
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import BinaryIO, Callable, TypeVar
from urllib.parse import quote, quote_plus, unquote

from guildboard.logging_setup import forget_secret, register_secret

log = logging.getLogger(__name__)
_Content = TypeVar("_Content")

MAX_LOG_BYTES = 50_000_000
MAX_CACHE_BYTES = 200_000_000

# The link's parameters that make it the wish-history link with a key: the key, and the version of the key. The second
# name is put together, not written whole: tests/test_handsoff.py looks in every source file, whatever the case, for the
# start of the registry's root names, and the whole name holds the same letters.
KEY = "authkey"
KEY_VERSION = KEY + "_ver"

# The first path in the log that ends in a data folder's name: a drive letter, then anything but the end of the line, a
# quote, an angle bracket or a pipe, as far as the name of the folder of either client.
DATA_FOLDER = re.compile(r'[A-Za-z]:[/\\][^\r\n"<>|]*?(?:GenshinImpact_Data|YuanShen_Data)')
# A run of printable ASCII from "https://" on. The cache is read as bytes; a latin-1 text of them holds the same runs,
# as no byte above 0x7e is printable ASCII.
LINK_RUN = re.compile(rb"https://[\x21-\x7e]+")

# What the player is told, when the link cannot be had.
LOG_MISSING = (
    "The game's log was not found at {path}. Start the game once, open Wish → History, then press Import again."
)
NO_DATA_FOLDER = (
    "The game's log does not name its data folder. Open Wish → History in the game, then press Import again."
)
NO_CACHE = "The game's web cache was not found. Open Wish → History in the game, then press Import again."
HELD_OPEN = "Close the game, then press Import again. The link from Wish → History stays valid for a day."
NO_LINK = "Open Wish → History in the game, then press Import again."
TOO_LARGE = "The game's cache file is larger than Guild Board reads. See the log file."

# Windows' own numbers for a file that another program holds: a sharing violation and a lock violation.
HELD_BY_ANOTHER_PROGRAM = (32, 33)
# How the two files are opened: with the right to read alone, sharing reading, writing and deleting with the program
# that holds them, and only if they are there.
READ_ONLY = 0x80000000  # GENERIC_READ
SHARED_WITH_THE_GAME = 0x1 | 0x2 | 0x4  # FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
OPEN_EXISTING = 3
# A link (a symbolic link or a junction: a reparse point that names another place) is opened as itself, never as what it
# points at, and is refused: what it points at may be another of the game's files, or one on another computer. A reparse
# point that names no other place, as a OneDrive placeholder's and a deduplicated file's, is the file itself and is read.
# Only the last part of a path is looked at: a junction in a folder above the file is followed, as the game's own folders
# are where the player or the launcher put them.
OPEN_THE_LINK_ITSELF = 0x00200000  # FILE_FLAG_OPEN_REPARSE_POINT
A_REPARSE_POINT = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT
NAMES_ANOTHER_PLACE = 0x20000000  # bit 29 of a reparse point's tag, the name-surrogate bit: set for a link and a junction


@dataclass(frozen=True)
class WishLink:
    url: str = field(repr=False)  # the whole link as cached, with its query; the key is in it, so repr leaves it out
    query: dict[str, str] = field(repr=False)  # its parameters, decoded; "authkey" among them
    cache_path: Path  # the data_2 it came from
    at: int = 0  # where it starts in the cache's bytes, which the log of an import names in place of the link


class CacheProblem(Exception):
    """The link could not be read; the message is the sentence the player sees."""


def log_path() -> Path:
    """The game's log, under the player's profile folder."""
    home = os.environ.get("USERPROFILE")
    return (Path(home) if home else Path.home()).joinpath(
        "AppData", "LocalLow", "miHoYo", "Genshin Impact", "output_log.txt"
    )


def data_folder(log_text: str) -> Path | None:
    """The game's data folder, as the first path in the log that ends in its name; None when the log names none, or names
    one through "..", which climbs out of where the path says it is."""
    found = DATA_FOLDER.search(log_text)
    if found is None:
        return None
    folder = Path(found.group(0))
    return None if ".." in folder.parts else folder


def cache_file(data_folder: Path) -> Path | None:
    """The web cache file of the version folder whose data_2 was written last; None when there is none. What cannot be
    looked into is logged by the error's type, and answered as a web cache that is not there."""
    caches = data_folder / "webCaches"
    try:
        versions = list(caches.iterdir())
    except OSError as problem:
        if not isinstance(problem, (FileNotFoundError, NotADirectoryError)):
            log.warning("The game's web caches at %s could not be listed (%s).", caches, type(problem).__name__)
        return None
    newest: tuple[int, str, Path] | None = None
    for version in versions:
        candidate = version / "Cache" / "Cache_Data" / "data_2"
        try:
            info = candidate.lstat()  # a link's own, never what it points at: a link is no web cache
        except (FileNotFoundError, NotADirectoryError):  # no such file in this folder
            continue
        except OSError as problem:
            log.warning("The web cache file %s could not be looked at (%s).", candidate, type(problem).__name__)
            continue
        if not stat.S_ISREG(info.st_mode):
            continue
        if newest is None or (info.st_mtime_ns, version.name) > newest[:2]:
            newest = (info.st_mtime_ns, version.name, candidate)
    return newest[2] if newest is not None else None


def _query(url: str) -> tuple[dict[str, str], dict[str, str]]:
    """A link's parameters, decoded and as the link writes them."""
    decoded: dict[str, str] = {}
    written: dict[str, str] = {}
    for part in url.partition("?")[2].partition("#")[0].split("&"):
        name, _, value = part.partition("=")
        if name:
            decoded[unquote(name)] = unquote(value)
            written[unquote(name)] = value
    return decoded, written


def _key_forms(link: WishLink) -> tuple[str, ...]:
    """Each form a link's key may be seen in, once: as the link writes it, decoded, and encoded again."""
    key = link.query.get(KEY, "")
    written = _query(link.url)[1].get(KEY, key)
    return tuple(dict.fromkeys(form for form in (written, key, quote(key, safe=""), quote_plus(key)) if form))


def register_key(link: WishLink) -> None:
    """Mask the link's key in the log, in each form it may be seen in, from now until forget_key: done before the
    link's first request, by whatever holds it from then on."""
    for form in _key_forms(link):
        register_secret(form)


def forget_key(link: WishLink) -> None:
    """The holder of a link lets it go: once no holder has it, its key is masked no more."""
    forget_secret(*_key_forms(link))


@dataclass(frozen=True)
class MintedLink:
    """A key HoYoverse gave the HoYoLAB login, as a link, with the account and server it was given for: what it reads is
    that account's, whatever login is stored by the time it is read with. The link's repr leaves the key out."""

    link: WishLink
    uid: int
    region: str


def minted_link(written: str, auth_appid: str, uid: int, region: str) -> MintedLink:
    """A link for a key HoYoverse gave the HoYoLAB login (sources/hoyolab.py's mint_key), with the parameters the game's
    own link carries beside it: the key decoded, its version, the sign type, the kind of key, the account's server and
    the overseas game. No file is read for it, and it is held as the game's links are, in memory alone. `written` is the
    key as HoYoverse's answer writes it, URL-encoded. No page holds such a key, so the link's address is its key alone,
    as written, from which its forms are read as a game's link's are. It is registered as a secret before the link is
    returned: the link is used at once, and whatever keeps it forgets it with forget_key."""
    key = unquote(written)
    query = {
        KEY: key, KEY_VERSION: "1", "sign_type": "2", "auth_appid": auth_appid, "region": region,
        "game_biz": "hk4e_global",
    }
    link = WishLink(f"?{KEY}={written}", query, Path())
    register_key(link)
    return MintedLink(link, uid, region)


def made_at(link: WishLink) -> int | None:
    """The time a link's `timestamp` parameter names, in seconds, for the log of an import; None when it has none that
    reads as one. It is not when the link was made (see the module's text), so the links are not ordered by it."""
    text = link.query.get("timestamp", "")
    if not (text.isascii() and text.isdigit()):
        return None
    try:
        return int(text)
    except ValueError:  # more digits than Python reads as a number: no time of the game's
        return None


def _candidates(data: bytes, page: bytes) -> list[tuple[int, str]]:
    """The runs of printable ASCII from "https://" on in `data` that could be links of `page`'s kind, as they hold the
    page's name and the key's, each with where it starts, the last in the data first. The runs are looked at one at a
    time and only these are kept: a cache can hold millions of runs, and a list of them all held hundreds of megabytes."""
    key = KEY.encode("ascii")
    found = []
    for run in LINK_RUN.finditer(data):
        text = run.group(0)
        if page in text and key in text:
            found.append((run.start(), text.decode("ascii")))
    found.reverse()
    return found


def links(cache_bytes: bytes) -> list[WishLink]:
    """Every wish-history link in the cache's bytes, one for each key, the last in the file first.

    A link is a run of printable ASCII from "https://" on whose auth_appid is the wish history's, webview_gacha, and whose
    query holds the key and its version; a link that only names webview_gacha elsewhere, as a Feedback link may, is none,
    as a Feedback key goes to the game's history logs alone. A key seen more than once keeps its copy nearest the end of
    the file, as it was written last; the copies only differ in the request they were made for. No key is registered as
    a secret here: the importer does that before a link's first request (register_key). `cache_path` is left for
    read_links to set."""
    seen: set[str] = set()
    found: list[WishLink] = []
    for at, url in _candidates(cache_bytes, b"webview_gacha"):
        decoded, _ = _query(url)
        if decoded.get("auth_appid") != "webview_gacha" or KEY not in decoded or KEY_VERSION not in decoded:
            continue
        if decoded[KEY] in seen:
            continue
        seen.add(decoded[KEY])
        found.append(WishLink(url, decoded, Path(), at=at))
    return found


def _held(problem: OSError) -> bool:
    """Whether the game holds the file: Python says so with a PermissionError, Windows with its own numbers."""
    return isinstance(problem, PermissionError) or getattr(problem, "winerror", None) in HELD_BY_ANOTHER_PROGRAM


def open_shared(path: Path) -> BinaryIO:
    """A file opened to be read and nothing else, sharing it with the program that holds it, as the game holds its web
    cache while it runs. A link is opened as itself and refused as a file that is not there (see NAMES_ANOTHER_PLACE).
    Its opening is announced as Python's open announces one, so that what watches the opening of files (the tests' guards)
    sees it. The gallery (gallery.py) reads the game's pictures through it too."""
    sys.audit("open", str(path), "rb", os.O_RDONLY | os.O_BINARY)
    handle = _winapi.CreateFile(
        str(path), READ_ONLY, SHARED_WITH_THE_GAME, _winapi.NULL, OPEN_EXISTING, OPEN_THE_LINK_ITSELF, _winapi.NULL
    )
    try:
        number = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except BaseException:
        _winapi.CloseHandle(handle)
        raise
    try:
        # The handle's own attributes say a reparse point is there; the tag, which fstat does not give, says what kind.
        if os.fstat(number).st_file_attributes & A_REPARSE_POINT and os.lstat(path).st_reparse_tag & NAMES_ANOTHER_PLACE:
            log.warning("%s is a link, which is not followed.", path)
            raise FileNotFoundError(errno.ENOENT, "a link, which is not followed", str(path))
        return open(number, "rb")
    except BaseException:
        os.close(number)
        raise


def _whole(path: Path, limit: int) -> bytes:
    """A file's bytes, read-only, when it holds no more than `limit`. The game may write on after the file's size was
    asked, so no more than the limit and a byte is read, and a file that holds that byte is refused."""
    with open_shared(path) as file:
        data = file.read(limit + 1)
    if len(data) > limit:
        log.warning("%s grew past the %d bytes Guild Board reads while it was read.", path, limit)
        raise CacheProblem(TOO_LARGE)
    return data


def _read(path: Path, limit: int, missing: str, read: Callable[[Path, int], _Content]) -> _Content:
    """What `read` takes from a file, when the file is no larger than `limit`, which `read` is given to hold to as it
    reads. What cannot be read is a CacheProblem in the player's words, with the error behind it as its cause; a failure
    of another kind is left to be what it is."""
    try:
        size = path.lstat().st_size  # a link's own: what it points at is never asked about, and open_shared refuses it
        if size > limit:
            log.warning("%s is %d bytes, larger than the %d bytes Guild Board reads.", path, size, limit)
            raise CacheProblem(TOO_LARGE)
        return read(path, limit)
    except (FileNotFoundError, NotADirectoryError) as problem:
        raise CacheProblem(missing) from problem
    except OSError as problem:
        if _held(problem):
            raise CacheProblem(HELD_OPEN) from problem
        raise


def read_log(path: Path) -> str:
    """The game's log, whole, read-only: the first of the two reads. A CacheProblem says why it could not be read."""
    return _read(
        path, MAX_LOG_BYTES, LOG_MISSING.format(path=path),
        lambda file, limit: _whole(file, limit).decode("utf-8", errors="replace"),
    )


def read_cache(path: Path) -> bytes:
    """The web cache file, whole, read-only: the second of the two reads. A CacheProblem says why it could not be
    read."""
    return _read(path, MAX_CACHE_BYTES, NO_CACHE, _whole)


def ledger_links(log_text: str, cache_bytes: bytes) -> list[WishLink]:
    """The self-service links (auth_appid=csc) whose query holds a key and its version, one for each key: the log's
    first, then the cache's, the last written first in each (the ledger design, section 0). The game writes the link
    into its log when the player opens Feedback from the Paimon menu, and its key opens the game's own history logs.
    As with the wish links, the importer registers a key as a secret before the link's first request (register_key)."""
    seen: set[str] = set()
    found: list[WishLink] = []
    for data in (log_text.encode("latin-1", errors="replace"), cache_bytes):
        for at, url in _candidates(data, b"csc"):
            decoded, _ = _query(url)
            if decoded.get("auth_appid") != "csc" or KEY not in decoded or KEY_VERSION not in decoded:
                continue
            if decoded[KEY] in seen:
                continue
            seen.add(decoded[KEY])
            found.append(WishLink(url, decoded, Path(), at=at))
    return found


@dataclass(frozen=True)
class HistoryLinks:
    """What the two reads found: the wish-history links and the self-service links, each the last written first, and
    when there is no wish link, the sentence that says why."""

    wish: list[WishLink]
    ledger: list[WishLink]
    wish_problem: str | None = None


def read_history_links() -> HistoryLinks:
    """The same two reads as read_links: the game's log, for its data folder and the self-service links it holds, and
    the web cache in that folder, for the wish-history links and its own self-service links. Raises CacheProblem, with
    the sentence the player sees, only when neither kind of link is found."""
    log_text = read_log(log_path())
    folder = data_folder(log_text)
    wish: list[WishLink] = []
    cache_bytes = b""
    problem: str | None = None
    cache = cache_file(folder) if folder is not None else None
    if folder is None:
        problem = NO_DATA_FOLDER
    elif cache is None:
        problem = NO_CACHE
    else:
        try:
            cache_bytes = read_cache(cache)
        except CacheProblem as cut:
            problem = str(cut)
        else:
            wish = [replace(link, cache_path=cache) for link in links(cache_bytes)]
            problem = None if wish else NO_LINK
    ledger = ledger_links(log_text, cache_bytes)
    if not wish and not ledger:
        raise CacheProblem(problem or NO_LINK)
    return HistoryLinks(wish, ledger, problem)


def read_links() -> list[WishLink]:
    """The two reads: the game's log, for its data folder, and the web cache in it, for the wish-history links, the
    last in the file first. Raises CacheProblem, with the sentence the player sees, when there is not at least one."""
    folder = data_folder(read_log(log_path()))
    if folder is None:
        raise CacheProblem(NO_DATA_FOLDER)
    cache = cache_file(folder)
    if cache is None:
        raise CacheProblem(NO_CACHE)
    found = links(read_cache(cache))
    if not found:
        raise CacheProblem(NO_LINK)
    return [replace(link, cache_path=cache) for link in found]
