"""The Stats page's Months tab: a summary of each month, from the first month any source reaches (the Stats design,
section 5).

A month is a calendar month of game days (a game day starts at 04:00 server time). Every part of it comes from data that
is there: a source that does not reach the month leaves its parts out, with a quiet note saying from when it is kept
(`since`), and a part is never a 0 or a dash for "not known". A 0 is a real one: the source covers the month and nothing
happened in it.

Where each source begins (`_Coverage`): the wishes at the first wish's game day, the primogem ledger at the first day the
game's log covers whole or the diary's first month, the resin at the first day its log covers whole, the sessions at the
day Guild Board began to track, the achievements at the same day (or the first one ticked, if earlier) and the endgame at
the end of its first kept cycle. The wish history is read at an import, so it covers the game days up to the newest import
that finished (or the newest wish kept, if later): a month wholly after that has no wishes part, and one it ends inside
counts the wishes up to then and compares with nothing.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import cached_property
from typing import Any, Mapping, Sequence

from guildboard.gameday import days_inclusive, game_day, game_day_start
from guildboard.history import History
from guildboard.ledger import income
from guildboard.metrics import MONTH_PREFIX
from guildboard.pulls import ALL_POOLS, POOL_LABELS
from guildboard.pulls.rules import FiveStar, PoolState
from guildboard.store import Store, WishRow, parse_iso
from guildboard.views.endgame_card import LABELS as MODE_LABELS, MONTHS as FULL_MONTH_NAMES
from guildboard.views.pulls import wish_icon, wish_kind
from guildboard.views.stats import MONTH_NAMES, longest_run, play_level

THIN_BELOW = 3  # a month with fewer than this many of the five numbers is thin
TILES = (
    ("time", "Time in Teyvat", "minutes"),
    ("days", "Days played", "days"),
    ("primogems", "Primogems earned", "primogems"),
    ("wishes", "Wishes", "wishes"),
    ("achievements", "Achievements", "achievements"),
)
RECORD_LABELS = {
    "longest_session": "Longest session",
    "best_primogem_day": "Best primogem day",
    "longest_run": "Longest run of days",
    "luckiest": "Luckiest 5★",
}
_ALL_IMPORTS = 1_000_000


# ---------------------------------------------------------------------------------------------- months and days


def _ym(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def _first_day(ym: str) -> date:
    return date(int(ym[:4]), int(ym[5:7]), 1)


def _last_day(ym: str) -> date:
    return (_first_day(ym) + timedelta(days=32)).replace(day=1) - timedelta(days=1)


def _before(ym: str) -> str:
    return _ym(_first_day(ym) - timedelta(days=1))


def _valid(ym: object) -> bool:
    if not isinstance(ym, str) or len(ym) != 7 or ym[4] != "-" or not (ym[:4] + ym[5:]).isdigit():
        return False
    return 1 <= int(ym[5:]) <= 12 and int(ym[:4]) >= 1


def _months_between(first: str, last: str) -> list[str]:
    out, ym = [], first
    while ym <= last:
        out.append(ym)
        ym = _ym(_last_day(ym) + timedelta(days=1))
    return out


def day_label(day: date, year: int | None = None, always_year: bool = False) -> str:
    """A game day as "16 Oct"; with the year ("16 Oct 2026") where it is not `year`'s own, or always."""
    text = f"{day.day} {MONTH_NAMES[day.month - 1]}"
    return f"{text} {day.year}" if always_year or (year is not None and day.year != year) else text


def span_label(first: date, last: date) -> str:
    """Days of one month as "3 Oct" or "3–9 Oct"."""
    return day_label(first) if first == last else f"{first.day}–{day_label(last)}"


# ---------------------------------------------------------------------------------------------- the achievements ticked


def ticked_achievement_days(store: Store, server: str, first: date, last: date) -> list[date]:
    """The game days of the achievements ticked one by one, inside `first` to `last`, one entry for each achievement.
    A tick is a row of the player's that is done and whose time is not any achievement import's: an import stamps the
    rows it sets with its own time, so those say nothing of the day they were earned (the Stats design, 5.2)."""
    imported = {row.at for row in store.imports(_ALL_IMPORTS)}
    days = []
    for row in store.progress().values():
        if row.status != "done" or row.done_at is None or row.source != "player" or row.done_at in imported:
            continue
        day = game_day(row.done_at, server)
        if first <= day <= last:
            days.append(day)
    return sorted(days)


# ---------------------------------------------------------------------------------------------- what each source covers


@dataclass(frozen=True)
class _Coverage:
    """The first game day each source reaches, None for a source with nothing."""

    wishes: date | None
    wishes_to: date | None  # the last game day the wish history covers
    sessions: date | None
    achievements: date | None
    primogems: date | None
    resin: date | None
    endgame: date | None  # the end of the first cycle kept: a cycle counts in the month it ends
    endgame_first: tuple[date, date] | None = None  # that cycle's first and last game days

    def earliest(self) -> date | None:
        starts = (self.wishes, self.sessions, self.achievements, self.primogems, self.resin, self.endgame)
        return min((day for day in starts if day is not None), default=None)


def _earliest(*days: date | None) -> date | None:
    return min((day for day in days if day is not None), default=None)


class _Month:
    """What is known of the player, read once, that every month is made of."""

    def __init__(
        self, store: Store, history: History, uid: int | None, server: str, today: date,
        states: Mapping[str, PoolState], now: datetime | None = None,
    ) -> None:
        self.store, self.history, self.uid, self.server, self.today = store, history, uid, server, today
        self.now = now  # the moment the endgame cycles that have ended are told from the open ones
        self.rows: list[WishRow] = store.wishes(uid) if uid is not None else []
        self.wish_days = [game_day(row.at, server) for row in self.rows]
        self.wiki = store.wiki_items()
        self.states = states
        self.diary = {key[len(MONTH_PREFIX):]: int(value) for key, value in store.latest_values(MONTH_PREFIX).items()}
        self.ticks = ticked_achievement_days(store, server, date(1, 1, 1), today)
        self.coverage = self._coverage()

    # ------------------------------------------------------------------ coverage
    def _coverage(self) -> _Coverage:
        store, server, uid = self.store, self.server, self.uid
        first_session = store.first_session()
        sessions = _earliest(
            self.history.tracking_since(), game_day(first_session.started_at, server) if first_session else None
        )
        diary_start = _first_day(min(self.diary)) if self.diary else None
        ledger = income.covered_from(store, uid, server) if uid is not None else None
        resin = None
        if uid is not None:
            oldest, newest = store.oldest_ledger_entry(uid, "resin"), store.newest_ledger_entry(uid, "resin")
            if oldest is not None and newest is not None:
                start = game_day(oldest.at, server) + timedelta(days=1)
                resin = start if start <= game_day(newest.at, server) else None
        cycles = [c for c in store.endgame_cycles() if self.now is None or parse_iso(c.ends) <= self.now]
        first_cycle = min(cycles, key=lambda c: parse_iso(c.ends), default=None)
        endgame_first = None if first_cycle is None else (
            game_day(parse_iso(first_cycle.starts), server), game_day(parse_iso(first_cycle.ends), server)
        )
        return _Coverage(
            wishes=min(self.wish_days, default=None),
            wishes_to=self._wishes_to(),
            sessions=sessions,
            achievements=_earliest(self.history.tracking_since(), self.ticks[0] if self.ticks else None),
            primogems=_earliest(ledger, diary_start),
            resin=resin,
            endgame=min((game_day(parse_iso(c.ends), server) for c in cycles), default=None),
            endgame_first=endgame_first,
        )

    def _wishes_to(self) -> date | None:
        """The last game day the wish history covers: that of the newest import run of the account that finished ok, or of
        the newest wish kept when that is later (a run that failed after keeping some)."""
        if self.uid is None:
            return None
        runs = [
            game_day(run.finished_at, self.server)
            for run in self.store.wish_imports(_ALL_IMPORTS)
            if run.uid == self.uid and run.outcome == "ok" and run.finished_at is not None
        ]
        return max([*runs, *self.wish_days], default=None)

    @cached_property
    def primogem_months(self) -> dict[str, int]:
        """The primogems of each month that has some, the Overview's own values."""
        start = self.coverage.primogems
        if start is None or start > self.today:
            return {}
        shown = len(_months_between(_ym(start), _ym(self.today)))
        return dict(income.month_values(self.store, self.uid, self.server, self.diary, self.today, shown))

    def reaches(self, start: date | None, ym: str) -> bool:
        """Whether a source that begins on `start` has anything from the month on."""
        return start is not None and start <= min(_last_day(ym), self.today)

    def fully(self, start: date | None, ym: str) -> bool:
        """Whether it covers the whole month."""
        return start is not None and start <= _first_day(ym)

    def present(self, ym: str) -> list[str]:
        """The ids of the five numbers the month has."""
        cover = self.coverage
        have = {
            "time": self.reaches(cover.sessions, ym),
            "days": self.reaches(cover.sessions, ym),
            "primogems": ym in self.primogem_months,
            "wishes": self.reaches(cover.wishes, ym) and cover.wishes_to is not None
            and _first_day(ym) <= cover.wishes_to,
            "achievements": self.reaches(cover.achievements, ym),
        }
        return [tile_id for tile_id, _, _ in TILES if have[tile_id]]

    def wishes_complete(self, ym: str) -> bool:
        """Whether the wish history reaches the month's last day (to today, for this month)."""
        end = self.coverage.wishes_to
        return end is not None and end >= min(_last_day(ym), self.today)

    def first_ym(self) -> str | None:
        first = self.coverage.earliest()
        return _ym(first) if first is not None and first <= self.today else None

    # ------------------------------------------------------------------ the numbers of a stretch of days
    def minutes(self, first: date, last: date) -> dict[date, float]:
        return self.history.playtime_minutes(first, last, self.server)

    def wishes_between(self, first: date, last: date) -> list[WishRow]:
        return [row for row, day in zip(self.rows, self.wish_days) if first <= day <= last]

    def earned(self, first: date, last: date) -> list[income.EarnedDay]:
        return income.earned_days(self.store, self.uid, self.server, first, last)

    def ticked(self, first: date, last: date) -> list[date]:
        return [day for day in self.ticks if first <= day <= last]


# ---------------------------------------------------------------------------------------------- the list


def first_month(store: Store, history: History, uid: int | None, server: str) -> str | None:
    """The earliest "YYYY-MM" any source reaches, None when none does. The wish history, the ledger, the diary, the
    sessions, the achievements and the endgame cycles are the sources."""
    return _Month(store, history, uid, server, date.max, {}).first_ym()


def _list(data: _Month) -> list[dict[str, Any]]:
    first = data.first_ym()
    if first is None:
        return []
    current = _ym(data.today)
    return [
        {
            "ym": ym,
            "label": MONTH_NAMES[int(ym[5:]) - 1],
            "year": int(ym[:4]),
            "thin": len(data.present(ym)) < THIN_BELOW,
            "current": ym == current,
        }
        for ym in _months_between(first, current)
    ]


def month_list(
    store: Store, history: History, uid: int | None, server: str, today: date, states: Mapping[str, PoolState],
) -> list[dict[str, Any]]:
    """Every month from the first any source reaches to the one of `today`, oldest first. `states` are the Pulls page's."""
    return _list(_Month(store, history, uid, server, today, states))


# ---------------------------------------------------------------------------------------------- one month


def build_month(
    store: Store, history: History, uid: int | None, server: str, ym: str, today: date,
    states: Mapping[str, PoolState], now: datetime,
) -> dict[str, Any]:
    """The month `ym` in full. `states` are the wishes' states the Pulls page shows (always the Pulls page's own, with its
    corrections and windows, so that a pity is the same on both pages), and `now` tells the cycles that have ended."""
    return _build(_Month(store, history, uid, server, today, states, now), ym)


def stats_month(
    store: Store, history: History, uid: int | None, server: str, ym: str | None, today: date,
    states: Mapping[str, PoolState], now: datetime,
) -> dict[str, Any]:
    """The answer of GET /api/stats/month: the list of months and the month chosen, which is `ym` when the list has it and
    else the newest. Both are None-free of guesses: with no month at all, the list is empty and the month None."""
    data = _Month(store, history, uid, server, today, states, now)
    months = _list(data)
    if not months:
        return {"months": [], "month": None}
    chosen = ym if isinstance(ym, str) and any(entry["ym"] == ym for entry in months) else months[-1]["ym"]
    return {"months": months, "month": _build(data, chosen)}


def _build(data: _Month, ym: str) -> dict[str, Any]:
    if not _valid(ym):
        raise ValueError(f"unknown month: {ym!r}")
    today = data.today
    first, last = _first_day(ym), min(_last_day(ym), today)
    current = ym == _ym(today)
    before = _before(ym)
    before_first = _first_day(before)
    if current:
        before_last = min(_last_day(before), before_first + timedelta(days=today.day - 1))
        compare_label = "vs " + span_label(before_first, before_last)
    else:
        before_last = _last_day(before)
        compare_label = "vs " + FULL_MONTH_NAMES[before_first.month - 1]
    present = data.present(ym)
    cover = data.coverage

    # The days played and their minutes, where the sessions reach the month.
    minutes: dict[date, float] | None = None
    if "time" in present:
        minutes = data.minutes(max(first, cover.sessions), last)  # type: ignore[type-var]
    wishes = data.wishes_between(first, last) if "wishes" in present else []
    value: dict[str, int] = {}
    if minutes is not None:
        value["time"] = round(sum(minutes.values()))
        value["days"] = sum(1 for played in minutes.values() if played > 0)
    if "primogems" in present:
        value["primogems"] = int(data.primogem_months[ym])
    if "wishes" in present:
        value["wishes"] = len(wishes)
    if "achievements" in present:
        value["achievements"] = len(data.ticked(first, last))

    delta = _deltas(data, ym, before, before_first, before_last, present, value, current)
    tiles = []
    for tile_id, label, unit in TILES:
        if tile_id not in present:
            continue
        tile: dict[str, Any] = {
            "id": tile_id, "label": label, "value": value[tile_id], "unit": unit, "delta": delta.get(tile_id),
        }
        if tile_id == "wishes":
            tile["faces"] = [
                {"name": row.name, "icon": wish_icon(wish_kind(row.item_type), row.name, data.wiki)}
                for row in wishes if row.rank == 5
            ]
        tiles.append(tile)

    return {
        "ym": ym,
        "label": f"{FULL_MONTH_NAMES[first.month - 1]} {first.year}",
        "so_far": current,
        "compare_label": compare_label,
        "tiles": tiles,
        "records": _records(data, first, last, minutes, wishes, "primogems" in present),
        "days": _days(first, ym, today, minutes),
        "sources": _sources(data, ym) if "primogems" in present else [],
        "resin": _resin(data, first, last),
        "endgame": _endgame(data, first, last),
        "pulls": _pulls(data, wishes),
        "since": _since(data, ym),
    }


# ---------------------------------------------------------------------------------------------- the comparison


def _deltas(
    data: _Month, ym: str, before: str, before_first: date, before_last: date, present: Sequence[str],
    value: Mapping[str, int], current: bool,
) -> dict[str, int]:
    """Each number's change from the month before, or from its first days up to the same day for the month in progress.
    Only where the source covers all of the days compared: a month the source began inside is not a month to compare
    with."""
    cover, delta = data.coverage, {}
    whole = before_last == _last_day(before)

    if "time" in present and data.fully(cover.sessions, before):
        before_minutes = data.minutes(before_first, before_last)
        delta["time"] = value["time"] - round(sum(before_minutes.values()))
        delta["days"] = value["days"] - sum(1 for played in before_minutes.values() if played > 0)
    if "wishes" in present and data.fully(cover.wishes, before) and data.wishes_complete(ym):
        delta["wishes"] = value["wishes"] - len(data.wishes_between(before_first, before_last))
    if "achievements" in present and data.fully(cover.achievements, before):
        delta["achievements"] = value["achievements"] - len(data.ticked(before_first, before_last))
    if "primogems" in present and data.fully(cover.primogems, before):
        if whole and before in data.primogem_months:
            delta["primogems"] = value["primogems"] - int(data.primogem_months[before])
        else:
            days = data.earned(before_first, before_last)
            if days and not any(day.no_data for day in days):
                delta["primogems"] = value["primogems"] - sum(day.value for day in days)
    return delta


# ---------------------------------------------------------------------------------------------- the parts


def _days(first: date, ym: str, today: date, minutes: Mapping[date, float] | None) -> list[dict[str, Any]] | None:
    """The month's days as the Playtime calendar colours them; a day before the sessions began or after today is not
    known, and has neither minutes nor level."""
    if minutes is None:
        return None
    out = []
    for day in days_inclusive(first, _last_day(ym)):
        if day in minutes:
            out.append({"day": day.isoformat(), "minutes": round(minutes[day]), "level": play_level(minutes[day])})
        else:
            out.append({"day": day.isoformat(), "minutes": None, "level": None})
    return out


def _records(
    data: _Month, first: date, last: date, minutes: Mapping[date, float] | None, wishes: Sequence[WishRow],
    has_primogems: bool,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if minutes is not None:
        longest = _longest_session(data, first, last)
        if longest is not None:
            records.append(_record("longest_session", longest[0], "minutes", day_label(longest[1])))
    if has_primogems:
        known = [day for day in data.earned(first, last) if not day.no_data and day.value > 0]
        if known:
            best = max(known, key=lambda day: day.value)  # the first of equal days
            records.append(_record("best_primogem_day", best.value, "primogems", day_label(best.day)))
    if minutes is not None:
        days = sorted(minutes)
        run = _longest_run_span([minutes[day] > 0 for day in days], days)
        if run is not None:
            records.append(_record("longest_run", run[0], "days", span_label(run[1], run[2])))
    luckiest = _luckiest(data, wishes)
    if luckiest is not None:
        five, icon = luckiest
        record = _record("luckiest", five.pity, "pulls", day_label(game_day(five.wish.at, data.server)))
        record.update({"name": five.wish.name, "icon": icon})
        records.append(record)
    return records


def _record(record_id: str, value: int | None, unit: str, when: str | None) -> dict[str, Any]:
    return {"id": record_id, "label": RECORD_LABELS[record_id], "value": value, "unit": unit, "when": when}


def _longest_session(data: _Month, first: date, last: date) -> tuple[int, date] | None:
    """The longest session in minutes, clipped to the month's game days, and the game day it began on."""
    start, end = game_day_start(first, data.server), game_day_start(last + timedelta(days=1), data.server)
    best: tuple[float, date] | None = None
    for session in data.store.sessions_overlapping(start, end):
        began, ended = max(session.started_at, start), min(session.ended_at, end)
        length = (ended - began).total_seconds() / 60
        if length > 0 and (best is None or length > best[0]):
            best = (length, game_day(began, data.server))
    return (round(best[0]), best[1]) if best is not None and round(best[0]) > 0 else None


def _longest_run_span(flags: Sequence[bool], days: Sequence[date]) -> tuple[int, date, date] | None:
    """The longest run of played days (the first of equal runs) with the days it began and ended on; None with none."""
    length = longest_run(flags)
    if length == 0:
        return None
    run = 0
    for index, flag in enumerate(flags):
        run = run + 1 if flag else 0
        if run == length:
            return length, days[index - length + 1], days[index]
    return None


def _luckiest(data: _Month, wishes: Sequence[WishRow]) -> tuple[FiveStar, str | None] | None:
    """The 5★ of the month with the lowest pity that is known; a 5★ whose count is not known is never the luckiest."""
    ids = {row.id for row in wishes if row.rank == 5}
    fives = [five for state in data.states.values() for five in state.fives if five.wish.id in ids]
    known = [five for five in fives if five.pity is not None]
    if not known:
        return None
    best = min(known, key=lambda five: (five.pity, five.wish.id))
    return best, wish_icon(best.wish.kind, best.wish.name, data.wiki)


def _sources(data: _Month, ym: str) -> list[dict[str, Any]]:
    """The month's primogems by source: the ledger's groups where the month has exact days, so that they add up to its
    value; else the diary's own for that month."""
    exact = income.month_sources(data.store, data.uid, data.server, ym, data.today)
    if exact is not None:
        return [{"name": name, "amount": amount} for name, amount in exact]
    doc = data.store.latest_doc("diary")
    if doc is None:
        return []
    year, month = int(ym[:4]), int(ym[5:])
    for entry in doc[1].get("months", []):
        if entry.get("year") == year and entry.get("month") == month:
            return [{"name": source["name"], "amount": source["amount"]} for source in entry["sources"]]
    return []


def _resin(data: _Month, first: date, last: date) -> list[dict[str, Any]]:
    """The resin spent in the month by reason, the largest first, over the days the game's resin log covers whole."""
    start = data.coverage.resin
    if data.uid is None or start is None or start > last:
        return []
    newest = data.store.newest_ledger_entry(data.uid, "resin")
    end = min(last, game_day(newest.at, data.server)) if newest is not None else last
    since = game_day_start(max(first, start), data.server) - timedelta(seconds=1)
    spent: dict[str, int] = {}
    for row in data.store.ledger_entries(data.uid, "resin", since=since):
        if row.amount < 0 and max(first, start) <= game_day(row.at, data.server) <= end:
            spent[row.reason] = spent.get(row.reason, 0) - row.amount
    return [{"name": name, "amount": amount} for name, amount in sorted(spent.items(), key=lambda item: (-item[1], item[0]))]


def _result(mode: str, detail: Mapping[str, Any]) -> str | None:
    if mode == "abyss" and detail.get("stars") is not None:
        return f"{detail['stars']} of 36 stars"
    if mode == "theater" and detail.get("acts") is not None:
        return f"Act {detail['acts']} reached"
    if mode == "stygian" and detail.get("difficulty") is not None:
        return f"Difficulty {detail['difficulty']} cleared"
    return None


def _endgame(data: _Month, first: date, last: date) -> list[dict[str, Any]]:
    """The results of the cycles that ended in the month, in the order they ended."""
    out = []
    for cycle in data.store.endgame_cycles():
        ended = parse_iso(cycle.ends)
        if not first <= game_day(ended, data.server) <= last or (data.now is not None and ended > data.now):
            continue
        result = _result(cycle.mode, cycle.detail)
        if result is not None and cycle.mode in MODE_LABELS:
            out.append({"mode": cycle.mode, "label": MODE_LABELS[cycle.mode], "result": result})
    return out


def _pulls(data: _Month, wishes: Sequence[WishRow]) -> dict[str, Any]:
    """The wishes of the month by banner, and each 5★ with its pity."""
    counts: dict[str, int] = {}
    for row in wishes:
        counts[row.pool] = counts.get(row.pool, 0) + 1
    # `kind` is the pool's own name, which the interface colours a bar by and words a 5-star's result by.
    banners = [
        {"label": POOL_LABELS.get(pool, pool), "kind": pool, "wishes": counts[pool]} for pool in ALL_POOLS if pool in counts
    ]
    banners += [
        {"label": POOL_LABELS.get(pool, pool), "kind": pool, "wishes": count}
        for pool, count in counts.items()
        if pool not in ALL_POOLS
    ]
    known = {five.wish.id: five for state in data.states.values() for five in state.fives}
    fives = []
    for row in wishes:
        if row.rank != 5:
            continue
        five = known.get(row.id)
        fives.append(
            {
                "name": row.name,
                "icon": wish_icon(wish_kind(row.item_type), row.name, data.wiki),
                "pool": row.pool,
                "pity": five.pity if five is not None else None,
                "result": five.result if five is not None else None,
            }
        )
    return {"banners": banners, "fives": fives}


def _note(part: str, start: date, plural: bool) -> dict[str, str]:
    """A quiet note: the part, the day its source begins with the year, and the sentence the page shows."""
    since = day_label(start, always_year=True)
    return {"part": part, "since": since, "text": f"{part} {'are' if plural else 'is'} tracked from {since}."}


def _endgame_note(cycle: tuple[date, date]) -> dict[str, str]:
    """The endgame's note, which names its first cycle whole: a cycle counts in the month it ends, while the Year counts the
    mode from the cycle's first day ("since 16 Jul"), and both are said so that they never read as two different starts."""
    start, end = cycle
    since = day_label(end, always_year=True)
    text = f"Endgame cycles count in the month they end. The first one kept ran from {day_label(start, end.year)} to {since}."
    return {"part": "Endgame", "since": since, "text": text}


def _since(data: _Month, ym: str) -> list[dict[str, str]]:
    """The quiet notes of a month, which say from when a part is kept. A part whose source begins inside the month, after
    its first day, has a note of its own. The parts left out because their source begins after the month are named in one
    line for each start date: "Playtime and achievements" since "19 Oct 2026". The endgame, kept from the end of its first
    cycle, always has a note of its own, last, which names that cycle (`_endgame_note`). Every date carries its year, and
    each note carries its sentence, so that the page guesses no verb."""
    cover = data.coverage
    first, last = _first_day(ym), _last_day(ym)
    # (name inside the month, name when joined in a line, whether it is plural, where its source begins)
    parts = (
        ("Time in Teyvat", "Playtime", False, cover.sessions),
        ("Primogems earned", "Primogems", True, cover.primogems),
        ("Wishes", "Wishes", True, cover.wishes),
        ("Achievements", "Achievements", True, cover.achievements),
        ("Resin spent", "Resin", False, cover.resin),
    )
    notes = [
        _note(inside, start, plural)
        for inside, _, plural, start in parts
        if start is not None and first < start <= min(last, data.today)
    ]
    by_start: dict[date, list[str]] = {}
    for _, joined, _, start in parts:
        if start is not None and start > last:
            by_start.setdefault(start, []).append(joined)
    for start in sorted(by_start):
        names = [name if index == 0 else name.lower() for index, name in enumerate(by_start[start])]
        part = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
        plural = len(names) > 1 or names[0] in ("Primogems", "Wishes", "Achievements")
        notes.append(_note(part, start, plural))
    if cover.endgame_first is not None and cover.endgame_first[1] > first:
        notes.append(_endgame_note(cover.endgame_first))
    return notes
