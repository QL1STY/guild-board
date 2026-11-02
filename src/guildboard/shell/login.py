"""The login window: HoYoLAB's own page in a private browser, whose session cookies are handed to the core
in-process. Accounts that sign in through Google cannot use an embedded browser, so they paste the login
from their usual browser instead."""
from __future__ import annotations

import logging
from concurrent.futures import Future
from typing import Callable, Mapping, Sequence
from urllib.parse import urlsplit

from PySide6.QtCore import QObject, QSize, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QCloseEvent
from PySide6.QtNetwork import QNetworkCookie
from PySide6.QtWebEngineCore import QWebEngineNewWindowRequest, QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from guildboard import netpolicy
from guildboard.auth import LoginOutcome, has_required, parse_cookie_text
from guildboard.records import GameAccount, Offline
from guildboard.shell.cookies import SITES, CookieCollector, session_cookies
from guildboard.shell.corethread import Deliver

log = logging.getLogger(__name__)

START_URL = "https://www.hoyolab.com/home"
SETTLE_MS = 2000  # the other session cookies arrive moments after the first three

NOT_PASTED = "This does not hold a HoYoLAB login. Copy the whole value of the Cookie line, as the steps say."
# Google refuses to sign in inside another app, and the window shows no sign-in page but those of SIGN_IN_HOSTS.
ANOTHER_SERVICE = (
    "Google does not allow signing in inside another app. If you sign in with Google, or through a service this window "
    "does not open, paste your login instead."
)
PASTE_STEPS = (
    "1. In your usual browser, go to www.hoyolab.com and log in.\n"
    "2. Press F12 to open the developer tools, and choose the Network tab.\n"
    "3. Press F5 to reload the page, and click the first entry in the list.\n"
    "4. Under Request Headers, find the line named Cookie and copy its whole value.\n"
    "5. Paste it below.\n\n"
    "Guild Board keeps only the login cookies, encrypted on this PC."
)
CHECKING = "Checking the login with HoYoLAB."
MISSING = "HoYoLAB did not hand over a complete login. Log in again."
REJECTED = "HoYoLAB did not accept this login. Log in again."
NO_ACCOUNT = "This HoYoLAB account has no Genshin Impact game account."
OTHER_ACCOUNT = (
    "This is another game account (UID {uid}). Guild Board keeps the history of UID {known} "
    "and follows that account only."
)
UNREACHABLE = "HoYoLAB could not be reached. Check the connection, then try again."
FAILED = "Guild Board could not check this login. The log file says why."
# The same names as the Settings page.
SERVER_NAMES = {
    "os_euro": "Europe", "os_usa": "America", "os_asia": "Asia", "os_cht": "TW, HK, MO",
    "cn_gf01": "China", "cn_qd01": "China",
}

POPUP_SIZE = QSize(520, 720)
MOST_POPUPS = 2  # windows of their own a page may have open at once: a sign-in's, and one it opens in turn
# The sign-in pages of the services HoYoLAB's login offers beside its own (Google, Facebook, Apple, X and Discord), by
# their exact hosts: a player who signs in that way can finish in the window, and the verification window too. A
# service this list misses is signed in with elsewhere, and the login pasted.
SIGN_IN_HOSTS = (
    "accounts.google.com", "www.facebook.com", "m.facebook.com", "appleid.apple.com", "x.com", "twitter.com",
    "api.twitter.com", "discord.com",
)


def sign_in_site(url: str) -> bool:
    """Whether the login and verification windows may show `url` in their main frame: one of HoYoverse's own sites
    (netpolicy.is_hoyoverse), or a page on one of SIGN_IN_HOSTS over https, with no other port and no user name."""
    if netpolicy.is_hoyoverse(url):
        return True
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme == "https" and port is None and parts.username is None and parts.password is None
        and (parts.hostname or "") in SIGN_IN_HOSTS
    )


class _QuietPage(QWebEnginePage):
    """A page of the login window. The window has no address bar, so the page's main frame goes to the sites `allowed`
    lets through alone, HoYoverse's and the sign-in pages (sign_in_site); a frame inside it loads what the page needs,
    as HoYoLAB's captcha does. No address of a scheme Chromium does not know is handed to a program of Windows'.
    A page that has come to an address `allowed` refuses is handed to `on_refused`: an empty page (about:blank) is set
    from another frame without ever reaching acceptNavigationRequest."""

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


def _text(raw) -> str:
    return bytes(raw).decode("latin-1")


class LoginWindow(QWidget):
    captured = Signal(dict)
    retry = Signal()
    paste_requested = Signal()
    closed = Signal()

    def __init__(
        self,
        *,
        start_url: str = START_URL,
        domains: Sequence[str] = SITES,
        settle_ms: int = SETTLE_MS,
        allowed: Callable[[str], bool] = sign_in_site,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._start_url = start_url
        self._allowed = allowed  # the addresses its pages may show: HoYoverse's own sites and the sign-in pages
        self._started = False
        self._collector = CookieCollector(domains)
        self._handed_over: dict[str, str] | None = None
        self.setWindowTitle("Log in to HoYoLAB")
        self.resize(1100, 820)

        self._bar = QFrame(self)
        self._message = QLabel(self._bar)
        self._message.setWordWrap(True)
        self._retry = QPushButton("Try again", self._bar)
        self._retry.clicked.connect(self.retry)
        bar = QHBoxLayout(self._bar)
        bar.addWidget(self._message, 1)
        bar.addWidget(self._retry)
        self._bar.hide()

        # Qt deletes children in the order they were added. The view comes first and the profile after it,
        # and the page and every pop-up are children of the view, so every page goes before the profile.
        self._view = QWebEngineView(self)
        self._profile = QWebEngineProfile(self)  # without a name: kept in memory only
        self._page = _QuietPage(self._profile, self._view, allowed, self._back_to_start)
        self._page.newWindowRequested.connect(self._open_popup)
        self._view.setPage(self._page)

        store = self._profile.cookieStore()
        store.cookieAdded.connect(self._on_cookie_added)
        store.cookieRemoved.connect(self._on_cookie_removed)
        self._settle = QTimer(self)
        self._settle.setSingleShot(True)
        self._settle.setInterval(settle_ms)
        self._settle.timeout.connect(self._hand_over)

        another_service = QLabel(ANOTHER_SERVICE, self)
        another_service.setWordWrap(True)
        paste = QPushButton("Paste a login instead", self)
        paste.clicked.connect(self.paste_requested)
        bottom = QHBoxLayout()
        bottom.addWidget(another_service, 1)
        bottom.addWidget(paste)

        layout = QVBoxLayout(self)
        layout.addWidget(self._bar)
        layout.addWidget(self._view, 1)
        layout.addLayout(bottom)

    def page(self) -> QWebEnginePage:
        return self._page

    def popups(self) -> list[QWebEngineView]:
        return [
            child
            for child in self._view.findChildren(QWebEngineView, options=Qt.FindChildOption.FindDirectChildrenOnly)
            if child.isVisible()
        ]

    def start(self) -> None:
        if not self._started:
            self._started = True
            self._view.load(QUrl(self._start_url))
        self.show()
        self.raise_()
        self.activateWindow()

    def show_message(self, text: str, can_retry: bool = False) -> None:
        self._message.setText(text)
        self._retry.setVisible(can_retry)
        self._bar.show()

    def closeEvent(self, event: QCloseEvent) -> None:
        self._settle.stop()
        for popup in self.popups():
            popup.close()
        event.accept()
        self.closed.emit()

    def _on_cookie_added(self, cookie: QNetworkCookie) -> None:
        self._collector.add(_text(cookie.name()), _text(cookie.value()), cookie.domain())
        if self._collector.complete():
            self._settle.start()

    def _on_cookie_removed(self, cookie: QNetworkCookie) -> None:
        self._collector.remove(_text(cookie.name()), _text(cookie.value()), cookie.domain())

    def _hand_over(self) -> None:
        if not self._collector.complete():
            return
        cookies = self._collector.cookies()
        if cookies != self._handed_over:  # each new login once; a reload or a later cookie does not repeat it
            self._handed_over = cookies
            self.captured.emit(cookies)

    def grown_login(self, checked: Mapping[str, str]) -> dict[str, str] | None:
        """The login as the browser holds it now, when it is `checked` and more: the cookies HoYoLAB set while that was
        checked, as cookie_token_v2 comes moments after the three a login needs. It counts as handed over from here,
        so the window does not hand it over again. None when nothing came, or when the browser holds another login."""
        cookies = self._collector.cookies()
        if not self._collector.complete() or len(cookies) <= len(checked):
            return None
        if any(cookies.get(name) != value for name, value in checked.items()):
            return None
        self._handed_over = cookies
        self._settle.stop()
        return cookies

    def _back_to_start(self) -> None:
        """The main page came to an address of no site of the login's: back to where the login starts."""
        log.info("The HoYoLAB page went to an address that is no site of the login's; it is back at the start.")
        self._view.load(QUrl(self._start_url))

    def _open_popup(self, request: QWebEngineNewWindowRequest) -> None:
        """A page asks for a window of its own, as a sign-in with another service does. It opens on one of the window's
        sites alone, and MOST_POPUPS at most at once; its own page is held to the same sites. An empty one never opens:
        whichever frame asked for it would fill it, any site's frame among them, in a window titled for the login and
        with no address bar. Any other is refused, and the log says so without the address."""
        address = request.requestedUrl().toString()
        if len(self.popups()) >= MOST_POPUPS or not self._allowed(address):
            log.info("A window the HoYoLAB page asked for was not opened: too many are open, or it is no site of the "
                     "login's.")
            return
        popup = QWebEngineView(self._view)
        popup.setWindowFlag(Qt.WindowType.Window)
        popup.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        popup.setWindowTitle(self.windowTitle())
        page = _QuietPage(self._profile, popup, self._allowed, popup.close)
        page.newWindowRequested.connect(self._open_popup)
        page.windowCloseRequested.connect(popup.close)
        popup.setPage(page)
        size = request.requestedGeometry().size()
        popup.resize(size if size.width() > 0 and size.height() > 0 else POPUP_SIZE)
        request.openIn(page)
        popup.show()


class PasteDialog(QDialog):
    pasted = Signal(dict)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Paste a HoYoLAB login")
        self.resize(600, 460)
        steps = QLabel(PASTE_STEPS, self)
        steps.setWordWrap(True)
        self._box = QPlainTextEdit(self)
        self._box.setPlaceholderText("ltoken_v2=...; ltuid_v2=...; ltmid_v2=...")
        self._message = QLabel(self)
        self._message.setWordWrap(True)
        buttons = QDialogButtonBox(self)
        use = buttons.addButton("Use this login", QDialogButtonBox.ButtonRole.AcceptRole)
        use.setDefault(True)
        buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(lambda: self.submit_text(self._box.toPlainText()))
        buttons.rejected.connect(self.reject)
        layout = QVBoxLayout(self)
        layout.addWidget(steps)
        layout.addWidget(self._box, 1)
        layout.addWidget(self._message)
        layout.addWidget(buttons)

    def submit_text(self, text: str) -> bool:
        cookies = session_cookies(parse_cookie_text(text))
        if not has_required(cookies):
            self._message.setText(NOT_PASTED)
            return False
        self._box.clear()
        self._message.clear()
        self.accept()
        self.pasted.emit(cookies)
        return True

    def message(self) -> str:
        return self._message.text()


def account_label(account: GameAccount) -> str:
    server = SERVER_NAMES.get(account.server, account.server)
    return f"{account.nickname}, UID {account.uid}, {server}, Adventure Rank {account.level}"


class AccountChooser(QDialog):
    def __init__(self, accounts: Sequence[GameAccount], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._accounts = tuple(accounts)
        self.setWindowTitle("Choose a game account")
        intro = QLabel(
            "This HoYoLAB account holds more than one Genshin Impact game account. Guild Board follows one of them.",
            self,
        )
        intro.setWordWrap(True)
        self._list = QListWidget(self)
        self._list.addItems([account_label(account) for account in self._accounts])
        self._list.setCurrentRow(0)
        self._list.itemDoubleClicked.connect(self.accept)
        buttons = QDialogButtonBox(self)
        follow = buttons.addButton("Follow this account", QDialogButtonBox.ButtonRole.AcceptRole)
        follow.setDefault(True)
        buttons.addButton("Cancel login", QDialogButtonBox.ButtonRole.RejectRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout = QVBoxLayout(self)
        layout.addWidget(intro)
        layout.addWidget(self._list, 1)
        layout.addWidget(buttons)

    def labels(self) -> list[str]:
        return [self._list.item(row).text() for row in range(self._list.count())]

    def select(self, row: int) -> None:
        self._list.setCurrentRow(row)

    def chosen(self) -> int | None:
        row = self._list.currentRow()
        if self.result() != QDialog.DialogCode.Accepted.value or not 0 <= row < len(self._accounts):
            return None
        return self._accounts[row].uid


def choose_account(accounts: Sequence[GameAccount], parent: QWidget) -> int | None:
    chooser = AccountChooser(accounts, parent)
    chooser.exec()
    uid = chooser.chosen()
    chooser.deleteLater()
    return uid


LoginCheck = Callable[[dict[str, str], "int | None"], Future]
Chooser = Callable[[Sequence[GameAccount], QWidget], "int | None"]


class LoginFlow(QObject):
    """Takes a login from the window or the paste dialog, has the core check it, and says what came of it."""

    logged_in = Signal(object)  # the GameAccount now followed

    def __init__(
        self,
        check: LoginCheck,
        *,
        make_window: Callable[[], LoginWindow] = LoginWindow,
        choose: Chooser = choose_account,
    ) -> None:
        super().__init__()
        self._check = check
        self._make_window = make_window
        self._choose = choose
        self._deliver = Deliver()
        self._window: LoginWindow | None = None
        self._closing: LoginWindow | None = None  # kept until Qt has deleted it
        self._attempt = 0
        self._last: tuple[dict[str, str], int | None] | None = None
        # While a login that was accepted is checked again with the cookies that came during its check: its account.
        self._granted: GameAccount | None = None

    def start(self) -> None:
        if self._window is None:
            window = self._make_window()
            window.captured.connect(lambda cookies: self._try(cookies, None))
            window.retry.connect(self._retry)
            window.paste_requested.connect(self._open_paste)
            window.closed.connect(lambda: self._on_closed(window))
            self._window = window
        self._window.start()

    def _try(self, cookies: dict[str, str], uid: int | None, granted: GameAccount | None = None) -> None:
        if self._window is None:
            return
        self._attempt += 1
        attempt = self._attempt
        self._last = (cookies, uid)
        self._granted = granted
        self._window.show_message(CHECKING)
        self._deliver.then(self._check(cookies, uid), lambda future: self._answer(attempt, future))

    def _retry(self) -> None:
        if self._last is not None:
            self._try(*self._last)

    def _answer(self, attempt: int, future: Future) -> None:
        window = self._window
        if attempt != self._attempt or window is None:
            return  # an answer that is no longer wanted
        error = future.exception()
        granted, self._granted = self._granted, None
        if granted is not None and (error is not None or future.result().status != "ok"):
            # The check of the cookies that came later did not go through; the login accepted before it stays saved.
            log.info("The cookies HoYoLAB set during the login's check could not be checked; the login stays as it was.")
            self.logged_in.emit(granted)
            window.close()
            return
        if isinstance(error, Offline):
            window.show_message(UNREACHABLE, can_retry=True)
            return
        if error is not None:
            log.exception("a login could not be checked", exc_info=error)
            window.show_message(FAILED, can_retry=True)
            return
        outcome: LoginOutcome = future.result()
        if outcome.status == "ok":
            grown = window.grown_login(self._last[0])
            if grown is not None:  # cookies came during the check, the cookie token among them: checked too, then kept
                self._try(grown, outcome.account.uid, granted=outcome.account)
                return
            self.logged_in.emit(outcome.account)
            window.close()
        elif outcome.status == "choose":
            uid = self._choose(outcome.accounts, window)
            if attempt != self._attempt or self._window is not window:
                return  # the window closed while the player was choosing
            if uid is None:
                window.close()  # the player cancelled the login
            else:
                self._try(self._last[0], uid)
        elif outcome.status == "other_account":
            window.show_message(OTHER_ACCOUNT.format(uid=outcome.account.uid, known=outcome.known_uid))
        elif outcome.status == "missing_cookies":
            window.show_message(MISSING)
        elif outcome.status == "rejected":
            window.show_message(REJECTED)
        else:
            window.show_message(NO_ACCOUNT)

    def _open_paste(self) -> None:
        if self._window is None:
            return
        dialog = self._window.findChild(PasteDialog)
        if dialog is None:
            dialog = PasteDialog(self._window)
            dialog.pasted.connect(lambda cookies: self._try(cookies, None))
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _on_closed(self, window: LoginWindow) -> None:
        self._attempt += 1  # an answer still on its way is no longer wanted
        self._last = self._granted = None  # the login kept for Try again goes with the window; the shell lives on
        if self._window is window:
            self._window = None
        self._closing = window
        window.destroyed.connect(lambda: self._forget(window))
        window.deleteLater()

    def _forget(self, window: LoginWindow) -> None:
        if self._closing is window:
            self._closing = None
