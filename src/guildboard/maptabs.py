"""The Map page's tabs (the Map design, section 3): which HoYoLAB map pages are open, in what order, and what the
player called them.

A tab is a HoYoLAB interactive map page. Its address carries its state, the map, its filters, its centre and its zoom
(`#/map/2?shown_types=2,3&center=x,y&zoom=z`), so the core keeps only the address, and the shell reopens the page there.
The tabs are saved under the store's `meta` key `map_tabs`.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any
from urllib.parse import urlsplit

from guildboard.store import Store, valid_text

log = logging.getLogger(__name__)

META_KEY = "map_tabs"
MAP_HOST = "act.hoyolab.com"
MAP_PATH = "/ys/app/interactive-map/"
DEFAULT_URL = f"https://{MAP_HOST}{MAP_PATH}index.html?lang=en-us#/map/2"
MOST_TABS = 20
MOST_CLOSED = 10
NAME_LENGTH = 40
URL_LENGTH = 4096  # the longest address kept; a map's own are a few hundred characters
TITLE_LENGTH = 200
TITLE_ENDS = (" Interactive Map - HoYoLAB", " - HoYoLAB")
FALLBACK_NAME = "Map"

NO_TAB = "There is no such tab."
NO_CLOSED = "There is no closed tab to open again."
TOO_LONG = f"A tab's name is at most {NAME_LENGTH} characters."
TOO_MANY = f"At most {MOST_TABS} tabs can be open."
BAD_AREA = "The map's area is not understood."
LARGEST_AREA = 100_000  # CSS pixels: more than any display, and far less than Qt's rectangles hold


class MapError(ValueError):
    """Something the player asked of the tabs that Guild Board does not do. The message is fit to show."""


class UnknownTab(LookupError):
    pass


def is_map_url(url: object) -> bool:
    """True only for a page of HoYoLAB's interactive map, over https. Anything else is never opened in a tab."""
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    # urlsplit and Chromium read "https://evil.example\@act.hoyolab.com/..." differently (the host is the first's, to one, and the
    # second's to the other), so an address with a backslash or an "@" is no map address, whatever urlsplit makes of it.
    if len(url) > URL_LENGTH or "\\" in url or "@" in url:
        return False
    return parts.scheme == "https" and parts.hostname == MAP_HOST and parts.path.startswith(MAP_PATH)


def map_name(title: str | None) -> str:
    """The map's name from the page's title: "Teyvat Interactive Map - HoYoLAB" is "Teyvat"."""
    name = (title or "").strip()
    for end in TITLE_ENDS:
        if name.endswith(end):
            name = name[: -len(end)].strip()
            break
    return name or FALLBACK_NAME


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


class MapTabs:
    def __init__(self, store: Store) -> None:
        self._store = store
        self._tabs: list[dict[str, Any]] = []
        self._active = 0
        self._next = 1
        self._closed: list[dict[str, Any]] = []  # newest last; only for this run
        self._failed: set[int] = set()
        self._reloads: dict[int, int] = {}  # how many times each tab was asked to reload, for the shell
        self._viewport: dict[str, Any] | None = None
        self._load()

    # ------------------------------------------------------------------ keeping
    def _load(self) -> None:
        raw = self._store.meta(META_KEY)
        try:
            data = json.loads(raw) if raw else {}
        except ValueError:
            log.warning("the saved map tabs could not be read, so Guild Board starts with one")
            data = {}
        tabs = []
        for item in data.get("tabs", []) if isinstance(data, dict) else []:
            if not isinstance(item, dict) or not isinstance(item.get("id"), int) or isinstance(item.get("id"), bool):
                continue
            name = valid_text(item["name"]) if isinstance(item.get("name"), str) else None
            title = valid_text(item["title"])[:TITLE_LENGTH] if isinstance(item.get("title"), str) else None
            tabs.append({
                "id": item["id"],
                "name": name.strip()[:NAME_LENGTH] if isinstance(name, str) and name.strip() else None,
                "title": title if isinstance(title, str) else "",
                "url": item["url"] if is_map_url(item.get("url")) else DEFAULT_URL,
            })
        self._tabs = tabs[:MOST_TABS]
        next_id = data.get("next") if isinstance(data, dict) else None
        used = max((tab["id"] for tab in self._tabs), default=0)
        self._next = max(next_id if isinstance(next_id, int) else 1, used + 1)
        active = data.get("active") if isinstance(data, dict) else None
        if not self._tabs:
            self._tabs = [self._make(DEFAULT_URL)]
            self._active = self._tabs[0]["id"]
            self._save()
        else:
            self._active = active if any(tab["id"] == active for tab in self._tabs) else self._tabs[0]["id"]

    def _save(self) -> None:
        self._store.set_meta(
            META_KEY, json.dumps({"tabs": self._tabs, "active": self._active, "next": self._next}, separators=(",", ":"))
        )

    def _make(self, url: str, name: str | None = None, title: str = "") -> dict[str, Any]:
        tab = {"id": self._next, "name": name, "title": title, "url": url}
        self._next += 1
        return tab

    def _index(self, tab_id: int) -> int:
        for index, tab in enumerate(self._tabs):
            if tab["id"] == tab_id:
                return index
        raise UnknownTab(NO_TAB)

    def _room(self) -> None:
        if len(self._tabs) >= MOST_TABS:
            raise MapError(TOO_MANY)

    # ------------------------------------------------------------------ what the pages and the shell read
    def model(self) -> dict[str, Any]:
        return {
            "tabs": [
                {
                    "id": tab["id"], "name": tab["name"] or map_name(tab["title"]), "custom": tab["name"] is not None,
                    "failed": tab["id"] in self._failed,
                }
                for tab in self._tabs
            ],
            "active": self._active,
            "can_reopen": bool(self._closed),
        }

    def url_of(self, tab_id: int) -> str:
        return self._tabs[self._index(tab_id)]["url"]

    def snapshot(self) -> dict[str, Any]:
        """What the shell needs: each tab's address, the active tab and the area the page leaves for the map."""
        return {
            "tabs": [
                {"id": tab["id"], "url": tab["url"], "reload": self._reloads.get(tab["id"], 0)} for tab in self._tabs
            ],
            "active": self._active,
            "viewport": dict(self._viewport) if self._viewport is not None else None,
        }

    # ------------------------------------------------------------------ what the player does
    def add(self, url: str | None = None) -> int:
        self._room()
        tab = self._make(url if is_map_url(url) else DEFAULT_URL)
        self._tabs.append(tab)
        self._active = tab["id"]
        self._save()
        return tab["id"]

    def duplicate(self, tab_id: int) -> int:
        index = self._index(tab_id)
        self._room()
        source = self._tabs[index]
        name = f"{source['name']} 2"[:NAME_LENGTH] if source["name"] else None
        tab = self._make(source["url"], name, source["title"])
        self._tabs.insert(index + 1, tab)
        self._active = tab["id"]
        self._save()
        return tab["id"]

    def rename(self, tab_id: int, name: str) -> None:
        tab = self._tabs[self._index(tab_id)]
        name = valid_text(str(name).strip())
        if len(name) > NAME_LENGTH:
            raise MapError(TOO_LONG)
        tab["name"] = name or None
        self._save()

    def remove(self, tab_id: int) -> None:
        index = self._index(tab_id)
        self._closed.append(self._tabs.pop(index))
        del self._closed[:-MOST_CLOSED]
        self._failed.discard(tab_id)
        if not self._tabs:
            self._tabs.append(self._make(DEFAULT_URL))
            self._active = self._tabs[0]["id"]
        elif self._active == tab_id:
            self._active = self._tabs[max(0, index - 1)]["id"]
        self._save()

    def reopen(self) -> int:
        if not self._closed:
            raise MapError(NO_CLOSED)
        self._room()
        tab = self._closed.pop()
        self._tabs.append(tab)
        self._active = tab["id"]
        self._save()
        return tab["id"]

    def reload(self, tab_id: int) -> None:
        self._index(tab_id)
        self._reloads[tab_id] = self._reloads.get(tab_id, 0) + 1

    def activate(self, tab_id: int) -> None:
        self._index(tab_id)
        self._active = tab_id
        self._save()

    # ------------------------------------------------------------------ what the shell reports
    def seen(self, tab_id: int, url: str, title: str) -> bool:
        """The page of a tab moved or got a title. Its address is kept when it is a map address, and a title when it
        is not empty. True when what the Map page shows changed, which only the title does."""
        try:
            tab = self._tabs[self._index(tab_id)]
        except UnknownTab:
            return False  # a tab closed a moment ago
        shown = False
        changed = False
        if is_map_url(url) and url != tab["url"]:
            tab["url"] = url
            changed = True
        # A page without its title yet is titled by its address, which is not a name.
        if isinstance(title, str) and title.endswith(TITLE_ENDS[-1]) and title != tab["title"]:
            tab["title"] = valid_text(title)[:TITLE_LENGTH]  # half an emoji can come with a page's title
            shown = changed = True
        if changed:
            self._save()
        return shown

    def set_failed(self, tab_id: int, failed: bool) -> bool:
        """True when the state changed."""
        if not any(tab["id"] == tab_id for tab in self._tabs):
            return False
        before = tab_id in self._failed
        (self._failed.add if failed else self._failed.discard)(tab_id)
        return before != failed

    def set_viewport(self, area: object) -> None:
        """The area of the page's CSS pixels the map fills, with `hidden` while the page puts something over it; None
        when the Map page is not showing. Not saved."""
        if area is None:
            self._viewport = None
            return
        if not isinstance(area, dict):
            raise MapError(BAD_AREA)
        numbers = {key: _number(area.get(key)) for key in ("x", "y", "w", "h")}
        if (
            any(value is None or abs(value) > LARGEST_AREA for value in numbers.values())
            or numbers["w"] < 0 or numbers["h"] < 0
        ):
            raise MapError(BAD_AREA)
        hidden = area.get("hidden", False)
        if not isinstance(hidden, bool):
            raise MapError(BAD_AREA)
        self._viewport = {**numbers, "hidden": hidden}
