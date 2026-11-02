import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PySide6.QtCore import QUrl
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings

from guildboard.shell.verify import VerifyWindow

COOKIES = {"ltoken_v2": "v2_FAKE-TOKEN", "ltuid_v2": "42", "ltmid_v2": "fake_mid"}


@pytest.fixture
def battle_chronicle():
    """A stand-in for HoYoLAB's Battle Chronicle page on this PC: it shows the cookies it was sent."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            body = (self.headers.get("Cookie") or "").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/"
    server.shutdown()
    server.server_close()


def _window(url: str, **more) -> VerifyWindow:
    """A verification window on the stand-in, whose page may go to the stand-in's own address alone, as HoYoLAB's goes
    to HoYoverse's sites alone."""
    return VerifyWindow(COOKIES, url=url, allowed=lambda address: address.startswith(url), **more)


def test_the_verification_page_opens_with_the_stored_login(qtbot, battle_chronicle):
    window = _window(battle_chronicle, cookie_domain=None)
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    shown: list[str] = []
    window.page().toPlainText(shown.append)
    qtbot.waitUntil(lambda: bool(shown))
    assert sorted(shown[0].split("; ")) == ["ltmid_v2=fake_mid", "ltoken_v2=v2_FAKE-TOKEN", "ltuid_v2=42"]


def test_the_stored_login_is_offered_to_hoyolab_only(qtbot, battle_chronicle):
    window = _window(battle_chronicle)  # the cookies are for hoyolab.com, as in use
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    shown: list[str] = []
    window.page().toPlainText(shown.append)
    qtbot.waitUntil(lambda: bool(shown))
    assert shown[0] == ""


def test_closing_the_verification_window_is_reported_and_discards_its_browser(qtbot, battle_chronicle, qtlog):
    window = _window(battle_chronicle, cookie_domain=None)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    with qtbot.waitSignal(window.closed):
        window.close()
    window.deleteLater()
    qtbot.wait(300)
    assert not [record.message for record in qtlog.records if "profile" in record.message.lower()]


def test_the_verify_page_goes_to_hoyoverse_and_the_sign_in_pages_alone_and_hands_no_other_scheme_to_windows(qtbot):
    # L17: as the login window's, the page has no address bar: its main frame goes to HoYoverse's own sites and the
    # sign-in pages HoYoLAB offers alone, over https, and an address of a scheme Chromium does not know is never handed
    # to a program of Windows'.
    window = VerifyWindow(COOKIES)
    qtbot.addWidget(window)
    page = window.page()
    link = QWebEnginePage.NavigationType.NavigationTypeLinkClicked
    allowed = [
        page.acceptNavigationRequest(QUrl(address), link, True) for address in (
            "https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys", "https://www.hoyolab.com/home",
            "https://accounts.google.com/o/oauth2/auth", "https://discord.com/oauth2/authorize",
            "https://evil.example/", "http://act.hoyolab.com/", "https://login.live.com/", "ms-settings:privacy",
        )
    ]
    assert allowed == [True, True, True, True, False, False, False, False]
    assert page.acceptNavigationRequest(QUrl("https://captcha.example/frame"), link, False)
    assert page.settings().unknownUrlSchemePolicy() == QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes


def test_a_verification_page_that_moves_to_an_empty_page_is_sent_back_to_its_address(qtbot, battle_chronicle):
    # about:blank never reaches acceptNavigationRequest, so a click in a frame could leave a blank window.
    window = _window(battle_chronicle, cookie_domain=None)
    qtbot.addWidget(window)
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.start()
    with qtbot.waitSignal(window.page().loadFinished, timeout=20_000):
        window.page().runJavaScript("window.location.href = 'about:blank'")
    qtbot.waitUntil(lambda: window.page().url().toString().startswith(battle_chronicle), timeout=20_000)
