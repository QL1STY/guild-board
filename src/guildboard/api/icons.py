"""Icons shown in the interface are downloaded once, from HoYoverse's picture hosts only, and served from the data folder.
What is kept is a picture by its bytes, the folder keeps to its size, and an address that gave no picture is not asked again
for a day (the audit's API-11)."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from guildboard import netpolicy

log = logging.getLogger(__name__)

_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif")
# The hosts a picture of the interface comes from: the five the art cache takes (characters/art.py), HoYoLAB's game record
# icons (upload-os-bbs, the expeditions' faces among them), the banners of the announcements (sdk), the pre-set timers'
# pictures (uploadstatic) and the daily check-in's rewards (webstatic, with upload-static). A friend writes their own picture's address, and the project takes any address on HoYoverse's three
# domains: these alone are asked, never one of HoYoLAB's APIs.
PICTURE_HOSTS = (
    "act-webstatic.hoyoverse.com", "act-upload.hoyoverse.com", "upload-static.hoyoverse.com", "bbs.hoyolab.com",
    "fastcdn.hoyoverse.com", "upload-os-bbs.mihoyo.com", "upload-os-bbs.hoyolab.com", "sdk.hoyoverse.com",
    "uploadstatic.mihoyo.com", "webstatic.hoyoverse.com",
)
CAP_BYTES = 100 * 1024 * 1024  # the folder at most: the icons used longest ago go first
RETRY_SECONDS = 24 * 3600  # an address that gave no picture is asked again a day later, not each time a page shows it
OFFLINE_RETRY_SECONDS = 10 * 60  # one that could not be reached is asked again sooner: Guild Board runs for days, a blip passes


def _file_name(url: str) -> str:
    suffix = Path(urlsplit(url).path).suffix.lower()
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]
    return digest + (suffix if suffix in _EXTENSIONS else ".img")


def _kind(data: bytes) -> str | None:
    """The kind of picture the bytes are, by their first bytes, whatever the address said; None for anything else."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:4] == b"GIF8":
        return "image/gif"
    return None


def _is_picture_host(url: str) -> bool:
    """An https address on one of PICTURE_HOSTS, with no port and no user."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme == "https" and port is None and parts.username is None and parts.password is None
        and (parts.hostname or "").lower() in PICTURE_HOSTS
    )


class IconCache:
    def __init__(
        self,
        folder: Path,
        fetch: Callable[[str], bytes] = netpolicy.fetch_bytes,
        *,
        cap: int = CAP_BYTES,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._folder = folder
        self._fetch = fetch
        self._cap = cap
        self._now = now
        self._failed: dict[str, float] = {}  # the addresses that gave no picture, and until when they are not asked again

    async def get(self, url: str) -> tuple[bytes, str] | None:
        if not url or not _is_picture_host(url) or not netpolicy.is_hoyoverse(url):
            return None
        path = self._folder / _file_name(url)
        kept = await asyncio.to_thread(self._kept, path)
        if kept is not None:
            return kept
        failed = self._failed.get(url)
        if failed is not None and self._now() < failed:
            return None
        found = await asyncio.to_thread(self._download, url, path)
        if isinstance(found, float):  # how long this address is left alone
            now = self._now()
            self._failed = {address: until for address, until in self._failed.items() if now < until}
            self._failed[url] = now + found
            return None
        self._failed.pop(url, None)
        return found

    def _kept(self, path: Path) -> tuple[bytes, str] | None:
        """The picture kept at `path`, marked as used now; None when there is none. A file that is no picture, as an older
        Guild Board kept anything, goes."""
        try:
            data = path.read_bytes()
        except OSError:
            return None
        kind = _kind(data)
        try:
            if kind is None:
                path.unlink(missing_ok=True)
            else:
                os.utime(path)  # the cache keeps the icons used last
        except OSError:
            pass
        return (data, kind) if kind is not None else None

    def _download(self, url: str, path: Path) -> tuple[bytes, str] | float:
        """The picture at `url`, kept when it is one. An icon is decoration: any failure means no icon, and the seconds to leave
        the address alone: a short while when it could not be reached, a day when it answered with no picture."""
        try:
            data = self._fetch(url)
        except Exception as error:
            log.info("An icon could not be downloaded (%s).", netpolicy.what_failed(error))
            return float(OFFLINE_RETRY_SECONDS)
        kind = _kind(data)
        if kind is None:
            log.info("A download for an icon was no picture, and was not kept.")
            return float(RETRY_SECONDS)
        # A name of this thread's own: two downloads of one icon at once must not write one file.
        temporary = path.with_name(f"{path.name}.{threading.get_ident()}.{secrets.token_hex(4)}.tmp")
        try:
            self._folder.mkdir(parents=True, exist_ok=True)
            temporary.write_bytes(data)
            os.replace(temporary, path)
        except OSError:
            log.info("An icon could not be kept, and is served all the same.")
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
            return data, kind
        self._trim(keep=path)
        return data, kind

    def _trim(self, keep: Path) -> None:
        """The icons used longest ago go while the folder holds more than its cap, never the one just kept."""
        try:
            files = []
            for entry in os.scandir(self._folder):
                if entry.is_file():
                    stat = entry.stat()
                    files.append((stat.st_mtime, stat.st_size, Path(entry.path)))
        except OSError:
            return
        total = sum(size for _, size, _ in files)
        for _, size, file in sorted(files):
            if total <= self._cap:
                return
            if file == keep:
                continue
            try:
                file.unlink(missing_ok=True)
            except OSError:
                continue
            total -= size
