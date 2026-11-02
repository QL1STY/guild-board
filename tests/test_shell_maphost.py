import pytest
from PySide6.QtCore import QRect, QUrl, Signal
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineScript, QWebEngineSettings
from PySide6.QtWidgets import QLabel, QWidget

from guildboard.shell.maphost import ROLE_SEEN_SCRIPT, SEEN_SCRIPT, MapEngine, MapHost, MapPage, area_rect, on_map_page

FISHING = "https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=en-us#/map/2?shown_types=5"


ACTIVE, DISCARDED = QWebEnginePage.LifecycleState.Active, QWebEnginePage.LifecycleState.Discarded


class StubPage:
    def __init__(self, view):
        self.view, self.state, self.refused = view, ACTIVE, 0

    def setLifecycleState(self, state):
        if state == DISCARDED and not self.view.isHidden():
            self.refused += 1  # Qt refuses a visible page
            return
        if state == ACTIVE:
            self.view.hidden_when_woken = self.view.isHidden()
        self.state = state

    def lifecycleState(self):
        return self.state


class StubView(QLabel):
    urlChanged = Signal(QUrl)
    titleChanged = Signal(str)
    loadFinished = Signal(bool)

    def __init__(self, parent):
        super().__init__(parent)
        self.loaded, self.reloads = [], 0
        self._page = StubPage(self)
        self.hidden_when_woken = None

    def page(self):
        return self._page

    def load(self, url):
        self.loaded.append(url.toString())

    def reload(self):
        self.reloads += 1


class StubEngine:
    def __init__(self):
        self.cookies, self.signed_out = None, 0

    def view(self, parent):
        return StubView(parent)

    def sign_in(self, cookies, role=None):
        self.cookies, self.role = dict(cookies), role

    def sign_out(self):
        self.signed_out += 1
        self.cookies = None


def snapshot(*tabs, active=None, area=None):
    return {"tabs": [{"id": i, "url": u, "reload": 0} for i, u in tabs], "active": active or tabs[0][0], "viewport": area}


AREA = {"x": 10, "y": 20, "w": 400, "h": 300, "hidden": False}


@pytest.fixture
def host(qtbot):
    heard = {"seen": [], "failed": []}
    host = MapHost(lambda *a: heard["seen"].append(a), lambda *a: heard["failed"].append(a), engine=StubEngine(),
                   sleep_ms=60)
    host.heard = heard
    yield host
    host.close()


@pytest.fixture
def holder(qtbot):
    widget = QWidget()
    widget.resize(1000, 800)
    qtbot.addWidget(widget)
    return widget


def test_the_interface_shows_the_map_only_at_its_map_address():
    assert on_map_page("http://127.0.0.1:5000/#/map")
    assert on_map_page("http://127.0.0.1:5000/#/map/2")
    assert not on_map_page("http://127.0.0.1:5000/#/mapping")
    assert not on_map_page("http://127.0.0.1:5000/#/board") and not on_map_page("http://127.0.0.1:5000/")


def test_the_area_is_scaled_by_the_pages_zoom():
    assert area_rect({"x": 10, "y": 20.4, "w": 400, "h": 300}, 1.5) == QRect(15, 31, 600, 450)


def test_the_map_only_goes_to_hoyoverse_pages_and_opens_no_windows():
    page = MapPage.__new__(MapPage)  # the check needs no engine
    ask = MapPage.acceptNavigationRequest
    assert ask(page, QUrl("https://act.hoyolab.com/ys/app/interactive-map/index.html"), None, True)
    assert ask(page, QUrl("https://account.hoyoverse.com/login"), None, True)
    assert not ask(page, QUrl("https://example.net/"), None, True)
    assert not ask(page, QUrl("http://act.hoyolab.com/"), None, True)
    assert MapPage.createWindow(page, None) is None


def test_a_frame_stays_on_hoyoverse_too():
    # M18: only frames reach the check, never what a page draws, so a frame of another site, or an address of another
    # program's, is a navigation like any other. An empty frame a page makes for itself is the one exception.
    page = MapPage.__new__(MapPage)
    ask = MapPage.acceptNavigationRequest
    assert ask(page, QUrl("https://act.hoyolab.com/ys/app/interactive-map/frame.html"), None, False)
    assert ask(page, QUrl("about:blank"), None, False) and ask(page, QUrl("about:srcdoc"), None, False)
    for elsewhere in (
        "https://example.net/", "http://act.hoyolab.com/", "search-ms:query=x&crumb=location:\\\\attacker\\share",
        "ms-settings:privacy", "file:///C:/Windows/win.ini", "data:text/html,<p>look-alike login</p>",
    ):
        assert not ask(page, QUrl(elsewhere), None, False), elsewhere
    assert not ask(page, QUrl("about:blank"), None, True)  # the map itself is never an empty page


def test_a_map_page_that_comes_to_an_empty_page_goes_back(qtbot, monkeypatch):
    # about:blank set from a frame never reaches acceptNavigationRequest, so the page checks where it has come to.
    went_back: list[bool] = []
    monkeypatch.setattr(MapPage, "_go_back", lambda self: went_back.append(True))
    engine, holder = MapEngine(), QWidget()
    page = engine.view(holder).page()
    page.urlChanged.emit(QUrl(FISHING))
    page.urlChanged.emit(QUrl())
    assert went_back == []
    for elsewhere in ("about:blank", "https://example.net/"):
        page.urlChanged.emit(QUrl(elsewhere))
    assert went_back == [True, True]
    holder.deleteLater()
    qtbot.wait(10)


def test_the_map_hands_no_scheme_to_windows(qtbot):
    # A click that leads to an address of a scheme Chromium does not know would go to Windows, which opens the program
    # registered for it without asking. The map's views refuse every such address.
    engine, holder = MapEngine(), QWidget()
    view = engine.view(holder)
    policy = view.page().settings().unknownUrlSchemePolicy()
    holder.deleteLater()
    qtbot.wait(10)  # the view and its page go first, before the engine and its profile
    assert policy == QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes


def test_the_views_open_with_the_sites_notices_already_seen(qtbot):
    # The profile is kept in memory, so the site would show its cookie notice, tutorial and update log at every start:
    # each page begins with the marks the site leaves once they are closed, unless the player's own are there.
    engine = MapEngine()
    scripts = engine._profile_in_use().scripts().find(SEEN_SCRIPT)
    assert len(scripts) == 1
    script = scripts[0]
    assert script.injectionPoint() == QWebEngineScript.InjectionPoint.DocumentCreation
    assert not script.runsOnSubFrames()
    for mark in ("user-guide-passed", "CookieTips-mapsea_cache_by_act.hoyolab/ys/app/interactive-map/index.html",
                 "async-announcement-hidden-ts"):
        assert mark in script.sourceCode()
    assert "getItem" in script.sourceCode()  # a mark already there stays as it is


def test_no_view_is_made_before_the_session_is_known(host, holder):
    host.apply(snapshot((1, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    assert holder.findChildren(StubView) == []
    host.set_session(None)
    host.apply(snapshot((1, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    assert view.loaded == [FISHING]


def test_the_session_goes_into_the_profile_and_a_later_one_reloads_the_views(host, holder):
    host.set_session({"ltoken_v2": "a"})
    assert host._engine.cookies == {"ltoken_v2": "a"}
    host.apply(snapshot((1, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    host.set_session({"ltoken_v2": "b"})
    assert host._engine.cookies == {"ltoken_v2": "b"} and view.reloads == 1
    host.set_session(None)
    assert host._engine.cookies is None


def test_only_the_active_tab_shows_and_it_fills_the_area_at_the_pages_zoom(host, holder):
    host.set_session(None)
    host.apply(snapshot((1, FISHING), (2, FISHING + "&x"), active=2, area=AREA), holder, zoom=2.0, on_page=True)
    [view] = holder.findChildren(StubView)
    assert view.loaded == [FISHING + "&x"] and not view.isHidden()
    assert view.geometry() == QRect(20, 40, 800, 600)
    host.apply(snapshot((1, FISHING), (2, FISHING + "&x"), active=1, area=AREA), holder, zoom=2.0, on_page=True)
    shown = {v.loaded[0]: not v.isHidden() for v in holder.findChildren(StubView)}
    assert shown == {FISHING: True, FISHING + "&x": False}


@pytest.mark.parametrize("on_page, area", [
    (False, AREA), (True, None), (True, {**AREA, "hidden": True}), (True, {**AREA, "w": 0}),
])
def test_no_view_shows_when_the_page_is_elsewhere_or_something_covers_the_area(host, holder, on_page, area):
    host.set_session(None)
    host.apply(snapshot((1, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    host.apply(snapshot((1, FISHING), area=area), holder, zoom=1.0, on_page=on_page)
    [view] = holder.findChildren(StubView)
    assert view.isHidden()


def test_closed_tabs_lose_their_views_and_a_closed_window_loses_all_of_them(host, holder):
    host.set_session(None)
    host.apply(snapshot((1, FISHING), (2, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    host.apply(snapshot((2, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    assert len(host._views) == 1 and 2 in host._views
    host.apply(snapshot((2, FISHING), area=AREA), None, zoom=1.0, on_page=True)  # the window closed
    assert host._views == {}
    host.apply(snapshot((2, FISHING), area=AREA), holder, zoom=1.0, on_page=True)  # and opened again
    assert len(host._views) == 1


def test_a_reload_asked_for_reloads_that_view_once(host, holder):
    host.set_session(None)
    host.apply(snapshot((1, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    more = snapshot((1, FISHING), area=AREA)
    more["tabs"][0]["reload"] = 1
    host.apply(more, holder, zoom=1.0, on_page=True)
    host.apply(more, holder, zoom=1.0, on_page=True)
    assert view.reloads == 1


def test_a_new_view_takes_the_reloads_asked_before_it_without_reloading(host, holder):
    host.set_session(None)
    reopened = snapshot((1, FISHING), area=AREA)
    reopened["tabs"][0]["reload"] = 3  # a tab reloaded before it was closed and opened again, or before the window
    host.apply(reopened, holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    assert view.loaded == [FISHING] and view.reloads == 0
    host.apply(reopened, holder, zoom=1.0, on_page=True)
    assert view.reloads == 0


def test_the_core_hears_the_last_address_and_title_and_whether_a_load_failed(host, holder):
    host.set_session(None)
    host.apply(snapshot((7, FISHING), area=AREA), holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    view.urlChanged.emit(QUrl(FISHING + "&a=1"))
    view.urlChanged.emit(QUrl(FISHING + "&a=2"))
    view.titleChanged.emit("Teyvat Interactive Map - HoYoLAB")
    assert host.heard["seen"] == []  # a map in motion is not reported at every step
    host.flush()
    assert host.heard["seen"] == [(7, FISHING + "&a=2", "Teyvat Interactive Map - HoYoLAB")]
    host.flush()
    assert len(host.heard["seen"]) == 1
    view.loadFinished.emit(False)
    view.loadFinished.emit(True)
    assert host.heard["failed"] == [(7, True), (7, False)]


def two_tabs(host, holder, *, active, on_page=True):
    host.apply(snapshot((1, FISHING), (2, FISHING + "&x"), active=active, area=AREA), holder, zoom=1.0, on_page=on_page)
    return sorted(holder.findChildren(StubView), key=lambda v: v.loaded[0])


def test_no_map_loads_while_the_page_is_elsewhere(host, holder):
    # M19: a map holds hundreds of megabytes. A window opened from the tray to tick an achievement loads none, and the
    # Map page loads the active tab's alone.
    host.set_session(None)
    tabs = snapshot((1, FISHING), (2, FISHING + "&x"), (3, FISHING + "&y"), active=2, area=AREA)
    host.apply(tabs, holder, zoom=1.0, on_page=False)
    assert holder.findChildren(StubView) == []
    host.apply(tabs, holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    assert view.loaded == [FISHING + "&x"] and not view.isHidden()
    host.apply(tabs, holder, zoom=1.0, on_page=False)  # leaving the page makes no other
    assert holder.findChildren(StubView) == [view]


def test_switching_tabs_makes_the_new_one_and_puts_the_one_left_to_sleep(host, holder):
    host.set_session(None)
    [first] = two_tabs(host, holder, active=1)
    first_again, second = two_tabs(host, holder, active=2)  # made only now that it is active
    assert first_again is first and second.loaded == [FISHING + "&x"] and not second.isHidden()
    assert first.page().state == DISCARDED and first.page().refused == 0
    assert second.page().state == ACTIVE


def test_a_view_never_shown_sleeps_once_its_first_load_has_finished(host, holder, qtbot):
    host.set_session(None)
    covered = snapshot((1, FISHING), area={**AREA, "hidden": True})  # on the Map page, with a dialog over the area
    host.apply(covered, holder, zoom=1.0, on_page=True)
    [view] = holder.findChildren(StubView)
    assert view.isHidden()
    host.apply(covered, holder, zoom=1.0, on_page=False)  # the player leaves before it ever showed
    qtbot.wait(150)
    assert view.page().state == ACTIVE  # still on its first load, which has no address to wake at yet
    view.loadFinished.emit(True)
    qtbot.waitUntil(lambda: view.page().state == DISCARDED, timeout=2000)
    assert view.page().refused == 0


def test_leaving_the_map_page_puts_the_active_view_to_sleep_only_after_the_delay(host, holder, qtbot):
    host.set_session(None)
    view = two_tabs(host, holder, active=1)[0]
    host.apply(snapshot((1, FISHING), (2, FISHING + "&x"), active=1, area=AREA), holder, zoom=1.0, on_page=False)
    assert view.isHidden() and view.page().state == ACTIVE
    qtbot.waitUntil(lambda: view.page().state == DISCARDED, timeout=2000)
    assert view.page().refused == 0


def test_coming_back_within_the_delay_keeps_the_view_awake(host, holder, qtbot):
    host.set_session(None)
    view = two_tabs(host, holder, active=1)[0]
    away = snapshot((1, FISHING), (2, FISHING + "&x"), active=1, area=AREA)
    host.apply(away, holder, zoom=1.0, on_page=False)
    host.apply(away, holder, zoom=1.0, on_page=True)
    qtbot.wait(200)
    assert view.page().state == ACTIVE and not view.isHidden()


def test_a_sleeping_view_is_set_active_before_it_shows_and_its_reload_is_not_news(host, holder):
    host.set_session(None)
    [first] = two_tabs(host, holder, active=1)
    two_tabs(host, holder, active=2)
    assert first.page().state == DISCARDED
    two_tabs(host, holder, active=1)
    assert first.page().state == ACTIVE and first.hidden_when_woken is True and not first.isHidden()
    first.urlChanged.emit(QUrl(FISHING + "&z"))  # the page finding its way back
    first.titleChanged.emit("Loading")
    first.loadFinished.emit(False)  # the reload Chromium does on waking
    host.flush()
    assert host.heard["seen"] == [] and host.heard["failed"] == []
    first.loadFinished.emit(False)  # a later failure is a failure
    assert host.heard["failed"] == [(1, True)]


def test_a_sleeping_view_is_not_reloaded_by_a_new_session(host, holder):
    host.set_session(None)
    [first] = two_tabs(host, holder, active=1)
    two_tabs(host, holder, active=2)
    host.set_session({"ltoken_v2": "x"})
    assert first.reloads == 0


ROLE = {"uid": "700000001", "region": "os_euro"}


def test_the_role_the_map_asks_for_is_given_to_it_for_the_account(qtbot):
    engine = MapEngine()
    engine.sign_in({"ltuid_v2": "123"}, ROLE)
    [script] = engine._profile_in_use().scripts().find(ROLE_SEEN_SCRIPT)
    source = script.sourceCode()
    assert script.injectionPoint() == QWebEngineScript.InjectionPoint.DocumentCreation
    assert not script.runsOnSubFrames()
    # The keys and the shape the map's own storage reads: no suffix, and the value as {createdTime, cacheTime, data}.
    assert '"123:roleGameRegionStorageKey"' in source and '"123:roleGameUIDStorageKey"' in source
    assert '"os_euro"' in source and '"700000001"' in source
    assert "getItem" in source and "cacheTime: 0" in source
    engine.sign_in({"account_id_v2": "456"}, ROLE)
    [script] = engine._profile_in_use().scripts().find(ROLE_SEEN_SCRIPT)
    assert '"456:roleGameRegionStorageKey"' in script.sourceCode()
    engine.sign_out()
    assert engine._profile_in_use().scripts().find(ROLE_SEEN_SCRIPT) == []


@pytest.mark.parametrize("cookies, role", [
    ({"ltuid_v2": "12'; alert(1);//"}, ROLE),  # an account id that is not digits
    ({"ltuid_v2": "123"}, {"uid": "7'; alert(1);//", "region": "os_euro"}),
    ({"ltuid_v2": "123"}, {"uid": "700000001", "region": "os_euro'; alert(1);//"}),
    ({"ltuid_v2": "123"}, {"uid": "", "region": ""}),
    ({"ltuid_v2": "123"}, None),  # no role known: the map asks, as it must
])
def test_a_role_that_is_not_plain_makes_no_script(qtbot, cookies, role):
    engine = MapEngine()
    engine.sign_in(cookies, role)
    assert engine._profile_in_use().scripts().find(ROLE_SEEN_SCRIPT) == []
