"""Bringing progress in from Paimon.moe: reading its export, planning the merge and applying it."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Mapping

from guildboard.achievements.catalog import Catalog
from guildboard.store import ProgressRow, Store, valid_text

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 30_000_000
TOO_LARGE = "The file is larger than 30 MB. No achievement save is that big."
NUMBER = re.compile(r"[0-9]{1,18}")  # an achievement id or a part number: digits only, and few enough for SQLite
NOT_AN_IMPORT = "This file is not a Paimon.moe export."
NO_PAIMON_ACHIEVEMENTS = "This file holds no Paimon.moe achievements. Export it from Paimon.moe: Settings, Export data."
BACKUP_FAILED = (
    "Guild Board could not back up its database before the import, so nothing was imported. See the log file."
)
SAVE_FAILED = "Guild Board could not save the import, so nothing was imported. See the log file."
OLD_LIGHT_UP_THE_DARK, LIGHT_UP_THE_DARK = 81219, 81222  # Paimon.moe reads the old id as the new one


class ImportFileError(ValueError):
    """A file could not be imported. The message is fit to show to the player."""


class ImportChanged(ImportFileError):
    """The file is not the one previewed."""


class ImportBackupFailed(Exception):
    """The database could not be backed up before an import, so nothing was imported. The message is fit to show to
    the player; the log has the reason."""


class ImportSaveFailed(Exception):
    """The import's writes could not be saved, and none of them was kept. The message is fit to show to the player;
    the log has the reason."""


@dataclass(frozen=True)
class Imported:
    status: str | None                 # "done", "in_progress", or None: the file says nothing
    pinned: bool = False
    note: str = ""
    parts: frozenset[int] = frozenset()


@dataclass(frozen=True)
class ImportSource:
    kind: str                          # "paimon"
    file: str                          # what to call the file on screen
    profile: str                       # "" is Paimon.moe's main profile
    profiles: tuple[str, ...]
    stages: Mapping[int, Imported]
    fingerprint: str                   # sha256(data + b"\n" + profile.encode()).hexdigest()


# ------------------------------------------------------------------ reading
def _load(data: bytes) -> Any:
    if len(data) > MAX_FILE_BYTES:
        raise ImportFileError(TOO_LARGE)
    try:
        return json.loads(data)  # UTF-8, with or without a byte order mark, or UTF-16 or UTF-32
    except (ValueError, RecursionError):  # not text, not JSON, or JSON nested too deep to read
        raise ImportFileError("The file is not valid JSON.") from None


def _fingerprint(data: bytes, profile: str) -> str:
    return hashlib.sha256(data + b"\n" + profile.encode("utf-8")).hexdigest()


def _numbered(value: Any) -> dict[int, Any]:
    """The entries of a JSON object whose keys are numbers. Anything that is not an object holds none."""
    if not isinstance(value, dict):
        return {}
    return {int(key): item for key, item in value.items() if NUMBER.fullmatch(key)}


def _ticked(value: Any) -> frozenset[int]:
    """The numbers in a JSON object whose value is true. Only true counts: "true", 1 and lists are not guessed."""
    return frozenset(number for number, flag in _numbered(value).items() if flag is True)


def read_file(data: bytes, file: str, profile: str | None = None) -> ImportSource:
    """Read a Paimon.moe export. A problem raises ImportFileError."""
    parsed = _load(data)
    if isinstance(parsed, dict):
        if "update-time" in parsed or any(key == "achievement" or key.endswith("-achievement") for key in parsed):
            return _paimon(parsed, data, file, profile)
    raise ImportFileError(NOT_AN_IMPORT)


def _key(profile: str) -> str:
    """Where Paimon.moe keeps a profile's achievements. Its checklist is under the same key with "-checklist" added."""
    return f"{profile}-achievement" if profile else "achievement"


def _profile(key: str) -> str | None:
    """The profile whose achievements a key of the export holds: "" for the main one, None for any other key."""
    if key == "achievement":
        return ""
    if key.endswith("-achievement") and key != "-achievement":
        return key.removesuffix("-achievement")
    return None


def read_paimon(data: bytes, file: str, profile: str | None = None) -> ImportSource:
    """Read one profile of a Paimon.moe export. None picks the first profile, in sorted order, that holds achievements:
    the main one, "", when it does.

    The old id 81219 is kept as it is: only plan_import, which has the list, can tell whether to read it as 81222.
    """
    return _paimon(_load(data), data, file, profile)


def _paimon(parsed: Any, data: bytes, file: str, profile: str | None) -> ImportSource:
    if not isinstance(parsed, dict):
        raise ImportFileError(NOT_AN_IMPORT)
    # Profile names come from the export's keys and reach the page. Half of an emoji in one becomes U+FFFD, in the keys
    # and in the name asked for alike, so that the page's name for a profile finds it.
    export = {valid_text(key): value for key, value in parsed.items()}
    if profile is not None:
        profile = valid_text(profile)
    held = {name: value for key, value in export.items() if (name := _profile(key)) is not None}
    # Paimon.moe writes null for a profile that has no achievements. `profiles` lists only the profiles that hold
    # achievements, so with profile=None a main profile whose achievements are null is passed over for the first
    # profile that holds some. Refusing a whole export because one profile is empty would not help the player.
    # A profile without achievements that is asked for by name gets the sentence below.
    profiles = tuple(sorted(name for name, value in held.items() if isinstance(value, dict)))
    if profile is None:
        if not profiles:
            raise ImportFileError(NO_PAIMON_ACHIEVEMENTS)
        profile = profiles[0]  # "" sorts first
    elif profile not in held:
        raise ImportFileError(
            "This Paimon.moe export has no main profile." if profile == ""
            else f"This Paimon.moe export has no profile named {profile}."
        )
    achievements = held[profile]
    if not isinstance(achievements, dict):
        raise ImportFileError(NO_PAIMON_ACHIEVEMENTS)
    done = {stage for category in achievements.values() for stage in _ticked(category)}
    checklist = _numbered(export.get(_key(profile) + "-checklist"))
    parts = {stage: ticked for stage, value in checklist.items() if (ticked := _ticked(value))}
    stages = {
        stage: Imported("done" if stage in done else None, parts=parts.get(stage, frozenset()))
        for stage in done | parts.keys()
    }
    return ImportSource("paimon", file, profile, profiles, stages, _fingerprint(data, profile))


# ------------------------------------------------------------------ merging
@dataclass(frozen=True)
class ImportPlan:
    source: ImportSource
    rows: tuple[ProgressRow, ...]
    parts: tuple[tuple[int, int], ...]      # (stage, part) to add
    done: int
    in_progress: int
    pins: int
    notes: int
    unknown: tuple[int, ...]
    conflicts: tuple[str, ...]

    @property
    def nothing_new(self) -> bool:
        return not self.rows and not self.parts

    def summary(self) -> dict[str, Any]:
        """What the preview shows and the import's record keeps, ready for JSON."""
        return {
            "kind": self.source.kind, "file": self.source.file, "profile": self.source.profile,
            "profiles": list(self.source.profiles), "fingerprint": self.source.fingerprint,
            "done": self.done, "in_progress": self.in_progress, "pins": self.pins, "notes": self.notes,
            "parts": len(self.parts), "unknown": list(self.unknown), "conflicts": list(self.conflicts),
            "nothing_new": self.nothing_new,
        }


def plan_import(
    source: ImportSource,
    catalog: Catalog,
    store: Store,
    now: datetime,
) -> ImportPlan:
    """What importing the file would change. Imports only add: done is never undone, and nothing is taken away.

    Achievements the list does not hold are merged the same way and kept, named in `unknown`, and not counted in
    `done` or `in_progress`.
    """
    # Both follow the import as it goes, so that 81219 and 81222, read as one stage, are not counted twice.
    rows = store.progress()
    held_parts = {stage: set(parts) for stage, parts in store.parts().items()}
    renamed = (
        source.kind == "paimon"
        and catalog.stage(OLD_LIGHT_UP_THE_DARK) is None and catalog.stage(LIGHT_UP_THE_DARK) is not None
    )
    written: dict[int, ProgressRow] = {}
    added: list[tuple[int, int]] = []
    done = in_progress = pins = noted = 0
    unknown: set[int] = set()
    conflicts: list[str] = []
    for stage_id, imported in sorted(source.stages.items()):
        if renamed and stage_id == OLD_LIGHT_UP_THE_DARK:
            stage_id = LIGHT_UP_THE_DARK
        stage = catalog.stage(stage_id)
        name = stage.name if stage is not None else f"Achievement {stage_id}"
        if stage is None:
            unknown.add(stage_id)
        old = rows.get(stage_id) or ProgressRow(stage_id, "not_started", None, False, "", source.kind, now)
        status, done_at, pinned, note = old.status, old.done_at, old.pinned, old.note
        if imported.status == "done" and status != "done":
            status, done_at = "done", now
            if stage is not None:
                done += 1
        elif imported.status == "in_progress" and status == "not_started":
            status = "in_progress"
            if stage is not None:
                in_progress += 1
        elif imported.status == "in_progress" and status == "done":
            conflicts.append(f"{name}: in progress in the file, done in Guild Board. It stays done.")
        if imported.pinned and not pinned:
            pinned = True
            pins += 1
        if imported.note and not note:
            note = imported.note
            noted += 1
        if (status, pinned, note) != (old.status, old.pinned, old.note):
            rows[stage_id] = written[stage_id] = replace(
                old, status=status, done_at=done_at, pinned=pinned, note=note, source=source.kind, updated_at=now
            )
        have = held_parts.setdefault(stage_id, set())
        # Parts map one to one with the list's checklist, Paimon.moe's numbering (spec 7.2). The parts Guild Board's notes
        # add come after it, and no file numbers them, so a listed stage takes only the list's parts. A stage the list
        # does not hold keeps every part: nothing can check them.
        if stage is None:
            fitting = set(imported.parts)
        else:
            fitting = {part for part in imported.parts if 0 <= part < len(stage.parts)}
        for part in sorted(fitting - have):
            have.add(part)
            added.append((stage_id, part))
    return ImportPlan(
        source, tuple(written.values()), tuple(added), done, in_progress, pins, noted,
        tuple(sorted(unknown)), tuple(conflicts),
    )


def apply_import(plan: ImportPlan, store: Store, now: datetime) -> dict[str, Any]:
    """Write what the plan adds and record the import. Before anything changes, the database is backed up: when the
    backup fails, nothing is written and ImportBackupFailed says so. The writes are kept all together or not at all:
    when they cannot be saved, ImportSaveFailed says so."""
    summary = plan.summary()
    source = plan.source
    if plan.nothing_new:
        store.add_import(source.kind, source.file, source.fingerprint, summary, now)
        return summary
    try:
        store.backup_before("auto-import", now)
    except (OSError, sqlite3.Error) as error:
        log.exception("the database could not be backed up before an import, so nothing was imported")
        raise ImportBackupFailed(BACKUP_FAILED) from error
    try:
        with store.transaction():
            store.put_progress(plan.rows)
            for stage_id, part in plan.parts:
                store.put_part(stage_id, part, now)
            store.clear_changes()  # an undo must not reach back past rows the import wrote
            store.add_import(source.kind, source.file, source.fingerprint, summary, now)
    except (OSError, sqlite3.Error) as error:
        log.exception("the import could not be saved, so nothing was imported")
        raise ImportSaveFailed(SAVE_FAILED) from error
    return summary
