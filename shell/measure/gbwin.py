"""Helpers for measuring the packaged Guild Board shell in its demo: start it, place it, talk to its page over CDP, stop it.

Only the packaged `electron` host is measured. Every start is preceded by a look at the Windows process list for the game
(gamecheck.py), and a watchdog goes on looking while the demo runs; if the game starts, the demo is stopped by its process
ids and the harness ends. Processes are stopped by their ids, never by name.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

import psutil
import websocket

from gamecheck import running_games

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]  # the worktree: shell/measure -> shell -> the repository
PORT = 9333
# GB_DISPLAY=1 (default): dxcam's output 1, expected to be the 2,560 x 1,440 display at 165 Hz.
# GB_DISPLAY=0: dxcam's output 0, expected to be the 3,440 x 1,440 primary display at 240 Hz.
OUTPUT = int(os.environ.get("GB_DISPLAY", "1"))
EXPECTED_SIZE = (2560, 1440) if OUTPUT == 1 else (3440, 1440)

user32 = ctypes.WinDLL("user32", use_last_error=True)
ctypes.windll.shcore.SetProcessDpiAwareness(2)
EnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
user32.EnumWindows.argtypes = [EnumProc, wt.LPARAM]
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.IsZoomed.argtypes = [wt.HWND]
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.GetWindowTextLengthW.argtypes = [wt.HWND]
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.SetWindowPos.restype = wt.BOOL
HWND_TOPMOST = wt.HWND(-1)

MonitorEnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HANDLE, wt.HDC, ctypes.POINTER(wt.RECT), wt.LPARAM)
user32.EnumDisplayMonitors.argtypes = [wt.HDC, ctypes.c_void_p, MonitorEnumProc, wt.LPARAM]


def monitors() -> list[tuple[int, int, int, int]]:
    """(left, top, width, height) of every display, in the virtual screen's pixels."""
    found: list[tuple[int, int, int, int]] = []

    def visit(_monitor, _dc, rect, _data):
        r = rect.contents
        found.append((r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True

    user32.EnumDisplayMonitors(None, None, MonitorEnumProc(visit), 0)
    return found


def output_origin() -> tuple[int, int]:
    """Where the measured display starts in the virtual screen, (left, top): the display of the expected size
    (2,560 x 1,440, or 3,440 x 1,440 for GB_DISPLAY=0). Fails if there is not exactly one."""
    matching = [m for m in monitors() if (m[2], m[3]) == EXPECTED_SIZE]
    if len(matching) != 1:
        raise SystemExit(f"refused: expected one {EXPECTED_SIZE} display, found {monitors()}")
    return matching[0][0], matching[0][1]


OUTPUT_LEFT, OUTPUT_TOP = output_origin()


def tree(pid: int) -> list[psutil.Process]:
    try:
        root = psutil.Process(pid)
        return [root, *root.children(recursive=True)]
    except psutil.Error:
        return []


def find_window(pids: set[int]) -> int | None:
    found: list[int] = []

    def visit(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            length = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            if buf.value.startswith("Guild Board"):
                found.append(hwnd)
        return True

    user32.EnumWindows(EnumProc(visit), 0)
    return found[0] if found else None


def client_rect(hwnd: int) -> tuple[int, int, int, int]:
    rect = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    point = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(point))
    return point.x, point.y, rect.right, rect.bottom


def place(hwnd: int, size: str) -> tuple[int, int, int, int]:
    """'full': maximized on the measured display; 'usual': a 1,640 x 1,100 client area on it. Always over other windows."""
    if size == "full":
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        time.sleep(0.4)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, OUTPUT_LEFT + 100, OUTPUT_TOP + 100, 1200, 800, 0x0040)
        time.sleep(0.4)
        user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
        time.sleep(1.0)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)  # keep size and place
        time.sleep(0.5)
        return client_rect(hwnd)
    x, y, w, h = OUTPUT_LEFT + 460, OUTPUT_TOP + 170, 1640, 1100
    outer = wt.RECT()
    for _ in range(6):
        if user32.IsZoomed(hwnd):
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            time.sleep(0.5)
        user32.GetWindowRect(hwnd, ctypes.byref(outer))
        cx, cy, cw, ch = client_rect(hwnd)
        left = x - (cx - outer.left)
        top = y - (cy - outer.top)
        width = w + (outer.right - outer.left - cw)
        height = h + (outer.bottom - outer.top - ch)
        if not user32.SetWindowPos(hwnd, HWND_TOPMOST, left, top, width, height, 0x0040):
            print("SetWindowPos failed", ctypes.get_last_error())
        time.sleep(0.8)
        if client_rect(hwnd) == (x, y, w, h):
            break
    return client_rect(hwnd)


def dashboard_target(target: dict) -> bool:
    """The dashboard's page: the core's own, past its launch link, and not the overlay's."""
    url = target.get("url", "")
    return (target.get("type") == "page" and url.startswith("http://127.0.0.1") and "/launch" not in url
            and "#/overlay" not in url)


class Page:
    def __init__(self) -> None:
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5))
        page = next(t for t in targets if dashboard_target(t))
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
        self.lock = threading.Lock()
        self.next_id = 0

    def send(self, method: str, **params):
        with self.lock:
            self.next_id += 1
            ident = self.next_id
            self.ws.send(json.dumps({"id": ident, "method": method, "params": params}))
            while True:
                message = json.loads(self.ws.recv())
                if message.get("id") == ident:
                    return message.get("result", message.get("error"))

    def js(self, expression: str):
        """Runs an expression in the demo's own page (CDP Runtime.evaluate) and returns its value."""
        result = self.send("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        return (result or {}).get("result", {}).get("value")

    def go(self, fragment: str) -> None:
        self.js(f"location.hash = {json.dumps(fragment)}")


# The packaged shell from `npm run build`'s packaging (shell/build/package.mjs): the program the installer carries.
APP = REPO / "shell" / "out" / "Guild Board-win32-x64" / "guildboard-app.exe"
RUNS = HERE / "runs"


def _clean_env() -> dict[str, str]:
    env = dict(os.environ)
    for unwanted in ("PYTHONUNBUFFERED", "PYTHONSAFEPATH", "PYTHONNOUSERSITE"):
        env.pop(unwanted, None)
    return env


def refuse_if_game_runs(where: str) -> None:
    games = running_games()
    if games:
        raise SystemExit(f"refused: {', '.join(games)} may run; nothing is measured or captured ({where})")


# Switches a caller may pass through are Chromium's own. The ones that the harness sets, or that change what the shell is
# (the data folder, a quit, the demo itself), are never passed through.
HARNESS_SWITCHES = ("--data-dir", "--quit", "--demo", "--demo-now", "--acknowledged", "--remote-debugging-port",
                    "--remote-debugging-pipe", "--remote-debugging-address", "--invite", "--inspect")


def checked_switches(switches: list[str]) -> list[str]:
    for switch in switches:
        name = switch.split("=", 1)[0]
        if not switch.startswith("--") or name in HARNESS_SWITCHES or name.startswith("--inspect"):
            raise SystemExit(f"refused: the switch {switch!r} is not a Chromium switch to pass through")
    return switches


def launch_arguments(data: Path, switches: list[str] | None) -> list[str]:
    """The program's arguments: the passed-through switches first and the harness's own last, so that the shell, which
    keeps the last of a repeated option, always takes the harness's data folder."""
    return [*checked_switches(list(switches or [])), "--demo", "--acknowledged", "--data-dir", str(data),
            f"--remote-debugging-port={PORT}"]


def port_answers() -> bool:
    """Whether something already answers on the debugging port: a leftover demo, which must never be driven by mistake."""
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1).close()
        return True
    except OSError:
        return False


class Demo:
    """The packaged shell in its demo, on a data folder of its own, with the debugging port the shell allows in the demo."""

    def __init__(self, name: str, switches: list[str] | None = None) -> None:
        if not APP.exists():
            raise SystemExit(f"refused: {APP} is not built")
        refuse_if_game_runs("before the start")
        if port_answers():
            raise SystemExit(f"refused: something already answers on the debugging port {PORT}; nothing is started")
        arguments = launch_arguments(RUNS / f"electron-{name}", switches)
        self.started = time.time()
        (RUNS / f"electron-{name}").mkdir(parents=True, exist_ok=True)
        self.process = subprocess.Popen(
            [str(APP), *arguments],
            cwd=APP.parent, env=_clean_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.page_seen: float | None = None
        self.window_seen: float | None = None
        self.ended = threading.Event()
        threading.Thread(target=self._watch_game, daemon=True).start()

    def _watch_game(self) -> None:
        """Every few seconds, until the demo is stopped: if the game starts, stop the demo and end the harness."""
        while not self.ended.wait(3):
            try:
                games = running_games()
            except Exception:  # a failed look is not a reason to go on silently
                games = ["unknown"]
            if games:
                print(f"GAME STARTED ({', '.join(games)}): the demo is stopped and nothing more is captured", flush=True)
                self.stop()
                os._exit(3)

    def wait(self, timeout: float = 90) -> int:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2))
                if any(dashboard_target(t) for t in targets):
                    self.page_seen = time.time()
                    break
            except OSError:
                pass
            time.sleep(0.05)
        else:
            raise SystemExit("refused: the demo's page never appeared")
        while time.time() < deadline:
            hwnd = find_window({p.pid for p in self.procs()})
            if hwnd:
                self.window_seen = time.time()
                return hwnd
            time.sleep(0.05)
        raise SystemExit("refused: no window")

    def procs(self) -> list[psutil.Process]:
        return tree(self.process.pid)

    def stop(self) -> None:
        """Ends the program this harness started, by its process ids."""
        self.ended.set()
        for p in reversed(self.procs()):
            try:
                p.kill()
            except psutil.Error:
                pass


def prime_cpu(procs: list[psutil.Process]) -> None:
    for p in procs:
        try:
            p.cpu_percent(None)
        except psutil.Error:
            pass


def read_cpu(procs: list[psutil.Process]) -> int:
    total = 0.0
    for p in procs:
        try:
            total += p.cpu_percent(None)
        except psutil.Error:
            pass
    return round(total)


def private_mb(procs: list[psutil.Process]) -> int:
    total = 0
    for p in procs:
        try:
            total += p.memory_info().private
        except psutil.Error:
            pass
    return round(total / 2**20)
