import ctypes
import os
import re
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path

from PySide6.QtNetwork import QLocalSocket

from guildboard.gamewatch import list_process_ids
from guildboard.shell import instance as instance_module
from guildboard.shell.instance import LOCK_NAME, QUIT, SHOW, InstanceGuard, claim, invite_message
from support import FakeGuard

# Holds the folder as Guild Board does, and says which process holds it.
HOLDER = """
import os, sys, time
from pathlib import Path
from PySide6.QtCore import QCoreApplication
from guildboard.shell.instance import InstanceGuard
app = QCoreApplication(sys.argv)
guard = InstanceGuard(Path(sys.argv[1]))
print("locked" if guard.acquire() else "busy", os.getpid(), flush=True)
time.sleep(60)
"""

# A second start is a process of its own, as when the player opens Guild Board twice. With "once" it tries only once.
SECOND_START = """
import sys
from pathlib import Path
from PySide6.QtCore import QCoreApplication
from guildboard.shell.instance import QUIT, SHOW, InstanceGuard
app = QCoreApplication(sys.argv)
guard = InstanceGuard(Path(sys.argv[1]))
message = QUIT if "quit" in sys.argv[2:] else SHOW
tries = {"tries": 1} if "once" in sys.argv[2:] else {}
print("acquired" if guard.acquire() else "refused", guard.notify_running(message, **tries), flush=True)
"""

# A start opened by an invite link, and what it says to the Guild Board that runs: argv[2], as bytes.
LINK_START = """
import sys
from pathlib import Path
from PySide6.QtCore import QCoreApplication
from guildboard.shell.instance import InstanceGuard
app = QCoreApplication(sys.argv)
guard = InstanceGuard(Path(sys.argv[1]))
print("acquired" if guard.acquire() else "refused", guard.notify_running(sys.argv[2].encode("ascii")), flush=True)
"""
CODE = "abcDEF0123456789_-abcdef"


def test_a_second_start_on_the_same_folder_brings_the_first_to_the_front(qtbot, tmp_path):
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    script = tmp_path / "second.py"
    script.write_text(SECOND_START, encoding="utf-8")
    with qtbot.waitSignal(first.activated, timeout=15_000):
        second = subprocess.Popen([sys.executable, str(script), str(tmp_path / "data")], stdout=subprocess.PIPE, text=True)
    assert second.communicate(timeout=15)[0].split() == ["refused", "True"]
    first.release()
    third = InstanceGuard(tmp_path / "data")
    assert third.acquire()  # once the first has closed, the folder is free again
    third.release()


def test_a_later_start_can_ask_the_first_to_quit(qtbot, tmp_path):
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    script = tmp_path / "second.py"
    script.write_text(SECOND_START, encoding="utf-8")
    with qtbot.assertNotEmitted(first.activated), qtbot.waitSignal(first.quit_requested, timeout=15_000):
        second = subprocess.Popen(
            [sys.executable, str(script), str(tmp_path / "data"), "quit"], stdout=subprocess.PIPE, text=True
        )
    assert second.communicate(timeout=15)[0].split() == ["refused", "True"]
    first.release()


def test_a_second_start_hands_the_link_to_the_first(qtbot, tmp_path):
    assert invite_message(CODE) == b"invite " + CODE.encode("ascii") + b"\n"
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    script = tmp_path / "second.py"
    script.write_text(LINK_START, encoding="utf-8")
    with qtbot.waitSignal(first.invite_requested, timeout=15_000) as heard, qtbot.assertNotEmitted(first.quit_requested):
        second = subprocess.Popen(
            [sys.executable, str(script), str(tmp_path / "data"), invite_message(CODE).decode("ascii")],
            stdout=subprocess.PIPE, text=True,
        )
    assert heard.args == [CODE]
    assert second.communicate(timeout=15)[0].split() == ["refused", "True"]
    first.release()


def test_a_message_that_holds_no_code_only_shows_the_window(qtbot, tmp_path):
    # Any program of this user can reach the socket: what it says is held to the link's pattern here too.
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    script = tmp_path / "second.py"
    script.write_text(LINK_START, encoding="utf-8")
    with qtbot.waitSignal(first.activated, timeout=15_000), qtbot.assertNotEmitted(first.invite_requested):
        second = subprocess.Popen(
            [sys.executable, str(script), str(tmp_path / "data"), "invite ../x\n"], stdout=subprocess.PIPE, text=True,
        )
    second.communicate(timeout=15)
    first.release()


def test_a_start_opened_by_a_link_says_so(tmp_path):
    guard = FakeGuard(notify=True)
    assert claim(guard, quit=False, show=invite_message(CODE)) == "shown"
    assert guard.calls[-1] == ("notify", invite_message(CODE))


def test_waiting_for_the_folder_ends_when_the_first_lets_go(tmp_path):
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    later = InstanceGuard(tmp_path / "data")
    assert not later.wait_until_free(200)
    first.release()
    assert later.wait_until_free(200)
    assert later.acquire()  # the wait let go of the folder at once, so this start can take it
    later.release()


def test_waiting_ends_with_the_folder_free_when_the_process_list_cannot_be_read(tmp_path):
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()

    def unreadable() -> list[tuple[int, str]]:
        raise OSError("the process list could not be read")

    later = InstanceGuard(tmp_path / "data", processes=unreadable)
    assert not later.acquire()
    first.release()
    assert later.wait_until_free(200)  # the folder is free, which is what the wait is for


def test_a_quit_that_finds_the_folder_free_never_listens(tmp_path):
    # It holds the folder only to find out that no Guild Board runs. A start that met it then would be answered by
    # it, and end with no Guild Board running.
    quitting = InstanceGuard(tmp_path / "data")
    assert quitting.acquire(listen=False)
    later = InstanceGuard(tmp_path / "data", allow_foreground=lambda pid: None)
    assert not later.acquire()
    assert later.notify_running(SHOW, tries=1) is False
    quitting.release()


def test_the_demo_and_the_real_account_run_side_by_side(tmp_path):
    live = InstanceGuard(tmp_path / "GuildBoard")
    demo = InstanceGuard(tmp_path / "GuildBoard-demo")
    assert live.acquire()
    assert demo.acquire()
    live.release()
    demo.release()


def test_a_lock_left_behind_does_not_keep_the_next_start_out_whichever_process_has_its_id_now(tmp_path):
    # A Guild Board that ended without letting go (a crash, End task, a shutdown) leaves its lock file behind, and
    # Windows may give the id written in it to another process: here a Python that sleeps and is not Guild Board.
    # The file reads as Qt's QLockFile left it, naming that process. QLockFile looked that id up on every refused try,
    # and kept the start out while a process of the same name had it; the next start must run without asking.
    folder = tmp_path / "data"
    folder.mkdir()
    sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        (folder / LOCK_NAME).write_text(f"{sleeper.pid}\n{Path(sys.executable).stem}\n\n", encoding="utf-8")
        guard = InstanceGuard(folder)
        assert guard.acquire()
        guard.release()
    finally:
        sleeper.kill()
        sleeper.wait(10)


def test_only_an_id_the_process_list_names_as_something_other_than_the_game_may_come_to_the_front(
    tmp_path, monkeypatch
):
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    holder = os.getpid()

    def unreadable() -> list[tuple[int, str]]:
        raise OSError("the process list could not be read")

    lists = {
        "Guild Board": lambda: [(4, "System"), (holder, "python.exe")],
        "the game": lambda: [(4, "System"), (holder, "GenshinImpact.exe")],
        "gone": lambda: [(4, "System")],
        "unreadable": unreadable,
    }
    allowed: dict[str, list[int]] = {}
    try:
        for name, processes in lists.items():
            allowed[name] = []
            later = InstanceGuard(tmp_path / "data", allow_foreground=allowed[name].append, processes=processes)
            monkeypatch.setattr(later, "_send", lambda message: True)  # the first one is reached at once
            assert not later.acquire()
            assert later.notify_running(SHOW)
    finally:
        first.release()
    assert allowed == {"Guild Board": [holder], "the game": [], "gone": [], "unreadable": []}


def test_a_later_start_reads_the_holders_id_from_the_first_line_of_the_lock_file(tmp_path):
    # A Guild Board from before stage 2A's lock wrote more lines after the id: setup.ps1's --quit, run with the new
    # code, meets one of those.
    lock = tmp_path / LOCK_NAME
    cases = (("4242", 4242), ("4242\npython\nPC\n\n\n", 4242), ("", None), ("python\n", None), ("0", None))
    for text, expected in cases:
        lock.write_text(text, encoding="ascii")
        assert instance_module.read_holder(str(lock)) == expected, text
    assert instance_module.read_holder(str(tmp_path / "missing.lock")) is None


def _until_gone(pid: int, seconds: float = 10) -> None:
    # The venv's python.exe runs Python in a process of its own, which Windows ends just after the one a test started.
    deadline = time.monotonic() + seconds
    while pid in list_process_ids():
        assert time.monotonic() < deadline, f"process {pid} did not end"
        time.sleep(0.05)


def test_a_crashed_guild_board_does_not_keep_the_next_one_out(tmp_path):
    folder = tmp_path / "data"
    script = tmp_path / "holder.py"
    script.write_text(HOLDER, encoding="utf-8")
    holder = subprocess.Popen([sys.executable, str(script), str(folder)], stdout=subprocess.PIPE, text=True)
    try:
        state, pid = holder.stdout.readline().split()
        assert state == "locked"
        assert not InstanceGuard(folder).acquire()  # while it runs, the folder is taken
    finally:
        holder.kill()
        holder.wait(10)
        holder.stdout.close()
    _until_gone(int(pid))
    guard = InstanceGuard(folder)
    assert guard.acquire()  # the lock of a process that has ended does not count
    guard.release()


# Holds the folder, lets it go, and goes on running a while, as a quitting Guild Board does while Qt shuts down.
LETS_GO_LATE = """
import sys, time
from pathlib import Path
from PySide6.QtCore import QCoreApplication
from guildboard.shell.instance import InstanceGuard
app = QCoreApplication(sys.argv)
guard = InstanceGuard(Path(sys.argv[1]))
print("locked" if guard.acquire() else "busy", flush=True)
sys.stdin.readline()
guard.release()
time.sleep(1.5)
"""


def test_waiting_for_the_first_to_quit_lasts_until_its_process_has_ended(tmp_path):
    folder = tmp_path / "data"
    folder.mkdir()
    script = tmp_path / "late.py"
    script.write_text(LETS_GO_LATE, encoding="utf-8")
    first = subprocess.Popen(
        [sys.executable, str(script), str(folder)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
    )
    try:
        assert first.stdout.readline().strip() == "locked"
        later = InstanceGuard(folder)
        assert not later.acquire()  # it remembers which process holds the folder
        first.stdin.write("go\n")
        first.stdin.flush()
        assert later.wait_until_free(10_000)
        assert first.poll() is not None  # its files can be replaced now: setup.ps1 runs `uv sync` next
    finally:
        if first.poll() is None:
            first.kill()
        first.wait(10)
        first.stdin.close()
        first.stdout.close()


def test_a_later_start_lets_the_first_come_to_the_front(tmp_path):
    # Windows lets only the program in front bring a window forward. The later start is in front, because the
    # player just opened it, so it hands that right to the Guild Board that is running.
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    allowed: list[int] = []
    later = InstanceGuard(tmp_path / "data", allow_foreground=allowed.append)
    assert not later.acquire()
    later.notify_running(tries=1)  # nothing reads the first's pipe here, so each try waits half a second for it
    assert allowed == [os.getpid()]
    first.release()


def test_a_start_finds_its_place():
    assert claim(FakeGuard(acquire=(True,)), quit=False) == "run"
    assert claim(FakeGuard(notify=True), quit=False) == "shown"
    quitting = FakeGuard(acquire=(False, True), notify=False, free=True)
    assert claim(quitting, quit=False, start_wait_ms=10) == "run"  # the first was quitting; this start runs instead
    assert quitting.calls == ["acquire", ("notify", SHOW), ("wait", 10), "acquire"]
    assert claim(FakeGuard(notify=False, free=False), quit=False, start_wait_ms=10) == "not_answering"
    # Two starts waited for the same quitting Guild Board, and the other one took the folder first.
    lost = FakeGuard(acquire=(False, False), notify=(False, True), free=True)
    assert claim(lost, quit=False, start_wait_ms=10) == "shown"  # it brings the one that runs now to the front
    assert lost.calls == ["acquire", ("notify", SHOW), ("wait", 10), "acquire", ("notify", SHOW)]
    unanswered = FakeGuard(acquire=(False, False), notify=False, free=True)
    assert claim(unanswered, quit=False, start_wait_ms=10) == "not_answering"
    assert unanswered.calls == lost.calls
    # Mostly the other start takes the folder before this one's wait sees it free, so the wait runs out.
    outrun = FakeGuard(notify=(False, True), free=False)
    assert claim(outrun, quit=False, start_wait_ms=10) == "shown"
    assert outrun.calls == ["acquire", ("notify", SHOW), ("wait", 10), ("notify", SHOW)]
    stuck = FakeGuard(notify=False, free=False)
    assert claim(stuck, quit=False, start_wait_ms=10) == "not_answering"  # only once nobody answers that either
    assert stuck.calls == outrun.calls


def test_quit_finds_out_what_happened():
    alone = FakeGuard(acquire=(True,))
    assert claim(alone, quit=True) == "not_running"
    assert alone.calls == ["acquire without listening", "release"]  # no start can meet it and be answered
    assert claim(FakeGuard(notify=False), quit=True) == "not_answering"
    assert claim(FakeGuard(notify=True, free=False), quit=True, quit_wait_ms=10) == "still_running"
    assert claim(FakeGuard(notify=True, free=True), quit=True, quit_wait_ms=10) == "quit"
    # A Guild Board that is ending no longer listens, but holds the folder until its core has stopped.
    ending = FakeGuard(notify=False, free=True)
    assert claim(ending, quit=True, quit_wait_ms=10) == "quit"
    # It waits as long as a quit does.
    assert ending.calls == ["acquire without listening", ("notify", QUIT), ("wait", 10)]


def test_a_start_that_meets_another_start_tries_again_before_giving_up(tmp_path, monkeypatch):
    guard = InstanceGuard(tmp_path / "data")
    answers = [False, False, True]
    monkeypatch.setattr(guard, "_send", lambda message: answers.pop(0))
    assert guard.notify_running(SHOW, pause=0) is True and answers == []
    monkeypatch.setattr(guard, "_send", lambda message: False)
    assert guard.notify_running(SHOW, tries=3, pause=0) is False


def test_a_guild_board_that_hangs_is_given_up_on_in_about_four_seconds(tmp_path):
    # The first one listens, but nothing in this process reads what reaches it, as when a Guild Board hangs.
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    later = InstanceGuard(tmp_path / "data", allow_foreground=lambda pid: None)
    assert not later.acquire()
    started = time.monotonic()
    assert later.notify_running(SHOW) is False
    # Six tries of at most half a second, a quarter of a second apart: about four seconds, with room for a busy PC.
    assert time.monotonic() - started < 6
    first.release()


def test_a_connection_that_says_nothing_is_dropped(qtbot, tmp_path, monkeypatch):
    # L29: any program of this user can connect. One that says nothing is let go after a while, and only a few are kept
    # at once, so connections that stay silent cannot pile up for the life of Guild Board.
    monkeypatch.setattr(instance_module, "ANSWER_WAIT_MS", 1_500)
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    most = instance_module.MOST_CONNECTIONS
    silent = []
    for _ in range(most + 2):
        socket = QLocalSocket()
        socket.connectToServer(first._name)
        assert socket.waitForConnected(1_000)
        silent.append(socket)
    connected = QLocalSocket.LocalSocketState.ConnectedState
    qtbot.waitUntil(lambda: len(first._sockets) == most, timeout=1_000)  # the ones beyond are turned away at once
    qtbot.waitUntil(lambda: [s.state() for s in silent].count(connected) == most, timeout=1_000)
    qtbot.waitUntil(lambda: first._sockets == [], timeout=5_000)  # and the silent ones go after the wait
    qtbot.waitUntil(lambda: [s.state() for s in silent].count(connected) == 0, timeout=5_000)
    script = tmp_path / "second.py"
    script.write_text(SECOND_START, encoding="utf-8")
    with qtbot.waitSignal(first.activated, timeout=15_000):  # a start that speaks is still heard
        second = subprocess.Popen([sys.executable, str(script), str(tmp_path / "data")], stdout=subprocess.PIPE, text=True)
    assert second.communicate(timeout=15)[0].split() == ["refused", "True"]
    first.release()


def test_a_message_is_acted_on_only_once_its_line_is_whole(qtbot, tmp_path):
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    socket = QLocalSocket()
    socket.connectToServer(first._name)
    assert socket.waitForConnected(1_000)
    with qtbot.assertNotEmitted(first.quit_requested, wait=300):
        socket.write(b"qu")
        socket.flush()
    with qtbot.waitSignal(first.quit_requested, timeout=2_000):
        socket.write(b"it\n")
        socket.flush()
    # A line longer than any message is no message.
    long = QLocalSocket()
    long.connectToServer(first._name)
    assert long.waitForConnected(1_000)
    with qtbot.assertNotEmitted(first.activated, wait=500), qtbot.assertNotEmitted(first.quit_requested):
        long.write(b"x" * 4_000)
        long.flush()
    qtbot.waitUntil(lambda: long.state() == QLocalSocket.LocalSocketState.UnconnectedState, timeout=2_000)
    first.release()


def _pipe_access(name: str) -> set[str]:
    """Who the pipe's own security lets in: the SIDs of its access list, as Windows writes them (SY for the system,
    WD for everyone, AN for anonymous logons, and a user's full SID)."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                     wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    advapi32.GetSecurityInfo.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.DWORD, wintypes.LPVOID,
                                         wintypes.LPVOID, wintypes.LPVOID, wintypes.LPVOID, ctypes.POINTER(wintypes.LPVOID)]
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
        wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(wintypes.LPWSTR), wintypes.LPVOID,
    ]
    read_control, open_existing, kernel_object, dacl, sddl_revision = 0x20000, 3, 6, 0x4, 1
    handle = kernel32.CreateFileW(rf"\\.\pipe\{name}", read_control, 0, None, open_existing, 0, None)
    assert handle not in (None, wintypes.HANDLE(-1).value), ctypes.get_last_error()
    try:
        descriptor, text = wintypes.LPVOID(), wintypes.LPWSTR()
        assert advapi32.GetSecurityInfo(handle, kernel_object, dacl, None, None, None, None, ctypes.byref(descriptor)) == 0
        assert advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor, sddl_revision, dacl, ctypes.byref(text), None
        )
        written = text.value
        kernel32.LocalFree(text)
        kernel32.LocalFree(descriptor)
    finally:
        kernel32.CloseHandle(handle)
    return {entry.split(";")[-1] for entry in re.findall(r"\(([^)]*)\)", written)}


def test_only_this_user_may_connect(qtbot, tmp_path):
    # A named pipe Windows makes with its default security lets every account, and anonymous logons, open it for
    # reading: they could hold connections open, or answer in its place. Guild Board's lets in this user alone.
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    who = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, encoding="oem", errors="replace")
    user = who.stdout.strip().rsplit(",", 1)[-1].strip('"')
    assert user.startswith("S-1-5-")
    assert _pipe_access(first._name) == {user}
    first.release()


# Takes the pipe's name before the Guild Board that holds the folder listens, as a program of another account could, and
# says what reached it once its time is up.
SQUATTER = """
import sys
from PySide6.QtCore import QCoreApplication, QTimer
from PySide6.QtNetwork import QLocalServer
app = QCoreApplication(sys.argv)
server, heard, sockets = QLocalServer(), [], []
def take():
    while server.hasPendingConnections():
        socket = server.nextPendingConnection()
        sockets.append(socket)
        socket.readyRead.connect(lambda socket=socket: heard.append(bytes(socket.readAll().data())))
server.newConnection.connect(take)
print("listening" if server.listen(sys.argv[1]) else "busy", flush=True)
QTimer.singleShot(int(sys.argv[2]), lambda: (print(repr(b"".join(heard)), flush=True), app.quit()))
app.exec()
"""


def test_a_later_start_writes_only_to_the_holder(tmp_path):
    folder = tmp_path / "data"
    holder = InstanceGuard(folder)
    assert holder.acquire(listen=False)  # this process holds the folder; another one serves the pipe's name
    script = tmp_path / "squatter.py"
    script.write_text(SQUATTER, encoding="utf-8")
    squatter = subprocess.Popen([sys.executable, str(script), holder._name, "4000"], stdout=subprocess.PIPE, text=True)
    try:
        assert squatter.stdout.readline().strip() == "listening"
        later = InstanceGuard(folder, allow_foreground=lambda pid: None)
        assert not later.acquire()
        assert later.notify_running(QUIT, tries=2, pause=0) is False  # whoever answers is not the holder
        assert squatter.stdout.readline().strip() == "b''"  # and nothing was said to it
    finally:
        squatter.kill()
        squatter.wait(10)
        squatter.stdout.close()
        holder.release()


def test_a_guild_board_that_stops_listening_is_no_longer_reached(qtbot, tmp_path):
    # The later start is a process of its own, and Qt runs here while it tries, so that the first one can answer.
    first = InstanceGuard(tmp_path / "data")
    assert first.acquire()
    script = tmp_path / "second.py"
    script.write_text(SECOND_START, encoding="utf-8")
    once = [sys.executable, str(script), str(tmp_path / "data"), "once"]
    with qtbot.waitSignal(first.activated, timeout=15_000):
        reached = subprocess.Popen(once, stdout=subprocess.PIPE, text=True)
    assert reached.communicate(timeout=15)[0].split() == ["refused", "True"]  # while it listens, one try reaches it
    first.stop_listening()
    with qtbot.assertNotEmitted(first.activated):
        turned_away = subprocess.Popen(once, stdout=subprocess.PIPE, text=True)
        qtbot.waitUntil(lambda: turned_away.poll() is not None, timeout=15_000)
    assert turned_away.communicate(timeout=15)[0].split() == ["refused", "False"]
    first.release()
