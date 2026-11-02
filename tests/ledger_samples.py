"""Key-free stand-ins for the game's own history logs (the ledger design, section 0): the self-service link the game
writes into its log when the player opens Feedback, and the history service answering it, 20 entries a page below
end_id, newest first. Every key here is made up."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlencode, urlsplit

from guildboard.ledger import LEDGER_URL
from guildboard.pulls.gamecache import KEY, KEY_VERSION, WishLink

CSC_PAGE = "https://gs.hoyoverse.com/event/user-game-search/genshin/index.html"
UID = "700000001"


def csc_query(key: str) -> dict[str, str]:
    return {"auth_appid": "csc", "game_biz": "hk4e_global", KEY: key, KEY_VERSION: "1", "sign_type": "2"}


def csc_url(key: str) -> str:
    return f"{CSC_PAGE}?{urlencode(csc_query(key))}#/moneyRecord"


def csc_link(key: str = "CSC-KEY-0123456789-ABCDEFGH") -> WishLink:
    return WishLink(csc_url(key), csc_query(key), Path())


def entry(entry_id: int, time: str = "2026-10-27 04:01:00", amount: int = 60,
          reason: str = "Daily Commission reward", uid: str = UID, **more: Any) -> dict[str, Any]:
    """One entry, as the history service gives it: every field a string."""
    return {"id": str(entry_id), "uid": uid, "datetime": time, "add_num": str(amount), "reason": reason,
            **{name: str(value) for name, value in more.items()}}


def answer(rows: Iterable[dict[str, Any]]) -> bytes:
    return json.dumps({"retcode": 0, "message": "OK", "data": {"list": list(rows)}}).encode()


def refusal(retcode: int, message: str) -> bytes:
    return json.dumps({"retcode": retcode, "message": message, "data": None}).encode()


class Ledgers:
    """The history service, standing in behind ledger.api: each kind's entries, 20 a page below end_id, newest first,
    to the keys it knows; any other key is refused as expired. GetUserInfo answers the account. Every request is
    remembered by its log's name and parameters; `refuse` may answer a request in place of a page."""

    def __init__(self, entries: dict[str, list[dict[str, Any]]] | None = None, keys: Iterable[str] = ()) -> None:
        self.entries: dict[str, list[dict[str, Any]]] = {}
        for name, listed in (entries or {}).items():
            self.add(name, listed)
        self.keys = set(keys)
        self.asked: list[tuple[str, dict[str, str]]] = []
        self.refuse: Any = None

    def add(self, name: str, listed: Iterable[dict[str, Any]]) -> None:
        self.entries[name] = sorted([*self.entries.get(name, []), *listed], key=lambda e: int(e["id"]), reverse=True)

    def handles(self, url: str) -> bool:
        return url.startswith(LEDGER_URL)

    def __call__(self, url: str) -> bytes:
        parts = urlsplit(url)
        name = parts.path.rsplit("/", 1)[-1]
        query = {key: values[0] for key, values in parse_qs(parts.query).items()}
        self.asked.append((name, query))
        if query.get(KEY) not in self.keys:
            return refusal(-1, "authkey timeout")
        if self.refuse is not None and (refused := self.refuse(name, query)) is not None:
            return refused
        if name == "GetUserInfo":
            return json.dumps({"retcode": 0, "data": {"uid": UID, "region": "os_euro", "nickname": "T"}}).encode()
        end_id = int(query["end_id"])
        older = [e for e in self.entries.get(name, []) if end_id == 0 or int(e["id"]) < end_id]
        return answer(older[:20])
