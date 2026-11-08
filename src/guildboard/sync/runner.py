"""One sync run: fetch the groups that are due, store what came back, record how it went."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Awaitable, Callable, Sequence

from guildboard.clock import Clock
from guildboard.logging_setup import redact
from guildboard.metrics import SOURCE_PREFIX
from guildboard.records import (
    FetchResult,
    LoginNeeded,
    Offline,
    RateLimited,
    Source,
    SourceError,
    VerificationNeeded,
)
from guildboard.store import Store
from guildboard.sync.apply import apply_result

log = logging.getLogger(__name__)

RETRY_DELAYS = (10.0, 30.0, 90.0)

# These mean the whole run cannot continue; the groups not yet fetched are retried next time.
_STOPS_THE_RUN = (LoginNeeded, VerificationNeeded, Offline, RateLimited)

_STATE_BY_KIND = {
    "login_needed": "login_needed",
    "verification_needed": "verification_needed",
    "switch_off": "switch_off",
    "offline": "offline",
    "rate_limited": "error",
    "error": "error",
}


@dataclass(frozen=True)
class RunResult:
    run_id: int
    outcome: str
    state: str
    message: str | None
    groups_ok: tuple[str, ...]
    groups_failed: tuple[str, ...]


class SyncRunner:
    def __init__(
        self,
        source: Source,
        store: Store,
        clock: Clock,
        server: Callable[[], str],
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        *,
        after_group: Callable[[str, datetime], None] | None = None,
        before_fetch: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._source = source
        # Awaited before the source is first asked for anything: a live source is made in a thread at the start.
        self._before_fetch = before_fetch
        self._store = store
        self._clock = clock
        self._server = server
        self._sleep = sleep
        # Told each group that was read and stored, with the time it was read: what is made of a group's answers follows.
        self._after_group = after_group

    async def run(self, trigger: str, groups: Sequence[str]) -> RunResult:
        run_id = self._store.start_run(trigger, self._clock.now())
        ok: list[str] = []
        failed: list[str] = []
        kind: str | None = None
        message: str | None = None
        outcome, state = "failed", "error"
        try:
            pending = list(groups)
            while pending:
                group = pending.pop(0)
                try:
                    result = await self._fetch(group)
                except SourceError as error:
                    failed.append(group)
                    self._store.mark_group_failed(group)
                    kind, message = error.kind, redact(str(error)) or None
                    if isinstance(error, _STOPS_THE_RUN):
                        for rest in pending:
                            failed.append(rest)
                            self._store.mark_group_failed(rest)
                        pending.clear()
                    continue
                except Exception:
                    # A fault in the source itself. Each group succeeds or fails on its own.
                    log.exception("fetching the %s data failed unexpectedly", group)
                    failed.append(group)
                    self._store.mark_group_failed(group)
                    kind, message = "error", "The sync failed unexpectedly. See the log file."
                    continue
                try:
                    apply_result(self._store, run_id, result, self._server())
                except Exception:
                    log.exception("the %s data could not be stored", group)
                    failed.append(group)
                    self._store.mark_group_failed(group)
                    kind, message = "error", f"Guild Board could not store the {group} data. See the log file."
                    continue
                if result.record is None:
                    failed.append(group)
                    self._store.mark_group_failed(group)
                    kind = "error"
                    message = redact(result.problem or f"HoYoLAB's {group} data could not be read.")
                else:
                    ok.append(group)
                    self._store.mark_group_ok(group, result.fetched_at)
                    self._stored(group, result.fetched_at)
            if not failed:
                outcome, state, kind, message = "ok", "ok", None, None
            else:
                outcome = "partial" if ok else "failed"
                state = _STATE_BY_KIND[kind or "error"]
        except BaseException:
            # Guild Board is closing, or something broke beyond one group. The run must not stay "running".
            outcome = "partial" if ok else "failed"
            kind, message = "error", "Guild Board closed before this sync finished."
            raise
        finally:
            self._store.finish_run(run_id, self._clock.now(), outcome, kind, message)
        return RunResult(run_id, outcome, state, message, tuple(ok), tuple(failed))

    def _stored(self, group: str, at: datetime) -> None:
        """What follows a group that was stored. It never costs the group: a failure is logged, and the run goes on."""
        if self._after_group is None:
            return
        try:
            self._after_group(group, at)
        except Exception:
            log.exception("what follows the %s data could not be done", group)

    async def _fetch(self, group: str) -> FetchResult:
        # The diary asks for its history (three months) until it holds its primogems by source: on the first sync, and
        # once more for a database kept before the sources were, so that the next version's events estimate has the
        # last full months at once.
        first_time = group == "diary" and not self._store.latest_values(SOURCE_PREFIX)
        attempt = 0
        if self._before_fetch is not None:
            await self._before_fetch()
        while True:
            try:
                return await self._source.fetch(group, now=self._clock.now(), first_time=first_time)
            except Offline:
                if attempt >= len(RETRY_DELAYS):
                    raise
                await self._sleep(RETRY_DELAYS[attempt])
                attempt += 1
