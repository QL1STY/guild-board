"""A made-up list in Paimon.moe's shape, notes on it, and a builder of made-up Paimon.moe exports.
The names are real; the numbers are chosen for the tests."""
from __future__ import annotations

import json

from guildboard.achievements.notes import parse_notes

# 11 stages that award 100 primogems in all: 55 in Wonders of the World, 35 in Challenger: Series II and 10 in
# Mortal Travails: Series I.
SMALL_LIST = {
    "0": {"name": "Wonders of the World", "order": 1, "achievements": [
        {"id": 84508, "name": "Pirates! Argh!", "desc": "Play a game of pirates with Little Lulu, Little Fei, and Little Meng.",
         "reward": 5, "ver": "1.0", "commissions": "liyue",
         "quest": {"id": ["Pirate Invasion, in Liyue Harbor!"], "name": ["Pirate Invasion, in Liyue Harbor!"]},
         "checklist": ["Little Meng", "Little Lulu", "Little Fei"]},
        {"id": 84512, "name": "For the Love of Godwin", "desc": "Finish \"Whispers in the Wind\" 5 times.", "reward": 5, "ver": "1.0"},
        {"id": 81732, "name": "Winter Night's Letter", "desc": "Complete \"Secret Tsarist Assignment: Part I.\"", "reward": 10, "ver": "7.1"},
        [
            {"id": 80127, "name": "Zoo Tycoon", "desc": "Use the Omni-Ubiquity Net item to capture 1 wild animal.", "reward": 5, "ver": "2.3"},
            {"id": 80128, "name": "Zoo Tycoon", "desc": "Use the Omni-Ubiquity Net item to capture 30 wild animals.", "reward": 10, "ver": "2.3"},
            {"id": 80129, "name": "Zoo Tycoon", "desc": "Use the Omni-Ubiquity Net item to capture 100 wild animals.", "reward": 20, "ver": "2.3"},
        ],
    ]},
    "1": {"name": "Mortal Travails: Series I", "order": 3, "achievements": [
        {"id": 80001, "name": "The Wind and The Star Traveler", "desc": "Blow seeds off a Dandelion using Anemo.", "reward": 5, "ver": "1.0"},
        {"id": 81222, "name": "Light Up the Dark", "desc": "Light up a dark place.", "reward": 5, "ver": "1.0"},
    ]},
    "2": {"name": "Challenger: Series II", "order": 2, "achievements": [
        [
            {"id": 82055, "name": "...Well, That Was Strange", "desc": "Defeat the Unusual Hilichurl 1 time.", "reward": 5, "ver": "1.1"},
            {"id": 82056, "name": "...Well, That Was Strange", "desc": "Defeat the Unusual Hilichurl 20 times.", "reward": 10, "ver": "1.1"},
            {"id": 82057, "name": "...Well, That Was Strange", "desc": "Defeat the Unusual Hilichurl 50 times.", "reward": 20, "ver": "1.1"},
        ],
    ]},
}


def list_bytes(data: dict) -> bytes:
    return json.dumps(data).encode("utf-8")


SAMPLE_NOTES = parse_notes({
    "checked_against": "7.1",
    "counters": {"84512": {"unit": "times finished", "targets": [5]}},
    "not_in_order": [],
    "wiki": {},
})
# The same, with one part the notes add after Pirates! Argh!'s three (spec 7.2).
NOTES_WITH_A_PART = parse_notes({
    "checked_against": "7.1",
    "counters": {"84512": {"unit": "times finished", "targets": [5]}},
    "not_in_order": [],
    "wiki": {},
    "commissions": {"84508": {"order": False, "how": "", "parts": ["Little Bo"], "sources": ["https://example.org/b"]}},
})


def paimon_export(profiles: dict[str, dict], checklists: dict[str, dict] | None = None) -> bytes:
    data: dict = {"accounts": ",".join(p for p in profiles if p), "wish-counter-character-event": {"total": 3}}
    for profile, achievements in profiles.items():
        data[f"{profile}-achievement" if profile else "achievement"] = achievements
    for profile, checklist in (checklists or {}).items():
        data[f"{profile}-achievement-checklist" if profile else "achievement-checklist"] = checklist
    return json.dumps(data).encode("utf-8")
