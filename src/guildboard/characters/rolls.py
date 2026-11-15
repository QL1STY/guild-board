"""The artifact roll tables and Crit Value tiers (the Plan page's and the simulator's design, section 5).

The values are the game's own, read from tables.json: the four roll values of every substat (70, 80, 90 and 100 percent of
the largest) and each main stat at every level. The game shows a percentage to one decimal and a flat stat as a whole
number, so a shown value is matched against a sum of rolls at that precision; a sum exactly between two shown values may
have been rounded either way, so both count."""
from __future__ import annotations

import math
from functools import lru_cache
from itertools import combinations_with_replacement

from guildboard.characters import reference

_FLAT = frozenset({"hp", "atk", "def", "em"})   # shown as whole numbers; every other stat is a percentage, shown to one decimal
_TIE = 1e-6

CV_THRESHOLDS = (15.0, 25.0, 35.0, 45.0, 50.0, 54.4)      # a piece's Crit Value, tiers 1 to 6
SET_THRESHOLDS = (180.0, 200.0, 220.0, 240.0, 260.0, 300.0)   # the five pieces' total
CRIT_MAIN_BONUS = 7.77                                       # a Crit Rate or Crit DMG main stat is graded as if it were one top roll

ROLLS: dict[int, dict[str, tuple[float, float, float, float]]] = {
    rarity: {stat: tuple(values) for stat, values in reference.load_tables()[f"rolls_{rarity}"].items()} for rarity in (5, 4)
}


def main_value(stat: str, level: int, rarity: int = 5) -> float:
    """A main stat's value at a level: +0 to +20 for a 5-star, +0 to +16 for a 4-star. A level outside that raises ValueError."""
    column = reference.load_tables()[f"mains_by_level_{rarity}"][stat]
    if not 0 <= level < len(column):
        raise ValueError(f"a {rarity}-star artifact has no level +{level}")
    return column[level]


# The most rolls one substat can hold: the roll when it appears, and every upgrade it can get. A 5-star has 5 upgrades and may
# start with all four substats (1 + 5). A 4-star has 4 level-ups and starts with 2 or 3 substats; one that starts with 3 spends
# its first level-up on the fourth substat, leaving 3 upgrades (1 + 3).
_MAX_ROLLS = {5: 6, 4: 4}


def _max_rolls(rarity: int) -> int:
    return _MAX_ROLLS[rarity]


@lru_cache(maxsize=None)
def _sums(stat: str, rarity: int, n: int) -> frozenset[float]:
    """Every sum of n rolls of a substat, whatever the tiers."""
    return frozenset(round(sum(ROLLS[rarity][stat][t] for t in tiers), 6) for tiers in _tiers(stat, rarity, n))


def _tiers(stat: str, rarity: int, n: int):
    return combinations_with_replacement(range(len(ROLLS[rarity][stat])), n)


def _shown(stat: str, total: float) -> set[int]:
    """What the game can show for a sum, in its own units (tenths of a percent, or whole numbers): two numbers on a tie."""
    units = total if stat in _FLAT else total * 10
    low = math.floor(units)
    if abs(units - low - 0.5) < _TIE:
        return {low, low + 1}
    return {math.floor(units + 0.5)}


def _units(stat: str, value: float) -> int:
    return round(value if stat in _FLAT else value * 10)


def reachable(stat: str, value: float, rarity: int = 5) -> list[int]:
    """The numbers of rolls (1 up to the most a substat can have) that can show this value."""
    want = _units(stat, value)
    return [n for n in range(1, _max_rolls(rarity) + 1) if any(want in _shown(stat, total) for total in _sums(stat, rarity, n))]


def split_rolls(stat: str, value: float, count: int, rarity: int = 5) -> tuple[int, ...] | None:
    """The first way (tier indexes 0 to 3, sorted) that `count` rolls can show this value; None when none can."""
    if not 1 <= count <= _max_rolls(rarity):
        return None
    want = _units(stat, value)
    for tiers in _tiers(stat, rarity, count):
        if want in _shown(stat, round(sum(ROLLS[rarity][stat][t] for t in tiers), 6)):
            return tiers
    return None


def _tier(score: float, thresholds: tuple[float, ...]) -> int:
    score = round(score, 6)
    return sum(1 for limit in thresholds if score >= limit)


def cv_tier(cv: float, crit_main: bool) -> int:
    """A piece's tier, 0 to 6, from its Crit Value (Crit Rate x 2 + Crit DMG); a Crit main stat is graded with +7.77."""
    return _tier(cv + CRIT_MAIN_BONUS if crit_main else cv, CV_THRESHOLDS)


def set_tier(total: float) -> int:
    """The five pieces' total Crit Value as a tier, 0 to 6."""
    return _tier(total, SET_THRESHOLDS)
