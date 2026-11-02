from guildboard.shell.cookies import CookieCollector, session_cookies


def test_the_three_session_cookies_complete_a_login():
    collector = CookieCollector()
    collector.add("ltoken_v2", "v2_token", ".hoyolab.com")
    collector.add("ltuid_v2", "42", ".hoyolab.com")
    assert not collector.complete()
    collector.add("ltmid_v2", "mid", ".hoyolab.com")
    assert collector.complete()
    assert collector.cookies() == {"ltoken_v2": "v2_token", "ltuid_v2": "42", "ltmid_v2": "mid"}


def test_only_session_cookies_from_hoyoverse_sites_are_taken():
    collector = CookieCollector()
    collector.add("_HYVUUID", "tracking", ".hoyolab.com")  # not a session cookie
    collector.add("ltoken_v2", "elsewhere", ".example.com")  # another site
    collector.add("ltoken_v2", "lookalike", "evilhoyolab.com")  # not a subdomain of hoyolab.com
    collector.add("cookie_token_v2", "ct", "account.hoyoverse.com")
    assert collector.cookies() == {"cookie_token_v2": "ct"}


def test_a_newer_value_replaces_an_older_one():
    collector = CookieCollector()
    collector.add("ltuid_v2", "1", ".hoyolab.com")
    collector.add("ltuid_v2", "2", "www.hoyolab.com")
    assert collector.cookies() == {"ltuid_v2": "2"}


def test_a_cookie_the_site_deletes_is_dropped_unless_a_newer_one_came_first():
    collector = CookieCollector()
    collector.add("ltuid_v2", "1", ".hoyolab.com")
    collector.remove("ltuid_v2", "1", ".hoyolab.com")
    assert collector.cookies() == {}
    collector.add("ltuid_v2", "2", ".hoyolab.com")
    collector.remove("ltuid_v2", "1", ".hoyolab.com")  # the old value, whose removal arrived after the new one
    assert collector.cookies() == {"ltuid_v2": "2"}


def test_pasted_cookies_keep_only_the_login():
    pasted = {"_HYVUUID": "x", "ltoken_v2": "a", "ltuid_v2": "1", "ltmid_v2": "m", "mi18nLang": "en-us"}
    assert session_cookies(pasted) == {"ltoken_v2": "a", "ltuid_v2": "1", "ltmid_v2": "m"}
    assert session_cookies({"ltoken": "old", "ltuid": "7"}) == {"ltoken": "old", "ltuid": "7"}  # an older login
