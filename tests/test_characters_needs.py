"""Task E3: needs from the wiki's tables with held amounts from HoYoLAB, and the odds of an artifact."""
from __future__ import annotations

import dataclasses

import pytest

from characters_samples import CHARITY, DOCTOR, SHADOW, TEASPOON, VAGRANCY, refs_sample, sandrone_build, sandrone_card
from guildboard.characters import needs, odds
from guildboard.characters.models import Costs, Need, Plan, SetChoice, Source
from guildboard.metrics import slug
from guildboard.records import CalcItemRecord

MORA, VAGRANCY_KEY, SHAFT = "mora", slug("Philosophies of Vagrancy"), slug("Precision Drive Shaft")
RESTRAINT, CROWN = slug("Madman's Restraint"), slug("Crown of Insight")

# Sandrone's Normal Attack 9 to 10, as the wiki gives it (the five amounts of the plan's W1 test).
NORMAL_9_TO_10 = ((MORA, 700000), (VAGRANCY_KEY, 16), (SHAFT, 12), (RESTRAINT, 2), (CROWN, 1))


def costs() -> Costs:
    return Costs(
        talent={9: ((MORA, 600000), (VAGRANCY_KEY, 9)), 10: NORMAL_9_TO_10},
        ascension={5: ((MORA, 50000), ("lumps", 3)), 6: ((MORA, 60000), ("lumps", 6), ("gems", 2))},
        weapon={5: ((MORA, 30000), ("ingots", 4)), 6: ((MORA, 40000), ("ingots", 8))},
        exp=(0, 0, 1000, 2325, 4025, 6175), weapon_exp=(0, 0, 400, 1100, 2300, 4000), level_phase=(20, 40, 50, 60, 70, 80),
    )


def test_the_default_plan_takes_the_damage_talent_to_10_and_the_others_to_9():
    build, card = sandrone_build(), sandrone_card()
    plan = needs.default_plan(build, card)
    assert plan.level == 90 and plan.weapon_level == 90
    assert plan.talents == {"normal": 10, "skill": 10, "burst": 10}   # hers are already past 9
    assert plan.weapon == TEASPOON and plan.refinement == 1
    assert plan.set == SetChoice(sets=(SHADOW,), pieces="4")
    assert plan.mains == {"sands": "atk_pct", "goblet": "dmg", "circlet": "cr"}   # the goblet's ATK % is not on the card
    assert plan.level_pieces == ("plume",) and plan.typed is None
    low = dataclasses.replace(build, talents={"normal": 1, "skill": 1, "burst": 1})
    card_skill = dataclasses.replace(card, damage_talent="skill", talent_priority=("skill", "burst", "normal"))
    assert needs.default_plan(low, card_skill).talents == {"skill": 10, "burst": 9, "normal": 9}


def test_a_character_not_owned_has_a_default_plan_from_the_card_alone():
    plan = needs.default_plan(None, sandrone_card())
    assert plan.level == 90 and plan.weapon == TEASPOON and plan.weapon_level == 90 and plan.level_pieces == ()
    assert plan.talents == {"normal": 10, "skill": 9, "burst": 9}
    assert plan.mains == {"sands": "atk_pct", "goblet": "dmg", "circlet": "cr"}


def test_her_normal_attack_from_9_to_10_costs_what_the_wiki_says():
    build, card = sandrone_build(), sandrone_card()
    assert needs.amounts(build, needs.default_plan(build, card), costs()) == dict(NORMAL_9_TO_10)


def test_levels_ascensions_and_the_weapon_cost_what_their_tables_say():
    build, card = sandrone_build(), sandrone_card()
    low = dataclasses.replace(
        build, level=2, ascension=4, talents={"normal": 10, "skill": 10, "burst": 10},
        weapon=dataclasses.replace(build.weapon, level=3),
    )
    plan = dataclasses.replace(needs.default_plan(low, card), level=5, weapon_level=5)
    # level 5 needs no ascension; the EXP is the difference of the cumulative column (her level 2 to 5, the weapon's 3 to 5),
    # and using it costs Mora: 1 for each 5 of a character's EXP (a Hero's Wit, 20,000 EXP, takes 4,000) and 1 for each 10
    # of a weapon's (a Mystic Enhancement Ore, 10,000 EXP, takes 1,000)
    levelling = (6175 - 1000) // 5 + (4000 - 1100) // 10
    assert needs.amounts(low, plan, costs()) == {
        "character-exp": 6175 - 1000, "weapon-exp": 4000 - 1100, MORA: levelling,
    }
    amounts = needs.amounts(low, dataclasses.replace(plan, level=90, weapon_level=90), costs())
    # she has had four phases, so phases 5 and 6 are to come; the weapon at level 3 has had none, so the table's 5 and 6 count
    assert amounts["lumps"] == 3 + 6 and amounts["gems"] == 2
    assert amounts["ingots"] == 4 + 8
    assert amounts[MORA] == 50000 + 60000 + 30000 + 40000 + levelling


def test_levelling_mora_rounds_up():
    build = dataclasses.replace(sandrone_build(), level=1, ascension=0, talents={"normal": 10, "skill": 10, "burst": 10})
    plan = dataclasses.replace(needs.default_plan(build, sandrone_card()), level=2, weapon_level=build.weapon.level)
    table = dataclasses.replace(costs(), exp=(0, 0, 1001))
    assert needs.amounts(build, plan, table) == {"character-exp": 1001, MORA: 201}


def test_a_weapon_she_does_not_hold_starts_at_level_1():
    build, card = sandrone_build(), sandrone_card()
    plan = dataclasses.replace(needs.default_plan(build, card), weapon="verdict", talents=build.talents)
    amounts = needs.amounts(build, plan, costs())
    assert amounts["ingots"] == 12 and amounts["weapon-exp"] == 4000   # the table's top row, from level 1


def test_held_amounts_come_from_amount_minus_missing():
    items = [
        CalcItemRecord(id=1, name="Philosophies of Vagrancy", icon="", amount=16, lacking=7),
        CalcItemRecord(id=2, name="Precision Drive Shaft", icon="", amount=12, lacking=0),
    ]
    held = needs.held_from_calculator(items, True)
    assert held[VAGRANCY_KEY] == (9, True)
    assert held[SHAFT] == (12, False)   # nothing was missing: she holds at least 12


def test_a_second_answer_for_the_same_material_keeps_the_exact_one():
    items = [
        CalcItemRecord(id=1, name="Mora", icon="", amount=100, lacking=0),
        CalcItemRecord(id=2, name="Mora", icon="", amount=500, lacking=300),
    ]
    assert needs.held_from_calculator(items, True) == {"mora": (200, True)}


def test_without_the_calculator_held_amounts_come_from_what_was_typed():
    items = [CalcItemRecord(id=1, name="Philosophies of Vagrancy", icon="", amount=16, lacking=7)]
    assert needs.held_from_calculator(items, False) == {}
    amounts = {VAGRANCY_KEY: 16, SHAFT: 12}
    sources = {VAGRANCY_KEY: VAGRANCY}
    names = {VAGRANCY_KEY: ("Philosophies of Vagrancy", "/api/icon/v"), SHAFT: ("Precision Drive Shaft", None)}
    result = {n.material: n for n in needs.needs(amounts, {}, {VAGRANCY_KEY: 5}, sources, names)}
    assert (result[VAGRANCY_KEY].held, result[VAGRANCY_KEY].exact) == (5, True)
    assert result[SHAFT].held is None   # nothing typed: unknown
    assert result[VAGRANCY_KEY].source == VAGRANCY and result[SHAFT].source.kind == "unknown"
    assert result[VAGRANCY_KEY].name == "Philosophies of Vagrancy" and result[VAGRANCY_KEY].icon == "/api/icon/v"


def test_the_calculators_held_amount_comes_before_what_was_typed():
    held = {VAGRANCY_KEY: (9, True), SHAFT: (12, False)}
    result = {n.material: n for n in needs.needs({VAGRANCY_KEY: 16, SHAFT: 12}, held, {VAGRANCY_KEY: 1}, {}, {})}
    assert (result[VAGRANCY_KEY].held, result[VAGRANCY_KEY].exact) == (9, True)
    assert (result[SHAFT].held, result[SHAFT].exact) == (12, False)
    assert result[SHAFT].name == SHAFT


def test_a_cryo_goblet_with_a_crit_substat_is_about_1_in_181_runs():
    """1.065 x 0.2 x 0.05 x 0.52 a run, with an off-set piece as good as one from her set."""
    refs = refs_sample()
    p = odds.per_run("goblet", "dmg", False, True, refs)
    assert p == pytest.approx(1.065 * 0.2 * 0.05 * 0.52)
    assert round(1 / p) == 181


def test_her_sets_domain_is_1_in_361_and_the_strongbox_1_in_192():
    refs = refs_sample()
    assert round(1 / odds.per_run("goblet", "dmg", False, False, refs)) == 361
    assert round(1 / odds.per_strongbox("goblet", "dmg", False, refs)) == 192
    # a crit main stat has one crit substat fewer to roll
    assert odds.per_run("circlet", "cr", True, True, refs) == pytest.approx(1.065 * 0.2 * 0.10 * 0.32)


def test_half_a_chance_comes_on_day_14_and_nine_in_ten_on_day_46():
    """Two runs today and nine a day after: the runs made by the end of each day are 2, 11, 20 ..."""
    p = odds.per_run("goblet", "dmg", False, True, refs_sample())
    runs_by_day = [2 + 9 * day for day in range(50)]
    assert odds.day_reaching(p, runs_by_day, 0.5) == 14
    assert odds.day_reaching(p, runs_by_day, 0.9) == 46
    assert odds.day_reaching(p, runs_by_day[:20], 0.9) is None
    assert odds.chance(p, 0) == 0.0 and odds.chance(1.0, 1) == 1.0
    assert odds.chance(p, 125) == pytest.approx(1 - (1 - p) ** 125)
