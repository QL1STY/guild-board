"""Helpers shared by the tests."""
from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta

# Python's own events for a name lookup or a connection, with where each one names the host. Only an address of the
# internet's kind, a (host, port, ...) tuple, reaches another computer.
SOCKET_HOSTS = {
    "socket.getaddrinfo": lambda args: args[0],
    "socket.gethostbyname": lambda args: args[0],
    "socket.gethostbyaddr": lambda args: args[0],
    "socket.connect": lambda args: args[1][0] if isinstance(args[1], tuple) else None,
    "socket.sendto": lambda args: args[1][0] if isinstance(args[1], tuple) else None,
}


def beyond_this_pc(host: object) -> bool:
    """Whether looking `host` up, or connecting to it, reaches beyond this PC. Only no host at all (a port of this PC's
    own, as a server asks for before it listens), localhost and a loopback address stay on it; a name is looked up
    beyond it."""
    if isinstance(host, bytes):
        host = host.decode("ascii", "replace")
    if host is None or host == "" or (isinstance(host, str) and host.lower() == "localhost"):
        return False
    try:
        return not ipaddress.ip_address(host).is_loopback
    except ValueError:
        return True


class FakeClock:
    """A clock the test moves by hand."""

    def __init__(self, start: datetime) -> None:
        if start.tzinfo is None:
            raise ValueError("start must be timezone-aware")
        self._now = start

    def now(self) -> datetime:
        return self._now

    def advance(self, **kwargs: float) -> None:
        self._now += timedelta(**kwargs)

    def set(self, when: datetime) -> None:
        self._now = when


import asyncio

from guildboard.records import FetchResult, GameAccount, RawResponse
from guildboard.sources.demo import build


def ok_result(group: str, now: datetime, first_time: bool = False) -> FetchResult:
    """A successful fetch result carrying demo data."""
    return FetchResult(group, now, (RawResponse(f"fake/{group}", {"group": group}),), build(group, now, first_time))


class FakeSleep:
    """Stands in for asyncio.sleep: returns at once, moves the fake clock, remembers what was asked."""

    def __init__(self, clock: FakeClock) -> None:
        self._clock = clock
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self._clock.advance(seconds=seconds)
        await asyncio.sleep(0)


class FakeSource:
    """A source whose answers the test scripts, group by group. Unscripted groups answer with demo data."""

    def __init__(self) -> None:
        self._script: dict[str, list[object]] = {}
        self.calls: list[tuple[str, bool]] = []

    def will(self, group: str, *outcomes: object) -> None:
        """Queue outcomes for a group. Exceptions are raised, FetchResults returned. The last one repeats."""
        self._script[group] = list(outcomes)

    async def fetch(self, group: str, *, now: datetime, first_time: bool = False) -> FetchResult:
        self.calls.append((group, first_time))
        queue = self._script.get(group)
        if not queue:
            return ok_result(group, now, first_time)
        outcome = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class AccountSource(FakeSource):
    """A FakeSource that can also list game accounts, as a live core needs."""

    async def list_accounts(self, cookies):
        return [GameAccount(700000001, "Traveler", "os_euro", 60)]


class FakeGuard:
    """Stands in for InstanceGuard: each answer is set by the test, and every call is remembered.
    `notify` is the answer to every notify_running call, or a sequence of answers, one for each call in turn."""

    def __init__(self, *, acquire=(False,), notify=False, free=False):
        self._acquire, self.notify, self.free, self.calls = list(acquire), notify, free, []
        self._notify = None if isinstance(notify, bool) else list(notify)
        self.listen_error = None

    def acquire(self, *, listen=True):
        self.calls.append("acquire" if listen else "acquire without listening")
        return self._acquire.pop(0) if self._acquire else False

    def notify_running(self, message=None):
        self.calls.append(("notify", message))
        if self._notify is None:
            return self.notify
        return self._notify.pop(0) if self._notify else False

    def wait_until_free(self, timeout_ms):
        self.calls.append(("wait", timeout_ms))
        return self.free

    def release(self):
        self.calls.append("release")


class FakeUser32:
    """Stands in for Windows' user32: it records each call, and refuses the keys another program holds. Nothing is
    registered with Windows, so no test takes the player's Ctrl+Alt+G."""

    def __init__(self, taken: frozenset[int] = frozenset()) -> None:
        self.taken = taken  # the virtual keys another program holds
        self.calls: list[tuple] = []

    def RegisterHotKey(self, window, ident, flags, key) -> bool:  # noqa: N802, ANN001
        self.calls.append(("RegisterHotKey", window, ident, flags, key))
        return key not in self.taken

    def UnregisterHotKey(self, window, ident) -> bool:  # noqa: N802, ANN001
        self.calls.append(("UnregisterHotKey", window, ident))
        return True
