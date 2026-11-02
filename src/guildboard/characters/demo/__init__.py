"""The demo's Characters (the Characters plan, Task V3): fifteen owned characters with the mockups' names, elements and weapon
types, their cards, builds and wiki entries, a focus of four, and the endgame and calendar records of a month. Sandrone's build
is the mockups' exactly; the others' are made to stand about as ready as the mockups show them.

It is apart from the researched cards (the plan's call 1): research can never move the demo's numbers. It bundles no picture of the game's (`pictures.json`
keeps each one's key and address, for a later website); the art cache serves none in the demo, whose pages show the drawn signs.
Nothing here reaches the internet; the wiki's entries are kept in the store from `wiki.json`, and the cards are `cards.json`."""
from __future__ import annotations

import dataclasses
import json
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from guildboard.characters import bridge, needs, reference
from guildboard.characters.models import Card
from guildboard.gameday import game_day, game_day_start, server_tz
from guildboard.records import (
    AbyssHalfRecord, BuildRecord, BuildsRecord, CalcItemRecord, CalculatorRecord, CalendarDetailRecord, EndgameDetailRecord,
    PieceRecord, PropRecord, SkillRecord, StygianBossRecord, SubRecord, WeaponRecord,
)
from guildboard.store import Store, WikiEntryRow

FOLDER = Path(__file__).parent


@lru_cache(maxsize=1)
def _stories() -> dict[str, list[dict[str, Any]]]:
    return json.loads((FOLDER / "stories.json").read_text(encoding="utf-8"))


def pity_story(key: str) -> list[dict[str, Any]]:
    """The copies of a 5-star character the demo's story gives her, oldest first, as `Profile.pity` has them. The demo's wish
    history (the Pulls page's, whose numbers the Pulls tests and pictures pin) holds none of the characters the mockups show, so
    the Story pane and the pity pill would be empty without these; they are not wishes, and the Pulls page never shows them."""
    return [dict(entry) for entry in _stories().get(key, [])]


FOCUS = ("sandrone", "odette", "alyosha", "jahoda")
SEEDED = "characters_demo_seeded"
DAY_RESIN = (200, 200, 3)   # a demo day begins with full resin and the three weekly discounts, as the mockups' week does
# What the focus plans: where each differs from the card's default (the mockup's week), as (level, talents).
PLANS = {
    "odette": (90, {"normal": 8, "skill": 9, "burst": 9}),
    "alyosha": (80, {"normal": 6, "skill": 6, "burst": 6}),
    "jahoda": (75, {"normal": 7, "skill": 8, "burst": 7}),
}
PLENTY = 9_999_999
THEATER_TEXT = "Characters of Cryo, Electro and Anemo are boosted this month."
SECOND_HALF = ("sandrone", "ineffa", "lan-yan", "jahoda")   # the second half of floor 12, where a star was lost


def _read(name: str) -> Any:
    return json.loads((FOLDER / name).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _cards() -> dict[str, Card]:
    stars = reference.load_stars()
    return {key: reference.parse_card(raw, stars.get(key)) for key, raw in _read("cards.json").items()}


def demo_card(key: str) -> Card | None:
    """The demo's card for one of its characters; None for any other."""
    return _cards().get(key)


@lru_cache(maxsize=1)
def demo_builds() -> BuildsRecord:
    """The fifteen builds, as HoYoLAB's records."""
    records = []
    for raw in _read("builds.json")["builds"]:
        pieces = tuple(
            PieceRecord(**{**piece, "subs": tuple(SubRecord(**sub) for sub in piece["subs"])}) for piece in raw["pieces"]
        )
        records.append(BuildRecord(**{
            **raw, "weapon": WeaponRecord(**raw["weapon"]), "pieces": pieces,
            "skills": tuple(SkillRecord(**skill) for skill in raw["skills"]),
            "props": tuple(PropRecord(**prop) for prop in raw["props"]),
        }))
    return BuildsRecord(tuple(records), {})


def _ids() -> dict[str, int]:
    return {bridge.slug(record.name): record.id for record in demo_builds().builds}


def demo_calculator() -> CalculatorRecord:
    """What the batch calculator says for the focus: with sync on, how many of each material are missing."""
    ids = _ids()
    item = iter(range(1, 100))
    make = lambda name, amount, lacking: CalcItemRecord(next(item), name, "", amount, lacking)   # noqa: E731
    items = {
        ids["sandrone"]: (
            make("Philosophies of Vagrancy", 16, 6), make("Precision Drive Shaft", 12, 0), make("Madman's Restraint", 2, 1),
            make("Crown of Insight", 1, 0), make("Mora", 700000, 0),
        ),
        ids["odette"]: (make("Philosophies of Charity", 14, 14), make("Twisted Withered Branch", 1, 1), make("Mora", 15000, 0)),
        ids["alyosha"]: (
            make("Severed Tail of the Sky-Roamer", 7, 7), make("Flockingweed", 23, 23), make("Character EXP", PLENTY, 0),
            make("Mora", PLENTY, 0),
        ),
        ids["jahoda"]: (make("Ascended Sample: Knight", 1, 1), make("Philosophies of Vagrancy", 10, 0), make("Mora", 12000, 0)),
    }
    return CalculatorRecord(has_user_info=True, items=items, targets={ids[key]: {"level": 90} for key in FOCUS})


def demo_endgame_detail(now: datetime, server: str) -> EndgameDetailRecord:
    """This month's endgame: 33 of 36 stars with the one lost in 12-3's second half, and three Stygian bosses."""
    ids = _ids()
    local = now.astimezone(server_tz(server))
    ends = (local.replace(day=1, hour=4, minute=0, second=0, microsecond=0) + timedelta(days=32)).replace(day=1)
    stamp = (ends - timedelta(seconds=1)).isoformat(timespec="seconds")
    halves = (
        AbyssHalfRecord("12-3", 1, 3, tuple(ids[key] for key in ("nefer", "dahlia", "lauma", "columbina")), ()),
        AbyssHalfRecord("12-3", 2, 2, tuple(ids[key] for key in SECOND_HALF), ()),
    )
    bosses = (
        StygianBossRecord("Guardian Blade of Drifting Snow", ("Pyro",), ("Cryo",), (), None),
        StygianBossRecord("Fae of Crystalline Flesh", ("Cryo", "Hydro"), ("Dendro",), (), None),
        StygianBossRecord("Chimeric Winged Lion", ("Dendro",), ("Hydro",), (), None),
    )
    return EndgameDetailRecord(
        abyss_stars=33, abyss_halves=halves, abyss_ends=stamp, theater_difficulty="Arcana Challenge", theater_acts=10,
        theater_ends=stamp, stygian_difficulty=5, stygian_bosses=bosses, stygian_ends=stamp,
    )


def demo_calendar_detail(now: datetime, server: str) -> CalendarDetailRecord:
    """The Theater's words, and one banner running now."""
    day = game_day(now, server)
    start, end = game_day_start(day - timedelta(days=11), server), game_day_start(day + timedelta(days=9), server)
    banner = (("Escoffier",), start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds"))
    return CalendarDetailRecord(theater_text=THEATER_TEXT, banners=(banner,))


def seed(store: Store, uid: int, now: datetime) -> None:
    """Once per demo folder: the focus of four with the plans the mockups' week uses, and the wiki's entries of the demo's
    characters, weapon, set and materials."""
    if store.meta(SEEDED) is not None:
        return
    with store.transaction():
        for ident, entry in _read("wiki.json")["entries"].items():
            store.put_wiki_entry(WikiEntryRow(ident, entry["kind"], entry["name"], entry["data"], "demo", now))
        records = {bridge.slug(r.name): r for r in demo_builds().builds}
        for key, (level, talents) in PLANS.items():
            card = demo_card(key)
            assert card is not None
            raw = dataclasses.asdict(records[key])
            build = bridge.build_of(raw, card.element, card.weapon_type, None)
            plan = needs.default_plan(build, card)
            plan = dataclasses.replace(
                plan, level=level, talents=talents, weapon_level=build.weapon.level if build.weapon else 1,
                refinement=1, set=None, mains={slot: piece.main for slot, piece in build.pieces.items() if slot in bridge.CHOOSABLE},
                level_pieces=(),
            )
            store.put_char_plan(uid, key, bridge.plan_to_json(plan), now)
        store.put_focus(uid, list(FOCUS))
        store.set_meta(SEEDED, now.isoformat())
