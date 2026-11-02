import os

import pytest

from guildboard import logging_setup
from guildboard.tokenstore import StoredToken, TokenStore, protect, unprotect

MARKER = "MARKER-TOKEN-0123456789"
TOKEN = StoredToken({"ltoken_v2": MARKER, "ltuid_v2": "42"}, 700000001, "os_euro", "Traveler")


def test_protect_round_trip():
    assert unprotect(protect(b"hello")) == b"hello"


def test_ciphertext_hides_the_plaintext():
    assert MARKER.encode() not in protect(MARKER.encode())


def test_garbage_cannot_be_unprotected():
    with pytest.raises(OSError):
        unprotect(b"not a protected blob")


def test_a_stored_login_shows_no_cookie_when_it_is_printed():
    # NET-12: a stored login printed, in a log line or a traceback's variables, shows its account and none of its cookies.
    for text in (repr(TOKEN), str(TOKEN)):
        assert MARKER not in text and "ltoken_v2" not in text and "700000001" in text


def test_save_and_load(tmp_path):
    path = tmp_path / "token.bin"
    TokenStore(path).save(TOKEN)
    assert TokenStore(path).load() == TOKEN


def test_file_does_not_contain_the_token(tmp_path):
    path = tmp_path / "token.bin"
    TokenStore(path).save(TOKEN)
    data = path.read_bytes()
    assert MARKER.encode() not in data
    assert b"ltoken" not in data
    assert not list(tmp_path.glob("*.tmp"))


def test_missing_file_means_no_token(tmp_path):
    assert TokenStore(tmp_path / "token.bin").load() is None


def test_unreadable_token_file_means_no_token(tmp_path):
    path = tmp_path / "token.bin"
    path.write_bytes(b"copied from another computer, or simply damaged")
    assert TokenStore(path).load() is None
    assert path.exists()  # the file is left alone; logging in again replaces it


def test_delete_is_idempotent(tmp_path):
    store = TokenStore(tmp_path / "token.bin")
    store.save(TOKEN)
    store.delete()
    store.delete()
    assert store.load() is None
    assert not (tmp_path / "token.bin").exists()


def test_update_cookies_keeps_the_account(tmp_path):
    path = tmp_path / "token.bin"
    store = TokenStore(path)
    store.save(TOKEN)
    store.update_cookies({"ltoken_v2": "fresh-value-123", "ltuid_v2": "42"})
    reloaded = TokenStore(path).load()
    assert reloaded.cookies["ltoken_v2"] == "fresh-value-123"
    assert (reloaded.uid, reloaded.server, reloaded.nickname) == (700000001, "os_euro", "Traveler")


def test_update_cookies_keeps_only_login_cookies_of_the_same_account(tmp_path):
    # L16: the library merges every cookie a HoYoLAB answer sets into its client's and hands the whole lot over. Only
    # the cookies a login is made of are kept, and only for the account logged in.
    path = tmp_path / "token.bin"
    store = TokenStore(path)
    store.save(StoredToken({**TOKEN.cookies, "mi18nLang": "en-us"}, 700000001, "os_euro", "Traveler"))
    store.update_cookies({
        **TOKEN.cookies, "mi18nLang": "en-us", "cookie_token_v2": "v2_SET-BY-HOYOLAB-0123456789",
        "_HYVUUID": "a-tracking-cookie", "lrsag": "LRSAG-SET-BY-HOYOLAB",
    })
    kept = {**TOKEN.cookies, "cookie_token_v2": "v2_SET-BY-HOYOLAB-0123456789", "lrsag": "LRSAG-SET-BY-HOYOLAB"}
    assert TokenStore(path).load().cookies == kept  # and what was kept before that is no login's is let go
    # Another account's cookies, as a sync still running with another login would hand over: ignored whole.
    store.update_cookies({"ltoken_v2": "v2_ANOTHER-ACCOUNT-0123456789", "ltuid_v2": "43", "cookie_token_v2": "v2_X-0123"})
    # So is an update that names no account at all.
    store.update_cookies({"ltoken_v2": "v2_NO-ACCOUNT-0123456789"})
    assert TokenStore(path).load().cookies == kept


def test_an_update_from_a_client_of_the_login_before_cannot_write_it_back(tmp_path):
    # The player logged in again, with the same account, while a sync ran with the login before. That client's update
    # holds the old login's cookies and what its answer set or changed, and none of it lands over the login stored now:
    # a stored login whose ltoken_v2 is not the one the client was made with is another login.
    store = TokenStore(tmp_path / "token.bin")
    before = StoredToken({**TOKEN.cookies, "cookie_token_v2": "v2_COOKIE-OF-THE-LOGIN-BEFORE"}, 700000001, "os_euro",
                         "Traveler")
    store.save(before)
    fresh = StoredToken(
        {**TOKEN.cookies, "ltoken_v2": "v2_FRESH-LOGIN-0123456789", "cookie_token_v2": "v2_COOKIE-OF-THE-FRESH-LOGIN"},
        700000001, "os_euro", "Traveler",
    )
    store.save(fresh)
    store.update_cookies(
        {**before.cookies, "cookie_token_v2": "v2_CHANGED-BY-THE-OLD-ANSWER", "account_mid_v2": "MID-OF-THE-OLD-ANSWER"},
        since=before,
    )
    assert store.load().cookies == fresh.cookies
    # A client made with the login stored now still has what its answer set kept, and once only.
    store.update_cookies({**fresh.cookies, "account_mid_v2": "MID-SET-BY-HOYOLAB-0123"}, since=fresh)
    assert store.load().cookies == {**fresh.cookies, "account_mid_v2": "MID-SET-BY-HOYOLAB-0123"}
    store.update_cookies(dict(fresh.cookies), since=fresh)  # nothing new: nothing written
    assert store.load().cookies == {**fresh.cookies, "account_mid_v2": "MID-SET-BY-HOYOLAB-0123"}


def test_an_update_whose_answer_carries_the_stored_token_is_kept_though_the_client_was_made_before_it(tmp_path):
    # HoYoLAB rotated the token while two syncs ran. The first one's update stored the rotated ltoken_v2; the second,
    # made with the token before, got an answer that holds the rotated one too (the library merges what it is sent), so
    # its other cookies are of the login stored and are kept. An answer that holds neither is of another login.
    store = TokenStore(tmp_path / "token.bin")
    store.save(TOKEN)
    rotated = {**TOKEN.cookies, "ltoken_v2": "v2_ROTATED-BY-HOYOLAB-0123456789"}
    store.update_cookies(rotated, since=TOKEN)
    assert store.load().cookies == rotated
    store.update_cookies({**rotated, "cookie_token_v2": "v2_SET-LATER-0123456789"}, since=TOKEN)
    assert store.load().cookies == {**rotated, "cookie_token_v2": "v2_SET-LATER-0123456789"}
    store.update_cookies({**TOKEN.cookies, "cookie_token_v2": "v2_OF-THE-LOGIN-BEFORE"}, since=TOKEN)
    assert store.load().cookies == {**rotated, "cookie_token_v2": "v2_SET-LATER-0123456789"}


def test_update_cookies_without_a_token_does_nothing(tmp_path):
    store = TokenStore(tmp_path / "token.bin")
    store.update_cookies({"ltoken_v2": "x"})
    assert store.load() is None


def test_cookie_values_are_masked_in_logs_once_saved_or_loaded(tmp_path):
    logging_setup.forget_secrets()
    path = tmp_path / "token.bin"
    store = TokenStore(path)
    store.save(TOKEN)
    assert logging_setup.redact(f"ltoken_v2={MARKER};") == "ltoken_v2=[redacted];"
    store.update_cookies({"ltoken_v2": "a-cookie-hoyolab-set-later-0001", "ltuid_v2": "42"})
    assert logging_setup.redact("ltoken_v2=a-cookie-hoyolab-set-later-0001;") == "ltoken_v2=[redacted];"
    logging_setup.forget_secrets()
    TokenStore(path).load()  # as after a restart
    assert logging_setup.redact("ltoken_v2=a-cookie-hoyolab-set-later-0001;") == "ltoken_v2=[redacted];"
    logging_setup.forget_secrets()


def test_the_logins_cookies_stay_masked_however_many_secrets_come_after_them(tmp_path, monkeypatch):
    # The log's mask holds MOST_SECRETS values, the one registered longest ago going first (logging_setup). The login is
    # read for every request made with it, and each read registers its cookies again, so they are never the oldest.
    monkeypatch.setattr(logging_setup, "MOST_SECRETS", 4)
    logging_setup.forget_secrets()
    try:
        store = TokenStore(tmp_path / "token.bin")
        store.save(TOKEN)
        for number in range(10):
            logging_setup.register_secret(f"ROTATED-SESSION-{number:04d}")  # the online session's tokens, renewed
            store.load()
        assert logging_setup.redact(f"ltoken_v2={MARKER}") == "ltoken_v2=[redacted]"
    finally:
        logging_setup.forget_secrets()


def test_delete_also_removes_a_leftover_temporary_file(tmp_path):
    path = tmp_path / "token.bin"
    store = TokenStore(path)
    store.save(TOKEN)
    leftover = tmp_path / "token.bin.tmp"
    leftover.write_bytes(path.read_bytes())  # as if a save had been interrupted
    store.delete()
    assert list(tmp_path.iterdir()) == []  # logging out leaves no copy of the token behind


def test_a_failed_save_leaves_no_temporary_file(tmp_path, monkeypatch):
    def refuse(source, target):
        raise PermissionError("the file is in use")

    monkeypatch.setattr(os, "replace", refuse)
    with pytest.raises(PermissionError):
        TokenStore(tmp_path / "token.bin").save(TOKEN)
    assert list(tmp_path.iterdir()) == []
