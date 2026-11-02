"""Pulls: the wish history, the pity of each wish, the savings and the banner planner (the Pulls design, 2026-10-23).

The names every part shares: the pools, the wish types HoYoverse answers under, what the page calls each pool, what a
pull costs and how far back the history reaches.
"""
from __future__ import annotations

POOLS = ("character", "weapon", "standard", "chronicled")  # the four cards of the page
ALL_POOLS = (*POOLS, "novice")  # the Beginners' wish is kept and listed, and has no card

# The wish types the import asks for, in the order it asks. 400 is the character event's second banner, which shares
# 301's count.
GACHA_TYPES = ("301", "400", "302", "200", "500", "100")
POOL_OF = {
    "100": "novice",
    "200": "standard",
    "301": "character",
    "400": "character",
    "302": "weapon",
    "500": "chronicled",
}
POOL_LABELS = {
    "character": "Character event",
    "weapon": "Weapon event",
    "standard": "Standard",
    "chronicled": "Chronicled",
    "novice": "Beginners' wish",
}

PULL_PRIMOGEMS = 160  # the primogems one Intertwined Fate costs
WINDOW_DAYS = 180  # HoYoverse keeps six months of wishes, which is never less than 181 days: 180 is the safe side
