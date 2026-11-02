import pytest

from guildboard import logging_setup
from guildboard.auth import Auth, LoginOutcome, has_required, parse_cookie_text
from guildboard.records import GameAccount, LoginNeeded, Offline
from guildboard.tokenstore import TokenStore

COOKIES = {"ltoken_v2": "v2_SECRET-VALUE-0123456789", "ltuid_v2": "123456", "ltmid_v2": "abc_hy"}
EUROPE = GameAccount(700000001, "Traveler", "os_euro", 60)
ASIA = GameAccount(800000002, "Lumine", "os_asia", 45)


class Lister:
    def __init__(self, answer) -> None:
        self.answer = answer
        self.calls: list[dict] = []

    async def __call__(self, cookies):
        self.calls.append(dict(cookies))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def tokens(tmp_path) -> TokenStore:
    return TokenStore(tmp_path / "token.bin")


def _auth(tokens, answer, changes=None) -> tuple[Auth, Lister]:
    lister = Lister(answer)
    on_change = (lambda: changes.append("changed")) if changes is not None else (lambda: None)
    return Auth(tokens, lister, on_change), lister


def test_parse_cookie_text():
    assert parse_cookie_text("ltoken_v2=abc; ltuid_v2=42") == {"ltoken_v2": "abc", "ltuid_v2": "42"}
    assert parse_cookie_text("  Cookie: a=1;b=2 ;  c = x=y ; broken ; =nameless ") == {"a": "1", "b": "2", "c": "x=y"}
    assert parse_cookie_text("") == {}


def test_has_required():
    assert has_required(COOKIES)
    assert has_required({"ltoken": "a", "ltuid": "1"})
    assert not has_required({"ltoken_v2": "a"})
    assert not has_required({"ltoken_v2": "", "ltuid_v2": "1"})
    assert not has_required({})


async def test_login_with_one_account_saves_the_token(tokens):
    changes: list[str] = []
    auth, lister = _auth(tokens, [EUROPE], changes)
    outcome = await auth.login(COOKIES)
    assert outcome == LoginOutcome("ok", EUROPE)
    stored = auth.current()
    assert (stored.cookies, stored.uid, stored.server, stored.nickname) == (COOKIES, 700000001, "os_euro", "Traveler")
    assert lister.calls == [COOKIES]
    assert changes == ["changed"]


async def test_login_with_several_accounts_asks_which(tokens):
    auth, _ = _auth(tokens, [EUROPE, ASIA])
    outcome = await auth.login(COOKIES)
    assert outcome == LoginOutcome("choose", None, (EUROPE, ASIA))
    assert auth.current() is None


async def test_login_with_a_chosen_uid(tokens):
    auth, _ = _auth(tokens, [EUROPE, ASIA])
    assert await auth.login(COOKIES, uid=800000002) == LoginOutcome("ok", ASIA)
    assert auth.current().server == "os_asia"
    assert (await auth.login(COOKIES, uid=999)).status == "no_account"


async def test_rejected_cookies(tokens):
    auth, _ = _auth(tokens, LoginNeeded("HoYoLAB did not accept this login."))
    assert await auth.login(COOKIES) == LoginOutcome("rejected")
    assert auth.current() is None


async def test_no_genshin_account(tokens):
    auth, _ = _auth(tokens, [])
    assert await auth.login(COOKIES) == LoginOutcome("no_account")


async def test_missing_cookies_are_not_sent_anywhere(tokens):
    auth, lister = _auth(tokens, [EUROPE])
    assert await auth.login({"ltuid_v2": "123456"}) == LoginOutcome("missing_cookies")
    assert lister.calls == []


async def test_other_source_errors_pass_through(tokens):
    auth, _ = _auth(tokens, Offline("No connection."))
    with pytest.raises(Offline):
        await auth.login(COOKIES)


async def test_logout_deletes_the_token(tokens):
    changes: list[str] = []
    auth, _ = _auth(tokens, [EUROPE], changes)
    await auth.login(COOKIES)
    auth.logout()
    assert auth.current() is None
    assert changes == ["changed", "changed"]


async def test_login_registers_the_cookie_values_for_redaction(tokens):
    logging_setup.forget_secrets()
    auth, _ = _auth(tokens, [EUROPE])
    await auth.login(COOKIES)
    assert logging_setup.redact("ltoken_v2=v2_SECRET-VALUE-0123456789") == "ltoken_v2=[redacted]"
    logging_setup.forget_secrets()


async def test_the_first_login_remembers_the_account(tokens):
    remembered: list[int] = []
    auth = Auth(tokens, Lister([EUROPE]), account_uid=lambda: None, remember_account=remembered.append)
    assert (await auth.login(COOKIES)).status == "ok"
    assert remembered == [EUROPE.uid]


async def test_another_game_account_is_refused_and_nothing_is_saved(tokens):
    changes: list[str] = []
    remembered: list[int] = []
    auth = Auth(
        tokens, Lister([ASIA]), lambda: changes.append("changed"),
        account_uid=lambda: EUROPE.uid, remember_account=remembered.append,
    )
    outcome = await auth.login(COOKIES)
    assert outcome == LoginOutcome("other_account", ASIA, known_uid=EUROPE.uid)
    assert tokens.load() is None
    assert (changes, remembered) == ([], [])


async def test_the_same_account_may_log_in_again(tokens):
    auth = Auth(tokens, Lister([EUROPE]), account_uid=lambda: EUROPE.uid, remember_account=lambda uid: None)
    assert (await auth.login(COOKIES)).status == "ok"
