"""Game-day arithmetic. A game day starts at the 04:00 server-time reset."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

RESET_HOUR = 4

SERVER_UTC_OFFSET_HOURS = {
    "os_usa": -5,
    "os_euro": 1,
    "os_asia": 8,
    "os_cht": 8,
    "cn_gf01": 8,
    "cn_qd01": 8,
}
# The servers as the player knows them, the same names as the Settings page: the login window and the Wrapped poster.
SERVER_NAMES = {
    "os_euro": "Europe", "os_usa": "America", "os_asia": "Asia", "os_cht": "TW, HK, MO",
    "cn_gf01": "China", "cn_qd01": "China",
}


def server_tz(server: str) -> timezone:
    try:
        return timezone(timedelta(hours=SERVER_UTC_OFFSET_HOURS[server]))
    except KeyError:
        raise ValueError(f"unknown server: {server!r}") from None


def game_day(when: datetime, server: str) -> date:
    """The game day that the instant `when` belongs to."""
    if when.tzinfo is None:
        raise ValueError("when must be timezone-aware")
    local = when.astimezone(server_tz(server))
    return (local - timedelta(hours=RESET_HOUR)).date()


def game_day_start(day: date, server: str) -> datetime:
    """The first instant of a game day, in UTC."""
    local = datetime(day.year, day.month, day.day, RESET_HOUR, tzinfo=server_tz(server))
    return local.astimezone(timezone.utc)


def days_inclusive(first: date, last: date) -> list[date]:
    if last < first:
        return []
    return [first + timedelta(days=offset) for offset in range((last - first).days + 1)]


def week_start(day: date) -> date:
    """The Monday of the week that contains `day`."""
    return day - timedelta(days=day.weekday())
