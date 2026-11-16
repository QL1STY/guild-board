import http.client
import io
import urllib.request
from urllib.parse import parse_qsl, urlsplit

import pytest

from guildboard import netpolicy
from guildboard.netpolicy import HostNotAllowed, check, fetch_bytes, is_allowed


def test_allowed_hosts():
    for url in (
        "https://www.hoyolab.com/home",
        "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/index",
        "https://act-webstatic.hoyoverse.com/game_record/genshin/icon.png",
        "https://api-os-takumi.mihoyo.com/binding/api/x",
        "https://HOYOVERSE.com./a",
    ):
        assert is_allowed(url), url


def test_refused_hosts():
    for url in (
        "http://www.hoyolab.com/home",  # not https
        "https://evilhoyolab.com/",
        "https://hoyolab.com.evil.io/",
        "https://hoyolab.com@evil.io/",
        "https://gi.yatta.moe/api/v2/en/avatar",
        "https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/avatars.json",
        "https://127.0.0.1/",
        "ftp://www.hoyolab.com/",
        "",
    ):
        assert not is_allowed(url), url


def test_check_names_only_the_host():
    with pytest.raises(HostNotAllowed) as error:
        check("https://evil.example/path?token=SECRET-VALUE")
    assert "evil.example" in str(error.value)
    assert "SECRET-VALUE" not in str(error.value)


class _Response:
    def __init__(self, data: bytes) -> None:
        self._stream = io.BytesIO(data)

    def read(self, amount: int) -> bytes:
        return self._stream.read(amount)

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def test_fetch_refuses_before_opening(monkeypatch):
    def must_not_open(*args, **kwargs):
        raise AssertionError("opened a refused host")

    monkeypatch.setattr(netpolicy, "_open", must_not_open)
    with pytest.raises(HostNotAllowed):
        fetch_bytes("https://evil.example/icon.png")


def test_fetch_returns_bytes(monkeypatch):
    seen = []

    def fake_open(request, timeout):
        seen.append((request.full_url, timeout))
        return _Response(b"PNGDATA")

    monkeypatch.setattr(netpolicy, "_open", fake_open)
    assert fetch_bytes("https://act-webstatic.hoyoverse.com/a.png", timeout=3.0) == b"PNGDATA"
    assert seen == [("https://act-webstatic.hoyoverse.com/a.png", 3.0)]


def test_an_address_with_letters_of_another_script_is_sent_percent_encoded(monkeypatch):
    # The wiki names half its weapons' icons in Chinese (Black Tassel's is 黑缨枪.png): sent as they are written, they never
    # left the PC (UnicodeEncodeError), and those weapons showed no icon on the Pulls page.
    seen = []
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: seen.append(request.full_url) or _Response(b"PNG"))
    assert fetch_bytes("https://bbs.hoyolab.com/hoyowiki/picture/weapon/黑缨枪.png") == b"PNG"
    assert seen == ["https://bbs.hoyolab.com/hoyowiki/picture/weapon/%E9%BB%91%E7%BC%A8%E6%9E%AA.png"]
    # An address already encoded, or one with a space, a query or no letter outside ASCII, is sent as a browser sends it.
    assert netpolicy.sendable("https://a.hoyoverse.com/x%20y.png") == "https://a.hoyoverse.com/x%20y.png"
    assert netpolicy.sendable("https://a.hoyoverse.com/x y.png?v=1&w=2") == "https://a.hoyoverse.com/x%20y.png?v=1&w=2"
    assert netpolicy.sendable("https://act-webstatic.hoyoverse.com/a.png") == "https://act-webstatic.hoyoverse.com/a.png"


def test_fetch_rejects_oversized_responses(monkeypatch):
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: _Response(b"x" * 11))
    with pytest.raises(netpolicy.ResponseTooLarge):
        fetch_bytes("https://act-webstatic.hoyoverse.com/a.png", max_bytes=10)


def test_redirect_to_another_host_is_refused():
    handler = netpolicy._CheckedRedirects()
    request = urllib.request.Request("https://www.hoyolab.com/a")
    with pytest.raises(HostNotAllowed):
        handler.redirect_request(request, None, 302, "Found", {}, "https://evil.example/x")


def test_redirect_within_the_allowlist_is_followed():
    handler = netpolicy._CheckedRedirects()
    request = urllib.request.Request("https://www.hoyolab.com/a")
    followed = handler.redirect_request(request, None, 302, "Found", {}, "https://act.hoyoverse.com/b")
    assert followed.full_url == "https://act.hoyoverse.com/b"


def test_the_achievement_list_address_is_allowed_and_nothing_else_on_github():
    assert is_allowed(netpolicy.ACHIEVEMENT_LIST_URL)
    for url in (
        "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/de.json",
        "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json?x=1",
        "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json#top",
        "http://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json",
        "https://user@raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json",
        "https://raw.githubusercontent.com:8443/MadeBaruna/paimon-moe/main/src/data/achievement/en.json",
        "https://github.com/MadeBaruna/paimon-moe/blob/main/src/data/achievement/en.json",
        "https://raw.githubusercontent.com/",
    ):
        assert not is_allowed(url), url


def test_a_redirect_from_the_list_to_elsewhere_on_github_is_refused():
    handler = netpolicy._CheckedRedirects()
    request = urllib.request.Request(netpolicy.ACHIEVEMENT_LIST_URL)
    with pytest.raises(HostNotAllowed):
        handler.redirect_request(
            request, None, 302, "Found", {}, "https://raw.githubusercontent.com/someone/else/main/en.json"
        )


def test_a_redirect_to_the_list_is_refused():
    handler = netpolicy._CheckedRedirects()
    request = urllib.request.Request("https://act-webstatic.hoyoverse.com/x.png")
    with pytest.raises(HostNotAllowed):
        handler.redirect_request(request, None, 302, "Found", {}, netpolicy.ACHIEVEMENT_LIST_URL)


def test_the_list_is_never_redirected_even_to_hoyoverse():
    handler = netpolicy._CheckedRedirects()
    request = urllib.request.Request(netpolicy.ACHIEVEMENT_LIST_URL)
    with pytest.raises(HostNotAllowed):
        handler.redirect_request(request, None, 302, "Found", {}, "https://act.hoyoverse.com/b")


def test_the_hoyoverse_checks_leave_the_list_out():
    # They guard the HoYoLAB client, which carries the session cookies, and the icons.
    assert netpolicy.is_hoyoverse("https://act-webstatic.hoyoverse.com/game_record/genshin/icon.png")
    assert not netpolicy.is_hoyoverse(netpolicy.ACHIEVEMENT_LIST_URL)
    netpolicy.check_hoyoverse("https://sg-public-api.hoyolab.com/x")
    with pytest.raises(HostNotAllowed) as error:
        netpolicy.check_hoyoverse(netpolicy.ACHIEVEMENT_LIST_URL)
    assert str(error.value) == "raw.githubusercontent.com"


# ---------------------------------------------------------------- HoYoverse's own pages: the wish history, the
# announcements and the wiki (the Pulls plan, Task 6)

def test_fetch_hoyoverse_refuses_other_hosts_before_opening(monkeypatch):
    opened = []
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: opened.append(request.full_url))
    # The list's one address is allowed for fetch_bytes alone: HoYoverse's fetch takes HoYoverse's domains only.
    for url in (netpolicy.ACHIEVEMENT_LIST_URL, "http://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/x",
                "https://evil.example/?authkey=x", "https://hoyoverse.com.evil.io/"):
        with pytest.raises(HostNotAllowed):
            netpolicy.fetch_hoyoverse(url)
    with pytest.raises(HostNotAllowed):
        netpolicy.fetch_hoyoverse(netpolicy.ACHIEVEMENT_LIST_URL, body=b"{}")
    assert opened == []


def test_fetch_hoyoverse_gets_with_guild_boards_user_agent(monkeypatch):
    seen = []

    def fake_open(request, timeout):
        seen.append((request.get_method(), request.full_url, request.data, dict(request.header_items()), timeout))
        return _Response(b'{"retcode": 0}')

    monkeypatch.setattr(netpolicy, "_open", fake_open)
    url = "https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api/getAnnList?game=hk4e"
    assert netpolicy.fetch_hoyoverse(url) == b'{"retcode": 0}'
    assert seen == [("GET", url, None, {"User-agent": "GuildBoard"}, 20.0)]


def test_fetch_hoyoverse_posts_a_body_with_its_headers(monkeypatch):
    seen = []

    def fake_open(request, timeout):
        seen.append((request.get_method(), request.full_url, request.data, dict(request.header_items()), timeout))
        return _Response(b'{"retcode": 0, "data": {}}')

    monkeypatch.setattr(netpolicy, "_open", fake_open)
    url = "https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list"
    body = b'{"filters": [], "menu_id": "2", "page_num": 1, "page_size": 50, "use_es": true}'
    headers = {"Origin": "https://wiki.hoyolab.com", "x-rpc-language": "en-us", "User-Agent": "Something else"}
    answer = netpolicy.fetch_hoyoverse(url, timeout=5.0, headers=headers, body=body)
    assert answer == b'{"retcode": 0, "data": {}}'
    [(method, sent_to, data, sent_headers, timeout)] = seen
    assert (method, sent_to, data, timeout) == ("POST", url, body, 5.0)
    # Every header given is sent, and the user agent is always Guild Board's own.
    assert sent_headers == {"Origin": "https://wiki.hoyolab.com", "X-rpc-language": "en-us", "User-agent": "GuildBoard"}


def test_fetch_hoyoverse_can_refuse_every_redirect(monkeypatch):
    # The wish history's address takes the key: a request that must go there alone follows no redirect, even within
    # HoYoverse's domains. Every other read keeps the shared check, which follows one there.
    elsewhere = "https://public-operation-hk4e-sg.hoyoverse.com/elsewhere"
    followed = []

    def redirecting(request, timeout):  # what urllib does with a 302: it asks the redirect handler
        followed.append(netpolicy._CheckedRedirects().redirect_request(request, None, 302, "Found", {}, elsewhere))
        return _Response(b"{}")

    monkeypatch.setattr(netpolicy, "_open", redirecting)
    with pytest.raises(netpolicy.RedirectRefused) as refused:
        netpolicy.fetch_hoyoverse(
            "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog?authkey=x",
            follow_redirects=False,
        )
    assert str(refused.value) == "public-operation-hk4e-sg.hoyoverse.com"  # the host only: no address, no query
    assert isinstance(refused.value, HostNotAllowed)
    assert netpolicy.fetch_hoyoverse("https://sg-hk4e-api.hoyoverse.com/x") == b"{}"
    assert [request.full_url for request in followed] == [elsewhere]


def test_a_connection_dropped_mid_answer_is_a_connection_error(monkeypatch):
    class Dropped:
        def read(self, amount: int) -> bytes:
            raise http.client.IncompleteRead(b'{"retcode"', 300)

        def __enter__(self) -> "Dropped":
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: Dropped())
    for fetch in (netpolicy.fetch_hoyoverse, netpolicy.fetch_bytes):
        with pytest.raises(ConnectionError):
            fetch("https://public-operation-hk4e-sg.hoyoverse.com/x")


def test_a_failure_is_named_for_the_log_without_its_text():
    # The text of a failure can hold the address it was sent to, and with it a key: the log names the kind and, from a
    # server, its HTTP status, and nothing else.
    secret = "https://public-operation-hk4e-sg.hoyoverse.com/x?authkey=SECRET"
    import urllib.error

    assert netpolicy.what_failed(urllib.error.HTTPError(secret, 503, "Service Unavailable", {}, None)) == (
        "HTTPError, HTTP 503"
    )
    assert netpolicy.what_failed(urllib.error.URLError(f"could not open {secret}")) == "URLError"
    assert netpolicy.what_failed(ValueError(secret)) == "ValueError"


def test_fetch_hoyoverse_rejects_oversized_responses(monkeypatch):
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: _Response(b"x" * 11))
    with pytest.raises(netpolicy.ResponseTooLarge):
        netpolicy.fetch_hoyoverse("https://public-operation-hk4e-sg.hoyoverse.com/x", max_bytes=10)
    assert netpolicy.fetch_hoyoverse("https://public-operation-hk4e-sg.hoyoverse.com/x", max_bytes=11) == b"x" * 11


def test_fetch_authkey_posts_to_its_one_address_with_the_four_cookies_alone(monkeypatch):
    # The key's mint (the history keys from the login): the one address on HoYoverse's account host, a POST of the body
    # given, never redirected, and of the login's cookies only the four that address asks for.
    seen = []

    def fake_open(request, timeout):
        seen.append((request.get_method(), request.full_url, request.data, dict(request.header_items()),
                     request.follow_redirects))
        return _Response(b'{"retcode": 0}')

    monkeypatch.setattr(netpolicy, "_open", fake_open)
    cookies = {
        "ltoken_v2": "v2_LTOKEN", "ltuid_v2": "1", "ltmid_v2": "m", "cookie_token_v2": "v2_COOKIE",
        "account_id_v2": "1", "account_mid_v2": "m", "lrsag": "L", "mi18nLang": "en-us",
    }
    assert netpolicy.fetch_authkey(cookies, b'{"auth_appid": "csc"}') == b'{"retcode": 0}'
    [(method, url, data, headers, follow)] = seen
    assert netpolicy.MINT_URL == "https://api-account-os.hoyoverse.com/binding/api/genAuthKeyByCookieToken"
    assert (method, url, data, follow) == ("POST", netpolicy.MINT_URL, b'{"auth_appid": "csc"}', False)
    assert headers == {
        "Cookie": "account_id_v2=1; account_mid_v2=m; cookie_token_v2=v2_COOKIE; lrsag=L",
        "Content-type": "application/json", "User-agent": "GuildBoard",
    }
    # Without lrsag, the others go.
    seen.clear()
    netpolicy.fetch_authkey({name: cookies[name] for name in ("cookie_token_v2", "account_id_v2")}, b"{}")
    assert seen[0][3]["Cookie"] == "account_id_v2=1; cookie_token_v2=v2_COOKIE"


def test_a_redirect_of_the_mint_is_refused():
    request = urllib.request.Request(netpolicy.MINT_URL, data=b"{}", method="POST")
    request.follow_redirects = False
    with pytest.raises(netpolicy.RedirectRefused):
        netpolicy._CheckedRedirects().redirect_request(
            request, None, 302, "Found", {}, "https://api-account-os.hoyoverse.com/elsewhere"
        )


ART_HOSTS = ("act-webstatic.hoyoverse.com", "bbs.hoyolab.com")


def _picture_request(url: str = "https://act-webstatic.hoyoverse.com/a.png"):
    request = urllib.request.Request(url)
    request.hosts = frozenset(ART_HOSTS)  # what fetch_bytes sets when it is given hosts
    return request


def test_a_picture_redirect_off_the_art_hosts_is_refused():
    handler = netpolicy._CheckedRedirects()
    with pytest.raises(HostNotAllowed):  # HoYoverse's own, but not a host a picture may come from
        handler.redirect_request(_picture_request(), None, 302, "Found", {}, "https://sg-public-api.hoyoverse.com/x.png")
    with pytest.raises(HostNotAllowed):
        handler.redirect_request(_picture_request(), None, 302, "Found", {}, "https://evil.example/x.png")


def test_a_picture_redirect_between_art_hosts_is_followed_and_every_hop_is_held_to_them():
    handler = netpolicy._CheckedRedirects()
    followed = handler.redirect_request(_picture_request(), None, 302, "Found", {}, "https://bbs.hoyolab.com/b.png")
    assert followed.full_url == "https://bbs.hoyolab.com/b.png"
    with pytest.raises(HostNotAllowed):  # the second hop is checked as the first was
        handler.redirect_request(followed, None, 302, "Found", {}, "https://sg-public-api.hoyoverse.com/x.png")


def test_fetch_bytes_with_hosts_refuses_a_first_request_to_another_host(monkeypatch):
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: _Response(b"png"))
    assert fetch_bytes("https://bbs.hoyolab.com/a.png", hosts=ART_HOSTS) == b"png"
    with pytest.raises(HostNotAllowed):
        fetch_bytes("https://sg-public-api.hoyoverse.com/a.png", hosts=ART_HOSTS)
    assert fetch_bytes("https://sg-public-api.hoyoverse.com/a.png") == b"png"  # without hosts, as before


# ---------------------------------------------------------------- public pictures from outside HoYoverse (the Stats
# design, section 1): exact addresses in one table, a plain GET with Guild Board's user agent, never redirected

def test_a_public_picture_is_exactly_one_of_the_table():
    assert netpolicy.PUBLIC_PICTURE_HOSTS == ("static.wikia.nocookie.net", "i.redd.it", "act.hoyolab.com")
    for url in netpolicy.PUBLIC_PICTURE_URLS:
        assert netpolicy.is_public_picture(url) and is_allowed(url), url
    assert netpolicy.is_public_picture(netpolicy.PUBLIC_PICTURE_URLS[1])
    assert not netpolicy.is_public_picture("https://i.redd.it/other.jpg")
    assert not netpolicy.is_public_picture(netpolicy.PUBLIC_PICTURE_URLS[1] + "?x=1")
    assert not netpolicy.is_public_picture("http://i.redd.it/n427epuvp0bd1.jpg")
    for url in (
        netpolicy.PUBLIC_PICTURE_URLS[1] + "#top",
        "https://user@i.redd.it/n427epuvp0bd1.jpg",
        "https://i.redd.it:8443/n427epuvp0bd1.jpg",
        "https://static.wikia.nocookie.net/gensin-impact/images/c/ca/Domain_Spiral_Abyss_Abyssal_Moon_Spire.png",
        "https://static.wikia.nocookie.net/other.png",
        "https://i.redd.it.evil.example/n427epuvp0bd1.jpg",
        netpolicy.ACHIEVEMENT_LIST_URL,
        "https://act-webstatic.hoyoverse.com/a.png",
        "",
    ):
        assert not netpolicy.is_public_picture(url), url
    for url in ("https://i.redd.it/other.jpg", "https://static.wikia.nocookie.net/other.png", "https://i.redd.it/"):
        assert not is_allowed(url), url
    # The HoYoverse checks, which guard the HoYoLAB client and the reads of HoYoverse's pages, leave out the pictures
    # from outside HoYoverse; the Theater's marks are HoYoLAB's own, on its Battle Chronicle's host.
    outside = [url for url in netpolicy.PUBLIC_PICTURE_URLS if not url.startswith("https://act.hoyolab.com/")]
    assert len(outside) == 3 and not any(netpolicy.is_hoyoverse(url) for url in outside)
    assert not netpolicy.is_public_picture("https://act.hoyolab.com/app/community-game-records-sea/images/other.png")


def test_a_public_picture_is_fetched_with_the_user_agent_alone_and_no_redirect(monkeypatch):
    picture = netpolicy.PUBLIC_PICTURE_URLS[1]
    seen = []

    def fake_open(request, timeout):
        seen.append((request.get_method(), request.full_url, request.data, dict(request.header_items())))
        return _Response(b"\xff\xd8\xffJPEG")

    monkeypatch.setattr(netpolicy, "_open", fake_open)
    assert fetch_bytes(picture, max_bytes=8 * 1024 * 1024) == b"\xff\xd8\xffJPEG"
    # A plain GET, with no body, and of the headers Guild Board's user agent alone: no cookie, no token, no key.
    assert seen == [("GET", picture, None, {"User-agent": "GuildBoard"})]
    # Its answer is held to the size the caller allows.
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: _Response(b"x" * 11))
    with pytest.raises(netpolicy.ResponseTooLarge):
        fetch_bytes(picture, max_bytes=10)
    # It follows no redirect: not to another host, not on its own host, and not to another address of the table.
    for elsewhere in ("https://evil.example/x.jpg", "https://i.redd.it/other.jpg", netpolicy.PUBLIC_PICTURE_URLS[0],
                      "https://act-webstatic.hoyoverse.com/a.png"):
        def redirecting(request, timeout):  # what urllib does with a 302: it asks the redirect handler
            netpolicy._CheckedRedirects().redirect_request(request, None, 302, "Found", {}, elsewhere)
            raise AssertionError("a redirect was followed")

        monkeypatch.setattr(netpolicy, "_open", redirecting)
        with pytest.raises(HostNotAllowed):
            fetch_bytes(picture, max_bytes=8 * 1024 * 1024)
    # The art cache's hosts now name the public pictures' too, and still no picture of HoYoverse's is redirected there.
    request = _picture_request()
    request.hosts = frozenset(ART_HOSTS + netpolicy.PUBLIC_PICTURE_HOSTS)
    with pytest.raises(HostNotAllowed):
        netpolicy._CheckedRedirects().redirect_request(request, None, 302, "Found", {}, picture)
    # And HoYoverse's reads never take one.
    opened = []
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: opened.append(request.full_url))
    with pytest.raises(HostNotAllowed):
        netpolicy.fetch_hoyoverse(picture)
    assert opened == []


def test_the_frozen_build_verifies_through_the_windows_store(monkeypatch):
    # The Windows store is read through Windows' own chain building, which fetches a root the PC does not hold yet; OpenSSL's
    # own reading of the store does not. The entry points call truststore once, before any request is made.
    import tomllib
    from pathlib import Path

    import truststore

    from guildboard import __main__ as entry

    project = tomllib.loads((Path(entry.__file__).resolve().parents[2] / "pyproject.toml").read_text(encoding="utf-8"))
    assert any(name.startswith("truststore") for name in project["project"]["dependencies"])
    calls = []
    monkeypatch.setattr(truststore, "inject_into_ssl", lambda: calls.append(1))
    monkeypatch.setattr(entry, "_TLS_READY", False)
    assert entry.main([]) == 2  # refused before anything starts (no switch for a shell), and after the call
    assert entry.main([]) == 2
    assert calls == [1]


def test_every_request_of_netpolicy_verifies_as_the_entry_chose(monkeypatch):
    # The opener takes its TLS context as it is built, and netpolicy is imported before the entry runs: built only then, it
    # would keep the plain context, and truststore would reach aiohttp alone.
    import ssl

    import truststore

    from guildboard import __main__ as entry

    monkeypatch.setattr(netpolicy, "_open", netpolicy._open)  # the guard of the tests comes back after this one
    monkeypatch.setattr(entry, "_TLS_READY", False)

    def context_of_the_opener():
        handler = next(one for one in netpolicy._open.__self__.handlers if isinstance(one, urllib.request.HTTPSHandler))
        return type(handler._context)

    try:
        entry.use_the_windows_store()
        assert context_of_the_opener() is truststore.SSLContext
    finally:
        truststore.extract_from_ssl()
    netpolicy.take_the_tls_in_use()
    assert context_of_the_opener() is ssl.SSLContext


# The dates of upcoming events, from the Genshin Impact Wiki on Fandom (the widgets plan, Task 2b): one path, two query shapes.

FANDOM = "https://genshin-impact.fandom.com/api.php"
FANDOM_UPCOMING = (
    FANDOM + "?action=query&list=categorymembers&cmtitle=Category:Upcoming_Content&cmlimit=100&format=json&formatversion=2"
)
FANDOM_PAGES = (
    FANDOM + "?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles="
)


def test_the_fandom_wikis_two_query_shapes_are_the_only_addresses_it_allows():
    assert netpolicy.is_fandom_query(FANDOM_UPCOMING) and netpolicy.is_fandom_query(netpolicy.fandom_upcoming_url())
    assert netpolicy.is_fandom_query(FANDOM_PAGES + "Frames of Fierce Splendor|Ley Line Overflow/2026-12-07")
    assert netpolicy.is_fandom_query(netpolicy.fandom_pages_url(["Frames of Fierce Splendor", "Ley Line Overflow/2026-12-07"]))
    assert netpolicy.is_fandom_query(FANDOM_PAGES + "|".join(f"Page {n}" for n in range(50)))
    refused = (
        FANDOM,  # no query
        FANDOM + "?action=query",  # a shape of neither kind
        FANDOM_UPCOMING + "&extra=1",
        FANDOM_UPCOMING.replace("cmlimit=100", "cmlimit=500"),
        FANDOM_UPCOMING.replace("Upcoming_Content", "Other"),
        FANDOM_UPCOMING.replace("list=categorymembers", "list=search"),
        FANDOM_UPCOMING + "#fragment",
        FANDOM_UPCOMING.replace("&format=json", ""),
        FANDOM_UPCOMING.replace("action=query&", "action=query&action=query&"),
        FANDOM_PAGES,  # no titles
        FANDOM_PAGES + "a" * 201,
        FANDOM_PAGES + "|".join(f"Page {n}" for n in range(51)),
        FANDOM_PAGES + "A|",  # an empty title
        FANDOM_PAGES + "A<script>",
        FANDOM_PAGES + "A&titles=B",
        FANDOM_PAGES.replace("rvprop=content", "rvprop=content|user") + "A",
        FANDOM_PAGES.replace("action=query&", "action=parse&") + "A",
        FANDOM_PAGES.replace("&titles=", "&pageids=") + "1",
        "https://genshin-impact.fandom.com/wiki/Special:Search?query=a",
        "https://genshin-impact.fandom.com/api.php/x?" + FANDOM_UPCOMING.split("?")[1],
        FANDOM_UPCOMING.replace("https://", "http://"),
        FANDOM_UPCOMING.replace("genshin-impact.fandom.com", "fandom.com"),
        FANDOM_UPCOMING.replace("genshin-impact.fandom.com", "genshin-impact.fandom.com:8443"),
        FANDOM_UPCOMING.replace("https://", "https://user@"),
        FANDOM_UPCOMING.replace("https://genshin-impact", "https://evil.example/.genshin-impact"),
        "https://genshin-impact.fandom.com.evil.example/api.php?" + FANDOM_UPCOMING.split("?")[1],
        "",
    )
    for url in refused:
        assert not netpolicy.is_fandom_query(url), url
        with pytest.raises(HostNotAllowed):
            netpolicy.check_fandom(url)
    # No other check lets it through: the wide checks and the downloads never reach the wiki.
    for url in (FANDOM_UPCOMING, FANDOM_PAGES + "A", FANDOM):
        assert not is_allowed(url)
        with pytest.raises(HostNotAllowed):
            fetch_bytes(url)
        with pytest.raises(HostNotAllowed):
            netpolicy.fetch_hoyoverse(url)


def test_pages_are_asked_for_one_to_fifty_at_a_time_by_titles_of_a_kind_a_page_can_have():
    for titles in ([], ["A"] * 51, [""], ["  "], ["A|B"], ["A\nB"], ["A[B]"], ["A" * 201], ["{{X}}"], ["A#B"]):
        with pytest.raises(ValueError):
            netpolicy.fandom_pages_url(titles)
    url = netpolicy.fandom_pages_url(["Ley Line Overflow/2026-12-07", "Frames of Fierce Splendor"])
    assert " " not in url and "|" not in url
    assert dict(parse_qsl(urlsplit(url).query))["titles"] == "Ley Line Overflow/2026-12-07|Frames of Fierce Splendor"


def test_the_fandom_reads_send_a_plain_get_with_the_user_agent_alone_and_follow_no_redirect(monkeypatch):
    seen = []

    def fake_open(request, timeout):
        seen.append((request.get_method(), request.full_url, request.data, dict(request.header_items()), request.follow_redirects))
        return _Response(b"{}")

    monkeypatch.setattr(netpolicy, "_open", fake_open)
    assert netpolicy.fetch_fandom_upcoming() == b"{}" and netpolicy.fetch_fandom_pages(["Frames of Fierce Splendor"]) == b"{}"
    assert [(method, data, headers, follow) for method, _, data, headers, follow in seen] == [
        ("GET", None, {"User-agent": "GuildBoard"}, False)
    ] * 2
    assert all(netpolicy.is_fandom_query(url) for _, url, *_ in seen)
    # Its answer is held to the size the caller allows.
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: _Response(b"x" * 11))
    with pytest.raises(netpolicy.ResponseTooLarge):
        netpolicy.fetch_fandom_upcoming(max_bytes=10)

    # Never redirected, not even to the wiki's own other address.
    def redirecting(request, timeout):
        netpolicy._CheckedRedirects().redirect_request(request, None, 302, "Found", {}, "https://genshin-impact.fandom.com/wiki/X")
        raise AssertionError("a redirect was followed")

    monkeypatch.setattr(netpolicy, "_open", redirecting)
    with pytest.raises(HostNotAllowed):
        netpolicy.fetch_fandom_upcoming()
    # A request that is not one of the two shapes is refused before it is opened.
    opened = []
    monkeypatch.setattr(netpolicy, "_open", lambda request, timeout: opened.append(request.full_url))
    with pytest.raises(ValueError):
        netpolicy.fetch_fandom_pages(["A|B"])
    with pytest.raises(HostNotAllowed):
        netpolicy._fandom_get(FANDOM + "?action=query", 10, 10)
    assert opened == []
