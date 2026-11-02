"""The week plan (the design, section 7.7): what to do each day, with whom, for up to four characters. It is `week.html`'s
`plan()` in Python, and its example numbers are the tests'.

Inputs. The focus in order, each with what it still needs and where that comes from (`Need.amount` less `Need.held`) and its
luck pieces; the resin now and its maximum; the weekly boss discounts left; today's game day. `ticks` holds today's task keys
and `weekly_done` the weekly bosses fought since Monday's reset, each as a boss name or as the key of the task that was ticked.
A tick never changes the plan: a weekly boss ticked today is in both sets and is still shown today, and is not sent to again
before Monday. (To plan without today's ticked bosses, as the notices do, leave `ticks` out and keep `weekly_done`.)

Each day, for `horizon` days, today first:
1. Resin: today the resin now; later `min(max, carried + 180)`. On Mondays the weekly bosses and their three discounts are back.
2. What only today allows, character by character in the focus order: their weekly boss (one run serves every focus character
   who needs that boss: 30 resin while discounts last, then 60), then their books and weapon materials from domains open today
   (Sunday opens them all), `ceil(left / yield)` runs, as many as the resin allows.
3. World bosses (40 a run) and ley lines (20 a run), in focus order.
4. Artifact runs for the pieces still to find, with all the resin left in steps of 20; luck never completes them.
5. Flowers, no resin, picked once they have grown back (48 hours after the last pick), up to one pass's count.
6. Enemy drops, no resin, as one reminder a day for whoever is not ready yet.
7. "Raise ...", on the first day all of a goal's needs that are not luck are in. Enemy drops, crafted and unknown sources are
   not planned, so they never hold a character back.

A task's key is `"{day}:{kind}:{where}:{first who}"`, with `#2`, `#3` added when two would be the same. The `where` of a "level"
task is the line to show for it ("Raise her Normal Attack to 10")."""
from __future__ import annotations

import math
import re
from datetime import date, timedelta
from typing import Sequence

from guildboard.characters import RESIN_PER_DAY
from guildboard.characters.models import DayPlan, FocusInput, Need, Refs, Task, WeekPlan
from guildboard.characters import odds
from guildboard.metrics import slug

SUNDAY = 6
MONDAY = 0
MAX_DISCOUNTS = 3
EPSILON = 0.001
RUN_COST = {"books": 20, "forgery": 20, "ley": 20, "boss": 40}
PLANNED = ("weekly", "books", "forgery", "boss", "ley", "flowers")   # the sources that hold a character back until they are in
FLOWER_REGROWTH_DAYS = 2
RESIN_WEEK_DAYS = 7
ARTIFACT_DOMAIN = "An artifact domain"


def _boss_of(entry: str) -> str:
    """The boss a weekly_done or tick entry names: a bare name, or a key `day:weekly:boss:who`."""
    parts = entry.split(":")
    return ":".join(parts[2:-1]) if len(parts) >= 4 and parts[1] == "weekly" else entry


def _is_weekly_key(entry: str) -> bool:
    parts = entry.split(":")
    return len(parts) >= 4 and parts[1] == "weekly"


def raise_text(focus: FocusInput) -> str:
    """The line a ready goal is shown as: "Raise her Normal Attack to 10", "Raise her Skill and Burst to 9", "Raise her to
    level 80". It is made from the goal's first clause."""
    first = focus.goal.split(",")[0].strip()
    level = re.fullmatch(r"[Ll]evel (\d+)", first)
    if level:
        return f"Raise {focus.pronouns[1]} to level {level.group(1)}"
    first = re.sub(r"^Elemental ", "", first)
    first = re.sub(r"\s(\d+)$", r" to \1", first)
    return f"Raise {focus.pronouns[2]} {first}"


def _weekly_amount(amount: float) -> str:
    """How a weekly boss's run is said: "1 ", "about 2 ", or "a chance at " when a run gives less than one on average."""
    if amount < 1 - EPSILON:
        return "a chance at "
    if abs(amount - round(amount)) < EPSILON:
        return f"{round(amount)} "
    return f"about {round(amount)} "


def _goal_clause(focus: FocusInput) -> str:
    first = focus.goal.split(",")[0].strip()
    return re.sub(r"^Level\b", "level", first)


class _Planner:
    def __init__(self, focus: Sequence[FocusInput], refs: Refs) -> None:
        self.focus = list(focus)
        self.refs = refs
        self.by_key = {item.key: item for item in self.focus}
        # what is still to get, per character and material, in the order the needs came
        self.rem: dict[str, dict[str, float]] = {}
        self.need: dict[str, dict[str, Need]] = {}
        for item in self.focus:
            amounts: dict[str, float] = {}
            needs: dict[str, Need] = {}
            for need in item.needs:
                amounts[need.material] = amounts.get(need.material, 0.0) + max(0, need.amount - (need.held or 0))
                needs.setdefault(need.material, need)
            self.rem[item.key], self.need[item.key] = amounts, needs

    def kind(self, key: str, material: str) -> str:
        return self.need[key][material].source.kind

    def missing(self, key: str, material: str) -> bool:
        return self.rem[key][material] > EPSILON

    def materials(self, item: FocusInput, *kinds: str):
        for material in self.rem[item.key]:
            if self.kind(item.key, material) in kinds and self.missing(item.key, material):
                yield material

    def per_run(self, kind: str, material: str) -> float:
        yields = self.refs.yields
        if kind == "ley":
            return yields.get("ley_mora" if material == "mora" else "ley_exp", 1.0) or 1.0
        return yields.get(kind, 1.0) or 1.0


def plan(
    focus: Sequence[FocusInput],
    resin_now: int,
    resin_max: int,
    discounts_left: int,
    today: date,
    refs: Refs,
    ticks: frozenset[str] = frozenset(),
    weekly_done: frozenset[str] = frozenset(),
    horizon: int = 35,
) -> WeekPlan:
    """What to do each day, in the order of the focus, for `horizon` days from `today`."""
    state = _Planner(focus, refs)
    done_weekly = {_boss_of(entry) for entry in weekly_done}
    ticked_today = {_boss_of(entry) for entry in ticks if _is_weekly_key(entry)}
    discounts = discounts_left
    last_pick: dict[str, int] = {}
    ready: dict[str, date | None] = {item.key: None for item in state.focus}
    luck_runs = {item.key: 0 for item in state.focus if item.luck}
    luck_by_day: dict[str, list[int]] = {key: [] for key in luck_runs}
    carry = 0
    days: list[DayPlan] = []
    for d in range(horizon):
        when = today + timedelta(days=d)
        weekday = when.weekday()
        if weekday == MONDAY and d > 0:
            done_weekly, discounts = set(), MAX_DISCOUNTS
        resin = resin_now if d == 0 else min(resin_max, carry + RESIN_PER_DAY)
        start = resin
        tasks: list[Task] = []
        seen: dict[str, int] = {}

        def add(kind, where, who, runs, cost, gets, free, why):
            key = f"{when.isoformat()}:{kind}:{where}:{who[0]}"
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                key = f"{key}#{seen[key]}"
            tasks.append(Task(
                key=key, day=when, kind=kind, who=tuple(who), where=where, runs=runs, resin=cost, gets=tuple(gets), free=free,
                why=why,
            ))

        # 2. what only today allows, character by character
        for item in state.focus:
            for material in list(state.materials(item, "weekly")):
                if not state.missing(item.key, material):
                    continue   # an earlier run of the same boss in this loop gave it
                boss = state.need[item.key][material].source.where
                cost = 30 if discounts > 0 else 60
                if boss in done_weekly and not (d == 0 and boss in ticked_today):
                    continue
                if resin < cost:
                    if d == 0 and boss in ticked_today:
                        done_weekly.add(boss)   # fought already, as its tick says: not planned again before Monday
                    continue
                gets = []
                for other in state.focus:
                    for m in list(state.materials(other, "weekly")):
                        if state.need[other.key][m].source.where == boss:
                            amount = min(state.rem[other.key][m], state.per_run("weekly", m))
                            state.rem[other.key][m] -= amount
                            gets.append((other.key, m, amount))
                done_weekly.add(boss)
                discounts = max(0, discounts - 1)
                resin -= cost
                who = list(dict.fromkeys(g[0] for g in gets))
                why = ", ".join(
                    f"{_weekly_amount(amount)}{state.need[k][m].name} for {state.by_key[k].name}" for k, m, amount in gets
                )
                add("weekly", boss, who, 1, cost, gets, False, why)
            for material in list(state.materials(item, "books", "forgery")):
                source = state.need[item.key][material].source
                kind = source.kind
                if resin < 20 or not (weekday == SUNDAY or not source.days or weekday in source.days):
                    continue
                per = state.per_run(kind, material)
                runs = min(math.ceil(state.rem[item.key][material] / per - 1e-9), resin // 20)
                got = min(state.rem[item.key][material], runs * per)
                state.rem[item.key][material] -= got
                resin -= runs * 20
                add(kind, source.where, [item.key], runs, runs * 20, [(item.key, material, got)], False,
                    f"about {max(1, round(got))} {state.need[item.key][material].name}, for {item.pronouns[2]} {_goal_clause(item)}")
        # 3. world bosses and ley lines
        for item in state.focus:
            for material in list(state.materials(item, "boss", "ley")):
                source = state.need[item.key][material].source
                each = RUN_COST[source.kind]
                if resin < each:
                    continue
                per = state.per_run(source.kind, material)
                runs = min(math.ceil(state.rem[item.key][material] / per - 1e-9), resin // each)
                got = min(state.rem[item.key][material], runs * per)
                state.rem[item.key][material] -= got
                resin -= runs * each
                add(source.kind, source.where, [item.key], runs, runs * each, [(item.key, material, got)], False,
                    f"about {max(1, round(got))} {state.need[item.key][material].name}, for {item.pronouns[2]} {_goal_clause(item)}")
        # 4. artifacts take what is left; they are luck, so they never finish on their own
        for item in state.focus:
            if item.luck and resin >= 20:
                runs = resin // 20
                resin -= runs * 20
                luck_runs[item.key] += runs
                labels = " and ".join(label for label, _ in item.luck)
                add("artifacts", ARTIFACT_DOMAIN, [item.key], runs, runs * 20, [(item.key, slug(item.luck[0][0]), 0.0)], False,
                    f"a chance at {item.pronouns[2]} {labels}")
        # 5. flowers, no resin, every other day
        for item in state.focus:
            for material in list(state.materials(item, "flowers")):
                if material in last_pick and d - last_pick[material] < FLOWER_REGROWTH_DAYS:
                    continue
                flower = refs.flowers.get(material)
                count = min(math.ceil(state.rem[item.key][material]), flower.per_pass if flower else 10**9)
                state.rem[item.key][material] -= count
                last_pick[material] = d
                add("flowers", state.need[item.key][material].source.where, [item.key], 0, 0,
                    [(item.key, material, float(count))], True,
                    f"{count} {state.need[item.key][material].name}, for {item.pronouns[2]} {_goal_clause(item)}")
        # 6. enemy drops: one reminder a day for everyone not ready yet
        waiting = [
            (item, m) for item in state.focus if ready[item.key] is None for m in state.materials(item, "enemies")
        ]
        if waiting:
            names = ", ".join(dict.fromkeys(state.need[i.key][m].name for i, m in waiting))
            add("enemies", state.need[waiting[0][0].key][waiting[0][1]].source.where,
                list(dict.fromkeys(i.key for i, _ in waiting)), 0, 0, [(i.key, m, 0.0) for i, m in waiting], True,
                f"enemy drops: {names}")
        # 7. raise it the day everything is in
        for item in state.focus:
            if ready[item.key] is None and not any(state.materials(item, *PLANNED)):
                ready[item.key] = when
                add("level", raise_text(item), [item.key], 0, 0, [(item.key, None, 0.0)], True,
                    f"everything {item.pronouns[2]} goal needs is in")
        carry = resin
        days.append(DayPlan(day=when, start=start, spent=start - resin, tasks=tuple(tasks)))
        for key in luck_by_day:
            luck_by_day[key].append(luck_runs[key])
    luck: dict[str, tuple[date | None, date | None]] = {}
    for item in state.focus:
        if item.luck:
            chances = [p for _, p in item.luck]
            luck[item.key] = tuple(  # type: ignore[assignment]
                _day_of(today, _first_reaching(chances, luck_by_day[item.key], q)) for q in (0.5, 0.9)
            )
    resin_by = {item.key: 0 for item in state.focus}
    for day_plan in days[:RESIN_WEEK_DAYS]:
        for task in day_plan.tasks:
            if not task.free:
                resin_by[task.who[0]] += task.resin
    return WeekPlan(days=tuple(days), ready=ready, luck=luck, resin_by=resin_by)


def _first_reaching(chances: Sequence[float], runs_by_day: Sequence[int], q: float) -> int | None:
    """The first day on which the chance of every piece at once reaches `q`."""
    for index, runs in enumerate(runs_by_day):
        together = 1.0
        for p in chances:
            together *= odds.chance(p, runs)
        if together >= q:
            return index
    return None


def _day_of(today: date, index: int | None) -> date | None:
    return None if index is None else today + timedelta(days=index)
