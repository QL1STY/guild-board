"""The proof that the constellation stars sit on their charts: measures what `npm run proof:stars` kept, and makes contact sheets.

Run: uv run --with pillow --with numpy --with scipy python tools/research/stars_check.py <label>      (build time only)

For each character, window and picture quality, web/test-results/stars/<label>/<window>-<quality>/ holds the chart as the real
page drew it, with the stars hidden, and where the page drew the stars. This finds the bright star centres in that very picture
(see `centres`), and gives for each of the six the distance from the drawn point to the nearest one, in pixels of the usual window
(a chart of 560 on the screen). A point further than `OFF` px from any counts as off. The results go to
web/test-results/stars/<label>/report.json, and the sheets to .../sheets/: twelve charts a page, each with a small cross and
its number at each drawn star, and the lines C1-C2-...-C6, so that the chart's own stars stay in sight under them.

Pass `--data` to measure stars.json against the charts themselves instead, in the chart's pixels (no page, no browser).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RESULTS = ROOT / "web" / "test-results" / "stars"
CHARTS = HERE / "out" / "charts"
STARS = ROOT / "src" / "guildboard" / "reference" / "characters" / "stars.json"
OFF = 4.0  # in pixels of the usual window: a star icon is 57 across, a chart's star about 10
PEAK = 70.0  # how far above its neighbourhood (0-255) a star's centre stands
PER_SHEET = 12
COLUMNS = 4
THUMB = 450


def centres(image: Image.Image, scale: float) -> list[tuple[float, float, float]]:
    """The bright star centres of a chart at `scale` x 560 pixels: (x, y, height). A chart's star is a small white core in a glow,
    so the picture is smoothed a little and each pixel compared with its neighbourhood: a centre is the weighted middle of the
    top of a peak that stands well above it (stars stand 95 or more above it, the charts' lines and dust less). A star with a
    glow as wide as the neighbourhood (Prune's) stands out little, and is found as a burnt-out white core instead. A moon-disc
    star (Columbina's) is found as a round disc: its bright part is a phase of the moon, off to one side, and its centre the disc's."""
    grey = np.asarray(image.convert("L"), dtype=np.float32)
    soft = ndimage.gaussian_filter(grey, 0.8 * scale)
    around = ndimage.gaussian_filter(grey, 10.0 * scale)
    lift = soft - around
    found: list[tuple[float, float, float]] = []
    tops = (lift == ndimage.maximum_filter(lift, size=int(9 * scale) | 1)) & (lift > PEAK)
    reach = max(2, round(3 * scale))
    height, width = lift.shape
    for y, x in np.argwhere(tops):
        y0, y1, x0, x1 = max(0, y - reach), min(height, y + reach + 1), max(0, x - reach), min(width, x + reach + 1)
        patch = np.maximum(lift[y0:y1, x0:x1] - lift[y, x] * 0.6, 0.0)
        ys, xs = np.mgrid[y0:y1, x0:x1]
        found.append((float((xs * patch).sum() / patch.sum()), float((ys * patch).sum() / patch.sum()), float(lift[y, x])))
    labels, count = ndimage.label(soft >= 248, structure=np.ones((3, 3)))
    for index in range(1, count + 1):
        ys, xs = np.nonzero(labels == index)
        if len(xs) >= 6 * scale * scale:
            found.append((float(xs.mean()), float(ys.mean()), 255.0))
    blue = ndimage.binary_opening(np.asarray(image, dtype=np.float32)[:, :, 2] > 225, iterations=max(1, round(2 * scale)))
    labels, count = ndimage.label(ndimage.binary_fill_holes(blue))
    for box in ndimage.find_objects(labels):
        tall, wide = box[0].stop - box[0].start, box[1].stop - box[1].start
        if 22 * scale <= min(tall, wide) and max(tall, wide) <= 42 * scale and max(tall, wide) <= 1.25 * min(tall, wide):
            found.append(((box[1].start + box[1].stop - 1) / 2, (box[0].start + box[0].stop - 1) / 2, 255.0))
    return found


def font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for name in ("arial.ttf", "C:/Windows/Fonts/arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def measure(picture: Path, row: dict[str, Any]) -> dict[str, Any]:
    image = Image.open(picture).convert("RGB")
    scale = row["box"][0] / 560  # device pixels to a pixel of the usual window, zoom included
    found = centres(image, scale)
    distances = []
    for x, y in row["stars"]:
        nearest = min((math.hypot(x - cx, y - cy) for cx, cy, _ in found), default=math.inf)
        distances.append(round(nearest / scale, 2))
    return {"key": row["key"], "size": row["size"], "distances": distances, "worst": max(distances), "centres": len(found), "natural": row["natural"]}


def sheet_page(cells: list[tuple[str, Path, dict[str, Any], str]], path: Path) -> None:
    """Each cell: a title, the picture, its row and a line of text."""
    lines = math.ceil(len(cells) / COLUMNS)
    cell_h = THUMB + 24
    sheet = Image.new("RGB", (COLUMNS * THUMB, lines * cell_h), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    label, small = font(17), font(14)
    for n, (title, picture, row, note) in enumerate(cells):
        ox, oy = (n % COLUMNS) * THUMB, (n // COLUMNS) * cell_h
        shot = Image.open(picture).convert("RGB")
        ratio = THUMB / max(shot.size)
        sheet.paste(shot.resize((round(shot.width * ratio), round(shot.height * ratio))), (ox, oy + 24))
        draw.text((ox + 4, oy + 3), f"{title}  {note}", fill=(255, 235, 150), font=small)
        points = [(x * ratio + ox, y * ratio + oy + 24) for x, y in row["stars"]]
        for a, b in zip(points, points[1:]):
            draw.line([a, b], fill=(255, 70, 70), width=1)
        for number, (px, py) in enumerate(points, start=1):
            draw.line([(px - 7, py), (px + 7, py)], fill=(255, 255, 0), width=1)
            draw.line([(px, py - 7), (px, py + 7)], fill=(255, 255, 0), width=1)
            draw.text((px + 8, py - 21), str(number), fill=(255, 255, 0), font=label, stroke_width=1, stroke_fill=(0, 0, 0))
    sheet.save(path)


def summary(name: str, rows: list[dict[str, Any]]) -> None:
    all_distances = [d for row in rows for d in row["distances"]]
    off = [row for row in rows if row["worst"] > OFF]
    print(
        f"{name}: {len(rows)} charts, {len(off)} with a star off by more than {OFF:g}; each star's distance: "
        f"median {np.median(all_distances):.1f}, 95% {np.percentile(all_distances, 95):.1f}, worst {max(all_distances):.1f}"
    )


def pages(label: str) -> None:
    folder = RESULTS / label
    report: dict[str, Any] = {}
    for window in sorted(p for p in folder.iterdir() if p.is_dir() and p.name != "sheets"):
        rows = []
        for data in sorted(window.glob("*.json")):
            row = json.loads(data.read_text(encoding="utf-8"))
            rows.append(measure(data.with_suffix(".png"), row))
        report[window.name] = rows
        summary(window.name, rows)
    (folder / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    first = folder / "usual-high"
    sheets = folder / "sheets"
    sheets.mkdir(exist_ok=True)
    rows_by_key = {row["key"]: row for row in report["usual-high"]}
    keys = sorted(rows_by_key, key=lambda k: (rows_by_key[k]["size"][0] / rows_by_key[k]["size"][1], rows_by_key[k]["size"][0], k))
    for page in range(0, len(keys), PER_SHEET):
        cells = []
        for key in keys[page : page + PER_SHEET]:
            row = json.loads((first / f"{key}.json").read_text(encoding="utf-8"))
            worst = max(rows_by_key[key]["distances"])
            cells.append((key, first / f"{key}.png", row, f"{row['size'][0]}x{row['size'][1]} worst {worst:.1f}"))
        sheet_page(cells, sheets / f"sheet-{page // PER_SHEET + 1:02d}.png")
    print(f"sheets in {sheets}")
    worst = sorted(report["usual-high"], key=lambda row: -row["worst"])[:15]
    print("worst:", [(row["key"], row["worst"]) for row in worst])


def data() -> None:
    """stars.json against the charts themselves, in the chart's pixels."""
    stars = json.loads(STARS.read_text(encoding="utf-8"))
    rows = []
    for key, entry in sorted(stars.items()):
        chart = CHARTS / f"{key}.png"
        if not chart.exists():
            print(f"no chart for {key}")
            continue
        image = Image.open(chart).convert("RGBA")
        black = Image.new("RGBA", image.size, (0, 0, 0, 255))
        image = Image.alpha_composite(black, image).convert("RGB")
        if list(image.size) != entry["size"]:
            print(f"{key}: the chart is {image.size}, stars.json says {entry['size']}")
        scale = max(image.size) / 560
        found = centres(image, scale)
        distances = [round(min((math.hypot(x - cx, y - cy) for cx, cy, _ in found), default=math.inf) / scale, 2) for x, y in entry["points"]]
        rows.append({"key": key, "size": entry["size"], "distances": distances, "worst": max(distances), "centres": len(found)})
    summary("stars.json on the charts", rows)
    print("worst:", [(row["key"], row["worst"]) for row in sorted(rows, key=lambda row: -row["worst"])[:25]])


if __name__ == "__main__":
    if "--data" in sys.argv:
        data()
    else:
        pages(sys.argv[1])
