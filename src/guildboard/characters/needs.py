"""Needs and sources (the design, section 7.6): amounts are local; HoYoLAB's calculator only tells what is held.

Amounts come from the wiki's per-level tables (`Costs`) for any target. Her levels and her weapon's are two more materials,
`character-exp` and `weapon-exp`, in EXP points, and using that EXP costs Mora too: 1 for each 5 of a character's EXP and 1
for each 10 of a weapon's, rounded up. `Costs.exp` and `Costs.weapon_exp` are read as cumulative: index n is the EXP from
level 1 to level n, so a climb is a difference."""
from __future__ import annotations

import math
from typing import Mapping, Sequence

from guildboard.characters import stats
from guildboard.characters.models import Build, Card, Costs, Need, Plan, Source
from guildboard.metrics import slug
from guildboard.records import CalcItemRecord

TALENTS = ("normal", "skill", "burst")
CHARACTER_EXP = "character-exp"
WEAPON_EXP = "weapon-exp"
EXP_PER_MORA = {CHARACTER_EXP: 5, WEAPON_EXP: 10}   # a Hero's Wit's 20,000 EXP takes 4,000 Mora; a Mystic Ore's 10,000, 1,000


def _mains(build: Build | None, card: Card) -> dict[str, str]:
    """Each chosen slot's main stat: the one she wears when the card lists it, else the card's first."""
    mains = {}
    for slot in ("sands", "goblet", "circlet"):
        wanted = card.mains.get(slot, ())
        piece = build.pieces.get(slot) if build else None
        if piece is not None and (not wanted or piece.main in wanted):
            mains[slot] = piece.main
        elif wanted:
            mains[slot] = wanted[0]
    return mains


def default_plan(build: Build | None, card: Card) -> Plan:
    """The plan a character has until the player changes it: level 90, the card's damage talent at 10 and the next two in its
    order at 9 (never below what she has), the weapon she holds (else the card's first) at level 90, the card's set (the one
    she wears if it is on the card), the main stats the card wants, and every piece below +20 levelled."""
    held = build.talents if build else {}
    target = {card.damage_talent: 10}
    for kind in card.talent_priority:
        target.setdefault(kind, 9)
    for kind in TALENTS:
        target.setdefault(kind, 9)
    talents = {kind: max(held.get(kind, 1), target[kind]) for kind in TALENTS}
    weapon = build.weapon if build else None
    weapon_key = weapon.key if weapon else (card.weapons[0] if card.weapons else None)
    worn = stats.worn_choice(build) if build else None
    choice = worn if worn is not None and worn in card.sets else (card.sets[0] if card.sets else None)
    mains = _mains(build, card)
    level_pieces = tuple(
        slot for slot, piece in (build.pieces.items() if build else ())
        if piece.level < 20 and piece.rarity >= 5 and mains.get(slot, piece.main) == piece.main
    )
    return Plan(
        level=90, talents=talents, weapon=weapon_key, weapon_level=90, refinement=weapon.refinement if weapon else 1,
        set=choice, mains=mains, level_pieces=level_pieces, typed=None,
    )


def _exp(table: Sequence[int], now: int, target: int) -> int:
    if not table or target <= now:
        return 0
    return max(0, table[min(target, len(table) - 1)] - table[min(now, len(table) - 1)])


def amounts(build: Build | None, plan: Plan, costs: Costs) -> dict[str, int]:
    """Material key -> amount the plan needs, from the per-level tables: each talent from the level she has to the plan's, the
    ascension phases her level needs and she has not had, her EXP, the weapon's phases and EXP (a weapon she does not hold
    starts at level 1 with no ascension), and the Mora that using the EXP takes."""
    total: dict[str, int] = {}

    def add(items: Sequence[tuple[str, int]]) -> None:
        for key, amount in items:
            total[key] = total.get(key, 0) + amount

    for kind in TALENTS:
        have = build.talents.get(kind, 1) if build else 1
        for level in range(have + 1, plan.talents.get(kind, have) + 1):
            add(costs.talent.get(level, ()))
    level, phase = (build.level, build.ascension) if build else (1, 0)
    for number, ends in enumerate(costs.level_phase, 1):
        if number > phase and ends < plan.level:
            add(costs.ascension.get(number, ()))
    exp = _exp(costs.exp, level, plan.level)
    if exp:
        total[CHARACTER_EXP] = exp
    weapon = build.weapon if build else None
    held = weapon is not None and (not plan.weapon or plan.weapon == weapon.key)
    weapon_level = weapon.level if held and weapon else 1
    for number, ends in enumerate(costs.level_phase, 1):
        if ends >= weapon_level and ends < plan.weapon_level:
            add(costs.weapon.get(number, ()))
    exp = _exp(costs.weapon_exp, weapon_level, plan.weapon_level)
    if exp:
        total[WEAPON_EXP] = exp
    levelling = sum(math.ceil(total.get(key, 0) / per) for key, per in EXP_PER_MORA.items())
    if levelling:
        total["mora"] = total.get("mora", 0) + levelling
    return {key: amount for key, amount in total.items() if amount > 0}


def held_from_calculator(items: Sequence[CalcItemRecord], has_user_info: bool) -> dict[str, tuple[int, bool]]:
    """Key -> (held, exact), from what the calculator says: the amount asked for minus what is missing, exact when something
    was missing, and "at least" the amount when nothing was. Nothing when HoYoLAB's calculator sync is off. When two answers
    name the same material, an exact one wins, and the larger of two of a kind."""
    if not has_user_info:
        return {}
    held: dict[str, tuple[int, bool]] = {}
    for item in items:
        key = slug(item.name)
        reading = (max(0, item.amount - item.lacking), item.lacking > 0)
        old = held.get(key)
        if old is None or (reading[1], reading[0]) > (old[1], old[0]):
            held[key] = reading
    return held


def needs(
    amounts: Mapping[str, int],
    held: Mapping[str, tuple[int, bool]],
    typed: Mapping[str, int],
    sources: Mapping[str, Source],
    names: Mapping[str, tuple[str, str | None]],
) -> tuple[Need, ...]:
    """The materials a plan needs, with what is held (the calculator's, else what the player typed, else unknown) and where
    each comes from."""
    unknown = Source(kind="unknown", where="", days=())
    result = []
    for key, amount in amounts.items():
        if key in held:
            amount_held, exact = held[key]
        elif key in typed:
            amount_held, exact = typed[key], True
        else:
            amount_held, exact = None, True
        name, icon = names.get(key, (key, None))
        result.append(Need(
            material=key, name=name, icon=icon, amount=amount, held=amount_held, exact=exact, source=sources.get(key, unknown),
        ))
    return tuple(result)
