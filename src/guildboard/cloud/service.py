"""`Online`: the one thing the core and the API call for the online account. Nothing happens here until the player signs in,
and everything local works without it (the online design, section 5)."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import webbrowser
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Iterable, Mapping, Sequence

from guildboard.clock import Clock
from guildboard.cloud import SHARE_KEYS, SITE, STAT_KEYS
from guildboard.cloud.client import CloudClient, CloudOffline, CloudRefused, SessionLost, tokens_from
from guildboard.cloud.models import (
    NOT_A_FRIEND, NOT_CHANGED, NOT_READ, SENTENCES, SIGN_IN_AGAIN, SIGN_IN_FIRST, UID_TAKEN, OnlineRefused, age_of,
    build_compare, build_friends, check_pins, refusal,
)
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.cloud.signin import FALLBACK_NAME, WaitingSignIn, discord_name, tag_name
from guildboard.cloud.sync import Sync, SyncSeam, events_of
from guildboard.events import EventBus
from guildboard.gameday import game_day_start, week_start
from guildboard.logging_setup import register_secret
from guildboard.store import iso

log = logging.getLogger(__name__)

NO_BROWSER = "The browser could not be opened. Try again."
NOT_FINISHED = "Signing in did not finish. Try again."
NOT_DELETED = "Your online data was not deleted. Try again later."
NOT_DELETED_OFFLINE = "Your online data was not deleted, because the server could not be reached. Try again later."
NOT_DELETED_LOST = "Your online data was not deleted. Sign in again first."
PROFILE_COLUMNS = "name,discriminator,picture_url,ar,uid,find_by_uid,pins,sharing"
# A UID is unique among the players who can be found by it (the audit's SQL-2): set_uid refuses one that another of them
# holds with this code, and the index it would break is this one.
UID_TAKEN_CODE = "uid_taken"
TAKEN_UID = "profiles_uid_findable"
TURN_SECONDS = 60  # presence once a minute (the online design, section 7)
EVERY_SECONDS = 300  # the profile, the stats and the friends every five minutes, as the design's sections 6 and 7 say
QUIET_SECONDS = 300  # after a failure: a paused project gets one try each five minutes, and no storm
FRESH_SECONDS = 55  # a page asks each minute: an answer this new is reused, so that two pages don't ask twice
PULL_SECONDS = 300  # the account's rows come down at the start and then every five minutes (the online design, section 8)
PUSH_QUIET_SECONDS = 10  # what the player changed goes up once they have changed nothing for this long
LOOK_SECONDS = 5  # how often sync looks at what waits to go up
OTHER_GAME_ACCOUNT = "This online account holds the data of another game account, so nothing is synced."
CLOCK_OFF = "This PC's clock is more than a minute off the server's, so nothing is synced. Set the time in Windows' settings."
CLOCK_OFF_SECONDS = 60  # past this, the stamps of this PC's edits cannot be told apart from another PC's by any clock
GAME_DAY_MINUTES = 24 * 60  # with Status off, the stats that changed go up at one minute of the game day, drawn at random
# send_friend_request's two refusals that are its answer and not an error (0002_friends.sql says why).
MISSES = ("no_such_tag", "no_such_uid")
PICTURE = re.compile(r"https://([a-z0-9-]+\.)*(hoyolab|hoyoverse|mihoyo)\.com/")
MAX_PICTURE = 500
MAX_AR = 60


@dataclass(frozen=True)
class Local:
    """What this PC knows, which the core hands in. Nothing else of the PC's reaches `Online`, so that what can leave it is
    here to read. `profile` is None without a HoYoLAB login; `game` is whether the game runs, and since when."""

    stats: Callable[[], dict[str, dict[str, Any]]] = dict
    profile: Callable[[], Mapping[str, Any] | None] = lambda: None
    game: Callable[[], tuple[bool, datetime | None]] = lambda: (False, None)
    server: Callable[[], str] = str
    today: Callable[[], date] = date.today  # the game day, which the server's reset begins
    sync: SyncSeam | None = None  # the player's own data (cloud/sync.py); None where there is none, as in the demo


def _name_and_tag(row: Any) -> tuple[str, str] | None:
    """What a row of `profiles` calls its player, or None when it isn't one."""
    if isinstance(row, Mapping) and isinstance(row.get("name"), str) and isinstance(row.get("discriminator"), str):
        return row["name"], row["discriminator"]
    return None


def _keys(value: Any, allowed: Sequence[str]) -> list[str]:
    return [key for key in value if key in allowed] if isinstance(value, list) else []


def _picture_fits(link: Any) -> bool:
    """Whether the table takes this as a picture (profiles_picture_is_hoyoverses): anything else would refuse the update."""
    return isinstance(link, str) and len(link) <= MAX_PICTURE and PICTURE.match(link) is not None


def _ar_fits(rank: Any) -> bool:
    """Whether the table takes this as an AR (profiles_ar_fits, 0004): anything else would refuse the update, picture and all."""
    return isinstance(rank, int) and not isinstance(rank, bool) and 1 <= rank <= MAX_AR


def _own_from(row: Mapping[str, Any]) -> dict[str, Any]:
    """What the server holds of the player, past their name and number, from a row of `profiles`."""
    return {
        "uid": row.get("uid"), "ar": row.get("ar"), "picture_url": row.get("picture_url"),
        "find_by_uid": row.get("find_by_uid") is True,
        "sharing": _keys(row.get("sharing"), SHARE_KEYS), "pins": _keys(row.get("pins"), STAT_KEYS),
    }


class Online:
    def __init__(
        self,
        store: CloudStore,
        bus: EventBus,
        clock: Clock,
        *,
        fetch: Callable[..., tuple[int, bytes]] | None = None,
        open_browser: Callable[[str], object] = webbrowser.open,
        local: Local = Local(),
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._store = store
        self._bus = bus
        self._clock = clock
        self._open_browser = open_browser
        self._local = local
        self._sleep = sleep
        self._now = lambda: clock.now().timestamp()
        self._client = CloudClient(store, now=self._now, **({} if fetch is None else {"fetch": fetch}))
        self._waiting = WaitingSignIn(now=self._now)
        self._finishing = False  # a sign-in's session is kept, and its profile is on the way
        self._lost = False  # the server refused the session for good: the player has to sign in again
        self._offline = False
        self._message: str | None = None
        self._own: dict[str, Any] | None = None  # what the server holds of the player, as it last said
        self._sent: dict[str, str] = {}  # each stat as it last went up, as JSON text
        # With Status off: the game day whose changed stats went up, and the minute drawn for a game day at which they go.
        self._stats_day: date | None = None
        self._stats_minute: tuple[date, datetime] | None = None
        self._uid_refused: int | None = None  # the UID the server said another account holds
        self._open_since = clock.now()  # when Guild Board was last open with no game running
        self._was_in_game = False
        self._overview: Mapping[str, Any] | None = None  # the last friends_overview
        self._read_at: datetime | None = None  # when it was read
        self._compared: dict[str, tuple[float, list[Any]]] = {}  # what compare_keys said of each friend, and when
        self._stale = False  # the last read of it failed
        self._next_pass = 0.0  # when the profile, the stats and the friends are next due
        self._quiet_until = 0.0  # no request of the core's own before this, after a failure
        self._wake = asyncio.Event()  # a sign-in starts the turns
        self._invite_code: str | None = None  # an invite link that was opened
        self._invite: dict[str, Any] | None = None  # who it is from, once the server has said
        self._sync = Sync(local.sync, self._client, clock.now) if local.sync is not None else None
        self._sync_wake = asyncio.Event()  # a sign-in starts the look at what waits to go up
        self._next_pull = 0.0  # when the account's rows are next due
        self._push_seen: tuple[int, int | None] | None = None  # the outbox as it was at the last look: its count and newest line
        self._push_seen_at = 0.0  # since when it has been so
        self._push_retry_at = 0.0  # no push before this, after the server refused one
        self._push_refused: str | None = None  # why what the player changed stays here, until a push goes through
        self._look_retry_at = 0.0  # no look before this, after the server refused what a look begins with
        self._sync_lock = asyncio.Lock()  # one look, one answer to the question or one Sync now at a time
        self._usage: dict[str, Any] | None = None  # the room the copy takes, as sync_usage last said (0005)
        self._usage_due = True  # read after a sync that moved rows and at the start of a session, and on no timer of its own
        store.load()  # the tokens are masked in the log from here on
        self._shown = self.view()

    # ------------------------------------------------------------------ what the pages read
    def view(self) -> dict[str, Any]:
        session = self._store.load()
        state = self._state(session)
        sync, seam = self._sync, self._local.sync
        syncing = sync is not None and seam is not None and state == "signed_in"
        return {
            "state": state,
            "name": (session.name or None) if session is not None else None,
            "tag": (session.tag or None) if session is not None else None,
            "offline": self._offline,
            "message": (
                self._message or self._push_refused or (OTHER_GAME_ACCOUNT if syncing and self._account_differs() else None)
                or (CLOCK_OFF if syncing and self._clock_off() else None)
            ),
            "invite": self._invite,
            "sync": {
                "on": bool(seam.on()), "last_at": sync.last_at(), "needs_choice": sync.first_state() == "asking",
            } if syncing else None,
            "usage": dict(self._usage) if self._usage is not None and state == "signed_in" else None,
        }

    def _state(self, session: CloudSession | None) -> str:
        if self._finishing or self._waiting.is_waiting:
            return "waiting"
        if self._lost:
            return "sign_in_again"
        return "signed_in" if session is not None else "signed_out"

    def _changed(self) -> None:
        view = self.view()
        if view != self._shown:
            self._shown = view
            self._bus.publish("online_changed")

    # ------------------------------------------------------------------ signing in
    def begin_sign_in(self, port: int) -> None:
        """Opens the system browser. A second press starts over, for a player who closed the first tab."""
        if self._store.load() is not None and not self._lost:
            return
        address = self._waiting.begin(port)
        self._message = None
        try:
            opened = self._open_browser(address)
        except (OSError, webbrowser.Error):
            opened = False
        if opened is False:
            self._waiting.drop()
            self._message = NO_BROWSER
        self._changed()

    async def finish_sign_in(self, nonce: str, code: str | None) -> bool:
        """Finishes the sign-in this nonce began. Whether the player is signed in now. A nonce that isn't waiting changes
        nothing; a sign-in that comes back without a code, as one the player cancelled does, is spent."""
        verifier = self._waiting.take(nonce)
        if verifier is None:
            return False
        if code:
            register_secret(code)  # this sign-in's own code: masked in the log from here on, before it is sent
        self._finishing = True
        try:
            finished = bool(code) and await self._finish(code, verifier)
        finally:
            self._finishing = False
        self._message = None if finished else NOT_FINISHED
        if finished:
            self._waiting.drop()  # a second press while this one was finished waits for nothing now
        self._changed()
        if finished:
            self._wake.set()
            self._sync_wake.set()
            await self._guarded(self._peek)  # a link opened while signed out waited for this
            self._changed()
        return finished

    async def _finish(self, code: str, verifier: str) -> bool:
        """Trades the code for a session, and gets the profile that names it. The first failing leaves what was there
        before; the second leaves no half-made account."""
        try:
            answer = await self._client.exchange(code, verifier)
            user = answer.get("user")
            user_id = user.get("id") if isinstance(user, Mapping) else None
            if not isinstance(user_id, str) or not user_id:
                return False
            session = CloudSession(**tokens_from(answer, self._now()), user_id=user_id, name="", tag="")
        except (CloudOffline, CloudRefused):
            return False
        self._store.save(session)  # the client asks for the profile with what the store holds
        self._start_afresh()
        try:
            name, tag = await self._profile(tag_name(discord_name(user)))
        except (CloudOffline, CloudRefused, SessionLost):
            self._store.delete()
            return False
        current = self._store.load()
        if current is None:  # the player signed out meanwhile
            return False
        self._store.save(replace(current, name=name, tag=tag))
        return True

    async def _profile(self, name: str) -> tuple[str, str]:
        """The player's name and number. The database has the last word on a name: Python and Postgres don't read every
        letter alike, and the fallback always fits."""
        try:
            row = await self._client.rpc("ensure_profile", {"p_name": name})
        except CloudRefused as refused:
            if refused.code != "invalid_name":
                raise
            row = await self._client.rpc("ensure_profile", {"p_name": FALLBACK_NAME})
        named = _name_and_tag(row)
        if named is None:
            raise CloudOffline
        return named

    # ------------------------------------------------------------------ leaving
    def _start_afresh(self) -> None:
        """Nothing of a session that ended stays: the next one may be another Discord account's."""
        self._lost = self._offline = self._stale = False
        self._own = self._uid_refused = self._overview = self._read_at = None
        self._stats_day = self._stats_minute = None
        self._sent.clear()
        self._compared.clear()
        self._next_pass = self._quiet_until = 0.0
        self._next_pull = self._push_seen_at = self._push_retry_at = self._look_retry_at = 0.0  # the next session reads at once
        self._push_seen = self._push_refused = None
        self._usage, self._usage_due = None, True

    def _forget(self) -> None:
        self._store.delete()
        self._waiting.drop()
        self._start_afresh()
        self._message = self._invite_code = self._invite = None

    async def sign_out(self) -> None:
        """The server is told when it can be reached; either way, the session on this PC ends."""
        if self._store.load() is not None:
            try:
                await self._client.sign_out()
            except (CloudOffline, CloudRefused, SessionLost):
                log.info("The online server was not told of the sign-out.")
        self._forget()
        self._changed()

    async def delete_account(self) -> None:
        """Delete my online data. Only an answer that it was done ends the session: until then the data is still there,
        and the player needs the session to try again."""
        self._message = None
        try:
            await self._client.rpc("delete_my_account")
        except CloudOffline:
            self._offline, self._message = True, NOT_DELETED_OFFLINE
        except CloudRefused:
            self._offline, self._message = False, NOT_DELETED
        except SessionLost as lost:
            self._session_lost(lost)
            self._message = NOT_DELETED_LOST if self._lost else NOT_DELETED
        else:
            self._forget()
        self._changed()

    # ------------------------------------------------------------------ what a player shares
    def _session(self) -> CloudSession:
        session = self._store.load()
        if session is None:
            raise OnlineRefused(SIGN_IN_FIRST)
        return session

    def _session_lost(self, lost: SessionLost | None = None) -> None:
        """The server refused the session for good. A refusal of a session that is no longer the one kept, as a request of the
        old one can be after the player signed in again, says nothing of the one kept now."""
        current = self._store.load()
        about = lost.refresh_token if lost is not None else None
        if current is None or about is None or about == current.refresh_token:
            self._lost = current is not None  # no session at all is a sign-out while this waited
        self._changed()

    def _away(self) -> None:
        """The server didn't answer: Settings says so, and the core's own requests wait."""
        self._offline = True
        self._quiet_until = self._now() + QUIET_SECONDS

    def _back(self) -> None:
        self._offline = False
        self._quiet_until = 0.0

    def _quiet(self) -> bool:
        return self._now() < self._quiet_until

    async def _change(self, call: Awaitable[Any], offline: str = NOT_CHANGED) -> Any:
        """One thing the player asked for, on the server: it happens there or it doesn't happen, and the caller keeps
        nothing until it did. Each way it can go wrong comes back as a sentence."""
        try:
            answer = await call
        except CloudOffline:
            self._away()
            self._changed()
            raise OnlineRefused(offline, 503) from None
        except SessionLost as lost:
            self._session_lost(lost)
            raise OnlineRefused(SIGN_IN_AGAIN) from None
        except CloudRefused as refused:
            if refused.code == "not_signed_in":  # the row is gone: an account deleted on another device
                self._session_lost()
                raise OnlineRefused(SIGN_IN_AGAIN) from None
            raise refusal(refused.code) from None
        self._back()
        self._changed()
        return answer

    async def _own_row(self) -> dict[str, Any]:
        self._session()
        if self._own is None:
            if self._lost:  # nothing goes out on a session the server refused: the player signs in again first
                raise OnlineRefused(SIGN_IN_AGAIN)
            await self._change(self._read_profile(), NOT_READ)
        if self._own is None:
            raise OnlineRefused(NOT_READ, 503)  # the server answered with no row it could read
        return self._own

    def _my_status(self) -> tuple[str, datetime]:
        """In game while the game runs, Guild Board open otherwise, and when that began."""
        running, started = self._local.game()
        if running and started is not None:
            self._was_in_game = True
            return "in_game", started
        if self._was_in_game:
            self._was_in_game, self._open_since = False, self._clock.now()
        return "open", self._open_since

    def _profile_model(self) -> dict[str, Any]:
        session, own = self._session(), self._own or _own_from({})
        status, since = self._my_status()
        return {
            "name": session.name, "tag": session.tag, "uid": own["uid"], "server": self._local.server(),
            "status": status, "since": iso(since), "find_by_uid": own["find_by_uid"],
            "sharing": list(own["sharing"]), "pins": list(own["pins"]), "stats": self._local.stats(),
        }

    async def your_profile(self) -> dict[str, Any]:
        await self._own_row()
        return self._profile_model()

    async def set_sharing(self, keys: Iterable[str]) -> dict[str, Any]:
        """Offline, the switch can't change and says so: a friend still sees the old value. A key that came on goes up at
        once; if that fails the switch is on all the same, and the next turn sends it."""
        own, wanted = await self._own_row(), set(keys)
        chosen = [key for key in SHARE_KEYS if key in wanted]
        await self._change(self._client.rpc("set_sharing", {"p_keys": chosen}))
        self._compared.clear()  # what the player shares with each friend is not what it was
        came_on = [key for key in chosen if key not in own["sharing"] and key in STAT_KEYS]
        for key in own["sharing"]:
            if key not in chosen:
                self._sent.pop(key, None)  # its row is gone, so what was sent says nothing of what is there
        self._own = {**own, "sharing": chosen, "pins": [pin for pin in own["pins"] if pin in chosen]}
        if came_on:
            await self._guarded(lambda: self._send_stats(came_on))
            self._changed()
        return self._profile_model()

    async def set_pins(self, keys: Iterable[str]) -> dict[str, Any]:
        own = await self._own_row()
        chosen = check_pins(keys, own["sharing"])
        await self._change(self._client.rpc("set_pins", {"p_keys": chosen}))
        self._own = {**own, "pins": chosen}
        return self._profile_model()

    async def set_find_by_uid(self, on: bool) -> dict[str, Any]:
        """The switch goes up with the UID the server holds, through set_uid, which writes both."""
        own = await self._own_row()
        await self._change(self._client.rpc("set_uid", {"p_uid": own["uid"], "p_find": on}))
        self._own = {**own, "find_by_uid": on}
        # Whether another account holds a UID depends on the switch: one refused before may be held now, on the next pass.
        self._uid_refused = None
        if self._message == UID_TAKEN:
            self._message = None
        return self._profile_model()

    async def rename(self, name: str) -> dict[str, Any]:
        await self._own_row()
        named = _name_and_tag(await self._change(self._client.rpc("rename_profile", {"p_name": name})))
        current = self._store.load()
        if named is not None and current is not None:
            self._store.save(replace(current, name=named[0], tag=named[1]))
        self._changed()
        return self._profile_model()

    # ------------------------------------------------------------------ friends
    async def friends_model(self, fresh: bool = False) -> dict[str, Any]:
        """The last list, read again when there is none or the page asks and it isn't new. With the server away or the
        session lost it is the one before, marked as old."""
        session = self._session()
        old = self._read_at is not None and self._now() - self._read_at.timestamp() >= FRESH_SECONDS
        if not self._lost and not self._quiet() and (self._overview is None or (fresh and old)):
            await self._guarded(self._read_friends)
            self._changed()
        stale = self._stale or self._lost or self._quiet()
        return build_friends(session.name, session.tag, self._overview, self._read_at, stale, self._local.today())

    async def _friends_changed(self) -> dict[str, Any]:
        """The list after something changed it: read now, however new the last one is."""
        session = self._session()
        await self._guarded(self._read_friends)
        self._changed()
        return build_friends(session.name, session.tag, self._overview, self._read_at, self._stale, self._local.today())

    async def _request(self, query: str) -> Any:
        said = await self._client.rpc("send_friend_request", {"p_query": query})
        if said in MISSES:
            raise CloudRefused(said)
        return said

    async def send_request(self, query: str) -> dict[str, Any]:
        self._session()
        await self._change(self._request(query))
        return await self._friends_changed()

    async def _answer(self, user: str, accept: bool) -> dict[str, Any]:
        self._session()
        await self._change(self._client.rpc("answer_friend_request", {"p_user": user, "p_accept": accept}))
        return await self._friends_changed()

    async def accept(self, user: str) -> dict[str, Any]:
        return await self._answer(user, True)

    async def decline(self, user: str) -> dict[str, Any]:
        return await self._answer(user, False)

    async def remove(self, user: str) -> dict[str, Any]:
        self._session()
        await self._change(self._client.rpc("remove_friend", {"p_user": user}))
        return await self._friends_changed()

    async def _friend(self, user: str) -> tuple[dict[str, Any], dict[str, Any]]:
        """A friend, and the model they came from."""
        model = await self.friends_model()
        for friend in model["friends"]:
            if friend["user_id"] == user:
                return friend, model
        raise OnlineRefused(NOT_A_FRIEND, 404)

    async def friend_profile(self, user: str) -> dict[str, Any]:
        friend, friends = await self._friend(user)
        return {"friend": friend, **age_of(friends)}

    async def _compare_names(self, user: str, friend: Mapping[str, Any], own: Mapping[str, Any]) -> list[Any]:
        """What the two of them share, from `compare_keys`. With the session lost or the server away nothing goes out: the
        last known friend is compared, by what the two sides last said they share."""
        if self._lost or self._quiet():
            return [key for key in own["sharing"] if key in friend["stats"]]
        held = self._compared.get(user)
        if held is not None and self._now() - held[0] < FRESH_SECONDS:  # Compare reads again at each event of the core
            return held[1]
        rows = await self._change(self._client.rpc("compare_keys", {"p_friend": user}), NOT_READ)
        names = [row.get("compare_keys") if isinstance(row, Mapping) else row for row in rows or []]
        self._compared[user] = (self._now(), names)
        return names

    async def compare_model(self, user: str) -> dict[str, Any]:
        """Compare: only what `compare_keys` names, the rule the phone will apply too, whatever else the friend shares."""
        (friend, friends), own, session = await self._friend(user), await self._own_row(), self._session()
        names = await self._compare_names(user, friend, own)
        status, since = self._my_status()
        me = {
            "user_id": session.user_id, "name": session.name, "tag": session.tag, "has_picture": own["picture_url"] is not None,
            "ar": own["ar"], "status": status, "since": iso(since),
        }
        keys = [key for key in STAT_KEYS if key in names]
        return build_compare(me, friend, keys, self._local.stats(), week_start(self._local.today()), friends)

    async def friend_picture(self, user: str) -> str | None:
        """The address of a friend's picture, which row level security gives to their friends alone."""
        self._session()
        if self._quiet() or self._lost:
            return None
        query = f"select=picture_url&user_id=eq.{user}"
        rows = await self._change(self._client.select("profiles", query), NOT_READ)
        link = rows[0].get("picture_url") if rows and isinstance(rows[0], Mapping) else None
        return link if isinstance(link, str) else None

    # ------------------------------------------------------------------ invites
    async def invite_link(self) -> str:
        self._session()
        code = await self._change(self._client.rpc("make_invite"))
        return f"{SITE}/functions/v1/invite?c={code}"

    async def offer_invite(self, code: str) -> None:
        """A link was opened, and all that does is show who it is from: the inviter accepts their own invite, so a click
        alone would hand them the player's shared stats. Nothing goes out until Send request. Signed out, it waits."""
        self._invite_code, self._invite, self._message = code, None, None
        if self._store.load() is not None and not self._lost:
            await self._guarded(self._peek)
        self._changed()

    async def _peek(self) -> None:
        code = self._invite_code
        if code is None or self._invite is not None:
            return
        try:
            card = await self._client.rpc("peek_invite", {"p_code": code})
        except CloudRefused as refused:
            self._invite_code, self._message = None, refusal(refused.code).sentence
            return
        if not isinstance(card, Mapping):
            log.warning("The online server's answer about an invite could not be read.")
            raise CloudOffline
        self._invite = {name: card.get(name) for name in ("name", "tag", "has_picture", "ar")}

    async def send_invite(self) -> dict[str, Any]:
        """The player pressed Send request, on the invite the page showed them. A refusal ends it. The server being away
        doesn't, and neither does a lost session, which still shows the card: the player can press again."""
        self._session()
        if self._invite_code is None or self._invite is None:
            raise refusal("invite_gone")
        try:
            await self._change(self._client.rpc("redeem_invite", {"p_code": self._invite_code}))
        except OnlineRefused as refused:
            if refused.status != 503 and not self._lost:
                self.drop_invite()
            raise
        self.drop_invite()
        return await self._friends_changed()

    def drop_invite(self) -> None:
        """Ends the invite that is waiting, and what was said of the last one: Friends shows that until the player ignores it."""
        self._invite_code = self._invite = self._message = None
        self._changed()

    # ------------------------------------------------------------------ the core's task
    async def _guarded(self, step: Callable[[], Awaitable[None]]) -> bool:
        """One thing the core does by itself. Whether the next may follow: not with the server away or the session lost. A
        refusal says nothing of the server, and neither does a stat that can't be worked out, so the others go on, and the
        next turn asks again."""
        try:
            await step()
        except CloudOffline:
            self._away()
            return False
        except SessionLost as lost:
            self._session_lost(lost)
            return False
        except CloudRefused:
            self._back()
            log.warning("The online server refused a request.")
            return True
        except Exception:
            log.exception("An online step failed; the others go on.")
            return True
        self._back()
        return True

    async def look(self) -> None:
        """A look at the profile, so that Settings tells the truth about the session."""
        if self._store.load() is not None:
            await self._guarded(self._read_profile)
            self._changed()

    async def turn(self) -> None:
        """Whatever is due. One failure ends the turn: nothing more goes out, and the next try is the only one for five
        minutes, so that a paused project sees no storm and nothing is lost."""
        now = self._now()
        if self._store.load() is None or self._lost or self._quiet():
            return
        due = now >= self._next_pass
        steps = (self._read_profile, self._send_profile, self._send_stats, self._read_friends) if due else ()
        waiting = (self._peek,) if self._invite_code is not None and self._invite is None else ()
        for step in (*waiting, *steps, self._beat):
            if not await self._guarded(step) or self._lost:
                break
        else:
            if due:
                self._next_pass = now + EVERY_SECONDS
        self._changed()

    async def run(self) -> None:
        """The core's task: nothing at all until the player signs in, and then a turn each minute until the session ends. Sync
        has a loop of its own beside it, which looks every few seconds at what waits to go up."""
        syncing = asyncio.create_task(self._run_sync()) if self._sync is not None else None
        try:
            while True:
                if self._store.load() is None or self._lost:
                    self._wake.clear()
                    await self._wake.wait()
                try:
                    await self.turn()
                except Exception:  # a turn that fails must not end the loop, whose end would cancel the sync loop too
                    log.exception("An online turn failed; the next one goes on.")
                await self._sleep(TURN_SECONDS)
        finally:
            if syncing is not None:
                syncing.cancel()
                await asyncio.gather(syncing, return_exceptions=True)

    async def _run_sync(self) -> None:
        while True:
            if self._store.load() is None or self._lost:
                self._sync_wake.clear()
                await self._sync_wake.wait()
            try:
                await self.sync_turn()
            except Exception:  # a look that fails must not end the loop, which nothing would start again
                log.exception("A look at what waits to sync failed; the next one goes on.")
            await self._sleep(LOOK_SECONDS)

    # ------------------------------------------------------------------ the player's own data
    def _sync_ready(self) -> bool:
        """Whether sync may move anything: signed in with the session in order, and the switch on."""
        return (
            self._sync is not None and self._local.sync is not None and self._store.load() is not None
            and not self._lost and bool(self._local.sync.on())
        )

    def _clock_off(self) -> bool:
        """Whether this PC's clock is more than a minute off the server's, as its last answer said: the outbox's stamps are this
        PC's clock, and those made while it was off by so much cannot be set right after the fact."""
        return abs(self._client.server_ahead()) > CLOCK_OFF_SECONDS

    def _account_differs(self) -> bool:
        """Whether the account holds the UID of another game account than this PC's. Two never mix on one account (the online
        plan, Review Focus 5). Where either is not known yet nothing differs. This PC's is that of its login, or without one that
        of the folder, which follows one game account (auth.py)."""
        facts, own, seam = self._local.profile(), self._own, self._local.sync
        mine = facts.get("uid") if facts is not None else None
        if mine is None and seam is not None:
            mine = seam.uid()
        if own is None or own["uid"] is None or mine is None:
            return False
        return bool(own["uid"] != mine)

    async def _pull(self) -> None:
        assert self._sync is not None and self._local.sync is not None
        events = events_of(await self._sync.pull())
        if events:
            self._usage_due = True
            try:
                self._local.sync.changed(events)
            except Exception:
                log.exception("The pages could not be told of the rows that came.")

    async def _push(self) -> None:
        assert self._sync is not None
        try:
            if await self._sync.push():
                self._usage_due = True
        except CloudRefused as refused:
            self._push_retry_at = self._now() + QUIET_SECONDS  # a refusal is not repeated at once
            # sync_full has two causes, which its details tell apart: this account's share, or the whole project (0004).
            said = "project_full" if refused.code == "sync_full" and refused.detail == "project_full" else refused.code
            if said in SENTENCES:  # one the player can read: their changes wait, and they are told why
                self._push_refused = SENTENCES[said]
            raise
        self._push_refused = None

    async def _push_when_quiet(self, now: float) -> None:
        assert self._sync is not None
        waiting = self._sync.outbox_state()
        if waiting != self._push_seen:
            self._push_seen, self._push_seen_at = waiting, now
        if waiting[0] and now - self._push_seen_at >= PUSH_QUIET_SECONDS and now >= self._push_retry_at:
            await self._guarded(self._push)

    async def _first(self) -> bool:
        """Whether this PC's first sync with the account is settled, so that rows may move. It is settled at once when only one
        of them holds data; when both do the player is asked once, and nothing moves until they answer. A server that does not
        answer leaves it for the next look."""
        assert self._sync is not None
        state = self._sync.first_state()
        if state is None and await self._guarded(self._first_look):
            state = self._sync.first_state()
            if state is None:  # refused, which says nothing of the server: the loop must not ask again at once
                self._look_retry_at = self._now() + QUIET_SECONDS
        return state == "done"

    async def _first_look(self) -> None:
        assert self._sync is not None
        if await self._sync.first_look() == "asking":
            self._changed()  # Settings shows the question

    async def _keep_this_pc(self) -> None:
        assert self._sync is not None
        await self._sync.keep_this_pc()
        await self._push()

    async def _use_the_account(self) -> None:
        assert self._sync is not None and self._local.sync is not None
        kinds = await self._sync.use_the_account()
        self._next_pull = self._now() + PULL_SECONDS
        self._usage_due = self._usage_due or bool(kinds)
        try:
            self._local.sync.changed(events_of(kinds))
        except Exception:
            log.exception("The pages could not be told of the rows that came.")

    async def first_sync(self, choice: str) -> dict[str, Any]:
        """The player's answer to the question of the first sync: "keep" this PC's data, or "use" the account's. Nothing is
        asked of a PC that has no question; a server that does not answer leaves the question, and the data, as they were."""
        async with self._sync_lock:
            if (
                self._sync_ready() and self._sync is not None and self._sync.first_state() == "asking"
                and await self._sync_account() and not self._clock_off()
            ):
                if choice == "keep":
                    await self._guarded(self._keep_this_pc)
                elif choice == "use":  # nothing else is taken for it: this one replaces what is here
                    await self._guarded(self._use_the_account)
                await self._read_usage()
            self._changed()
            return self.view()

    async def _sync_account(self) -> bool:
        """Whether this PC's data may be synced with the account: its profile is known and holds no other game account."""
        session = self._store.load()
        if session is None or self._sync is None:
            return False
        if self._own is None and not await self._guarded(self._read_profile):
            return False
        if self._own is None:  # refused or unreadable: not knowing the account is no reason to think it is this game account's
            self._look_retry_at = self._now() + QUIET_SECONDS
            return False
        self._sync.use_account(session.user_id)
        if self._account_differs():
            self._changed()  # the page learns why nothing moves
            return False
        return True

    async def sync_turn(self) -> None:
        """Whatever sync has due: the account's rows at the start and then every five minutes, and what the player changed
        once they have changed nothing for ten seconds. Nothing at all signed out, with the switch off, or while the server is
        away, and the changes wait in the outbox."""
        async with self._sync_lock:
            if not self._sync_ready() or self._quiet() or self._now() < self._look_retry_at or not await self._sync_account():
                return
            if self._clock_off():  # the turns measure it again with each answer, and sync goes on once it is right
                self._changed()  # Settings says why nothing moves
                return
            if not await self._first():
                self._changed()
                return
            now = self._now()
            if now >= self._next_pull:
                self._next_pull = now + PULL_SECONDS
                if not await self._guarded(self._pull):
                    self._changed()
                    return
            await self._push_when_quiet(now)
            await self._read_usage()
            self._changed()  # the time of the last sync is on Settings

    async def sync_now(self) -> dict[str, Any]:
        """Settings' Sync now: the account's rows and then this PC's changes, at once, however the server has been."""
        async with self._sync_lock:
            if self._sync_ready() and await self._sync_account() and await self._clock_right() and await self._first():
                if await self._guarded(self._pull):
                    self._next_pull = self._now() + PULL_SECONDS
                    await self._guarded(self._push)
                await self._read_usage()
            self._changed()
            return self.view()

    async def _read_usage(self) -> None:
        """The room the copy takes, read once a sync has moved rows (and once when a session starts), on no timer of its own. It
        is read for the page and nothing else: a read that fails or that the project cannot answer, as one without 0005, leaves
        what was known, and says nothing of the server or the session, which the next real request finds out."""
        if not self._usage_due or not self._sync_ready() or self._sync is None:
            return
        self._usage_due = False
        try:
            self._usage = await self._sync.usage()
        except (CloudOffline, CloudRefused, SessionLost):
            log.info("The room the copy takes could not be read.")

    async def _clock_right(self) -> bool:
        """Whether this PC's clock is near enough the server's to sync. When it was not, the server is asked again first: the
        player may just have set the clock right, and pressed Sync now."""
        if self._clock_off():
            await self._guarded(self._read_profile)
        return not self._clock_off()

    async def _beat(self) -> None:
        own = self._own
        if own is None or "status" not in own["sharing"]:
            return
        state, since = self._my_status()
        await self._client.rpc("heartbeat", {"p_state": state, "p_since": iso(since)})

    async def _read_friends(self) -> None:
        self._stale = True  # until this read has answered
        overview = await self._client.rpc("friends_overview")
        if not isinstance(overview, Mapping):
            log.warning("The online server's list of friends could not be read.")
            raise CloudOffline
        self._overview, self._read_at, self._stale = overview, self._clock.now(), False

    def _signed_in(self) -> CloudSession:
        session = self._store.load()
        if session is None:
            raise SessionLost
        return session

    async def _read_profile(self) -> None:
        asking = self._signed_in()
        rows = await self._client.select("profiles", f"select={PROFILE_COLUMNS}&user_id=eq.{asking.user_id}")
        self._take_profile(rows, asking)

    def _take_profile(self, rows: list[Any], asking: CloudSession) -> None:
        """Keeps what another device gave the profile. No row is an account deleted on another device, whose session lives
        on for a while with nothing behind it: the session that asked is lost."""
        if not rows:
            raise SessionLost(asking.refresh_token)
        named, current = _name_and_tag(rows[0]), self._store.load()
        if named is None:
            return
        self._own = _own_from(rows[0])
        # A key turned off on another device lost its row, so what was sent says nothing of what is there.
        self._sent = {key: text for key, text in self._sent.items() if key in self._own["sharing"]}
        if current is not None and named != (current.name, current.tag):
            self._store.save(replace(current, name=named[0], tag=named[1]))

    def _facts_to_send(self) -> Mapping[str, Any] | None:
        """The game account's facts, when they may go up. Without a HoYoLAB login the profile and the shared rows keep their
        last values, and a profile that holds another game account's UID is left alone: two accounts never mix."""
        facts, own = self._local.profile(), self._own
        if facts is None or own is None or (own["uid"] is not None and own["uid"] != facts.get("uid")):
            return None
        return facts

    async def _send_profile(self) -> None:
        facts, own = self._facts_to_send(), self._own
        if facts is None or own is None:
            return
        wanted = dict(facts)
        if not _picture_fits(wanted.get("picture_url")):
            wanted.pop("picture_url", None)
        if not _ar_fits(wanted.get("ar")):
            wanted.pop("ar", None)
        if wanted.get("uid") == self._uid_refused:
            wanted.pop("uid", None)
        changes = {name: value for name, value in wanted.items() if value is not None and value != own.get(name)}
        uid = changes.pop("uid", None)
        if uid is not None and await self._send_uid(uid, own["find_by_uid"]):
            own = self._own = {**own, "uid": uid}
        if changes:
            await self._client.update("profiles", f"user_id=eq.{self._signed_in().user_id}", changes)
            self._own = {**own, **changes}

    async def _send_uid(self, uid: int, find: bool) -> bool:
        """The game account's UID goes up through set_uid, with the switch as the server holds it: the profile's columns take
        neither by a PATCH. Whether the server took it. A UID that another account that can be found by it holds is not asked
        for again, and Settings says so; one refused for now, as the lookups' second is, goes with the next pass."""
        try:
            await self._client.rpc("set_uid", {"p_uid": uid, "p_find": find})
        except CloudRefused as refused:
            if refused.code == UID_TAKEN_CODE or TAKEN_UID in refused.code:
                self._uid_refused, self._message = uid, UID_TAKEN
                return False
            if refused.code == "invalid_uid":  # no UID of 9 or 10 digits: the table never takes it
                log.warning("The online server refused this PC's UID as no UID.")
                self._uid_refused = uid
                return False
            if refused.code == "lookup_limit":
                return False
            raise
        if self._message == UID_TAKEN:
            self._message = None
        return True

    def _stats_wait(self, own: Mapping[str, Any]) -> bool:
        """Whether the stats that changed wait, on a pass of the turns. With Status shared, a friend sees when Guild Board is
        open anyway, and they go up with each pass. With it off, the moment a number changes would tell the same: they go up
        once a game day, on the first pass at or after a minute of it drawn at random (the player's decision of 2026-11-01)."""
        if "status" in own["sharing"]:
            return False
        today = self._local.today()
        if self._stats_day == today:
            return True
        if self._stats_minute is None or self._stats_minute[0] != today:
            try:
                start = game_day_start(today, self._local.server())
            except ValueError:  # a server no table here names: its day is taken to begin at midnight UTC
                start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
            # Drawn from what is left of the day: over the whole day, a PC that comes on in the evening would have passed its
            # minute already and send as it starts, which tells a friend the moment Guild Board was opened. A PC that closes
            # before its minute sends nothing that day.
            begin = max(start, self._clock.now())
            left = max(1, int((start + timedelta(minutes=GAME_DAY_MINUTES) - begin).total_seconds()))
            self._stats_minute = (today, begin + timedelta(seconds=random.randrange(left)))
        return self._clock.now() < self._stats_minute[1]

    async def _send_stats(self, only: Iterable[str] | None = None) -> None:
        """The stats that are switched on and changed since they last went up, each as the contract has it. `only` names the
        stats the player just switched on, which go up at once: the player is there, and chose to show them."""
        own = self._own
        if own is None or self._facts_to_send() is None:
            return
        keys = [key for key in STAT_KEYS if key in own["sharing"] and (only is None or key in only)]
        if not keys:
            return
        if only is None and self._stats_wait(own):
            return
        day = self._local.today()
        user_id = self._signed_in().user_id
        values = self._local.stats()
        rows, texts = [], {}
        for key in keys:
            if key in values:
                text = json.dumps(values[key], sort_keys=True)
                if self._sent.get(key) != text:
                    rows.append({"user_id": user_id, "key": key, "value": values[key]})
                    texts[key] = text
        if rows:
            await self._client.upsert("shared_stats", rows)
            self._sent.update(texts)
        if only is None:
            self._stats_day = day  # the day's pass is spent, also when nothing had changed: a later change waits for the next

    async def stop(self) -> None:
        self._store.flush()  # a refresh whose write failed has not reached the file: the next start would say Sign in again
        self._waiting.drop()
