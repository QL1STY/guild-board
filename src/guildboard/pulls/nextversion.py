"""The next game version and the primogems it offers (the Pulls second pass, spec 3.2): the days it runs, and its rows
by source. Pure: no store and no clock.

The days come from a calendar in `reference/versions.json`: one known version, the day it started, and the game's
steady cadence of 42 days. The banners correct it where they disagree. The day after a banner's last game day is the
day the next version comes (the second half's end is the version's end), and it is taken when it lies within three
days of the calendar's day. A first half's banners end half way through a version, weeks from the calendar's day, and
correct nothing. The version after it starts one cadence on.

The sources are the game's own rules, counted in full (spec 2, item 8): the commissions of every day, the Spiral Abyss
and the Imaginarium Theater at each reset that falls in the version, the Stygian Onslaught, the update's compensation
and the codes, and the two purchases the player may have, the Blessing of the Welkin Moon and the Gnostic Hymn. The
events and the quests come from the Traveler's Diary by the month: the pace of the last two full months, else of the
month so far, over the version's days and down to tens, so that the estimate guesses low. A count the player typed
replaces the events. Only those two sources are read from the diary, so the Welkin Moon's daily primogems, whatever
source holds them, are the switch's alone and never counted twice.

The amounts, the day they were checked and the pages they come from are in the reference file.
"""
from __future__ import annotations

import json
import re
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from importlib import resources
from typing import Any, Mapping, Sequence

from guildboard.gameday import game_day
from guildboard.pulls import PULL_PRIMOGEMS
from guildboard.store import BannerRow

SERVER = "os_euro"  # the server whose clock reads a banner's end, when the caller names none
NEAR_DAYS = 3  # how far from the calendar's day a banner's may lie and still correct it
TENS = 10  # what the diary's estimates fall to
NUMBER = re.compile(r"([0-9]+)\.([0-9]+)")


@dataclass(frozen=True)
class Row:
    """One source of the next version. A switched-off purchase keeps its amount and is `on` False, out of the totals."""

    key: str  # commissions, events, endgame, update, quests, welkin or gnostic_hymn
    primogems: int
    fates: int
    on: bool
    estimated: bool  # the events and the quests are the diary's guess, the events not when the player typed them


@dataclass(frozen=True)
class NextVersion:
    number: str | None  # "7.2"; None when the calendar cannot place it
    starts_on: date  # the game day it starts
    ends_on: date  # the game day the version after it starts
    rows: tuple[Row, ...]  # in the order of the ledger, all seven

    @property
    def days(self) -> int:
        return (self.ends_on - self.starts_on).days

    @property
    def primogems(self) -> int:
        return sum(row.primogems for row in self.rows if row.on)

    @property
    def fates(self) -> int:
        return sum(row.fates for row in self.rows if row.on)

    @property
    def pulls(self) -> int:
        return self.primogems // PULL_PRIMOGEMS + self.fates


@lru_cache(maxsize=1)
def load_reference() -> dict:
    """The calendar and the fixed sources of `reference/versions.json`. Read once; do not change what it gives."""
    text = resources.files("guildboard").joinpath("reference", "versions.json").read_text(encoding="utf-8")
    return json.loads(text)


def _number(known: str, ahead: int) -> str | None:
    """The number of the version `ahead` versions after the known one ("7.1", 1 is "7.2"), read as whole numbers, major
    and minor. None when the known one is not of that form or the count goes below x.0."""
    found = NUMBER.fullmatch(known)
    if found is None:
        return None
    minor = int(found.group(2)) + ahead
    return f"{int(found.group(1))}.{minor}" if minor >= 0 else None


def _starts_on(calendar_day: date, banners: Sequence[BannerRow], server: str) -> date:
    """The day a version starts: the calendar's, or the day after the last game day of a banner that ends near it. Of
    several, the nearest."""
    after_banners = [game_day(banner.ends_at, server) + timedelta(days=1) for banner in banners]
    near = [day for day in after_banners if abs((day - calendar_day).days) <= NEAR_DAYS]
    return min(near, key=lambda day: (abs((day - calendar_day).days), -day.toordinal())) if near else calendar_day


def _month_before(day: date, back: int) -> str:
    """The month `back` months before the one of `day`, named as the diary's months are: "2026-09"."""
    index = day.year * 12 + day.month - 1 - back
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _from_diary(diary: Mapping[str, Mapping[str, float]], today: date, days: int) -> tuple[int, int]:
    """The events and quests of a version of `days` days from the diary: their pace over the two full months before this
    one that the diary holds, else over this month's days so far (today counts whole, so the guess stays low), times the
    version's days, down to tens. A source is the events' when its name holds "event" and the quests' when it holds
    "quest"; the others are not read."""
    full = [month for month in (_month_before(today, 1), _month_before(today, 2)) if month in diary]
    if full:
        months, span = full, sum(monthrange(int(month[:4]), int(month[5:]))[1] for month in full)
    elif _month_before(today, 0) in diary:
        months, span = [_month_before(today, 0)], today.day
    else:
        return 0, 0
    events = quests = 0.0
    for month in months:
        for source, amount in diary[month].items():
            if "event" in source:
                events += amount
            elif "quest" in source:
                quests += amount

    def per_version(amount: float) -> int:
        return round(amount) * days // span // TENS * TENS

    return per_version(events), per_version(quests)


def next_version(
    today: date,
    banners: Sequence[BannerRow],
    diary: Mapping[str, Mapping[str, float]],
    welkin: bool,
    gnostic_hymn: bool,
    events_typed: Mapping[str, int],
    reference: dict,
    server: str = SERVER,
) -> NextVersion:
    """The next version at the game day `today`: the first to start after it. The calendar counts a version from the
    known one by whole cadences; a banner whose end lies near a version's day moves that day, so a version whose
    calendar day has gone by but whose banners still run is still the next. `diary` is each month's primogems by source,
    `{"2026-09": {"events": 2400}}`; `events_typed` is the events count the player typed, by version number."""
    known, sources = reference["calendar"], reference["sources"]
    cadence = int(known["cadence_days"])
    started = date.fromisoformat(known["started"])
    index = (today - started).days // cadence  # the calendar's version of today; the known one is 0
    starts_on = _starts_on(started + timedelta(days=cadence * index), banners, server)
    while starts_on <= today:  # it has begun, so the next is the one after; a banner can put its day still ahead
        index += 1
        starts_on = _starts_on(started + timedelta(days=cadence * index), banners, server)
    number = _number(known["version"], index)
    ends_on = starts_on + timedelta(days=cadence)

    # A reset counts when its day is after the version's first day and on or before its last: the next update's day.
    after_first = [starts_on + timedelta(days=offset) for offset in range(1, cadence + 1)]
    abyss = sum(1 for day in after_first if day.day == sources["abyss_reset_day"])
    theater = sum(1 for day in after_first if day.day == sources["theater_reset_day"])
    endgame = (
        abyss * sources["abyss_per_reset"] + theater * sources["theater_per_reset"] + sources["stygian_per_version"]
    )
    typed = events_typed.get(number) if number is not None else None
    events, quests = _from_diary(diary, today, cadence)
    hymn = sources["gnostic_hymn"]
    rows = (
        Row("commissions", sources["commissions_per_day"] * cadence, 0, True, False),
        Row("events", events if typed is None else typed, 0, True, typed is None),
        Row("endgame", endgame, 0, True, False),
        Row("update", sources["maintenance_per_version"] + sources["codes_per_version"], 0, True, False),
        Row("quests", quests, 0, True, True),
        Row("welkin", sources["welkin_per_day"] * cadence, 0, welkin, False),
        Row("gnostic_hymn", hymn["primogems"], hymn["fates"], gnostic_hymn, False),
    )
    return NextVersion(number, starts_on, ends_on, rows)
