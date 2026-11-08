"""The places of the page that a click can open, in one list: the launch link and every shell use it."""
from __future__ import annotations

import re

# Where the launch link may open the page: a click on a reminder opens Timers, or the Board for quick timers alone, and
# the overlay's window opens the overlay's page.
LAUNCH_PLACES = {
    "achievements/timers": "/#/achievements/timers", "board": "/#/board", "friends": "/#/friends", "overlay": "/#/overlay",
    "week": "/#/week", "codes": "/#/codes",
}
# A click on a Characters notice about a goal that is ready opens that character's profile: "characters/<slug>".
CHARACTER_PLACE = re.compile(r"characters/[a-z0-9]+(?:-[a-z0-9]+)*")
# The notifications a click opens a place for. A Characters notice opens Your week; one about a goal that is ready has the
# character in its kind, "characters/<slug>", and opens her profile (see place_of).
PLACES_BY_KIND = {"reminder": "achievements/timers", "quick": "board", "codes": "codes", "characters": "week"}


def place_of(kind: str | None) -> str | None:
    """The place a click on a notification of this kind opens, or None."""
    if kind is not None and CHARACTER_PLACE.fullmatch(kind):
        return kind
    return PLACES_BY_KIND.get(kind or "")


def launch_target(to: str) -> str:
    """Where the launch link opens the page for the place `to` names: "/#/<place>" for a known place, else "/"."""
    if CHARACTER_PLACE.fullmatch(to):
        return f"/#/{to}"
    return LAUNCH_PLACES.get(to, "/")
