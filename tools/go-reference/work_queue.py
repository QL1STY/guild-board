"""The queue of characters whose kits still wait for a decision (decided/<key>.json), owned ones first, in batches and lanes, for
the agents that decide them. A developer tool: nothing here ships and the app never runs it.

    uv run python tools/go-reference/work_queue.py        (or: run.py queue)

writes, in `.superpowers/` (git-ignored), `queue.json` and `queue/<batch>.txt` (the keys of a batch one per line, which
`run.py compare --only @file` and `run.py sheet @file` take), and prints counts only.

- Unchecked: every character of kits.json that has no decision (`kitgen.load_decided`: a file of only `unsure` is no decision).
- Owned: the characters of the player's last HoYoLAB read, from the store's `latest_docs` ("characters", the builds): read from a
  copy of the database in a temporary folder (`dbcopy.open_copy`), never the original, so nothing is left in the data folder. The
  store is at `config.default_data_dir()` (GUILDBOARD_DATA_DIR, else the standard folder). The store keeps each talent's level as
  the game shows it, with her constellations' levels in it; a talent shown above 10 has 3 levels of those taken off (the two
  constellations that raise a talent raise it by 3), and the highest of the three is her "highest raised talent".
- Order: owned first (highest raised talent, then constellation, then her level, then newest), then the rest newest first. Release
  is the wiki's game version of the inventory (`inventory.json`; the data has no calendar dates), a version's characters in the
  inventory's own order (newest first); a character the inventory lacks (not out yet) comes before the rest, in the reverse of the
  order kits.json lists her.
- Batches of about 18 (even sizes), and `lanes` lanes of batches (lane j holds batches j, j+lanes, ...), with the owned dealt round
  the lanes' first batches so that every lane starts with owned characters."""
from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(HERE))

import dbcopy  # noqa: E402
import kitgen  # noqa: E402

DECIDED = HERE / "decided"
OUT = ROOT / ".superpowers"
KITS = ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json"
INVENTORY = ROOT / "src" / "guildboard" / "reference" / "characters" / "inventory.json"
BATCH_SIZE = 18
LANES = 3
EXTRA_TALENT_LEVELS = 3   # what each of the two constellations that raise a talent adds


# ------------------------------------------------------------------------------------------------ what the player owns

def _talent_levels(record: dict) -> list[int]:
    """The three talents' levels as the game shows them (the first three skills of type 1, else one of each of type 1, 2, 3, as
    `bridge.talent_skills` reads them), each less the constellations' levels when it is above 10."""
    from guildboard.characters import bridge

    levels = []
    for skill in bridge.talent_skills(record.get("skills") or ()).values():
        shown = int(skill.get("level") or 1)
        levels.append(shown - EXTRA_TALENT_LEVELS if shown > 10 else shown)
    return levels


def owned_progress(db_path: Path) -> dict[str, dict]:
    """The player's characters by key: `{"talent": her highest raised talent, "constellation", "level"}`, from the store's
    last read of the builds. Read from a copy; {} when there is no store, no document or nothing readable in it."""
    from guildboard.metrics import slug

    path = Path(db_path)
    if not path.is_file():
        return {}
    try:
        with tempfile.TemporaryDirectory(prefix="gb-queue-") as work:
            connection = dbcopy.open_copy(path, Path(work))
            try:
                row = connection.execute("SELECT doc FROM latest_docs WHERE grp = 'characters'").fetchone()
            finally:
                connection.close()
        builds = (json.loads(row[0]).get("builds") or {}).get("builds") if row else None
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"the store at {path} could not be read ({error}): no characters are counted as owned", file=sys.stderr)
        return {}
    found: dict[str, dict] = {}
    for record in builds or ():
        try:
            levels = _talent_levels(record)
            found[slug(str(record["name"]))] = {
                "talent": max(levels, default=1), "constellation": int(record.get("constellation") or 0),
                "level": int(record.get("level") or 1)}
        except (KeyError, TypeError, ValueError):
            continue
    return found


# ------------------------------------------------------------------------------------------------ the order

def unchecked(keys: list[str], decided_dir: Path = DECIDED) -> list[str]:
    """The characters of `keys` with no decision."""
    decided = kitgen.load_decided(decided_dir)["characters"]
    return [key for key in keys if key not in decided]


def release_ranks(inventory: list[dict]) -> dict[str, int]:
    """Each inventory character's rank in release, 0 the newest: by game version, newest first, a version's characters in the
    inventory's order."""
    def version(item: dict) -> tuple[int, ...]:
        try:
            return tuple(int(part) for part in str(item.get("version") or "0").split("."))
        except ValueError:
            return (0,)

    ranked = sorted(enumerate(inventory), key=lambda pair: (tuple(-n for n in version(pair[1])), pair[0]))
    return {item["key"]: rank for rank, (_, item) in enumerate(ranked)}


def order(keys: list[str], owned: dict[str, dict], released: dict[str, int]) -> list[str]:
    """`keys` as the queue has them: the owned first (highest raised talent, constellation, level), then the rest by release,
    newest first. A key with no rank in `released` is newer than any with one, the later of `keys` first."""
    def rank(position: int, key: str) -> int:
        return released[key] if key in released else -(position + 1)

    place = {key: position for position, key in enumerate(keys)}
    mine = sorted((k for k in keys if k in owned),
                  key=lambda k: (-owned[k]["talent"], -owned[k]["constellation"], -owned[k]["level"], rank(place[k], k)))
    rest = sorted((k for k in keys if k not in owned), key=lambda k: rank(place[k], k))
    return mine + rest


# ------------------------------------------------------------------------------------------------ batches and lanes

def plan(keys: list[str], owned: set[str], size: int = BATCH_SIZE, lanes: int = LANES) -> dict:
    """`keys` (in queue order) in batches of about `size` and even, a multiple of `lanes` of them when there are enough, and the
    batches' names in lanes. The owned are dealt round the lanes, the first batch of each first, so each lane starts with some."""
    total = len(keys)
    if not total:
        return {"batches": [], "lanes": []}
    count = max(1, round(total / size))
    count = min(total, max(lanes, round(count / lanes) * lanes))
    lane_count = min(lanes, count)
    caps = [total // count + (1 if i < total % count else 0) for i in range(count)]
    held: list[list[str]] = [[] for _ in range(count)]
    place = {key: i for i, key in enumerate(keys)}
    mine = [k for k in keys if k in owned]
    for turn, key in enumerate(mine):
        # round after round of batches, each round's lanes in turn from this character's, so that an overflow also spreads
        order_of_tries = sorted(range(count), key=lambda i: (i // lane_count, (i - turn) % lane_count))
        held[next(i for i in order_of_tries if len(held[i]) < caps[i])].append(key)
    rest = iter(k for k in keys if k not in owned)
    for i in range(count):
        while len(held[i]) < caps[i]:
            held[i].append(next(rest))
    batches = [{"name": f"batch-{i + 1:02d}", "keys": sorted(group, key=place.__getitem__)} for i, group in enumerate(held)]
    return {"batches": batches, "lanes": [[batches[i]["name"] for i in range(j, count, lane_count)] for j in range(lane_count)]}


# ------------------------------------------------------------------------------------------------ the files

def write_queue(out: Path, *, db_path: Path | None = None, kits: dict | None = None, inventory: list[dict] | None = None,
                decided_dir: Path = DECIDED, size: int = BATCH_SIZE, lanes: int = LANES) -> dict:
    """Writes `queue.json` and `queue/<batch>.txt` in `out` and returns what `queue.json` holds. The old batch files go first;
    nothing else of the folder is touched. The defaults are the app's own files; the store is only read, from a copy."""
    if kits is None:
        kits = json.loads(KITS.read_text(encoding="utf-8"))["characters"]
    if inventory is None:
        inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))["characters"]
    if db_path is None:
        from guildboard import config

        db_path = config.AppPaths(config.default_data_dir()).db_path
    todo = unchecked(list(kits), decided_dir)
    everyone = owned_progress(db_path)
    mine = {key: everyone[key] for key in todo if key in everyone}
    queue = order(todo, mine, release_ranks(inventory))
    made = plan(queue, set(mine), size, lanes)
    for batch in made["batches"]:
        batch["owned"] = [k for k in batch["keys"] if k in mine]
    result = {
        "counts": {"unchecked": len(todo), "owned": len(mine), "batches": len(made["batches"]), "lanes": len(made["lanes"])},
        "owned_not_in_kits": len([k for k in everyone if k not in kits]),
        "batches": made["batches"], "lanes": made["lanes"], "owned": mine, "queue": queue,
    }
    folder = out / "queue"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("batch-*.txt"):
        old.unlink()
    for batch in made["batches"]:
        (folder / f"{batch['name']}.txt").write_text("".join(f"{k}\n" for k in batch["keys"]), encoding="utf-8", newline="\n")
    (out / "queue.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return result


def counts_line(result: dict) -> str:
    """The counts as one line: no names (the roster stays in the git-ignored files)."""
    counts = result["counts"]
    return (f"unchecked {counts['unchecked']}, owned among them {counts['owned']}, batches {counts['batches']}, lanes {counts['lanes']}"
            f" (the player's characters the kits lack: {result['owned_not_in_kits']})")


def main(argv: list[str] | None = None) -> int:
    if argv if argv is not None else sys.argv[1:]:
        raise SystemExit(__doc__)
    print(counts_line(write_queue(OUT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
