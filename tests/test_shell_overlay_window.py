import logging
from types import SimpleNamespace

from PySide6.QtCore import QEvent, QRect, Qt, QUrl, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QLabel, QWidget

from guildboard.shell import overlay
from guildboard.shell.dashboard import CorePage
from guildboard.shell.overlay import OverlayWindow, overlay_view, screen_for, zoom_for

ORIGIN = "http://127.0.0.1:5000"
LINK = ORIGIN + "/launch?k=secret"
LAUNCH = LINK + "&to=overlay"
CLOSED = ORIGIN + "/#/overlay"  # where the launch's redirect lands
OPEN = ORIGIN + "/#/overlay/open"
CLICK_THROUGH = (Qt.WindowType.WindowTransparentForInput, Qt.WindowType.WindowDoesNotAcceptFocus)
ACTIVE, FROZEN = QWebEnginePage.LifecycleState.Active, QWebEnginePage.LifecycleState.Frozen


class StubPage:
    """Stands in for the view's page: its lifecycle state, which Qt keeps Active while the page shows."""

    def __init__(self, view: QWidget) -> None:
        self.view, self.state, self.refused, self.woke_hidden = view, ACTIVE, 0, None

    def lifecycleState(self) -> QWebEnginePage.LifecycleState:  # noqa: N802
        return self.state

    def setLifecycleState(self, state: QWebEnginePage.LifecycleState) -> None:  # noqa: N802
        if state != ACTIVE and self.view.isVisible():
            self.refused += 1  # Qt neither freezes nor discards a page that shows
            return
        if state == ACTIVE and self.state != ACTIVE:
            self.woke_hidden = not self.view.isVisible()
        self.state = state


class StubView(QLabel):
    """Stands in for the browser view: it records the addresses it is given. Its signals come as Qt WebEngine 6.11
    sends them: setUrl says so before it returns, the launch's redirect arrives before the load has finished, and a
    new fragment loads nothing."""

    urlChanged = Signal(QUrl)
    loadFinished = Signal(bool)

    def __init__(self, parent: QWidget, origin: str) -> None:
        super().__init__(parent)
        self.origin = origin
        self.addresses: list[str] = []
        self.zooms: list[tuple[float, bool]] = []  # each zoom it was given, and whether its window showed then
        self._url = QUrl()
        self._page = StubPage(self)

    def page(self) -> StubPage:
        return self._page

    def url(self) -> QUrl:
        return QUrl(self._url)

    def setZoomFactor(self, factor: float) -> None:  # noqa: N802
        self.zooms.append((factor, self.window().isVisible()))

    def setUrl(self, url: QUrl) -> None:  # noqa: N802
        self.addresses.append(url.toString())
        self._arrive(url)

    def lands(self, address: str) -> None:
        """The launch's redirect arrives there, and then the page has loaded."""
        self._arrive(QUrl(address))
        self.loadFinished.emit(True)

    def goes(self, address: str) -> None:
        """The page sets its own address, as it does on Esc or Close."""
        self._arrive(QUrl(address))

    def _arrive(self, url: QUrl) -> None:
        if url != self._url:
            self._url = QUrl(url)
            self.urlChanged.emit(QUrl(url))


class Display:
    """Stands in for a QScreen: its name, and where it is on the desktop."""

    def __init__(self, name: str, geometry: QRect) -> None:
        self._name = name
        self._geometry = geometry

    def name(self) -> str:
        return self._name

    def geometry(self) -> QRect:
        return self._geometry


def _shown_closed(qtbot) -> OverlayWindow:
    """The overlay while the game runs: shown closed, its page loaded."""
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.show_closed()
    window.view().lands(CLOSED)
    return window


def _takes_no_clicks_and_no_focus(window: OverlayWindow) -> bool:
    flags = window.windowFlags()
    return all(flags & flag for flag in CLICK_THROUGH) and window.testAttribute(
        Qt.WidgetAttribute.WA_ShowWithoutActivating
    )


def test_closed_takes_no_clicks_and_no_focus(qtbot):
    window = _shown_closed(qtbot)
    assert window.isVisible() and not window.is_open
    assert window.windowType() == Qt.WindowType.Tool  # no taskbar button
    for flag in (Qt.WindowType.FramelessWindowHint, Qt.WindowType.WindowStaysOnTopHint, *CLICK_THROUGH):
        assert window.windowFlags() & flag, flag
    assert window.testAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)  # the game keeps the focus
    assert window.testAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
    assert window.view().addresses == [LAUNCH]  # the redirect already landed on #/overlay


def _takes_clicks_but_no_focus(window: OverlayWindow) -> bool:
    flags = window.windowFlags()
    return (
        not flags & Qt.WindowType.WindowTransparentForInput
        and bool(flags & Qt.WindowType.WindowDoesNotAcceptFocus)
        and window.testAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
    )


def test_open_takes_clicks_and_says_so_in_the_address(qtbot):
    window = _shown_closed(qtbot)
    view = window.view()
    with qtbot.waitSignal(window.opened):
        window.open()
    assert window.is_open and window.isVisible()
    flags = window.windowFlags()
    assert not any(flags & flag for flag in CLICK_THROUGH)
    assert not window.testAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
    assert window.windowType() == Qt.WindowType.Tool
    assert flags & Qt.WindowType.FramelessWindowHint and flags & Qt.WindowType.WindowStaysOnTopHint
    assert window.focusWidget() is view  # Esc goes to the page
    assert view.addresses == [LAUNCH, OPEN]
    with qtbot.waitSignal(window.closed):
        window.close_overlay()
    assert not window.is_open and window.isVisible()  # still shown, for the pinned widgets and the lines
    assert _takes_no_clicks_and_no_focus(window)
    assert view.addresses == [LAUNCH, OPEN, CLOSED]


def test_for_a_game_in_full_screen_the_open_overlay_takes_clicks_but_never_the_focus(qtbot):
    # The game in full screen minimizes whenever another window takes the focus, as on Alt+Tab (2026-11-04, the focus
    # probe: a plain window, a browser panel and the whole overlay each minimized it). A window that takes the clicks
    # but never the focus left it in full screen, and its clicks reached the window, not the game.
    window = _shown_closed(qtbot)
    window.set_full_screen_game(True)
    view = window.view()
    with qtbot.waitSignal(window.opened):
        window.open()
    assert window.is_open and window.isVisible() and _takes_clicks_but_no_focus(window)
    assert QApplication.activeWindow() is not window
    flags = window.windowFlags()
    assert window.windowType() == Qt.WindowType.Tool
    assert flags & Qt.WindowType.FramelessWindowHint and flags & Qt.WindowType.WindowStaysOnTopHint
    assert view.addresses == [LAUNCH, OPEN]
    window.close_overlay()
    assert not window.is_open and window.isVisible() and _takes_no_clicks_and_no_focus(window)
    # The setting goes back off: the next opening takes the focus again, as it does by default.
    window.set_full_screen_game(False)
    window.open()
    assert not window.testAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
    assert not window.windowFlags() & Qt.WindowType.WindowDoesNotAcceptFocus
    assert window.focusWidget() is view  # Esc goes to the page


def test_the_page_closing_itself_makes_the_window_click_through(qtbot):
    window = _shown_closed(qtbot)
    view = window.view()
    window.open()
    with qtbot.waitSignal(window.closed):
        view.goes(CLOSED)  # Esc or Close in the page
    assert not window.is_open and window.isVisible()
    assert _takes_no_clicks_and_no_focus(window)
    assert view.addresses == [LAUNCH, OPEN]  # the page is at #/overlay already, so nothing is set again


def test_losing_the_focus_to_another_program_closes_the_overlay(qtbot, monkeypatch):
    window = _shown_closed(qtbot)
    window.open()
    closings: list[bool] = []
    window.closed.connect(lambda: closings.append(True))
    application = QGuiApplication.instance()
    focus = SimpleNamespace(window=None)
    # Qt's focus window, as Windows leaves it: none when another program has the focus.
    monkeypatch.setattr(
        overlay, "QGuiApplication", SimpleNamespace(focusWindow=lambda: focus.window, instance=QGuiApplication.instance)
    )
    for kind in (Qt.WindowType.Popup, Qt.WindowType.Window):  # a list the page opens, and the dashboard
        own = QWidget(None, kind)
        qtbot.addWidget(own)
        own.winId()  # its window, made without showing it
        focus.window = own.windowHandle()
        QApplication.sendEvent(window, QEvent(QEvent.Type.ActivationChange))
        application.focusWindowChanged.emit(focus.window)
        qtbot.wait(20)
        assert window.is_open and closings == [], kind  # a window of Guild Board's own keeps it open
    application.focusWindowChanged.emit(None)  # on its way between two of Guild Board's windows, for a moment
    qtbot.wait(20)
    assert window.is_open and closings == []
    # The player alt-tabs from the dashboard to the game: only the dashboard loses its activation, and the overlay
    # hears of it from Qt all the same.
    focus.window = None
    application.focusWindowChanged.emit(None)
    qtbot.waitUntil(lambda: closings == [True])
    assert not window.is_open and _takes_no_clicks_and_no_focus(window)
    application.focusWindowChanged.emit(None)
    qtbot.wait(20)
    assert closings == [True]  # closed already


def test_alt_f4_on_the_open_overlay_closes_it_and_the_window_stays(qtbot):
    window = _shown_closed(qtbot)
    window.open()
    with qtbot.waitSignal(window.closed):
        window.close()  # as Windows asks on Alt+F4
    assert not window.is_open and window.isVisible()  # for the pinned widgets and the lines
    assert _takes_no_clicks_and_no_focus(window)


def test_hiding_or_showing_closed_an_open_overlay_closes_it_once(qtbot):
    window = _shown_closed(qtbot)
    closings: list[bool] = []
    window.closed.connect(lambda: closings.append(True))
    window.open()
    window.hide_overlay()
    assert not window.is_open and not window.isVisible() and closings == [True]
    window.open()
    window.show_closed()
    assert not window.is_open and window.isVisible() and closings == [True, True]
    assert _takes_no_clicks_and_no_focus(window)


def test_the_page_stops_while_the_game_does_not_run_and_runs_again_before_it_shows(qtbot):
    # SHL-9: once the game has run, the overlay's renderer, its event stream and its minute's collection would carry on
    # for the session. Hidden while the game does not run, its page is frozen; it runs again before the window shows,
    # closed or opened by the hotkey.
    window = _shown_closed(qtbot)
    page = window.view().page()
    for show in (OverlayWindow.show_closed, OverlayWindow.open):
        window.hide_overlay()  # the game stopped
        assert not window.isVisible() and page.lifecycleState() == FROZEN
        show(window)
        assert window.isVisible() and page.lifecycleState() == ACTIVE
        assert page.woke_hidden is True  # set running while the window was still hidden
    assert page.refused == 0


def test_a_page_still_loading_is_not_frozen(qtbot):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.show_closed()
    window.hide_overlay()  # before its launch has loaded: frozen, it would never finish
    assert window.view().page().lifecycleState() == ACTIVE


def test_qt_freezes_a_page_as_soon_as_its_window_hides(qtbot):
    # What the overlay relies on, asked of the engine itself: a page that shows is never frozen, and one whose window has
    # just hidden is, at once.
    holder = QWidget()
    view = QWebEngineView(holder)
    with qtbot.waitSignal(view.loadFinished, timeout=10_000):
        view.setHtml("<p>x</p>")
    holder.show()
    view.page().setLifecycleState(FROZEN)
    assert view.page().lifecycleState() == ACTIVE  # refused while it shows
    holder.hide()
    view.page().setLifecycleState(FROZEN)
    assert view.page().lifecycleState() == FROZEN
    view.page().setLifecycleState(ACTIVE)
    holder.show()
    assert view.page().lifecycleState() == ACTIVE
    holder.deleteLater()
    qtbot.wait(10)


def test_opening_an_open_overlay_says_so_once(qtbot):
    window = _shown_closed(qtbot)
    openings: list[bool] = []
    window.opened.connect(lambda: openings.append(True))
    window.open()
    window.open()
    assert window.is_open and openings == [True]
    assert window.view().addresses == [LAUNCH, OPEN]  # and the page is told once


def test_screen_for_falls_back_to_the_primary_when_the_named_display_is_gone(qtbot):
    main = Display(r"\\.\DISPLAY1", QRect(0, 0, 3440, 1440))
    second = Display(r"\\.\DISPLAY2", QRect(3440, 0, 2560, 1440))
    assert screen_for([main, second], second.name(), main) is second
    assert screen_for([main, second], "", main) is main  # none chosen: the main display
    unplugged = screen_for([main], second.name(), main)
    assert unplugged is main
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.place_on(unplugged)
    assert window.geometry() == QRect(0, 0, 3440, 1440)  # all of the main display, never off screen


def test_the_view_is_made_once_and_loads_the_overlay_launch(qtbot):
    made: list[StubView] = []

    def make_view(parent: QWidget, origin: str) -> StubView:
        made.append(StubView(parent, origin))
        return made[-1]

    window = OverlayWindow(LINK, make_view=make_view)
    qtbot.addWidget(window)
    assert window.view() is None  # nothing loads before the window first shows
    window.show_closed()
    window.view().lands(CLOSED)
    window.hide_overlay()
    window.open()
    window.close_overlay()
    window.show_closed()
    assert made == [window.view()]
    assert made[0].origin == ORIGIN
    assert made[0].addresses == [LAUNCH, OPEN, CLOSED]
    qtbot.waitUntil(lambda: made[0].geometry() == window.rect())  # the page covers the window


def test_the_window_shows_only_once_its_page_has_loaded(qtbot):
    # Until its script has run, the page is not see-through yet: shown at once, it would cover the game for a moment.
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.show_closed()
    assert not window.isVisible() and window.view().addresses == [LAUNCH]
    window.view().lands(CLOSED)
    assert window.isVisible() and not window.is_open and _takes_no_clicks_and_no_focus(window)


def test_opening_before_the_page_has_loaded_opens_once_it_has(qtbot):
    # A start with the game closed: the first hotkey shows the window, and its launch link only then loads. The
    # redirect's arrival at #/overlay is not the page closing itself, and no address may cut the launch short.
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.open()
    view = window.view()
    assert window.is_open and view.addresses == [LAUNCH]
    assert not window.isVisible()  # until the page has loaded
    view.lands(CLOSED)
    assert window.is_open and window.isVisible() and not _takes_no_clicks_and_no_focus(window)
    assert window.focusWidget() is view  # Esc goes to the page
    assert view.addresses == [LAUNCH, OPEN]  # once loaded, the page is told that it is open
    with qtbot.waitSignal(window.closed):
        view.goes(CLOSED)  # and from now on it can close the overlay
    assert not window.is_open


def test_closing_before_the_page_has_loaded_leaves_the_launch_alone(qtbot):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.open()
    window.close_overlay()
    view = window.view()
    assert not window.isVisible()
    view.lands(CLOSED)
    assert not window.is_open and window.isVisible() and _takes_no_clicks_and_no_focus(window)  # shown, closed
    assert view.addresses == [LAUNCH]  # the redirect lands on #/overlay, as the window is


def test_a_window_hidden_before_its_page_has_loaded_stays_hidden(qtbot):
    # As when the game stops while the page loads: only the state when it has loaded counts.
    for show in (OverlayWindow.show_closed, OverlayWindow.open):
        window = OverlayWindow(LINK, make_view=StubView)
        qtbot.addWidget(window)
        show(window)
        window.hide_overlay()
        window.view().lands(CLOSED)
        assert not window.isVisible() and not window.is_open, show
        assert window.view().addresses == [LAUNCH], show


def test_a_launch_that_fails_does_not_count_as_loaded(qtbot):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.show_closed()
    view = window.view()
    view.loadFinished.emit(False)  # the launch failed: there is no page
    assert not window.isVisible()  # nothing to show
    assert view.addresses == [LAUNCH]  # no address is set on it


def test_a_launch_that_fails_while_open_closes_the_overlay_for_the_next_press(qtbot):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.open()  # the first press
    view = window.view()
    with qtbot.waitSignal(window.closed):
        view.loadFinished.emit(False)  # nothing to show: the overlay closes, and says so
    assert not window.is_open and not window.isVisible()
    window.open()  # so the next press opens it, and loads the launch again
    assert window.is_open and view.addresses == [LAUNCH, LAUNCH]
    view.goes(CLOSED)
    assert window.is_open  # while that try loads, no address is read from the page


def test_a_page_that_has_loaded_is_never_launched_again(qtbot):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.show_closed()
    view = window.view()
    view.loadFinished.emit(False)  # a failure said of the launch,
    view.lands(CLOSED)  # and then the page has loaded all the same
    window.open()
    window.close_overlay()
    window.hide_overlay()
    window.show_closed()
    # No second launch over the loaded page, which would lose an Edit not saved yet.
    assert view.addresses == [LAUNCH, OPEN, CLOSED]
    view.loadFinished.emit(False)  # nor after a failure said once the page has loaded
    window.open()
    assert window.is_open and view.addresses == [LAUNCH, OPEN, CLOSED, OPEN]


def test_a_launch_that_fails_says_so_and_loads_again_when_the_overlay_next_shows(qtbot, caplog):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.show_closed()
    view = window.view()
    with caplog.at_level(logging.WARNING):
        view.loadFinished.emit(False)  # a core too slow to answer, say
    assert "the overlay's page could not be loaded" in caplog.text
    window.open()  # the player opens the overlay
    assert view.addresses == [LAUNCH, LAUNCH]  # the launch link, again
    window.close_overlay()
    window.show_closed()
    assert view.addresses == [LAUNCH, LAUNCH]  # once: the second try is still loading
    assert not window.isVisible()
    window.open()
    view.lands(CLOSED)
    assert window.is_open and window.isVisible() and view.addresses == [LAUNCH, LAUNCH, OPEN]


def test_the_overlay_view_is_the_dashboards_on_a_see_through_page(qtbot):
    parent = QWidget()
    qtbot.addWidget(parent)
    view = overlay_view(parent, ORIGIN)
    page = view.page()
    assert isinstance(page, CorePage)  # only the core's own pages
    assert page.profile().isOffTheRecord()  # kept in memory only
    assert page.backgroundColor().alpha() == 0  # where the page draws nothing, the game shows through
    # A launch that fails leaves the page empty, not Chromium's opaque error page over the whole display.
    assert not page.settings().testAttribute(QWebEngineSettings.WebAttribute.ErrorPageEnabled)


def test_the_size_is_the_one_chosen_whatever_the_display():
    # The Board's size, 100%, unless the player chooses larger in Settings (Task 14, as the player corrected it).
    assert [zoom_for(size) for size in (100, 125, 150, 175, 200)] == [1.0, 1.25, 1.5, 1.75, 2.0]


def test_the_size_is_applied_once_the_page_has_loaded_and_again_with_each_load(qtbot):
    window = OverlayWindow(LINK, make_view=StubView)
    qtbot.addWidget(window)
    window.set_zoom(1.5)
    window.show_closed()
    view = window.view()
    assert view.zooms == []  # no page to size yet
    view.loadFinished.emit(False)  # a launch that failed: still nothing
    assert view.zooms == []
    window.show_closed()  # loaded again
    view.lands(CLOSED)
    assert view.zooms == [(1.5, False)]  # the size kept, before the window shows
    assert window.isVisible()
    window.set_zoom(1.25)  # a new size: at once, with no reload
    assert view.zooms[-1] == (1.25, True) and view.addresses == [LAUNCH, LAUNCH]
    window.open()
    window.close_overlay()
    assert len(view.zooms) == 2  # open and close keep the page, and its size
    view.loadFinished.emit(True)  # a load of its own, as a reload
    assert view.zooms[-1] == (1.25, True)  # takes the size again
