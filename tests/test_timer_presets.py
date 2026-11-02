import json
from datetime import date
from importlib import resources

from guildboard import netpolicy
from guildboard.achievements.catalog import bundled_raw, parse_catalog
from guildboard.config import FISHING_REGIONS
from guildboard.timers.presets import load_presets
from guildboard.timers.rules import Rule


HILICHURL_ABOUT = "Up to two appear in 12 hours, and it comes back 12 hours after the second is defeated"
HILICHURL_ICON = "https://bbs.hoyolab.com/hoyowiki/picture/enemy/Unusual%20Hilichurl_icon.png"
# The interactive map's Fishing Point marker, which every fishing spot shows (the look pass spec, 7.1).
FISHING_POINT = (
    "https://act-webstatic.hoyoverse.com/map_manage/20240726/"
    "052bbb288d4f3245166908367aa8ccd8_465260317346550977.png"
)
# The game's furnishing cards of the teapot's three fields, which answered 200 with an image on 2026-10-22.
TEAPOT_ICONS = {
    "teapot.jade_field": (
        "https://uploadstatic.mihoyo.com/ys-obc/2023/03/20/288180982/"
        "a264faa9657887886e8b2245878d275f_2122974915135778028.png"
    ),
    "teapot.luxuriant_glebe": (
        "https://uploadstatic.mihoyo.com/ys-obc/2023/03/20/288180982/"
        "ee54d81f18d121ed16c351092a27e986_4454333606841940845.png"
    ),
    "teapot.orderly_meadow": (
        "https://uploadstatic.mihoyo.com/ys-obc/2023/03/20/288180982/"
        "d1c5ae2f4d7e03f07db3d707adf04018_8121564375712998956.png"
    ),
}


def _raw() -> dict:
    return json.loads(resources.files("guildboard").joinpath("reference", "timers.json").read_text(encoding="utf-8"))


def test_the_pre_sets_serve_their_achievements():
    presets = load_presets().presets
    hilichurl = presets["hilichurl"]
    assert (hilichurl.name, hilichurl.rule, hilichurl.stages, hilichurl.counter, hilichurl.default) == (
        "Unusual Hilichurl", Rule("hours", 12), (82055, 82056, 82057), 82055, True,
    )
    assert (hilichurl.about, hilichurl.group) == (HILICHURL_ABOUT, "Unusual Hilichurl")
    teapots = {
        "teapot.jade_field": ("Teapot · Jade Field", (81087, 81088, 81089), "Crops ripen 70 hours after planting"),
        "teapot.luxuriant_glebe": (
            "Teapot · Luxuriant Glebe", (81090, 81091, 81092), "Flowers ripen 70 hours after planting",
        ),
        "teapot.orderly_meadow": (
            "Teapot · Orderly Meadow", (81093, 81094, 81095), "Aquatic plants ripen 70 hours after planting",
        ),
    }
    for key, (name, stages, about) in teapots.items():
        teapot = presets[key]
        assert (teapot.name, teapot.rule, teapot.stages, teapot.about, teapot.counter, teapot.default) == (
            name, Rule("hours", 70), stages, about, None, True,
        )
        assert teapot.group == "Teapot"


def test_a_fishing_spot_is_a_pre_set_that_follows_the_setting():
    loaded = load_presets()
    luhua, cider = loaded.presets["fishing.luhua_pool"], loaded.presets["fishing.cider_lake_1"]
    assert (luhua.name, cider.name) == ("Fishing spot · Luhua Pool, Liyue", "Fishing spot · Cider Lake (1), Mondstadt")
    for spot in (p for key, p in loaded.presets.items() if key.startswith("fishing.")):
        assert (spot.rule, spot.stages, spot.counter, spot.group, spot.default) == (
            Rule("fishing"), (81134, 81135, 81136), None, "Fishing spots", False,
        )
        assert spot.region in FISHING_REGIONS and spot.name.startswith("Fishing spot · ")
    assert loaded.about(luhua, "3_days") == "Fish come back 3 days after the spot is emptied"
    assert loaded.about(luhua, "next_reset") == "Fish come back at the next daily reset"
    assert loaded.about(loaded.presets["hilichurl"], "next_reset") == HILICHURL_ABOUT


def test_every_fishing_spot_the_wiki_names_in_the_eight_regions_is_there():
    # The Genshin Impact Wiki's fishing points on 2026-10-20: 11 in Mondstadt, 16 in Liyue, 13 in Inazuma, 11 in
    # Sumeru, 15 in Fontaine and 18 in Natlan; on 2026-10-26: 13 in Nod-Krai and 7 in Snezhnaya.
    spots = [preset for key, preset in load_presets().presets.items() if key.startswith("fishing.")]
    by_region = {region: sum(1 for spot in spots if spot.region == region) for region in FISHING_REGIONS}
    assert by_region == {
        "mondstadt": 11, "liyue": 16, "inazuma": 13, "sumeru": 11, "fontaine": 15, "natlan": 18,
        "nod_krai": 13, "snezhnaya": 7,
    }
    assert load_presets().presets["fishing.ungiens_circle_still_waters"].name == (
        "Fishing spot · Ungien's Circle: Still Waters, Nod-Krai"
    )


def test_every_pre_set_stage_is_in_the_bundled_list():
    catalog = parse_catalog(bundled_raw())
    stages = [stage for preset in load_presets().presets.values() for stage in preset.stages]
    assert stages and all(catalog.stage(stage) is not None for stage in stages)


def test_the_file_names_its_sources_and_when_it_was_checked():
    raw = _raw()
    assert date.fromisoformat(raw["checked"]) and load_presets().checked == raw["checked"]
    for item in [*raw["presets"], raw["fishing"]]:
        assert item["sources"] and all(url.startswith("https://") for url in item["sources"])
    keys = [spot["key"] for spot in raw["fishing"]["spots"]]
    assert len(set(keys)) == len(keys)


def test_every_icon_is_official_art_on_hoyoverses_servers():
    presets = load_presets().presets
    icons = [preset.icon for preset in presets.values() if preset.icon is not None]
    assert all(netpolicy.is_hoyoverse(icon) for icon in icons)
    assert presets["hilichurl"].icon == HILICHURL_ICON  # the picture of HoYoLAB's wiki entry for it


def test_teapot_fields_and_fishing_spots_have_their_pictures():
    presets = load_presets().presets
    for key in ("teapot.jade_field", "teapot.luxuriant_glebe", "teapot.orderly_meadow"):
        assert netpolicy.is_hoyoverse(presets[key].icon)
    fishing = [preset for preset in presets.values() if preset.group == "Fishing spots"]
    assert fishing and all(preset.icon == FISHING_POINT for preset in fishing)


def test_the_teapot_fields_show_the_furnishing_cards_of_the_game():
    # An address with a typo would only show the sign in its place, so the exact text is kept here.
    presets = load_presets().presets
    assert {key: presets[key].icon for key in TEAPOT_ICONS} == TEAPOT_ICONS
