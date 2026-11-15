"""The planner model's hits block (the Plan design, sections 7.4, 12.1 to 12.3 and 14): her talents' damage rows at her boosted
level, each with the kind and scaling the kit data and the parsed text give, her main talents, the kit's effects and toggles, and
her weapon's, every pickable weapon's and every set's. All numbers are the game's own: rows of Sandrone, Lauma, Fischl and
Odette as Genshin Optimizer's datamine and its English text give them (tests/characters_talent_tables.json holds the tables the
wiki would show for Sandrone and Odette); the values marked synthetic are parser inputs, not claims about the game."""
from __future__ import annotations

import asyncio
import dataclasses
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import characters_samples as samples
from characters_service_support import SUNDAY, build_record, calculator, keep_builds, keep_notes, make_service
from characters_shape import problem_with
from guildboard import characters
from guildboard.api.app import create_app
from guildboard.characters import kits, simhits
from guildboard.characters.hits import reaction_kinds
from guildboard.characters.wiki import ENTRY_URL, CharacterWiki
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.records import SkillRecord
from support import AccountSource, FakeClock, FakeSleep

TABLES = json.loads((Path(__file__).with_name("characters_talent_tables.json")).read_text(encoding="utf-8"))

# Sandrone's rows at the levels of her example build, as the game prints them (HoYoLAB's skill_affix_list has the same text).
NORMAL_6 = (
    ("1-Hit DMG", "110.9%"), ("2-Hit DMG", "97.7%"), ("3-Hit DMG", "149.4%"), ("Charged Attack Sweeping Fire DMG", "62.5%"),
    ("Charged Attack Condensed Beam DMG", "178.1%"), ("Charged Attack Condensed Beam Stellar-Conduct DMG", "118.8%"),
    ("Charged Attack Condensed Beam Stellar Swirl DMG", "178.1%"), ("DMG When in Power Overdrive", "62.5%"),
    ("Plunge DMG", "108.4%"), ("Low/High Plunge DMG", "216.779%/270.769%"),
)
SKILL_13 = (
    ("Prism Shot DMG", "68.8%"), ("Prism Shot Stellar-Conduct DMG", "45.9%"), ("Prism Shot Stellar Swirl DMG", "68.8%"), ("CD", "4.0s"),
)
NORMAL_9 = (("1-Hit DMG", "140.2%"), ("2-Hit DMG", "123.5%"), ("3-Hit DMG", "188.9%"))
SKILL_10 = (
    ("Prism Shot DMG", "58.3%"), ("Prism Shot Stellar-Conduct DMG", "38.9%"), ("Prism Shot Stellar Swirl DMG", "58.3%"), ("CD", "4.0s"),
)
BURST_10 = (
    ("Bombardment DMG", "158.8% ×3"), ("Convective Inhibition Ray DMG", "595.4%"),
    ("Convective Inhibition Ray Stellar-Conduct DMG", "397.0%"), ("Convective Inhibition Ray Stellar Swirl DMG", "595.4%"),
    ("CD", "15.0s"), ("Energy Cost", "60"),
)
LAUMA_NORMAL = (("1-Hit DMG", "57.3%"), ("2-Hit DMG", "54.1%"), ("3-Hit DMG", "75.6%"))
LAUMA_SKILL = (
    ("Press DMG", "218.9%"), ("1-Hit Hold DMG", "284.5%"), ("2-Hit Hold DMG", "273.6% Elemental Mastery Per Verdant Dew"),
    ("Frostgrove Sanctuary Attack DMG", "172.8% ATK+345.6% Elemental Mastery"), ("CD", "12.0s"),
)
LAUMA_BURST = (("Pale Hymn Stacks Gained From Elemental Burst", "18"), ("Pale Hymn Duration", "15.0s"))
FISCHL_NORMAL = (("1-Hit DMG", "81.1%"), ("Aimed Shot", "80.6%"), ("Fully-Charged Aimed Shot", "210.8%"))
FISCHL_SKILL = (("Oz's ATK DMG", "159.8%"), ("Summoning DMG", "207.792%"), ("CD", "8.0s"))
FISCHL_BURST = (("Falling Thunder DMG", "374.4%"),)


@pytest.fixture
def clock():
    return FakeClock(SUNDAY)


def _skills(ident: int, build, normal, skill, burst) -> tuple[SkillRecord, ...]:
    return tuple(
        SkillRecord(ident * 100 + n, 1, kind, "", build.talents[kind] + build.bonus[kind], rows)
        for n, (kind, rows) in enumerate((("normal", normal), ("skill", skill), ("burst", burst)), 1)
    )


def planner_of(store, clock, tmp_path, *, key="sandrone", name="Sandrone", element="Cryo", weapon_type="Claymore", ident=1,
               talents=None, bonus=None, rows=(NORMAL_6, SKILL_10, BURST_10), wiki_entry=None, recommended=None):
    build = samples.sandrone_build()
    build = dataclasses.replace(build, key=key, talents=talents or {"normal": 6, "skill": 10, "burst": 10}, bonus=bonus or build.bonus)
    record = dataclasses.replace(
        build_record(build, ident=ident, name=name, element=element, wiki_entry=wiki_entry, weapon_type=weapon_type),
        skills=_skills(ident, build, *rows), recommended=recommended or {},
    )
    keep_builds(store, clock.now(), [record], calculator(character=ident))
    keep_notes(store, clock.now())
    return make_service(store, clock, tmp_path).planner(key)


def hits_of(planner):
    return planner["sim"]["hits"]


def talent(planner, key):
    return next(t for t in hits_of(planner)["talents"] if t["key"] == key)


def row(planner, key, name):
    return next(r for r in talent(planner, key)["rows"] if r["name"] == name)


@pytest.fixture
def planner_of_sandrone(store, clock, tmp_path):
    return planner_of(store, clock, tmp_path)


@pytest.fixture
def planner_of_lauma(store, clock, tmp_path):
    return planner_of(
        store, clock, tmp_path, key="lauma", name="Lauma", element="Dendro", weapon_type="Catalyst", ident=2,
        talents={"normal": 9, "skill": 10, "burst": 10}, rows=(LAUMA_NORMAL, LAUMA_SKILL, LAUMA_BURST),
    )


@pytest.fixture
def planner_of_fischl(store, clock, tmp_path):
    return planner_of(
        store, clock, tmp_path, key="fischl", name="Fischl", element="Electro", weapon_type="Bow", ident=3,
        talents={"normal": 9, "skill": 10, "burst": 10}, rows=(FISCHL_NORMAL, FISCHL_SKILL, FISCHL_BURST),
    )


async def _kept_with_tables(store, clock, tables: dict[str, list[dict]]) -> None:
    """The recorded Sandrone entry with these tables on her three leveled talents, kept as the wiki's reading keeps it."""

    def answer(url, *, headers=None, body=None):
        entry = json.loads(samples.wiki_entry_answer(url[len(ENTRY_URL):]))
        for module in entry["data"]["page"]["modules"]:
            for component in module["components"]:
                if component["component_id"] == "talent":
                    value = json.loads(component["data"])
                    for index, kind in enumerate(("normal", "skill", "burst")):
                        value["list"][index]["attributes"] = tables[kind]
                    component["data"] = json.dumps(value)
        return json.dumps(entry).encode("utf-8")

    await CharacterWiki(store, clock, answer, lambda: "7.1").entry("10920", "character")


def planner_with_tables(store, clock, tmp_path, rows, **kwargs):
    asyncio.run(_kept_with_tables(store, clock, TABLES["sandrone"]))
    return planner_of(store, clock, tmp_path, rows=rows, wiki_entry="10920", **kwargs)


# ------------------------------------------------------------------------------------------------ where the rows come from

def test_rows_come_from_hoyolab_at_her_boosted_level(planner_of_sandrone):
    skill = talent(planner_of_sandrone, "skill")
    assert skill["source"] == "hoyolab" and skill["level"] == 10
    assert any(r["kind"] == "stellar-conduct" for r in skill["rows"])
    shot = row(planner_of_sandrone, "skill", "Prism Shot DMG")
    assert shot["kind"] == "elemental" and shot["terms"] == [{"stat": "atk", "mult": 0.583}] and shot["flat"] == 0 and shot["count"] == 1
    assert row(planner_of_sandrone, "burst", "Bombardment DMG")["count"] == 3
    assert row(planner_of_sandrone, "burst", "Bombardment DMG")["terms"] == [{"stat": "atk", "mult": 1.588}]
    assert [r["name"] for r in skill["rows"]] == ["Prism Shot DMG", "Prism Shot Stellar-Conduct DMG", "Prism Shot Stellar Swirl DMG"]  # no CD


def test_the_kind_comes_from_the_kit(planner_of_lauma):
    assert row(planner_of_lauma, "skill", "2-Hit Hold DMG")["kind"] == "lunar-bloom"
    assert row(planner_of_lauma, "skill", "Press DMG")["kind"] == "elemental"
    assert row(planner_of_lauma, "normal", "1-Hit DMG")["kind"] == "elemental"        # a catalyst's


def test_the_stellar_kinds_come_with_their_element_and_the_move(planner_of_sandrone):
    swirl = row(planner_of_sandrone, "skill", "Prism Shot Stellar Swirl DMG")
    assert (swirl["kind"], swirl["element"]) == ("stellar-swirl", "Cryo")      # an Element, as the block's own
    assert row(planner_of_sandrone, "skill", "Prism Shot DMG")["element"] is None
    first = row(planner_of_sandrone, "normal", "1-Hit DMG")
    assert (first["move"], first["kind"]) == ("normal", "physical")
    assert row(planner_of_sandrone, "normal", "Charged Attack Condensed Beam DMG")["move"] == "charged"
    assert row(planner_of_sandrone, "normal", "Plunge DMG")["move"] == "plunging"
    assert row(planner_of_sandrone, "skill", "Prism Shot DMG")["move"] == "skill"


def test_a_row_that_scales_on_two_stats_and_a_value_per_unit(planner_of_lauma):
    both = row(planner_of_lauma, "skill", "Frostgrove Sanctuary Attack DMG")
    assert both["terms"] == [{"stat": "atk", "mult": 1.728}, {"stat": "em", "mult": 3.456}]
    per_dew = row(planner_of_lauma, "skill", "2-Hit Hold DMG")
    assert per_dew["terms"] == [{"stat": "em", "mult": 2.736}] and per_dew["count"] == 1        # one Verdant Dew's


def test_the_wiki_table_fills_in_when_hoyolab_has_no_rows(store, clock, tmp_path):
    planner = planner_with_tables(store, clock, tmp_path, rows=((), (), ()), talents={"normal": 9, "skill": 10, "burst": 10})
    hits = hits_of(planner)["talents"]
    assert hits[0]["source"] == "wiki" and [t["source"] for t in hits] == ["wiki"] * 3
    assert row(planner, "normal", "1-Hit DMG")["terms"] == [{"stat": "atk", "mult": 1.402}]     # the table's Lv.9 column
    assert row(planner, "skill", "Prism Shot Stellar-Conduct DMG")["kind"] == "stellar-conduct"
    assert row(planner, "burst", "Bombardment DMG")["count"] == 3 and row(planner, "burst", "Bombardment DMG")["terms"][0]["mult"] == 1.588


def test_hoyolab_goes_first_and_the_wiki_serves_the_talent_it_has_no_rows_for(store, clock, tmp_path):
    planner = planner_with_tables(store, clock, tmp_path, rows=(NORMAL_6, (), BURST_10))
    assert [t["source"] for t in hits_of(planner)["talents"]] == ["hoyolab", "wiki", "hoyolab"]


def test_a_level_past_the_table_is_not_guessed(store, clock, tmp_path):
    planner = planner_with_tables(
        store, clock, tmp_path, rows=((), (), ()), talents={"normal": 9, "skill": 10, "burst": 10},
        bonus={"normal": 0, "skill": 0, "burst": 4},
    )
    burst = talent(planner, "burst")
    assert burst["level"] == 14 and burst["source"] is None and burst["rows"] == []      # the table's last level is 13
    assert talent(planner, "skill")["source"] == "wiki"


def test_a_character_without_tables_has_no_hits(store, clock, tmp_path):
    planner = planner_of(store, clock, tmp_path, rows=((), (), ()))
    assert all(t["rows"] == [] and t["source"] is None for t in hits_of(planner)["talents"])
    assert not any(t["main"] for t in hits_of(planner)["talents"])


# ------------------------------------------------------------------------------------------------ the tables and the rows, pure

def test_a_table_is_read_at_her_level_whichever_way_the_wiki_names_its_header():
    odette = TABLES["odette_burst"]
    assert odette[0]["key"] == "Leve"                                                    # Odette's burst table, as the wiki has it
    assert simhits.table_pairs(odette, 10)[0] == ("Slash DMG", "198.3% ×3")
    assert simhits.table_pairs(odette, 14) is None and simhits.table_pairs(odette, 0) is None


def test_a_row_named_level_is_not_the_header():
    # Freminet's Skill rows at Lv.1 and Lv.2 as the game prints them, and her table's header.
    table = [{"key": "Level", "values": ["Lv.1", "Lv.2"]},
             {"key": "Level 1 Shattering Pressure DMG", "values": ["100.2% Cryo + 48.7% Physical", "107.8% Cryo + 52.3% Physical"]}]
    assert simhits.table_pairs(table, 2) == [("Level 1 Shattering Pressure DMG", "107.8% Cryo + 52.3% Physical")]
    assert simhits.table_pairs(table[1:], 1) is None   # no header: no column


def test_a_slash_row_pairs_each_alternative_with_the_kit_hits_for_it():
    kit = kits.kit_of("odette", 0, 6, "", 1, {})
    group = '"Plume" Dance Move Stellar-Conduct/Stellar Swirl DMG'      # the source row's name tags the rows split from it
    rows = simhits.rows_of(
        [('"Plume" Dance Move Stellar-Conduct/Stellar Swirl DMG', "48.643%/72.95%"), ('"Plume" Dance Move DMG', "77.5%")],
        "skill", kit, "Sword",
    )
    assert [(r["name"], r["kind"], r["element"], r["terms"][0]["mult"], r["alternative"]) for r in rows] == [
        ('"Plume" Dance Move Stellar-Conduct/Stellar Swirl DMG', "stellar-conduct", "Cryo", 0.48643, group),
        ('"Plume" Dance Move Stellar-Conduct/Stellar Swirl DMG (2 of 2)', "stellar-swirl", "Cryo", 0.7295, group),
        ('"Plume" Dance Move DMG', "elemental", None, 0.775, None),
    ]


def test_a_slash_row_of_three_hits_is_three_rows_of_one_group():
    kit = kits.kit_of("clorinde", 0, 6, "", 1, {})
    # Clorinde's real Skill rows at 10: Impale the Night prints three hits, the last landing three times.
    rows = simhits.rows_of(
        [("Swift Hunt DMG", "52.9%/76.7%"), ("Impale the Night DMG", "65.2%/86.9%/49.6%×3"), ("Surging Blade DMG", "77.8%")],
        "skill", kit, "Sword")
    assert [(r["name"], r["terms"][0]["mult"], r["count"], r["alternative"]) for r in rows] == [
        ("Swift Hunt DMG", 0.529, 1, "Swift Hunt DMG"), ("Swift Hunt DMG (2 of 2)", 0.767, 1, "Swift Hunt DMG"),
        ("Impale the Night DMG", 0.652, 1, "Impale the Night DMG"), ("Impale the Night DMG (2 of 3)", 0.869, 1, "Impale the Night DMG"),
        ("Impale the Night DMG (3 of 3)", 0.496, 3, "Impale the Night DMG"), ("Surging Blade DMG", 0.778, 1, None),
    ]
    assert {r["kind"] for r in rows} == {"elemental"}


def test_low_and_high_plunge_are_one_hit_so_the_first_is_taken():
    kit = kits.kit_of("sandrone", 0, 6, "", 1, {})
    rows = simhits.rows_of([("Low/High Plunge DMG", "216.779%/270.769%")], "normal", kit, "Claymore")
    assert [(r["name"], r["kind"], r["terms"][0]["mult"]) for r in rows] == [("Low/High Plunge DMG", "physical", 2.16779)]


def test_a_slash_row_the_kit_lacks_takes_its_first_alternative_by_name():
    kit = kits.kit_of("sandrone", 0, 6, "", 1, {})
    # Clorinde's real Swift Hunt row at Skill 10, given to Sandrone's kit, which has no such row.
    rows = simhits.rows_of([("Swift Hunt DMG", "52.9%/76.7%")], "skill", kit, "Claymore")
    assert [(r["name"], r["kind"], r["terms"][0]["mult"], r["count"], r["alternative"]) for r in rows] == [
        ("Swift Hunt DMG", "elemental", 0.529, 1, None)]
    unknown = kits.kit_of("nobody", 0, 6, "", 1, {})
    assert unknown["checked"] is False
    assert [r["kind"] for r in simhits.rows_of([("1-Hit DMG", "50%")], "normal", unknown, "Sword")] == ["physical"]


def test_a_row_that_is_no_hit_or_has_no_readable_value_is_left_out():
    kit = kits.kit_of("razor", 0, 6, "", 1, {})
    rows = simhits.rows_of(      # Razor's real Burst rows at 10: a value of another attack's damage, and a hit
        [("Burst DMG", "288%"), ("Soul Companion DMG", "43.2% Normal Attack DMG"), ("CD", "20.0s")], "burst", kit, "Claymore")
    assert [(r["name"], r["terms"][0]["mult"]) for r in rows] == [("Burst DMG", 2.88)]


def test_hoyolab_leaves_the_stat_out_and_the_wiki_names_it():
    kit = kits.kit_of("lauma", 0, 6, "", 1, {})
    # Synthetic: HoYoLAB's text with no stat word, and the wiki's wording of the same value (a parser input, not a game row).
    rows = simhits.rows_of(
        [("Frostgrove Sanctuary Attack DMG", "345.6%")], "skill", kit, "Catalyst",
        wording=[("Frostgrove Sanctuary Attack DMG", "345.6% Elemental Mastery")],
    )
    assert rows[0]["terms"] == [{"stat": "em", "mult": 3.456}]
    kept = simhits.rows_of([("Press DMG", "218.9%")], "skill", kit, "Catalyst", wording=[("Press DMG", "345.6% Elemental Mastery")])
    assert kept[0]["terms"] == [{"stat": "atk", "mult": 2.189}]          # a value that is not the same one is not the wiki's wording


def test_a_reaction_the_name_says_is_found_in_order():
    assert reaction_kinds("Coda Stellar-Conduct/Stellar Swirl DMG") == ["stellar-conduct", "stellar-swirl"]
    assert reaction_kinds("2-Hit Hold DMG") == [] and reaction_kinds("Lunar-Bloom DMG") == ["lunar-bloom"]


# ------------------------------------------------------------------------------------------------ the main talents

def test_main_talents_default_and_override(planner_of_sandrone, planner_of_fischl):
    assert {t["key"] for t in hits_of(planner_of_sandrone)["talents"] if t["main"]} == {"skill", "burst"}   # her Normal Attack is 6
    assert [t["key"] for t in hits_of(planner_of_fischl)["talents"] if t["main"]] == ["skill"]               # the kit's own rows


def test_a_talent_within_one_level_of_her_highest_is_main(store, clock, tmp_path):
    planner = planner_of(store, clock, tmp_path, talents={"normal": 9, "skill": 10, "burst": 10}, rows=(NORMAL_9, SKILL_10, BURST_10))
    assert [t["main"] for t in hits_of(planner)["talents"]] == [True, True, True]
    planner = planner_of(store, clock, tmp_path, talents={"normal": 9, "skill": 10, "burst": 8}, rows=(NORMAL_9, SKILL_10, BURST_10))
    assert [t["main"] for t in hits_of(planner)["talents"]] == [True, True, False]


def test_a_constellations_bonus_does_not_move_a_talent_out_of_the_main_ones(store, clock, tmp_path):
    # Skill 10 raised and +3 from her constellations (13), Normal Attack and Burst 10: Sandrone's real rows at those levels.
    planner = planner_of(store, clock, tmp_path, talents={"normal": 10, "skill": 10, "burst": 10},
                         bonus={"normal": 0, "skill": 3, "burst": 0}, rows=(NORMAL_9, SKILL_13, BURST_10))
    assert [t["level"] for t in hits_of(planner)["talents"]] == [10, 13, 10]            # the rows are at the boosted level
    assert row(planner, "skill", "Prism Shot DMG")["terms"] == [{"stat": "atk", "mult": 0.688}]
    assert [t["main"] for t in hits_of(planner)["talents"]] == [True, True, True]      # the levels she raised are all 10


def test_the_kits_main_rows_mark_their_rows_and_the_talent_that_holds_them(planner_of_lauma):
    assert [t["key"] for t in hits_of(planner_of_lauma)["talents"] if t["main"]] == ["skill"]
    assert {r["name"]: r["main"] for r in talent(planner_of_lauma, "skill")["rows"]} == {
        "Press DMG": False, "1-Hit Hold DMG": False, "2-Hit Hold DMG": True, "Frostgrove Sanctuary Attack DMG": True,
    }


def test_the_stellar_kind_a_person_fixed_leaves_the_other_kinds_rows_uncounted(planner_of_sandrone):
    # her decision file fixes Sandrone's Stellar hits as Stellar-Conduct (a Cryo or Electro team): her Stellar Swirl rows are listed, not counted
    for key, name in (("skill", "Prism Shot"), ("burst", "Convective Inhibition Ray")):
        assert row(planner_of_sandrone, key, f"{name} Stellar-Conduct DMG")["main"] is True
        assert row(planner_of_sandrone, key, f"{name} Stellar Swirl DMG")["main"] is False
        assert row(planner_of_sandrone, key, f"{name} DMG")["main"] is True
    assert {t["key"] for t in hits_of(planner_of_sandrone)["talents"] if t["main"]} == {"skill", "burst"}


def test_a_kit_whose_main_rows_are_not_found_falls_back_to_the_levels(store, clock, tmp_path):
    planner = planner_of(      # her Skill's rows are Sandrone's (real rows, none named by Fischl's kit)
        store, clock, tmp_path, key="fischl", name="Fischl", element="Electro", weapon_type="Bow", ident=3,
        talents={"normal": 9, "skill": 10, "burst": 10}, rows=(FISCHL_NORMAL, SKILL_10, FISCHL_BURST),
    )
    assert [t["main"] for t in hits_of(planner)["talents"]] == [True, True, True]
    assert all(r["main"] for t in hits_of(planner)["talents"] for r in t["rows"])


# ------------------------------------------------------------------------------------------------ the kit, her weapon and sets

def test_the_block_holds_her_element_weapon_type_level_and_the_kit(planner_of_sandrone):
    hits = hits_of(planner_of_sandrone)
    assert (hits["element"], hits["weapon_type"], hits["level"], hits["checked"]) == ("Cryo", "Claymore", 90, True)   # Elements, as everywhere
    assert [t["key"] for t in hits["talents"]] == ["normal", "skill", "burst"]
    assert [t["name"] for t in hits["talents"]] == ["Normal Attack", "Elemental Skill", "Elemental Burst"]     # no wiki entry kept
    assert {t["name"] for t in hits["toggles"]} == {"a1Decoding", "a1Tactics", "c1Decoding", "c2Stacks"}
    assert any(e["to"] == "base:stellar-conduct" for e in hits["effects"]) and hits["infused"] == []
    assert not any(e["to"] == "atk%" for e in hits["effects"])                  # her weapon's is under weapon_effects, not here


def test_the_block_carries_the_effects_of_her_own_weapon_only(planner_of_sandrone):
    # the pickers' routes carry the rest (test_characters_pickers.py): the planner answer is the build as it is
    gear = hits_of(planner_of_sandrone)["weapon_effects"]
    assert set(gear) == {"a-teaspoon-of-transcendence"}
    teaspoon = gear["a-teaspoon-of-transcendence"]
    assert any(e["to"] == "bonus:stellar-conduct" and e["rate"] == [0.48, 0.6, 0.72, 0.84, 0.96] for e in teaspoon["effects"])   # by refinement
    assert [t["name"] for t in teaspoon["toggles"]] == ["a-teaspoon-of-transcendence:passive"]


def test_the_block_carries_the_effects_of_the_sets_she_wears_only(planner_of_sandrone):
    sets = hits_of(planner_of_sandrone)["set_effects"]
    assert set(sets) == {"disenchantment-in-deep-shadow"}
    assert {e["pieces"] for e in sets["disenchantment-in-deep-shadow"]["effects"]} == {2, 4}


def test_the_planner_answer_no_longer_holds_the_whole_gear_lists(planner_of_sandrone):
    # before the move the answer held every claymore's and every set's effects (about 46 KB of 66 KB for Sandrone)
    assert len(json.dumps(hits_of(planner_of_sandrone)["weapon_effects"])) + len(json.dumps(hits_of(planner_of_sandrone)["set_effects"])) < 8000
    assert len(json.dumps(planner_of_sandrone)) < 30000


def _travelers(store, clock, tmp_path, element):
    # the app's key for her is slug("Traveler"), whatever her element; the file keeps one entry per element
    return planner_of(store, clock, tmp_path, key="traveler", name="Traveler", element=element, weapon_type="Sword", ident=7)


def test_the_travelers_kit_is_the_one_of_her_element(store, clock, tmp_path):
    geo = {t["name"] for t in hits_of(_travelers(store, clock, tmp_path, "Geo"))["toggles"]}
    hydro = {t["name"] for t in hits_of(_travelers(store, clock, tmp_path, "Hydro"))["toggles"]}
    assert "geoC1BurstArea" in geo and "suffusion" not in geo
    assert "suffusion" in hydro and "geoC1BurstArea" not in hydro
    assert hits_of(_travelers(store, clock, tmp_path, "Geo"))["checked"] is True


def test_the_travelers_key_for_the_file_needs_a_known_element():
    assert kits.kit_key("traveler", "Anemo") == "traveler-anemo" and kits.kit_key("traveler", "Geo") == "traveler-geo"
    assert kits.kit_key("traveler", "Quantum") == "traveler-quantum" and kits.kit_key("traveler", None) is None
    assert kits.kit_key("sandrone", "Cryo") == "sandrone" and kits.kit_key("sandrone", None) == "sandrone"
    assert kits.kit_of("traveler", 6, 6, "", 1, {}, element="Quantum")["checked"] is False     # no entry for it: no kit
    assert kits.kit_of("traveler", 6, 6, "", 1, {}, element=None)["checked"] is False
    assert kits.kit_of("traveler", 6, 6, "", 1, {}, element="Geo")["checked"] is True


def test_a_traveler_of_an_element_the_file_lacks_has_no_kit_and_no_crash(store, clock, tmp_path, monkeypatch):
    real = kits.load_kits()
    monkeypatch.setattr(kits, "load_kits", lambda: {**real, "characters": {k: v for k, v in real["characters"].items() if k != "traveler-geo"}})
    hits = hits_of(_travelers(store, clock, tmp_path, "Geo"))
    assert hits["checked"] is False and hits["toggles"] == []


def test_a_talent_rate_is_taken_at_her_level(planner_of_lauma):
    effect = next(e for e in hits_of(planner_of_lauma)["effects"] if e["row"] is not None)
    assert effect["to"] == "additive:lunar-bloom" and effect["row"] == {"talent": "burst", "name": "Lunar-Bloom DMG Increase"}
    assert effect["rate"] == 4.00032                                            # the list's tenth: her Burst is 10
    assert {t["name"] for t in hits_of(planner_of_lauma)["toggles"]} == {"burstPaleHymn", "skillVerdantDew"}


def test_the_recommended_stats_are_one_list_in_the_simulators_keys(store, clock, tmp_path):
    recommended = {"sands": (6,), "goblet": (30,), "circlet": (20, 22), "subs": (20, 22, 6, 28)}
    planner = planner_of(store, clock, tmp_path, recommended=recommended)
    assert hits_of(planner)["recommended"] == ["cr", "cd", "atk_pct", "em", "physical"]       # subs first, then the mains
    assert hits_of(planner_of(store, clock, tmp_path))["recommended"] == []


def test_the_payload_stays_reasonable(planner_of_sandrone):
    assert len(json.dumps(hits_of(planner_of_sandrone))) < 120_000     # the sample references list few weapons: the demo's is 73 KB


def test_the_model_keeps_its_shape_with_hits(planner_of_sandrone, planner_of_lauma, planner_of_fischl):
    for planner in (planner_of_sandrone, planner_of_lauma, planner_of_fischl):
        assert problem_with(planner, "Planner") is None


# ------------------------------------------------------------------------------------------------ the switch

def test_the_switch_is_shipped_on():
    from importlib import util

    spec = util.spec_from_file_location("shipped_characters", characters.__file__)
    shipped = util.module_from_spec(spec)
    spec.loader.exec_module(shipped)
    assert shipped.VERDICT is True


def test_with_the_switch_off_the_planner_is_stage_ones(store, clock, tmp_path, monkeypatch):
    monkeypatch.setattr(characters, "VERDICT", False)
    planner = planner_of(store, clock, tmp_path)
    assert planner["sim"]["hits"] is None and problem_with(planner, "Planner") is None


def test_the_status_tells_the_interface_whether_the_verdict_is_on(tmp_path, monkeypatch):
    clock = FakeClock(SUNDAY)
    core = Core(AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        with TestClient(create_app(core, 4321), base_url="http://127.0.0.1:4321") as client:
            assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
            assert client.get("/api/status").json()["verdict"] is True
            monkeypatch.setattr(characters, "VERDICT", False)
            assert client.get("/api/status").json()["verdict"] is False
    finally:
        core.store.close()


def test_an_infusions_element_is_an_element_too():
    kit = kits.kit_of("hu-tao", 0, 6, "", 1, {})
    levels = {"normal": 10, "skill": 10, "burst": 10}
    block = simhits.hits_block(
        element="Pyro", weapon_type="Polearm", level=90, levels=levels, raised=levels, affixes={}, tables={},
        names={k: (k, None) for k in levels}, kit=kit, recommended=[], weapon_effects={}, set_effects={})
    assert [item["element"] for item in block["infused"]] == ["Pyro"] and block["toggles"]


def test_a_row_that_sums_hits_says_how_many_it_is():
    # Raiden's real Musou Isshin rows at Burst 10 (her 4-Hit prints two hits, her Charged Attack two), and Clorinde's Impale the
    # Night split by its slash: each row says how many hits one landing is, so that a flat bonus per hit is added that often.
    kit = kits.kit_of("raiden-shogun", 0, 6, "", 1, {})
    rows = simhits.rows_of([("Musou no Hitotachi Base DMG", "721.44%"), ("4-Hit DMG", "55.1%+55.3%"),
                            ("Charged Attack DMG", "109.9%+132.7%")], "burst", kit, "Polearm")
    assert [(r["name"], r["instances"]) for r in rows] == [
        ("Musou no Hitotachi Base DMG", 1), ("4-Hit DMG", 2), ("Charged Attack DMG", 2)]
    kit = kits.kit_of("clorinde", 0, 6, "", 1, {})
    rows = simhits.rows_of([("Impale the Night DMG", "65.2%/86.9%/49.6%×3")], "skill", kit, "Sword")
    assert [r["instances"] for r in rows] == [1, 1, 1]


def test_the_block_says_when_her_kit_is_unsure():
    levels = {"normal": 10, "skill": 10, "burst": 10}

    def block(key: str) -> dict:
        return simhits.hits_block(
            element="Hydro", weapon_type="Bow", level=90, levels=levels, raised=levels, affixes={}, tables={},
            names={k: (k, None) for k in levels}, kit=kits.kit_of(key, 0, 6, "", 1, {}), recommended=[], weapon_effects={},
            set_effects={})

    assert block("varka")["unsure"] == kits.kit_of("varka", 0, 6, "", 1, {})["unsure"] and block("varka")["unsure"]
    assert block("hu-tao")["unsure"] is None


# ------------------------------------------------------------------------------------------------ rows a person gave hits no row prints


def _derived_block(affixes, tables=None, derived=None):
    from guildboard.characters import simhits
    kit = {"checked": True, "main": None, "stellar": None, "unsure": None, "party": None, "absent_rows": {}, "infused": [], "effects": [], "toggles": [],
           "elements": {}, "hits": {"normal": {"1-Hit DMG": "physical", "2-Hit DMG": "physical"}, "burst": {"Dusk Bolt 1-Hit DMG": "elemental", "Dusk Bolt 2-Hit DMG": "elemental"}},
           "moves": {"normal": {"1-Hit DMG": "normal", "2-Hit DMG": "normal"}, "burst": {"Dusk Bolt 1-Hit DMG": "charged", "Dusk Bolt 2-Hit DMG": "charged"}},
           "derived_rows": derived if derived is not None else [
               {"talent": "burst", "name": "Dusk Bolt 1-Hit DMG", "from_talent": "normal", "from_row": "1-Hit DMG"},
               {"talent": "burst", "name": "Dusk Bolt 2-Hit DMG", "from_talent": "normal", "from_row": "2-Hit DMG"}]}
    return simhits.hits_block(
        element="Electro", weapon_type="Bow", level=90, levels={"normal": 10, "skill": 10, "burst": 10}, raised={"normal": 10, "skill": 10, "burst": 10},
        affixes=affixes, tables=tables or {}, names={t: (t, None) for t in simhits.TALENTS}, kit=kit, recommended=[], weapon_effects={}, set_effects={})


def test_a_derived_row_has_the_numbers_of_the_row_it_copies_and_its_own_kind_and_move():
    block = _derived_block({"normal": [("1-Hit DMG", "104.0%"), ("2-Hit DMG", "49.8%+49.8%")], "burst": [("Dusk Bolt DMG Increase", "196.2% Elemental Mastery")]})
    burst = next(t for t in block["talents"] if t["key"] == "burst")
    normal = next(t for t in block["talents"] if t["key"] == "normal")
    assert [(r["name"], r["kind"], r["move"], r["instances"]) for r in burst["rows"]] == [
        ("Dusk Bolt 1-Hit DMG", "elemental", "charged", 1), ("Dusk Bolt 2-Hit DMG", "elemental", "charged", 2)]
    for derived, source in zip(burst["rows"], normal["rows"]):
        assert (derived["terms"], derived["flat"], derived["count"]) == (source["terms"], source["flat"], source["count"])
    assert burst["source"] == "hoyolab" and burst["main"] is True and [r["kind"] for r in normal["rows"]] == ["physical", "physical"]


def test_a_derived_row_of_a_talent_with_no_rows_of_its_own_takes_its_source_from_the_copied_talent():
    block = _derived_block({"normal": [("1-Hit DMG", "104.0%")]})
    burst = next(t for t in block["talents"] if t["key"] == "burst")
    assert [r["name"] for r in burst["rows"]] == ["Dusk Bolt 1-Hit DMG"] and burst["source"] == "hoyolab"


def test_a_derived_row_whose_source_row_is_not_there_is_not_made():
    block = _derived_block({"normal": [("2-Hit DMG", "49.8%+49.8%")], "burst": [("Dusk Bolt DMG Increase", "196.2% Elemental Mastery")]})
    assert [r["name"] for r in next(t for t in block["talents"] if t["key"] == "burst")["rows"]] == ["Dusk Bolt 2-Hit DMG"]


def test_a_derived_row_finds_its_source_row_through_the_wording_both_sources_share():
    # HoYoLAB's name carries a tag and another case: only what `normalise` removes differs from the kit's
    block = _derived_block({"normal": [("<b>1-hit DMG</b>", "104.0%"), ("2-Hit DMG", "49.8%+49.8%")]})
    burst = next(t for t in block["talents"] if t["key"] == "burst")
    assert [r["name"] for r in burst["rows"]] == ["Dusk Bolt 1-Hit DMG", "Dusk Bolt 2-Hit DMG"]


def test_an_absent_row_is_found_through_the_same_wording():
    from guildboard.characters import simhits
    kit = {"checked": True, "main": None, "stellar": None, "unsure": None, "elements": {}, "moves": {}, "infused": [], "effects": [],
           "toggles": [], "hits": {"normal": {"1-Hit DMG": "physical", "2-Hit DMG": "physical"}}, "absent_rows": {"normal": ["<b>2-hit dmg</b>"]}}
    block = simhits.hits_block(
        element="Pyro", weapon_type="Catalyst", level=90, levels={"normal": 10, "skill": 10, "burst": 10},
        raised={"normal": 10, "skill": 10, "burst": 10}, affixes={"normal": [("1-Hit DMG", "100%"), ("2-Hit DMG", "90%")]}, tables={},
        names={t: (t, None) for t in simhits.TALENTS}, kit=kit, recommended=[], weapon_effects={}, set_effects={})
    assert {r["name"]: r["main"] for r in block["talents"][0]["rows"]} == {"1-Hit DMG": True, "2-Hit DMG": False}


def test_the_kit_gives_a_characters_derived_rows():
    from guildboard.characters import kits
    assert kits.kit_of("sethos", 0, 6, "", 1, {})["derived_rows"] and kits.kit_of("hu-tao", 0, 6, "", 1, {})["derived_rows"] == []
    assert kits.kit_of("nobody", 0, 6, "", 1, {})["derived_rows"] == []
