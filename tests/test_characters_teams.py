"""Task E5: the team builder for the Abyss, each Stygian boss and the Theater, and the month's elements from the calendar.
The expected teams are what endgame.html's own `buildTeams` prints for its roster (run under node on 2026-10-29)."""
from __future__ import annotations

import dataclasses

from characters_samples import endgame_bosses, endgame_roster
from guildboard.characters import BUILT, teams, theater
from guildboard.characters.models import Member

THEATER = ("Cryo", "Electro", "Anemo")


def names(team) -> tuple[list[str], int]:
    return [m.name for m in team.members], team.ready


def stygian(boss, roster):
    pool = [m for m in roster if m.element not in boss.disadvantage]
    return teams.build_teams(pool, 1, boss.advantage)


def test_the_abyss_teams_now_are_nefers_and_sandrones():
    found = teams.build_teams(endgame_roster(), 2)
    assert [names(t) for t in found] == [
        (["Nefer", "Dahlia", "Lauma", "Columbina"], 79),
        (["Sandrone", "Ineffa", "Lan Yan", "Jahoda"], 75),
    ]


def test_after_the_plans_sandrones_team_comes_first():
    found = teams.build_teams(endgame_roster(after=True), 2)
    assert [names(t) for t in found] == [
        (["Sandrone", "Jahoda", "Ineffa", "Columbina"], 84),
        (["Nefer", "Dahlia", "Lauma", "Alyosha"], 77),
    ]


def test_each_stygian_boss_gets_its_own_team_without_its_bad_elements():
    bosses, roster = endgame_bosses(), endgame_roster()
    assert [names(stygian(b, roster)[0]) for b in bosses] == [
        (["Nefer", "Dahlia", "Lauma", "Columbina"], 79),
        (["Sandrone", "Ineffa", "Lan Yan", "Columbina"], 77),
        (["Nefer", "Ineffa", "Lauma", "Iansan"], 80),
    ]
    after = endgame_roster(after=True)
    assert [names(stygian(b, after)[0]) for b in bosses] == [
        (["Nefer", "Dahlia", "Lauma", "Columbina"], 79),
        (["Sandrone", "Jahoda", "Ineffa", "Columbina"], 84),
        (["Nefer", "Ineffa", "Lauma", "Alyosha"], 80),
    ]


def test_an_element_that_leads_lifts_a_damage_dealer_of_it():
    roster = endgame_roster()
    assert names(teams.build_teams(roster, 1)[0])[0][0] == "Nefer"
    assert names(teams.build_teams(roster, 1, ("Cryo",))[0])[0][0] == "Sandrone"   # 78 + 30 beats Nefer's 88


def test_no_one_below_the_built_line_is_fielded_and_a_short_pool_gives_no_team():
    roster = endgame_roster()
    fielded = {m.name for t in teams.build_teams(roster, 4) for m in t.members}
    assert "Vesna" not in fielded and "Durin" not in fielded and "Linnea" not in fielded
    assert teams.build_teams(roster[:3], 2) == ()
    weak = [dataclasses.replace(m, ready=BUILT - 1) for m in roster]
    assert teams.build_teams(weak, 2) == ()


def test_the_theater_teams_use_only_the_months_elements():
    found = teams.build_teams([m for m in endgame_roster() if m.element in THEATER], 3)
    assert [names(t) for t in found] == [(["Sandrone", "Ineffa", "Lan Yan", "Jahoda"], 75)]
    after = teams.build_teams([m for m in endgame_roster(after=True) if m.element in THEATER], 3)
    assert [names(t) for t in after] == [(["Sandrone", "Jahoda", "Ineffa", "Lan Yan"], 82)]


def test_the_theater_cast_for_cryo_electro_anemo_counts_2_3_2_and_vesna_is_close():
    roster = endgame_roster()
    cast = teams.cast(roster, THEATER)
    assert [(element, ready) for element, _, ready in cast] == [("Cryo", 2), ("Electro", 3), ("Anemo", 2)]
    assert [m.name for m in cast[2][1]] == ["Lan Yan", "Jahoda", "Vesna"]   # the most ready first
    assert teams.thinnest(cast) == "Anemo"
    close = teams.close(roster, THEATER)
    assert [(m.name, m.ready, BUILT - m.ready) for m in close] == [("Vesna", 40, 10)]
    assert teams.thinnest(teams.cast(roster, ("Electro",))) is None   # three ready: not thin


def test_team_readiness_counts_the_damage_dealer_twice():
    """(2 x 88 + 58 + 80 + 82) / 5 = 79.2: Nefer with Dahlia, Lauma and Columbina."""
    roster = {m.name: m for m in endgame_roster()}
    team = [roster["Nefer"], roster["Dahlia"], roster["Lauma"], roster["Columbina"]]
    assert teams.team_ready(team) == 79


def test_the_theaters_elements_are_read_from_the_calendars_text():
    assert theater.elements("Cryo, Electro and Anemo characters are boosted this month.") == ("Cryo", "Electro", "Anemo")
    assert theater.elements("Stage: <color=#fff>Hydro</color> and Pyro, with Dendro on the last act. Hydro again.") == (
        "Hydro", "Pyro", "Dendro",
    )
    assert theater.elements("cryo / ELECTRO / Anemo") == ("Cryo", "Electro", "Anemo")


def test_text_without_exactly_three_elements_gives_none():
    assert theater.elements("") == ()
    assert theater.elements("Only Cryo and Pyro this month.") == ()
    assert theater.elements("Cryo, Pyro, Hydro and Geo.") == ()
    assert theater.elements("No elements are named; Anemoculus and Geoculus are not elements.") == ()
