"""What the online pages are told, apart from any client, so that the demo gives the same models from made-up values."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Mapping, Sequence

from guildboard.cloud import PIN_ORDER, STAT_KEYS
from guildboard.gameday import week_start
from guildboard.store import iso

OFFLINE_AFTER = 180  # seconds since a friend's last heartbeat (the online design, section 7)
SEEN_AT_MOST = 100 * 366 * 86_400  # seconds since a heartbeat that a time of this PC's can still be worked out from
MAX_PILLS = 3

# What the player reads for each refusal of the database (the online plan, Contracts).
SENTENCES = {
    "no_such_tag": "No player has that tag.",
    "no_such_uid": "No player can be found by that UID.",
    "request_limit": "You sent 20 requests today. Try again tomorrow.",
    "lookup_limit": "Wait a second and try again.",
    "friend_limit": "You have 200 friends, the most Guild Board allows.",
    "own_tag": "That is your own tag.",
    "already_friends": "You are already friends.",
    # Also the answer for 30 days after the player declined, when the Outgoing list shows nothing (0004).
    "already_sent": "This player has a request from you, or declined one in the last 30 days.",
    "invite_gone": "This invite was used or has expired. Ask for a new one.",
    "invalid_name": "Use 2 to 20 letters, digits, spaces, _ or -.",
    "no_such_request": "This request is no longer waiting.",
    "too_many_pins": "You can pin three stats at most.",
    "pin_not_shared": "Only a stat you share can be pinned.",
    "sync_full": "Your account holds as much synced data as it can. New changes stay on this PC.",
    "sync_busy": "Your account took a lot of changes this hour. The rest goes up soon.",
    # A first push of an account that holds no rows, when the places of the project are all taken (0005).
    "sync_seats_full": "All the places for syncing are taken right now. Your data stays on this PC, and friends and stats still work.",
    # A UID is unique only among the players who can be found by it (0004): with the switch off, it is always kept.
    "uid_taken": "Another Guild Board account can be found by this UID. Turn off Find me by UID to keep it on yours.",
    "invalid_uid": "A UID has 9 or 10 digits.",
    "incoming_full": "This player has too many friend requests waiting. Try again later.",
    # Not a code but sync_full's details, when the project as a whole is at its cap (0004): its owner's to fix.
    "project_full": (
        "The online server holds as much as it can for all its players. New changes stay on this PC until its owner makes room."
    ),
}
DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
MONTH = re.compile(r"([0-9]{4})-(0[1-9]|1[0-2])")
REFUSED = "The server refused this. Try again later."
NOT_CHANGED = "The server could not be reached, so nothing changed. Try again later."
NOT_READ = "The server could not be reached. Try again later."
NOT_A_FRIEND = "This player is not on your friends list."
SIGN_IN_FIRST = "Sign in first."
SIGN_IN_AGAIN = "Sign in again first."
UID_TAKEN = SENTENCES["uid_taken"]


class OnlineRefused(Exception):
    """A change or a read that did not happen, in a sentence for the player. `status` is the API's: 409 for a refusal, and
    503 for a server that could not be reached."""

    def __init__(self, sentence: str, status: int = 409) -> None:
        super().__init__(sentence)
        self.sentence = sentence
        self.status = status


def refusal(code: str) -> OnlineRefused:
    return OnlineRefused(SENTENCES.get(code, REFUSED))


def check_pins(keys: Iterable[str], sharing: Sequence[str]) -> list[str]:
    """The pins asked for, each once, when they keep the rules: at most three, each shared, never Status."""
    chosen = list(dict.fromkeys(keys))
    if any(key == "status" or key not in sharing for key in chosen):
        raise refusal("pin_not_shared")
    if len(chosen) > MAX_PILLS:
        raise refusal("too_many_pins")
    return chosen


def card_from(row: Mapping[str, Any]) -> dict[str, Any]:
    """A player as a request shows them: the four things anyone may see of them, and who they are."""
    return {
        "user_id": row.get("user_id"), "name": row.get("name"), "tag": row.get("tag"),
        "has_picture": row.get("has_picture") is True, "ar": row.get("ar"),
    }


def status_of(presence: Mapping[str, Any] | None) -> str | None:
    """None for a friend who doesn't share Status: they are not called offline, and their row shows nothing there. A friend is
    in game or offline, nothing between: a row that says Guild Board is open (an older version wrote those) is offline
    however fresh, as nothing a friend sees may say when a PC is on."""
    if presence is None:
        return None
    if presence["state"] != "in_game" or presence["seen_seconds"] > OFFLINE_AFTER:
        return "offline"
    return "in_game"


def pills_of(pins: Sequence[str], stats: Mapping[str, Any]) -> list[str]:
    """The stats beside a friend's name: their pins, or with none the first three they share, by `PIN_ORDER`."""
    pinned = [key for key in pins if key in stats]
    return pinned or [key for key in PIN_ORDER if key in stats][:MAX_PILLS]


def _week_of(named: Any) -> date | None:
    """The Monday of the week that a date names by a day inside it, or None where `named` is no such date."""
    if not isinstance(named, str) or DAY.fullmatch(named) is None:
        return None
    try:
        return week_start(date.fromisoformat(named))
    except ValueError:  # 2026-02-30, or a year the calendar does not have
        return None


def _playtime_aged(stat: Mapping[str, Any], this_week: date) -> dict[str, Any]:
    """The weeks hold no dates: they are the six that end with the week `week_start` names. A friend whose Guild Board last
    uploaded in an earlier week has the weeks moved along to end with this one, the ones that came since not known, and
    nothing "this week" or of the last 30 days, which are no longer so. A date that is missing or cannot be read is as old
    as it can be. A week ahead of ours is a friend's server being ahead of the clock here, and is left as it is."""
    named = _week_of(stat.get("week_start"))
    behind = None if named is None else (this_week - named).days // 7
    if behind is not None and behind <= 0:
        return dict(stat)
    aged = {**stat, "week_hours": None, "days30_hours": None, "week_start": this_week.isoformat()}
    weeks = stat.get("weeks")
    if isinstance(weeks, list):
        gone = len(weeks) if behind is None else min(behind, len(weeks))
        aged["weeks"] = [*weeks[gone:], *[None] * gone]
    return aged


def _spending_aged(stat: Mapping[str, Any], today: date) -> dict[str, Any]:
    """A total names its month. One of an earlier month, or with no month that can be read, is not this month's. A month
    ahead of ours is left as it is, as for the week."""
    named = stat.get("month")
    found = MONTH.fullmatch(named) if isinstance(named, str) else None
    if found is not None and (int(found[1]), int(found[2])) >= (today.year, today.month):
        return dict(stat)
    return {**stat, "month_total": None, "month": today.isoformat()[:7]}


def aged_stats(stats: Mapping[str, Any], today: date) -> dict[str, Any]:
    """A friend's stats as they are on `today`, the game day. Only the two that hold a week or a month are aged: the rest are
    a count or a state, and say what they said. Nothing given is changed, so the list the core keeps is aged anew each time
    it is read, also the one kept after a lost session (the online plan, Task C0)."""
    this_week = week_start(today)
    aged = dict(stats)
    if isinstance(aged.get("playtime"), Mapping):
        aged["playtime"] = _playtime_aged(aged["playtime"], this_week)
    if isinstance(aged.get("spending"), Mapping):
        aged["spending"] = _spending_aged(aged["spending"], today)
    return aged


def friend_from(row: Mapping[str, Any], read_at: datetime, today: date) -> dict[str, Any]:
    """A friend as `friends_overview` gave them at `read_at`, their numbers as they are on `today`. A value that is no stat of
    the list goes no further: friends are trusted with their own numbers, and the page with only the shapes it knows."""
    presence = row.get("presence") if isinstance(row.get("presence"), Mapping) else None
    status = status_of(presence)
    shared = row.get("stats") if isinstance(row.get("stats"), Mapping) else {}
    stats = aged_stats({key: value for key, value in shared.items() if key in STAT_KEYS and isinstance(value, Mapping)}, today)
    pins = row.get("pins") if isinstance(row.get("pins"), list) else []
    return {
        **card_from(row),
        "uid": row.get("uid"),
        "status": status,
        "since": presence.get("since") if presence is not None and status != "offline" else None,
        # Only a game's end is told; the last time a row said Guild Board was open is not.
        "last_seen": (
            iso(read_at - timedelta(seconds=presence["seen_seconds"]))
            if presence is not None and presence["state"] == "in_game" else None
        ),
        "stats": stats,
        "pills": pills_of(pins, stats),
        "compare": row.get("compare") is True,
    }


def build_friends(
    name: str, tag: str, overview: Mapping[str, Any] | None, read_at: datetime | None, stale: bool, today: date
) -> dict[str, Any]:
    """`GET /api/friends`, from the last `friends_overview` and when it was read; empty before the first one. `today` is the
    game day it is read on, which the friends' numbers are aged against: the Friends page, a friend's profile and Compare are
    all made from this, so all three get it."""
    rows = overview or {}
    friends = [row for row in _rows(rows.get("friends")) if _presence_fits(row.get("presence"))]
    return {
        "me": {"name": name, "tag": tag},
        "friends": [friend_from(row, read_at, today) for row in friends] if read_at is not None else [],
        "incoming": [card_from(row) for row in _rows(rows.get("incoming"))],
        "outgoing": [card_from(row) for row in _rows(rows.get("outgoing"))],
        "read_at": iso(read_at) if read_at is not None else None,
        "stale": stale,
    }


def _rows(value: Any) -> list[Mapping[str, Any]]:
    """The rows of one of `friends_overview`'s lists: an answer of another shape is no row of it (the audit's CLD-10)."""
    return [row for row in value if isinstance(row, Mapping)] if isinstance(value, list) else []


def _presence_fits(presence: Any) -> bool:
    """Whether a friend's presence can be read, where it is one: its state, the seconds since their last heartbeat, which a
    time of this PC's is worked out from, and when what it says began. A changed client can write any presence the table
    takes, and one friend's must not stop the list, their profile and Compare from answering."""
    if not isinstance(presence, Mapping):
        return True  # none: the friend does not share Status
    seconds, since = presence.get("seen_seconds"), presence.get("since")
    return (
        isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and abs(seconds) <= SEEN_AT_MOST
        and isinstance(presence.get("state"), str) and (since is None or isinstance(since, str))
    )


def age_of(friends: Mapping[str, Any]) -> dict[str, Any]:
    """How old a `build_friends` model is, for a page made from one of its friends."""
    return {"read_at": friends["read_at"], "stale": friends["stale"]}


def build_compare(
    me: Mapping[str, Any], friend: Mapping[str, Any], keys: Sequence[str], mine: Mapping[str, Any], week: date,
    friends: Mapping[str, Any],
) -> dict[str, Any]:
    """`GET /api/friends/{user}/compare`: the two players and the stats both share, and on neither side any other. `week` is
    the Monday this game week began on: a stat's weeks hold no dates, so the page names its columns from this. `friends` is the
    model the friend came from, which says how old they are."""
    return {
        "me": dict(me),
        "friend": {
            **friend,
            "stats": {key: value for key, value in friend["stats"].items() if key in keys},
            "pills": [key for key in friend["pills"] if key in keys],
        },
        "keys": list(keys),
        "mine": {key: value for key, value in mine.items() if key in keys},
        "week_start": week.isoformat(),
        **age_of(friends),
    }
