"""Changes go up and come down (the online plan, Task C4): the player's own rows, in batches, after ten quiet seconds, and the
account's, at the start, every five minutes and when asked. The server is the `FakeCloud` of the tests: nothing reaches the
internet, and a failure of the server loses nothing."""
import asyncio
import json
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs

import pytest

from cloud_fakes import USER_ID, FakeCloud, answer
from guildboard.cloud.models import SENTENCES
from guildboard.cloud.service import Local, Online
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.cloud.sync import SYNCED_SETTINGS, SyncSeam, events_of
from guildboard.events import EventBus
from guildboard.netpolicy import ResponseTooLarge
from guildboard.store import Store
from support import FakeSleep
from test_sync_outbox import CASES

PROFILE = ("GET", "/rest/v1/profiles")
SYNC_ROWS = ("GET", "/rest/v1/sync_rows")
PUSH = ("POST", "/rest/v1/rpc/sync_push")
LAYOUT = CASES["layouts"][0]
STAMP = "2026-10-13T08:00:00.123456+00:00"
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def own_row(**changes) -> dict:
    return {
        "name": "Nova", "discriminator": "5120", "picture_url": None, "ar": None, "uid": None, "find_by_uid": False,
        "pins": [], "sharing": [], **changes,
    }


def scripted(server_clock=None, **more) -> FakeCloud:
    return FakeCloud(
        {PROFILE: answer(200, [own_row()]), SYNC_ROWS: answer(200, []), PUSH: answer(200, 1), **more}, server_clock=server_clock,
    )


class Bench:
    """An `Online` with a store of its own data, a fake for the settings, and what the pages were told."""

    def __init__(self, tmp_path, clock, cloud, *, uid=None, on=True, signed_in=True, settled=True, store=None, folder_uid=None):
        self.store = store if store is not None else Store.in_memory()
        if settled:  # the first sync of this PC with this account is over (tests/test_cloud_first_sync.py is about it)
            self.store.set_meta("sync_account", USER_ID)
            self.store.set_meta("sync_first", "done")
        self.told: list[set[str]] = []
        self.settings: dict = {"commission_region": "liyue", "spending_currency": "PLN", "notifications": True}
        self.on = on
        self.facts = {"uid": uid, "ar": 58, "picture_url": None} if uid is not None else None
        seam = SyncSeam(
            store=self.store, on=lambda: self.on, setting=lambda name: self.settings.get(name),
            apply_setting=self._apply, changed=lambda events: self.told.append(set(events)), uid=lambda: folder_uid,
        )
        cloud_store = self.cloud_store = CloudStore(tmp_path / "cloud.bin")
        if signed_in:
            cloud_store.save(CloudSession(
                "ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 365 * 86_400, USER_ID, "Nova", "5120",
            ))
        self.cloud, self.clock = cloud, clock
        self.online = Online(
            cloud_store, EventBus(), clock, fetch=cloud, sleep=FakeSleep(clock),
            local=Local(profile=lambda: self.facts, today=lambda: date(2026, 10, 13), sync=seam),
        )

    def _apply(self, name: str, value) -> bool:
        # Keeps whatever it is given but a value no setting holds, as the core does: the choice of names is sync's.
        if isinstance(value, list) or value == self.settings.get(name):
            return False
        self.settings[name] = value
        return True

    def sent(self, what: str) -> list[int]:
        return [index for index, line in enumerate(self.cloud.sent()) if what in line]

    def pushed(self) -> list[dict]:
        """The rows of every push, in order."""
        return [row for index in self.sent("sync_push") for row in self.cloud.body(index)["p_rows"]]

    def query(self, index: int) -> dict[str, list[str]]:
        return parse_qs(self.cloud.requests[index][1].split("?", 1)[1])


def arrives(kind: str, row_key: str, data: dict, received_at: str = STAMP, *, edited_at: str | None = None, device="phone",
            deleted: bool = False) -> dict:
    return {
        "kind": kind, "row_key": row_key, "data": data, "deleted": deleted, "edited_at": edited_at or received_at,
        "received_at": received_at, "device_id": device,
    }


async def quiet(bench: Bench, seconds: float = 11) -> None:
    bench.clock.advance(seconds=seconds)
    await bench.online.sync_turn()


# ------------------------------------------------------------------------------------------------------------- going up
async def test_a_change_goes_up_after_ten_quiet_seconds(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()  # the first look: the account is read, and the change is seen
    assert bench.sent("sync_push") == []
    await quiet(bench, 9)
    assert bench.sent("sync_push") == []
    [first] = bench.store.sync_outbox(10)
    bench.store._conn.execute("UPDATE layouts SET revision = 2")  # another change: the quiet starts over
    # Even one made in the same millisecond as the first, as a fast PC makes them: its line has the same stamp.
    bench.store._conn.execute("UPDATE sync_outbox SET edited_at = ?", (first.edited_at,))
    await bench.online.sync_turn()
    await quiet(bench, 9)
    assert bench.sent("sync_push") == []
    await quiet(bench, 2)
    [row] = bench.pushed()
    assert (row["kind"], row["row_key"], row["deleted"]) == ("layouts", '["board"]', False)
    assert row["data"]["revision"] == 2 and "id" not in row["data"]
    assert row["edited_at"].endswith("Z") and row["device_id"]
    assert set(row) == {"kind", "row_key", "data", "deleted", "edited_at", "device_id"}
    assert bench.store.sync_outbox(10) == []
    await quiet(bench, 60)  # and nothing goes up again with nothing to send
    assert len(bench.sent("sync_push")) == 1


async def test_a_delete_goes_up_as_a_delete(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.store._conn.execute(LAYOUT)
    bench.store._conn.execute("DELETE FROM layouts")
    await bench.online.sync_turn()
    await quiet(bench)
    [row] = bench.pushed()
    assert (row["kind"], row["row_key"], row["deleted"], row["data"]) == ("layouts", '["board"]', True, {})


async def test_two_hundred_rows_go_in_a_call(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    for number in range(450):
        bench.store._conn.execute(
            f"INSERT INTO widget_data (widget_id, data, updated_at) VALUES ('w{number:03}', '{{}}', '2026-10-13T08:00:00+00:00')"
        )
    await bench.online.sync_turn()
    await quiet(bench)
    assert [len(bench.cloud.body(index)["p_rows"]) for index in bench.sent("sync_push")] == [200, 200, 50]
    assert bench.store.sync_outbox(1000) == []


async def test_a_failed_push_keeps_the_outbox(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PUSH] = [answer(503), answer(200, 1)]
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert len(bench.sent("sync_push")) == 1
    assert [line.kind for line in bench.store.sync_outbox(10)] == ["layouts"]  # nothing was lost
    assert bench.online.view()["offline"] is True

    # And no storm: the next try is five minutes on.
    await quiet(bench, 60)
    await quiet(bench, 60)
    assert len(bench.sent("sync_push")) == 1
    await quiet(bench, 4 * 60)
    assert len(bench.sent("sync_push")) == 2
    assert bench.store.sync_outbox(10) == []
    assert bench.online.view()["offline"] is False


class Picky(FakeCloud):
    """The project with a row it cannot take: it refuses the whole call that holds it, as sync_push does before it writes."""

    def __init__(self, refuses, refusal: dict | None = None) -> None:
        super().__init__({PROFILE: answer(200, [own_row()]), SYNC_ROWS: answer(200, [])})
        self.refuses = refuses
        self.refusal = refusal or {"code": "P0001", "message": "bad_rows"}
        self.kept: list[dict] = []

    def __call__(self, path, *, method="GET", headers=None, body=None, **kwargs):
        if path == PUSH[1] and method == "POST":
            self.requests.append((method, path, dict(headers or {}), body))
            rows = json.loads(body)["p_rows"]
            if any(self.refuses(row) for row in rows):
                return 400, json.dumps(self.refusal).encode()
            self.kept += rows
            return 200, str(len(rows)).encode()
        return super().__call__(path, method=method, headers=headers, body=body, **kwargs)


def widgets(bench: Bench, count: int) -> None:
    for number in range(count):
        bench.store._conn.execute(
            f"INSERT INTO widget_data (widget_id, data, updated_at) VALUES ('w{number:03}', '{{}}', '2026-10-13T08:00:00+00:00')"
        )


@pytest.mark.parametrize("refusal", [
    {"code": "P0001", "message": "bad_rows"},  # sync_push's judge of the rows
    {"code": "22P05", "message": "unsupported Unicode escape sequence"},  # a row the call could not even be read with
    {"code": "PGRST102", "message": "Empty or invalid json"},
])
async def test_a_row_the_account_cannot_take_holds_back_no_other(tmp_path, clock, caplog, refusal):
    cloud = Picky(lambda row: row["row_key"] == '["w100"]', refusal)
    bench = Bench(tmp_path, clock, cloud)
    widgets(bench, 250)
    await bench.online.sync_turn()
    await quiet(bench)
    assert sorted(row["row_key"] for row in cloud.kept) == sorted(f'["w{number:03}"]' for number in range(250) if number != 100)
    assert bench.store.sync_outbox(10) == []  # it can never go, and no line waits for it
    assert len(bench.sent("sync_push")) < 30  # a look at each half, and not one call a row
    assert any("widget_data" in record.getMessage() for record in caplog.records)
    assert "w100" not in caplog.text
    assert bench.online.view()["offline"] is False


async def test_a_row_that_cannot_be_read_holds_back_no_other(tmp_path, clock, caplog):
    cloud = Picky(lambda row: False)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(CASES["timers"][0])
    bench.store._conn.execute(LAYOUT)
    timer_id = bench.store.timers()[0].id
    bench.store._conn.execute(f"INSERT INTO timer_events (timer_id, at, recorded_at, source) VALUES ({timer_id}, 'x', 'y', 'player')")
    await bench.online.sync_turn()
    await quiet(bench)
    assert [row["kind"] for row in cloud.kept] == ["layouts"]
    assert bench.store.sync_outbox(10) == []
    assert any("timers" in record.getMessage() for record in caplog.records)


async def test_a_row_that_was_refused_goes_again_when_the_player_changes_it(tmp_path, clock):
    cloud = Picky(lambda row: row["data"].get("data") == "too much")
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute("INSERT INTO widget_data (widget_id, data, updated_at) VALUES ('w', 'too much', '2026-10-13T08:00:00+00:00')")
    await bench.online.sync_turn()
    await quiet(bench)
    assert cloud.kept == [] and bench.store.sync_outbox(10) == []
    bench.store._conn.execute("UPDATE widget_data SET data = 'fine'")
    await quiet(bench)
    await quiet(bench)
    assert [row["data"]["data"] for row in cloud.kept] == ["fine"]


async def test_a_key_too_long_for_the_account_never_leaves_this_pc(tmp_path, clock, caplog):
    # A long text pasted into the box for gift codes is kept as a code HoYoverse called invalid: it may be a link with a key in it,
    # and the server's refusal would come after it had been told.
    code = "HTTPS://EXAMPLE.INVALID/?AUTHKEY=" + "K" * 300
    cloud = Picky(lambda row: False)
    bench = Bench(tmp_path, clock, cloud)
    bench.store.put_gift_code("700000001", code, "invalid", 0, "typed", NOW)
    bench.store.put_gift_code("700000001", "SHORT", "redeemed", 60, "typed", NOW)
    await bench.online.sync_turn()
    await quiet(bench)
    assert [row["data"]["code"] for row in cloud.kept] == ["SHORT"]
    assert not any(code.encode() in (body or b"") for _, _, _, body in cloud.requests)
    assert bench.store.sync_outbox(10) == []
    assert code not in caplog.text


async def test_a_refusal_of_the_call_is_no_refusal_of_a_row(tmp_path, clock):
    # What is wrong with the call is wrong for every row: none of them may be taken for the one to leave out.
    cloud = Picky(lambda row: True, {"code": "42501", "message": "permission denied for function sync_push"})
    bench = Bench(tmp_path, clock, cloud)
    widgets(bench, 250)
    await bench.online.sync_turn()
    await quiet(bench)
    assert len(bench.sent("sync_push")) == 1
    assert len(bench.store.sync_outbox(1000)) == 250


async def test_a_push_the_server_refused_keeps_the_outbox_and_waits(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PUSH] = answer(400, {"code": "42501", "message": "permission denied for function sync_push"})
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    for _ in range(8):  # a refusal says nothing of the server; the same call is not made again at once
        await quiet(bench, 30)
    assert len(bench.sent("sync_push")) == 1
    assert len(bench.store.sync_outbox(10)) == 1
    await quiet(bench, 120)
    assert len(bench.sent("sync_push")) == 2


@pytest.mark.parametrize("code", ["sync_full", "sync_busy"])
async def test_an_account_that_takes_no_more_says_so_keeps_the_outbox_and_waits(tmp_path, clock, code):
    cloud = scripted()
    cloud.answers[PUSH] = [answer(400, {"code": "P0001", "message": code}), answer(200, 1)]
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.online.view()["message"] == SENTENCES[code]  # not a sync that goes quiet for ever
    assert len(bench.store.sync_outbox(10)) == 1
    for _ in range(8):
        await quiet(bench, 30)
    assert len(bench.sent("sync_push")) == 1
    await quiet(bench, 120)
    assert len(bench.sent("sync_push")) == 2
    assert bench.store.sync_outbox(10) == []
    assert bench.online.view()["message"] is None  # it passed, and there is nothing more to say


async def test_a_project_that_is_full_for_everyone_says_whose_it_is_to_fix(tmp_path, clock):
    # 0004's cap on the whole project refuses with sync_full too, and says project_full in its details: that is the server's
    # owner's to fix, not something the player did (the player's decision, 2026-11-01, item 3).
    cloud = scripted()
    cloud.answers[PUSH] = answer(400, {"code": "P0001", "message": "sync_full", "details": "project_full", "hint": None})
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.online.view()["message"] == SENTENCES["project_full"] != SENTENCES["sync_full"]
    assert "owner" in SENTENCES["project_full"]
    assert len(bench.store.sync_outbox(10)) == 1  # the change waits for room


async def test_a_push_in_part_keeps_what_it_did_not_send(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PUSH] = [answer(200, 200), answer(503)]
    bench = Bench(tmp_path, clock, cloud)
    for number in range(250):
        bench.store._conn.execute(
            f"INSERT INTO widget_data (widget_id, data, updated_at) VALUES ('w{number:03}', '{{}}', '2026-10-13T08:00:00+00:00')"
        )
    await bench.online.sync_turn()
    await quiet(bench)
    assert len(bench.store.sync_outbox(1000)) == 50  # the first call was kept, the second was not


class EditingCloud(FakeCloud):
    """A server that, while it answers a push, has the player change a row: the change must stay in the outbox."""

    def __init__(self, answers, during):
        super().__init__(answers)
        self.during = during

    def __call__(self, path, **kwargs):
        if path.endswith("sync_push") and self.during is not None:
            during, self.during = self.during, None
            during()
        return super().__call__(path, **kwargs)


async def test_an_edit_made_during_a_push_stays_in_the_outbox(tmp_path, clock):
    holder: dict = {}

    def edit() -> None:
        time.sleep(0.01)  # SQLite's clock is the real one: the edit has to be later than the line it follows
        holder["store"]._conn.execute("UPDATE layouts SET revision = 7")

    cloud = EditingCloud({PROFILE: answer(200, [own_row()]), SYNC_ROWS: answer(200, []), PUSH: answer(200, 1)}, edit)
    bench = Bench(tmp_path, clock, cloud)
    holder["store"] = bench.store
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    [pushed] = bench.pushed()
    assert pushed["data"]["revision"] == 1  # what was read before the edit
    [left] = bench.store.sync_outbox(10)  # and the edit is still to go
    assert left.kind == "layouts" and left.edited_at > pushed["edited_at"]
    await quiet(bench)  # the look that sees the outbox as the edit left it
    await quiet(bench)
    assert [row["data"]["revision"] for row in bench.pushed()] == [1, 7]
    assert bench.store.sync_outbox(10) == []


async def test_a_line_whose_row_is_gone_is_dropped_and_sent_nowhere(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.store._conn.execute(LAYOUT)
    with bench.store.applying_sync():  # the row goes without a line for its delete, as a row another PC removed does
        bench.store._conn.execute("DELETE FROM layouts")
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.sent("sync_push") == []
    assert bench.store.sync_outbox(10) == []


# ----------------------------------------------------------------------------------------------------------- coming down
async def test_pull_runs_at_start_every_five_minutes_and_on_demand(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 1  # at the start
    await quiet(bench, 60)
    await quiet(bench, 60)
    await quiet(bench, 60)
    await quiet(bench, 60)
    assert len(bench.sent("sync_rows")) == 1  # four minutes on
    await quiet(bench, 61)
    assert len(bench.sent("sync_rows")) == 2  # five
    await quiet(bench, 60)
    assert len(bench.sent("sync_rows")) == 2
    view = await bench.online.sync_now()  # Settings: Sync now, whenever the player likes
    assert len(bench.sent("sync_rows")) == 3
    assert view["sync"]["last_at"] == clock.now().isoformat()


async def test_the_pull_overlaps_its_cursor_by_a_minute_and_applies_once(tmp_path, clock):
    cloud = scripted()
    first = arrives("achievement_progress", "[1402]", {"status": "done", "source": "phone", "updated_at": STAMP}, STAMP)
    second = arrives("layouts", '["board"]', {"widgets": "[]", "revision": 1, "updated_at": STAMP}, "2026-10-13T08:00:30.000000+00:00")
    cloud.answers[SYNC_ROWS] = [answer(200, [first]), answer(200, [first, second])]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert bench.told == [{"achievements_changed"}]
    assert bench.store.meta("sync_cursor") == STAMP

    clock.advance(minutes=5)
    await bench.online.sync_turn()
    # The cursor is the newest arrival it has read; the next read begins a minute before it, so that a row that came in while
    # another was being kept is not missed. The first row is read again, and the pages hear of the second alone.
    assert bench.query(bench.sent("sync_rows")[1])["received_at"] == ["gte.2026-10-13T07:59:00.123456+00:00"]
    assert bench.told == [{"achievements_changed"}, {"layout_changed"}]
    assert bench.store.meta("sync_cursor") == "2026-10-13T08:00:30.000000+00:00"
    clock.advance(minutes=5)
    await bench.online.sync_turn()
    assert bench.query(bench.sent("sync_rows")[2])["received_at"] == ["gte.2026-10-13T07:59:30.000000+00:00"]
    assert len(bench.told) == 2


async def test_the_first_pull_reads_everything(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    await bench.online.sync_turn()
    query = bench.query(bench.sent("sync_rows")[0])
    assert "received_at" not in query
    assert query["order"] == ["received_at.asc,kind.asc,row_key.asc"] and query["limit"] == ["500"]
    assert set(query["select"][0].split(",")) == {"kind", "row_key", "data", "deleted", "edited_at", "received_at", "device_id"}


async def test_own_rows_are_not_pulled_back(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    await bench.online.sync_turn()
    device = bench.store.meta("sync_device")
    assert device and re.fullmatch(r"[0-9a-f]{32}", device)
    assert bench.query(bench.sent("sync_rows")[0])["device_id"] == [f"neq.{device}"]
    # The device's id is the PC's, and stays: another start asks as the same device.
    (tmp_path / "again").mkdir()
    again = Bench(tmp_path / "again", clock, scripted())
    again.store.set_meta("sync_device", device)
    await again.online.sync_turn()
    assert again.query(again.sent("sync_rows")[0])["device_id"] == [f"neq.{device}"]


async def test_a_row_of_this_device_that_comes_all_the_same_is_passed_over(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    device = bench.store.meta("sync_device")
    mine = arrives("layouts", '["board"]', {"widgets": "[]", "revision": 1, "updated_at": STAMP}, device=device)
    cloud.answers[SYNC_ROWS] = answer(200, [mine])
    await quiet(bench, 301)
    assert bench.store.layout("board") is None and bench.told == []


async def test_a_pull_tells_the_pages(tmp_path, clock):
    cloud = scripted()
    rows = [
        arrives("achievement_progress", "[1]", {"status": "done", "source": "p", "updated_at": STAMP}),
        arrives("commission_log", '[2,"2026-10-13"]', {"at": STAMP, "source": "p"}),
        arrives("layouts", '["board"]', {"widgets": "[]", "revision": 1, "updated_at": STAMP}),
        arrives("pulls_accounts", "[700000001]", {"welkin": 1}),
        arrives("gift_codes", '["700000001","ABC"]', {"result": "ok", "primogems": 60, "source": "p", "at": STAMP}),
        arrives("char_focus", "[700000001,1]", {"character": "sandrone"}),
        arrives("sessions", '["a-session"]', {"started_at": STAMP, "ended_at": STAMP, "started_before_tool": 0}),
        arrives("timers", '["a-timer"]', {"preset": None, "name": "Teapot", "place": "", "rule": '{"kind":"hours","hours":24}', "steps": None, "bell": 1, "ready_override": None, "created_at": STAMP, "updated_at": STAMP}),
        arrives("settings", "commission_region", {"value": "inazuma"}),
    ]
    cloud.answers[SYNC_ROWS] = answer(200, rows)
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert bench.told == [{
        "achievements_changed", "layout_changed", "pulls_changed", "codes_changed", "characters_changed", "state_changed",
        "timers_changed", "settings_changed",
    }]
    assert bench.settings["commission_region"] == "inazuma"
    # The same rows once more change nothing, and nothing is told.
    await quiet(bench, 301)
    assert len(bench.told) == 1


def test_the_events_of_the_kinds():
    assert events_of({"achievement_progress", "commission_log", "settings"}) == {"achievements_changed", "settings_changed"}
    assert events_of({"nothing"}) == set()
    assert events_of(set()) == set()


async def test_a_pull_of_many_pages_goes_on_until_it_is_short(tmp_path, clock):
    def page(start: int, count: int) -> list[dict]:
        return [
            arrives("widget_data", f'["w{number:04}"]', {"data": "{}", "updated_at": STAMP}, f"2026-10-13T08:{number // 60:02}:{number % 60:02}.000000+00:00")
            for number in range(start, start + count)
        ]
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = [answer(200, page(0, 500)), answer(200, page(499, 300))]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 2
    assert bench.query(bench.sent("sync_rows")[1])["received_at"] == ["gte.2026-10-13T08:08:19.000000+00:00"]  # from the last row
    assert bench.store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 799
    assert bench.told == [{"layout_changed"}]


async def test_a_page_that_makes_no_progress_is_read_again_with_room(tmp_path, clock):
    # 500 rows that arrived in one call all carry one time: a page of 500 cannot move the cursor on, one of 1,000 can.
    same = [
        arrives("widget_data", f'["w{number:04}"]', {"data": "{}", "updated_at": STAMP}, STAMP) for number in range(500)
    ]
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = [answer(200, same), answer(200, same), answer(200, same[:1])]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    queries = [bench.query(index) for index in bench.sent("sync_rows")]
    assert [query["limit"] for query in queries] == [["500"], ["500"], ["1000"]]
    assert bench.store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 500


async def test_a_page_too_large_is_read_again_in_smaller_pages(tmp_path, clock):
    # A page is 500 rows whatever they hold, and a row may hold 256 KB: a page of large rows is more than an answer may be.
    rows = [arrives("widget_data", f'["w{n:03}"]', {"data": "{}", "updated_at": STAMP}, STAMP) for n in range(3)]
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = [ResponseTooLarge("the response is larger than allowed"), answer(200, rows)]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert [bench.query(index)["limit"] for index in bench.sent("sync_rows")] == [["500"], ["250"]]
    assert bench.store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 3
    assert bench.online.view()["offline"] is False


class Heavy(FakeCloud):
    """An account of rows that all arrived together, so large that an answer holds at most `fits` of them."""

    def __init__(self, rows: list[dict], fits: int) -> None:
        super().__init__({PROFILE: answer(200, [own_row()]), PUSH: answer(200, 1)})
        self.rows, self.fits = rows, fits

    def __call__(self, path, *, method="GET", headers=None, body=None, **kwargs):
        if method == "GET" and path.startswith(SYNC_ROWS[1]):
            self.requests.append((method, path, dict(headers or {}), body))
            query = parse_qs(path.split("?", 1)[1])
            limit, offset = int(query["limit"][0]), int(query.get("offset", ["0"])[0])
            if limit > self.fits:
                raise ResponseTooLarge("the response is larger than allowed")
            since = query.get("received_at", ["gte."])[0].removeprefix("gte.")
            held = [row for row in self.rows if row["received_at"] >= since]
            return 200, json.dumps(held[offset: offset + limit]).encode()
        return super().__call__(path, method=method, headers=headers, body=body, **kwargs)


async def test_large_rows_that_arrived_together_are_read_on_in_smaller_pages(tmp_path, clock):
    # 300 rows of one push, of which 100 fit an answer: a page of them cannot move the read on by their time, and a larger page
    # does not fit, so the next page goes on after the rows already read (the audit's CLD-4).
    rows = [arrives("widget_data", f'["w{n:03}"]', {"data": "{}", "updated_at": STAMP}, STAMP) for n in range(300)]
    cloud = Heavy(rows, fits=100)
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    queries = [bench.query(index) for index in bench.sent("sync_rows")]
    assert [query["limit"][0] for query in queries] == ["500", "250", "125", "62", "62", "62", "62", "62", "62"]
    assert [query.get("offset", ["0"])[0] for query in queries[4:]] == ["0", "62", "124", "186", "248"]
    assert bench.store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 300
    assert bench.online.view()["offline"] is False and bench.store.meta("sync_cursor") == STAMP


async def test_a_row_too_large_even_alone_is_a_server_that_did_not_answer(tmp_path, clock):
    # A row holds at most 256 KB and an answer 4 MB: one row that does not fit is no answer at all, and the cursor stays.
    cloud = Heavy([arrives("widget_data", '["w000"]', {"data": "{}", "updated_at": STAMP}, STAMP)], fits=0)
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert [bench.query(index)["limit"][0] for index in bench.sent("sync_rows")][-1] == "1"
    assert bench.online.view()["offline"] is True and bench.store.meta("sync_cursor") is None


def _widget_rows(store: Store, count: int) -> None:
    with store.applying_sync():
        for number in range(count):
            store._conn.execute(f"INSERT INTO widget_data (widget_id, data, updated_at) VALUES ('w{number:03}', '{{}}', '{STAMP}')")


async def test_a_pull_that_deletes_many_rows_backs_up_first(tmp_path, clock):
    # Keep this PC's data, pressed on another PC, sends a delete for every row that PC lacks, and this PC keeps them all on its
    # next pull: what goes is in a copy first (the audit's CLD-3), as Use the account's data makes one.
    store = Store.open(tmp_path / "db" / "guildboard.db", tmp_path / "backups", NOW)
    try:
        _widget_rows(store, 50)
        cloud = scripted()
        cloud.answers[SYNC_ROWS] = answer(200, [arrives("widget_data", f'["w{n:03}"]', {}, deleted=True) for n in range(50)])
        bench = Bench(tmp_path, clock, cloud, store=store)
        await bench.online.sync_turn()
        assert store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 0
        [backup] = list((tmp_path / "backups").glob("guildboard-auto-sync-*.db"))
        old = sqlite3.connect(backup)
        try:
            assert old.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 50
        finally:
            old.close()
    finally:
        store.close()


async def test_a_copy_that_cannot_be_made_does_not_stop_the_pull_for_good(tmp_path, clock, monkeypatch):
    # A full disk, say: every pull would fail at the same place, and the account would never be read again. The daily copy stays.
    store = Store.open(tmp_path / "db" / "guildboard.db", tmp_path / "backups", NOW)
    try:
        _widget_rows(store, 50)

        def full(label, now):
            raise OSError("the disk is full")

        monkeypatch.setattr(store, "backup_before", full)
        cloud = scripted()
        cloud.answers[SYNC_ROWS] = answer(200, [arrives("widget_data", f'["w{n:03}"]', {}, deleted=True) for n in range(50)])
        bench = Bench(tmp_path, clock, cloud, store=store)
        await bench.online.sync_turn()
        assert store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 0
        assert store.meta("sync_cursor") == STAMP and bench.online.view()["offline"] is False
    finally:
        store.close()


async def test_a_pull_with_a_few_deletes_or_deletes_of_nothing_makes_no_copy(tmp_path, clock):
    # Rows deleted one at a time on another PC are what sync is for; and a delete of a row that is not here deletes nothing.
    store = Store.open(tmp_path / "db" / "guildboard.db", tmp_path / "backups", NOW)
    try:
        _widget_rows(store, 5)
        cloud = scripted()
        cloud.answers[SYNC_ROWS] = answer(200, [arrives("widget_data", f'["w{n:03}"]', {}, deleted=True) for n in range(100)])
        bench = Bench(tmp_path, clock, cloud, store=store)
        await bench.online.sync_turn()
        assert store._conn.execute("SELECT COUNT(*) FROM widget_data").fetchone()[0] == 0
        assert list((tmp_path / "backups").glob("guildboard-auto-sync-*.db")) == []
    finally:
        store.close()


async def test_a_pull_that_fails_leaves_the_cursor(tmp_path, clock):
    cloud = scripted()
    row = arrives("layouts", '["board"]', {"widgets": "[]", "revision": 1, "updated_at": STAMP})
    cloud.answers[SYNC_ROWS] = [answer(200, [row]), answer(503)]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    cursor = bench.store.meta("sync_cursor")
    await quiet(bench, 301)
    assert bench.store.meta("sync_cursor") == cursor
    assert bench.online.view()["offline"] is True


async def test_a_row_that_was_changed_here_and_not_sent_is_not_replaced_by_an_older_one(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)  # a change here, not yet sent
    old = arrives("layouts", '["board"]', {"widgets": "[9]", "revision": 5, "updated_at": STAMP}, "2020-01-01T00:00:00.000000+00:00")
    cloud.answers[SYNC_ROWS] = answer(200, [old])
    await bench.online.sync_turn()
    assert bench.store.layout("board").widgets == "[]" and bench.told == []


# ------------------------------------------------------------------------------------------------------- the server's clock
PHONE = json.dumps([{"id": "phone-clock", "type": "clock", "w": 2, "h": 1, "settings": {}}])  # the Board the phone sent


def _moved(stamp: str, seconds: float) -> str:
    return (datetime.fromisoformat(stamp) + timedelta(seconds=seconds)).isoformat(timespec="milliseconds")


async def test_a_pc_whose_clock_is_ahead_does_not_bury_a_later_edit(tmp_path, clock):
    # This PC's clock is 30 seconds ahead of the server's. The Board was changed here, and ten seconds later on the phone: the
    # phone's edit is stamped 20 seconds before this PC's line, and it is the later one all the same. This PC sets its stamps
    # by the server's clock (the Date of its answers), so the phone's Board is kept here, and the line that goes up says when
    # it was made by the server's clock, so the account keeps the phone's Board as well.
    cloud = scripted(server_clock=lambda: time.time() - 30)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    [line] = bench.store.sync_outbox(10)
    phone = arrives(
        "layouts", '["board"]', {"widgets": PHONE, "revision": 3, "updated_at": STAMP}, edited_at=_moved(line.edited_at, -20),
    )
    cloud.answers[SYNC_ROWS] = answer(200, [phone])
    await bench.online.sync_turn()
    assert bench.store.layout("board").widgets == PHONE
    await quiet(bench)
    [row] = bench.pushed()
    sent = datetime.fromisoformat(row["edited_at"])
    assert row["edited_at"].endswith("Z") and sent < datetime.fromisoformat(phone["edited_at"])
    assert abs((sent - datetime.fromisoformat(line.edited_at)).total_seconds() + 30) <= 1.5


async def test_a_pc_whose_clock_is_off_by_more_than_a_minute_syncs_nothing_and_says_so(tmp_path, clock):
    # Its stamps, of edits made at any time with any clock, cannot be set right after the fact: nothing moves until the clock
    # is right again, and Settings says why.
    import guildboard.cloud.service as service

    cloud = scripted(server_clock=lambda: time.time() + 3600)  # the server's clock is an hour ahead of this PC's
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    assert bench.online.view()["message"] == service.CLOCK_OFF
    assert (await bench.online.sync_now())["message"] == service.CLOCK_OFF  # Sync now looks at the clock again, and waits
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    assert len(bench.store.sync_outbox(10)) == 1  # the change waits
    cloud.server_clock = time.time  # the player set the clock right
    view = await bench.online.sync_now()
    assert len(bench.sent("sync_rows")) == 1 and len(bench.sent("sync_push")) == 1
    assert view["message"] is None and bench.store.sync_outbox(10) == []


# ------------------------------------------------------------------------------------------------------ when it stays quiet
async def test_sync_my_data_off_stops_both_ways(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted(), on=False)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    await quiet(bench, 301)
    assert bench.cloud.requests == []  # not a request, not even a look at the profile
    assert (await bench.online.sync_now())["sync"]["on"] is False
    assert bench.cloud.requests == []
    assert len(bench.store.sync_outbox(10)) == 1  # the change waits

    bench.on = True
    await bench.online.sync_turn()
    await quiet(bench)
    assert len(bench.sent("sync_rows")) == 1 and len(bench.sent("sync_push")) == 1
    assert bench.store.sync_outbox(10) == []


async def test_signed_out_nothing_syncs_and_the_outbox_waits(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted(), signed_in=False)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    await quiet(bench, 301)
    assert bench.cloud.requests == []
    assert bench.online.view()["sync"] is None
    bench.store._conn.execute("UPDATE layouts SET revision = 3")
    assert len(bench.store.sync_outbox(10)) == 1
    assert (await bench.online.sync_now())["sync"] is None
    assert bench.cloud.requests == []


async def test_another_game_account_does_not_sync(tmp_path, clock):
    # Two game accounts must never mix on one Guild Board account (the plan's Review Focus 5): the account holds the UID of
    # the first PC to sign in, and a PC with another one says so and moves nothing.
    cloud = scripted()
    cloud.answers[PROFILE] = answer(200, [own_row(uid=700000001)])
    bench = Bench(tmp_path, clock, cloud, uid=800000002)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    await quiet(bench, 301)
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    view = bench.online.view()
    assert "another game account" in view["message"]
    assert view["sync"]["on"] is True
    assert (await bench.online.sync_now())["message"] == view["message"]
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    assert len(bench.store.sync_outbox(10)) == 1


@pytest.mark.parametrize("unread", [
    answer(429, {"message": "Too many requests"}),  # a refusal, which _guarded lets the others go on from
    answer(200, [{"name": ""}]),                    # a row that cannot be read, which leaves the profile unknown too
], ids=["refused", "unreadable"])
async def test_a_profile_that_was_not_read_moves_nothing(tmp_path, clock, unread):
    # A UID that nobody knows yet is one thing, and an account that did not answer is another: it may hold any game account.
    cloud = scripted()
    cloud.answers[PROFILE] = [unread, answer(200, [own_row(uid=700000001)])]
    cloud.answers[SYNC_ROWS] = answer(200, [arrives("layouts", '["board"]', {"widgets": "[7]", "revision": 3, "updated_at": STAMP})])
    bench = Bench(tmp_path, clock, cloud, uid=800000002)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    assert bench.online.view()["message"] is None  # nothing is known yet to say
    await quiet(bench, 301)
    assert "another game account" in bench.online.view()["message"]  # and now it is the right reason
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    assert bench.told == [] and len(bench.store.sync_outbox(10)) == 1


async def test_the_answer_to_the_question_goes_through_the_same_gate(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PROFILE] = answer(429, {"message": "Too many requests"})
    bench = Bench(tmp_path, clock, cloud, uid=800000002)
    bench.store.set_meta("sync_first", "asking")
    bench.store._conn.execute(LAYOUT)
    view = await bench.online.first_sync("use")
    assert view["sync"]["needs_choice"] is True
    assert bench.sent("sync_rows") == [] and bench.store.layout("board") is not None  # nothing was replaced


async def test_a_pc_logged_out_of_hoyolab_still_holds_its_game_account(tmp_path, clock):
    # A folder belongs to the game account of its first login (auth.py): without a login now it is that account all the same.
    cloud = scripted()
    cloud.answers[PROFILE] = answer(200, [own_row(uid=700000001)])
    bench = Bench(tmp_path, clock, cloud, folder_uid=800000002)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.sent("sync_rows") == [] and bench.sent("sync_push") == []
    assert "another game account" in bench.online.view()["message"]


async def test_a_refused_first_look_waits_and_the_wait_ends(tmp_path, clock):
    # A project without 0003 answers 404: a refusal says nothing of the server, so nothing else would hold the five-second loop back.
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = [answer(404, {"code": "PGRST205", "message": "Could not find the table"}), answer(200, [])]
    bench = Bench(tmp_path, clock, cloud, settled=False)
    await bench.online.sync_turn()
    for _ in range(50):
        await quiet(bench, 5)
    assert len(bench.sent("sync_rows")) == 1
    assert bench.online.view()["offline"] is False
    await quiet(bench, 60)
    assert bench.store.meta("sync_first") == "done"  # asked again, once, and it goes on from there


async def test_a_refused_profile_read_waits_and_the_wait_ends(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PROFILE] = [answer(429, {"message": "Too many requests"}), answer(200, [own_row()])]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    for _ in range(50):
        await quiet(bench, 5)
    assert len(bench.sent("profiles")) == 1
    await quiet(bench, 60)
    assert len(bench.sent("profiles")) == 2 and bench.sent("sync_rows")


async def test_sync_now_does_not_wait_for_a_look_that_was_refused(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PROFILE] = [answer(429, {"message": "Too many requests"}), answer(200, [own_row()])]
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert bench.sent("sync_rows") == []
    await bench.online.sync_now()  # the player pressed it
    assert bench.sent("sync_rows")


@pytest.mark.parametrize("local, held", [(700000001, 700000001), (None, 700000001), (700000001, None), (None, None)])
async def test_the_same_game_account_or_one_not_known_yet_syncs(tmp_path, clock, local, held):
    cloud = scripted()
    cloud.answers[PROFILE] = answer(200, [own_row(uid=held)])
    bench = Bench(tmp_path, clock, cloud, uid=local)
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 1
    assert bench.online.view()["message"] is None


async def test_the_account_changing_hands_stops_the_sync_at_once(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud, uid=700000001)
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 1
    bench.facts = {"uid": 800000002, "ar": 58, "picture_url": None}  # the player logs in to HoYoLAB as another account
    cloud.answers[PROFILE] = answer(200, [own_row(uid=700000001)])
    await bench.online.look()
    await quiet(bench, 301)
    assert len(bench.sent("sync_rows")) == 1


async def test_another_online_account_starts_from_nothing(tmp_path, clock):
    # The cursor is how far one account's rows were read: another account's may be older than that.
    bench = Bench(tmp_path, clock, scripted())
    bench.store.set_meta("sync_account", "00000000-0000-0000-0000-0000000000ff")
    bench.store.set_meta("sync_cursor", STAMP)
    bench.store.set_meta("sync_last_at", "2026-10-01T00:00:00+00:00")
    await bench.online.sync_turn()
    assert "received_at" not in bench.query(bench.sent("sync_rows")[0])
    assert bench.store.meta("sync_account") == USER_ID and bench.store.meta("sync_cursor") is None

    # The same account again keeps its cursor.
    again = Bench(tmp_path / "second", clock, scripted()) if (tmp_path / "second").mkdir() is None else None
    again.store.set_meta("sync_account", USER_ID)
    again.store.set_meta("sync_cursor", STAMP)
    await again.online.sync_turn()
    assert again.query(again.sent("sync_rows")[0])["received_at"] == ["gte.2026-10-13T07:59:00.123456+00:00"]


async def test_signing_out_and_in_reads_the_account_at_once(tmp_path, clock):
    cloud = scripted()
    cloud.answers[("POST", "/auth/v1/logout")] = answer(204)
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 1
    await bench.online.sign_out()
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 1  # signed out: nothing
    bench.cloud_store.save(CloudSession(
        "ACCESS-2-0123456789", "REFRESH-2-0123456789", clock.now().timestamp() + 365 * 86_400, USER_ID, "Nova", "5120"
    ))
    bench.online._start_afresh()  # what a finished sign-in does
    await bench.online.sync_turn()
    assert len(bench.sent("sync_rows")) == 2  # and not five minutes after the last read


async def test_the_page_hears_when_the_time_of_the_last_sync_changes(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    heard_events = bench.online._bus.subscribe()
    await bench.online.sync_turn()
    assert [event["type"] for event in list(heard_events._queue)] == ["online_changed"]
    assert bench.online.view()["sync"]["last_at"] == clock.now().isoformat()


async def test_a_lost_session_ends_the_sync(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    cloud.answers[PROFILE] = answer(200, [])  # the account is gone: the session has nothing behind it
    await bench.online.look()
    assert bench.online.view()["state"] == "sign_in_again"
    sent = len(cloud.requests)
    bench.store._conn.execute(LAYOUT)
    await quiet(bench)
    await quiet(bench, 301)
    assert len(cloud.requests) == sent
    assert bench.online.view()["sync"] is None


async def test_the_server_away_ends_the_look_for_five_minutes(tmp_path, clock):
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = answer(503)
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    await quiet(bench, 120)
    await quiet(bench, 120)
    assert len(bench.sent("sync_rows")) == 1
    assert bench.store.sync_outbox(10) == []
    await quiet(bench, 120)
    assert len(bench.sent("sync_rows")) == 2


async def test_nothing_is_pushed_before_the_pull_has_answered(tmp_path, clock):
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = answer(503)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.sent("sync_push") == []


async def test_the_loop_drives_the_sync_while_signed_in(tmp_path, clock):
    from test_cloud_loop import Enough

    cloud = scripted()
    cloud.answers[("POST", "/rest/v1/rpc/friends_overview")] = answer(200, {"friends": [], "incoming": [], "outgoing": []})
    cloud.answers[("POST", "/rest/v1/rpc/heartbeat")] = answer(204)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    looks = 0

    async def spin(seconds: float) -> None:
        nonlocal looks
        looks += 1
        if looks > 30:
            raise Enough
        clock.advance(seconds=seconds)
        await asyncio.sleep(0)

    bench.online._sleep = spin
    with pytest.raises(Enough):
        await bench.online.run()
    assert len(bench.sent("sync_push")) == 1 and len(bench.sent("sync_rows")) >= 1
    assert bench.store.sync_outbox(10) == []


async def test_a_look_that_fails_does_not_end_the_sync_loop(tmp_path, clock):
    from test_cloud_loop import Enough

    cloud = scripted()
    cloud.answers[("POST", "/rest/v1/rpc/friends_overview")] = answer(200, {"friends": [], "incoming": [], "outgoing": []})
    cloud.answers[("POST", "/rest/v1/rpc/heartbeat")] = answer(204)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    real, calls, looks = bench.online.sync_turn, [], 0

    async def flaky() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("a bug in a look")
        await real()

    async def spin(seconds: float) -> None:
        nonlocal looks
        looks += 1
        if looks > 30:
            raise Enough
        clock.advance(seconds=seconds)
        await asyncio.sleep(0)

    bench.online.sync_turn = flaky
    bench.online._sleep = spin
    with pytest.raises(Enough):
        await bench.online.run()
    assert len(calls) > 3 and len(bench.sent("sync_push")) == 1


async def test_stopping_the_loop_stops_the_sync_loop_too(tmp_path, clock):
    cloud = scripted()
    cloud.answers[("POST", "/rest/v1/rpc/friends_overview")] = answer(200, {"friends": [], "incoming": [], "outgoing": []})
    cloud.answers[("POST", "/rest/v1/rpc/heartbeat")] = answer(204)
    bench = Bench(tmp_path, clock, cloud)
    forever, parked = asyncio.Event(), []

    async def park(seconds: float) -> None:
        parked.append(seconds)
        await forever.wait()

    bench.online._sleep = park
    task = asyncio.create_task(bench.online.run())
    for _ in range(500):  # both loops reach their sleep
        if len(parked) >= 2:
            break
        await asyncio.sleep(0.01)
    assert len(parked) == 2
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()] == []


# ------------------------------------------------------------------------------------------------------------ the settings
def test_what_syncs_of_the_settings_is_what_is_not_about_this_pc():
    assert SYNCED_SETTINGS == (
        "commission_region", "fishing_rule", "notifications", "characters_notice_weekly", "characters_notice_domain",
        "characters_notice_ready", "spending_currency", "spending_prices",
    )


async def test_a_setting_goes_up_as_a_row_of_its_own(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.settings["commission_region"] = "inazuma"
    bench.store.sync_queue("settings", "commission_region")
    bench.store.sync_queue("settings", "overlay_display")  # a line for a setting that stays on this PC is not sent
    bench.store.sync_queue("settings", "nonsense")
    await bench.online.sync_turn()
    await quiet(bench)
    [row] = bench.pushed()
    assert (row["kind"], row["row_key"], row["data"], row["deleted"]) == ("settings", "commission_region", {"value": "inazuma"}, False)
    assert bench.store.sync_outbox(10) == []


async def test_a_setting_from_another_pc_is_kept_only_when_it_is_one_that_syncs_and_newer(tmp_path, clock):
    cloud = scripted()
    rows = [
        arrives("settings", "fishing_rule", {"value": "next_reset"}),
        arrives("settings", "overlay_display", {"value": "\\\\.\\DISPLAY9"}),
        arrives("settings", "gallery_folder", {"value": "C:\\Games"}),
        arrives("settings", "overlay_hotkey", {"value": "Ctrl+Alt+K"}),
        arrives("settings", "spending_currency", {"value": "EUR"}),
        arrives("settings", "notifications", {"value": ["not", "a", "bool"]}),
        arrives("settings", "characters_notice_weekly", {}),
        arrives("settings", "characters_notice_ready", {"value": False}, deleted=True),
    ]
    cloud.answers[SYNC_ROWS] = answer(200, rows)
    bench = Bench(tmp_path, clock, cloud)
    bench.store.sync_queue("settings", "spending_currency")  # changed here, later than the row that came
    await bench.online.sync_turn()
    assert bench.settings == {"commission_region": "liyue", "spending_currency": "PLN", "notifications": True, "fishing_rule": "next_reset"}
    assert bench.told == [{"settings_changed"}]


async def test_nothing_but_the_players_rows_goes_up(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    for kind, (insert, *_) in CASES.items():
        bench.store._conn.execute(insert)
    bench.store.sync_queue("settings", "fishing_rule")
    await bench.online.sync_turn()
    await quiet(bench)
    sent = bench.pushed()
    assert {row["kind"] for row in sent} == set(CASES) | {"settings"}
    text = json.dumps(sent)
    assert "ACCESS-0123456789" not in text and "REFRESH-0123456789" not in text
    assert not any(column in row["data"] for row in sent for column in ("id", "notified", "notified_ready_at"))


# ---------------------------------------------------------------------------------------------------- the core's side
from guildboard.config import AppPaths, load_settings  # noqa: E402
from guildboard.core import Core  # noqa: E402
from support import AccountSource  # noqa: E402


def make_core(tmp_path, clock, cloud: FakeCloud) -> Core:
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    CloudStore(paths.cloud_path).save(
        CloudSession("ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 365 * 86_400, USER_ID, "Nova", "5120")
    )
    return Core(
        paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
        cloud_fetch=cloud, open_browser=lambda address: None,
    )


def heard(queue) -> list[str]:
    found = []
    while not queue.empty():
        found.append(queue.get_nowait()["type"])
    return found


def test_sync_my_data_is_on_until_the_player_turns_it_off(tmp_path, clock):
    core = make_core(tmp_path, clock, scripted())
    try:
        assert core.settings.sync_my_data is True
        core.update_settings({"sync_my_data": False})
        assert load_settings(core.paths.settings_path).sync_my_data is False
        assert core.online.view()["sync"]["on"] is False
        core.update_settings({"sync_my_data": "yes"})  # anything but a plain true or false is refused
        assert core.settings.sync_my_data is False
        assert core.store.sync_outbox(10) == []  # the switch is about this PC: it is not a row
    finally:
        core.store.close()


def test_a_setting_about_this_pc_never_goes_up(tmp_path, clock):
    core = make_core(tmp_path, clock, scripted())
    try:
        core.update_settings({
            "overlay_display": "DISPLAY2", "gallery_folder": "D:/Games/ScreenShot", "gallery_enabled": True,
            "overlay_hotkey": "Ctrl+Alt+H", "overlay_opacity": 80, "overlay_pinned": False, "overlay_lines": False,
            "overlay_size": 150, "start_with_windows": True, "in_session_interval_min": 30, "picture_quality": "low",
            "tray_hint_shown": True, "risk_acknowledged": True, "sync_my_data": False,
        })
        assert core.store.sync_outbox(100) == []
        assert core.settings.overlay_display == "DISPLAY2" and core.settings.overlay_hotkey == "Ctrl+Alt+H"
    finally:
        core.store.close()


def test_a_setting_that_is_not_about_this_pc_leaves_a_line_when_it_changes(tmp_path, clock):
    core = make_core(tmp_path, clock, scripted())
    try:
        core.update_settings({"commission_region": "liyue", "fishing_rule": "3_days"})  # what they already are
        assert core.store.sync_outbox(10) == []
        core.update_settings({"commission_region": "inazuma", "notifications": False, "spending_currency": "EUR"})
        assert sorted((line.kind, line.row_key) for line in core.store.sync_outbox(10)) == [
            ("settings", "commission_region"), ("settings", "notifications"), ("settings", "spending_currency"),
        ]
        core.update_settings({"commission_region": "inazuma"})  # and again as it is
        assert len(core.store.sync_outbox(10)) == 3
    finally:
        core.store.close()


def test_a_setting_that_came_is_kept_as_the_player_could_have_set_it(tmp_path, clock):
    core = make_core(tmp_path, clock, scripted())
    try:
        assert core.apply_synced_setting("commission_region", "inazuma") is True
        assert core.settings.commission_region == "inazuma"
        assert load_settings(core.paths.settings_path).commission_region == "inazuma"
        assert core.apply_synced_setting("commission_region", "inazuma") is False  # no change
        for name, value in (
            ("commission_region", "atlantis"), ("commission_region", ["inazuma"]), ("notifications", "yes"),
            ("spending_currency", "BTC"), ("spending_prices", "free"), ("fishing_rule", None),
            ("overlay_display", "DISPLAY9"), ("gallery_folder", "C:/x"), ("overlay_hotkey", "Ctrl+Alt+K"),
            ("sync_my_data", False), ("nonsense", 1), ("__class__", 1),
        ):
            assert core.apply_synced_setting(name, value) is False, (name, value)
        assert core.settings.commission_region == "inazuma" and core.settings.notifications is True
        assert core.settings.overlay_display == "" and core.settings.sync_my_data is True
        assert core.store.sync_outbox(10) == []  # nothing that came is sent back
    finally:
        core.store.close()


async def test_rows_from_the_account_reach_the_store_the_settings_and_the_pages(tmp_path, clock):
    cloud = scripted()
    cloud.answers[SYNC_ROWS] = answer(200, [
        arrives("achievement_progress", "[1402]", {"status": "done", "done_at": STAMP, "pinned": 0, "note": "", "source": "phone", "updated_at": STAMP}),
        arrives("layouts", '["board"]', {"widgets": "[]", "revision": 4, "updated_at": STAMP}),
        arrives("sessions", '["a-session"]', {"started_at": STAMP, "ended_at": STAMP, "started_before_tool": 0}),
        arrives("settings", "commission_region", {"value": "inazuma"}),
        arrives("settings", "notifications", {"value": "yes"}),
    ])
    core = make_core(tmp_path, clock, cloud)
    try:
        queue = core.bus.subscribe()
        await core.online.sync_turn()
        assert core.store.progress()[1402].status == "done"
        assert core.store.layout("board").revision == 5
        assert core.settings.commission_region == "inazuma" and core.settings.notifications is True
        assert load_settings(core.paths.settings_path).commission_region == "inazuma"
        assert sorted(heard(queue)) == sorted([
            "achievements_changed", "layout_changed", "layout_changed", "state_changed", "settings_changed", "online_changed",
        ])  # the layout of each place is read again, and Settings hears of the time of the sync
        assert core.store.sync_outbox(10) == []
        assert core.online.view()["sync"]["last_at"] == clock.now().isoformat()
    finally:
        core.store.close()


async def test_what_the_player_changes_goes_up_through_the_core(tmp_path, clock):
    core = make_core(tmp_path, clock, scripted())
    try:
        core.store.set_meta("sync_account", USER_ID)  # the first sync is over (tests/test_cloud_first_sync.py)
        core.store.set_meta("sync_first", "done")
        core.store.put_layout("board", "[]", 1, clock.now())
        core.update_settings({"fishing_rule": "next_reset"})
        await core.online.sync_turn()
        clock.advance(seconds=11)
        await core.online.sync_turn()
        cloud = core.online._client._fetch
        rows = [row for index, line in enumerate(cloud.sent()) if "sync_push" in line for row in cloud.body(index)["p_rows"]]
        assert sorted((row["kind"], row["row_key"]) for row in rows) == [("layouts", '["board"]'), ("settings", "fishing_rule")]
        assert [row["data"] for row in rows if row["kind"] == "settings"] == [{"value": "next_reset"}]
        assert core.store.sync_outbox(10) == []
    finally:
        core.store.close()


def test_the_demo_syncs_nothing(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "demo"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core.online.view()["sync"] is None
        assert asyncio.run(core.online.sync_now())["sync"] is None
    finally:
        core.store.close()


def test_the_game_account_of_the_folder_reaches_sync(tmp_path, clock):
    core = make_core(tmp_path, clock, scripted())
    try:
        core.store.set_meta("account_uid", "800000002")
        assert core.online._local.sync.uid() == 800000002
    finally:
        core.store.close()


def test_a_fresh_core_has_nothing_to_send(tmp_path, clock):
    # Its default pre-set timers are the app's rows and not the player's change: a new PC that has only these has no data of
    # its own, and takes the account's without asking (Task C5).
    core = make_core(tmp_path, clock, scripted())
    try:
        assert core.store.timers() != []
        assert core.store.sync_outbox(10) == []
    finally:
        core.store.close()


class Slow(FakeCloud):
    """A server that takes a moment, and counts how many reads of the account are on their way at once."""

    def __init__(self, answers):
        super().__init__(answers)
        self.active = self.most = 0

    def __call__(self, path, **kwargs):
        if "sync_rows" in path:
            self.active += 1
            self.most = max(self.most, self.active)
            time.sleep(0.05)
            self.active -= 1
        return super().__call__(path, **kwargs)


async def test_a_look_and_a_press_of_sync_now_do_not_read_the_account_at_once(tmp_path, clock):
    cloud = Slow({PROFILE: answer(200, [own_row()]), SYNC_ROWS: answer(200, []), PUSH: answer(200, 1)})
    bench = Bench(tmp_path, clock, cloud)
    await asyncio.gather(bench.online.sync_turn(), bench.online.sync_now(), bench.online.sync_now())
    assert cloud.most == 1
    assert len(bench.sent("sync_rows")) >= 1
