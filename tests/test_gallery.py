"""The screenshot gallery (the ledger design, section 7; the plan's Task 10)."""
from __future__ import annotations

import io
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

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
    with Image.open(made) as small:
        assert small.format == "JPEG" and small.size == (480, 270)
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
    """An SVG whose one element draws the picture at `picture`: an SVG reader follows the link and reads that file."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="640" height="360">'
        f'<image width="640" height="360" xlink:href="{picture.as_posix()}"/></svg>'
    ).encode()


def minimal_pdf() -> bytes:
    """A PDF of one empty page, which a PDF reader decodes as a picture."""
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
    # A file named like a screenshot can hold anything. Given no format, a decoder may guess one from the bytes (Qt's did): an SVG reader
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
    for name in ("20261012211405.png", "20261012211406.png"):
        with Image.open(thumbnail(folder, listing[name], thumbs)) as small:
            assert small.format == "JPEG" and small.size == (480, 270)


def test_a_picture_cut_short_or_garbled_is_a_missing_picture_not_a_crash(tmp_path):
    # A crash leaves zeros after the data of a screenshot, or the header of the chunk that follows it garbled. Pillow raises
    # a SyntaxError for the second ("broken PNG file"), and the route must answer as for any other picture it cannot read.
    folder = tmp_path / "home" / "game" / "ScreenShot"
    folder.mkdir(parents=True)
    noise = Image.frombytes("RGB", (800, 450), os.urandom(800 * 450 * 3))  # a PNG of several data chunks
    written = io.BytesIO()
    noise.save(written, "PNG")
    whole = written.getvalue()
    second = whole.index(b"IDAT", whole.index(b"IDAT") + 4)  # the second data chunk's type: its header is garbled
    garbled = whole[:second - 4] + b"\x00\xff\x00\xff\xff\x01\x02\x03" + whole[second + 4:]
    cut = whole[:len(whole) // 2]
    zeros = whole[:len(whole) // 2] + b"\x00" * (len(whole) // 2)
    jpeg = picture_bytes("JPG", 1280, 720)
    for name, data in (("20261012211401.png", garbled), ("20261012211402.png", cut), ("20261012211403.png", zeros),
                       ("20261012211404.jpg", jpeg[:len(jpeg) // 2] + b"\x00" * 40)):
        (folder / name).write_bytes(data)
    thumbs = tmp_path / "data" / "gallery-thumbs"
    listing = {picture.id: picture for picture in list_pictures(folder)}
    assert len(listing) == 4
    for name in listing:
        with pytest.raises(PictureMissing):
            thumbnail(folder, listing[name], thumbs)
    assert not thumbs.exists() or list(thumbs.iterdir()) == []


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
                "enabled": True, "folder_missing": True, "count": 0, "videos": 0, "added": 0, "months": [],
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
            assert model["count"] == gallery.DEMO_COUNT + 4
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


# ---------------------------------------------------------------- added folders and videos

def _added_folder(tmp_path: Path) -> Path:
    """A folder the player might add: pictures, two videos, a subfolder with another and a text file."""
    folder = tmp_path / "Videos" / "Clips"
    (folder / "inner").mkdir(parents=True)
    (folder / "IMG_20261001_100000.jpg").write_bytes(picture_bytes("JPG", colour="#d66f4f"))
    (folder / "Clip 2026-10-05 20-00-00.webm").write_bytes(gallery.demo_clip())
    (folder / "20261008090000.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 40)
    (folder / "inner" / "20250101120000.webm").write_bytes(gallery.demo_clip())
    (folder / "notes.txt").write_text("not a picture", encoding="utf-8")
    return folder


def test_an_added_folder_lists_pictures_and_videos_with_its_key_in_the_id(tmp_path):
    folder = _added_folder(tmp_path)
    found = list_pictures(folder, added=True)
    key = gallery.source_key(folder)
    assert len(key) == 8 and key == gallery.source_key(Path(str(folder).upper()))  # as Windows reads a path
    assert [picture.id for picture in found] == [
        f"{key}~20261008090000.mp4", f"{key}~Clip 2026-10-05 20-00-00.webm", f"{key}~IMG_20261001_100000.jpg",
    ]
    assert [picture.is_video for picture in found] == [True, True, False]
    assert {picture.added for picture in found} == {"Clips"}
    # The game's folder gives its pictures, never a video, whatever its ending.
    assert [picture.id for picture in list_pictures(folder)] == ["IMG_20261001_100000.jpg"]
    assert gallery.source_key(tmp_path / "Other") != key


def test_a_video_is_never_read_whole_or_decoded_as_a_picture(tmp_path):
    folder = _added_folder(tmp_path)
    listing = {picture.id: picture for picture in list_pictures(folder, added=True)}
    video = next(picture for picture in listing.values() if picture.is_video)
    with pytest.raises(PictureMissing):
        read_picture(folder, video.id, listing)
    with pytest.raises(PictureMissing):
        thumbnail(folder, video, tmp_path / "thumbs")
    assert not (tmp_path / "thumbs").exists()


@pytest.mark.parametrize("header, size, expected", [
    (None, 100, None),
    ("bytes=0-9", 100, (0, 9)),
    ("bytes=10-", 100, (10, 99)),
    ("bytes=90-500", 100, (90, 99)),
    ("bytes=-10", 100, (90, 99)),
    ("bytes=-500", 100, (0, 99)),
    ("bytes=99-99", 100, (99, 99)),
    (" bytes = 5 - 6 ", 100, (5, 6)),
    ("bytes=0-0,5-9", 100, None),  # more than one range: the whole file
    ("bytes=5-3", 100, None),
    ("bytes=-", 100, None),
    ("items=0-9", 100, None),
    ("bytes=a-b", 100, None),
    ("bytes=" + "9" * 40 + "-", 100, None),
])
def test_byte_range(header, size, expected):
    assert gallery.byte_range(header, size) == expected


@pytest.mark.parametrize("header, size", [
    ("bytes=100-", 100), ("bytes=500-600", 100), ("bytes=-0", 100), ("bytes=-5", 0), ("bytes=0-0", 0),
])
def test_a_range_past_the_end_is_not_satisfiable(header, size):
    with pytest.raises(gallery.RangeNotSatisfiable):
        gallery.byte_range(header, size)


def _ebml_children(data: bytes):
    """Reads a run of EBML elements: (id, payload) pairs. Enough to check what the demo's clip says about itself."""
    at = 0
    while at < len(data):
        first = data[at]
        id_length = next(n for n in range(1, 5) if first >> (8 - n))
        identifier, at = data[at:at + id_length], at + id_length
        size_length = next(n for n in range(1, 9) if data[at] >> (8 - n))
        size = int.from_bytes(data[at:at + size_length], "big") & ((1 << (7 * size_length)) - 1)
        at += size_length
        yield identifier, data[at:at + size]
        at += size


def test_the_demo_clip_is_a_small_well_formed_webm_of_vp8_frames():
    clip = gallery.demo_clip()
    assert len(clip) < 100_000
    top = dict(_ebml_children(clip))
    assert dict(_ebml_children(top[b"\x1a\x45\xdf\xa3"]))[b"\x42\x82"] == b"webm"
    segment = top[b"\x18\x53\x80\x67"]
    parts = list(_ebml_children(segment))
    assert [identifier for identifier, _ in parts][:3] == [b"\x15\x49\xa9\x66", b"\x16\x54\xae\x6b", b"\x1c\x53\xbb\x6b"]
    assert b"V_VP8" in parts[1][1]
    # Each cue points at the start of a cluster, counted from the start of the segment's data.
    cues = [payload for identifier, payload in parts if identifier == b"\x1c\x53\xbb\x6b"][0]
    places = [
        int.from_bytes(dict(_ebml_children(dict(_ebml_children(point))[b"\xb7"]))[b"\xf1"], "big")
        for identifier, point in _ebml_children(cues) if identifier == b"\xbb"
    ]
    clusters = [identifier for identifier, _ in parts if identifier == b"\x1f\x43\xb6\x75"]
    assert len(places) == len(clusters) == 3
    assert all(segment[place:place + 4] == b"\x1f\x43\xb6\x75" for place in places)


def _kept(tmp_path: Path, clock, monkeypatch, *, game: bool = True):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    if game:
        made_up_game(home)
        made_up_screenshots(home)
    return _core(tmp_path, clock)


def test_adding_a_folder_shows_its_pictures_and_videos_beside_the_games(tmp_path, clock, monkeypatch):
    core = _kept(tmp_path, clock, monkeypatch)
    folder = _added_folder(tmp_path)
    key = gallery.source_key(folder)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            assert client.get("/api/gallery").json()["count"] == 3
            answer = client.post("/api/gallery/folders", json={"path": f'"{folder}"'})  # as "Copy as path" writes it
            assert (answer.status_code, answer.json()) == (200, {"folders": [str(folder)]})
            assert client.get("/api/settings").json()["gallery_folders"] == [str(folder)]
            model = client.get("/api/gallery").json()
            assert (model["count"], model["videos"], model["added"], model["folder_missing"]) == (6, 2, 1, False)
            items = {item["id"]: item for month in model["months"] for item in month["pictures"]}
            assert items[f"{key}~Clip 2026-10-05 20-00-00.webm"]["video"] is True
            assert items[f"{key}~Clip 2026-10-05 20-00-00.webm"]["folder"] == "Clips"
            assert "video" not in items[f"{key}~IMG_20261001_100000.jpg"]
            assert "folder" not in items["20261012211403.png"]  # the game's keep the id they always had
            # A picture of the added folder is served like the game's; a video has no thumbnail, the window draws it.
            assert client.get(f"/api/gallery/{key}~IMG_20261001_100000.jpg/thumb").status_code == 200
            full = client.get(f"/api/gallery/{key}~IMG_20261001_100000.jpg/full")
            assert (full.status_code, full.headers["content-type"]) == (200, "image/jpeg")
            assert client.get(f"/api/gallery/{key}~Clip 2026-10-05 20-00-00.webm/thumb").status_code == 404
            # Favourites of both folders live side by side.
            assert client.put(f"/api/gallery/{key}~20261008090000.mp4/favourite", json={"on": True}).status_code == 200
            assert client.put("/api/gallery/20261012211403.png/favourite", json={"on": True}).status_code == 200
            assert core.store.gallery_favourites() == {f"{key}~20261008090000.mp4", "20261012211403.png"}
            # Nothing outside the listing: not the subfolder's, not the text file, not a bare name of the added folder.
            for unknown in ("inner%5C20250101120000.webm", f"{key}~inner%5C20250101120000.webm", f"{key}~notes.txt",
                            "IMG_20261001_100000.jpg", f"{key}~..%5Cx.jpg", "0000~20261008090000.mp4"):
                assert client.get(f"/api/gallery/{unknown}/full").status_code == 404, unknown
                assert client.get(f"/api/gallery/{unknown}/thumb").status_code == 404, unknown
            # Taking it out drops its pictures and its thumbnails; the folder is left as it was.
            thumbs = tmp_path / "data" / "gallery-thumbs"
            assert any(path.name.startswith(f"{key}~") for path in thumbs.iterdir())
            answer = client.post("/api/gallery/folders/remove", json={"path": str(folder).lower()})
            assert (answer.status_code, answer.json()) == (200, {"folders": []})
            assert not any(path.name.startswith(f"{key}~") for path in thumbs.iterdir())
            assert client.get("/api/gallery").json()["count"] == 3
            assert client.get(f"/api/gallery/{key}~IMG_20261001_100000.jpg/full").status_code == 404
        assert sorted(path.name for path in folder.iterdir()) == [
            "20261008090000.mp4", "Clip 2026-10-05 20-00-00.webm", "IMG_20261001_100000.jpg", "inner", "notes.txt",
        ]
    finally:
        core.store.close()


def test_added_folders_show_without_the_games_folder(tmp_path, clock, monkeypatch):
    core = _kept(tmp_path, clock, monkeypatch, game=False)
    folder = _added_folder(tmp_path)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            assert client.get("/api/gallery").json() == {
                "enabled": True, "folder_missing": True, "count": 0, "videos": 0, "added": 0, "months": [],
            }
            client.post("/api/gallery/folders", json={"path": str(folder)})
            model = client.get("/api/gallery").json()
            assert (model["folder_missing"], model["count"], model["added"]) == (True, 3, 1)  # Settings still asks for the game's
    finally:
        core.store.close()


def test_what_cannot_be_added_is_refused_in_plain_words(tmp_path, clock, monkeypatch):
    core = _kept(tmp_path, clock, monkeypatch)
    folder = _added_folder(tmp_path)
    (tmp_path / "file.txt").write_text("a file", encoding="utf-8")
    whole = "Paste the whole path of a folder on this PC, such as D:\\Videos."
    refused = {
        "": "Paste the path of a folder.",
        "Clips": whole,
        "\\\\server\\share\\Clips": whole,
        str(tmp_path / "nothing"): "That folder is not on this PC.",
        str(tmp_path / "file.txt"): "That folder is not on this PC.",
        str(tmp_path / "home" / "game" / "ScreenShot"): "That is the game's ScreenShot folder, which the gallery already shows.",
    }
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.get("/api/gallery")
            for path, message in refused.items():
                answer = client.post("/api/gallery/folders", json={"path": path})
                assert (answer.status_code, answer.json()) == (422, {"error": message}), path
            assert client.post("/api/gallery/folders", json={"path": 5}).json() == {"error": "Paste the path of a folder."}
            assert client.post("/api/gallery/folders", json={"path": str(folder)}).status_code == 200
            assert client.post("/api/gallery/folders", json={"path": str(folder).upper()}).json() == {
                "error": "That folder is already in the list."
            }
            assert client.post("/api/gallery/folders/remove", json={"path": str(tmp_path)}).json() == {
                "error": "That folder is not in the list."
            }
            # Twenty at most.
            for number in range(19):
                extra = tmp_path / f"more{number}"
                extra.mkdir()
                assert client.post("/api/gallery/folders", json={"path": str(extra)}).status_code == 200
            last = tmp_path / "last"
            last.mkdir()
            assert client.post("/api/gallery/folders", json={"path": str(last)}).json() == {
                "error": "You can add up to 20 folders."
            }
            # The list is not set through the settings: only these two routes change it.
            client.put("/api/settings", json={"gallery_folders": [str(last)]})
            assert str(last) not in client.get("/api/settings").json()["gallery_folders"]
    finally:
        core.store.close()


def test_the_added_folders_are_kept_across_a_restart_and_a_bad_list_is_dropped(tmp_path):
    from guildboard.config import settings_from_dict

    good = str(tmp_path / "A")
    assert settings_from_dict({"gallery_folders": [good]}).gallery_folders == [good]
    assert Settings().gallery_folders == []
    for bad in ("x", [5], [""], ["relative\\path"], ["\\\\server\\share"], [good, good.lower()], [good] * 21,
                ["x" * 1001], ["bad\ud800"], None):
        assert settings_from_dict({"gallery_folders": bad}).gallery_folders == [], bad


def test_a_video_streams_in_pieces_and_seeks_with_range(tmp_path, clock, monkeypatch, watch):
    core = _kept(tmp_path, clock, monkeypatch)
    folder = _added_folder(tmp_path)
    key = gallery.source_key(folder)
    path = folder / "20261008090000.mp4"
    content = path.read_bytes()
    url = f"/api/gallery/{key}~20261008090000.mp4/full"
    opened: list[Path] = []
    real = gamecache.open_shared
    monkeypatch.setattr(gamecache, "open_shared", lambda target: opened.append(Path(target)) or real(target))
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.post("/api/gallery/folders", json={"path": str(folder)})
            client.get("/api/gallery")
            seen = watch(folder)
            whole = client.get(url)
            assert (whole.status_code, whole.headers["content-type"], whole.headers["accept-ranges"]) == (
                200, "video/mp4", "bytes",
            )
            assert whole.headers["content-length"] == str(len(content)) and whole.content == content
            part = client.get(url, headers={"Range": "bytes=10-19"})
            assert (part.status_code, part.content) == (206, content[10:20])
            assert part.headers["content-range"] == f"bytes 10-19/{len(content)}"
            assert part.headers["content-length"] == "10"
            tail = client.get(url, headers={"Range": "bytes=-5"})
            assert (tail.status_code, tail.content) == (206, content[-5:])
            rest = client.get(url, headers={"Range": f"bytes={len(content) - 3}-"})
            assert rest.content == content[-3:]
            assert rest.headers["content-range"] == f"bytes {len(content) - 3}-{len(content) - 1}/{len(content)}"
            past = client.get(url, headers={"Range": f"bytes={len(content)}-"})
            assert (past.status_code, past.headers["content-range"]) == (416, f"bytes */{len(content)}")
            # More than one chunk: a video larger than the piece it is sent in.
            monkeypatch.setattr("guildboard.api.app.VIDEO_CHUNK", 1000)
            assert client.get(url).content == content
            assert client.get(url, headers={"Range": "bytes=999-2500"}).content == content[999:2501]
            # A picture is not streamed: it has no Accept-Ranges.
            assert "accept-ranges" not in client.get(f"/api/gallery/{key}~IMG_20261001_100000.jpg/full").headers
            # Only the listed files were opened, for reading.
            assert {kind for kind, _ in seen} == {"read"}
            assert {Path(name).name.lower() for _, name in seen} == {"20261008090000.mp4", "img_20261001_100000.jpg"}
    finally:
        core.store.close()
    assert {one for one in opened if one.parent == folder} == {path, folder / "IMG_20261001_100000.jpg"}
    assert path.read_bytes() == content


def test_a_video_the_player_stops_watching_is_closed(tmp_path, clock, monkeypatch):
    core = _kept(tmp_path, clock, monkeypatch)
    folder = _added_folder(tmp_path)
    key = gallery.source_key(folder)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.post("/api/gallery/folders", json={"path": str(folder)})
            client.get("/api/gallery")
            client.get(f"/api/gallery/{key}~20261008090000.mp4/full", headers={"Range": "bytes=0-9"})
            client.get(f"/api/gallery/{key}~20261008090000.mp4/full", headers={"Range": "bytes=999999-"})
    finally:
        core.store.close()
    # Nothing holds the file: it can be deleted by its owner at once.
    (folder / "20261008090000.mp4").unlink()


def test_the_game_folder_added_again_is_listed_once(tmp_path, clock, monkeypatch):
    core = _kept(tmp_path, clock, monkeypatch)
    game = tmp_path / "home" / "game" / "ScreenShot"
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.get("/api/gallery")
            # Kept by hand in the settings (the route refuses it): the listing still shows it once.
            core.settings.gallery_folders = [str(game)]
            core.gallery.forget()
            model = client.get("/api/gallery").json()
            assert (model["count"], model["added"]) == (3, 0)
    finally:
        core.store.close()


def test_a_folder_that_cannot_be_listed_keeps_every_thumbnail_and_the_others_still_show(tmp_path, clock, monkeypatch):
    core = _kept(tmp_path, clock, monkeypatch)
    folder = _added_folder(tmp_path)
    key = gallery.source_key(folder)
    try:
        with _client(core) as client:
            client.put("/api/settings", json={"gallery_enabled": True})
            client.post("/api/gallery/folders", json={"path": str(folder)})
            client.get("/api/gallery")
            client.get(f"/api/gallery/{key}~IMG_20261001_100000.jpg/thumb")
            core.settings.gallery_folders = [str(folder), str(tmp_path / "unplugged")]  # kept before the drive went
            core.gallery.forget()
            assert client.get("/api/gallery").json()["count"] == 6
            assert any(path.name.startswith(f"{key}~") for path in (tmp_path / "data" / "gallery-thumbs").iterdir())
    finally:
        core.store.close()


def test_the_demo_has_an_extra_folder_with_pictures_and_a_video_of_its_own(tmp_path, clock, monkeypatch, watch):
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
            assert (model["count"], model["videos"], model["added"]) == (gallery.DEMO_COUNT + 4, 1, 1)
            items = [item for month in model["months"] for item in month["pictures"]]
            video = next(item for item in items if item.get("video"))
            assert video["folder"] == gallery.DEMO_EXTRA_FOLDER
            streamed = client.get(f"/api/gallery/{video['id']}/full", headers={"Range": "bytes=0-3"})
            assert (streamed.status_code, streamed.content) == (206, b"\x1a\x45\xdf\xa3")
            # The extra folder is the demo's own: it is not among the folders the player added.
            assert client.get("/api/settings").json()["gallery_folders"] == []
    finally:
        core.store.close()
    assert seen == []
    assert sorted(path.suffix for path in (tmp_path / "data" / gallery.DEMO_EXTRA_FOLDER).iterdir()) == [
        ".jpg", ".jpg", ".jpg", ".webm",
    ]
