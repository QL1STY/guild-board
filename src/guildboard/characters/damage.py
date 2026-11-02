"""The damage estimate (the design, section 7.2; damage roles only).

damage = S x (1 + DMG%) x (1 + min(CR, 100%) x CD) x T(level of the damage talent). Percentages are in HoYoLAB's units
(46.6 for 46.6%). The page shows only `change`, as an estimate."""
from __future__ import annotations

import math

from guildboard.characters.models import Card, Refs


def dmg_bonus(combat: dict[str, float], card: Card) -> float:
    """The DMG Bonus that counts for the card: her element's (`dmg`), plus Physical DMG Bonus (`phys`) when the card's talent
    table is physical, and nothing of it otherwise."""
    bonus = combat.get("dmg", 0.0)
    if card.talent_table == "physical":
        bonus += combat.get("phys", 0.0)
    return bonus


def estimate(combat: dict[str, float], card: Card, talent_level: int, refs: Refs) -> float:
    """One hit's expected damage, in the model's own units."""
    table = refs.scaling.get(card.talent_table) or refs.scaling.get("elemental") or (1.0,)
    multiplier = table[min(max(talent_level, 1), len(table)) - 1]
    crit_rate = min(max(combat.get("cr", 0.0), 0.0), 100.0) / 100
    return (
        combat.get(card.scaling, 0.0) * (1 + dmg_bonus(combat, card) / 100)
        * (1 + crit_rate * combat.get("cd", 0.0) / 100) * multiplier
    )


def change(now: float, plan: float) -> int:
    """The plan's change over now, in whole percent."""
    if now <= 0:
        return 0
    return math.floor((plan / now - 1) * 100 + 0.5)
