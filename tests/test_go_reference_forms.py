"""The forms of a term that reaches a main talent which the Genshin Optimizer tool (tools/go-reference) reads for the engine, one section each:
a factor of a second stat (Kokomi's Healing Bonus) and a count that changes with a constellation (Odette's A1), a state that adds to a
hit's multiplier by stacks (Eula's Lightfall Sword, Raiden's Resolve), a term only some hits of a row have, and a bonus to the ground
impact of a plunge."""
from __future__ import annotations

import importlib.util
import json
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
FIXTURE = json.loads((ROOT / "web" / "src" / "fixtures" / "compare-cases.json").read_text(encoding="utf-8"))
KITS = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))["characters"]


def agrees(case: dict) -> bool:
    """Our engine's change and Genshin Optimizer's agree within the fixture's tolerance for every main talent (compare.agreement's rule)."""
    ours, theirs = case["ours"]["talents"], case["go"]["talents"]
    return bool(ours) and set(ours) == set(theirs) and all(
        (ours[t] is None) == (theirs[t] is None) and (ours[t] is None or abs(ours[t] - theirs[t]) <= FIXTURE["tolerance"]) for t in ours)


def c(v=None):
    return {"op": "const", "v": v}


def r(p):
    return {"op": "read", "p": p}


def mul(*x):
    return {"op": "mul", "x": list(x)}


def add(*x):
    return {"op": "add", "x": list(x)}


def threshold(path, k, yes, no=0):
    return {"op": "threshold", "x": [r(path), c(k), yes, c(no)]}


def name_of(path: str) -> str:
    return path.split(".", 2)[2]


def effects_of(character: str, to: str) -> list[dict]:
    return [e for e in KITS[character]["effects"] if e["to"] == to]


# ------------------------------------------------------------------------------------------------ a factor of a second stat


def test_a_stat_times_the_healing_bonus_is_an_effect_that_multiplies_by_it():
    # Kokomi's A4: asc >= 4 ? premod.hp x premod.heal_ x 0.15 : 0, added to her Normal Attack's base damage
    got = kitgen.linear(threshold("asc", 4, mul(r("premod.hp"), r("premod.heal_"), c(0.15))), kitgen.Context())
    assert (got["from"], got["reads"], got["rate"], got["from_ascension"]) == ("hp", "premod", 0.15, 4)
    assert got["times"] == "heal"


def test_a_second_stat_the_engine_does_not_read_is_still_left_out_with_the_reason():
    import pytest
    for node in (mul(r("premod.hp"), r("premod.eleMas")), mul(r("premod.hp"), r("premod.heal_"), r("premod.heal_"))):
        with pytest.raises(kitgen.NotLinear):
            kitgen.linear(node, kitgen.Context())
    # her stat read before the conversions and the Healing Bonus after them are not one reading
    with pytest.raises(kitgen.NotLinear, match="premod"):
        kitgen.linear(mul(r("premod.hp"), r("total.heal_")), kitgen.Context())


def test_an_effect_that_multiplies_by_a_second_stat_has_it_in_the_effect_only_then():
    got = kitgen.effect(kitgen.linear(mul(r("premod.hp"), r("premod.heal_"), c(0.15)), kitgen.Context()), "additive:normal", None, None, None)
    assert got["times"] == "heal"
    plain = kitgen.effect(kitgen.linear(mul(r("premod.hp"), c(0.15)), kitgen.Context()), "additive:normal", None, None, None)
    assert "times" not in plain and set(plain) == set(kitgen.EFFECT_KEYS)


def test_kokomis_normal_and_charged_attacks_read_her_healing_bonus():
    for to in ("additive:normal", "additive:charged"):
        [effect] = [e for e in effects_of("sangonomiya-kokomi", to) if e.get("times")]
        assert (effect["from"], effect["reads"], effect["rate"], effect["times"], effect["from_ascension"]) == ("hp", "premod", 0.15, "heal", 4)
    left = [item["why"] for item in KITS["sangonomiya-kokomi"]["left_out"]]
    assert not any("factor the engine does not read" in why for why in left)


def test_kokomi_agrees_with_genshin_optimizer_and_is_no_longer_unsure():
    # her cases disagreed (Normal and Charged Attack, with the Healing Bonus term left out) and her verdict gave "It depends"
    assert KITS["sangonomiya-kokomi"]["unsure"] is None
    cases = [case for case in FIXTURE["cases"] if case["character"] == "sangonomiya-kokomi"]
    assert {case["swap"] for case in cases} == {"sands", "goblet"}
    assert all(agrees(case) for case in cases)


# ------------------------------------------------------------------------------------------------ a count a constellation changes


def test_a_count_a_constellation_changes_becomes_a_step_for_each_constellation_it_changes_at():
    # Odette's A1: 0.15 for each of (c >= 6 ? 6 : c >= 1 ? 6 - 6 : 4): 4 below Constellation 1, none from 1, 6 from 6
    count = {"op": "threshold", "x": [r("constellation"), c(6), c(6), add(threshold("constellation", 1, c(2.0)), threshold("constellation", 1, c(-6.0)), c(4.0))]}
    steps = kitgen.constellation_steps(count)
    assert steps == [(0, 4.0), (1, -4.0), (6, 6.0)]


def test_a_factor_that_reads_anything_but_her_constellation_has_no_steps():
    assert kitgen.constellation_steps(add(r("premod.hp"), c(1))) is None
    assert kitgen.constellation_steps(r("conditional.X.y")) is None


def test_odettes_a1_count_is_a_step_at_each_constellation_behind_her_state():
    # (asc >= 1) 0.15 for each of 4 below Constellation 1, 0 from 1 and 6 from 6, on her Stellar-Conduct and Stellar Swirl DMG: Reaction bonus
    for kind in ("stellar-conduct", "stellar-swirl"):
        steps = sorted((e["from_constellation"] or 0, e["rate"]) for e in effects_of("odette", f"bonus:{kind}")
                       if e["while"] == "a1TeamSplendor")
        assert steps == [(0, 0.6), (1, -0.6), (6, 0.9)], kind
    atk = sorted((e["from_constellation"], e["rate"]) for e in effects_of("odette", "atk%") if e["while"] == "a1TeamSplendor")
    assert atk == [(2, -0.28), (2, 0.28), (6, 0.42)]
    toggle = next(t for t in KITS["odette"]["toggles"] if t["name"] == "a1TeamSplendor")
    assert toggle["on"] is False and not any("factor" in item["why"] for item in KITS["odette"]["left_out"])


# ------------------------------------------------------------------------------------------------ a state that adds to a multiplier by stacks


def subscript(values, index="total.burstIndex"):
    return {"op": "subscript", "list": values, "x": [r(index)]}


def lookup(path, table):
    return {"op": "lookup", "x": [r(path), c(0)], "table": {str(k): c(v) for k, v in table.items()}}


# SHAPE-ONLY INPUT: Eula's Lightfall Sword is (base + per stack x stacks) x ATK, the lists cut to two talent levels
EULA_BASE, EULA_PER = [3.67048, 3.96924], [0.74992, 0.81096]
EULA_HIT = mul(add(subscript(EULA_BASE), mul(subscript(EULA_PER), lookup("conditional.Eula.LightfallSword", {1: 1, 2: 2, 30: 30}))), r("total.atk"))


def test_the_parts_a_state_adds_per_stack_are_found_in_a_hits_formula():
    [part] = kitgen.stack_parts(EULA_HIT)
    assert part["base"] == EULA_BASE and part["per"] == EULA_PER
    assert kitgen.show(part["count"]).startswith("lookup(conditional.Eula.LightfallSword")
    assert kitgen.stack_parts(mul(subscript(EULA_BASE), r("total.atk"))) == []


def test_stacks_become_a_mult_effect_per_talent_level_that_is_the_stack_part_over_the_base():
    # base 367.0% and 75.0% per stack at Burst level 1: 30 stacks add 30 x 0.74992 / 3.67048 of the base
    ctx = kitgen.Context(params={"burst": [None, EULA_BASE, EULA_PER]}, rows={"burst": [{"name": "Lightfall Sword Base DMG", "params": [1]}]})
    hit = {"group": "burst", "name": "lightFallSwordNew", "formula": EULA_HIT, "params": [{"talent": "burst", "index": 1, "levels": EULA_BASE}]}
    per_hit: dict = {}
    kitgen.stack_multipliers({"hits": [hit]}, {"burst.lightFallSwordNew": [("burst", "Lightfall Sword Base DMG")]}, {}, ctx, per_hit,
                             {"conditional.Eula.LightfallSword": "30"}, name_of)
    [effect] = per_hit["burst.lightFallSwordNew"].effects
    assert effect["to"] == "mult" and effect["while"] == "LightfallSword" and effect["row"] == {"talent": "burst", "name": "Lightfall Sword Base DMG"}
    assert effect["rate"] == [round(30 * p / b, 10) for p, b in zip(EULA_PER, EULA_BASE)]
    assert per_hit["burst.lightFallSwordNew"].toggles["conditional.Eula.LightfallSword"]["chosen"] == "30"


def test_a_row_of_several_hits_adds_their_stack_parts_over_the_sum_of_their_bases():
    # Raiden's 4-Hit DMG prints two hits (0.30888 + 0.30976 at level 1), each with the same stack part
    base_a, base_b, per = [0.30888, 0.32994], [0.30976, 0.33088], [0.007262, 0.007806]
    count = lookup("conditional.RaidenShogun.burstResolve", {10: 10, 60: 60})
    hit = lambda name, base: {"group": "burst", "name": name, "params": [], "formula": mul(add(subscript(base), mul(subscript(per), count)), r("total.atk"))}  # noqa: E731
    ctx = kitgen.Context(params={"burst": [base_a, base_b]}, rows={"burst": [{"name": "4-Hit DMG", "params": [0, 1]}]})
    rows = {"burst.hit41": [("burst", "4-Hit DMG")], "burst.hit42": [("burst", "4-Hit DMG")]}
    per_hit: dict = {}
    kitgen.stack_multipliers({"hits": [hit("hit41", base_a), hit("hit42", base_b)]}, rows, {}, ctx, per_hit,
                             {"conditional.RaidenShogun.burstResolve": "60"}, name_of)
    first, second = (per_hit[f"burst.{n}"].effects for n in ("hit41", "hit42"))
    assert first == second and len(first) == 1
    assert first[0]["rate"] == [round(60 * 2 * p / (a + b), 10) for p, a, b in zip(per, base_a, base_b)]


def test_a_row_only_some_of_whose_hits_have_stacks_is_left_out_with_the_reason():
    count = lookup("conditional.X.s", {1: 1})
    plain = {"group": "burst", "name": "a", "params": [], "formula": mul(subscript(EULA_BASE), r("total.atk"))}
    stacked = {"group": "burst", "name": "b", "params": [], "formula": mul(add(subscript(EULA_BASE), mul(subscript(EULA_PER), count)), r("total.atk"))}
    rows = {"burst.a": [("burst", "Row")], "burst.b": [("burst", "Row")]}
    per_hit: dict = {}
    kitgen.stack_multipliers({"hits": [plain, stacked]}, rows, {}, kitgen.Context(params={"burst": [EULA_BASE]}, rows={"burst": [{"name": "Row", "params": [0]}]}),
                             per_hit, {"conditional.X.s": "1"}, name_of)
    assert all(not found.effects for found in per_hit.values())
    assert [item["why"] for found in per_hit.values() for item in found.left_out] == [
        "a state adds to the talent's multiplier (stacks), but only some of the hits this row prints have it"]


def test_eulas_lightfall_sword_and_raidens_resolve_are_read_as_stacks_behind_a_state():
    for key, name, row in (("eula", "LightfallSword", "Lightfall Sword Base DMG"), ("raiden-shogun", "burstResolve", "1-Hit DMG")):
        mults = [e for e in KITS[key]["effects"] if e["to"] == "mult" and e["while"] == name]
        assert any(row in (e["hits"] or []) for e in mults), key
        assert all(isinstance(e["rate"], list) and len(e["rate"]) == 15 and e["row"]["talent"] == "burst" for e in mults), key
        assert not any("stacks" in item["why"] for item in KITS[key]["left_out"]), key


# ------------------------------------------------------------------------------------------------ rows of two talents with one name


def _found(*effects):
    found = kitgen.Found()
    found.effects = [kitgen.effect({"from": None, "rate": rate, "reads": None}, to, None, None, None) for to, rate in effects]
    return found


def test_an_effect_on_the_rows_of_one_talent_that_another_talent_names_alike_holds_that_talent_only():
    # Skirk's Normal Attack and her Skill both have a "1-Hit DMG"; GO's -70% ATK is on her Normal Attack's hit only
    per_hit = {"normal.0": _found(("atk%", -0.7)), "skill.0": _found()}
    rows = {"normal.0": [("normal", "1-Hit DMG")], "skill.0": [("skill", "1-Hit DMG")]}
    found = kitgen.Found()
    kitgen.merge_per_hit(per_hit, rows, found, {"1-Hit DMG": {"normal", "skill"}})
    [effect] = found.effects
    assert (effect["to"], effect["hits"], effect["in_talent"]) == ("atk%", ["1-Hit DMG"], "normal")
    assert found.left_out == []


def test_an_effect_on_the_rows_of_both_talents_is_one_effect_for_both():
    per_hit = {"normal.0": _found(("atk%", -0.7)), "skill.0": _found(("atk%", -0.7))}
    rows = {"normal.0": [("normal", "1-Hit DMG")], "skill.0": [("skill", "1-Hit DMG")]}
    found = kitgen.Found()
    kitgen.merge_per_hit(per_hit, rows, found, {"1-Hit DMG": {"normal", "skill"}})
    [effect] = found.effects
    assert effect["hits"] == ["1-Hit DMG"] and "in_talent" not in effect


def test_an_effect_on_a_name_no_other_talent_has_keeps_no_talent():
    per_hit = {"normal.0": _found(("atk%", -0.7))}
    found = kitgen.Found()
    kitgen.merge_per_hit(per_hit, {"normal.0": [("normal", "1-Hit DMG")]}, found, {"1-Hit DMG": {"normal"}})
    assert "in_talent" not in found.effects[0]


def test_a_row_printed_by_two_hits_of_which_one_has_the_effect_is_still_left_out():
    per_hit = {"a": _found(("dmg", 0.5)), "b": _found()}
    rows = {"a": [("skill", "Row")], "b": [("skill", "Row")]}
    found = kitgen.Found()
    kitgen.merge_per_hit(per_hit, rows, found, {"Row": {"skill"}})
    assert found.effects == [] and [item["why"] for item in found.left_out] == ["only some of the hits this row prints have it"]


def test_skirks_c2_atk_loss_is_her_normal_attacks_and_a_row_name_two_talents_share_is_scoped():
    # +70% ATK for her, -70% on her Normal Attack's hits and her Burst's: her Seven-Phase Flash (the Skill's rows) keeps it
    losses = [e for e in KITS["skirk"]["effects"] if e["to"] == "atk%" and e["rate"] == -0.7 and e["while"] == "c2AfterBurst"]
    scoped = [e for e in losses if e.get("in_talent")]
    assert [e["in_talent"] for e in scoped] == ["normal"] and {"1-Hit DMG", "Charged Attack DMG", "Plunge DMG"} <= set(scoped[0]["hits"])
    assert [e["hits"] for e in losses if not e.get("in_talent")] == [["Final Slash DMG", "Slash DMG"]]   # names only her Burst has
    assert not any("only some of the hits" in item["why"] for item in KITS["skirk"]["left_out"])
    toggle = next(t for t in KITS["skirk"]["toggles"] if t["name"] == "c2AfterBurst")
    assert toggle["on"] is True


def test_skirks_c2_is_compared_at_constellation_2_and_agrees():
    compare_cases = [case for case in FIXTURE["cases"] if case["character"] == "skirk" and case.get("constellation") == 2]
    assert {case["swap"] for case in compare_cases} == {"sands", "goblet"}
    assert all(agrees(case) for case in compare_cases)
    assert all(case["kit"] == "skirk@c2" for case in compare_cases)



def test_a_low_high_row_counts_its_first_hit_only_and_other_alternatives_must_share_one_ratio():
    # the planner takes the low plunge of "Low/High Plunge DMG" alone, so its stack part is the low hit's (Raiden's plunge)
    per = [0.007262, 0.007806]
    count = lookup("conditional.RaidenShogun.burstResolve", {60: 60})
    low, high = [1.278377, 1.382431], [1.596762, 1.726731]
    hit = lambda name, base, index: {"group": "burst", "name": name, "params": [{"talent": "burst", "index": index, "levels": base}],  # noqa: E731
                                     "formula": mul(add(subscript(base), mul(subscript(per), count)), r("total.atk"))}
    hits = [hit("plungeLow", low, 14), hit("plungeHigh", high, 15)]
    rows = {"burst.plungeLow": [("burst", "Low/High Plunge DMG")], "burst.plungeHigh": [("burst", "Low/High Plunge DMG")]}
    ctx = kitgen.Context(params={"burst": []}, rows={"burst": [{"name": "Low/High Plunge DMG", "enc": "{{14, percent}}%/{{15, percent}}%", "params": [14, 15]}]})
    per_hit: dict = {}
    kitgen.stack_multipliers({"hits": hits}, rows, {}, ctx, per_hit, {"conditional.RaidenShogun.burstResolve": "60"}, name_of)
    got = {key: found.effects for key, found in per_hit.items()}
    assert got["burst.plungeLow"] == got["burst.plungeHigh"] and len(got["burst.plungeLow"]) == 1
    assert got["burst.plungeLow"][0]["rate"] == [round(60 * p / b, 10) for p, b in zip(per, low)]
    # another slash row, its alternatives at different parts of their bases, is left out: the planner counts each alternative as a row
    ctx.rows["burst"][0] = {"name": "A/B DMG", "enc": "{{14, percent}}%/{{15, percent}}%", "params": [14, 15]}
    rows = {"burst.plungeLow": [("burst", "A/B DMG")], "burst.plungeHigh": [("burst", "A/B DMG")]}
    per_hit = {}
    kitgen.stack_multipliers({"hits": hits}, rows, {}, ctx, per_hit, {"conditional.RaidenShogun.burstResolve": "60"}, name_of)
    assert all(not found.effects for found in per_hit.values())
    assert {item["why"] for found in per_hit.values() for item in found.left_out} == {
        "a state adds to the talent's multiplier (stacks), to the alternatives of a row, which the planner counts as rows of their own"}


# ------------------------------------------------------------------------------------------------ hits that print each other's rows


def _hit(name, *params, group="skill"):
    return {"group": group, "name": name, "params": [{"talent": "skill", "index": i, "levels": [1.0]} for i in params]}


def test_hits_with_the_same_numbers_print_only_the_rows_of_their_own_parameter():
    # the Traveler (Hydro)'s Dewdrop and Spiritbreath Thorn hits both list parameters 0 and 2: the first is Dewdrop's, the second the Thorn's
    char = {"hits": [_hit("dewdropDmg", 0, 2), _hit("thornDmg", 0, 2), _hit("surgeDmg", 1)],
            "rows": {"skill": [{"name": "Dewdrop DMG", "params": [0]}, {"name": "Torrent Surge DMG", "params": [1]},
                               {"name": "Spiritbreath Thorn DMG", "params": [2]}]},
            "params": {"skill": [[1.0], [1.0], [1.0]]}}
    rows = {"skill.dewdropDmg": [("skill", "Dewdrop DMG"), ("skill", "Spiritbreath Thorn DMG")],
            "skill.thornDmg": [("skill", "Dewdrop DMG"), ("skill", "Spiritbreath Thorn DMG")],
            "skill.surgeDmg": [("skill", "Torrent Surge DMG")]}
    assert kitgen.tie_rows(char, rows) == {
        "skill.dewdropDmg": [("skill", "Dewdrop DMG")], "skill.thornDmg": [("skill", "Spiritbreath Thorn DMG")],
        "skill.surgeDmg": [("skill", "Torrent Surge DMG")]}


def test_a_hit_none_of_whose_own_parameters_a_row_prints_keeps_the_rows_it_had():
    char = {"hits": [_hit("a", 5)], "rows": {"skill": [{"name": "Row", "params": [0]}]}, "params": {"skill": [[1.0]]}}
    assert kitgen.tie_rows(char, {"skill.a": [("skill", "Row")]}) == {"skill.a": [("skill", "Row")]}


def test_the_traveler_hydros_dewdrop_bonus_is_the_dewdrop_rows_alone():
    [effect] = [e for e in KITS["traveler-hydro"]["effects"] if e["to"] == "additive:skill" and isinstance(e["rate"], list)]
    assert effect["hits"] == ["Dewdrop DMG"] and effect["from"] == "hp" and effect["while"] == "suffusion"
    left = [item["what"] for item in KITS["traveler-hydro"]["left_out"] if "only some of the hits" in item["why"]]
    assert left == []


# ------------------------------------------------------------------------------------------------ one alternative of a row


def test_an_effect_on_one_alternative_of_a_slash_row_names_that_alternative():
    # Nilou's "Luminous Illusion/Water Wheel DMG": Constellation 1's +65% Skill DMG is the Luminous Illusion's (the first alternative)
    char = {"hits": [_hit("moonDmg", 3), _hit("wheelDmg", 4)],
            "rows": {"skill": [{"name": "Luminous Illusion/Water Wheel DMG", "enc": "{{3, percent}}%/{{4, percent}}%", "params": [3, 4]}]},
            "params": {"skill": [[1.0]] * 5}}
    rows = {"skill.moonDmg": [("skill", "Luminous Illusion/Water Wheel DMG")], "skill.wheelDmg": [("skill", "Luminous Illusion/Water Wheel DMG")]}
    shown = kitgen.alternative_rows(char, rows)
    assert shown == {"skill.moonDmg": [("skill", "Luminous Illusion/Water Wheel DMG (1 of 2)")],
                     "skill.wheelDmg": [("skill", "Luminous Illusion/Water Wheel DMG (2 of 2)")]}
    found = kitgen.Found()
    kitgen.merge_per_hit({"skill.moonDmg": _found(("dmg:skill", 0.65)), "skill.wheelDmg": _found()}, shown, found, {})
    [effect] = found.effects
    assert effect["hits"] == ["Luminous Illusion/Water Wheel DMG (1 of 2)"] and found.left_out == []
    # on both alternatives it is one entry for the row, by its own name
    both = kitgen.Found()
    kitgen.merge_per_hit({"skill.moonDmg": _found(("dmg:skill", 0.65)), "skill.wheelDmg": _found(("dmg:skill", 0.65))}, shown, both, {})
    assert [e["hits"] for e in both.effects] == [["Luminous Illusion/Water Wheel DMG"]]


def test_a_sum_row_and_a_low_high_row_are_not_alternatives():
    char = {"hits": [_hit("a", 0), _hit("b", 1), _hit("low", 2), _hit("high", 3)],
            "rows": {"skill": [{"name": "Two Hits", "enc": "{{0, percent}}%+{{1, percent}}%", "params": [0, 1]},
                               {"name": "Low/High Plunge DMG", "enc": "{{2, percent}}%/{{3, percent}}%", "params": [2, 3]}]},
            "params": {"skill": [[1.0]] * 4}}
    rows = {"skill.a": [("skill", "Two Hits")], "skill.b": [("skill", "Two Hits")],
            "skill.low": [("skill", "Low/High Plunge DMG")], "skill.high": [("skill", "Low/High Plunge DMG")]}
    assert kitgen.alternative_rows(char, rows) == rows


def test_nilous_constellation_1_skill_bonus_is_the_luminous_illusions_alone():
    [effect] = [e for e in KITS["nilou"]["effects"] if e["to"] == "dmg:skill" and e["from_constellation"] == 1]
    assert effect["hits"] == ["Luminous Illusion/Water Wheel DMG (1 of 2)"]
    assert not any("only some of the hits" in item["why"] for item in KITS["nilou"]["left_out"])


CASES = json.loads((TOOL / "cases.json").read_text(encoding="utf-8"))["cases"]


def test_the_states_these_forms_turned_on_are_in_a_comparison_case_with_their_state_on():
    # Skirk's Constellation 2 ATK (at 2) and the Traveler (Hydro)'s Suffusion (at 0) were left out before these forms read them
    want = {("skirk", "c2AfterBurst", "Skirk", "skirk:goblet@c2"), ("traveler-hydro", "suffusion", "TravelerHydro", "traveler-hydro:goblet")}
    for key, name, go_key, case_id in want:
        toggle = next(t for t in KITS[key]["toggles"] if t["name"] == name)
        case = next(x for x in CASES if x["id"] == case_id)
        assert toggle["on"] and case["conds"][go_key][name] == toggle["state"], key
        assert next(e for e in KITS[key]["effects"] if e["while"] == name)


def test_the_states_these_forms_turned_off_are_off_in_every_case_and_say_why():
    # stacks and a team's count: checked once with the state on against Genshin Optimizer (the report of the task), never in a case
    for key, go_key, name in (("eula", "Eula", "LightfallSword"), ("raiden-shogun", "RaidenShogun", "burstResolve"), ("odette", "Odette", "a1TeamSplendor")):
        toggle = next(t for t in KITS[key]["toggles"] if t["name"] == name)
        assert toggle["on"] is False and toggle["covers"] == []
        assert not any(case["conds"].get(go_key, {}).get(name) for case in CASES if case["character"] == key), key
        assert any(e["while"] == name for e in KITS[key]["effects"]), key


# ------------------------------------------------------------------------------------------------ the ground impact of a plunge


def test_a_bonus_to_the_ground_impact_of_a_plunge_is_a_plunging_bonus_for_the_impact_rows():
    assert kitgen.impact_bucket("plunging_impact_dmgInc") == ("additive:plunging", None)
    assert kitgen.impact_bucket("plunging_impact_dmg_") == ("dmg:plunging", None)
    assert kitgen.impact_bucket("plunging_impact_critDMG_") == ("cd", ["plunging"])
    assert kitgen.impact_bucket("plunging_dmgInc") is None and kitgen.impact_bucket("plunging_collision_dmgInc") is None


def test_the_sheets_impact_bonus_is_given_to_every_ground_impact_hit_and_its_state_is_a_toggle():
    # Xianyun's A4: (asc >= 4) 2 x min(ATK, 4500) while the Starwicker holds stacks
    term = threshold("asc", 4, {"op": "match", "x": [r("conditional.Xianyun.a4HasStacks"), c("on"), mul(c(2), {"op": "min", "x": [r("total.atk"), c(4500.0)]}), c(0)]})
    ctx = kitgen.Context()
    low, high = kitgen.Found(), kitgen.Found()
    kitgen.read_effects({"premod": {"plunging_impact_dmgInc": term}}, {}, ctx, kitgen.Found(), {"conditional.Xianyun.a4HasStacks": "on"}, name_of,
                        impact_found={"plunging.low": low, "plunging.high": high})
    for found in (low, high):
        [effect] = found.effects
        assert (effect["to"], effect["from"], effect["reads"], effect["rate"], effect["cap"], effect["from_ascension"], effect["while"]) == (
            "additive:plunging", "atk", "final", 2.0, 9000.0, 4, "a4HasStacks")
        assert "conditional.Xianyun.a4HasStacks" in found.toggles and found.left_out == []


def test_one_hits_own_impact_bonus_holds_for_a_ground_impact_and_is_dropped_for_a_collision():
    # Varesa's A1 sits in the data of her Plunge DMG hit, which is the collision: GO's collision hits read no impact bonus
    tree = threshold("asc", 1, {"op": "match", "x": [r("conditional.Varesa.a1Rainbow"), c("on"), mul(r("total.atk"), c(0.5)), c(0)]})
    for here, count in ((True, 1), (False, 0)):
        found = kitgen.Found()
        kitgen.read_effects({"premod": {"plunging_impact_dmgInc": tree}}, {}, kitgen.Context(), found, {"conditional.Varesa.a1Rainbow": "on"}, name_of,
                            None, "hit plunging.low: ", impact_here=here)
        assert len(found.effects) == count and found.left_out == []


def test_varesas_and_xianyuns_ground_impact_bonuses_are_read_behind_their_states():
    rows = {e["while"] for e in KITS["varesa"]["effects"] if e["to"] == "additive:plunging"}
    assert rows == {"a1Rainbow", "c4Diligent"}
    a1 = [e for e in KITS["varesa"]["effects"] if e["while"] == "a1Rainbow" and e["to"] == "additive:plunging"]
    assert {name for e in a1 for name in e["hits"]} >= {"Low/High Plunge DMG", "Fiery Passion Low/High Plunge DMG", "Volcano Kablam DMG"}
    assert not any(name in ("Plunge DMG", "Fiery Passion Plunge DMG") for e in a1 for name in e["hits"])   # the collision is no ground impact
    xianyun = [e for e in KITS["xianyun"]["effects"] if e["while"] == "a4HasStacks"]
    assert sorted((e["rate"], e["cap"], e["from_constellation"] or 0) for e in xianyun) == [(2.0, 9000.0, 0), (2.0, 9000.0, 2)]
    assert {name for e in xianyun for name in e["hits"]} >= {"Low/High Plunge DMG", "Driftcloud Wave DMG"}
    for key in ("varesa", "xianyun"):
        assert not any("no place" in item["why"] for item in KITS[key]["left_out"] if "plunging_impact" in item["what"]), key


def test_varesas_rainbow_crash_is_on_and_her_aggravate_case_shows_it():
    # a bonus that scales with ATK like every row of hers moves no ratio of the sands and goblet swaps: with Aggravate on (a flat
    # amount of Elemental Mastery's) the rows weigh differently, and her Normal Attack's answer with the state on is GO's
    toggle = next(t for t in KITS["varesa"]["toggles"] if t["name"] == "a1Rainbow")
    assert toggle["on"] is True and toggle["covers"] == ["plunging"]
    case = next(x for x in CASES if x["id"] == "varesa:sands:aggravate")
    assert case["reaction"] == "aggravate" and case["conds"]["Varesa"]["a1Rainbow"] == "on"
    fixture = next(x for x in FIXTURE["cases"] if x["id"] == "varesa:sands:aggravate")
    assert agrees(fixture)
    # +3.3% with it, +5.4% without it (checked once with the state off, against GO's +5.4%): the case tells the two apart
    assert abs(fixture["ours"]["talents"]["normal"] - 3.3) < 0.1


def test_the_impact_bonuses_that_stay_off_say_that_no_swap_shows_them_and_claim_no_check():
    # a flat bonus that scales with ATK cancels in the sands and goblet ratios: the reasons say so instead of claiming a check
    for key, name in (("varesa", "c4Diligent"), ("xianyun", "a4HasStacks")):
        toggle = next(t for t in KITS[key]["toggles"] if t["name"] == name)
        reason = json.loads((TOOL / "decided" / f"{key}.json").read_text(encoding="utf-8"))["toggles"][name]["reason"]
        assert toggle["on"] is False, key
        assert "No swap of the comparison can show it" in reason and "checked once" not in reason.lower(), key
        assert "cancels" in reason, key


def test_a_count_whose_later_step_the_engine_cannot_read_is_left_out_whole(monkeypatch):
    # Odette's count has three steps; the first reads, the second does not: the first is not kept beside the entry that lists the term
    count = {"op": "threshold", "x": [r("constellation"), c(6), c(6), add(threshold("constellation", 1, c(2.0)), threshold("constellation", 1, c(-6.0)), c(4.0))]}
    term = mul(count, c(0.15))
    real, calls = kitgen.linear, []

    def second_fails(node, ctx):
        calls.append(node)
        if len(calls) == 2:
            raise kitgen.NotLinear("a step the engine does not read")
        return real(node, ctx)

    monkeypatch.setattr(kitgen, "linear", second_fails)
    found = kitgen.Found()
    kitgen._add(term, ("bonus:stellar-conduct", None), kitgen.Context(), found, {}, name_of, None, "x")
    assert len(calls) == 2 and found.effects == []
    assert [item["why"] for item in found.left_out] == ["a step the engine does not read"]
    monkeypatch.setattr(kitgen, "linear", real)
    ok = kitgen.Found()
    kitgen._add(term, ("bonus:stellar-conduct", None), kitgen.Context(), ok, {}, name_of, None, "x")
    assert len(ok.effects) == 3 and ok.left_out == []


def test_a_stack_term_whose_lists_differ_in_length_is_left_out_with_the_reason():
    count = lookup("conditional.X.s", {1: 1})
    hit = {"group": "burst", "name": "a", "params": [], "formula": mul(add(subscript([1.0, 2.0]), mul(subscript([0.1, 0.2, 0.3]), count)), r("total.atk"))}
    per_hit: dict = {}
    kitgen.stack_multipliers({"hits": [hit]}, {"burst.a": [("burst", "Row")]}, {}, kitgen.Context(rows={"burst": [{"name": "Row", "params": [0]}]}),
                             per_hit, {"conditional.X.s": "1"}, name_of)
    assert not per_hit["burst.a"].effects
    assert [item["why"] for item in per_hit["burst.a"].left_out] == [
        "a state adds to the talent's multiplier (stacks), with lists of different lengths by talent level"]


def test_an_impact_bonus_of_two_states_is_one_effect_not_one_for_each_ground_impact_hit():
    # Albedo's and Furina's impact bonuses read two states at once (Albedo's from Constellation 4, Furina's from 6): the sheet's term is given to
    # each impact hit, and merges into one effect on the Low/High Plunge row, off until a person decides its toggles
    for key, to in (("albedo", "dmg:plunging"), ("furina", "additive:plunging")):
        assert not [item for item in KITS[key]["left_out"] if "plunging_impact" in item["what"]], key
        found = [e for e in KITS[key]["effects"] if e["to"] == to and e.get("also")]
        assert len(found) == 1 and found[0]["hits"] == ["Low/High Plunge DMG"] and found[0]["from_constellation"] >= 4, key


# ------------------------------------------------------------------------------------------------ a term of two states at once


def _match(path, state, yes, no=0):
    return {"op": "match", "x": [r(path), c(state), yes, c(no)]}


def test_a_term_that_reads_two_states_is_an_effect_behind_both_toggles():
    # Kaveh's A4: after his Burst (a state of its own), 25 Elemental Mastery for each of up to four stacks (another state)
    stacks = lookup("conditional.Kaveh.a4Stacks", {1: 25.0, 2: 50.0, 3: 75.0, 4: 100.0})
    term = threshold("asc", 4, _match("conditional.Kaveh.afterBurst", "on", stacks))
    found = kitgen.Found()
    chosen = {"conditional.Kaveh.afterBurst": "on", "conditional.Kaveh.a4Stacks": "4"}
    kitgen._add(kitgen.normalise(term), ("em", None), kitgen.Context(), found, chosen, name_of, None, "premod.eleMas")
    [effect] = found.effects
    assert (effect["to"], effect["rate"], effect["from_ascension"], effect["while"], effect["also"]) == ("em", 100.0, 4, "afterBurst", ["a4Stacks"])
    assert found.left_out == []
    assert {path: info["chosen"] for path, info in found.toggles.items()} == chosen


def test_an_effect_of_one_state_has_no_also():
    found = kitgen.Found()
    kitgen._add(_match("conditional.X.s", "on", c(0.2)), ("dmg", None), kitgen.Context(), found, {}, name_of, None, "premod.all_dmg_")
    [effect] = found.effects
    assert effect["while"] == "s" and "also" not in effect


def test_a_term_that_also_reads_a_mode_of_her_team_is_an_effect_behind_the_mode_and_her_state_when_it_reaches_a_row():
    # Klee's C1: Hexerei's Secret Rite (`lockHomework`, the team's mode) and a state of her own: the toggle of the mode is `while`
    term = threshold("constellation", 1, _match("conditional.Klee.lockHomework", "on", _match("conditional.Klee.lockC1", "on", c(0.6))))
    found = kitgen.Found()
    ctx = kitgen.Context(elements=frozenset({"pyro"}), reach_rows=[("normal", "1-Hit DMG", "elemental", "normal")])
    kitgen._add(term, ("atk%", None), ctx, found, {}, name_of, None, "premod.atk_")
    [effect] = found.effects
    assert (effect["while"], effect["also"], effect["from_constellation"], effect["rate"]) == ("lockHomework", ["lockC1"], 1, 0.6)
    assert found.left_out == [] and set(found.toggles) == {"conditional.Klee.lockHomework", "conditional.Klee.lockC1"}


def test_a_team_mode_term_that_adds_nothing_to_a_row_of_hers_is_left_for_a_team_mode_decision():
    # Cyno's C2 bonus to Stellar-Conduct hits when none of his rows is one
    term = threshold("constellation", 2, _match("conditional.Cyno.lockRevelation", "on", _match("conditional.Cyno.c1Together", "on", c(0.16))))
    found = kitgen.Found()
    ctx = kitgen.Context(elements=frozenset({"electro"}), reach_rows=[("normal", "1-Hit DMG", "physical", "normal")])
    kitgen._add(term, ("bonus:stellar-conduct", None), ctx, found, {}, name_of, None, "premod.stellarconduct_dmg_")
    assert found.effects == []   # (its toggles are dropped with it: no effect reads them)
    assert [item["why"] for item in found.left_out] == [kitgen.WHY_TEAM_MODE]
    assert "team-mode decision" in kitgen.WHY_TEAM_MODE and "not model" not in kitgen.WHY_TEAM_MODE
    # the same bonus with a Stellar-Conduct row is an effect
    ctx.reach_rows.append(("burst", "Burst DMG", "stellar-conduct", "burst"))
    again = kitgen.Found()
    kitgen._add(term, ("bonus:stellar-conduct", None), ctx, again, {}, name_of, None, "premod.stellarconduct_dmg_")
    assert [(e["while"], e["also"]) for e in again.effects] == [("lockRevelation", ["c1Together"])]


def test_which_rows_an_effect_reaches_follows_the_engine():
    ctx = kitgen.Context(elements=frozenset({"pyro"}), reach_rows=[("normal", "1-Hit DMG", "physical", "normal"), ("skill", "Skill DMG", "elemental", "skill")])
    reach = lambda to, **kw: kitgen.reaches({"to": to, "talents": None, "hits": None, **kw}, ctx)  # noqa: E731
    assert reach("atk%") and reach("dmg") and reach("dmg:pyro") and reach("dmg:skill") and reach("dmg:physical")
    assert not reach("dmg:geo") and not reach("dmg:burst") and not reach("bonus:stellar-conduct") and not reach("cd:cryo")
    assert not reach("dmg", talents=["burst"]) and not reach("dmg", hits=["Another"]) and reach("dmg", hits=["Skill DMG"])
    assert kitgen.reaches({"to": "dmg:geo", "talents": None, "hits": None}, kitgen.Context())   # no rows known: nothing is judged


def test_a_term_whose_states_are_all_off_for_the_chosen_ones_adds_nothing():
    # a second state read at a value the term gives nothing at: no effect and no toggle (as with one state)
    term = _match("conditional.X.a", "on", _match("conditional.X.b", "x", c(0.1)))
    found = kitgen.Found()
    kitgen._add(term, ("dmg", None), kitgen.Context(), found, {"conditional.X.b": "y"}, name_of, None, "premod.all_dmg_")
    assert found.effects == [] and found.toggles == {} and found.left_out == []


def test_a_term_of_two_states_is_an_effect_behind_both_whatever_the_constellation_it_starts_at():
    # Albedo's C6: while the Skill is in the field, a bonus when a Crystallize happens (two states of her own): off until a person decides
    term = threshold("constellation", 6, _match("conditional.Albedo.skillInField", "on", _match("conditional.Albedo.c6Crystallize", "on", c(0.17))))
    found = kitgen.Found()
    kitgen._add(term, ("dmg", None), kitgen.Context(), found, {}, name_of, None, "premod.all_dmg_")
    [effect] = found.effects
    assert (effect["from_constellation"], effect["while"], effect["also"], effect["rate"]) == (6, "skillInField", ["c6Crystallize"], 0.17)
    assert found.left_out == [] and set(found.toggles) == {"conditional.Albedo.skillInField", "conditional.Albedo.c6Crystallize"}
    # the same two states from Constellation 2 are an effect too
    low = threshold("constellation", 2, _match("conditional.Ororon.c2Supersense", "on", _match("conditional.Ororon.stack", "4", c(0.32))))
    kept = kitgen.Found()
    kitgen._add(low, ("dmg:electro", None), kitgen.Context(), kept, {}, name_of, None, "premod.electro_dmg_")
    assert [(e["from_constellation"], e["also"]) for e in kept.effects] == [(2, ["stack"])] and kept.left_out == []
    assert not hasattr(kitgen, "WHY_HIGH_CONSTELLATION") and not hasattr(kitgen, "HIGHEST_COUNTED_CONSTELLATION")


# ----------------------------------------------------------------------------------------- a gate that counts by constellation


def eq_gate(path, k, yes, no=0):
    return {"op": "match", "x": [r(path), c(k), yes, c(no)]}


def eq_gate_of(left, k, yes, no=0):
    return {"op": "match", "x": [left, c(k), yes, c(no)]}


def test_a_gate_on_constellation_equal_to_6_is_a_gate_from_6():
    # Alhaitham's C6 Dendro bonus inside his C4 gate: `constellation >= 4 ? (constellation == 6 ? 0.3 : 0) : 0`
    term = threshold("constellation", 4, eq_gate("constellation", 6, c(0.3)))
    found = kitgen.Found()
    kitgen._add(term, ("dmg:dendro", None), kitgen.Context(), found, {}, name_of, None, "premod.dendro_dmg_")
    [effect] = found.effects
    assert (effect["from_constellation"], effect["rate"]) == (6, 0.3) and found.left_out == []


def test_a_flag_that_is_one_from_a_constellation_is_that_gate():
    # Xingqiu's C4: `(constellation >= 4 ? 1 : 0) == 1 ? 0.5 : 0`
    term = eq_gate_of(threshold("constellation", 4, c(1)), 1, c(0.5))
    found = kitgen.Found()
    kitgen._add(term, ("dmg", None), kitgen.Context(), found, {}, name_of, None, "premod.all_dmg_")
    [effect] = found.effects
    assert (effect["from_constellation"], effect["rate"]) == (4, 0.5) and found.left_out == []


def test_a_count_that_is_at_least_one_whatever_the_constellation_is_no_gate():
    # Nicole's and Vodyanitsa's `add(constellation >= 6 ? 1 : 0, 1.0) >= 1`: always true; what it gates is read as it is
    count = {"op": "add", "x": [threshold("constellation", 6, c(1)), c(1.0)]}
    term = {"op": "threshold", "x": [count, c(1), threshold("constellation", 2, c(0.5)), c(0)]}
    found = kitgen.Found()
    kitgen._add(term, ("cd:hydro", None), kitgen.Context(), found, {}, name_of, None, "premod.hydro_critDMG_")
    [effect] = found.effects
    assert (effect["from_constellation"], effect["rate"]) == (2, 0.5) and found.left_out == []


def test_a_list_read_by_a_count_that_grows_with_the_constellation_is_a_step_at_each_change():
    # Chasca's bonus by a count: the list's 0.15 at one, 0.35 at two, the count 1 below Constellation 2 and 2 from it
    count = {"op": "min", "x": [{"op": "add", "x": [threshold("constellation", 2, c(1)), c(1.0)]}, c(3.0)]}
    listed = {"op": "subscript", "x": [count], "list": [-1, 0.15, 0.35, 0.5]}
    term = {"op": "threshold", "x": [count, c(1), listed, c(0)]}
    found = kitgen.Found()
    kitgen._add(term, ("dmg", None), kitgen.Context(), found, {}, name_of, None, "premod.charged_dmg_")
    assert sorted((e["from_constellation"] or 0, round(e["rate"], 6)) for e in found.effects) == [(0, 0.15), (2, 0.2)]
    assert found.left_out == []


def test_a_gate_that_holds_only_between_two_constellations_stays_left_out():
    term = eq_gate("constellation", 4, c(0.3))
    found = kitgen.Found()
    kitgen._add(term, ("dmg", None), kitgen.Context(), found, {}, name_of, None, "premod.all_dmg_")
    assert found.effects == [] and len(found.left_out) == 1 and "a gate on" in found.left_out[0]["why"]


def test_a_mode_that_gives_her_hits_one_kind_or_another_is_not_all_of_them_at_once():
    # Valeriy's electro bonus: while the kind of his hits is not Stellar-Conduct (`a0StellarRadianceSc` is "sc"), it is not a state to switch on
    term = _match("conditional.Valeriy.chargedOffensive", "on", {"op": "match", "x": [r("conditional.Valeriy.a0StellarRadianceSc"), c("sc"), c(0), c(0.5)]})
    found = kitgen.Found()
    kitgen._add(term, ("dmg", None), kitgen.Context(), found, {}, name_of, None, "premod.electro_dmgInc")
    assert found.effects == [] and [item["why"] for item in found.left_out] == [kitgen.WHY_NOT_ALL_NEEDED]


def test_a_term_that_gives_something_when_one_of_its_states_is_off_is_not_all_of_them_at_once():
    # Skirk's Burst: a count of serpents times a factor her A4 stacks give, 1 when there are none: with the stacks off it still adds
    term = mul(lookup("conditional.Skirk.serpents", {1: 1, 2: 2}), lookup("conditional.Skirk.stacks", {1: 1.05, 2: 1.15}) | {"x": [r("conditional.Skirk.stacks"), c(1)]}, r("total.atk"))
    found = kitgen.Found()
    kitgen._add(term, ("additive:burst", None), kitgen.Context(), found, {"conditional.Skirk.serpents": "2", "conditional.Skirk.stacks": "2"},
                name_of, None, "premod.burst_dmgInc")
    assert found.effects == [] and [item["why"] for item in found.left_out] == [kitgen.WHY_NOT_ALL_NEEDED]


def test_a_sum_of_states_any_of_which_is_enough_is_not_all_of_them_at_once():
    # Durin's C2: a bonus once any one of several elements was reacted with
    term = _match("conditional.Durin.after", "on", {"op": "threshold", "x": [add(_match("conditional.Durin.hydro", "hydro", c(1)), _match("conditional.Durin.cryo", "cryo", c(1))), c(1), c(0.5), c(0)]})
    found = kitgen.Found()
    kitgen._add(term, ("dmg:pyro", None), kitgen.Context(), found, {}, name_of, None, "premod.pyro_dmg_")
    assert found.effects == [] and [item["why"] for item in found.left_out] == [kitgen.WHY_NOT_ALL_NEEDED]


def test_a_stack_count_that_is_zero_when_its_state_is_off_is_all_of_them_at_once():
    # Sandrone's A1: a count of tactics times a factor, only while Decoding Power is above 50; a missing count is none
    term = _match("conditional.S.decoding", "on", mul(lookup("conditional.S.tactics", {1: 1, 2: 2}), c(0.1)))
    found = kitgen.Found()
    kitgen._add(term, ("mult", None), kitgen.Context(), found, {}, name_of, None, "hit x multiplier")
    [effect] = found.effects
    assert (effect["while"], effect["also"], effect["rate"]) == ("decoding", ["tactics"], 0.2)


def test_a_bonus_of_two_states_to_another_element_than_hers_is_left_out_with_the_reason():
    # Durin's C2 gives a Pyro bonus and, for each reaction the party made, the bonus of that reaction's element: none of his rows deals Hydro
    term = threshold("constellation", 2, _match("conditional.Durin.after", "on", _match("conditional.Durin.hydro", "hydro", c(0.5))))
    for element, count in (("pyro", 1), ("hydro", 0)):
        found = kitgen.Found()
        ctx = kitgen.Context(elements=frozenset({"pyro"}))
        kitgen._add(term, (f"dmg:{element}", None), ctx, found, {}, name_of, None, f"premod.{element}_dmg_")
        assert len(found.effects) == count
        assert [item["why"] for item in found.left_out] == ([] if count else [kitgen.WHY_OTHER_ELEMENT])


def _toggle(key, name):
    return next(t for t in KITS[key]["toggles"] if t["name"] == name)


def _reason(key, name):
    return json.loads((TOOL / "decided" / f"{key}.json").read_text(encoding="utf-8"))["toggles"][name]["reason"]


def test_the_terms_of_two_states_are_effects_behind_both_toggles_in_the_kits():
    want = {
        "kaveh": ("em", "afterBurst", ["a4Stacks"]), "yoimiya": ("dmg:pyro", "skill", ["a1"]), "xiao": ("dmg", "inBurst", ["a1BurstStack"]),
        "ororon": ("dmg:electro", "c2Supersense", ["c2BurstHitStack"]), "durin": ("additive:burst", "burstForm", ["c1Stacks"]),
        "traveler-pyro": ("dmg", "c1SkillActive", ["c1Ns"]), "traveler-cryo": ("em", "c2Crystal", ["c2ActiveStellar"]),
        "navia": ("mult", "shotsHit", ["skillCharges"]), "sandrone": ("mult", "a1Decoding", ["a1Tactics"]),
    }
    for key, (to, while_, also) in want.items():
        assert any(e["to"] == to and e["while"] == while_ and e.get("also") == also for e in KITS[key]["effects"]), key
        for name in (while_, *also):
            assert any(t["name"] == name for t in KITS[key]["toggles"]), (key, name)
    assert {e["while"] for e in KITS["wanderer"]["effects"] if e.get("also")} == {"afterSkill"}
    assert sorted(e["also"][0] for e in KITS["wanderer"]["effects"] if e.get("also")) == ["c2Points", "skillCryoContact", "skillPyroContact"]


def test_every_also_names_toggles_the_character_has_and_no_effect_of_hers_is_alone_in_one():
    for key, character in KITS.items():
        names = {t["name"] for t in character["toggles"]}
        for e in character["effects"]:
            if e.get("also"):
                assert e["while"] and e["while"] in names and set(e["also"]) <= names, (key, e)
                assert e["while"] not in e["also"], (key, e)


def test_the_terms_left_out_for_two_states_say_why_and_none_says_two_states_at_once():
    for key, character in KITS.items():
        for item in character["left_out"]:
            assert item["why"] != "it depends on two of her states at once", (key, item["what"])
    assert any(item["why"] == kitgen.WHY_TEAM_MODE for item in KITS["cyno"]["left_out"] + KITS["yae-miko"]["left_out"])
    assert not any("not model" in item["why"] for character in KITS.values() for item in character["left_out"])
    assert any(item["why"] == kitgen.WHY_OTHER_ELEMENT for item in KITS["durin"]["left_out"])
    assert any(item["why"] == kitgen.WHY_NOT_ALL_NEEDED for item in KITS["durin"]["left_out"] + KITS["skirk"]["left_out"])
    # nothing is left out for starting at a high constellation any more: Albedo's C6 is an effect behind her two toggles
    assert not any("above the C0-C2" in item["why"] for character in KITS.values() for item in character["left_out"])
    assert any(e["from_constellation"] == 6 and e["also"] == ["c6Crystallize"] for e in KITS["albedo"]["effects"] if e.get("also"))


def test_the_new_states_that_are_on_say_what_a_case_shows_and_the_off_ones_claim_only_what_was_checked():
    # on: Kaveh's A4 (Elemental Mastery: no swap shows it) and Yoimiya's A1 (a Pyro bonus: her goblet swap shows it)
    assert _toggle("kaveh", "a4Stacks")["on"] and "No swap of the comparison can show it" in _reason("kaveh", "a4Stacks")
    assert _toggle("yoimiya", "a1")["on"] and _toggle("yoimiya", "a1")["state"] == "10"
    case = next(x for x in CASES if x["id"] == "yoimiya:goblet")
    assert case["conds"]["Yoimiya"]["a1"] == "10"
    case = next(x for x in CASES if x["id"] == "kaveh:goblet")
    assert case["conds"]["Kaveh"]["a4Stacks"] == "4" and case["conds"]["Kaveh"]["afterBurst"] == "on"
    # off: checked once with the state on, or (Elemental Mastery) not provable by a swap; nothing claims a case
    for key, name in (("durin", "c1Stacks"), ("navia", "shotsHit"), ("ororon", "c2BurstHitStack"), ("sandrone", "a1Tactics"), ("traveler-pyro", "c1Ns"),
                      ("wanderer", "c2Points"), ("wanderer", "skillCryoContact"), ("wanderer", "skillPyroContact"), ("xiao", "a1BurstStack")):
        assert _toggle(key, name)["on"] is False and "checked once with it" in _reason(key, name), (key, name)
        assert not any(case["conds"].get(KITS[key]["go_key"], {}).get(name) for case in CASES if case["character"] == key), (key, name)
    assert _toggle("traveler-cryo", "c2ActiveStellar")["on"] is False
    assert "No swap of the comparison can show it" in _reason("traveler-cryo", "c2ActiveStellar")
    assert "checked once" not in _reason("traveler-cryo", "c2ActiveStellar").lower()


# ------------------------------------------------------------------------------------------------ rows a person gives hits that no row prints


def _derived_build(derived, hits=None, effects=None):
    """Sethos's shape: a Normal Attack of three rows, and a Burst whose Dusk Bolt hits read the Normal Attack's parameters 0 to 3."""
    auto = [{"row": 0, "name": "1-Hit DMG", "enc": "{{0}}%", "params": [0]}, {"row": 1, "name": "2-Hit DMG", "enc": "{{1}}%+{{2}}%", "params": [1, 2]},
            {"row": 2, "name": "3-Hit DMG", "enc": "{{3}}%", "params": [3]}]
    burst = [{"row": 0, "name": "Dusk Bolt DMG Increase", "enc": "{{0}}% Elemental Mastery", "params": [0]}]
    lists = [[1.0, 2.0], [0.5, 1.0], [0.5, 1.0], [1.5, 3.0]]

    def hit(group, name, move, index, ele=None):
        return {"group": group, "name": name, "move": move, "ele": ele, "ele_tree": None, "variant": None, "resist": None, "ordinary": True,
                "reacts": True, "gates": [], "params": [{"talent": "auto", "index": index, "levels": lists[index]}], "formula": None}

    char = {"sheet": "Sethos", "name": "Sethos", "element": "electro", "weapon_type": "bow", "rows": {"auto": auto, "burst": burst},
            "params": {"auto": lists, "burst": [[1.9, 3.8]]},
            "hits": hits or [*(hit("normal", str(i), "normal", i) for i in range(4)),
                             *(hit("burst", f"dusk_{i}", "charged", i, "electro") for i in range(4))]}
    kit = {"characters": {"Sethos": {"effects": {}, "hit_data": effects or {}}}, "weapons": {}, "sets": {}}
    decided = {"about": "", "checked": "", "unsure": {}, "characters": {"sethos": {"main": None, "toggles": {}, "derived_rows": derived}}}
    return kitgen.build(kit, {"Sethos": char}, decided, "0" * 40, lambda name: name.lower(), lambda *a: "physical")["characters"]["sethos"]


SETHOS_ROWS = [
    {"talent": "burst", "name": "Dusk Bolt 1-Hit DMG", "from_talent": "normal", "from_row": "1-Hit DMG", "hits": ["burst.dusk_0"]},
    {"talent": "burst", "name": "Dusk Bolt 2-Hit DMG", "from_talent": "normal", "from_row": "2-Hit DMG", "hits": ["burst.dusk_1", "burst.dusk_2"]},
    {"talent": "burst", "name": "Dusk Bolt 3-Hit DMG", "from_talent": "normal", "from_row": "3-Hit DMG", "hits": ["burst.dusk_3"]},
]


def test_hits_no_row_prints_become_the_rows_a_person_names_with_their_kind_element_and_move():
    entry = _derived_build(SETHOS_ROWS)
    assert entry["derived_rows"] == [{k: v for k, v in row.items() if k != "hits"} for row in SETHOS_ROWS]
    assert entry["hits"]["burst"] == {"Dusk Bolt 1-Hit DMG": "elemental", "Dusk Bolt 2-Hit DMG": "elemental", "Dusk Bolt 3-Hit DMG": "elemental"}
    assert entry["moves"]["burst"] == {name: "charged" for name in entry["hits"]["burst"]}
    # the Normal Attack's own rows are what they were: the Dusk Bolts do not join them
    assert entry["hits"]["normal"] == {"1-Hit DMG": "physical", "2-Hit DMG": "physical", "3-Hit DMG": "physical"}
    assert not any(item["why"] == "no talent row prints its multiplier" for item in entry["left_out"])


def test_a_derived_rows_hits_must_read_the_parameters_of_the_row_it_copies():
    import pytest
    wrong = [{**SETHOS_ROWS[0], "hits": ["burst.dusk_1"]}]
    with pytest.raises(SystemExit, match="dusk_1"):
        _derived_build(wrong)
    with pytest.raises(SystemExit, match="nobody"):
        _derived_build([{**SETHOS_ROWS[0], "hits": ["burst.nobody"]}])
    with pytest.raises(SystemExit, match="Nowhere"):
        _derived_build([{**SETHOS_ROWS[0], "from_row": "Nowhere"}])


def test_a_bonus_a_derived_rows_hit_carries_is_an_effect_on_that_row():
    # the Burst's bonus to the Dusk Bolts (a share of Elemental Mastery by Burst level, a row of the Burst) is on the hit's data
    bonus = {"premod": {"charged_dmgInc": mul(subscript([1.9, 3.8], "total.burstIndex"), r("total.eleMas"))}}
    entry = _derived_build(SETHOS_ROWS, effects={f"burst.dusk_{i}": bonus for i in range(4)})
    [effect] = [e for e in entry["effects"] if e["to"] == "additive:charged"]
    assert effect["from"] == "em" and effect["row"] == {"talent": "burst", "name": "Dusk Bolt DMG Increase"}
    assert effect["hits"] == ["Dusk Bolt 1-Hit DMG", "Dusk Bolt 2-Hit DMG", "Dusk Bolt 3-Hit DMG"]


def test_sethos_dusk_bolts_are_burst_rows_with_his_normal_attacks_numbers_and_agree_with_genshin_optimizer():
    sethos = KITS["sethos"]
    assert [row["name"] for row in sethos["derived_rows"]] == ["Dusk Bolt 1-Hit DMG", "Dusk Bolt 2-Hit DMG", "Dusk Bolt 3-Hit DMG"]
    assert all(sethos["hits"]["burst"][row["name"]] == "elemental" and sethos["moves"]["burst"][row["name"]] == "charged" for row in sethos["derived_rows"])
    # the Burst's bonus (a share of Elemental Mastery by Burst level) is on those rows alone
    [bonus] = [e for e in sethos["effects"] if e.get("row") == {"talent": "burst", "name": "Dusk Bolt DMG Increase"}]
    assert bonus["to"] == "additive:charged" and bonus["hits"] == [row["name"] for row in sethos["derived_rows"]] and not bonus["while"]
    # his Burst is a counted talent now, and every case of his agrees in it
    block = FIXTURE["kits"]["sethos"]
    burst = next(t for t in block["talents"] if t["key"] == "burst")
    assert burst["main"] and [r["name"] for r in burst["rows"]] == [row["name"] for row in sethos["derived_rows"]]
    cases = [c for c in FIXTURE["cases"] if c["character"] == "sethos"]
    assert cases and all(agrees(c) and "burst" in c["go"]["talents"] for c in cases)
    assert not any(item["why"] == "no talent row prints its multiplier" for item in sethos["left_out"])


def test_a_decision_file_with_derived_rows_is_held_by_the_kits():
    decided = json.loads((TOOL / "decided" / "sethos.json").read_text(encoding="utf-8"))
    assert kitgen.decision_differences(decided, None, KITS["sethos"] | {"checked": True}) == []
    assert kitgen.decision_differences({**decided, "derived_rows": decided["derived_rows"][:2]}, None, KITS["sethos"] | {"checked": True}) == ["derived_rows"]


def test_the_states_of_the_partys_modes_are_toggles_and_their_terms_that_reach_a_row_are_effects_behind_them():
    want = {
        "albedo": ("def%", "lockHomework", ["c1LockAfterSkill"]), "klee": ("atk%", "lockHomework", ["lockC1"]), "mona": ("em", "lockHomework", ["lockC2Charged"]),
        "cyno": ("em", "lockRevelation", ["lockStellarRadianceSc", "c1Together"]), "yae-miko": ("dmg:electro", "lockRevelation", ["c1"]),
        "yumemizuki-mizuki": ("em", "lockRevelation", ["skillDream"]),
    }
    for e in ("anemo", "cryo", "dendro", "electro", "geo", "hydro", "pyro"):
        key = f"traveler-{e}"
        assert {(x["to"], tuple(x["also"])) for x in KITS[key]["effects"] if x["while"] == "Traveler.lockedPassive"} == {
            ("atk%", ("Traveler.travelerpyro",)), ("em", ("Traveler.travelerdendro",)), ("cr", ("Traveler.traveleranemo",)), ("def%", ("Traveler.travelergeo",)),
            ("er", ("Traveler.travelerelectro",)), ("hp%", ("Traveler.travelerhydro",)), ("cd", ("Traveler.travelercryo",))}, key
    for key, (to, while_, also) in want.items():
        assert any(x["to"] == to and x["while"] == while_ and x.get("also") == also for x in KITS[key]["effects"]), key


def test_no_default_answer_moves_for_a_mode_toggle_and_each_is_off_with_a_reason_that_says_what_was_checked():
    # every effect behind a team mode needs a toggle that is off, so no case's default changes; the reasons say "checked once ... agreed"
    for key, character in KITS.items():
        on = {t["name"] for t in character["toggles"] if t["on"]}
        for x in character["effects"]:
            if x.get("also") and any(n.startswith(("lock", "Traveler.")) or "StellarRadiance" in n for n in [x["while"], *x["also"]]):
                assert not {x["while"], *x["also"]} <= on, (key, x["to"])
                for name in [x["while"], *x["also"]]:
                    assert next(t for t in character["toggles"] if t["name"] == name)["label"], (key, name)
    for key, name in (("albedo", "lockHomework"), ("cyno", "lockRevelation"), ("traveler-pyro", "Traveler.travelerpyro"), ("yae-miko", "c1")):
        assert "checked once with it and its other switches on against Genshin Optimizer and agreed" in _reason(key, name), (key, name)
    for key, name in (("mona", "lockC2Charged"), ("cyno", "c1Together"), ("yae-miko", "c2"), ("traveler-geo", "Traveler.travelerdendro")):
        assert "moves damage only through a reaction" in _reason(key, name), (key, name)


def test_the_new_modes_labels_are_ours_and_plain():
    assert _toggle("yae-miko", "lockRevelation")["label"] == "Stellar Revelation" and _toggle("yumemizuki-mizuki", "lockRevelation")["label"] == "Stellar Revelation"
    assert "Witch's Homework" in _toggle("klee", "lockHomework")["label"] and "locked passive" in _toggle("traveler-hydro", "Traveler.lockedPassive")["label"].lower()


def test_the_elements_her_rows_deal_are_hers_the_hits_named_ones_an_infusions_and_the_teams():
    char = {"element": "anemo", "hits": [
        {"ele": "anemo", "ele_tree": None},
        {"ele": None, "ele_tree": {"op": "threshold", "x": [r("tally.pyro"), c(1), c("pyro"), {"op": "threshold", "x": [r("tally.hydro"), c(1), c("hydro"), c("physical")]}]}}]}
    assert kitgen.elements_dealt(char, {}, None) == {"anemo", "pyro", "hydro"}
    sheet = {"effects": {"infusion": {"overridableSelf": c("cryo")}}}
    party = {"options": [{"id": "x", "elements": ["geo"]}]}
    assert kitgen.elements_dealt({"element": "pyro", "hits": []}, sheet, party) == {"pyro", "cryo", "geo"}
    # so a bonus of two states to an element some row of hers can deal is kept (Varka's team element hits)
    ctx = kitgen.Context(elements=kitgen.elements_dealt(char, {}, None))
    found = kitgen.Found()
    term = _match("conditional.V.a", "on", _match("conditional.V.b", "on", c(0.2)))
    kitgen._add(term, ("dmg:pyro", None), ctx, found, {}, name_of, None, "premod.pyro_dmg_")
    assert len(found.effects) == 1 and found.left_out == []
