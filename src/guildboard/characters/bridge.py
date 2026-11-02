"""The bridges between what HoYoLAB, the wiki and the player kept and what the engines take (the Characters plan's
amendments of 2026-10-29): a HoYoLAB build as an engine `Build`, her own stats at her level, a card when the research has
none, the player's edits to a card, and a plan as the player keeps it. Everything here is pure: no store, no clock, no I/O.

Stat keys are `characters.STATS` beside `phys`. A main stat that is another element's DMG Bonus than hers is `dmg_other`: it
counts for nothing, and the X-ray calls the piece wrong when the card names its main stat."""
from __future__ import annotations

import dataclasses
import re
from typing import Any, Mapping, Sequence

from guildboard.characters import ELEMENTS, SLOTS
from guildboard.characters.models import Build, Card, Piece, Plan, Refs, SetChoice, Sub, TypedPiece, WeaponState
from guildboard.characters.stats import ELEMENT_DMG_PROPS, PROP_KEYS
from guildboard.characters.wiki import CharacterPage, stat_key
from guildboard.metrics import slug

SLOT_OF_POS = {1: "flower", 2: "plume", 3: "sands", 4: "goblet", 5: "circlet"}
WEAPON_TYPE_OF_ID = {1: "Sword", 10: "Catalyst", 11: "Claymore", 12: "Bow", 13: "Polearm"}   # HoYoLAB's weapon type ids
KIND_OF_SKILL = {1: "normal", 2: "skill", 3: "burst"}   # HoYoLAB's skill types of the three talents that have levels
TALENTS = ("normal", "skill", "burst")
TALENT_LABELS = {"normal": "Normal Attack", "skill": "Elemental Skill", "burst": "Elemental Burst"}
ASCENSION_LEVELS = (20, 40, 50, 60, 70, 80)
PANEL_PROPS = {2000: "hp", 2001: "atk", 2002: "def", 28: "em", 23: "er", 20: "cr", 22: "cd", 26: "heal", 30: "phys"}
BASE_CR, BASE_CD, BASE_ER = 5.0, 50.0, 100.0
PERCENT_STATS = {"hp_pct", "atk_pct", "def_pct", "er", "cr", "cd", "dmg", "dmg_other", "heal", "phys"}
SUBSTATS = ("hp", "atk", "def", "hp_pct", "atk_pct", "def_pct", "em", "er", "cr", "cd")
CHOOSABLE = ("sands", "goblet", "circlet")
NONE_SENTENCE = "No researched card yet; these are defaults."

_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def number(text: Any) -> float:
    """A number as HoYoLAB writes it ("20152.4", "79.4%", "1,234"); 0 when there is none."""
    found = _NUMBER.search(str(text if text is not None else ""))
    return float(found.group(0).replace(",", "")) if found else 0.0


def stat_of(prop: int | None, element: str) -> str | None:
    """The stat key of a HoYoLAB property id. An element's DMG Bonus is `dmg` for her own element and `dmg_other` for any
    other."""
    if prop is None:
        return None
    key = PROP_KEYS.get(prop)
    if key == "dmg":
        return "dmg" if ELEMENT_DMG_PROPS.get(element) == prop else "dmg_other"
    return key


def stat_text(stat: str, value: float) -> str:
    """A stat as the game shows it: a percentage with one decimal, anything else as a whole number with thousands."""
    return f"{value:.1f}%" if stat in PERCENT_STATS else f"{round(value):,}"


# ------------------------------------------------------------------------------------------------ builds

_BONUS_A = re.compile(r"increases? the level of (.+?) by (\d+)", re.IGNORECASE)
_BONUS_B = re.compile(r"(.+?) gains? (\d+) levels?", re.IGNORECASE)


def talent_bonuses(constellation: int, page: CharacterPage | None) -> dict[str, int]:
    """The levels her constellations add to each talent, read from the constellations' texts ("Increases the Level of
    Elemental Skill: X by 3", or "Her Normal Attack gains 3 levels"): only the constellations she has count."""
    bonus = {kind: 0 for kind in TALENTS}
    if page is None:
        return bonus
    names = {kind: name.lower() for kind, name, _icon, _text in page.talents if kind in TALENTS and name}
    for number_, (name, _icon, text) in enumerate(page.constellations, 1):
        if number_ > constellation:
            break
        found = _BONUS_A.search(text) or _BONUS_B.search(text)
        if found is None:
            continue
        what, amount = found.group(1).lower(), int(found.group(2))
        kind = next((k for k, label in TALENT_LABELS.items() if label.lower() in what), None)
        kind = kind or next((k for k, named in names.items() if named in what), None)
        if kind is not None:
            bonus[kind] += amount
    return bonus


def ascension_of(record: Mapping[str, Any], page: CharacterPage | None) -> int:
    """How many times she has ascended. HoYoLAB gives none: at a level that ends a phase (20, 40 ... 80) she may be before
    or after her ascension, and her base HP says which (the wiki's HP before it, at her level, or after it, at the next);
    the lower is taken when the wiki cannot tell."""
    level = int(record["level"])
    lowest = sum(1 for limit in ASCENSION_LEVELS if level > limit)
    if level not in ASCENSION_LEVELS or page is None:
        return lowest
    hp = next((number(p["base"]) for p in record["props"] if int(p["prop"]) == 2000), 0.0)
    before, after = page.own.get(level, {}).get("hp"), page.own.get(level + 1, {}).get("hp")
    if hp and before and after and abs(hp - after) < abs(hp - before):
        return lowest + 1
    return lowest


def _prop(record: Mapping[str, Any], element: str) -> dict[str, tuple[float, float]]:
    """Base and added value of each stat of the panel, by stat key."""
    wanted = {**PANEL_PROPS, ELEMENT_DMG_PROPS.get(element, -1): "dmg"}
    found: dict[str, tuple[float, float]] = {}
    for item in record.get("props", ()):
        key = wanted.get(int(item["prop"]))
        if key is not None and key not in found:
            found[key] = (number(item["base"]), number(item["add"]))
    return found


def talent_skills(skills: Any) -> dict[str, Mapping[str, Any]]:
    """The skill records of the three talents with levels, by kind. HoYoLAB's skill types are read as 1, 2 and 3 for the
    Normal Attack, Skill and Burst; but when three or more skills are of type 1, type 1 is taken to mark the talents with
    levels (and a sprint, for some) and type 2 the passives, so the first is the Normal Attack, the second the Skill and
    the last the Burst. To be checked against a real answer in P2."""
    skills = [skill for skill in skills if isinstance(skill, Mapping)]
    actives = [skill for skill in skills if int(skill["skill_type"]) == 1]
    if len(actives) >= 3:
        return {"normal": actives[0], "skill": actives[1], "burst": actives[-1]}
    found: dict[str, Mapping[str, Any]] = {}
    for skill in skills:
        kind = KIND_OF_SKILL.get(int(skill["skill_type"]))
        if kind is not None:
            found[kind] = skill
    return found


def build_of(record: Mapping[str, Any], element: str, weapon_type: str, page: CharacterPage | None) -> Build:
    """A HoYoLAB build (a BuildRecord as the group's document keeps it) as an engine Build."""
    key = slug(str(record["name"]))
    constellation = int(record["constellation"])
    bonus = talent_bonuses(constellation, page)
    talents = {kind: 1 for kind in TALENTS}
    for kind, skill in talent_skills(record.get("skills", ())).items():
        talents[kind] = int(skill["level"])
    for kind in TALENTS:
        if not bonus[kind] and talents[kind] > 10:
            bonus[kind] = talents[kind] - 10   # a level past 10 is her constellations' however the text reads
        talents[kind] = max(1, talents[kind] - bonus[kind])
    raw_weapon = record.get("weapon")
    weapon = None
    if raw_weapon and raw_weapon.get("name"):
        sub_prop = raw_weapon.get("sub_prop")
        weapon = WeaponState(
            key=slug(str(raw_weapon["name"])), name=str(raw_weapon["name"]), icon=raw_weapon.get("icon") or None,
            type=weapon_type, rarity=int(raw_weapon["rarity"]), level=int(raw_weapon["level"]),
            refinement=int(raw_weapon["refinement"]), base_atk=number(raw_weapon["base_atk"]),
            sub=stat_of(sub_prop, element), sub_value=number(raw_weapon.get("sub_value")),
        )
    pieces: dict[str, Piece] = {}
    for item in record.get("pieces", ()):
        slot = SLOT_OF_POS.get(int(item["pos"]))
        if slot is None or slot in pieces:
            continue
        main = stat_of(int(item["main_prop"]), element) or "hp"
        pieces[slot] = Piece(
            slot=slot, set_key=slug(str(item["set_name"])), set_name=str(item["set_name"]), name=str(item["name"]),
            icon=item.get("icon") or None, level=int(item["level"]), rarity=int(item["rarity"]), main=main,
            main_value=number(item["main_value"]),
            subs=tuple(
                Sub(stat, number(sub["value"]), int(sub["times"]) + 1)
                for sub in item.get("subs", ()) for stat in [stat_of(int(sub["prop"]), element)] if stat is not None
            ),
        )
    panel = _prop(record, element)
    return Build(
        key=key, level=int(record["level"]), ascension=ascension_of(record, page), constellation=constellation,
        talents=talents, bonus=bonus, weapon=weapon,
        pieces={slot: pieces[slot] for slot in SLOTS if slot in pieces},
        base={stat: values[0] for stat, values in panel.items()},
        add={stat: values[1] for stat, values in panel.items()},
    )


def own_stats(build: Build, page: CharacterPage | None) -> dict[str, float]:
    """Hers at her level, as `stats.split` takes it: her base HP, ATK (without the weapon's) and DEF as HoYoLAB gives them,
    and Crit Rate 5, Crit DMG 50 and Energy Recharge 100 with her ascension stat's bonus, which the wiki gives at the phase
    she is in (before ascending at a level that ends a phase, after it at the next)."""
    own = {
        "hp": build.base.get("hp", 0.0),
        "atk": build.base.get("atk", 0.0) - (build.weapon.base_atk if build.weapon else 0.0),
        "def": build.base.get("def", 0.0),
        "cr": BASE_CR, "cd": BASE_CD, "er": BASE_ER,
    }
    if page is None or not page.ascension_stat:
        return own
    stat = stat_key(page.ascension_stat)
    row = _phase_row(page, build)
    if stat is None or stat not in row:
        return own
    bonus = row[stat]
    if stat in ("hp_pct", "atk_pct", "def_pct"):
        base_stat = stat[:-4]
        own[base_stat] += own[base_stat] * bonus / 100
    else:
        own[stat] = own.get(stat, 0.0) + bonus
    return own


def _phase_row(page: CharacterPage, build: Build) -> dict[str, float]:
    """The wiki's row for the phase she is in: level 1's before any ascension, else the level that starts the phase (the
    wiki keeps the row after an ascension under the next level), and level 90's for the last."""
    phase = max(0, min(build.ascension, 6))
    start = 1 if phase == 0 else ASCENSION_LEVELS[phase - 1] + 1
    for level in (start, 90):
        if level in page.own and (level == start or phase == 6):
            return page.own[level]
    below = [level for level in page.own if level <= build.level]
    return page.own[max(below)] if below else {}


# ------------------------------------------------------------------------------------------------ a card without research

ROLE_OF_ASCENSION = {"cr": "damage", "cd": "damage", "heal": "healer", "hp_pct": "protector"}
SCALING_OF_ASCENSION = {"hp_pct": "hp", "def_pct": "def", "em": "em"}
DEFAULT_GOALS = {
    "damage": {"cr": 70.0, "cd": 140.0, "er": 110.0},
    "healer": {"er": 140.0},
    "protector": {"er": 140.0},
    "support": {"er": 160.0},
}
DEFAULT_MAINS = {
    "damage": {"sands": ("atk_pct",), "goblet": ("dmg",), "circlet": ("cr", "cd")},
    "healer": {"sands": ("er", "hp_pct"), "goblet": ("hp_pct",), "circlet": ("heal", "hp_pct")},
    "protector": {"sands": ("er", "hp_pct"), "goblet": ("hp_pct",), "circlet": ("hp_pct",)},
    "support": {"sands": ("er", "atk_pct"), "goblet": ("atk_pct",), "circlet": ("atk_pct", "cr")},
}


def role_of(card: Card) -> str:
    """The role whose defaults a card takes: damage when it is one of hers, else the first she has, else support."""
    if "damage" in card.roles:
        return "damage"
    return card.roles[0] if card.roles and card.roles[0] in DEFAULT_GOALS else "support"


def with_default_goals(card: Card) -> Card:
    """A researched card whose sources gave no goal for a stat the role's defaults name takes the role's default for it; a goal
    the card gives stays as it is (the controller's ruling of 2026-10-30)."""
    missing = {stat: goal for stat, goal in DEFAULT_GOALS[role_of(card)].items() if stat not in card.goals}
    return dataclasses.replace(card, goals={**card.goals, **missing}) if missing else card


def fallback_card(
    key: str, name: str, element: str, weapon_type: str, rarity: int, ascension_stat: str, refs: Refs, *, early: bool = False
) -> Card:
    """The card a character has when the research has none (the design's section 5): her role from her ascension stat (crit
    is a damage dealer, Healing Bonus a healer, HP a protector, anything else a support), partners from the reactions, and
    goals from the role's defaults. It says so in its confidence, "none"."""
    stat = stat_key(ascension_stat)
    role = ROLE_OF_ASCENSION.get(stat or "", "support")
    scaling = SCALING_OF_ASCENSION.get(stat or "", "atk")
    if role in ("healer", "protector"):
        scaling = "hp" if stat in ("heal", "hp_pct") else scaling
    wants = {"atk": ("atk_pct", "atk"), "hp": ("hp_pct", "hp"), "def": ("def_pct", "def"), "em": ("em",)}[scaling]
    weights = {stat_: "none" for stat_ in SUBSTATS}
    weights[wants[0]] = "wants"
    for extra in wants[1:]:
        weights[extra] = "some"
    weights["cr"] = weights["cd"] = "wants" if role == "damage" else "some"
    weights["er"] = "some" if role == "damage" else "wants"
    goals = dict(DEFAULT_GOALS[role])  # the role's defaults, which a researched card's missing goals take as well
    damage = role == "damage"
    reacts = refs.reactions.get(element, ())
    return Card(
        key=key, name=name, element=element, weapon_type=weapon_type, rarity=rarity, pronouns=("they", "them", "their"),
        roles=(role,), keeps_alive=role in ("healer", "protector"), scaling=scaling,
        damage_talent="normal" if damage else "skill",
        talent_priority=("normal", "skill", "burst") if damage else ("skill", "burst", "normal"),
        talent_table="elemental", goals=goals, mains={slot: stats for slot, stats in DEFAULT_MAINS[role].items()},
        weights=weights, sets=(), weapons=(), partners=tuple(reacts[:2]), partner_roles=(), teams=(), notes=NONE_SENTENCE,
        confidence="none", early=early, stars=None, chart_size=None, edited=frozenset(),
    )


# ------------------------------------------------------------------------------------------------ the player's edits to a card

EDITABLE = (
    "roles", "keeps_alive", "scaling", "damage_talent", "talent_priority", "talent_table", "goals", "mains", "weights",
    "sets", "weapons", "partners", "partner_roles", "pronouns",
)
ROLES = ("damage", "support", "healer", "protector")
SCALINGS = ("atk", "hp", "def", "em")
PRONOUNS = (("she", "her", "her"), ("he", "him", "his"), ("they", "them", "their"))
WEIGHTS = ("wants", "some", "none")
PRONOUN_OBJECT_KEYS = ("she", "her", "hers")


class CardRefused(ValueError):
    """An edit that is not a field of a card, or whose value the card cannot hold."""


def _strings(value: Any, allowed: Sequence[str] | None = None, *, many: bool = True) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)) or not all(isinstance(item, str) for item in value):
        raise CardRefused
    if allowed is not None and not all(item in allowed for item in value):
        raise CardRefused
    return tuple(value)


def coerce_edit(field: str, value: Any) -> Any:
    """One edited field as the card holds it, from its JSON; CardRefused when the card cannot hold it."""
    if field == "roles":
        return _strings(value, ROLES)
    if field == "keeps_alive":
        if not isinstance(value, bool):
            raise CardRefused
        return value
    if field == "scaling":
        if value not in SCALINGS:
            raise CardRefused
        return value
    if field in ("damage_talent",):
        if value not in TALENTS:
            raise CardRefused
        return value
    if field == "talent_table":
        if value not in ("elemental", "physical"):
            raise CardRefused
        return value
    if field == "talent_priority":
        order = _strings(value, TALENTS)
        if sorted(order) != sorted(TALENTS):
            raise CardRefused
        return order
    if field == "goals":
        if not isinstance(value, dict) or not all(
            isinstance(k, str) and isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100000
            for k, v in value.items()
        ):
            raise CardRefused
        return {k: float(v) for k, v in value.items()}
    if field == "mains":
        if not isinstance(value, dict) or not all(slot in CHOOSABLE for slot in value):
            raise CardRefused
        return {slot: _strings(stats) for slot, stats in value.items()}
    if field == "weights":
        if not isinstance(value, dict) or not all(isinstance(k, str) and v in WEIGHTS for k, v in value.items()):
            raise CardRefused
        return dict(value)
    if field == "sets":
        if not isinstance(value, list):
            raise CardRefused
        choices = []
        for item in value:
            if not isinstance(item, dict) or set(item) != {"sets", "pieces"} or item["pieces"] not in ("4", "2+2"):
                raise CardRefused
            choices.append(SetChoice(_strings(item["sets"]), item["pieces"]))
        return tuple(choices)
    if field in ("weapons", "partner_roles"):
        return _strings(value)
    if field == "partners":
        return _strings(value, ELEMENTS)
    if field == "pronouns":
        if isinstance(value, dict) and set(value) == set(PRONOUN_OBJECT_KEYS):
            value = [value[k] for k in PRONOUN_OBJECT_KEYS]
        if not isinstance(value, (list, tuple)) or tuple(value) not in PRONOUNS:
            raise CardRefused
        return tuple(value)
    raise CardRefused


def jsonable(field: str, value: Any) -> Any:
    """An edited field as it is kept: JSON."""
    if field == "sets":
        return [{"sets": list(choice.sets), "pieces": choice.pieces} for choice in value]
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return {k: list(v) if isinstance(v, tuple) else v for k, v in value.items()}
    return value


def apply_edits(card: Card, edits: Mapping[str, Any]) -> Card:
    """The card with the player's edits on it, each marked as theirs. An edit the card cannot hold (a kept one from an older
    version) is left out. The goals are edited one by one: an edit names the goals it changes, and the card's others, and the
    role's defaults, stay."""
    changes: dict[str, Any] = {}
    for field, value in edits.items():
        if field not in EDITABLE:
            continue
        try:
            changes[field] = coerce_edit(field, value)
        except CardRefused:
            continue
        if field == "goals":
            changes[field] = {**card.goals, **changes[field]}
    if not changes:
        return card
    return dataclasses.replace(card, **changes, edited=frozenset(changes))


# ------------------------------------------------------------------------------------------------ a plan as it is kept

PLAN_LEVEL = "Choose a level from 1 to 90."
PLAN_TALENTS = "Choose talent levels from 1 to 10."
PLAN_REFINEMENT = "Choose a refinement from 1 to 5."
PLAN_SUBSTATS = "Give each substat as a number from 0 to 100."
PLAN_SHAPE = "This request does not have the expected shape."


class PlanRefused(ValueError):
    """A plan the page sent that cannot be kept, with the sentence that says why."""


def _int_in(value: Any, low: int, high: int, sentence: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise PlanRefused(sentence)
    return value


def plan_from_json(body: Any) -> tuple[Plan, dict[str, str] | None]:
    """A PlanBody as the page sends it, as a Plan and the weights it carries (those belong to the card). PlanRefused says
    what is wrong in a sentence."""
    if not isinstance(body, dict):
        raise PlanRefused(PLAN_SHAPE)
    talents = body.get("talents")
    if not isinstance(talents, dict) or set(talents) != set(TALENTS):
        raise PlanRefused(PLAN_TALENTS)
    kept_talents = {kind: _int_in(talents[kind], 1, 10, PLAN_TALENTS) for kind in TALENTS}
    level = _int_in(body.get("level"), 1, 90, PLAN_LEVEL)
    weapon_level = _int_in(body.get("weapon_level"), 1, 90, PLAN_LEVEL)
    refinement = _int_in(body.get("refinement"), 1, 5, PLAN_REFINEMENT)
    weapon = body.get("weapon")
    if weapon is not None and (not isinstance(weapon, str) or len(weapon) > 100):
        raise PlanRefused(PLAN_SHAPE)
    chosen = body.get("set")
    set_choice = None
    if chosen is not None:
        if (
            not isinstance(chosen, dict) or set(chosen) != {"sets", "pieces"} or chosen["pieces"] not in ("4", "2+2")
            or not isinstance(chosen["sets"], list) or not 1 <= len(chosen["sets"]) <= 2
            or not all(isinstance(item, str) and len(item) <= 100 for item in chosen["sets"])
        ):
            raise PlanRefused(PLAN_SHAPE)
        set_choice = SetChoice(tuple(chosen["sets"]), chosen["pieces"])
    mains = body.get("mains", {})
    if not isinstance(mains, dict) or not all(
        slot in CHOOSABLE and isinstance(stat, str) and len(stat) <= 20 for slot, stat in mains.items()
    ):
        raise PlanRefused(PLAN_SHAPE)
    pieces = body.get("level_pieces", [])
    if not isinstance(pieces, list) or not all(piece in SLOTS for piece in pieces):
        raise PlanRefused(PLAN_SHAPE)
    typed = body.get("typed")
    typed_piece = None
    if typed is not None:
        if not isinstance(typed, dict) or set(typed) != {"slot", "main", "subs", "use"}:
            raise PlanRefused(PLAN_SHAPE)
        if typed["slot"] not in SLOTS or not isinstance(typed["main"], str) or not isinstance(typed["use"], bool):
            raise PlanRefused(PLAN_SHAPE)
        subs = typed["subs"]
        if not isinstance(subs, list) or len(subs) > 4:
            raise PlanRefused(PLAN_SUBSTATS)
        kept = []
        for item in subs:
            if (
                not isinstance(item, (list, tuple)) or len(item) != 2 or not isinstance(item[0], str)
                or isinstance(item[1], bool) or not isinstance(item[1], (int, float)) or not 0 <= item[1] <= 100
                or (item[1] != item[1])
            ):
                raise PlanRefused(PLAN_SUBSTATS)
            kept.append((item[0], float(item[1])))
        typed_piece = TypedPiece(slot=typed["slot"], main=typed["main"], subs=tuple(kept), use=typed["use"])
    weights = body.get("weights")
    if weights is not None and (
        not isinstance(weights, dict) or not all(isinstance(k, str) and v in WEIGHTS for k, v in weights.items())
    ):
        raise PlanRefused(PLAN_SHAPE)
    plan = Plan(
        level=level, talents=kept_talents, weapon=weapon, weapon_level=weapon_level, refinement=refinement,
        set=set_choice, mains=dict(mains), level_pieces=tuple(dict.fromkeys(pieces)), typed=typed_piece,
    )
    return plan, (dict(weights) if weights is not None else None)


def plan_to_json(plan: Plan) -> dict[str, Any]:
    """A Plan as it is kept and sent (a PlanBody without the weights, which the card holds)."""
    return {
        "level": plan.level, "talents": dict(plan.talents), "weapon": plan.weapon, "weapon_level": plan.weapon_level,
        "refinement": plan.refinement,
        "set": None if plan.set is None else {"sets": list(plan.set.sets), "pieces": plan.set.pieces},
        "mains": dict(plan.mains), "level_pieces": list(plan.level_pieces),
        "typed": None if plan.typed is None else {
            "slot": plan.typed.slot, "main": plan.typed.main, "subs": [[stat, value] for stat, value in plan.typed.subs],
            "use": plan.typed.use,
        },
    }
