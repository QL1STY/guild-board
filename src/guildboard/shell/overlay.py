"""The overlay's window: Guild Board's own, frameless, see-through and always on top, over a whole display. It shows
the interface's overlay page in a view of its own (stage 2A spec 14.3). Closed, it lets clicks through and never takes
the focus, so the game keeps both; open, on the hotkey, it takes them. For a game in full screen, which minimizes
whenever it loses the focus (2026-11-04), the player turns on a setting, and the open window then takes the clicks but
never the focus: the game stays in front, and its own Alt shows the pointer. The window and the page say open or closed
to each other through the page's address alone: #/overlay or #/overlay/open.

It never looks for the game's window, never activates it and never sends it input. Closing only makes this window
click-through again, or hides it, and Windows hands the focus back (stage 2A spec 4)."""
from __future__ import annotations

import logging
from typing import Sequence

from PySide6.QtCore import Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QCloseEvent, QGuiApplication, QScreen, QWindow
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWidgets import QVBoxLayout, QWidget

from guildboard.shell.dashboard import ViewFactory, link_origin, web_view

log = logging.getLogger(__name__)

CLOSED = "/overlay"  # the page's address fragment while the overlay is closed: pinned widgets and lines
OPEN = "/overlay/open"  # and while it is open: every widget, with Edit
# Always: no taskbar button, no frame, over other windows.
ALWAYS = Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint
# Only while closed: clicks go through, and the focus stays where it is.
CLICK_THROUGH = Qt.WindowType.WindowTransparentForInput | Qt.WindowType.WindowDoesNotAcceptFocus
# Open for a game in full screen: the clicks come to the window, and the focus still stays where it is.
NO_FOCUS = Qt.WindowType.WindowDoesNotAcceptFocus


def overlay_view(parent: QWidget, origin: str) -> QWidget:
    """The dashboard's view, on a page that is see-through where it draws nothing."""
    view = web_view(parent, origin)
    page = view.page()
    page.setBackgroundColor(Qt.GlobalColor.transparent)
    # A launch that fails leaves the page empty: Chromium's error page is opaque, and would cover the whole display.
    page.settings().setAttribute(QWebEngineSettings.WebAttribute.ErrorPageEnabled, False)
    return view


def zoom_for(size: int) -> float:
    """How large the overlay's page draws: the size chosen in Settings, in percent, the Board's 100 unless the player
    chooses larger, on any display. At a zoom of 1.5 the page sees a display a third smaller, and shows fewer, larger
    cells."""
    return size / 100


def screen_for(screens: Sequence[QScreen], name: str, primary: QScreen) -> QScreen:
    """The display the player chose, by its name. The main display when none was chosen (""), and when the chosen one
    is gone, unplugged or named otherwise after a change of setup: the overlay is never off screen."""
    if name:
        for screen in screens:
            if screen.name() == name:
                return screen
    return primary


class OverlayWindow(QWidget):
    opened = Signal()
    closed = Signal()

    def __init__(self, link: str, *, make_view: ViewFactory = overlay_view) -> None:
        super().__init__(None, ALWAYS | CLICK_THROUGH)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)  # the game keeps the focus
        self._link = link
        self._make_view = make_view
        self._view: QWidget | None = None
        self._open = False
        self._showing = False  # the window is to be seen: shown closed, or open
        # The launch link redirects to #/overlay, and that load sets the session cookie the page needs. Until it has
        # finished, the page's address is neither read nor set: its arrival at #/overlay is not the page closing
        # itself, and an address set before then would cut the launch short. Nor is the window shown until then: the
        # page turns see-through only once its script has run, and would cover the game for a moment.
        self._loaded = False
        self._launch_failed = False  # the last launch did not load: the next show loads it again
        self._zoom = 1.0  # how large the page draws, kept for each load
        self._full_screen_game = False  # the setting: open, the window takes the clicks but never the focus
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        # Every change of Qt's focus window, from whichever of Guild Board's windows: a change of activation reaches
        # only the window that loses it, and the focus may leave Guild Board from the dashboard.
        QGuiApplication.instance().focusWindowChanged.connect(self._on_focus_window_changed)

    def view(self) -> QWidget | None:
        return self._view

    @property
    def is_open(self) -> bool:
        return self._open

    @property
    def full_screen_game(self) -> bool:
        return self._full_screen_game

    def set_full_screen_game(self, on: bool) -> None:
        """The game runs in full screen: from the next opening, the open window takes the clicks but never the focus."""
        self._full_screen_game = on

    def place_on(self, screen: QScreen) -> None:
        """Covers all of the display."""
        self.setGeometry(screen.geometry())

    def set_zoom(self, factor: float) -> None:
        """How large the page draws: kept, and applied at once when the page has loaded. Its own view's alone: the
        dashboard's zoom follows its window."""
        self._zoom = factor
        if self._loaded:
            self._view.setZoomFactor(factor)

    def show_closed(self) -> None:
        """Shows the overlay closed: the pinned widgets and the lines over the game, which keeps the clicks and the
        focus. An open overlay closes. The window shows once its page has first loaded."""
        self.close_overlay()
        self._launch()
        self._showing = True
        if self._loaded:
            self._wake()
            self.show()

    def open(self) -> None:
        """Opens the overlay: the window takes the clicks and the focus, and the page shows every widget, with Edit.
        The window shows once its page has first loaded."""
        if self._open:
            return
        self._launch()
        self._open = self._showing = True
        self._click_through(False)
        if self._loaded:
            self._show_open()
        self.opened.emit()

    def close_overlay(self) -> None:
        """Closes the overlay: the window stays shown and lets clicks through again, and Windows hands the focus back
        to the window that had it."""
        if not self._open:
            return
        self._open = False  # first: the change of flags hides the window, and the focus leaves it
        self._click_through(True)
        if self._loaded:
            self.show()  # Qt hides a window whose flags change
        self._address(CLOSED)
        self.closed.emit()

    def hide_overlay(self) -> None:
        """Hides the window. An open overlay closes first. Its page stops while it is hidden: its renderer, its event
        stream and its minute's collection wait until the window shows again (SHL-9). A page still on its launch is left
        to finish it."""
        self.close_overlay()
        self._showing = False
        self.hide()
        if self._loaded:
            self._view.page().setLifecycleState(QWebEnginePage.LifecycleState.Frozen)

    def _wake(self) -> None:
        """A page stopped while the window was hidden runs again, before the window shows: Qt runs only a page that
        shows."""
        page = self._view.page()
        if page.lifecycleState() != QWebEnginePage.LifecycleState.Active:
            page.setLifecycleState(QWebEnginePage.LifecycleState.Active)

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        # Alt+F4 closes the open overlay, as Esc does. The window stays, for the pinned widgets and the lines.
        event.ignore()
        self.close_overlay()

    def _on_focus_window_changed(self, window: QWindow | None) -> None:
        # The focus went to another program (alt-tab, or a click on the taskbar), from this window or from another of
        # Guild Board's: the overlay closes, so the game is never left behind a layer that takes its clicks. On its
        # way between two of Guild Board's windows the focus may pass through none at all, so this looks again once
        # Qt has handled what is pending. A popup or another window of Guild Board's own keeps the overlay open.
        if window is None and self._open:
            QTimer.singleShot(0, self, self._close_if_the_focus_left)

    def _close_if_the_focus_left(self) -> None:
        if self._open and QGuiApplication.focusWindow() is None:
            self.close_overlay()

    def _launch(self) -> None:
        """Makes the view on the first show, and opens the overlay's launch link in it. A launch that failed is opened
        again; a page that has loaded never is, which would lose an Edit not saved yet."""
        if self._view is None:
            self._view = self._make_view(self, link_origin(self._link))
            self._layout.addWidget(self._view)
            self._view.urlChanged.connect(self._on_url_changed)
            self._view.loadFinished.connect(self._on_load_finished)
        elif self._loaded or not self._launch_failed:
            return
        self._launch_failed = False
        self._view.setUrl(QUrl(self._link + "&to=overlay"))

    def _show_open(self) -> None:
        self._wake()
        self.show()  # Qt hides a window whose flags change
        if self._full_screen_game:
            self._address(OPEN)  # the game keeps the focus and the keyboard: the hotkey or Close closes the overlay
            return
        self.raise_()
        self.activateWindow()
        self._view.setFocus()  # Esc goes to the page
        self._address(OPEN)

    def _click_through(self, on: bool) -> None:
        flags = self.windowFlags() & ~CLICK_THROUGH
        keeps_focus_away = on or self._full_screen_game
        self.setWindowFlags(flags | CLICK_THROUGH if on else flags | NO_FOCUS if keeps_focus_away else flags)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, keeps_focus_away)

    def _address(self, fragment: str) -> None:
        """Sets the page's address fragment, which the page follows without loading again: once the launch has
        loaded, and only when the page is not there already."""
        if not self._loaded:
            return
        url = self._view.url()
        if url.fragment() != fragment:
            url.setFragment(fragment)
            self._view.setUrl(url)

    def _on_load_finished(self, ok: bool) -> None:
        if ok:
            # Before the window shows. Chromium keeps a zoom with the page it has loaded, so each load takes it again; a
            # new fragment, as on opening and closing, keeps the page and its zoom.
            self._view.setZoomFactor(self._zoom)
        if self._loaded:
            return
        if not ok:  # no page to show, to tell or to hear
            self._launch_failed = True
            log.warning("the overlay's page could not be loaded; it is loaded again when the overlay next shows")
            self.close_overlay()  # an open overlay with nothing to show closes: the next press opens it, and loads it
            return
        self._loaded = True
        self._launch_failed = False
        # The window shows now, as it is at this moment: open, shown closed, or hidden.
        if self._open:
            self._show_open()  # opened while the launch loaded: the page is told now
            return
        self._address(CLOSED)
        if self._showing:
            self.show()

    def _on_url_changed(self, url: QUrl) -> None:
        if self._loaded and self._open and url.fragment() == CLOSED:
            self.close_overlay()  # the page asked: Esc, or Close
