"""`GET /api/primogems`: what the Primogems widget draws besides the balance (the widgets design, 2.2): the primogems earned
today, this week and on each of the last seven game days, and this month's by source. The same days the Ledger sums
(`income.earned_by_day`), read once for all of it (audit M9)."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from guildboard.gameday import days_inclusive, week_start
from guildboard.ledger import income
from guildboard.ledger.reasons import GROUP_LABELS, GROUPS
from guildboard.store import Store, iso

DAYS_SHOWN = 7
MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December",
)


def build_primogems(store: Store, uid: int | None, server: str, today: date) -> dict[str, Any]:
    """The widget's model. `imported` is false until the game's primogem log has an entry, and every other field is
    then None: the widget says so and shows no zeros. `days` are the last seven game days, today last, a day neither the
    game's log nor the diary's detail covers `known: false`; `today` and `week` add up the known days alone, and are None
    while today is not known; the week begins at Monday's reset. `month` is this month by source, None while no day of it
    is known."""
    if uid is None or store.newest_ledger_entry(uid, income.PRIMOGEM) is None:
        return {"imported": False, "read_at": None, "today": None, "week": None, "days": None, "month": None}
    first_day = today - timedelta(days=DAYS_SHOWN - 1)
    month_first = today.replace(day=1)
    exact = income.earned_by_day(store, uid, server, min(first_day, month_first, week_start(today)), today)
    days = [
        {"day": day.isoformat(), "earned": sum(exact[day].values()) if day in exact else 0, "known": day in exact}
        for day in days_inclusive(first_day, today)
    ]
    read = store.last_ledger_import(uid)
    return {
        "imported": True,
        "read_at": iso(read) if read is not None else None,
        "today": sum(exact[today].values()) if today in exact else None,
        "week": (
            sum(sum(exact[day].values()) for day in days_inclusive(week_start(today), today) if day in exact)
            if today in exact else None
        ),
        "days": days,
        "month": _month(exact, today),
    }


def _month(exact: dict[date, dict[str, int]], today: date) -> dict[str, Any] | None:
    """This month's known days by source, the largest first as the Ledger's `month` gives them."""
    sources = dict.fromkeys(GROUPS, 0)
    known = False
    for day, groups in exact.items():
        if day.replace(day=1) == today.replace(day=1):
            known = True
            for group, amount in groups.items():
                sources[group] += amount
    if not known:
        return None
    return {
        "ym": f"{today.year:04d}-{today.month:02d}",
        "name": MONTH_NAMES[today.month - 1],
        "total": sum(sources.values()),
        "sources": [
            {"group": group, "label": GROUP_LABELS[group], "amount": sources[group]}
            for group in sorted((g for g in GROUPS if sources[g] > 0), key=lambda g: -sources[g])
        ],
    }
