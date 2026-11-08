r"""The screenshot gallery (the ledger design, section 7).

Off by default. While it is off, nothing of the game's is read: not its log, not its folders. While the player has it
turned on, Guild Board reads two kinds of the game's files, each read-only and nothing else:

- the game's log, once, to learn its data folder (as the Import does, through pulls/gamecache.py), when no folder was
  found or pasted before;
- the pictures directly inside the ScreenShot folder next to that data folder: the folder is listed, and a picture is
  read when its thumbnail is made or the player opens it. No subfolder is looked into.

Each picture is opened through gamecache.open_shared: with the right to read alone, shared with the game, and announced
to the audit hook the tests watch with. Pillow never opens a file of the game's: it is given the bytes read here, and decodes
them only as the PNG or JPEG their first bytes say, never as a format it guesses. Nothing in the game's folders is ever
written, moved, renamed or deleted. Thumbnails go into Guild Board's own data folder,
gallery-thumbs, and a picture's id from the browser maps only to a file of the current listing. "Show in folder" starts
Explorer with that file selected, and that is the only program the gallery starts.
"""
from __future__ import annotations

import contextlib
import io
import logging
import os
import re
import stat
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Mapping

from guildboard.config import Settings, is_network_path
from guildboard.pulls import gamecache

log = logging.getLogger(__name__)

FOLDER_NAME = "ScreenShot"  # the game's folder of pictures, next to its data folder
# A picture's id is its file name, and only a name of these characters and endings is listed.
PICTURE_NAME = re.compile(r"^[\w .()\-]+\.(png|jpg|jpeg)$", re.IGNORECASE)
# The time a name may hold, as 20261026211403 or 2026-10-26 21-14-03 (and with dots or underscores).
NAME_TIME = re.compile(r"(?<!\d)(\d{4})[-._]?(\d{2})[-._]?(\d{2})[ _\-.]{0,3}(\d{2})[-._]?(\d{2})[-._]?(\d{2})(?!\d)")
MAX_PICTURE_BYTES = 200_000_000
THUMB_WIDTH = 480
THUMB_QUALITY = 82
THUMBS_FOLDER = "gallery-thumbs"
PARTIAL_SECONDS = 60  # a thumbnail's partial file older than this was left by a write cut short; one is written in moments
MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
# The first bytes of the two kinds of picture the game writes, and the format Pillow decodes each as. Nothing else is decoded.
SIGNATURES = ((b"\x89PNG\r\n\x1a\n", "PNG"), (b"\xff\xd8\xff", "JPEG"))


@dataclass(frozen=True)
class Picture:
    id: str  # the file name, which is the id the browser asks with
    name: str
    taken: datetime  # local time, with its offset
    bytes: int
    modified_ns: int

    @property
    def media_type(self) -> str:
        return MEDIA_TYPES[Path(self.name).suffix.lower()]


class PictureMissing(Exception):
    """The picture is not in the listing, or could not be read."""


def is_folder_named_screenshot(path: Path) -> bool:
    """Whether the path is an existing folder named ScreenShot, in any case, on this PC. Asks its kind, which opens
    nothing; a network path is not asked about, as that would reach out to another computer."""
    if is_network_path(str(path)):
        return False
    try:
        return path.is_absolute() and path.name.casefold() == FOLDER_NAME.casefold() and path.is_dir()
    except OSError:
        return False


def folder_from_log() -> Path | None:
    """The ScreenShot folder next to the game's data folder, which the game's log names; None when the log cannot be
    read or names none, or the folder is not there. The log is read read-only, as the Import reads it."""
    try:
        data = gamecache.data_folder(gamecache.read_log(gamecache.log_path()))
    except (gamecache.CacheProblem, OSError):
        return None
    if data is None:
        return None
    folder = data.parent / FOLDER_NAME
    return folder if is_folder_named_screenshot(folder) else None


def find_folder(settings: Settings, from_log: Callable[[], Path | None] = folder_from_log) -> Path | None:
    """The game's ScreenShot folder: the one the settings keep, found before or pasted, when it is an existing folder
    named ScreenShot; else the one next to the data folder the game's log names; else None."""
    if settings.gallery_folder:
        kept = Path(settings.gallery_folder)
        if is_folder_named_screenshot(kept):
            return kept
    return from_log()


def taken_from_name(name: str) -> datetime | None:
    """The time a picture's name holds, as local time; None when it holds none."""
    found = NAME_TIME.search(Path(name).stem)
    if found is None:
        return None
    try:
        return datetime(*(int(part) for part in found.groups())).astimezone()
    except (ValueError, OverflowError, OSError):
        return None


def _modified(info: os.stat_result) -> datetime | None:
    """A file's modified time, as local time; None when there is none to give, as Windows gives none before 1970 or
    after the year 3000."""
    try:
        return datetime.fromtimestamp(info.st_mtime_ns / 1e9).astimezone()
    except (OSError, OverflowError, ValueError):
        return None


def list_pictures(folder: Path) -> list[Picture]:
    """The pictures directly inside the folder, newest first: files only, no subfolder, no link, and only the names
    PICTURE_NAME allows. The folder is listed, and each file's size and time asked; no file is opened. A picture whose
    time can be read neither from its name nor as a local time is left out, alone. OSError when the folder cannot be
    listed, as on a drive that is unplugged."""
    found: list[Picture] = []
    timeless = 0
    for entry in list(os.scandir(folder)):
        if not PICTURE_NAME.match(entry.name):
            continue
        try:
            if entry.is_symlink():
                continue
            info = entry.stat(follow_symlinks=False)
        except OSError:
            continue
        if not stat.S_ISREG(info.st_mode):
            continue
        taken = taken_from_name(entry.name) or _modified(info)
        if taken is None:
            timeless += 1
            continue
        found.append(Picture(entry.name, entry.name, taken, info.st_size, info.st_mtime_ns))
    if timeless:
        log.info("%d screenshot(s) were left out: their time could not be read.", timeless)
    found.sort(key=lambda picture: (picture.taken, picture.name), reverse=True)
    return found


def read_picture(folder: Path, picture_id: str, listing: Mapping[str, Picture]) -> bytes:
    """The bytes of a picture of the listing, read-only and shared with the game. KeyError for an id the listing does
    not hold: no file is opened for it."""
    picture = listing[picture_id]
    if picture.bytes > MAX_PICTURE_BYTES:
        raise PictureMissing(picture_id)
    with gamecache.open_shared(folder / picture.name) as file:
        return file.read(MAX_PICTURE_BYTES + 1)


def thumb_name(picture: Picture) -> str:
    """The thumbnail's file name: the picture's name, size and time, so that a changed picture gets a new one."""
    return f"{picture.name}-{picture.bytes}-{picture.modified_ns}.jpg"


def _format(data: bytes) -> str:
    """The format Pillow is to decode a picture's bytes as, by their first bytes; PictureMissing for anything but PNG or JPEG."""
    for signature, kind in SIGNATURES:
        if data.startswith(signature):
            return kind
    raise PictureMissing("not a PNG or JPEG picture")


def _jpeg(data: bytes) -> bytes:
    """A thumbnail of the picture's bytes, THUMB_WIDTH wide, as JPEG bytes. Pillow is given bytes, never a path, and the
    one format the bytes start as: it is never left to guess one from the bytes."""
    from PIL import Image  # not at the top: a start does not wait for it

    kind = _format(data)
    try:
        with Image.open(io.BytesIO(data), formats=[kind]) as image:
            width, height = image.size  # from the header; a JPEG is then decoded at about the thumbnail's size, not whole
            target = None
            if width > THUMB_WIDTH:
                target = (THUMB_WIDTH, max(1, round(height * THUMB_WIDTH / width)))
                if kind == "JPEG":
                    image.draft("RGB", target)
            image = image.convert("RGB")  # a thumbnail has no see-through parts
            if target is not None:
                image = image.resize(target, Image.Resampling.LANCZOS)
    except Exception as problem:  # cut short, garbled (Pillow raises SyntaxError for a bad PNG chunk), or too large to be safe
        raise PictureMissing("not a picture Pillow reads") from problem
    written = io.BytesIO()
    try:
        image.save(written, "JPEG", quality=THUMB_QUALITY)
    except Exception as problem:
        raise PictureMissing("the thumbnail could not be made") from problem
    return written.getvalue()


def thumbnail(folder: Path, picture: Picture, thumbs: Path) -> Path:
    """The picture's thumbnail in Guild Board's own folder `thumbs`, made once from the picture's bytes and kept."""
    path = thumbs / thumb_name(picture)
    if path.is_file():
        return path
    data = read_picture(folder, picture.id, {picture.id: picture})
    small = _jpeg(data)
    thumbs.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.{threading.get_ident()}.tmp")
    try:
        partial.write_bytes(small)
        os.replace(partial, path)
    except OSError:
        if path.is_file():  # made meanwhile by another request for the same picture, which may hold it open
            return path
        raise
    finally:
        with contextlib.suppress(OSError):  # one left all the same is pruned later
            partial.unlink(missing_ok=True)
    return path


def prune_thumbnails(thumbs: Path, listing: Mapping[str, Picture]) -> int:
    """Removes the thumbnails of pictures no longer listed, in Guild Board's own folder, and the partial files a write cut
    short left there, once they are older than PARTIAL_SECONDS: a younger one may be being written now. How many."""
    wanted = {thumb_name(picture) for picture in listing.values()}
    removed = 0
    try:
        kept = list(thumbs.iterdir())
    except OSError:
        return 0
    now = time.time()
    for path in kept:
        try:
            stale = (path.suffix == ".jpg" and path.name not in wanted) or (
                path.suffix == ".tmp" and now - path.stat().st_mtime > PARTIAL_SECONDS
            )
            if stale:
                path.unlink()
                removed += 1
        except OSError:
            continue
    return removed


def show_in_explorer(path: Path) -> None:
    """Opens Explorer with the file selected. The only program the gallery starts; nothing is done to the file."""
    # By its full path: a bare name would let the search order start a program of that name from the current folder.
    explorer = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "explorer.exe")
    subprocess.Popen(f'"{explorer}" /select,"{path}"', close_fds=True)


# In English whatever the PC's language, as every word on screen is.
MONTHS = (
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December",
)


def month_label(when: datetime) -> str:
    return f"{MONTHS[when.month - 1]} {when.year}"


def tile_label(when: datetime) -> str:
    return f"{when.day} {MONTHS[when.month - 1][:3]} {when:%H:%M}"


def long_label(when: datetime) -> str:
    return f"{when.day} {MONTHS[when.month - 1]} {when.year}, {when:%H:%M}"


class Gallery:
    """The gallery's state in the core: the folder and its listing, kept from the last look. Every method answers
    nothing and reads nothing while the gallery is off."""

    def __init__(
        self,
        settings: Callable[[], Settings],
        favourites: Callable[[], set[str]],
        set_favourite: Callable[[str, bool], None],
        thumbs: Path,
        locate: Callable[[Settings], Path | None] = find_folder,
        show: Callable[[Path], None] = show_in_explorer,
    ) -> None:
        self._settings = settings
        self._favourites = favourites
        self._set_favourite = set_favourite
        self.thumbs = thumbs
        self._locate = locate
        self._show = show
        self._lock = threading.Lock()
        self._looking = threading.Lock()  # one look at a time: a second waits, then looks at what the first left
        self._folder: Path | None = None
        self._listing: dict[str, Picture] | None = None
        self._generation = 0  # goes up with each forget()

    @property
    def enabled(self) -> bool:
        return self._settings().gallery_enabled

    @property
    def folder(self) -> Path | None:
        """The folder of the last look; None before one, or when none was found."""
        with self._lock:
            return self._folder

    @property
    def looked(self) -> bool:
        """Whether there is a listing from a look since the gallery was turned on."""
        with self._lock:
            return self._listing is not None

    def forget(self) -> None:
        """Drops the folder and the listing: the gallery was turned off, or its folder changed."""
        with self._lock:
            self._generation += 1  # a look still running keeps nothing
            self._folder = None
            self._listing = None

    def look(self) -> None:
        """Finds the folder and lists it anew, while the gallery is on. It may read the game's log and lists the folder,
        so the core runs it away from its event loop."""
        if not self.enabled:
            return
        with self._looking:
            with self._lock:
                started = self._generation
            folder = self._locate(self._settings())
            listing: dict[str, Picture] = {}
            if folder is not None:
                try:
                    listing = {picture.id: picture for picture in list_pictures(folder)}
                except OSError as problem:
                    # Its pictures are not gone, only out of reach: their thumbnails stay.
                    log.warning("The screenshot folder could not be listed (%s).", type(problem).__name__)
                else:
                    prune_thumbnails(self.thumbs, listing)
            with self._lock:
                if self._generation != started:
                    return  # forgotten while it ran: what it found is for a folder or a gallery no longer chosen
                self._folder = folder
                self._listing = listing

    def _current(self) -> tuple[Path | None, dict[str, Picture]]:
        with self._lock:
            return self._folder, dict(self._listing or {})

    def model(self) -> dict[str, Any]:
        """What GET /api/gallery answers, from the last look. While the gallery is off, nothing but that."""
        if not self.enabled:
            return {"enabled": False}
        folder, listing = self._current()
        if folder is None:
            return {"enabled": True, "folder_missing": True, "count": 0, "months": []}
        favourites = self._favourites()
        months: list[dict[str, Any]] = []
        for picture in sorted(listing.values(), key=lambda p: (p.taken, p.name), reverse=True):
            label = month_label(picture.taken)
            if not months or months[-1]["label"] != label:
                months.append({"label": label, "pictures": []})
            months[-1]["pictures"].append({
                "id": picture.id,
                "taken": picture.taken.isoformat(timespec="seconds"),
                "time": tile_label(picture.taken),
                "when": long_label(picture.taken),
                "favourite": picture.id in favourites,
            })
        return {"enabled": True, "folder_missing": False, "count": len(listing), "months": months}

    def _picture(self, picture_id: str) -> tuple[Path, Picture, dict[str, Picture]]:
        """The folder and the listed picture of an id; PictureMissing for one not listed, or while off."""
        if not self.enabled:
            raise PictureMissing(picture_id)
        folder, listing = self._current()
        if folder is None or picture_id not in listing:
            raise PictureMissing(picture_id)
        return folder, listing[picture_id], listing

    def full(self, picture_id: str) -> tuple[bytes, str]:
        folder, picture, listing = self._picture(picture_id)
        try:
            return read_picture(folder, picture_id, listing), picture.media_type
        except OSError as problem:
            log.warning("A screenshot could not be read (%s).", type(problem).__name__)
            raise PictureMissing(picture_id) from problem

    def thumb(self, picture_id: str) -> bytes:
        folder, picture, _ = self._picture(picture_id)
        try:
            return thumbnail(folder, picture, self.thumbs).read_bytes()
        except OSError as problem:
            log.warning("A screenshot's thumbnail could not be made (%s).", type(problem).__name__)
            raise PictureMissing(picture_id) from problem

    def favourite(self, picture_id: str, on: bool) -> None:
        self._picture(picture_id)
        self._set_favourite(picture_id, on)

    def show(self, picture_id: str) -> None:
        folder, picture, _ = self._picture(picture_id)
        self._show(folder / picture.name)


# ---------------------------------------------------------------- the demo's pictures

DEMO_FOLDER = "demo-screenshots"
DEMO_COUNT = 24
# Sky, horizon and ground of each made-up picture, after the mockup's tiles.
DEMO_SCENES = (
    ("#9fc3e6", "#e9d7a7", "#6f8f5a"), ("#2b2f55", "#6b4f8f", "#d39ad0"), ("#f3c58a", "#d66f4f", "#3b2a3a"),
    ("#8ad1c8", "#3b8f9a", "#1f3e4c"), ("#e8e2d0", "#b9a37c", "#5b4a33"), ("#1b2b44", "#3f6aa0", "#a7d0f0"),
    ("#f7e3a3", "#9cc06a", "#3d6b3a"), ("#4a2d2d", "#b0503c", "#f2b36b"),
)


def _rgb(colour: str) -> tuple[int, int, int]:
    return int(colour[1:3], 16), int(colour[3:5], 16), int(colour[5:7], 16)


def _mix(one: tuple[int, int, int], other: tuple[int, int, int], at: float) -> tuple[int, int, int]:
    return (round(one[0] + (other[0] - one[0]) * at), round(one[1] + (other[1] - one[1]) * at),
            round(one[2] + (other[2] - one[2]) * at))


def _demo_picture(index: int, width: int, height: int, kind: str) -> bytes:
    """One made-up screenshot: a sky that fades to a horizon and a ground along a slanted line, a pale sun and a dark ridge."""
    from PIL import Image, ImageDraw

    sky, horizon, ground = (_rgb(colour) for colour in DEMO_SCENES[index % len(DEMO_SCENES)])
    # The slanted gradient: a strip of the three colours (position 0 to 1 along the line, then the ground beyond it) sheared
    # onto the picture, which draws it in one pass instead of pixel by pixel.
    steps = 2048
    strip = Image.new("RGB", (steps, 4))
    pen = ImageDraw.Draw(strip)
    for column in range(steps):
        at = column / (steps / 2)
        colour = _mix(sky, horizon, at / 0.55) if at < 0.55 else _mix(horizon, ground, (at - 0.55) / 0.45) if at < 1 else ground
        pen.line([(column, 0), (column, 3)], fill=colour)
    along_x, along_y = width * 0.35, height  # the line runs from the top left towards (0.35 width, height)
    scale = (steps / 2) / (along_x * along_x + along_y * along_y)
    image = strip.transform((width, height), Image.Transform.AFFINE, (along_x * scale, along_y * scale, 1, 0, 0, 2),
                            Image.Resampling.BILINEAR)

    def shape(colour: tuple[int, int, int], alpha: int, draw: Callable[[ImageDraw.ImageDraw, int], None]) -> None:
        # Drawn twice as large and shrunk, so that the edges are smooth.
        mask = Image.new("L", (width * 2, height * 2), 0)
        draw(ImageDraw.Draw(mask), 2)
        image.paste(colour, mask=mask.reduce(2).point(lambda value: value * alpha // 255))

    sun = 0.2 + 0.6 * ((index * 37) % 100) / 100
    radius = height * 0.08

    def draw_sun(pen: ImageDraw.ImageDraw, zoom: int) -> None:
        centre = (width * sun * zoom, height * 0.28 * zoom)
        pen.ellipse([centre[0] - radius * zoom, centre[1] - radius * zoom, centre[0] + radius * zoom, centre[1] + radius * zoom],
                    fill=255)

    lift = ((index * 13) % 20) / 100
    ridge = (
        (0, height), (0, height * (0.72 - lift)), (width * 0.28, height * (0.58 + lift / 2)), (width * 0.55, height * 0.74),
        (width * 0.8, height * (0.6 - lift / 2)), (width, height * 0.7), (width, height),
    )

    def draw_ridge(pen: ImageDraw.ImageDraw, zoom: int) -> None:
        pen.polygon([(x * zoom, y * zoom) for x, y in ridge], fill=255)

    shape((255, 244, 214), 190, draw_sun)
    shape(tuple(round(part / 1.4) for part in ground), 225, draw_ridge)  # the ground, a shade darker
    written = io.BytesIO()
    image.save(written, "JPEG" if kind == "JPG" else kind, quality=88)
    return written.getvalue()


def fill_demo_folder(folder: Path, now: datetime) -> None:
    """The demo's ScreenShot folder, in its own data folder: DEMO_COUNT made-up pictures over the three months before
    `now`, named as the game names them. Made once; the demo never reads the game's folders."""
    if folder.is_dir() and any(folder.iterdir()):
        return
    folder.mkdir(parents=True, exist_ok=True)
    local = now.astimezone()
    for index in range(DEMO_COUNT):
        # Evenings, a day to a week apart, the newest the evening before `now`.
        day = local - timedelta(days=1 + round(index * 3.7))
        when = day.replace(hour=18 + (index * 3) % 5, minute=(index * 17 + 4) % 60, second=(index * 7) % 60)
        kind = "PNG" if index % 6 == 5 else "JPG"
        size = (960, 540) if kind == "PNG" else (1600, 900)  # small enough to be made quickly at every demo's start
        name = f"{when:%Y%m%d%H%M%S}.{kind.lower()}"
        (folder / name).write_bytes(_demo_picture(index, *size, kind))


def demo_locator(folder: Path, clock_now: Callable[[], datetime]) -> Callable[[Settings], Path | None]:
    """The demo's stand-in for find_folder: its own folder, filled the first time the gallery looks."""

    def locate(settings: Settings) -> Path | None:
        fill_demo_folder(folder, clock_now())
        return folder

    return locate
