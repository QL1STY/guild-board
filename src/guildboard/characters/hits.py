"""A talent row read as a hit: what its value says it scales on (`parse_value`), whether the row is damage at all
(`is_damage`), its name as both HoYoLAB and the wiki print it, so that rows of the two can be set side by side
(`normalise`), and the kind of a hit when the kit data does not know the character (`kind_by_name`).

The values are the game's own: `235%` (of ATK), `40.7% Max HP`, `240% DEF`, `144.0% Elemental Mastery`,
`600.5% ATK+1,201.0% Elemental Mastery`, `(121.0% ATK + 241.9% Elemental Mastery)×2`, `2.53% Max HP ×5`, `47.4%+88.1%` (two
hits that add), `398.1% ATK+3051` (a flat part). Anything else is not one hit's value and gives None: a choice of two hits
(`64.7%/80.8%`, Low/High Plunge), a value per stack or per unit, a percentage of a stat the hit does not scale on, a duration."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Sequence

from guildboard.htmltext import clean_row_name, strip_tags


KINDS = ("physical", "elemental", "lunar-bloom", "lunar-charged", "lunar-crystallize", "stellar-conduct", "stellar-swirl")


@dataclass(frozen=True)
class Term:
    """One scaling stat of a hit and its multiplier (185.76% is 1.8576). `stat` is atk, hp, def or em."""
    stat: str
    mult: float


@dataclass(frozen=True)
class Row:
    """A damage row of a talent: its name, the kind of damage, what it scales on, the flat part, and how many times it hits."""
    name: str
    kind: str
    terms: tuple[Term, ...]
    flat: float
    count: int


_NUMBER = r"\d+(?:\.\d+)?"
_PERCENT = re.compile(rf"^({_NUMBER})\s*%\s*(Max HP|ATK|DEF|Elemental Mastery)?$")
_FLAT = re.compile(rf"^({_NUMBER})$")
_COUNT = re.compile(r"\s*[×xX*]\s*(\d+)$")
_GROUP = re.compile(r"^\((.*)\)\s*[×xX*]\s*(\d+)$")
_STATS = {"": "atk", "ATK": "atk", "Max HP": "hp", "DEF": "def", "Elemental Mastery": "em"}  # a bare percentage is ATK


def _atom(text: str) -> tuple[Term | None, float] | None:
    """One part of a sum: a percentage of a stat (the term), or a flat number (the second), or None for anything else."""
    text = text.strip()
    found = _PERCENT.match(text)
    if found:
        return Term(_STATS[found.group(2) or ""], float(found.group(1)) / 100), 0.0
    found = _FLAT.match(text)
    if found:
        return None, float(found.group(1))
    return None


def _sum(parts: list[tuple[str, int]]) -> tuple[list[Term], float] | None:
    """The terms and the flat part of a sum of `(text, count)` parts, each part's count folded into its numbers."""
    terms: dict[str, float] = {}
    flat = 0.0
    for part, times in parts:
        atom = _atom(part)
        if atom is None:
            return None
        term, extra = atom
        flat += extra * times
        if term is not None:
            terms[term.stat] = terms.get(term.stat, 0.0) + term.mult * times
    return [Term(stat, round(mult, 8)) for stat, mult in terms.items()], round(flat, 8)


def _parts(text: str) -> tuple[list[tuple[str, int]], int] | None:
    """The parts of a value's sum with their own counts, and the count of the whole, as `parse_value` reads them."""
    if not isinstance(text, str):
        return None
    text = " ".join(text.split()).replace(",", "")  # thousands commas, no-break spaces
    if not text:
        return None
    group = _GROUP.match(text)
    if group:
        count = int(group.group(2))
        parts = [(part, 1) for part in group.group(1).split("+")]
    elif "(" in text or ")" in text:
        return None
    else:
        parts = []
        for part in text.split("+"):
            part = part.strip()
            found = _COUNT.search(part)
            parts.append((part[:found.start()] if found else part, int(found.group(1)) if found else 1))
        count = 1
        counts = {times for _, times in parts}
        if len(counts) == 1:
            count = counts.pop()
            parts = [(part, 1) for part, _ in parts]
    if count < 1 or any(times < 1 for _, times in parts):
        return None
    # the game names the stat once, after the last part of a sum (`62.2%+62.2% DEF`): every bare percentage is of that stat
    named = re.search(r"%\s*(Max HP|ATK|DEF|Elemental Mastery)$", parts[-1][0].strip())
    if named and len(parts) > 1:
        parts = [(f"{part.strip()} {named.group(1)}" if re.fullmatch(rf"\s*{_NUMBER}\s*%\s*", part) else part, times)
                 for part, times in parts]
    return parts, count


def parse_value(text: str) -> tuple[tuple[Term, ...], float, int] | None:
    """`(terms, flat, count)` of a row's value, or None when it is not one hit's value. Terms of one stat are added (`47.4%+88.1%`
    is one term of 135.5%); `count` is how many times the hit lands (`×5`, `x5`, `*5`). When every part of a sum carries the same
    count the sum has it; when they differ (`a%×2+b%`) each part's count is folded into its numbers and the count is 1."""
    split = _parts(text)
    if split is None:
        return None
    parts, count = split
    summed = _sum(parts)
    if summed is None or not summed[0]:
        return None
    terms, flat = summed
    return tuple(terms), flat, count


def instances(text: str) -> int:
    """How many hits one landing of a value is (its `count` aside): the parts of a sum that scale on the same stat are hits of
    their own (`47.4%+88.1%` is two, `45%×2+30%` three), while parts on different stats, or a flat part, are one hit
    (`600.5% ATK+1,201.0% Elemental Mastery`). A flat bonus added per hit (Aggravate, Spread) is added this many times. 1 for a
    value that is not one hit's."""
    split = _parts(text)
    if split is None:
        return 1
    per_stat: dict[str, int] = {}
    for part, times in split[0]:
        atom = _atom(part)
        if atom is not None and atom[0] is not None:
            per_stat[atom[0].stat] = per_stat.get(atom[0].stat, 0) + times
    return max(per_stat.values(), default=1)


def parse_choices(text: str) -> tuple[tuple[tuple[Term, ...], float, int], ...] | None:
    """The alternatives of a value that prints several hits with a slash (`64.7%/80.8%`, Low/High Plunge; `65.2%/86.9%/49.6%×3`,
    where the count belongs to the last only), each as `parse_value` gives it. None unless every alternative is one hit's value
    (`35% Max HP/Stack` and `0%/12%/12% Bond of Life` are not). A value with no slash has one alternative."""
    if not isinstance(text, str) or not text.strip():
        return None
    if "(" in text or ")" in text:
        if "/" in text:  # no slash inside brackets is a shape the game prints
            return None
        parsed = parse_value(text)
        return None if parsed is None else (parsed,)
    parts = text.split("/")
    # the game names the stat once, after the last alternative (`8.19%/5.87% Max HP`): the others are of the same stat
    named = re.search(r"%\s*(Max HP|ATK|DEF|Elemental Mastery)\s*$", parts[-1])
    if named and len(parts) > 1:
        parts = [f"{part.strip()} {named.group(1)}" if re.fullmatch(rf"\s*{_NUMBER}\s*%\s*", part) else part for part in parts]
    choices = [parse_value(part) for part in parts]
    if any(choice is None for choice in choices):
        return None
    return tuple(choice for choice in choices if choice is not None)


# Words that make a row a bonus, a reduction, an interval or the like even when it has "DMG" in it ("Shield DMG Absorption").
# Also a total of the row's own hits ("Total DMG") and a bonus per stack to another hit (Eula's "DMG Per Stack").
_NOT_A_HIT = re.compile(r"\b(?:Bonus|Increase|Decrease|Reduction|Absorption|Interval|Conversion)\b|^Total\b|\bPer Stack$")
# Rows that are damage though they do not say DMG: the aimed shots, a charged attack, damage over time, Tartaglia's slash.
_HIT_WITHOUT_DMG = re.compile(
    r"^(?:(?:Fully-Charged |Level \d+ )?Aimed Shot(?: Charge Level \d+)?|Charged Attack(?:: .+)?|Riptide Slash)$|\bDoT$")


def is_damage(name: str) -> bool:
    """Whether a talent row is a hit: it says DMG (or DoT, or is one of the few damage rows that do not), and is not a bonus,
    an absorption, a reduction or an interval that mentions DMG."""
    name = clean_row_name(strip_tags(str(name or "")))
    if not name or _NOT_A_HIT.search(name):
        return False
    return bool(re.search(r"\bDMG\b", name) or _HIT_WITHOUT_DMG.search(name))


def normalise(name: Any) -> str:
    """A row's name the way both sources can be matched on it: tags stripped, each layout token as its PC wording, spaces
    collapsed, case-folded."""
    return clean_row_name(strip_tags(str(name or ""))).casefold()


_REACTIONS = (
    (re.compile(r"lunar[-\s]*bloom", re.I), "lunar-bloom"),
    (re.compile(r"lunar[-\s]*charged", re.I), "lunar-charged"),
    (re.compile(r"lunar[-\s]*crystallize", re.I), "lunar-crystallize"),
    (re.compile(r"stellar[-\s]*conduct", re.I), "stellar-conduct"),
    (re.compile(r"stellar[-\s]*swirl", re.I), "stellar-swirl"),
)
_BOW_PHYSICAL = re.compile(r"^\d+-Hit DMG$|^Aimed Shot$|\bPlunge\b", re.I)


def reaction_kinds(name: str) -> list[str]:
    """The reactions a row's name says, in the order it says them ("Coda Stellar-Conduct/Stellar Swirl DMG" gives
    stellar-conduct, then stellar-swirl), each once."""
    row = clean_row_name(strip_tags(str(name or "")))
    found = sorted((match.start(), kind) for pattern, kind in _REACTIONS for match in pattern.finditer(row))
    return list(dict.fromkeys(kind for _, kind in found))


def kind_by_name(name: str, talent: str, weapon_type: str, infused: bool, terms: Sequence[Term] | None = None) -> str:
    """The kind of a hit from its row alone, for a character the kit data does not cover (the names do not always say Lunar or
    Stellar; the kit data decides first). A reaction the row names; otherwise physical for a normal-attack row of a sword,
    claymore or polearm, and for a bow's "N-Hit DMG", its plain "Aimed Shot" and its plunges only (its other rows are the
    element's); elemental for a catalyst's, for anything infused, for a skill or a burst, and, when the row's terms are given,
    for a normal-attack row that scales on HP, DEF or Elemental Mastery."""
    row = clean_row_name(strip_tags(str(name or "")))
    for pattern, kind in _REACTIONS:
        if pattern.search(row):
            return kind
    weapon = str(weapon_type or "").casefold()
    if str(talent or "").casefold() not in ("normal", "auto") or infused or weapon == "catalyst":
        return "elemental"
    if terms and any(term.stat != "atk" for term in terms):
        return "elemental"
    if weapon == "bow" and not _BOW_PHYSICAL.search(row):
        return "elemental"
    return "physical"
