"""A synced row, there and back: a row of the player's own data as JSON, and a row that came from another PC kept in the store
(the online plan, Task C3). The rows come from the account, which is the player's own, and from a phone that may be newer than
this PC: nothing here may throw, and nothing of a row that did not fit reaches the log."""
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.cloud.sync import EVENT_OF, KINDS, LOCAL_COLUMNS, Kind, apply_rows, read_row
from guildboard.store import Store
from test_sync_outbox import CASES, KINDS as OUTBOX_KINDS, UID

LATER = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()  # an edit made after every one the tests make
LONG_AGO = "2020-01-01T00:00:00+00:00"
CLOCK = json.dumps([{"id": "start-clock", "type": "clock", "w": 2, "h": 1, "settings": {}}])  # a layout of one widget


def key_of(store: Store, kind: str) -> str:
    """The key of the one row of a kind, across PCs."""
    key = CASES[kind][3]
    return key if key is not None else store._conn.execute(f"SELECT json_array(sync_key) FROM {kind}").fetchone()[0]


def arrives(kind: str, row_key: str, data: dict | None, edited_at: str = LATER, deleted: bool = False) -> dict:
    """A row as the account gives it."""
    return {
        "kind": kind, "row_key": row_key, "data": data if data is not None else {}, "deleted": deleted, "edited_at": edited_at,
        "received_at": edited_at, "device_id": "phone",
    }


@pytest.fixture
def other():
    database = Store.in_memory()
    yield database
    database.close()


def make(store: Store, kind: str) -> str:
    store._conn.execute(CASES[kind][0])
    return key_of(store, kind)


def test_the_last_session_is_the_latest_and_not_the_last_that_came(store):
    # A session from another PC takes this PC's next number, whenever it was played.
    latest = store.open_session(datetime(2026, 10, 13, 8, tzinfo=timezone.utc), False)
    store.touch_session(latest, datetime(2026, 10, 13, 9, tzinfo=timezone.utc))
    assert apply_rows(store, [arrives("sessions", '["old"]', {
        "started_at": "2026-01-01T08:00:00+00:00", "ended_at": "2026-01-01T09:00:00+00:00", "started_before_tool": 0,
    })]) == {"sessions"}
    assert store.last_session().id == latest


def test_the_kinds_are_the_eighteen_of_the_outbox():
    assert [kind.table for kind in KINDS] == OUTBOX_KINDS
    assert all(isinstance(kind, Kind) for kind in KINDS)
    assert all(kind.key for kind in KINDS)


def test_the_columns_of_the_kinds_are_the_ones_the_migration_watches(store):
    # The key of a kind is the key the triggers of schema 12 name its lines by, or lines and rows would not meet.
    from guildboard.store import _SYNCED_AT_12

    assert [(kind.table, kind.key) for kind in KINDS] == [(table, key) for table, key, _ in _SYNCED_AT_12]
    # And what the migration watches is what a row holds, but for what stays on this PC: a column that is neither would change
    # without a line for it, or leave without a change.
    for (table, key, changes), kind in zip(_SYNCED_AT_12, KINDS):
        assert set(store.sync_columns(table)) - set(LOCAL_COLUMNS) == set(key) | set(changes), table


def test_every_kind_has_an_event_the_pages_hear():
    assert set(EVENT_OF) == set(OUTBOX_KINDS)
    assert set(EVENT_OF.values()) == {
        "achievements_changed", "timers_changed", "layout_changed", "pulls_changed", "codes_changed", "characters_changed",
        "state_changed",
    }


@pytest.mark.parametrize("kind", OUTBOX_KINDS)
def test_a_row_survives_the_trip(store, other, kind):
    key = make(store, kind)
    sent = read_row(store, kind, key)
    assert sent is not None and json.loads(json.dumps(sent)) == sent  # plain JSON: what goes up is text
    assert not set(sent) & set(LOCAL_COLUMNS)

    assert apply_rows(other, [arrives(kind, key, sent)]) == {kind}
    kept = read_row(other, kind, key)
    if kind == "layouts":  # the one column that is this PC's own count: the layout is newer than any it had (below)
        assert kept["revision"] > sent["revision"]
        kept = {**kept, "revision": sent["revision"]}
    assert kept == sent
    assert other.sync_outbox(100) == []  # what another PC sent is not sent back


@pytest.mark.parametrize("kind", OUTBOX_KINDS)
def test_a_delete_reaches_the_other_store(store, other, kind):
    key = make(store, kind)
    apply_rows(other, [arrives(kind, key, read_row(store, kind, key), LONG_AGO)])
    assert read_row(other, kind, key) is not None
    assert apply_rows(other, [arrives(kind, key, None, LATER, deleted=True)]) == {kind}
    assert read_row(other, kind, key) is None
    assert other.sync_outbox(100) == []
    assert apply_rows(other, [arrives(kind, key, None, LATER, deleted=True)]) == set()  # a row that is gone is gone


def test_what_stays_on_this_pc_does_not_leave_and_is_not_overwritten(store, other):
    for kind in ("timers", "quick_timers"):
        key = make(store, kind)
        row = read_row(store, kind, key)
        assert not {"id", "notified_ready_at", "notified"} & set(row)
        apply_rows(other, [arrives(kind, key, row, LONG_AGO)])
    # The other PC sent a reminder for its copy, and the id it numbers its rows by: a newer edit from the first leaves both.
    other._conn.execute("UPDATE timers SET notified_ready_at = '2026-10-13T08:00:00+00:00'")
    other._conn.execute("UPDATE quick_timers SET notified = 1")
    ids = [other._conn.execute(f"SELECT id FROM {table}").fetchone()[0] for table in ("timers", "quick_timers")]
    key = key_of(store, "timers")
    # Even a row that names them, as a changed client or a phone's own numbers might, cannot move them.
    changed = {**read_row(store, "timers", key), "name": "Teapot, again", "id": 777, "notified_ready_at": "2000-01-01T00:00:00+00:00"}
    assert apply_rows(other, [arrives("timers", key, changed)]) == {"timers"}
    assert other._conn.execute("SELECT name, notified_ready_at FROM timers").fetchone() == ("Teapot, again", "2026-10-13T08:00:00+00:00")
    assert other._conn.execute("SELECT notified FROM quick_timers").fetchone()[0] == 1
    assert [other._conn.execute(f"SELECT id FROM {table}").fetchone()[0] for table in ("timers", "quick_timers")] == ids


def test_applying_a_row_again_changes_nothing(store, other):
    key = make(store, "achievement_progress")
    row = arrives("achievement_progress", key, read_row(store, "achievement_progress", key))
    assert apply_rows(other, [row]) == {"achievement_progress"}
    assert apply_rows(other, [row]) == set()  # the same row, read again in the overlap of a pull: no page need hear of it
    assert apply_rows(other, [arrives("achievement_progress", key, {**row["data"], "status": "done"})]) == {"achievement_progress"}


def test_a_local_edit_that_is_newer_stays(store, other):
    key = make(store, "achievement_progress")
    apply_rows(other, [arrives("achievement_progress", key, read_row(store, "achievement_progress", key), LONG_AGO)])
    time.sleep(0.01)
    other._conn.execute("UPDATE achievement_progress SET status = 'not_started'")  # an edit here, not yet sent
    [pending] = other.sync_outbox(10)

    old = arrives("achievement_progress", key, {**read_row(store, "achievement_progress", key), "status": "done"}, LONG_AGO)
    assert apply_rows(other, [old]) == set()
    assert read_row(other, "achievement_progress", key)["status"] == "not_started"
    assert other.sync_outbox(10) == [pending]  # and it still goes up

    # An edit at the very same time stays too: this PC's line goes up later, and the account takes the later arrival.
    assert apply_rows(other, [{**old, "edited_at": pending.edited_at}]) == set()
    assert read_row(other, "achievement_progress", key)["status"] == "not_started"

    # A delete from the other PC that is older than the edit here does not take the row either.
    assert apply_rows(other, [arrives("achievement_progress", key, None, LONG_AGO, deleted=True)]) == set()
    assert read_row(other, "achievement_progress", key) is not None

    # One that is newer replaces it.
    assert apply_rows(other, [{**old, "edited_at": LATER}]) == {"achievement_progress"}
    assert read_row(other, "achievement_progress", key)["status"] == "done"


def test_a_layout_applied_gets_a_higher_revision(store, other):
    # A page that holds the layout it read is refused when it saves over a newer one, by its revision: a layout from another
    # PC has to be newer than any this PC had, whatever number the other PC counted.
    key = make(store, "layouts")
    other._conn.execute("INSERT INTO layouts (place, widgets, revision, updated_at) VALUES ('board', '[]', 9, '2026-10-12T08:00:00+00:00')")
    row = read_row(store, "layouts", key)
    assert row["revision"] == 1
    assert apply_rows(other, [arrives("layouts", key, {**row, "widgets": CLOCK})]) == {"layouts"}
    assert other.layout("board").revision == 10 and other.layout("board").widgets == CLOCK
    # And on a PC that had none, one after the other's.
    third = Store.in_memory()
    try:
        apply_rows(third, [arrives("layouts", key, {**row, "revision": 4})])
        assert third.layout("board").revision == 5
    finally:
        third.close()
    # The same layout again is no change, and gets no new number.
    assert apply_rows(other, [arrives("layouts", key, {**row, "widgets": CLOCK, "revision": 3})]) == set()
    assert other.layout("board").revision == 10


def test_a_pre_set_timer_meets_its_twin_by_its_key(store, other):
    from guildboard.store import TimerRow

    now = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    for device in (store, other):
        device.add_timer(TimerRow(0, "parametric", "", "", "", None, True, None, None, now, now))
    store._conn.execute("UPDATE timers SET bell = 0")
    key = '["preset:parametric"]'
    row = read_row(store, "timers", key)
    assert row["sync_key"] == "preset:parametric" and row["bell"] == 0
    assert apply_rows(other, [arrives("timers", key, row)]) == {"timers"}
    assert other._conn.execute("SELECT COUNT(*), MIN(bell) FROM timers").fetchone() == (1, 0)


def test_the_key_of_the_row_decides_and_not_a_key_in_the_data(store, other):
    key = make(store, "achievement_progress")
    row = {**read_row(store, "achievement_progress", key), "stage_id": 99}
    assert apply_rows(other, [arrives("achievement_progress", key, row)]) == {"achievement_progress"}
    assert [r[0] for r in other._conn.execute("SELECT stage_id FROM achievement_progress")] == [1402]


def test_a_column_this_pc_does_not_know_is_left_out(store, other):
    # A newer phone, or a newer Guild Board, may have a column more.
    key = make(store, "achievement_progress")
    row = {**read_row(store, "achievement_progress", key), "colour": "gold", "notes_since": 3}
    assert apply_rows(other, [arrives("achievement_progress", key, row)]) == {"achievement_progress"}
    assert read_row(other, "achievement_progress", key) == read_row(store, "achievement_progress", key)


def test_a_column_this_pc_has_and_the_row_lacks_keeps_what_it_had(store, other):
    # An older Guild Board's row has a column less: the update leaves the column it did not send as it was.
    key = make(store, "achievement_progress")
    apply_rows(other, [arrives("achievement_progress", key, read_row(store, "achievement_progress", key), LONG_AGO)])
    other._conn.execute("UPDATE achievement_progress SET note = 'in the second chest'")
    other.sync_sent(other.sync_outbox(10)[0])
    older = {name: value for name, value in read_row(store, "achievement_progress", key).items() if name != "note"}
    assert apply_rows(other, [arrives("achievement_progress", key, {**older, "status": "done"})]) == {"achievement_progress"}
    assert read_row(other, "achievement_progress", key)["note"] == "in the second chest"


@pytest.mark.parametrize(
    "kind", ["from_the_phone", "gallery_favourites", "meta", "raw_responses", "wishes", "ledger_entries", "sync_outbox", "sync_gate",
             "sqlite_master", "timer_events", "char_notices", "Timers", "timers ", "", "../x", "achievement_progress; DROP TABLE meta"],
)
def test_an_unknown_kind_is_ignored(store, kind):
    # A newer phone has kinds this PC does not know; and a name that is a table here but no kind is not to be written.
    before = [tuple(row) for row in store._conn.execute("SELECT name FROM sqlite_master ORDER BY name")]
    store.set_meta("kind", "live")
    assert apply_rows(store, [arrives(kind, "[1]", {"value": "x"}), arrives(kind, "[1]", None, deleted=True)]) == set()
    assert [tuple(row) for row in store._conn.execute("SELECT name FROM sqlite_master ORDER BY name")] == before
    assert store.meta("kind") == "live"
    assert read_row(store, kind, "[1]") is None


def test_a_good_row_beside_an_unknown_kind_is_kept(store, other):
    key = make(store, "layouts")
    rows = [arrives("from_the_phone", "[1]", {"x": 1}), arrives("layouts", key, read_row(store, "layouts", key))]
    assert apply_rows(other, rows) == {"layouts"}


SECRET = "a-note-the-log-must-not-hold"


def _bad_rows(store: Store, good_key: str) -> list[tuple[str, dict]]:
    """Rows that do not fit their table, one way each, with a sentinel in each for the log."""
    base = read_row(store, "achievement_progress", good_key)
    return [
        ("a status the table refuses", arrives("achievement_progress", '[5]', {**base, "status": "bogus", "note": SECRET})),
        ("a column the table needs, missing", arrives("achievement_progress", '[6]', {"note": SECRET})),
        ("a key of the wrong length", arrives("achievement_progress", '[7, 8]', {**base, "note": SECRET})),
        ("a key that is no JSON", arrives("achievement_progress", f'not json {SECRET}', {**base, "note": SECRET})),
        ("a key that is no list", arrives("achievement_progress", '{"stage_id": 9}', {**base, "note": SECRET})),
        ("a key of a list", arrives("achievement_progress", '[[10]]', {**base, "note": SECRET})),
        ("a key of nothing", arrives("achievement_progress", '[null]', {**base, "note": SECRET})),
        ("data that is no object", arrives("achievement_progress", '[11]', [SECRET])),
        ("data that is text", arrives("achievement_progress", '[12]', SECRET)),
        ("a value that is a list", arrives("achievement_progress", '[13]', {**base, "note": [SECRET]})),
        ("a value that is an object", arrives("achievement_progress", '[14]', {**base, "note": {"x": SECRET}})),
        ("data that is null", {**arrives("achievement_progress", '[15]', None), "data": None}),
        ("a row with no data", {k: v for k, v in arrives("achievement_progress", '[16]', None).items() if k != "data"}),
        ("a time that is no time", arrives("achievement_progress", '[17]', {**base, "note": SECRET}, edited_at="when i feel like it")),
        ("no time at all", {k: v for k, v in arrives("achievement_progress", '[18]', {**base, "note": SECRET}).items() if k != "edited_at"}),
        ("a time of the wrong type", arrives("achievement_progress", '[19]', {**base, "note": SECRET}, edited_at=5)),  # type: ignore[arg-type]
        ("a kind that is no text", arrives(7, '[20]', {**base, "note": SECRET})),  # type: ignore[arg-type]
        ("a row that is no row", SECRET),  # type: ignore[list-item]
        ("a key that is no text", arrives("achievement_progress", 5, {**base, "note": SECRET})),  # type: ignore[arg-type]
    ]


def test_a_row_that_does_not_fit_the_table_is_skipped_and_logged_without_its_content(store, other, caplog):
    good = make(store, "achievement_progress")
    good_row = arrives("achievement_progress", good, read_row(store, "achievement_progress", good))
    bad = _bad_rows(store, good)
    caplog.set_level(logging.DEBUG)
    # The good rows come before, between and after the bad ones: each is judged alone, and none of the bad takes a good one. A
    # layout whose time is none is as bad as the others (it would break both layouts), and the one beside it is kept.
    rows = [good_row] + [row for _, row in bad[:9]] + [
        arrives("layouts", '["overlay"]', {"widgets": "[]", "revision": 1, "updated_at": f"x {SECRET}"}),
        arrives("layouts", '["board"]', {"widgets": "[]", "revision": 1, "updated_at": "2026-10-13T08:00:00+00:00"}),
    ]
    rows += [row for _, row in bad[9:]]
    assert apply_rows(other, rows) == {"achievement_progress", "layouts"}
    assert [r[0] for r in other._conn.execute("SELECT stage_id FROM achievement_progress")] == [1402]
    assert [r[0] for r in other._conn.execute("SELECT place FROM layouts")] == ["board"]
    assert other.sync_outbox(10) == []
    assert SECRET not in caplog.text and "bogus" not in caplog.text
    assert "not json" not in caplog.text
    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert warnings and all(record.name == "guildboard.cloud.sync" for record in warnings)


@pytest.mark.parametrize("which", range(19))
def test_each_row_that_does_not_fit_leaves_the_store_as_it_was(store, other, which):
    good = make(store, "achievement_progress")
    label, row = _bad_rows(store, good)[which]
    before = [tuple(r) for r in other._conn.execute("SELECT * FROM achievement_progress")]
    assert apply_rows(other, [row]) == set(), label
    assert [tuple(r) for r in other._conn.execute("SELECT * FROM achievement_progress")] == before, label
    assert other._conn.execute("SELECT applying FROM sync_gate").fetchone()[0] == 0, label


def _read_everything(store: Store, clock) -> None:
    """Every reader of the kinds' rows, as the pages and the loops call them: none may fail on a row that sync kept."""
    from guildboard.board.layouts import Layouts

    store.progress(), store.parts(), store.counters(), store.appearances()
    store.timers(), store.timer_events(), store.quick_timers(), store.last_session()
    layouts = Layouts(store, clock)
    layouts.get("board"), layouts.data("resin")
    store.pulls_account(UID), store.wishlist(UID), store.gift_code_rows(str(UID))
    store.focus(UID), store.char_plans(UID), store.card_edits(UID), store.ticks(UID, date(2020, 1, 1)), store.held(UID)
    store.theater_elements(UID, "2026-10")


# A row of a kind with one column that no reader of this PC can read: a time that is none, a time with no zone (the text order of
# the store's times is their order only in UTC), a JSON text that is not JSON or not the kind of value its reader takes.
UNREADABLE = [
    ("timers", "created_at", "x"),
    ("timers", "updated_at", "2026-10-13T08:00:00"),
    ("timers", "ready_override", "soon"),
    ("timers", "rule", "not json"),
    ("timers", "rule", '{"kind": "monthly"}'),
    ("timers", "steps", "two"),
    ("sessions", "started_at", "x"),
    ("sessions", "ended_at", "2026-10-13T09:00:00"),
    ("layouts", "updated_at", "x"),
    ("layouts", "widgets", "not json"),
    ("layouts", "widgets", '{"id": "clock"}'),
    ("layouts", "widgets", '[{"id": "clock", "type": "clock"}]'),
    ("char_plans", "updated_at", "2026-10-13T08:00:00"),
    ("char_plans", "plan", "not json"),
    ("char_plans", "plan", "[1]"),
    ("char_plans", "plan", '{"level": NaN}'),
    ("achievement_progress", "done_at", "yesterday"),
    ("achievement_parts", "done_at", "2026-10-13"),
    ("achievement_counters", "value", "three"),
    ("achievement_counters", "value", True),  # true is no whole number, as _key_values has it
    ("commission_log", "at", "x"),
    ("quick_timers", "seconds", "60"),
    ("quick_timers", "ready_at", "x"),
    ("widget_data", "data", "not json"),
    ("widget_data", "data", json.dumps("x" * 20_001)),
    ("widget_data", "data", '{"a": "' + chr(92) + 'ud800"}'),  # a real backslash in the column: a lone surrogate once it is read
    ("pulls_accounts", "corrections", "[]"),
    ("pulls_accounts", "points", '{"weapon": {"points": 1, "at": "x"}}'),
    ("pulls_accounts", "points", '{"weapon": {"points": 1, "at": "2026-10-13T08:00:00"}}'),
    ("pulls_accounts", "events_typed", "not json"),
    ("pulls_accounts", "balance_set_at", "x"),
    ("wishlist", "about", "soon"),
    ("wishlist", "created_at", "x"),
    ("gift_codes", "at", "x"),
    ("gift_codes", "primogems", "60"),
    ("char_card_edits", "edits", "[]"),
    ("char_ticks", "done_at", "x"),
    ("char_held", "amount", "5"),
    ("char_theater", "elements", '{"pyro": 1}'),
    ("char_theater", "elements", "[1, 2, 3]"),
]


@pytest.mark.parametrize(("kind", "column", "value"), UNREADABLE, ids=[f"{kind}-{column}-{n}" for n, (kind, column, _) in enumerate(UNREADABLE)])
def test_a_row_whose_times_or_json_cannot_be_read_is_left_out(store, other, clock, kind, column, value):
    key = make(store, kind)
    assert apply_rows(other, [arrives(kind, key, {**read_row(store, kind, key), column: value})]) == set()
    assert read_row(other, kind, key) is None
    _read_everything(other, clock)


@pytest.mark.parametrize(("kind", "row_key"), [
    ("commission_log", '[1402,"13 October"]'),
    ("commission_log", '[1402,"2026-02-30"]'),
    ("char_ticks", f'[{UID},"yesterday","domain"]'),
    ("char_theater", f'[{UID},"2026-13"]'),
    ("char_theater", f'[{UID},"October"]'),
    ("achievement_progress", '["1402"]'),
    ("timers", "[1402]"),
])
def test_a_row_whose_key_cannot_be_read_is_left_out(store, other, clock, kind, row_key):
    # The days and months in a key are read as dates too, and a key column takes the kind of value it was made for.
    good = make(store, kind)
    assert apply_rows(other, [arrives(kind, row_key, read_row(store, kind, good))]) == set()
    _read_everything(other, clock)


@pytest.mark.parametrize("depth", [1_200, 100_000])
def test_a_layout_nested_too_deep_is_left_out(store, other, clock, depth):
    # Python's JSON reader takes the first, or refuses it, and the check of the widgets walks what it took past Python's own
    # limit; the second it refuses. Either way the row alone is left out, and nothing escapes the batch.
    key = make(store, "layouts")
    nested = "[" * depth + "]" * depth
    row = arrives("layouts", key, {**read_row(store, "layouts", key), "widgets": f'[{{"id": "a", "type": "clock", "w": 1, "h": 1, "settings": {{"x": {nested}}}}}]'})
    assert apply_rows(other, [row]) == set()
    _read_everything(other, clock)


def test_json_with_a_real_emoji_is_kept(store, other):
    # json.dumps writes an emoji as a surrogate pair, which reads back as one character that UTF-8 can hold: it stays accepted.
    key = make(store, "widget_data")
    text = json.dumps({"a": chr(0x1F600)})
    assert chr(92) + "ud83d" in text
    assert apply_rows(other, [arrives("widget_data", key, {**read_row(store, "widget_data", key), "data": text})]) == {"widget_data"}


def test_the_times_of_a_row_are_kept_as_this_pc_writes_them(store, other):
    # The store's times are UTC to the second, so that their text sorts in their order: a time from elsewhere is kept that way.
    key = make(store, "sessions")
    row = {**read_row(store, "sessions", key), "started_at": "2026-10-13T10:00:00.5+02:00", "ended_at": "2026-10-13T09:00:00Z"}
    assert apply_rows(other, [arrives("sessions", key, row)]) == {"sessions"}
    assert other._conn.execute("SELECT started_at, ended_at FROM sessions").fetchone() == (
        "2026-10-13T08:00:00+00:00", "2026-10-13T09:00:00+00:00",
    )
    assert other.last_session().started_at == datetime(2026, 10, 13, 8, tzinfo=timezone.utc)


def test_a_layout_is_kept_with_the_keys_of_its_timers(store, other):
    # A layout goes up with its timers named by their keys, which are longer than this PC's numbers: a widget that was within its
    # size here is within it there too.
    chosen = [f"{number:032x}" for number in range(60)]
    widgets = json.dumps([{"id": "start-timers", "type": "timers", "w": 4, "h": 3, "settings": {"chosen": chosen}}])
    key = make(store, "layouts")
    assert apply_rows(other, [arrives("layouts", key, {**read_row(store, "layouts", key), "widgets": widgets})]) == {"layouts"}
    assert other.layout("board").widgets == widgets


def test_two_pre_sets_of_one_name_under_two_keys_are_one_row_that_fits_or_is_skipped(store, other):
    # Both would break the unique pre-set: the second is skipped, the first stays.
    from guildboard.store import TimerRow

    now = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    other.add_timer(TimerRow(0, "parametric", "", "", "", None, True, None, None, now, now))
    row = {"preset": "parametric", "name": "", "place": "", "rule": "", "steps": None, "bell": 1, "ready_override": None,
           "created_at": "x", "updated_at": "y", "sync_key": "some-other-key"}
    assert apply_rows(other, [arrives("timers", '["some-other-key"]', row)]) == set()
    assert other._conn.execute("SELECT COUNT(*) FROM timers").fetchone()[0] == 1


def test_the_gate_is_open_again_after_a_batch_that_threw_nothing_and_after_one_that_did(store, other):
    key = make(store, "layouts")
    apply_rows(other, [arrives("layouts", key, read_row(store, "layouts", key))])
    assert other._conn.execute("SELECT applying FROM sync_gate").fetchone()[0] == 0
    other._conn.execute("UPDATE layouts SET widgets = '[3]'")
    assert len(other.sync_outbox(10)) == 1  # the player's own edit is a line again


def test_a_row_is_read_with_its_columns_and_nothing_else(store):
    key = make(store, "gift_codes")
    assert read_row(store, "gift_codes", key) == {
        "uid": str(UID), "code": "ABC", "result": "ok", "primogems": 60, "source": "player", "at": "2026-10-13T08:00:00+00:00",
    }
    assert read_row(store, "gift_codes", '["1","NOPE"]') is None  # a row that is not there
    for odd in ("", "x", "[]", "[1]", '["a","b","c"]', "{}", "null", '[["a"],"b"]', '[null, "b"]', '[{"a": 1}, "b"]'):
        assert read_row(store, "gift_codes", odd) is None, odd
    assert read_row(store, "from_the_phone", key) is None
