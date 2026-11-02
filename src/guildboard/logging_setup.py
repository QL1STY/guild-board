"""The log file. Registered secrets (the session token) are masked before anything is written (H4). An exception that
nothing caught goes into it too.

A secret is masked from its registration until it is forgotten. The login's cookies, the local secrets and the online
session's tokens are never forgotten; a history key is registered when its link is first tried and forgotten when the
link is let go, so that the registry holds the keys in use and no more (pulls/gamecache.py). Two holders of the same
value each register it and each forget it: it stays masked until the last of them lets it go. However long Guild Board
runs, the registry holds MOST_SECRETS values at most, the one registered longest ago going first, besides the lasting
ones: the core's launch secret and session token, registered once at its start, which nothing pushes out."""
from __future__ import annotations

import logging
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

MIN_SECRET_LENGTH = 8
MASK = "[redacted]"
# Far more than a session registers: the login's cookies, the local secrets, the keys of the links held and the online
# session's tokens, two each time they are renewed (an hour apart by Supabase's default): about 80 days of renewals.
MOST_SECRETS = 4_096

# Each secret with how many holders registered it, the one registered longest ago first.
_secrets: dict[str, int] = {}
# Of them, the ones the cap never pushes out: registered once for the life of the process (register_secret's `lasting`).
_lasting: set[str] = set()
# The secrets longest first, as redact() goes through them: made anew when one comes or goes, never changed in place,
# so that a thread logging reads a whole one while another registers.
_longest_first: tuple[str, ...] = ()
_lock = threading.Lock()


def _sort() -> None:
    global _longest_first
    _longest_first = tuple(sorted(_secrets, key=len, reverse=True))


def register_secret(value: str, *, lasting: bool = False) -> None:
    """Mask `value` in the log from now on, for one holder more. A `lasting` value, registered once for the life of the
    process and never registered again, stays whatever the cap; the cap counts the others alone."""
    if not isinstance(value, str) or len(value) < MIN_SECRET_LENGTH:
        return
    with _lock:
        holders = _secrets.pop(value, 0)
        _secrets[value] = holders + 1  # registered again, it counts as the newest
        if lasting:
            _lasting.add(value)
        if holders == 0:
            while len(_secrets) - len(_lasting) > MOST_SECRETS:
                del _secrets[next(secret for secret in _secrets if secret not in _lasting)]
            _sort()


def forget_secret(*forms: str) -> None:
    """One holder lets each of `forms` go: a form no holder holds any more is no longer masked. A form that was never
    registered, or is forgotten more often than it was registered, is passed over."""
    with _lock:
        gone = False
        for form in forms:
            holders = _secrets.get(form, 0)
            if holders > 1:
                _secrets[form] = holders - 1
            elif holders == 1:
                del _secrets[form]
                _lasting.discard(form)
                gone = True
        if gone:
            _sort()


def forget_secrets() -> None:
    with _lock:
        _secrets.clear()
        _lasting.clear()
        _sort()


def redact(text: str) -> str:
    # Longest first: when one secret contains another, replacing the shorter one first would leave
    # the rest of the longer one readable.
    for secret in _longest_first:
        if secret in text:
            text = text.replace(secret, MASK)
    return text


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # a malformed log call must not take the program down
            message = str(record.msg)
        record.msg, record.args = redact(message), None
        if record.exc_info:
            record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None
        elif record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def shutdown_logging() -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "guildboard", False):
            root.removeHandler(handler)
            handler.close()


def _log_uncaught_exceptions() -> None:
    """An exception that nothing caught, one raised in a Qt slot among them, goes into the log with its traceback:
    under pythonw nothing else would show it. Python's own handling of it then goes on as before."""
    previous = sys.excepthook
    if getattr(previous, "guildboard", False):
        return  # hooked in already

    def hook(kind: type[BaseException], value: BaseException, tb: object) -> None:
        if issubclass(kind, Exception):  # not an interrupt or an exit
            logging.getLogger("guildboard").error("an exception was not caught", exc_info=(kind, value, tb))
        previous(kind, value, tb)

    hook.guildboard = True  # marks the hook as ours
    sys.excepthook = hook


def setup_logging(logs_dir: Path) -> None:
    """Opens the log, once Guild Board knows that this start is the one that runs: with its window, and without."""
    shutdown_logging()
    logs_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        logs_dir / "guildboard.log", maxBytes=1_000_000, backupCount=4, encoding="utf-8"
    )
    handler.guildboard = True  # marks the handler as ours
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactionFilter())
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    for noisy in ("genshin", "aiohttp", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _log_uncaught_exceptions()
