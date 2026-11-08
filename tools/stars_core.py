"""A demo core that also serves the real constellation charts, for proving that the stars sit on them (`npm run proof:stars`,
web/screens/stars.spec.ts, then tools/research/stars_check.py).

The demo downloads no picture and bundles only its own, so its chart says nothing about the charts of any size. This starts the
same demo core with each chart of a folder in its list of pictures, as `chart<key>` (the key without its hyphens), copied into
the core's own data folder. The measuring page gives Sandrone's card each chart and its stars in turn. Pictures asked for at a
size go through the same code as the live window's (`ArtCache.get`, Pillow's copies). It prints the launch link as `guildboard
--no-shell` does, and is never run on the player's data folder: the folder must be new or empty.

    uv run python tools/stars_core.py --data-dir DIR --demo-now 2026-10-25T08:00:00+00:00 --charts FOLDER
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
from datetime import datetime
from pathlib import Path

from guildboard.__main__ import default_web_dir, serve
from guildboard.config import AppPaths
from guildboard.core import Core


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--demo-now", required=True)
    parser.add_argument("--charts", type=Path, required=True)
    args = parser.parse_args()
    if args.data_dir.exists() and any(args.data_dir.iterdir()):  # never the player's folder, nor anything else that holds files
        parser.error("--data-dir must be a new, empty folder.")
    paths = AppPaths(args.data_dir)
    paths.ensure()
    core = Core(paths, demo=True, demo_now=datetime.fromisoformat(args.demo_now))
    source = core.art.demo_dir
    folder = args.data_dir / "real-charts"
    (folder / "pictures").mkdir(parents=True, exist_ok=True)
    listed: dict[str, dict[str, str]] = json.loads((source / "pictures.json").read_text(encoding="utf-8"))
    for key, row in listed.items():  # the demo ships no picture (a row names no file): its signs stay as they are
        if "file" in row:
            shutil.copy2(source / row["file"], folder / "pictures" / Path(row["file"]).name)
            listed[key] = {**row, "file": f"pictures/{Path(row['file']).name}"}
    for chart in sorted(args.charts.glob("*.png")):
        key = "chart" + chart.stem.replace("-", "")
        shutil.copy2(chart, folder / "pictures" / f"{key}.png")
        listed[key] = {"file": f"pictures/{key}.png", "url": f"https://act-webstatic.hoyoverse.com/stars/{key}.png"}
    (folder / "pictures.json").write_text(json.dumps(listed), encoding="utf-8")
    core.art.demo_dir = folder
    asyncio.run(serve(core, port=0, web_dir=default_web_dir()))
    shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    main()
