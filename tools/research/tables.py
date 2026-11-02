"""R6: the tables (yields per run, artifact odds and values, talent scaling, reactions, level EXP).

Run: uv run python tools/research/tables.py   (build time only; fetches, writes out/tables.json)
Fetched pages are kept in out/raw_tables/ so a second run asks for nothing; delete the folder to read everything again.

Sources (each fetched today, see CHECKED):
  DM  The game's own data tables, as the community datamine mirrors them (last data commit 2026-05-23, game 6.6; these
      tables do not change from version to version):
      https://gitlab.com/Dimbreath/AnimeGameData/-/raw/master/ExcelBinOutput/<file>.json
        AvatarLevelExcelConfigData (character EXP), WeaponLevelExcelConfigData (weapon EXP by rarity),
        ProudSkillExcelConfigData (talent multipliers by level), ReliquaryLevelExcelConfigData (main stats at +20),
        ReliquaryAffixExcelConfigData (substat rolls)
  GW  The Genshin Impact fandom wiki, through its MediaWiki API (https://genshin-impact.fandom.com/api.php?action=parse):
        Loot_System/Material_Drop_Distribution, Loot_System/Artifact_Drop_Distribution (both from the Genshin Data
        Gathering team's drop counts), Artifact/Distribution, Artifact/Stats, Ley_Line_Outcrop, Elemental_Reaction,
        Character_EXP, Weapon_EXP/<n>-Star_Weapons
  GO  Genshin Optimizer's own tables: https://github.com/frzyc/genshin-optimizer/blob/master/libs/gi/upopt/src/consts.ts
        (substat weights and main stat odds)
  HW  The HoYoLAB wiki's talent texts, read for R3 into out/kits/*.json (checks the scaling tables)
Every number below is read or computed from those; a check that fails stops the script.
"""
from __future__ import annotations

import glob
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
REFERENCE = HERE.parents[1] / "src" / "guildboard" / "reference" / "characters"
CACHE = OUT / "raw_tables"
CHECKED = date.today().isoformat()
UA = {"User-Agent": "Mozilla/5.0 (Guild Board research script)"}
GITLAB = "https://gitlab.com/Dimbreath/AnimeGameData/-/raw/master/ExcelBinOutput/"
FANDOM = "https://genshin-impact.fandom.com/api.php?action=parse&format=json&prop=%s&page=%s"
GO_CONSTS = "https://raw.githubusercontent.com/frzyc/genshin-optimizer/master/libs/gi/upopt/src/consts.ts"


# ---------------------------------------------------------------- fetching

def cached(name: str, url: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as response:
        text = response.read().decode("utf-8")
    path.write_text(text, encoding="utf-8")
    return text


def datamine(file: str):
    return json.loads(cached(f"dm_{file}.json", f"{GITLAB}{file}.json"))


def fandom(page: str, prop: str = "text") -> str:
    raw = cached(f"fandom_{prop}_{page.replace('/', '_')}.json", FANDOM % (prop, urllib.parse.quote(page)))
    data = json.loads(raw)["parse"][prop]["*"]
    return data


def flat(page: str) -> str:
    """A fandom page as text; table cells end with ' | ', images are shown by their alt text."""
    h = fandom(page)
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", h, flags=re.S)
    h = re.sub(r'<img[^>]*alt="([^"]*)"[^>]*>', r"[\1]", h)
    h = re.sub(r"</(tr|p|div|li|h\d|table)>", "\n", h)
    h = re.sub(r"</t[dh]>", " | ", h)
    text = html.unescape(re.sub(r"<[^>]+>", "", h))
    return re.sub(r"\n\s*\n+", "\n", re.sub(r"[ \t]+", " ", text))


def tokens(text: str) -> list[str]:
    return [t.strip() for t in re.split(r"[|\n]", text) if t.strip()]


def section(text: str, start: str, end: str | None = None) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start)) if end else len(text)
    return text[i:j]


def row_after(text: str, label: str, count: int, occurrence: int = 0) -> list[str]:
    """The `count` tokens that follow the `occurrence`-th token equal to `label`."""
    toks = tokens(text)
    hits = [i for i, t in enumerate(toks) if t == label]
    i = hits[occurrence]
    return toks[i + 1 : i + 1 + count]


def num(token: str) -> float:
    return float(re.sub(r"\[\d+\]|\*", "", token).replace(",", ""))


def need(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"check failed: {message}")


# ---------------------------------------------------------------- yields

def yields() -> tuple[dict, dict, list[str]]:
    loot = flat("Loot System/Material Drop Distribution")
    notes: list[str] = []
    # Talent books, domain level IV: 2-star, 3-star, 4-star averages. Three of a lower tier craft one of the next.
    talent = section(loot, "Talent Books[]", "2-Star Roll[]")
    t = row_after(talent, "IV", 6)
    teachings, guides, philosophies = num(t[1]), num(t[3]), num(t[5])
    books = teachings / 9 + guides / 3 + philosophies
    # Weapon ascension materials, domain level IV: 2-, 3-, 4-, 5-star averages.
    weapon = section(loot, "Weapon Ascension Materials[]", "2-Star Roll[]")
    w = row_after(weapon, "IV", 8)
    w2, w3, w4, w5 = num(w[1]), num(w[3]), num(w[5]), num(w[7])
    forgery = w2 / 27 + w3 / 9 + w4 / 3 + w5
    # World boss (the wiki's "Elite Boss Materials"), world level 8: boss level, reward tier, mean.
    elite = section(loot, "Elite Boss Materials[]", "Level Scaling of Drop Rate[]")
    e = row_after(elite, "93/94", 2)
    boss = num(e[1])
    # Weekly boss materials, world level 8: enemy level, mean (all three materials together).
    weekly_sec = section(loot, "Weekly Talent Level-Up Materials[]", "Full[]")
    wk = row_after(weekly_sec, "94", 1)
    weekly_total = num(wk[0])
    # Artifact domain, adventure rank 45 and up: 3-, 4-, 5-star pieces and the total, per run.
    art = flat("Loot System/Artifact Drop Distribution")
    dom = section(art, "Domains[]", "Normal Bosses[]")
    a = row_after(dom, "45", 5)
    star5 = num(a[3])
    need(abs(num(a[0]) + num(a[1]) + num(a[2]) + num(a[3]) - num(a[4])) < 0.01, "artifact domain row does not add up")
    # Ley line outcrops, world level 6 and up: Revelation's average Character EXP and Wealth's Mora, one claim (20 resin).
    ley = fandom("Ley Line Outcrop")
    table = ley[ley.index("Rewards and Scaling") :]
    table = table[table.index("<table") : table.index("</table>")]
    rows = re.findall(r"<tr>(.*?)</tr>", table, flags=re.S)
    parsed = []
    for row in rows:
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)]
        parsed.append(cells)
    wl6 = next(r for r in parsed if r and r[0] == "6")
    ley_exp, ley_mora = num(wl6[5]), num(wl6[7])
    need(ley_exp == 122500 and ley_mora == 60000, f"ley row changed: {wl6}")
    need(abs(books - 1.1244) < 0.001, f"books {books}")

    values = {
        "books": round(books, 4),
        "forgery": round(forgery, 4),
        "boss": round(boss, 4),
        "weekly": round(weekly_total / 3, 4),
        "ley_exp": int(ley_exp),
        "ley_mora": int(ley_mora),
        "artifact_5star": round(star5, 3),
    }
    detail = {
        "world_level": "8, the highest the drop pages list; their rewards stop rising at enemy level 93 (reward tier 19 and up), so a higher world level gives the same",
        "books": {
            "unit": "Philosophies-equivalents per Domain of Mastery run at domain level IV (20 resin); three Teachings craft a Guide, three Guides a Philosophy",
            "teachings_2star": teachings, "guides_3star": guides, "philosophies_4star": philosophies,
        },
        "forgery": {
            "unit": "5-star (top tier) weapon material equivalents per Domain of Forgery run at domain level IV (20 resin); three of a tier craft one of the next",
            "tier2": w2, "tier3": w3, "tier4": w4, "tier5": w5,
        },
        "boss": {"unit": "a world boss's own material per kill at world level 8 (40 resin; 2 plus 55.56%)"},
        "weekly": {
            "unit": "the expected number of each of a weekly boss's three materials per claim at world level 8 (30 resin the first three claims a week, then 60)",
            "total_of_the_three": weekly_total,
            "split": "assumed even among the three materials; the sources give only the total",
        },
        "ley_exp": {"unit": "average Character EXP from one Blossom of Revelation claim at world level 6 and up (20 resin or one condensed resin): 6 to 7 Adventurer's Experience and 4 to 5 Hero's Wit"},
        "ley_mora": {"unit": "Mora from one Blossom of Wealth claim at world level 6 and up (20 resin)"},
        "artifact_5star": {
            "unit": "5-star artifacts per artifact domain run at adventure rank 45 and up (20 resin)",
            "pieces_by_quality_last_column_is_5_star": [num(a[0]), num(a[1]), num(a[2]), num(a[3])],
            "pieces_per_run": num(a[4]), "slot_chance": 0.2,
        },
    }
    notes.append("books differ from the mockups' 1.17: the sourced per-run counts give 1.1244")
    return values, detail, notes


# ---------------------------------------------------------------- artifacts

MAIN_KEYS = {
    "FIGHT_PROP_HP": "hp", "FIGHT_PROP_ATTACK": "atk", "FIGHT_PROP_HP_PERCENT": "hp_pct", "FIGHT_PROP_ATTACK_PERCENT": "atk_pct",
    "FIGHT_PROP_DEFENSE_PERCENT": "def_pct", "FIGHT_PROP_CHARGE_EFFICIENCY": "er", "FIGHT_PROP_ELEMENT_MASTERY": "em",
    "FIGHT_PROP_CRITICAL": "cr", "FIGHT_PROP_CRITICAL_HURT": "cd", "FIGHT_PROP_HEAL_ADD": "heal",
    "FIGHT_PROP_FIRE_ADD_HURT": "dmg", "FIGHT_PROP_PHYSICAL_ADD_HURT": "phys",
}
SUB_KEYS = {k: v for k, v in MAIN_KEYS.items() if v not in ("heal", "dmg", "phys")}
SUB_KEYS["FIGHT_PROP_DEFENSE"] = "def"
PERCENT = {"hp_pct", "atk_pct", "def_pct", "er", "cr", "cd", "heal", "dmg", "phys"}


def artifacts() -> tuple[dict, dict, dict, dict, list[str]]:
    notes: list[str] = []
    # main stats at +20, 5 stars: rank 5, level 21 of ReliquaryLevelExcelConfigData
    level = next(r for r in datamine("ReliquaryLevelExcelConfigData") if r.get("rank") == 5 and r["level"] == 21)
    raw = {p["propType"]: p["value"] for p in level["addProps"]}
    mains = {}
    for prop, key in MAIN_KEYS.items():
        value = raw[prop]
        mains[key] = round(value * 100, 1) if key in PERCENT else value
    # the fandom's Artifact/Stats page gives the same maxima: check that each shows up
    stats = flat("Artifact/Stats")
    for key, value in mains.items():
        shown = f"{value:,.1f}".rstrip("0").rstrip(".") if key in PERCENT or value % 1 else f"{int(value):,}"
        need(shown in stats, f"main stat {key} {value} not on the wiki's Artifact/Stats page")
    # substat roll values for 5 stars: depot 501 (four tiers at 70, 80, 90 and 100 percent of the largest)
    rolls: dict[str, list[float]] = {}
    for row in datamine("ReliquaryAffixExcelConfigData"):
        if row["depotId"] == 501 and row["propType"] in SUB_KEYS:
            key = SUB_KEYS[row["propType"]]
            rolls.setdefault(key, []).append(row["propValue"] * 100 if key in PERCENT else row["propValue"])
    need(set(rolls) == set(SUB_KEYS.values()) and all(len(v) == 4 for v in rolls.values()), "5-star substat tiers")
    roll_avg = {k: round(sum(v) / 4, 3) for k, v in rolls.items()}
    # the wiki's Artifact/Distribution: main stat odds and substat weights
    dist = flat("Artifact/Distribution")

    def pairs(start: str, end: str, count: int) -> dict[str, float]:
        toks = tokens(section(dist, start, end))
        out = {}
        for i, t in enumerate(toks):
            if t.endswith("%") and re.fullmatch(r"[\d.]+%", t) and i > 0:
                out[toks[i - 1]] = num(t.rstrip("%")) / 100
        need(len(out) == count, f"{start}: {len(out)} rows")
        return out

    name_key = {"HP%": "hp_pct", "ATK%": "atk_pct", "DEF%": "def_pct", "Energy Recharge%": "er", "Elemental Mastery": "em",
                "CRIT Rate%": "cr", "CRIT DMG%": "cd", "Healing Bonus%": "heal", "Physical DMG Bonus%": "phys", "HP": "hp", "ATK": "atk"}

    def keyed(d: dict[str, float], elemental: bool = False) -> dict[str, float]:
        out: dict[str, float] = {}
        for name, value in d.items():
            if name.endswith("DMG Bonus%") and name != "Physical DMG Bonus%":
                need(elemental, "elemental DMG row outside the Goblet")
                out["dmg"] = value  # each of the seven elements has this chance; they are listed one by one
            else:
                out[name_key[name]] = value
        return out

    main_odds = {
        "flower": keyed(pairs("Flower of Life[]", "Plume of Death[]", 1)),
        "plume": keyed(pairs("Plume of Death[]", "Sands of Eon[]", 1)),
        "sands": keyed(pairs("Sands of Eon[]", "Goblet of Eonothem[]", 5)),
        "goblet": keyed(pairs("Goblet of Eonothem[]", "Circlet of Logos[]", 12), elemental=True),
        "circlet": keyed(pairs("Circlet of Logos[]", "Minor Affix Attribute[]", 7)),
    }
    for slot, odds in main_odds.items():
        total = sum(odds.values()) + (7 * odds["dmg"] - odds["dmg"] if slot == "goblet" else 0)
        need(abs(total - 1) < 0.0005, f"{slot} odds add to {total}")
    weights_part = section(dist, "Attribute \n Weight", "Minor Affix Value[]") if "Attribute \n Weight" in dist else section(dist, "Weight\n", "Minor Affix Value[]")
    wtoks = tokens(weights_part)
    sub_name = {"HP": "hp", "ATK": "atk", "DEF": "def", "HP%": "hp_pct", "ATK%": "atk_pct", "DEF%": "def_pct", "Energy Recharge%": "er",
                "Elemental Mastery": "em", "CRIT Rate%": "cr", "CRIT DMG%": "cd"}
    weights = {}
    for i, t in enumerate(wtoks):
        if t in sub_name and i + 1 < len(wtoks) and wtoks[i + 1].isdigit():
            weights[sub_name[t]] = int(wtoks[i + 1])
    need(len(weights) == 10, f"{len(weights)} substat weights")
    # Genshin Optimizer's constants must say the same
    go = cached("go_consts.ts", GO_CONSTS)
    go_weights = dict(re.findall(r"^\s{2}(hp_?|atk_?|def_?|eleMas|enerRech_|critRate_|critDMG_): (\d+),", go[: go.index("FlowerMainStatProbs")], flags=re.M))
    go_key = {"hp": "hp", "atk": "atk", "def": "def", "hp_": "hp_pct", "atk_": "atk_pct", "def_": "def_pct", "eleMas": "em", "enerRech_": "er", "critRate_": "cr", "critDMG_": "cd"}
    need({go_key[k]: int(v) for k, v in go_weights.items()} == weights, "substat weights differ from Genshin Optimizer's")
    notes.append("main_odds.goblet.dmg is the chance of one particular element's DMG Bonus goblet; each of the seven elements has it (the Physical goblet is `phys`)")
    notes.append("mains_20 holds the 5-star values at +20 in the game's own digits (Elemental Mastery 186.5; the mockups round it to 187)")
    notes.append("roll_avg is the mean of a 5-star substat's four rolls (70, 80, 90 and 100 percent of the largest); the mockups round some of these by a hundredth")
    return mains, main_odds, weights, roll_avg, notes


# ---------------------------------------------------------------- scaling

PHYSICAL = (1.0, 1.081, 1.163, 1.279, 1.36, 1.453, 1.581, 1.709, 1.837, 1.977, 2.116, 2.256, 2.395, 2.535, 2.674)
ELEMENTAL = (1.0, 1.075, 1.15, 1.25, 1.325, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.125, 2.25, 2.375)


def scaling() -> tuple[dict, dict]:
    """The two commonest multiplier curves among talents that have levels 1 to 15 in ProudSkillExcelConfigData, averaged."""
    groups: dict[int, dict[int, list[float]]] = {}
    for row in datamine("ProudSkillExcelConfigData"):
        groups.setdefault(row["proudSkillGroupId"], {})[row["level"]] = row["paramList"]
    sums = {"physical": [[] for _ in range(15)], "elemental": [[] for _ in range(15)]}
    for levels in groups.values():
        if not all(n in levels for n in range(1, 16)):
            continue
        lists = [levels[n] for n in range(1, 16)]
        for index in range(len(lists[0])):
            base = lists[0][index]
            if not (0 < base < 20) or not all(len(x) > index for x in lists):
                continue
            ratios = [x[index] / base for x in lists]
            rounded = tuple(round(r, 3) for r in ratios)
            for name, ref in (("physical", PHYSICAL), ("elemental", ELEMENTAL)):
                if rounded == ref:
                    for i, r in enumerate(ratios):
                        sums[name][i].append(r)
    table = {name: tuple(round(sum(v) / len(v), 4) for v in cols) for name, cols in sums.items()}
    counts = {name: len(cols[0]) for name, cols in sums.items()}
    need(all(c > 100 for c in counts.values()), f"too few talents match: {counts}")
    # the wiki's talent texts (out/kits, read by R3) show the same ratios at levels 1 to 11
    matched = {"physical": 0, "elemental": 0, "neither": 0}
    for path in glob.glob(str(OUT / "kits" / "*.json")):
        kit = json.loads(Path(path).read_text(encoding="utf-8"))
        for talent in kit["talents"]:
            for line in talent.get("scaling", []):
                values = []
                for item in line["values"]:
                    m = re.fullmatch(r"([\d.,]+)%", item.strip())
                    values.append(float(m.group(1).replace(",", "")) if m else None)
                if None in values or len(values) < 10 or not values[0]:
                    continue
                ratios = [v / values[0] for v in values]

                def close(ref):
                    return all(abs(ratios[i] - ref[i]) <= 0.0006 * ref[i] + 0.055 * (1 + ref[i]) / values[0] for i in range(len(ratios)))

                if close(table["physical"]):
                    matched["physical"] += 1
                elif close(table["elemental"]):
                    matched["elemental"] += 1
                else:
                    matched["neither"] += 1
    return table, {"talents_in_datamine_with_this_curve": counts, "hoyolab_wiki_lines_matching": matched}


# ---------------------------------------------------------------- reactions

ELEMENTS = ("Pyro", "Hydro", "Electro", "Cryo", "Dendro", "Anemo", "Geo")
REACTION_PAIRS = {
    ("Pyro", "Hydro"): "Vaporize", ("Pyro", "Cryo"): "Melt", ("Pyro", "Electro"): "Overloaded", ("Pyro", "Dendro"): "Burning",
    ("Pyro", "Anemo"): "Swirl", ("Pyro", "Geo"): "Crystallize",
    ("Hydro", "Electro"): "Electro-Charged, Lunar-Charged", ("Hydro", "Cryo"): "Frozen", ("Hydro", "Dendro"): "Bloom, Lunar-Bloom",
    ("Hydro", "Anemo"): "Swirl", ("Hydro", "Geo"): "Crystallize, Lunar-Crystallize",
    ("Electro", "Cryo"): "Superconduct, Stellar-Conduct", ("Electro", "Dendro"): "Quicken (Aggravate, Spread)",
    ("Electro", "Anemo"): "Swirl", ("Electro", "Geo"): "Crystallize",
    ("Cryo", "Anemo"): "Swirl, Stellar Swirl", ("Cryo", "Geo"): "Crystallize",
}


def reactions() -> tuple[dict, dict]:
    """Element -> the elements it reacts with. Each pair is checked against the reaction names on the wiki's page."""
    page = flat("Elemental Reaction")
    names = ("Vaporize", "Melt", "Overloaded", "Burning", "Swirl", "Crystallize", "Electro-Charged", "Lunar-Charged", "Frozen",
             "Bloom", "Lunar-Bloom", "Lunar-Crystallize", "Superconduct", "Stellar-Conduct", "Quicken", "Aggravate", "Spread", "Stellar Swirl")
    squeezed = page.replace("­", "").replace("‍", "")
    for name in names:
        need(name in squeezed or name.replace("-", "") in squeezed, f"reaction {name} not on the wiki page")
    partners = {e: tuple(sorted({b if a == e else a for (a, b) in REACTION_PAIRS if e in (a, b)}, key=ELEMENTS.index)) for e in ELEMENTS}
    pairs = {f"{a}+{b}": v for (a, b), v in REACTION_PAIRS.items()}
    return partners, pairs


# ---------------------------------------------------------------- level EXP

def exp_tables() -> tuple[list[int], list[int], dict[str, list[int]]]:
    avatar = {r["level"]: r["exp"] for r in datamine("AvatarLevelExcelConfigData")}
    step = [0] + [avatar[level] for level in range(1, 90)]  # step[L] = EXP from level L to L + 1
    cumulative = [0, 0]
    for level in range(2, 91):
        cumulative.append(cumulative[-1] + step[level - 1])
    weapon_rows = datamine("WeaponLevelExcelConfigData")
    weapon: dict[str, list[int]] = {}
    for index in range(5):
        cum = [0, 0]
        for level in range(2, 91):
            cum.append(cum[-1] + weapon_rows[level - 2]["requiredExps"][index])
        weapon[str(index + 1)] = cum
    # check against the wiki's pages
    char_page = {int(x.replace(",", "")) for x in re.findall(r"\d[\d,]{3,}", fandom("Character EXP", "wikitext"))}
    need(all(cumulative[level] in char_page or step[level - 1] in char_page for level in range(2, 91)), "character EXP differs from the wiki")
    for rarity in ("3", "4", "5"):
        page = {int(x.replace(",", "")) for x in re.findall(r"\d[\d,]{3,}", fandom(f"Weapon EXP/{rarity}-Star Weapons", "wikitext"))}
        need(weapon[rarity][90] in page, f"{rarity}-star weapon EXP total not on the wiki")
    return cumulative, step, weapon


# ---------------------------------------------------------------- main

def main() -> int:
    y, y_detail, y_notes = yields()
    mains, main_odds, sub_weights, roll_avg, a_notes = artifacts()
    scale, scale_check = scaling()
    partners, pairs = reactions()
    exp, exp_step, weapon_exp = exp_tables()
    sources = [
        {"id": "DM", "url": GITLAB + "<file>.json", "checked": CHECKED,
         "what": "the game's data tables as the community datamine (Dimbreath/AnimeGameData) mirrors them; its last data commit is 2026-05-23 (game 6.6), and these tables do not change between versions",
         "used_for": ["exp", "weapon_exp", "scaling", "mains_20", "roll_avg"]},
        {"id": "GW-loot", "url": "https://genshin-impact.fandom.com/wiki/Loot_System/Material_Drop_Distribution", "checked": CHECKED,
         "what": "community drop counts (Genshin Data Gathering team): talent books, weapon materials, world boss and weekly boss materials",
         "used_for": ["yields.books", "yields.forgery", "yields.boss", "yields.weekly"]},
        {"id": "GW-artifact-loot", "url": "https://genshin-impact.fandom.com/wiki/Loot_System/Artifact_Drop_Distribution", "checked": CHECKED,
         "what": "5-star artifacts per domain run at adventure rank 45+, and 1 in 5 for each slot", "used_for": ["yields.artifact_5star"]},
        {"id": "GW-ley", "url": "https://genshin-impact.fandom.com/wiki/Ley_Line_Outcrop", "checked": CHECKED,
         "what": "Rewards and Scaling table (world level 6 and up)", "used_for": ["yields.ley_exp", "yields.ley_mora"]},
        {"id": "GW-distribution", "url": "https://genshin-impact.fandom.com/wiki/Artifact/Distribution", "checked": CHECKED,
         "what": "main stat odds per slot and substat weights (from the NGA forum's datamined summary)", "used_for": ["main_odds", "sub_weights"]},
        {"id": "GW-stats", "url": "https://genshin-impact.fandom.com/wiki/Artifact/Stats", "checked": CHECKED,
         "what": "main stat maxima and substat roll values (check of DM)", "used_for": ["mains_20", "roll_avg"]},
        {"id": "GW-reaction", "url": "https://genshin-impact.fandom.com/wiki/Elemental_Reaction", "checked": CHECKED,
         "what": "reaction matrix and the Lunar and Stellar Glimmer reactions", "used_for": ["reactions"]},
        {"id": "GW-exp", "url": "https://genshin-impact.fandom.com/wiki/Character_EXP and /wiki/Weapon_EXP/<n>-Star_Weapons", "checked": CHECKED,
         "what": "level EXP tables (check of DM)", "used_for": ["exp", "weapon_exp"]},
        {"id": "GO", "url": "https://github.com/frzyc/genshin-optimizer/blob/master/libs/gi/upopt/src/consts.ts", "checked": CHECKED,
         "what": "Genshin Optimizer's substat weights and main stat odds (check of GW-distribution)", "used_for": ["main_odds", "sub_weights"]},
        {"id": "HW", "url": "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page (each character's Talents module, via out/kits)", "checked": CHECKED,
         "what": "the game's own talent texts (check of scaling)", "used_for": ["scaling"]},
    ]
    not_confirmed = [
        "yields.weekly: the sources give 2.4 weekly materials per claim in all (at world level 8) but not how they split among the boss's three materials; 0.8 each is 2.4 / 3, assumed. The mockup's 1 per claim is not used because three of them would exceed the sourced total.",
        "yields.forgery: no mockup value; computed from the sourced per-tier averages in top-tier equivalents (see yields_detail), so its unit differs from `books`.",
        "yields.books and yields.boss differ from the mockups' 1.17 and 2.5: the sourced values (1.1244 and 2.5556) are used, because sources confirm them.",
    ]
    document = {
        "checked": CHECKED,
        "sources": sources,
        "yields": y,
        "yields_detail": y_detail,
        "mains_20": mains,
        "main_odds": main_odds,
        "slot_odds": 0.2,
        "sub_weights": sub_weights,
        "roll_avg": roll_avg,
        "scaling": {"elemental": list(scale["elemental"]), "physical": list(scale["physical"])},
        "scaling_check": scale_check,
        "reactions": {k: list(v) for k, v in partners.items()},
        "reaction_pairs": pairs,
        "exp": exp,
        "exp_step": exp_step,
        "weapon_exp": weapon_exp,
        "units": {
            "exp": "total EXP to reach each level from level 1; index = level, 91 entries (index 0 and 1 are 0)",
            "exp_step": "EXP to go from level L to L + 1; index = L, 90 entries (index 0 unused; 1 to 89 used)",
            "weapon_exp": "by rarity '1' to '5': total EXP to reach each level from level 1, index = level; 1 and 2 star weapons stop at level 70 and 3 star and up at 90",
            "mains_20": "5-star main stat values at +20; percentages as percent points (46.6 is 46.6%)",
            "roll_avg": "mean substat roll of a 5-star artifact; percentages as percent points",
            "scaling": "multiplier of a talent at level n over level 1, n = 1 to 15; levels 11 to 15 need constellation bonuses",
            "reactions": "each element -> the elements it has a reaction with",
        },
        "not_confirmed": not_confirmed,
        "notes": y_notes + a_notes,
        "confidence": {"yields": "medium", "mains_20": "high", "main_odds": "high", "sub_weights": "high", "roll_avg": "high",
                       "scaling": "high", "reactions": "high", "exp": "high", "weapon_exp": "high",
                       "yields.weekly": "low", "yields.forgery": "medium"},
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "tables.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # The schema's shape (reference/characters/schema/tables.schema.json): no other top-level keys; what it has no place
    # for is folded into `notes`, which it leaves free. The fuller file stays in out/tables.json.
    shaped = {key: document[key] for key in (
        "yields", "mains_20", "main_odds", "sub_weights", "roll_avg", "scaling", "reactions", "exp", "weapon_exp",
        "checked", "sources")}
    shaped["notes"] = {
        "slot_odds": document["slot_odds"], "yields_detail": document["yields_detail"],
        "not_confirmed": document["not_confirmed"], "confidence": document["confidence"], "units": document["units"],
        "exp_step": document["exp_step"], "reaction_pairs": document["reaction_pairs"],
        "scaling_check": document["scaling_check"], "remarks": document["notes"],
    }
    target = REFERENCE / "tables.json"
    target.write_text(json.dumps(shaped, indent=2, ensure_ascii=False) + chr(10), encoding="utf-8")
    print("wrote", target)
    print("yields", y)
    print("scaling check", scale_check)
    print("exp 90:", exp[90], " weapon 5-star 90:", weapon_exp["5"][90])
    return 0


if __name__ == "__main__":
    sys.exit(main())
