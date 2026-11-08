import asyncio
from dataclasses import replace

import pytest

from guildboard.records import (
    GROUPS,
    DataSwitchOff,
    FetchResult,
    LoginNeeded,
    Offline,
    RateLimited,
    RawResponse,
    VerificationNeeded,
)
from guildboard.metrics import Point, month_key
from guildboard.sync.runner import SyncRunner
from support import FakeSleep, FakeSource, ok_result


@pytest.fixture
def source() -> FakeSource:
    return FakeSource()


@pytest.fixture
def sleep(clock) -> FakeSleep:
    return FakeSleep(clock)


@pytest.fixture
def runner(source, store, clock, sleep) -> SyncRunner:
    return SyncRunner(source, store, clock, lambda: "os_euro", sleep)


async def test_a_clean_run_stores_everything(runner, store, clock):
    result = await runner.run("manual", GROUPS)
    assert (result.outcome, result.state, result.message) == ("ok", "ok", None)
    assert result.groups_ok == GROUPS
    assert result.groups_failed == ()
    assert store.latest_point_value("stats.achievements") is not None
    assert all(state.last_ok_at == clock.now() and not state.needs_retry for state in store.group_states().values())
    row = store.recent_runs()[0]
    assert (row.id, row.trigger, row.outcome, row.error_kind) == (result.run_id, "manual", "ok", None)
    for group in GROUPS:
        assert store.raw_bodies(group) == [{"group": group}]


async def test_what_follows_a_stored_group_is_told_of_it_and_never_costs_it(source, store, clock, sleep):
    # The endgame's cycles are made after its group is stored (the Stats design, 3.5): a failure there is logged only.
    told: list[tuple[str, object]] = []

    def after(group, at):
        told.append((group, at))
        raise RuntimeError("made up")

    source.will("notes", DataSwitchOff("Switched off."))
    runner = SyncRunner(source, store, clock, lambda: "os_euro", sleep, after_group=after)
    result = await runner.run("manual", ("overview", "notes", "endgame"))
    assert result.groups_ok == ("overview", "endgame")
    assert told == [("overview", clock.now()), ("endgame", clock.now())]  # never a group that failed


async def test_only_the_requested_groups_are_fetched(runner, source):
    result = await runner.run("manual", ("overview", "notes"))
    assert [call[0] for call in source.calls] == ["overview", "notes"]
    assert result.groups_ok == ("overview", "notes")


async def test_offline_is_retried_with_growing_pauses(runner, source, sleep, clock):
    source.will("overview", Offline("No connection."), Offline("No connection."), ok_result("overview", clock.now()))
    result = await runner.run("manual", ("overview",))
    assert sleep.calls == [10.0, 30.0]
    assert result.outcome == "ok"


async def test_offline_after_all_retries_stops_the_run(runner, source, sleep, store):
    source.will("overview", Offline("No connection."))
    result = await runner.run("startup", GROUPS)
    assert sleep.calls == [10.0, 30.0, 90.0]
    assert [call[0] for call in source.calls] == ["overview"] * 4
    assert (result.outcome, result.state, result.message) == ("failed", "offline", "No connection.")
    assert result.groups_failed == GROUPS
    assert all(state.needs_retry for state in store.group_states().values())
    assert store.recent_runs()[0].error_kind == "offline"


async def test_verification_request_stops_at_once(runner, source, sleep, store):
    source.will("notes", VerificationNeeded("HoYoLAB asked for a verification check."))
    result = await runner.run("manual", GROUPS)
    assert sleep.calls == []
    assert [call[0] for call in source.calls] == ["overview", "notes"]
    assert (result.outcome, result.state) == ("partial", "verification_needed")
    assert result.groups_ok == ("overview",)
    assert result.groups_failed == GROUPS[1:]
    states = store.group_states()
    assert not states["overview"].needs_retry
    assert all(states[group].needs_retry for group in GROUPS[1:])


async def test_login_needed_stops_at_once(runner, source, sleep):
    source.will("overview", LoginNeeded("HoYoLAB no longer accepts the saved login."))
    result = await runner.run("manual", GROUPS)
    assert sleep.calls == []
    assert len(source.calls) == 1
    assert (result.outcome, result.state) == ("failed", "login_needed")


async def test_rate_limit_stops_the_run_without_retry(runner, source, sleep):
    source.will("overview", RateLimited("HoYoLAB says there were too many requests."))
    result = await runner.run("manual", GROUPS)
    assert sleep.calls == []
    assert len(source.calls) == 1
    assert (result.outcome, result.state) == ("failed", "error")
    assert result.message == "HoYoLAB says there were too many requests."


async def test_switch_off_skips_only_that_group(runner, source, store):
    source.will("notes", DataSwitchOff("Real-Time Notes is switched off in HoYoLAB."))
    result = await runner.run("manual", GROUPS)
    assert [call[0] for call in source.calls] == list(GROUPS)
    assert (result.outcome, result.state) == ("partial", "switch_off")
    assert result.message == "Real-Time Notes is switched off in HoYoLAB."
    assert result.groups_failed == ("notes",)
    assert store.group_states()["notes"].needs_retry
    assert not store.group_states()["diary"].needs_retry


async def test_unreadable_group_does_not_stop_the_others(runner, source, store, clock):
    odd = FetchResult(
        "overview", clock.now(), (RawResponse("index", {"odd": 1}),), None,
        "HoYoLAB's overview data has an unexpected shape.",
    )
    source.will("overview", odd)
    result = await runner.run("manual", GROUPS)
    assert store.raw_bodies("overview") == [{"odd": 1}]  # nothing is thrown away
    assert (result.outcome, result.state) == ("partial", "error")
    assert result.message == "HoYoLAB's overview data has an unexpected shape."
    assert result.groups_failed == ("overview",)
    assert result.groups_ok == GROUPS[1:]
    assert store.group_states()["overview"].needs_retry


async def test_diary_asks_for_history_only_the_first_time(runner, source, clock):
    await runner.run("manual", ("diary",))
    clock.advance(days=1)
    await runner.run("manual", ("diary",))
    assert source.calls == [("diary", True), ("diary", False)]


async def test_a_diary_kept_before_its_sources_asks_for_history_once_more(runner, source, store, clock):
    # A database from before the diary kept its primogems by source holds each month's total alone. Its next sync asks
    # for the history once more, so that the next version's events estimate has the last full months at once.
    now = clock.now()
    store.add_points(None, now, now.date(), [Point(month_key(now.year, now.month), 6000.0)])
    await runner.run("manual", ("diary",))
    clock.advance(days=1)
    await runner.run("manual", ("diary",))
    assert source.calls == [("diary", True), ("diary", False)]


async def test_a_group_that_cannot_be_stored_fails_alone_and_the_run_is_closed(runner, source, store, clock):
    good = ok_result("overview", clock.now())
    unstorable = replace(good, record=replace(good.record, counters={"achievements": float("nan")}))
    source.will("overview", unstorable)
    result = await runner.run("manual", GROUPS)
    assert (result.outcome, result.state) == ("partial", "error")
    assert result.message == "Guild Board could not store the overview data. See the log file."
    assert result.groups_failed == ("overview",)
    assert result.groups_ok == GROUPS[1:]
    row = store.recent_runs()[0]
    assert (row.outcome, row.error_kind, row.message) == ("partial", "error", result.message)
    assert row.finished_at is not None
    assert store.group_states()["overview"].needs_retry
    assert store.raw_bodies("overview") == [{"group": "overview"}]  # what was received is kept


async def test_a_source_that_breaks_unexpectedly_fails_only_its_group(runner, source, store):
    source.will("notes", RuntimeError("a bug in the source"))
    result = await runner.run("manual", GROUPS)
    assert (result.outcome, result.state) == ("partial", "error")
    assert result.message == "The sync failed unexpectedly. See the log file."
    assert result.groups_failed == ("notes",)
    assert store.recent_runs()[0].finished_at is not None


async def test_an_interrupted_run_is_closed_too(runner, source, store):
    source.will("notes", asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        await runner.run("manual", GROUPS)
    row = store.recent_runs()[0]
    assert (row.outcome, row.error_kind) == ("partial", "error")  # the overview was stored before the interruption
    assert row.message == "Guild Board closed before this sync finished."
    assert row.finished_at is not None
