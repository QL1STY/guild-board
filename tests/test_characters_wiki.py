"""The Characters pages' wiki (the Characters plan, Task W1): the lists, the entries kept by the game's version, the pages made
of them and the parsing of a material's source.

The answers are those of tests/characters_wiki_entries.json, cut from the wiki's of 2026-10-29; no test reaches HoYoLAB.
"""
import json
import logging
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import pytest

import characters_samples as samples
from guildboard.characters import wiki as characters_wiki
from guildboard.characters.models import Source
from guildboard.characters.wiki import ENTRY_URL, HEADERS, CharacterWiki, parse_source, plain, stat_key
from guildboard.pulls import wiki as pulls_wiki
from pulls_samples import CHARACTERS, WEAPONS, wiki_page
from support import FakeClock

NOW = datetime(2026, 10, 29, 9, 0, tzinfo=timezone.utc)
SANDRONE_ART = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2026/06/29/38a6541d13b7686cb62b138c843db485_1689134716955007600.png"
SANDRONE_CHART = "https://act-upload.hoyoverse.com/event-ugc-hoyowiki/2026/08/14/35428890/02698eea43e94fa98c01742655ce50dc_1920258854898741334.png"
SHARPNESS = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2026/05/15/2e311abfb4fa96194a5420137b7262bf_8775615034839082974.png"

SETS = [
    {"entry_page_id": "10760", "name": "Disenchantment in Deep Shadow", "icon_url": SHARPNESS, "filter_values": {}},
    {"entry_page_id": "11223", "name": "Heart of the Furnace", "icon_url": SHARPNESS, "filter_values": {}},
]


class Wiki:
    """Stands in for netpolicy.fetch_hoyoverse: the wiki's entries and list pages, each request remembered."""

    def __init__(self) -> None:
        self.entries: list[str] = []
        self.lists: list[tuple[str, int]] = []
        self.headers: list[dict[str, str]] = []
        self.fail: Exception | None = None

    def __call__(self, url: str, *, headers=None, body=None) -> bytes:
        self.headers.append(dict(headers))
        if self.fail is not None:
            raise self.fail
        if url.startswith(ENTRY_URL):
            self.entries.append(url[len(ENTRY_URL):])
            return samples.wiki_entry_answer(url[len(ENTRY_URL):])
        assert url == pulls_wiki.WIKI_URL and body is not None
        asked = json.loads(body)
        self.lists.append((asked["menu_id"], asked["page_num"]))
        listed = {"2": (CHARACTERS, 132), "4": (WEAPONS, 252), "5": (SETS, 60)}[asked["menu_id"]]
        return wiki_page(listed[0] if asked["page_num"] == 1 else [], listed[1])


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(NOW)


@pytest.fixture
def wiki(store, clock) -> tuple[CharacterWiki, Wiki, list[str]]:
    version = ["7.1"]
    fetch = Wiki()
    return CharacterWiki(store, clock, fetch, lambda: version[0]), fetch, version


# ------------------------------------------------------------------------------------------------ the pages


async def test_a_character_page_gives_her_art_chart_talents_constellations_and_costs(wiki):
    characters, _, _ = wiki
    page = characters.character_page(await characters.entry("10920", "character"))
    assert (page.key, page.name, page.entry) == ("sandrone", "Sandrone", "10920")
    assert (page.art, page.chart) == (SANDRONE_ART, SANDRONE_CHART)  # the Gallery's "Avatar" and "Constellation"
    assert page.icon.startswith("https://act-webstatic.hoyoverse.com/") and page.icon.endswith(".png")
    assert (page.title, page.affiliation, page.birthday) == ("Mirrored Analysis", "Fatui", "1/13")
    assert (page.version, page.dish) == ("Luna VIII", "Tea Party Polyphony")
    assert (page.element, page.weapon_type, page.rarity, page.ascension_stat) == ("Cryo", "Claymore", 5, "CRIT Rate")
    kinds = [kind for kind, _, _, _ in page.talents]
    assert kinds == ["normal", "skill", "burst", "passive", "passive", "passive", "passive"]
    assert page.talents[0][1] == "Formule Phenomenale: Self-Evident Proposition"
    assert page.talents[0][2].endswith(".png") and page.talents[0][3].startswith("Normal Attack\n")  # one paragraph a line
    assert page.talents[5][1] == "Stellar Jubilee: Light of Rationalisme"  # the wiki's spaces round it are trimmed
    assert len(page.constellations) == 6 and page.constellations[0][0] == "Morrow After the Golden Dusk"
    assert "30% increased Stellar Glimmer reaction DMG" in page.constellations[0][2]
    assert dict(page.talent_costs[10]) == {
        "mora": 700000, "philosophies-of-vagrancy": 16, "precision-drive-shaft": 12, "madman-s-restraint": 2,
        "crown-of-insight": 1,
    }  # the keys are metrics.slug's, which makes the apostrophe a dash, as the engines' slug("Madman's Restraint") does
    assert sorted(page.talent_costs) == list(range(2, 11))
    assert sorted(page.ascension_costs) == [1, 2, 3, 4, 5, 6] and dict(page.ascension_costs[1])["mora"] == 20000
    assert page.material_names["mora"] == ("Mora", "https://bbs.hoyolab.com/hoyowiki/picture/object/Mora_icon.png", "757")
    assert page.material_names["crown-of-insight"][0] == "Crown of Insight"
    wanted = {key for costs in (*page.talent_costs.values(), *page.ascension_costs.values()) for key, _ in costs}
    assert wanted <= set(page.material_names)  # every material above has its name, picture and entry


async def test_her_own_stats_are_kept_at_the_levels_each_phase_starts_and_ends(wiki):
    characters, _, _ = wiki
    page = characters.character_page(await characters.entry("10920", "character"))
    assert page.own[90] == {"hp": 13226.0, "atk": 342.0, "def": 752.0, "cr": 19.2}  # as the wiki's table gives
    assert page.own[1] == {"hp": 1030.0, "atk": 27.0, "def": 59.0, "cr": 0.0}
    assert page.own[20]["hp"] == 2671.0 and page.own[21]["hp"] == 3554.0  # the end of the phase, then after the ascension
    assert page.own[80]["hp"] == 11669.0 and page.own[81]["hp"] == 12296.0
    assert sorted(page.own) == [1, 20, 21, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90]


async def test_a_weapon_page_gives_its_level_90_stats_passive_and_ascension_costs(wiki):
    characters, fetch, _ = wiki
    page = characters.weapon_page(await characters.entry("10949", "weapon"))
    assert (page.key, page.name, page.type, page.rarity) == ("a-teaspoon-of-transcendence", "A Teaspoon of Transcendence", "Claymore", 5)
    assert (page.base_atk_90, page.sub, page.sub_90) == (674.0, "CRIT DMG", 44.1)
    assert page.passive == "White Fairy's Queening"
    assert len(page.texts) == 5
    assert page.texts[0].startswith("ATK is increased by 28%.") and page.texts[4].startswith("ATK is increased by 56%.")
    assert "Stellar-Conduct and Stellar Swirl reaction DMG is increased by 16% for 5s" in page.texts[0]
    assert "by 32% for 5s" in page.texts[4]
    # The wiki wrote this page's materials in Japanese; their keys are of their English names, read from their own entries.
    assert sorted(page.ascension_costs) == [1, 2, 3, 4, 5, 6]
    assert dict(page.ascension_costs[1]) == {
        "mora": 10000, "sundered-glory-of-the-far-north-scions": 5, "fractured-lunar-iron": 5, "tattered-warrant": 3,
    }
    assert all(key.isascii() for costs in page.ascension_costs.values() for key, _ in costs)
    assert sorted(fetch.entries) == sorted(["10949", *samples.WIKI_MATERIAL_NAMES])  # each material read once, for its name


async def test_a_set_page_takes_each_pieces_slot_from_its_position_not_its_key(wiki):
    characters, _, _ = wiki
    page = characters.set_page(await characters.entry("10760", "set"))
    assert (page.key, page.name) == ("disenchantment-in-deep-shadow", "Disenchantment in Deep Shadow")
    assert page.icons["plume"] == SHARPNESS  # the wiki keeps the Plume under `sands_of_eon`
    assert set(page.icons) == {"flower", "plume", "sands", "goblet", "circlet"}
    assert page.icons["circlet"].endswith("246042224874063702.png")  # under `goblet_of_eonothem`
    assert page.two_text == "ATK +18%."
    assert page.four_text.startswith("Increases Superconduct Reaction DMG by 80%.")


async def test_a_material_page_gives_its_type_and_where_it_comes_from(wiki):
    characters, _, _ = wiki
    books = characters.material_page(await characters.entry("8590", "material"))
    assert (books.id, books.name, books.type_text) == (8590, "Philosophies of Vagrancy", "Character Talent Material")
    assert books.icon.endswith("9198943640019560886.png")
    assert books.source == Source("books", "Overturned Roost", (2, 5, 6))
    weekly = characters.material_page(await characters.entry("9192", "material"))
    assert weekly.source == Source("weekly", "The Doctor", ())
    flowers = characters.material_page(await characters.entry("11337", "material"))
    assert (flowers.name, flowers.source) == ("Flockingweed", Source("flowers", "Fellfrost Peak", ()))


@pytest.mark.parametrize(
    ("text", "type_text", "wanted"),
    [
        ("Domain of Mastery: Overturned Roost (Wednesday/Saturday/Sunday)", "Character Talent Material",
         Source("books", "Overturned Roost", (2, 5, 6))),
        ("Lv. 70+ The Doctor Challenge Reward Obtained from the Crafting Bench Conversion Tab",
         "Character Level-Up Material", Source("weekly", "The Doctor", ())),
        ("Dropped by Lv. 30+ Chimeric Winged Lions", "Character Level-Up Material",
         Source("boss", "Chimeric Winged Lions", ())),
        ("Recommendation: Found in Fellfrost Peak", "Local Specialty (Snezhnaya)",
         Source("flowers", "Fellfrost Peak", ())),
        ("Dropped by Landcruisers Stardust Exchange", "Common Ascension Material",
         Source("enemies", "Landcruisers Stardust Exchange", ())),
        ("Domain of Forgery: Cecilia Garden (Monday/Thursday/Sunday)", "Weapon Ascension Material",
         Source("forgery", "Cecilia Garden", (0, 3, 6))),
        ("Ley Line Outcrops", "Character EXP Material", Source("ley", "Ley Line Outcrops", ())),
        ("Crafted at the Crafting Bench", "Cooking Ingredient", Source("crafted", "Crafted at the Crafting Bench", ())),
        ("A gift from a traveller", "Other", Source("unknown", "A gift from a traveller", ())),
        ("", "", Source("unknown", "", ())),
    ],
)
def test_sources_are_parsed_into_kinds_and_days(text, type_text, wanted):
    assert parse_source(text, type_text) == wanted


def test_a_text_of_the_wiki_loses_its_markup_and_a_stat_gets_its_key():
    assert plain('<p>Cryo <span style="color: red">DMG</span>&#39;s<br>edge</p><p>next</p>', lines=True) == "Cryo DMG's\nedge\nnext"
    assert plain("<p>a</p><p>b  c</p>") == "a b c"
    assert [stat_key(text) for text in (
        "CRIT Rate", "CRIT DMG", "CRIT Rate Bonus", "Elemental Mastery", "Energy Recharge", "ATK", "HP", "DEF",
        "Healing Bonus", "Physical DMG Bonus", "Cryo DMG Bonus", "Nonsense",
    )] == ["cr", "cd", "cr", "em", "er", "atk_pct", "hp_pct", "def_pct", "heal", "phys", "dmg", None]


# ------------------------------------------------------------------------------------------------ keeping and asking


async def test_entries_are_kept_by_version_and_read_again_when_it_moves(wiki, store, clock):
    characters, fetch, version = wiki
    row = await characters.entry("10920", "character")
    assert (row.entry_page_id, row.kind, row.name, row.version, row.read_at) == ("10920", "character", "Sandrone", "7.1", NOW)
    assert store.wiki_entry("10920") == row and row.data["modules"]["Gallery"]  # kept in the database
    assert all(headers == HEADERS for headers in fetch.headers)
    clock.advance(hours=5)
    again = await characters.entry("10920", "character")
    assert again == row and fetch.entries == ["10920"]  # the same version: nothing is read
    version[0] = "7.2"
    moved = await characters.entry("10920", "character")
    assert fetch.entries == ["10920", "10920"] and (moved.version, moved.read_at) == ("7.2", clock.now())
    assert store.wiki_entry("10920").version == "7.2"
    assert "Voice-Over" not in moved.data["modules"] and "Media" not in moved.data["modules"]  # only what is read is kept


async def test_a_name_the_wiki_lacks_is_asked_again_only_after_a_day(wiki, clock):
    characters, fetch, _ = wiki
    assert await characters.entry("99999999", "character") is None
    assert await characters.entry("99999999", "character") is None
    clock.advance(hours=23, minutes=59)
    assert await characters.entry("99999999", "character") is None
    assert fetch.entries == ["99999999"]  # asked once, and not again within the day
    clock.advance(minutes=1)
    assert await characters.entry("99999999", "character") is None
    assert fetch.entries == ["99999999", "99999999"]
    other = await characters.entry("10920", "character")
    assert other is not None  # one entry's absence changes nothing for another


async def test_lists_are_read_at_most_once_a_day_per_kind(wiki, store, clock):
    characters, fetch, _ = wiki
    await characters.lists()
    assert fetch.lists == [("2", 1), ("2", 2), ("2", 3), *(("4", page) for page in range(1, 7)), ("5", 1), ("5", 2)]
    kept = store.wiki_items()
    assert kept[("character", "Skirk")].entry_page_id and kept[("weapon", "Azurelight")].rank == 5
    assert kept[("set", "Disenchantment in Deep Shadow")].entry_page_id == "10760"
    fetch.lists.clear()
    clock.advance(hours=23, minutes=59)
    await characters.lists()
    assert fetch.lists == []  # a day has not passed
    clock.advance(minutes=1)
    await characters.lists()
    assert len(fetch.lists) == 11  # all three kinds, once more


async def test_a_failed_fetch_keeps_what_was_kept_and_logs_only_what_failed(wiki, store, clock, caplog):
    characters, fetch, version = wiki
    await characters.lists()
    kept_items = dict(store.wiki_items())
    row = await characters.entry("10920", "character")
    version[0] = "7.2"
    clock.advance(days=1)
    fetch.fail = urllib.error.URLError("https://sg-wiki-api.hoyolab.com/entry_page?entry_page_id=10920 went away")
    with caplog.at_level(logging.INFO):
        stale = await characters.entry("10920", "character")
        await characters.lists()
    assert stale == row and stale.version == "7.1"  # the older version's entry stays when the new one cannot be had
    assert store.wiki_items() == kept_items  # and so do the lists
    assert "URLError" in caplog.text
    assert "entry_page_id" not in caplog.text and "went away" not in caplog.text and "hoyolab.com" not in caplog.text
    fetch.fail = None
    refreshed = await characters.entry("10920", "character")
    assert refreshed.version == "7.2"


async def test_a_list_that_failed_is_tried_again_after_a_quarter_of_an_hour(wiki, store, clock):
    characters, fetch, _ = wiki
    fetch.fail = ConnectionError("down")
    await characters.lists()
    assert len(fetch.headers) == 3 and store.wiki_items() == {}  # one try for each kind
    await characters.lists()
    assert len(fetch.headers) == 3  # not at once
    fetch.fail = None
    clock.advance(minutes=15)
    await characters.lists()
    assert len(store.wiki_items()) > 0


async def test_the_demo_reads_nothing_and_serves_what_is_kept(store, clock):
    characters = CharacterWiki(store, clock, None, lambda: "7.1")
    await characters.lists()
    assert store.wiki_items() == {}
    assert await characters.entry("10920", "character") is None
    wiki_row = await CharacterWiki(store, clock, Wiki(), lambda: "7.1").entry("10920", "character")
    assert await characters.entry("10920", "character") == wiki_row  # an entry kept is served as it is, with no read


async def test_an_entry_of_another_kind_is_not_taken_for_this_one(wiki):
    characters, fetch, _ = wiki
    await characters.entry("10920", "character")
    assert await characters.entry("10920", "weapon") is not None  # read again as the kind asked for
    assert fetch.entries == ["10920", "10920"]


# ------------------------------------------------------------------------------------------------ the Tutorial entries

# The wiki's answer for entry 7786, Stygian Onslaught, read on 2026-11-06 and trimmed by cutting: the modules Rewards and
# Related Enemies and the end of the Overview are left out, nothing else is changed.
TUTORIAL_7786 = Path(__file__).parent / "fixtures" / "wiki" / "tutorial_7786.json"
UPLOAD = "https://act-upload.hoyoverse.com/event-ugc-hoyowiki"


async def test_the_tutorial_kind_keeps_the_icon_and_pictures_in_order(store, clock):
    # The Stats design, 3.2: an endgame mode's Tutorial entry gives the header its icon, and its first picture after the
    # icon is the fallback for the header's picture. Each picture is kept once, in the page's order, with the words just
    # above it, which name a Stygian difficulty's medal.
    asked: list[str] = []

    def fetch(url: str, *, headers=None, body=None) -> bytes:
        asked.append(url)
        assert body is None and headers == HEADERS
        return TUTORIAL_7786.read_bytes()

    row = await CharacterWiki(store, clock, fetch, lambda: "7.1").entry("7786", "tutorial")
    assert asked == [ENTRY_URL + "7786"]
    assert (row.entry_page_id, row.kind, row.name, row.version) == ("7786", "tutorial", "Stygian Onslaught", "7.1")
    data = row.data
    assert (data["name"], data["icon"]) == (
        "Stygian Onslaught", f"{UPLOAD}/2025/07/14/41133912/b6287b34deb1f4d12e0be0599584cc70_855379148837321239.png"
    )
    overview = f"{UPLOAD}/2025/07/23/41133912/"
    assert data["pictures"] == [
        f"{UPLOAD}/2026/01/30/25567199/70a89ddfb1ce4f96097fe934d923d687_2389902169693064604.jpg",  # the Gallery's, first
        f"{UPLOAD}/2026/01/30/25567199/daf058c7d4ab792558c99f91ab3bbedc_3113761511016516642.png",
        overview + "f8abc3e1ec100f3a2c8c80e2d205ca93_8875746011065674858.png",
        overview + "e862cfec7efed999c7cf4ad5755574d1_702640988389072184.png",
        overview + "80e5b11046f84abb01acd2fd0e38e9b0_4167175063572630128.png",  # the six difficulties' medals
        overview + "7a1a0db6f23b38270f6ecb58f3cf6863_4514836907885697061.png",
        overview + "43583b6e5304c0404cf11e140a10e775_4713130635203883466.png",
        overview + "dada88645a8dcdfae24441ab6853f49d_904676794084008519.png",
        overview + "a95ba67de542cddc2d97e68089ff04c5_7557421508391672161.png",
        overview + "c79a52782ddfc45aff557d754c9943f9_5586370517712107127.png",
        overview + "6d4ef9a3e7cb13b65710ef159e426225_4958481545842792178.png",
        f"{UPLOAD}/2025/07/21/41133912/8405aeb81ab4830ade9bc9d9df93149d_6943665321489032823.png",  # Related Media's
        f"{UPLOAD}/2025/07/21/41133912/8cc966dfcee163e2a087f9cdd870fa8b_1496609040620149003.png",
        f"{UPLOAD}/2025/07/21/41133912/eb89fe3715de5eb7691a1d71a47fff4f_7024763339642523300.png",
    ]
    assert data["icon"] not in data["pictures"]
    # The words above each picture: a Gallery picture's name, and the end of the text since the picture before it.
    captions = data["captions"]
    assert len(captions) == len(data["pictures"])
    assert captions[:3] == ["Stygian Onslaught", "Old Stygian Onslaught", ""]
    assert [caption.rsplit("Challenge: ", 1)[-1] for caption in captions[4:10]] == [
        "Normal", "Advancing", "Hard", "Menacing", "Fearless", "Dire",
    ]
    assert captions[10] == "Complete Challenge Objective"
    assert all(len(caption) <= characters_wiki.CAPTION_CHARS for caption in captions)
    # Kept by the game's version, as every entry is: asked again only when it moves.
    assert await CharacterWiki(store, clock, fetch, lambda: "7.1").entry("7786", "tutorial") == row and len(asked) == 1


def test_nothing_of_the_wiki_goes_anywhere_but_the_seam():
    import inspect

    source = inspect.getsource(characters_wiki)
    for forbidden in ("urllib", "requests", "aiohttp", "socket", "http.client"):
        assert forbidden not in source, forbidden


def _quick(call, *args, seconds: float = 1.0):
    import time

    started = time.perf_counter()
    result = call(*args)
    assert time.perf_counter() - started < seconds
    return result


def test_plain_stays_fast_on_a_long_run_of_angle_brackets():
    # About a megabyte of "<" with no ">" made the tag pattern look to the end from every one of them.
    assert _quick(plain, "<" * 1_000_000) == "<" * characters_wiki.MAX_FIELD_CHARS
    assert _quick(plain, "<b>" * 300_000 + "<" * 600_000) != ""
    assert _quick(plain, "<br" + " " * 1_000_000) == "<br"  # the field is cut, and a run of spaces is one
    assert plain("<p>One</p><p>Two &amp; <b>three</b></p>") == "One Two & three"
    assert plain("a < b > c") == "a c" and plain("a <> b") == "a <> b" and plain("1 < 2 and 3 > 2") == "1 2"


def test_the_materials_of_a_string_are_found_without_a_search_from_every_dollar_sign():
    assert _quick(characters_wiki._entries, "$[" * 500_000) == []
    assert _quick(characters_wiki._entries, "$[" * 20_000 + "]$" * 20_000) == []
    assert characters_wiki._entries('x $[{"a": 1}, 2, {"b": 2}]$ y') == [{"a": 1}, {"b": 2}]
    assert characters_wiki._entries('$[{"a": 1}]$ and $[{"b": 2}]$') == []  # the greedy pattern read one list from the first
    assert characters_wiki._entries("$[]$") == [] and characters_wiki._entries("$[$") == []
    assert characters_wiki._entries(None) == []
