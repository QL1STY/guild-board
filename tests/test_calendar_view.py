"""The Calendar widget's model (the widgets design, 2.3): the banners and events the last read kept, the Endgame lane from the
endgame summaries, and how many events are left to finish."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from guildboard.metrics import calendar_face_key
from guildboard.records import (
    CalendarBanner, CalendarBoardRecord, CalendarEvent, CalendarFace, CalendarRecord, EndgameMode, EndgameRecord,
)
from guildboard.store import iso
from guildboard.views.calendar import build_calendar

UTC = timezone.utc
NOW = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)
SERVER = "os_euro"
FACE = "https://act-webstatic.hoyoverse.com/face.png"


def _at(days: float) -> str:
    return iso(NOW + timedelta(days=days))


def _event(ident: int, name: str, begins: float | None, finishes: float | None, **more) -> CalendarEvent:
    dated = begins is not None and finishes is not None
    return CalendarEvent(
        ident, name, _at(begins) if dated else None, _at(finishes) if dated else None, more.pop("finished", False),
        more.pop("primogems", None), more.pop("explored", None), more.pop("left", None), more.pop("total", None),
        status=more.pop("status", 2), dated=dated,
    )


def _keep(store, board, taken=NOW - timedelta(minutes=10)) -> None:
    store.set_latest_doc("calendar", taken, asdict(CalendarRecord(2, 2, None, board)))


def _banners() -> tuple[CalendarBanner, ...]:
    return (
        CalendarBanner(
            "character", ("Furina", "Zhongli"), _at(-3), _at(18),
            (CalendarFace("Furina", 5, FACE), CalendarFace("Zhongli", 5, ""), CalendarFace("Amber", 4, FACE)),
        ),
        CalendarBanner("weapon", ("A Sword",), _at(-3), _at(18), (CalendarFace("A Sword", 5, ""),)),
    )


def test_the_view_gives_the_banners_with_their_faces_and_the_icons_the_core_serves(store):
    _keep(store, CalendarBoardRecord(_banners(), ()))
    view = build_calendar(store, NOW, SERVER)
    assert view["read"] is True and view["read_at"] == iso(NOW - timedelta(minutes=10))
    character, weapon = view["banners"]
    assert (character["kind"], character["name"], character["starts"], character["ends"]) == (
        "character", "Furina · Zhongli", _at(-3), _at(18)
    )
    assert character["id"] != weapon["id"] and weapon["name"] == "A Sword"
    assert [(f["name"], f["rarity"], f["icon"]) for f in character["faces"]] == [
        ("Furina", 5, "/api/icon/" + calendar_face_key(FACE)), ("Zhongli", 5, None), ("Amber", 4, "/api/icon/" + calendar_face_key(FACE)),
    ]
    assert set(character["faces"][0]) == {"name", "rarity", "icon"}


def test_events_carry_their_dates_their_completion_and_what_the_answer_holds(store):
    events = (
        _event(1, "Running", -2, 5, primogems=420, left=2, total=3, explored=40.0),
        _event(2, "Done", -2, 1, finished=True),
    )
    _keep(store, CalendarBoardRecord((), events))
    running, done = build_calendar(store, NOW, SERVER)["events"]
    assert running == {
        "id": 1, "name": "Running", "starts": _at(-2), "ends": _at(5), "finished": False, "primogems": 420,
        "explored": 40.0, "double": {"left": 2, "total": 3}, "soon": False, "status": 2, "source": "hoyolab",
    }
    assert (done["finished"], done["primogems"], done["double"], done["explored"]) == (True, None, None, None)


def test_left_counts_events_started_not_finished_and_not_ended(store):
    events = (
        _event(1, "Left", -2, 5),
        _event(2, "Left too", -1, 0.5),
        _event(3, "Done", -2, 5, finished=True),
        _event(4, "Not started", 1, 9),
        _event(5, "Ended a day ago", -9, -1),
        _event(6, "Coming soon", None, None, status=1),
    )
    _keep(store, CalendarBoardRecord((), events))
    view = build_calendar(store, NOW, SERVER)
    assert view["left"] == 2
    names = [e["name"] for e in view["events"]]
    assert names == ["Left", "Left too", "Done", "Not started", "Ended a day ago", "Coming soon"]


def test_events_that_ended_more_than_two_days_ago_are_left_out(store):
    events = (_event(1, "Long gone", -20, -2.5), _event(2, "Just ended", -20, -1.9), _event(3, "Done and gone", -9, -3, finished=True))
    _keep(store, CalendarBoardRecord((), events))
    assert [e["name"] for e in build_calendar(store, NOW, SERVER)["events"]] == ["Just ended"]


def test_an_event_with_no_dates_is_coming_soon_and_is_never_counted_or_ended(store):
    _keep(store, CalendarBoardRecord((), (_event(7, "Soon", None, None, status=1, primogems=300),)))
    view = build_calendar(store, NOW + timedelta(days=400), SERVER)
    (soon,) = view["events"]  # no end, so it never ages out
    assert (soon["starts"], soon["ends"], soon["soon"], soon["status"], soon["source"]) == (None, None, True, 1, "hoyolab")
    assert soon["primogems"] == 300 and view["left"] == 0


def test_a_calendar_kept_before_the_board_existed_says_it_is_not_read_yet(store):
    store.set_latest_doc("calendar", NOW, asdict(CalendarRecord(3, 4)))
    view = build_calendar(store, NOW, SERVER)
    assert (view["read"], view["read_at"], view["banners"], view["events"], view["left"]) == (False, None, [], [], 0)


def test_no_calendar_read_at_all_gives_the_same(store):
    view = build_calendar(store, NOW, SERVER)
    assert (view["read"], view["read_at"], view["banners"], view["events"], view["endgame"], view["left"]) == (
        False, None, [], [], [], 0
    )


def test_the_endgame_lane_is_the_endgame_resets_modes(store):
    modes = tuple(
        EndgameMode(k, k.title(), True, "x", 3.0, _at(-10), _at(5), "") for k in ("abyss", "theater", "stygian")
    )
    store.set_latest_doc("endgame", NOW, asdict(EndgameRecord(modes)))
    _keep(store, CalendarBoardRecord((), ()))
    view = build_calendar(store, NOW, SERVER)
    assert [m["mode"] for m in view["endgame"]] == ["abyss", "theater", "stygian"] and view["endgame"][0]["ends_at"] == _at(5)
    assert set(view) == {"read_at", "read", "banners", "events", "endgame", "left", "upcoming_from"}
