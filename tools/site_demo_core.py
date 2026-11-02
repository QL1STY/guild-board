"""The demo core as the site's recording needs it (tools/record-site-demo.py starts it).

The demo bundles no picture of the game's, so its models hold no picture address and its pages show the drawn signs. The site's demo
shows the official pictures instead, read by the visitor's browser from HoYoverse's own addresses, which `pictures.json` lists key
by key. For the recording to name them, this core counts every picture of that list as one it has (as `/api/art/<key>`), where the
demo's own core counts only those that name a file. It serves none of them, downloads nothing, and changes nothing in the app's own
demo (`guildboard --demo` is as it was). It prints the launch link as `guildboard --no-shell` does, and starts only on a new, empty
data folder.

    uv run python tools/site_demo_core.py --data-dir DIR --demo-now 2026-10-13T08:00:00+00:00 [--week-and-endgame]
"""
from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime
from pathlib import Path

from guildboard import characters
from guildboard.__main__ import default_web_dir, serve
from guildboard.config import AppPaths
from guildboard.core import Core


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--demo-now", required=True)
    parser.add_argument("--week-and-endgame", action="store_true")
    args = parser.parse_args()
    if args.data_dir.exists() and any(args.data_dir.iterdir()):  # never the player's folder, nor anything else that holds files
        parser.error("--data-dir must be a new, empty folder.")
    if args.week_and_endgame:
        characters.WEEK_AND_ENDGAME = True
    paths = AppPaths(args.data_dir)
    paths.ensure()
    core = Core(paths, demo=True, demo_now=datetime.fromisoformat(args.demo_now))
    listed = json.loads((core.art.demo_dir / "pictures.json").read_text(encoding="utf-8"))
    core.art._pictures = lambda: listed  # every listed picture has an address; none is served
    asyncio.run(serve(core, port=0, web_dir=default_web_dir()))


if __name__ == "__main__":
    main()
