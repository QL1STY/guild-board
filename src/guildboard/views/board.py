"""The Board model (spec 13.3): what the widgets of Guild Board's and HoYoLAB's data need, in one answer.

The server's time and the next resets, today's play and that of the six game days before it, the achievement totals
beside HoYoLAB's count, the Real-Time Notes with when they were read (spec 13.5), and the newest change the Board's
undo line can offer.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Mapping

from guildboard.achievements.catalog import Catalog
from guildboard.gameday import SERVER_UTC_OFFSET_HOURS, days_inclusive, game_day, game_day_start, week_start
from guildboard.history import History
from guildboard.metrics import character_icon_key
from guildboard.store import Store, iso
from guildboard.views.achievements import achievement_totals

# The game days the Playtime widget's columns show: today and the six before it.
PLAY_WEEK_DAYS = 7


def _resets(server: str, now: datetime) -> dict[str, str]:
    """The next daily reset, and the next weekly one on Monday, at 04:00 server time."""
    today = game_day(now, server)
    return {
        "daily_at": iso(game_day_start(today + timedelta(days=1), server)),
        "weekly_at": iso(game_day_start(week_start(today) + timedelta(days=7), server)),
    }


def _playtime(
    history: History, server: str, today: date, running: bool, session_started_at: datetime | None
) -> dict[str, Any]:
    """Whether the game runs and since when, and the minutes played on each of the last seven game days, today's
    last, for the Playtime widget's columns (look pass spec 9.10). A day with no play counts 0."""
    first = today - timedelta(days=PLAY_WEEK_DAYS - 1)
    minutes = history.playtime_minutes(first, today, server)
    week = [{"day": day.isoformat(), "minutes": int(minutes.get(day, 0.0))} for day in days_inclusive(first, today)]
    return {
        "running": running,
        "session_started_at": iso(session_started_at) if session_started_at is not None else None,
        "today_minutes": week[-1]["minutes"],
        "week": week,
    }


def _expedition(expedition: Mapping[str, Any]) -> dict[str, Any]:
    """An expedition's picture, served by the icon cache (metrics.notes_labels), and when it is back."""
    key = character_icon_key(str(expedition.get("icon_url", "")))
    return {"icon": f"/api/icon/{key}" if key is not None else None, "back_at": expedition.get("back_at")}


def _notes(store: Store, server: str, now: datetime) -> dict[str, Any] | None:
    """The notes as last read. A record kept before plan 2A-3 has no expeditions, transformer or full time."""
    latest = store.latest_doc("notes")
    if latest is None:
        return None
    read_at, doc = latest
    read_day, today = game_day(read_at, server), game_day(now, server)
    expeditions = doc.get("expeditions")
    return {
        "read_at": iso(read_at),
        "read_today": read_day == today,  # since the daily reset: the commissions are today's
        "read_this_week": week_start(read_day) == week_start(today),  # since Monday's reset: the boss discounts
        "resin_full_at": doc.get("resin_full_at"),
        "expeditions": None if expeditions is None else [_expedition(expedition) for expedition in expeditions],
        "expeditions_max": int(doc.get("expeditions_max", 0)),
        "transformer": {"ready_at": doc.get("transformer_ready_at")} if doc.get("transformer_obtained") else None,
        "realm_currency": int(doc.get("realm_currency", 0)),
        "realm_currency_max": int(doc.get("realm_currency_max", 0)),
        "realm_currency_full_at": doc.get("realm_currency_full_at"),
        "commissions_done": int(doc.get("commissions_done", 0)),
        "commissions_max": int(doc.get("commissions_max", 0)),
        "boss_discounts_left": int(doc.get("boss_discounts_left", 0)),
        "boss_discounts_max": int(doc.get("boss_discounts_max", 0)),
    }


def build_board(
    catalog: Catalog, store: Store, history: History, server: str, now: datetime, running: bool,
    session_started_at: datetime | None,
) -> dict[str, Any]:
    today = game_day(now, server)
    counted = store.latest_point("stats.achievements")
    return {
        "server": {"key": server, "utc_offset_hours": SERVER_UTC_OFFSET_HOURS[server]},
        "resets": _resets(server, now),
        "playtime": _playtime(history, server, today, running, session_started_at),
        "achievements": {
            **achievement_totals(catalog, store),
            "hoyolab": None if counted is None else {"count": int(counted[0]), "at": iso(counted[1])},
        },
        "notes": _notes(store, server, now),
        "undo": store.newest_change_label(),
    }
