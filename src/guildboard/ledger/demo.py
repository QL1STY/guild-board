"""The demo's own game history (the ledger design, section 10): about four months of made-up entries of the four kinds,
with the reasons the game itself gives, and the stand-ins its Import reads them through. The demo reads no file of the
game's and contacts nothing.

Each game day's entries are made from the day alone, and each entry's id from its moment, so a demo started on a later
day makes the same entries for the days it shares with an earlier start, and its Import finds only the newer ones. The
game's logs lag: an entry is there an hour after its moment.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlencode

from guildboard.clock import Clock
from guildboard.gameday import days_inclusive, game_day, game_day_start, server_tz
from guildboard.ledger import KINDS
from guildboard.ledger.api import LedgerPage
from guildboard.logging_setup import register_secret
from guildboard.pulls.gamecache import KEY, KEY_VERSION, HistoryLinks, WishLink
from guildboard.pulls.wishapi import PAGE_SIZE, TIME_FORMAT
from guildboard.store import LedgerRow, Store

DAYS = 120  # about four months
LAG = timedelta(hours=1)  # an entry shows in the game's log an hour after its moment
SEEDED = "ledger.demo_seeded"
DEMO_CSC_KEY = "DEMO-CSC-KEY-0123456789"  # made up: the demo's Feedback link opens nothing

TREE = "Revitalized Petrified Tree (Domain)"
COURT = "Denouement of Sin (Domain)"
TALENTS = "Violet Court (Domain)"
WEEKLY = ("Confront Stormterror", "Wolf of the North Challenge", "Enter the Golden House")
CRAFTING = "Item crafting material"  # the game's reason for resin made into Condensed Resin
FIVES = ("Gladiator's Nostalgia", "Wanderer's Troupe", "Night of the Sky's Unveiling", "Scroll of the Hero")
FOURS = ("Instructor's Brooch", "Berserker's Rose", "Exile's Flower")


@dataclass(frozen=True)
class _Entry:
    kind: str
    at: datetime
    amount: int
    reason: str
    name: str = ""
    rarity: int = 0


def _day(day: date, server: str, first: date) -> list[_Entry]:
    """One game day's entries, made from the day alone."""
    rng = random.Random(f"guildboard-ledger-{day.isoformat()}")
    start = game_day_start(day, server)
    entries: list[_Entry] = []

    def add(kind: str, minutes: float, amount: int, reason: str, name: str = "", rarity: int = 0) -> None:
        entries.append(_Entry(kind, start + timedelta(minutes=minutes), amount, reason, name, rarity))

    into = (day - first).days
    add("primogem", 0.1, 90, "Blessing of the Welkin Moon daily reward")
    if rng.random() < 0.85:
        add("primogem", 900 + rng.randrange(120), 60, "Daily Commission reward")
    if rng.random() < 0.3:
        add("primogem", 700 + rng.randrange(60), rng.choice((40, 60, 120, 420)), "Event reward")
    if day.day == 16:
        add("primogem", 1000, 800, "Spiral Abyss reward")
    if day.day == 2:
        add("primogem", 1010, 800, "Obtained from Imaginarium Theater")
    if day.day == 10:
        add("primogem", 1020, 450, "Stygian Onslaught reward")
    for n in range(rng.randrange(4)):
        add("primogem", 600 + 7 * n, rng.choice((2, 5, 10, 20)), "Opened treasure chest")
    if rng.random() < 0.2:
        add("primogem", 650, rng.choice((5, 10, 20)), "Claimed reward")
    if into % 10 == 9:
        add("primogem", 1100, -1600, "Shop purchase")  # ten Fates
    if into % 14 == 5:
        add("primogem", 1110, -50, "Original Resin replenishment")
    # The calendar's own: the Welkin Moon on the 5th of each month, its crystals made into primogems at once, and two
    # purchases in the shop (the game's reason for any crystals spent there), so that every month the Ledger draws has a little of each.
    if day.day == 5:
        add("crystal", 300, 300, "Purchased Blessing of the Welkin Moon")
        add("crystal", 305, -300, "Exchanged Genesis Crystals for Primogems")
        add("primogem", 305, 300, "Exchanged Genesis Crystals for Primogems")
    if day.day in (12, 19):
        add("crystal", 340, -60, "Shop purchase")
    if into == 15:
        add("crystal", 310, 1960, "Obtained via purchase")  # 980, the first-time double
    if into == 70:
        add("crystal", 310, 3880, "Obtained via purchase")  # 3280 with its usual bonus
    if into == 40:
        add("crystal", 320, -1090, "Exchanged Genesis Crystals for Primogems")
        add("primogem", 320, 1090, "Exchanged Genesis Crystals for Primogems")
    if into == 20:
        add("primogem", 330, 680, "BP reward")  # a Gnostic Hymn
    # Resin: the day's domain runs, a condensed one among them, and their artifacts.
    domain = TREE if (into // 7) % 2 == 0 else COURT
    minute = 800.0
    for run in range(rng.randrange(3, 7)):
        condensed = run == 0 and rng.random() < 0.5
        add("resin", minute, -40 if condensed else -20, domain)
        for _ in range(2 if condensed else 1):
            fives = 1 + (rng.random() < 0.07)
            for _ in range(fives):
                add("artifact", minute + 0.2, 1, domain, rng.choice(FIVES), 5)
            for _ in range(rng.randrange(1, 3)):
                add("artifact", minute + 0.3, 1, domain, rng.choice(FOURS), 4)
        minute += 3
    if rng.random() < 0.5:
        add("resin", minute + 5, -20, "Ley Line Blossom challenge reward")
    if rng.random() < 0.3:
        add("resin", minute + 9, -20, TALENTS)
    for n in range(rng.randrange(3)):
        add("artifact", 1200 + n, -1, "Artifact enhancement material", rng.choice(FOURS), 4)
    if rng.random() < 0.3:
        add("artifact", 1210, -1, "Artifact decomposition", rng.choice(FOURS), 4)
    if rng.random() < 0.1:
        add("artifact", 1220, 1, "Obtained from Mystic Offering", rng.choice(FIVES), 5)
    if rng.random() < 0.15:
        add("artifact", 640, 1, "Opened treasure chest", rng.choice(FOURS), 4)
    # Every ninth day a Condensed Resin is made, 40 resin as the game's log names it (after every draw above, so that the
    # day's other entries stay as they were).
    if into % 9 == 4:
        add("resin", 1230, -40, CRAFTING)
    # Bosses, after every draw above so that the day's other entries stay as they were: a Trounce Blossom every fifth day at
    # 40 resin, and the weekly bosses' Trounce Domains, written "(Domain)" by the game, three at 30 resin on a Monday and one
    # at the full 60 on the Tuesday.
    if day.day % 5 == 0:
        add("resin", 1240, -40, "Trounce Blossom challenge reward")
    if day.weekday() == 0:
        for n, name in enumerate(WEEKLY):
            add("resin", 1250 + n, -30, f"{name} (Domain)")
    if day.weekday() == 1:
        add("resin", 1250, -60, f"{WEEKLY[0]} (Domain)")
    return entries


def anchor(store: Store, server: str, now: datetime) -> date:
    """The first game day of the demo folder's history: DAYS before the day it was first seeded."""
    kept = store.meta(SEEDED)
    return date.fromisoformat(kept) if kept else game_day(now, server) - timedelta(days=DAYS)


def demo_rows(uid: int, server: str, now: datetime, first: date) -> list[LedgerRow]:
    """Every entry the demo's game history holds at `now`, from the game day `first`, oldest first."""
    today = game_day(now, server)
    tz = server_tz(server)
    rows: list[LedgerRow] = []
    for day in days_inclusive(first, today):
        seen: dict[tuple[str, int], int] = {}
        for entry in sorted(_day(day, server, first), key=lambda e: e.at):
            if entry.at > now - LAG:
                continue
            second = int(entry.at.timestamp())
            n = seen.get((entry.kind, second), 0)
            seen[(entry.kind, second)] = n + 1
            time = entry.at.astimezone(tz).strftime(TIME_FORMAT)
            rows.append(LedgerRow(
                uid, entry.kind, second * 100 + n, time,
                datetime.strptime(time, TIME_FORMAT).replace(tzinfo=tz), entry.amount, entry.reason, entry.name,
                entry.rarity,
            ))
    return rows


def seed_ledger(store: Store, uid: int, server: str, now: datetime) -> None:
    """Once per demo folder: the demo's game history up to an hour before `now`, as if imported then."""
    if store.meta(SEEDED) is not None:
        return
    first = anchor(store, server, now)
    with store.transaction():
        store.keep_ledger_entries(demo_rows(uid, server, now, first))
        for kind in KINDS:
            store.record_ledger_import(uid, kind, now, 0, "ok", None)
        store.set_meta(SEEDED, first.isoformat())


def demo_ledger_links() -> list[WishLink]:
    """The demo's Feedback link, with a made-up key, treated as a key is."""
    query = {"auth_appid": "csc", "game_biz": "hk4e_global", KEY: DEMO_CSC_KEY, KEY_VERSION: "1", "sign_type": "2"}
    register_secret(DEMO_CSC_KEY)
    return [WishLink(f"https://gs.hoyoverse.com/event/user-game-search/genshin/index.html?{urlencode(query)}", query,
                     Path())]


def demo_history_links(wish_links: Callable[[], list[WishLink]]) -> Callable[[], HistoryLinks]:
    """The demo's stand-in for the two reads: its wish link and its Feedback link."""
    return lambda: HistoryLinks(wish_links(), demo_ledger_links())


def demo_ledger_user(uid: int, server: str) -> Callable[[WishLink], Awaitable[tuple[int, str]]]:
    async def user(link: WishLink) -> tuple[int, str]:
        return uid, server

    return user


def demo_ledger_pages(store: Store, server: str, clock: Clock) -> Callable[..., Awaitable[LedgerPage]]:
    """The demo's stand-in for the game's history logs: each kind's entries at the demo's now, 20 a page below
    `end_id`, newest first."""

    async def fetch(link: WishLink, kind: str, end_id: str, uid: int, region: Any = None) -> LedgerPage:
        now = clock.now()
        rows = [row for row in demo_rows(uid, server, now, anchor(store, server, now)) if row.kind == kind]
        older = sorted((row for row in rows if end_id == "0" or row.id < int(end_id)), key=lambda row: -row.id)
        return LedgerPage(tuple(older[:PAGE_SIZE]))

    return fetch


def demo_diary_entries(server: str, now: datetime) -> list[tuple[str, datetime, str, int]]:
    """The diary's detail of the demo's game day and the one before it: its primogems in, (time, at, action, amount)."""
    today = game_day(now, server)
    tz = server_tz(server)
    out = []
    for day in (today - timedelta(days=1), today):
        for entry in sorted(_day(day, server, date(2000, 1, 1)), key=lambda e: e.at):
            if entry.kind == "primogem" and entry.amount > 0 and entry.at <= now:
                time = entry.at.astimezone(tz).strftime(TIME_FORMAT)
                out.append((time, datetime.strptime(time, TIME_FORMAT).replace(tzinfo=tz), entry.reason, entry.amount))
    return out
