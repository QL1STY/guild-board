"""The Characters pages: the roster, the profile, the planner, the week and the endgame (the Characters design). The engines
here are pure functions of a build, a card and the references; the service gives them what HoYoLAB, the wiki and the player
kept. The shapes the parts share are the plan's "The contracts between the parts"."""
from __future__ import annotations

ELEMENTS = ("Pyro", "Hydro", "Anemo", "Electro", "Dendro", "Cryo", "Geo")
WEAPON_TYPES = ("Sword", "Claymore", "Polearm", "Bow", "Catalyst")
SLOTS = ("flower", "plume", "sands", "goblet", "circlet")
STATS = ("hp", "atk", "def", "hp_pct", "atk_pct", "def_pct", "em", "er", "cr", "cd", "dmg", "heal")  # dmg = DMG Bonus of her element
FOCUS_MAX = 4
BUILT = 50  # readiness from which a character is fielded
RESIN_PER_DAY = 180
HORIZON_DAYS = 35

# Your week and Endgame are built and tested but hidden (the player's call, 2026-10-30). While this is False the core
# answers 404 to their routes and sends none of their notices, and the interface (told by /api/status) shows no "Your
# week" entry, no Endgame tab and no Today widget. Turn it on and everything is back; their tests run with it on.
WEEK_AND_ENDGAME = False
