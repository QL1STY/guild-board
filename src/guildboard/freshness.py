"""Whether the game's history stopped updating, and what the player does about it.

The history is read with a key, and a key runs out: a link from Feedback lasts a day, and without a login that can be given
keys nothing reads the history after that. Nothing fails that a page would show, so the primogems just stop, and a player
finds out days later. So the status says so, on every page, and a notification says it once (Core.tell_of_old_history).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal

# A link lasts 24 hours and the updates come each half hour, so a history this old has been missed, not just not yet read.
STALE_AFTER = timedelta(hours=26)

# How the history is read now: "failing", the updates with the login run and don't arrive; "login", a login that gets no keys,
# which a new login mends for good; "feedback", no login at all, so a link from the game alone.
How = Literal["failing", "login", "feedback"]

_FEEDBACK = "Open Feedback in the game, then press Import."
_NEXT: dict[str, tuple[str, str]] = {
    "failing": (f"The automatic update keeps failing. {_FEEDBACK}", "ledger"),
    "login": ("Log in to HoYoLAB again in Settings, and they update by themselves.", "settings"),
    "feedback": (_FEEDBACK, "ledger"),
}


def history_notice(last_read: datetime | None, played_at: datetime | None, now: datetime, how: How) -> dict[str, Any] | None:
    """What to tell the player, or None. A history never read has its own sentence on its page. While the game was not played
    since the last read there is nothing new to miss, unless the updates that need no game keep failing."""
    if last_read is None or now - last_read < STALE_AFTER:
        return None
    if how != "failing" and (played_at is None or played_at <= last_read):
        return None
    days = max((now - last_read).days, 1)
    what, page = _NEXT[how]
    return {"text": f"Your primogems have not updated for {days} {'day' if days == 1 else 'days'}. {what}", "page": page}
