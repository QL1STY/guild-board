"""The Characters pages' models for the roster, the profile and the planner (the plan's TypeScript contract, `types.ts`): the
service gathers what is known of a character, and these builders put it into the shape the pages read. Words are plain and
factual; a pronoun comes from the card, "they" where it has none."""
from __future__ import annotations

import dataclasses
import math
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Sequence

from guildboard.characters import SLOTS, bridge, damage, nextsteps, odds, readiness, stats, xray
from guildboard.characters.bridge import TALENT_LABELS, TALENTS, stat_text
from guildboard.characters.models import Build, Card, Need, Plan, Source
from guildboard.characters.stats import label as stat_label

if TYPE_CHECKING:  # the service builds these models; it is not imported here
    from guildboard.characters.service import Char, Characters

STAT_ORDER = ("hp", "atk", "def", "em", "cr", "cd", "er", "dmg")
SCALES = {"hp": 40000, "atk": 4000, "def": 2000, "em": 500, "cr": 100, "cd": 300, "er": 200, "dmg": 100, "heal": 100, "phys": 100}
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
PART_LABELS = {"level": "Level", "talents": "Talents", "weapon": "Weapon", "artifacts": "Artifacts"}
MINUS = "\N{MINUS SIGN}"
CURVE_DAYS = 50
ELIXIR = "Sanctifying Elixir: you choose its main stat and two substats"


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


def long_day(day: date) -> str:
    return f"{WEEKDAYS[day.weekday()]} {day.day} {day:%B}"


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
    if char.card.talent_table == "physical" or panel.get("phys", 0) > 0:
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
            "rolls_wanted": verdict.rolls_wanted, "rolls_all": verdict.rolls_all, "set_name": piece.set_name,
        })
    return pieces


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
        "roles": list(card.roles), "keeps_alive": card.keeps_alive, "scaling": card.scaling,
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

def luck_slots(svc: "Characters", char: "Char", plan: Plan) -> list[tuple[str, str]]:
    """The pieces her plan asks for that she does not wear: (slot, main stat) for each of the Sands, Goblet and Circlet whose
    planned main stat is not the one on her, unless a piece typed in the plan stands in for it. Someone who is not owned has
    no pieces to find."""
    build = char.build
    if build is None:
        return []
    typed = plan.typed.slot if plan.typed is not None and plan.typed.use else None
    found = []
    for slot in bridge.CHOOSABLE:
        wanted = plan.mains.get(slot)
        piece = build.pieces.get(slot)
        if wanted and slot != typed and (piece is None or piece.main != wanted):
            found.append((slot, wanted))
    return found


def luck_label(char: "Char", slot: str, main: str) -> str:
    return f"{label_of(main, char.element)} {slot}"


def _chance_text(per_run: float, unit: str) -> str:
    return f"1 in {max(1, round(1 / per_run))} {unit}" if per_run > 0 else "Never"


def _find(svc: "Characters", char: "Char", plan: Plan) -> list[dict[str, Any]]:
    refs = svc.refs
    icons = {}
    if plan.set and plan.set.sets and plan.set.sets[0] in refs.sets:
        icons = refs.sets[plan.set.sets[0]].icons
    found = []
    for slot, main in luck_slots(svc, char, plan):
        crit = main in ("cr", "cd")
        anywhere = odds.per_run(slot, main, crit, True, refs)
        theirs = odds.per_run(slot, main, crit, False, refs)
        box = odds.per_strongbox(slot, main, crit, refs)
        found.append({
            "label": f"A {label_of(main, char.element)} {slot} with a crit substat" if not crit else f"A {label_of(main, char.element)} {slot} with the other crit substat",
            "icon": svc.address(icons.get(slot)), "per_run": round(anywhere, 5),
            "paths": [
                {"label": ELIXIR, "odds": "Certain", "best": True},
                {"label": "Any artifact domain", "odds": _chance_text(anywhere, "runs"), "best": False},
                {"label": f"{char.card.pronouns[2].capitalize()} set's domain only", "odds": _chance_text(theirs, "runs"), "best": False},
                {"label": f"Strongbox, {char.card.pronouns[2]} set, 3 artifacts a try", "odds": _chance_text(box, "tries"), "best": False},
            ],
            "note": f"Any artifact domain works: one piece from another set keeps {char.card.pronouns[2]} 4-piece bonus."
            if plan.set is not None and plan.set.pieces == "4" else "",
        })
    return found


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


def _change_text(key: str, delta: float) -> str:
    percent = key in bridge.PERCENT_STATS
    if abs(delta) < (0.05 if percent else 0.5):
        return "no change"
    sign = "+" if delta > 0 else MINUS
    return f"{sign}{abs(delta):.1f}" if percent else f"{sign}{round(abs(delta)):,}"


def _planner_stats(
    char: "Char", now: dict[str, float], planned: dict[str, float], combat: dict[str, float]
) -> list[dict[str, Any]]:
    card = char.card
    keys = list(dict.fromkeys([card.scaling if card.scaling != "em" else "em", "cr", "cd", "dmg", "er", "em", "hp", "atk", "def"]))
    if "heal" in card.goals or now.get("heal", 0) > 0:
        keys.append("heal")
    if card.talent_table == "physical" or now.get("phys", 0) > 0:
        keys.append("phys")
    rows = []
    for key in keys:
        before, after, goal = now.get(key, 0.0), planned.get(key, 0.0), card.goals.get(key)
        how = f"Now {stat_text(key, before)}, with the plan {stat_text(key, after)}."
        if goal is not None:
            how += f" {card.pronouns[2].capitalize()} goal: {_goal_text(key, goal)}."
        if key == "cr" and abs(combat.get("cr", after) - after) >= 0.05:
            how += f" In combat, with set effects met: {combat['cr']:.1f}%."
        rows.append({
            "key": key, "label": label_of(key, card.element), "now": round(before, 2), "now_text": stat_text(key, before),
            "plan": round(after, 2), "plan_text": stat_text(key, after), "scale": SCALES.get(key, 100), "goal": goal,
            "change_text": _change_text(key, after - before), "how": how,
        })
    return rows


def _goals_met(char: "Char", planned: dict[str, float], combat: dict[str, float]) -> list[dict[str, Any]]:
    card = char.card
    rows = []
    for key in [k for k in (*STAT_ORDER, "heal", "phys") if k in card.goals]:
        goal = card.goals[key]
        value = combat.get("cr", 0.0) if key == "cr" else damage.dmg_bonus(combat, card) if key == "dmg" else planned.get(key, 0.0)
        rows.append({
            "label": label_of(key, card.element), "text": f"{stat_text(key, value)} of {_goal_text(key, goal)}",
            "met": value >= goal,
        })
    return rows


def _typed_view(svc: "Characters", char: "Char", plan: Plan, est: Any) -> dict[str, Any] | None:
    typed = plan.typed
    if typed is None:
        return None
    refs, card = svc.refs, char.card
    subs = [(stat, value) for stat, value in typed.subs if stat and value]
    crit = sum(2 * value if stat == "cr" else value if stat == "cd" else 0.0 for stat, value in subs)
    rolls = [(stat, max(1, round(value / refs.roll_avg[stat])) if refs.roll_avg.get(stat) else 1) for stat, value in subs]
    wanted = sum(count for stat, count in rolls if card.weights.get(stat) == "wants")
    change = None
    if char.build is not None and "damage" in card.roles:
        without = est(dataclasses.replace(plan, typed=None))
        with_it = est(dataclasses.replace(plan, typed=dataclasses.replace(typed, use=True)))
        change = damage.change(without, with_it) if without > 0 else None
    return {
        "crit_value": round(crit, 1), "rolls_wanted": wanted, "rolls_all": sum(count for _, count in rolls),
        "change": change, "against": f"against the plan's {typed.slot}",
    }


def _curve(svc: "Characters", char: "Char", plan: Plan, pieces: list[tuple[str, str]]) -> dict[str, Any]:
    """The chance that the pieces to find are all in, day by day, from the runs the week plan gives her (or all the resin,
    when she is not in the focus), and the day her talents are ready."""
    today, refs = svc.today(), svc.refs
    focus = svc.focus()
    chances = [
        odds.per_run(slot, main, main in ("cr", "cd"), True, refs) for slot, main in pieces
    ]
    runs_by_day: list[int] = []
    ready_text = None
    if char.key in focus:
        week_plan, inputs, _ = svc.week_plan(horizon=CURVE_DAYS)
        total = 0
        for day in week_plan.days:
            total += sum(task.runs for task in day.tasks if task.kind == "artifacts" and char.key in task.who[:1])
            runs_by_day.append(total)
        ready = week_plan.ready.get(char.key)
        ready_text = "today" if ready == today else day_text(ready) if ready else None
    else:
        resin = svc.resin()
        total, carry = 0, 0
        for index in range(CURVE_DAYS):
            have = resin.now if index == 0 else min(resin.top, carry + 180)
            runs = have // 20
            carry = have - runs * 20
            total += runs
            runs_by_day.append(total)
    points = []
    for runs in runs_by_day:
        together = 1.0
        for p in chances:
            together *= odds.chance(p, runs)
        points.append(round(together, 4))
    half = next((i for i, p in enumerate(points) if p >= 0.5), None) if chances else None
    most = next((i for i, p in enumerate(points) if p >= 0.9), None) if chances else None
    per_day = round((runs_by_day[7] - runs_by_day[0]) / 7) if len(runs_by_day) > 7 else 9
    if not chances:
        she = char.card.pronouns[0]
        summary = f"Nothing {she} {'need' if she == 'they' else 'needs'} depends on luck."
    else:
        tail = f"half a chance by {day_text(today + timedelta(days=half))}" if half is not None else "less than half a chance in 50 days"
        if most is not None:
            tail += f", nine in ten by {day_text(today + timedelta(days=most))}"
        summary = f"{'The new piece' if len(chances) == 1 else 'All new pieces'}: {tail}, at {per_day} runs a day."
    if ready_text:
        summary = f"Talents {ready_text}. " + summary
    return {
        "points": points if chances else [], "half": day_text(today + timedelta(days=half)) if half is not None else None,
        "most": day_text(today + timedelta(days=most)) if most is not None else None, "talents_on": ready_text,
        "summary": summary,
    }


def _takes(svc: "Characters", char: "Char", plan: Plan, resin_top: int) -> tuple[dict[str, Any], int | None]:
    from guildboard.views.week import task_title

    needs = svc.needs_of(char, plan)
    focus = svc.focus()
    position = focus.index(char.key) + 1 if char.key in focus else None
    resin_today: list[dict[str, Any]] = []
    note = f"Add {char.card.pronouns[1]} to your focus to have this planned across the week."
    if position is not None:
        week_plan, _inputs, _chars = svc.week_plan(horizon=1)
        tasks = [t for t in week_plan.days[0].tasks if not t.free and t.who[:1] == (char.key,) or (not t.free and char.key in t.who)]
        spent = sum(t.resin for t in tasks)
        resin_today = [{"label": task_title(task, {n.material: n for n in needs}), "resin": task.resin} for task in tasks]
        day = week_plan.days[0]
        if tasks:
            names = and_list([task_title(task, {n.material: n for n in needs}) for task in tasks])
            note = f"Today: {names}. {spent} of your {day.start} resin today"
            # The rest is what the bar shows as not hers: the other characters' runs, and what nobody spends.
            others = [t for t in day.tasks if not t.free and char.key not in t.who]
            elsewhere = sum(t.resin for t in others)
            whose = [other.name for key in dict.fromkeys(k for t in others for k in t.who) if (other := svc.char(key)) is not None]
            if elsewhere and whose:
                note += f"; the other {elsewhere} go to {and_list(whose)}"
            note += "."
            if day.start - day.spent > 0:
                note += f" {day.start - day.spent} carries over."
        else:
            note = f"Nothing to farm for {char.card.pronouns[1]} with resin today."
    return {
        "today_note": note, "materials": material_rows(svc, needs), "resin_today": resin_today, "resin_cap": resin_top,
        "find": _find(svc, char, plan),
    }, position


def build_planner(svc: "Characters", char: "Char") -> dict[str, Any]:
    card, build, refs = char.card, char.build, svc.refs
    plan = svc.plan_of(char)
    damage_role = "damage" in card.roles
    owned = build is not None
    now_ready = svc.readiness_now(char).total
    plan_ready = svc.readiness_after(char, plan).total
    est_now = est_plan = 0.0
    change: int | None = None
    now_panel: dict[str, float] = {}
    plan_panel: dict[str, float] = {}
    plan_combat: dict[str, float] = {}

    def estimate_of(p: Plan) -> float:
        assert build is not None
        after = stats.apply_plan(build, p, card, refs)
        return damage.estimate(stats.combat(build, p, card, refs), card, readiness.talent_level(after, card), refs)

    if owned:
        now_panel = stats.panel(build)
        plan_panel = stats.planned(build, plan, card, refs)
        plan_combat = stats.combat(build, plan, card, refs)
        if damage_role:
            est_now = damage.estimate(stats.combat_now(build, card, refs), card, readiness.talent_level(build, card), refs)
            est_plan = estimate_of(plan)
            change = damage.change(est_now, est_plan) if est_now > 0 else None
    index_plan = round(100 * est_plan / est_now) if est_now > 0 else 0
    takes, position = _takes(svc, char, plan, svc.resin().top)
    cr_combat = plan_combat.get("cr", 0.0)
    warning = None
    if owned and cr_combat > 100.0:
        warning = (
            f"{card.pronouns[2].capitalize()} Crit Rate with conditions met is {cr_combat:.1f}%, so "
            f"{cr_combat - 100:.1f} points of it do nothing."
        )
    luck = luck_slots(svc, char, plan)
    held_now = build.talents if build else {kind: 1 for kind in TALENTS}
    return {
        "key": char.key, "name": char.name, "element": char.element, "pronouns": pronouns(card),
        "icon": svc.address(char.icon), "damage_role": damage_role,
        "now_build": None if build is None else {
            "level": build.level, "refinement": build.weapon.refinement if build.weapon else None,
            "weapon_level": build.weapon.level if build.weapon else None,
        },
        "plan": {**bridge.plan_to_json(plan), "weights": dict(card.weights)},
        "now": {"readiness": now_ready, "damage": 100 if damage_role and est_now > 0 else 0},
        "with_plan": {"readiness": plan_ready, "damage": index_plan, "change": change},
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
        "stats": _planner_stats(char, now_panel, plan_panel, plan_combat) if owned else [],
        "goals_met": None if damage_role or not owned else _goals_met(char, plan_panel, plan_combat),
        "warning": warning, "try": _typed_view(svc, char, plan, estimate_of) if owned else None,
        "takes": takes, "days": _curve(svc, char, plan, luck), "in_focus": position, "sync": svc.sync_view(),
    }
