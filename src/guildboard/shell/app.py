"""Guild Board with its windows: the core on a thread of its own, the dashboard window, the tray icon, the login and
verification windows the interface asks for, and the overlay over the game with its hotkey."""
from __future__ import annotations

import logging
import re
import os
import sys
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from PySide6.QtCore import QCoreApplication, QObject, QProcess, QStandardPaths, Qt, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices, QGuiApplication, QScreen
from PySide6.QtWidgets import QApplication, QFileDialog, QMessageBox, QSystemTrayIcon, QWidget

from guildboard.__main__ import default_web_dir
from guildboard.backups import BackupRefused
from guildboard.config import AppPaths, Settings, load_settings
from guildboard.core import Core
from guildboard.hotkeys import Hotkey, parse_hotkey
from guildboard.logging_setup import setup_logging
from guildboard.shell.corethread import CoreSignals, CoreThread, Deliver
from guildboard.shell.dashboard import DashboardWindow, ViewFactory, web_view
from guildboard.shell.hotkey import GlobalHotkey, HotkeyFilter
from guildboard.shell.instance import SHOW, InstanceGuard, claim, invite_message
from guildboard.shell.login import LoginFlow, LoginWindow
from guildboard.shell.maphost import MapEngine, MapHost, on_map_page
from guildboard.shell.overlay import OverlayWindow, screen_for, zoom_for
from guildboard.shell.placement import WindowPlacement
from guildboard.shell.startup import Shortcut, launcher, shortcut_data_dir, startup_folder
from guildboard.shell.tray import Tray, app_icon
from guildboard.shell.verify import VerifyWindow

log = logging.getLogger(__name__)

PLACEMENT_FILE = "window.json"

STOPPED = "Guild Board stopped unexpectedly. The log file says why."
NOT_ANSWERING = (
    "Guild Board is already running, but it does not answer. Quit it from the tray icon, or end it in Task Manager."
)
STILL_RUNNING = ("Guild Board is still running", "It keeps syncing from the tray. Right-click the tray icon to quit.")
TIMERS = "achievements/timers"  # the place a click on a reminder opens
BOARD = "board"  # the place a click on a reminder about quick timers alone opens
# The notifications a click opens a place for. A Characters notice opens Your week; one about a goal that is ready has the
# character in its kind, "characters/<slug>", and opens her profile (see place_of).
PLACES_BY_KIND = {"reminder": TIMERS, "quick": BOARD, "codes": "codes", "characters": "week"}
CHARACTER_KIND = re.compile(r"characters/[a-z0-9]+(?:-[a-z0-9]+)*")
FRIENDS_PLACE = "friends"  # where an opened invite link is answered


def place_of(kind: str | None) -> str | None:
    """The place a click on a notification of this kind opens, or None."""
    if kind is not None and CHARACTER_KIND.fullmatch(kind):
        return kind
    return PLACES_BY_KIND.get(kind or "")

QUIT_MESSAGES = {
    "not_running": "Guild Board is not running.",
    "not_answering": (
        "Guild Board is running but does not answer. Quit it from the tray icon, or end it in Task Manager."
    ),
    "still_running": "Guild Board was asked to quit, but it is still running after 30 seconds.",
}


def demo_command() -> tuple[str, list[str]]:
    """The program and arguments that start Guild Board on demo data: the installed copy's own program, or this
    Python's windowless twin from a checkout."""
    if getattr(sys, "frozen", False):
        return sys.executable, ["--demo", "--acknowledged"]
    windowless = Path(sys.executable).with_name("pythonw.exe")
    program = windowless if windowless.exists() else Path(sys.executable)
    return str(program), ["-m", "guildboard", "--demo", "--acknowledged"]


def restart_command(argv: Sequence[str]) -> tuple[str, list[str]]:
    """The program and arguments that start Guild Board again after a restore: built as `demo_command` builds its own,
    never from the arguments this one started with, which may carry --hidden (a start with Windows is hidden, and a
    restart that came back hidden would look like a crash). Only the data folder is kept, when one was given."""
    folder: list[str] = []
    for number, argument in enumerate(argv):
        if argument == "--data-dir" and number + 1 < len(argv):
            folder = ["--data-dir", argv[number + 1]]
        elif argument.startswith("--data-dir="):
            folder = ["--data-dir", argument.partition("=")[2]]
    if getattr(sys, "frozen", False):
        return sys.executable, folder
    windowless = Path(sys.executable).with_name("pythonw.exe")
    program = windowless if windowless.exists() else Path(sys.executable)
    return str(program), ["-m", "guildboard", *folder]


class Desktop:
    """What Guild Board asks of Windows itself."""

    def tray_available(self) -> bool:
        return QSystemTrayIcon.isSystemTrayAvailable()

    def open_folder(self, folder: Path) -> None:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(folder)))

    def open_demo(self) -> None:
        # Guild Board on demo data, in a process of its own, with the statement the player has just read.
        program, arguments = demo_command()
        QProcess.startDetached(program, arguments)

    def alert(self, text: str) -> None:
        QMessageBox.critical(None, "Guild Board", text)

    def choose_backup_file(self, name: str) -> str | None:
        """The Save dialog for an exported backup, in the Documents folder: the path the player chose, None if they
        cancelled."""
        documents = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.DocumentsLocation)
        path, _ = QFileDialog.getSaveFileName(
            None, "Export backup", str(Path(documents) / name), "Guild Board backup (*.gbbackup)"
        )
        return path or None

    def start_again(self) -> None:
        """Start Guild Board again, with its window open, once this one has stopped."""
        program, arguments = restart_command(sys.argv[1:])
        QProcess.startDetached(program, arguments)


def display_list(screens: Sequence[QScreen], primary: QScreen | None) -> list[dict[str, Any]]:
    """The displays as the Overlay settings offer them: each by the name Windows gives it, with a label the player
    reads, such as "Display 1, 3440 × 1440, main". The size is in the display's own pixels, as Windows' display
    settings give it: Qt's size times the display's scaling."""
    found = []
    for number, screen in enumerate(screens, start=1):
        size, ratio = screen.geometry().size(), screen.devicePixelRatio()
        label = f"Display {number}, {round(size.width() * ratio)} × {round(size.height() * ratio)}"
        main = screen is primary
        found.append({"name": screen.name(), "label": label + (", main" if main else ""), "primary": main})
    return found


@dataclass(frozen=True)
class Windows:
    """The windows Guild Board makes, and the overlay's hotkey; tests put stand-ins in their place."""

    view: ViewFactory = web_view
    login: Callable[[], QWidget] = LoginWindow
    verify: Callable[[Mapping[str, str]], QWidget] = VerifyWindow
    overlay: Callable[[str], OverlayWindow] = OverlayWindow  # made with the launch link
    hotkey: Callable[[], GlobalHotkey] = GlobalHotkey
    map_engine: Callable[[], Any] = MapEngine  # makes the Map page's views and holds their session


class ShellApp(QObject):
    ended = Signal(int)  # Guild Board should end, with this exit code

    def __init__(
        self,
        paths: AppPaths,
        *,
        demo: bool,
        hidden: bool = False,
        acknowledged: bool = False,
        demo_now: datetime | None = None,
        desktop: Desktop | None = None,
        windows: Windows | None = None,
        startup: Shortcut | None = None,
        overlay: bool | None = None,
    ) -> None:
        super().__init__()
        self._paths = paths
        self._demo = demo
        self._hidden = hidden
        self._acknowledged = acknowledged
        self._demo_now = demo_now
        self._desktop = desktop or Desktop()
        self._windows = windows or Windows()
        self._startup = startup
        # The demo is for looking around: it has no tray, and closing its window ends it.
        self._has_tray = not demo and self._desktop.tray_available()
        # Nor has it the overlay, which is for the game, or its hotkey: a demo takes no key from the player.
        self._has_overlay = not demo if overlay is None else overlay
        self._overlay: OverlayWindow | None = None
        self._hotkey: GlobalHotkey | None = None
        self._hotkey_filter: HotkeyFilter | None = None
        self._watching_displays = False  # the overlay hears of displays plugged in or out, and of a new main one
        self._watched_screens: list[QScreen] = []  # the displays whose new geometry it hears of
        self._displays_pending = False  # it follows a change of the displays a moment later
        self._hotkey_state = "none"  # what the Overlay settings say of the hotkey: "held", "taken" or "none"
        self._hotkey_refused: Hotkey | None = None  # the hotkey whose refusal the log has told of
        self._game_running = False
        self._tray: Tray | None = None
        self._dashboard: DashboardWindow | None = None
        self._verify: QWidget | None = None
        self._closing: list[QWidget] = []  # windows that closed themselves, kept until Qt has deleted them
        self._settings: Settings | None = None
        self._hint_given = False
        self._message_kind: str | None = None  # what the tray icon showed last: a click on a reminder opens Timers
        self._ending = False
        self._invite: str | None = None  # the code of an invite link that was opened before the core was ready
        self.restarting = False  # a restore asked for Guild Board to start again once it has stopped
        self._deliver = Deliver()
        self._signals = CoreSignals()
        self._signals.ready.connect(self._on_ready)
        self._signals.failed.connect(self._on_failed)
        self._signals.window.connect(self._on_window)
        self._signals.settings.connect(self._on_settings)
        self._signals.notify.connect(self._on_notify)
        self._signals.game.connect(self._on_game)
        self._signals.map.connect(self._on_map)
        self._signals.finished.connect(self._on_finished)
        self._thread = CoreThread(self._make_core, self._signals, web_dir=default_web_dir())
        self._login = LoginFlow(
            lambda cookies, uid: self.call(lambda core: core.auth.login(cookies, uid)),
            make_window=self._windows.login,
        )
        self._login.logged_in.connect(self.show_window)
        # The Map page's views (the Map design): what the core says of the tabs, and the session they sign in with.
        self._maps = MapHost(
            lambda tab, url, title: self._call_quietly("the map's address", lambda core: core.map_seen(tab, url, title)),
            lambda tab, failed: self._call_quietly("a map's failure", lambda core: core.map_failed(tab, failed)),
            engine=self._windows.map_engine(),
        )
        self._map_snapshot: dict[str, Any] | None = None
        self._map_session = 0  # the core's count of logins and logouts that the views' session follows

    # ---- running

    def start(self) -> None:
        if self._has_tray:
            self._tray = Tray(
                app_icon(),
                open_window=self.show_window,
                sync_now=lambda: self._call_quietly(
                    "the tray item Sync now", lambda core: core.scheduler.request("manual")
                ),
                set_paused=lambda paused: self._call_quietly(
                    "the tray item Pause syncing", lambda core: core.set_paused(paused)
                ),
                set_pinned=lambda pinned: self._call_quietly(
                    "the tray item Show pinned widgets", lambda core: core.update_settings({"overlay_pinned": pinned}),
                    failed=self._show_pinned_setting,
                ),
                to_main_display=self._to_main_display,
                quit=self.quit,
            )
            self._tray.icon.messageClicked.connect(self._on_message_clicked)
            self._tray.show()
        self._thread.start()

    def stop(self) -> None:
        """After the event loop has ended: hide the tray, let go of the overlay's hotkey and stop the core."""
        self._ending = True
        if self._tray is not None:
            self._tray.hide()
        self._stop_overlay()
        self._maps.close()
        self._thread.stop()

    def call(self, fn: Callable[[Core], Any]) -> Future:
        return self._thread.call(fn)

    def _call_quietly(
        self,
        what: str,
        fn: Callable[[Core], Any],
        *,
        then: Callable[[Any], None] | None = None,
        failed: Callable[[], None] | None = None,
        refused: Callable[[str], None] | None = None,
    ) -> None:
        """A call into the core that nothing waits for. `what` names it in the log, when the core is not running
        and when the call fails inside the core; `failed` runs then too. `then` receives its answer, on Qt's thread.
        A backup the core refused (BackupRefused) goes to `refused` with its sentence, which the player reads, when
        there is one; it is no failure."""
        try:
            future = self.call(fn)
        except RuntimeError:
            log.warning("the core is not running, so %s was dropped", what)
            if failed is not None:
                failed()
            return
        # What fails inside the core does not raise here: it ends the call's future, which only this reads.
        self._deliver.then(future, lambda done: self._on_quiet_answer(what, done, then, failed, refused))

    def _on_quiet_answer(
        self,
        what: str,
        future: Future,
        then: Callable[[Any], None] | None = None,
        failed: Callable[[], None] | None = None,
        refused: Callable[[str], None] | None = None,
    ) -> None:
        # Deliver drops a cancelled call before it comes here: that is the core stopping, not the call failing.
        error = future.exception()
        if isinstance(error, BackupRefused) and refused is not None:
            log.info("%s was refused: %s", what, error)
            refused(str(error))
        elif error is not None:
            log.error("%s failed", what, exc_info=error)
            if failed is not None:
                failed()
        elif then is not None:
            then(future.result())

    def dashboard(self) -> DashboardWindow | None:
        return self._dashboard

    def tray(self) -> Tray | None:
        return self._tray

    def overlay(self) -> OverlayWindow | None:
        return self._overlay

    def hotkey(self) -> GlobalHotkey | None:
        return self._hotkey

    @Slot()
    def show_window(self) -> None:
        self._hidden = False  # a window asked for before the core is ready opens once it is
        self._open_dashboard()

    @Slot(str)
    def take_invite(self, code: str) -> None:
        """An invite link was opened: the core learns who it is from and sends nothing, and the window shows Friends, where
        the player answers it. Before the core is ready, `_on_ready` does this."""
        self._hidden = False
        if self._dashboard is None:
            self._invite = code
            return
        self._offer_invite(code)
        self._open_dashboard(FRIENDS_PLACE)

    def _offer_invite(self, code: str) -> None:
        self._call_quietly("an invite link", lambda core: core.online.offer_invite(code))

    def _open_dashboard(self, place: str | None = None) -> None:
        if self._dashboard is None:
            return
        # The open overlay stays on top of its display, and a dashboard shown there would be under it: it closes first.
        if self._overlay is not None and self._overlay.is_open:
            self._overlay.close_overlay()
        self._dashboard.open(place)

    @Slot()
    def quit(self) -> None:
        if self._ending:
            return
        self._ending = True
        if self._dashboard is not None:
            self._dashboard.save_placement()
        self.ended.emit(0)

    def _make_core(self) -> Core:
        # On the core's thread.
        core = Core(self._paths, demo=self._demo, demo_now=self._demo_now)
        core.has_tray = self._has_tray
        if self._demo and self._acknowledged:
            core.update_settings({"risk_acknowledged": True})
        return core

    # ---- what the core says, delivered on Qt's thread

    @Slot(str)
    def _on_ready(self, link: str) -> None:
        if self._ending:
            return
        self._dashboard = DashboardWindow(
            link,
            WindowPlacement(self._paths.data_dir / PLACEMENT_FILE),
            make_view=self._windows.view,
            title="Guild Board - demo data" if self._demo else "Guild Board",
            can_hide=self._has_tray,
        )
        self._dashboard.hidden_to_tray.connect(self._on_hidden_to_tray)
        self._dashboard.view_opened.connect(self._on_view_opened)
        self._dashboard.resized.connect(self._sync_maps)
        self._dashboard.ended.connect(self.quit)
        self._call_quietly("reading the map tabs", lambda core: core.map_snapshot(), then=self._on_map)
        if not (self._hidden and self._has_tray):
            self._dashboard.open(None if self._invite is None else FRIENDS_PLACE)
        if self._invite is not None:
            self._offer_invite(self._invite)
            self._invite = None
        if self._has_overlay:
            self._start_overlay(link)
        log.info("Guild Board is running")

    @Slot(str)
    def _on_failed(self, text: str) -> None:
        if self._ending:
            return
        self._ending = True  # before the alert: it is modal, and `finished` can arrive while it is open
        if self._overlay is not None:
            self._overlay.hide_overlay()  # an open overlay would cover the alert, and take the clicks meant for it
        self._desktop.alert(text)
        self.ended.emit(1)

    @Slot()
    def _on_finished(self) -> None:
        if not self._ending:
            self._on_failed(STOPPED)

    @Slot(object)
    def _on_settings(self, settings: Settings) -> None:
        previous, self._settings = self._settings, settings
        if self._tray is not None:
            self._tray.show_paused(settings.sync_paused)
            self._tray.show_pinned(settings.overlay_pinned)
        if self._startup is not None and self._startup.exists() != settings.start_with_windows:
            self._startup.apply(settings.start_with_windows)
        # The settings come once before the core is ready, when there is no overlay yet: it reads them when it is made.
        if self._overlay is None or previous is None:
            return
        self._overlay.set_full_screen_game(settings.overlay_full_screen)
        # A hotkey another program held is asked for again with any settings, as when the player saves it again.
        if settings.overlay_hotkey != previous.overlay_hotkey or self._hotkey_state == "taken":
            self._hold_hotkey()
            self._report_overlay()
        if (settings.overlay_display, settings.overlay_size) != (previous.overlay_display, previous.overlay_size):
            self._place_overlay()

    @Slot(str)
    def _on_window(self, kind: str) -> None:
        if kind == "login":
            self._login.start()
        elif kind == "verify":
            self._open_verify()
        elif kind == "data_folder":
            self._desktop.open_folder(self._paths.data_dir)
        elif kind == "demo":
            if self._demo:
                self.show_window()
            else:
                self._desktop.open_demo()
        elif kind == "export_backup":
            self._call_quietly("reading the backup's file name", lambda core: core.backup_file_name(), then=self._export)
        elif kind == "restart":
            self.restarting = True
            self.quit()

    # ---- backups

    def _export(self, name: str) -> None:
        chosen = self._desktop.choose_backup_file(name)
        if not chosen:
            return
        self._call_quietly(
            "the backup export", lambda core: core.export_backup(Path(chosen)),
            then=lambda written: self._on_notify("backup", f"Saved {written}."),
            failed=lambda: self._on_notify("backup", "The backup could not be saved."),
            refused=lambda reason: self._on_notify("backup", reason),
        )

    def relaunch(self) -> None:
        """After Guild Board has stopped: start it again, when a restore asked for that."""
        if self.restarting:
            self._desktop.start_again()

    # ---- the verification window

    def _open_verify(self) -> None:
        if self._verify is not None:
            self._verify.start()  # already open: brought to the front
            return

        def stored(core: Core) -> dict[str, str] | None:
            token = core.auth.current() if core.auth is not None else None
            return dict(token.cookies) if token is not None else None

        self._deliver.then(self.call(stored), self._on_stored_login)

    def _on_stored_login(self, future: Future) -> None:
        cookies = future.result() if future.exception() is None else None
        if cookies is None:
            log.warning("verification was asked for, but no login is stored")
            return
        if self._verify is not None or self._ending:
            return
        window = self._windows.verify(cookies)
        window.closed.connect(lambda: self._on_verify_closed(window))
        self._verify = window
        window.start()

    def _on_verify_closed(self, window: QWidget) -> None:
        if self._verify is window:
            self._verify = None
        self._closing.append(window)
        window.destroyed.connect(lambda: self._closing.remove(window) if window in self._closing else None)
        window.deleteLater()
        self._call_quietly("the call that ends the verification", lambda core: core.verification_done())

    # ---- the tray hint

    # ---- the Map page's views, over the interface's view

    @Slot(object)
    def _on_map(self, snapshot: dict[str, Any]) -> None:
        self._map_snapshot = snapshot
        session = snapshot.get("session", 0)
        if session != self._map_session:  # a login or a logout: the views sign in or out
            self._map_session = session
            self._read_map_session()
        self._sync_maps()

    def _on_view_opened(self, view: QWidget) -> None:
        """The window made its view: the map views will sit on it, and follow where its page goes."""
        moved = getattr(view, "urlChanged", None)
        if moved is not None:
            moved.connect(lambda *_: self._sync_maps())
        self._read_map_session()
        self._sync_maps()

    def _read_map_session(self) -> None:
        """The session the map views sign in with, as the core holds it now: at each opening of the window, and after a
        login or a logout. One while the window is open reloads the views."""
        if self._ending:
            return
        self._call_quietly(
            "reading the session for the map", lambda core: (core.map_session(), core.map_role()),
            then=self._on_map_session,
        )

    def _on_map_session(self, session: tuple[dict[str, str] | None, dict[str, str] | None]) -> None:
        if self._ending:
            return  # the views and their session have gone with Guild Board: none is put back
        cookies, role = session
        self._maps.set_session(cookies, role)
        self._sync_maps()

    def _sync_maps(self) -> None:
        holder = self._dashboard.view() if self._dashboard is not None else None
        zoom = holder.zoomFactor() if holder is not None else 1.0
        on_page = holder is not None and on_map_page(holder.url().toString()) if hasattr(holder, "url") else False
        self._maps.apply(self._map_snapshot, holder, zoom=zoom, on_page=on_page)

    @Slot()
    def _on_hidden_to_tray(self) -> None:
        self._sync_maps()  # the window's view is gone, and the map views with it
        if self._hint_given or self._settings is None or self._settings.tray_hint_shown:
            return
        self._hint_given = True
        self._call_quietly(
            "the call that marks the tray hint as seen", lambda core: core.update_settings({"tray_hint_shown": True})
        )
        if self._tray is not None:
            self._message_kind = "hint"
            self._tray.icon.showMessage(*STILL_RUNNING)

    # ---- notifications: reminders, and the test from Settings

    @Slot(str, str)
    def _on_notify(self, kind: str, text: str) -> None:
        if self._ending:
            return
        if self._tray is None:
            log.info("a %s notification was not shown: there is no tray icon", kind)
            return
        self._message_kind = kind
        log.info("a %s notification was handed to Windows", kind)
        self._tray.icon.showMessage("Guild Board", text)

    @Slot()
    def _on_message_clicked(self) -> None:
        place = place_of(self._message_kind)
        if place is not None and self._dashboard is not None:
            self._hidden = False
            self._open_dashboard(place)

    # ---- the overlay: a window of Guild Board's own over the game's display, and its hotkey

    def _start_overlay(self, link: str) -> None:
        """At ready: the overlay's window on its display and its hotkey held with Windows, both reported to the core
        for the Overlay settings. The window shows, closed, if the game runs already."""
        self._overlay = self._windows.overlay(link)
        self._overlay.closed.connect(self._on_overlay_closed)
        self._overlay.set_full_screen_game((self._settings or Settings()).overlay_full_screen)
        self._place_overlay()
        self._hotkey = self._windows.hotkey()
        self._hotkey.pressed.connect(self._on_hotkey)
        self._hotkey_filter = HotkeyFilter(self._hotkey.pressed.emit)
        QCoreApplication.instance().installNativeEventFilter(self._hotkey_filter)
        self._hold_hotkey()
        self._watch_displays()
        self._report_overlay()
        self._call_quietly(
            "reading whether the game runs", lambda core: core.status()["game"]["running"], then=self._on_game_at_start
        )

    def _stop_overlay(self) -> None:
        """As Guild Board ends: the overlay goes first, so that nothing stays over the game taking its clicks. Then
        Windows lets go of the hotkey, and nothing listens for it or for the displays any more."""
        if self._overlay is not None:
            self._overlay.hide_overlay()
        if self._hotkey is not None:
            self._hotkey.unregister()
        if self._hotkey_filter is not None:
            QCoreApplication.instance().removeNativeEventFilter(self._hotkey_filter)
            self._hotkey_filter = None
        self._unwatch_displays()

    def _watch_displays(self) -> None:
        """Hears of every change of the displays: one plugged in or out, a new main display, and a new resolution or
        arrangement of a display that stays, which only that display tells of."""
        application = QGuiApplication.instance()
        application.screenAdded.connect(self._on_screen_added)
        application.screenRemoved.connect(self._on_screen_removed)
        application.primaryScreenChanged.connect(self._on_displays_changed)
        self._watching_displays = True
        for screen in QGuiApplication.screens():
            self._watch_screen(screen)

    def _unwatch_displays(self) -> None:
        if self._watching_displays:
            application = QGuiApplication.instance()
            application.screenAdded.disconnect(self._on_screen_added)
            application.screenRemoved.disconnect(self._on_screen_removed)
            application.primaryScreenChanged.disconnect(self._on_displays_changed)
            self._watching_displays = False
        for screen in list(self._watched_screens):
            self._unwatch_screen(screen)

    def _watch_screen(self, screen: QScreen) -> None:
        if screen not in self._watched_screens:
            screen.geometryChanged.connect(self._on_displays_changed)
            self._watched_screens.append(screen)

    def _unwatch_screen(self, screen: QScreen) -> None:
        if screen in self._watched_screens:
            screen.geometryChanged.disconnect(self._on_displays_changed)
            self._watched_screens.remove(screen)

    def _place_overlay(self) -> None:
        """Covers the display the settings name, or the main display when that one is not there."""
        primary = QGuiApplication.primaryScreen()
        if primary is None:  # no display at all, for a moment while the setup changes
            return
        name = (self._settings or Settings()).overlay_display
        self._cover(screen_for(QGuiApplication.screens(), name, primary))

    def _cover(self, screen: QScreen) -> None:
        """The overlay over all of the display, at the size chosen in the settings. The page takes it without loading
        again."""
        self._overlay.place_on(screen)
        self._overlay.set_zoom(zoom_for((self._settings or Settings()).overlay_size))

    def _hold_hotkey(self) -> None:
        """Asks Windows for the overlay's hotkey. When another program holds it, Guild Board holds none, and the
        Overlay settings say so."""
        hotkey = parse_hotkey((self._settings or Settings()).overlay_hotkey)
        if hotkey is None:  # the settings keep only a hotkey that can be read
            self._hotkey.unregister()
            self._hotkey_state = "none"
        elif self._hotkey.register(hotkey):
            self._hotkey_state = "held"
            self._hotkey_refused = None
        else:
            self._hotkey_state = "taken"
            # Asked for again with every settings change while another program holds it: the log tells of it once.
            if hotkey != self._hotkey_refused:
                self._hotkey_refused = hotkey
                log.warning("Windows refused the overlay's hotkey %s; another program may hold it", hotkey.text)

    def _report_overlay(self) -> None:
        """Tells the core what the Overlay settings show: the displays there are, and whether the hotkey is held."""
        displays = display_list(QGuiApplication.screens(), QGuiApplication.primaryScreen())
        state = self._hotkey_state
        self._call_quietly("the overlay's report", lambda core: core.overlay_shell(displays, state))

    @Slot()
    def _on_hotkey(self) -> None:
        if self._overlay is None or self._ending:
            return
        if self._overlay.is_open:
            self._overlay.close_overlay()
        elif self._settings is not None and self._settings.risk_acknowledged:
            # Until the player has read the risk statement the overlay's page shows nothing: an open overlay would be an
            # empty layer taking the game's clicks.
            self._overlay.open()

    @Slot(bool)
    def _on_game(self, running: bool) -> None:
        # The window shows, closed, while the game runs, and hides when it stops. An open overlay stays as it is.
        self._game_running = running
        if self._ending or self._overlay is None or self._overlay.is_open:
            return
        if running:
            self._overlay.show_closed()
        else:
            self._overlay.hide_overlay()

    def _on_game_at_start(self, running: bool) -> None:
        # Whether the game ran when the core was ready. Its start, heard later, shows the window as well.
        if running:
            self._on_game(True)

    @Slot()
    def _on_overlay_closed(self) -> None:
        if not self._game_running and self._overlay is not None:
            self._overlay.hide_overlay()  # nothing to show over: the game does not run

    def _show_pinned_setting(self) -> None:
        # The tick changed with the click, and the setting did not.
        if self._tray is not None:
            self._tray.show_pinned((self._settings or Settings()).overlay_pinned)

    def _to_main_display(self) -> None:
        """The tray's "Move the overlay to the main display": it goes there now, also when the setting names the main
        display already, and the setting keeps it there."""
        self._call_quietly(
            "the tray item Move the overlay to the main display",
            lambda core: core.update_settings({"overlay_display": ""}),
        )
        primary = QGuiApplication.primaryScreen()
        if self._overlay is not None and primary is not None:
            self._cover(primary)

    @Slot(QScreen)
    def _on_screen_added(self, screen: QScreen) -> None:
        self._watch_screen(screen)
        self._on_displays_changed()

    @Slot(QScreen)
    def _on_screen_removed(self, screen: QScreen) -> None:
        self._unwatch_screen(screen)  # Qt deletes it next
        self._on_displays_changed()

    def _on_displays_changed(self, *_changed: object) -> None:
        # Windows tells of a new main display at once, and of the displays' new geometries a moment later: the overlay
        # follows once Qt has handled what is pending, and once for changes that come together.
        if not self._displays_pending:
            self._displays_pending = True
            QTimer.singleShot(0, self, self._follow_displays)

    def _follow_displays(self) -> None:
        """The overlay goes where its setting says, or to the main display, and the Overlay settings hear of the
        displays there are now."""
        self._displays_pending = False
        if self._overlay is None or self._ending:
            return
        self._place_overlay()
        self._report_overlay()


def _started_by_the_shortcut(folder: Path) -> bool:
    """The Startup shortcut carries no arguments, so it starts Guild Board on the standard folder only, as Windows
    names it."""
    try:
        return folder.resolve() == shortcut_data_dir().resolve()
    except OSError:
        return False


COLLECTION_FLAG = "--js-flags=--expose-gc-as=gbCollect"
# Qt WebEngine holds its window at 60 frames a second on any monitor, and no switch sets another rate; this one takes the
# limit away, and Qt then draws at the monitor's rate (163 a second on a 165 Hz screen, measured on 2026-11-02). The engine
# also computes far more than it shows while anything moves (1,700 a second, about three cores in a nonstop test; 51 to
# 117% of a core walking the demo's pages; nothing more at rest) and the switch is the whole engine's, the map and the
# overlay included, so it stays the player's choice, off by default.
FRAME_LIMIT_FLAG = "--disable-frame-rate-limit"
# What a Guild Board on the player's own data never takes from the environment it was started in (L31): every switch of
# the engine's (QTWEBENGINE_CHROMIUM_FLAGS), since a list of the dangerous ones is never whole, and these two of Qt's: its
# remote debugging, an unauthenticated endpoint on 127.0.0.1 through which any program of any account on the PC could
# read the map's cookies, and the sandbox's switch-off. The demo keeps them, for the window checks, which attach to it
# on made-up data.
UNSAFE_VARIABLES = ("QTWEBENGINE_REMOTE_DEBUGGING", "QTWEBENGINE_DISABLE_SANDBOX")


def configure_qt(*, demo: bool = False, smooth: bool = False) -> list[str]:
    """Before Qt starts: on a real display Qt would save its graphics pipelines in a folder of its own,
    %LOCALAPPDATA%\\Guild Board\\cache, outside the data folder (H1). Guild Board keeps no such cache.
    It draws with Windows' default, Direct3D: with OpenGL the map moved without black squares, but the overlay's
    window was no longer see-through and covered the game.
    Qt WebEngine 140 does not collect a page's old documents by itself, and the window grew 10 to 25 MB with each page
    change (measured on 2026-10-30, the Characters design, 11.7): the flag lets the interface ask for it (ui/collect.ts).
    The flag is the whole engine's, so HoYoverse's pages in the login, the verify page and the map can ask for a
    collection too: an exception tests/test_handsoff.py records with its reason (L30). Its name is a private one, so that
    a page that looks for the well-known `gc` does not find it.
    Outside the demo, the engine starts with the shell's own switch alone, and without Qt's debugging and sandbox
    switch-off: what was left out is given back by name, for the log, which opens later. A switch's value is not
    given: it could hold anything, so a word that is no switch (starts with neither "-" nor "/") is only counted.
    `smooth` is the player's Smooth animations (FRAME_LIMIT_FLAG), read once here, so a change takes effect at the next start."""
    os.environ["QSG_RHI_DISABLE_DISK_CACHE"] = "1"
    flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "").split()
    left_out: list[str] = []
    if not demo:
        left_out = [name for name in UNSAFE_VARIABLES if os.environ.pop(name, None) is not None]
        inherited = [flag for flag in flags if flag != COLLECTION_FLAG]
        left_out += [flag.partition("=")[0] for flag in inherited if flag.startswith(("-", "/"))]
        values = sum(1 for flag in inherited if not flag.startswith(("-", "/")))  # a switch's separate value
        if values:
            left_out.append(f"{values} other {'word' if values == 1 else 'words'}")
        flags = []
    if COLLECTION_FLAG not in flags:
        flags.append(COLLECTION_FLAG)
    if smooth and FRAME_LIMIT_FLAG not in flags:
        flags.append(FRAME_LIMIT_FLAG)
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = " ".join(flags)
    QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_DisableShaderDiskCache, True)
    return left_out


def run_shell(
    paths: AppPaths,
    *,
    demo: bool,
    hidden: bool = False,
    acknowledged: bool = False,
    quit: bool = False,
    demo_now: datetime | None = None,
    invite: str | None = None,
) -> int:
    left_out = configure_qt(demo=demo, smooth=load_settings(paths.settings_path).smooth_animations)
    app = QApplication.instance() or QApplication([sys.argv[0]])
    app.setApplicationName("Guild Board")
    app.setQuitOnLastWindowClosed(False)
    app.setWindowIcon(app_icon())
    guard = InstanceGuard(paths.data_dir)
    outcome = claim(guard, quit=quit, show=SHOW if invite is None else invite_message(invite))
    if outcome in ("shown", "quit"):
        return 0
    if outcome == "not_answering" and not quit:
        Desktop().alert(NOT_ANSWERING)
        return 1
    if outcome != "run":
        print(QUIT_MESSAGES[outcome])
        return 0 if outcome == "not_running" else 1
    # Opened only by the start that runs: a later start would write into the running Guild Board's log.
    setup_logging(paths.logs_dir)
    if left_out:
        log.warning("These inherited settings of the browser engine were left out: %s", ", ".join(left_out))
    if guard.listen_error is not None:
        log.warning("Could not listen for later starts: %s", guard.listen_error)
    # Start with Windows follows the setting of the folder its shortcut starts. The demo, and a Guild Board on any other
    # folder, leave the player's shortcut alone.
    keeps_startup = not demo and _started_by_the_shortcut(paths.data_dir)
    startup = Shortcut(startup_folder(), launcher("guildboard-tray.exe")) if keeps_startup else None
    shell = ShellApp(paths, demo=demo, hidden=hidden, acknowledged=acknowledged, demo_now=demo_now, startup=startup)

    def end(code: int) -> None:
        guard.stop_listening()  # while this one ends, a later start waits for the folder instead of asking it
        app.exit(code)

    shell.ended.connect(end)
    guard.activated.connect(shell.show_window)
    guard.quit_requested.connect(shell.quit)
    guard.invite_requested.connect(shell.take_invite)
    if invite is not None:
        shell.take_invite(invite)
    try:
        shell.start()
        return app.exec()
    finally:
        shell.stop()
        guard.release()
        shell.relaunch()  # only now: the new one finds the folder free and the core stopped
