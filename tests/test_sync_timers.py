"""A timer and its Cleared cross together. A timer's ready time is worked out from its latest Cleared and its visits are counted
from them, so a timer that reached another PC without them would read as never cleared. They are no kind of their own: every
Cleared and every undo of one writes the timer's row too, and the row carries them, so the newest edit wins for them as for it."""
import json
from datetime import timedelta

import pytest

from guildboard.achievements.catalog import bundled_raw, parse_catalog
from guildboard.achievements.notes import load_notes
from guildboard.achievements.progress import Progress
from guildboard.board.layouts import Layouts
from guildboard.cloud.sync import apply_rows, read_row
from guildboard.store import Store
from guildboard.timers.presets import load_presets
from guildboard.timers.rules import Rule
from guildboard.timers.timers import Timers

CATALOG = parse_catalog(bundled_raw())
LATER = "2099-01-01T00:00:00+00:00"
A_TIME = "2026-10-13T07:00:00+00:00"


class Pc:
    """A store with its timers, on the clock of the test."""

    def __init__(self, clock):
        self.store = Store.in_memory()
        self.progress = Progress(self.store, lambda: CATALOG, load_notes(), clock)
        self.timers = Timers(self.store, clock, self.progress, load_presets(), lambda: "os_euro", lambda: "3_days")
        self.clock = clock

    def key(self) -> str:
        return self.store._conn.execute("SELECT json_array(sync_key) FROM timers").fetchone()[0]

    def state(self, timer_id: int | None = None) -> str:
        timer_id = timer_id if timer_id is not None else self.only()
        row = self.store.timer(timer_id)
        return self.timers.state(row, self.store.timer_events(timer_id), self.clock.now())

    def only(self) -> int:
        return self.store.timers()[0].id

    def lines(self) -> list[dict]:
        """What this PC would send, and has now sent, as rows from the account."""
        rows = []
        for line in self.store.sync_outbox(100):
            rows.append({
                "kind": line.kind, "row_key": line.row_key, "data": read_row(self.store, line.kind, line.row_key) or {},
                "deleted": line.deleted, "edited_at": line.edited_at, "received_at": line.edited_at, "device_id": "other",
            })
            self.store.sync_sent(line)
        return rows


@pytest.fixture
def one(clock):
    pc = Pc(clock)
    yield pc
    pc.store.close()


@pytest.fixture
def two(clock):
    pc = Pc(clock)
    yield pc
    pc.store.close()


def teapot(one: Pc, two: Pc, steps: int | None = None) -> int:
    """A timer of the player's own, on both PCs."""
    timer_id, _ = one.timers.create("Teapot", "", Rule("hours", 24), steps)
    apply_rows(two.store, one.lines())
    return timer_id


def test_a_cleared_timer_runs_on_the_other_pc(one, two, clock):
    timer_id = teapot(one, two)
    assert two.state() == "ready"

    one.timers.cleared(timer_id)
    assert apply_rows(two.store, one.lines()) == {"timers"}

    assert two.state() == "running"
    row = two.store.timer(two.only())
    assert two.timers.ready_at(row, two.store.timer_events(row.id)) == clock.now() + timedelta(hours=24)
    assert two.store.sync_outbox(10) == []  # what came from the account is not sent back


def test_the_time_the_player_gave_crosses_with_it(one, two, clock):
    timer_id = teapot(one, two)
    earlier = clock.now() - timedelta(hours=30)
    one.timers.cleared(timer_id, earlier)
    apply_rows(two.store, one.lines())
    [event] = two.store.timer_events(two.only())
    assert (event.at, event.recorded_at, event.source) == (earlier, clock.now(), "player")
    assert two.state() == "ready"  # 30 hours ago, on a 24 hour timer


def test_the_visits_cross_too(one, two):
    timer_id = teapot(one, two, steps=3)
    one.timers.cleared(timer_id)
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert len(two.store.timer_events(two.only())) == 2
    assert two.state() == "running"
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert two.state() == "finished"


def test_an_undo_of_a_cleared_reaches_the_other_pc(one, two):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert two.state() == "running"

    assert one.progress.undo() is not None
    assert apply_rows(two.store, one.lines()) == {"timers"}
    assert two.state() == "ready"
    assert two.store.timer_events(two.only()) == []


def test_the_newest_edit_wins_for_the_cleared_as_for_the_row(one, two, clock):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    going_up = one.lines()
    clock.advance(seconds=60)
    two.timers.cleared(two.only())  # later, and not sent yet: the line of this PC stays, and goes up to say so
    before = two.store.timer_events(two.only())

    assert apply_rows(two.store, going_up) == set()
    assert two.store.timer_events(two.only()) == before
    assert [line.kind for line in two.store.sync_outbox(10)] == ["timers"]


def test_a_timer_new_to_this_pc_brings_its_cleared(one, two):
    timer_id, _ = one.timers.create("Teapot", "", Rule("hours", 24), None)
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert two.state() == "running"


def test_a_pre_set_meets_its_twin_with_the_cleared(one, two):
    timer_id, _ = one.timers.add_preset("teapot.jade_field")
    two.timers.add_preset("teapot.jade_field")  # the same pre-set, made on the other PC: one row, by its key
    two.lines()  # gone up, so that the Cleared is the newest edit, whichever millisecond it falls in
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert two.state() == "running"


def test_a_removed_timer_leaves_no_cleared_behind(one, two):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert len(two.store.timer_events()) == 1

    one.timers.remove(timer_id)
    assert apply_rows(two.store, one.lines()) == {"timers"}
    assert two.store.timers() == [] and two.store.timer_events() == []


def test_a_row_carries_the_newest_fifty(one, two, clock):
    timer_id = teapot(one, two)
    now = clock.now()
    for back in range(60):
        one.store.add_timer_event(timer_id, now - timedelta(hours=back), now, "player")
    one.store._conn.execute("UPDATE timers SET name = 'Teapot, again'")
    [row] = one.lines()
    assert len(row["data"]["cleared"]) == 50
    assert row["data"]["cleared"][-1]["at"] == now.isoformat()

    apply_rows(two.store, [row])
    assert len(two.store.timer_events(two.only())) == 50
    assert max(event.at for event in two.store.timer_events(two.only())) == now
    assert two.state() == "running"


def test_a_row_is_sent_with_the_cleared_and_no_local_number(one, two, clock):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    [row] = one.lines()
    assert row["data"]["cleared"] == [
        {"at": clock.now().isoformat(), "recorded_at": clock.now().isoformat(), "source": "player"},
    ]


def test_the_same_cleared_again_changes_nothing(one, two):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    rows = one.lines()
    assert apply_rows(two.store, rows) == {"timers"}
    ids = [event.id for event in two.store.timer_events(two.only())]
    assert apply_rows(two.store, [{**row, "edited_at": LATER} for row in rows]) == set()
    assert [event.id for event in two.store.timer_events(two.only())] == ids


def test_the_cleared_alone_are_a_change(one, two):
    teapot(one, two)
    data = read_row(one.store, "timers", one.key())
    arrival = {"kind": "timers", "row_key": one.key(), "deleted": False, "edited_at": LATER, "received_at": LATER, "device_id": "x"}
    data["cleared"] = [{"at": A_TIME, "recorded_at": A_TIME, "source": "player"}]
    assert apply_rows(two.store, [{**arrival, "data": data}]) == {"timers"}
    assert [event.source for event in two.store.timer_events(two.only())] == ["player"]


def test_a_row_that_says_nothing_of_them_keeps_what_the_timer_had(one, two):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    [row] = one.lines()
    apply_rows(two.store, [row])

    data = {key: value for key, value in row["data"].items() if key != "cleared"} | {"name": "Teapot, again"}
    assert apply_rows(two.store, [{**row, "data": data, "edited_at": LATER}]) == {"timers"}
    assert two.store.timer(two.only()).name == "Teapot, again"
    assert len(two.store.timer_events(two.only())) == 1


@pytest.mark.parametrize("odd", [
    "soon", 7, {"at": A_TIME}, [1], [{"at": "soon", "recorded_at": A_TIME, "source": "player"}],
    [{"at": A_TIME, "recorded_at": 7, "source": "player"}], [{"at": A_TIME, "recorded_at": A_TIME}],
    [{"at": A_TIME, "recorded_at": A_TIME, "source": 7}],
])
def test_cleared_that_do_not_fit_leave_the_timer_as_it_was(one, two, odd):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    [row] = one.lines()
    apply_rows(two.store, [row])
    before = two.store.timer_events(two.only())

    data = {**row["data"], "name": "Teapot, again", "cleared": odd}
    assert apply_rows(two.store, [{**row, "data": data, "edited_at": LATER}]) == set()
    assert two.store.timer(two.only()).name == "Teapot"
    assert two.store.timer_events(two.only()) == before


def test_a_first_sync_that_sends_this_pc_sends_the_cleared(one, two):
    timer_id = teapot(one, two)
    one.timers.cleared(timer_id)
    one.lines()
    one.store.sync_stamp_all()
    rows = one.lines()
    with two.store.applying_sync():  # Use the account's data, on the other PC
        two.store.sync_wipe()
        apply_rows(two.store, rows)
    assert two.state() == "running"
    assert two.store.sync_outbox(10) == []


def test_a_timer_never_cleared_says_so(one, two):
    teapot(one, two)
    assert read_row(one.store, "timers", one.key())["cleared"] == []


def test_a_row_that_came_ends_the_undo_history(one, two):
    # An undo puts back what its change replaced: over this row now, whatever it holds, and then it goes up as the newest edit.
    timer_id = teapot(one, two)
    twin = two.only()
    two.timers.set_bell(twin, False)
    two.lines()
    one.timers.cleared(timer_id)
    apply_rows(two.store, one.lines())
    assert two.state() == "running"
    assert two.progress.undo() is None
    assert two.state() == "running"  # the Cleared that came stays
    assert two.store.sync_outbox(10) == []


def test_a_row_that_undo_does_not_touch_leaves_the_history(one, two):
    timer_id = teapot(one, two)
    two.timers.set_bell(two.only(), False)
    two.lines()
    one.store.put_layout("board", "[]", 1, one.clock.now())
    one.store.drop_timer(timer_id)
    rows = [row for row in one.lines() if row["kind"] == "layouts"]
    assert apply_rows(two.store, rows) == {"layouts"}
    assert two.progress.undo() is not None


def test_use_the_accounts_data_ends_the_undo_history(one, two):
    # The history is of rows that are gone: its undo would put an old timer back beside the account's, or over a pre-set's.
    timer_id = teapot(one, two)
    one.lines()
    two.timers.set_bell(two.only(), False)
    two.lines()
    one.timers.cleared(timer_id)
    one.store.sync_stamp_all()
    with two.store.applying_sync():
        two.store.sync_wipe()
        apply_rows(two.store, one.lines())
    assert two.progress.undo() is None
    assert len(two.store.timers()) == 1 and two.store.sync_outbox(10) == []


def pinned(pc: Pc) -> dict:
    """The Board's One timer widget, and the Timers widget's chosen ones, as a page reads them on this PC."""
    widgets = {widget["type"]: widget for widget in Layouts(pc.store, pc.clock).get("board")["widgets"]}
    return {"timer": widgets["one-timer"]["settings"]["timer"], "chosen": widgets["timers"]["settings"]["chosen"]}


def board_of(timer_id: int) -> list[dict]:
    return [
        {"id": "pin-1", "type": "one-timer", "w": 2, "h": 2, "settings": {"timer": timer_id}},
        {"id": "list-1", "type": "timers", "w": 4, "h": 3, "settings": {"show": "chosen", "chosen": [timer_id]}},
    ]


def test_a_layout_names_the_same_timer_on_the_other_pc(one, two):
    # The numbers are each PC's own, so a One timer widget would show another timer there, and its Cleared would clear that one.
    two.timers.create("Only on the second PC", "", Rule("hours", 24), None)
    two.lines()
    timer_id = teapot(one, two)
    twin = max(row.id for row in two.store.timers())
    assert twin != timer_id
    Layouts(one.store, one.clock).save("board", 0, board_of(timer_id))
    assert apply_rows(two.store, one.lines()) == {"layouts"}
    assert pinned(two) == {"timer": twin, "chosen": [twin]}
    assert pinned(one) == {"timer": timer_id, "chosen": [timer_id]}  # the PC it was made on goes on by its own numbers


def test_a_layout_goes_up_with_no_number_of_this_pc(one, two):
    timer_id = teapot(one, two)
    key = json.loads(one.key())[0]
    Layouts(one.store, one.clock).save("board", 0, board_of(timer_id))
    [row] = [row for row in one.lines() if row["kind"] == "layouts"]
    widgets = {widget["type"]: widget["settings"] for widget in json.loads(row["data"]["widgets"])}
    assert widgets["one-timer"] == {"timer": key}
    assert widgets["timers"]["chosen"] == [key]


def test_a_timer_that_comes_after_its_layout_is_found(one, two):
    timer_id, _ = one.timers.create("Teapot", "", Rule("hours", 24), None)
    timer_row = one.lines()
    Layouts(one.store, one.clock).save("board", 0, board_of(timer_id))
    apply_rows(two.store, one.lines())
    assert pinned(two)["chosen"] == [json.loads(one.key())[0]]  # no number yet: the page shows none, and nothing else
    apply_rows(two.store, timer_row)
    assert pinned(two) == {"timer": two.only(), "chosen": [two.only()]}


def test_a_timer_that_is_gone_is_named_by_nothing(one, two):
    timer_id = teapot(one, two)
    Layouts(one.store, one.clock).save("board", 0, board_of(timer_id + 1000))
    [row] = [row for row in one.lines() if row["kind"] == "layouts"]
    assert json.loads(row["data"]["widgets"])[0]["settings"]["timer"] is None


def test_the_apps_own_pre_sets_have_their_key_on_a_new_pc_and_meet_the_accounts(one, two):
    # A new PC makes the default pre-sets with no line for sync. Without a key the account's row of one is refused, as the pre-set
    # is there already, and a second PC could take none of them.
    one.timers.ensure_defaults(CATALOG)
    two.timers.ensure_defaults(CATALOG)
    keys = [key for (key,) in two.store._conn.execute("SELECT sync_key FROM timers")]
    assert keys and all(key is not None and key.startswith("preset:") for key in keys)
    assert two.store.sync_outbox(10) == []  # no line: they are the app's rows, and not the player's change

    timer_id = one.only()
    one.timers.cleared(timer_id)
    assert "timers" in apply_rows(two.store, one.lines())
    twin = [row for row in two.store.timers() if row.preset == one.store.timer(timer_id).preset]
    assert len(twin) == 1 and two.state(twin[0].id) == "running"
