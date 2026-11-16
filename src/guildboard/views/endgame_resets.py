"""The Endgame resets widget's model (the widgets design, 2.4), and the Calendar's Endgame lane: each endgame mode's result and the
time to its reset. It reads the endgame summaries a sync already keeps (`latest_doc("endgame")`): no read of its own. Its pictures
are the Stats card's (`endgame_card.header_art` and `theater_marks`), the art cache's addresses of what the cache keeps on disk,
never a request."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Mapping

from guildboard.gameday import RESET_HOUR, server_tz
from guildboard.pulls.nextversion import load_reference
from guildboard.store import Store, WikiEntryRow, iso, parse_iso
from guildboard.views.endgame_card import header_art, medal_picture, theater_marks

if TYPE_CHECKING:
    from guildboard.characters.art import ArtCache

MODES = (
    ("abyss", "Spiral Abyss", "Abyss"),
    ("theater", "Imaginarium Theater", "Theater"),
    ("stygian", "Stygian Onslaught", "Stygian"),
)
ARCANA = "Arcana Challenge"  # a season whose medal list holds Arcana fights beside its acts


def _when(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text:
        return None
    try:
        when = parse_iso(text)
    except ValueError:
        return None
    return when if when.tzinfo is not None else None


def _int(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _acts_of(detail: dict[str, Any]) -> int | None:
    """The acts of the season where the detail's medals (one for each act) carry them; None otherwise, and for an Arcana
    Challenge season, whose list holds fights that are not acts."""
    medals = detail.get("theater_medals")
    if not isinstance(medals, (list, tuple)) or not medals or detail.get("theater_difficulty") == ARCANA:
        return None
    return len(medals)


_RESET_DAYS = {"abyss": "abyss_reset_day", "theater": "theater_reset_day"}  # the monthly resets (reference/versions.json)


def _cycle(mode: str, now: datetime, server: str) -> tuple[datetime, datetime] | None:
    """The cycle `now` is in, for a mode that resets on a known day of every month (the Abyss and the Theater, at the 04:00
    server-time reset): its start, and its end, the last second before the next reset, as HoYoLAB gives a cycle's end. None
    for the Stygian, whose seasons have no schedule the app knows."""
    name = _RESET_DAYS.get(mode)
    day = load_reference()["sources"].get(name) if name else None
    if not isinstance(day, int):
        return None
    tz = server_tz(server)
    local = now.astimezone(tz)
    year, month = local.year, local.month
    for _ in range(3):  # the reset before now, and the one after it
        reset = datetime(year, month, day, RESET_HOUR, tzinfo=tz)
        if reset <= now:
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
            continue
        before_year, before_month = (year - 1, 12) if month == 1 else (year, month - 1)
        start = datetime(before_year, before_month, day, RESET_HOUR, tzinfo=tz)
        return start.astimezone(timezone.utc), reset.astimezone(timezone.utc) - timedelta(seconds=1)
    return None


def _stygian_medal(detail: dict[str, Any], summary: Mapping[str, Any], row: WikiEntryRow | None, art: ArtCache | None) -> str | None:
    """The art cache's address of the medal of the Stygian's difficulty, as the Stats card finds it (`medal_picture`); None
    with no art cache, no Tutorial entry kept or no picture in it for the difficulty."""
    if art is None:
        return None
    difficulty = _int(detail.get("stygian_difficulty"))
    if difficulty is None:
        difficulty = _int(summary.get("score"))
    url = medal_picture(row, str(detail.get("stygian_medal") or ""), difficulty)
    return art.address(url) if url else None


def build_endgame_resets(
    store: Store, now: datetime, server: str, art: ArtCache | None = None,
    wiki_rows: Mapping[str, WikiEntryRow | None] | None = None,
) -> dict[str, Any]:
    """`modes` are in the order abyss, theater, stygian. A mode whose period ended after the read, and before now, is `stale`:
    it says nothing of the result (the widget says "Not read since the reset"), has no end and is no "not played". A
    period that ended before the read is over for good (the Theater's and the Stygian's summaries are of the newest season
    the player has played): the read came after the reset, so the player has not played the current cycle. That mode is
    "not played", with the current cycle's end where the app knows its schedule. `not_played` counts the modes that are
    neither stale nor played. `server` is the account's, for the schedule's day and hour.

    `starts_at` is the start of the cycle shown, for a mode not stale: the period's own, else, where the period is over or
    names none, the schedule's (None for the Stygian). With the art cache (and the Tutorial entries kept, `wiki_rows` by
    mode), each mode has its `header` (`icon`, `picture` and `crop`, as the Stats card's header has them) and the Theater and
    the Stygian each their `medal`, HoYoLAB's own: the Theater's mark and, for the Stygian played this season, the medal of its
    difficulty, which the Stats card draws too (`endgame_card.medal_picture`, from the Stygian's Tutorial entry and named as the
    detail names it, `stygian_medal`). The public pictures and the Theater's medal are given only once the art cache keeps them
    on disk, else None; the Stygian's medal is an address of the art cache, as the header's icon is, None where the entry has
    none. A header's icon, and its picture where there is no public one, come from the wiki entry: each is an address of the
    art cache (`art.address`), which `/api/art` fetches when the picture is shown (as the Stats card does), after the
    player's consent and from HoYoverse hosts only, so it may not be on disk yet. Where there is none the widget draws the
    mode's colour."""
    doc = store.latest_doc("endgame")
    if doc is None:
        return {"read_at": None, "modes": [], "not_played": 0}
    taken_at, body = doc
    summaries = {m.get("mode"): m for m in body.get("modes") or () if isinstance(m, dict)}
    kept = body.get("detail")
    detail: dict[str, Any] = kept if isinstance(kept, dict) else {}
    medal = theater_marks(art, None)["medal"] if art is not None else None
    modes = []
    for key, label, short in MODES:
        summary = summaries.get(key) or {}
        ends = _when(summary.get("period_end"))
        starts = _when(summary.get("period_start"))
        stale = ends is not None and taken_at < ends <= now
        over = ends is not None and ends <= now and not stale  # the read came after its end: the current cycle is not in it
        played = bool(summary.get("has_data")) and not stale and not over
        if over:
            cycle = _cycle(key, now, server)
            starts, ends = cycle if cycle is not None else (None, None)
        elif starts is None and not stale:
            cycle = _cycle(key, now, server)
            starts = cycle[0] if cycle is not None else None
        score = _int(summary.get("score")) if played else None
        coming = detail.get("stygian_next") if key == "stygian" else None
        next_starts = _when(coming[1]) if isinstance(coming, (list, tuple)) and len(coming) == 2 else None
        shown = header_art(key, art, (wiki_rows or {}).get(key)) if art is not None else None
        stygian_medal = _stygian_medal(detail, summary, (wiki_rows or {}).get(key), art) if key == "stygian" and played else None
        modes.append({
            "mode": key, "label": label, "short": short, "played": played,
            "stars": score if key == "abyss" else None,
            "acts": score if key == "theater" else None,
            "acts_of": _acts_of(detail) if key == "theater" and played else None,
            "difficulty": score if key == "stygian" else None,
            "medals": _int(detail.get("theater_medal_count")) if key == "theater" and played else None,
            "starts_at": iso(starts) if starts is not None and not stale else None,
            "ends_at": iso(ends) if ends is not None and not stale else None,
            "next_starts_at": iso(next_starts) if next_starts is not None else None,
            "stale": stale,
            "header": (
                {"icon": shown["icon"], "picture": shown["picture"], "crop": shown["crop"]} if shown is not None
                else {"icon": None, "picture": None, "crop": None}
            ),
            "medal": medal if key == "theater" else stygian_medal,
        })
    return {
        "read_at": iso(taken_at), "modes": modes,
        "not_played": sum(1 for m in modes if not m["stale"] and not m["played"]),
    }
