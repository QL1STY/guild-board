import asyncio
import contextlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from guildboard.config import Settings
from guildboard.events import EventBus
from guildboard.records import LoginNeeded, VerificationNeeded
from guildboard.sync.policy import Decision
from guildboard.sync.runner import SyncRunner
from guildboard.sync.scheduler import POST_SESSION_DELAY, SKIP_MESSAGES, SyncScheduler, local_midnight
from support import FakeSleep, FakeSource, ok_result


def _utc_midnight(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _build(store, clock, source=None, sleep=None):
    source = source or FakeSource()
    sleep = sleep or FakeSleep(clock)
    settings = Settings()
    token = {"present": True}
    bus = EventBus()
    runner = SyncRunner(source, store, clock, lambda: "os_euro", sleep)
    scheduler = SyncScheduler(
        runner, store, clock, bus,
        settings=lambda: settings, server=lambda: "os_euro", has_token=lambda: token["present"],
        sleep=sleep, day_start=_utc_midnight,
    )
    return SimpleNamespace(
        s=scheduler, source=source, sleep=sleep, settings=settings, token=token, bus=bus, runner=runner
    )


@pytest.fixture
def env(store, clock):
    return _build(store, clock)


def _triggers(store, outcome: str) -> list[str]:
    return [row.trigger for row in store.recent_runs() if row.outcome == outcome]


async def test_first_trigger_runs_and_reports_ok(env, store):
    decision = await env.s.trigger("startup")
    assert decision.run is True
    assert store.recent_runs()[0].outcome == "ok"
    assert env.s.current_state() == "ok"
    assert env.s.message is None


async def test_startup_when_fresh_is_logged_as_skipped(env, store, clock):
    await env.s.trigger("manual")
    clock.advance(hours=1)
    assert await env.s.trigger("startup") == Decision(False, "fresh")
    row = store.recent_runs()[0]
    assert (row.trigger, row.outcome, row.message) == ("startup", "skipped", SKIP_MESSAGES["fresh"])


async def test_manual_during_cooldown_reports_the_wait(env, clock):
    await env.s.trigger("manual")
    clock.advance(minutes=2)
    assert env.s.request("manual") == Decision(False, "cooldown", (), 180)
    assert env.s.manual_wait_seconds() == 180
    clock.advance(minutes=3)
    assert env.s.manual_wait_seconds() == 0


async def test_request_runs_in_the_background(env, store):
    decision = env.s.request("manual")
    assert decision.run is True
    assert env.s.current_state() == "syncing"
    await env.s.idle()
    assert env.s.current_state() == "ok"
    assert _triggers(store, "ok") == ["manual"]


async def test_a_second_trigger_while_busy_is_refused(store, clock):
    gate = asyncio.Event()

    class SlowSource(FakeSource):
        async def fetch(self, group, *, now, first_time=False):
            await gate.wait()
            return await super().fetch(group, now=now, first_time=first_time)

    env = _build(store, clock, source=SlowSource())
    assert env.s.request("manual").run is True
    await asyncio.sleep(0)
    assert env.s.request("manual") == Decision(False, "busy")
    gate.set()
    await env.s.idle()
    assert _triggers(store, "ok") == ["manual"]
    skipped = [row for row in store.recent_runs() if row.outcome == "skipped"]
    assert [row.message for row in skipped] == [SKIP_MESSAGES["busy"]]


async def test_events_are_published_in_order(env):
    queue = env.bus.subscribe()
    await env.s.trigger("manual")
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    assert [event["type"] for event in events] == ["sync_started", "state_changed", "sync_finished", "state_changed"]
    assert events[1]["state"] == "syncing"
    assert events[2]["outcome"] == "ok"
    assert events[3]["state"] == "ok"


async def test_verification_blocks_until_cleared(env, clock):
    env.source.will("overview", VerificationNeeded("HoYoLAB asked for a verification check."))
    await env.s.trigger("manual")
    assert env.s.current_state() == "verification_needed"
    assert env.s.message == "HoYoLAB asked for a verification check."
    clock.advance(minutes=10)
    assert await env.s.trigger("manual") == Decision(False, "verification_needed")
    calls_before = len(env.source.calls)
    env.s.clear_block()
    assert env.s.current_state() == "ok"
    env.source.will("overview", ok_result("overview", clock.now()))
    assert (await env.s.trigger("manual")).run is True
    assert len(env.source.calls) > calls_before
    assert env.s.current_state() == "ok"


async def test_without_a_token_nothing_is_fetched(env):
    env.token["present"] = False
    assert env.s.current_state() == "login_needed"
    assert await env.s.trigger("startup") == Decision(False, "login_needed")
    assert env.source.calls == []


async def test_paused_state(env):
    env.settings.sync_paused = True
    assert env.s.current_state() == "paused"
    assert await env.s.trigger("manual") == Decision(False, "paused")


async def test_sync_follows_three_minutes_after_the_game_closes(env, store, clock):
    await env.s.trigger("manual")
    clock.advance(minutes=10)
    env.s.on_game_stopped(counted=True)
    assert env.s.next_sync_at() == clock.now() + timedelta(seconds=POST_SESSION_DELAY)
    await env.s.idle()
    assert POST_SESSION_DELAY in env.sleep.calls
    assert _triggers(store, "ok") == ["post_session", "manual"]
    assert env.s.next_sync_at() is None


async def test_restarting_the_game_cancels_the_pending_sync(env, store, clock):
    await env.s.trigger("manual")
    clock.advance(minutes=10)
    env.s.on_game_stopped(counted=True)
    env.s.on_game_started()
    await env.s.idle()
    assert _triggers(store, "ok") == ["manual"]
    assert env.s.next_sync_at() is None


async def test_a_short_blip_does_not_schedule_a_sync(env, store):
    env.s.on_game_stopped(counted=False)
    await env.s.idle()
    assert env.s.next_sync_at() is None
    assert store.recent_runs() == []


async def test_interval_syncs_while_the_game_runs(store, clock):
    class StoppingSleep(FakeSleep):
        stop = None

        async def __call__(self, seconds: float) -> None:
            await asyncio.sleep(0)  # let the run that was asked for just before this wait finish first
            self.calls.append(seconds)
            self._clock.advance(seconds=seconds)
            if len(self.calls) >= 3:
                self.stop()
            await asyncio.sleep(0)

    env = _build(store, clock, sleep=StoppingSleep(clock))
    env.sleep.stop = lambda: env.s.on_game_stopped(counted=False)
    env.settings.in_session_interval_min = 30
    env.s.on_game_started()
    assert env.s.next_sync_at() is None or env.s.next_sync_at() > clock.now()
    interval_task = env.s._interval_task
    with contextlib.suppress(asyncio.CancelledError):
        await interval_task
    await env.s.idle()
    assert env.sleep.calls == [1800.0, 1800.0, 1800.0]
    assert _triggers(store, "ok") == ["interval", "interval"]
    assert env.s.next_sync_at() is None


async def test_no_interval_when_the_setting_is_off(env):
    env.s.on_game_started()
    assert env.s._interval_task is None


async def test_start_closes_interrupted_runs_and_syncs(env, store, clock):
    store.start_run("manual", clock.now() - timedelta(hours=5))
    env.s.start()
    await env.s.idle()
    rows = store.recent_runs()
    assert (rows[0].trigger, rows[0].outcome) == ("startup", "ok")
    assert (rows[1].trigger, rows[1].outcome, rows[1].error_kind) == ("manual", "failed", "error")


async def test_an_unexpected_failure_is_reported_not_raised(env, monkeypatch):
    async def explode(trigger, groups):
        raise RuntimeError("boom")

    monkeypatch.setattr(env.runner, "run", explode)
    decision = await env.s.trigger("manual")
    assert decision.run is True
    assert env.s.current_state() == "error"
    assert env.s.message == "The sync stopped unexpectedly. See the log file."


async def test_stop_cancels_the_pending_sync(env, store, clock):
    await env.s.trigger("manual")
    clock.advance(minutes=10)
    real_sleep_gate = asyncio.Event()

    async def never(seconds: float) -> None:
        await real_sleep_gate.wait()

    env.s._sleep = never
    env.s.on_game_stopped(counted=True)
    await asyncio.sleep(0)
    await env.s.stop()
    assert _triggers(store, "ok") == ["manual"]


def test_local_midnight_is_the_start_of_the_local_day():
    now = datetime(2026, 10, 13, 15, 30, tzinfo=timezone.utc)
    start = local_midnight(now)
    assert start <= now < start + timedelta(days=1, hours=2)
    assert (start.hour, start.minute, start.second) == (0, 0, 0)


async def test_a_verification_block_survives_a_restart(store, clock):
    first = _build(store, clock)
    first.source.will("overview", VerificationNeeded("HoYoLAB asked for a verification check."))
    await first.s.trigger("manual")
    clock.advance(hours=5)
    restarted = _build(store, clock)  # a new scheduler on the same database, as after closing Guild Board
    assert restarted.s.current_state() == "verification_needed"
    assert restarted.s.message == "HoYoLAB asked for a verification check."
    assert await restarted.s.trigger("startup") == Decision(False, "verification_needed")
    assert restarted.source.calls == []  # nothing is sent while HoYoLAB waits for the check
    restarted.s.clear_block()
    assert (await restarted.s.trigger("manual")).run is True
    assert _build(store, clock).s.current_state() == "ok"  # a good run ends the block for later starts too


async def test_a_rejected_login_survives_a_restart(store, clock):
    first = _build(store, clock)
    first.source.will("overview", LoginNeeded("HoYoLAB no longer accepts the saved login."))
    await first.s.trigger("manual")
    clock.advance(hours=5)
    restarted = _build(store, clock)
    assert restarted.s.current_state() == "login_needed"
    assert await restarted.s.trigger("startup") == Decision(False, "login_needed")
    assert restarted.source.calls == []


async def test_a_refresh_within_five_minutes_of_a_run_answers_the_minutes_to_wait(env, store, clock):
    await env.s.trigger("manual")
    env.source.calls.clear()
    clock.advance(minutes=2)
    assert env.s.request_group("characters") == 3  # 180 seconds left of the 5-minute gap
    clock.advance(minutes=2, seconds=30)
    assert env.s.request_group("characters") == 1  # half a minute left rounds up
    await env.s.idle()
    assert env.source.calls == []  # a refused refresh fetches nothing
    clock.advance(seconds=30)
    assert env.s.request_group("characters") is None  # the gap is over: a run starts
    assert env.s.current_state() == "syncing"
    await env.s.idle()
    assert env.source.calls == [("characters", False)]  # the refresh reads the characters group alone
    assert env.s.current_state() == "ok"


async def test_a_refresh_past_the_days_24_runs_is_refused_until_midnight(env, store, clock):
    start = _utc_midnight(clock.now())
    for number in range(24):  # twenty-four runs today, the last of them long past the 5-minute gap
        run = store.start_run("interval", start + timedelta(minutes=18 * number))
        store.finish_run(run, start + timedelta(minutes=18 * number + 1), "ok")
    assert env.s.runs_today() == 24
    assert env.s.request_group("characters") == 16 * 60  # from 08:00 to the next midnight
    clock.advance(hours=15, minutes=30)
    assert env.s.request_group("characters") == 30
    clock.advance(minutes=30)  # midnight: the count starts again
    assert env.s.request_group("characters") is None
    await env.s.idle()


async def test_the_seconds_until_the_days_count_starts_again_are_told_only_once_the_24_are_spent(env, store, clock):
    start = _utc_midnight(clock.now())
    assert env.s.seconds_until_runs_count_again() == 0   # nothing is spent
    for number in range(24):
        run = store.start_run("interval", start + timedelta(minutes=18 * number))
        store.finish_run(run, start + timedelta(minutes=18 * number + 1), "ok")
    assert env.s.seconds_until_runs_count_again() == 16 * 3600   # from 08:00 to the next midnight
    clock.advance(hours=15, minutes=30)
    assert env.s.seconds_until_runs_count_again() == 30 * 60
    clock.advance(minutes=30)
    assert env.s.seconds_until_runs_count_again() == 0   # midnight: the count starts again


async def test_a_refresh_while_a_sync_runs_or_the_sync_is_stopped_for_another_reason_is_not_started(env, store, clock):
    assert env.s.request("manual").run is True
    assert env.s.request_group("characters") == 1  # a sync is running: the answer is a minute at most
    await env.s.idle()
    fetched = len(env.source.calls)
    clock.advance(minutes=10)
    env.settings.sync_paused = True
    assert env.s.request_group("characters") == 0  # 0: no wait will help; the player must deal with it
    env.settings.sync_paused = False
    env.token["present"] = False
    assert env.s.request_group("characters") == 0
    assert len(env.source.calls) == fetched  # the refused refreshes fetched nothing
