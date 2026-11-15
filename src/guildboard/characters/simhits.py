"""The hits block of the planner's simulator (`sim.hits`, the Plan design, sections 7.4 and 12.1 to 12.3): each talent's damage
rows at her level, each with the kind of damage the kit data gives it, what it scales on and how many times it lands, her main
talents, and the kit's effects and toggles for the interface's damage engine. Pure functions of what the service has read:
HoYoLAB's rows (`Build.affixes`), the wiki's tables, the kit (`kits.kit_of`) and her levels.

A talent's rows come from HoYoLAB's own list when it has one (already at her boosted level), else from the wiki's table at the
column of her level, else none: a level past the table's last is never guessed. A row is a hit when its name says damage
(`hits.is_damage`) and its value is one hit's (`hits.parse_choices`); the few kit rows whose value is "per Paw", "each" or "per
Verdant Dew" count one unit. Anything else is left out, as the engine could not use it."""
from __future__ import annotations

import re
from typing import Any, Mapping, Sequence

from guildboard.characters.hits import Term, instances, is_damage, kind_by_name, normalise, parse_choices, parse_value, reaction_kinds
from guildboard.htmltext import clean_row_name, strip_tags

TALENTS = ("normal", "skill", "burst")
_HEADER = re.compile(r"lev\w*", re.I)                    # the wiki's "Level", and Odette's burst table's "Leve"
_STATS = {"": "atk", "atk": "atk", "max hp": "hp", "def": "def", "elemental mastery": "em"}
_PER_UNIT = re.compile(
    r"^(\d+(?:\.\d+)?)\s*%\s*(Max HP|ATK|DEF|Elemental Mastery)?\s*(?:each\b|per\s.+|/\s*\S.*)$", re.I)
_EITHER = re.compile(r"\bLow/High\b", re.I)               # a plunge lands low or high, not both
_WORDING_TOLERANCE = 0.0006                               # HoYoLAB prints one decimal of a percentage, the wiki two


# ------------------------------------------------------------------------------------------------ the wiki's tables

def table_pairs(table: Sequence[Mapping[str, Any]] | None, level: int) -> list[tuple[str, str]] | None:
    """The (row name, value text) pairs of a talent's table at one level: the column whose header says `Lv.<level>`. The header
    is the table's first row, named Level (or Leve, as Odette's burst's is); a row whose name only starts with "Level" is a row.
    None when there is no header or the table has no such level."""
    if not table or not _HEADER.fullmatch(str(table[0].get("key", "")).strip()):
        return None
    column = None
    for index, value in enumerate(table[0].get("values") or []):
        found = re.search(r"\d+", str(value))
        if found and int(found.group()) == level:
            column = index
            break
    if column is None:
        return None
    pairs = []
    for row in table[1:]:
        values = row.get("values") or []
        if column < len(values):
            pairs.append((str(row.get("key", "")), str(values[column])))
    return pairs


# ------------------------------------------------------------------------------------------------ the rows

def _per_unit(text: str) -> tuple[tuple[tuple[Term, ...], float, int], ...] | None:
    found = _PER_UNIT.match(" ".join(str(text).split()))
    if found is None:
        return None
    return (((Term(_STATS[(found.group(2) or "").casefold()], round(float(found.group(1)) / 100, 8)),), 0.0, 1),)


def _move(talent: str, name: str) -> str:
    """The move a row belongs to when the kit does not say: a skill's or burst's are the talent itself, a normal attack's is
    told by its name."""
    if talent != "normal":
        return talent
    lowered = name.casefold()
    if "plunge" in lowered:
        return "plunging"
    if "charged" in lowered or "aimed" in lowered:
        return "charged"
    return "normal"


def _worded(terms: Sequence[Term], flat: float, text: str, wording: str | None) -> tuple[Sequence[Term], float]:
    """HoYoLAB's value with no stat in its text (`140.2%`) is read as ATK; where the wiki's table, at the same level, words the
    same row with another stat and a multiplier that agrees, the wiki's stat is the row's (the Plan design, 12.1)."""
    if wording is None or len(terms) != 1 or terms[0].stat != "atk" or "atk" in text.casefold():
        return terms, flat
    parsed = parse_value(wording)
    if parsed is None or {t.stat for t in parsed[0]} == {"atk"} and len(parsed[0]) == 1:
        return terms, flat
    if not any(abs(t.mult - terms[0].mult) < _WORDING_TOLERANCE for t in parsed[0]):
        return terms, flat
    return parsed[0], parsed[1]


def rows_of(pairs: Sequence[tuple[str, str]], talent: str, kit: Mapping[str, Any], weapon_type: str,
            wording: Sequence[tuple[str, str]] | None = None) -> list[dict[str, Any]]:
    """The damage rows of one talent from its (name, value) pairs. The kit decides a row's kind (and the element of a Stellar
    one, and the move of a normal attack row); a row it does not have is told by its name (`hits.kind_by_name`). A row that
    prints alternatives with a slash is paired with the kit's hits for it: each alternative is a hit of its own (a Lunar or
    Stellar pair is told by the order of its names; the rows of one source row share its name in `alternative`, so that the
    engine can count one of them if it must), except a Low/High plunge, which lands once and takes its first; a slash
    row the kit does not have takes its first alternative. `wording` is the wiki's pairs for the same level."""
    known = {normalise(name): kind for name, kind in (kit.get("hits") or {}).get(talent, {}).items()}
    elements = {normalise(name): element for name, element in (kit.get("elements") or {}).get(talent, {}).items()}
    moves = {normalise(name): move for name, move in (kit.get("moves") or {}).get(talent, {}).items()}
    main = {normalise(name) for name in kit["main"]} if kit.get("main") else None
    party = kit.get("party")
    takes = {normalise(name) for name in ((party or {}).get("element_rows") or {}).get(talent, ())}
    only = {normalise(name): list(who) for name, who in ((party or {}).get("only_rows") or {}).get(talent, {}).items()}
    infused = any(
        not item.get("while") and set(item.get("talents") or ()) & {"normal", "charged", "plunging"}
        for item in kit.get("infused") or ())
    words = {normalise(name): text for name, text in wording or ()}
    rows: list[dict[str, Any]] = []
    for name, text in pairs:
        if not is_damage(name):
            continue
        shown = clean_row_name(strip_tags(str(name)))
        key = normalise(name)
        choices = parse_choices(text)
        if choices is None and key in known:
            choices = _per_unit(text)
        if choices is None:
            continue
        if len(choices) > 1 and (key not in known or _EITHER.search(shown)):
            choices = choices[:1]
        kind = known[key] if key in known else kind_by_name(shown, talent, weapon_type, infused, choices[0][0])
        kinds = [kind] * len(choices)
        if len(choices) > 1 and len(reaction_kinds(shown)) == len(choices):
            kinds = reaction_kinds(shown)
        texts = str(text).split("/") if len(choices) > 1 else [str(text)]
        for index, ((terms, flat, count), what) in enumerate(zip(choices, kinds)):
            terms, flat = _worded(terms, flat, text, words.get(key)) if len(choices) == 1 else (terms, flat)
            rows.append({
                "name": shown if index == 0 else f"{shown} ({index + 1} of {len(choices)})", "kind": what,
                "terms": [{"stat": term.stat, "mult": term.mult} for term in terms], "flat": flat, "count": count,
                "move": moves.get(key) or _move(talent, shown),
                "element": elements[key].capitalize() if what.startswith("stellar") and key in elements else None,
                "alternative": shown if len(choices) > 1 else None,
                "instances": instances(texts[index]) if index < len(texts) else 1,
                "main": main is None or key in main,
            })
            if party:
                # the rows the team decides (the Plan design 14): `takes`, dealt once for each element of the team's option, and
                # `only`, the options that deal it (None: every option)
                rows[-1]["takes"] = key in takes
                rows[-1]["only"] = only.get(key)
    return rows


# ------------------------------------------------------------------------------------------------ the block

def _resolve_rates(effects: list[dict[str, Any]], levels: Mapping[str, int]) -> None:
    """An effect that is a talent row (`row`) carries its rate by talent level; it is given at the level of the talent it is
    a row of (a level past the list's last takes the last)."""
    for effect in effects:
        row, rate = effect.get("row"), effect.get("rate")
        if row and isinstance(rate, list) and levels.get(row["talent"]):
            effect["rate"] = rate[min(max(int(levels[row["talent"]]), 1), len(rate)) - 1]


def hits_block(*, element: str, weapon_type: str, level: int, levels: Mapping[str, int], raised: Mapping[str, int],
               affixes: Mapping[str, Sequence[tuple[str, str]]], tables: Mapping[str, Sequence[Mapping[str, Any]]],
               names: Mapping[str, tuple[str, str | None]], kit: Mapping[str, Any], recommended: Sequence[str],
               weapon_effects: Mapping[str, Mapping[str, Any]], set_effects: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """`sim.hits` for one character. `levels` is each talent's level with her constellations' bonus (the rows are at it) and `raised` the level the player
    raised it to, without the bonus (the main talents are chosen by it); `affixes` are HoYoLAB's
    rows by talent, `tables` the wiki's; `kit` is `kits.kit_of` for her alone (without her weapon and sets, whose effects are
    `weapon_effects` and `set_effects`)."""
    # each talent's rows' source: (where they are from, their (name, value) pairs, the wiki's pairs for the same level)
    found: dict[str, tuple[str | None, list[tuple[str, str]], Sequence[tuple[str, str]] | None]] = {}
    for kind in TALENTS:
        pairs = list(affixes.get(kind) or ())
        column = table_pairs(tables.get(kind), levels[kind]) if kind in tables else None
        if pairs:
            found[kind] = ("hoyolab", pairs, column)
        elif column is not None:
            found[kind] = ("wiki", list(column), None)
        else:
            found[kind] = (None, [], None)
    # a row a person gave hits no row of HoYoLAB's prints (Sethos's Dusk Bolts, which have his Normal Attack's numbers): the row it copies,
    # at the copied talent's level, under its own name; none when the copied row is not there
    for derived in kit.get("derived_rows") or ():
        copied = normalise(derived["from_row"])
        text = next((value for name, value in found[derived["from_talent"]][1] if normalise(name) == copied), None)
        if text is None:
            continue
        source, pairs, wording = found[derived["talent"]]
        found[derived["talent"]] = (source or found[derived["from_talent"]][0], [*pairs, (derived["name"], text)], wording)
    talents = []
    for kind in TALENTS:
        source, pairs, wording = found[kind]
        name, icon = names[kind]
        rows = rows_of(pairs, kind, kit, weapon_type, wording) if source else []
        talents.append({"key": kind, "name": name, "icon": icon, "level": levels[kind], "main": False, "source": source, "rows": rows})
    _mark_main(talents, bool(kit.get("main")), raised)
    _fix_stellar(talents, kit.get("stellar"))
    _drop_absent(talents, kit.get("absent_rows"))
    effects = [dict(effect) for effect in kit.get("effects") or ()]
    _resolve_rates(effects, levels)
    return {
        "element": element, "weapon_type": weapon_type, "level": level, "checked": bool(kit.get("checked")),
        "unsure": kit.get("unsure"), "party": kit.get("party"),
        "recommended": list(recommended), "talents": talents, "effects": effects,
        "toggles": [dict(toggle) for toggle in kit.get("toggles") or ()], "infused": [{**item, "element": str(item["element"]).capitalize()} for item in kit.get("infused") or ()],
        "weapon_effects": dict(weapon_effects), "set_effects": dict(set_effects),
    }


def _fix_stellar(talents: list[dict[str, Any]], kind: str | None) -> None:
    """A character whose Stellar hits come in two kinds (Sandrone's Stellar-Conduct or Stellar Swirl, by her team) has one fixed by
    a person (`kit["stellar"]`): the rows of the other kind are never dealt in that setup, so they are not counted (`main` False;
    the page can still list them), and a talent left with no counted row is not a main talent."""
    if kind is None:
        return
    for talent in talents:
        for row in talent["rows"]:
            if row["kind"].startswith("stellar-") and row["kind"] != kind:
                row["main"] = False
        talent["main"] = talent["main"] and any(row["main"] for row in talent["rows"])


def _drop_absent(talents: list[dict[str, Any]], absent: Mapping[str, Sequence[str]] | None) -> None:
    """A row her kit does not deal at her constellation (Yanfei's Charged Attack with four Scarlet Seals, which only Constellation 6
    allows) is not counted (`main` False; the page can still list it), and a talent left with no counted row is not a main talent."""
    for talent in talents:
        names = {normalise(name) for name in (absent or {}).get(talent["key"], ())}
        if not names:
            continue
        for row in talent["rows"]:
            if normalise(row["name"]) in names:
                row["main"] = False
        talent["main"] = talent["main"] and any(row["main"] for row in talent["rows"])


def _mark_main(talents: list[dict[str, Any]], named: bool, raised: Mapping[str, int]) -> None:
    """The main talents: those that hold a row the kit names, when it names any that are found; else the talents with rows that
    are within one level of the highest of them (the Plan design, 12.2), by the levels she raised: a constellation's bonus
    does not move a talent out. When the kit names rows that are not found, every row
    counts, as it does for a kit that names none."""
    if named and any(row["main"] for talent in talents for row in talent["rows"]):
        for talent in talents:
            talent["main"] = any(row["main"] for row in talent["rows"])
        return
    for talent in talents:
        for row in talent["rows"]:
            row["main"] = True
    held = [talent for talent in talents if talent["rows"]]
    if held:
        top = max(raised[talent["key"]] for talent in held)
        for talent in held:
            talent["main"] = raised[talent["key"]] >= top - 1
