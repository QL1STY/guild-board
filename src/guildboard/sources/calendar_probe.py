"""Shows what HoYoLAB's event calendar holds, for the check with the player (the widgets and Friends design, 2.3).

Run by hand, with the player's go-ahead: `uv run python -u -m guildboard.sources.calendar_probe`. Guild Board never runs
it. It reads the calendar once with the stored login, through HoyolabSource as the sync reads it (the cookie update the
app makes included, and no other request), and prints counts, field names, value types and the pictures' hostnames
alone. It never prints a name, a description, an address path, a reward amount, the UID or anything of the login; a
field name or an enum word that is not a plain identifier is shown as a placeholder, so that nothing the answer holds
as text can reach the screen.
"""
from __future__ import annotations

import asyncio
import logging
import re
import sys
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from guildboard import config
from guildboard.api.icons import PICTURE_HOSTS
from guildboard.records import SourceError
from guildboard.sources import hoyolab
from guildboard.sources.hoyolab import HoyolabSource
from guildboard.tokenstore import TokenStore

POOL_LISTS = ("avatar_card_pool_list", "weapon_card_pool_list", "mixed_card_pool_list")
EVENT_LISTS = ("act_list", "fixed_act_list")
DETAILS = ("reward_list", "explore_detail", "double_detail", "tower_detail", "role_combat_detail")
PRIMOGEMS = 201  # the item id of a primogem reward
UNREADABLE = "the library could not use the answer"
_NAME = re.compile(r"[A-Za-z0-9_]{1,40}")
_ENUM_WORD = re.compile(r"[A-Z0-9_]{1,40}")


class _Heard(logging.Handler):
    """Counts the one warning that says the library's model could not read the answer. Keeps no text."""

    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.unreadable = 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.getMessage().startswith(UNREADABLE):
            self.unreadable += 1


def _dicts(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _field(name: object) -> str:
    return name if isinstance(name, str) and _NAME.fullmatch(name) else "<odd name>"


def _fields(items: Iterable[Mapping[str, Any]]) -> str:
    names = sorted({_field(name) for item in items for name in item})
    return ", ".join(names) if names else "none"


def _enum(value: Any) -> str:
    """HoYoLAB's enum words and numbers, as they are: a number, or an upper-case word, and nothing else."""
    if isinstance(value, bool) or isinstance(value, int):
        return str(value)
    if isinstance(value, str) and _ENUM_WORD.fullmatch(value):
        return value
    return "<text>" if isinstance(value, str) else f"<{type(value).__name__}>"


def _types(values: Iterable[Any]) -> str:
    names = sorted({type(value).__name__ for value in values})
    return ", ".join(names) if names else "none"


def _seconds(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _shape(body: Mapping[str, Any]) -> None:
    print("The answer's shape:")
    for key, value in body.items():
        size = f" of {len(value)}" if isinstance(value, (list, dict)) else ""
        print(f"  {_field(key)}: {type(value).__name__}{size}")


def _pictures(body: Mapping[str, Any]) -> Counter[str]:
    hosts: Counter[str] = Counter()
    for name in POOL_LISTS:
        for pool in _dicts(body.get(name)):
            for kind in ("avatars", "weapon"):
                for face in _dicts(pool.get(kind)):
                    icon = face.get("icon")
                    if not isinstance(icon, str) or not icon:
                        hosts["no address"] += 1
                        continue
                    try:
                        hosts[urlsplit(icon).hostname or "no address"] += 1
                    except ValueError:
                        hosts["no address"] += 1
    return hosts


def _pools(body: Mapping[str, Any]) -> None:
    print("The pools:")
    for name in POOL_LISTS:
        pools = _dicts(body.get(name))
        print(f"  {name}: {len(pools)} pools; fields: {_fields(pools)}")
        for kind in ("avatars", "weapon"):
            faces = [face for pool in pools for face in _dicts(pool.get(kind))]
            if faces:
                print(f"    {kind} fields: {_fields(faces)}")
    hosts = _pictures(body)
    print("The pictures' hosts:")
    for host, count in hosts.most_common():
        known = "yes" if host in PICTURE_HOSTS else "no"
        print(f"  {host}: {count} pictures, in the icon hosts: {known}")
    if not hosts:
        print("  none")


def _events(body: Mapping[str, Any], now: float) -> None:
    lists = {name: _dicts(body.get(name)) for name in EVENT_LISTS}
    events = [event for name in EVENT_LISTS for event in lists[name]]
    print("The events:")
    for name in EVENT_LISTS:
        print(f"  {name}: {len(lists[name])} events; fields: {_fields(lists[name])}")
    for field in ("type", "status"):
        counts = Counter(_enum(event[field]) for event in events if field in event)
        print(f"  by {field}: " + (", ".join(f"{word}: {count}" for word, count in sorted(counts.items())) or "none"))
    finished = [event["is_finished"] for event in events if isinstance(event.get("is_finished"), bool)]
    print(f"  events finished: {finished.count(True)} of {len(finished)}")
    with_explore = [event for event in events if isinstance(event.get("explore_detail"), dict)]
    both = neither = differ = 0
    for event in with_explore:
        mine, explored = event.get("is_finished"), event["explore_detail"].get("is_finished")
        if mine is True and explored is True:
            both += 1
        elif mine is False and explored is False:
            neither += 1
        else:
            differ += 1
    print(f"  events with explore_detail: {len(with_explore)}; both finished {both}, neither {neither}, differ {differ}")
    with_double = [event for event in events if isinstance(event.get("double_detail"), dict)]
    spent = [event for event in with_double if event["double_detail"].get("left") == 0]
    spent_done = sum(1 for event in spent if event.get("is_finished") is True)
    print(f"  events with double_detail: {len(with_double)}; left 0 and finished {spent_done}, "
          f"left 0 and not finished {len(spent) - spent_done}")
    primogems = sum(
        1 for event in events
        if any(_seconds(item.get("item_id")) == PRIMOGEMS for item in _dicts(event.get("reward_list")))
    )
    print(f"  events with a reward of item {PRIMOGEMS}: {primogems}")
    ends = [_seconds(event.get("end_timestamp")) for event in events]
    starts = [_seconds(event.get("start_timestamp")) for event in events]
    # HoYoLAB gives 0 for a date it has not set: that event is undated, neither ended nor waiting.
    undated = sum(1 for start, end in zip(starts, ends) if start == 0 or end == 0)
    ended = sum(1 for end in ends if end is not None and 0 < end < now)
    waiting = sum(1 for start in starts if start is not None and start > now)
    print(f"  ended: {ended}, not started: {waiting}, undated: {undated}")
    print(f"  start_timestamp: {_types(e['start_timestamp'] for e in events if 'start_timestamp' in e)}")
    print(f"  end_timestamp: {_types(e['end_timestamp'] for e in events if 'end_timestamp' in e)}")
    for detail in DETAILS:
        carried = [event[detail] for event in events if detail in event]
        items = [item for value in carried for item in (_dicts(value) if isinstance(value, list) else [value]) if isinstance(item, dict)]
        suffix = " item" if detail == "reward_list" else ""
        print(f"  {detail}{suffix} fields: {_fields(items)}")


def _raw_answer(result: Any) -> Any:
    for response in result.raw:
        if response.endpoint == "act_calendar":
            return response.body
    return None


def main(now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> int:
    """Print what the calendar holds. 0 when the answer was read, else 1."""
    tokens = TokenStore(config.AppPaths(config.default_data_dir()).token_path)
    if tokens.load() is None:
        print("No HoYoLAB login is kept: log in in Guild Board first.")
        return 1
    print("Guild Board's calendar probe: it reads HoYoLAB's event calendar once with the stored login and prints counts, "
          "field names and the pictures' hosts alone, never a name, a value, the UID or anything of the login.",
          flush=True)
    print("A HoYoLAB login is kept.", flush=True)
    heard = _Heard()
    logger = logging.getLogger(hoyolab.__name__)
    logger.addHandler(heard)
    started = now()
    try:
        result = asyncio.run(HoyolabSource(tokens).fetch("calendar", now=started))
    except SourceError as error:
        print(f"The calendar could not be read: {type(error).__name__}: {error}")
        return 1
    except Exception as error:
        print(f"The calendar could not be read: {type(error).__name__}")
        return 1
    finally:
        logger.removeHandler(heard)
    body = _raw_answer(result)
    if not isinstance(body, dict):
        print("The answer has no calendar in it that can be counted.")
        return 1
    print(f"The library's model read the answer: {'no' if heard.unreadable else 'yes'}")
    _shape(body)
    _pools(body)
    _events(body, started.timestamp())
    return 0


if __name__ == "__main__":
    sys.exit(main())
