"""Writes `web/src/fixtures/damage-kits.json`, the kit data the damage engine's tests (web/src/pages/characters/damage.test.ts) stand on:

    GB_GO_DIR=<a Genshin Optimizer checkout> uv run python tools/make-damage-fixtures.py

For the three builds Genshin Optimizer was measured on (go-engine.md, section 1: Sandrone, Lauma and Hu Tao at level 90, ascension 6,
talents 10/10/10, constellation 0) it writes the planner's `sim.hits` block as the core builds it (`simhits.hits_block`): her talents'
rows at level 10 (the rows' text is GO's English text, as `tools/go-reference/talent_rows.py` renders it, which is what HoYoLAB prints),
her kit from kits.json, the effects of the one weapon and the one set of the build, and the engine's constants (tables.json).
Nothing here is made up: every number is the game's or kits.json's. The builds' stats are in the test, from GO's own output.

The file also keeps the rows' text (`affixes`, GO's, as HoYoLAB prints it), so that `tests/test_damage_fixtures.py` can build the blocks
again from it, with no GO checkout, and hold the committed `kits` and `tables` to what the core makes of them today."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from guildboard.characters import constants, kits, simhits  # noqa: E402

spec = importlib.util.spec_from_file_location("talent_rows", ROOT / "tools" / "go-reference" / "talent_rows.py")
talent_rows = importlib.util.module_from_spec(spec)
spec.loader.exec_module(talent_rows)

BUILDS = {
    "sandrone": {"element": "Cryo", "weapon_type": "Claymore", "weapon": "wolf-s-gravestone", "set": "gladiator-s-finale"},
    "lauma": {"element": "Dendro", "weapon_type": "Catalyst", "weapon": "lost-prayer-to-the-sacred-winds", "set": "gilded-dreams"},
    "hu-tao": {"element": "Pyro", "weapon_type": "Polearm", "weapon": "staff-of-homa", "set": "crimson-witch-of-flames"},
}
TALENTS = ("normal", "skill", "burst")
NAMES = {"normal": "Normal Attack", "skill": "Elemental Skill", "burst": "Elemental Burst"}


def block(key: str, build: dict[str, str], affixes: dict[str, list]) -> dict:
    kind = build["weapon_type"].casefold()
    kit = kits.kit_of(key, 0, 6, "", 1, {})
    levels = dict.fromkeys(TALENTS, 10)
    return simhits.hits_block(
        element=build["element"], weapon_type=build["weapon_type"], level=90, levels=levels, raised=levels,
        affixes={t: [tuple(row) for row in affixes[t]] for t in TALENTS}, tables={}, names={t: (NAMES[t], None) for t in TALENTS},
        kit=kit, recommended=[],
        weapon_effects={build["weapon"]: kits.gear_of("weapons", build["weapon"], 0, 6, kind)},
        set_effects={build["set"]: kits.gear_of("sets", build["set"], 0, 6, kind)},
    )


def build_all(affixes: dict[str, dict[str, list]]) -> dict:
    """The fixture's `tables` and `kits`, from the rows' text by character."""
    return {"tables": constants.tables(), "kits": {key: block(key, build, affixes[key]) for key, build in BUILDS.items()}}


def main() -> None:
    affixes = {key: {t: talent_rows.rows(kits.load_kits()["characters"][key]["go_key"], t, 10) for t in TALENTS} for key in BUILDS}
    out = {"affixes": affixes, **build_all(affixes)}
    path = ROOT / "web" / "src" / "fixtures" / "damage-kits.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
