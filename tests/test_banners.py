"""The banners running now, read from HoYoverse's announcements (the Pulls plan, Task 8).

The answers are those of tests/pulls_samples.py, cut from HoYoverse's of 2026-10-24; no test reaches HoYoverse.
"""
import asyncio
import logging
import urllib.error
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from guildboard import netpolicy
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.events import EventBus
from guildboard.metrics import Label
from guildboard.pulls.banners import ANN_CONTENT_URL, ANN_LIST_URL, Banners, ann_url, parse_banners
from guildboard.store import BannerRow, WishRow
from pulls_samples import (
    ANN_CONTENT, ANN_END, ANN_LIST, ANN_START, EPITOME_ART, ESCOFFIER_ART, FROZEN_WILDS_ENTRY, IN_COMBAT, SKIRK_ART,
    SKIRK_ENTRY, SKIRK_TITLE, ann_content, ann_list, content_entry, first_half_content, wish_content,
)
from support import AccountSource, FakeClock, FakeSleep

NOW = datetime(2026, 10, 24, 1, 11, tzinfo=timezone.utc)
RUN_START = datetime(2026, 10, 13, 17, 0, tzinfo=timezone.utc)  # 2026/10/13 18:00 on Europe's server
RUN_END = datetime(2026, 11, 3, 13, 59, tzinfo=timezone.utc)  # 2026/11/03 14:59


def entry(ann_id: int, title: str, banner: str = SKIRK_ART, **changes):
    return {**SKIRK_ENTRY, "ann_id": ann_id, "title": title, "banner": banner, **changes}


def content(ann_id: int, title: str, html: str):
    return content_entry(ann_id, title, "", SKIRK_ART, html)


def test_the_addresses_are_hoyoverses_announcements():
    base = "https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/"
    assert (ANN_LIST_URL, ANN_CONTENT_URL) == (base + "getAnnList", base + "getAnnContent")
    assert ann_url(ANN_LIST_URL, "os_euro", 1, 60) == (
        base + "getAnnList?game=hk4e&game_biz=hk4e_global&lang=en&bundle_id=hk4e_global&platform=pc"
        "&region=os_euro&level=60&uid=1"
    )
    assert ann_url(ANN_CONTENT_URL, "os_asia", 812345678, 58).endswith("&region=os_asia&level=58&uid=812345678")


def test_the_three_wishes_of_october_are_parsed():
    rows = parse_banners(ANN_LIST, ANN_CONTENT, NOW)
    assert [(row.ann_id, row.name, row.pool, row.featured) for row in rows] == [
        (21888, "Void Star's Advent", "character", ("Skirk",)),
        (21889, "La Chanson Cerise", "character", ("Escoffier",)),
        (21890, "Epitome Invocation", "weapon", ("Azurelight", "Symphonist of Scents")),
    ]
    for row in rows:
        # The banner's own run, from the two times in its content: the server's time, an hour ahead of UTC.
        assert (row.starts_at.isoformat(), row.ends_at.isoformat()) == (
            "2026-10-13T17:00:00+00:00", "2026-11-03T13:59:00+00:00"
        )
        assert urlsplit(row.art_url).hostname == "sdk.hoyoverse.com"
        assert row.read_at == NOW
    assert [row.art_url for row in rows] == [SKIRK_ART, ESCOFFIER_ART, EPITOME_ART]


def test_a_content_without_times_takes_the_announcements_times():
    for html in ("<p>No times here.</p>", wish_content(IN_COMBAT, "Featured", "x").replace("2026/10/13 18:00", "soon")):
        [row] = parse_banners(ann_list(SKIRK_ENTRY), ann_content(content(21888, SKIRK_TITLE, html)), NOW)
        # The announcement's start_time and end_time, in the server's time: 2026-10-08 03:00:00 to 2026-11-03 14:59:59.
        assert (row.starts_at, row.ends_at) == (
            datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc), datetime(2026, 11, 3, 13, 59, 59, tzinfo=timezone.utc)
        )
    # No content at all for the entry: the same.
    [row] = parse_banners(ann_list(SKIRK_ENTRY), ann_content(), NOW)
    assert (row.starts_at, row.art_url) == (datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc), SKIRK_ART)
    assert (ANN_START, ANN_END) == ("2026-10-08 03:00:00", "2026-11-03 14:59:59")


def test_a_first_half_wish_runs_by_its_announcements_times():
    # A wish of a version's first half starts with the update: its content says "After the Version 7.2 update – <end>",
    # so the first time in it is the end, and a later time in it is something else's. Such a pair is no run: the
    # announcement's own times stand in, and the banner runs through the first half.
    first_half = {**SKIRK_ENTRY, "start_time": "2026-11-04 06:00:00", "end_time": "2026-11-24 17:59:59"}
    # After the announcement's end, before the wish's own end, and twice within a day after the end, where only the
    # pair's length tells it from a run: a minute, then nine hours.
    for later in ("2026/12/15 03:59", "2026/11/10 04:00", "2026/11/24 18:00", "2026/11/25 03:00"):
        html = first_half_content("2026/11/24 17:59", later)
        [row] = parse_banners(ann_list(first_half), ann_content(content(21888, SKIRK_TITLE, html)), NOW)
        assert (row.starts_at, row.ends_at) == (
            datetime(2026, 11, 4, 5, 0, tzinfo=timezone.utc), datetime(2026, 11, 24, 16, 59, 59, tzinfo=timezone.utc)
        ), later


def test_a_content_run_is_taken_within_a_day_of_the_announcements_times():
    # The October wishes' own runs lie inside their announcements' times (test_the_three_wishes_of_october_are_parsed).
    # A day either side still counts as the wish's own; further out, the announcement's times stand in.
    def run_of(start: str, end: str) -> tuple[datetime, datetime]:
        html = wish_content(IN_COMBAT, "Featured", "x", start, end)
        [row] = parse_banners(ann_list(SKIRK_ENTRY), ann_content(content(21888, SKIRK_TITLE, html)), NOW)
        return row.starts_at, row.ends_at

    own = (datetime(2026, 10, 8, 2, 0, tzinfo=timezone.utc), datetime(2026, 11, 3, 13, 59, 59, tzinfo=timezone.utc))
    # The announcement shows from 2026-10-08 03:00:00 to 2026-11-03 14:59:59, in the server's time.
    assert run_of("2026/10/07 03:30", "2026/11/04 14:00") == (
        datetime(2026, 10, 7, 2, 30, tzinfo=timezone.utc), datetime(2026, 11, 4, 13, 0, tzinfo=timezone.utc)
    )
    assert run_of("2026/10/07 02:59", "2026/11/03 14:59") == own  # a start more than a day before it
    assert run_of("2026/10/13 18:00", "2026/11/04 15:00") == own  # an end more than a day after it
    assert run_of("2026/11/03 14:59", "2026/10/13 18:00") == own  # an end before the start


def test_a_content_run_stands_alone_where_the_announcements_times_cannot_be_read():
    # Without its announcement's own times, a wish's run is its content's alone, when it is long enough to be one. A
    # pair nine hours apart (a first-half wish's end and a note after it) is no run, and the wish is left out.
    timeless = {key: value for key, value in SKIRK_ENTRY.items() if key not in ("start_time", "end_time")}
    [row] = parse_banners(ann_list(timeless), ANN_CONTENT, NOW)
    assert (row.starts_at, row.ends_at) == (RUN_START, RUN_END)
    html = first_half_content("2026/11/24 17:59", "2026/11/25 03:00")
    assert parse_banners(ann_list(timeless), ann_content(content(21888, SKIRK_TITLE, html)), NOW) == []


def test_the_times_follow_the_servers_offset():
    asia = parse_banners(ann_list(SKIRK_ENTRY, timezone=8), ANN_CONTENT, NOW)
    assert asia[0].starts_at == datetime(2026, 10, 13, 10, 0, tzinfo=timezone.utc)
    america = parse_banners(ann_list(SKIRK_ENTRY, timezone=-5), ANN_CONTENT, NOW)
    assert america[0].ends_at == datetime(2026, 11, 3, 19, 59, tzinfo=timezone.utc)


def test_a_chronicled_wish_is_its_pool():
    # No chronicled wish ran on 2026-10-23, so its title's wording is a guess: the title's own start, or a name that
    # says so, makes it chronicled, before anything else in the title can make it the weapon event.
    titles = {
        31001: 'Chronicled Wish "Ode to the Dawn Breeze" - Boosted Drop Rates for Mondstadt Characters and Weapons!',
        31002: 'Event Wish "Chronicled Wish: Liyue" - Boosted Drop Rate for "Geo Archon" Zhongli (Geo)!',
        31003: 'Event Wish "Lightrace Wish" - Boosted Drop Rate for "Heavenlit Prophecy" Columbina (Hydro)!',
    }
    events = [entry(ann_id, title) for ann_id, title in titles.items()]
    rows = parse_banners(ann_list(*events), ann_content(), NOW)
    assert [(row.ann_id, row.pool) for row in rows] == [(31001, "chronicled"), (31002, "chronicled"), (31003, "chronicled")]
    assert rows[0].name == "Ode to the Dawn Breeze"


def test_a_name_that_holds_and_is_one_name():
    # The wiki lists a 5★ polearm "Disaster and Remorse": each name ends in its "(…)", and the split is made after one.
    title = 'Event Wish "Epitome Invocation" - Boosted Drop Rates for Disaster and Remorse (Polearm) and Azurelight (Sword)!'
    [row] = parse_banners(ann_list(entry(21890, title)), ann_content(), NOW)
    assert (row.pool, row.featured) == ("weapon", ("Disaster and Remorse", "Azurelight"))
    # Without "(…)" after the names, the split is on " and " and ", ", as the titles' lists are written.
    plain = 'Event Wish "Epitome Invocation" - Boosted Drop Rates for Azurelight, Mistsplitter Reforged and Polar Star!'
    [row] = parse_banners(ann_list(entry(21890, plain)), ann_content(), NOW)
    assert row.featured == ("Azurelight", "Mistsplitter Reforged", "Polar Star")
    # A quoted title before a name is no part of the name, whatever it holds.
    quoted = 'Event Wish "Twirling Lotus" - Boosted Drop Rate for "Bloom and Doom, Reborn" Nilou (Hydro)!'
    [row] = parse_banners(ann_list(entry(21888, quoted)), ann_content(), NOW)
    assert (row.name, row.pool, row.featured) == ("Twirling Lotus", "character", ("Nilou",))


def test_a_title_written_in_lower_case_keeps_its_pool():
    # HoYoverse's title for Mitya's wish, 2026-11-04, writes "drop rate" in lower case; it is still the character event.
    mitya = 'Event Wish "Myriad Patterns Unfold" - Boosted drop rate for "Rules Set at Naught" Mitya (Electro)!'
    weapons = 'Event Wish "Epitome Invocation" - Boosted drop rates for Starsealed Edict (Catalyst) and Azurelight (Sword)!'
    rows = parse_banners(ann_list(entry(21997, mitya), entry(21977, weapons)), ann_content(), NOW)
    assert [(row.name, row.pool, row.featured) for row in rows] == [
        ("Myriad Patterns Unfold", "character", ("Mitya",)),
        ("Epitome Invocation", "weapon", ("Starsealed Edict", "Azurelight")),
    ]


def test_other_announcements_are_left_out():
    rows = parse_banners(ANN_LIST, ANN_CONTENT, NOW)
    # The event that names the standard wish, and the Game and Miliastra Wonderland entries, are not banners.
    assert 21885 not in {row.ann_id for row in rows} and {21947, 21908}.isdisjoint(row.ann_id for row in rows)
    odd = [
        entry(41001, "A guide to Event Wish \"Void Star's Advent\""),  # the title does not start with it
        entry(41002, SKIRK_TITLE, type_label="Game"),  # not an event
        entry(41003, 'Event Wish "Mystery" - something new!'),  # a wish that is neither event's: its pool is other
    ]
    rows = parse_banners(ann_list(*odd), ann_content(), NOW)
    assert [(row.ann_id, row.pool, row.featured) for row in rows] == [(41003, "other", ())]


def test_an_answer_it_cannot_read_raises():
    for list_body, content_body in (
        (b"not json", ANN_CONTENT),
        (b'{"retcode": -1, "message": "error", "data": null}', ANN_CONTENT),
        (ANN_LIST, b'{"retcode": 0, "data": {"list": "nothing"}}'),
    ):
        with pytest.raises(ValueError):
            parse_banners(list_body, content_body, NOW)


# ---------------------------------------------------------------- Banners: the refresh and its runs

class Wire:
    """Stands in for netpolicy.fetch_hoyoverse: the announcements' answers by address, each address remembered."""

    def __init__(self, list_body: bytes = ANN_LIST, content_body: bytes = ANN_CONTENT) -> None:
        self.answers = {"getAnnList": list_body, "getAnnContent": content_body}
        self.asked: list[str] = []
        self.failure: Exception | None = None

    def __call__(self, url: str) -> bytes:
        self.asked.append(url)
        if self.failure is not None:
            raise self.failure
        return self.answers[urlsplit(url).path.rsplit("/", 1)[1]]


def make(store, clock, wire, uid=None, level=60, bus=None, ready=lambda: True, named=None):
    """Banners over the stand-in, for a player who has given the first run's consent unless `ready` says otherwise."""
    return Banners(store, clock, bus or EventBus(), wire, lambda: "os_euro", lambda: uid, lambda: level, ready, named=named)


def kept_banner(store, read_at):
    store.replace_banners([BannerRow(1, "Old", "character", ("Someone",), SKIRK_ART, RUN_START, RUN_END, read_at)])


async def test_refresh_keeps_the_banners_and_their_art_labels(store):
    clock, wire, bus = FakeClock(NOW), Wire(), EventBus()
    heard = bus.subscribe()
    assert await make(store, clock, wire, bus=bus).refresh() == 3
    assert [row.ann_id for row in store.banners()] == [21888, 21889, 21890]
    assert store.labels("banner") == {
        f"banner.{ann_id}": Label(f"banner.{ann_id}", name, "banner", None, art)
        for ann_id, name, art in (
            (21888, "Void Star's Advent", SKIRK_ART), (21889, "La Chanson Cerise", ESCOFFIER_ART),
            (21890, "Epitome Invocation", EPITOME_ART),
        )
    }
    assert heard.get_nowait() == {"type": "pulls_changed"}
    # Before a login: uid 1 and level 60, and nothing of the player's.
    assert [urlsplit(url).path.rsplit("/", 1)[1] for url in wire.asked] == ["getAnnList", "getAnnContent"]
    sent = parse_qs(urlsplit(wire.asked[0]).query)
    assert (sent["uid"], sent["level"], sent["region"]) == (["1"], ["60"], ["os_euro"])
    # With a login: its uid and the adventure rank the overview read.
    wire.asked.clear()
    assert await make(store, clock, wire, uid=700000001, level=58).refresh(force=True) == 3
    assert {(parse_qs(urlsplit(url).query)["uid"][0], parse_qs(urlsplit(url).query)["level"][0]) for url in wire.asked} == {
        ("700000001", "58")
    }


async def test_a_read_that_keeps_a_new_featured_name_asks_for_the_icons(store):
    # The wiki's icons are read for a featured name the banners kept had not named before (the core reads them when one
    # lacks its icon, at most once a day): at the first read, and when a new wish brings a new name; not for the same names.
    clock, wire, named = FakeClock(NOW), Wire(), []
    banners = make(store, clock, wire, named=lambda: named.append("icons"))
    assert await banners.refresh() == 3
    assert named == ["icons"]
    clock.advance(hours=2)
    assert await banners.refresh() == 3
    assert named == ["icons"]
    mavuika = entry(21891, 'Event Wish "Ember of Natlan" - Boosted Drop Rate for "Sunlit" Mavuika (Pyro)!')
    wire.answers["getAnnList"] = ann_list(SKIRK_ENTRY, mavuika)
    clock.advance(hours=2)
    assert await banners.refresh() == 2
    assert named == ["icons", "icons"]
    # A read that fails, or names no wish, keeps the banners kept, and asks for nothing.
    clock.advance(hours=2)
    wire.answers["getAnnList"] = ann_list(FROZEN_WILDS_ENTRY)
    assert await banners.refresh() == -1
    wire.failure = urllib.error.URLError("no route")
    clock.advance(hours=2)
    assert await banners.refresh() == -1
    assert named == ["icons", "icons"]


async def test_refresh_is_skipped_within_an_hour_unless_forced(store):
    clock, wire = FakeClock(NOW), Wire()
    banners = make(store, clock, wire)
    assert await banners.refresh() == 3
    clock.advance(minutes=59)
    assert await banners.refresh() == -1
    assert len(wire.asked) == 2
    assert await banners.refresh(force=True) == 3
    assert len(wire.asked) == 4
    clock.advance(minutes=61)
    assert await banners.refresh() == 3
    assert len(wire.asked) == 6
    # Banners kept from an earlier start count as well: younger than an hour, they are not read again.
    clock.advance(minutes=30)
    assert await make(store, clock, wire).refresh() == -1


async def test_an_answer_with_no_wish_keeps_the_banners_kept(store, caplog):
    # Announcements that name no wish (another event only, or nothing) leave what is kept: the planner shows a banner
    # only while it runs, so an old one goes from the page by itself. It is said once an hour.
    clock = FakeClock(NOW)
    kept_banner(store, NOW - timedelta(hours=7))
    before = store.banners()
    caplog.set_level(logging.WARNING, logger="guildboard.pulls.banners")
    for listed, events in ((ann_list(FROZEN_WILDS_ENTRY), 1), (ann_list(), 0)):
        wire = Wire(list_body=listed)
        assert await make(store, clock, wire).refresh() == -1
        assert store.banners() == before and len(wire.asked) == 2
        clock.advance(minutes=61)
        assert f"no wish among {events} events" in caplog.text
    said = [record for record in caplog.records if "no wish among" in record.getMessage()]
    banners = make(store, clock, Wire(list_body=ann_list(FROZEN_WILDS_ENTRY)))
    await banners.refresh()
    await banners.refresh()  # within the hour of the last line: not said again
    assert len([record for record in caplog.records if "no wish among" in record.getMessage()]) == len(said) + 1


async def test_nothing_is_read_before_the_players_consent(store):
    # The first run says "Before it starts, here is exactly what it does." and asks for the tick (ruling R15): until
    # then nothing reaches HoYoverse, but the Import the player presses. The tick starts the reads.
    clock, wire, bus = FakeClock(NOW), Wire(), EventBus()
    consented = [False]
    banners = make(store, clock, wire, bus=bus, ready=lambda: consented[0])
    task = asyncio.create_task(banners.run())
    try:
        for _ in range(5):
            await asyncio.sleep(0)
        bus.publish("sync_finished", outcome="ok")
        banners.wake()
        for _ in range(5):
            await asyncio.sleep(0)
        assert await banners.refresh() == -1
        assert wire.asked == [] and store.banners() == []
        consented[0] = True
        bus.publish("settings_changed")
        await _until(lambda: [row.ann_id for row in store.banners()] == [21888, 21889, 21890])
        assert len(wire.asked) == 2
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    # The read at Import is the player's own: it is made before the tick too.
    forced = Wire()
    clock.advance(minutes=5)
    assert await make(store, clock, forced, ready=lambda: False).refresh(force=True) == 3
    assert len(forced.asked) == 2


async def test_a_failed_refresh_keeps_the_old_banners(store, caplog):
    clock, wire = FakeClock(NOW), Wire()
    kept_banner(store, NOW - timedelta(hours=7))
    before = store.banners()
    banners = make(store, clock, wire)
    caplog.set_level(logging.WARNING, logger="guildboard.pulls.banners")
    for failure in (urllib.error.URLError("no route"), None, None):
        wire.failure = failure
        if failure is None:
            wire.answers["getAnnList"] = b'{"retcode": -1, "message": "error", "data": null}'
        assert await banners.refresh() == -1
        assert store.banners() == before
        clock.advance(minutes=20)
    # Logged once in the hour, whatever failed.
    assert len([record for record in caplog.records if "announcements" in record.getMessage()]) == 1
    clock.advance(minutes=1)
    assert await banners.refresh() == -1
    assert len([record for record in caplog.records if "announcements" in record.getMessage()]) == 2
    # The list itself failing, the content is not asked for.
    wire.asked.clear()
    wire.failure = urllib.error.URLError("no route")
    await banners.refresh()
    assert len(wire.asked) == 1


async def test_the_demo_refreshes_nothing(store):
    clock, bus = FakeClock(NOW), EventBus()
    heard = bus.subscribe()
    demo = Banners(store, clock, bus, None, lambda: "os_euro", lambda: None, lambda: 60, lambda: True)
    assert await demo.refresh() == -1
    assert await demo.refresh(force=True) == -1
    await asyncio.wait_for(demo.run(), 1)  # the demo's run ends at once: it has nothing to read
    assert store.banners() == [] and heard.empty()


async def _until(condition, seconds: float = 5.0) -> None:
    deadline = asyncio.get_running_loop().time() + seconds
    while not condition():
        assert asyncio.get_running_loop().time() < deadline, "it did not happen in time"
        await asyncio.sleep(0.01)


async def test_run_refreshes_at_a_start_without_banners_or_with_old_ones(store):
    for read_at in (None, NOW - timedelta(hours=6, minutes=1)):
        store.replace_banners([])
        if read_at is not None:
            kept_banner(store, read_at)
        wire = Wire()
        task = asyncio.create_task(make(store, FakeClock(NOW), wire).run())
        try:
            await _until(lambda: [row.ann_id for row in store.banners()] == [21888, 21889, 21890])
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        assert len(wire.asked) == 2


async def test_run_refreshes_after_a_sync(store):
    clock, wire, bus = FakeClock(NOW), Wire(), EventBus()
    kept_banner(store, NOW - timedelta(hours=2))  # younger than six hours: not read at the start
    banners = make(store, clock, wire, bus=bus)
    task = asyncio.create_task(banners.run())
    try:
        for _ in range(5):
            await asyncio.sleep(0)
        assert wire.asked == []
        bus.publish("state_changed", state="syncing", message=None)
        bus.publish("sync_finished", outcome="ok")
        await _until(lambda: [row.ann_id for row in store.banners()] == [21888, 21889, 21890])
        assert len(wire.asked) == 2
        # A wake asks again, an hour after that read.
        clock.advance(hours=1, minutes=1)
        banners.wake()
        await _until(lambda: len(wire.asked) == 4)
        # A refresh that fails does not end the watch.
        clock.advance(hours=2)
        wire.failure = urllib.error.URLError("no route")
        bus.publish("sync_finished", outcome="failed")
        await _until(lambda: len(wire.asked) == 5)
        wire.failure = None
        bus.publish("sync_finished", outcome="ok")
        await _until(lambda: len(wire.asked) == 7)
        assert not task.done()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


# ---------------------------------------------------------------- the core: HoYoverse's pages live, none in the demo

def _core(tmp_path, clock, demo: bool) -> Core:
    return Core(
        AppPaths(tmp_path / ("demo" if demo else "live")), demo=demo, clock=clock,
        source=None if demo else AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
    )


def test_the_live_core_reads_hoyoverses_pages_and_the_demo_none(tmp_path, clock):
    live, demo = _core(tmp_path, clock, False), _core(tmp_path, clock, True)
    try:
        assert live.banners._fetch is netpolicy.fetch_hoyoverse and live.wiki._fetch is netpolicy.fetch_hoyoverse
        assert demo.banners._fetch is None and demo.wiki._fetch is None
        # The live core's banners wait for the first run's consent (ruling R15).
        assert live.banners._ready() is False
        live.update_settings({"risk_acknowledged": True})
        assert live.banners._ready() is True
    finally:
        live.store.close()
        demo.store.close()


async def test_after_an_import_the_banners_and_then_the_icons_are_read(tmp_path, clock, monkeypatch):
    core = _core(tmp_path, clock, False)
    calls: list[tuple] = []

    async def banners_refresh(force: bool = False) -> int:
        calls.append(("banners", force))
        return 3

    async def wiki_refresh(names=(), force: bool = False) -> None:
        calls.append(("wiki", set(names), force))

    monkeypatch.setattr(core.banners, "refresh", banners_refresh)
    monkeypatch.setattr(core.wiki, "refresh", wiki_refresh)
    try:
        import_id = core.store.start_wish_import(clock.now())
        core.store.add_wishes([
            WishRow(1, 700000001, "301", "character", "Skirk", "Character", 5, "2026-10-12 21:14:03", NOW, import_id),
            WishRow(2, 700000001, "301", "character", "Cool Steel", "Weapon", 3, "2026-10-12 21:14:03", NOW, import_id),
        ])
        core.store.replace_banners([BannerRow(21890, "Epitome Invocation", "weapon", ("Azurelight",), EPITOME_ART,
                                              RUN_START, RUN_END, NOW)])
        await core.wish_import._after(700000001)  # what the importer calls once an import ended well
    finally:
        core.store.close()
    assert calls == [("banners", True), ("wiki", {("character", "Skirk"), ("weapon", "Azurelight")}, False)]


def test_a_title_and_a_content_with_a_long_run_of_angle_brackets_are_read_fast():
    import time

    from guildboard.pulls import banners as banners_module

    started = time.perf_counter()
    assert banners_module._plain("<" * 1_000_000) == "<" * banners_module.MAX_FIELD_CHARS
    assert banners_module._plain('Event Wish "A" <b>bold</b> &lt;i&gt;x&lt;/i&gt;') == 'Event Wish "A" bold x'
    server = timezone.utc
    for content in ('<t class="t_lc"' * 100_000 + ">", '<t class="t_lc">' * 100_000, "<" * 1_000_000):
        assert banners_module._content_run(content, server) is None
    assert time.perf_counter() - started < 2.0
    one = '<t class="t_lc" contenteditable="false">2026/10/13 18:00</t> to <t class="t_lc">2026/11/03 17:59</t>'
    assert banners_module._content_run(one, server) is not None


async def test_the_announcements_are_parsed_off_the_event_loop(store, monkeypatch):
    import threading

    from guildboard.pulls import banners as banners_module

    seen = []
    real = banners_module.parse_banners
    monkeypatch.setattr(banners_module, "parse_banners", lambda *a: seen.append(threading.get_ident()) or real(*a))
    await make(store, FakeClock(NOW), Wire()).refresh(force=True)
    assert seen and threading.get_ident() not in seen
