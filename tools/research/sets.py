"""R5: artifact set effects. Step 1 reads every set's 2-piece and 4-piece text and its pieces from the cached wiki entries;
the hand-written effects (effects/sets-NN.txt) are then checked against that text. Build time only.

Run: uv run python tools/research/sets.py            builds out/sets.json from effects/sets-*.txt and prints the check
     uv run python tools/research/sets.py --draft A B  prints the texts of the sets at positions A..B of the 4 and 5 star list

Source: https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=<id> for each set entry in
out/inventory.json, checked 2026-10-29 (the game's own text, kept in the checker's working data under out/ and never shipped). A set's `artifact_list` keys do not match its pieces
(`sands_of_eon` holds the Plume, and so on); each piece's `position` is right, so pieces are placed by `position`.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import effects_lib as fx  # noqa: E402
import wikiapi as w  # noqa: E402

CHECKED = "2026-10-29"
SHIPPED = w.HERE.parents[1] / "src" / "guildboard" / "reference" / "characters" / "sets.json"   # the schema's shape; out/sets.json keeps the fuller record
SLOT_OF_POSITION = {"Flower of Life": "flower", "Plume of Death": "plume", "Sands of Eon": "sands",
                    "Goblet of Eonothem": "goblet", "Circlet of Logos": "circlet"}
SOURCES = [
    "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=<id> (each set's entry: the pieces; the numbers of "
    "its 2-piece and 4-piece bonuses were read into `two` and `four`, and their text is read from the wiki at runtime), checked 2026-10-29",
]


def read_sets() -> list[dict[str, Any]]:
    inv = json.loads((w.OUT / "inventory.json").read_text(encoding="utf-8"))
    out = []
    for item in inv["sets"]:
        page = w.entry(item["entry_id"])
        texts = {}
        for data in w.components(page, "Attributes", "reliquary_set_effect"):
            texts.update(data or {})
        icons: dict[str, str] = {}
        names: dict[str, str] = {}
        for data in w.components(page, "Set", "artifact_list"):
            for piece in (data or {}).values():
                slot = SLOT_OF_POSITION.get(piece.get("position", ""))
                if slot:
                    if piece.get("icon_url"):
                        icons[slot] = piece["icon_url"]
                    names[slot] = piece.get("title", "")
        info = w.base_info(page)
        out.append({
            "key": item["key"], "name": item["name"], "entry_id": item["entry_id"], "rarities": item["rarities"],
            "two_text": w.plain(texts.get("two_set_effect", "")), "four_text": w.plain(texts.get("four_set_effect", "")),
            "one_text": w.plain(texts.get("single_set_effect", "")), "icons": icons, "pieces": names,
            "source": info.get("Source", ""), "icon": item["icon_url"],
        })
    return out


def main() -> None:
    sets = read_sets()
    rich = [x for x in sets if max(x["rarities"]) >= 4]
    if "--draft" in sys.argv:
        a, b = int(sys.argv[sys.argv.index("--draft") + 1]), int(sys.argv[sys.argv.index("--draft") + 2])
        for x in rich[a:b]:
            print(f"@ {x['key']} | {x['rarities']} | {x['name']}")
            for label in ("one", "two", "four"):
                if x[f"{label}_text"]:
                    print(f"  {label}: {x[label + '_text']}")
        return
    blocks: dict[str, fx.Block] = {}
    for path in sorted((w.HERE / "effects").glob("sets-*.txt")):
        for key, block in fx.read_blocks(path).items():
            if key in blocks:
                raise ValueError(f"{path.name}: {key} is written twice")
            blocks[key] = block
    problems: list[str] = []
    settled: list[str] = []
    derived = 0
    result: dict[str, Any] = {}
    for x in sets:
        notes: list[str] = []
        two: list[dict[str, Any]] = []
        four: list[dict[str, Any]] = []
        confidence = "high"
        if max(x["rarities"]) < 4:
            notes.append("Passive not counted")
        elif x["key"] not in blocks:
            notes.append("effects not written yet")
            confidence = "low"
            problems.append(f"{x['key']}: no effects block")
        else:
            block = blocks[x["key"]]
            notes.extend(block.notes)
            for e in block.effects:
                # A block's condition starts with "2:" or "4:" to say which piece count the effect belongs to.
                count, _, condition = e.condition.partition(" ")
                if count not in ("2", "4", "1"):
                    problems.append(f"{x['key']} line {e.line}: the condition must start with 2, 4 or 1 for the piece count")
                    continue
                text = {"2": x["two_text"], "4": x["four_text"], "1": x["one_text"]}[count]
                why = fx.check(e, text, 1)
                if why and e.settled:
                    settled.append(f"{x['key']} {count}-piece {e.stat} {e.values}: {why}; settled by hand: {e.settled}")
                elif why:
                    problems.append(f"{x['key']} line {e.line} {count}-piece {e.stat}: {why}")
                if e.stacks > 1:
                    derived += 1
                row = {"stat": e.stat, "values": e.values, "when": e.when, "condition": condition.strip()}
                if count == "2":
                    two.append(row)
                elif count == "4":
                    four.append(row)
                else:
                    notes.append(f"1-piece effect with a stat, not counted: {row}")
        result[x["key"]] = {
            "key": x["key"], "name": x["name"], "entry_id": x["entry_id"], "rarities": x["rarities"],
            "two": two, "four": four, "two_text": x["two_text"], "four_text": x["four_text"],
            "one_text": x["one_text"], "icons": x["icons"], "icon": x["icon"], "source": x["source"],
            "released_after_7_1": None, "notes": "; ".join(notes), "confidence": confidence,
        }
    newer = json.loads((w.HERE / "effects" / "sets_newer.json").read_text(encoding="utf-8")) if (w.HERE / "effects" / "sets_newer.json").exists() else {}
    for row in result.values():
        row["released_after_7_1"] = newer.get("default")
        row["version"] = None
        row["version_source"] = None
    for key, row in newer.get("sets", {}).items():
        if key in result:
            result[key]["released_after_7_1"] = row["after_7_1"]
            result[key]["version"] = row.get("version")
            result[key]["version_source"] = row.get("source")
    document = {"checked": CHECKED, "sources": SOURCES + newer.get("sources", []), "sets": result}
    (w.OUT / "sets.json").write_text(json.dumps(document, indent=1, ensure_ascii=False), encoding="utf-8")
    slim: dict[str, Any] = {}
    for key, r in result.items():
        note = r["notes"]
        if r["version"]:
            note = f"Version {r['version']} ({r['version_source']}), so not newer than 7.1. " + note
        slim[key] = {
            "name": r["name"], "two": r["two"], "four": r["four"],
            "icons": r["icons"], "entry": str(r["entry_id"]), "notes": note.strip(),
        }
    shipped_sources = document["sources"]
    SHIPPED.write_text(json.dumps({"sets": slim, "checked": CHECKED, "sources": shipped_sources}, indent=1, ensure_ascii=False), encoding="utf-8")
    both = [r for r in result.values() if r["two"] and r["four"]]
    print(f"{len(result)} sets; {len(rich)} with 4 or 5 star pieces; {sum(1 for r in result.values() if r['two'])} with a 2-piece effect, "
          f"{sum(1 for r in result.values() if r['four'])} with a 4-piece effect, {len(both)} with both; "
          f"{sum(1 for x in sets if max(x['rarities']) < 4)} below 4 star")
    print(f"{derived} effects use stacks")
    print(f"{len(settled)} values settled by hand:")
    for p in settled:
        print(" ", p)
    print(f"{len(problems)} values not found in their text:")
    for p in problems:
        print(" ", p)


if __name__ == "__main__":
    main()
