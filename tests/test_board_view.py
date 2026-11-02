from datetime import date, datetime, timedelta, timezone

import pytest

from guildboard.achievements.catalog import bundled_raw, parse_catalog
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.history import History
from guildboard.views.achievements import Query
from guildboard.views.board import build_board
from support import FakeSleep

UTC = timezone.utc
CATALOG = parse_catalog(bundled_raw())
NEW_KEYS = ("expeditions", "expeditions_max", "transformer_obtained", "transformer_ready_at", "realm_currency_full_at")


@pytest.fixture
def core(tmp_path, clock):
    # The demo at its 08:00 UTC on Tuesday 2026-10-13, on the Europe server.
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    yield core
    core.store.close()


def test_the_board_model_names_the_next_resets_on_server_time(core, clock):
    board = core.board_model()
    assert board["server"] == {"key": "os_euro", "utc_offset_hours": 1}
    assert board["resets"] == {"daily_at": "2026-10-14T03:00:00+00:00", "weekly_at": "2026-10-19T03:00:00+00:00"}
    clock.advance(days=12, hours=4)  # Sunday 2026-10-25, 12:00 UTC: Europe's clocks went back that night, the server's did not
    assert core.board_model()["resets"] == {
        "daily_at": "2026-10-26T03:00:00+00:00", "weekly_at": "2026-10-26T03:00:00+00:00",
    }


def test_the_board_model_counts_todays_play(core):
    day = date(2026, 10, 13)
    playtime = core.board_model()["playtime"]
    assert {key: playtime[key] for key in ("running", "session_started_at", "today_minutes")} == {
        "running": False, "session_started_at": None,
        "today_minutes": int(core.history.playtime_minutes(day, day, "os_euro")[day]),
    }


TODAY = date(2026, 10, 13)  # the game day of 08:00 UTC on Europe's server, whose day turns at 03:00 UTC


def _play(store, started: datetime, minutes: int) -> None:
    session = store.open_session(started, False)
    store.touch_session(session, started + timedelta(minutes=minutes))


def test_the_board_model_holds_the_last_seven_game_days_of_play(store):
    # Sessions of 30 min yesterday and 45 min today, and one on the eighth game day back, which the week leaves out.
    _play(store, datetime(2026, 10, 5, 18, 0, tzinfo=UTC), 90)
    _play(store, datetime(2026, 10, 12, 18, 0, tzinfo=UTC), 30)
    _play(store, datetime(2026, 10, 13, 5, 0, tzinfo=UTC), 45)
    now = datetime(2026, 10, 13, 8, tzinfo=UTC)
    playtime = build_board(CATALOG, store, History(store), "os_euro", now, False, None)["playtime"]
    week = playtime["week"]
    assert [day["minutes"] for day in week][-2:] == [30, 45]
    assert len(week) == 7 and week[-1]["day"] == TODAY.isoformat()
    # Oldest first, one entry for each game day, a day with no play counting 0.
    assert [day["day"] for day in week] == [(TODAY - timedelta(days=back)).isoformat() for back in range(6, -1, -1)]
    assert [day["minutes"] for day in week] == [0, 0, 0, 0, 0, 30, 45]
    assert playtime["today_minutes"] == week[-1]["minutes"]


def test_a_session_across_the_daily_reset_is_split_between_the_game_days_of_the_week(store):
    # 02:30 to 03:45 UTC is 03:30 to 04:45 server time: half an hour of the day before and three quarters of today.
    _play(store, datetime(2026, 10, 13, 2, 30, tzinfo=UTC), 75)
    now = datetime(2026, 10, 13, 8, tzinfo=UTC)
    week = build_board(CATALOG, store, History(store), "os_euro", now, False, None)["playtime"]["week"]
    assert [day["minutes"] for day in week][-2:] == [30, 45]


def _read_now(core, clock) -> None:
    """The notes as a sync at the core's time would leave them. The demo's history ends with a read at 02:00 UTC,
    which belongs to the game day before, and these tests run no sync."""
    _, doc = core.store.latest_doc("notes")
    core.store.set_latest_doc("notes", clock.now(), doc)


def test_the_board_model_keeps_the_notes_and_when_they_were_read(core, clock):
    _read_now(core, clock)
    notes = core.board_model()["notes"]
    assert (notes["read_today"], notes["read_this_week"], len(notes["expeditions"]), notes["expeditions_max"]) == (
        True, True, 5, 5,
    )
    assert notes["expeditions"][0] == {"icon": None, "back_at": None}  # the demo has no pictures
    assert notes["transformer"]["ready_at"] > notes["read_at"] and notes["realm_currency_full_at"] > notes["read_at"]
    assert (notes["commissions_max"], notes["boss_discounts_left"], notes["boss_discounts_max"]) == (4, 1, 3)
    assert (notes["realm_currency"], notes["realm_currency_max"]) == (1800, 2400)


def test_an_expeditions_picture_is_served_by_the_icon_cache(core):
    taken_at, doc = core.store.latest_doc("notes")
    picture = "https://upload-os-bbs.mihoyo.com/game_record/genshin/character_side_icon/UI_AvatarIcon_Side_Noel.png"
    doc["expeditions"][0] = {"icon_url": picture, "back_at": None}
    core.store.set_latest_doc("notes", taken_at, doc)
    assert core.board_model()["notes"]["expeditions"][0] == {"icon": "/api/icon/character.side.noel", "back_at": None}


def test_notes_read_before_this_plan_have_no_expedition_details(core):
    taken_at, doc = core.store.latest_doc("notes")
    core.store.set_latest_doc("notes", taken_at, {key: value for key, value in doc.items() if key not in NEW_KEYS})
    notes = core.board_model()["notes"]
    assert (notes["expeditions"], notes["expeditions_max"], notes["transformer"], notes["realm_currency_full_at"]) == (
        None, 0, None, None,
    )


def test_notes_read_before_the_daily_reset_are_not_todays(core, clock):
    _read_now(core, clock)
    clock.advance(days=1)  # the next game day, before the next sync
    notes = core.board_model()["notes"]
    assert (notes["read_today"], notes["read_this_week"]) == (False, True)
    clock.advance(days=6)  # the next week
    assert core.board_model()["notes"]["read_this_week"] is False


def test_with_no_notes_read_the_board_model_has_none(store):
    board = build_board(CATALOG, store, History(store), "os_euro", datetime(2026, 10, 13, 8, tzinfo=UTC), False, None)
    assert (board["notes"], board["achievements"]["hoyolab"], board["undo"]) == (None, None, None)
    assert board["achievements"]["done"] == 0 and board["achievements"]["left"] == board["achievements"]["stages"]


def test_the_board_model_carries_the_achievement_totals_and_hoyolabs_count(core):
    model = core.achievements(Query())
    assert core.board_model()["achievements"] == {**model["totals"], "hoyolab": model["hoyolab"]}
    assert model["hoyolab"] is not None  # the demo counts some


def test_the_board_model_offers_the_newest_change_to_undo(core):
    stage = core.achievements(Query())["groups"][0]["stages"][0]["id"]
    label = core.progress.set_pinned(stage, True)
    assert core.board_model()["undo"] == label
