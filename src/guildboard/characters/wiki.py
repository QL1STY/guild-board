"""The HoYoLAB wiki for the Characters pages (the Characters design, section 4.3): the lists of characters, weapons and
artifact sets, and each entry read once for a game version, with the pages the Characters service shows made from the
entries.

Every request is a read of the wiki (a GET of one entry, or the POST that asks for a list and changes nothing), made
through the injected `fetch` on a thread, one at a time. Nothing is sent but the headers of `pulls/wiki.py`, and a failure
logs only what failed.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Mapping

from guildboard import netpolicy
from guildboard.characters.models import Source
from guildboard.clock import Clock
from guildboard.htmltext import MAX_FIELD_CHARS, strip_tags
from guildboard.metrics import slug
from guildboard.pulls import wiki as pulls_wiki
from guildboard.store import Store, WikiEntryRow, WikiItemRow

log = logging.getLogger(__name__)

# The injected read of one of HoYoverse's own pages (netpolicy.fetch_hoyoverse live, None in the demo).
Fetch = Callable[..., bytes]

ENTRY_URL = "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id="
LIST_MENUS = {"character": "2", "weapon": "4", "set": "5"}
HEADERS = pulls_wiki.HEADERS
PAGE_SIZE = pulls_wiki.PAGE_SIZE
MAX_PAGES = pulls_wiki.MAX_PAGES
LIST_EVERY = timedelta(days=1)  # a kind's list is read at most this often
LIST_RETRY = timedelta(minutes=15)  # after a list could not be read, it is tried again no sooner than this
MISSING_ASKED_AGAIN_AFTER = timedelta(days=1)  # an entry the wiki lacks is asked for again no sooner than this
NOT_FOUND = 404  # the retcode with which the wiki answers for an entry it does not have

# The modules of an entry that Guild Board keeps: the stories, voice-overs and videos are not read.
_KEPT_MODULES = {"Attributes", "Ascend", "Gallery", "Talents", "Constellation", "Set"}
# What a talent's table of levels and its pictures weigh is left out of what is kept.
_TALENT_DROPPED = ("attributes", "talent_img", "talent_imgs", "points")
# The entries whose costs are materials, which are named in the entry itself, not always in English.
_WITH_COSTS = ("character", "weapon")

_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
_POSITIONS = {
    "flower of life": "flower", "plume of death": "plume", "sands of eon": "sands", "goblet of eonothem": "goblet",
    "circlet of logos": "circlet",
}
# What the wiki names a stat, as the contract's stat key. An elemental "<Element> DMG Bonus" is the element's own `dmg`.
_STATS = {
    "hp": "hp_pct", "atk": "atk_pct", "def": "def_pct", "elemental mastery": "em", "energy recharge": "er",
    "crit rate": "cr", "crit dmg": "cd", "healing bonus": "heal", "physical dmg bonus": "phys",
}
_BASE_INFO_KEYS = {"name", "region", "source", "type", "secondary attributes", "version released"}
_BASE_STATS = {"Base HP": "hp", "Base ATK": "atk", "Base DEF": "def"}


# ------------------------------------------------------------------------------------------------ small parsers


def plain(text: Any, *, lines: bool = False) -> str:
    """The text of a piece of the wiki's HTML. Line breaks and paragraphs end a line; with `lines` the lines are kept,
    one to a line, and otherwise they are joined by a space."""
    marked = re.sub(r"<br\s*/?>|</p>|</li>|</h\d>|</tr>", "\n", str(text or "")[:MAX_FIELD_CHARS], flags=re.IGNORECASE)
    marked = html.unescape(strip_tags(marked)).replace("\xa0", " ")
    kept = [" ".join(line.split()) for line in marked.split("\n")]
    kept = [line for line in kept if line]
    return ("\n" if lines else " ").join(kept)


def stat_key(text: str | None) -> str | None:
    """The contract's stat key for a stat as the wiki names it ("CRIT DMG" is "cd"), or None when it is none of them."""
    name = " ".join(str(text or "").replace("\xa0", " ").lower().split())
    if name.endswith(" bonus") and name != "healing bonus" and "dmg" not in name:
        name = name[: -len(" bonus")]  # "CRIT Rate Bonus" is the ascension row's name for "CRIT Rate"
    if name in _STATS:
        return _STATS[name]
    if name.endswith("dmg bonus"):
        return "dmg"
    return None


def _number(value: Any) -> float | None:
    """A number the wiki writes as a number or as text ("20,000", "24.2%"); None when it is neither."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    found = re.search(r"-?\d[\d,]*(?:\.\d+)?", value) if isinstance(value, str) else None
    return float(found.group(0).replace(",", "")) if found else None


def _entries(text: Any) -> list[dict[str, Any]]:
    """The objects of a `$[{...}]$` string, which is how the wiki writes a material."""
    # From the first "$[" to the last "]$" after it, as the pattern `\$(\[.*\])\$` reads it, found by two scans: the pattern
    # reads to the end from every "$[" that no "]$" follows.
    whole = str(text or "")[:MAX_FIELD_CHARS]
    start = whole.find("$[")
    end = whole.rfind("]$")
    if start < 0 or end < start + 2:
        return []
    found = whole[start + 1:end + 1]
    try:
        listed = json.loads(found)
    except ValueError:
        return []
    return [item for item in listed if isinstance(item, dict)] if isinstance(listed, list) else []


def _english(text: str) -> bool:
    """Whether a name is in the script this build keys by: the wiki wrote the materials of some entries in another."""
    return bool(text) and all(ord(char) < 0x250 for char in text)


def _days(text: str) -> tuple[int, ...]:
    found = sorted({_WEEKDAYS[word.lower()] for word in re.findall(r"[A-Za-z]+", text) if word.lower() in _WEEKDAYS})
    return tuple(found) if len(found) < 7 else ()


def parse_source(source_text: str, type_text: str) -> Source:
    """Where a material comes from, from the wiki's `Source` text and its type: a book or weapon-material domain with its
    days, a weekly boss, a world boss, a local specialty, enemies, a ley line or the crafting bench; anything else is
    unknown."""
    text = " ".join(str(source_text or "")[:MAX_FIELD_CHARS].split())
    kind = str(type_text or "")
    domain = re.match(r"Domain of (Mastery|Forgery)\s*:\s*(.+?)\s*(?:\(([^()]*)\))?\s*$", text)
    if domain:
        kinds = {"Mastery": "books", "Forgery": "forgery"}
        return Source(kinds[domain.group(1)], domain.group(2).strip(), _days(domain.group(3) or ""))
    weekly = re.match(r"Lv\.?\s*\d+\+?\s+(.+?)\s+Challenge Reward", text)
    if weekly:
        return Source("weekly", weekly.group(1).strip(), ())
    dropped = re.match(r"Dropped by\s+(?:Lv\.?\s*\d+\+?\s+)?(.+)$", text)
    if dropped:
        # A world boss's drops are the level-up materials; every other drop is an enemy's.
        return Source("boss" if "Level-Up Material" in kind else "enemies", dropped.group(1).strip(), ())
    found_in = re.search(r"Found in\s+(.+)$", text)
    if found_in and "Local Specialty" in kind:
        return Source("flowers", found_in.group(1).strip(), ())
    if "ley line" in text.lower():
        return Source("ley", text, ())
    if re.match(r"(Crafted|Crafting)\b", text):
        return Source("crafted", text, ())
    return Source("unknown", text, ())


# ------------------------------------------------------------------------------------------------ the wiki


class CharacterWiki:
    def __init__(self, store: Store, clock: Clock, fetch: Fetch | None, version: Callable[[], str]) -> None:
        self._store = store
        self._clock = clock
        self._fetch = fetch
        self._version = version
        self._lock = asyncio.Lock()  # one read at a time, so that the one that waits finds what was just read
        self._missing: dict[str, datetime] = {}  # entries the wiki lacks, by kind and id, and when each was asked for
        self._list_tried: dict[str, datetime] = {}  # when each kind's list was last read, or failed to be

    # ---------------------------------------------------------------------------------------------- lists
    async def lists(self) -> None:
        """The lists of characters, weapons and sets, into wiki_items; once a day per kind. A list that cannot be read
        leaves what was kept, and is tried again after a quarter of an hour."""
        if self._fetch is None:
            return
        async with self._lock:
            now = self._clock.now()
            kept = self._store.wiki_items()
            for kind, menu in LIST_MENUS.items():
                newest = max((row.read_at for (item_kind, _), row in kept.items() if item_kind == kind), default=None)
                if newest is not None and 0 <= (now - newest).total_seconds() < LIST_EVERY.total_seconds():
                    continue
                tried = self._list_tried.get(kind)
                if tried is not None and 0 <= (now - tried).total_seconds() < LIST_RETRY.total_seconds():
                    continue
                self._list_tried[kind] = now
                try:
                    rows = await self._read_list(kind, menu, now)
                except Exception as error:
                    log.warning(
                        "The HoYoLAB wiki's %s list could not be read (%s). What was kept stays.",
                        kind, netpolicy.what_failed(error),
                    )
                    continue
                self._store.replace_wiki_items(kind, rows)

    async def _read_list(self, kind: str, menu: str, now: datetime) -> list[WikiItemRow]:
        """Every page of a kind's list. A list with no entry is not the game's: ValueError, so that what was kept stays."""
        rows, total = await self._read_page(kind, menu, 1, now)
        for page in range(2, min(math.ceil(total / PAGE_SIZE), MAX_PAGES) + 1):
            rows.extend((await self._read_page(kind, menu, page, now))[0])
        if not rows:
            raise ValueError(f"the wiki's {kind} list is empty")
        return rows

    async def _read_page(self, kind: str, menu: str, page: int, now: datetime) -> tuple[list[WikiItemRow], int]:
        asked = {"filters": [], "menu_id": menu, "page_num": page, "page_size": PAGE_SIZE, "use_es": True}
        body = await asyncio.to_thread(
            self._fetch, pulls_wiki.WIKI_URL, headers=HEADERS, body=json.dumps(asked).encode("utf-8")
        )
        return pulls_wiki.parse_items(kind, body, now)

    # ---------------------------------------------------------------------------------------------- entries
    async def entry(self, entry_page_id: str, kind: str) -> WikiEntryRow | None:
        """An entry, kept for the game's version and read again when it moves. One the wiki lacks is asked for again no
        sooner than a day later. When a read fails, the entry kept stays (an older version's, if that is all there is)."""
        async with self._lock:
            return await self._load(str(entry_page_id), kind)

    async def _load(self, entry_page_id: str, kind: str) -> WikiEntryRow | None:
        kept = self._store.wiki_entry(entry_page_id)
        if kept is not None and kept.kind != kind:
            kept = None
        if kept is not None and kept.version == self._version():
            return kept
        if self._fetch is None or not entry_page_id.isascii() or not entry_page_id.isdigit():
            return kept
        now = self._clock.now()
        asked = self._missing.get(f"{kind}:{entry_page_id}")
        if asked is not None and 0 <= (now - asked).total_seconds() < MISSING_ASKED_AGAIN_AFTER.total_seconds():
            return kept
        try:
            body = await asyncio.to_thread(self._fetch, ENTRY_URL + entry_page_id, headers=HEADERS)
            data = self._parse_entry(body, entry_page_id)
        except Exception as error:
            log.warning(
                "The HoYoLAB wiki's %s entry could not be read (%s). What was kept stays.", kind, netpolicy.what_failed(error)
            )
            return kept
        if data is None:  # the wiki has no such entry (yet)
            self._missing[f"{kind}:{entry_page_id}"] = now
            return kept
        self._missing.pop(f"{kind}:{entry_page_id}", None)
        if kind in _WITH_COSTS:
            data["names"] = await self._english_names(data)
        row = WikiEntryRow(entry_page_id, kind, str(data["name"]), data, self._version(), now)
        self._store.put_wiki_entry(row)
        return row

    @staticmethod
    def _parse_entry(body: bytes, entry_page_id: str) -> dict[str, Any] | None:
        """What Guild Board keeps of an entry's answer: its name and picture, its filters, and the parsed components of the
        modules it reads. None when the wiki says it has no such entry; ValueError when the answer is not an entry's."""
        answer = json.loads(body)
        if not isinstance(answer, dict):
            raise ValueError("the wiki's entry cannot be read")
        if answer.get("retcode") == NOT_FOUND:
            return None
        data = answer.get("data")
        page = data.get("page") if isinstance(data, dict) else None
        if answer.get("retcode") != 0 or not isinstance(page, dict) or not page.get("name"):
            raise ValueError("the wiki's entry cannot be read")
        modules: dict[str, dict[str, Any]] = {}
        for module in page.get("modules") or []:
            if not isinstance(module, dict) or module.get("name") not in _KEPT_MODULES:
                continue
            parsed = modules.setdefault(module["name"], {})
            for component in module.get("components") or []:
                try:
                    value = json.loads(component["data"])
                except (KeyError, TypeError, ValueError):
                    continue
                if component.get("component_id") == "talent" and isinstance(value, dict):
                    for talent in value.get("list") or []:
                        if isinstance(talent, dict):
                            talent["leveled"] = bool(talent.get("attributes"))  # only a talent with levels has a table
                            for field in _TALENT_DROPPED:
                                talent.pop(field, None)
                parsed[str(component.get("component_id"))] = value
        filters = page.get("filter_values")
        return {
            "id": str(page.get("id") or entry_page_id),
            "name": str(page["name"]).strip(),
            "icon": str(page.get("icon_url") or ""),
            "menu": str(page.get("menu_id") or ""),
            "filters": {
                str(key): [str(value) for value in (item.get("values") or [])]
                for key, item in (filters.items() if isinstance(filters, dict) else ())
                if isinstance(item, dict)
            },
            "modules": modules,
        }

    async def _english_names(self, data: dict[str, Any]) -> dict[str, str]:
        """The English name of each material of a character or weapon whose own text is not English: the wiki wrote some
        entries' materials in another language, and a material's key is the slug of its English name. Each is read from the
        material's own entry, which is kept, so it is read once."""
        names: dict[str, str] = {}
        for ident, name in _material_texts(data).items():
            if _english(name):
                continue
            row = await self._load(ident, "material")
            if row is not None:
                names[ident] = row.name
        return names

    # ---------------------------------------------------------------------------------------------- pages
    def character_page(self, row: WikiEntryRow) -> CharacterPage:
        data = row.data
        info = _base_info(data)
        gallery = {
            str(item.get("key", "")).strip(): str(item.get("img") or "")
            for item in _module(data, "Gallery", "gallery_character").get("list") or []
            if isinstance(item, dict)
        }
        stat = _filter(data, "character_property") or ""
        names = _names(data)
        rows = _ascension_rows(data)
        costs = _phases(rows, names)
        upgradable = [talent for talent in _talent_list(data) if _upgrade_rows(talent)]
        talent_costs: dict[int, tuple[tuple[str, int], ...]] = {}
        for index, materials in enumerate(_upgrade_rows(upgradable[0]) if upgradable else []):
            if materials:
                talent_costs[index + 1] = _costs(materials, names)
        return CharacterPage(
            key=slug(row.name),
            name=row.name,
            entry=row.entry_page_id,
            icon=str(data.get("icon") or "") or None,
            art=gallery.get("Avatar") or None,
            chart=gallery.get("Constellation") or None,
            title=plain(_line(info, "Title")),
            affiliation=plain(_line(info, "Affiliation")),
            birthday=plain(_line(info, "Birthday")),
            version=plain(_line(info, "Version Released")),
            dish=next((str(item.get("name", "")) for item in _entries(_line(info, "Special Dish")) if item.get("name")), ""),
            element=_filter(data, "character_vision") or "",
            weapon_type=_filter(data, "character_weapon") or "",
            rarity=int(_number(_filter(data, "character_rarity")) or 0),
            ascension_stat=stat,
            talents=_talents(data),
            constellations=_constellations(data),
            own=_own(rows, stat_key(stat)),
            talent_costs=talent_costs,
            ascension_costs=costs,
            material_names=_material_names(data, names, costs, talent_costs),
        )

    def weapon_page(self, row: WikiEntryRow) -> WeaponPage:
        data = row.data
        info = _base_info(data)
        rows = _ascension_rows(data)
        passive = next((key for key in info if key.lower() not in _BASE_INFO_KEYS), "")
        last = rows[-1] if rows else {}
        header = _combat_header(last)
        base, sub_value = _weapon_values(last)
        sub = plain(_line(info, "Secondary Attributes")) or (header[2] if len(header) > 2 else "")
        return WeaponPage(
            key=slug(row.name),
            name=row.name,
            entry=row.entry_page_id,
            icon=str(data.get("icon") or "") or None,
            type=_filter(data, "weapon_type") or plain(_line(info, "Type")),
            rarity=int(_number(_filter(data, "weapon_rarity")) or 0),
            base_atk_90=base,
            sub=sub or None,
            sub_90=sub_value if sub else 0.0,
            passive=passive,
            texts=_refinements(_line(info, passive)) if passive else (),
            ascension_costs=_phases(rows, _names(data)),
        )

    def set_page(self, row: WikiEntryRow) -> SetPage:
        data = row.data
        icons: dict[str, str] = {}
        for piece in _module(data, "Set", "artifact_list").values():  # by `position`: the wiki's keys are mixed up
            if isinstance(piece, dict):
                slot = _POSITIONS.get(str(piece.get("position", "")).strip().lower())
                if slot and piece.get("icon_url"):
                    icons[slot] = str(piece["icon_url"])
        effect = _module(data, "Attributes", "reliquary_set_effect")
        return SetPage(
            key=slug(row.name),
            name=row.name,
            entry=row.entry_page_id,
            icons=icons,
            two_text=plain(effect.get("two_set_effect")),
            four_text=plain(effect.get("four_set_effect")),
        )

    def material_page(self, row: WikiEntryRow) -> MaterialPage:
        data = row.data
        info = _base_info(data)
        type_text = plain(_line(info, "Type")) or (_filter(data, "filter_key_50") or "")
        return MaterialPage(
            id=int(row.entry_page_id) if row.entry_page_id.isdigit() else 0,
            name=row.name,
            icon=str(data.get("icon") or "") or None,
            type_text=type_text,
            source=parse_source(plain(_line(info, "Source")), type_text),
        )


# ------------------------------------------------------------------------------------------------ reading an entry


def _module(data: Mapping[str, Any], module: str, component: str) -> dict[str, Any]:
    found = ((data.get("modules") or {}).get(module) or {}).get(component)
    return found if isinstance(found, dict) else {}


def _filter(data: Mapping[str, Any], key: str) -> str | None:
    values = (data.get("filters") or {}).get(key) or []
    return str(values[0]).strip() if values else None


def _base_info(data: Mapping[str, Any]) -> dict[str, Any]:
    """The `Attributes` table, by the name the wiki gives each line (with its spaces trimmed), in the wiki's order."""
    return {
        str(item.get("key", "")).strip(): item.get("value")
        for item in _module(data, "Attributes", "baseInfo").get("list") or []
        if isinstance(item, dict)
    }


def _line(info: Mapping[str, Any], key: str) -> Any:
    """The text of one line of the table, which the wiki keeps in a list of one."""
    value = info.get(key)
    return value[0] if isinstance(value, list) and value else value


def _names(data: Mapping[str, Any]) -> dict[str, str]:
    names = data.get("names")
    return {str(key): str(value) for key, value in names.items()} if isinstance(names, dict) else {}


def _talent_list(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [talent for talent in _module(data, "Talents", "talent").get("list") or [] if isinstance(talent, dict)]


def _ascension_rows(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [row for row in _module(data, "Ascend", "ascension").get("list") or [] if isinstance(row, dict)]


def _upgrade_rows(talent: Mapping[str, Any]) -> list[Any]:
    """A talent's costs by the level reached: index 1 is level 2. A talent that cannot be upgraded has none."""
    materials = talent.get("materials")
    return list(materials) if isinstance(materials, list) and any(materials) else []


def _cost_texts(data: Mapping[str, Any]) -> list[Any]:
    """Every list of material strings an entry holds: the ascension rows' and each talent level's."""
    texts: list[Any] = [row.get("materials") for row in _ascension_rows(data)]
    for talent in _talent_list(data):
        texts.extend(_upgrade_rows(talent))
    return texts


def _material_texts(data: Mapping[str, Any]) -> dict[str, str]:
    """Every material an entry names in its costs, by the wiki's id, with the name the wiki wrote for it there."""
    found: dict[str, str] = {}
    for texts in _cost_texts(data):
        for text in texts or []:
            for item in _entries(text):
                name = str(item.get("name") or item.get("nickname") or "").strip()
                if item.get("ep_id") is not None and name:
                    found.setdefault(str(item["ep_id"]), name)
    return found


def _costs(texts: Any, names: Mapping[str, str]) -> tuple[tuple[str, int], ...]:
    """A level's cost: (material key, amount) for each material, the key being the slug of the material's English name."""
    costs = []
    for text in texts or []:
        for item in _entries(text):
            amount = _number(item.get("amount"))
            name = names.get(str(item.get("ep_id"))) or str(item.get("name") or item.get("nickname") or "").strip()
            if amount and amount > 0 and name:
                costs.append((slug(name), int(amount)))
    return tuple(costs)


def _phases(rows: list[dict[str, Any]], names: Mapping[str, str]) -> dict[int, tuple[tuple[str, int], ...]]:
    """What each phase of ascension costs: the rows that have a cost, in order, are phases 1 to 6."""
    costs: dict[int, tuple[tuple[str, int], ...]] = {}
    for row in rows:
        materials = _costs(row.get("materials"), names)
        if materials:
            costs[len(costs) + 1] = materials
    return costs


def _material_names(
    data: Mapping[str, Any], names: Mapping[str, str], *costs: Mapping[int, tuple[tuple[str, int], ...]]
) -> dict[str, tuple[str, str | None, str]]:
    """Each material the costs name, by key: its English name, its picture and its entry in the wiki."""
    wanted = {key for cost in costs for materials in cost.values() for key, _ in materials}
    found: dict[str, tuple[str, str | None, str]] = {}
    for texts in _cost_texts(data):
        for text in texts or []:
            for item in _entries(text):
                ident = str(item.get("ep_id"))
                name = names.get(ident) or str(item.get("name") or item.get("nickname") or "").strip()
                key = slug(name) if name else ""
                if key in wanted and key not in found:
                    found[key] = (name, str(item.get("icon") or item.get("img") or "") or None, ident)
    return found


def materials_of(row: WikiEntryRow) -> dict[str, tuple[str, str | None, str]]:
    """Every material a character's or a weapon's costs name, by key: its English name, its picture and its entry in the
    wiki. A weapon's page names its materials by their entries only here; the service reads each entry once."""
    data, names = row.data, _names(row.data)
    found: dict[str, tuple[str, str | None, str]] = {}
    for texts in _cost_texts(data):
        for text in texts or []:
            for item in _entries(text):
                ident = str(item.get("ep_id"))
                name = names.get(ident) or str(item.get("name") or item.get("nickname") or "").strip()
                if name and item.get("ep_id") is not None:
                    found.setdefault(slug(name), (name, str(item.get("icon") or item.get("img") or "") or None, ident))
    return found


def _talents(data: Mapping[str, Any]) -> tuple[tuple[str, str, str | None, str], ...]:
    """(kind, name, icon, text). The talents that have levels are the normal attack first, the skill second and the burst
    last; a leveled talent between them (an alternate sprint) and every talent with no levels are passives."""
    talents = _talent_list(data)
    leveled = [index for index, talent in enumerate(talents) if talent.get("leveled")]
    kinds = {}
    if leveled:
        kinds[leveled[0]] = "normal"
    if len(leveled) > 1:
        kinds[leveled[1]] = "skill"
    if len(leveled) > 2:
        kinds[leveled[-1]] = "burst"
    return tuple(
        (
            kinds.get(index, "passive"),
            plain(talent.get("title")),
            str(talent.get("icon_url") or "") or None,
            plain(talent.get("desc"), lines=True),
        )
        for index, talent in enumerate(talents)
    )


def _constellations(data: Mapping[str, Any]) -> tuple[tuple[str, str | None, str], ...]:
    listed = _module(data, "Constellation", "summaryList").get("list") or []
    return tuple(
        (plain(item.get("name")), str(item.get("icon_url") or "") or None, plain(item.get("desc"), lines=True))
        for item in listed[:6]
        if isinstance(item, dict)
    )


def _combat_lines(row: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [line for line in row.get("combatList") or [] if isinstance(line, dict)]


def _combat_header(row: Mapping[str, Any]) -> list[str]:
    for line in _combat_lines(row):
        if not line.get("key"):
            return [str(value) for value in line.get("values") or []]
    return []


def _weapon_values(row: Mapping[str, Any]) -> tuple[float, float]:
    """A weapon's ATK and secondary stat at the row's level: the line after the header, as (ATK, the stat's value)."""
    unnamed = [line.get("values") or [] for line in _combat_lines(row) if not line.get("key")]
    numbers = unnamed[1] if len(unnamed) > 1 else []
    atk = _number(numbers[0]) if numbers else None
    sub = _number(numbers[2]) if len(numbers) > 2 else None
    return atk or 0.0, sub or 0.0


def _own(rows: list[dict[str, Any]], bonus: str | None) -> dict[int, dict[str, float]]:
    """The character's own base HP, ATK and DEF and her ascension stat's bonus at the levels the wiki gives. A level that
    ends a phase has two states: before it is ascended, kept under that level; and after, kept under the next level, which
    is as near to that state as the wiki gives (the next level's own growth is not counted). Level 1 has only its after,
    and level 90 only its before."""
    result: dict[int, dict[str, float]] = {}
    for row in rows:
        level = _number(str(row.get("key", "")).replace("Lv.", ""))
        if level is None:
            continue
        lines = [(str(line.get("key", "")), line.get("values") or []) for line in _combat_lines(row) if line.get("key")]
        for position, key in ((0, int(level)), (1, 1 if int(level) == 1 else int(level) + 1)):
            values: dict[str, float] = {}
            for name, texts in lines:
                number = _number(texts[position]) if len(texts) > position and texts[position] != "-" else None
                if number is None:
                    continue
                if name in _BASE_STATS:
                    values[_BASE_STATS[name]] = number
                elif not name.startswith("Base ") and bonus:
                    values[bonus] = number
            if values:
                result[key] = values
    return dict(sorted(result.items()))


_REFINED = re.compile(r"(?<![\w/.])\d+(?:[.,]\d+)*[%a-z]*(?:/\d+(?:[.,]\d+)*[%a-z]*){4}(?![\w/])", flags=re.IGNORECASE)


def _refinements(text: Any) -> tuple[str, ...]:
    """A passive's text for each of the five refinements: where the text gives a value for each ("28%/35%/42%/49%/56%"),
    refinement one takes the first, and so on."""
    value = plain(text, lines=True)
    return tuple(_REFINED.sub(lambda found, at=at: found.group(0).split("/")[at], value) for at in range(5))


# ------------------------------------------------------------------------------------------------ the pages


@dataclass(frozen=True)
class CharacterPage:
    key: str
    name: str
    entry: str
    icon: str | None
    art: str | None
    chart: str | None
    title: str
    affiliation: str
    birthday: str
    version: str
    dish: str
    element: str
    weapon_type: str
    rarity: int
    ascension_stat: str
    talents: tuple[tuple[str, str, str | None, str], ...]            # (kind, name, icon, text); kind "normal" | "skill" | "burst" | "passive"
    constellations: tuple[tuple[str, str | None, str], ...]          # (name, icon, text), C1..C6
    own: dict[int, dict[str, float]]                                 # level -> her own base hp, atk, def and ascension-stat bonus, at each phase's levels
    talent_costs: dict[int, tuple[tuple[str, int], ...]]             # level reached (2..10) -> (material key, amount)
    ascension_costs: dict[int, tuple[tuple[str, int], ...]]          # phase (1..6) -> (material key, amount)
    material_names: dict[str, tuple[str, str | None, str]]           # key -> (name, icon, wiki entry id), for every material above


@dataclass(frozen=True)
class WeaponPage:
    key: str
    name: str
    entry: str
    icon: str | None
    type: str
    rarity: int
    base_atk_90: float
    sub: str | None
    sub_90: float
    passive: str
    texts: tuple[str, ...]
    ascension_costs: dict[int, tuple[tuple[str, int], ...]]          # phase (1..6) -> (material key, amount)


@dataclass(frozen=True)
class SetPage:
    key: str
    name: str
    entry: str
    icons: dict[str, str]                                            # by slot, from each piece's `position`
    two_text: str
    four_text: str


@dataclass(frozen=True)
class MaterialPage:
    id: int
    name: str
    icon: str | None
    type_text: str
    source: Source
