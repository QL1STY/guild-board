"""Task E2: readiness, the artifact X-ray and what to do next, on Sandrone's example build (planner.html and profile.html)."""
from __future__ import annotations

import dataclasses

import pytest

from characters_samples import SHADOW, refs_sample, sandrone_build, sandrone_card
from guildboard.characters import damage, nextsteps, readiness, stats, xray
from guildboard.characters.models import Effect, Plan, Readiness, SetChoice
from test_characters_stats import default_plan


def now_score(build=None, card=None, **extra) -> Readiness:
    build, card, refs = build or sandrone_build(), card or sandrone_card(), refs_sample()
    return readiness.score(build, card, refs, stats.combat_now(build, card, refs), **extra)


def test_her_readiness_is_89_now_and_99_with_the_plan():
    """Design 7.3. Parts now: level 90/90 = 1.0; talents 0.5 x 0.9 + 0.3 + 0.2 = 0.95; weapon 1.0 (the card's first weapon,
    level 90). Artifacts now: 0.6 x fit + 0.25 x 2/3 + 0.15 x 1 = 0.7607, where fit = 13523.6 / 18272.8 = 0.7401 (the
    estimate at her goals is 2600 x 1.466 x (1 + 0.91 x 2.0) x 1.7). Total now: 0.15 + 0.2375 + 0.2 + 0.4 x 0.7607 =
    0.8918, so 89. With the plan: fit 18218.6 / 19347.7 = 0.9416, artifacts 0.6 x 0.9416 + 0.25 + 0.15 = 0.965, talents
    1.0, total 0.15 + 0.25 + 0.2 + 0.386 = 0.986, so 99."""
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    now = now_score()
    assert now.total == 89
    assert now.parts["level"] == pytest.approx(1.0)
    assert now.parts["talents"] == pytest.approx(0.95)
    assert now.parts["weapon"] == pytest.approx(1.0)
    assert now.parts["artifacts"] == pytest.approx(0.7607, abs=0.001)
    plan = default_plan()
    after = stats.apply_plan(build, plan, card, refs)
    planned = readiness.score(after, card, refs, stats.combat(build, plan, card, refs), weapon_level=plan.weapon_level)
    assert planned.total == 99
    assert planned.parts["talents"] == pytest.approx(1.0)
    assert planned.parts["artifacts"] == pytest.approx(0.965, abs=0.001)


def test_a_supports_fit_is_goal_attainment():
    """Jahoda-like goals: the mean of min(1, stat / goal), with Crit Rate taken in combat: Energy Recharge 122.7 / 140 =
    0.8764, Crit Rate 95.4 / 75 capped at 1, HP 20152 / 25000 = 0.806, so fit 0.8941."""
    card = dataclasses.replace(
        sandrone_card(), roles=("healer",), keeps_alive=True, scaling="hp", goals={"er": 140.0, "cr": 75.0, "hp": 25000.0},
    )
    expected_fit = (122.7 / 140 + 1.0 + 20152.374 / 25000) / 3
    result = now_score(card=card)
    assert result.parts["artifacts"] == pytest.approx(0.6 * expected_fit + 0.25 * (2 / 3) + 0.15, abs=0.001)


def test_goals_that_are_what_she_has_fit_fully_and_an_effect_that_holds_when_met_counts_once():
    """No goal for Crit Rate: the estimate at the goals keeps her 79.4 and adds Deep Shadow's 16 once, as her own does."""
    build = sandrone_build()
    panel = stats.panel(build)
    card = dataclasses.replace(sandrone_card(), goals={"atk": panel["atk"], "cd": panel["cd"], "dmg": panel["dmg"]})
    assert now_score(card=card).parts["artifacts"] == pytest.approx(0.6 + 0.25 * (2 / 3) + 0.15)


def test_a_conditional_hp_percent_counts_on_her_base_hp_at_the_goals_too():
    refs = refs_sample()
    refs = dataclasses.replace(refs, weapons={**refs.weapons, "hp-blade": dataclasses.replace(
        refs.weapons["verdict"], key="hp-blade", effects=(Effect("hp_pct", (20.0,) * 5, "met", "in a fight"),),
    )})
    build = sandrone_build()
    build = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="hp-blade"))
    panel = stats.panel(build)
    card = dataclasses.replace(sandrone_card(), scaling="hp", goals={"hp": panel["hp"] + 1000, "cd": panel["cd"], "dmg": 0.0})
    combat = stats.combat_now(build, card, refs)
    bonus = 13226.0 * 0.2
    assert combat["hp"] == pytest.approx(panel["hp"] + bonus)
    fit = (panel["hp"] + bonus) / (panel["hp"] + 1000 + bonus)
    assert readiness.score(build, card, refs, combat).parts["artifacts"] == pytest.approx(0.6 * fit + 0.25 * (2 / 3) + 0.15)


def test_a_character_not_owned_scores_0():
    card, refs = sandrone_card(), refs_sample()
    result = readiness.score(None, card, refs, {})
    assert result.total == 0
    assert set(result.parts) == {"level", "talents", "weapon", "artifacts"} and not any(result.parts.values())


def test_the_weapon_counts_by_tier_and_level():
    """The card's first weapon 1.0, the second 0.9, the third 0.85; another 5-star of her type 0.75; scaled by level / 90."""
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    assert now_score(weapon_level=45).parts["weapon"] == pytest.approx(0.5)
    second = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="verdict"))
    assert now_score(build=second).parts["weapon"] == pytest.approx(0.9)
    third = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="a-thousand-blazing-suns"))
    assert now_score(build=third).parts["weapon"] == pytest.approx(0.85)
    other = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="gest-of-the-mighty-wolf"))
    assert now_score(build=other).parts["weapon"] == pytest.approx(0.75)
    four = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="the-bell", rarity=4))
    assert now_score(build=four).parts["weapon"] == pytest.approx(0.65)
    assert readiness.score(dataclasses.replace(build, weapon=None), card, refs, {"atk": 1.0}).parts["weapon"] == 0.0


def test_the_set_part_is_1_for_a_complete_set_half_for_half_and_0_otherwise():
    """Checked on the part itself: moving pieces to another set also moves the set's effects, and so the fit."""
    build, card = sandrone_build(), sandrone_card()
    assert readiness._set_part(build, card) == 1.0
    half = {slot: dataclasses.replace(piece, set_key="scarlet-proof" if slot in ("sands", "goblet", "circlet") else piece.set_key)
            for slot, piece in build.pieces.items()}
    assert readiness._set_part(dataclasses.replace(build, pieces=half), card) == 0.5
    none = {slot: dataclasses.replace(piece, set_key=f"x{slot}") for slot, piece in build.pieces.items()}
    assert readiness._set_part(dataclasses.replace(build, pieces=none), card) == 0.0
    two_and_two = dataclasses.replace(card, sets=(SetChoice(sets=(SHADOW, "scarlet-proof"), pieces="2+2"),))
    assert readiness._set_part(dataclasses.replace(build, pieces=half), two_and_two) == 1.0
    assert readiness._set_part(build, dataclasses.replace(card, sets=())) == 1.0


def test_the_xray_counts_rolls_as_times_plus_one_and_classes_them():
    """Wanted rolls of all rolls: the Flower 9 of 9, the Plume 6 of 8, the Sands 6 of 8, the Goblet 0 of 8, the Circlet 7 of
    8; crit value 2 x Crit Rate + Crit DMG from substats: 42.8, 27.2, 41.2, 0 and 19.4."""
    found = {v.slot: v for v in xray.verdicts(sandrone_build(), sandrone_card())}
    assert [(found[s].rolls_wanted, found[s].rolls_all) for s in found] == [(9, 9), (6, 8), (6, 8), (0, 8), (7, 8)]
    assert [round(found[s].crit_value, 1) for s in found] == [42.8, 27.2, 41.2, 0.0, 19.4]
    assert list(found) == ["flower", "plume", "sands", "goblet", "circlet"]


def test_the_verdicts_follow_the_rules_with_their_reasons():
    found = {v.slot: v for v in xray.verdicts(sandrone_build(), sandrone_card())}
    assert (found["flower"].verdict, found["flower"].why) == ("keep", "9 of 9 rolls in stats she wants.")
    assert (found["plume"].verdict, found["plume"].why) == ("level", "At +16, with 3 substats she wants.")
    assert found["sands"].verdict == "keep"
    assert (found["goblet"].verdict, found["goblet"].why) == (
        "replace", "Its main stat is ATK %; her card asks for Cryo DMG Bonus.",
    )
    assert found["circlet"].verdict == "keep"


def test_a_piece_at_20_with_fewer_than_2_wanted_rolls_is_replaced_and_they_take_their_pronoun():
    build = sandrone_build()
    pieces = dict(build.pieces)
    flower = pieces["flower"]
    pieces["flower"] = dataclasses.replace(
        flower, subs=tuple(dataclasses.replace(s, stat=stat) for s, stat in zip(flower.subs, ("def", "hp", "def_pct", "cr"))),
    )
    card = dataclasses.replace(sandrone_card(), pronouns=("they", "them", "their"))
    found = {v.slot: v for v in xray.verdicts(dataclasses.replace(build, pieces=pieces), card)}
    assert found["flower"].verdict == "replace"
    assert found["flower"].why == "At +20, only 1 of 9 rolls are in stats they want."
    assert {v.slot: v for v in xray.verdicts(build, card)}["goblet"].why == "Its main stat is ATK %; their card asks for Cryo DMG Bonus."


def test_a_card_that_lists_several_mains_names_them_all():
    build = sandrone_build()
    card = dataclasses.replace(sandrone_card(), mains={"sands": ("er", "em"), "goblet": ("dmg",), "circlet": ("cr", "cd", "heal")})
    found = {v.slot: v for v in xray.verdicts(build, card)}
    assert found["sands"].why == "Its main stat is ATK %; her card asks for Energy Recharge or Elemental Mastery."


def test_the_roll_chart_counts_41_rolls():
    chart = xray.roll_chart(sandrone_build(), sandrone_card())
    assert {stat: rolls for stat, rolls, _, _ in chart} == {
        "cd": 12, "cr": 7, "atk_pct": 5, "er": 4, "em": 3, "atk": 2, "hp": 3, "hp_pct": 2, "def": 3,
    }
    assert sum(rolls for _, rolls, _, _ in chart) == 41
    weights = {stat: weight for stat, _, weight, _ in chart}
    assert weights["cd"] == "wants" and weights["em"] == "some" and weights["hp"] == "none"
    assert [w for _, _, w, _ in chart] == sorted((w for _, _, w, _ in chart), key=("wants", "some", "none").index)
    assert {stat: where for stat, _, _, where in chart}["cd"] == "Flower 3, Plume 2, Sands 4, Circlet 3"


def test_the_next_steps_put_the_goblet_first():
    """The goblet is replaced with an average good piece: Cryo DMG Bonus at +20 and 2 rolls each of Crit Rate and Crit DMG."""
    steps = nextsteps.rank(sandrone_build(), sandrone_card(), refs_sample())
    assert [(s.text, s.gain) for s in steps] == [
        ("Replace the Goblet with a Cryo DMG Bonus goblet that has Crit Rate or Crit DMG.", "about +31% damage"),
        ("Raise her Normal Attack to 10.", "about +6% damage"),
        ("Level the Plume from +16 to +20.", "about +3% damage"),
    ]
    assert steps[0].value > steps[1].value > steps[2].value > 0


def test_the_next_steps_for_a_support_are_ranked_by_readiness():
    card = dataclasses.replace(sandrone_card(), roles=("support",), scaling="atk", goals={"er": 160.0, "cr": 75.0, "atk": 2600.0})
    steps = nextsteps.rank(sandrone_build(), card, refs_sample(), n=5)
    assert steps and all(s.gain.startswith("about +") and s.gain.endswith(" readiness") for s in steps)
    assert [s.value for s in steps] == sorted((s.value for s in steps), reverse=True)


def test_a_weapon_that_does_less_is_not_offered_and_a_better_one_is_offered_if_you_have_it():
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    texts = [s.text for s in nextsteps.rank(build, card, refs, n=10)]
    assert not any("A Thousand Blazing Suns" in t for t in texts)  # about 0% in the mockup's model
    weaker = dataclasses.replace(build, weapon=dataclasses.replace(
        build.weapon, key="gest-of-the-mighty-wolf", name="Gest of the Mighty Wolf", base_atk=608.0, sub="cr", sub_value=33.1,
    ))
    again = [s.text for s in nextsteps.rank(weaker, card, refs, n=10)]
    assert any(t.startswith("If you have A Teaspoon of Transcendence") for t in again)


def test_leveling_her_and_her_weapon_fill_the_list_when_nothing_else_gains_damage():
    build, card, refs = sandrone_build(), sandrone_card(), refs_sample()
    low = dataclasses.replace(
        build, level=70, talents={"normal": 10, "skill": 10, "burst": 10},
        weapon=dataclasses.replace(build.weapon, level=70), pieces={
            slot: dataclasses.replace(piece, level=20, main_value=refs.mains_20.get(piece.main, piece.main_value))
            for slot, piece in build.pieces.items()
        },
    )
    steps = nextsteps.rank(low, dataclasses.replace(card, mains={}), refs, n=5)
    texts = [s.text for s in steps]
    assert "Raise her to level 90." in texts
    assert any("A Teaspoon of Transcendence to level 90" in t for t in texts)
    assert all(s.gain.endswith("readiness") for s in steps if "level 90" in s.text)


def _stronger_on_paper(refs, *keys):
    """The damage estimate rates these weapons far above the one she holds (as it does for a passive it does not count)."""
    return dataclasses.replace(refs, weapons={**refs.weapons, **{
        key: dataclasses.replace(refs.weapons[key], base_atk_90=2000.0) for key in keys
    }})


def _weapon_texts(build, card, refs):
    return [s.text for s in nextsteps.rank(build, card, refs, n=20) if s.text.startswith("If you have")]


def test_holding_the_cards_first_weapon_never_suggests_another():
    build, card = sandrone_build(), sandrone_card()
    assert card.weapons[0] == build.weapon.key
    refs = _stronger_on_paper(refs_sample(), "verdict", "a-thousand-blazing-suns")
    assert _weapon_texts(build, card, refs) == []


def test_a_weapon_change_is_only_for_weapons_the_card_ranks_above_the_one_held_and_in_the_cards_order():
    build, card = sandrone_build(), sandrone_card()
    refs = _stronger_on_paper(refs_sample(), "verdict", "a-thousand-blazing-suns", "a-teaspoon-of-transcendence")
    second = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="verdict", name="Verdict"))
    assert [t.split(":")[0] for t in _weapon_texts(second, card, refs)] == ["If you have A Teaspoon of Transcendence"]
    third = dataclasses.replace(build, weapon=dataclasses.replace(
        build.weapon, key="a-thousand-blazing-suns", name="A Thousand Blazing Suns"))
    assert [t.split(":")[0] for t in _weapon_texts(third, card, refs)] == [
        "If you have A Teaspoon of Transcendence", "If you have Verdict"]
    other = dataclasses.replace(build, weapon=dataclasses.replace(build.weapon, key="gest-of-the-mighty-wolf", name="Gest"))
    assert [t.split(":")[0] for t in _weapon_texts(other, card, refs)] == [
        "If you have A Teaspoon of Transcendence", "If you have Verdict", "If you have A Thousand Blazing Suns"]
