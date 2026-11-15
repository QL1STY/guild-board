"""Reading the app's database from the developer tools without touching its folder. The app's database is in WAL mode: opening
it even read-only leaves a -shm and a -wal beside it, which would be a write into the app's data folder, so a tool reads a copy of its
files (the database and its write-ahead log, when there is one) in a temporary folder and opens that."""
from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path


def open_copy(path: Path, work: Path) -> sqlite3.Connection:
    """A copy of the database at `path` (and its -wal) in `work`, opened there. The original is only ever read as a file."""
    for suffix in ("", "-wal"):
        source = Path(str(path) + suffix)
        if source.is_file():
            shutil.copyfile(source, work / (path.name + suffix))
    return sqlite3.connect(work / path.name)
