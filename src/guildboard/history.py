"""Questions over the stored points and play sessions."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone, tzinfo
from typing import Sequence

from guildboard.gameday import days_inclusive, game_day, game_day_start
from guildboard.store import Store


@dataclass(frozen=True)
class DayChange:
    day: date
    delta: float
    has_data: bool
    after_gap: bool


@dataclass(frozen=True)
class Coverage:
    tracking_since: date | None
    tracked_days: int
    total_days: int
    full: bool


class History:
    def __init__(self, store: Store) -> None:
        self._store = store

    def tracking_since(self) -> date | None:
        return self._store.first_game_day()

    def latest(self, key: str) -> float | None:
        return self._store.latest_point_value(key)

    def coverage(self, first: date, last: date) -> Coverage:
        since = self.tracking_since()
        total = max(0, (last - first).days + 1)
        if since is None or since > last:
            return Coverage(since, 0, total, False)
        tracked = (last - max(first, since)).days + 1
        return Coverage(since, tracked, total, since < first)

    def change(self, keys: Sequence[str], first: date, last: date) -> float | None:
        total, seen = 0.0, False
        for key in keys:
            end = self._store.value_at_or_before(key, last)
            if end is None:
                continue
            baseline = self._store.value_before(key, first)
            if baseline is None:
                baseline = self._store.first_value_in(key, first, last)
            if baseline is None:
                continue
            total += max(0.0, end - baseline)
            seen = True
        return total if seen else None

    def daily_change(self, keys: Sequence[str], first: date, last: date) -> list[DayChange]:
        per_key = self._store.day_values(keys, first, last)
        previous: dict[str, float | None] = {key: self._store.value_before(key, first) for key in keys}
        tracking_began = any(value is not None for value in previous.values())
        gap_open = False
        out: list[DayChange] = []
        for day in days_inclusive(first, last):
            if not any(day in per_key[key] for key in keys):
                out.append(DayChange(day, 0.0, False, False))
                gap_open = gap_open or tracking_began
                continue
            delta = 0.0
            for key in keys:
                value = per_key[key].get(day)
                if value is None:
                    continue
                if previous[key] is not None:
                    delta += max(0.0, value - previous[key])
                previous[key] = value
            out.append(DayChange(day, delta, True, gap_open))
            gap_open = False
            tracking_began = True
        return out

    def playtime_minutes(self, first: date, last: date, server: str) -> dict[date, float]:
        start = game_day_start(first, server)
        end = game_day_start(last + timedelta(days=1), server)
        out = {day: 0.0 for day in days_inclusive(first, last)}
        for session in self._store.sessions_overlapping(start, end):
            cursor = max(session.started_at, start)
            stop = min(session.ended_at, end)
            while cursor < stop:
                day = game_day(cursor, server)
                piece_end = min(stop, game_day_start(day + timedelta(days=1), server))
                out[day] = out.get(day, 0.0) + (piece_end - cursor).total_seconds() / 60
                cursor = piece_end
        return out

    def minutes_by_hour(self, first: date, last: date, tz: tzinfo | None) -> list[list[float]]:
        """The minutes played in each hour of each weekday (seven rows from Monday, 24 hours each) on the clock of `tz`,
        over the dates `first` to `last` of that clock: from midnight at the start of `first` to midnight at the end of
        `last`. `tz` None is this PC's own zone, summer time included. A session is cut at every hour of that clock, so
        each part of it counts where it was played."""
        start, end = _midnight(first, tz), _midnight(last + timedelta(days=1), tz)
        seconds = [[0.0] * 24 for _ in range(7)]
        for session in self._store.sessions_overlapping(start, end):
            cursor, stop = max(session.started_at, start), min(session.ended_at, end)
            while cursor < stop:
                local = cursor.astimezone(tz)
                into_hour = local.minute * 60 + local.second + local.microsecond / 1_000_000
                piece_end = min(stop, cursor + timedelta(seconds=3600 - into_hour))
                seconds[local.weekday()][local.hour] += (piece_end - cursor).total_seconds()
                cursor = piece_end
        # Added up in seconds and divided once, so that a total of exactly 30 minutes is 30.0 and not a hair under.
        return [[total / 60 for total in row] for row in seconds]


def _midnight(day: date, tz: tzinfo | None) -> datetime:
    """The first instant of `day` on the clock of `tz` (this PC's own where None), in UTC."""
    return datetime(day.year, day.month, day.day, tzinfo=tz).astimezone(timezone.utc)
