"""The savings and the chances of the Pulls design (sections 2.3 and 6.1): the chance of the featured 5★ within so many
pulls from a pity and a guarantee, the balance that moves on from the figure the player typed, the forecast by a day, and
the wishlist's chain. Pure, over the rules of `rules.py`.

A distribution is a list whose index n is the chance that exactly n more pulls are needed; index 0 is unused (0.0).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime
from itertools import accumulate
from typing import Sequence

from guildboard.pulls import PULL_PRIMOGEMS
from guildboard.pulls.nextversion import NextVersion
from guildboard.pulls.rules import convolve, load_reference, pity_distribution

__all__ = [
    "Balance",
    "ChainEntry",
    "Estimate",
    "balance_now",
    "certain_within",
    "chain",
    "chance_within",
    "convolve",
    "forecast",
    "income_per_day",
    "pulls_to_featured",
]

# The weapon event with a charted weapon: of the two featured weapons, half are the charted one.
CHARTED_WHEN_GUARANTEED = 0.5  # a featured weapon is certain after a lost 75/25, which carries over between banners
CHARTED_ON_A_75_25 = 0.375  # 75% a featured weapon


def _first_is_wanted(pool: str, guaranteed: bool, path_points: int, charted: bool) -> float | None:
    """The chance that the next 5★ is the one wanted; None when it is certain to be."""
    featured = load_reference().pool(pool).featured
    if featured is None:
        raise ValueError(f"The {pool} wish has no featured item.")
    if path_points >= 1:
        return None
    if pool == "weapon" and charted:
        return CHARTED_WHEN_GUARANTEED if guaranteed else CHARTED_ON_A_75_25
    if guaranteed:  # the character event's guarantee, a featured weapon wanted, or the chronicled wish's point
        return None
    return featured


def pulls_to_featured(
    pool: str, pity: int, guaranteed: bool, *, path_points: int = 0, charted: bool = True
) -> list[float]:
    """Index n: the chance that the first featured copy needs exactly n more pulls; at most 2 × hard + 1 long.

    The next 5★ comes as `pity_distribution(pool, pity)` says. It is the one wanted for certain with a Fate Point, with
    the guarantee on the character event, and on the weapon event when any featured weapon will do (`charted` False);
    on the chronicled wish, `guaranteed` is its point. Otherwise it is the one wanted with the pool's featured rate (the
    character event's consolidated 55%, a featured weapon's 75%, the chronicled item's 50%), and else the 5★ after it is,
    from a count of 0: a lost 50/50 or 75/25 guarantees it, and on the paths the point does. The weapon event with a
    charted weapon is the exception: half the featured weapons are the charted one, so the rate is 0.5 when a featured
    weapon is guaranteed (a lost 75/25 carries over between banners, the point does not), else 0.375; after a miss the
    point makes the next 5★ the charted one. The standard wish has no featured item: ValueError."""
    featured = _first_is_wanted(pool, guaranteed, path_points, charted)
    first = pity_distribution(pool, pity)
    if featured is None:
        return first
    after_a_miss = convolve(first, pity_distribution(pool, 0))
    first += [0.0] * (len(after_a_miss) - len(first))
    return [featured * once + (1 - featured) * twice for once, twice in zip(first, after_a_miss)]


def chance_within(distribution: Sequence[float], pulls: int) -> float:
    """The chance that `pulls` or fewer are needed: the sum up to `pulls`."""
    if pulls < 0:
        return 0.0
    return min(1.0, math.fsum(distribution[: pulls + 1]))


def certain_within(pool: str, pity: int, guaranteed: bool, *, path_points: int = 0, charted: bool = True) -> int:
    """The pulls within which the one wanted is certain, by the game's hard pity: `hard − pity` when the next 5★ is
    certain to be it (as in `pulls_to_featured`), else `hard` more."""
    hard = load_reference().pool(pool).hard
    first = hard - min(max(pity, 0), hard - 1)
    return first if _first_is_wanted(pool, guaranteed, path_points, charted) is None else first + hard


# ---------------------------------------------------------------------------------------------- the balance and the forecast


@dataclass(frozen=True)
class Balance:
    """What the player typed, and when."""

    primogems: int
    fates: int
    set_at: datetime


@dataclass(frozen=True)
class Estimate:
    """The balance moved on to now (the plan's call 8)."""

    primogems: int
    fates: int
    income: int  # the primogems the Traveler's Diary shows since the balance was set
    wishes: int  # the event wishes imported since then
    pulls: int


def balance_now(
    balance: Balance, income_since: int, wishes_since: int, *, fates_bought: int | None = None,
    wishes_after_log: int = 0,
) -> Estimate:
    """The typed balance plus the diary's primogems since, minus the event wishes since. Fates below 0 take 160
    primogems each, and the primogems stop at 0: fates bought outside the history cannot be seen.

    With `fates_bought` (the game's own primogem log covers the days since, the ledger design, section 5),
    `income_since` is that log's every entry, in and out, so buying Fates is already taken off: the Fates are the typed
    ones plus those bought, minus the wishes up to the log's newest entry, and never below 0 (the extra came from
    elsewhere), with no charge. The `wishes_after_log` of `wishes_since`, made after the log's newest entry, keep
    today's rule: the log cannot show the Fates bought for them, so those below 0 take 160 primogems each."""
    if fates_bought is not None:
        fates = max(0, balance.fates + fates_bought - (wishes_since - wishes_after_log)) - wishes_after_log
    else:
        fates = balance.fates - wishes_since
    primogems = balance.primogems + income_since
    if fates < 0:
        primogems += fates * PULL_PRIMOGEMS
        fates = 0
    primogems = max(0, primogems)
    return Estimate(primogems, fates, income_since, wishes_since, fates + primogems // PULL_PRIMOGEMS)


def income_per_day(rise: float | None, days_tracked: int) -> float | None:
    """The diary's rise over the days it tracked; None with no rise read or no day tracked."""
    if rise is None or days_tracked <= 0:
        return None
    return rise / days_tracked


def forecast(estimate: Estimate, per_day: float | None, today: date, by: date, next: NextVersion) -> int:
    """The pulls by the game day `by`, the one estimate behind the ledger's total, the forecast and the planner's chances
    (the Pulls second pass, spec 3.1): the estimate, the diary's pace for the days from `today` until `by` or the next
    version's first day, whichever is sooner, and the next version's primogems and fates spread evenly over its days up
    to `by`. A day after its end counts at the version's own daily rate. The primogems are divided into pulls once. The
    unfinished achievements are in none of it."""
    pace = int((per_day or 0) * max(0, (min(by, next.starts_on) - today).days))
    into = max(0, (by - next.starts_on).days)  # the next version's days gone by `by`, past its end too
    primogems = estimate.primogems + pace + next.primogems * into // next.days
    return estimate.fates + next.fates * into // next.days + primogems // PULL_PRIMOGEMS


# ---------------------------------------------------------------------------------------------- the wishlist


@dataclass(frozen=True)
class ChainEntry:
    budget: int  # the pulls the forecast gives by the entry's day
    first: list[float]  # the pulls its first copy needs
    later: list[float]  # the pulls each further copy needs
    copies: int


def _most_needed(entry: ChainEntry) -> int:
    """The most pulls an entry can need: the last index of its first copy's distribution, and of its later copies'."""
    if entry.copies <= 0:
        return 0
    return len(entry.first) - 1 + (entry.copies - 1) * (len(entry.later) - 1)


def chain(entries: Sequence[ChainEntry]) -> list[float]:
    """For the entries in order, the chance that the pulls needed so far fit each one's budget (the plan's call 7): each
    entry is counted as got before the next starts, its first copy from `first` and every further copy from `later`,
    convolved along the list.

    An entry whose budget covers the most the entries so far can need is certain, 1.0. The running sum is worked out up
    to the last entry that is not, and only as far as the largest budget up to there: no chance asks of more."""
    if not entries:
        return []
    reach = list(accumulate(_most_needed(entry) for entry in entries))
    open_ = [index for index, entry in enumerate(entries) if entry.budget < reach[index]]
    last = open_[-1] if open_ else -1
    size = max((entries[index].budget for index in range(last + 1)), default=0) + 1
    total: list[float] = [1.0]
    chances = []
    for index, entry in enumerate(entries):
        if index <= last:
            needed = [1.0]
            for copy in range(entry.copies):
                needed = convolve(needed, entry.first if copy == 0 else entry.later, size=size)
            total = convolve(total, needed, size=size)
        chances.append(1.0 if entry.budget >= reach[index] else chance_within(total, entry.budget))
    return chances
