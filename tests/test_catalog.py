import hashlib
import json
from importlib import resources

import pytest

from achievement_samples import SMALL_LIST, list_bytes
from guildboard.achievements.catalog import (
    CatalogError, bundled_catalog, bundled_raw, diff_catalogs, parse_catalog, version_key,
)


def test_a_list_is_read_with_its_categories_tiers_and_commission_details():
    catalog = parse_catalog(list_bytes(SMALL_LIST))
    assert [c.name for c in catalog.categories] == [
        "Wonders of the World", "Challenger: Series II", "Mortal Travails: Series I",
    ]
    assert [(s.id, s.order, s.reward) for s in catalog.group(80127)] == [(80127, 1, 5), (80128, 2, 10), (80129, 3, 20)]
    assert catalog.stage(80129).group == 80127
    assert catalog.stage(80001).group == 80001 and catalog.stage(80001).order == 1
    pirates = catalog.stage(84508)
    assert pirates.region == "liyue"
    assert pirates.quests == ("Pirate Invasion, in Liyue Harbor!",)
    assert pirates.parts == ("Little Meng", "Little Lulu", "Little Fei")
    assert len(catalog.stages) == 11 and catalog.version == "7.1"
    assert catalog.stage(12345) is None and catalog.category("2").name == "Challenger: Series II"


def test_the_bundled_list_is_the_pinned_file_from_paimon_moe():
    source = json.loads(resources.files("guildboard").joinpath("reference", "achievements.source.json").read_text("utf-8"))
    assert hashlib.sha256(bundled_raw()).hexdigest() == source["sha256"]
    assert source["sha256"] == "c73a4db729e836f58c80f5670bdaf5564a5a019129b59e4e7146d6a62d450199"
    catalog = bundled_catalog()
    assert (len(catalog.stages), len(catalog.categories), catalog.version) == (1854, 73, "7.1")
    assert [s.id for s in catalog.group(82055)] == [82055, 82056, 82057]


def _one(stage) -> bytes:
    return list_bytes({"0": {"name": "A", "order": 1, "achievements": [stage]}})


STAGE = {"id": 1, "name": "x", "desc": "d", "reward": 5, "ver": "1.0"}
SHAPE = "The achievement list does not have the expected shape."


@pytest.mark.parametrize("raw, message", [
    (b"{not json", "The achievement list is not valid JSON."),
    (b"<!DOCTYPE html><title>404</title>", "The achievement list is not valid JSON."),
    (b"[]", SHAPE),
    (b"{}", SHAPE),
    (list_bytes({"0": {"order": 1, "achievements": [STAGE]}}), SHAPE),
    (list_bytes({"0": {"name": "A", "achievements": [STAGE]}}), SHAPE),
    (list_bytes({"0": {"name": "A", "order": True, "achievements": [STAGE]}}), SHAPE),
    (list_bytes({"0": {"name": "A", "order": 1}}), SHAPE),
    (list_bytes({"0": {"name": "A", "order": 1, "achievements": {"1": STAGE}}}), SHAPE),
    (_one([]), SHAPE),
    (_one("x"), SHAPE),
    (_one({"name": "x", "desc": "d", "reward": 5, "ver": "1.0"}), "An achievement in the list has no number."),
    (_one({"id": True, "name": "x", "desc": "d", "reward": 5, "ver": "1.0"}),
     "An achievement in the list has no number."),
    (_one({"id": 1, "desc": "d", "reward": 5, "ver": "1.0"}), "Achievement 1 is missing its name."),
    (_one({"id": 1, "name": "x", "reward": 5, "ver": "1.0"}), "Achievement 1 is missing its description."),
    (_one({"id": 1, "name": "x", "desc": "d", "reward": "5", "ver": "1.0"}), "Achievement 1 is missing its reward."),
    (_one({"id": 1, "name": "x", "desc": "d", "reward": 5}), "Achievement 1 is missing its version."),
    (_one({**STAGE, "checklist": "ab"}), SHAPE),
    (_one({**STAGE, "commissions": 5}), SHAPE),
    (_one({**STAGE, "quest": {"id": ["x"]}}), SHAPE),
    (_one({**STAGE, "quest": ["x"]}), SHAPE),
    (list_bytes({"0": {"name": "A", "order": 1, "achievements": [
        {"id": 1, "name": "x", "desc": "d", "reward": 5, "ver": "1.0"},
        {"id": 1, "name": "y", "desc": "d", "reward": 5, "ver": "1.0"},
    ]}}), "Achievement 1 appears twice."),
], ids=[
    "not JSON", "a web page", "a list", "nothing in it", "a category without a name", "a category without an order",
    "a category whose order is true", "a category without achievements", "achievements that are not a list",
    "an empty tier", "a stage that is not an object", "a stage without an id", "a stage whose id is true",
    "a stage without a name", "a stage without a description", "a reward that is text", "a stage without a version",
    "a checklist that is text", "commissions that are not text", "a quest without names", "a quest that is a list",
    "an id twice",
])
def test_a_damaged_list_is_refused_with_a_sentence(raw, message):
    with pytest.raises(CatalogError) as error:
        parse_catalog(raw)
    assert str(error.value) == message


def test_half_of_an_emoji_becomes_a_replacement_mark_in_every_text_the_list_keeps():
    # In the bytes, \ud83d is JSON's escape for half of an emoji. Python reads it as a lone surrogate, which no answer
    # can carry. A whole emoji, both halves, stays as it is.
    raw = list_bytes({"0@": {"name": "Wonders@", "order": 1, "achievements": [
        {"id": 1, "name": "Pirates@", "desc": "Play \U0001F600", "reward": 5, "ver": "1.0@", "commissions": "liyue@",
         "quest": {"name": ["Pirate Invasion@"]}, "checklist": ["Little Meng@"]},
    ]}}).replace(b"@", b"\\ud83d")
    catalog = parse_catalog(raw)
    [category], [stage] = catalog.categories, catalog.stages
    assert (category.key, category.name, stage.category) == ("0\ufffd", "Wonders\ufffd", "0\ufffd")
    assert (stage.name, stage.description, stage.version, stage.region) == (
        "Pirates\ufffd", "Play \U0001F600", "1.0\ufffd", "liyue\ufffd",
    )
    assert (stage.quests, stage.parts) == (("Pirate Invasion\ufffd",), ("Little Meng\ufffd",))


def test_versions_compare_as_numbers():
    assert version_key("7.10") > version_key("7.9") > version_key("6.10") > version_key("Luna")
    assert version_key("Luna") == (0,)
    assert version_key("1" * 5000) == (0,)  # far too long for a version, and too long for Python to read as a number


def test_the_difference_between_two_lists():
    old = parse_catalog(list_bytes(SMALL_LIST))
    newer = json.loads(json.dumps(SMALL_LIST))
    newer["1"]["achievements"] = [s for s in newer["1"]["achievements"] if s["id"] != 80001]
    newer["0"]["achievements"][1]["reward"] = 10  # For the Love of Godwin
    newer["1"]["achievements"].append({"id": 99001, "name": "New", "desc": "New.", "reward": 5, "ver": "7.2"})
    diff = diff_catalogs(old, parse_catalog(list_bytes(newer)))
    assert [s.id for s in diff.added] == [99001]
    assert [(before.id, before.reward, after.reward) for before, after in diff.changed] == [(84512, 5, 10)]
    assert [s.id for s in diff.removed] == [80001]
