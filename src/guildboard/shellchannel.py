"""The core's channel to a shell: JSON Lines on the core's standard input and output, in place of the Qt signals.

Core to shell, each line is an event: `{"event": <name>, ...}`. Shell to core, each line is a call,
`{"id": <int>, "call": <name>, "args": {...}}`, answered by `{"id": <same>, "result": ...}` or `{"id": <same>, "error": <text>}`.
The login's cookies travel on this channel and nowhere else. The channel never logs the content of a line."""
from __future__ import annotations

import asyncio
import dataclasses
import inspect
import io
import json
import logging
import sys
import threading
from datetime import datetime
from pathlib import Path, PurePath
from typing import Any, BinaryIO, Callable, TextIO

from guildboard import auth
from guildboard.__main__ import default_web_dir, serve
from guildboard.backups import BackupRefused
from guildboard.config import AppPaths, Settings
from guildboard.core import Core
from guildboard.logging_setup import redact
from guildboard.places import place_of
from guildboard.records import Offline
from guildboard.store import StoreError
from guildboard.tokenstore import OLDER_SESSION_COOKIES, SESSION_COOKIES

log = logging.getLogger(__name__)
shell_log = logging.getLogger("guildboard.shell")  # what the shell reports with the `log` call

COULD_NOT_START = "Guild Board could not start. The log file says why."  # the text of the `failed` event when no store error explains it
LOGIN_NAMES = SESSION_COOKIES + OLDER_SESSION_COOKIES
NO_LOGIN_IN_THE_DEMO = "The demo has no HoYoLAB login."
LOG_LEVELS = {"info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}

_write_lock = threading.Lock()  # one line at a time, whatever thread writes it


def _plain(value: Any) -> Any:
    """What json.dumps cannot write by itself: a dataclass becomes its fields, a path its text."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return dataclasses.asdict(value)
    if isinstance(value, PurePath):
        return str(value)
    raise TypeError(f"{type(value).__name__} cannot be sent to the shell")


def _send(write: Callable[[str], None], message: dict[str, Any]) -> None:
    line = json.dumps(message, default=_plain)  # ASCII, with every newline escaped: one line
    with _write_lock:
        write(line)


def report_failure(write: Callable[[str], None], text: str) -> None:
    _send(write, {"event": "failed", "text": text})


def report_finished(write: Callable[[str], None]) -> None:
    _send(write, {"event": "finished"})


# ---- the calls: each takes the core and the call's arguments, and returns the result (or an awaitable of it)


def _argument(args: dict[str, Any], name: str, *kinds: type, nullable: bool = False) -> Any:
    value = args.get(name)
    if value is None and nullable:
        return None
    if isinstance(value, bool) and bool not in kinds:  # a bool is an int to Python, and no number to the shell
        value = None
    if not isinstance(value, kinds):
        raise ValueError(f"The call needs {name}.")
    return value


def _cookies(args: dict[str, Any]) -> dict[str, str]:
    cookies = _argument(args, "cookies", dict)
    if not all(isinstance(name, str) and isinstance(value, str) for name, value in cookies.items()):
        raise ValueError("The call needs cookies.")
    return cookies


async def _login(core: Core, cookies: dict[str, str], uid: int | None) -> Any:
    if core.auth is None:
        raise ValueError(NO_LOGIN_IN_THE_DEMO)
    # Only the cookies a login is made of, as the Qt shell's session_cookies kept: a pasted text holds every cookie of
    # the page, and the paste steps tell the player that Guild Board keeps the login cookies alone.
    kept = {name: value for name, value in cookies.items() if name in LOGIN_NAMES and value}
    try:
        return await core.auth.login(kept, uid)
    except Offline:
        # HoYoLAB could not be reached: an outcome like the others, so that the shell says so and offers Try again.
        return auth.LoginOutcome("offline")


async def _saved(make: Callable[[], Any]) -> dict[str, Any]:
    """A save the player asked for: {"written": <the file's name>}, or {"refused": <the sentence>} when the core refuses
    it (BackupRefused, whose text the player reads). Any other failure stays an error answer: its text is not for the
    player."""
    try:
        result = make()
        if inspect.isawaitable(result):
            result = await result
    except BackupRefused as refusal:
        sentence = redact(str(refusal))
        log.info("A save was refused: %s", sentence)
        return {"refused": sentence}
    return {"written": result}


def _stored_cookies(core: Core) -> dict[str, str] | None:
    token = core.auth.current() if core.auth is not None else None
    return dict(token.cookies) if token is not None else None


def _hello(core: Core, args: dict[str, Any]) -> None:
    core.has_tray = _argument(args, "has_tray", bool)


def _picture_offer(core: Core, args: dict[str, Any]) -> dict[str, Any] | None:
    offer = core.picture_offer()
    return None if offer is None else {"number": offer[0], "name": offer[1]}


def _log(core: Core, args: dict[str, Any]) -> None:
    level = LOG_LEVELS.get(args.get("level"))
    if level is None:
        raise ValueError("The log level is info, warning or error.")
    shell_log.log(level, "%s", _argument(args, "text", str))  # the log's own masking hides a secret in it


def _shutdown(core: Core, args: dict[str, Any]) -> None:
    """Nothing to do here: the channel stops the core once this is answered (ShellChannel.answer)."""


CALLS: dict[str, Callable[[Core, dict[str, Any]], Any]] = {
    "hello": _hello,
    "login": lambda core, args: _login(core, _cookies(args), _argument(args, "uid", int, nullable=True)),
    "login_text": lambda core, args: _login(
        core, auth.parse_cookie_text(_argument(args, "text", str)), _argument(args, "uid", int, nullable=True)
    ),
    "sync_now": lambda core, args: core.scheduler.request("manual").reason,
    "set_paused": lambda core, args: core.set_paused(_argument(args, "paused", bool)),
    "update_settings": lambda core, args: core.update_settings(_argument(args, "changes", dict)),
    "backup_file_name": lambda core, args: core.backup_file_name(),
    "export_backup": lambda core, args: _saved(lambda: core.export_backup(Path(_argument(args, "path", str)))),
    "picture_offer": _picture_offer,
    "save_picture": lambda core, args: _saved(
        lambda: core.save_picture(Path(_argument(args, "path", str)), _argument(args, "number", int))
    ),
    "drop_picture": lambda core, args: core.drop_picture(_argument(args, "number", int, nullable=True)),
    "verify_cookies": lambda core, args: _stored_cookies(core),
    "verification_done": lambda core, args: core.verification_done(),
    "map_snapshot": lambda core, args: core.map_snapshot(),
    "map_session": lambda core, args: core.map_session(),
    "map_role": lambda core, args: core.map_role(),
    "map_seen": lambda core, args: core.map_seen(
        _argument(args, "tab_id", int), _argument(args, "url", str), _argument(args, "title", str)
    ),
    "map_failed": lambda core, args: core.map_failed(_argument(args, "tab_id", int), _argument(args, "failed", bool)),
    "game_running": lambda core, args: core.tracker.running,
    "overlay_shell": lambda core, args: core.overlay_shell(
        _argument(args, "displays", list), _argument(args, "hotkey_state", str)
    ),
    "offer_invite": lambda core, args: core.online.offer_invite(_argument(args, "code", str)),
    "log": _log,
    "shutdown": _shutdown,
}


class ShellChannel:
    """One core's side of the channel. `write` receives each line, without its newline; it may be called from any
    thread, and the channel lets one line at a time through."""

    def __init__(self, core: Core, write: Callable[[str], None]) -> None:
        self._core = core
        self._write = write
        self.stop: asyncio.Event | None = None  # set by `shutdown`, once it is answered

    def attach(self) -> None:
        """Plug the core's hooks into the channel. Before the start: the first look at the process list counts too."""
        core = self._core
        core.window_requests = self._ask_window
        core.notifier = self._notify
        core.settings_listeners.append(self._send_settings)
        core.game_listeners.append(self._send_game)
        core.map_listeners.append(self._send_map)

    def ready(self, link: str) -> None:
        """The API accepts connections. The settings go first, as they are now, so that the shell hears them in order."""
        self._send_settings(self._core.settings)
        self._event("ready", link=link)

    def failed(self, text: str) -> None:
        report_failure(self._write, text)

    def finished(self) -> None:
        report_finished(self._write)

    def _event(self, name: str, **fields: Any) -> None:
        _send(self._write, {"event": name, **fields})

    def _send_settings(self, settings: Settings) -> None:
        self._event("settings", settings=dataclasses.asdict(settings))

    def _send_game(self, running: bool) -> None:
        self._event("game", running=running)

    def _send_map(self, snapshot: dict[str, Any]) -> None:
        self._event("map", snapshot=snapshot)

    def _ask_window(self, kind: str) -> bool:
        self._event("window", kind=kind)
        return True

    def _notify(self, kind: str, text: str) -> bool:
        self._event("notify", kind=kind, text=text, place=place_of(kind))
        return True

    async def answer(self, line: str) -> None:
        """Run the call a line holds and write its answer. A line that is no call is ignored, with a warning that names
        nothing of it."""
        try:
            message = json.loads(line)
        except (ValueError, RecursionError):
            message = None
        ident = message.get("id") if isinstance(message, dict) else None
        if not isinstance(ident, int) or isinstance(ident, bool):
            log.warning("A line from the shell was ignored: it is no call with an id.")
            return
        name, args = message.get("call"), message.get("args", {})
        call = CALLS.get(name) if isinstance(name, str) else None
        if call is None:
            _send(self._write, {"id": ident, "error": f"unknown call {name}"})
            return
        try:
            if not isinstance(args, dict):
                raise ValueError("The call's arguments are not an object.")
            result = call(self._core, args)
            if inspect.isawaitable(result):
                result = await result
            _send(self._write, {"id": ident, "result": result})
        except Exception as error:
            log.warning("The shell's call %s failed.", name, exc_info=True)
            # Masked, so that a cookie cannot come back in a refusal's text.
            _send(self._write, {"id": ident, "error": redact(str(error)) or type(error).__name__})
        else:
            if name == "shutdown" and self.stop is not None:
                self.stop.set()


def _read_lines(stdin: BinaryIO, loop: asyncio.AbstractEventLoop, take: Callable[[str], None], stop: asyncio.Event) -> None:
    """The reading thread: each line goes to the loop. The end of the input means the shell is gone, and stops the core."""
    # Read from the raw stream and cut the lines here: a thread still blocked in a buffered reader when Python finishes
    # holds its lock, and Python then dies with a fatal error instead of exiting.
    source = getattr(stdin, "raw", stdin)
    pending = b""
    try:
        while chunk := source.read(65536):
            *whole, pending = (pending + chunk).split(b"\n")
            for raw in whole:
                loop.call_soon_threadsafe(take, raw.decode("utf-8", "replace"))
        if pending:
            loop.call_soon_threadsafe(take, pending.decode("utf-8", "replace"))
    except (OSError, ValueError, RuntimeError):  # the input closed under the reader, or the loop is gone
        pass
    try:
        loop.call_soon_threadsafe(stop.set)
    except RuntimeError:
        pass


async def run_core_for_shell(
    paths: AppPaths, *, demo: bool, demo_now: datetime | None = None, stdin: BinaryIO, stdout: TextIO
) -> int:
    """Run the core for a shell until the shell shuts it down or its input ends. Standard output carries the channel
    alone, so `sys.stdout` is a sink meanwhile. 0 when the core ran and stopped, 1 when it could not start."""
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    calls: set[asyncio.Task[None]] = set()
    channel: ShellChannel | None = None
    outcome = 0
    gone = False  # the shell stopped reading: nothing more is written

    def write(line: str) -> None:
        nonlocal gone
        if gone:
            return
        try:
            stdout.write(line + "\n")
            stdout.flush()
        except (OSError, ValueError):  # the pipe is broken or closed: the shell is gone, and the core stops
            gone = True
            stop.set()

    def take(line: str) -> None:
        if channel is None:
            return
        task = loop.create_task(channel.answer(line))  # each call on its own, so a slow one holds nothing up
        calls.add(task)
        task.add_done_callback(calls.discard)

    real_stdout, sys.stdout = sys.stdout, io.StringIO()
    try:
        core = Core(paths, demo=demo, demo_now=demo_now)
        # The shell makes its tray before it starts the core, and `hello` says so only after the start. The first look at
        # the timers is made by then, and without a tray it would mark a due reminder as sent with nothing shown. `hello`
        # still sets it False when no tray could be made. A demo has no tray (a demo window ends with its window).
        core.has_tray = not demo
        channel = ShellChannel(core, write)
        channel.stop = stop
        channel.attach()
        threading.Thread(
            target=_read_lines, args=(stdin, loop, take, stop), name="guildboard-shell-input", daemon=True
        ).start()
        await serve(core, web_dir=default_web_dir(), ready=channel.ready, stop=stop)
    except StoreError as error:
        outcome = 1
        report_failure(write, str(error))
    except Exception:
        outcome = 1
        log.exception("the core stopped with an error")
        report_failure(write, COULD_NOT_START)
    finally:
        channel = None  # a call that arrives from now on gets no answer, and nothing is written after `finished`
        try:
            for task in list(calls):
                task.cancel()
            await asyncio.gather(*calls, return_exceptions=True)
            report_finished(write)
        finally:
            sys.stdout = real_stdout
    return outcome
