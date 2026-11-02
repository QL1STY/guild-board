"""The screenshot gallery (the ledger design, section 7; the plan's Task 10)."""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guildboard import gallery
from guildboard.api.app import create_app
from guildboard.config import AppPaths, Settings
from guildboard.core import Core
from guildboard.gallery import (
    Gallery, Picture, PictureMissing, find_folder, list_pictures, prune_thumbnails, read_picture, thumbnail,
)
from guildboard.pulls import gamecache
from pulls_samples import made_up_game, made_up_screenshots, picture_bytes
from support import AccountSource, FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"

# ---------------------------------------------------------------- what is opened and listed, under one folder

_seen: list[tuple[str, str]] = []  # (what, path): "read", "write" or "list"
_under: str | None = None


def _key(path) -> str:
    return os.path.normcase(os.path.abspath(os.fsdecode(path)))


def _audit(event: str, args: tuple) -> None:
    under = _under
    if under is None:
        return
    try:
        if event == "open":
            path, mode, flags = args[0], args[1], args[2]
            if not isinstance(path, (str, bytes, os.PathLike)):
                return
            writes = any(letter in mode for letter in "wax+") if isinstance(mode, str) else bool(
                flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC)
            )
            what = "write" if writes else "read"
        elif event in ("os.listdir", "os.scandir"):
            path, what = args[0], "list"
            if not isinstance(path, (str, bytes, os.PathLike)):
                return
        elif event in ("os.remove", "os.rename", "os.rmdir", "os.mkdir"):
            path, what = args[0], "write"
        else:
            return
        key = _key(path)
        if key == under or key.startswith(under + os.sep):
            _seen.append((what, key))
    except Exception:  # an audit hook must never raise
        pass


sys.addaudithook(_audit)  # cannot be removed; `_under` switches it off


@pytest.fixture
def watch():
    """Starts watching what is opened, listed or changed under a folder; gives the list of what was."""
    global _under

    def start(folder: Path) -> list[tuple[str, str]]:
        global _under
        _seen.clear()
        _under = _key(folder)
        return _seen

    try:
        yield start
    finally:
        _under = None


def _core(tmp_path: Path, clock, demo: bool = False) -> Core:
    return Core(AppPaths(tmp_path / "data"), demo=demo, clock=clock, source=None if demo else AccountSource(),
                sleep=FakeSleep(clock), process_lister=lambda: set())


def _client(core: Core) -> TestClient:
    client = TestClient(create_app(core, PORT), base_url=BASE)
    client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
    return client


# ---------------------------------------------------------------- the module

def test_lists_only_pictures_directly_inside(tmp_path):
    folder = made_up_screenshots(tmp_path)
    (folder / "..secret.png").write_bytes(b"x")  # a name of the allowed characters is listed, as it is in the folder
    (folder / "bad name.png").write_bytes(b"x")  # a name of other characters is not
    names = [picture.name for picture in list_pictures(folder)]
    assert set(names) == {"20261012211403.png", "20260930080000.jpg", "Photo (2).jpg", "..secret.png"}


def test_taken_from_the_name_else_the_modified_time(tmp_path):
    folder = made_up_screenshots(tmp_path)
    stamp = datetime(2026, 8, 1, 9, 30).timestamp()
    os.utime(folder / "Photo (2).jpg", (stamp, stamp))
    taken = {picture.name: picture.taken for picture in list_pictures(folder)}
    assert taken["20261012211403.png"].replace(tzinfo=None) == datetime(2026, 10, 12, 21, 14, 3)
    assert taken["Photo (2).jpg"].replace(tzinfo=None) == datetime(2026, 8, 1, 9, 30)
    assert gallery.taken_from_name("Genshin 2026-10-26 21-14-03.png").replace(tzinfo=None) == datetime(
        2026, 10, 26, 21, 14, 3
    )
    assert gallery.taken_from_name("20261399999999.png") is None  # no such time
    # Newest first.
    assert [picture.name for picture in list_pictures(folder)] == [
        "20261012211403.png", "20260930080000.jpg", "Photo (2).jpg",
    ]


def test_a_picture_whose_time_windows_cannot_read_does_not_hide_the_others(tmp_path):
    # Windows gives no local time before 1970 or after the year 3000. A picture with no time in its name and such a
    # modified time is left out, alone; the others are listed as ever, and one whose name holds its time stays.
    folder = made_up_screenshots(tmp_path)
    for name, seconds in (("wallpaper.png", -300_000_000), ("far.png", 64_000_000_000), ("20261011101010.png", -300_000_000)):
        (folder / name).write_bytes(picture_bytes())
        os.utime(folder / name, ns=(seconds * 10**9, seconds * 10**9))
    expected = {"20261012211403.png", "20261011101010.png", "20260930080000.jpg", "Photo (2).jpg", "..secret.png"}
    (folder / "..secret.png").write_bytes(picture_bytes())
    assert {picture.name for picture in list_pictures(folder)} == expected
    shown = Gallery(lambda: Settings(gallery_enabled=True), set, lambda name, on: None, tmp_path / "thumbs",
                    locate=lambda settings: folder)
    shown.look()
    assert shown.model()["count"] == len(expected)


def test_read_picture_reads_only_a_listed_picture_through_the_shared_open(tmp_path, monkeypatch):
    folder = made_up_screenshots(tmp_path)
    listing = {picture.id: picture for picture in list_pictures(folder)}
    opened: list[Path] = []
    real = gamecache.open_shared
    monkeypatch.setattr(gamecache, "open_shared", lambda path: opened.append(path) or real(path))
    assert read_picture(folder, "20261012211403.png", listing) == (folder / "20261012211403.png").read_bytes()
    assert opened == [folder / "20261012211403.png"]
    for unknown in ("..\\notes.txt", "notes.txt", "older\\20250101120000.png", str(folder / "20261012211403.png")):
        with pytest.raises(KeyError):
            read_picture(folder, unknown, listing)
    assert opened == [folder / "20261012211403.png"]


def test_thumbnails_go_to_the_data_folder_and_are_reused(tmp_path, monkeypatch):
    folder = made_up_screenshots(tmp_path / "home")
    thumbs = tmp_path / "data" / "gallery-thumbs"
    listing = {picture.id: picture for picture in list_pictures(folder)}
    picture = listing["20261012211403.png"]
    opened: list[Path] = []
    real = gamecache.open_shared
    monkeypatch.setattr(gamecache, "open_shared", lambda path: opened.append(path) or real(path))
    made = thumbnail(folder, picture, thumbs)
    assert made.parent == thumbs and made.suffix == ".jpg"
    from PySide6.QtGui import QImage

    small = QImage.fromData(made.read_bytes())
    assert (small.width(), small.height()) == (480, 270)
    assert thumbnail(folder, picture, thumbs) == made
    assert opened == [folder / picture.name]  # made once, then reused
    # A picture that is gone loses its thumbnail; the folder of pictures is not touched.
    stale = thumbs / "gone.png-1-2.jpg"
    stale.write_bytes(b"x")
    assert prune_thumbnails(thumbs, listing) == 1
    assert not stale.exists() and made.exists()
    assert sorted(path.name for path in folder.iterdir()) == [
        "20260930080000.jpg", "20261012211403.png", "Photo (2).jpg", "notes.txt", "older",
    ]


def test_a_failed_thumbnail_write_leaves_no_partial_file(tmp_path, monkeypatch):
    # A thumbnail is written beside its name, then renamed to it. When the rename fails (a full disk, or another request
    # for the same picture holding the finished one open), the partial goes; when the thumbnail is there all the same, it
    # is the one given. The prune removes a partial a crash left behind, never one being written now.
    import time

    folder = made_up_screenshots(tmp_path / "home")
    thumbs = tmp_path / "data" / "gallery-thumbs"
    listing = {picture.id: picture for picture in list_pictures(folder)}
    picture = listing["20261012211403.png"]

    def refused(source, target):
        raise PermissionError(13, "The file is in use")

    monkeypatch.setattr(gallery.os, "replace", refused)
    with pytest.raises(OSError):
        thumbnail(folder, picture, thumbs)
    assert list(thumbs.iterdir()) == []

    def made_meanwhile(source, target):
        Path(target).write_bytes(b"made by the other request")
        raise PermissionError(13, "The file is in use")

    monkeypatch.setattr(gallery.os, "replace", made_meanwhile)
    made = thumbnail(folder, picture, thumbs)
    assert made.read_bytes() == b"made by the other request"
    assert [path.name for path in thumbs.iterdir()] == [made.name]
    monkeypatch.undo()
    left, writing = thumbs / f"{made.name}.123.tmp", thumbs / f"{made.name}.456.tmp"
    for partial in (left, writing):
        partial.write_bytes(b"x")
    os.utime(left, (time.time() - 3600, time.time() - 3600))
    assert prune_thumbnails(thumbs, listing) == 1
    assert not left.exists() and writing.exists() and made.exists()


def svg_drawing(picture: Path) -> bytes:
    """An SVG whose one element draws the picture at `picture`: Qt's SVG reader follows the link and reads that file."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="640" height="360">'
        f'<image width="640" height="360" xlink:href="{picture.as_posix()}"/></svg>'
    ).encode()


def minimal_pdf() -> bytes:
    """A PDF of one empty page, which Qt's PDF reader decodes as a picture."""
    objects = (
        b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>",
    )
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    table = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{table}\n%%EOF\n".encode()
    return bytes(out)


def test_a_picture_that_is_not_png_or_jpeg_is_never_decoded(tmp_path):
    # A file named like a screenshot can hold anything. Given no format, Qt guesses one from the bytes: its SVG reader
    # then reads the files the SVG names (a picture elsewhere here; one of the game's files, or a file on another
    # computer, which opens a connection to it), and its PDF reader decodes a PDF. Only PNG and JPEG bytes are decoded,
    # each as what its first bytes say, whatever the file's name.
    elsewhere = tmp_path / "elsewhere" / "secret.png"
    elsewhere.parent.mkdir()
    elsewhere.write_bytes(picture_bytes("PNG", colour="#ff0000"))
    folder = tmp_path / "home" / "game" / "ScreenShot"
    folder.mkdir(parents=True)
    (folder / "20261012211403.png").write_bytes(svg_drawing(elsewhere))
    (folder / "20261012211404.jpg").write_bytes(minimal_pdf())
    (folder / "20261012211405.png").write_bytes(picture_bytes("PNG", 1280, 720))
    (folder / "20261012211406.png").write_bytes(picture_bytes("JPG", 1280, 720))  # a JPEG named .png
    thumbs = tmp_path / "data" / "gallery-thumbs"
    listing = {picture.id: picture for picture in list_pictures(folder)}
    for name in ("20261012211403.png", "20261012211404.jpg"):
        with pytest.raises(PictureMissing):
            thumbnail(folder, listing[name], thumbs)
    assert not thumbs.exists() or list(thumbs.iterdir()) == []  # nothing was written for them
    from PySide6.QtGui import QImage

    for name in ("20261012211405.png", "20261012211406.png"):
        small = QImage.fromData(thumbnail(folder, listing[name], thumbs).read_bytes())
        assert (small.width(), small.height()) == (480, 270)


def test_folder_found_next_to_the_data_folder(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    folder = made_up_screenshots(home)
    assert find_folder(Settings(gallery_enabled=True)) == folder
    # No log, no folder.
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "nobody"))
    assert find_folder(Settings(gallery_enabled=True)) is None


def test_a_pasted_folder_must_be_named_ScreenShot(tmp_path, monkeypatch):
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "nobody"))  # no game's log to fall back on
    pictures = tmp_path / "Pictures"
    pictures.mkdir()
    lower = tmp_path / "Games" / "screenshot"
    lower.mkdir(parents=True)
    assert find_folder(Settings(gallery_folder=str(pictures))) is None
    assert find_folder(Settings(gallery_folder=str(tmp_path / "Other" / "ScreenShot"))) is None  # not there
    assert find_folder(Settings(gallery_folder="ScreenShot")) is None  # not a whole path
    (tmp_path / "file").mkdir()
    (tmp_path / "file" / "ScreenShot").write_text("a file, not a folder", encoding="utf-8")
    assert find_folder(Settings(gallery_folder=str(tmp_path / "file" / "ScreenShot"))) is None
    assert find_folder(Settings(gallery_folder=str(lower))) == lower


# ---------------------------------------------------------------- through the API

def test_off_lists_and_reads_nothing(tmp_path, clock, monkeypatch, watch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    made_up_screenshots(home)
    started: list[Path] = []
    core = _core(tmp_path, clock)
    core.gallery._show = started.append
    seen = watch(home)
    try:
        with _client(core) as client:
            assert client.get("/api/gallery").json() == {"enabled": False}
            assert client.post("/api/gallery/rescan").json() == {"enabled": False}
            for url in ("/api/gallery/20261012211403.png/thumb", "/api/gallery/20261012211403.png/full"):
                assert client.get(url).status_code == 404
            assert client.put("/api/gallery/20261012211403.png/favourite", json={"on": True}).status_code == 404
            assert client.post("/api/gallery/20261012211403.png/show").status_code == 404
            for url in ("/api/status", "/api/settings", "/api/stats"):
                assert client.get(url).status_code == 200
        assert core.store.gallery_favourites() == set()
    finally:
        core.store.close()
    assert seen == [] and started == []


def test_turning_it_off_forgets_the_listing(tmp_path, clock, monkeypatch, watch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    made_up_screenshots(home)
    core = _core(tmp_path, clock)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            assert client.get("/api/gallery").json()["count"] == 3
            client.put("/api/settings", json={"gallery_enabled": False})
            seen = watch(home)
            assert client.get("/api/gallery").json() == {"enabled": False}
            assert client.get("/api/gallery/20261012211403.png/full").status_code == 404
            assert seen == []
    finally:
        core.store.close()


def test_the_gallery_lists_by_month_and_keeps_the_found_folder(tmp_path, clock, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    folder = made_up_screenshots(home)
    stamp = datetime(2026, 8, 1, 9, 30).timestamp()
    os.utime(folder / "Photo (2).jpg", (stamp, stamp))
    core = _core(tmp_path, clock)
    try:
        with _client(core) as client:
            assert client.put("/api/settings", json={"gallery_enabled": True}).status_code == 200
            model = client.post("/api/gallery/rescan").json()
            assert (model["enabled"], model["folder_missing"], model["count"]) == (True, False, 3)
            assert [month["label"] for month in model["months"]] == ["October 2026", "September 2026", "August 2026"]
            first = model["months"][0]["pictures"][0]
            assert first == {
                "id": "20261012211403.png", "taken": first["taken"], "time": "12 Oct 21:14",
                "when": "12 October 2026, 21:14", "favourite": False,
            }
            assert client.get("/api/settings").json()["gallery_folder"] == str(folder)
            full = client.get("/api/gallery/20261012211403.png/full")
            assert (full.status_code, full.headers["content-type"]) == (200, "image/png")
            assert full.content == (folder / "20261012211403.png").read_bytes()
            thumb = client.get("/api/gallery/Photo (2).jpg/thumb")
            assert (thumb.status_code, thumb.headers["content-type"]) == (200, "image/jpeg")
            assert [path.parent for path in (tmp_path / "data" / "gallery-thumbs").iterdir()] == [
                tmp_path / "data" / "gallery-thumbs"
            ]
    finally:
        core.store.close()


def test_folder_missing_is_said(tmp_path, clock, monkeypatch):
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "nobody"))
    core = _core(tmp_path, clock)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            assert client.get("/api/gallery").json() == {
                "enabled": True, "folder_missing": True, "count": 0, "months": [],
            }
            pasted = tmp_path / "D" / "ScreenShot"
            pasted.mkdir(parents=True)
            (pasted / "20261001100000.png").write_bytes(picture_bytes())
            client.put("/api/settings", json={"gallery_folder": str(pasted)})
            assert client.get("/api/gallery").json()["count"] == 1
    finally:
        core.store.close()


def test_an_id_not_in_the_listing_is_404_and_opens_nothing(tmp_path, clock, monkeypatch, watch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    folder = made_up_screenshots(home)
    secret = home / "game" / "secret.png"
    secret.write_bytes(picture_bytes())
    started: list[Path] = []
    core = _core(tmp_path, clock)
    core.gallery._show = started.append
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            assert client.get("/api/gallery").json()["count"] == 3
            seen = watch(tmp_path)
            for picture_id in ("..%5Csecret.png", "..%2Fsecret.png", "C%3A%5Cx.png", str(secret).replace("\\", "%5C"),
                               "older%5C20250101120000.png", "notes.txt", "unknown.png", "%2E%2E"):
                for kind in ("thumb", "full"):
                    answer = client.get(f"/api/gallery/{picture_id}/{kind}")
                    assert answer.status_code == 404, (picture_id, kind)
                assert client.post(f"/api/gallery/{picture_id}/show").status_code == 404
                assert client.put(f"/api/gallery/{picture_id}/favourite", json={"on": True}).status_code == 404
            assert seen == []
            assert started == [] and core.store.gallery_favourites() == set()
            # The watch does see a read: of a listed picture, and of it alone.
            assert client.get("/api/gallery/20261012211403.png/full").status_code == 200
            assert seen == [("read", os.path.normcase(str(folder / "20261012211403.png")))]
    finally:
        core.store.close()
    assert folder.is_dir()


def test_favourite_round_trip(tmp_path, clock, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    made_up_screenshots(home)
    core = _core(tmp_path, clock)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.get("/api/gallery")
            answer = client.put("/api/gallery/20260930080000.jpg/favourite", json={"on": True})
            assert answer.json() == {"id": "20260930080000.jpg", "favourite": True}
            favourites = [picture["id"] for month in client.get("/api/gallery").json()["months"]
                          for picture in month["pictures"] if picture["favourite"]]
            assert favourites == ["20260930080000.jpg"]
            assert client.put("/api/gallery/20260930080000.jpg/favourite", json={"on": "yes"}).status_code == 422
            client.put("/api/gallery/20260930080000.jpg/favourite", json={"on": False})
            assert core.store.gallery_favourites() == set()
    finally:
        core.store.close()


def test_show_in_folder_starts_explorer_on_the_listed_file(tmp_path, clock, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    folder = made_up_screenshots(home)
    started: list[tuple] = []
    monkeypatch.setattr(gallery.subprocess, "Popen", lambda *args, **kwargs: started.append(args))
    core = _core(tmp_path, clock)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.get("/api/gallery")
            assert client.post("/api/gallery/Photo (2).jpg/show").json() == {"shown": "Photo (2).jpg"}
    finally:
        core.store.close()
    # By its full path, so that no program of the same name in the current folder can be started in its place.
    explorer = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "explorer.exe")
    assert os.path.isabs(explorer)
    assert started == [(f'"{explorer}" /select,"{folder / "Photo (2).jpg"}"',)]


def test_the_demo_shows_its_own_pictures_and_reads_no_game_file(tmp_path, clock, monkeypatch, watch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    made_up_game(home)
    made_up_screenshots(home)
    core = _core(tmp_path, clock, demo=True)
    seen = watch(home)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            model = client.post("/api/gallery/rescan").json()
            assert model["count"] == gallery.DEMO_COUNT
            assert len(model["months"]) >= 3
            first = model["months"][0]["pictures"][0]["id"]
            assert client.get(f"/api/gallery/{first}/thumb").status_code == 200
    finally:
        core.store.close()
    assert seen == []
    assert Path(core.settings.gallery_folder) == tmp_path / "data" / gallery.DEMO_FOLDER


def test_a_picture_id_must_look_like_a_picture():
    assert gallery.PICTURE_NAME.match("20261026211403.png")
    assert gallery.PICTURE_NAME.match("Photo (2).JPEG")
    for name in ("..\\x.png", "a/b.png", "C:x.png", "x.png.txt", "x.gif", "x .png"):
        assert not gallery.PICTURE_NAME.match(name), name


def test_the_gallery_class_answers_nothing_while_off(tmp_path):
    looked: list[Settings] = []
    settings = Settings()
    shelf = Gallery(lambda: settings, set, lambda name, on: None, tmp_path / "thumbs",
                    locate=lambda s: looked.append(s) or tmp_path)
    shelf.look()
    assert shelf.model() == {"enabled": False} and looked == []
    with pytest.raises(gallery.PictureMissing):
        shelf.full("x.png")
    assert isinstance(Picture("a.png", "a.png", datetime.now().astimezone(), 1, 1).media_type, str)


def test_a_folder_that_cannot_be_listed_keeps_its_thumbnails(tmp_path):
    # An unplugged drive, say: its pictures are not gone, so neither are their thumbnails.
    thumbs = tmp_path / "thumbs"
    thumbs.mkdir()
    kept = thumbs / "20261012211403.png-10-20.jpg"
    kept.write_bytes(b"x")
    settings = Settings(gallery_enabled=True)
    gone = tmp_path / "gone" / "ScreenShot"
    shelf = Gallery(lambda: settings, set, lambda name, on: None, thumbs, locate=lambda s: gone)
    shelf.look()
    assert kept.exists()
    assert shelf.model()["count"] == 0
    # A listing that succeeds does prune.
    folder = made_up_screenshots(tmp_path / "home")
    shelf = Gallery(lambda: settings, set, lambda name, on: None, thumbs, locate=lambda s: folder)
    shelf.look()
    assert not kept.exists()


def test_a_look_that_outlives_a_change_of_folder_is_dropped(tmp_path):
    # The player pastes another folder, or turns the gallery off, while a look still runs: what it found is not kept,
    # so it neither stands for the new folder nor stays behind after forget().
    folder = made_up_screenshots(tmp_path / "home")
    settings = Settings(gallery_enabled=True)
    shelf: Gallery

    def locate(_: Settings) -> Path:
        shelf.forget()  # the setting changes while the look runs
        return folder

    shelf = Gallery(lambda: settings, set, lambda name, on: None, tmp_path / "thumbs", locate=locate)
    shelf.look()
    assert (shelf.looked, shelf.folder) == (False, None)
    shelf = Gallery(lambda: settings, set, lambda name, on: None, tmp_path / "thumbs", locate=lambda s: folder)
    shelf.look()
    assert (shelf.looked, shelf.folder) == (True, folder)


def test_a_network_folder_is_never_looked_at(tmp_path, monkeypatch):
    # Asking whether it is a folder would reach out to another computer.
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "nobody"))
    asked: list[str] = []
    monkeypatch.setattr(Path, "is_dir", lambda self: asked.append(str(self)) or True)
    for pasted in (r"\\server\share\ScreenShot", "//server/share/ScreenShot", r"\\?\UNC\server\share\ScreenShot"):
        assert find_folder(Settings(gallery_folder=pasted)) is None
    assert asked == []
