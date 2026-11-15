"""The damage engine's constants (the Plan page's and the simulator's design, section 5): the character level multipliers
for levels 1 to 100, the amplifying, additive, Lunar and Stellar reaction constants, the Polestar field's DMG Bonus and the enemy the verdict assumes.

They are the game's own, read from tables.json (its `sources` say where each comes from), and the same dict goes to the
interface's engine as `sim.tables`. Nothing here is estimated: a level outside 1 to 100 raises."""
from __future__ import annotations

from typing import Any

from guildboard.characters import reference

KEYS = ("level_mult", "amplifying", "additive", "lunar", "stellar_conduct", "polestar_dmg", "enemy")


def tables() -> dict[str, Any]:
    """The constants as the interface's engine takes them: level_mult (index = level - 1), amplifying, additive, lunar,
    stellar_conduct and polestar_dmg (the Polestar field's Cryo and Electro DMG Bonus; index = recorded hits, 0 to 12) and enemy."""
    full = reference.load_tables()
    return {key: full[key] for key in KEYS}


def level_mult(level: int) -> float:
    """A character's level multiplier (playerElementLevelCo) at level 1 to 100."""
    values = reference.load_tables()["level_mult"]
    if not 1 <= level <= len(values):
        raise ValueError(f"no level multiplier for level {level}")
    return values[level - 1]
