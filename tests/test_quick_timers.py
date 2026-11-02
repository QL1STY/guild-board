from datetime import timedelta

import pytest

from guildboard.timers.quick import QuickTimerError, QuickTimers, UnknownQuickTimer, quick_name

RANGE = "A quick timer runs from 1 second to 12 hours."


def test_a_quick_timer_is_named_by_its_time():
    assert [quick_name(seconds) for seconds in (45, 90, 300, 3600, 5400, 7205)] == [
        "Quick timer · 45 s", "Quick timer · 1 min 30 s", "Quick timer · 5 min", "Quick timer · 1 h",
        "Quick timer · 1 h 30 min", "Quick timer · 2 h 5 s",
    ]


def test_a_quick_timer_runs_for_its_seconds_and_stays_ready_until_dismissed(store, clock):
    quick = QuickTimers(store, clock)
    made = quick.start(300)
    assert quick.model() == {"quick_timers": [{
        "id": made, "seconds": 300, "name": "Quick timer · 5 min", "started_at": "2026-10-13T08:00:00+00:00",
        "ready_at": "2026-10-13T08:05:00+00:00", "state": "running",
    }]}
    clock.advance(minutes=5)
    assert quick.model()["quick_timers"][0]["state"] == "ready"
    quick.dismiss(made)
    assert quick.model() == {"quick_timers": []}
    with pytest.raises(UnknownQuickTimer, match="There is no quick timer with this number."):
        quick.dismiss(made)


def test_a_quick_timer_starts_at_the_whole_second(store, clock):
    clock.advance(seconds=1.75)
    quick = QuickTimers(store, clock)
    quick.start(60)
    [item] = quick.model()["quick_timers"]
    assert (item["started_at"], item["ready_at"]) == ("2026-10-13T08:00:01+00:00", "2026-10-13T08:01:01+00:00")


def test_quick_timers_refuse_a_time_out_of_range_and_a_twenty_first(store, clock):
    quick = QuickTimers(store, clock)
    for bad in (0, 43_201, 1.5, True, "300", None):
        with pytest.raises(QuickTimerError, match=RANGE):
            quick.start(bad)
    assert quick.start(43_200) and quick.start(1)
    for _ in range(18):
        quick.start(60)
    with pytest.raises(QuickTimerError, match="At most 20 quick timers can run at once."):
        quick.start(60)


def test_the_due_ones_are_ready_and_not_yet_reminded_and_the_soonest_is_still_ahead(store, clock):
    quick = QuickTimers(store, clock)
    first = quick.start(60)
    quick.start(600)
    assert (quick.due(), quick.soonest()) == ([], clock.now() + timedelta(minutes=1))
    clock.advance(minutes=1)
    assert [row.id for row in quick.due()] == [first]
    assert quick.soonest() == clock.now() + timedelta(minutes=9)
    store.set_quick_notified([first])
    assert quick.due() == []
