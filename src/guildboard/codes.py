"""Gift codes (the gift codes design, section 1): the codes the player typed, pasted or clicked, what each one did on
each account, and the livestream codes that are new to an account. Sending a code is the core's work, on the player's
press; this module only keeps and sorts what is known."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlsplit

from guildboard.netpolicy import is_hoyoverse
from guildboard.store import Store
from guildboard.tokenstore import LOGIN_COOKIES

# What a code did, as the interface gets it and the words it shows. "login" and "failed" are never kept: the code was
# not judged, so it may be sent again.
RESULT_TEXT = {
    "redeemed": "Redeemed",
    "already": "Already redeemed on this account",
    "expired": "Expired",
    "invalid": "Not a valid code",
    "low_ar": "Adventure Rank too low",
    "login": "Log in again to redeem codes",
    "failed": "HoYoverse did not answer, try again",
}
KEPT_RESULTS = frozenset({"redeemed", "already", "expired", "invalid", "low_ar"})
# A code that has gone through (or was found to have gone through before) is not sent again.
SETTLED = frozenset({"redeemed", "already"})
MAX_PRIMOGEMS = 100_000

_SEPARATORS = re.compile(r"[\s,;]+")
# The marks around a code in a sentence or a list, which are no part of it: "GENSHINGIFT.", "(GENSHINGIFT)", "Code:X".
_MARKS = re.compile(r"[.:()\"']+")
# A gift code, in capitals: 6 to 20 of the letters A to Z and the digits, at least one of them a letter, so that a UID
# or an account's number is never one. Any other word is no code, and is never sent or kept: the login's paste steps
# have the player copy the Cookie line, whose words must never go to HoYoverse as codes, nor into the history, which
# goes up to the account. An ordinary word of 6 to 20 letters is shaped as a code too, and is sent: the shape cannot
# tell words from codes.
CODE_SHAPE = re.compile(r"(?=.*[A-Z])[A-Z0-9]{6,20}")
SHAPE_SENTENCE = "A gift code is 6 to 20 letters and digits, with at least one letter."
NO_CODE = "There is no code to redeem."
PASTED_LOGIN = "Nothing was sent: this holds a login's cookies, not gift codes."
# A cookie as a login's Cookie line writes each: a name, then "=". The code= parameter of a gift link is none.
_COOKIE = re.compile(r"(?![\"']?code=)[\"']?[A-Za-z_][A-Za-z0-9_-]*=", re.IGNORECASE)
# The name of a cookie of the login anywhere in a text, as a JSON or cookies.txt export of the browser's cookies names
# each, whose fields and short values do not look like a Cookie line.
_LOGIN_COOKIE_NAME = re.compile(r"(?<![A-Za-z0-9_-])(?:" + "|".join(LOGIN_COOKIES) + r")(?![A-Za-z0-9_-])")


def is_code(text: object) -> bool:
    """Whether `text` is shaped as a gift code, in capitals."""
    return isinstance(text, str) and text.isascii() and CODE_SHAPE.fullmatch(text) is not None


def holds_cookies(text: str) -> bool:
    """Whether a typed or pasted text holds a cookie, as a pasted login does, or names a cookie of the login anywhere.
    None of such a text is a code: the marks a code may stand between are also the dots inside a cookie's value, and no
    part of one is ever sent."""
    return _LOGIN_COOKIE_NAME.search(text) is not None or any(_COOKIE.match(part) for part in _SEPARATORS.split(text))


def _link_codes(part: str) -> list[str]:
    """The words a part holding "/" or "?" gives: the code= parameters when it is a link of HoYoverse's, else the
    part whole, which is no code. Such a part is never cut at its dots and colon: the pieces of a link read as codes."""
    link = part.strip("(<\"'").rstrip(".)>\"'")
    try:
        found = parse_qs(urlsplit(link).query).get("code") if is_hoyoverse(link) else None
    except ValueError:
        found = None
    return found or [part]


def _words(text: str) -> list[str]:
    """The words of a typed or pasted text: what stands between spaces, new lines, commas and semicolons, and the
    marks around a code in a sentence. A link, or any word holding "/" or "?", is kept whole (_link_codes)."""
    words: list[str] = []
    for part in _SEPARATORS.split(text):
        if "/" in part or "?" in part:
            words.extend(_link_codes(part))
        elif part[:5].lower() == "code=":  # a link's parameter on its own
            words.extend(word for word in _MARKS.split(part[5:]) if word)
        else:
            words.extend(word for word in _MARKS.split(part) if word)
    return words


def _code_of(word: str) -> str | None:
    """The gift code a word is, in capitals, or None. A word of other than ASCII is none, whatever it reads as in
    capitals."""
    return word.upper() if word.isascii() and is_code(word.upper()) else None


def split_codes(text: str) -> list[str]:
    """The gift codes in a typed or pasted text: its words that are shaped as a code, in capitals, each once in the
    order first seen; none at all in a text that holds a login's cookies. Every other word is left out
    (skipped_words)."""
    if holds_cookies(text):
        return []
    return list(dict.fromkeys(code for code in map(_code_of, _words(text)) if code is not None))


def skipped_words(text: str) -> int:
    """How many words of a typed or pasted text are not sent as gift codes, every one of a pasted login's included:
    never sent and never kept."""
    if holds_cookies(text):
        return len(_words(text))
    return sum(1 for word in _words(text) if _code_of(word) is None)


def nothing_sent(text: str) -> str:
    """What the player is told when nothing they typed or pasted is a gift code. It repeats none of their words."""
    if holds_cookies(text):
        return PASTED_LOGIN
    skipped = skipped_words(text)
    if skipped == 0:
        return NO_CODE
    if skipped == 1:
        return f"Nothing was sent: this is not a gift code. {SHAPE_SENTENCE}"
    return f"Nothing was sent: none of these {skipped:,} words is a gift code. {SHAPE_SENTENCE}"


def skipped_sentence(skipped: int) -> str:
    """What a run's progress says of the words left out beside the codes. It repeats none of them."""
    if skipped == 1:
        return "1 word was skipped: it is not a gift code."
    return f"{skipped:,} words were skipped: they are not gift codes."


class CodeBook:
    """The codes' history per account, and the livestream codes already told about."""

    def __init__(self, store: Store) -> None:
        self._store = store

    def history(self, uid: str) -> list[dict[str, Any]]:
        return [
            {"code": code, "result": result, "text": RESULT_TEXT.get(result, result), "primogems": primogems,
             "source": source, "at": at}
            for code, result, primogems, source, at in self._store.gift_code_rows(uid)
        ]

    def totals(self, uid: str) -> dict[str, int]:
        """What redeemed codes gave this account: only a code that was redeemed counts, not one already redeemed
        before Guild Board knew, whose worth nobody can tell."""
        redeemed = [row for row in self.history(uid) if row["result"] == "redeemed"]
        return {"primogems": sum(row["primogems"] for row in redeemed), "redeemed": len(redeemed)}

    def blocked(self, uid: str, code: str) -> dict[str, Any] | None:
        """The row of a code that is settled on this account, else None."""
        for row in self.history(uid):
            if row["code"] == code and row["result"] in SETTLED:
                return row
        return None

    def record(self, uid: str, code: str, result: str, primogems: int, source: str, at: datetime) -> None:
        self._store.put_gift_code(uid, code, result, primogems, source, at)

    def set_primogems(self, uid: str, code: str, primogems: int) -> bool:
        return self._store.set_gift_code_primogems(uid, code, primogems)

    def remove(self, uid: str, code: str) -> bool:
        """Forget a code of this account's history, so that it leaves the totals and, if it was settled, may be sent
        again. False when the account has no such code."""
        return self._store.delete_gift_code(uid, code)

    def new_live(self, uid: str, live: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The livestream codes that are not settled on this account."""
        return [item for item in live if self.blocked(uid, item["code"]) is None]

    def unnoticed(self, live: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The livestream codes the player was not yet told about."""
        told = self._store.gift_code_noticed()
        return [item for item in live if item["code"] not in told]

    def mark_noticed(self, codes: list[str], at: datetime) -> None:
        self._store.add_gift_code_notices(codes, at)
