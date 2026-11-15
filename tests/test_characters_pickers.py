"""The planner's pickers: the weapons of her type and every artifact set, as the two routes answer them."""
from __future__ import annotations

import pytest

import characters_samples as samples
from characters_service_support import SUNDAY, build_record, calculator, keep_builds, keep_notes
from characters_shape import problem_with
from guildboard.characters.wiki import CharacterWiki
from guildboard.store import WikiEntryRow, WikiItemRow
from support import FakeClock
from test_api_characters import _core, opened


@pytest.fixture
def clock():
    return FakeClock(SUNDAY)


@pytest.fixture
def core(tmp_path, clock):
    core = _core(tmp_path, clock)
    keep_builds(core.store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    keep_notes(core.store, clock.now())
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with opened(core) as client:
        yield client


def test_weapons_are_her_type_only(client):
    weapons = client.get("/api/characters/sandrone/weapons").json()["weapons"]
    assert weapons and all(w["key"] for w in weapons)
    assert "a-teaspoon-of-transcendence" in [w["key"] for w in weapons]
    assert "aquila-favonia" not in [w["key"] for w in weapons]          # a sword
    assert weapons[0]["rarity"] == 5
    assert all(w["rarity"] >= 3 for w in weapons)
    order = [(-w["rarity"], w["name"]) for w in weapons]
    assert order == sorted(order)
    assert all(problem_with(w, "WeaponChoice") is None for w in weapons)


def test_a_weapon_carries_its_numbers_at_level_90(client):
    teaspoon = next(w for w in client.get("/api/characters/sandrone/weapons").json()["weapons"]
                    if w["key"] == "a-teaspoon-of-transcendence")
    assert teaspoon["name"] == "A Teaspoon of Transcendence" and teaspoon["rarity"] == 5
    # kits.json's exact numbers (GO's curves); the wiki's, which the reference holds, are these rounded (674, 44.1%)
    assert teaspoon["base_atk"] == 674.3345 and teaspoon["sub"] == "cd" and teaspoon["sub_value"] == 44.1024


def test_a_physical_substat_uses_the_sim_blocks_key(client):
    subs = {w["sub"] for w in client.get("/api/characters/sandrone/weapons").json()["weapons"]}
    assert "physical" in subs and "phys" not in subs


def test_sets_list_every_set_with_its_2_piece(client):
    sets = client.get("/api/artifact-sets").json()["sets"]
    deep = next(s for s in sets if s["key"] == "disenchantment-in-deep-shadow")
    assert deep["two"] == [{"stat": "atk_pct", "value": 18}] and deep["icon"]
    assert all(problem_with(s, "SetChoice") is None for s in sets)
    assert [s["name"] for s in sets] == sorted(s["name"] for s in sets)


def test_a_set_with_a_physical_2_piece_uses_the_sim_blocks_key(client):
    sets = client.get("/api/artifact-sets").json()["sets"]
    stats = {e["stat"] for s in sets for e in s["two"]}
    assert "physical" in stats and "phys" not in stats


def test_an_unknown_character_is_404(client):
    assert client.get("/api/characters/nobody/weapons").status_code == 404
    assert client.get("/api/artifact-sets", params={"character": "nobody"}).status_code == 404


def test_a_weapon_with_effects_carries_them_as_the_planner_would_have(client):
    # the effects the planner used to hold for every weapon of her type: the route gives them for the weapon the player tests
    from guildboard.characters import kits

    weapons = {w["key"]: w for w in client.get("/api/characters/sandrone/weapons").json()["weapons"]}
    build = samples.sandrone_build()
    teaspoon = weapons["a-teaspoon-of-transcendence"]
    assert teaspoon["gear"] == kits.gear_of("weapons", "a-teaspoon-of-transcendence", build.constellation, build.ascension, "claymore")
    assert teaspoon["gear"]["effects"] and [t["name"] for t in teaspoon["gear"]["toggles"]] == ["a-teaspoon-of-transcendence:passive"]
    assert all(problem_with(w, "WeaponChoice") is None for w in weapons.values())
    shipped = kits.load_kits()["weapons"]
    # a weapon of her type with an effect or a toggle has gear, one with neither has none
    for key, weapon in weapons.items():
        item = kits.gear_of("weapons", key, build.constellation, build.ascension, "claymore")
        assert ("gear" in weapon) == bool(item["effects"] or item["toggles"]), key
    assert any(key in shipped for key in weapons)


def test_a_set_carries_its_effects_for_the_character_asked_about(client):
    from guildboard.characters import kits

    build = samples.sandrone_build()
    sets = {s["key"]: s for s in client.get("/api/artifact-sets", params={"character": "sandrone"}).json()["sets"]}
    shadow = sets["disenchantment-in-deep-shadow"]
    assert {e["pieces"] for e in shadow["gear"]["effects"]} == {2, 4}
    assert shadow["gear"] == kits.gear_of("sets", "disenchantment-in-deep-shadow", build.constellation, build.ascension, "claymore")
    assert len([s for s in sets.values() if "gear" in s]) > 30
    assert all(problem_with(s, "SetChoice") is None for s in sets.values())


def test_the_list_of_sets_asked_for_with_no_character_has_no_gear(client):
    assert all("gear" not in s for s in client.get("/api/artifact-sets").json()["sets"])


def test_with_the_verdict_off_the_pickers_carry_no_gear(client, monkeypatch):
    from guildboard import characters

    monkeypatch.setattr(characters, "VERDICT", False)
    assert all("gear" not in w for w in client.get("/api/characters/sandrone/weapons").json()["weapons"])
    assert all("gear" not in s for s in client.get("/api/artifact-sets", params={"character": "sandrone"}).json()["sets"])


def _newer(core, clock, *, entry: bool) -> None:
    """A weapon and a set the wiki lists that the reference files do not hold."""
    now = clock.now()
    core.store.replace_wiki_items("weapon", [WikiItemRow("weapon", "Moonbreaker", 5, "https://act-webstatic.hoyoverse.com/m.png", "9001", now),
                                             WikiItemRow("weapon", "Mystery Blade", 5, "https://act-webstatic.hoyoverse.com/b.png", "9002", now)])
    core.store.replace_wiki_items("set", [WikiItemRow("set", "Newest Set", 5, "https://act-webstatic.hoyoverse.com/s.png", "9003", now)])
    if entry:
        data = CharacterWiki._parse_entry(samples.wiki_entry_answer("10949"), "10949", "weapon")
        core.store.put_wiki_entry(WikiEntryRow("9001", "weapon", "Moonbreaker", data, "7.1", now))


def test_a_newer_weapon_takes_its_numbers_from_its_stored_entry(core, client, clock):
    _newer(core, clock, entry=True)
    weapons = {w["key"]: w for w in client.get("/api/characters/sandrone/weapons").json()["weapons"]}
    assert weapons["moonbreaker"]["base_atk"] == 674 and weapons["moonbreaker"]["sub"] == "cd"
    assert weapons["moonbreaker"]["rarity"] == 5 and weapons["moonbreaker"]["icon"]
    assert "mystery-blade" not in weapons                  # no entry stored: her type cannot be told


def test_a_newer_weapon_kits_json_has_takes_its_exact_numbers_from_there(core, client, clock, monkeypatch):
    # the wiki's entry rounds them (674, 44.1%); kits.json holds them at level 90 from GO's curves, as for the reference's weapons
    from guildboard.characters import reference

    real = reference.load_weapon_levels()
    moon = {"base_atk": 674.3346, "sub": "cd", "sub_value": 0.441024}
    monkeypatch.setattr(reference, "load_weapon_levels", lambda: {**real, "moonbreaker": moon})
    _newer(core, clock, entry=True)
    weapons = {w["key"]: w for w in client.get("/api/characters/sandrone/weapons").json()["weapons"]}
    assert (weapons["moonbreaker"]["base_atk"], weapons["moonbreaker"]["sub"], weapons["moonbreaker"]["sub_value"]) == (674.3346, "cd", 44.1024)


def test_a_newer_set_lists_with_no_numbers_until_its_entry_is_read(core, client, clock):
    _newer(core, clock, entry=False)
    new = next(s for s in client.get("/api/artifact-sets").json()["sets"] if s["key"] == "newest-set")
    assert new["name"] == "Newest Set" and new["two"] == [] and new["two_text"] == "" and new["icon"]


def test_an_unowned_character_has_her_weapons_too(client):
    weapons = client.get("/api/characters/keqing/weapons").json()["weapons"]     # in the inventory, no build
    keys = [w["key"] for w in weapons]
    assert "aquila-favonia" in keys and "a-teaspoon-of-transcendence" not in keys


# ------------------------------------------------------------------------------------------------ the pickers' entries

import copy
import json

from guildboard.characters.service import UnknownCharacter
from test_characters_service import _Counting, sandrone


def _listed(store, clock) -> None:
    now = clock.now()
    store.replace_wiki_items("weapon", [WikiItemRow("weapon", "Moonbreaker", 5, "https://act-webstatic.hoyoverse.com/m.png", "9001", now)])
    store.replace_wiki_items("set", [WikiItemRow("set", "Newest Set", 5, "https://act-webstatic.hoyoverse.com/s.png", "9003", now)])


def _counting_with_new_entries() -> _Counting:
    """The wiki's seam, which answers 9001 with the Teaspoon's entry as a weapon called Moonbreaker and 9003 with Sandrone's set's
    entry as a set called Newest Set."""
    counting = _Counting()
    recorded = counting._wiki

    def answer(url, **kwargs):
        for ident, name, old in (("9001", "Moonbreaker", "10949"), ("9003", "Newest Set", "10760")):
            if url.endswith(ident):
                entry = copy.deepcopy(samples.WIKI_RECORDED[old])
                entry["data"]["page"].update(id=ident, name=name)
                return json.dumps(entry).encode("utf-8")
        return recorded(url, **kwargs)

    counting._wiki = answer
    return counting


def test_the_pickers_queue_nothing_before_consent_or_in_the_demo(store, clock, tmp_path):
    consent = [False]
    service = sandrone(store, clock, tmp_path, ready=lambda: consent[0])
    counting = _counting_with_new_entries()
    service._wiki._fetch = counting
    _listed(store, clock)
    service.weapon_choices("sandrone")
    service.set_choices()
    assert service._wanted_entries == set() and service._wanted == set() and counting.asked == []
    consent[0] = True
    service._demo = True
    service.weapon_choices("sandrone")
    service.set_choices()
    assert service._wanted_entries == set() and service._wanted == set() and counting.asked == []


async def test_the_pickers_queue_the_missing_entries_and_read_them_in_the_background(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, ready=lambda: True)
    counting = _counting_with_new_entries()
    service._wiki._fetch = counting
    _listed(store, clock)
    before = service.weapon_choices("sandrone")
    assert "moonbreaker" not in [w["key"] for w in before]          # its entry is not stored: her type is not known
    assert ("weapon", "9001") in service._wanted_entries            # queued, and not read on the request itself
    assert [url for url in counting.asked if url.endswith("9001")] == []
    new_set = next(s for s in service.set_choices() if s["key"] == "newest-set")
    assert new_set["two"] == [] and new_set["two_text"] == "" and ("set", "9003") in service._wanted_entries
    await service._filler
    assert [url for url in counting.asked if url.endswith("9001")] != [] and [url for url in counting.asked if url.endswith("9003")] != []
    moon = next(w for w in service.weapon_choices("sandrone") if w["key"] == "moonbreaker")
    assert moon["base_atk"] == 674 and moon["sub"] == "cd" and moon["sub_value"] == 44.1
    new_set = next(s for s in service.set_choices() if s["key"] == "newest-set")
    assert new_set["two_text"] and new_set["four_text"]
    asked = len(counting.asked)
    service.weapon_choices("sandrone")
    assert service._wanted_entries == set()                        # stored now: nothing more is queued
    if service._filler is not None:
        await service._filler
    assert [url for url in counting.asked[asked:] if url.endswith(("9001", "9003"))] == []     # kept: not asked again


async def test_an_unknown_character_queues_nothing(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, ready=lambda: True)
    _listed(store, clock)
    with pytest.raises(UnknownCharacter):
        service.weapon_choices("nobody")
    assert service._wanted == set() and service._wanted_entries == set()


# ------------------------------------------------------------------------------------------------ entries of an older format


def _keep_old_character_entry(store, service, clock) -> None:
    store.put_wiki_entry(WikiEntryRow(
        "10920", "character", "Sandrone", {"id": "10920", "name": "Sandrone", "modules": {}}, service._wiki._version(), clock.now(),
    ))


def test_an_entry_of_an_older_format_is_queued_only_after_consent_and_never_in_the_demo(store, clock, tmp_path):
    consent = [False]
    service = sandrone(store, clock, tmp_path, ready=lambda: consent[0])
    counting = _Counting()
    service._wiki._fetch = counting
    _keep_old_character_entry(store, service, clock)
    service.wanted_again()
    assert service._wanted_entries == set() and service._wanted == set() and counting.asked == []
    consent[0] = True
    service._demo = True
    service.wanted_again()
    assert service._wanted_entries == set() and counting.asked == []


async def test_an_entry_of_an_older_format_is_read_again_in_the_background_once(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, ready=lambda: True)
    counting = _Counting()
    service._wiki._fetch = counting
    _keep_old_character_entry(store, service, clock)
    heard = service._bus.subscribe()
    service.wanted_again()
    assert ("character", "10920") in service._wanted_entries            # queued, and not read on the call itself
    assert counting.asked == []
    await service._filler
    published = []
    while not heard.empty():
        published.append(heard.get_nowait())
    assert {"type": "characters_changed"} in published                  # the entry was replaced, not added: the pages are told
    entries = lambda: [url.rsplit("=", 1)[1] for url in counting.asked if "entry_page_id=" in url]   # noqa: E731
    assert entries() == ["10920"]                                        # the lists are asked too, as for every read
    assert store.wiki_entry("10920").data["format"] == 2
    service.wanted_again()
    assert service._wanted_entries == set()                             # it is of the format now: nothing more is queued
    assert entries() == ["10920"]


async def test_a_wake_with_nothing_new_does_not_scan_the_store_again(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, ready=lambda: True)
    asked = []
    scan = store.wiki_entries_below_format

    def counting(kind, format_):
        asked.append(kind)
        return scan(kind, format_)

    store.wiki_entries_below_format = counting
    service.wanted_again()
    service.wanted_again()
    service.wanted_again()
    assert asked == ["character"]                                       # none was outdated, and nothing was kept since
    service._wiki.stored += 1                                           # an entry was kept: the next look scans again
    service.wanted_again()
    assert asked == ["character", "character"]
    # one that is outdated is not remembered as none
    _keep_old_character_entry(store, service, clock)
    service._wiki.stored += 1
    service.wanted_again()
    assert ("character", "10920") in service._wanted_entries
    service.wanted_again()
    assert asked == ["character"] * 3 + ["character"]


def test_a_set_whose_2_piece_gives_her_own_element_its_bonus_lists_it_for_her_alone(client):
    # Blizzard Strayer's 2-piece is Cryo DMG +15% "for a Cryo character": the tested stats swap it (Sandrone is Cryo), a Pyro set's they do not
    sets = {s["key"]: s for s in client.get("/api/artifact-sets", params={"character": "sandrone"}).json()["sets"]}
    assert sets["blizzard-strayer"]["two"] == [{"stat": "dmg", "value": 15.0}]
    assert sets["crimson-witch-of-flames"]["two"] == []                       # Pyro, and she is Cryo
    assert sets["long-night-s-oath"]["two"] == []                              # a move's bonus, not her element's
    assert sets["gladiator-s-finale"]["two"] == [{"stat": "atk_pct", "value": 18}]
    alone = {s["key"]: s for s in client.get("/api/artifact-sets").json()["sets"]}
    assert alone["blizzard-strayer"]["two"] == []                              # for no one in particular: only what holds for everyone
