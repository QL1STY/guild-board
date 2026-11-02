import asyncio
from datetime import timedelta

import pytest

from guildboard import gamewatch
from guildboard.events import EventBus
from guildboard.gamewatch import GameWatch, SessionTracker, is_game_running, list_process_names
from support import FakeSleep


class Recorder:
    def __init__(self) -> None:
        self.calls: list[object] = []

    def started(self) -> None:
        self.calls.append("started")

    def stopped(self, counted: bool) -> None:
        self.calls.append(("stopped", counted))


@pytest.fixture
def recorder() -> Recorder:
    return Recorder()


@pytest.fixture
def tracker(store, clock, recorder) -> SessionTracker:
    return SessionTracker(store, clock, EventBus(), on_started=recorder.started, on_stopped=recorder.stopped)


def _polls(tracker, clock, running: bool, count: int, seconds: int = 5) -> None:
    for _ in range(count):
        tracker.observe(running)
        clock.advance(seconds=seconds)


def test_game_name_matches_in_any_case():
    assert is_game_running({"explorer.exe", "genshinimpact.exe"})
    assert is_game_running(["GenshinImpact.exe"])
    assert is_game_running(["YUANSHEN.EXE"])
    assert not is_game_running({"explorer.exe", "genshinimpact.exe.bak", "launcher.exe"})
    assert not is_game_running([])


def test_real_process_list_contains_this_python():
    names = list_process_names()
    assert len(names) > 5
    assert any(name.startswith("python") for name in names)
    assert all(name == name.lower() for name in names)


def test_session_starts_and_ends(tracker, store, clock, recorder):
    tracker.observe(False)
    started = clock.now()
    _polls(tracker, clock, True, 24)  # two minutes of play
    last_seen = clock.now() - timedelta(seconds=5)
    assert tracker.running
    assert tracker.session_started_at == started
    _polls(tracker, clock, False, 2)
    assert not tracker.running
    session = store.last_session()
    assert (session.started_at, session.ended_at, session.started_before_tool) == (started, last_seen, False)
    assert recorder.calls == ["started", ("stopped", True)]


def test_one_missed_poll_does_not_end_the_session(tracker, clock, recorder):
    _polls(tracker, clock, False, 1)
    _polls(tracker, clock, True, 20)
    _polls(tracker, clock, False, 1)
    _polls(tracker, clock, True, 1)
    assert tracker.running
    assert recorder.calls == ["started"]


def test_short_sessions_are_discarded(tracker, store, clock, recorder):
    _polls(tracker, clock, False, 1)
    _polls(tracker, clock, True, 6)  # 25 seconds between the first and the last sighting
    _polls(tracker, clock, False, 2)
    assert store.last_session() is None
    assert recorder.calls == ["started", ("stopped", False)]


def test_game_already_running_at_first_poll_is_flagged(tracker, store, clock):
    _polls(tracker, clock, True, 1)
    assert store.last_session().started_before_tool is True


def test_running_session_is_saved_every_minute(tracker, store, clock):
    _polls(tracker, clock, False, 1)
    start = clock.now()
    _polls(tracker, clock, True, 12)  # sightings at 0 s to 55 s: not yet a minute
    assert store.last_session().ended_at == start
    _polls(tracker, clock, True, 1)  # the sighting at 60 s is saved
    assert (store.last_session().ended_at - start).total_seconds() == 60


def test_events_are_published(store, clock):
    bus = EventBus()
    queue = bus.subscribe()
    tracker = SessionTracker(store, clock, bus)
    _polls(tracker, clock, False, 1)
    _polls(tracker, clock, True, 20)
    _polls(tracker, clock, False, 2)
    assert queue.get_nowait()["type"] == "game_started"
    stopped = queue.get_nowait()
    assert (stopped["type"], stopped["counted"]) == ("game_stopped", True)


def test_a_failing_process_list_keeps_the_previous_state(tracker, clock):
    answers: list[object] = [{"genshinimpact.exe"}, OSError(5, "Access is denied"), OSError(5, "Access is denied")]

    def lister() -> set[str]:
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    watch = GameWatch(tracker, lister=lister)
    for _ in range(3):
        watch.poll_once()
        clock.advance(seconds=5)
    assert tracker.running  # two unreadable polls are not two absences


async def test_watch_polls_until_cancelled(tracker, clock):
    sleep = FakeSleep(clock)
    watch = GameWatch(tracker, lister=lambda: {"genshinimpact.exe"}, sleep=sleep, interval=5.0)
    task = asyncio.create_task(watch.run())
    for _ in range(6):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert tracker.running
    assert len(sleep.calls) >= 2
    assert set(sleep.calls) == {5.0}


async def test_watch_survives_an_unexpected_error(tracker, clock):
    answers: list[object] = [RuntimeError("boom"), {"genshinimpact.exe"}]

    def lister() -> set[str]:
        answer = answers.pop(0) if len(answers) > 1 else answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer

    watch = GameWatch(tracker, lister=lister, sleep=FakeSleep(clock), interval=5.0)
    task = asyncio.create_task(watch.run())
    for _ in range(8):
        await asyncio.sleep(0)
    assert not task.done()  # one failed poll must not end game detection for good
    assert tracker.running
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_an_unreadable_snapshot_is_an_error_not_an_empty_list(monkeypatch):
    monkeypatch.setattr(gamewatch._kernel32, "Process32FirstW", lambda snapshot, entry: 0)
    with pytest.raises(OSError):
        list_process_names()


def test_a_long_silence_between_polls_is_not_playtime(tracker, store, clock, recorder):
    _polls(tracker, clock, False, 1)
    start = clock.now()
    _polls(tracker, clock, True, 24)  # two minutes of play
    last_seen = clock.now() - timedelta(seconds=5)
    clock.advance(hours=8)  # the PC slept with the game open; nobody was watching
    resumed = clock.now()
    _polls(tracker, clock, True, 24)  # two more minutes
    assert tracker.running
    assert tracker.session_started_at == resumed
    sessions = store.sessions_overlapping(start - timedelta(hours=1), clock.now() + timedelta(hours=1))
    assert [(session.started_at, session.ended_at) for session in sessions][0] == (start, last_seen)
    assert sessions[1].started_at == resumed
    assert sum((session.ended_at - session.started_at).total_seconds() for session in sessions) < 5 * 60
    assert recorder.calls == ["started"]  # the game never stopped, so no after-session sync is planned
