"""Trimmed copies of real answers of HoYoLAB's three endgame endpoints (`fixtures/endgame`), as the raw archive keeps
them: the Spiral Abyss of 16 Oct to 16 Nov 2026, the Imaginarium Theater of October and November, and the Stygian
Onslaught's Luminous Battlefront with the season after it, not yet played. Nothing in them names the account; long lists
are cut to what the tests need. Each call gives a fresh copy, which a test may change."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FOLDER = Path(__file__).parent / "fixtures" / "endgame"


def load(endpoint: str) -> Any:
    return json.loads((FOLDER / f"{endpoint}.json").read_text(encoding="utf-8"))


def abyss() -> dict[str, Any]:
    return load("spiralAbyss")


def theater() -> dict[str, Any]:
    return load("role_combat")


def stygian() -> dict[str, Any]:
    return load("hard_challenge")
