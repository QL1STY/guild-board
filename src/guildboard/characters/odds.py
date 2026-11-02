"""The odds of an artifact (the design, section 7.6), as the planner mockup's model has them.

One run of a 5-star artifact domain gives `yields["artifact_5star"]` (1.065) pieces. A piece is of the slot wanted one time in
five, has the main stat wanted with the chance `main_odds` gives, and has at least one crit substat with a chance of 0.52 (0.32
when the main stat is itself a crit stat, since one crit substat is then taken). Those two are the weights' exact values rounded,
as the mockup rounds them. A domain gives its set's pieces and another set's in equal parts."""
from __future__ import annotations

from typing import Sequence

from guildboard.characters.models import Refs

SLOT_IN_FIVE = 0.2
CRIT_SUBSTAT = 0.52
CRIT_SUBSTAT_WITH_CRIT_MAIN = 0.32


def _piece(slot: str, main: str, crit_main: bool, refs: Refs) -> float:
    return SLOT_IN_FIVE * refs.main_odds.get(slot, {}).get(main, 0.0) * (CRIT_SUBSTAT_WITH_CRIT_MAIN if crit_main else CRIT_SUBSTAT)


def per_run(slot: str, main: str, crit_main: bool, off_set: bool, refs: Refs) -> float:
    """The chance that one domain run gives the piece wanted: the right slot, main stat and a crit substat. `crit_main` is
    True when the main stat is Crit Rate or Crit DMG. With `off_set` True a piece of any set will do (any domain works);
    False wants her set's piece, which is half of a domain's drops."""
    return refs.yields.get("artifact_5star", 1.065) * _piece(slot, main, crit_main, refs) * (1.0 if off_set else 0.5)


def per_strongbox(slot: str, main: str, crit_main: bool, refs: Refs) -> float:
    """The chance that one try at a Strongbox gives the piece wanted, from her set (the mockup's model: the same piece chance,
    with no domain yield)."""
    return _piece(slot, main, crit_main, refs)


def chance(p: float, runs: int) -> float:
    """The chance of at least one in `runs` runs of chance `p` each."""
    if runs <= 0 or p <= 0:
        return 0.0
    return 1.0 - (1.0 - p) ** runs


def day_reaching(p: float, runs_by_day: Sequence[int], q: float) -> int | None:
    """The first day (an index into `runs_by_day`, the runs made by the end of each day) on which the chance reaches `q`."""
    for day, runs in enumerate(runs_by_day):
        if chance(p, runs) >= q:
            return day
    return None
