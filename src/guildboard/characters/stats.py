"""Stats (the design, section 7.1): the panel, where each stat comes from, the plan's panel and the stats in combat.

All values are in the units HoYoLAB shows: percentages as 46.6 for 46.6%, flat stats as they are. `phys` is Physical DMG Bonus,
a stat key beside the contract's STATS; `dmg` is the DMG Bonus of her own element (the plan's amendment of 2026-10-29).

The panel carries two extra keys, `base_hp` and `base_def` (HoYoLAB's base values), so that `in_combat`, which is given only
the base ATK, can still count a conditional HP % or DEF % effect.

Stats are worked out from structure: `_totals` adds what the weapon, the set and each piece bring. A plan is applied to a Build
(`apply_plan`), and its panel is the panel now plus the difference between the two totals. So HoYoLAB's own numbers stay the
base, and only what the plan changes moves."""
from __future__ import annotations

from dataclasses import replace
from typing import Iterable, Mapping

from guildboard.characters import SLOTS
from guildboard.characters.models import (
    Build, Card, Effect, Piece, Plan, Refs, SetChoice, Sub, WeaponState,
)

# HoYoLAB's property ids -> the contract's stat keys. These are the game's own fight-property numbers, which HoYoLAB's
# `property_map` carries: 2000, 2001 and 2002 are the final Max HP, ATK and DEF, 2, 5 and 8 the flat HP, ATK and DEF of an
# artifact's main stat or substat, 40 to 46 the seven elements' DMG Bonus.
PROP_KEYS: dict[int, str] = {
    2000: "hp", 2001: "atk", 2002: "def", 2: "hp", 5: "atk", 8: "def", 3: "hp_pct", 6: "atk_pct", 9: "def_pct",
    28: "em", 23: "er", 20: "cr", 22: "cd", 26: "heal", 30: "phys",
    40: "dmg", 41: "dmg", 42: "dmg", 43: "dmg", 44: "dmg", 45: "dmg", 46: "dmg",
}
# Which property is each element's DMG Bonus: the service reads her own element's as `dmg`.
ELEMENT_DMG_PROPS = {"Pyro": 40, "Electro": 41, "Hydro": 42, "Dendro": 43, "Anemo": 44, "Geo": 45, "Cryo": 46}

STAT_LABELS = {
    "hp": "HP", "atk": "ATK", "def": "DEF", "hp_pct": "HP %", "atk_pct": "ATK %", "def_pct": "DEF %",
    "em": "Elemental Mastery", "er": "Energy Recharge", "cr": "Crit Rate", "cd": "Crit DMG", "heal": "Healing Bonus",
    "phys": "Physical DMG Bonus",
}


def label(stat: str, element: str | None = None) -> str:
    """A stat's name as the game shows it; `dmg` takes her element."""
    if stat == "dmg":
        return f"{element} DMG Bonus" if element else "Elemental DMG Bonus"
    return STAT_LABELS.get(stat, stat)


def max_level(rarity: int) -> int:
    """The level an artifact of this rarity tops out at."""
    return {5: 20, 4: 16, 3: 12, 2: 8, 1: 4}.get(rarity, 20)


def panel(build: Build) -> dict[str, float]:
    """The panel: HoYoLAB's base plus added value, by stat key, with the base HP and DEF beside it as `base_hp` and `base_def`."""
    out = {key: build.base.get(key, 0.0) + build.add.get(key, 0.0) for key in {*build.base, *build.add}}
    out["base_hp"] = build.base.get("hp", 0.0)
    out["base_def"] = build.base.get("def", 0.0)
    return out


# ------------------------------------------------------------------------------------------------ effects

def _value(effect: Effect, refinement: int) -> float:
    """An effect's value at a refinement (a set's effect has one value)."""
    if not effect.values:
        return 0.0
    return effect.values[min(max(refinement, 1), len(effect.values)) - 1]


def _gather(into: dict[str, float], effects: Iterable[Effect], refinement: int, when: str) -> None:
    for effect in effects:
        if effect.when == when:
            into[effect.stat] = into.get(effect.stat, 0.0) + _value(effect, refinement)


def set_counts(build: Build) -> dict[str, int]:
    """How many pieces of each set she wears."""
    counts: dict[str, int] = {}
    for piece in build.pieces.values():
        counts[piece.set_key] = counts.get(piece.set_key, 0) + 1
    return counts


def worn_choice(build: Build) -> SetChoice | None:
    """The set bonus she has: a 4-piece set, or two 2-piece sets, or one 2-piece set; None when she has none."""
    counts = set_counts(build)
    four = [key for key, count in counts.items() if count >= 4]
    if four:
        return SetChoice(sets=(four[0],), pieces="4")
    pairs = tuple(key for key, count in counts.items() if count >= 2)
    return SetChoice(sets=pairs, pieces="2+2") if pairs else None


def _set_effects(choice: SetChoice | None, refs: Refs, when: str) -> dict[str, float]:
    out: dict[str, float] = {}
    if choice is None:
        return out
    for index, key in enumerate(choice.sets):
        ref = refs.sets.get(key)
        if ref is None:
            continue
        if choice.pieces == "4":
            if index == 0:
                _gather(out, ref.two, 1, when)
                _gather(out, ref.four, 1, when)
        else:
            _gather(out, ref.two, 1, when)
    return out


def _weapon_effects(weapon: str | None, refinement: int, refs: Refs, when: str) -> dict[str, float]:
    out: dict[str, float] = {}
    ref = refs.weapons.get(weapon) if weapon else None
    if ref is not None:
        _gather(out, ref.effects, refinement, when)
    return out


def _add(into: dict[str, float], stat: str | None, value: float) -> None:
    if stat and value:
        into[stat] = into.get(stat, 0.0) + value


def _own_atk(build: Build) -> float:
    return build.base.get("atk", 0.0) - (build.weapon.base_atk if build.weapon else 0.0)


def _totals(build: Build, refs: Refs) -> dict[str, float]:
    """What the build's weapon, set and pieces add up to, by stat key. ATK, HP and DEF are the numbers they come to with the
    percentages counted on her base; every other stat is a plain sum. Her own values are not in it: only differences of two
    totals are ever used."""
    adds: dict[str, float] = {}
    weapon = build.weapon
    if weapon is not None:
        _add(adds, weapon.sub, weapon.sub_value)
        for stat, value in _weapon_effects(weapon.key, weapon.refinement, refs, "always").items():
            _add(adds, stat, value)
    for stat, value in _set_effects(worn_choice(build), refs, "always").items():
        _add(adds, stat, value)
    for piece in build.pieces.values():
        _add(adds, piece.main, piece.main_value)
        for sub in piece.subs:
            _add(adds, sub.stat, sub.value)
    out = {key: value for key, value in adds.items() if key not in ("atk", "hp", "def", "atk_pct", "hp_pct", "def_pct")}
    out["atk"] = build.base.get("atk", 0.0) * (1 + adds.get("atk_pct", 0.0) / 100) + adds.get("atk", 0.0)
    out["hp"] = build.base.get("hp", 0.0) * (1 + adds.get("hp_pct", 0.0) / 100) + adds.get("hp", 0.0)
    out["def"] = build.base.get("def", 0.0) * (1 + adds.get("def_pct", 0.0) / 100) + adds.get("def", 0.0)
    return out


# ------------------------------------------------------------------------------------------------ split

def split(build: Build, refs: Refs, own: Mapping[str, float]) -> dict[str, tuple[float, float, float]]:
    """Each stat's (her own, weapon, artifacts). `own` is hers at her level from the wiki: atk, hp, def, and cr 5 + her
    ascension bonus, cd 50, er 100 ... The weapon's share is its base ATK, its sub-stat and its always-on effects (a percentage
    counted on her base ATK, HP or DEF); the artifacts' share is the rest of the panel, set bonuses included."""
    total = panel(build)
    adds: dict[str, float] = {}
    weapon = build.weapon
    if weapon is not None:
        _add(adds, weapon.sub, weapon.sub_value)
        for stat, value in _weapon_effects(weapon.key, weapon.refinement, refs, "always").items():
            _add(adds, stat, value)
    result: dict[str, tuple[float, float, float]] = {}
    for stat in sorted({*total, *own, *adds} - {"base_hp", "base_def"}):
        her = own.get(stat, 0.0)
        share = adds.get(stat, 0.0)
        if stat == "atk":
            share += (weapon.base_atk if weapon else 0.0) + build.base.get("atk", 0.0) * adds.get("atk_pct", 0.0) / 100
        elif stat in ("hp", "def"):
            share += build.base.get(stat, 0.0) * adds.get(f"{stat}_pct", 0.0) / 100
        result[stat] = (her, share, total.get(stat, 0.0) - her - share)
    return result


# ------------------------------------------------------------------------------------------------ plans

def now_plan(build: Build) -> Plan:
    """A plan that changes nothing: what she has now."""
    weapon = build.weapon
    return Plan(
        level=build.level, talents=dict(build.talents), weapon=None, weapon_level=weapon.level if weapon else 1,
        refinement=weapon.refinement if weapon else 1, set=None, mains={}, level_pieces=(), typed=None,
    )


def _rolls_left(level: int) -> int:
    return max(0, (20 - level + 3) // 4)


def apply_plan(build: Build, plan: Plan, card: Card, refs: Refs) -> Build:
    """The build once the plan is done, as a Build: talents, level, the weapon at its planned level and refinement, the main
    stats chosen, pieces levelled to +20 (each substat gaining the average roll times rolls left over 4), the typed piece in
    its slot, and the set's pieces. Her own level changes no stat here (the wiki's per-level values are not given); the
    weapon's values at a level other than 90 are only known for the weapon she has."""
    typed = plan.typed if plan.typed is not None and plan.typed.use else None
    pieces: dict[str, Piece] = {}
    for slot, piece in build.pieces.items():
        if typed is not None and typed.slot == slot:
            subs = tuple(
                Sub(stat, value, max(1, round(value / refs.roll_avg[stat])) if refs.roll_avg.get(stat) else 1)
                for stat, value in typed.subs if stat and value
            )
            pieces[slot] = replace(
                piece, name="The piece you typed", icon=None, level=20, rarity=5, main=typed.main,
                main_value=refs.mains_20.get(typed.main, 0.0), subs=subs,
            )
            continue
        main = plan.mains.get(slot, piece.main) if slot in ("sands", "goblet", "circlet") else piece.main
        if main != piece.main:
            pieces[slot] = replace(piece, main=main, main_value=refs.mains_20.get(main, piece.main_value))
        elif slot in plan.level_pieces and piece.level < 20:
            left = _rolls_left(piece.level)
            subs = tuple(Sub(sub.stat, sub.value + refs.roll_avg.get(sub.stat, 0.0) * left / 4, sub.rolls) for sub in piece.subs)
            pieces[slot] = replace(piece, level=20, main_value=refs.mains_20.get(piece.main, piece.main_value), subs=subs)
        else:
            pieces[slot] = piece
    choice = plan.set
    if choice is not None and choice != worn_choice(build) and choice.sets:
        first, last = choice.sets[0], choice.sets[-1]
        order = (first,) * 5 if choice.pieces == "4" else (first, first, last, last, first)
        for index, slot in enumerate(SLOTS):
            if slot in pieces:
                ref = refs.sets.get(order[index])
                pieces[slot] = replace(pieces[slot], set_key=order[index], set_name=ref.name if ref else order[index])
    weapon = build.weapon
    base = dict(build.base)
    if weapon is not None or plan.weapon:
        own = _own_atk(build)
        if plan.weapon and (weapon is None or plan.weapon != weapon.key):
            ref = refs.weapons.get(plan.weapon)
            if ref is not None:
                weapon = WeaponState(
                    key=ref.key, name=ref.name, icon=ref.icon, type=ref.type, rarity=ref.rarity, level=plan.weapon_level,
                    refinement=plan.refinement, base_atk=ref.base_atk_90, sub=ref.sub, sub_value=ref.sub_90,
                )
        elif weapon is not None:
            ref = refs.weapons.get(weapon.key)
            if plan.weapon_level > weapon.level and ref is not None:
                weapon = replace(
                    weapon, level=plan.weapon_level, base_atk=ref.base_atk_90, sub=ref.sub, sub_value=ref.sub_90,
                )
            weapon = replace(weapon, refinement=plan.refinement)
        if weapon is not None:
            base["atk"] = own + weapon.base_atk
    talents = {kind: max(level, plan.talents.get(kind, level)) for kind, level in build.talents.items()}
    return replace(build, level=max(build.level, plan.level), talents=talents, weapon=weapon, pieces=pieces, base=base)


def planned(build: Build, plan: Plan, card: Card, refs: Refs) -> dict[str, float]:
    """The panel once the plan is done: the panel now, plus what the plan brings and minus what it replaces."""
    after = apply_plan(build, plan, card, refs)
    now, then = _totals(build, refs), _totals(after, refs)
    out = panel(build)
    for key in {*now, *then}:
        out[key] = out.get(key, 0.0) + then.get(key, 0.0) - now.get(key, 0.0)
    return out


def in_combat(
    stats: dict[str, float], weapon: str | None, refinement: int, set_choice: SetChoice | None, base_atk: float, refs: Refs
) -> dict[str, float]:
    """The stats in combat: the panel with the weapon's and the set's effects that hold when met counted as met, every one
    that applies and with no grouping. A percentage of ATK is counted on `base_atk`; one of HP or DEF on the panel's `base_hp`
    or `base_def` (the stat itself when the panel has none). `phys` stays a key of its own: the damage estimate counts it."""
    add = _weapon_effects(weapon, refinement, refs, "met")
    for stat, value in _set_effects(set_choice, refs, "met").items():
        add[stat] = add.get(stat, 0.0) + value
    out = dict(stats)
    for stat, value in add.items():
        if stat == "atk_pct":
            out["atk"] = out.get("atk", 0.0) + base_atk * value / 100
        elif stat == "hp_pct":
            out["hp"] = out.get("hp", 0.0) + out.get("base_hp", out.get("hp", 0.0)) * value / 100
        elif stat == "def_pct":
            out["def"] = out.get("def", 0.0) + out.get("base_def", out.get("def", 0.0)) * value / 100
        else:
            out[stat] = out.get(stat, 0.0) + value
    return out


def combat(build: Build, plan: Plan, card: Card, refs: Refs) -> dict[str, float]:
    """The stats in combat with the plan done: `planned`, with the planned weapon's and set's conditional effects counted."""
    after = apply_plan(build, plan, card, refs)
    weapon = after.weapon
    return in_combat(
        planned(build, plan, card, refs), weapon.key if weapon else None, weapon.refinement if weapon else 1,
        worn_choice(after), after.base.get("atk", 0.0), refs,
    )


def combat_now(build: Build, card: Card, refs: Refs) -> dict[str, float]:
    """The stats in combat as she is."""
    return combat(build, now_plan(build), card, refs)
