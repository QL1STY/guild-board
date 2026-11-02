"""R2: the six constellation stars of each released character, found on the wiki's "Constellation" chart.

Run: uv run --with pillow python tools/research/stars.py          (build time only; needs out/inventory.json from inventory.py)

Steps, as the plan's Task R2 gives them:
  1. each released character's chart is downloaded to out/charts/<key>.png (the URL is in out/inventory.json);
  2. the bright points: luminance above the 99.9th percentile, connected areas, their centres, any two centres within
     12 px merged, and the six largest kept (a lower percentile is tried when fewer than six are found);
  3. the six are ordered C1 to C6 along the chain. The chain is found from the chart's lines: for every pair of points
     the script scores how much of the straight segment between them is brighter than its surroundings, and takes the
     order of six points whose consecutive pairs score best. For a closed chain, where the last star joins the first,
     C1 is the star nearest the top left and C2 its neighbour that sits higher (a rule, not a fact; marked "loop");
  4. out/stars_candidates.json holds the result and out/sheets/sheet-NN.png the contact sheets: twenty charts a page,
     each with its six points drawn and numbered.
A hand-corrections file, tools/research/stars_corrections.json, is read when it exists, and out/stars.json is the result
with the corrections applied: {key: {"points": [[x, y] x 6]} | {"skip": true, "note": "..."}, "note": "..."}.

Source of the charts: the HoYoLAB wiki's Gallery, "Constellation" picture of each character's entry
(https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page, checked 2026-10-29).
"""
from __future__ import annotations

import itertools
import json
import math
import sys
from datetime import date
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wikiapi as w  # noqa: E402

ROOT = w.HERE.parents[1]
CHARTS = w.OUT / "charts"
SHEETS = w.OUT / "sheets"
CORRECTIONS = w.HERE / "stars_corrections.json"
PERCENTILES = (99.9, 99.8, 99.7, 99.5, 99.0)
MERGE_PX = 12
EDGE_ON = 15  # how much brighter than its surroundings (0-255) a pixel on a line is
PER_SHEET = 20
COLUMNS = 5
THUMB = 360


def flatten(path: Path) -> Image.Image:
    image = Image.open(path)
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        black = Image.new("RGBA", image.size, (0, 0, 0, 255))
        image = Image.alpha_composite(black, image)
    return image.convert("RGB")


def components(mask: Image.Image) -> list[tuple[float, float, int]]:
    """Connected areas (8 neighbours) of a 0/255 mask as (x, y, pixels)."""
    width, height = mask.size
    data = mask.load()
    seen: set[tuple[int, int]] = set()
    found: list[tuple[float, float, int]] = []
    for y, x in ((y, x) for y in range(height) for x in range(width) if data[x, y]):
        if (x, y) in seen:
            continue
        stack, area, sx, sy = [(x, y)], 0, 0, 0
        seen.add((x, y))
        while stack:
            cx, cy = stack.pop()
            area += 1
            sx += cx
            sy += cy
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < width and 0 <= ny < height and data[nx, ny] and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
        found.append((sx / area, sy / area, area))
    return found


def merge(points: list[tuple[float, float, int]]) -> list[tuple[float, float, int]]:
    points = list(points)
    changed = True
    while changed:
        changed = False
        for i, j in itertools.combinations(range(len(points)), 2):
            (x1, y1, a1), (x2, y2, a2) = points[i], points[j]
            if math.hypot(x1 - x2, y1 - y2) <= MERGE_PX:
                total = a1 + a2
                points[i] = ((x1 * a1 + x2 * a2) / total, (y1 * a1 + y2 * a2) / total, total)
                del points[j]
                changed = True
                break
    return points


def bright_points(lum: Image.Image) -> tuple[list[tuple[float, float, int]], float, str]:
    """Up to six points (x, y, pixels), the percentile used, and a note."""
    histogram = lum.histogram()
    total = sum(histogram)
    found: list[tuple[float, float, int]] = []
    used = PERCENTILES[0]
    for used in PERCENTILES:
        cutoff, below = 255, 0
        for level, count in enumerate(histogram):
            below += count
            if below >= total * used / 100:
                cutoff = level
                break
        # "above the percentile"; when the top level holds more than the allowed share, that level itself is taken.
        mask = lum.point(lambda v, c=cutoff: 255 if v > c else 0)
        if mask.getbbox() is None:
            mask = lum.point(lambda v, c=cutoff: 255 if v >= c else 0)
        found = merge(components(mask))
        if len(found) >= 6:
            break
    found.sort(key=lambda p: -p[2])
    note = "" if used == PERCENTILES[0] else f"found only with the {used}th percentile"
    if len(found) < 6:
        note = (note + "; " if note else "") + f"only {len(found)} bright points found"
    return found[:6], used, note


def edge_scores(lum: Image.Image, points: list[tuple[float, float, int]]) -> dict[tuple[int, int], float]:
    """For each pair, the share of the straight segment (clear of both ends) brighter than its surroundings by EDGE_ON."""
    ridge = ImageChops.subtract(lum, lum.filter(ImageFilter.GaussianBlur(5))).load()
    width, height = lum.size
    scores: dict[tuple[int, int], float] = {}
    for i, j in itertools.combinations(range(len(points)), 2):
        (x1, y1, _), (x2, y2, _) = points[i], points[j]
        length = math.hypot(x2 - x1, y2 - y1)
        if length < 40:
            scores[(i, j)] = 0.0
            continue
        ux, uy = (x2 - x1) / length, (y2 - y1) / length
        nx, ny = -uy, ux
        # A segment that runs through a third star is that star's two shorter segments, not a line of its own.
        if any(
            0 < (points[k][0] - x1) * ux + (points[k][1] - y1) * uy < length and abs((points[k][0] - x1) * nx + (points[k][1] - y1) * ny) < 14
            for k in range(len(points))
            if k not in (i, j)
        ):
            scores[(i, j)] = 0.0
            continue
        hits = count = 0
        step = 2.0
        t = 16.0
        while t < length - 16:
            count += 1
            best = 0
            for off in (-2, -1, 0, 1, 2):
                px, py = int(round(x1 + ux * t + nx * off)), int(round(y1 + uy * t + ny * off))
                if 0 <= px < width and 0 <= py < height:
                    best = max(best, ridge[px, py])
            hits += best > EDGE_ON
            t += step
        scores[(i, j)] = hits / count if count else 0.0
    return scores


STRONG = 0.6  # a pair whose segment is this much on a line is joined by a line on the chart


def order(points: list[tuple[float, float, int]], scores: dict[tuple[int, int], float]) -> tuple[list[int], str, list[float]]:
    """The six indexes in order C1 to C6, the shape of the chart's lines, and the score of each consecutive pair.

    chain  the lines make one path through all six: C1 is the end nearest the top left.
    loop   they make a closed ring: C1 is the star nearest the top left, C2 its neighbour that sits higher (a rule).
    branch the lines join the six but fork: an order in which each star is joined by a line to one lit before it,
           with as many lines between consecutive stars as there can be, from the star nearest the top left.
    unclear the lines do not join the six (the picture is not enough)."""
    def edge(a: int, b: int) -> float:
        return scores[(min(a, b), max(a, b))]

    def corner(k: int) -> float:
        return math.hypot(points[k][0], points[k][1])

    strong = {k: {m for m in range(6) if m != k and edge(k, m) >= STRONG} for k in range(6)}
    paths = [p for p in itertools.permutations(range(6)) if all(edge(p[k], p[k + 1]) >= STRONG for k in range(5))]
    if paths:
        rings = [p for p in paths if edge(p[0], p[5]) >= STRONG]
        if rings:
            ring = list(rings[0])
            start = min(ring, key=corner)
            at = ring.index(start)
            forward = [ring[(at + k) % 6] for k in range(6)]
            backward = [ring[(at - k) % 6] for k in range(6)]
            pick = forward if points[forward[1]][1] <= points[backward[1]][1] else backward
            return pick, "loop", [edge(pick[k], pick[(k + 1) % 6]) for k in range(6)]
        best = min(paths, key=lambda p: min(corner(p[0]), corner(p[5])))
        chain = list(best) if corner(best[0]) <= corner(best[5]) else list(reversed(best))
        return chain, "chain", [edge(chain[k], chain[k + 1]) for k in range(5)]

    def grown(p: tuple[int, ...]) -> bool:
        return all(strong[p[k]] & set(p[:k]) for k in range(1, 6))

    candidates = [p for p in itertools.permutations(range(6)) if grown(p)]
    if candidates:
        def key(p: tuple[int, ...]) -> tuple[float, float, float]:
            lines = sum(edge(p[k], p[k + 1]) >= STRONG for k in range(5))
            return (-lines, corner(p[0]), sum(math.hypot(points[p[k]][0] - points[p[k + 1]][0], points[p[k]][1] - points[p[k + 1]][1]) for k in range(5)))
        best = min(candidates, key=key)
        return list(best), "branch", [edge(best[k], best[k + 1]) for k in range(5)]
    best = max(itertools.permutations(range(6)), key=lambda p: sum(edge(p[k], p[k + 1]) for k in range(5)) - 0.001 * corner(p[0]))
    return list(best), "unclear", [edge(best[k], best[k + 1]) for k in range(5)]


def analyse(key: str) -> dict[str, Any]:
    path = CHARTS / f"{key}.png"
    image = flatten(path)
    lum = image.convert("L")
    points, percentile, note = bright_points(lum)
    result: dict[str, Any] = {"size": list(image.size), "percentile": percentile}
    if len(points) < 6:
        result.update(points=[], shape=None, confidence="none", notes=note)
        return result
    scores = edge_scores(lum, points)
    chain, shape, along = order(points, scores)
    weakest = min(along[:5])
    confidence = {"chain": "high", "loop": "medium", "branch": "medium", "unclear": "low"}[shape]
    if shape == "chain" and (weakest < 0.8 or note):
        confidence = "medium"
    if shape == "loop":
        note = (note + "; " if note else "") + "closed chain: C1 and C2 by a rule (nearest the top left, then the higher neighbour)"
    if shape == "branch":
        note = (note + "; " if note else "") + "the lines fork, so the picture does not show the game's order: each star joins one lit before it"
    if shape == "unclear":
        note = (note + "; " if note else "") + "the lines do not join the six stars"
    result.update(
        points=[[round(points[k][0]), round(points[k][1])] for k in chain],
        areas=[points[k][2] for k in chain],
        shape=shape,
        edge_scores=[round(s, 2) for s in along],
        confidence=confidence,
        notes=note,
    )
    return result


def font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for name in ("arial.ttf", "C:/Windows/Fonts/arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def contact_sheets(rows: list[tuple[str, dict[str, Any]]]) -> list[Path]:
    SHEETS.mkdir(parents=True, exist_ok=True)
    for old in SHEETS.glob("sheet-*.png"):
        old.unlink()
    label, small = font(18), font(15)
    paths: list[Path] = []
    cell_h = THUMB + 26
    for page in range(0, len(rows), PER_SHEET):
        chunk = rows[page : page + PER_SHEET]
        lines = math.ceil(len(chunk) / COLUMNS)
        sheet = Image.new("RGB", (COLUMNS * THUMB, lines * cell_h), (24, 24, 28))
        draw = ImageDraw.Draw(sheet)
        for n, (key, info) in enumerate(chunk):
            ox, oy = (n % COLUMNS) * THUMB, (n // COLUMNS) * cell_h
            chart = flatten(CHARTS / f"{key}.png")
            scale = THUMB / max(chart.size)
            thumb = chart.resize((round(chart.width * scale), round(chart.height * scale)))
            sheet.paste(thumb, (ox, oy + 26))
            draw.text((ox + 4, oy + 3), f"{page + n + 1}. {key} [{info.get('shape') or '-'} {info.get('confidence')}]", fill=(255, 235, 150), font=small)
            pts = [(x * scale + ox, y * scale + oy + 26) for x, y in info.get("points", [])]
            for a, b in zip(pts, pts[1:]):
                draw.line([a, b], fill=(255, 80, 80), width=1)
            for number, (px, py) in enumerate(pts, start=1):
                draw.ellipse([px - 9, py - 9, px + 9, py + 9], outline=(255, 60, 60), width=2)
                draw.text((px + 10, py - 20), str(number), fill=(255, 255, 0), font=label)
        path = SHEETS / f"sheet-{page // PER_SHEET + 1:02d}.png"
        sheet.save(path)
        paths.append(path)
    return paths


def snap(lum: Image.Image, x: float, y: float, radius: int = 20) -> list[int]:
    """A hand-read point moved to the centre of the brightest spot within `radius` px of it."""
    data = lum.load()
    window = [
        (px, py, data[px, py])
        for py in range(max(0, int(y) - radius), min(lum.height, int(y) + radius + 1))
        for px in range(max(0, int(x) - radius), min(lum.width, int(x) + radius + 1))
        if math.hypot(px - x, py - y) <= radius
    ]
    top = max(v for _, _, v in window)
    spot = [(px, py) for px, py, v in window if v >= top - 12]
    return [round(sum(px for px, _ in spot) / len(spot)), round(sum(py for _, py in spot) / len(spot))]


def apply_corrections(candidates: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    corrections = json.loads(CORRECTIONS.read_text(encoding="utf-8")) if CORRECTIONS.exists() else {}
    final: dict[str, dict[str, Any]] = {}
    for key, info in candidates.items():
        fix = corrections.get(key, {})
        entry = {"size": info["size"], "points": info["points"], "method": "script", "confidence": info["confidence"], "notes": info["notes"]}
        if "points" in fix:
            points = fix["points"]
            if fix.get("snap"):
                lum = flatten(CHARTS / f"{key}.png").convert("L")
                points = [snap(lum, x, y) for x, y in points]
            entry.update(points=points, method="hand", confidence=fix.get("confidence", "medium"))
        elif "confidence" in fix:
            entry.update(method="script, checked by hand", confidence=fix["confidence"])
        if fix.get("skip"):
            entry.update(points=[], method="hand", confidence="none")
        if fix.get("note"):
            entry["notes"] = (entry["notes"] + "; " if entry["notes"] else "") + fix["note"]
        if entry["points"] and len(entry["points"]) != 6:
            raise SystemExit(f"{key}: {len(entry['points'])} points, not six")
        final[key] = entry
    return final


def main() -> None:
    inventory = json.loads((w.OUT / "inventory.json").read_text(encoding="utf-8"))
    released = [c for c in inventory["characters"] if c["released"]]
    with_chart = [c for c in released if c["constellation_url"]]
    missing = [c["key"] for c in released if not c["constellation_url"]]
    print(f"{len(released)} released, {len(with_chart)} with a chart; no chart: {missing}")

    def fetch(c: dict[str, Any]) -> tuple[str, bool]:
        return c["key"], w.download(c["constellation_url"], CHARTS / f"{c['key']}.png")

    failed = [key for key, ok in w.parallel(fetch, with_chart) if not ok]
    if failed:
        print(f"could not download: {failed}")
    keys = [c["key"] for c in with_chart if c["key"] not in failed]

    results = dict(zip(keys, w.parallel(analyse, keys, workers=4)))
    candidates = {key: results[key] for key in keys}
    (w.OUT / "stars_candidates.json").write_text(json.dumps(candidates, ensure_ascii=False, indent=1), encoding="utf-8")
    final = apply_corrections(candidates)
    # The sheets show the result with the hand corrections applied.
    shown = [(key, {**candidates[key], "points": final[key]["points"], "confidence": final[key]["confidence"]}) for key in keys]
    sheets = contact_sheets(shown)
    print(f"{len(sheets)} contact sheets in {SHEETS}")

    document = {
        "checked": date.today().isoformat(),
        "source": "the 'Constellation' picture in each entry's Gallery on the HoYoLAB wiki (https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page); points found by tools/research/stars.py and checked by eye on its contact sheets",
        "no_chart": missing + failed,
        "stars": final,
    }
    (w.OUT / "stars.json").write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")
    # The reference file (schema/stars.schema.json): key -> {size, points}, for the charts whose six stars are known.
    reference = ROOT / "src/guildboard/reference/characters/stars.json"
    shaped = {k: {"size": v["size"], "points": v["points"]} for k, v in sorted(final.items()) if len(v["points"]) == 6}
    reference.write_text(json.dumps(shaped, ensure_ascii=False, separators=(",", ":")).replace("},", "},\n") + "\n", encoding="utf-8")
    print(f"wrote {reference.relative_to(ROOT)}: {len(shaped)} charts")
    sizes = {tuple(v["size"]) for v in final.values()}
    six = [k for k, v in final.items() if len(v["points"]) == 6]
    print(f"charts with six stars: {len(six)}; without: {len(final) - len(six)} (+{len(document['no_chart'])} with no chart); sizes {sizes}")
    print("confidence:", {c: sum(1 for v in final.values() if v['confidence'] == c) for c in ("high", "medium", "low", "none")})
    print("shape:", {s: sum(1 for v in candidates.values() if v.get("shape") == s) for s in ("chain", "loop", "branch", "unclear", None)})


if __name__ == "__main__":
    main()
