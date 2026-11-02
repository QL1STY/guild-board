"""Signing in: PKCE, the one sign-in that is waiting, and a tag name out of whatever Discord gives."""
import base64
import hashlib
import re
from urllib.parse import parse_qs, urlsplit

import pytest

from guildboard import logging_setup
from guildboard.cloud.signin import WaitingSignIn, authorize_url, challenge_for, discord_name, pkce_pair, tag_name


def test_the_challenge_is_the_verifiers_hash():
    # RFC 7636, appendix B.
    assert challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_a_pair_is_a_verifier_and_its_challenge():
    verifier, challenge = pkce_pair()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43,128}", verifier)  # the RFC's length, and its characters
    assert challenge == challenge_for(verifier)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    assert base64.urlsafe_b64decode(challenge + "=") == digest
    assert "=" not in challenge


def test_two_pairs_differ():
    assert pkce_pair()[0] != pkce_pair()[0]


def test_authorize_url():
    redirect = "http://127.0.0.1:54321/auth/callback/the-nonce"
    url = authorize_url(redirect, "the-challenge")
    parts = urlsplit(url)
    assert (parts.scheme, parts.hostname, parts.path) == ("https", "tspjpcyhpkfetwzolzvi.supabase.co", "/auth/v1/authorize")
    assert parse_qs(parts.query, strict_parsing=True) == {
        "provider": ["custom:discord"], "redirect_to": [redirect], "code_challenge": ["the-challenge"],
        "code_challenge_method": ["s256"],
    }
    assert "redirect_to=http%3A%2F%2F127.0.0.1%3A54321%2Fauth%2Fcallback%2Fthe-nonce" in parts.query
    # Every extra parameter of /authorize goes on to Discord, and Supabase keeps the flow on its own side.
    assert "state" not in parts.query and "scopes" not in parts.query


def _nonce(address: str) -> str:
    redirect = parse_qs(urlsplit(address).query)["redirect_to"][0]
    return redirect.rsplit("/", 1)[-1]


def _waiting(clock=None) -> WaitingSignIn:
    return WaitingSignIn(now=lambda: clock.now().timestamp()) if clock is not None else WaitingSignIn()


def test_begin_gives_the_address_on_the_cores_port():
    address = _waiting().begin(4321)
    redirect = parse_qs(urlsplit(address).query)["redirect_to"][0]
    assert re.fullmatch(r"http://127\.0\.0\.1:4321/auth/callback/[A-Za-z0-9_-]{32}", redirect)


def test_the_address_carries_the_verifiers_challenge():
    waiting = _waiting()
    address = waiting.begin(4321)
    verifier = waiting.take(_nonce(address))
    assert parse_qs(urlsplit(address).query)["code_challenge"] == [challenge_for(verifier)]


def test_a_nonce_works_once():
    waiting = _waiting()
    nonce = _nonce(waiting.begin(4321))
    assert waiting.is_waiting
    assert waiting.take(nonce)
    assert not waiting.is_waiting
    assert waiting.take(nonce) is None


@pytest.mark.parametrize("wrong", ["", "x", "żółć", "\U0001F600"])
def test_a_wrong_nonce_gives_nothing_and_keeps_the_waiting_one(wrong):
    waiting = _waiting()
    nonce = _nonce(waiting.begin(4321))
    assert waiting.take(wrong) is None
    assert waiting.is_waiting
    assert waiting.take(nonce)


def test_nothing_is_waiting_at_first():
    waiting = _waiting()
    assert not waiting.is_waiting
    assert waiting.take("anything") is None


def test_a_nonce_dies_after_ten_minutes(clock):
    waiting = _waiting(clock)
    nonce = _nonce(waiting.begin(4321))
    clock.advance(minutes=10)
    assert waiting.is_waiting
    clock.advance(seconds=1)
    assert not waiting.is_waiting
    assert waiting.take(nonce) is None


def test_a_nonce_holds_for_the_ten_minutes(clock):
    waiting = _waiting(clock)
    nonce = _nonce(waiting.begin(4321))
    clock.advance(minutes=10)
    assert waiting.take(nonce)


def test_a_new_sign_in_replaces_the_old():
    waiting = _waiting()
    old = _nonce(waiting.begin(4321))
    new = _nonce(waiting.begin(4321))
    assert old != new
    assert waiting.take(old) is None
    assert waiting.take(new)


def test_a_waiting_sign_in_can_be_dropped():
    waiting = _waiting()
    nonce = _nonce(waiting.begin(4321))
    waiting.drop()
    assert not waiting.is_waiting
    assert waiting.take(nonce) is None


def test_the_nonce_and_the_verifier_are_masked_in_the_log():
    logging_setup.forget_secrets()
    try:
        waiting = _waiting()
        nonce = _nonce(waiting.begin(4321))
        verifier = waiting.take(nonce)
        assert logging_setup.redact(f"{nonce} {verifier}") == "[redacted] [redacted]"
    finally:
        logging_setup.forget_secrets()


@pytest.mark.parametrize("raw, name", [
    ("Sora", "Sora"), ("Żółć", "Żółć"), ("a.b_c-d e", "ab_c-d e"), ("😀😀", "Traveler"), ("x", "Traveler"),
    ("  two   words  ", "two words"), ("x" * 40, "x" * 20), (None, "Traveler"),
    ("trailing space after cut" + " " * 20, "trailing space after"),
    ("", "Traveler"), ("   ", "Traveler"), ("a b", "a b"), ("ab", "ab"), ("😀x😀", "Traveler"), ("漢字", "漢字"),
    ("nineteen letters ab cd", "nineteen letters ab"),  # the cut leaves a space at the end
    ("tab\tin\nname", "tabinname"),
])
def test_tag_name(raw, name):
    assert tag_name(raw) == name


@pytest.mark.parametrize("raw, name", [
    ("ＡＢ", "AB"), ("𝐍𝐨𝐯𝐚", "Nova"), ("ﬁsh", "fish"),  # fullwidth, mathematical and a ligature, as NFKC writes them
    ("Nova" + chr(0x3164) + "Vale", "NovaVale"), (chr(0x3164) * 2, "Traveler"),  # Hangul fillers, which look blank
    (chr(0x115F) + chr(0x1160) + chr(0xFFA0), "Traveler"),
    ("Z" + chr(0x307) + "ółć", "Żółć"),  # a letter and its mark, as one
])
def test_a_name_is_written_as_the_database_takes_it(raw, name):
    # The database refuses a name NFKC would change, and Hangul fillers, which look blank (0004): a Discord name written
    # that way is kept as its plain letters, and not lost to the fallback.
    assert tag_name(raw) == name


@pytest.mark.parametrize("raw", ["Sora", "Żółć 漢字-_1", " a ", "x" * 40, "a.b_c-d e", "..ab..", "a  b"])
def test_a_name_that_is_kept_fits_the_tags_rule(raw):
    name = tag_name(raw)
    assert 2 <= len(name) <= 20 and name == name.strip()
    assert all(letter.isalnum() or letter in " _-" for letter in name)


def _user(**metadata) -> dict:
    return {"id": "the-id", "user_metadata": metadata}


def test_discord_name_prefers_the_display_name():
    user = _user(custom_claims={"global_name": "Shown Name"}, full_name="username", name="username#0")
    assert discord_name(user) == "Shown Name"


def test_discord_name_falls_back_on_the_full_name_then_the_name():
    assert discord_name(_user(custom_claims={"global_name": None}, full_name="username", name="username#0")) == "username"
    assert discord_name(_user(custom_claims={}, full_name="  ", name="username#0")) == "username#0"
    assert discord_name(_user(name="username#0")) == "username#0"


@pytest.mark.parametrize("user", [
    {}, {"user_metadata": None}, {"user_metadata": []}, _user(), _user(custom_claims="text", full_name=7, name=None),
])
def test_discord_name_without_a_name_is_none(user):
    assert discord_name(user) is None
