"""tools/go-reference/work_queue.py: the queue of characters to decide, owned ones first, in batches and lanes. A developer tool; the
player's roster never goes into a committed file, so these tests use a made-up roster in a temporary database."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"


def _load(name: str):
    sys.path.insert(0, str(TOOL))
    try:
        spec = importlib.util.spec_from_file_location(f"gbref_{name}", TOOL / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[f"gbref_{name}"] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(TOOL))


queue = _load("work_queue")   # not named queue.py: the tool's folder is on sys.path and would shadow the standard library's queue


def record(name: str, level: int = 90, constellation: int = 0, talents: tuple[int, int, int] = (1, 1, 1)) -> dict:
    return {"name": name, "level": level, "constellation": constellation,
            "skills": [{"skill_type": 1, "level": talents[0]}, {"skill_type": 2, "level": talents[1]},
                       {"skill_type": 3, "level": talents[2]}, {"skill_type": 2, "level": 1}]}


def make_store(folder: Path, builds: list[dict] | None) -> Path:
    """A database in WAL mode, as the app's is, with its `latest_docs` table; the connection stays open (its -wal and -shm
    beside it) so the test can see what a read leaves behind."""
    path = folder / "guildboard.db"
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE latest_docs (grp TEXT PRIMARY KEY, taken_at TEXT NOT NULL, doc TEXT NOT NULL)")
    if builds is not None:
        connection.execute("INSERT INTO latest_docs VALUES ('characters', '2026-11-14T10:00:00+00:00', ?)",
                           (json.dumps({"builds": {"builds": builds}}),))
    connection.commit()
    make_store.open.append(connection)
    return path


make_store.open = []


@pytest.fixture(autouse=True)
def _close_stores():
    yield
    for connection in make_store.open:
        connection.close()
    make_store.open.clear()


def test_owned_reads_a_copy_and_leaves_nothing_beside_the_store(tmp_path):
    store_dir = tmp_path / "data"
    store_dir.mkdir()
    path = make_store(store_dir, [record("Alpha", constellation=2, talents=(8, 10, 10)), record("Beta Gamma", talents=(1, 1, 1))])
    before = {p.name: p.read_bytes() for p in store_dir.iterdir()}
    found = queue.owned_progress(path)
    after = {p.name: p.read_bytes() for p in store_dir.iterdir()}
    assert before == after
    assert found["alpha"] == {"talent": 10, "constellation": 2, "level": 90}
    assert found["beta-gamma"]["talent"] == 1


def test_a_talent_above_ten_counts_without_its_constellations_levels(tmp_path):
    path = make_store(tmp_path, [record("Delta", constellation=5, talents=(9, 13, 13))])
    assert queue.owned_progress(path)["delta"]["talent"] == 10


def test_a_store_that_cannot_be_read_says_so_on_stderr(tmp_path, capsys):
    path = tmp_path / "guildboard.db"
    path.write_bytes(b"this is not a database" * 100)
    assert queue.owned_progress(path) == {}
    assert "could not be read" in capsys.readouterr().err


def test_no_store_or_no_characters_document_means_nobody_owned(tmp_path):
    assert queue.owned_progress(tmp_path / "nothing.db") == {}
    assert queue.owned_progress(make_store(tmp_path, None)) == {}


def test_owned_come_first_by_highest_talent_then_newest(tmp_path):
    keys = ["a", "b", "c", "d", "e", "f"]
    owned = {"c": {"talent": 6, "constellation": 0, "level": 80}, "e": {"talent": 10, "constellation": 0, "level": 90},
             "b": {"talent": 10, "constellation": 1, "level": 90}}
    released = {"a": 0, "b": 4, "c": 3, "d": 2, "e": 1, "f": 5}   # lower is newer
    ordered = queue.order(keys, owned, released)
    assert ordered[:3] == ["b", "e", "c"]          # 10 with C1, 10, then 6
    assert ordered[3:] == ["a", "d", "f"]          # newest first


def test_a_character_of_no_release_date_is_newest_among_the_rest():
    ordered = queue.order(["old", "unknown", "new"], {}, {"old": 5, "new": 1})
    assert ordered == ["unknown", "new", "old"]


def test_batches_are_even_and_lanes_deal_the_owned_across_every_lane():
    keys = [f"k{i:03d}" for i in range(111)]
    owned = set(keys[:20])
    plan = queue.plan(keys, owned, size=18, lanes=3)
    sizes = [len(b["keys"]) for b in plan["batches"]]
    assert sum(sizes) == 111 and len(sizes) == 6 and max(sizes) - min(sizes) <= 1
    assert sorted(k for b in plan["batches"] for k in b["keys"]) == sorted(keys)      # each once
    assert [len(lane) for lane in plan["lanes"]] == [2, 2, 2]
    names = {b["name"]: b for b in plan["batches"]}
    for lane in plan["lanes"]:
        assert any(k in owned for k in names[lane[0]]["keys"])          # every lane starts with owned characters
    assert sorted(n for lane in plan["lanes"] for n in lane) == sorted(names)
    assert plan["batches"][0]["name"] == "batch-01"


def test_more_owned_than_the_first_batches_hold_spread_over_the_lanes_next_batches():
    keys = [f"k{i:03d}" for i in range(111)]
    plan = queue.plan(keys, set(keys[:65]), size=18, lanes=3)
    names = {b["name"]: b for b in plan["batches"]}
    owned = set(keys[:65])
    for lane in plan["lanes"]:
        assert set(names[lane[0]]["keys"]) <= owned                      # a lane's first batch is all owned
    seconds = [names[lane[1]]["keys"] for lane in plan["lanes"]]
    assert sum(1 for k in sum(seconds, []) if k in owned) == 65 - sum(len(names[lane[0]]["keys"]) for lane in plan["lanes"])
    assert all(any(k in owned for k in group) for group in seconds)     # the overflow lands in every lane's second batch


def test_nobody_owned_still_makes_batches_and_a_small_queue_fewer_lanes():
    plan = queue.plan([f"k{i}" for i in range(5)], set(), size=18, lanes=3)
    assert len(plan["batches"]) == 3 and [len(l) for l in plan["lanes"]] == [1, 1, 1]
    assert queue.plan([], set(), size=18, lanes=3) == {"batches": [], "lanes": []}
    assert len(queue.plan(["x", "y"], set(), size=18, lanes=3)["batches"]) == 2


def test_the_unchecked_are_the_characters_with_no_decision(tmp_path):
    decided = tmp_path / "decided"
    decided.mkdir()
    (decided / "_about.json").write_text(json.dumps({"about": "x", "checked": "y"}), encoding="utf-8")
    (decided / "done.json").write_text(json.dumps({"main": ["normal"]}), encoding="utf-8")
    (decided / "doubtful.json").write_text(json.dumps({"unsure": "a sentence"}), encoding="utf-8")   # still to decide
    assert queue.unchecked(["done", "doubtful", "todo"], decided) == ["doubtful", "todo"]


def test_main_writes_the_queue_and_its_batch_files_and_prints_counts_only(tmp_path, capsys):
    store_dir = tmp_path / "data"
    store_dir.mkdir()
    path = make_store(store_dir, [record("Alpha", talents=(1, 9, 1))])
    out = tmp_path / "out"
    kits = {"alpha": {}, "beta": {}, "gamma": {}, "decided-one": {}}
    inventory = [{"key": "gamma", "version": "7.1"}, {"key": "beta", "version": "5.0"}, {"key": "alpha", "version": "1.0"}]
    decided = tmp_path / "decided"
    decided.mkdir()
    (decided / "decided-one.json").write_text(json.dumps({"main": ["normal"]}), encoding="utf-8")
    result = queue.write_queue(out, db_path=path, kits=kits, inventory=inventory, decided_dir=decided, size=18, lanes=3)
    printed = queue.counts_line(result)
    assert "alpha" not in printed and "beta" not in printed and "gamma" not in printed
    data = json.loads((out / "queue.json").read_text(encoding="utf-8"))
    assert data["counts"] == {"unchecked": 3, "owned": 1, "batches": 3, "lanes": 3}
    assert [b["keys"] for b in data["batches"]] == [["alpha"], ["gamma"], ["beta"]]
    assert (out / "queue" / "batch-01.txt").read_text(encoding="utf-8") == "alpha\n"
    assert (out / "queue" / "batch-02.txt").read_text(encoding="utf-8") == "gamma\n"


def test_main_removes_the_old_batch_files_and_keeps_other_files(tmp_path):
    out = tmp_path / "out"
    (out / "queue").mkdir(parents=True)
    (out / "queue" / "batch-09.txt").write_text("stale\n", encoding="utf-8")
    (out / "queue" / "notes.md").write_text("mine\n", encoding="utf-8")
    queue.write_queue(out, db_path=tmp_path / "none.db", kits={"a": {}}, inventory=[], decided_dir=tmp_path / "nodecided")
    assert not (out / "queue" / "batch-09.txt").exists() and (out / "queue" / "notes.md").exists()


def test_the_queue_is_ignored_by_git():
    import subprocess
    run = subprocess.run(["git", "check-ignore", ".superpowers/queue.json", ".superpowers/queue/batch-01.txt"], cwd=ROOT,
                         capture_output=True, text=True)
    assert run.returncode == 0
    assert set(run.stdout.split()) == {".superpowers/queue.json", ".superpowers/queue/batch-01.txt"}
