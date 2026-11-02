import re
from datetime import datetime, timedelta, timezone

import pytest

from guildboard.achievements.catalog import bundled_raw, parse_catalog
from guildboard.achievements.notes import load_notes
from guildboard.achievements.progress import Progress
from guildboard.store import ProgressRow
from guildboard.timers.presets import load_presets
from guildboard.timers.rules import Rule
from guildboard.timers.timers import TimerConflict, TimerError, Timers, UnknownTimer

UTC = timezone.utc
CATALOG = parse_catalog(bundled_raw())


@pytest.fixture
def progress(store, clock):
    return Progress(store, lambda: CATALOG, load_notes(), clock)


@pytest.fixture
def fishing():
    return {"rule": "3_days"}


@pytest.fixture
def timers(store, clock, progress, fishing):
    return Timers(store, clock, progress, load_presets(), lambda: "os_euro", lambda: fishing["rule"])


def _read(timers, store, timer_id, now):
    """The timer's state and ready time, as the page will read them."""
    row, events = store.timer(timer_id), store.timer_events(timer_id)
    return timers.state(row, events, now), timers.ready_at(row, events)


def test_cleared_starts_the_countdown_and_a_running_timer_starts_again(timers, store, clock):
    now = clock.now()
    timer_id, label = timers.create("Walk the dog", "", Rule("hours", 12), None)
    assert label == "Added the timer Walk the dog"
    assert _read(timers, store, timer_id, now) == ("ready", None)
    assert timers.cleared(timer_id) == "Cleared Walk the dog"
    assert _read(timers, store, timer_id, now) == ("running", now + timedelta(hours=12))
    clock.advance(hours=1)
    timers.cleared(timer_id)  # a second one: it starts again, and counts again
    assert _read(timers, store, timer_id, clock.now()) == ("running", now + timedelta(hours=13))
    assert len(store.timer_events(timer_id)) == 2


def test_the_hilichurl_counts_one_kill_at_each_cleared_and_undo_takes_it_back(timers, store, clock, progress):
    store.put_counter(82055, 37, clock.now())
    assert timers.add_preset("hilichurl") == (1, "Added the timer Unusual Hilichurl")
    assert timers.cleared(1) == "Cleared Unusual Hilichurl"
    assert store.counters()[82055] == 38
    assert progress.undo() == "Cleared Unusual Hilichurl"
    assert store.counters()[82055] == 37
    assert store.timer_events(1) == [] and _read(timers, store, 1, clock.now()) == ("ready", None)


def test_cleared_earlier_uses_the_time_given(timers, store, clock):
    now = clock.now()
    timer_id, _ = timers.create("Walk the dog", "", Rule("hours", 12), None)
    timers.cleared(timer_id, at=now - timedelta(hours=2))
    assert _read(timers, store, timer_id, now) == ("running", now + timedelta(hours=10))
    before = (store.timer(timer_id), store.timer_events(timer_id))
    refusals = {
        now + timedelta(minutes=1): "A timer cannot be cleared in the future.",
        now - timedelta(days=31): "A timer can be cleared at most 30 days ago.",
    }
    for at, sentence in refusals.items():
        with pytest.raises(TimerError, match=re.escape(sentence)):
            timers.cleared(timer_id, at=at)
    assert (store.timer(timer_id), store.timer_events(timer_id)) == before


def test_set_ready_time_matches_the_games_timer_until_the_next_cleared(timers, store, clock):
    now = clock.now()
    timer_id, _ = timers.add_preset("teapot.jade_field")
    assert timers.set_ready(timer_id, now + timedelta(hours=45)) == "Set when Teapot · Jade Field is ready"
    assert _read(timers, store, timer_id, now) == ("running", now + timedelta(hours=45))
    timers.cleared(timer_id)
    assert _read(timers, store, timer_id, now) == ("running", now + timedelta(hours=70))
    with pytest.raises(TimerError, match=re.escape("A ready time is later than now.")):
        timers.set_ready(timer_id, now)
    with pytest.raises(TimerError, match=re.escape("A ready time is at most 90 days away.")):
        timers.set_ready(timer_id, now + timedelta(days=91))


def test_steps_count_visits_and_the_last_one_stops_the_timer(timers, store, clock):
    timer_id, _ = timers.create("Shrine visits", "Inazuma", Rule("resets", 1), 3)
    for _ in range(3):
        timers.cleared(timer_id)
        clock.advance(days=1)
    assert _read(timers, store, timer_id, clock.now())[0] == "finished"
    with pytest.raises(TimerConflict, match=re.escape("This timer has done all its visits.")):
        timers.cleared(timer_id)


def test_a_reset_timer_uses_the_servers_reset(timers, store, clock):
    timer_id, _ = timers.create("Daily check", "", Rule("resets", 1), None)
    timers.cleared(timer_id)
    # The clock stands at 2026-10-13 08:00 UTC, 09:00 on the Europe server: the next reset is 04:00 the next morning.
    assert _read(timers, store, timer_id, clock.now())[1] == datetime(2026, 10, 14, 3, 0, tzinfo=UTC)


def test_fishing_spots_follow_the_setting_at_once(timers, store, clock, fishing):
    now = clock.now()
    timer_id, _ = timers.add_preset("fishing.luhua_pool")
    timers.cleared(timer_id)
    assert _read(timers, store, timer_id, now)[1] == now + timedelta(hours=72)
    written = store.timer(timer_id)
    fishing["rule"] = "next_reset"
    assert _read(timers, store, timer_id, now)[1] == datetime(2026, 10, 14, 3, 0, tzinfo=UTC)
    assert store.timer(timer_id) == written


def test_names_places_and_visits_are_checked(timers):
    name = "A timer's name is 1 to 60 characters."
    place = "A place is at most 60 characters."
    visits = "A timer has 2 to 50 visits, or none."
    cases = [
        (("", "", None), name), (("   ", "", None), name), (("x" * 61, "", None), name),
        (("Walk the dog", "y" * 61, None), place),
        (("Walk the dog", "", 1), visits), (("Walk the dog", "", 51), visits),
    ]
    for (timer_name, timer_place, steps), sentence in cases:
        with pytest.raises(TimerError, match=re.escape(sentence)):
            timers.create(timer_name, timer_place, Rule("hours", 12), steps)
    timer_id, _ = timers.create("  Walk the dog  ", "  The park  ", Rule("hours", 12), None)
    assert timers.name(timers._store.timer(timer_id)) == "Walk the dog"
    assert timers._store.timer(timer_id).place == "The park"
    hilichurl, _ = timers.add_preset("hilichurl")
    with pytest.raises(TimerConflict, match=re.escape("A pre-set timer keeps its name and its rule.")):
        timers.edit(hilichurl, name="Wei", place="", rule=Rule("hours", 12), steps=None)
    with pytest.raises(TimerConflict, match=re.escape("This pre-set timer is in use already.")):
        timers.add_preset("hilichurl")
    with pytest.raises(UnknownTimer, match=re.escape("There is no pre-set timer with this name.")):
        timers.add_preset("hilichurl.elsewhere")
    with pytest.raises(UnknownTimer, match=re.escape("There is no timer with this number.")):
        timers.cleared(999)


def test_an_own_timer_can_be_changed_and_its_bell_turned_off(timers, store, progress):
    timer_id, _ = timers.create("Walk the dog", "", Rule("hours", 12), None)
    assert timers.edit(timer_id, name="Walk the cat", place="Home", rule=Rule("resets", 2), steps=4) == (
        "Changed the timer Walk the cat"
    )
    row = store.timer(timer_id)
    assert (timers.name(row), row.place, timers.rule(row), row.steps) == ("Walk the cat", "Home", Rule("resets", 2), 4)
    assert timers.set_bell(timer_id, False) == "Turned off the reminder for Walk the cat"
    assert store.timer(timer_id).bell is False
    assert progress.undo() == "Turned off the reminder for Walk the cat"
    assert store.timer(timer_id).bell is True
    assert timers.set_bell(timer_id, True) == "Turned on the reminder for Walk the cat"


def test_remove_and_undo_put_the_timer_back_with_its_history(timers, store, clock, progress):
    timer_id, _ = timers.create("Walk the dog", "", Rule("hours", 12), None)
    timers.cleared(timer_id)
    clock.advance(hours=1)
    timers.cleared(timer_id)
    row, events = store.timer(timer_id), store.timer_events(timer_id)
    assert timers.remove(timer_id) == "Removed the timer Walk the dog"
    assert store.timers() == [] and store.timer_events() == []
    assert progress.undo() == "Removed the timer Walk the dog"
    assert (store.timer(timer_id), store.timer_events(timer_id)) == (row, events)


def test_adding_a_timer_can_be_undone(timers, store, progress):
    timers.create("Walk the dog", "", Rule("hours", 12), None)
    assert progress.undo() == "Added the timer Walk the dog"
    assert store.timers() == []


def test_the_default_pre_sets_are_added_once_while_their_achievements_are_left(timers, store, clock):
    now = clock.now()
    store.put_progress([ProgressRow(stage, "done", now, False, "", "player", now) for stage in (82055, 82056, 82057)])
    timers.ensure_defaults(CATALOG)
    teapots = {"teapot.jade_field", "teapot.luxuriant_glebe", "teapot.orderly_meadow"}
    assert {row.preset for row in store.timers()} == teapots  # the hilichurl's three stages are done
    timers.ensure_defaults(CATALOG)
    assert len(store.timers()) == 3
    timers.remove(store.timers()[0].id)
    timers.ensure_defaults(CATALOG)
    assert len(store.timers()) == 2  # a pre-set the player removed stays removed


def test_an_undo_puts_back_the_reminder_mark_with_the_ready_time(timers, store, clock, progress):
    now = clock.now()
    timer_id, _ = timers.create("Walk the dog", "", Rule("hours", 12), None)
    timers.cleared(timer_id, at=now - timedelta(hours=13))
    store.set_notified(timer_id, now - timedelta(hours=1))  # it became ready an hour ago, and a reminder went out
    timers.cleared(timer_id)
    progress.undo()
    assert store.timer(timer_id).notified_ready_at == now - timedelta(hours=1)
