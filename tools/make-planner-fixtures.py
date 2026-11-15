"""Writes the interface's planner fixtures from the core's own planner model, so that they follow the model's shape:

    uv run python tools/make-planner-fixtures.py

`web/src/fixtures/planner-sim.json` is the simulator block, and the `sim` of `web/src/fixtures/characters/planner.json` is the
same (the rest of that file is the mockup's numbers and is left as it is). They are the sample Sandrone of tests/characters_samples.py
(level 90, C2, the Teaspoon) with the verdict switch on and her real rows at her levels (9, 10, 10), which the demo's builds hold.
`uv run pytest tests/test_characters_contracts.py` holds them to web/src/types.ts."""
from __future__ import annotations

import dataclasses
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

import characters_samples as samples  # noqa: E402
from characters_service_support import SUNDAY, build_record, calculator, keep_builds, keep_notes, make_service  # noqa: E402
from guildboard import characters  # noqa: E402
from guildboard.records import SkillRecord  # noqa: E402
from guildboard.store import Store  # noqa: E402
from support import FakeClock  # noqa: E402

FIXTURES = ROOT / "web" / "src" / "fixtures"
DEMO_BUILDS = ROOT / "src" / "guildboard" / "characters" / "demo" / "builds.json"
SET_TEXTS = ("Demo text for the 2-piece bonus.", "Demo text for the 4-piece bonus.")   # the sample service keeps no entry for the set


def dump(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    characters.VERDICT = True
    sandrone = next(b for b in json.loads(DEMO_BUILDS.read_text(encoding="utf-8"))["builds"] if b["name"] == "Sandrone")
    build = samples.sandrone_build()
    record = dataclasses.replace(build_record(build), skills=tuple(
        SkillRecord(100 + n, 1, kind, "", build.talents[kind] + build.bonus[kind], tuple(tuple(row) for row in skill["affixes"]))
        for n, (kind, skill) in enumerate(zip(("normal", "skill", "burst"), sandrone["skills"]), 1)
    ))
    store = Store.in_memory()
    clock = FakeClock(SUNDAY)
    keep_builds(store, clock.now(), [record], calculator())
    keep_notes(store, clock.now())
    with tempfile.TemporaryDirectory() as folder:
        sim = make_service(store, clock, Path(folder)).planner("sandrone")["sim"]
    store.close()
    for shown in sim["sets"]:
        shown["two_text"], shown["four_text"] = SET_TEXTS
    dump(FIXTURES / "planner-sim.json", sim)
    planner = json.loads((FIXTURES / "characters" / "planner.json").read_text(encoding="utf-8"))
    planner["sim"] = sim
    dump(FIXTURES / "characters" / "planner.json", planner)


if __name__ == "__main__":
    main()
