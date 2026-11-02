"""The Characters reference files (src/guildboard/reference/characters/), loaded into the contract's models, as
pulls/rules.load_reference loads the wish rules: each is read once, through importlib.resources, and what is read is
never changed. Part R fills the files, and tests/test_characters_reference.py holds them to their schemas. A card the
research has not written gives None, and the service then falls back as the design's section 5 says."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from importlib import resources
from typing import Any, Mapping

from guildboard.characters.models import Card, Effect, Flower, Refs, SetChoice, SetRef, WeaponRef

FOLDER = ("reference", "characters")
KEY = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")  # what metrics.slug gives: a card's file is named by it


def _read(*parts: str) -> Any:
    text = resources.files("guildboard").joinpath(*FOLDER, *parts).read_text(encoding="utf-8")
    return json.loads(text)


@lru_cache(maxsize=1)
def load_inventory() -> dict[str, Any]:
    """Every character, weapon and set the research found: {"characters": [...], "weapons": [...], "sets": [...]}."""
    return _read("inventory.json")


@lru_cache(maxsize=1)
def load_tables() -> dict[str, Any]:
    """tables.json as it is: the yields, the odds, the scaling and the EXP tables (`exp`, and `weapon_exp` by rarity)."""
    return _read("tables.json")


@lru_cache(maxsize=1)
def load_stars() -> dict[str, Any]:
    """Each character's six constellation stars on the chart: key -> {"size": [w, h], "points": [[x, y], ...]}."""
    return _read("stars.json")


@lru_cache(maxsize=None)
def load_card(key: str) -> Card | None:
    """The researched card of a character, with its constellation stars; None when there is no card."""
    if KEY.fullmatch(key) is None:
        return None
    file = resources.files("guildboard").joinpath(*FOLDER, "cards", f"{key}.json")
    if not file.is_file():
        return None
    return parse_card(json.loads(file.read_text(encoding="utf-8")), load_stars().get(key))


@lru_cache(maxsize=None)
def load_card_meta(key: str) -> tuple[tuple[str, ...], str | None]:
    """What a card file says beside the card: the addresses of its sources, and the day it was checked. Nothing for a
    character with no card."""
    if KEY.fullmatch(key) is None:
        return (), None
    file = resources.files("guildboard").joinpath(*FOLDER, "cards", f"{key}.json")
    if not file.is_file():
        return (), None
    raw = json.loads(file.read_text(encoding="utf-8"))
    return tuple(str(source["url"]) for source in raw.get("sources", ())), raw.get("checked")


@lru_cache(maxsize=1)
def load_refs() -> Refs:
    """The weapons' and sets' effects, the tables and the flowers, as the engines read them."""
    return parse_refs(
        weapons=_read("weapons.json"), sets=_read("sets.json"), tables=_read("tables.json"),
        flowers=_read("flowers.json"),
    )


def _effects(raw: list[Mapping[str, Any]]) -> tuple[Effect, ...]:
    return tuple(
        Effect(e["stat"], tuple(float(v) for v in e["values"]), e["when"], e.get("condition", "")) for e in raw
    )


def parse_card(raw: Mapping[str, Any], stars: Mapping[str, Any] | None) -> Card:
    """A card file's JSON as a Card. `sources` and `checked` belong to the file, and the card keeps neither; `stars` is
    the character's entry of stars.json, or None."""
    pronouns = tuple(raw["pronouns"])
    return Card(
        key=raw["key"], name=raw["name"], element=raw["element"], weapon_type=raw["weapon_type"], rarity=raw["rarity"],
        pronouns=(pronouns[0], pronouns[1], pronouns[2]), roles=tuple(raw["roles"]), keeps_alive=raw["keeps_alive"],
        scaling=raw["scaling"], damage_talent=raw["damage_talent"],
        talent_priority=(raw["talent_priority"][0], raw["talent_priority"][1], raw["talent_priority"][2]),
        talent_table=raw["talent_table"], goals={k: float(v) for k, v in raw["goals"].items()},
        mains={slot: tuple(stat_keys) for slot, stat_keys in raw["mains"].items()}, weights=dict(raw["weights"]),
        sets=tuple(SetChoice(tuple(choice["sets"]), choice["pieces"]) for choice in raw["sets"]),
        weapons=tuple(raw["weapons"]), partners=tuple(raw["partners"]), partner_roles=tuple(raw["partner_roles"]),
        teams=tuple((team["name"], tuple(team["members"])) for team in raw["teams"]), notes=raw["notes"],
        confidence=raw["confidence"], early=raw["early"],
        stars=None if stars is None else tuple((int(x), int(y)) for x, y in stars["points"]),
        chart_size=None if stars is None else (int(stars["size"][0]), int(stars["size"][1])), edited=frozenset(),
    )


def parse_refs(
    *, weapons: Mapping[str, Any], sets: Mapping[str, Any], tables: Mapping[str, Any], flowers: Mapping[str, Any]
) -> Refs:
    """The four reference files' JSON as Refs. A weapon's or a set's `icon` stays the wiki's address, which the service
    turns into the art cache's."""
    return Refs(
        weapons={
            key: WeaponRef(
                key=key, name=w["name"], type=w["type"], rarity=w["rarity"], base_atk_90=float(w["base_atk_90"]),
                sub=w.get("sub"), sub_90=float(w.get("sub_90", 0.0)), effects=_effects(w["effects"]),
                icon=w.get("icon"),
            )
            for key, w in weapons["weapons"].items()
        },
        sets={
            key: SetRef(
                key=key, name=s["name"], two=_effects(s["two"]), four=_effects(s["four"]), icons=dict(s.get("icons", {})),
            )
            for key, s in sets["sets"].items()
        },
        yields={k: float(v) for k, v in tables["yields"].items()},
        mains_20={k: float(v) for k, v in tables["mains_20"].items()},
        main_odds={slot: {k: float(v) for k, v in odds.items()} for slot, odds in tables["main_odds"].items()},
        sub_weights={k: int(v) for k, v in tables["sub_weights"].items()},
        roll_avg={k: float(v) for k, v in tables["roll_avg"].items()},
        scaling={k: tuple(float(v) for v in values) for k, values in tables["scaling"].items()},
        reactions={k: tuple(values) for k, values in tables["reactions"].items()},
        flowers={
            key: Flower(key=key, name=f["name"], places=f["places"], per_pass=int(f["per_pass"]))
            for key, f in flowers["flowers"].items()
        },
    )
