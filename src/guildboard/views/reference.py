"""Reference numbers that HoYoLAB does not provide."""
from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources


@lru_cache(maxsize=1)
def oculi_totals() -> dict[str, int]:
    text = resources.files("guildboard").joinpath("reference", "collectibles.json").read_text(encoding="utf-8")
    return {str(kind): int(total) for kind, total in json.loads(text).get("oculi", {}).items()}
