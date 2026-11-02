"""The Characters tests' samples: the mockups' example characters, as models. Every engine
test uses them. The numbers are those of the Characters mockups, which are not part of this repository; a change to one
changes what every engine test expects. Pictures are None: a model carries an address only where the service gives one.

Stat keys are the contract's STATS: the mockup's atkp, hpp and defp are atk_pct, hp_pct and def_pct."""
from __future__ import annotations

from datetime import date

from guildboard.characters.models import (
    Build, Card, Effect, Flower, FocusInput, Member, Need, Piece, Refs, SetChoice, SetRef, Source, Sub, WeaponRef,
    WeaponState,
)
from guildboard.metrics import slug
from guildboard.records import StygianBossRecord

SHADOW = "disenchantment-in-deep-shadow"
TEASPOON = "a-teaspoon-of-transcendence"

# What the profile shows for sandrone_build(): HoYoLAB's final values.
SANDRONE_PANEL = {"hp": 20152.4, "atk": 2964.1, "def": 814.0, "em": 59.0, "cr": 79.4, "cd": 176.5, "er": 122.7, "dmg": 0.0}


def _piece(slot: str, name: str, level: int, main: str, main_value: float, subs: list[tuple[str, float, int]]) -> Piece:
    return Piece(
        slot=slot, set_key=SHADOW, set_name="Disenchantment in Deep Shadow", name=name, icon=None, level=level, rarity=5,
        main=main, main_value=main_value, subs=tuple(Sub(stat, value, rolls) for stat, value, rolls in subs),
    )


def sandrone_build() -> Build:
    """Her example build: level 90, C2, the Teaspoon at R1, and the five pieces of planner.html's NOW_PIECES, the Plume at
    +16. Each substat's rolls are the count the mockup gives (times + 1)."""
    pieces = {
        "flower": _piece("flower", "Iridescence That Ceased Amidst Glory", 20, "hp", 4780.0,
                         [("cd", 21.8, 3), ("cr", 10.5, 3), ("atk_pct", 9.9, 2), ("er", 5.2, 1)]),
        "plume": _piece("plume", "Sharpness That Ceased Upon Wondrous Creation", 16, "atk", 258.0,
                        [("cd", 13.2, 2), ("cr", 7.0, 2), ("er", 11.0, 2), ("hp", 538.0, 2)]),
        "sands": _piece("sands", "Moment That Ceased Upon Waking From Grand Dreams", 20, "atk_pct", 46.6,
                        [("cd", 28.0, 4), ("cr", 6.6, 2), ("em", 19.0, 1), ("def", 23.0, 1)]),
        "goblet": _piece("goblet", "Ovations That Ceased Upon Festivity", 20, "atk_pct", 46.6,
                         [("def", 39.0, 2), ("hp_pct", 9.9, 2), ("em", 40.0, 2), ("atk", 33.0, 2)]),
        "circlet": _piece("circlet", "Pendulum That Ceased Amidst a Great Fall", 20, "cr", 31.1,
                          [("cd", 19.4, 3), ("atk_pct", 14.0, 3), ("er", 6.5, 1), ("hp", 299.0, 1)]),
    }
    weapon = WeaponState(
        key=TEASPOON, name="A Teaspoon of Transcendence", icon=None, type="Claymore", rarity=5, level=90, refinement=1,
        base_atk=674.0, sub="cd", sub_value=44.1,
    )
    # HoYoLAB's base and added values: base["atk"] holds her 342 and the weapon's 674, and base + add is the panel.
    base = {"hp": 13226.0, "atk": 1016.0, "def": 752.0, "em": 0.0, "er": 100.0, "cr": 24.2, "cd": 50.0, "dmg": 0.0, "heal": 0.0}
    add = {"hp": 6926.4, "atk": 1948.1, "def": 62.0, "em": 59.0, "er": 22.7, "cr": 55.2, "cd": 126.5, "dmg": 0.0, "heal": 0.0}
    return Build(
        key="sandrone", level=90, ascension=6, constellation=2,
        talents={"normal": 9, "skill": 10, "burst": 10}, bonus={"normal": 0, "skill": 0, "burst": 0},
        weapon=weapon, pieces=pieces, base=base, add=add,
    )


def sandrone_own() -> dict[str, float]:
    """Hers at her level, from the wiki: ATK 342, HP 13,226, DEF 752, Crit Rate 5 + 19.2 from ascension, Crit DMG 50, ER 100."""
    return {"atk": 342.0, "hp": 13226.0, "def": 752.0, "cr": 24.2, "cd": 50.0, "er": 100.0}


def sandrone_card() -> Card:
    """Her researched card as the mockups use it: planner.html's goals, WANTS and main stats."""
    return Card(
        key="sandrone", name="Sandrone", element="Cryo", weapon_type="Claymore", rarity=5,
        pronouns=("she", "her", "her"), roles=("damage",), keeps_alive=False, scaling="atk",
        damage_talent="normal", talent_priority=("normal", "skill", "burst"), talent_table="elemental",
        goals={"cr": 75.0, "cd": 200.0, "er": 130.0, "dmg": 46.6, "atk": 2600.0},
        mains={"sands": ("atk_pct",), "goblet": ("dmg",), "circlet": ("cr", "cd")},
        weights={
            "cr": "wants", "cd": "wants", "atk_pct": "wants", "er": "wants", "em": "some", "atk": "some",
            "hp_pct": "none", "hp": "none", "def_pct": "none", "def": "none",
        },
        sets=(SetChoice(sets=(SHADOW,), pieces="4"),),
        weapons=(TEASPOON, "verdict", "a-thousand-blazing-suns"),
        partners=("Electro", "Anemo"), partner_roles=(), teams=(), notes="", confidence="high", early=False,
        stars=None, chart_size=None, edited=frozenset(),
    )


# ------------------------------------------------------------------------------------------------ the references

# Elemental DMG multipliers for levels 1 to 15. The mockup gives only levels 9 and 10 (TAL: 1.70 and 1.80); the others
# continue them in steps of 0.1, as stand-ins that no test pins.
SCALING = tuple(round(0.9 + 0.1 * index, 2) for index in range(15))  # index 8 is level 9: 1.70, then level 10: 1.80
# Elements that react with each, from endgame.html's REACTS.
REACTIONS = {
    "Cryo": ("Electro", "Hydro", "Anemo", "Pyro"),
    "Electro": ("Hydro", "Cryo", "Dendro", "Pyro", "Anemo"),
    "Hydro": ("Electro", "Dendro", "Cryo", "Pyro"),
    "Dendro": ("Hydro", "Electro", "Pyro"),
    "Pyro": ("Hydro", "Cryo", "Electro", "Dendro"),
    "Anemo": ("Pyro", "Hydro", "Electro", "Cryo"),
    "Geo": ("Geo",),
}


def refs_sample() -> Refs:
    """The four weapons and the sets of planner.html with their effects, and its MAIN, AVG_ROLL and TAL tables."""
    cond = "After her Skill or Burst, for 6s"
    weapons = {
        TEASPOON: WeaponRef(
            key=TEASPOON, name="A Teaspoon of Transcendence", type="Claymore", rarity=5, base_atk_90=674.0, sub="cd",
            sub_90=44.1, effects=(Effect("atk_pct", (28.0, 35.0, 42.0, 49.0, 56.0), "always", ""),),
            icon=None,
        ),
        "verdict": WeaponRef(
            key="verdict", name="Verdict", type="Claymore", rarity=5, base_atk_90=674.0, sub="cr", sub_90=22.1,
            effects=(Effect("atk_pct", (20.0, 25.0, 30.0, 35.0, 40.0), "always", ""),),
            icon=None,
        ),
        "a-thousand-blazing-suns": WeaponRef(
            key="a-thousand-blazing-suns", name="A Thousand Blazing Suns", type="Claymore", rarity=5, base_atk_90=741.0,
            sub="cr", sub_90=11.0,
            effects=(
                Effect("cd", (20.0, 25.0, 30.0, 35.0, 40.0), "met", cond),
                Effect("atk_pct", (28.0, 35.0, 42.0, 49.0, 56.0), "met", cond),
            ),
            icon=None,
        ),
        "gest-of-the-mighty-wolf": WeaponRef(
            key="gest-of-the-mighty-wolf", name="Gest of the Mighty Wolf", type="Claymore", rarity=5, base_atk_90=608.0,
            sub="cr", sub_90=33.1, effects=(),
            icon=None,
        ),
    }
    sets = {
        SHADOW: SetRef(
            key=SHADOW, name="Disenchantment in Deep Shadow", two=(Effect("atk_pct", (18.0,), "always", ""),),
            four=(Effect("cr", (16.0,), "met", "against opponents affected by Superconduct"),),
            icons={},
        ),
        "scarlet-proof": SetRef(
            key="scarlet-proof", name="Scarlet Proof", two=(Effect("atk_pct", (18.0,), "always", ""),),
            four=(Effect("cr", (16.0,), "met", "after she triggers Stellar Swirl"),),
            icons={},
        ),
        "blizzard-strayer": SetRef(
            key="blizzard-strayer", name="Blizzard Strayer", two=(Effect("dmg", (15.0,), "always", ""),),
            four=(Effect("cr", (20.0,), "met", "against opponents affected by Cryo"),),
            icons={},
        ),
    }
    mains_20 = {
        "hp": 4780.0, "atk": 311.0, "atk_pct": 46.6, "er": 51.8, "em": 187.0, "hp_pct": 46.6, "def_pct": 58.3,
        "dmg": 46.6, "cr": 31.1, "cd": 62.2,
    }
    main_odds = {
        "flower": {"hp": 1.0},
        "plume": {"atk": 1.0},
        "sands": {"atk_pct": 0.2666, "er": 0.10, "em": 0.10, "hp_pct": 0.2668, "def_pct": 0.2666},
        "goblet": {"dmg": 0.05, "atk_pct": 0.1925, "em": 0.025, "hp_pct": 0.1925, "def_pct": 0.19},
        "circlet": {"cr": 0.10, "cd": 0.10, "atk_pct": 0.22, "em": 0.04, "hp_pct": 0.22, "def_pct": 0.22},
    }
    sub_weights = {
        "hp": 6, "atk": 6, "def": 6, "hp_pct": 4, "atk_pct": 4, "def_pct": 4, "er": 4, "em": 4, "cr": 3, "cd": 3,
    }
    roll_avg = {
        "cr": 3.3, "cd": 6.6, "atk_pct": 4.96, "atk": 16.5, "er": 5.5, "em": 19.8, "hp_pct": 4.96, "hp": 254.0,
        "def_pct": 6.2, "def": 19.7,
    }
    flowers = {
        slug(name): Flower(key=slug(name), name=name, places=places, per_pass=per_pass)
        for name, places, per_pass in (
            ("Flockingweed", "Fellfrost Peak", 14), ("Frostfairy Flower", "near Snezhnograd", 16),
            ("Portable Bearing", "near Blue Amber Lake", 12), ("Frostlamp Flower", "the Final Night Cemetery", 15),
            ("Golden Fern", "Flamefeather Valley", 14),
        )
    }
    return Refs(
        weapons=weapons, sets=sets,
        yields={"books": 1.17, "boss": 2.5, "artifact_5star": 1.065},
        mains_20=mains_20, main_odds=main_odds, sub_weights=sub_weights, roll_avg=roll_avg,
        scaling={"elemental": SCALING, "physical": SCALING}, reactions=REACTIONS, flowers=flowers,
    )


# ------------------------------------------------------------------------------------------------ the week

WEEK_TODAY = date(2026, 10, 25)  # a Sunday
WEEK_RESIN_NOW = 200
WEEK_RESIN_MAX = 200

# Where each material comes from, as week.html's MATS has it. Weekdays are Python's (Monday 0), and a book's domain
# opens on Sundays too, as the wiki's text says.
VAGRANCY = Source("books", "Overturned Roost", (2, 5, 6))
CHARITY = Source("books", "Relics of the Frozen Grace", (0, 3, 6))
DOCTOR = Source("weekly", "The Doctor", ())
IL_DOTTORE = Source("weekly", "Il Dottore", ())
GATE = Source("weekly", "The Game Before the Gate", ())
LIONS = Source("boss", "Chimeric Winged Lions", ())
FELLFROST = Source("flowers", "Fellfrost Peak", ())


def _need(name: str, amount: int, source: Source) -> Need:
    """What is still missing for a goal, with nothing known about what is held."""
    return Need(material=slug(name), name=name, icon=None, amount=amount, held=None, exact=True, source=source)


def week_focus() -> tuple[FocusInput, ...]:
    """The four FocusInputs of week.html's default focus. Play them from WEEK_TODAY with WEEK_RESIN_NOW of WEEK_RESIN_MAX."""
    return (
        FocusInput(
            key="sandrone", name="Sandrone", pronouns=("she", "her", "her"),
            goal="Normal Attack 10, and a Cryo DMG Bonus goblet",
            needs=(_need("Madman's Restraint", 1, DOCTOR), _need("Philosophies of Vagrancy", 7, VAGRANCY)),
            luck=(("Cryo DMG Bonus goblet", 0.00554),),
        ),
        FocusInput(
            key="odette", name="Odette", pronouns=("she", "her", "her"), goal="Elemental Skill and Burst 9",
            needs=(_need("Twisted Withered Branch", 1, IL_DOTTORE), _need("Philosophies of Charity", 14, CHARITY)),
            luck=(),
        ),
        FocusInput(
            key="alyosha", name="Alyosha", pronouns=("she", "her", "her"), goal="Level 80",
            needs=(_need("Severed Tail of the Sky-Roamer", 7, LIONS), _need("Flockingweed", 23, FELLFROST)),
            luck=(),
        ),
        FocusInput(
            key="jahoda", name="Jahoda", pronouns=("she", "her", "her"), goal="Elemental Skill 8",
            needs=(_need("Ascended Sample: Knight", 1, GATE), _need("Philosophies of Vagrancy", 10, VAGRANCY)),
            luck=(),
        ),
    )


# ------------------------------------------------------------------------------------------------ the endgame

ENDGAME_PRONOUN_HE = ("dahlia", "durin")
ENDGAME_SOURCE = (
    # (name, element, ascension stat, ready now, ready after the focus plans, what the card adds)
    ("Sandrone", "Cryo", "CRIT Rate", 78, 91, {"wants": ("Electro", "Anemo")}),
    ("Odette", "Cryo", "CRIT DMG", 64, 80, {}),
    ("Alyosha", "Electro", "Energy Recharge", 52, 70, {}),
    ("Jahoda", "Anemo", "Healing Bonus", 70, 80, {}),
    ("Vesna", "Anemo", "CRIT Rate", 40, 40, {}),
    ("Columbina", "Hydro", "CRIT Rate", 82, 82, {"role": "support"}),
    ("Nefer", "Dendro", "CRIT DMG", 88, 88, {"wants": ("Hydro", "Dendro")}),
    ("Lauma", "Dendro", "Elemental Mastery", 80, 80, {}),
    ("Ineffa", "Electro", "CRIT Rate", 76, 76, {"role": "support", "keeps": True}),
    ("Aino", "Hydro", "Elemental Mastery", 60, 60, {}),
    ("Dahlia", "Hydro", "HP", 58, 58, {}),
    ("Iansan", "Electro", "ATK", 66, 66, {}),
    ("Lan Yan", "Anemo", "ATK", 72, 72, {"role": "protector"}),
    ("Durin", "Pyro", "CRIT DMG", 45, 45, {}),
    ("Linnea", "Geo", "CRIT Rate", 30, 30, {}),
)
# The role the wiki's ascension stat gives, unless the researched card says otherwise (design section 5).
ROLE_FROM_ASCENSION = {
    "CRIT Rate": "damage", "CRIT DMG": "damage", "Healing Bonus": "healer", "HP": "protector",
    "Energy Recharge": "support", "ATK": "support", "Elemental Mastery": "support",
}


def endgame_roster(after: bool = False) -> list[Member]:
    """The fifteen Members of endgame.html's R, in its order. `after` takes the readiness each has once the focus's plans
    are done instead of the readiness now."""
    members = []
    for name, element, ascension, now, planned, card in ENDGAME_SOURCE:
        role = card.get("role", ROLE_FROM_ASCENSION[ascension])
        members.append(Member(
            key=slug(name), name=name, element=element, roles=(role,),
            keeps_alive=role in ("healer", "protector") or bool(card.get("keeps")),
            wants=tuple(card.get("wants", REACTIONS[element][:2])), ready=planned if after else now,
        ))
    return members


def endgame_bosses() -> tuple[StygianBossRecord, ...]:
    """The three Stygian bosses of endgame.html: the elements that do well and badly against each."""
    return (
        StygianBossRecord("Guardian Blade of Drifting Snow", ("Pyro",), ("Cryo",), (), None),
        StygianBossRecord("Fae of Crystalline Flesh", ("Cryo", "Hydro"), ("Dendro",), (), None),
        StygianBossRecord("Chimeric Winged Lion", ("Dendro",), ("Hydro",), (), None),
    )


# ------------------------------------------------------------------------------------------------ the wiki (Part W)

# The wiki's answers of 2026-10-29, trimmed to what Guild Board reads (tests/characters_wiki_entries.json, cut by hand from
# the wiki's own pages; no test reaches HoYoLAB): the entries Sandrone (10920), A Teaspoon of Transcendence (10949),
# Disenchantment in Deep Shadow (10760), Philosophies of Vagrancy (8590), Madman's Restraint (9192) and Flockingweed
# (11337), and the English names of the Teaspoon's materials, which the wiki wrote in Japanese on its page.
def _wiki_recorded() -> dict:
    import json
    from pathlib import Path

    return json.loads((Path(__file__).with_name("characters_wiki_entries.json")).read_text(encoding="utf-8"))


WIKI_RECORDED = _wiki_recorded()
WIKI_MATERIAL_NAMES: dict[str, str] = WIKI_RECORDED.pop("_names")


def wiki_entry_answer(entry_page_id: str) -> bytes:
    """The wiki's answer for one entry, as entry_page gives it. A material the Teaspoon costs, which was not kept whole,
    answers with a page that holds its name; an entry the wiki lacks answers 404, as it does."""
    import json

    if entry_page_id in WIKI_RECORDED:
        return json.dumps(WIKI_RECORDED[entry_page_id], ensure_ascii=False).encode("utf-8")
    if entry_page_id in WIKI_MATERIAL_NAMES:
        page = {"id": entry_page_id, "name": WIKI_MATERIAL_NAMES[entry_page_id], "icon_url": "", "menu_id": "9",
                "filter_values": {}, "modules": []}
        return json.dumps({"retcode": 0, "message": "OK", "data": {"page": page}}).encode("utf-8")
    return b'{"data":null,"message":"not found","retcode":404}'
