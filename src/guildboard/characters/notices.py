"""The notices (the design, section 6.6): the weekly bosses, the domains and a goal ready. Each kind sends at most once a game
day, and none whose switch is off.

1. `weekly`: on Sunday from 18:00 server time, if the plan's weekly bosses for today are not yet fought.
2. `domain`: on any check in a game day (so the first one after the 04:00 reset), when today opens a domain the plan uses.
3. `ready`: when a refresh shows that everything for a goal is in.

The week plan it is given should be made without today's ticked weekly bosses (that is, with `weekly_done` and no `ticks`), so
that a boss already fought is not named. The plan's day that is the game day is today's; a plan that does not cover it is not
used."""
from __future__ import annotations

from datetime import date, datetime
from typing import Mapping, Sequence

from guildboard.characters.models import DayPlan, Notice, WeekPlan
from guildboard.gameday import game_day, server_tz

SUNDAY = 6
WEEKLY_FROM_HOUR = 18


def _names(keys: Sequence[str], names: Mapping[str, str]) -> str:
    shown = [names.get(key, key) for key in keys]
    return shown[0] if len(shown) == 1 else ", ".join(shown[:-1]) + " and " + shown[-1]


def _weekly(local: datetime, today: DayPlan, names: Mapping[str, str]) -> Notice | None:
    if local.weekday() != SUNDAY or local.hour < WEEKLY_FROM_HOUR:
        return None
    bosses: dict[str, list[str]] = {}
    for task in today.tasks:
        if task.kind == "weekly":
            bosses.setdefault(task.where, []).extend(who for who in task.who if who not in bosses.get(task.where, []))
    if not bosses:
        return None
    left = ", ".join(f"{boss} for {_names(who, names)}" for boss, who in bosses.items())
    return Notice(kind="weekly", title="Weekly bosses reset tomorrow", body=f"At 04:00: {left}.")


def _domain(today: DayPlan, names: Mapping[str, str]) -> Notice | None:
    domains: dict[str, list[str]] = {}
    for task in today.tasks:
        if task.kind in ("books", "forgery"):
            who = domains.setdefault(task.where, [])
            who.extend(key for key in task.who if key not in who)
    if not domains:
        return None
    if len(domains) == 1:
        (where, who), = domains.items()
        return Notice(kind="domain", title=f"{where} is open today", body=f"For {_names(who, names)}.")
    wheres = list(domains)
    title = ", ".join(wheres[:-1]) + " and " + wheres[-1]
    body = " ".join(f"{where}: for {_names(who, names)}." for where, who in domains.items())
    return Notice(kind="domain", title=f"{title} are open today", body=body)


def _ready(ready_now: Sequence[tuple[str, str]], names: Mapping[str, str]) -> Notice | None:
    if not ready_now:
        return None
    sentences = [f"{names.get(key, key)} can {text[:1].lower()}{text[1:]}" for key, text in ready_now]
    if len(sentences) == 1:
        return Notice(kind="ready", title=sentences[0], body="All the materials are in.")
    return Notice(kind="ready", title=f"{len(sentences)} goals are ready to level up", body=". ".join(sentences) + ".")


def due(
    now: datetime,
    server: str,
    week: WeekPlan,
    names: Mapping[str, str],
    switches: Mapping[str, bool],
    sent: set[tuple[str, date]],
    ready_now: Sequence[tuple[str, str]],
) -> list[Notice]:
    """The notices to send now: each kind at most once a day, and none whose switch is off. `ready_now` holds, for each goal
    that is ready, the character's key and the line for it ("Raise her Normal Attack to 10")."""
    today = game_day(now, server)
    plan_day = next((day for day in week.days if day.day == today), None)
    local = now.astimezone(server_tz(server))
    found: list[Notice] = []
    candidates = (
        ("weekly", lambda: _weekly(local, plan_day, names) if plan_day else None),
        ("domain", lambda: _domain(plan_day, names) if plan_day else None),
        ("ready", lambda: _ready(ready_now, names)),
    )
    for kind, make in candidates:
        if not switches.get(kind, True) or (kind, today) in sent:
            continue
        notice = make()
        if notice is not None:
            found.append(notice)
    return found
