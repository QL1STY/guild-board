"""The Stats page's Year tab: the year's Wrapped (the Stats design, section 6).

Every fact the year's data gives is computed by one small pure function of its kind (`FACTS`), from a `YearData` read
once from the store (`year_data`). A year is a calendar year of game days (a game day starts at 04:00 server time).

Each fact is scored by how far it stands out for this player (6.3):
- a pity against the game's 62.5 (`luck_score`, `unluck_score`);
- a month against the year's other months, in standard deviations (`month_score`);
- a total against what a very active player gathers over the same days (`total_score`, `FULL_YEAR`);
- a record against its kind's size (`record_score`, `RECORD_SIZE`);
- an endgame result against the mode's best.

A fact needs 30 days of its source inside the year. One whose source begins inside the year says so in its heading
("Longest session · since 19 Oct") and scores 0.85 of itself. The character of the year leads the cards. The other cards
are the best facts, at most three of each of pulls, play, resources and endgame while others remain, and never two of
one family, such as the resin spent and the Condensed Resin it made (`choose`).

The words: headings, labels and notes are plain. A card's line and the hero's line come from fixed templates (`WORDS`),
filled with the numbers in the voice of the accepted mockup, and claim nothing the numbers don't show (6.2). The poster
holds the in-game name, AR and server, and never the UID (6.4).
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, tzinfo
from typing import Any, Callable, Iterable, Mapping, Sequence

from guildboard.gameday import game_day, game_day_start
from guildboard.history import History
from guildboard.ledger import income
from guildboard.ledger.reasons import domain_of
from guildboard.pulls.rules import PoolState
from guildboard.store import Store, parse_iso
from guildboard.views import months
from guildboard.views.endgame_card import MONTHS as FULL_MONTH_NAMES
from guildboard.views.ledger import FED
from guildboard.views.pulls import wish_icon, wish_kind
from guildboard.views.stats import MONTH_NAMES

MIN_DAYS = 30  # the days of the year a fact's source must cover
PARTIAL = 0.85  # a fact from part of the year scores this much of itself
MIN_FACTS = 3  # a year is listed with at least this many facts
LUCK_MEAN = 62.5  # the pulls a 5★ takes on average, soft pity included
Z_CAP = 3.0  # a month this many standard deviations above the others scores 1
FLOOR = 0.5  # a fact scoring under this is a card only to reach the fewest cards
PER_CATEGORY = 3  # at most this many cards of a category while others remain
CHARACTER_SCORE = 2.0  # the character of the year leads the cards
REPEAT = 0.8  # the primogems earned are always one of the hero's counters: as a card they say it again
WEIGHTS = {"copies": 3, "teams": 1, "highlights": 2}  # the character of the year's points
HIGHLIGHTS = {"abyss": ("strike", "defeats"), "theater": ("damage", "defeats")}
MODES = ("abyss", "theater", "stygian")
TEAM_MODES = ("abyss", "stygian")  # the modes whose teams the character of the year counts (`_teams`)
CRAFTING = "Item crafting material"  # resin into Condensed Resin
CONDENSED_RESIN = 40
STARS = 36  # the Spiral Abyss's stars
THEATER_ACTS = 10  # the acts of a Theater season, when the season does not say
STYGIAN_TOP = 6  # the hardest Stygian Onslaught difficulty
# What a very active player gathers in a whole year; a total is scored against the same days' part of it.
FULL_YEAR = {
    "primogems": 150_000, "welkin": 32_850, "resin": 65_700, "condensed": 1_000, "artifacts": 3_000, "fed": 20_000,
    "achievements": 300,
}
RECORD_SIZE = {"longest_session": 480, "longest_run": 100, "strike": 2_000_000, "regions": 3}
CATEGORY = {
    "character": "character",
    "luckiest": "pulls", "unluckiest": "pulls", "biggest_month": "pulls", "five_in_a_day": "pulls",
    "primogems": "resources", "welkin": "resources", "resin": "resources", "condensed": "resources",
    "artifacts": "resources", "fed": "resources",
    "longest_session": "play", "longest_run": "play", "favourite_hour": "play", "favourite_weekday": "play",
    "achievements": "play", "regions": "play",
    "abyss": "endgame", "theater": "endgame", "stygian": "endgame", "strike": "endgame",
}
CAPPED = ("pulls", "play", "resources", "endgame")
# Kinds that tell the same thing twice: the resin's line names the Condensed Resin it made, the artifacts' the fodder.
FAMILY = {"condensed": "resin", "fed": "artifacts"}
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_COUNTS = ("no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve")

# The words of each kind of card. `heading` and `poster` are plain labels; `line` and `hero` (and their variants) are
# the warmer templates of the design's 6.2, filled with the numbers.
WORDS: dict[str, dict[str, str]] = {
    "character": {
        "heading": "Character of the year",
        "big": "{name}",
        "copies_one_day": "{copies} on {day}",
        "copies": "{copies} this year",
        "teams": "In {teams} of your endgame teams",
        "highlights": "{highlights}",
        "line": "{start}.",
        "strike": "{start}, and your strongest hit in the Spiral Abyss: {strike}.",
        "damage": "{start}, and your biggest hit in the Imaginarium Theater: {damage}.",
        "hero": "The year {name} came home{times}.",
        "hero_abyss": "The year {name} came home{times}, and the Abyss never stood a chance.",
        "hero_teams": "The year {name} stood in {teams} of your endgame teams.",
        "hero_highlights": "The year {name} led your endgame.",
        "poster": "character of the year",
    },
    "luckiest": {
        "heading": "Luckiest pull",
        "big": "{pity}",
        "line": "{name} on {day}, the quickest five-star of your year.",
        "line_plain": "{name} on {day}.",  # a five-star of the year whose count is not known may have been quicker
        "line_same_day": "{name} on {day}. The same day brought {others} more {five_stars}.",
        "line_undated": "{name}, the quickest five-star of your year.",  # five-stars in a day tells the day
        "line_undated_plain": "{name}, on the day of your most five-stars.",
        "hero": "The year {name} came after only {pity}.",
        "poster": "luckiest 5★ ({name})",
    },
    "unluckiest": {
        "heading": "Longest wait",
        "big": "{pity}",
        "line": "{name} on {day}, the longest wait of your year.",
        "line_plain": "{name} on {day}.",
        "hero": "The year {name} made you wait {pity}, and came anyway.",
        "poster": "longest wait for a 5★",
    },
    "biggest_month": {
        "heading": "Your biggest month",
        "big": "{month} · {wishes}",
        "line": "{share}% of your year's wishes in one month.",
        "hero": "The year {month} took {wishes}.",
        "poster": "biggest month",
    },
    "five_in_a_day": {
        "heading": "Five-stars in a day",
        "big": "{count}",
        "line": "five-stars on {day} alone.",
        "hero": "The year one day brought {count_word} five-stars.",
        "poster": "five-stars in a day",
    },
    "primogems": {
        "heading": "Primogems earned",
        "big": "{total}",
        "line": "{top} gave the most: {amount}.",
        "line_plain": "earned, not bought.",
        "hero": "The year Teyvat paid you {total} primogems.",
        "poster": "primogems earned",
    },
    "welkin": {
        "heading": "Welkin Moon",
        "big": "{total}",
        "line": "primogems from it this year, one login at a time.",
        "hero": "The year the Welkin Moon gave you {total} primogems.",
        "poster": "primogems from the Welkin",
    },
    "resin": {
        "heading": "Where your resin went",
        "big": "{total}",
        "line": "{crafted} into Condensed Resin. Favourite stop: {top}.",
        "line_crafted": "{crafted} into Condensed Resin.",
        "line_stop": "Favourite stop: {top}.",
        "hero": "The year you spent {total} resin.",
        "poster": "resin spent",
    },
    "condensed": {
        "heading": "Condensed Resin",
        "big": "{made}",
        "line": "crafted from {resin} resin.",
        "hero": "The year you crafted {made} Condensed Resin.",
        "poster": "Condensed Resin crafted",
    },
    "artifacts": {
        "heading": "Five-star artifacts",
        "big": "{count}",
        "line": "five-star artifacts picked up.",
        "line_fodder": "five-star artifacts picked up. Most of them, honestly, fodder.",
        "hero": "The year you picked up {count} five-star artifacts.",
        "poster": "five-star artifacts",
    },
    "fed": {
        "heading": "Artifacts fed or salvaged",
        "big": "{total}",
        "line": "{fed} fed to other artifacts, {salvaged} salvaged.",
        "hero": "The year {total} artifacts were fed or salvaged.",
        "poster": "artifacts fed or salvaged",
    },
    "longest_session": {
        "heading": "Longest session",
        "big": "{length}",
        "line": "{day}, your longest stay in Teyvat.",
        "line_long": "{day}. Teyvat didn't let go.",
        "hero": "The year one session ran {length}.",
        "poster": "longest session",
    },
    "longest_run": {
        "heading": "Longest run",
        "big": "{days}",
        "line": "in a row, {first} to {last}.",
        "hero": "The year you played {days} in a row.",
        "poster": "days in a row",
    },
    "favourite_hour": {
        "heading": "Favourite hour",
        "big": "{hour}",
        "line": "{share}% of your time in Teyvat fell in this hour.",
        "hero": "The year {hour} was your hour.",
        "poster": "favourite hour",
    },
    "favourite_weekday": {
        "heading": "Favourite day",
        "big": "{weekday}",
        "line": "{share}% of your time in Teyvat.",
        "hero": "The year {weekday}s belonged to Teyvat.",
        "poster": "favourite day",
    },
    "abyss": {
        "heading": "Spiral Abyss",
        "big": "{stars} ★",
        "line": "your best of the year, out of 36.",
        "line_full": "Every star of 36. The Abyss never stood a chance.",
        "hero": "The year the Spiral Abyss gave you {stars} stars.",
        "poster": "Abyss stars",
    },
    "theater": {
        "heading": "Imaginarium Theater",
        "big": "Act {acts}",
        "line": "your best of the year.",
        "line_medals": "{won} of {of} medals, your best of the year.",
        "hero": "The year the Theater went to Act {acts}.",
        "poster": "Theater act",
    },
    "stygian": {
        "heading": "Stygian Onslaught",
        "big": "Difficulty {difficulty}",
        "line": "cleared, your best of the year.",
        "hero": "The year you cleared Stygian Onslaught on difficulty {difficulty}.",
        "poster": "Stygian difficulty",
    },
    "strike": {
        "heading": "Strongest strike",
        "big": "{value}",
        "line": "{name} in the Spiral Abyss, in one hit.",
        "line_nameless": "in the Spiral Abyss, in one hit.",
        "hero": "The year {name} hit for {value}.",
        "hero_nameless": "The year one hit in the Spiral Abyss reached {value}.",
        "poster": "strongest strike",
    },
    "achievements": {
        "heading": "Achievements",
        "big": "{count}",
        "line": "ticked off one by one.",
        "hero": "The year you ticked off {count} achievements.",
        "poster": "achievements",
    },
    "regions": {
        "heading": "Regions at 100%",
        "big": "{count}",
        "line": "{names}, brought to 100%.",
        "hero": "The year {names} reached 100%.",
        "poster": "regions at 100%",
    },
}


# ---------------------------------------------------------------------------------------------- the year's data


@dataclass(frozen=True)
class Span:
    """The game days a source covers inside the year, first and last."""

    first: date
    last: date

    @property
    def days(self) -> int:
        return (self.last - self.first).days + 1


@dataclass(frozen=True)
class Five:
    """A 5★ pulled in the year."""

    name: str
    kind: str  # "character" or "weapon"
    day: date  # its game day
    order: int  # the wish's id, which grows with time: the most recent pull has the largest
    pity: int | None  # the Pulls page's count at it; None when not known, and then it is never lucky or unlucky
    face: str | None  # its picture's address in the core, or None: the page draws the sign


@dataclass(frozen=True)
class Cycle:
    """An endgame cycle of the year: one that ended in it, or the open one, on the day it was read."""

    mode: str
    day: date
    detail: Mapping[str, Any]  # the cycle table's detail of the mode, as `endgame_cycles` keeps it


@dataclass(frozen=True)
class Person:
    """A character the endgame names by id: the name, and the face and large picture from the art cache."""

    name: str
    face: str | None
    picture: str | None


@dataclass(frozen=True)
class Profile:
    """What the poster says of the player: the in-game name, the adventure rank and the server's name, nothing more."""

    name: str
    ar: int | None
    server: str


@dataclass(frozen=True)
class YearData:
    """Everything a year's facts are made of. `spans` holds each source that reaches the year ("wishes", "primogems",
    "ledger", "resin", "artifacts", "sessions", "achievements", "exploration", and one for each endgame mode); a source
    that reaches none of it is missing. Each number is of its source's span."""

    year: int
    today: date
    profile: Profile
    spans: Mapping[str, Span]
    wish_months: Mapping[int, int] = field(default_factory=dict)  # every month the wish history covers, 0s included
    fives: tuple[Five, ...] = ()
    primogem_months: Mapping[int, int] = field(default_factory=dict)  # the Overview's own month values
    primogem_sources: Mapping[str, int] = field(default_factory=dict)  # as the Months tab splits them
    welkin: int = 0  # primogems from the Welkin Moon, over the days the game's log covers
    resin: Mapping[str, int] = field(default_factory=dict)  # resin spent, by the game's reason
    artifacts_in: int = 0  # five-star artifacts picked up
    artifacts_used: int = 0  # five-star artifacts fed to others or salvaged
    fed: int = 0  # artifacts fed to others
    salvaged: int = 0
    longest_session: tuple[int, date] | None = None  # minutes, and the game day it began on
    played: Mapping[date, float] = field(default_factory=dict)  # minutes on each game day of the sessions' span
    grid: tuple[tuple[float, ...], ...] = ()  # minutes by weekday (from Monday) and hour, on this PC's clock
    cycles: tuple[Cycle, ...] = ()
    people: Mapping[int, Person] = field(default_factory=dict)
    achievements: int = 0  # ticked one by one (the design, 5.2)
    regions: tuple[str, ...] = ()  # brought to 100% in the year


@dataclass(frozen=True)
class Fact:
    """One fact of the year, ready to be a card: its score, the day its source begins when that is inside the year, the
    words and the faces, and the numbers it is made of. `hero` is the hero's line it gives when it leads the year, and
    `poster` its label and number on the poster."""

    kind: str
    score: float
    since: date | None
    heading: str
    big: str
    line: str
    faces: tuple[str, ...]
    numbers: dict[str, Any]
    hero: str = ""
    poster: tuple[str, str] | None = None


# ---------------------------------------------------------------------------------------------- the scores


def luck_score(pity: int) -> float:
    """How far under the game's usual a 5★ came: 1 at the first wish, 0 at 62.5."""
    return (LUCK_MEAN - pity) / LUCK_MEAN


def unluck_score(pity: int) -> float:
    return (pity - LUCK_MEAN) / LUCK_MEAN


def month_score(value: float, others: Sequence[float]) -> float:
    """A month against the year's other months in standard deviations, from 0 to 1 at Z_CAP and above."""
    if not others:
        return 0.0
    mean = sum(others) / len(others)
    spread = math.sqrt(sum((other - mean) ** 2 for other in others) / len(others))
    if spread == 0:
        return 1.0 if value > mean else 0.0
    return max(0.0, min((value - mean) / spread, Z_CAP)) / Z_CAP


def total_score(total: float, size: float) -> float:
    """A total against its kind's size for the same days: 1 at the size, 0 at a tenth of it, 2 at ten times."""
    return math.log10(total / size) + 1


def record_score(value: float, size: float) -> float:
    """A record against its kind's size: 1 at the size."""
    return math.log10(1 + value) / math.log10(1 + size)


# ---------------------------------------------------------------------------------------------- words


def _count(number: int) -> str:
    return _COUNTS[number] if 0 <= number < len(_COUNTS) else f"{number:,}"


def _times(number: int) -> str:
    """" twice", " three times"; nothing for once."""
    return "" if number <= 1 else " twice" if number == 2 else f" {_count(number)} times"


def _wishes(number: int) -> str:
    return f"{number:,} wish" if number == 1 else f"{number:,} wishes"


def _long(day: date) -> str:
    """A day as the lines say it: "1 July"."""
    return f"{day.day} {FULL_MONTH_NAMES[day.month - 1]}"


def _length(minutes: int, short: bool = False) -> str:
    """454 minutes as "7 h 34 min", or "7 h 34" on the poster."""
    hours, rest = divmod(minutes, 60)
    if not hours:
        return f"{rest} min"
    if not rest:
        return f"{hours} h"
    return f"{hours} h {rest}" if short else f"{hours} h {rest} min"


def _share(part: float, whole: float) -> int:
    """The part in whole percent, never 100 for less than the whole nor 0 for more than nothing."""
    share = round(100 * part / whole)
    return min(99, max(1, share)) if 0 < part < whole else share


def _stop(reason: str) -> str:
    """Where resin went, as the player names it: "Trounce Blossoms", a domain's own name, "Stygian Onslaught"."""
    domain = domain_of(reason)
    if domain is not None:
        return domain
    if reason.endswith(" challenge reward"):
        return reason[: -len(" challenge reward")] + "s"
    if "Stygian Onslaught" in reason:
        return "Stygian Onslaught"
    return reason


# ---------------------------------------------------------------------------------------------- the facts


def _span(data: YearData, source: str) -> Span | None:
    """The source's span when it covers enough of the year to say something; else None."""
    span = data.spans.get(source)
    return span if span is not None and span.days >= MIN_DAYS else None


def _since(data: YearData, first: date) -> date | None:
    return first if first > date(data.year, 1, 1) else None


def _make(
    data: YearData, kind: str, first: date, score: float, fill: Mapping[str, Any], numbers: dict[str, Any],
    poster: str, *, line: str = "line", hero: str = "hero", faces: Iterable[str | None] = (),
) -> Fact:
    words = WORDS[kind]
    since = _since(data, first)
    heading = words["heading"] + (f" · since {months.day_label(since)}" if since is not None else "")
    return Fact(
        kind, score * (PARTIAL if since is not None else 1.0), since, heading, words["big"].format(**fill),
        words[line].format(**fill), tuple(dict.fromkeys(face for face in faces if face)), numbers,
        words[hero].format(**fill), (words["poster"].format(**fill), poster),
    )


def _scaled(kind: str, span: Span) -> float:
    return FULL_YEAR[kind] * span.days / 365


# -------- the character of the year


@dataclass
class _Standing:
    name: str
    copies: int = 0
    teams: int = 0
    highlights: int = 0
    last_pull: int = -1
    days: set[date] = field(default_factory=set)

    @property
    def points(self) -> int:
        return (
            WEIGHTS["copies"] * self.copies + WEIGHTS["teams"] * self.teams + WEIGHTS["highlights"] * self.highlights
        )


def _ints(value: Any) -> tuple[int, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, int) and not isinstance(item, bool))


def _teams(cycle: Cycle) -> list[frozenset[int]]:
    """The cycle's teams, each once: the Abyss's halves and the Stygian Onslaught's bosses."""
    detail = cycle.detail
    if cycle.mode == "abyss":
        listed = [_ints(half.get("characters")) for half in detail.get("halves") or [] if isinstance(half, dict)]
    elif cycle.mode == "stygian":
        listed = [_ints(boss.get("team")) for boss in detail.get("bosses") or [] if isinstance(boss, dict)]
    else:
        listed = []
    return list(dict.fromkeys(frozenset(team) for team in listed if team))


def _ranks(cycle: Cycle) -> list[tuple[str, int, int]]:
    """The cycle's highlights as (kind, value, avatar id)."""
    out = []
    for rank in cycle.detail.get("ranks") or []:
        if isinstance(rank, dict) and isinstance(rank.get("value"), int) and isinstance(rank.get("avatar_id"), int):
            out.append((str(rank.get("kind")), rank["value"], rank["avatar_id"]))
    return out


def _top_rank(data: YearData, mode: str, kind: str) -> tuple[int, int] | None:
    """The year's highest highlight of a kind in a mode, as (value, avatar id); the first of equal ones."""
    found = [
        (value, avatar)
        for cycle in data.cycles if cycle.mode == mode
        for k, value, avatar in _ranks(cycle) if k == kind
    ]
    return max(found, key=lambda item: item[0]) if found else None


def _name(data: YearData, avatar: int) -> str | None:
    person = data.people.get(avatar)
    return person.name if person is not None else None


def _counted(data: YearData) -> set[str]:
    """The endgame modes whose kept cycles cover enough of the year to say something: only their teams, highlights and
    results speak for the character of the year, as only they give facts of their own."""
    return {mode for mode in MODES if _span(data, mode) is not None}


def _standings(data: YearData) -> list[_Standing]:
    """Every character the year points to, the highest first: copies pulled, teams and highlights (the weights of
    WEIGHTS). Ties go to the most copies, then the most recent pull. The copies are of 5★ characters only, a ruling of
    the build: a 4★ pulled many times over would outweigh the year's 5★."""
    table: dict[str, _Standing] = {}

    def of(name: str) -> _Standing:
        return table.setdefault(name, _Standing(name))

    for five in data.fives:
        if five.kind == "character":
            standing = of(five.name)
            standing.copies += 1
            standing.last_pull = max(standing.last_pull, five.order)
            standing.days.add(five.day)
    counted = _counted(data)
    for cycle in data.cycles:
        if cycle.mode not in counted:
            continue
        for team in _teams(cycle):
            for avatar in team:
                if (name := _name(data, avatar)) is not None:
                    of(name).teams += 1
        for kind, _, avatar in _ranks(cycle):
            if kind in HIGHLIGHTS.get(cycle.mode, ()) and (name := _name(data, avatar)) is not None:
                of(name).highlights += 1
    found = [standing for standing in table.values() if standing.points > 0]
    return sorted(found, key=lambda s: (-s.points, -s.copies, -s.last_pull, s.name))


def _character_spans(data: YearData) -> list[Span]:
    return [span for span in (_span(data, source) for source in ("wishes", *MODES)) if span is not None]


def _picture(data: YearData, name: str) -> str | None:
    """The character's large picture, else her face, else the face of her last pull."""
    for person in data.people.values():
        if person.name == name and (person.picture or person.face):
            return person.picture or person.face
    faces = [five.face for five in sorted(data.fives, key=lambda five: five.order) if five.name == name and five.face]
    return faces[-1] if faces else None


def character_of_year(data: YearData) -> dict[str, Any] | None:
    """The character the year points to most, with the parts of the score; None when nothing points to one."""
    standings = _standings(data) if _character_spans(data) else []
    if not standings:
        return None
    top = standings[0]
    parts = {"copies": top.copies, "teams": top.teams, "highlights": top.highlights, "points": top.points}
    return {"name": top.name, "picture": _picture(data, top.name), "score_parts": parts}


def _character(data: YearData) -> Fact | None:
    spans = _character_spans(data)
    standings = _standings(data) if spans else []
    if not standings:
        return None
    top, words, counted = standings[0], WORDS["character"], _counted(data)
    strike = _top_rank(data, "abyss", "strike") if "abyss" in counted else None
    damage = _top_rank(data, "theater", "damage") if "theater" in counted else None
    struck = strike[0] if strike is not None and _name(data, strike[1]) == top.name else None
    dealt = damage[0] if damage is not None and _name(data, damage[1]) == top.name else None
    if top.copies:
        copies = "One copy" if top.copies == 1 else f"{_count(top.copies).capitalize()} copies"
        one_day = len(top.days) == 1
        start = words["copies_one_day" if one_day else "copies"].format(copies=copies, day=_long(min(top.days)))
    elif top.teams:
        start = words["teams"].format(teams=_count(top.teams))
    else:
        many = _count(top.highlights).capitalize()
        start = words["highlights"].format(highlights=f"{many} endgame highlight{'' if top.highlights == 1 else 's'}")
    stars = _best(data, "abyss", "stars") if "abyss" in counted else None
    if top.copies:  # the Abyss "never stood a chance": its strongest hit, in a year it was cleared whole
        hero = "hero_abyss" if struck is not None and stars is not None and stars[0] >= STARS else "hero"
    else:
        hero = "hero_teams" if top.teams else "hero_highlights"
    fill = {
        "name": top.name, "start": start, "times": _times(top.copies), "teams": _count(top.teams),
        "strike": f"{struck:,}" if struck is not None else "", "damage": f"{dealt:,}" if dealt is not None else "",
    }
    numbers: dict[str, Any] = {
        "name": top.name, "copies": top.copies, "teams": top.teams, "highlights": top.highlights, "points": top.points,
    }
    if len(top.days) == 1:
        numbers["day"] = min(top.days).isoformat()
    if struck is not None:
        numbers["strike"] = struck
    elif dealt is not None:
        numbers["damage"] = dealt
    line = "strike" if struck is not None else "damage" if dealt is not None else "line"
    return _make(data, "character", _lead_first(data, top, counted), CHARACTER_SCORE, fill, numbers, top.name,
                 line=line, hero=hero, faces=[_picture(data, top.name)])


def _lead_first(data: YearData, top: _Standing, counted: set[str]) -> date:
    """Where the source the character's line leads with begins, for its "since": the wishes for copies, else the endgame
    modes whose teams (the Abyss's and the Stygian Onslaught's) or highlights it tells; the first of the character's
    sources where none of them is kept."""
    if top.copies:
        sources: Iterable[str] = ("wishes",)
    elif top.teams:
        sources = (mode for mode in TEAM_MODES if mode in counted)
    else:
        sources = (mode for mode in HIGHLIGHTS if mode in counted)
    firsts = [data.spans[source].first for source in sources if source in data.spans]
    return min(firsts) if firsts else min(span.first for span in _character_spans(data))


# -------- pulls


def _known(data: YearData) -> list[Five]:
    return [five for five in data.fives if five.pity is not None]


def _luckiest(data: YearData, told: date | None = None) -> Fact | None:
    """The 5★ of the lowest known pity. `told` is the day a card of five-stars in a day tells, when one is chosen: the
    luckiest then counts no five-stars of its own day, and names no day that card names."""
    span, known = _span(data, "wishes"), _known(data)
    if span is None or not known:
        return None
    best = min(known, key=lambda five: (five.pity, five.order))
    pity = int(best.pity)  # type: ignore[arg-type]
    others = sum(1 for five in data.fives if five.day == best.day) - 1
    every = len(known) == len(data.fives)  # with a count not known, it is the quickest known, not the year's
    fill = {
        "name": best.name, "day": _long(best.day), "pity": _wishes(pity), "others": _count(others),
        "five_stars": "five-star" if others == 1 else "five-stars",
    }
    numbers = {"name": best.name, "pity": pity, "day": best.day.isoformat(), "same_day": others}
    if told is not None and told == best.day:
        line = "line_undated" if every else "line_undated_plain"
    elif others and told is None:
        line = "line_same_day"
    else:
        line = "line" if every else "line_plain"
    return _make(data, "luckiest", span.first, luck_score(pity), fill, numbers, str(pity), line=line,
                 faces=[best.face])


def _unluckiest(data: YearData) -> Fact | None:
    span, known = _span(data, "wishes"), _known(data)
    if span is None or not known:
        return None
    best = min(known, key=lambda five: (five.pity, five.order))
    worst = max(known, key=lambda five: (five.pity, -five.order))
    if worst.pity == best.pity:  # one pity for all: no longest wait to tell
        return None
    pity = int(worst.pity)  # type: ignore[arg-type]
    fill = {"name": worst.name, "day": _long(worst.day), "pity": _wishes(pity)}
    numbers = {"name": worst.name, "pity": pity, "day": worst.day.isoformat()}
    line = "line" if len(known) == len(data.fives) else "line_plain"
    return _make(data, "unluckiest", span.first, unluck_score(pity), fill, numbers, str(pity), line=line,
                 faces=[worst.face])


def _biggest_month(data: YearData) -> Fact | None:
    span, counts = _span(data, "wishes"), dict(data.wish_months)
    if span is None or len(counts) < 2:
        return None
    month, value = max(counts.items(), key=lambda item: (item[1], -item[0]))  # the first of equal months
    if value <= 0:
        return None
    others = [count for other, count in counts.items() if other != month]
    name = FULL_MONTH_NAMES[month - 1]
    fill = {"month": name, "wishes": _wishes(value), "share": _share(value, sum(counts.values()))}
    # `through`: the last month the year has reached on the core's clock. The page draws a month after it as nothing, and a
    # month before it with no number as one the history does not reach.
    through = 12 if data.year < data.today.year else data.today.month
    numbers = {"month": month, "wishes": value, "months": [counts.get(index) for index in range(1, 13)], "through": through}
    faces = [five.face for five in data.fives if five.day.month == month]
    return _make(data, "biggest_month", span.first, month_score(value, others), fill, numbers, name, faces=faces)


def _five_in_a_day(data: YearData) -> Fact | None:
    span = _span(data, "wishes")
    by_day = Counter(five.day for five in data.fives)
    if span is None or not by_day:
        return None
    day, count = max(by_day.items(), key=lambda item: (item[1], -item[0].toordinal()))  # the first of equal days
    if count < 2:
        return None
    fill = {"count": f"{count:,}", "count_word": _count(count), "day": _long(day)}
    numbers = {"count": count, "day": day.isoformat()}
    faces = [five.face for five in data.fives if five.day == day]
    return _make(data, "five_in_a_day", span.first, min(1.0, (count - 1) / 4), fill, numbers, f"{count:,}", faces=faces)


# -------- resources


def _primogems(data: YearData) -> Fact | None:
    span, total = _span(data, "primogems"), sum(data.primogem_months.values())
    if span is None or total <= 0:
        return None
    sources = [(name, amount) for name, amount in data.primogem_sources.items() if amount > 0 and name != "Other"]
    top = max(sources, key=lambda item: item[1]) if sources else None
    fill = {"total": f"{total:,}", "top": top[0] if top else "", "amount": f"{top[1]:,}" if top else ""}
    numbers: dict[str, Any] = {"total": total}
    if top is not None:
        numbers.update({"top": top[0], "top_amount": top[1]})
    score = total_score(total, _scaled("primogems", span)) * REPEAT
    return _make(data, "primogems", span.first, score, fill, numbers, f"{total:,}",
                 line="line" if top else "line_plain")


def _welkin(data: YearData) -> Fact | None:
    span = _span(data, "ledger")
    if span is None or data.welkin <= 0:
        return None
    fill = {"total": f"{data.welkin:,}"}
    numbers = {"total": data.welkin}
    return _make(data, "welkin", span.first, total_score(data.welkin, _scaled("welkin", span)), fill, numbers,
                 f"{data.welkin:,}")


def _resin(data: YearData) -> Fact | None:
    span, total = _span(data, "resin"), sum(data.resin.values())
    if span is None or total <= 0:
        return None
    crafted = data.resin.get(CRAFTING, 0)
    stops: dict[str, int] = {}
    for reason, amount in data.resin.items():
        if reason != CRAFTING:
            stops[_stop(reason)] = stops.get(_stop(reason), 0) + amount
    top = max(sorted(stops.items()), key=lambda item: item[1]) if stops else None
    fill = {"total": f"{total:,}", "crafted": f"{crafted:,}", "top": top[0] if top else ""}
    uses = sorted(stops.items(), key=lambda item: (-item[1], item[0]))
    numbers: dict[str, Any] = {
        "total": total, "crafted": crafted, "uses": [{"name": name, "amount": amount} for name, amount in uses],
    }
    if top is not None:
        numbers["top"] = top[0]
    line = "line" if crafted and top else "line_crafted" if crafted else "line_stop"
    return _make(data, "resin", span.first, total_score(total, _scaled("resin", span)), fill, numbers, f"{total:,}",
                 line=line)


def _condensed(data: YearData) -> Fact | None:
    span = _span(data, "resin")
    made = data.resin.get(CRAFTING, 0) // CONDENSED_RESIN
    if span is None or made <= 0:
        return None
    fill = {"made": f"{made:,}", "resin": f"{data.resin[CRAFTING]:,}"}
    numbers = {"made": made, "resin": data.resin[CRAFTING]}
    return _make(data, "condensed", span.first, total_score(made, _scaled("condensed", span)), fill, numbers,
                 f"{made:,}")


def _artifacts(data: YearData) -> Fact | None:
    span = _span(data, "artifacts")
    if span is None or data.artifacts_in <= 0:
        return None
    fill = {"count": f"{data.artifacts_in:,}"}
    numbers = {"count": data.artifacts_in, "used": data.artifacts_used}
    line = "line_fodder" if 2 * data.artifacts_used > data.artifacts_in else "line"
    score = total_score(data.artifacts_in, _scaled("artifacts", span))
    return _make(data, "artifacts", span.first, score, fill, numbers, f"{data.artifacts_in:,}", line=line)


def _fed(data: YearData) -> Fact | None:
    span, total = _span(data, "artifacts"), data.fed + data.salvaged
    if span is None or total <= 0:
        return None
    fill = {"total": f"{total:,}", "fed": f"{data.fed:,}", "salvaged": f"{data.salvaged:,}"}
    numbers = {"total": total, "fed": data.fed, "salvaged": data.salvaged}
    return _make(data, "fed", span.first, total_score(total, _scaled("fed", span)), fill, numbers, f"{total:,}")


# -------- play


def _longest_session(data: YearData) -> Fact | None:
    span = _span(data, "sessions")
    if span is None or data.longest_session is None:
        return None
    minutes, day = data.longest_session
    fill = {"length": _length(minutes), "day": _long(day)}
    numbers = {"minutes": minutes, "day": day.isoformat()}
    score = record_score(minutes, RECORD_SIZE["longest_session"])
    return _make(data, "longest_session", span.first, score, fill, numbers, _length(minutes, short=True),
                 line="line_long" if minutes >= 180 else "line")


def _longest_run(data: YearData) -> Fact | None:
    span = _span(data, "sessions")
    if span is None:
        return None
    days = sorted(day for day in data.played if span.first <= day <= span.last)
    run = months._longest_run_span([data.played[day] > 0 for day in days], days)
    if run is None or run[0] < 2:
        return None
    length, first, last = run
    fill = {"days": f"{length:,} days", "first": _long(first), "last": _long(last)}
    numbers = {"days": length, "first": first.isoformat(), "last": last.isoformat()}
    score = record_score(length, RECORD_SIZE["longest_run"])
    return _make(data, "longest_run", span.first, score, fill, numbers, f"{length:,}")


def _favourite_hour(data: YearData) -> Fact | None:
    span = _span(data, "sessions")
    if span is None or not data.grid:
        return None
    hours = [sum(row[hour] for row in data.grid) for hour in range(24)]
    total = sum(hours)
    if total <= 0:
        return None
    hour = max(range(24), key=lambda h: (hours[h], -h))
    share = hours[hour] / total
    fill = {"hour": f"{hour:02d}:00", "share": _share(hours[hour], total)}
    numbers = {"hour": hour, "minutes": round(hours[hour]), "share": round(share, 3)}
    score = min(1.0, max(0.0, (share * 24 - 1) / 5))
    return _make(data, "favourite_hour", span.first, score, fill, numbers, f"{hour:02d}:00")


def _favourite_weekday(data: YearData) -> Fact | None:
    span = _span(data, "sessions")
    if span is None or not data.grid:
        return None
    days = [sum(row) for row in data.grid]
    total = sum(days)
    if total <= 0:
        return None
    weekday = max(range(len(days)), key=lambda d: (days[d], -d))
    share = days[weekday] / total
    fill = {"weekday": WEEKDAYS[weekday], "share": _share(days[weekday], total)}
    numbers = {"weekday": weekday, "minutes": round(days[weekday]), "share": round(share, 3)}
    score = min(1.0, max(0.0, (share * 7 - 1) / 2))
    return _make(data, "favourite_weekday", span.first, score, fill, numbers, WEEKDAYS[weekday])


def _achievements(data: YearData) -> Fact | None:
    span = _span(data, "achievements")
    if span is None or data.achievements <= 0:
        return None
    fill = {"count": f"{data.achievements:,}"}
    numbers = {"done": data.achievements}
    score = total_score(data.achievements, _scaled("achievements", span))
    return _make(data, "achievements", span.first, score, fill, numbers, f"{data.achievements:,}")


def _regions(data: YearData) -> Fact | None:
    span = _span(data, "exploration")
    if span is None or not data.regions:
        return None
    count = len(data.regions)
    names = ", ".join(data.regions[:-1]) + " and " + data.regions[-1] if count > 1 else data.regions[0]
    fill = {"count": f"{count:,}", "names": names}
    numbers = {"count": count, "names": list(data.regions)}
    return _make(data, "regions", span.first, record_score(count, RECORD_SIZE["regions"]), fill, numbers, f"{count:,}")


# -------- endgame


def _best(data: YearData, mode: str, key: str) -> tuple[int, Cycle] | None:
    found = [
        (cycle.detail[key], cycle) for cycle in data.cycles
        if cycle.mode == mode and isinstance(cycle.detail.get(key), int) and not isinstance(cycle.detail.get(key), bool)
    ]
    return max(found, key=lambda item: item[0]) if found else None


def _abyss(data: YearData) -> Fact | None:
    span, best = _span(data, "abyss"), _best(data, "abyss", "stars")
    if span is None or best is None:
        return None
    stars = best[0]
    fill = {"stars": stars}
    numbers = {"stars": stars}
    return _make(data, "abyss", span.first, min(1.0, stars / STARS), fill, numbers, str(stars),
                 line="line_full" if stars >= STARS else "line")


def _theater(data: YearData) -> Fact | None:
    span = _span(data, "theater")
    found = [
        (cycle.detail["acts"], [bool(m) for m in cycle.detail.get("medals") or []], cycle) for cycle in data.cycles
        if cycle.mode == "theater" and isinstance(cycle.detail.get("acts"), int)
    ]
    if span is None or not found:
        return None
    acts, medals, _ = max(found, key=lambda item: (item[0], sum(item[1])))
    won, of = sum(medals), len(medals)
    fill = {"acts": acts, "won": won, "of": of}
    numbers = {"acts": acts, "medals": won, "of": of}
    score = min(1.0, acts / max(acts, of or THEATER_ACTS))
    return _make(data, "theater", span.first, score, fill, numbers, str(acts), line="line_medals" if of else "line")


def _stygian(data: YearData) -> Fact | None:
    span, best = _span(data, "stygian"), _best(data, "stygian", "difficulty")
    if span is None or best is None:
        return None
    difficulty = best[0]
    fill = {"difficulty": difficulty}
    numbers = {"difficulty": difficulty}
    return _make(data, "stygian", span.first, min(1.0, difficulty / STYGIAN_TOP), fill, numbers, str(difficulty))


def _strike(data: YearData) -> Fact | None:
    """The year's strongest strike in the Spiral Abyss; none when it is the character of the year's, as her card says
    it."""
    span, strike = _span(data, "abyss"), _top_rank(data, "abyss", "strike")
    if span is None or strike is None:
        return None
    value, avatar = strike
    name = _name(data, avatar)
    best = character_of_year(data)
    if name is not None and best is not None and best["name"] == name:
        return None
    person = data.people.get(avatar)
    fill = {"value": f"{value:,}", "name": name or ""}
    numbers = {"value": value, "name": name}
    return _make(data, "strike", span.first, record_score(value, RECORD_SIZE["strike"]), fill, numbers, f"{value:,}",
                 line="line" if name else "line_nameless", hero="hero" if name else "hero_nameless",
                 faces=[person.face if person else None])


FACTS: dict[str, Callable[[YearData], Fact | None]] = {
    "character": _character,
    "luckiest": _luckiest,
    "unluckiest": _unluckiest,
    "biggest_month": _biggest_month,
    "five_in_a_day": _five_in_a_day,
    "primogems": _primogems,
    "welkin": _welkin,
    "resin": _resin,
    "condensed": _condensed,
    "artifacts": _artifacts,
    "fed": _fed,
    "longest_session": _longest_session,
    "longest_run": _longest_run,
    "favourite_hour": _favourite_hour,
    "favourite_weekday": _favourite_weekday,
    "abyss": _abyss,
    "theater": _theater,
    "stygian": _stygian,
    "strike": _strike,
    "achievements": _achievements,
    "regions": _regions,
}


def year_facts(data: YearData) -> list[Fact]:
    """Every fact the year's data gives, one of each kind, in FACTS's order."""
    return [fact for compute in FACTS.values() if (fact := compute(data)) is not None]


# ---------------------------------------------------------------------------------------------- the choice


def choose(facts: Sequence[Fact], at_most: int = 9, at_least: int = 6) -> list[Fact]:
    """The cards: the highest scores, never two of a kind. While others remain, at most PER_CATEGORY of each of pulls,
    play, resources and endgame, one of each family, and none under FLOOR; the weak and the second of a family are taken
    only to reach `at_least`. Highest score first."""
    ranked = sorted(facts, key=lambda fact: -fact.score)
    picked: list[Fact] = []
    kinds: set[str] = set()
    families: set[str] = set()
    per_category: Counter[str] = Counter()

    def take(fact: Fact) -> None:
        picked.append(fact)
        kinds.add(fact.kind)
        families.add(FAMILY.get(fact.kind, fact.kind))
        per_category[CATEGORY.get(fact.kind, fact.kind)] += 1

    def free(fact: Fact) -> bool:
        return fact.kind not in kinds and FAMILY.get(fact.kind, fact.kind) not in families

    waiting = []
    for fact in ranked:
        if len(picked) >= at_most:
            break
        if fact.score < FLOOR or not free(fact):
            continue
        category = CATEGORY.get(fact.kind, fact.kind)
        if category in CAPPED and per_category[category] >= PER_CATEGORY:
            waiting.append(fact)
            continue
        take(fact)
    for fact in waiting:  # no other remains: a category may give more
        if len(picked) >= at_most:
            break
        if free(fact):
            take(fact)
    for fact in ranked:  # to reach the fewest cards
        if len(picked) >= min(at_least, at_most):
            break
        if fact.kind not in kinds:
            take(fact)
    return sorted(picked, key=ranked.index)


# ---------------------------------------------------------------------------------------------- the year


def _since_label(since: date | None) -> str | None:
    return f"since {months.day_label(since)}" if since is not None else None


def _since_month(since: date | None) -> str | None:
    return f"since {MONTH_NAMES[since.month - 1]}" if since is not None else None


def _own_counts(data: YearData) -> list[tuple[str, int, date | None]]:
    """The year's own counts, each where its source covers enough of the year: (label, value, since)."""
    candidates = (
        ("wishes", "wishes", lambda: sum(data.wish_months.values())),
        ("five-stars", "wishes", lambda: len(data.fives)),
        ("primogems earned", "primogems", lambda: sum(data.primogem_months.values())),
        ("hours in Teyvat", "sessions", lambda: round(sum(data.played.values()) / 60)),
        ("days played", "sessions", lambda: sum(1 for minutes in data.played.values() if minutes > 0)),
        ("resin spent", "resin", lambda: sum(data.resin.values())),
        ("five-star artifacts", "artifacts", lambda: data.artifacts_in),
        ("achievements", "achievements", lambda: data.achievements),
    )
    counts = []
    for label, source, value in candidates:
        span = _span(data, source)
        if span is not None:
            counts.append((label, int(value()), _since(data, span.first)))
    modes = [span for mode in MODES if (span := _span(data, mode)) is not None]
    if modes:
        counted = _counted(data)
        cycles = sum(1 for cycle in data.cycles if cycle.mode in counted)
        counts.append(("endgame cycles", cycles, _since(data, min(span.first for span in modes))))
    return counts


def _days_with_data(data: YearData) -> tuple[str, int, date | None] | None:
    """The days of the year a source covers enough of to say something: a count every listed year has."""
    spans = [span for source in data.spans if (span := _span(data, source)) is not None]
    if not spans:
        return None
    days = {span.first + timedelta(days=offset) for span in spans for offset in range(span.days)}
    return ("days with data", len(days), _since(data, min(span.first for span in spans)))


def _headline(fact: Fact) -> int | None:
    """A card's number on the poster as a whole number, when it is one ("1,915", not "July")."""
    text = fact.poster[1].replace(",", "") if fact.poster is not None else ""
    return int(text) if text.isascii() and text.isdigit() else None


def _counters(data: YearData, cards: Sequence[Fact]) -> list[dict[str, Any]]:
    """The hero's three counters, each with its "since": the year's own counts, then the days with data, then the
    chosen cards' numbers."""
    found = _own_counts(data)[:3]
    days = _days_with_data(data)
    if len(found) < 3 and days is not None:
        found.append(days)
    for fact in cards:
        if len(found) >= 3:
            break
        value = _headline(fact)
        if fact.kind != "character" and fact.poster is not None and value is not None:
            found.append((fact.poster[0], value, fact.since))
    return [{"label": label, "value": value, "since": _since_label(since)} for label, value, since in found[:3]]


def _poster_numbers(data: YearData, facts: Sequence[Fact], cards: Sequence[Fact]) -> list[dict[str, Any]]:
    """Six numbers for a year of six cards or more, four for a thin year: the wishes, the five-stars, the primogems
    earned, the biggest month, the luckiest 5★ and the longest session first (the best of them when there are more than
    four for a thin year), then the chosen cards' numbers, the other facts' and the year's own counts, so that a year
    missing some of the six still has six, and a listed year always four."""
    by_kind = {fact.kind: fact for fact in facts}
    numbers: list[tuple[float, dict[str, Any]]] = []  # (score, number); the year's own counts are always kept
    wishes = _span(data, "wishes")
    if wishes is not None:
        since = _since_month(_since(data, wishes.first))
        numbers.append((math.inf, {"label": "wishes", "value": f"{sum(data.wish_months.values()):,}", "since": since}))
        numbers.append((math.inf, {"label": "five-stars", "value": f"{len(data.fives):,}", "since": since}))
    for kind in ("primogems", "biggest_month", "luckiest", "longest_session"):
        fact = by_kind.get(kind)
        if fact is not None and fact.poster is not None:
            label, value = fact.poster
            score = math.inf if kind == "primogems" else fact.score
            numbers.append((score, {"label": label, "value": value, "since": _since_month(fact.since)}))
    # The others, in order: the chosen cards' numbers, the other facts', then the year's own counts, the days with data
    # last. Each ranks under every one of the six (a pity scores above -1), and keeps its own label and "since".
    chosen = {fact.kind for fact in cards}
    others = sorted((fact for fact in facts if fact.kind not in chosen), key=lambda fact: -fact.score)
    pool = [
        (fact.poster[0], fact.poster[1], fact.since)
        for fact in [*cards, *others] if fact.kind != "character" and fact.poster is not None
    ]
    days = _days_with_data(data)
    pool += [(label, f"{value:,}", since) for label, value, since in [*_own_counts(data), *([days] if days else [])]]
    shown = {number["label"] for _, number in numbers}
    for label, value, since in pool:
        if label not in shown:
            numbers.append((-1.0 - len(numbers), {"label": label, "value": value, "since": _since_month(since)}))
            shown.add(label)
    # A year of six cards or more has six numbers; a thin year, of fewer cards, four (the design, 6.3).
    wanted = 6 if len(cards) >= 6 and len(numbers) >= 6 else 4
    best = sorted(range(len(numbers)), key=lambda index: -numbers[index][0])[:wanted]
    return [numbers[index][1] for index in sorted(best)]


def _hero_line(facts: Sequence[Fact], cards: Sequence[Fact]) -> str:
    """The hero's line: the character of the year's, else the first card's; "Since 13 Oct: ..." when it is from part of
    the year."""
    lead = next((fact for fact in facts if fact.kind == "character"), cards[0] if cards else None)
    if lead is None:
        return ""
    if lead.since is None:
        return lead.hero
    return f"Since {months.day_label(lead.since)}: {lead.hero[:1].lower()}{lead.hero[1:]}"


def build_year(data: YearData) -> dict[str, Any]:
    """The year's Wrapped: the hero, the cards and the poster. With five-stars in a day among the cards, the luckiest
    card leaves that day to it."""
    facts = year_facts(data)
    cards = choose(facts)
    told = next((date.fromisoformat(card.numbers["day"]) for card in cards if card.kind == "five_in_a_day"), None)
    if told is not None:
        cards = [(_luckiest(data, told) or card) if card.kind == "luckiest" else card for card in cards]
    best = character_of_year(data)
    character = {"name": best["name"], "picture": best["picture"]} if best is not None else None
    return {
        "year": data.year,
        "so_far": data.year == data.today.year,
        "hero": {"line": _hero_line(facts, cards), "counters": _counters(data, cards), "character": character},
        "cards": [
            {"kind": fact.kind, "heading": fact.heading, "big": fact.big, "line": fact.line, "faces": list(fact.faces),
             "numbers": fact.numbers}
            for fact in cards
        ],
        "poster": {
            "name": data.profile.name, "ar": data.profile.ar, "server": data.profile.server, "character": character,
            "numbers": _poster_numbers(data, facts, cards),
        },
    }


# ---------------------------------------------------------------------------------------------- reading the store


def _no_picture(url: str | None) -> str | None:
    return None


class _Sources:
    """What is known of the player, read once, that every year is made of. The month model's own reading
    (`months._Month`) gives the wishes, the coverage of each source, the primogems by month and the achievements ticked,
    so that a year agrees with its months."""

    def __init__(
        self, store: Store, history: History, uid: int | None, server: str, today: date,
        states: Mapping[str, PoolState], now: datetime, profile: Profile,
        address: Callable[[str | None], str | None] | None, tz: tzinfo | None,
    ) -> None:
        self.store, self.history, self.uid, self.server, self.today, self.now = store, history, uid, server, today, now
        self.profile, self.address, self.tz = profile, address or _no_picture, tz
        self.month = months._Month(store, history, uid, server, today, states, now)
        self.pities = {five.wish.id: five.pity for state in states.values() for five in state.fives}
        self.ledger = income.covered(store, uid, server) if uid is not None else None
        self.resin = self._log("resin")
        self.artifacts = self._log("artifact")
        self.cycles = self._cycles()
        self.people = self._people()

    def _log(self, kind: str) -> tuple[date, date] | None:
        """The game days a game's log covers whole: from the day after its oldest entry to its newest's."""
        if self.uid is None:
            return None
        oldest, newest = self.store.oldest_ledger_entry(self.uid, kind), self.store.newest_ledger_entry(self.uid, kind)
        if oldest is None or newest is None:
            return None
        first, last = game_day(oldest.at, self.server) + timedelta(days=1), game_day(newest.at, self.server)
        return (first, last) if first <= last else None

    def _cycles(self) -> list[tuple[str, date, date, dict[str, Any]]]:
        """Each kept cycle as (mode, the game day it began, the game day it counts on, detail): an ended cycle on the
        day it ended, the open one on today."""
        out = []
        for row in self.store.endgame_cycles():
            if row.mode not in MODES:
                continue
            began = game_day(parse_iso(row.starts), self.server)
            counts = game_day(min(parse_iso(row.ends), self.now), self.server)
            out.append((row.mode, began, counts, row.detail))
        return out

    def _people(self) -> dict[int, Person]:
        """The characters HoYoLAB lists, by id, with their faces and large pictures (`image`) from the art cache."""
        doc = self.store.latest_doc("characters")
        builds = (doc[1].get("builds") or {}).get("builds") if doc is not None else None
        people = {}
        for build in builds or ():
            if isinstance(build, dict) and isinstance(build.get("id"), int) and build.get("name"):
                face, picture = self.address(build.get("icon") or None), self.address(build.get("image") or None)
                people[build["id"]] = Person(str(build["name"]), face, picture)
        return people

    def years(self) -> list[int]:
        """Every year from the first any source reaches to today's."""
        starts = [self.month.coverage.earliest(), *(span[0] for span in (self.resin, self.artifacts) if span)]
        starts += [start for _, start, _, _ in self.cycles]
        known = [day for day in starts if day is not None and day <= self.today]
        return list(range(min(known).year, self.today.year + 1)) if known else []

    def year(self, year: int) -> YearData:
        first, last = date(year, 1, 1), min(date(year, 12, 31), self.today)
        cover = self.month.coverage

        def clip(start: date | None, end: date | None = None) -> Span | None:
            if start is None:
                return None
            span = Span(max(first, start), min(last, end) if end is not None else last)
            return span if span.first <= span.last else None

        found = {
            "wishes": clip(cover.wishes, cover.wishes_to),
            "primogems": clip(cover.primogems),
            "ledger": clip(*self.ledger) if self.ledger else None,
            "resin": clip(*self.resin) if self.resin else None,
            "artifacts": clip(*self.artifacts) if self.artifacts else None,
            "sessions": clip(cover.sessions),
            "achievements": clip(cover.achievements),
            "exploration": clip(self.history.tracking_since()),
        }
        cycles = tuple(Cycle(mode, day, detail) for mode, _, day, detail in self.cycles if first <= day <= last)
        for mode in MODES:
            starts = [start for m, start, day, _ in self.cycles if m == mode and first <= day <= last]
            found[mode] = clip(min(starts)) if starts else None
        spans = {source: span for source, span in found.items() if span is not None}
        data: dict[str, Any] = {"cycles": cycles, "people": self.people}
        data.update(self._wishes(spans.get("wishes")))
        data.update(self._primogems(year, spans.get("primogems"), spans.get("ledger")))
        data.update(self._logs(spans.get("resin"), spans.get("artifacts")))
        data.update(self._play(spans.get("sessions")))
        if "achievements" in spans:
            data["achievements"] = len(self.month.ticked(spans["achievements"].first, spans["achievements"].last))
        if "exploration" in spans:
            data["regions"] = self._regions(spans["exploration"])
        return YearData(year=year, today=self.today, profile=self.profile, spans=spans, **data)

    def _wishes(self, span: Span | None) -> dict[str, Any]:
        if span is None:
            return {}
        counts = {month: 0 for month in range(span.first.month, span.last.month + 1)}
        fives = []
        for row, day in zip(self.month.rows, self.month.wish_days):
            if not span.first <= day <= span.last:
                continue
            counts[day.month] += 1
            if row.rank == 5:
                kind = wish_kind(row.item_type)
                fives.append(Five(row.name, kind, day, row.id, self.pities.get(row.id),
                                  wish_icon(kind, row.name, self.month.wiki)))
        return {"wish_months": counts, "fives": tuple(fives)}

    def _primogems(self, year: int, span: Span | None, ledger: Span | None) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if span is not None:
            values = {ym: value for ym, value in self.month.primogem_months.items() if ym[:4] == f"{year:04d}"}
            out["primogem_months"] = {int(ym[5:]): int(value) for ym, value in values.items()}
            sources: dict[str, int] = {}
            for ym in values:
                for source in months._sources(self.month, ym):
                    sources[source["name"]] = sources.get(source["name"], 0) + int(source["amount"])
            out["primogem_sources"] = sources
        if ledger is not None and self.uid is not None:
            days = income.earned_by_day(self.store, self.uid, self.server, ledger.first, ledger.last)
            out["welkin"] = sum(groups.get("welkin", 0) for groups in days.values())
        return out

    def _entries(self, kind: str, span: Span) -> Iterable[Any]:
        since = game_day_start(span.first, self.server) - timedelta(seconds=1)
        for row in self.store.ledger_entries(self.uid, kind, since=since):  # type: ignore[arg-type]
            if span.first <= game_day(row.at, self.server) <= span.last:
                yield row

    def _logs(self, resin: Span | None, artifacts: Span | None) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if resin is not None:
            spent: dict[str, int] = {}
            for row in self._entries("resin", resin):
                if row.amount < 0:
                    spent[row.reason] = spent.get(row.reason, 0) - row.amount
            out["resin"] = spent
        if artifacts is not None:
            got = used = fed = salvaged = 0
            for row in self._entries("artifact", artifacts):
                if row.amount > 0 and row.rarity == 5:
                    got += row.amount
                elif row.amount < 0 and row.reason in FED:
                    used += -row.amount if row.rarity == 5 else 0
                    fed += -row.amount if row.reason == FED[0] else 0
                    salvaged += -row.amount if row.reason == FED[1] else 0
            out.update({"artifacts_in": got, "artifacts_used": used, "fed": fed, "salvaged": salvaged})
        return out

    def _play(self, span: Span | None) -> dict[str, Any]:
        if span is None:
            return {}
        grid = self.history.minutes_by_hour(span.first, span.last, self.tz)
        return {
            "longest_session": months._longest_session(self.month, span.first, span.last),
            "played": self.month.minutes(span.first, span.last),
            "grid": tuple(tuple(row) for row in grid),
        }

    def _regions(self, span: Span) -> tuple[str, ...]:
        """The regions whose exploration reached 100% inside the span, having been under it at its start."""
        names = []
        for key, label in self.store.labels("region").items():
            point = f"{key}.pct"
            start = self.store.value_before(point, span.first)
            if start is None:
                start = self.store.first_value_in(point, span.first, span.last)
            end = self.store.value_at_or_before(point, span.last)
            if start is not None and end is not None and start < 100 <= end:
                names.append(label.label)
        return tuple(names)


def year_data(
    store: Store, history: History, uid: int | None, server: str, year: int, today: date,
    states: Mapping[str, PoolState], now: datetime, profile: Profile,
    address: Callable[[str | None], str | None] | None = None, tz: tzinfo | None = None,
) -> YearData:
    """The year's data read from the store. `states` are the Pulls page's own (with its corrections and windows), so
    that a pity is the same on both pages; `address` gives the art cache's address of a picture; `tz` is the clock the
    hours are read on (None: this PC's)."""
    return _Sources(store, history, uid, server, today, states, now, profile, address, tz).year(year)


def year_list(
    store: Store, history: History, uid: int | None, server: str, today: date, states: Mapping[str, PoolState],
    now: datetime, profile: Profile, address: Callable[[str | None], str | None] | None = None,
    tz: tzinfo | None = None,
) -> list[int]:
    """The years with at least MIN_FACTS facts, oldest first."""
    sources = _Sources(store, history, uid, server, today, states, now, profile, address, tz)
    return [year for year in sources.years() if len(year_facts(sources.year(year))) >= MIN_FACTS]


def stats_year(
    store: Store, history: History, uid: int | None, server: str, year: int | None, today: date,
    states: Mapping[str, PoolState], now: datetime, profile: Profile,
    address: Callable[[str | None], str | None] | None = None, tz: tzinfo | None = None,
) -> dict[str, Any]:
    """The answer of GET /api/stats/year: the years listed, the core's current year (the one still
    going) and the year chosen, which is `year` when it is listed and else the newest.
    With no year listed, the list is empty and the year None."""
    sources = _Sources(store, history, uid, server, today, states, now, profile, address, tz)
    datas = {each: sources.year(each) for each in sources.years()}
    years = [each for each, data in datas.items() if len(year_facts(data)) >= MIN_FACTS]
    if not years:
        return {"years": [], "current_year": today.year, "year": None}
    chosen = year if year in years else years[-1]
    return {"years": years, "current_year": today.year, "year": build_year(datas[chosen])}
