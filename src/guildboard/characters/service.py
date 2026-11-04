"""The Characters service (the Characters plan, Part V): the page models, the changes the player makes, the reads the pages
wait for and the loop of notices.

The service gathers what the pages need, and the builders in `views/` make the models of the plan's TypeScript contract:
- from HoYoLAB, the group "characters"'s latest document (every build and what the calculator said), the notes and the
  endgame and calendar details;
- from the wiki, the entries the store keeps (read after the player's consent, in the background);
- from the reference files, the inventory (every character), the cards, the weapons' and sets' effects and the tables;
- from Pulls, each 5-star's pity;
- from the player, the focus, the plans, the edits to cards, the amounts typed and the Theater's pick.

Without a card from the research a character falls back as the design's section 5 says. Without a login every character is
not owned. Nothing here asks HoYoLAB for anything: the sync does, and the wiki is read only once `ready()` says the player
has consented."""
from __future__ import annotations

import asyncio
import json
import logging
import math
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable, Iterator, Mapping, Sequence

from guildboard import characters
from guildboard.characters import ELEMENTS, FOCUS_MAX, HORIZON_DAYS, RESIN_PER_DAY, bridge, notices, readiness
from guildboard.characters import needs as needs_engine
from guildboard.characters import reference, stats
from guildboard.characters import week as week_engine
from guildboard.characters.art import ArtCache
from guildboard.characters.models import Build, Card, Costs, FocusInput, Need, Plan, Refs, Source, WeekPlan
from guildboard.characters.wiki import CharacterPage, CharacterWiki, SetPage, WeaponPage, materials_of
from guildboard.clock import Clock
from guildboard.events import EventBus
from guildboard.gameday import game_day, game_day_start, server_tz, week_start
from guildboard.metrics import slug
from guildboard.pulls import POOL_LABELS
from guildboard.pulls.planner import Planner
from guildboard.records import CalcItemRecord, CalcTarget
from guildboard.store import Store
from guildboard.sync.policy import CADENCE

log = logging.getLogger(__name__)

# What the player reads (the plan's Review Focus and contract).
SYNC_OFF = (
    "Calculator sync is off in HoYoLAB, so Guild Board can't see what you hold. Switch it on in HoYoLAB's Enhancement "
    "Progression Calculator, or type what you hold here."
)
LOGIN_FIRST = "Log in to HoYoLAB to see your builds."
FOUR_AT_MOST = "Four at most: take one out first."
NO_SUCH_CHARACTER = "There is no such character."
CHOOSE_THREE = "Choose three different elements."
BAD_AMOUNTS = "Give amounts as whole numbers from 0 to 9,999,999."
NOT_A_FIELD = "That is not a field of a card."
NOT_A_VALUE = "That is not a value the card can hold."
NOT_TODAYS_TASK = "Only today's tasks can be ticked."
BAD_SHAPE = "This request does not have the expected shape."
MAX_AMOUNT = 9_999_999

MORA = "mora"
MORA_ICON = "https://bbs.hoyolab.com/hoyowiki/picture/object/Mora_icon.png"
EXP_SOURCES = {
    needs_engine.CHARACTER_EXP: ("Character EXP", "Ley Line Outcrops: Blossom of Revelation"),
    needs_engine.WEAPON_EXP: ("Weapon EXP", "Ley Line Outcrops: Blossom of Revelation"),
}
# The EXP books and ores the calculator names, by the slug of their names, and the EXP points each gives: what is held of
# them is held as EXP, which is what the plan's `character-exp` and `weapon-exp` are counted in.
EXP_BOOKS = {
    needs_engine.CHARACTER_EXP: {"hero-s-wit": 20000, "adventurer-s-experience": 5000, "wanderer-s-advice": 1000},
    needs_engine.WEAPON_EXP: {"mystic-enhancement-ore": 10000, "fine-enhancement-ore": 2000, "enhancement-ore": 400},
}
LONGEST_WAIT = 900.0  # the notices loop looks again at least this often, in seconds
NOTICE_KIND = "characters"  # the kind the shell is given with a notification


class CharactersRefused(ValueError):
    """A change that is refused, with the sentence that says why."""


class UnknownCharacter(KeyError):
    """A key that is no character's."""


@dataclass(frozen=True)
class Char:
    """What the pages know of one character: who they are, their card, their build and the wiki's page."""

    key: str
    name: str
    element: str
    weapon_type: str
    rarity: int
    inventory: Mapping[str, Any] | None
    record: Mapping[str, Any] | None
    page: CharacterPage | None
    card: Card
    sources: tuple[str, ...]   # where the card's research came from, and the day it was checked
    checked: str | None
    researched: bool        # False: the card is the fallback of the design's section 5
    build: Build | None
    early: bool
    icon: str | None        # the address of her picture on HoYoverse's servers

    @property
    def owned(self) -> bool:
        return self.build is not None


@dataclass(frozen=True)
class Resin:
    now: int
    top: int
    discounts: int


class Characters:
    # Whether the wiki is read by itself once the player has consented: when a page asks for a character, and after a sync.
    # This is the Characters design's H6, which the hands-off change (Task V5) approved, and which `tests/test_handsoff.py`
    # holds: the lists, the entries and their pictures, through netpolicy, and nothing before consent.
    AUTOMATIC_READS = True

    def __init__(
        self,
        store: Store,
        clock: Clock,
        bus: EventBus,
        wiki: CharacterWiki,
        art: ArtCache,
        pulls: Planner,
        server: Callable[[], str],
        uid: Callable[[], int | None],
        demo: bool,
        *,
        refs: Refs | None = None,
        cards: Callable[[str], Card | None] | None = None,
        meta: Callable[[str], tuple[tuple[str, ...], str | None]] | None = None,
        ready: Callable[[], bool] = lambda: False,
        sync: Callable[[], Mapping[str, Any]] | None = None,
        notify: Callable[[str, str], bool] | None = None,
        switches: Callable[[], Mapping[str, bool]] = lambda: {},
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        day_resin: Callable[[], tuple[int, int, int] | None] | None = None,
        game_running: Callable[[], bool] = lambda: False,
    ) -> None:
        self._store = store
        self._clock = clock
        self._bus = bus
        self._wiki = wiki
        self._art = art
        self._pulls = pulls
        self._server = server
        self._uid = uid
        self._demo = demo
        self._refs = refs
        self._cards = cards or reference.load_card
        self._meta = meta or reference.load_card_meta   # a card's sources and the day it was checked
        self._ready = ready                # whether the wiki may be asked: the player has given the first run's consent
        self._sync = sync or (lambda: {})   # the sync's state, which only the core knows
        self._notify = notify               # shows a notification: (kind, text) -> shown
        self._switches = switches           # the notices' switches: weekly, domain, ready
        self._sleep = sleep
        self._day_resin = day_resin         # the demo's own start of a game day, in place of the first Notes read
        self._game_running = game_running   # whether the game runs, from the Windows process list: the warm-up waits for it
        self._pages: dict[str, tuple[str, str, CharacterPage]] = {}
        self._weapon_pages: dict[str, tuple[str, str, WeaponPage]] = {}
        self._set_pages: dict[str, tuple[str, str, SetPage]] = {}
        self._inventory: dict[str, dict[str, Any]] | None = None
        self._memo: dict[str, Any] | None = None
        self._woken = asyncio.Event()
        self._wanted: set[str] = set()
        self._filler: asyncio.Task[None] | None = None
        self._warmer: asyncio.Task[None] | None = None   # the art cache's warm-up after a sync, while it runs
        self._announced: set[str] = set()   # goals already told as ready, until they are not ready any more

    # ------------------------------------------------------------------------------------------ one look at the store
    @contextmanager
    def scope(self) -> Iterator[None]:
        """Within it, what the store gives is read once: a model is made from one look."""
        outer = self._memo is not None
        if not outer:
            self._memo = {}
        try:
            yield
        finally:
            if not outer:
                self._memo = None

    def _once(self, key: str, make: Callable[[], Any]) -> Any:
        if self._memo is None:
            return make()
        if key not in self._memo:
            self._memo[key] = make()
        return self._memo[key]

    # ------------------------------------------------------------------------------------------ what is known
    @property
    def refs(self) -> Refs:
        if self._refs is None:
            self._refs = reference.load_refs()
        return self._refs

    @property
    def demo(self) -> bool:
        return self._demo

    @property
    def store(self) -> Store:
        return self._store

    def now(self) -> datetime:
        return self._clock.now()

    def server(self) -> str:
        return self._server()

    def today(self) -> date:
        return game_day(self._clock.now(), self._server())

    def uid(self) -> int:
        """The account everything is kept under: the login's, else 0, so that a focus can be chosen before a login."""
        return self._uid() or 0

    def address(self, url: str | None) -> str | None:
        return self._art.address(url)

    def _first_usable(self, urls: Sequence[str | None]) -> str | None:
        """The first address the art cache can give a picture for, else the first there is."""
        found = [url for url in urls if url]
        return next((url for url in found if self._art.usable(url)), found[0] if found else None)

    def art_url(self, char: Char) -> str | None:
        """Her large art: the wiki's, the inventory's, else HoYoLAB's `image` (the Traveler and the Manekins have no other)."""
        return self._first_usable([
            char.page.art if char.page else None, (char.inventory or {}).get("art"), (char.record or {}).get("image"),
        ])

    def focus(self) -> list[str]:
        return self._once("focus", lambda: self._store.focus(self.uid()))

    def typed(self) -> dict[str, int]:
        return self._once("typed", lambda: self._store.held(self.uid()))

    def read_at(self) -> datetime | None:
        doc = self._once("characters_doc", lambda: self._store.latest_doc("characters"))
        return doc[0] if doc is not None else None

    def _records(self) -> dict[str, dict[str, Any]]:
        def make() -> dict[str, dict[str, Any]]:
            doc = self._store.latest_doc("characters")
            builds = (doc[1].get("builds") or {}).get("builds") if doc is not None else None
            return {slug(str(record["name"])): record for record in builds or ()}

        return self._once("records", make)

    def calculator(self) -> dict[str, Any] | None:
        doc = self._once("characters_doc", lambda: self._store.latest_doc("characters"))
        return doc[1].get("calculator") if doc is not None else None

    def inventory(self) -> dict[str, dict[str, Any]]:
        if self._inventory is None:
            self._inventory = {item["key"]: item for item in reference.load_inventory()["characters"]}
        return self._inventory

    def _wiki_characters(self) -> dict[str, Any]:
        return self._once(
            "wiki_characters",
            lambda: {slug(name): row for (kind, name), row in self._store.wiki_items().items() if kind == "character"},
        )

    def keys(self) -> list[str]:
        """Every character the pages list: the inventory's, those the wiki lists whose element is known, and the player's
        builds."""
        def make() -> list[str]:
            found: dict[str, None] = dict.fromkeys(self.inventory())
            for key, row in self._wiki_characters().items():
                if key not in found and self._wiki_element(row.entry_page_id) is not None:
                    found[key] = None
            found.update(dict.fromkeys(self._records()))
            return list(found)

        return self._once("keys", make)

    def _wiki_element(self, entry_id: str) -> str | None:
        row = self._store.wiki_entry(entry_id)
        values = (row.data.get("filters") or {}).get("character_vision") if row is not None else None
        return str(values[0]) if values else None

    def _page_of(self, entry_id: str | None) -> CharacterPage | None:
        if not entry_id:
            return None
        found = self._store.wiki_entry_stamp(str(entry_id))
        if found is None or found[0] != "character":
            return None
        stamp = (found[1], found[2].isoformat())
        kept = self._pages.get(str(entry_id))
        if kept is not None and kept[:2] == stamp:
            return kept[2]
        row = self._store.wiki_entry(str(entry_id))  # decoded only when the parsed page is not kept
        if row is None:
            return None
        try:
            page = self._wiki.character_page(row)
        except Exception:  # an entry the parser cannot read is as good as none
            log.warning("A character's wiki entry could not be read.", exc_info=True)
            return None
        self._pages[row.entry_page_id] = (*stamp, page)
        return page

    def weapon_page(self, key: str | None) -> WeaponPage | None:
        entry = self._weapon_entry(key) if key else None
        found = self._store.wiki_entry_stamp(entry) if entry else None
        if found is None or found[0] != "weapon":
            return None
        stamp = (found[1], found[2].isoformat())
        kept = self._weapon_pages.get(str(entry))
        if kept is not None and kept[:2] == stamp:
            return kept[2]
        row = self._store.wiki_entry(str(entry))  # decoded only when the parsed page is not kept
        if row is None:
            return None
        try:
            page = self._wiki.weapon_page(row)
        except Exception:
            log.warning("A weapon's wiki entry could not be read.", exc_info=True)
            return None
        self._weapon_pages[row.entry_page_id] = (*stamp, page)
        return page

    def set_page(self, key: str | None) -> SetPage | None:
        """The wiki's page of an artifact set, once its entry has been read; None until then."""
        entry = self._set_entry(key) if key else None
        found = self._store.wiki_entry_stamp(entry) if entry else None
        if found is None or found[0] != "set":
            return None
        stamp = (found[1], found[2].isoformat())
        kept = self._set_pages.get(str(entry))
        if kept is not None and kept[:2] == stamp:
            return kept[2]
        row = self._store.wiki_entry(str(entry))
        if row is None:
            return None
        try:
            page = self._wiki.set_page(row)
        except Exception:
            log.warning("A set's wiki entry could not be read.", exc_info=True)
            return None
        self._set_pages[row.entry_page_id] = (*stamp, page)
        return page

    def weapon_row(self, key: str | None):
        entry = self._weapon_entry(key) if key else None
        row = self._store.wiki_entry(entry) if entry else None
        return row if row is not None and row.kind == "weapon" else None

    def _by_slug(self, kind: str, key: str) -> str | None:
        for (item_kind, name), item in self._store.wiki_items().items():
            if item_kind == kind and slug(name) == key:
                return item.entry_page_id
        return None

    def _weapon_entry(self, key: str | None) -> str | None:
        for item in reference.load_inventory()["weapons"]:
            if item["key"] == key:
                return str(item["entry"])
        return self._by_slug("weapon", key) if key else None

    def _set_entry(self, key: str) -> str | None:
        for item in reference.load_inventory()["sets"]:
            if item["key"] == key:
                return str(item["entry"])
        return self._by_slug("set", key)

    def _character_entry(self, key: str, record: Mapping[str, Any] | None, inv: Mapping[str, Any] | None) -> str | None:
        if record is not None and record.get("wiki_entry"):
            return str(record["wiki_entry"])
        if inv is not None and inv.get("entry"):
            return str(inv["entry"])
        row = self._wiki_characters().get(key)
        return row.entry_page_id if row is not None else None

    # ------------------------------------------------------------------------------------------ one character
    def char(self, key: str) -> Char | None:
        """One character, or None when the key is no character's."""
        inv = self.inventory().get(key)
        record = self._records().get(key)
        listed = self._wiki_characters().get(key)
        if inv is None and record is None and listed is None:
            return None
        entry = self._character_entry(key, record, inv)
        page = self._page_of(entry)
        name = str(inv["name"]) if inv else str(record["name"]) if record else (page.name if page else listed.name)
        element = (
            (inv or {}).get("element") or (record or {}).get("element") or (page.element if page else None)
            or (self._wiki_element(entry) if entry else None)
        )
        if not element:
            return None
        weapon_type = (
            (inv or {}).get("weapon_type") or (page.weapon_type if page else None)
            or (bridge.WEAPON_TYPE_OF_ID.get(int(record["weapon"]["type"])) if record and record.get("weapon") else None)
            or "Sword"
        )
        rarity = int((inv or {}).get("rarity") or (record or {}).get("rarity") or (page.rarity if page else 0) or 4)
        ascension_stat = str((inv or {}).get("ascension_stat") or (page.ascension_stat if page else "") or "")
        early = bool(inv is not None and not inv.get("released", True))
        card = self._cards(key)
        researched = card is not None
        if card is not None:
            card = bridge.with_default_goals(card)
        else:
            card = bridge.fallback_card(key, name, element, weapon_type, rarity, ascension_stat, self.refs, early=early)
        edits = self._once("edits", lambda: self._store.card_edits(self.uid())).get(key)
        if edits:
            card = bridge.apply_edits(card, edits)
        build = bridge.build_of(record, element, weapon_type, page) if record is not None else None
        # Her face: the inventory's, else HoYoLAB's own (its icon, then its side icon), else the wiki's. The art cache takes
        # five hosts only, so the first of these it can use wins; if it can use none, the first there is (it shows no face).
        faces = [
            (inv or {}).get("icon"), (record or {}).get("icon"), (record or {}).get("side_icon"), page.icon if page else None,
            listed.icon_url if listed is not None else None,
        ]
        icon = self._first_usable(faces)
        sources, checked = self._meta(key) if researched else ((), None)
        return Char(
            key=key, name=name, element=element, weapon_type=weapon_type, rarity=rarity, inventory=inv, record=record,
            page=page, card=card, sources=tuple(sources), checked=checked, researched=researched, build=build, early=early or card.early, icon=icon or None,
        )

    # ------------------------------------------------------------------------------------------ plans and readiness
    def stored_plan(self, key: str) -> Plan | None:
        row = self._once("plans", lambda: self._store.char_plans(self.uid())).get(key)
        if row is None:
            return None
        try:
            return bridge.plan_from_json({**row.plan, "weights": None})[0]
        except bridge.PlanRefused:
            return None

    def plan_of(self, char: Char) -> Plan:
        """The plan the player kept for her, else the card's default."""
        return self.stored_plan(char.key) or needs_engine.default_plan(char.build, char.card)

    def readiness_now(self, char: Char) -> readiness.Readiness:
        if char.build is None:
            return readiness.score(None, char.card, self.refs, {})
        return readiness.score(char.build, char.card, self.refs, stats.combat_now(char.build, char.card, self.refs))

    def readiness_after(self, char: Char, plan: Plan | None = None) -> readiness.Readiness:
        """Her readiness once her plan is done."""
        if char.build is None:
            return readiness.score(None, char.card, self.refs, {})
        plan = plan or self.plan_of(char)
        after = stats.apply_plan(char.build, plan, char.card, self.refs)
        combat = stats.combat(char.build, plan, char.card, self.refs)
        return readiness.score(after, char.card, self.refs, combat, weapon_level=plan.weapon_level)

    # ------------------------------------------------------------------------------------------ materials
    def costs_of(self, char: Char, plan: Plan) -> Costs:
        tables = reference.load_tables()
        weapon = self.weapon_page(plan.weapon) if plan.weapon else None
        held = char.build.weapon if char.build else None
        if weapon is None and held is not None and (not plan.weapon or plan.weapon == held.key):
            weapon = self.weapon_page(held.key)
        rarity = str(weapon.rarity if weapon and weapon.rarity else held.rarity if held else 5)
        page = char.page
        return Costs(
            talent=dict(page.talent_costs) if page else {}, ascension=dict(page.ascension_costs) if page else {},
            weapon=dict(weapon.ascension_costs) if weapon else {}, exp=tuple(tables["exp"]),
            weapon_exp=tuple(tables["weapon_exp"].get(rarity, ())), level_phase=bridge.ASCENSION_LEVELS,
        )

    def held_by_calculator(self) -> dict[str, tuple[int, bool]]:
        def make() -> dict[str, tuple[int, bool]]:
            calc = self.calculator()
            if calc is None:
                return {}
            items = [
                CalcItemRecord(int(i["id"]), str(i["name"]), str(i["icon"]), int(i["amount"]), int(i["lacking"]))
                for entries in (calc.get("items") or {}).values() for i in entries
            ]
            held = needs_engine.held_from_calculator(items, bool(calc.get("has_user_info")))
            for material, books in EXP_BOOKS.items():
                found = [(held[book], points) for book, points in books.items() if book in held]
                if found:   # held as EXP points; one "at least" reading, or a book the answer does not name, makes it "at least"
                    exact = len(found) == len(books) and all(e for (_, e), _ in found)
                    held[material] = (sum(count * points for (count, _), points in found), exact)
            return held

        return self._once("held_calculator", make)

    def calculator_state(self) -> str:
        calc = self.calculator()
        if calc is None:
            return "unknown"
        return "on" if calc.get("has_user_info") else "off"

    def _material_index(self) -> dict[str, Any]:
        return self._once(
            "materials", lambda: {slug(row.name): row for row in self._store.wiki_entries("material").values()}
        )

    def material_info(
        self, key: str, hints: Mapping[str, tuple[str, str | None]] | None = None
    ) -> tuple[str, str | None, Source]:
        """A material's name, the address of its picture on HoYoverse's servers, and where it comes from."""
        if key == MORA:
            return "Mora", MORA_ICON, Source("ley", "Ley Line Outcrops: Blossom of Wealth", ())
        if key in EXP_SOURCES:
            name, where = EXP_SOURCES[key]
            return name, None, Source("ley", where, ())
        name, icon = (hints or {}).get(key, (None, None))
        row = self._material_index().get(key)
        source = Source("unknown", "", ())
        if row is not None:
            try:
                page = self._wiki.material_page(row)
                name, icon, source = page.name, page.icon or icon, page.source
            except Exception:
                log.warning("A material's wiki entry could not be read.", exc_info=True)
        flower = self.refs.flowers.get(key)
        if flower is not None and source.kind in ("unknown", "flowers"):
            source = Source("flowers", flower.places, ())
            name = name or flower.name
        return name or key.replace("-", " ").capitalize(), icon, source

    def material_hints(self, char: Char, plan: Plan) -> dict[str, tuple[str, str | None]]:
        hints: dict[str, tuple[str, str | None]] = {}
        if char.page is not None:
            for key, (name, icon, _entry) in char.page.material_names.items():
                hints[key] = (name, icon)
        row = self.weapon_row(plan.weapon)
        if row is not None:
            for key, (name, icon, _entry) in materials_of(row).items():
                hints.setdefault(key, (name, icon))
        for entries in ((self.calculator() or {}).get("items") or {}).values():
            for item in entries:
                hints.setdefault(slug(str(item["name"])), (str(item["name"]), str(item["icon"]) or None))
        return hints

    def needs_of(self, char: Char, plan: Plan, amounts: Mapping[str, int] | None = None) -> tuple[Need, ...]:
        """What her plan takes, with what is held (the calculator's, else what the player typed) and where each comes from."""
        taken = dict(amounts) if amounts is not None else needs_engine.amounts(char.build, plan, self.costs_of(char, plan))
        hints = self.material_hints(char, plan)
        sources: dict[str, Source] = {}
        names: dict[str, tuple[str, str | None]] = {}
        for key in taken:
            name, icon, source = self.material_info(key, hints)
            sources[key] = source
            names[key] = (name, self.address(icon))
        return needs_engine.needs(taken, self._held(), self.typed(), sources, names)

    def _held(self) -> dict[str, tuple[int, bool]]:
        """What the calculator says is held, but for the EXP the player typed: the calculator names only the books it counts,
        so what the player typed of `character-exp` and `weapon-exp` wins over their total."""
        held = dict(self.held_by_calculator())
        for material in EXP_BOOKS:
            if material in self.typed():
                held.pop(material, None)
        return held

    def typed_keys(self) -> set[str]:
        """The materials whose held amount is what the player typed: the calculator does not say."""
        return set(self.typed()) - set(self._held())

    # ------------------------------------------------------------------------------------------ resin
    def resin(self) -> Resin:
        """The resin today's plan starts from: the game day's first Notes read, so that a tick and the next sync never count
        the same resin twice. Without a read, a day's worth."""
        if self._day_resin is not None:
            given = self._day_resin()
            if given is not None:
                return Resin(*given)
        today = self.today()
        kept = self._store.meta("characters_day_resin")
        if kept is not None:
            try:
                base = json.loads(kept)
                if base.get("day") == today.isoformat():
                    return Resin(int(base["resin"]), int(base["max"]), int(base["discounts"]))
            except (ValueError, KeyError, TypeError):
                pass
        doc = self._store.latest_doc("notes")
        if doc is None:
            return Resin(200, 200, 3)
        read_at, notes = doc
        found = Resin(
            self._resin_at(notes, read_at, self._clock.now()), int(notes["resin_max"]), int(notes["boss_discounts_left"])
        )
        if game_day(read_at, self._server()) == today:
            self._store.set_meta("characters_day_resin", json.dumps({
                "day": today.isoformat(), "resin": found.now, "max": found.top, "discounts": found.discounts,
                "read_at": read_at.isoformat(),
            }))
        return found

    @staticmethod
    def _resin_at(notes: Mapping[str, Any], read_at: datetime, now: datetime) -> int:
        resin, top = int(notes["resin"]), int(notes["resin_max"])
        if resin >= top:
            return resin
        full_at = notes.get("resin_full_at")
        if full_at:
            left = (datetime.fromisoformat(full_at) - now).total_seconds()
            return top if left <= 0 else max(resin, top - math.ceil(left / (8 * 60)))
        return max(resin, min(top, resin + int((now - read_at).total_seconds() // (8 * 60))))

    # ------------------------------------------------------------------------------------------ the sync
    def sync_view(self) -> dict[str, Any]:
        """The CharSync of every page: when the builds were read, what the calculator says and whether Refresh works."""
        state = self._sync()
        read_at = self.read_at()
        calculator = self.calculator_state()
        wait = state.get("wait_seconds")
        blocked = state.get("blocked")
        reading = bool(state.get("reading"))
        login = bool(state.get("login"))
        wait_minutes = max(1, math.ceil(wait / 60)) if wait else None
        message = None
        if login:
            message = LOGIN_FIRST
        elif calculator == "off":
            message = SYNC_OFF
        return {
            "can_refresh": not reading and not blocked and not login and wait_minutes is None,
            "wait_minutes": wait_minutes,
            "reading": reading,
            "blocked": blocked or None,
            "read_at": read_at.isoformat(timespec="seconds") if read_at is not None else None,
            "calculator": calculator,
            "message": message,
            "every_minutes": int(CADENCE["characters"].total_seconds() // 60),
        }

    # ------------------------------------------------------------------------------------------ pity
    def pity_of(self, name: str) -> list[dict[str, Any]]:
        """Each copy of a 5-star character the kept wish history has, oldest first; in the demo, the story it gives her, where the
        demo's wishes hold none."""
        found = self._pity_in_history(name)
        if not found and self._demo:
            from guildboard.characters import demo as characters_demo

            return characters_demo.pity_story(name.strip().lower().replace(" ", "-"))
        return found

    def _pity_in_history(self, name: str) -> list[dict[str, Any]]:
        uid = self._pulls.uid() or self._pulls.account_uid()
        if uid is None:
            return []
        story: list[tuple[datetime, dict[str, Any]]] = []
        for pool, state in self._pulls.states(uid).items():
            lost: str | None = None
            for five in state.fives:
                if five.wish.name.strip().lower() == name.strip().lower():
                    result = five.result if five.result in ("won", "lost", "guaranteed", "featured") else None
                    story.append((five.wish.at, {
                        "at": five.wish.at.astimezone(server_tz(self._server())).date().isoformat(), "pity": five.pity,
                        "result": result, "banner": POOL_LABELS.get(pool, pool.capitalize()),
                        "after": lost if five.result == "guaranteed" else None,
                    }))
                if five.result == "lost":
                    lost = five.wish.name
        return [entry for _, entry in sorted(story, key=lambda item: item[0])]

    # ------------------------------------------------------------------------------------------ the models
    def roster(self) -> dict[str, Any]:
        from guildboard.views.characters import build_roster

        with self.scope():
            return build_roster(self)

    def profile(self, key: str) -> dict[str, Any]:
        from guildboard.views.characters import build_profile

        with self.scope():
            char = self.char(key)
            if char is None:
                raise UnknownCharacter(key)
            return build_profile(self, char)

    def planner(self, key: str) -> dict[str, Any]:
        from guildboard.views.characters import build_planner

        with self.scope():
            char = self.char(key)
            if char is None:
                raise UnknownCharacter(key)
            return build_planner(self, char)

    def week_plan(
        self, horizon: int = HORIZON_DAYS, *, ticks: bool = True
    ) -> tuple[WeekPlan, list[FocusInput], list[Char]]:
        """The plan of the focus (up to four), from the resin the day began with, and the focus it was made for."""
        chars = [c for c in (self.char(key) for key in self.focus()) if c is not None]
        inputs = [self.focus_input(char) for char in chars]
        today = self.today()
        resin = self.resin()
        ticked = self._store.ticks(self.uid(), week_start(today))
        done_today = frozenset(task for day, task in ticked if day == today)
        weekly = frozenset(task for _, task in ticked if _is_weekly(task))
        plan = week_engine.plan(
            inputs, resin.now, resin.top, resin.discounts, today, self.refs,
            ticks=done_today if ticks else frozenset(), weekly_done=weekly, horizon=horizon,
        )
        return plan, inputs, chars

    def week(self) -> dict[str, Any]:
        from guildboard.views.week import build_week

        with self.scope():
            return build_week(self)

    def today_model(self) -> dict[str, Any]:
        """The Today widget's model: the week's own first day."""
        return self.week()["today"]

    def endgame(self, after: bool = False) -> dict[str, Any]:
        from guildboard.views.endgame import build_endgame

        with self.scope():
            return build_endgame(self, after)

    def focus_input(self, char: Char) -> FocusInput:
        from guildboard.views.week import goal_text, luck_pieces

        plan = self.plan_of(char)
        return FocusInput(
            key=char.key, name=char.name, pronouns=char.card.pronouns, goal=goal_text(self, char, plan),
            needs=self.needs_of(char, plan), luck=luck_pieces(self, char, plan),
        )

    # ------------------------------------------------------------------------------------------ changes the player makes
    def put_focus(self, keys: Any) -> None:
        if not isinstance(keys, (list, tuple)) or not all(isinstance(key, str) for key in keys):
            raise CharactersRefused(BAD_SHAPE)
        kept = list(dict.fromkeys(keys))
        if len(kept) > FOCUS_MAX:
            raise CharactersRefused(FOUR_AT_MOST)
        known = set(self.keys())
        for key in kept:
            if key not in known:
                raise UnknownCharacter(key)
        self._store.put_focus(self.uid(), kept)
        self.wanted(*kept)
        self.wake()

    def put_plan(self, key: str, body: Any) -> None:
        with self.scope():
            char = self.char(key)
        if char is None:
            raise UnknownCharacter(key)
        try:
            plan, weights = bridge.plan_from_json(body)
        except bridge.PlanRefused as error:
            raise CharactersRefused(str(error)) from None
        now = self._clock.now()
        with self._store.transaction():
            self._store.put_char_plan(self.uid(), key, bridge.plan_to_json(plan), now)
            if weights is not None and weights != char.card.weights:
                edits = dict(self._store.card_edits(self.uid()).get(key, {}))
                edits["weights"] = weights
                self._store.put_card_edits(self.uid(), key, edits, now)
        self.wanted(key)
        self.wake()

    def drop_plan(self, key: str) -> None:
        with self.scope():
            known = self.char(key) is not None
        if not known:
            raise UnknownCharacter(key)
        self._store.drop_char_plan(self.uid(), key)
        self.wake()

    def put_card(self, key: str, fields: Any) -> None:
        """Edit fields of her card. A field set to null goes back to the card's own."""
        with self.scope():
            known = self.char(key) is not None
        if not known:
            raise UnknownCharacter(key)
        if not isinstance(fields, dict) or not fields or not all(name in bridge.EDITABLE for name in fields):
            raise CharactersRefused(NOT_A_FIELD)
        edits = dict(self._store.card_edits(self.uid()).get(key, {}))
        for name, value in fields.items():
            if value is None:
                edits.pop(name, None)
                continue
            try:
                if name == "goals" and isinstance(value, dict):
                    edits[name] = self._goal_edits(edits.get(name, {}), value)   # one goal at a time; null drops that goal's edit
                    if not edits[name]:
                        del edits[name]
                    continue
                edits[name] = bridge.jsonable(name, bridge.coerce_edit(name, value))
            except bridge.CardRefused:
                raise CharactersRefused(NOT_A_VALUE) from None
        self._store.put_card_edits(self.uid(), key, edits, self._clock.now())
        self.wake()

    @staticmethod
    def _goal_edits(kept: Mapping[str, Any], changes: Mapping[str, Any]) -> dict[str, Any]:
        """The goals the player edited, with these changes: a number sets that goal, null takes its edit away."""
        goals = dict(kept)
        for stat, goal in changes.items():
            if goal is None:
                goals.pop(stat, None)
            else:
                goals.update(bridge.coerce_edit("goals", {stat: goal}))
        return goals

    def drop_card(self, key: str) -> None:
        with self.scope():
            known = self.char(key) is not None
        if not known:
            raise UnknownCharacter(key)
        self._store.put_card_edits(self.uid(), key, {}, self._clock.now())
        self.wake()

    def put_held(self, amounts: Any) -> None:
        if not isinstance(amounts, dict) or not amounts:
            raise CharactersRefused(BAD_AMOUNTS)
        for key, amount in amounts.items():
            fits = amount is None or (
                isinstance(amount, int) and not isinstance(amount, bool) and 0 <= amount <= MAX_AMOUNT
            )
            if not isinstance(key, str) or not key or len(key) > 100 or not fits:
                raise CharactersRefused(BAD_AMOUNTS)
        self._store.put_held(self.uid(), amounts, self._clock.now())
        self.wake()

    def put_tick(self, day: Any, task: Any, done: Any) -> None:
        if not isinstance(day, str) or not isinstance(task, str) or not isinstance(done, bool):
            raise CharactersRefused(BAD_SHAPE)
        try:
            when = date.fromisoformat(day)
        except ValueError:
            raise CharactersRefused(NOT_TODAYS_TASK) from None
        if when != self.today():
            raise CharactersRefused(NOT_TODAYS_TASK)
        with self.scope():
            plan, _, _ = self.week_plan(horizon=1)
        if task not in {t.key for t in plan.days[0].tasks}:
            raise CharactersRefused(NOT_TODAYS_TASK)
        self._store.put_tick(self.uid(), when, task, done, self._clock.now())
        self.wake()

    def theater_month(self) -> str:
        today = self.today()
        return f"{today.year:04d}-{today.month:02d}"

    def put_theater(self, elements: Any) -> None:
        if (
            not isinstance(elements, list) or len(elements) != 3 or not all(isinstance(e, str) for e in elements)
            or len(set(elements)) != 3 or not all(e in ELEMENTS for e in elements)
        ):
            raise CharactersRefused(CHOOSE_THREE)
        self._store.put_theater_elements(self.uid(), self.theater_month(), elements, self._clock.now())
        self.wake()

    def drop_theater(self) -> None:
        """Back to the month's own elements: the pick is taken away, and the calendar's show again."""
        self._store.drop_theater_elements(self.uid(), self.theater_month())
        self.wake()

    # ------------------------------------------------------------------------------------------ the calculator's targets
    def calculator_targets(self) -> tuple[CalcTarget, ...]:
        """What the batch calculator is asked at each sync, for each focus character that is owned: level 90, each talent 10
        and the weapon 90, from where she stands now (design 4.1). A character not owned has no build to read levels from, so
        she is left out; her materials' held amounts come from the others' answers, or stay unknown."""
        targets = []
        with self.scope():
            for key in self.focus():
                record = self._records().get(key)
                char = self.char(key) if record is not None else None
                build = char.build if char is not None else None
                if record is None or build is None:
                    continue
                weapon = record.get("weapon")
                talents = []
                for kind, skill in bridge.talent_skills(record.get("skills", ())).items():
                    base = build.talents.get(kind, 0)
                    if base < 10:
                        talents.append((int(skill["id"]), base, 10))
                targets.append(CalcTarget(
                    character_id=int(record["id"]), level=(build.level, 90),
                    weapon=(int(weapon["id"]), int(weapon["level"]), 90) if weapon and weapon.get("id") else None,
                    talents=tuple(talents),
                ))
        return tuple(targets)

    # ------------------------------------------------------------------------------------------ reading the wiki
    def wake(self) -> None:
        """Look again now: something changed that the notices depend on."""
        self._woken.set()

    def wanted(self, *keys: str) -> None:
        """The pages wait for these characters' entries: they are read in the background, once the player has consented, and
        the pages are told when something was read. Nothing is asked before consent, and the demo has its own entries."""
        if self._demo or not self.AUTOMATIC_READS or not self._ready():
            return
        self._wanted.update(keys)
        if self._filler is None or self._filler.done():
            try:
                self._filler = asyncio.get_running_loop().create_task(self._fill())
            except RuntimeError:  # no loop: a test calling the service by hand
                self._filler = None

    async def _fill(self) -> None:
        try:
            while True:
                keys = sorted(self._wanted)
                self._wanted.clear()
                before = self._wiki_size()
                await self.read(keys)
                if self._wiki_size() != before:
                    self._bus.publish("characters_changed")
                if not self._wanted:
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("The wiki's entries for the Characters pages could not be read.", exc_info=True)

    # ------------------------------------------------------------------------------------------ warming the art cache
    def art_to_warm(self) -> list[str]:
        """The pictures of the characters the player has, in the order to fetch them: their faces, then the large art of those in
        the focus, then the art of the rest. Only addresses the art cache can use."""
        focus = self.focus()
        with self.scope():
            owned = [char for char in (self.char(key) for key in self.keys()) if char is not None and char.owned]
            faces = [char.icon for char in owned]
            owned.sort(key=lambda char: (char.key not in focus, focus.index(char.key) if char.key in focus else 0))
            arts = [self.art_url(char) for char in owned]
        urls = list(dict.fromkeys(url for url in faces + arts if url and self._art.usable(url)))
        return urls

    def warm_art(self) -> None:
        """After a characters sync: keep the pictures of the player's characters that are not kept yet, in the background, one at
        a time (the art cache's `warm`), for as long as it has room. Only after the player's consent, never in the demo, never
        twice at once, and never while the game runs: it waits for the game to close, then goes on."""
        if self._demo or not self.AUTOMATIC_READS or not self._ready():
            return
        if self._warmer is not None and not self._warmer.done():
            return
        try:
            self._warmer = asyncio.get_running_loop().create_task(self._warm())
        except RuntimeError:  # no loop: a test calling the service by hand
            self._warmer = None

    async def _warm(self) -> None:
        try:
            await self._art.warm(self.art_to_warm(), paused=self._game_running)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("The pictures of the Characters pages could not be fetched ahead.", exc_info=True)

    def _wiki_size(self) -> int:
        return self._store.wiki_entry_count()

    async def read(self, keys: Sequence[str]) -> None:
        """The entries these characters' pages need: theirs, their weapons', their sets', and the materials of their plans.
        Only after the player's consent."""
        if not self._ready():
            return
        await self._wiki.lists()
        # A character newer than the inventory is listed only once her entry says her element (`keys`), and her page cannot be
        # opened before she is listed: her entry is read here, once, as soon as the wiki's list names her.
        inventory = self.inventory()
        for key, row in self._wiki_characters().items():
            if key not in inventory and self._store.wiki_entry(row.entry_page_id) is None:
                await self._wiki.entry(row.entry_page_id, "character")
        for key in keys:
            entry = self._character_entry(key, self._records().get(key), self.inventory().get(key))
            if entry:
                await self._wiki.entry(entry, "character")
            char = self.char(key)
            if char is None:
                continue
            plan = self.plan_of(char)
            weapons = list(dict.fromkeys([
                *([char.build.weapon.key] if char.build and char.build.weapon else []),
                *([plan.weapon] if plan.weapon else []), *char.card.weapons[:3],
            ]))
            for weapon in weapons:
                weapon_entry = self._weapon_entry(weapon)
                if weapon_entry:
                    await self._wiki.entry(weapon_entry, "weapon")
            sets = list(dict.fromkeys(
                [piece.set_key for piece in (char.build.pieces.values() if char.build else ())]
                + [s for choice in char.card.sets for s in choice.sets] + (list(plan.set.sets) if plan.set else [])
            ))
            for set_key in sets:
                set_entry = self._set_entry(set_key)
                if set_entry:
                    await self._wiki.entry(set_entry, "set")
            wanted: set[str] = set()
            if char.page is not None:
                wanted.update(ident for _n, _i, ident in char.page.material_names.values())
            for weapon in weapons:
                row = self.weapon_row(weapon)
                if row is not None:
                    wanted.update(ident for _n, _i, ident in materials_of(row).values())
            for ident in sorted(wanted):
                await self._wiki.entry(ident, "material")

    # ------------------------------------------------------------------------------------------ the notices
    def note_day(self) -> None:
        """Remember the game day's first Notes read, when a sync has just brought it."""
        self.resin()

    def check(self) -> list[str]:
        """Send the notices that are due now, each at most once a game day, and say which kinds were sent. While Your week
        is hidden (`WEEK_AND_ENDGAME`) none is sent."""
        if not characters.WEEK_AND_ENDGAME:
            return []
        uid, now, today = self.uid(), self._clock.now(), self.today()
        with self.scope():
            plan, inputs, chars = self.week_plan(ticks=False)
        names = {char.key: char.name for char in chars}
        switches = {kind: bool(on) for kind, on in self._switches().items()}
        sent = self._store.notices_sent(uid, today - timedelta(days=1))
        ready_all = [
            (item.key, task.where)
            for task in plan.days[0].tasks if task.kind == "level" for item in inputs
            if item.key == task.who[0] and item.goal and plan.ready.get(item.key) == today
        ]
        fresh = [pair for pair in ready_all if f"{pair[0]}:{pair[1]}" not in self._announced]
        due = notices.due(now, self._server(), plan, names, switches, sent, fresh)
        kinds: list[str] = []
        for notice in due:
            # A click on a notice opens Your week; on a ready goal's alone, her profile: the shell reads it from the kind.
            kind = f"{NOTICE_KIND}/{fresh[0][0]}" if notice.kind == "ready" and len(fresh) == 1 else NOTICE_KIND
            shown = self._notify is None or self._notify(kind, f"{notice.title}. {notice.body}")
            if shown:
                self._store.add_notice_sent(uid, notice.kind, today, now)
                kinds.append(notice.kind)
        current = {f"{key}:{text}" for key, text in ready_all}
        told = {f"{key}:{text}" for key, text in fresh} if "ready" in kinds else set()
        self._announced = (self._announced & current) | told
        return kinds

    def next_wait(self) -> float:
        """Seconds until the notices need a look again: the next Sunday at 18:00 or the next 04:00 reset, whichever is
        sooner, and never longer than the longest wait."""
        now = self._clock.now()
        local = now.astimezone(server_tz(self._server()))
        reset = game_day_start(self.today() + timedelta(days=1), self._server())
        sunday = local.replace(hour=18, minute=0, second=0, microsecond=0) + timedelta(days=(6 - local.weekday()) % 7)
        if sunday <= local:
            sunday += timedelta(days=7)
        return max(1.0, min(LONGEST_WAIT, (reset - now).total_seconds(), (sunday - local).total_seconds()))

    async def run(self) -> None:
        """Look at the notices, then sleep until the next time one can be due, or until something changes."""
        queue = self._bus.subscribe()
        try:
            while True:
                self._woken.clear()
                try:
                    self.note_day()
                    if characters.WEEK_AND_ENDGAME:
                        self.check()
                    self.wanted(*self.focus())
                except Exception:  # a failed look must not end the loop
                    log.exception("the Characters notices could not be checked")
                sleeping = asyncio.ensure_future(self._sleep(self.next_wait()))
                woken = asyncio.ensure_future(self._woken.wait())
                heard = asyncio.ensure_future(self._synced(queue))
                try:
                    await asyncio.wait({sleeping, woken, heard}, return_when=asyncio.FIRST_COMPLETED)
                    if heard.done() and not heard.cancelled():
                        self.warm_art()  # a sync has finished: the pictures of what it read are kept ahead
                finally:
                    for task in (sleeping, woken, heard):
                        task.cancel()
                    await asyncio.gather(sleeping, woken, heard, return_exceptions=True)
        finally:
            self._bus.unsubscribe(queue)

    @staticmethod
    async def _synced(queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Until a sync has finished: its reads change what the plan holds."""
        while True:
            event = await queue.get()
            if event.get("type") == "sync_finished":
                return

    async def stop(self) -> None:
        for task in (self._filler, self._warmer):
            if task is not None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self._filler = self._warmer = None


def _is_weekly(task: str) -> bool:
    parts = task.split(":")
    return len(parts) >= 4 and parts[1] == "weekly"
