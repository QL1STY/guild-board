"""What a player can share (the online design, section 6): one small dictionary for each stat, made from what this PC
already knows, and what the profile carries of the game account. Any number is None while Guild Board doesn't know it, and
None is left out of Compare; nothing here reads a token, and nothing here decides what leaves the PC (`Online` does)."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from guildboard.gameday import days_inclusive, week_start
from guildboard.ledger import income
from guildboard.metrics import ENDGAME_KEYS, MONTH_PREFIX
from guildboard.pulls.rules import PoolState
from guildboard.views.achievements import achievement_totals
from guildboard.views.ledger import spent_in
from guildboard.views.pulls import pity_card
from guildboard.views.stats import CHEST_KEYS, longest_run

MONTHS = 6
WEEKS = 6
LAST_DAYS = 30
WISH_DAYS = 90
PITY_POOL = "character"  # the character banner's count is the pity a player talks about (the online design, section 6)


def collect_stats(core: Any) -> dict[str, dict[str, Any]]:
    """Every stat, as the online plan's contract has it, in `STAT_KEYS` order, whether it is switched on or not."""
    return {
        "primogems": _primogems(core),
        "playtime": _playtime(core),
        "achievements": _achievements(core),
        "endgame": _endgame(core),
        "account": _account(core),
        "wishes": _wishes(core),
        "spending": _spending(core),
    }


def profile_facts(core: Any) -> dict[str, Any] | None:
    """What the profile carries of the game account: its UID, AR and picture link. None without a HoYoLAB login: the
    profile then keeps its last values (the online design, section 4)."""
    account = core._account()
    if account is None or account["uid"] is None:
        return None
    overview = core.store.latest_doc("overview")
    # Not the account's picture_url, which is the local route that serves it: friends need HoYoverse's own address.
    link = overview[1].get("picture_url") if overview is not None else None
    return {"uid": account["uid"], "ar": account["adventure_rank"], "picture_url": link or None}


def _month_starts(today: date) -> list[date]:
    """The first day of this month and of the five before it, oldest first."""
    year, month = today.year, today.month
    starts = []
    for _ in range(MONTHS):
        starts.append(date(year, month, 1))
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return starts[::-1]


def _primogems(core: Any) -> dict[str, Any]:
    """Each month as Stats shows it, so that a friend reads the player's own number: the diary's total where the game's log
    says nothing, which for the first month tracked is more than Guild Board saw itself."""
    today = core.today()
    savings = core._savings()
    diary = {key[len(MONTH_PREFIX):]: int(value) for key, value in core.store.latest_values(MONTH_PREFIX).items()}
    earned = dict(income.month_values(core.store, core.ledger_uid(), core.server(), diary, today, MONTHS))
    return {
        "now": savings["primogems"] if savings is not None else None,
        "months": [
            {"month": month, "earned": earned.get(month)}
            for month in (start.isoformat()[:7] for start in _month_starts(today))
        ],
    }


def _hours(minutes: float) -> float:
    return round(minutes / 60, 1)


def _playtime(core: Any) -> dict[str, Any]:
    """`week_start` is the Monday of the last of the six weeks. The weeks hold no dates, and a friend's Guild Board that last
    uploaded long ago would show its old week as this one: whoever reads them lines them up by this (the online plan, C0)."""
    today, server, history = core.today(), core.server(), core.history
    this_week = week_start(today)
    since = history.tracking_since()
    if since is None and core.store.last_session() is None:
        return {
            "week_hours": None, "days30_hours": None, "weeks": [None] * WEEKS, "week_start": this_week.isoformat(),
            "longest_run": None,
        }
    first = min(since or today, this_week - timedelta(weeks=WEEKS - 1), today - timedelta(days=LAST_DAYS - 1))
    minutes = history.playtime_minutes(first, today, server)
    weeks: list[float | None] = []
    for back in range(WEEKS - 1, -1, -1):
        start = this_week - timedelta(weeks=back)
        tracked = since is None or start + timedelta(days=6) >= since
        weeks.append(_hours(sum(minutes.get(day, 0.0) for day in days_inclusive(start, start + timedelta(days=6)))) if tracked else None)
    active = history.daily_change(["stats.days_active"], first, today)
    return {
        "week_hours": weeks[-1],
        "days30_hours": _hours(sum(minutes.get(day, 0.0) for day in days_inclusive(today - timedelta(days=LAST_DAYS - 1), today))),
        "weeks": weeks,
        "week_start": this_week.isoformat(),
        "longest_run": longest_run([day.delta > 0 or minutes.get(day.day, 0.0) > 0 for day in active]),
    }


def _achievements(core: Any) -> dict[str, Any]:
    totals = achievement_totals(core.lists.current(), core.store)
    if not totals["stages"]:
        return {"ticked": None, "total": None}
    return {"ticked": totals["done"], "total": totals["stages"]}


def _point(core: Any, key: str) -> int | None:
    found = core.store.latest_point(key)
    return int(found[0]) if found is not None else None


def _endgame(core: Any) -> dict[str, Any]:
    return {
        "abyss_stars": _point(core, ENDGAME_KEYS["abyss"]),
        "theater_act": _point(core, ENDGAME_KEYS["theater"]),
        "stygian": _point(core, ENDGAME_KEYS["stygian"]),
    }


def _account(core: Any) -> dict[str, Any]:
    chests = [count for count in (_point(core, key) for key in CHEST_KEYS) if count is not None]
    return {
        "days_active": _point(core, "stats.days_active"),
        "characters": _point(core, "stats.characters"),
        "chests": sum(chests) if chests else None,
    }


def _pity(state: PoolState) -> int | None:
    card = pity_card(state, None)
    return card["pity"] if card["known"] else None


def _wishes(core: Any) -> dict[str, Any]:
    uid = core.pulls.uid()
    if uid is None:
        return {"pity": None, "five_stars_90d": None}
    since = core.clock.now() - timedelta(days=WISH_DAYS)
    return {
        "pity": _pity(core.pulls.states(uid)[PITY_POOL]),
        "five_stars_90d": sum(1 for wish in core.store.wishes(uid) if wish.rank == 5 and wish.at > since),
    }


def _spending(core: Any) -> dict[str, Any]:
    """`month` names the month of the total, as `primogems` names each of its months: a total is no use to a friend who reads
    it in another month (the online plan, C0)."""
    uid, today = core.ledger_uid(), core.today()
    total, currency = spent_in(core.store, uid, core.settings, today.replace(day=1), today)
    known = uid is not None and core.store.last_ledger_import(uid) is not None
    return {"month_total": total if known else None, "month": today.isoformat()[:7], "currency": currency}
