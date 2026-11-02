"""Backups of the player's data as one file: made on request, kept as a copy a day, and restored at the next start.

A backup file is a zip holding the database, the settings and a manifest. It never holds the HoYoLAB token, the logs or
the caches: the token is protected for this PC and user, so a copy of it would be of no use elsewhere.

A restore cannot replace the database of a running Guild Board, so it happens in two steps. `stage_restore` checks the
file and leaves it beside the data; `apply_pending` runs at the very start of the next start, before the database is
opened, and puts it in place.

What takes a while here (a copy of the database, a backup file's deflate, a restore's staging) can run in a worker
thread: the copies a worker makes read the database through a connection of their own, as the store's one connection is
used on the event loop's thread alone."""
from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import threading
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from guildboard import __version__
from guildboard.characters.art import sound_row
from guildboard.config import AppPaths, load_settings, save_settings, settings_from_dict
from guildboard.gamewatch import GAME_PROCESS_NAMES
from guildboard.store import MIGRATIONS, Store

log = logging.getLogger(__name__)

FORMAT = 1
SUFFIX = ".gbbackup"
PENDING = "restore-pending.gbbackup"
RESTORE_UNFINISHED = "restore-unfinished.flag"  # left when a staged restore could not be put in place yet
TRIAL_NAME = "restore-trial"  # the copy a restored database is opened on before it is put in place (and what goes with it)
DB_NAME, SETTINGS_NAME, MANIFEST_NAME = "guildboard.db", "settings.json", "manifest.json"
# What belongs to this PC rather than to the account: a restore keeps the current values of these.
PC_SETTINGS = (
    "start_with_windows", "overlay_display", "overlay_hotkey", "risk_acknowledged", "tray_hint_shown",
    "last_seen_version", "codes_login_done",
)
BACKUP_KIND = "live"  # the kind of folder (Store.claim) a backup's database belongs to: the real account's, never the demo's
NOT_A_BACKUP = "This file is not a Guild Board backup."
TOO_NEW = "This backup comes from a newer Guild Board. Update Guild Board, then restore it."
DEMO = "The demo has no data of yours to back up."
GAME_FOLDER = "A backup cannot be saved in the game's folders. Choose another folder."
TOO_LARGE = "This file is too large to be a Guild Board backup."
MAX_BACKUP_BYTES = 200 * 1024 * 1024  # the largest backup file a restore takes, as the Settings page's own check
# The most each part of a backup may hold, unpacked. A zip can unpack to far more than it holds, so each part's size is
# read from the zip's own list before any of it is. A player's database of years is a few hundred megabytes.
MAX_DATABASE_BYTES = 2 * 1024 * 1024 * 1024
MAX_SETTINGS_BYTES = 1_000_000
MAX_MANIFEST_BYTES = 64_000


class BackupRefused(Exception):
    """A file that cannot be restored, or a backup that cannot be made. The text is what the player reads."""


def _resolved(path: Path) -> Path:
    """Where a path is, as Windows names it: a link, a junction or a short name followed to the place itself."""
    try:
        return path.resolve()
    except OSError:  # a place that cannot be asked about is taken as it is written
        return Path(os.path.abspath(path))


def export_target(chosen: Path, game_folders: Iterable[Path]) -> Path:
    """The file the player chose to export a backup to, resolved, so that what is checked is where it is written; or
    BackupRefused when it lies in one of the game's folders: in one of `game_folders` (those Guild Board knows, with
    everything inside them), or in an install folder, which holds the game's program (named as its process is) whatever
    the folder is named; the game's data folder lies inside it.

    What is asked of Windows: the final path of the chosen place and of each of `game_folders`, as `Path.resolve` asks it,
    which opens a handle to the folder with no access rights; and, of each folder up from the file, only whether the
    program's name is there (`os.path.lexists`). Nothing of the game's is created, changed, deleted or read, and no folder
    is listed."""
    target = _resolved(chosen)
    known = {os.path.normcase(str(_resolved(folder))) for folder in game_folders}
    for folder in (target.parent, *target.parent.parents):
        if os.path.normcase(str(folder)) in known or any(
            os.path.lexists(folder / program) for program in GAME_PROCESS_NAMES
        ):
            raise BackupRefused(GAME_FOLDER)
    return target


def write_backup(source: Store | Path, settings_path: Path, target: Path, now: datetime) -> None:
    """Write the backup zip to `target`, in a folder that is there: none is made for it, as the place may be one the
    player chose. The database goes in as a copy made with SQLite's backup API, never as the live file, which may hold
    changes that are not in it yet: through the store's connection, on the caller's thread, when `source` is the store,
    else through a connection of the copy's own to the database at `source`, so that the whole of it can be written in a
    worker thread. The copy is made in the data folder, which is the only place Guild Board writes besides the file the
    player chose; its name is the thread's own, as two backups may be written at once."""
    scratch = settings_path.parent / f"backup-scratch-{threading.get_ident()}.db"
    scratch.unlink(missing_ok=True)
    partial = target.with_name(target.name + ".tmp")  # an earlier file of that name stays until this one is whole
    try:
        if isinstance(source, Store):
            source.copy_to(scratch)
        else:
            _copy_database(source, scratch)
        settings = json.dumps(load_settings(settings_path).to_dict(), indent=2)
        manifest = {
            "app": "Guild Board", "format": FORMAT, "version": __version__, "schema": len(MIGRATIONS),
            "made_at": now.astimezone(timezone.utc).isoformat(),
        }
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.write(scratch, DB_NAME)
            bundle.writestr(SETTINGS_NAME, settings)
            bundle.writestr(MANIFEST_NAME, json.dumps(manifest, indent=2))
        os.replace(partial, target)
    except BaseException:
        partial.unlink(missing_ok=True)  # a backup cut short is no backup
        raise
    finally:
        scratch.unlink(missing_ok=True)


def _part(bundle: zipfile.ZipFile, name: str) -> zipfile.ZipInfo:
    """A part of a backup file, when it is there and unpacks to no more than a backup's part of its name holds; else
    BackupRefused. Nothing of it is unpacked to learn that."""
    caps = {DB_NAME: MAX_DATABASE_BYTES, SETTINGS_NAME: MAX_SETTINGS_BYTES, MANIFEST_NAME: MAX_MANIFEST_BYTES}
    try:
        info = bundle.getinfo(name)
    except KeyError:
        raise BackupRefused(NOT_A_BACKUP) from None
    if info.file_size > caps[name]:
        raise BackupRefused(NOT_A_BACKUP)
    return info


def _json_object(bundle: zipfile.ZipFile, name: str) -> dict[str, Any]:
    """A part of a backup file that is a JSON object, or BackupRefused for anything else."""
    try:
        value = json.loads(bundle.read(_part(bundle, name)).decode("utf-8"))
    except BackupRefused:
        raise
    except Exception as error:  # not UTF-8, not JSON, nested deeper than Python reads, a part that is no deflate stream
        raise BackupRefused(NOT_A_BACKUP) from error
    if not isinstance(value, dict):
        raise BackupRefused(NOT_A_BACKUP)
    return value


def read_manifest(source: Path) -> dict[str, Any]:
    """The manifest of a backup file, or BackupRefused when it is not one of Guild Board's or is from a newer one. Every
    failure to read the file is a refusal: a file that fails in a way nobody foresaw is no backup either."""
    try:
        with zipfile.ZipFile(source) as bundle:
            for name in (DB_NAME, SETTINGS_NAME):
                _part(bundle, name)
            manifest = _json_object(bundle, MANIFEST_NAME)
    except BackupRefused:
        raise
    except Exception as error:
        raise BackupRefused(NOT_A_BACKUP) from error
    if manifest.get("app") != "Guild Board":
        raise BackupRefused(NOT_A_BACKUP)
    schema, format_ = manifest.get("schema"), manifest.get("format")
    if not all(isinstance(number, int) and not isinstance(number, bool) for number in (schema, format_)):
        raise BackupRefused(NOT_A_BACKUP)
    if schema > len(MIGRATIONS) or format_ > FORMAT:
        raise BackupRefused(TOO_NEW)
    return manifest


def _art_rows_sound(conn: sqlite3.Connection) -> bool:
    """Whether every row of the art table names what the art cache itself writes. Its rows point the cache at files to read
    and delete, so a database whose rows name any other file was not made by Guild Board. One from before the art cache
    has no such table."""
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'art'").fetchone() is None:
        return True
    return all(sound_row(key, file) for key, file in conn.execute("SELECT key, file FROM art"))


def _shape(conn: sqlite3.Connection) -> dict[str, frozenset[str]]:
    """The tables of a database, each with the names of its columns. SQLite's own tables (the counters of AUTOINCREMENT)
    are left out."""
    tables = [str(name) for (name,) in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_'"
    )]
    return {
        name: frozenset(str(column) for (column,) in conn.execute("SELECT name FROM pragma_table_info(?)", (name,)))
        for name in tables
    }


def _store_shape(schema: int) -> dict[str, frozenset[str]]:
    """The tables and columns a store of this schema has: what its migrations make, run on an empty database in memory."""
    with closing(sqlite3.connect(":memory:")) as conn:
        for script in MIGRATIONS[:schema]:
            conn.executescript(script)
        return _shape(conn)


def _is_a_store(conn: sqlite3.Connection, schema: int) -> bool:
    """Whether the database is one that a Guild Board of this schema made, as far as its tables tell: it has the tables and
    columns of its schema, no more and no fewer, it does not belong to the demo (nor to a kind of folder Guild Board does
    not write), and its art rows are sound. The start trusts the schema a database says it is at. It fails at `meta`, or in
    the upgrade, which alters tables, when one is gone, and in the upgrade, which creates tables, when the database has
    the tables of a later schema already."""
    shape = _shape(conn)
    if shape != _store_shape(schema):
        return False
    if "meta" in shape:
        row = conn.execute("SELECT value FROM meta WHERE key = 'kind'").fetchone()
        if row is not None and str(row[0]) != BACKUP_KIND:
            return False
    return _art_rows_sound(conn)


OTHER_ACCOUNT = (
    "This backup holds the history of another game account (UID {theirs}), and this Guild Board keeps the history of "
    "UID {ours}. To keep that history instead, close Guild Board, move guildboard.db out of its data folder, start Guild "
    "Board again and restore this backup."
)


def _account_in(conn: sqlite3.Connection) -> str | None:
    """The game account a database keeps the history of (`meta.account_uid`), when it names one. A database from before
    `meta` has no such table."""
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'account_uid'").fetchone()
    except sqlite3.Error:
        return None
    return str(row[0]) if row is not None and row[0] else None


def _folder_account(data_dir: Path) -> str | None:
    """The account this folder's database keeps the history of, read through a connection of its own that cannot write, so
    that it can be asked in a worker thread and before the store is opened. None when the folder has no database yet, or
    its database names none."""
    database = AppPaths(data_dir).db_path
    if not database.is_file():
        return None
    try:
        with closing(sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)) as conn:
            return _account_in(conn)
    except sqlite3.Error:
        return None


def _database_schema(path: Path, data_dir: Path | None = None) -> int:
    """The schema version of a database file, or BackupRefused when it is not a usable database of this Guild Board or a
    newer one: after an integrity check, a look at its tables and columns against those of its schema, at the kind of folder
    it belongs to and at its art rows (`_is_a_store`). A database of no schema holds nothing to restore. With `data_dir`, a
    database that keeps the history of another game account than the one that folder keeps is refused too: one history
    follows one game account, and the two would run together. Opened as immutable, which leaves no -wal or -shm file
    behind."""
    theirs: str | None = None
    try:
        with closing(sqlite3.connect(f"file:{path.as_posix()}?immutable=1", uri=True)) as conn:
            schema = int(conn.execute("PRAGMA user_version").fetchone()[0])
            ok = [str(row[0]) for row in conn.execute("PRAGMA quick_check")] == ["ok"]
            if ok and schema <= len(MIGRATIONS):  # a newer one is told so below: its tables are not known here
                ok = schema >= 1 and _is_a_store(conn, schema)
                theirs = _account_in(conn) if ok else None
    except sqlite3.Error as error:
        raise BackupRefused(NOT_A_BACKUP) from error
    if not ok:
        raise BackupRefused(NOT_A_BACKUP)
    if schema > len(MIGRATIONS):
        raise BackupRefused(TOO_NEW)
    ours = _folder_account(data_dir) if data_dir is not None else None
    if theirs is not None and ours is not None and theirs != ours:
        raise BackupRefused(OTHER_ACCOUNT.format(theirs=theirs, ours=ours))
    return schema


def _opens_as_a_start_opens_it(database: Path, data_dir: Path, now: datetime) -> None:
    """BackupRefused unless the store opens the database as a start opens it: its integrity checked, a write tried, its
    upgrade run, and the folder claimed for the real account. What `_database_schema` reads is the tables and the
    columns, and says nothing of what the upgrade meets in the rows. This is done on a copy, which is removed with the copy
    the store makes before it upgrades, whatever happens: the database stays as it was extracted, and the start upgrades it
    as it upgrades any older one."""
    trial, backups = data_dir / (TRIAL_NAME + ".db"), data_dir / (TRIAL_NAME + "-backups")
    try:
        shutil.copyfile(database, trial)
        store = Store.open(trial, backups, now)
        try:
            store.claim(BACKUP_KIND)
        finally:
            store.close()
    except Exception as error:  # a failure of the upgrade is neither a StoreError nor an OSError
        raise BackupRefused(NOT_A_BACKUP) from error
    finally:
        _forget(trial, Path(str(trial) + "-wal"), Path(str(trial) + "-shm"))
        shutil.rmtree(backups, ignore_errors=True)


def stage_restore(source: Path, data_dir: Path) -> None:
    """Check the file, its settings and the database inside it too, and leave it where the next start finds it. Nothing is
    changed when it is refused."""
    read_manifest(source)
    data_dir.mkdir(parents=True, exist_ok=True)
    check = data_dir / "restore-check.db"
    try:
        with zipfile.ZipFile(source) as bundle:
            _json_object(bundle, SETTINGS_NAME)  # the next start reads them before anything else
            with bundle.open(_part(bundle, DB_NAME)) as inner, open(check, "wb") as out:
                shutil.copyfileobj(inner, out)
        _database_schema(check, data_dir)
    except BackupRefused:
        raise
    except Exception as error:
        raise BackupRefused(NOT_A_BACKUP) from error
    finally:
        check.unlink(missing_ok=True)
    shutil.copyfile(source, data_dir / PENDING)


def stage_database(source: Path, settings_path: Path, data_dir: Path) -> None:
    """Stage one of the database copies in the backups folder as a restore: it is wrapped as a backup file that holds
    the settings as they are now, so that a restore of it changes the data and leaves the settings alone."""
    schema = _database_schema(source, data_dir)
    manifest = {"app": "Guild Board", "format": FORMAT, "version": __version__, "schema": schema, "made_at": ""}
    data_dir.mkdir(parents=True, exist_ok=True)
    pending = data_dir / PENDING
    partial = pending.with_name(pending.name + ".tmp")  # taken for the staged restore only when whole; an earlier one stays until then
    try:
        settings = json.dumps(load_settings(settings_path).to_dict(), indent=2)
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.write(source, DB_NAME)
            bundle.writestr(SETTINGS_NAME, settings)
            bundle.writestr(MANIFEST_NAME, json.dumps(manifest, indent=2))
        os.replace(partial, pending)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def apply_pending(paths: AppPaths, now: datetime) -> bool:
    """At the very start, before the database is opened: put a staged restore in place. What is there now is copied to
    the backups folder first. The restored settings are used, except this PC's own. True when a restore was applied.
    The scratch files a backup or a restore left when it was cut off are removed first (`sweep_scratch`).

    A file that cannot be used is dropped, whatever fails in it: a restore that failed in a way nobody foresaw must not
    stop every start. That includes a database the start could not open: the restored database is opened as a start
    opens it (on a copy) before it replaces anything, so what is dropped has taken nothing away. When the database
    cannot be replaced, which is most likely because the Guild Board that was running has not let go of it yet, the
    database is untouched: the restore stays staged for the next start, and RESTORE_UNFINISHED is left for the Settings
    page to tell of."""
    pending = paths.data_dir / PENDING
    unfinished = paths.data_dir / RESTORE_UNFINISHED
    sweep_scratch(paths.data_dir)
    if not pending.is_file():
        return False
    try:
        read_manifest(pending)
    except BackupRefused:
        log.warning("The staged restore was not a usable backup, so it was removed")
        _forget(pending, unfinished)
        return False
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    restored_db = paths.data_dir / "restore-incoming.db"
    try:
        with zipfile.ZipFile(pending) as bundle:
            restored_settings = _json_object(bundle, SETTINGS_NAME)
            with bundle.open(_part(bundle, DB_NAME)) as inner, open(restored_db, "wb") as out:
                shutil.copyfileobj(inner, out)
        _database_schema(restored_db, paths.data_dir)  # checked again as it is put in place: its tables and its art rows among it
        _opens_as_a_start_opens_it(restored_db, paths.data_dir, now)  # and met before it replaces anything, not at every start
        if paths.db_path.is_file():
            paths.backups_dir.mkdir(parents=True, exist_ok=True)
            _copy_whole(paths.db_path, paths.backups_dir / f"guildboard-before-restore-{stamp}.db")
    except Exception:
        log.exception("The staged restore could not be used, so it was removed")
        _forget(restored_db, pending, unfinished)
        return False
    try:
        for leftover in ("-wal", "-shm"):
            Path(str(paths.db_path) + leftover).unlink(missing_ok=True)
        os.replace(restored_db, paths.db_path)
    except OSError:
        log.exception("The database could not be replaced, so the restore will be tried at the next start")
        _forget(restored_db)
        try:
            unfinished.write_text("The restore could not finish.", encoding="utf-8")
        except OSError:
            log.warning("The unfinished restore could not be recorded", exc_info=True)
        return False
    try:
        merged = settings_from_dict(restored_settings)
        current = load_settings(paths.settings_path)
        for name in PC_SETTINGS:
            setattr(merged, name, getattr(current, name))
        save_settings(paths.settings_path, merged)
    except Exception:
        # The database is already restored and the one from before is kept, so the restore must not run again.
        log.exception("The restored settings could not be applied, so the settings stay as they were")
    _forget(pending, unfinished)
    return True


def database_copy(db_path: Path, backups_dir: Path, label: str, now: datetime) -> Path:
    """A copy of the database in the backups folder, named as the store names its own (Store.backup) and made the same
    way, but read through a connection of its own, so that it can be made in a worker thread. A copy cut short is
    removed: it is no backup."""
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = backups_dir / f"guildboard-{label}-{stamp}.db"
    _copy_whole(db_path, target)
    return target


def _forget(*files: Path) -> None:
    """Remove the restore's own files in the data folder. One that cannot be removed is logged, never raised: the start
    goes on."""
    for file in files:
        try:
            file.unlink(missing_ok=True)
        except OSError:
            log.warning("%s could not be removed", file.name, exc_info=True)


def sweep_scratch(data_dir: Path) -> None:
    """Remove the scratch files a backup or a restore left in the data folder when it was cut off by a crash or a power
    cut. A backup copies the database to `backup-scratch-<thread>.db` first, and the name is a thread's own, so no later
    backup would use it again; a restore is tried on a copy (`restore-trial.db`, and the copy a start makes before it
    upgrades, in `restore-trial-backups`), and a staging is written to `restore-pending.gbbackup.tmp`. Each is a copy of the whole database. One that cannot be removed is logged."""
    leftovers = [*data_dir.glob("backup-scratch-*.db"), *data_dir.glob(TRIAL_NAME + "*"), *data_dir.glob(PENDING + ".tmp")]
    for leftover in leftovers:
        if leftover.is_dir():
            shutil.rmtree(leftover, ignore_errors=True)
        else:
            _forget(leftover)


def _copy_whole(source: Path, target: Path) -> None:
    """A copy of a database that is at `target` only when it is whole: written under another name and renamed, so that a
    process that dies halfway leaves no file a restore would be offered. Removed when it fails, as the store's own are."""
    partial = target.with_name(target.name + ".tmp")
    partial.unlink(missing_ok=True)
    try:
        _copy_database(source, partial)
        os.replace(partial, target)
    except BaseException:
        for file in (partial, Path(str(partial) + "-wal"), Path(str(partial) + "-shm")):
            file.unlink(missing_ok=True)
        raise


def _copy_database(source: Path, target: Path) -> None:
    """A copy of a database file made with SQLite's backup API, which includes what its write-ahead log holds."""
    reader = sqlite3.connect(source)
    writer = sqlite3.connect(target)
    try:
        reader.backup(writer)
    finally:
        writer.close()
        reader.close()
