"""Validate a captured HoYoLAB login, choose the game account, keep or delete the token."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Mapping, Sequence

from guildboard.logging_setup import register_secret
from guildboard.records import GameAccount, LoginNeeded
from guildboard.tokenstore import StoredToken, TokenStore

_REQUIRED_PAIRS = (("ltoken_v2", "ltuid_v2"), ("ltoken", "ltuid"))

AccountLister = Callable[[Mapping[str, str]], Awaitable[Sequence[GameAccount]]]


def parse_cookie_text(text: str) -> dict[str, str]:
    """Read a pasted cookie string: `name=value; name=value`, with or without a leading `Cookie:`."""
    text = text.strip()
    if text.lower().startswith("cookie:"):
        text = text[len("cookie:"):]
    cookies: dict[str, str] = {}
    for part in text.split(";"):
        name, separator, value = part.strip().partition("=")
        if separator and name.strip():
            cookies[name.strip()] = value.strip()
    return cookies


def has_required(cookies: Mapping[str, str]) -> bool:
    return any(all(cookies.get(name) for name in pair) for pair in _REQUIRED_PAIRS)


@dataclass(frozen=True)
class LoginOutcome:
    status: str
    account: GameAccount | None = None
    accounts: tuple[GameAccount, ...] = ()
    known_uid: int | None = None  # with "other_account": the game account whose history this folder keeps


class Auth:
    def __init__(
        self,
        tokens: TokenStore,
        list_accounts: AccountLister,
        on_change: Callable[[], None] = lambda: None,
        *,
        account_uid: Callable[[], int | None] = lambda: None,
        remember_account: Callable[[int], None] = lambda uid: None,
    ) -> None:
        self._tokens = tokens
        self._list_accounts = list_accounts
        self._on_change = on_change
        self._account_uid = account_uid
        self._remember_account = remember_account

    def current(self) -> StoredToken | None:
        return self._tokens.load()

    async def login(self, cookies: Mapping[str, str], uid: int | None = None) -> LoginOutcome:
        if not has_required(cookies):
            return LoginOutcome("missing_cookies")
        for value in cookies.values():
            register_secret(value)
        try:
            accounts = tuple(await self._list_accounts(cookies))
        except LoginNeeded:
            return LoginOutcome("rejected")
        if not accounts:
            return LoginOutcome("no_account")
        if uid is None and len(accounts) > 1:
            return LoginOutcome("choose", None, accounts)
        chosen = accounts[0] if uid is None else next((a for a in accounts if a.uid == uid), None)
        if chosen is None:
            return LoginOutcome("no_account", None, accounts)
        # One history follows one game account (spec section 18): another account is refused.
        known = self._account_uid()
        if known is not None and chosen.uid != known:
            return LoginOutcome("other_account", chosen, known_uid=known)
        self._tokens.save(StoredToken(dict(cookies), chosen.uid, chosen.server, chosen.nickname))
        if known is None:
            self._remember_account(chosen.uid)
        self._on_change()
        return LoginOutcome("ok", chosen)

    def logout(self) -> None:
        self._tokens.delete()
        self._on_change()
