"""Reaction constants and the character level multipliers (the Plan page's and the simulator's design, section 5)."""
from __future__ import annotations

from guildboard.characters import constants


def test_level_multipliers_are_the_current_ones():
    assert constants.level_mult(90) == 1446.8535 and constants.level_mult(95) == 1561.468
    assert constants.level_mult(100) == 1674.8092 and len(constants.tables()["level_mult"]) == 100


def test_reaction_constants():
    t = constants.tables()
    assert t["stellar_conduct"][:2] == [1, 1.45] and t["stellar_conduct"][12] == 2
    assert t["additive"] == {"aggravate": 1.15, "spread": 1.25} and t["enemy"] == {"level": 100, "res": 0.1}


def test_the_other_constants():
    t = constants.tables()
    assert t["amplifying"] == {"vaporize-hydro": 2.0, "vaporize-pyro": 1.5, "melt-pyro": 2.0, "melt-cryo": 1.5}
    assert t["lunar"] == {"lunar-bloom": 1, "lunar-charged": 3, "lunar-crystallize": 1.6, "stellar-swirl": 1}
    assert len(t["stellar_conduct"]) == 13


def test_the_polestar_fields_damage_bonus_follows_the_recorded_hits():
    field = constants.tables()["polestar_dmg"]
    assert len(field) == 13 and field[0] == 0.20 and field[1] == 0.29 and field[12] == 0.40
    assert all(round(b - a, 2) == 0.01 for a, b in zip(field[1:], field[2:]))
    cited = next(s for s in constants.reference.load_tables()["sources"] if s["id"] == "KQM-reactions")
    assert "polestar_dmg" in cited["used_for"]


def test_level_multipliers_rise_and_stay_in_range():
    values = constants.tables()["level_mult"]
    assert values[0] == 17.165606 and values[89] == 1446.8535
    assert all(b >= a for a, b in zip(values, values[1:]))
    for level in (0, 101):
        try:
            constants.level_mult(level)
        except ValueError:
            continue
        raise AssertionError(f"level {level} should raise")


def test_the_multipliers_are_cited():
    ids = {source["id"] for source in constants.reference.load_tables()["sources"]}
    assert "GO-dm-level" in ids
