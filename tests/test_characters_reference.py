"""The Characters reference files (src/guildboard/reference/characters/): each matches its schema, every card is of a
character in the inventory, and the loaders read them into the contract's models. Part R fills the files; this holds them
to their shape, empty as Task 1 writes them or filled."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import characters_samples as samples
import json_schema
from guildboard.characters import reference
from guildboard.characters.models import Card, Refs

FOLDER = Path(__file__).resolve().parents[1] / "src" / "guildboard" / "reference" / "characters"
SCHEMAS = FOLDER / "schema"
FILES = {
    "inventory.json": "inventory", "stars.json": "stars", "weapons.json": "weapons", "sets.json": "sets",
    "tables.json": "tables", "flowers.json": "flowers",
}


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _schema(name: str) -> dict:
    return _read(SCHEMAS / f"{name}.schema.json")


def test_every_reference_file_matches_its_schema_and_every_card_is_in_the_inventory():
    assert {path.name for path in SCHEMAS.glob("*.json")} == {f"{name}.schema.json" for name in [*FILES.values(), "card"]}
    for file, name in FILES.items():
        assert json_schema.problem_with(_read(FOLDER / file), _schema(name)) is None, file
    inventory = _read(FOLDER / "inventory.json")
    known = {character["key"] for character in inventory["characters"]}
    cards = sorted((FOLDER / "cards").glob("*.json"))
    for path in cards:
        card = _read(path)
        assert json_schema.problem_with(card, _schema("card")) is None, path.name
        assert card["key"] == path.stem, f"{path.name} holds the card of {card['key']}"
        assert card["key"] in known, f"{path.name} is not a character of the inventory"
    assert (FOLDER / "cards" / ".gitkeep").exists() or cards  # the folder is kept while it holds no card


def test_the_schemas_refuse_what_does_not_fit_them():
    card = _schema("card")
    good = {
        "key": "sandrone", "name": "Sandrone", "element": "Cryo", "weapon_type": "Claymore", "rarity": 5,
        "pronouns": ["she", "her", "her"], "roles": ["damage"], "keeps_alive": False, "scaling": "atk",
        "damage_talent": "normal", "talent_priority": ["normal", "skill", "burst"], "talent_table": "elemental",
        "goals": {"cr": 75}, "mains": {"sands": ["atk_pct"]}, "weights": {"cr": "wants"},
        "sets": [{"sets": ["disenchantment-in-deep-shadow"], "pieces": "4"}],
        "weapons": ["a-teaspoon-of-transcendence"], "partners": ["Electro"], "partner_roles": [], "teams": [],
        "notes": "", "confidence": "high", "early": False,
        "sources": [{"url": "https://example.test/a", "checked": "2026-10-25"}], "checked": "2026-10-25",
    }
    assert json_schema.problem_with(good, card) is None
    bad = [
        {**good, "element": "Plasma"}, {**good, "rarity": 3}, {**good, "confidence": "certain"},
        {**good, "weights": {"cr": "lots"}}, {**good, "goals": {"crit": 75}}, {**good, "pronouns": ["she", "her"]},
        {**good, "sets": [{"sets": ["x"], "pieces": "3"}]}, {**good, "mains": {"flower": ["hp"]}},
        {k: v for k, v in good.items() if k != "notes"}, {**good, "invented": 1},
    ]
    for document in bad:
        assert json_schema.problem_with(document, card) is not None, document
    stars = _schema("stars")
    assert json_schema.problem_with({"sandrone": {"size": [900, 900], "points": [[1, 2]] * 6}}, stars) is None
    assert json_schema.problem_with({"sandrone": {"size": [900, 900], "points": [[1, 2]] * 5}}, stars) is not None
    assert json_schema.problem_with({"characters": [{"key": "x"}], "weapons": [], "sets": []}, _schema("inventory")) is not None


def test_the_exp_tables_count_from_level_1_and_never_fall():
    # `needs.amounts` takes a climb as the difference of two entries, so each column is cumulative: index n is the EXP
    # from level 1 to n. A per-level column would give wildly wrong amounts.
    tables = _read(FOLDER / "tables.json")
    columns = {"exp": tables["exp"], **{f"weapon_exp {rarity}": column for rarity, column in tables["weapon_exp"].items()}}
    for name, column in columns.items():
        if not column:
            continue  # empty as Task 1 writes it
        assert all(a <= b for a, b in zip(column, column[1:])), name
        assert column[1] == 0, f"{name}: level 1 needs no EXP"


def test_each_chart_has_six_distinct_stars_inside_it_and_each_is_of_a_character_of_the_inventory():
    stars = _read(FOLDER / "stars.json")
    known = {character["key"] for character in _read(FOLDER / "inventory.json")["characters"]}
    assert stars  # the research filled it
    for key, entry in stars.items():
        assert key in known, key
        width, height = entry["size"]
        assert width > 0 and height > 0, key
        points = entry["points"]
        assert len(points) == 6, key
        assert all(0 <= x < width and 0 <= y < height for x, y in points), f"{key}: a star lies outside its chart"
        for index, (x, y) in enumerate(points):
            for other_x, other_y in points[index + 1:]:
                # A star's icon on the page is 92 of 900 across, so two icons this close to each other would still be told apart.
                assert (x - other_x) ** 2 + (y - other_y) ** 2 >= (max(width, height) * 30 / 900) ** 2, f"{key}: two stars are one"


def test_a_missing_card_gives_none_and_the_files_load_into_the_contracts_models():
    # Part R fills the files, so this holds what loads, not that it is empty.
    assert reference.load_card("nobody-at-all") is None
    inventory = reference.load_inventory()
    assert set(inventory) == {"characters", "weapons", "sets"}
    assert all(isinstance(inventory[kind], list) for kind in inventory)
    assert isinstance(reference.load_stars(), dict)
    refs = reference.load_refs()
    assert isinstance(refs, Refs)
    assert all(isinstance(part, dict) for part in (refs.weapons, refs.sets, refs.flowers, refs.yields, refs.scaling))
    assert reference.load_refs() is reference.load_refs()  # read once


def test_a_card_file_is_read_into_a_card_with_its_stars():
    raw = {
        "key": "sandrone", "name": "Sandrone", "element": "Cryo", "weapon_type": "Claymore", "rarity": 5,
        "pronouns": ["she", "her", "her"], "roles": ["damage"], "keeps_alive": False, "scaling": "atk",
        "damage_talent": "normal", "talent_priority": ["normal", "skill", "burst"], "talent_table": "elemental",
        "goals": {"cr": 75, "cd": 200, "er": 130, "dmg": 46.6, "atk": 2600},
        "mains": {"sands": ["atk_pct"], "goblet": ["dmg"], "circlet": ["cr", "cd"]},
        "weights": {
            "cr": "wants", "cd": "wants", "atk_pct": "wants", "er": "wants", "em": "some", "atk": "some",
            "hp_pct": "none", "hp": "none", "def_pct": "none", "def": "none",
        },
        "sets": [{"sets": ["disenchantment-in-deep-shadow"], "pieces": "4"}],
        "weapons": ["a-teaspoon-of-transcendence", "verdict", "a-thousand-blazing-suns"],
        "partners": ["Electro", "Anemo"], "partner_roles": [], "teams": [], "notes": "", "confidence": "high",
        "early": False, "sources": [], "checked": "2026-10-25",
    }
    card = reference.parse_card(raw, None)
    assert card == samples.sandrone_card()  # sources and checked are the file's, not the card's
    points = [[288, 250], [450, 197], [597, 237], [594, 583], [450, 733], [292, 578]]
    with_stars = reference.parse_card(raw, {"size": [900, 900], "points": points})
    assert isinstance(with_stars, Card) and with_stars.stars == tuple((x, y) for x, y in points)
    assert with_stars.chart_size == (900, 900)  # the stars are in this chart's pixels, and a chart may be of any size
    assert reference.parse_card(raw, None).chart_size is None
    # A card with teams: each is (name, members).
    teamed = reference.parse_card({**raw, "teams": [{"name": "Melt", "members": ["sandrone", "*healer"]}]}, None)
    assert teamed.teams == (("Melt", ("sandrone", "*healer")),)


def test_the_tables_weapons_sets_and_flowers_are_read_into_the_references():
    refs = reference.parse_refs(
        weapons={"weapons": {"verdict": {
            "name": "Verdict", "type": "Claymore", "rarity": 5, "base_atk_90": 674, "sub": "cr", "sub_90": 22.1,
            "effects": [{"stat": "atk_pct", "values": [20, 25, 30, 35, 40], "when": "always", "condition": ""}],
            "icon": "https://example.test/verdict.png",
        }}, "checked": None, "sources": []},
        sets={"sets": {"scarlet-proof": {
            "name": "Scarlet Proof", "two": [{"stat": "atk_pct", "values": [18], "when": "always", "condition": ""}],
            "four": [], "icons": {"flower": "https://example.test/f.png"},
        }}, "checked": None, "sources": []},
        tables={
            "yields": {"books": 1.17}, "mains_20": {"cr": 31.1}, "main_odds": {"goblet": {"dmg": 0.05}},
            "sub_weights": {"cr": 3}, "roll_avg": {"cr": 3.3}, "scaling": {"elemental": [1.0] * 15},
            "reactions": {"Cryo": ["Electro"]}, "exp": [], "weapon_exp": {}, "checked": None, "sources": [],
        },
        flowers={"flowers": {"flockingweed": {"name": "Flockingweed", "places": "Fellfrost Peak", "per_pass": 14}},
                 "checked": None, "sources": []},
    )
    weapon = refs.weapons["verdict"]
    assert (weapon.key, weapon.base_atk_90, weapon.effects[0].values) == ("verdict", 674.0, (20.0, 25.0, 30.0, 35.0, 40.0))
    assert weapon.icon == "https://example.test/verdict.png"  # the wiki's address; the service gives the app's
    assert refs.sets["scarlet-proof"].two[0].stat == "atk_pct" and refs.sets["scarlet-proof"].icons["flower"].endswith("f.png")
    assert refs.yields == {"books": 1.17} and refs.scaling == {"elemental": (1.0,) * 15}
    assert refs.reactions == {"Cryo": ("Electro",)} and refs.main_odds == {"goblet": {"dmg": 0.05}}
    assert refs.flowers["flockingweed"].per_pass == 14
