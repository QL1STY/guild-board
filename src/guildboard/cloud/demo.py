"""The demo's online account: made up, with no client at all, so the demo contacts nothing (the online design, section 11).
It gives the same models as `Online`, and its buttons change its memory alone, so that each page can be looked at in each of
its states. Its values are the mockup's, and its months follow the demo's clock."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable, Mapping

from guildboard.clock import Clock
from guildboard.cloud import SHARE_KEYS, SITE, STAT_KEYS
from guildboard.cloud.models import (
    NOT_A_FRIEND, NOT_CHANGED, SIGN_IN_AGAIN, SIGN_IN_FIRST, OnlineRefused, age_of, build_compare, build_friends, check_pins,
    refusal,
)
from guildboard.cloud.signin import tag_name
from guildboard.events import EventBus
from guildboard.gameday import game_day, week_start
from guildboard.sources.demo import DEMO_ACCOUNT, DEMO_SERVER
from guildboard.store import iso

DEMO_NAME, DEMO_TAG = "Traveler", "2048"
DEMO_USER = "00000000-0000-4000-8000-000000002048"
DEMO_INVITE = "DEMO-INVITE-0123456789"  # made up, as the demo's link is: it opens nothing
STATES = ("signed_in", "signed_out", "waiting", "sign_in_again", "offline", "invite", "invite_gone")
TOTAL_STAGES = 1558
# What the made-up account holds of the room that sync gives it (0005): about a sixth, with a place of its own.
DEMO_USAGE = {
    "rows_held": 3_333, "rows_limit": 20_000, "bytes_held": 699_050, "bytes_limit": 4_194_304, "has_place": True, "seats_full": False,
}
HOUR = 3600
DAY = 24 * HOUR


def _months(now: datetime, *earned: int) -> list[dict[str, Any]]:
    """Primogems earned in each of the last six months, oldest first, this month last."""
    year, month, months = now.year, now.month, []
    for value in reversed(earned):
        months.append({"month": f"{year:04d}-{month:02d}", "earned": value})
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return months[::-1]


def _week_and_month(now: datetime) -> tuple[str, str]:
    """The Monday of the demo's game week, and its month, as `collect_stats` names them."""
    today = game_day(now, DEMO_SERVER)
    return week_start(today).isoformat(), today.isoformat()[:7]


def _my_stats(now: datetime) -> dict[str, dict[str, Any]]:
    week, month = _week_and_month(now)
    return {
        "primogems": {"now": 16040, "months": _months(now, 6200, 7100, 5900, 8400, 7700, 9880)},
        "playtime": {
            "week_hours": 18.0, "days30_hours": 61.5, "weeks": [12.0, 9.5, 14.0, 11.5, 16.0, 18.0], "week_start": week,
            "longest_run": 14,
        },
        "achievements": {"ticked": 1402, "total": TOTAL_STAGES},
        "endgame": {"abyss_stars": 36, "theater_act": 10, "stygian": 5},
        "account": {"days_active": 812, "characters": 94, "chests": 3021},
        "wishes": {"pity": 62, "five_stars_90d": 3},
        "spending": {"month_total": 412.0, "month": month, "currency": "PLN"},
    }


def _uploaded(stats: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """A demo friend's stats as if their Guild Board had just uploaded them: a real friend's numbers are aged against the
    calendar, and the demo's are always of the week and the month it is, so that its pictures keep their numbers."""
    week, month = _week_and_month(now)
    named = {"playtime": {"week_start": week}, "spending": {"month": month}}
    return {key: {**value, **named.get(key, {})} for key, value in stats.items()}


def _riley(now: datetime) -> dict[str, Any]:
    return {
        "user_id": "00000000-0000-4000-8000-000000007687", "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58,
        "uid": 712345312, "presence": ("in_game", 42 * 60, 12), "pins": ["primogems", "endgame", "achievements"],
        "stats": {
            "primogems": {"now": 14320, "months": _months(now, 5400, 6900, 6100, 7900, 8200, 8160)},
            "playtime": {
                "week_hours": 21.0, "days30_hours": 58.0, "weeks": [10.0, 12.5, 9.0, 13.5, 15.0, 21.0], "longest_run": 11,
            },
            "achievements": {"ticked": 1402, "total": TOTAL_STAGES},
            "endgame": {"abyss_stars": 36, "theater_act": 8, "stygian": 6},
            "account": {"days_active": 790, "characters": 88, "chests": 2950},
        },
    }


def _kira() -> dict[str, Any]:
    return {
        "user_id": "00000000-0000-4000-8000-000000000412", "name": "Kira", "tag": "0412", "has_picture": False, "ar": 60,
        "uid": None, "presence": ("in_game", 4 * HOUR, 3 * HOUR), "pins": ["achievements", "playtime"],
        "stats": {
            "achievements": {"ticked": 1288, "total": TOTAL_STAGES},
            "playtime": {
                "week_hours": 9.0, "days30_hours": 40.5, "weeks": [6.0, 7.5, 8.0, 5.5, 9.5, 9.0], "longest_run": 6,
            },
        },
    }


def _milo() -> dict[str, Any]:
    return {
        "user_id": "00000000-0000-4000-8000-000000003391", "name": "Milo", "tag": "3391", "has_picture": False, "ar": 55,
        "uid": None, "presence": ("in_game", 3 * DAY, 2 * DAY), "pins": [], "stats": {},
    }


def _card(user: str, name: str, tag: str, ar: int | None) -> dict[str, Any]:
    return {"user_id": user, "name": name, "tag": tag, "has_picture": False, "ar": ar}


NOVA = _card("00000000-0000-4000-8000-000000005120", "Nova", "5120", 41)
ELENA = _card("00000000-0000-4000-8000-000000000031", "Elena", "0031", None)  # the one tag the demo can send a request to


def _as_friend(card: Mapping[str, Any]) -> dict[str, Any]:
    return {
        **card, "uid": None, "presence": ("in_game", 2 * HOUR, HOUR), "pins": [],
        "stats": {"achievements": {"ticked": 640, "total": TOTAL_STAGES}},
    }


class DemoOnline:
    def __init__(self, bus: EventBus, clock: Clock) -> None:
        self._bus = bus
        self._clock = clock
        self._state = "signed_in"
        self._offline = False
        self._name = DEMO_NAME
        self._sharing = ["status", "primogems", "playtime", "achievements", "endgame", "account"]
        self._pins = ["primogems", "endgame", "achievements"]
        self._find_by_uid = False
        self._friends = [_riley(clock.now()), _kira(), _milo()]
        self._incoming = [dict(NOVA)]
        self._outgoing: list[dict[str, Any]] = []
        self._invite: dict[str, Any] | None = None
        self._message: str | None = None
        self._shown = self.view()

    # ------------------------------------------------------------------ what the pages read
    def view(self) -> dict[str, Any]:
        named = self._state in ("signed_in", "sign_in_again")
        return {
            "state": self._state,
            "name": self._name if named else None,
            "tag": DEMO_TAG if named else None,
            "offline": self._offline,
            "message": self._message,
            "invite": self._invite,
            "sync": None,
            "usage": DEMO_USAGE if self._state == "signed_in" else None,
        }

    def _changed(self) -> None:
        view = self.view()
        if view != self._shown:
            self._shown = view
            self._bus.publish("online_changed")

    def _can_read(self) -> None:
        if self._state not in ("signed_in", "sign_in_again"):
            raise OnlineRefused(SIGN_IN_FIRST)

    def _can_change(self) -> None:
        self._can_read()
        if self._state == "sign_in_again":
            raise OnlineRefused(SIGN_IN_AGAIN)
        if self._offline:
            raise OnlineRefused(NOT_CHANGED, 503)

    def demo_state(self, state: str) -> None:
        """Puts the account in a state: one of the view's four, the server away, a link that was opened, or one that was used."""
        self._offline = state == "offline"
        if state == "invite":
            self._invite = {name: value for name, value in NOVA.items() if name != "user_id"}
        elif state == "invite_gone":
            self._message = refusal("invite_gone").sentence
        elif state != "offline":
            self._state = state
        self._changed()

    # ------------------------------------------------------------------ signing in and leaving
    def begin_sign_in(self, port: int) -> None:
        self._state = "signed_in"  # no browser and no Discord: the demo signs in at once
        self._changed()

    async def finish_sign_in(self, nonce: str, code: str | None) -> bool:
        return False  # the demo opens no browser, so nothing comes back

    async def sign_out(self) -> None:
        self._state = "signed_out"
        self._changed()

    async def sync_now(self) -> dict[str, Any]:
        return self.view()  # the demo has no account to sync with

    async def first_sync(self, choice: str) -> dict[str, Any]:
        return self.view()

    async def delete_account(self) -> None:
        self._state = "signed_out"
        self._changed()

    # ------------------------------------------------------------------ what a player shares
    def _profile(self) -> dict[str, Any]:
        return {
            "name": self._name, "tag": DEMO_TAG, "uid": DEMO_ACCOUNT.uid, "server": DEMO_SERVER, "status": "not_in_game",
            "since": None, "find_by_uid": self._find_by_uid, "sharing": list(self._sharing), "pins": list(self._pins),
            "stats": _my_stats(self._clock.now()),
        }

    async def your_profile(self) -> dict[str, Any]:
        self._can_read()
        return self._profile()

    async def set_sharing(self, keys: Iterable[str]) -> dict[str, Any]:
        self._can_change()
        wanted = set(keys)
        self._sharing = [key for key in SHARE_KEYS if key in wanted]
        self._pins = [pin for pin in self._pins if pin in self._sharing]
        return self._profile()

    async def set_pins(self, keys: Iterable[str]) -> dict[str, Any]:
        self._can_change()
        self._pins = check_pins(keys, self._sharing)
        return self._profile()

    async def set_find_by_uid(self, on: bool) -> dict[str, Any]:
        self._can_change()
        self._find_by_uid = on
        return self._profile()

    async def rename(self, name: str) -> dict[str, Any]:
        self._can_change()
        if tag_name(name) != name:
            raise refusal("invalid_name")
        self._name = name
        self._changed()
        return self._profile()

    # ------------------------------------------------------------------ friends
    def _both_share(self, friend: Mapping[str, Any]) -> list[str]:
        return [key for key in STAT_KEYS if key in self._sharing and key in friend["stats"]]

    def _row(self, friend: Mapping[str, Any], now: datetime) -> dict[str, Any]:
        state, began, seen = friend["presence"]
        presence = {"state": state, "since": iso(now - timedelta(seconds=began)), "seen_seconds": seen}
        stats = _uploaded(friend["stats"], now)
        return {**friend, "presence": presence, "stats": stats, "compare": bool(self._both_share(friend))}

    def _model(self) -> dict[str, Any]:
        now = self._clock.now()
        rows = {
            "friends": [self._row(friend, now) for friend in self._friends],
            "incoming": self._incoming, "outgoing": self._outgoing,
        }
        return build_friends(
            self._name, DEMO_TAG, rows, now, self._offline or self._state == "sign_in_again", game_day(now, DEMO_SERVER)
        )

    async def friends_model(self, fresh: bool = False) -> dict[str, Any]:
        self._can_read()
        return self._model()

    def _accept(self, card: Mapping[str, Any]) -> None:
        self._incoming = [waiting for waiting in self._incoming if waiting["user_id"] != card["user_id"]]
        self._friends.append(_as_friend(card))

    def _tag_of(self, player: Mapping[str, Any]) -> str:
        return f"{player['name']}#{player['tag']}".casefold()

    async def send_request(self, query: str) -> dict[str, Any]:
        self._can_change()
        wanted = query.strip().casefold()
        if wanted == f"{self._name}#{DEMO_TAG}".casefold():
            raise refusal("own_tag")
        if any(self._tag_of(friend) == wanted for friend in self._friends):
            raise refusal("already_friends")
        if any(self._tag_of(card) == wanted for card in self._outgoing):
            raise refusal("already_sent")
        for card in self._incoming:
            if self._tag_of(card) == wanted:
                self._accept(card)
                return self._model()
        if self._tag_of(ELENA) != wanted:
            raise refusal("no_such_uid" if wanted.isdigit() else "no_such_tag")
        self._outgoing.append(dict(ELENA))
        return self._model()

    async def accept(self, user: str) -> dict[str, Any]:
        self._can_change()
        for card in self._incoming:
            if card["user_id"] == user:
                self._accept(card)
                return self._model()
        raise refusal("no_such_request")

    async def decline(self, user: str) -> dict[str, Any]:
        self._can_change()
        if not any(card["user_id"] == user for card in self._incoming):
            raise refusal("no_such_request")
        self._incoming = [card for card in self._incoming if card["user_id"] != user]
        return self._model()

    async def remove(self, user: str) -> dict[str, Any]:
        self._can_change()
        self._friends = [friend for friend in self._friends if friend["user_id"] != user]
        self._incoming = [card for card in self._incoming if card["user_id"] != user]
        self._outgoing = [card for card in self._outgoing if card["user_id"] != user]
        return self._model()

    def _friend(self, user: str) -> dict[str, Any]:
        for friend in self._model()["friends"]:
            if friend["user_id"] == user:
                return friend
        raise OnlineRefused(NOT_A_FRIEND, 404)

    async def friend_profile(self, user: str) -> dict[str, Any]:
        self._can_read()
        return {"friend": self._friend(user), **age_of(self._model())}

    async def compare_model(self, user: str) -> dict[str, Any]:
        self._can_read()
        friend = self._friend(user)
        me = {
            "user_id": DEMO_USER, "name": self._name, "tag": DEMO_TAG, "has_picture": False, "ar": DEMO_ACCOUNT.level,
            "status": "not_in_game", "since": None,
        }
        now = self._clock.now()
        week = week_start(game_day(now, DEMO_SERVER))
        return build_compare(me, friend, self._both_share(friend), _my_stats(now), week, self._model())

    async def friend_picture(self, user: str) -> str | None:
        return None  # nothing is fetched: the page falls back to its sign

    # ------------------------------------------------------------------ invites
    async def invite_link(self) -> str:
        self._can_change()
        return f"{SITE}/functions/v1/invite?c={DEMO_INVITE}"

    async def offer_invite(self, code: str) -> None:
        self.demo_state("invite")

    async def send_invite(self) -> dict[str, Any]:
        self._can_change()
        if self._invite is None:
            raise refusal("invite_gone")
        self.drop_invite()
        for card in self._incoming:
            if card["user_id"] == NOVA["user_id"]:
                self._accept(card)
        return self._model()

    def drop_invite(self) -> None:
        self._invite = self._message = None
        self._changed()

    # ------------------------------------------------------------------ the core's task
    async def run(self) -> None:
        return None

    async def stop(self) -> None:
        return None
