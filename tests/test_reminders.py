import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from guildboard.achievements.catalog import bundled_raw, parse_catalog
from guildboard.achievements.notes import load_notes
from guildboard.achievements.progress import Progress
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.events import EventBus
from guildboard.timers.presets import load_presets
from guildboard.timers.quick import QuickTimers
from guildboard.timers.reminders import Reminders, reminder_text
from guildboard.timers.rules import Rule
from guildboard.timers.timers import Timers

CATALOG = parse_catalog(bundled_raw())


@pytest.fixture
def fishing():
    return {"rule": "3_days"}


@pytest.fixture
def timers(store, clock, fishing):
    progress = Progress(store, lambda: CATALOG, load_notes(), clock)
    return Timers(store, clock, progress, load_presets(), lambda: "os_euro", lambda: fishing["rule"])


class Notifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def __call__(self, kind: str, text: str) -> bool:
        self.sent.append((kind, text))
        return True


@pytest.fixture
def notifier():
    return Notifier()


@pytest.fixture
def switch():
    return {"on": True}


@pytest.fixture
def bus():
    return EventBus()


def _reminders(timers, store, clock, bus, notifier, switch, quick=None, **options):
    quick = quick if quick is not None else QuickTimers(store, clock)  # a new watch reads the same store's
    return Reminders(timers, store, clock, bus, enabled=lambda: switch["on"], notify=notifier, quick=quick, **options)


def _own(timers, name: str, hours: int = 1) -> int:
    timer_id, _ = timers.create(name, "", Rule("hours", hours), None)
    return timer_id


def test_one_timer_that_becomes_ready_gets_one_reminder(timers, store, clock, bus, notifier, switch):
    reminders = _reminders(timers, store, clock, bus, notifier, switch)
    timer_id = _own(timers, "Walk the dog")
    timers.cleared(timer_id)
    assert reminders.check() == [] and notifier.sent == []
    clock.advance(hours=1)
    assert reminders.check() == [timer_id]
    assert notifier.sent == [("reminder", "Walk the dog is ready.")]
    assert reminders.check() == [] and len(notifier.sent) == 1


def test_several_ready_together_get_one_reminder_naming_them():
    names = ["A", "B", "C", "D", "E", "F", "G"]
    assert reminder_text(names[:1]) == "A is ready."
    assert reminder_text(names[:2]) == "A and B are ready."
    assert reminder_text(names[:3]) == "A, B and C are ready."
    assert reminder_text(names[:5]) == "A, B, C, D and E are ready."
    assert reminder_text(names) == "A, B, C, D, E and 2 more are ready."


def test_reminders_missed_while_guild_board_was_off_come_as_one_and_not_again(timers, store, clock, bus, switch):
    for name, hours in (("Walk the dog", 1), ("Water the plants", 2), ("Feed the cat", 3)):
        timers.cleared(_own(timers, name, hours))
    clock.advance(hours=5)  # Guild Board was off meanwhile
    first, second = Notifier(), Notifier()
    _reminders(timers, store, clock, bus, first, switch).check()  # the next start
    assert first.sent == [("reminder", "Walk the dog, Water the plants and Feed the cat are ready.")]
    _reminders(timers, store, clock, bus, second, switch).check()  # and the one after
    assert second.sent == []


def test_a_timer_without_its_bell_is_not_reminded(timers, store, clock, bus, notifier, switch):
    timer_id = _own(timers, "Walk the dog")
    timers.cleared(timer_id)
    timers.set_bell(timer_id, False)
    clock.advance(hours=1)
    assert _reminders(timers, store, clock, bus, notifier, switch).check() == [] and notifier.sent == []


def test_notifications_off_send_nothing_and_bring_no_burst_later(timers, store, clock, bus, notifier, switch):
    reminders = _reminders(timers, store, clock, bus, notifier, switch)
    timers.cleared(_own(timers, "Walk the dog"))
    clock.advance(hours=1)
    switch["on"] = False
    reminders.check()
    switch["on"] = True
    reminders.check()
    assert notifier.sent == []


def test_cleared_again_after_a_reminder_reminds_again_at_the_new_time(timers, store, clock, bus, notifier, switch):
    reminders = _reminders(timers, store, clock, bus, notifier, switch)
    timer_id = _own(timers, "Walk the dog")
    timers.cleared(timer_id)
    clock.advance(hours=1)
    reminders.check()
    timers.cleared(timer_id)
    clock.advance(minutes=59)
    reminders.check()
    clock.advance(minutes=1)
    reminders.check()
    assert notifier.sent == [("reminder", "Walk the dog is ready."), ("reminder", "Walk the dog is ready.")]


def test_a_fishing_rule_that_moves_a_reminded_ready_time_earlier_does_not_remind_again(
    timers, store, clock, bus, notifier, switch, fishing
):
    reminders = _reminders(timers, store, clock, bus, notifier, switch)
    timer_id, _ = timers.add_preset("fishing.luhua_pool")
    timers.cleared(timer_id)
    clock.advance(hours=72)
    reminders.check()
    fishing["rule"] = "next_reset"  # the spot was ready from the reset after the Cleared, three days ago
    reminders.check()
    assert notifier.sent == [("reminder", "Fishing spot · Luhua Pool, Liyue is ready.")]


def test_a_timer_that_becomes_ready_tells_the_pages(timers, store, clock, bus, notifier, switch):
    reminders = _reminders(timers, store, clock, bus, notifier, switch)
    timers.cleared(_own(timers, "Walk the dog"))
    reminders.check()
    events = bus.subscribe()
    clock.advance(hours=1)
    reminders.check()
    reminders.check()
    assert [events.get_nowait()["type"] for _ in range(events.qsize())] == ["timers_changed"]


def test_a_quick_timer_reminds_once_when_ready_and_its_notification_opens_the_board(
    timers, store, clock, bus, notifier, switch
):
    quick = QuickTimers(store, clock)
    reminders = _reminders(timers, store, clock, bus, notifier, switch, quick=quick)
    quick.start(300)
    reminders.check()
    assert notifier.sent == []
    clock.advance(minutes=5)
    assert reminders.check() == []  # the timers' ids alone
    reminders.check()
    assert notifier.sent == [("quick", "Quick timer · 5 min is ready.")]


def test_a_quick_timer_and_a_timer_ready_together_share_one_reminder(timers, store, clock, bus, notifier, switch):
    quick = QuickTimers(store, clock)
    reminders = _reminders(timers, store, clock, bus, notifier, switch, quick=quick)
    timer_id = _own(timers, "Walk the dog")
    timers.cleared(timer_id)
    clock.advance(minutes=55)
    quick.start(600)  # ready five minutes after the dog
    clock.advance(minutes=10)
    assert reminders.check() == [timer_id]
    # One notification, in order of ready time, of the kind that opens Timers.
    assert notifier.sent == [("reminder", "Walk the dog and Quick timer · 10 min are ready.")]


def test_a_quick_timer_ready_while_guild_board_was_off_reminds_once(timers, store, clock, bus, switch):
    QuickTimers(store, clock).start(300)
    clock.advance(hours=1)  # Guild Board was off meanwhile
    first, second = Notifier(), Notifier()
    _reminders(timers, store, clock, bus, first, switch).check()  # the next start
    assert first.sent == [("quick", "Quick timer · 5 min is ready.")]
    _reminders(timers, store, clock, bus, second, switch).check()  # and the one after
    assert second.sent == []


def test_a_dismissed_quick_timer_never_reminds(timers, store, clock, bus, notifier, switch):
    quick = QuickTimers(store, clock)
    reminders = _reminders(timers, store, clock, bus, notifier, switch, quick=quick)
    quick.dismiss(quick.start(60))
    clock.advance(minutes=1)
    reminders.check()
    assert notifier.sent == []


def test_notifications_off_mark_quick_timers_too_and_bring_no_burst_later(timers, store, clock, bus, notifier, switch):
    quick = QuickTimers(store, clock)
    reminders = _reminders(timers, store, clock, bus, notifier, switch, quick=quick)
    quick.start(60)
    clock.advance(minutes=1)
    switch["on"] = False
    reminders.check()
    switch["on"] = True
    reminders.check()
    assert notifier.sent == []


class HeldSleep:
    """Stands in for asyncio.sleep: remembers how long it was asked to wait, and waits until the test lets it go."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        await asyncio.Event().wait()


async def _until(condition, tries: int = 100) -> None:
    for _ in range(tries):
        if condition():
            return
        await asyncio.sleep(0)
    raise AssertionError("it did not happen")


async def test_the_watch_waits_until_the_soonest_ready_time(timers, store, clock, bus, notifier, switch):
    held = HeldSleep()
    reminders = _reminders(timers, store, clock, bus, notifier, switch, sleep=held, longest_wait=30.0)
    timer_id, _ = timers.create("Brew tea", "", Rule("hours", 1), None)
    timers.cleared(timer_id, at=clock.now() - timedelta(minutes=59, seconds=50))  # ready in ten seconds
    task = asyncio.create_task(reminders.run())
    try:
        await _until(lambda: held.calls)
        assert held.calls == [10.0]
        clock.advance(seconds=10)
        reminders.wake()  # as a change of a timer or of the demo clock does: the watch looks again at once
        await _until(lambda: notifier.sent)
        assert notifier.sent == [("reminder", "Brew tea is ready.")]
        await _until(lambda: len(held.calls) == 2)
        assert held.calls[1] == 30.0  # nothing else is running: the longest wait, so a sleeping PC is noticed
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_a_wait_that_fails_does_not_end_the_watch(timers, store, clock, bus, notifier, switch):
    # A timer's row that cannot be read makes the look and the wait after it fail alike. The watch goes on all the same, after
    # its longest wait or a wake, and reminds once the row can be read again.
    held = HeldSleep()
    reminders = _reminders(timers, store, clock, bus, notifier, switch, sleep=held, longest_wait=30.0)
    timer_id = _own(timers, "Brew tea")
    timers.cleared(timer_id, at=clock.now() - timedelta(hours=2))
    store._conn.execute("UPDATE timers SET created_at = 'x' WHERE id = ?", (timer_id,))
    task = asyncio.create_task(reminders.run())
    try:
        await _until(lambda: held.calls or task.done())
        assert not task.done() and held.calls == [30.0]
        store._conn.execute("UPDATE timers SET created_at = updated_at WHERE id = ?", (timer_id,))
        reminders.wake()
        await _until(lambda: notifier.sent)
        assert notifier.sent == [("reminder", "Brew tea is ready.")]
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_the_demo_clock_makes_the_hilichurl_ready_and_reminds(tmp_path):
    start = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    core = Core(AppPaths(tmp_path / "data"), demo=True, demo_now=start, process_lister=lambda: set())
    try:
        sent = Notifier()
        core.notifier, core.has_tray = sent, True
        core.reminders.check()  # whatever the demo had ready is reminded about first
        sent.sent.clear()
        hilichurl = next(row.id for row in core.store.timers() if row.preset == "hilichurl")
        core.timers.cleared(hilichurl)
        core.advance_demo_clock(12 * 3600)
        core.reminders.check()
        assert sent.sent == [("reminder", "Unusual Hilichurl is ready.")]
    finally:
        core.store.close()


def test_moving_the_demo_clock_makes_its_timers_ready(tmp_path):
    start = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    core = Core(AppPaths(tmp_path / "data"), demo=True, demo_now=start, process_lister=lambda: set())
    try:
        sent = Notifier()
        core.notifier, core.has_tray = sent, True  # the demo's window has no tray; this one records
        core.reminders.check()  # the first look: the two ready before the start are missed reminders, sent as one
        assert sent.sent == [("reminder", "Fishing spot · Luhua Pool, Liyue and Teapot · Jade Field are ready.")]
        core.advance_demo_clock(10 * 3600)  # the hilichurl was defeated 2 hours before the start
        core.reminders.check()
        assert sent.sent[1:] == [("reminder", "Unusual Hilichurl is ready.")]
        hilichurl = next(timer for timer in core.timers_model()["timers"] if timer["preset"] == "hilichurl")
        assert hilichurl["state"] == "ready"
    finally:
        core.store.close()


def _demo_core(tmp_path, running: bool) -> Core:
    """A demo core at the start the demo's tests use, whose process list does or does not show the game."""
    start = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
    core = Core(
        AppPaths(tmp_path / "data"), demo=True, demo_now=start,
        process_lister=lambda: {"genshinimpact.exe"} if running else set(),
    )
    core.gamewatch.poll_once()  # the game is running when the process list shows it, as while Guild Board runs
    assert core.status()["game"]["running"] is running
    return core


def _lines(queue) -> list[str]:
    """The text of each line over the game that arrived."""
    seen = []
    while not queue.empty():
        event = queue.get_nowait()
        if event["type"] == "overlay_line":
            seen.append(event["text"])
    return seen


@pytest.mark.parametrize("running, lines", [(False, []), (True, ["Unusual Hilichurl is ready."])])
def test_a_line_only_while_the_game_runs(tmp_path, running, lines):
    core = _demo_core(tmp_path, running)
    try:
        core.reminders.check()  # whatever the demo had ready is reminded about first
        queue = core.bus.subscribe()
        hilichurl = next(row.id for row in core.store.timers() if row.preset == "hilichurl")
        core.timers.cleared(hilichurl)
        core.advance_demo_clock(12 * 3600)
        core.reminders.check()
        assert _lines(queue) == lines
    finally:
        core.store.close()


@pytest.mark.parametrize("notifications, lines", [(False, True), (True, False), (True, True), (False, False)])
def test_lines_and_notifications_follow_their_own_settings(tmp_path, notifications, lines):
    core = _demo_core(tmp_path, running=True)
    try:
        sent = Notifier()
        core.notifier, core.has_tray = sent, True
        core.update_settings({"notifications": notifications, "overlay_lines": lines})
        queue = core.bus.subscribe()
        core.reminders.check()  # the first look: the demo's two timers that were ready before the start
        ready = "Fishing spot · Luhua Pool, Liyue and Teapot · Jade Field are ready."
        assert sent.sent == ([("reminder", ready)] if notifications else [])
        assert _lines(queue) == ([ready] if lines else [])
    finally:
        core.store.close()


def test_a_reminder_says_whether_a_line_or_a_notification_was_given(tmp_path):
    core = _demo_core(tmp_path, running=True)
    try:
        core.notifier, core.has_tray = Notifier(), True
        for notifications, lines in ((True, True), (True, False), (False, True), (False, False)):
            core.update_settings({"notifications": notifications, "overlay_lines": lines})
            assert core.remind("reminder", "Teapot is ready.") is (notifications or lines)
        core.update_settings({"notifications": True, "overlay_lines": False})
        core.has_tray = False  # a notification that has no tray to show it is not given
        assert core.remind("reminder", "Teapot is ready.") is False
    finally:
        core.store.close()


def test_a_reminder_is_logged_with_what_was_given(tmp_path, caplog):
    core = _demo_core(tmp_path, running=True)
    try:
        core.notifier, core.has_tray = Notifier(), True
        core.update_settings({"notifications": True, "overlay_lines": False})
        with caplog.at_level("INFO", logger="guildboard.core"):
            core.remind("quick", "Quick timer · 1 h is ready.")
            core.has_tray = False
            core.remind("quick", "Quick timer · 1 h is ready.")
        assert [r.getMessage() for r in caplog.records if r.name == "guildboard.core"] == [
            "A quick reminder: line no, notification yes.",
            "A quick reminder: line no, notification no.",
        ]
    finally:
        core.store.close()


def test_several_ready_at_once_make_one_line(tmp_path):
    core = _demo_core(tmp_path, running=True)
    try:
        queue = core.bus.subscribe()
        core.reminders.check()  # the demo's fishing spot and teapot were ready before its start
        assert _lines(queue) == [reminder_text(["Fishing spot · Luhua Pool, Liyue", "Teapot · Jade Field"])]
        core.reminders.check()
        assert _lines(queue) == []  # and each ready time is reminded about once
    finally:
        core.store.close()


async def test_the_watch_wakes_for_a_quick_timer(timers, store, clock, bus, notifier, switch):
    held = HeldSleep()
    quick = QuickTimers(store, clock)
    reminders = _reminders(timers, store, clock, bus, notifier, switch, quick=quick, sleep=held, longest_wait=30.0)
    quick.start(10)
    task = asyncio.create_task(reminders.run())
    try:
        await _until(lambda: held.calls)
        assert held.calls == [10.0]  # the quick timer's time, not the longest wait
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
