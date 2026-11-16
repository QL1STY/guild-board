"""`GET /api/calendar`: what the Calendar widget draws (the widgets design, 2.3): the banners with their faces and the events the
last read of HoYoLAB's calendar kept, the Endgame lane (the endgame resets' modes) and how many events are left to finish.

An event HoYoLAB gives no dates (`soon`) is "Coming soon": it has no start or end, is never counted in `left` and never ages out,
unless the Genshin Impact Wiki on Fandom (`sources/fandom_events.py`, the widgets plan, Task 2b) has dates for an event of that name
(case and spacing aside): it then has them, with `source` "fandom", and the model's `upcoming_from` names the wiki for the Calendar's
foot. An event HoYoLAB dates itself keeps HoYoLAB's dates; an event of the wiki's that HoYoLAB does not list is not added. Each
event says whose dates it has in `source`. `finished` is the player's own completion."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from guildboard.gameday import server_tz
from guildboard.metrics import calendar_face_key
from guildboard.sources.fandom_events import event_key, kept_dates
from guildboard.store import Store, iso, parse_iso
from guildboard.views.endgame_resets import build_endgame_resets

KEEP_ENDED = timedelta(days=2)  # an event that ended longer ago than this is left out
UPCOMING_FROM = "Genshin Impact Wiki (Fandom)"  # the Calendar's foot, when a date of the wiki's is shown


def _when(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text:
        return None
    try:
        when = parse_iso(text)
    except ValueError:
        return None
    return when if when.tzinfo is not None else None


def _dicts(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _banner(raw: dict[str, Any]) -> dict[str, Any]:
    names = [str(name) for name in raw.get("names") or ()]
    kind, starts, ends = str(raw.get("kind") or ""), raw.get("starts"), raw.get("ends")
    faces = []
    for face in _dicts(raw.get("faces")):
        address = face.get("icon_url")
        faces.append({
            "name": str(face.get("name") or ""), "rarity": _number(face.get("rarity")) or 0,
            "icon": f"/api/icon/{calendar_face_key(address)}" if isinstance(address, str) and address else None,
        })
    return {
        "id": f"{kind}:{starts or ''}:{'+'.join(names)}", "kind": kind, "name": " · ".join(names),
        "starts": starts if isinstance(starts, str) else None, "ends": ends if isinstance(ends, str) else None,
        "faces": faces,
    }


def _from_the_wiki(name: str, wiki: dict[str, tuple[str, str]], server: str) -> tuple[datetime, datetime] | None:
    """The wiki's dates for an event of this name, its server time read on `server`'s clock."""
    found = wiki.get(event_key(name))
    if found is None:
        return None
    try:
        zone = server_tz(server)
        return datetime.fromisoformat(found[0]).replace(tzinfo=zone), datetime.fromisoformat(found[1]).replace(tzinfo=zone)
    except ValueError:
        return None


def _event(raw: dict[str, Any], wiki: dict[str, tuple[str, str]], server: str) -> dict[str, Any]:
    starts, ends = _when(raw.get("starts")), _when(raw.get("ends"))
    dated = raw.get("dated") is True and starts is not None and ends is not None
    source = str(raw.get("source") or "hoyolab")
    if not dated:
        borrowed = _from_the_wiki(str(raw.get("name") or ""), wiki, server)
        if borrowed is not None:
            (starts, ends), dated, source = borrowed, True, "fandom"
    left, total = _number(raw.get("double_left")), _number(raw.get("double_total"))
    return {
        "id": raw.get("id"), "name": str(raw.get("name") or ""),
        "starts": iso(starts) if dated and starts is not None else None,
        "ends": iso(ends) if dated and ends is not None else None,
        "finished": raw.get("finished") is True, "primogems": _number(raw.get("primogems")),
        "explored": _number(raw.get("explored")),
        "double": {"left": int(left), "total": int(total)} if left is not None and total is not None else None,
        "soon": not dated, "status": _number(raw.get("status")) or 0, "source": source,
    }


def _kept(event: dict[str, Any], now: datetime) -> bool:
    ends = _when(event["ends"])
    return ends is None or ends >= now - KEEP_ENDED


def _left(event: dict[str, Any], now: datetime) -> bool:
    starts, ends = _when(event["starts"]), _when(event["ends"])
    return starts is not None and ends is not None and starts <= now < ends and not event["finished"]


def build_calendar(store: Store, now: datetime, server: str, endgame: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """`read` is false while the kept document has no board (none was read, or it was kept before the board existed): the widget
    says the calendar is not read yet. `left` counts the events started, not finished and ending after now. `endgame` is the
    Endgame resets model's modes, when the caller has them already."""
    doc = store.latest_doc("calendar")
    board = doc[1].get("board") if doc is not None else None
    if endgame is None:
        endgame = build_endgame_resets(store, now, server)["modes"]
    if doc is None or not isinstance(board, dict):
        return {
            "read_at": None, "read": False, "banners": [], "events": [], "endgame": endgame, "left": 0, "upcoming_from": None,
        }
    wiki = kept_dates(store)
    events = [event for event in (_event(raw, wiki, server) for raw in _dicts(board.get("events"))) if _kept(event, now)]
    return {
        "read_at": iso(doc[0]), "read": True, "banners": [_banner(banner) for banner in _dicts(board.get("banners"))],
        "events": events, "endgame": endgame, "left": sum(1 for event in events if _left(event, now)),
        "upcoming_from": UPCOMING_FROM if any(event["source"] == "fandom" for event in events) else None,
    }
