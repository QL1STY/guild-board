"""The demo's Characters (the Characters plan, Task V3): fifteen owned characters with the mockups' names, elements and weapon
types, their cards, builds and wiki entries, a focus of four, and the endgame and calendar records of a month. Sandrone's build
is the mockups' exactly; the others' are made to stand about as ready as the mockups show them.

It is apart from the researched cards (the plan's call 1): research can never move the demo's numbers. It bundles no picture of the game's (`pictures.json`
keeps each one's key and address, for a later website); the art cache serves none in the demo, whose pages show the drawn signs.
Nothing here reaches the internet; the wiki's entries are kept in the store from `wiki.json`, and the cards are `cards.json`."""
from __future__ import annotations

import dataclasses
import json
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from guildboard.characters import bridge, needs, reference
from guildboard.characters.models import Card
from guildboard.endgame_cycles import cycle_row
from guildboard.gameday import game_day, game_day_start, server_tz
from guildboard.records import (
    AbyssHalfRecord, BuildRecord, BuildsRecord, CalcItemRecord, CalculatorRecord, CalendarDetailRecord, EndgameDetailRecord,
    EnemyRecord, PieceRecord, PropRecord, RankRecord, SkillRecord, StygianBossRecord, SubRecord, WeaponRecord,
)
from guildboard.store import EndgameCycleRow, Store, WikiEntryRow, iso, parse_iso

FOLDER = Path(__file__).parent


@lru_cache(maxsize=1)
def _stories() -> dict[str, list[dict[str, Any]]]:
    return json.loads((FOLDER / "stories.json").read_text(encoding="utf-8"))


def pity_story(key: str) -> list[dict[str, Any]]:
    """The copies of a 5-star character the demo's story gives her, oldest first, as `Profile.pity` has them. The demo's wish
    history (the Pulls page's, whose numbers the Pulls tests and pictures pin) holds none of the characters the mockups show, so
    the Story pane and the pity pill would be empty without these; they are not wishes, and the Pulls page never shows them."""
    return [dict(entry) for entry in _stories().get(key, [])]


FOCUS = ("sandrone", "odette", "alyosha", "jahoda")
SEEDED = "characters_demo_seeded"
DAY_RESIN = (200, 200, 3)   # a demo day begins with full resin and the three weekly discounts, as the mockups' week does
# What the focus plans: where each differs from the card's default (the mockup's week), as (level, talents).
PLANS = {
    "odette": (90, {"normal": 8, "skill": 9, "burst": 9}),
    "alyosha": (80, {"normal": 6, "skill": 6, "burst": 6}),
    "jahoda": (75, {"normal": 7, "skill": 8, "burst": 7}),
}
PLENTY = 9_999_999
THEATER_TEXT = "Characters of Cryo, Electro and Anemo are boosted this month."
SECOND_HALF = ("sandrone", "ineffa", "lan-yan", "jahoda")   # the second half of floor 12, where a star was lost


def _read(name: str) -> Any:
    return json.loads((FOLDER / name).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _cards() -> dict[str, Card]:
    stars = reference.load_stars()
    return {key: reference.parse_card(raw, stars.get(key)) for key, raw in _read("cards.json").items()}


def demo_card(key: str) -> Card | None:
    """The demo's card for one of its characters; None for any other."""
    return _cards().get(key)


@lru_cache(maxsize=1)
def demo_builds() -> BuildsRecord:
    """The fifteen builds, as HoYoLAB's records."""
    records = []
    for raw in _read("builds.json")["builds"]:
        pieces = tuple(
            PieceRecord(**{**piece, "subs": tuple(SubRecord(**sub) for sub in piece["subs"])}) for piece in raw["pieces"]
        )
        records.append(BuildRecord(**{
            **raw, "weapon": WeaponRecord(**raw["weapon"]), "pieces": pieces,
            "skills": tuple(SkillRecord(**skill) for skill in raw["skills"]),
            "props": tuple(PropRecord(**prop) for prop in raw["props"]),
        }))
    return BuildsRecord(tuple(records), {})


def _ids() -> dict[str, int]:
    return {bridge.slug(record.name): record.id for record in demo_builds().builds}


def demo_calculator() -> CalculatorRecord:
    """What the batch calculator says for the focus: with sync on, how many of each material are missing."""
    ids = _ids()
    item = iter(range(1, 100))
    make = lambda name, amount, lacking: CalcItemRecord(next(item), name, "", amount, lacking)   # noqa: E731
    items = {
        ids["sandrone"]: (
            make("Philosophies of Vagrancy", 16, 6), make("Precision Drive Shaft", 12, 0), make("Madman's Restraint", 2, 1),
            make("Crown of Insight", 1, 0), make("Mora", 700000, 0),
        ),
        ids["odette"]: (make("Philosophies of Charity", 14, 14), make("Twisted Withered Branch", 1, 1), make("Mora", 15000, 0)),
        ids["alyosha"]: (
            make("Severed Tail of the Sky-Roamer", 7, 7), make("Flockingweed", 23, 23), make("Character EXP", PLENTY, 0),
            make("Mora", PLENTY, 0),
        ),
        ids["jahoda"]: (make("Ascended Sample: Knight", 1, 1), make("Philosophies of Vagrancy", 10, 0), make("Mora", 12000, 0)),
    }
    return CalculatorRecord(has_user_info=True, items=items, targets={ids[key]: {"level": 90} for key in FOCUS})


def demo_endgame_detail(now: datetime, server: str, anchor: datetime | None = None) -> EndgameDetailRecord:
    """The endgame of the cycles that hold `now`. Those that hold `anchor`, the core's now (`now` itself when None), are this
    month's of the mockup: 33 of 36 stars with the one lost in 12-3's second half, and three Stygian bosses."""
    return _endgame_detail(now, server, 0, anchor)


# The demo's endgame cycles (the Stats design, 3.5): made up, with every icon empty, for the demo has no pictures. The
# Abyss's cycles run from the 16th, the Theater's and the Stygian Onslaught's from the 1st, as the demo's summaries do.
FIRST_HALF = ("nefer", "dahlia", "lauma", "columbina")
FLOOR_12 = {  # each chamber's enemies, the first half's and the second's, as (name, level)
    "12-1": (
        (("Battle-Hardened Chimeric Volkodlak Archer", 95),),
        (("Shadowy Husk: Standard Bearer", 95), ("Shadowy Husk: Defender", 95)),
    ),
    "12-2": ((("Radiant Moonfly", 98),), (("Battle-Hardened Elite Treasure Hoarder", 98),)),
    "12-3": ((("Chimeric Winged Lion", 100),), (("Secret Source Automaton: Overseer Device", 100),)),
}
# The three kinds of cycle. The current one, that holds the core's now, is kind 0, the mockup's, and the earlier ones count back
# from it, 1, 2, 0, 1 and so on (`_endgame_detail`), so that the best of the history is a cycle of its own, not today's.
# The stars lost in each kind of Abyss cycle, by chamber: 33, 36 and 34 of 36. A second half is the one that lost them.
ABYSS_LOST = ({"10-2": 1, "11-3": 1, "12-3": 1}, {}, {"12-2": 1, "12-3": 1})
# The strongest strike of each kind of Abyss cycle: the current one's is Sandrone's, as the Characters pages show; in the cycle of
# 36 stars Nefer struck harder, so that the year's strongest hit is someone's other than the character of the year's.
ABYSS_STRIKES = ((1_352_944, "sandrone"), (1_428_310, "nefer"), (1_270_944, "sandrone"))
# The Stygian Onslaught's seasons, by the month they run in.
STYGIAN_NAMES = (
    "Winter's Hollow Vigil", "Moonlit Frostfall", "Spring of Quiet Embers", "The Verdant Reckoning", "Blossom and Blade",
    "Tides of the Old Court", "Summer's Gilded Siege", "Storm over the Salt Road", "Harvest of Echoes",
    "The Silent Lantern Trial", "Ashes of the Last Bridge", "Starfall Gauntlet",
)
BOSSES = (  # name, the elements it is weak to and strong against, and a clear time
    ("Guardian Blade of Drifting Snow", ("Pyro",), ("Cryo",), 96),
    ("Fae of Crystalline Flesh", ("Cryo", "Hydro"), ("Dendro",), 88),
    ("Chimeric Winged Lion", ("Dendro",), ("Hydro",), 96),
)
THEATER_MEDALS = (  # each act's medal, this month first: the Arcana Challenge's twelve, then two months of ten
    (True, False, True, True, False, True, True, False, False, True, False, True), (True,) * 10, (True,) * 8 + (False,) * 2,
)


def _month_start(today: date, server: str, back: int, day: int) -> datetime:
    """04:00 on `day` of the month `back` months before the one of the game day `today` (after it, when `back` is below 0),
    in the server's zone."""
    index = today.year * 12 + today.month - 1 - back
    return datetime(index // 12, index % 12 + 1, day, 4, tzinfo=server_tz(server))


def _periods(now: datetime, server: str, back: int) -> tuple[datetime, datetime, datetime, datetime]:
    """When the Abyss's cycle `back` cycles before this one starts and the next starts, and the same of the month's. The
    cycles turn at the game day's reset, 04:00, so the first of the month still belongs to the month before until then."""
    today = game_day(now, server)
    abyss_back = back + (1 if today.day < 16 else 0)
    return (
        _month_start(today, server, abyss_back, 16), _month_start(today, server, abyss_back - 1, 16),
        _month_start(today, server, back, 1), _month_start(today, server, back - 1, 1),
    )


def _last_second(start_of_next: datetime) -> str:
    return iso(start_of_next - timedelta(seconds=1))


def _endgame_detail(now: datetime, server: str, back: int, anchor: datetime | None = None) -> EndgameDetailRecord:
    """The endgame of the cycle `back` cycles before the one that holds `now`, in each mode. What a cycle holds follows how
    many cycles it is before the one that holds `anchor`, the core's now (`now` itself when None): that one is the mockup's,
    as the Characters pages show it, 33 stars with the one lost in 12-3's second half and the three bosses with their
    elements, on any day the demo is started. The history the demo starts with is read with the same anchor, so that every
    sync of the demo, then or now, reads a cycle the same."""
    ids = _ids()
    abyss_from, abyss_to, month_from, month_to = _periods(now, server, back)
    current_abyss, _, current_month, _ = _periods(anchor or now, server, 0)
    kind = (_months(current_abyss) - _months(abyss_from)) % 3  # of the Abyss cycle
    month = (_months(current_month) - _months(month_from)) % 3  # of the month's cycles, the Theater's and the Stygian's
    lost = ABYSS_LOST[kind]
    halves = []
    for chamber, foes in FLOOR_12.items():
        for half, (team, enemies) in enumerate(zip((FIRST_HALF, SECOND_HALF), foes), start=1):
            stars = 3 - (lost.get(chamber, 0) if half == 2 else 0)
            records = tuple(EnemyRecord(name, level, "") for name, level in enemies)
            halves.append(AbyssHalfRecord(
                chamber, half, stars, tuple(ids[key] for key in team), tuple(foe.name for foe in records), records,
            ))
    chambers = tuple((f"{floor}-{room}", 3 - lost.get(f"{floor}-{room}", 0)) for floor in range(9, 13) for room in (1, 2, 3))
    medals = THEATER_MEDALS[month]
    bosses = tuple(
        StygianBossRecord(name, well, badly, (), seconds, "", 105) for name, well, badly, seconds in BOSSES
    )
    rank = lambda kind, value, key: RankRecord(kind, value, ids[key], "")   # noqa: E731
    return EndgameDetailRecord(
        abyss_stars=sum(stars for _, stars in chambers),
        abyss_halves=tuple(halves),
        abyss_ends=_last_second(abyss_to),
        theater_difficulty="Arcana Challenge" if len(medals) == 12 else "Visionary",
        theater_acts=10 if month < 2 else 8,
        theater_ends=_last_second(month_to),
        stygian_difficulty=5 if month < 2 else 4,
        stygian_bosses=bosses,
        stygian_ends=_last_second(month_to),
        abyss_starts=iso(abyss_from),
        abyss_battles=6 + kind,
        abyss_wins=6,
        abyss_chambers=chambers,
        abyss_ranks=(
            rank("strike", *ABYSS_STRIKES[kind]), rank("defeats", 22 + kind, "nefer"),
            rank("taken", 14_583, "lan-yan"), rank("bursts", 13, "columbina"), rank("skills", 21, "lauma"),
            rank("played", 6, "jahoda"),
        ),
        theater_starts=iso(month_from),
        theater_medals=medals,
        theater_medal_count=sum(medals[:10]),
        theater_flowers=1285 - 105 * month,
        theater_seconds=1002 - 150 * month,
        theater_ranks=(
            rank("damage", 943_229 - 60_000 * month, "sandrone"), rank("defeats", 11 + month, "ineffa"),
            rank("taken", 68_942, "dahlia"),
        ),
        stygian_season=STYGIAN_NAMES[month_from.month - 1],
        # The season after the current one is announced and has not started: the card says when it opens.
        stygian_next=(STYGIAN_NAMES[month_to.month - 1], iso(month_to)) if back == 0 else None,
        stygian_starts=iso(month_from),
        stygian_seconds=sum(seconds for *_, seconds in BOSSES),
        stygian_medal=f"UI_LeyLineChallenge_Medal_{5 if month < 2 else 4}",
    )


def _months(moment: datetime) -> int:
    return moment.year * 12 + moment.month - 1


def demo_endgame_cycles(now: datetime, server: str) -> list[EndgameCycleRow]:
    """The current cycle of each mode and the two before, as the table of cycles keeps them: each as last read while it
    was open, and numbered as HoYoLAB numbers them (the Abyss of 16 October 2026 is 124, November's Theater 31)."""
    rows = []
    for back in range(3):
        record = _endgame_detail(now, server, back)
        abyss_from, _, month_from, _ = _periods(now, server, back)
        ids = {
            "abyss": 124 + _months(abyss_from) - (2026 * 12 + 9),
            "theater": 31 + _months(month_from) - (2026 * 12 + 10),
            "stygian": 5269013 + _months(month_from) - (2026 * 12 + 10),
        }
        for mode, number in ids.items():
            ends = getattr(record, f"{mode}_ends")
            row = cycle_row(mode, str(number), record, min(now, parse_iso(ends)))
            if row is not None:
                rows.append(row)
    return rows


def demo_calendar_detail(now: datetime, server: str) -> CalendarDetailRecord:
    """The Theater's words, and one banner running now."""
    day = game_day(now, server)
    start, end = game_day_start(day - timedelta(days=11), server), game_day_start(day + timedelta(days=9), server)
    banner = (("Escoffier",), start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds"))
    return CalendarDetailRecord(theater_text=THEATER_TEXT, banners=(banner,))


def seed(store: Store, uid: int, now: datetime) -> None:
    """Once per demo folder: the focus of four with the plans the mockups' week uses, and the wiki's entries of the demo's
    characters, weapon, set and materials."""
    if store.meta(SEEDED) is not None:
        return
    with store.transaction():
        for ident, entry in _read("wiki.json")["entries"].items():
            store.put_wiki_entry(WikiEntryRow(ident, entry["kind"], entry["name"], entry["data"], "demo", now))
        records = {bridge.slug(r.name): r for r in demo_builds().builds}
        for key, (level, talents) in PLANS.items():
            card = demo_card(key)
            assert card is not None
            raw = dataclasses.asdict(records[key])
            build = bridge.build_of(raw, card.element, card.weapon_type, None)
            plan = needs.default_plan(build, card)
            plan = dataclasses.replace(
                plan, level=level, talents=talents, weapon_level=build.weapon.level if build.weapon else 1,
                refinement=1, set=None, mains={slot: piece.main for slot, piece in build.pieces.items() if slot in bridge.CHOOSABLE},
                level_pieces=(),
            )
            store.put_char_plan(uid, key, bridge.plan_to_json(plan), now)
        store.put_focus(uid, list(FOCUS))
        store.set_meta(SEEDED, now.isoformat())
