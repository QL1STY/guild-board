"""The icons of the characters and weapons, read from the HoYoLAB wiki's lists and kept in the database (the Pulls
design, section 2.4; the plan's calls, item 13).

The lists are read whole, 50 entries a page, when a name the page shows is not kept: a 5★ or 4★ of the history, a
featured name of a banner, or a name on the wishlist. They are read after an import, and, at most once a day, after a
banners read that kept a new featured name and after an entry was added to the wishlist. A name the wiki lacks (a
character newer than the wiki's list, or a name spelt otherwise) is asked for once more, and then not before a day has
passed since the last read; the page shows its drawn sign meanwhile. Each icon is kept as the label
wish.<kind>.<slug>, which the icon cache serves. The wiki's request is a POST that asks for a list; it changes nothing.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable

from guildboard import netpolicy
from guildboard.clock import Clock
from guildboard.metrics import Label, slug
from guildboard.store import Store, WikiItemRow

log = logging.getLogger(__name__)

WIKI_URL = "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list"
MENUS = {"character": "2", "weapon": "4"}
PAGE_SIZE = 50  # the most a page gives: a larger page_size is refused
MAX_PAGES = 20  # 1,000 entries of a kind; the wiki listed 132 characters and 252 weapons on 2026-10-24
# Without Origin and Referer, the wiki answers 403.
HEADERS = {
    "x-rpc-wiki_app": "genshin",
    "x-rpc-language": "en-us",
    "Origin": "https://wiki.hoyolab.com",
    "Referer": "https://wiki.hoyolab.com/",
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
}
MISSING_ASKED_AGAIN_AFTER = timedelta(days=1)
DAILY = timedelta(days=1)  # the reads after a banners read or a wishlist add come at most this often
ITEM_KINDS = {"Character": "character", "Weapon": "weapon"}  # a wish's item_type, as HoYoverse names it in English
RANK = re.compile(r"[0-9]")


def _rank(filters: Any, kind: str) -> int:
    """The rarity the wiki gives an item, "5-Star" as 5; 0 when it gives none."""
    try:
        value = filters[f"{kind}_rarity"]["values"][0]
    except (KeyError, IndexError, TypeError):
        return 0
    found = RANK.match(value) if isinstance(value, str) else None
    return int(found.group(0)) if found is not None else 0


def _count(value: Any) -> int | None:
    """A length the wiki gives: in text, as its lists give it ("132"), or as a number; None when it is neither."""
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def parse_items(kind: str, body: bytes, read_at: datetime) -> tuple[list[WikiItemRow], int]:
    """The items of a page of the wiki's list of `kind`, and how many the whole list holds. An entry without a name or
    an icon is left out. ValueError when the answer is not such a page."""
    answer = json.loads(body)
    data = answer.get("data") if isinstance(answer, dict) and answer.get("retcode") == 0 else None
    entries = data.get("list") if isinstance(data, dict) else None
    total = _count(data.get("total")) if isinstance(data, dict) else None
    if not isinstance(entries, list) or total is None:
        raise ValueError(f"the wiki's {kind} list cannot be read")
    rows: list[WikiItemRow] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name, icon, page_id = entry.get("name"), entry.get("icon_url"), entry.get("entry_page_id")
        if not isinstance(name, str) or not name.strip() or not isinstance(icon, str) or not icon:
            continue
        rows.append(WikiItemRow(
            kind=kind, name=name.strip(), rank=_rank(entry.get("filter_values"), kind), icon_url=icon,
            entry_page_id=str(page_id) if isinstance(page_id, (str, int)) else "", read_at=read_at,
        ))
    return rows, total


def icon_key(kind: str, name: str) -> str:
    """The label an item's icon is served under, at /api/icon/<key>."""
    return f"wish.{kind}.{slug(name)}"


def wanted_names(store: Store, uid: int | None) -> set[tuple[str, str]]:
    """The names whose icons the page shows: the 4★ and 5★ of the account's wishes, its wishlist's names as their kinds
    were typed, and the banners' featured characters and weapons, each as (kind, name)."""
    names: set[tuple[str, str]] = set()
    if uid is not None:
        for wish in store.wishes(uid):
            kind = ITEM_KINDS.get(wish.item_type)
            if kind is not None and wish.rank >= 4:
                names.add((kind, wish.name))
        names.update((entry.kind, entry.name) for entry in store.wishlist(uid))
    for banner in store.banners():
        if banner.pool in MENUS:
            names.update((banner.pool, name) for name in banner.featured)
    return names


class WikiIcons:
    def __init__(self, store: Store, clock: Clock, fetch: Callable[..., Any] | None) -> None:
        self._store = store
        self._clock = clock
        self._fetch = fetch  # netpolicy.fetch_hoyoverse; None in the demo, which contacts nothing
        self.missing: set[tuple[str, str]] = set()  # the names the last read did not find
        self._lock = asyncio.Lock()  # one read at a time: the one that waits finds the items just read
        # When the last of the reads held to once a day was made (`daily`), in this run of Guild Board: a start may make
        # one more, as the start's banners read asks for the icons of the names it kept.
        self._daily_read_at: datetime | None = None

    def icon(self, kind: str, name: str) -> str | None:
        """Where the page finds an item's icon; None while the wiki's lists do not hold it."""
        return f"/api/icon/{icon_key(kind, name)}" if (kind, name) in self._store.wiki_items() else None

    async def refresh(self, names: Iterable[tuple[str, str]] = (), force: bool = False, *, daily: bool = False) -> bool:
        """Read the wiki's lists whole when a name of `names` is not kept, unless every such name was missing at the
        last read and that read is younger than a day. `force` reads them whatever is kept. `daily` holds the read to
        once a day among the reads asked for so: those after a banners read that kept a new featured name and after an
        entry was added to the wishlist. Whether a list was read."""
        if self._fetch is None:
            return False
        async with self._lock:
            wanted = {(kind, name) for kind, name in names if kind in MENUS and name}
            kept = self._store.wiki_items()
            lacking = {pair for pair in wanted if pair not in kept}
            if not force:
                newest = max((row.read_at for row in kept.values()), default=None)
                young = newest is not None and self._clock.now() - newest < MISSING_ASKED_AGAIN_AFTER
                if not lacking or (young and lacking <= self.missing):
                    return False
            now = self._clock.now()
            if daily:
                if self._daily_read_at is not None and now - self._daily_read_at < DAILY:
                    return False
                self._daily_read_at = now
            read: set[str] = set()
            for kind, menu in MENUS.items():
                try:
                    rows = await self._read_list(kind, menu, now)
                except Exception as error:  # offline, or a page it cannot read: the items kept of that kind stay
                    log.warning(
                        "The HoYoLAB wiki's %s list could not be read (%s). The icons kept stay.",
                        kind, netpolicy.what_failed(error),
                    )
                    continue
                with self._store.transaction():
                    self._store.replace_wiki_items(kind, rows)
                    self._store.upsert_labels(
                        [Label(icon_key(kind, row.name), row.name, "wish", None, row.icon_url) for row in rows], now
                    )
                read.add(kind)
            kept = self._store.wiki_items()
            # A name of a list that could not be read was not looked for: it is asked for again at the next refresh.
            self.missing = {pair for pair in wanted if pair not in kept and pair[0] in read}
        return bool(read)

    async def _read_list(self, kind: str, menu: str, now: datetime) -> list[WikiItemRow]:
        """Every page of a kind's list, fifty entries a page. A list with no entry is not the game's: ValueError, so
        that the items kept stay."""
        rows, total = await self._read_page(kind, menu, 1, now)
        for page in range(2, min(math.ceil(total / PAGE_SIZE), MAX_PAGES) + 1):
            rows.extend((await self._read_page(kind, menu, page, now))[0])
        if not rows:
            raise ValueError(f"the wiki's {kind} list is empty")
        return rows

    async def _read_page(self, kind: str, menu: str, page: int, now: datetime) -> tuple[list[WikiItemRow], int]:
        asked = {"filters": [], "menu_id": menu, "page_num": page, "page_size": PAGE_SIZE, "use_es": True}
        body = await asyncio.to_thread(
            self._fetch, WIKI_URL, headers=HEADERS, body=json.dumps(asked).encode("utf-8")
        )
        return parse_items(kind, body, now)
