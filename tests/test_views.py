from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.history import History
from guildboard.metrics import Point
from guildboard.records import GROUPS, Area, FetchResult, OverviewRecord, Region
from guildboard.sources.demo import DEMO_SERVER, seed_history
from guildboard.sync.apply import apply_result
from guildboard.views.backlog import build_backlog
from guildboard.views.reference import oculi_totals
from guildboard.views.stats import CHEST_KEYS, build_stats, hour_level, longest_run, play_level, trend
from support import ok_result

UTC = timezone.utc
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)
TODAY = date(2026, 10, 13)
PLAYERS_CLOCK = timezone(timedelta(hours=2))  # the PC's zone in the play-by-the-hour tests; the server (os_euro) is UTC+1


@pytest.fixture
def history(store):
    return History(store)


def tracking_began(store, day):
    """One point on `day`, which makes it the first day Guild Board tracked."""
    store.add_points(None, datetime(day.year, day.month, day.day, 12, tzinfo=UTC), day, [Point("stats.achievements", 1.0)])


def played(store, start, end):
    store.touch_session(store.open_session(start, False), end)


@pytest.fixture
def seeded(store):
    """Ninety days of demo history, plus a sync at 'now'."""
    seed_history(store, NOW)
    run = store.start_run("startup", NOW)
    for group in GROUPS:
        apply_result(store, run, ok_result(group, NOW), DEMO_SERVER)
        store.mark_group_ok(group, NOW)
    store.finish_run(run, NOW, "ok")
    return store


def test_reference_totals():
    totals = oculi_totals()
    assert totals == {"anemo": 66, "geo": 131, "electro": 181, "dendro": 271, "hydro": 271}


def test_backlog_counters(seeded):
    model = build_backlog(seeded, History(seeded), TODAY)
    assert model["tracking_since"] == "2026-07-15"
    assert [counter["id"] for counter in model["counters"]] == ["chests", "oculi", "achievements", "waypoints", "archon"]
    chests = model["counters"][0]
    counters = seeded.latest_doc("overview")[1]["counters"]
    assert chests["value"] == int(sum(value for name, value in counters.items() if name.startswith("chests.")))
    assert chests["delta"] > 0
    assert chests["delta_note"] == "this week"
    archon = model["counters"][4]
    assert (archon["value"], archon["text"], archon["delta"]) == (2, "2 open", None)


def test_backlog_regions_and_sorts(seeded):
    history = History(seeded)
    least = build_backlog(seeded, history, TODAY, "least")
    assert [region["name"] for region in least["complete"]] == [
        "Mondstadt", "Dragonspine", "Liyue", "The Chasm", "Enkanomiya", "Fontaine", "Sea of Bygone Eras",
    ]
    percentages = [region["pct"] for region in least["regions"]]
    assert percentages == sorted(percentages)
    assert least["regions"][0]["name"] == "Snezhnaya"
    assert all(not region["complete"] for region in least["regions"])
    closest = build_backlog(seeded, history, TODAY, "closest")
    assert [region["pct"] for region in closest["regions"]] == sorted(percentages, reverse=True)
    game = build_backlog(seeded, history, TODAY, "game")
    assert [region["id"] for region in game["regions"]] == [5, 6, 8, 11, 12, 13]
    chenyu = game["regions"][0]
    assert (chenyu["name"], chenyu["parent"], chenyu["note"], chenyu["icon"]) == (
        "Chenyu Vale", "Liyue", "Rainjade Oblation 10", "",
    )
    area_percentages = [area["pct"] for area in chenyu["areas"]]
    assert area_percentages == sorted(area_percentages)
    with pytest.raises(ValueError):
        build_backlog(seeded, history, TODAY, "alphabetical")


def test_backlog_complete_regions_carry_their_card(seeded):
    history = History(seeded)
    model = build_backlog(seeded, history, TODAY)
    card = set(model["regions"][0])
    assert model["complete"]
    for region in model["complete"]:
        assert set(region) == card  # the same fields as an unfinished region's card
        assert region["complete"] is True
        assert region["pct"] == 100
    # Every fully explored region, none left out, in the overview's own order, which is game order, whatever the sort.
    explored = [
        region["id"]
        for region in seeded.latest_doc("overview")[1]["regions"]
        if region["pct"] >= 100 and all(area["pct"] >= 100 for area in region["areas"])
    ]
    assert explored == [1, 2, 3, 4, 7, 9, 10]
    assert [region["id"] for region in model["complete"]] == explored
    for sort in ("closest", "game"):
        assert build_backlog(seeded, history, TODAY, sort)["complete"] == model["complete"]
    fontaine = next(region for region in model["complete"] if region["name"] == "Fontaine")
    assert (fontaine["note"], fontaine["areas"]) == (
        "Fountain of Lucine 50", [{"name": "Morte Region", "pct": 100.0}, {"name": "Belleau Region", "pct": 100.0}],
    )


def test_backlog_closest_to_done(seeded):
    closest = build_backlog(seeded, History(seeded), TODAY)["closest"]
    assert len(closest) == 5
    remaining = [entry["remaining"] for entry in closest]
    assert remaining == sorted(remaining)
    assert all(value > 0 for value in remaining)
    assert all(" · " in entry["label"] for entry in closest)


def test_backlog_oculi_and_archon(seeded):
    model = build_backlog(seeded, History(seeded), TODAY)
    assert model["oculi"]["complete_count"] == 5
    assert model["oculi"]["missing"] == []
    assert [entry["type"] for entry in model["oculi"]["unknown"]] == ["cryo", "luno", "pyro"]
    assert model["oculi"]["unknown"][0]["label"] == "Cryoculi"
    assert model["archon"]["known"] is True
    assert model["archon"]["all_finished"] is False
    assert [(chapter["title"], chapter["status"]) for chapter in model["archon"]["chapters"]] == [
        ("Chapter VII: Act II", "In progress"),
        ("Chapter VII: Act III", "Not started"),
    ]


def test_backlog_missing_oculi_and_region_without_areas(store):
    record = OverviewRecord(
        nickname="Traveler", server="os_euro", adventure_rank=60,
        counters={"oculi.anemo": 60.0, "oculi.geo": 131.0, "oculi.hydro": 300.0, "chests.common": 5.0},
        regions=(
            Region(1, 0, "Mondstadt", 97.5, "https://act-webstatic.hoyoverse.com/mondstadt.png"),
            Region(9, 0, "Fontaine", 100.0, "", (), (Area("Morte Region", 99.0),)),
        ),
    )
    run = store.start_run("manual", NOW)
    apply_result(store, run, FetchResult("overview", NOW, (), record), "os_euro")
    model = build_backlog(store, History(store), TODAY)
    assert model["oculi"]["missing"] == [{"type": "anemo", "label": "Anemoculi", "have": 60, "total": 66}]
    assert model["oculi"]["complete_count"] == 1
    assert model["oculi"]["unknown"] == [{"type": "hydro", "label": "Hydroculi", "have": 300}]  # more than the known total
    assert [region["name"] for region in model["regions"]] == ["Mondstadt", "Fontaine"]  # an unfinished area keeps a region open
    assert model["regions"][0]["icon"] == "/api/icon/explore.1"
    assert model["closest"] == [
        {"label": "Fontaine · Morte Region", "remaining": 1.0},
        {"label": "Mondstadt", "remaining": 2.5},
    ]
    assert model["counters"][0]["delta"] is None  # one sync only: nothing to compare with
    assert model["archon"] == {"known": False, "all_finished": False, "open": 0, "chapters": []}


def test_backlog_on_an_empty_store(store):
    model = build_backlog(store, History(store), TODAY)
    assert model["tracking_since"] is None
    assert model["counters"] == []
    assert model["regions"] == []
    assert model["complete"] == []
    assert model["closest"] == []
    assert model["oculi"] == {"missing": [], "complete_count": 0, "unknown": []}
    assert model["archon"]["known"] is False


def test_helpers():
    assert [play_level(minutes) for minutes in (0, 1, 29.9, 30, 59, 60, 119, 120, 500)] == [0, 1, 1, 2, 2, 3, 3, 4, 4]
    assert [hour_level(minutes) for minutes in (None, 0, 0.5, 14.9, 15, 29.9, 30, 44.9, 45, 60)] == [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]
    assert trend([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) == [
        3, 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47,
    ]
    assert trend([4, 5, 6]) == [4, 5, 6]
    assert trend([]) == []
    assert longest_run([True, True, False, True, True, True, False]) == 3
    assert longest_run([]) == 0


def test_stats_thirty_days(seeded):
    history = History(seeded)
    model = build_stats(seeded, history, TODAY, DEMO_SERVER, "30")
    assert model["period"] == {"first": "2026-09-14", "last": "2026-10-13", "days": 30}
    assert model["coverage"] == {
        "tracking_since": "2026-07-15", "tracked_days": 30, "full": True, "partial": False, "compare": True,
    }
    assert [tile["id"] for tile in model["tiles"]] == ["chests", "achievements", "playtime", "days", "primogems"]
    chests, achievements, playtime, days, primogems = model["tiles"]
    assert chests["value"] == int(history.change(list(CHEST_KEYS), date(2026, 9, 14), TODAY))
    assert isinstance(chests["delta"], int)
    assert len(chests["trend"]) == 12
    assert sum(chests["trend"]) == chests["value"]
    assert achievements["value"] >= 0
    assert playtime["minutes"] > 600
    assert isinstance(playtime["delta_minutes"], int)
    assert days["of"] == 30
    assert 20 <= days["value"] <= 30
    assert 1 <= days["longest_run"] <= 30
    assert primogems["value"] > 0


def test_stats_exploration_and_chest_columns(seeded):
    model = build_stats(seeded, History(seeded), TODAY, DEMO_SERVER, "30")
    rows = model["exploration"]["rows"]
    assert rows[0]["name"] == "Snezhnaya"
    gains = [row["now"] - row["start"] for row in rows]
    assert gains == sorted(gains, reverse=True)
    assert len(rows) + model["exploration"]["unchanged"] == 13
    chests = model["chests"]
    assert chests["unit"] == "day"
    assert len(chests["columns"]) == 30
    assert chests["total"] == model["tiles"][0]["value"]
    by_day = {column["label"]: column for column in chests["columns"]}
    assert by_day["2026-09-19"]["no_data"] is True  # the demo account did not sync that day
    assert by_day["2026-09-20"]["after_gap"] is True
    assert chests["columns"][chests["max_index"]]["value"] == max(column["value"] for column in chests["columns"])


def test_stats_other_ranges(seeded):
    history = History(seeded)
    week = build_stats(seeded, history, TODAY, DEMO_SERVER, "7")
    assert week["period"]["days"] == 7
    assert len(week["chests"]["columns"]) == 7
    assert len(week["tiles"][0]["trend"]) == 7
    quarter = build_stats(seeded, history, TODAY, DEMO_SERVER, "90")
    assert quarter["period"]["first"] == "2026-07-16"
    assert quarter["coverage"]["full"] is True
    assert quarter["coverage"]["compare"] is False  # the 90 days before that were not tracked
    assert quarter["tiles"][0]["delta"] is None
    assert quarter["chests"]["unit"] == "week"
    assert 13 <= len(quarter["chests"]["columns"]) <= 14
    everything = build_stats(seeded, history, TODAY, DEMO_SERVER, "all")
    assert everything["period"] == {"first": "2026-07-15", "last": "2026-10-13", "days": 91}
    assert everything["coverage"]["partial"] is False
    assert everything["coverage"]["compare"] is False
    with pytest.raises(ValueError):
        build_stats(seeded, history, TODAY, DEMO_SERVER, "365")


def test_stats_calendar_months_and_endgame(seeded):
    model = build_stats(seeded, History(seeded), TODAY, DEMO_SERVER, "30")
    calendar = model["calendar"]
    assert (calendar["weeks"], calendar["first_day"], len(calendar["cells"])) == (12, "2026-07-27", 84)
    future = [cell for cell in calendar["cells"] if cell["level"] is None]
    assert [cell["day"] for cell in future] == [f"2026-10-{day}" for day in range(14, 19)]
    assert all(cell["level"] in (0, 1, 2, 3, 4) for cell in calendar["cells"] if cell["level"] is not None)
    assert any(cell["level"] == 4 for cell in calendar["cells"])
    months = model["primogems"]["months"]
    assert [month["label"] for month in months][-3:] == ["Aug", "Sep", "Oct"]
    assert [month["current"] for month in months][-3:] == [False, False, True]
    amounts = [source["amount"] for source in model["primogems"]["sources"]]
    assert amounts and amounts == sorted(amounts, reverse=True)
    endgame = {row["mode"]: row for row in model["endgame"]}
    assert list(endgame) == ["abyss", "theater", "stygian"]
    assert endgame["abyss"]["period"] == "16 Sep to 15 Oct"
    assert endgame["abyss"]["result"].endswith("of 36 stars")
    assert endgame["abyss"]["best"].endswith(" stars")
    assert endgame["theater"]["period"] == "1 Oct to 31 Oct"
    assert endgame["theater"]["best"].startswith("Act ")
    assert endgame["stygian"]["period"] == "Season 10"


def test_stats_just_after_tracking_began(store):
    store.add_points(None, NOW, TODAY, [Point(key, 10.0) for key in CHEST_KEYS])
    model = build_stats(store, History(store), TODAY, "os_euro", "30")
    assert model["coverage"] == {
        "tracking_since": "2026-10-13", "tracked_days": 1, "full": False, "partial": True, "compare": False,
    }
    assert model["tiles"][0]["value"] == 0  # the first sighting is a baseline, not 50 opened chests
    assert model["tiles"][0]["delta"] is None


def test_stats_on_an_empty_store(store):
    model = build_stats(store, History(store), TODAY, "os_euro", "30")
    assert model["coverage"]["tracking_since"] is None
    assert [tile.get("value", tile.get("minutes")) for tile in model["tiles"]] == [0, 0, 0, 0, 0]
    assert model["exploration"] == {"rows": [], "unchanged": 0}
    assert model["chests"]["total"] == 0
    assert model["chests"]["max_index"] is None
    assert all(column["no_data"] for column in model["chests"]["columns"])
    assert len(model["calendar"]["cells"]) == 84
    assert model["primogems"] == {"months": [], "sources": []}
    assert model["endgame"] == []
    assert model["primogem_days"]["total"] == 0
    assert model["primogem_days"]["max_index"] is None
    assert all(column["no_data"] for column in model["primogem_days"]["columns"])
    assert model["play_hours"] == {  # nothing tracked: no weekday has a day, so no cell has a value
        "cells": [[None] * 24] * 7, "levels": [[0] * 24] * 7, "days": [0] * 7, "empty": True,
    }
    everything = build_stats(store, History(store), TODAY, "os_euro", "all")
    assert everything["period"] == {"first": "2026-10-13", "last": "2026-10-13", "days": 1}


def test_primogems_per_day_follow_the_chests_rules(seeded):
    history = History(seeded)
    month = build_stats(seeded, history, TODAY, DEMO_SERVER, "30")
    days = month["primogem_days"]
    assert set(days) == set(month["chests"]) | {"groups_order", "group_labels", "exact", "last_import"}  # the chests' shape and the groups
    assert (days["unit"], len(days["columns"])) == ("day", 30)
    assert days["total"] == month["tiles"][4]["value"]  # the Primogems earned tile's figure
    assert days["total"] > 0
    assert days["columns"] != month["chests"]["columns"]  # primogems' own rises, not the chests'
    by_day = {column["label"]: column for column in days["columns"]}
    assert by_day["2026-09-19"]["no_data"] is True  # the demo account did not sync that day
    assert by_day["2026-09-20"]["after_gap"] is True
    assert days["columns"][days["max_index"]]["value"] == max(column["value"] for column in days["columns"])
    quarter = build_stats(seeded, history, TODAY, DEMO_SERVER, "90")
    weeks = quarter["primogem_days"]
    assert weeks["unit"] == "week"  # past 45 days, a column a week
    assert 13 <= len(weeks["columns"]) <= 14
    assert weeks["total"] == quarter["tiles"][4]["value"]
    assert any(column["after_gap"] for column in weeks["columns"])


def test_play_by_the_hour_is_the_minutes_on_an_average_day_of_each_weekday(store, history):
    # Tracking began on Monday 2026-10-05; a session on Mon 5 Oct 20:30 to 21:15, and one on Mon 12 Oct 20:00 to 20:30,
    # local time UTC+2; period: the 14 days to Sunday 2026-10-18.
    tracking_began(store, date(2026, 10, 5))
    played(store, datetime(2026, 10, 5, 18, 30, tzinfo=UTC), datetime(2026, 10, 5, 19, 15, tzinfo=UTC))
    played(store, datetime(2026, 10, 12, 18, 0, tzinfo=UTC), datetime(2026, 10, 12, 18, 30, tzinfo=UTC))
    hours = build_stats(store, history, date(2026, 10, 18), "os_euro", "all", tz=PLAYERS_CLOCK)["play_hours"]
    assert hours["days"][0] == 2
    assert hours["cells"][0][20] == (30 + 30) / 2
    assert hours["cells"][0][21] == 15 / 2
    assert hours["levels"][0][20] == 3
    assert hours["days"] == [2] * 7  # fourteen days: two of each weekday
    assert (len(hours["cells"]), {len(row) for row in hours["cells"]}) == (7, {24})
    assert hours["cells"][0][19] == 0.0  # tracked, and nothing played: zero, which is not "not tracked"
    assert hours["cells"][1][20] == 0.0  # the same hour on a Tuesday
    assert (hours["levels"][0][21], hours["levels"][0][19], hours["levels"][1][20]) == (1, 0, 0)
    assert hours["empty"] is False


def test_a_weekday_not_tracked_in_the_period_has_no_cells(store, history):
    # Tracking began on Sunday 2026-10-11, the day the page is read: of the seven days it shows, one was tracked.
    tracking_began(store, date(2026, 10, 11))
    played(store, datetime(2026, 10, 11, 17, 0, tzinfo=UTC), datetime(2026, 10, 11, 17, 40, tzinfo=UTC))  # Sun 19:00 to 19:40
    played(store, datetime(2026, 10, 10, 17, 0, tzinfo=UTC), datetime(2026, 10, 10, 18, 0, tzinfo=UTC))  # Saturday: before tracking
    hours = build_stats(store, history, date(2026, 10, 11), "os_euro", "7", tz=PLAYERS_CLOCK)["play_hours"]
    assert hours["days"] == [0, 0, 0, 0, 0, 0, 1]
    assert hours["cells"][0] == [None] * 24  # Monday: not tracked
    assert hours["cells"][5] == [None] * 24  # Saturday: not tracked, and its session is left out
    assert hours["levels"][0] == [0] * 24
    assert hours["cells"][6][19] == 40.0
    assert hours["cells"][6][18] == 0.0
    assert hours["levels"][6][19] == 3
    assert hours["empty"] is False


def test_play_by_the_hour_splits_a_session_at_each_local_hour_and_day(store, history):
    # Monday 5 Oct 23:30 to Tuesday 6 Oct 00:45 on the PC's clock (UTC+2), which is 21:30 to 22:45 UTC. On the
    # server's clock (UTC+1) it is Monday 22:30 to 23:45, so the split must follow the PC, not the server.
    tracking_began(store, date(2026, 10, 5))
    played(store, datetime(2026, 10, 5, 21, 30, tzinfo=UTC), datetime(2026, 10, 5, 22, 45, tzinfo=UTC))
    hours = build_stats(store, history, date(2026, 10, 6), "os_euro", "all", tz=PLAYERS_CLOCK)["play_hours"]
    assert hours["days"] == [1, 1, 0, 0, 0, 0, 0]
    assert hours["cells"][0][23] == 30.0
    assert hours["cells"][1][0] == 45.0
    assert hours["cells"][0][22] == 0.0
    assert hours["cells"][1][1] == 0.0
    assert (hours["levels"][0][23], hours["levels"][1][0]) == (3, 4)
    assert sum(cell for row in hours["cells"] for cell in row if cell is not None) == 75.0  # the whole session, once


def test_play_by_the_hour_is_empty_when_the_period_holds_no_session(store, history):
    tracking_began(store, date(2026, 10, 5))
    played(store, datetime(2026, 9, 1, 18, 0, tzinfo=UTC), datetime(2026, 9, 1, 19, 0, tzinfo=UTC))  # before the period
    hours = build_stats(store, history, date(2026, 10, 18), "os_euro", "7", tz=PLAYERS_CLOCK)["play_hours"]
    assert hours["days"] == [1] * 7
    assert hours["empty"] is True
    assert all(cell == 0.0 for row in hours["cells"] for cell in row)
    assert all(level == 0 for row in hours["levels"] for level in row)


def test_play_by_the_hour_levels_change_at_fifteen_thirty_and_forty_five_minutes(store, history):
    tracking_began(store, date(2026, 10, 5))
    # One Monday (the 5th) is the only day of the period: minutes in the hours 10, 11, 12, 13 and 14 on the PC's clock.
    for hour, minutes in ((10, 14), (11, 15), (12, 29), (13, 30), (14, 45)):
        start = datetime(2026, 10, 5, hour - 2, 0, tzinfo=UTC)
        played(store, start, start + timedelta(minutes=minutes))
    hours = build_stats(store, history, date(2026, 10, 5), "os_euro", "all", tz=PLAYERS_CLOCK)["play_hours"]
    assert hours["days"] == [1, 0, 0, 0, 0, 0, 0]
    assert [hours["cells"][0][hour] for hour in range(10, 15)] == [14.0, 15.0, 29.0, 30.0, 45.0]
    assert [hours["levels"][0][hour] for hour in range(10, 15)] == [1, 2, 2, 3, 4]


def test_play_by_the_hour_follows_this_pcs_own_zone_when_none_is_given(store, history):
    # No zone given: the play hours follow the PC's own clock. A session an instant after local midnight begins the
    # local Monday whatever the zone is.
    tracking_began(store, date(2026, 10, 5))
    local_midnight = datetime(2026, 10, 5, 0, 0).astimezone(UTC)  # a naive time is the PC's own
    played(store, local_midnight, local_midnight + timedelta(minutes=20))
    hours = build_stats(store, history, date(2026, 10, 5), "os_euro", "all")["play_hours"]
    assert hours["cells"][0][0] == 20.0
    assert hours["days"][0] == 1
