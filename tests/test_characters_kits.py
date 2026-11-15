"""The kit data (src/guildboard/reference/characters/kits.json), generated from Genshin Optimizer's Waverider sheets by
tools/go-reference, and kits.kit_of, which gives one build's kit: her effects at her constellation and ascension, her
weapon's at its refinement and her sets' at their piece counts. The numbers are GO's datamine (go-engine.md 2, worked
examples)."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

import hoyolab_samples as samples
import json_schema
from guildboard.characters import kits
from guildboard.characters.hits import is_damage, normalise

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "src" / "guildboard" / "reference" / "characters"
# the pin is written once, in run.py (`run.py refresh` moves it there and in the files that repeat it)
PINNED = re.search(r'PINNED = "([0-9a-f]{40})"', (ROOT / "tools" / "go-reference" / "run.py").read_text(encoding="utf-8")).group(1)
# The characters whose decisions the first comparison proved (2026-11-13): a required part of the decided set, which is whatever
# tools/go-reference/decided/ holds (one file per character), so a new decision file edits no test.
COMPARISON = {
    "sandrone", "columbina", "lauma", "nahida", "neuvillette", "hu-tao", "arataki-itto", "raiden-shogun", "mitya", "furina",
    "alhaitham", "yelan", "albedo", "kamisato-ayaka", "xiangling", "fischl", "ineffa", "flins", "odette",
}


def _raw() -> dict:
    return json.loads((FOLDER / "kits.json").read_text(encoding="utf-8"))


def _has(effects: list[dict], **wanted) -> bool:
    """Whether one effect has every field `wanted` gives (numbers within 1e-9)."""
    def same(a, b):
        if isinstance(a, float) or isinstance(b, float):
            return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) < 1e-9
        return a == b
    return any(all(same(e.get(k), v) for k, v in wanted.items()) for e in effects)


def test_the_file_matches_its_schema():
    schema = json.loads((FOLDER / "schema" / "kits.schema.json").read_text(encoding="utf-8"))
    assert json_schema.problem_with(_raw(), schema) is None


def test_every_entry_names_the_pinned_commit_and_its_sheet():
    raw = _raw()
    assert raw["go_commit"] == PINNED
    for group in ("characters", "weapons", "sets"):
        assert raw[group], group
        for key, entry in raw[group].items():
            assert entry["source"].startswith(f"GO {PINNED[:8]} libs/gi/sheets/src/"), (group, key)


def test_every_character_weapon_and_set_go_has_is_there():
    raw = _raw()
    # GO's 130 characters less Somnia, who is in its data but not in the game (`kitgen.NOT_IN_GAME`)
    assert len(raw["characters"]) >= 129 and len(raw["weapons"]) >= 250 and len(raw["sets"]) >= 60
    assert "somnia" not in raw["characters"]
    assert {"traveler-anemo", "hu-tao", "raiden-shogun", "kamisato-ayaka", "mitya"} <= set(raw["characters"])
    assert {"staff-of-homa", "engulfing-lightning", "wolf-s-gravestone"} <= set(raw["weapons"])
    assert {"emblem-of-severed-fate", "gladiator-s-finale", "crimson-witch-of-flames"} <= set(raw["sets"])


def test_sandrones_conversions_and_stellar_rows():
    kit = kits.kit_of("sandrone", 0, 6, "wolf-s-gravestone", 1, {"gladiator-s-finale": 4})
    assert _has(kit["effects"], **{"from": "atk", "reads": "premod", "to": "em", "rate": 0.08, "cap": 160})
    assert _has(kit["effects"], **{"from": "atk", "reads": "final", "to": "base:stellar-conduct", "rate": 0.00007, "cap": 0.14})
    assert kit["hits"]["skill"]["Prism Shot Stellar-Conduct DMG"] == "stellar-conduct"
    assert kit["hits"]["skill"]["Prism Shot DMG"] == "elemental"
    assert kit["hits"]["normal"]["1-Hit DMG"] == "physical"
    assert kit["elements"]["skill"]["Prism Shot Stellar-Conduct DMG"] == "cryo"


def test_gates_follow_constellation_ascension_and_pieces():
    low = kits.kit_of("sandrone", 0, 3, "wolf-s-gravestone", 1, {"emblem-of-severed-fate": 2})
    assert not _has(low["effects"], to="em")  # her A4 needs the fourth ascension
    assert not _has(low["effects"], to="elevation:stellar-conduct")  # Constellation 6
    assert _has(low["effects"], to="er", rate=0.2)  # Emblem's two pieces
    assert not _has(low["effects"], to="dmg:burst")  # but not its four
    high = kits.kit_of("sandrone", 6, 6, "wolf-s-gravestone", 1, {"emblem-of-severed-fate": 4})
    assert _has(high["effects"], to="elevation:stellar-conduct", rate=0.2)
    assert _has(high["effects"], **{"from": "er", "reads": "premod", "to": "dmg:burst", "rate": 0.25, "cap": 0.75})


def test_a_set_bonus_for_some_weapons_only():
    sword = kits.kit_of("kamisato-ayaka", 0, 6, "mistsplitter-reforged", 1, {"gladiator-s-finale": 4})
    bow = kits.kit_of("yelan", 0, 6, "aqua-simulacra", 1, {"gladiator-s-finale": 4})
    assert _has(sword["effects"], to="dmg:normal", rate=0.35)
    assert not _has(bow["effects"], to="dmg:normal", rate=0.35)


def test_the_kind_comes_from_the_kit_where_the_name_does_not_say_it():
    lauma = kits.kit_of("lauma", 0, 6, "lost-prayer-to-the-sacred-winds", 1, {})
    assert lauma["hits"]["skill"]["2-Hit Hold DMG"] == "lunar-bloom"
    assert lauma["hits"]["skill"]["Press DMG"] == "elemental"
    flins = kits.kit_of("flins", 0, 6, "", 1, {})
    assert flins["hits"]["burst"]["Thunderous Symphony DMG"] == "lunar-charged"
    assert flins["hits"]["skill"]["Northland Spearstorm DMG"] == "elemental"


def test_raidens_eye_is_counted_and_engulfing_lightning_converts_at_her_refinement():
    kit = kits.kit_of("raiden-shogun", 0, 6, "engulfing-lightning", 3, {})
    assert _has(kit["effects"], **{"from": "er", "reads": "premod", "over": 1.0, "to": "atk%", "rate": 0.42, "cap": 1.0})
    assert _has(kit["effects"], **{"from": "er", "reads": "premod", "over": 1.0, "to": "dmg:electro", "rate": 0.4})
    eye = next(t for t in kit["toggles"] if t["name"] == "skillEye")
    assert eye["on"] is True and eye["covers"] == ["burst"] and eye["label"] == "Eye of Stormy Judgment"
    assert _has(kit["effects"], to="dmg:burst", **{"while": "skillEye"})
    # her Burst's per-stack Resolve is no row of its own
    assert "Resolve Bonus" not in kit["hits"]["burst"]


def test_hu_taos_paramita_is_counted_for_her_attacks():
    kit = kits.kit_of("hu-tao", 0, 6, "staff-of-homa", 1, {"crimson-witch-of-flames": 4})
    paramita = next(t for t in kit["toggles"] if t["name"] == "GuideToAfterlifeVoyage")
    assert paramita["on"] is True and {"normal", "charged"} <= set(paramita["covers"])
    assert paramita["label"] == "Paramita Papilio"
    increase = next(e for e in kit["effects"] if e["while"] == "GuideToAfterlifeVoyage" and e["to"] == "atk")
    assert increase["row"] == {"talent": "skill", "name": "ATK Increase"}
    assert increase["from"] == "hp" and increase["reads"] == "premod" and increase["cap"] == 4.0
    assert increase["cap_from"] == "base_atk" and abs(increase["rate"][9] - 0.0626) < 1e-4  # 6.26% at level 10
    assert {"talents": ["normal", "charged", "plunging"], "element": "pyro", "while": "GuideToAfterlifeVoyage"} in kit["infused"]
    assert next(t for t in kit["toggles"] if t["name"] == "SanguineRouge")["on"] is False


def test_staff_of_homa_adds_hp_and_converts_it_into_atk():
    kit = kits.kit_of("hu-tao", 0, 6, "staff-of-homa", 1, {})
    assert _has(kit["effects"], **{"from": None, "to": "hp%", "rate": 0.2})
    assert _has(kit["effects"], **{"from": "hp", "reads": "premod", "to": "atk", "rate": 0.008})
    r5 = kits.kit_of("hu-tao", 0, 6, "staff-of-homa", 5, {})
    assert _has(r5["effects"], **{"from": None, "to": "hp%", "rate": 0.4})


def test_an_unknown_character_has_no_kit():
    assert kits.kit_of("someone-new", 0, 6, "staff-of-homa", 1, {}) == {
        "checked": False, "main": None, "stellar": None, "hits": {}, "elements": {}, "moves": {}, "infused": [], "effects": [], "toggles": [], "party": None, "absent_rows": {},
        "derived_rows": [],
    }


def _decided() -> dict[str, dict]:
    """The decision files of tools/go-reference/decided/: the characters with decisions (a file that says more than `unsure`)."""
    folder = ROOT / "tools" / "go-reference" / "decided"
    files = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in folder.glob("*.json") if not p.stem.startswith("_")}
    return {key: mine for key, mine in files.items() if set(mine) - {"unsure"}}


def test_checked_is_true_for_exactly_the_decided_characters():
    raw = _raw()
    decided = _decided()
    assert COMPARISON <= set(decided)
    assert {key for key, c in raw["characters"].items() if c["checked"]} == set(decided)


# The toggles that lifting the Constellation 2 boundary gave decided characters (2026-11-15), which no decision file decides yet: kits.json
# holds them off, `run.py kits` lists them, and the next task of the plan (verdict-c3-to-c6, Task 2) decides each in her file and empties
# this table. A toggle of a decided character that is in neither her file nor this table fails the tests below.
AWAITING: dict[str, set[str]] = {}


def test_kits_json_holds_every_decision_file_as_written():
    # the testable form of "kits.json is what the decision files make": a decision changed without `run.py kits` fails here
    import importlib.util
    import sys

    tool = ROOT / "tools" / "go-reference"
    spec = importlib.util.spec_from_file_location("kitgen", tool / "kitgen.py")
    kitgen = importlib.util.module_from_spec(spec)
    sys.modules["kitgen"] = kitgen
    spec.loader.exec_module(kitgen)
    decided = kitgen.load_decided(tool / "decided")
    raw = _raw()["characters"]
    for key, kept in raw.items():
        differs = kitgen.decision_differences(decided["characters"].get(key), decided["unsure"].get(key), kept)
        if key in AWAITING:
            # her file does not decide the toggles of the table yet: kits.json has them, off, and no other difference
            assert differs == ["toggles"], key
            names = {t["name"] for t in kept["toggles"]}
            assert names - set(decided["characters"][key]["toggles"]) == AWAITING[key], key
            assert all(not t["on"] for t in kept["toggles"] if t["name"] in AWAITING[key]), key
        else:
            assert differs == [], key


def test_every_decision_file_is_named_for_a_character_and_its_unsure_sentence_is_in_the_kits():
    folder = ROOT / "tools" / "go-reference" / "decided"
    raw = _raw()["characters"]
    unsure = {}
    for path in sorted(folder.glob("*.json")):
        if path.stem.startswith("_"):
            continue
        assert path.stem in raw, f"{path.name} is not a character's key"
        mine = json.loads(path.read_text(encoding="utf-8"))
        assert set(mine) <= {"main", "stellar", "modes", "toggles", "unsure", "party", "reads", "derived_rows"}, path.name
        if "unsure" in mine:
            assert isinstance(mine["unsure"], str) and mine["unsure"].endswith("."), path.name
            unsure[path.stem] = mine["unsure"]
    assert unsure == {key: c["unsure"] for key, c in raw.items() if c.get("unsure")}
    about = json.loads((folder / "_about.json").read_text(encoding="utf-8"))
    assert about["about"] and about["checked"]
    assert not (ROOT / "tools" / "go-reference" / "decided.json").exists()


def test_every_decided_toggle_has_our_label_and_a_reason():
    decided = _decided()
    raw = _raw()
    for key, mine in decided.items():
        names = {t["name"] for t in raw["characters"][key]["toggles"]}
        assert names == set(mine.get("toggles") or {}) | AWAITING.get(key, set()), key
        for name, toggle in (mine.get("toggles") or {}).items():
            assert toggle["label"] and toggle["reason"], (key, name)
            assert not toggle["on"] or toggle["covers"], (key, name)  # an on toggle says which talents it covers
        for row in mine.get("main") or []:
            assert any(row in rows for rows in raw["characters"][key]["hits"].values()), (key, row)


def test_main_rows_name_her_main_talents():
    fischl = kits.kit_of("fischl", 0, 6, "", 1, {})
    talents = {t for t, rows in fischl["hits"].items() for row in rows if row in fischl["main"]}
    assert talents == {"skill"}
    xiangling = kits.kit_of("xiangling", 0, 6, "", 1, {})
    assert {t for t, rows in xiangling["hits"].items() for row in rows if row in xiangling["main"]} == {"skill", "burst"}


def test_the_rows_are_hoyolabs():
    # Sandrone's rows as HoYoLAB's skill_affix_list gives them (tests/hoyolab_samples.py): every damage row is in the kit.
    kit = kits.kit_of("sandrone", 0, 6, "", 1, {})
    talents = ["normal", "skill", "burst"]
    for talent, skill in zip(talents, samples.SANDRONE_DETAIL["skills"][:3]):
        ours = {normalise(name) for name in kit["hits"][talent]}
        for row in skill["skill_affix_list"]:
            if is_damage(row["name"]):
                assert normalise(row["name"]) in ours, (talent, row["name"])


def test_every_row_of_the_kits_is_a_hit():
    # A per-stack bonus inside a hit's formula (Heizou's Declension DMG Bonus) prints a row of its own: it is no hit.
    raw = _raw()
    assert [(key, name) for key, c in raw["characters"].items() for rows in c["hits"].values() for name in rows
            if not is_damage(name)] == []


def test_a_normal_attack_rows_move_is_known():
    kit = kits.kit_of("hu-tao", 0, 6, "", 1, {})
    assert kit["moves"]["normal"]["1-Hit DMG"] == "normal"
    assert kit["moves"]["normal"]["Low/High Plunge DMG"] == "plunging"
    assert next(m for name, m in kit["moves"]["normal"].items() if name.startswith("Charged Attack")) == "charged"


def test_kits_json_holds_facts_only():
    # No GO code, no descriptions: the one text a person wrote is a toggle's label, and the row names are match keys.
    text = (FOLDER / "kits.json").read_text(encoding="utf-8")
    assert "import " not in text and "export " not in text and "description" not in text


def test_the_app_never_reaches_the_tool():
    # The generator and its specs are developer tools: nothing the app runs imports them.
    imports = re.compile(r"^\s*(?:import|from)\s+(?:tools\b|\S*kitgen\b|\S*go_reference\b)", re.MULTILINE)
    for path in (ROOT / "src").rglob("*.py"):
        assert imports.search(path.read_text(encoding="utf-8")) is None, path


def test_the_notices_carry_genshin_optimizers_licence():
    text = (ROOT / "THIRD-PARTY-NOTICES.txt").read_text(encoding="utf-8")
    assert "Copyright (c) 2020-present, frzyc" in text
    assert "https://github.com/frzyc/genshin-optimizer" in text
    section = text.split("== Genshin Optimizer's kit data ==", 1)[1].split("=" * 78, 1)[0]
    assert "Permission is hereby granted, free of charge" in section and PINNED in section


@pytest.mark.parametrize("key", sorted(COMPARISON))
def test_each_comparison_character_has_damage_rows_with_kinds(key):
    kit = kits.kit_of(key, 0, 6, "", 1, {})
    assert kit["checked"] is True
    rows = [kind for talent in kit["hits"].values() for kind in talent.values()]
    assert rows and set(rows) <= {"physical", "elemental", "lunar-bloom", "lunar-charged", "lunar-crystallize",
                                  "stellar-conduct", "stellar-swirl"}
    assert all(re.fullmatch(r"\S.*\S", name) for talent in kit["hits"].values() for name in talent)


def test_what_the_panel_already_holds_is_marked():
    emblem = _raw()["sets"]["emblem-of-severed-fate"]["effects"]
    assert next(e for e in emblem if e["to"] == "er")["in_stats"] is True  # the 2-piece ER: on the panel, statsWith swaps it
    assert next(e for e in emblem if e["to"] == "dmg:burst")["in_stats"] is False  # the 4-piece converts: not on the panel
    homa = _raw()["weapons"]["staff-of-homa"]["effects"]
    assert next(e for e in homa if e["to"] == "hp%")["in_stats"] is True
    assert next(e for e in homa if e["from"] == "hp" and e["while"] is None)["in_stats"] is False
    mitya = _raw()["characters"]["mitya"]["effects"]
    assert next(e for e in mitya if e["to"] == "em" and e["from"] is None and e["while"] is None)["in_stats"] is True
    assert next(e for e in mitya if e["to"] == "base:stellar-conduct")["in_stats"] is False
    flins = _raw()["characters"]["flins"]["effects"]
    assert next(e for e in flins if e["to"] == "atk%")["in_stats"] is False  # a constellation's stat: not on the panel
    xingqiu = _raw()["characters"]["xingqiu"]["effects"]
    assert next(e for e in xingqiu if e["to"] == "dmg:hydro")["in_stats"] is True  # an ascension passive's stat: on the panel (the audit's panel question)


def test_kit_of_gives_copies():
    kit = kits.kit_of("hu-tao", 0, 6, "staff-of-homa", 1, {})
    kit["hits"]["normal"]["1-Hit DMG"] = "changed"
    kit["infused"][0]["element"] = "changed"
    kit["toggles"][0]["on"] = "changed"
    again = kits.kit_of("hu-tao", 0, 6, "staff-of-homa", 1, {})
    assert again["hits"]["normal"]["1-Hit DMG"] == "physical" and again["infused"][0]["element"] == "pyro"
    assert all(t["on"] in (True, False) for t in again["toggles"])


def test_kit_of_gives_only_the_toggles_something_reads():
    c0 = {t["name"] for t in kits.kit_of("sandrone", 0, 6, "", 1, {})["toggles"]}
    c6 = {t["name"] for t in kits.kit_of("sandrone", 6, 6, "", 1, {})["toggles"]}
    assert "c1Decoding" not in c0 and "c1Decoding" in c6  # her Constellation 1 state reads nothing below C1
    assert "a1Decoding" in c0


def test_party_terms_are_listed_as_left_out():
    flins = _raw()["characters"]["flins"]["left_out"]
    assert any(item["why"] == "depends on the party" for item in flins)


def test_stacks_her_own_main_hits_make_are_counted():
    for key, name in (("columbina", "a1Stacks"), ("mitya", "a4Stacks"), ("neuvillette", "a1Stacks")):
        toggle = next(t for t in kits.kit_of(key, 0, 6, "", 1, {})["toggles"] if t["name"] == name)
        assert toggle["on"] is True and toggle["covers"], key


def test_the_stellar_kind_a_person_fixed_is_in_the_kit():
    assert kits.kit_of("sandrone", 0, 6, "", 1, {})["stellar"] == "stellar-conduct"
    # Odette is Cryo too: GO deals her dance moves' Stellar hits only in a state of hers (a0StellarRadiance "sc"), which
    # her decision file fixes as Sandrone's (found by the comparison with GO, 2026-11-14)
    assert kits.kit_of("odette", 0, 6, "", 1, {})["stellar"] == "stellar-conduct"
    assert kits.kit_of("hu-tao", 0, 6, "", 1, {})["stellar"] is None


def test_a_skill_row_the_game_deals_as_a_normal_attack_has_that_move():
    kit = kits.kit_of("clorinde", 0, 6, "", 1, {})
    assert kit["moves"]["skill"]["Swift Hunt DMG"] == "normal"
    assert "Skill DMG" not in kit["moves"].get("burst", {})


def test_a_kit_the_comparison_could_not_prove_says_why():
    # The comparison with Genshin Optimizer (2026-11-14): some of Varka's skill hits are two strikes in one row, one Anemo and one of a
    # party member's element, which the planner counts as one, so his verdict is "It depends" with the reason (his decision file's
    # `unsure`). Yelan was the first such character; the party settings (the Plan design 14) proved her kit.
    raw = _raw()["characters"]
    reasons = {key: c["unsure"] for key, c in raw.items() if c.get("unsure")}
    assert "varka" in reasons and "yelan" not in reasons and all(isinstance(r, str) and r.endswith(".") for r in reasons.values())
    assert kits.kit_of("varka", 0, 6, "", 1, {})["unsure"] == reasons["varka"]
    assert kits.kit_of("hu-tao", 0, 6, "", 1, {})["unsure"] is None
    assert kits.kit_of("nobody", 0, 6, "", 1, {}).get("unsure") is None


def test_kit_of_gives_the_toggles_an_effect_reads_beside_its_own_state():
    # Kaveh's A4 reads two states: after his Burst and the stacks of the passive (from Ascension 4)
    names = {t["name"] for t in kits.kit_of("kaveh", 0, 6, "", 1, {})["toggles"]}
    assert {"afterBurst", "a4Stacks"} <= names
    below = {t["name"] for t in kits.kit_of("kaveh", 0, 3, "", 1, {})["toggles"]}
    assert "a4Stacks" not in below   # the passive is not his yet: nothing reads its stacks
    effect = next(e for e in kits.kit_of("kaveh", 0, 6, "", 1, {})["effects"] if e.get("also"))
    assert (effect["while"], effect["also"]) == ("afterBurst", ["a4Stacks"])


# ------------------------------------------------------------------------------------------------ the toggles the planner offers


def _c6_only_toggle():
    """A toggle of a character that only effects from Constellation 6 read, with her key: it is hers only from there."""
    for key, character in _raw()["characters"].items():
        if key.startswith("traveler"):
            continue
        for toggle in character["toggles"]:
            readers = [e for e in character["effects"] if e.get("while") == toggle["name"] or toggle["name"] in (e.get("also") or ())]
            infused = [i for i in character["infused"] if i.get("while") == toggle["name"]]
            if readers and not infused and all((e.get("from_constellation") or 0) >= 6 for e in readers):
                return key, toggle["name"]
    return None


def test_a_toggle_only_a_constellation_6_effect_reads_is_not_given_below_it():
    found = _c6_only_toggle()
    assert found is not None, "no character has a C6-only toggle: the gate test needs one"
    key, name = found
    assert name not in {t["name"] for t in kits.kit_of(key, 0, 6, "", 1, {})["toggles"]}
    assert name in {t["name"] for t in kits.kit_of(key, 6, 6, "", 1, {})["toggles"]}


CODE_WORDS = {"state", "stack", "mode", "passive", "set2", "set4"}


def _gear_toggle(raw: dict, name: str) -> tuple[dict, list[dict]]:
    key = name.split(":")[0]
    item = raw["weapons"].get(key) or raw["sets"][key]
    toggle = next(t for t in item["toggles"] if t["name"] == name)
    return toggle, [e for e in item["effects"] if e.get("while") == name]


def test_the_gear_labels_say_what_each_bonus_is_and_when_it_holds():
    # meanings a review found turned round once (each read from the item's text on the HoYoLAB wiki and its effects here)
    raw = _raw()
    skill, skill_effects = _gear_toggle(raw, "wolf-fang:skillStacks")
    burst, burst_effects = _gear_toggle(raw, "wolf-fang:burstStacks")
    assert [(e["to"], e["talents"]) for e in skill_effects] == [("cr", ["skill"])]   # Skill hits raise the Skill's own CRIT Rate
    assert [(e["to"], e["talents"]) for e in burst_effects] == [("cr", ["burst"])]
    assert skill["label"] == "Skill CRIT Rate at 4 stacks from Skill hits"
    assert burst["label"] == "Burst CRIT Rate at 4 stacks from Burst hits"
    charged, charged_effects = _gear_toggle(raw, "dodoco-tales:DodoventureCharged")
    normal, normal_effects = _gear_toggle(raw, "dodoco-tales:DodoventureNormal")
    assert [e["to"] for e in charged_effects] == ["atk%"] and charged["label"] == "ATK bonus after a Charged Attack hit"
    assert [e["to"] for e in normal_effects] == ["dmg:charged"] and normal["label"] == "Charged Attack DMG after a Normal Attack hit"
    fruit, fruit_effects = _gear_toggle(raw, "fruit-of-fulfillment:stacks")
    first = lambda rate: rate[0] if isinstance(rate, list) else rate  # noqa: E731  (a rate by refinement, or one number)
    assert {e["to"]: first(e["rate"]) < 0 for e in fruit_effects} == {"em": False, "atk%": True}
    assert fruit["label"] == "Mastery up and ATK down at 5 stacks from reactions"
    assert _gear_toggle(raw, "golden-troupe:set4")[0]["label"] == "Extra Skill DMG while off the field"
    assert _gear_toggle(raw, "azurelight:afterSkill")[0]["label"] == "ATK bonus after using the Skill"
    assert _gear_toggle(raw, "fading-twilight:state")[0]["state"] == "evengleam"
    assert _gear_toggle(raw, "fading-twilight:state")[0]["label"] == "DMG bonus in the first and weakest of its 3 states"
    assert _gear_toggle(raw, "song-of-stillness:afterHeal")[0]["label"] == "DMG bonus after being healed"
    assert _gear_toggle(raw, "talking-stick:affectedPyro")[0]["label"] == "ATK bonus after being affected by Pyro"


def test_no_weapon_or_set_toggle_label_names_her_or_him():
    # "<item>: <label>" is shown for every character as written, so a label says "the Skill", never "her Skill"
    raw = _raw()
    for kind in ("weapons", "sets"):
        for item in raw[kind].values():
            if item.get("checked"):
                continue
            for toggle in item["toggles"]:
                assert not re.search(r"\b(her|she|his|he|him|their|they)\b", toggle["label"], re.IGNORECASE), toggle["name"]


def test_no_weapon_or_set_toggle_label_is_a_code_name():
    # the planner offers these toggles to be counted ("<item>: <label>"), so each label is a plain phrase of ours
    raw = _raw()
    for kind in ("weapons", "sets"):
        for key, item in raw[kind].items():
            for toggle in item["toggles"]:
                label = toggle["label"]
                where = f"{kind}/{toggle['name']}: {label!r}"
                words = label.split()
                assert len(words) >= 2 or item.get("checked"), where                # never a bare word (State, Stack, Passive, Hp, Set4)
                assert words[-1].casefold() not in CODE_WORDS and words[-1] != "Hp", where   # nor a phrase that ends in one
                assert not re.search(r"[a-z][A-Z]|_", label), where                 # nor a camelCase or underscore token
                code = re.sub(r"([a-z0-9])([A-Z])", r" ", toggle["name"].split(":")[-1]).replace("_", " ")
                assert label.casefold() != code.casefold(), where                   # nor the toggle's own code name in words
