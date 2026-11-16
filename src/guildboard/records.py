"""Guild Board's own normalized records, the Source seam, and the errors a source may raise."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, ClassVar, Protocol, Union

GROUPS = ("overview", "notes", "characters", "endgame", "diary", "calendar")


@dataclass(frozen=True)
class RawResponse:
    endpoint: str
    body: Any


@dataclass(frozen=True)
class Offering:
    name: str
    level: int
    icon_url: str = ""


@dataclass(frozen=True)
class Area:
    name: str
    pct: float


@dataclass(frozen=True)
class Region:
    id: int
    parent_id: int
    name: str
    pct: float
    icon_url: str = ""
    offerings: tuple[Offering, ...] = ()
    areas: tuple[Area, ...] = ()


@dataclass(frozen=True)
class OverviewRecord:
    nickname: str
    server: str
    adventure_rank: int
    counters: dict[str, float]
    regions: tuple[Region, ...]
    abyss_progress: str = ""
    picture_url: str = ""  # the profile picture on HoYoverse's servers; "" when HoYoLAB names none


@dataclass(frozen=True)
class ArchonChapter:
    id: int
    status: str
    number: str
    title: str


@dataclass(frozen=True)
class Expedition:
    icon_url: str  # the character's picture on HoYoverse's servers; HoYoLAB gives no name
    back_at: str | None  # ISO 8601 with its offset; None once the expedition is back


@dataclass(frozen=True)
class NotesRecord:
    resin: int
    resin_max: int
    resin_full_at: str | None
    realm_currency: int
    realm_currency_max: int
    commissions_done: int
    commissions_max: int
    boss_discounts_left: int
    boss_discounts_max: int
    expeditions_done: int
    expeditions_total: int
    archon_open: tuple[ArchonChapter, ...]
    archon_all_finished: bool
    # Kept for the Board's widgets (spec 13.3), with defaults: a record is also built by position.
    expeditions: tuple[Expedition, ...] = ()
    expeditions_max: int = 0
    transformer_obtained: bool = False
    transformer_ready_at: str | None = None  # the time read when it was ready already
    realm_currency_full_at: str | None = None


@dataclass(frozen=True)
class CharactersRecord:
    owned: int
    level90: int
    # The Characters pages' reads, kept in the group's latest document beside the summary (the Characters plan, Part S):
    # every owned character's build, and what the batch calculator said about the focus. None where it could not be read.
    builds: BuildsRecord | None = None
    calculator: CalculatorRecord | None = None


@dataclass(frozen=True)
class EndgameMode:
    mode: str
    label: str
    has_data: bool
    result_text: str
    score: float | None
    period_start: str | None
    period_end: str | None
    period_label: str


@dataclass(frozen=True)
class EndgameRecord:
    modes: tuple[EndgameMode, ...]
    detail: EndgameDetailRecord | None = None  # the Characters pages' detail, kept beside the summaries (Part S)


@dataclass(frozen=True)
class DiarySource:
    name: str
    amount: int


@dataclass(frozen=True)
class DiaryMonth:
    year: int
    month: int
    primogems: int
    sources: tuple[DiarySource, ...]


@dataclass(frozen=True)
class DiaryEntry:
    """One primogem income entry of the diary's detail log (the ledger design, section 0)."""

    time: str      # HoYoLAB's text, in the server's time: "2026-10-27 05:12:33"
    at: datetime   # that moment
    action: str    # what gave the primogems, as HoYoLAB names it
    amount: int


@dataclass(frozen=True)
class DiaryRecord:
    months: tuple[DiaryMonth, ...]
    entries: tuple[DiaryEntry, ...] = ()  # the detail log of the same months, when it could be read
    uid: int = 0  # the account the detail log is of


@dataclass(frozen=True)
class CalendarFace:
    """A character or weapon a banner features. `icon_url` is the address in HoYoLAB's answer ("" when it gave none)."""

    name: str
    rarity: int
    icon_url: str


@dataclass(frozen=True)
class CalendarBanner:
    """A banner of the calendar: its featured 5-stars' names, its dates (UTC ISO text, None when the answer has none) and
    its faces, 5-stars first. Character pools with the same dates are one banner."""

    kind: str  # "character", "weapon" or "chronicled"
    names: tuple[str, ...]
    starts: str | None
    ends: str | None
    faces: tuple[CalendarFace, ...]


@dataclass(frozen=True)
class CalendarEvent:
    """An event of the calendar's `act_list`. `status` is HoYoLAB's: 2 running, 1 announced with no dates. An event with no
    dates (`dated` False) is "Coming soon": `starts` and `ends` are None, and `source` says whose dates they are ("hoyolab";
    a later read of another source's dates keeps its own name here). `finished` is the player's own completion
    (`is_finished`, confirmed by the player on 2026-11-15)."""

    id: int
    name: str
    starts: str | None
    ends: str | None
    finished: bool
    primogems: int | None  # the sum of the reward list's Primogems (item 201); None when the event has none
    explored: float | None  # HoYoLAB's explore percentage, when the event carries one
    double_left: int | None
    double_total: int | None
    status: int = 0
    dated: bool = False
    source: str = "hoyolab"


@dataclass(frozen=True)
class CalendarBoardRecord:
    """What the Calendar widget draws, kept in the calendar document beside the counts and the Characters pages' detail."""

    banners: tuple[CalendarBanner, ...] = ()
    events: tuple[CalendarEvent, ...] = ()


@dataclass(frozen=True)
class CalendarRecord:
    banners: int
    events: int
    detail: CalendarDetailRecord | None = None  # the Theater's text and the banners' featured names (Part S)
    board: CalendarBoardRecord | None = None  # the banners and events the Calendar widget draws (None before it existed)


# The Characters plan's records (its contract, "Records"): produced by sources/hoyolab.py's reads of the detailed
# characters, the batch calculator, the endgame details and the calendar, and consumed by the Characters service. Their
# `prop` ids are HoYoLAB's (its `property_map`), and element names are spelled as in characters.ELEMENTS.


@dataclass(frozen=True)
class SubRecord:
    prop: int
    value: str
    times: int


@dataclass(frozen=True)
class PieceRecord:
    pos: int
    name: str
    icon: str
    set_id: int
    set_name: str
    rarity: int
    level: int
    main_prop: int
    main_value: str
    subs: tuple[SubRecord, ...]


@dataclass(frozen=True)
class WeaponRecord:
    id: int
    name: str
    icon: str
    type: int
    rarity: int
    level: int
    refinement: int
    ascension: int
    base_atk: str
    sub_prop: int | None
    sub_value: str | None


@dataclass(frozen=True)
class SkillRecord:
    id: int
    skill_type: int
    name: str
    icon: str
    level: int
    # The rows of the talent at the level she has it (`skill_affix_list`: HoYoLAB's name and its value as text, in its order);
    # a passive and a record from before this was kept have none.
    affixes: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class PropRecord:
    prop: int
    base: str
    add: str
    final: str


@dataclass(frozen=True)
class BuildRecord:
    id: int
    name: str
    element: str
    rarity: int
    level: int
    ascension: int
    constellation: int
    icon: str
    wiki_entry: str | None
    weapon: WeaponRecord
    pieces: tuple[PieceRecord, ...]
    skills: tuple[SkillRecord, ...]
    props: tuple[PropRecord, ...]
    # HoYoLAB's other pictures of the character: the one stands for her where the inventory has none (the Traveler, the Manekins).
    side_icon: str = ""
    image: str = ""
    # HoYoLAB's recommended stats for her (`recommend_relic_property`): property ids by "sands", "goblet", "circlet" and "subs";
    # a list it does not give is left out, and a record from before this was kept has none.
    recommended: dict[str, tuple[int, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class BuildsRecord:
    """Group "characters": every character's build, and HoYoLAB's names for the property ids."""

    builds: tuple[BuildRecord, ...]
    prop_names: dict[int, str]


@dataclass(frozen=True)
class CalcItemRecord:
    id: int
    name: str
    icon: str
    amount: int
    lacking: int


@dataclass(frozen=True)
class CalculatorRecord:
    """Group "characters": what the batch calculator says, by character id. `has_user_info` is False when HoYoLAB's
    calculator sync is off."""

    has_user_info: bool
    items: dict[int, tuple[CalcItemRecord, ...]]
    targets: dict[int, dict[str, int]]


@dataclass(frozen=True)
class EnemyRecord:
    """An enemy of a Spiral Abyss half: its name, level and picture (an address on HoYoverse's picture hosts, or "")."""

    name: str
    level: int
    icon: str


@dataclass(frozen=True)
class RankRecord:
    """One of an endgame mode's highlights, with the character it is of and that character's face. `kind` is "strike",
    "defeats", "taken", "bursts", "skills" or "played" in the Spiral Abyss, and "damage", "defeats" or "taken" in the
    Imaginarium Theater."""

    kind: str
    value: int
    avatar_id: int
    icon: str


@dataclass(frozen=True)
class AbyssHalfRecord:
    chamber: str  # "12-3"
    half: int
    stars: int
    characters: tuple[int, ...]
    enemies: tuple[str, ...]
    foes: tuple[EnemyRecord, ...] = ()  # the same enemies, with their levels and pictures (the Stats design, 3.4)


@dataclass(frozen=True)
class StygianBossRecord:
    name: str
    advantage: tuple[str, ...]     # element names, translated from the HardChallengeTagElement sprites
    disadvantage: tuple[str, ...]
    team: tuple[int, ...]
    seconds: int | None
    icon: str = ""
    level: int = 0


@dataclass(frozen=True)
class EndgameDetailRecord:
    """Group "endgame". The fields after the first nine are the Stats page's (its design, 3.4), each with a default, so
    that what the Characters pages read is as it was. Times are UTC ISO text."""

    abyss_stars: int | None
    abyss_halves: tuple[AbyssHalfRecord, ...]
    abyss_ends: str | None
    theater_difficulty: str | None
    theater_acts: int | None
    theater_ends: str | None
    stygian_difficulty: int | None
    stygian_bosses: tuple[StygianBossRecord, ...]
    stygian_ends: str | None
    abyss_starts: str | None = None
    abyss_battles: int = 0
    abyss_wins: int = 0
    abyss_chambers: tuple[tuple[str, int], ...] = ()  # ("9-1", stars), floor by floor
    abyss_ranks: tuple[RankRecord, ...] = ()
    theater_starts: str | None = None
    theater_medals: tuple[bool, ...] = ()  # one for each act of the season, True where its medal was won
    theater_medal_count: int = 0  # the medals HoYoLAB counts: those of the season's own acts
    theater_flowers: int = 0  # Fantasia Flowers used
    theater_seconds: int = 0  # time in battle
    theater_ranks: tuple[RankRecord, ...] = ()
    stygian_season: str = ""
    stygian_starts: str | None = None
    stygian_seconds: int | None = None  # the best's total time
    stygian_medal: str = ""  # the best's medal, by the name of its picture, such as UI_LeyLineChallenge_Medal_5
    stygian_next: tuple[str, str] | None = None  # (name, starts) of a newer season with no data yet
    # The Arcana fights cleared (HoYoLAB's tarot_finished_cnt). An Arcana Challenge season's medal list holds its acts
    # first and then its Arcana fights, which are not acts.
    theater_arcana: int = 0
    theater_heraldry: int = 0  # the season's heraldry, as HoYoLAB numbers it (0 to 6)


@dataclass(frozen=True)
class CalendarDetailRecord:
    """Group "calendar": the Theater's calendar text, and the banners as (featured names, starts, ends)."""

    theater_text: str | None
    banners: tuple[tuple[tuple[str, ...], str, str], ...]


@dataclass(frozen=True)
class CalcTarget:
    """What the batch calculator is asked about one focus character. The levels are explicit: the weapon is
    (id, current, target), and each talent (group id, current, target)."""

    character_id: int
    level: tuple[int, int]
    weapon: tuple[int, int, int] | None
    talents: tuple[tuple[int, int, int], ...]


Record = Union[OverviewRecord, NotesRecord, CharactersRecord, EndgameRecord, DiaryRecord, CalendarRecord]


@dataclass(frozen=True)
class FetchResult:
    group: str
    fetched_at: datetime
    raw: tuple[RawResponse, ...]
    record: Record | None
    problem: str | None = None


@dataclass(frozen=True)
class GameAccount:
    uid: int
    nickname: str
    server: str
    level: int


class SourceError(Exception):
    """A source could not deliver a group. `kind` says why."""

    kind: ClassVar[str] = "error"


class LoginNeeded(SourceError):
    kind = "login_needed"


class VerificationNeeded(SourceError):
    kind = "verification_needed"


class DataSwitchOff(SourceError):
    kind = "switch_off"


class Offline(SourceError):
    kind = "offline"


class RateLimited(SourceError):
    kind = "rate_limited"


class Unexpected(SourceError):
    kind = "error"


class Source(Protocol):
    async def fetch(self, group: str, *, now: datetime, first_time: bool = False) -> FetchResult:
        """Fetch one data group. `first_time` asks the diary group for one extra month of history."""
        ...
