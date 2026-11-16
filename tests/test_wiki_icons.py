"""The characters' and weapons' icons, from the HoYoLAB wiki's lists (the Pulls plan, Task 8).

The answers are those of tests/pulls_samples.py, cut from the wiki's of 2026-10-24; no test reaches HoYoLAB.
"""
import asyncio
import json
import time
import urllib.error
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.metrics import Label
from guildboard.characters.wiki import CharacterWiki
from guildboard.pulls.wiki import HEADERS, MENUS, PAGE_SIZE, WIKI_URL, WikiIcons, parse_items, wanted_names
from guildboard.store import BannerRow, WikiItemRow, WishRow
from pulls_history import keep_demo_like
from pulls_samples import ANN_CONTENT, ANN_LIST, CHARACTERS, SKIRK_ART, SKIRK_ICON, WEAPONS, WIKI_CHARACTERS, wiki_page
from support import AccountSource, FakeClock, FakeSleep

NOW = datetime(2026, 10, 24, 1, 11, tzinfo=timezone.utc)
PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"


def test_the_constants_are_the_facts():
    assert WIKI_URL == "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list"
    assert (MENUS, PAGE_SIZE) == ({"character": "2", "weapon": "4"}, 50)
    assert HEADERS == {
        "x-rpc-wiki_app": "genshin",
        "x-rpc-language": "en-us",
        "Origin": "https://wiki.hoyolab.com",
        "Referer": "https://wiki.hoyolab.com/",
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
    }


def test_parse_items_reads_names_icons_and_ranks():
    rows, total = parse_items("character", WIKI_CHARACTERS, NOW)
    assert total == 132
    assert [(row.name, row.rank) for row in rows] == [("Valeriy", 0), ("Dahlia", 4), ("Skirk", 5), ("Escoffier", 5)]
    skirk = rows[2]
    assert skirk == WikiItemRow("character", "Skirk", 5, SKIRK_ICON, "7706", NOW)
    weapons, total = parse_items("weapon", wiki_page(WEAPONS, 252), NOW)
    assert total == 252
    assert [(row.name, row.rank) for row in weapons] == [
        ("Breezeborne Refrain", 4), ("Disaster and Remorse", 5), ("Azurelight", 5), ("Symphonist of Scents", 5),
    ]
    # An entry without a name or an icon is no item; the others stay.
    odd = [*CHARACTERS, {"entry_page_id": "1", "name": "", "icon_url": "x"}, {"entry_page_id": "2", "name": "Nobody"}]
    assert len(parse_items("character", wiki_page(odd, 6), NOW)[0]) == 4


def test_the_lists_length_reads_in_text_as_the_wiki_gives_it_or_as_a_number():
    # The wiki gives the whole list's length in text, "132"; a number reads the same.
    for total in ("132", 132):
        body = json.dumps({"retcode": 0, "message": "OK", "data": {"list": CHARACTERS, "total": total}}).encode()
        assert parse_items("character", body, NOW)[1] == 132


@pytest.mark.parametrize("body", [b"not json", b'{"retcode": 100010, "message": "page_size error", "data": null}',
                                  b'{"retcode": 0, "data": {"list": "none", "total": 1}}', b'{"retcode": 0, "data": {"list": []}}',
                                  b'{"retcode": 0, "data": {"list": [], "total": "-1"}}',
                                  b'{"retcode": 0, "data": {"list": [], "total": -1}}',
                                  b'{"retcode": 0, "data": {"list": [], "total": true}}',
                                  b'{"retcode": 0, "data": {"list": [], "total": "13 2"}}',
                                  b'{"retcode": 0, "data": {"list": [], "total": "\xd9\xa1"}}'])
def test_a_list_it_cannot_read_raises(body):
    with pytest.raises(ValueError):
        parse_items("character", body, NOW)


class Wiki:
    """Stands in for netpolicy.fetch_hoyoverse: the wiki's pages by menu and page number, each request remembered."""

    def __init__(self, characters=CHARACTERS, weapons=WEAPONS, totals=(132, 252)) -> None:
        self.entries = {"2": characters, "4": weapons}
        self.totals = {"2": totals[0], "4": totals[1]}
        self.asked: list[tuple[str, int, int]] = []
        self.headers: list[dict[str, str]] = []
        self.fail_at: tuple[str, int] | None = None

    def __call__(self, url: str, *, headers=None, body=None) -> bytes:
        assert url == WIKI_URL
        asked = json.loads(body)
        assert (asked["filters"], asked["use_es"]) == ([], True)
        self.asked.append((asked["menu_id"], asked["page_num"], asked["page_size"]))
        self.headers.append(dict(headers))
        if self.fail_at == (asked["menu_id"], asked["page_num"]):
            raise urllib.error.URLError("no route")
        return wiki_page(self.entries[asked["menu_id"]] if asked["page_num"] == 1 else [], self.totals[asked["menu_id"]])


async def test_the_wiki_lists_are_read_whole_fifty_a_page(store):
    wiki = Wiki()
    icons = WikiIcons(store, FakeClock(NOW), wiki)
    await icons.refresh([("character", "Skirk")])
    assert wiki.asked == [("2", 1, 50), ("2", 2, 50), ("2", 3, 50), *(("4", page, 50) for page in range(1, 7))]
    assert all(headers == HEADERS for headers in wiki.headers)
    items = store.wiki_items()
    assert len(items) == 8 and items[("weapon", "Disaster and Remorse")].rank == 5
    assert {row.read_at for row in items.values()} == {NOW}
    assert store.labels("wish")["wish.character.skirk"] == Label("wish.character.skirk", "Skirk", "wish", None, SKIRK_ICON)
    assert "wish.weapon.disaster-and-remorse" in store.labels("wish")
    assert icons.icon("character", "Skirk") == "/api/icon/wish.character.skirk"
    assert icons.icon("weapon", "Symphonist of Scents") == "/api/icon/wish.weapon.symphonist-of-scents"
    assert icons.icon("character", "Nobody") is None and icons.icon("weapon", "Skirk") is None


async def test_every_name_kept_reads_nothing(store):
    wiki = Wiki()
    icons = WikiIcons(store, FakeClock(NOW), wiki)
    await icons.refresh([("character", "Skirk")])
    wiki.asked.clear()
    await icons.refresh([("character", "Skirk"), ("weapon", "Azurelight")])
    await icons.refresh()
    assert wiki.asked == []


async def test_a_name_the_wiki_lacks_waits_for_the_next_day_s_read(store):
    # Each list is read at most once a day (CLAUDE.md), whatever is asked: a name the wiki lacks, or one newer than the
    # last read, waits for the next day's.
    clock, wiki = FakeClock(NOW), Wiki()
    icons = WikiIcons(store, clock, wiki)
    await icons.refresh([("character", "Skirk")])
    reads = len(wiki.asked)
    assert await icons.refresh([("character", "Somebody New"), ("character", "Skirk")]) is False
    clock.advance(hours=23, minutes=59)
    await icons.refresh([("weapon", "Another Blade")])
    assert len(wiki.asked) == reads
    # A day after the last read, the lists are read again, and a name the wiki has now is kept.
    wiki.entries["4"] = [*WEAPONS, {**WEAPONS[0], "entry_page_id": "99999", "name": "Another Blade"}]
    clock.advance(minutes=2)
    assert await icons.refresh([("weapon", "Another Blade"), ("character", "Somebody New")]) is True
    assert len(wiki.asked) == 2 * reads
    assert icons.missing == {("character", "Somebody New")} and ("weapon", "Another Blade") in store.wiki_items()
    clock.advance(days=1, minutes=1)
    await icons.refresh([("weapon", "Another Blade")])
    assert len(wiki.asked) == 2 * reads  # nothing lacks its icon: nothing is read


async def test_a_list_read_by_the_characters_wiki_is_not_read_again_the_same_day(store):
    # The audit of 2026-11-09, H1: the Characters pages' wiki reads the same lists; after its read, the icons' reader asks
    # for none within the day, and neither does a new one on the same store (a start of Guild Board). The names it lacks
    # take their icons from the lists that read kept.
    clock, wiki = FakeClock(NOW), Wiki()
    characters = CharacterWiki(store, clock, lambda url, **kwargs: wiki(url, **kwargs) if kwargs.get("body") and
                               json.loads(kwargs["body"])["menu_id"] in wiki.entries else wiki_page([], 0), lambda: "7.1")
    await characters.lists()
    reads = len(wiki.asked)
    assert reads > 0 and store.labels("wish") == {}
    clock.advance(hours=2)
    icons = WikiIcons(store, clock, wiki)
    assert await icons.refresh([("character", "Skirk"), ("character", "Not Yet Listed")]) is True  # its icon is labelled
    assert store.labels("wish")["wish.character.skirk"].icon_url == SKIRK_ICON
    assert await WikiIcons(store, clock, wiki).refresh([("character", "Not Yet Listed")]) is False
    assert len(wiki.asked) == reads


async def test_two_imports_with_new_lacking_names_read_the_lists_once_a_day(store):
    clock, wiki = FakeClock(NOW), Wiki()
    icons = WikiIcons(store, clock, wiki)
    assert await icons.refresh([("character", "Nobody One")]) is True
    reads = len(wiki.asked)
    clock.advance(hours=1)
    assert await icons.refresh([("character", "Nobody Two")]) is False
    clock.advance(hours=1)
    assert await WikiIcons(store, clock, wiki).refresh([("weapon", "Nothing Three")]) is False   # a start between them
    assert len(wiki.asked) == reads
    # Two at once make one read: the second finds the day's read made, under the reader's lock.
    clock.advance(days=1)
    both = await asyncio.gather(icons.refresh([("weapon", "Blade One")]), icons.refresh([("weapon", "Blade Two")]))
    assert sorted(both) == [False, True] and len(wiki.asked) == 2 * reads


async def test_a_list_that_could_not_be_read_is_tried_again_a_quarter_of_an_hour_later(store):
    clock, wiki = FakeClock(NOW), Wiki()
    icons = WikiIcons(store, clock, wiki)
    wiki.fail_at = ("2", 1)
    await icons.refresh([("character", "Skirk")])
    assert ("character", "Skirk") not in store.wiki_items()
    wiki.fail_at, asked = None, len(wiki.asked)
    clock.advance(minutes=14)
    await icons.refresh([("character", "Skirk")])
    assert wiki.asked[asked:] == []   # the weapons were read; the characters wait out the quarter of an hour
    clock.advance(minutes=2)
    await icons.refresh([("character", "Skirk")])
    assert ("character", "Skirk") in store.wiki_items()


async def test_a_failed_read_keeps_what_was_kept(store):
    clock, wiki = FakeClock(NOW), Wiki()
    icons = WikiIcons(store, clock, wiki)
    await icons.refresh([("character", "Skirk")])
    kept = store.wiki_items()
    # The weapons' second page fails: the characters, read whole, are new; the weapons stay as they were.
    wiki.entries["2"] = [*CHARACTERS, {**CHARACTERS[2], "entry_page_id": "99998", "name": "Somebody New"}]
    wiki.fail_at = ("4", 2)
    clock.advance(days=1, minutes=1)
    await icons.refresh([("character", "Somebody New")])
    items = store.wiki_items()
    assert ("character", "Somebody New") in items
    assert {key: row for key, row in items.items() if key[0] == "weapon"} == {
        key: row for key, row in kept.items() if key[0] == "weapon"
    }
    # A name found is no longer missing, whatever else failed.
    assert ("character", "Somebody New") not in icons.missing


async def test_an_empty_list_keeps_what_was_kept(store, caplog):
    # A list with no entry is no list of the game's characters or weapons (the wiki listed 132 and 252): what is kept
    # stays, rather than every icon going.
    clock, wiki = FakeClock(NOW), Wiki()
    icons = WikiIcons(store, clock, wiki)
    await icons.refresh([("character", "Skirk")])
    kept = store.wiki_items()
    wiki.entries, wiki.totals = {"2": [], "4": []}, {"2": 0, "4": 0}
    clock.advance(days=2)
    await icons.refresh([("character", "Somebody New")])
    assert store.wiki_items() == kept
    assert "list could not be read" in caplog.text
    assert icons.missing == set()  # not looked for: asked for again at the next refresh


async def test_the_demo_reads_nothing(store):
    icons = WikiIcons(store, FakeClock(NOW), None)
    await icons.refresh([("character", "Skirk")])
    assert store.wiki_items() == {} and icons.icon("character", "Skirk") is None


def test_the_names_wanted_are_the_4_and_5_stars_the_featured_and_the_wishlist(store):
    def wish(wish_id, name, item_type, rank, uid=700000001):
        return WishRow(wish_id, uid, "301", "character", name, item_type, rank, "2026-10-12 21:14:03", NOW, 1)

    import_id = store.start_wish_import(NOW)
    assert import_id == 1
    store.add_wishes([
        wish(1, "Skirk", "Character", 5), wish(2, "Fischl", "Character", 4), wish(3, "Cool Steel", "Weapon", 3),
        wish(4, "The Widsith", "Weapon", 4), wish(5, "Diluc", "Character", 5, uid=700000002),
    ])
    store.replace_banners([
        BannerRow(21888, "Void Star's Advent", "character", ("Skirk",), SKIRK_ART, NOW, NOW, NOW),
        BannerRow(21890, "Epitome Invocation", "weapon", ("Azurelight", "Symphonist of Scents"), SKIRK_ART, NOW, NOW,
                  NOW),
        BannerRow(31001, "Ode to the Dawn Breeze", "chronicled", ("Mondstadt Characters",), SKIRK_ART, NOW, NOW, NOW),
    ])
    # And the account's wishlist, each name of the kind typed.
    store.add_wishlist(700000001, "Citlali", "character", date(2026, 11, 11), 1, NOW)
    store.add_wishlist(700000002, "Mavuika", "character", date(2026, 11, 11), 1, NOW)
    assert wanted_names(store, 700000001) == {
        ("character", "Skirk"), ("character", "Fischl"), ("weapon", "The Widsith"), ("weapon", "Azurelight"),
        ("weapon", "Symphonist of Scents"), ("character", "Citlali"),
    }
    assert wanted_names(store, None) == {("character", "Skirk"), ("weapon", "Azurelight"), ("weapon", "Symphonist of Scents")}


def _until(condition, seconds: float = 5.0) -> None:
    deadline = time.monotonic() + seconds
    while not condition():
        assert time.monotonic() < deadline, "it did not happen in time"
        time.sleep(0.01)


def _live_core(tmp_path, clock) -> Core:
    core = Core(AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())
    core.update_settings({"risk_acknowledged": True})
    return core


class Heard:
    """The events a core's bus published since it was made."""

    def __init__(self, core: Core) -> None:
        self._queue = core.bus.subscribe()
        self.types: list[str] = []

    def changes(self) -> int:
        """How many pulls_changed events came so far."""
        while not self._queue.empty():
            self.types.append(self._queue.get_nowait()["type"])
        return self.types.count("pulls_changed")


def test_the_core_reads_the_icons_after_a_banners_read_that_keeps_a_new_featured_name(tmp_path, clock):
    # The banners' featured names lack their icons: once a read keeps them, the wiki's lists are read, and the pages are
    # told, as after an import. Another read of the same names asks for nothing more.
    core, wiki = _live_core(tmp_path, clock), Wiki()
    core.wiki._fetch = wiki  # the stand-ins of the wiki and of the announcements: no test reaches HoYoverse
    core.banners._fetch = lambda url: ANN_LIST if "getAnnList" in url else ANN_CONTENT
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            heard = Heard(core)
            assert client.portal.call(core.banners.refresh, True) == 3
            _until(lambda: ("weapon", "Azurelight") in client.portal.call(core.store.wiki_items))  # on the core's loop, as the app reads it
            _until(lambda: heard.changes() == 2)  # the banners, then their icons
            reads = len(wiki.asked)
            clock.advance(hours=2)
            assert client.portal.call(core.banners.refresh, True) == 3
            time.sleep(0.2)
            assert len(wiki.asked) == reads
    finally:
        core.store.close()


def test_the_core_reads_the_icons_after_a_wishlist_add_at_most_once_a_day(tmp_path, clock):
    # An entry added to the wishlist lacks its icon: the wiki's lists are read, and the page shows the entry's face.
    # A second name added within the day waits for the next day's read; an import's own read is not held to it.
    core, wiki = _live_core(tmp_path, clock), Wiki()
    core.wiki._fetch = wiki
    keep_demo_like(core.store)  # a wishlist entry needs a history (ruling R10)
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            heard = Heard(core)
            entry = {"name": "Skirk", "kind": "character", "about": "2026-11-11", "copies": 1}
            assert client.post("/api/pulls/wishlist", json=entry).status_code == 200
            _until(lambda: ("character", "Skirk") in client.portal.call(core.store.wiki_items))
            _until(lambda: heard.changes() == 2)  # the entry, then its icon
            [skirk] = [one for one in client.get("/api/pulls").json()["wishlist"] if one["name"] == "Skirk"]
            assert skirk["icon"] == "/api/icon/wish.character.skirk"
            reads = len(wiki.asked)
            clock.advance(hours=3)
            assert client.post("/api/pulls/wishlist", json={**entry, "name": "Somebody New"}).status_code == 200
            time.sleep(0.2)
            assert len(wiki.asked) == reads
            clock.advance(days=1)
            assert client.post("/api/pulls/wishlist", json={**entry, "name": "Somebody Newer"}).status_code == 200
            _until(lambda: len(wiki.asked) == 2 * reads)
    finally:
        core.store.close()


def test_before_the_first_run_s_consent_a_wishlist_add_reads_nothing(tmp_path, clock):
    # A history kept without the consent (one imported before it was asked for, or a consent taken back): the wishlist
    # takes the entry, and nothing reaches HoYoLAB's wiki (rulings R15 and R21).
    core, wiki = _live_core(tmp_path, clock), Wiki()
    core.update_settings({"risk_acknowledged": False})
    core.wiki._fetch = wiki
    keep_demo_like(core.store)
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            entry = {"name": "Skirk", "kind": "character", "about": "2026-11-11", "copies": 1}
            assert client.post("/api/pulls/wishlist", json=entry).status_code == 200
            time.sleep(0.2)
            assert wiki.asked == []
    finally:
        core.store.close()


def test_the_demo_core_reads_no_icon_after_a_wishlist_add(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            entry = {"name": "Skirk", "kind": "character", "about": "2026-11-11", "copies": 1}
            assert client.post("/api/pulls/wishlist", json=entry).status_code == 200
            time.sleep(0.2)
            assert core.store.wiki_items() == {}  # the demo's wiki has no fetch: it contacts nothing
    finally:
        core.store.close()


def test_icons_are_served_under_their_labels(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            assert client.get("/api/icon/wish.character.skirk").status_code == 404  # not kept yet
            # The core's own wiki reads nothing in the demo: the icons are put in by one that reads the stand-in.
            client.portal.call(WikiIcons(core.store, core.clock, Wiki()).refresh, [("character", "Skirk")])
            fetched: list[str] = []
            picture = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24  # the icon cache keeps a picture by its first bytes
            core.icons._fetch = lambda url: fetched.append(url) or picture
            answer = client.get("/api/icon/wish.character.skirk")
            assert (answer.status_code, answer.content, answer.headers["content-type"]) == (200, picture, "image/png")
            assert fetched == [SKIRK_ICON]
            assert client.get("/api/icon/wish.weapon.azurelight").status_code == 200
            assert client.get("/api/icon/wish.character.nobody").status_code == 404
    finally:
        core.store.close()
