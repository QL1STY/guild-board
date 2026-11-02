"""Task E1: the panel, where each stat comes from, the plan's panel, the stats in combat and the damage estimate, on Sandrone's
example build. The numbers are planner.html's (the plan's "The test samples")."""
from __future__ import annotations

import dataclasses

import pytest

from characters_samples import (
    SANDRONE_PANEL, SHADOW, TEASPOON, refs_sample, sandrone_build, sandrone_card, sandrone_own,
)
from guildboard.characters import damage, stats
from guildboard.characters.models import Effect, Plan, SetChoice, TypedPiece

SUNS = "a-thousand-blazing-suns"
BLIZZARD = "blizzard-strayer"


def default_plan() -> Plan:
    """The default plan: the goblet's main stat to Cryo DMG Bonus, the Plume to +20, and Normal Attack 10."""
    return Plan(
        level=90, talents={"normal": 10, "skill": 10, "burst": 10}, weapon=TEASPOON, weapon_level=90, refinement=1,
        set=SetChoice(sets=(SHADOW,), pieces="4"), mains={"sands": "atk_pct", "goblet": "dmg", "circlet": "cr"},
        level_pieces=("plume",), typed=None,
    )


def typed_goblet(use: bool = True) -> TypedPiece:
    """planner.html's `tp`: a Cryo DMG Bonus goblet with Crit Rate 7, Crit DMG 14, ATK 5.8% and Energy Recharge 5.2%."""
    return TypedPiece(slot="goblet", main="dmg", subs=(("cr", 7.0), ("cd", 14.0), ("atk_pct", 5.8), ("er", 5.2)), use=use)


def damage_now(talent: int = 9) -> float:
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    return damage.estimate(stats.combat_now(build, card, refs), card, talent, refs)


def damage_with(plan: Plan, talent: int = 10) -> float:
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    return damage.estimate(stats.combat(build, plan, card, refs), card, talent, refs)


def test_the_panel_is_base_plus_added():
    panel = stats.panel(sandrone_build())
    for key, value in SANDRONE_PANEL.items():
        assert panel[key] == pytest.approx(value, abs=0.1), key


def test_each_stat_splits_into_her_own_weapon_and_artifacts():
    """ATK's weapon share is 674 + 28% of her base ATK 1016 (the Teaspoon's passive); the artifacts' is the rest."""
    split = stats.split(sandrone_build(), refs_sample(), sandrone_own())
    assert split["atk"] == pytest.approx((342.0, 958.5, 1663.6), abs=0.1)
    assert split["cr"] == pytest.approx((24.2, 0.0, 55.2), abs=0.1)
    assert split["cd"] == pytest.approx((50.0, 44.1, 82.4), abs=0.1)
    assert split["hp"] == pytest.approx((13226.0, 0.0, 6926.4), abs=0.1)
    assert "base_hp" not in split


def test_the_default_plan_gives_her_planned_stats():
    """Goblet to Cryo DMG Bonus takes the 46.6% ATK and its flat 33 away; the Plume at +20 is 311 ATK and each of its four
    substats gains its average roll over 4: Crit DMG 6.6 / 4 = 1.65, Crit Rate 0.825, Energy Recharge 1.375, HP 63.5."""
    planned = stats.planned(sandrone_build(), default_plan(), sandrone_card(), refs_sample())
    assert planned["atk"] == pytest.approx(2543.6, abs=0.1)
    assert planned["cr"] == pytest.approx(80.2, abs=0.1)
    assert planned["cd"] == pytest.approx(178.2, abs=0.1)
    assert planned["er"] == pytest.approx(124.1, abs=0.1)
    assert planned["hp"] == pytest.approx(20215.9, abs=0.1)
    assert planned["dmg"] == pytest.approx(46.6, abs=0.1)


def test_a_plan_that_changes_nothing_leaves_the_panel_as_it_is():
    build = sandrone_build()
    now = stats.planned(build, stats.now_plan(build), sandrone_card(), refs_sample())
    for key, value in SANDRONE_PANEL.items():
        assert now[key] == pytest.approx(value, abs=0.1), key


def test_in_combat_adds_the_effects_that_hold_when_met():
    """Disenchantment in Deep Shadow's 4-piece is +16% Crit Rate against Superconduct: 79.4 now becomes 95.4, and the
    plan's 80.2 becomes 96.2."""
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    choice = SetChoice(sets=(SHADOW,), pieces="4")
    now = stats.in_combat(stats.panel(build), TEASPOON, 1, choice, 1016.0, refs)
    assert now["cr"] == pytest.approx(95.4, abs=0.1)
    plan = stats.in_combat(stats.planned(build, default_plan(), card, refs), TEASPOON, 1, choice, 1016.0, refs)
    assert plan["cr"] == pytest.approx(96.2, abs=0.1)
    assert stats.panel(build)["cr"] == pytest.approx(79.4, abs=0.1)  # the panel itself is not changed


def test_a_weapons_and_sets_conditional_effects_all_apply_with_no_grouping():
    """Two weapon effects that each hold when met are both counted, and an ATK % counts on the base ATK."""
    refs = refs_sample()
    suns = refs.weapons[SUNS]
    combat = stats.in_combat({"atk": 2000.0, "cr": 50.0, "cd": 100.0}, SUNS, 1, None, 1000.0, refs)
    assert combat["cd"] == pytest.approx(120.0)
    assert combat["atk"] == pytest.approx(2000.0 + 1000.0 * 0.28)
    assert len(suns.effects) == 2


def test_physical_dmg_bonus_stays_a_key_of_its_own_and_counts_only_for_a_physical_card():
    refs = refs_sample()
    refs = dataclasses.replace(refs, weapons={**refs.weapons, "phys-sword": dataclasses.replace(
        refs.weapons["verdict"], key="phys-sword", effects=(Effect("phys", (20.0, 25.0, 30.0, 35.0, 40.0), "met", "after a hit"),),
    )})
    combat = stats.in_combat({"atk": 1000.0, "cr": 0.0, "cd": 100.0, "dmg": 10.0}, "phys-sword", 1, None, 500.0, refs)
    assert combat["phys"] == 20.0 and combat["dmg"] == 10.0
    elemental = sandrone_card()
    physical = dataclasses.replace(elemental, talent_table="physical")
    assert damage.estimate(combat, elemental, 10, refs) == pytest.approx(1000 * 1.10 * 1.8)
    assert damage.estimate(combat, physical, 10, refs) == pytest.approx(1000 * 1.30 * 1.8)


def test_a_conditional_hp_percent_counts_on_her_base_hp():
    refs = refs_sample()
    refs = dataclasses.replace(refs, weapons={**refs.weapons, "hp-blade": dataclasses.replace(
        refs.weapons["verdict"], key="hp-blade", effects=(Effect("hp_pct", (20.0,) * 5, "met", "in a fight"),),
    )})
    panel = stats.panel(sandrone_build())
    combat = stats.in_combat(panel, "hp-blade", 1, None, 1016.0, refs)
    assert combat["hp"] == pytest.approx(panel["hp"] + 13226.0 * 0.2)


def test_the_default_plan_is_35_percent_more_damage():
    """Now 13523.6, the plan 18218.6 (18218.5 from the sample's own digits; the plan's last digit is rounded): T is 1.70 at
    Normal Attack 9 and 1.80 at 10."""
    now, plan = damage_now(), damage_with(default_plan())
    assert now == pytest.approx(13523.6, abs=0.1)
    assert plan == pytest.approx(18218.6, abs=0.2)
    assert damage.change(now, plan) == 35


def test_the_typed_goblet_makes_46_percent_and_wastes_crit_rate():
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    typed = dataclasses.replace(default_plan(), typed=typed_goblet())
    assert stats.combat(build, typed, card, refs)["cr"] == pytest.approx(103.2, abs=0.1)
    assert damage.change(damage_now(), damage_with(typed)) == 46
    assert damage.change(damage_with(default_plan()), damage_with(typed)) == 9


def test_a_typed_piece_that_is_not_in_use_changes_nothing():
    unused = dataclasses.replace(default_plan(), typed=typed_goblet(use=False))
    assert damage_with(unused) == pytest.approx(damage_with(default_plan()))


def test_weapon_set_and_refinement_choices_change_the_estimate_as_the_planner_mockup_does():
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    plan = default_plan()
    assert damage.change(damage_now(), damage_with(dataclasses.replace(plan, refinement=2))) == 38
    suns = dataclasses.replace(plan, weapon=SUNS)
    assert damage.change(damage_now(), damage_with(suns)) == 33
    assert stats.combat(build, suns, card, refs)["cr"] == pytest.approx(107.2, abs=0.1)
    blizzard = dataclasses.replace(plan, set=SetChoice(sets=(BLIZZARD,), pieces="4"))
    assert damage.change(damage_now(), damage_with(blizzard)) == 41


def test_a_two_and_two_choice_counts_both_two_piece_effects():
    """Deep Shadow's ATK +18% and Blizzard Strayer's Cryo DMG +15%, and no 4-piece effect (the mockup's 'mix')."""
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    mix = dataclasses.replace(default_plan(), set=SetChoice(sets=(SHADOW, BLIZZARD), pieces="2+2"))
    combat = stats.combat(build, mix, card, refs)
    assert combat["dmg"] == pytest.approx(46.6 + 15.0, abs=0.1)
    assert damage.change(damage_now(), damage_with(mix)) == 33


def test_crit_rate_above_100_counts_as_100():
    card, refs = sandrone_card(), refs_sample()
    capped = {"atk": 1000.0, "cr": 100.0, "cd": 100.0, "dmg": 0.0}
    over = {**capped, "cr": 150.0}
    assert damage.estimate(over, card, 10, refs) == pytest.approx(damage.estimate(capped, card, 10, refs))
    assert damage.estimate(capped, card, 10, refs) == pytest.approx(1000 * 2.0 * 1.8)


def test_the_estimate_follows_the_cards_scaling_stat_and_talent_table():
    card, refs = sandrone_card(), refs_sample()
    hp_card = dataclasses.replace(card, scaling="hp")
    combat = {"atk": 1000.0, "hp": 30000.0, "cr": 0.0, "cd": 100.0, "dmg": 0.0}
    assert damage.estimate(combat, hp_card, 1, refs) == pytest.approx(30000 * refs.scaling["elemental"][0])


def test_change_is_the_plans_gain_in_whole_percent():
    assert damage.change(100.0, 134.5) == 35
    assert damage.change(100.0, 100.4) == 0
    assert damage.change(100.0, 90.0) == -10


def test_the_property_ids_map_to_stat_keys():
    assert stats.PROP_KEYS[2000] == "hp" and stats.PROP_KEYS[2001] == "atk" and stats.PROP_KEYS[2002] == "def"
    assert stats.PROP_KEYS[20] == "cr" and stats.PROP_KEYS[22] == "cd" and stats.PROP_KEYS[23] == "er"
    assert stats.PROP_KEYS[28] == "em" and stats.PROP_KEYS[30] == "phys" and stats.PROP_KEYS[46] == "dmg"
    # a Flower's HP, a Plume's ATK and the flat substats are the game's plain HP, ATK and DEF: 2, 5 and 8
    assert stats.PROP_KEYS[2] == "hp" and stats.PROP_KEYS[5] == "atk" and stats.PROP_KEYS[8] == "def"
    assert stats.label("dmg", "Cryo") == "Cryo DMG Bonus" and stats.label("atk_pct") == "ATK %"
