import json
import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from achievement_samples import paimon_export
from guildboard.achievements.catalog import bundled_raw
from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from support import FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"


@pytest.fixture
def core(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


def test_the_achievements_page_model(client):
    body = client.get("/api/achievements").json()
    assert {"query", "totals", "categories", "groups", "list", "hoyolab", "pinned", "unlisted"} <= set(body)
    # The demo has Zoo Tycoon done, so only the All view shows it.
    assert client.get("/api/achievements", params={"q": "zoo tycoon"}).json()["groups"] == []
    assert client.get("/api/achievements", params={"q": "zoo tycoon", "view": "all"}).json()["groups"][0]["id"] == 80127
    assert len(client.get("/api/achievements", params={"pinned": 1}).json()["groups"]) == 3
    refused = client.get("/api/achievements", params={"view": "most"})
    assert refused.status_code == 422 and refused.json() == {"error": "Unknown view. Use left, done or all."}


def test_ticking_and_undoing_through_the_api(client):
    assert client.post("/api/achievements/stage/81732", json={"status": "done"}).json() == {"change": "Ticked Winter Night's Letter"}
    assert client.post("/api/achievements/undo").json() == {"undone": "Ticked Winter Night's Letter", "more": False}
    for _ in range(25):
        client.post("/api/achievements/undo")
    nothing = client.post("/api/achievements/undo")
    assert nothing.status_code == 409 and nothing.json() == {"error": "There is nothing to undo."}


@pytest.mark.parametrize("body", [{}, {"status": "done", "pinned": True}, {"part": {"index": True, "done": True}}, {"pinned": "yes"}])
def test_a_change_names_exactly_one_thing(client, body):
    response = client.post("/api/achievements/stage/84508", json=body)
    assert response.status_code == 422
    assert response.json() == {"error": "Change one thing at a time: status, pinned, note or part."}


def test_the_page_model_names_the_change_an_undo_would_put_back(client):
    def undo() -> str | None:
        return client.get("/api/achievements").json()["undo"]

    assert undo() is None  # the demo's made-up progress cannot be undone
    client.post("/api/achievements/stage/81732", json={"status": "done"})
    assert undo() == "Ticked Winter Night's Letter"
    assert undo() == "Ticked Winter Night's Letter"  # reading it takes nothing out of the history
    text = paimon_export({"": {"0": {"84512": True}}}).decode("utf-8")  # For the Love of Godwin, not done in the demo
    preview = client.post("/api/import/preview", json={"text": text}).json()
    assert preview["done"] == 1
    assert client.post("/api/import/apply", json={"text": text, "fingerprint": preview["fingerprint"]}).status_code == 200
    assert undo() is None  # an import that changed something ends the undo history
    assert client.post("/api/achievements/undo").status_code == 409


def test_unknown_achievements_and_bad_values_are_refused(client):
    unknown = client.post("/api/achievements/stage/12345", json={"pinned": True})
    assert unknown.status_code == 404 and unknown.json() == {"error": "There is no achievement with this number."}
    assert client.post("/api/achievements/counter/82055", json={"value": "5"}).status_code == 422
    assert client.post("/api/achievements/counter/82055", json={"value": 41}).json() == {
        "change": "Set the count of ...Well, That Was Strange to 41"
    }


def test_an_achievement_is_unpinned_in_one_change(core, client):
    events = core.bus.subscribe()
    # The demo pins the third stage of ...Well, That Was Strange.
    assert client.post("/api/achievements/group/82055/unpin").json() == {"change": "Unpinned ...Well, That Was Strange"}
    assert [events.get_nowait()["type"] for _ in range(events.qsize())] == ["achievements_changed"]
    unknown = client.post("/api/achievements/group/99999999/unpin")
    assert unknown.status_code == 404 and unknown.json() == {"error": "There is no achievement with this number."}
    nothing = client.post("/api/achievements/group/82055/unpin")
    assert nothing.status_code == 422 and nothing.json() == {"error": "Nothing of this achievement is pinned."}
    assert events.empty()
    assert client.post("/api/achievements/undo").json() == {"undone": "Unpinned ...Well, That Was Strange", "more": False}


def test_checking_installing_and_undoing_the_list_in_the_demo(client):
    assert client.get("/api/achievements/list").json()["stages"] == 1854
    preview = client.post("/api/achievements/list/check").json()
    assert [a["id"] for a in preview["added"]] == [99901, 99902, 99903]
    assert client.post("/api/achievements/list/install", json={"sha256": "nope"}).status_code == 409
    meta = client.post("/api/achievements/list/install", json={"sha256": preview["sha256"]}).json()
    assert meta["version"] == "7.2" and meta["stages"] == 1857
    assert client.post("/api/achievements/list/undo").json()["version"] == "7.1"
    assert client.post("/api/achievements/list/undo").status_code == 409


def test_an_uploaded_paimon_export_is_previewed_and_imported(client):
    text = paimon_export({"": {"0": {"81732": True}}}).decode("utf-8")
    preview = client.post("/api/import/preview", json={"text": text, "file": "export.json"}).json()
    assert preview["kind"] == "paimon" and preview["done"] == 1
    changed = client.post("/api/import/apply", json={"text": text, "file": "export.json", "fingerprint": "x"})
    assert changed.status_code == 409
    assert changed.json() == {"error": "The file changed since the preview. Look at the preview again."}
    done = client.post("/api/import/apply", json={"text": text, "file": "export.json", "fingerprint": preview["fingerprint"]})
    assert done.json()["done"] == 1
    refused = client.post("/api/import/preview", json={"text": "{", "file": "x.json"})
    assert refused.status_code == 422 and refused.json() == {"error": "The file is not valid JSON."}
    none = client.post("/api/import/preview", json={})
    assert none.status_code == 422 and none.json() == {"error": "Choose a file to import."}


def test_every_change_tells_the_pages(core, client):
    queue = core.bus.subscribe()
    client.post("/api/achievements/stage/84508", json={"pinned": False})
    kinds = [queue.get_nowait()["type"] for _ in range(queue.qsize())]
    assert "achievements_changed" in kinds


def _downloads(core, answer: bytes | Exception) -> None:
    """The core's list check downloads `answer`, or fails with it, instead of the demo's newer list."""

    async def fetch() -> bytes:
        if isinstance(answer, Exception):
            raise answer
        return answer

    core.lists._fetch = fetch


def _post_escaped(client, path: str, body: dict):
    """Post the body as JSON with every character outside ASCII escaped, as a browser can send half of an emoji. The
    test client's own JSON is UTF-8, which cannot encode one."""
    return client.post(path, content=json.dumps(body), headers={"Content-Type": "application/json"})


def test_the_page_model_follows_the_query(client):
    model = client.get("/api/achievements", params={
        "view": "done", "category": "2", "q": "zoo", "unlisted": "true", "keep": [82055, 81732],
    })
    assert model.json()["query"] == {
        "view": "done", "category": "2", "pinned": False, "search": "zoo", "unlisted": True, "keep": [81732, 82055],
    }


def test_a_group_kept_after_its_tick_is_in_the_left_answer(client):
    def shown(**params) -> dict[int, list[str]]:
        groups = client.get("/api/achievements", params=params).json()["groups"]
        return {g["id"]: [s["status"] for s in g["stages"]] for g in groups}

    assert shown()[81732] == ["not_started"]  # Winter Night's Letter, in Wonders of the World, which the demo opens on
    client.post("/api/achievements/stage/81732", json={"status": "done"})
    assert 81732 not in shown()
    assert shown(keep=81732)[81732] == ["done"]
    assert shown(keep=[81732, 82008])[81732] == ["done"]  # Juggernaut is there anyway


def test_a_note_and_a_part_are_changed_too(client):
    stage = "/api/achievements/stage/84508"  # Pirates! Argh!, in progress in the demo with two of its three parts done
    assert client.post(stage, json={"note": "Behind the tree."}).json() == {
        "change": "Changed the note on Pirates! Argh!"
    }
    assert client.post(stage, json={"part": {"index": 2, "done": True}}).json() == {
        "change": "Ticked a part of Pirates! Argh!"
    }
    [pirates] = client.get("/api/achievements", params={"q": "Pirates! Argh!"}).json()["groups"][0]["stages"]
    assert pirates["note"] == "Behind the tree." and all(part["done_at"] for part in pirates["parts"])


@pytest.mark.parametrize("body", [
    {"note": 5}, {"status": None}, {"color": "red"}, {"part": [2, True]}, {"part": {"index": 2}},
    {"part": {"index": 2.0, "done": True}}, {"part": {"index": 2, "done": 1}},
    {"part": {"index": 2, "done": True, "at": 0}},
])
def test_any_other_body_is_refused_too(client, body):
    response = client.post("/api/achievements/stage/84508", json=body)
    assert response.status_code == 422
    assert response.json() == {"error": "Change one thing at a time: status, pinned, note or part."}


@pytest.mark.parametrize("path, body, status, message", [
    ("counter/12345", {"value": 1}, 404, "There is no achievement with this number."),
    ("stage/84508", {"status": "finished"}, 422, "A status is not_started, in_progress or done."),
    ("stage/84508", {"note": "x" * 2001}, 422, "A note can be at most 2,000 characters long."),
    ("stage/84508", {"part": {"index": 3, "done": True}}, 422, "This achievement has no part with this number."),
    ("counter/84508", {"value": 1}, 422, "This achievement counts nothing."),
    ("counter/82055", {"value": 10_000_001}, 422, "A count is a whole number from 0 to 10,000,000."),
    ("counter/82055", {"value": True}, 422, "A count is a whole number from 0 to 10,000,000."),
    ("counter/82055", {"value": 41.0}, 422, "A count is a whole number from 0 to 10,000,000."),
    ("counter/82055", {}, 422, "A count is a whole number from 0 to 10,000,000."),
], ids=[
    "unknown counter", "unknown status", "long note", "unknown part", "counts nothing", "count too high", "count true",
    "count with a point", "no count",
])
def test_a_change_that_cannot_be_made_says_why_and_tells_the_pages_nothing(core, client, path, body, status, message):
    events = core.bus.subscribe()
    response = client.post(f"/api/achievements/{path}", json=body)
    assert (response.status_code, response.json()) == (status, {"error": message})
    assert events.empty()


@pytest.mark.parametrize("path, body", [
    ("achievements/list/install", {}),
    ("achievements/list/install", {"sha256": 5}),
    ("import/preview", {"text": 5}),
    ("import/preview", {"text": "{}", "file": ["state.json"]}),
    ("import/preview", {"text": "{}", "profile": {"name": ""}}),
    ("import/apply", {"text": "{}"}),
    ("import/apply", {"text": "{}", "fingerprint": 5}),
])
def test_a_request_of_the_wrong_shape_is_refused(client, path, body):
    response = client.post(f"/api/{path}", json=body)
    assert response.status_code == 422
    assert response.json() == {"error": "This request does not have the expected shape."}


# FastAPI refuses a body that is not a JSON object before the endpoint runs. Its own answer repeats the body, which
# fails on half of an emoji and on bytes that are not UTF-8.
@pytest.mark.parametrize("path, message", [
    ("achievements/stage/84508", "Change one thing at a time: status, pinned, note or part."),
    ("achievements/counter/82055", "A count is a whole number from 0 to 10,000,000."),
    ("achievements/list/install", "This request does not have the expected shape."),
    ("import/preview", "This request does not have the expected shape."),
    ("import/apply", "This request does not have the expected shape."),
], ids=["stage", "counter", "install", "preview", "apply"])
@pytest.mark.parametrize("content, content_type", [
    (b'["\\ud83d"]', "application/json"), (b"[]", "application/json"), (b"\xff", "text/plain"),
], ids=["half of an emoji in a list", "a list", "not UTF-8"])
def test_a_body_that_is_not_an_object_gets_a_sentence(core, client, path, message, content, content_type):
    events = core.bus.subscribe()
    response = client.post(f"/api/{path}", content=content, headers={"Content-Type": content_type})
    assert (response.status_code, response.json()) == (422, {"error": message})
    assert events.empty()


@pytest.mark.parametrize("content, content_type", [
    (b'"\\ud83d"', "application/json"),
    (b'["\xed\xa0\xbd"]', "application/json"),  # half of an emoji as bytes, which Python's JSON reads too
    (b"5", "application/json"),
    (b"null", "application/json"),
    (b"", "application/json"),
    (b"{", "application/json"),
    (b"\xff", "application/json"),  # not text at all: FastAPI refuses it with a 400 of its own
    (b'{"pinned": true}', "text/plain"),
], ids=[
    "half of an emoji", "half of an emoji as bytes", "a number", "null", "nothing", "not JSON", "not UTF-8",
    "an object sent as text",
])
def test_a_body_that_is_not_a_json_object_is_refused_like_any_other(core, client, content, content_type):
    events = core.bus.subscribe()
    response = client.post("/api/achievements/stage/84508", content=content, headers={"Content-Type": content_type})
    assert response.status_code == 422
    assert response.json() == {"error": "Change one thing at a time: status, pinned, note or part."}
    assert events.empty()


@pytest.mark.parametrize("method, path, content", [
    ("POST", "/api/achievements/stage/abc", b'{"pinned": true}'),
    ("POST", "/api/achievements/stage/abc", b"[]"),
    ("POST", "/api/achievements/counter/1.5", b'{"value": 1}'),
    ("POST", "/api/achievements/group/abc/unpin", None),
    ("GET", "/api/achievements?pinned=maybe", None),
    ("GET", "/api/achievements?unlisted=", None),
    ("GET", "/api/achievements?keep=abc", None),
    ("GET", "/api/achievements?keep=81732&keep=", None),
    ("GET", "/api/achievements?keep=81732.0", None),
    ("GET", "/api/achievements?keep=-81732", None),
    ("GET", "/api/achievements?keep=%2B81732", None),
    ("GET", "/api/achievements?keep=" + "9" * 5000, None),
], ids=[
    "a stage that is not a number", "and a body that is not an object", "a counter with a point",
    "an achievement to unpin that is not a number", "pinned maybe",
    "unlisted empty", "keep a word", "keep empty", "keep with a point", "keep below zero", "keep with a plus",
    "keep too long for an id",
])
def test_a_wrong_value_in_the_address_is_refused_without_repeating_it(core, client, method, path, content):
    events = core.bus.subscribe()
    response = client.request(method, path, content=content, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json() == {"error": "This request does not have the expected shape."}
    assert events.empty()


def test_a_check_that_fails_says_why(core, client):
    _downloads(core, OSError("the tests contact nothing"))
    response = client.post("/api/achievements/list/check")
    assert response.status_code == 503
    assert response.json() == {
        "error": "The achievement list could not be downloaded. Check the connection and try again."
    }


def test_each_change_tells_the_pages_once(core, client):
    events = core.bus.subscribe()

    def told() -> list[str]:
        return [events.get_nowait()["type"] for _ in range(events.qsize())]

    client.post("/api/achievements/counter/82055", json={"value": 41})
    assert told() == ["achievements_changed"]
    client.post("/api/achievements/undo")
    assert told() == ["achievements_changed", "timers_changed"]  # the change undone could have been a timer's
    assert client.post("/api/achievements/undo").status_code == 409
    sha256 = client.post("/api/achievements/list/check").json()["sha256"]
    assert told() == []  # neither an undo with nothing to undo nor a check changes anything
    client.post("/api/achievements/list/install", json={"sha256": sha256})
    assert told() == ["achievements_changed"]
    client.post("/api/achievements/list/undo")
    assert told() == ["achievements_changed"]
    text = paimon_export({"": {"0": {"81732": True}}}).decode("utf-8")
    fingerprint = client.post("/api/import/preview", json={"text": text}).json()["fingerprint"]
    assert told() == []
    client.post("/api/import/apply", json={"text": text, "fingerprint": fingerprint})
    assert told() == ["achievements_changed"]  # the core's own: the API does not tell the pages a second time


def test_half_of_an_emoji_in_a_downloaded_list_cannot_break_an_answer(core, client):
    # \ud83d is JSON's escape for half of an emoji. Python reads it as a lone surrogate, which UTF-8 cannot encode.
    _downloads(core, bundled_raw().replace(b'"Winter Night\'s Letter"', b'"Winter Night\'s Letter \\ud83d"'))
    check = client.post("/api/achievements/list/check")
    assert check.status_code == 200
    assert check.json()["changed"] == [{"id": 81732, "name": "Winter Night's Letter \ufffd", "what": ["name"]}]
    client.post("/api/achievements/list/install", json={"sha256": check.json()["sha256"]})
    ticked = client.post("/api/achievements/stage/81732", json={"status": "done"})
    assert ticked.status_code == 200 and ticked.json() == {"change": "Ticked Winter Night's Letter \ufffd"}


def _without(*first_ids: int) -> bytes:
    """The bundled list without the achievements whose first stage has one of these ids."""
    data = json.loads(bundled_raw())
    for category in data.values():
        category["achievements"] = [
            entry for entry in category["achievements"]
            if (entry[0] if isinstance(entry, list) else entry)["id"] not in first_ids
        ]
    return json.dumps(data).encode("utf-8")


def test_parts_and_counts_on_stages_a_new_list_drops_show_under_not_in_the_current_list(core, client):
    # The demo leaves In the Name of Favonius (84520) and Magnum Opus (81620 to 81622) without a row.
    assert client.post("/api/achievements/stage/84520", json={"part": {"index": 0, "done": True}}).status_code == 200
    assert client.post("/api/achievements/counter/81620", json={"value": 5}).status_code == 200
    assert 84520 not in core.store.progress() and 81620 not in core.store.progress()  # a part and a count, no row
    assert client.get("/api/achievements").json()["unlisted"] == 0
    _downloads(core, _without(84520, 81620))
    check = client.post("/api/achievements/list/check").json()
    assert client.post("/api/achievements/list/install", json={"sha256": check["sha256"]}).status_code == 200
    assert client.get("/api/achievements").json()["unlisted"] == 2
    assert client.get("/api/achievements", params={"unlisted": "true"}).json()["unlisted_rows"] == [
        {"id": 81620, "status": "not_started", "note": "", "pinned": False, "parts": 0, "count": 5},
        {"id": 84520, "status": "not_started", "note": "", "pinned": False, "parts": 1, "count": None},
    ]


def test_an_imported_part_of_an_achievement_the_list_does_not_hold_shows_under_not_in_the_current_list(client):
    text = paimon_export({"": {}}, {"": {"99999": {"0": True}}}).decode("utf-8")  # its only news: part 0 of 99999
    body = {"text": text, "file": "paimon-moe-local-data.json"}
    preview = client.post("/api/import/preview", json=body).json()
    assert (preview["parts"], preview["unknown"], preview["nothing_new"]) == (1, [99999], False)
    assert client.post("/api/import/apply", json={**body, "fingerprint": preview["fingerprint"]}).status_code == 200
    model = client.get("/api/achievements", params={"unlisted": "true"}).json()
    assert model["unlisted"] == 1
    assert model["unlisted_rows"] == [
        {"id": 99999, "status": "not_started", "note": "", "pinned": False, "parts": 1, "count": None},
    ]


@pytest.mark.parametrize("failure", [
    OSError(28, "No space left on device"), sqlite3.OperationalError("disk I/O error"),
], ids=["the disk is full", "a database error"])
def test_an_import_whose_backup_fails_says_so_and_imports_nothing(core, client, monkeypatch, caplog, failure):
    def fail(label, now):
        raise failure

    assert client.post("/api/achievements/stage/81732", json={"pinned": True}).status_code == 200
    text = paimon_export({"": {"0": {"81732": True}}}).decode("utf-8")
    fingerprint = client.post("/api/import/preview", json={"text": text}).json()["fingerprint"]
    before = (core.store.progress(), core.store.parts(), core.store.imports())
    monkeypatch.setattr(core.store, "backup_before", fail)
    events = core.bus.subscribe()
    applied = client.post("/api/import/apply", json={"text": text, "fingerprint": fingerprint})
    assert (applied.status_code, applied.json()) == (503, {
        "error": "Guild Board could not back up its database before the import, so nothing was imported. See the log file.",
    })
    assert (core.store.progress(), core.store.parts(), core.store.imports()) == before
    assert events.empty()
    assert "could not be backed up before an import" in caplog.text and str(failure) in caplog.text
    assert client.post("/api/achievements/undo").json() == {"undone": "Pinned Winter Night's Letter", "more": False}


@pytest.mark.parametrize("failure", [
    sqlite3.OperationalError("database is locked"), OSError(28, "No space left on device"),
], ids=["another program holds the database", "the disk is full"])
def test_an_import_that_cannot_be_saved_says_so_and_imports_nothing(core, client, monkeypatch, caplog, failure):
    # It fails at its last write, so the rows, the parts and the undo history it changed before have to be put back.
    def fail(*args):
        raise failure

    assert client.post("/api/achievements/stage/81732", json={"pinned": True}).status_code == 200
    text = paimon_export({"": {"0": {"81732": True}}}, {"": {"84508": {"0": True}}}).decode("utf-8")
    preview = client.post("/api/import/preview", json={"text": text}).json()
    before = (core.store.progress(), core.store.parts(), core.store.imports())
    monkeypatch.setattr(core.store, "add_import", fail)
    events = core.bus.subscribe()
    applied = client.post("/api/import/apply", json={"text": text, "fingerprint": preview["fingerprint"]})
    assert (applied.status_code, applied.json()) == (500, {
        "error": "Guild Board could not save the import, so nothing was imported. See the log file.",
    })
    assert (core.store.progress(), core.store.parts(), core.store.imports()) == before
    assert events.empty()
    assert "could not be saved" in caplog.text and str(failure) in caplog.text
    assert client.post("/api/achievements/undo").json() == {"undone": "Pinned Winter Night's Letter", "more": False}


def test_an_uploaded_file_with_half_an_emoji_in_a_profile_name_is_read(core, client):
    # The text holds a lone surrogate itself, not its escape: the core gets one when the page's JSON escapes one.
    text = paimon_export({"Lumine@": {"0": {"81732": True}}}).decode("utf-8").replace("@", "\ud83d")
    body = {"text": text, "file": "export\ud83d.json"}
    preview = _post_escaped(client, "/api/import/preview", body)
    assert preview.status_code == 200
    assert (preview.json()["profile"], preview.json()["file"]) == ("Lumine\ufffd", "export\ufffd.json")
    applied = _post_escaped(client, "/api/import/apply", {**body, "fingerprint": preview.json()["fingerprint"]})
    assert applied.status_code == 200 and core.store.progress()[81732].status == "done"
