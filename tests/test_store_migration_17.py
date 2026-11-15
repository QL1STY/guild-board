"""Schema 17: the planned list (`char_focus`) holds up to 128 characters, no longer four, and keeps its sync triggers."""
import sqlite3
from datetime import datetime, timezone

import pytest

from guildboard.store import CHAR_FOCUS_MAX, MIGRATIONS, Store

NOW = datetime(2026, 11, 12, 8, 0, tzinfo=timezone.utc)
UID = 700000001
FOUR = ["sandrone", "odette", "alyosha", "jahoda"]


def _database_at_16(path) -> None:
    old = sqlite3.connect(path)
    old.executescript("".join(MIGRATIONS[:16]))
    old.executemany(
        "INSERT INTO char_focus (uid, position, character) VALUES (?, ?, ?)",
        [(UID, position, name) for position, name in enumerate(FOUR, start=1)],
    )
    old.execute("DELETE FROM sync_outbox")  # the lines of the four inserts: the database starts with its outbox empty
    old.execute("PRAGMA user_version = 16")
    old.commit()
    old.close()


def test_the_planned_list_is_the_17th_schema_and_holds_128():
    assert len(MIGRATIONS) >= 17 and CHAR_FOCUS_MAX == 128


def test_four_rows_at_version_16_are_kept_and_a_fifth_can_be_inserted(tmp_path):
    path = tmp_path / "guildboard.db"
    _database_at_16(path)
    store = Store.open(path, tmp_path / "backups", NOW)
    try:
        assert store._conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
        assert store.focus(UID) == FOUR
        store._conn.execute("INSERT INTO char_focus (uid, position, character) VALUES (?, 5, 'nefer')", (UID,))
        store._conn.execute("INSERT INTO char_focus (uid, position, character) VALUES (?, 128, 'flins')", (UID,))
        assert store.focus(UID) == [*FOUR, "nefer", "flins"]
        with pytest.raises(sqlite3.IntegrityError):
            store._conn.execute("INSERT INTO char_focus (uid, position, character) VALUES (?, 0, 'nobody')", (UID,))
    finally:
        store.close()
    assert len(list((tmp_path / "backups").glob("guildboard-auto-v16-*.db"))) == 1  # the usual backup before a migration


def test_the_migration_leaves_the_outbox_empty_and_the_triggers_on(tmp_path):
    path = tmp_path / "guildboard.db"
    _database_at_16(path)
    store = Store.open(path, tmp_path / "backups", NOW)
    try:
        assert store.sync_outbox(10) == []  # the rows copied are no change of the player's
        store._conn.execute("INSERT INTO char_focus (uid, position, character) VALUES (?, 5, 'nefer')", (UID,))
        assert [(line.kind, line.row_key, line.deleted) for line in store.sync_outbox(10)] == [
            ("char_focus", f"[{UID},5]", False)
        ]
    finally:
        store.close()


def test_the_three_triggers_are_the_ones_of_schema_12(tmp_path):
    path = tmp_path / "guildboard.db"
    _database_at_16(path)
    before = sqlite3.connect(path)
    wanted = dict(before.execute("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'char_focus'"))
    before.close()
    assert sorted(wanted) == ["sync_char_focus_delete", "sync_char_focus_insert", "sync_char_focus_update"]
    store = Store.open(path, tmp_path / "backups", NOW)
    try:
        now = dict(store._conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'char_focus'"
        ))
    finally:
        store.close()
    assert now == wanted


def test_a_changed_and_a_removed_row_leave_their_lines(tmp_path):
    path = tmp_path / "guildboard.db"
    _database_at_16(path)
    store = Store.open(path, tmp_path / "backups", NOW)
    try:
        store._conn.execute("UPDATE char_focus SET character = 'nefer' WHERE uid = ? AND position = 1", (UID,))
        store._conn.execute("DELETE FROM char_focus WHERE uid = ? AND position = 2", (UID,))
        assert sorted((line.row_key, line.deleted) for line in store.sync_outbox(10)) == [
            (f"[{UID},1]", False), (f"[{UID},2]", True),
        ]
    finally:
        store.close()


def test_the_store_refuses_more_than_128(store):
    store.put_focus(UID, [f"c{n}" for n in range(128)])
    assert len(store.focus(UID)) == 128
    with pytest.raises(ValueError):
        store.put_focus(UID, [f"c{n}" for n in range(129)])
    assert len(store.focus(UID)) == 128
