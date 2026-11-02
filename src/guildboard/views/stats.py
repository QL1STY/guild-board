"""The Stats page model: what changed."""
from __future__ import annotations

from datetime import date, timedelta, tzinfo
from typing import Any, Sequence

from guildboard.gameday import days_inclusive, game_day, week_start
from guildboard.history import History
from guildboard.ledger import income
from guildboard.ledger.income import EarnedDay
from guildboard.ledger.reasons import GROUP_LABELS, GROUPS
from guildboard.metrics import ENDGAME_KEYS, MONTH_PREFIX
from guildboard.store import Store, iso, parse_iso

RANGES = {"7": 7, "30": 30, "90": 90}
RANGE_KEYS = ("7", "30", "90", "all")
CHEST_KEYS = tuple(
    f"stats.chests.{rarity}" for rarity in ("common", "exquisite", "precious", "luxurious", "remarkable")
)
DAILY_COLUMNS_UP_TO = 45
CALENDAR_WEEKS = 12
MONTHS_SHOWN = 6
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_PLAY_LIMITS = (30.0, 60.0, 120.0)
_HOUR_LIMITS = (15.0, 30.0, 45.0)
_BEST_TEXT = {"abyss": "{} stars", "theater": "Act {}", "stygian": "Difficulty {}"}
_MIN_GAIN = 0.05


def _level(minutes: float | None, limits: Sequence[float]) -> int:
    """0 for none (or not known), otherwise 1 under the first limit, and on to one more than the limits at the last."""
    if minutes is None or minutes <= 0:
        return 0
    for level, limit in enumerate(limits, start=1):
        if minutes < limit:
            return level
    return len(limits) + 1


def play_level(minutes: float) -> int:
    """0 none, 1 under 30 min, 2 under 1 h, 3 under 2 h, 4 two hours or more."""
    return _level(minutes, _PLAY_LIMITS)


def hour_level(minutes: float | None) -> int:
    """For a cell of play by the hour: 0 none, 1 under 15 min, 2 under 30 min, 3 under 45 min, 4 45 min or more."""
    return _level(minutes, _HOUR_LIMITS)


def trend(values: Sequence[float], buckets: int = 12) -> list[float]:
    """Sum `values` into at most `buckets` consecutive groups of near-equal size."""
    count = min(buckets, len(values))
    return [
        round(sum(values[index * len(values) // count : (index + 1) * len(values) // count]), 1)
        for index in range(count)
    ]


def longest_run(flags: Sequence[bool]) -> int:
    best = current = 0
    for flag in flags:
        current = current + 1 if flag else 0
        best = max(best, current)
    return best


def _exploration(store: Store, first: date, today: date) -> dict[str, Any]:
    rows, unchanged = [], 0
    for key, label in store.labels("region").items():
        point = f"{key}.pct"
        now = store.value_at_or_before(point, today)
        if now is None:
            continue
        start = store.value_before(point, first)
        if start is None:
            start = store.first_value_in(point, first, today)
        if start is not None and now - start >= _MIN_GAIN:
            rows.append({"name": label.label, "start": start, "now": now})
        else:
            unchanged += 1
    rows.sort(key=lambda row: row["start"] - row["now"])
    return {"rows": rows, "unchanged": unchanged}


def _columns(history: History, keys: Sequence[str], first: date, today: date) -> dict[str, Any]:
    """The rises of `keys` (together) as one column per game day, or per week past 45 days. The chests' columns and the
    primogems' are built alike: a day without a sync is marked, and so is the column that takes the days after a gap."""
    daily = history.daily_change(keys, first, today)
    if len(daily) <= DAILY_COLUMNS_UP_TO:
        unit = "day"
        columns = [
            {"label": day.day.isoformat(), "value": int(day.delta), "no_data": not day.has_data, "after_gap": day.after_gap}
            for day in daily
        ]
    else:
        unit = "week"
        weeks: dict[date, list[Any]] = {}
        for day in daily:
            weeks.setdefault(week_start(day.day), []).append(day)
        columns = [
            {
                "label": start.isoformat(),
                "value": int(sum(day.delta for day in group)),
                "no_data": not any(day.has_data for day in group),
                "after_gap": any(day.after_gap for day in group),
            }
            for start, group in sorted(weeks.items())
        ]
    values = [column["value"] for column in columns]
    top = max(values, default=0)
    return {
        "unit": unit,
        "columns": columns,
        "total": sum(values),
        "max_index": values.index(top) if top > 0 else None,
    }


def _primogem_columns(days: Sequence[EarnedDay], last_import: str | None) -> dict[str, Any]:
    """Primogems earned, one column per game day, or per week past 45 days (the ledger design, section 5). An exact
    column carries its groups; a column from the diary's old total is an estimate, apart from `after_gap`."""
    if len(days) <= DAILY_COLUMNS_UP_TO:
        unit = "day"
        columns = [_primogem_column(day.day, [day]) for day in days]
    else:
        unit = "week"
        weeks: dict[date, list[EarnedDay]] = {}
        for day in days:
            weeks.setdefault(week_start(day.day), []).append(day)
        columns = [_primogem_column(start, group) for start, group in sorted(weeks.items())]
    values = [column["value"] for column in columns]
    top = max(values, default=0)
    return {
        "unit": unit,
        "columns": columns,
        "total": sum(values),
        "max_index": values.index(top) if top > 0 else None,
        "groups_order": list(GROUPS),
        "group_labels": dict(GROUP_LABELS),
        "exact": any("groups" in column for column in columns),  # some day comes from the game or the diary's detail
        "last_import": last_import,  # when the game's own history was last imported, None before
    }


def _primogem_column(start: date, days: Sequence[EarnedDay]) -> dict[str, Any]:
    column: dict[str, Any] = {
        "label": start.isoformat(),
        "value": sum(day.value for day in days),
        "no_data": all(day.no_data for day in days),
        "after_gap": any(day.after_gap for day in days),
    }
    exact = [day.groups for day in days if day.groups is not None]
    if exact:
        column["groups"] = {group: sum(groups[group] for groups in exact) for group in GROUPS}
    if any(day.estimate for day in days):
        column["estimate"] = True
    return column


def _calendar(history: History, today: date, server: str) -> dict[str, Any]:
    first = week_start(today) - timedelta(weeks=CALENDAR_WEEKS - 1)
    last = first + timedelta(days=CALENDAR_WEEKS * 7 - 1)
    minutes = history.playtime_minutes(first, today, server)
    cells = []
    for day in days_inclusive(first, last):
        if day > today:
            cells.append({"day": day.isoformat(), "minutes": None, "level": None})
        else:
            played = minutes.get(day, 0.0)
            cells.append({"day": day.isoformat(), "minutes": round(played), "level": play_level(played)})
    return {"weeks": CALENDAR_WEEKS, "first_day": first.isoformat(), "cells": cells}


def _play_hours(history: History, first: date, today: date, tz: tzinfo | None) -> dict[str, Any]:
    """Play by weekday and hour on the clock of `tz`: each cell is the minutes played in that weekday's hour, divided by
    the number of that weekday's dates in the part of the period Guild Board was tracking, so it is the minutes on an
    average Monday, Tuesday and so on (the stage 1 coverage rule). A weekday with no date in that part has `None` cells:
    it was not tracked, which is not the same as nothing played."""
    since = history.tracking_since()
    dates = days_inclusive(max(first, since), today) if since is not None else []
    days = [sum(1 for day in dates if day.weekday() == weekday) for weekday in range(7)]
    minutes = history.minutes_by_hour(dates[0], today, tz) if dates else [[0.0] * 24 for _ in range(7)]
    cells = [
        [row[hour] / days[weekday] if days[weekday] else None for hour in range(24)]
        for weekday, row in enumerate(minutes)
    ]
    return {
        "cells": cells,
        "levels": [[hour_level(cell) for cell in row] for row in cells],
        "days": days,
        "empty": not any(any(row) for row in minutes),
    }


def _primogems(store: Store, history: History, uid: int | None, server: str, today: date) -> dict[str, Any]:
    values = store.latest_values(MONTH_PREFIX)
    diary = {key[len(MONTH_PREFIX):]: int(value) for key, value in values.items()}
    months = income.month_values(store, history, uid, server, diary, today, MONTHS_SHOWN)
    current = months[-1][0] if months else None
    sources: list[dict[str, Any]] = []
    diary = store.latest_doc("diary")
    exact = income.month_sources(store, history, uid, server, current, today) if current is not None else None
    if exact is not None:
        # The month's value is the game's own log and the diary's detail on their days: its sources are the same days'
        # groups, so that they add up to it (the diary's own sources are of its own total).
        sources = [{"name": name, "amount": amount} for name, amount in exact]
    elif diary is not None and diary[1]["months"]:
        sources = [
            {"name": source["name"], "amount": source["amount"]} for source in diary[1]["months"][-1]["sources"]
        ]
    return {
        "months": [
            {"ym": ym, "label": MONTH_NAMES[int(ym[5:7]) - 1], "value": int(value), "current": ym == current}
            for ym, value in months
        ],
        "sources": sources,
    }


def _day_text(iso_text: str, server: str) -> str:
    day = game_day(parse_iso(iso_text), server)
    return f"{day.day} {MONTH_NAMES[day.month - 1]}"


def _endgame(store: Store, server: str) -> list[dict[str, Any]]:
    doc = store.latest_doc("endgame")
    if doc is None:
        return []
    rows = []
    for mode in doc[1]["modes"]:
        if mode["period_label"]:
            period = mode["period_label"]
        elif mode["period_start"] and mode["period_end"]:
            period = f"{_day_text(mode['period_start'], server)} to {_day_text(mode['period_end'], server)}"
        else:
            period = ""
        key = ENDGAME_KEYS.get(mode["mode"])
        best = store.max_value(key) if key else None
        rows.append(
            {
                "mode": mode["mode"],
                "label": mode["label"],
                "result": mode["result_text"],
                "period": period,
                "best": _BEST_TEXT[mode["mode"]].format(int(best)) if best is not None else "",
            }
        )
    return rows


def build_stats(
    store: Store, history: History, today: date, server: str, range_key: str = "30", tz: tzinfo | None = None,
    uid: int | None = None,
) -> dict[str, Any]:
    """The Stats page's model. `tz` is the zone whose clock the play by the hour follows: the player's day, which is
    this PC's, not the server's. None is this PC's own zone, summer time included. `uid` is the account whose game
    history and diary detail make the primogems exact (the ledger design, section 5); None reads the diary alone."""
    if range_key not in RANGE_KEYS:
        raise ValueError(f"unknown range: {range_key}")
    since = history.tracking_since()
    if range_key == "all":
        first = min(since or today, today)
    else:
        first = today - timedelta(days=RANGES[range_key] - 1)
    days = (today - first).days + 1
    previous_first, previous_last = first - timedelta(days=days), first - timedelta(days=1)
    coverage = history.coverage(first, today)
    compare = (
        range_key != "all" and coverage.full and history.coverage(previous_first, previous_last).full
    )

    def counted(tile_id: str, label: str, keys: Sequence[str]) -> dict[str, Any]:
        current = history.change(keys, first, today) or 0.0
        before = history.change(keys, previous_first, previous_last) if compare else None
        daily = [day.delta for day in history.daily_change(keys, first, today)]
        return {
            "id": tile_id,
            "label": label,
            "value": int(current),
            "delta": int(current - before) if before is not None else None,
            "trend": trend(daily),
        }

    minutes = history.playtime_minutes(first, today, server)
    playtime = sum(minutes.values())
    playtime_before = (
        sum(history.playtime_minutes(previous_first, previous_last, server).values()) if compare else None
    )
    active = history.daily_change(["stats.days_active"], first, today)
    played = [day.delta > 0 or minutes.get(day.day, 0.0) > 0 for day in active]
    earned = income.earned_days(store, history, uid, server, first, today)
    earned_before = (
        sum(day.value for day in income.earned_days(store, history, uid, server, previous_first, previous_last))
        if compare else None
    )
    earned_total = sum(day.value for day in earned)
    last_import = store.last_ledger_import(uid) if uid is not None else None
    tiles = [
        counted("chests", "Chests opened", CHEST_KEYS),
        counted("achievements", "Achievements earned", ["stats.achievements"]),
        {
            "id": "playtime",
            "label": "Playtime",
            "minutes": round(playtime),
            "delta_minutes": round(playtime - playtime_before) if playtime_before is not None else None,
            "trend": trend([minutes[day] for day in sorted(minutes)]),
        },
        {
            "id": "days",
            "label": "Days played",
            "value": int(history.change(["stats.days_active"], first, today) or 0),
            "of": days,
            "longest_run": longest_run(played),
        },
        {
            "id": "primogems",
            "label": "Primogems earned",
            "value": earned_total,
            "delta": earned_total - earned_before if earned_before is not None else None,
            "trend": trend([float(day.value) for day in earned]),
        },
    ]
    return {
        "range": range_key,
        "period": {"first": first.isoformat(), "last": today.isoformat(), "days": days},
        "coverage": {
            "tracking_since": since.isoformat() if since else None,
            "tracked_days": coverage.tracked_days,
            "full": coverage.full,
            "partial": range_key != "all" and not coverage.full,
            "compare": compare,
        },
        "tiles": tiles,
        "exploration": _exploration(store, first, today),
        "chests": _columns(history, CHEST_KEYS, first, today),
        "primogem_days": _primogem_columns(earned, iso(last_import) if last_import is not None else None),
        "calendar": _calendar(history, today, server),
        "play_hours": _play_hours(history, first, today, tz),
        "primogems": _primogems(store, history, uid, server, today),
        "endgame": _endgame(store, server),
    }
