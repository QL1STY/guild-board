"""A weapon's or set's toggle that nobody decided stands for ONE state (tools/go-reference/kitgen.py, `_gear`): the state that gives the
most, within the game's rules. A sum of one term for each stack count is the effect at one count, branches of one condition (more than
one opponent or fewer) are never added together, a cap is held, and an item whose states the game picks by chance or by turns is left
out with its reason. The trees are made up, shaped as GO's Waverider sheets write them."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"
KITS = ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json"


def _load(name: str):
    sys.path.insert(0, str(TOOL))
    try:
        spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(TOOL))


kitgen = _load("kitgen")

SLUG = lambda text: text.lower().replace(" ", "-")  # noqa: E731
BARE = {"about": "", "checked": "", "unsure": {}, "characters": {}, "weapons": {}, "sets": {}}


def _build(kit: dict) -> dict:
    return kitgen.build(kit, {}, BARE, "0" * 40, SLUG, lambda *a: "elemental")


def _cond(sheet: str, name: str) -> dict:
    return {"op": "read", "p": f"conditional.{sheet}.{name}"}


def _num(value) -> dict:
    return value if isinstance(value, dict) else {"op": "const", "v": value}


def _when(sheet: str, name: str, state: str | None, then, otherwise=0) -> dict:
    """GO's `equal(cond, state, then)`; a state of None is `unequal(cond, undefined, ...)` (any state set)."""
    state_node = {"op": "const", "v": state} if state is not None else {"op": "const"}
    return {"op": "match", "x": [_cond(sheet, name), state_node, _num(then), _num(otherwise)]}


def _by_refinement(values: list[float]) -> dict:
    return {"op": "subscript", "list": [-1.0, *values], "x": [{"op": "read", "p": "weapon.refinement"}]}


def _sum(*terms: dict) -> dict:
    return {"op": "add", "x": list(terms)}


def _lookup(sheet: str, name: str, table: dict) -> dict:
    return {"op": "lookup", "x": [_cond(sheet, name), {"op": "const", "v": 0}], "table": table}


def _one_weapon(name: str, premod: dict, weapon_type: str = "catalyst") -> dict:
    return {"characters": {}, "sets": {},
            "weapons": {name.replace(" ", ""): {"name": name, "type": weapon_type, "effects": {"premod": premod}}}}


def _kagura() -> dict:
    # a sum of one term for each stack count, as GO writes Kagura's Verity: 12%, 24% and 36% Skill DMG at 1, 2 and 3 stacks
    stacks = [_when("Kagura", "Dance", str(i), _by_refinement([0.12 * i, 0.15 * i, 0.18 * i, 0.21 * i, 0.24 * i])) for i in (1, 2, 3)]
    return _one_weapon("Kagura", {"all_dmg_": _sum(*stacks)})


def _deathmatch() -> dict:
    # ATK 24% with fewer than 2 opponents; with 2 or more, ATK 16% and DEF 16%
    atk = _lookup("Deathmatch", "stack", {"oneOrNone": _by_refinement([0.24] * 5), "moreThanOne": _by_refinement([0.16] * 5)})
    return _one_weapon("Deathmatch", {"atk_": atk, "def_": _when("Deathmatch", "stack", "moreThanOne", _by_refinement([0.16] * 5))}, "polearm")


def _watatsumi() -> dict:
    # min(0.12% x the energy, 40%) at each energy from 40 to 360
    def at(energy: int) -> dict:
        ratio = {"op": "subscript", "list": [-1, 0.0012, 0.0015, 0.0018, 0.0021, 0.0024], "x": [{"op": "read", "p": "weapon.refinement"}]}
        return {"op": "min", "x": [{"op": "mul", "x": [ratio, {"op": "const", "v": energy}]}, _by_refinement([0.4, 0.5, 0.6, 0.7, 0.8])]}

    return _one_weapon("Wavewalker", {"all_dmg_": _lookup("Wavewalker", "energy", {str(e): at(e) for e in range(40, 370, 10)})}, "bow")


def _crimson() -> dict:
    # 12% with any state set, and 24% more at state 2 (Bond of Life at 30% Max HP or more): 36% in all at state 2
    return _one_weapon("Crimson", {"all_dmg_": _sum(_when("Crimson", "bond", None, 0, _by_refinement([0.12] * 5)),
                                                    _when("Crimson", "bond", "2", _by_refinement([0.24] * 5)))}, "polearm")


def _rates(item: dict, to: str) -> list[float]:
    return [e["rate"][0] if isinstance(e["rate"], list) else e["rate"] for e in item["effects"] if e["to"] == to]


def test_a_toggle_of_stack_counts_is_the_effect_at_the_top_count_never_the_counts_added():
    item = _build(_kagura())["weapons"]["kagura"]
    assert _rates(item, "dmg") == [0.36]                          # 3 stacks of 12%, not 12% + 24% + 36%
    assert [(t["state"], t["on"]) for t in item["toggles"]] == [("3", False)]


def test_a_toggle_of_two_branches_is_one_branch_never_both_added():
    item = _build(_deathmatch())["weapons"]["deathmatch"]
    assert _rates(item, "atk%") == [0.24] and _rates(item, "def%") == []   # fewer than 2 opponents: the ATK branch, with no DEF
    assert [t["state"] for t in item["toggles"]] == ["oneOrNone"]


def test_a_bonus_a_cap_holds_is_held_to_its_cap_where_the_engine_reads_no_cap():
    item = _build(_watatsumi())["weapons"]["wavewalker"]
    (effect,) = item["effects"]
    assert effect["cap"] is None and effect["rate"] == [0.4, 0.5, 0.6, 0.7, 0.8]    # 0.12% x 360 is 43.2%: held to 40%
    assert [t["state"] for t in item["toggles"]] == ["360"]


def test_a_bonus_of_a_state_and_of_any_state_adds_up_at_the_state():
    item = _build(_crimson())["weapons"]["crimson"]
    assert sum(_rates(item, "dmg")) == pytest.approx(0.36)      # the 12% of any state and the 24% more of state 2
    assert [t["state"] for t in item["toggles"]] == ["2"] and item["left_out"] == []


def test_a_weapon_that_gives_one_of_three_bonuses_at_random_is_left_out_with_its_reason():
    songs = _lookup("Widsith", "Debut", {"recitative": _by_refinement([0.6] * 5), "aria": _by_refinement([0.48] * 5),
                                         "interlude": _by_refinement([0.5] * 5)})
    item = _build(_one_weapon("The Widsith", {"atk_": songs}))["weapons"]["the-widsith"]
    assert item["effects"] == [] and item["toggles"] == []
    assert len(item["left_out"]) == 1 and "random" in item["left_out"][0]["why"]


@pytest.mark.parametrize("make, key", [(_kagura, "kagura"), (_deathmatch, "deathmatch"), (_watatsumi, "wavewalker"), (_crimson, "crimson")])
def test_no_undecided_toggle_gives_one_stat_more_than_any_one_of_its_states_does(make, key):
    kit = make()
    ((go_key, source),) = kit["weapons"].items()
    tree = source["effects"]
    ((path, path_states),) = kitgen.conditionals_in(tree).items()

    def total(effects: list[dict]) -> dict[str, float]:
        out: dict[str, float] = {}
        for e in effects:
            rate = e["rate"][-1] if isinstance(e["rate"], list) else e["rate"]
            cap = e["cap"][-1] if isinstance(e["cap"], list) else e["cap"]
            out[e["to"]] = out.get(e["to"], 0.0) + (min(rate, cap) if cap is not None else rate)
        return out

    ceiling: dict[str, float] = {}
    for state in path_states:           # the item read at each state alone
        found = kitgen.Found()
        env = {"charKey": "self", "target.charKey": "self", "activeCharKey": "self", "active.charKey": "self",
               "weapon.key": go_key, "weaponType": source["type"]}
        kitgen.read_effects(tree, env, kitgen.Context(), found, {path: state}, lambda p: f"{key}:{p.split('.', 2)[2]}")
        for to, value in total(found.effects).items():
            ceiling[to] = max(ceiling.get(to, 0.0), value)
    for to, value in total(_build(kit)["weapons"][key]["effects"]).items():
        assert value <= ceiling[to] + 1e-9, f"{key}: {to} is {value}, one state gives at most {ceiling[to]}"


def test_the_real_kits_json_holds_no_undecided_toggle_that_adds_the_same_bonus_twice_over():
    kept = json.loads(KITS.read_text(encoding="utf-8"))
    for kind in ("weapons", "sets"):
        for key, item in kept[kind].items():
            if item.get("checked"):
                continue
            seen: dict[str, int] = {}
            for e in item["effects"]:
                scope = json.dumps([e["while"], e.get("also"), e["to"], e["hits"], e["talents"], e["from"], e["reads"], e["weapon_types"],
                                    e["from_ascension"], e["from_constellation"], e["pieces"], e.get("in_talent")], sort_keys=True)
                seen[scope] = seen.get(scope, 0) + 1
            twice = [s for s, n in seen.items() if n > 1]
            if key == "crimson-moon-s-semblance":
                twice = []      # two parts that add up on purpose: 12% at any state and 24% more at state 2 (36% in all, tested above)
            assert twice == [], f"{kind}/{key}: the same effect of one toggle more than once: {twice}"
            for e in item["effects"]:
                assert not (e["from"] is None and e["cap"] is not None), f"{kind}/{key}: a cap on a bonus that is no share of a stat is never read"


def test_the_real_kits_json_reads_the_weapons_this_is_for_at_one_state():
    kept = json.loads(KITS.read_text(encoding="utf-8"))["weapons"]

    def first(item: dict, to: str) -> float:
        return sum(e["rate"][0] for e in item["effects"] if e["to"] == to)

    assert first(kept["kagura-s-verity"], "dmg:skill") == pytest.approx(0.36)           # 3 stacks of 12%
    assert first(kept["crimson-moon-s-semblance"], "dmg") == pytest.approx(0.36)         # 12% and 24% more at state 2
    assert [e["to"] for e in kept["deathmatch"]["effects"]] == ["atk%"]                  # not the DEF branch with it
    for key in ("akuoumaru", "mouun-s-moon", "wavebreaker-s-fin"):
        assert kept[key]["effects"][0]["rate"] == [0.4, 0.5, 0.6, 0.7, 0.8] and kept[key]["effects"][0]["cap"] is None, key
    for key in ("the-widsith", "forged-by-the-golden-melody"):
        assert kept[key]["toggles"] == [] and kept[key]["effects"] == [] and kept[key]["left_out"], key
