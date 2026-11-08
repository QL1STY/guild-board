"""The art cache of the Characters pages (the Characters plan, Task W2). Nothing here reaches the internet: the download is a
fake that remembers what it was asked."""
import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from guildboard import netpolicy
from guildboard.characters.art import ART_HOSTS, ArtCache
from guildboard.config import AppPaths
from guildboard.store import ArtRow
from support import FakeClock

NOW = datetime(2026, 10, 29, 9, 0, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 40
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"y" * 20
URL = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2026/06/29/a.png"


class Downloads:
    """Stands in for netpolicy.fetch_bytes: the pictures by address, each request remembered."""

    def __init__(self, pictures: dict[str, bytes] | None = None) -> None:
        self.pictures = {URL: PNG} if pictures is None else pictures
        self.asked: list[tuple[str, int | None]] = []
        self.hosts: list = []  # the hosts each download was held to
        self.fail: Exception | None = None

    def __call__(self, url: str, *, max_bytes: int | None = None, hosts=None) -> bytes:
        self.asked.append((url, max_bytes))
        self.hosts.append(hosts)
        if self.fail is not None:
            raise self.fail
        return self.pictures[url]


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(NOW)


@pytest.fixture
def paths(tmp_path) -> AppPaths:
    return AppPaths(tmp_path / "data")


def _cache(store, paths, clock, downloads, demo=False) -> ArtCache:
    return ArtCache(store, paths, clock, downloads, demo)


def test_a_key_is_stable_from_the_address_and_an_address_is_the_pages(store, paths, clock):
    art = _cache(store, paths, clock, Downloads())
    key = art.key_for(URL)
    assert re.fullmatch(r"[0-9a-f]{32}", key) and key == art.key_for(URL) and key != art.key_for(URL + "2")
    assert art.address(URL) == f"/api/art/{key}"
    assert art.address(None) is None and art.address("") is None
    plain = "https://bbs.hoyolab.com/hoyowiki/picture/object/Crown of Insight_icon.png"
    assert art.key_for(plain) == art.key_for(plain.replace(" ", "%20"))  # the wiki writes the address both ways


async def test_a_picture_is_fetched_once_kept_on_disk_and_served_again_without_a_request(store, paths, clock):
    downloads = Downloads()
    art = _cache(store, paths, clock, downloads)
    key = art.key_for(URL)
    assert art.address(URL) == f"/api/art/{key}"
    assert await art.get(key) == (PNG, "image/png")
    assert downloads.asked == [(URL, ArtCache.CAP)]  # asked for with the 8 MB limit
    row = store.art(key)
    assert (row.url, row.bytes, row.read_at) == (URL, len(PNG), NOW)
    kept = paths.data_dir / "art" / row.file
    assert kept.read_bytes() == PNG and kept.parent == paths.data_dir / "art"
    clock.advance(days=1)
    assert await art.get(key) == (PNG, "image/png")
    assert len(downloads.asked) == 1 and store.art(key).read_at == clock.now()  # served from the disk; its read noted
    # A new run of Guild Board finds the picture kept, and fetches nothing, without being told the address again.
    again = _cache(store, paths, clock, Downloads({}))
    assert await again.get(key) == (PNG, "image/png")


async def test_a_picture_over_8_mb_is_refused_and_none_is_served(store, paths, clock, caplog):
    big = Downloads({URL: b"\x89PNG\r\n\x1a\n" + b"x" * ArtCache.CAP})  # one byte over the limit
    art = _cache(store, paths, clock, big)
    key = art.key_for(URL)
    art.address(URL)
    with caplog.at_level(logging.INFO):
        assert await art.get(key) is None
        assert await art.get(key) is None
    assert len(big.asked) == 1  # not asked for again in this run
    assert not (paths.data_dir / "art").exists() or not list((paths.data_dir / "art").iterdir())
    assert store.art(key).bytes == 0  # nothing was kept
    assert URL not in caplog.text  # the address of a picture is not for the log
    refusing = Downloads()
    refusing.fail = netpolicy.ResponseTooLarge("the response is larger than allowed")  # what the real download raises
    other = _cache(store, paths, clock, refusing)
    other.address(URL)
    assert await other.get(key) is None


async def test_the_cache_drops_the_pictures_read_longest_ago_beyond_1_gb(store, paths, clock):
    assert ArtCache.TOTAL_CAP == 1024 * 1024 * 1024
    base = "https://act-webstatic.hoyoverse.com/x/"
    pictures = {f"{base}{name}.png": PNG[:8] + name.encode() * 9 for name in "abc"}  # 17 bytes each
    downloads = Downloads(pictures)
    art = _cache(store, paths, clock, downloads)
    art.total_cap = 40  # a small cap, for the test
    keys = {name: art.key_for(f"{base}{name}.png") for name in "abc"}
    for name in "ab":
        art.address(f"{base}{name}.png")
        assert await art.get(keys[name]) is not None
        clock.advance(days=1)  # a read is noted once a day at most
    assert await art.get(keys["a"]) is not None  # a is read again: b is now the one read longest ago
    clock.advance(days=1)
    art.address(f"{base}c.png")
    assert await art.get(keys["c"]) is not None  # 51 bytes in all: over the 40
    assert store.art(keys["b"]) is None or store.art(keys["b"]).bytes == 0
    assert store.art(keys["a"]).bytes == 17 and store.art(keys["c"]).bytes == 17
    assert sorted(path.name for path in (paths.data_dir / "art").iterdir()) == sorted(
        [store.art(keys["a"]).file, store.art(keys["c"]).file]
    )
    before = len(downloads.asked)
    assert await art.get(keys["b"]) is not None  # b is fetched once more when asked for
    assert len(downloads.asked) == before + 1


def _kept(store, paths, art, url: str, data: bytes, extension: str = ".png") -> str:
    """A picture put in the cache's folder as a download keeps it, with its row: its key."""
    key = art.key_for(url)
    folder = paths.data_dir / "art"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (key + extension)).write_bytes(data)
    store.put_art(ArtRow(key, url, key + extension, len(data), NOW))
    return key


async def test_a_copy_for_display_is_decoded_only_as_the_kind_the_bytes_are(store, paths, clock, tmp_path):
    # As the gallery's thumbnails: given no format, Qt guesses one from the bytes, and its SVG reader reads the files an
    # SVG names. A download is kept only when its first bytes are a picture's, so this is the second line of defence:
    # the two decoders agree.
    from pulls_samples import picture_bytes

    elsewhere = tmp_path / "elsewhere.png"
    elsewhere.write_bytes(picture_bytes("PNG", colour="#ff0000"))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="640" height="360">'
        f'<image width="640" height="360" xlink:href="{elsewhere.as_posix()}"/></svg>'
    ).encode()
    art = _cache(store, paths, clock, Downloads({}))
    disguised = _kept(store, paths, art, URL, svg)
    assert await art.get(disguised, 128) == (svg, "image/png")  # served as it is kept, never decoded
    assert not (paths.data_dir / "art-display").exists()
    real = _kept(store, paths, art, URL + "?real", picture_bytes("PNG", 640, 360))
    data, kind = await art.get(real, 128)
    assert kind == "image/webp" and data.startswith(b"RIFF")


async def test_row_naming_a_file_outside_the_cache_is_never_read_or_deleted(store, paths, clock, tmp_path):
    # The art table comes back whole with a restored backup, which may be someone else's. A row whose file is not its own
    # key's picture in the cache's folder (a whole path, a path out of the folder, or a key that is a path itself) is
    # never read, served or deleted, however large it says it is; it is dropped as met.
    outside = tmp_path / "precious.txt"
    outside.write_bytes(b"not the cache's")
    art = _cache(store, paths, clock, Downloads())
    art.total_cap = 1000
    named = {url: art.key_for(url) for url in (f"{URL}?whole", f"{URL}?up")}
    bad = [
        ArtRow(named[f"{URL}?whole"], f"{URL}?whole", str(outside), 10**12, NOW),
        ArtRow(named[f"{URL}?up"], f"{URL}?up", "..\\..\\precious.txt", 10**12, NOW),
        ArtRow("..\\..\\precious", f"{URL}?key", "..\\..\\precious.txt", 10**12, NOW),
    ]
    for row in bad:
        store.put_art(row)
    assert art.used() == 0 and not any(art.cached(url) for url in named)
    art.address(URL)
    assert await art.get(art.key_for(URL)) == (PNG, "image/png")  # a download, and the trim after it
    assert outside.read_bytes() == b"not the cache's"
    for row in bad:
        assert await art.get(row.key) is None and await art.get(row.key, 128) is None
        assert store.art(row.key) is None
    assert outside.read_bytes() == b"not the cache's"
    assert [row.key for row in store.art_rows()] == [art.key_for(URL)]


async def test_serving_a_kept_picture_twice_in_a_day_writes_once(store, paths, clock, monkeypatch):
    # A roster asks for about a hundred pictures at every start, and each noted its read with a committed write. A
    # picture's read is noted at most once a day, which is all the cache needs to know what the player looks at; whole
    # or as a copy for display, the same.
    from pulls_samples import picture_bytes

    art = _cache(store, paths, clock, Downloads({URL: picture_bytes("PNG", 640, 360)}))
    key = art.key_for(URL)
    art.address(URL)
    assert await art.get(key) is not None and store.art(key).read_at == NOW  # the download notes it
    writes: list[ArtRow] = []
    real = store.put_art
    monkeypatch.setattr(store, "put_art", lambda row: writes.append(row) or real(row))
    for _ in range(3):
        clock.advance(hours=7)
        assert (await art.get(key))[1] == "image/png"
        assert (await art.get(key, 128))[1] == "image/webp"  # made once, then the kept copy
    assert writes == [] and store.art(key).read_at == NOW
    clock.advance(hours=4)  # a day and an hour after the download
    assert (await art.get(key, 128))[1] == "image/webp"
    assert (await art.get(key))[1] == "image/png"
    assert [row.read_at for row in writes] == [clock.now()] and store.art(key).read_at == clock.now()


async def test_only_the_allowed_hosts_are_fetched(store, paths, clock):
    assert ART_HOSTS == (
        "act-webstatic.hoyoverse.com", "act-upload.hoyoverse.com", "upload-static.hoyoverse.com", "bbs.hoyolab.com",
        "fastcdn.hoyoverse.com",
    )
    outside = [
        "https://evil.example/a.png",
        "https://act-webstatic.hoyoverse.com.evil.example/a.png",
        "http://act-webstatic.hoyoverse.com/a.png",  # not https
        "https://sg-public-api.hoyolab.com/a.png",  # a HoYoverse host, but not one of the five
        "https://upload-os-bbs.mihoyo.com/a.png",
        "ftp://bbs.hoyolab.com/a.png",
    ]
    downloads = Downloads({url: PNG for url in outside})
    art = _cache(store, paths, clock, downloads)
    for url in outside:
        assert art.address(url) is None
        assert await art.get(art.key_for(url)) is None
    assert downloads.asked == []
    for host in ART_HOSTS:
        assert art.address(f"https://{host}/a.png") is not None
    # A key that was never given an address is no picture.
    assert await art.get("0" * 32) is None and downloads.asked == []


async def test_the_art_cache_takes_a_public_picture_and_no_other_outside_address(store, paths, clock):
    # The Stats design, section 1: the Endgame headers' public pictures enter the cache only from netpolicy's table, by
    # their place in it (public_address), never as an address given to the cache: a URL taken from a HoYoLAB or wiki
    # answer is never sent outside HoYoverse's hosts, not even one that is written as a table entry is. Each download is
    # held to the five hosts and the table's, at 8 MB.
    picture = netpolicy.PUBLIC_PICTURE_URLS[0]
    downloads = Downloads({picture: PNG})
    art = _cache(store, paths, clock, downloads)
    key = art.key_for(picture)
    for url in (
        *netpolicy.PUBLIC_PICTURE_URLS,  # as an address from an answer, the table's own entries are refused too
        "https://static.wikia.nocookie.net/other.png",
        "https://i.redd.it/other.jpg",
        netpolicy.PUBLIC_PICTURE_URLS[1] + "?x=1",
        "http://i.redd.it/n427epuvp0bd1.jpg",
    ):
        assert art.address(url) is None and not art.usable(url), url
        assert await art.get(art.key_for(url)) is None
    assert downloads.asked == [] and store.art(key) is None
    # The table's entries, by their place, and nothing outside it.
    for index, url in enumerate(netpolicy.PUBLIC_PICTURE_URLS):
        assert art.public_address(index) == f"/api/art/{art.key_for(url)}"
    for index in (-1, len(netpolicy.PUBLIC_PICTURE_URLS), True):
        assert art.public_address(index) is None, index
    assert await art.get(key) == (PNG, "image/png")
    assert downloads.asked == [(picture, ArtCache.CAP)]  # sent as it is written, with the 8 MB limit
    assert downloads.hosts == [ART_HOSTS + netpolicy.PUBLIC_PICTURE_HOSTS]
    assert store.art(key).url == picture
    # A new run serves it from the disk, and fetches it again from the table's address if the file is gone.
    again_downloads = Downloads({picture: PNG})
    again = _cache(store, paths, clock, again_downloads)
    assert await again.get(key) == (PNG, "image/png") and again_downloads.asked == []
    (paths.data_dir / "art" / store.art(key).file).unlink()
    assert await again.get(key) == (PNG, "image/png") and again_downloads.asked == [(picture, ArtCache.CAP)]


async def test_the_public_pictures_are_fetched_ahead_once_and_kept_tells_what_is_on_disk(store, paths, clock):
    # The Endgame headers (the Stats design, 3.2): the core fetches the table's pictures ahead, by their place, one at a
    # time, never while the game runs; `kept` tells the card which are on disk, so a header never waits on a download.
    pictures = {url: PNG for url in netpolicy.PUBLIC_PICTURE_URLS}
    downloads = Downloads(pictures)
    art = _cache(store, paths, clock, downloads)
    art.warm_pause = 0
    addresses = [art.public_address(index) for index in range(3)]
    assert not any(art.kept(address) for address in addresses)
    running = iter([True, True, False])
    rests: list[float] = []

    async def rest(seconds: float) -> None:
        rests.append(seconds)

    art.sleep = rest
    assert await art.warm_public([0, 2, 7], paused=lambda: next(running, False)) == 2  # 7 is no place in the table
    assert rests[:2] == [art.game_pause, art.game_pause]  # it waited for the game to close first
    assert [url for url, _ in downloads.asked] == [netpolicy.PUBLIC_PICTURE_URLS[0], netpolicy.PUBLIC_PICTURE_URLS[2]]
    assert downloads.hosts == [ART_HOSTS + netpolicy.PUBLIC_PICTURE_HOSTS] * 2
    assert [art.kept(address) for address in addresses] == [True, False, True]
    assert await art.warm_public([0, 1, 2]) == 1 and len(downloads.asked) == 3  # what is kept is not fetched again
    for address in (None, "", "/api/art/zz", "/api/art/" + "0" * 32, "https://act-webstatic.hoyoverse.com/a.png"):
        assert not art.kept(address), address
    # A picture that could not be had is asked for again the next time, and is not kept.
    failing = Downloads(pictures)
    failing.fail = ConnectionError("no network")
    other = _cache(store, AppPaths(paths.data_dir.parent / "other"), clock, failing)
    assert await other.warm_public([1]) == 0 and not other.kept(other.public_address(1))


async def test_the_demo_fetches_no_public_picture_ahead(store, paths, clock, tmp_path):
    downloads = Downloads({url: PNG for url in netpolicy.PUBLIC_PICTURE_URLS})
    art = _cache(store, paths, clock, downloads, demo=True)
    art.demo_dir = tmp_path / "nothing-here"
    assert await art.warm_public([0, 1, 2]) == 0 and downloads.asked == []
    assert not art.kept(art.public_address(0))


def test_the_demo_has_no_public_picture_without_a_bundle(store, paths, clock, tmp_path):
    downloads = Downloads({netpolicy.PUBLIC_PICTURE_URLS[0]: PNG})
    art = _cache(store, paths, clock, downloads, demo=True)
    art.demo_dir = tmp_path / "nothing-here"
    assert art.public_address(0) is None and downloads.asked == [] and store.art(art.key_for(netpolicy.PUBLIC_PICTURE_URLS[0])) is None


async def test_an_address_is_sent_with_its_spaces_and_letters_encoded(store, paths, clock):
    url = "https://bbs.hoyolab.com/hoyowiki/picture/object/Shivada Jade Sliver_icon.png"
    sent = "https://bbs.hoyolab.com/hoyowiki/picture/object/Shivada%20Jade%20Sliver_icon.png"
    weapon = "https://bbs.hoyolab.com/hoyowiki/picture/weapon/祭礼弓.png"
    downloads = Downloads({sent: PNG, "https://bbs.hoyolab.com/hoyowiki/picture/weapon/%E7%A5%AD%E7%A4%BC%E5%BC%93.png": PNG})
    art = _cache(store, paths, clock, downloads)
    for address in (url, weapon):
        art.address(address)
        assert await art.get(art.key_for(address)) == (PNG, "image/png")
    assert [asked for asked, _ in downloads.asked] == [sent, "https://bbs.hoyolab.com/hoyowiki/picture/weapon/%E7%A5%AD%E7%A4%BC%E5%BC%93.png"]
    assert store.art(art.key_for(url)).url == url  # the address is kept as the wiki wrote it


async def test_something_that_is_no_picture_is_not_kept_and_a_failed_download_is_logged_by_kind_only(store, paths, clock, caplog):
    downloads = Downloads({URL: b"<html>an error page</html>"})
    art = _cache(store, paths, clock, downloads)
    art.address(URL)
    assert await art.get(art.key_for(URL)) is None
    assert store.art(art.key_for(URL)).bytes == 0
    failing = Downloads()
    failing.fail = ConnectionError(f"could not reach {URL}")
    other = _cache(store, paths, clock, failing)
    other.address(URL)
    with caplog.at_level(logging.INFO):
        assert await other.get(other.key_for(URL)) is None
    assert "ConnectionError" in caplog.text and URL not in caplog.text and "could not reach" not in caplog.text
    failing.fail = None
    clock.advance(minutes=1)
    assert await other.get(other.key_for(URL)) == (PNG, "image/png")  # a failure is tried again when asked for again


async def test_the_demo_serves_its_bundled_pictures_and_fetches_nothing(store, paths, clock, tmp_path):
    folder = tmp_path / "demo"
    (folder / "pictures").mkdir(parents=True)
    (folder / "pictures" / "a.webp").write_bytes(WEBP)
    probe = _cache(store, paths, clock, None, demo=True)
    key = probe.key_for(URL)
    (folder / "pictures.json").write_text(
        json.dumps({key: {"file": "pictures/a.webp", "url": URL}}), encoding="utf-8"
    )
    downloads = Downloads()
    art = _cache(store, paths, clock, downloads, demo=True)
    art.demo_dir = folder
    assert art.address(URL) == f"/api/art/{key}"  # the demo has a picture for this address
    assert art.address("https://act-webstatic.hoyoverse.com/x/not-bundled.png") is None  # and no other
    assert await art.get(key) == (WEBP, "image/webp")
    assert await art.get("0" * 32) is None
    assert downloads.asked == [] and store.art(key) is None  # no request, and nothing kept in the database
    assert not (paths.data_dir / "art").exists()


async def test_the_demo_without_a_bundle_has_no_pictures(store, paths, clock, tmp_path):
    art = _cache(store, paths, clock, None, demo=True)
    art.demo_dir = tmp_path / "nothing-here"
    assert art.address(URL) is None and await art.get(art.key_for(URL)) is None


def test_the_cache_goes_nowhere_but_the_seam():
    import inspect

    from guildboard.characters import art

    source = inspect.getsource(art)
    for forbidden in ("urllib.request", "requests", "aiohttp", "socket", "http.client", "netpolicy.fetch"):
        assert forbidden not in source, forbidden
    assert art.ArtCache.CAP == 8 * 1024 * 1024
    assert ArtRow  # the rows are the store's


# ---------------------------------------------------------------------------------------------- the demo's pictures (W3)

# The four Characters mockups (endgame, planner, profile and week .html) are design records that the public repository does
# not hold. GB_CHARACTERS_MOCKUPS names the folder that has them; a checkout that keeps its design records under docs/ is
# found without it. With neither, the test below is skipped.
_FOUND = sorted(Path(__file__).resolve().parent.parent.glob("docs/*/specs/assets/2026-10-25-characters-mockups"))
MOCKUPS = Path(os.environ["GB_CHARACTERS_MOCKUPS"]) if os.environ.get("GB_CHARACTERS_MOCKUPS") else (_FOUND or [None])[0]
_WIKI = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/"
_HOSTS = r"(?:act-webstatic\.hoyoverse\.com|act-upload\.hoyoverse\.com|upload-static\.hoyoverse\.com|bbs\.hoyolab\.com)"


def _mockup_pictures() -> set[str]:
    """Every picture the four mockups show: the addresses they write out, and those they write after `W +`."""
    found: set[str] = set()
    for page in ("endgame.html", "planner.html", "profile.html", "week.html"):
        text = (MOCKUPS / page).read_text(encoding="utf-8")
        found |= set(re.findall(r"https://" + _HOSTS + r"""[^'"\s)<>\\]*[^/'"\s)<>\\]""", text))
        found |= {_WIKI + tail for tail in re.findall(r"""\bW\s*\+\s*['"]([^'"]+)['"]""", text)}
    return found - {_WIKI.rstrip("/")}


def test_the_demo_ships_no_picture_and_keeps_each_ones_key_and_address(store, paths, clock):
    folder = ArtCache.DEMO_DIR
    named = json.loads((folder / "pictures.json").read_text(encoding="utf-8"))
    assert len(named) >= 55
    art = _cache(store, paths, clock, None, demo=True)
    for key, entry in named.items():
        assert key == art.key_for(entry["url"]), entry["url"]  # the key is the address's
        assert set(entry) == {"url"}  # no file: none of HoYoverse's art is kept in the repository
        assert ArtCache._allowed(entry["url"]), entry["url"]  # only HoYoverse's five hosts
        assert art.address(entry["url"]) is None and not art.usable(entry["url"])  # so the demo shows the drawn sign
    assert not (folder / "pictures").exists()
    assert not [path for path in folder.rglob("*") if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif"}]


@pytest.mark.skipif(MOCKUPS is None or not MOCKUPS.is_dir(), reason="the Characters mockups are not in this repository")
async def test_the_demo_serves_no_picture_of_the_mockups(store, paths, clock):
    art = _cache(store, paths, clock, None, demo=True)
    shown = _mockup_pictures()
    assert len(shown) >= 55  # the fifteen characters, Sandrone's art and chart, her icons, the weapon, the set and the materials
    for url in sorted(shown):
        assert art.address(url) is None and await art.get(art.key_for(url)) is None, url


# ---------------------------------------------------------------------------------------------- the warm-up

BASE = "https://act-webstatic.hoyoverse.com/warm/"


def _warm_cache(store, paths, clock, names="abcd", demo=False):
    """A cache whose download hands out a picture for each of `names`, and whose rest between pictures is none."""
    pictures = {f"{BASE}{name}.png": PNG + name.encode() * 8 for name in names}   # 56 bytes each
    downloads = Downloads(pictures)
    art = _cache(store, paths, clock, downloads, demo)
    art.warm_pause = 0
    return art, downloads, [f"{BASE}{name}.png" for name in names]


async def test_the_warm_up_fetches_what_is_not_kept_in_the_order_given_and_serves_it_from_the_disk_afterwards(store, paths, clock):
    art, downloads, urls = _warm_cache(store, paths, clock)
    assert await art.get(art.address(urls[1]).rsplit("/", 1)[1]) is not None  # b is kept already
    downloads.asked.clear()
    assert await art.warm([urls[2], urls[1], urls[0]]) == 2
    assert [url for url, _ in downloads.asked] == [urls[2], urls[0]]
    assert all(limit == ArtCache.CAP for _, limit in downloads.asked)
    before = len(downloads.asked)
    key = art.key_for(urls[2])
    assert await art.get(key) is not None and len(downloads.asked) == before  # the page finds it on the disk
    assert await art.warm(urls) == 1 and len(downloads.asked) == before + 1   # only d was left


async def test_the_warm_up_asks_for_one_picture_at_a_time_and_rests_between_them(store, paths, clock):
    import threading
    import time

    art, downloads, urls = _warm_cache(store, paths, clock)
    running = peak = 0
    guard = threading.Lock()
    original = downloads.__call__

    def slow(url, *, max_bytes=None, hosts=None):
        nonlocal running, peak
        with guard:
            running += 1
            peak = max(peak, running)
        time.sleep(0.02)
        try:
            return original(url, max_bytes=max_bytes, hosts=hosts)
        finally:
            with guard:
                running -= 1

    art._fetch_bytes = slow
    rests: list[float] = []

    async def rest(seconds):
        rests.append(seconds)

    art.sleep = rest
    art.warm_pause = 0.5
    assert await art.warm(urls) == 4
    assert peak == 1
    assert rests == [0.5] * 4


async def test_the_warm_up_stops_when_the_cache_is_full_and_drops_nothing_the_player_looked_at(store, paths, clock):
    art, downloads, urls = _warm_cache(store, paths, clock)
    art.total_cap = 150  # room for two pictures of 56 bytes, not three
    first = art.key_for(urls[0])
    art.address(urls[0])
    assert await art.get(first) is not None  # the player looked at a
    assert await art.warm(urls) == 1  # b fits (112 bytes); c would make 168: it is not kept, and d is not asked for
    assert [url for url, _ in downloads.asked] == [urls[0], urls[1], urls[2]]
    assert art.used() == 112
    assert store.art(first).bytes == 56 and not art.cached(urls[2]) and not art.cached(urls[3])
    assert await art.warm(urls) == 0 and len(downloads.asked) == 3  # a later warm-up asks for nothing: it is full


async def test_the_warm_up_keeps_to_the_eight_megabyte_limit_and_to_the_five_hosts(store, paths, clock):
    art, downloads, urls = _warm_cache(store, paths, clock, names="ab")
    downloads.fail = netpolicy.ResponseTooLarge()
    assert await art.warm([urls[0], "https://upload-os-bbs.mihoyo.com/a.png", "https://sg-public-api.hoyolab.com/a.png"]) == 0
    assert [url for url, _ in downloads.asked] == [urls[0]]  # asked with the 8 MB limit; the other hosts not at all
    assert downloads.asked[0][1] == 8 * 1024 * 1024
    assert await art.warm([urls[0]]) == 0 and len(downloads.asked) == 1  # a picture that was too large is not asked for again


async def test_the_demo_warms_nothing(store, paths, clock):
    art, downloads, urls = _warm_cache(store, paths, clock, demo=True)
    assert await art.warm(urls) == 0
    assert downloads.asked == [] and not (paths.data_dir / "art").exists()


async def test_the_warm_up_waits_while_the_game_runs_and_goes_on_after(store, paths, clock):
    art, downloads, urls = _warm_cache(store, paths, clock)
    # What the process list says at each look: the game runs for three looks, closes for a and b, runs again before c.
    answers = iter([True, True, True, False, False, True, False, False])
    seen: list[tuple[str, int]] = []

    async def rest(seconds):
        seen.append(("wait" if seconds == art.game_pause else "rest", len(downloads.asked)))

    art.sleep = rest
    art.warm_pause = 0.5
    assert await art.warm(urls, paused=lambda: next(answers, False)) == 4
    assert [url for url, _ in downloads.asked] == urls
    # Nothing is asked while the game runs: three waits before a, then a and b, one wait before c, then c and d.
    assert seen == [("wait", 0)] * 3 + [("rest", 1), ("rest", 2), ("wait", 2), ("rest", 3), ("rest", 4)]
    assert art.game_pause >= 5


async def test_a_picture_kept_ahead_is_dropped_before_one_the_player_looked_at(store, paths, clock):
    art, downloads, urls = _warm_cache(store, paths, clock)
    art.total_cap = 180  # three pictures of 56 bytes fit, not four
    looked = art.key_for(urls[0])
    art.address(urls[0])
    assert await art.get(looked) is not None  # the player looked at a, a while ago
    clock.advance(hours=1)
    assert await art.warm([urls[1], urls[2]]) == 2  # b and c are kept ahead, never looked at
    clock.advance(hours=1)
    art.address(urls[3])
    assert await art.get(art.key_for(urls[3])) is not None  # the page asks for d: one picture must go
    assert art.cached(urls[0]) and art.cached(urls[3])  # a, which the player looked at, stays
    assert not (art.cached(urls[1]) and art.cached(urls[2]))
