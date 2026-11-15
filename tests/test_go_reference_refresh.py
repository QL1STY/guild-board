"""tools/go-reference/refresh.py and `run.py refresh`: moving the pin to a new Genshin Optimizer commit, listing every character,
weapon and set whose sheet changed, and putting the changed characters' decisions aside until a person decides them again.
Nothing here needs GO or the network: the two extractions are small made-up gb-kit.json / gb-match.json."""
from __future__ import annotations

import importlib.util
import json
import re
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

OLD, NEW = "a" * 40, "b" * 40


def _read(path: str) -> dict:
    return {"op": "read", "p": path}


def _char(name: str, stack_values: dict[str, float], *, state_name: str = "stacks") -> tuple[dict, dict]:
    """A character with one effect that depends on one of her states (a toggle), as gb-kit.json and gb-match.json hold her."""
    tree = {"op": "lookup", "x": [_read(f"conditional.{name}.{state_name}"), {"op": "const", "v": 0}],
            "table": {state: {"op": "const", "v": value} for state, value in stack_values.items()}}
    sheet = {"effects": {"premod": {"atk_": tree}}, "hit_data": {}}
    match = {"name": name, "sheet": name, "element": "pyro", "weapon_type": "sword", "hits": [], "rows": {}, "params": {}}
    return sheet, match


def _data(chars: dict[str, dict[str, float]], weapons: dict | None = None, **kwargs) -> tuple[dict, dict]:
    kit: dict = {"characters": {}, "weapons": weapons or {}, "sets": {}}
    match: dict = {}
    for name, values in chars.items():
        kit["characters"][name], match[name] = _char(name, values, **kwargs)
    return kit, match


def _weapon(bonus: float) -> dict:
    return {"name": "Test Blade", "type": "sword", "effects": {"premod": {"atk_": {"op": "const", "v": bonus}}}}


def _build(kit: dict, match: dict, decided: dict | None = None, commit: str = OLD) -> dict:
    return refresh.build_each(kit, match, decided or {"about": "", "checked": "", "unsure": {}, "characters": {}}, commit,
                              lambda text: text.lower().replace(" ", "-"), lambda *a: "elemental")


def _decision(on: bool = True) -> dict:
    return {"main": None, "toggles": {"stacks": {"on": on, "label": "Stacks", "state": "2", "reason": "r"}}}


BASE = {"Alpha": {"1": 0.1, "2": 0.2}, "Beta": {"1": 0.1, "2": 0.2}}


# ----------------------------------------------------------------------------------------------- what changed


def test_the_same_extraction_twice_changes_nothing():
    kit, match = _data(BASE, {"TestBlade": _weapon(0.1)})
    changes = refresh.changed_sheets(_build(kit, match), _build(kit, match, commit=NEW))
    assert all(not part["changed"] and not part["added"] and not part["removed"] for part in changes.values())


def test_a_character_whose_numbers_changed_is_listed_with_what_changed_and_the_other_is_not():
    old = _build(*_data(BASE))
    new = _build(*_data({**BASE, "Beta": {"1": 0.1, "2": 0.25}}), commit=NEW)
    changes = refresh.changed_sheets(old, new)
    assert changes["characters"]["changed"] == {"beta": ["effects"]}
    assert changes["weapons"]["changed"] == {} and changes["sets"]["changed"] == {}


def test_a_decision_alone_is_never_a_change_of_the_sheet():
    # the two builds read the same decisions, and what a decision fills in (checked, main, a toggle's on, label and covers) is
    # not the sheet; only the commit differs, and the source line names it
    kit, match = _data(BASE)
    decided = {"about": "", "checked": "", "unsure": {"alpha": "Sentence."}, "characters": {"alpha": _decision(True)}}
    other = {**decided, "characters": {"alpha": _decision(False)}}
    changes = refresh.changed_sheets(_build(kit, match, decided), _build(kit, match, other, commit=NEW))
    assert changes["characters"]["changed"] == {}


def test_a_new_and_a_removed_character_a_changed_weapon_and_a_new_set_are_listed():
    old = _build(*_data({"Alpha": BASE["Alpha"], "Gone": BASE["Beta"]}, {"TestBlade": _weapon(0.1)}))
    kit, match = _data({"Alpha": BASE["Alpha"], "Fresh": BASE["Beta"]}, {"TestBlade": _weapon(0.2)})
    kit["sets"] = {"TestSet": {"name": "Test Set", "effects": {"premod": {"atk_": {"op": "const", "v": 0.18}}}}}
    changes = refresh.changed_sheets(old, _build(kit, match, commit=NEW))
    assert changes["characters"]["added"] == ["fresh"] and changes["characters"]["removed"] == ["gone"]
    assert list(changes["weapons"]["changed"]) == ["test-blade"]
    assert changes["sets"]["added"] == ["test-set"]


def test_a_decision_that_no_longer_fits_the_new_sheet_makes_her_changed():
    # GO renamed her state: her decision file names a toggle the new kit does not have, which kitgen.build refuses
    decided = {"about": "", "checked": "", "unsure": {}, "characters": {"alpha": _decision()}}
    old = _build(*_data({"Alpha": BASE["Alpha"]}), decided)
    new = _build(*_data({"Alpha": BASE["Alpha"]}, state_name="layers"), decided, commit=NEW)
    assert "error" in new["characters"]["alpha"] and "error" not in old["characters"]["alpha"]
    changes = refresh.changed_sheets(old, new)
    assert list(changes["characters"]["changed"]) == ["alpha"]
    assert "decision" in changes["characters"]["changed"]["alpha"][0]


def test_a_decided_character_whose_toggle_gains_a_state_is_listed_though_her_decided_build_is_the_same():
    # her file picks state "2"; GO adds a state "3": at "2" her effects are the same, but her sheet is not
    decided = {"about": "", "checked": "", "unsure": {}, "characters": {"alpha": _decision()}}
    old = _build(*_data({"Alpha": {"1": 0.1, "2": 0.2}}), decided)
    new = _build(*_data({"Alpha": {"1": 0.1, "2": 0.2, "3": 0.3}}), decided, commit=NEW)
    changes = refresh.changed_sheets(old, new)
    assert "states" in changes["characters"]["changed"]["alpha"]


def test_a_decided_character_whose_numbers_changed_at_a_state_she_did_not_pick_is_listed():
    decided = {"about": "", "checked": "", "unsure": {}, "characters": {"alpha": {**_decision(), "toggles": {
        "stacks": {"on": True, "label": "Stacks", "state": "1", "reason": "r"}}}}}
    old = _build(*_data({"Alpha": {"1": 0.1, "2": 0.2}}), decided)
    new = _build(*_data({"Alpha": {"1": 0.1, "2": 0.25}}), decided, commit=NEW)
    assert "undecided" in refresh.changed_sheets(old, new)["characters"]["changed"]["alpha"]


def test_two_go_characters_with_one_key_are_refused():
    kit, match = _data({"Alpha": BASE["Alpha"], "Alpha2": BASE["Beta"]})
    match["Alpha2"]["name"] = "Alpha"
    with pytest.raises(SystemExit, match="two GO characters"):
        _build(kit, match)


# ----------------------------------------------------------------------------------------------- the resets


def _folder(tmp_path: Path) -> Path:
    folder = tmp_path / "decided"
    folder.mkdir()
    (folder / "_about.json").write_text(json.dumps({"about": "A.", "checked": "C"}), encoding="utf-8")
    (folder / "alpha.json").write_text(json.dumps(_decision()), encoding="utf-8")
    (folder / "beta.json").write_text(json.dumps(_decision()), encoding="utf-8")
    (folder / "gamma.json").write_text(json.dumps({"unsure": "Sometimes."}), encoding="utf-8")
    return folder


def _changes(**characters) -> dict:
    empty = {"changed": {}, "added": [], "removed": []}
    return {"characters": {**empty, **characters}, "weapons": dict(empty), "sets": dict(empty)}


def test_the_plan_names_the_file_and_where_it_goes(tmp_path):
    folder = _folder(tmp_path)
    plan = refresh.plan_resets(_changes(changed={"alpha": ["effects"], "delta": ["hits"]}, removed=["gamma"]), folder, OLD)
    assert [(key, source.name, target.relative_to(folder).as_posix()) for key, source, target in plan] == [
        ("alpha", "alpha.json", f"_stale/alpha.{OLD[:8]}.json"), ("gamma", "gamma.json", f"_stale/gamma.{OLD[:8]}.json")]


def test_a_reset_moves_the_file_aside_keeps_its_words_and_the_folder_reads_without_her(tmp_path):
    folder = _folder(tmp_path)
    before = (folder / "alpha.json").read_text(encoding="utf-8")
    plan = refresh.plan_resets(_changes(changed={"alpha": ["effects"]}), folder, OLD)
    refresh.apply_resets(plan)
    assert not (folder / "alpha.json").exists()
    assert (folder / "_stale" / f"alpha.{OLD[:8]}.json").read_text(encoding="utf-8") == before
    decided = kitgen.load_decided(folder)
    assert set(decided["characters"]) == {"beta"} and decided["unsure"] == {"gamma": "Sometimes."}
    assert decided["about"] == "A."


def test_a_second_reset_of_the_same_character_at_the_same_pin_never_overwrites_the_first(tmp_path):
    folder = _folder(tmp_path)
    refresh.apply_resets(refresh.plan_resets(_changes(changed={"alpha": ["x"]}), folder, OLD))
    (folder / "alpha.json").write_text(json.dumps({"toggles": {}}), encoding="utf-8")
    refresh.apply_resets(refresh.plan_resets(_changes(changed={"alpha": ["x"]}), folder, OLD))
    stale = sorted(path.name for path in (folder / "_stale").iterdir())
    assert len(stale) == 2 and all(name.startswith("alpha.") for name in stale)


# ----------------------------------------------------------------------------------------------- the pin


def _pin_files(tmp_path: Path, pinned: str = OLD) -> list[Path]:
    files = {"run.py": f'PINNED = "{pinned}"\n', "setup.ps1": f"$Commit = '{pinned}'   # run.py's PINNED\n",
             "README.md": f'**Pinned commit:** `{pinned}` ("1.15.0+zo", 2026-11-13). It is written in `run.py`.\n',
             "THIRD-PARTY-NOTICES.txt": f"commit\n{pinned}, by a tool that runs at build time\n"}
    out = []
    for name, text in files.items():
        (tmp_path / name).write_text(text, encoding="utf-8")
        out.append(tmp_path / name)
    return out


def test_the_pin_moves_in_the_three_places_together(tmp_path):
    files = _pin_files(tmp_path)
    refresh.repin(files, OLD, NEW, "2026-12-01")
    run_py, setup, readme, notices = (path.read_text(encoding="utf-8") for path in files)
    assert f'PINNED = "{NEW}"' in run_py and f"$Commit = '{NEW}'" in setup and NEW in notices
    assert f"`{NEW}`" in readme and OLD not in run_py + setup + readme + notices
    assert "2026-12-01" in readme and "1.15.0+zo" not in readme


def test_a_pin_that_is_missing_from_a_file_moves_none_of_them(tmp_path):
    files = _pin_files(tmp_path)
    files[1].write_text("$Commit = 'nothing'\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="setup.ps1"):
        refresh.repin(files, OLD, NEW, None)
    assert OLD in files[0].read_text(encoding="utf-8") and NEW not in files[0].read_text(encoding="utf-8")


def test_the_real_pin_files_say_where_the_pin_is():
    # repin finds the commit in all three files (a test elsewhere asserts they agree)
    pinned = re.search(r'PINNED = "([0-9a-f]{40})"', (TOOL / "run.py").read_text(encoding="utf-8")).group(1)
    for path in run.PIN_FILES:
        assert pinned in path.read_text(encoding="utf-8"), path.name
    assert tuple(path.name for path in run.PIN_FILES) == ("run.py", "setup.ps1", "README.md", "THIRD-PARTY-NOTICES.txt")


# ----------------------------------------------------------------------------------------------- the command


def _write_extraction(folder: Path, kit: dict, match: dict) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "gb-kit.json").write_text(json.dumps(kit), encoding="utf-8")
    (folder / "gb-match.json").write_text(json.dumps(match), encoding="utf-8")
    return folder


@pytest.fixture
def world(monkeypatch, tmp_path):
    """The tool's files in a temporary folder: decisions, the three pin files, kits.json and its schema, and two extractions."""
    decided = _folder(tmp_path)
    (decided / "beta.json").unlink()
    (decided / "gamma.json").unlink()
    pins = _pin_files(tmp_path)
    monkeypatch.setattr(run, "DECIDED", decided)
    monkeypatch.setattr(run, "KITS", tmp_path / "kits.json")
    monkeypatch.setattr(run, "SCHEMA", tmp_path / "schema.json")
    monkeypatch.setattr(run, "LEVELS", tmp_path / "weapon-levels.json")
    monkeypatch.setattr(run, "PIN_FILES", tuple(pins))
    monkeypatch.setattr(run, "PINNED", OLD)
    monkeypatch.setattr(run, "compare_command", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no comparison here")))
    old = _write_extraction(tmp_path / "old", *_data(BASE))
    new = _write_extraction(tmp_path / "new", *_data({**BASE, "Alpha": {"1": 0.1, "2": 0.3}}))
    return {"decided": decided, "pins": pins, "old": old, "new": new, "kits": tmp_path / "kits.json"}


@pytest.fixture(autouse=True)
def _go_is_at_the_new_commit(monkeypatch):
    # the comparison needs GO at the new commit; with --new-from it is checked before anything is written
    monkeypatch.setattr(run, "commit_of", lambda go: NEW)


def _refresh(world, *flags: str) -> int:
    return run.main(["refresh", NEW, "--old-from", str(world["old"]), "--new-from", str(world["new"]), *flags])


def test_a_dry_run_says_what_would_change_and_changes_nothing(world, capsys):
    before = {path: path.read_bytes() for path in [*world["pins"], *world["decided"].rglob("*.json")]}
    assert _refresh(world, "--dry-run") == 0
    out = capsys.readouterr().out
    assert "alpha" in out and "effects" in out and "beta" not in out and "would" in out
    assert {path: path.read_bytes() for path in [*world["pins"], *world["decided"].rglob("*.json")]} == before
    assert not world["kits"].exists() and run.PINNED == OLD and not (world["decided"] / "_stale").exists()


def test_a_refresh_moves_the_pin_resets_the_changed_decision_and_writes_kits_for_the_new_commit(world, capsys):
    assert _refresh(world, "--no-compare") == 0
    out = capsys.readouterr().out
    assert "alpha" in out and f"alpha.{OLD[:8]}.json" in out
    assert not (world["decided"] / "alpha.json").exists() and (world["decided"] / "_stale" / f"alpha.{OLD[:8]}.json").exists()
    kits = json.loads(world["kits"].read_text(encoding="utf-8"))
    assert kits["go_commit"] == NEW and kits["characters"]["alpha"]["checked"] is False
    assert f'PINNED = "{NEW}"' in world["pins"][0].read_text(encoding="utf-8")
    assert run.PINNED == NEW


def test_a_refresh_runs_the_comparison_unless_told_not_to(world, monkeypatch):
    calls = []
    monkeypatch.setattr(run, "compare_command", lambda *a, **k: calls.append((a, k)) or 0)
    assert _refresh(world) == 0 and len(calls) == 1
    # a second, unchanged refresh would not be one: the new pin is the old now
    with pytest.raises(SystemExit, match="already"):
        run.main(["refresh", NEW, "--old-from", str(world["old"]), "--new-from", str(world["new"])])


def test_new_from_without_go_at_the_new_commit_refuses_the_comparison_before_anything_is_written(world, monkeypatch):
    monkeypatch.setattr(run, "commit_of", lambda go: OLD)
    before = {path: path.read_bytes() for path in [*world["pins"], *world["decided"].rglob("*.json")]}
    with pytest.raises(SystemExit, match="--no-compare"):
        _refresh(world)
    assert {path: path.read_bytes() for path in [*world["pins"], *world["decided"].rglob("*.json")]} == before
    assert _refresh(world, "--no-compare") == 0          # without the comparison it needs no GO


def test_a_refresh_wants_a_whole_commit(world):
    with pytest.raises(SystemExit, match="40"):
        run.main(["refresh", "main", "--old-from", str(world["old"]), "--new-from", str(world["new"])])


def test_the_command_keeps_a_character_with_nothing_changed_decided(world):
    (world["decided"] / "beta.json").write_text(json.dumps(_decision()), encoding="utf-8")
    assert _refresh(world, "--no-compare") == 0
    kits = json.loads(world["kits"].read_text(encoding="utf-8"))
    assert kits["characters"]["beta"]["checked"] is True and (world["decided"] / "beta.json").exists()


def test_the_command_is_documented():
    readme = (TOOL / "README.md").read_text(encoding="utf-8")
    assert "run.py refresh" in readme and "_stale" in readme
    # The public tree carries CLAUDE.public.md as its CLAUDE.md and no CLAUDE.public.md.
    for name in ("CLAUDE.md", "CLAUDE.public.md"):
        if (ROOT / name).exists():
            assert "run.py refresh" in (ROOT / name).read_text(encoding="utf-8")


# ----------------------------------------------------------------------------------------------- nothing half done


def _snapshot(world) -> dict:
    return {path: path.read_bytes() for path in [*world["pins"], *world["decided"].rglob("*.json")]}


def test_a_refresh_does_not_start_when_the_old_pin_does_not_build_with_the_decisions(world):
    # her file decides a state the old extraction does not have: the folder and the old pin disagree already
    (world["decided"] / "beta.json").write_text(
        json.dumps({"toggles": {"layers": {"on": True, "label": "L", "state": "1"}}}), encoding="utf-8")
    before = _snapshot(world)
    with pytest.raises(SystemExit, match="beta"):
        _refresh(world, "--no-compare")
    assert _snapshot(world) == before


def test_a_refresh_does_not_start_when_a_decision_names_a_character_the_old_pin_lacks(world):
    (world["decided"] / "ghost.json").write_text(json.dumps(_decision()), encoding="utf-8")
    with pytest.raises(SystemExit, match="ghost"):
        _refresh(world, "--no-compare")
    assert (world["decided"] / "ghost.json").exists() and not world["kits"].exists()


def test_the_new_kits_are_built_before_any_file_is_written(world, monkeypatch):
    def broken(*args, **kwargs):
        raise SystemExit("the new kits do not build")

    monkeypatch.setattr(run, "make_kits", broken)
    before = _snapshot(world)
    with pytest.raises(SystemExit, match="do not build"):
        _refresh(world, "--no-compare")
    assert _snapshot(world) == before
    assert not world["kits"].exists() and run.PINNED == OLD and not (world["decided"] / "_stale").exists()


@pytest.fixture
def go(world, monkeypatch, tmp_path):
    """GO's checkout stood in for: the extractions come from the world's folders, and every checkout is recorded."""
    from types import SimpleNamespace

    monkeypatch.delenv("GB_OUT_DIR", raising=False)
    monkeypatch.setattr(run, "go_dir", lambda: tmp_path / "go")
    at = {"commit": OLD}
    calls = []
    monkeypatch.setattr(run, "commit_of", lambda folder: at["commit"])
    monkeypatch.setattr(run, "_extract", lambda folder, out: world["old"] if out.name == "refresh-old" else world["new"])
    monkeypatch.setattr(run, "_git", lambda folder, *args: SimpleNamespace(returncode=0, stdout="2026-12-01\n", stderr=""))

    def check_out(folder, commit, fetch):
        calls.append(commit)
        at["commit"] = commit

    monkeypatch.setattr(run, "_check_out", check_out)
    return calls


def test_a_dry_run_puts_gos_checkout_back_and_a_real_one_leaves_it_at_the_new_commit(world, go):
    assert run.main(["refresh", NEW, "--dry-run"]) == 0
    assert go == [NEW, OLD]
    go.clear()
    assert run.main(["refresh", NEW, "--no-compare"]) == 0
    assert go == [NEW] and run.PINNED == NEW


def test_a_failure_before_any_write_puts_the_checkout_back(world, go, monkeypatch):
    monkeypatch.setattr(run, "make_kits", lambda *a, **k: (_ for _ in ()).throw(SystemExit("the new kits do not build")))
    with pytest.raises(SystemExit, match="do not build"):
        run.main(["refresh", NEW, "--no-compare"])
    assert go == [NEW, OLD]


def test_a_checkout_that_cannot_be_put_back_does_not_hide_the_first_error(world, go, monkeypatch, capsys):
    def check_out(folder, commit, fetch):
        if commit == OLD:
            raise SystemExit("Could not check out the old pin")

    monkeypatch.setattr(run, "_check_out", check_out)
    monkeypatch.setattr(run, "make_kits", lambda *a, **k: (_ for _ in ()).throw(SystemExit("the new kits do not build")))
    with pytest.raises(SystemExit, match="do not build"):
        run.main(["refresh", NEW, "--no-compare"])
    assert "Could not check out the old pin" in capsys.readouterr().err
