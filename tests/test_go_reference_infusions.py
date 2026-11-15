"""A character's own infusion in the Genshin Optimizer tool (tools/go-reference) and the kit: an infusion behind her ascension or a
constellation (Chiori's A1, Dori's C6) keeps its gate, one a hit's own element decides (Aloy's Rushing Ice, Yoimiya's Niwabi
Fire-Dance) is an infusion of that hit's move, a state that adds a talent's level-scaled multiplier (Yoimiya's) is a `mult` effect, an
infusion only one team shape has holds that shape, and the kit gives only the infusions that hold at the player's constellation and
ascension."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"


def _load(name: str):
    if name in sys.modules and getattr(sys.modules[name], "__file__", None) == str(TOOL / f"{name}.py"):
        return sys.modules[name]   # the module another test file loaded: a second copy would make their patches miss it
    sys.path.insert(0, str(TOOL))
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kitgen = _load("kitgen")
compare = _load("compare")
from guildboard.characters import kits  # noqa: E402


def c(v=None):
    return {"op": "const", "v": v}


def r(p):
    return {"op": "read", "p": p}


def match(a, b, yes, no=None):
    return {"op": "match", "x": [a, b, yes, c(no)]}


def threshold(path, k, yes):
    return {"op": "threshold", "x": [r(path), c(k), yes, c()]}


def name_of(path: str) -> str:
    return path.split(".", 2)[2]


MOVES = ["normal", "charged", "plunging"]


# ------------------------------------------------------------------------------------------------ the gates of an infusion


def test_an_infusion_behind_her_ascension_and_a_state_keeps_both():
    # Chiori's A1: asc >= 1 ? (a1Infusion == on ? "geo" : null) : null
    tree = {"overridableSelf": threshold("asc", 1, match(r("conditional.Chiori.a1Infusion"), c("on"), c("geo")))}
    found = kitgen.Found()
    out = kitgen.infusions({"infusion": tree}, {}, found, {"conditional.Chiori.a1Infusion": "on"}, name_of)
    assert out == [{"talents": MOVES, "element": "geo", "while": "a1Infusion", "from_ascension": 1}]
    assert found.left_out == [] and "conditional.Chiori.a1Infusion" in found.toggles


def test_an_infusion_behind_a_constellation_keeps_its_constellation():
    # Dori's C6
    tree = {"overridableSelf": threshold("constellation", 6, match(r("conditional.Dori.c6AfterSkill"), c("on"), c("electro")))}
    out = kitgen.infusions({"infusion": tree}, {}, kitgen.Found(), {"conditional.Dori.c6AfterSkill": "on"}, name_of)
    assert out == [{"talents": MOVES, "element": "electro", "while": "c6AfterSkill", "from_constellation": 6}]


def test_an_ungated_infusion_has_no_gate_keys_and_an_infusion_of_no_value_is_none():
    tree = {"nonOverridableSelf": match(r("conditional.Kaveh.afterBurst"), c("on"), c("dendro"))}
    out = kitgen.infusions({"infusion": tree}, {}, kitgen.Found(), {"conditional.Kaveh.afterBurst": "on"}, name_of)
    assert out == [{"talents": MOVES, "element": "dendro", "while": "afterBurst"}]
    never = {"overridableSelf": threshold("asc", 1, c())}
    found = kitgen.Found()
    assert kitgen.infusions({"infusion": never}, {}, found, {}, name_of) == [] and found.left_out == []


def test_an_infusion_that_reads_more_than_the_engine_is_left_out_with_the_reason():
    tree = {"overridableSelf": {"op": "add", "x": [r("premod.atk"), c(1)]}}
    found = kitgen.Found()
    assert kitgen.infusions({"infusion": tree}, {}, found, {}, name_of) == []
    assert [item["why"] for item in found.left_out] == ["an infusion the engine does not read"]


def test_the_team_shapes_infusions_merge_with_the_shapes_that_have_each():
    # the Traveler (Cryo)'s A1 is read for the Stellar-Conduct shape only
    sc = {"talents": MOVES, "element": "cryo", "while": "a1ScStar", "from_ascension": 1}
    runs = [({"id": "none"}, kitgen.Found(), []), ({"id": "sc"}, kitgen.Found(), [sc]), ({"id": "ss"}, kitgen.Found(), [])]
    _, infused = kitgen.merge_options(runs)
    assert infused == [{**sc, "party": ["sc"]}]
    same = [({"id": "a"}, kitgen.Found(), [sc]), ({"id": "b"}, kitgen.Found(), [sc])]
    assert kitgen.merge_options(same)[1] == [sc]


# ------------------------------------------------------------------------------------------------ an element a hit's state decides


def _hit(name, group="normal", move="normal", ele_tree=None):
    return {"group": group, "name": name, "move": move, "ele": None, "ele_tree": ele_tree}


def test_hits_whose_element_a_state_decides_are_one_infusion_of_their_move():
    # Aloy's Rushing Ice: compareEq("rush", coil, "cryo", "physical") on her five Normal Attack hits
    tree = match(c("rush"), r("conditional.Aloy.coil"), c("cryo"), "physical")
    hits = [_hit(str(i), ele_tree=tree) for i in range(5)] + [
        _hit("aimed", "charged", "charged", {"op": "prio", "x": [r("hit.move"), c()]}), _hit("aimedCharged", "charged", "charged")]
    found = kitgen.Found()
    out = kitgen.hit_infusions({"hits": hits}, {}, found, {"conditional.Aloy.coil": "rush"}, name_of)
    assert out == [{"talents": ["normal"], "element": "cryo", "while": "coil"}]
    assert found.left_out == [] and found.toggles["conditional.Aloy.coil"]["chosen"] == "rush"


def test_a_hit_that_stays_physical_in_the_state_decided_is_no_infusion():
    tree = match(c("rush"), r("conditional.Aloy.coil"), c("cryo"), "physical")
    assert kitgen.hit_infusions({"hits": [_hit("0", ele_tree=tree)]}, {}, kitgen.Found(), {"conditional.Aloy.coil": "coil1"}, name_of) == []


def test_a_hit_of_a_passive_or_a_burst_that_reads_a_state_is_no_infusion():
    # Venti's and Kazuha's absorption: the element a state names, on a burst's hit
    tree = r("conditional.Venti.burstAbsorption")
    hits = [_hit("absorb", "burst", "burst", tree), _hit("absorb", "passive1", "plunging_impact", tree)]
    assert kitgen.hit_infusions({"hits": hits}, {}, kitgen.Found(), {"conditional.Venti.burstAbsorption": "pyro"}, name_of) == []


def test_moves_of_hits_with_the_same_state_are_listed_in_the_engines_order():
    tree = match(r("conditional.X.s"), c("on"), c("pyro"), "physical")
    hits = [_hit("p", "plunging", "plunging_collision", tree), _hit("0", ele_tree=tree), _hit("c", "charged", "charged", tree)]
    out = kitgen.hit_infusions({"hits": hits}, {}, kitgen.Found(), {"conditional.X.s": "on"}, name_of)
    assert out == [{"talents": ["normal", "charged", "plunging"], "element": "pyro", "while": "s"}]


# ------------------------------------------------------------------------------------------------ a talent-level multiplier a state gives


def test_a_multiplier_listed_by_talent_level_reads_as_the_part_over_one():
    # Yoimiya's Niwabi Fire-Dance: the Normal Attack's damage is x1.379.. at Skill level 1: a bonus of 0.379..
    node = match(r("conditional.Yoimiya.skill"), c("skill"), {"op": "subscript", "list": [1.37909, 1.40179], "x": [r("total.skillIndex")]}, 1)
    node["x"][3] = c(1)
    minus = kitgen._minus_one(node)
    assert minus["x"][2]["list"] == [1.37909 - 1, 1.40179 - 1] and minus["x"][3] == c(0.0)
    assert minus["x"][2]["was"] == [1.37909, 1.40179]


def test_that_multiplier_finds_the_row_that_prints_it_and_becomes_a_mult_effect():
    ctx = kitgen.Context(params={"skill": [[1.37909, 1.40179]]}, rows={"skill": [{"name": "Normal Attack DMG Bonus", "params": [0]}]})
    node = match(r("conditional.Yoimiya.skill"), c("skill"), {"op": "subscript", "list": [1.37909, 1.40179], "x": [r("total.skillIndex")]}, 1)
    node["x"][3] = c(1)
    found = kitgen.Found()
    kitgen._add(kitgen.normalise(kitgen._minus_one(node)), ("mult", None), ctx, found, {"conditional.Yoimiya.skill": "skill"}, name_of, None,
                "hit normal.0 multiplier")
    [effect] = found.effects
    assert effect["to"] == "mult" and effect["while"] == "skill"
    assert effect["rate"] == [round(1.37909 - 1, 10), round(1.40179 - 1, 10)]
    assert effect["row"] == {"talent": "skill", "name": "Normal Attack DMG Bonus"}


# ------------------------------------------------------------------------------------------------ the kit at her constellation


def _kits(monkeypatch, infused):
    data = {"characters": {"x": {"checked": True, "main": None, "stellar": None, "weapon_type": "sword", "hits": {}, "elements": {},
                                  "moves": {}, "infused": infused, "effects": [], "toggles": [
                                      {"name": "t", "label": "T", "on": False, "covers": [], "state": "on"},
                                      {"name": "u", "label": "U", "on": False, "covers": [], "state": "on"}]}},
            "weapons": {}, "sets": {}}
    monkeypatch.setattr(kits, "load_kits", lambda: data)


def test_the_kit_gives_an_infusion_only_where_her_ascension_and_constellation_hold(monkeypatch):
    _kits(monkeypatch, [
        {"talents": MOVES, "element": "geo", "while": "t", "from_ascension": 1},
        {"talents": MOVES, "element": "electro", "while": "u", "from_constellation": 6},
        {"talents": ["normal"], "element": "pyro", "while": None}])
    low = kits.kit_of("x", 0, 0, "", 1, {})
    assert low["infused"] == [{"talents": ["normal"], "element": "pyro", "while": None}] and low["toggles"] == []
    a1 = kits.kit_of("x", 0, 1, "", 1, {})
    assert [i["element"] for i in a1["infused"]] == ["geo", "pyro"] and [t["name"] for t in a1["toggles"]] == ["t"]
    c6 = kits.kit_of("x", 6, 6, "", 1, {})
    assert [i["element"] for i in c6["infused"]] == ["geo", "electro", "pyro"] and [t["name"] for t in c6["toggles"]] == ["t", "u"]
    assert all(set(i) <= {"talents", "element", "while", "party"} for i in c6["infused"])   # the gates are checked here, not shipped


def test_the_kit_copy_of_an_infusion_never_changes_the_file(monkeypatch):
    _kits(monkeypatch, [{"talents": MOVES, "element": "geo", "while": "t", "from_ascension": 1}])
    kits.kit_of("x", 0, 6, "", 1, {})["infused"][0]["element"] = "changed"
    assert kits.kit_of("x", 0, 6, "", 1, {})["infused"][0]["element"] == "geo"
    assert "from_ascension" in kits.load_kits()["characters"]["x"]["infused"][0]


# ------------------------------------------------------------------------------------------------ the comparison


def test_a_character_whose_decided_infusion_needs_a_constellation_is_compared_at_it(monkeypatch):
    data = {"characters": {"x": {"effects": [], "toggles": [{"name": "t", "on": True}, {"name": "u", "on": False}],
                                  "infused": [{"talents": MOVES, "element": "electro", "while": "t", "from_constellation": 6},
                                              {"talents": MOVES, "element": "geo", "while": "u", "from_constellation": 6}]}}}
    monkeypatch.setattr(compare.kits, "load_kits", lambda: data)
    assert compare.constellation_of("x") == 6
    data["characters"]["x"]["toggles"][0]["on"] = False
    assert compare.constellation_of("x") is None
    data["characters"]["x"]["infused"][1] = {"talents": MOVES, "element": "geo", "while": None, "from_constellation": 2}
    assert compare.constellation_of("x") == 2


def test_an_extraction_without_ele_tree_stops_the_build_instead_of_reading_no_infusion(tmp_path):
    import json

    import pytest
    run = _load("run")
    (tmp_path / "gb-kit.json").write_text("{}", encoding="utf-8")
    hit = {"group": "normal", "name": "0", "move": "normal", "ele": None}
    (tmp_path / "gb-match.json").write_text(json.dumps({"Aloy": {"hits": [hit]}}), encoding="utf-8")
    with pytest.raises(SystemExit, match="ele_tree"):
        run.make_kits(tmp_path, "0" * 40, {"characters": {}})
    (tmp_path / "gb-match.json").write_text(json.dumps({"Aloy": {"hits": [{**hit, "ele_tree": None}]}}), encoding="utf-8")
    with pytest.raises(KeyError):   # past the check: the extraction is read (this one is not a whole character)
        run.make_kits(tmp_path, "0" * 40, {"characters": {}})
