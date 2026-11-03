"""The Pulls page's model (the Pulls design, section 2): the `Pulls` shape of web/src/types.ts, field for field, from what
the planner reads. Pure: no store and no clock; the planner hands everything over in a `PullsData`.

The chances (the plan's calls 7 and 8, spec 6.1):
- One estimate serves them all (the Pulls second pass, spec 3.1): the ledger's total, the forecast by any day, the
  planner's chances and the wishlist's budgets are `savings.forecast`, which runs through the next version. The
  unfinished achievements are in none of them; the model gives them beside the total.
- A card whose guarantee is not known is counted as a 50/50 at its counted pity, in every chance and in `certain_within`
  (spec 6.1, item 2: the safe case).
- The planner gives each running character banner, and the running weapon banner while it features the charted weapon,
  the chance of one featured copy and of two within the pulls the forecast gives by the banner's end.
- The wishlist is worked out in date order as one chain (`savings.chain`). Each pool's first entry starts from that
  pool's card; every later entry of the pool, and every further copy, from a count of 0 and a 50/50 (a 75/25 with no
  point for a weapon).
  - A weapon on the list is the one wanted, so it counts as charted on itself. The card's count and its 75/25's
    guarantee carry over between banners; its Fate Point does not. So the point counts only for the weapon the card has
    charted, and only when the entry's day is on or before the end of the running weapon banner that features it.
  - An entry's pool and rank come from the wiki. A name the wiki lacks is a 5★ of the kind typed: a weapon is the weapon
    event's, a character the character event's.
  - A 4★ entry gets chance 0 and no `certain_within`, and takes no pulls from the chain. `certain_within` is the chain's
    too: the pulls within which this entry and every one before it are certain.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Any, Callable, Mapping, Sequence

from guildboard.gameday import game_day, server_tz
from guildboard.metrics import slug
from guildboard.pulls import POOL_LABELS, POOLS, PULL_PRIMOGEMS
from guildboard.pulls.nextversion import NextVersion
from guildboard.pulls.rules import Correction, FiveStar, PoolState, Wish, load_reference, luck, typical_average
from guildboard.pulls.savings import (
    ChainEntry,
    Estimate,
    certain_within,
    chain,
    chance_within,
    convolve,
    forecast,
    pulls_to_featured,
)
from guildboard.store import BannerRow, PullsAccountRow, WikiItemRow, WishImportRow, WishlistRow, WishRow, iso

NO_BALANCE = Estimate(0, 0, 0, 0, 0)  # the forecast before a balance is set: the income and the next version alone
IMPORT_STATES = {"running": "running", "ok": "done", "failed": "failed"}
WISHLIST_POOLS = ("character", "weapon")  # a wishlist entry is a 5★ of the character or the weapon event
# The columns of wishes each month, and the column each wish counts in: the beginners' wish counts with the standard one.
MONTH_COLUMNS = ("character", "weapon", "standard", "chronicled")
MONTH_COLUMN_OF = {
    "character": "character", "weapon": "weapon", "standard": "standard", "novice": "standard",
    "chronicled": "chronicled",
}


@dataclass(frozen=True)
class PullsData:
    """What the model is built from, as the planner reads it for the account shown."""

    uid: int | None  # the account shown; None before any wish is kept
    account_uid: int | None  # the login's
    now: datetime
    today: date  # the game day of `now`
    server: str
    states: Mapping[str, PoolState]  # by pool of ALL_POOLS; empty with no account shown
    account: PullsAccountRow | None  # what the player set; None with no account shown
    last_run: WishImportRow | None  # the newest import run of any account
    banners: Sequence[BannerRow]
    wiki: Mapping[tuple[str, str], WikiItemRow]
    rows: Sequence[WishRow]  # the newest of the history, newest first
    more: bool  # whether older rows are kept
    count: int  # the wishes kept of the account
    four_counts: Mapping[int, int]  # each 4★'s count, by wish id
    estimate: Estimate | None  # the balance moved on; None before one is set
    per_day: float | None
    achievements_left: int  # shown under the total, in no estimate
    next_version: NextVersion  # what the next game version offers, with the player's switches
    by: date  # the forecast's day
    default_by: bool
    wishlist: Sequence[WishlistRow]
    corrections: Mapping[str, Correction] = field(default_factory=dict)  # the corrections in force, by pool
    # Each pool's window from the account's runs that finished it (rules.window_start), None for a pool no run finished.
    windows: Mapping[str, datetime | None] = field(default_factory=dict)
    months: Sequence[Mapping[str, Any]] = ()  # the wishes each month, as wish_months gives them


# ---------------------------------------------------------------------------------------------- the history


def wish_kind(item_type: str) -> str:
    """A kept wish's kind from HoYoverse's item type: "Weapon" is a weapon, anything else a character."""
    return "weapon" if item_type.strip().lower() == "weapon" else "character"


def wish_icon(kind: str, name: str, wiki: Mapping[tuple[str, str], WikiItemRow]) -> str | None:
    """The icon's address in the core when the wiki lists the item, else None: the page draws the sign."""
    return f"/api/icon/wish.{kind}.{slug(name)}" if (kind, name) in wiki else None


def four_counts(wishes_by_pool: Mapping[str, Sequence[Wish]]) -> dict[int, int]:
    """Each 4★'s count, by wish id: the wishes since the last 4★ or 5★ of its pool, itself included."""
    counts: dict[int, int] = {}
    for wishes in wishes_by_pool.values():
        since = 0
        for wish in sorted(wishes, key=lambda wish: wish.id):
            since += 1
            if wish.rank == 4:
                counts[wish.id] = since
            if wish.rank >= 4:
                since = 0
    return counts


def wish_months(wishes_by_pool: Mapping[str, Sequence[Wish]], today: date, server: str) -> list[dict[str, Any]]:
    """The wishes each month (the Pulls second pass, spec 3.3): a row for every month from the oldest wish kept to the
    month of `today`, oldest first, quiet months with 0s. A wish counts in the month of the server's clock, which the
    game's history shows; the beginners' wish counts with the standard one. [] with no wish kept."""
    tz = server_tz(server)
    counts: dict[tuple[int, int], dict[str, int]] = {}
    for pool, wishes in wishes_by_pool.items():
        if pool not in MONTH_COLUMN_OF:
            continue
        for wish in wishes:
            local = wish.at.astimezone(tz)
            counts.setdefault((local.year, local.month), dict.fromkeys(MONTH_COLUMNS, 0))[MONTH_COLUMN_OF[pool]] += 1
    if not counts:
        return []
    (year, month), last = min(counts), max(max(counts), (today.year, today.month))
    months = []
    while (year, month) <= last:
        quiet = dict.fromkeys(MONTH_COLUMNS, 0)
        months.append({"month": f"{year:04d}-{month:02d}", **counts.get((year, month), quiet)})
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def history_rows(
    rows: Sequence[WishRow],
    states: Mapping[str, PoolState],
    counts: Mapping[int, int],
    wiki: Mapping[tuple[str, str], WikiItemRow],
) -> list[dict[str, Any]]:
    """The history's rows: a 5★ with its count and how it fell, a 4★ with its count, a 3★ with neither."""
    fives: dict[int, FiveStar] = {five.wish.id: five for state in states.values() for five in state.fives}
    out = []
    for row in rows:
        kind = wish_kind(row.item_type)
        five = fives.get(row.id) if row.rank == 5 else None
        out.append(
            {
                "id": str(row.id),  # HoYoverse's ids are past what a number in the page can hold exactly
                "name": row.name,
                "kind": kind,
                "rank": row.rank,
                "pool": row.pool,
                "pool_label": POOL_LABELS.get(row.pool, row.pool),
                "pity": five.pity if five is not None else counts.get(row.id) if row.rank == 4 else None,
                "result": five.result if five is not None else None,
                "at": iso(row.at),
                "icon": wish_icon(kind, row.name, wiki),
            }
        )
    return out


# ---------------------------------------------------------------------------------------------- the cards and banners


def pity_card(state: PoolState, correction: Correction | None) -> dict[str, Any]:
    """A pool's card, with the correction in force: one kept for an earlier window is not (the plan's call 6). `from`
    is where its history starts, which the correction's form names: the correction is the state before it."""
    rule = load_reference().pool(state.pool)
    last = state.last_five
    return {
        "pool": state.pool,
        "pity": state.pity,
        "known": state.known,
        "hard": rule.hard,
        "soft": rule.soft,
        "four": state.four,
        "four_known": state.four_known,
        "guarantee": state.guarantee,  # "none" for the standard wish (ruling R9)
        "path": (
            {"item": state.path_item, "points": state.path_points or 0, "max": 1}
            if state.path_points is not None
            else None
        ),
        "last_five": {"name": last.wish.name, "pity": last.pity, "at": iso(last.wish.at)} if last is not None else None,
        "wishes": state.wishes,
        "correction": (
            {"pity": correction.pity, "guaranteed": correction.guaranteed} if correction is not None else None
        ),
        "from": iso(state.since) if state.since is not None else None,
    }


def running(banner: BannerRow, now: datetime) -> bool:
    return banner.starts_at <= now < banner.ends_at


def banner_model(banner: BannerRow, now: datetime, cards: Mapping[str, dict[str, Any]]) -> dict[str, Any]:
    pool = banner.pool if banner.pool in POOLS else "other"
    return {
        "ann_id": banner.ann_id,
        "name": banner.name,
        "pool": pool,
        "featured": list(banner.featured),
        "art": f"/api/icon/banner.{banner.ann_id}" if banner.art_url else None,
        "starts_at": iso(banner.starts_at),
        "ends_at": iso(banner.ends_at),
        "running": running(banner, now),
        "pity": cards.get(pool),
    }


def default_forecast_day(banners: Sequence[BannerRow], now: datetime, server: str, today: date) -> date:
    """The forecast's day when none is chosen: the end of the running character and weapon banners that end last, as a
    game day, else today."""
    ends = [banner.ends_at for banner in banners if banner.pool in WISHLIST_POOLS and running(banner, now)]
    return max(today, game_day(max(ends), server)) if ends else today


# ---------------------------------------------------------------------------------------------- the chances


def _first_copy(state: PoolState, point_counts: bool) -> tuple[list[float], int]:
    """The pulls the first featured copy needs from a card, and within how many it is certain, charted on the one wanted.
    A guarantee not known counts as a 50/50. The card's Fate Point counts only when `point_counts`: for the weapon the
    card has charted, while its banner runs."""
    guaranteed = state.guarantee == "guaranteed"
    points = (state.path_points or 0) if point_counts else 0
    return (
        pulls_to_featured(state.pool, state.pity, guaranteed, path_points=points, charted=True),
        certain_within(state.pool, state.pity, guaranteed, path_points=points, charted=True),
    )


def _next_copy(pool: str) -> tuple[list[float], int]:
    """A further copy, after a featured one: from a count of 0 and a 50/50, or a 75/25 with no point."""
    return pulls_to_featured(pool, 0, False), certain_within(pool, 0, False)


def planner_entry(banner: dict[str, Any], state: PoolState, budget: int, icon: str | None) -> dict[str, Any]:
    """A running banner's chances, with the icon of the 5★ it is for. The weapon banner's entry is for the weapon charted
    on it, so its point counts."""
    first, certain = _first_copy(state, point_counts=True)
    later, _ = _next_copy(state.pool)
    return {
        "banner": banner,
        "chance": chance_within(first, budget),
        "second": chance_within(convolve(first, later, size=budget + 1), budget),
        "certain_within": certain,
        "pulls_by_then": budget,
        "icon": icon,
    }


def _wiki_item(name: str, kind: str, wiki: Mapping[tuple[str, str], WikiItemRow]) -> WikiItemRow | None:
    other = "weapon" if kind == "character" else "character"
    return wiki.get((kind, name)) or wiki.get((other, name))


def wishlist_entries(
    entries: Sequence[WishlistRow],
    states: Mapping[str, PoolState],
    wiki: Mapping[tuple[str, str], WikiItemRow],
    budget_by: Callable[[date], int],
    point_until: date | None,
) -> list[dict[str, Any]]:
    """The wishlist in date order, each entry with its chance in the chain and the pulls the forecast gives by its day.
    `point_until` is the last day of the running weapon banner that features the charted weapon, None with none: the
    card's Fate Point counts for an entry of that weapon up to that day, and is gone after it."""
    out: list[dict[str, Any]] = []
    chained: list[tuple[int, ChainEntry]] = []
    started: set[str] = set()
    reach = 0
    weapon_charted = states["weapon"].path_item if "weapon" in states else ""
    for entry in sorted(entries, key=lambda entry: (entry.about, entry.position, entry.id)):
        item = _wiki_item(entry.name, entry.kind, wiki)
        pool = item.kind if item is not None else entry.kind  # a name the wiki lacks is of the kind typed
        rank = item.rank if item is not None and item.rank else 5
        budget = budget_by(entry.about)
        model: dict[str, Any] = {
            "id": entry.id,
            "name": entry.name,
            "kind": entry.kind,
            "rank": rank,
            "pool": pool,
            "about": entry.about.isoformat(),
            "copies": entry.copies,
            "icon": wish_icon(item.kind, entry.name, wiki) if item is not None else None,
            "chance": 0.0,
            "certain_within": None,
            "pulls_by_then": budget,
        }
        if rank >= 5:
            point_counts = (
                pool == "weapon" and bool(weapon_charted) and entry.name == weapon_charted
                and point_until is not None and entry.about <= point_until
            )
            first, certain = _first_copy(states[pool], point_counts) if pool not in started else _next_copy(pool)
            started.add(pool)
            later, certain_later = _next_copy(pool)
            reach += certain + (entry.copies - 1) * certain_later
            model["certain_within"] = reach
            chained.append((len(out), ChainEntry(budget, first, later, entry.copies)))
        out.append(model)
    for (index, _), chance in zip(chained, chain([entry for _, entry in chained])):
        out[index]["chance"] = chance
    return out


# ---------------------------------------------------------------------------------------------- the model


def history_from(windows: Mapping[str, datetime | None]) -> datetime | None:
    """The start of the known window (the plan's call 4): the earliest window among the pools a run finished; None when
    no run finished one."""
    starts = [start for start in windows.values() if start is not None]
    return min(starts) if starts else None


def import_model(run: WishImportRow | None) -> dict[str, Any]:
    """The newest import as the top bar's line reads it; the pool being read comes with the import's events alone. The
    day-long link lives in the importer's memory, whose state() the route gives in this block's place: here it is none."""
    if run is None:
        return {
            "state": "idle", "last_at": None, "found": 0, "pages": 0, "pool": None, "message": None,
            "auto": None, "auto_stopped": None, "login": None, "every_minutes": None,
        }
    return {
        "state": IMPORT_STATES.get(run.outcome, "failed"),
        "last_at": iso(run.started_at),
        "found": run.found,
        "pages": run.pages,
        "pool": None,
        "message": run.message,
        "auto": None,
        "auto_stopped": None,
        "login": None,
        "every_minutes": None,
    }


def next_model(next_version: NextVersion, typed: int | None) -> dict[str, Any]:
    """The next version as the ledger reads it: its days, its seven rows in order, and their sum over the rows that are on.
    `typed` is the events count the player typed for it, None when none."""
    return {
        "number": next_version.number,
        "starts_on": next_version.starts_on.isoformat(),
        "ends_on": next_version.ends_on.isoformat(),
        "rows": [
            {"key": row.key, "primogems": row.primogems, "fates": row.fates, "on": row.on, "estimated": row.estimated}
            for row in next_version.rows
        ],
        "primogems": next_version.primogems,
        "fates": next_version.fates,
        "pulls": next_version.pulls,
        "events_typed": typed,
    }


def build_pulls(data: PullsData) -> dict[str, Any]:
    if data.uid is None:  # no account shown (ruling R8): nothing of an account's, whatever was handed over
        data = replace(
            data, states={}, account=None, rows=(), more=False, count=0, four_counts={}, estimate=None, wishlist=(),
            corrections={}, windows={}, months=(),
        )
    states = data.states
    cards = {pool: pity_card(states[pool], data.corrections.get(pool)) for pool in POOLS if pool in states}
    banners = [banner_model(banner, data.now, cards) for banner in data.banners]
    next_version = data.next_version

    def pulls_by(day: date) -> int:
        """The one estimate behind the ledger's total, the forecast and every chance (the Pulls second pass, spec 3.1)."""
        return forecast(data.estimate or NO_BALANCE, data.per_day, data.today, day, next_version)

    planner = []
    point_until = None  # the last day of the running weapon banner that features the charted weapon
    if states:
        weapon = states["weapon"]
        for banner, model in zip(data.banners, banners):
            if not running(banner, data.now):
                continue
            budget = pulls_by(game_day(banner.ends_at, data.server))
            if banner.pool == "character":
                featured = banner.featured[0] if banner.featured else ""  # the 5★ of a character banner comes first
                icon = wish_icon("character", featured, data.wiki)
                planner.append(planner_entry(model, states["character"], budget, icon))
            elif banner.pool == "weapon" and weapon.path_item and weapon.path_item in banner.featured:
                icon = wish_icon("weapon", weapon.path_item, data.wiki)
                planner.append(planner_entry(model, weapon, budget, icon))
                point_until = max(point_until or date.min, game_day(banner.ends_at, data.server))

    account, estimate = data.account, data.estimate
    balance_set = account is not None and account.balance_set_at is not None
    typed = account.events_typed.get(next_version.number) if account is not None and next_version.number else None
    figures = luck(states)
    window = history_from(data.windows)
    return {
        "uid": data.uid,
        "account_uid": data.account_uid,
        "history_from": iso(window) if window is not None else None,
        "import": import_model(data.last_run),
        "banners": banners,
        "pity": [cards[pool] for pool in POOLS if pool in cards],
        "savings": {
            "set": (
                {
                    "primogems": account.balance_primogems,
                    "fates": account.balance_fates,
                    "set_at": iso(account.balance_set_at),
                }
                if balance_set
                else None
            ),
            "pulls": estimate.pulls if estimate is not None else None,
            "estimated": (
                {
                    "primogems": estimate.primogems,
                    "fates": estimate.fates,
                    "income": estimate.income,
                    "wishes": estimate.wishes,
                }
                if estimate is not None
                else None
            ),
            "income_per_day": data.per_day,
            "achievements_left": data.achievements_left,
            "achievements_pulls": data.achievements_left // PULL_PRIMOGEMS,  # shown under the total, outside it
            "forecast": {
                "by": data.by.isoformat(),
                "pulls": pulls_by(data.by),
                "default_by": data.default_by,
                "days": max(0, (data.by - data.today).days),
            },
            "owned": {
                "welkin": account is not None and account.welkin,
                "gnostic_hymn": account is not None and account.gnostic_hymn,
            },
            "next": next_model(next_version, typed),
            "by_next_end": pulls_by(next_version.ends_on) if estimate is not None else None,  # no balance, no total
        },
        "wishlist": wishlist_entries(data.wishlist, states, data.wiki, pulls_by, point_until) if states else [],
        "planner": planner,
        "history": {
            "count": data.count,
            "fives": figures.fives,
            "average_pity": figures.average_pity,
            "typical_average": round(typical_average(), 1),
            "won": figures.won,
            "lost": figures.lost,
            "luckier_than": figures.luckier_than,
            "months": list(data.months),
            "rows": history_rows(data.rows, states, data.four_counts, data.wiki),
            "more": data.more,
        },
    }
