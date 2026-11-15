"""The Characters pages' models for the roster, the profile and the planner (the plan's TypeScript contract, `types.ts`): the
service gathers what is known of a character, and these builders put it into the shape the pages read. Words are plain and
factual; a pronoun comes from the card, "they" where it has none."""
from __future__ import annotations

import copy
import re
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any, Sequence

from guildboard import characters
from guildboard.characters import (
    SLOTS, bridge, constants, kits, nextsteps, readiness, reference, rolls, simhits, stats, wiki, xray,
)
from guildboard.characters.bridge import TALENT_LABELS, TALENTS, stat_text
from guildboard.characters.models import Build, Card, Need, Plan, Source
from guildboard.characters.stats import label as stat_label
from guildboard.characters.wiki import stat_key
from guildboard.metrics import slug

if TYPE_CHECKING:  # the service builds these models; it is not imported here
    from guildboard.characters.service import Char, Characters

STAT_ORDER = ("hp", "atk", "def", "em", "cr", "cd", "er", "dmg")
SCALES = {"hp": 40000, "atk": 4000, "def": 2000, "em": 500, "cr": 100, "cd": 300, "er": 200, "dmg": 100, "heal": 100, "phys": 100}
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
PART_LABELS = {"level": "Level", "talents": "Talents", "weapon": "Weapon", "artifacts": "Artifacts"}


# ------------------------------------------------------------------------------------------------ small helpers

def pronouns(card: Card) -> dict[str, str]:
    she, her, hers = card.pronouns
    return {"she": she, "her": her, "hers": hers}


def standing_alone(card: Card) -> str:
    """The possessive that stands alone, as a tag says whose a choice is: "Hers", "His" or "Theirs"."""
    return {"her": "Hers", "his": "His", "their": "Theirs"}.get(card.pronouns[2], card.pronouns[2].capitalize())


def rarity_of(char: "Char") -> int:
    return 5 if char.rarity >= 5 else 4


def number_text(value: float) -> str:
    return f"{round(value):,}"


def label_of(stat: str, element: str | None = None) -> str:
    if stat == "hp":
        return "Max HP"
    if stat == "dmg_other":
        return "Another element's DMG Bonus"
    return stat_label(stat, element)


def day_text(day: date) -> str:
    """A day as the pages say it: "Sun 8 Nov"."""
    return f"{day:%a} {day.day} {day:%b}"


def and_list(items: Sequence[str]) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def source_text(source: Source) -> str:
    """Where a material comes from, in a sentence the page shows beside it."""
    kind, where = source.kind, source.where
    if kind in ("books", "forgery"):
        days = and_list([WEEKDAYS[d] for d in source.days])
        return f"{where}, open {days}" if days else where
    if kind == "weekly":
        return f"{where}, a weekly boss"
    if kind == "boss":
        return f"{where}, a world boss"
    if kind == "flowers":
        return f"{where}, a local specialty" if where else "A local specialty"
    if kind == "enemies":
        return f"Dropped by {where}" if where else "Dropped by enemies"
    if kind == "ley":
        return where or "Ley Line Outcrops"
    if kind == "crafted":
        return "Crafted"
    return "Source not known yet"


def material_rows(svc: "Characters", needs: Sequence[Need]) -> list[dict[str, Any]]:
    """What a plan takes, as the pages' rows: held against needed, and where each comes from. Mora and EXP come last."""
    typed = svc.typed_keys()
    rows = []
    for need in needs:
        state = "unknown" if need.held is None else "ready" if need.held >= need.amount else "missing"
        rows.append({
            "key": need.material, "name": need.name, "icon": need.icon, "held": need.held, "held_exact": need.exact,
            "needed": need.amount, "state": state, "source": source_text(need.source), "typed": need.material in typed,
        })
    last = ("character-exp", "weapon-exp", "mora")
    rows.sort(key=lambda row: last.index(row["key"]) + 1 if row["key"] in last else 0)
    return rows


def _owned_card(char: "Char") -> tuple[Build, Card]:
    assert char.build is not None
    return char.build, char.card


# ------------------------------------------------------------------------------------------------ the roster

def _banners(svc: "Characters") -> dict[str, dict[str, Any]]:
    """The character banners the calendar names, by the name of each 5-star they feature: the one running, else the next."""
    doc = svc.store.latest_doc("calendar")
    detail = (doc[1].get("detail") or {}) if doc is not None else {}
    now = svc.now()
    found: dict[str, dict[str, Any]] = {}
    for names, starts, ends in detail.get("banners") or ():
        try:
            begin, end = _moment(starts), _moment(ends)
        except ValueError:
            continue
        if end < now:
            continue
        entry = {"starts": starts, "ends": ends, "running": begin <= now <= end}
        for name in names:
            kept = found.get(name.lower())
            if kept is None or (entry["running"] and not kept["running"]) or (
                entry["running"] == kept["running"] and begin < _moment(kept["starts"])
            ):
                found[name.lower()] = entry
    return found


def _moment(text: str) -> datetime:
    when = datetime.fromisoformat(text)
    return when if when.tzinfo is not None else when.replace(tzinfo=timezone.utc)


def build_roster(svc: "Characters") -> dict[str, Any]:
    banners = _banners(svc)
    focus = svc.focus()
    entries = []
    for key in svc.keys():
        char = svc.char(key)
        if char is None:
            continue
        banner = banners.get(char.name.lower())
        entries.append({
            "key": char.key, "name": char.name, "element": char.element, "weapon": char.weapon_type,
            "rarity": rarity_of(char), "icon": svc.address(char.icon), "owned": char.owned,
            "level": char.build.level if char.build else None,
            "constellation": char.build.constellation if char.build else None,
            "readiness": svc.readiness_now(char).total, "focus": focus.index(key) + 1 if key in focus else None,
            "early": char.early, "banner": dict(banner) if banner else None,
        })
    entries.sort(key=lambda e: (
        not e["owned"], -e["readiness"], not (e["banner"] and e["banner"]["running"]), e["early"], e["name"].lower(),
    ))
    present = {entry["key"] for entry in entries}
    return {
        "owned": sum(1 for entry in entries if entry["owned"]), "all": len(entries),
        "focus": [key for key in focus if key in present], "entries": entries, "sync": svc.sync_view(),
    }


# ------------------------------------------------------------------------------------------------ the profile

def _stat_keys(char: "Char", panel: dict[str, float]) -> list[str]:
    keys = list(STAT_ORDER)
    if "heal" in char.card.goals or panel.get("heal", 0) > 0:
        keys.append("heal")
    if panel.get("phys", 0) > 0:
        keys.append("phys")
    return keys


def _goal_text(key: str, goal: float) -> str:
    return stat_text(key, goal)


def _how(key: str, her: float, weapon: float, artifacts: float, build: Build, card: Card) -> str:
    parts = []
    if abs(her) >= 0.05:
        parts.append(f"{card.pronouns[2].capitalize()} own {_fmt(key, her)}")
    if abs(weapon) >= 0.05:
        extra = ""
        if key == "atk" and build.weapon is not None and weapon - build.weapon.base_atk >= 0.5:
            extra = f" ({number_text(build.weapon.base_atk)} base, {number_text(weapon - build.weapon.base_atk)} from its passive)"
        parts.append(f"weapon {_fmt(key, weapon)}{extra}")
    if abs(artifacts) >= 0.05:
        parts.append(f"artifacts {_fmt(key, artifacts)}")
    if not parts:
        return "None."
    text = ", ".join(parts) + "."
    return text[0].upper() + text[1:]


def _fmt(key: str, value: float) -> str:
    return f"{value:.1f}" if key in bridge.PERCENT_STATS else number_text(value)


def _stat_rows(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    card = char.card
    if char.build is None:
        rows = []
        for key in [k for k in (*STAT_ORDER, "heal", "phys") if k in card.goals]:
            goal = card.goals[key]
            rows.append({
                "key": key, "label": label_of(key, card.element), "text": _goal_text(key, goal), "value": 0.0, "her": 0.0,
                "weapon": 0.0, "artifacts": 0.0, "scale": SCALES.get(key, 100), "goal": goal,
                "goal_text": _goal_text(key, goal), "met": None, "how": f"The card's goal is {_goal_text(key, goal)}.",
            })
        return rows
    build = char.build
    panel = stats.panel(build)
    split = stats.split(build, svc.refs, bridge.own_stats(build, char.page))
    rows = []
    for key in _stat_keys(char, panel):
        value = panel.get(key, 0.0)
        her, weapon, artifacts = split.get(key, (0.0, 0.0, 0.0))
        goal = card.goals.get(key)
        rows.append({
            "key": key, "label": label_of(key, card.element), "text": stat_text(key, value), "value": round(value, 2),
            "her": round(her, 2), "weapon": round(weapon, 2), "artifacts": round(artifacts, 2),
            "scale": SCALES.get(key, 100), "goal": goal, "goal_text": _goal_text(key, goal) if goal is not None else None,
            "met": None if goal is None else value >= goal, "how": _how(key, her, weapon, artifacts, build, card),
        })
    return rows


def _weapon_verdict(char: "Char", key: str) -> str:
    card = char.card
    if card.weapons and key == card.weapons[0]:
        return f"Keep it. It is {card.pronouns[2]} first choice."
    if key in card.weapons:
        return f"Keep it. {card.pronouns[2].capitalize()} card ranks it number {card.weapons.index(key) + 1}."
    if card.weapons:
        return f"It is not on {card.pronouns[2]} card. The card's first choice is {card.weapons[0].replace('-', ' ')}."
    return "The card names no weapons yet."


def _percent(stat: str) -> str:
    return "%" if stat in bridge.PERCENT_STATS else ""


def _weapon_view(svc: "Characters", char: "Char") -> dict[str, Any] | None:
    build = char.build
    if build is None or build.weapon is None:
        return None
    weapon = build.weapon
    ref = svc.refs.weapons.get(weapon.key)
    page = svc.weapon_page(weapon.key)
    texts = page.texts if page is not None else ()
    text = texts[min(max(weapon.refinement, 1), len(texts)) - 1] if texts else ""   # the wiki's, once its entry is read
    refinements = []
    for effect in ref.effects if ref else ():
        name = label_of(effect.stat, char.element) + (f" ({effect.condition})" if effect.when == "met" and effect.condition else "")
        refinements.append({"label": name, "values": [f"{value:g}{_percent(effect.stat)}" for value in effect.values]})
    return {
        "key": weapon.key, "name": weapon.name, "icon": svc.address(weapon.icon or (ref.icon if ref else None)),
        "rarity": weapon.rarity, "level": weapon.level, "refinement": weapon.refinement, "base_atk": round(weapon.base_atk),
        "sub": {"label": label_of(weapon.sub, char.element), "text": stat_text(weapon.sub, weapon.sub_value)} if weapon.sub else None,
        "passive": {"name": page.passive if page is not None else "", "text": text},
        "verdict": _weapon_verdict(char, weapon.key), "refinements": refinements,
    }


def _pieces(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    build, card = _owned_card(char)
    verdicts = {v.slot: v for v in xray.verdicts(build, card)}
    pieces = []
    for slot in SLOTS:
        piece = build.pieces.get(slot)
        if piece is None:
            continue
        verdict = verdicts[slot]
        pieces.append({
            "slot": slot, "name": piece.name, "icon": svc.address(piece.icon), "level": piece.level, "rarity": piece.rarity,
            "main": {"label": label_of(piece.main, card.element), "text": stat_text(piece.main, piece.main_value)},
            "subs": [
                {"key": sub.stat, "label": label_of(sub.stat, card.element), "text": stat_text(sub.stat, sub.value),
                 "rolls": sub.rolls, "weight": card.weights.get(sub.stat, "none")}
                for sub in piece.subs
            ],
            "verdict": verdict.verdict, "why": verdict.why, "crit_value": round(verdict.crit_value, 1),
            "cv_tier": rolls.cv_tier(round(verdict.crit_value, 1), piece.main in CRIT_MAINS),
            "rolls_wanted": verdict.rolls_wanted, "rolls_all": verdict.rolls_all, "set_name": piece.set_name,
        })
    return pieces


CRIT_MAINS = ("cr", "cd")
SIM_PANEL = ("hp", "atk", "def", "em", "er", "cr", "cd", "dmg", "heal", "physical")
SIM_KEY = {"phys": "physical"}   # the roll tables call Physical DMG Bonus "physical"; the build's and the references' key is "phys"


def _sim_key(stat: str | None) -> str | None:
    return SIM_KEY.get(stat, stat) if stat else stat


ELEMENT_BONUS = re.compile(r"^(\w+) DMG Bonus, for an? (\w+) character$")


def set_two(ref: Any, element: str | None) -> list[dict[str, Any]]:
    """A set's 2-piece plain stats for the simulator's tested stats: the ones that hold for everyone and, for a character (`element`), the
    DMG Bonus of her own element that some sets give "for a Pyro character" (the game's panel holds it only for that element). A stat that holds
    for one move or one state (Plunging Attack DMG, a state) is no plain stat and is left to the effects."""
    out = []
    for effect in ref.two:
        if not effect.values:
            continue
        match = ELEMENT_BONUS.match(effect.condition) if effect.when == "met" else None
        if effect.when == "always" or (match is not None and element is not None and match.group(1) == match.group(2) == element.capitalize()):
            out.append({"stat": _sim_key(effect.stat), "value": effect.values[0]})
    return out


def _sim_set(svc: "Characters", key: str, count: int, build: Build, element: str | None = None) -> dict[str, Any]:
    ref = svc.refs.sets.get(key)
    here = next(piece for piece in build.pieces.values() if piece.set_key == key)
    two_text, four_text = _set_texts(svc, key)
    icon = (ref.icons.get(here.slot) or ref.icons.get("flower")) if ref and ref.icons else here.icon
    return {
        "key": key, "name": ref.name if ref else here.set_name, "icon": svc.address(icon), "pieces": count,
        "two": set_two(ref, element) if ref else [], "two_text": two_text, "four_text": four_text,
    }


def _gear(kind: str, key: str, char: "Char") -> dict[str, Any] | None:
    """A weapon's or a set's effects and toggles for her, as the planner reads a tested one (`kits.gear_of`), or None: with the
    verdict switch off, with no build of hers, or when the item has neither."""
    build = char.build
    if build is None or not characters.VERDICT:
        return None
    gear = kits.gear_of(kind, key, build.constellation, build.ascension, char.weapon_type.casefold())
    return gear if gear["effects"] or gear["toggles"] else None


def build_weapon_choices(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    """The weapons of her type, 3 stars and up, at level 90: the reference's, then the wiki's list rows it does not hold, whose
    numbers come from their stored entries (null until then). A listed weapon whose entry is not stored has no known type, so it
    is left out until its entry is read. A weapon with effects or toggles for her carries them as `gear` (the planner's answer
    holds her own weapon's alone)."""
    found: dict[str, dict[str, Any]] = {}
    for key, ref in svc.refs.weapons.items():
        if ref.type == char.weapon_type and ref.rarity >= 3:
            found[key] = {
                "key": key, "name": ref.name, "icon": svc.address(ref.icon), "rarity": ref.rarity,
                "base_atk": ref.base_atk_90, "sub": _sim_key(ref.sub), "sub_value": ref.sub_90 if ref.sub else None,
            }
    for (kind, name), row in svc.store.wiki_items().items():
        key = slug(name)
        if kind != "weapon" or key in svc.refs.weapons:
            continue
        page = svc.weapon_page_at(row.entry_page_id)
        rarity = (page.rarity if page else 0) or row.rank
        if page is None or page.type != char.weapon_type or rarity < 3:
            continue
        sub = _sim_key(stat_key(page.sub)) if page.sub else None
        base_atk, sub_value = page.base_atk_90 or None, page.sub_90 if sub and page.sub_90 else None
        # kits.json's numbers at level 90 (GO's curves) when it has the weapon with this substat: the entry's are the wiki's, rounded
        exact = reference.load_weapon_levels().get(key)
        if exact and _sim_key(exact["sub"]) == sub:
            base_atk = exact["base_atk"]
            if sub is not None and exact["sub_value"] is not None:
                sub_value = exact["sub_value"] if sub == "em" else round(exact["sub_value"] * 100, 6)
        found[key] = {
            "key": key, "name": name, "icon": svc.address(row.icon_url or page.icon), "rarity": rarity,
            "base_atk": base_atk, "sub": sub, "sub_value": sub_value,
        }
    for key, weapon in found.items():
        if (gear := _gear("weapons", key, char)) is not None:
            weapon["gear"] = gear
    return sorted(found.values(), key=lambda w: (-w["rarity"], w["name"]))


def build_set_choices(svc: "Characters", char: "Char | None" = None) -> list[dict[str, Any]]:
    """Every artifact set, by name: the reference's, then the wiki's list rows it does not hold, which have no 2-piece numbers
    until the reference gains them. For a character (the planner's picker) a set with effects or toggles for her carries them as
    `gear`."""
    found: dict[str, dict[str, Any]] = {}
    for key, ref in svc.refs.sets.items():
        two_text, four_text = _set_texts(svc, key)
        found[key] = {
            "key": key, "name": ref.name, "icon": svc.address(ref.icons.get("flower") or next(iter(ref.icons.values()), None)),
            "two_text": two_text, "four_text": four_text,
            "two": set_two(ref, char.element if char is not None else None),
        }
    for (kind, name), row in svc.store.wiki_items().items():
        key = slug(name)
        if kind != "set" or key in found:
            continue
        page = svc.set_page_at(row.entry_page_id)
        two_text, four_text = (page.two_text, page.four_text) if page is not None else ("", "")
        found[key] = {"key": key, "name": name, "icon": svc.address(row.icon_url or None), "two_text": two_text,
                      "four_text": four_text, "two": []}
    if char is not None:
        for key, item in found.items():
            if (gear := _gear("sets", key, char)) is not None:
                item["gear"] = gear
    return sorted(found.values(), key=lambda s: s["name"])


def _sim_tables() -> dict[str, Any]:
    tables = reference.load_tables()
    return {
        "rolls": {str(r): {stat: list(values) for stat, values in rolls.ROLLS[r].items()} for r in (5, 4)},
        "mains": {str(r): {stat: list(values) for stat, values in tables[f"mains_by_level_{r}"].items()} for r in (5, 4)},
        "weights": dict(tables["sub_weights"]), "start4_odds": float(tables["start4_odds"]["5"]),
        **copy.deepcopy(constants.tables()),   # the damage engine's constants: a copy, the cached dicts are never handed out
    }


def _sim_hits(svc: "Characters", char: "Char") -> dict[str, Any] | None:
    """The hits block of the simulator (the Plan design, 7.4 and 14): her talents' damage rows, her kit's effects and toggles,
    and the effects of her weapon and of the sets she wears (the pickers' routes carry the others'). None while the verdict
    switch (`characters.VERDICT`) is off."""
    build = char.build
    if build is None or not characters.VERDICT:
        return None
    levels = {kind: build.talents[kind] + build.bonus.get(kind, 0) for kind in TALENTS}
    kit = kits.kit_of(char.key, build.constellation, build.ascension, "", 1, {}, element=char.element)   # hers alone: gear has its own maps
    kind = char.weapon_type.casefold()
    # her own weapon's and the sets she wears: the effects of a weapon or a set the player tests come from the pickers' routes
    weapons = {key: gear for key in ([build.weapon.key] if build.weapon else [])
               if (gear := kits.gear_of("weapons", key, build.constellation, build.ascension, kind))["effects"] or gear["toggles"]}
    sets = {key: gear for key, count in stats.set_counts(build).items()
            if count >= 2 and ((gear := kits.gear_of("sets", key, build.constellation, build.ascension, kind))["effects"] or gear["toggles"])}
    row = svc.store.wiki_entry(char.page.entry) if char.page is not None else None
    recommended = dict.fromkeys(
        _sim_key(stat) for part in ("subs", "sands", "goblet", "circlet") for stat in build.recommended.get(part, ()))
    return simhits.hits_block(
        element=char.element, weapon_type=char.weapon_type, level=build.level, levels=levels, raised=build.talents, affixes=build.affixes,
        tables=wiki.talent_tables(row.data) if row is not None else {},
        names={k: (_talent_name(char, k), _talent_icon(svc, char, k)) for k in TALENTS}, kit=kit, recommended=list(recommended),
        weapon_effects=weapons, set_effects=sets,
    )


def _sim(svc: "Characters", char: "Char") -> dict[str, Any] | None:
    """What the simulator starts from: HoYoLAB's panel, her weapon, the sets she wears and each piece with its substats cut
    into the roll tiers that can make them (a value no roll can make keeps its value and has no tiers)."""
    build = char.build
    if build is None:
        return None
    panel = stats.panel(build)
    weapon = build.weapon
    ref = svc.refs.weapons.get(weapon.key) if weapon else None
    pieces = []
    for slot in SLOTS:
        piece = build.pieces.get(slot)
        if piece is None:
            continue
        crit_value = round(xray.crit_value(piece), 1)
        subs = [
            {
                "stat": sub.stat, "value": sub.value,
                "tiers": list(rolls.split_rolls(sub.stat, sub.value, sub.rolls, piece.rarity) or ())
                if piece.rarity in rolls.ROLLS and sub.stat in rolls.ROLLS[piece.rarity] else [],
            }
            for sub in piece.subs
        ]
        pieces.append({
            "slot": slot, "icon": svc.address(piece.icon), "name": piece.name, "set_key": piece.set_key, "level": piece.level,
            "rarity": piece.rarity, "main": _sim_key(piece.main), "main_value": piece.main_value, "subs": subs,
            "crit_value": crit_value, "cv_tier": rolls.cv_tier(crit_value, piece.main in CRIT_MAINS),
        })
    total = round(sum(p["crit_value"] for p in pieces), 1)
    return {
        "panel": {stat: panel.get("phys" if stat == "physical" else stat, 0.0) for stat in SIM_PANEL},
        "base": {stat: build.base.get(stat, 0.0) for stat in ("hp", "atk", "def")},
        "char_base_atk": round(build.base.get("atk", 0.0) - (weapon.base_atk if weapon else 0.0), 4),
        "weapon": None if weapon is None else {
            "key": weapon.key, "name": ref.name if ref else weapon.name,
            "icon": svc.address(weapon.icon or (ref.icon if ref else None)), "type": ref.type if ref else weapon.type,
            "rarity": ref.rarity if ref else weapon.rarity, "level": weapon.level, "refinement": weapon.refinement,
            "base_atk": weapon.base_atk, "sub": _sim_key(weapon.sub), "sub_value": weapon.sub_value,
        },
        "sets": [_sim_set(svc, key, count, build, char.element) for key, count in stats.set_counts(build).items() if count >= 2],
        "pieces": pieces, "cv_total": total, "cv_set_tier": rolls.set_tier(total), "tables": _sim_tables(),
        "hits": _sim_hits(svc, char),
    }


def _sets(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    build = char.build
    if build is None:
        return []
    counts = stats.set_counts(build)
    names = {piece.set_key: piece.set_name for piece in build.pieces.values()}
    found = []
    for key, count in counts.items():
        if count < 2:
            continue
        ref = svc.refs.sets.get(key)
        two, four = _set_texts(svc, key)
        found.append({
            "name": names.get(key) or (ref.name if ref else key), "pieces": count, "two": two, "four": four if count >= 4 else "",
        })
    return found


def _set_texts(svc: "Characters", key: str) -> tuple[str, str]:
    """What the 2-piece and the 4-piece bonus of a set say: the wiki's words, once its entry is read, else nothing (the
    reference holds the numbers only)."""
    page = svc.set_page(key)
    return (page.two_text, page.four_text) if page is not None else ("", "")


def _talent_name(char: "Char", kind: str) -> str:
    if char.page is not None:
        for what, name, _icon, _text in char.page.talents:
            if what == kind and name:
                return name
    return TALENT_LABELS[kind]


def _talent_icon(svc: "Characters", char: "Char", kind: str) -> str | None:
    if char.page is not None:
        for what, _name, icon, _text in char.page.talents:
            if what == kind:
                return svc.address(icon)
    return None


def _talents(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    build = char.build
    return [
        {
            "kind": kind, "label": TALENT_LABELS[kind], "name": _talent_name(char, kind), "icon": _talent_icon(svc, char, kind),
            "level": build.talents[kind] if build else None, "bonus": build.bonus.get(kind, 0) if build else 0,
        }
        for kind in TALENTS
    ]


def _next_level(svc: "Characters", char: "Char") -> dict[str, Any] | None:
    build, card = char.build, char.card
    if build is None or char.page is None:
        return None
    for kind in dict.fromkeys((card.damage_talent, *card.talent_priority)):
        level = build.talents[kind]
        costs = char.page.talent_costs.get(level + 1)
        if level < 10 and costs:
            needs = svc.needs_of(char, svc.plan_of(char), dict(costs))
            return {"talent": TALENT_LABELS[kind], "materials": material_rows(svc, needs)}
    return None


def _readiness_view(svc: "Characters", char: "Char", result: readiness.Readiness) -> dict[str, Any]:
    build, card = char.build, char.card
    parts = []
    for key in readiness.WEIGHTS:
        value = result.parts.get(key, 0.0)
        if build is None:
            text = "Not yours yet"
        elif key == "level":
            text = f"{build.level} of 90"
        elif key == "talents":
            text = ", ".join(str(build.talents[kind]) for kind in card.talent_priority)
        elif key == "weapon":
            text = _weapon_part_text(char)
        else:
            text = f"{round(value * 100)}%"
        parts.append({"key": key, "label": PART_LABELS[key], "value": round(value, 3), "text": text})
    return {"total": result.total, "parts": parts}


def _weapon_part_text(char: "Char") -> str:
    build, card = char.build, char.card
    weapon = build.weapon if build else None
    if weapon is None:
        return "No weapon"
    hers = card.pronouns[2]
    if card.weapons and weapon.key == card.weapons[0]:
        which = f"{hers.capitalize()} best"
    elif weapon.key in card.weapons:
        which = f"On {hers} card"
    else:
        which = f"Not on {hers} card"
    return f"{which}, R{weapon.refinement}"


def _about(char: "Char") -> list[dict[str, str]]:
    page = char.page
    rows = []
    if page is not None:
        rows += [("Title", page.title), ("Affiliation", page.affiliation), ("Birthday", page.birthday),
                 ("Came out in", page.version), ("Special dish", page.dish)]
    rows += [("Vision", char.element), ("Weapon", char.weapon_type)]
    return [{"label": label, "value": value} for label, value in rows if value]


def _card_fields(card: Card) -> dict[str, Any]:
    """The card's own fields, as the Card panel edits them: tuples as arrays, and every slot of the main stats there."""
    return {
        "roles": list(card.roles), "keeps_alive": card.keeps_alive,
        "damage_talent": card.damage_talent, "talent_priority": list(card.talent_priority),
        "goals": {stat: goal for stat, goal in card.goals.items()},
        "mains": {slot: list(card.mains.get(slot, ())) for slot in bridge.CHOOSABLE}, "weights": dict(card.weights),
        "sets": [{"sets": list(choice.sets), "pieces": choice.pieces} for choice in card.sets],
        "weapons": list(card.weapons), "partners": list(card.partners), "partner_roles": list(card.partner_roles),
        "pronouns": list(card.pronouns),
    }


def _card_view(svc: "Characters", char: "Char") -> dict[str, Any]:
    """Her card for the profile: what was edited, how sure the research was, the card itself and what a list can be added from
    (the weapons of her type and every artifact set)."""
    card, refs = char.card, svc.refs
    weapons = sorted((w for w in refs.weapons.values() if w.type == char.weapon_type), key=lambda w: (-w.rarity, w.name))
    return {
        "edited": sorted(card.edited), "confidence": card.confidence, "early": char.early, "fields": _card_fields(card),
        "notes": card.notes, "sources": list(char.sources), "checked": char.checked,
        "options": {
            "weapons": [{"key": w.key, "name": w.name} for w in weapons],
            "sets": [{"key": s.key, "name": s.name} for s in sorted(refs.sets.values(), key=lambda s: s.name)],
        },
    }


def build_profile(svc: "Characters", char: "Char") -> dict[str, Any]:
    card, build, page, inventory = char.card, char.build, char.page, char.inventory or {}
    result = svc.readiness_now(char)
    owned = build is not None
    if owned:
        rolls = [
            {"key": stat, "label": label_of(stat, card.element), "rolls": count, "weight": weight, "where": where}
            for stat, count, weight, where in xray.roll_chart(build, card)
        ]
        steps = [{"text": step.text, "gain": step.gain} for step in nextsteps.rank(build, card, svc.refs)]
    else:
        rolls, steps = [], []
    by = {weight: sum(row["rolls"] for row in rolls if row["weight"] == weight) for weight in ("wants", "some", "none")}
    constellations = []
    if page is not None:
        for number, (name, icon, text) in enumerate(page.constellations, 1):
            constellations.append({
                "n": number, "name": name, "icon": svc.address(icon), "text": text,
                "owned": owned and number <= build.constellation,
            })
    return {
        "key": char.key, "name": char.name, "title": page.title if page else "", "element": char.element,
        "weapon_type": char.weapon_type, "rarity": rarity_of(char), "pronouns": pronouns(card), "owned": owned,
        "level": build.level if build else None, "constellation": build.constellation if build else None,
        "art": svc.address(svc.art_url(char)),
        "chart": svc.address((page.chart if page else None) or inventory.get("chart")),
        "stars": [[x, y] for x, y in card.stars] if card.stars else None,
        "chart_size": list(card.chart_size) if card.stars and card.chart_size else None,
        "pity": svc.pity_of(char.name), "stats": _stat_rows(svc, char), "rolls": rolls, "rolls_by": by,
        "weapon": _weapon_view(svc, char), "sets": _sets(svc, char), "pieces": _pieces(svc, char) if owned else [],
        "constellations": constellations, "talents": _talents(svc, char), "next_level": _next_level(svc, char),
        "about": _about(char), "readiness": _readiness_view(svc, char, result), "next_steps": steps,
        "card": _card_view(svc, char),
        "sync": svc.sync_view(),
    }


# ------------------------------------------------------------------------------------------------ the planner

def _weapon_options(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    refs, card, build = svc.refs, char.card, char.build
    held = build.weapon.key if build and build.weapon else None
    ordered = [key for key in card.weapons if key in refs.weapons and refs.weapons[key].type == char.weapon_type]
    rest = sorted(
        (ref for ref in refs.weapons.values() if ref.type == char.weapon_type and ref.key not in ordered),
        key=lambda ref: (-ref.rarity, ref.name),
    )
    options = []
    for key in [*ordered, *(ref.key for ref in rest)]:
        ref = refs.weapons[key]
        sub = f", {label_of(ref.sub, char.element)} {stat_text(ref.sub, ref.sub_90)}" if ref.sub else ""
        page = svc.weapon_page(key)
        passive = page.texts[0] if page is not None and page.texts else ""   # the wiki's words, once its entry is read
        text = f"Base ATK {round(ref.base_atk_90)}{sub}. {passive}".strip()
        tag = standing_alone(card) if key == held else "Best" if ordered and key == ordered[0] else None
        options.append({"key": key, "name": ref.name, "icon": svc.address(ref.icon), "text": text, "tag": tag})
    return options


def _refinement_note(svc: "Characters", char: "Char", plan: Plan) -> str:
    build = char.build
    key = plan.weapon or (build.weapon.key if build and build.weapon else None)
    ref = svc.refs.weapons.get(key) if key else None
    parts = []
    if ref is not None:
        for effect in ref.effects:
            if effect.when == "always" and effect.values:
                value = effect.values[min(max(plan.refinement, 1), len(effect.values)) - 1]
                parts.append(f"{label_of(effect.stat, char.element)} +{value:g}{_percent(effect.stat)} now")
    now = build.weapon.refinement if build and build.weapon and build.weapon.key == key else 0
    copies = plan.refinement - max(now, 1) if now else plan.refinement - 1
    if copies > 0:
        parts.append(f"R{plan.refinement} needs {copies} more {'copy' if copies == 1 else 'copies'}, from the weapon banner")
    return "; ".join(parts)


def _set_options(svc: "Characters", char: "Char") -> list[dict[str, Any]]:
    refs, card = svc.refs, char.card
    worn = stats.worn_choice(char.build) if char.build else None
    options: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(sets: Sequence[str], pieces: str) -> None:
        key = "+".join(sets)
        if key in seen or not all(s in refs.sets for s in sets):
            return
        seen.add(key)
        names = [refs.sets[s].name for s in sets]
        if pieces == "4":
            two = _set_texts(svc, sets[0])[0]
            name, text = names[0], f"4 pieces, {two}" if two else "4 pieces"
            icon = refs.sets[sets[0]].icons.get("flower")
        else:
            name, text = f"2 and 2: {', '.join(names)}", " / ".join(filter(None, (_set_texts(svc, s)[0] for s in sets)))
            icon = refs.sets[sets[0]].icons.get("flower")
        here = worn is not None and tuple(worn.sets) == tuple(sets) and worn.pieces == pieces
        options.append({
            "key": key, "name": name, "icon": svc.address(icon), "text": text, "tag": standing_alone(card) if here else None,
        })

    for choice in card.sets:
        add(choice.sets, choice.pieces)
    for ref in sorted(refs.sets.values(), key=lambda ref: ref.name):
        add((ref.key,), "4")
    return options


def _set_text(svc: "Characters", plan: Plan) -> str:
    if plan.set is None or not plan.set.sets:
        return ""
    refs = svc.refs
    if plan.set.pieces == "4":
        if plan.set.sets[0] not in refs.sets:
            return ""
        two, four = _set_texts(svc, plan.set.sets[0])
        return " ".join(part for part in (f"2 pieces: {two}" if two else "", f"4 pieces: {four}" if four else "") if part)
    return " ".join(
        f"2 pieces of {refs.sets[s].name}: {two}" for s in plan.set.sets if s in refs.sets and (two := _set_texts(svc, s)[0])
    )


def _mains(svc: "Characters", char: "Char", plan: Plan) -> list[dict[str, Any]]:
    refs, card, build = svc.refs, char.card, char.build
    icons = {}
    if plan.set and plan.set.sets and plan.set.sets[0] in refs.sets:
        icons = refs.sets[plan.set.sets[0]].icons
    rows = []
    for slot in bridge.CHOOSABLE:
        keys = list(dict.fromkeys([*card.mains.get(slot, ()), *refs.main_odds.get(slot, {})]))
        piece = build.pieces.get(slot) if build else None
        now = piece.main if piece is not None else (keys[0] if keys else "")
        chosen = plan.mains.get(slot, now)
        if now and now not in keys:
            keys.append(now)
        if chosen and chosen not in keys:
            keys.append(chosen)
        rows.append({
            "slot": slot, "icon": svc.address(icons.get(slot)),
            "options": [{"key": key, "label": label_of(key, char.element)} for key in keys], "now": now, "chosen": chosen,
        })
    return rows


def _level_pieces(char: "Char", plan: Plan, svc: "Characters") -> list[dict[str, Any]]:
    build, card, refs = char.build, char.card, svc.refs
    if build is None:
        return []
    rows = []
    for slot in SLOTS:
        piece = build.pieces.get(slot)
        if piece is None or piece.level >= 20 or piece.rarity < 5:
            continue
        gain = refs.mains_20.get(piece.main, piece.main_value) - piece.main_value
        left = max(0, (20 - piece.level + 3) // 4)
        wants = sum(1 for sub in piece.subs if card.weights.get(sub.stat) == "wants")
        note = (
            f"Level the {slot.capitalize()} from +{piece.level} to +20: +{stat_text(piece.main, gain)} "
            f"{label_of(piece.main, card.element)}, and {left} more roll{'' if left == 1 else 's'}. "
            f"{wants} of its {len(piece.subs)} substats are ones {card.pronouns[0]} {'want' if card.pronouns[0] == 'they' else 'wants'}."
        )
        rows.append({"slot": slot, "label": slot.capitalize(), "note": note, "on": slot in plan.level_pieces})
    return rows


def _weights(card: Card) -> list[dict[str, str]]:
    order = {"wants": 0, "some": 1, "none": 2}
    keys = sorted(bridge.SUBSTATS, key=lambda key: (order[card.weights.get(key, "none")], bridge.SUBSTATS.index(key)))
    return [{"key": key, "label": label_of(key, card.element), "weight": card.weights.get(key, "none")} for key in keys]


def build_planner(svc: "Characters", char: "Char") -> dict[str, Any]:
    card, build = char.card, char.build
    plan = svc.plan_of(char)
    damage_role = "damage" in card.roles
    cr_combat = stats.combat(build, plan, card, svc.refs).get("cr", 0.0) if build is not None else 0.0
    warning = None
    if build is not None and cr_combat > 100.0:
        warning = (
            f"{card.pronouns[2].capitalize()} Crit Rate with conditions met is {cr_combat:.1f}%, so "
            f"{cr_combat - 100:.1f} points of it do nothing."
        )
    held_now = build.talents if build else {kind: 1 for kind in TALENTS}
    return {
        "key": char.key, "name": char.name, "element": char.element, "pronouns": pronouns(card),
        "icon": svc.address(char.icon), "damage_role": damage_role,
        "now_build": None if build is None else {
            "level": build.level, "constellation": build.constellation, "refinement": build.weapon.refinement if build.weapon else None,
            "weapon_level": build.weapon.level if build.weapon else None,
        },
        "plan": {**bridge.plan_to_json(plan), "weights": dict(card.weights)},
        "talents": [
            {
                "kind": kind, "label": TALENT_LABELS[kind], "name": _talent_name(char, kind),
                "icon": _talent_icon(svc, char, kind), "now": held_now[kind], "target": plan.talents.get(kind, held_now[kind]),
                "bonus": build.bonus.get(kind, 0) if build else 0, "max": 10,
            }
            for kind in TALENTS
        ],
        "weapons": _weapon_options(svc, char), "refinement_note": _refinement_note(svc, char, plan),
        "sets": _set_options(svc, char), "set_text": _set_text(svc, plan), "mains": _mains(svc, char, plan),
        "level_pieces": _level_pieces(char, plan, svc), "weights": _weights(card),
        "warning": warning, "sync": svc.sync_view(), "sim": _sim(svc, char),
    }
