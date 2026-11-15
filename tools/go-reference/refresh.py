"""The pure part of `run.py refresh <commit>`: which characters, weapons and sets of Genshin Optimizer changed between two
extractions, and which decision files that puts aside. It reads no GO checkout and uses no network: it takes the two
extractions' JSON (gb-kit.json and gb-match.json of the old pin and of the new one) and the decided/ folder.

A sheet has "changed" when what kitgen builds from it differs between the two extractions: her rows, elements, moves,
infusions, effects, toggles and their states, what is left out. Both are built with the decisions that are in the folder now, so a
decision is never itself a change; what a decision fills in (checked, unsure, main, stellar, a toggle's on, label and covers)
and the source line (it names the commit) are left out of the comparison. A decision the new sheet no longer fits (GO renamed
or dropped a state her file decides, or one of her main rows) makes her changed too: kitgen refuses such a file, so she is
built alone, and her error is the change. A decided character is read at the states her file names, so that alone would not
see GO add a state or change a number at another: her states (every conditional's list of them) and her build with no decision
(each read at the state that gives the most) are compared too.

A changed (or removed) character with a decision file has it moved to decided/_stale/<key>.<old commit>.json: out of the folder
kitgen reads, so she is undecided, and kept in git so that a person can decide again from the old answer. A weapon or set with a
decision file (decided/weapons/<key>.json, decided/sets/<key>.json) is treated the same, into decided/_stale/weapons/ or sets/."""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Callable

import kitgen

STALE = "_stale"
# what a decision fills in, and the commit the source line names: not the sheet
NOT_THE_SHEET = frozenset({"checked", "unsure", "main", "stellar", "source"})
KINDS = ("characters", "weapons", "sets")


def build_each(kit: dict, match: dict, decided: dict, commit: str, slug: Callable, kind_by_name: Callable,
               is_damage: Callable = lambda name: True) -> dict:
    """kits.json's three parts from one extraction, each character built alone with her own decision (so one whose decision no
    longer fits is {"error": why} and not the end of the run). The weapons and sets are built one item at a time, each with its own decision
    file if it has one (`_build_gear`)."""
    characters: dict[str, Any] = {}
    for go_key, char in sorted(match.items()):
        key = kitgen.character_key(go_key, char.get("name"), slug)
        if key in characters:
            raise SystemExit(f"two GO characters give the key {key}")
        mine = (decided.get("characters") or {}).get(key)
        one = {"about": "", "checked": "", "characters": {key: mine} if mine else {},
               "unsure": {key: decided["unsure"][key]} if key in (decided.get("unsure") or {}) else {}}
        alone = {"characters": {go_key: (kit.get("characters") or {}).get(go_key, {})}, "weapons": {}, "sets": {}}
        try:
            entry = kitgen.build(alone, {go_key: char}, one, "0" * 40, slug, kind_by_name, is_damage)["characters"][key]
            sheet = alone["characters"][go_key]
            everything = [sheet.get("effects"), sheet.get("hit_data"), [h.get("formula") for h in char.get("hits", [])]]
            entry["states"] = {path: sorted(states) for path, states in sorted(kitgen.conditionals_in(everything).items())}
            entry["undecided"] = None
            if mine:
                bare = {"about": "", "checked": "", "unsure": {}, "characters": {}}
                entry["undecided"] = sheet_of(
                    kitgen.build(alone, {go_key: char}, bare, "0" * 40, slug, kind_by_name, is_damage)["characters"][key])
            characters[key] = entry
        except SystemExit as why:
            characters[key] = {"error": str(why)}
    return {"characters": characters, "weapons": _build_gear(kit, decided, "weapons", slug, kind_by_name, is_damage),
            "sets": _build_gear(kit, decided, "sets", slug, kind_by_name, is_damage)}


def _build_gear(kit: dict, decided: dict, kind: str, slug: Callable, kind_by_name: Callable, is_damage: Callable) -> dict:
    """The weapons' (or sets') part of kits.json from one extraction, each item built alone with its own decision file, if it has one (so
    one whose decision no longer fits is {"error": why}). As for a character, an item with a decision is also read with none and at each
    of its states, to see GO change a number at a state the decision does not pick."""
    out: dict[str, Any] = {}
    bare = {"about": "", "checked": "", "unsure": {}, "characters": {}}
    for go_key, item in sorted((kit.get(kind) or {}).items()):
        if not item.get("name"):
            continue
        key = slug(item["name"])
        mine = (decided.get(kind) or {}).get(key)
        if key in out:
            raise SystemExit(f"two GO {kind} give the key {key}")
        alone = {"characters": {}, "weapons": {}, "sets": {}, kind: {go_key: item}}
        try:
            entry = kitgen.build(alone, {}, {**bare, kind: {key: mine} if mine else {}}, "0" * 40, slug, kind_by_name, is_damage)[kind][key]
            entry["states"] = {path: sorted(states) for path, states in sorted(kitgen.conditionals_in([item.get("effects")]).items())}
            entry["undecided"] = None
            if mine:
                entry["undecided"] = sheet_of(kitgen.build(alone, {}, {**bare, kind: {}}, "0" * 40, slug, kind_by_name, is_damage)[kind][key])
            out[key] = entry
        except SystemExit as why:
            out[key] = {"error": str(why)}
    return out


def sheet_of(entry: dict) -> dict:
    """An entry of kits.json without what a decision or the commit fills in. A toggle keeps its name and its state."""
    out = {name: value for name, value in entry.items() if name not in NOT_THE_SHEET}
    if "toggles" in out:
        out["toggles"] = [{"name": t["name"], "state": t["state"]} for t in out["toggles"]]
    return out


def _differences(old: dict, new: dict) -> list[str]:
    if "error" in new or "error" in old:
        if old.get("error") == new.get("error"):
            return []
        if "error" in new:
            return [f"its decision no longer fits: {new['error']}"]
        return ["its decision fits again"]
    before, after = sheet_of(old), sheet_of(new)
    return sorted(name for name in {*before, *after} if before.get(name) != after.get(name))


def changed_sheets(old: dict, new: dict) -> dict:
    """{"characters" | "weapons" | "sets": {"changed": {key: [what differs]}, "added": [keys], "removed": [keys]}} between two
    `build_each` results."""
    out: dict[str, dict] = {}
    for kind in KINDS:
        before, after = old[kind], new[kind]
        changed = {}
        for key in sorted(set(before) & set(after)):
            differences = _differences(before[key], after[key])
            if differences:
                changed[key] = differences
        out[kind] = {"changed": changed, "added": sorted(set(after) - set(before)), "removed": sorted(set(before) - set(after))}
    return out


def plan_resets(changes: dict, folder: Path, old_commit: str) -> list[tuple[str, Path, Path]]:
    """[(key, the decision file, where it goes)] for every changed or removed character, weapon or set that has a file in `folder`
    (a weapon's key is "weapons/<key>", a set's "sets/<key>"). Nothing is moved. A file already there for the same key and pin is not
    replaced: the next free number goes in its name."""
    plan = []
    for kind in KINDS:
        part = changes[kind]
        where = Path(".") if kind == "characters" else Path(kind)
        for key in sorted({*part["changed"], *part["removed"]}):
            source = folder / where / f"{key}.json"
            if not source.is_file():
                continue
            target = folder / STALE / where / f"{key}.{old_commit[:8]}.json"
            number = 1
            while target.exists():
                number += 1
                target = folder / STALE / where / f"{key}.{old_commit[:8]}-{number}.json"
            plan.append((key if kind == "characters" else f"{kind}/{key}", source, target))
    return plan


def apply_resets(plan: list[tuple[str, Path, Path]]) -> None:
    for _, source, target in plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))


def without(decided: dict, keys) -> dict:
    """`decided` (`kitgen.load_decided`) as it is once the decisions of `keys` are put aside (`plan_resets`' keys: a weapon's is
    "weapons/<key>", a set's "sets/<key>")."""
    gone = set(keys)
    return {**decided, "unsure": {k: v for k, v in (decided.get("unsure") or {}).items() if k not in gone},
            "characters": {k: v for k, v in (decided.get("characters") or {}).items() if k not in gone},
            **{kind: {k: v for k, v in (decided.get(kind) or {}).items() if f"{kind}/{k}" not in gone} for kind in kitgen.GEAR_FOLDERS}}


def repinned(files: list[Path] | tuple[Path, ...], old: str, new: str, date: str | None) -> dict[Path, str]:
    """The text of every pin file (run.py, setup.ps1, README.md, THIRD-PARTY-NOTICES.txt) with `old` moved to `new`, nothing
    written; it stops if any file lacks `old`. The README's description of the commit ("1.15.0+zo", 2026-11-13) is a label of
    the old one: with `date` it becomes (date)."""
    texts = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        if old not in text:
            raise SystemExit(f"{path.name} does not hold the pinned commit {old}; nothing was changed")
        text = text.replace(old, new)
        if date and path.suffix == ".md":
            text = re.sub(rf'(`{new}`) \("[^"]*", \d{{4}}-\d\d-\d\d\)', rf"\1 ({date})", text)
        texts[path] = text
    return texts


def repin(files: list[Path] | tuple[Path, ...], old: str, new: str, date: str | None) -> None:
    """`repinned`, written: none is written unless all hold `old`."""
    for path, text in repinned(files, old, new, date).items():
        path.write_text(text, encoding="utf-8", newline="\n")


def report(old: str, new: str, changes: dict, plan: list[tuple[str, Path, Path]], folder: Path, dry_run: bool) -> list[str]:
    """The lines the command prints: every changed, new and removed sheet with what differs, and every decision put aside."""
    lines = [f"Genshin Optimizer {old[:8]} -> {new[:8]}"]
    for kind in KINDS:
        part = changes[kind]
        lines.append(f"{kind.capitalize()}: {len(part['changed'])} changed, {len(part['added'])} new, {len(part['removed'])} removed")
        for key, what in part["changed"].items():
            lines.append(f"  changed {key}: {', '.join(what)}")
        if part["added"]:
            lines.append(f"  new: {', '.join(part['added'])}")
        if part["removed"]:
            lines.append(f"  removed: {', '.join(part['removed'])}")
    if plan:
        verb = "would be put aside" if dry_run else "put aside"
        lines.append(f"Decisions {verb}, undecided until a person decides them again ({len(plan)}):")
        for key, _, target in plan:
            lines.append(f"  {key}: {target.relative_to(folder).as_posix()}")
    else:
        lines.append("No decision is reset.")
    return lines
