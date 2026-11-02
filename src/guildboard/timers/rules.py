"""When a timer is ready again: a number of real hours after Cleared, after the next daily reset or several, or at the
weekly reset. The resets are the server's 04:00, whose offset does not change with daylight saving (gameday.py)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from guildboard.gameday import game_day, game_day_start, week_start

MAX_HOURS = 2160  # 90 days
MAX_RESETS = 30
FISHING_HOURS = 72  # "3 days after the spot is emptied", the fishing setting's default
PAGE_KINDS = ("hours", "resets", "weekly")  # "fishing" belongs to the pre-set fishing spots only
SHAPE = "A timer comes back after a number of hours, after daily resets, or at the weekly reset."


class RuleError(ValueError):
    """A rule was refused. The message is fit to show to the player."""


@dataclass(frozen=True)
class Rule:
    kind: str        # "hours", "resets", "weekly", or "fishing": a fishing spot, which follows the fishing setting
    amount: int = 0  # the hours of "hours", the daily resets of "resets"


def _whole(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def parse_rule(data: object) -> Rule:
    """A rule the page sent. A fishing spot's rule is not one of them: the fishing setting decides it."""
    if not isinstance(data, dict) or data.get("kind") not in PAGE_KINDS:
        raise RuleError(SHAPE)
    if data["kind"] == "hours":
        hours = data.get("hours")
        if not _whole(hours) or not 1 <= hours <= MAX_HOURS:
            raise RuleError(f"A length is 1 to {MAX_HOURS:,} hours.")
        return Rule("hours", hours)
    if data["kind"] == "resets":
        resets = data.get("resets")
        if not _whole(resets) or not 1 <= resets <= MAX_RESETS:
            raise RuleError(f"A reset timer waits 1 to {MAX_RESETS} daily resets.")
        return Rule("resets", resets)
    return Rule("weekly")


def rule_json(rule: Rule) -> dict[str, object]:
    if rule.kind in ("hours", "resets"):
        return {"kind": rule.kind, rule.kind: rule.amount}
    return {"kind": rule.kind}


def _settled(rule: Rule, fishing: str) -> Rule:
    """A fishing spot's rule as the fishing setting has it; any other rule as it is."""
    if rule.kind != "fishing":
        return rule
    return Rule("resets", 1) if fishing == "next_reset" else Rule("hours", FISHING_HOURS)


def ready_at(rule: Rule, cleared_at: datetime, server: str, fishing: str) -> datetime:
    """When a timer cleared at `cleared_at` is ready again, in UTC."""
    rule = _settled(rule, fishing)
    if rule.kind == "hours":
        return (cleared_at + timedelta(hours=rule.amount)).astimezone(timezone.utc)
    day = game_day(cleared_at, server)
    if rule.kind == "resets":
        return game_day_start(day + timedelta(days=rule.amount), server)
    return game_day_start(week_start(day) + timedelta(days=7), server)


def length_hours(rule: Rule, fishing: str) -> int | None:
    """The length of a rule that counts real hours; None for one that waits for a reset."""
    rule = _settled(rule, fishing)
    return rule.amount if rule.kind == "hours" else None
