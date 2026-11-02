"""The HoYoLAB wiki's two requests and a download, for the research scripts (build time only; never in Guild Board).

Source: https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/ (the wiki's own API, as `guildboard/pulls/wiki.py`
uses it). Entry pages are kept in `out/raw/<id>.json` so a re-run asks only for what is missing; `--refresh` in a
script clears nothing by itself: delete `out/raw` to read everything again.
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Iterable, TypeVar

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
RAW = OUT / "raw"

API = "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/"
# The same headers as guildboard/pulls/wiki.py; without Origin and Referer the wiki answers 403.
HEADERS = {
    "x-rpc-wiki_app": "genshin",
    "x-rpc-language": "en-us",
    "Origin": "https://wiki.hoyolab.com",
    "Referer": "https://wiki.hoyolab.com/",
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Guild Board research script)",
}
PAGE_SIZE = 50
T = TypeVar("T")
R = TypeVar("R")


def slug(text: str) -> str:
    """`guildboard.metrics.slug`, copied: lower case, letters and digits kept, everything else a dash."""
    mapped = "".join(ch if ch.isalnum() else "-" for ch in text.strip().lower())
    return "-".join(part for part in mapped.split("-") if part) or "x"


def _open(request: urllib.request.Request, tries: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{request.full_url}: {last}")


def list_entries(menu: str) -> list[dict[str, Any]]:
    """Every entry of a wiki menu (2 characters, 4 weapons, 5 artifact sets), 50 a page."""
    entries: list[dict[str, Any]] = []
    page, total = 1, 1
    while page <= max(1, math.ceil(total / PAGE_SIZE)):
        asked = {"filters": [], "menu_id": menu, "page_num": page, "page_size": PAGE_SIZE, "use_es": True}
        request = urllib.request.Request(API + "get_entry_page_list", json.dumps(asked).encode("utf-8"), HEADERS)
        answer = json.loads(_open(request))
        if answer.get("retcode") != 0:
            raise RuntimeError(f"menu {menu} page {page}: {answer.get('message')}")
        data = answer["data"]
        total = int(data["total"])
        entries.extend(data["list"])
        page += 1
    return entries


def entry(entry_id: int | str) -> dict[str, Any]:
    """An entry's page (`data.page`), from `out/raw` when it is kept there, else from the wiki."""
    path = RAW / f"{entry_id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    request = urllib.request.Request(API + f"entry_page?entry_page_id={entry_id}", headers=HEADERS)
    answer = json.loads(_open(request))
    if answer.get("retcode") != 0:
        raise RuntimeError(f"entry {entry_id}: {answer.get('message')}")
    page = answer["data"]["page"]
    RAW.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(page, ensure_ascii=False), encoding="utf-8")
    return page


def download(url: str, path: Path) -> bool:
    """Save a file; False when the server has none. Skips a file that is already there."""
    if path.exists() and path.stat().st_size > 0:
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = _open(urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]}))
    except RuntimeError:
        return False
    path.write_bytes(data)
    return True


def parallel(function: Callable[[T], R], items: Iterable[T], workers: int = 6) -> list[R]:
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(function, items))


TAG = re.compile(r"<[^>]+>")


def plain(html: str) -> str:
    """Wiki text without its tags: <br> and </p> become line breaks, entities are read, runs of blanks are cut."""
    text = re.sub(r"<br\s*/?>|</p>", "\n", html or "")
    text = TAG.sub("", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


def components(page: dict[str, Any], module: str, component: str) -> list[Any]:
    """The parsed `data` of every component named `component` in the page's module named `module`."""
    found: list[Any] = []
    for mod in page.get("modules", []):
        if mod.get("name") != module:
            continue
        for part in mod.get("components", []):
            if part.get("component_id") == component:
                data = part.get("data")
                found.append(json.loads(data) if isinstance(data, str) and data else data)
    return found


def base_info(page: dict[str, Any]) -> dict[str, str]:
    """The Attributes module's `baseInfo` rows as {label: plain text}; a row with several values joins them with ' | '."""
    rows: dict[str, str] = {}
    for data in components(page, "Attributes", "baseInfo"):
        for row in (data or {}).get("list", []):
            rows[str(row.get("key", "")).strip()] = " | ".join(plain(v) for v in (row.get("value") or []))
    return rows
