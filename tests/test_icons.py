import asyncio
import os
import threading

from guildboard import netpolicy
from guildboard.api.icons import PICTURE_HOSTS, IconCache

URL = "https://act-webstatic.hoyoverse.com/game_record/genshin/city_icon/sumeru.png"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24  # the first bytes of a picture, which is what the cache looks at
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 24
DAY = 24 * 3600
SHORT = 10 * 60  # an address that could not be reached is asked again after this


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_icon_is_downloaded_once(tmp_path):
    calls: list[str] = []

    def fetch(url: str) -> bytes:
        calls.append(url)
        return PNG

    cache = IconCache(tmp_path / "icons", fetch)
    assert await cache.get(URL) == (PNG, "image/png")
    assert await cache.get(URL) == (PNG, "image/png")
    assert calls == [URL]
    assert len(list((tmp_path / "icons").iterdir())) == 1


async def test_refused_host_is_never_fetched(tmp_path):
    calls: list[str] = []

    def fetch(url: str) -> bytes:
        calls.append(url)  # an error raised here would look like a failed download to the cache, so calls are recorded
        return PNG

    cache = IconCache(tmp_path, fetch)
    assert await cache.get("https://evil.example/icon.png") is None
    assert await cache.get("http://act-webstatic.hoyoverse.com/icon.png") is None
    assert await cache.get(netpolicy.ACHIEVEMENT_LIST_URL) is None
    assert await cache.get("") is None
    assert calls == []


async def test_a_hoyoverse_address_that_is_no_picture_host_is_never_asked(tmp_path):
    # A friend writes their own picture's address, and the project takes any on HoYoverse's three domains: the cache asks the
    # hosts that keep pictures alone, never an API of HoYoLAB's, a port, or a look-alike.
    calls: list[str] = []
    cache = IconCache(tmp_path, lambda url: calls.append(url) or PNG)
    for url in (
        "https://sg-public-api.hoyolab.com/event/game_record/a.png", "https://api-account-os.hoyoverse.com/a.png",
        "https://act-webstatic.hoyoverse.com:8443/a.png", "https://act-webstatic.hoyoverse.com.evil.example/a.png",
        "https://user@act-webstatic.hoyoverse.com/a.png", "https://www.hoyolab.com/a.png",
    ):
        assert await cache.get(url) is None, url
    assert calls == []
    assert {"act-webstatic.hoyoverse.com", "upload-os-bbs.mihoyo.com", "sdk.hoyoverse.com", "webstatic.hoyoverse.com"} <= set(PICTURE_HOSTS)


async def test_a_download_that_is_not_a_picture_is_not_kept(tmp_path):
    calls: list[str] = []
    clock = Clock()
    cache = IconCache(tmp_path / "icons", lambda url: calls.append(url) or b"<html>an error page</html>", now=clock)
    assert await cache.get(URL) is None
    assert not (tmp_path / "icons").exists() or list((tmp_path / "icons").iterdir()) == []
    assert await cache.get(URL) is None and calls == [URL]  # and it is not asked again at once
    clock.now += DAY - 1
    assert await cache.get(URL) is None and calls == [URL]  # a server that answers with no picture is not asked all day
    clock.now += 1
    assert await cache.get(URL) is None and calls == [URL, URL]


async def test_a_download_that_cannot_be_made_is_asked_again_ten_minutes_later(tmp_path):
    # Guild Board can run for days: a start with no network must not leave an icon blank until the next start.
    calls: list[str] = []
    clock = Clock()

    def fetch(url: str) -> bytes:
        calls.append(url)
        raise OSError("down")

    cache = IconCache(tmp_path, fetch, now=clock)
    assert await cache.get(URL) is None
    assert list(tmp_path.iterdir()) == []
    clock.now += SHORT - 1
    assert await cache.get(URL) is None and calls == [URL]
    clock.now += 1
    assert await cache.get(URL) is None and calls == [URL, URL]


async def test_the_kind_of_a_picture_comes_from_its_bytes(tmp_path):
    cache = IconCache(tmp_path, lambda url: JPEG)
    assert await cache.get(URL) == (JPEG, "image/jpeg")  # whatever its address says
    assert await cache.get("https://act-webstatic.hoyoverse.com/icons/sumeru") == (JPEG, "image/jpeg")


async def test_a_file_kept_that_is_no_picture_is_fetched_again(tmp_path):
    # An older Guild Board kept anything it was given.
    cache = IconCache(tmp_path, lambda url: PNG)
    assert await cache.get(URL) == (PNG, "image/png")
    [kept] = list(tmp_path.iterdir())
    kept.write_bytes(b"<html>")
    assert await cache.get(URL) == (PNG, "image/png")
    assert kept.read_bytes() == PNG


async def test_the_cache_keeps_within_its_size_and_the_least_used_go_first(tmp_path):
    picture = PNG + b"\x00" * (1000 - len(PNG))
    cache = IconCache(tmp_path, lambda url: picture, cap=3500)
    urls = [f"https://act-webstatic.hoyoverse.com/icon{number}.png" for number in range(5)]
    for number, url in enumerate(urls[:3]):
        await cache.get(url)
        for path in tmp_path.iterdir():  # the files' times, apart, as they are on a PC that is not this fast
            os.utime(path, (path.stat().st_mtime - 10, path.stat().st_mtime - 10))
    await cache.get(urls[0])  # used again: it is the newest now
    await cache.get(urls[3])
    await cache.get(urls[4])
    assert sum(path.stat().st_size for path in tmp_path.iterdir()) <= 3500
    kept = {path.name for path in tmp_path.iterdir()}
    assert len(kept) == 3
    from guildboard.api.icons import _file_name

    assert {_file_name(urls[0]), _file_name(urls[3]), _file_name(urls[4])} == kept


async def test_two_downloads_of_one_icon_at_once_leave_one_picture(tmp_path):
    started, release = threading.Event(), threading.Event()

    def fetch(url: str) -> bytes:
        started.set()
        release.wait(5)
        return PNG

    cache = IconCache(tmp_path, fetch)
    first = asyncio.ensure_future(cache.get(URL))
    second = asyncio.ensure_future(cache.get(URL))
    await asyncio.sleep(0.05)
    release.set()
    assert await first == (PNG, "image/png") and await second == (PNG, "image/png")
    assert [path.name.endswith(".tmp") for path in tmp_path.iterdir()] == [False]


async def test_an_icon_reads_only_its_label(tmp_path, monkeypatch):
    from datetime import datetime, timezone

    from guildboard.metrics import Label
    from guildboard.store import Store

    store = Store.in_memory()
    store.upsert_labels(
        [Label(f"explore.{n}", f"Place {n}", "region", None, URL) for n in range(50)], datetime(2026, 10, 13, tzinfo=timezone.utc)
    )
    assert store.label("explore.7") == Label("explore.7", "Place 7", "region", None, URL, 0)
    assert store.label("explore.404") is None
    sql: list[str] = []
    real = store._conn

    class Spy:
        def execute(self, statement, *args):
            sql.append(statement)
            return real.execute(statement, *args)

        def __getattr__(self, name):
            return getattr(real, name)

    monkeypatch.setattr(store, "_conn", Spy())
    store.label("explore.7")
    assert len(sql) == 1 and "WHERE key = ?" in sql[0]
    monkeypatch.undo()
    store.close()
