import threading
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PySide6.QtCore import QRect, QUrl, Signal
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWidgets import QWidget

from guildboard.auth import LoginOutcome
from guildboard.records import GameAccount, Offline
from guildboard.shell.login import (
    CHECKING,
    FAILED,
    MISSING,
    NO_ACCOUNT,
    NOT_PASTED,
    REJECTED,
    UNREACHABLE,
    AccountChooser,
    LoginFlow,
    LoginWindow,
    PasteDialog,
)

COOKIES = {"ltoken_v2": "v2_FAKE-TOKEN", "ltuid_v2": "42", "ltmid_v2": "fake_mid"}
EUROPE = GameAccount(700000001, "Traveler", "os_euro", 60)
ASIA = GameAccount(800000002, "Lumine", "os_asia", 45)


@pytest.fixture
def hoyolab():
    """A stand-in for HoYoLAB on this PC. /login sets the session cookies, as a successful login does;
    /popup does the same from a window of its own, as a sign-in with another service does; /other is a
    login with another account; /later sets a cookie that is not part of a login."""
    sessions = {
        "/login": ("v2_FAKE-TOKEN", "42", "fake_mid"),
        "/popup": ("v2_FAKE-TOKEN", "42", "fake_mid"),
        "/other": ("v2_OTHER-TOKEN", "43", "other_mid"),
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            self.send_response(200)
            if self.path in sessions:
                token, uid, mid = sessions[self.path]
                self.send_header("Set-Cookie", f"ltoken_v2={token}; Path=/; HttpOnly")
                self.send_header("Set-Cookie", f"ltuid_v2={uid}; Path=/")
                self.send_header("Set-Cookie", f"ltmid_v2={mid}; Path=/")
                self.send_header("Set-Cookie", "_HYVUUID=tracking; Path=/")
            if self.path == "/later":
                self.send_header("Set-Cookie", "mi18nLang=en-us; Path=/")
            if self.path == "/token":  # the cookie token, which HoYoLAB sets moments after the three
                self.send_header("Set-Cookie", "cookie_token_v2=v2_FAKE-COOKIE-TOKEN; Path=/; HttpOnly")
            body = b"<html><body>HoYoLAB stand-in</body></html>"
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def _window(url: str) -> LoginWindow:
    """A login window on the stand-in, whose pages may go to the stand-in's own address alone, as HoYoLAB's go to
    HoYoverse's sites alone."""
    origin = "/".join(url.split("/", 3)[:3])
    return LoginWindow(
        start_url=url, domains=("127.0.0.1",), settle_ms=200, allowed=lambda address: address.startswith(origin + "/"),
    )


@pytest.fixture
def elsewhere():
    """Another site on this PC, which the login window must never show: it remembers every address asked of it."""
    asked: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            asked.append(self.path)
            body = b"<html><body>Somewhere else</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}", asked
    server.shutdown()
    server.server_close()


# Where the login and verify windows may go, and where not: HoYoverse's sites and the sign-in pages HoYoLAB offers, by
# their exact hosts and over https alone.
SIGN_IN_PAGES = (
    "https://www.hoyolab.com/home", "https://account.hoyoverse.com/login", "https://act.hoyolab.com/x",
    "https://accounts.google.com/o/oauth2/auth", "https://www.facebook.com/dialog/oauth", "https://m.facebook.com/login",
    "https://appleid.apple.com/auth/authorize", "https://x.com/i/oauth2/authorize", "https://twitter.com/login",
    "https://api.twitter.com/oauth/authenticate", "https://discord.com/oauth2/authorize",
)
NOT_SIGN_IN_PAGES = (
    "https://evil.example/", "http://www.hoyolab.com/home", "https://hoyolab.com.evil.example/",
    "http://accounts.google.com/o/oauth2/auth", "https://accounts.google.com.evil.example/",
    "https://evil.example/accounts.google.com", "https://www.google.com/", "https://login.live.com/",
    "https://facebook.com/", "https://discord.gg/invite", "https://accounts.google.com:8443/",
    "https://player@x.com/", "ms-settings:privacy", "file:///C:/Windows/win.ini", "", "about:blank",
)


def test_the_login_pages_go_to_hoyoverse_and_the_sign_in_pages_alone_and_hand_no_other_scheme_to_windows(qtbot):
    # L17: the window has no address bar, so its page's main frame goes to HoYoverse's own sites (netpolicy's domains)
    # and the sign-in pages of the services HoYoLAB offers alone, over https; a frame inside the page may load what the
    # page needs, as HoYoLAB's captcha does. An address of a scheme Chromium does not know is never handed to a program
    # of Windows'.
    window = LoginWindow()
    qtbot.addWidget(window)
    page = window.page()
    link = QWebEnginePage.NavigationType.NavigationTypeLinkClicked
    assert [page.acceptNavigationRequest(QUrl(address), link, True) for address in SIGN_IN_PAGES] == [True] * len(
        SIGN_IN_PAGES
    )
    for address in NOT_SIGN_IN_PAGES:
        assert not page.acceptNavigationRequest(QUrl(address), link, True), address
    assert page.acceptNavigationRequest(QUrl("https://captcha.example/frame"), link, False)
    assert page.settings().unknownUrlSchemePolicy() == QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes


class _WindowAsked:
    """A page's request for a window of its own, as Qt hands it to the login window: it opens nowhere here."""

    def __init__(self, address: str) -> None:
        self.address = address
        self.opened_in = None

    def requestedUrl(self) -> QUrl:  # noqa: N802
        return QUrl(self.address)

    def requestedGeometry(self) -> QRect:  # noqa: N802
        return QRect()

    def openIn(self, page) -> None:  # noqa: N802, ANN001
        self.opened_in = page


def test_a_pop_up_opens_on_a_sign_in_page_but_never_empty_or_elsewhere(qtbot):
    # An empty window would be filled by whichever frame asked for it, any site's frame among them, in a window titled
    # for HoYoLAB's login and with no address bar. A pop-up opens only on the window's own sites, two at most.
    window = LoginWindow()
    qtbot.addWidget(window)
    for address in ("", "about:blank", "https://evil.example/", "https://www.google.com/"):
        asked = _WindowAsked(address)
        window._open_popup(asked)
        assert asked.opened_in is None and window.popups() == [], address
    first, second = _WindowAsked(SIGN_IN_PAGES[3]), _WindowAsked(SIGN_IN_PAGES[4])
    window._open_popup(first)
    window._open_popup(second)
    assert first.opened_in is not None and second.opened_in is not None and len(window.popups()) == 2
    third = _WindowAsked(SIGN_IN_PAGES[0])
    window._open_popup(third)
    assert third.opened_in is None and len(window.popups()) == 2
    for popup in window.popups():
        assert not popup.page().acceptNavigationRequest(
            QUrl("https://evil.example/"), QWebEnginePage.NavigationType.NavigationTypeLinkClicked, True,
        )


def test_the_login_view_refuses_a_main_frame_navigation_off_hoyoverse(qtbot, hoyolab, elsewhere):
    away, asked = elsewhere
    window = _window(hoyolab + "/")
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    window.page().runJavaScript(f"window.location.href = '{away}/phish'")  # a link or a script on the page
    qtbot.wait(1500)
    assert asked == [] and window.page().url().toString().startswith(hoyolab + "/")


def test_the_login_window_opens_two_pop_ups_at_most_and_only_on_its_sites(qtbot, hoyolab, elsewhere):
    away, asked = elsewhere
    window = _window(hoyolab + "/")
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    window.page().runJavaScript(f"window.open('{away}/popup')")  # another site: no window at all
    window.page().runJavaScript("window.open(); window.open('about:blank')")  # nor an empty one
    qtbot.wait(1000)
    assert window.popups() == [] and asked == []
    for _ in range(4):
        window.page().runJavaScript(f"window.open('{hoyolab}/later')")
    qtbot.waitUntil(lambda: len(window.popups()) == 2, timeout=20_000)
    qtbot.wait(1000)
    assert len(window.popups()) == 2  # and no more
    for popup in window.popups():
        assert popup.page().settings().unknownUrlSchemePolicy() == (
            QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes
        )
        assert not popup.page().acceptNavigationRequest(
            QUrl(f"{away}/"), QWebEnginePage.NavigationType.NavigationTypeLinkClicked, True,
        )


def test_a_pop_up_sent_to_an_empty_page_is_closed_and_the_main_page_is_sent_back_to_its_start(qtbot, hoyolab):
    # about:blank never reaches acceptNavigationRequest, so a frame that opened an allowed pop-up could set it to
    # about:blank and write into a window titled for the login; a click in a frame could send the main page there too.
    window = _window(hoyolab + "/")
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    window.page().runJavaScript(f"window.opened = window.open('{hoyolab}/later')")
    qtbot.waitUntil(lambda: len(window.popups()) == 1, timeout=20_000)
    qtbot.wait(500)
    window.page().runJavaScript("window.opened.location = 'about:blank'")  # as a frame of the page can
    qtbot.waitUntil(lambda: window.popups() == [], timeout=20_000)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.page().runJavaScript("window.location.href = 'about:blank'")
    qtbot.waitUntil(lambda: window.page().url().toString().startswith(hoyolab + "/"), timeout=20_000)


def test_a_page_that_moves_to_an_address_the_window_refuses_is_dealt_with_at_once(qtbot, hoyolab):
    window = _window(hoyolab + "/")
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    window.page().runJavaScript(f"window.open('{hoyolab}/later')")
    qtbot.waitUntil(lambda: len(window.popups()) == 1, timeout=20_000)
    popup = window.popups()[0]
    popup.page().urlChanged.emit(QUrl("https://evil.example/"))
    qtbot.waitUntil(lambda: window.popups() == [], timeout=20_000)
    loads: list[str] = []
    window.page().loadStarted.connect(lambda: loads.append(window.page().requestedUrl().toString()))
    window.page().urlChanged.emit(QUrl("about:blank"))
    qtbot.waitUntil(lambda: bool(loads), timeout=20_000)
    assert loads[0].startswith(hoyolab + "/")


def test_the_login_window_hands_over_each_new_login_once(qtbot, hoyolab):
    window = _window(hoyolab + "/login")
    qtbot.addWidget(window)
    seen: list[dict] = []
    window.captured.connect(seen.append)
    with qtbot.waitSignal(window.captured, timeout=20_000):
        window.start()
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.page().load(QUrl(hoyolab + "/later"))  # the site sets other cookies after the login
    qtbot.wait(1000)
    assert seen == [COOKIES]  # the tracking cookie is left out, and the same login is handed over once
    with qtbot.waitSignal(window.captured, timeout=20_000) as other:
        window.page().load(QUrl(hoyolab + "/other"))  # the player logs in with another account
    assert other.args[0] == {"ltoken_v2": "v2_OTHER-TOKEN", "ltuid_v2": "43", "ltmid_v2": "other_mid"}


def test_a_sign_in_in_a_window_of_its_own_counts_too(qtbot, hoyolab):
    window = _window(hoyolab + "/")
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    with qtbot.waitSignal(window.captured, timeout=20_000) as captured:
        window.page().runJavaScript(f"window.open('{hoyolab}/popup')")
    assert captured.args[0] == COOKIES
    assert len(window.popups()) == 1


def test_closing_the_login_window_discards_its_browser(qtbot, hoyolab, qtlog):
    window = _window(hoyolab + "/")
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    with qtbot.waitSignal(window.captured, timeout=20_000):
        window.page().runJavaScript(f"window.open('{hoyolab}/popup')")
    with qtbot.waitSignal(window.closed):
        window.close()
    assert window.popups() == []
    window.deleteLater()
    qtbot.wait(500)
    # Qt WebEngine warns, and may crash later, when a profile goes before a page that uses it.
    assert not [record.message for record in qtlog.records if "profile" in record.message.lower()]


def test_a_pasted_login_is_taken_without_the_other_cookies(qtbot):
    dialog = PasteDialog()
    qtbot.addWidget(dialog)
    with qtbot.waitSignal(dialog.pasted) as pasted:
        assert dialog.submit_text("Cookie: _HYVUUID=x; ltoken_v2=v2_FAKE-TOKEN; ltuid_v2=42; ltmid_v2=fake_mid")
    assert pasted.args[0] == COOKIES
    assert not dialog.submit_text("hello")
    assert dialog.message() == NOT_PASTED


def test_the_account_chooser_names_each_account_and_returns_the_choice(qtbot):
    chooser = AccountChooser((EUROPE, ASIA))
    qtbot.addWidget(chooser)
    assert chooser.labels() == [
        "Traveler, UID 700000001, Europe, Adventure Rank 60",
        "Lumine, UID 800000002, Asia, Adventure Rank 45",
    ]
    assert chooser.chosen() is None  # nothing is chosen until the player confirms
    chooser.select(1)
    chooser.accept()
    assert chooser.chosen() == ASIA.uid


class FakeAuth:
    """Answers logins with the outcomes a test lines up, the way the core's login check would."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.calls: list[tuple[dict, int | None]] = []

    def __call__(self, cookies: dict, uid: int | None) -> Future:
        self.calls.append((dict(cookies), uid))
        answer = self.answers.pop(0)
        if isinstance(answer, Future):
            return answer
        future: Future = Future()
        if isinstance(answer, Exception):
            future.set_exception(answer)
        else:
            future.set_result(answer)
        return future


class FakeWindow(QWidget):
    """Stands in for the login window in the flow's tests."""

    captured = Signal(dict)
    retry = Signal()
    paste_requested = Signal()
    closed = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []
        self.can_retry = False
        self.was_closed = False
        self.started = 0
        self.grown: dict | None = None  # the cookies the browser holds once a check is answered, given once

    def start(self) -> None:
        self.started += 1

    def grown_login(self, checked: dict) -> dict | None:
        grown, self.grown = self.grown, None
        return grown

    def show_message(self, text: str, can_retry: bool = False) -> None:
        self.messages.append(text)
        self.can_retry = can_retry

    def closeEvent(self, event) -> None:  # noqa: N802, ANN001
        self.was_closed = True
        super().closeEvent(event)
        self.closed.emit()


def _flow(auth: FakeAuth, choose=lambda accounts, parent: None) -> tuple[LoginFlow, FakeWindow]:
    window = FakeWindow()
    flow = LoginFlow(auth, make_window=lambda: window, choose=choose)
    flow.start()
    return flow, window


def test_a_good_login_closes_the_window(qtbot):
    auth = FakeAuth(LoginOutcome("ok", EUROPE))
    flow, window = _flow(auth)
    with qtbot.waitSignal(flow.logged_in) as logged_in:
        window.captured.emit(COOKIES)
    assert logged_in.args[0] == EUROPE
    assert window.messages == [CHECKING]
    assert window.was_closed
    assert auth.calls == [(COOKIES, None)]


def test_with_several_game_accounts_the_player_chooses_one(qtbot):
    auth = FakeAuth(LoginOutcome("choose", None, (EUROPE, ASIA)), LoginOutcome("ok", ASIA))
    asked: list = []
    flow, window = _flow(auth, choose=lambda accounts, parent: asked.append(accounts) or ASIA.uid)
    with qtbot.waitSignal(flow.logged_in):
        window.captured.emit(COOKIES)
    assert asked == [(EUROPE, ASIA)]
    assert auth.calls == [(COOKIES, None), (COOKIES, ASIA.uid)]


def test_not_choosing_an_account_cancels_the_login(qtbot):
    auth = FakeAuth(LoginOutcome("choose", None, (EUROPE, ASIA)))
    flow, window = _flow(auth, choose=lambda accounts, parent: None)
    with qtbot.assertNotEmitted(flow.logged_in):
        window.captured.emit(COOKIES)
    assert window.was_closed
    assert len(auth.calls) == 1


@pytest.mark.parametrize(
    ("answer", "message", "can_retry"),
    [
        (LoginOutcome("missing_cookies"), MISSING, False),
        (LoginOutcome("rejected"), REJECTED, False),
        (LoginOutcome("no_account"), NO_ACCOUNT, False),
        (LoginOutcome("other_account", ASIA, known_uid=EUROPE.uid),
         "This is another game account (UID 800000002). Guild Board keeps the history of UID 700000001 "
         "and follows that account only.", False),
        (Offline("no network"), UNREACHABLE, True),
        (RuntimeError("something unexpected"), FAILED, True),
    ],
)
def test_a_failed_login_says_why_and_the_window_stays_open(qtbot, answer, message, can_retry):
    flow, window = _flow(FakeAuth(answer))
    window.captured.emit(COOKIES)
    assert window.messages == [CHECKING, message]
    assert window.can_retry == can_retry
    assert not window.was_closed


def test_after_a_network_failure_the_same_login_can_be_tried_again(qtbot):
    auth = FakeAuth(Offline("no network"), LoginOutcome("ok", EUROPE))
    flow, window = _flow(auth)
    window.captured.emit(COOKIES)
    with qtbot.waitSignal(flow.logged_in):
        window.retry.emit()
    assert auth.calls == [(COOKIES, None), (COOKIES, None)]


def test_a_pasted_login_goes_through_the_same_check(qtbot):
    auth = FakeAuth(LoginOutcome("ok", EUROPE))
    flow, window = _flow(auth)
    window.paste_requested.emit()
    dialog = window.findChild(PasteDialog)
    assert dialog.isVisible()
    with qtbot.waitSignal(flow.logged_in):
        assert dialog.submit_text("ltoken_v2=v2_FAKE-TOKEN; ltuid_v2=42; ltmid_v2=fake_mid")
    assert auth.calls == [(COOKIES, None)]


def test_an_answer_that_comes_after_the_window_closed_is_dropped(qtbot):
    pending: Future = Future()
    flow, window = _flow(FakeAuth(pending))
    window.captured.emit(COOKIES)
    window.close()
    with qtbot.assertNotEmitted(flow.logged_in):
        pending.set_result(LoginOutcome("ok", EUROPE))
        qtbot.wait(100)
    assert window.messages == [CHECKING]


def test_a_cookie_that_arrives_during_the_check_is_kept(qtbot):
    # L18: HoYoLAB sets cookie_token_v2 moments after the three cookies a login needs. One that arrives while the login is
    # checked is checked too, with the account just chosen, before the window closes: without it the saved login could
    # neither redeem codes nor be given history keys.
    grown = {**COOKIES, "cookie_token_v2": "v2_FAKE-COOKIE-TOKEN"}
    auth = FakeAuth(LoginOutcome("ok", EUROPE), LoginOutcome("ok", EUROPE))
    flow, window = _flow(auth)
    window.grown = grown
    with qtbot.waitSignal(flow.logged_in) as logged_in:
        window.captured.emit(COOKIES)
    assert auth.calls == [(COOKIES, None), (grown, EUROPE.uid)]
    assert logged_in.args[0] == EUROPE and window.was_closed and window.messages == [CHECKING, CHECKING]


def test_a_second_check_that_fails_keeps_the_login_already_accepted(qtbot):
    grown = {**COOKIES, "cookie_token_v2": "v2_FAKE-COOKIE-TOKEN"}
    flow, window = _flow(FakeAuth(LoginOutcome("ok", EUROPE), Offline("no network")))
    window.grown = grown
    with qtbot.waitSignal(flow.logged_in) as logged_in:
        window.captured.emit(COOKIES)
    assert logged_in.args[0] == EUROPE and window.was_closed and UNREACHABLE not in window.messages


def test_the_window_gives_the_login_grown_while_it_was_checked_once(qtbot, hoyolab):
    window = LoginWindow(
        start_url=hoyolab + "/login", domains=("127.0.0.1",), settle_ms=2000,
        allowed=lambda address: address.startswith(hoyolab + "/"),
    )
    qtbot.addWidget(window)
    seen: list[dict] = []
    window.captured.connect(seen.append)
    with qtbot.waitSignal(window.captured, timeout=20_000):
        window.start()
    assert window.grown_login(COOKIES) is None  # nothing came since it was handed over
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.page().load(QUrl(hoyolab + "/token"))
    grown = {**COOKIES, "cookie_token_v2": "v2_FAKE-COOKIE-TOKEN"}
    assert window.grown_login({**COOKIES, "ltoken_v2": "v2_ANOTHER-LOGIN"}) is None  # another login: no growth of it
    assert window.grown_login(COOKIES) == grown
    assert window.grown_login(grown) is None  # given once
    qtbot.wait(2500)
    assert seen == [COOKIES]  # and not handed over a second time when the settling time ends


def test_closing_the_window_forgets_the_last_login_it_was_given(qtbot):
    # NET-12: the flow keeps the last login for a retry while its window is open, and none once it is closed, though the
    # shell lives on.
    flow, window = _flow(FakeAuth(Offline("no network")))
    window.captured.emit(COOKIES)
    assert flow._last == (COOKIES, None)  # for Try again
    window.close()
    assert flow._last is None


def test_opening_the_login_again_brings_the_same_window_to_the_front(qtbot):
    made: list[FakeWindow] = []

    def make_window() -> FakeWindow:
        made.append(FakeWindow())
        return made[-1]

    flow = LoginFlow(FakeAuth(), make_window=make_window, choose=lambda accounts, parent: None)
    flow.start()
    flow.start()
    assert len(made) == 1
    assert made[0].started == 2
    made[0].close()
    flow.start()
    assert len(made) == 2  # a closed window is not used again: its browser has been discarded
