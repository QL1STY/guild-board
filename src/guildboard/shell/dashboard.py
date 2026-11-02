"""The dashboard window: the interface in a browser view that may show only the core's own pages.
Closing it hides it to the tray and releases the page a moment later, so only the core keeps running. The page zooms
with the window's width, from the usual 1,640 pixels up to twice the size."""
from __future__ import annotations

import math
from typing import Callable

from PySide6.QtCore import QObject, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QCloseEvent, QDesktopServices, QGuiApplication, QResizeEvent
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QMainWindow, QWidget

from guildboard.shell.placement import WindowPlacement, first_run_screen

# (parent, the only origin the page may show) to a view with `load(QUrl)`, `loadFinished`, `zoomFactor` and
# `setZoomFactor`.
ViewFactory = Callable[[QWidget, str], QWidget]

# A link opens in the player's own browser only when its address starts with one of these. Each ends in "/",
# so a look-alike host cannot pass.
EXTERNAL_LINKS = (
    "https://genshin-impact.fandom.com/",
    "https://act.hoyolab.com/ys/app/interactive-map/",
    # The profile card's links (the gift codes design, section 1).
    "https://akasha.cv/profile/",
    "https://enka.network/u/",
    "https://act.hoyolab.com/app/community-game-records-sea/",
    # HoYoLAB's own check-in page, where the player claims when it asks for a check (the daily check-in design).
    "https://act.hoyolab.com/ys/event/signin-sea-v3/",
    # Settings, About: Guild Board's source and privacy notice. The player's browser opens them; Guild Board asks for nothing.
    "https://github.com/QL1STY/guild-board/",
)
# A closed window's page is let go this long after it hides: what it sends as it hides, a note's save among them, is
# not cut off with it (Notes.tsx).
RELEASE_AFTER_MS = 2_000
# The window width, in Qt's logical pixels, at which the page draws at its own size: the player's usual window. A wider
# window zooms the page to fill it, and a narrower one keeps today's narrow layout.
REFERENCE_WIDTH = 1640
# The page's cache is in memory (its profile keeps nothing on disk), and left alone it grows to 50 MB. A small one holds the
# interface's own files and the roster's faces; any other picture is a moment away from the core.
HTTP_CACHE_BYTES = 16 * 1024 * 1024


def opens_outside(url: str) -> bool:
    return url.startswith(EXTERNAL_LINKS)


class LinkCatcher(QWebEnginePage):
    """Takes the address of a link that asks for a new window, and shows nothing. Windows opens a wiki address
    in the player's own browser; nothing else opens."""

    def __init__(
        self,
        profile: QWebEngineProfile,
        parent: QObject | None = None,
        open_url: Callable[[QUrl], object] = QDesktopServices.openUrl,
    ) -> None:
        super().__init__(profile, parent)
        self._open_url = open_url

    def acceptNavigationRequest(self, url: QUrl, kind: QWebEnginePage.NavigationType, is_main_frame: bool) -> bool:
        if opens_outside(url.toString()):
            self._open_url(url)
        self.deleteLater()  # one address each, so catchers do not pile up under the page
        return False


class CorePage(QWebEnginePage):
    def __init__(self, profile: QWebEngineProfile, parent: QWidget, origin: str) -> None:
        super().__init__(profile, parent)
        self._origin = origin

    def acceptNavigationRequest(self, url: QUrl, kind: QWebEnginePage.NavigationType, is_main_frame: bool) -> bool:
        return url.toString().startswith(self._origin + "/")

    def createWindow(self, kind: QWebEnginePage.WebWindowType) -> LinkCatcher:
        # Qt hands a new window's content only to a page of the opener's profile, and without a parent Python
        # would delete the catcher as soon as this returns.
        return LinkCatcher(self.profile(), parent=self)

    def javaScriptConsoleMessage(self, level, message: str, line: int, source: str) -> None:
        pass  # the page's console stays out of the log


def web_view(parent: QWidget, origin: str) -> QWidget:
    view = QWebEngineView(parent)
    profile = QWebEngineProfile()  # without a name: kept in memory only
    profile.setHttpCacheMaximumSize(HTTP_CACHE_BYTES)
    page = CorePage(profile, view, origin)
    profile.setParent(page)  # deleted with the page, and after it
    view.setPage(page)
    view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
    # The page may write the clipboard, as the Gallery's Copy picture and the Map's Copy link do; without this Qt asks
    # for a permission no one answers, and the copy never ends. Reading the clipboard (JavascriptCanPaste) stays off.
    page.settings().setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard, True)
    return view


def link_origin(link: str) -> str:
    """The origin of the core's launch link: the only one its views may show."""
    url = QUrl(link)
    return f"{url.scheme()}://{url.host()}:{url.port()}"


def window_zoom(width: int) -> float:
    """How large the dashboard's page draws in a window this wide, in Qt's logical pixels: the width over 1,640, from 1
    to 2. From 1,640 to 3,280 pixels the page then lays out 1,640 CSS pixels wide, only larger."""
    return min(2.0, max(1.0, width / REFERENCE_WIDTH))


class DashboardWindow(QMainWindow):
    hidden_to_tray = Signal()
    ended = Signal()
    view_opened = Signal(object)  # the interface's view, made as the window opens: the map views sit on it
    resized = Signal()  # the window's size changed and the page has taken its zoom: the map views follow

    def __init__(
        self,
        link: str,
        placement: WindowPlacement,
        *,
        make_view: ViewFactory = web_view,
        title: str = "Guild Board",
        can_hide: bool = True,
    ) -> None:
        super().__init__()
        self._link = link
        self._placement = placement
        self._make_view = make_view
        self._can_hide = can_hide
        self._view: QWidget | None = None
        self._placed = False
        self.setWindowTitle(title)
        self.resize(1440, 900)

    def view(self) -> QWidget | None:
        return self._view

    def open(self, place: str | None = None) -> None:
        """Show the window; with a place, such as "achievements/timers", on that place. A window not shown yet takes
        the place with its launch link, and an open one goes there."""
        if self._view is None:
            self._view = self._make_view(self, link_origin(self._link))
            self._view.loadFinished.connect(self._on_load_finished)
            self.setCentralWidget(self._view)
            self.view_opened.emit(self._view)
            self._view.load(QUrl(self._link if place is None else f"{self._link}&to={place}"))
            self._apply_zoom()  # at once, so that the page does not paint at 100% until it has loaded
        elif place is not None:
            self._view.load(QUrl(f"{link_origin(self._link)}/#/{place}"))
        maximize = False
        if not self._placed:
            self._placed = True
            screens = QGuiApplication.screens()
            geometries = [screen.availableGeometry() for screen in screens]
            if not self._placement.restore(self, geometries):
                primary = screens.index(QGuiApplication.primaryScreen()) if screens else 0
                if geometries:
                    self.setGeometry(geometries[first_run_screen(geometries, primary)])
                maximize = True
        if maximize:
            self.showMaximized()
        else:
            self.show()
        self.setWindowState(self.windowState() & ~Qt.WindowState.WindowMinimized)
        self.raise_()
        self.activateWindow()

    def save_placement(self) -> None:
        if self.isVisible():  # a window never shown has no place to remember
            self._placement.save(self)

    def closeEvent(self, event: QCloseEvent) -> None:
        self.save_placement()
        if not self._can_hide:
            event.accept()
            self.ended.emit()
            return
        event.ignore()
        self.hide()
        if self._view is not None:
            view, self._view = self._view, None
            view.setParent(None)
            QTimer.singleShot(RELEASE_AFTER_MS, view, view.deleteLater)
        self.hidden_to_tray.emit()

    def resizeEvent(self, event: QResizeEvent) -> None:
        super().resizeEvent(event)
        self._apply_zoom()  # a maximize, a restore and any change of the window's width arrive as resizes
        self.resized.emit()

    def _apply_zoom(self) -> None:
        """Zooms the page to the window's width, when there is a page and it is not at that zoom already. The view is
        asked what zoom it has, not a note kept here: the engine may have dropped a zoom that was set."""
        if self._view is None:
            return
        factor = window_zoom(self.width())
        # The engine gives a factor back with a rounding error in its last digit.
        if not math.isclose(self._view.zoomFactor(), factor, abs_tol=1e-6):
            self._view.setZoomFactor(factor)

    def _on_load_finished(self, ok: bool) -> None:
        if ok:
            # Chromium keeps a zoom with the page it has loaded, so a page loaded again may have dropped it: each load
            # asks the view again. A new fragment, as when a place is opened, keeps the page and its zoom.
            self._apply_zoom()
