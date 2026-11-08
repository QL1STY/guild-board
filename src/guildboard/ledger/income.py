"""Primogems earned by game day, as exact as can be had (the ledger design, section 0, the hybrid).

For a game day: the game's own primogem log where it covers the day; else the HoYoLAB diary's detail entries of that
day; else nothing: the day is empty, never estimated from the diary's running total, whose rises land on the day of a
sync rather than the day the primogems were earned and so mislead (removed after 1.0.1). The game's log
covers the days from the day after its oldest entry's game day (that day is cut part-way, as the log starts mid-day) to
its newest entry's game day. Game days start at 04:00 server time (`gameday.game_day`). Bought primogems and spending
are never earned.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from guildboard.gameday import days_inclusive, game_day, game_day_start
from guildboard.ledger.reasons import BOUGHT, GROUP_LABELS, GROUPS, fates_bought, group_of
from guildboard.store import Store

PRIMOGEM = "primogem"
_SECOND = timedelta(seconds=1)


def covered(store: Store, uid: int, server: str) -> tuple[date, date] | None:
    """The game days the game's own primogem log covers whole, first and last; None when it covers none."""
    oldest, newest = store.oldest_ledger_entry(uid, PRIMOGEM), store.newest_ledger_entry(uid, PRIMOGEM)
    if oldest is None or newest is None:
        return None
    first, last = game_day(oldest.at, server) + timedelta(days=1), game_day(newest.at, server)
    return (first, last) if first <= last else None


def covered_from(store: Store, uid: int, server: str) -> date | None:
    """The first game day the game's log covers: the day after its oldest entry's game day."""
    span = covered(store, uid, server)
    return span[0] if span is not None else None


def _empty() -> dict[str, int]:
    return {group: 0 for group in GROUPS}


def earned_by_day(store: Store, uid: int, server: str, first: date, last: date) -> dict[date, dict[str, int]]:
    """The primogems earned on each game day from `first` to `last` by group, for the days the game's log covers
    (every such day, 0s included) and the days the diary's detail has entries for; a day of neither is left out."""
    out: dict[date, dict[str, int]] = {}
    span = covered(store, uid, server)
    if span is not None:
        start, end = max(first, span[0]), min(last, span[1])
        if start <= end:
            for day in days_inclusive(start, end):
                out[day] = _empty()
            since = game_day_start(start, server) - _SECOND
            for row in store.ledger_entries(uid, PRIMOGEM, since=since):
                day = game_day(row.at, server)
                group = group_of(row.reason)
                if day in out and row.amount > 0 and group != BOUGHT:
                    out[day][group] += row.amount
    diary: dict[date, dict[str, int]] = defaultdict(_empty)
    # The diary's detail is read by calendar month, in server time. A game day runs to 03:59 of the next date, so the
    # last day of a month whose detail was never read would hold only the next month's first four hours: a day counts
    # only when its own month's detail was read (one of its entries is kept), as the game's oldest day is left out.
    read: set[str] = set()
    actions = store.diary_actions(
        uid, game_day_start(first.replace(day=1), server), game_day_start(last + timedelta(days=1), server)
    )
    for action in actions:
        read.add(action.time[:7])
        group = group_of(action.action)
        if action.amount > 0 and group != BOUGHT:
            diary[game_day(action.at, server)][group] += action.amount
    for day, groups in diary.items():
        if (
            first <= day <= last and day not in out and (span is None or not span[0] <= day <= span[1])
            and f"{day.year:04d}-{day.month:02d}" in read
        ):
            out[day] = groups
    return out


def net_since(store: Store, uid: int, since: datetime) -> tuple[int, int]:
    """The signed sum of the primogem entries after `since`, in and out, and the Fates they bought."""
    rows = store.ledger_entries(uid, PRIMOGEM, since=since)
    return sum(row.amount for row in rows), sum(fates_bought(row.reason, row.amount) for row in rows)


@dataclass(frozen=True)
class EarnedDay:
    day: date
    value: int
    groups: dict[str, int] | None  # by group, for a day of the game's log or the diary's detail
    no_data: bool  # neither covers the day: it is empty, not 0 earned


def earned_days(store: Store, uid: int | None, server: str, first: date, last: date) -> list[EarnedDay]:
    """Every game day from `first` to `last`: exact where the game's log or the diary's detail covers it, else empty."""
    exact = earned_by_day(store, uid, server, first, last) if uid is not None else {}
    out = []
    for day in days_inclusive(first, last):
        groups = exact.get(day)
        if groups is not None:
            out.append(EarnedDay(day, sum(groups.values()), groups, False))
        else:
            out.append(EarnedDay(day, 0, None, True))
    return out


def pace(store: Store, uid: int | None, server: str, today: date, days: int = 30) -> float | None:
    """Primogems earned a day over the last `days`, over the exact days among them; None without one."""
    known = [day for day in earned_days(store, uid, server, today - timedelta(days=days - 1), today) if not day.no_data]
    if not known:
        return None
    return sum(day.value for day in known) / len(known)


def month_values(
    store: Store, uid: int | None, server: str, diary_months: dict[str, int], today: date, shown: int
) -> list[tuple[str, int]]:
    """The primogems earned by month, the newest `shown`: a month with exact days is the sum of those days; a month
    without is the diary's own total."""
    first = date(today.year, today.month, 1)
    for _ in range(shown - 1):
        first = (first - timedelta(days=1)).replace(day=1)
    exact = earned_by_day(store, uid, server, first, today) if uid is not None else {}
    months = dict(diary_months)
    for ym, groups in _by_month(exact).items():
        months[ym] = sum(groups.values())
    return sorted(months.items())[-shown:]


def _by_month(exact: dict[date, dict[str, int]]) -> dict[str, dict[str, int]]:
    """The exact days summed by group, for each month that has some."""
    out: dict[str, dict[str, int]] = defaultdict(_empty)
    for day, groups in exact.items():
        month = out[f"{day.year:04d}-{day.month:02d}"]
        for group, amount in groups.items():
            month[group] += amount
    return dict(out)


def month_sources(store: Store, uid: int | None, server: str, ym: str, today: date) -> list[tuple[str, int]] | None:
    """A month's primogems by group where it has exact days, so that they add up to its value in `month_values`: each
    group with some, the largest first. None when no day of the month is exact: the diary's own sources say it then."""
    if uid is None:
        return None
    start = date(int(ym[:4]), int(ym[5:7]), 1)
    end = min(today, (start + timedelta(days=32)).replace(day=1) - timedelta(days=1))
    groups = _by_month(earned_by_day(store, uid, server, start, end)).get(ym)
    if groups is None:
        return None
    return sorted(
        ((GROUP_LABELS[group], amount) for group, amount in groups.items() if amount > 0), key=lambda item: -item[1]
    )
