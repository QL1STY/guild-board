import asyncio
import threading
import time
from concurrent.futures import Future
from datetime import datetime, timezone

from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.shell.corethread import CoreSignals, CoreThread, Deliver
from guildboard.store import Store

START = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def _demo(tmp_path, delay: float = 0.0):
    def make() -> Core:
        core = Core(AppPaths(tmp_path / "data"), demo=True, demo_now=START, process_lister=lambda: set())
        core.source.delay = delay
        return core

    return make


def _started(qtbot, make) -> tuple[CoreThread, CoreSignals, str]:
    signals = CoreSignals()
    thread = CoreThread(make, signals)
    with qtbot.waitSignal(signals.ready, timeout=30_000) as ready:
        thread.start()
    return thread, signals, ready.args[0]


def test_the_core_runs_beside_qt_and_answers_calls(qtbot, tmp_path):
    thread, signals, link = _started(qtbot, _demo(tmp_path))
    assert link.startswith("http://127.0.0.1:") and "/launch?k=" in link
    assert thread.call(lambda core: core.status()["mode"]).result(5) == "demo"
    assert thread.call(lambda core: asyncio.sleep(0, result="awaited")).result(5) == "awaited"
    with qtbot.waitSignal(signals.finished, timeout=20_000):
        thread.stop()
    assert not thread.is_alive()


def test_window_requests_and_new_settings_reach_qt(qtbot, tmp_path):
    thread, signals, _ = _started(qtbot, _demo(tmp_path))
    with qtbot.waitSignal(signals.window) as asked:
        assert thread.call(lambda core: core.window_requests("verify")).result(5) is True
    assert asked.args == ["verify"]
    with qtbot.waitSignal(signals.settings) as changed:
        thread.call(lambda core: core.update_settings({"start_with_windows": True})).result(5)
    assert changed.args[0].start_with_windows is True
    thread.stop()


def test_the_settings_at_the_start_come_before_the_link(qtbot, tmp_path):
    # Sent on the core's thread like every later change, so that a change cannot be overtaken by older settings.
    signals = CoreSignals()
    seen: list[tuple[str, object]] = []
    signals.settings.connect(lambda settings: seen.append(("settings", settings.start_with_windows)))
    signals.ready.connect(lambda link: seen.append(("ready", link.startswith("http://127.0.0.1:"))))
    thread = CoreThread(_demo(tmp_path), signals)
    with qtbot.waitSignal(signals.ready, timeout=30_000):
        thread.start()
    assert seen == [("settings", False), ("ready", True)]
    thread.stop()


def test_qt_receives_its_own_copy_of_the_settings(qtbot, tmp_path):
    signals = CoreSignals()
    received: list = []
    signals.settings.connect(received.append)
    thread = CoreThread(_demo(tmp_path), signals)
    with qtbot.waitSignal(signals.ready, timeout=30_000):
        thread.start()
    first = received[0]
    assert first is not thread.core.settings and first == thread.core.settings
    with qtbot.waitSignal(signals.settings):
        thread.call(lambda core: core.set_paused(True)).result(5)
    assert first.sync_paused is False  # the core changed its own object, not Qt's
    thread.stop()


def test_a_core_that_cannot_start_says_why(qtbot, tmp_path):
    Core(AppPaths(tmp_path / "data"), demo=True, process_lister=lambda: set()).store.close()
    signals = CoreSignals()
    thread = CoreThread(lambda: Core(AppPaths(tmp_path / "data"), demo=False, process_lister=lambda: set()), signals)
    with qtbot.waitSignal(signals.failed, timeout=30_000) as failed:
        thread.start()
    assert "holds the demo's made-up data" in failed.args[0]
    thread.join(10)
    assert not thread.is_alive()


def test_closing_during_a_sync_stops_at_once_and_says_so_in_the_log(qtbot, tmp_path):
    thread, _, _ = _started(qtbot, _demo(tmp_path, delay=1.0))  # each data group takes a second
    qtbot.waitUntil(lambda: thread.call(lambda core: core.status()["sync"]["state"]).result(5) == "syncing", timeout=10_000)
    began = time.perf_counter()
    thread.stop()
    assert not thread.is_alive()
    assert time.perf_counter() - began < 10
    store = Store.open(tmp_path / "data" / "guildboard.db", tmp_path / "data" / "backups", START)
    assert store.recent_runs()[0].message == "Guild Board closed before this sync finished."
    store.close()


def test_a_stop_right_after_the_start_ends_the_core_at_once(qtbot, tmp_path):
    signals = CoreSignals()
    thread = CoreThread(_demo(tmp_path), signals)
    started = time.monotonic()
    thread.start()
    thread.stop(timeout=20)
    assert not thread.is_alive() and time.monotonic() - started < 10


def test_an_answer_from_the_core_is_handed_to_qt_on_its_own_thread(qtbot):
    deliver = Deliver()
    future: Future = Future()
    seen: list = []
    deliver.then(future, lambda done: seen.append((done.result(), threading.current_thread() is threading.main_thread())))
    threading.Thread(target=lambda: future.set_result(42)).start()
    qtbot.waitUntil(lambda: seen == [(42, True)])


def test_an_answer_that_was_cancelled_is_dropped(qtbot):
    deliver = Deliver()
    future: Future = Future()
    future.cancel()
    called: list = []
    deliver.then(future, called.append)
    qtbot.wait(50)
    assert called == []
