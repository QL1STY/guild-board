import json
import math
import subprocess
import sys
import time

import pytest
from PySide6.QtCore import QLockFile, QRect, QUrl, Signal
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QLabel, QWidget

from guildboard.shell.dashboard import (
    REFERENCE_WIDTH, RELEASE_AFTER_MS, CorePage, DashboardWindow, LinkCatcher, opens_outside, web_view, window_zoom,
)
from guildboard.shell.placement import WindowPlacement, first_run_screen, on_some_screen

LINK = "http://127.0.0.1:5000/launch?k=secret"
PRIMARY = QRect(0, 0, 3440, 1440)
SECOND = QRect(3440, 0, 2560, 1440)


class StubView(QLabel):
    """Stands in for the browser view: it records what it was asked to load, and each zoom it was given. Like the
    engine, it keeps the zoom it was given and gives it back."""

    loadFinished = Signal(bool)

    def __init__(self, parent: QWidget, origin: str) -> None:
        super().__init__(parent)
        self.origin = origin
        self.loaded: list[str] = []
        self.zooms: list[float] = []
        self._zoom = 1.0

    def load(self, url: QUrl) -> None:
        self.loaded.append(url.toString())

    def setZoomFactor(self, factor: float) -> None:  # noqa: N802
        self.zooms.append(factor)
        self._zoom = factor

    def zoomFactor(self) -> float:  # noqa: N802
        return self._zoom

    def forget_zoom(self) -> None:
        """What Chromium does when it replaces a page: the new one starts at 1."""
        self._zoom = 1.0

    def round_zoom_off(self) -> None:
        """What the engine does for some widths: it gives the zoom back with an error in its last digit."""
        self._zoom = math.nextafter(self._zoom, 3.0)


def test_the_first_window_opens_on_the_second_display():
    assert first_run_screen([PRIMARY, SECOND], primary=0) == 1
    assert first_run_screen([SECOND, PRIMARY], primary=1) == 0
    assert first_run_screen([PRIMARY], primary=0) == 0


def test_a_position_on_a_display_that_is_gone_is_not_used():
    assert on_some_screen(QRect(100, 100, 1200, 800), [PRIMARY, SECOND])
    assert on_some_screen(QRect(3600, 100, 1200, 800), [PRIMARY, SECOND])
    assert not on_some_screen(QRect(3600, 100, 1200, 800), [PRIMARY])  # the second display was unplugged
    assert not on_some_screen(QRect(3400, 100, 1200, 800), [PRIMARY])  # 40 pixels cannot be grabbed


def test_the_last_position_is_restored(qtbot, tmp_path):
    placement = WindowPlacement(tmp_path / "window.json")
    first = QWidget()
    qtbot.addWidget(first)
    first.setGeometry(20, 30, 640, 480)
    first.show()
    placement.save(first)
    second = QWidget()
    qtbot.addWidget(second)
    assert placement.restore(second, [QRect(0, 0, 800, 600)])
    assert second.geometry().size() == first.geometry().size()
    assert set(json.loads((tmp_path / "window.json").read_text(encoding="utf-8"))) == {"geometry"}
    assert not WindowPlacement(tmp_path / "none.json").restore(QWidget(), [QRect(0, 0, 800, 600)])


@pytest.mark.parametrize("text", ["", "[geometry]", "[]", '{"geometry": 7}', '{"geometry": "@@"}', '{"place": "AA=="}'])
def test_a_place_that_cannot_be_read_is_no_saved_place(qtbot, tmp_path, text):
    (tmp_path / "window.json").write_text(text, encoding="utf-8")
    window = QWidget()
    qtbot.addWidget(window)
    assert not WindowPlacement(tmp_path / "window.json").restore(window, [QRect(0, 0, 800, 600)])


def test_keeping_the_place_takes_no_lock_and_looks_up_no_process(qtbot, tmp_path):
    # Qt's INI settings take a lock file on every write. When one was left behind, Qt looks up the process whose id
    # it names, which could be the game by then (H2). Here the lock names a sleeping child of this test, as Qt names
    # it: Qt would wait 30 seconds for it, then delete the lock. The place is kept without a lock of any kind.
    sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    try:
        sample = QLockFile(str(tmp_path / "sample.lock"))  # Qt writes its own format, which names this process
        assert sample.tryLock(0)
        lines = (tmp_path / "sample.lock").read_bytes().split(b"\n")
        sample.unlock()
        left_behind = b"\n".join([str(sleeper.pid).encode("ascii"), *lines[1:]])
        lock = tmp_path / "window.json.lock"
        lock.write_bytes(left_behind)
        window = QWidget()
        qtbot.addWidget(window)
        started = time.monotonic()
        WindowPlacement(tmp_path / "window.json").save(window)
        assert time.monotonic() - started < 5
        assert lock.read_bytes() == left_behind
    finally:
        sleeper.kill()
        sleeper.wait()


def test_the_window_shows_the_interface_and_closing_keeps_guild_board_running(qtbot, tmp_path):
    window = DashboardWindow(LINK, WindowPlacement(tmp_path / "window.json"), make_view=StubView)
    qtbot.addWidget(window)
    window.open()
    assert window.isVisible()
    assert window.view().loaded == [LINK]
    assert window.view().origin == "http://127.0.0.1:5000"
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    assert not window.isVisible()
    assert window.view() is None  # the page is released, so only the core keeps running
    window.open()
    assert window.isVisible()
    assert window.view().loaded == [LINK]  # a fresh page


def test_a_closed_window_keeps_its_page_a_moment_so_that_what_it_sends_arrives(qtbot, tmp_path):
    # A note typed just before the window closes is saved as the page hides (Notes.tsx). The page goes a moment later,
    # not at once, so that its request is not cut off with it.
    window = DashboardWindow(LINK, WindowPlacement(tmp_path / "window.json"), make_view=StubView)
    qtbot.addWidget(window)
    window.open()
    view = window.view()
    gone: list[bool] = []
    view.destroyed.connect(lambda: gone.append(True))
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    assert window.view() is None  # the window lets go of it at once
    qtbot.wait(500)
    assert gone == []  # half a second later it is still there
    qtbot.waitUntil(lambda: gone == [True], timeout=RELEASE_AFTER_MS + 2_000)


def test_the_window_opens_on_a_place(qtbot, tmp_path):
    # A click on a reminder opens the Timers category: a window not shown yet takes the place with its launch link,
    # one that is open goes there.
    window = DashboardWindow(LINK, WindowPlacement(tmp_path / "window.json"), make_view=StubView)
    qtbot.addWidget(window)
    window.open("achievements/timers")
    assert window.view().loaded == [LINK + "&to=achievements/timers"]
    window.open("achievements/timers")
    assert window.view().loaded[-1] == "http://127.0.0.1:5000/#/achievements/timers"


def test_hiding_the_window_discards_its_browser(qtbot, tmp_path, qtlog):
    window = DashboardWindow(LINK, WindowPlacement(tmp_path / "window.json"))
    qtbot.addWidget(window)
    window.open()
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    qtbot.wait(200)
    assert window.findChildren(QWebEnginePage) == []
    assert window.findChildren(QWebEngineProfile) == []  # its memory goes too, not only the page
    assert not [record.message for record in qtlog.records if "profile" in record.message.lower()]


def test_without_a_tray_closing_the_window_ends_guild_board(qtbot, tmp_path):
    window = DashboardWindow(LINK, WindowPlacement(tmp_path / "window.json"), make_view=StubView, can_hide=False)
    qtbot.addWidget(window)
    window.open()
    with qtbot.waitSignal(window.ended):
        window.close()
    assert not window.isVisible()


def _open_window(qtbot, tmp_path) -> DashboardWindow:  # noqa: ANN001
    """An open window that is not maximized: a place was kept for it, and a window with none is maximized on its
    first open, which the display's platform delivers a moment later."""
    placement = WindowPlacement(tmp_path / "window.json")
    kept = QWidget()
    qtbot.addWidget(kept)
    kept.setGeometry(20, 30, 640, 480)
    kept.show()
    placement.save(kept)
    window = DashboardWindow(LINK, placement, make_view=StubView)
    qtbot.addWidget(window)
    window.open()
    return window


def test_the_page_may_put_a_picture_on_the_clipboard_but_not_read_it(qtbot):
    # The Gallery's Copy picture (the ledger design, section 7): without this, Qt WebEngine asks for a permission no one
    # answers, and the copy waits for ever (found with Qt WebEngine 140, 2026-10-27). Reading the clipboard stays off.
    from PySide6.QtWebEngineCore import QWebEngineSettings

    parent = QWidget()
    qtbot.addWidget(parent)
    settings = web_view(parent, "http://127.0.0.1:5000").page().settings()
    assert settings.testAttribute(QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard)
    assert not settings.testAttribute(QWebEngineSettings.WebAttribute.JavascriptCanPaste)


def test_the_page_keeps_a_small_cache_in_memory_as_its_pictures_are_on_this_computer(qtbot):
    # The window's cache is in memory, and left alone it grows to 2% of the computer's memory, up to 50 MB. A picture is a
    # moment away from the core, so a small cache holds a page's own files and the faces of the roster, and no more.
    from PySide6.QtWebEngineCore import QWebEngineProfile

    parent = QWidget()
    qtbot.addWidget(parent)
    profile = web_view(parent, "http://127.0.0.1:5000").page().profile()
    assert profile.httpCacheMaximumSize() == 16 * 1024 * 1024
    assert profile.httpCacheType() == QWebEngineProfile.HttpCacheType.MemoryHttpCache
    assert profile.isOffTheRecord()


def test_window_zoom_follows_the_width():
    assert window_zoom(1200) == 1.0  # a narrow window keeps today's size
    assert window_zoom(1640) == 1.0  # the player's usual window
    assert window_zoom(2560) == pytest.approx(2560 / 1640)  # full screen on the 2K display, about 1.56
    assert window_zoom(4000) == 2.0  # never more than twice


def test_the_window_zooms_its_page_to_its_width(qtbot, tmp_path):
    window = _open_window(qtbot, tmp_path)
    view = window.view()
    assert view.zooms == []  # a window narrower than 1,640 keeps today's size: the page is at it already
    window.resize(2560, 1400)
    assert view.zooms == [pytest.approx(2560 / 1640)]
    view.forget_zoom()  # a page loaded again starts at 1
    view.loadFinished.emit(True)
    assert len(view.zooms) == 2 and view.zooms[-1] == pytest.approx(2560 / 1640)
    window.resize(1640, 1000)
    assert len(view.zooms) == 3 and view.zooms[-1] == 1.0


def test_a_new_page_takes_the_windows_zoom(qtbot, tmp_path):
    # Hiding to the tray drops the page. The window opens a new one at the size it had, so no resize comes to zoom it.
    window = _open_window(qtbot, tmp_path)
    window.resize(2560, 1400)
    dropped = window.view()
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    window.open()
    view = window.view()
    assert view is not dropped
    assert view.zooms == [pytest.approx(2560 / 1640)]  # at once, so the page does not paint at 100% until it loads
    view.forget_zoom()  # the page loads, and starts at 1
    view.loadFinished.emit(False)  # no page loaded, so nothing to zoom
    assert len(view.zooms) == 1
    view.loadFinished.emit(True)
    assert len(view.zooms) == 2 and view.zooms[-1] == pytest.approx(2560 / 1640)


def test_a_resize_of_any_kind_reapplies_the_zoom(qtbot, tmp_path):
    # A maximize or a restore ends in a resize that the display's platform delivers a moment after the call, so each
    # is waited for. A resize of the window's own is delivered at once.
    window = _open_window(qtbot, tmp_path)
    view = window.view()

    def follows_the_width() -> bool:
        return view.zoomFactor() == window_zoom(window.width())

    window.resize(2560, 1400)
    assert window.width() == 2560 and follows_the_width()
    window.showMaximized()  # to the tests' display, which is narrower than 2,560
    qtbot.waitUntil(lambda: window.width() < 2560 and follows_the_width())
    window.showNormal()  # back to 2,560
    qtbot.waitUntil(lambda: window.width() == 2560 and follows_the_width())
    window.resize(1640, 1000)
    assert window.width() == 1640 and follows_the_width()


def test_a_resize_that_leaves_the_zoom_as_it_is_sets_nothing(qtbot, tmp_path):
    window = _open_window(qtbot, tmp_path)
    view = window.view()
    window.resize(700, 900)  # narrower than 1,640: the zoom is 1 at any width
    window.resize(700, 500)  # the height alone
    assert view.zooms == []
    window.resize(2560, 1400)
    window.resize(2560, 1000)  # the height alone, in a zoomed window
    window.resize(2560, 1400)
    assert view.zooms == [pytest.approx(2560 / 1640)]
    window.resize(2600, 1400)  # a width the zoom follows
    assert len(view.zooms) == 2 and view.zooms[-1] == pytest.approx(2600 / 1640)


def test_the_zoom_is_compared_with_the_engines_not_with_the_last_one_set(qtbot, tmp_path):
    # The engine may drop a zoom (a page it replaces starts at 1), so the window asks the view what zoom it has.
    window = _open_window(qtbot, tmp_path)
    view = window.view()
    window.resize(2560, 1400)
    applied = len(view.zooms)
    view.forget_zoom()
    window.resize(2560, 1000)  # the same width, but the page is at 1
    assert len(view.zooms) == applied + 1 and view.zooms[-1] == pytest.approx(2560 / 1640)


def test_a_rounding_error_in_the_engines_zoom_is_no_difference(qtbot, tmp_path):
    window = _open_window(qtbot, tmp_path)
    view = window.view()
    window.resize(2560, 1400)
    applied = len(view.zooms)
    view.round_zoom_off()
    assert view.zoomFactor() != window_zoom(2560)
    window.resize(2560, 1000)
    assert len(view.zooms) == applied


def test_a_window_with_no_page_has_nothing_to_zoom(qtbot, tmp_path):
    window = DashboardWindow(LINK, WindowPlacement(tmp_path / "window.json"), make_view=StubView)
    qtbot.addWidget(window)
    window.show()  # shown before open(), so there is no page yet
    window.resize(2560, 1400)  # an error raised by this resize fails the test: pytest-qt reports it
    assert window.view() is None


def test_a_page_let_go_is_not_zoomed_by_a_load_that_ends_after_it(qtbot, tmp_path):
    # A closed window lets its page go a moment later, not at once, so a load of that page may still end in between.
    window = _open_window(qtbot, tmp_path)
    window.resize(2560, 1400)
    dropped = window.view()
    with qtbot.waitSignal(window.hidden_to_tray):
        window.close()
    assert window.view() is None
    applied = len(dropped.zooms)
    dropped.forget_zoom()
    dropped.loadFinished.emit(True)  # an error raised by this fails the test: pytest-qt reports it
    assert len(dropped.zooms) == applied and window.view() is None


def _engine_view(qtbot) -> QWebEngineView:  # noqa: ANN001
    """A real browser view, shown, with a profile kept in memory only like the dashboard's. It is not `web_view`: that
    page accepts only the core's own addresses, and these tests load a page of their own."""
    view = QWebEngineView()
    profile = QWebEngineProfile()  # without a name: kept in memory only
    page = QWebEnginePage(profile, view)
    profile.setParent(page)  # deleted with the page, and after it
    view.setPage(page)
    view.resize(2560, 1400)
    qtbot.addWidget(view)
    view.show()
    return view


def test_the_engine_gives_a_zoom_back_as_it_was_set_and_keeps_it_through_a_load(qtbot):
    # _apply_zoom asks the view for its zoom and allows 1e-6 (dashboard.py). That rests on the engine, which StubView
    # only imitates: once a page has loaded, a zoom comes back with at most a rounding error in its last digit, and a
    # zoom set before a load is still there after it.
    view = _engine_view(qtbot)
    factor = 2560 / 1640
    view.setZoomFactor(factor)
    assert math.isclose(view.zoomFactor(), factor, abs_tol=1e-6)
    with qtbot.waitSignal(view.loadFinished, timeout=20_000) as loaded:
        view.setHtml("<p>A page of its own.</p>")
    assert loaded.args == [True]
    assert math.isclose(view.zoomFactor(), factor, abs_tol=1e-6)
    for width in range(REFERENCE_WIDTH, 2 * REFERENCE_WIDTH + 1):  # every width at which the zoom changes
        view.setZoomFactor(window_zoom(width))
        assert math.isclose(view.zoomFactor(), window_zoom(width), abs_tol=1e-6), width


def test_a_zoom_set_right_after_a_load_starts_is_in_place_for_the_pages_first_frame(qtbot):
    # open() zooms a new page right after it starts loading, so that no frame is painted at 100%. The page notes the
    # pixel ratio it sees at its first animation frame, which is the zoom.
    view = _engine_view(qtbot)
    view.setHtml("<script>requestAnimationFrame(() => { document.title = 'frame ' + devicePixelRatio })</script>")
    view.setZoomFactor(2560 / 1640)
    qtbot.waitUntil(lambda: view.title().startswith("frame "), timeout=10_000)
    assert float(view.title().removeprefix("frame ")) == pytest.approx(2560 / 1640, abs=1e-6)


def test_only_wiki_addresses_and_pages_of_the_map_open_outside():
    assert opens_outside("https://genshin-impact.fandom.com/wiki/Special:Search?query=Zoo%20Tycoon")
    assert opens_outside("https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=en-us#/map/2")  # Map: Open in your browser
    assert not opens_outside("https://act.hoyolab.com/other")
    assert opens_outside("https://akasha.cv/profile/700000001")  # the profile card's links
    assert opens_outside("https://enka.network/u/700000001")
    assert opens_outside("https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys")
    assert not opens_outside("https://akasha.cv.evil.com/")
    # Settings, About: the source and the privacy notice, in the public repository and nowhere else on GitHub.
    assert opens_outside("https://github.com/QL1STY/guild-board/")
    assert opens_outside("https://github.com/QL1STY/guild-board/blob/main/PRIVACY.md")
    assert not opens_outside("https://github.com/QL1STY/guild-board")
    assert not opens_outside("https://github.com/QL1STY/guild-board-releases/releases/latest")
    assert not opens_outside("https://github.com/QL1STY/guild-board.evil.io/")
    assert not opens_outside("https://github.com/someone-else/guild-board/")
    for url in ("https://evil.example/", "http://genshin-impact.fandom.com/wiki/x",
                "https://genshin-impact.fandom.com.evil.io/", "file:///C:/Windows"):
        assert not opens_outside(url), url


def test_a_link_to_the_wiki_opens_in_the_players_browser_and_nothing_else_does(qtbot):
    opened: list[str] = []
    for url in ("https://genshin-impact.fandom.com/wiki/Zoo_Tycoon", "https://evil.example/"):
        profile = QWebEngineProfile()
        catcher = LinkCatcher(profile, open_url=lambda address: opened.append(address.toString()))
        profile.setParent(catcher)
        assert catcher.acceptNavigationRequest(QUrl(url), QWebEnginePage.NavigationType.NavigationTypeLinkClicked, True) is False
    assert opened == ["https://genshin-impact.fandom.com/wiki/Zoo_Tycoon"]


def test_the_dashboard_page_hands_new_windows_to_a_catcher(qtbot):
    profile = QWebEngineProfile()
    page = CorePage(profile, None, "http://127.0.0.1:4321")
    profile.setParent(page)
    catcher = page.createWindow(QWebEnginePage.WebWindowType.WebBrowserTab)
    assert isinstance(catcher, LinkCatcher)
    assert catcher.profile() is profile  # Qt hands a new window's content only to a page of the opener's profile
    assert catcher.parent() is page  # owned by the page, so Python does not delete it as soon as createWindow returns
    catcher.deleteLater()
    qtbot.wait(10)  # the catcher goes first, before the page and its profile
