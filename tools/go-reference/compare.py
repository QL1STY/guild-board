"""The damage engine against Genshin Optimizer's Waverider, for every character with a kit (the Plan design, 14.6; a developer
tool: nothing here ships and the app never runs it).

Three steps, all through run.py:

    uv run python tools/go-reference/run.py compare          cases.json, GO's run, the fixture, our engine's run, the summary
    uv run python tools/go-reference/run.py compare --from DIR    the same from an earlier GO run's JSON in DIR (no GO run)

1. `cases()` writes tools/go-reference/cases.json: every character whose kit has counted rows, with a standard build of her
   weapon type (a 5-star weapon at 90 R1, five 5-star +20 pieces of one set, the same substats for everyone) and two swaps,
   the sands (her scaling stat's % to Elemental Mastery) and the goblet (her element's DMG Bonus to her scaling stat's %),
   plus a few cases with a reaction on. Level 90, talents 10/10/10, constellation 0. GO's states (conditionals) are set to
   the kit's toggles that are on and the modes her decision file fixes; the Polestar field at 12 recorded hits when she counts a
   Stellar-Conduct row. The rows' text is GO's English text at level 10 (talent_rows.py), what HoYoLAB prints.
2. specs/gb-compare.spec.ts evaluates both builds of each case in GO (gb-compare.json): every talent hit's average damage
   and her base values.
3. `fixture()` writes web/src/fixtures/compare-cases.json: for each case our engine's inputs (the planner's hits block as the
   core builds it, her base values, HoYoLAB's panel for both builds) and GO's answer (each main talent's change, the sum of
   GO's hits that print each counted row). web/src/pages/characters/compare.test.ts runs our engine on it; with
   GB_COMPARE_OUT set it writes our answers, which `pin()` keeps in the fixture as the pinned ones.

HoYoLAB's panel of a build is made as HoYoLAB makes it: her base values (GO's, at level 90 with the weapon's base ATK), her
ascension stat, her innate stats, the weapon's substat, the pieces' main and substats, and what kits.json marks `in_stats`
for her weapon and set (always-on plain stats). Passive and constellation effects are left to the engine, as in the app."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(HERE))

import kitgen  # noqa: E402
import talent_rows  # noqa: E402
from guildboard.characters import constants, kits, reference, simhits  # noqa: E402
from guildboard.characters.hits import is_damage, kind_by_name, normalise  # noqa: E402
from guildboard.views.characters import set_two  # noqa: E402

CASES = HERE / "cases.json"
DECIDED = HERE / "decided"
FIXTURE = ROOT / "web" / "src" / "fixtures" / "compare-cases.json"
TOLERANCE = 0.05

TALENTS = ("normal", "skill", "burst")
GROUPS_OF = {"normal": ("normal", "charged", "plunging"), "skill": ("skill",), "burst": ("burst",)}
PARAMS_OF = {"normal": "auto", "skill": "skill", "burst": "burst"}
NAMES = {"normal": "Normal Attack", "skill": "Elemental Skill", "burst": "Elemental Burst"}
LEVEL, TALENT_LEVEL = 90, 10
# One 5-star weapon of each type, at 90 R1: plain always-on passives, so that her own kit decides the result.
WEAPONS = {
    "sword": "aquila-favonia", "claymore": "wolf-s-gravestone", "polearm": "staff-of-homa",
    "catalyst": "lost-prayer-to-the-sacred-winds", "bow": "skyward-harp",
}
SET = "gladiator-s-finale"
# GO's keys and units (a fraction for a percentage); the 5-star +20 main stats and the substats of go-engine.md 1's builds.
MAIN = {
    "hp_": 0.466, "atk_": 0.466, "def_": 0.583, "eleMas": 186.5, "enerRech_": 0.518, "critRate_": 0.311, "critDMG_": 0.622,
    "physical_dmg_": 0.583, **{f"{e}_dmg_": 0.466 for e in kitgen.ELEMENTS},
}
SUBS = {"critRate_": 0.30, "critDMG_": 0.60, "atk_": 0.10, "hp_": 0.10, "def_": 0.10, "eleMas": 40, "enerRech_": 0.10}
PERCENT_OF = {"atk": "atk_", "hp": "hp_", "def": "def_", "em": "eleMas"}
# A few cases with a reaction on (the sands swap, where Elemental Mastery moves): one per path of the engine, and Varesa's, where a flat
# bonus that scales with ATK (her plunge impact's) weighs against Aggravate's, which no other swap shows.
REACTION_CASES = (("hu-tao", "vaporize"), ("kamisato-ayaka", "melt"), ("ganyu", "melt"), ("raiden-shogun", "aggravate"),
                  ("nahida", "spread"), ("alhaitham", "spread"), ("varesa", "aggravate"))
# Cases where the set of the build is another one, which raises the Charged Attacks or the Plunging Attacks that some
# Skill rows are (Tartaglia's melee Charged Attack, Xianyun's Driftcloud Wave, Gaming's Charmed Cloudstrider), on the goblet swap.
SET_CASES = (("tartaglia", "wanderer-s-troupe"), ("xianyun", "long-night-s-oath"), ("gaming", "long-night-s-oath"))
SETS = (SET, *dict.fromkeys(s for _, s in SET_CASES))
# A weapon or a 4-piece set swapped for another with the rest of the build as it was: what the planner does when the player tests a weapon or a
# set. (her key, "weapon" | "set", the weapon or set she has, the one tested). The set swaps are from the standard set (five pieces of it, and of
# the other) on three characters whose answers each read a different part of a set's 4-piece bonus: Hu Tao (Crimson Witch's Pyro DMG stack
# behind a toggle, its Vaporize and Melt bonus, and the 2-piece Pyro DMG on the panel), Raiden Shogun (Emblem of Severed Fate's Burst DMG, a
# conversion of her Energy Recharge, which her own Energy Recharge conversion feeds) and Ganyu (Wanderer's Troupe's Charged Attack bonus, which
# only a bow or catalyst wielder gets, and the 2-piece Elemental Mastery that her panel then holds). The weapon swaps are a 5-star polearm to a
# 4-star with other effects (Hu Tao's Staff of Homa to Deathmatch) and the signature to a 4-star that gives Burst DMG and CRIT Rate (Raiden's
# Engulfing Lightning to The Catch). Each is made with the gear's states where the planner starts (the toggles a decision file turns on, and
# no other) and on (`:on`, every toggle of the four items at the state kits.json reads it at, in GO and in ours; Ganyu's four items have none,
# so hers is made once).
# Then a swap to each weapon or set whose decision file turns a toggle on (decided/weapons, decided/sets), from her weapon type's standard
# weapon (or one with no toggle, where the standard gives the same numbers) or the standard set, on a character who wields it and whose
# counted rows the toggle reaches: its first case is the planner's start with the toggle on, which GO also runs with the item's decided toggles
# off (`conds_off`), so that the test holds each toggle to a swap whose answer it moves; its `:on` case, made where the four items have a
# toggle the start leaves off, checks those too. Footprint of the Rainbow has none: no polearm character's counted rows scale on DEF, so its
# reason says no swap can show it.
DECIDED_GEAR_CASES = (
    ("ganyu", "weapon", "skyward-harp", "aqua-simulacra"),
    ("wanderer", "weapon", "lost-prayer-to-the-sacred-winds", "ballad-of-the-boundless-blue"),
    ("xiao", "weapon", "staff-of-homa", "calamity-queller"),
    ("albedo", "weapon", "aquila-favonia", "cinnabar-spindle"),
    ("tartaglia", "weapon", "skyward-harp", "compound-bow"),
    ("nahida", "weapon", "lost-prayer-to-the-sacred-winds", "etherlight-spindlelute"),
    ("keqing", "weapon", "aquila-favonia", "finale-of-the-deep"),
    ("klee", "weapon", "lost-prayer-to-the-sacred-winds", "flowing-purity"),
    ("xilonen", "weapon", "aquila-favonia", "flute-of-ezpitzal"),
    ("raiden-shogun", "weapon", "staff-of-homa", "fractured-halo"),
    ("diluc", "weapon", "wolf-s-gravestone", "gest-of-the-mighty-wolf"),
    ("kamisato-ayaka", "weapon", "aquila-favonia", "iron-sting"),
    ("keqing", "weapon", "aquila-favonia", "kagotsurube-isshin"),
    ("ningguang", "weapon", "lost-prayer-to-the-sacred-winds", "memory-of-dust"),
    ("xilonen", "weapon", "aquila-favonia", "peak-patrol-song"),
    ("xiao", "weapon", "staff-of-homa", "primordial-jade-winged-spear"),
    ("kamisato-ayaka", "weapon", "aquila-favonia", "prototype-rancour"),
    ("ganyu", "weapon", "skyward-harp", "scion-of-the-blazing-sun"),
    ("diluc", "weapon", "wolf-s-gravestone", "skyrider-greatsword"),
    ("keqing", "weapon", "aquila-favonia", "summit-shaper"),
    # Nefer: her Burst hits (Nahida's deals no damage, so it never starts this) and her rows scale on Elemental Mastery, so it shows
    ("nefer", "weapon", "lost-prayer-to-the-sacred-winds", "sunny-morning-sleep-in"),
    # from Skyward Pride: Wolf's Gravestone has The Unforged's base ATK, substat and 20% ATK at five stacks, so a swap from it moves nothing
    ("eula", "weapon", "skyward-pride", "the-unforged"),
    ("yoimiya", "weapon", "skyward-harp", "thundering-pulse"),
    ("xianyun", "weapon", "lost-prayer-to-the-sacred-winds", "vivid-notions"),
    ("xiangling", "weapon", "staff-of-homa", "vortex-vanquisher"),
    ("noelle", "weapon", "wolf-s-gravestone", "whiteblind"),
    ("diluc", "set", SET, "a-day-carved-from-rising-winds"),
    ("tartaglia", "set", SET, "heart-of-depth"),
    ("arataki-itto", "set", SET, "husk-of-opulent-dreams"),
)
GEAR_CASES = (
    ("hu-tao", "weapon", "staff-of-homa", "deathmatch"),
    ("raiden-shogun", "weapon", "engulfing-lightning", "the-catch"),
    ("hu-tao", "set", SET, "crimson-witch-of-flames"),
    ("raiden-shogun", "set", SET, "emblem-of-severed-fate"),
    ("ganyu", "set", SET, "wanderer-s-troupe"),
    # an undecided weapon whose toggle has several states (Kagura's Verity: 1 to 3 stacks, read at 3 and never added together): Nahida's
    # Skill rows and her Elemental DMG take it, and its `:on` case is the one that compares it, in GO at the state kits.json reads
    ("nahida", "weapon", "lost-prayer-to-the-sacred-winds", "kagura-s-verity"),
    *DECIDED_GEAR_CASES,
)
# the simulator's key of a stat of a piece (GO's key as the comparison writes it); a percentage is in points there, not a fraction
SIM_STAT = {"hp_": "hp_pct", "atk_": "atk_pct", "def_": "def_pct", "eleMas": "em", "enerRech_": "er", "critRate_": "cr", "critDMG_": "cd",
            "physical_dmg_": "physical", "hp": "hp", "atk": "atk", "def": "def"}
SLOTS = ("flower", "plume", "sands", "goblet", "circlet")
# GO's states that make GO show the hit our row is: Lauma's "2-Hit Hold DMG" is per Verdant Dew, and GO shows it only at a count.
COMPARE_STATES = {"lauma": {"Lauma": {"skillVerdantDew": "1"}}}
# kits.json's bucket of an `in_stats` effect, as GO's key
GO_KEY_OF = {
    "atk%": "atk_", "hp%": "hp_", "def%": "def_", "atk": "atk", "hp": "hp", "def": "def", "em": "eleMas", "er": "enerRech_",
    "cr": "critRate_", "cd": "critDMG_", "heal": "heal_", "physical": "physical_dmg_",
    **{f"dmg:{e}": f"{e}_dmg_" for e in kitgen.ELEMENTS},
}


# ------------------------------------------------------------------------------------------------ her hits block

def _sheet_key(go_key: str) -> str:
    """GO keeps a Traveler's talent text and numbers under her F form."""
    folder = talent_rows.GO / "libs" / "gi" / "stats" / "Data" / "Characters"
    return go_key if (folder / go_key).is_dir() else f"{go_key}F"


def affixes_of(go_key: str, levels: dict[str, int] | None = None) -> dict[str, list[list[str]]]:
    """Her talents' rows that are hits, as the game prints them (name and value) at `levels` (10 each by default)."""
    key = _sheet_key(go_key)
    levels = levels or dict.fromkeys(TALENTS, TALENT_LEVEL)
    return {t: [list(row) for row in talent_rows.rows(key, t, levels[t], aligned=True) if is_damage(row[0])] for t in TALENTS}


def gear(kind: str, weapons: tuple[str, ...] | None = None, sets: tuple[str, ...] = SETS) -> dict:
    """The weapon's and the sets' effects as the planner ships them for a character of this weapon type (the standard weapon and sets, or the
    ones named)."""
    return {"weapon_effects": {key: kits.gear_of("weapons", key, 0, 6, kind) for key in (weapons or (WEAPONS[kind],))},
            "set_effects": {key: kits.gear_of("sets", key, 0, 6, kind) for key in sets}}


def block(key: str, affixes: dict[str, list[list[str]]], levels: dict[str, int] | None = None, constellation: int = 0) -> dict:
    """The planner's hits block for her standard build, as the core builds it (tools/make-damage-fixtures.py does the same).
    `levels`: her talents' levels with what her passives add, which HoYoLAB's rows are at (Tartaglia's Normal Attack is 11).
    `constellation`: the one her kit is read at (the comparison's is 0; the decision sheets read all six, to show every toggle)."""
    character = kits.load_kits()["characters"][key]
    kind = character["weapon_type"]
    kit = kits.kit_of(key, constellation, 6, "", 1, {})
    raised = dict.fromkeys(TALENTS, TALENT_LEVEL)
    levels = levels or raised
    out = simhits.hits_block(
        element=character["element"].capitalize(), weapon_type=kind.capitalize(), level=LEVEL, levels=levels, raised=raised,
        affixes={t: [tuple(row) for row in affixes[t]] for t in TALENTS}, tables={}, names={t: (NAMES[t], None) for t in TALENTS},
        kit=kit, recommended=[], **gear(kind),
    )
    return out


def constellations_of(key: str) -> list[int]:
    """The constellations her extra cases are at, each once and in order, or none for a character with none: every one that the effects of the
    states decided on start at (a toggle that is on, with effects from a constellation), the rows only a constellation deals (`row_gates`)
    start at, an infusion of a state that is on (or of no state) behind a constellation starts at, or an effect no state gates (the runtime
    applies it at the player's constellation) starts at, from 1 to 6. Each one has cases of its own: her kit at the highest holds everything
    it gives from the lower ones on both sides of the comparison, so a gate read at the wrong start (Constellation 4 for 2) would agree at 0
    and at 6 and be caught at neither."""
    character = kits.load_kits()["characters"][key]
    on = {t["name"] for t in character["toggles"] if t["on"]}
    need = [e["from_constellation"] for e in character["effects"]
            if e.get("while") in on and all(name in on for name in e.get("also") or ()) and e.get("from_constellation")]
    need += [e["from_constellation"] for e in character["effects"] if not e.get("while") and e.get("from_constellation")]
    need += [gate["from"] for rows in (character.get("row_gates") or {}).values() for gate in rows.values() if gate.get("from")]
    # an infusion behind a constellation (Dori's C6) is the same as an effect: a state decided on needs it, an ungated one from where it starts
    need += [i["from_constellation"] for i in character.get("infused") or []
             if i.get("from_constellation") and (i["while"] in on if i.get("while") else True)]
    return sorted(set(need))


def reaches_crit(hits: dict) -> bool:
    """Whether an effect her constellations give, that holds in this block (no state, or one that is on), adds CRIT Rate or CRIT DMG: a
    bonus on every counted row cancels in the sands and goblet swaps' ratios, so those cases also swap the circlet's CRIT DMG to CRIT Rate."""
    on = {t["name"] for t in hits["toggles"] if t["on"]}
    return any(e.get("from_constellation") and (not e.get("while") or (e["while"] in on and all(n in on for n in e.get("also") or ())))
               and (e["to"] in ("cr", "cd") or e["to"].split(":")[0] in ("cr", "cd")) for e in hits["effects"])


def kit_key(key: str, constellation: int = 0) -> str:
    """The name of her hits block at a constellation in the fixture: hers alone at 0, `key@c6` at Constellation 6."""
    return key if not constellation else f"{key}@c{constellation}"


def dealt(hits: dict, row: dict) -> bool:
    """Whether her usual team (`party.default`) deals the row: a row only some teams deal is left out of the comparison's sums when
    the usual team is not one of them."""
    party = hits.get("party")
    return not party or row.get("only") is None or party["default"] in row["only"]


def counted(hits: dict) -> list[tuple[dict, dict]]:
    """(talent, row) for every row the verdict counts: the rows of her main talents that the kit counts, in her usual team."""
    return [(t, r) for t in hits["talents"] if t["main"] for r in t["rows"] if r["main"] and dealt(hits, r)]


def scaling(hits: dict) -> str:
    """The stat her counted rows scale on most (by summed multiplier): atk, hp, def or em."""
    total: dict[str, float] = defaultdict(float)
    for _, row in counted(hits):
        for term in row["terms"]:
            total[term["stat"]] += term["mult"] * row["count"]
    return max(total, key=total.get) if total else "atk"


def goblet_of(hits: dict) -> str:
    """Her element's DMG Bonus goblet."""
    return f"{hits['element'].lower()}_dmg_"


# ------------------------------------------------------------------------------------------------ the cases

def _pieces(set_go: str, sands: str, goblet: str, circlet: str) -> list[dict]:
    flower = [{"key": "hp", "value": 4780}, *({"key": k, "value": v} for k, v in SUBS.items())]
    return [
        {"set": set_go, "stats": flower},
        {"set": set_go, "stats": [{"key": "atk", "value": 311}]},
        {"set": set_go, "stats": [{"key": sands, "value": MAIN[sands]}]},
        {"set": set_go, "stats": [{"key": goblet, "value": MAIN[goblet]}]},
        {"set": set_go, "stats": [{"key": circlet, "value": MAIN[circlet]}]},
    ]


def usual_team(decided: dict, key: str) -> tuple[dict | None, dict | None]:
    """Her `party` in her decision file and its usual option (None, None for a character whose damage no team decides)."""
    party = (decided.get("characters", {}).get(key) or {}).get("party")
    if not party:
        return None, None
    return party, next(o for o in party["options"] if o["id"] == party["default"])


def _conds(key: str, character: dict, hits: dict, decided: dict) -> dict[str, dict[str, str]]:
    """GO's states for her: the kit's toggles that are on, the modes a person fixed, the states of her usual team, the Polestar field."""
    go_key = character["go_key"]
    out: dict[str, dict[str, str]] = defaultdict(dict)

    def put(name: str, state: str) -> None:
        sheet, _, short = name.rpartition(".")
        out[sheet or go_key][short] = str(state)

    for toggle in hits["toggles"]:
        if toggle["on"]:
            put(toggle["name"], toggle["state"])
    for name, mode in ((decided.get("characters", {}).get(key) or {}).get("modes") or {}).items():
        put(name, mode["state"])
    for name, state in ((usual_team(decided, key)[1] or {}).get("states") or {}).items():
        put(name, state)
    if any(row["kind"] == "stellar-conduct" for _, row in counted(hits)):
        # the engine's Polestar field: 12 recorded hits, and inside it the enemy's Physical RES 40% lower
        out["reaction"]["polestarStacks"] = "12"
        out["reaction"]["oppInsidePole"] = "on"
    for sheet, states in COMPARE_STATES.get(key, {}).items():
        out[sheet].update(states)
    return dict(out)


def gear_cases(what: str, item_a: str, item_b: str, common: dict, mains: dict, data: dict) -> list[dict]:
    """The cases (gear states where the planner starts, and all on when the four items have a toggle) of one weapon or set swap: the build of
    `common` (hers at Constellation 0) with the weapon or the set `item_a` in the first and `item_b` in the second, nothing else changed. The
    states are GO's, one set for both builds: hers as in `common`, and the toggles of the weapons and sets of the two builds at the state
    kits.json reads each at: those a decision file turns on (`gear_start`, the planner's start; ours has them on by their own `on`) in the
    first case, and every one in the case `:on`, which is made only when it turns on a toggle the first does not.

    When the tested item has toggles a decision file turns on (`gear_off`), the first case also has `conds_off`: its states without them,
    which GO alone evaluates (`a_off`, `b_off`), so that its answer with them off (`go_off` in the fixture) shows whether the swap can tell
    the toggle on from off at all."""
    weapon_a, weapon_b = (item_a, item_b) if what == "weapon" else (common["weapon"], common["weapon"])
    set_a, set_b = (item_a, item_b) if what == "set" else (common["set"], common["set"])
    if what == "set" and item_a != common["set"]:
        raise SystemExit(f"{common['character']}: a set swap starts from the standard set {common['set']}, not {item_a}")
    items = [data["weapons"][weapon_a], data["weapons"][weapon_b], data["sets"][set_a], data["sets"][set_b]]
    toggles = {t["name"]: (item["go_key"], t["state"]) for item in items for t in item["toggles"]}
    start = sorted({t["name"] for item in items for t in item["toggles"] if t["on"]})
    tested = data["weapons"][item_b] if what == "weapon" else data["sets"][item_b]
    off = sorted(t["name"] for t in tested["toggles"] if t["on"])
    weapon_go = {w: data["weapons"][w]["go_key"] for w in (weapon_a, weapon_b)}
    set_go = {s: data["sets"][s]["go_key"] for s in (set_a, set_b)}

    def states(names) -> dict[str, dict[str, str]]:
        conds = {sheet: dict(states) for sheet, states in common["conds"].items()}
        for name in names:
            sheet, state = toggles[name]
            conds.setdefault(sheet, {})[name.split(":", 1)[1]] = state
        return conds

    out = []
    # `:on` only when it turns on something the planner's start does not (with no toggle in the four items, nothing can be on)
    for on in (False, True) if set(toggles) - set(start) else (False,):
        out.append({
            "id": f"{common['character']}:{what}:{item_b}" + (":on" if on else ""),
            **common, "conds": states(sorted(toggles) if on else start), "swap": what, "reaction": None, "mains_a": mains, "mains_b": mains,
            "weapon": weapon_a, "weapon_go": weapon_go[weapon_a], "weapon_b": weapon_b, "weapon_b_go": weapon_go[weapon_b],
            "set": set_a, "set_go": set_go[set_a], "set_b": set_b, "set_b_go": set_go[set_b],
            "gear_on": on, "gear_toggles": sorted(toggles) if on else [], "gear_start": start,
            **({"gear_off": off, "conds_off": states([n for n in start if n not in off])} if off and not on else {}),
            "a": {"pieces": _pieces(set_go[set_a], **mains), "weapon_go": weapon_go[weapon_a]},
            "b": {"pieces": _pieces(set_go[set_b], **mains), "weapon_go": weapon_go[weapon_b]},
        })
    return out


def cases(only: list[str] | None = None) -> dict:
    """cases.json: every character with counted rows, two swaps each, and the reaction cases. `only`: just those characters'
    (`run.py compare --only`; a key the kit data does not have stops the run)."""
    data = kits.load_kits()
    decided = kitgen.load_decided(DECIDED)
    unknown = sorted(set(only or []) - set(data["characters"]))
    if unknown:
        raise SystemExit(f"not characters of kits.json: {', '.join(unknown)}")
    out, affixes, skipped, gear_out = [], {}, {}, []
    for key, character in sorted(data["characters"].items()):
        if only is not None and key not in only:
            continue
        if not any(character["hits"].values()):
            skipped[key] = "no talent row of hers is a hit"
            continue
        rows = affixes_of(character["go_key"])
        hits = block(key, rows)
        if not counted(hits):
            skipped[key] = "no counted rows"
            continue
        affixes[key] = rows
        kind = character["weapon_type"]
        weapon_key = WEAPONS[kind]
        set_go = data["sets"][SET]["go_key"]
        # her usual team: GO gets the same members (the elements they add to the party's tally, how many are Moonsign)
        _, team = usual_team(decided, key)
        reactions = [r for k, r in REACTION_CASES if k == key]

        def common_of(at: dict, constellation: int, crit: bool = False) -> tuple[dict, dict, dict]:
            """The build's common fields at a constellation (`at`: her hits block there) and the two swaps."""
            stat = scaling(at)
            main_pct = PERCENT_OF[stat]
            a = {"sands": main_pct, "goblet": goblet_of(at), "circlet": "critDMG_"}
            swaps = {
                "sands": {**a, "sands": "atk_" if stat == "em" else "eleMas"},
                "goblet": {**a, "goblet": main_pct},
                **({"circlet": {**a, "circlet": "critRate_"}} if crit else {}),
            }
            common = {
                "character": key, "kit": kit_key(key, constellation), "go_key": character["go_key"], "element": character["element"],
                "weapon_type": kind, "weapon": weapon_key, "weapon_go": data["weapons"][weapon_key]["go_key"], "set": SET,
                "set_go": set_go, "scaling": stat, "constellation": constellation,
                "talents": {"auto": TALENT_LEVEL, "skill": TALENT_LEVEL, "burst": TALENT_LEVEL},
                "conds": _conds(key, character, at, decided),
            }
            if team is not None:
                common.update({"team": list(team.get("team") or []), "moonsign": int(team.get("moonsign", 0)), "party": team["id"]})
            # the engine's Polestar field is up only in a talent that counts Stellar-Conduct rows; GO's is up for every hit, so
            # her other talents are read from a second run without it
            if "polestarStacks" in common["conds"].get("reaction", {}) and any(
                    t["main"] and not any(r["main"] and r["kind"] == "stellar-conduct" for r in t["rows"]) for t in at["talents"]):
                plain = {sheet: dict(states) for sheet, states in common["conds"].items()}
                for name in ("polestarStacks", "oppInsidePole"):
                    plain["reaction"].pop(name)
                common["conds_plain"] = {sheet: states for sheet, states in plain.items() if states}
            return common, a, swaps

        # a character with a CRIT bonus from a constellation also has the circlet swap, at 0 and at each constellation that gives it
        at_of = {c: block(key, rows, None, c) for c in constellations_of(key)}
        crit_at = {c: counted(b) != [] and reaches_crit(b) for c, b in at_of.items()}
        common, a, swaps = common_of(hits, 0, any(crit_at.values()))
        for swap, b in swaps.items():
            for reaction in [None, *(reactions if swap == "sands" else [])]:
                out.append({
                    "id": f"{key}:{swap}" + (f":{reaction}" if reaction else ""),
                    **common, "swap": swap, "reaction": reaction, "mains_a": a, "mains_b": b,
                    "a": {"pieces": _pieces(set_go, **a)}, "b": {"pieces": _pieces(set_go, **b)},
                })
        # the same swaps at each constellation her decided states, rows and constellation effects start at, beside the ones at Constellation 0
        for high, at in at_of.items():
            if counted(at):
                common_c, a_c, swaps_c = common_of(at, high, crit_at[high])
                for swap, b in swaps_c.items():
                    out.append({
                        "id": f"{key}:{swap}@c{high}", **common_c, "swap": swap, "reaction": None, "mains_a": a_c, "mains_b": b,
                        "a": {"pieces": _pieces(set_go, **a_c)}, "b": {"pieces": _pieces(set_go, **b)},
                    })
        for set_key in (s for k, s in SET_CASES if k == key):
            other = data["sets"][set_key]["go_key"]
            out.append({
                "id": f"{key}:goblet:{set_key}", **common, "set": set_key, "set_go": other, "swap": "goblet", "reaction": None,
                "mains_a": a, "mains_b": swaps["goblet"],
                "a": {"pieces": _pieces(other, **a)}, "b": {"pieces": _pieces(other, **swaps["goblet"])},
            })
        for gear_key, what, item_a, item_b in GEAR_CASES:
            if gear_key == key:
                gear_out.extend(gear_cases(what, item_a, item_b, common, a, data))
    return {
        "about": "Generated by tools/go-reference/run.py compare (compare.py). Every character with counted rows in kits.json, "
                 "a standard build of her weapon type and two swaps; GO's keys and units (a fraction for a percentage).",
        "go_commit": data["go_commit"], "level": LEVEL, "weapons": WEAPONS, "set": SET, "substats": SUBS,
        "skipped": skipped, "affixes": affixes, "cases": out, "gear_cases": gear_out,
    }


# ------------------------------------------------------------------------------------------------ HoYoLAB's panel

def panel(go: dict, pieces: list[dict], hits: dict, weapon_key: str, set_key: str) -> dict[str, float]:
    """HoYoLAB's panel for one build from GO's base values (see the module's note), in the planner's units."""
    add: dict[str, float] = defaultdict(float)
    if go["special"]:
        add[go["special"]["key"]] += go["special"]["value"]
    for stat, value in (go["innate"] or {}).items():
        # GO sums an innate stat into her base values, or into her ascension stat when it is the same one (Lauma's EM)
        if stat not in ("hp", "atk", "def") and stat != (go["special"] or {}).get("key"):
            add[stat] += value
    if go["weapon"]["sub_key"]:
        add[go["weapon"]["sub_key"]] += go["weapon"]["sub"]
    for piece in pieces:
        for stat in piece["stats"]:
            add[stat["key"]] += stat["value"]
    gear = [*(hits["weapon_effects"].get(weapon_key) or {}).get("effects", []),
            *(e for e in hits["set_effects"][set_key]["effects"] if (e.get("pieces") or 2) <= len(pieces))]
    for effect in gear:
        if effect["in_stats"]:
            rate = effect["rate"][0] if isinstance(effect["rate"], list) else effect["rate"]
            if effect["to"] not in GO_KEY_OF:
                raise SystemExit(f"an in_stats effect on {effect['to']} has no place on the panel")
            add[GO_KEY_OF[effect["to"]]] += rate
    for effect in hits["effects"]:
        # her own ascension passives' plain stats (Xingqiu's A4, +20% Hydro DMG): in HoYoLAB's panel (audit, "the panel question");
        # her innate stats are GO's own base values and are added above. Every case is at level 90, after her last ascension.
        if effect["in_stats"] and effect.get("from_ascension") is not None:
            if effect["to"] not in GO_KEY_OF:
                raise SystemExit(f"an in_stats effect on {effect['to']} has no place on the panel")
            add[GO_KEY_OF[effect["to"]]] += effect["rate"][0] if isinstance(effect["rate"], list) else effect["rate"]
    base = go["base"]
    element = hits["element"].lower()
    return {
        "hp": base["hp"] * (1 + add["hp_"]) + add["hp"],
        "atk": base["atk"] * (1 + add["atk_"]) + add["atk"],
        "def": base["def"] * (1 + add["def_"]) + add["def"],
        "em": add["eleMas"],
        "er": (1 + add["enerRech_"]) * 100,
        "cr": (0.05 + add["critRate_"]) * 100,
        "cd": (0.5 + add["critDMG_"]) * 100,
        "dmg": add[f"{element}_dmg_"] * 100,
        "heal": add["heal_"] * 100,
        "physical": add["physical_dmg_"] * 100,
    }


# ------------------------------------------------------------------------------------------------ GO's hits on our rows

def go_rows(key: str, hits: dict, match: dict, kit: dict, usual: dict | None = None,
            derived: list[dict] | None = None) -> dict[tuple[str, str], list[str]]:
    """GO's hits (group.name) that print each of our rows, by (talent, row name as our block names it). A row a slash split
    into several rows is paired with GO's hits of its source row by kind, then by order; a Low/High plunge takes GO's first. `derived`: the rows
    her decision gives hits no row prints (Sethos's Dusk Bolts), whose GO hits it names."""
    character = kits.load_kits()["characters"][key]
    char = match[character["go_key"]]
    sheet = kit["characters"].get(character["go_key"], {})
    infused = frozenset(
        hit_key for hit_key, data in (sheet.get("hit_data") or {}).items()
        if any(kitgen.is_const(v) and isinstance(kitgen.value_of(v), str) for _, v in kitgen.leaves(data.get("infusion") or {})))
    *_, rows_of_hit, _ = kitgen.match_rows(char, kind_by_name, infused, is_damage, derived)
    weapon_type = char.get("weapon_type") or ""
    kind_of = {f"{h['group']}.{h['name']}": kitgen.hit_kind(h, weapon_type, f"{h['group']}.{h['name']}" in infused)[0]
               for h in char.get("hits", [])}
    move_of = {f"{h['group']}.{h['name']}": go_move(h) for h in char.get("hits", [])}
    by_row: dict[tuple[str, str], list[str]] = defaultdict(list)
    for hit_key, rows in rows_of_hit.items():
        for talent, name in rows:
            by_row[(talent, normalise(name))].append(hit_key)
    # the GO parameters each row prints, in its order and as often as it prints them ("{{2}}+{{2}}" is two hits of one)
    params_of = {(kitgen.TALENT_OF_PARAMS[t], normalise(r["name"])): r["params"]
                 for t, rows in kitgen.aligned_rows(char).items() for r in rows}
    names_of_param: dict[tuple[str, int], set[str]] = defaultdict(set)
    for (talent_key, name), params in params_of.items():
        for p in params:
            names_of_param[(talent_key, p)].add(name)
    params_of_hit = {f"{h['group']}.{h['name']}": {(kitgen.TALENT_OF_PARAMS[p["talent"]], p["index"]) for p in h.get("params", [])}
                     for h in char.get("hits", [])}
    # the numbers of each of a hit's parameters: two parameters with the same numbers are one list of the hit's, not two
    levels_of = {(f"{h['group']}.{h['name']}", kitgen.TALENT_OF_PARAMS[p["talent"]], p["index"]): tuple(p.get("levels") or ())
                 for h in char.get("hits", []) for p in h.get("params", [])}
    out: dict[tuple[str, str], list[str]] = {}
    for talent in hits["talents"]:
        key = talent["key"]
        used: set[str] = set()

        def pick(found: list[str], param: int, kind: str | None, move: str | None = None) -> str | None:
            """GO's hit for one printed parameter: of that parameter, of the row's kind, one no other row took yet (two
            rows with the same numbers, Sandrone's Sweeping Fire and Power Overdrive, are two hits of GO's in order)."""
            pool = [h for h in found if (key, param) in params_of_hit.get(h, set())]
            if not pool:
                # GO read the numbers from another talent's identical list (Lohen's Skill-form 5-Hit, from her Normal
                # Attack's): a hit of this talent's group with the same numbers
                wanted_levels = tuple(((char.get("params") or {}).get(PARAMS_OF[key]) or [])[param] or ()) if param < len(
                    (char.get("params") or {}).get(PARAMS_OF[key]) or []) else ()
                pool = [h for (h, _, _), lv in levels_of.items() if wanted_levels and lv == wanted_levels
                        and h.split(".")[0] in GROUPS_OF[key]]
                pool = list(dict.fromkeys(pool))
            pool = [h for h in pool if kind is None or kind_of.get(h) == kind] or pool
            pool = [h for h in pool if move is None or move_of.get(h) == move] or pool
            fresh = [h for h in pool if h not in used]
            chosen = (fresh or pool or [None])[0]
            if chosen:
                used.add(chosen)
            return chosen

        groups: dict[str, list[dict]] = defaultdict(list)
        for row in talent["rows"]:
            groups[row["alternative"] or row["name"]].append(row)
        party = hits.get("party") or {}
        takes = {normalise(name) for name in (party.get("element_rows") or {}).get(key, ())}
        for source, rows in groups.items():
            found = by_row.get((key, normalise(source)), [])
            if normalise(source) in takes and usual is not None:
                # a row that takes the team's element: GO's hits of the elements of her usual team, one for each
                ele_of = {f"{h['group']}.{h['name']}": h.get("ele") for h in char.get("hits", [])}
                out[(key, rows[0]["name"])] = [h for h in found if ele_of.get(h) in (usual.get("elements") or [])]
                continue
            params = params_of.get((key, normalise(source)), [])
            if not found:
                # a plunge of her Skill's or Burst's form (Cyno's, Skirk's, Lohen's): GO's hit of this talent's group prints
                # the Normal Attack's row of the same name
                found = [f"{h['group']}.{h['name']}" for h in char.get("hits", []) if h["group"] in GROUPS_OF[key]
                         and any(normalise(source) in names_of_param.get((kitgen.TALENT_OF_PARAMS[p["talent"]], p["index"]), ())
                                 for p in h.get("params", []))]
                if found and len(rows) == 1:
                    out[(key, rows[0]["name"])] = found[:1]
                    continue
            if len(rows) == 1:
                # one hit: every parameter it prints (a sum, "47.4%+88.1%", is two hits; "{{2}}+{{2}}" two of one), or the
                # first of a Low/High plunge; a hit that reads two of the parameters (ATK and Elemental Mastery) is one
                wanted = params[:1] if "low/high" in source.casefold() else params
                chosen: list[str] = []
                spent: list[tuple[str, tuple]] = []
                for p in wanted:
                    covering = next((h for h in chosen if (key, p) in params_of_hit.get(h, set())
                                     and (h, levels_of.get((h, key, p))) not in spent), None)
                    hit = covering or pick(found, p, rows[0]["kind"], rows[0]["move"])
                    if hit is None:
                        chosen = []
                        break
                    if covering is None:
                        chosen.append(hit)
                    spent.append((hit, levels_of.get((hit, key, p))))
                out[(key, rows[0]["name"])] = chosen if chosen else list(found)
            elif len(rows) == len(params):
                for row, p in zip(rows, params):
                    chosen = pick(found, p, row["kind"], row["move"])
                    out[(key, row["name"])] = [chosen] if chosen else []
            elif len(rows) == len(found):
                left = list(found)
                for row in rows:
                    same = [h for h in left if kind_of.get(h) == row["kind"]] or left
                    out[(key, row["name"])] = [same[0]]
                    left.remove(same[0])
            else:
                for row in rows:
                    out[(key, row["name"])] = []
    return out


def evaluated(hit_key: str) -> str:
    """The display entry GO evaluates for a hit: a hit of a later branch of one entry (`skill.nefer2Dmg~1`, gb-match.spec.ts) is the entry's
    own value in the builds where its branch is the one GO shows."""
    return hit_key.partition("~")[0]


def go_move(hit: dict) -> str:
    """The move of a GO hit as the engine names it (normal, charged, plunging, skill, burst)."""
    return kitgen.MOVE_OF.get(hit.get("move") or "") or {"charged": "charged", "plunging": "plunging"}.get(
        hit["group"], "normal" if hit["group"] == "normal" else hit["group"])


def infused_hits(kit: dict, go_key: str) -> frozenset[str]:
    """GO's hits whose own data infuses them always (Flins' attacks in his skill's form), as kitgen reads them."""
    sheet = kit["characters"].get(go_key, {})
    return frozenset(
        hit_key for hit_key, data in (sheet.get("hit_data") or {}).items()
        if any(kitgen.is_const(v) and isinstance(kitgen.value_of(v), str) for _, v in kitgen.leaves(data.get("infusion") or {})))


def move_mismatches(char: dict, hits: dict, infused: frozenset[str] = frozenset(), derived: list[dict] | None = None) -> list[dict]:
    """The rows of her hits block whose move is not the move of GO's hit for them. GO's hit for a row is found without the row's
    move: the hits that print the row (kitgen's matching); when they disagree on the move, the hits whose own parameter the
    row prints (Tartaglia's Riptide Slash is `riptideSlash`, parameter 10, not his Charged Attack's `charged1`). A row whose
    hits still disagree is listed with every move they have."""
    *_, rows_of_hit, _ = kitgen.match_rows(char, kind_by_name, infused, is_damage, derived)
    own = kitgen._own_params(char.get("hits", []))
    move_of = {f"{h['group']}.{h['name']}": go_move(h) for h in char.get("hits", [])}
    printed = {(kitgen.TALENT_OF_PARAMS[t], normalise(r["name"])): {(t, q) for q in r["params"]}
               for t, rows in kitgen.aligned_rows(char).items() for r in rows}
    by_row: dict[tuple[str, str], list[str]] = defaultdict(list)
    for hit_key, rows in rows_of_hit.items():
        for talent, name in rows:
            by_row[(talent, normalise(name))].append(hit_key)
    out = []
    for talent in hits["talents"]:
        for row in talent["rows"]:
            source = (talent["key"], normalise(row["alternative"] or row["name"]))
            found = by_row.get(source, [])
            if not found:
                continue
            moves = sorted({move_of[h] for h in found})
            if len(moves) > 1:
                mine = sorted({move_of[h] for h in found if own.get(h, set()) & printed.get(source, set())})
                moves = mine or moves
            go = moves[0] if len(moves) == 1 else moves
            if go != row["move"]:
                out.append({"row": f"{talent['key']}|{row['name']}", "ours": row["move"], "go": go})
    return out


def go_answer(case: dict, hits: dict, rows: dict, go: dict, still: frozenset[str] = frozenset()) -> dict:
    """GO's damage of each counted row (its hits summed, times the row's count) in both builds, and each main talent's change.
    With a reaction on, a row whose GO hits GO never lets react (`still`: the plunge's collision, Blood Blossom) is left out of
    both sides' sums (`left_out`): GO's choice, which the engine does not make."""
    out_rows: dict[str, dict[str, Any]] = {}
    left_out: list[str] = []
    talents: dict[str, float | None] = {}
    for talent in hits["talents"]:
        if not talent["main"]:
            continue
        field = any(r["main"] and r["kind"] == "stellar-conduct" for r in talent["rows"])
        sides = ("a", "b") if field or "a_plain" not in go else ("a_plain", "b_plain")
        sums = [0.0, 0.0]
        for row in talent["rows"]:
            if not row["main"] or not dealt(hits, row):
                continue
            names = rows.get((talent["key"], row["name"]), [])
            if case["reaction"] and names and all(h in still for h in names):
                left_out.append(f"{talent['key']}|{row['name']}")
                continue
            values = []
            for side, build in enumerate(sides):
                got = [go[build]["hits"].get(evaluated(h)) for h in names]
                value = sum(v or 0.0 for v in got) * row["count"]
                if row.get("takes") and names:
                    # the engine shares the row equally among the elements of the team shape (a modelling choice, damage.resolveParty)
                    usual = next(o for o in hits["party"]["options"] if o["id"] == hits["party"]["default"])
                    if len(names) != len(usual["elements"]):
                        raise SystemExit(f"{case['id']}: GO has {len(names)} hits for {talent['key']} {row['name']}, "
                                         f"her usual team has {len(usual['elements'])} elements")
                    value /= len(names)
                values.append(value)
                sums[side] += value
            out_rows[f"{talent['key']}|{row['name']}"] = {"go": names, "a": values[0], "b": values[1]}
        talents[talent["key"]] = (sums[1] / sums[0] - 1) * 100 if sums[0] > 0 else None
    return {"talents": talents, "rows": out_rows, "left_out": left_out}


def fixture(source: Path, cases_path: Path | None = None) -> dict:
    """web/src/fixtures/compare-cases.json from cases.json (or `cases_path`'s) and a GO run's JSON in `source`. Each character's hits block is kept
    once without the weapon's and sets' effects (`gear`, once per weapon type), her rows' text only where it is not
    cases.json's (a talent a passive raises); what only a diagnosis needs (GO's hits per row, GO's final stats) goes to
    `source`/gb-diagnosis.json."""
    plan = json.loads((cases_path or CASES).read_text(encoding="utf-8"))
    kit = json.loads((source / "gb-kit.json").read_text(encoding="utf-8"))
    match = json.loads((source / "gb-match.json").read_text(encoding="utf-8"))
    result = json.loads((source / "gb-compare.json").read_text(encoding="utf-8"))
    pinned = {}
    if FIXTURE.exists():
        before = json.loads(FIXTURE.read_text(encoding="utf-8"))
        pinned = {c["id"]: c.get("ours") for c in [*before["cases"], *before.get("gear_cases", [])]}
    # a talent a passive of hers raises (Tartaglia's Normal Attack is 11) or a constellation does (Constellation 3 and 5 raise her Skill
    # and Burst by 3): HoYoLAB's rows are at that level, as GO's hits are; one entry for each hits block (her kit at a constellation)
    constellation_of_kit: dict[str, int] = {}
    boosted_affixes, levels = {}, {}
    for case in plan["cases"]:
        name = case.get("kit", case["character"])
        constellation_of_kit[name] = case["constellation"]
        go = result.get(case["id"]) or {}
        boosted = (go.get("a") or {}).get("levels")
        if boosted and any(boosted[t] != TALENT_LEVEL for t in TALENTS) and name not in levels:
            levels[name] = boosted
            boosted_affixes[name] = affixes_of(case["go_key"], boosted)
    affixes = {**plan["affixes"], **boosted_affixes}
    blocks = {name: block(name.split("@")[0], affixes.get(name, affixes[name.split("@")[0]]), levels.get(name),
                          constellation_of_kit[name]) for name in constellation_of_kit}
    decided = kitgen.load_decided(DECIDED)
    derived = lambda name: (decided["characters"].get(name.split("@")[0]) or {}).get("derived_rows")  # noqa: E731
    matched = {name: go_rows(name.split("@")[0], blocks[name], match, kit, usual_team(decided, name.split("@")[0])[1], derived(name)) for name in blocks}
    mismatched = []
    for name in blocks:
        go_key = kits.load_kits()["characters"][name.split("@")[0]]["go_key"]
        for wrong in move_mismatches(match[go_key], blocks[name], infused_hits(kit, go_key), derived(name)):
            mismatched.append({"character": name.split("@")[0], **wrong})
    characters = kits.load_kits()["characters"]
    still = {name: frozenset(f"{h['group']}.{h['name']}" for h in match[characters[name.split("@")[0]]["go_key"]]["hits"]
                             if h.get("reacts") is False) for name in blocks}
    out_cases, diagnosis = [], {}
    for case in plan["cases"]:
        go = result.get(case["id"])
        name = case.get("kit", case["character"])
        hits = blocks[name]
        entry = {"id": case["id"], "character": case["character"], "swap": case["swap"], "reaction": case["reaction"],
                 "mains_a": case["mains_a"], "mains_b": case["mains_b"]}
        if name != case["character"]:
            entry.update({"kit": name, "constellation": case["constellation"]})
        if go is None or "error" in go:
            entry["error"] = (go or {}).get("error", "GO did not run this case")
            out_cases.append(entry)
            continue
        answer = go_answer(case, hits, matched[name], go, still[name])
        diagnosis[case["id"]] = {"rows": answer.pop("rows"), "go_total_a": go["a"]["total"], "go_total_b": go["b"]["total"]}
        entry.update({
            "weapon": {"key": case["weapon"], "refinement": 1, "level": LEVEL, "base_atk": go["a"]["weapon"]["main"]},
            "sets": {case["set"]: 5},
            "base": go["a"]["base"],
            "panel_a": panel(go["a"], case["a"]["pieces"], hits, case["weapon"], case["set"]),
            "panel_b": panel(go["b"], case["b"]["pieces"], hits, case["weapon"], case["set"]),
            "go": answer,
            "ours": pinned.get(case["id"]),
        })
        out_cases.append(entry)
    gear_out = []
    for case in plan.get("gear_cases", []):
        go = result.get(case["id"])
        hits = blocks[case["kit"]]
        entry = {"id": case["id"], "character": case["character"], "swap": case["swap"], "reaction": None,
                 "swap_to": case["weapon_b"] if case["swap"] == "weapon" else case["set_b"], "gear_on": case["gear_on"]}
        if go is None or "error" in go:
            entry["error"] = (go or {}).get("error", "GO did not run this case")
            gear_out.append(entry)
            continue
        answer = go_answer(case, hits, matched[case["kit"]], go, still[case["kit"]])
        diagnosis[case["id"]] = {"rows": answer.pop("rows"), "go_total_a": go["a"]["total"], "go_total_b": go["b"]["total"]}
        swap = gear_swap(case, go, hits)
        if "conds_off" in case:   # an empty set of states is one too: hers had none, and the toggles were all the item's
            # GO's answer with the tested item's decided toggles off: a swap that shows a toggle answers otherwise with it on
            entry.update({"gear_off": case["gear_off"],
                          "go_off": go_answer(case, hits, matched[case["kit"]], {"a": go["a_off"], "b": go["b_off"]}, still[case["kit"]])["talents"]})
        entry.update({
            "kit": case["kit"], "weapon_kind": case["weapon_type"], "sim_set": case["set"],
            "weapon": {"key": case["weapon"], "refinement": 1, "level": LEVEL, "base_atk": go["a"]["weapon"]["main"]},
            "sets": {case["set"]: 5}, "base": go["a"]["base"], "panel_a": swap["sim"]["panel"], "swap_gear": swap, "go": answer,
            "ours": pinned.get(case["id"]),
        })
        gear_out.append(entry)
    (source / "gb-diagnosis.json").write_text(json.dumps(diagnosis), encoding="utf-8")
    kinds = sorted({characters[name.split("@")[0]]["weapon_type"] for name in blocks})
    return {
        "about": "Generated by tools/go-reference/run.py compare. Our engine's inputs and Genshin Optimizer's answers for "
                 "tools/go-reference/cases.json; `ours` is our engine's answer, pinned (compare.test.ts). A character's hits "
                 "block is `kits` with `gear` of her weapon type; her rows' text is cases.json's, or `affixes` here where a "
                 "passive raises a talent (`levels`).",
        "go_commit": plan["go_commit"], "tolerance": TOLERANCE, "tables": constants.tables(),
        "affixes": boosted_affixes, "levels": levels, "gear": {kind: gear(kind) for kind in kinds},
        "kits": {key: {k: v for k, v in b.items() if k not in ("weapon_effects", "set_effects")} for key, b in blocks.items()},
        "move_mismatches": mismatched, "cases": out_cases, "gear_cases": gear_out,
    }


def _sim_unit(go_key: str, value: float, element: str) -> tuple[str, float]:
    """A piece's stat as the simulator holds it: its key, and its value in points when it is a percentage."""
    stat = "dmg" if go_key == f"{element}_dmg_" else SIM_STAT[go_key]
    return stat, round(value * 100, 6) if go_key.endswith("_") else value


def _sim_key(stat: str | None) -> str | None:
    return {"phys": "physical"}.get(stat, stat) if stat else stat


def _two_of(key: str, element: str) -> list[dict]:
    """A set's 2-piece plain stats for a character of this element as the core's picker and sim block give them (`views.characters.set_two`)."""
    return set_two(reference.load_refs().sets[key], element)


def gear_swap(case: dict, go: dict, hits: dict) -> dict:
    """What our engine needs to run a weapon or set swap the way the planner does (`swap_gear`): a sim of the build the first side is (HoYoLAB's
    panel, her base values, the five pieces, the weapon and the set), the effects of the gear it wears, and the weapon and set tested as the
    pickers' routes give them, each with its own effects (`gear`). The tested stats are `statsWith`'s, not a panel of the second build."""
    refs = reference.load_refs()
    element, kind = case["element"], case["weapon_type"]

    def weapon_choice(key: str, with_gear: bool) -> dict:
        """The picker's choice of the weapon, with the app's own numbers at level 90 (the references': kits.json's exact ones, from GO's
        curves, in place of the wiki's rounded ones)."""
        ref = refs.weapons[key]
        out = {"key": key, "name": ref.name, "icon": None, "rarity": ref.rarity, "base_atk": ref.base_atk_90, "sub": _sim_key(ref.sub),
               "sub_value": ref.sub_90 if ref.sub else None}
        if with_gear and (item := kits.gear_of("weapons", key, 0, 6, kind))["effects"] + item["toggles"]:
            out["gear"] = item
        return out

    def set_choice(key: str, with_gear: bool) -> dict:
        out = {"key": key, "name": refs.sets[key].name, "icon": None, "two_text": "", "four_text": "", "two": _two_of(key, element)}
        if with_gear and (item := kits.gear_of("sets", key, 0, 6, kind))["effects"] + item["toggles"]:
            out["gear"] = item
        return out

    pieces = []
    for slot, piece in zip(SLOTS, case["a"]["pieces"]):
        main, value = _sim_unit(piece["stats"][0]["key"], piece["stats"][0]["value"], element)
        subs = [_sim_unit(s["key"], s["value"], element) for s in piece["stats"][1:]]
        pieces.append({
            "slot": slot, "icon": None, "name": slot, "set_key": case["set"], "level": 20, "rarity": 5, "main": main, "main_value": value,
            "subs": [{"stat": stat, "value": v, "tiers": []} for stat, v in subs], "crit_value": 0, "cv_tier": 0,
        })
    mine = weapon_choice(case["weapon"], False)
    mine_atk = go["a"]["weapon"]["main"]
    worn = gear(kind, (case["weapon"],), (case["set"],))
    return {
        "sim": {
            "panel": panel(go["a"], case["a"]["pieces"], {**hits, **worn}, case["weapon"], case["set"]),
            "base": go["a"]["base"], "char_base_atk": go["a"]["base"]["atk"] - mine_atk,
            "weapon": {**{k: v for k, v in mine.items() if k != "base_atk"}, "type": kind, "level": LEVEL, "refinement": 1, "base_atk": mine_atk},
            "sets": [{**set_choice(case["set"], False), "pieces": 5}], "pieces": pieces,
        },
        "hits": worn,
        "weapon_b": weapon_choice(case["weapon_b"], True), "set_b": set_choice(case["set_b"], True),
        "toggles": case["gear_toggles"],
    }


def write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")


def attach_ours(data: dict, ours: dict) -> dict:
    """Our engine's answers (compare.test.ts with GB_COMPARE_OUT) into `data`'s cases as the `ours` ones."""
    for case in [*data["cases"], *data.get("gear_cases", [])]:
        got = ours.get(case["id"])
        if got is not None:
            case["ours"] = {"talents": got["talents"]}
    return data


def pin(ours_path: Path) -> dict:
    """Our engine's answers (compare.test.ts with GB_COMPARE_OUT) into the fixture as the pinned ones."""
    data = attach_ours(json.loads(FIXTURE.read_text(encoding="utf-8")), json.loads(ours_path.read_text(encoding="utf-8")))
    write(FIXTURE, data)
    return data


def agreement(case: dict) -> tuple[bool, list[str]]:
    """Whether our change and GO's agree within the tolerance for every main talent, and how each differs."""
    ours = (case.get("ours") or {}).get("talents") or {}
    theirs = (case.get("go") or {}).get("talents") or {}
    notes, ok = [], True
    for talent in sorted(set(ours) | set(theirs)):
        a, b = ours.get(talent), theirs.get(talent)
        if a is None or b is None:
            ok = ok and a is None and b is None
            notes.append(f"{talent}: ours {a}, GO {b}")
            continue
        if abs(a - b) > TOLERANCE:
            ok = False
        notes.append(f"{talent}: ours {a:+.3f}%, GO {b:+.3f}%")
    return ok and bool(ours), notes


def only_report(data: dict, only: list[str], checked: set[str], unsure: set[str],
                skipped: dict[str, str] | None = None) -> tuple[list[str], list[str]]:
    """The lines `run.py compare --only` prints for a partial run, and the failures: every case of a decided (checked) character
    whose answer is missing, whose move is not GO's or whose change disagrees with GO's. A character whose kit is marked unsure
    may disagree (said, not failed); a character not decided yet is told the same and never fails the run."""
    lines: list[str] = []
    failed: list[str] = []
    move_wrong = {(m["character"]): m for m in data.get("move_mismatches", []) if m["character"] in only}
    for key in only:
        if key in (skipped or {}):
            lines.append(f"{key}: not compared ({skipped[key]})")
            continue
        mine = [c for c in [*data["cases"], *data.get("gear_cases", [])] if c["character"] == key]
        if not mine:
            lines.append(f"{key}: no case")
            continue
        status = "decided" if key in checked else "undecided"
        if key in move_wrong:
            m = move_wrong[key]
            lines.append(f"{key}: row {m['row']}: move ours {m['ours']}, GO {m['go']}")
            if key in checked:
                failed.append(f"{key}:move")
        for case in mine:
            if "error" in case:
                lines.append(f"  {case['id']}: {case['error']} ({status})")
                if key in checked:
                    failed.append(case["id"])
                continue
            ok, notes = agreement(case)
            if ok:
                lines.append(f"  {case['id']}: agrees ({'; '.join(notes)})")
                continue
            if key in unsure:
                lines.append(f"  {case['id']}: disagrees, accepted: marked unsure ({'; '.join(notes)})")
            else:
                lines.append(f"  {case['id']}: DISAGREES ({status}): {'; '.join(notes)}")
                if key in checked:
                    failed.append(case["id"])
    return lines, failed


def report_table(data: dict, unsure: dict[str, str]) -> str:
    """Every case as a Markdown table: each main talent's change, ours and GO's, and whether they agree."""
    lines = ["| Case | Normal Attack | Skill | Burst | Agrees |", "|---|---|---|---|---|"]
    for case in [*data["cases"], *data.get("gear_cases", [])]:
        ours = (case.get("ours") or {}).get("talents") or {}
        theirs = (case.get("go") or {}).get("talents") or {}

        def cell(talent: str) -> str:
            if talent not in ours and talent not in theirs:
                return ""
            a, b = ours.get(talent), theirs.get(talent)
            show = lambda x: "none" if x is None else f"{x:+.3f}"  # noqa: E731
            return f"{show(a)} / {show(b)}"

        agreed, _ = agreement(case)
        verdict = "yes" if agreed else ("no, unsure" if case["character"] in unsure else "NO")
        left = (case.get("go") or {}).get("left_out") or []
        if left:
            verdict += f" ({len(left)} row{'s' if len(left) > 1 else ''} GO never lets react left out)"
        lines.append(f"| {case['id']} | {cell('normal')} | {cell('skill')} | {cell('burst')} | {verdict} |")
    return "\n".join(lines)


def write_report(path: Path, data: dict) -> None:
    """The table of every case into a report, between its `<!-- cases -->` and `<!-- /cases -->` lines."""
    unsure = {key: c["unsure"] for key, c in kits.load_kits()["characters"].items() if c.get("unsure")}
    text = path.read_text(encoding="utf-8")
    start, end = "<!-- cases -->", "<!-- /cases -->"
    if start not in text or end not in text:
        raise SystemExit(f"{path} has no {start} ... {end} section")
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    path.write_text(f"{head}{start}\n{report_table(data, unsure)}\n{end}{tail}", encoding="utf-8", newline="\n")
