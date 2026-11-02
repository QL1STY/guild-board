"""The repository holds none of HoYoverse's art or text: every picture the app shows is read at runtime, from HoYoverse's hosts into
the local cache, or drawn as a sign where there is none (the public release plan, N2 and N3)."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from guildboard.config import AppPaths
from guildboard.core import Core

ROOT = Path(__file__).resolve().parent.parent
PICTURES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}


def test_the_interface_ships_no_picture_of_the_games():
    assets = ROOT / "web" / "src" / "assets"
    found = sorted(path.name for path in assets.rglob("*") if path.suffix.lower() in PICTURES) if assets.exists() else []
    assert found == []
    source = (ROOT / "web" / "src" / "pages" / "PullsSavings.tsx").read_text(encoding="utf-8")
    assert "../assets/" not in source


# ---------------------------------------------------------------------------------------------- the game's text (N3)
REFERENCE = ROOT / "src" / "guildboard" / "reference" / "characters"
DEMO = ROOT / "src" / "guildboard" / "characters" / "demo"
SUNDAY = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)


def test_the_reference_holds_no_sentence_of_the_games():
    weapons = json.loads((REFERENCE / "weapons.json").read_text(encoding="utf-8"))["weapons"]
    sets = json.loads((REFERENCE / "sets.json").read_text(encoding="utf-8"))["sets"]
    assert len(weapons) > 200 and len(sets) > 50
    assert not [key for key, weapon in weapons.items() if "passive" in weapon]
    assert not [key for key, one in sets.items() if "two_text" in one or "four_text" in one]
    for name, field in (("weapons", "passive"), ("sets", "two_text"), ("sets", "four_text")):
        schema = json.loads((REFERENCE / "schema" / f"{name}.schema.json").read_text(encoding="utf-8"))
        assert field not in json.dumps(schema)


def test_the_demos_wiki_entries_hold_text_of_ours():
    from guildboard.characters.wiki import plain

    entries = json.loads((DEMO / "wiki.json").read_text(encoding="utf-8"))["entries"]
    seen = 0
    for entry in entries.values():
        modules = entry["data"].get("modules", {})
        talents = modules.get("Talents", {}).get("talent", {}).get("list", [])
        constellations = modules.get("Constellation", {}).get("summaryList", {}).get("list", [])
        effect = modules.get("Attributes", {}).get("reliquary_set_effect", {})
        pieces = [one for one in modules.get("Set", {}).get("artifact_list", {}).values() if isinstance(one, dict)]
        passive = [item for item in modules.get("Attributes", {}).get("baseInfo", {}).get("list", [])
                   if entry["kind"] == "weapon" and item["key"] not in {"Name", "Region", "Source", "Type", "Secondary Attributes", "Version Released"}]
        gallery = modules.get("Gallery", {}).get("gallery_character", {}).get("list", [])
        texts = [talent.get("desc") for talent in talents] + [one.get("desc") for one in constellations]
        texts += [effect.get("two_set_effect"), effect.get("four_set_effect")] if effect else []
        texts += [one.get("desc") for one in pieces] + [item["value"][0] for item in passive]
        for item in gallery:  # an outfit's name is a name; the paragraph after it is the wiki's prose
            texts += re.findall(r"<p>(.*?)</p>", item.get("imgDesc") or "")[1:2]
        for text in texts:
            if text:
                seen += 1
                assert plain(text).startswith("Demo text"), plain(text)[:60]
    assert seen >= 20


@pytest.fixture
async def demo(tmp_path):
    core = Core(AppPaths(tmp_path / "data"), demo=True, demo_now=SUNDAY, process_lister=lambda: set())
    await core.runner.run("manual", ("notes", "characters", "endgame", "calendar"))
    yield core
    core.store.close()


async def test_a_weapons_and_sets_text_is_the_wikis_and_empty_where_it_is_not_read(demo):
    service = demo.characters
    profile = service.profile("sandrone")  # her weapon's and her set's entries are in the store
    assert profile["weapon"]["passive"]["name"] == "White Fairy's Queening"
    assert profile["weapon"]["passive"]["text"].startswith("Demo text")
    worn = next(one for one in profile["sets"] if one["pieces"] >= 4)
    assert worn["two"].startswith("Demo text") and worn["four"].startswith("Demo text")
    planner = service.planner("sandrone")
    options = {option["key"]: option for option in planner["weapons"]}
    assert options["a-teaspoon-of-transcendence"]["text"].startswith("Base ATK 674, Crit DMG 44.1%.")
    assert "Demo text" in options["a-teaspoon-of-transcendence"]["text"]
    unread = options["a-thousand-blazing-suns"]["text"]
    assert unread == "Base ATK 741, Crit Rate 11.0%."  # no entry of its own yet: its numbers, and no sentence
    assert planner["set_text"].startswith("2 pieces: Demo text") and "4 pieces: Demo text" in planner["set_text"]
    sets = {option["key"]: option for option in planner["sets"]}
    assert sets["disenchantment-in-deep-shadow"]["text"].startswith("4 pieces, Demo text")
    assert sets["scarlet-proof"]["text"] == "4 pieces"  # not read yet
    odette = service.profile("odette")  # a weapon the wiki has no entry of in the demo
    assert odette["weapon"]["passive"]["text"] == ""
