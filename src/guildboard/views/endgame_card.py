"""The Endgame card of the Stats page's Overview (the Stats design, 3.1 and 3.2): this cycle in each of the three modes,
with the best so far, made from the newest endgame detail a sync kept.

Each column's header has the mode's icon, from its Tutorial entry in the HoYoLAB wiki, and a picture: the mode's public
picture (netpolicy's table, named by its place alone) once the art cache keeps it on disk, else the entry's first picture
after its icon, else none, so that a header never waits on a download and never shows a broken picture. Every picture is
an address of the art cache's, "/api/art/<key>": the page loads nothing from the internet.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Callable, Mapping, TypeVar

from guildboard.characters.wiki import TUTORIAL
from guildboard.gameday import game_day
from guildboard.store import Store, WikiEntryRow, parse_iso
from guildboard.views.stats import day_text, endgame_best, endgame_period

if TYPE_CHECKING:
    from guildboard.characters.art import ArtCache

MODES = ("abyss", "theater", "stygian")
LABELS = {"abyss": "Spiral Abyss", "theater": "Imaginarium Theater", "stygian": "Stygian Onslaught"}
RANK_LABELS = {
    "strike": "Strongest single strike", "defeats": "Most defeats", "taken": "Most damage taken", "damage": "Most damage",
    "bursts": "Most bursts", "skills": "Most skills", "played": "Most played",
}
_ABYSS_RANKS = ("strike", "defeats", "taken", "bursts", "skills", "played")
_THEATER_RANKS = ("damage", "defeats", "taken")
MONTHS = (
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December",
)
T = TypeVar("T")


@dataclass(frozen=True)
class ModeArt:
    """Where a mode's header pictures come from (the Stats design, 3.2)."""

    mode: str
    wiki_entry: str  # its Tutorial entry in the HoYoLAB wiki: the icon, the fallback picture and the Stygian medals
    picture_index: int  # its public picture's place in netpolicy's table, which the art cache gives out by place alone
    crop: tuple[float, float, float, float] | None  # the part of that picture shown: (x, y, w, h), fractions of it


MODE_ART: dict[str, ModeArt] = {
    "abyss": ModeArt("abyss", "5669", 0, None),
    "theater": ModeArt("theater", "5832", 1, None),
    # The Stygian banner's left 48%, the flower, centred at 42% of its height as the accepted mockup has it: the words on its right are never shown.
    "stygian": ModeArt("stygian", "7786", 2, (0.0, 0.0, 0.48, 0.84)),
}


# ------------------------------------------------------------------------------------------------ the pictures


def _tutorial(row: WikiEntryRow | None) -> Mapping[str, Any]:
    return row.data if row is not None and row.kind == TUTORIAL and isinstance(row.data, dict) else {}


def _texts(value: Any) -> list[str]:
    return [item if isinstance(item, str) else "" for item in value] if isinstance(value, list) else []


def header_art(mode: str, art: ArtCache, wiki_row: WikiEntryRow | None) -> dict[str, Any]:
    """A mode's header: the icon of its Tutorial entry, and its picture with the part of it to show. The picture is the
    public one where the art cache keeps it, else the entry's first picture after its icon that the cache can give, else
    None (plain parchment)."""
    spec = MODE_ART[mode]
    data = _tutorial(wiki_row)
    icon_url = str(data.get("icon") or "")
    icon = art.address(icon_url) if icon_url else None
    public = art.public_address(spec.picture_index)
    if public is not None and art.kept(public):
        return {"icon": icon, "picture": public, "crop": list(spec.crop) if spec.crop is not None else None}
    wiki = next(
        (found for url in _texts(data.get("pictures")) if url and url != icon_url and (found := art.address(url))), None
    )
    return {"icon": icon, "picture": wiki, "crop": None}


# The words above each difficulty's medal in the Stygian Onslaught's entry: "Normal Challenge: Normal" up to "Perilous
# Challenge: Dire", in the order of the difficulties.
_MEDAL_WORDS = re.compile(r"Challenge:\s*[A-Za-z]+$")
_MEDAL_LEVEL = re.compile(r"_(\d+)$")  # HoYoLAB names the medal of difficulty 5 "UI_LeyLineChallenge_Medal_5"


def medal_picture(wiki_row: WikiEntryRow | None, medal: str, difficulty: int | None) -> str | None:
    """The wiki's picture of a Stygian difficulty's medal: the entry's picture named as HoYoLAB names the medal, where there
    is one; else, for difficulty n, the n-th picture under words that name a difficulty. None when the entry has none."""
    data = _tutorial(wiki_row)
    pictures, captions = _texts(data.get("pictures")), _texts(data.get("captions"))
    if medal:
        named = next((url for url in pictures if url.rsplit("/", 1)[-1].split(".", 1)[0] == medal), None)
        if named:
            return named
    found = _MEDAL_LEVEL.search(medal)
    level = int(found.group(1)) if found else (difficulty or 0)
    labelled = [url for url, words in zip(pictures, captions) if _MEDAL_WORDS.search(words)]
    return labelled[level - 1] if 1 <= level <= len(labelled) else None


# ------------------------------------------------------------------------------------------------ names

SHORT_CHARS = 40  # about two lines of a boss's name under its icon
_TITLE = "Battle-Hardened "  # HoYoLAB's word for a stronger kind of an enemy; the full name keeps it
_NAME_PARTS = re.compile(r"\s*:\s*|\s+-\s+")


def short_name(name: str) -> str:
    """A boss's name as the card writes it, in two lines at most: without HoYoLAB's "Battle-Hardened"; when that is still
    longer than SHORT_CHARS, without the kind a three-part name starts with ("Secret Source Automaton: Overseer Device -
    Obliterator Panoply" is "Overseer Device: Obliterator Panoply"), then without the title a two-part name ends with
    ("Guardian Blade of Drifting Snow: Endless Reverberation" is "Guardian Blade of Drifting Snow"). The full name is
    shown on hover."""
    text = " ".join(str(name or "").split())
    if text.startswith(_TITLE):
        text = text[len(_TITLE):]
    parts = [part for part in _NAME_PARTS.split(text) if part]
    while len(parts) > 2 and len(": ".join(parts)) > SHORT_CHARS:
        parts = parts[1:]
    if len(parts) == 2 and len(": ".join(parts)) > SHORT_CHARS:
        parts = parts[:1]
    return ": ".join(parts)


# ------------------------------------------------------------------------------------------------ the card


@dataclass(frozen=True)
class _Reading:
    art: ArtCache
    people: Mapping[int, tuple[str | None, str | None]]  # a character's id: her name and element, from the characters read
    now: datetime
    server: str


def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _optional_int(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _carried(detail: Mapping[str, Any], name: str, read: Callable[[Any], T]) -> T | None:
    """`read` of the detail's field `name`; None where the detail does not carry the field. A detail kept before the
    card's fields were (by 1.0.1, the newest until the next sync reads the endgame again) has none of them, and the card
    shows nothing for each, never a made-up 0 or an empty grid. A 0 or an empty list the detail does carry is real."""
    return read(detail[name]) if name in detail else None


def _chambers(listed: Any) -> list[dict[str, Any]]:
    return [
        {"name": str(pair[0]), "stars": _int(pair[1])}
        for pair in _list(listed) if isinstance(pair, list) and len(pair) == 2
    ]


def _moment(text: Any) -> datetime | None:
    """A moment the detail keeps as UTC ISO text; None for none, or for text that names no moment with its zone."""
    try:
        moment = parse_iso(text) if isinstance(text, str) and text else None
    except ValueError:
        return None
    return moment if moment is not None and moment.tzinfo is not None else None


def _floor(chamber: Any) -> int:
    """The floor of a chamber's name, 12 of "12-3"; 0 when it names none."""
    head = str(chamber or "").partition("-")[0]
    return int(head) if head.isascii() and head.isdigit() else 0


def _people(store: Store) -> dict[int, tuple[str | None, str | None]]:
    doc = store.latest_doc("characters")
    builds = doc[1].get("builds") if doc is not None else None
    listed = builds.get("builds") if isinstance(builds, dict) else None
    return {
        build["id"]: (str(build.get("name") or "") or None, str(build.get("element") or "") or None)
        for build in _list(listed)
        if isinstance(build, dict) and isinstance(build.get("id"), int)
    }


def _ranks(listed: Any, kinds: tuple[str, ...], reading: _Reading) -> list[dict[str, Any]]:
    """A mode's highlights in the card's order, each with its label and the character's face, name and element."""
    found: dict[str, Mapping[str, Any]] = {}
    for rank in _list(listed):
        if isinstance(rank, dict) and rank.get("kind") in kinds:
            found.setdefault(rank["kind"], rank)
    rows = []
    for kind in kinds:
        rank = found.get(kind)
        if rank is None:
            continue
        name, element = reading.people.get(_int(rank.get("avatar_id")), (None, None))
        rows.append({
            "kind": kind, "label": RANK_LABELS[kind], "value": _int(rank.get("value")),
            "face": reading.art.address(str(rank.get("icon") or "") or None), "name": name, "element": element,
        })
    return rows


def _abyss(detail: Mapping[str, Any], summary: Mapping[str, Any], period: str, reading: _Reading) -> dict[str, Any]:
    halves = [half for half in _list(detail.get("abyss_halves")) if isinstance(half, dict)]
    floor = max((_floor(half.get("chamber")) for half in halves), default=0)  # 12, or the highest floor played
    shown = sorted(
        (half for half in halves if floor and _floor(half.get("chamber")) == floor),
        key=lambda half: (str(half.get("chamber")), _int(half.get("half"))),
    )
    stars = detail.get("abyss_stars")
    battles, wins = _carried(detail, "abyss_battles", _int), _carried(detail, "abyss_wins", _int)
    fought = f"{battles} {'battle' if battles == 1 else 'battles'}, {wins or 0} won" if battles else ""
    return {
        "line": " · ".join(part for part in (period, fought) if part),
        "stars": _int(stars if stars is not None else summary.get("score")),
        "battles": battles,
        "wins": wins,
        "chambers": _carried(detail, "abyss_chambers", _chambers),
        "floor_shown": floor,
        "foes": [
            {
                "chamber": str(half.get("chamber")), "half": _int(half.get("half")),
                "foes": [
                    {"name": str(foe.get("name") or ""), "level": _int(foe.get("level")),
                     "icon": reading.art.address(str(foe.get("icon") or "") or None)}
                    for foe in (
                        _list(half.get("foes"))
                        or [{"name": name} for name in _list(half.get("enemies"))]  # a detail kept before the levels were
                    )
                    if isinstance(foe, dict)
                ],
            }
            for half in shown
        ],
        "ranks": _carried(detail, "abyss_ranks", lambda listed: _ranks(listed, _ABYSS_RANKS, reading)),
    }


def _theater(detail: Mapping[str, Any], summary: Mapping[str, Any], reading: _Reading) -> dict[str, Any]:
    starts = _moment(detail.get("theater_starts") or summary.get("period_start"))
    month = MONTHS[game_day(starts, reading.server).month - 1] if starts is not None else ""
    difficulty = str(detail.get("theater_difficulty") or "")
    # On the 1st, before the new season's first try, the season shown is last month's: it says it has ended, as the
    # Stygian Onslaught's does.
    ends = _moment(detail.get("theater_ends") or summary.get("period_end"))
    ended = ends is not None and ends <= reading.now
    return {
        "line": " · ".join(part for part in (month, difficulty, "ended" if ended else "") if part),
        "month": month,
        "difficulty": difficulty,
        "ended": ended,
        "act": _int(detail.get("theater_acts")) or _int(summary.get("score")),
        "medals": _carried(detail, "theater_medals", lambda listed: [bool(medal) for medal in _list(listed)]),
        "medal_count": _carried(detail, "theater_medal_count", _int),  # HoYoLAB's own count
        "ranks": _carried(detail, "theater_ranks", lambda listed: _ranks(listed, _THEATER_RANKS, reading)),
        "flowers": _carried(detail, "theater_flowers", _int),
        "seconds": _carried(detail, "theater_seconds", _int),
    }


def _stygian(
    detail: Mapping[str, Any], summary: Mapping[str, Any], wiki_row: WikiEntryRow | None, reading: _Reading
) -> dict[str, Any]:
    season = str(detail.get("stygian_season") or summary.get("period_label") or "")
    ends = _moment(detail.get("stygian_ends") or summary.get("period_end"))
    ended = ends is not None and ends <= reading.now
    waiting = _list(detail.get("stygian_next"))
    opens = _moment(waiting[1]) if len(waiting) == 2 and waiting[0] else None
    upcoming = {"name": str(waiting[0]), "starts": day_text(waiting[1], reading.server)} if opens is not None else None
    difficulty = _optional_int(detail.get("stygian_difficulty"))
    if difficulty is None and summary:
        difficulty = _optional_int(summary.get("score"))
    medal = medal_picture(wiki_row, str(detail.get("stygian_medal") or ""), difficulty) if summary else None
    return {
        "line": f"{season} · ended" if season and ended else season,
        "season": season,
        "ended": ended,
        "difficulty": difficulty,
        "medal": reading.art.address(medal) if medal else None,
        "seconds": _optional_int(detail.get("stygian_seconds")),
        "bosses": [
            {
                "name": str(boss.get("name") or ""), "short": short_name(str(boss.get("name") or "")),
                "icon": reading.art.address(str(boss.get("icon") or "") or None),
                "seconds": _optional_int(boss.get("seconds")),
            }
            for boss in _list(detail.get("stygian_bosses")) if isinstance(boss, dict)
        ],
        # A newer season HoYoLAB has no record of yet (it gives its bosses after the first try): a note names the next and
        # the day it opens, or says it is on once it has opened, and the last season played shows dimmed once it has ended.
        "next": upcoming,
        "next_started": opens is not None and opens <= reading.now,
        "dimmed": upcoming is not None and ended,
    }


def build_endgame_card(
    store: Store, art: ArtCache, wiki_rows: Mapping[str, WikiEntryRow | None], now: datetime, server: str
) -> dict[str, Any]:
    """The model of GET /api/stats/endgame: a column for each mode, in the card's order, or none before any endgame was
    read. A mode not played has `played` False and every list empty, or None where the detail kept does not carry the
    field (`_carried`). `wiki_rows` are the Tutorial entries kept, by mode."""
    doc = store.latest_doc("endgame")
    if doc is None:
        return {"modes": []}
    summaries = {mode.get("mode"): mode for mode in _list(doc[1].get("modes")) if isinstance(mode, dict)}
    kept = doc[1].get("detail")
    stored: Mapping[str, Any] = kept if isinstance(kept, dict) else {}
    reading = _Reading(art, _people(store), now, server)
    columns = []
    for mode in MODES:
        summary = summaries.get(mode) or {}
        played = bool(summary.get("has_data"))
        # A mode not played reads nothing of the detail, and keeps which of its fields the detail carries.
        detail: Mapping[str, Any] = stored if played else dict.fromkeys(stored)
        shown: Mapping[str, Any] = summary if played else {}
        period = endgame_period(summary, server)
        column: dict[str, Any] = {
            "mode": mode,
            "label": str(summary.get("label") or LABELS[mode]),
            "header": header_art(mode, art, wiki_rows.get(mode)),
            "period": period,
            "result": str(summary.get("result_text") or ""),
            "best": endgame_best(store, mode),
            "played": played,
        }
        if mode == "abyss":
            column.update(_abyss(detail, shown, period, reading))
        elif mode == "theater":
            column.update(_theater(detail, shown, reading))
        else:
            column.update(_stygian(detail, shown, wiki_rows.get(mode), reading))
        columns.append(column)
    return {"modes": columns}
