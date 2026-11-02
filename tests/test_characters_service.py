"""Task V1: the Characters service and the page models for the roster, profile, planner, week and endgame, from a store seeded
with the samples, the wiki's recorded entries and a Pulls planner with fixed 5-stars. Every model is held to types.ts."""
from __future__ import annotations

import dataclasses
from datetime import datetime, timezone

import pytest

import characters_samples as samples
from characters_service_support import (
    SUNDAY, UID, Pulls, build_record, calculator, keep_builds, keep_notes, keep_wiki, make_service,
)
from characters_shape import problem_with
from guildboard.characters import bridge, reference
from guildboard.characters.models import Card, Readiness
from guildboard.characters.service import (
    LOGIN_FIRST, SYNC_OFF, CharactersRefused, UnknownCharacter,
)

NOW = SUNDAY


@pytest.fixture
def clock():
    from support import FakeClock

    return FakeClock(NOW)


def sandrone(store, clock, tmp_path, *, has_user_info: bool = True, **kwargs):
    """A service for an account whose only character is Sandrone, with her wiki entries kept."""
    return _service(store, clock, tmp_path, has_user_info=has_user_info, **kwargs)


def _service(store, clock, tmp_path, *, has_user_info: bool = True, **kwargs):
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], calculator(has_user_info))
    keep_notes(store, clock.now())
    return make_service(store, clock, tmp_path, **kwargs)


def check(model, name: str) -> None:
    assert problem_with(model, name) is None


def test_a_build_goes_through_hoyolabs_record_and_back_as_the_same_build(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    assert service.char("sandrone").build == samples.sandrone_build()


def test_talents_all_of_skill_type_1_are_read_in_order_with_the_burst_last_and_the_passives_left_out(store, clock, tmp_path):
    # Should HoYoLAB mark the three talents with levels (and a sprint, for some) all as type 1 and the passives as type 2,
    # the first is the Normal Attack, the second the Skill and the last the Burst.
    from guildboard.records import SkillRecord

    build = samples.sandrone_build()
    record = dataclasses.replace(build_record(build), skills=(
        SkillRecord(101, 1, "Normal Attack", "", build.talents["normal"] + build.bonus["normal"]),
        SkillRecord(102, 1, "Skill", "", build.talents["skill"] + build.bonus["skill"]),
        SkillRecord(109, 1, "Alternate sprint", "", 1),
        SkillRecord(103, 1, "Burst", "", build.talents["burst"] + build.bonus["burst"]),
        SkillRecord(104, 2, "First passive", "", 1),
        SkillRecord(105, 2, "Second passive", "", 1),
    ))
    keep_builds(store, clock.now(), [record], calculator())
    keep_notes(store, clock.now())
    service = make_service(store, clock, tmp_path)
    assert service.char("sandrone").build.talents == build.talents
    service.put_focus(["sandrone"])
    asked = {ident for ident, _, _ in service.calculator_targets()[0].talents}
    assert asked <= {101, 102, 103}


def test_the_roster_lists_every_wiki_character_with_the_owned_first_and_the_focus_numbered(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    service.put_focus(["odette", "sandrone"])
    roster = service.roster()
    check(roster, "Roster")
    inventory = reference.load_inventory()["characters"]
    assert roster["all"] == len(roster["entries"]) == len(inventory) and roster["owned"] == 1
    first = roster["entries"][0]
    assert (first["key"], first["owned"], first["level"], first["constellation"], first["focus"]) == ("sandrone", True, 90, 2, 2)
    assert first["readiness"] == 89
    assert roster["focus"] == ["odette", "sandrone"]
    odette = next(entry for entry in roster["entries"] if entry["key"] == "odette")
    assert (odette["owned"], odette["readiness"], odette["focus"]) == (False, 0, 1)
    assert not any(entry["owned"] for entry in roster["entries"][1:])


def test_a_fifth_character_in_the_focus_is_refused_and_an_unknown_one_is_not_a_character(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    with pytest.raises(CharactersRefused, match="Four at most: take one out first."):
        service.put_focus(["sandrone", "odette", "alyosha", "jahoda", "nefer"])
    with pytest.raises(UnknownCharacter):
        service.put_focus(["nobody"])
    assert service.focus() == []


async def test_the_profile_of_her_example_build_matches_the_mockup(store, clock, tmp_path):
    fives = (
        ("character", "Sandrone", 71, "won", datetime(2026, 7, 2, 12, 0, tzinfo=timezone.utc)),
        ("character", "Qiqi", 80, "lost", datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)),
        ("character", "Sandrone", 44, "guaranteed", datetime(2026, 7, 9, 12, 0, tzinfo=timezone.utc)),
        ("character", "Sandrone", 62, "won", datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)),
    )
    service = sandrone(store, clock, tmp_path, pulls=Pulls(fives))
    await keep_wiki(service._wiki)
    profile = service.profile("sandrone")
    check(profile, "Profile")
    texts = {row["key"]: row["text"] for row in profile["stats"]}
    assert (texts["hp"], texts["atk"], texts["cr"], texts["cd"], texts["er"]) == ("20,152", "2,964", "79.4%", "176.5%", "122.7%")
    atk = next(row for row in profile["stats"] if row["key"] == "atk")
    assert (round(atk["her"]), round(atk["weapon"]), round(atk["artifacts"])) == (342, 958, 1664)
    assert sum(profile["rolls_by"].values()) == sum(row["rolls"] for row in profile["rolls"]) == 41
    assert profile["readiness"]["total"] == 89
    assert [step["gain"] for step in profile["next_steps"]] == ["about +31% damage", "about +6% damage", "about +3% damage"]
    assert profile["next_steps"][0]["text"] == "Replace the Goblet with a Cryo DMG Bonus goblet that has Crit Rate or Crit DMG."
    assert [(p["at"], p["pity"], p["result"], p["after"]) for p in profile["pity"]] == [
        ("2026-07-02", 71, "won", None), ("2026-07-09", 44, "guaranteed", "Qiqi"), ("2026-07-14", 62, "won", None),
    ]
    assert profile["title"] == "Mirrored Analysis" and profile["constellations"][0]["owned"] is True
    assert [c["owned"] for c in profile["constellations"]] == [True, True, False, False, False, False]
    assert [p["verdict"] for p in profile["pieces"]] == ["keep", "level", "keep", "replace", "keep"]
    assert profile["next_level"]["talent"] == "Normal Attack"
    vagrancy = next(row for row in profile["next_level"]["materials"] if row["key"] == "philosophies-of-vagrancy")
    assert (vagrancy["held"], vagrancy["needed"], vagrancy["state"], vagrancy["held_exact"]) == (9, 16, "missing", True)


async def test_the_planner_with_the_default_plan_shows_35_percent_and_readiness_89_to_99(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    await keep_wiki(service._wiki)
    planner = service.planner("sandrone")
    check(planner, "Planner")
    assert planner["now"] == {"readiness": 89, "damage": 100}
    assert planner["with_plan"] == {"readiness": 99, "damage": 135, "change": 35}
    assert planner["now_build"] == {"level": 90, "refinement": 1, "weapon_level": 90}
    assert planner["plan"]["mains"] == {"sands": "atk_pct", "goblet": "dmg", "circlet": "cr"}
    assert planner["plan"]["level_pieces"] == ["plume"] and planner["damage_role"] is True and planner["warning"] is None
    assert [(t["now"], t["target"]) for t in planner["talents"]] == [(9, 10), (10, 10), (10, 10)]
    assert planner["weapons"][0]["key"] == samples.TEASPOON and planner["weapons"][0]["tag"] == "Hers"
    find = planner["takes"]["find"][0]
    assert find["per_run"] == pytest.approx(0.00554, abs=1e-5)
    assert [path["odds"] for path in find["paths"]] == ["Certain", "1 in 181 runs", "1 in 361 runs", "1 in 192 tries"]
    assert planner["days"]["half"] is not None and len(planner["days"]["points"]) == 50


async def test_the_planner_keeps_a_put_plan_and_its_typed_piece(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    await keep_wiki(service._wiki)
    body = service.planner("sandrone")["plan"]
    body["typed"] = {"slot": "goblet", "main": "dmg", "subs": [["cr", 10.5], ["cd", 21.0]], "use": False}
    body["refinement"] = 2
    body["weights"] = {**body["weights"], "em": "wants"}
    service.put_plan("sandrone", body)
    again = service.planner("sandrone")
    check(again, "Planner")
    assert again["plan"]["typed"] == body["typed"] and again["plan"]["refinement"] == 2
    assert again["plan"]["weights"]["em"] == "wants"
    assert again["try"]["crit_value"] == 42.0 and again["try"]["change"] is not None
    assert service.profile("sandrone")["card"]["edited"] == ["weights"]
    service.drop_plan("sandrone")
    assert service.planner("sandrone")["plan"]["refinement"] == 1


@pytest.mark.parametrize("change, sentence", [
    ({"talents": {"normal": 11, "skill": 10, "burst": 10}}, "Choose talent levels from 1 to 10."),
    ({"level": 91}, "Choose a level from 1 to 90."),
    ({"refinement": 6}, "Choose a refinement from 1 to 5."),
    ({"typed": {"slot": "goblet", "main": "dmg", "subs": [["cr", 101]], "use": True}}, "Give each substat as a number from 0 to 100."),
])
async def test_a_plan_with_a_value_out_of_range_is_refused_with_its_sentence(store, clock, tmp_path, change, sentence):
    service = sandrone(store, clock, tmp_path)
    body = {**service.planner("sandrone")["plan"], **change}
    with pytest.raises(CharactersRefused, match=sentence):
        service.put_plan("sandrone", body)


async def test_the_planner_says_sync_is_off_and_takes_typed_amounts(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, has_user_info=False)
    await keep_wiki(service._wiki)
    planner = service.planner("sandrone")
    assert planner["sync"]["calculator"] == "off"
    assert planner["sync"]["message"] == SYNC_OFF == (
        "Calculator sync is off in HoYoLAB, so Guild Board can't see what you hold. Switch it on in HoYoLAB's Enhancement "
        "Progression Calculator, or type what you hold here."
    )
    rows = {row["key"]: row for row in planner["takes"]["materials"]}
    assert (rows["philosophies-of-vagrancy"]["held"], rows["philosophies-of-vagrancy"]["state"]) == (None, "unknown")
    assert rows["philosophies-of-vagrancy"]["needed"] == 16
    service.put_held({"philosophies-of-vagrancy": 4})
    row = next(r for r in service.planner("sandrone")["takes"]["materials"] if r["key"] == "philosophies-of-vagrancy")
    assert (row["held"], row["state"], row["typed"]) == (4, "missing", True)
    service.put_held({"philosophies-of-vagrancy": None})
    assert service.store.held(UID) == {}


async def test_the_planners_resin_note_speaks_of_the_character_with_the_pronouns_of_the_card(store, clock, tmp_path):
    he = dataclasses.replace(samples.sandrone_card(), pronouns=("he", "him", "his"))
    service = sandrone(store, clock, tmp_path, cards=lambda key: he if key == "sandrone" else None)
    keep_notes(store, clock.now(), resin=0, discounts=0)
    await keep_wiki(service._wiki)
    service.put_focus(["sandrone"])
    assert service.planner("sandrone")["takes"]["today_note"] == "Nothing to farm for him with resin today."


async def test_the_profile_and_planner_speak_of_him_with_his_cards_pronouns(store, clock, tmp_path):
    he = dataclasses.replace(samples.sandrone_card(), pronouns=("he", "him", "his"))
    service = sandrone(store, clock, tmp_path, cards=lambda key: he if key == "sandrone" else None)
    await keep_wiki(service._wiki)
    service.put_focus(["sandrone"])
    profile, planner = service.profile("sandrone"), service.planner("sandrone")
    assert profile["stats"][0]["how"].startswith("His own ")
    assert next(part["text"] for part in profile["readiness"]["parts"] if part["key"] == "weapon") == "His best, R1"
    assert [option["tag"] for option in planner["weapons"] if option["tag"] is not None][0] == "His"
    assert "His" in [option["tag"] for option in planner["sets"]]
    assert [path["label"] for path in planner["takes"]["find"][0]["paths"][2:]] == [
        "His set's domain only", "Strongbox, his set, 3 artifacts a try",
    ]
    they = dataclasses.replace(he, pronouns=("they", "them", "their"))
    service = sandrone(store, clock, tmp_path, cards=lambda key: they if key == "sandrone" else None)
    body = dict(service.planner("sandrone")["plan"], mains={"sands": "atk_pct", "goblet": "atk_pct", "circlet": "cr"})
    service.put_plan("sandrone", body)   # the main stats she wears: no piece to find
    planner = service.planner("sandrone")
    assert [option["tag"] for option in planner["weapons"] if option["tag"] is not None][0] == "Theirs"
    assert planner["days"]["summary"].endswith("Nothing they need depends on luck.")
    service.put_plan("sandrone", dict(body, mains={"sands": "er", "goblet": "dmg", "circlet": "cr"}))
    assert "All new pieces: " in service.planner("sandrone")["days"]["summary"]   # two to find, as planner.html says it


def test_the_weeks_lines_on_how_it_plans_speak_of_any_character_as_they():
    from guildboard.views.week import HOW

    assert "A character is ready the day everything their goal needs is in." in HOW[3]
    assert not any(word in line.split() for line in HOW for word in ("her", "she", "hers"))


def test_a_character_without_a_card_falls_back_and_says_so(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, cards=lambda key: None)
    profile = service.profile("sandrone")
    check(profile, "Profile")
    assert profile["card"]["confidence"] == "none" and profile["pronouns"] == {"she": "they", "her": "them", "hers": "their"}
    assert bridge.NONE_SENTENCE == "No researched card yet; these are defaults."
    assert service.char("sandrone").card.notes == bridge.NONE_SENTENCE
    assert service.char("sandrone").card.roles == ("damage",)   # her ascension stat is Crit Rate
    # someone not owned, with no card, has a page too, and nothing fails
    nobody = service.profile("escoffier")
    check(nobody, "Profile")
    assert nobody["owned"] is False and nobody["pieces"] == [] and nobody["weapon"] is None
    check(service.planner("escoffier"), "Planner")
    assert service.planner("escoffier")["now_build"] is None
    assert [row["key"] for row in nobody["stats"]] == list(service.char("escoffier").card.goals)


def test_a_researched_card_takes_the_roles_default_goal_it_lacks_and_keeps_the_one_it_has(store, clock, tmp_path):
    bare = dataclasses.replace(samples.sandrone_card(), goals={"cd": 210.0})
    kept = sandrone(store, clock, tmp_path, cards=lambda key: bare if key == "sandrone" else None).char("sandrone").card
    assert kept.goals == {"cd": 210.0, "cr": 70.0, "er": 110.0}   # the damage role's defaults fill what it left out
    full = sandrone(store, clock, tmp_path).char("sandrone").card
    assert full.goals == samples.sandrone_card().goals          # a card that gives them is kept as it is
    support = dataclasses.replace(samples.sandrone_card(), roles=("support",), goals={})
    assert bridge.with_default_goals(support).goals == bridge.DEFAULT_GOALS["support"]
    assert bridge.fallback_card("x", "X", "Pyro", "Bow", 5, "CRIT DMG", samples.refs_sample()).goals == bridge.DEFAULT_GOALS["damage"]


def test_without_a_login_the_profile_says_nothing_is_owned_and_the_roster_still_lists_everyone(store, clock, tmp_path):
    service = make_service(store, clock, tmp_path, sync=lambda: {"login": True})
    roster = service.roster()
    assert roster["owned"] == 0 and roster["all"] > 100 and roster["sync"]["message"] == LOGIN_FIRST
    assert roster["sync"]["can_refresh"] is False


def test_the_week_has_seven_days_today_first_and_sundays_loud_alert(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    service.put_focus(["sandrone"])
    week = service.week()
    check(week, "Week")
    assert len(week["days"]) == 7 and week["days"][0]["today"] and not any(d["today"] for d in week["days"][1:])
    assert week["days"][0]["label"] == "Sunday 25 October" and week["days"][0]["start"] == 200
    assert week["days"][0]["alert"] == {"text": "Weekly bosses reset tomorrow at 04:00: do them today.", "loud": True}
    assert week["days"][1]["alert"]["loud"] is False and week["days"][2]["alert"] is None
    assert week["today"] == week["days"][0]
    assert week["focus"][0]["key"] == "sandrone" and week["focus"][0]["position"] == 1
    assert week["resin_week_max"] == 200 + 6 * 180


def test_the_week_with_no_focus_says_to_choose_one(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    week = service.week()
    check(week, "Week")
    assert week["focus"] == [] and week["ready"] == [] and week["resin_by"] == []
    assert all(day["tasks"] == [] and day["spare"] == "Choose up to four characters to plan for." for day in week["days"])
    assert week["today"]["spare"] == "Choose up to four characters to plan for."


async def test_a_tick_marks_a_task_done_and_only_todays_tasks_can_be_ticked(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    await keep_wiki(service._wiki)
    service.put_focus(["sandrone"])
    today = service.week()["today"]
    assert today["tasks"], "she has something to do today"
    key = today["tasks"][0]["key"]
    service.put_tick("2026-10-25", key, True)
    after = service.week()
    assert [t["done"] for t in after["today"]["tasks"]][0] is True
    assert [t["key"] for t in after["today"]["tasks"]] == [t["key"] for t in today["tasks"]]
    with pytest.raises(CharactersRefused, match="Only today's tasks can be ticked."):
        service.put_tick("2026-10-26", key, True)
    with pytest.raises(CharactersRefused, match="Only today's tasks can be ticked."):
        service.put_tick("2026-10-25", "no such task", True)
    service.put_tick("2026-10-25", key, False)
    assert service.week()["today"]["tasks"][0]["done"] is False


# ------------------------------------------------------------------------------------------------ the endgame

ABYSS_LOST = {"chamber": "12-3", "half": 2, "stars": 2, "enemies": []}


def endgame_service(store, clock, tmp_path):
    """The fifteen characters of endgame.html as owned characters with its readiness, and this month's endgame records."""
    now, after = samples.endgame_roster(), {m.key: m.ready for m in samples.endgame_roster(after=True)}
    members = {m.key: m for m in now}
    cards = {
        key: dataclasses.replace(
            samples.sandrone_card(), key=key, name=m.name, element=m.element, roles=m.roles, keeps_alive=m.keeps_alive,
            partners=m.wants,
        )
        for key, m in members.items()
    }
    records = [
        build_record(samples.sandrone_build(), ident=index, name=m.name, element=m.element, wiki_entry=None)
        for index, m in enumerate(now, 1)
    ]
    ids = {m.key: index for index, m in enumerate(now, 1)}
    keep_builds(store, clock.now(), records)
    keep_notes(store, clock.now())
    first, second = "12-3", "12-3"
    store.set_latest_doc("endgame", clock.now(), {
        "modes": [
            {"mode": "abyss", "label": "Spiral Abyss", "has_data": True, "result_text": "33 of 36 stars", "score": 33.0,
             "period_start": None, "period_end": "2026-11-16T02:59:59+00:00", "period_label": ""},
            {"mode": "theater", "label": "Imaginarium Theater", "has_data": True, "result_text": "Act 9 reached", "score": 9.0,
             "period_start": None, "period_end": "2026-10-31T23:59:59+00:00", "period_label": ""},
        ],
        "detail": {
            "abyss_stars": 33,
            "abyss_halves": [{**ABYSS_LOST, "characters": [ids[k] for k in ("sandrone", "ineffa", "lan-yan", "jahoda")]}],
            "stygian_difficulty": 5,
            "stygian_bosses": [
                {"name": b.name, "advantage": list(b.advantage), "disadvantage": list(b.disadvantage), "team": [], "seconds": None}
                for b in samples.endgame_bosses()
            ],
        },
    })
    store.set_latest_doc("calendar", clock.now(), {
        "banners": 0, "events": 0,
        "detail": {"theater_text": "Characters of Cryo, Electro and Anemo are boosted this month.", "banners": []},
    })
    service = make_service(store, clock, tmp_path, cards=lambda key: cards.get(key))
    service.readiness_now = lambda char: Readiness(total=members[char.key].ready, parts={})
    service.readiness_after = lambda char, plan=None: Readiness(total=after[char.key], parts={})
    service.put_focus(["sandrone", "odette", "alyosha", "jahoda"])
    return service


def _keys(team):
    return [m["key"] for m in team["members"]]


def test_the_endgame_now_and_after_matches_e5(store, clock, tmp_path):
    service = endgame_service(store, clock, tmp_path)
    now = service.endgame(False)
    check(now, "Endgame")
    assert [_keys(t) for t in now["abyss"]] == [
        ["nefer", "dahlia", "lauma", "columbina"], ["sandrone", "ineffa", "lan-yan", "jahoda"],
    ]
    assert [t["ready"] for t in now["abyss"]] == [79, 75]
    assert "You lost a star in 12-3, second half" in now["abyss"][1]["note"] and "weakest member is Jahoda, at 70%" in now["abyss"][1]["note"]
    assert [m["value"] for m in now["modes"]] == ["33 of 36 stars", "Cryo, Electro, Anemo", "Difficulty 5 of 6"]
    assert now["modes"][0]["text"] == "Your two teams for floor 12 are 77% ready. Resets Mon 16 Nov."
    assert [(s["name"], _keys(s["team"]), s["team"]["ready"]) for s in now["stygian"]] == [
        ("Guardian Blade of Drifting Snow", ["nefer", "dahlia", "lauma", "columbina"], 79),
        ("Fae of Crystalline Flesh", ["sandrone", "ineffa", "lan-yan", "columbina"], 77),
        ("Chimeric Winged Lion", ["nefer", "ineffa", "lauma", "iansan"], 80),
    ]
    assert now["theater"]["from_calendar"] is True and now["theater"]["elements"] == ["Cryo", "Electro", "Anemo"]
    assert [c["ready"] for c in now["theater"]["cast"]] == [2, 3, 2]
    assert [c["element"] for c in now["theater"]["cast"] if c["thinnest"]] == ["Anemo"]
    assert [(c["key"], c["to_go"]) for c in now["theater"]["close"]] == [("vesna", 10)]
    assert [(c["title"], c["action"], c["target"]) for c in now["clear"]][0] == ("Finish Sandrone's plan", "planner", "sandrone")
    assert [c["action"] for c in now["clear"][1:]] == ["focus", "focus"] and now["clear"][1]["target"] == "vesna"
    after = service.endgame(True)
    check(after, "Endgame")
    assert after["after"] is True
    assert [_keys(t) for t in after["abyss"]] == [
        ["sandrone", "jahoda", "ineffa", "columbina"], ["nefer", "dahlia", "lauma", "alyosha"],
    ]
    assert [t["ready"] for t in after["abyss"]] == [84, 77]


def test_a_stygian_boss_two_elements_do_well_against_is_said_in_the_plural(store, clock, tmp_path):
    service = endgame_service(store, clock, tmp_path)
    _, doc = store.latest_doc("endgame")
    doc["detail"]["stygian_bosses"][0]["advantage"] = ["Pyro", "Geo"]   # led by neither in the roster
    store.set_latest_doc("endgame", clock.now(), doc)
    action = service.endgame(False)["clear"][2]
    assert action["text"] == "Pyro and Geo do well against it, and none of your teams leads with Pyro or Geo yet."


def test_the_theater_pick_is_used_when_the_calendar_names_no_elements(store, clock, tmp_path):
    service = endgame_service(store, clock, tmp_path)
    store.set_latest_doc("calendar", clock.now(), {"banners": 0, "events": 0, "detail": {"theater_text": "A month of trials.", "banners": []}})
    bare = service.endgame(False)["theater"]
    assert (bare["elements"], bare["from_calendar"], bare["cast"]) == ([], False, [])
    service.put_theater(["Pyro", "Hydro", "Geo"])
    picked = service.endgame(False)["theater"]
    assert (picked["elements"], picked["from_calendar"]) == (["Pyro", "Hydro", "Geo"], False)
    with pytest.raises(CharactersRefused, match="Choose three different elements."):
        service.put_theater(["Pyro", "Pyro", "Geo"])


def test_the_theater_pick_wins_over_the_calendars_elements_for_the_month(store, clock, tmp_path):
    service = endgame_service(store, clock, tmp_path)
    assert service.endgame(False)["theater"]["elements"] == ["Cryo", "Electro", "Anemo"]
    service.put_theater(["Pyro", "Hydro", "Geo"])
    picked = service.endgame(False)["theater"]
    assert (picked["elements"], picked["from_calendar"]) == (["Pyro", "Hydro", "Geo"], False)
    assert [c["element"] for c in picked["cast"]] == ["Pyro", "Hydro", "Geo"]
    clock.advance(days=10)   # November: the pick was for October, so the calendar's elements are back
    assert service.endgame(False)["theater"]["from_calendar"] is True


def test_the_calendars_elements_stay_beside_the_pick_and_dropping_the_pick_brings_them_back(store, clock, tmp_path):
    service = endgame_service(store, clock, tmp_path)
    calendar = ["Cryo", "Electro", "Anemo"]
    assert service.endgame(False)["theater"]["calendar_elements"] == calendar
    service.put_theater(["Pyro", "Hydro", "Geo"])
    picked = service.endgame(False)["theater"]
    assert (picked["elements"], picked["calendar_elements"], picked["from_calendar"]) == (["Pyro", "Hydro", "Geo"], calendar, False)
    service.drop_theater()
    back = service.endgame(False)["theater"]
    assert (back["elements"], back["calendar_elements"], back["from_calendar"]) == (calendar, calendar, True)
    service.drop_theater()   # nothing to drop is no failure


def test_an_edited_card_changes_readiness_at_once_and_back_to_the_card_restores_it(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path)
    assert service.profile("sandrone")["readiness"]["total"] == 89
    service.put_card("sandrone", {"mains": {"sands": ["er"], "goblet": ["dmg"], "circlet": ["cr", "cd"]}})
    edited = service.profile("sandrone")
    assert edited["card"]["edited"] == ["mains"] and edited["readiness"]["total"] < 89
    with pytest.raises(CharactersRefused, match="That is not a field of a card."):
        service.put_card("sandrone", {"name": "Someone"})
    service.put_card("sandrone", {"mains": None})
    assert service.profile("sandrone")["card"]["edited"] == [] and service.profile("sandrone")["readiness"]["total"] == 89
    service.put_card("sandrone", {"roles": ["support"]})
    assert service.char("sandrone").card.roles == ("support",)
    service.drop_card("sandrone")
    assert service.char("sandrone").card.roles == ("damage",)


# ------------------------------------------------------------------------------------------------ reading the wiki

class _Counting:
    """The wiki's seam, counting what is asked."""

    def __init__(self):
        from characters_service_support import Wiki

        self.asked, self._wiki = [], Wiki()

    def __call__(self, url, *, headers=None, body=None):
        self.asked.append(url)
        return self._wiki(url, headers=headers, body=body)


async def test_the_wiki_is_read_for_a_character_only_after_consent(store, clock, tmp_path, monkeypatch):
    from guildboard.characters.service import Characters

    consent = [False]
    service = sandrone(store, clock, tmp_path, ready=lambda: consent[0])
    counting = _Counting()
    service._wiki._fetch = counting
    service.wanted("sandrone")
    await service.read(["sandrone"])
    assert counting.asked == []                      # no consent: nothing is asked, whatever is wanted
    assert service._filler is None
    consent[0] = True
    monkeypatch.setattr(Characters, "AUTOMATIC_READS", False)   # the hands-off change's switch: off, nothing is read
    service.wanted("sandrone")
    assert service._filler is None and counting.asked == []
    monkeypatch.setattr(Characters, "AUTOMATIC_READS", True)
    queue = service._bus.subscribe()
    service.wanted("sandrone")
    await service._filler
    asked = " ".join(counting.asked)
    for entry in ("10920", "10949", "10760", "8590", "9192"):   # her entry, her Teaspoon, her set, and her materials
        assert entry in asked
    assert {"type": "characters_changed"} in [queue.get_nowait() for _ in range(queue.qsize())]
    assert service.profile("sandrone")["title"] == "Mirrored Analysis"


def test_the_profile_carries_the_card_itself_for_the_card_panel(store, clock, tmp_path):
    service = sandrone(store, clock, tmp_path, meta=lambda key: (("https://example.com/guide",), "2026-10-20"))
    card = service.profile("sandrone")["card"]
    check(service.profile("sandrone"), "Profile")
    assert card["fields"]["roles"] == ["damage"] and card["fields"]["pronouns"] == ["she", "her", "her"]
    assert card["fields"]["mains"] == {"sands": ["atk_pct"], "goblet": ["dmg"], "circlet": ["cr", "cd"]}
    assert card["fields"]["sets"] == [{"sets": [samples.SHADOW], "pieces": "4"}]
    assert card["fields"]["weapons"][0] == samples.TEASPOON and card["fields"]["goals"]["cr"] == 75.0
    assert (card["sources"], card["checked"]) == (["https://example.com/guide"], "2026-10-20")
    assert samples.TEASPOON in [w["key"] for w in card["options"]["weapons"]]
    assert samples.SHADOW in [s["key"] for s in card["options"]["sets"]]
    assert all(w["key"] in service.refs.weapons and service.refs.weapons[w["key"]].type == "Claymore" for w in card["options"]["weapons"])
    service.put_card("sandrone", {"goals": {"cr": 60}})
    edited = service.profile("sandrone")["card"]
    # a goal edit changes the goals it names and no other: the card's others stay
    assert edited["fields"]["goals"] == {**samples.sandrone_card().goals, "cr": 60.0} and edited["edited"] == ["goals"]
    service.put_card("sandrone", {"goals": {"er": 150}})
    assert service.char("sandrone").card.goals == {**samples.sandrone_card().goals, "cr": 60.0, "er": 150.0}
    service.put_card("sandrone", {"goals": {"cr": None}})   # that one goal's edit, back to the card's
    assert service.char("sandrone").card.goals == {**samples.sandrone_card().goals, "er": 150.0}
    service.put_card("sandrone", {"goals": {"er": None}})   # the last goal edit gone: the field is the card's again
    assert service.profile("sandrone")["card"]["edited"] == []
    service.put_card("sandrone", {"goals": {"cr": 60}})
    service.put_card("sandrone", {"goals": None})   # the whole field back to the card
    assert service.profile("sandrone")["card"]["fields"]["goals"]["cr"] == 75.0
    with pytest.raises(CharactersRefused, match="That is not a value the card can hold."):
        service.put_card("sandrone", {"goals": {"cr": "high"}})


def test_the_calculators_exp_materials_are_held_as_exp_points(store, clock, tmp_path):
    from guildboard.records import CalcItemRecord, CalculatorRecord

    def items(*rows):
        return {1: tuple(CalcItemRecord(index, name, "", amount, lacking) for index, (name, amount, lacking) in enumerate(rows, 1))}

    rows = (
        ("Hero's Wit", 10, 4), ("Adventurer's Experience", 3, 0), ("Wanderer's Advice", 7, 7),   # 6 held, 3 at least, none
        ("Mystic Enhancement Ore", 2, 1), ("Fine Enhancement Ore", 5, 5), ("Enhancement Ore", 4, 0),   # 1, none, 4 at least
    )
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], CalculatorRecord(True, items(*rows), {}))
    held = make_service(store, clock, tmp_path).held_by_calculator()
    assert held["character-exp"] == (6 * 20000 + 3 * 5000, False)   # an "at least" reading makes the sum "at least"
    assert held["weapon-exp"] == (1 * 10000 + 4 * 400, False)
    exact = items(
        ("Hero's Wit", 10, 4), ("Adventurer's Experience", 3, 3), ("Wanderer's Advice", 7, 2), ("Mystic Enhancement Ore", 2, 1),
        ("Fine Enhancement Ore", 5, 5), ("Enhancement Ore", 4, 1),
    )
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], CalculatorRecord(True, exact, {}))
    held = make_service(store, clock, tmp_path).held_by_calculator()
    assert held["character-exp"] == (6 * 20000 + 5 * 1000, True) and held["weapon-exp"] == (10000 + 3 * 400, True)
    # a book or ore the answer does not name is unknown, not none: the sum is "at least"
    partial = items(("Hero's Wit", 10, 4), ("Wanderer's Advice", 7, 2), ("Mystic Enhancement Ore", 2, 1))
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], CalculatorRecord(True, partial, {}))
    held = make_service(store, clock, tmp_path).held_by_calculator()
    assert held["character-exp"] == (6 * 20000 + 5 * 1000, False) and held["weapon-exp"] == (10000, False)
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], CalculatorRecord(False, items(*rows), {}))
    assert make_service(store, clock, tmp_path).held_by_calculator() == {}   # sync off: nothing is known of what is held


def test_an_exp_amount_the_player_typed_wins_over_the_calculators_books(store, clock, tmp_path):
    from guildboard.records import CalcItemRecord, CalculatorRecord

    books = {1: (CalcItemRecord(1, "Hero's Wit", "", 10, 4), CalcItemRecord(2, "Mystic Enhancement Ore", "", 2, 1))}
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], CalculatorRecord(True, books, {}))
    service = make_service(store, clock, tmp_path)
    char = service.char("sandrone")
    taken = {"character-exp": 300000, "weapon-exp": 50000, "mora": 10}
    rows = {n.material: n for n in service.needs_of(char, service.plan_of(char), taken)}
    assert (rows["character-exp"].held, rows["weapon-exp"].held) == (120000, 10000)   # the books' totals
    assert "character-exp" not in service.typed_keys()
    service.put_held({"character-exp": 200000, "mora": 7})
    rows = {n.material: n for n in service.needs_of(char, service.plan_of(char), taken)}
    assert rows["character-exp"].held == 200000 and rows["character-exp"].exact is True   # what was typed
    assert rows["weapon-exp"].held == 10000 and rows["mora"].held == 7
    assert service.typed_keys() == {"character-exp", "mora"}
    service.put_held({"character-exp": None})
    assert {n.material: n for n in service.needs_of(char, service.plan_of(char), taken)}["character-exp"].held == 120000


OK_HOST = "https://act-webstatic.hoyoverse.com"
REFUSED_HOST = "https://upload-os-bbs.mihoyo.com"


def _traveler(store, clock, tmp_path, **pictures):
    """A character the inventory leaves out (no element, weapon type and rarity there): the Traveler, as HoYoLAB lists her."""
    record = dataclasses.replace(build_record(samples.sandrone_build(), ident=99, name="Traveler", element="Anemo", wiki_entry=None), **pictures)
    keep_builds(store, clock.now(), [record])
    keep_notes(store, clock.now())
    return make_service(store, clock, tmp_path)


def test_a_character_the_inventory_leaves_out_takes_her_face_from_hoyolabs_side_icon_when_the_icon_is_on_a_host_the_cache_refuses(store, clock, tmp_path):
    service = _traveler(
        store, clock, tmp_path, icon=f"{REFUSED_HOST}/icon.png", side_icon=f"{OK_HOST}/side.png", image=f"{OK_HOST}/image.png",
    )
    assert service.char("traveler").icon == f"{OK_HOST}/side.png"
    entry = next(row for row in service.roster()["entries"] if row["key"] == "traveler")
    assert entry["icon"] is not None


def test_a_character_with_an_icon_the_cache_allows_keeps_it_and_one_with_none_allowed_has_no_face(store, clock, tmp_path):
    service = _traveler(store, clock, tmp_path, icon=f"{OK_HOST}/icon.png", side_icon=f"{OK_HOST}/side.png")
    assert service.char("traveler").icon == f"{OK_HOST}/icon.png"
    refused = _traveler(store, clock, tmp_path, icon=f"{REFUSED_HOST}/icon.png", side_icon=f"{REFUSED_HOST}/side.png", image="")
    assert refused.address(refused.char("traveler").icon) is None


def test_her_art_is_the_wikis_or_the_inventorys_and_else_hoyolabs_image(store, clock, tmp_path):
    service = _traveler(store, clock, tmp_path, image=f"{OK_HOST}/image.png")
    assert service.art_url(service.char("traveler")) == f"{OK_HOST}/image.png"
    refused = _traveler(store, clock, tmp_path, image=f"{REFUSED_HOST}/image.png")
    assert refused.address(refused.art_url(refused.char("traveler"))) is None


def test_the_travelers_pictures_on_hoyolabs_fastcdn_are_used(store, clock, tmp_path):
    fastcdn = "https://fastcdn.hoyoverse.com/static-resource-v2/2024/01/01"
    service = _traveler(store, clock, tmp_path, icon=f"{fastcdn}/icon.png", side_icon=f"{OK_HOST}/side.png", image=f"{fastcdn}/image.png")
    traveler = service.char("traveler")
    assert traveler.icon == f"{fastcdn}/icon.png" and service.address(traveler.icon) is not None
    assert service.art_url(traveler) == f"{fastcdn}/image.png" and service.address(service.art_url(traveler)) is not None


async def test_a_page_read_decodes_no_wiki_entry_it_does_not_show(store, clock, tmp_path, monkeypatch):
    from guildboard.store import Store

    service = sandrone(store, clock, tmp_path)
    await keep_wiki(service._wiki)
    decoded = []
    real = Store._wiki_entry
    monkeypatch.setattr(Store, "_wiki_entry", staticmethod(lambda row: decoded.append(row[0]) or real(row)))
    size = service._wiki_size()  # counting the rows decodes none of them
    assert size == store._conn.execute("SELECT COUNT(*) FROM wiki_entries").fetchone()[0] > 0 and decoded == []
    first = service.roster()  # the first reading of a page decodes the entry it shows
    assert decoded
    decoded.clear()
    assert service.roster() == first and service.char("sandrone") is not None
    assert decoded == []  # the parsed page is kept, and its entry is not read again to find that out
