"""A wish history built by hand for the Pulls tests, in the numbers the demo seeds (the Pulls plan, Task 5): 387 wishes of
one account between 2026-05-16 and 2026-10-12, so that each card's figure can be worked out by hand.

- The character event: 219 wishes, every tenth of type 400. 5★ Skirk at the 77th and 5★ Qiqi at the 158th, then 61 more.
  A 4★ every 9th since the last 5★, the last at the 212th. Pity 61, guaranteed after the lost 50/50, 4★ count 7.
- The weapon event: 23 wishes from 2026-10-01, a 4★ at the 10th and 20th. Pity 23, 4★ count 3.
- The standard wish: 120 wishes from 2026-05-20, 5★ Wolf's Gravestone at the 76th. Pity 44, 4★ count 8.
- The chronicled wish: 5 wishes on 2026-07-02. Pity 5.
- The beginners' wish: 20 wishes on 2026-05-16, 4★ Noelle at the 10th.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from guildboard.gameday import server_tz
from guildboard.pulls import ALL_POOLS
from guildboard.store import BannerRow, PullsAccountRow, Store, WishRow, iso

UTC = timezone.utc
UID = 700000001
OTHER_UID = 700000002
FIRST_ID = 1_700_000_000_000_000_000
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)  # the tests' clock
BANNERS_START = datetime(2026, 9, 23, 5, 0, tzinfo=UTC)
BANNERS_END = datetime(2026, 10, 24, 6, 0, tzinfo=UTC)
DEMO_BANNERS = (
    BannerRow(9001, "Void Star's Advent", "character", ("Skirk",), "", BANNERS_START, BANNERS_END, NOW),
    BannerRow(9002, "La Chanson Cerise", "character", ("Escoffier",), "", BANNERS_START, BANNERS_END, NOW),
    BannerRow(
        9003, "Epitome Invocation", "weapon", ("Azurelight", "Symphonist of Scents"), "", BANNERS_START, BANNERS_END,
        NOW,
    ),
)
TYPE_OF = {"character": "301", "weapon": "302", "standard": "200", "chronicled": "500", "novice": "100"}
FIVES = {
    "Skirk": "Character", "Qiqi": "Character", "Ganyu": "Character", "Shenhe": "Character",
    "Wolf's Gravestone": "Weapon", "Azurelight": "Weapon", "Symphonist of Scents": "Weapon",
}
WINDOW = NOW - timedelta(days=180)  # the window of a run that started at NOW


def corrected(pity: int = 0, guaranteed: bool = False, window: datetime = WINDOW) -> dict:
    """A correction as the planner keeps it: given for the window that started at `window`."""
    return {"pity": pity, "guaranteed": guaranteed, "from": iso(window)}


@dataclass(frozen=True)
class Drawn:
    pool: str
    gacha_type: str
    name: str
    item_type: str
    rank: int
    at: datetime


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def spread(count: int, first: datetime, last: datetime) -> list[datetime]:
    """`count` moments from `first` to `last`, evenly, to the second."""
    if count == 1:
        return [first]
    seconds = int((last - first).total_seconds())
    return [first + timedelta(seconds=seconds * n // (count - 1)) for n in range(count)]


def pool_run(
    pool: str, count: int, first: str, last: str, *, five: str | None = None, four: str = "Bennett", every: int = 9,
    fours: tuple[int, ...] | None = None,
) -> list[Drawn]:
    """`count` wishes of one pool from `first` to `last`: the last a 5★ named `five` when one is given, a 4★ at every
    `every`-th (or at the counts `fours`), the others 3★."""
    drawn = []
    for n, moment in enumerate(spread(count, at(first), at(last)), start=1):
        if five is not None and n == count:
            rank, name, item = 5, five, FIVES.get(five, "Character")
        elif (n in fours) if fours is not None else n % every == 0:
            rank, name, item = 4, four, "Character"
        else:
            rank, name, item = 3, "Cool Steel", "Weapon"
        drawn.append(Drawn(pool, TYPE_OF[pool], name, item, rank, moment))
    return drawn


def demo_like_history() -> list[Drawn]:
    character = [
        *pool_run("character", 77, "2026-05-16T12:00", "2026-06-24T18:00", five="Skirk"),
        *pool_run("character", 81, "2026-06-25T18:00", "2026-09-02T18:00", five="Qiqi"),
        *pool_run("character", 61, "2026-09-03T18:00", "2026-10-12T20:00"),
    ]
    character = [
        Drawn(d.pool, "400" if n % 10 == 0 else "301", d.name, d.item_type, d.rank, d.at)
        for n, d in enumerate(character, start=1)
    ]
    drawn = [
        *character,
        *pool_run("weapon", 23, "2026-10-01T10:00", "2026-10-11T10:00", four="The Flute", fours=(10, 20)),
        *pool_run("standard", 76, "2026-05-20T10:00", "2026-08-15T10:00", five="Wolf's Gravestone", four="Fischl"),
        *pool_run("standard", 44, "2026-08-16T10:00", "2026-10-10T10:00", four="Fischl"),
        *pool_run("chronicled", 5, "2026-07-02T10:00", "2026-07-02T10:04", fours=()),
        *pool_run("novice", 20, "2026-05-16T08:00", "2026-05-16T08:19", four="Noelle", fours=(10,)),
    ]
    return sorted(drawn, key=lambda d: (d.at, ALL_POOLS.index(d.pool)))


def keep(store: Store, drawn: list[Drawn], *, uid: int = UID, now: datetime = NOW, first_id: int = FIRST_ID,
         pools: tuple[str, ...] = ALL_POOLS, finished: bool = True) -> int:
    """Keep the wishes under one import run that started at `now` and finished `pools`; the ids grow with the times."""
    run = store.start_wish_import(now)
    tz = server_tz("os_euro")
    rows = [
        WishRow(
            first_id + n, uid, d.gacha_type, d.pool, d.name, d.item_type, d.rank,
            d.at.astimezone(tz).strftime("%Y-%m-%d %H:%M:%S"), d.at, run,
        )
        for n, d in enumerate(drawn, start=1)
    ]
    store.add_wishes(rows)
    if finished:
        store.finish_wish_import(run, now + timedelta(seconds=12), "ok", uid, len(rows), 20, None, pools)
    return run


def keep_demo_like(store: Store, *, uid: int = UID, corrections: bool = True, charted: str = "Azurelight") -> None:
    """The demo's history, account and banners: every pool corrected to a count of 0 and a 50/50 for the window of the
    run at NOW, the weapon charted, and the three banners of 2026-09-23 running."""
    keep(store, demo_like_history(), uid=uid)
    store.put_pulls_account(
        PullsAccountRow(
            uid, charted, "", None, None, None, {pool: corrected() for pool in ALL_POOLS} if corrections else {}, {},
        )
    )
    store.replace_banners(DEMO_BANNERS)
