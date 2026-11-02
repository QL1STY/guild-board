"""Turn normalized records into numeric points with stable keys, plus labels saying what the keys mean."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Mapping
from urllib.parse import urlsplit

from guildboard.records import CharactersRecord, DiaryRecord, EndgameRecord, NotesRecord, OverviewRecord

if TYPE_CHECKING:  # the store imports this module for Label and Point
    from guildboard.store import Store

SIDE_ICON = re.compile(r"/UI_AvatarIcon_Side_([A-Za-z0-9]+)\.png$")
DIARY_PREFIX = "diary.primogems."
MONTH_PREFIX = "diary.primogems.month."
SOURCE_PREFIX = "diary.primogems.source."  # then 2026-09.events: a month's primogems from one source of the diary
EARNED_KEY = "diary.primogems.earned"

OCULI_LABELS = {
    "anemo": "Anemoculi",
    "geo": "Geoculi",
    "electro": "Electroculi",
    "dendro": "Dendroculi",
    "hydro": "Hydroculi",
    "pyro": "Pyroculi",
    "luno": "Lunoculi",
    "cryo": "Cryoculi",
}

ENDGAME_KEYS = {
    "abyss": "endgame.abyss.stars",
    "theater": "endgame.theater.max_act",
    "stygian": "endgame.stygian.difficulty",
}


@dataclass(frozen=True)
class Point:
    key: str
    value: float


@dataclass(frozen=True)
class Label:
    key: str
    label: str
    kind: str
    parent_key: str | None = None
    icon_url: str = ""
    sort: int = 0


def slug(text: str) -> str:
    """A key-safe form of a name: lower case, letters and digits kept, everything else a dash."""
    mapped = "".join(ch if ch.isalnum() else "-" for ch in text.strip().lower())
    return "-".join(part for part in mapped.split("-") if part) or "x"


def cap_pct(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 1)


def oculi_label(kind: str) -> str:
    return OCULI_LABELS.get(kind, kind.capitalize() + "culi")


def month_key(year: int, month: int) -> str:
    return f"{MONTH_PREFIX}{year:04d}-{month:02d}"


def source_key(year: int, month: int, action: str) -> str:
    """The key of one source of a month in the diary: diary.primogems.source.2026-09.daily_activity."""
    return f"{SOURCE_PREFIX}{year:04d}-{month:02d}.{slug(action).replace('-', '_')}"


def overview(record: OverviewRecord) -> tuple[list[Point], list[Label]]:
    points = [Point(f"stats.{name}", float(value)) for name, value in sorted(record.counters.items())]
    labels: list[Label] = []
    for name in sorted(record.counters):
        if name.startswith("oculi."):
            labels.append(Label(f"stats.{name}", oculi_label(name.split(".", 1)[1]), "oculi"))
    for index, region in enumerate(record.regions):
        region_key = f"explore.{region.id}"
        parent = f"explore.{region.parent_id}" if region.parent_id else None
        points.append(Point(f"{region_key}.pct", cap_pct(region.pct)))
        labels.append(Label(region_key, region.name, "region", parent, region.icon_url, index))
        for area_index, area in enumerate(region.areas):
            area_key = f"{region_key}.area.{slug(area.name)}"
            points.append(Point(f"{area_key}.pct", cap_pct(area.pct)))
            labels.append(Label(area_key, area.name, "area", region_key, "", area_index))
        for offering_index, offering in enumerate(region.offerings):
            offering_key = f"{region_key}.offering.{slug(offering.name)}"
            points.append(Point(f"{offering_key}.level", float(offering.level)))
            labels.append(Label(offering_key, offering.name, "offering", region_key, offering.icon_url, offering_index))
    if record.picture_url:
        labels.append(Label("account.picture", "Profile picture", "account", None, record.picture_url, 0))
    return points, labels


def notes(record: NotesRecord) -> list[Point]:
    open_chapters = 0 if record.archon_all_finished else len(record.archon_open)
    return [Point("quests.archon.open", float(open_chapters))]


def _side_name(icon_url: str) -> str | None:
    """The character's name in a picture's file name, UI_AvatarIcon_Side_<Name>.png, as the game names it."""
    found = SIDE_ICON.search(urlsplit(icon_url).path)
    return found.group(1) if found else None


def character_icon_key(icon_url: str) -> str | None:
    """The icon label's key for a character's picture: by the name in its file, else by its address."""
    if not icon_url:
        return None
    name = _side_name(icon_url)
    if name is not None:
        return f"character.side.{name.lower()}"
    return "character.side." + hashlib.sha256(icon_url.encode()).hexdigest()[:16]


def notes_labels(record: NotesRecord) -> list[Label]:
    """One icon label for each expedition's picture, so that the icon cache serves it (spec 13.3)."""
    labels: dict[str, Label] = {}
    for expedition in record.expeditions:
        key = character_icon_key(expedition.icon_url)
        if key is not None and key not in labels:
            name = _side_name(expedition.icon_url) or "Character"
            labels[key] = Label(key, name, "character", None, expedition.icon_url, 0)
    return list(labels.values())


def characters(record: CharactersRecord) -> list[Point]:
    return [Point("chars.level90", float(record.level90))]


def endgame(record: EndgameRecord) -> list[Point]:
    return [
        Point(ENDGAME_KEYS[mode.mode], float(mode.score))
        for mode in record.modes
        if mode.mode in ENDGAME_KEYS and mode.has_data and mode.score is not None
    ]


def diary(record: DiaryRecord, previous: Mapping[str, float]) -> list[Point]:
    """Month totals and each month's primogems by source, plus a running total of primogems earned that only ever
    rises. The sources are kept for the months the diary gives, as a month's total is: a month that leaves the diary's
    window keeps what its last sync read, which is what the next version's estimate reads (Pulls second pass).

    On the very first diary sync the running total starts at zero: what was earned before
    tracking began is not activity Guild Board saw.
    """
    first_sync = EARNED_KEY not in previous
    total = float(previous.get(EARNED_KEY, 0.0))
    points: list[Point] = []
    for month in record.months:
        key = month_key(month.year, month.month)
        value = float(month.primogems)
        if key in previous:
            total += max(0.0, value - float(previous[key]))
        elif not first_sync:
            total += value  # a month that began while tracking was already running
        points.append(Point(key, value))
        for source in month.sources:
            points.append(Point(source_key(month.year, month.month, source.name), float(source.amount)))
    points.append(Point(EARNED_KEY, total))
    return points


def diary_sources(store: "Store") -> dict[str, dict[str, float]]:
    """Each month's primogems by source as the diary last gave them: {"2026-09": {"events": 2400.0, ...}}."""
    months: dict[str, dict[str, float]] = {}
    for key, value in store.latest_values(SOURCE_PREFIX).items():
        month, _, source = key[len(SOURCE_PREFIX):].partition(".")
        months.setdefault(month, {})[source] = value
    return months
