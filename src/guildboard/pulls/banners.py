"""The banners running now, read from HoYoverse's in-game announcements (the Pulls design, section 2.5; the plan's
calls, item 12).

They are read after each sync, at every Import and at a start where the kept banners are older than six hours or there
are none; never more than once an hour otherwise. The request names the account's uid and adventure rank, or uid 1 and
rank 60 before a login (HoYoverse lists a few announcements without a uid, and the wishes with one). A wish's own run
comes from the first two times in its announcement's content, when they make a run of a week or more that lies within
the announcement's own times, give or take a day; else the announcement's own times stand in. A wish of a version's
first half has no start of its own there: its content says "After the Version 7.2 update – <end>", and a later time in
it is another's.
The art is kept as the label banner.<ann_id>, which the icon cache serves. A read that fails keeps the banners kept.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any, Callable
from urllib.parse import urlencode

from guildboard import netpolicy
from guildboard.clock import Clock
from guildboard.events import EventBus
from guildboard.htmltext import MAX_FIELD_CHARS, strip_tags
from guildboard.metrics import Label
from guildboard.store import BannerRow, Store

log = logging.getLogger(__name__)

_ANNOUNCEMENTS = "https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/"
ANN_LIST_URL = _ANNOUNCEMENTS + "getAnnList"
ANN_CONTENT_URL = _ANNOUNCEMENTS + "getAnnContent"
NO_UID, NO_LEVEL = 1, 60  # what the announcements are asked for before a login: nothing of the player's

FRESH = timedelta(hours=1)  # banners read more recently are not read again, except at an Import
STALE = timedelta(hours=6)  # at a start, banners read longer ago are read again
FAILURE_LOGGED_EVERY = timedelta(hours=1)

# An event's title that is a wish: 'Event Wish "Void Star's Advent" - Boosted Drop Rate for "Void Star" Skirk (Cryo)!'.
# No chronicled wish ran on 2026-10-23, so its wording is a guess; one that is left out costs only its Fate Point.
WISH_TITLE = re.compile(r'^(?P<kind>Event|Chronicled) Wish "(?P<name>[^"]+)"')
QUOTED = re.compile(r'"[^"]*"\s*')  # the title before a featured name: "Void Star"
TRAILING = re.compile(r"\s*\([^()]*\)$")  # what follows a featured name: (Cryo), (Sword)
# Inside a content, a time the game shows in the server's time: <t class="t_lc" contenteditable="false">2026/10/13
# 18:00</t>, its angle brackets escaped.
SERVER_TIME_OPEN = '<t class="t_lc"'
MAX_CONTENT_CHARS = 256 * 1024  # an announcement's content is a few thousand characters; this reads no more than that
CONTENT_TIME_FORMATS = ("%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S")
ANNOUNCEMENT_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
# How far outside its announcement's own times a wish's run may still lie: the announcement shows from a few days before
# the run and ends with it, so a run read from its content lies within them.
RUN_LEEWAY = timedelta(days=1)
# The shortest run a content's two times may make: a wish runs for weeks, so two times closer together are a first-half
# wish's end and something after it, even within RUN_LEEWAY of the announcement's end.
SHORTEST_RUN = timedelta(days=7)


def ann_url(base: str, region: str, uid: int, level: int) -> str:
    """The address of the announcements' list or contents for an account on a server."""
    query = {
        "game": "hk4e", "game_biz": "hk4e_global", "lang": "en", "bundle_id": "hk4e_global", "platform": "pc",
        "region": region, "level": level, "uid": uid,
    }
    return f"{base}?{urlencode(query)}"


def _plain(text: Any) -> str:
    """A title as the player reads it: without tags, and with its entities read."""
    if not isinstance(text, str):
        return ""
    return strip_tags(html.unescape(strip_tags(text[:MAX_FIELD_CHARS]))).strip()


def _server_times(text: str, limit: int) -> list[str]:
    """The first `limit` times in `<t class="t_lc" ...>time</t>` of a content, as the pattern
    `<t class="t_lc"[^>]*>([^<]*)</t>` finds them, by scans: the pattern reads on from every opening that no ">" or "</t>"
    follows."""
    found: list[str] = []
    at = 0
    while len(found) < limit:
        start = text.find(SERVER_TIME_OPEN, at)
        if start < 0:
            break
        close = text.find(">", start + len(SERVER_TIME_OPEN))
        if close < 0:
            break
        after = text.find("<", close + 1)
        if after < 0:
            break
        if text.startswith("</t>", after):
            found.append(text[close + 1:after])
            at = after + len("</t>")
        else:  # every opening before this ">" would end at the same place, and fail the same way
            at = close
    return found


def _data(body: bytes, what: str) -> dict[str, Any]:
    """The data of an answer of the announcements, with its list; ValueError when it is not one."""
    answer = json.loads(body)
    data = answer.get("data") if isinstance(answer, dict) and answer.get("retcode") == 0 else None
    if not isinstance(data, dict) or not isinstance(data.get("list"), list):
        raise ValueError(f"the announcements' {what} cannot be read")
    return data


def _pool(kind: str, name: str, title: str) -> str:
    """The pool of the cards a wish belongs to: a chronicled wish first, as its title may name rates for several. The
    titles' case varies ("Boosted drop rate for", 2026-11-04), so the words are matched in any case."""
    if kind == "Chronicled" or "Chronicled" in name or "Lightrace" in name:
        return "chronicled"
    lowered = title.lower()
    if name == "Epitome Invocation" or "boosted drop rates for" in lowered:
        return "weapon"
    if "boosted drop rate for" in lowered:
        return "character"
    return "other"


def _featured(rest: str) -> tuple[str, ...]:
    """The featured names of a title's end: what follows " for " up to "!", each without the quoted title before it
    and the "(…)" after it. The names are joined by ", " and " and "; where each ends in its "(…)", the split is made
    only after one, as a name may hold " and " itself (the wiki lists a weapon "Disaster and Remorse")."""
    at = rest.find(" for ")
    if at < 0:
        return ()
    text = QUOTED.sub("", rest[at + len(" for "):].split("!", 1)[0]).strip()
    if text.endswith(")"):
        parts = re.split(r"(?<=\))\s*(?:,\s*(?:and\s+)?|and\s+)", text)
    else:
        parts = re.split(r",\s*(?:and\s+)?|\s+and\s+", text)
    return tuple(name for name in (TRAILING.sub("", part.strip()).strip() for part in parts) if name)


def _content_run(content: Any, server: tzinfo) -> tuple[datetime, datetime] | None:
    """The first two times in the server's time in a wish's content; None without two."""
    if not isinstance(content, str):
        return None
    times = _server_times(html.unescape(content[:MAX_CONTENT_CHARS]), 2)
    moments = [_moment(text.strip(), CONTENT_TIME_FORMATS, server) for text in times]
    if len(moments) < 2 or None in moments:
        return None
    return moments[0], moments[1]


def _run(content: Any, entry: dict[str, Any], server: tzinfo) -> tuple[datetime | None, datetime | None]:
    """A wish's run: its content's two times when they make one at least SHORTEST_RUN long and within the announcement's
    own times, give or take RUN_LEEWAY; else the announcement's own times, which are None where they cannot be read.
    Where they cannot be read, a run of the content's stands alone."""
    own = (
        _moment(entry.get("start_time"), (ANNOUNCEMENT_TIME_FORMAT,), server),
        _moment(entry.get("end_time"), (ANNOUNCEMENT_TIME_FORMAT,), server),
    )
    pair = _content_run(content, server)
    if pair is None or pair[1] - pair[0] < SHORTEST_RUN:
        return own
    if own[0] is None or own[1] is None:
        return pair
    start, end = pair
    return pair if own[0] - RUN_LEEWAY <= start and end <= own[1] + RUN_LEEWAY else own


def _moment(text: Any, formats: tuple[str, ...], server: tzinfo) -> datetime | None:
    if not isinstance(text, str):
        return None
    for form in formats:
        try:
            return datetime.strptime(text, form).replace(tzinfo=server).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _is_event(entry: Any, group: dict[str, Any]) -> bool:
    return isinstance(entry, dict) and entry.get("type_label", group.get("type_label")) == "Event"


def _events(list_body: bytes) -> int:
    """How many event announcements a list answer holds."""
    groups = [group for group in _data(list_body, "list")["list"] if isinstance(group, dict)]
    return sum(
        sum(1 for entry in group["list"] if _is_event(entry, group))
        for group in groups if isinstance(group.get("list"), list)
    )


def parse_banners(list_body: bytes, content_body: bytes, now: datetime) -> list[BannerRow]:
    """The wishes among the announcements, in the list's order. ValueError when an answer cannot be read."""
    listed, contents = _data(list_body, "list"), _data(content_body, "contents")
    hours = listed.get("timezone")
    if not isinstance(hours, int) or isinstance(hours, bool) or not -12 <= hours <= 14:
        raise ValueError("the announcements do not say their server's time")
    server = timezone(timedelta(hours=hours))
    by_id = {entry.get("ann_id"): entry for entry in contents["list"] if isinstance(entry, dict)}
    rows: list[BannerRow] = []
    for group in listed["list"]:
        entries = group.get("list") if isinstance(group, dict) else None
        for entry in entries if isinstance(entries, list) else []:
            if not _is_event(entry, group):
                continue
            ann_id, title = entry.get("ann_id"), _plain(entry.get("title"))
            found = WISH_TITLE.match(title)
            if found is None or not isinstance(ann_id, int) or isinstance(ann_id, bool):
                continue
            content = by_id.get(ann_id, {})
            run = _run(content.get("content"), entry, server)
            if None in run:
                log.warning("The wish of announcement %s has no run Guild Board can read; it is left out.", ann_id)
                continue
            art = entry.get("banner") or content.get("banner")
            name = found.group("name")
            rows.append(BannerRow(
                ann_id=ann_id, name=name, pool=_pool(found.group("kind"), name, title),
                featured=_featured(title[found.end():]), art_url=art if isinstance(art, str) else "",
                starts_at=run[0], ends_at=run[1], read_at=now,
            ))
    return rows


class Banners:
    def __init__(
        self,
        store: Store,
        clock: Clock,
        bus: EventBus,
        fetch: Callable[..., Any] | None,
        server: Callable[[], str],
        uid: Callable[[], int | None],
        level: Callable[[], int],
        ready: Callable[[], bool],
        *,
        named: Callable[[], None] | None = None,
    ) -> None:
        self._store = store
        self._clock = clock
        self._bus = bus
        self._fetch = fetch  # netpolicy.fetch_hoyoverse; None in the demo, which contacts nothing
        self._server = server
        self._uid = uid  # the account the announcements are asked for, None before a login
        self._level = level  # its adventure rank, which the announcements are asked for as well
        # Whether the player has given the first run's consent (ruling R15): until then nothing reaches HoYoverse but
        # the read the player's own Import asks for.
        self._ready = ready
        # Told when a read kept a featured name the banners kept before did not name: the core reads its icon.
        self._named = named
        self._failure_logged_at: datetime | None = None
        self._woken = asyncio.Event()
        self._lock = asyncio.Lock()  # one read at a time: the one that waits finds the banners just read

    def _last_read(self) -> datetime | None:
        """When the banners kept were read."""
        return max((row.read_at for row in self._store.banners()), default=None)

    async def refresh(self, force: bool = False) -> int:
        """Read the announcements, keep the wishes among them with their art, and tell the pages, and `named` when a
        featured name is new. How many banners were kept; -1 when nothing was kept: in the demo, before the first run's
        consent or within the hour of the last read unless `force`, or when the read failed or named no wish, either of
        which keeps the banners kept."""
        if self._fetch is None or (not force and not self._ready()):
            return -1
        async with self._lock:
            now = self._clock.now()
            kept = self._store.banners()
            last = max((row.read_at for row in kept), default=None)
            if not force and last is not None and now - last < FRESH:
                return -1
            uid = self._uid()
            asked = (self._server(), NO_UID if uid is None else uid, self._level() if uid is not None else NO_LEVEL)
            try:
                list_body = await asyncio.to_thread(self._fetch, ann_url(ANN_LIST_URL, *asked))
                content_body = await asyncio.to_thread(self._fetch, ann_url(ANN_CONTENT_URL, *asked))
                rows = await asyncio.to_thread(parse_banners, list_body, content_body, now)
            except Exception as error:  # offline, or an answer it cannot read: the banners kept stay
                self._failed(now, f"could not be read ({netpolicy.what_failed(error)})")
                return -1
            if not rows:  # announcements that name no wish leave the banners kept, which end by themselves
                self._failed(now, f"name no wish among {_events(list_body)} events")
                return -1
            with self._store.transaction():
                self._store.replace_banners(rows)
                self._store.upsert_labels(
                    [Label(f"banner.{row.ann_id}", row.name, "banner", None, row.art_url) for row in rows], now
                )
        self._bus.publish("pulls_changed")
        named_before = {name for row in kept for name in row.featured}
        if self._named is not None and any(name not in named_before for row in rows for name in row.featured):
            self._named()
        return len(rows)

    def _failed(self, now: datetime, what: str) -> None:
        """Say in the log what kept the banners kept, at most once an hour."""
        if self._failure_logged_at is None or now - self._failure_logged_at >= FAILURE_LOGGED_EVERY:
            self._failure_logged_at = now
            log.warning("HoYoverse's announcements %s. The banners kept stay.", what)

    def wake(self) -> None:
        """Read again now, unless the banners were read within the hour, or the player has not given the consent."""
        self._woken.set()

    async def run(self) -> None:
        """Once the player has given the first run's consent: at a start, read the banners when the kept ones are older
        than six hours, or there are none; then after each sync, and at each wake. Until the consent nothing is read but
        what the player's own Import asks for; the change of the settings that gives it makes the start's read then.
        The demo reads nothing."""
        if self._fetch is None:
            return
        heard = self._bus.subscribe()  # before the first read, so that no sync is missed meanwhile
        try:
            started = False
            while True:
                if not started and self._ready():
                    started = True
                    last = self._last_read()
                    if last is None or self._clock.now() - last > STALE:
                        await self._refresh_quietly()
                if await self._next(heard) != "settings_changed":
                    await self._refresh_quietly()
        finally:
            self._bus.unsubscribe(heard)

    async def _refresh_quietly(self) -> None:
        try:
            await self.refresh()
        except Exception:  # a failed read must not end the watch
            log.exception("the banners could not be read")

    async def _next(self, heard: asyncio.Queue[dict[str, Any]]) -> str:
        """Until a sync finishes, the settings change or a wake comes: which of them."""
        while True:
            getting = asyncio.ensure_future(heard.get())
            woken = asyncio.ensure_future(self._woken.wait())
            try:
                done, _ = await asyncio.wait({getting, woken}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in (getting, woken):
                    task.cancel()
                await asyncio.gather(getting, woken, return_exceptions=True)
            if woken in done:
                self._woken.clear()
                return "wake"
            kind = getting.result().get("type") if getting in done and not getting.cancelled() else None
            if kind in ("sync_finished", "settings_changed"):
                return kind
