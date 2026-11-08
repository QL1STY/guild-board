"""A demo core whose pictures are as large as the real ones, for measuring the Characters pages' memory (`npm run
memory:characters`, web/screens/memory.spec.ts).

The demo's bundled pictures are few and small, so they say nothing about memory. This starts the same demo core with more
pictures in its list, made up and drawn as gradients in the core's data folder (nothing is downloaded): `bigartNN`, twelve
characters' art at 2048 x 2048 with a see-through border; `bigchartNN`, their constellation charts at 1024 x 1024; and
`bigfaceNN`, a face for each of the roster's characters at 256 x 256. The measuring page gives the characters these pictures
(web/screens/memory.spec.ts). The sizes are what the player described (2048-pixel art) and a guess for the rest. It prints the
launch link as `guildboard --no-shell` does.

    uv run python tools/memory_core.py --data-dir DIR --demo-now 2026-10-25T08:00:00+00:00 [--week-and-endgame]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
from datetime import datetime
from pathlib import Path

from guildboard import characters
from guildboard.__main__ import default_web_dir, serve
from guildboard.config import AppPaths
from guildboard.core import Core

ART, CHART, FACE = 2048, 1024, 256
ARTS, FACES = 12, 160


def _picture(path: Path, side: int, seed: int) -> None:
    from PIL import Image, ImageDraw

    margin = side // 10
    inner = side - 2 * margin
    # A gradient between two colours, built from a one-pixel-high strip stretched to the square (cheap at 2048).
    first, last = ((seed * 53) % 256, (seed * 97) % 256, 200), (250, (seed * 31) % 256, (seed * 17) % 256)
    strip = Image.new("RGB", (inner, 1))
    strip.putdata([tuple(round(a + (b - a) * x / max(inner - 1, 1)) for a, b in zip(first, last)) for x in range(inner)])
    image = Image.new("RGBA", (side, side), (0, 0, 0, 0))  # see-through
    image.paste(strip.resize((inner, inner)), (margin, margin))
    detail = ImageDraw.Draw(image, "RGBA")
    for step in range(40):  # some detail, so that nothing compresses to nothing
        left, top = (step * 97 + seed * 13) % side, (step * 61 + seed * 7) % side
        detail.rectangle((left, top, left + side // 9, top + side // 9), fill=(step * 6, 40, 255 - step * 6, 140))
    image.save(path, "PNG")


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
    source = core.art.demo_dir
    folder = args.data_dir / "big-demo-art"
    (folder / "pictures").mkdir(parents=True, exist_ok=True)
    listed: dict[str, dict[str, str]] = json.loads((source / "pictures.json").read_text(encoding="utf-8"))
    for key, row in listed.items():  # the demo ships no picture (a row names no file): its signs stay as they are
        if "file" in row:
            shutil.copy2(source / row["file"], folder / "pictures" / Path(row["file"]).name)
            listed[key] = {**row, "file": f"pictures/{Path(row['file']).name}"}
    wanted = [(f"bigart{n:02d}", ART) for n in range(ARTS)] + [(f"bigchart{n:02d}", CHART) for n in range(ARTS)]
    wanted += [(f"bigface{n:03d}", FACE) for n in range(FACES)]
    for number, (key, side) in enumerate(wanted):
        _picture(folder / "pictures" / f"{key}.png", side, number)
        listed[key] = {"file": f"pictures/{key}.png", "url": f"https://act-webstatic.hoyoverse.com/memory/{key}.png"}
    (folder / "pictures.json").write_text(json.dumps(listed), encoding="utf-8")
    core.art.demo_dir = folder
    asyncio.run(serve(core, port=0, web_dir=default_web_dir()))
    shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    main()
