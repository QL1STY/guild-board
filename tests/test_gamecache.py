"""The two read-only reads of the game's own files for the wish-history link (the Pulls design, section 4).

Every file here is made up under the test's own folder, with USERPROFILE set to it: no test reads a file of the player's,
and the key in every link is a made-up one.
"""
import _winapi
import os
import sys
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from urllib.parse import quote

import pytest

from guildboard import logging_setup
from guildboard.logging_setup import redact
from guildboard.pulls import cache_probe, gamecache
from guildboard.pulls.gamecache import CacheProblem, WishLink

KEY = "MADE-UP+KEY/for=tests-0123456789"  # as the game's page holds it
KEY_WRITTEN = quote(KEY, safe="")  # as the link writes it: MADE-UP%2BKEY%2Ffor%3Dtests-0123456789
LOG_PARTS = ("AppData", "LocalLow", "miHoYo", "Genshin Impact", "output_log.txt")
# Bytes that are no printable ASCII, so that they never join the link beside them.
NOISE = bytes(range(0x00, 0x20)) + bytes(range(0x7F, 0x100))

LOG_MISSING = "The game's log was not found at {path}. Start the game once, open Wish → History, then press Import again."
NO_DATA_FOLDER = "The game's log does not name its data folder. Open Wish → History in the game, then press Import again."
NO_CACHE = "The game's web cache was not found. Open Wish → History in the game, then press Import again."
HELD_OPEN = "Close the game, then press Import again. The link from Wish → History stays valid for a day."
NO_LINK = "Open Wish → History in the game, then press Import again."
TOO_LARGE = "The game's cache file is larger than Guild Board reads. See the log file."
# Windows' rights to a file, the ways of sharing it, and "open it only if it is there".
GENERIC_READ, GENERIC_WRITE, DELETE = 0x80000000, 0x40000000, 0x00010000
SHARE_READ, SHARE_WRITE = 0x1, 0x2
OPEN_EXISTING = 3


@contextmanager
def held_as_the_game_holds(path: Path, share: int = SHARE_READ | SHARE_WRITE):
    """The file held open as the game's browser engine holds its cache files while the game runs: with the rights to
    read, write and delete it, sharing reading and writing only. An open that does not share deleting is then refused,
    as Python's own open is."""
    handle = _winapi.CreateFile(
        str(path), GENERIC_READ | GENERIC_WRITE | DELETE, share, _winapi.NULL, OPEN_EXISTING, 0, _winapi.NULL
    )
    try:
        yield
    finally:
        _winapi.CloseHandle(handle)


@pytest.fixture(autouse=True)
def the_tests_own_home(tmp_path):
    """USERPROFILE is the test's own folder itself (conftest.py's is a folder inside it), so that the game's log is looked
    for there and never in the player's, and the keys a test registers as secrets are forgotten at its end. Held apart
    from the test's `monkeypatch`, so that its undo() leaves the log where the test put it."""
    home = pytest.MonkeyPatch()
    home.setenv("USERPROFILE", str(tmp_path))
    try:
        yield home
    finally:
        home.undo()
        logging_setup.forget_secrets()


def link_text(key: str = KEY_WRITTEN, timestamp: str = "1760000000") -> str:
    """A link as the game's Wish → History page has it in the cache, made at `timestamp` (seconds since 1970)."""
    return (
        "https://gs.hoyoverse.com/genshin/event/e20190909gacha-v3/index.html?win_mode=fullscreen&authkey_ver=1"
        f"&sign_type=2&auth_appid=webview_gacha&init_type=301&gacha_id=made-up&timestamp={timestamp}&lang=en"
        f"&device_type=pc&game_version=OSRELWin6.0.0_R1_S1&plat_type=pc&region=os_euro&authkey={key}"
        "&game_biz=hk4e_global#/log"
    )


def cache_bytes(*links: str) -> bytes:
    """Bytes as the cache holds them: each link as a key behind binary noise, ended by a NUL."""
    return b"".join(NOISE + b"1/0/" + link.encode("ascii") + b"\x00" + NOISE for link in links)


def log_file(tmp_path: Path) -> Path:
    return tmp_path.joinpath(*LOG_PARTS)


def write_log(tmp_path: Path, text: str) -> Path:
    path = log_file(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def log_naming(folder: Path) -> str:
    return f"Initialize engine version: 6.0.0f1\nLoading player data from {folder}/data.unity3d\n"


def write_cache(folder: Path, version: str, data: bytes, written: int | None = None) -> Path:
    file = folder / "webCaches" / version / "Cache" / "Cache_Data" / "data_2"
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data)
    if written is not None:
        os.utime(file, (written, written))
    return file


def fake_game(tmp_path: Path, *links: str) -> tuple[Path, Path, Path]:
    """A log that names a data folder under the test's folder, and a cache in it holding `links`: (log, folder, cache)."""
    folder = tmp_path / "Games" / "GenshinImpact_Data"
    log = write_log(tmp_path, log_naming(folder))
    return log, folder, write_cache(folder, "2.33.0.0", cache_bytes(*links))


def test_the_log_is_looked_for_under_userprofile_else_the_home_folder(tmp_path, the_tests_own_home):
    assert gamecache.log_path() == tmp_path.joinpath(*LOG_PARTS)
    the_tests_own_home.delenv("USERPROFILE")
    the_tests_own_home.setattr(Path, "home", classmethod(lambda cls: tmp_path / "Home"))
    assert gamecache.log_path() == (tmp_path / "Home").joinpath(*LOG_PARTS)


def test_a_test_cannot_open_or_list_a_file_of_the_game_outside_its_own_folder(tmp_path, no_game_files_of_the_player):
    # Every path here is a user "Nobody"'s, which is not there: a guard that failed would find nothing to read.
    nobody = Path("C:/Users/Nobody/AppData/LocalLow/miHoYo/Genshin Impact")
    installed = Path("C:/Nobody/Games/Genshin Impact game")  # the install folder, named by its own name alone
    data = Path("C:/Nobody/Games/YuanShen_Data")
    tries = {
        "open": lambda: (nobody / "output_log.txt").read_text(),
        "open as Windows does": lambda: _winapi.CreateFile(
            str(nobody / "output_log.txt"), GENERIC_READ, 7, _winapi.NULL, OPEN_EXISTING, 0, _winapi.NULL
        ),
        "open the install folder's file": lambda: (installed / "GenshinImpact.exe").read_bytes(),
        "list": lambda: os.listdir(nobody),
        "iterate": lambda: list(installed.iterdir()),
        "scan": lambda: list(os.scandir(data / "webCaches")),
    }
    for name, attempt in tries.items():
        with pytest.raises(PermissionError, match="of the game's"):
            attempt()
        assert len(no_game_files_of_the_player) == list(tries).index(name) + 1, name
    no_game_files_of_the_player.clear()  # as this test meant it, so that it does not fail at its end
    # The test's own folder is open to it, listed or read, with names of the game's in it.
    own = tmp_path / "Games" / "GenshinImpact_Data"
    own.mkdir(parents=True)
    (own / "data.unity3d").write_bytes(b"x")
    assert os.listdir(own) == ["data.unity3d"] and (own / "data.unity3d").read_bytes() == b"x"
    assert [entry.name for entry in os.scandir(own)] == ["data.unity3d"]
    assert "Games" in os.listdir(tmp_path)
    assert no_game_files_of_the_player == []


def test_the_data_folder_is_the_first_named_in_the_log():
    log = (
        "Initialize engine version: 6.0.0f1\n"
        "Loading C:/Games/First One/GenshinImpact_Data/globalgamemanagers\n"
        "Reading D:\\Other Games\\YuanShen_Data\\Persistent\\config.ini\n"
    )
    assert gamecache.data_folder(log) == Path("C:/Games/First One/GenshinImpact_Data")
    # Backslashes read as well as forward slashes, and the other client's folder name as well as this one's.
    assert gamecache.data_folder(log.splitlines()[2]) == Path("D:/Other Games/YuanShen_Data")
    assert gamecache.data_folder('path="E:\\Games\\GenshinImpact_Data" ok') == Path("E:/Games/GenshinImpact_Data")
    # A path does not run over a line, and a log that names no data folder gives none.
    assert gamecache.data_folder("C:/Games\nGenshinImpact_Data/x") is None
    assert gamecache.data_folder("Initialize engine version: 6.0.0f1\n") is None
    assert gamecache.data_folder("") is None


def test_the_newest_version_folder_is_the_one_written_last(tmp_path):
    folder = tmp_path / "GenshinImpact_Data"
    assert gamecache.cache_file(folder) is None  # no web cache at all
    (folder / "webCaches").mkdir(parents=True)
    assert gamecache.cache_file(folder) is None  # a web cache with no version in it
    older_name = write_cache(folder, "2.33.0.0", b"a", written=1_700_000_000)
    newer_name = write_cache(folder, "2.31.0.0", b"b", written=1_700_000_100)  # written later, though named lower
    (folder / "webCaches" / "2.99.0.0" / "Cache").mkdir(parents=True)  # no data_2 in it, however high its name
    (folder / "webCaches" / "notes.txt").write_text("not a version folder")
    assert gamecache.cache_file(folder) == newer_name != older_name
    os.utime(older_name, (1_700_000_200, 1_700_000_200))
    assert gamecache.cache_file(folder) == older_name


def test_a_web_cache_that_cannot_be_looked_into_is_said_in_the_log_by_the_errors_type(tmp_path, monkeypatch, caplog):
    folder = tmp_path / "GenshinImpact_Data"
    cache = write_cache(folder, "2.33.0.0", b"a")

    def logged() -> list[str]:
        return [record.getMessage() for record in caplog.records if record.name == "guildboard.pulls.gamecache"]

    with caplog.at_level("WARNING", logger="guildboard.pulls.gamecache"):
        # A folder that is not there, and a version folder with no data_2, are no news: nothing is logged.
        assert gamecache.cache_file(tmp_path / "Nothing") is None
        (folder / "webCaches" / "2.99.0.0").mkdir()
        assert gamecache.cache_file(folder) == cache
        assert logged() == []

        # The web caches cannot be listed, or a data_2 cannot be looked at: the error's type is logged, and the answer is
        # as for a web cache that is not there, so that the player is told the same sentence.
        real_iterdir, real_stat = Path.iterdir, Path.stat

        def refuse_to_list(self):
            if self.name == "webCaches":
                raise PermissionError(13, "Access is denied")
            return real_iterdir(self)

        def refuse_to_look(self, **kwargs):
            if self.name == "data_2":
                raise OSError(5, "Input/output error")
            return real_stat(self, **kwargs)

        with monkeypatch.context() as patch:
            patch.setattr(Path, "iterdir", refuse_to_list)
            assert gamecache.cache_file(folder) is None
        assert any("PermissionError" in message for message in logged())
        caplog.clear()
        with monkeypatch.context() as patch:
            patch.setattr(Path, "stat", refuse_to_look)
            assert gamecache.cache_file(folder) is None
        assert any("OSError" in message and str(cache.parent.parent.parent) in message for message in logged())
        caplog.clear()

        # The player is still told the sentence, and the log holds no key.
        write_log(tmp_path, log_naming(folder))
        write_cache(folder, "2.33.0.0", cache_bytes(link_text()))
        with monkeypatch.context() as patch:
            patch.setattr(Path, "iterdir", refuse_to_list)
            with pytest.raises(CacheProblem) as problem:
                gamecache.read_links()
        assert str(problem.value) == NO_CACHE
    assert logged() and not any(KEY in message or KEY_WRITTEN in message for message in logged())


def test_the_links_in_the_cache_come_the_last_in_the_file_first_with_one_for_each_key():
    one, two = "ONE-MADE-UP-KEY-0123456789", "TWO-MADE-UP-KEY-0123456789"
    first = link_text(quote(one, safe=""))
    second = link_text(quote(two, safe=""))
    third = link_text(quote(one, safe="")).replace("init_type=301", "init_type=302")  # the first one's key, seen again
    other_page = "https://gs.hoyoverse.com/genshin/other.html?lang=en"
    found = gamecache.links(cache_bytes(first, other_page, second, third))
    # The last link in the file comes first. The third holds the first one's key again: being nearer the end, it was
    # written later, so it is the copy kept, and the first is dropped.
    assert [link.url for link in found] == [third, second]
    assert [link.query[gamecache.KEY] for link in found] == [one, two]
    assert found[0].query["init_type"] == "302"
    # Each is the whole link as cached (its fragment too), its parameters decoded.
    link = found[1]
    assert {name: link.query[name] for name in ("init_type", "region", "lang", "timestamp", "game_version")} == {
        "init_type": "301", "region": "os_euro", "lang": "en", "timestamp": "1760000000",
        "game_version": "OSRELWin6.0.0_R1_S1",
    }
    assert link.query[gamecache.KEY_VERSION] == "1" and link.query["auth_appid"] == "webview_gacha"
    # Finding a link registers nothing: a key is a secret of the log from when its link is tried (register_key) until it
    # is let go (forget_key), and the log masks it then as the link writes it and as it is decoded.
    assert redact(f"key {one} {two}") == f"key {one} {two}"
    for link in found:
        gamecache.register_key(link)
    for text in (one, two, quote(one, safe=""), quote(two, safe="")):
        assert redact(f"key {text}") == "key [redacted]", text
    assert "ONE-MADE" not in redact(f"GET {found[0].url}") and "TWO-MADE" not in redact(f"GET {found[1].url}")
    for link in found:
        gamecache.forget_key(link)
    assert redact(f"key {one} {two}") == f"key {one} {two}"
    # A single link, a cache with none, and what the game's cache key looks like with the network isolation prefix.
    assert [link.url for link in gamecache.links(cache_bytes(first))] == [first]
    assert gamecache.links(b"") == [] and gamecache.links(NOISE) == []
    isolated = b"1/0/_dk_https://hoyoverse.com https://hoyoverse.com " + link_text().encode("ascii") + b"\x00"
    assert [link.url for link in gamecache.links(NOISE + isolated + NOISE)] == [link_text()]


def test_a_key_seen_again_keeps_its_copy_nearest_the_end_whatever_stands_between():
    one = link_text(quote("ONE-MADE-UP-KEY-0123456789", safe=""))
    two = link_text(quote("TWO-MADE-UP-KEY-0123456789", safe=""))
    again = one.replace("&lang=en", "&lang=de")
    # Side by side or apart, the copy of a key nearest the end of the file is the one kept, as it was written last.
    # These links were made at the same time, so the order is the file's, the last first, as Paimon.moe's script tries
    # them.
    assert [link.url for link in gamecache.links(cache_bytes(one, again, two))] == [two, again]
    assert [link.url for link in gamecache.links(cache_bytes(two, one, again, again))] == [again, two]
    assert [link.url for link in gamecache.links(cache_bytes(one, one, one))] == [one]


def test_the_links_come_the_last_in_the_file_first_whatever_their_timestamp():
    # At the check with the player (2026-10-24) the cache held 20 links: the five with the latest timestamp were all
    # too old, and the one that answered had an earlier timestamp and lay furthest into the file of the six tried. A
    # link's timestamp is not when it was made, so the links come the last in the file first, as Paimon.moe's script
    # tries them, and Import tries every one until one answers.
    def keyed(name: str, timestamp: str) -> str:
        return link_text(quote(f"{name}-MADE-UP-KEY-0123456789", safe=""), timestamp)

    later_stamp = [keyed(f"STAMPED{n}", "1760090000") for n in range(5)]
    answering = keyed("ANSWERING", "1760089962")
    no_time = link_text(quote("NOTIME-MADE-UP-KEY-0123456789", safe="")).replace("&timestamp=1760000000", "")
    found = gamecache.links(cache_bytes(*later_stamp, no_time, answering))
    assert [link.query[gamecache.KEY].split("-")[0] for link in found] == [
        "ANSWERING", "NOTIME", "STAMPED4", "STAMPED3", "STAMPED2", "STAMPED1", "STAMPED0",
    ]
    # One link a key: the copy nearest the end of the file, whatever time an earlier copy names.
    again = keyed("STAMPED0", "1760000500")
    found = gamecache.links(cache_bytes(later_stamp[0], answering, again))
    assert [(link.query[gamecache.KEY].split("-")[0], link.query["timestamp"]) for link in found] == [
        ("STAMPED0", "1760000500"), ("ANSWERING", "1760089962"),
    ]


def test_a_link_that_is_not_a_wish_history_link_is_not_taken():
    no_key = link_text().replace("&authkey=" + KEY_WRITTEN, "")
    no_version = link_text().replace("authkey_ver=1&", "")
    another_page = link_text().replace("auth_appid=webview_gacha", "auth_appid=webview_other")
    assert gamecache.links(cache_bytes(no_key, no_version, another_page)) == []
    # A good one among them is the one taken, wherever it is.
    good = link_text()
    assert [link.url for link in gamecache.links(cache_bytes(good, no_key, no_version, another_page))] == [good]
    assert [link.url for link in gamecache.links(cache_bytes(no_key, good, no_version))] == [good]
    assert gamecache.KEY_VERSION == "authkey" + "_ver"  # the name the links are told by, built once


def test_the_link_scan_holds_only_candidates():
    # A web cache can hold millions of runs from "https://" on. The scans look at them one at a time and keep only those
    # that could be a link (the key's name and the page's in them): a list of every run once held 257 MB for two million.
    import tracemalloc

    data = b" ".join([b"https://x"] * 2_000_000) + cache_bytes(link_text())
    tracemalloc.start()
    try:
        found = gamecache.links(data)
        feedback = gamecache.ledger_links("", data)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert [link.url for link in found] == [link_text()] and feedback == []
    assert peak < 50_000_000, f"{peak:,} bytes"


def test_a_file_that_grows_past_the_limit_while_it_is_read_is_refused(tmp_path, monkeypatch):
    # The game may write on after the size of its file was asked: no more than the limit and a byte is read, and a file
    # that holds that byte is refused as one that was too large.
    _, _, cache = fake_game(tmp_path, link_text())
    monkeypatch.setattr(gamecache, "MAX_CACHE_BYTES", cache.stat().st_size)
    real = gamecache.open_shared

    def written_on(path):
        with open(path, "ab") as file:  # the game writes, after the size was asked and before the read
            file.write(b"x" * 10)
        return real(path)

    monkeypatch.setattr(gamecache, "open_shared", written_on)
    with pytest.raises(CacheProblem) as problem:
        gamecache.read_cache(cache)
    assert str(problem.value) == TOO_LARGE


def test_a_cache_file_that_is_a_link_is_not_followed(tmp_path):
    # A file of the game's that is a link to another file, here or on another computer, is never followed: neither its
    # size nor its bytes are asked of what it points at. The read says the file was not found, a version folder whose
    # file is a link is no web cache, and the gallery's pictures, opened the same way, are refused the same.
    _, folder, cache = fake_game(tmp_path, link_text())
    elsewhere = tmp_path / "elsewhere.bin"
    elsewhere.write_bytes(cache_bytes(link_text(quote("ELSEWHERE-MADE-UP-KEY-0123456789", safe=""))))
    linked = folder / "webCaches" / "2.34.0.0" / "Cache" / "Cache_Data" / "data_2"
    linked.parent.mkdir(parents=True)
    try:
        os.symlink(elsewhere, linked)
    except OSError:
        pytest.skip("this account may not make symbolic links")
    os.utime(elsewhere, (cache.stat().st_mtime + 100, cache.stat().st_mtime + 100))  # what it points at is newer
    with pytest.raises(CacheProblem) as problem:
        gamecache.read_cache(linked)
    assert str(problem.value) == NO_CACHE
    assert gamecache.cache_file(folder) == cache
    with pytest.raises(OSError):
        gamecache.open_shared(linked)
    assert [link.query[gamecache.KEY] for link in gamecache.read_links()] == [KEY]


def _give_a_reparse_point(path: Path, tag: int) -> None:
    """Make a file a reparse point of a made-up tag, as a link or a OneDrive placeholder is one (their tags are Microsoft's,
    and a made-up one with the same bit says the same: bit 29 is set when the point names another place). OSError when
    this folder cannot hold one."""
    import ctypes
    import ctypes.wintypes as wt
    import struct

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.restype = wt.HANDLE
    kernel.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, wt.LPVOID, wt.DWORD, wt.DWORD, wt.HANDLE]
    kernel.DeviceIoControl.argtypes = [
        wt.HANDLE, wt.DWORD, wt.LPVOID, wt.DWORD, wt.LPVOID, wt.DWORD, ctypes.POINTER(wt.DWORD), wt.LPVOID,
    ]
    handle = kernel.CreateFileW(str(path), GENERIC_WRITE, 0, None, OPEN_EXISTING, 0x00200000, None)  # FILE_FLAG_OPEN_REPARSE_POINT
    try:
        data = struct.pack("<IHH", tag, 4, 0) + b"made"
        done = wt.DWORD(0)
        if not kernel.DeviceIoControl(handle, 0x000900A4, data, len(data), None, 0, ctypes.byref(done), None):  # FSCTL_SET_REPARSE_POINT
            raise OSError(ctypes.get_last_error(), "a reparse point could not be set")
    finally:
        kernel.CloseHandle(handle)


def test_only_a_reparse_point_that_names_another_place_is_refused(tmp_path):
    # A symbolic link or a junction stands for another place, and its tag says so (bit 29). A OneDrive placeholder or a
    # deduplicated file has a reparse point too, and is the file itself: it is read. A junction in a folder above a file
    # is followed, as the game's own folders are where the player or the launcher put them.
    _, folder, cache = fake_game(tmp_path, link_text())
    content = cache_bytes(link_text())
    stands_for_a_place, is_the_file = tmp_path / "a-link.bin", tmp_path / "a-placeholder.bin"
    for file in (stands_for_a_place, is_the_file):
        file.write_bytes(content)
    try:
        _give_a_reparse_point(stands_for_a_place, 0xA0000F01)
        _give_a_reparse_point(is_the_file, 0x80000F01)
    except OSError:
        pytest.skip("this folder cannot hold a reparse point")
    assert os.lstat(is_the_file).st_reparse_tag & 0x20000000 == 0 and os.lstat(stands_for_a_place).st_reparse_tag & 0x20000000
    with gamecache.open_shared(is_the_file) as file:
        assert file.read() == content
    assert [link.query[gamecache.KEY] for link in gamecache.links(gamecache.read_cache(is_the_file))] == [KEY]
    with pytest.raises(OSError):
        gamecache.open_shared(stands_for_a_place)
    with pytest.raises(CacheProblem) as problem:
        gamecache.read_cache(stands_for_a_place)
    assert str(problem.value) == NO_CACHE
    beside = tmp_path / "Junction"
    _winapi.CreateJunction(str(cache.parent), str(beside))
    with gamecache.open_shared(beside / cache.name) as file:
        assert file.read() == cache.read_bytes()


def test_a_data_folder_the_log_names_through_dot_dot_is_not_taken():
    # The log names the game's data folder, and its web cache and ScreenShot folder are found from it. A path that climbs
    # out of where it says it is, with "..", is no data folder of the game's.
    assert gamecache.data_folder("Loading player data from C:/Games/../Users/me/GenshinImpact_Data/data.unity3d") is None
    assert gamecache.data_folder(r"Loading player data from C:\Games\..\GenshinImpact_Data\data.unity3d") is None
    assert gamecache.data_folder("Loading player data from C:/Games/Genshin/GenshinImpact_Data/data.unity3d") == Path(
        "C:/Games/Genshin/GenshinImpact_Data"
    )


def test_a_feedback_link_is_never_taken_for_a_wish_link():
    # A Feedback key goes only to the game's history logs (CLAUDE.md, rule 1). A wish link is one whose auth_appid is
    # the wish history's: a Feedback link that names webview_gacha in another of its parameters, or in its path, is no
    # wish link, and is taken as the Feedback link it is.
    from ledger_samples import csc_url

    feedback = csc_url("FEEDBACK-MADE-UP-KEY-0123456789") + "&from=webview_gacha"
    in_its_path = csc_url("PATHED-MADE-UP-KEY-0123456789").replace("/index.html", "/webview_gacha/index.html")
    data = cache_bytes(link_text(), feedback, in_its_path)
    assert [link.url for link in gamecache.links(data)] == [link_text()]
    assert [link.url for link in gamecache.ledger_links("", data)] == [in_its_path, feedback]


def test_a_link_does_not_show_its_key_when_it_is_printed(tmp_path):
    [link] = gamecache.links(cache_bytes(link_text()))
    for text in (repr(link), str(link)):
        assert KEY not in text and KEY_WRITTEN not in text
    assert replace(link, cache_path=tmp_path).cache_path == tmp_path  # a link is a plain record: its path is set so


def test_each_link_knows_where_it_lies_in_the_cache_and_when_it_was_made():
    # So that the log of an import can say which link answered by its place in the file and its time, never its key.
    one = link_text(quote("ONE-MADE-UP-KEY-0123456789", safe=""))
    two = link_text(quote("TWO-MADE-UP-KEY-0123456789", safe=""), timestamp="1760090000")
    data = cache_bytes(one, two)
    found = gamecache.links(data)
    assert [(link.query[gamecache.KEY][:3], link.at) for link in found] == [
        ("TWO", data.index(two.encode("ascii"))), ("ONE", data.index(one.encode("ascii"))),
    ]
    assert [gamecache.made_at(link) for link in found] == [1760090000, 1760000000]
    assert gamecache.made_at(replace(found[0], query={**found[0].query, "timestamp": "soon"})) is None


def test_read_links_reads_the_log_and_the_cache_and_names_the_cache_they_came_from(tmp_path):
    _, folder, cache = fake_game(tmp_path, link_text())
    # A newer version folder with a link of its own is the one read.
    newest = write_cache(folder, "2.34.0.0", cache_bytes(link_text(quote("NEWEST-MADE-UP-KEY-0123456789", safe=""))))
    os.utime(cache, (1_700_000_000, 1_700_000_000))
    os.utime(newest, (1_700_000_100, 1_700_000_100))
    [link] = gamecache.read_links()
    assert isinstance(link, WishLink)
    assert link.cache_path == newest and link.query[gamecache.KEY] == "NEWEST-MADE-UP-KEY-0123456789"
    # Not yet tried, so not yet a secret: the importer registers a key before its first request.
    assert redact("NEWEST-MADE-UP-KEY-0123456789") == "NEWEST-MADE-UP-KEY-0123456789"


def test_read_links_gives_every_link_the_last_first_and_each_key_is_masked_once_tried(tmp_path):
    keys = ["FIRST-MADE-UP-KEY-0123456789", "SECOND+MADE/UP=KEY-0123456789", "THIRD-MADE-UP-KEY-0123456789"]
    _, _, cache = fake_game(tmp_path, *(link_text(quote(key, safe="")) for key in keys))
    found = gamecache.read_links()
    assert [link.query[gamecache.KEY] for link in found] == keys[::-1]
    assert [link.cache_path for link in found] == [cache] * 3
    assert all(redact(key) == key for key in keys)  # read, not tried
    for link in found:
        gamecache.register_key(link)
    for key in keys:  # as the link writes it and as it is decoded
        assert redact(key) == "[redacted]" and redact(quote(key, safe="")) == "[redacted]", key
    assert redact(" ".join(link.url for link in found)).count("MADE") == 0
    for link in found:
        gamecache.forget_key(link)
    assert not any(key in secret or quote(key, safe="") in secret for key in keys for secret in logging_setup._secrets)


def test_a_key_from_the_login_is_masked_in_every_form_and_forgotten_in_every_form():
    # HoYoverse's answer writes the key URL-encoded, and its spelling of it may differ from Python's own: the forms the
    # link is masked in are the ones it is forgotten in.
    written = "MINTED%2bKEY%2F0123%3d456789"  # lower-case escapes, as Python never writes them
    minted = gamecache.minted_link(written, "webview_gacha", 700000001, "os_euro")
    assert minted.link.query[gamecache.KEY] == "MINTED+KEY/0123=456789"
    for form in (written, "MINTED+KEY/0123=456789", quote("MINTED+KEY/0123=456789", safe="")):
        assert redact(f"x {form} y") == "x [redacted] y", form
    gamecache.forget_key(minted.link)
    assert not any("MINTED" in secret for secret in logging_setup._secrets)
    assert "MINTED" not in repr(minted)


def test_the_files_the_game_holds_open_while_it_runs_are_read_all_the_same(tmp_path):
    # Found at the check with the player: with the game open on Wish → History, Python's own open of data_2 was refused,
    # as the game's browser engine holds the file with the right to delete it. The two reads share reading, writing and
    # deleting with it, and still only read.
    log, _, cache = fake_game(tmp_path, link_text())
    with held_as_the_game_holds(cache), held_as_the_game_holds(log):
        with pytest.raises(PermissionError):
            cache.read_bytes()  # Python's own open, as the two reads were made before
        [link] = gamecache.read_links()
    assert link.cache_path == cache and link.query[gamecache.KEY] == KEY


def test_a_file_held_so_that_nothing_may_read_it_still_says_to_close_the_game(tmp_path):
    _, _, cache = fake_game(tmp_path, link_text())
    with held_as_the_game_holds(cache, share=0):
        with pytest.raises(CacheProblem) as problem:
            gamecache.read_links()
    assert str(problem.value) == HELD_OPEN


def holding_the_cache(error: OSError):
    """An opening of the two files that fails with `error` for the cache, as one the game held would, and reads the log."""
    real = gamecache.open_shared

    def opened(path: Path):
        if path.name == "data_2":
            raise error
        return real(path)

    return opened


def test_a_cache_the_game_holds_open_is_said_plainly(tmp_path, monkeypatch):
    fake_game(tmp_path, link_text())
    held = PermissionError(13, "The process cannot access the file because it is being used by another process")
    monkeypatch.setattr(gamecache, "open_shared", holding_the_cache(held))
    with pytest.raises(CacheProblem) as problem:
        gamecache.read_links()
    assert str(problem.value) == HELD_OPEN
    # The same when Windows says it with its own error number: a sharing violation (32) or a lock violation (33).
    for number in (32, 33):
        error = OSError("the file is in use")
        error.winerror = number
        monkeypatch.setattr(gamecache, "open_shared", holding_the_cache(error))
        with pytest.raises(CacheProblem) as problem:
            gamecache.read_links()
        assert str(problem.value) == HELD_OPEN, number
    # Any other failure to read is not made out to be this one.
    other = OSError(5, "Input/output error")
    monkeypatch.setattr(gamecache, "open_shared", holding_the_cache(other))
    with pytest.raises(OSError) as raised:
        gamecache.read_links()
    assert raised.value is other and not isinstance(raised.value, CacheProblem)


def test_each_problem_has_its_sentence(tmp_path, monkeypatch):
    def problem() -> str:
        with pytest.raises(CacheProblem) as raised:
            gamecache.read_links()
        return str(raised.value)

    log = log_file(tmp_path)
    assert problem() == LOG_MISSING.format(path=log)

    write_log(tmp_path, "Initialize engine version: 6.0.0f1\n")
    assert problem() == NO_DATA_FOLDER

    folder = tmp_path / "Games" / "GenshinImpact_Data"
    write_log(tmp_path, log_naming(folder))
    assert problem() == NO_CACHE  # the folder is not even there
    (folder / "webCaches").mkdir(parents=True)
    assert problem() == NO_CACHE  # it holds no version folder with a data_2

    cache = write_cache(folder, "2.33.0.0", cache_bytes("https://gs.hoyoverse.com/genshin/other.html?lang=en"))
    assert problem() == NO_LINK
    write_cache(folder, "2.33.0.0", b"")
    assert problem() == NO_LINK

    # A file larger than what Guild Board reads is not read at all, and the log file tells which one it was.
    read: list[Path] = []
    real_open = gamecache.open_shared
    monkeypatch.setattr(gamecache, "open_shared", lambda path: read.append(path) or real_open(path))
    write_cache(folder, "2.33.0.0", cache_bytes(link_text()))
    monkeypatch.setattr(gamecache, "MAX_CACHE_BYTES", cache.stat().st_size - 1)
    assert problem() == TOO_LARGE
    assert read == [log]  # the log was read; the cache was not opened at all
    monkeypatch.setattr(gamecache, "MAX_CACHE_BYTES", cache.stat().st_size)
    assert [link.cache_path for link in gamecache.read_links()] == [cache]  # exactly the limit is still read
    monkeypatch.setattr(gamecache, "MAX_LOG_BYTES", log.stat().st_size - 1)
    assert problem() == TOO_LARGE


def test_the_log_file_says_which_file_was_too_large(tmp_path, monkeypatch, caplog):
    _, _, cache = fake_game(tmp_path, link_text())
    monkeypatch.setattr(gamecache, "MAX_CACHE_BYTES", 10)
    with caplog.at_level("WARNING", logger="guildboard.pulls.gamecache"), pytest.raises(CacheProblem):
        gamecache.read_links()
    assert any(str(cache) in record.getMessage() for record in caplog.records)
    assert not any(KEY in record.getMessage() or KEY_WRITTEN in record.getMessage() for record in caplog.records)


# Audit hooks cannot be removed, so this one only listens while a test switches it on, as tests/test_handsoff.py's does.
# It records the openings of files, as Python and as Windows are asked for them, and the listings of folders, which open
# nothing.
_opened: list[tuple[str, object, object]] = []
_created: list[tuple[str, int, int]] = []  # Windows' openings: the path, the rights asked for, and when to open
_listed: list[str] = []
_listening_under: str | None = None
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _record_opens_and_listings(event: str, args: tuple) -> None:
    if _listening_under is None or event not in ("open", "_winapi.CreateFile", "os.listdir", "os.scandir"):
        return
    try:
        path = args[0]
        if isinstance(path, (str, bytes, os.PathLike)):
            where = os.path.normcase(os.path.abspath(os.fsdecode(path)))
            if where.startswith(_listening_under):
                if event == "open":
                    _opened.append((where, args[1], args[2]))
                elif event == "_winapi.CreateFile":
                    _created.append((where, args[1], args[3]))
                else:
                    _listed.append(where)
    except Exception:  # an audit hook must never raise
        pass


sys.addaudithook(_record_opens_and_listings)


def test_the_reads_are_read_only_and_exactly_two(tmp_path):
    global _listening_under
    log, folder, cache = fake_game(tmp_path, link_text())
    (folder / "webCaches" / "2.31.0.0").mkdir()  # a version folder to look into
    (folder / "Native").mkdir()  # and a folder that must not be looked into
    (folder / "Native" / "untouched.bin").write_bytes(b"x")
    before = {path: (path.stat().st_mtime_ns, path.stat().st_size) for path in tmp_path.rglob("*") if path.is_file()}
    _opened.clear()
    _created.clear()
    _listed.clear()
    _listening_under = os.path.normcase(os.path.abspath(tmp_path))
    try:
        [link] = gamecache.read_links()
    finally:
        _listening_under = None
    assert link.cache_path == cache
    the_two = sorted([os.path.normcase(os.path.abspath(log)), os.path.normcase(os.path.abspath(cache))])
    assert sorted(path for path, _, _ in _opened) == the_two
    for path, mode, flags in _opened:
        assert mode in ("r", "rb"), path  # a way of opening that reads
        assert not (flags & _WRITE_FLAGS), path
    # Windows was asked to open the same two, each with the right to read it alone, and only if it is there.
    assert sorted(path for path, _, _ in _created) == the_two
    assert {(rights, when) for _, rights, when in _created} == {(GENERIC_READ, OPEN_EXISTING)}
    # Of the game's folders only the web caches were listed, to find the version folders; "Native" was not looked into.
    assert _listed == [os.path.normcase(os.path.abspath(folder / "webCaches"))]
    # Nothing of the game's was written, touched or added.
    after = {path: (path.stat().st_mtime_ns, path.stat().st_size) for path in tmp_path.rglob("*") if path.is_file()}
    assert after == before


# ---------------------------------------------------------------- the probe

def probe(capsys) -> tuple[int, list[str]]:
    status = cache_probe.main()
    return status, capsys.readouterr().out.splitlines()


def test_the_probe_reports_each_step_in_order_and_never_prints_the_key(tmp_path, capsys):
    whole = link_text().replace("&init_type=301", "&gacha_type=301&init_type=301")  # a link with all six
    older = link_text(quote("OLDER-MADE-UP-KEY-0123456789", safe="")).replace("&lang=en", "")
    log, folder, cache = fake_game(tmp_path, older, whole)
    status, lines = probe(capsys)
    text = "\n".join(lines)
    assert status == 0
    assert KEY not in text and KEY_WRITTEN not in text and "MADE-UP" not in text
    # How many links, and the parameters of the first, which Import tries first: the newest, here the last in the file,
    # as both were made at the same time.
    assert lines[-9:] == [
        f"Log file: {log}",
        f"Log read: yes, {log.stat().st_size} bytes",
        f"Data folder: {folder}",
        f"Cache file: {cache}",
        f"Cache size: {cache.stat().st_size} bytes",
        "Cache opened for reading: yes",
        "Links found: 2",
        "Link parameters: gacha_type=301 init_type=301 region=os_euro game_version=OSRELWin6.0.0_R1_S1 lang=en "
        "timestamp=1760000000",
        f"Key length: {len(KEY)} characters",
    ]
    # Parameters the link does not have are said so, in the order they are listed; others of the link are left out.
    write_cache(folder, "2.33.0.0", cache_bytes(link_text().replace("&lang=en", "").replace("&region=os_euro", "")))
    status, lines = probe(capsys)
    assert status == 0
    assert lines[-4:] == [
        "Links found: 1",
        "Link parameters: init_type=301 game_version=OSRELWin6.0.0_R1_S1 timestamp=1760000000",
        "Not in the link: gacha_type region lang",
        f"Key length: {len(KEY)} characters",
    ]
    assert "device_type" not in "\n".join(lines) and "authkey" not in "\n".join(lines)


def test_the_probe_counts_a_key_once(tmp_path, capsys):
    one = link_text(quote("ONE-MADE-UP-KEY-0123456789", safe=""))
    two = link_text(quote("TWO-MADE-UP-KEY-0123456789", safe=""))
    fake_game(tmp_path, one, two, one.replace("&lang=en", "&lang=de"))  # three links, two of them of one key
    status, lines = probe(capsys)
    assert status == 0
    assert "Links found: 2" in lines and "MADE-UP" not in "\n".join(lines)


def test_the_probe_says_what_it_could_not_do_and_goes_no_further(tmp_path, capsys, monkeypatch):
    status, lines = probe(capsys)
    assert status == 1
    assert lines[-2] == f"Log file: {log_file(tmp_path)}"
    assert lines[-1].startswith("Log read: no, FileNotFoundError")  # and Windows' own number for it, which varies

    log, folder, cache = fake_game(tmp_path, link_text())

    with monkeypatch.context() as patch:
        patch.setattr(gamecache, "open_shared", holding_the_cache(PermissionError(13, "in use")))
        status, lines = probe(capsys)
    assert status == 1
    assert lines[-3:] == [f"Cache file: {cache}", f"Cache size: {cache.stat().st_size} bytes",
                          "Cache opened for reading: no, PermissionError"]

    write_cache(folder, "2.33.0.0", cache_bytes("https://gs.hoyoverse.com/genshin/other.html?lang=en"))
    status, lines = probe(capsys)
    assert status == 1
    assert lines[-2:] == ["Cache opened for reading: yes", "Links found: 0"]

    # A file larger than Guild Board reads is said in the sentence Import gives, and is not read.
    write_cache(folder, "2.33.0.0", cache_bytes(link_text()))
    with monkeypatch.context() as patch:
        patch.setattr(gamecache, "MAX_CACHE_BYTES", 10)
        status, lines = probe(capsys)
    assert status == 1
    assert lines[-1] == f"Cache opened for reading: no, {TOO_LARGE}"


@pytest.mark.parametrize("failing_call", [1, 2])
def test_a_log_whose_size_cannot_be_asked_for_is_said_not_left_to_a_traceback(tmp_path, capsys, monkeypatch, failing_call):
    log, _, _ = fake_game(tmp_path, link_text())
    real_stat = Path.stat
    asked = []

    def stat(self, **kwargs):
        if self == log:
            asked.append(self)
            if len(asked) == failing_call:
                raise PermissionError(13, "Access is denied")
        return real_stat(self, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "stat", stat)
        status, lines = probe(capsys)
    assert status == 1
    assert lines[-2:] == [f"Log file: {log}", "Log read: no, PermissionError"]
