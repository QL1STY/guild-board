"""Talent rows as the game prints them, from a Genshin Optimizer checkout (a developer tool; nothing here ships).

GO keeps each talent's English row names and value formats (`dm-localization`, `{{0, percent(fixed: 1)}}%`) and the datamined
parameters by level (`stats/.../skillParam.json`). Rendered at a level they are the text HoYoLAB's `skill_affix_list` and the
wiki's talent tables show, which the planner's hits tests and the demo's characters stand on. Two commands:

    uv run python tools/go-reference/talent_rows.py demo-affixes    # the demo builds' skills get `affixes` at their own levels
    uv run python tools/go-reference/talent_rows.py talent-tables   # tests/characters_talent_tables.json

The checkout is `GB_GO_DIR` (default `%LOCALAPPDATA%\\guildboard-dev\\go`, see README.md), at the pinned commit."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GO = Path(os.environ.get("GB_GO_DIR") or Path(os.environ.get("LOCALAPPDATA", "")) / "guildboard-dev" / "go")
PARTS = {"normal": "auto", "skill": "skill", "burst": "burst"}
DEMO_BUILDS = ROOT / "src" / "guildboard" / "characters" / "demo" / "builds.json"
KITS = ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json"
TABLES = ROOT / "tests" / "characters_talent_tables.json"


def _read(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _render(encoding: str, params: list, level: int) -> str:
    def one(match: re.Match[str]) -> str:
        index, fmt = int(match.group(1)), match.group(2) or ""
        if index >= len(params):
            return "?"
        value = params[index][min(level - 1, len(params[index]) - 1)] if isinstance(params[index], list) else params[index]
        fixed = re.search(r"fixed: (\d)", fmt)
        digits = int(fixed.group(1)) if fixed else None
        if "percent" in fmt:
            return f"{value * 100:.{digits}f}" if digits is not None else f"{round(value * 100, 3):g}"
        return f"{value:.{digits}f}" if digits is not None else f"{value:g}"

    return re.sub(r"\{\{(\d+)(?:,\s*([^}]*))?\}\}", one, encoding)


def _aligned(encodings: dict, count: int) -> dict:
    """The encodings with their parameters as indices into GO's list, where GO leaves a few out (Ayaka's Normal Attack: the
    encodings reach {{11}}, GO has 10): when they name exactly as many parameters as GO has, the n-th is GO's n-th, as
    kitgen.aligned_rows reads them."""
    named = sorted({int(m) for e in encodings.values() if e for m in re.findall(r"\{\{(\d+)[,}]", e)})
    if not named or max(named) < count or len(named) != count:
        return encodings
    index = {p: i for i, p in enumerate(named)}
    return {k: re.sub(r"\{\{(\d+)", lambda m: "{{" + str(index[int(m.group(1))]), e) if e else e for k, e in encodings.items()}


def rows(go_key: str, talent: str, level: int, aligned: bool = False) -> list[tuple[str, str]]:
    """The (row name, value text) pairs of one talent ("normal", "skill" or "burst") at one level. `aligned`: the parameters
    lined up with GO's list where GO leaves some out (the comparison with GO uses it; the demo's text is kept as it was)."""
    part = PARTS[talent]
    params = _read(GO / "libs" / "gi" / "stats" / "Data" / "Characters" / go_key / "skillParam.json")[part]
    text = _read(GO / "libs" / "gi" / "dm-localization" / "assets" / "locales" / "en" / f"char_{go_key}_gen.json")[part]
    names, encodings = text["skillParams"], text["skillParamsEncoding"]
    if aligned:
        encodings = _aligned(encodings, len(params))
    return [(names[i], _render(encoding, params, level)) for i, encoding in encodings.items() if encoding and names.get(i)]


def _go_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return _read(KITS)["characters"][key]["go_key"]


def demo_affixes() -> None:
    data = _read(DEMO_BUILDS)
    for build in data["builds"]:
        for skill in build["skills"]:
            kind = {1: "normal", 2: "skill", 3: "burst"}[skill["skill_type"]]
            skill["affixes"] = [list(row) for row in rows(_go_key(build["name"]), kind, skill["level"])]
    DEMO_BUILDS.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8", newline="\n")


def _table(go_key: str, talent: str, levels: int, header: str, keep: list[str]) -> list[dict]:
    per_level = [dict(rows(go_key, talent, n)) for n in range(1, levels + 1)]
    table = [{"key": header, "values": [f"Lv.{n}" for n in range(1, levels + 1)]}]
    return table + [{"key": name, "values": [level[name] for level in per_level]} for name in keep]


def talent_tables() -> None:
    sandrone = {
        "normal": _table("Sandrone", "normal", 11, "Level", [
            "1-Hit DMG", "2-Hit DMG", "3-Hit DMG", "Charged Attack Sweeping Fire DMG", "Charged Attack Condensed Beam DMG",
            "Charged Attack Condensed Beam Stellar-Conduct DMG", "Charged Attack Condensed Beam Stellar Swirl DMG",
            "DMG When in Power Overdrive", "Plunge DMG"]),
        "skill": _table("Sandrone", "skill", 13, "Level", [
            "Prism Shot DMG", "Prism Shot Stellar-Conduct DMG", "Prism Shot Stellar Swirl DMG", "CD"]),
        "burst": _table("Sandrone", "burst", 13, "Level", [
            "Bombardment DMG", "Convective Inhibition Ray DMG", "Convective Inhibition Ray Stellar-Conduct DMG",
            "Convective Inhibition Ray Stellar Swirl DMG", "CD", "Energy Cost"]),
    }
    # Odette's burst table is headed "Leve" on the wiki.
    data = {"sandrone": sandrone, "odette_burst": _table("Odette", "burst", 13, "Leve", ["Slash DMG", "Final Slash DMG"])}
    TABLES.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    commands = {"demo-affixes": demo_affixes, "talent-tables": talent_tables}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit(__doc__)
    commands[sys.argv[1]]()
