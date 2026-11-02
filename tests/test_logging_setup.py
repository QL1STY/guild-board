import logging
import sys

import pytest

from guildboard import logging_setup
from guildboard.logging_setup import redact, register_secret, setup_logging, shutdown_logging

SECRET = "v2_MARKER-LOG-SECRET-0123456789"  # made up, as every test's token is


@pytest.fixture(autouse=True)
def clean():
    logging_setup.forget_secrets()
    yield
    shutdown_logging()
    logging_setup.forget_secrets()


def test_registered_secrets_are_masked():
    register_secret(SECRET)
    assert redact(f"cookie ltoken_v2={SECRET}; done") == "cookie ltoken_v2=[redacted]; done"
    assert redact("nothing to hide") == "nothing to hide"


def test_short_values_are_not_registered():
    register_secret("42")
    register_secret("")
    assert redact("uid 42") == "uid 42"


def test_log_file_never_contains_a_secret(tmp_path):
    register_secret(SECRET)
    setup_logging(tmp_path)
    log = logging.getLogger("guildboard.test")
    log.info("plain %s", "message")
    log.warning("token in the message: " + SECRET)
    log.warning("token in the arguments: %s", {"ltoken_v2": SECRET})
    try:
        raise RuntimeError(f"token in an exception: {SECRET}")
    except RuntimeError:
        log.exception("something failed")
    shutdown_logging()
    text = (tmp_path / "guildboard.log").read_text(encoding="utf-8")
    assert SECRET not in text
    assert text.count("[redacted]") == 3
    assert "plain message" in text
    assert "RuntimeError" in text


def test_an_exception_nothing_caught_goes_into_the_log(tmp_path, monkeypatch):
    # Under pythonw nothing shows an exception that nothing caught, one raised in a Qt slot among them: Python hands it
    # to sys.excepthook.
    passed_on: list[type] = []
    monkeypatch.setattr(sys, "excepthook", lambda kind, value, traceback: passed_on.append(kind))
    register_secret(SECRET)
    setup_logging(tmp_path)
    setup_logging(tmp_path)  # the log started again hooks in once
    try:
        raise RuntimeError(f"close_overlay failed, near {SECRET}")
    except RuntimeError:
        sys.excepthook(*sys.exc_info())
    shutdown_logging()
    text = (tmp_path / "guildboard.log").read_text(encoding="utf-8")
    assert text.count("ERROR guildboard: an exception was not caught") == 1
    assert "Traceback" in text and "RuntimeError: close_overlay failed, near [redacted]" in text
    assert SECRET not in text
    assert passed_on == [RuntimeError]  # and Python's own handling of it goes on, once


@pytest.mark.qt_no_exception_capture  # the hook is what this tests, not pytest-qt's own
def test_an_exception_raised_in_a_qt_slot_goes_into_the_log(qtbot, tmp_path, monkeypatch):
    from PySide6.QtCore import QObject, Signal

    class Source(QObject):
        fired = Signal()

    def close_overlay() -> None:
        raise RuntimeError("the overlay could not close")

    passed_on: list[type] = []
    monkeypatch.setattr(sys, "excepthook", lambda kind, value, traceback: passed_on.append(kind))
    setup_logging(tmp_path)
    source = Source()
    source.fired.connect(close_overlay)
    source.fired.emit()  # PySide hands what the slot raised to sys.excepthook
    shutdown_logging()
    text = (tmp_path / "guildboard.log").read_text(encoding="utf-8")
    assert "an exception was not caught" in text and "RuntimeError: the overlay could not close" in text
    assert passed_on == [RuntimeError]


def test_setup_is_repeatable(tmp_path):
    setup_logging(tmp_path)
    setup_logging(tmp_path)
    ours = [handler for handler in logging.getLogger().handlers if getattr(handler, "guildboard", False)]
    assert len(ours) == 1


def test_rotation_settings(tmp_path):
    setup_logging(tmp_path)
    handler = next(h for h in logging.getLogger().handlers if getattr(h, "guildboard", False))
    assert handler.maxBytes == 1_000_000
    assert handler.backupCount == 4  # five files in total


def test_a_secret_inside_a_longer_secret_does_not_expose_the_rest():
    for number in range(12):
        inner = f"inner-secret-{number:02d}"
        register_secret(inner)
        register_secret(f"prefix-{number:02d}-{inner}-suffix")
    for number in range(12):
        assert redact(f"value=prefix-{number:02d}-inner-secret-{number:02d}-suffix;") == "value=[redacted];"


def test_a_forgotten_secret_is_no_longer_masked():
    # A key lives as long as its link: when the link is let go, its forms are forgotten, and the registry holds them no
    # more. Forgetting what was never registered does nothing.
    register_secret("KEY-FORM-ONE-0123456789")
    register_secret("KEY-FORM-TWO-0123456789")
    logging_setup.forget_secret("KEY-FORM-ONE-0123456789", "NEVER-REGISTERED-0123456789")
    assert redact("KEY-FORM-ONE-0123456789 KEY-FORM-TWO-0123456789") == "KEY-FORM-ONE-0123456789 [redacted]"
    assert "KEY-FORM-ONE-0123456789" not in logging_setup._secrets
    logging_setup.forget_secret()  # no form at all
    assert redact("KEY-FORM-TWO-0123456789") == "[redacted]"


def test_a_secret_registered_twice_stays_masked_until_it_is_forgotten_twice():
    # The link kept from one press and a later press that tries the same key each register it, and each forgets it when
    # it lets its link go: the key stays masked while either holds it.
    register_secret("SHARED-KEY-0123456789")
    register_secret("SHARED-KEY-0123456789")
    logging_setup.forget_secret("SHARED-KEY-0123456789")
    assert redact("SHARED-KEY-0123456789") == "[redacted]"
    logging_setup.forget_secret("SHARED-KEY-0123456789")
    assert redact("SHARED-KEY-0123456789") == "SHARED-KEY-0123456789"
    logging_setup.forget_secret("SHARED-KEY-0123456789")  # once more than it was registered: nothing happens
    register_secret("SHARED-KEY-0123456789")
    assert redact("SHARED-KEY-0123456789") == "[redacted]"


def test_the_registry_keeps_the_newest_secrets_up_to_its_cap(monkeypatch):
    # However long Guild Board runs, the registry stays bounded: past the cap the secret registered longest ago goes
    # first. A secret registered again counts as new, so the ones in use stay.
    assert logging_setup.MOST_SECRETS >= 1_000
    monkeypatch.setattr(logging_setup, "MOST_SECRETS", 5)
    for number in range(7):
        register_secret(f"SECRET-NUMBER-{number:04d}")
    register_secret("SECRET-NUMBER-0003")
    register_secret("SECRET-NUMBER-0099")
    assert list(logging_setup._secrets) == [f"SECRET-NUMBER-{n:04d}" for n in (4, 5, 6, 3, 99)]
    assert redact("SECRET-NUMBER-0000 SECRET-NUMBER-0003") == "SECRET-NUMBER-0000 [redacted]"


def test_a_lasting_secret_stays_whatever_comes_after_it(monkeypatch):
    # A secret registered once for the life of the process, as the core's launch secret and session token are, stays
    # however many come after it: the cap counts the others, and pushes out the oldest of those alone.
    monkeypatch.setattr(logging_setup, "MOST_SECRETS", 3)
    register_secret("LASTING-SECRET-0123456789", lasting=True)
    for number in range(10):
        register_secret(f"ROTATED-SESSION-{number:04d}")
    assert redact("LASTING-SECRET-0123456789") == "[redacted]"
    assert [secret for secret in logging_setup._secrets if secret.startswith("ROTATED")] == [
        f"ROTATED-SESSION-{number:04d}" for number in (7, 8, 9)
    ]


def test_the_cores_launch_secret_and_session_token_stay_masked_however_long_it_runs(tmp_path, clock, monkeypatch):
    from guildboard.config import AppPaths
    from guildboard.core import Core

    monkeypatch.setattr(logging_setup, "MOST_SECRETS", 3)
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, process_lister=lambda: set())
    try:
        for number in range(10):
            register_secret(f"ROTATED-SESSION-{number:04d}")  # the online session's tokens, renewed hour after hour
        assert redact(f"{core.launch_secret} {core.session_token}") == "[redacted] [redacted]"
    finally:
        core.store.close()


def test_secrets_can_be_registered_and_forgotten_while_other_threads_log(tmp_path):
    # Keys are registered in the threads the game's files are read in and redacted in whichever thread logs.
    import threading

    setup_logging(tmp_path)
    log = logging.getLogger("guildboard.test")
    failures: list[BaseException] = []

    def churn(worker: int) -> None:
        try:
            for number in range(300):
                value = f"THREAD-{worker}-SECRET-{number:04d}"
                register_secret(value)
                log.info("value %s", value)
                logging_setup.forget_secret(value)
        except BaseException as error:  # noqa: BLE001 - the test reports it
            failures.append(error)

    workers = [threading.Thread(target=churn, args=(worker,)) for worker in range(4)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    shutdown_logging()
    assert failures == []
    text = (tmp_path / "guildboard.log").read_text(encoding="utf-8")
    assert "THREAD-" not in text and text.count("value [redacted]") == 1200
    assert not any(name.startswith("THREAD-") for name in logging_setup._secrets)
