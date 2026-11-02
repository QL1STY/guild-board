"""What the Characters service's tests stand on: a HoYoLAB build as the group's document keeps it (made from the samples'
models, which is the bridges' inverse), the wiki's recorded entries kept in a store, a Pulls planner that gives fixed fives, and
a service on all of them."""
from __future__ import annotations

import asyncio
import dataclasses
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

import characters_samples as samples
from guildboard.characters import bridge
from guildboard.characters.art import ArtCache
from guildboard.characters.models import Build, Card
from guildboard.characters.service import Characters
from guildboard.characters.stats import ELEMENT_DMG_PROPS, PROP_KEYS
from guildboard.characters.wiki import ENTRY_URL, CharacterWiki
from guildboard.config import AppPaths
from guildboard.events import EventBus
from guildboard.pulls.rules import FiveStar, PoolState, Wish
from guildboard.records import (
    BuildRecord, BuildsRecord, CalcItemRecord, CalculatorRecord, CharactersRecord, PieceRecord, PropRecord, SkillRecord,
    SubRecord, WeaponRecord,
)

UID = 700
SERVER = "os_euro"
PROP_OF = {
    "hp": 2, "atk": 5, "def": 8, "hp_pct": 3, "atk_pct": 6, "def_pct": 9, "em": 28, "er": 23, "cr": 20, "cd": 22,
    "heal": 26, "phys": 30,
}
PANEL_OF = {"hp": 2000, "atk": 2001, "def": 2002, "em": 28, "er": 23, "cr": 20, "cd": 22, "heal": 26, "phys": 30}
WEAPON_TYPE_ID = {"Sword": 1, "Catalyst": 10, "Claymore": 11, "Bow": 12, "Polearm": 13}


def _text(stat: str, value: float) -> str:
    return f"{value}%" if stat in bridge.PERCENT_STATS else f"{value:g}"


def build_record(
    build: Build, *, ident: int = 1, name: str = "Sandrone", element: str = "Cryo", wiki_entry: str | None = "10920",
    weapon_type: str = "Claymore",
) -> BuildRecord:
    """A Build as the HoYoLAB record it came from."""
    prop = lambda stat: ELEMENT_DMG_PROPS[element] if stat == "dmg" else PROP_OF[stat]   # noqa: E731
    weapon = build.weapon
    pieces = tuple(
        PieceRecord(
            pos=index + 1, name=piece.name, icon="", set_id=1, set_name=piece.set_name, rarity=piece.rarity,
            level=piece.level, main_prop=prop(piece.main), main_value=_text(piece.main, piece.main_value),
            subs=tuple(SubRecord(prop(sub.stat), _text(sub.stat, sub.value), sub.rolls - 1) for sub in piece.subs),
        )
        for index, slot in enumerate(("flower", "plume", "sands", "goblet", "circlet")) if (piece := build.pieces.get(slot))
    )
    stats = {*build.base, *build.add}
    props = tuple(
        PropRecord(
            ELEMENT_DMG_PROPS[element] if stat == "dmg" else PANEL_OF[stat], str(build.base.get(stat, 0.0)),
            str(build.add.get(stat, 0.0)), str(build.base.get(stat, 0.0) + build.add.get(stat, 0.0)),
        )
        for stat in sorted(stats)
    )
    return BuildRecord(
        id=ident, name=name, element=element, rarity=5, level=build.level, ascension=build.ascension,
        constellation=build.constellation, icon="", wiki_entry=wiki_entry,
        weapon=WeaponRecord(
            id=ident * 10, name=weapon.name, icon="", type=WEAPON_TYPE_ID[weapon_type], rarity=weapon.rarity, level=weapon.level,
            refinement=weapon.refinement, ascension=6, base_atk=f"{weapon.base_atk:g}",
            sub_prop=PROP_OF[weapon.sub] if weapon.sub else None, sub_value=_text(weapon.sub, weapon.sub_value) if weapon.sub else None,
        ),
        pieces=pieces,
        skills=tuple(
            SkillRecord(ident * 100 + n, n, kind, "", build.talents[kind] + build.bonus[kind])
            for n, kind in enumerate(("normal", "skill", "burst"), 1)
        ),
        props=props,
    )


def keep_builds(store, now: datetime, records: list[BuildRecord], calculator: CalculatorRecord | None = None) -> None:
    """The characters group's latest document, as a sync keeps it (through JSON, as the store does)."""
    record = CharactersRecord(owned=len(records), level90=0, builds=BuildsRecord(tuple(records), {}), calculator=calculator)
    store.set_latest_doc("characters", now, json.loads(json.dumps(dataclasses.asdict(record))))


def calculator(has_user_info: bool = True, character: int = 1) -> CalculatorRecord:
    """What the batch calculator says for Sandrone's Normal Attack 9 to 10: 9 of 16 Philosophies of Vagrancy held, 1 of 2 of
    Madman's Restraint, the rest in full."""
    items = (
        CalcItemRecord(1, "Philosophies of Vagrancy", "", 16, 7 if has_user_info else 0),
        CalcItemRecord(2, "Precision Drive Shaft", "", 12, 0),
        CalcItemRecord(3, "Madman's Restraint", "", 2, 1 if has_user_info else 0),
        CalcItemRecord(4, "Crown of Insight", "", 1, 0),
        CalcItemRecord(5, "Mora", "", 700000, 0),
    )
    return CalculatorRecord(has_user_info=has_user_info, items={character: items}, targets={character: {"level": 90}})


class Wiki:
    """Stands in for netpolicy.fetch_hoyoverse: the recorded entries."""

    def __call__(self, url: str, *, headers=None, body=None) -> bytes:
        assert url.startswith(ENTRY_URL)
        return samples.wiki_entry_answer(url[len(ENTRY_URL):])


async def keep_wiki(wiki: CharacterWiki) -> None:
    """Sandrone, her Teaspoon, her set and three materials, as the wiki gave them."""
    for entry, kind in (
        ("10920", "character"), ("10949", "weapon"), ("10760", "set"), ("8590", "material"), ("9192", "material"),
        ("11337", "material"),
    ):
        await wiki.entry(entry, kind)


class Pulls:
    """Pulls' planner as far as the Characters pages read it: an account, and its pools' 5-stars."""

    def __init__(self, fives: tuple[tuple[str, str, int, str, datetime], ...] = ()) -> None:
        self.fives = fives

    def uid(self) -> int:
        return UID

    def account_uid(self) -> int:
        return UID

    def states(self, uid: int) -> dict[str, PoolState]:
        fives = tuple(
            FiveStar(Wish(index, pool, "301", name, "character", 5, at), pity, result)
            for index, (pool, name, pity, result, at) in enumerate(self.fives)
        )
        return {"character": PoolState(
            pool="character", pity=0, known=True, four=0, four_known=True, guarantee="fifty", fives=fives,
            wishes=len(fives), path_item="", path_points=None, last_five=None,
        )}


def card_for(key: str, card: Card | None = None) -> Card | None:
    return card if key == "sandrone" else None


def make_service(
    store, clock, tmp_path: Path, *, cards: Callable[[str], Card | None] | None = None, pulls: Pulls | None = None,
    refs=None, art: ArtCache | None = None, **kwargs: Any,
) -> Characters:
    paths = AppPaths(tmp_path / "data")
    wiki = CharacterWiki(store, clock, Wiki(), lambda: "7.1")
    return Characters(
        store, clock, EventBus(), wiki, art or ArtCache(store, paths, clock, None, False), pulls or Pulls(), lambda: SERVER,
        lambda: UID, False, refs=refs or samples.refs_sample(),
        cards=cards or (lambda key: samples.sandrone_card() if key == "sandrone" else None), **kwargs,
    )


def keep_notes(store, at: datetime, resin: int = 200, discounts: int = 3) -> None:
    store.set_latest_doc("notes", at, {
        "resin": resin, "resin_max": 200, "resin_full_at": None, "boss_discounts_left": discounts,
    })


SUNDAY = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)   # 09:00 on Sunday on the Europe server
