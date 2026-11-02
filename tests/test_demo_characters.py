"""Task V3: the demo's Characters: the mockups' characters and numbers, seeded once, with every picture it names bundled."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import pytest

from characters_shape import problem_with
from guildboard.characters import demo as characters_demo
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.sources.demo import DEMO_ACCOUNT

SUNDAY = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)   # --demo-now 2026-10-25T08:00:00Z
GROUPS = ("notes", "characters", "endgame", "calendar")


@pytest.fixture
async def core(tmp_path):
    core = Core(AppPaths(tmp_path / "data"), demo=True, demo_now=SUNDAY, process_lister=lambda: set())
    await core.runner.run("manual", GROUPS)
    yield core
    core.store.close()


async def test_the_demo_shows_the_mockups_characters_and_numbers(core):
    service = core.characters
    roster = service.roster()
    assert problem_with(roster, "Roster") is None
    assert roster["owned"] == 15 and roster["focus"] == ["sandrone", "odette", "alyosha", "jahoda"]
    ready = {entry["key"]: entry["readiness"] for entry in roster["entries"] if entry["owned"]}
    assert ready["sandrone"] == 89 and ready["nefer"] == 88 and ready["vesna"] == 40
    assert next(e for e in roster["entries"] if e["key"] == "escoffier")["banner"]["running"] is True
    profile = service.profile("sandrone")
    assert problem_with(profile, "Profile") is None
    texts = {row["key"]: row["text"] for row in profile["stats"]}
    assert (texts["hp"], texts["atk"], texts["cr"], texts["cd"], texts["er"]) == ("20,152", "2,964", "79.4%", "176.5%", "122.7%")
    assert sum(profile["rolls_by"].values()) == 41 and profile["readiness"]["total"] == 89
    assert [step["gain"] for step in profile["next_steps"]] == ["about +31% damage", "about +6% damage", "about +3% damage"]
    planner = service.planner("sandrone")
    assert problem_with(planner, "Planner") is None
    assert planner["now"]["readiness"] == 89 and planner["with_plan"] == {"readiness": 99, "damage": 135, "change": 35}
    assert planner["sync"]["calculator"] == "on"
    for key in ("odette", "alyosha", "jahoda"):
        assert problem_with(service.planner(key), "Planner") is None and problem_with(service.profile(key), "Profile") is None
    week = service.week()
    assert problem_with(week, "Week") is None
    sunday = week["days"][0]
    assert (sunday["label"], sunday["start"], sunday["spent"]) == ("Sunday 25 October", 200, 200)
    assert sunday["alert"]["loud"] is True
    assert [(t["kind"], t["who"], t["title"], t["resin"]) for t in sunday["tasks"]] == [
        ("weekly", ["sandrone"], "The Doctor, weekly boss", 30),
        ("books", ["sandrone"], "Overturned Roost, 6 runs", 120),
        ("weekly", ["odette"], "Il Dottore, weekly boss", 30),
        ("books", ["odette"], "Relics of the Frozen Grace, 1 run", 20),
        ("flowers", ["alyosha"], "Pick 23 Flockingweed in Fellfrost Peak", 0),
    ]
    assert [card["key"] for card in week["focus"]] == ["sandrone", "odette", "alyosha", "jahoda"]
    endgame = service.endgame(False)
    assert problem_with(endgame, "Endgame") is None
    assert endgame["modes"][1]["value"] == "Cryo, Electro, Anemo" and endgame["theater"]["from_calendar"] is True
    assert len(endgame["abyss"]) == 2 and len(endgame["stygian"]) == 3 and endgame["clear"]
    assert "You lost a star in 12-3, second half" in " ".join(t["note"] for t in endgame["abyss"])
    assert problem_with(service.endgame(True), "Endgame") is None


async def test_the_weaker_abyss_team_is_said_to_have_lost_a_star_only_when_it_did(core):
    # The demo's star was lost by the team built around Sandrone, which is not the weaker of the two.
    endgame = core.characters.endgame(False)
    lost = [index for index, team in enumerate(endgame["abyss"]) if "You lost a star" in team["note"]]
    weaker = min((0, 1), key=lambda index: endgame["abyss"][index]["ready"])
    assert lost and weaker not in lost
    assert "Abyss team" in endgame["clear"][0]["text"] and "lost a star" not in endgame["clear"][0]["text"]


async def test_the_demo_seeds_once(tmp_path):
    paths = AppPaths(tmp_path / "data")
    core = Core(paths, demo=True, demo_now=SUNDAY, process_lister=lambda: set())
    assert core.store.meta(characters_demo.SEEDED) is not None
    assert core.store.focus(DEMO_ACCOUNT.uid) == list(characters_demo.FOCUS)
    core.characters.put_focus(["nefer"])   # the player's own choice
    core.store.put_held(DEMO_ACCOUNT.uid, {"mora": 5}, SUNDAY)
    core.store.close()
    again = Core(paths, demo=True, demo_now=SUNDAY, process_lister=lambda: set())
    try:
        assert again.store.focus(DEMO_ACCOUNT.uid) == ["nefer"]     # not seeded again over the player's change
        assert again.store.held(DEMO_ACCOUNT.uid) == {"mora": 5}
        assert len(again.store.wiki_entries("character")) == 4      # Sandrone, Odette, Alyosha and Jahoda, once
    finally:
        again.store.close()


def _addresses(model) -> set[str]:
    return set(re.findall(r"/api/art/[0-9a-f]{32}", json.dumps(model)))


async def test_the_demo_names_no_picture_and_its_pages_hold_the_signs(core):
    service = core.characters
    models = [service.roster(), service.week(), service.endgame(False), service.endgame(True)]
    models += [service.profile(key) for key in ("sandrone", "odette")] + [service.planner(key) for key in ("sandrone", "alyosha")]
    assert set().union(*(_addresses(model) for model in models)) == set()   # it ships none of the game's art and downloads none
    profile = service.profile("sandrone")
    assert profile["art"] is None and profile["chart"] is None and profile["weapon"]["icon"] is None
    assert not any(piece["icon"] for piece in profile["pieces"]) and not any(c["icon"] for c in profile["constellations"])
    assert not any(entry["icon"] for entry in service.roster()["entries"])
    assert core.art.address("https://example.com/a.png") is None


async def test_the_planners_resin_note_says_where_the_rest_of_the_days_resin_goes(core):
    takes = core.characters.planner("sandrone")["takes"]
    spent = sum(part["resin"] for part in takes["resin_today"])
    assert spent == 150
    # Odette's weekly boss and book runs take the other 50, as the bar's rest shows: the note does not say "0 left over".
    assert takes["today_note"].endswith(f"{spent} of your 200 resin today; the other 50 go to Odette.")
    assert "left over" not in takes["today_note"]


async def test_the_demo_gives_sandrone_her_three_copies_so_her_story_shows_as_the_mockup_has_it(core):
    profile = core.characters.profile("sandrone")
    assert problem_with(profile, "Profile") is None
    assert [(e["pity"], e["result"], e["banner"]) for e in profile["pity"]] == [
        (71, "won", "Character banner"), (44, "guaranteed", "Character banner"), (62, "won", "Character banner"),
    ]
    assert profile["pity"][1]["after"] == "Qiqi"
    assert [e["at"] for e in profile["pity"]] == sorted(e["at"] for e in profile["pity"])
    # The wish history of the Pulls page is the demo's own and has no copy of her: the story is the Characters' demo's.
    assert core.characters.profile("odette")["pity"] == []
