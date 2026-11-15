"""The party in the planner's hits block (the Plan design 14): the kit gives the team shapes a character's damage depends on, and the
block carries them with the rows the team decides, for the interface's engine to resolve."""
from __future__ import annotations

import copy

from guildboard.characters import kits, simhits

PARTY = {
    "default": "pyro", "reason": "Most teams have Pyro.",
    "options": [{"id": "pyro", "label": "Pyro", "elements": ["pyro"]}, {"id": "none", "label": "No Stellar team", "elements": []}],
    "element_rows": {"burst": ["Iris DMG"]}, "only_rows": {"burst": {"Stellar-Conduct DMG": ["pyro"]}},
}
KIT = {
    "checked": True, "main": None, "stellar": None, "unsure": None, "elements": {}, "moves": {}, "infused": [], "effects": [],
    "toggles": [], "hits": {"burst": {"Iris DMG": "elemental", "Skill DMG": "elemental", "Stellar-Conduct DMG": "stellar-conduct"}},
}


def rows(kit):
    return simhits.rows_of([("Iris DMG", "50%"), ("Skill DMG", "100%"), ("Stellar-Conduct DMG", "70%")], "burst", kit, "catalyst")


def test_a_kit_with_a_party_marks_the_rows_the_team_decides():
    by_name = {row["name"]: row for row in rows({**KIT, "party": PARTY})}
    assert by_name["Iris DMG"]["takes"] is True and by_name["Iris DMG"]["only"] is None
    assert by_name["Stellar-Conduct DMG"]["only"] == ["pyro"] and by_name["Stellar-Conduct DMG"]["takes"] is False
    assert by_name["Skill DMG"]["takes"] is False and by_name["Skill DMG"]["only"] is None


def test_a_kit_without_a_party_gives_rows_as_they_were():
    assert all("takes" not in row and "only" not in row for row in rows(KIT))


def _block(kit):
    return simhits.hits_block(
        element="Anemo", weapon_type="Catalyst", level=90, levels={"normal": 10, "skill": 10, "burst": 10},
        raised={"normal": 10, "skill": 10, "burst": 10}, affixes={"burst": [("Iris DMG", "50%"), ("Skill DMG", "100%")]},
        tables={}, names={t: (t, None) for t in simhits.TALENTS}, kit=kit, recommended=[], weapon_effects={}, set_effects={})


def test_the_block_carries_the_party_and_none_without_one():
    assert _block({**KIT, "party": PARTY})["party"] == PARTY
    assert _block(KIT)["party"] is None


def test_the_kit_of_a_character_gives_her_party_as_a_copy():
    data = kits.load_kits()
    key = next(k for k, c in data["characters"].items() if c.get("party"))
    got = kits.kit_of(key, 0, 6, "", 1, {})
    assert got["party"] == data["characters"][key]["party"]
    got["party"]["default"] = "changed"
    assert kits.kit_of(key, 0, 6, "", 1, {})["party"]["default"] != "changed"
    assert copy.deepcopy(kits.kit_of("nobody-at-all", 0, 6, "", 1, {}))["party"] is None
