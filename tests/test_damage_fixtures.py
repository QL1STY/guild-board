"""web/src/fixtures/damage-kits.json, which the damage engine's tests stand on, is what the core makes today from the rows it keeps
(tools/make-damage-fixtures.py): a change to kits.json, the tables or the planner's hits block that is not followed by the generator
fails here, and so does a fixture that was edited by hand."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "web" / "src" / "fixtures" / "damage-kits.json"


def _generator():
    spec = importlib.util.spec_from_file_location("make_damage_fixtures", ROOT / "tools" / "make-damage-fixtures.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_damage_fixture_is_what_the_generator_makes_now():
    kept = json.loads(FIXTURE.read_text(encoding="utf-8"))
    again = json.loads(json.dumps(_generator().build_all(kept["affixes"])))
    assert again["tables"] == kept["tables"]
    for key in kept["kits"]:
        assert again["kits"][key] == kept["kits"][key], f"{key}: run tools/make-damage-fixtures.py"
    assert set(again["kits"]) == set(kept["kits"])
