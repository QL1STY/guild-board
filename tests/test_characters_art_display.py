"""The art cache serves a picture at the size it is shown (the Characters design, 11.7): when the page asks for a size, it gets a
downscaled copy, made once from the kept original the way the gallery makes its thumbnails (Qt, given bytes, never a path) and
kept beside it, so that a 2048-pixel picture is not what a 56-pixel face or a 900-pixel stage decodes. Nothing here reaches the
internet: the download is a fake."""
from __future__ import annotations

import asyncio
import json
import threading
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import UNEXPECTED_REQUEST, create_app
from guildboard.characters import art as art_module
from guildboard.characters.art import DISPLAY_SIZES, ArtCache, display_size
from guildboard.config import AppPaths
from guildboard.core import Core
from support import AccountSource, FakeClock, FakeSleep

NOW = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)
URL = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2026/06/29/big.png"
SMALL_URL = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2026/06/29/small.png"


def picture(width: int, height: int, *, see_through: bool = True) -> bytes:
    """A PNG of this size with a gradient and, by default, a see-through border."""
    from PySide6.QtCore import QBuffer, QIODevice
    from PySide6.QtGui import QColor, QImage, QPainter

    image = QImage(width, height, QImage.Format.Format_ARGB32)
    image.fill(0 if see_through else 0xFF000000)
    painter = QPainter(image)
    painter.fillRect(width // 10, height // 10, width * 4 // 5, height * 4 // 5, QColor(200, 90, 40, 255))
    painter.fillRect(width // 3, height // 3, width // 3, height // 3, QColor(20, 120, 220, 255))
    painter.end()
    buffer = QBuffer()
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    assert image.save(buffer, "PNG")
    return bytes(buffer.data())


def size_of(data: bytes) -> tuple[int, int]:
    from PySide6.QtGui import QImage

    image = QImage.fromData(data)
    assert not image.isNull()
    return image.width(), image.height()


def has_see_through(data: bytes) -> bool:
    from PySide6.QtGui import QImage

    image = QImage.fromData(data)
    return image.hasAlphaChannel() and image.pixelColor(1, 1).alpha() == 0


def test_a_copy_for_display_is_kept_at_quality_92_and_the_sizes_are_the_five():
    assert art_module.DISPLAY_QUALITY == 92
    assert DISPLAY_SIZES == (128, 256, 512, 1024, 1536)  # the core takes no other size, whatever the player's picture quality


class Downloads:
    def __init__(self, pictures: dict[str, bytes]) -> None:
        self.pictures = pictures
        self.asked: list[str] = []

    def __call__(self, url: str, *, max_bytes: int | None = None, hosts=None) -> bytes:
        self.asked.append(url)
        return self.pictures[url]


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(NOW)


@pytest.fixture
def paths(tmp_path) -> AppPaths:
    return AppPaths(tmp_path / "data")


@pytest.fixture(scope="module")
def big() -> bytes:
    return picture(2048, 1536)


def _cache(store, paths, clock, pictures) -> tuple[ArtCache, Downloads]:
    downloads = Downloads(pictures)
    return ArtCache(store, paths, clock, downloads, False), downloads


def test_a_size_asked_for_is_the_next_one_up_of_a_few(clock):
    assert DISPLAY_SIZES == (128, 256, 512, 1024, 1536)
    assert [display_size(wanted) for wanted in (1, 100, 128, 129, 256, 300, 513, 1024, 1500, 1536, 4000)] == [
        128, 128, 128, 256, 256, 512, 1024, 1024, 1536, 1536, 1536,
    ]


async def test_a_picture_asked_for_at_a_size_is_made_once_at_that_size_and_kept_beside_the_original(store, paths, clock, big):
    art, downloads = _cache(store, paths, clock, {URL: big})
    key = art.key_for(URL)
    art.address(URL)
    data, kind = await art.get(key, 256)
    assert kind == "image/webp" and max(size_of(data)) == 256 and size_of(data) == (256, 192)  # the shape stays
    assert has_see_through(data)  # the see-through border stays
    assert len(data) < len(big) / 4
    kept = paths.data_dir / "art-display" / f"{key}-256.webp"
    assert kept.read_bytes() == data
    assert (await art.get(key))[0] == big  # the original is as it was, for whoever asks without a size
    assert len(downloads.asked) == 1 and store.art(key).bytes == len(big)  # the copy is not counted in the original's bytes


async def test_the_copy_is_served_from_the_disk_the_next_time_without_the_original_being_decoded(store, paths, clock, big, monkeypatch):
    art, _ = _cache(store, paths, clock, {URL: big})
    key = art.key_for(URL)
    art.address(URL)
    first = await art.get(key, 256)
    clock.advance(days=1)  # a picture's use is noted once a day at most
    monkeypatch.setattr(art_module, "_shrunk", lambda *args: pytest.fail("the original was decoded again"))
    again = _cache(store, paths, clock, {})[0]
    assert await again.get(key, 256) == first
    assert await again.get(key, 200) == first  # 200 is the 256 bucket
    assert store.art(key).read_at == clock.now()  # the picture's use is noted, so the cache keeps what is looked at


async def test_a_size_is_snapped_to_a_bucket_and_never_made_larger_than_the_picture(store, paths, clock, big):
    art, _ = _cache(store, paths, clock, {URL: big, SMALL_URL: picture(100, 80)})
    key, small = art.key_for(URL), art.key_for(SMALL_URL)
    art.address(URL), art.address(SMALL_URL)
    assert size_of((await art.get(key, 300))[0]) == (512, 384)
    assert size_of((await art.get(key, 5000))[0]) == (1536, 1152)  # the largest copy, since the original is larger still
    whole = await art.get(small, 512)  # smaller than the size: the picture itself, with no copy made
    assert whole[1] == "image/png" and size_of(whole[0]) == (100, 80)
    assert not list((paths.data_dir / "art-display").glob(f"{small}-*"))
    assert (await art.get(key, 1536))[1] == "image/webp"
    exact = await art.get(small, 128)
    assert exact == whole


async def test_a_picture_that_cannot_be_read_by_qt_is_served_as_it_is(store, paths, clock):
    junk = b"\x89PNG\r\n\x1a\n" + b"not really" * 20
    art, _ = _cache(store, paths, clock, {URL: junk})
    key = art.key_for(URL)
    art.address(URL)
    assert await art.get(key, 128) == (junk, "image/png")
    assert await art.get(key, 128) == (junk, "image/png")


async def test_a_copy_goes_when_its_picture_goes(store, paths, clock, big):
    other = picture(1500, 1500)
    art, _ = _cache(store, paths, clock, {URL: big, SMALL_URL: other})
    key, second = art.key_for(URL), art.key_for(SMALL_URL)
    art.address(URL), art.address(SMALL_URL)
    await art.get(key, 256)
    await art.get(key, 512)
    folder = paths.data_dir / "art-display"
    assert len(list(folder.glob(f"{key}-*"))) == 2
    clock.advance(hours=1)
    art.total_cap = len(other) + 10  # room for the second picture alone
    await art.get(second, 256)
    assert store.art(key) is None
    assert not list(folder.glob(f"{key}-*"))  # no copy outlives its picture
    assert len(list(folder.glob(f"{second}-*"))) == 1


async def test_the_copies_count_in_the_300_mb_so_the_cache_stays_within_its_limit(store, paths, clock, big):
    other = picture(1500, 1500)
    art, _ = _cache(store, paths, clock, {URL: big, SMALL_URL: other})
    key, second = art.key_for(URL), art.key_for(SMALL_URL)
    art.address(URL), art.address(SMALL_URL)
    data, _kind = await art.get(key, 512)
    assert art.used() == len(big) + len(data)
    clock.advance(hours=1)
    art.total_cap = len(big) + len(other) + len(data) + 10  # the two originals and this copy fit
    await art.get(second)
    assert store.art(key) is not None
    clock.advance(hours=1)
    await art.get(second, 512)  # the second's copy does not: the picture read longest ago goes, with its copy
    assert store.art(key) is None and not list((paths.data_dir / "art-display").glob(f"{key}-*"))
    assert art.used() <= art.total_cap
    assert _cache(store, paths, clock, {})[0].used() == art.used()  # a new run finds what the folder holds


async def test_a_copy_left_with_no_picture_does_not_empty_the_cache(store, paths, clock, big):
    art, _ = _cache(store, paths, clock, {URL: big, SMALL_URL: picture(1500, 1500)})
    key, second = art.key_for(URL), art.key_for(SMALL_URL)
    art.address(URL), art.address(SMALL_URL)
    await art.get(key)
    folder = paths.data_dir / "art-display"
    folder.mkdir(parents=True)
    (folder / ("f" * 32 + "-256.webp")).write_bytes(b"x" * 4096)  # left by a run that could not delete it
    art.total_cap = store.art(key).bytes + 3_000_000
    clock.advance(hours=1)
    await art.get(second, 256)
    assert store.art(key) is not None and store.art(second) is not None
    assert art.used() == sum(row.bytes for row in store.art_rows()) + (folder / f"{second}-256.webp").stat().st_size


async def test_pictures_are_made_smaller_one_at_a_time_and_a_copy_is_made_once(store, paths, clock, big, monkeypatch):
    # The first look at a roster asks for a hundred at once, and each is decoded into the core's memory while it is made.
    active, most, calls = 0, 0, 0
    real = art_module._shrunk
    guard = threading.Lock()

    def counting(data: bytes, size: int) -> bytes | None:
        nonlocal active, most, calls
        with guard:
            active += 1
            calls += 1
            most = max(most, active)
        try:
            return real(data, size)
        finally:
            with guard:
                active -= 1

    monkeypatch.setattr(art_module, "_shrunk", counting)
    art, _ = _cache(store, paths, clock, {URL: big, SMALL_URL: picture(800, 800)})
    key, second = art.key_for(URL), art.key_for(SMALL_URL)
    art.address(URL), art.address(SMALL_URL)
    answers = await asyncio.gather(art.get(key, 256), art.get(key, 256), art.get(key, 512), art.get(second, 256), art.get(second, 512))
    assert all(answer[1] == "image/webp" for answer in answers)
    assert answers[0] == answers[1]
    assert most == 1 and calls == 4  # the 256 of the first picture was made once


async def test_the_demos_bundled_pictures_are_made_smaller_the_same_way(store, paths, clock, tmp_path, big):
    folder = tmp_path / "demo"
    (folder / "pictures").mkdir(parents=True)
    (folder / "pictures" / "a.png").write_bytes(big)
    (folder / "pictures.json").write_text(json.dumps({"abc": {"file": "pictures/a.png", "url": URL}}), encoding="utf-8")
    art = ArtCache(store, paths, clock, None, True)
    art.demo_dir = folder
    assert (await art.get("abc"))[0] == big
    data, kind = await art.get("abc", 128)
    assert kind == "image/webp" and size_of(data) == (128, 96)
    assert (paths.data_dir / "art-display" / "abc-128.webp").is_file()
    assert await art.get("nothing", 128) is None


def test_the_art_route_takes_a_size_and_refuses_a_bad_one(tmp_path, big):
    clock = FakeClock(NOW)
    core = Core(AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    core.art._fetch_bytes = lambda address, max_bytes, hosts=None: big
    core.settings.risk_acknowledged = True
    address = core.art.address(URL)
    with TestClient(create_app(core, 4321), base_url="http://127.0.0.1:4321") as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        whole = client.get(address)
        assert whole.status_code == 200 and whole.headers["content-type"] == "image/png" and whole.content == big
        sized = client.get(address, params={"size": 256})
        assert sized.status_code == 200 and sized.headers["content-type"] == "image/webp"
        assert size_of(sized.content) == (256, 192) and sized.headers["cache-control"] == "max-age=86400"
        assert client.get(address, params={"size": 1536}).status_code == 200
        # Only the sizes that are kept: a page cannot ask for work of any other size, however long the number.
        for bad in ("abc", "0", "-5", "1.5", "", "300", "2048", "٣", "9" * 5000):
            refused = client.get(address, params={"size": bad})
            assert (refused.status_code, refused.json()) == (422, {"error": UNEXPECTED_REQUEST}), bad
        assert client.get("/api/art/" + "0" * 32, params={"size": 256}).status_code == 404
    core.store.close()
