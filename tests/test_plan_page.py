"""Task 4: the Plan page's model (design 4): the books and weapon materials open today, who is idle and when their next day is, the
weekly bosses, the planned list of up to 128 and the characters that can be added. Everything is read from the wiki entries the app
already keeps; an entry that is not kept gives None, never a guess."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

import characters_samples as samples
from characters_service_support import build_record, calculator, keep_builds, keep_notes, keep_wiki, make_service
from guildboard.characters import PLANNED_MAX
from guildboard.characters.service import CharactersRefused, UnknownCharacter
from guildboard.gameday import game_day_start
from guildboard.store import WikiEntryRow, iso
from guildboard.views.plan import domain_days, weapon_series
from support import FakeClock
from test_api_characters import opened

THURSDAY = datetime(2026, 11, 12, 8, 0, tzinfo=timezone.utc)   # 09:00 on Thursday on the Europe server
ICON = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2025/09/01/{}.png"
TEACHINGS = "8588"
SUNDERED_GLORY_ICON = (   # the picture the Teaspoon's entry gives its lowest tier
    "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin/2025/09/01/23722ceff82d79fa0fbd7b4d5bf6abca_736740409930508169.png"
)
TIERS = {   # the Teaspoon's four tiers of the Far-North Scions' material, by their entries
    "8599": "Sundered Glory of the Far-North Scions", "8600": "Unyielding Delusion of the Far-North Scions",
    "8601": "Oblation of the Far-North Scions", "8602": "Aureate Radiance of the Far-North Scions",
}


def material(entry: str, name: str, source: str, type_text: str = "Character Talent Material") -> WikiEntryRow:
    """A material's wiki entry as the app keeps it: its name, its picture and its Source line."""
    data = {
        "id": entry, "name": name, "icon": ICON.format(entry), "menu": "9", "filters": {},
        "modules": {"Attributes": {"baseInfo": {"list": [
            {"key": "Name", "value": [name]}, {"key": "Type", "value": [type_text]}, {"key": "Source", "value": [source]},
        ]}}},
    }
    return WikiEntryRow(entry, "material", name, data, "7.1", THURSDAY)


def domain(days: str, where: str = "Overturned Roost", kind: str = "Mastery") -> str:
    return f'<p>Domain of {kind}: {where} <span style="color: rgb(255, 225, 75)">({days})</span></p>'


async def planned(store, tmp_path, *, book: str | None = "Wednesday/Saturday/Sunday", weapon: str | None = "Wednesday/Saturday/Sunday",
                  extra: bool = False, notes: bool = True, **kwargs):
    """A service on Thursday 12 November for Sandrone (and, when asked, a character whose entry is not read), planned."""
    clock = FakeClock(THURSDAY)
    records = [build_record(samples.sandrone_build())]
    if extra:
        records.append(build_record(samples.sandrone_build(), ident=2, name="Unread One", wiki_entry=None))
    keep_builds(store, THURSDAY, records, calculator())
    if notes:
        keep_notes(store, THURSDAY, discounts=2)
    service = make_service(store, clock, tmp_path, **kwargs)
    await keep_wiki(service._wiki)
    if book:
        store.put_wiki_entry(material(TEACHINGS, "Teachings of Vagrancy", domain(book)))
    if weapon:
        for entry, name in TIERS.items():
            store.put_wiki_entry(material(entry, name, domain(weapon, "Test Domain", "Forgery")))
    service.put_focus(["sandrone", *(["unread-one"] if extra else [])])
    return service


def test_domain_days_are_the_pair_and_sunday():
    assert domain_days((1, 4, 5)) == (1, 4, 6)
    assert domain_days((0, 3, 6)) == (0, 3, 6)
    assert domain_days((2,)) == (2, 5, 6)
    assert domain_days(()) == ()
    assert domain_days((6,)) == ()


@pytest.mark.parametrize("tiers, series", [
    # Mondstadt
    (["Tile of Decarabian's Tower", "Debris of Decarabian's City", "Fragment of Decarabian's Epic",
      "Scattered Piece of Decarabian's Dream"], "Decarabian"),
    (["Boreal Wolf's Milk Tooth", "Boreal Wolf's Cracked Tooth", "Boreal Wolf's Broken Fang", "Boreal Wolf's Nostalgia"], "Boreal Wolf"),
    # Liyue
    (["Luminous Sands from Guyun", "Lustrous Stone from Guyun", "Relic from Guyun", "Divine Body from Guyun"], "Guyun"),
    (["Coral Branch of a Distant Sea", "Jeweled Branch of a Distant Sea", "Jade Branch of a Distant Sea",
      "Golden Branch of a Distant Sea"], "Distant Sea"),
    (["Grain of Aerosiderite", "Piece of Aerosiderite", "Bit of Aerosiderite", "Chunk of Aerosiderite"], "Aerosiderite"),
    # Inazuma
    (["Narukami's Wisdom", "Narukami's Joy", "Narukami's Affection", "Narukami's Valor"], "Narukami"),
    (["Mist Veiled Lead Elixir", "Mist Veiled Mercury Elixir", "Mist Veiled Gold Elixir", "Mist Veiled Primo Elixir"], "Mist Veiled"),
    # Nod-Krai
    (list(TIERS.values()), "Far-North Scions"),
])
def test_a_weapon_materials_series_is_what_its_tiers_share(tiers, series):
    assert weapon_series(tiers) == series


def test_one_tier_alone_or_tiers_that_share_nothing_keep_their_own_name():
    assert weapon_series(["Tile of Decarabian's Tower"]) == "Tile of Decarabian's Tower"
    assert weapon_series(["Mask of the Wicked Lieutenant", "Tattered Warrant"]) == "Mask of the Wicked Lieutenant"
    assert weapon_series([]) == ""


async def test_the_page_says_the_day_the_date_the_count_and_when_the_day_turns(store, tmp_path):
    page = (await planned(store, tmp_path)).plan_page()
    assert (page["weekday"], page["date"], page["count"]) == (3, "2026-11-12", 1)
    assert page["turns_at"] == iso(game_day_start(date(2026, 11, 13), "os_euro"))


async def test_a_book_that_is_not_open_today_is_idle_with_its_next_day(store, tmp_path):   # Vagrancy: Wed/Sat/Sun
    service = await planned(store, tmp_path)
    page = service.plan_page()
    assert page["books"] == [] and page["weapons"] == []
    assert page["idle"] == [{"key": "sandrone", "book_next": 5, "weapon_next": 5}]
    row = page["rows"][0]
    assert row["book"] == {"series": "Vagrancy", "icon": service.address(ICON.format(TEACHINGS)), "days": [2, 5, 6]}
    assert row["material"] == {"series": "Far-North Scions", "icon": service.address(SUNDERED_GLORY_ICON), "days": [2, 5, 6]}


async def test_today_lists_the_open_books_and_weapon_materials_with_who_needs_them(store, tmp_path):
    service = await planned(store, tmp_path, book="Monday/Thursday/Sunday", weapon="Monday/Thursday/Sunday")
    page = service.plan_page()
    assert [(b["series"], b["days"], b["who"]) for b in page["books"]] == [("Vagrancy", [0, 3, 6], ["sandrone"])]
    assert [(w["series"], w["who"], w["weapons"]) for w in page["weapons"]] == [
        ("Far-North Scions", ["sandrone"], ["A Teaspoon of Transcendence"])
    ]
    assert all(3 in item["days"] for item in page["books"] + page["weapons"]) and page["idle"] == []


async def test_two_weapons_of_one_domain_are_one_card_with_one_name_however_many_tiers_are_read(store, tmp_path):
    # The Teaspoon lists the four tiers of the Far-North Scions' material; the other weapon's costs list only the first two, and
    # only the second tier's entry has been read so far. Both are the same domain: one card, the same name.
    import copy
    from dataclasses import replace

    build = samples.sandrone_build()
    other = replace(build, weapon=replace(build.weapon, key="breezeborne-refrain", name="Breezeborne Refrain"))
    keep_builds(store, THURSDAY, [build_record(build), build_record(other, ident=2, name="Blade Bearer", wiki_entry=None)], calculator())
    keep_notes(store, THURSDAY)
    service = make_service(store, FakeClock(THURSDAY), tmp_path)
    await keep_wiki(service._wiki)
    data = copy.deepcopy(store.wiki_entry("10949").data)
    data["modules"]["Ascend"]["ascension"]["list"] = data["modules"]["Ascend"]["ascension"]["list"][:3]
    store.put_wiki_entry(WikiEntryRow("11733", "weapon", "Breezeborne Refrain", data, "7.1", THURSDAY))
    store.put_wiki_entry(material("8600", TIERS["8600"], domain("Monday/Thursday/Sunday", "Test Domain", "Forgery")))
    service.put_focus(["sandrone", "blade-bearer"])
    page = service.plan_page()
    assert [(w["series"], w["who"], w["weapons"]) for w in page["weapons"]] == [
        ("Far-North Scions", ["sandrone", "blade-bearer"], ["A Teaspoon of Transcendence", "Breezeborne Refrain"])
    ]
    assert page["rows"][0]["material"] == page["rows"][1]["material"] and page["rows"][0]["material"]["days"] == [0, 3, 6]


async def test_a_character_without_read_materials_says_so(store, tmp_path):
    page = (await planned(store, tmp_path, extra=True, book=None, weapon=None)).plan_page()
    row = next(r for r in page["rows"] if r["key"] == "unread-one")
    assert row["book"] is None and row["material"] is None
    sandrone = next(r for r in page["rows"] if r["key"] == "sandrone")   # her entries are read, her Teachings and Oblation are not
    assert sandrone["book"] is None and sandrone["material"] is None
    assert {"key": "unread-one", "book_next": None, "weapon_next": None} in page["idle"]
    assert page["count"] == 2 and [r["key"] for r in page["rows"]] == ["sandrone", "unread-one"]


async def test_a_row_names_her_weapon_and_her_face(store, tmp_path):
    row = (await planned(store, tmp_path)).plan_page()["rows"][0]
    assert (row["key"], row["name"], row["weapon"]["name"]) == ("sandrone", "Sandrone", "A Teaspoon of Transcendence")
    assert set(row) == {"key", "name", "icon", "weapon", "book", "material"} and set(row["weapon"]) == {"name", "icon"}


async def test_the_weekly_boss_materials_and_the_discounts_left(store, tmp_path):
    page = (await planned(store, tmp_path)).plan_page()
    assert [(w["material"], w["who"]) for w in page["weekly"]] == [("Madman's Restraint", ["sandrone"])]
    assert page["weekly"][0]["icon"] and page["discounts_left"] == 2


def _notes(store, at, discounts):
    keep_notes(store, at, discounts=discounts)


async def test_the_discounts_are_the_latest_read_of_the_day_not_the_first(store, tmp_path):
    service = await planned(store, tmp_path)   # a read at 08:00 says 2
    assert service.plan_page()["discounts_left"] == 2
    _notes(store, THURSDAY + timedelta(hours=1), 1)   # the player ran a boss; the next read says 1
    assert service.plan_page()["discounts_left"] == 1


async def test_a_read_of_last_week_says_three_discounts_after_the_weekly_reset(store, tmp_path):
    service = await planned(store, tmp_path, notes=False)
    _notes(store, datetime(2026, 11, 8, 18, 0, tzinfo=timezone.utc), 0)   # Sunday 19:00 on the Europe server: none left
    service._clock.set(datetime(2026, 11, 9, 2, 30, tzinfo=timezone.utc))   # Monday 03:30: the game day is still Sunday
    assert service.plan_page()["discounts_left"] == 0
    service._clock.set(datetime(2026, 11, 9, 4, 0, tzinfo=timezone.utc))   # Monday 05:00: the weekly reset has passed
    assert service.plan_page()["discounts_left"] == 3


async def test_without_a_notes_read_there_are_no_discounts_to_say(store, tmp_path):
    assert (await planned(store, tmp_path, notes=False)).plan_page()["discounts_left"] is None


async def test_the_addable_are_the_owned_characters_not_planned(store, tmp_path):
    service = await planned(store, tmp_path, extra=True)
    assert [c["key"] for c in service.plan_page()["addable"]] == []
    service.put_focus(["sandrone"])
    addable = service.plan_page()["addable"]
    assert [(c["key"], c["name"]) for c in addable] == [("unread-one", "Unread One")] and set(addable[0]) == {"key", "name", "icon"}
    assert service.plan_page()["count"] == 1


async def test_the_planned_list_holds_128_and_refuses_one_more(store, tmp_path):
    service = await planned(store, tmp_path)
    assert PLANNED_MAX == 128
    service.put_focus(["sandrone"])
    with pytest.raises(CharactersRefused, match="128"):
        service.put_focus([f"c{n}" for n in range(129)])
    with pytest.raises(UnknownCharacter):
        service.put_focus(["nobody"])
    assert service.focus() == ["sandrone"]   # a refused change leaves the list as it was


@pytest.fixture
def core(tmp_path):
    from guildboard.config import AppPaths
    from guildboard.core import Core
    from support import AccountSource, FakeSleep

    clock = FakeClock(THURSDAY)
    core = Core(
        AppPaths(tmp_path / "data"), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    keep_builds(core.store, THURSDAY, [build_record(samples.sandrone_build())], calculator())
    keep_notes(core.store, THURSDAY)
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with opened(core) as client:
        yield client


def test_the_planned_list_holds_more_than_four(client):
    keys = [e["key"] for e in client.get("/api/characters").json()["entries"]][:6]
    assert len(keys) == 6
    answer = client.put("/api/plan/characters", json={"characters": keys})
    assert answer.status_code == 200 and len(answer.json()["rows"]) == 6
    assert client.get("/api/plan").json()["count"] == 6


def test_the_planned_list_is_refused_above_128_and_for_an_unknown_key(client):
    refused = client.put("/api/plan/characters", json={"characters": [f"c{n}" for n in range(129)]})
    assert refused.status_code == 422 and "128" in refused.json()["error"]
    unknown = client.put("/api/plan/characters", json={"characters": ["nobody"]})
    assert (unknown.status_code, unknown.json()) == (422, {"error": "There is no such character."})
    assert client.put("/api/plan/characters", json={"characters": "sandrone"}).status_code == 422
    assert client.get("/api/plan").json()["count"] == 0


async def test_a_weapon_whose_tier_names_are_not_known_has_no_material_and_does_not_break_the_page(store, tmp_path, monkeypatch):
    # Every tier's entry is read, but the weapon's own page names none of them (no hint at all): there is no series to name, and the
    # page says "not read yet" for it instead of failing with an IndexError (a 500 that took the whole Plan page and Today down).
    service = await planned(store, tmp_path, weapon="Monday/Thursday/Sunday")
    monkeypatch.setattr("guildboard.characters.wiki.materials_of", lambda row: {})
    page = service.plan_page()
    assert page["rows"][0]["material"] is None and page["weapons"] == []
    assert page["idle"][0]["weapon_next"] is None
