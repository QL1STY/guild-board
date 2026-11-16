"""The dates of upcoming events, from the Genshin Impact Wiki on Fandom (the widgets plan, Task 2b).

The answers are written by hand in the shape the MediaWiki API gave on 2026-11-15; no test reaches the wiki."""
import asyncio
import json
import urllib.error
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlsplit

import pytest

from guildboard import netpolicy
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.events import EventBus
from guildboard.records import CalendarBoardRecord, CalendarEvent, CalendarRecord
from guildboard.sources import fandom_events
from guildboard.sources.fandom_events import (
    DOC, FAILED, FETCH_EVERY, RETRY_AFTER, RETRY_STEPS, FandomEvents, kept_dates, parse_events, parse_titles, parse_wikitext,
)
from guildboard.store import iso
from guildboard.views.calendar import UPCOMING_FROM, build_calendar
from support import AccountSource, FakeClock, FakeSleep

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)

FRAMES = """{{Event
|name              = Frames of Fierce Splendor
|type              = In-Game
|time_known        = yes
|time_start        = 2026-11-27 11:00:00
|time_end          = 2026-12-07 03:59:59
}}
'''Frames of Fierce Splendor''' is an event.
"""
LEY_LINE = """{{Event
|name = Ley Line Overflow
|type = In-Game
|time_known = yes
|time_start = 2026-12-07 04:00:00
|time_end = 2026-12-14 03:59:59
}}"""
UNKNOWN_TIME = """{{Event
|name = Stress Block Smashing Project
|time_known = no
|time_start = 2026-12-01 11:00:00
|time_end = 2026-12-10 03:59:59
}}"""
NO_END = "{{Event\n|name = Half\n|time_known = yes\n|time_start = 2026-12-01 11:00:00\n|time_end =\n}}"
NO_EVENT = "{{Infobox Version|name = 7.3}}\nText."


def category(*titles: str) -> bytes:
    return json.dumps({"batchcomplete": True, "query": {"categorymembers": [
        {"pageid": index, "ns": 0, "title": title} for index, title in enumerate(titles)
    ]}}).encode()


def pages(**texts: str) -> bytes:
    """An answer to the pages' request: `texts` by title (underscores for spaces in the keyword)."""
    return json.dumps({"batchcomplete": True, "query": {"pages": [
        {"pageid": 1, "ns": 0, "title": title.replace("_", " "), "revisions": [{"slots": {"main": {
            "contentmodel": "wikitext", "contentformat": "text/x-wiki", "content": text,
        }}}]} for title, text in texts.items()
    ]}}).encode()


# ---------------------------------------------------------------- the parse

def test_a_page_with_a_known_time_gives_its_event():
    assert parse_wikitext("Frames of Fierce Splendor", FRAMES) == {
        "name": "Frames of Fierce Splendor", "type": "In-Game",
        "starts": "2026-11-27 11:00:00", "ends": "2026-12-07 03:59:59",
    }


def test_a_page_whose_time_is_not_known_or_not_complete_gives_nothing():
    for text in (UNKNOWN_TIME, NO_END, NO_EVENT, "", "{{Event\n|name = Never closed\n|time_known = yes"):
        assert parse_wikitext("Anything", text) is None
    swapped = FRAMES.replace("2026-11-27 11:00:00", "2026-12-09 11:00:00")  # ends before it starts
    assert parse_wikitext("Frames of Fierce Splendor", swapped) is None
    assert parse_wikitext("X", FRAMES.replace("2026-11-27", "2026-13-27")) is None  # not a date


def test_a_title_with_a_date_suffix_is_the_event_of_that_name():
    nameless = LEY_LINE.replace("|name = Ley Line Overflow\n", "")
    assert parse_wikitext("Ley Line Overflow/2026-12-07", nameless)["name"] == "Ley Line Overflow"
    named = LEY_LINE.replace("Ley Line Overflow", "Ley Line Overflow/2026-12-07")
    assert parse_wikitext("Ley Line Overflow/2026-12-07", named)["name"] == "Ley Line Overflow"


def test_comments_links_and_other_templates_do_not_confuse_the_parse():
    text = (
        "{{Event\n|name = [[Frames of Fierce Splendor|Frames]] <!-- renamed -->\n|type = {{Tag|In-Game}}\n"
        "|time_known = Yes\n|time_start = 2026-11-27 11:00\n|time_end = <!-- old -->2026-12-07 03:59:59\n}}"
    )
    event = parse_wikitext("Frames", text)
    assert (event["name"], event["starts"], event["ends"]) == ("Frames", "2026-11-27 11:00:00", "2026-12-07 03:59:59")


def test_the_pages_answer_gives_the_events_among_its_pages():
    body = pages(Frames_of_Fierce_Splendor=FRAMES, Ley_Line_Overflow=LEY_LINE, Stress=UNKNOWN_TIME, Version_7_3=NO_EVENT)
    assert [event["name"] for event in parse_events(body)] == ["Frames of Fierce Splendor", "Ley Line Overflow"]
    missing = json.dumps({"query": {"pages": [{"title": "Gone", "missing": True}, "junk", {"title": 3}]}}).encode()
    assert parse_events(missing) == []
    for body in (b"[]", b'{"query": {}}', b'{"query": {"pages": 3}}', b"not json"):
        with pytest.raises(ValueError):
            parse_events(body)


def test_the_categorys_titles_are_those_of_pages_that_can_be_asked_for():
    body = json.dumps({"query": {"categorymembers": [
        {"ns": 0, "title": "Frames of Fierce Splendor"}, {"ns": 0, "title": "Version/7.3"}, {"ns": 14, "title": "Category:X"},
        {"ns": 0, "title": "Bad|Title"}, {"ns": 0, "title": ""}, {"ns": 0, "title": "Frames of Fierce Splendor"},
        {"ns": 0, "title": "Ley Line Overflow/2026-12-07"}, {"ns": 0}, "junk",
    ]}}).encode()
    assert parse_titles(body) == ["Frames of Fierce Splendor", "Ley Line Overflow/2026-12-07"]
    many = category(*(f"Page {number}" for number in range(300)))
    assert len(parse_titles(many)) == 100
    for body in (b"{}", b'{"query": {"categorymembers": 1}}'):
        with pytest.raises(ValueError):
            parse_titles(body)


# ---------------------------------------------------------------- the reads: once a day, after the consent, none in the demo

class Wire:
    """The two answers, and what was asked."""

    def __init__(self) -> None:
        self.titles = ["Frames of Fierce Splendor", "Ley Line Overflow/2026-12-07", "Version/7.3"]
        self.texts = {"Frames of Fierce Splendor": FRAMES, "Ley Line Overflow/2026-12-07": LEY_LINE}
        self.asked: list[str] = []
        self.failure: Exception | None = None

    def upcoming(self) -> bytes:
        self.asked.append("category")
        if self.failure is not None:
            raise self.failure
        return category(*self.titles)

    def pages(self, titles) -> bytes:
        self.asked.append("pages:" + "|".join(titles))
        if self.failure is not None:
            raise self.failure
        return pages(**{title.replace(" ", "_"): self.texts[title] for title in titles})


def make(store, clock, wire, *, ready=lambda: True, bus=None) -> FandomEvents:
    return FandomEvents(store, clock, bus or EventBus(), wire.upcoming, wire.pages, ready)


async def test_a_read_keeps_the_events_and_the_pages_asked_for_are_the_categorys(store):
    clock, wire = FakeClock(NOW), Wire()
    assert await make(store, clock, wire).refresh() is True
    assert wire.asked == ["category", "pages:Frames of Fierce Splendor|Ley Line Overflow/2026-12-07"]  # not Version/7.3
    kept = store.latest_doc(DOC)
    assert kept[0] == NOW and [event["name"] for event in kept[1]["events"]] == ["Frames of Fierce Splendor", "Ley Line Overflow"]
    assert kept_dates(store) == {
        "frames of fierce splendor": ("2026-11-27 11:00:00", "2026-12-07 03:59:59"),
        "ley line overflow": ("2026-12-07 04:00:00", "2026-12-14 03:59:59"),
    }


async def test_more_than_fifty_pages_are_asked_for_fifty_at_a_time(store):
    wire = Wire()
    wire.titles = [f"Page {number}" for number in range(75)]
    wire.texts = {title: FRAMES for title in wire.titles}
    assert await make(store, FakeClock(NOW), wire).refresh() is True
    assert [len(ask.split("|")) for ask in wire.asked[1:]] == [50, 25]


async def test_it_is_read_at_most_once_a_day(store):
    clock, wire = FakeClock(NOW), Wire()
    service = make(store, clock, wire)
    assert await service.refresh() is True
    for _ in range(3):
        clock.advance(hours=7)
        assert await service.refresh() is False
    assert len(wire.asked) == 2  # 21 hours on
    clock.advance(hours=3)
    assert await make(store, clock, wire).refresh() is True  # a new service, as a start of Guild Board makes: still a day
    assert len(wire.asked) == 4
    assert FETCH_EVERY == timedelta(days=1)


async def test_nothing_is_read_before_the_consent(store):
    wire, consented = Wire(), [False]
    service = make(store, FakeClock(NOW), wire, ready=lambda: consented[0])
    assert await service.refresh() is False
    assert wire.asked == [] and store.latest_doc(DOC) is None
    consented[0] = True
    assert await service.refresh() is True


async def test_a_failed_read_keeps_the_answer_and_waits_a_quarter_of_an_hour(store, caplog):
    clock, wire = FakeClock(NOW), Wire()
    service = make(store, clock, wire)
    assert await service.refresh() is True
    clock.advance(days=1, minutes=1)
    wire.failure = urllib.error.URLError("no route https://genshin-impact.fandom.com/api.php?secret")
    with caplog.at_level("WARNING"):
        assert await service.refresh() is False
    assert [event["name"] for event in store.latest_doc(DOC)[1]["events"]] == ["Frames of Fierce Splendor", "Ley Line Overflow"]
    assert "URLError" in caplog.text and "fandom.com" not in caplog.text and "secret" not in caplog.text
    asked = len(wire.asked)
    clock.advance(minutes=14)
    assert await service.refresh() is False and len(wire.asked) == asked
    clock.advance(minutes=1)
    wire.failure = None
    assert RETRY_AFTER == timedelta(minutes=15)
    assert await service.refresh() is True and store.latest_doc(DOC)[0] == clock.now()


async def test_a_restart_does_not_read_sooner_than_the_failed_read_allows(store):
    clock, wire = FakeClock(NOW), Wire()
    wire.failure = urllib.error.URLError("offline")
    assert await make(store, clock, wire).refresh() is False
    asked = len(wire.asked)
    clock.advance(minutes=10)
    assert await make(store, clock, wire).refresh() is False and len(wire.asked) == asked  # a new service: still the quarter hour
    clock.advance(minutes=5)
    wire.failure = None
    assert await make(store, clock, wire).refresh() is True
    assert store.meta(FAILED) is None


async def test_a_read_that_keeps_failing_is_tried_less_and_less_often(store):
    clock, wire = FakeClock(NOW), Wire()
    wire.failure = urllib.error.URLError("offline")
    waits = [timedelta(minutes=15), timedelta(hours=1), timedelta(hours=4), timedelta(days=1), timedelta(days=1)]
    for wait in waits:
        service = make(store, clock, wire)  # each try after a restart, which the kept failure outlasts
        assert await service.refresh() is False
        asked = len(wire.asked)
        clock.advance(seconds=wait.total_seconds() - 1)
        assert await make(store, clock, wire).refresh() is False and len(wire.asked) == asked
        clock.advance(seconds=1)
    wire.failure = None
    assert await make(store, clock, wire).refresh() is True and store.meta(FAILED) is None
    assert RETRY_STEPS[0] == RETRY_AFTER


async def test_an_answer_it_cannot_read_is_a_failed_read(store):
    wire = Wire()
    wire.upcoming = lambda: b"<html>not the API</html>"
    clock = FakeClock(NOW)
    service = make(store, clock, wire)
    assert await service.refresh() is False and store.latest_doc(DOC) is None


async def test_the_run_reads_at_the_consents_settings_change_and_survives_a_failure(store):
    clock, wire, bus, consented = FakeClock(NOW), Wire(), EventBus(), [False]
    task = asyncio.create_task(make(store, clock, wire, ready=lambda: consented[0], bus=bus).run())
    try:
        for _ in range(5):
            await asyncio.sleep(0)
        bus.publish("sync_finished", outcome="ok")
        for _ in range(5):
            await asyncio.sleep(0)
        assert wire.asked == []
        consented[0] = True
        bus.publish("settings_changed")
        for _ in range(50):
            if store.latest_doc(DOC) is not None:
                break
            await asyncio.sleep(0.01)
        assert store.latest_doc(DOC) is not None and len(wire.asked) == 2
        assert not task.done()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


# ---------------------------------------------------------------- the core: live reads it, the demo none

def _core(tmp_path, clock, demo: bool) -> Core:
    return Core(
        AppPaths(tmp_path / ("demo" if demo else "live")), demo=demo, clock=clock,
        source=None if demo else AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
    )


def test_the_live_core_reads_the_wiki_through_netpolicy_and_the_demo_none(tmp_path, clock):
    live, demo = _core(tmp_path, clock, False), _core(tmp_path, clock, True)
    try:
        assert live.fandom_events._fetch_upcoming is netpolicy.fetch_fandom_upcoming
        assert live.fandom_events._fetch_pages is netpolicy.fetch_fandom_pages
        assert live.fandom_events._ready() is False  # until the first run's consent
        assert demo.fandom_events._fetch_upcoming is None and demo.fandom_events._fetch_pages is None
    finally:
        live.store.close()
        demo.store.close()


async def test_the_demo_core_asks_for_nothing(tmp_path, clock):
    demo = _core(tmp_path, clock, True)
    try:
        assert await demo.fandom_events.refresh() is False
        await asyncio.wait_for(demo.fandom_events.run(), 1)  # ends at once: nothing to run
        assert demo.store.latest_doc(DOC) is None
    finally:
        demo.store.close()


class Response:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, size: int = -1) -> bytes:
        return self._body[:size] if size >= 0 else self._body


async def test_the_real_reads_send_two_shapes_of_one_address_with_the_user_agent_alone_and_no_redirect(store, monkeypatch):
    sent = []

    def wire(request, timeout=None):
        sent.append(request)
        query = dict(parse_qsl(urlsplit(request.full_url).query))
        if query.get("list") == "categorymembers":
            return Response(category("Frames of Fierce Splendor", "Ley Line Overflow/2026-12-07"))
        return Response(pages(Frames_of_Fierce_Splendor=FRAMES, **{"Ley_Line_Overflow/2026-12-07": LEY_LINE}))

    monkeypatch.setattr(netpolicy, "_open", wire)
    service = FandomEvents(store, FakeClock(NOW), EventBus(), *fandom_events.live_fetchers(), ready=lambda: True)
    assert await service.refresh() is True
    assert len(sent) == 2
    for request in sent:
        assert netpolicy.is_fandom_query(request.full_url) and request.get_method() == "GET" and request.data is None
        assert request.headers == {"User-agent": "GuildBoard"} and request.follow_redirects is False
    assert len(kept_dates(store)) == 2


# ---------------------------------------------------------------- the join in the Calendar's view

SERVER = "os_euro"  # UTC+1


def _keep(store, *events: CalendarEvent) -> None:
    store.set_latest_doc("calendar", NOW - timedelta(minutes=5), asdict(CalendarRecord(2, 2, None, CalendarBoardRecord((), events))))


def _soon(ident: int, name: str) -> CalendarEvent:
    return CalendarEvent(ident, name, None, None, False, None, None, None, None, status=1, dated=False)


def _dated(ident: int, name: str, begins: float, finishes: float) -> CalendarEvent:
    return CalendarEvent(
        ident, name, iso(NOW + timedelta(days=begins)), iso(NOW + timedelta(days=finishes)), False, None, None, None, None,
        status=2, dated=True,
    )


def _wiki(store, *events: dict) -> None:
    store.set_latest_doc(DOC, NOW - timedelta(hours=1), {"events": list(events)})


def test_an_undated_event_takes_the_wikis_dates_in_server_time(store):
    _keep(store, _soon(1, "Frames  of Fierce SPLENDOR"), _soon(2, "Stargazer's Vigil"))
    _wiki(store, {"name": "Frames of Fierce Splendor", "type": "In-Game", "starts": "2026-11-27 11:00:00", "ends": "2026-12-07 03:59:59"})
    view = build_calendar(store, NOW, SERVER)
    frames, other = view["events"]
    # 11:00 on Europe's server, an hour ahead of UTC.
    assert (frames["starts"], frames["ends"]) == ("2026-11-27T10:00:00+00:00", "2026-12-07T02:59:59+00:00")
    assert (frames["soon"], frames["source"]) == (False, "fandom")
    assert (other["starts"], other["ends"], other["soon"], other["source"]) == (None, None, True, "hoyolab")
    assert view["upcoming_from"] == UPCOMING_FROM == "Genshin Impact Wiki (Fandom)"
    assert view["left"] == 0  # not started yet


def test_the_same_dates_follow_the_account_servers_offset(store):
    _keep(store, _soon(1, "Frames of Fierce Splendor"))
    _wiki(store, {"name": "Frames of Fierce Splendor", "type": "", "starts": "2026-11-27 11:00:00", "ends": "2026-12-07 03:59:59"})
    asia = build_calendar(store, NOW, "os_asia")["events"][0]
    assert asia["starts"] == "2026-11-27T03:00:00+00:00"
    america = build_calendar(store, NOW, "os_usa")["events"][0]
    assert america["starts"] == "2026-11-27T16:00:00+00:00"


def test_an_event_hoyolab_dates_itself_keeps_hoyolabs_dates_and_the_wikis_extras_are_not_added(store):
    _keep(store, _dated(1, "Frames of Fierce Splendor", -1, 5))
    _wiki(
        store,
        {"name": "Frames of Fierce Splendor", "type": "", "starts": "2026-11-27 11:00:00", "ends": "2026-12-07 03:59:59"},
        {"name": "Ley Line Overflow", "type": "", "starts": "2026-12-07 04:00:00", "ends": "2026-12-14 03:59:59"},
    )
    view = build_calendar(store, NOW, SERVER)
    assert [(event["name"], event["source"], event["starts"]) for event in view["events"]] == [
        ("Frames of Fierce Splendor", "hoyolab", iso(NOW - timedelta(days=1))),
    ]
    assert view["upcoming_from"] is None and view["left"] == 1


def test_with_no_wiki_dates_an_undated_event_stays_coming_soon(store):
    _keep(store, _soon(1, "Frames of Fierce Splendor"))
    for kept in (None, {"events": []}, {"events": "junk"}, {"events": [{"name": "Other", "starts": "2026-11-27 11:00:00", "ends": "2026-12-07 03:59:59"}]}):
        if kept is not None:
            store.set_latest_doc(DOC, NOW, kept)
        view = build_calendar(store, NOW, SERVER)
        event = view["events"][0]
        assert (event["soon"], event["starts"], event["ends"], event["source"]) == (True, None, None, "hoyolab")
        assert view["upcoming_from"] is None


def test_a_calendar_not_read_yet_names_no_source(store):
    _wiki(store, {"name": "X", "type": "", "starts": "2026-11-27 11:00:00", "ends": "2026-12-07 03:59:59"})
    view = build_calendar(store, NOW, SERVER)
    assert view["read"] is False and view["upcoming_from"] is None
