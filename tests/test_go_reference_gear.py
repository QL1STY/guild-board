"""Decisions for weapons and sets (tools/go-reference/decided/weapons/<key>.json and decided/sets/<key>.json): the same kind of file
as a character's toggles, one file for each item so that a batch of them is written in parallel. With no file a gear toggle is off,
named from its code name and switchable (what kits.json held before the files); a file decides every toggle of the item.
The trees are made up, shaped as GO's Waverider sheets write them."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"


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
refresh = _load("refresh")
run = _load("run")

SLUG = lambda text: text.lower().replace(" ", "-")  # noqa: E731
BARE = {"about": "", "checked": "", "unsure": {}, "characters": {}}
WEAPON_TOGGLE = "test-blade:stacks"
SET_TOGGLE = "test-set:set4"


def _lookup(sheet: str, state: str, values: dict[str, float]) -> dict:
    return {"op": "lookup", "x": [{"op": "read", "p": f"conditional.{sheet}.{state}"}, {"op": "const", "v": 0}],
            "table": {name: {"op": "const", "v": value} for name, value in values.items()}}


def _kit(blade: dict[str, float] | None = None, set_values: dict[str, float] | None = None) -> dict:
    blade = blade or {"1": 0.1, "2": 0.2, "3": 0.3}
    return {
        "characters": {},
        "weapons": {"TestBlade": {"name": "Test Blade", "type": "sword", "effects": {"premod": {"atk_": _lookup("TestBlade", "stacks", blade)}}}},
        "sets": {"TestSet": {"name": "Test Set", "effects": {"premod": {"atk_": _lookup("TestSet", "set4", set_values or {"on": 0.35})}}}},
    }


def _decision(on: bool = True, state: str = "2", label: str = "Stacks", covers: list[str] | None = None) -> dict:
    return {"toggles": {WEAPON_TOGGLE: {"on": on, "label": label, "state": state, "reason": "It fills from her own hits."}
                        | ({"covers": covers} if covers is not None else {})}}


def _set_decision(on: bool = True) -> dict:
    return {"toggles": {SET_TOGGLE: {"on": on, "label": "Four-piece", "state": "on", "reason": "It holds in a fight."}}}


def _build(kit: dict, weapons: dict | None = None, sets: dict | None = None) -> dict:
    decided = {**BARE, "weapons": weapons or {}, "sets": sets or {}}
    return kitgen.build(kit, {}, decided, "0" * 40, SLUG, lambda *a: "elemental")


# ----------------------------------------------------------------------------------------------- reading the folders


def _write(folder: Path, kind: str, key: str, data) -> None:
    (folder / kind).mkdir(parents=True, exist_ok=True)
    (folder / kind / f"{key}.json").write_text(json.dumps(data), encoding="utf-8")


def test_the_gear_folders_are_read_one_file_for_each_item_beside_the_characters(tmp_path):
    (tmp_path / "_about.json").write_text(json.dumps({"about": "A.", "checked": "C"}), encoding="utf-8")
    (tmp_path / "hu-tao.json").write_text(json.dumps({"toggles": {"x": {"on": True}}}), encoding="utf-8")
    _write(tmp_path, "weapons", "test-blade", _decision())
    _write(tmp_path, "sets", "test-set", _set_decision())
    decided = kitgen.load_decided(tmp_path)
    assert set(decided["characters"]) == {"hu-tao"}      # a gear file is no character's
    assert decided["weapons"] == {"test-blade": _decision()} and decided["sets"] == {"test-set": _set_decision()}


def test_with_no_gear_folder_nothing_is_decided(tmp_path):
    decided = kitgen.load_decided(tmp_path)
    assert decided["weapons"] == {} and decided["sets"] == {}


@pytest.mark.parametrize("bad, why", [
    ({"toggles": {}, "extra": 1}, "unknown fields"),
    ([1, 2], "JSON object"),
    ({"toggles": {WEAPON_TOGGLE: {"on": True, "label": "L", "state": "1"}}}, "reason"),
    ({"toggles": {WEAPON_TOGGLE: {"on": "yes", "label": "L", "state": "1", "reason": "r"}}}, "on"),
    ({"toggles": {WEAPON_TOGGLE: {"on": True, "label": "", "state": "1", "reason": "r"}}}, "label"),
    ({"toggles": {WEAPON_TOGGLE: {"on": True, "label": "L", "state": "1", "reason": "r", "covers": "burst"}}}, "covers"),
    ({"toggles": {WEAPON_TOGGLE: {"on": True, "label": "L", "state": "1", "reason": "r", "colour": 1}}}, "unknown"),
    ({"toggles": {"other:stacks": {"on": True, "label": "L", "state": "1", "reason": "r"}}}, "test-blade"),
    ({}, "toggles"),
])
def test_a_malformed_gear_file_is_refused_with_its_name(tmp_path, bad, why):
    _write(tmp_path, "weapons", "test-blade", bad)
    with pytest.raises(SystemExit, match=f"test-blade.json.*{why}"):
        kitgen.load_decided(tmp_path)


def test_a_gear_file_that_is_not_json_is_refused(tmp_path):
    (tmp_path / "sets").mkdir()
    (tmp_path / "sets" / "test-set.json").write_text("{ not json", encoding="utf-8")
    with pytest.raises(SystemExit, match="test-set.json"):
        kitgen.load_decided(tmp_path)


def test_the_stale_folder_and_other_files_are_not_read_as_decisions(tmp_path):
    _write(tmp_path / "_stale", "weapons", "test-blade.aaaaaaaa", _decision())
    (tmp_path / "weapons").mkdir()
    (tmp_path / "weapons" / "notes.txt").write_text("not a decision", encoding="utf-8")
    decided = kitgen.load_decided(tmp_path)
    assert decided["weapons"] == {}


# ----------------------------------------------------------------------------------------------- building


def test_with_no_file_a_gear_toggle_is_off_named_from_its_code_name_and_the_item_is_not_checked():
    kits = _build(_kit())
    blade, held = kits["weapons"]["test-blade"], kits["sets"]["test-set"]
    assert blade["toggles"] == [{"name": WEAPON_TOGGLE, "label": "Stacks", "on": False, "covers": [], "state": "3"}]
    assert held["toggles"] == [{"name": SET_TOGGLE, "label": "Set4", "on": False, "covers": [], "state": "on"}]
    assert "checked" not in blade and "checked" not in held
    assert [e["rate"] for e in blade["effects"]] == [0.3]           # read at the state that gives the most


def test_a_label_in_the_table_that_no_undecided_toggle_uses_stops_the_run():
    labels = {WEAPON_TOGGLE: "ATK bonus at 3 stacks", SET_TOGGLE: "4-piece ATK bonus"}

    def build(table: dict, weapons: dict | None = None) -> dict:
        decided = {**BARE, "weapons": weapons or {}, "sets": {}, "gear_labels": table}
        return kitgen.build(_kit(), {}, decided, "0" * 40, SLUG, lambda *a: "elemental")

    assert build(labels)["weapons"]["test-blade"]["toggles"][0]["label"] == "ATK bonus at 3 stacks"
    with pytest.raises(SystemExit, match=r"unused.*test-blade:gone"):
        build({**labels, "test-blade:gone": "A toggle GO no longer has"})
    with pytest.raises(SystemExit, match=r"unused.*test-blade:stacks"):
        build(labels, weapons={"test-blade": _decision()})       # its decision file names it: the table's label is not used


def test_a_file_decides_the_toggle_its_state_and_makes_the_item_checked():
    kits = _build(_kit(), weapons={"test-blade": _decision(on=True, state="2", label="Her stacks", covers=["burst"])},
                  sets={"test-set": _set_decision(on=True)})
    blade, held = kits["weapons"]["test-blade"], kits["sets"]["test-set"]
    assert blade["toggles"] == [{"name": WEAPON_TOGGLE, "label": "Her stacks", "on": True, "covers": ["burst"], "state": "2"}]
    assert [e["rate"] for e in blade["effects"]] == [0.2]           # the state decided is the state the effect is read at
    assert blade["checked"] is True and held["checked"] is True and held["toggles"][0]["on"] is True
    assert kits["weapons"]["test-blade"]["go_key"] == "TestBlade"


def test_deciding_one_item_leaves_the_others_as_they_were():
    plain = _build(_kit())
    decided = _build(_kit(), weapons={"test-blade": _decision()})
    assert decided["sets"] == plain["sets"]


def test_a_decision_that_misses_or_adds_a_toggle_is_refused():
    both = {"toggles": {**_decision()["toggles"], "test-blade:other": {"on": False, "label": "O", "state": "1", "reason": "r"}}}
    with pytest.raises(SystemExit, match="toggles the kit does not have"):
        _build(_kit(), weapons={"test-blade": both})
    with pytest.raises(SystemExit, match="does not decide"):
        _build(_kit(), weapons={"test-blade": {"toggles": {}}})


def test_a_decision_for_an_item_GO_does_not_have_is_refused():
    with pytest.raises(SystemExit, match="decided/ names weapons GO does not have: \\['gone'\\]"):
        _build(_kit(), weapons={"gone": _decision()})
    with pytest.raises(SystemExit, match="decided/ names sets GO does not have: \\['gone'\\]"):
        _build(_kit(), sets={"gone": _set_decision()})


def test_a_state_the_toggle_does_not_have_is_refused():
    with pytest.raises(SystemExit, match="state"):
        _build(_kit(), weapons={"test-blade": _decision(state="9")})


def test_the_schema_lets_a_decided_item_say_so_and_holds_no_other_field():
    gear = kitgen.schema()["properties"]["weapons"]["additionalProperties"]
    assert gear["properties"]["checked"] == {"type": "boolean"} and "checked" not in gear["required"]


# ----------------------------------------------------------------------------------------------- a weapon's numbers at level 90


def test_a_weapon_keeps_its_exact_base_atk_and_substat_at_level_90_in_the_references_keys():
    # the wiki's numbers the app's reference holds are these rounded (454 for 454.36): the planner reads these instead
    kit = _kit()
    kit["weapons"]["TestBlade"]["level_90"] = {"main": 454.36315250000007, "sub": 0.689711002, "sub_key": "physical_dmg_"}
    kit["weapons"]["Mastery"] = {"name": "Mastery", "type": "catalyst", "effects": {},
                                 "level_90": {"main": 541.829758, "sub": 264.61440000000005, "sub_key": "eleMas"}}
    kit["weapons"]["Dull"] = {"name": "Dull", "type": "sword", "effects": {}, "level_90": {"main": 185.0, "sub": None, "sub_key": None}}
    weapons = _build(kit)["weapons"]
    assert weapons["test-blade"]["level_90"] == {"base_atk": 454.3632, "sub": "phys", "sub_value": 0.689711}
    assert weapons["mastery"]["level_90"] == {"base_atk": 541.8298, "sub": "em", "sub_value": 264.6144}
    assert weapons["dull"]["level_90"] == {"base_atk": 185.0, "sub": None, "sub_value": None}
    assert "level_90" not in _build(_kit())["weapons"]["test-blade"] and "level_90" not in _build(_kit())["sets"]["test-set"]
    gear = kitgen.schema()["properties"]["weapons"]["additionalProperties"]
    assert "level_90" in gear["properties"] and "level_90" not in gear["required"]


def test_run_kits_writes_the_small_levels_file_beside_kits_json(tmp_path, monkeypatch):
    # the references read this file and not the 1 MB kits.json (`reference.load_weapon_levels`); the one generator writes both
    kit = _kit()
    kit["weapons"]["TestBlade"]["level_90"] = {"main": 454.36315250000007, "sub": 0.689711002, "sub_key": "physical_dmg_"}
    monkeypatch.setattr(run, "KITS", tmp_path / "kits.json")
    monkeypatch.setattr(run, "LEVELS", tmp_path / "weapon-levels.json")
    monkeypatch.setattr(run, "SCHEMA", tmp_path / "kits.schema.json")
    run.save_kits(_build(kit))
    assert json.loads((tmp_path / "weapon-levels.json").read_text(encoding="utf-8")) == {
        "test-blade": {"base_atk": 454.3632, "sub": "phys", "sub_value": 0.689711}}


def test_the_real_kits_json_has_the_numbers_at_level_90_of_every_weapon_that_reaches_it():
    folder = ROOT / "src" / "guildboard" / "reference" / "characters"
    real = json.loads((folder / "kits.json").read_text(encoding="utf-8"))["weapons"]
    reference = json.loads((folder / "weapons.json").read_text(encoding="utf-8"))["weapons"]
    # 1- and 2-star weapons stop at level 70; every other one the reference holds has them, with the reference's substat, and the
    # reference's numbers are these rounded
    for key, ref in reference.items():
        exact = real[key].get("level_90")
        if ref["rarity"] < 3:
            assert exact is None, key
            continue
        assert exact is not None and exact["sub"] == ref.get("sub"), key
        assert abs(exact["base_atk"] - ref["base_atk_90"]) <= 0.5, key
        if ref.get("sub"):
            points = exact["sub_value"] if ref["sub"] == "em" else exact["sub_value"] * 100
            assert abs(points - ref["sub_90"]) <= (0.5 if ref["sub"] == "em" else 0.05), key
    assert real["compound-bow"]["level_90"] == {"base_atk": 454.3632, "sub": "phys", "sub_value": 0.689711}


# ----------------------------------------------------------------------------------------------- the stale guard


def test_kits_json_that_does_not_hold_a_gear_decision_is_told_what_differs():
    kept = _build(_kit(), weapons={"test-blade": _decision()})["weapons"]["test-blade"]
    mine = _decision()
    assert kitgen.gear_differences(mine, kept) == []
    assert kitgen.gear_differences(_decision(on=False), kept) == [f"toggle {WEAPON_TOGGLE}: on"]
    assert kitgen.gear_differences(_decision(label="Other", state="3", covers=["skill"]), kept) == [
        f"toggle {WEAPON_TOGGLE}: label", f"toggle {WEAPON_TOGGLE}: covers", f"toggle {WEAPON_TOGGLE}: state"]
    assert kitgen.gear_differences({"toggles": {}}, kept) == ["toggles"]
    assert kitgen.gear_differences(None, kept) == ["checked"]


def test_an_item_with_no_file_must_hold_the_undecided_reading():
    kept = _build(_kit())["weapons"]["test-blade"]
    assert kitgen.gear_differences(None, kept) == []
    assert kitgen.gear_differences(_decision(), kept) == ["checked"]
    switched = json.loads(json.dumps(kept))
    switched["toggles"][0]["on"] = True            # a decision file removed, kits.json not made again
    assert kitgen.gear_differences(None, switched) == ["toggle test-blade:stacks: on"]


def test_run_finds_the_gear_whose_decision_kits_json_does_not_hold(monkeypatch):
    kits = _build(_kit(), weapons={"test-blade": _decision()})
    monkeypatch.setattr(run, "_kept_kits", lambda: kits)
    decided = {**BARE, "weapons": {"test-blade": _decision()}, "sets": {}}
    assert run._stale_gear(decided) == []
    decided["weapons"]["test-blade"] = _decision(on=False)
    decided["sets"] = {"test-set": _set_decision()}
    assert run._stale_gear(decided) == ["weapons/test-blade", "sets/test-set"]


def test_the_real_kits_json_holds_every_gear_decision_file_as_written():
    decided = kitgen.load_decided(TOOL / "decided")
    kept = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))
    for kind in ("weapons", "sets"):
        assert set(decided[kind]) <= set(kept[kind]), f"decided/{kind}/ names items kits.json does not have"
        for key, item in kept[kind].items():
            assert kitgen.gear_differences(decided[kind].get(key), item, decided["gear_labels"]) == [], f"{kind}/{key}"


# ----------------------------------------------------------------------------------------------- refresh


def _each(kit: dict, decided: dict) -> dict:
    return refresh.build_each(kit, {}, decided, "a" * 40, SLUG, lambda *a: "elemental")


def test_a_gear_decision_alone_is_never_a_change_of_its_sheet():
    # both builds read the same decisions, and what a decision fills in (checked, a toggle's on, label and covers) is not the sheet
    kit = _kit()
    old = {**BARE, "weapons": {"test-blade": _decision(on=True)}, "sets": {"test-set": _set_decision(on=True)}}
    new = {**BARE, "weapons": {"test-blade": _decision(on=False, label="Other")}, "sets": {"test-set": _set_decision(on=False)}}
    changes = refresh.changed_sheets(_each(kit, old), _each(kit, new))
    assert changes["weapons"]["changed"] == {} and changes["sets"]["changed"] == {}


def test_a_decided_item_whose_numbers_changed_at_a_state_it_did_not_pick_is_listed():
    decided = {**BARE, "weapons": {"test-blade": _decision(state="1")}, "sets": {}}
    old = _each(_kit({"1": 0.1, "2": 0.2}), decided)
    new = _each(_kit({"1": 0.1, "2": 0.25}), decided)
    assert "undecided" in refresh.changed_sheets(old, new)["weapons"]["changed"]["test-blade"]


def test_a_gear_sheet_that_changed_is_listed_and_so_is_one_whose_decision_no_longer_fits():
    decided = {**BARE, "weapons": {"test-blade": _decision()}, "sets": {}}
    old = _each(_kit(), decided)
    changes = refresh.changed_sheets(old, _each(_kit({"1": 0.1, "2": 0.25, "3": 0.3}), decided))
    assert list(changes["weapons"]["changed"]) == ["test-blade"]
    renamed = _kit()
    renamed["weapons"]["TestBlade"]["effects"]["premod"]["atk_"] = _lookup("TestBlade", "layers", {"1": 0.1, "2": 0.2})
    changes = refresh.changed_sheets(old, _each(renamed, decided))
    assert "decision" in changes["weapons"]["changed"]["test-blade"][0]


def test_a_gear_decision_the_new_state_list_no_longer_fits_makes_the_item_changed():
    decided = {**BARE, "weapons": {"test-blade": _decision(state="2")}, "sets": {}}
    old = _each(_kit(), decided)
    new = _each(_kit({"1": 0.1, "3": 0.3}), decided)            # GO dropped the state 2
    assert "decision" in refresh.changed_sheets(old, new)["weapons"]["changed"]["test-blade"][0]


def _folder(tmp_path: Path) -> Path:
    folder = tmp_path / "decided"
    _write(folder, "weapons", "test-blade", _decision())
    _write(folder, "weapons", "kept-blade", {"toggles": {"kept-blade:stacks": _decision()["toggles"][WEAPON_TOGGLE]}})
    _write(folder, "sets", "test-set", _set_decision())
    (folder / "alpha.json").write_text(json.dumps({"toggles": {}}), encoding="utf-8")
    return folder


def _changes(**parts) -> dict:
    empty = {"changed": {}, "added": [], "removed": []}
    return {"characters": {**empty, **parts.get("characters", {})}, "weapons": {**empty, **parts.get("weapons", {})},
            "sets": {**empty, **parts.get("sets", {})}}


def test_the_plan_puts_a_changed_gear_decision_aside_under_its_own_stale_folder(tmp_path):
    folder = _folder(tmp_path)
    changes = _changes(characters={"changed": {"alpha": ["effects"]}}, weapons={"changed": {"test-blade": ["effects"]}},
                       sets={"removed": ["test-set"]})
    plan = refresh.plan_resets(changes, folder, "a" * 40)
    assert [(key, source.relative_to(folder).as_posix(), target.relative_to(folder).as_posix()) for key, source, target in plan] == [
        ("alpha", "alpha.json", f"_stale/alpha.{'a' * 8}.json"),
        ("weapons/test-blade", "weapons/test-blade.json", f"_stale/weapons/test-blade.{'a' * 8}.json"),
        ("sets/test-set", "sets/test-set.json", f"_stale/sets/test-set.{'a' * 8}.json")]
    refresh.apply_resets(plan)
    assert not (folder / "weapons" / "test-blade.json").exists() and (folder / "weapons" / "kept-blade.json").exists()
    assert (folder / "_stale" / "weapons" / f"test-blade.{'a' * 8}.json").is_file()
    decided = kitgen.load_decided(folder)
    assert set(decided["weapons"]) == {"kept-blade"} and decided["sets"] == {}


def test_without_takes_the_put_aside_gear_decisions_out_of_what_the_new_kits_are_built_with():
    decided = {**BARE, "weapons": {"a": 1, "b": 2}, "sets": {"c": 3}}
    assert refresh.without(decided, ["weapons/a", "sets/c"]) == {**BARE, "weapons": {"b": 2}, "sets": {}}


def test_the_report_names_a_put_aside_gear_decision(tmp_path):
    folder = _folder(tmp_path)
    plan = refresh.plan_resets(_changes(weapons={"changed": {"test-blade": ["effects"]}}), folder, "a" * 40)
    lines = refresh.report("a" * 40, "b" * 40, _changes(weapons={"changed": {"test-blade": ["effects"]}}), plan, folder, False)
    assert any("weapons/test-blade: _stale/weapons/" in line for line in lines)
    assert not any("have no decision files" in line for line in lines)


def test_two_go_weapons_with_one_key_stop_the_refresh_build_and_are_no_item_error():
    kit = _kit()
    kit["weapons"]["TestBlade2"] = dict(kit["weapons"]["TestBlade"])
    with pytest.raises(SystemExit, match="two GO weapons give the key test-blade"):
        _each(kit, {**BARE, "weapons": {}, "sets": {}})
