"""The Characters service's loop, which queues the planned
characters' wiki entries and sleeps until the next day's start, until something changes or until a sync has finished."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import characters_samples as samples
from characters_service_support import build_record, calculator, keep_builds, keep_notes, make_service
from support import FakeClock


def service_for(store, clock, tmp_path, **kwargs):
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    keep_notes(store, clock.now())
    return make_service(store, clock, tmp_path, **kwargs)


def test_the_loop_waits_for_the_next_day_start_when_it_is_soon_and_never_longer_than_the_longest_wait(store, tmp_path):
    clock = FakeClock(datetime(2026, 10, 25, 1, 55, tzinfo=timezone.utc))   # 02:55 on the Europe server: the day turns at 04:00
    service = service_for(store, clock, tmp_path)
    assert service.next_wait() == 900.0
    clock.advance(minutes=60)   # 03:55: five minutes to the turn
    assert service.next_wait() == 300.0
    assert not hasattr(service, "check") and not hasattr(service, "week") and not hasattr(service, "put_tick")


async def test_the_loop_notes_the_day_queues_the_planned_characters_and_sleeps_the_wait(store, tmp_path):
    clock = FakeClock(datetime(2026, 10, 25, 1, 55, tzinfo=timezone.utc))   # 02:55 on the Europe server
    slept: list[float] = []
    calls: list[tuple] = []
    gate = asyncio.Event()

    async def sleep(seconds: float) -> None:
        slept.append(seconds)
        await gate.wait()

    service = service_for(store, clock, tmp_path, sleep=sleep)
    service.put_focus(["sandrone"])
    service.wanted = lambda *keys: calls.append(("wanted", *keys))
    task = asyncio.create_task(service.run())
    for _ in range(50):
        await asyncio.sleep(0)
        if slept:
            break
    assert calls == [("wanted", "sandrone")] and slept == [900.0]
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
