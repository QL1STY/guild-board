"""R1: the inventory of characters, weapons and artifact sets, read from the HoYoLAB wiki.

Run: uv run python tools/research/inventory.py   (build time only; reads the wiki, writes tools/research/out/)

Writes
  out/inventory.json      every character, weapon and set (plain snake_case keys)
  out/kits/<key>.json     each character's kit in short, which R3 reads instead of the whole entry
Entry pages are cached in out/raw/, so a second run asks the wiki only for what is missing.

Sources (checked 2026-10-29):
  https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list   menus 2 (characters), 4 (weapons), 5 (sets)
  https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=<id>   an entry's modules
  Version names: the wiki writes 6.0 to 6.7 as "Luna I" to "Luna VIII". 6.0 is Luna I, released 2025-09-10
  (https://www.siliconera.com/6-0-genshin-impact-update-called-version-luna-i-launches-in-september/), 6.6 is Luna VII,
  released 2026-05-20 (https://allthings.how/genshin-impact-version-6-6-luna-vii-release-timeline-and-banners/), and 6.7 is
  Luna VIII, released 2026-07-01 (https://allthings.how/genshin-impact-6-7-luna-viii-release-time-and-countdown/); the
  numerals run in order between them. Version 7.0 followed 6.7 on 2026-08-12 (no 6.8: same page).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wikiapi as w  # noqa: E402

CHECKED = date.today().isoformat()
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}
# "Luna <numeral>" is version 6.<numeral - 1>; see the sources in the module's docstring.
LUNA_MAJOR = 6
ROOT = w.HERE.parents[1]
STATS = ("Max HP", "ATK", "DEF", "Elemental Mastery", "Energy Recharge", "CRIT Rate", "CRIT DMG")
STAT_RE = re.compile(r"\b(Max HP|ATK|DEF|Elemental Mastery|Energy Recharge|CRIT Rate|CRIT DMG)\b")
VERSION_RE = re.compile(r"\b(\d+)\.(\d+)\b")
LUNA_RE = re.compile(r"\bLuna\s+([IVX]+)\b")
ITEM_RE = re.compile(r"\$\[(.*)\]\$", re.S)
ASCEND_STAT_NAMES = {"HP": "HP", "ATK": "ATK", "DEF": "DEF"}


def current_version(override: str | None) -> tuple[str, str]:
    """Today's game version as ("7.1", "how it was found"): `reference/versions.json`'s calendar says which version began
    on which day and how long a version lasts; a version that has run its length is followed by the next minor number."""
    if override:
        return override, "given on the command line"
    calendar = json.loads((ROOT / "src/guildboard/reference/versions.json").read_text(encoding="utf-8"))["calendar"]
    major, minor = (int(part) for part in str(calendar["version"]).split("."))
    start = date.fromisoformat(calendar["started"])
    step = timedelta(days=int(calendar["cadence_days"]))
    today = date.today()
    while today >= start + step:
        start += step
        minor += 1
    return f"{major}.{minor}", f"reference/versions.json's calendar (began {start.isoformat()}), on {CHECKED}"


def parse_version(raw: str) -> tuple[tuple[int, int] | None, str]:
    """(major, minor) from the wiki's "Version Released" text, and a note. Handles "7.1", "Luna VIII" and Aloy's
    "2.1 PlayStation / 2.2 All Platforms" (the first is kept; the note says so)."""
    text = raw.strip()
    luna = LUNA_RE.search(text)
    if luna and luna.group(1) in ROMAN:
        return (LUNA_MAJOR, ROMAN[luna.group(1)] - 1), ""
    found = VERSION_RE.findall(text)
    if not found:
        return None, f"the version {raw!r} is not one the script reads"
    note = "the wiki gives several versions; the first is kept" if len(found) > 1 else ""
    return (int(found[0][0]), int(found[0][1])), note


def version_text(version: tuple[int, int] | None) -> str | None:
    return None if version is None else f"{version[0]}.{version[1]}"


def rank(values: list[str] | None) -> int | None:
    """"5-Star" as 5."""
    for value in values or []:
        match = re.match(r"(\d)", value)
        if match:
            return int(match.group(1))
    return None


def first(page: dict[str, Any], field: str) -> str | None:
    values = (page.get("filter_values") or {}).get(field, {}).get("values") or []
    return values[0] if values else None


def material_items(strings: list[str]) -> list[dict[str, Any]]:
    """The items of one phase's `materials` strings ("$[{...}]$")."""
    items: list[dict[str, Any]] = []
    for text in strings or []:
        match = ITEM_RE.search(text or "")
        if not match:
            continue
        try:
            items.extend(json.loads("[" + match.group(1).strip().lstrip("[").rstrip("]") + "]"))
        except json.JSONDecodeError:
            continue
    return items


def local_specialty(page: dict[str, Any]) -> dict[str, Any] | None:
    """The Ascend materials' local specialty: the item whose wiki entry has the type "Local Specialty (<region>)"."""
    seen: dict[int, str] = {}
    for data in w.components(page, "Ascend", "ascension"):
        for phase in (data or {}).get("list", []):
            if str(phase.get("key", "")).replace(" ", "") not in ("Lv.20", "Lv.40"):
                continue
            for item in material_items(phase.get("materials", [])):
                ep_id = item.get("ep_id")
                name = item.get("nickname") or item.get("name") or ""
                if isinstance(ep_id, int) and name != "Mora":
                    seen.setdefault(ep_id, name)
    for ep_id, name in seen.items():
        info = w.base_info(w.entry(ep_id))
        kind = info.get("Type", "")
        if kind.startswith("Local Specialty"):
            region = kind[kind.find("(") + 1 : kind.rfind(")")] if "(" in kind else None
            title = info.get("Name") or name
            return {"key": w.slug(title), "name": title, "entry_id": ep_id, "region": region}
    return None


def gallery_url(page: dict[str, Any], label: str) -> str | None:
    for data in w.components(page, "Gallery", "gallery_character"):
        for row in (data or {}).get("list", []):
            if str(row.get("key", "")).strip() == label and row.get("img"):
                return row["img"]
    return None


def stats_in(text: str) -> list[str]:
    """The stats a text names, in the order they first appear."""
    found: list[str] = []
    for match in STAT_RE.finditer(text):
        if match.group(1) not in found:
            found.append(match.group(1))
    return found


PERCENT_ONLY = re.compile(r"^[\d.,%()×x+\s]+$")


def line_of(label: str, values: list[str], text_stats: list[str]) -> dict[str, Any]:
    """One scaling line with `stat` and where it comes from (`stat_source`):
    - "wiki_value": the value's own text names it ("134% DEF", "8.0% Max HP+770");
    - "assumed_atk": a DMG line whose value names no stat, in a talent whose text names no Max HP, DEF or Elemental
      Mastery. The game scales such lines with ATK, but the wiki does not say so: an assumption, for the reader to confirm;
    - "check": a DMG line with no stat in its value in a talent whose text names another stat: the reader decides;
    - "none": not a multiplier (cooldown, duration, energy, a bonus)."""
    named = (stats_in(values[0]) or [None])[0] if values else None
    if named:
        return {"name": label, "values": values, "stat": named, "stat_source": "wiki_value"}
    is_damage = "DMG" in label.split() or "Damage" in label or label.endswith("DMG")
    is_damage = is_damage and "Bonus" not in label
    if values and is_damage and PERCENT_ONLY.match(values[0]):
        if set(text_stats) & {"Max HP", "DEF", "Elemental Mastery"}:
            return {"name": label, "values": values, "stat": None, "stat_source": "check"}
        return {"name": label, "values": values, "stat": "ATK", "stat_source": "assumed_atk"}
    return {"name": label, "values": values, "stat": None, "stat_source": "none"}


def kit(page: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    """A character's kit in short. Each talent: name and text; those with a scaling table also their lines (every level's
    value, as the wiki writes them) and, per line, `stat` and `stat_source` (see `line_of`). `stats_in_text` lists the stats
    the talent's text names, for the reader to judge a line marked "check"."""
    talents_out: list[dict[str, Any]] = []
    talents: list[dict[str, Any]] = []
    for data in w.components(page, "Talents", "talent"):
        talents.extend((data or {}).get("list", []))
    for index, talent in enumerate(talents):
        title = w.plain(talent.get("title") or talent.get("key") or "")
        text = w.plain(talent.get("desc") or "")
        entry: dict[str, Any] = {"index": index, "name": title, "text": text, "stats_in_text": stats_in(text)}
        attributes = talent.get("attributes") or []
        lines: list[dict[str, Any]] = []
        for row in attributes:
            label = str(row.get("key", "")).strip()
            values = [str(v) for v in (row.get("values") or [])]
            if label == "Level":
                entry["levels"] = len(values)
            else:
                lines.append(line_of(label, values, entry["stats_in_text"]))
        if lines:
            entry["kind"] = "active"
            entry["scaling"] = lines
        else:
            entry["kind"] = "passive"
        talents_out.append(entry)
    constellations: list[dict[str, str]] = []
    for data in w.components(page, "Constellation", "summaryList"):
        for number, row in enumerate((data or {}).get("list", []), start=1):
            constellations.append({"c": f"C{number}", "name": w.plain(row.get("name", "")), "text": w.plain(row.get("desc", ""))})
    return {
        "key": record["key"],
        "name": record["name"],
        "entry_id": record["entry_id"],
        "element": record["element"],
        "weapon_type": record["weapon_type"],
        "rarity": record["rarity"],
        "ascension_stat": record["ascension_stat"],
        "ascension_stat_note": "the stat of the ascension bonus the wiki lists (its 'Bonus Attributes From Ascension')",
        "talents": talents_out,
        "constellations": constellations,
        "source": f"https://wiki.hoyolab.com/pc/genshin/entry/{record['entry_id']}",
        "checked": CHECKED,
    }


def read_character(listed: dict[str, Any], game: tuple[int, int]) -> tuple[dict[str, Any], dict[str, Any]]:
    entry_id = listed["entry_page_id"]
    page = w.entry(entry_id)
    info = w.base_info(page)
    name = page.get("name") or listed["name"]
    notes: list[str] = []
    element = first(page, "character_vision")
    weapon_type = first(page, "character_weapon")
    rarity = rank((page.get("filter_values") or {}).get("character_rarity", {}).get("values"))
    ascension = first(page, "character_property")
    raw_version = info.get("Version Released", "")
    version, note = parse_version(raw_version) if raw_version else (None, "the entry gives no version")
    if note:
        notes.append(note)
    if weapon_type is None:
        notes.append("the entry gives no weapon type")
    if rarity is None:
        notes.append("the entry gives no rarity")
    released = weapon_type is not None and rarity is not None and version is not None and version <= game
    if version is not None and version > game:
        notes.append(f"version {version_text(version)} is later than today's game version {game[0]}.{game[1]}")
    specialty = local_specialty(page)
    if specialty is None:
        notes.append("no local specialty found among the Lv.20 and Lv.40 ascension materials")
    avatar, chart = gallery_url(page, "Avatar"), gallery_url(page, "Constellation")
    if avatar is None:
        notes.append("the Gallery has no 'Avatar' picture")
    if chart is None:
        notes.append("the Gallery has no 'Constellation' chart")
    record = {
        "key": w.slug(name),
        "name": name,
        "entry_id": int(entry_id),
        "element": element,
        "weapon_type": weapon_type,
        "rarity": rarity,
        "ascension_stat": ascension,
        "region": first(page, "character_region"),
        "version": version_text(version),
        "version_raw": raw_version,
        "released": released,
        "local_specialty": specialty,
        "avatar_url": avatar,
        "constellation_url": chart,
        "icon_url": page.get("icon_url") or listed.get("icon_url"),
        "notes": "; ".join(notes),
    }
    return record, kit(page, record)


def read_gear(kind: str, listed: dict[str, Any], game: tuple[int, int]) -> dict[str, Any]:
    entry_id = listed["entry_page_id"]
    fields = listed.get("filter_values") or {}
    name = listed["name"]
    notes: list[str] = []
    record: dict[str, Any] = {"key": w.slug(name), "name": name, "entry_id": int(entry_id), "icon_url": listed.get("icon_url")}
    if kind == "weapon":
        record["type"] = first(listed, "weapon_type")
        record["rarity"] = rank(fields.get("weapon_rarity", {}).get("values"))
        record["substat"] = first(listed, "weapon_property")
    else:
        stars = [len(value) for value in (fields.get("filter_key_43", {}).get("values") or [])]
        record["rarity"] = max(stars) if stars else None
        record["rarities"] = sorted(stars)
        record["effect_tags"] = fields.get("reliquary_effect", {}).get("values") or []
        record["type"] = "artifact_set"
    page = w.entry(entry_id)
    raw_version = w.base_info(page).get("Version Released", "")
    version, note = parse_version(raw_version) if raw_version else (None, "the entry gives no version")
    record["version"] = version_text(version)
    # None, not False, when the wiki gives no version: the entry is then of unknown age, not known to be unreleased.
    record["released"] = None if version is None else version <= game
    if note:
        notes.append(note)
    if record["rarity"] is None:
        notes.append("the list gives no rarity")
    record["notes"] = "; ".join(notes)
    return record


REFERENCE = ROOT / "src/guildboard/reference/characters/inventory.json"
ELEMENTS = {"Pyro", "Hydro", "Anemo", "Electro", "Dendro", "Cryo", "Geo"}
WEAPON_TYPES = {"Sword", "Claymore", "Polearm", "Bow", "Catalyst"}


def reference_shape(characters: list[dict[str, Any]], weapons: list[dict[str, Any]], sets: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """The inventory in the shape of schema/inventory.schema.json, and the characters the schema refuses. The schema
    wants an element, a weapon type and a rarity of 4 or 5 on every character, so an entry that lacks one (the
    elementless Traveler, Manekin and Manekina; Valeriy and Mitya, whose entries have no weapon type or rarity yet)
    cannot be written there. They stay in out/inventory.json."""
    refused: list[str] = []
    out_characters: list[dict[str, Any]] = []
    for c in characters:
        if c["element"] not in ELEMENTS or c["weapon_type"] not in WEAPON_TYPES or c["rarity"] not in (4, 5):
            refused.append(f"{c['key']} (element {c['element']}, weapon type {c['weapon_type']}, rarity {c['rarity']})")
            continue
        out_characters.append({
            "key": c["key"], "name": c["name"], "entry": str(c["entry_id"]), "element": c["element"],
            "weapon_type": c["weapon_type"], "rarity": c["rarity"], "released": c["released"], "icon": c["icon_url"],
            "version": c["version"], "ascension_stat": c["ascension_stat"],
            "specialty": {"key": c["local_specialty"]["key"], "name": c["local_specialty"]["name"]} if c["local_specialty"] else None,
            "art": c["avatar_url"], "chart": c["constellation_url"],
        })
    out_weapons = [
        {"key": x["key"], "name": x["name"], "entry": str(x["entry_id"]), "type": x["type"], "rarity": x["rarity"], "icon": x["icon_url"]}
        for x in weapons if x["type"] in WEAPON_TYPES and isinstance(x["rarity"], int)
    ]
    out_sets = [{"key": x["key"], "name": x["name"], "entry": str(x["entry_id"]), "icon": x["icon_url"]} for x in sets]
    return {"characters": out_characters, "weapons": out_weapons, "sets": out_sets}, refused


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--game-version", help="today's game version, when versions.json's calendar is not right")
    args = parser.parse_args()
    game_text, how = current_version(args.game_version)
    game = tuple(int(part) for part in game_text.split("."))
    print(f"game version {game_text} ({how})")

    listed_characters = w.list_entries("2")
    listed_weapons = w.list_entries("4")
    listed_sets = w.list_entries("5")
    print(f"listed: {len(listed_characters)} characters, {len(listed_weapons)} weapons, {len(listed_sets)} sets")

    # Entry pages first, in parallel, so the reads below find them kept.
    w.parallel(lambda e: w.entry(e["entry_page_id"]), listed_characters + listed_weapons + listed_sets)
    pairs = w.parallel(lambda e: read_character(e, game), listed_characters)
    characters = [record for record, _ in pairs]
    weapons = w.parallel(lambda e: read_gear("weapon", e, game), listed_weapons)
    sets = w.parallel(lambda e: read_gear("set", e, game), listed_sets)

    for group, label in ((characters, "character"), (weapons, "weapon"), (sets, "set")):
        keys = [r["key"] for r in group]
        duplicates = sorted({k for k in keys if keys.count(k) > 1})
        if duplicates:
            print(f"WARNING: two {label}s share a key: {duplicates}")

    kits_dir = w.OUT / "kits"
    kits_dir.mkdir(parents=True, exist_ok=True)
    for _, one in pairs:
        (kits_dir / f"{one['key']}.json").write_text(json.dumps(one, ensure_ascii=False, indent=1), encoding="utf-8")

    document = {
        "checked": CHECKED,
        "game_version": game_text,
        "game_version_from": how,
        "sources": [
            "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list (menus 2, 4, 5)",
            "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page (each entry and each ascension material)",
            "https://www.siliconera.com/6-0-genshin-impact-update-called-version-luna-i-launches-in-september/ (6.0 is Luna I)",
            "https://allthings.how/genshin-impact-version-6-6-luna-vii-release-timeline-and-banners/ (6.6 is Luna VII)",
            "https://allthings.how/genshin-impact-6-7-luna-viii-release-time-and-countdown/ (6.7 is Luna VIII; 7.0 followed it)",
        ],
        "characters": characters,
        "weapons": weapons,
        "sets": sets,
    }
    (w.OUT / "inventory.json").write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")

    shaped, refused = reference_shape(characters, weapons, sets)
    REFERENCE.write_text(json.dumps(shaped, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {REFERENCE.relative_to(ROOT)}: {len(shaped['characters'])} characters, {len(shaped['weapons'])} weapons, {len(shaped['sets'])} sets")
    print(f"the schema refuses {len(refused)} characters, left out of it: {refused}")
    print(f"the schema leaves out {len(weapons) - len(shaped['weapons'])} weapons")

    released = [c for c in characters if c["released"]]
    print(f"characters {len(characters)}: {len(released)} released, {len(characters) - len(released)} not")
    print(f"with a chart: {sum(1 for c in released if c['constellation_url'])} of the released")
    print(f"without a local specialty: {[c['key'] for c in characters if not c['local_specialty']]}")
    print(f"weapons {len(weapons)} (later than {game_text}: {sum(1 for x in weapons if x['released'] is False)}; no version: {sum(1 for x in weapons if x['released'] is None)}), sets {len(sets)} (later: {sum(1 for x in sets if x['released'] is False)}; no version: {sum(1 for x in sets if x['released'] is None)})")


if __name__ == "__main__":
    main()
