"""A stand-in for netpolicy.fetch_cloud: everything online is tested off the internet (the online plan, Task A3)."""
from __future__ import annotations

import json
from typing import Any, Callable, Mapping

import pytest

from guildboard.netpolicy import CloudAnswer

USER_ID = "00000000-0000-0000-0000-00000000000a"
USAGE = ("POST", "/rest/v1/rpc/sync_usage")
# What sync_usage answers for a made-up account about a sixth full: PostgREST gives a function that returns a table as a list of rows.
USAGE_ROW = {
    "rows_held": 1_911, "rows_limit": 20_000, "bytes_held": 722_000, "bytes_limit": 4_194_304, "has_place": True, "seats_full": False,
}


def answer(status: int, body: Any = None) -> tuple[int, Any]:
    """An answer of the server's. The body is sent as it is when it is bytes, as JSON otherwise; None is an empty body."""
    return status, body


def token_answer(
    access: str = "NEW-ACCESS-0123456789", refresh: str = "NEW-REFRESH-0123456789", *, expires_in: int = 3600,
    user_id: str = USER_ID, metadata: Mapping[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    """Auth's answer when it gives a session, as /auth/v1/token gives it."""
    return 200, {
        "access_token": access, "token_type": "bearer", "expires_in": expires_in, "expires_at": 1_900_000_000,
        "refresh_token": refresh,
        "user": {"id": user_id, "aud": "authenticated", "role": "authenticated", "user_metadata": dict(metadata or {})},
    }


class FakeCloud:
    """A callable with fetch_cloud's signature. It records each request as (method, path, headers, body), answers from
    `answers`, a dict of (method, path prefix) to an outcome, and fails the test on anything unscripted. The longest
    prefix that fits answers. An outcome is an answer or an exception, which is raised, or a list of those, one for each
    request in turn, the last repeating. An answer carries no date, as one whose server's clock is not known, unless
    `server_clock` gives the server's time: then each says it in whole seconds, as a Date header does.

    sync_usage, which the core asks after a sync that moved rows, answers with `USAGE_ROW` when a test scripted nothing for it, and
    such a request is counted in `usage_reads` and left out of `requests`, so that a test of the other requests is not about it."""

    def __init__(
        self, answers: Mapping[tuple[str, str], Any] | None = None, *, server_clock: Callable[[], float] | None = None,
    ) -> None:
        self.answers: dict[tuple[str, str], Any] = dict(answers or {})
        self.requests: list[tuple[str, str, dict[str, str], bytes | None]] = []
        self.server_clock = server_clock
        self.usage_reads = 0  # how often sync_usage was asked, where it was answered by default

    def __call__(
        self, path: str, *, method: str = "GET", headers: Mapping[str, str] | None = None, body: bytes | None = None,
        timeout: float = 20.0, max_bytes: int = 4_000_000,
    ) -> tuple[int, bytes]:
        fits = [key for key in self.answers if key[0] == method and path.startswith(key[1])]
        if not fits and (method, path) == USAGE:
            self.usage_reads += 1
            outcome: Any = answer(200, [USAGE_ROW])
        else:
            self.requests.append((method, path, dict(headers or {}), body))
            if not fits:
                pytest.fail(f"The online client sent {method} {path}, which this test did not script.")
            outcome = self.answers[max(fits, key=lambda key: len(key[1]))]
        if isinstance(outcome, list):
            outcome = outcome.pop(0) if len(outcome) > 1 else outcome[0]
        if isinstance(outcome, BaseException):
            raise outcome
        status, body_out = outcome
        sent = b"" if body_out is None else body_out if isinstance(body_out, bytes) else json.dumps(body_out).encode("utf-8")
        if self.server_clock is None:
            return status, sent
        return CloudAnswer(status, sent, float(int(self.server_clock())))

    def sent(self) -> list[str]:
        """Each request as "METHOD path"."""
        return [f"{method} {path}" for method, path, _, _ in self.requests]

    def body(self, index: int = -1) -> Any:
        """A request's body, read as JSON."""
        return json.loads(self.requests[index][3] or b"null")
