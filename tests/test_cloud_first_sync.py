"""The first sync of a PC with an account (the online plan, Task C5): which way the data goes when only one of them holds any, the
one question when both do, and what each answer replaces. The account here is the `Account` below, which keeps its rows as the
project does (0003_sync.sql), so that what goes up and what comes down is followed to the end."""
import json
import sqlite3
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs

import pytest

from cloud_fakes import USER_ID, FakeCloud, answer
from guildboard.backups import read_manifest, stage_database
from guildboard.cloud.models import SENTENCES
from guildboard.cloud.sync import KINDS, SYNCED_SETTINGS
from guildboard.store import _SYNCED_AT_12, Store, TimerRow
from test_cloud_sync import PROFILE, Bench, make_core, own_row, quiet
from test_sync_outbox import CASES

NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
STAMP = "2026-10-12T08:00:00.000000+00:00"
LONG_AGO = "2020-01-01T00:00:00.000000+00:00"
PHONE_BOARD = json.dumps([{"id": "phone-clock", "type": "clock", "w": 2, "h": 1, "settings": {}}])  # the account's Board


class Account(FakeCloud):
    """The account's `sync_rows` in memory, with the project's rules: a push keeps a row when it is not older than the one held
    (a tie goes to the later arrival), a delete keeps no data, and every row that is kept arrives at a time of its own. A read is
    the subset of PostgREST that Guild Board asks for."""

    def __init__(self, rows: list[dict] | None = None) -> None:
        super().__init__({PROFILE: answer(200, [own_row()])})
        self.rows: dict[tuple[str, str], dict] = {}
        self.arrivals = 0
        self.fail_reads = 0
        self.refuse_pushes: str | None = None  # the code a push is refused with, when it is
        for row in rows or []:
            self._keep({**row, "edited_at": row.get("edited_at", STAMP)})

    def _keep(self, row: dict) -> bool:
        key = (row["kind"], row["row_key"])
        held = self.rows.get(key)
        edited = datetime.fromisoformat(row["edited_at"])
        if held is not None and edited < datetime.fromisoformat(held["edited_at"]):
            return False
        self.arrivals += 1
        arrived = (datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc) + timedelta(milliseconds=self.arrivals)).isoformat(timespec="microseconds")
        deleted = row.get("deleted") is True
        self.rows[key] = {
            "kind": row["kind"], "row_key": row["row_key"], "data": {} if deleted else row["data"], "deleted": deleted,
            "edited_at": row["edited_at"], "received_at": arrived, "device_id": row.get("device_id", "phone"),
        }
        return True

    def live(self) -> set[tuple[str, str]]:
        return {key for key, row in self.rows.items() if not row["deleted"]}

    def __call__(self, path, *, method="GET", headers=None, body=None, **kwargs):
        if path.startswith("/rest/v1/sync_rows") and method == "GET":
            self.requests.append((method, path, dict(headers or {}), body))
            if self.fail_reads:
                self.fail_reads -= 1
                return 503, b""
            return self._read(path)
        if path == "/rest/v1/rpc/sync_push" and method == "POST":
            self.requests.append((method, path, dict(headers or {}), body))
            if self.refuse_pushes is not None:
                return 400, json.dumps({"code": "P0001", "message": self.refuse_pushes}).encode()
            kept = sum(self._keep(row) for row in json.loads(body)["p_rows"])
            return 200, str(kept).encode()
        return super().__call__(path, method=method, headers=headers, body=body, **kwargs)

    def _read(self, path: str) -> tuple[int, bytes]:
        query = parse_qs(path.split("?", 1)[1])
        rows = list(self.rows.values())
        if "device_id" in query:
            rows = [row for row in rows if row["device_id"] != query["device_id"][0].removeprefix("neq.")]
        if "received_at" in query:
            since = datetime.fromisoformat(query["received_at"][0].removeprefix("gte."))
            rows = [row for row in rows if datetime.fromisoformat(row["received_at"]) >= since]
        if "deleted" in query:
            rows = [row for row in rows if str(row["deleted"]).lower() == query["deleted"][0].removeprefix("eq.")]
        order = query.get("order", ["received_at.asc,kind.asc,row_key.asc"])[0].split(",")
        for column in reversed(order):
            rows.sort(key=lambda row: row[column.split(".")[0]])
        offset = int(query.get("offset", ["0"])[0])
        rows = rows[offset: offset + int(query["limit"][0])]
        fields = query["select"][0].split(",")
        return 200, json.dumps([{field: row[field] for field in fields} for row in rows]).encode()


def row_of(kind: str, row_key: str, data: dict, **more) -> dict:
    return {"kind": kind, "row_key": row_key, "data": data, "deleted": False, **more}


def fill(store: Store, *kinds: str) -> None:
    """A row of each kind, as the data of a PC that was in use before sync: with no line in the outbox."""
    for kind in kinds:
        store._conn.execute(CASES[kind][0])
    store._conn.execute("DELETE FROM sync_outbox")
    store._conn.commit()


def keys_of(store: Store) -> set[tuple[str, str]]:
    found = set()
    for table, key, _ in _SYNCED_AT_12:
        for (text,) in store._conn.execute(f"SELECT json_array({', '.join(key)}) FROM {table}"):
            found.add((table, text))
    return found


THEIRS = [
    row_of("layouts", '["board"]', {"widgets": PHONE_BOARD, "revision": 3, "updated_at": STAMP}),
    row_of("achievement_progress", "[1402]", {"status": "done", "done_at": STAMP, "pinned": 0, "note": "", "source": "phone", "updated_at": STAMP}),
    row_of("widget_data", '["resin"]', {"data": '{"phone": true}', "updated_at": STAMP}),
    row_of("settings", "commission_region", {"value": "inazuma"}),
    row_of("from_the_phone", '["x"]', {"a": 1}),
]


# ------------------------------------------------------------------------------------------------------------- one holds data
async def test_keep_this_pc_on_an_account_that_is_full_says_so(tmp_path, clock):
    # The first sync that sends this PC's data is a push like any other: what the account refuses reaches the player.
    account = Account([row_of("timers", '["theirs"]', {"name": "Theirs"})])
    account.refuse_pushes = "sync_full"
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    view = await bench.online.first_sync("keep")
    assert view["sync"]["needs_choice"] is False
    assert view["message"] == SENTENCES["sync_full"]
    assert bench.store.sync_outbox(10)  # it waits for room


async def test_an_empty_account_takes_this_pcs_data_without_asking(tmp_path, clock):
    account = Account()
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts", "achievement_progress", "gift_codes", "char_ticks")
    await bench.online.sync_turn()  # the first look: nothing in the account, something here
    assert bench.online.view()["sync"]["needs_choice"] is False
    await quiet(bench)
    assert account.live() == {
        ("layouts", '["board"]'), ("achievement_progress", "[1402]"), ("gift_codes", CASES["gift_codes"][3]),
        ("char_ticks", CASES["char_ticks"][3]), *{("settings", name) for name in SYNCED_SETTINGS},
    }
    assert bench.store.sync_outbox(10) == [] and bench.store.meta("sync_first") == "done"
    assert bench.online.view()["sync"]["last_at"] is not None
    assert len([line for line in account.sent() if "sync_push" in line]) == 1


async def test_an_empty_pc_takes_the_accounts_data_without_asking(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    await bench.online.sync_turn()
    view = bench.online.view()
    assert view["sync"]["needs_choice"] is False and view["sync"]["last_at"] is not None
    assert keys_of(bench.store) == {("layouts", '["board"]'), ("achievement_progress", "[1402]"), ("widget_data", '["resin"]')}
    assert bench.store.layout("board").widgets == PHONE_BOARD
    assert bench.settings["commission_region"] == "inazuma"
    await quiet(bench)
    assert [line for line in account.sent() if "sync_push" in line] == []  # it sent nothing: it had nothing
    assert bench.store.sync_outbox(10) == [] and bench.store.meta("sync_first") == "done"


async def test_what_an_empty_pc_did_before_its_first_sync_buries_nothing(tmp_path, clock):
    # A tick taken back on a new PC, before it signed in, leaves the PC empty and a line for a delete, of a time later than the
    # account's row. It would bury that tick on every PC.
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    bench.store._conn.execute(CASES["achievement_progress"][0])
    bench.store._conn.execute(CASES["achievement_progress"][2])
    assert [line.deleted for line in bench.store.sync_outbox(10)] == [True]
    await bench.online.sync_turn()
    await quiet(bench)
    await quiet(bench)
    assert ("achievement_progress", "[1402]") in account.live()
    assert ("achievement_progress", "[1402]") in keys_of(bench.store)
    assert [line for line in account.sent() if "sync_push" in line] == []


async def test_a_pc_with_only_the_apps_own_timers_is_an_empty_pc(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    with bench.store.applying_sync():
        bench.store.add_timer(TimerRow(0, "parametric", "", "", "", None, True, None, None, NOW, NOW))
    await bench.online.sync_turn()
    assert bench.online.view()["sync"]["needs_choice"] is False
    assert ("achievement_progress", "[1402]") in keys_of(bench.store)


@pytest.mark.parametrize("touch", ["bell", "ready", "updated", "steps"])
async def test_a_default_timer_the_player_touched_is_their_data(tmp_path, clock, touch):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    with bench.store.applying_sync():
        bench.store.add_timer(TimerRow(0, "parametric", "", "", "", None, True, None, None, NOW, NOW))
    change = {
        "bell": "UPDATE timers SET bell = 0", "ready": "UPDATE timers SET ready_override = '2026-10-14T08:00:00+00:00'",
        "updated": "UPDATE timers SET updated_at = '2026-10-13T09:00:00+00:00'", "steps": "UPDATE timers SET steps = 3",
    }[touch]
    with bench.store.applying_sync():
        bench.store._conn.execute(change)
    await bench.online.sync_turn()
    assert bench.online.view()["sync"]["needs_choice"] is True


async def test_neither_holding_data_just_begins(tmp_path, clock):
    account = Account()
    bench = Bench(tmp_path, clock, account, settled=False)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.store.meta("sync_first") == "done" and bench.online.view()["sync"]["needs_choice"] is False
    assert [line for line in account.sent() if "sync_push" in line] == []


async def test_a_server_that_does_not_answer_leaves_the_first_look_for_later(tmp_path, clock):
    account = Account(THEIRS)
    account.fail_reads = 1
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    assert bench.store.meta("sync_first") is None and bench.online.view()["sync"]["needs_choice"] is False
    assert bench.online.view()["offline"] is True
    await quiet(bench, 301)
    assert bench.online.view()["sync"]["needs_choice"] is True  # asked at last, now that it could be told what the account holds


# --------------------------------------------------------------------------------------------------------- both hold data
async def test_both_with_data_asks_once(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts", "char_ticks")
    await bench.online.sync_turn()
    assert bench.online.view()["sync"] == {"on": True, "last_at": None, "needs_choice": True}
    asked = len(account.requests)

    # Nothing moves until the answer, however long it takes, and whatever the player does meanwhile.
    bench.store._conn.execute("UPDATE layouts SET revision = 2")
    await quiet(bench)
    await quiet(bench, 400)
    await bench.online.sync_now()
    assert len(account.requests) == asked
    assert keys_of(bench.store) == {("layouts", '["board"]'), ("char_ticks", CASES["char_ticks"][3])}
    assert len(bench.store.sync_outbox(10)) == 1  # the edit waits

    # And it is asked once: a start of Guild Board later it still waits, and does not ask the account again.
    (tmp_path / "again").mkdir()
    again = Bench(tmp_path / "again", clock, account, settled=False, store=bench.store)
    await again.online.sync_turn()
    assert again.online.view()["sync"]["needs_choice"] is True
    assert [line for line in account.sent() if "sync_" in line] == [line for line in account.sent()[:asked] if "sync_" in line]


async def test_an_answer_with_no_question_changes_nothing(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account)  # the first sync is over
    fill(bench.store, "layouts")
    before = len(account.requests)
    for choice in ("keep", "use", "nonsense", None, 7):
        view = await bench.online.first_sync(choice)
        assert view["sync"]["needs_choice"] is False
    assert len(account.requests) == before and keys_of(bench.store) == {("layouts", '["board"]')}


@pytest.mark.parametrize("choice", ["nonsense", "", None, 7, True, ["use"], "USE", "Keep", "keep ", " use"])
async def test_nothing_but_keep_and_use_answers_the_question(tmp_path, clock, choice):
    # "use" replaces what is on this PC: no other word is taken for it.
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts", "char_ticks")
    await bench.online.sync_turn()
    asked = len(account.requests)
    view = await bench.online.first_sync(choice)
    assert view["sync"]["needs_choice"] is True and len(account.requests) == asked
    assert keys_of(bench.store) == {("layouts", '["board"]'), ("char_ticks", CASES["char_ticks"][3])}
    assert bench.store.sync_outbox(10) == [] and bench.store.meta("sync_first") == "asking"


async def test_keep_this_pcs_data_stamps_every_row_and_buries_the_rest(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts", "char_ticks", "gift_codes")
    await bench.online.sync_turn()
    assert bench.online.view()["sync"]["needs_choice"] is True
    # A line from long before: the row was edited a year ago, and the account's copy is newer than that edit.
    bench.store._conn.execute(
        "INSERT OR REPLACE INTO sync_outbox (kind, row_key, edited_at, deleted) VALUES ('layouts', '[\"board\"]', '2020-01-01T00:00:00.000Z', 0)"
    )

    view = await bench.online.first_sync("keep")
    assert view["sync"]["needs_choice"] is False and bench.store.meta("sync_first") == "done"
    assert bench.store.sync_outbox(100) == []  # sent, all of it
    mine = keys_of(bench.store)
    assert account.live() == mine | {("settings", name) for name in SYNCED_SETTINGS} | {("from_the_phone", '["x"]'), ("settings", "commission_region")}
    # What this PC did not have was buried there: deleted, with no data. Its own win over the account's, whatever the old line said.
    for gone in (("achievement_progress", "[1402]"), ("widget_data", '["resin"]')):
        assert account.rows[gone]["deleted"] is True and account.rows[gone]["data"] == {}
    assert account.rows[("layouts", '["board"]')]["data"]["revision"] == 1 and account.rows[("layouts", '["board"]')]["device_id"] == bench.store.meta("sync_device")
    # A kind of a newer phone is not this PC's to bury.
    assert account.rows[("from_the_phone", '["x"]')]["deleted"] is False
    # Nothing came down: this PC's data is what it was.
    assert mine == {("layouts", '["board"]'), ("char_ticks", CASES["char_ticks"][3]), ("gift_codes", CASES["gift_codes"][3])}
    assert account.rows[("settings", "commission_region")]["data"] == {"value": "liyue"}  # its settings went up too
    assert bench.settings["commission_region"] == "liyue"  # and are what they were


async def test_keep_this_pc_with_a_server_that_fails_leaves_the_question(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    account.fail_reads = 1
    view = await bench.online.first_sync("keep")
    assert view["sync"]["needs_choice"] is True and bench.store.sync_outbox(10) == []  # nothing was stamped
    assert ("achievement_progress", "[1402]") in account.live()
    assert (await bench.online.first_sync("keep"))["sync"]["needs_choice"] is False  # and it works the next time


async def test_a_pc_with_changed_settings_and_no_rows_is_asked(tmp_path, clock):
    # A new PC's first run sets the commission region, the currency or the notifications before any sign-in: those are the
    # player's too, and the account's would replace them without a question (the player's decision, 2026-11-01, item 7).
    core = make_core(tmp_path, clock, Account(THEIRS))
    try:
        core.update_settings({"commission_region": "sumeru"})
        await core.online.sync_turn()
        assert core.online.view()["sync"]["needs_choice"] is True
        assert core.settings.commission_region == "sumeru"
        assert keys_of(core.store) & {("layouts", '["board"]')} == set()  # nothing came down
    finally:
        core.store.close()


async def test_the_first_look_backs_up_the_settings_it_replaces(tmp_path, clock):
    # A PC with nothing of its own takes the account's data without a question, the settings that sync among them: a copy of
    # the settings it had is made first, as Use the account's data makes one.
    core = make_core(tmp_path, clock, Account(THEIRS))
    try:
        await core.online.sync_turn()
        assert core.online.view()["sync"]["needs_choice"] is False
        assert core.settings.commission_region == "inazuma"
        [backup] = list(core.paths.backups_dir.glob("*.gbbackup"))
        read_manifest(backup)  # one that Restore takes
        with zipfile.ZipFile(backup) as bundle:
            assert json.loads(bundle.read("settings.json"))["commission_region"] == "liyue"
    finally:
        core.store.close()


async def test_use_the_accounts_data_backs_up_the_settings_it_replaces(tmp_path, clock):
    # A copy of the database has no settings in it, and the ones that sync are replaced too: the player's prices among them.
    core = make_core(tmp_path, clock, Account(THEIRS))
    try:
        core.update_settings({"commission_region": "sumeru"})
        fill(core.store, "layouts")
        await core.online.sync_turn()
        assert (await core.online.first_sync("use"))["sync"]["needs_choice"] is False
        assert core.settings.commission_region == "inazuma"
        [backup] = list(core.paths.backups_dir.glob("*.gbbackup"))
        read_manifest(backup)  # one that Restore takes
        with zipfile.ZipFile(backup) as bundle:
            assert json.loads(bundle.read("settings.json"))["commission_region"] == "sumeru"
    finally:
        core.store.close()


async def test_use_the_accounts_data_backs_up_first(tmp_path, clock):
    path = tmp_path / "db" / "guildboard.db"
    store = Store.open(path, tmp_path / "backups", NOW)
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False, store=store)
    fill(store, "layouts", "char_ticks")
    store._conn.execute("UPDATE layouts SET widgets = '[1]'")
    store._conn.execute("DELETE FROM sync_outbox")
    store._conn.commit()
    await bench.online.sync_turn()
    assert bench.online.view()["sync"]["needs_choice"] is True

    view = await bench.online.first_sync("use")
    assert view["sync"]["needs_choice"] is False and store.meta("sync_first") == "done"
    # A copy of the database as it was, made before a row was touched.
    [backup] = list((tmp_path / "backups").glob("guildboard-auto-sync-*.db"))
    old = sqlite3.connect(backup)
    try:
        assert old.execute("SELECT widgets FROM layouts").fetchone() == ("[1]",)
        assert old.execute("SELECT COUNT(*) FROM char_ticks").fetchone() == (1,)
    finally:
        old.close()
    # And this PC holds the account's: the rows that were here and are not there are gone, with no line to send.
    assert keys_of(store) == {("layouts", '["board"]'), ("achievement_progress", "[1402]"), ("widget_data", '["resin"]')}
    assert store.layout("board").widgets == PHONE_BOARD
    assert bench.settings["commission_region"] == "inazuma"
    assert store.sync_outbox(100) == []
    assert [line for line in account.sent() if "sync_push" in line] == []
    assert account.live() >= {("layouts", '["board"]')}  # the account is as it was
    # The pages are told of all of it.
    assert bench.told and {"layout_changed", "achievements_changed", "timers_changed", "characters_changed", "settings_changed"} <= bench.told[-1]
    # The cursor has moved to the newest row read, so that the next read begins there.
    assert store.meta("sync_cursor") == max(row["received_at"] for row in account.rows.values())
    store.close()


async def test_use_the_accounts_data_with_a_server_that_fails_changes_nothing(tmp_path, clock):
    path = tmp_path / "db" / "guildboard.db"
    store = Store.open(path, tmp_path / "backups", NOW)
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False, store=store)
    fill(store, "layouts", "char_ticks")
    await bench.online.sync_turn()
    account.fail_reads = 1
    view = await bench.online.first_sync("use")
    assert view["sync"]["needs_choice"] is True
    assert keys_of(store) == {("layouts", '["board"]'), ("char_ticks", CASES["char_ticks"][3])}
    assert not (tmp_path / "backups").exists() or list((tmp_path / "backups").glob("guildboard-auto-sync-*.db")) == []
    store.close()


async def test_use_the_accounts_data_with_many_rows(tmp_path, clock):
    account = Account([
        row_of("widget_data", f'["w{number:04}"]', {"data": "{}", "updated_at": STAMP}) for number in range(1300)
    ])
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    await bench.online.first_sync("use")
    assert bench.store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 1300
    assert bench.store.layout("board") is None


async def test_keep_this_pc_with_many_rows_on_the_account(tmp_path, clock):
    account = Account([
        row_of("widget_data", f'["w{number:04}"]', {"data": "{}", "updated_at": STAMP}) for number in range(1300)
    ])
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    await bench.online.first_sync("keep")
    assert sum(1 for key in account.rows if key[0] == "widget_data" and account.rows[key]["deleted"]) == 1300
    assert account.rows[("layouts", '["board"]')]["deleted"] is False


async def test_another_online_account_is_a_new_first_sync(tmp_path, clock):
    account = Account()
    bench = Bench(tmp_path, clock, account, settled=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    assert bench.store.meta("sync_first") == "done"
    from guildboard.cloud.session import CloudSession

    other = Account(THEIRS)
    bench.online._client._fetch = other
    bench.cloud_store.save(CloudSession(
        "ACCESS-2-0123456789", "REFRESH-2-0123456789", clock.now().timestamp() + 365 * 86_400,
        "00000000-0000-0000-0000-0000000000bb", "Nova", "5120",
    ))
    bench.online._start_afresh()
    await bench.online.sync_turn()
    assert bench.online.view()["sync"]["needs_choice"] is True  # the other account holds data, and so does this PC


async def test_the_first_sync_waits_for_the_switch(tmp_path, clock):
    account = Account(THEIRS)
    bench = Bench(tmp_path, clock, account, settled=False, on=False)
    fill(bench.store, "layouts")
    await bench.online.sync_turn()
    assert account.requests == [] and bench.store.meta("sync_first") is None
    bench.on = True
    await bench.online.sync_turn()
    assert bench.online.view()["sync"]["needs_choice"] is True


def test_every_kind_is_stamped_and_the_apps_defaults_are_not_a_pcs_data(store):
    for kind in CASES:
        store._conn.execute(CASES[kind][0])
    store._conn.execute("DELETE FROM sync_outbox")
    assert store.sync_has_data() is True
    assert store.sync_stamp_all() == 18
    assert sorted(line.kind for line in store.sync_outbox(100)) == sorted(kind.table for kind in KINDS)
    assert not any(line.deleted for line in store.sync_outbox(100))


def test_a_pc_is_empty_until_a_synced_table_holds_a_row(store):
    assert store.sync_has_data() is False
    for kind in CASES:
        fresh = Store.in_memory()
        try:
            fresh._conn.execute(CASES[kind][0])
            assert fresh.sync_has_data() is True, kind
        finally:
            fresh.close()
    # What is not the player's own does not count: the wishes and the fetched numbers HoYoLAB gave.
    store._conn.execute("INSERT INTO meta (key, value) VALUES ('x', 'y')")
    store._conn.execute("INSERT INTO labels (key, label, kind, updated_at) VALUES ('a', 'A', 'static', 'x')")
    assert store.sync_has_data() is False


def test_wiping_takes_the_rows_the_lines_and_the_cleared_of_the_timers(store):
    for kind in CASES:
        store._conn.execute(CASES[kind][0])
    store._conn.execute("INSERT INTO timer_events (timer_id, at, recorded_at, source) VALUES (1, 'a', 'b', 'player')")
    store._conn.execute("INSERT INTO labels (key, label, kind, updated_at) VALUES ('a', 'A', 'static', 'x')")
    with store.applying_sync():
        store.sync_wipe()
    assert keys_of(store) == set() and store.sync_outbox(10) == []
    assert store._conn.execute("SELECT COUNT(*) FROM timer_events").fetchone()[0] == 0
    assert store._conn.execute("SELECT COUNT(*) FROM labels").fetchone()[0] == 1  # what HoYoLAB gave is not touched


def test_a_restore_is_a_first_sync_again(tmp_path, clock):
    # What came back is not what the account holds, and nothing says so: no line, an old cursor, and the rows this PC sent since are
    # never read by it, by their device. It asks again; a new device reads them all, as the copy may be running on another PC too.
    core = make_core(tmp_path, clock, Account())
    core.store.set_meta("sync_account", USER_ID)
    for name, value in (("sync_first", "done"), ("sync_cursor", STAMP), ("sync_last_at", STAMP), ("sync_device", "the-old-one")):
        core.store.set_meta(name, value)
    core.store._conn.execute(CASES["layouts"][0])
    core.store._conn.commit()
    copy = core.store.backup("manual", NOW)
    stage_database(copy, core.paths.settings_path, core.paths.data_dir)
    core.store.close()

    again = make_core(tmp_path, clock, Account())
    try:
        for name in ("sync_first", "sync_cursor", "sync_last_at", "sync_device"):
            assert again.store.meta(name) is None, name
        assert again.store.sync_outbox(10) == []
        assert again.store.layout("board") is not None  # what came back stays
    finally:
        again.store.close()


def test_a_start_with_no_restore_keeps_what_sync_knows(tmp_path, clock):
    core = make_core(tmp_path, clock, Account())
    core.store.set_meta("sync_first", "done")
    core.store.close()
    again = make_core(tmp_path, clock, Account())
    try:
        assert again.store.meta("sync_first") == "done"
    finally:
        again.store.close()


# ------------------------------------------------------------------------------------------------------------- the API
def test_the_question_is_asked_and_answered_through_the_api(tmp_path, clock):
    from test_api_online import Page, _saved

    _saved(tmp_path, clock)
    account = Account(THEIRS)
    with Page(tmp_path, clock, account) as page:
        page.core.store.put_layout("board", "[1]", 1, clock.now())
        assert page.view()["sync"]["needs_choice"] is False
        asked = page.client.post("/api/online/sync").json()
        assert asked["sync"] == {"on": True, "last_at": None, "needs_choice": True}
        assert page.client.get("/api/status").json()["online"]["sync"]["needs_choice"] is True

        for refused in ({}, {"choice": "maybe"}, {"choice": None}, {"choice": 1}, {"choice": ["keep"]}):
            reply = page.client.post("/api/online/first-sync", json=refused)
            assert reply.status_code == 422 and reply.json() == {"error": "Choose to keep this PC's data or to use the account's."}
        assert page.client.post("/api/online/first-sync", content=b"not json").status_code == 422
        assert page.view()["sync"]["needs_choice"] is True and page.core.store.layout("board").widgets == "[1]"

        answered = page.client.post("/api/online/first-sync", json={"choice": "use"})
        assert answered.status_code == 200
        assert answered.json()["sync"]["needs_choice"] is False and answered.json()["sync"]["last_at"] is not None
        assert page.core.store.layout("board").widgets == PHONE_BOARD
        assert page.core.settings.commission_region == "inazuma"
        assert page.client.post("/api/online/first-sync", json={"choice": "use"}).json()["sync"]["needs_choice"] is False
    assert list((tmp_path / "data" / "backups").glob("guildboard-auto-sync-*.db"))  # a copy of what was replaced


def test_keep_through_the_api_sends_this_pcs_data(tmp_path, clock):
    from test_api_online import Page, _saved

    _saved(tmp_path, clock)
    account = Account(THEIRS)
    with Page(tmp_path, clock, account) as page:
        page.core.store.put_layout("board", "[1]", 1, clock.now())
        page.client.post("/api/online/sync")
        answered = page.client.post("/api/online/first-sync", json={"choice": "keep"}).json()
        assert answered["sync"]["needs_choice"] is False
        assert page.core.store.layout("board").widgets == "[1]" and page.core.store.sync_outbox(10) == []
    assert account.rows[("layouts", '["board"]')]["data"]["widgets"] == "[1]"
    assert account.rows[("achievement_progress", "[1402]")]["deleted"] is True


async def test_keep_on_a_pc_with_only_settings_deletes_nothing_on_the_account(tmp_path, clock):
    # The question appears for a PC with no rows when one setting changed. Keep then means keeping the settings: the account's
    # rows are not this PC's to bury, since this PC never held them and made no copy of them. They come down on the next pull.
    account = Account(THEIRS)
    core = make_core(tmp_path, clock, account)
    try:
        core.update_settings({"commission_region": "sumeru"})
        await core.online.sync_turn()
        assert core.online.view()["sync"]["needs_choice"] is True
        view = await core.online.first_sync("keep")
        assert view["sync"]["needs_choice"] is False and core.store.meta("sync_first") == "done"
        for key in (("achievement_progress", "[1402]"), ("widget_data", '["resin"]'), ("layouts", '["board"]')):
            assert account.rows[key]["deleted"] is False  # nothing was buried
        assert account.rows[("settings", "commission_region")]["data"] == {"value": "sumeru"}  # the setting went up
        await core.online.sync_turn()
        assert ("layouts", '["board"]') in keys_of(core.store)  # and the rows came down
    finally:
        core.store.close()
