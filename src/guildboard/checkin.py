"""The daily check-in (the daily check-in design): this month's rewards, whether today's is claimed, and the one claim.

The status is a read, asked for while a page shows it. The claim is the second of the two things Guild Board ever changes
on the account, beside a gift code: `claim` is reached from the one POST route alone, so nothing but the player's press
sends it, and each press sends it at most once. Nothing here is stored: HoYoLAB holds the truth, so there is no table and
nothing to sync.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Protocol

log = logging.getLogger(__name__)

# The check-in's day turns over at midnight in UTC+8 on every server: not the game's own 04:00 reset.
RESET_ZONE = timezone(timedelta(hours=8))
LOOK_GAP = 1800.0  # seconds between looks while the status is today's: it changes only here, or on HoYoLAB's own page
RETRY_GAP = 120.0  # and after a look that failed
WEBSITE = "https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481"
RESULT_TEXT = {
    "claimed": "Claimed.",
    "already": "Already claimed today.",
    "verify": "HoYoLAB asks for a check this time. Claim on its website.",
    "login": "Log in to HoYoLAB to claim.",
    "failed": "The reward could not be claimed. Try again, or claim on HoYoLAB's website.",
}


class CheckInRefused(Exception):
    """The claim cannot be sent. The message is fit to show."""


class Clock(Protocol):
    def now(self) -> datetime: ...


def check_in_day(now: datetime) -> date:
    return now.astimezone(RESET_ZONE).date()


def next_reset(now: datetime) -> datetime:
    """The next midnight in UTC+8, in UTC."""
    next_day = check_in_day(now) + timedelta(days=1)
    return datetime(next_day.year, next_day.month, next_day.day, tzinfo=RESET_ZONE).astimezone(timezone.utc)


class CheckIn:
    def __init__(
        self, source: Any, clock: Clock, changed: Callable[[], None], *, ready: Callable[[], bool],
        before_use: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._source = source
        self._before_use = before_use  # awaited before the source is first asked for anything (see Core._source_ready)
        self._clock = clock
        self._changed = changed
        self._ready = ready  # the login and the first run's consent: nothing is asked of HoYoverse before them
        self._status: dict[str, Any] | None = None
        self._day: date | None = None  # the day `_status` was read on
        self._looked_at: datetime | None = None
        self._read_failed = False
        self._claiming = False
        self._claims_done = 0  # a look that was on its way across a claim is out of date when it lands
        self._result: str | None = None
        self._result_day: date | None = None
        self._task: asyncio.Task[None] | None = None

    def _current(self) -> dict[str, Any] | None:
        """The status, when it is of this check-in day."""
        return self._status if self._day == check_in_day(self._clock.now()) else None

    def model(self) -> dict[str, Any]:
        now = self._clock.now()
        status = self._current()
        result = self._result if self._result_day == check_in_day(now) else None
        rewards = [] if status is None else status["rewards"]
        return {
            "ready": self._ready(),
            "read": status is not None,
            "read_failed": self._read_failed,
            "claiming": self._claiming,
            "claimed_today": status is not None and status["claimed_today"],
            "claimed_days": 0 if status is None else status["claimed_days"],
            "rewards": [
                {
                    "name": reward["name"],
                    "amount": reward["amount"],
                    "icon": f"/api/checkin/icon/{index}" if reward["icon"] else "",
                }
                for index, reward in enumerate(rewards)
            ],
            "next_reset": next_reset(now).isoformat(),
            "result": result,
            "text": None if result is None else RESULT_TEXT[result],
            "website": WEBSITE,
        }

    def icon_url(self, index: int) -> str | None:
        """HoYoverse's address of a reward's picture, for the core's icon cache."""
        status = self._current()
        if status is None or not 0 <= index < len(status["rewards"]):
            return None
        return status["rewards"][index]["icon"]

    def look_soon(self) -> None:
        """Start a look in the background, unless one is running; the page hears of what it found."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._look_safely())

    async def _look_safely(self) -> None:
        try:
            await self.look()
        except Exception:
            log.exception("the look at the daily check-in failed")

    async def look(self, *, force: bool = False) -> None:
        if not self._ready():
            return
        now = self._clock.now()
        if not force and self._looked_at is not None:
            gap = RETRY_GAP if self._read_failed else LOOK_GAP
            recent = (now - self._looked_at).total_seconds() < gap
            if recent and (self._read_failed or self._current() is not None):
                return
        self._looked_at = now
        claims = self._claims_done
        failed_before = self._read_failed
        try:
            if self._before_use is not None:
                await self._before_use()
            status = await self._source.checkin_status()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            log.info("Could not read the daily check-in (%s)", type(error).__name__)
            self._read_failed = True
            if not failed_before:
                self._changed()
            return
        if claims != self._claims_done:
            return
        self._status, self._day = status, check_in_day(now)
        self._read_failed = False
        self._changed()

    async def claim(self) -> dict[str, Any]:
        """Claim today's reward, on the player's press. A second press while one is on its way, or on a claimed day, sends
        nothing. CheckInRefused where it cannot be sent."""
        if not self._ready():
            raise CheckInRefused(RESULT_TEXT["login"])
        status = self._current()
        if self._claiming or (status is not None and status["claimed_today"]):
            return self.model()
        self._claiming = True
        self._changed()
        try:
            try:
                if self._before_use is not None:
                    await self._before_use()
                result = await self._source.claim_checkin()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("claiming the daily check-in failed")
                result = "failed"
            self._claims_done += 1
            self._result, self._result_day = result, check_in_day(self._clock.now())
            status = self._current()
            if result in ("claimed", "already") and status is not None:
                # The claim counts even if the read after it fails.
                self._status = {**status, "claimed_today": True, "claimed_days": status["claimed_days"] + 1}
            await self.look(force=True)
        finally:
            self._claiming = False
            self._changed()
        return self.model()

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
