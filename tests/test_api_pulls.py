"""The Pulls routes (the Pulls plan, Tasks 4 and 7): the model and its forecast day, the history's pages, the settings and the
corrections, the balance, the wishlist, and the pulls_changed that every change publishes."""
from __future__ import annotations

import asyncio
import json
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import UNEXPECTED_REQUEST, create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.store import iso
from pulls_history import NOW, UID, keep_demo_like
from pulls_shape import problem_with
from support import AccountSource, FakeSleep

PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
NO_HISTORY = "No wish history yet. Open Wish → History in the game, then press Import."
NO_HISTORY_LOGIN = "No wish history yet. Guild Board is reading it now with your HoYoLAB login."
BAD_ENTRY = "Give a name, a kind (character or weapon), a day as 2026-11-11, and copies from 1 to 7."
CITLALI = {"name": "Citlali", "kind": "character", "about": "2026-11-11", "copies": 1}


def _core(tmp_path: Path, clock, *, demo: bool = False) -> Core:
    return Core(
        AppPaths(tmp_path / "data"), demo=demo, clock=clock, source=None if demo else AccountSource(),
        sleep=FakeSleep(clock), process_lister=lambda: set(),
    )


@contextmanager
def opened(core: Core):
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
        yield client


@pytest.fixture
def core(tmp_path, clock):
    core = _core(tmp_path, clock)
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with opened(core) as client:
        yield client


def _published(queue) -> list[dict]:
    seen = []
    while not queue.empty():
        seen.append(queue.get_nowait())
    return seen


def test_the_model_answers_with_its_forecast_day(client, core):
    keep_demo_like(core.store)
    answer = client.get("/api/pulls")
    assert answer.status_code == 200
    assert answer.json()["savings"]["forecast"]["by"] == "2026-10-24"
    chosen = client.get("/api/pulls", params={"by": "2026-11-11"}).json()["savings"]["forecast"]
    assert (chosen["by"], chosen["default_by"], chosen["days"]) == ("2026-11-11", False, 29)


def test_a_forecast_date_before_today_is_refused(client, core):
    keep_demo_like(core.store)
    answer = client.get("/api/pulls", params={"by": "2026-10-12"})
    assert (answer.status_code, answer.json()) == (422, {"error": "Choose today or a later day."})
    for bad in ("tomorrow", "2026-13-01", "20261111", "2026-11-11T00:00", ""):
        answer = client.get("/api/pulls", params={"by": bad})
        assert (answer.status_code, answer.json()) == (422, {"error": UNEXPECTED_REQUEST}), bad


def test_the_history_route_pages_newest_first(client, core):
    assert client.get("/api/pulls/history").json() == {"rows": [], "more": False}  # no history yet
    keep_demo_like(core.store)
    first = client.get("/api/pulls/history").json()
    assert (len(first["rows"]), first["more"]) == (200, True)
    moments = [row["at"] for row in first["rows"]]
    assert moments == sorted(moments, reverse=True)
    assert first["rows"][:100] == client.get("/api/pulls").json()["history"]["rows"]
    page = client.get("/api/pulls/history", params={"before": first["rows"][-1]["id"], "limit": 150}).json()
    assert (len(page["rows"]), page["more"]) == (150, True)
    assert int(page["rows"][0]["id"]) < int(first["rows"][-1]["id"])
    last = client.get("/api/pulls/history", params={"before": page["rows"][-1]["id"], "limit": 100}).json()
    assert (len(last["rows"]), last["more"]) == (37, False)  # 387 − 200 − 150
    # A limit is held to 1 to 500.
    assert len(client.get("/api/pulls/history", params={"limit": 0}).json()["rows"]) == 1
    assert len(client.get("/api/pulls/history", params={"limit": 9999}).json()["rows"]) == 387
    for bad in ({"before": "the newest"}, {"limit": "many"}, {"before": str(2**63)}, {"before": "-1"}):
        answer = client.get("/api/pulls/history", params=bad)
        assert (answer.status_code, answer.json()) == (422, {"error": UNEXPECTED_REQUEST}), bad


def test_the_balance_is_set_and_estimated(client, core, clock):
    keep_demo_like(core.store)
    answer = client.put("/api/pulls/balance", json={"primogems": 9840, "fates": 14})
    assert answer.status_code == 200
    savings = answer.json()
    assert savings["set"] == {"primogems": 9840, "fates": 14, "set_at": iso(NOW)}
    assert savings["estimated"] == {"primogems": 9840, "fates": 14, "income": 0, "wishes": 0}
    assert savings["pulls"] == 75
    for bad in (
        {"primogems": -1, "fates": 0}, {"primogems": 10_000_000, "fates": 0}, {"primogems": 9840.5, "fates": 0},
        {"primogems": True, "fates": 0}, {"primogems": "9840", "fates": 1}, {"fates": 3},
    ):
        answer = client.put("/api/pulls/balance", json=bad)
        assert (answer.status_code, answer.json()) == (422, {"error": "Give primogems and fates as whole numbers."}), bad
    assert client.get("/api/pulls").json()["savings"]["set"]["primogems"] == 9840  # nothing refused was kept



def test_the_demo_answers_its_made_up_history(tmp_path, clock):
    core = _core(tmp_path, clock, demo=True)
    with opened(core) as client:
        model = client.get("/api/pulls").json()
        assert problem_with(model) is None
        assert (model["uid"], model["account_uid"]) == (700000001, 700000001)
        assert [(card["pity"], card["known"], card["guarantee"]) for card in model["pity"]] == [
            (61, True, "guaranteed"), (23, True, "fifty"), (44, True, "none"), (5, True, "fifty"),
        ]
        assert model["pity"][1]["path"] == {"item": "Azurelight", "points": 0, "max": 1}
        assert model["history_from"] == iso(NOW - timedelta(days=180))
        # No import has run in this session: the importer's block is idle, the seeded run the last that ended well.
        assert (model["import"]["state"], model["import"]["found"], model["import"]["pages"]) == ("idle", 387, 20)
        assert model["import"]["last_at"] is not None
        assert [banner["name"] for banner in model["banners"]] == [
            "Void Star's Advent", "La Chanson Cerise", "Epitome Invocation",
        ]
        assert all(banner["running"] for banner in model["banners"])
        assert [banner["art"] for banner in model["banners"]] == [f"/api/icon/banner.{id}" for id in (33201, 33202, 33203)]
        savings = model["savings"]
        assert (savings["set"], savings["pulls"]) == ({"primogems": 9840, "fates": 14, "set_at": iso(NOW)}, 75)
        assert savings["income_per_day"] is not None  # the demo's diary
        assert savings["forecast"]["by"] == "2026-10-24"
        assert [(entry["name"], entry["about"], entry["copies"]) for entry in model["wishlist"]] == [
            ("Citlali", "2026-11-11", 1),
        ]
        # The demo has the Welkin Moon, and its next version, 7.2, is worked out from its made-up diary.
        assert savings["owned"] == {"welkin": True, "gnostic_hymn": False}
        assert (savings["next"]["number"], savings["next"]["starts_on"], savings["next"]["ends_on"]) == (
            "7.2", "2026-11-04", "2026-12-16",
        )
        assert isinstance(savings["by_next_end"], int) and savings["by_next_end"] > savings["pulls"]
        assert savings["achievements_pulls"] == savings["achievements_left"] // 160 == 36
        history = model["history"]
        # Skirk at 77 and Qiqi at 81 are the character event's 5★: their average, against a typical player's.
        assert (history["count"], history["average_pity"], history["won"], history["lost"]) == (387, 79, 1, 1)
        assert history["typical_average"] == 62.3
        assert [row["month"] for row in history["months"]] == [f"2026-{month:02d}" for month in range(5, 11)]
        columns = ("character", "weapon", "standard", "chronicled")
        assert sum(row[column] for row in history["months"] for column in columns) == 387
        page = client.get("/api/pulls/history", params={"limit": 500}).json()
        assert (len(page["rows"]), page["more"]) == (387, False)
    core.store.close()


def test_the_settings_and_corrections_change_the_cards(client, core):
    keep_demo_like(core.store, corrections=False)
    weapon = client.get("/api/pulls").json()["pity"][1]
    assert (weapon["pity"], weapon["known"], weapon["guarantee"]) == (23, False, "unknown")  # "at least 23"
    answer = client.put("/api/pulls/settings", json={"corrections": {"weapon": {"pity": 10, "guaranteed": True}}})
    assert answer.status_code == 200
    weapon = answer.json()[1]  # the model's pity list
    assert (weapon["pity"], weapon["known"], weapon["guarantee"]) == (33, True, "guaranteed")
    assert weapon["correction"] == {"pity": 10, "guaranteed": True}
    for pool, top in (("character", 89), ("weapon", 79)):
        for bad in (
            {"pity": top + 1, "guaranteed": False}, {"pity": -1, "guaranteed": False}, {"pity": 1.5, "guaranteed": False},
            {"pity": True, "guaranteed": False}, {"pity": 3, "guaranteed": "yes"}, {"pity": 3}, 7,
        ):
            answer = client.put("/api/pulls/settings", json={"corrections": {pool: bad}})
            expected = f"Give the pity as a whole number from 0 to {top}."
            assert (answer.status_code, answer.json()) == (422, {"error": expected}), (pool, bad)
    weapon = client.put("/api/pulls/settings", json={"corrections": {"weapon": None}}).json()[1]
    assert (weapon["pity"], weapon["known"], weapon["correction"]) == (23, False, None)

    weapon = client.put("/api/pulls/settings", json={"points": {"weapon": 1}}).json()[1]
    assert weapon["path"] == {"item": "Azurelight", "points": 1, "max": 1}
    for bad in (2, -1, True, "1", 0.5):
        answer = client.put("/api/pulls/settings", json={"points": {"weapon": bad}})
        assert (answer.status_code, answer.json()) == (422, {"error": "Give the Fate Points as 0 or 1."}), bad
    assert client.put("/api/pulls/settings", json={"points": {"weapon": None}}).json()[1]["path"]["points"] == 0

    cards = client.put(
        "/api/pulls/settings", json={"charted_weapon": "Symphonist of Scents", "chronicled_path": "Shenhe"}
    ).json()
    assert cards[1]["path"] == {"item": "Symphonist of Scents", "points": 0, "max": 1}
    assert cards[3]["path"] == {"item": "", "points": 0, "max": 1}  # no chronicled wish runs
    assert len(client.put("/api/pulls/settings", json={"charted_weapon": "x" * 80}).json()) == 4
    # A refused part refuses the whole request: nothing of it is kept.
    answer = client.put(
        "/api/pulls/settings",
        json={"charted_weapon": "Azurelight", "corrections": {"weapon": {"pity": 99, "guaranteed": False}}},
    )
    assert answer.status_code == 422
    assert client.get("/api/pulls").json()["pity"][1]["path"]["item"] == ""  # still the 80 x's, which no banner has


def test_the_switches_and_the_typed_events_are_set_by_the_settings_route(client, core):
    keep_demo_like(core.store)
    queue = core.bus.subscribe()
    answer = client.put(
        "/api/pulls/settings", json={"welkin": True, "events_typed": {"version": "7.2", "primogems": 2330}}
    )
    assert answer.status_code == 200 and len(answer.json()) == 4  # the answer is still the pity cards
    assert _published(queue) == [{"type": "pulls_changed"}]
    account = core.store.pulls_account(UID)
    assert (account.welkin, account.gnostic_hymn, account.events_typed) == (True, False, {"7.2": 2330})
    # The page reads back what it set: the switches, and the events row as the player typed it.
    savings = client.get("/api/pulls").json()["savings"]
    assert savings["owned"] == {"welkin": True, "gnostic_hymn": False}
    assert (savings["next"]["number"], savings["next"]["events_typed"]) == ("7.2", 2330)
    assert savings["next"]["rows"][1] == {"key": "events", "primogems": 2330, "fates": 0, "on": True, "estimated": False}
    assert client.put("/api/pulls/settings", json={"gnostic_hymn": True, "welkin": False}).status_code == 200
    assert client.put(
        "/api/pulls/settings", json={"events_typed": {"version": "7.2", "primogems": None}}
    ).status_code == 200
    account = core.store.pulls_account(UID)
    assert (account.welkin, account.gnostic_hymn, account.events_typed) == (False, True, {})
    for primogems in (0, 100_000):  # the ends of the range are values
        answer = client.put("/api/pulls/settings", json={"events_typed": {"version": "7.3", "primogems": primogems}})
        assert answer.status_code == 200, primogems


def test_with_no_history_the_refusal_follows_the_login(client, core):
    core.pulls._login_on = lambda: True  # a login that updates the history by itself
    answer = client.put("/api/pulls/settings", json={"welkin": True})
    assert (answer.status_code, answer.json()) == (409, {"error": NO_HISTORY_LOGIN})
    core.pulls._login_on = lambda: False
    answer = client.put("/api/pulls/settings", json={"welkin": True})
    assert (answer.status_code, answer.json()) == (409, {"error": NO_HISTORY})


def test_bad_switch_values_are_refused(client, core):
    # With no wish history there is no account shown, and a switch has nowhere to be kept (ruling R10).
    for good in ({"welkin": True}, {"gnostic_hymn": False}, {"events_typed": {"version": "7.2", "primogems": 2330}}):
        answer = client.put("/api/pulls/settings", json=good)
        assert (answer.status_code, answer.json()) == (409, {"error": NO_HISTORY}), good
    keep_demo_like(core.store)
    queue = core.bus.subscribe()
    for bad in (
        {"welkin": "yes"}, {"welkin": 1}, {"gnostic_hymn": None}, {"gnostic_hymn": "true"},
        {"events_typed": {"version": "7.2", "primogems": -1}},
        {"events_typed": {"version": "7.2", "primogems": 100_001}},
        {"events_typed": {"version": "7.2", "primogems": 12.5}},
        {"events_typed": {"version": "7.2", "primogems": True}},
        {"events_typed": {"version": "7.2", "primogems": "2330"}},
        {"events_typed": {"version": "7.2"}}, {"events_typed": {"primogems": 5}}, {"events_typed": "7.2"},
        {"events_typed": {"version": 7.2, "primogems": 5}}, {"events_typed": {"version": "later", "primogems": 5}},
        {"events_typed": {"version": "7.2", "primogems": 5, "extra": 1}}, {"events_typed": [7.2, 5]},
    ):
        answer = client.put("/api/pulls/settings", json={"charted_weapon": "Symphonist of Scents", **bad})
        assert (answer.status_code, answer.json()) == (422, {"error": UNEXPECTED_REQUEST}), bad
    account = core.store.pulls_account(UID)
    assert (account.welkin, account.gnostic_hymn, account.events_typed) == (False, False, {})
    assert account.charted_weapon == "Azurelight"  # a refused request keeps nothing of its other parts
    assert _published(queue) == []


def test_a_request_of_another_shape_is_refused(client, core):
    keep_demo_like(core.store)
    for bad in (
        {"charted_weapon": "x" * 81}, {"chronicled_path": 5}, {"corrections": {"novice": {"pity": 1, "guaranteed": False}}},
        {"points": {"character": 1}}, {"corrections": [1]}, {"points": "1"}, {"something": 1},
    ):
        answer = client.put("/api/pulls/settings", json=bad)
        assert (answer.status_code, answer.json()) == (422, {"error": UNEXPECTED_REQUEST}), bad
    assert client.put("/api/pulls/settings", json=[1]).json() == {"error": UNEXPECTED_REQUEST}


def test_the_wishlist_is_chained_in_date_order(client, core):
    keep_demo_like(core.store)
    first = client.post("/api/pulls/wishlist", json=CITLALI)
    assert first.status_code == 200
    citlali = first.json()["id"]
    client.post("/api/pulls/wishlist", json={**CITLALI, "name": "Escoffier"})
    wishlist = client.get("/api/pulls").json()["wishlist"]
    assert [entry["name"] for entry in wishlist] == ["Citlali", "Escoffier"]
    assert wishlist[0]["pulls_by_then"] == wishlist[1]["pulls_by_then"]
    assert wishlist[1]["chance"] < wishlist[0]["chance"]  # the first one's pulls are spent first

    early = client.post("/api/pulls/wishlist", json={**CITLALI, "name": "Mavuika", "about": "2026-10-20"}).json()["id"]
    assert [entry["name"] for entry in client.get("/api/pulls").json()["wishlist"]] == ["Mavuika", "Citlali", "Escoffier"]
    later = {**CITLALI, "name": "Mavuika", "about": "2026-12-01", "copies": 2}
    answer = client.put(f"/api/pulls/wishlist/{early}", json=later)
    assert answer.json() == {"id": early}
    wishlist = client.get("/api/pulls").json()["wishlist"]
    assert [(entry["name"], entry["copies"]) for entry in wishlist] == [("Citlali", 1), ("Escoffier", 1), ("Mavuika", 2)]

    for bad in (
        {"name": ""}, {"name": "   "}, {"name": "x" * 81}, {"name": 5}, {"kind": "artifact"}, {"about": "11/11/2026"},
        {"about": "2026-02-30"}, {"about": None}, {"copies": 0}, {"copies": 8}, {"copies": 1.0}, {"copies": True},
    ):
        answer = client.post("/api/pulls/wishlist", json={**CITLALI, **bad})
        assert (answer.status_code, answer.json()) == (422, {"error": BAD_ENTRY}), bad
        answer = client.put(f"/api/pulls/wishlist/{citlali}", json={**CITLALI, **bad})
        assert (answer.status_code, answer.json()) == (422, {"error": BAD_ENTRY}), bad
    for answer in (client.put("/api/pulls/wishlist/999999", json=CITLALI), client.delete("/api/pulls/wishlist/999999")):
        assert (answer.status_code, answer.json()) == (404, {"error": "There is no such wishlist entry."})
    assert client.delete(f"/api/pulls/wishlist/{early}").json() == {"id": early}
    assert [entry["name"] for entry in client.get("/api/pulls").json()["wishlist"]] == ["Citlali", "Escoffier"]

    for n in range(18):
        assert client.post("/api/pulls/wishlist", json={**CITLALI, "name": f"Character {n}"}).status_code == 200
    answer = client.post("/api/pulls/wishlist", json={**CITLALI, "name": "The twenty-first"})
    assert (answer.status_code, answer.json()) == (409, {"error": "The wishlist keeps at most 20 entries."})
    assert len(client.get("/api/pulls").json()["wishlist"]) == 20


def test_nothing_is_kept_before_any_history(client, core):
    queue = core.bus.subscribe()
    for method, path, body in (
        ("put", "/api/pulls/settings", {"charted_weapon": "Azurelight"}),
        ("put", "/api/pulls/balance", {"primogems": 1, "fates": 1}),
        ("post", "/api/pulls/wishlist", CITLALI),
    ):
        answer = client.request(method.upper(), path, json=body)
        assert (answer.status_code, answer.json()) == (409, {"error": NO_HISTORY}), path
    answer = client.delete("/api/pulls/wishlist/1")
    assert (answer.status_code, answer.json()) == (404, {"error": "There is no such wishlist entry."})
    assert _published(queue) == []


def test_every_change_publishes_pulls_changed(client, core):
    keep_demo_like(core.store)
    queue = core.bus.subscribe()
    client.get("/api/pulls")
    client.get("/api/pulls/history")
    assert _published(queue) == []  # reading changes nothing
    entry = client.post("/api/pulls/wishlist", json=CITLALI).json()["id"]
    assert _published(queue) == [{"type": "pulls_changed"}]
    for method, path, body in (
        ("PUT", "/api/pulls/settings", {"charted_weapon": "Azurelight"}),
        ("PUT", "/api/pulls/balance", {"primogems": 1, "fates": 2}),
        ("PUT", f"/api/pulls/wishlist/{entry}", {**CITLALI, "copies": 2}),
        ("DELETE", f"/api/pulls/wishlist/{entry}", None),
    ):
        assert client.request(method, path, json=body).status_code == 200, path
        assert _published(queue) == [{"type": "pulls_changed"}], path
    assert client.put("/api/pulls/balance", json={"primogems": -1, "fates": 0}).status_code == 422
    assert client.delete(f"/api/pulls/wishlist/{entry}").status_code == 404
    assert _published(queue) == []  # a refused change publishes nothing


# ---------------------------------------------------------------- the import's route (the Pulls plan, Task 7, Part B)
# POST /api/pulls/import starts an import on the player's press, and its progress comes as pulls_import events. In the
# demo it runs on the demo's stand-ins, a made-up link and pages made from the demo's own wishes, and contacts nothing.

IMPORT_PORT = 4321
IMPORT_BASE = f"http://127.0.0.1:{IMPORT_PORT}"


@pytest.fixture
def demo_core(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    yield core
    core.store.close()


@pytest.fixture
def demo_client(demo_core):
    with TestClient(create_app(demo_core, IMPORT_PORT), base_url=IMPORT_BASE) as client:
        client.get("/launch", params={"k": demo_core.launch_secret}, follow_redirects=False)
        yield client


def _until_the_import_ends(core) -> None:
    deadline = time.monotonic() + 30
    while core.wish_import.running:
        assert time.monotonic() < deadline, "the import did not end"
        time.sleep(0.01)


def _imports(queue) -> list[tuple]:
    seen = []
    while not queue.empty():
        event = queue.get_nowait()
        if event["type"] == "pulls_import":
            seen.append((event["state"], event["pool"], event["pages"], event["found"], event["message"]))
    return seen


def test_the_demo_import_finds_three_then_nothing(demo_client, demo_core):
    queue = demo_core.bus.subscribe()
    before = demo_core.store.wish_uids()
    answer = demo_client.post("/api/pulls/import")
    assert (answer.status_code, answer.json()) == (200, {"started": True})
    _until_the_import_ends(demo_core)
    events = _imports(queue)
    # One page of each wish type: the character event's holds the three new wishes.
    assert events[0] == ("running", None, 0, 0, None)
    assert [(state, pool, pages) for state, pool, pages, _, _ in events[1:-1]] == [
        ("running", "Character event", 1), ("running", "Character event", 1), ("running", "Weapon event", 1),
        ("running", "Standard", 1), ("running", "Chronicled", 1), ("running", "Beginners' wish", 1),
    ]
    assert events[-1] == ("done", None, 6, 3, "Imported 3 new wishes.")
    state = demo_core.wish_import.state()
    assert (state["state"], state["found"], state["message"]) == ("done", 3, "Imported 3 new wishes.")
    uid = demo_core.store.wish_uids()[0]
    assert uid == 700000001 and set(before) <= {uid}
    newest = demo_core.store.wishes_before(uid, None, 3)
    assert [(wish.name, wish.rank, wish.pool, wish.time) for wish in newest] == [
        ("Fischl", 4, "character", "2026-10-13 07:00:00"),
        ("Cool Steel", 3, "character", "2026-10-13 07:00:00"),
        ("Slingshot", 3, "character", "2026-10-13 07:00:00"),
    ]
    # The second press finds nothing new.
    assert demo_client.post("/api/pulls/import").json() == {"started": True}
    _until_the_import_ends(demo_core)
    assert _imports(queue)[-1] == ("done", None, 6, 0, "Nothing new. The history is up to date.")


def test_a_second_press_while_one_runs_is_refused_by_the_route(demo_client, demo_core):
    release = threading.Event()
    pages = demo_core.wish_import._fetch  # the demo's pages, made on the core's own thread

    async def slow(*args):
        await asyncio.to_thread(release.wait, 10)
        return await pages(*args)

    demo_core.wish_import._fetch = slow
    try:
        assert demo_client.post("/api/pulls/import").json() == {"started": True}
        refused = demo_client.post("/api/pulls/import")
        assert (refused.status_code, refused.json()) == (409, {"error": "An import is running."})
    finally:
        release.set()
    _until_the_import_ends(demo_core)
    assert demo_core.wish_import.state()["state"] == "done"


def test_a_press_while_an_update_with_the_login_runs_is_refused_by_the_route(demo_client, demo_core):
    demo_core.wish_import.running = True  # an update with the login runs: the demo's press is that very run
    try:
        refused = demo_client.post("/api/pulls/import")
        assert (refused.status_code, refused.json()) == (409, {"error": "An import is running."})
    finally:
        demo_core.wish_import.running = False
    assert demo_client.post("/api/pulls/import").json() == {"started": True}
    _until_the_import_ends(demo_core)
    assert demo_core.wish_import.state()["state"] == "done"


def test_the_import_is_running_when_the_press_is_answered(demo_client, demo_core):
    release = threading.Event()
    pages = demo_core.wish_import._fetch

    async def slow(*args):
        await asyncio.to_thread(release.wait, 10)
        return await pages(*args)

    demo_core.wish_import._fetch = slow
    try:
        assert demo_client.post("/api/pulls/import").json() == {"started": True}
        assert demo_core.wish_import.running  # the login path has reserved the importer by then
    finally:
        release.set()
    _until_the_import_ends(demo_core)


NOT_STARTED = "Guild Board has not started yet. Read its first page, then press Continue."


def test_the_import_waits_for_the_first_run_s_consent(client, core):
    # Ruling R21: the first run's page says what Import reads before anything of the game's is read; until the player
    # presses Continue there, an import is refused, and nothing is read or recorded. The page never shows Pulls before it,
    # so only another program asking the API sees the sentence.
    assert core.settings.risk_acknowledged is False
    queue = core.bus.subscribe()
    answer = client.post("/api/pulls/import")
    assert (answer.status_code, answer.json()) == (409, {"error": NOT_STARTED})
    assert core.wish_import.running is False and core.store.wish_imports(1) == [] and _published(queue) == []
    core.update_settings({"risk_acknowledged": True})
    assert client.post("/api/pulls/import").json() == {"started": True}
    _until_the_import_ends(core)
    assert core.store.wish_imports(1)[0].outcome == "failed"  # the test's own folder holds no game's log


def test_the_demo_imports_before_the_consent_as_it_reads_nothing_of_the_games(demo_client, demo_core):
    # The demo's import reads no file of the game's and contacts nothing (its stand-ins): it needs no consent, as a demo
    # session's tests press it (tests/test_handsoff.py). The demo opened from the first run's page has the consent anyway.
    assert demo_core.settings.risk_acknowledged is False
    assert demo_client.post("/api/pulls/import").json() == {"started": True}
    _until_the_import_ends(demo_core)
    assert demo_core.wish_import.state()["state"] == "done"


def test_the_import_route_needs_the_session_cookie(demo_core):
    with TestClient(create_app(demo_core, IMPORT_PORT), base_url=IMPORT_BASE) as anonymous:
        assert anonymous.post("/api/pulls/import").status_code == 401
    assert demo_core.wish_import.running is False


def test_the_model_carries_the_imports_own_state(demo_client, demo_core):
    # Before any press the model's import block is the importer's idle state; after the demo's import, how it ended.
    assert demo_client.get("/api/pulls").json()["import"] == demo_core.wish_import.state()
    assert demo_client.post("/api/pulls/import").json() == {"started": True}
    _until_the_import_ends(demo_core)
    shown = demo_client.get("/api/pulls").json()["import"]
    assert shown == demo_core.wish_import.state()
    assert (shown["state"], shown["found"], shown["message"]) == ("done", 3, "Imported 3 new wishes.")
