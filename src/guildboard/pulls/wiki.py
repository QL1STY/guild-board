"""The icons of the characters and weapons, read from the HoYoLAB wiki's lists and kept in the database (the Pulls
design, section 2.4; the plan's calls, item 13).

The lists are read whole, 50 entries a page, when a name the page shows is not kept: a 5★ or 4★ of the history, a
featured name of a banner, or a name on the wishlist: after an import, after a banners read that kept a new featured name
and after an entry was added to the wishlist. Each list is read at most once a day (CLAUDE.md), counted from the newest of
its rows the database keeps, which the Characters pages' wiki writes too (`characters.wiki.CharacterWiki.lists`), so neither
reader reads a list the other read that day, and a start of Guild Board does not reset it (the audit of 2026-11-09, H1). A
name the wiki lacks waits for the next day's read; the page shows its drawn sign meanwhile. A list that could not be read
is tried again a quarter of an hour later. Each icon is kept as the label wish.<kind>.<slug>, which the icon cache serves,
whichever reader read the list. The wiki's request is a POST that asks for a list; it changes nothing.
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
LIST_EVERY = timedelta(days=1)  # a kind's list is read at most this often, by either reader (characters.wiki's own)
LIST_RETRY = timedelta(minutes=15)  # after a list could not be read, it is tried again no sooner than this
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
        self.missing: set[tuple[str, str]] = set()  # the names the lists kept did not hold, at the last refresh
        self._lock = asyncio.Lock()  # one read at a time: the one that waits finds the items just read
        self._tried: dict[str, datetime] = {}  # when each kind's list last failed to be read, in this run

    def icon(self, kind: str, name: str) -> str | None:
        """Where the page finds an item's icon; None while the wiki's lists do not hold it."""
        return f"/api/icon/{icon_key(kind, name)}" if (kind, name) in self._store.wiki_items() else None

    def _due(self, kind: str, kept: dict[tuple[str, str], WikiItemRow], now: datetime) -> bool:
        """Whether a kind's list may be read now: its newest kept row is a day old or more (or none is kept), and it did
        not fail to be read in the last quarter of an hour."""
        newest = max((row.read_at for (item_kind, _), row in kept.items() if item_kind == kind), default=None)
        if newest is not None and 0 <= (now - newest).total_seconds() < LIST_EVERY.total_seconds():
            return False
        tried = self._tried.get(kind)
        return tried is None or not 0 <= (now - tried).total_seconds() < LIST_RETRY.total_seconds()

    async def refresh(self, names: Iterable[tuple[str, str]] = ()) -> bool:
        """Read the lists when a name of `names` is not kept, each list at most once a day; the names the lists kept hold get
        their icons' labels, whichever reader kept them. Whether a list was read or an icon labelled."""
        if self._fetch is None:
            return False
        async with self._lock:
            wanted = {(kind, name) for kind, name in names if kind in MENUS and name}
            kept = self._store.wiki_items()
            now = self._clock.now()
            changed = False
            for kind, menu in MENUS.items():
                if not any(pair not in kept for pair in wanted) or not self._due(kind, kept, now):
                    continue
                try:
                    rows = await self._read_list(kind, menu, now)
                except Exception as error:  # offline, or a page it cannot read: the items kept of that kind stay
                    self._tried[kind] = now
                    log.warning(
                        "The HoYoLAB wiki's %s list could not be read (%s). The icons kept stay.",
                        kind, netpolicy.what_failed(error),
                    )
                    continue
                self._tried.pop(kind, None)
                with self._store.transaction():
                    self._store.replace_wiki_items(kind, rows)
                changed = True
            kept = self._store.wiki_items()
            # The icons of the names wanted that the lists hold, labelled where they are not: a list the Characters pages'
            # wiki read has no labels of its own.
            labels = [
                Label(icon_key(kind, name), name, "wish", None, kept[(kind, name)].icon_url)
                for kind, name in sorted(wanted) if (kind, name) in kept
                and (self._store.label(icon_key(kind, name)) or Label("", "", "", None, "")).icon_url != kept[(kind, name)].icon_url
            ]
            if changed:   # a list read: every icon it holds is labelled, as the page may show any of them
                labels = [Label(icon_key(kind, name), name, "wish", None, row.icon_url) for (kind, name), row in kept.items()
                          if kind in MENUS]
            if labels:
                self._store.upsert_labels(labels, now)
            # A name of a list that could not be read was not looked for: it is not counted missing.
            self.missing = {pair for pair in wanted if pair not in kept and pair[0] not in self._tried}
        return changed or bool(labels)

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
