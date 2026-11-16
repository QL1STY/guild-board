"""The hosts, and the exact addresses, Guild Board may contact (H5), and the only functions that send Guild Board's own
requests: fetch_bytes, which downloads a file (the achievement list, HoYoverse's pictures, and the public pictures of
PUBLIC_PICTURE_URLS), fetch_hoyoverse, which reads HoYoverse's own pages, fetch_authkey, which
asks HoYoverse for the login's read-only history key, fetch_latest_release and download_installer, which bring the
installed copy's updates, fetch_cloud, which talks to the player's online account, and fetch_fandom_upcoming and
fetch_fandom_pages, which read the dates of upcoming events from the Genshin Impact Wiki on Fandom."""
from __future__ import annotations

import email.utils
import hashlib
import http.client
import re
import threading
import urllib.error
import urllib.request
from datetime import timezone
from pathlib import Path
from typing import Any, Callable, Collection, Mapping
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

ALLOWED_DOMAINS = ("hoyolab.com", "hoyoverse.com", "mihoyo.com")
# The one address outside those domains (stage 2A spec, section 4), for a direct download only. The HoYoLAB
# client, which carries the session cookies, stays on HoYoverse's domains, and so do the icons and redirects.
ACHIEVEMENT_LIST_URL = "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json"
ALLOWED_URLS: tuple[str, ...] = (ACHIEVEMENT_LIST_URL,)
# Public pictures from outside HoYoverse (the player's choice, 2026-11-06; the Stats design, section 1 and 3.2): the
# Endgame headers, each at its one exact address, for the art cache's download alone. Such a request is a plain GET
# with Guild Board's user agent and nothing else of the player's, follows no redirect (_CheckedRedirects takes none
# whose source is not HoYoverse's) and is held to the art cache's 8 MB. A URL taken from a HoYoLAB response is never sent
# to a host outside HoYoverse's: the art cache takes these addresses from this table alone, by their place in it
# (ArtCache.public_address), and never as an address it is given.
PUBLIC_PICTURE_URLS: tuple[str, ...] = (
    # Spiral Abyss, from the Genshin Impact wiki on Fandom (512 x 256).
    "https://static.wikia.nocookie.net/gensin-impact/images/c/ca/Domain_Spiral_Abyss_Abyssal_Moon_Spire.png/revision/latest",
    # Imaginarium Theater, from Reddit (3,840 x 2,160).
    "https://i.redd.it/n427epuvp0bd1.jpg",
    # Stygian Onslaught, from the Genshin Impact wiki on Fandom (1,080 x 390).
    "https://static.wikia.nocookie.net/gensin-impact/images/b/b0/Stygian_Onslaught_2025-10-29.png/revision/latest",
    # The Imaginarium Theater's marks, HoYoLAB's own, from its Battle Chronicle (the player's choice, 2026-11-10): the
    # medal won, an act cleared without it, the Fantasia Flower and the season's heraldry, 0 to 5 (HoYoLAB gives
    # heraldry 6 the picture of 5). Their names change when HoYoLAB rebuilds the page: the card then keeps its circles.
    "https://act.hoyolab.com/app/community-game-records-sea/images/active-medal-icon.b3adc53a.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/default-medal-icon.966c006f.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/flower-icon.dd04a858.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/heraldry-icon-0.4625c4b3.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/heraldry-icon-1.4e456b5e.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/heraldry-icon-2.3b5e7c80.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/heraldry-icon-3.d3c03e1a.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/heraldry-icon-4.0097b91f.png",
    "https://act.hoyolab.com/app/community-game-records-sea/images/heraldry-icon-5.0ae98c9e.png",
)
# Their hosts, each once, in the table's order.
PUBLIC_PICTURE_HOSTS: tuple[str, ...] = tuple(
    dict.fromkeys(urlsplit(url).hostname or "" for url in PUBLIC_PICTURE_URLS)
)
# The installed copy's updates (the player's choice, 2026-10-25): the newest release's facts, from the one public
# repository the player publishes installers to, and that release's installer, asked for by its asset's address. GitHub
# sends the installer from its download host, the one redirect such a request follows. Neither carries anything of
# the player's. Since 2.0.1 the releases are those of the code's own repository (the player's choice, 2026-11-08):
# 2.0.0 and earlier look in QL1STY/guild-board-releases, which got 2.0.1 too, to bring them here.
RELEASES_REPO = "QL1STY/guild-board"
LATEST_RELEASE_URL = f"https://api.github.com/repos/{RELEASES_REPO}/releases/latest"
INSTALLER_ASSET = re.compile(rf"https://api\.github\.com/repos/{re.escape(RELEASES_REPO)}/releases/assets/[0-9]+")
DOWNLOAD_HOSTS = ("release-assets.githubusercontent.com", "objects.githubusercontent.com")
USER_AGENT = "GuildBoard"
# The one address that gives the stored HoYoLAB login a read-only key for the wish history or the game's own history
# logs, and the only cookies of the login it is sent (found at the check with the player, 2026-10-27).
MINT_URL = "https://api-account-os.hoyoverse.com/binding/api/genAuthKeyByCookieToken"
MINT_COOKIES = ("account_id_v2", "account_mid_v2", "cookie_token_v2", "lrsag")
# The online features (the online design, section 3): one exact host, the player's Supabase project, and of it the Auth and
# REST paths alone. fetch_cloud takes a path, not an address, so nothing it is given can send it elsewhere. A fork changes
# the host here and pins its own in the hands-off test.
CLOUD_HOST = "tspjpcyhpkfetwzolzvi.supabase.co"
CLOUD_PATHS = ("/auth/v1/", "/rest/v1/")
_NEVER_IN_A_CLOUD_PATH = ("//", "..", "\\", "@")
# The dates of upcoming events, from the Genshin Impact Wiki on Fandom (the player's choice, 2026-11-15; the widgets plan, Task 2b):
# the MediaWiki API's one path, asked in two shapes only: the category of upcoming content, and the text of up to
# FANDOM_MAX_TITLES of its pages. The address has a query, which _exactly_one_of refuses, so these have a check of their own
# (is_fandom_query): the host, the path and the parameter names are fixed, and so are all values but the titles. A plain GET with
# Guild Board's user agent and nothing of the player's, never redirected, held to the caller's size.
FANDOM_API = "https://genshin-impact.fandom.com/api.php"
FANDOM_CATEGORY_LIMIT = 100  # the titles the category is asked for (cmlimit), and the most the app keeps
FANDOM_UPCOMING_QUERY: tuple[tuple[str, str], ...] = (
    ("action", "query"), ("list", "categorymembers"), ("cmtitle", "Category:Upcoming_Content"), ("cmlimit", str(FANDOM_CATEGORY_LIMIT)),
    ("format", "json"), ("formatversion", "2"),
)
FANDOM_PAGES_QUERY: tuple[tuple[str, str], ...] = (
    ("action", "query"), ("prop", "revisions"), ("rvprop", "content"), ("rvslots", "main"), ("format", "json"),
    ("formatversion", "2"),
)  # and `titles`, the pages' titles joined by "|"
FANDOM_MAX_TITLES = 50
FANDOM_MAX_TITLE_LENGTH = 200
_NO_TITLE_CHARACTER = re.compile(r"[\x00-\x1f\x7f|<>\[\]{}#]")


class HostNotAllowed(Exception):
    """A request was about to go to an address it is not allowed to reach."""


class ResponseTooLarge(ValueError):
    """An answer was larger than the caller allows."""


def what_failed(error: BaseException) -> str:
    """A request's failure, for the log: its kind and, from the server, its HTTP status. Never the failure's own text,
    which can hold the address it was sent to, and with it a key."""
    code = getattr(error, "code", None)
    return f"{type(error).__name__}, HTTP {code}" if isinstance(code, int) else type(error).__name__


def sendable(url: str) -> str:
    """An address as a browser sends it: the wiki writes spaces and letters of other scripts into its pictures' paths (half its
    weapons' icons are named in Chinese), which urllib cannot send as they are. What is already encoded stays as it is."""
    return quote(url, safe=":/?&=%#+@,;~!*'()$")


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def is_hoyoverse(url: str) -> bool:
    try:
        scheme = urlsplit(url).scheme
    except ValueError:
        return False
    if scheme != "https":
        return False
    host = _host(url)
    return any(host == domain or host.endswith("." + domain) for domain in ALLOWED_DOMAINS)


def check_hoyoverse(url: str) -> None:
    if not is_hoyoverse(url):
        raise HostNotAllowed(_host(url) or "(no host)")


def _exactly_one_of(url: str, table: tuple[str, ...]) -> bool:
    """Exactly an address in `table`: the same scheme, host and path, with no user, port, query or fragment."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    if parts.scheme != "https" or parts.username is not None or parts.password is not None or port is not None:
        return False
    if parts.query or parts.fragment:
        return False
    # urlsplit gives the host in lower case.
    return any((parts.hostname, parts.path) == (entry.hostname, entry.path) for entry in map(urlsplit, table))


def _is_listed(url: str) -> bool:
    """Exactly an address in ALLOWED_URLS."""
    return _exactly_one_of(url, ALLOWED_URLS)


def is_public_picture(url: str) -> bool:
    """Exactly an address in PUBLIC_PICTURE_URLS."""
    return _exactly_one_of(url, PUBLIC_PICTURE_URLS)


def is_allowed(url: str) -> bool:
    return is_hoyoverse(url) or _is_listed(url) or is_public_picture(url)


def check(url: str) -> None:
    if not is_allowed(url):
        raise HostNotAllowed(_host(url) or "(no host)")


def _fandom_titles(titles: Collection[str]) -> list[str]:
    """The pages' titles, when they can be asked for in one request; ValueError when they cannot."""
    listed = list(titles)
    if not 1 <= len(listed) <= FANDOM_MAX_TITLES:
        raise ValueError("a request asks for 1 to 50 pages")
    for title in listed:
        if (
            not isinstance(title, str) or not title.strip() or len(title) > FANDOM_MAX_TITLE_LENGTH
            or _NO_TITLE_CHARACTER.search(title)
        ):
            raise ValueError("a page's title cannot be asked for")
    return listed


def fandom_upcoming_url() -> str:
    """The address that lists the pages of the wiki's category of upcoming content."""
    return f"{FANDOM_API}?{urlencode(FANDOM_UPCOMING_QUERY, quote_via=quote)}"


def fandom_pages_url(titles: Collection[str]) -> str:
    """The address that gives the text of `titles` (1 to FANDOM_MAX_TITLES pages); ValueError when they cannot be asked for."""
    query = (*FANDOM_PAGES_QUERY, ("titles", "|".join(_fandom_titles(titles))))
    return f"{FANDOM_API}?{urlencode(query, quote_via=quote)}"


def is_fandom_query(url: str) -> bool:
    """Exactly the wiki's API address with one of its two query shapes: the same scheme, host and path, no user, port or
    fragment, the parameter names of the shape each once and no other, every value as the shape fixes it and, for the pages'
    text, 1 to FANDOM_MAX_TITLES titles of the kind a page can have."""
    try:
        parts = urlsplit(url)
        port = parts.port
        query = parse_qsl(parts.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        return False
    fixed = urlsplit(FANDOM_API)
    if parts.scheme != "https" or parts.username is not None or parts.password is not None or port is not None:
        return False
    if parts.fragment or (parts.hostname, parts.path) != (fixed.hostname, fixed.path):
        return False
    if query == list(FANDOM_UPCOMING_QUERY):
        return True
    shape = list(FANDOM_PAGES_QUERY)
    if len(query) != len(shape) + 1 or query[:len(shape)] != shape or query[-1][0] != "titles":
        return False
    try:
        _fandom_titles(query[-1][1].split("|"))
    except ValueError:
        return False
    return True


def check_fandom(url: str) -> None:
    if not is_fandom_query(url):
        raise HostNotAllowed(_host(url) or "(no host)")


def _fandom_get(url: str, timeout: float, max_bytes: int) -> bytes:
    check_fandom(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    request.follow_redirects = False  # read by _CheckedRedirects
    return _read(request, timeout, max_bytes)


def fetch_fandom_upcoming(*, timeout: float = 20.0, max_bytes: int = 200_000) -> bytes:
    """The wiki's list of the pages of upcoming content, from FANDOM_API alone and never redirected."""
    return _fandom_get(fandom_upcoming_url(), timeout, max_bytes)


def fetch_fandom_pages(titles: Collection[str], *, timeout: float = 30.0, max_bytes: int = 3_000_000) -> bytes:
    """The text of up to FANDOM_MAX_TITLES pages of the wiki, from FANDOM_API alone and never redirected."""
    return _fandom_get(fandom_pages_url(titles), timeout, max_bytes)


def _is_download_host(url: str) -> bool:
    try:
        scheme = urlsplit(url).scheme
    except ValueError:
        return False
    return scheme == "https" and _host(url) in DOWNLOAD_HOSTS


class RedirectRefused(HostNotAllowed):
    """A request that goes to its own address alone was redirected. It names the host it was sent to."""


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    """Redirects stay on HoYoverse's domains. The achievement list and the public pictures are fetched directly and never
    redirected, and so is a request that goes to its own address alone (the wish history's, which takes the key)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if getattr(req, "installer", False):
            # An installer's asset, sent on once, to GitHub's download host; its answer is not redirected again.
            if not INSTALLER_ASSET.fullmatch(req.full_url) or not _is_download_host(newurl):
                raise RedirectRefused(_host(newurl) or "(no host)")
            sent = urllib.request.Request(newurl, headers={"User-Agent": USER_AGENT})
            sent.follow_redirects = False
            return sent
        if not getattr(req, "follow_redirects", True):
            raise RedirectRefused(_host(newurl) or "(no host)")
        check_hoyoverse(req.full_url)
        check_hoyoverse(newurl)
        hosts = getattr(req, "hosts", None)  # set by fetch_bytes, for a request that may go to some hosts alone
        if hosts is not None and _host(newurl) not in hosts:
            raise HostNotAllowed(_host(newurl) or "(no host)")
        sent = super().redirect_request(req, fp, code, msg, headers, newurl)
        if sent is not None and hosts is not None:
            sent.hosts = hosts  # a request made for a redirect has none of the old one's attributes, and the next hop is checked too
        return sent


def _opener() -> Callable[..., Any]:
    return urllib.request.build_opener(_CheckedRedirects).open


_open = _opener()


def take_the_tls_in_use() -> None:
    """Build the opener again. It takes its TLS context as it is built, and this module is imported before the entry chooses
    how connections are verified (__main__.use_the_windows_store)."""
    global _open
    _open = _opener()


def _read(request: urllib.request.Request, timeout: float, max_bytes: int) -> bytes:
    try:
        with _open(request, timeout=timeout) as response:
            data = response.read(max_bytes + 1)
    except http.client.IncompleteRead:  # the connection dropped in the middle of the answer
        raise ConnectionError("the answer was cut short") from None
    if len(data) > max_bytes:
        raise ResponseTooLarge("the response is larger than allowed")
    return data


def fetch_bytes(
    url: str, *, timeout: float = 15.0, max_bytes: int = 2_000_000, hosts: Collection[str] | None = None
) -> bytes:
    """Download a file from an address the policy allows. With `hosts`, the address and every address it is redirected to
    must be one of those hosts (HostNotAllowed), which is how a caller holds a download to fewer than the policy allows."""
    check(url)
    request = urllib.request.Request(sendable(url), headers={"User-Agent": USER_AGENT})
    if hosts is not None:
        if _host(url) not in hosts:
            raise HostNotAllowed(_host(url) or "(no host)")
        request.hosts = frozenset(hosts)  # read by _CheckedRedirects
    return _read(request, timeout, max_bytes)


def fetch_hoyoverse(
    url: str,
    *,
    timeout: float = 20.0,
    max_bytes: int = 4_000_000,
    headers: Mapping[str, str] | None = None,
    body: bytes | None = None,
    follow_redirects: bool = True,
) -> bytes:
    """Read one of HoYoverse's own pages: the wish history, the announcements or the wiki's lists (the Pulls design,
    section 4). Only HoYoverse's domains, never the list's address, and redirects stay on them; with `follow_redirects`
    False, none is followed (RedirectRefused). A POST when `body` is given (the wiki asks for its lists that way; it
    changes nothing). The headers given are sent, with Guild Board's own user agent always. None of these requests
    carries the HoYoLAB cookies. An answer cut short by a dropped connection is a ConnectionError."""
    check_hoyoverse(url)
    sent = {name: value for name, value in (headers or {}).items() if name.lower() != "user-agent"}
    sent["User-Agent"] = USER_AGENT
    request = urllib.request.Request(url, data=body, headers=sent, method="POST" if body is not None else "GET")
    request.follow_redirects = follow_redirects  # read by _CheckedRedirects
    return _read(request, timeout, max_bytes)


def fetch_authkey(
    cookies: Mapping[str, str], body: bytes, *, timeout: float = 20.0, max_bytes: int = 100_000
) -> bytes:
    """Ask HoYoverse for a read-only history key for the logged-in account: a POST of `body` to MINT_URL alone, never
    redirected, carrying of the login's cookies only MINT_COOKIES. The answer holds the key; the caller registers it
    as a secret and never writes it anywhere."""
    sent = "; ".join(f"{name}={cookies[name]}" for name in MINT_COOKIES if name in cookies)
    request = urllib.request.Request(
        MINT_URL, data=body, method="POST",
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json", "Cookie": sent},
    )
    request.follow_redirects = False  # read by _CheckedRedirects
    return _read(request, timeout, max_bytes)


class CloudAnswer(tuple):
    """What fetch_cloud returns: the answer's status and body, which is how it unpacks and compares, and `date`, the server's
    clock when it answered, from its Date header, in seconds since 1970; None when it gave no date that can be read."""

    date: float | None

    def __new__(cls, status: int, body: bytes, date: float | None = None) -> "CloudAnswer":
        answer = super().__new__(cls, (status, body))
        answer.date = date
        return answer


def _date_of(headers: Any) -> float | None:
    """The server's clock from an answer's headers, in seconds since 1970. HTTP dates are UTC."""
    try:
        moment = email.utils.parsedate_to_datetime(headers.get("Date") or "")
        return (moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)).timestamp()
    except (AttributeError, TypeError, ValueError, IndexError, OverflowError):
        return None


def fetch_cloud(
    path: str,
    *,
    method: str = "GET",
    headers: Mapping[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 20.0,
    max_bytes: int = 4_000_000,
) -> CloudAnswer:
    """One request to https://CLOUD_HOST + path, never redirected. An HTTP error is an answer: its status and body, at
    most `max_bytes` of it, are returned, not raised. A path outside CLOUD_PATHS, or holding `//`, `..`, `\\` or `@`, is
    HostNotAllowed, which names the host alone: a path can hold a query. Guild Board's own user agent is always sent. An
    answer cut short, or one that is no HTTP, is a ConnectionError. Each answer carries the server's clock, as its Date
    header says it, which sync sets this PC's own against."""
    if not path.startswith(CLOUD_PATHS) or any(part in path for part in _NEVER_IN_A_CLOUD_PATH):
        raise HostNotAllowed(CLOUD_HOST)
    sent = {name: value for name, value in (headers or {}).items() if name.lower() != "user-agent"}
    sent["User-Agent"] = USER_AGENT
    request = urllib.request.Request(f"https://{CLOUD_HOST}{path}", data=body, headers=sent, method=method)
    request.follow_redirects = False  # read by _CheckedRedirects
    try:
        try:
            with _open(request, timeout=timeout) as response:
                status, data = response.status, response.read(max_bytes + 1)
                owed = response.length  # what its Content-Length promised and has not come, None when it gave none
                date = _date_of(response.headers)
        except urllib.error.HTTPError as error:
            with error:
                return CloudAnswer(error.code, error.read(max_bytes), _date_of(error.headers))
    except http.client.HTTPException:  # the connection dropped in the middle of the answer
        raise ConnectionError("the answer was cut short") from None
    if len(data) > max_bytes:
        raise ResponseTooLarge("the response is larger than allowed")
    if owed:  # a read of at most so much does not raise IncompleteRead, as a read of everything does
        raise ConnectionError("the answer was cut short")
    return CloudAnswer(status, data, date)


def fetch_latest_release(*, timeout: float = 15.0, max_bytes: int = 500_000) -> bytes:
    """The newest release's facts, as GitHub's API gives them, from LATEST_RELEASE_URL alone and never redirected."""
    request = urllib.request.Request(
        LATEST_RELEASE_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    )
    request.follow_redirects = False
    return _read(request, timeout, max_bytes)


def download_installer(
    url: str,
    target: Path,
    *,
    size: int,
    sha256: str,
    progress: Callable[[int], None] = lambda done: None,
    cancel: threading.Event | None = None,
    timeout: float = 60.0,
) -> None:
    """Download a release's installer, asked for by its asset's address, into `target`. It must be exactly `size` bytes
    with that SHA-256, or nothing is left behind and ValueError says so. Setting `cancel` stops it between two chunks
    (InterruptedError)."""
    if not INSTALLER_ASSET.fullmatch(url):
        raise HostNotAllowed(_host(url) or "(no host)")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
    request.installer = True  # read by _CheckedRedirects
    digest = hashlib.sha256()
    done = 0
    try:
        with _open(request, timeout=timeout) as response, target.open("wb") as file:
            while chunk := response.read(1 << 20):
                if cancel is not None and cancel.is_set():
                    raise InterruptedError("Guild Board is closing")
                done += len(chunk)
                if done > size:
                    raise ResponseTooLarge("the installer is larger than its release says")
                digest.update(chunk)
                file.write(chunk)
                progress(done)
        if done != size or digest.hexdigest() != sha256.lower():
            raise ValueError("the installer is not the one its release names")
    except http.client.IncompleteRead:
        target.unlink(missing_ok=True)
        raise ConnectionError("the answer was cut short") from None
    except BaseException:
        target.unlink(missing_ok=True)
        raise
