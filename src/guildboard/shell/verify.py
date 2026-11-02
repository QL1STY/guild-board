"""The verification window: HoYoLAB's Battle Chronicle page with the stored login, where the player
passes the check HoYoLAB asks for. Closing it lets syncing go on at the next sync."""
from __future__ import annotations

from typing import Callable, Mapping

from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtGui import QCloseEvent
from PySide6.QtNetwork import QNetworkCookie
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget

# Where a HoYoLAB page may go here is where it may go in the login window: HoYoverse's sites and the sign-in pages.
from guildboard.shell.login import sign_in_site

# The Battle Chronicle page; Task 15 confirms the address.
VERIFY_URL = "https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys"
NOTE = (
    "HoYoLAB asked for a check before it answers Guild Board again. Pass the check on this page, "
    "then close this window. Syncing goes on at the next sync."
)
# HoYoLAB sets these HttpOnly itself.
HIDDEN_FROM_SCRIPTS = ("ltoken_v2", "cookie_token_v2", "ltoken", "cookie_token")


class _QuietPage(QWebEnginePage):
    """The verification page. The window has no address bar, so the page's main frame goes to the sites `allowed` lets
    through alone, HoYoverse's and the sign-in pages (sign_in_site); a frame inside it loads what the page needs, as
    the check does. No address of a scheme Chromium does not know is handed to a program of Windows'. A page that has
    come to an address `allowed` refuses is handed to `on_refused`: an empty page (about:blank) is set from another
    frame without ever reaching acceptNavigationRequest."""

    def __init__(
        self, profile: QWebEngineProfile, parent: QObject, allowed: Callable[[str], bool],
        on_refused: Callable[[], None],
    ) -> None:
        super().__init__(profile, parent)
        self._allowed = allowed
        self._on_refused = on_refused
        self.settings().setUnknownUrlSchemePolicy(QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes)
        self.urlChanged.connect(self._moved)

    def _moved(self, url: QUrl) -> None:
        if not url.isEmpty() and not self._allowed(url.toString()):
            self._on_refused()

    def acceptNavigationRequest(self, url: QUrl, kind: QWebEnginePage.NavigationType, is_main_frame: bool) -> bool:
        return not is_main_frame or self._allowed(url.toString())

    def javaScriptConsoleMessage(self, level, message: str, line: int, source: str) -> None:
        pass  # the site's console stays out of the log


class VerifyWindow(QWidget):
    closed = Signal()

    def __init__(
        self,
        cookies: Mapping[str, str],
        *,
        url: str = VERIFY_URL,
        cookie_domain: str | None = ".hoyolab.com",
        allowed: Callable[[str], bool] = sign_in_site,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._cookies: dict[str, str] | None = dict(cookies)
        self._url = QUrl(url)
        self._cookie_domain = cookie_domain
        self.setWindowTitle("Verify on HoYoLAB")
        self.resize(1100, 820)
        note = QLabel(NOTE, self)
        note.setWordWrap(True)
        self._view = QWebEngineView(self)
        profile = QWebEngineProfile()  # without a name: kept in memory only
        self._page = _QuietPage(profile, self._view, allowed, self._back_to_start)
        profile.setParent(self._page)  # deleted with the page, and after it
        self._view.setPage(self._page)
        layout = QVBoxLayout(self)
        layout.addWidget(note)
        layout.addWidget(self._view, 1)

    def _back_to_start(self) -> None:
        self._view.load(self._url)

    def page(self) -> QWebEnginePage:
        return self._page

    def start(self) -> None:
        if self._cookies is not None:
            store = self._page.profile().cookieStore()
            secure = self._url.scheme() == "https"
            for name, value in self._cookies.items():
                cookie = QNetworkCookie(name.encode("latin-1"), value.encode("latin-1"))
                cookie.setPath("/")
                if self._cookie_domain:
                    cookie.setDomain(self._cookie_domain)
                cookie.setSecure(secure)
                cookie.setHttpOnly(name in HIDDEN_FROM_SCRIPTS)
                store.setCookie(cookie, self._url)
            self._cookies = None  # the profile holds the login now; this window keeps no copy
            self._view.load(self._url)
        self.show()
        self.raise_()
        self.activateWindow()

    def closeEvent(self, event: QCloseEvent) -> None:
        event.accept()
        self.closed.emit()
