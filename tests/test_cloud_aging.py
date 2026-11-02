"""A friend's play time and spending carry the week and the month they were made in, and are aged against the core's today each
time they are read, so that a friend whose Guild Board last uploaded two weeks ago has no "this week" (the online plan, Task C0).
The numbers come from another player's PC: nothing here may throw."""
import copy
from datetime import date, datetime, timedelta, timezone

import pytest

from cloud_fakes import USER_ID, FakeCloud, answer
from guildboard.cloud.models import friend_from
from guildboard.cloud.service import Local, Online
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.events import EventBus
from support import FakeSleep

NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 13)  # a Tuesday: the game week began on Monday the 12th
THIS_WEEK = date(2026, 10, 12)
WEEKS = [10.0, 12.5, 9.0, 13.5, 15.0, 21.0]
OVERVIEW = ("POST", "/rest/v1/rpc/friends_overview")


def playtime(week_start="2026-10-12", **more) -> dict:
    return {"week_hours": 21.0, "days30_hours": 58.0, "weeks": list(WEEKS), "week_start": week_start, "longest_run": 11, **more}


def spending(month="2026-10", **more) -> dict:
    return {"month_total": 412.0, "month": month, "currency": "PLN", **more}


def row(**stats) -> dict:
    return {
        "user_id": USER_ID, "name": "Riley", "tag": "7687", "has_picture": False, "ar": 58, "uid": None, "presence": None,
        "stats": stats, "pins": [], "compare": True,
    }


def read(today: date = TODAY, **stats) -> dict:
    return friend_from(row(**stats), NOW, today)["stats"]


def weeks_before(count: int) -> str:
    return (THIS_WEEK - timedelta(weeks=count)).isoformat()


NO_WEEK = {"week_hours": None, "days30_hours": None, "weeks": [None] * 6, "week_start": "2026-10-12", "longest_run": 11}


# ---------------------------------------------------------------------------------------------------- play time
def test_this_weeks_numbers_are_this_weeks():
    assert read(playtime=playtime()) == {"playtime": playtime()}


@pytest.mark.parametrize("behind", [1, 2, 3, 5])
def test_a_friends_old_week_is_not_this_week(behind):
    stats = read(playtime=playtime(weeks_before(behind)))
    assert stats["playtime"] == {
        "week_hours": None, "days30_hours": None, "weeks": [*WEEKS[behind:], *[None] * behind],
        "week_start": "2026-10-12", "longest_run": 11,
    }


def test_the_week_it_keeps_lines_up_with_this_one():
    # Two weeks on, the friend's last two weeks are the ones before this week and the week before that, and the two latest are
    # unknown: the chart reads its columns from its end, and the last is this week.
    stats = read(playtime=playtime(weeks_before(2)))
    assert stats["playtime"]["weeks"] == [9.0, 13.5, 15.0, 21.0, None, None]


@pytest.mark.parametrize("behind", [6, 7, 52, 1000])
def test_six_weeks_or_more_behind_leaves_no_week(behind):
    assert read(playtime=playtime(weeks_before(behind)))["playtime"] == NO_WEEK


def test_a_date_from_the_far_past_gives_no_week_and_no_trouble():
    assert read(playtime=playtime("0001-01-01"))["playtime"] == NO_WEEK


@pytest.mark.parametrize("ahead", ["2026-10-19", "2026-10-26", "2027-01-04", "9999-12-27"])
def test_a_week_ahead_of_this_one_is_left_as_it_is(ahead):
    # A friend on a server ahead of ours has begun their week while ours has not: nothing is aged, and nothing is made up.
    assert read(playtime=playtime(ahead)) == {"playtime": playtime(ahead)}


def test_a_date_inside_a_week_names_that_week():
    assert read(playtime=playtime("2026-10-14")) == {"playtime": playtime("2026-10-14")}  # a Wednesday of this week
    assert read(playtime=playtime("2026-10-07"))["playtime"]["weeks"] == [*WEEKS[1:], None]  # a Wednesday of the last
    assert read(playtime=playtime("2026-10-11"))["playtime"]["weeks"] == [*WEEKS[1:], None]  # the Sunday before this week


def test_the_week_turns_over_with_the_day_it_is_given():
    # `today` is the game day the core gives, so the week turns at the server's reset, as Compare's own week does.
    sunday, monday = date(2026, 10, 18), date(2026, 10, 19)
    assert read(sunday, playtime=playtime())["playtime"]["weeks"] == WEEKS
    assert read(monday, playtime=playtime())["playtime"]["weeks"] == [*WEEKS[1:], None]


MISSING = object()


@pytest.mark.parametrize(
    "named",
    [
        MISSING, None, "", "banana", 5, 5.5, True, [], {}, ["2026-10-12"], {"day": "2026-10-12"}, "2026-13-45", "2026-02-30", "2026-10-1",
        "20261012", "2026-W42-1", " 2026-10-12", "2026-10-12 ", "2026-10-12\n", "2026-10-12T00:00:00", "-2026-10-12", "0000-10-12",
        "٢٠٢٦-١٠-١٢",  # Arabic-Indic digits
    ],
)
def test_a_week_start_that_is_missing_or_cannot_be_read_counts_as_old(named):
    # A Guild Board from before the date was added sends none, and a changed client can send anything.
    stat = playtime()
    if named is MISSING:
        del stat["week_start"]
    else:
        stat["week_start"] = named
    assert read(playtime=stat)["playtime"] == NO_WEEK


@pytest.mark.parametrize("weeks", ["no", None, 5, {}, {"0": 1.0}, MISSING])
def test_weeks_that_are_no_list_do_not_throw(weeks):
    stat = playtime(weeks_before(1))
    if weeks is MISSING:
        del stat["weeks"]
    else:
        stat["weeks"] = weeks
    aged = read(playtime=stat)["playtime"]
    assert (aged["week_hours"], aged["days30_hours"]) == (None, None)
    assert aged.get("weeks", MISSING) == weeks  # not a list, so there is nothing to move: the page reads it as it does


@pytest.mark.parametrize("weeks", [[1.0, 2.0, 3.0], [1.0, "x", None, [], {}, True, 7.0, 8.0], []])
def test_a_list_of_another_length_keeps_its_length(weeks):
    stat = playtime(weeks_before(2), weeks=list(weeks))
    aged = read(playtime=stat)["playtime"]["weeks"]
    assert len(aged) == len(weeks)
    assert aged == [*weeks[2:], *[None] * min(2, len(weeks))]


def test_a_stat_with_fields_missing_is_aged_all_the_same():
    assert read(playtime={"week_start": weeks_before(1)})["playtime"] == {
        "week_hours": None, "days30_hours": None, "week_start": "2026-10-12",
    }
    assert read(playtime={})["playtime"] == {"week_hours": None, "days30_hours": None, "week_start": "2026-10-12"}


# ---------------------------------------------------------------------------------------------------- spending
def test_this_months_total_is_this_months():
    assert read(spending=spending()) == {"spending": spending()}


@pytest.mark.parametrize("month", ["2026-09", "2026-01", "2025-10", "2000-12", "0001-01"])
def test_the_total_of_another_month_is_not_this_months(month):
    assert read(spending=spending(month))["spending"] == {"month_total": None, "month": "2026-10", "currency": "PLN"}


def test_a_new_year_makes_december_old():
    assert read(date(2026, 1, 5), spending=spending("2025-12"))["spending"]["month_total"] is None
    assert read(date(2026, 1, 5), spending=spending("2026-01"))["spending"]["month_total"] == 412.0


@pytest.mark.parametrize("month", ["2026-11", "2027-01", "9999-12"])
def test_a_month_ahead_of_this_one_is_left_as_it_is(month):
    # Only the game day of a friend's server being ahead of ours, as for the week.
    assert read(spending=spending(month)) == {"spending": spending(month)}


@pytest.mark.parametrize(
    "named",
    [
        MISSING, None, "", "banana", 10, True, [], {}, ["2026-10"], "2026-13", "2026-00", "2026-1", "202610", "2026-10-12", "2026-10 ",
        " 2026-10", "2026-10\n", "26-10", "٢٠٢٦-١٠",
    ],
)
def test_a_month_that_is_missing_or_cannot_be_read_counts_as_old(named):
    stat = spending()
    if named is MISSING:
        del stat["month"]
    else:
        stat["month"] = named
    assert read(spending=stat)["spending"] == {"month_total": None, "month": "2026-10", "currency": "PLN"}


# ---------------------------------------------------------------------------------------------------- the rest
def test_no_other_stat_is_aged():
    stats = {
        "primogems": {"now": 16040, "months": [{"month": "2026-05", "earned": 1}]},
        "achievements": {"ticked": 1402, "total": 1558}, "endgame": {"abyss_stars": 36},
        "account": {"days_active": 812}, "wishes": {"pity": 62},
    }
    assert read(**stats, playtime=playtime("2020-01-06"), spending=spending("2020-01")) == {
        **stats, "playtime": NO_WEEK, "spending": {"month_total": None, "month": "2026-10", "currency": "PLN"},
    }


def test_aging_leaves_what_it_was_given_alone():
    # The core keeps the list it read and ages it again at every read: a copy that was aged once must not be what is kept.
    stats = {"playtime": playtime(weeks_before(3)), "spending": spending("2026-08")}
    kept = copy.deepcopy(stats)
    first = friend_from(row(**stats), NOW, TODAY)
    assert stats == kept
    first["stats"]["playtime"]["weeks"].append("changed")
    assert stats == kept
    later = friend_from(row(**stats), NOW, TODAY + timedelta(days=7))
    assert later["stats"]["playtime"]["weeks"] == [15.0, 21.0, None, None, None, None]  # four weeks on, from the upload


def test_a_value_that_is_no_stat_goes_no_further_and_throws_nothing():
    friend = friend_from(row(playtime="not an object", spending=["x"], gallery={"x": 1}), NOW, TODAY)
    assert friend["stats"] == {}


# ---------------------------------------------------------------------------------------------------- Online
def _online(tmp_path, clock, cloud: FakeCloud, day: dict) -> Online:
    store = CloudStore(tmp_path / "cloud.bin")
    store.save(CloudSession("ACCESS-0123456789", "REFRESH-0123456789", clock.now().timestamp() + 365 * 86_400, USER_ID, "Nova", "5120"))
    return Online(store, EventBus(), clock, fetch=cloud, sleep=FakeSleep(clock), local=Local(today=lambda: day["today"]))


async def test_the_list_that_is_kept_ages_with_the_calendar(tmp_path, clock):
    # The server goes away after one read, so this is the list kept for a friend whose numbers are not new: each read of it
    # is against that day's date, and from the upload, not from the read before.
    riley = row(playtime=playtime(), spending=spending())
    cloud = FakeCloud({OVERVIEW: [answer(200, {"friends": [riley], "incoming": [], "outgoing": []}), answer(503)]})
    day = {"today": TODAY}
    online = _online(tmp_path, clock, cloud, day)

    first = (await online.friends_model())["friends"][0]["stats"]
    assert first["playtime"]["week_hours"] == 21.0 and first["spending"]["month_total"] == 412.0

    day["today"] = TODAY + timedelta(days=7)
    clock.advance(minutes=1)
    second = await online.friends_model(fresh=True)  # the read fails: this is the one before
    assert second["stale"] is True
    assert second["friends"][0]["stats"]["playtime"]["weeks"] == [*WEEKS[1:], None]
    assert second["friends"][0]["stats"]["playtime"]["week_hours"] is None
    assert second["friends"][0]["stats"]["spending"]["month_total"] == 412.0  # still October

    day["today"] = date(2026, 11, 3)
    third = (await online.friends_model())["friends"][0]["stats"]  # quiet for five minutes: nothing is asked
    assert third["playtime"]["weeks"] == [*WEEKS[3:], None, None, None]
    assert third["spending"]["month_total"] is None
    assert len(cloud.requests) == 2


async def test_a_friend_who_was_current_is_current_while_the_day_is_the_same(tmp_path, clock):
    cloud = FakeCloud({OVERVIEW: answer(200, {"friends": [row(playtime=playtime())], "incoming": [], "outgoing": []})})
    online = _online(tmp_path, clock, cloud, {"today": date(2026, 10, 18)})  # the Sunday of the same week
    assert (await online.friends_model())["friends"][0]["stats"]["playtime"] == playtime()
