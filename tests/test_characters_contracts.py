"""Task 1 of the Characters plan fixes the shapes the parts share. These tests hold them to the plan's "The contracts
between the parts": the engines' signatures, every model's fields, the records, the rows, the seams and the types, and the
samples and fixtures built on them. A part that changes another part's side of one fails here."""
from __future__ import annotations

import dataclasses
import inspect
import json
from datetime import date
from pathlib import Path

import pytest

import characters_samples as samples
import characters_shape
from guildboard import records, store as store_module
from guildboard.characters import (
    BUILT, ELEMENTS, FOCUS_MAX, HORIZON_DAYS, RESIN_PER_DAY, SLOTS, STATS, WEAPON_TYPES, art, damage, models, needs, notices,
    nextsteps, odds, readiness, stats, teams, theater, week, wiki, xray,
)
from guildboard.characters.service import Characters
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.sources import hoyolab
from support import FakeSleep

NO = inspect.Parameter.empty  # a parameter with no default

SIGNATURES = {
    stats: {
        "panel": [("build", NO)],
        "split": [("build", NO), ("refs", NO), ("own", NO)],
        "planned": [("build", NO), ("plan", NO), ("card", NO), ("refs", NO)],
        "in_combat": [("stats", NO), ("weapon", NO), ("refinement", NO), ("set_choice", NO), ("base_atk", NO), ("refs", NO)],
    },
    damage: {
        "estimate": [("combat", NO), ("card", NO), ("talent_level", NO), ("refs", NO)],
        "change": [("now", NO), ("plan", NO)],
    },
    readiness: {"score": [("build", NO), ("card", NO), ("refs", NO), ("combat", NO), ("weapon_level", None)]},
    xray: {"verdicts": [("build", NO), ("card", NO)], "roll_chart": [("build", NO), ("card", NO)]},
    nextsteps: {"rank": [("build", NO), ("card", NO), ("refs", NO), ("n", 3)]},
    needs: {
        "default_plan": [("build", NO), ("card", NO)],
        "amounts": [("build", NO), ("plan", NO), ("costs", NO)],
        "held_from_calculator": [("items", NO), ("has_user_info", NO)],
        "needs": [("amounts", NO), ("held", NO), ("typed", NO), ("sources", NO), ("names", NO)],
    },
    odds: {
        "per_run": [("slot", NO), ("main", NO), ("crit_main", NO), ("off_set", NO), ("refs", NO)],
        "chance": [("p", NO), ("runs", NO)],
        "day_reaching": [("p", NO), ("runs_by_day", NO), ("q", NO)],
    },
    week: {
        "plan": [
            ("focus", NO), ("resin_now", NO), ("resin_max", NO), ("discounts_left", NO), ("today", NO), ("refs", NO),
            ("ticks", frozenset()), ("weekly_done", frozenset()), ("horizon", 35),
        ],
    },
    teams: {"build_teams": [("pool", NO), ("max_teams", NO), ("lead", ())], "team_ready": [("team", NO)]},
    theater: {"elements": [("text", NO)]},
    notices: {
        "due": [
            ("now", NO), ("server", NO), ("week", NO), ("names", NO), ("switches", NO), ("sent", NO), ("ready_now", NO),
        ],
    },
}

FIELDS = {
    # models.py
    models.Sub: ["stat", "value", "rolls"],
    models.Piece: ["slot", "set_key", "set_name", "name", "icon", "level", "rarity", "main", "main_value", "subs"],
    models.WeaponState: ["key", "name", "icon", "type", "rarity", "level", "refinement", "base_atk", "sub", "sub_value"],
    models.Build: [
        "key", "level", "ascension", "constellation", "talents", "bonus", "weapon", "pieces", "base", "add",
    ],
    models.SetChoice: ["sets", "pieces"],
    models.Card: [
        "key", "name", "element", "weapon_type", "rarity", "pronouns", "roles", "keeps_alive", "scaling", "damage_talent",
        "talent_priority", "talent_table", "goals", "mains", "weights", "sets", "weapons", "partners", "partner_roles",
        "teams", "notes", "confidence", "early", "stars", "chart_size", "edited",
    ],
    models.Effect: ["stat", "values", "when", "condition"],
    models.WeaponRef: [
        "key", "name", "type", "rarity", "base_atk_90", "sub", "sub_90", "effects", "icon",
    ],
    models.SetRef: ["key", "name", "two", "four", "icons"],
    models.Source: ["kind", "where", "days"],
    models.Flower: ["key", "name", "places", "per_pass"],
    models.Refs: [
        "weapons", "sets", "yields", "mains_20", "main_odds", "sub_weights", "roll_avg", "scaling", "reactions", "flowers",
    ],
    models.TypedPiece: ["slot", "main", "subs", "use"],
    models.Plan: [
        "level", "talents", "weapon", "weapon_level", "refinement", "set", "mains", "level_pieces", "typed",
    ],
    models.Need: ["material", "name", "icon", "amount", "held", "exact", "source"],
    models.Costs: ["talent", "ascension", "weapon", "exp", "weapon_exp", "level_phase"],
    models.FocusInput: ["key", "name", "pronouns", "goal", "needs", "luck"],
    models.Task: ["key", "day", "kind", "who", "where", "runs", "resin", "gets", "free", "why"],
    models.DayPlan: ["day", "start", "spent", "tasks"],
    models.WeekPlan: ["days", "ready", "luck", "resin_by"],
    models.Member: ["key", "name", "element", "roles", "keeps_alive", "wants", "ready"],
    models.Team: ["members", "ready"],
    models.Readiness: ["total", "parts"],
    models.Verdict: ["slot", "verdict", "why", "crit_value", "rolls_wanted", "rolls_all"],
    models.Step: ["text", "gain", "value"],
    models.Notice: ["kind", "title", "body"],
    # records.py
    records.SubRecord: ["prop", "value", "times"],
    records.PieceRecord: [
        "pos", "name", "icon", "set_id", "set_name", "rarity", "level", "main_prop", "main_value", "subs",
    ],
    records.WeaponRecord: [
        "id", "name", "icon", "type", "rarity", "level", "refinement", "ascension", "base_atk", "sub_prop", "sub_value",
    ],
    records.SkillRecord: ["id", "skill_type", "name", "icon", "level"],
    records.PropRecord: ["prop", "base", "add", "final"],
    records.BuildRecord: [
        "id", "name", "element", "rarity", "level", "ascension", "constellation", "icon", "wiki_entry", "weapon",
        "pieces", "skills", "props", "side_icon", "image",
    ],
    records.BuildsRecord: ["builds", "prop_names"],
    records.CalcItemRecord: ["id", "name", "icon", "amount", "lacking"],
    records.CalculatorRecord: ["has_user_info", "items", "targets"],
    records.AbyssHalfRecord: ["chamber", "half", "stars", "characters", "enemies"],
    records.StygianBossRecord: ["name", "advantage", "disadvantage", "team", "seconds"],
    records.EndgameDetailRecord: [
        "abyss_stars", "abyss_halves", "abyss_ends", "theater_difficulty", "theater_acts", "theater_ends",
        "stygian_difficulty", "stygian_bosses", "stygian_ends",
    ],
    records.CalendarDetailRecord: ["theater_text", "banners"],
    records.CalcTarget: ["character_id", "level", "weapon", "talents"],
    # store.py
    store_module.CharPlanRow: ["uid", "character", "plan", "updated_at"],
    store_module.WikiEntryRow: ["entry_page_id", "kind", "name", "data", "version", "read_at"],
    store_module.ArtRow: ["key", "url", "file", "bytes", "read_at"],
    # wiki.py
    wiki.CharacterPage: [
        "key", "name", "entry", "icon", "art", "chart", "title", "affiliation", "birthday", "version", "dish", "element",
        "weapon_type", "rarity", "ascension_stat", "talents", "constellations", "own", "talent_costs", "ascension_costs",
        "material_names",
    ],
    wiki.WeaponPage: [
        "key", "name", "entry", "icon", "type", "rarity", "base_atk_90", "sub", "sub_90", "passive", "texts",
        "ascension_costs",
    ],
    wiki.SetPage: ["key", "name", "entry", "icons", "two_text", "four_text"],
    wiki.MaterialPage: ["id", "name", "icon", "type_text", "source"],
}

METHODS = {
    store_module.Store: {
        "focus": ["uid"], "put_focus": ["uid", "characters"], "char_plans": ["uid"],
        "put_char_plan": ["uid", "character", "plan", "at"], "drop_char_plan": ["uid", "character"],
        "card_edits": ["uid"], "put_card_edits": ["uid", "character", "edits", "at"], "ticks": ["uid", "since"],
        "put_tick": ["uid", "day", "task", "done", "at"], "held": ["uid"], "put_held": ["uid", "amounts", "at"],
        "theater_elements": ["uid", "month"], "put_theater_elements": ["uid", "month", "elements", "at"],
        "notices_sent": ["uid", "since"], "add_notice_sent": ["uid", "kind", "day", "at"],
        "wiki_entry": ["entry_page_id"], "wiki_entries": ["kind"], "put_wiki_entry": ["row"], "art": ["key"],
        "put_art": ["row"], "drop_art": ["key"], "art_rows": [],
    },
    wiki.CharacterWiki: {
        "lists": [], "entry": ["entry_page_id", "kind"], "character_page": ["row"], "weapon_page": ["row"],
        "set_page": ["row"], "material_page": ["row"],
    },
    art.ArtCache: {"key_for": ["url"], "get": ["key", "size"], "address": ["url"]},
}

CONSTRUCTORS = {
    wiki.CharacterWiki: ["store", "clock", "fetch", "version"],
    art.ArtCache: ["store", "paths", "clock", "fetch_bytes", "demo"],
    Characters: ["store", "clock", "bus", "wiki", "art", "pulls", "server", "uid", "demo"],
}


def test_the_engines_have_their_contract_signatures():
    for module, functions in SIGNATURES.items():
        for name, wanted in functions.items():
            parameters = list(inspect.signature(getattr(module, name)).parameters.values())
            assert [(p.name, p.default) for p in parameters] == wanted, f"{module.__name__}.{name}"
    assert inspect.iscoroutinefunction(wiki.CharacterWiki.lists) and inspect.iscoroutinefunction(wiki.CharacterWiki.entry)
    assert inspect.iscoroutinefunction(art.ArtCache.get)
    assert inspect.signature(wiki.parse_source).parameters.keys() == {"source_text", "type_text"}
    assert isinstance(stats.PROP_KEYS, dict)


def test_each_model_has_the_contracts_fields_and_is_frozen():
    for model, wanted in FIELDS.items():
        assert dataclasses.is_dataclass(model), model.__name__
        assert [field.name for field in dataclasses.fields(model)] == wanted, model.__name__
        assert model.__dataclass_params__.frozen, f"{model.__name__} is not frozen"


def test_the_constants_the_stores_and_the_wiki_have_the_contracts_names():
    assert ELEMENTS == ("Pyro", "Hydro", "Anemo", "Electro", "Dendro", "Cryo", "Geo")
    assert WEAPON_TYPES == ("Sword", "Claymore", "Polearm", "Bow", "Catalyst")
    assert SLOTS == ("flower", "plume", "sands", "goblet", "circlet")
    assert STATS == ("hp", "atk", "def", "hp_pct", "atk_pct", "def_pct", "em", "er", "cr", "cd", "dmg", "heal")
    assert (FOCUS_MAX, BUILT, RESIN_PER_DAY, HORIZON_DAYS) == (4, 50, 180, 35)
    assert art.ArtCache.CAP == 8 * 1024 * 1024
    for owner, names in METHODS.items():
        for name, wanted in names.items():
            parameters = [p for p in inspect.signature(getattr(owner, name)).parameters if p != "self"]
            assert parameters == wanted, f"{owner.__name__}.{name}"
    for owner, wanted in CONSTRUCTORS.items():
        parameters = list(inspect.signature(owner.__init__).parameters.values())[1:]
        # The contract's parameters come first; the service's later ones (its seams: cards, consent, notices) are keyword only.
        assert [p.name for p in parameters][:len(wanted)] == wanted, owner.__name__
        assert all(p.kind is p.KEYWORD_ONLY for p in parameters[len(wanted):]), owner.__name__


def test_the_hoyolab_source_takes_the_calculator_targets_and_does_not_use_them_yet():
    assert records.CalcTarget(1, (90, 90), None, ()).character_id == 1
    parameter = inspect.signature(hoyolab.HoyolabSource.__init__).parameters["calculator_targets"]
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default() == ()  # no target by default
    wanted = (records.CalcTarget(10000101, (1, 90), (1, 1, 90), ((10, 1, 10),)),)
    assert hoyolab.HoyolabSource(None, calculator_targets=lambda: wanted)._calculator_targets() == wanted


def test_the_core_builds_the_characters_modules_and_tells_the_pages_when_they_change(tmp_path, clock):
    core = Core(
        AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set()
    )
    try:
        assert isinstance(core.characters, Characters)
        assert isinstance(core.characters_wiki, wiki.CharacterWiki) and isinstance(core.art, art.ArtCache)
        events = core.bus.subscribe()
        core.characters_changed()
        assert [events.get_nowait() for _ in range(events.qsize())] == [{"type": "characters_changed"}]
        assert str(inspect.signature(Core.refresh_characters).return_annotation).startswith("dict")
        # The wiki's entries are kept by the game's version, which the calendar of versions.json gives for today.
        assert core._game_version() == "7.1"  # 20 days into its 42
        clock.advance(days=43)
        assert core._game_version() == "7.2"
    finally:
        core.store.close()


# ---------------------------------------------------------------------------------------------- the samples


def test_the_samples_give_the_panel_the_mockup_shows():
    build = samples.sandrone_build()
    for key, shown in samples.SANDRONE_PANEL.items():
        assert build.base[key] + build.add[key] == pytest.approx(shown, abs=0.05), key
    assert build.base["atk"] == samples.sandrone_own()["atk"] + build.weapon.base_atk  # her 342 and the Teaspoon's 674
    assert (build.level, build.ascension, build.constellation) == (90, 6, 2)
    assert build.talents == {"normal": 9, "skill": 10, "burst": 10}
    assert set(build.pieces) == set(SLOTS) and build.pieces["plume"].level == 16
    # 41 rolls in all, as the profile says; a roll count is times + 1, so each piece has 6 to 9 of them.
    assert sum(sub.rolls for piece in build.pieces.values() for sub in piece.subs) == 41
    assert all(sub.stat in STATS for piece in build.pieces.values() for sub in piece.subs)


def test_the_cards_and_the_references_are_made_of_the_contracts_keys():
    card, refs = samples.sandrone_card(), samples.refs_sample()
    assert card.element in ELEMENTS and card.weapon_type in WEAPON_TYPES
    assert set(card.goals) <= set(STATS) and set(card.weights) <= set(STATS)
    assert set(card.weights.values()) == {"wants", "some", "none"}
    assert set(card.weapons) <= set(refs.weapons) and set(card.sets[0].sets) <= set(refs.sets)
    assert refs.scaling["elemental"][8:10] == (1.70, 1.80)  # levels 9 and 10
    assert len(refs.scaling["elemental"]) == 15
    assert {slot: set(odds) for slot, odds in refs.main_odds.items()}["goblet"] >= {"dmg", "atk_pct"}
    assert refs.yields == {"books": 1.17, "boss": 2.5, "artifact_5star": 1.065}
    assert refs.flowers["flockingweed"].per_pass == 14
    assert sum(refs.main_odds["sands"].values()) == pytest.approx(1.0, abs=0.001)


def test_the_week_and_endgame_samples_are_the_mockups():
    focus = samples.week_focus()
    assert [f.key for f in focus] == ["sandrone", "odette", "alyosha", "jahoda"]
    assert samples.WEEK_TODAY == date(2026, 10, 25) and samples.WEEK_TODAY.weekday() == 6  # a Sunday
    assert (samples.WEEK_RESIN_NOW, samples.WEEK_RESIN_MAX) == (200, 200)
    assert [(n.name, n.amount) for n in focus[0].needs] == [("Madman's Restraint", 1), ("Philosophies of Vagrancy", 7)]
    assert focus[0].luck == (("Cryo DMG Bonus goblet", 0.00554),)
    assert focus[3].needs[1].material == "philosophies-of-vagrancy" and focus[3].needs[1].source.days == (2, 5, 6)

    roster = samples.endgame_roster()
    assert len(roster) == 15 and roster[0].key == "sandrone" and roster[12].key == "lan-yan"
    assert [m.ready for m in roster[:4]] == [78, 64, 52, 70]
    assert [m.ready for m in samples.endgame_roster(after=True)[:4]] == [91, 80, 70, 80]
    roles = {m.key: m.roles for m in roster}
    assert roles["sandrone"] == ("damage",) and roles["jahoda"] == ("healer",) and roles["columbina"] == ("support",)
    assert {m.key for m in roster if m.keeps_alive} == {"jahoda", "ineffa", "dahlia", "lan-yan"}
    assert roster[0].wants == ("Electro", "Anemo") and roster[1].wants == ("Electro", "Hydro")
    assert [boss.name for boss in samples.endgame_bosses()][2] == "Chimeric Winged Lion"


# ---------------------------------------------------------------------------------------------- the interface's types


FIXTURES = Path(__file__).resolve().parents[1] / "web" / "src" / "fixtures" / "characters"
FIXTURE_TYPES = {
    "roster": "Roster", "profile": "Profile", "planner": "Planner", "week": "Week", "endgame": "Endgame",
}


def test_the_types_file_names_every_type_of_the_contract_and_the_shape_reader_reads_them():
    types = characters_shape.read_types()
    assert set(types) == set(characters_shape.NAMES)
    assert types["PlanBody"][0]["mains"] == [("record", ["'sands'", "'goblet'", "'circlet'"], ["string"], True)]
    assert types["Profile"][0]["stars"] == [("array", ("tuple", [["number"], ["number"]])), "null"]
    assert types["Profile"][0]["chart_size"] == [("tuple", [["number"], ["number"]]), "null"]
    # The check holds a value to its type, with no key more and none fewer.
    assert characters_shape.problem_with({"she": "she", "her": "her", "hers": "her"}, "Pronouns") is None
    assert "keys" in characters_shape.problem_with({"she": "she", "her": "her"}, "Pronouns")
    assert "not" in characters_shape.problem_with({"she": 1, "her": "her", "hers": "her"}, "Pronouns")
    assert characters_shape.problem_with({"sands": "atk_pct"}, "PlanBody") is not None
    assert characters_shape.problem_with("Dendro", "Element") is None
    assert characters_shape.problem_with("Plasma", "Element") is not None


def test_the_fixtures_match_their_types():
    for name, type_name in FIXTURE_TYPES.items():
        fixture = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
        assert characters_shape.problem_with(fixture, type_name) is None, name


def test_the_fixtures_hold_the_mockups_numbers():
    profile = json.loads((FIXTURES / "profile.json").read_text(encoding="utf-8"))
    assert profile["key"] == "sandrone" and profile["constellation"] == 2 and profile["level"] == 90
    assert {row["key"]: row["text"] for row in profile["stats"]}["atk"] == "2,964"
    assert profile["rolls_by"] == {"wants": 28, "some": 5, "none": 8}
    assert sum(row["rolls"] for row in profile["rolls"]) == 41
    week = json.loads((FIXTURES / "week.json").read_text(encoding="utf-8"))
    assert [card["key"] for card in week["focus"]] == ["sandrone", "odette", "alyosha", "jahoda"]
    assert len(week["days"]) == 7 and week["days"][0]["today"] and week["today"] == week["days"][0]
    planner = json.loads((FIXTURES / "planner.json").read_text(encoding="utf-8"))
    assert planner["with_plan"]["change"] == 35 and planner["plan"]["talents"]["normal"] == 10
    endgame = json.loads((FIXTURES / "endgame.json").read_text(encoding="utf-8"))
    assert [mode["key"] for mode in endgame["modes"]] == ["abyss", "theater", "stygian"]
    assert [element for element in endgame["theater"]["elements"]] == ["Cryo", "Electro", "Anemo"]


def test_the_events_the_interface_reads_again_on_name_characters_changed():
    live = (Path(__file__).resolve().parents[1] / "web" / "src" / "live.ts").read_text(encoding="utf-8")
    assert "'characters_changed'" in live
