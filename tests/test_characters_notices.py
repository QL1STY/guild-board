"""Task E6: the three notices: weekly bosses, an open domain, and a goal ready."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from characters_samples import WEEK_TODAY, refs_sample, week_focus
from guildboard.characters import notices, week
from guildboard.characters.models import Notice

SERVER = "os_euro"   # UTC+1, so the server's 18:00 is 17:00 UTC
NAMES = {"sandrone": "Sandrone", "odette": "Odette", "alyosha": "Alyosha", "jahoda": "Jahoda"}
UTC = timezone.utc


def plan_from(day: date):
    return week.plan(week_focus(), 200, 200, 3, day, refs_sample())


def due(now, plan, switches=None, sent=None, ready_now=()):
    return notices.due(now, SERVER, plan, NAMES, switches or {}, sent if sent is not None else set(), ready_now)


def kinds(found) -> list[str]:
    return [n.kind for n in found]


def test_on_sunday_at_18_server_time_the_reminder_names_the_weekly_bosses_left():
    sunday = plan_from(WEEK_TODAY)
    found = [n for n in due(datetime(2026, 10, 25, 17, 0, tzinfo=UTC), sunday) if n.kind == "weekly"]
    assert found == [Notice(
        kind="weekly", title="Weekly bosses reset tomorrow", body="At 04:00: The Doctor for Sandrone, Il Dottore for Odette.",
    )]
    assert "weekly" not in kinds(due(datetime(2026, 10, 25, 16, 59, tzinfo=UTC), sunday))   # 17:59 on the server
    assert "weekly" in kinds(due(datetime(2026, 10, 25, 22, 59, tzinfo=UTC), sunday))   # 23:59
    assert "weekly" not in kinds(due(datetime(2026, 10, 25, 23, 30, tzinfo=UTC), sunday))   # 00:30 on Monday
    monday = plan_from(WEEK_TODAY + timedelta(days=1))
    assert "weekly" not in kinds(due(datetime(2026, 10, 26, 17, 30, tzinfo=UTC), monday))   # not a Sunday


def test_the_reminder_follows_the_plans_order():
    focus = week_focus()
    odette_first = week.plan([focus[1], focus[0]], 300, 300, 3, WEEK_TODAY, refs_sample())   # enough resin for both
    found = [n for n in due(datetime(2026, 10, 25, 17, 0, tzinfo=UTC), odette_first) if n.kind == "weekly"]
    assert found[0].body == "At 04:00: Il Dottore for Odette, The Doctor for Sandrone."


def test_nothing_is_said_on_sunday_when_no_weekly_boss_is_left():
    sunday = week.plan(week_focus(), 200, 200, 3, WEEK_TODAY, refs_sample(), weekly_done=frozenset({"The Doctor", "Il Dottore", "The Game Before the Gate"}))
    assert "weekly" not in kinds(due(datetime(2026, 10, 25, 17, 0, tzinfo=UTC), sunday))


def test_after_the_reset_a_domain_open_for_the_focus_sends_one_notice():
    wednesday = plan_from(date(2026, 10, 28))
    found = due(datetime(2026, 10, 28, 4, 0, tzinfo=UTC), wednesday)   # 05:00 on the server, an hour after the reset
    assert found == [Notice(kind="domain", title="Overturned Roost is open today", body="For Sandrone and Jahoda.")]
    assert due(datetime(2026, 10, 28, 2, 59, tzinfo=UTC), wednesday) == []   # 03:59 on the server: still Tuesday's game day


def test_two_open_domains_make_one_notice():
    thursday = plan_from(date(2026, 10, 29))   # Relics of the Frozen Grace for Odette; Overturned Roost is shut on Thursday
    sunday = plan_from(WEEK_TODAY)
    found = due(datetime(2026, 10, 25, 10, 0, tzinfo=UTC), sunday)
    assert [n.kind for n in found] == ["domain"] and found[0].title == "Overturned Roost and Relics of the Frozen Grace are open today"
    assert found[0].body == "Overturned Roost: for Sandrone. Relics of the Frozen Grace: for Odette."
    assert [n.title for n in due(datetime(2026, 10, 29, 10, 0, tzinfo=UTC), thursday)] == ["Relics of the Frozen Grace is open today"]


def test_a_goal_whose_materials_are_in_sends_a_ready_notice_once():
    sunday = plan_from(WEEK_TODAY)
    now = datetime(2026, 10, 25, 10, 0, tzinfo=UTC)
    ready = [("sandrone", "Raise her Normal Attack to 10")]
    found = [n for n in due(now, sunday, ready_now=ready) if n.kind == "ready"]
    assert found == [Notice(kind="ready", title="Sandrone can raise her Normal Attack to 10", body="All the materials are in.")]
    sent = {("ready", date(2026, 10, 25))}
    assert [n for n in due(now, sunday, sent=sent, ready_now=ready) if n.kind == "ready"] == []
    both = [n for n in due(now, sunday, ready_now=ready + [("odette", "Raise her Skill and Burst to 9")]) if n.kind == "ready"]
    assert len(both) == 1 and both[0].title == "2 goals are ready to level up"
    assert both[0].body == "Sandrone can raise her Normal Attack to 10. Odette can raise her Skill and Burst to 9."


def test_a_switched_off_kind_sends_nothing():
    sunday = plan_from(WEEK_TODAY)
    now = datetime(2026, 10, 25, 17, 0, tzinfo=UTC)
    ready = [("sandrone", "Raise her Normal Attack to 10")]
    assert {n.kind for n in due(now, sunday, ready_now=ready)} == {"weekly", "domain", "ready"}
    assert {n.kind for n in due(now, sunday, {"weekly": False}, ready_now=ready)} == {"domain", "ready"}
    assert {n.kind for n in due(now, sunday, {"weekly": False, "domain": False, "ready": False}, ready_now=ready)} == set()
    assert {n.kind for n in due(now, sunday, {"domain": True, "weekly": True}, ready_now=ready)} == {"weekly", "domain", "ready"}


def test_each_kind_sends_at_most_once_a_day():
    sunday = plan_from(WEEK_TODAY)
    now = datetime(2026, 10, 25, 17, 0, tzinfo=UTC)
    ready = [("sandrone", "Raise her Normal Attack to 10")]
    sent: set[tuple[str, date]] = set()
    first = due(now, sunday, sent=sent, ready_now=ready)
    assert {n.kind for n in first} == {"weekly", "domain", "ready"}
    sent |= {(n.kind, date(2026, 10, 25)) for n in first}
    assert due(now + timedelta(minutes=5), sunday, sent=sent, ready_now=ready) == []
    yesterday = {(kind, date(2026, 10, 24)) for kind in ("weekly", "domain", "ready")}
    assert {n.kind for n in due(now, sunday, sent=yesterday, ready_now=ready)} == {"weekly", "domain", "ready"}


def test_a_plan_that_does_not_cover_the_game_day_is_not_used():
    far = plan_from(WEEK_TODAY + timedelta(days=40))
    assert due(datetime(2026, 10, 25, 17, 0, tzinfo=UTC), far, ready_now=[]) == []
