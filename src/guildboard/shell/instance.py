"""One Guild Board per data folder. The start that runs holds a lock file in the folder open, and Windows lets go of
it when that process ends, however it ends; a later start reaches the first through a local socket, to bring it to
the front or to ask it to quit."""
from __future__ import annotations

import ctypes
import hashlib
import os
import time
from ctypes import wintypes
from pathlib import Path
from typing import Callable, Iterable

from PySide6.QtCore import QObject, QTimer, Signal
from PySide6.QtNetwork import QLocalServer, QLocalSocket

from guildboard.cloud import invite_code
from guildboard.gamewatch import GAME_PROCESS_NAMES, _process_entries

LOCK_NAME = "guildboard.lock"
SHOW = b"show\n"
QUIT = b"quit\n"
INVITE = b"invite "  # with an invite link's code and a line's end: a later start was opened by the link
QUIT_WAIT_MS = 30_000  # how long `--quit` waits for the Guild Board that is running to end
START_WAIT_MS = 10_000  # how long a start waits for a Guild Board that is quitting to let go of the folder
RETRY_SECONDS = 0.1  # how often a start that waits looks again
# What the Guild Board that runs keeps of the connections later starts make (L29): a later start writes its one line as
# soon as it is connected, so a connection that says nothing for a while, or more than any message without ending a
# line, is let go, and only a few are kept at once.
MESSAGE_BYTES = 256  # more than the longest message: "invite ", a link's code and the line's end
ANSWER_WAIT_MS = 2_000
MOST_CONNECTIONS = 8

_GENERIC_READ, _GENERIC_WRITE = 0x80000000, 0x40000000
_FILE_SHARE_READ, _FILE_SHARE_WRITE, _FILE_SHARE_DELETE = 0x1, 0x2, 0x4
_CREATE_ALWAYS, _OPEN_EXISTING = 2, 3
_FILE_ATTRIBUTE_NORMAL = 0x80

_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
_kernel32.CreateFileW.argtypes = [
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
]
_kernel32.CreateFileW.restype = wintypes.HANDLE
_kernel32.ReadFile.argtypes = [
    wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
]
_kernel32.ReadFile.restype = wintypes.BOOL
_kernel32.WriteFile.argtypes = [
    wintypes.HANDLE, wintypes.LPCVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID,
]
_kernel32.WriteFile.restype = wintypes.BOOL
_kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel32.CloseHandle.restype = wintypes.BOOL
# The process that serves a pipe a later start is connected to: the pipe's own server, and no other process.
_kernel32.GetNamedPipeServerProcessId.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.ULONG)]
_kernel32.GetNamedPipeServerProcessId.restype = wintypes.BOOL
_INVALID_HANDLE = wintypes.HANDLE(-1).value


def _open(path: str, access: int, share: int, disposition: int) -> int | None:
    handle = _kernel32.CreateFileW(path, access, share, None, disposition, _FILE_ATTRIBUTE_NORMAL, None)
    return None if handle is None or handle == _INVALID_HANDLE else handle


def _take(path: str) -> int | None:
    """The lock file, opened for this start alone, or None while another start holds it open: Windows refuses this
    open with a sharing violation then. Windows closes the handle when its process ends, so a lock file left behind
    never keeps a start out, and nothing ever asks which process wrote it."""
    return _open(path, _GENERIC_READ | _GENERIC_WRITE, _FILE_SHARE_READ, _CREATE_ALWAYS)


def _write_own_id(handle: int) -> None:
    data = str(os.getpid()).encode("ascii")
    written = wintypes.DWORD(0)
    _kernel32.WriteFile(handle, data, len(data), ctypes.byref(written), None)


def read_holder(path: str) -> int | None:
    """The process id that the start holding the folder wrote into the lock file, or None when there is none yet.
    The file is opened for reading only, and shared in every way, so the holder is not disturbed."""
    handle = _open(path, _GENERIC_READ, _FILE_SHARE_READ | _FILE_SHARE_WRITE | _FILE_SHARE_DELETE, _OPEN_EXISTING)
    if handle is None:
        return None
    try:
        buffer = ctypes.create_string_buffer(64)
        count = wintypes.DWORD(0)
        if not _kernel32.ReadFile(handle, buffer, len(buffer), ctypes.byref(count), None):
            return None
        data = buffer.raw[: count.value]
    finally:
        _kernel32.CloseHandle(handle)
    # Only the first line counts: an older Guild Board wrote more lines after the id.
    first = data.split(b"\n", 1)[0].strip()
    pid = int(first) if first.isdigit() else 0
    return pid if 0 < pid <= 0xFFFFFFFF else None


def _allow_foreground(pid: int) -> None:
    # Windows lets only the program in front bring a window forward. A later start is in front, because the
    # player just opened it, so it hands that right to the Guild Board that is running, and to no other process.
    ctypes.windll.user32.AllowSetForegroundWindow(pid)


def invite_message(code: str) -> bytes:
    """What a later start opened by an invite link tells the Guild Board that runs, in place of SHOW."""
    return INVITE + code.encode("ascii") + b"\n"


class InstanceGuard(QObject):
    activated = Signal()  # a later start asked this one to show itself
    quit_requested = Signal()  # `guildboard --quit` asked this one to quit
    invite_requested = Signal(str)  # a later start was opened by an invite link, whose code this is

    def __init__(
        self,
        data_dir: Path,
        *,
        allow_foreground: Callable[[int], object] = _allow_foreground,
        processes: Callable[[], Iterable[tuple[int, str]]] = _process_entries,
    ) -> None:
        super().__init__()
        self._allow_foreground = allow_foreground
        self._processes = processes  # (id, executable name) of every running process, from one snapshot of the list
        self._holder: int | None = None  # the id the lock file named, once acquire() was refused
        self._dir = data_dir
        self._lock_path = str(data_dir / LOCK_NAME)
        self._handle: int | None = None  # the open lock file, while this start holds the folder
        digest = hashlib.sha256(str(data_dir.resolve()).lower().encode("utf-8")).hexdigest()
        self._name = "GuildBoard-" + digest[:16]
        self._server: QLocalServer | None = None
        self._sockets: list[QLocalSocket] = []
        self.listen_error: str | None = None  # why later starts cannot reach this one, when it could not listen

    def acquire(self, *, listen: bool = True) -> bool:
        """True once this start holds the folder. A start that holds it only to find out that no Guild Board runs,
        as a --quit does, does not listen: a later start that met it would be answered, and no Guild Board would run."""
        self._dir.mkdir(parents=True, exist_ok=True)
        handle = _take(self._lock_path)
        if handle is None:
            self._holder = read_holder(self._lock_path)
            return False
        self._handle = handle
        # Opening the file emptied it, so a later start reads either nothing or the id of the start that runs.
        _write_own_id(handle)
        if not listen:
            return True
        QLocalServer.removeServer(self._name)
        self._server = QLocalServer(self)
        # The pipe lets in this Windows user alone. Windows' default would let every account, and anonymous logons,
        # open it, to hold connections open or to read from it.
        self._server.setSocketOptions(QLocalServer.SocketOption.UserAccessOption)
        if not self._server.listen(self._name):
            # Kept for the log, which opens only once this start knows that it is the one that runs.
            self.listen_error = self._server.errorString()
        self._server.newConnection.connect(self._on_connection)
        return True

    def notify_running(self, message: bytes = SHOW, *, tries: int = 6, pause: float = 0.25) -> bool:
        """True once the message has reached the Guild Board that holds the folder. A start that has only just
        taken the folder may not listen yet, so this tries again a few times."""
        if self._holder is not None and self._outside_the_game(self._holder):
            self._allow_foreground(self._holder)
        for attempt in range(tries):
            if attempt:
                time.sleep(pause)
            if self._send(message):
                return True
        return False

    def _outside_the_game(self, pid: int) -> bool:
        # The id comes from a file. The right to come to the front goes to it only when one snapshot of the process
        # list names it, and names it as something other than the game.
        try:
            return any(entry == pid and name.lower() not in GAME_PROCESS_NAMES for entry, name in self._processes())
        except OSError:
            return False

    def _send(self, message: bytes) -> bool:
        socket = QLocalSocket()
        socket.connectToServer(self._name)
        if not socket.waitForConnected(500):
            return False
        if not self._served_by_the_holder(socket):
            socket.abort()
            return False
        socket.write(message)
        # The message counts as written once that Guild Board has read it. One that hangs never reads, so each try
        # waits at most half a second: the six tries then take about four seconds.
        written = socket.waitForBytesWritten(500)
        socket.disconnectFromServer()
        return written

    def _served_by_the_holder(self, socket: QLocalSocket) -> bool:
        """Whether the pipe is served by the Guild Board whose id the lock file names. The pipe's name is open to any
        program that takes it first, of any account; the lock file is in this user's data folder, which no other account
        can write. It is read again at each try: the holder writes its id just after it takes the folder."""
        holder = read_holder(self._lock_path)
        server = wintypes.ULONG(0)
        if holder is None or not _kernel32.GetNamedPipeServerProcessId(socket.socketDescriptor(), ctypes.byref(server)):
            return False
        return server.value == holder

    def wait_until_free(self, timeout_ms: int) -> bool:
        """True once the folder is free and the process that held it has ended, so that its files can be replaced."""
        deadline = time.monotonic() + timeout_ms / 1000
        while (handle := _take(self._lock_path)) is None:
            if time.monotonic() >= deadline:
                return False
            time.sleep(RETRY_SECONDS)
        _kernel32.CloseHandle(handle)
        while self._holder is not None and self._holder in self._running_ids():
            if time.monotonic() >= deadline:
                return False
            time.sleep(RETRY_SECONDS)
        return True

    def _running_ids(self) -> set[int]:
        try:
            return {pid for pid, _ in self._processes()}
        except OSError:  # the list cannot be read: the folder is free already, which is what a wait is for
            return set()

    def stop_listening(self) -> None:
        """Later starts no longer reach this Guild Board, which holds the folder until release()."""
        for socket in list(self._sockets):
            self._drop(socket)
        if self._server is not None:
            self._server.close()
            self._server = None

    def release(self) -> None:
        self.stop_listening()
        if self._handle is not None:
            _kernel32.CloseHandle(self._handle)
            self._handle = None

    def _on_connection(self) -> None:
        while self._server is not None and self._server.hasPendingConnections():
            socket = self._server.nextPendingConnection()
            if len(self._sockets) >= MOST_CONNECTIONS:  # starts come one at a time: these are not starts
                socket.abort()
                socket.deleteLater()
                continue
            socket.setReadBufferSize(MESSAGE_BYTES)
            self._sockets.append(socket)
            socket.readyRead.connect(self._on_message)
            socket.disconnected.connect(self._on_disconnected)
            # The socket's own timer, which goes with it.
            silence = QTimer(socket)
            silence.setSingleShot(True)
            silence.timeout.connect(self._on_silence)
            silence.start(ANSWER_WAIT_MS)
            if socket.bytesAvailable():
                self._read(socket)

    def _on_message(self) -> None:
        socket = self.sender()
        if isinstance(socket, QLocalSocket):
            self._read(socket)

    def _on_disconnected(self) -> None:
        socket = self.sender()
        if isinstance(socket, QLocalSocket):
            self._drop(socket)

    def _on_silence(self) -> None:
        silence = self.sender()
        socket = silence.parent() if silence is not None else None
        if isinstance(socket, QLocalSocket):
            self._drop(socket)

    def _drop(self, socket: QLocalSocket) -> None:
        if socket in self._sockets:
            self._sockets.remove(socket)
            socket.abort()
            socket.deleteLater()

    def _read(self, socket: QLocalSocket) -> None:
        """Acts on the line a later start wrote, once it is whole. More than any message without a line's end is
        dropped unread."""
        if socket not in self._sockets:
            return
        if not socket.canReadLine():
            if socket.bytesAvailable() >= MESSAGE_BYTES:
                self._drop(socket)
            return
        message = bytes(socket.readLine().data())
        self._drop(socket)
        if message == QUIT:
            self.quit_requested.emit()
            return
        # Any program of this user can reach this socket, so the code is held to the link's pattern here as well.
        code = None
        if message.startswith(INVITE):
            text = message.removeprefix(INVITE).strip().decode("ascii", "replace")
            code = invite_code(f"guildboard://invite/{text}")
        if code is not None:
            self.invite_requested.emit(code)
        else:
            self.activated.emit()


def claim(
    guard: InstanceGuard, *, quit: bool, quit_wait_ms: int = QUIT_WAIT_MS, start_wait_ms: int = START_WAIT_MS,
    show: bytes = SHOW,
) -> str:
    """What this start does: "run", "shown", "quit", "not_running", "not_answering" or "still_running". `show` is what it
    tells a Guild Board that already runs."""
    if guard.acquire(listen=not quit):
        if quit:
            guard.release()
            return "not_running"
        return "run"
    if quit:
        if not guard.notify_running(QUIT):
            # That Guild Board may be ending already: it no longer listens, and lets go once its core has stopped.
            return "quit" if guard.wait_until_free(quit_wait_ms) else "not_answering"
        return "quit" if guard.wait_until_free(quit_wait_ms) else "still_running"
    if guard.notify_running(show):
        return "shown"
    # The Guild Board that holds the folder may be quitting; once it lets go, this start runs instead.
    if guard.wait_until_free(start_wait_ms) and guard.acquire():
        return "run"
    # Another start that was waiting too may have taken the folder first: then this one brings that one to the front.
    # Mostly this start's wait has run out by then: the other took the folder between two of its tries.
    if guard.notify_running(show):
        return "shown"
    return "not_answering"
