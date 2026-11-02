"""Is the game running? Read from the Windows process list, which needs no handle to any process (H2)."""
from __future__ import annotations

import asyncio
import ctypes
import logging
from ctypes import wintypes
from datetime import datetime
from typing import Awaitable, Callable, Iterable

from guildboard.clock import Clock
from guildboard.events import EventBus
from guildboard.store import Store, iso

log = logging.getLogger(__name__)

GAME_PROCESS_NAMES = frozenset({"genshinimpact.exe", "yuanshen.exe"})
MIN_SESSION_SECONDS = 60
ABSENT_POLLS_TO_END = 2
TOUCH_EVERY_SECONDS = 60
MAX_SILENCE_SECONDS = 120  # a longer gap between two polls means nobody was watching (the PC slept)

_SNAPSHOT_PROCESSES = 0x00000002
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class _ProcessEntry(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


_kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
_kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
_kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry)]
_kernel32.Process32FirstW.restype = wintypes.BOOL
_kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry)]
_kernel32.Process32NextW.restype = wintypes.BOOL
_kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel32.CloseHandle.restype = wintypes.BOOL
_INVALID_HANDLE = wintypes.HANDLE(-1).value


def _process_entries() -> list[tuple[int, str]]:
    """(process id, executable name) of every running process, from one snapshot of the process list."""
    snapshot = _kernel32.CreateToolhelp32Snapshot(_SNAPSHOT_PROCESSES, 0)
    if snapshot is None or snapshot == _INVALID_HANDLE:
        raise OSError(ctypes.get_last_error(), "the process list could not be read")
    try:
        entry = _ProcessEntry()
        entry.dwSize = ctypes.sizeof(_ProcessEntry)
        entries: list[tuple[int, str]] = []
        more = _kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        if not more:
            # An empty list would read as "the game is not running" and end a session that is still going.
            raise OSError(ctypes.get_last_error(), "the process list could not be read")
        while more:
            entries.append((entry.th32ProcessID, entry.szExeFile))
            more = _kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        return entries
    finally:
        _kernel32.CloseHandle(snapshot)


def list_process_names() -> set[str]:
    """Lower-case executable names of every running process, from one snapshot of the process list."""
    return {name.lower() for _, name in _process_entries()}


def list_process_ids() -> set[int]:
    """The id of every running process, from one snapshot of the process list."""
    return {pid for pid, _ in _process_entries()}


def is_game_running(names: Iterable[str]) -> bool:
    return any(name.lower() in GAME_PROCESS_NAMES for name in names)


class SessionTracker:
    """Turns a stream of "running / not running" observations into play sessions."""

    def __init__(
        self,
        store: Store,
        clock: Clock,
        bus: EventBus,
        on_started: Callable[[], None] | None = None,
        on_stopped: Callable[[bool], None] | None = None,
    ) -> None:
        self._store = store
        self._clock = clock
        self._bus = bus
        self._on_started = on_started
        self._on_stopped = on_stopped
        self._session_id: int | None = None
        self._started_at: datetime | None = None
        self._last_seen: datetime | None = None
        self._last_saved: datetime | None = None
        self._absent = 0
        self._first_poll = True

    @property
    def running(self) -> bool:
        return self._session_id is not None

    @property
    def session_started_at(self) -> datetime | None:
        return self._started_at

    def observe(self, running: bool) -> None:
        now = self._clock.now()
        first_poll, self._first_poll = self._first_poll, False
        if running:
            self._absent = 0
            if self._session_id is None:
                self._session_id = self._store.open_session(now, started_before_tool=first_poll)
                self._started_at = self._last_saved = now
                self._bus.publish("game_started", at=iso(now))
                if self._on_started is not None:
                    self._on_started()
            elif abs((now - self._last_seen).total_seconds()) > MAX_SILENCE_SECONDS:
                # Nobody was watching in between: the PC slept, or the clock was changed. That time is
                # not playtime. The session ends where the game was last seen and a new one starts now.
                # The game itself never stopped, so no event is sent and no after-session sync is planned.
                self._close_session()
                self._session_id = self._store.open_session(now, started_before_tool=True)
                self._started_at = self._last_saved = now
            elif abs((now - self._last_saved).total_seconds()) >= TOUCH_EVERY_SECONDS:
                self._store.touch_session(self._session_id, now)
                self._last_saved = now
            self._last_seen = now
            return
        if self._session_id is None:
            return
        self._absent += 1
        if self._absent < ABSENT_POLLS_TO_END:
            return
        counted = self._close_session()
        self._session_id = self._started_at = self._last_seen = self._last_saved = None
        self._absent = 0
        self._bus.publish("game_stopped", at=iso(now), counted=counted)
        if self._on_stopped is not None:
            self._on_stopped(counted)

    def _close_session(self) -> bool:
        """End the open session at the moment the game was last seen. Sessions under a minute are dropped."""
        counted = (self._last_seen - self._started_at).total_seconds() >= MIN_SESSION_SECONDS
        if counted:
            self._store.touch_session(self._session_id, self._last_seen)
        else:
            self._store.delete_session(self._session_id)
        return counted


class GameWatch:
    def __init__(
        self,
        tracker: SessionTracker,
        lister: Callable[[], set[str]] = list_process_names,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        interval: float = 5.0,
    ) -> None:
        self._tracker = tracker
        self._lister = lister
        self._sleep = sleep
        self._interval = interval

    def poll_once(self) -> None:
        try:
            names = self._lister()
        except OSError:
            log.warning("the process list could not be read; keeping the previous state")
            return
        self._tracker.observe(is_game_running(names))

    async def run(self) -> None:
        while True:
            try:
                self.poll_once()
            except Exception:
                # One failed poll (a busy database, for example) must not end game detection for good.
                log.exception("a game-detection poll failed; trying again at the next one")
            await self._sleep(self._interval)
