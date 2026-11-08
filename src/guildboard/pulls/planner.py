"""The Pulls page's planner: it reads what the store keeps for the account shown, works out each wish's state with
rules.py, and hands it all to views/pulls.py for the page's model. It keeps the player's settings, balance and wishlist,
in the database and per game uid (the plan's call 1).

Rulings R8 to R11 of the Pulls build (2026-10-24), kept here in one place:
- R8: one account is shown, and it serves everything: the model, the settings, the balance, the wishlist and the cards.
  It is the account the newest import found (`store.wish_uids()[0]`) when any wish is kept, else none; the demo's own in
  the demo. The login's account is given beside it (`account_uid`), and the page says so when the two differ. With no
  account shown the model is the empty one, never four cards read as a complete history.
- R9: the standard card's guarantee is "none" (the standard wish has no featured item).
- R10: a change before any history is kept (the settings, the balance, a new wishlist entry) is refused
  with NO_HISTORY.
- R11: a charted weapon or a path's name over 80 characters is a request of another shape; the API refuses it before it
  reaches the planner.
"""
from __future__ import annotations

import re
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Mapping

from guildboard.achievements.catalog import Catalog
from guildboard.clock import Clock
from guildboard.gameday import game_day, game_day_start
from guildboard.history import History
from guildboard.ledger import income
from guildboard.metrics import diary_sources
from guildboard.characters.reference import load_inventory
from guildboard.pulls import ALL_POOLS, POOLS, nextversion
from guildboard.pulls.choices import load_upcoming, wish_choices
from guildboard.pulls.rules import PATHS, Correction, PoolState, Wish, load_reference, pool_state, window_start
from guildboard.pulls.savings import Balance, Estimate, balance_now
from guildboard.sources.demo import DEMO_ACCOUNT
from guildboard.store import BannerRow, PullsAccountRow, Store, WishImportRow, WishlistRow, WishRow, iso, valid_text
from guildboard.views.achievements import achievement_totals
from guildboard.views.pulls import (
    PullsData, build_pulls, default_forecast_day, four_counts, history_rows, wish_kind, wish_months,
)

# The sentences the player reads (the plan's contract, and rulings R8 and R10).
EARLIER_DAY = "Choose today or a later day."
NO_HISTORY = "No wish history yet. Open Wish → History in the game, then press Import."
NO_HISTORY_LOGIN = "No wish history yet. Guild Board is reading it now with your HoYoLAB login."  # where the login reads it
BAD_PITY = "Give the pity as a whole number from 0 to {top}."
BAD_POINTS = "Give the Fate Points as 0 or 1."
BAD_BALANCE = "Give primogems and fates as whole numbers."
BAD_ENTRY = "Give a name, a kind (character or weapon), a day as 2026-11-11, and copies from 1 to 7."
FULL_LIST = "The wishlist keeps at most 20 entries."
NO_ENTRY = "There is no such wishlist entry."

MAX_NAME = 80  # a charted weapon, a path or a wishlist entry's name
MAX_BALANCE = 9_999_999
MAX_ENTRIES = 20
MAX_COPIES = 7
KINDS = ("character", "weapon")
SWITCHES = ("welkin", "gnostic_hymn")  # what the player has: the Blessing of the Welkin Moon, the Gnostic Hymn
SETTINGS = ("charted_weapon", "chronicled_path", "corrections", "points", *SWITCHES, "events_typed")
MAX_TYPED_EVENTS = 100_000  # the most primogems the player may type as a version's events
VERSION = re.compile(r"[0-9]{1,3}\.[0-9]{1,3}")  # a game version's number, "7.2"
ENTRY_FIELDS = ("name", "kind", "about", "copies")
EVENT_POOLS = ("character", "weapon", "chronicled")  # the wishes that take Intertwined Fates (the plan's call 8)
HISTORY_PAGE = 100  # the history rows the model holds; the history route gives more
HISTORY_ROUTE_ROWS = 200  # the rows the history route gives when no limit is asked
MAX_HISTORY_ROWS = 500
RUNS = 1_000_000  # every import run: the window follows the whole chain (the plan's call 4)
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class PullsRefused(ValueError):
    """A value the Pulls page cannot keep. The message is the sentence the player reads; nothing was kept."""


class PullsConflict(Exception):
    """A change that cannot be made now: the wishlist is full, or no history is kept yet. The message is the sentence."""


class UnknownEntry(LookupError):
    """There is no such wishlist entry for the account shown."""


def _whole(value: Any) -> bool:
    """A whole number from JSON; true and false are not."""
    return isinstance(value, int) and not isinstance(value, bool)


def typed_events_fit(value: Any) -> bool:
    """Whether `value` is a typed events count as the settings take it: {"version": "7.2", "primogems": 2330}, with the
    primogems a whole number from 0 to 100,000, or None to take the version's count away."""
    if not (isinstance(value, Mapping) and set(value) == {"version", "primogems"}):
        return False
    version, primogems = value["version"], value["primogems"]
    return (
        isinstance(version, str) and VERSION.fullmatch(version) is not None
        and (primogems is None or (_whole(primogems) and 0 <= primogems <= MAX_TYPED_EVENTS))
    )


def switches_fit(changes: Mapping[str, Any]) -> bool:
    """Whether the switches and the typed events count of a settings change, the ones it has, are values the settings
    take: a switch is true or false."""
    return all(isinstance(changes[name], bool) for name in SWITCHES if name in changes) and (
        "events_typed" not in changes or typed_events_fit(changes["events_typed"])
    )


def as_day(value: Any) -> date | None:
    """A day written as 2026-11-11, else None."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or DAY.fullmatch(value) is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:  # a day the calendar does not have
        return None


def _wish(row: WishRow) -> Wish:
    return Wish(row.id, row.pool, row.gacha_type, row.name, wish_kind(row.item_type), row.rank, row.at, row.import_id)


def _window_text(window: datetime | None) -> str | None:
    return iso(window) if window is not None else None


def _correction(account: PullsAccountRow, pool: str, window: datetime | None) -> Correction | None:
    """The correction kept for a pool, while the window it was given for is still the pool's (the plan's call 6). A
    correction is the state before the window starts: a gap of 180 days or more between two runs moves the window, and
    the correction then says nothing of the new one, so the card reads "at least" again. It is kept, not used."""
    value = account.corrections.get(pool)
    if not (isinstance(value, Mapping) and _whole(value.get("pity")) and isinstance(value.get("guaranteed"), bool)):
        return None
    if "from" not in value or value["from"] != _window_text(window):
        return None
    return Correction(value["pity"], value["guaranteed"])


def _points_set(account: PullsAccountRow, pool: str) -> tuple[int, datetime] | None:
    """The Fate Points the game showed, and when the player gave them (the plan's call 20)."""
    value = account.points.get(pool)
    if pool in PATHS and isinstance(value, Mapping) and _whole(value.get("points")):
        moment = value.get("at")
        if isinstance(moment, datetime):
            return value["points"], moment
    return None


def _path(pool: str, account: PullsAccountRow, running: list[BannerRow]) -> tuple[str, datetime | None]:
    """The path item that counts and the start of its pool's running banner (the plan's call 20): the charted weapon only
    while the running weapon banner features it, the chronicled path only while a chronicled wish runs."""
    banners = [banner for banner in running if banner.pool == pool]
    if pool == "weapon":
        charted = account.charted_weapon
        featuring = [banner for banner in banners if charted and charted in banner.featured]
        if featuring:
            return charted, featuring[0].starts_at
        return "", banners[0].starts_at if banners else None
    if pool == "chronicled" and banners:
        return account.chronicled_path, banners[0].starts_at
    return "", None


class Planner:
    def __init__(
        self,
        store: Store,
        clock: Clock,
        history: History,
        catalog: Callable[[], Catalog],
        server: Callable[[], str],
        uid: Callable[[], int | None],
        demo: bool,
        login_on: Callable[[], bool] = lambda: False,
    ) -> None:
        self._store = store
        self._clock = clock
        self._history = history
        self._catalog = catalog  # the installed achievement list, which says how many primogems are left in it
        self._server = server  # the server's key, which says when a game day starts
        self._uid = uid  # the game account HoYoLAB named, None before a login
        self._demo = demo
        self._login_on = login_on  # whether the history updates itself with the HoYoLAB login: it says so, not to open the game

    # ------------------------------------------------------------------ the accounts
    def uid(self) -> int | None:
        """The account shown (ruling R8): the one the newest import found, None before any wish is kept; the demo's."""
        if self._demo:
            return DEMO_ACCOUNT.uid
        uids = self._store.wish_uids()
        return uids[0] if uids else None

    def account_uid(self) -> int | None:
        """The login's account: the one HoYoLAB named, None before a login; the demo's."""
        return DEMO_ACCOUNT.uid if self._demo else self._uid()

    def _shown(self) -> int:
        """The account a change is kept for; refused while no history is kept (ruling R10)."""
        uid = self.uid()
        if uid is None:
            raise PullsConflict(NO_HISTORY_LOGIN if self._login_on() else NO_HISTORY)
        return uid

    # ------------------------------------------------------------------ reading
    def _wishes(self, uid: int) -> dict[str, list[Wish]]:
        by_pool: dict[str, list[Wish]] = {pool: [] for pool in ALL_POOLS}
        for row in self._store.wishes(uid):
            by_pool.setdefault(row.pool, []).append(_wish(row))
        return by_pool

    @staticmethod
    def _windows(
        uid: int, runs: list[WishImportRow], wishes: Mapping[str, list[Wish]], now: datetime
    ) -> dict[str, datetime | None]:
        """Each pool's window from the chain of the account's runs that finished it (the plan's call 4), reaching back to
        the oldest wish of the pool the chain kept; None for a pool that no run finished. Another account's runs say
        nothing of this history."""
        own = [run for run in runs if run.uid == uid]
        return {pool: window_start(own, pool, now, wishes.get(pool, [])) for pool in ALL_POOLS}

    def _states(
        self,
        wishes: Mapping[str, list[Wish]],
        account: PullsAccountRow,
        windows: Mapping[str, datetime | None],
        banners: list[BannerRow],
        now: datetime,
    ) -> dict[str, PoolState]:
        running = [banner for banner in banners if banner.starts_at <= now < banner.ends_at]
        states = {}
        for pool in ALL_POOLS:
            kept = wishes.get(pool, [])
            start = windows[pool]
            if start is None:
                # No run finished the pool: a run that failed before it, or a first import that Guild Board's closing
                # cut short after keeping its wishes (that run ends as failed with no pool). What is kept starts its
                # history, and nothing before is known: a pool is complete only from the window of the runs that
                # finished it (the plan's call 4), never read as a complete history.
                start = min((wish.at for wish in kept), default=now)
            path_item, banner_start = _path(pool, account, running)
            states[pool] = pool_state(
                pool,
                kept,
                window_start=start,
                correction=_correction(account, pool, windows[pool]),
                path_item=path_item,
                banner_start=banner_start,
                points_set=_points_set(account, pool),
            )
        return states

    def states(self, uid: int) -> dict[str, PoolState]:
        """Each wish's state for an account, the novice wish's too."""
        now, wishes = self._clock.now(), self._wishes(uid)
        windows = self._windows(uid, self._store.wish_imports(RUNS), wishes, now)
        return self._states(wishes, self._store.pulls_account(uid), windows, self._store.banners(), now)

    def _estimate(
        self, account: PullsAccountRow | None, wishes: Mapping[str, list[Wish]], server: str, today: date
    ) -> Estimate | None:
        """The balance moved on (the plan's call 8): what was earned from the day after the day it was set, by the
        game's log or the diary's detail (never the diary's running total, which is not by day), and the event wishes
        imported after it. What was earned on the day itself was earned before the balance was typed, so the balance
        holds it already (ruling R16): counted again, it would overstate the savings and the chances."""
        if account is None or None in (account.balance_primogems, account.balance_fates, account.balance_set_at):
            return None
        set_at = account.balance_set_at
        first = game_day(set_at, server) + timedelta(days=1)
        spent = sum(1 for pool in EVENT_POOLS for wish in wishes.get(pool, []) if wish.at > set_at)
        balance = Balance(account.balance_primogems, account.balance_fates, set_at)
        span = income.covered(self._store, account.uid, server)
        if span is not None and span[1] >= first:
            # The game's own primogem log (the ledger design, section 5): every entry since, in and out, so wishes
            # bought and resin refilled are taken off, and Fates bought are not charged again. Days before its
            # coverage, and the days after its newest entry, count the earned of each day.
            start = max(first, span[0])
            since = set_at if start == first else game_day_start(start, server) - timedelta(seconds=1)
            net, fates = income.net_since(self._store, account.uid, since)
            before = income.earned_days(self._store, account.uid, server, first, start - timedelta(days=1))
            after = income.earned_days(self._store, account.uid, server, span[1] + timedelta(days=1), today)
            total = net + sum(day.value for day in [*before, *after])
            newest = self._store.newest_ledger_entry(account.uid, income.PRIMOGEM)
            late = sum(
                1 for pool in EVENT_POOLS for wish in wishes.get(pool, [])
                if wish.at > set_at and newest is not None and wish.at > newest.at
            )
            return balance_now(balance, total, spent, fates_bought=fates, wishes_after_log=late)
        earned = income.earned_days(self._store, account.uid, server, first, today)
        return balance_now(balance, sum(day.value for day in earned), spent)

    def balance_estimate(self) -> Estimate | None:
        """The balance moved on to now for the account shown, as `model` works it out, without building the page. None
        before a login or an import, and before a balance is typed."""
        uid = self.uid()
        if uid is None:
            return None
        account = self._store.pulls_account(uid)
        if account is None or account.balance_primogems is None:
            return None  # no balance typed: the wishes are not read for nothing
        server = self._server()
        today = game_day(self._clock.now(), server)
        return self._estimate(account, self._wishes(uid), server, today)

    def model(self, by: date | None = None) -> dict[str, Any]:
        """The `Pulls` model. `by` is the forecast's day; None is the end of the running banners, else today."""
        now, server = self._clock.now(), self._server()
        today = game_day(now, server)
        if by is not None and by < today:
            raise PullsRefused(EARLIER_DAY)
        uid = self.uid()
        banners, runs = self._store.banners(), self._store.wish_imports(RUNS)
        wishes: dict[str, list[Wish]] = {}
        states: dict[str, PoolState] = {}
        corrections: dict[str, Correction] = {}
        windows: dict[str, datetime | None] = {}
        account = None
        if uid is not None:
            wishes = self._wishes(uid)
            account = self._store.pulls_account(uid)
            windows = self._windows(uid, runs, wishes, now)
            states = self._states(wishes, account, windows, banners, now)
            corrections = {
                pool: correction for pool in ALL_POOLS
                if (correction := _correction(account, pool, windows[pool])) is not None
            }
        rows = self._store.wishes_before(uid, None, HISTORY_PAGE + 1) if uid is not None else []
        # The last 30 days' earned, over the exact days among them (the ledger design, section 5).
        per_day = income.pace(self._store, uid, server, today)
        # The next version: the diary's events and quests of the account logged in, and the shown account's switches.
        next_version = nextversion.next_version(
            today, banners, diary_sources(self._store),
            account.welkin if account is not None else False,
            account.gnostic_hymn if account is not None else False,
            account.events_typed if account is not None else {},
            nextversion.load_reference(), server,
        )
        return build_pulls(
            PullsData(
                uid=uid,
                account_uid=self.account_uid(),
                now=now,
                today=today,
                server=server,
                states=states,
                account=account,
                last_run=runs[0] if runs else None,
                banners=banners,
                wiki=self._store.wiki_items(),
                rows=rows[:HISTORY_PAGE],
                more=len(rows) > HISTORY_PAGE,
                count=self._store.wish_count(uid) if uid is not None else 0,
                four_counts=four_counts(wishes),
                estimate=self._estimate(account, wishes, server, today),
                per_day=per_day,
                achievements_left=achievement_totals(self._catalog(), self._store)["primogems_left"],
                next_version=next_version,
                by=by or default_forecast_day(banners, now, server, today),
                default_by=by is None,
                wishlist=self._store.wishlist(uid) if uid is not None else [],
                corrections=corrections,
                windows=windows,
                months=wish_months(wishes, today, server),
            )
        )

    def choices(self) -> dict[str, list[dict[str, Any]]]:
        """What Add a wish offers (pulls/choices.py): every character and weapon that can be wished for, in its group."""
        return wish_choices(
            load_inventory(), self._store.wiki_items(), load_upcoming(), self._store.banners(), self._clock.now()
        )

    def history(self, before: int | None, limit: int, min_rank: int = 3) -> dict[str, Any]:
        """Up to `limit` rows of the history of `min_rank` stars and up, newest first, older than the wish `before`
        when it is given."""
        uid = self.uid()
        if uid is None:
            return {"rows": [], "more": False}
        now, wishes = self._clock.now(), self._wishes(uid)
        windows = self._windows(uid, self._store.wish_imports(RUNS), wishes, now)
        states = self._states(wishes, self._store.pulls_account(uid), windows, self._store.banners(), now)
        rows = self._store.wishes_before(uid, before, limit + 1, min_rank=min_rank)
        return {
            "rows": history_rows(rows[:limit], states, four_counts(wishes), self._store.wiki_items()),
            "more": len(rows) > limit,
        }

    # ------------------------------------------------------------------ the settings and the balance
    def set_settings(self, changes: Mapping[str, Any]) -> None:
        """Keep the charted weapon, the chronicled path, the corrections and the Fate Points the game showed, the two
        switches (the Welkin Moon, the Gnostic Hymn) and the events count typed for a version, all of them or none. The
        API refuses a request of another shape before it comes here (ruling R11).

        A correction is kept with the window it is given for (`from`, the start of the pool's window now). A typed
        events count is kept for its version beside those of other versions, and a null takes its version's away.

        Replacing the chart that counts now (the weapon the running weapon banner features, or the path while a
        chronicled wish runs) with another, or taking it away, sets the pool's Fate Points to 0 now, as the game does,
        unless the request gives them. A chart that did not count resets nothing: last banner's chart, still kept when
        a new banner starts, or a name typed wrong. Nor does a first chart. The player charted in the game before setting
        it here, so the point the history counts stands."""
        uid = self._shown()
        if set(changes) - set(SETTINGS):
            raise ValueError(f"The Pulls settings are {', '.join(SETTINGS)}.")
        if not switches_fit(changes):
            raise ValueError(
                f"A switch is true or false; a typed events count is a version and its primogems, 0 to {MAX_TYPED_EVENTS}."
            )
        now = self._clock.now()
        account = self._store.pulls_account(uid)
        names = {}
        for setting in ("charted_weapon", "chronicled_path"):
            if setting in changes:
                name = changes[setting]
                if not isinstance(name, str) or len(name) > MAX_NAME:
                    raise ValueError(f"A name is text of at most {MAX_NAME} characters.")
                names[setting] = valid_text(name.strip())
        corrections = dict(account.corrections)
        windows = self._windows(uid, self._store.wish_imports(RUNS), self._wishes(uid), now)
        for pool, value in dict(changes.get("corrections") or {}).items():
            if pool not in POOLS:
                raise ValueError(f"Corrections are kept for {', '.join(POOLS)}.")
            if value is None:
                corrections.pop(pool, None)
                continue
            top = load_reference().pool(pool).hard - 1
            fits = (
                isinstance(value, Mapping) and set(value) == {"pity", "guaranteed"} and _whole(value["pity"])
                and 0 <= value["pity"] <= top and isinstance(value["guaranteed"], bool)
            )
            if not fits:
                raise PullsRefused(BAD_PITY.format(top=top))
            corrections[pool] = {
                "pity": value["pity"], "guaranteed": value["guaranteed"], "from": _window_text(windows[pool]),
            }
        points = dict(account.points)
        given = dict(changes.get("points") or {})
        running = [banner for banner in self._store.banners() if banner.starts_at <= now < banner.ends_at]
        for setting, pool, before in (
            ("charted_weapon", "weapon", account.charted_weapon),
            ("chronicled_path", "chronicled", account.chronicled_path),
        ):
            counting = _path(pool, account, running)[0]
            if setting in names and before and before == counting and names[setting] != before and pool not in given:
                points[pool] = {"points": 0, "at": now}  # the game resets the point; the history cannot see it
        for pool, value in given.items():
            if pool not in PATHS:
                raise ValueError(f"Fate Points are kept for {', '.join(PATHS)}.")
            if value is None:
                points.pop(pool, None)
                continue
            if not _whole(value) or value not in (0, 1):
                raise PullsRefused(BAD_POINTS)
            points[pool] = {"points": value, "at": now}
        switches = {name: changes[name] for name in SWITCHES if name in changes}
        typed = dict(account.events_typed)
        if "events_typed" in changes:
            version, primogems = changes["events_typed"]["version"], changes["events_typed"]["primogems"]
            if primogems is None:
                typed.pop(version, None)
            else:
                typed[version] = primogems
        self._store.put_pulls_account(
            replace(account, **names, **switches, corrections=corrections, points=points, events_typed=typed)
        )

    def set_balance(self, primogems: Any, fates: Any) -> None:
        """Keep the balance the player typed, set now."""
        uid = self._shown()
        if not all(_whole(value) and 0 <= value <= MAX_BALANCE for value in (primogems, fates)):
            raise PullsRefused(BAD_BALANCE)
        account = self._store.pulls_account(uid)
        self._store.put_pulls_account(
            replace(account, balance_primogems=primogems, balance_fates=fates, balance_set_at=self._clock.now())
        )

    # ------------------------------------------------------------------ the wishlist
    @staticmethod
    def _entry_values(name: Any, kind: Any, about: Any, copies: Any) -> tuple[str, str, date, int]:
        day = as_day(about)
        fits = (
            isinstance(name, str) and 1 <= len(name.strip()) <= MAX_NAME and kind in KINDS and day is not None
            and _whole(copies) and 1 <= copies <= MAX_COPIES
        )
        if not fits:
            raise PullsRefused(BAD_ENTRY)
        return valid_text(name.strip()), kind, day, copies

    def _entry(self, entry_id: int) -> WishlistRow:
        uid = self.uid()
        found = [entry for entry in self._store.wishlist(uid) if entry.id == entry_id] if uid is not None else []
        if not found:
            raise UnknownEntry(NO_ENTRY)
        return found[0]

    def add_wish(self, name: Any, kind: Any, about: Any, copies: Any) -> int:
        """Add an entry at the end of the account's wishlist; the model orders the list by its days."""
        uid = self._shown()
        name, kind, day, copies = self._entry_values(name, kind, about, copies)
        if len(self._store.wishlist(uid)) >= MAX_ENTRIES:
            raise PullsConflict(FULL_LIST)
        return self._store.add_wishlist(uid, name, kind, day, copies, self._clock.now())

    def edit_wish(self, entry_id: int, **changes: Any) -> None:
        """Change an entry's name, kind, day or copies: the fields given take their new values, the others stay."""
        entry = self._entry(entry_id)
        if set(changes) - set(ENTRY_FIELDS):
            raise ValueError(f"A wishlist entry has {', '.join(ENTRY_FIELDS)}.")
        current = {"name": entry.name, "kind": entry.kind, "about": entry.about, "copies": entry.copies}
        name, kind, day, copies = self._entry_values(**{**current, **changes})
        self._store.put_wishlist(replace(entry, name=name, kind=kind, about=day, copies=copies))

    def remove_wish(self, entry_id: int) -> bool:
        """Take an entry off the list; False when the account shown has no such entry."""
        try:
            self._entry(entry_id)
        except UnknownEntry:
            return False
        return self._store.drop_wishlist(entry_id)
