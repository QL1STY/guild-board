"""`GET /api/next-up`: what the Next up widget lists (the widgets design, 2.1): one timeline of what is ready and what happens next,
put together from models the core already has: the Board model (the notes and the resets), the timers, Pulls' running banners,
the endgame resets and the Calendar's events. It reads nothing of its own.

An item is `{"kind", "name", "at", "ready", "count", "mode", "icon", "started_at"}`. `at` is when it happens, or for a ready item when it
became ready where that is known; `count` is how many things the row stands for (3 expeditions that are back are one row). `mode`
is the endgame mode ("abyss", "theater", "stygian") of an endgame row and None for any other. `icon` is that mode's icon as the
Stats card has it, an address of the art cache that the Endgame resets model carries in its header, and None for any other row and
for a mode with none kept yet (the widget then draws the mode's sign). `started_at` is when the wait began,
for the styles that draw how far along it is (Resin's is 200 resin before it is full, a reset's a day or a week before it comes);
None where the app cannot know it, as for an expedition, whose start HoYoLAB does not say. Ready items come first,
the longest ready first, then the rest by `at`. `ready` is the number of things that are ready (3 expeditions back count 3).

Only what the data holds is listed: no notes row while no notes were read, no event row while the Calendar was not read, and an
event HoYoLAB gives no dates (or one that has not started) is not "ending"."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from guildboard.store import BannerRow, iso, parse_iso

RESIN_FULL_WAIT = timedelta(minutes=8 * 200)  # 1 resin in 8 minutes: 200 resin from none to full, so a share of the wait is resin / 200
TRANSFORMER_WAIT = timedelta(hours=166)  # the game's cooldown, 6 days 22 hours; a player with it reduced sees it begin a little late
POOLS = ("character", "weapon", "chronicled")  # the banners that are listed; a pool of another kind is not
NEVER = datetime.max.replace(tzinfo=timezone.utc)  # sorts an item with no time after those with one


def _when(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text:
        return None
    try:
        when = parse_iso(text)
    except ValueError:
        return None
    return when if when.tzinfo is not None else None


def _dicts(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, (list, tuple)) else []


def _item(
    kind: str, name: str, at: datetime | None, ready: bool, count: int = 1, started: datetime | None = None, mode: str | None = None,
    icon: str | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind, "name": name, "at": iso(at) if at is not None else None, "ready": ready, "count": count,
        "mode": mode, "icon": icon, "started_at": iso(started) if started is not None else None,
    }


def _timers(timers: Mapping[str, Any]) -> list[dict[str, Any]]:
    items = []
    for timer in _dicts(timers.get("timers")):
        state = timer.get("state")
        if state not in ("ready", "running"):  # one with all its visits done is not coming up
            continue
        items.append(_item(
            "timer", str(timer.get("name") or ""), _when(timer.get("ready_at")), state == "ready", started=_when(timer.get("started_at")),
        ))
    return items


def _expeditions(notes: Mapping[str, Any], now: datetime) -> list[dict[str, Any]]:
    """Each expedition still out is a row; those that are back (no time, or a time that has come) are one."""
    back: list[datetime | None] = []
    items = []
    for expedition in _dicts(notes.get("expeditions")):
        at = _when(expedition.get("back_at"))
        if at is None or at <= now:
            back.append(at)
        else:
            items.append(_item("expedition", "Expedition back", at, False))
    if back:
        known = [at for at in back if at is not None]
        name = "1 expedition is back" if len(back) == 1 else f"{len(back)} expeditions are back"
        items.insert(0, _item("expedition", name, min(known) if known else None, True, len(back)))
    return items


def _realm_start(notes: Mapping[str, Any], read: Any, maximum: float, full: datetime) -> datetime | None:
    """When the pot was empty, if it fills at a steady rate: `read` of `maximum` at the notes' read time, full at `full`. None
    while the read time is not known."""
    at = _when(notes.get("read_at"))
    if at is None or not isinstance(read, (int, float)) or read >= maximum or full <= at:
        return None
    return at - (full - at) * (read / (maximum - read))


def _notes(board: Mapping[str, Any], now: datetime) -> list[dict[str, Any]]:
    """Resin, the expeditions, the realm currency and the transformer, as the notes were last read; none while none was read."""
    notes = board.get("notes")
    if not isinstance(notes, dict):
        return []
    items = []
    resin = _when(notes.get("resin_full_at"))
    if resin is not None:
        ready = resin <= now
        items.append(_item("resin", "Resin is full" if ready else "Resin full", resin, ready, started=resin - RESIN_FULL_WAIT))
    items.extend(_expeditions(notes, now))
    maximum = notes.get("realm_currency_max")
    if isinstance(maximum, (int, float)) and maximum > 0:
        read, full = notes.get("realm_currency"), _when(notes.get("realm_currency_full_at"))
        if isinstance(read, (int, float)) and read >= maximum:
            items.append(_item("realm", "Realm currency full", full, True))
        elif full is not None:
            items.append(_item("realm", "Realm currency full", full, full <= now, started=_realm_start(notes, read, maximum, full)))
    transformer = notes.get("transformer")
    if isinstance(transformer, dict):
        at = _when(transformer.get("ready_at"))
        items.append(_item(
            "transformer", "Transformer ready", at, at is None or at <= now, started=at - TRANSFORMER_WAIT if at is not None else None,
        ))
    return items


def _resets(board: Mapping[str, Any]) -> list[dict[str, Any]]:
    resets = board.get("resets")
    if not isinstance(resets, dict):
        return []
    items = []
    for key, name in (("daily_at", "Daily reset"), ("weekly_at", "Weekly reset")):
        at = _when(resets.get(key))
        if at is not None:
            wait = timedelta(days=1) if key == "daily_at" else timedelta(days=7)
            items.append(_item(key.removesuffix("_at"), name, at, False, started=at - wait))
    return items


def _possessive(names: Sequence[str]) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def _banners(banners: Sequence[BannerRow], now: datetime) -> list[dict[str, Any]]:
    """The running banners, those of a pool that end together as one row: "Furina's banner ends", "Furina and Zhongli's banners
    end", "Weapon banner ends", "Chronicled Wish ends"."""
    groups: dict[tuple[str, datetime], list[str]] = {}
    starts: dict[tuple[str, datetime], datetime] = {}
    for banner in banners:
        if banner.pool in POOLS and banner.starts_at <= now < banner.ends_at:
            key = (banner.pool, banner.ends_at)
            starts[key] = min(banner.starts_at, starts.get(key, banner.starts_at))
            names = groups.setdefault(key, [])
            names.extend(name for name in banner.featured if name not in names)
    items = []
    for (pool, ends), names in groups.items():
        if pool == "weapon":
            name = "Weapon banner ends"
        elif pool == "chronicled":
            name = "Chronicled Wish ends"
        elif not names:
            name = "Character banner ends"
        elif len(names) == 1:
            name = f"{names[0]}'s banner ends"
        else:
            name = f"{_possessive(names)}'s banners end"
        items.append(_item("banner", name, ends, False, started=starts[(pool, ends)]))
    return items


def _endgame(endgame: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The modes not stale (a stale one says nothing until the next read) with an end."""
    items = []
    for mode in _dicts(endgame.get("modes")):
        at = _when(mode.get("ends_at"))
        if mode.get("stale") or at is None:
            continue
        verb = "ends" if mode.get("mode") == "stygian" else "resets"
        key = mode.get("mode")
        header = mode.get("header")
        icon = header.get("icon") if isinstance(header, dict) else None
        items.append(_item(
            "endgame", f"{mode.get('label')} {verb}", at, False, started=_when(mode.get("starts_at")),
            mode=key if key in ("abyss", "theater", "stygian") else None, icon=icon if isinstance(icon, str) and icon else None,
        ))
    return items


def _events(events: Sequence[Mapping[str, Any]] | None, now: datetime) -> list[dict[str, Any]]:
    """Each event started, not finished and ending after now. `events` is None while the Calendar was not read; an event with
    no dates ("Coming soon"), or one the wiki's dates say has not started, is not listed."""
    items = []
    for event in _dicts(events):
        starts, ends = _when(event.get("starts")), _when(event.get("ends"))
        if event.get("soon") or event.get("finished") or starts is None or ends is None or not starts <= now < ends:
            continue
        items.append(_item("event", f"{event.get('name')} ends", ends, False, started=starts))
    return items


def build_next_up(
    board: Mapping[str, Any], timers: Mapping[str, Any], banners: Sequence[BannerRow], endgame: Mapping[str, Any],
    events: Sequence[Mapping[str, Any]] | None, now: datetime,
) -> dict[str, Any]:
    items = [
        *_timers(timers), *_notes(board, now), *_resets(board), *_banners(banners, now), *_endgame(endgame), *_events(events, now),
    ]

    def order(item: dict[str, Any]) -> tuple[bool, datetime]:
        at = _when(item["at"])
        return not item["ready"], at if at is not None else NEVER

    items.sort(key=order)  # stable: what is equal keeps the order above
    return {"items": items, "ready": sum(item["count"] for item in items if item["ready"])}
