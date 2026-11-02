"""Layouts per place (spec 13): the widgets of the Board and of the overlay, each with an id, a type, a size in grid
cells, its place when it has one (look pass spec 10.1), whether it is pinned (the overlay shows its pinned widgets
while it is closed) and its settings, and each widget's own data, such as a note's text.

A layout keeps a revision, so that a save over a newer layout is refused. Widget types and keys this version does
not know are kept as they are, for a layout a later version saved (spec 13.4). None of this is part of the undo
history (achievements/progress.py).
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable

from guildboard.clock import Clock
from guildboard.store import Store, valid_text

PLACES = ("board", "overlay")
PLACE_NAMES = {"board": "Board", "overlay": "overlay"}
MAX_WIDGETS = 60
MAX_WIDGET_CHARS = 2_000  # one widget, as JSON
MAX_DATA_CHARS = 20_000  # a widget's own data, as JSON
MAX_CELLS = 8  # either way; known types go up to 6, a later version's may be larger
MAX_COLUMN = 99  # a widget's place: its column, from 0
MAX_ROW = 199  # and its row, from 0
NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")  # a widget's id, and its type

SHAPE = "A layout is a list of at most 60 widgets, each with an id, a type, a size and its settings."
SAME_ID = "Two widgets on one board have the same id."
TOO_LONG = "A widget keeps at most 20,000 characters."
NO_WIDGET = "There is no widget with this id."
NO_PLACE = "There is no such place."


def _starting(
    widget_id: str, widget_type: str, w: int, h: int, x: int | None = None, y: int | None = None, pinned: bool = False
) -> dict[str, Any]:
    """A starting widget. It has a place only when `x` and `y` are given, and the key `pinned` only when it is."""
    widget: dict[str, Any] = {"id": widget_id, "type": widget_type, "w": w, "h": h, "settings": {}}
    if x is not None:
        widget["x"] = x
    if y is not None:
        widget["y"] = y
    if pinned:
        widget["pinned"] = True
    return widget


# Spec 13.2's starting Board, at the sizes of plan 2A-3. Empty settings: each type has its defaults.
STARTING: dict[str, tuple[dict[str, Any], ...]] = {
    "board": (
        _starting("start-timers", "timers", 4, 3),
        _starting("start-commissions", "commissions", 3, 3),
        _starting("start-pinned", "pinned", 4, 3),
        _starting("start-resin", "resin", 2, 1),
        _starting("start-expeditions", "expeditions", 3, 2),
        _starting("start-resets", "resets", 2, 1),
        _starting("start-clock", "clock", 2, 1),
        _starting("start-notes", "notes", 3, 3),
    ),
    # The overlay's (plan 2A-4, call 2): down the left side, under the game's minimap, with the Timers at their
    # smallest size and pinned. The player moves them as they like.
    "overlay": (
        _starting("start-ov-timers", "timers", 3, 2, 0, 3, pinned=True),
        _starting("start-ov-clock", "clock", 2, 1, 0, 5),
        _starting("start-ov-quick", "quick-timer", 2, 2, 0, 6),
        _starting("start-ov-commissions", "commissions", 2, 3, 3, 3),
    ),
}


class LayoutError(ValueError):
    """A layout, or a widget's data, of a shape Guild Board does not keep. The message is fit to show."""


class LayoutChanged(Exception):
    """The layout changed since the page read it. The message is fit to show."""


class UnknownPlace(LookupError):
    pass


class UnknownWidget(LookupError):
    pass


def _whole(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _place_ok(item: dict[str, Any]) -> bool:
    """Whether a widget's place, the keys `x` and `y` where it has them, is whole cells from 0 and within the limits.
    A widget without them has no place yet, as every widget saved before places."""
    return all(
        key not in item or (_whole(item[key]) and 0 <= item[key] <= high)
        for key, high in (("x", MAX_COLUMN), ("y", MAX_ROW))
    )


def _valid(value: Any) -> Any:
    """`value` with every text made writable as UTF-8 (store.valid_text), in dicts and lists too."""
    if isinstance(value, str):
        return valid_text(value)
    if isinstance(value, dict):
        return {valid_text(str(key)): _valid(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_valid(item) for item in value]
    return value


def _dumped(value: Any) -> str | None:
    """`value` as JSON, or None when it is not JSON at all."""
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return None


def _is_widget(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    widget_id, widget_type, w, h = item.get("id"), item.get("type"), item.get("w"), item.get("h")
    dumped = _dumped(item)
    return (
        isinstance(widget_id, str) and NAME.fullmatch(widget_id) is not None
        and isinstance(widget_type, str) and NAME.fullmatch(widget_type) is not None
        and _whole(w) and 1 <= w <= MAX_CELLS and _whole(h) and 1 <= h <= MAX_CELLS
        and _place_ok(item)
        and isinstance(item.get("pinned", False), bool)
        and isinstance(item.get("settings"), dict)
        and dumped is not None and len(dumped) <= MAX_WIDGET_CHARS
    )


def parse_widgets(data: object) -> list[dict[str, Any]]:
    """The widgets a page sends, as they are, with every key kept; or LayoutError with one sentence."""
    if not isinstance(data, list) or len(data) > MAX_WIDGETS:
        raise LayoutError(SHAPE)
    widgets = [_valid(item) for item in data]
    if not all(_is_widget(item) for item in widgets):
        raise LayoutError(SHAPE)
    ids = [widget["id"] for widget in widgets]
    if len(set(ids)) != len(ids):
        raise LayoutError(SAME_ID)
    return widgets


def _timer_of(widget: dict[str, Any]) -> int | None:
    """The timer a One timer widget shows, or None."""
    settings = widget.get("settings")
    timer = settings.get("timer") if isinstance(settings, dict) else None
    return timer if widget.get("type") == "one-timer" and _whole(timer) else None


def with_timers(widgets: list[Any], rename: Callable[[Any], Any]) -> list[Any]:
    """The widgets, each timer they name passed through `rename`: a One timer widget's, and the ones a Timers widget chose.
    This PC's numbers name nothing on another PC, so a layout goes to the account with the timers' keys (cloud/sync.py)."""
    renamed = []
    for widget in widgets:
        settings = widget.get("settings") if isinstance(widget, dict) else None
        if isinstance(settings, dict) and widget.get("type") == "one-timer" and "timer" in settings:
            widget = {**widget, "settings": {**settings, "timer": rename(settings["timer"])}}
        elif isinstance(settings, dict) and widget.get("type") == "timers" and isinstance(settings.get("chosen"), list):
            widget = {**widget, "settings": {**settings, "chosen": [rename(timer) for timer in settings["chosen"]]}}
        renamed.append(widget)
    return renamed


def _check_place(place: str) -> None:
    if place not in PLACES:
        raise UnknownPlace(NO_PLACE)


class Layouts:
    def __init__(self, store: Store, clock: Clock) -> None:
        self._store = store
        self._clock = clock

    def get(self, place: str) -> dict[str, Any]:
        """The layout of a place: the saved one, or else its starting one at revision 0."""
        _check_place(place)
        row = self._store.layout(place)
        if row is None:
            widgets = [{**widget, "settings": dict(widget["settings"])} for widget in STARTING[place]]
            return {"place": place, "revision": 0, "widgets": widgets, "saved": False}
        return {"place": place, "revision": row.revision, "widgets": self._numbered(json.loads(row.widgets)), "saved": True}

    def _numbered(self, widgets: list[Any]) -> list[Any]:
        """A layout that came from another PC names its timers by their keys, and a page goes by this PC's numbers. A timer that has
        not come yet stays named by its key, which a page reads as none chosen, until it has."""
        numbers = {key: number for number, key in self._store.timer_keys().items()}
        return with_timers(widgets, lambda timer: numbers.get(timer, timer) if isinstance(timer, str) else timer)

    def save(self, place: str, revision: int, widgets: object) -> dict[str, Any]:
        """Save the widgets a page sends over the revision it read, or refuse them."""
        _check_place(place)
        parsed = parse_widgets(widgets)
        current = self.get(place)
        if revision != current["revision"]:
            raise LayoutChanged(f"The {PLACE_NAMES[place]} changed meanwhile. Look at it again.")
        return self._write(place, current, parsed)

    def _write(self, place: str, current: dict[str, Any], widgets: list[dict[str, Any]]) -> dict[str, Any]:
        """Save at the next revision, and drop the data of the widgets no place holds any more."""
        elsewhere = {w["id"] for other in PLACES if other != place for w in self.get(other)["widgets"]}
        kept = {widget["id"] for widget in widgets} | elsewhere
        gone = [widget["id"] for widget in current["widgets"] if widget["id"] not in kept]
        dumped = json.dumps(widgets, ensure_ascii=False)
        with self._store.transaction():
            self._store.put_layout(place, dumped, current["revision"] + 1, self._clock.now())
            self._store.drop_widget_data(gone)
        return self.get(place)

    def pin_timer(self, timer_id: int, on: bool) -> bool:
        """Put a timer on the Board as a One timer widget of 2 × 2 at its end, or take it off. Whether the Board
        changed. It is no change to undo, and no revision is checked: the pin is the player's latest wish."""
        current = self.get("board")
        widgets = current["widgets"]
        pinned = [widget for widget in widgets if _timer_of(widget) == timer_id]
        if on:
            if pinned:
                return False
            ids = {widget["id"] for widget in widgets}
            widget_id, number = f"pin-{timer_id}", 2
            while widget_id in ids:
                widget_id, number = f"pin-{timer_id}-{number}", number + 1
            one = {"id": widget_id, "type": "one-timer", "w": 2, "h": 2, "settings": {"timer": timer_id}}
            self._write("board", current, [*widgets, one])
            return True
        if not pinned:
            return False
        self._write("board", current, [widget for widget in widgets if _timer_of(widget) != timer_id])
        return True

    def pinned_timers(self) -> frozenset[int]:
        """The timers on the Board as One timer widgets."""
        timers = (_timer_of(widget) for widget in self.get("board")["widgets"])
        return frozenset(timer for timer in timers if timer is not None)

    def data(self, widget_id: str) -> Any:
        """A widget's own data, or None."""
        raw = self._store.widget_data(widget_id)
        return json.loads(raw) if raw is not None else None

    def put_data(self, widget_id: str, data: object) -> None:
        """Keep a widget's own data, for a widget that a place holds, saved or starting."""
        if not any(widget["id"] == widget_id for place in PLACES for widget in self.get(place)["widgets"]):
            raise UnknownWidget(NO_WIDGET)
        dumped = _dumped(_valid(data))
        if dumped is None or len(dumped) > MAX_DATA_CHARS:
            raise LayoutError(TOO_LONG)
        self._store.put_widget_data(widget_id, dumped, self._clock.now())
