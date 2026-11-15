"""The Characters pages: the roster, the profile, the planner and the endgame (the Characters design). The engines
here are pure functions of a build, a card and the references; the service gives them what HoYoLAB, the wiki and the player
kept. The shapes the parts share are the plan's "The contracts between the parts"."""
from __future__ import annotations

ELEMENTS = ("Pyro", "Hydro", "Anemo", "Electro", "Dendro", "Cryo", "Geo")
WEAPON_TYPES = ("Sword", "Claymore", "Polearm", "Bow", "Catalyst")
SLOTS = ("flower", "plume", "sands", "goblet", "circlet")
STATS = ("hp", "atk", "def", "hp_pct", "atk_pct", "def_pct", "em", "er", "cr", "cd", "dmg", "heal")  # dmg = DMG Bonus of her element
PLANNED_MAX = 128
BUILT = 50  # readiness from which a character is fielded

# Endgame is hidden, to be rebuilt (the player's call, 2026-11-12): while this is False the core answers 404 to its routes and
# the interface (told by /api/status) shows no Endgame tab. Turn it on and it is back; its tests run with it on.
ENDGAME = False

# The planner's verdict (the Plan design, sections 7.5 and 14) is on since 2.2.0 (the player's call, 2026-11-15), for every
# character whose kit is known. It stays a switch in the code, never set from outside: while it is False the planner model has no
# hits (`sim.hits` is null) and `/api/status` says so for the interface, which is stage 1's planner. A test of that sets it False.
VERDICT = True
