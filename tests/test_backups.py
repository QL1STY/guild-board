import _winapi
import asyncio
import base64
import json
import os
import sqlite3
import zipfile
from contextlib import closing
from datetime import datetime, timedelta, timezone

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import guildboard.backups as backups_module
from guildboard.api.app import create_app
from guildboard.backups import (
    PENDING, RESTORE_UNFINISHED, BackupRefused, apply_pending, read_manifest, stage_database, stage_restore,
    write_backup,
)
from guildboard.core import Core
from guildboard.config import AppPaths, Settings, load_settings, save_settings
from guildboard.store import MIGRATIONS, ArtRow, Store
from support import AccountSource, FakeSleep

NOW = datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc)
TOKEN = b"SECRET-TOKEN-BYTES-1234567890"


def _open(tmp_path, when=NOW):
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    return paths, Store.open(paths.db_path, paths.backups_dir, when)


def _note(store: Store, value: str) -> None:
    store.set_meta("note", value)


def test_a_backup_holds_the_database_and_settings_and_never_the_token(tmp_path):
    paths, store = _open(tmp_path)
    paths.token_path.write_bytes(TOKEN)
    save_settings(paths.settings_path, Settings())
    target = tmp_path / "out" / "x.gbbackup"
    target.parent.mkdir()
    write_backup(store, paths.settings_path, target, NOW)
    with zipfile.ZipFile(target) as bundle:
        assert set(bundle.namelist()) == {"guildboard.db", "settings.json", "manifest.json"}
        manifest = json.loads(bundle.read("manifest.json"))
    assert TOKEN not in target.read_bytes()
    assert manifest["schema"] == len(MIGRATIONS) and manifest["format"] == 1 and manifest["app"] == "Guild Board"
    assert not list(paths.data_dir.glob("backup-scratch*"))
    store.close()


def test_a_foreign_or_newer_file_is_refused_and_changes_nothing(tmp_path):
    paths, store = _open(tmp_path)
    _note(store, "mine")
    store.close()
    before = paths.db_path.read_bytes()
    text = tmp_path / "text.gbbackup"
    text.write_text("hello")
    bare = tmp_path / "bare.gbbackup"
    with zipfile.ZipFile(bare, "w") as bundle:
        bundle.writestr("guildboard.db", b"x")
    newer = tmp_path / "newer.gbbackup"
    with zipfile.ZipFile(newer, "w") as bundle:
        bundle.writestr("guildboard.db", b"x")
        bundle.writestr("settings.json", "{}")
        bundle.writestr("manifest.json", json.dumps(
            {"app": "Guild Board", "format": 1, "schema": len(MIGRATIONS) + 1, "version": "9", "made_at": ""}
        ))
    for source in (text, bare):
        with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
            stage_restore(source, paths.data_dir)
    with pytest.raises(BackupRefused, match="comes from a newer Guild Board. Update Guild Board, then restore it."):
        stage_restore(newer, paths.data_dir)
    assert not (paths.data_dir / PENDING).exists()
    assert paths.db_path.read_bytes() == before
    with pytest.raises(BackupRefused):
        read_manifest(text)


def test_a_pending_restore_is_applied_at_the_next_start(tmp_path):
    paths, store = _open(tmp_path)
    _note(store, "exported")
    target = tmp_path / "x.gbbackup"
    write_backup(store, paths.settings_path, target, NOW)
    _note(store, "changed")
    store.close()
    stage_restore(target, paths.data_dir)
    assert apply_pending(paths, NOW + timedelta(hours=1)) is True
    again = Store.open(paths.db_path, paths.backups_dir, NOW)
    assert again.meta("note") == "exported"
    again.close()
    assert list(paths.backups_dir.glob("guildboard-before-restore-*.db"))
    assert not (paths.data_dir / PENDING).exists()
    assert apply_pending(paths, NOW) is False


def test_a_restore_keeps_this_pcs_settings(tmp_path):
    paths, store = _open(tmp_path)
    save_settings(paths.settings_path, Settings(overlay_display="B", notifications=False))
    target = tmp_path / "x.gbbackup"
    write_backup(store, paths.settings_path, target, NOW)
    store.close()
    save_settings(paths.settings_path, Settings(overlay_display="A", notifications=True))
    stage_restore(target, paths.data_dir)
    assert apply_pending(paths, NOW) is True
    restored = load_settings(paths.settings_path)
    assert restored.overlay_display == "A"
    assert restored.notifications is False


def test_one_daily_backup_a_day_and_fourteen_kept(tmp_path):
    paths, store = _open(tmp_path)
    autos_before = sorted(p.name for p in paths.backups_dir.glob("guildboard-auto-*.db"))
    store.backup("auto-import", NOW)
    autos = sorted(p.name for p in paths.backups_dir.glob("guildboard-auto-*.db"))
    assert autos != autos_before
    for day in range(20):
        assert store.daily_backup(NOW + timedelta(days=day)) is not None
    assert store.daily_backup(NOW + timedelta(days=19, hours=5)) is None
    assert len(list(paths.backups_dir.glob("guildboard-daily-*.db"))) == 14
    assert sorted(p.name for p in paths.backups_dir.glob("guildboard-auto-*.db")) == autos
    store.close()


def test_a_listed_database_copy_is_restored_with_the_current_settings(tmp_path):
    paths, store = _open(tmp_path)
    _note(store, "then")
    copy = store.backup("manual", NOW)
    _note(store, "now")
    store.close()
    save_settings(paths.settings_path, Settings(overlay_display="A", notifications=False))
    stage_database(copy, paths.settings_path, paths.data_dir)
    assert not list(paths.backups_dir.glob("*-wal")) and not list(paths.backups_dir.glob("*-shm"))
    assert apply_pending(paths, NOW + timedelta(hours=1)) is True
    again = Store.open(paths.db_path, paths.backups_dir, NOW)
    assert again.meta("note") == "then"
    again.close()
    assert load_settings(paths.settings_path).notifications is False  # the settings are as they were


def test_a_broken_database_inside_a_backup_is_refused_before_it_is_staged(tmp_path):
    paths, store = _open(tmp_path)
    store.close()
    broken = tmp_path / "broken.gbbackup"
    with zipfile.ZipFile(broken, "w") as bundle:
        bundle.writestr("guildboard.db", b"this is not a database" * 100)
        bundle.writestr("settings.json", "{}")
        bundle.writestr("manifest.json", json.dumps(
            {"app": "Guild Board", "format": 1, "schema": 1, "version": "1", "made_at": ""}
        ))
    with pytest.raises(BackupRefused, match="not a Guild Board backup"):
        stage_restore(broken, paths.data_dir)
    assert not (paths.data_dir / PENDING).exists()
    assert not (paths.data_dir / "restore-check.db").exists()


def test_a_backup_whose_art_rows_name_other_files_is_refused(tmp_path):
    # The art cache names every picture it keeps after its key alone, in its own folder. A backup whose art table names
    # any other file was not made by Guild Board, and its rows would point the cache at files elsewhere on this PC.
    paths, store = _open(tmp_path)
    key, other = "0123456789abcdef" * 2, "fedcba9876543210" * 2
    store.put_art(ArtRow(key, "https://act-webstatic.hoyoverse.com/a.png", key + ".png", 10, NOW))
    store.put_art(ArtRow(other, "https://act-webstatic.hoyoverse.com/b.png", "", 0, NOW))  # an address, not fetched yet
    sound = tmp_path / "sound.gbbackup"
    write_backup(store, paths.settings_path, sound, NOW)
    stage_restore(sound, paths.data_dir)  # the cache's own rows are what a backup holds
    (paths.data_dir / PENDING).unlink()
    for file in ("..\\..\\x.png", str(tmp_path / "x.png"), other + ".png"):
        store.put_art(ArtRow(key, "https://act-webstatic.hoyoverse.com/a.png", file, 10, NOW))
        target = tmp_path / "x.gbbackup"
        write_backup(store, paths.settings_path, target, NOW)
        copy = store.backup("manual", NOW)
        with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
            stage_restore(target, paths.data_dir)
        with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
            stage_database(copy, paths.settings_path, paths.data_dir)
        assert not (paths.data_dir / PENDING).exists()
    store.close()


def test_a_restore_that_cannot_replace_the_database_stays_staged_for_the_next_start(tmp_path, monkeypatch):
    paths, store = _open(tmp_path)
    _note(store, "exported")
    target = tmp_path / "x.gbbackup"
    write_backup(store, paths.settings_path, target, NOW)
    _note(store, "changed")
    store.close()
    stage_restore(target, paths.data_dir)
    real = os.replace

    def held(source, destination):
        if Path(destination) == paths.db_path:
            raise PermissionError("held by another process")
        return real(source, destination)

    monkeypatch.setattr(backups_module.os, "replace", held)
    assert apply_pending(paths, NOW) is False
    assert (paths.data_dir / PENDING).exists()
    assert (paths.data_dir / RESTORE_UNFINISHED).exists()
    assert not (paths.data_dir / "restore-incoming.db").exists()
    monkeypatch.undo()
    assert apply_pending(paths, NOW) is True
    assert not (paths.data_dir / RESTORE_UNFINISHED).exists()
    again = Store.open(paths.db_path, paths.backups_dir, NOW)
    assert again.meta("note") == "exported"
    again.close()


def test_writing_a_backup_over_an_earlier_file_keeps_it_until_the_new_one_is_whole(tmp_path):
    paths, store = _open(tmp_path)
    target = tmp_path / "x.gbbackup"
    target.write_text("earlier")
    store.close()  # a closed store makes the copy fail
    with pytest.raises(Exception):
        write_backup(store, paths.settings_path, target, NOW)
    assert target.read_text() == "earlier"
    assert not list(tmp_path.glob("*.tmp"))


@pytest.fixture
def live(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())
    with TestClient(create_app(core, 4321), base_url="http://127.0.0.1:4321") as client:
        client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        yield core, client
    core.store.close()


def test_a_live_core_restores_a_listed_copy_by_name(live):
    core, client = live
    name = client.post("/api/backup").json()["file"]
    answer = client.post("/api/backup/restore", json={"name": name})
    assert answer.status_code == 200 and answer.json() == {"restarting": False}  # no shell here
    assert (core.paths.data_dir / PENDING).is_file()
    assert client.post("/api/backup/restore", json={"name": "guildboard-nothing-20260101-000000.db"}).status_code == 422


def test_a_live_core_restores_an_uploaded_file_and_refuses_a_foreign_one(live, tmp_path):
    core, client = live
    assert client.post("/api/backup/export").status_code == 409  # no window to ask
    target = tmp_path / "up.gbbackup"
    asyncio.run(core.export_backup(target))
    raw = {"Content-Type": "application/octet-stream"}
    assert client.post("/api/backup/restore", content=target.read_bytes(), headers=raw).json() == {"restarting": False}
    (core.paths.data_dir / PENDING).unlink()
    refused = client.post("/api/backup/restore", content=b"hello", headers=raw)
    assert refused.status_code == 422 and refused.json()["error"] == "This file is not a Guild Board backup."
    assert not (core.paths.data_dir / PENDING).exists()
    assert not (core.paths.data_dir / "restore-upload.tmp").exists()
    assert client.get("/api/status").json()["restore_unfinished"] is False


def test_a_live_core_restores_a_file_sent_as_its_own_bytes(live, tmp_path, monkeypatch):
    # The page sends the file itself as the body, its name in the query, and the core writes it to the data folder as it
    # arrives: a file of 150 MB is no longer held four times over as text. A file in JSON, in base64, is no longer taken.
    import guildboard.api.app as app_module

    core, client = live
    target = tmp_path / "up.gbbackup"
    asyncio.run(core.export_backup(target))
    raw = {"Content-Type": "application/octet-stream"}
    sent = client.post("/api/backup/restore", params={"file_name": "up.gbbackup"}, content=target.read_bytes(), headers=raw)
    assert (sent.status_code, sent.json()) == (200, {"restarting": False})
    assert (core.paths.data_dir / PENDING).read_bytes() == target.read_bytes()
    (core.paths.data_dir / PENDING).unlink()
    foreign = client.post("/api/backup/restore", params={"file_name": "x.gbbackup"}, content=b"hello", headers=raw)
    assert (foreign.status_code, foreign.json()) == (422, {"error": "This file is not a Guild Board backup."})
    # The file's name in the query is not read: a file is judged by what it holds, so a backup that was renamed, or sent
    # with no name, is restored as well.
    for query in ({}, {"file_name": "renamed.zip"}):
        nameless = client.post("/api/backup/restore", params=query, content=target.read_bytes(), headers=raw)
        assert (nameless.status_code, nameless.json()) == (200, {"restarting": False})
        assert (core.paths.data_dir / PENDING).read_bytes() == target.read_bytes()
        (core.paths.data_dir / PENDING).unlink()
    too_large = {"error": "This file is too large to be a Guild Board backup."}
    monkeypatch.setattr(app_module, "MAX_BACKUP_BYTES", target.stat().st_size - 1)
    larger = client.post("/api/backup/restore", params={"file_name": "up.gbbackup"}, content=target.read_bytes(), headers=raw)
    assert (larger.status_code, larger.json()) == (413, too_large)

    def pieces():  # with no length given, the upload is cut off as it arrives, and its file goes
        whole = target.read_bytes()
        yield whole[: len(whole) // 2]
        yield whole[len(whole) // 2:]

    streamed = client.post("/api/backup/restore", params={"file_name": "up.gbbackup"}, content=pieces(), headers=raw)
    assert (streamed.status_code, streamed.json()) == (413, too_large)
    as_text = {"file": base64.b64encode(target.read_bytes()).decode(), "file_name": "up.gbbackup"}
    in_json = client.post("/api/backup/restore", json=as_text)
    assert (in_json.status_code, in_json.json()) == (422, {"error": "This request does not have the expected shape."})
    # A JSON body is a listed copy's name: it is bound as any other request is.
    huge = client.post("/api/backup/restore", json={"name": "x" * 1_100_000})
    assert (huge.status_code, huge.json()) == (413, {"error": "This request is too large."})
    assert not (core.paths.data_dir / PENDING).exists()
    assert not (core.paths.data_dir / "restore-upload.tmp").exists()


def test_the_body_limit_and_the_restore_read_the_content_type_alike(live, tmp_path, monkeypatch):
    # A request that names its type twice is read the first time by the route, so the bound that applies to it is the
    # bound of the form the route reads, not of the one a second header names.
    import guildboard.api.app as app_module

    core, client = live
    target = tmp_path / "up.gbbackup"
    asyncio.run(core.export_backup(target))
    data = target.read_bytes()
    monkeypatch.setattr(app_module, "MAX_BACKUP_BYTES", len(data) - 1)  # the file's own bytes are over their bound, as JSON they are not
    raw, as_json = ("content-type", "application/octet-stream"), ("content-type", "application/json")
    first_raw = client.post("/api/backup/restore", content=data, headers=[raw, as_json])
    assert (first_raw.status_code, first_raw.json()) == (413, {"error": "This file is too large to be a Guild Board backup."})
    first_json = client.post("/api/backup/restore", content=data, headers=[as_json, raw])
    assert (first_json.status_code, first_json.json()) == (422, {"error": "This request does not have the expected shape."})
    assert not (core.paths.data_dir / PENDING).exists()


def test_a_backup_file_of_64_mib_is_taken_as_its_own_bytes(live, monkeypatch):
    # The page sends a file of up to 64 MiB as the body itself. It reaches the staging, which finds it is no backup and
    # says so in the page's words; the bound is not met. One byte more than the bound is refused as JSON the page can
    # show, not as a bare error page.
    import guildboard.api.app as app_module

    core, client = live
    assert app_module.MAX_BACKUP_BYTES >= 64 * 1024 * 1024
    body, raw = bytes(64 * 1024 * 1024), {"Content-Type": "application/octet-stream"}
    answer = client.post("/api/backup/restore", params={"file_name": "big.gbbackup"}, content=body, headers=raw)
    assert (answer.status_code, answer.json()) == (422, {"error": "This file is not a Guild Board backup."})
    assert not (core.paths.data_dir / "restore-upload.tmp").exists()
    monkeypatch.setattr(app_module, "MAX_BACKUP_BYTES", len(body) - 1)
    over = client.post("/api/backup/restore", params={"file_name": "big.gbbackup"}, content=body, headers=raw)
    assert (over.status_code, over.headers["content-type"], over.json()) == (
        413, "application/json", {"error": "This file is too large to be a Guild Board backup."},
    )


async def test_export_refuses_a_target_in_the_game_folder(tmp_path, clock):
    # Nothing is ever written in the game's folders, whatever the Save dialog was pointed at: any folder that holds the
    # game's program, whatever its name, with every folder inside it (its data folder among them), the folder of the game's
    # log, and the ScreenShot folder the gallery has (found or pasted), by the place it is and not by how it was written
    # (here a junction to it). The folder beside a ScreenShot folder is not named the game's by that: it could be a drive.
    # Of a folder, only whether the program's name is there is asked.
    known = tmp_path / "Games" / "Genshin"
    (known / "ScreenShot").mkdir(parents=True)
    (tmp_path / "Shortcut").mkdir()
    _winapi.CreateJunction(str(known / "ScreenShot"), str(tmp_path / "Shortcut" / "ScreenShot"))
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    save_settings(paths.settings_path, Settings(gallery_folder=str(tmp_path / "Shortcut" / "ScreenShot")))
    installs = {
        tmp_path / "HoYoPlay" / "games" / "Genshin Impact game": ("GenshinImpact.exe", "GenshinImpact_Data"),
        tmp_path / "D" / "Genshin": ("GenshinImpact.exe", "GenshinImpact_Data"),
        tmp_path / "Other" / "YuanShen": ("YuanShen.exe", "YuanShen_Data"),
    }
    for install, (program, data) in installs.items():
        (install / data).mkdir(parents=True)
        (install / program).write_bytes(b"made up")
    log_folder = tmp_path / "Profile" / "AppData" / "LocalLow" / "miHoYo" / "Genshin Impact"
    log_folder.mkdir(parents=True)
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    refused = [
        known / "ScreenShot" / "x.gbbackup", tmp_path / "Shortcut" / "ScreenShot" / "x.gbbackup",
        tmp_path / "Elsewhere" / ".." / "Games" / "Genshin" / "ScreenShot" / "x.gbbackup", log_folder / "x.gbbackup",
        *(install / "x.gbbackup" for install in installs), *(install / data / "x.gbbackup" for install, (_, data) in installs.items()),
    ]
    try:
        for target in refused:
            with pytest.raises(BackupRefused, match="A backup cannot be saved in the game's folders. Choose another folder."):
                await core.export_backup(target)
        assert not [path for path in tmp_path.rglob("x.gbbackup*")]  # nothing was written, not even for a moment
        # No folder is made for a place the player chose: one that is not there is not made.
        with pytest.raises(OSError):
            await core.export_backup(tmp_path / "Nowhere" / "x.gbbackup")
        assert not (tmp_path / "Nowhere").exists()
        beside = (tmp_path / "Documents", tmp_path / "HoYoPlay" / "games", known, tmp_path / "Shortcut")
        for allowed in beside:  # beside an install folder, or beside a ScreenShot folder that was pasted, is not in it
            allowed.mkdir(exist_ok=True)
            assert await core.export_backup(allowed / "x.gbbackup") == "x.gbbackup"
            assert read_manifest(allowed / "x.gbbackup")["app"] == "Guild Board"
    finally:
        core.store.close()


def test_an_unusable_staged_restore_is_dropped_with_its_unfinished_flag(tmp_path):
    paths, store = _open(tmp_path)
    store.close()
    for content in (b"not a zip", None):
        (paths.data_dir / PENDING).write_bytes(content or b"")
        if content is None:  # a real zip whose database is cut short, so reading it fails after the manifest passes
            target = tmp_path / "x.gbbackup"
            _, other = _open(tmp_path / "other")
            write_backup(other, paths.settings_path, target, NOW)
            other.close()
            with zipfile.ZipFile(target) as src, zipfile.ZipFile(paths.data_dir / PENDING, "w") as out:
                out.writestr("manifest.json", src.read("manifest.json"))
                out.writestr("guildboard.db", b"x")  # settings.json missing: KeyError
        (paths.data_dir / RESTORE_UNFINISHED).write_text("x", encoding="utf-8")
        assert apply_pending(paths, NOW) is False
        assert not (paths.data_dir / PENDING).exists()
        assert not (paths.data_dir / RESTORE_UNFINISHED).exists()


DEEP = "[" * 100_000 + "]" * 100_000  # JSON nested deeper than Python reads: json.loads raises RecursionError


def _rebuilt(source: Path, target: Path, **parts: bytes | str) -> Path:
    """A copy of the backup file `source` with some of its parts replaced, by name."""
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out:
        for name in original.namelist():
            out.writestr(name, parts.get(name.replace(".", "_"), original.read(name)))
    return target


def _broken_deflate(source: Path, target: Path, name: str) -> Path:
    """A copy of the backup file `source` whose part `name` is no deflate stream any more: its first byte says a kind of
    block that does not exist, which zlib refuses (zlib.error, which is neither an OSError nor a BadZipFile)."""
    data = bytearray(source.read_bytes())
    with zipfile.ZipFile(source) as bundle:
        info = bundle.getinfo(name)
    start = info.header_offset + 30 + int.from_bytes(data[info.header_offset + 26:info.header_offset + 28], "little")
    start += int.from_bytes(data[info.header_offset + 28:info.header_offset + 30], "little")
    data[start] = 0xFF
    target.write_bytes(bytes(data))
    return target


def test_apply_pending_drops_a_file_it_cannot_parse(tmp_path):
    # A staged restore that fails to read in a way nobody listed must not stop every start: it is dropped, with its
    # unfinished flag, and the start goes on with the data as it was.
    paths, store = _open(tmp_path)
    _note(store, "mine")
    good = tmp_path / "good.gbbackup"
    write_backup(store, paths.settings_path, good, NOW)
    store.close()
    broken = [
        _rebuilt(good, tmp_path / "deep-settings.gbbackup", settings_json=DEEP),
        _rebuilt(good, tmp_path / "deep-manifest.gbbackup", manifest_json=DEEP),
        _broken_deflate(good, tmp_path / "broken-database.gbbackup", "guildboard.db"),
    ]
    for file in broken:
        (paths.data_dir / PENDING).write_bytes(file.read_bytes())
        (paths.data_dir / RESTORE_UNFINISHED).write_text("x", encoding="utf-8")
        assert apply_pending(paths, NOW) is False, file.name
        assert not (paths.data_dir / PENDING).exists() and not (paths.data_dir / RESTORE_UNFINISHED).exists()
        assert not (paths.data_dir / "restore-incoming.db").exists()
    again = Store.open(paths.db_path, paths.backups_dir, NOW)
    assert again.meta("note") == "mine"
    again.close()


def test_stage_restore_refuses_unreadable_settings(tmp_path):
    # The next start reads the settings of a staged restore before anything else, so the restore is refused when they
    # cannot be read: nested too deep, not JSON, or not a JSON object.
    paths, store = _open(tmp_path)
    good = tmp_path / "good.gbbackup"
    write_backup(store, paths.settings_path, good, NOW)
    store.close()
    for number, settings in enumerate((DEEP, "{", "[]", b"\xff\xfe")):
        file = _rebuilt(good, tmp_path / f"settings-{number}.gbbackup", settings_json=settings)
        with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
            stage_restore(file, paths.data_dir)
        assert not (paths.data_dir / PENDING).exists()
    for number, manifest in enumerate((DEEP, b"\xff\xfe")):
        with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
            read_manifest(_rebuilt(good, tmp_path / f"manifest-{number}.gbbackup", manifest_json=manifest))
    with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
        stage_restore(_broken_deflate(good, tmp_path / "broken.gbbackup", "guildboard.db"), paths.data_dir)
    assert not (paths.data_dir / "restore-check.db").exists()
    stage_restore(good, paths.data_dir)  # the backup itself is fine
    assert (paths.data_dir / PENDING).is_file()


def test_a_part_larger_than_its_cap_is_refused_before_it_is_unpacked(tmp_path, monkeypatch):
    # A zip can unpack to far more than it holds. Each part's size is read from the zip's own list first, and a part
    # larger than any backup of Guild Board's holds is never unpacked.
    paths, store = _open(tmp_path)
    good = tmp_path / "good.gbbackup"
    write_backup(store, paths.settings_path, good, NOW)
    store.close()
    with zipfile.ZipFile(good) as bundle:
        sizes = {info.filename: info.file_size for info in bundle.infolist()}
    unpacked: list[str] = []
    real_open = zipfile.ZipFile.open
    monkeypatch.setattr(zipfile.ZipFile, "open", lambda self, name, *a, **k: unpacked.append(str(name)) or real_open(
        self, name, *a, **k))
    for cap, name in (("MAX_DATABASE_BYTES", "guildboard.db"), ("MAX_SETTINGS_BYTES", "settings.json"),
                      ("MAX_MANIFEST_BYTES", "manifest.json")):
        with monkeypatch.context() as small:
            small.setattr(backups_module, cap, sizes[name] - 1)
            unpacked.clear()
            with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
                stage_restore(good, paths.data_dir)
            assert not any(name in opened for opened in unpacked), cap
            (paths.data_dir / PENDING).write_bytes(good.read_bytes())
            assert apply_pending(paths, NOW) is False and not (paths.data_dir / PENDING).exists()
    assert not (paths.data_dir / "restore-check.db").exists()


def test_a_failure_after_the_database_is_replaced_still_removes_the_staged_restore(tmp_path, monkeypatch):
    paths, store = _open(tmp_path)
    _note(store, "exported")
    target = tmp_path / "x.gbbackup"
    write_backup(store, paths.settings_path, target, NOW)
    _note(store, "changed")
    store.close()
    stage_restore(target, paths.data_dir)
    (paths.data_dir / RESTORE_UNFINISHED).write_text("x", encoding="utf-8")

    def broken(path, settings):
        raise OSError("disk full")

    monkeypatch.setattr(backups_module, "save_settings", broken)
    assert apply_pending(paths, NOW) is True
    assert not (paths.data_dir / PENDING).exists()
    assert not (paths.data_dir / RESTORE_UNFINISHED).exists()
    again = Store.open(paths.db_path, paths.backups_dir, NOW)
    assert again.meta("note") == "exported"
    again.close()


# ------------------------------------------------------------------------------------------ a database to start on
def _empty_database(path: Path, schema: int) -> None:
    """A database file SQLite finds whole, with no table in it, at a schema."""
    with closing(sqlite3.connect(path)) as conn:
        conn.execute(f"PRAGMA user_version = {schema}")


def _database_of_kind(path: Path, kind: str) -> None:
    """A database of today's schema that belongs to a kind of folder. Guild Board writes "live" and "demo" and no other."""
    store = Store.open(path, path.parent / "made-up-backups", NOW)
    store.set_meta("kind", kind)
    store.close()


def _database_that_says_it_is_older(path: Path) -> None:
    """A database with the tables of today's schema that says it is at the schema before the one that makes the endgame's
    cycles' table: the upgrade then makes a table it has. (The last upgrade makes the wiki's table again under another name
    first, which would run twice without a failure.)"""
    _database_of_kind(path, "live")
    makes = next(number for number, script in enumerate(MIGRATIONS) if "CREATE TABLE endgame_cycles" in script)
    with closing(sqlite3.connect(path)) as conn:
        conn.execute(f"PRAGMA user_version = {makes}")


# Each passes SQLite's own check and holds nothing a Guild Board starts on: the first two have no tables (the start then
# fails at `meta`, or in the upgrade, which alters tables that are not there), the next two belong to a kind of folder
# that a real account's cannot (the start refuses the demo's, and meets a kind it has no sentence for), the fifth is a
# backup of nothing, and the last has more tables than its schema has (the upgrade fails making them).
NO_STORE = {
    "empty at the schema of today": lambda path: _empty_database(path, len(MIGRATIONS)),
    "empty at an older schema": lambda path: _empty_database(path, 5),
    "the demo": lambda path: _database_of_kind(path, "demo"),
    "of a kind nobody writes": lambda path: _database_of_kind(path, "something else"),
    "of no schema at all": lambda path: _empty_database(path, 0),
    "with the tables of a later schema": _database_that_says_it_is_older,
}


def _backup_of(database: Path, paths: AppPaths, tmp_path: Path) -> Path:
    target = tmp_path / "made.gbbackup"
    write_backup(database, paths.settings_path, target, NOW)
    return target


@pytest.mark.parametrize("made", NO_STORE)
def test_a_database_no_guild_board_starts_on_is_refused_before_it_is_staged(tmp_path, made):
    # A restore that is staged is put in place at the next start, and a database that start cannot open stops every start
    # after it. The restore is refused when it is chosen, from a backup file and from one of the copies, and nothing of it
    # is left.
    paths, store = _open(tmp_path)
    _note(store, "mine")
    store.close()
    database = tmp_path / "made.db"
    NO_STORE[made](database)
    backup = _backup_of(database, paths, tmp_path)
    with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
        stage_restore(backup, paths.data_dir)
    with pytest.raises(BackupRefused, match="This file is not a Guild Board backup."):
        stage_database(database, paths.settings_path, paths.data_dir)
    assert not (paths.data_dir / PENDING).exists() and not (paths.data_dir / "restore-check.db").exists()


@pytest.mark.parametrize("made", NO_STORE)
def test_a_staged_database_no_guild_board_starts_on_is_dropped_at_the_start(tmp_path, clock, made):
    # What got past staging (a file from before the check, or put there by hand) is dropped at the start, before it
    # replaces anything: the player's database is as it was, and the start goes on with it.
    paths, store = _open(tmp_path)
    _note(store, "mine")
    store.close()
    before = paths.db_path.read_bytes()
    database = tmp_path / "made.db"
    NO_STORE[made](database)
    backup = _backup_of(database, paths, tmp_path)
    (paths.data_dir / PENDING).write_bytes(backup.read_bytes())
    (paths.data_dir / RESTORE_UNFINISHED).write_text("x", encoding="utf-8")
    assert apply_pending(paths, NOW) is False
    assert not (paths.data_dir / PENDING).exists() and not (paths.data_dir / RESTORE_UNFINISHED).exists()
    assert not (paths.data_dir / "restore-incoming.db").exists()
    assert paths.db_path.read_bytes() == before
    assert not list(paths.backups_dir.glob("guildboard-before-restore-*"))
    (paths.data_dir / PENDING).write_bytes(backup.read_bytes())  # and the start itself, which met this at every start
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core.store.meta("note") == "mine"
    finally:
        core.store.close()
    assert not (paths.data_dir / PENDING).exists()


def test_a_database_of_a_newer_schema_is_told_so(tmp_path):
    # Its tables are not known here, so they are not compared: the player is told to update, not that the file is no backup.
    paths, store = _open(tmp_path)
    store.close()
    database = tmp_path / "newer.db"
    _empty_database(database, len(MIGRATIONS) + 1)
    with pytest.raises(BackupRefused, match="comes from a newer Guild Board. Update Guild Board, then restore it."):
        stage_restore(_backup_of(database, paths, tmp_path), paths.data_dir)
    with pytest.raises(BackupRefused, match="comes from a newer Guild Board. Update Guild Board, then restore it."):
        stage_database(database, paths.settings_path, paths.data_dir)
    assert not (paths.data_dir / PENDING).exists()


def _database_whose_upgrade_fails(path: Path) -> None:
    """A database with every table and column of schema 11 that cannot be upgraded to 12: its timers table lacks the
    UNIQUE constraint of the pre-set's name and holds one pre-set twice, and schema 12 makes that name the key of both."""
    with closing(sqlite3.connect(path)) as conn:
        for number, script in enumerate(MIGRATIONS[:11]):
            conn.executescript(script.replace("preset TEXT UNIQUE", "preset TEXT") if number == 3 else script)
        conn.executescript(
            "INSERT INTO timers (preset, name, rule, created_at, updated_at) VALUES ('daily', 'a', '', 'x', 'x'), "
            "('daily', 'b', '', 'x', 'x'); PRAGMA user_version = 11;"
        )


def test_a_restore_that_cannot_be_opened_is_dropped_whatever_the_checks_let_through(tmp_path, clock, caplog):
    # The tables and columns of a database say nothing of its rows. Whatever fails when the start opens what was restored
    # is met before the restore replaces the player's database, which is then as it was: the restore is dropped, and the
    # log says so. Nothing is put back, for nothing was taken away.
    paths, store = _open(tmp_path)
    _note(store, "mine")
    store.close()
    before = paths.db_path.read_bytes()
    database = tmp_path / "made.db"
    _database_whose_upgrade_fails(database)
    backup = _backup_of(database, paths, tmp_path)
    (paths.data_dir / PENDING).write_bytes(backup.read_bytes())
    with caplog.at_level("WARNING", logger="guildboard.backups"):
        assert apply_pending(paths, NOW) is False
    assert "removed" in caplog.text
    assert paths.db_path.read_bytes() == before
    assert not [path.name for path in paths.data_dir.iterdir() if "restore" in path.name]
    assert not list(paths.backups_dir.iterdir())  # not even the copy a start makes before it upgrades
    (paths.data_dir / PENDING).write_bytes(backup.read_bytes())
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core.store.meta("note") == "mine"
    finally:
        core.store.close()


def test_a_start_removes_the_scratch_files_a_cut_off_backup_or_restore_left(tmp_path, clock):
    # A backup is copied to a scratch file named by its thread, so a crash or a power cut that leaves one leaves a name
    # that no later backup would use again, and a copy of the whole database for good. The start removes them, and the
    # copy a restore is tried on, which a start that stopped there left. It leaves what is not a scratch file of these.
    paths, store = _open(tmp_path)
    store.close()
    leftovers = [
        paths.data_dir / "backup-scratch-1234.db", paths.data_dir / "backup-scratch-98765432.db",
        paths.data_dir / "restore-trial.db", paths.data_dir / "restore-trial.db-wal", paths.data_dir / "restore-trial.db-shm",
    ]
    for leftover in leftovers:
        leftover.write_bytes(b"a copy of the database")
    (paths.data_dir / "restore-trial-backups").mkdir()
    (paths.data_dir / "restore-trial-backups" / "guildboard-auto-v11-20261026-090000.db").write_bytes(b"a copy")
    kept = [paths.data_dir / "backup-scratch-notes.txt", paths.data_dir / "my-backup-scratch-1.db"]
    for file in kept:
        file.write_bytes(b"not a scratch file")
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    core.store.close()
    assert not any(leftover.exists() for leftover in leftovers) and not (paths.data_dir / "restore-trial-backups").exists()
    assert all(file.exists() for file in kept)


def test_a_backup_of_an_older_schema_is_restored_and_upgraded_at_the_start(tmp_path, clock):
    # The checks hold a database to the tables of the schema it says it is at. A backup an older Guild Board made has
    # exactly those, so it is still restored, and the start upgrades it as it upgrades any older database.
    paths, store = _open(tmp_path)
    _note(store, "mine")
    store.close()
    database = tmp_path / "older.db"
    with closing(sqlite3.connect(database)) as conn:
        for script in MIGRATIONS[:11]:
            conn.executescript(script)
        conn.executescript("INSERT INTO meta (key, value) VALUES ('note', 'older'); PRAGMA user_version = 11;")
    manifest = {"app": "Guild Board", "format": 1, "version": "0.6.0", "schema": 11, "made_at": ""}
    older = _rebuilt(_backup_of(database, paths, tmp_path), tmp_path / "older.gbbackup", manifest_json=json.dumps(manifest))
    stage_restore(older, paths.data_dir)
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core.store.meta("note") == "older"
        assert core.store._conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    finally:
        core.store.close()


def test_a_staged_copy_cut_short_leaves_the_earlier_staging_alone(tmp_path, monkeypatch):
    # The staged file is written under another name and takes its own when whole: a stage cut short must not leave a file
    # the next start takes for a restore, nor take away the one that was staged before.
    paths, store = _open(tmp_path)
    _note(store, "then")
    copy = store.backup("manual", NOW)
    store.close()
    stage_database(copy, paths.settings_path, paths.data_dir)
    earlier = (paths.data_dir / PENDING).read_bytes()
    seen: list[list[str]] = []

    def dies(*args, **kwargs):
        seen.append(sorted(p.name for p in paths.data_dir.glob("restore-pending*")))
        raise KeyboardInterrupt

    monkeypatch.setattr(backups_module, "load_settings", dies)
    with pytest.raises(KeyboardInterrupt):
        stage_database(copy, paths.settings_path, paths.data_dir)
    monkeypatch.undo()
    assert seen == [[PENDING]]  # nothing was written under the final name before the call that died
    assert (paths.data_dir / PENDING).read_bytes() == earlier
    assert not list(paths.data_dir.glob("*.tmp"))


def _folder_of_account(tmp_path, name: str, uid: int | None):
    paths = AppPaths(tmp_path / name)
    paths.ensure()
    store = Store.open(paths.db_path, paths.backups_dir, NOW)
    if uid is not None:
        store.set_meta("account_uid", str(uid))
    _note(store, name)
    return paths, store


def test_a_backup_of_another_game_account_is_refused_before_it_is_staged(tmp_path):
    friend, friends_store = _folder_of_account(tmp_path, "friend", 700000002)
    backup = tmp_path / "friend.gbbackup"
    write_backup(friends_store, friend.settings_path, backup, NOW)
    copy = friends_store.backup("manual", NOW)
    friends_store.close()
    mine, my_store = _folder_of_account(tmp_path, "mine", 700000001)
    my_store.close()
    for stage in (
        lambda: stage_restore(backup, mine.data_dir), lambda: stage_database(copy, mine.settings_path, mine.data_dir),
    ):
        with pytest.raises(BackupRefused, match="another game account"):
            stage()
    assert not (mine.data_dir / PENDING).exists() and not (mine.data_dir / "restore-check.db").exists()


def test_a_backup_is_taken_when_the_accounts_are_the_same_or_either_is_not_named_yet(tmp_path):
    copies = {}
    for name, uid in (("same", 700000001), ("unnamed", None)):
        _, backed = _folder_of_account(tmp_path, f"from-{name}", uid)
        copies[name] = backed.backup("manual", NOW)
        backed.close()
    for mine_uid, copy in ((700000001, "same"), (None, "same"), (700000001, "unnamed")):
        mine, my_store = _folder_of_account(tmp_path, f"mine-{mine_uid}-{copy}", mine_uid)
        my_store.close()
        stage_database(copies[copy], mine.settings_path, mine.data_dir)
        assert (mine.data_dir / PENDING).exists()


def test_a_staged_backup_of_another_account_is_dropped_at_the_start(tmp_path):
    # Staged where no account was named, as an older Guild Board could, and met at the start by a folder that names one.
    _, friends_store = _folder_of_account(tmp_path, "friend", 700000002)
    copy = friends_store.backup("manual", NOW)
    friends_store.close()
    staging, staging_store = _folder_of_account(tmp_path, "staging", None)
    staging_store.close()
    stage_database(copy, staging.settings_path, staging.data_dir)
    mine, my_store = _folder_of_account(tmp_path, "mine", 700000001)
    my_store.close()
    (mine.data_dir / PENDING).write_bytes((staging.data_dir / PENDING).read_bytes())
    assert apply_pending(mine, NOW + timedelta(hours=1)) is False
    assert not (mine.data_dir / PENDING).exists()
    kept = Store.open(mine.db_path, mine.backups_dir, NOW)
    assert kept.meta("note") == "mine" and kept.meta("account_uid") == "700000001"
    kept.close()


def test_a_backup_of_another_account_is_refused_with_the_way_to_restore_it():
    assert "move guildboard.db out of its data folder" in backups_module.OTHER_ACCOUNT


def test_a_start_removes_a_staging_that_was_cut_off(tmp_path):
    left = tmp_path / (backups_module.PENDING + ".tmp")
    left.write_bytes(b"cut off")
    backups_module.sweep_scratch(tmp_path)
    assert not left.exists()
