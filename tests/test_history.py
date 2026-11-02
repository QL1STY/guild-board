from datetime import date, datetime, timedelta, timezone

from guildboard.gameday import game_day
from guildboard.history import Coverage, History
from guildboard.metrics import Point
from guildboard.store import Store

UTC = timezone.utc
SERVER = "os_euro"


def _put(store, day_of_october: int, key: str, value: float, hour: int = 20) -> None:
    when = datetime(2026, 10, day_of_october, hour, 0, tzinfo=UTC)
    store.add_points(None, when, game_day(when, SERVER), [Point(key, value)])


def _d(day_of_october: int) -> date:
    return date(2026, 10, day_of_october)


def test_empty_store_answers_without_data(store):
    history = History(store)
    assert history.tracking_since() is None
    assert history.latest("stats.achievements") is None
    assert history.change(["stats.achievements"], _d(1), _d(10)) is None
    days = history.daily_change(["stats.achievements"], _d(1), _d(3))
    assert [(d.delta, d.has_data, d.after_gap) for d in days] == [(0.0, False, False)] * 3
    assert history.coverage(_d(1), _d(10)) == Coverage(None, 0, 10, False)
    assert history.playtime_minutes(_d(1), _d(2), SERVER) == {_d(1): 0.0, _d(2): 0.0}


def test_latest_and_tracking_since(store):
    _put(store, 5, "k", 1)
    _put(store, 7, "k", 4)
    history = History(store)
    assert history.tracking_since() == _d(5)
    assert history.latest("k") == 4.0


def test_change_uses_the_value_before_the_period_as_baseline(store):
    _put(store, 1, "k", 100)
    _put(store, 5, "k", 130)
    _put(store, 8, "k", 150)
    assert History(store).change(["k"], _d(4), _d(8)) == 50.0
    assert History(store).change(["k"], _d(6), _d(7)) == 0.0  # no new point in the period


def test_change_when_tracking_starts_inside_the_period(store):
    _put(store, 5, "k", 130)
    _put(store, 8, "k", 150)
    assert History(store).change(["k"], _d(1), _d(8)) == 20.0


def test_change_sums_several_keys(store):
    _put(store, 1, "a", 10)
    _put(store, 3, "a", 15)
    _put(store, 1, "b", 1)
    _put(store, 3, "b", 4)
    history = History(store)
    assert history.change(["a", "b", "missing"], _d(2), _d(3)) == 8.0
    assert history.change(["missing"], _d(2), _d(3)) is None


def test_daily_change_marks_gaps(store):
    _put(store, 1, "k", 100)
    _put(store, 2, "k", 104)
    _put(store, 5, "k", 120)
    _put(store, 6, "k", 121)
    days = History(store).daily_change(["k"], _d(2), _d(6))
    assert [(d.day.day, d.delta, d.has_data, d.after_gap) for d in days] == [
        (2, 4.0, True, False),
        (3, 0.0, False, False),
        (4, 0.0, False, False),
        (5, 16.0, True, True),
        (6, 1.0, True, False),
    ]


def test_days_before_tracking_are_not_gaps(store):
    _put(store, 3, "k", 100)
    _put(store, 4, "k", 105)
    days = History(store).daily_change(["k"], _d(1), _d(4))
    assert [(d.day.day, d.delta, d.has_data, d.after_gap) for d in days] == [
        (1, 0.0, False, False),
        (2, 0.0, False, False),
        (3, 0.0, True, False),  # the first sighting is the baseline, not activity
        (4, 5.0, True, False),
    ]


def test_a_falling_counter_never_gives_negative_activity(store):
    _put(store, 1, "k", 100)
    _put(store, 2, "k", 90)
    _put(store, 3, "k", 95)
    history = History(store)
    assert [d.delta for d in history.daily_change(["k"], _d(2), _d(3))] == [0.0, 5.0]
    assert history.change(["k"], _d(2), _d(3)) == 0.0


def test_coverage(store):
    _put(store, 5, "k", 1)
    history = History(store)
    assert history.coverage(_d(1), _d(10)) == Coverage(_d(5), 6, 10, False)
    assert history.coverage(_d(6), _d(10)) == Coverage(_d(5), 5, 5, True)
    assert history.coverage(_d(5), _d(10)) == Coverage(_d(5), 6, 6, False)  # no baseline before the first day
    assert history.coverage(date(2026, 9, 1), date(2026, 9, 30)) == Coverage(_d(5), 0, 30, False)


def test_playtime_is_split_at_the_reset(store):
    crossing = store.open_session(datetime(2026, 10, 12, 2, 30, tzinfo=UTC), False)  # 03:30 server time
    store.touch_session(crossing, datetime(2026, 10, 12, 3, 45, tzinfo=UTC))  # 04:45 server time
    evening = store.open_session(datetime(2026, 10, 12, 18, 0, tzinfo=UTC), False)
    store.touch_session(evening, datetime(2026, 10, 12, 19, 0, tzinfo=UTC))
    history = History(store)
    assert history.playtime_minutes(_d(11), _d(12), SERVER) == {_d(11): 30.0, _d(12): 105.0}
    assert history.playtime_minutes(_d(12), _d(12), SERVER) == {_d(12): 105.0}
    assert history.playtime_minutes(_d(13), _d(13), SERVER) == {_d(13): 0.0}


def test_minutes_by_hour_are_cut_at_the_hours_of_the_zone_and_at_its_midnights(store):
    india = timezone(timedelta(hours=5, minutes=30))  # its hours begin at :30 UTC
    early = store.open_session(datetime(2026, 10, 5, 18, 45, tzinfo=UTC), False)  # Tue 6 Oct 00:15 there
    store.touch_session(early, datetime(2026, 10, 5, 20, 15, tzinfo=UTC))  # Tue 01:45 there
    late = store.open_session(datetime(2026, 10, 6, 18, 0, tzinfo=UTC), False)  # Tue 6 Oct 23:30 there
    store.touch_session(late, datetime(2026, 10, 6, 19, 0, tzinfo=UTC))  # Wed 7 Oct 00:30 there
    grid = History(store).minutes_by_hour(_d(6), _d(6), india)
    assert (len(grid), {len(row) for row in grid}) == (7, {24})
    assert grid[1][0] == 45.0 and grid[1][1] == 45.0  # the first session, in two parts
    assert grid[1][23] == 30.0  # the second ends at the zone's midnight: the half hour after it is the next date's
    assert grid[2][0] == 0.0
    assert sum(sum(row) for row in grid) == 120.0
    both_dates = History(store).minutes_by_hour(_d(6), _d(7), india)
    assert both_dates[2][0] == 30.0
    assert History(store).minutes_by_hour(_d(1), _d(2), india) == [[0.0] * 24 for _ in range(7)]


def test_minutes_by_hour_add_up_to_whole_minutes_where_they_are_whole(store):
    # Three sessions of 15 minutes in one hour: 45.0 exactly, so that a cell is in the top level and not a hair under it.
    for minute in (0, 20, 40):
        start = datetime(2026, 10, 12, 10, minute, 3, tzinfo=UTC)
        store.touch_session(store.open_session(start, False), start + timedelta(minutes=15))
    grid = History(store).minutes_by_hour(_d(12), _d(12), UTC)
    assert grid[0][10] == 45.0


def test_changes_are_the_same_without_repeats(store):
    days = ((1, [100, 100, 100]), (2, [104, 104]), (5, [120, 121, 121]), (6, [121, 121]))
    for day, values in days:
        for hour, value in zip((9, 14, 20), values):
            _put(store, day, "k", value, hour)
    assert store._conn.execute("SELECT COUNT(*) FROM points").fetchone()[0] == 5  # 10 values, 5 repeats of a game day
    # The same values as an older Guild Board wrote them, every one of them.
    with_repeats = Store.in_memory()
    for day, values in days:
        for hour, value in zip((9, 14, 20), values):
            when = datetime(2026, 10, day, hour, 0, tzinfo=UTC)
            with_repeats._conn.execute(
                "INSERT INTO points (key, taken_at, game_day, value) VALUES (?, ?, ?, ?)",
                ("k", when.isoformat(timespec="seconds"), game_day(when, SERVER).isoformat(), float(value)),
            )
    old, new = History(with_repeats), History(store)
    assert new.daily_change(["k"], _d(1), _d(7)) == old.daily_change(["k"], _d(1), _d(7))
    assert new.change(["k"], _d(2), _d(6)) == old.change(["k"], _d(2), _d(6))
    assert new.coverage(_d(1), _d(7)) == old.coverage(_d(1), _d(7))
    assert new.latest("k") == old.latest("k")
    assert store.day_values(["k"], _d(1), _d(7)) == with_repeats.day_values(["k"], _d(1), _d(7))
    with_repeats.close()
