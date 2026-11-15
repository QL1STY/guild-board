"""The planner model's simulator block: her panel, her pieces cut into roll tiers, her set and the roll tables the page works from."""
from __future__ import annotations

import dataclasses

import pytest

import characters_samples as samples
from characters_service_support import SUNDAY, build_record, calculator, keep_builds, keep_notes, make_service
from characters_shape import problem_with
from guildboard.characters.models import Sub
from guildboard.characters.rolls import ROLLS


def planner_for(store, clock, tmp_path, build) -> dict:
    keep_builds(store, clock.now(), [build_record(build)], calculator())
    keep_notes(store, clock.now())
    return make_service(store, clock, tmp_path).planner("sandrone")


@pytest.fixture
def clock():
    from support import FakeClock

    return FakeClock(SUNDAY)


@pytest.fixture
def planner_of_sandrone(store, clock, tmp_path):
    return planner_for(store, clock, tmp_path, samples.sandrone_build())


@pytest.fixture
def planner_with_odd_piece(store, clock, tmp_path):
    build = samples.sandrone_build()
    flower = build.pieces["flower"]
    odd = dataclasses.replace(flower, subs=(Sub("cr", 3.0, 1), *flower.subs[1:]))   # no one roll of Crit Rate shows 3.0
    return planner_for(store, clock, tmp_path, dataclasses.replace(build, pieces={**build.pieces, "flower": odd}))


def test_the_sim_block_holds_her_panel_and_pieces(planner_of_sandrone):
    sim = planner_of_sandrone["sim"]
    assert sim["panel"]["atk"] == 2964.1 and sim["base"]["atk"] == 1016.0
    assert sim["char_base_atk"] == 1016.0 - 674
    flower = next(p for p in sim["pieces"] if p["slot"] == "flower")
    cd = next(s for s in flower["subs"] if s["stat"] == "cd")
    assert cd["value"] == 21.8 and len(cd["tiers"]) == 3        # times 2 -> 3 rolls
    assert flower["crit_value"] == 42.8 and flower["cv_tier"] == 3


def test_a_plus_16_piece_has_its_own_budget_and_main_value(planner_of_sandrone):
    plume = next(p for p in planner_of_sandrone["sim"]["pieces"] if p["slot"] == "plume")
    assert plume["level"] == 16 and plume["main_value"] == 258


def test_her_set_and_the_total(planner_of_sandrone):
    sim = planner_of_sandrone["sim"]
    assert [s["key"] for s in sim["sets"]] == ["disenchantment-in-deep-shadow"]
    assert sim["sets"][0]["pieces"] == 5
    assert sim["sets"][0]["two"] == [{"stat": "atk_pct", "value": 18}]
    assert sim["cv_total"] == 130.6 and sim["cv_set_tier"] == 0


def test_a_value_no_roll_can_make_keeps_its_value_without_tiers(planner_with_odd_piece):
    sub = planner_with_odd_piece["sim"]["pieces"][0]["subs"][0]
    assert sub["value"] == 3.0 and sub["tiers"] == []


def test_her_weapon_and_the_tables(planner_of_sandrone):
    sim = planner_of_sandrone["sim"]
    weapon = sim["weapon"]
    assert (weapon["key"], weapon["type"], weapon["rarity"], weapon["level"], weapon["refinement"]) == (
        "a-teaspoon-of-transcendence", "Claymore", 5, 90, 1)
    assert (weapon["base_atk"], weapon["sub"], weapon["sub_value"]) == (674.0, "cd", 44.1)
    tables = sim["tables"]
    assert tables["rolls"]["5"]["cr"] == list(ROLLS[5]["cr"]) and tables["rolls"]["4"]["hp"] == list(ROLLS[4]["hp"])
    assert tables["mains"]["5"]["atk"][16] == 258 and len(tables["mains"]["4"]["atk"]) == 17
    assert tables["weights"] == {
        "hp": 6, "atk": 6, "def": 6, "hp_pct": 4, "atk_pct": 4, "def_pct": 4, "em": 4, "er": 4, "cr": 3, "cd": 3,
    }
    assert tables["start4_odds"] == 0.2


def test_the_profile_pieces_carry_their_tier(store, clock, tmp_path):
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    keep_notes(store, clock.now())
    pieces = make_service(store, clock, tmp_path).profile("sandrone")["pieces"]
    flower = next(p for p in pieces if p["slot"] == "flower")
    circlet = next(p for p in pieces if p["slot"] == "circlet")
    assert flower["crit_value"] == 42.8 and flower["cv_tier"] == 3
    assert circlet["crit_value"] == 19.4 and circlet["cv_tier"] == 2   # a Crit Rate main stat is graded with +7.77, as 27.2


def test_a_character_not_owned_has_no_sim(store, clock, tmp_path):
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    keep_notes(store, clock.now())
    assert make_service(store, clock, tmp_path).planner("escoffier")["sim"] is None


def test_the_model_keeps_its_shape(planner_of_sandrone):
    assert problem_with(planner_of_sandrone, "Planner") is None


def test_physical_damage_has_one_key_everywhere_in_the_sim_block(store, clock, tmp_path):
    from guildboard.characters.models import Effect, SetRef

    build = samples.sandrone_build()
    goblet = dataclasses.replace(build.pieces["goblet"], main="phys", main_value=58.3)
    weapon = dataclasses.replace(build.weapon, sub="phys", sub_value=25.0)
    build = dataclasses.replace(
        build, pieces={**build.pieces, "goblet": goblet}, weapon=weapon, add={**build.add, "phys": 58.3 + 25.0},
    )
    refs = samples.refs_sample()
    shadow = refs.sets[samples.SHADOW]
    pale = SetRef(shadow.key, shadow.name, (Effect("phys", (25.0,), "always", ""),), shadow.four, shadow.icons)
    keep_builds(store, clock.now(), [build_record(build)], calculator())
    keep_notes(store, clock.now())
    sim = make_service(store, clock, tmp_path, refs=dataclasses.replace(refs, sets={**refs.sets, samples.SHADOW: pale})).planner(
        "sandrone")["sim"]
    assert next(p for p in sim["pieces"] if p["slot"] == "goblet")["main"] == "physical"
    assert sim["weapon"]["sub"] == "physical"
    assert sim["sets"][0]["two"] == [{"stat": "physical", "value": 25.0}]
    assert sim["panel"]["physical"] == 83.3 and "phys" not in sim["panel"]
    assert "physical" in sim["tables"]["mains"]["5"]
