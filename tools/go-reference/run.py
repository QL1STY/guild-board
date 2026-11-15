"""Runs Genshin Optimizer's Waverider engine headless, outside the app, and writes what Guild Board keeps from it.

    uv run python tools/go-reference/run.py kits               extract the kits and write kits.json, the weapons' levels file and the schema
    uv run python tools/go-reference/run.py kits --from DIR    write them again from an earlier run's JSON in DIR
    uv run python tools/go-reference/run.py compare            the damage engine against GO for every character (compare.py)
    uv run python tools/go-reference/run.py compare --from DIR the same from an earlier run's JSON in DIR
    uv run python tools/go-reference/run.py compare --only KEY... (or @FILE)   just those characters, for a batch of decisions
    uv run python tools/go-reference/run.py sheet KEY... (or @FILE)            each one's decision sheet (sheet.py)
    uv run python tools/go-reference/run.py queue                              the characters still to decide, owned first, in batches (work_queue.py)
    uv run python tools/go-reference/run.py refresh COMMIT [--dry-run] [--no-compare]   move the pin to a new GO commit (refresh.py)

It needs a GO checkout at the pinned commit with its packages installed and Node 24 beside it: tools/go-reference/setup.ps1
makes both. GB_GO_DIR names the checkout (default %LOCALAPPDATA%\\guildboard-dev\\go), GB_NODE_DIR Node's folder (default
the node-v24*-win-x64 folder beside the checkout). Our specs (specs/*.ts) are copied into the checkout's
libs/gi/pando-parity/src/ and run there with vitest, which writes gb-kit.json and gb-match.json into GB_OUT_DIR (default
the checkout's gb-out folder; every command that runs GO writes there, so parallel runs name a folder each). Nothing here is imported by the app, and the app never runs it."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

import kitgen  # noqa: E402
import refresh  # noqa: E402

PINNED = "2c13fc40c4694fd8beae513493c4c8a7537173c6"
KITS = ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json"
LEVELS = ROOT / "src" / "guildboard" / "reference" / "characters" / "weapon-levels.json"
SCHEMA = ROOT / "src" / "guildboard" / "reference" / "characters" / "schema" / "kits.schema.json"
DECIDED = HERE / "decided"
PIN_FILES = (HERE / "run.py", HERE / "setup.ps1", HERE / "README.md", ROOT / "THIRD-PARTY-NOTICES.txt")   # where the pinned commit is written (the notices name it too)
SPECS = HERE / "specs"
PARITY = Path("libs") / "gi" / "pando-parity"


def go_dir() -> Path:
    named = os.environ.get("GB_GO_DIR")
    if named:
        return Path(named)
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "guildboard-dev" / "go"


def node_dir(go: Path) -> Path:
    named = os.environ.get("GB_NODE_DIR")
    if named:
        return Path(named)
    found = sorted(go.parent.glob("node-v24*-win-x64"))
    if not found:
        raise SystemExit(f"No Node 24 beside {go}. Run tools/go-reference/setup.ps1, or name its folder in GB_NODE_DIR.")
    return found[-1]


def commit_of(go: Path) -> str:
    return subprocess.run(["git", "-C", str(go), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


def out_dir(go: Path) -> Path:
    """Where GO's JSON goes: GB_OUT_DIR (parallel runs name a folder each), else the checkout's gb-out."""
    return Path(os.environ.get("GB_OUT_DIR") or go / "gb-out")


SPECS_STAMP = ".specs-hash"


def specs_hash() -> str:
    """A hash of our specs, so that a folder's gb-kit.json and gb-match.json are reused only for the specs that wrote them."""
    digest = hashlib.sha256()
    for spec in sorted(SPECS.glob("*.ts")):
        digest.update(spec.name.encode() + b"|" + spec.read_bytes())
    return digest.hexdigest()


def kit_json_is_current(folder: Path) -> bool:
    """Whether `folder` holds gb-kit.json and gb-match.json that a run of these very specs wrote."""
    stamp = folder / SPECS_STAMP
    return (all((folder / name).exists() for name in ("gb-kit.json", "gb-match.json")) and stamp.exists()
            and stamp.read_text(encoding="utf-8") == specs_hash())


def parse_keys(values: list[str]) -> list[str]:
    """Character keys from the command line: each value is a key, or `@file` holding keys one per line (blank lines and lines
    starting with # are skipped) or as a JSON list. A key given twice is kept once, in the order first given."""
    keys: list[str] = []
    for value in values:
        if value.startswith("@"):
            path = Path(value[1:])
            if not path.is_file():
                raise SystemExit(f"{path} is not a file of keys")
            text = path.read_text(encoding="utf-8").strip()
            keys += json.loads(text) if text.startswith("[") else [
                line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
        else:
            keys.append(value)
    return list(dict.fromkeys(keys))


def run_specs(go: Path, out: Path, patterns: list[str], extra: dict[str, str] | None = None) -> None:
    """Copies our specs into the checkout and runs those whose names hold one of `patterns` with vitest under Node 24."""
    if not (go / "node_modules" / "vitest").is_dir():
        raise SystemExit(f"{go} has no installed packages. Run tools/go-reference/setup.ps1.")
    for spec in SPECS.glob("*.ts"):
        target = go / PARITY / "src" / spec.name
        # a copy that would change nothing is left alone: runs in parallel share the checkout, and one may be reading it
        if not target.exists() or target.read_bytes() != spec.read_bytes():
            shutil.copyfile(spec, target)
    out.mkdir(parents=True, exist_ok=True)
    node = node_dir(go)
    env = {**os.environ, "PATH": f"{node}{os.pathsep}{os.environ.get('PATH', '')}", "GB_OUT_DIR": str(out),
           "NX_DAEMON": "false", "NX_NO_CLOUD": "true", **(extra or {})}
    command = [str(node / "node.exe"), "node_modules/vitest/vitest.mjs", "run", "--config",
               str(PARITY / "vitest.config.mts"), *patterns]
    result = subprocess.run(command, cwd=go, env=env)
    if result.returncode != 0:
        raise SystemExit(f"vitest failed ({result.returncode}).")


def _app_functions():
    """The three functions of the app that kitgen names rows and kinds with."""
    from guildboard.characters.hits import is_damage, kind_by_name
    from guildboard.metrics import slug

    return slug, kind_by_name, is_damage


def make_kits(source: Path, commit: str, decided: dict, notes: dict | None = None) -> dict:
    """kits.json's content from an extraction in `source` and the decisions, nothing written. `notes`: see `kitgen.build`."""
    slug, kind_by_name, is_damage = _app_functions()
    kit = json.loads((source / "gb-kit.json").read_text(encoding="utf-8"))
    match = json.loads((source / "gb-match.json").read_text(encoding="utf-8"))
    stale = sorted(go for go, char in match.items() if any("ele_tree" not in hit for hit in char.get("hits", [])))
    if stale:
        raise SystemExit(f"gb-match.json in {source} has no `ele_tree` on the hits of {', '.join(stale[:5])}...: it is from an older extraction. "
                         "Run `run.py kits` without --from to read the element a state decides for a hit (Aloy's Rushing Ice, Yoimiya's Niwabi Fire-Dance).")
    return kitgen.build(kit, match, decided, commit, slug, kind_by_name, is_damage, notes)


def weapon_levels(kits: dict) -> dict:
    """The weapons' numbers at level 90 of kits.json, alone: what the references read (`reference.load_weapon_levels`)."""
    return {key: weapon["level_90"] for key, weapon in kits["weapons"].items() if weapon.get("level_90")}


def save_kits(kits: dict) -> None:
    KITS.write_text(json.dumps(kits, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    LEVELS.write_text(json.dumps(weapon_levels(kits), indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    SCHEMA.write_text(json.dumps(kitgen.schema(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def write_kits(source: Path, commit: str) -> dict:
    """Builds and writes kits.json, and says what the build left out or is waiting for: the characters of GO's data that are not in the game
    (`kitgen.NOT_IN_GAME`), and the characters with a decision file that does not decide a toggle her sheet now has (they are written with it
    off and stay checked, until a person decides it in her file and runs this again)."""
    notes: dict = {}
    kits = make_kits(source, commit, kitgen.load_decided(DECIDED), notes)
    save_kits(kits)
    for go_key, why in sorted(notes["not_in_game"].items()):
        print(f"Left out, not in the game: {go_key}: {why}")
    awaiting = notes["awaiting"]
    if awaiting:
        print(f"{len(awaiting)} decided characters have toggles that await a decision (written off):")
        for key, names in sorted(awaiting.items()):
            print(f"  {key}: {', '.join(names)}")
    return kits


def summary(kits: dict) -> str:
    chars = kits["characters"].values()
    effects = sum(len(c["effects"]) for c in chars)
    toggles = sum(len(c["toggles"]) for c in chars)
    left = sum(len(c["left_out"]) for c in chars)
    gear = [*kits["weapons"].values(), *kits["sets"].values()]
    rows = sum(len(r) for c in chars for r in c["hits"].values())
    return (f"{len(kits['characters'])} characters ({sum(c['checked'] for c in chars)} checked), {rows} rows, "
            f"{effects} effects, {toggles} toggles, {left} left out; {len(kits['weapons'])} weapons and "
            f"{len(kits['sets'])} sets with {sum(len(g['effects']) for g in gear)} effects, "
            f"{sum(len(g['toggles']) for g in gear)} toggles, {sum(len(g['left_out']) for g in gear)} left out")


def _kept_kits() -> dict:
    """kits.json as the app reads it (the comparison reads its decisions from it)."""
    from guildboard.characters import kits as kit_data

    return kit_data.load_kits()


def _stale_kits(keys: list[str], decided: dict) -> list[str]:
    """The characters whose decision file says something kits.json does not (main, stellar, unsure, a toggle's on, label, covers or
    state: the file was changed and `kits` not run yet), which compare reads from kits.json."""
    characters = _kept_kits()["characters"]
    stale = []
    for key in keys:
        if kitgen.decision_differences(decided["characters"].get(key), decided["unsure"].get(key), characters[key]):
            stale.append(key)
    return stale


def _stale_gear(decided: dict) -> list[str]:
    """The weapons and sets ("weapons/<key>", "sets/<key>") whose decision file says something kits.json does not, or that kits.json
    holds decided and no file does (the gear the comparison reads from kits.json)."""
    kept = _kept_kits()
    stale = []
    for kind in kitgen.GEAR_FOLDERS:
        decided_items = decided.get(kind) or {}
        for key in sorted({*decided_items, *(k for k, item in kept[kind].items() if item.get("checked"))}):
            item = kept[kind].get(key)
            if item is None or kitgen.gear_differences(decided_items.get(key), item, decided.get("gear_labels")):
                stale.append(f"{kind}/{key}")
    return stale


def compare_only(source: Path | None, only: list[str]) -> int:
    """A partial comparison for a batch of decisions: just `only`'s cases, in GO and in our engine, printed per case, never
    written over the committed fixture. Exits 1 on any disagreement of a decided character that is not marked unsure."""
    import compare

    decided = kitgen.load_decided(DECIDED)
    plan = compare.cases(only=only)
    stale = [*_stale_kits(only, decided), *_stale_gear(decided)]
    if stale:
        raise SystemExit(f"kits.json does not hold the decisions of {', '.join(stale)}: run `run.py kits` first (--from DIR).")
    if source is None:
        go = go_dir()
        commit = commit_of(go)
        if commit != PINNED:
            raise SystemExit(f"{go} is at {commit}, not the pinned {PINNED}.")
        source = out_dir(go)
        source.mkdir(parents=True, exist_ok=True)
        # the kit and match JSON are GO's alone: an earlier run in this folder with the same specs has them already
        have = kit_json_is_current(source)
        compare.write(source / "cases-only.json", plan)
        run_specs(go, source, ["gb-compare"] if have else ["gb-kit", "gb-match", "gb-compare"],
                  {"GB_CASES": str(source / "cases-only.json")})
        (source / SPECS_STAMP).write_text(specs_hash(), encoding="utf-8")
    else:
        compare.write(source / "cases-only.json", plan)
    partial = compare.fixture(source, source / "cases-only.json")
    fixture_path, ours = source / "compare-only.json", source / "gb-ours-only.json"
    compare.write(fixture_path, partial)
    ours.unlink(missing_ok=True)
    npx = shutil.which("npx") or "npx"
    result = subprocess.run([npx, "vitest", "run", "src/pages/characters/compare.test.ts"], cwd=ROOT / "web",
                            env={**os.environ, "GB_COMPARE_OUT": str(ours), "GB_COMPARE_FIXTURE": str(fixture_path)})
    if not ours.exists():
        raise SystemExit(f"our engine's run wrote nothing ({result.returncode}).")
    compare.attach_ours(partial, json.loads(ours.read_text(encoding="utf-8")))
    lines, failed = compare.only_report(partial, only, set(decided["characters"]), set(decided["unsure"]), plan["skipped"])
    print(f"{len(partial['cases'])} cases of {len(only)} characters (tolerance {compare.TOLERANCE} points)")
    print("\n".join(lines))
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        return 1
    return 0


def compare_command(source: Path | None, report: Path | None = None, only: list[str] | None = None) -> int:
    """cases.json, GO's run of it, the fixture, our engine's run and the summary (compare.py). With `only`, a partial run that
    writes none of the committed files (compare_only)."""
    import compare

    if only is not None:
        return compare_only(source, only)
    if source is None:
        go = go_dir()
        commit = commit_of(go)
        if commit != PINNED:
            raise SystemExit(f"{go} is at {commit}, not the pinned {PINNED}.")
        compare.write(compare.CASES, compare.cases())
        source = out_dir(go)
        run_specs(go, source, ["gb-kit", "gb-match", "gb-compare"], {"GB_CASES": str(compare.CASES)})
    compare.write(compare.FIXTURE, compare.fixture(source))
    ours = source / "gb-ours.json"
    web = ROOT / "web"
    npx = shutil.which("npx") or "npx"
    result = subprocess.run([npx, "vitest", "run", "src/pages/characters/compare.test.ts"], cwd=web,
                            env={**os.environ, "GB_COMPARE_OUT": str(ours)})
    if not ours.exists():
        raise SystemExit(f"our engine's run wrote nothing ({result.returncode}).")
    data = compare.pin(ours)
    if report is not None:
        compare.write_report(report, data)
    if data["move_mismatches"]:
        # a row's move must be the move of the GO hit matched to it (Tartaglia's Riptide Slash is Skill DMG)
        raise SystemExit("rows whose move is not GO's: " + "; ".join(
            f"{m['character']} {m['row']}: ours {m['ours']}, GO {m['go']}" for m in data["move_mismatches"]))
    everything = [*data["cases"], *data.get("gear_cases", [])]
    agreed = [c for c in everything if compare.agreement(c)[0]]
    print(f"{len(data['cases'])} cases and {len(data.get('gear_cases', []))} weapon and set swaps, {len(agreed)} agree within {compare.TOLERANCE} points")
    for case in everything:
        ok, notes = compare.agreement(case)
        if not ok:
            print(f"  {case['id']}: {case.get('error') or '; '.join(notes)}")
    return 0


def _git(go: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(go), *args], capture_output=True, text=True)


def _extract(go: Path, folder: Path) -> Path:
    run_specs(go, folder, ["gb-kit", "gb-match"])
    return folder


def _read_extraction(folder: Path) -> tuple[dict, dict]:
    try:
        return (json.loads((folder / "gb-kit.json").read_text(encoding="utf-8")),
                json.loads((folder / "gb-match.json").read_text(encoding="utf-8")))
    except OSError as error:
        raise SystemExit(f"{folder} holds no gb-kit.json and gb-match.json ({error})") from error


def _check_out(go: Path, commit: str, fetch: bool) -> None:
    """GO at `commit` (GitHub is GO's host; this developer tool fetches it at a developer's request only)."""
    if fetch and _git(go, "fetch", "--depth", "1", "origin", commit).returncode != 0:
        raise SystemExit(f"Could not fetch {commit} from origin in {go}.")
    result = _git(go, "checkout", "--quiet", "--force", commit)
    if result.returncode != 0:
        raise SystemExit(f"Could not check out {commit} in {go}: {result.stderr.strip()}")


def refresh_command(commit: str, dry_run: bool = False, no_compare: bool = False, old_from: Path | None = None,
                    new_from: Path | None = None) -> int:
    """Moves the pin to GO's `commit`: extracts the old pin and the new one, lists every character, weapon and set whose sheet
    changed (refresh.py), puts the decisions of the changed characters aside in decided/_stale/, moves the pin in run.py,
    setup.ps1, the README and THIRD-PARTY-NOTICES.txt, writes kits.json again and runs the comparison for all. `dry_run` only
    prints, and leaves GO's checkout at the old pin. `old_from` and `new_from` are folders of earlier extractions (no GO run,
    no network). It starts only when the old pin builds with the decisions as they are; the new kits and the pin files' new text
    are made in memory first, so that the files are written only once nothing can fail but the disk."""
    global PINNED
    old = PINNED
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("Give the whole 40-character commit.")
    if commit == old:
        raise SystemExit(f"{commit} is already the pin.")
    go: Path | None = None
    if old_from is None or new_from is None:
        go = go_dir()
        at = commit_of(go)
        if at != old:
            raise SystemExit(f"{go} is at {at}, not the pinned {old}. Run setup.ps1 first.")
    elif not dry_run and not no_compare:
        # the comparison runs GO: it must be at the new commit, said now and not after the files are written
        at = commit_of(go_dir())
        if at != commit:
            raise SystemExit(f"--new-from reads no checkout, but the comparison runs GO, which is at {at} and not at {commit}. "
                             "Check the new commit out, or add --no-compare.")
    slug, kind_by_name, is_damage = _app_functions()
    decided = kitgen.load_decided(DECIDED)
    old_source = old_from or _extract(go, out_dir(go) / "refresh-old")
    old_kits = refresh.build_each(*_read_extraction(old_source), decided, old, slug, kind_by_name, is_damage)
    broken = sorted(key for key, entry in old_kits["characters"].items() if "error" in entry)
    unknown = sorted((set(decided["characters"]) | set(decided["unsure"])) - set(old_kits["characters"]))
    broken_gear = sorted(f"{kind}/{key}" for kind in kitgen.GEAR_FOLDERS for key, entry in old_kits[kind].items() if "error" in entry)
    unknown_gear = sorted(f"{kind}/{key}" for kind in kitgen.GEAR_FOLDERS for key in set(decided[kind]) - set(old_kits[kind]))
    if broken or unknown or broken_gear or unknown_gear:
        raise SystemExit("The old pin does not build with decided/ as it is, so there is nothing to compare: "
                         + "; ".join([*[f"{key}: {old_kits['characters'][key]['error']}" for key in broken],
                                      *[f"{item}: {old_kits[item.split('/')[0]][item.split('/')[1]]['error']}" for item in broken_gear],
                                      *([f"decided/ names {', '.join(unknown)}, which the old pin lacks"] if unknown else []),
                                      *([f"decided/ names {', '.join(unknown_gear)}, which the old pin lacks"] if unknown_gear else [])]))
    switched = written = False
    restore_failed = ""
    try:
        if new_from is None:
            _check_out(go, commit, fetch=True)
            switched = True
            try:
                new_source = _extract(go, out_dir(go))
            except SystemExit as why:
                raise SystemExit(f"{why} GO at {commit[:8]} may need its packages again: run setup.ps1 with the new commit.") from why
        else:
            new_source = new_from
        new_kits = refresh.build_each(*_read_extraction(new_source), decided, commit, slug, kind_by_name, is_damage)
        changes = refresh.changed_sheets(old_kits, new_kits)
        plan = refresh.plan_resets(changes, DECIDED, old)
        date = None
        if go is not None and switched:
            shown = _git(go, "show", "-s", "--format=%cs", commit)
            date = shown.stdout.strip() if shown.returncode == 0 else None
        print("\n".join(refresh.report(old, commit, changes, plan, DECIDED, dry_run)))
        if dry_run:
            print("Dry run: no decision was moved, the pin is not changed and kits.json is not written.")
        else:
            # everything that can fail, before the first write
            kits = make_kits(new_source, commit, refresh.without(decided, [key for key, _, _ in plan]))
            pins = refresh.repinned(PIN_FILES, old, commit, date)
            written = True
            refresh.apply_resets(plan)
            for path, text in pins.items():
                path.write_text(text, encoding="utf-8", newline="\n")
            PINNED = commit
            if date is None:
                print("Update the README's description of the pinned commit (its version label and date) by hand.")
            save_kits(kits)
            print("Wrote kits.json: " + summary(kits))
    finally:
        # GO goes back to the old pin unless the files were written (then the pin is the new one and GO stays there)
        if switched and not written:
            try:
                _check_out(go, old, fetch=False)
            except SystemExit as why:
                restore_failed = f"GO could not be put back at {old[:8]}: {why}"
                print(restore_failed, file=sys.stderr)
    if restore_failed:
        raise SystemExit(restore_failed)
    if dry_run:
        return 0
    if no_compare:
        print("The comparison was not run (--no-compare): run `run.py compare` before committing.")
        return 0
    return compare_command(None)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genshin Optimizer's Waverider, headless, for Guild Board's kit data.")
    sub = parser.add_subparsers(dest="command", required=True)
    kits = sub.add_parser("kits", help="extract the kits and write kits.json and its schema")
    kits.add_argument("--from", dest="source", type=Path, help="a folder with an earlier run's gb-kit.json and gb-match.json")
    kits.add_argument("--commit", default=PINNED, help="the GO commit an earlier run read (with --from)")
    comparing = sub.add_parser("compare", help="compare the damage engine with GO's for every character (compare.py)")
    comparing.add_argument("--from", dest="source", type=Path, help="a folder with an earlier run's gb-kit, gb-match and gb-compare JSON")
    comparing.add_argument("--report", type=Path, help="a Markdown report whose <!-- cases --> section gets every case's answers")
    comparing.add_argument("--only", nargs="+", metavar="KEY", help="just these characters (keys, or @file of keys): prints each case "
                           "and exits 1 on a disagreement of a decided character; writes none of the committed files")
    sheets = sub.add_parser("sheet", help="a decision sheet for each character, in .superpowers/sheets/ (sheet.py)")
    sheets.add_argument("keys", nargs="+", metavar="KEY", help="character keys, or @file of keys")
    sheets.add_argument("--no-damage", action="store_true", help="leave out how much each toggle moves her damage (no vitest run)")
    sheets.add_argument("--no-wiki", action="store_true", help="leave out the HoYoLAB wiki's passive and constellation text")
    sub.add_parser("queue", help="the characters with no decision, owned ones first, in batches and lanes, in .superpowers/ (work_queue.py)")
    refreshing = sub.add_parser("refresh", help="move the pin to a new GO commit and list the sheets that changed (refresh.py)")
    refreshing.add_argument("commit", help="the whole 40-character GO commit")
    refreshing.add_argument("--dry-run", action="store_true", help="print what would change; move no file, leave the pin and kits.json")
    refreshing.add_argument("--no-compare", action="store_true", help="do not run the comparison for all afterwards")
    refreshing.add_argument("--old-from", type=Path, help="a folder with the old pin's gb-kit.json and gb-match.json (no GO run for it)")
    refreshing.add_argument("--new-from", type=Path, help="a folder with the new commit's gb-kit.json and gb-match.json (no fetch, no GO run)")
    arguments = parser.parse_args(argv)
    if arguments.command == "refresh":
        return refresh_command(arguments.commit, arguments.dry_run, arguments.no_compare, arguments.old_from, arguments.new_from)
    if arguments.command == "queue":
        import work_queue

        return work_queue.main([])
    if arguments.command == "sheet":
        import sheet

        return sheet.main([*arguments.keys, *(["--no-damage"] if arguments.no_damage else []),
                           *(["--no-wiki"] if arguments.no_wiki else [])])
    if arguments.command == "compare":
        only = parse_keys(arguments.only) if arguments.only else None
        return compare_command(arguments.source, arguments.report, only)
    if arguments.command == "kits":
        if arguments.source:
            source, commit = arguments.source, arguments.commit
        else:
            go = go_dir()
            commit = commit_of(go)
            if commit != PINNED:
                raise SystemExit(f"{go} is at {commit}, not the pinned {PINNED}. Run setup.ps1, or pin the new commit here "
                                 "and in the README after reading what changed.")
            source = out_dir(go)
            run_specs(go, source, ["gb-kit", "gb-match"])
        print("Wrote kits.json: " + summary(write_kits(source, commit)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
