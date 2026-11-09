"""The Ledger page's model (the ledger design, sections 0 and 6; the revamp design, sections 4 and 5): what was spent,
each day of the last six months with its balance, this month's primogems in and out and from where, the commissions'
calendar, the wishes, the last 30 days' artifacts, and each kind's history, newest first. Every figure comes from the
game's own history logs kept in the store, or from Pulls (the balance, the wishes in hand and the pity, which the caller
gives); only the prices are estimates, from the price list and the player's corrections."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Mapping

from guildboard.config import Settings
from guildboard.gameday import days_inclusive, game_day, game_day_start
from guildboard.ledger import KINDS, balances, income
from guildboard.ledger.reasons import (
    BOUGHT, DEFAULT_PRICES, FATE_PRIMOGEMS, GROUP_LABELS, GROUPS, PACK_IDS, PACKS, SHOP, WELKIN_BOUGHT, artifact_source,
    crystal_source, domain_of, domain_runs, fates_bought, gnostic_hymns, group_of, pack_of, plain_title, resin_use,
    source_of,
)
from guildboard.pulls.rules import Wish
from guildboard.store import LedgerRow, Store, iso
from guildboard.views.pulls import wish_kind, wish_months

if TYPE_CHECKING:
    from guildboard.pulls.savings import Estimate

TYPICAL_PER_RUN = 1.07  # five-star artifacts a domain run gives, about, on average
ARTIFACT_DAYS = 30
FED = ("Artifact enhancement material", "Artifact decomposition")
TOP_OUT = 2  # the largest spends this month, named under the tile
_SECOND = timedelta(seconds=1)
MONTHS_SHOWN = 6  # the calendar months the days run over, this one included
MOMENT = 300  # an entry of this many primogems or more, in or out, is a big moment of its day
_NUMBERS = ("no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


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


def _phrase(count: int, one: str, many: str) -> str:
    return f"{_NUMBERS[count] if count < len(_NUMBERS) else count} {one if count == 1 else many}"


def _month_note(counts: Counter[str]) -> str:
    """What this month's packs were, in words: "one Welkin", "one Welkin and two crystal packs", or "nothing"."""
    packs = sum(count for pack, count in counts.items() if pack not in ("welkin", "gnostic_hymn"))
    parts = [
        _phrase(count, one, many)
        for count, one, many in (
            (counts["welkin"], "Welkin", "Welkins"), (packs, "crystal pack", "crystal packs"),
            (counts["gnostic_hymn"], "Gnostic Hymn", "Gnostic Hymns"),
        )
        if count
    ]
    if not parts:
        return "nothing"
    return parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} and {parts[-1]}"


def _spent(store: Store, uid: int | None, settings: Settings, today: date) -> dict[str, Any]:
    currency = _currency(settings)
    counts, days = _packs(store, uid, None, None)
    month_counts, _ = _packs(store, uid, today.replace(day=1), today)
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
        "month_total": round(sum(_price(settings, currency, pack) * count for pack, count in month_counts.items()), 2),
        "month_note": _month_note(month_counts),
    }


def _out_label(reason: str, amount: int) -> str:
    """A short name for what primogems were spent on."""
    if reason == SHOP and fates_bought(reason, amount):
        return "Intertwined Fates"
    if "resin" in reason.casefold():
        return "Resin"
    return reason


def _first_of_month(day: date, back: int = 0) -> date:
    """The first day of the calendar month `back` months before the one `day` is in."""
    first = day.replace(day=1)
    for _ in range(back):
        first = (first - timedelta(days=1)).replace(day=1)
    return first


def _month(
    store: Store, uid: int | None, server: str, today: date, exact: Mapping[date, Mapping[str, int]]
) -> dict[str, Any]:
    bought = out = fates = 0
    spends: Counter[str] = Counter()
    if uid is not None:
        since = game_day_start(today.replace(day=1), server) - _SECOND
        for row in store.ledger_entries(uid, "primogem", since=since):
            if row.amount < 0:
                out -= row.amount
                spends[_out_label(row.reason, row.amount)] -= row.amount
                fates += fates_bought(row.reason, row.amount)
            elif group_of(row.reason) == BOUGHT:
                bought += row.amount
    # What was earned is the days' own, as Stats and Pulls sum them (`income.earned_by_day`): the log's whole days and the
    # diary's detail for the days it alone covers, so that the days add up to the month.
    sources: Counter[str] = Counter()
    for day, groups in exact.items():
        if day.replace(day=1) == today.replace(day=1):
            sources.update(groups)
    earned = sum(sources.values())
    top = sorted(spends.items(), key=lambda item: (-item[1], item[0]))[:TOP_OUT]
    # The same days of last month, from the days the log or the diary knows (a short month ends where it ends).
    last_first = _first_of_month(today, 1)
    length = (today.replace(day=1) - last_first).days
    last_end = last_first + timedelta(days=min(today.day, length) - 1)
    before = {group: 0 for group in GROUPS}
    for day, groups in exact.items():
        if last_first <= day <= last_end:
            for group, amount in groups.items():
                before[group] += amount
    return {
        "earned": earned, "bought": bought, "out": out,
        "top_out": [{"label": label, "amount": amount} for label, amount in top],
        "sources": [
            {"group": group, "label": GROUP_LABELS[group], "amount": sources[group]}
            for group in sorted((g for g in GROUPS if sources[g] > 0), key=lambda g: -sources[g])
        ],
        "previous": {"earned": sum(before.values()), "sources": before},
        "fates_bought": fates,
    }


def _days(
    store: Store, uid: int | None, server: str, today: date, exact: Mapping[date, Mapping[str, int]],
    estimate: Estimate | None,
) -> list[dict[str, Any]]:
    """Each game day of the last six calendar months to today: what came in and went out, the balance at its end, and
    its big moments. A day neither the game's log nor the diary covers is not known: it holds nothing."""
    first = _first_of_month(today, MONTHS_SHOWN - 1)
    spent: dict[date, int] = defaultdict(int)
    moments: dict[date, list[dict[str, Any]]] = defaultdict(list)
    if uid is not None:
        rows = store.ledger_entries(uid, "primogem", since=game_day_start(first, server) - _SECOND)
        for row in sorted(rows, key=lambda r: (r.at, r.id)):
            day = game_day(row.at, server)
            if day not in exact or day > today:
                continue
            if row.amount < 0:
                spent[day] -= row.amount
            if abs(row.amount) >= MOMENT:
                moments[day].append({"title": plain_title(row.reason), "amount": row.amount})
    days = days_inclusive(first, today)
    held = balances.held_by_day("primogem", days, store=store, uid=uid, server=server, today=today, estimate=estimate)
    return [
        {
            "day": day.isoformat(),
            "earned": sum(exact[day].values()) if day in exact else 0,
            "spent": spent[day],
            "held": held.get(day) if held is not None else None,
            "known": day in exact,
            "moments": moments[day],
        }
        for day in days
    ]



def _span(store: Store, uid: int, server: str, kind: str) -> tuple[date, date] | None:
    """The game days a kind's log covers whole: from the day after its oldest entry's game day (that day is cut part-way,
    as the log starts mid-day) to the game day of its own newest entry, as Stats counts the resin: a log whose import
    stopped earlier than another's does not say what happened after."""
    oldest, newest = store.oldest_ledger_entry(uid, kind), store.newest_ledger_entry(uid, kind)
    if oldest is None or newest is None:
        return None
    first, last = game_day(oldest.at, server) + timedelta(days=1), game_day(newest.at, server)
    return (first, last) if first <= last else None


def _kind_days(
    store: Store, uid: int | None, server: str, today: date, kind: str
) -> tuple[list[date], set[date], list[LedgerRow]]:
    """The six months of game days to today, the ones of them the kind's log covers whole, and its entries on those days
    (oldest first)."""
    days = days_inclusive(_first_of_month(today, MONTHS_SHOWN - 1), today)
    span = _span(store, uid, server, kind) if uid is not None else None
    if span is None or uid is None:
        return days, set(), []
    known = {day for day in days if span[0] <= day <= span[1]}
    rows = store.ledger_entries(uid, kind, since=game_day_start(days[0], server) - _SECOND)
    return days, known, [row for row in sorted(rows, key=lambda r: (r.at, r.id)) if game_day(row.at, server) in known]


def _crystal_days(
    store: Store, uid: int | None, server: str, today: date, estimate: Estimate | None
) -> list[dict[str, Any]]:
    """Each game day's crystals: what was bought (`welkin` of it the Welkin Moon's), and what was spent, by where it went
    (`exchange` for primogems, `shop`), and `held`, the balance at the day's end where one is known. None keep one today
    (the design, 8a): the page then draws what came and went, and a balance typed for the crystals later answers through
    `balances.held_by_day`, which changes the view to "held" with nothing else changed."""
    days, known, rows = _kind_days(store, uid, server, today, "crystal")
    held = balances.held_by_day("crystal", days, store=store, uid=uid, server=server, today=today, estimate=estimate)
    bought: dict[date, int] = defaultdict(int)
    welkin: dict[date, int] = defaultdict(int)
    uses: dict[date, Counter[str]] = defaultdict(Counter)
    for row in rows:
        day = game_day(row.at, server)
        source = crystal_source(row.reason, row.amount)
        if source == "bought":
            bought[day] += row.amount
            if row.reason == WELKIN_BOUGHT:
                welkin[day] += row.amount
        elif row.amount < 0:
            uses[day][source] -= row.amount
    return [
        {
            "day": day.isoformat(), "known": day in known, "bought": bought[day], "welkin": welkin[day],
            "spent": sum(uses[day].values()), "by_use": dict(uses[day]),
            "held": held.get(day) if held is not None else None,
        }
        for day in days
    ]


def _resin_days(store: Store, uid: int | None, server: str, today: date) -> list[dict[str, Any]]:
    """Each game day's resin spent, by use (domains, ley lines, bosses, weekly bosses, condensed) and the runs of each. The
    resin keeps no balance either."""
    days, known, rows = _kind_days(store, uid, server, today, "resin")
    uses: dict[date, Counter[str]] = defaultdict(Counter)
    runs: dict[date, Counter[str]] = defaultdict(Counter)
    for row in rows:
        if row.amount >= 0:
            continue
        day, use = game_day(row.at, server), resin_use(row.reason, row.amount)
        uses[day][use] -= row.amount
        runs[day][use] += (domain_runs(row.reason, row.amount) or 1) if use == "domain" else 1
    return [
        {
            "day": day.isoformat(), "known": day in known, "spent": sum(uses[day].values()),
            "by_use": dict(uses[day]), "runs": dict(runs[day]),
        }
        for day in days
    ]


def _artifact_days(store: Store, uid: int | None, server: str, today: date) -> list[dict[str, Any]]:
    """Each game day's five-star artifacts: from domains, from elsewhere, and fed to enhance others or salvaged, with the
    names of those that came in."""
    days, known, rows = _kind_days(store, uid, server, today, "artifact")
    count: dict[date, Counter[str]] = defaultdict(Counter)
    names: dict[date, list[str]] = defaultdict(list)
    for row in rows:
        if row.rarity != 5:
            continue
        day, source = game_day(row.at, server), artifact_source(row.reason, row.amount)
        if source in ("domain", "elsewhere", "fed", "salvaged"):
            count[day][source] += 1
        if row.amount > 0:
            names[day].append(row.name)
    return [
        {
            "day": day.isoformat(), "known": day in known, "five_domain": count[day]["domain"],
            "five_other": count[day]["elsewhere"], "fed": count[day]["fed"], "salvaged": count[day]["salvaged"],
            "names": names[day],
        }
        for day in days
    ]


WELKIN_DAYS = 30  # a Welkin Moon pays for 30 days; the game adds one bought while another runs after it
WELKIN_LOOKBACK = 180  # the most the game lets stack


def _welkin(store: Store, uid: int, server: str, today: date) -> dict[str, Any] | None:
    """The Welkin Moon running today, from the purchases of the last 180 days taken oldest first: each adds 30 days to the end
    of the one before it when that has not run out, else starts at its own day. {"start", "end", "days"} of the block that
    covers today (its first day, its last, and how many in all), or None when none does."""
    since = game_day_start(today - timedelta(days=WELKIN_LOOKBACK - 1), server) - _SECOND
    bought = sorted(
        game_day(row.at, server) for row in store.ledger_entries(uid, "crystal", since=since)
        if row.reason == WELKIN_BOUGHT and row.amount > 0 and game_day(row.at, server) <= today
    )
    start = end = None
    for day in bought:
        if end is None or end < day - timedelta(days=1):  # none running the day before: this one starts a block
            start, end = day, day - timedelta(days=1)
        end += timedelta(days=WELKIN_DAYS)
    if start is None or end is None or end < today:
        return None
    return {"start": start.isoformat(), "end": end.isoformat(), "days": (end - start).days + 1}


def _crystal_month(store: Store, uid: int | None, server: str, today: date) -> dict[str, Any]:
    """The Welkin Moon running (`_welkin`), and this month's packs."""
    packs: list[dict[str, str]] = []
    welkin = None
    if uid is not None:
        welkin = _welkin(store, uid, server, today)
        for row in _month_rows(store, uid, server, today, "crystal"):
            pack = pack_of(row.amount, row.reason)
            if pack is not None and pack.id not in ("welkin", "gnostic_hymn"):
                packs.append({"day": game_day(row.at, server).isoformat(), "label": pack.label})
    return {"welkin": welkin, "packs": packs}


def _month_rows(store: Store, uid: int | None, server: str, today: date, kind: str) -> list[LedgerRow]:
    """This calendar month's entries of a kind, oldest first, on the game days up to today."""
    if uid is None:
        return []
    first = today.replace(day=1)
    rows = store.ledger_entries(uid, kind, since=game_day_start(first, server) - _SECOND)
    return [row for row in reversed(rows) if first <= game_day(row.at, server) <= today]


def _resin_month(store: Store, uid: int | None, server: str, today: date) -> dict[str, Any]:
    """This month's domain runs by domain (and which of them give artifacts), and the weekly bosses at 30 and at 60."""
    runs: Counter[str] = Counter()
    artifact_domains = {
        domain for row in _month_rows(store, uid, server, today, "artifact")
        if row.amount > 0 and (domain := domain_of(row.reason)) is not None
    }
    weekly: Counter[str] = Counter()
    for row in _month_rows(store, uid, server, today, "resin"):
        if row.amount >= 0:
            continue
        use = resin_use(row.reason, row.amount)
        if use == "domain" and (domain := domain_of(row.reason)) is not None:
            runs[domain] += domain_runs(row.reason, row.amount) or 1
        elif use == "weekly":
            weekly["cheap" if row.amount == -30 else "full" if row.amount == -60 else "other"] += 1
    ordered = sorted(runs.items(), key=lambda item: (-item[1], item[0]))
    return {
        "domains": [{"name": name, "runs": count, "artifacts": name in artifact_domains} for name, count in ordered],
        "domain_runs": sum(runs.values()),
        "artifact_runs": sum(count for name, count in runs.items() if name in artifact_domains),
        "weekly": {"cheap": weekly["cheap"], "full": weekly["full"], "other": weekly["other"]},
    }


def _artifact_month(store: Store, uid: int | None, server: str, today: date) -> dict[str, Any]:
    """This month's artifact domains, each with its five-stars and its runs, the five-stars per run, and a typical run's."""
    fives: Counter[str] = Counter()
    domains: set[str] = set()
    for row in _month_rows(store, uid, server, today, "artifact"):
        if row.amount > 0 and (domain := domain_of(row.reason)) is not None:
            domains.add(domain)
            if row.rarity == 5:
                fives[domain] += 1
    runs: Counter[str] = Counter()
    for row in _month_rows(store, uid, server, today, "resin"):
        domain = domain_of(row.reason)
        if row.amount < 0 and domain in domains and resin_use(row.reason, row.amount) == "domain":
            runs[str(domain)] += domain_runs(row.reason, row.amount) or 1
    ordered = sorted(domains, key=lambda name: (-fives[name], -runs[name], name))
    total, five = sum(runs.values()), sum(fives.values())
    return {
        "domains": [{"name": name, "five": fives[name], "runs": runs[name]} for name in ordered],
        "runs": total,
        "five_domain": five,
        "per_run": round(five / total, 2) if total else None,
        "typical": TYPICAL_PER_RUN,
    }


def _commissions(exact: Mapping[date, Mapping[str, int]], today: date) -> dict[str, Any]:
    """The month's commissions, a day each: done, missed (a day the log or the diary knows, with none), unknown, or
    future. Today with none yet is unknown, not missed. The streak and the longest run are counted over the six months of
    days, and a day not known ends a run."""
    state: dict[date, str] = {}
    for day in days_inclusive(_first_of_month(today, MONTHS_SHOWN - 1), today):
        groups = exact.get(day)
        if groups is None:
            state[day] = "unknown"
        elif groups["commissions"] > 0:
            state[day] = "done"
        else:
            state[day] = "unknown" if day == today else "missed"
    run = longest = 0
    for day, kind in state.items():
        if kind == "done":
            run += 1
            longest = max(longest, run)
        elif day != today:
            run = 0
    month_first = today.replace(day=1)
    month_last = (month_first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    days = [
        {"day": day.isoformat(), "state": state[day] if day <= today else "future"}
        for day in days_inclusive(month_first, month_last)
    ]
    return {
        "month": f"{today.year:04d}-{today.month:02d}",
        "days": days,
        "streak_now": run,
        "longest": longest,
        "missed": sum(1 for day in days if day["state"] == "missed"),
    }


def _wishes(
    store: Store, uid: int | None, server: str, today: date, earned: int, estimate: Estimate | None,
    pity: Mapping[str, int] | None,
) -> dict[str, Any]:
    """The month's wishes: what its primogems make, the wishes made in every banner, and Pulls' own figures for the
    wishes in hand and the character banner's pity."""
    made = 0
    if uid is not None:
        # The month is the server's calendar month, as Pulls' own wishes each month counts it (`wish_months`).
        by_pool: dict[str, list[Wish]] = defaultdict(list)
        for row in store.wishes(uid):
            by_pool[row.pool].append(
                Wish(row.id, row.pool, row.gacha_type, row.name, wish_kind(row.item_type), row.rank, row.at, row.import_id)
            )
        this = f"{today.year:04d}-{today.month:02d}"
        made = sum(
            sum(count for column, count in entry.items() if column != "month")
            for entry in wish_months(by_pool, today, server) if entry["month"] == this
        )
    return {
        "earned": earned // FATE_PRIMOGEMS,
        "made": made,
        "in_hand": estimate.pulls if estimate is not None else None,
        "pity": {"now": pity["now"], "soft": pity["soft"], "hard": pity["hard"]} if pity is not None else None,
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
    store: Store, uid: int | None, server: str, today: date, settings: Settings, import_state: dict[str, Any],
    *, estimate: Estimate | None = None, pity: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    """`GET /api/ledger`: the account's figures; `import` is the importer's state with its ledger block. `estimate` is
    Pulls' balance moved on to now and `pity` the character banner's ({"now", "soft", "hard"}): Pulls' own, taken as they
    are and None while Pulls has none."""
    last = store.last_ledger_import(uid) if uid is not None else None
    empty = uid is None or all(store.newest_ledger_entry(uid, kind) is None for kind in KINDS)
    exact = (
        income.earned_by_day(store, uid, server, _first_of_month(today, MONTHS_SHOWN - 1), today)
        if uid is not None else {}
    )
    month = _month(store, uid, server, today, exact)
    return {
        "uid": uid,
        "last_import": iso(last) if last is not None else None,
        "import": import_state,
        "spent": _spent(store, uid, settings, today),
        "month": month,
        "days": _days(store, uid, server, today, exact, estimate),
        "commissions": _commissions(exact, today),
        "wishes": _wishes(store, uid, server, today, month["earned"], estimate, pity),
        "artifacts": _artifacts(store, uid, server, today),
        # The other three views (the revamp design, section 6): each day of the same six months, and the month's detail.
        "crystal_days": _crystal_days(store, uid, server, today, estimate),
        "resin_days": _resin_days(store, uid, server, today),
        "artifact_days": _artifact_days(store, uid, server, today),
        "crystal_month": _crystal_month(store, uid, server, today),
        "resin_month": _resin_month(store, uid, server, today),
        "artifact_month": _artifact_month(store, uid, server, today),
        "empty": empty,
        # The price list Settings › Extras corrects: each pack's name and its default in each currency.
        "prices": {
            "packs": [{"id": pack, "label": PACKS[pack].label} for pack in PACK_IDS],
            "defaults": DEFAULT_PRICES,
        },
    }


def _detail(kind: str, row: LedgerRow) -> str:
    """What more a row says: the pack a crystal top-up bought ("980 + 110 Genesis Crystals"); empty for any other."""
    if kind == "crystal" and (pack := pack_of(row.amount, row.reason)) is not None and pack.id != "welkin":
        return pack.label
    return ""


def build_history(
    store: Store, uid: int | None, kind: str, before: int | None, limit: int, rank: int = 0, *, server: str
) -> dict[str, Any]:
    """`GET /api/ledger/history`: up to `limit` entries of a kind, newest first, older than the entry `before`, of `rank`
    stars and up when it is given, and then the rest of the game day the last of them is on, so that a page ends at a day's
    edge and the day it ends on is whole: its net and its folded chests are the day's own, as the chart's. Ids are text: the
    game's are past what a number in the page holds exactly."""
    rows = (
        store.ledger_entries(uid, kind, before_id=before, limit=limit + 1, min_rarity=rank) if uid is not None else []
    )
    kept, more = rows[:limit], len(rows) > limit
    if more and uid is not None:
        edge = game_day(kept[-1].at, server)
        while more:
            batch = store.ledger_entries(uid, kind, before_id=kept[-1].id, limit=100, min_rarity=rank)
            taken = 0
            for row in batch:
                if game_day(row.at, server) != edge:
                    break
                kept.append(row)
                taken += 1
            if taken < len(batch):  # a row of an earlier day follows: this day is whole and there is more
                break
            more = bool(batch)  # a batch all of this day: read on, until the log ends
    return {
        "entries": [
            {"id": str(row.id), "time": row.time, "reason": row.reason, "name": row.name, "rarity": row.rarity,
             "amount": row.amount, "title": plain_title(row.reason), "source": source_of(row.reason, row.amount, kind),
             "detail": _detail(kind, row)}
            for row in kept
        ],
        "more": more,
    }
