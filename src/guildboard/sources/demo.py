"""A synthetic account for demo mode and tests. Deterministic: the same instant always yields the same data."""
from __future__ import annotations

import asyncio
import random
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Mapping

from guildboard.board.layouts import Layouts
from guildboard.characters import demo as characters_demo
from guildboard.achievements.catalog import Catalog, Stage, version_key
from guildboard.achievements.commissions import commission_stages
from guildboard.achievements.notes import AchievementNotes
from guildboard.gameday import days_inclusive, game_day, game_day_start, server_tz
from guildboard.ledger.demo import demo_diary_entries
from guildboard.pulls import ALL_POOLS, WINDOW_DAYS
from guildboard.records import (
    GROUPS,
    ArchonChapter,
    Area,
    CalendarRecord,
    CharactersRecord,
    DiaryEntry,
    DiaryMonth,
    DiaryRecord,
    DiarySource,
    EndgameMode,
    EndgameRecord,
    Expedition,
    FetchResult,
    GameAccount,
    LoginNeeded,
    NotesRecord,
    Offering,
    OverviewRecord,
    RawResponse,
    Record,
    Region,
    SourceError,
)
from guildboard.store import BannerRow, ProgressRow, PullsAccountRow, Store, WishRow, iso
from guildboard.sync.apply import apply_result
from guildboard.timers.rules import Rule
from guildboard.timers.timers import Timers

DEMO_SERVER = "os_euro"
DEMO_ACCOUNT = GameAccount(uid=700000001, nickname="Traveler", server=DEMO_SERVER, level=60)
EPOCH = date(2026, 6, 1)
SNEZHNAYA_OPENS = date(2026, 8, 12)
ACTIVE_BY = 0.6  # the fraction of a game day by which that day's activity is complete
_SEED = 7100

# The demo's achievement progress besides the rules of _done_by_rule, by stage id (a counter by its group's id).
DEMO_PINNED = (84508, 84512, 82057)
DEMO_IN_PROGRESS = (84508, 82057)
DEMO_COUNTERS = {82055: 37, 84512: 3}
DEMO_NOTES = {84508: "Little Fei is the last one."}
DEMO_PARTS = {84508: (0, 1)}
_HILICHURL = 82055          # ...Well, That Was Strange, the hilichurl group: exactly its first two stages are done
_NOT_DONE = (84508, 84512)  # Pirates! Argh! and For the Love of Godwin
_LEFT_FROM = (7, 0)         # the stages added in this version or later are left

# The demo's timers, by pre-set: how many hours before the start each was cleared. With the fishing setting's 3 days,
# Jade Field and Luhua Pool are ready, and the hilichurl, Luxuriant Glebe and Cider Lake (1) run.
DEMO_CLEARED = {
    "hilichurl": 2, "teapot.jade_field": 75, "teapot.luxuriant_glebe": 20, "fishing.luhua_pool": 96,
    "fishing.cider_lake_1": 24,
}
DEMO_READY_IN = {"teapot.orderly_meadow": 34}  # by pre-set, the hours left the game showed, given with Set ready time
# By commission achievement, the game days before today it appeared: three of Liyue's, where Settings starts, one of
# them twice. Pirates! Argh! is left, and A Nourishing Friendship and Love Is All Around are done. All's Well That Ends
# Well and Swordseeker, left too, have none, so that the cards show both.
DEMO_APPEARED = {84508: (3, 1), 84509: (2,), 84510: (1,)}
_MARKED_AT = timedelta(hours=14)  # when in its game day a day was marked: 18:00 server time

# id, parent id, name, percent at the epoch, percent gained per unit of exploring, offering, its level,
# areas as (name, offset from the region's percent)
_REGIONS = (
    (1, 0, "Mondstadt", 100.0, 0.0, "Statue of The Seven", 10, ()),
    (2, 1, "Dragonspine", 100.0, 0.0, "Frostbearing Tree", 12, ()),
    (3, 0, "Liyue", 100.0, 0.0, "Statue of The Seven", 10, ()),
    (4, 3, "The Chasm", 100.0, 0.0, "Lumenstone Adjuvant", 10, ()),
    (5, 3, "Chenyu Vale", 98.6, 0.004, "Rainjade Oblation", 10,
     (("Upper Vale", -0.9), ("Southern Mountain", 1.4), ("Mt. Laixin", 1.4))),
    (6, 0, "Inazuma", 96.4, 0.004, "Sacred Sakura's Favor", 50,
     (("Tsurumi Island", -2.0), ("Seirai Island", 3.6), ("Watatsumi Island", 3.6))),
    (7, 6, "Enkanomiya", 100.0, 0.0, "", 0, ()),
    (8, 0, "Sumeru", 91.8, 0.012, "Tree of Dreams", 50,
     (("Girdle of the Sands", -4.6), ("Desert of Hadramaveth", 3.6), ("Gavireh Lajavard", 8.2), ("Rainforest", 8.2))),
    (9, 0, "Fontaine", 100.0, 0.0, "Fountain of Lucine", 50, (("Morte Region", 0.0), ("Belleau Region", 0.0))),
    (10, 9, "Sea of Bygone Eras", 100.0, 0.0, "", 0, ()),
    (11, 0, "Natlan", 73.0, 0.05, "Reputation", 7,
     (("Ochkanatlan", -13.0), ("Atocpan", 3.0), ("Tezcatepetonco Range", 12.0), ("Ancient Sacred Mountain", 20.0))),
    (12, 0, "Nod-Krai", 62.0, 0.09, "Offering", 9, (("Hiisi Island", -11.0), ("Paha Isle", 2.0), ("Lempo Isle", 9.5))),
    (13, 0, "Snezhnaya", 0.0, 0.62, "Offering", 4,
     (("Capital district", -8.0), ("Coastal tundra", 11.0), ("Frozen north", -2.0))),
)

_SOURCES = (("Events", 0.39), ("Daily Activity", 0.245), ("Quests", 0.164), ("Spiral Abyss", 0.126), ("Mail", 0.05))

_ZERO = {
    "c0": 0.0, "c1": 0.0, "c2": 0.0, "c3": 0.0, "c4": 0.0,
    "achievements": 0.0, "explore": 0.0, "explore_new": 0.0, "luno": 0.0, "cryo": 0.0, "days": 0.0,
}


@dataclass(frozen=True)
class _Day:
    played: bool
    synced: bool
    chests: tuple[int, ...]
    achievements: int
    explore: float
    oculi: int
    primogems: int
    sessions: tuple[tuple[int, int], ...]  # (minutes after the reset, length in minutes)


@lru_cache(maxsize=None)
def _day(day: date) -> _Day:
    rng = random.Random(_SEED * 100_003 + day.toordinal())
    if rng.random() >= 0.87:
        return _Day(False, rng.random() < 0.5, (0, 0, 0, 0, 0), 0, 0.0, 0, 0, ())
    weekend = day.weekday() >= 5
    chests = [0, 0, 0, 0, 0]
    for _ in range(rng.choice((0, 0, 2, 3, 4, 5, 6, 8, 9, 11, 12, 14)) + (3 if weekend else 0)):
        roll = rng.random()
        chests[0 if roll < 0.55 else 1 if roll < 0.83 else 2 if roll < 0.95 else 3 if roll < 0.99 else 4] += 1
    achievements = rng.choice((0, 0, 0, 1, 1, 2))
    explore = rng.uniform(0.4, 1.6)
    oculi = rng.choice((0, 0, 0, 1))
    primogems = rng.choice((60, 60, 120, 180, 260, 420, 600))
    sessions = [(rng.randint(14 * 60, 17 * 60), rng.randint(20, 140))]
    if weekend and rng.random() < 0.6:
        sessions.append((rng.randint(7 * 60, 10 * 60), rng.randint(20, 140)))
    return _Day(True, True, tuple(chests), achievements, explore, oculi, primogems, tuple(sessions))


def _add(totals: dict[str, float], day: date, share: float) -> None:
    """Add `share` (0 to 1) of one day's activity to the running totals."""
    activity = _day(day)
    if not activity.played or share <= 0:
        return
    for index in range(5):
        totals[f"c{index}"] += int(activity.chests[index] * share)
    totals["achievements"] += int(activity.achievements * share)
    totals["explore"] += activity.explore * share
    totals["days"] += 1
    if day >= SNEZHNAYA_OPENS:
        totals["explore_new"] += activity.explore * share
        totals["cryo"] += int(activity.oculi * 3 * share)
    else:
        totals["luno"] += int(activity.oculi * share)


@lru_cache(maxsize=None)
def _totals_before(day: date) -> tuple[tuple[str, float], ...]:
    totals = dict(_ZERO)
    for earlier in days_inclusive(EPOCH, day - timedelta(days=1)):
        _add(totals, earlier, 1.0)
    return tuple(totals.items())


def _share(now: datetime, day: date) -> float:
    fraction = (now - game_day_start(day, DEMO_SERVER)).total_seconds() / 86_400
    return min(1.0, max(0.0, fraction / ACTIVE_BY))


def _snapshot(now: datetime) -> tuple[date, dict[str, float]]:
    day = game_day(now, DEMO_SERVER)
    if day < EPOCH:
        return EPOCH, dict(_ZERO)
    totals = dict(_totals_before(day))
    _add(totals, day, _share(now, day))
    return day, totals


def _regions(day: date, totals: Mapping[str, float]) -> list[Region]:
    regions = []
    for region_id, parent_id, name, base, gain, offering, level, areas in _REGIONS:
        if name == "Snezhnaya":
            if day < SNEZHNAYA_OPENS:
                continue
            explored = totals["explore_new"]
        else:
            explored = totals["explore"]
        pct = round(min(100.0, base + gain * explored), 1)
        region_areas = tuple(
            Area(area, 100.0 if pct >= 100.0 else round(min(100.0, max(0.0, pct + offset)), 1))
            for area, offset in areas
        )
        offerings = (Offering(offering, level),) if offering else ()
        regions.append(Region(region_id, parent_id, name, pct, "", offerings, region_areas))
    return regions


def _overview(now: datetime) -> OverviewRecord:
    day, totals = _snapshot(now)
    counters = {
        "achievements": 1240 + totals["achievements"],
        "days_active": 1700 + totals["days"],
        "characters": 96,
        "waypoints": 498 + int(totals["explore_new"] * 0.4),
        "domains": 68 + (2 if day >= SNEZHNAYA_OPENS else 0),
        "friendship10": 56 + (day - EPOCH).days // 20,
        "chests.common": 2100 + totals["c0"],
        "chests.exquisite": 1500 + totals["c1"],
        "chests.precious": 520 + totals["c2"],
        "chests.luxurious": 190 + totals["c3"],
        "chests.remarkable": 150 + totals["c4"],
        "oculi.anemo": 66,
        "oculi.geo": 131,
        "oculi.electro": 181,
        "oculi.dendro": 271,
        "oculi.hydro": 271,
        "oculi.pyro": 300,
        "oculi.luno": 150 + totals["luno"],
    }
    if day >= SNEZHNAYA_OPENS:
        counters["oculi.cryo"] = totals["cryo"]
    return OverviewRecord(
        nickname=DEMO_ACCOUNT.nickname,
        server=DEMO_SERVER,
        adventure_rank=DEMO_ACCOUNT.level,
        counters={name: float(value) for name, value in counters.items()},
        regions=tuple(_regions(day, totals)),
        abyss_progress="12-3",
    )


def _notes(now: datetime) -> NotesRecord:
    day = game_day(now, DEMO_SERVER)
    minutes = int((now - game_day_start(day, DEMO_SERVER)).total_seconds() // 60)
    resin = (40 + minutes // 8) % 201
    full_at = None if resin >= 200 else (now + timedelta(minutes=(200 - resin) * 8)).isoformat(timespec="seconds")
    return NotesRecord(
        resin=resin,
        resin_max=200,
        resin_full_at=full_at,
        realm_currency=1800,
        realm_currency_max=2400,
        commissions_done=4 if _day(day).played else 0,
        commissions_max=4,
        boss_discounts_left=1,
        boss_discounts_max=3,
        expeditions_done=3,
        expeditions_total=5,
        archon_open=(
            ArchonChapter(7102, "ongoing", "Chapter VII: Act II", "Demo chapter"),
            ArchonChapter(7103, "not_open", "Chapter VII: Act III", "Demo chapter"),
        ),
        archon_all_finished=False,
        # Three expeditions back and two out. The demo downloads no pictures, so they have none.
        expeditions=(
            Expedition("", None), Expedition("", None), Expedition("", None),
            Expedition("", _after(now, hours=2)), Expedition("", _after(now, hours=5, minutes=30)),
        ),
        expeditions_max=5,
        transformer_obtained=True,
        transformer_ready_at=_after(now, days=3, hours=4),
        realm_currency_full_at=_after(now, hours=10),
    )


def _after(now: datetime, **wait: float) -> str:
    """A time ahead of `now`, as the notes keep one."""
    return (now + timedelta(**wait)).isoformat(timespec="seconds")


def _characters(now: datetime) -> CharactersRecord:
    day = max(EPOCH, game_day(now, DEMO_SERVER))
    # The Characters pages' own: fifteen owned characters as the mockups have them, and what the calculator says for the focus.
    return CharactersRecord(
        owned=96, level90=40 + (day - EPOCH).days // 30, builds=characters_demo.demo_builds(),
        calculator=characters_demo.demo_calculator(),
    )


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def _utc_text(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def _endgame(now: datetime) -> EndgameRecord:
    tz = server_tz(DEMO_SERVER)
    local = now.astimezone(tz)
    # Spiral Abyss periods run from the 16th to the 15th.
    year, month = (local.year, local.month) if local.day >= 16 else _shift_month(local.year, local.month, -1)
    abyss_start = datetime(year, month, 16, 4, tzinfo=tz)
    end_year, end_month = _shift_month(year, month, 1)
    abyss_end = datetime(end_year, end_month, 16, 4, tzinfo=tz) - timedelta(seconds=1)
    stars = 33 + (year * 12 + month) % 4
    month_start = datetime(local.year, local.month, 1, 4, tzinfo=tz)
    next_year, next_month = _shift_month(local.year, local.month, 1)
    month_end = datetime(next_year, next_month, 1, 4, tzinfo=tz) - timedelta(seconds=1)
    act = 8 + (local.year * 12 + local.month) % 3
    difficulty = 4 + local.month % 2
    return EndgameRecord(
        (
            EndgameMode(
                "abyss", "Spiral Abyss", True, f"{stars} of 36 stars", float(stars),
                _utc_text(abyss_start), _utc_text(abyss_end), "",
            ),
            EndgameMode(
                "theater", "Imaginarium Theater", True, f"Act {act} reached", float(act),
                _utc_text(month_start), _utc_text(month_end), "",
            ),
            EndgameMode(
                "stygian", "Stygian Onslaught", True, f"Difficulty {difficulty} cleared", float(difficulty),
                _utc_text(month_start), _utc_text(month_end), f"Season {local.month}",
            ),
        ),
        detail=characters_demo.demo_endgame_detail(now, DEMO_SERVER),
    )


def _month_primogems(year: int, month: int, now: datetime) -> int:
    today = game_day(now, DEMO_SERVER)
    next_year, next_month = _shift_month(year, month, 1)
    first = max(date(year, month, 1), EPOCH)
    last = min(date(next_year, next_month, 1) - timedelta(days=1), today)
    total = 0
    for day in days_inclusive(first, last):
        earned = _day(day).primogems
        total += int(earned * _share(now, day)) if day == today else earned
    return total


def _split(total: int) -> tuple[DiarySource, ...]:
    sources, used = [], 0
    for name, part in _SOURCES:
        amount = int(total * part)
        used += amount
        sources.append(DiarySource(name, amount))
    sources.append(DiarySource("Other", total - used))
    return tuple(source for source in sorted(sources, key=lambda s: -s.amount) if source.amount > 0)


def _diary(now: datetime, first_time: bool) -> DiaryRecord:
    local = now.astimezone(server_tz(DEMO_SERVER)).date()
    wanted = sorted(_shift_month(local.year, local.month, -back) for back in range(3 if first_time else 2))
    months = []
    for year, month in wanted:
        total = _month_primogems(year, month, now)
        months.append(DiaryMonth(year, month, total, _split(total)))
    # The diary's detail of the last two game days, from the demo's own game history (the ledger design, section 0).
    entries = tuple(DiaryEntry(*entry) for entry in demo_diary_entries(DEMO_SERVER, now))
    return DiaryRecord(tuple(months), entries, DEMO_ACCOUNT.uid)


def build(group: str, now: datetime, first_time: bool = False) -> Record:
    if group == "overview":
        return _overview(now)
    if group == "notes":
        return _notes(now)
    if group == "characters":
        return _characters(now)
    if group == "endgame":
        return _endgame(now)
    if group == "diary":
        return _diary(now, first_time)
    if group == "calendar":
        return CalendarRecord(banners=4, events=5, detail=characters_demo.demo_calendar_detail(now, DEMO_SERVER))
    raise ValueError(f"unknown group: {group}")


DEMO_CHECKIN_DAYS = 11
DEMO_CHECKIN_REWARDS = (
    ("Primogem", 20), ("Mora", 5000), ("Adventurer's Experience", 3), ("Mystic Enhancement Ore", 3), ("Primogem", 20),
    ("Fine Enhancement Ore", 5), ("Mora", 10000),
)


class DemoSource:
    """The demo account as a Source. Set `fault` to make every fetch fail with that error,
    and `delay` to make every fetch take that many seconds."""

    def __init__(self) -> None:
        self.fault: SourceError | None = None
        self.delay = 0.0
        self._checkin_days = DEMO_CHECKIN_DAYS
        self._checkin_today = False

    async def fetch(self, group: str, *, now: datetime, first_time: bool = False) -> FetchResult:
        if self.delay > 0:
            await asyncio.sleep(self.delay)
        if self.fault is not None:
            raise self.fault
        record = build(group, now, first_time)
        return FetchResult(group, now, (RawResponse(f"demo/{group}", asdict(record)),), record)

    async def list_accounts(self, cookies: Mapping[str, str]) -> list[GameAccount]:
        return [DEMO_ACCOUNT]

    async def redeem(self, code: str) -> str:
        """Never called: the core refuses to redeem in the demo before it asks the source."""
        return "failed"

    async def livestream_codes(self) -> list[dict[str, Any]]:
        return [{"code": code, "primogems": primogems} for code, primogems in DEMO_LIVE_CODES]

    async def checkin_status(self) -> dict[str, Any]:
        """A made-up month. The pictures have no address, so the widget draws its signs: the demo downloads nothing."""
        return {
            "claimed_today": self._checkin_today,
            "claimed_days": self._checkin_days,
            "rewards": [
                {"name": name, "amount": amount, "icon": ""}
                for name, amount in (DEMO_CHECKIN_REWARDS[day % len(DEMO_CHECKIN_REWARDS)] for day in range(30))
            ],
        }

    async def claim_checkin(self) -> str:
        """The demo's claim, in its own memory: nothing leaves this PC."""
        self._checkin_today = True
        self._checkin_days += 1
        return "claimed"

    def can_mint(self) -> bool:
        """The demo's login can always be given its stand-in history keys."""
        return True

    async def mint_key(self, auth_appid: str) -> Any:
        """The demo's stand-in for the key HoYoverse gives the login: its own made-up link of that kind, which opens
        nothing, as the demo contacts nothing. A login fault refuses it, as HoYoverse would refuse the login."""
        if isinstance(self.fault, LoginNeeded):
            raise self.fault
        from guildboard.ledger.demo import demo_ledger_links
        from guildboard.pulls.gamecache import MintedLink
        from guildboard.pulls.importer import demo_links

        link = (demo_links() if auth_appid == "webview_gacha" else demo_ledger_links())[0]
        return MintedLink(link, DEMO_ACCOUNT.uid, DEMO_SERVER)


DEMO_LIVE_CODES = (("DEMOLIVE1", 60), ("DEMOLIVE2", 60))
DEMO_CODE_HISTORY = (("DEMOGIFT1", "redeemed", 50, 9), ("DEMOGIFT2", "redeemed", 100, 5), ("DEMOOLD", "expired", 0, 2))


def seed_codes(store: Store, now: datetime) -> None:
    """Once: the three codes the demo account's history shows, two redeemed and one expired, in the days before `now`."""
    uid = str(DEMO_ACCOUNT.uid)
    if store.gift_code_rows(uid):
        return
    with store.transaction():
        for code, result, primogems, days in DEMO_CODE_HISTORY:
            store.put_gift_code(uid, code, result, primogems, "typed", now - timedelta(days=days))


def seed_history(store: Store, now: datetime, days: int = 90) -> None:
    """Fill the store as if Guild Board had run for the `days` game days before today.

    One transaction: the history is written completely or not at all, and quickly.
    """
    today = game_day(now, DEMO_SERVER)
    first_diary = True
    with store.transaction():
        for day in days_inclusive(max(EPOCH, today - timedelta(days=days)), today - timedelta(days=1)):
            activity = _day(day)
            start = game_day_start(day, DEMO_SERVER)
            for offset, minutes in activity.sessions:
                session_id = store.open_session(start + timedelta(minutes=offset), False)
                store.touch_session(session_id, start + timedelta(minutes=offset + minutes))
            if not activity.synced:
                continue
            at = start + timedelta(hours=23)
            run_id = store.start_run("startup", at)
            for group in GROUPS:
                record = build(group, at, first_time=first_diary and group == "diary")
                result = FetchResult(group, at, (RawResponse(f"demo/{group}", asdict(record)),), record)
                apply_result(store, run_id, result, DEMO_SERVER)
                store.mark_group_ok(group, at)
            first_diary = False
            store.finish_run(run_id, at + timedelta(seconds=3), "ok")


def _done_by_rule(catalog: Catalog, stage: Stage) -> bool:
    """Whether the demo has a stage done, before its overrides. A stage added in 7.0 or later is left. Of the others,
    a stage that stands alone is done unless its id is divisible by 4, and a tiered achievement has its first
    `group % (stages + 1)` stages done."""
    if version_key(stage.version) >= _LEFT_FROM:
        return False
    stages = len(catalog.group(stage.group))
    if stages == 1:
        return stage.id % 4 != 0
    return stage.order <= stage.group % (stages + 1)


def seed_achievements(store: Store, catalog: Catalog, now: datetime) -> None:
    """Made-up progress: most achievements done, the newest left, a few started, pinned and noted.

    One transaction, which also clears the undo history: an undo must not reach back past rows it did not record.
    """
    hilichurl = [stage.id for stage in catalog.group(_HILICHURL)]
    done = {stage.id for stage in catalog.stages if _done_by_rule(catalog, stage)} | set(hilichurl[:2])
    done -= {*hilichurl[2:], *_NOT_DONE, *DEMO_IN_PROGRESS}
    rows = [
        ProgressRow(
            stage_id,
            "done" if stage_id in done else "in_progress" if stage_id in DEMO_IN_PROGRESS else "not_started",
            now if stage_id in done else None,
            stage_id in DEMO_PINNED,
            DEMO_NOTES.get(stage_id, ""),
            "demo",
            now,
        )
        for stage_id in sorted({*done, *DEMO_IN_PROGRESS, *DEMO_PINNED, *DEMO_NOTES})
    ]
    with store.transaction():
        store.put_progress(rows)
        for stage_id, parts in DEMO_PARTS.items():
            for part in parts:
                store.put_part(stage_id, part, now)
        for group_id, value in DEMO_COUNTERS.items():
            store.put_counter(group_id, value, now)
        store.clear_changes()


def seed_timers(store: Store, timers: Timers, now: datetime) -> None:
    """Made-up timers in every state: pre-sets ready, running, or on the time the game showed, and two of the player's
    own, one of them part way through its visits. A pre-set the demo needs that is not in use is added, whatever the
    defaults were.

    One transaction, which also clears the undo history, as seed_achievements does. The Cleared times are written as an
    import writes them: Timers.cleared would also count a kill of the hilichurl, which the demo's count holds already.
    """
    with store.transaction():
        in_use = {row.preset: row.id for row in store.timers() if row.preset is not None}
        for key in (*DEMO_CLEARED, *DEMO_READY_IN):
            if key not in in_use:
                in_use[key], _ = timers.add_preset(key)
        cleared = {in_use[key]: [now - timedelta(hours=hours)] for key, hours in DEMO_CLEARED.items()}
        for key, hours in DEMO_READY_IN.items():
            timers.set_ready(in_use[key], now + timedelta(hours=hours))
        transformer, _ = timers.create("Parametric Transformer", "", Rule("hours", 166), None)
        cleared[transformer] = [now - timedelta(hours=30)]
        # One visit a game day, the latest in today's whatever the hour, so it waits for the next reset: 2 of 3 done.
        shrines, _ = timers.create("Shrine visits", "", Rule("resets", 1), 3)
        latest = max(game_day_start(game_day(now, DEMO_SERVER), DEMO_SERVER), now - timedelta(hours=1))
        cleared[shrines] = [latest - timedelta(days=1), latest]
        for timer_id, times in cleared.items():
            for at in times:
                store.add_timer_event(timer_id, at, now, "demo")
        store.clear_changes()


DEMO_NOTE = "Fishing: Luhua Pool comes back on Friday."
BOARD_SEEDED = "board.demo_seeded"


def seed_board(store: Store, layouts: Layouts) -> None:
    """Once: a line in the starting Board's Notes widget, so that the Board and its pictures show one. A later start
    leaves the note as the player left it."""
    if store.meta(BOARD_SEEDED) is not None:
        return
    with store.transaction():
        layouts.put_data("start-notes", {"text": DEMO_NOTE})
        store.set_meta(BOARD_SEEDED, "1")


def seed_appearances(store: Store, catalog: Catalog, notes: AchievementNotes, now: datetime) -> None:
    """Made-up days the demo's commission achievements appeared, in the game days before today. One that the list and
    the notes do not count as a commission one is left out.

    One transaction, which also clears the undo history, as seed_achievements does.
    """
    today = game_day(now, DEMO_SERVER)
    commission = commission_stages(catalog, notes)
    with store.transaction():
        for stage_id, days_back in DEMO_APPEARED.items():
            if stage_id not in commission:
                continue
            for back in days_back:
                day = today - timedelta(days=back)
                store.put_appearance(stage_id, day, game_day_start(day, DEMO_SERVER) + _MARKED_AT, "demo")
        store.clear_changes()


PULLS_SEEDED = "pulls.demo_seeded"
FIRST_WISH_ID = 1_700_000_000_000_000_000
# The 4★ and 3★ the demo's wishes give, each named in turn.
DEMO_FOURS = (
    "Bennett", "Xingqiu", "Fischl", "Sucrose", "Ororon", "Dahlia", "Candace", "Mika", "Lan Yan", "Iansan",
    "Favonius Sword", "The Flute", "Rust", "Sacrificial Bow",
)
DEMO_FOUR_WEAPONS = ("Favonius Sword", "The Flute", "Rust", "Sacrificial Bow")
DEMO_THREES = (
    "Cool Steel", "Harbinger of Dawn", "Slingshot", "Debate Club", "Thrilling Tales of Dragon Slayers", "Skyrider Sword",
    "Raven Bow", "Ferrous Shadow", "Magic Guide", "Black Tassel", "Emerald Orb", "Bloodtainted Greatsword",
    "Sharpshooter's Oath",
)
DEMO_WEAPONS = {*DEMO_FOUR_WEAPONS, *DEMO_THREES, "Wolf's Gravestone"}
FOUR_GAPS = (9, 10, 8)  # a 4★ every 8 to 10 wishes, counted again from each 5★
DEMO_FOURS_AT = {"weapon": {10, 20}, "novice": {10}, "chronicled": set()}  # the runs whose 4★ fall where they are told
# Each run of the demo's wishes: its pool, its wishes, the 5★ that ends it (None for none), and the server times of its
# first and last wish. The character event's 5★ fall on the 77th and the 158th of its wishes.
DEMO_RUNS = (
    ("novice", 20, None, "2026-05-16 18:00:00", "2026-05-16 18:19:00"),
    ("character", 77, "Skirk", "2026-05-16 19:00:00", "2026-06-24 20:30:00"),
    ("character", 81, "Qiqi", "2026-06-25 19:00:00", "2026-09-02 21:00:00"),
    ("character", 61, None, "2026-09-03 19:00:00", "2026-10-12 21:30:00"),
    ("standard", 76, "Wolf's Gravestone", "2026-05-20 20:00:00", "2026-08-15 20:00:00"),
    ("standard", 44, None, "2026-08-16 20:00:00", "2026-10-10 20:00:00"),
    ("chronicled", 5, None, "2026-07-02 19:00:00", "2026-07-02 19:04:00"),
    ("weapon", 23, None, "2026-10-01 19:00:00", "2026-10-11 21:00:00"),
)
DEMO_POOL_TYPES = {"character": "301", "weapon": "302", "standard": "200", "chronicled": "500", "novice": "100"}
# The times above and below are the demo's at this now, the tests' and the pictures'. Seeded at another now, every one
# moves by as much (`_shift`), so that a demo started on any day has a history up to yesterday and banners running.
DEMO_PULLS_NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
DEMO_ABOUT = date(2026, 11, 11)  # the wishlist entry's day
BANNERS_START = datetime(2026, 9, 23, 5, 0, tzinfo=timezone.utc)
BANNERS_END = datetime(2026, 10, 24, 6, 0, tzinfo=timezone.utc)
DEMO_BANNERS = (  # announcement id, name, pool, featured
    (33201, "Void Star's Advent", "character", ("Skirk",)),
    (33202, "La Chanson Cerise", "character", ("Escoffier",)),
    (33203, "Epitome Invocation", "weapon", ("Azurelight", "Symphonist of Scents")),
)


def _four_counts_at(count: int) -> set[int]:
    """Where a run's 4★ fall: after 9, 10 and 8 more wishes in turn, from the run's start."""
    at, turn, fours = 0, 0, set()
    while (at := at + FOUR_GAPS[turn % len(FOUR_GAPS)]) <= count:
        fours.add(at)
        turn += 1
    return fours


def _shift(now: datetime) -> timedelta:
    """How far the seed's now is from the demo's own, in whole seconds: every seeded time moves by it."""
    return timedelta(seconds=(now - DEMO_PULLS_NOW) // timedelta(seconds=1))


def _demo_draws(shift: timedelta) -> list[tuple[str, str, str, int, datetime]]:
    """Every wish of the demo's history as (pool, gacha type, name, rank, server time), oldest first, each moved by
    `shift`."""
    tz = server_tz(DEMO_SERVER)
    draws, made = [], {pool: 0 for pool in DEMO_POOL_TYPES}
    fours_named, threes_named = {pool: 0 for pool in DEMO_POOL_TYPES}, {pool: 0 for pool in DEMO_POOL_TYPES}
    for pool, count, five, first, last in DEMO_RUNS:
        start = datetime.fromisoformat(first).replace(tzinfo=tz)
        seconds = int((datetime.fromisoformat(last).replace(tzinfo=tz) - start).total_seconds())
        fours = DEMO_FOURS_AT[pool] if pool in DEMO_FOURS_AT else _four_counts_at(count)
        for n in range(1, count + 1):
            made[pool] += 1
            if five is not None and n == count:
                rank, name = 5, five
            elif n in fours:
                names = DEMO_FOUR_WEAPONS if pool == "weapon" else ("Noelle",) if pool == "novice" else DEMO_FOURS
                rank, name = 4, names[fours_named[pool] % len(names)]
                fours_named[pool] += 1
            else:
                rank, name = 3, DEMO_THREES[threes_named[pool] % len(DEMO_THREES)]
                threes_named[pool] += 1
            gacha_type = "400" if pool == "character" and made[pool] % 10 == 0 else DEMO_POOL_TYPES[pool]
            moment = start + timedelta(seconds=seconds * (n - 1) // max(1, count - 1)) + shift
            draws.append((pool, gacha_type, name, rank, moment))
    return sorted(draws, key=lambda draw: (draw[4], ALL_POOLS.index(draw[0])))


def seed_wishes(store: Store, now: datetime) -> None:
    """Once per demo folder: the demo's made-up wish history, 387 wishes from 2026-05-16 to 2026-10-12 at the demo's own
    now (the Pulls plan, Task 5), moved with the seed's now, with one import run that finished every pool, its pity
    corrections, the charted weapon, a balance and one wishlist entry.

    The made-up player has said where the history starts (a correction of 0 and a 50/50 for every pool, for the window
    the run gives), so every pity is known: the character event reads 61 and guaranteed, Skirk a won 50/50 at 77 and
    Qiqi a lost one at 81. One transaction, as seed_timers does: the history is written completely or not at all.
    """
    if store.meta(PULLS_SEEDED) is not None:
        return
    uid = DEMO_ACCOUNT.uid
    draws = _demo_draws(_shift(now))
    # The start of the window the run gives, the corrections' own: 180 days before it, as every wish it keeps is younger.
    window = iso(now - timedelta(days=WINDOW_DAYS))
    about = DEMO_ABOUT + (game_day(now, DEMO_SERVER) - game_day(DEMO_PULLS_NOW, DEMO_SERVER))
    with store.transaction():
        run = store.start_wish_import(now)
        store.add_wishes(
            WishRow(
                FIRST_WISH_ID + n, uid, gacha_type, pool, name, "Weapon" if name in DEMO_WEAPONS else "Character", rank,
                moment.strftime("%Y-%m-%d %H:%M:%S"), moment.astimezone(timezone.utc), run,
            )
            for n, (pool, gacha_type, name, rank, moment) in enumerate(draws, start=1)
        )
        store.finish_wish_import(run, now, "ok", uid, len(draws), 20, None, ALL_POOLS)
        corrections = {pool: {"pity": 0, "guaranteed": False, "from": window} for pool in ALL_POOLS}
        # The made-up player has the Blessing of the Welkin Moon, and not the Gnostic Hymn.
        store.put_pulls_account(PullsAccountRow(uid, "Azurelight", "", 9840, 14, now, corrections, {}, welkin=True))
        store.add_wishlist(uid, "Citlali", "character", about, 1, now)
        store.set_meta(PULLS_SEEDED, "1")


def seed_banners(store: Store, now: datetime) -> None:
    """The demo's banners, while none are kept: the two character banners and the weapon banner of 2026-09-23, which
    end on 2026-10-24 at the demo's own now, moved with the seed's now. The demo downloads nothing, so they have no art;
    the page draws the sign. One transaction."""
    if store.banners():
        return
    shift = _shift(now)
    store.replace_banners(
        BannerRow(ann_id, name, pool, featured, "", BANNERS_START + shift, BANNERS_END + shift, now)
        for ann_id, name, pool, featured in DEMO_BANNERS
    )
