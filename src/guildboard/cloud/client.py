"""The one module that talks to the online project: plain HTTPS through netpolicy.fetch_cloud, each request on a thread of
its own. It keeps the session fresh by itself, and tells the server being away from the server saying no."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from dataclasses import replace
from typing import Any, Callable, Mapping, Sequence

from guildboard import netpolicy
from guildboard.cloud import CLOUD_KEY
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.netpolicy import RedirectRefused, ResponseTooLarge, what_failed

log = logging.getLogger(__name__)

REFRESH_AHEAD = 10  # a session this many seconds or less from its end is refreshed first
LONGEST_NUMBER = 32  # characters: more than any number of ours has
WRITE = "return=minimal"
UPSERT = "resolution=merge-duplicates,return=minimal"
CLOCK_PRECISION = 2.0  # seconds: a Date header gives whole seconds, so a smaller difference cannot be told from none
MEASURE_WITHIN_SECONDS = 10.0  # a request that took longer (a sleep in the middle of it) says nothing of the clocks


class CloudOffline(Exception):
    """No answer, a timeout, a 5xx, the 540 of a paused project among them, or an answer that makes no sense."""


class CloudTooLarge(CloudOffline):
    """An answer larger than a request may take. It is no answer, but a smaller request may fit."""


class SessionLost(Exception):
    """There is no session, or the server refused it for good: the player has to sign in again. `refresh_token` names the
    session it is about, where there was one: a request of an old session can be refused after the player signed in again,
    and that says nothing of the new one (the audit's CLD-8). It is no part of the exception's text."""

    def __init__(self, refresh_token: str | None = None) -> None:
        super().__init__()
        self.refresh_token = refresh_token


class CloudRefused(Exception):
    """A 4xx. Its code is PostgREST's or Auth's message, such as "request_limit"; its state is the kind of refusal, PostgREST's
    own code for it or the database's SQLSTATE, where the answer gave one; its detail is PostgREST's `details`, which tells
    two causes of one code apart (sync_full's project_full)."""

    def __init__(self, code: str, state: str = "", detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.state = state
        self.detail = detail


def _whole(text: str) -> int | None:
    return int(text) if len(text) <= LONGEST_NUMBER else None


def _fraction(text: str) -> float | None:
    value = float(text)
    return value if len(text) <= LONGEST_NUMBER and math.isfinite(value) else None


def _parsed(answer: bytes) -> Any:
    """An answer's JSON; None when it is empty, as a function that returns nothing answers. A stat is another player's to fill
    and the table takes any number, so a number nothing of ours could be reads as None: Python refuses an integer of more than
    4,300 digits, which would cost the whole answer, and one too large for a float is infinity, which no page can be sent. So
    do NaN and the infinities written as such. An answer nested deeper than Python reads is no answer."""
    if not answer:
        return None
    try:
        return json.loads(answer, parse_int=_whole, parse_float=_fraction, parse_constant=_nothing)
    except (ValueError, RecursionError):
        log.warning("The online server's answer could not be read.")
        raise CloudOffline from None


def _nothing(constant: str) -> None:
    return None


def _refusal(answer: bytes) -> str:
    """What a 4xx says: PostgREST's `message`, which carries a database function's refusal, or Auth's code or sentence."""
    try:
        data = json.loads(answer)
    except (ValueError, RecursionError):
        return "refused"
    for name in ("message", "error_code", "msg", "error"):
        said = data.get(name) if isinstance(data, dict) else None
        if isinstance(said, str) and said:
            return said
    return "refused"


def _state(answer: bytes, name: str = "code") -> str:
    """The kind of a 4xx, from PostgREST's `code`, or its `details`; nothing where the answer has none."""
    try:
        data = json.loads(answer)
    except (ValueError, RecursionError):
        return ""
    state = data.get(name) if isinstance(data, dict) else None
    return state if isinstance(state, str) else ""


def tokens_from(answer: Any, now: float) -> dict[str, Any]:
    """The tokens in an answer of Auth's, with when they end by this PC's clock, so that a PC whose clock is wrong still
    refreshes in time. An answer without them is no real answer."""
    try:
        access, refresh, lasts = answer["access_token"], answer["refresh_token"], float(answer["expires_in"])
    except (KeyError, TypeError, ValueError):
        access, refresh, lasts = None, None, 0.0
    if not (isinstance(access, str) and isinstance(refresh, str) and access and refresh):
        log.warning("The online server's answer held no session.")
        raise CloudOffline
    return {"access_token": access, "refresh_token": refresh, "expires_at": now + lasts}


def _headers(session: CloudSession | None, body: bytes | None, prefer: str | None) -> dict[str, str]:
    headers = {"apikey": CLOUD_KEY, "Accept": "application/json"}
    if session is not None:
        headers["Authorization"] = f"Bearer {session.access_token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    if prefer is not None:
        headers["Prefer"] = prefer
    return headers


def _encoded(values: Any) -> bytes:
    return json.dumps(values).encode("utf-8")


class CloudClient:
    def __init__(
        self,
        store: CloudStore,
        *,
        fetch: Callable[..., tuple[int, bytes]] = netpolicy.fetch_cloud,
        now: Callable[[], float] = time.time,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._fetch = fetch
        self._now = now
        # This PC's own clock, which SQLite stamps the outbox's lines by: the server's clock is measured against it.
        self._wall = wall
        self._ahead: float | None = None  # how far the server's clock is ahead of this PC's, as the last dated answer said
        self._refreshing = asyncio.Lock()  # a refresh token works once, so one refresh runs at a time

    def server_ahead(self) -> float:
        """How many seconds the server's clock is ahead of this PC's (behind, when it is less than nothing), from the Date of
        the last answer that gave one: what sync sets this PC's stamps by. Nothing before any answer did, and nothing for a
        difference within what whole seconds can tell."""
        ahead = self._ahead
        return ahead if ahead is not None and abs(ahead) >= CLOCK_PRECISION else 0.0

    # ------------------------------------------------------------------ the session's requests
    async def rpc(self, name: str, args: Mapping[str, Any] | None = None) -> Any:
        return _parsed(await self._send(f"/rest/v1/rpc/{name}", "POST", _encoded(dict(args or {}))))

    async def select(self, table: str, query: str) -> list[dict[str, Any]]:
        rows = _parsed(await self._send(f"/rest/v1/{table}?{query}", "GET"))
        if not isinstance(rows, list):
            log.warning("The online server's answer held no rows.")
            raise CloudOffline
        return rows

    async def upsert(self, table: str, rows: Sequence[Mapping[str, Any]]) -> None:
        await self._send(f"/rest/v1/{table}", "POST", _encoded([dict(row) for row in rows]), UPSERT)

    async def update(self, table: str, query: str, values: Mapping[str, Any]) -> None:
        await self._send(f"/rest/v1/{table}?{query}", "PATCH", _encoded(dict(values)), WRITE)

    async def delete(self, table: str, query: str) -> None:
        await self._send(f"/rest/v1/{table}?{query}", "DELETE", None, WRITE)

    async def sign_out(self) -> None:
        """Ends this device's session on the server. Another device of the player's stays signed in."""
        await self._send("/auth/v1/logout?scope=local", "POST")

    async def _send(self, path: str, method: str, body: bytes | None = None, prefer: str | None = None) -> bytes:
        """One request with the session, refreshed first when it is about to end, and once more when the server says it
        has. A 401 means the token was refused before anything ran, so the second try cannot do anything twice."""
        session = await self._fresh()
        status, answer = await self._ask(path, method, _headers(session, body, prefer), body)
        if status == 401:
            session = await self._renewed(session)
            status, answer = await self._ask(path, method, _headers(session, body, prefer), body)
            if status == 401:
                log.warning("The online server refused a session it had just given.")
                raise SessionLost(session.refresh_token)
        if status >= 400:
            raise CloudRefused(_refusal(answer), _state(answer), _state(answer, "details"))
        return answer

    # ------------------------------------------------------------------ signing in
    async def exchange(self, code: str, verifier: str) -> dict[str, Any]:
        """Trades a sign-in's code for a session, which the caller keeps."""
        body = _encoded({"auth_code": code, "code_verifier": verifier})
        status, answer = await self._ask("/auth/v1/token?grant_type=pkce", "POST", _headers(None, body, None), body)
        if status >= 400:
            raise CloudRefused(_refusal(answer))
        data = _parsed(answer)
        if not isinstance(data, dict):
            log.warning("The online server's answer held no session.")
            raise CloudOffline
        return data

    # ------------------------------------------------------------------ the refresh
    def _current(self) -> CloudSession:
        session = self._store.load()
        if session is None:
            raise SessionLost
        return session

    async def _fresh(self) -> CloudSession:
        session = self._current()
        if session.expires_at - self._now() > REFRESH_AHEAD:
            return session
        return await self._renewed(session)

    async def _renewed(self, stale: CloudSession) -> CloudSession:
        """A session newer than `stale`: another call's, when one refreshed while this one waited its turn."""
        async with self._refreshing:
            current = self._current()
            if current.access_token != stale.access_token:
                return current
            return await self._refresh(current)

    async def _refresh(self, session: CloudSession) -> CloudSession:
        body = _encoded({"refresh_token": session.refresh_token})
        status, answer = await self._ask("/auth/v1/token?grant_type=refresh_token", "POST", _headers(None, body, None), body)
        if status == 429:  # the server is busy; it says nothing about the session
            log.warning("The online server asked to wait before the next refresh.")
            raise CloudOffline
        if status >= 400:
            log.warning("The online server refused the session: HTTP %d", status)
            raise SessionLost(session.refresh_token)
        tokens = tokens_from(_parsed(answer), self._now())
        current = self._store.load()
        if current is None or current.refresh_token != session.refresh_token:
            raise SessionLost(session.refresh_token)  # the player signed out meanwhile: the new tokens go nowhere
        fresh = replace(current, **tokens)  # from what is kept now: a new name may have come while this waited
        try:
            self._store.save(fresh)
        except OSError:  # the store keeps it in memory, and its next save writes it to the file
            log.warning("The online session's file could not be written; the new session is kept until the next save.")
        return fresh

    # ------------------------------------------------------------------ the wire
    async def _ask(self, path: str, method: str, headers: Mapping[str, str], body: bytes | None) -> tuple[int, bytes]:
        """One request on a thread of its own. What goes in the log is what failed, never what was said. An answer that says
        the server's time measures how far its clock is from this PC's."""
        sent = self._wall()
        try:
            answered = await asyncio.to_thread(self._fetch, path, method=method, headers=headers, body=body)
        except ResponseTooLarge:
            log.warning("The online server's answer was larger than a request may take.")
            raise CloudTooLarge from None
        except (OSError, RedirectRefused) as error:
            log.warning("The online server could not be reached: %s", what_failed(error))
            raise CloudOffline from None
        status, answer = answered
        date = getattr(answered, "date", None)
        received = self._wall()
        if isinstance(date, float) and math.isfinite(date) and received - sent <= MEASURE_WITHIN_SECONDS:
            # The server wrote its Date, to the second, at some moment between the request and its answer here.
            self._ahead = date + 0.5 - (sent + received) / 2
        if status >= 500:
            log.warning("The online server could not answer: HTTP %d", status)
            raise CloudOffline
        return status, answer
