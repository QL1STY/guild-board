"""The ledger client, one page of a history log at a time (the ledger plan, Task 3, as revised)."""
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from guildboard.ledger import LEDGER_URL, api
from guildboard.ledger.api import (
    LEDGER_EXPIRED, LedgerKeyExpired, LedgerKeyInvalid, entry_url, fetch_page, fetch_user, user_url,
)
from guildboard.pulls.gamecache import KEY, KEY_VERSION
from guildboard.pulls.wishapi import KeyExpired, KeyInvalid, Offline, TooFrequent, Unexpected
from ledger_samples import answer, csc_link, entry, refusal

KEY_TEXT = "CSC-KEY-0123456789-ABCDEFGH"


def test_entry_url_keeps_the_links_query_and_asks_in_english():
    url = entry_url(csc_link(KEY_TEXT), "primogem", "0")
    assert url.startswith(LEDGER_URL + "GetPrimogemLog?")
    query = {name: values[0] for name, values in parse_qs(urlsplit(url).query).items()}
    assert query["lang"] == "en" and query["size"] == "20" and query["end_id"] == "0"
    assert query[KEY_VERSION] == "1" and query["sign_type"] == "2"
    assert query[KEY] == KEY_TEXT and query["auth_appid"] == "csc" and query["game_biz"] == "hk4e_global"
    assert entry_url(csc_link(), "artifact", "12").startswith(LEDGER_URL + "GetArtifactLog?")
    assert user_url(csc_link()).startswith(LEDGER_URL + "GetUserInfo?")


def test_a_page_is_read_in_server_time():
    page = fetch_page(csc_link(), "primogem", "0", 700000001, fetch=lambda url: answer([entry(5)]))
    [row] = page.rows
    assert row.at == datetime(2026, 10, 27, 3, 1, tzinfo=timezone.utc)
    assert (row.uid, row.kind, row.id, row.time, row.amount, row.reason) == (
        700000001, "primogem", 5, "2026-10-27 04:01:00", 60, "Daily Commission reward",
    )
    # with the account's region from GetUserInfo
    [row] = fetch_page(csc_link(), "primogem", "0", 1, fetch=lambda url: answer([entry(5)]), region="os_usa").rows
    assert row.at == datetime(2026, 10, 27, 9, 1, tzinfo=timezone.utc)


def test_a_page_is_newest_first():
    rows = fetch_page(csc_link(), "resin", "0", 1, fetch=lambda url: answer([entry(3), entry(9), entry(4)])).rows
    assert [row.id for row in rows] == [9, 4, 3]


def test_a_refused_key_is_KeyInvalid_and_carries_no_url():
    with pytest.raises(LedgerKeyInvalid) as caught:
        fetch_page(csc_link(KEY_TEXT), "primogem", "0", 1,
                   fetch=lambda url: refusal(-1, f"unknown auth appid:webview_gacha {KEY_TEXT}"))
    assert isinstance(caught.value, KeyInvalid)
    assert KEY_TEXT not in str(caught.value) and "authkey" not in str(caught.value)
    assert caught.value.__cause__ is None and caught.value.__context__ is None
    with pytest.raises(LedgerKeyInvalid):
        fetch_page(csc_link(), "primogem", "0", 1, fetch=lambda url: refusal(-100, "authkey error"))


def test_a_key_that_timed_out_is_KeyExpired_with_the_feedback_sentence():
    with pytest.raises(LedgerKeyExpired) as caught:
        fetch_page(csc_link(), "crystal", "0", 1, fetch=lambda url: refusal(-1, "authkey timeout"))
    assert isinstance(caught.value, KeyExpired) and str(caught.value) == LEDGER_EXPIRED
    assert LEDGER_EXPIRED == "The history link from Feedback has expired. Open Feedback in the game again, then press Import."


def test_too_many_requests_and_no_connection():
    with pytest.raises(TooFrequent):
        fetch_page(csc_link(), "crystal", "0", 1, fetch=lambda url: refusal(-110, "visit too frequently"))

    def broken(url):
        raise OSError(f"connection reset for {url}")

    with pytest.raises(Offline) as caught:
        fetch_page(csc_link(KEY_TEXT), "crystal", "0", 1, fetch=broken)
    assert KEY_TEXT not in str(caught.value) and caught.value.__context__ is None


def test_an_artifact_entry_keeps_name_and_rarity():
    body = answer([entry(8, amount=1, reason="Revitalized Petrified Tree (Domain)", name="Gladiator's Nostalgia",
                         quality=5, level=0)])
    [row] = fetch_page(csc_link(), "artifact", "0", 1, fetch=lambda url: body).rows
    assert (row.name, row.rarity, row.amount) == ("Gladiator's Nostalgia", 5, 1)


@pytest.mark.parametrize("bad", [
    b"<html>", b'{"retcode": 0, "data": {}}', b'{"retcode": 0, "data": {"list": [{"id": "x"}]}}',
    b'{"retcode": 0, "data": {"list": [{"id": "1", "datetime": "yesterday", "add_num": "5", "reason": "r"}]}}',
    b'{"retcode": 0, "data": {"list": [{"id": "1", "datetime": "2026-10-27 04:01:00", "add_num": "a", "reason": "r"}]}}',
    b'{"retcode": 7, "message": "?"}',
])
def test_a_record_that_cannot_be_read_is_Unexpected(bad):
    with pytest.raises(Unexpected):
        fetch_page(csc_link(), "primogem", "0", 1, fetch=lambda url: bad)


def test_redirects_are_not_followed(monkeypatch):
    seen = []

    def fake(url, **kwargs):
        seen.append(kwargs)
        return answer([])

    monkeypatch.setattr(api.netpolicy, "fetch_hoyoverse", fake)
    assert fetch_page(csc_link(), "primogem", "0", 1).rows == ()
    assert seen == [{"follow_redirects": False}]


def test_fetch_user_reads_the_account():
    body = b'{"retcode": 0, "data": {"uid": "700000001", "region": "os_euro", "nickname": "T"}}'
    assert fetch_user(csc_link(), fetch=lambda url: body) == (700000001, "os_euro")
    body = b'{"retcode": 0, "data": {"uid": 700000002}}'
    assert fetch_user(csc_link(), fetch=lambda url: body) == (700000002, "os_euro")
    with pytest.raises(LedgerKeyExpired):
        fetch_user(csc_link(), fetch=lambda url: refusal(-1, "authkey timeout"))
    with pytest.raises(Unexpected):
        fetch_user(csc_link(), fetch=lambda url: b'{"retcode": 0, "data": {"nickname": "T"}}')


def test_hoyoverses_own_words_for_an_old_key_mean_expired():
    # As HoYoverse answered an old key at the check with the player, 2026-10-27: retcode -1, "auth key time out".
    with pytest.raises(LedgerKeyExpired):
        fetch_page(csc_link(), "primogem", "0", 1, fetch=lambda url: refusal(-1, "auth key time out"))
