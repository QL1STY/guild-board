"""A one-page decision sheet per character, for the person (or agent) who decides her kit (decided/<key>.json). A developer tool:
nothing here ships and the app never runs it.

    uv run python tools/go-reference/sheet.py raiden-shogun sandrone @keys.txt      (or: run.py sheet raiden-shogun ...)

writes `.superpowers/sheets/<key>.md` (git-ignored) for each key, many at once. A sheet has:

- her main talents and their counted rows (kind, move, what each scales on, at talent level 10, the rows' multipliers as the
  planner's hits block has them), the other talents in one line;
- each toggle of hers: GO's condition name, its effects in kits.json's Effect form, the rows it reaches, how much it moves her
  main talents' damage on a standard build (our engine, damage.ts, run through vitest by `toggles.test.ts`: the comparison's build
  of her weapon type, her kit read at Constellation 6 so that every toggle shows), what is decided for it now, and a suggestion;
- what her kit leaves out, each with the reason;
- her passives' and constellations' text from the HoYoLAB wiki: read from the dev copy's data folder (its files are only read: a copy that
  Guild Board kept), else through the app's own wiki code and `netpolicy` (HoYoverse's wiki host only), and never stored or
  committed.

The suggestion is a rule (`suggest`), marked as one: a self-buff that changes her own counted hits and whose name does not point to
the party, setup or off-field is suggested on; the rest off. It is where to start reading, not a decision."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(HERE))

import compare  # noqa: E402
import dbcopy  # noqa: E402
import kitgen  # noqa: E402
from guildboard import netpolicy  # noqa: E402
from guildboard.characters import kits as kit_data  # noqa: E402
# relies on the app's wiki.py private `_parse_entry`, `_talents` and `_constellations`: a change there breaks this tool, not the app
from guildboard.characters import wiki as app_wiki  # noqa: E402

SHEETS = ROOT / ".superpowers" / "sheets"
DECIDED = HERE / "decided"
CONSTELLATION = 6
SHOWN_OF_A_LONG_LIST = 5
# words in a toggle's name or label that point to the party, the enemy, her HP or another setup the planner does not know
SETUP_WORDS = re.compile(
    r"\b(party|team|teammates?|allies|ally|others?|enem\w*|opponents?|nearby|off-?field|hp|health|below|above)\b", re.IGNORECASE)


# ------------------------------------------------------------------------------------------------ effects in words

def _num(value: Any) -> str:
    return f"{value:g}" if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)


def _rate(value: Any) -> str:
    if isinstance(value, list):
        return f"[{_num(value[0])} … {_num(value[-1])}] by level"
    return _num(value)


def effect_text(effect: dict) -> str:
    """One effect of kits.json in a sentence (schema/kits.schema.json says how it reads)."""
    rate = _rate(effect["rate"])
    if effect.get("from"):
        stat = effect["from"] if not effect.get("over") else f"({effect['from']} − {_num(effect['over'])})"
        text = f"adds {rate} × {stat} to {effect['to']}"
        if effect.get("cap") is not None:
            text += f", at most {_rate(effect['cap'])}" + (" × base ATK" if effect.get("cap_from") == "base_atk" else "")
        if effect.get("reads") == "final":
            text += " (the stat after conversions)"
    else:
        text = f"adds {rate} to {effect['to']}"
    gates = []
    if effect.get("from_ascension") is not None:
        gates.append(f"from ascension {effect['from_ascension']}")
    if effect.get("from_constellation") is not None:
        gates.append(f"from Constellation {effect['from_constellation']}")
    if effect.get("talents"):
        gates.append("for " + "/".join(effect["talents"]) + " hits")
    if effect.get("hits"):
        gates.append("for the rows " + ", ".join(effect["hits"]))
    if effect.get("weapon_types"):
        gates.append("with " + "/".join(effect["weapon_types"]))
    if effect.get("row"):
        gates.append(f"its number is {effect['row']['talent']}'s row \"{effect['row']['name']}\"")
    return ", ".join([text, *gates])


def effect_form(effect: dict) -> str:
    """The effect as kits.json holds it, without its empty fields; a long list by talent level is shortened to its ends."""
    shown: dict[str, Any] = {}
    for name, value in effect.items():
        if value is None or value is False:
            continue
        if isinstance(value, list) and len(value) > SHOWN_OF_A_LONG_LIST and all(isinstance(v, (int, float)) for v in value):
            value = [value[0], "…", value[-1]]
        shown[name] = value
    return json.dumps(shown, ensure_ascii=False)


# ------------------------------------------------------------------------------------------------ what a toggle reaches

def _base(name: str) -> str:
    return re.sub(r" \(\d+ of \d+\)$", "", name)


def reach_by_scope(effects: list[dict], infusions: list[dict], rows: list[tuple[str, dict]]) -> list[str]:
    """The counted rows (`talent|name`) that some effect's scope (its moves and its row names) or infusion reaches: where the
    engine adds an effect to a row, minus its check of the bucket (a Geo bonus to a Cryo row), which the measured damage makes."""
    reached = []
    for talent, row in rows:
        names = {row["name"], _base(row["name"]), row.get("alternative")}
        for effect in effects:
            if effect.get("talents") and row["move"] not in effect["talents"]:
                continue
            if effect.get("hits") and not (set(effect["hits"]) & names):
                continue
            reached.append(f"{talent}|{row['name']}")
            break
        else:
            if any(row["kind"] == "physical" and row["move"] in (i.get("talents") or []) for i in infusions):
                reached.append(f"{talent}|{row['name']}")
    return reached


def suggest(toggle: dict, effects: list[dict], infusions: list[dict], reached: list[str]) -> tuple[str, str]:
    """The rule's suggestion for one toggle, `("on" | "off", why)`. A toggle that changes none of her counted hits is off (it
    does nothing to the verdict); one whose every effect starts at a constellation is a Constellation window, off; one whose name
    or label points to the party, the enemy, her HP or another setup is off; the rest, a self-buff that changes her own counted
    hits, is on. A suggestion: whether her own main talent triggers it and it lasts through those hits is for a person to read."""
    if not reached:
        return "off", "none of her counted hits is changed by it"
    if effects and not infusions and all(e.get("from_constellation") is not None for e in effects):
        lowest = min(e["from_constellation"] for e in effects)
        return "off", f"a Constellation window (every effect of it starts at Constellation {lowest})"
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", f"{toggle['name']} {toggle.get('label') or ''}")
    found = SETUP_WORDS.search(words)
    if found:
        return "off", f"its name or label points to a party, enemy, HP or setup the planner does not know (\"{found.group(0)}\")"
    return "on", (f"it changes her own counted hits ({', '.join(reached[:3])}{', …' if len(reached) > 3 else ''}) and nothing in its "
                  "name points to the party, setup or off-field; read the texts below for whether her own main talent triggers "
                  "it and it lasts through them")


# ------------------------------------------------------------------------------------------------ the wiki

def wiki_page(name: str, db_path: Path | None = None, fetch: Callable[..., bytes] | None = None) -> dict:
    """Her passives' and constellations' text from the HoYoLAB wiki, `{"source", "version", "passives": [(name, text)],
    "constellations": [(name, text)]}`, or `{"error": reason}`. The entry the dev copy of Guild Board kept is read from its data
    folder (a copy of its files, in a temporary folder: the original is only read); one it lacks is read through the app's own wiki code (`ENTRY_URL`, `netpolicy.fetch_hoyoverse`, HoYoverse's
    wiki host only) and parsed the way the app parses it, and not stored. Nothing is written anywhere."""
    from guildboard import config

    path = Path(db_path) if db_path is not None else config.default_data_dir() / "guildboard.db"
    if not path.is_file():
        return {"error": f"the dev copy has no data folder at {path.parent}: no wiki text"}
    names = list(dict.fromkeys([name, name.split()[0]]))
    try:
        work = tempfile.TemporaryDirectory(prefix="gb-sheet-")
        connection = dbcopy.open_copy(path, Path(work.name))
        try:
            entry_id, data, version = None, None, ""
            for candidate in names:
                row = connection.execute(
                    "SELECT entry_page_id, data, version FROM wiki_entries WHERE kind = 'character' AND name = ?", (candidate,)).fetchone()
                if row:
                    entry_id, data, version = row[0], json.loads(row[1]), row[2]
                    break
                item = connection.execute(
                    "SELECT entry_page_id FROM wiki_items WHERE kind = 'character' AND name = ?", (candidate,)).fetchone()
                if item and entry_id is None:
                    entry_id = item[0]
        finally:
            connection.close()
            work.cleanup()
    except (OSError, sqlite3.Error, ValueError) as error:
        return {"error": f"the dev copy's database could not be read ({error})"}
    source = "cached"
    if data is None:
        if entry_id is None:
            return {"error": f"the wiki's list in the dev copy has no character named {name}"}
        try:
            body = (fetch or netpolicy.fetch_hoyoverse)(app_wiki.ENTRY_URL + entry_id, headers=app_wiki.HEADERS)
            data = app_wiki.CharacterWiki._parse_entry(body, entry_id, "character")
        except Exception as error:  # a failed read leaves the sheet without the text, not without the sheet
            return {"error": f"the wiki's entry could not be read ({netpolicy.what_failed(error)})"}
        if data is None:
            return {"error": f"the wiki has no entry {entry_id} yet"}
        source, version = "fetched", ""
    return {
        "source": source, "version": version,
        "passives": [(title, text) for kind, title, _, text in app_wiki._talents(data) if kind == "passive"],
        "constellations": [(title, text) for title, _, text in app_wiki._constellations(data)],
    }


# ------------------------------------------------------------------------------------------------ the facts and the page

def _row_scaling(row: dict) -> str:
    parts = [f"{term['mult'] * 100:.1f}% {term['stat'].upper()}" for term in row["terms"]]
    if row["flat"]:
        parts.append(f"+{_num(row['flat'])} flat")
    text = " + ".join(parts) or "none"
    return text + (f" × {row['count']}" if row["count"] != 1 else "")


def collect(key: str, *, affixes: dict | None, damage: dict | None, wiki: dict | None) -> dict:
    """Everything a sheet shows about one character: kits.json's entry, the planner's rows read at Constellation 6, her toggles'
    effects and reach, `damage` (this character's part of `toggles.test.ts`'s answer, or None), `wiki` (`wiki_page`'s answer, or
    None) and the decision now."""
    raw = kit_data.load_kits()["characters"][key]
    decisions = kitgen.load_decided(DECIDED)
    mine = decisions["characters"].get(key)
    block = compare.block(key, affixes, constellation=CONSTELLATION) if affixes else None
    talents = []
    counted: list[tuple[str, dict]] = []
    for talent in (block or {}).get("talents", []):
        rows = [{**row, "scaling": _row_scaling(row)} for row in talent["rows"]]
        talents.append({"key": talent["key"], "name": talent["name"], "main": talent["main"], "rows": rows})
        if talent["main"]:
            counted += [(talent["key"], row) for row in talent["rows"] if row["main"]]
    toggles = []
    for toggle in raw["toggles"]:
        effects = [e for e in raw["effects"] if e.get("while") == toggle["name"] or toggle["name"] in (e.get("also") or ())]
        infusions = [i for i in raw["infused"] if i.get("while") == toggle["name"]]
        scope = reach_by_scope(effects, infusions, counted)
        measured = (damage or {}).get("toggles", {}).get(toggle["name"])
        together = (damage or {}).get("together", {}).get(toggle["name"])
        reached = list(dict.fromkeys([*(measured["rows"] if measured else []), *(together["rows"] if together else [])])) if measured else scope
        suggestion = suggest(toggle, effects, infusions, reached)
        path = toggle["name"] if "." in toggle["name"] else f"{raw['go_key']}.{toggle['name']}"
        toggles.append({
            **toggle, "go_condition": f"conditional.{path}", "effects": effects, "infusions": infusions, "reached": reached,
            "by_scope": scope, "measured": measured, "together": together, "suggestion": suggestion,
            "decision": ((mine or {}).get("toggles") or {}).get(toggle["name"]),
        })
    return {
        "key": key, "name": raw["name"], "go_key": raw["go_key"], "element": raw["element"], "weapon_type": raw["weapon_type"],
        "checked": raw["checked"], "unsure": raw["unsure"], "main": raw["main"], "stellar": raw["stellar"],
        "modes": (mine or {}).get("modes") or {}, "talents": talents, "counted": [f"{t}|{r['name']}" for t, r in counted],
        "toggles": toggles, "left_out": raw["left_out"], "damage": damage, "wiki": wiki, "has_rows": block is not None,
    }


def _indented(text: str) -> str:
    """A text of several lines as one list item: its later lines are indented under it."""
    return text.replace("\n", "\n  ")


def _pct(value: float | None) -> str:
    return "no change" if value is None or abs(value) < 5e-3 else f"{value:+.1f}%"


def render(facts: dict) -> str:
    """The sheet as Markdown."""
    out: list[str] = []
    add = out.append
    add(f"# Decision sheet: {facts['name']} (`{facts['key']}`)")
    add("")
    state = "decided" if facts["checked"] else "not decided yet"
    add(f"{facts['element'].capitalize()} {facts['weapon_type']} · GO key `{facts['go_key']}` · {state}"
        + (f" · unsure: {facts['unsure']}" if facts["unsure"] else ""))
    add("")
    add("Rows are at talent level 10, as the planner builds them from HoYoLAB's rows. Her kit is read at Constellation 6 so that every "
        "toggle shows. Damage is our engine (damage.ts) on the comparison's standard build of her weapon type (a 5-star weapon at 90 R1, "
        "five Gladiator's Finale +20 pieces, level 90, talents 10/10/10, no reaction). Suggestions come from a rule and are not "
        "decisions.")
    add("")
    add("## Her main talents and their counted rows")
    add("")
    if not facts["has_rows"]:
        add("No row text for her (no entry in cases.json and no GO checkout to read it from): the rows are not shown.")
    for talent in facts["talents"]:
        if not talent["main"]:
            continue
        add(f"### {talent['name']} (`{talent['key']}`)")
        add("")
        add("| Row | Kind | Move | Scales on at Lv 10 | Counted |")
        add("|---|---|---|---|---|")
        for row in talent["rows"]:
            add(f"| {row['name']} | {row['kind']} | {row['move']} | {row['scaling']} | {'yes' if row['main'] else 'no'} |")
        add("")
    others = [f"{t['name']} ({len(t['rows'])} rows)" for t in facts["talents"] if not t["main"]]
    if others:
        add("Not main talents: " + ", ".join(others) + ".")
        add("")
    if facts["main"]:
        add("Her decision file names these rows as her main ones: " + ", ".join(facts["main"]) + ".")
        add("")
    if facts["stellar"] or facts["modes"]:
        add(f"Fixed for her now: Stellar kind `{facts['stellar']}`; modes " + (
            ", ".join(f"`{n}` = {m['state']}" for n, m in facts["modes"].items()) or "none") + ".")
        add("")
    add("## Toggles")
    add("")
    damage = facts["damage"]
    if damage is None:
        add("Damage: not computed (no standard build for her, or the run was left out): the reach below is by scope alone.")
        add("")
    if not facts["toggles"]:
        add("She has no toggles: nothing to decide here.")
        add("")
    for toggle in facts["toggles"]:
        now = "on" if toggle["on"] else "off"
        add(f"### `{toggle['name']}`: \"{toggle['label']}\" (now {now}, state `{toggle['state']}`)")
        add("")
        add(f"GO's condition: `{toggle['go_condition']}`")
        add("")
        add("Effects (our Effect form):")
        add("")
        for effect in toggle["effects"]:
            add(f"- {effect_text(effect)}")
            add(f"  `{effect_form(effect)}`")
        for infusion in toggle["infusions"]:
            add(f"- infuses {'/'.join(infusion.get('talents') or [])} with {infusion.get('element')}: "
                f"`{json.dumps(infusion, ensure_ascii=False)}`")
        if not toggle["effects"] and not toggle["infusions"]:
            add("- none of its effects is left in kits.json")
        add("")
        if toggle["reached"]:
            add(f"Reaches ({'measured' if toggle['measured'] else 'by scope'}): " + ", ".join(toggle["reached"]))
        else:
            add("Reaches: none of her counted hits")
        measured = toggle["measured"]
        if measured:
            moves = "; ".join(f"{t} {_pct(v)}" for t, v in measured["talents"].items()) or "no counted row"
            add(f"Moves her main talents' damage, alone: {moves}")
        together = toggle.get("together")
        if together:
            beside = "; ".join(f"{t} {_pct(v)}" for t, v in together["talents"].items()) or "no counted row"
            add(f"With the states beside it that its effects need ({', '.join(together['with'])}): {beside}")
        add("")
        verdict, why = toggle["suggestion"]
        add(f"Suggestion (a rule, not a decision): {verdict} — {why}.")
        decision = toggle["decision"]
        if decision:
            covers = f", covers {', '.join(decision['covers'])}" if decision.get("covers") else ""
            add(f"Decided now: {'on' if decision['on'] else 'off'}{covers}: {decision['reason']}")
        add("")
    if damage and "(decided)" in damage["toggles"]:
        both = damage["toggles"]["(decided)"]["talents"]
        add("With every toggle that is on now switched on together: " + "; ".join(f"{t} {_pct(v)}" for t, v in both.items()) + ".")
        add("")
    add("## Left out")
    add("")
    if not facts["left_out"]:
        add("Nothing of her sheet is left out.")
    for item in facts["left_out"]:
        expr = item.get("expr") or ""
        add(f"- {item['what']}: {item['why']}" + (f" (`{expr[:140]}{'…' if len(expr) > 140 else ''}`)" if expr else ""))
    add("")
    page = facts["wiki"]
    add("## Her passives" + (f" (HoYoLAB wiki, {page['source']}" + (f", game version {page['version']}" if page.get("version") else "") + ")"
                             if page and "error" not in page else ""))
    add("")
    if not page or "error" in page:
        add(f"Not available: {(page or {}).get('error', 'the wiki was left out')}.")
        add("")
    else:
        for title, text in page["passives"] or [("(none)", "")]:
            add(f"- **{title}** {_indented(text)}")
        add("")
        add("## Her constellations")
        add("")
        for number, (title, text) in enumerate(page["constellations"], start=1):
            add(f"- **C{number}, {title}** {_indented(text)}")
        add("")
    return "\n".join(out)


# ------------------------------------------------------------------------------------------------ damage of each toggle

def run_damage(keys: list[str], work: Path) -> dict[str, dict]:
    """Each toggle's effect on her main talents' damage, for `keys`, by our own engine (web/src/pages/characters/toggles.test.ts under
    vitest). The input is the comparison fixture's shape: each character's hits block read at Constellation 6 and her standard
    build's case from the committed fixture (a character with none has no damage). {} when the run fails; the sheets say so."""
    fixture = json.loads(compare.FIXTURE.read_text(encoding="utf-8"))
    cases_of: dict[str, dict] = {}
    for case in fixture["cases"]:
        if case["character"] in keys and "error" not in case and case["reaction"] is None and (
                case["character"] not in cases_of or case["id"] == f"{case['character']}:goblet"):
            cases_of[case["character"]] = case
    affixes = json.loads(compare.CASES.read_text(encoding="utf-8"))["affixes"]
    characters = kit_data.load_kits()["characters"]
    blocks = {key: compare.block(key, affixes[key], constellation=CONSTELLATION) for key in cases_of if key in affixes}
    kinds = sorted({characters[key]["weapon_type"] for key in blocks})
    data = {
        "tolerance": compare.TOLERANCE, "tables": fixture["tables"], "gear": {kind: compare.gear(kind) for kind in kinds},
        "kits": {key: {k: v for k, v in b.items() if k not in ("weapon_effects", "set_effects")} for key, b in blocks.items()},
        "cases": [{**cases_of[key], "ours": None} for key in blocks],
    }
    if not blocks:
        return {}
    work.mkdir(parents=True, exist_ok=True)
    source, result = work / "toggles-in.json", work / "toggles-out.json"
    compare.write(source, json.loads(json.dumps(data)))
    result.unlink(missing_ok=True)
    npx = shutil.which("npx") or "npx"
    run = subprocess.run([npx, "vitest", "run", "src/pages/characters/toggles.test.ts"], cwd=ROOT / "web", capture_output=True, text=True,
                   env={**os.environ, "GB_TOGGLES_IN": str(source), "GB_TOGGLES_OUT": str(result)})
    if not result.exists():
        tail = "\n".join((run.stderr or run.stdout or "").strip().splitlines()[-15:])
        print(f"the damage run wrote nothing: the sheets have no damage numbers\n{tail}", file=sys.stderr)
        return {}
    return json.loads(result.read_text(encoding="utf-8"))


def _default_affixes(key: str) -> dict | None:
    """Her rows' text at level 10: cases.json's, else read from the GO checkout (talent_rows.py)."""
    known = json.loads(compare.CASES.read_text(encoding="utf-8"))["affixes"]
    if key in known:
        return known[key]
    try:
        return compare.affixes_of(kit_data.load_kits()["characters"][key]["go_key"])
    except (OSError, KeyError, ValueError):
        return None


def write_sheets(keys: list[str], folder: Path = SHEETS, *, damage: Callable[[list[str]], dict] | None = None,
                 wiki: Callable[[str], dict] | None = None, affixes: Callable[[str], dict | None] = _default_affixes) -> list[Path]:
    """A sheet for each of `keys` in `folder`; the damage of every toggle is computed once for all of them (`damage(keys)`), her
    wiki text once each (`wiki(name)`)."""
    characters = kit_data.load_kits()["characters"]
    unknown = [key for key in keys if key not in characters]
    if unknown:
        raise SystemExit(f"not characters of kits.json: {', '.join(unknown)}")
    folder.mkdir(parents=True, exist_ok=True)
    answers = (damage if damage is not None else (lambda ks: run_damage(ks, folder / ".work")))(keys) if keys else {}
    look = wiki if wiki is not None else wiki_page
    written = []
    for key in keys:
        facts = collect(key, affixes=affixes(key), damage=answers.get(key), wiki=look(characters[key]["name"]))
        path = folder / f"{key}.md"
        path.write_text(render(facts), encoding="utf-8", newline="\n")
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    import run

    arguments = list(sys.argv[1:] if argv is None else argv)
    options = {a for a in arguments if a in ("--no-damage", "--no-wiki")}
    keys = run.parse_keys([a for a in arguments if a not in options])
    if not keys:
        raise SystemExit(__doc__)
    paths = write_sheets(
        keys, SHEETS, damage=(lambda ks: {}) if "--no-damage" in options else None,
        wiki=(lambda name: {"error": "left out (--no-wiki)"}) if "--no-wiki" in options else None)
    for path in paths:
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
