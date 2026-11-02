"""Build drafts for the Characters cards: two independent sources read for every character (build time only).

Task R3, Step 1 of the Characters plan. The two sources, both read as public web pages, never as Guild Board:

* KQM's Quick Guides, https://keqingmains.com/q/<slug>-quickguide/ (the list of guides comes from
  https://keqingmains.com/wp-sitemap-posts-quick-guides-1.xml). Every guide has the same parts: Level and Talent
  Priority, ER Requirements, Artifact Stats (sands, goblet, circlet), Stat Priority, Artifact Sets, Weapons. A guide
  may repeat the Artifacts and Weapons parts for each playstyle (each becomes a build in the draft), and the oldest
  guides word some parts freely (the parser keeps what it can read and `unmapped` names the rest).
* Game8's "<name> Best Builds and Teams", https://game8.co/games/Genshin-Impact/archives/<id> (the list of pages
  comes from the menu of https://game8.co/games/Genshin-Impact/archives/296707, "All Characters"). Every page has a
  build summary with Best Weapon and the alternatives, Best Artifact and the alternate one, sands, goblet, circlet
  and sub stats (one summary per build), plus Talent Priority; about half the pages, the newest ones, also have
  Stat Goal Values.

Run:
    python tools/research/builds.py fetch    # reads each page once into out/builds_raw/ (about 1.2 s apart)
    python tools/research/builds.py          # parses the cached pages and writes out/drafts/

Pages are cached, so a re-run asks only for what is missing; delete out/builds_raw to read everything again. The
scripts go one page at a time and slowly, to respect both sites. Nothing here invents a value: a field a source
doesn't give stays empty, and a name that does not map to `inventory.json` is kept as the source wrote it and listed
under `unmapped`.
"""
from __future__ import annotations

import difflib
import html as htmllib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
RAW = OUT / "builds_raw"
DRAFTS = OUT / "drafts"
INVENTORY = HERE.parent.parent / "src" / "guildboard" / "reference" / "characters" / "inventory.json"
CHECKED = "2026-10-29"
DELAY = 1.2  # seconds between two requests to the same site

KQM_SITEMAP = "https://keqingmains.com/wp-sitemap-posts-quick-guides-1.xml"
KQM_PAGE = "https://keqingmains.com/q/{slug}-quickguide/"
G8_LIST = "https://game8.co/games/Genshin-Impact/archives/296707"
G8_PAGE = "https://game8.co/games/Genshin-Impact/archives/{id}"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

# Inventory key -> KQM's guide slug, where they differ (KQM drops the family name and puts the element last).
KQM_ALIAS = {
    "raiden-shogun": "raiden", "yae-miko": "yae", "yun-jin": "yunjin", "kamisato-ayaka": "ayaka",
    "kamisato-ayato": "ayato", "kaedehara-kazuha": "kazuha", "kuki-shinobu": "shinobu", "kujou-sara": "sara",
    "arataki-itto": "itto", "shikanoin-heizou": "heizou", "sangonomiya-kokomi": "kokomi",
    "yumemizuki-mizuki": "mizuki",
    "traveler-anemo": "anemo-traveler", "traveler-geo": "geo-traveler", "traveler-electro": "electro-traveler",
    "traveler-dendro": "dendro-traveler", "traveler-hydro": "hydro-traveler", "traveler-pyro": "pyro-traveler",
    "traveler-cryo": "cryo-traveler",
}
# Inventory key -> the name Game8's menu uses, where it differs.
G8_ALIAS = {
    "raiden-shogun": "Raiden Shogun", "yae-miko": "Yae Miko", "yun-jin": "Yun Jin", "kamisato-ayaka": "Ayaka",
    "kamisato-ayato": "Ayato", "kaedehara-kazuha": "Kazuha", "kuki-shinobu": "Shinobu", "kujou-sara": "Sara",
    "arataki-itto": "Itto", "shikanoin-heizou": "Heizou", "sangonomiya-kokomi": "Kokomi",
    "yumemizuki-mizuki": "Mizuki", "tartaglia": "Tartaglia",
    "traveler-anemo": "Traveler (Anemo)", "traveler-geo": "Traveler (Geo)", "traveler-electro": "Traveler (Electro)",
    "traveler-dendro": "Traveler (Dendro)", "traveler-hydro": "Traveler (Hydro)", "traveler-pyro": "Traveler (Pyro)",
    "traveler-cryo": "Cryo Traveler",
}

_last_request: dict[str, float] = {}


def slug(text: str) -> str:
    """`guildboard.metrics.slug`, copied: lower case, letters and digits kept, everything else a dash."""
    mapped = "".join(ch if ch.isalnum() else "-" for ch in text.strip().lower())
    return "-".join(part for part in mapped.split("-") if part) or "x"


def http_get(url: str) -> tuple[int, str]:
    """GET one page, slowly. Returns (status, text); (404, "") for a missing page. Retries a few times on errors."""
    host = url.split("/")[2]
    last: Exception | None = None
    for attempt in range(4):
        wait = DELAY - (time.time() - _last_request.get(host, 0.0))
        if wait > 0:
            time.sleep(wait)
        _last_request[host] = time.time()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                return error.code, ""
            last = error
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = error
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def cached(path: Path, url: str) -> str | None:
    """A page from the cache, or read once; None when the site has no such page (kept as an empty `.404` marker)."""
    if path.exists():
        return path.read_text(encoding="utf-8")
    missing = path.with_suffix(path.suffix + ".404")
    if missing.exists():
        return None
    status, text = http_get(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    if status != 200:
        missing.write_text(str(status), encoding="utf-8")
        return None
    path.write_text(text, encoding="utf-8")
    return text


def load_inventory() -> dict[str, Any]:
    return json.loads(INVENTORY.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- the lists of pages


def kqm_slugs() -> set[str]:
    text = cached(RAW / "kqm" / "_sitemap.xml", KQM_SITEMAP) or ""
    found = set()
    for url in re.findall(r"<loc>(.*?)</loc>", text):
        match = re.search(r"/q/([a-z0-9-]+)-quickguide/$", url)
        if match:
            found.add(match.group(1))
    return found


def g8_menu() -> dict[str, str]:
    """Game8's menu: name -> archive id, from the 'All Characters' block of the list page."""
    text = cached(RAW / "game8" / "_list.html", G8_LIST) or ""
    pairs = re.findall(
        r'data-track-nier-keyword="game_menu_link" data-track-nier-value="([^"]*)" href="/games/Genshin-Impact/archives/(\d+)"',
        text)
    names: dict[str, str] = {}
    for name, archive in pairs:
        names.setdefault(htmllib.unescape(name), archive)
    return names


def kqm_target(key: str, slugs: set[str]) -> str | None:
    candidate = KQM_ALIAS.get(key, key)
    return candidate if candidate in slugs else None


def g8_target(character: dict[str, Any], menu: dict[str, str]) -> str | None:
    key, name = character["key"], character["name"]
    for candidate in (G8_ALIAS.get(key), name):
        if candidate and candidate in menu:
            return menu[candidate]
    return None


def fetch_all() -> None:
    inventory = load_inventory()
    slugs = kqm_slugs()
    menu = g8_menu()
    print(f"KQM guides listed: {len(slugs)}; Game8 menu names: {len(menu)}", flush=True)
    for character in inventory["characters"]:
        key = character["key"]
        target = kqm_target(key, slugs)
        if target:
            cached(RAW / "kqm" / f"{key}.html", KQM_PAGE.format(slug=target))
        archive = g8_target(character, menu)
        if archive:
            cached(RAW / "game8" / f"{key}.html", G8_PAGE.format(id=archive))
        print("fetched", key, "kqm" if target else "-", "g8" if archive else "-", flush=True)


# ---------------------------------------------------------------- names -> inventory keys

PIECES = r"[2-4]\s*-?\s*(?:pc|piece)s?\.?"
STAT_ORDER = ("hp", "atk", "def", "hp_pct", "atk_pct", "def_pct", "em", "er", "cr", "cd", "dmg", "heal", "phys")


def norm_name(text: str) -> str:
    text = htmllib.unescape(text).replace("’", "'").replace("‘", "'").replace("`", "'")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"^[\W_]*the\s+", "", text, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", text.lower())


class Names:
    """Maps the names a source writes to the inventory's keys: exact, abbreviation, first word, or a close spelling."""

    def __init__(self, items: list[dict[str, Any]], abbreviations: bool):
        self.by_norm = {norm_name(i["name"]): i["key"] for i in items}
        self.display = {i["key"]: i["name"] for i in items}
        self.initials: dict[str, list[str]] = {}
        self.first_word: dict[str, list[str]] = {}
        if abbreviations:
            for item in items:
                words = re.findall(r"[A-Za-z']+", item["name"].replace("'", "'"))
                small = {"of", "the", "and", "in", "to", "for", "a"}
                for variant in ("".join(w[0] for w in words).lower(), "".join(w[0] for w in words if w.lower() not in small).lower()):
                    if item["key"] not in self.initials.setdefault(variant, []):
                        self.initials[variant].append(item["key"])
                self.first_word.setdefault(words[0].lower(), []).append(item["key"])

    def find(self, raw: str) -> tuple[str | None, str | None]:
        """(key, how) or (None, None)."""
        text = raw.replace("\xad", "").strip()
        text = re.sub(r"^\s*" + PIECES + r"\s*", "", text, flags=re.I)
        text = re.sub(r"^\s*[1-5]\s*★\s*(?:R[1-5]\s+)?", "", text)
        text = re.sub(r"\s+Set$", "", text, flags=re.I)
        n = norm_name(text)
        if not n:
            return None, None
        if n in self.by_norm:
            return self.by_norm[n], "exact"
        # an abbreviation written in brackets beside the full name: "Golden Troupe (GT)" is already exact above
        token = re.sub(r"[^A-Za-z]", "", re.sub(r"\([^)]*\)", "", text))
        low = token.lower()
        if len(low) >= 2 and len(self.initials.get(low, [])) == 1 and " " not in text.strip():
            return self.initials[low][0], "abbreviation"
        if len(low) >= 5 and " " not in text.strip() and len(self.first_word.get(low, [])) == 1:
            return self.first_word[low][0], "first word"
        if len(n) >= 4:
            starts = [key for norm, key in self.by_norm.items() if norm.startswith(n)]
            if len(starts) == 1:
                return starts[0], f"start of {self.display[starts[0]]}"
        if len(n) >= 8:
            inside = [key for norm, key in self.by_norm.items() if n in norm]
            if len(inside) == 1:
                return inside[0], f"part of {self.display[inside[0]]}"
        close = difflib.get_close_matches(n, list(self.by_norm), n=2, cutoff=0.88)
        if len(close) == 1:
            return self.by_norm[close[0]], f"close spelling of {self.display[self.by_norm[close[0]]]}"
        return None, None


# ---------------------------------------------------------------- stats

_ELEMENTS = r"(?:pyro|hydro|anemo|electro|dendro|cryo|geo|elemental)"


def stat_tokens(text: str, *, slot: bool) -> tuple[list[str], list[str]]:
    """The stats a phrase names, best first, as (`STATS` keys plus `phys`, leftover words we couldn't read).

    `slot` is True for a main stat of sands, goblet or circlet, where a bare "ATK", "HP" or "DEF" is the percentage.
    """
    text = htmllib.unescape(text).replace("’", "'")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = text.replace("*", " ")
    found: list[str] = []
    left: list[str] = []
    for part in re.split(r"\s*(?:,|/|>=|≥|>|=|≈|\+|&|;|\bor\b|\band\b|\bthen\b)\s*", text, flags=re.I):
        low = part.strip().lower().rstrip(".")
        if not low:
            continue
        keys: list[str] = []
        if re.search(r"\bcrit\b.*\brate\b|^cr(it)?\s*rate|^crit\s*rate|^cr%?$", low):
            keys = ["cr"]
        elif re.search(r"crit.*(dmg|damage)|^cd%?$|^crit\s*dmg", low):
            keys = ["cd"]
        elif re.fullmatch(r"crit(ical)?( stats?| ratio)?", low):
            keys = ["cr", "cd"]
        elif re.search(r"energy rec", low) or re.fullmatch(r"er%?|er", low) or low.startswith("er "):
            keys = ["er"]
        elif "elemental mastery" in low or re.fullmatch(r"em%?|em", low) or low.startswith("em "):
            keys = ["em"]
        elif "healing" in low:
            keys = ["heal"]
        elif "physical" in low:
            keys = ["phys"]
        elif re.fullmatch(_ELEMENTS + r"\s*%?", low) or re.search(_ELEMENTS + r"\s*(dmg|damage)", low) or re.fullmatch(r"(dmg|damage)\s*(bonus|%)?|dmg%|elemental dmg( bonus)?", low):
            keys = ["dmg"]
        elif re.fullmatch(r"hp\s*%|hp percent|hp% ?.*|max hp\s*%", low):
            keys = ["hp_pct"]
        elif re.fullmatch(r"atk\s*%|atk percent|atk% ?.*", low):
            keys = ["atk_pct"]
        elif re.fullmatch(r"def\s*%|def percent|def% ?.*", low):
            keys = ["def_pct"]
        elif re.fullmatch(r"(flat )?(max )?hp|hp", low):
            keys = ["hp_pct" if slot else "hp"]
        elif re.fullmatch(r"(flat )?atk|atk", low):
            keys = ["atk_pct" if slot else "atk"]
        elif re.fullmatch(r"(flat )?def|def", low):
            keys = ["def_pct" if slot else "def"]
        elif re.fullmatch(r"flat atk|atk flat|flat attack", low):
            keys = ["atk"]
        if keys:
            for key in keys:
                if key not in found:
                    found.append(key)
        else:
            left.append(part.strip())
    if not found and left:
        scanned = re.findall(r"ER%?|ATK%|HP%|DEF%|\bEM\b|CRIT Rate|CRIT DMG|Healing Bonus|\w+ DMG(?: Bonus)?%?", text)
        for part in scanned:
            keys, _ = stat_tokens(part, slot=slot)
            for key in keys:
                if key not in found:
                    found.append(key)
        if found:
            left = []
    return found, left


def numbers_of(text: str) -> list[float]:
    return [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)]


def plain_text(fragment: str) -> str:
    text = re.sub(r"<br\s*/?>|</p>|</li>|</div>", "\n", fragment)
    text = re.sub(r"<[^>]+>", "", text)
    text = htmllib.unescape(text).replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


TALENTS = (("normal", r"normal|basic|auto|\bna\b|\baa\b"),("skill", r"skill|\be\b"), ("burst", r"burst|\bq\b"))


def talent_order(text: str) -> list[str]:
    """Talent names in the order a priority phrase lists them, best first: "Burst ≥ Skill = Lvl. 90" -> burst, skill."""
    found: list[tuple[int, str]] = []
    low = re.sub(r"(character level|level|lvl\.?|lv\.?)\s*\d*", " ", text.lower())
    for key, pattern in TALENTS:
        match = re.search(pattern, low)
        if match:
            found.append((match.start(), key))
    return [key for _, key in sorted(found)]


# ---------------------------------------------------------------- KQM


def table_cells(fragment: str) -> list[list[str]]:
    """Rows of cell html, for the tables in a fragment."""
    rows = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", fragment, flags=re.S):
        rows.append(re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S))
    return rows


GENERIC_SET = re.compile(r"^(?:\d\s*)?(?:pc\s*)?(?:mixed|combinations?|combos?|set combos|various|support sets?|\d|placeholder|other|any|em|er|atk|hp|def|crit|pyro|hydro|anemo|electro|dendro|cryo|geo|"
                         r"physical|elemental|healing|skill|burst|normal)\b", re.I)


def parse_set_label(label: str, names: Names, unmapped: list[str], how: dict[str, str], strict: bool = True) -> list[dict[str, Any]]:
    """A KQM set row's label -> options. "4pc A / 4pc B" are two options, "2pc A + 2pc B" is one 2+2 option."""
    options: list[dict[str, Any]] = []
    for line in [re.sub(r"\([^)]*\)?", "", ln).strip() for ln in label.split("\n") if ln.strip()]:
        for alternative in re.split(r"\s*/\s*|\s+or\s+|,\s*(?=" + PIECES + ")", line):
            segments = [s for s in re.split(r"\s*\+\s*|\s*&\s*|\s+and\s+(?=" + PIECES + ")", alternative) if re.sub(r"\([^)]*\)", "", s).strip()]
            if not segments:
                continue
            keys: list[str] = []
            shown: list[str] = []
            generic = False
            for segment in segments:
                key, found_how = names.find(segment)
                if key is None:
                    stripped = re.sub(r"^\s*" + PIECES + r"\s*", "", segment, flags=re.I).strip()
                    if not re.search(r"[A-Za-z]{2}", stripped):
                        continue
                    if GENERIC_SET.match(stripped):
                        generic = True
                    else:
                        if strict:
                            unmapped.append(stripped)
                    shown.append(stripped)
                    continue
                if found_how != "exact":
                    how[segment.strip()] = f"{found_how}: {names.display[key]}"
                keys.append(key)
                shown.append(names.display[key])
            counts = re.findall(r"([24])\s*-?\s*(?:pc|piece)", alternative, flags=re.I)
            pieces = None
            if len(segments) == 2 and counts == ["2", "2"]:
                pieces = "2+2"
            elif counts[:1] == ["4"]:
                pieces = "4"
            elif counts[:1] == ["2"] and len(segments) == 1:
                pieces = "2"
            if keys:
                options.append({"sets": keys, "names": shown, "pieces": pieces, "label": alternative.strip(), "generic_part": generic})
    return options


GENERIC_WEAPON = re.compile(r"\b(swords?|claymores?|polearms?|bows?|catalysts?|weapons?|options?|stat sticks?|sidegrades|downgrades|"
                            r"electro|hydro|pyro|cryo|anemo|geo|dendro|f2p)\b|%|rot\)|^\W*$|^(?:any|other)\b|^\d[-\s]?(?:star|\*)", re.I)


def parse_weapon_cell(cell: str, names: Names, unmapped: list[str], how: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for line in [ln for ln in plain_text(cell).replace("\xad", "").split("\n") if ln.strip()]:
        stars = re.match(r"\s*([1-5])\s*★", line)
        for part in re.split(r",\s*|\s*/\s*|\s+or\s+", line):
            name = re.sub(r"^\s*[1-5]\s*★\s*", "", part).strip()
            refine = re.match(r"R([1-5])\+?\s+(.*)", name)
            if refine:
                name = refine.group(2)
            if not name or re.fullmatch(r"\([^)]*\)", name):
                continue
            key, found_how = names.find(name)
            if key is None and GENERIC_WEAPON.search(name):
                continue
            if key is None:
                unmapped.append(name)
            elif found_how != "exact":
                how[name] = f"{found_how}: {names.display[key]}"
            item = {"name": re.sub(r"\s*\([^)]*\)", "", name).strip(), "key": key}
            if stars:
                item["stars"] = int(stars.group(1))
            if refine:
                item["refinement"] = int(refine.group(1))
            out.append(item)
    return out


STRUCTURAL = {"artifacts", "weapons", "teams", "er requirements", "talents", "constellations", "combos", "playstyles",
              "teambuilding", "example teams", "infographic", "character overview", "new content", "credits", "mechanics",
              "notable teammates", "pros", "cons"}


def kqm_kind(low: str) -> str | None:
    """What a KQM heading starts: artifacts, er, stats, sets, weapons, teams. Headings may carry a playstyle first: "Support Weapons"."""
    low = low.strip()
    if re.search(r"(?:^|\s)er requirements?$|energy recharge requirements?$", low):
        return "er"
    if re.search(r"artifacts? stats?$", low):
        return "stats"
    if re.search(r"artifact sets?(?:\s*[—-].*)?$", low):
        return "sets"
    if re.search(r"(?:^|\s)artifacts$", low):
        return "artifacts"
    if re.search(r"(?:^|\s)weapons$", low):
        return "weapons"
    if low == "teams" or re.search(r"\steams$", low):
        return "teams"
    return None


def er_table(rows: list[list[str]]) -> dict[str, Any]:
    out = []
    nums: list[float] = []
    for number, row in enumerate(rows):
        cells = [plain_text(c).replace("\n", " ") for c in row]
        if len(cells) < 2:
            continue
        if number == 0 and not any(re.search(r"\d", c) for c in cells[1:]):
            continue  # a header row
        out.append({"situation": cells[0], "er": " | ".join(cells[1:])})
        nums.extend(n for c in cells[1:] for n in numbers_of(c.replace("%", " ")) if 50 <= n <= 400)
    return {"rows": out, "min": min(nums) if nums else None, "max": max(nums) if nums else None}


def parse_kqm(page: str, weapons: Names, sets: Names) -> dict[str, Any]:
    unmapped: dict[str, list[str]] = {"weapons": [], "sets": []}
    how: dict[str, str] = {}
    regions: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    seen_after = False
    region_label: str | None = None
    sub: str | None = None
    where = ""  # artifacts / er / stats / sets / weapons / teams / other
    where_level = 0
    priority: dict[str, Any] | None = None
    last_stats_table: list[dict[str, Any]] = []

    def new_region() -> dict[str, Any]:
        nonlocal seen_after
        seen_after = False
        last_stats_table.clear()
        region = {"label": region_label, "er": None, "er_text": None, "stats": [], "sets": [], "other_sets": [], "weapons": []}
        regions.append(region)
        return region

    token = re.compile(r"<h([1-6])[^>]*>(.*?)</h\1>|<table.*?</table>|<p[^>]*>.*?</p>", re.S)
    tp_level: int | None = None  # the level of the "Talent Priority" heading while we are inside it
    tp_sub: str | None = None
    variants: list[dict[str, Any]] = []
    for m in token.finditer(page):
        if m.group(1):
            level, text = int(m.group(1)), plain_text(m.group(2)).strip()
            low = text.lower()
            if "talent priority" in low and not variants:
                tp_level, tp_sub = level, None
            elif tp_level is not None:
                if level <= tp_level:
                    tp_level = None
                else:
                    tp_sub = text
            kind = kqm_kind(low)
            if kind == "artifacts":
                if cur is None or seen_after or cur["stats"] or cur["sets"] or cur["weapons"]:
                    cur = new_region()
            elif kind == "er":
                if cur is None or seen_after or cur["er"] is not None:
                    cur = new_region()
            elif kind in ("stats", "sets"):
                if cur is None or seen_after:
                    cur = new_region()
            elif kind == "weapons":
                if cur is None:
                    cur = new_region()
                seen_after = True
            elif kind == "teams":
                seen_after = True
            if kind:
                where, where_level, sub = kind, level, None
                if kind == "sets" and "—" in text:
                    sub = text.split("—", 1)[1].strip()
            elif where in ("artifacts", "er", "stats", "sets", "weapons") and level > where_level:
                sub = text
            else:
                where, sub = "other", None
                if level == 1 and low not in STRUCTURAL:
                    region_label = text
            continue
        chunk = m.group(0)
        if chunk.startswith("<table"):
            rows = table_cells(chunk)
            if tp_level is not None:
                grid = [[plain_text(c) for c in r] for r in rows]
                if len(grid) >= 2 and len(grid[0]) == len(grid[1]):
                    for head, value in zip(grid[0], grid[1]):
                        variants.append({"label": head.replace("\n", " ") or tp_sub, "order": talent_order(value), "raw": value})
                continue
            if cur is None or where in ("teams", "other", ""):
                continue
            flat = [plain_text(c).strip().rstrip("*").lower() for r in rows for c in r]
            if {"sands", "goblet", "circlet"} <= set(flat):
                grid = [[plain_text(c) for c in r] for r in rows]
                head_row = next(n for n, r in enumerate(grid) if {"sands", "goblet", "circlet"} <= {c.strip().rstrip("*").lower() for c in r})
                cols = {c.strip().rstrip("*").lower(): n for n, c in enumerate(grid[head_row])}
                last_table = []
                for row in grid[head_row + 1:]:
                    if len(row) <= max(cols["sands"], cols["goblet"], cols["circlet"]):
                        continue
                    mains = {}
                    for slot in ("sands", "goblet", "circlet"):
                        value = row[cols[slot]]
                        stats, left = stat_tokens(value, slot=True)
                        mains[slot] = {"stats": stats, "raw": value.replace("\n", " "), "unread": left}
                    row_label = row[min(cols.values()) - 1].replace("\n", " ") if min(cols.values()) > 0 else None
                    last_stats = {"label": row_label or sub, "mains": mains, "substats": None, "substats_variants": []}
                    cur["stats"].append(last_stats)
                    last_table.append(last_stats)
                last_stats_table = last_table
            elif where == "sets" or 'data-gi-type="artifact"' in chunk:
                for row in rows:
                    if len(row) < 2:
                        continue
                    label = plain_text(row[0])
                    note = plain_text(row[1])[:240]
                    options = parse_set_label(label, sets, unmapped["sets"], how, strict=bool(re.search(PIECES, label, flags=re.I)))
                    if not options:
                        cur["other_sets"].append(f"{label}: {note}"[:300])
                        continue
                    for option in options:
                        option["note"] = note
                        option["context"] = sub
                        cur["sets"].append(option)
            elif where == "weapons" or 'data-gi-type="weapon"' in chunk:
                for row in rows:
                    if len(row) < 2 or not plain_text(row[0]):
                        continue
                    for item in parse_weapon_cell(row[0], weapons, unmapped["weapons"], how):
                        item["note"] = plain_text(row[1])[:240]
                        item["context"] = sub
                        cur["weapons"].append(item)
            elif where == "er" and cur["er"] is None:
                cur["er"] = er_table(rows)
            continue
        text = plain_text(chunk)
        if tp_level is not None and re.search(r"[>≥=]", text) and len(text) < 120:
            raw = re.sub(r"^\s*(?:Level and )?Talent Priority\s*:?\s*", "", text).strip()
            variants.append({"label": tp_sub, "order": talent_order(raw), "raw": raw})
            continue
        labelled = re.match(r"\s*(?:Stat Priority|Substats?)[^:]*:\s*(.+)", text, flags=re.S)
        if last_stats_table and where in ("artifacts", "stats", "sets") and (labelled or ("substats" in chunk and len(text) < 200)):
            body = labelled.group(1) if labelled else text
            stats, left = stat_tokens(body, slot=False)
            entry = {"label": sub, "stats": stats, "raw": body.strip().replace("\n", " "), "unread": left}
            for target in last_stats_table:
                if target["substats"] is None:
                    target["substats"] = entry
                elif not any(v["raw"] == entry["raw"] for v in target["substats_variants"]):
                    target["substats_variants"].append(entry)
            continue
        if where == "er" and cur is not None and cur["er_text"] is None and len(text) > 20:
            cur["er_text"] = text[:300]
    for region in regions:
        if region["er"] is None and region["er_text"]:
            region["er"] = {"rows": [], "text": region["er_text"], "min": None, "max": None}
    kept = [r for r in regions if r["stats"] or r["sets"] or r["weapons"]]
    priority = None
    if variants:
        priority = {"order": variants[0]["order"], "raw": variants[0]["raw"], "variants": variants}
    return {"regions": kept, "talent_priority": priority, "unmapped": unmapped, "how": how}


# ---------------------------------------------------------------- Game8


def g8_lines(page: str) -> list[str]:
    """Game8's page as lines: a heading is "§<level> text", a link is ⟦its text⟧, a table cell ends with ¦. Tooltips are dropped."""
    text = re.sub(r"<script.*?</script>|<style.*?</style>|<template.*?</template>", "", page, flags=re.S)
    text = re.sub(r"<img[^>]*>", "", text)
    text = re.sub(r"<a [^>]*>(.*?)</a>", lambda m: "⟦" + re.sub(r"<[^>]+>", "", m.group(1)).strip() + "⟧", text, flags=re.S)
    text = re.sub(r"<h([1-6])[^>]*>", lambda m: "\n§" + m.group(1) + " ", text)
    text = re.sub(r"</t[dh]>", " ¦ ", text)
    text = re.sub(r"<(br|/p|/tr|/li|/h\d|/div|/table|/ul)[^>]*>", "\n", text)
    text = htmllib.unescape(re.sub(r"<[^>]+>", "", text)).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def g_head(line: str) -> tuple[int, str] | None:
    match = re.match(r"§(\d) (.*)", line)
    return (int(match.group(1)), match.group(2).strip()) if match else None


def g_plain(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("⟦", "").replace("⟧", "").replace("¦", " ")).strip()


def g_cells(chunk: list[str]) -> list[str]:
    """The cells of the tables in some lines: text between ¦ marks (the prose after the last mark is dropped)."""
    cells = [re.sub(r"\s+", " ", c.replace("⟦", "").replace("⟧", "")).strip() for c in " ".join(chunk).split("¦")]
    return cells[:-1] if cells else cells


def g_blocks(lines: list[str], pattern: str, stop: str) -> list[tuple[str | None, list[str]]] | None:
    """The lines under the first heading matching `pattern`, split at deeper headings: [(sub heading or None, lines)]."""
    begin = None
    for n, line in enumerate(lines):
        head = g_head(line)
        if head and re.search(pattern, head[1], flags=re.I):
            begin = (n, head[0])
            break
    if begin is None:
        return None
    blocks: list[tuple[str | None, list[str]]] = [(None, [])]
    for line in lines[begin[0] + 1:]:
        head = g_head(line)
        if head:
            if head[0] <= begin[1] or re.search(stop, head[1], flags=re.I):
                break
            blocks.append((head[1], []))
        else:
            blocks[-1][1].append(line)
    return [b for b in blocks if b[1]]


GOAL_KEYS = {"hp": "hp", "atk": "atk", "def": "def", "hp%": "hp_pct", "atk%": "atk_pct", "def%": "def_pct"}


def goal_key(label: str) -> str | None:
    low = label.strip().lower().replace("goal", "").strip()
    if low in GOAL_KEYS:
        return GOAL_KEYS[low]
    keys, _ = stat_tokens(label, slot=False)
    return keys[0] if len(keys) == 1 else None


G8_STOP = r"goal|talent priority|best weapons|best artifacts|team comps|constellation|how to play|best team|rankings?$"


def parse_goal_block(lines: list[str]) -> dict[str, Any] | None:
    cells = g_cells(lines)
    start = next((n for n, c in enumerate(cells) if c.lower().startswith("stat")), None)
    if start is None:
        return None
    rest = cells[start + 1:]
    if rest and "goal" in rest[0].lower():
        rest = rest[1:]
    by_stat: dict[str, Any] = {}
    rows: list[dict[str, str]] = []
    for n in range(0, len(rest) - 1, 2):
        label, value = rest[n], rest[n + 1]
        if len(label) > 40 or len(value) > 140:
            break
        rows.append({"stat": label, "value": value})
        key = goal_key(label)
        if key and key not in by_stat:
            by_stat[key] = {"raw": value, "numbers": numbers_of(value.replace("~", " ").replace(" - ", " "))}
    return {"by_stat": by_stat, "rows": rows} if rows else None


def parse_game8(page: str, weapons: Names, sets: Names) -> dict[str, Any]:
    lines = g8_lines(page)
    unmapped: dict[str, list[str]] = {"weapons": [], "sets": []}
    how: dict[str, str] = {}

    # talent priority: one variant per playstyle sub heading
    priority = None
    blocks = g_blocks(lines, r"talent priority", r"best weapons|best artifacts|team comps|constellation|goal|best builds|how to")
    if blocks:
        variants = []
        for label, chunk in blocks:
            names = [c for c in g_cells(chunk) if len(c) < 70 and re.search(r"normal attack|elemental skill|elemental burst", c, flags=re.I)]
            if names:
                order: list[str] = []
                for name in names:
                    for key in talent_order(name):
                        if key not in order:
                            order.append(key)
                variants.append({"label": label, "order": order, "raw": " > ".join(names)})
        if variants:
            priority = {"order": variants[0]["order"], "raw": variants[0]["raw"], "variants": variants}

    # goals: one variant per sub heading
    goals = None
    blocks = g_blocks(lines, r"goal", r"talent priority|best weapons|best artifacts|team comps|constellation|how to|best builds")
    if blocks:
        variants = []
        for label, chunk in blocks:
            parsed = parse_goal_block(chunk)
            if parsed:
                variants.append({"label": label, **parsed})
        if variants:
            goals = {"by_stat": variants[0]["by_stat"], "rows": variants[0]["rows"], "variants": variants}

    # builds
    builds: list[dict[str, Any]] = []
    start = None
    for n, line in enumerate(lines):
        head = g_head(line)
        if head and head[0] >= 2 and re.search(r"\bbuilds?\b(?! and teams)", head[1], flags=re.I) and "free" not in head[1].lower():
            start = n
            break
    if start is not None:
        stop_at = len(lines)
        for n in range(start + 1, len(lines)):
            head = g_head(lines[n])
            if head and re.search(G8_STOP, head[1], flags=re.I):
                stop_at = n
                break
        label = None
        cur: dict[str, Any] | None = None
        mode = ""
        for line in lines[start + 1:stop_at]:
            head = g_head(line)
            if head:
                label = head[1]
                continue
            plain = g_plain(line)
            if re.match(r"best weapons?\b", plain, flags=re.I):
                cur = {"label": label, "weapons": [], "sets": [], "mains": {}, "substats": None, "er_recommended": None}
                builds.append(cur)
                mode = "weapons"
            elif cur is None:
                continue
            elif re.match(r"best (?:[\w-]+ )?artifacts?\b", plain, flags=re.I):
                mode = "sets"
            elif re.match(r"alternate (?:[\w-]+ )?artifacts?\b", plain, flags=re.I):
                mode = "alt_sets"
            if re.match(r"(general|sample teams|best team|team comps)", plain, flags=re.I):
                mode = ""
                continue
            slot_match = re.match(r"(sands|goblet|circlet)\s*:\s*(.*)", plain, flags=re.I)
            if slot_match:
                stats, left = stat_tokens(slot_match.group(2), slot=True)
                cur["mains"][slot_match.group(1).lower()] = {"stats": stats, "raw": slot_match.group(2).strip(), "unread": left}
                mode = "mains"
                continue
            if re.match(r"(?:artifact )?sub ?stats\b", plain, flags=re.I):
                mode = "subs"
                cur["_subs"] = [re.sub(r"^(?:artifact )?sub ?stats\s*", "", plain, flags=re.I)]
                if line.rstrip().endswith("¦") and cur["_subs"][0]:
                    mode = ""
                continue
            if mode == "subs":
                cur["_subs"].append(plain)
                if line.rstrip().endswith("¦"):
                    mode = ""
                continue
            if re.match(r"recommended energy recharge\b", plain, flags=re.I):
                inline = re.sub(r"^recommended energy recharge\s*", "", plain, flags=re.I)
                cur["er_recommended"] = inline or None
                mode = "er" if not inline else mode
                continue
            if mode == "er":
                cur["er_recommended"] = plain
                mode = ""
                continue
            if mode in ("weapons", "sets", "alt_sets") and "⟦" in line:
                for link in re.findall(r"⟦([^⟧]*)⟧", line):
                    link = link.strip()
                    if not link or re.fullmatch(r"(?:best |alternat\w* )?(?:weapons?|artifacts?|team comps?)", link, flags=re.I):
                        continue
                    tail = line.split("⟧", 1)[1] if "⟧" in line else ""
                    if mode == "weapons":
                        key, found_how = weapons.find(link)
                        if key is None:
                            unmapped["weapons"].append(link)
                        elif found_how != "exact":
                            how[link] = f"{found_how}: {weapons.display[key]}"
                        cur["weapons"].append({"name": link, "key": key, "rank": "best" if not cur["weapons"] else "alternative"})
                    else:
                        key, found_how = sets.find(link)
                        if key is None:
                            unmapped["sets"].append(link)
                        elif found_how != "exact":
                            how[link] = f"{found_how}: {sets.display[key]}"
                        count = re.match(r"\s*x\s*([24])", tail)
                        cur["sets"].append({"sets": [key] if key else [], "names": [sets.display[key] if key else link],
                                            "pieces": count.group(1) if count else None,
                                            "rank": "best" if mode == "sets" else "alternate"})
        for build in builds:
            parts = [p for p in build.pop("_subs", []) if p]
            if parts:
                numbered = [re.sub(r"^\d\.\s*", "", p) for p in parts]
                text = " > ".join(numbered) if any(re.match(r"\d\.", p) for p in parts) else " ".join(numbered)
                stats, left = stat_tokens(text, slot=False)
                build["substats"] = {"stats": stats, "raw": text, "unread": left}
    return {"builds": [b for b in builds if b["weapons"] or b["sets"] or b["mains"]], "talent_priority": priority, "goals": goals,
            "unmapped": unmapped, "how": how}


# ---------------------------------------------------------------- one draft per character


def kqm_view(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """KQM's regions as builds with the same field names as Game8's."""
    out = []
    for region in parsed["regions"]:
        mains_variants = []
        for stat in region["stats"]:
            mains_variants.append({"label": stat["label"], "mains": stat["mains"], "substats": stat["substats"],
                                   "substats_variants": stat.get("substats_variants", [])})
        out.append({"label": region["label"], "er": region["er"], "mains_variants": mains_variants,
                    "sets": region["sets"], "other_sets": region["other_sets"], "weapons": region["weapons"]})
    return out


def g8_view(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for build in parsed["builds"]:
        out.append({"label": build["label"], "er_recommended": build["er_recommended"],
                    "mains_variants": [{"label": None, "mains": build["mains"], "substats": build["substats"], "substats_variants": []}],
                    "sets": build["sets"], "weapons": build["weapons"]})
    return out


def summarize(builds: list[dict[str, Any]], er: dict[str, Any] | None) -> dict[str, Any]:
    """The flat view the two sources are compared on."""
    weapons: list[str] = []
    top_weapons: list[str] = []
    set_options: list[dict[str, Any]] = []
    top_sets: list[list[str]] = []
    mains: dict[str, list[str]] = {"sands": [], "goblet": [], "circlet": []}
    top_mains: dict[str, list[str]] = {"sands": [], "goblet": [], "circlet": []}
    substats: list[str] = []
    top_substats: list[list[str]] = []
    for build in builds:
        keys = [w["key"] for w in build["weapons"] if w.get("key")]
        for key in keys:
            if key not in weapons:
                weapons.append(key)
        if keys and keys[0] not in top_weapons:
            top_weapons.append(keys[0])
        options = [s for s in build["sets"] if s["sets"]]
        for option in options:
            if not any(o["sets"] == option["sets"] and o["pieces"] == option["pieces"] for o in set_options):
                set_options.append({"sets": option["sets"], "pieces": option["pieces"]})
        if options and sorted(options[0]["sets"]) not in top_sets:
            top_sets.append(sorted(options[0]["sets"]))
        for variant in build["mains_variants"]:
            for slot in mains:
                entry = variant["mains"].get(slot)
                if not entry:
                    continue
                for stat in entry["stats"]:
                    if stat not in mains[slot]:
                        mains[slot].append(stat)
                if entry["stats"] and entry["stats"][0] not in top_mains[slot]:
                    top_mains[slot].append(entry["stats"][0])
            sub = variant["substats"]
            if sub:
                for stat in sub["stats"]:
                    if stat not in substats:
                        substats.append(stat)
                if sub["stats"][:2] and sub["stats"][:2] not in top_substats:
                    top_substats.append(sub["stats"][:2])
    return {"weapons": weapons, "top_weapons": top_weapons, "sets": set_options, "top_sets": top_sets, "mains": mains,
            "top_mains": top_mains, "substats": substats, "top_substats": top_substats, "er": er}


def er_range(builds: list[dict[str, Any]], goals: dict[str, Any] | None, source: str) -> dict[str, Any] | None:
    """The ER a source asks for: KQM's requirement tables, Game8's ER goal or recommended ER. {min, max, raw}."""
    nums: list[float] = []
    raws: list[str] = []
    if source == "kqm":
        for build in builds:
            er = build.get("er")
            if er:
                nums.extend(n for n in (er.get("min"), er.get("max")) if n is not None)
                raws.extend(f"{r['situation']}: {r['er']}" for r in er.get("rows", []))
                if er.get("text") and not er.get("rows"):
                    raws.append(er["text"])
    else:
        if goals and "er" in goals["by_stat"]:
            nums.extend(goals["by_stat"]["er"]["numbers"])
            raws.append(goals["by_stat"]["er"]["raw"])
        for build in builds:
            if build.get("er_recommended"):
                nums.extend(numbers_of(build["er_recommended"]))
                raws.append(build["er_recommended"])
    nums = [n for n in nums if 50 <= n <= 400]
    if not raws and not nums:
        return None
    return {"min": min(nums) if nums else None, "max": max(nums) if nums else None, "raw": raws[:12]}


def compare(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Where the two sources' summaries differ. a is KQM, b is Game8."""
    diff: dict[str, Any] = {}
    # sets: agree when some top set is the same; also say whether each one's top set is listed by the other
    all_a = {tuple(sorted(o["sets"])) for o in a["sets"]}
    all_b = {tuple(sorted(o["sets"])) for o in b["sets"]}
    tops_a = {tuple(t) for t in a["top_sets"]}
    tops_b = {tuple(t) for t in b["top_sets"]}
    if tops_a and tops_b:
        diff["sets"] = {"differs": not (tops_a & tops_b), "kqm_top": [list(t) for t in sorted(tops_a)], "game8_top": [list(t) for t in sorted(tops_b)],
                        "kqm_top_listed_by_game8": bool(tops_a & all_b), "game8_top_listed_by_kqm": bool(tops_b & all_a)}
    # main stats per slot: the first choice of some build, and every stat named
    mains: dict[str, Any] = {}
    for slot in ("sands", "goblet", "circlet"):
        ta, tb = set(a["top_mains"][slot]), set(b["top_mains"][slot])
        if not ta or not tb:
            continue
        mains[slot] = {"differs": not (ta & tb), "kqm": a["mains"][slot], "game8": b["mains"][slot],
                       "same_options": set(a["mains"][slot]) == set(b["mains"][slot])}
    if mains:
        diff["mains"] = {"differs": any(m["differs"] for m in mains.values()), "slots": mains}
    # the first weapon
    ta, tb = set(a["top_weapons"]), set(b["top_weapons"])
    if ta and tb:
        diff["weapons"] = {"differs": not (ta & tb), "kqm_top": a["top_weapons"], "game8_top": b["top_weapons"],
                           "kqm_top_listed_by_game8": bool(ta & set(b["weapons"])), "game8_top_listed_by_kqm": bool(tb & set(a["weapons"]))}
    # substats: the first two named
    sa, sb = {tuple(x) for x in a["top_substats"]}, {tuple(x) for x in b["top_substats"]}
    if sa and sb:
        both_first = {x[0] for x in a["top_substats"]} & {x[0] for x in b["top_substats"]}
        diff["substats"] = {"differs": not both_first, "kqm": a["substats"], "game8": b["substats"]}
    # ER, the one goal both name
    ea, eb = a["er"], b["er"]
    if ea and eb and ea["min"] is not None and eb["min"] is not None:
        low, high = max(ea["min"], eb["min"]), min(ea["max"], eb["max"])
        diff["er"] = {"differs": low > high + 10, "kqm": [ea["min"], ea["max"]], "game8": [eb["min"], eb["max"]]}
    return diff


def updated_of(page: str, source: str) -> str | None:
    if source == "kqm":
        for match in re.finditer(r"<h6[^>]*>(.*?)</h6>", page, flags=re.S):
            text = plain_text(match.group(1))
            if text.lower().startswith("updated"):
                return text
        return None
    match = re.search(r"Last updated on:\s*([^<\n]*)", page)
    return match.group(1).strip() if match else None


def source_block(name: str, url: str | None, page: str | None, parsed: dict[str, Any] | None, builds: list[dict[str, Any]],
                 goals: dict[str, Any] | None, source: str) -> dict[str, Any]:
    if page is None or parsed is None:
        return {"name": name, "url": url, "checked": CHECKED, "present": False, "has_builds": False,
                "note": "the site has no page for this character" if url is None else "page not found"}
    er = er_range(builds, goals, source)
    block: dict[str, Any] = {"name": name, "url": url, "checked": CHECKED, "present": True, "has_builds": bool(builds),
                             "updated": updated_of(page, source), "talent_priority": parsed["talent_priority"], "er": er,
                             "goals": goals, "builds": builds, "unmapped": parsed["unmapped"], "name_matches": parsed["how"]}
    if not builds:
        block["note"] = "the page has no build section that could be read"
    block["summary"] = summarize(builds, er)
    return block


def build_drafts() -> dict[str, Any]:
    inventory = load_inventory()
    weapons = Names(inventory["weapons"], True)
    sets = Names(inventory["sets"], True)
    slugs = kqm_slugs()
    menu = g8_menu()
    DRAFTS.mkdir(parents=True, exist_ok=True)
    index = []
    unmapped_all: dict[str, dict[str, dict[str, list[str]]]] = {"kqm": {"weapons": {}, "sets": {}}, "game8": {"weapons": {}, "sets": {}}}
    close_all: dict[str, dict[str, str]] = {"kqm": {}, "game8": {}}
    tallies = {"both": 0, "one": 0, "none": 0}
    for character in inventory["characters"]:
        key = character["key"]
        slug_k = kqm_target(key, slugs)
        archive = g8_target(character, menu)
        kqm_url = KQM_PAGE.format(slug=slug_k) if slug_k else None
        g8_url = G8_PAGE.format(id=archive) if archive else None
        kqm_page = (RAW / "kqm" / f"{key}.html").read_text(encoding="utf-8") if (RAW / "kqm" / f"{key}.html").exists() else None
        g8_page = (RAW / "game8" / f"{key}.html").read_text(encoding="utf-8") if (RAW / "game8" / f"{key}.html").exists() else None
        kp = parse_kqm(kqm_page, weapons, sets) if kqm_page else None
        gp = parse_game8(g8_page, weapons, sets) if g8_page else None
        kqm_builds = kqm_view(kp) if kp else []
        g8_builds = g8_view(gp) if gp else []
        k_block = source_block("KQM Quick Guide", kqm_url, kqm_page, kp, kqm_builds, None, "kqm")
        g_block = source_block("Game8 Best Builds and Teams", g8_url, g8_page, gp, g8_builds, gp["goals"] if gp else None, "game8")
        lacks = [n for n, blk in (("kqm", k_block), ("game8", g_block)) if not blk["has_builds"]]
        state = "both" if not lacks else ("none" if len(lacks) == 2 else "one")
        tallies[state] += 1
        differs = compare(k_block["summary"], g_block["summary"]) if state == "both" else {}
        for tag, blk in (("kqm", k_block), ("game8", g_block)):
            if blk["present"]:
                for kind in ("weapons", "sets"):
                    for name in blk["unmapped"][kind]:
                        unmapped_all[tag][kind].setdefault(name, []).append(key)
                close_all[tag].update({k: v for k, v in blk["name_matches"].items() if not v.startswith("abbreviation")})
        draft = {"key": key, "name": character["name"], "element": character["element"], "weapon_type": character["weapon_type"],
                 "rarity": character["rarity"], "version": character.get("version"), "state": state, "lacks": lacks, "checked": CHECKED,
                 "sources": {"kqm": k_block, "game8": g_block}, "differences": differs,
                 "differing_fields": sorted(f for f, v in differs.items() if v.get("differs"))}
        (DRAFTS / f"{key}.json").write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
        index.append({"key": key, "name": character["name"], "state": state, "lacks": lacks,
                      "differing_fields": draft["differing_fields"]})
    (DRAFTS / "_index.json").write_text(json.dumps({"checked": CHECKED, "counts": tallies, "characters": index,
                                                    "sources": [{"name": "KQM Quick Guide", "url_pattern": KQM_PAGE, "checked": CHECKED},
                                                                {"name": "Game8 Best Builds and Teams", "url_pattern": G8_PAGE, "checked": CHECKED}]},
                                                   ensure_ascii=False, indent=1), encoding="utf-8")
    (DRAFTS / "_unmapped.json").write_text(json.dumps({"checked": CHECKED, "unmapped": unmapped_all, "matched_not_exact": close_all},
                                                      ensure_ascii=False, indent=1), encoding="utf-8")
    return {"counts": tallies, "index": index}


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "drafts"
    if command == "fetch":
        fetch_all()
    else:
        fetch_all()
        result = build_drafts()
        print(result["counts"])


