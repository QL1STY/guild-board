"""The game's own history kept in the store (the ledger design, section 4, and section 0's diary detail): schema 10."""
import sqlite3
from datetime import datetime, timedelta, timezone

from guildboard.store import MIGRATIONS, DiaryActionRow, LedgerRow, Store

UID = 700000001
NOW = datetime(2026, 10, 27, 9, 41, tzinfo=timezone.utc)


def _row(entry_id: int, kind: str = "primogem", amount: int = 60, reason: str = "Daily Commission reward",
         hours: int = 0, uid: int = UID, **more) -> LedgerRow:
    at = NOW - timedelta(hours=hours)
    return LedgerRow(uid, kind, entry_id, at.astimezone(timezone(timedelta(hours=1))).strftime("%Y-%m-%d %H:%M:%S"),
                     at, amount, reason, **more)


def test_ledger_entries_are_kept_once(store):
    rows = [_row(1), _row(2, amount=90, reason="Blessing of the Welkin Moon daily reward")]
    assert store.keep_ledger_entries(rows) == 2
    assert store.keep_ledger_entries(rows) == 0
    assert store.has_ledger_entry(UID, "primogem", 1) and not store.has_ledger_entry(UID, "crystal", 1)
    assert not store.has_ledger_entry(UID + 1, "primogem", 1)
    # the same id of another kind is another entry
    assert store.keep_ledger_entries([_row(1, kind="resin", amount=-20)]) == 1


def test_ledger_entries_newest_first_and_paged(store):
    store.keep_ledger_entries(_row(n, hours=10 - n) for n in range(1, 8))
    assert [row.id for row in store.ledger_entries(UID, "primogem")] == [7, 6, 5, 4, 3, 2, 1]
    assert [row.id for row in store.ledger_entries(UID, "primogem", limit=3)] == [7, 6, 5]
    assert [row.id for row in store.ledger_entries(UID, "primogem", before_id=5, limit=3)] == [4, 3, 2]
    assert [row.id for row in store.ledger_entries(UID, "primogem", since=NOW - timedelta(hours=5))] == [7, 6]  # after
    assert store.oldest_ledger_entry(UID, "primogem").id == 1
    assert store.newest_ledger_entry(UID, "primogem").id == 7
    assert store.oldest_ledger_entry(UID, "crystal") is None
    kept = store.ledger_entries(UID, "primogem", limit=1)[0]
    assert kept == _row(7, hours=3) and kept.at.tzinfo is not None


def test_an_artifact_keeps_its_name_and_rarity(store):
    store.keep_ledger_entries([_row(9, kind="artifact", amount=1, reason="Revitalized Petrified Tree (Domain)",
                                    name="Gladiator's Nostalgia", rarity=5)])
    [row] = store.ledger_entries(UID, "artifact")
    assert (row.name, row.rarity) == ("Gladiator's Nostalgia", 5)


def test_the_imports_record_and_the_last_that_ended_well(store):
    assert store.last_ledger_import(UID) is None
    store.record_ledger_import(UID, "primogem", NOW - timedelta(hours=2), 340, "ok", None)
    store.record_ledger_import(UID, "crystal", NOW, 0, "failed", "HoYoverse could not be reached.")
    assert store.last_ledger_import(UID) == NOW - timedelta(hours=2)
    assert store.last_ledger_import() == NOW - timedelta(hours=2)
    assert store.ledger_uids() == [UID]


def test_diary_actions_number_twins_and_are_kept_once(store):
    at = NOW - timedelta(hours=1)
    twins = [DiaryActionRow(UID, "2026-10-27 09:41:00", at, "Adventure", 5, n) for n in range(2)]
    assert store.keep_diary_actions(UID, twins) == 2
    assert store.keep_diary_actions(UID, twins) == 0
    assert len(store.diary_actions(UID, NOW - timedelta(days=1), NOW)) == 2
    assert store.diary_actions(UID, NOW, NOW + timedelta(days=1)) == []


def test_old_database_upgrades_with_the_ledger_tables(tmp_path):
    path = tmp_path / "guildboard.db"
    old = sqlite3.connect(path)
    old.executescript("".join(MIGRATIONS[:9]))
    old.execute("PRAGMA user_version = 9")
    old.commit()
    old.close()
    store = Store.open(path, tmp_path / "backups", NOW)
    try:
        tables = {name for (name,) in store._conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert {"ledger_entries", "ledger_imports", "diary_actions"} <= tables
        assert "ledger_manual" not in tables
        assert store._conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
    finally:
        store.close()
