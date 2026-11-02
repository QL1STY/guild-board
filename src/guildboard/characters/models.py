"""The engines' models (the plan's contract, "Engine models and signatures"). Part E fills the engines that make and use
them; Part V gives them what HoYoLAB, the wiki and the player kept. Stat keys are `characters.STATS`; element names are
`characters.ELEMENTS`; a character's key is `metrics.slug(name)`, and a weapon's, a set's and a material's the slug of its
English name."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Sub:
    stat: str
    value: float
    rolls: int  # times + 1


@dataclass(frozen=True)
class Piece:
    slot: str
    set_key: str
    set_name: str
    name: str
    icon: str | None
    level: int
    rarity: int
    main: str
    main_value: float
    subs: tuple[Sub, ...]


@dataclass(frozen=True)
class WeaponState:
    key: str
    name: str
    icon: str | None
    type: str
    rarity: int
    level: int
    refinement: int
    base_atk: float
    sub: str | None
    sub_value: float


@dataclass(frozen=True)
class Build:
    key: str
    level: int
    ascension: int
    constellation: int
    talents: dict[str, int]   # "normal" | "skill" | "burst" -> level, no constellation bonus
    bonus: dict[str, int]     # constellation bonus per talent
    weapon: WeaponState | None
    pieces: dict[str, Piece]
    base: dict[str, float]    # HoYoLAB base values by stat key; base["atk"] includes the weapon's base ATK
    add: dict[str, float]     # HoYoLAB added values by stat key


@dataclass(frozen=True)
class SetChoice:
    sets: tuple[str, ...]
    pieces: str               # "4" | "2+2"


@dataclass(frozen=True)
class Card:
    key: str
    name: str
    element: str
    weapon_type: str
    rarity: int
    pronouns: tuple[str, str, str]   # ("she", "her", "her") | ("he", "him", "his") | ("they", "them", "their")
    roles: tuple[str, ...]
    keeps_alive: bool
    scaling: str                     # "atk" | "hp" | "def" | "em"
    damage_talent: str
    talent_priority: tuple[str, str, str]
    talent_table: str                # "elemental" | "physical"
    goals: dict[str, float]          # stat key -> goal; may omit keys
    mains: dict[str, tuple[str, ...]]   # "sands" | "goblet" | "circlet" -> stat keys, best first
    weights: dict[str, str]          # stat key -> "wants" | "some" | "none"
    sets: tuple[SetChoice, ...]
    weapons: tuple[str, ...]         # best first; signature first
    partners: tuple[str, ...]        # elements
    partner_roles: tuple[str, ...]   # roles
    teams: tuple[tuple[str, tuple[str, ...]], ...]   # (name, member keys; "*healer" etc. for a role)
    notes: str
    confidence: str
    early: bool
    stars: tuple[tuple[int, int], ...] | None        # constellation chart pixels, C1..C6
    chart_size: tuple[int, int] | None               # the width and height of the chart those pixels are of
    edited: frozenset[str]           # fields the player edited


@dataclass(frozen=True)
class Effect:
    stat: str
    values: tuple[float, ...]   # by refinement for weapons, one value for sets
    when: str                   # "always" | "met"
    condition: str


@dataclass(frozen=True)
class WeaponRef:
    key: str
    name: str
    type: str
    rarity: int
    base_atk_90: float
    sub: str | None
    sub_90: float
    effects: tuple[Effect, ...]
    icon: str | None


@dataclass(frozen=True)
class SetRef:
    key: str
    name: str
    two: tuple[Effect, ...]
    four: tuple[Effect, ...]
    icons: dict[str, str]


@dataclass(frozen=True)
class Source:
    kind: str                # "books" | "forgery" | "weekly" | "boss" | "flowers" | "enemies" | "ley" | "crafted" | "unknown"
    where: str
    days: tuple[int, ...]    # weekdays (Monday is 0), () when any day


@dataclass(frozen=True)
class Flower:
    key: str
    name: str
    places: str
    per_pass: int


@dataclass(frozen=True)
class Refs:
    weapons: dict[str, WeaponRef]
    sets: dict[str, SetRef]
    yields: dict[str, float]   # "books" | "forgery" | "boss" | "weekly" | "ley_exp" | "ley_mora" -> per run; "artifact_5star" 1.065
    mains_20: dict[str, float]            # main stat key -> value at +20 (5 stars)
    main_odds: dict[str, dict[str, float]]   # slot -> stat key -> chance
    sub_weights: dict[str, int]
    roll_avg: dict[str, float]
    scaling: dict[str, tuple[float, ...]]    # "elemental" | "physical" -> multipliers for levels 1..15
    reactions: dict[str, tuple[str, ...]]
    flowers: dict[str, Flower]


@dataclass(frozen=True)
class TypedPiece:
    slot: str
    main: str
    subs: tuple[tuple[str, float], ...]
    use: bool


@dataclass(frozen=True)
class Plan:
    level: int
    talents: dict[str, int]
    weapon: str | None
    weapon_level: int
    refinement: int
    set: SetChoice | None
    mains: dict[str, str]
    level_pieces: tuple[str, ...]
    typed: TypedPiece | None


@dataclass(frozen=True)
class Need:
    material: str
    name: str
    icon: str | None
    amount: int
    held: int | None   # None: unknown
    exact: bool        # False: "at least"
    source: Source


@dataclass(frozen=True)
class Costs:
    talent: dict[int, tuple[tuple[str, int], ...]]      # talent level reached (2..10) -> (material key, amount); the same for each talent
    ascension: dict[int, tuple[tuple[str, int], ...]]   # phase (1..6) -> (material key, amount), Mora as "mora"
    weapon: dict[int, tuple[tuple[str, int], ...]]      # her planned weapon's phases
    exp: tuple[int, ...]                                # EXP to reach each level (index = level); from tables.json
    weapon_exp: tuple[int, ...]
    level_phase: tuple[int, ...]                        # the level each phase ends at: (20, 40, 50, 60, 70, 80)


@dataclass(frozen=True)
class FocusInput:
    key: str
    name: str
    pronouns: tuple[str, str, str]
    goal: str
    needs: tuple[Need, ...]
    luck: tuple[tuple[str, float], ...]   # (piece label, chance per run)


@dataclass(frozen=True)
class Task:
    key: str
    day: date
    kind: str
    who: tuple[str, ...]
    where: str
    runs: int
    resin: int
    gets: tuple[tuple[str, str | None, float], ...]   # (character, material key, expected amount)
    free: bool
    why: str


@dataclass(frozen=True)
class DayPlan:
    day: date
    start: int
    spent: int
    tasks: tuple[Task, ...]


@dataclass(frozen=True)
class WeekPlan:
    days: tuple[DayPlan, ...]
    ready: dict[str, date | None]
    luck: dict[str, tuple[date | None, date | None]]
    resin_by: dict[str, int]


@dataclass(frozen=True)
class Member:
    key: str
    name: str
    element: str
    roles: tuple[str, ...]
    keeps_alive: bool
    wants: tuple[str, ...]
    ready: int


@dataclass(frozen=True)
class Team:
    members: tuple[Member, ...]   # members[0] deals the damage
    ready: int


@dataclass(frozen=True)
class Readiness:
    total: int
    parts: dict[str, float]   # "level" | "talents" | "weapon" | "artifacts" -> 0..1


@dataclass(frozen=True)
class Verdict:
    slot: str
    verdict: str   # "keep" | "level" | "replace"
    why: str
    crit_value: float
    rolls_wanted: int
    rolls_all: int


@dataclass(frozen=True)
class Step:
    text: str
    gain: str
    value: float


@dataclass(frozen=True)
class Notice:
    kind: str
    title: str
    body: str

