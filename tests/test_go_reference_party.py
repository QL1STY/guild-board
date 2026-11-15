"""The party settings of the Genshin Optimizer tool (tools/go-reference, the Plan design 14): a decision file's `party` (the team
shapes a character's damage depends on, the one that is usual and the rows the team decides), how kitgen reads her sheet once for
each of them, and what the comparison with GO sets the team to. Trees are shaped as GO's Waverider sheets write them."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kitgen = _load("kitgen")


def c(v):
    return {"op": "const", "v": v}


def r(p):
    return {"op": "read", "p": p}


def gate(path, k, x):
    return {"op": "threshold", "x": [r(path), c(k), x, c(0)]}


def elements_count():
    """Yelan's A1: the Max HP % is read by how many elements the party has (GO: a lookup of the sum of min(tally, 1))."""
    one = lambda e: {"op": "min", "x": [r(f"tally.{e}"), c(1.0)]}  # noqa: E731
    index = {"op": "add", "x": [one(e) for e in ("physical", "anemo", "geo", "electro", "hydro", "pyro", "cryo", "dendro")]}
    return gate("asc", 1, {"op": "subscript", "x": [index], "list": [0, 0.06, 0.12, 0.18, 0.3]})


PARTY = {
    "default": "three",
    "reason": "Most teams of hers have three.",
    "options": [
        {"id": "two", "label": "2 elements", "team": ["pyro", "pyro", "hydro"]},
        {"id": "three", "label": "3 elements", "team": ["pyro", "electro", "hydro"]},
        {"id": "four", "label": "4 elements", "team": ["pyro", "electro", "cryo"]},
    ],
}


def _build(party=None, effects=None, hits=None, rows=None, toggles=None):
    char = {"sheet": "Yelan", "name": "Yelan", "element": "hydro", "weapon_type": "bow", "rows": rows or {}, "params": {},
            "hits": hits or []}
    kit = {"characters": {"Yelan": {"effects": effects if effects is not None else {"premod": {"hp_": elements_count()}},
                                    "hit_data": {}}}, "weapons": {}, "sets": {}}
    decided = {"about": "", "checked": "", "unsure": {},
               "characters": {"yelan": {"party": party, "toggles": toggles or {}}} if party else {}}
    return kitgen.build(kit, {"Yelan": char}, decided, "0" * 40, lambda name: name.lower().replace(" ", "-"),
                        lambda *a: "elemental")["characters"]["yelan"]


# ------------------------------------------------------------------------------------------------ the decision file


def _write(tmp_path, party):
    (tmp_path / "yelan.json").write_text(json.dumps({"toggles": {}, "party": party}), encoding="utf-8")
    return kitgen.load_decided(tmp_path)


def test_a_decision_file_may_carry_a_party(tmp_path):
    decided = _write(tmp_path, PARTY)
    assert decided["characters"]["yelan"]["party"]["default"] == "three"


@pytest.mark.parametrize("change, message", [
    ({"default": "five"}, "default"),
    ({"options": []}, "options"),
    ({"options": [PARTY["options"][0], {**PARTY["options"][0]}]}, "twice"),
    ({"default": "two", "options": [{"id": "two", "label": "2", "team": ["pyro", "pyro", "wind"]}]}, "element"),
    ({"default": "two", "options": [{"id": "two", "label": "", "team": ["pyro"]}]}, "label"),
    ({"default": "two", "element_rows": {"skill": ["Row"]}, "options": [{"id": "two", "label": "L", "team": []}]}, "elements"),
    ({"only_rows": {"burst": {"Row": ["nine"]}}}, "nine"),
    ({"reason": ""}, "reason"),
    ({"default": "three", "nonsense": 1}, "nonsense"),
])
def test_a_party_that_does_not_make_sense_is_refused_with_the_file_name(tmp_path, change, message):
    with pytest.raises(SystemExit, match="yelan.json") as caught:
        _write(tmp_path, {**PARTY, **change})
    assert message in str(caught.value)


def test_the_party_is_part_of_what_a_decision_says_to_kits_json():
    kept = {"checked": True, "unsure": None, "main": None, "stellar": None, "toggles": [], "party": None}
    assert kitgen.decision_differences({"party": PARTY}, None, kept) == ["party"]
    held = {**kept, "party": {"default": "three", "reason": PARTY["reason"],
                              "options": [{"id": o["id"], "label": o["label"], "elements": []} for o in PARTY["options"]],
                              "element_rows": {}, "only_rows": {}}}
    assert kitgen.decision_differences({"party": PARTY}, None, held) == []
    other = {**PARTY, "default": "two"}
    assert kitgen.decision_differences({"party": other}, None, held) == ["party"]


# ------------------------------------------------------------------------------------------------ the sheet, once for each team


def test_the_teams_tally_is_what_the_sheet_reads():
    env = kitgen.party_reads("hydro", "Yelan", PARTY, PARTY["options"][1])
    assert (env["tally.hydro"], env["tally.pyro"], env["tally.electro"], env["tally.cryo"], env["tally.physical"]) == (2, 1, 1, 0, 0)
    assert env["tally.ele"] == 3 and env["tally.moonsign"] == 0
    # a Moonsign character counts herself, and the option adds the others
    own = {"tally.moonsign": 1, "active.flags.isMoonsign": 1}
    got = kitgen.party_reads("geo", "Zibai", PARTY, {**PARTY["options"][0], "moonsign": 1}, own)
    assert got["tally.moonsign"] == 2 and got["active.flags.isMoonsign"] == 1
    assert kitgen.party_reads("geo", "Zibai", PARTY, PARTY["options"][0], own)["tally.moonsign"] == 1


def test_a_state_an_option_sets_is_set_in_that_option_and_off_in_the_others():
    party = {**PARTY, "options": [
        {"id": "none", "label": "None", "team": []},
        {"id": "ss", "label": "Swirl", "team": [], "states": {"a0StellarRadiance": "ss"}},
    ], "default": "none"}
    assert kitgen.party_reads("anemo", "Vesna", party, party["options"][1])["conditional.Vesna.a0StellarRadiance"] == "ss"
    assert kitgen.party_reads("anemo", "Vesna", party, party["options"][0])["conditional.Vesna.a0StellarRadiance"] == "off"


def test_a_passive_that_counts_the_elements_is_an_effect_for_each_count():
    entry = _build(PARTY)
    held = {e["party"][0]: e["rate"] for e in entry["effects"] if e["to"] == "hp%"}
    assert held == {"two": 0.12, "three": 0.18, "four": 0.3}
    assert all(e["from_ascension"] == 1 and e["party"] is not None for e in entry["effects"])
    assert entry["party"]["default"] == "three" and [o["id"] for o in entry["party"]["options"]] == ["two", "three", "four"]
    assert not any(item["why"] == "depends on the party" for item in entry["left_out"])


def test_an_effect_that_is_the_same_in_every_team_carries_no_party():
    entry = _build(PARTY, effects={"premod": {"hp_": elements_count(), "atk_": gate("asc", 4, c(0.2))}})
    plain = [e for e in entry["effects"] if e["to"] == "atk%"]
    assert len(plain) == 1 and "party" not in plain[0]
    two = [e for e in entry["effects"] if e["to"] == "hp%" and e["rate"] == 0.12]
    assert two[0]["party"] == ["two"]


def test_two_teams_that_give_the_same_number_share_the_effect():
    party = {**PARTY, "options": [*PARTY["options"], {"id": "three-b", "label": "3 others", "team": ["pyro", "hydro", "electro"]}]}
    entry = _build(party)
    three = [e for e in entry["effects"] if e["rate"] == 0.18]
    assert len(three) == 1 and three[0]["party"] == ["three", "three-b"]


def test_a_character_without_a_party_is_read_as_before():
    entry = _build(None)
    assert entry["effects"] == [] and entry["left_out"][0]["why"] == "depends on the party" and "party" not in entry


def test_the_moonsign_terms_of_a_team_with_no_second_moonsign_character_are_nothing():
    # Chasca's Moonsign buff needs two Moonsign characters and the non-stacking slot to name her
    buff = {"op": "match", "x": [r("nonStacking.moonsignascend"), c("Yelan"), gate("tally.moonsign", 2, c(0.36)), c(0)]}
    entry = _build(PARTY, effects={"premod": {"lunarbloom_dmg_": buff}})
    # ...so nothing is counted, but the term is not forgotten: it is listed, with why it is nothing here
    assert entry["effects"] == [] and len(entry["left_out"]) == 1
    assert "tally.moonsign" in entry["left_out"][0]["expr"] and "party" in entry["left_out"][0]["why"]


def test_a_term_that_counts_the_team_is_never_on_the_panel_even_when_every_team_gives_the_same():
    # Zibai's A4: +60 Elemental Mastery for each Hydro member. Both of her teams have two (herself and one more, in this test), so the effect is the same in both and
    # holds no `party`; it is still the team's, and HoYoLAB's panel does not hold it. A plain ascension stat is on the panel.
    tree = gate("asc", 4, {"op": "mul", "x": [r("tally.hydro"), c(60.0)]})
    party = {**PARTY, "options": [{"id": "a", "label": "A", "team": ["hydro", "pyro", "pyro"]},
                                  {"id": "b", "label": "B", "team": ["hydro", "electro", "pyro"]}], "default": "a"}
    entry = _build(party, effects={"premod": {"eleMas": tree, "atk_": gate("asc", 4, c(0.2))}})
    em = [e for e in entry["effects"] if e["to"] == "em"]
    assert len(em) == 1 and em[0]["rate"] == 120.0 and "party" not in em[0] and em[0]["in_stats"] is False
    assert [e["in_stats"] for e in entry["effects"] if e["to"] == "atk%"] == [True]
    assert not any("_derived" in e for e in entry["effects"])


def test_a_party_effect_is_never_marked_as_on_the_panel():
    effects = [{"to": "hp%", "rate": 0.12, "from_ascension": 1, "pieces": None, "party": ["two"]},
               {"to": "hp%", "rate": 0.05, "from_ascension": 1, "pieces": None}]
    kitgen.mark_in_stats(effects, "character")
    assert [e["in_stats"] for e in effects] == [False, True]


def test_the_rows_the_team_decides_are_named_in_her_kit_and_checked_against_her_rows():
    hits = [{"group": "burst", "name": "hydro", "move": "burst", "ele": "hydro", "variant": None,
             "params": [{"talent": "burst", "index": 0, "levels": [1.0]}], "formula": None},
            {"group": "burst", "name": "pyro", "move": "burst", "ele": "pyro", "variant": None,
             "params": [{"talent": "burst", "index": 0, "levels": [1.0]}], "formula": None}]
    rows = {"burst": [{"name": "Iris DMG", "params": [0]}]}
    party = {**PARTY, "options": [{"id": "p", "label": "Pyro", "team": ["pyro"], "elements": ["pyro"]},
                                  {"id": "none", "label": "None", "team": [], "elements": []}],
             "default": "p", "element_rows": {"burst": ["Iris DMG"]}, "only_rows": {"burst": {"Iris DMG": ["p"]}}}
    entry = _build(party, effects={}, hits=hits, rows=rows)
    assert entry["party"]["element_rows"] == {"burst": ["Iris DMG"]}
    assert entry["party"]["only_rows"] == {"burst": {"Iris DMG": ["p"]}}
    assert [o["elements"] for o in entry["party"]["options"]] == [["pyro"], []]
    with pytest.raises(SystemExit, match="Nonesuch"):
        _build({**party, "element_rows": {"burst": ["Nonesuch DMG"]}}, effects={}, hits=hits, rows=rows)


def test_the_schema_allows_a_party_and_an_effect_for_some_teams():
    schema = kitgen.schema()
    character = schema["properties"]["characters"]["additionalProperties"]
    assert "party" in character["properties"] and "party" not in character["required"]
    effect = character["properties"]["effects"]["items"]
    assert "party" in effect["properties"] and "party" not in effect["required"]


def test_a_flag_only_she_can_name_decides_what_would_be_left_to_the_party():
    # Linnea's A4: 5% of DEF as Elemental Mastery, whoever is on the field, once the active character is a Moonsign one (she is)
    term = {"op": "match", "x": [r("active.flags.isMoonsign"), c(0), gate("asc", 4, {"op": "mul", "x": [r("premod.def"), c(0.05)]}), c(0)]}
    effects = {"premod": {"eleMas": term}}

    def build(reads):
        char = {"sheet": "Linnea", "name": "Linnea", "element": "geo", "weapon_type": "polearm", "rows": {}, "params": {}, "hits": []}
        kit = {"characters": {"Linnea": {"effects": effects, "hit_data": {}}}, "weapons": {}, "sets": {}}
        decided = {"about": "", "checked": "", "unsure": {}, "characters": {"linnea": {"reads": reads, "toggles": {}}}}
        return kitgen.build(kit, {"Linnea": char}, decided, "0" * 40, lambda name: name.lower(), lambda *a: "elemental")["characters"]["linnea"]

    assert build({})["effects"] == [] and build({})["left_out"][0]["why"] == "depends on the party"
    held = build({"active.flags.isMoonsign": 0})
    assert held["left_out"] == [] and [(e["to"], e["rate"], e["from"], e["from_ascension"]) for e in held["effects"]] == [("em", 0.05, "def", 4)]
