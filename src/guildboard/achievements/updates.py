"""Keeping the achievement list current: a check downloads Paimon.moe's list and compares it with the installed one,
install puts it in place on the player's word, and undo goes back one step."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from functools import cached_property
from typing import Any, Awaitable, Callable
from urllib.error import HTTPError

from guildboard import netpolicy
from guildboard.achievements.catalog import (
    COMPARED, Catalog, CatalogError, Stage, bundled_date, bundled_raw, diff_catalogs, parse_catalog,
)
from guildboard.clock import Clock
from guildboard.store import Store, StoredList, iso

log = logging.getLogger(__name__)

# A new list keeps at least 90% of the installed list's stages, so that a broken or half download is refused
# (a builder's call). The preview names every stage a smaller list no longer has.
MIN_SHARE = 0.9
MAX_LIST_BYTES = 2_000_000


class UpdateError(Exception):
    """A list could not be checked, installed or gone back to. The message is fit to show to the player."""


def _download_failure(error: Exception) -> str:
    """The line the player is told when the download failed."""
    if isinstance(error, HTTPError) and error.code == 404:
        return "The achievement list was not found at its address. The installed list stays."
    if isinstance(error, netpolicy.ResponseTooLarge):
        return f"The downloaded list is larger than {MAX_LIST_BYTES // 1_000_000} MB. The installed list stays."
    if isinstance(error, netpolicy.HostNotAllowed):  # a redirect: the list is fetched from its one address only
        return (
            "The achievement list moved to another address, which Guild Board does not follow. "
            "The installed list stays."
        )
    return "The achievement list could not be downloaded. Check the connection and try again."


def _what_changed(before: Stage, after: Stage) -> list[str]:
    """The fields of COMPARED in which the stage differs, in that order."""
    return [field for field in COMPARED if getattr(before, field) != getattr(after, field)]


def _preview(old: Catalog, new: Catalog) -> dict[str, Any]:
    """What the new list adds, changes and no longer lists."""
    diff = diff_catalogs(old, new)
    categories = {category.key: category.name for category in new.categories}
    return {
        "added": [
            {"id": stage.id, "name": stage.name, "description": stage.description, "version": stage.version,
             "category": categories[stage.category]}
            for stage in diff.added
        ],
        "changed": [
            {"id": after.id, "name": after.name, "what": _what_changed(before, after)} for before, after in diff.changed
        ],
        "removed": [{"id": stage.id, "name": stage.name} for stage in diff.removed],
    }


class ListUpdates:
    def __init__(
        self,
        store: Store,
        clock: Clock,
        fetch: Callable[[], Awaitable[bytes]],
        *,
        bundled: Callable[[], bytes] = bundled_raw,
        source: str = "github",
    ) -> None:
        self._store = store
        self._clock = clock
        self._fetch = fetch
        self._bundled = bundled
        self._source = source  # where a list `fetch` gives comes from: "github", or "demo" for the demo's made-up one
        self._catalogs: dict[str, Catalog] = {}  # by SHA-256
        self._waiting: tuple[bytes, Catalog, str] | None = None  # what the last check found: raw, catalog, SHA-256

    @cached_property
    def _snapshot(self) -> tuple[bytes, str]:
        """The bundled list and its SHA-256."""
        raw = self._bundled()
        return raw, hashlib.sha256(raw).hexdigest()

    def _catalog(self, listed: StoredList | None) -> Catalog:
        """A stored list, or the bundled one for None. Each list is parsed once per SHA-256."""
        raw, sha256 = self._snapshot if listed is None else (listed.body, listed.sha256)
        if sha256 not in self._catalogs:
            self._catalogs[sha256] = parse_catalog(raw)
        return self._catalogs[sha256]

    def _sha256(self, listed: StoredList | None) -> str:
        """A stored list's SHA-256, or the bundled one's for None."""
        return self._snapshot[1] if listed is None else listed.sha256

    def current(self) -> Catalog:
        """The installed list, else the bundled one."""
        return self._catalog(self._store.achievement_list())

    def _summary(self, listed: StoredList | None) -> dict[str, Any]:
        catalog = self._catalog(listed)
        installed_at = None if listed is None else iso(listed.installed_at)
        return {"version": catalog.version, "stages": len(catalog.stages), "installed_at": installed_at}

    def meta(self) -> dict[str, Any]:
        """The installed list, and the previous one that undo() goes back to."""
        installed = self._store.achievement_list()
        previous = self._store.achievement_list("previous")
        source = "bundled" if installed is None else installed.source
        # The snapshot's date goes with the bundled list byte for byte. A stored copy of another snapshot, from before
        # Guild Board was updated, has no date, and an installed list's installed_at says when.
        as_shipped = source == "bundled" and self._sha256(installed) == self._snapshot[1]
        return {
            "source": source,
            **self._summary(installed),
            "dated": bundled_date() if as_shipped else None,
            "previous": None if previous is None else self._summary(previous),
        }

    async def _download(self) -> tuple[bytes, Catalog]:
        """The downloaded list, read and checked. A failure raises UpdateError with the line the player is told."""
        try:
            raw = await self._fetch()
            return raw, parse_catalog(raw)
        except CatalogError as error:
            raise UpdateError(f"The downloaded list is not usable. {error} The installed list stays.") from error
        except Exception as error:
            log.warning("the achievement list could not be downloaded (%s: %s)", type(error).__name__, error)
            raise UpdateError(_download_failure(error)) from error

    async def check(self) -> dict[str, Any]:
        """Download the list, check it and compare it with the installed one. Nothing changes until install().

        When a check ends, the list it found waits for install() in place of any earlier one. Nothing waits when the
        check failed or was refused, or found the installed list. Of two checks at once, the one that ends last
        decides."""
        found: tuple[bytes, Catalog, str] | None = None
        try:
            raw, new = await self._download()
            installed = self._store.achievement_list()
            old = self._catalog(installed)
            if len(new.stages) < MIN_SHARE * len(old.stages):
                raise UpdateError(
                    f"The downloaded list has {len(new.stages):,} achievements, far fewer than the "
                    f"{len(old.stages):,} installed. The installed list stays."
                )
            sha256 = hashlib.sha256(raw).hexdigest()
            up_to_date = sha256 == self._sha256(installed)
            preview = {"up_to_date": up_to_date, "sha256": sha256, "version": new.version, "stages": len(new.stages),
                       **_preview(old, new)}
            # The same list is not kept waiting: installing it would fill both slots and lose the previous list.
            if not up_to_date:
                found = (raw, new, sha256)
            return preview
        finally:
            self._waiting = found

    def install(self, sha256: str) -> dict[str, Any]:
        """Install the list the last check found. The installed one becomes the previous list, for undo()."""
        if self._waiting is None or self._waiting[2] != sha256:
            raise UpdateError("This list is no longer waiting. Check for new achievements again.")
        raw, catalog, _ = self._waiting
        now = self._clock.now()
        with self._store.transaction():
            if self._store.achievement_list() is None:  # the bundled list is stored first, so that undo() can go back
                bundled, bundled_sha256 = self._snapshot
                self._store.install_achievement_list(
                    bundled, source="bundled", sha256=bundled_sha256, version=self._catalog(None).version, at=now
                )
            self._store.install_achievement_list(
                raw, source=self._source, sha256=sha256, version=catalog.version, at=now
            )
        self._catalogs[sha256] = catalog
        self._waiting = None  # installed once: a second time would push the previous list out
        return self.meta()

    def undo(self) -> dict[str, Any]:
        """Go back to the previous list."""
        if not self._store.restore_previous_achievement_list():
            raise UpdateError("There is no earlier list to go back to.")
        self._waiting = None  # it was compared with the list that is gone now
        return self.meta()


def github_fetch() -> Callable[[], Awaitable[bytes]]:
    """The download from the list's one address, in a worker thread so that the core keeps answering meanwhile."""

    async def fetch() -> bytes:
        return await asyncio.to_thread(
            netpolicy.fetch_bytes, netpolicy.ACHIEVEMENT_LIST_URL, timeout=30.0, max_bytes=MAX_LIST_BYTES
        )

    return fetch


def demo_fetch(base: bytes) -> Callable[[], Awaitable[bytes]]:
    """The demo's download, which contacts nothing: `base` plus three made-up stages in its category with the lowest
    order."""

    async def fetch() -> bytes:
        data = json.loads(base)
        first = min(data.values(), key=lambda category: category["order"])
        first["achievements"].extend(
            {"id": 99900 + n, "name": f"Demo achievement {n}", "desc": "Made up for the demo.",
             "reward": 5, "ver": "7.2"}
            for n in (1, 2, 3)
        )
        return json.dumps(data).encode("utf-8")

    return fetch
