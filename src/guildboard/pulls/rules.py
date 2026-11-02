"""The pity rules of the Pulls design (section 6): each wish's count since its last 5★ and 4★, whether its next 5★ is the
featured one, the Fate Point of the weapon event and of the chronicled wish, the standard pool of each time, and the luck
figures. They read the reference file `reference/wishes.json`, and nothing else: no store, no clock.

The soft pity model (the plan's call 2). HoYoverse publishes the base rate, the hard pity and the average ("consolidated")
rate, not how the chance rises before the hard pity. Guild Board uses the community's model, the one Paimon.moe's wish
calculator uses, which fits the Genshin Impact Wiki's "soft pity from about the 74th wish (63rd for weapons)":
- the character event, the standard wish, the chronicled wish and the beginners' wish: a 5★ chance of 0.6% a wish up to the
  73rd wish since the last 5★, then 6 points more each wish from the 74th (6.6%, 12.6%, ...), and certain at the 90th;
- the weapon event: 0.7% up to the 62nd, then 7 points more each wish from the 63rd, and certain at the 80th. The rise
  reaches 100% at the 77th already, and the chance stays there.
Its mean lies near the published average rates: 62.3 wishes a 5★ (published: 1.6% a wish, about 62.5), and 53.3 on the
weapon event (1.85%, about 54).

The featured 5★: a 50/50 on the character event, then guaranteed; a 75/25 on the weapon event, then guaranteed, with the
Epitomized Path's one Fate Point; on the chronicled wish, the chosen item with its one Fate Point. A 50/50 is lost when the
5★ is in the standard pool of its time. Capturing Radiance counts only as the consolidated 55% of the game's Details text
(the plan's call 3), in the chances of `savings.py`: no card here says a 5★ is guaranteed because of it.

Facts checked on 2026-10-23 on the Genshin Impact Wiki: "Wish" (the pity of each wish, soft pity marked as player-derived,
a 5★ resetting the 4★ count too, the 50/50 and the 75/25, the Epitomized Path, Capturing Radiance as the game's Details
text gives it, and the chronicled wish), "Lightrace Wish" (it shares the chronicled count), and "Wanderlust Invocation"
(the standard 5★ pool). The days the standard pool grew (3.1 on 2022-09-28, 3.6 on 2023-04-12, 5.5 on 2025-03-26) are not
verified: they matter only to a history that reaches before them, which six months of the game's cannot.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from importlib import resources
from typing import Any, Mapping, Sequence

from guildboard.pulls import WINDOW_DAYS
from guildboard.store import WishImportRow

JUDGED = ("character", "weapon")  # the wishes whose 5★ wins or loses: the 50/50 and the 75/25
PATHS = ("weapon", "chronicled")  # the wishes with a Fate Point
NO_GUARANTEE = ("standard", "novice")  # the wishes with no featured item
NEXT_RESULT = {"guaranteed": "guaranteed", "fifty": "won", "unknown": "featured"}  # a featured 5★, by the state before it
EXACT_FIVE_STARS = 30  # up to this many 5★ the luck comparison is worked out exactly; beyond, it is approximated


@dataclass(frozen=True)
class Wish:
    """A wish as the rules read it: a kept `WishRow` without what only the store needs."""

    id: int  # HoYoverse's id, which grows with time
    pool: str
    gacha_type: str
    name: str
    kind: str  # "character" or "weapon"
    rank: int
    at: datetime
    import_id: int | None = None  # the import run that kept it; None in a history built by hand


@dataclass(frozen=True)
class Correction:
    """The state of a wish before its history starts, as the player typed it (the plan's call 6)."""

    pity: int
    guaranteed: bool


@dataclass(frozen=True)
class PoolRule:
    hard: int  # the count at which the 5★ is certain
    soft: int  # the first count of soft pity
    four: int  # a 4★ comes at least every this many wishes
    base: float  # the 5★ chance of a wish before soft pity
    step: float  # what the 5★ chance gains each wish from soft pity on
    featured: float | None  # the chance a 5★ is a featured one when it is not guaranteed; None with no featured item
    types: tuple[str, ...]  # the wish types that share the count


@dataclass(frozen=True)
class Reference:
    pools: Mapping[str, PoolRule]
    standard_five_stars: Mapping[str, tuple[tuple[str, date], ...]]  # by kind: each name and the day it joined
    sources: tuple[str, ...]

    def pool(self, name: str) -> PoolRule:
        return self.pools[name]

    def is_standard(self, name: str, kind: str, at: datetime) -> bool:
        """Whether `name` was a 5★ of the standard wish at `at`: on an event wish, that 5★ is a lost 50/50."""
        day = at.astimezone(timezone.utc).date()
        return any(item == name and since <= day for item, since in self.standard_five_stars.get(kind, ()))


@dataclass(frozen=True)
class FiveStar:
    wish: Wish
    pity: int | None  # the count at it; None when the count was not known
    result: str | None  # "won", "lost", "guaranteed", "featured", "path" or "off-path"; None when nothing is judged


@dataclass(frozen=True)
class PoolState:
    pool: str
    pity: int  # wishes since the last 5★, or since the history starts ("at least" this many when not known)
    known: bool
    four: int  # wishes since the last 4★ or 5★; with none kept and a window, the wishes since the window's start
    four_known: bool  # False with no 4★ or 5★ kept and a window: `four` is then at least the count (ruling R22)
    guarantee: str  # "guaranteed", "fifty", "unknown", or "none" for a wish with no featured item
    fives: tuple[FiveStar, ...]  # every 5★, oldest first
    wishes: int  # the wishes kept of the pool
    path_item: str  # the charted weapon or the chosen path; "" when none counts
    path_points: int | None  # the Fate Points, 0 or 1; None for a wish without a path
    last_five: FiveStar | None
    since: datetime | None = None  # the window's start, which a correction is the state before; None when complete


@dataclass(frozen=True)
class Luck:
    fives: int  # every 5★, its count known or not
    average_pity: float | None  # over the character event's 5★ whose count is known, to one decimal
    won: int
    lost: int
    luckier_than: float | None  # over the same 5★


def parse_reference(data: Mapping[str, Any]) -> Reference:
    """The rules from the file's JSON. Its "sources" are kept for people to read."""
    pools = {
        name: PoolRule(
            hard=int(rule["hard"]),
            soft=int(rule["soft"]),
            four=int(rule["four"]),
            base=float(rule["base"]),
            step=float(rule["step"]),
            featured=None if rule["featured"] is None else float(rule["featured"]),
            types=tuple(str(kind) for kind in rule["types"]),
        )
        for name, rule in data["pools"].items()
    }
    standard = {
        kind: tuple((str(item["name"]), date.fromisoformat(item["since"])) for item in items)
        for kind, items in data["standard_five_stars"].items()
    }
    return Reference(pools, standard, tuple(str(source) for source in data["sources"]))


@lru_cache(maxsize=1)
def load_reference() -> Reference:
    text = resources.files("guildboard").joinpath("reference", "wishes.json").read_text(encoding="utf-8")
    return parse_reference(json.loads(text))


# ---------------------------------------------------------------------------------------------- the model


def five_star_chance(pool: str, pity: int) -> float:
    """The chance that the wish at count `pity` (1 is the first after a 5★) is a 5★, by the soft pity model above."""
    rule = load_reference().pool(pool)
    if not 1 <= pity <= rule.hard:
        raise ValueError(f"The {pool} wish counts from 1 to {rule.hard}, not {pity}.")
    if pity == rule.hard:
        return 1.0
    if pity < rule.soft:
        return rule.base
    return min(1.0, rule.base + rule.step * (pity - rule.soft + 1))


@lru_cache(maxsize=None)
def _distribution(pool: str, start: int) -> tuple[float, ...]:
    hard = load_reference().pool(pool).hard
    chances = [0.0]
    none_yet = 1.0  # the chance that no 5★ came before this wish
    for n in range(1, hard - start + 1):
        chance = five_star_chance(pool, start + n)
        chances.append(none_yet * chance)
        none_yet *= 1.0 - chance
    return tuple(chances)


def pity_distribution(pool: str, start: int = 0) -> list[float]:
    """Index n: the chance that the next 5★ comes at the n-th wish after a count of `start`; index 0 is unused and 0.0.

    A count the game cannot reach (the hard pity or more, from a correction typed too high) is read as one wish before
    the hard pity: the next wish is certain."""
    hard = load_reference().pool(pool).hard
    return list(_distribution(pool, min(max(start, 0), hard - 1)))


def convolve(a: Sequence[float], b: Sequence[float], *, size: int | None = None) -> list[float]:
    """The distribution of the sum of two independent counts, each given as index n: the chance of n. With `size`, only
    its first `size` terms, for a sum asked about no further."""
    if not a or not b:
        return []
    if len(a) < len(b):
        a, b = b, a
    backwards = list(reversed(b))
    n, m = len(a), len(b)
    total = []
    for k in range(n + m - 1 if size is None else min(n + m - 1, max(size, 0))):
        low, high = max(0, k - m + 1), min(k, n - 1)
        total.append(math.sumprod(a[low : high + 1], backwards[m - 1 - k + low : m - k + high]))
    return total


# ---------------------------------------------------------------------------------------------- the window of the history


def window_start(
    imports: Sequence[WishImportRow], pool: str, now: datetime, wishes: Sequence[Wish] = ()
) -> datetime | None:
    """The start of the known window of a pool (the plan's call 4): 180 days before the start of the oldest run in the
    chain of runs that finished the pool, each less than 180 days after the one before; or the oldest of the pool's
    `wishes` that a run of the chain kept, where it is older still. HoYoverse keeps six months, never less than 181 days,
    so each run of the chain reached back past the one before it, and the history after the window's start has no gap.
    The chain's first run kept a few days more than 180 (six months are 181 to 184 days): the wishes of those days are
    the window's too, so that they count from a correction, which is the state before the oldest of them. A wish that a
    run before a gap of 180 days or more kept is not the chain's, and moves nothing. A run counts for a pool when its
    `pools` hold it, also a run that failed after finishing it.

    None when no run finished the pool, which `pool_state` reads as a complete history: the live app never holds a pool's
    wishes without a run that finished the pool, so only a history built by hand reads that way. The window depends on the
    runs and what they kept alone: `now` does not move it, since the wishes after the newest run are not in the history
    at all."""
    runs = sorted((run for run in imports if pool in run.pools), key=lambda run: run.started_at, reverse=True)
    if not runs:
        return None
    reach = timedelta(days=WINDOW_DAYS)
    oldest, chain = runs[0], {runs[0].id}
    for run in runs[1:]:
        if oldest.started_at - run.started_at >= reach:
            break
        oldest = run
        chain.add(run.id)
    return min([oldest.started_at - reach, *(wish.at for wish in wishes if wish.import_id in chain)])


# ---------------------------------------------------------------------------------------------- the state of a wish


def _judge(
    pool: str, wish: Wish, guarantee: str, path_item: str, banner_start: datetime | None, reference: Reference
) -> str | None:
    """How a 5★ fell, from the state before it. The path judges only the 5★ of the running banner, at or after its start:
    an earlier one was not on today's path."""
    on_path = bool(path_item) and banner_start is not None and wish.at >= banner_start
    if pool in JUDGED:
        if reference.is_standard(wish.name, pool, wish.at):
            return "lost"
        if pool == "weapon" and on_path and wish.name == path_item:
            return "path"
        return NEXT_RESULT[guarantee]
    if pool == "chronicled" and on_path:
        return "path" if wish.name == path_item else "off-path"
    return None


def pool_state(
    pool: str,
    wishes: Sequence[Wish],
    *,
    window_start: datetime | None,
    correction: Correction | None,
    path_item: str = "",
    banner_start: datetime | None = None,
    points_set: tuple[int, datetime] | None = None,
    reference: Reference | None = None,
) -> PoolState:
    """The state of one wish from its history, run in id order.

    - The count and the guarantee start as the correction says; else, when the history has a window, at 0 and not known;
      else, a complete history, at 0 and a 50/50.
    - Only the wishes at or after `window_start` count; those before it are listed, and leave the count not known until
      a 5★ inside the window settles it. A 5★ before the window is judged with the state not known, and changes nothing.
    - After a lost 50/50 or 75/25 the next 5★ is guaranteed; after any other 5★ it is a 50/50 again.
    - The Fate Point (the weapon event's Epitomized Path, the chronicled wish's path) counts the 5★ since `banner_start`
      that are not `path_item`, at most 1, and a `path` 5★ sets it back to 0. It is 0 with no path item or no running
      banner (`banner_start` None), since it resets at each banner's end. `points_set`, the points the game showed and
      when, replaces the count up to its time when that time is in the running banner; the 5★ after it count on.
    - Only the 5★ since `banner_start` are judged "path" or "off-path": an earlier one was not on today's path, so it is
      won, guaranteed or featured on the weapon event, and judged neither way on the chronicled wish.
    - The chronicled wish's guarantee is its point; the weapon event's is the 75/25's own, with the point beside it. The
      standard and the beginners' wishes have none.
    - The 4★ count runs over every wish kept, a 4★ or a 5★ setting it back. With none of them kept, a history that has a
      window cannot tell it: it is the wishes kept since the window's start, at least, and not known (ruling R22).
    """
    reference = reference or load_reference()
    reference.pool(pool)  # an unknown pool is refused here
    path_item = path_item if pool in PATHS else ""

    if correction is not None:
        pity, known = correction.pity, True
        guarantee = "guaranteed" if correction.guaranteed else "fifty"
    elif window_start is not None:
        pity, known, guarantee = 0, False, "unknown"
    else:
        pity, known, guarantee = 0, True, "fifty"

    counting = bool(path_item) and banner_start is not None
    points, set_at = 0, None
    if counting and points_set is not None and points_set[1] >= banner_start:
        points, set_at = min(1, max(0, points_set[0])), points_set[1]

    ordered = sorted(wishes, key=lambda wish: wish.id)
    four, four_known = 0, window_start is None
    fives: list[FiveStar] = []
    for wish in ordered:
        four += 1
        if wish.rank >= 4:
            four, four_known = 0, True
        inside = window_start is None or wish.at >= window_start
        if inside:
            pity += 1
        if wish.rank != 5:
            continue
        if inside:
            result = _judge(pool, wish, guarantee, path_item, banner_start, reference)
            fives.append(FiveStar(wish, pity if known else None, result))
            pity, known = 0, True
            guarantee = "guaranteed" if result == "lost" else "fifty"
        else:
            fives.append(FiveStar(wish, None, _judge(pool, wish, "unknown", path_item, banner_start, reference)))
        if counting and wish.at >= banner_start and (set_at is None or wish.at > set_at):
            points = 0 if wish.name == path_item else 1

    if not four_known:  # no 4★ or 5★ kept, and a window: the wishes since its start
        four = sum(1 for wish in ordered if wish.at >= window_start)
    if pool in NO_GUARANTEE:
        guarantee = "none"
    elif pool == "chronicled":
        guarantee = "guaranteed" if points == 1 else "fifty"
    return PoolState(
        pool=pool,
        pity=pity,
        known=known,
        four=four,
        four_known=four_known,
        guarantee=guarantee,
        fives=tuple(fives),
        wishes=len(ordered),
        path_item=path_item,
        path_points=points if pool in PATHS else None,
        last_five=fives[-1] if fives else None,
        since=window_start,
    )


# ---------------------------------------------------------------------------------------------- luck


def luckier_than(pities: Sequence[tuple[str, int]]) -> float | None:
    """The chance that a player of the published odds needs more wishes than the player did for as many 5★, each from
    its own wish. None with no count.

    Up to 30 5★ it is exact: the sum of the counts against the convolution of each pool's `pity_distribution`. Beyond, the
    convolution would hold the core up for seconds (150 5★ took about 2 s), so it is approximated from each pool's mean,
    variance and third central moment, which add up over the 5★: a normal distribution with a 0.5 continuity correction
    and the first Edgeworth term for the skew. The counts are skewed (most 5★ come in soft pity, a few far earlier): the
    plain normal approximation missed the exact figure by up to 0.014 at 30 to 40 5★, and with the skew term it stays
    within 0.002 (measured on 30 to 40 5★ of seven shapes of counts)."""
    if not pities:
        return None
    five_stars = tuple(sorted(pities))
    if len(five_stars) <= EXACT_FIVE_STARS:
        return _exact_luckier_than(five_stars)
    return _approximated_luckier_than(five_stars)


@lru_cache(maxsize=32)
def _exact_luckier_than(pities: tuple[tuple[str, int], ...]) -> float:
    needed = sum(pity for _, pity in pities)
    total: Sequence[float] = (1.0,)
    for pool, _ in pities:
        total = convolve(total, _distribution(pool, 0))
    return min(1.0, math.fsum(total[needed + 1 :]))


@lru_cache(maxsize=None)
def _moments(pool: str) -> tuple[float, float, float]:
    """The mean, the variance and the third central moment of the wishes a 5★ of `pool` takes from a count of 0."""
    chances = _distribution(pool, 0)
    mean = math.fsum(n * chance for n, chance in enumerate(chances))
    variance = math.fsum((n - mean) ** 2 * chance for n, chance in enumerate(chances))
    third = math.fsum((n - mean) ** 3 * chance for n, chance in enumerate(chances))
    return mean, variance, third


@lru_cache(maxsize=32)
def _approximated_luckier_than(pities: tuple[tuple[str, int], ...]) -> float:
    needed = sum(pity for _, pity in pities)
    mean = math.fsum(_moments(pool)[0] for pool, _ in pities)
    variance = math.fsum(_moments(pool)[1] for pool, _ in pities)
    third = math.fsum(_moments(pool)[2] for pool, _ in pities)
    z = (needed + 0.5 - mean) / math.sqrt(variance)  # needed or fewer, with the continuity correction
    at_most = 0.5 * math.erfc(-z / math.sqrt(2))
    at_most -= math.exp(-z * z / 2) / math.sqrt(2 * math.pi) * third / variance**1.5 / 6 * (z * z - 1)
    return min(1.0, max(0.0, 1.0 - at_most))


def typical_average() -> float:
    """The wishes a 5★ of the character event takes on average, by the soft pity model above: 62.3."""
    return _moments("character")[0]


def luck(states: Mapping[str, PoolState]) -> Luck:
    """The luck figures of the states: how many 5★ there are, the character event's average count, its 50/50 record, and
    the comparison with the published odds. The count is of every 5★. The average and the comparison read the character
    event's 5★ alone (the Pulls second pass, spec 3.3), as the average is labelled, and the average is given to one
    decimal. The 50/50 record is the character event's won and lost results (spec 2.4): the weapon event's 75/25 is not a
    50/50, and a featured or guaranteed 5★ is in neither. A 5★ whose count is not known is counted, and left out of the
    average and the comparison (spec 6.1, item 2)."""
    fives = [five for state in states.values() for five in state.fives]
    character = states.get("character")
    fifty_fifty = character.fives if character is not None else ()
    pities = [("character", five.pity) for five in fifty_fifty if five.pity is not None]
    return Luck(
        fives=len(fives),
        average_pity=round(sum(pity for _, pity in pities) / len(pities), 1) if pities else None,
        won=sum(1 for five in fifty_fifty if five.result == "won"),
        lost=sum(1 for five in fifty_fifty if five.result == "lost"),
        luckier_than=luckier_than(pities),
    )
