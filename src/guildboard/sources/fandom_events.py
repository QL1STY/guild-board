"""The dates of upcoming events, from the Genshin Impact Wiki on Fandom (the player's choice, 2026-11-15; the widgets plan, Task 2b).

HoYoLAB's calendar lists an announced event with no dates; the wiki's page for it often has them, in the `{{Event` template
(`time_known`, `time_start`, `time_end`, in server time). Two kinds of read, through netpolicy alone (`netpolicy.FANDOM_API`):
the titles of the pages in the category of upcoming content, then the text of those pages, 50 to a request. Only the pages that
carry an `{{Event` template with `time_known = yes` and both times give an event. The last good answer is kept (the document
`fandom_events`) so that offline keeps working. It is read at most once a day, counted from the last good read; a read that
fails keeps the answer and is tried again no sooner than a quarter of an hour later, then less often (an hour, four hours, a
day) while it keeps failing; the time and the count of the last failed read are kept (the store's meta), so that a restart
does not read sooner. Nothing is read before the first run's
consent, and the demo has no fetch. Nothing of the player's goes there.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Callable, Sequence

from guildboard import netpolicy
from guildboard.clock import Clock
from guildboard.events import EventBus
from guildboard.store import Store, iso, parse_iso

log = logging.getLogger(__name__)

DOC = "fandom_events"  # the group the last good answer is kept under (store.latest_doc)
FETCH_EVERY = timedelta(days=1)  # a good read is followed by the next no sooner than this
RETRY_AFTER = timedelta(minutes=15)  # after a failed read, no sooner than this
RETRY_STEPS = (RETRY_AFTER, timedelta(hours=1), timedelta(hours=4), timedelta(days=1))  # after the 1st, 2nd, 3rd failure in a row, and after more
FAILED = "fandom_failed"  # meta: JSON {"at": when the last read failed, "count": failures in a row}; gone after a good read
CHECK_EVERY = timedelta(minutes=15)  # how often the run asks whether a read is due
MAX_TITLES = netpolicy.FANDOM_CATEGORY_LIMIT  # the category's page (its cmlimit); two requests of 50 pages
MAX_EVENTS = 100
MAX_TEXT = 60_000  # characters of a page's text that are looked at: its template is at the top
MAX_NAME = 120
SUFFIX = re.compile(r"/\d{4}-\d{2}-\d{2}$")  # "Ley Line Overflow/2026-12-07" is the event "Ley Line Overflow"
TIME = re.compile(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?")
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
EVENT_TEMPLATE = re.compile(r"\{\{\s*Event\s*(?=[|\r\n}])", re.IGNORECASE)
PARAMETER = re.compile(r"^[ \t]*\|[ \t]*([A-Za-z_ ]+?)[ \t]*=[ \t]*(.*?)[ \t]*$", re.MULTILINE)
LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]")


def event_key(name: str) -> str:
    """A name as two sources spell it alike: case and spacing do not count."""
    return " ".join(name.split()).casefold()


def parse_titles(body: bytes) -> list[str]:
    """The titles of the pages the category lists, of the article namespace, at most MAX_TITLES, each of a kind a request can
    ask for. ValueError when the answer is not such a list."""
    answer = json.loads(body)
    query = answer.get("query") if isinstance(answer, dict) else None
    members = query.get("categorymembers") if isinstance(query, dict) else None
    if not isinstance(members, list):
        raise ValueError("the wiki's category cannot be read")
    titles: list[str] = []
    for member in members:
        title = member.get("title") if isinstance(member, dict) else None
        if not isinstance(title, str) or member.get("ns", 0) != 0 or title.startswith("Version/") or title in titles:
            continue
        try:
            netpolicy.fandom_pages_url([title])
        except ValueError:
            continue
        titles.append(title)
    return titles[:MAX_TITLES]


def _template(text: str) -> str | None:
    """The body of the page's first `{{Event` template, to its closing braces; None when it has none."""
    found = EVENT_TEMPLATE.search(text)
    if found is None:
        return None
    depth, index = 0, found.start()
    while index < len(text) - 1:
        pair = text[index:index + 2]
        if pair == "{{":
            depth, index = depth + 1, index + 2
        elif pair == "}}":
            depth, index = depth - 1, index + 2
            if depth == 0:
                return text[found.end():index - 2]
        else:
            index += 1
    return text[found.end():]


def _plain(value: str) -> str:
    return " ".join(LINK.sub(r"\1", value).replace("'''", "").replace("''", "").split())


def _time(value: str) -> str | None:
    """A time as the template writes it, "2026-11-27 11:00:00", in server time; None when it is not one."""
    found = TIME.fullmatch(value.strip())
    if found is None:
        return None
    year, month, day, hour, minute, second = (int(part or 0) for part in found.groups())
    try:
        return datetime(year, month, day, hour, minute, second).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def parse_wikitext(title: str, text: str) -> dict[str, str] | None:
    """The event a page's `{{Event` template gives: its name, type and both times in server time. None when the page has no
    such template, does not know its time (`time_known` is not yes), lacks a time or ends before it starts."""
    body = _template(COMMENT.sub("", text[:MAX_TEXT]))
    if body is None:
        return None
    fields: dict[str, str] = {}
    for name, value in PARAMETER.findall(body):
        fields.setdefault(name.strip().lower().replace(" ", "_"), value)
    if fields.get("time_known", "").strip().lower() != "yes":
        return None
    starts, ends = _time(fields.get("time_start", "")), _time(fields.get("time_end", ""))
    if starts is None or ends is None or ends <= starts:
        return None
    name = SUFFIX.sub("", _plain(fields.get("name", "")) or title).strip()[:MAX_NAME]
    return {"name": name, "type": _plain(fields.get("type", ""))[:MAX_NAME], "starts": starts, "ends": ends} if name else None


def parse_events(body: bytes) -> list[dict[str, str]]:
    """The events the pages of an answer give. ValueError when the answer is not an answer to the pages' request."""
    answer = json.loads(body)
    query = answer.get("query") if isinstance(answer, dict) else None
    pages = query.get("pages") if isinstance(query, dict) else None
    if not isinstance(pages, list):
        raise ValueError("the wiki's pages cannot be read")
    events: list[dict[str, str]] = []
    for page in pages:
        title = page.get("title") if isinstance(page, dict) else None
        revisions = page.get("revisions") if isinstance(page, dict) else None
        revision = revisions[0] if isinstance(revisions, list) and revisions else None
        slots = revision.get("slots") if isinstance(revision, dict) else None
        main = slots.get("main") if isinstance(slots, dict) else None
        text = main.get("content") if isinstance(main, dict) else None
        if isinstance(title, str) and isinstance(text, str):
            event = parse_wikitext(title, text)
            if event is not None:
                events.append(event)
    return events


def live_fetchers() -> tuple[Callable[[], bytes], Callable[[Sequence[str]], bytes]]:
    """The reads the core gives the service: the category's titles, and the text of pages by their titles."""
    return netpolicy.fetch_fandom_upcoming, netpolicy.fetch_fandom_pages


class FandomEvents:
    def __init__(
        self,
        store: Store,
        clock: Clock,
        bus: EventBus,
        fetch_upcoming: Callable[[], bytes] | None,
        fetch_pages: Callable[[Sequence[str]], bytes] | None,
        ready: Callable[[], bool],
    ) -> None:
        self._store = store
        self._clock = clock
        self._bus = bus
        self._fetch_upcoming = fetch_upcoming  # None in the demo, which contacts nothing
        self._fetch_pages = fetch_pages
        self._ready = ready  # whether the player has given the first run's consent
        self._lock = asyncio.Lock()

    def _due(self, now: datetime) -> bool:
        kept = self._store.latest_doc(DOC)
        if kept is not None and 0 <= (now - kept[0]).total_seconds() < FETCH_EVERY.total_seconds():
            return False
        failed = self._failed()
        if failed is None:
            return True
        at, count = failed
        wait = RETRY_STEPS[min(count, len(RETRY_STEPS)) - 1]
        return not 0 <= (now - at).total_seconds() < wait.total_seconds()

    def _failed(self) -> tuple[datetime, int] | None:
        """When the last read failed and how many failed in a row, as kept; None when none did or what is kept cannot be read."""
        text = self._store.meta(FAILED)
        if text is None:
            return None
        try:
            kept = json.loads(text)
            return parse_iso(kept["at"]), max(int(kept["count"]), 1)
        except (ValueError, KeyError, TypeError):
            return None

    async def refresh(self) -> bool:
        """Read the dates when a read is due and the player has given the consent: whether a good answer was kept. A failure
        keeps the answer kept and says so in the log, with the kind of failure and nothing of the address."""
        if self._fetch_upcoming is None or self._fetch_pages is None or not self._ready():
            return False
        async with self._lock:
            now = self._clock.now()
            if not self._due(now):
                return False
            try:
                titles = parse_titles(await asyncio.to_thread(self._fetch_upcoming))
                events: list[dict[str, str]] = []
                for first in range(0, len(titles), netpolicy.FANDOM_MAX_TITLES):  # the titles of the first answer alone
                    chunk = titles[first:first + netpolicy.FANDOM_MAX_TITLES]
                    events.extend(parse_events(await asyncio.to_thread(self._fetch_pages, chunk)))
            except Exception as error:  # offline, or an answer it cannot read: the answer kept stays
                before = self._failed()
                self._store.set_meta(FAILED, json.dumps({"at": iso(now), "count": (before[1] if before else 0) + 1}))
                log.warning(
                    "The Genshin Impact Wiki's upcoming events could not be read (%s). The dates kept stay.",
                    netpolicy.what_failed(error),
                )
                return False
            self._store.drop_meta(FAILED)
            self._store.set_latest_doc(DOC, now, {"events": events[:MAX_EVENTS]})
            return True

    async def run(self) -> None:
        """Ask whether a read is due at a start, at the settings' change that gives the consent and every quarter of an hour.
        The demo has no fetch and does nothing."""
        if self._fetch_upcoming is None:
            return
        heard = self._bus.subscribe()
        loop = asyncio.get_running_loop()
        try:
            while True:
                try:
                    await self.refresh()
                except Exception:  # a failed read must not end the watch
                    log.exception("the upcoming events could not be read")
                until = loop.time() + CHECK_EVERY.total_seconds()
                try:
                    while True:
                        event = await asyncio.wait_for(heard.get(), max(until - loop.time(), 0.0))
                        if event.get("type") == "settings_changed":
                            break
                except asyncio.TimeoutError:
                    pass
        finally:
            self._bus.unsubscribe(heard)


def kept_dates(store: Store) -> dict[str, tuple[str, str]]:
    """The last good answer's events by `event_key` of their names: (starts, ends) in server time. The first of a name wins."""
    kept = store.latest_doc(DOC)
    events = kept[1].get("events") if kept is not None else None
    dates: dict[str, tuple[str, str]] = {}
    for event in events if isinstance(events, list) else ():
        if isinstance(event, dict) and isinstance(event.get("name"), str):
            starts, ends = _time(str(event.get("starts") or "")), _time(str(event.get("ends") or ""))
            if starts is not None and ends is not None:
                dates.setdefault(event_key(event["name"]), (starts, ends))
    return dates
