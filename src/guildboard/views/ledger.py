"""The Ledger page's model (the ledger design, sections 0 and 6): what was spent, this month's primogems in and out,
the last 30 days' artifacts, and each kind's history, newest first. Every figure comes from the game's own history
logs kept in the store; only the prices are estimates, from the price list and the player's corrections."""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any

from guildboard.config import Settings
from guildboard.gameday import game_day_start
from guildboard.ledger import KINDS
from guildboard.ledger.reasons import (
    BOUGHT, DEFAULT_PRICES, PACK_IDS, PACKS, SHOP, domain_of, domain_runs, fates_bought, gnostic_hymns, group_of,
    pack_of,
)
from guildboard.store import LedgerRow, Store, iso

TYPICAL_PER_RUN = 1.07  # five-star artifacts a domain run gives, about, on average
ARTIFACT_DAYS = 30
FED = ("Artifact enhancement material", "Artifact decomposition")
TOP_OUT = 2  # the largest spends this month, named under the tile
_SECOND = timedelta(seconds=1)


def _price(settings: Settings, currency: str, pack: str) -> float:
    return settings.spending_prices.get(currency, {}).get(pack, DEFAULT_PRICES[currency][pack])


def _currency(settings: Settings) -> str:
    return settings.spending_currency if settings.spending_currency in DEFAULT_PRICES else "PLN"


def _packs(store: Store, uid: int | None, first: date | None, last: date | None) -> tuple[Counter[str], list[str]]:
    """How many of each pack the game's logs show, from the day `first` to the day `last` by the server's own text for
    each entry, or all of them; and the days they were bought."""
    counts: Counter[str] = Counter()
    days: list[str] = []

    def within(row: LedgerRow) -> bool:
        return (first is None or row.time[:10] >= first.isoformat()) and (last is None or row.time[:10] <= last.isoformat())

    if uid is not None:
        for row in store.ledger_entries(uid, "crystal"):
            pack = pack_of(row.amount, row.reason)
            if pack is not None and within(row):
                counts[pack.id] += 1
                days.append(row.time[:10])
        for row in store.ledger_entries(uid, "primogem"):
            if (hymns := gnostic_hymns(row.reason, row.amount)) and within(row):
                counts["gnostic_hymn"] += hymns
                days.append(row.time[:10])
    return counts, days


def spent_in(store: Store, uid: int | None, settings: Settings, first: date, last: date) -> tuple[float, str]:
    """What the packs bought from the day `first` to the day `last` came to, by the price list, and in which currency."""
    currency = _currency(settings)
    counts, _ = _packs(store, uid, first, last)
    return round(sum(_price(settings, currency, pack) * count for pack, count in counts.items()), 2), currency


def _spent(store: Store, uid: int | None, settings: Settings) -> dict[str, Any]:
    currency = _currency(settings)
    counts, days = _packs(store, uid, None, None)
    rows = []
    for pack in PACK_IDS:
        if counts[pack]:
            each = _price(settings, currency, pack)
            rows.append({
                "id": pack, "label": PACKS[pack].label, "count": counts[pack], "each": each,
                "total": round(each * counts[pack], 2),
            })
    return {
        "currency": currency,
        "total": round(sum(row["total"] for row in rows), 2),
        "since": min(days) if days else None,
        "welkins": counts["welkin"],
        "packs": sum(count for pack, count in counts.items() if pack not in ("welkin", "gnostic_hymn")),
        "gnostic_hymns": counts["gnostic_hymn"],
        "rows": rows,
    }


def _out_label(reason: str, amount: int) -> str:
    """A short name for what primogems were spent on."""
    if reason == SHOP and fates_bought(reason, amount):
        return "Intertwined Fates"
    if "resin" in reason.casefold():
        return "Resin"
    return reason


def _month(store: Store, uid: int | None, server: str, today: date) -> dict[str, Any]:
    earned = bought = out = 0
    spends: Counter[str] = Counter()
    if uid is not None:
        since = game_day_start(today.replace(day=1), server) - _SECOND
        for row in store.ledger_entries(uid, "primogem", since=since):
            if row.amount < 0:
                out -= row.amount
                spends[_out_label(row.reason, row.amount)] -= row.amount
            elif group_of(row.reason) == BOUGHT:
                bought += row.amount
            else:
                earned += row.amount
    top = sorted(spends.items(), key=lambda item: (-item[1], item[0]))[:TOP_OUT]
    return {
        "earned": earned, "bought": bought, "out": out,
        "top_out": [{"label": label, "amount": amount} for label, amount in top],
    }


def _artifacts(store: Store, uid: int | None, server: str, today: date) -> dict[str, Any]:
    five_domain = five_other = four_other = fed = fed_five = runs = 0
    fives: Counter[str] = Counter()
    artifact_domains: set[str] = set()
    if uid is not None:
        since = game_day_start(today - timedelta(days=ARTIFACT_DAYS - 1), server) - _SECOND
        for row in store.ledger_entries(uid, "artifact", since=since):
            domain = domain_of(row.reason)
            if row.amount > 0:
                if domain is not None:
                    artifact_domains.add(domain)
                    if row.rarity == 5:
                        five_domain += 1
                        fives[domain] += 1
                elif row.rarity == 5:
                    five_other += 1
                elif row.rarity == 4:
                    four_other += 1
            elif row.reason in FED:
                fed += 1
                fed_five += row.rarity == 5
        # The runs of the domains that gave artifacts: a talent or weapon domain's runs give none, and are left out.
        for row in store.ledger_entries(uid, "resin", since=since):
            if domain_of(row.reason) in artifact_domains:
                runs += domain_runs(row.reason, row.amount)
    top = fives.most_common(1)
    return {
        "five_domain": five_domain,
        "top_domain": top[0][0] if top else None,
        "five_other": five_other,
        "four_other": four_other,
        "fed": fed,
        "fed_five": fed_five,
        "per_run": round(five_domain / runs, 2) if runs else None,
        "typical": TYPICAL_PER_RUN,
        "runs": runs,
    }


def build_ledger(
    store: Store, uid: int | None, server: str, today: date, settings: Settings, import_state: dict[str, Any]
) -> dict[str, Any]:
    """`GET /api/ledger`: the account's figures; `import` is the importer's state with its ledger block."""
    last = store.last_ledger_import(uid) if uid is not None else None
    empty = uid is None or all(store.newest_ledger_entry(uid, kind) is None for kind in KINDS)
    return {
        "uid": uid,
        "last_import": iso(last) if last is not None else None,
        "import": import_state,
        "spent": _spent(store, uid, settings),
        "month": _month(store, uid, server, today),
        "artifacts": _artifacts(store, uid, server, today),
        "empty": empty,
        # The price list Settings › Extras corrects: each pack's name and its default in each currency.
        "prices": {
            "packs": [{"id": pack, "label": PACKS[pack].label} for pack in PACK_IDS],
            "defaults": DEFAULT_PRICES,
        },
    }


def build_history(store: Store, uid: int | None, kind: str, before: int | None, limit: int) -> dict[str, Any]:
    """`GET /api/ledger/history`: up to `limit` entries of a kind, newest first, older than the entry `before`. Ids are
    text: the game's are past what a number in the page holds exactly."""
    rows = store.ledger_entries(uid, kind, before_id=before, limit=limit + 1) if uid is not None else []
    return {
        "entries": [
            {"id": str(row.id), "time": row.time, "reason": row.reason, "name": row.name, "rarity": row.rarity,
             "amount": row.amount}
            for row in rows[:limit]
        ],
        "more": len(rows) > limit,
    }
