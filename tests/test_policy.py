from dataclasses import replace
from datetime import datetime, timedelta, timezone

from guildboard.records import GROUPS
from guildboard.store import GroupState
from guildboard.sync.policy import DAILY_CAP, Decision, PolicyState, decide, due_groups

UTC = timezone.utc
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)

BASE = PolicyState(
    now=NOW, last_run_at=None, last_ok_at=None, runs_today=0, groups={}, paused=False, blocked=None, server="os_euro"
)


def _all_ok(at: datetime) -> dict[str, GroupState]:
    return {group: GroupState(at, False) for group in GROUPS}


def test_first_run_fetches_every_group():
    assert decide("startup", BASE) == Decision(True, "ok", GROUPS)


def test_startup_is_skipped_when_the_last_success_is_recent():
    recent = replace(BASE, last_ok_at=NOW - timedelta(hours=2, minutes=59), last_run_at=NOW - timedelta(hours=3))
    assert decide("startup", recent) == Decision(False, "fresh")
    stale = replace(BASE, last_ok_at=NOW - timedelta(hours=3, minutes=1), last_run_at=NOW - timedelta(hours=4))
    assert decide("startup", stale).run is True
    assert decide("manual", recent).run is True  # the 3-hour rule is for start-up only


def test_cooldown_reports_the_wait():
    state = replace(BASE, last_run_at=NOW - timedelta(minutes=3))
    assert decide("manual", state) == Decision(False, "cooldown", (), 120)
    assert decide("post_session", state).reason == "cooldown"
    assert decide("manual", replace(BASE, last_run_at=NOW - timedelta(minutes=5))).run is True


def test_daily_cap():
    state = replace(BASE, last_run_at=NOW - timedelta(hours=1), runs_today=DAILY_CAP)
    assert decide("manual", state) == Decision(False, "daily_cap")
    assert decide("manual", replace(state, runs_today=DAILY_CAP - 1)).run is True


def test_paused_and_blocked():
    assert decide("manual", replace(BASE, paused=True)) == Decision(False, "paused")
    assert decide("manual", replace(BASE, blocked="verification_needed")) == Decision(False, "verification_needed")
    assert decide("startup", replace(BASE, blocked="login_needed", paused=True)) == Decision(False, "login_needed")


def test_clock_going_backwards_does_not_block_syncing():
    future = NOW + timedelta(hours=6)  # the last run is "in the future": the clock was set back
    state = replace(BASE, last_run_at=future, last_ok_at=future, groups=_all_ok(future))
    assert decide("manual", state).run is True
    assert decide("startup", state).run is True
    assert set(decide("manual", state).groups) == set(GROUPS)


def test_every_run_groups_are_always_due():
    state = replace(BASE, groups=_all_ok(NOW - timedelta(minutes=10)))
    assert due_groups(state) == ("overview", "notes")


def test_twelve_hour_groups():
    groups = _all_ok(NOW - timedelta(minutes=10))
    groups["characters"] = GroupState(NOW - timedelta(hours=12), False)
    groups["endgame"] = GroupState(NOW - timedelta(hours=11, minutes=59), False)
    assert due_groups(replace(BASE, groups=groups)) == ("overview", "notes", "characters")


def test_game_day_groups():
    fetched = datetime(2026, 10, 13, 1, 0, tzinfo=UTC)  # 02:00 server time: game day 12 October
    groups = _all_ok(NOW - timedelta(minutes=10))
    groups["diary"] = GroupState(fetched, False)
    groups["calendar"] = GroupState(fetched, False)
    same_day = replace(BASE, now=datetime(2026, 10, 13, 2, 30, tzinfo=UTC), groups=groups)  # 03:30 server time
    assert "diary" not in due_groups(same_day)
    next_day = replace(BASE, now=datetime(2026, 10, 13, 4, 0, tzinfo=UTC), groups=groups)  # 05:00 server time
    assert due_groups(next_day)[-2:] == ("diary", "calendar")


def test_a_failed_group_is_retried_regardless_of_cadence():
    groups = _all_ok(NOW - timedelta(minutes=10))
    groups["endgame"] = GroupState(NOW - timedelta(minutes=10), True)
    assert due_groups(replace(BASE, groups=groups)) == ("overview", "notes", "endgame")


def test_the_characters_group_is_due_every_six_hours():
    groups = _all_ok(NOW - timedelta(minutes=10))
    groups["characters"] = GroupState(NOW - timedelta(hours=6), False)
    groups["endgame"] = GroupState(NOW - timedelta(hours=6), False)  # the endgame keeps its twelve
    assert due_groups(replace(BASE, groups=groups)) == ("overview", "notes", "characters")
    groups["characters"] = GroupState(NOW - timedelta(hours=5, minutes=59), False)
    assert due_groups(replace(BASE, groups=groups)) == ("overview", "notes")


def test_the_sync_after_a_play_session_includes_the_characters_group():
    fresh = replace(BASE, groups=_all_ok(NOW - timedelta(minutes=10)))
    after = decide("post_session", fresh)
    assert after.run is True and after.groups == ("overview", "notes", "characters")  # the player may have changed builds
    assert decide("interval", fresh).groups == ("overview", "notes")  # only a finished session counts
    assert decide("manual", fresh).groups == ("overview", "notes")
    due = replace(BASE, groups={**_all_ok(NOW - timedelta(minutes=10)), "characters": GroupState(NOW - timedelta(hours=7), False)})
    assert decide("post_session", due).groups == ("overview", "notes", "characters")  # once, not twice
    assert decide("post_session", BASE).groups == GROUPS
