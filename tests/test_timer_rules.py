import re
from datetime import datetime, timedelta, timezone

import pytest

from guildboard.timers.rules import Rule, RuleError, length_hours, parse_rule, ready_at, rule_json

UTC = timezone.utc
NOW = datetime(2026, 10, 20, 10, 0, tzinfo=UTC)  # Tuesday, 11:00 server time on the Europe server


def test_an_hours_rule_counts_real_time():
    assert ready_at(Rule("hours", 12), NOW, "os_euro", "3_days") == NOW + timedelta(hours=12)


def test_a_reset_rule_waits_for_the_next_4_oclock_server_time():
    assert ready_at(Rule("resets", 1), NOW, "os_euro", "3_days") == datetime(2026, 10, 21, 3, 0, tzinfo=UTC)
    # 03:59 server time still belongs to the game day before: the reset is a minute away.
    before_reset = datetime(2026, 10, 21, 2, 59, tzinfo=UTC)
    assert ready_at(Rule("resets", 1), before_reset, "os_euro", "3_days") == datetime(2026, 10, 21, 3, 0, tzinfo=UTC)
    assert ready_at(Rule("resets", 3), NOW, "os_euro", "3_days") == datetime(2026, 10, 23, 3, 0, tzinfo=UTC)


def test_the_weekly_reset_is_monday_4_oclock_server_time():
    assert ready_at(Rule("weekly"), NOW, "os_euro", "3_days") == datetime(2026, 10, 26, 3, 0, tzinfo=UTC)
    before_reset = datetime(2026, 10, 26, 2, 59, tzinfo=UTC)
    assert ready_at(Rule("weekly"), before_reset, "os_euro", "3_days") == datetime(2026, 10, 26, 3, 0, tzinfo=UTC)


def test_server_time_ignores_daylight_saving():
    # Europe's clocks go back on 2026-10-25; the Europe server stays on UTC+1.
    saturday, sunday = datetime(2026, 10, 24, 12, 0, tzinfo=UTC), datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
    assert ready_at(Rule("resets", 1), saturday, "os_euro", "3_days") == datetime(2026, 10, 25, 3, 0, tzinfo=UTC)
    assert ready_at(Rule("resets", 1), sunday, "os_euro", "3_days") == datetime(2026, 10, 26, 3, 0, tzinfo=UTC)


def test_other_servers_reset_at_their_own_4_oclock():
    assert ready_at(Rule("resets", 1), NOW, "os_asia", "3_days") == datetime(2026, 10, 20, 20, 0, tzinfo=UTC)
    assert ready_at(Rule("resets", 1), NOW, "os_usa", "3_days") == datetime(2026, 10, 21, 9, 0, tzinfo=UTC)


def test_fishing_spots_follow_the_setting():
    assert ready_at(Rule("fishing"), NOW, "os_euro", "3_days") == NOW + timedelta(hours=72)
    assert ready_at(Rule("fishing"), NOW, "os_euro", "next_reset") == datetime(2026, 10, 21, 3, 0, tzinfo=UTC)
    assert (length_hours(Rule("fishing"), "3_days"), length_hours(Rule("fishing"), "next_reset")) == (72, None)
    assert (length_hours(Rule("hours", 70), "3_days"), length_hours(Rule("resets", 1), "3_days")) == (70, None)


def test_a_rule_from_the_page_is_read_or_refused_in_one_sentence():
    for rule in (Rule("hours", 166), Rule("resets", 2), Rule("weekly")):
        assert parse_rule(rule_json(rule)) == rule
    assert rule_json(Rule("hours", 12)) == {"kind": "hours", "hours": 12}
    assert rule_json(Rule("resets", 1)) == {"kind": "resets", "resets": 1}
    assert rule_json(Rule("weekly")) == {"kind": "weekly"}
    shape = "A timer comes back after a number of hours, after daily resets, or at the weekly reset."
    hours = "A length is 1 to 2,160 hours."
    resets = "A reset timer waits 1 to 30 daily resets."
    cases = [
        ({"kind": "monthly"}, shape), ({"kind": "fishing"}, shape), ("hours", shape), ({"hours": 3}, shape),
        ({"kind": "hours", "hours": 0}, hours), ({"kind": "hours", "hours": 2161}, hours),
        ({"kind": "hours", "hours": 1.5}, hours), ({"kind": "hours", "hours": True}, hours),
        ({"kind": "hours", "hours": "12"}, hours),
        ({"kind": "resets", "resets": 0}, resets), ({"kind": "resets", "resets": 31}, resets),
    ]
    for data, sentence in cases:
        with pytest.raises(RuleError, match=re.escape(sentence)):
            parse_rule(data)
