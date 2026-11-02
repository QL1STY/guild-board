"""Readiness, 0 to 100 (the design, section 7.3).

Level 15%, talents 25%, weapon 20%, artifacts 40%. The artifacts' part is 0.6 x fit + 0.25 x main stats right + 0.15 x set.
Readiness after the plans is the same function given the build the plan makes (`stats.apply_plan`) and its stats in combat."""
from __future__ import annotations

import math

from guildboard.characters import damage, stats
from guildboard.characters.models import Build, Card, Readiness, Refs

WEIGHTS = {"level": 0.15, "talents": 0.25, "weapon": 0.20, "artifacts": 0.40}
TALENT_WEIGHTS = (0.5, 0.3, 0.2)
WEAPON_TIERS = (1.0, 0.9, 0.85)


def raw(parts: dict[str, float]) -> float:
    """The total from its parts, before rounding to a whole number."""
    return sum(WEIGHTS[key] * parts[key] for key in WEIGHTS)


def talent_level(build: Build, card: Card) -> int:
    """The level her damage talent has, constellation bonus counted."""
    return build.talents.get(card.damage_talent, 1) + build.bonus.get(card.damage_talent, 0)


def _weapon_part(build: Build, card: Card, weapon_level: int | None) -> float:
    weapon = build.weapon
    if weapon is None:
        return 0.0
    if weapon.key in card.weapons:
        tier = WEAPON_TIERS[min(card.weapons.index(weapon.key), len(WEAPON_TIERS) - 1)]
    elif weapon.type == card.weapon_type:
        tier = 0.75 if weapon.rarity >= 5 else 0.65 if weapon.rarity == 4 else 0.5
    else:
        tier = 0.5
    level = weapon.level if weapon_level is None else weapon_level
    return tier * min(1.0, level / 90)


def _set_part(build: Build, card: Card) -> float:
    """1 for a complete set of the card's, 0.5 for half of one, 0 otherwise (1 when the card names none)."""
    if not card.sets:
        return 1.0
    counts = stats.set_counts(build)
    best = 0.0
    for choice in card.sets:
        if not choice.sets:
            continue
        if choice.pieces == "4":
            have = counts.get(choice.sets[0], 0)
            score = 1.0 if have >= 4 else 0.5 if have >= 2 else 0.0
        else:
            score = sum(1 for key in choice.sets if counts.get(key, 0) >= 2) / len(choice.sets)
        best = max(best, score)
    return best


def _mains_right(build: Build, card: Card) -> float:
    right = 0
    for slot in ("sands", "goblet", "circlet"):
        piece = build.pieces.get(slot)
        if piece is not None and (not card.mains.get(slot) or piece.main in card.mains[slot]):
            right += 1
    return right / 3


def _goal_estimate(build: Build, card: Card, refs: Refs, combat: dict[str, float]) -> float:
    """The estimate at the card's goals for the scaling stat, DMG Bonus, Crit Rate and Crit DMG, with the same talent level
    and the same effects that hold when met. A stat the card gives no goal for stays as it is."""
    weapon = build.weapon
    key, refinement = (weapon.key, weapon.refinement) if weapon else (None, 1)
    choice, base_atk = stats.worn_choice(build), build.base.get("atk", 0.0)
    zero = {name: 0.0 for name in ("atk", "hp", "def", "em")}
    zero.update({name: combat[name] for name in ("base_hp", "base_def") if name in combat})
    met = stats.in_combat(zero, key, refinement, choice, base_atk, refs)
    # what the effects that hold when met add to each stat, taken off so that they are counted once, after the goals
    goal_stats = {name: value - (met.get(name, 0.0) - zero.get(name, 0.0)) for name, value in combat.items()}
    for name, value in card.goals.items():
        goal_stats[name] = value
    return damage.estimate(stats.in_combat(goal_stats, key, refinement, choice, base_atk, refs), card, talent_level(build, card), refs)


def _fit(build: Build, card: Card, refs: Refs, combat: dict[str, float]) -> float:
    if "damage" in card.roles:
        ideal = _goal_estimate(build, card, refs, combat)
        if ideal <= 0:
            return 1.0
        return min(1.0, damage.estimate(combat, card, talent_level(build, card), refs) / ideal)
    attained = [
        min(1.0, (damage.dmg_bonus(combat, card) if name == "dmg" else combat.get(name, 0.0)) / goal)
        for name, goal in card.goals.items() if goal > 0
    ]
    return sum(attained) / len(attained) if attained else 1.0


def score(
    build: Build | None, card: Card, refs: Refs, combat: dict[str, float], weapon_level: int | None = None
) -> Readiness:
    """How ready a character is: level, talents, weapon and artifacts, each 0 to 1, and the total. `combat` is her stats in
    combat (`stats.combat`); `weapon_level` is the weapon's planned level, when scoring a plan."""
    if build is None:
        return Readiness(total=0, parts={key: 0.0 for key in WEIGHTS})
    talents = sum(
        weight * min(1.0, build.talents.get(kind, 1) / 10) for weight, kind in zip(TALENT_WEIGHTS, card.talent_priority)
    )
    artifacts = 0.6 * _fit(build, card, refs, combat) + 0.25 * _mains_right(build, card) + 0.15 * _set_part(build, card)
    parts = {
        "level": min(1.0, build.level / 90), "talents": talents, "weapon": _weapon_part(build, card, weapon_level),
        "artifacts": artifacts,
    }
    return Readiness(total=math.floor(raw(parts) * 100 + 0.5), parts=parts)
