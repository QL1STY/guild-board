from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.clock import ShiftedClock, SystemClock
from support import FakeClock
from guildboard.gameday import days_inclusive, game_day, game_day_start, server_tz, week_start

UTC = timezone.utc


def test_europe_day_flips_at_four_server_time():
    before = datetime(2026, 10, 13, 2, 59, 59, tzinfo=UTC)  # 03:59:59 at UTC+1
    after = datetime(2026, 10, 13, 3, 0, 0, tzinfo=UTC)  # 04:00:00 at UTC+1
    assert game_day(before, "os_euro") == date(2026, 10, 12)
    assert game_day(after, "os_euro") == date(2026, 10, 13)


def test_america_day_flips_at_four_server_time():
    before = datetime(2026, 10, 13, 8, 59, 59, tzinfo=UTC)  # 03:59:59 at UTC-5
    after = datetime(2026, 10, 13, 9, 0, 0, tzinfo=UTC)
    assert game_day(before, "os_usa") == date(2026, 10, 12)
    assert game_day(after, "os_usa") == date(2026, 10, 13)


def test_game_day_start_is_the_first_instant_of_the_day():
    start = game_day_start(date(2026, 10, 13), "os_euro")
    assert start == datetime(2026, 10, 13, 3, 0, tzinfo=UTC)
    assert game_day(start, "os_euro") == date(2026, 10, 13)


def test_naive_datetime_is_rejected():
    with pytest.raises(ValueError):
        game_day(datetime(2026, 10, 13, 3, 0), "os_euro")


def test_unknown_server_is_rejected():
    with pytest.raises(ValueError):
        server_tz("os_mars")


def test_days_inclusive_and_week_start():
    assert days_inclusive(date(2026, 10, 12), date(2026, 10, 14)) == [
        date(2026, 10, 12),
        date(2026, 10, 13),
        date(2026, 10, 14),
    ]
    assert days_inclusive(date(2026, 10, 14), date(2026, 10, 12)) == []
    assert week_start(date(2026, 10, 13)) == date(2026, 10, 12)  # a Tuesday; the week starts on Monday
    assert week_start(date(2026, 10, 12)) == date(2026, 10, 12)


def test_system_clock_is_timezone_aware_utc():
    now = SystemClock().now()
    assert now.tzinfo is not None
    assert now.utcoffset().total_seconds() == 0


def test_shifted_clock_starts_where_it_is_told_and_moves_forward():
    base = FakeClock(datetime(2030, 1, 1, tzinfo=UTC))
    start = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)
    shifted = ShiftedClock(start, base=base)
    assert shifted.now() == start
    base.advance(minutes=5)
    assert shifted.now() == start + timedelta(minutes=5)  # it keeps running with real time
    shifted.advance(3600)
    assert shifted.now() == start + timedelta(minutes=65)
    with pytest.raises(ValueError):
        shifted.advance(-1)
    with pytest.raises(ValueError):
        ShiftedClock(datetime(2026, 10, 13, 8, 0))
    assert abs((ShiftedClock().now() - SystemClock().now()).total_seconds()) < 5  # no start: real time
