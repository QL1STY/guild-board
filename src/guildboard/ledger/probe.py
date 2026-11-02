"""Shows what the game's history logs hold, for the check with the player (the ledger design, section 9).

Run by hand, with the player's go-ahead, after opening Feedback from the Paimon menu in the game:
`uv run python -m guildboard.ledger.probe`.
Guild Board never runs it. It reads the game's log and web cache as Import does, read-only, with gamecache's own
functions, then asks HoYoverse's history logs with the Feedback links' keys alone, through netpolicy, following no
redirect: a wish link's key goes only to the wish history, which the probe never asks, and no other page's key is sent
anywhere. It prints, for each kind, whether the key was accepted, how many entries there are and from when to when,
every reason with its count and sum, how top-ups are booked, and a few artifact entries; and how many wish links there
are, and the other links in the cache that hold a key, by their address alone. It never prints a key or a link's query.

With `--login` it reads no file of the game's: it asks HoYoverse for a key to the history logs for Guild Board's HoYoLAB
login, as Guild Board's own refresh does (sources/hoyolab.py's mint_key, through netpolicy's one mint request: the four
cookies the mint takes, to its one address), and reads the logs with that key. No cookie goes anywhere else.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from collections import Counter, defaultdict
from typing import Any
from urllib.parse import parse_qsl, quote, quote_plus, urlencode, urlsplit

from guildboard import netpolicy
from guildboard.ledger import KINDS, LEDGER_URL, endpoint
from guildboard.pulls import gamecache

PAUSE_SECONDS = 0.5
PAGE_SIZE = 20
MOST_PAGES = 500  # 10,000 entries a kind, far more than the game keeps
TIMEOUT_SECONDS = 10.0
TIMEOUTS_BEFORE_GIVING_UP = 2  # a server that does not answer twice will not answer a third link either
NO_FEEDBACK_LINK = (
    "No Feedback link holds a key. Open Feedback from the Paimon menu in the game, then run the probe again."
)


def _url(query: dict[str, str], kind: str, end_id: str, name: str | None = None) -> str:
    asked = dict(query)
    if gamecache.KEY in query:
        # The key's version is named through gamecache, as test_handsoff looks for the registry's root names in
        # every file.
        asked.update({gamecache.KEY_VERSION: "1"}, sign_type="2")
    asked.update(lang="en", size=str(PAGE_SIZE), end_id=end_id)
    return f"{LEDGER_URL}{name or endpoint(kind)}?{urlencode(asked)}"


def _masked(text: object, query: dict[str, str]) -> str:
    """HoYoverse's message, short, with the key taken out in every form it may be written in."""
    shown = str(text)[:120]
    secret = query.get(gamecache.KEY, "")
    if secret:
        for form in (secret, quote(secret, safe=""), quote_plus(secret)):
            shown = shown.replace(form, "[secret]")
    return shown


def _ask(
    query: dict[str, str], kind: str, end_id: str, name: str | None = None
) -> tuple[list[dict[str, Any]] | None, str]:
    """One page, or None with why not. HoYoverse's message is shown short, with the key taken out of it."""
    try:
        body = netpolicy.fetch_hoyoverse(_url(query, kind, end_id, name), timeout=TIMEOUT_SECONDS, follow_redirects=False)
    except Exception as error:
        return None, f"could not be read ({type(error).__name__})"
    try:
        answer = json.loads(body)
    except ValueError:
        return None, "the answer is not JSON"
    if not isinstance(answer, dict):
        return None, "the answer is not JSON"
    if answer.get("retcode") != 0:
        return None, f"refused, retcode {answer.get('retcode')}, \"{_masked(answer.get('message', ''), query)}\""
    data = answer.get("data")
    if name is not None:  # not a log: its answer's fields, by name alone
        return [], "accepted, fields: " + (", ".join(sorted(data)) if isinstance(data, dict) else type(data).__name__)
    rows = data.get("list") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return None, "the answer has no list"
    return [row for row in rows if isinstance(row, dict)], "accepted"


def _whole_kind(query: dict[str, str], kind: str, first: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows, page = list(first), first
    for _ in range(MOST_PAGES):
        if len(page) < PAGE_SIZE:
            break
        time.sleep(PAUSE_SECONDS)
        next_page, why = _ask(query, kind, str(page[-1].get("id", "0")))
        if next_page is None:
            print(f"  stopped early: {why}")
            break
        rows.extend(next_page)
        page = next_page
    return rows


def _amount(row: dict[str, Any]) -> int:
    try:
        return int(str(row.get("add_num", "0")))
    except ValueError:
        return 0


def _report(kind: str, rows: list[dict[str, Any]]) -> None:
    times = sorted(str(row.get("datetime", "")) for row in rows)
    span = f", from {times[0]} to {times[-1]}" if times else ""
    print(f"{kind}: {len(rows)} entries{span}")
    counts: Counter[str] = Counter()
    sums: defaultdict[str, int] = defaultdict(int)
    for row in rows:
        reason = str(row.get("reason", ""))
        counts[reason] += 1
        sums[reason] += _amount(row)
    print("  reasons:")
    for reason, count in counts.most_common():
        print(f"    {reason}: {count} entries, sum {sums[reason]}")
    if kind == "crystal":
        amounts: defaultdict[int, Counter[str]] = defaultdict(Counter)
        for row in rows:
            if _amount(row) > 0:
                amounts[_amount(row)][str(row.get("reason", ""))] += 1
        print("  positive amounts:")
        for amount in sorted(amounts):
            reasons = ", ".join(f"{reason} ×{count}" for reason, count in amounts[amount].most_common())
            print(f"    {amount}: {sum(amounts[amount].values())} entries ({reasons})")
    if kind == "artifact":
        named = any("domain" in str(row.get("reason", "")).casefold() for row in rows)
        print(f"  a reason names a domain: {'yes' if named else 'no'}")
        print("  samples:")
        for row in rows[:5]:
            print(f"    {row.get('name', '')} / {row.get('quality', '')} / {row.get('reason', '')}")
    if rows:
        print(f"  fields: {', '.join(sorted(rows[0]))}")


def _csc_links(log_text: str, data: bytes) -> list[tuple[str, dict[str, str]]]:
    """The self-service links that hold a key (gamecache.ledger_links, as Import finds them): address and parameters."""
    found = []
    for link in gamecache.ledger_links(log_text, data):
        parts = urlsplit(link.url)
        found.append((f"{parts.scheme}://{parts.netloc}{parts.path}", dict(link.query)))
    return found


def _other_links(data: bytes) -> None:
    """Print the links in the cache other than the wish history's and Feedback's whose query holds a key, counted by
    their address alone. They are never tried: no other page's key goes to the history logs."""
    found: Counter[str] = Counter()
    for run in gamecache.LINK_RUN.finditer(data):
        url = run.group(0).decode("ascii")
        try:
            parts = urlsplit(url)
        except ValueError:  # no address a page could be told by
            continue
        query = dict(parse_qsl(parts.query))
        if gamecache.KEY not in query or "webview_gacha" in url or query.get("auth_appid") == "csc":
            continue
        found[f"{parts.scheme}://{parts.netloc}{parts.path}"] += 1
    print(f"Other links holding a key: {sum(found.values())}")
    for address, count in found.most_common():
        print(f"  {address} x{count}")


def _with_login() -> list[tuple[str, dict[str, str]]] | None:
    """--login: a key to the game's history logs that HoYoverse gives the HoYoLAB login Guild Board keeps, asked for as
    Guild Board asks for it, and the account's own page read with it. The login's cookies are named, never their
    values. Reads no file of the game's."""
    from guildboard.config import AppPaths, default_data_dir
    from guildboard.records import LoginNeeded
    from guildboard.sources.hoyolab import HoyolabSource
    from guildboard.tokenstore import TokenStore

    tokens = TokenStore(AppPaths(default_data_dir()).token_path)
    token = tokens.load()
    if token is None:
        print("No HoYoLAB login is kept: log in in Guild Board first.")
        return None
    print(f"Login kept: cookies {', '.join(sorted(token.cookies))}; server {token.server}")
    source = HoyolabSource(tokens)
    if not source.can_mint():
        print("The kept login has no cookie token, so HoYoverse gives it no key: log in again in Guild Board.")
        return None
    try:
        minted = asyncio.run(source.mint_key("csc"))
    except LoginNeeded:
        print("HoYoverse refused the kept login: log in again in Guild Board.")
        return None
    if minted is None:
        print("HoYoverse did not give the kept login a key to the game's history logs.")
        return None
    print("HoYoverse gave the kept login a key to the game's history logs.", flush=True)
    query = dict(minted.link.query)
    _, why = _ask(query, KINDS[0], "0", name="GetUserInfo")
    print(f"GetUserInfo: {why}", flush=True)
    return [("the login's key, whole query", query)]


def main() -> int:
    """Print what each kind holds. 0 when at least one kind was accepted, else 1."""
    if "--login" in sys.argv[1:]:
        print("Guild Board's ledger probe, --login: it asks HoYoverse for a key to the game's history logs for Guild "
              "Board's HoYoLAB login, as Guild Board does, reads the logs with it, reads no file of the game's, and "
              "never prints a key or a cookie's value.")
        login_tries = _with_login()
        return 1 if login_tries is None else _run(login_tries)
    print("Guild Board's ledger probe: it reads the game's log and web cache, read-only, asks HoYoverse's history logs "
          "with the Feedback links' keys alone, and never prints a key.")
    try:
        log_text = gamecache.read_log(gamecache.log_path())
        folder = gamecache.data_folder(log_text)
        cache = gamecache.cache_file(folder) if folder is not None else None
        data = gamecache.read_cache(cache) if cache is not None else b""
    except gamecache.CacheProblem as problem:
        print(f"The game's files could not be read: {problem}")
        return 1
    # The self-service page's link (auth_appid=csc), which the game hands the browser: is it in the log, or the cache?
    in_log = _csc_links(log_text, b"")
    in_cache = _csc_links("", data)
    print(f"Self-service links with a key: {len(in_log)} in the game's log, {len(in_cache)} in its web cache")
    for address, _ in in_log + in_cache:
        print(f"  {address}")
    # The wish links and the other links that hold a key are counted and named, never tried: a wish link's key goes only
    # to the wish history, and the history logs take a Feedback link's key alone.
    print(f"Wish links found: {len(gamecache.links(data))}")
    _other_links(data)
    tries: list[tuple[str, dict[str, str]]] = [
        (f"self-service link from the {where}, whole query", query)
        for where, found in (("log", in_log), ("cache", in_cache)) for _, query in found
    ]
    if not tries:
        print(NO_FEEDBACK_LINK)
        return 1
    return _run(tries)


def _run(tries: list[tuple[str, dict[str, str]]]) -> int:
    """Try each in turn on the primogem log until one is accepted, then read every kind with it."""
    if not tries:
        return 1

    chosen: dict[str, str] | None = None
    first: list[dict[str, Any]] = []
    why = "no link was tried"
    timeouts = 0
    for index, (label, query) in enumerate(tries):
        if index:
            time.sleep(PAUSE_SECONDS)
        page, why = _ask(query, KINDS[0], "0")
        print(f"Try {index + 1} of {len(tries)} ({label}): {why}", flush=True)
        if page is not None:
            chosen, first = query, page
            break
        timeouts = timeouts + 1 if "Timeout" in why else 0
        if timeouts >= TIMEOUTS_BEFORE_GIVING_UP:
            print("The history server does not answer; nothing else is tried.")
            break
    if chosen is None:
        print(f"{KINDS[0]}: {why}")
        return 1

    accepted = 0
    for kind in KINDS:
        if kind != KINDS[0]:
            time.sleep(PAUSE_SECONDS)
            page, why = _ask(chosen, kind, "0")
            if page is None:
                print(f"{kind}: {why}")
                continue
            first = page
        print(f"{kind}: accepted")
        accepted += 1
        _report(kind, _whole_kind(chosen, kind, first))
    return 0 if accepted else 1


if __name__ == "__main__":
    raise SystemExit(main())
