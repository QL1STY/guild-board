"""What Add a wish offers on the Pulls planner: the characters and weapons to pick, with their faces, in four groups."""
from datetime import datetime, timedelta, timezone

from guildboard.pulls.choices import load_upcoming, wish_choices
from guildboard.store import BannerRow, WikiItemRow

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)
INVENTORY = {
    "characters": [
        {"name": "Furina", "rarity": 5}, {"name": "Bennett", "rarity": 4}, {"name": "Aloy", "rarity": 5},
        {"name": "Traveler (Anemo)", "rarity": 5}, {"name": "Albedo", "rarity": 5},
    ],
    "weapons": [
        {"name": "Azurelight", "rarity": 5}, {"name": "The Flute", "rarity": 4}, {"name": "Dull Blade", "rarity": 1},
    ],
}


def item(kind: str, name: str, rank: int) -> WikiItemRow:
    return WikiItemRow(kind, name, rank, f"https://act-webstatic.hoyoverse.com/{name}.png", "1", NOW)


WIKI = {
    (row.kind, row.name): row for row in (
        item("character", "Furina", 5), item("character", "Mitya", 0), item("character", "Manekin", 5),
        item("weapon", "Starsealed Edict", 5), item("weapon", "Azurelight", 5),
    )
}


def banner(ann_id: int, pool: str, featured: tuple[str, ...], ends: datetime, starts: datetime = NOW - timedelta(days=3)):
    return BannerRow(ann_id, "A wish", pool, featured, "", starts, ends, NOW)


ENDS = datetime(2026, 11, 24, 16, 59, tzinfo=timezone.utc)
BANNERS = [
    banner(1, "character", ("Mitya",), ENDS),
    banner(2, "character", ("Furina",), ENDS),
    banner(3, "weapon", ("Starsealed Edict", "Azurelight"), ENDS),
    banner(4, "character", ("Albedo",), NOW - timedelta(days=1), NOW - timedelta(days=21)),  # over: not now
]


def test_the_groups_come_in_order_soon_now_five_four_each_by_name():
    choices = wish_choices(INVENTORY, WIKI, ("Danica", "Tsaritsa"), BANNERS, NOW)
    people = [(c["name"], c["group"]) for c in choices["characters"]]
    assert people == [
        ("Danica", "soon"), ("Tsaritsa", "soon"),
        ("Furina", "now"), ("Mitya", "now"),
        ("Albedo", "five"),
        ("Bennett", "four"),
    ]
    weapons = [(c["name"], c["group"]) for c in choices["weapons"]]
    assert weapons == [("Azurelight", "now"), ("Starsealed Edict", "now"), ("The Flute", "four")]


def test_a_choice_carries_its_face_rank_and_the_end_of_its_banner():
    choices = wish_choices(INVENTORY, WIKI, ("Danica",), BANNERS, NOW)
    by_name = {c["name"]: c for c in choices["characters"]}
    # The wiki lists Mitya before his release with no rank: he counts as a 5★, as the wishlist counts him.
    assert by_name["Mitya"] == {
        "name": "Mitya", "kind": "character", "rank": 5, "group": "now",
        "icon": "/api/icon/wish.character.mitya", "ends_at": ENDS.isoformat(),
    }
    assert by_name["Albedo"]["icon"] is None and by_name["Albedo"]["ends_at"] is None  # not on the wiki's list here
    assert by_name["Danica"] == {
        "name": "Danica", "kind": "character", "rank": 5, "group": "soon", "icon": None, "ends_at": None,
    }


def test_no_one_who_cannot_be_wished_for_is_offered():
    names = {c["name"] for c in wish_choices(INVENTORY, WIKI, (), BANNERS, NOW)["characters"]}
    assert not names & {"Aloy", "Traveler (Anemo)", "Manekin"}
    assert "Dull Blade" not in {c["name"] for c in wish_choices(INVENTORY, WIKI, (), BANNERS, NOW)["weapons"]}


def test_one_coming_soon_leaves_the_group_once_the_wiki_or_the_inventory_lists_them():
    wiki = {**WIKI, ("character", "Tsaritsa"): item("character", "Tsaritsa", 5)}
    choices = wish_choices(INVENTORY, wiki, ("Danica", "tsaritsa"), BANNERS, NOW)
    groups = {c["name"]: c["group"] for c in choices["characters"]}
    assert groups["Tsaritsa"] == "five" and groups["Danica"] == "soon"
    assert [c["name"] for c in choices["characters"]].count("Tsaritsa") == 1


def test_the_coming_soon_list_is_kept_with_guild_board():
    assert load_upcoming() == ("Danica", "Tsaritsa")
