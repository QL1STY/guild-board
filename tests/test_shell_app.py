import asyncio
import logging
import os
import subprocess
import sys
import threading
import urllib.error
from pathlib import Path
from types import SimpleNamespace

import pytest
from PySide6.QtCore import SIGNAL, QCoreApplication, QEvent, QObject, QRect, Qt, QUrl, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtWidgets import QLabel, QSystemTrayIcon, QWidget

from guildboard import core as core_module, netpolicy
from guildboard.backups import GAME_FOLDER, BackupRefused
from guildboard.config import AppPaths, Settings, save_settings, standard_data_dir
from guildboard.pulls.banners import ANN_CONTENT_URL, ANN_LIST_URL
from guildboard.pulls.wiki import WIKI_URL
from guildboard.sources.hoyolab import LIVESTREAM_URL
from guildboard.core import Core
from guildboard.hotkeys import parse_hotkey
from guildboard.shell import app as app_module
from guildboard.shell.app import ShellApp, Windows, configure_qt, display_list
from guildboard.shell.hotkey import HOTKEY_ID, GlobalHotkey
from guildboard.shell.overlay import OverlayWindow
from guildboard.shell.startup import SHORTCUT_NAME, Shortcut, launcher
from guildboard.tokenstore import StoredToken, TokenStore
from support import FakeGuard, FakeUser32
from test_shell_maphost import StubEngine, StubView as MapStubView
from test_shell_overlay_window import StubPage as OverlayStubPage

COOKIES = {"ltoken_v2": "v2_FAKE-TOKEN", "ltuid_v2": "42", "ltmid_v2": "fake_mid"}
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x0001, 0x0002, 0x0004, 0x4000


class StubView(QLabel):
    """Stands in for the browser view: it records what it was asked to load. The overlay's window listens to it as
    well: there, the launch lands on #/overlay and its page has loaded at once."""

    urlChanged = Signal(QUrl)
    loadFinished = Signal(bool)

    def __init__(self, parent: QWidget, origin: str) -> None:
        super().__init__(parent)
        self.origin = origin
        self.loaded: list[str] = []
        self.zooms: list[float] = []
        self._url = QUrl()
        self._page = OverlayStubPage(self)  # the overlay stops its page while it is hidden

    def page(self) -> OverlayStubPage:
        return self._page

    def load(self, url: QUrl) -> None:
        self.loaded.append(url.toString())

    def setZoomFactor(self, factor: float) -> None:  # noqa: N802
        self.zooms.append(factor)

    def zoomFactor(self) -> float:  # noqa: N802
        return self.zooms[-1] if self.zooms else 1.0

    def setUrl(self, url: QUrl) -> None:  # noqa: N802
        self.load(url)
        if url.hasFragment():
            self._url = QUrl(url)
        else:
            self._url = QUrl(self.origin + "/#/overlay")
            self.loadFinished.emit(True)

    def url(self) -> QUrl:
        return QUrl(self._url)


class StubLogin(QWidget):
    """Stands in for the login window, which would load HoYoLAB's page."""

    captured = Signal(dict)
    retry = Signal()
    paste_requested = Signal()
    closed = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.started = 0

    def start(self) -> None:
        self.started += 1

    def show_message(self, text: str, can_retry: bool = False) -> None:
        pass


class StubVerify(QWidget):
    """Stands in for the verification window, which would load HoYoLAB's page."""

    closed = Signal()

    def __init__(self, cookies) -> None:  # noqa: ANN001
        super().__init__()
        self.cookies = dict(cookies)

    def start(self) -> None:
        self.show()

    def closeEvent(self, event) -> None:  # noqa: N802, ANN001
        super().closeEvent(event)
        self.closed.emit()


class FakeDesktop:
    def __init__(self, tray: bool) -> None:
        self.tray = tray
        self.folders: list[Path] = []
        self.demos = 0
        self.alerts: list[str] = []
        self.offered: list[str] = []  # the file names the Save dialog offered
        self.chosen: str | None = None  # what the Save dialog gives: a path, or None when cancelled
        self.restarts = 0

    def tray_available(self) -> bool:
        return self.tray

    def open_folder(self, folder: Path) -> None:
        self.folders.append(folder)

    def open_demo(self) -> None:
        self.demos += 1

    def alert(self, text: str) -> None:
        self.alerts.append(text)

    def choose_backup_file(self, name: str) -> str | None:
        self.offered.append(name)
        return self.chosen

    def start_again(self) -> None:
        self.restarts += 1


@pytest.fixture
def user32() -> FakeUser32:
    """Windows' user32 for the shells a test starts: a stand-in, so that no test takes the player's Ctrl+Alt+G."""
    return FakeUser32()


@pytest.fixture
def asked() -> list[tuple[str, bool]]:
    """Each request the shells' cores make, and whether the player had given the first run's consent at that moment, as
    the `shell` fixture records them: a live core asks for HoYoverse's announcements, the livestream codes and the HoYoLAB
    wiki's lists (the Characters design, H6) once the player has, and for nothing else on its own (ruling R15)."""
    return []


@pytest.fixture
def shell(tmp_path, monkeypatch, user32, asked):
    started: list[ShellApp] = []
    made: list[QWidget] = []
    overlays: list[OverlayWindow] = []

    def consented() -> bool:
        """Whether the player has given the consent, as the shell's core holds it in memory: read here, on the thread of
        the request, without opening settings.json, which the core may be replacing at that moment on its own."""
        cores = [app._thread.core for app in started]
        return any(core is not None and core.settings.risk_acknowledged for core in cores)

    def refuse(request, timeout=None):  # stands in for the network: nothing is sent
        asked.append((request.full_url, consented()))
        raise urllib.error.URLError("the tests contact nothing")

    monkeypatch.setattr(netpolicy, "_open", refuse)

    def keep(window: QWidget) -> QWidget:
        made.append(window)
        return window

    def overlay(link: str) -> OverlayWindow:
        overlays.append(OverlayWindow(link, make_view=StubView))
        return overlays[-1]

    def start(  # noqa: ANN202
        *, demo=False, hidden=False, acknowledged=False, tray=True, startup=None, game=False, statement_read=True,  # noqa: ANN001
    ):
        # The game runs only when the test says so, whatever runs on the player's PC.
        names = {"genshinimpact.exe"} if game else set()
        monkeypatch.setattr(core_module, "list_process_names", lambda: set(names))
        # As for a player who has read the risk statement, unless the test says otherwise or keeps its own settings:
        # only then does the hotkey open the overlay.
        paths = AppPaths(tmp_path / "data")
        if statement_read and not demo and not paths.settings_path.exists():
            paths.ensure()
            save_settings(paths.settings_path, Settings(risk_acknowledged=True))
        desktop = FakeDesktop(tray)
        windows = Windows(
            view=StubView,
            login=lambda: keep(StubLogin()),
            verify=lambda cookies: keep(StubVerify(cookies)),
            overlay=overlay,
            hotkey=lambda: GlobalHotkey(user32),
            map_engine=StubEngine,
        )
        app = ShellApp(
            AppPaths(tmp_path / "data"), demo=demo, hidden=hidden, acknowledged=acknowledged,
            desktop=desktop, windows=windows, startup=startup,
        )
        started.append(app)
        app.start()
        return app, desktop, made

    yield start
    for app in started:
        app.stop()
    # No overlay outlives its test, where it would still hear of every change of the focus.
    for window in overlays:
        window.deleteLater()
    QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
    # the livestream codes too, and the wiki's lists
    announcements = (ANN_LIST_URL, ANN_CONTENT_URL, LIVESTREAM_URL.partition("?")[0], WIKI_URL)
    assert [url for url, consent in asked if not consent or url.partition("?")[0] not in announcements] == []


def _window(qtbot, app: ShellApp):  # noqa: ANN001, ANN202
    qtbot.waitUntil(lambda: app.dashboard() is not None, timeout=30_000)
    return app.dashboard()


def test_the_requests_recorder_takes_the_consent_from_the_cores_memory(qtbot, shell, asked, tmp_path):
    # The recorder runs on the thread of the request, while the core may be replacing settings.json on its own: it takes
    # the consent from the core's settings in memory, never from the file. Here the file says otherwise.
    app, _, _ = shell()
    _window(qtbot, app)
    save_settings(AppPaths(tmp_path / "data").settings_path, Settings())  # no consent on disk; the core holds it
    app.call(lambda core: core.banners.refresh(force=True)).result(10)
    assert asked and all(consent for _, consent in asked)


def test_guild_board_opens_its_window_on_the_interface(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    assert window.isVisible()
    assert window.windowTitle() == "Guild Board"
    [link] = window.view().loaded
    assert link.startswith("http://127.0.0.1:") and "/launch?k=" in link
    assert app.tray() is not None
    assert app.call(lambda core: core.status()["has_tray"]).result(5) is True  # the interface's hint says so


def test_started_hidden_only_the_tray_is_there_until_it_is_clicked(qtbot, shell):
    app, _, _ = shell(hidden=True)
    window = _window(qtbot, app)
    assert not window.isVisible()
    app.tray().icon.activated.emit(QSystemTrayIcon.ActivationReason.Trigger)
    assert window.isVisible()


def test_started_hidden_without_a_tray_the_window_opens_anyway(qtbot, shell):
    app, _, _ = shell(hidden=True, tray=False)
    assert _window(qtbot, app).isVisible()


def test_a_core_that_cannot_start_says_why_and_guild_board_ends(qtbot, shell, tmp_path):
    Core(AppPaths(tmp_path / "data"), demo=True).store.close()  # the folder holds the demo's data
    app, desktop, _ = shell()
    with qtbot.waitSignal(app.ended, timeout=30_000) as ended:
        pass
    assert ended.args == [1]
    assert desktop.alerts == [
        f"{tmp_path / 'data'} holds the demo's made-up data. Your real history needs a folder of its own."
    ]
    assert app.dashboard() is None


def test_without_a_tray_closing_the_window_ends_guild_board(qtbot, shell):
    app, _, _ = shell(tray=False)
    window = _window(qtbot, app)
    with qtbot.waitSignal(app.ended) as ended:
        window.close()
    assert ended.args == [0]


def test_the_demo_has_no_tray_and_ends_when_its_window_closes(qtbot, shell):
    app, _, _ = shell(demo=True)
    window = _window(qtbot, app)
    assert app.tray() is None
    assert app.call(lambda core: core.status()["has_tray"]).result(5) is False
    assert window.windowTitle() == "Guild Board - demo data"
    with qtbot.waitSignal(app.ended):
        window.close()


def test_the_demo_opened_from_the_first_run_skips_the_statement(qtbot, shell):
    app, _, _ = shell(demo=True, acknowledged=True)
    _window(qtbot, app)
    assert app.call(lambda core: core.settings.risk_acknowledged).result(5)


def test_the_first_close_to_the_tray_marks_the_hint_as_seen(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    assert not app.call(lambda core: core.settings.tray_hint_shown).result(5)
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    qtbot.waitUntil(lambda: app.call(lambda core: core.settings.tray_hint_shown).result(5))


def _shown_messages(app: ShellApp) -> list[tuple[str, str]]:
    """What the tray icon shows from now on, recorded instead of shown on the screen."""
    shown: list[tuple[str, str]] = []
    app.tray().icon.showMessage = lambda title, text, *rest: shown.append((title, text))
    return shown


def test_a_reminder_from_the_core_is_a_tray_notification(qtbot, shell):
    app, _, _ = shell()
    _window(qtbot, app)
    shown = _shown_messages(app)
    assert app.call(lambda core: core.notify("reminder", "Unusual Hilichurl is ready.")).result(5) is True
    qtbot.waitUntil(lambda: shown == [("Guild Board", "Unusual Hilichurl is ready.")])


def test_clicking_a_reminder_opens_the_timers_category(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    shown = _shown_messages(app)
    app.call(lambda core: core.notify("reminder", "Unusual Hilichurl is ready.")).result(5)
    qtbot.waitUntil(lambda: len(shown) > 0)
    app.tray().icon.messageClicked.emit()
    assert window.view().loaded[-1].endswith("/#/achievements/timers")


def test_clicking_a_reminder_about_quick_timers_alone_opens_the_board(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    shown = _shown_messages(app)
    app.call(lambda core: core.notify("quick", "Quick timer · 5 min is ready.")).result(5)
    qtbot.waitUntil(lambda: len(shown) > 0)
    app.tray().icon.messageClicked.emit()
    assert window.view().loaded[-1].endswith("/#/board")


INVITE_CODE = "abcDEF0123456789_-abcdef"


def test_an_invite_link_shows_friends_and_the_core_hears_of_it(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    app.take_invite(INVITE_CODE)
    assert window.view().loaded[-1].endswith("/#/friends")
    # The player is signed out here, so the code waits for the sign-in, and nothing was sent.
    qtbot.waitUntil(lambda: app.call(lambda core: core.online._invite_code).result(5) == INVITE_CODE)


def test_an_invite_link_that_starts_guild_board_opens_it_on_friends(qtbot, shell):
    app, _, _ = shell(hidden=True)  # the tray start: an opened link shows the window all the same
    app.take_invite(INVITE_CODE)
    window = _window(qtbot, app)
    assert window.view().loaded[0].endswith("&to=friends")  # once, as the launch link: a second load would lose the cookie
    assert len(window.view().loaded) == 1
    qtbot.waitUntil(lambda: app.call(lambda core: core.online._invite_code).result(5) == INVITE_CODE)


def test_a_click_on_the_tray_hint_opens_no_category(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    shown = _shown_messages(app)
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    qtbot.waitUntil(lambda: len(shown) > 0)  # the tray hint, the first time the window closes to the tray
    app.tray().icon.messageClicked.emit()
    assert window.view() is None and not window.isVisible()  # it opened nothing


def test_a_shell_without_a_tray_shows_no_reminder(qtbot, shell):
    app, _, _ = shell(tray=False)
    _window(qtbot, app)
    assert app.call(lambda core: core.notify("reminder", "Unusual Hilichurl is ready.")).result(5) is False


def test_the_interface_opens_the_data_folder_the_demo_and_the_login(qtbot, shell, tmp_path):
    app, desktop, made = shell()
    _window(qtbot, app)
    for kind in ("data_folder", "demo", "login"):
        assert app.call(lambda core, kind=kind: core.request_window(kind)).result(5)
    qtbot.waitUntil(lambda: len(made) == 1)
    assert desktop.folders == [tmp_path / "data"]
    assert desktop.demos == 1
    assert made[0].started == 1


def test_exporting_a_backup_saves_where_the_player_chose_and_a_cancel_saves_nothing(qtbot, shell, tmp_path):
    app, desktop, _ = shell()
    _window(qtbot, app)
    assert app.call(lambda core: core.request_window("export_backup")).result(5)
    qtbot.waitUntil(lambda: len(desktop.offered) == 1)
    assert desktop.offered[0].startswith("Guild Board backup 20") and desktop.offered[0].endswith(".gbbackup")
    exports: list[object] = []
    app.call(lambda core: setattr(core, "export_backup", lambda target: exports.append(target))).result(5)
    desktop.chosen = None  # cancelled
    assert app.call(lambda core: core.request_window("export_backup")).result(5)
    qtbot.waitUntil(lambda: len(desktop.offered) == 2)
    app.call(lambda core: None).result(5)
    assert exports == []  # a cancelled dialog exports nothing
    app.call(lambda core: delattr(core, "export_backup")).result(5)
    exported = tmp_path / "chosen" / "x.gbbackup"
    exported.parent.mkdir()  # the Save dialog gives a place in a folder that is there; the export makes none
    desktop.chosen = str(exported)
    assert app.call(lambda core: core.request_window("export_backup")).result(5)
    qtbot.waitUntil(exported.is_file)
    assert not list((tmp_path / "chosen").glob("*.gbbackup.tmp"))


def test_a_refused_backup_export_says_why_and_another_failure_says_it_could_not_be_saved(qtbot, shell, tmp_path):
    app, desktop, _ = shell()
    _window(qtbot, app)
    told: list[tuple[str, str]] = []
    app._on_notify = lambda kind, text: told.append((kind, text))
    desktop.chosen = str(tmp_path / "x.gbbackup")

    def refuse(core):
        def export(target):
            raise BackupRefused(GAME_FOLDER)

        core.export_backup = export

    def break_down(core):
        def export(target):
            raise OSError("disk full")

        core.export_backup = export

    app.call(refuse).result(5)
    assert app.call(lambda core: core.request_window("export_backup")).result(5)
    qtbot.waitUntil(lambda: len(told) == 1)
    assert told == [("backup", GAME_FOLDER)]
    app.call(break_down).result(5)
    assert app.call(lambda core: core.request_window("export_backup")).result(5)
    qtbot.waitUntil(lambda: len(told) == 2)
    assert told[1] == ("backup", "The backup could not be saved.")


def test_restarting_starts_guild_board_again_only_after_it_has_stopped(qtbot, shell):
    app, desktop, _ = shell()
    _window(qtbot, app)
    ended: list[int] = []
    app.ended.connect(ended.append)
    assert app.call(lambda core: core.request_window("restart")).result(5)
    qtbot.waitUntil(lambda: ended == [0])
    assert desktop.restarts == 0  # not while it is stopping
    app.stop()
    app.relaunch()
    assert desktop.restarts == 1


def test_without_a_restart_request_nothing_starts_again(qtbot, shell):
    app, desktop, _ = shell()
    _window(qtbot, app)
    app.stop()
    app.relaunch()
    assert desktop.restarts == 0


def test_verifying_opens_the_page_with_the_stored_login_and_closing_it_lets_syncing_go_on(qtbot, shell, tmp_path):
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    save_settings(paths.settings_path, Settings(sync_paused=True, risk_acknowledged=True))  # no sync reaches HoYoLAB
    TokenStore(paths.token_path).save(StoredToken(COOKIES, 700000001, "os_euro", "Traveler"))
    app, _, made = shell()
    _window(qtbot, app)
    cleared: list[bool] = []
    app.call(lambda core: setattr(core, "verification_done", lambda: cleared.append(True))).result(5)
    assert app.call(lambda core: core.request_window("verify")).result(5)
    qtbot.waitUntil(lambda: len(made) == 1)
    assert made[0].cookies == COOKIES
    made[0].close()
    qtbot.waitUntil(lambda: cleared == [True])


def test_the_tray_pause_item_follows_the_setting(qtbot, shell):
    app, _, _ = shell()
    _window(qtbot, app)
    app.call(lambda core: core.set_paused(True)).result(5)
    pause = [action for action in app.tray().menu().actions() if not action.isSeparator()][2]
    qtbot.waitUntil(lambda: pause.text() == "Resume syncing")


def _disk_full(*args: object) -> None:
    raise OSError("the disk is full")


def test_a_tray_item_whose_call_fails_inside_the_core_is_logged(qtbot, shell, caplog):
    app, _, _ = shell()
    _window(qtbot, app)
    app.call(lambda core: setattr(core.scheduler, "request", _disk_full)).result(5)
    app.call(lambda core: setattr(core, "set_paused", _disk_full)).result(5)
    items = {action.text(): action for action in app.tray().menu().actions()}
    failed = ("the tray item Sync now failed", "the tray item Pause syncing failed")
    with caplog.at_level(logging.ERROR):
        items["Sync now"].trigger()
        items["Pause syncing"].trigger()
        qtbot.waitUntil(lambda: all(line in caplog.text for line in failed))
    assert "OSError: the disk is full" in caplog.text  # the log holds the error as well


def test_a_tray_items_call_that_the_stop_cancels_is_not_a_failure(qtbot, shell, caplog):
    app, _, _ = shell()
    _window(qtbot, app)
    running = threading.Event()

    async def wait_for_ever(kind: str) -> None:
        running.set()
        await asyncio.Event().wait()

    app.call(lambda core: setattr(core.scheduler, "request", wait_for_ever)).result(5)
    sync_now = next(action for action in app.tray().menu().actions() if action.text() == "Sync now")
    with caplog.at_level(logging.INFO):
        sync_now.trigger()
        qtbot.waitUntil(running.is_set)
        app.stop()  # the core cancels the call it is still running
        qtbot.waitUntil(lambda: "a call into the core was cancelled because the core stopped" in caplog.text)
    assert "the tray item Sync now failed" not in caplog.text


def test_a_call_that_fails_inside_the_core_when_the_verification_closes_is_logged(qtbot, shell, tmp_path, caplog):
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    save_settings(paths.settings_path, Settings(sync_paused=True, risk_acknowledged=True))  # no sync reaches HoYoLAB
    TokenStore(paths.token_path).save(StoredToken(COOKIES, 700000001, "os_euro", "Traveler"))
    app, _, made = shell()
    _window(qtbot, app)
    app.call(lambda core: setattr(core, "verification_done", _disk_full)).result(5)
    assert app.call(lambda core: core.request_window("verify")).result(5)
    qtbot.waitUntil(lambda: len(made) == 1)
    with caplog.at_level(logging.ERROR):
        made[0].close()
        qtbot.waitUntil(lambda: "the call that ends the verification failed" in caplog.text)
    assert "OSError: the disk is full" in caplog.text  # the log holds the error as well


def test_a_call_that_fails_inside_the_core_when_the_tray_hint_is_marked_is_logged(qtbot, shell, caplog):
    app, _, _ = shell()
    window = _window(qtbot, app)
    app.call(lambda core: setattr(core, "update_settings", _disk_full)).result(5)
    with caplog.at_level(logging.ERROR):
        window.close()  # the first close to the tray marks the hint as seen
        qtbot.waitUntil(lambda: "the call that marks the tray hint as seen failed" in caplog.text)
    assert "OSError: the disk is full" in caplog.text


def test_a_call_made_while_the_core_is_not_running_is_named_in_the_log(qtbot, tmp_path, caplog):
    # Never started: the core is not running, and nothing of Guild Board runs.
    app = ShellApp(
        AppPaths(tmp_path / "data"), demo=False, desktop=FakeDesktop(tray=False), windows=Windows(view=StubView)
    )
    window = QWidget()
    with caplog.at_level(logging.WARNING):
        app._on_verify_closed(window)
    assert "the core is not running, so the call that ends the verification was dropped" in caplog.text


def test_start_with_windows_follows_the_setting(qtbot, shell, tmp_path):
    target = tmp_path / "Scripts" / "guildboard-tray.exe"
    target.parent.mkdir()
    target.write_bytes(b"MZ")
    shortcut = tmp_path / "Startup" / SHORTCUT_NAME
    app, _, _ = shell(startup=Shortcut(tmp_path / "Startup", target))
    _window(qtbot, app)
    app.call(lambda core: core.update_settings({"start_with_windows": True})).result(5)
    qtbot.waitUntil(shortcut.exists)
    app.call(lambda core: core.update_settings({"start_with_windows": False})).result(5)
    qtbot.waitUntil(lambda: not shortcut.exists())


def test_quitting_ends_guild_board_and_keeps_where_the_window_was(qtbot, shell, tmp_path):
    app, _, _ = shell()
    _window(qtbot, app)
    with qtbot.waitSignal(app.ended) as ended:
        app.tray().menu().actions()[-1].trigger()  # Quit
    assert ended.args == [0]
    assert (tmp_path / "data" / "window.json").exists()


# ---------------------------------------------------------------- the overlay

def _overlay_status(app: ShellApp) -> dict:
    return app.call(lambda core: core.overlay_status()).result(5)


def _game(app: ShellApp, running: bool) -> None:
    """The core tells its game listeners that the game started or stopped, as its watch of the process list does, and
    Qt hears it."""
    app.call(lambda core: [listener(running) for listener in list(core.game_listeners)]).result(5)
    QCoreApplication.processEvents()


def _reports(app: ShellApp) -> list[tuple[list, str]]:
    """Each report the shell makes to the core from now on: the displays, and the hotkey's state."""
    reports: list[tuple[list, str]] = []

    def watch(core: Core) -> None:
        report = core.overlay_shell

        def recorded(displays: list, state: str) -> None:
            reports.append((displays, state))
            report(displays, state)

        core.overlay_shell = recorded

    app.call(watch).result(5)
    return reports


def _click_through(overlay: OverlayWindow) -> bool:
    return bool(overlay.windowFlags() & Qt.WindowType.WindowTransparentForInput)


def test_the_demo_makes_no_overlay_and_no_hotkey(qtbot, shell, user32):
    app, _, _ = shell(demo=True)
    _window(qtbot, app)
    assert app.overlay() is None and app.hotkey() is None
    assert user32.calls == []
    assert _overlay_status(app)["available"] is False  # the Overlay settings say there is none


def test_a_hotkey_held_elsewhere_is_reported_taken(qtbot, shell, user32):
    user32.taken = frozenset({ord("G")})  # another program holds Ctrl+Alt+G
    app, _, _ = shell()
    _window(qtbot, app)
    qtbot.waitUntil(lambda: _overlay_status(app)["available"])
    status = _overlay_status(app)
    assert (status["hotkey"], status["hotkey_state"]) == ("Ctrl+Alt+G", "taken")
    assert app.hotkey().held is None
    main = QGuiApplication.primaryScreen()
    size = main.geometry().size()
    assert status["displays"] == [
        {"name": main.name(), "label": f"Display 1, {size.width()} × {size.height()}, main", "primary": True}
    ]
    _game(app, True)
    assert app.overlay().isVisible()  # nothing else breaks: the overlay shows over the game


def test_the_game_starting_shows_the_closed_overlay_and_stopping_hides_it(qtbot, shell):
    app, _, _ = shell()
    _window(qtbot, app)
    overlay = app.overlay()
    assert overlay.geometry() == QGuiApplication.primaryScreen().geometry()  # all of the main display
    assert not overlay.isVisible()  # the game does not run
    _game(app, True)
    assert overlay.isVisible() and not overlay.is_open and _click_through(overlay)
    frozen, active = QWebEnginePage.LifecycleState.Frozen, QWebEnginePage.LifecycleState.Active
    _game(app, False)
    assert not overlay.isVisible() and overlay.view().page().lifecycleState() == frozen  # its page waits (SHL-9)
    _game(app, True)
    assert overlay.isVisible() and overlay.view().page().lifecycleState() == active
    _game(app, False)
    # An open overlay stays as it is when the game starts or stops.
    app.hotkey().pressed.emit()
    _game(app, True)
    assert overlay.is_open
    _game(app, False)
    assert overlay.is_open and overlay.isVisible()


def test_the_game_running_at_the_start_shows_the_closed_overlay(qtbot, shell):
    app, _, _ = shell(game=True)
    _window(qtbot, app)
    overlay = app.overlay()
    qtbot.waitUntil(overlay.isVisible)
    assert not overlay.is_open and _click_through(overlay)


def test_a_failed_read_of_whether_the_game_runs_is_logged(qtbot, shell, monkeypatch, caplog):
    monkeypatch.setattr(Core, "status", _disk_full)
    with caplog.at_level(logging.ERROR):
        app, _, _ = shell()
        _window(qtbot, app)
        qtbot.waitUntil(lambda: "reading whether the game runs failed" in caplog.text)
    assert "OSError: the disk is full" in caplog.text
    assert not app.overlay().isVisible()


def test_the_hotkey_opens_and_closes_the_overlay(qtbot, shell):
    app, _, _ = shell()
    _window(qtbot, app)
    overlay, hotkey = app.overlay(), app.hotkey()
    hotkey.pressed.emit()  # Windows says that Ctrl+Alt+G was pressed
    assert overlay.is_open and overlay.isVisible() and not _click_through(overlay)
    assert overlay.view().loaded[0] == f"{app.dashboard().view().loaded[0]}&to=overlay"  # the overlay's launch link
    hotkey.pressed.emit()
    assert not overlay.is_open and not overlay.isVisible()  # the game does not run, so nothing stays over it
    _game(app, True)
    hotkey.pressed.emit()
    assert overlay.is_open
    hotkey.pressed.emit()
    assert not overlay.is_open and overlay.isVisible() and _click_through(overlay)  # closed, over the game


def test_before_the_risk_statement_is_read_the_hotkey_opens_nothing_and_still_closes(qtbot, shell, asked):
    # Until then the overlay's page shows nothing: an open overlay would be an empty layer taking the game's clicks.
    app, _, _ = shell(statement_read=False)
    _window(qtbot, app)
    overlay, hotkey = app.overlay(), app.hotkey()
    hotkey.pressed.emit()
    assert not overlay.is_open and not overlay.isVisible()
    app.call(lambda core: core.update_settings({"risk_acknowledged": True})).result(5)  # the player reads it
    QCoreApplication.processEvents()  # and Qt hears of it
    hotkey.pressed.emit()
    assert overlay.is_open and overlay.isVisible()
    # The announcements' read the consent starts is made before the consent is taken back: the fixture checks that each
    # request had the consent at the moment it was made, and none is still on its way.
    qtbot.waitUntil(lambda: any(url.startswith(ANN_LIST_URL) for url, _ in asked), timeout=10_000)
    app.call(lambda core: core.update_settings({"risk_acknowledged": False})).result(5)
    QCoreApplication.processEvents()
    hotkey.pressed.emit()
    assert not overlay.is_open  # closing always works


def test_a_hotkey_held_elsewhere_is_said_in_the_log_once_while_it_is_asked_for_again(qtbot, shell, user32, caplog):
    user32.taken = frozenset({ord("G"), ord("H")})  # another program holds Ctrl+Alt+G and Ctrl+Alt+H

    def refusals() -> list[str]:
        return [record.getMessage() for record in caplog.records if "refused the overlay's hotkey" in record.getMessage()]

    with caplog.at_level(logging.WARNING):
        app, _, _ = shell()
        _window(qtbot, app)
        for opacity in (80, 90):  # other settings: the hotkey is asked for again each time, without a word
            app.call(lambda core, opacity=opacity: core.update_settings({"overlay_opacity": opacity})).result(5)
        qtbot.waitUntil(lambda: len(user32.calls) == 3)
        assert len(refusals()) == 1
        app.call(lambda core: core.update_settings({"overlay_hotkey": "Ctrl+Alt+H"})).result(5)  # another hotkey
        qtbot.waitUntil(lambda: len(refusals()) == 2)
        user32.taken = frozenset({ord("G")})  # the other program lets Ctrl+Alt+H go
        app.call(lambda core: core.update_settings({"overlay_opacity": 80})).result(5)
        qtbot.waitUntil(lambda: app.hotkey().held == parse_hotkey("Ctrl+Alt+H"))
        app.call(lambda core: core.update_settings({"overlay_hotkey": "Ctrl+Alt+G"})).result(5)  # held once since
        qtbot.waitUntil(lambda: len(refusals()) == 3)
    assert [text.split("hotkey ")[1].split(";")[0] for text in refusals()] == ["Ctrl+Alt+G", "Ctrl+Alt+H", "Ctrl+Alt+G"]


def test_a_hotkey_taken_elsewhere_is_asked_for_again_when_the_settings_come_again(qtbot, shell, user32):
    user32.taken = frozenset({ord("G")})  # another program holds Ctrl+Alt+G
    app, _, _ = shell()
    _window(qtbot, app)
    qtbot.waitUntil(lambda: _overlay_status(app)["hotkey_state"] == "taken")
    user32.taken = frozenset()  # and lets it go
    app.call(lambda core: core.update_settings({"overlay_hotkey": "Ctrl+Alt+G"})).result(5)  # saved again, as it was
    qtbot.waitUntil(lambda: _overlay_status(app)["hotkey_state"] == "held")
    assert app.hotkey().held == parse_hotkey("Ctrl+Alt+G")
    assert user32.calls == [("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, ord("G"))] * 2


def test_a_new_hotkey_in_settings_is_registered_again(qtbot, shell, user32):
    user32.taken = frozenset({ord("H")})  # another program holds Ctrl+Alt+H
    app, _, _ = shell()
    _window(qtbot, app)
    qtbot.waitUntil(lambda: _overlay_status(app)["hotkey_state"] == "held")
    app.call(lambda core: core.update_settings({"overlay_opacity": 80})).result(5)  # not the hotkey: nothing to do
    app.call(lambda core: core.update_settings({"overlay_hotkey": "Ctrl+Alt+H"})).result(5)
    qtbot.waitUntil(lambda: _overlay_status(app)["hotkey_state"] == "taken")
    app.call(lambda core: core.update_settings({"overlay_hotkey": "Ctrl+Shift+F9"})).result(5)
    qtbot.waitUntil(lambda: _overlay_status(app)["hotkey_state"] == "held")
    assert user32.calls == [
        ("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, ord("G")),
        ("UnregisterHotKey", None, HOTKEY_ID),
        ("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, ord("H")),
        ("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 0x78),  # nothing held to let go
    ]
    assert app.hotkey().held == parse_hotkey("Ctrl+Shift+F9")


def _display_receivers() -> list[int]:
    """How many receivers hear of the displays: one plugged in or out, a new main display, a new geometry."""
    application, screen = QCoreApplication.instance(), QGuiApplication.primaryScreen()
    return [
        application.receivers(SIGNAL("screenAdded(QScreen*)")),
        application.receivers(SIGNAL("screenRemoved(QScreen*)")),
        application.receivers(SIGNAL("primaryScreenChanged(QScreen*)")),
        screen.receivers(SIGNAL("geometryChanged(QRect)")),
    ]


def test_stopping_hides_the_overlay_and_lets_go_of_the_hotkey_and_the_displays(qtbot, shell, user32, monkeypatch):
    application = QCoreApplication.instance()
    filters: list[tuple[str, object]] = []
    install, remove = application.installNativeEventFilter, application.removeNativeEventFilter
    monkeypatch.setattr(application, "installNativeEventFilter", lambda f: (filters.append(("in", f)), install(f)))
    monkeypatch.setattr(application, "removeNativeEventFilter", lambda f: (filters.append(("out", f)), remove(f)))
    before = _display_receivers()
    app, _, _ = shell()
    _window(qtbot, app)
    assert _display_receivers() == [count + 1 for count in before]
    overlay = app.overlay()
    app.hotkey().pressed.emit()  # the overlay is open as Guild Board ends
    app.stop()
    assert not overlay.isVisible() and not overlay.is_open  # nothing stays over the game, taking its clicks
    assert user32.calls[-1] == ("UnregisterHotKey", None, HOTKEY_ID)
    assert app.hotkey().held is None
    [(went_in, installed), (went_out, removed)] = filters
    assert (went_in, went_out) == ("in", "out") and removed is installed  # Qt no longer hands it messages
    assert _display_receivers() == before


def test_the_alert_that_guild_board_stopped_comes_with_the_overlay_hidden(qtbot, shell):
    # The alert is modal: an open overlay would cover it, and take the clicks meant for it.
    app, desktop, _ = shell()
    _window(qtbot, app)
    overlay = app.overlay()
    app.hotkey().pressed.emit()
    seen: list[tuple[str, bool, bool]] = []
    desktop.alert = lambda text: seen.append((text, overlay.isVisible(), overlay.is_open))
    with qtbot.waitSignal(app.ended, timeout=30_000):
        app._thread.stop()  # the core stops, unexpectedly
    assert seen == [(app_module.STOPPED, False, False)]


def test_showing_the_dashboard_closes_the_overlay_first(qtbot, shell):
    # The overlay stays on top of its display: a dashboard shown there would be under it, and nothing would seem to
    # happen.
    app, _, _ = shell()
    window = _window(qtbot, app)
    overlay, hotkey = app.overlay(), app.hotkey()
    shown = _shown_messages(app)
    app.call(lambda core: core.notify("reminder", "Unusual Hilichurl is ready.")).result(5)
    qtbot.waitUntil(lambda: len(shown) > 0)
    open_item = next(action for action in app.tray().menu().actions() if action.text() == "Open")
    for show in (
        lambda: app.tray().icon.activated.emit(QSystemTrayIcon.ActivationReason.Trigger),  # a click on the tray icon
        open_item.trigger,
        app.tray().icon.messageClicked.emit,  # a click on the reminder
        app.show_window,  # a second start asks for the window
    ):
        hotkey.pressed.emit()
        assert overlay.is_open
        show()
        assert not overlay.is_open and window.isVisible()


class Display(QObject):
    """Stands in for a QScreen: its name, where it is on the desktop, and its scaling; it says when its geometry
    changes."""

    geometryChanged = Signal(QRect)

    def __init__(self, name: str, geometry: QRect, ratio: float = 1.0) -> None:
        super().__init__()
        self._name, self._geometry, self._ratio = name, geometry, ratio

    def name(self) -> str:
        return self._name

    def geometry(self) -> QRect:
        return self._geometry

    def devicePixelRatio(self) -> float:  # noqa: N802
        return self._ratio

    def move_to(self, geometry: QRect) -> None:
        """A new resolution, or a new place beside the other displays."""
        self._geometry = geometry
        self.geometryChanged.emit(geometry)


def _displays(monkeypatch, *displays: Display) -> None:  # noqa: ANN001
    """The displays the shell finds, the first of them the main one, in place of the one the tests have."""
    monkeypatch.setattr(app_module, "QGuiApplication", SimpleNamespace(
        screens=lambda: list(displays), primaryScreen=lambda: displays[0], instance=QGuiApplication.instance,
    ))


def test_the_overlay_draws_at_the_size_chosen_on_any_display(qtbot, shell, monkeypatch):
    main = Display(r"\\.\DISPLAY1", QRect(0, 0, 3440, 1440))  # the player's main display
    side = Display(r"\\.\DISPLAY2", QRect(3440, 0, 1920, 1080))
    _displays(monkeypatch, main, side)
    app, _, _ = shell()
    window = _window(qtbot, app)
    overlay = app.overlay()
    _game(app, True)  # the window shows, so its page loads, and takes the size kept for it
    view = overlay.view()
    assert view.zooms == [1.0]  # 100%, the Board's size, on the tall display too
    app.call(lambda core: core.update_settings({"overlay_size": 150})).result(5)
    QCoreApplication.processEvents()
    assert view.zooms[-1] == 1.5  # the size chosen
    app.call(lambda core: core.update_settings({"overlay_display": side.name()})).result(5)
    QCoreApplication.processEvents()
    assert overlay.geometry() == side.geometry() and view.zooms[-1] == 1.5  # the same size on another display
    applied = len(view.zooms)
    side.move_to(QRect(3440, 0, 2560, 1440))  # its resolution changes: the overlay covers it again, at that size
    qtbot.waitUntil(lambda: overlay.geometry() == side.geometry() and len(view.zooms) > applied)
    assert view.zooms[-1] == 1.5
    app.call(lambda core: core.update_settings({"overlay_size": 100})).result(5)
    QCoreApplication.processEvents()
    assert view.zooms[-1] == 1.0
    assert [address for address in view.loaded if "#" not in address] == [view.loaded[0]]  # never loaded again
    assert set(window.view().zooms) <= {1.0}  # the dashboard's zoom is its window's, never the overlay's 1.5


def test_each_display_is_labelled_with_its_number_its_size_in_pixels_and_main():
    # The size is in the display's own pixels, as Windows' display settings give it: Qt's size times the scaling.
    main = Display(r"\\.\DISPLAY1", QRect(0, 0, 3440, 1440))
    scaled = Display(r"\\.\DISPLAY2", QRect(3440, 0, 2048, 1152), 1.25)  # 2560 × 1440 at 125%
    rounded = Display(r"\\.\DISPLAY3", QRect(5488, 0, 1707, 960), 1.5)  # 2560 × 1440 at 150%: Qt rounds to 1707
    assert display_list([scaled, main, rounded], main) == [
        {"name": r"\\.\DISPLAY2", "label": "Display 1, 2560 × 1440", "primary": False},
        {"name": r"\\.\DISPLAY1", "label": "Display 2, 3440 × 1440, main", "primary": True},
        {"name": r"\\.\DISPLAY3", "label": "Display 3, 2560 × 1440", "primary": False},
    ]


def test_a_new_display_setting_or_a_change_of_displays_places_the_overlay_again(qtbot, shell):
    app, _, _ = shell()
    _window(qtbot, app)
    overlay = app.overlay()
    screen = QGuiApplication.primaryScreen()
    main = screen.geometry()
    qtbot.waitUntil(lambda: _overlay_status(app)["available"])
    reports = _reports(app)
    overlay.setGeometry(10, 10, 100, 100)  # somewhere else
    app.call(lambda core: core.update_settings({"overlay_display": r"\\.\DISPLAY2"})).result(5)
    qtbot.waitUntil(lambda: overlay.geometry() == main)  # that display is not there: the main one
    app.call(lambda core: None).result(5)  # whatever the shell sent the core before this has arrived
    assert reports == []  # the displays are as they were
    application = QGuiApplication.instance()
    for changed, argument in (
        (screen.geometryChanged, QRect(0, 0, 1024, 768)),  # a new resolution, or a new place beside the others
        (application.primaryScreenChanged, screen),
        (application.screenAdded, screen),
        (application.screenRemoved, screen),
    ):
        overlay.setGeometry(10, 10, 100, 100)
        changed.emit(argument)
        # On Windows the displays' new places arrive after the signal: the overlay is placed a moment later.
        assert overlay.geometry() == QRect(10, 10, 100, 100), changed
        qtbot.waitUntil(lambda: overlay.geometry() == main)
    qtbot.waitUntil(lambda: len(reports) == 4)  # the Overlay settings hear of the displays each time
    assert {state for _, state in reports} == {"held"}


def test_the_tray_can_hide_the_pinned_widgets_and_move_the_overlay_to_the_main_display(qtbot, shell):
    app, _, _ = shell()
    _window(qtbot, app)
    items = {action.text(): action for action in app.tray().menu().actions()}
    pinned = items["Show pinned widgets"]
    app.call(lambda core: core.update_settings({"overlay_pinned": False})).result(5)
    qtbot.waitUntil(lambda: not pinned.isChecked())  # it follows the setting
    pinned.trigger()
    qtbot.waitUntil(lambda: app.call(lambda core: core.settings.overlay_pinned).result(5) is True)
    overlay, move = app.overlay(), items["Move the overlay to the main display"]
    overlay.setGeometry(10, 10, 100, 100)  # off its place, though the setting names the main display already
    move.trigger()
    assert overlay.geometry() == QGuiApplication.primaryScreen().geometry()
    app.call(lambda core: core.update_settings({"overlay_display": r"\\.\DISPLAY2"})).result(5)
    move.trigger()
    qtbot.waitUntil(lambda: app.call(lambda core: core.settings.overlay_display).result(5) == "")


def test_the_pinned_tick_goes_back_when_its_setting_cannot_be_saved(qtbot, shell, caplog):
    app, _, _ = shell()
    _window(qtbot, app)
    pinned = next(action for action in app.tray().menu().actions() if action.text() == "Show pinned widgets")
    assert pinned.isChecked()  # as the setting is
    ticks: list[bool] = []
    pinned.toggled.connect(ticks.append)
    app.call(lambda core: setattr(core, "update_settings", _disk_full)).result(5)
    with caplog.at_level(logging.ERROR):
        pinned.trigger()  # Qt takes the tick off with the click
        qtbot.waitUntil(lambda: "the tray item Show pinned widgets failed" in caplog.text)
    qtbot.waitUntil(lambda: ticks == [False, True])  # and puts it back: the setting did not change
    assert pinned.isChecked()


def test_qt_keeps_no_graphics_cache_outside_the_data_folder(monkeypatch):
    # On a real display, Qt saves its graphics pipelines in %LOCALAPPDATA%\Guild Board\cache. The tests draw
    # nothing on screen, so this checks the settings that keep that folder from being made.
    monkeypatch.delenv("QSG_RHI_DISABLE_DISK_CACHE", raising=False)
    monkeypatch.delenv("QTWEBENGINE_REMOTE_DEBUGGING", raising=False)  # configure_qt() drops these two from the
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)  # environment: the test gives them back after
    QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_DisableShaderDiskCache, False)
    configure_qt()
    assert os.environ["QSG_RHI_DISABLE_DISK_CACHE"] == "1"
    assert QCoreApplication.testAttribute(Qt.ApplicationAttribute.AA_DisableShaderDiskCache)


def test_qt_draws_with_windows_default_so_the_overlay_stays_see_through(monkeypatch):
    # OpenGL drew the map without black squares, but the overlay's window turned opaque and hid the game.
    monkeypatch.delenv("QSG_RHI_BACKEND", raising=False)
    monkeypatch.delenv("QTWEBENGINE_REMOTE_DEBUGGING", raising=False)  # configure_qt() drops these two from the
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)  # environment: the test gives them back after
    configure_qt()
    assert "QSG_RHI_BACKEND" not in os.environ


def test_the_pages_can_ask_for_a_collection_and_only_the_demo_keeps_a_flag_already_set(monkeypatch):
    # Qt WebEngine 140 does not collect a page's old documents by itself: the renderer grew 10 to 25 MB with each page change.
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", "--some-flag")
    monkeypatch.delenv("QTWEBENGINE_REMOTE_DEBUGGING", raising=False)  # configure_qt() drops these two from the
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)  # environment: the test gives them back after
    configure_qt(demo=True)
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == "--some-flag --js-flags=--expose-gc-as=gbCollect"
    configure_qt(demo=True)
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"].count("gbCollect") == 1  # once, however often it is called
    # On the player's own data the engine takes no switch from the environment: only the shell's own.
    assert configure_qt() == ["--some-flag"]
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == "--js-flags=--expose-gc-as=gbCollect"
    assert configure_qt() == []  # the shell's own flag is nothing inherited
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", "")
    configure_qt()
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == "--js-flags=--expose-gc-as=gbCollect"


def test_the_frame_limit_goes_only_when_the_player_turned_on_smooth_animations(monkeypatch):
    # Qt WebEngine holds its window at 60 frames a second whatever the monitor does; no switch sets another rate.
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", "")
    monkeypatch.delenv("QTWEBENGINE_REMOTE_DEBUGGING", raising=False)  # configure_qt() drops these two from the
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)  # environment: the test gives them back after
    configure_qt()
    assert "--disable-frame-rate-limit" not in os.environ["QTWEBENGINE_CHROMIUM_FLAGS"]
    configure_qt(smooth=True)
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"].split().count("--disable-frame-rate-limit") == 1
    configure_qt(demo=True, smooth=True)
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"].split().count("--disable-frame-rate-limit") == 1  # once, in the demo too


def test_the_shell_starts_the_engine_with_the_saved_choice(monkeypatch, tmp_path):
    from guildboard.shell import app as app_module

    class Started(Exception):
        pass

    def configure(*, demo: bool = False, smooth: bool = False) -> list[str]:
        told.append((demo, smooth))
        raise Started

    told: list[tuple[bool, bool]] = []
    monkeypatch.setattr(app_module, "configure_qt", configure)
    paths = AppPaths(tmp_path)
    for saved in (False, True):
        save_settings(paths.settings_path, Settings(smooth_animations=saved))
        with pytest.raises(Started):
            app_module.run_shell(paths, demo=False)
    assert told == [(False, False), (False, True)]


def test_a_remote_page_sees_the_collection_under_its_private_name_and_nothing_else(tmp_path):
    # L30: the flag is the whole engine's, so a page whose origin is HoYoLAB's sees the collection as the interface does:
    # the accepted exception tests/test_handsoff.py records, with its reason. The well-known name `gc` stays away. A flag
    # the engine does not know is ignored without a word, so this asks the engine itself, in a process of its own: the
    # flag is read once, when the engine starts. Every request the page would send is refused, so nothing is fetched.
    script = tmp_path / "engine.py"
    script.write_text(
        """
import sys
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineUrlRequestInterceptor
from PySide6.QtWidgets import QApplication
from guildboard.shell.app import configure_qt


class Refuse(QWebEngineUrlRequestInterceptor):
    def interceptRequest(self, info):
        if info.requestUrl().scheme() not in ("data", "about"):
            print("asked", info.requestUrl().toString(), flush=True)
            info.block(True)


configure_qt()
app = QApplication(sys.argv[:1])
profile = QWebEngineProfile()
refuse = Refuse()
profile.setUrlRequestInterceptor(refuse)
page = QWebEnginePage(profile)
page.loadFinished.connect(lambda ok: page.runJavaScript(
    "[typeof gbCollect, typeof gc, location.origin].join(' ')", 0, lambda found: (print(found, flush=True), app.exit(0))))
page.setHtml("<link rel=icon href='data:,'><p>x</p>", QUrl("https://act.hoyolab.com/ys/app/interactive-map/"))
QTimer.singleShot(30_000, lambda: app.exit(3))
code = app.exec()
del page  # before its profile
sys.exit(code)
""",
        encoding="utf-8",
    )
    env = {**os.environ, "QT_QPA_PLATFORM": "offscreen", "PYTHONPATH": str(Path(__file__).parent.parent / "src")}
    env.pop("QTWEBENGINE_CHROMIUM_FLAGS", None)
    done = subprocess.run([sys.executable, str(script)], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    assert done.stdout.split() == ["function", "undefined", "https://act.hoyolab.com"]


class ShellNotMade(Exception):
    """Raised where run_shell would make the shell, so that a test of run_shell never runs Guild Board."""


@pytest.fixture
def made_shells(tmp_path, monkeypatch, qapp) -> list[dict]:
    """For every test of run_shell: Start with Windows looks in a Startup folder under tmp_path, a shortcut is only
    described, never made, and run_shell stops with ShellNotMade where it would make the shell. The list holds the
    options each shell would have been made with."""
    made: list[dict] = []

    def shell_app(paths: AppPaths, **options: object) -> None:
        made.append(options)
        raise ShellNotMade

    monkeypatch.setattr(app_module, "startup_folder", lambda: tmp_path / "Startup")
    monkeypatch.setattr(app_module, "Shortcut", lambda folder, target: ("shortcut", folder, target))
    monkeypatch.setattr(app_module, "ShellApp", shell_app)
    monkeypatch.setattr(app_module, "setup_logging", lambda folder: None)
    return made


def test_quit_says_why_when_guild_board_does_not_end(tmp_path, monkeypatch, capsys, made_shells):
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(notify=False))
    assert app_module.run_shell(AppPaths(tmp_path / "data"), demo=False, quit=True) == 1
    assert capsys.readouterr().out.strip() == (
        "Guild Board is running but does not answer. Quit it from the tray icon, or end it in Task Manager."
    )


@pytest.mark.parametrize(
    ("guard", "code", "printed"),
    [
        pytest.param(dict(acquire=(True,)), 0, "Guild Board is not running.\n", id="not_running"),
        pytest.param(
            dict(notify=True, free=False), 1,
            "Guild Board was asked to quit, but it is still running after 30 seconds.\n",
            id="still_running",
        ),
        pytest.param(dict(notify=True, free=True), 0, "", id="quit"),
    ],
)
def test_quit_ends_with_the_code_and_the_words_of_its_outcome(
    tmp_path, monkeypatch, capsys, made_shells, guard, code, printed
):
    # setup.ps1 runs --quit before it replaces Guild Board's files, and stops at any code but 0.
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(**guard))
    assert app_module.run_shell(AppPaths(tmp_path / "data"), demo=False, quit=True) == code
    assert capsys.readouterr().out == printed
    assert made_shells == []


def test_a_start_that_gets_no_answer_says_so_in_an_alert_and_ends_with_1(tmp_path, monkeypatch, capsys, made_shells):
    alerts: list[str] = []

    class Desktop:
        def alert(self, text: str) -> None:
            alerts.append(text)

    monkeypatch.setattr(app_module, "Desktop", Desktop)
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(notify=False, free=False))
    assert app_module.run_shell(AppPaths(tmp_path / "data"), demo=False) == 1
    assert alerts == [
        "Guild Board is already running, but it does not answer. Quit it from the tray icon, or end it in Task Manager."
    ]
    assert capsys.readouterr().out == ""
    assert made_shells == []


def test_a_later_start_opened_by_a_link_hands_it_over(tmp_path, monkeypatch, made_shells):
    guard = FakeGuard(notify=True)
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: guard)
    assert app_module.run_shell(AppPaths(tmp_path / "data"), demo=False, invite=INVITE_CODE) == 0
    assert guard.calls[-1] == ("notify", b"invite " + INVITE_CODE.encode("ascii") + b"\n")
    assert made_shells == []


def test_a_later_start_does_not_write_to_the_running_guild_boards_log(tmp_path, monkeypatch, made_shells):
    opened: list = []
    monkeypatch.setattr(app_module, "setup_logging", lambda folder: opened.append(folder))
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(notify=True))
    assert app_module.run_shell(AppPaths(tmp_path / "data"), demo=False) == 0
    assert opened == []


def test_start_with_windows_is_kept_by_a_guild_board_on_the_folder_its_shortcut_starts(
    tmp_path, monkeypatch, made_shells
):
    # The Startup shortcut carries no arguments: it starts Guild Board on %LOCALAPPDATA%\GuildBoard, the folder a
    # start with no --data-dir and no GUILDBOARD_DATA_DIR uses, as Windows names it (startup.shortcut_data_dir).
    monkeypatch.setattr(app_module, "shortcut_data_dir", lambda: tmp_path / "Local" / "GuildBoard")
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(acquire=(True,)))
    with pytest.raises(ShellNotMade):
        app_module.run_shell(AppPaths(tmp_path / "Local" / "GuildBoard"), demo=False)
    [made] = made_shells
    assert made["startup"] == ("shortcut", tmp_path / "Startup", launcher("guildboard-tray.exe"))


def test_start_with_windows_follows_the_folder_windows_names_not_the_variable(monkeypatch, made_shells):
    # The Startup folder comes from Windows, whatever LOCALAPPDATA says, and so does the folder its shortcut starts.
    # A start whose LOCALAPPDATA was moved, as every test's is (conftest.py), is on another folder: it leaves the
    # shortcut alone, though its folder is the one a start with no --data-dir would use.
    monkeypatch.delenv("GUILDBOARD_DATA_DIR", raising=False)
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(acquire=(True,)))
    with pytest.raises(ShellNotMade):
        app_module.run_shell(AppPaths(standard_data_dir()), demo=False)
    [made] = made_shells
    assert made["startup"] is None


def test_a_guild_board_on_any_other_folder_leaves_start_with_windows_alone(tmp_path, monkeypatch, made_shells):
    # Its setting would otherwise remove or remake the one shortcut, which starts the Guild Board on the other folder.
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))
    monkeypatch.setenv("GUILDBOARD_DATA_DIR", str(tmp_path / "chosen"))
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(acquire=(True,)))
    starts = [  # --data-dir, the folder GUILDBOARD_DATA_DIR names, and the demo
        (AppPaths(tmp_path / "elsewhere"), False),
        (AppPaths(tmp_path / "chosen"), False),
        (AppPaths(tmp_path / "Local" / "GuildBoard-demo"), True),
    ]
    for paths, demo in starts:
        with pytest.raises(ShellNotMade):
            app_module.run_shell(paths, demo=demo)
    assert [made["startup"] for made in made_shells] == [None, None, None]


UNSAFE = (
    "--remote-debugging-port=9222 --remote-allow-origins=* --no-sandbox --disable-web-security "
    "-remote-debugging-pipe /No-Sandbox --single-process"
)


def test_a_live_window_drops_debugging_and_unsafe_inherited_flags(tmp_path, monkeypatch, made_shells, caplog):
    # L31: an engine started with debugging on serves an endpoint on 127.0.0.1 that any program of any account on the PC
    # can ask for the map's cookies. On the player's own data the shell takes none of the engine's switches from its
    # environment, whatever they are, and says once in the log which, by their names alone (a value could hold anything).
    monkeypatch.setattr(app_module, "InstanceGuard", lambda data_dir: FakeGuard(acquire=(True,)))
    monkeypatch.setenv("QTWEBENGINE_REMOTE_DEBUGGING", "9222")
    monkeypatch.setenv("QTWEBENGINE_DISABLE_SANDBOX", "1")
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", f"--force-dark-mode {UNSAFE} --lang=pl")
    with caplog.at_level(logging.INFO, logger="guildboard.shell.app"), pytest.raises(ShellNotMade):
        app_module.run_shell(AppPaths(tmp_path / "data"), demo=False)
    assert "QTWEBENGINE_REMOTE_DEBUGGING" not in os.environ and "QTWEBENGINE_DISABLE_SANDBOX" not in os.environ
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == app_module.COLLECTION_FLAG  # the shell's own alone
    [said] = [record.getMessage() for record in caplog.records if "left out" in record.getMessage()]
    assert said == (
        "These inherited settings of the browser engine were left out: QTWEBENGINE_REMOTE_DEBUGGING, "
        "QTWEBENGINE_DISABLE_SANDBOX, --force-dark-mode, --remote-debugging-port, --remote-allow-origins, --no-sandbox, "
        "--disable-web-security, -remote-debugging-pipe, /No-Sandbox, --single-process, --lang"
    )
    # The demo keeps them: the window checks attach to it, on made-up data.
    caplog.clear()
    monkeypatch.setenv("QTWEBENGINE_REMOTE_DEBUGGING", "9222")
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", UNSAFE)
    with caplog.at_level(logging.INFO, logger="guildboard.shell.app"), pytest.raises(ShellNotMade):
        app_module.run_shell(AppPaths(tmp_path / "demo"), demo=True)
    assert os.environ["QTWEBENGINE_REMOTE_DEBUGGING"] == "9222"
    assert set(UNSAFE.split()) <= set(os.environ["QTWEBENGINE_CHROMIUM_FLAGS"].split())
    assert not [record for record in caplog.records if "left out" in record.getMessage()]


def test_a_value_of_an_inherited_flag_is_counted_never_named(monkeypatch):
    # A word of the flags that starts with neither "-" nor "/" is a flag's value (--user-data-dir C:/secret): it could
    # hold anything, so the log gets the count of such words and not the words.
    monkeypatch.delenv("QTWEBENGINE_REMOTE_DEBUGGING", raising=False)
    monkeypatch.delenv("QTWEBENGINE_DISABLE_SANDBOX", raising=False)
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", "--remote-debugging-port 9222 --user-data-dir=C:/secret MY-VALUE")
    assert app_module.configure_qt(demo=False) == ["--remote-debugging-port", "--user-data-dir", "2 other words"]
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox 9222")
    assert app_module.configure_qt(demo=False) == ["--no-sandbox", "1 other word"]


def test_the_demo_opens_with_pythonw_from_a_checkout():
    program, arguments = app_module.demo_command()
    assert Path(program).name.lower() in ("pythonw.exe", Path(sys.executable).name.lower())
    assert arguments == ["-m", "guildboard", "--demo", "--acknowledged"]


def test_the_installed_copy_opens_the_demo_with_its_own_program(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert app_module.demo_command() == (sys.executable, ["--demo", "--acknowledged"])


def test_the_map_tabs_become_views_on_the_interface_where_the_page_leaves_room(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    holder = window.view()
    qtbot.waitUntil(lambda: app._maps.session_known, timeout=10_000)  # the demo has no session: the answer is none
    qtbot.waitUntil(lambda: app._map_snapshot is not None, timeout=10_000)
    assert holder.findChildren(MapStubView) == []  # the interface is not on its Map page: no map loads (M19)
    holder.setUrl(QUrl(holder.origin + "/#/map"))
    holder.urlChanged.emit(holder.url())
    qtbot.waitUntil(lambda: len(holder.findChildren(MapStubView)) == 1, timeout=10_000)
    [view] = holder.findChildren(MapStubView)
    area = {"x": 10, "y": 20, "w": 300, "h": 200, "hidden": False}

    def show() -> None:
        core = app._thread.core
        core.maptabs.set_viewport(area)
        core.map_changed(page=False)

    app.call(lambda core: show()).result(5)
    qtbot.waitUntil(lambda: not view.isHidden(), timeout=10_000)
    assert view.geometry() == QRect(10, 20, 300, 200)
    app.call(lambda core: (core.maptabs.add(), core.map_changed())).result(5)
    qtbot.waitUntil(lambda: len(holder.findChildren(MapStubView)) == 2, timeout=10_000)
    assert [v.isHidden() for v in holder.findChildren(MapStubView)].count(False) == 1  # only the active tab shows
    window.close()
    qtbot.waitUntil(lambda: app._maps._views == {}, timeout=10_000)


def test_a_login_or_a_logout_signs_the_map_views_in_or_out_again(qtbot, shell):
    app, _, _ = shell()
    window = _window(qtbot, app)
    holder = window.view()
    holder.setUrl(QUrl(holder.origin + "/#/map"))  # a map loads only on the Map page
    holder.urlChanged.emit(holder.url())
    qtbot.waitUntil(lambda: len(holder.findChildren(MapStubView)) == 1, timeout=10_000)
    [view] = holder.findChildren(MapStubView)
    assert view.reloads == 0
    app.call(lambda core: core._auth_changed()).result(5)  # what Auth calls after a login and after a logout
    qtbot.waitUntil(lambda: view.reloads == 1, timeout=10_000)


def test_a_restart_never_carries_hidden_and_keeps_only_the_data_folder(monkeypatch):
    monkeypatch.setattr(app_module.sys, "frozen", False, raising=False)
    program, arguments = app_module.restart_command(["--hidden", "--data-dir", "D:/gb", "--acknowledged"])
    assert arguments == ["-m", "guildboard", "--data-dir", "D:/gb"]
    assert app_module.restart_command(["--hidden"])[1] == ["-m", "guildboard"]
    assert app_module.restart_command(["--data-dir=E:/x"])[1] == ["-m", "guildboard", "--data-dir", "E:/x"]
    monkeypatch.setattr(app_module.sys, "frozen", True, raising=False)
    assert app_module.restart_command(["--hidden", "--data-dir", "D:/gb"]) == (sys.executable, ["--data-dir", "D:/gb"])


def test_a_click_on_the_codes_notification_opens_the_codes_page():
    from guildboard.shell.app import PLACES_BY_KIND

    assert PLACES_BY_KIND["codes"] == "codes"


def test_a_click_on_a_characters_notification_opens_the_week_or_the_character_it_names():
    from guildboard.shell.app import PLACES_BY_KIND, place_of

    assert PLACES_BY_KIND["characters"] == "week"   # the weekly bosses and the domains: Your week
    assert place_of("characters") == "week" and place_of("reminder") == "achievements/timers"
    assert place_of("characters/sandrone") == "characters/sandrone"   # a goal that is ready: her profile
    assert place_of("characters/lan-yan") == "characters/lan-yan"
    for kind in ("characters/", "characters/../x", "characters/Sandrone", "characters/a b", "hint", None):
        assert place_of(kind) is None, kind
