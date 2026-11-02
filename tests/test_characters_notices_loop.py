"""Task V4: the notices' loop, the Today widget's model and the three switches: the service looks at what is due, sends each
kind at most once a game day through the notifier, and sleeps until the next time one can be due."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import characters_samples as samples
from characters_service_support import build_record, calculator, keep_builds, keep_notes, keep_wiki, make_service
from guildboard.core import Core
from guildboard.config import AppPaths
from support import FakeClock, FakeSleep

SUNDAY_EVENING = datetime(2026, 10, 25, 17, 30, tzinfo=timezone.utc)   # 18:30 on Sunday on the Europe server


@pytest.fixture
def clock():
    return FakeClock(SUNDAY_EVENING)


async def focused(store, clock, tmp_path, *, sleep=asyncio.sleep, switches=lambda: {}):
    """A service for an account whose only character is Sandrone, in the focus, with her wiki entries, and a notifier that
    keeps what it is given."""
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    keep_notes(store, clock.now())
    shown: list[tuple[str, str]] = []
    service = make_service(
        store, clock, tmp_path, notify=lambda kind, text: shown.append((kind, text)) or True, sleep=sleep, switches=switches,
    )
    await keep_wiki(service._wiki)
    service.put_focus(["sandrone"])
    return service, shown


async def test_the_loop_sends_the_sunday_reminder_once_and_sleeps_until_the_next(store, clock, tmp_path):
    slept: list[float] = []
    gate = asyncio.Event()

    async def sleep(seconds: float) -> None:
        slept.append(seconds)
        await gate.wait()   # the loop waits here until the test wakes it

    service, shown = await focused(store, clock, tmp_path, sleep=sleep)
    task = asyncio.create_task(service.run())
    for _ in range(50):
        await asyncio.sleep(0)
        if slept:
            break
    weekly = [text for kind, text in shown if text.startswith("Weekly bosses reset tomorrow")]
    assert weekly == ["Weekly bosses reset tomorrow. At 04:00: The Doctor for Sandrone."]
    # the weekly bosses and the domain open Your week; a goal that is ready opens her page
    assert {kind for kind, text in shown if not text.startswith("Sandrone can")} == {"characters"}
    assert slept == [900.0]     # the next due time is Monday 04:00, nine and a half hours away; a look is never later than 15 minutes
    sent = len(shown)
    service.wake()              # another look the same evening
    for _ in range(50):
        await asyncio.sleep(0)
        if len(slept) == 2:
            break
    assert len(slept) == 2 and len(shown) == sent   # nothing is sent twice in a game day
    assert [row for row in store.notices_sent(0 + service.uid(), clock.now().date() - timedelta(days=1))] != []
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


def test_the_next_look_is_at_the_next_due_time_when_that_is_soon(store, clock, tmp_path):
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], calculator())
    service = make_service(store, clock, tmp_path)
    clock.set(datetime(2026, 10, 25, 16, 55, tzinfo=timezone.utc))   # 17:55 on the server: the reminder is five minutes off
    assert service.next_wait() == 300.0
    clock.set(datetime(2026, 10, 26, 2, 59, 30, tzinfo=timezone.utc))   # 03:59:30: the reset is half a minute off
    assert service.next_wait() == 30.0


async def test_a_switched_off_kind_is_never_sent(store, clock, tmp_path):
    off = {"weekly": False, "domain": True, "ready": True}
    service, shown = await focused(store, clock, tmp_path, switches=lambda: off)
    sent = service.check()
    assert "weekly" not in sent and "domain" in sent
    assert not any(text.startswith("Weekly bosses") for _, text in shown)
    off["weekly"] = True
    assert service.check() == ["weekly"]   # on again: it comes, once
    assert service.check() == []
    # a kind the switches do not name counts as on
    other, more = await focused(store, FakeClock(SUNDAY_EVENING + timedelta(days=7)), tmp_path / "again", switches=lambda: {})
    assert other.check() != []


async def test_a_goal_that_is_ready_carries_her_page_in_its_kind_and_the_rest_the_week(store, clock, tmp_path):
    from characters_service_support import calculator as held_everything
    from guildboard.records import CalcItemRecord, CalculatorRecord

    everything = CalculatorRecord(True, {1: (
        CalcItemRecord(1, "Philosophies of Vagrancy", "", 16, 0), CalcItemRecord(2, "Precision Drive Shaft", "", 12, 0),
        CalcItemRecord(3, "Madman's Restraint", "", 2, 0), CalcItemRecord(4, "Crown of Insight", "", 1, 0),
        CalcItemRecord(5, "Mora", "", 700000, 0),
    )}, {})
    keep_builds(store, clock.now(), [build_record(samples.sandrone_build())], everything)
    keep_notes(store, clock.now())
    shown: list[tuple[str, str]] = []
    service = make_service(store, clock, tmp_path, notify=lambda kind, text: shown.append((kind, text)) or True)
    await keep_wiki(service._wiki)
    service.put_focus(["sandrone"])
    assert service.check() == ["ready"]
    assert shown == [("characters/sandrone", "Sandrone can raise her Normal Attack to 10. All the materials are in.")]
    service.wake()
    assert service.check() == []   # told once, until it is not ready any more
    # a Sunday with a weekly boss or an open domain opens Your week
    other, more = await focused(store, FakeClock(SUNDAY_EVENING + timedelta(days=14)), tmp_path / "other")
    other.check()
    assert {kind for kind, text in more if text.startswith(("Weekly", "Overturned"))} == {"characters"}


async def test_the_domain_notice_names_the_domain_and_who_it_is_for(store, clock, tmp_path):
    service, shown = await focused(store, clock, tmp_path)
    service.check()
    assert ("characters", "Overturned Roost is open today. For Sandrone.") in shown


async def test_the_week_models_today_is_the_widgets_model(store, clock, tmp_path):
    service, _ = await focused(store, clock, tmp_path)
    week = service.week()
    assert service.today_model() == week["today"] == week["days"][0]


async def test_a_ticked_task_is_shared_between_the_widget_and_the_week(store, clock, tmp_path):
    service, _ = await focused(store, clock, tmp_path)
    task = service.today_model()["tasks"][0]["key"]
    service.put_tick("2026-10-25", task, True)
    assert service.today_model()["tasks"][0]["done"] is True and service.week()["days"][0]["tasks"][0]["done"] is True


def test_the_switches_are_the_settings_and_a_missing_one_counts_as_on(tmp_path):
    clock = FakeClock(SUNDAY_EVENING)
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        assert core._characters_switches() == {"weekly": True, "domain": True, "ready": True}
        core.update_settings({"characters_notice_weekly": False, "characters_notice_ready": False})
        assert core._characters_switches() == {"weekly": False, "domain": True, "ready": False}
        assert core.settings.to_dict()["characters_notice_domain"] is True
    finally:
        core.store.close()
