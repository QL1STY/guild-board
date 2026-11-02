"""The import of the game's own history logs: primogems, crystals, resin and artifacts (the ledger design, sections 0
and 4).

With the self-service link that answered, each kind is fetched page by page, newest first, half a second apart, and
only what is new is kept: a kind ends at a page of fewer than 20 entries, or at an entry already kept. A kind's new
entries are kept together once it reaches its end, so a kind cut short keeps none and is fetched again next time, and a
kind's kept history never has a gap. One record of each kind's import is written. The first failure stops the kinds
after it; the kinds before it stay kept. The link and its key are never written anywhere.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable

from guildboard.ledger import KINDS
from guildboard.pulls.gamecache import WishLink
from guildboard.pulls.wishapi import PAGE_SIZE, PAUSE_SECONDS, KeyExpired, KeyInvalid, WishApiError
from guildboard.store import LedgerRow, Store

log = logging.getLogger(__name__)

MOST_PAGES = 1000  # 20,000 entries of a kind, far more than the game keeps in six months
NOTHING_NEW = "Nothing new in your game history."


@dataclass
class LedgerOutcome:
    found: dict[str, int] = field(default_factory=dict)  # the new entries kept, by kind
    failed: dict[str, str] = field(default_factory=dict)  # the kind that stopped the run, and its sentence
    refused: bool = False  # HoYoverse refused the key: the link is no good any more


def ledger_sentence(outcome: LedgerOutcome) -> str:
    """What the player is told at the end of the ledgers' part of an import."""
    if outcome.failed:
        return next(iter(outcome.failed.values()))
    total = sum(outcome.found.values())
    if total == 0:
        return NOTHING_NEW
    return "Read 1 new entry of your game history." if total == 1 else f"Read {total:,} new entries of your game history."


async def call(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """HoYoverse's reads in a thread, so that the core keeps answering meanwhile; the demo's, made from the store, on
    the core's own thread."""
    if inspect.iscoroutinefunction(function):
        return await function(*args, **kwargs)
    return await asyncio.to_thread(function, *args, **kwargs)


async def _fetch_kind(
    store: Store, link: WishLink, uid: int, kind: str, region: str | None, fetch: Callable[..., Any],
    sleep: Callable[[float], Awaitable[None]], show: Callable[[str, int], None],
) -> list[LedgerRow]:
    """A kind's new entries, from its newest to the first already kept or its end."""
    held: dict[int, LedgerRow] = {}
    end_id = "0"
    for number in range(MOST_PAGES):
        if number:
            await sleep(PAUSE_SECONDS)
        page = await call(fetch, link, kind, end_id, uid, region=region)
        reached = False
        for row in page.rows:
            if store.has_ledger_entry(uid, kind, row.id):
                reached = True
            else:
                held.setdefault(row.id, row)
        show(kind, len(held))
        rows = page.rows
        if reached or len(rows) < PAGE_SIZE:
            break
        if end_id != "0" and rows[-1].id >= int(end_id):  # no older entry: asking again would bring no other
            log.warning("HoYoverse's %s history answered a page that does not go past the one before.", kind)
            break
        end_id = str(rows[-1].id)
    return list(held.values())


async def fetch_ledgers(
    store: Store,
    link: WishLink,
    uid: int,
    fetch: Callable[..., Any],
    sleep: Callable[[float], Awaitable[None]],
    show: Callable[[str, int], None],
    now: Callable[[], datetime],
    region: str | None = None,
) -> LedgerOutcome:
    """Every kind in KINDS order, half a second apart, each kept once it reaches its end."""
    outcome = LedgerOutcome()
    for index, kind in enumerate(KINDS):
        if index:
            await sleep(PAUSE_SECONDS)
        try:
            rows = await _fetch_kind(store, link, uid, kind, region, fetch, sleep, show)
        except WishApiError as error:
            outcome.failed[kind] = str(error)
            outcome.refused = isinstance(error, (KeyExpired, KeyInvalid))
            store.record_ledger_import(uid, kind, now(), 0, "failed", str(error))
            log.info("The %s history could not be read; the kinds after it wait for the next import.", kind)
            break
        found = store.keep_ledger_entries(rows)
        outcome.found[kind] = found
        store.record_ledger_import(uid, kind, now(), found, "ok", None)
        log.info("The %s history: %d new entries kept.", kind, found)
    return outcome
