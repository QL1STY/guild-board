"""How much room the player's copy takes (0005's sync_usage): read after a sync that moved rows and on no timer of its own, shown
in the online view, and a failure of reading it changes nothing else. A project with no places left refuses a first push with a
sentence of its own."""
import pytest

from cloud_fakes import USAGE, USAGE_ROW, answer
from guildboard.cloud.models import SENTENCES
from test_cloud_sync import LAYOUT, PUSH, SYNC_ROWS, Bench, arrives, quiet, scripted

SEATS_FULL = "All the places for syncing are taken right now. Your data stays on this PC, and friends and stats still work."
SHOWN = {"rows_held": 1_911, "rows_limit": 20_000, "bytes_held": 722_000, "bytes_limit": 4_194_304, "has_place": True, "seats_full": False}


def test_the_sentence_for_no_free_place_is_the_players_to_read():
    assert SENTENCES["sync_seats_full"] == SEATS_FULL


async def test_the_usage_is_read_once_when_a_session_has_its_first_look(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    assert bench.online.view()["usage"] is None  # nothing has been read yet
    await bench.online.sync_turn()  # the first look and the first pull: nothing comes and nothing waits to go
    assert bench.online.view()["usage"] == SHOWN
    assert bench.cloud.usage_reads == 1


async def test_a_push_that_sent_rows_reads_the_usage(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.sent("sync_push")
    assert bench.online.view()["usage"] == SHOWN
    assert bench.cloud.usage_reads >= 1


async def test_a_pull_that_brought_rows_reads_the_usage(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    await bench.online.sync_turn()
    await quiet(bench, 301)  # a pull that brings nothing reads nothing
    assert bench.cloud.usage_reads == 1
    cloud.answers[SYNC_ROWS] = answer(200, [arrives("settings", "commission_region", {"value": "inazuma"})])
    cloud.answers[USAGE] = answer(200, [{**USAGE_ROW, "rows_held": 1_912}])
    await quiet(bench, 301)
    assert bench.settings["commission_region"] == "inazuma"
    assert bench.online.view()["usage"]["rows_held"] == 1_912


async def test_nothing_reads_it_again_while_nothing_moves(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    reads = bench.cloud.usage_reads
    for _ in range(12):  # an hour of turns, five minutes of pulls among them, and no change of the player's
        await quiet(bench, 301)
    assert bench.cloud.usage_reads == reads  # no timer of its own


async def test_a_new_change_reads_it_again_and_shows_the_new_numbers(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    cloud.answers[USAGE] = answer(200, [{**USAGE_ROW, "rows_held": 2_000, "bytes_held": 800_000}])
    bench.store._conn.execute("UPDATE layouts SET revision = 2")
    await quiet(bench)
    await quiet(bench)
    assert bench.online.view()["usage"]["rows_held"] == 2_000


async def test_sync_now_reads_it_after_a_push(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    view = await bench.online.sync_now()
    assert view["usage"] == SHOWN


async def test_a_project_without_the_function_has_no_usage_and_nothing_else_changes(tmp_path, clock):
    cloud = scripted()
    cloud.answers[USAGE] = answer(404, {
        "code": "PGRST202", "message": "Could not find the function public.sync_usage without parameters in the schema cache",
        "details": None, "hint": None,
    })
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    view = bench.online.view()
    assert view["usage"] is None
    assert view["message"] is None and view["offline"] is False and view["state"] == "signed_in"
    assert bench.store.sync_outbox(10) == []  # the push itself went through


async def test_a_failed_read_keeps_what_was_known_and_changes_nothing_else(tmp_path, clock):
    cloud = scripted()
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    cloud.answers[USAGE] = answer(503)
    bench.store._conn.execute("UPDATE layouts SET revision = 2")
    await quiet(bench)
    await quiet(bench)
    view = bench.online.view()
    assert view["usage"] == SHOWN
    assert view["offline"] is False and view["message"] is None  # a read that failed says nothing of the server
    assert bench.store.sync_outbox(10) == []


@pytest.mark.parametrize("body", [
    None, [], {}, "x", [{"rows_held": 1}], [{**USAGE_ROW, "rows_held": "many"}], [{**USAGE_ROW, "has_place": 1}],
    [{**USAGE_ROW, "bytes_limit": -1}], [{**USAGE_ROW, "rows_held": True}], [USAGE_ROW, USAGE_ROW],
])
async def test_an_answer_that_is_not_usage_is_no_usage(tmp_path, clock, body):
    cloud = scripted()
    cloud.answers[USAGE] = answer(200, body)
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.online.view()["usage"] is None


async def test_a_first_push_with_no_place_free_says_so_keeps_the_outbox_and_waits(tmp_path, clock):
    cloud = scripted()
    cloud.answers[PUSH] = [answer(400, {"code": "P0001", "message": "sync_seats_full"}), answer(200, 1)]
    bench = Bench(tmp_path, clock, cloud)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.online.view()["message"] == SEATS_FULL
    assert len(bench.store.sync_outbox(10)) == 1
    for _ in range(8):  # a refusal says nothing of the server, and the same call is not made again at once
        await quiet(bench, 30)
    assert len(bench.sent("sync_push")) == 1
    await quiet(bench, 120)
    assert len(bench.sent("sync_push")) == 2
    assert bench.store.sync_outbox(10) == []
    assert bench.online.view()["message"] is None


async def test_signing_out_forgets_the_usage(tmp_path, clock):
    bench = Bench(tmp_path, clock, scripted())
    bench.cloud.answers[("POST", "/auth/v1/logout")] = answer(204)
    bench.store._conn.execute(LAYOUT)
    await bench.online.sync_turn()
    await quiet(bench)
    assert bench.online.view()["usage"] == SHOWN
    await bench.online.sign_out()
    assert bench.online.view()["usage"] is None
