"""Constellations in the Genshin Optimizer tool (tools/go-reference) and in the kit: a hit GO shows only from a constellation (Yanfei's
Charged Attack with four Scarlet Seals, Yae Miko's Sesshou Sakura Level 4) gives its row a gate in kits.json (`row_gates`), the
kit gives the rows absent at a constellation (`absent_rows`), and the planner's block does not count them there. The comparison adds
the cases at a constellation beside the ones at Constellation 0."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"
KITS = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))


def _load(name: str):
    sys.path.insert(0, str(TOOL))
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kitgen = _load("kitgen")
compare = _load("compare")
talent_rows = _load("talent_rows")
from guildboard.characters import kits, simhits  # noqa: E402

# The cases render each row at its talent level from the GO checkout (talent_rows.GO), a developer's machine's tool folder
# that the public repository's runner does not have.
needs_go = pytest.mark.skipif(not (talent_rows.GO / "libs" / "gi" / "stats").is_dir(),
                              reason="needs the Genshin Optimizer checkout (tools/go-reference/setup.ps1)")


def _gate(op, branch, path, k):
    return {"op": op, "branch": branch, "x": [{"op": "read", "p": path}, {"op": "const", "v": k}]}


def _hit(name, index, gates=(), group="charged", params=None):
    return {"group": group, "name": name, "move": "charged" if group == "charged" else group, "ele": None, "variant": None,
            "ordinary": True, "reacts": True, "gates": list(gates),
            "params": params or [{"talent": "auto", "index": index, "levels": [1.0 + index / 10]}], "formula": None}


def _build(hits, rows, element="pyro"):
    char = {"sheet": "Yanfei", "name": "Yanfei", "element": element, "weapon_type": "catalyst", "rows": rows, "params": {},
            "hits": hits}
    kit = {"characters": {"Yanfei": {"effects": {}, "hit_data": {}}}, "weapons": {}, "sets": {}}
    decided = {"about": "", "checked": "", "unsure": {}, "characters": {}}
    return kitgen.build(kit, {"Yanfei": char}, decided, "0" * 40, lambda name: name.lower(),
                        lambda *a: "elemental")["characters"]["yanfei"]


ROWS = {"auto": [{"row": 0, "name": "1-Hit DMG", "params": [0]},
                 {"row": 3, "name": "Charged Attack", "params": [3, 4, 5, 6, 7]}]}


# ------------------------------------------------------------------------------------------------ kitgen reads the gate


def test_a_hit_shown_only_from_a_constellation_gates_its_row():
    # Yanfei: the fifth Charged Attack (four Scarlet Seals) is GO's `charged.4` behind constellation >= 6
    hits = [_hit("0", 0, group="normal"), *(_hit(str(i), i + 3) for i in range(4)),
            _hit("4", 7, [_gate("threshold", 2, "constellation", 6)])]
    entry = _build(hits, ROWS)
    assert entry["row_gates"] == {"normal": {"Charged Attack (5 of 5)": {"from": 6}}}


def test_a_hit_shown_only_below_a_constellation_gates_its_row_from_above():
    # Yae Miko's Sesshou Sakura Level 1 is GO's `dmg1`, shown below Constellation 2 (the threshold's other branch)
    rows = {"skill": [{"row": 0, "name": "Sesshou Sakura DMG: Level 1", "params": [0]},
                      {"row": 3, "name": "Sesshou Sakura DMG: Level 4", "params": [3]}]}
    hits = [_hit("dmg1", 0, [_gate("threshold", 3, "constellation", 2)], group="skill", params=[{"talent": "skill", "index": 0, "levels": [1.0]}]),
            _hit("dmg4", 3, [_gate("threshold", 2, "constellation", 2)], group="skill", params=[{"talent": "skill", "index": 3, "levels": [2.0]}])]
    entry = _build(hits, rows)
    assert entry["row_gates"] == {"skill": {"Sesshou Sakura DMG: Level 1": {"below": 2},
                                            "Sesshou Sakura DMG: Level 4": {"from": 2}}}


def test_a_gate_that_is_not_a_constellation_gives_no_row_gate():
    hits = [_hit("0", 0, [_gate("threshold", 2, "tally.moonsign", 2)], group="normal"),
            _hit("1", 1, [_gate("threshold", 2, "asc", 1)], group="normal")]
    rows = {"auto": [{"row": 0, "name": "1-Hit DMG", "params": [0]}, {"row": 1, "name": "2-Hit DMG", "params": [1]}]}
    assert "row_gates" not in _build(hits, rows)


def test_a_row_another_hit_deals_at_every_constellation_is_not_gated():
    # a second hit of the same numbers shown from Constellation 6 (the Traveler's third thunder) leaves the row dealt below it
    same = [{"talent": "burst", "index": 1, "levels": [1.0]}]
    hits = [_hit("thunderDmg", 1, group="burst", params=same),
            _hit("thirdThunderDmg", 1, [_gate("threshold", 2, "constellation", 6)], group="burst", params=same)]
    entry = _build(hits, {"burst": [{"row": 1, "name": "Falling Thunder DMG", "params": [1]}]})
    assert "row_gates" not in entry


def test_the_schema_allows_row_gates_and_names_their_shape():
    schema = kitgen.schema()
    character = schema["properties"]["characters"]["additionalProperties"]
    assert "row_gates" in character["properties"] and "row_gates" not in character["required"]


def test_kits_json_gates_yanfeis_five_seal_row_and_yaes_sakura_levels():
    assert KITS["characters"]["yanfei"]["row_gates"] == {"normal": {"Charged Attack (5 of 5)": {"from": 6}}}
    yae = KITS["characters"]["yae-miko"]["row_gates"]["skill"]
    assert yae["Sesshou Sakura DMG: Level 4"] == {"from": 2} and yae["Sesshou Sakura DMG: Level 1"] == {"below": 2}
    # no character without a gate carries the key
    assert all(c.get("row_gates") for c in KITS["characters"].values() if "row_gates" in c)


# ------------------------------------------------------------------------------------------------ the kit and the block


@pytest.mark.parametrize("constellation,absent", [(0, {"normal": ["Charged Attack (5 of 5)"]}),
                                                   (5, {"normal": ["Charged Attack (5 of 5)"]}), (6, {})])
def test_the_kit_gives_the_rows_absent_at_a_constellation(constellation, absent):
    assert kits.kit_of("yanfei", constellation, 6, "", 1, {})["absent_rows"] == absent


def test_a_row_shown_below_a_constellation_is_absent_from_it():
    assert kits.kit_of("yae-miko", 0, 6, "", 1, {})["absent_rows"] == {"skill": ["Sesshou Sakura DMG: Level 4"]}
    assert kits.kit_of("yae-miko", 2, 6, "", 1, {})["absent_rows"] == {"skill": ["Sesshou Sakura DMG: Level 1"]}


def test_a_character_without_gates_or_unknown_has_no_absent_rows():
    assert kits.kit_of("hu-tao", 0, 6, "", 1, {})["absent_rows"] == {}
    assert kits.kit_of("nobody-at-all", 0, 6, "", 1, {})["absent_rows"] == {}


def _block(kit):
    affix = [("1-Hit DMG", "100%"), ("Charged Attack", "160%/188.2%/216.5%/244.7%/272.9%")]
    return simhits.hits_block(
        element="Pyro", weapon_type="Catalyst", level=90, levels={"normal": 10, "skill": 10, "burst": 10},
        raised={"normal": 10, "skill": 10, "burst": 10}, affixes={"normal": affix}, tables={},
        names={t: (t, None) for t in simhits.TALENTS}, kit=kit, recommended=[], weapon_effects={}, set_effects={})


def test_the_block_does_not_count_a_row_absent_at_the_constellation_and_keeps_the_talent_main():
    base = {"checked": True, "main": None, "stellar": None, "unsure": None, "elements": {}, "moves": {}, "infused": [],
            "effects": [], "toggles": [], "hits": {"normal": {"1-Hit DMG": "elemental", "Charged Attack": "elemental"}}}
    absent = _block({**base, "absent_rows": {"normal": ["Charged Attack (5 of 5)"]}})["talents"][0]
    counted = {row["name"]: row["main"] for row in absent["rows"]}
    assert counted["Charged Attack (5 of 5)"] is False and counted["Charged Attack (4 of 5)"] is True
    assert absent["main"] is True
    there = _block({**base, "absent_rows": {}})["talents"][0]
    assert all(row["main"] for row in there["rows"])
    # a kit that gives no `absent_rows` (an older one) counts every row, as before
    assert all(row["main"] for row in _block(base)["talents"][0]["rows"])


def test_a_talent_whose_every_row_is_absent_is_no_main_talent():
    base = {"checked": True, "main": None, "stellar": None, "unsure": None, "elements": {}, "moves": {}, "infused": [],
            "effects": [], "toggles": [], "hits": {}}
    only = simhits.hits_block(
        element="Pyro", weapon_type="Catalyst", level=90, levels={"normal": 10, "skill": 10, "burst": 10},
        raised={"normal": 10, "skill": 10, "burst": 10}, affixes={"normal": [("1-Hit DMG", "100%")]}, tables={},
        names={t: (t, None) for t in simhits.TALENTS}, kit={**base, "absent_rows": {"normal": ["1-Hit DMG"]}}, recommended=[],
        weapon_effects={}, set_effects={})
    assert only["talents"][0]["main"] is False and only["talents"][0]["rows"][0]["main"] is False


# ------------------------------------------------------------------------------------------------ the comparison's constellation cases


def _wanted() -> dict[str, int]:
    """The characters with a case at a constellation: a toggle decided on whose effects need one, a row only one deals, or an effect no
    toggle gates that starts at any constellation (the C0-C2 boundary is gone)."""
    out = {}
    for key, c in KITS["characters"].items():
        on = {t["name"] for t in c["toggles"] if t["on"]}
        need = [e["from_constellation"] for e in c["effects"]
                if e.get("while") in on and all(n in on for n in e.get("also") or ()) and e.get("from_constellation")]
        need += [e["from_constellation"] for e in c["effects"] if not e.get("while") and e.get("from_constellation")]
        need += [g["from"] for rows in (c.get("row_gates") or {}).values() for g in rows.values() if g.get("from")]
        need += [i["from_constellation"] for i in c.get("infused", []) if i.get("from_constellation") and (
            i["while"] in on if i.get("while") else True)]
        if need:
            out[key] = sorted(set(need))
    return out


def test_the_constellation_a_character_is_compared_at_is_the_highest_one_her_decided_states_or_rows_need():
    wanted = _wanted()
    assert {"yanfei", "yae-miko", "mavuika", "keqing", "arlecchino", "wriothesley"} <= set(wanted)
    assert wanted["skirk"] == [2]         # her Constellation 2 state is on: the ATK is her Seven-Phase Flash's, as the planner can tell now
    for key, constellations in wanted.items():
        assert compare.constellations_of(key) == constellations, key
    assert compare.constellations_of("hu-tao") == [2] and compare.constellations_of("odette") == [6]
    # a character is compared at each constellation an effect starts at, not only the highest: a gate read at the wrong start (C4 for C2)
    # agrees at 0 and at 6, where both sides apply every lower effect
    assert compare.constellations_of("sandrone") == [2, 6] and compare.constellations_of("varesa") == [1, 4, 6]
    assert compare.constellations_of("columbina") == [1, 2, 3, 4, 5, 6] and compare.constellations_of("yanfei") == [6]


def test_an_effect_no_state_gates_is_compared_at_the_constellation_it_starts_at_whichever_it_is():
    # Hu Tao's Skill additive (C2): ungated, compared at 2. Sandrone's Crit DMG (C2) is compared at 2 and at 6, where her Constellation 6
    # effects are; Mualani's Burst DMG Bonus (C4) and Odette's Stellar elevation (C6) too: the boundary at Constellation 2 is gone.
    assert {k: compare.constellations_of(k) for k in ("sandrone", "columbina", "hu-tao")} == {
        "sandrone": [2, 6], "columbina": [1, 2, 3, 4, 5, 6], "hu-tao": [2]}
    assert compare.constellations_of("mualani") == [4] and compare.constellations_of("odette") == [6]
    assert not hasattr(compare, "UNGATED_LIMIT") and not hasattr(compare, "ungated_above_limit")


@needs_go
def test_a_constellation_that_gives_crit_also_has_the_circlet_swap_at_0_and_there():
    assert compare.reaches_crit(compare.block("lyney", compare.affixes_of("Lyney"), None, 2))
    assert not compare.reaches_crit(compare.block("yanfei", compare.affixes_of("Yanfei"), None, 6))   # her CRIT Rate state is off
    plan = compare.cases(only=["lyney", "yanfei"])
    by_id = {c["id"]: c for c in plan["cases"]}
    assert {"lyney:circlet", "lyney:circlet@c2"} <= set(by_id) and not any("yanfei:circlet" in i for i in by_id)
    case = by_id["lyney:circlet@c2"]
    assert case["swap"] == "circlet" and case["mains_a"]["circlet"] == "critDMG_" and case["mains_b"]["circlet"] == "critRate_"
    assert {s for s in case["mains_a"] if case["mains_a"][s] != case["mains_b"][s]} == {"circlet"}


@needs_go
def test_a_case_at_a_constellation_has_its_own_id_kit_and_the_constellation_on_both_sides():
    plan = compare.cases(only=["yanfei", "odette"])
    by_id = {c["id"]: c for c in plan["cases"]}
    assert {"yanfei:sands", "yanfei:goblet", "yanfei:sands@c6", "yanfei:goblet@c6", "odette:sands", "odette:goblet",
            "odette:sands@c6", "odette:goblet@c6"} <= set(by_id)
    assert not any(i.endswith("@c0") for i in by_id)
    low, high = by_id["yanfei:sands"], by_id["yanfei:sands@c6"]
    assert low["constellation"] == 0 and low["kit"] == "yanfei"
    assert high["constellation"] == 6 and high["kit"] == "yanfei@c6" and high["character"] == "yanfei"
    # nothing of the build differs but what the constellation changes
    for field in ("weapon", "set", "talents", "mains_a", "mains_b", "a", "b"):
        assert high[field] == low[field], field


@needs_go
def test_the_extra_cases_are_the_sands_and_goblet_swaps_and_the_circlet_one_where_crit_comes_from_a_constellation():
    plan = compare.cases(only=["yanfei"])
    extra = [c for c in plan["cases"] if c["constellation"]]
    assert sorted(c["swap"] for c in extra) == ["goblet", "sands"] and all(c["reaction"] is None for c in extra)


@needs_go
def test_the_states_at_a_constellation_are_the_toggles_that_are_on_there():
    # Mavuika's Flame Form state (Constellation 2) exists only from it: GO is told of it at Constellation 2, not at 0
    plan = compare.cases(only=["mavuika"])
    by_id = {c["id"]: c for c in plan["cases"]}
    assert "c2FlameForm" not in by_id["mavuika:sands"]["conds"].get("Mavuika", {})
    assert by_id["mavuika:sands@c2"]["conds"]["Mavuika"].get("c2FlameForm") == "on"


# ------------------------------------------------------------------------------------------------ one entry, two hits by a constellation


def test_a_display_entry_with_a_hit_in_each_branch_gives_the_lower_hit_its_row_and_gates_it():
    # Nefer's second Phantasm Performance hit: a Lunar-Bloom hit from Constellation 6 (no row prints its multiplier) and, below it, the
    # ordinary hit whose parameters 6 and 7 the "2-Hit DMG (Nefer)" row prints. gb-match names the later branch `<name>~1`.
    nefer = [{"talent": "skill", "index": 6, "levels": [0.5]}, {"talent": "skill", "index": 7, "levels": [1.0]}]
    lunar = {**_hit("nefer2Dmg", 0, [_gate("threshold", 2, "constellation", 6)], group="skill", params=[]), "variant": "lunarbloom", "ordinary": False}
    plain = _hit("nefer2Dmg~1", 0, [_gate("threshold", 3, "constellation", 6)], group="skill", params=nefer)
    plain["shown"] = "skill.nefer2Dmg"
    rows = {"skill": [{"row": 6, "name": "Phantasm 2-Hit DMG (Nefer)", "params": [6, 7]}]}
    entry = _build([lunar, plain], rows)
    assert entry["hits"] == {"skill": {"Phantasm 2-Hit DMG (Nefer)": "elemental"}}
    assert entry["row_gates"] == {"skill": {"Phantasm 2-Hit DMG (Nefer)": {"below": 6}}}
    assert [item["what"] for item in entry["left_out"] if item["why"] == "no talent row prints its multiplier"] == ["hit skill.nefer2Dmg"]


def test_the_name_of_a_hit_in_a_later_branch_is_told_to_gos_entry_that_evaluates_it():
    assert compare.evaluated("skill.nefer2Dmg~1") == "skill.nefer2Dmg" and compare.evaluated("skill.skillDmg") == "skill.skillDmg"
