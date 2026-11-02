from dataclasses import replace

import pytest

from achievement_samples import NOTES_WITH_A_PART, SAMPLE_NOTES, SMALL_LIST, list_bytes
from guildboard.achievements.catalog import parse_catalog
from guildboard.achievements.notes import parse_notes
from guildboard.achievements.progress import BadChange, Progress, UnknownAchievement
from guildboard.store import ProgressRow, Store

CATALOG = parse_catalog(list_bytes(SMALL_LIST))


@pytest.fixture
def progress(store, clock):
    return Progress(store, lambda: CATALOG, SAMPLE_NOTES, clock)


def _statuses(store) -> dict[int, str]:
    return {stage: row.status for stage, row in store.progress().items()}


def test_a_part_the_notes_add_can_be_ticked(store, clock):
    with_part = Progress(store, lambda: CATALOG, NOTES_WITH_A_PART, clock)
    assert with_part.set_part(84508, 3, True) == "Ticked a part of Pirates! Argh!"
    without = Progress(store, lambda: CATALOG, SAMPLE_NOTES, clock)
    with pytest.raises(BadChange, match="This achievement has no part with this number."):
        without.set_part(84508, 3, False)


def test_undoable_is_public_and_records_what_its_writes_replace(progress, store, clock):
    # Timers and commission days record their changes through it too, so that one Undo line serves every category.
    with progress.undoable("Set the count by hand", clock.now(), counters={"82055": None}) as record:
        store.put_counter(82055, 5, clock.now())
        record["counters"]["84512"] = None  # a record can name what the block learns as it writes
        store.put_counter(84512, 2, clock.now())
    assert progress.undo() == "Set the count by hand"
    assert store.counters() == {}


def test_ticking_a_later_stage_ticks_the_earlier_ones_and_unticking_leaves_them(progress, store, clock):
    assert progress.set_status(80129, "done") == "Ticked Zoo Tycoon"
    ticked = store.progress()[80129]
    assert _statuses(store) == {80127: "done", 80128: "done", 80129: "done"}
    assert store.progress()[80129].done_at == clock.now() and store.progress()[80129].source == "player"
    clock.advance(minutes=1)
    assert progress.set_status(80129, "not_started") == "Unticked Zoo Tycoon"
    assert _statuses(store) == {80127: "done", 80128: "done", 80129: "not_started"}
    assert store.progress()[80129].done_at is None
    assert progress.undo() == "Unticked Zoo Tycoon"
    assert store.progress()[80129] == ticked
    assert progress.set_status(84508, "in_progress") == "Marked Pirates! Argh! as in progress"


def test_only_a_done_stage_is_unticked_another_is_marked_as_not_started(progress, store):
    progress.set_status(84508, "in_progress")
    assert progress.set_status(84508, "not_started") == "Marked Pirates! Argh! as not started"
    assert store.progress()[84508].status == "not_started"
    assert progress.undo() == "Marked Pirates! Argh! as not started"
    assert store.progress()[84508].status == "in_progress"
    assert progress.set_status(84512, "not_started") == "Marked For the Love of Godwin as not started"  # never changed


def test_a_group_marked_not_in_order_ticks_only_its_own_stage(store, clock):
    notes = parse_notes({"checked_against": "7.1", "counters": {}, "not_in_order": [80127], "wiki": {}})
    Progress(store, lambda: CATALOG, notes, clock).set_status(80129, "done")
    assert _statuses(store) == {80129: "done"}


def test_ticking_a_done_stage_again_keeps_the_time_it_was_done(progress, store, clock):
    progress.set_status(84512, "done")
    ticked_at = clock.now()
    clock.advance(days=1)
    assert progress.set_status(84512, "done") == "Ticked For the Love of Godwin"
    assert store.progress()[84512].done_at == ticked_at


def test_marking_a_done_stage_as_in_progress_clears_the_time_it_was_done(progress, store):
    progress.set_status(84512, "done")
    assert progress.set_status(84512, "in_progress") == "Marked For the Love of Godwin as in progress"
    assert store.progress()[84512].status == "in_progress" and store.progress()[84512].done_at is None


def test_a_tier_tick_leaves_an_earlier_stage_that_is_done_already_as_it_was(progress, store, clock):
    from_astra = ProgressRow(80127, "done", clock.now(), False, "", "astra", clock.now())  # as an import leaves it
    store.put_progress([from_astra])
    clock.advance(days=1)
    progress.set_status(80129, "done")
    assert store.progress()[80127] == from_astra
    assert store.progress()[80128].done_at == clock.now() and store.progress()[80128].source == "player"
    progress.undo()
    assert store.progress() == {80127: from_astra}


def test_pins_notes_parts_and_counts(progress, store, clock):
    assert progress.set_pinned(84508, True) == "Pinned Pirates! Argh!"
    assert progress.set_note(84508, "  Little Fei left  ") == "Changed the note on Pirates! Argh!"
    assert store.progress()[84508].pinned and store.progress()[84508].note == "Little Fei left"
    assert store.progress()[84508].status == "not_started"
    assert progress.set_part(84508, 2, True) == "Ticked a part of Pirates! Argh!"
    assert store.parts() == {84508: {2: clock.now()}}
    assert progress.set_counter(82055, 17) == "Set the count of ...Well, That Was Strange to 17"
    assert progress.set_counter(84512, 3) == "Set the count of For the Love of Godwin to 3"
    assert store.counters() == {82055: 17, 84512: 3}


def test_unpinning_an_achievement_unpins_every_stage_in_one_change_that_undo_takes_back(progress, store):
    progress.set_pinned(82055, True)
    progress.set_pinned(82056, True)
    assert progress.unpin_achievement(82055) == "Unpinned ...Well, That Was Strange"
    assert not any(store.progress()[stage].pinned for stage in (82055, 82056))
    progress.undo()
    assert all(store.progress()[stage].pinned for stage in (82055, 82056))


def test_unpinning_an_achievement_with_nothing_pinned_is_refused(progress):
    with pytest.raises(BadChange, match="Nothing of this achievement is pinned."):
        progress.unpin_achievement(82055)


def test_unpinning_an_achievement_leaves_the_rest_of_its_stages_rows(progress, store, clock):
    progress.set_status(82055, "done")
    progress.set_pinned(82057, True)
    progress.set_note(82057, "By the bridge")
    ticked, pinned = store.progress()[82055], store.progress()[82057]
    clock.advance(minutes=1)
    progress.unpin_achievement(82055)
    assert store.progress()[82055] == ticked  # a stage that was not pinned is not written
    assert store.progress()[82057] == replace(pinned, pinned=False, updated_at=clock.now())
    with pytest.raises(UnknownAchievement, match="There is no achievement with this number."):
        progress.unpin_achievement(82056)  # a later stage's id does not name the achievement


def test_a_change_to_a_stage_keeps_the_rest_of_its_row(progress, store, clock):
    progress.set_status(84508, "done")
    progress.set_note(84508, "Little Fei left")
    before = store.progress()[84508]
    clock.advance(minutes=1)
    assert progress.set_pinned(84508, True) == "Pinned Pirates! Argh!"
    assert store.progress()[84508] == replace(before, pinned=True, updated_at=clock.now())


def test_the_spaces_around_a_note_do_not_count_towards_its_length(progress, store):
    assert progress.set_note(84508, "  " + "x" * 2000 + "  ") == "Changed the note on Pirates! Argh!"
    assert store.progress()[84508].note == "x" * 2000


def test_a_part_can_be_unticked_and_each_part_change_undone(progress, store, clock):
    progress.set_part(84508, 2, True)
    ticked_at = clock.now()
    clock.advance(minutes=1)
    assert progress.set_part(84508, 2, False) == "Unticked a part of Pirates! Argh!"
    assert store.parts() == {}
    assert progress.undo() == "Unticked a part of Pirates! Argh!"
    assert store.parts() == {84508: {2: ticked_at}}
    assert progress.undo() == "Ticked a part of Pirates! Argh!"
    assert store.parts() == {}


@pytest.mark.parametrize("change, message", [
    (lambda p: p.set_status(80127, "finished"), "A status is not_started, in_progress or done."),
    (lambda p: p.set_note(84508, "x" * 2001), "A note can be at most 2,000 characters long."),
    (lambda p: p.set_part(84508, 3, True), "This achievement has no part with this number."),
    (lambda p: p.set_part(80001, 0, True), "This achievement has no part with this number."),
    (lambda p: p.set_counter(80001, 1), "This achievement counts nothing."),
    (lambda p: p.set_counter(82055, -1), "A count is a whole number from 0 to 10,000,000."),
    (lambda p: p.set_counter(82055, 10_000_001), "A count is a whole number from 0 to 10,000,000."),
])
def test_a_change_that_makes_no_sense_is_refused_with_a_sentence(progress, store, change, message):
    with pytest.raises(BadChange) as error:
        change(progress)
    assert str(error.value) == message
    assert store.progress() == {} and store.parts() == {} and store.counters() == {} and store.pop_change() is None


def test_only_listed_achievements_can_be_changed(progress):
    with pytest.raises(UnknownAchievement) as error:
        progress.set_status(12345, "done")
    assert str(error.value) == "There is no achievement with this number."


def test_undo_goes_back_in_order_and_keeps_twenty(progress, store):
    progress.set_status(80129, "done")
    progress.set_pinned(84508, True)
    progress.set_counter(82055, 17)
    assert progress.undo() == "Set the count of ...Well, That Was Strange to 17"
    assert store.counters() == {}
    assert progress.undo() == "Pinned Pirates! Argh!"
    assert 84508 not in store.progress()
    assert progress.undo() == "Ticked Zoo Tycoon"
    assert store.progress() == {}
    assert progress.undo() is None
    for n in range(22):
        progress.set_counter(82055, n)
    undone = [progress.undo() for _ in range(21)]
    assert undone[0] == "Set the count of ...Well, That Was Strange to 21"
    assert undone[19] == "Set the count of ...Well, That Was Strange to 2"
    assert undone[20] is None
    assert store.counters() == {82055: 1}


def test_undo_survives_a_restart(tmp_path, clock):
    path, backups = tmp_path / "guildboard.db", tmp_path / "backups"
    first = Store.open(path, backups, clock.now())
    Progress(first, lambda: CATALOG, SAMPLE_NOTES, clock).set_status(80129, "done")
    first.close()
    second = Store.open(path, backups, clock.now())
    assert Progress(second, lambda: CATALOG, SAMPLE_NOTES, clock).undo() == "Ticked Zoo Tycoon"
    assert second.progress() == {}
    second.close()
