"""Puts Guild Board's site together in one folder, ready to be served or deployed to GitHub Pages.

    uv run python tools/assemble-site.py --out DIR [--demo web/dist-site] [--shots DIR]

It copies `site/` (the page: index.html, site.css, site.js), the fonts the page names (Alegreya Sans, from the interface's own
npm package, so nothing is read from Google), and, when given, the browser demo's build as `demo/` and the screenshots as `shots/`.
The screenshots are never kept in this repository: they come from the `site-assets` branch (.github/workflows/site.yml) or from
`npm run screens:site` (the ignored `screenshots/` folder). The folder `--out` must be new or empty (`_site` in the repository is ignored by git).

    cd web && npm run build:site-demo      (after tools/record-site-demo.py; see CONTRIBUTING.md)
    uv run python tools/assemble-site.py --out ../site-out --demo web/dist-site --shots screenshots/site
    python -m http.server --directory ../site-out 8080
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FONT_PACKAGE = ROOT / "web" / "node_modules" / "@fontsource" / "alegreya-sans"
WEIGHTS = (400, 500, 700, 800)
SUBSETS = ("latin", "latin-ext")
PAGES = ("index.html", "site.css", "site.js")
SHOTS = ("board.png", "achievements.png", "pulls.png", "stats.png", "year.png", "overlay.png")


def font_files() -> list[str]:
    return [f"alegreya-sans-{subset}-{weight}-normal.woff2" for weight in WEIGHTS for subset in SUBSETS]


def assemble(out: Path, demo: Path | None = None, shots: Path | None = None) -> list[str]:
    """Writes the site into `out` and answers the sentences of what is missing, which are not errors of the build: the
    pictures come from elsewhere, and a site without them is still served for a look."""
    missing: list[str] = []
    for name in PAGES:
        if not (SITE / name).is_file():
            raise SystemExit(f"site/{name} is missing.")
    fonts = FONT_PACKAGE / "files"
    absent = [name for name in font_files() if not (fonts / name).is_file()]
    if absent:
        raise SystemExit(f"The fonts are not installed ({absent[0]} and {len(absent) - 1} more). Run npm ci in web/ first.")
    out.mkdir(parents=True, exist_ok=True)
    for name in PAGES:
        shutil.copy2(SITE / name, out / name)
    target = out / "fonts"
    target.mkdir(exist_ok=True)
    for name in font_files():
        shutil.copy2(fonts / name, target / name)
    # The font's licence (SIL Open Font License) goes with its files.
    shutil.copy2(FONT_PACKAGE / "LICENSE", target / "LICENSE.txt")
    if demo is not None:
        if not (demo / "index.html").is_file():
            raise SystemExit(f"{demo} holds no built demo (index.html). Build it first: see CONTRIBUTING.md.")
        shutil.copytree(demo, out / "demo", dirs_exist_ok=True)
    else:
        missing.append("demo/")
    if shots is not None:
        (out / "shots").mkdir(exist_ok=True)
        for name in SHOTS:
            if (shots / name).is_file():
                shutil.copy2(shots / name, out / "shots" / name)
            else:
                missing.append(f"shots/{name}")
    else:
        missing.extend(f"shots/{name}" for name in SHOTS)
    (out / ".nojekyll").write_text("", encoding="utf-8")
    return missing


def main() -> int:
    parser = argparse.ArgumentParser(description="Assemble Guild Board's site.")
    parser.add_argument("--out", type=Path, required=True, help="a new or empty folder outside the repository")
    parser.add_argument("--demo", type=Path, help="the browser demo's build (web/dist-site)")
    parser.add_argument("--shots", type=Path, help="a folder with board.png, achievements.png, pulls.png, stats.png, year.png, overlay.png")
    parser.add_argument("--require-all", action="store_true", help="fail when the demo or a picture is missing")
    args = parser.parse_args()
    out = args.out.resolve()
    if out == ROOT or out in ROOT.parents or out == SITE or SITE in out.parents:
        print("--out must be a new folder, not the repository itself and not site/. A folder called _site is ignored by git.", file=sys.stderr)
        return 2
    if out.exists() and any(out.iterdir()):
        print(f"{out} is not empty. Choose a folder that is new or empty.", file=sys.stderr)
        return 2
    missing = assemble(out, args.demo.resolve() if args.demo else None, args.shots.resolve() if args.shots else None)
    if missing:
        print("Not in the site: " + ", ".join(missing) + ".", file=sys.stderr)
        if args.require_all:
            return 1
    print(f"The site is in {out}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
