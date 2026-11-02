"""Import reads the game's own history logs with the Feedback link, independently of the wishes (the ledger plan,
Task 4, as revised). Every link is made up, and HoYoverse is a stand-in."""
import functools
from datetime import datetime, timedelta, timezone

import pytest

from guildboard import logging_setup
from guildboard.events import EventBus
from guildboard.ledger import api as ledger_api
from guildboard.ledger.api import LEDGER_EXPIRED, NO_LEDGER_LINK
from guildboard.ledger.importer import LedgerOutcome, ledger_sentence
from guildboard.logging_setup import redact
from guildboard.pulls import gamecache, wishapi
from guildboard.pulls.gamecache import CacheProblem, HistoryLinks, MintedLink
from guildboard.pulls.importer import WishImporter
from ledger_samples import Ledgers, csc_link, csc_url, entry, refusal
from pulls_samples import KEY_EXPIRED, History, made_up_game, record, wish_link
from support import FakeClock, FakeSleep

NOW = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)
UID = 700000001
WISH_KEY = "MADE-UP-KEY-0123456789"
CSC = "CSC-KEY-0123456789-ABCDEFGH"
FIRST = 1760000000000000000


def entries(count: int, first: int, reason: str = "Daily Commission reward", amount: int = 60) -> list[dict]:
    start = datetime(2026, 9, 1, 12, 0)
    return [entry(first + n, f"{start + timedelta(minutes=n):%Y-%m-%d %H:%M:%S}", amount, reason)
            for n in range(1, count + 1)]


def full_ledgers() -> Ledgers:
    return Ledgers({
        "GetPrimogemLog": entries(25, 1000), "GetCrystalLog": entries(2, 2000, "Obtained via purchase", 1960),
        "GetResinLog": entries(3, 3000, "Revitalized Petrified Tree (Domain)", -20),
        "GetArtifactLog": [entry(4001, amount=1, reason="Revitalized Petrified Tree (Domain)", name="Flower",
                                 quality=5)],
    }, keys=[CSC])


def importer(store, history, ledgers, wish=None, ledger=None, bus=None, clock=None):
    clock = clock or FakeClock(NOW)
    wish = [wish_link(WISH_KEY)] if wish is None else wish
    ledger = [csc_link(CSC)] if ledger is None else ledger
    sleep = FakeSleep(clock)
    return WishImporter(
        store, clock, bus or EventBus(), lambda: HistoryLinks(list(wish), list(ledger)),
        functools.partial(wishapi.fetch_page, fetch=history), sleep, None, ready=lambda: True,
        ledger_fetch=functools.partial(ledger_api.fetch_page, fetch=ledgers),
        ledger_user=functools.partial(ledger_api.fetch_user, fetch=ledgers),
    ), sleep


def kinds_asked(ledgers) -> list[tuple[str, str]]:
    return [(name, query.get("end_id", "")) for name, query in ledgers.asked]


async def test_one_press_imports_wishes_then_the_four_ledgers(store):
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    ledgers = full_ledgers()
    run, _ = importer(store, history, ledgers)
    await run.run()
    assert run.state()["state"] == "done" and store.wish_count(UID) == 1
    assert kinds_asked(ledgers) == [
        ("GetUserInfo", ""), ("GetPrimogemLog", "0"), ("GetPrimogemLog", "1006"),
        ("GetCrystalLog", "0"), ("GetResinLog", "0"), ("GetArtifactLog", "0"),
    ]
    assert len(store.ledger_entries(UID, "primogem")) == 25 and len(store.ledger_entries(UID, "artifact")) == 1
    block = run.ledger_state()
    assert block["state"] == "done" and block["found"] == 31
    assert block["message"] == "Read 31 new entries of your game history."
    assert block["last_at"] is not None and block["auto"] is not None


async def test_a_press_tries_at_most_forty_feedback_links(store):
    # As the wish links: the forty last written are tried at most, each a request with an old key. The ledgers end as
    # failed when none of those answers, the rest untried, with the sentence of links that were all refused; the wishes
    # are their own.
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    ledgers = full_ledgers()
    old = [csc_link(f"OLD-CSC-KEY-{n}-0123456789") for n in range(60)]
    run, _ = importer(store, history, ledgers, ledger=[*old, csc_link(CSC)])  # the one that would answer is the 61st
    await run.run()
    assert [query[gamecache.KEY] for _, query in ledgers.asked] == [f"OLD-CSC-KEY-{n}-0123456789" for n in range(40)]
    block = run.ledger_state()
    assert (block["state"], block["message"]) == ("failed", LEDGER_EXPIRED)
    assert run.state()["state"] == "done"


async def test_a_second_import_keeps_nothing_twice_and_stops_at_the_first_stored_id(store):
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    ledgers = full_ledgers()
    run, _ = importer(store, history, ledgers)
    await run.run()
    ledgers.asked.clear()
    ledgers.add("GetPrimogemLog", entries(1, 1100))  # one new, then the 25 kept: one page ends it
    run, _ = importer(store, history, ledgers)
    await run.run()
    assert ("GetPrimogemLog", "1006") not in kinds_asked(ledgers)  # page 2 is never asked for
    assert len(store.ledger_entries(UID, "primogem")) == 26
    assert run.ledger_state()["message"] == "Read 1 new entry of your game history."
    ledgers.asked.clear()
    run, _ = importer(store, history, ledgers)
    await run.run()
    assert run.ledger_state()["message"] == "Nothing new in your game history."


async def test_a_ledger_refusal_does_not_drop_the_kept_link_or_fail_the_wishes(store):
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    ledgers = full_ledgers()
    ledgers.refuse = lambda name, query: refusal(-1, "authkey timeout") if name == "GetCrystalLog" else None
    run, _ = importer(store, history, ledgers)
    await run.run()
    state = {**run.state(), "ledger": run.ledger_state()}
    assert state["state"] == "done" and state["auto"] is not None  # the wishes, and their kept link
    assert state["ledger"]["state"] == "failed" and state["ledger"]["message"] == LEDGER_EXPIRED
    assert len(store.ledger_entries(UID, "primogem")) == 25  # the kind before the refusal is kept
    assert state["ledger"]["auto"] is None  # the refused link is not kept
    # and the reverse: wishes refused, ledgers read
    ledgers.refuse = None
    run, _ = importer(store, History({}, keys=[]), ledgers)
    await run.run()
    assert run.state()["state"] == "failed" and run.ledger_state()["state"] == "done"


async def test_a_kind_cut_short_keeps_none_of_its_pages(store):
    ledgers = full_ledgers()
    ledgers.refuse = lambda name, query: (
        b"<html>" if name == "GetPrimogemLog" and query["end_id"] != "0" else None
    )
    run, _ = importer(store, History({}, keys=[WISH_KEY]), ledgers)
    await run.run()
    assert store.ledger_entries(UID, "primogem") == []  # its first page was read, and none of it kept
    assert run.ledger_state()["state"] == "failed"
    assert run.ledger_state()["message"] == "The import failed unexpectedly. See the log file."
    assert store.last_ledger_import(UID) is None


async def test_the_kept_link_ticks_update_the_ledgers(store):
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    ledgers = full_ledgers()
    run, _ = importer(store, history, ledgers)
    await run.run()
    ledgers.asked.clear()
    ledgers.add("GetResinLog", entries(2, 3500, "Ley Line Blossom challenge reward", -20))
    assert await run.auto_update() is True
    assert [name for name, _ in ledgers.asked] == [  # no GetUserInfo again: the kept link knows its account
        "GetPrimogemLog", "GetCrystalLog", "GetResinLog", "GetArtifactLog",
    ]
    assert len(store.ledger_entries(UID, "resin")) == 5
    # With the wish link dropped, the ledger link still ticks; a refusal then drops it alone.
    run.drop_wish_link()
    ledgers.keys.clear()
    assert await run.auto_update() is True
    assert run.ledger_state()["auto"] is None
    assert await run.auto_update() is False


async def test_a_key_from_the_login_reads_the_four_logs_for_the_logins_account(store):
    # No GetUserInfo: the login names the account and its server. The first reading is the whole history, with its
    # progress shown kind by kind; the next ticks reuse the key and read what is new.
    asked: list[str] = []

    async def mint(auth_appid):
        asked.append(auth_appid)
        return MintedLink(csc_link(CSC), UID, "os_euro") if auth_appid == "csc" else None

    def no_game_files():
        raise AssertionError("an update with a key from the login read the game's files")

    ledgers = full_ledgers()
    run, _ = importer(store, History({}), ledgers)
    run._read_links = no_game_files
    assert await run.login_update(mint) is True
    assert asked == ["webview_gacha", "csc"]
    assert [name for name, _ in ledgers.asked] == [
        "GetPrimogemLog", "GetPrimogemLog", "GetCrystalLog", "GetResinLog", "GetArtifactLog",
    ]
    block = run.ledger_state()
    assert block["state"] == "done" and block["found"] == 31 and block["auto"] is None
    assert len(store.ledger_entries(UID, "primogem")) == 25
    ledgers.asked.clear()
    assert await run.login_update(mint) is True
    assert asked == ["webview_gacha", "csc", "webview_gacha"]  # the game history's key is reused
    assert run.ledger_state()["message"] == "Nothing new in your game history."
    # Refused: dropped, and asked for again at the next tick.
    ledgers.keys.clear()
    assert await run.login_update(mint) is True
    assert run._kept_ledger is None
    ledgers.keys.add(CSC)
    assert await run.login_update(mint) is True
    assert asked.count("csc") == 2


async def test_without_a_feedback_link_the_ledgers_say_how_to_get_one(store):
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    run, _ = importer(store, history, full_ledgers(), ledger=[])
    await run.run()
    assert run.state()["state"] == "done"
    assert run.ledger_state() == {
        "state": "failed", "kind": None, "found": 0, "message": NO_LEDGER_LINK, "last_at": None, "auto": None,
    }
    # every Feedback link refused: the link has expired
    run, _ = importer(store, history, full_ledgers(), ledger=[csc_link("OLD-CSC-0123456789")])
    await run.run()
    assert run.ledger_state()["message"] == LEDGER_EXPIRED


async def test_the_first_feedback_link_that_answers_is_used(store):
    ledgers = full_ledgers()
    run, sleep = importer(store, History({}, keys=[WISH_KEY]), ledgers,
                          ledger=[csc_link("OLD-CSC-0123456789"), csc_link(CSC)])
    await run.run()
    assert [query["authkey"] for name, query in ledgers.asked][:2] == ["OLD-CSC-0123456789", CSC]
    assert run.ledger_state()["state"] == "done"


async def test_a_feedback_key_is_a_secret_from_its_first_request_until_its_link_is_let_go(store):
    # As a wish key is: a refused Feedback key is forgotten once the run has ended, one never tried is never registered,
    # and the one kept is forgotten when it is dropped; one that answered but was refused part-way is not kept, nor
    # masked.
    old, untried = "OLD-CSC-0123456789", "UNTRIED-CSC-0123456789"
    logging_setup.forget_secrets()
    try:
        ledgers = full_ledgers()
        run, _ = importer(store, History({}, keys=[WISH_KEY]), ledgers,
                          ledger=[csc_link(old), csc_link(CSC), csc_link(untried)])
        await run.run()
        assert run.ledger_state()["state"] == "done"
        assert [redact(key) == key for key in (old, CSC, untried)] == [True, False, True]
        run.drop_ledger_link()
        assert redact(CSC) == CSC
        ledgers.refuse = lambda name, query: refusal(-1, "authkey timeout") if name == "GetCrystalLog" else None
        run, _ = importer(store, History({}, keys=[WISH_KEY]), ledgers)
        await run.run()
        assert run.ledger_state()["auto"] is None and redact(CSC) == CSC
    finally:
        logging_setup.forget_secrets()


def test_ledger_sentence():
    assert ledger_sentence(LedgerOutcome({"primogem": 340, "crystal": 0}, {}, False)) == (
        "Read 340 new entries of your game history."
    )
    assert ledger_sentence(LedgerOutcome({}, {"primogem": "HoYoverse could not be reached."}, False)) == (
        "HoYoverse could not be reached."
    )


# ---------------------------------------------------------------- the two reads find the Feedback link too

def test_read_history_links_finds_the_feedback_link_in_the_log_and_cache(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    log, cache = made_up_game(home, WISH_KEY)
    with log.open("a", encoding="utf-8") as file:
        file.write(f"OpenURL {csc_url('LOG-CSC-0123456789')}\nOpenURL {csc_url('LOG-CSC-0123456789')}\n")
    cache.write_bytes(cache.read_bytes() + b"\x00" + csc_url("CACHE-CSC-0123456789").encode() + b"\x00")
    found = gamecache.read_history_links()
    assert [link.query[gamecache.KEY] for link in found.wish] == [WISH_KEY]
    assert [link.query[gamecache.KEY] for link in found.ledger] == ["LOG-CSC-0123456789", "CACHE-CSC-0123456789"]
    # Found, not yet tried: a key is a secret of the log from its first request (the importer's), not from its reading.
    assert redact("LOG-CSC-0123456789") == "LOG-CSC-0123456789" and redact(WISH_KEY) == WISH_KEY
    assert "LOG-CSC" not in repr(found)


def test_either_kind_of_link_alone_is_enough(tmp_path, monkeypatch):
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    log, cache = made_up_game(home)  # a cache with no wish link
    with pytest.raises(CacheProblem):
        gamecache.read_history_links()
    with log.open("a", encoding="utf-8") as file:
        file.write(f"OpenURL {csc_url(CSC)}\n")
    found = gamecache.read_history_links()
    assert found.wish == [] and found.wish_problem == gamecache.NO_LINK and len(found.ledger) == 1
    cache.unlink()
    assert len(gamecache.read_history_links().ledger) == 1


async def test_a_refresh_that_finds_nothing_adds_no_record(store):
    history = History({"301": [record(FIRST + 1)]}, keys=[WISH_KEY])
    ledgers = full_ledgers()
    clock = FakeClock(NOW)
    run, _ = importer(store, history, ledgers, clock=clock)
    await run.run()

    def rows() -> list[tuple]:
        return store._conn.execute("SELECT kind, found, at FROM ledger_imports ORDER BY id").fetchall()

    assert len(rows()) == 4  # one for each kind, each with what it found
    for hour in (1, 2, 3):  # the hourly refresh with the login finds nothing
        clock.advance(hours=1)
        run, _ = importer(store, history, ledgers, clock=clock)
        await run.run()
    found_nothing = [row for row in rows() if row[1] == 0]
    assert len(rows()) == 8 and len(found_nothing) == 4  # one record of "nothing new" for each kind, not three
    assert all(row[2] >= "2026-10-27T12:00" for row in found_nothing)  # and it says when it last looked
    assert store.last_ledger_import() >= NOW + timedelta(hours=3)
    assert run.ledger_state()["message"] == "Nothing new in your game history."
    clock.advance(hours=1)
    ledgers.add("GetPrimogemLog", entries(1, 1100))
    run, _ = importer(store, history, ledgers, clock=clock)
    await run.run()
    assert len(rows()) == 9  # a refresh that finds something is a record of its own
