"""The core on a thread of its own, beside Qt. Qt calls in through `CoreThread.call`; the core speaks
back through Qt signals, which Qt delivers on its own thread."""
from __future__ import annotations

import asyncio
import inspect
import logging
import threading
from concurrent.futures import Future
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QObject, Signal

from guildboard.__main__ import serve
from guildboard.config import Settings
from guildboard.core import Core
from guildboard.store import StoreError

log = logging.getLogger(__name__)

COULD_NOT_START = "Guild Board could not start. The log file says why."


class CoreSignals(QObject):
    ready = Signal(str)  # the launch link: the API accepts connections
    failed = Signal(str)  # the core could not start; a sentence for the player
    window = Signal(str)  # the interface asks for a window: "login", "verify", "data_folder" or "demo"
    settings = Signal(object)  # a copy of the settings, at the start and after every change
    notify = Signal(str, str)  # a notification for the tray icon to show: its kind ("reminder", "test") and text
    game = Signal(bool)  # the game started (True) or stopped (False)
    map = Signal(object)  # the Map page's tabs and the area for the map (maptabs.snapshot), after every change
    finished = Signal()  # the core has stopped


class CoreThread(threading.Thread):
    def __init__(
        self, make_core: Callable[[], Core], signals: CoreSignals, *, port: int = 0, web_dir: Path | None = None
    ) -> None:
        super().__init__(name="guildboard-core", daemon=True)
        self._make_core = make_core
        self._signals = signals
        self._port = port
        self._web_dir = web_dir
        self._loop: asyncio.AbstractEventLoop | None = None
        # Not `_stop`: threading.Thread has an internal method of that name, which join() relies on.
        self._stop_event: asyncio.Event | None = None
        # Set by stop() at once, so that a stop that comes before the event exists is not lost.
        self._stop_requested = threading.Event()
        self.core: Core | None = None

    def run(self) -> None:
        try:
            asyncio.run(self._main())
        except StoreError as error:
            self._signals.failed.emit(str(error))
        except Exception:
            log.exception("the core stopped with an error")
            self._signals.failed.emit(COULD_NOT_START)
        finally:
            self._signals.finished.emit()

    async def _main(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop_event = asyncio.Event()
        if self._stop_requested.is_set():
            self._stop_event.set()
        core = self.core = self._make_core()
        core.window_requests = self._ask_window
        core.notifier = self._notify
        core.settings_listeners.append(self._send_settings)
        core.game_listeners.append(self._send_game)  # before the start: the first look at the process list counts too
        core.map_listeners.append(self._send_map)
        await serve(
            core, port=self._port, web_dir=self._web_dir, ready=lambda link: self._ready(core, link),
            stop=self._stop_event,
        )

    def _ready(self, core: Core, link: str) -> None:
        # The settings as they are now, sent from this thread like every later change, so that Qt receives
        # them in order. Settings fetched by a call could arrive after a newer change, and undo it.
        self._send_settings(core.settings)
        self._signals.ready.emit(link)

    def _send_settings(self, settings: Settings) -> None:
        # A copy: the core changes its own object in place, on its own thread, while Qt reads it on Qt's.
        self._signals.settings.emit(replace(settings))

    def _send_game(self, running: bool) -> None:
        self._signals.game.emit(running)

    def _send_map(self, snapshot: dict[str, Any]) -> None:
        self._signals.map.emit(snapshot)  # a snapshot is built new for each change, so Qt may keep it

    def _ask_window(self, kind: str) -> bool:
        self._signals.window.emit(kind)
        return True

    def _notify(self, kind: str, text: str) -> bool:
        self._signals.notify.emit(kind, text)
        return True

    def call(self, fn: Callable[[Core], Any]) -> Future:
        """Run `fn(core)` on the core's thread; when it returns an awaitable, that is awaited there."""
        if self._loop is None or self.core is None:
            raise RuntimeError("the core is not running")

        async def invoke() -> Any:
            result = fn(self.core)
            return await result if inspect.isawaitable(result) else result

        return asyncio.run_coroutine_threadsafe(invoke(), self._loop)

    def stop(self, timeout: float = 20.0) -> None:
        """Ask the core to stop, and wait for the thread to end."""
        self._stop_requested.set()
        if self._loop is not None and self._stop_event is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._stop_event.set)
        self.join(timeout)


class Deliver(QObject):
    """Hands the result of a call into the core to Qt, on Qt's own thread."""

    _done = Signal(object, object)

    def __init__(self) -> None:
        super().__init__()
        self._done.connect(self._run)

    def then(self, future: Future, callback: Callable[[Future], None]) -> None:
        future.add_done_callback(lambda done: self._done.emit(callback, done))

    def _run(self, callback: Callable[[Future], None], future: Future) -> None:
        if future.cancelled():  # reading it would raise CancelledError, inside a Qt slot
            log.info("a call into the core was cancelled because the core stopped")
            return
        callback(future)
