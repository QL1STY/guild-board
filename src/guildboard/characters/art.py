"""The art cache for the Characters pages (the Characters design, section 4.5): the pictures of characters, weapons, sets,
materials and constellations, kept on disk and served at /api/art/<key>.

A picture is downloaded once, through the injected `fetch_bytes`, from one of five hosts of HoYoverse's, up to 8 MB; it is
kept under the data folder's `art/`, and the cache holds at most 1 GB, dropping the pictures read longest ago first, so that the art of the
player's characters stays on disk and is not fetched twice. The
demo ships no picture and downloads nothing: its pages show the drawn signs.

A page that asks for a picture at a size (`get(key, size)`) is given a downscaled copy of it, WebP, made once from the original
the way the gallery makes its thumbnails (Qt, given bytes) and kept under `art-display/` beside the original: the 2048-pixel
original of a character's art is not what a 56-pixel face or a 900-pixel stage has to decode. The size is one of a few
(`DISPLAY_SIZES`), the longest side in pixels; a picture no larger than the size is served as it is. A copy goes when its
original is dropped, and the copies count in the 1 GB. Copies are made one at a time: each decodes its original into the core's
memory while it is made, and the first look at a roster asks for a hundred at once.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Sequence
from urllib.parse import quote, unquote, urlsplit

from guildboard import netpolicy
from guildboard.clock import Clock
from guildboard.config import AppPaths
from guildboard.netpolicy import fetch_bytes as _download
from guildboard.store import ArtRow, Store

log = logging.getLogger(__name__)

# The injected download of a picture: a function from an address, and the most bytes it may give, to the picture's bytes.
# It is None in the demo.
FetchBytes = Callable[..., bytes]

# The hosts a picture may come from (the Characters design, H6). fastcdn.hoyoverse.com is where HoYoLAB keeps the pictures of
# the characters the wiki's inventory leaves out (the Traveler, Manekin, Manekina); the player approved it on 2026-10-30.
ART_HOSTS = (
    "act-webstatic.hoyoverse.com", "act-upload.hoyoverse.com", "upload-static.hoyoverse.com", "bbs.hoyolab.com",
    "fastcdn.hoyoverse.com",
)
_KINDS = {
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
}
# The format Qt decodes each kind as. It is never left to guess one from the bytes (see _shrunk).
_QT_FORMATS = {".png": b"png", ".jpg": b"jpeg", ".webp": b"webp", ".gif": b"gif"}
# A key, as key_for makes them: the start of the address's SHA-256, in hex.
_KEY = re.compile(r"[0-9a-f]{32}")


def sound_row(key: object, file: object) -> bool:
    """Whether a row of the art table is one this cache writes: its key as key_for makes them, and its file either none (an
    address remembered, not fetched yet) or the key's own picture, its key and its kind's extension. The table comes back
    whole with a restored backup, which may not be the player's, so nothing a row names is followed unless this says so."""
    if not (isinstance(key, str) and isinstance(file, str) and _KEY.fullmatch(key)):
        return False
    return file == "" or file in {key + extension for extension in _KINDS}


def _extension(data: bytes) -> str | None:
    """The kind of picture the bytes are, by their first bytes; None when they are not one that is kept."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:4] == b"GIF8":
        return ".gif"
    return None


# The sizes a picture is kept at for display, the longest side in pixels: a face or an icon, and up to the art on the stage.
DISPLAY_SIZES = (128, 256, 512, 1024, 1536)
DISPLAY_QUALITY = 92


def display_size(wanted: int) -> int:
    """The size kept for a page that wants a picture this large: the next one up of `DISPLAY_SIZES`, or the largest."""
    return next((size for size in DISPLAY_SIZES if size >= wanted), DISPLAY_SIZES[-1])


def _shrunk(data: bytes, size: int) -> bytes | None:
    """The picture's bytes made so that its longest side is `size` pixels, as WebP with its see-through parts; None where the
    picture is no larger than that already, or Qt cannot read it. Qt is given bytes, never a path, as the gallery's thumbnails are,
    and the one format the bytes start as: given none, Qt would guess one, and its SVG reader reads the files an SVG names."""
    from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt
    from PySide6.QtGui import QImageReader

    kind = _QT_FORMATS.get(_extension(data) or "")
    if kind is None:
        return None
    source = QBuffer()
    source.setData(QByteArray(data))
    source.open(QIODevice.OpenModeFlag.ReadOnly)
    reader = QImageReader(source, kind)
    reader.setAutoDetectImageFormat(False)
    found = reader.size()  # from the header: the picture is not decoded to learn how large it is
    if not found.isValid() or max(found.width(), found.height()) <= size:
        return None
    image = reader.read()
    if image.isNull():
        return None
    image = image.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
    target = QBuffer()
    target.open(QIODevice.OpenModeFlag.WriteOnly)
    if not image.save(target, "WEBP", DISPLAY_QUALITY):
        return None
    return bytes(target.data())


_FULL = object()  # what a download that would not fit says to the warm-up

# The read time of a picture kept ahead that nobody has looked at yet: older than any real read, so that the cache drops
# such pictures first when a page needs room, and keeps the ones the player looked at.
_NEVER_READ = datetime(2000, 1, 1, tzinfo=timezone.utc)
# How often a picture's read is noted, at most. Each note is a write to the database, and a roster asks for about a hundred
# pictures at every start; a day is as fine as the cache needs to tell what the player looks at from what they do not.
READ_NOTED_EVERY = timedelta(days=1)


def _sendable(url: str) -> str:
    """An address as it is sent: the wiki writes spaces and letters of other scripts into its pictures' paths."""
    return quote(url, safe=":/?&=%#+@,;~!*'()$")


def live_download() -> FetchBytes:
    """The download the live app gives the cache: netpolicy's, which refuses any host outside HoYoverse's."""
    return _download


class ArtCache:
    # The Characters design, H6: the art cache, 8 MB a picture.
    CAP = 8 * 1024 * 1024
    # The most the cache keeps in all (the plan's call 4; 300 MB until 2026-10-31, when the player asked for room for the art of every
    # character they have; the warm-up stops when the cache is full, so it follows this).
    TOTAL_CAP = 1024 * 1024 * 1024
    # The demo's list of pictures (`pictures.json`: key and address; a tool's folder may add files, see `_pictures`).
    DEMO_DIR = Path(__file__).parent / "demo"

    def __init__(
        self, store: Store, paths: AppPaths, clock: Clock, fetch_bytes: FetchBytes | None, demo: bool
    ) -> None:
        self._store = store
        self._paths = paths
        self._clock = clock
        self._fetch_bytes = fetch_bytes
        self._demo = demo
        self.total_cap = self.TOTAL_CAP
        self.demo_dir = self.DEMO_DIR
        self._urls: dict[str, str] = {}  # the address each key was given for, in this run
        self._refused: set[str] = set()  # the keys of pictures that were too large or no picture, in this run
        self._whole_is_enough: set[tuple[str, int]] = set()  # the (key, size) pairs where the picture is no larger, or Qt cannot read it
        self._copy_bytes: dict[str, int] | None = None  # what the copies of each picture take on disk, read once a run
        self._shrinking = asyncio.Lock()  # one copy made at a time
        self._bundle: dict[str, dict[str, str]] | None = None
        self.warm_pause = 0.5  # seconds of rest between two pictures of a warm-up
        self.game_pause = 30.0  # seconds between two looks at whether the game still runs, while a warm-up waits for it
        self.sleep = asyncio.sleep
        self._full = False  # a warm-up found the cache full: no more warm-ups in this run
        self._lock = asyncio.Lock()  # one download at a time, so that the one that waits finds the picture just kept

    # ---------------------------------------------------------------------------------------------- keys and addresses
    def key_for(self, url: str) -> str:
        """A stable key from the address. An address with its characters escaped ("%20") and the same written plain have the
        one key: the wiki writes both."""
        return hashlib.sha256(unquote(url).encode("utf-8")).hexdigest()[:32]

    def address(self, url: str | None) -> str | None:
        """The address the page asks for a picture at, "/api/art/<key>"; None when there is no picture: no address, one
        outside the five hosts, or (in the demo) one the demo has no picture for. The address is remembered, so that the
        key can be served."""
        if not url:
            return None
        key = self.key_for(url)
        if self._demo:
            return f"/api/art/{key}" if key in self._pictures() else None
        if not self._allowed(url):
            return None
        if key not in self._urls:
            self._urls[key] = url
            if self._store.art(key) is None:
                self._store.put_art(ArtRow(key, url, "", 0, self._clock.now()))
        return f"/api/art/{key}"

    def usable(self, url: str | None) -> bool:
        """Whether `address` would give this address a picture: no request and nothing remembered, only the question."""
        if not url:
            return False
        if self._demo:
            return self.key_for(url) in self._pictures()
        return self._allowed(url)

    @staticmethod
    def _allowed(url: str) -> bool:
        try:
            parts = urlsplit(url)
            return parts.scheme == "https" and (parts.hostname or "").lower() in ART_HOSTS and parts.port is None
        except ValueError:
            return False

    # ---------------------------------------------------------------------------------------------- pictures
    async def get(self, key: str, size: int | None = None) -> tuple[bytes, str] | None:
        """A picture's bytes and content type; the demo's come from characters/demo/. None when the key has no picture, or
        the picture could not be had or was refused. With a `size` (the longest side the page shows it at, in pixels) it is the
        copy made for display at the next size up of `DISPLAY_SIZES`, WebP, made once and kept; the picture itself where it is
        no larger than that."""
        if size is None:
            return await self._whole(key)
        bucket = display_size(size)
        kept = self._kept_copy(key, bucket)
        if kept is not None:
            return kept
        whole = await self._whole(key)
        if whole is None or (key, bucket) in self._whole_is_enough:
            return whole
        async with self._shrinking:
            kept = self._kept_copy(key, bucket)  # made while this one waited
            if kept is not None:
                return kept
            data, kind = whole
            shrunk = await asyncio.to_thread(self._shrink, data, kind, bucket)
            if shrunk is None:
                self._whole_is_enough.add((key, bucket))
                return whole
            self._keep_copy(key, bucket, shrunk)
        return shrunk, "image/webp"

    def _kept_copy(self, key: str, size: int) -> tuple[bytes, str] | None:
        copy = self._copy_path(key, size)
        if copy is None:
            return None
        try:
            data = copy.read_bytes()
        except OSError:
            return None
        row = self._store.art(key)
        if row is not None:
            self._note_read(row)  # the picture is looked at: the cache keeps it
        return data, "image/webp"

    def _note_read(self, row: ArtRow) -> None:
        """Note that a kept picture was looked at, at most once in READ_NOTED_EVERY."""
        now = self._clock.now()
        if now - row.read_at >= READ_NOTED_EVERY:
            self._store.put_art(replace(row, read_at=now))

    def _keep_copy(self, key: str, size: int, data: bytes) -> None:
        copy = self._copy_path(key, size, make=True)
        if copy is None:
            return
        try:
            temporary = copy.with_name(copy.name + ".tmp")
            temporary.write_bytes(data)
            os.replace(temporary, copy)
        except OSError:
            log.info("A picture's copy for display could not be kept.")
            return
        copies = self._copies()
        copies[key] = copies.get(key, 0) + len(data)
        if not self._demo:
            self._trim(keep=key)

    def _copies(self) -> dict[str, int]:
        """The bytes the copies of each picture take; the folder is read once a run, and the count kept up after that."""
        if self._copy_bytes is None:
            self._copy_bytes = {}
            try:
                with os.scandir(self._display_folder()) as entries:
                    for entry in entries:
                        key = entry.name.partition("-")[0]
                        self._copy_bytes[key] = self._copy_bytes.get(key, 0) + entry.stat().st_size
            except OSError:
                pass  # no copy has been made yet
        return self._copy_bytes

    @staticmethod
    def _shrink(data: bytes, kind: str, size: int) -> bytes | None:
        if kind == "image/gif":  # it may move, and a copy would not
            return None
        try:
            return _shrunk(data, size)
        except Exception as error:  # a picture Qt cannot read is served as it is
            log.info("A picture could not be made smaller (%s).", type(error).__name__)
            return None

    def _copy_path(self, key: str, size: int, *, make: bool = False) -> Path | None:
        """Where the copy of this picture at this size is kept; None for a key that has no picture, so that no path is made of
        what a page sent."""
        known = key in self._pictures() if self._demo else self._store.art(key) is not None
        if not known or not key.isalnum():
            return None
        folder = self._display_folder()
        if make:
            folder.mkdir(parents=True, exist_ok=True)
        return folder / f"{key}-{size}.webp"

    def _display_folder(self) -> Path:
        return self._paths.data_dir / "art-display"

    async def _whole(self, key: str) -> tuple[bytes, str] | None:
        if self._demo:
            return self._bundled(key)
        row = self._store.art(key)
        if row is not None and not sound_row(row.key, row.file):
            self._drop_unsound(row)
            row = None  # and its address is not one to fetch either
        if row is not None and row.file:
            kept = self._read(row)
            if kept is not None:
                self._note_read(row)
                return kept
        url = row.url if row is not None else self._urls.get(key)
        if url is None or not self._allowed(url) or key in self._refused or self._fetch_bytes is None:
            return None
        async with self._lock:
            row = self._store.art(key)
            if row is not None and row.file:  # kept while this one waited
                kept = self._read(row)
                if kept is not None:
                    return kept
            return await self._download(key, url)

    def _path(self, row: ArtRow) -> Path | None:
        """The file a row keeps, in the cache's folder; None when it keeps none. A row this cache could not have written, or
        whose file leads out of the folder (a link put there), is dropped and never followed: nothing is read, asked about or
        deleted for it."""
        if not sound_row(row.key, row.file):
            self._drop_unsound(row)
            return None
        if not row.file:
            return None
        folder = self._folder()
        path = folder / row.file
        if path.resolve().parent != folder.resolve():
            self._drop_unsound(row)
            return None
        return path

    def _drop_unsound(self, row: ArtRow) -> None:
        log.warning("A row of the art cache named a file the cache does not keep, so it was dropped.")
        self._store.drop_art(row.key)

    def _read(self, row: ArtRow) -> tuple[bytes, str] | None:
        path = self._path(row)
        if path is None:
            return None
        try:
            return path.read_bytes(), _KINDS.get(path.suffix.lower(), "application/octet-stream")
        except OSError:
            return None  # the file is gone: the picture is fetched again

    # ---------------------------------------------------------------------------------------------- the warm-up
    def cached(self, url: str) -> bool:
        """Whether this address's picture is already kept on disk."""
        row = self._store.art(self.key_for(url))
        path = self._path(row) if row is not None else None
        return path is not None and path.is_file()

    def used(self) -> int:
        """The bytes the cache holds now: the pictures and their copies. A copy whose picture has gone is not counted, so it
        can never make the cache drop what it has, and neither is a row the cache could not have written."""
        copies = self._copies()
        return sum(
            row.bytes + copies.get(row.key, 0) for row in self._store.art_rows()
            if row.bytes > 0 and sound_row(row.key, row.file)
        )

    async def warm(self, urls: Sequence[str], *, paused: Callable[[], bool] = lambda: False) -> int:
        """Fetch the pictures of these addresses that are not kept yet, in the order given, one at a time with a rest between
        them, so that a page does not wait for them the first time. It stops when the cache is full: a picture that would not
        fit is not kept, and nothing the player looked at is dropped to make room; what it keeps counts as never looked at, so a
        page that needs room drops it first. It asks for nothing in the demo, for an address outside the five hosts, or for
        one that was refused; once the cache is full it asks for nothing more in this run. While `paused` says so (the game
        runs) it waits before each picture and goes on after, so that it never takes the network or the disk from the game.
        Returns how many it kept."""
        if self._demo or self._fetch_bytes is None or self._full:
            return 0
        kept = 0
        for url in urls:
            if not self._allowed(url):
                continue
            key = self.key_for(url)
            if key in self._refused or self.cached(url):
                continue
            if self.used() >= self.total_cap:
                self._full = True
                break
            while paused():
                await self.sleep(self.game_pause)
            self.address(url)  # remembered, so that the page's own request for it finds the address
            async with self._lock:
                if self.cached(url):
                    continue
                outcome = await self._download(key, url, fit=True)
            if outcome is _FULL:
                self._full = True
                break
            if outcome is not None:
                kept += 1
                await self.sleep(self.warm_pause)
        return kept

    async def _download(self, key: str, url: str, *, fit: bool = False) -> tuple[bytes, str] | None:
        if not _KEY.fullmatch(key):  # the kept file is named by the key, so a key is never anything else
            return None
        try:
            data = await asyncio.to_thread(self._fetch_bytes, _sendable(url), max_bytes=self.CAP, hosts=ART_HOSTS)
        except netpolicy.ResponseTooLarge:
            self._refused.add(key)
            log.info("A picture was larger than %d MB and was not kept.", self.CAP // (1024 * 1024))
            return None
        except Exception as error:  # a picture is decoration: it is asked for again the next time it is wanted
            log.info("A picture could not be downloaded (%s).", netpolicy.what_failed(error))
            return None
        extension = _extension(data) if len(data) <= self.CAP else None
        if extension is None:
            self._refused.add(key)
            log.info("A download was too large or no picture, and was not kept.")
            return None
        if fit and self.used() + len(data) > self.total_cap:
            return _FULL  # type: ignore[return-value]
        folder = self._folder()
        folder.mkdir(parents=True, exist_ok=True)
        file = key + extension
        temporary = folder / (file + ".tmp")
        temporary.write_bytes(data)
        os.replace(temporary, folder / file)
        now = _NEVER_READ if fit else self._clock.now()
        self._store.put_art(ArtRow(key, url, file, len(data), now))
        self._trim(keep=key)
        return data, _KINDS[extension]

    def _trim(self, *, keep: str) -> None:
        """Drop the pictures read longest ago while the cache holds more than its limit, never the one just kept. A row the cache
        could not have written is dropped first, and what it names is left alone: it is no picture of the cache's."""
        rows = []
        for row in self._store.art_rows():  # oldest read first
            if not sound_row(row.key, row.file):
                self._drop_unsound(row)
            elif row.bytes > 0:
                rows.append(row)
        copies = self._copies()
        total = sum(row.bytes + copies.get(row.key, 0) for row in rows)
        for row in rows:
            if total <= self.total_cap:
                break
            if row.key == keep:
                continue
            try:
                path = self._path(row)
                if path is not None:
                    path.unlink(missing_ok=True)
                for copy in self._display_folder().glob(f"{row.key}-*"):
                    copy.unlink(missing_ok=True)  # no copy outlives its picture
            except OSError:
                log.info("A picture of the cache could not be deleted.")
                continue
            self._store.drop_art(row.key)
            total -= row.bytes + copies.pop(row.key, 0)

    def _folder(self) -> Path:
        return self._paths.data_dir / "art"

    # ---------------------------------------------------------------------------------------------- the demo's pictures
    def _pictures(self) -> dict[str, dict[str, str]]:
        """The demo's pictures, key by key: the file of each and the address it came from. Only an entry with a file is a
        picture: the demo ships none of HoYoverse's art, so the list it ships (key and address, for a later website) names no
        file and the demo shows the drawn signs. A folder that holds files (a tool's, a test's) is served as it lists them."""
        if self._bundle is None:
            try:
                loaded = json.loads((self.demo_dir / "pictures.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                loaded = {}
            if not isinstance(loaded, dict):
                loaded = {}
            self._bundle = {
                key: entry for key, entry in loaded.items() if isinstance(entry, dict) and isinstance(entry.get("file"), str)
            }
        return self._bundle

    def _bundled(self, key: str) -> tuple[bytes, str] | None:
        entry = self._pictures().get(key)
        file = entry.get("file") if isinstance(entry, dict) else None
        if not isinstance(file, str):
            return None
        try:
            path = (self.demo_dir / file).resolve()
            if self.demo_dir.resolve() not in path.parents:
                return None
            return path.read_bytes(), _KINDS.get(path.suffix.lower(), "application/octet-stream")
        except OSError:
            return None
