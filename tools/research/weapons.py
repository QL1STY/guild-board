"""R4: weapon effects. Step 1 reads every weapon's level 90 base ATK, substat and passive text from the cached wiki entries;
Step 3 checks the hand-written effects (effects/weapons-NN.txt) against that text. Build time only.

Run: uv run python tools/research/weapons.py            builds out/weapons.json from effects/weapons-NN.txt and prints the check
     uv run python tools/research/weapons.py --draft A B  prints the passives of the weapons at positions A..B of the 4 and 5 star list

Source: https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=<id> for each weapon entry in
out/inventory.json, checked 2026-10-29 (the game's own text, as the plan's source order puts first). The text is the
checker's working data under out/ and is not shipped: the shipped weapons.json holds the numbers only, and the app reads a
passive's words from the wiki at runtime.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import effects_lib as fx  # noqa: E402
import wikiapi as w  # noqa: E402

CHECKED = "2026-10-29"
SHIPPED = w.HERE.parents[1] / "src" / "guildboard" / "reference" / "characters" / "weapons.json"   # the schema's shape; out/weapons.json keeps the fuller record
GENERIC = {"Name", "Source", "Type", "Region", "Version Released", "Secondary Attributes", "TCG Action Card",
           "Refinement Material", "Forging Blueprint", "Forging Material"}
SUBS = {"ATK Percentage": "atk_pct", "CRIT Rate": "cr", "Energy Recharge": "er", "CRIT DMG": "cd",
        "Elemental Mastery": "em", "HP Percentage": "hp_pct", "DEF Percentage": "def_pct",
        "Physical DMG Bonus": "phys"}
SOURCES = [
    "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=<id> (each weapon's entry: base ATK, "
    "substat; its passive's numbers were read into `effects`, and its text is read from the wiki at runtime), checked 2026-10-29",
]


def passive(page: dict[str, Any]) -> tuple[str, str, str]:
    """(name, plain text, text with each run of refinement values marked [..]) of a weapon's passive; empty when it has none."""
    for data in w.components(page, "Attributes", "baseInfo"):
        for row in (data or {}).get("list", []):
            key = str(row.get("key", "")).strip()
            if key in GENERIC:
                continue
            html = " ".join(row.get("value") or [])
            return key, w.plain(html), w.plain(re.sub(r"<span[^>]*>([^<]*)</span>", r"[\1]", html))
    return "", "", ""


def level90(page: dict[str, Any]) -> tuple[float | None, float | None, int | None]:
    """(base ATK, substat value, level) at the weapon's top level: Lv.90, or the last row a 1 or 2 star weapon has."""
    rows = [row for data in w.components(page, "Ascend", "ascension") for row in (data or {}).get("list", [])]
    rows = [row for row in rows if re.fullmatch(r"Lv\.\d+", str(row.get("key", "")).replace(" ", ""))]
    if not rows:
        return None, None, None
    row = max(rows, key=lambda r: int(re.sub(r"\D", "", r["key"])))
    values = (row.get("combatList") or [{}, {}])[1].get("values", [])
    nums = [fx.number(re.sub(r"[^0-9.]", "", v)) if re.search(r"\d", v or "") else None for v in values]
    # Exaiphanes Blade's Lv.90 row puts its ATK in the second column; the others put it in the first.
    atk = nums[0] if nums and nums[0] is not None else (nums[1] if len(nums) > 1 else None)
    return atk, (nums[2] if len(nums) > 2 else None), int(re.sub(r"\D", "", row["key"]))


def read_weapons() -> list[dict[str, Any]]:
    inv = json.loads((w.OUT / "inventory.json").read_text(encoding="utf-8"))
    out = []
    for item in inv["weapons"]:
        page = w.entry(item["entry_id"])
        name, text, marked = passive(page)
        atk, sub, top = level90(page)
        out.append({
            "key": item["key"], "name": item["name"], "entry_id": item["entry_id"], "type": item["type"],
            "rarity": item["rarity"], "base_atk_90": atk, "sub": SUBS.get(item["substat"]) if item["substat"] else None,
            "sub_name": item["substat"], "stats_level": top, "sub_90": sub if item["substat"] else 0, "passive_name": name,
            "passive": text, "marked": marked, "icon": item["icon_url"],
        })
    return out


def refinements(text: str) -> int:
    """How many refinement values the passive's text gives: the length of its longest run (5, or 0 when it has none)."""
    return max((len(g) for g in fx.groups(text)), default=0)


def main() -> None:
    weapons = read_weapons()
    if "--draft" in sys.argv:
        a, b = int(sys.argv[sys.argv.index("--draft") + 1]), int(sys.argv[sys.argv.index("--draft") + 2])
        top = [x for x in weapons if (x["rarity"] or 0) >= 4]
        for x in top[a:b]:
            print(f"@ {x['key']} | {x['rarity']}* {x['type']} | {x['passive_name']}\n{x['marked']}")
        return
    blocks: dict[str, fx.Block] = {}
    for path in sorted((w.HERE / "effects").glob("weapons-*.txt")):
        for key, block in fx.read_blocks(path).items():
            if key in blocks:
                raise ValueError(f"{path.name}: {key} is written twice")
            blocks[key] = block
    keys = {x["key"] for x in weapons}
    stray = sorted(set(blocks) - {x["key"] for x in weapons if (x["rarity"] or 0) >= 4})
    if stray:
        print("effects for weapons that are not 4 or 5 star or not in the inventory:", stray)
    problems: list[str] = []
    derived = 0
    settled: list[str] = []
    result: dict[str, Any] = {}
    for x in weapons:
        rich = (x["rarity"] or 0) >= 4
        block = blocks.get(x["key"])
        effects = []
        notes = []
        confidence = "high"
        if x["stats_level"] != 90:
            notes.append(f"stats are at level {x['stats_level']}, the highest this weapon has")
        if not rich:
            notes.append("Passive not counted")
        elif block is None:
            notes.append("effects not written yet")
            confidence = "low"
            problems.append(f"{x['key']}: no effects block")
        else:
            notes.extend(block.notes)
            for e in block.effects:
                why = fx.check(e, x["passive"], 5)
                if why and e.settled:
                    settled.append(f"{x['key']} {e.stat} {e.values}: {why}; settled by hand: {e.settled}")
                elif why:
                    problems.append(f"{x['key']} line {e.line} {e.stat}: {why}")
                if e.stacks > 1:
                    derived += 1
                effects.append({"stat": e.stat, "values": e.values, "when": e.when, "condition": e.condition})
            if not block.effects and not block.notes:
                notes.append("the passive has no effect that is a stat")
        result[x["key"]] = {
            "key": x["key"], "name": x["name"], "entry_id": x["entry_id"], "type": x["type"], "rarity": x["rarity"],
            "stats_level": x["stats_level"], "base_atk_90": x["base_atk_90"], "sub": x["sub"], "sub_90": x["sub_90"], "effects": effects,
            "passive": x["passive"], "icon": x["icon"], "notes": "; ".join(notes), "confidence": confidence,
        }
    document = {"checked": CHECKED, "sources": SOURCES, "weapons": result}
    (w.OUT / "weapons.json").write_text(json.dumps(document, indent=1, ensure_ascii=False), encoding="utf-8")
    slim: dict[str, Any] = {}
    for key, r in result.items():
        note = r["notes"]
        if r["confidence"] != "high":
            note = f"Confidence: {r['confidence']}. " + note
        slim[key] = {
            "name": r["name"], "type": r["type"], "rarity": r["rarity"], "base_atk_90": r["base_atk_90"] or 0,
            "sub": r["sub"], "sub_90": r["sub_90"] or 0, "effects": r["effects"],
            "icon": r["icon"], "entry": str(r["entry_id"]), "notes": note,
        }
    SHIPPED.write_text(json.dumps({"weapons": slim, "checked": CHECKED, "sources": SOURCES}, indent=1, ensure_ascii=False), encoding="utf-8")
    rich = [r for r in result.values() if (r["rarity"] or 0) >= 4]
    print(f"{len(result)} weapons; {len(rich)} at 4 or 5 star, {sum(1 for r in rich if r['effects'])} with effects; "
          f"{sum(1 for r in result.values() if (r['rarity'] or 0) < 4)} below 4 star")
    print(f"{derived} effects use stacks (value = text's number x stacks)")
    print(f"{len(settled)} values settled by hand:")
    for p in settled:
        print(" ", p)
    print(f"{len(problems)} values not found in their text:")
    for p in problems:
        print(" ", p)


if __name__ == "__main__":
    main()
