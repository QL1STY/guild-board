"""Signing in with Discord, through Supabase, in the player's own browser (the online design, section 5). PKCE makes the code
useless to anyone but this core, and the one-time value in the redirect's path means that only the tab this sign-in opened
can finish it."""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
import unicodedata
from typing import Any, Callable, Mapping
from urllib.parse import urlencode

from guildboard.cloud import SITE
from guildboard.logging_setup import register_secret

FALLBACK_NAME = "Traveler"
SHORTEST_NAME, LONGEST_NAME = 2, 20
WAIT_SECONDS = 10 * 60
HANGUL_FILLERS = dict.fromkeys((0x115F, 0x1160, 0x3164, 0xFFA0))  # letters to Python, blank to a reader


def challenge_for(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def pkce_pair() -> tuple[str, str]:
    """A new verifier and its S256 challenge, base64url with no padding."""
    verifier = secrets.token_urlsafe(32)
    return verifier, challenge_for(verifier)


def authorize_url(redirect: str, challenge: str) -> str:
    """Where the browser goes to sign in. No `state` and no `scopes`: Supabase keeps the flow on its own side, and every
    extra parameter of /authorize goes on to Discord. The project's custom provider asks for the `identify` scope alone,
    so Discord gives no e-mail address (cloud/README.md)."""
    query = urlencode({
        "provider": "custom:discord", "redirect_to": redirect, "code_challenge": challenge, "code_challenge_method": "s256",
    })
    return f"{SITE}/auth/v1/authorize?{query}"


def tag_name(raw: str | None) -> str:
    """A name that fits the tag's rule, made from what Discord calls the player, or the fallback when too little of it
    fits. The database has the last word: Python and Postgres don't agree on every letter (`invalid_name`). It refuses a name
    that NFKC would change, and the Hangul fillers, which look blank (0004), so a name is written as NFKC writes it, without
    them: a fullwidth "ＡＢ" is kept as "AB", and is not lost to the fallback."""
    plain = unicodedata.normalize("NFKC", raw or "").translate(HANGUL_FILLERS)
    kept = unicodedata.normalize("NFKC", "".join(letter for letter in plain if letter.isalnum() or letter in " _-"))
    name = " ".join(kept.split())[:LONGEST_NAME].strip()
    return name if len(name) >= SHORTEST_NAME else FALLBACK_NAME


def discord_name(user: Mapping[str, Any]) -> str | None:
    """The name a player goes by on Discord, from the user Supabase gives: the display name, or the account's name."""
    metadata = user.get("user_metadata")
    if not isinstance(metadata, Mapping):
        return None
    claims = metadata.get("custom_claims")
    display = claims.get("global_name") if isinstance(claims, Mapping) else None
    for name in (display, metadata.get("full_name"), metadata.get("name")):
        if isinstance(name, str) and name.strip():
            return name
    return None


class WaitingSignIn:
    """The one sign-in in progress: a new one replaces it, and it can be finished once, within ten minutes."""

    def __init__(self, *, now: Callable[[], float] = time.time) -> None:
        self._now = now
        self._nonce: str | None = None
        self._verifier = ""
        self._since = 0.0

    @property
    def is_waiting(self) -> bool:
        return self._nonce is not None and self._now() - self._since <= WAIT_SECONDS

    def begin(self, port: int) -> str:
        """Starts a sign-in, and gives the address for the browser."""
        verifier, challenge = pkce_pair()
        self._nonce, self._verifier, self._since = secrets.token_urlsafe(24), verifier, self._now()
        register_secret(self._nonce)
        register_secret(verifier)
        return authorize_url(f"http://127.0.0.1:{port}/auth/callback/{self._nonce}", challenge)

    def take(self, nonce: str) -> str | None:
        """The verifier of the sign-in this nonce began, once. A wrong nonce leaves the waiting sign-in as it is, so that
        a stray request to the core cannot end it."""
        if self._nonce is None or not secrets.compare_digest(nonce.encode("utf-8", "replace"), self._nonce.encode("ascii")):
            return None
        verifier = self._verifier if self.is_waiting else None
        self.drop()
        return verifier

    def drop(self) -> None:
        self._nonce, self._verifier = None, ""
