"""The balance of a kind of currency at the end of a game day, if one is known (the Ledger revamp design, section 8a).

This is the one interface every view of the Ledger draws a balance through. Today only the primogems have an answer: the
balance the player typed in Pulls' savings ledger, moved on to now by Pulls (`Estimate.primogems`), and carried back
through every primogem entry. A kind with no balance (the crystals, the resin, the artifacts) answers None, and its view
draws what came in and went out instead. A later typed balance for the crystals or the Fates answers through here, and its
view changes from "bought and spent" to "held" with nothing else changed.

The figures are the game's own history and Pulls' estimate; nothing is read from the account or the game.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import TYPE_CHECKING

from guildboard.gameday import days_inclusive, game_day, game_day_start
from guildboard.ledger import income
from guildboard.store import Store

if TYPE_CHECKING:
    from guildboard.pulls.savings import Estimate

PRIMOGEM = income.PRIMOGEM
_SECOND = timedelta(seconds=1)


def daily_net(store: Store, uid: int, server: str, first: date, last: date) -> dict[date, int]:
    """The signed sum of the primogems of each game day from `first` to `last`, in and out, bought ones too. A day the
    game's log has entries on is those entries' sum; a day only the diary's detail covers is what it shows earned; a day
    of neither is 0, as Pulls' estimate counts it."""
    logged: dict[date, int] = defaultdict(int)
    for row in store.ledger_entries(uid, PRIMOGEM, since=game_day_start(first, server) - _SECOND):
        day = game_day(row.at, server)
        if day <= last:
            logged[day] += row.amount
    exact = income.earned_by_day(store, uid, server, first, last)
    out: dict[date, int] = {}
    for day in days_inclusive(first, last):
        if day in logged:
            out[day] = logged[day]
        elif day in exact:
            out[day] = sum(exact[day].values())
        else:
            out[day] = 0
    return out


def held_by_day(
    kind: str, days: list[date], *, store: Store, uid: int | None, server: str, today: date, estimate: Estimate | None
) -> dict[date, int] | None:
    """The balance of `kind` at the end of each of `days` (those up to `today`), or None when no balance is known for the
    kind. The primogems' is Pulls' estimate for today, and each earlier day's the next day's balance less the next day's
    net."""
    if kind != PRIMOGEM or uid is None or estimate is None:
        return None
    wanted = [day for day in days if day <= today]
    if not wanted:
        return {}
    first = min(wanted)
    net = daily_net(store, uid, server, first, today)
    held: dict[date, int] = {}
    value = estimate.primogems
    for day in reversed(days_inclusive(first, today)):
        held[day] = value
        value -= net[day]
    return {day: held[day] for day in wanted}
