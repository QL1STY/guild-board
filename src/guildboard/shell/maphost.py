"""The map views of the Map page (the Map design, section 3): one browser view for each tab the player has looked at,
children of the interface's view, laid over the empty area the Map page leaves for them.

The interface is a page and loads nothing from the internet, so HoYoLAB's map cannot be a frame in it. Each view shows
only HoYoLAB's own pages, all in one profile kept in memory, which holds the session the player's login gave. The
core knows the tabs and where the area is; this follows what it says."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Mapping

from PySide6.QtCore import QObject, QRect, Qt, QTimer, QUrl
from PySide6.QtNetwork import QNetworkCookie
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineScript, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QWidget

from guildboard import netpolicy

log = logging.getLogger(__name__)

SLEEP_AFTER_MS = 60_000  # the active map sleeps this long after the player leaves the Map page
SEEN_AFTER_MS = 1_000  # a map in motion changes its address all the time: the core hears of the last one
COOKIE_DOMAIN = ".hoyolab.com"
COOKIE_ORIGIN = "https://act.hoyolab.com/"
# HoYoLAB sets these HttpOnly itself.
HIDDEN_FROM_SCRIPTS = ("ltoken_v2", "cookie_token_v2", "ltoken", "cookie_token")
MAP_PLACE = "/map"  # the interface's address while its Map page shows: "#/map"
# The profile is kept in memory, so the site's local storage starts empty at every start of Guild Board and the map
# would show its cookie notice, its tutorial and its update log each time. Each page begins with the marks the site
# leaves in local storage once they are closed, unless the player's own are there already.
SEEN_SCRIPT = "guildboard-notices-seen"
SEEN_SOURCE = """try {
  for (const [key, value] of [
    ['user-guide-passed', 'true'],
    ['CookieTips-mapsea_cache_by_act.hoyolab/ys/app/interactive-map/index.html',
     JSON.stringify({ createdTime: Date.now(), cacheTime: 0, data: true })],
    ['async-announcement-hidden-ts', String(Date.now())],
  ]) if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
} catch (e) {}"""
# The map asks once for the player's server and game account, and keeps the answer in local storage under the HoYoLAB
# account's number, as `<account>:roleGameRegionStorageKey` and `<account>:roleGameUIDStorageKey`, each as
# {createdTime, cacheTime, data}. That is lost with the profile at every start, so the page begins with the answer the
# login already holds, unless it is there already.
ROLE_SEEN_SCRIPT = "guildboard-role-seen"
ROLE_SEEN_SOURCE = """try {
  for (const [key, data] of [[%s, %s], [%s, %s]])
    if (localStorage.getItem(key) === null)
      localStorage.setItem(key, JSON.stringify({ createdTime: Date.now(), cacheTime: 0, data }))
} catch (e) {}"""
ACCOUNT_COOKIES = ("ltuid_v2", "account_id_v2")
REGION = re.compile(r"[a-z0-9_]{1,20}")


def on_map_page(url: str) -> bool:
    """Whether the interface's own address (`http://127.0.0.1:port/#/map`) is the Map page's."""
    fragment = QUrl(url).fragment()
    return fragment == MAP_PLACE or fragment.startswith((MAP_PLACE + "/", MAP_PLACE + "?"))


def area_rect(area: Mapping[str, Any], zoom: float) -> QRect:
    """The area, in the interface's CSS pixels, as the rectangle it is in the view that holds the page: the page is
    drawn at `zoom`, so a CSS pixel is that many of Qt's."""
    return QRect(round(area["x"] * zoom), round(area["y"] * zoom), round(area["w"] * zoom), round(area["h"] * zoom))


class MapPage(QWebEnginePage):
    """A page that stays on HoYoLAB: a link to anywhere else, or to a new window, goes nowhere."""

    def acceptNavigationRequest(self, url: QUrl, kind: QWebEnginePage.NavigationType, is_main_frame: bool) -> bool:
        # Only frames come here, never what a page draws, so a frame is held to HoYoverse's pages as the page itself is.
        # An empty frame a page makes for itself (about:blank, about:srcdoc) is the one exception.
        return netpolicy.is_hoyoverse(url.toString()) or (not is_main_frame and url.scheme() == "about")

    def createWindow(self, kind: QWebEnginePage.WebWindowType) -> QWebEnginePage | None:
        return None

    def __init__(self, profile: QWebEngineProfile, parent: QObject) -> None:
        super().__init__(profile, parent)
        self.urlChanged.connect(self._moved)

    def _moved(self, url: QUrl) -> None:
        # An empty page (about:blank) set from another frame never reaches acceptNavigationRequest: back to the map.
        if not url.isEmpty() and not netpolicy.is_hoyoverse(url.toString()):
            self._go_back()

    def _go_back(self) -> None:
        self.triggerAction(QWebEnginePage.WebAction.Back)

    def javaScriptConsoleMessage(self, level, message: str, line: int, source: str) -> None:
        pass  # the site's console stays out of the log


class MapEngine:
    """Makes the views, in one profile kept in memory, and puts the session into it."""

    def __init__(self) -> None:
        self._profile: QWebEngineProfile | None = None

    def _profile_in_use(self) -> QWebEngineProfile:
        if self._profile is None:
            self._profile = QWebEngineProfile()  # without a name: kept in memory only
            seen = QWebEngineScript()
            seen.setName(SEEN_SCRIPT)
            seen.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            seen.setRunsOnSubFrames(False)
            seen.setSourceCode(SEEN_SOURCE)
            self._profile.scripts().insert(seen)
        return self._profile

    def view(self, parent: QWidget) -> QWebEngineView:
        view = QWebEngineView(parent)
        page = MapPage(self._profile_in_use(), view)
        # An address of a scheme Chromium does not know would go to Windows, which opens whatever program is registered
        # for it without asking (search-ms: opens Explorer on another computer's share): the map's views refuse them all.
        page.settings().setUnknownUrlSchemePolicy(QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes)
        view.setPage(page)
        view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        return view

    def _forget_role_script(self) -> None:
        scripts = self._profile_in_use().scripts()
        for old in scripts.find(ROLE_SEEN_SCRIPT):
            scripts.remove(old)

    def sign_in(self, cookies: Mapping[str, str], role: Mapping[str, str] | None = None) -> None:
        self._forget_role_script()
        account = next((cookies[n] for n in ACCOUNT_COOKIES if cookies.get(n)), "")
        uid, region = (role or {}).get("uid", ""), (role or {}).get("region", "")
        # Numbers and a plain region name only: they go into the script's source.
        if all(text.isascii() and text.isdigit() for text in (account, uid)) and REGION.fullmatch(region):
            script = QWebEngineScript()
            script.setName(ROLE_SEEN_SCRIPT)
            script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            script.setRunsOnSubFrames(False)
            script.setSourceCode(ROLE_SEEN_SOURCE % (
                json.dumps(f"{account}:roleGameRegionStorageKey"), json.dumps(region),
                json.dumps(f"{account}:roleGameUIDStorageKey"), json.dumps(uid),
            ))
            self._profile_in_use().scripts().insert(script)
        store = self._profile_in_use().cookieStore()
        origin = QUrl(COOKIE_ORIGIN)
        for name, value in cookies.items():
            cookie = QNetworkCookie(name.encode("latin-1"), value.encode("latin-1"))
            cookie.setPath("/")
            cookie.setDomain(COOKIE_DOMAIN)
            cookie.setSecure(True)
            cookie.setHttpOnly(name in HIDDEN_FROM_SCRIPTS)
            store.setCookie(cookie, origin)

    def sign_out(self) -> None:
        if self._profile is not None:
            self._forget_role_script()
            self._profile.cookieStore().deleteAllCookies()


class MapHost(QObject):
    def __init__(
        self,
        seen: Callable[[int, str, str], None],
        failed: Callable[[int, bool], None],
        *,
        engine: Any = None,
        flush_ms: int = SEEN_AFTER_MS,
        sleep_ms: int = SLEEP_AFTER_MS,
    ) -> None:
        super().__init__()
        self._seen = seen
        self._failed = failed
        self._engine = engine if engine is not None else MapEngine()
        self._views: dict[int, QWidget] = {}
        self._reloads: dict[int, int] = {}
        self._news: dict[int, tuple[str, str]] = {}  # the last address and title of each view, not yet reported
        self._known: dict[int, tuple[str, str]] = {}
        self._session_known = False
        self._on_page = False  # whether the interface showed its Map page when the core last said where the views go
        self._shown: set[int] = set()  # the views that were shown at least once
        self._ready: set[int] = set()  # the views whose first load has finished: with the shown ones, they may sleep
        self._waking: set[int] = set()  # the sleeping views shown again, until the reload Chromium does is finished
        self._sleep_timer = QTimer(self)
        self._sleep_timer.setSingleShot(True)
        self._sleep_timer.setInterval(sleep_ms)
        self._sleep_timer.timeout.connect(self.sleep_hidden)
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.setInterval(flush_ms)
        self._timer.timeout.connect(self.flush)

    # ------------------------------------------------------------------ the session
    @property
    def session_known(self) -> bool:
        """Views are made only once the host knows whether there is a session, so that none starts signed out."""
        return self._session_known

    def set_session(self, cookies: Mapping[str, str] | None, role: Mapping[str, str] | None = None) -> None:
        """The session cookies, or None when there is no login, and the game account `{uid, region}` the login chose.
        The views already open reload to take it."""
        self._engine.sign_out()
        if cookies:
            self._engine.sign_in(cookies, role)
        first, self._session_known = not self._session_known, True
        if not first:
            for view in self._views.values():
                if not self._asleep(view):  # a sleeping view loads the new session as it wakes
                    view.reload()

    # ------------------------------------------------------------------ following the core
    def apply(self, snapshot: Mapping[str, Any] | None, holder: QWidget | None, *, zoom: float, on_page: bool) -> None:
        """Brings the views to what the core says. `holder` is the interface's view, which the map views sit on: none
        while its window is closed, and then they go. A map holds hundreds of megabytes, so a view is made only for the
        active tab, and only while the interface shows its Map page; another tab's is made when it becomes active. A
        view made stays, hidden, while the interface shows another page, and goes to sleep."""
        self._on_page = on_page
        if snapshot is None or holder is None or not self._session_known:
            self._drop(set())
            return
        tabs = {tab["id"]: tab for tab in snapshot["tabs"]}
        self._drop(set(tabs), keep=holder)
        active = snapshot["active"]
        if on_page and active in tabs and active not in self._views:
            self._open(active, tabs[active]["url"], holder)
            self._reloads[active] = tabs[active].get("reload", 0)  # a new view loads fresh: the reloads asked are done
        for tab_id, view in self._views.items():
            reloads = tabs[tab_id].get("reload", 0)
            if reloads != self._reloads.get(tab_id, 0):
                self._reloads[tab_id] = reloads
                if not self._asleep(view):  # waking is a reload
                    view.reload()
        area = snapshot.get("viewport")
        showing = on_page and area is not None and not area["hidden"] and area["w"] > 0 and area["h"] > 0
        for tab_id, view in self._views.items():
            if showing and tab_id == snapshot["active"]:
                view.setGeometry(area_rect(area, zoom))
                if self._asleep(view):
                    self._waking.add(tab_id)  # Chromium reloads the page at the address it last had
                    view.page().setLifecycleState(QWebEnginePage.LifecycleState.Active)
                view.show()
                view.raise_()
                self._shown.add(tab_id)
            else:
                view.hide()
                if showing:  # another tab is active now: this one, hidden, gives its memory back at once
                    self._sleep(tab_id)
        if on_page:
            self._sleep_timer.stop()
        else:
            self._sleep_soon()

    def _sleep_soon(self) -> None:
        """Away from the Map page, the views that may sleep go to sleep once SLEEP_AFTER_MS has passed."""
        if not self._sleep_timer.isActive() and any(
            self._may_sleep(t) and not self._asleep(v) for t, v in self._views.items()
        ):
            self._sleep_timer.start()

    @staticmethod
    def _asleep(view: Any) -> bool:
        return view.page().lifecycleState() == QWebEnginePage.LifecycleState.Discarded

    def _may_sleep(self, tab_id: int) -> bool:
        """A view that was shown, or whose first load has finished: one still on its first load, never shown, has no
        address to wake at yet."""
        return tab_id in self._shown or tab_id in self._ready

    def _sleep(self, tab_id: int) -> None:
        """Discards a hidden view: a hidden map holds hundreds of megabytes, a discarded one next to nothing. Qt refuses
        a visible page."""
        view = self._views.get(tab_id)
        if view is not None and self._may_sleep(tab_id) and view.isHidden() and not self._asleep(view):
            view.page().setLifecycleState(QWebEnginePage.LifecycleState.Discarded)

    def sleep_hidden(self) -> None:
        """The Map page was left a while ago and has not come back: every view that may sleep goes to sleep."""
        for tab_id in list(self._views):
            self._sleep(tab_id)

    def _drop(self, wanted: set[int], keep: QWidget | None = None) -> None:
        for tab_id in [t for t, view in self._views.items() if t not in wanted or view.parent() is not keep]:
            view = self._views.pop(tab_id)
            self._reloads.pop(tab_id, None)
            self._news.pop(tab_id, None)
            self._known.pop(tab_id, None)
            self._shown.discard(tab_id)
            self._ready.discard(tab_id)
            self._waking.discard(tab_id)
            view.hide()
            view.setParent(None)
            view.deleteLater()

    def _open(self, tab_id: int, url: str, holder: QWidget) -> None:
        view = self._engine.view(holder)
        view.hide()
        self._views[tab_id] = view
        self._known[tab_id] = (url, "")
        view.urlChanged.connect(lambda address, t=tab_id: self._moved(t, address.toString(), None))
        view.titleChanged.connect(lambda title, t=tab_id: self._moved(t, None, title))
        view.loadFinished.connect(lambda ok, t=tab_id: self._loaded(t, ok))
        view.load(QUrl(url))

    # ------------------------------------------------------------------ what the views say
    def _loaded(self, tab_id: int, ok: bool) -> None:
        first = tab_id not in self._ready
        self._ready.add(tab_id)
        if first and not self._on_page:  # the player left the Map page before this view's first load had finished
            self._sleep_soon()
        if tab_id in self._waking:  # the reload of a waking view is not a load that failed
            self._waking.discard(tab_id)
            if not ok:
                return
        self._failed(tab_id, not ok)

    def _moved(self, tab_id: int, url: str | None, title: str | None) -> None:
        if tab_id in self._waking:  # the page is on its way back to the address it had: the core need not hear of it
            return
        was_url, was_title = self._news.get(tab_id) or self._known.get(tab_id, ("", ""))
        self._news[tab_id] = (url if url is not None else was_url, title if title is not None else was_title)
        if not self._timer.isActive():
            self._timer.start()

    def flush(self) -> None:
        """Tells the core the last address and title of each view that moved."""
        news, self._news = self._news, {}
        for tab_id, (url, title) in news.items():
            if tab_id in self._views and (url, title) != self._known.get(tab_id):
                self._known[tab_id] = (url, title)
                self._seen(tab_id, url, title)

    def close(self) -> None:
        """As Guild Board ends: the views go, and with them the session in the profile."""
        self._timer.stop()
        self._sleep_timer.stop()
        self._drop(set())
        self._engine.sign_out()
