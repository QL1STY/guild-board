"""The Your week page's model (the plan's `Week`) and the Today widget's, which is its first day: the focus's goals and needs go
through the week engine, and its tasks are put into the words and the shape the page reads (design 6.4)."""
from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Any, Mapping, Sequence

from guildboard.characters import RESIN_PER_DAY, bridge
from guildboard.characters.bridge import TALENT_LABELS
from guildboard.characters.models import FocusInput, Need, Plan, Task, WeekPlan
from guildboard.metrics import slug
from guildboard.views.characters import (
    and_list, day_text, label_of, long_day, luck_label, luck_slots, pronouns,
)

if TYPE_CHECKING:
    from guildboard.characters.service import Char, Characters

DAYS_SHOWN = 7
CHOOSE_FOCUS = "Choose up to four characters to plan for."
SUNDAY_ALERT = "Weekly bosses reset tomorrow at 04:00: do them today."
MONDAY_ALERT = "Weekly bosses are back: three at 30 resin this week."
HOW = [
    "Weekly bosses come first: one run serves everyone who needs that boss, and the first three cost 30 resin.",
    "Then the books open today, in the order of your focus, then world bosses, then artifacts with what resin is left.",
    "Flowers and the like cost no resin, and are picked every other day.",
    "A character is ready the day everything their goal needs is in. Artifacts are luck, so they never finish on their own.",
]
FIND = "Find "


def spare_text(resin: int) -> str:
    return f"Nothing to farm with resin today: {resin} resin carry over."


def goal_text(svc: "Characters", char: "Char", plan: Plan) -> str:
    """What her plan asks for, in a line: the talents to raise, her level, her weapon's, then the pieces to find (luck). The
    first clause is what the week engine says to raise when everything for it is in."""
    build = char.build
    have = build.talents if build else {kind: 1 for kind in bridge.TALENTS}
    by_target: dict[int, list[str]] = {}
    for kind in char.card.talent_priority:
        if plan.talents.get(kind, 0) > have.get(kind, 1):
            by_target.setdefault(plan.talents[kind], []).append(kind)
    clauses = []
    for target in sorted(by_target, reverse=True):
        names = [TALENT_LABELS[kind] for kind in by_target[target]]
        names = [names[0], *(name.removeprefix("Elemental ") for name in names[1:])]
        clauses.append(f"{and_list(names)} {target}")
    if plan.level > (build.level if build else 1):
        clauses.append(f"Level {plan.level}")
    weapon = build.weapon if build else None
    if plan.weapon_level > (weapon.level if weapon and (not plan.weapon or plan.weapon == weapon.key) else 1):
        clauses.append(f"Weapon level {plan.weapon_level}")
    pieces = [f"a {luck_label(char, slot, main)}" for slot, main in luck_slots(svc, char, plan)]
    if not clauses:
        return f"{FIND}{and_list(pieces)}" if pieces else ""
    return ", and ".join([", ".join(clauses), *([and_list(pieces)] if pieces else [])])


def luck_pieces(svc: "Characters", char: "Char", plan: Plan) -> tuple[tuple[str, float], ...]:
    from guildboard.characters import odds

    return tuple(
        (luck_label(char, slot, main), odds.per_run(slot, main, main in ("cr", "cd"), True, svc.refs))
        for slot, main in luck_slots(svc, char, plan)
    )


def task_title(task: Task, needs: Mapping[str, Need]) -> str:
    runs = f"{task.runs} run{'' if task.runs == 1 else 's'}"
    if task.kind == "weekly":
        return f"{task.where}, weekly boss"
    if task.kind in ("books", "forgery", "boss", "ley", "artifacts"):
        return f"{task.where}, {runs}"
    if task.kind == "flowers":
        key, count = task.gets[0][1], round(task.gets[0][2])
        name = needs[key].name if key in needs else (key or "").replace("-", " ")
        return f"Pick {count} {name} in {task.where}"
    if task.kind == "enemies":
        return f"Enemy drops from {task.where}" if task.where else "Enemy drops"
    return task.where


def _ready_text(day: date | None, today: date, luck: Sequence[tuple[str, float]]) -> str:
    if day is None:
        text = "Not ready in the next 35 days"
    elif day == today:
        text = "Ready today"
    else:
        text = f"Ready {day_text(day)}"
    if luck:
        text += f"; the {and_list([label.split()[-1] for label, _ in luck])} is luck"
    return text


def _task_view(task: Task, needs: Mapping[str, Need], luck_names: Mapping[str, str], done: bool) -> dict[str, Any]:
    material = None
    for _who, key, _amount in task.gets:
        if key is None:
            continue
        if key in luck_names:
            material = {"name": luck_names[key], "icon": None}
        elif key in needs:
            material = {"name": needs[key].name, "icon": needs[key].icon}
        if material:
            break
    return {
        "key": task.key, "kind": task.kind, "who": list(task.who), "title": task_title(task, needs), "why": task.why,
        "material": material, "resin": task.resin, "free": task.free, "done": done,
    }


def build_week(svc: "Characters") -> dict[str, Any]:
    today = svc.today()
    plan, inputs, chars = svc.week_plan()
    focus = [char.key for char in chars]
    done = {task for day, task in svc.store.ticks(svc.uid(), today) if day == today}
    needs: dict[str, Need] = {}
    for item in inputs:
        for need in item.needs:
            needs.setdefault(need.material, need)
    luck_names = {slug(label): label for item in inputs for label, _ in item.luck}
    skip = {item.key for item in inputs if not item.goal or item.goal.startswith(FIND)}
    days = []
    for index, day_plan in enumerate(plan.days[:DAYS_SHOWN]):
        tasks = [
            _task_view(task, needs, luck_names, day_plan.day == today and task.key in done)
            for task in day_plan.tasks if not (task.kind == "level" and task.who[0] in skip)
        ]
        weekday = day_plan.day.weekday()
        alert = (
            {"text": SUNDAY_ALERT, "loud": True} if weekday == 6
            else {"text": MONDAY_ALERT, "loud": False} if weekday == 0 else None
        )
        spare = None
        if not inputs:
            spare = CHOOSE_FOCUS
        elif day_plan.spent == 0:
            spare = spare_text(day_plan.start)
        days.append({
            "day": day_plan.day.isoformat(), "label": long_day(day_plan.day), "today": index == 0, "start": day_plan.start,
            "spent": day_plan.spent, "alert": alert, "spare": spare, "tasks": tasks,
        })
    cards, ready = [], []
    for position, item in enumerate(inputs, 1):
        char = chars[position - 1]
        text = _ready_text(plan.ready.get(item.key), today, item.luck)
        if item.goal.startswith(FIND) or not item.goal:
            text = "Nothing to raise" + (f"; the {and_list([label.split()[-1] for label, _ in item.luck])} is luck" if item.luck else "")
        cards.append({
            "key": item.key, "position": position, "name": item.name, "icon": svc.address(char.icon),
            "goal": item.goal or "Nothing left to raise", "ready_text": text, "pronouns": pronouns(char.card),
        })
        when = plan.ready.get(item.key)
        halves = plan.luck.get(item.key)
        luck = None
        if item.luck:
            half = halves[0] if halves else None
            label = and_list([name.split()[-1] for name, _ in item.luck])
            luck = {
                "half": (half - today).days if half else None,
                "label": f"{label}: half a chance by {day_plan_text(half)}" if half else f"{label}: less than half a chance in 35 days",
            }
        ready.append({
            "key": item.key, "until": (when - today).days if when else None, "luck": luck, "text": text,
        })
    shown = plan.days[:DAYS_SHOWN]
    everyone = []
    for key in svc.keys():
        char = svc.char(key)
        if char is not None:
            everyone.append({
                "key": char.key, "name": char.name, "icon": svc.address(char.icon), "owned": char.owned,
                "focus": focus.index(key) + 1 if key in focus else None,
            })
    everyone.sort(key=lambda c: (c["focus"] is None, c["focus"] or 0, not c["owned"], c["name"].lower()))
    return {
        "focus": cards, "characters": everyone, "days": days, "ready": ready,
        "resin_by": [{"key": item.key, "resin": plan.resin_by.get(item.key, 0)} for item in inputs],
        "resin_week": sum(day.spent for day in shown), "resin_week_max": sum(day.start for day in shown),
        "how": list(HOW), "today": days[0], "sync": svc.sync_view(),
    }


def day_plan_text(day: date | None) -> str:
    return day_text(day) if day else ""
