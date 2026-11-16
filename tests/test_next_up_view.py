"""The Next up widget's model (the widgets design, 2.1): one timeline put together from the Board model, the timers, Pulls' running
banners, the endgame resets and the Calendar's events."""
from datetime import datetime, timedelta, timezone

from guildboard.store import BannerRow, iso
from guildboard.views.nextup import build_next_up

UTC = timezone.utc
NOW = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)


def _at(hours: float) -> str:
    return iso(NOW + timedelta(hours=hours))


def _notes(**more) -> dict:
    base = {
        "resin_full_at": None, "expeditions": None, "expeditions_max": 5, "transformer": None, "realm_currency": 0,
        "realm_currency_max": 0, "realm_currency_full_at": None,
    }
    return {**base, **more}


def _board(notes=None, daily=24.0, weekly=96.0) -> dict:
    return {"resets": {"daily_at": _at(daily), "weekly_at": _at(weekly)}, "notes": notes}


def _timer(name: str, state: str, ready_hours: float | None) -> dict:
    return {"name": name, "state": state, "ready_at": None if ready_hours is None else _at(ready_hours)}


def _banner(ann, pool, featured, ends_hours, starts_hours=-48.0) -> BannerRow:
    return BannerRow(ann, "A banner", pool, tuple(featured), "", NOW + timedelta(hours=starts_hours), NOW + timedelta(hours=ends_hours), NOW)


def _mode(key, label, ends_hours, stale=False) -> dict:
    return {"mode": key, "label": label, "ends_at": None if ends_hours is None else _at(ends_hours), "stale": stale}


def _build(board=None, timers=(), banners=(), modes=(), events=None):
    return build_next_up(
        board if board is not None else _board(), {"timers": list(timers)}, list(banners), {"modes": list(modes)}, events, NOW,
    )


def _names(view) -> list[str]:
    return [item["name"] for item in view["items"]]


def test_a_board_with_nothing_but_the_resets_lists_the_two_resets_not_ready():
    view = _build()
    assert [(i["kind"], i["name"], i["at"], i["ready"], i["count"]) for i in view["items"]] == [
        ("daily", "Daily reset", _at(24), False, 1), ("weekly", "Weekly reset", _at(96), False, 1),
    ]
    assert view["ready"] == 0


def test_timers_ready_and_running_are_listed_and_a_finished_one_is_not():
    view = _build(timers=[
        _timer("Running", "running", 5), _timer("Ready", "ready", -2), _timer("Never cleared", "ready", None),
        _timer("Done", "finished", None),
    ])
    assert _names(view)[:3] == ["Ready", "Never cleared", "Running"]  # ready first, the one with no time after the one with
    assert "Done" not in _names(view)
    assert [i["ready"] for i in view["items"][:3]] == [True, True, False] and view["ready"] == 2


def test_resin_full_is_ready_once_its_time_has_come():
    ahead = _build(_board(_notes(resin_full_at=_at(3))))
    assert [(i["kind"], i["name"], i["ready"]) for i in ahead["items"] if i["kind"] == "resin"] == [("resin", "Resin full", False)]
    full = _build(_board(_notes(resin_full_at=_at(-1))))
    assert [(i["name"], i["ready"]) for i in full["items"] if i["kind"] == "resin"] == [("Resin is full", True)]
    assert full["ready"] == 1 and full["items"][0]["kind"] == "resin"  # ready ones are first


def test_with_no_notes_read_there_are_no_notes_rows():
    view = _build(_board(None))
    assert {i["kind"] for i in view["items"]} == {"daily", "weekly"}


def test_expeditions_back_are_one_row_and_each_one_out_is_a_row():
    notes = _notes(expeditions=[
        {"icon": None, "back_at": _at(-3)}, {"icon": None, "back_at": None}, {"icon": None, "back_at": _at(-1)},
        {"icon": None, "back_at": _at(2)}, {"icon": None, "back_at": _at(6)},
    ])
    view = _build(_board(notes))
    back = [i for i in view["items"] if i["kind"] == "expedition"]
    assert [(i["name"], i["ready"], i["count"]) for i in back] == [
        ("3 expeditions are back", True, 3), ("Expedition back", False, 1), ("Expedition back", False, 1),
    ]
    assert back[0]["at"] == _at(-3) and [i["at"] for i in back[1:]] == [_at(2), _at(6)]
    assert view["ready"] == 3  # each ready thing counts


def test_one_expedition_back_says_so_plainly():
    view = _build(_board(_notes(expeditions=[{"icon": None, "back_at": _at(-1)}])))
    assert _names(view)[0] == "1 expedition is back" and view["ready"] == 1


def test_realm_currency_only_when_it_has_a_maximum():
    none = _build(_board(_notes(realm_currency=100, realm_currency_max=0, realm_currency_full_at=_at(4))))
    assert "realm" not in {i["kind"] for i in none["items"]}
    filling = _build(_board(_notes(realm_currency=100, realm_currency_max=2400, realm_currency_full_at=_at(4))))
    assert [(i["name"], i["ready"]) for i in filling["items"] if i["kind"] == "realm"] == [("Realm currency full", False)]
    full = _build(_board(_notes(realm_currency=2400, realm_currency_max=2400, realm_currency_full_at=None)))
    assert [(i["name"], i["ready"]) for i in full["items"] if i["kind"] == "realm"] == [("Realm currency full", True)]


def test_the_transformer_is_listed_when_the_player_has_one():
    waiting = _build(_board(_notes(transformer={"ready_at": _at(7)})))
    assert [(i["name"], i["ready"]) for i in waiting["items"] if i["kind"] == "transformer"] == [("Transformer ready", False)]
    ready = _build(_board(_notes(transformer={"ready_at": None})))
    assert [(i["name"], i["ready"]) for i in ready["items"] if i["kind"] == "transformer"] == [("Transformer ready", True)]
    assert "transformer" not in {i["kind"] for i in _build(_board(_notes()))["items"]}


def test_banners_that_end_together_are_one_row_and_each_has_its_own_words():
    banners = [
        _banner(1, "character", ["Furina"], 72), _banner(2, "character", ["Zhongli"], 72), _banner(3, "weapon", ["A Sword", "A Bow"], 72),
        _banner(4, "chronicled", ["Something"], 100), _banner(5, "character", ["Nilou"], 30),
        _banner(6, "character", ["Ended"], -1, starts_hours=-90), _banner(7, "character", ["Coming"], 400, starts_hours=10),
        _banner(8, "other", ["Odd"], 60),
    ]
    view = _build(banners=banners)
    assert [i["name"] for i in view["items"] if i["kind"] == "banner"] == [
        "Nilou's banner ends", "Furina and Zhongli's banners end", "Weapon banner ends", "Chronicled Wish ends",
    ]


def test_three_characters_of_one_end_are_named_with_commas():
    view = _build(banners=[_banner(1, "character", [name], 72) for name in ("A", "B", "C")])
    assert [i["name"] for i in view["items"] if i["kind"] == "banner"] == ["A, B and C's banners end"]


def test_endgame_modes_that_are_not_stale_are_listed_with_their_own_verb():
    view = _build(modes=[
        _mode("abyss", "Spiral Abyss", 50), _mode("theater", "Imaginarium Theater", 30, stale=True),
        _mode("stygian", "Stygian Onslaught", 200), _mode("other", "No end", None),
    ])
    assert [(i["name"], i["at"]) for i in view["items"] if i["kind"] == "endgame"] == [
        ("Spiral Abyss resets", _at(50)), ("Stygian Onslaught ends", _at(200)),
    ]


def _event(name, starts, ends, **more) -> dict:
    return {
        "name": name, "starts": None if starts is None else _at(starts), "ends": None if ends is None else _at(ends),
        "finished": False, "soon": starts is None, **more,
    }


def test_events_are_listed_only_once_the_calendar_was_read_and_only_while_they_run_unfinished():
    events = [
        _event("Running", -24, 40), _event("Done", -24, 40, finished=True), _event("Ended", -48, -1), _event("Not yet", 10, 90),
        _event("Soon", None, None), _event("Wiki dated", 10, 90, source="fandom"),
    ]
    assert [i["name"] for i in _build(events=events)["items"] if i["kind"] == "event"] == ["Running ends"]
    assert [i for i in _build(events=None)["items"] if i["kind"] == "event"] == []


def test_ready_things_are_first_then_the_rest_by_time():
    view = _build(
        _board(_notes(resin_full_at=_at(-2), transformer={"ready_at": _at(1)})),
        timers=[_timer("Soon", "running", 0.5)],
        modes=[_mode("abyss", "Spiral Abyss", 10)],
    )
    assert _names(view) == ["Resin is full", "Soon", "Transformer ready", "Spiral Abyss resets", "Daily reset", "Weekly reset"]
    assert view["ready"] == 1


# The Next up styles (the widgets polish, 2026-11-15): an item says which endgame mode it is and when it began, so that a style can
# draw how far along it is. `started_at` is None where the start cannot be known.
def _by_kind(view, kind) -> list[dict]:
    return [i for i in view["items"] if i["kind"] == kind]


def test_an_endgame_item_names_its_mode_and_no_other_item_has_one():
    view = _build(
        _board(_notes(resin_full_at=_at(4))), modes=[_mode("abyss", "Spiral Abyss", 50), _mode("stygian", "Stygian Onslaught", 200)],
    )
    assert [(i["name"], i["mode"]) for i in _by_kind(view, "endgame")] == [("Spiral Abyss resets", "abyss"), ("Stygian Onslaught ends", "stygian")]
    assert all(i["mode"] is None for i in view["items"] if i["kind"] != "endgame")


def test_a_timer_begins_when_it_says_it_started():
    started = _timer("Running", "running", 5)
    started["started_at"] = _at(-3)
    view = _build(timers=[started, _timer("No start", "running", 6)])
    assert [(i["name"], i["started_at"]) for i in _by_kind(view, "timer")] == [("Running", _at(-3)), ("No start", None)]


def test_resin_begins_two_hundred_resin_before_it_is_full_and_so_the_share_is_resin_over_200():
    view = _build(_board(_notes(resin_full_at=_at(10))))
    (resin,) = _by_kind(view, "resin")
    assert resin["started_at"] == iso(NOW + timedelta(hours=10) - timedelta(minutes=1600))


def test_expeditions_have_no_start_the_game_does_not_say():
    view = _build(_board(_notes(expeditions=[{"back_at": _at(2)}, {"back_at": _at(-1)}])))
    assert all(i["started_at"] is None for i in _by_kind(view, "expedition"))


def test_the_realm_currency_begins_where_the_read_amount_and_the_full_time_put_an_empty_pot():
    # Read now at 1200 of 2400, full in 12 h: the pot gains 100 an hour, so it was empty 12 h before the read.
    notes = _notes(realm_currency=1200, realm_currency_max=2400, realm_currency_full_at=_at(12), read_at=_at(0))
    (realm,) = _by_kind(_build(_board(notes)), "realm")
    assert realm["started_at"] == _at(-12)
    unread = _notes(realm_currency=100, realm_currency_max=2400, realm_currency_full_at=_at(4))  # no read time: nothing to count from
    assert _by_kind(_build(_board(unread)), "realm")[0]["started_at"] is None


def test_the_transformer_begins_166_hours_before_it_is_ready():
    (transformer,) = _by_kind(_build(_board(_notes(transformer={"ready_at": _at(30)}))), "transformer")
    assert transformer["started_at"] == iso(NOW + timedelta(hours=30) - timedelta(hours=166))


def test_the_resets_begin_a_day_and_a_week_before_they_come():
    view = _build(_board(daily=10.0, weekly=100.0))
    assert [(i["kind"], i["started_at"]) for i in view["items"]] == [
        ("daily", iso(NOW + timedelta(hours=10) - timedelta(days=1))), ("weekly", iso(NOW + timedelta(hours=100) - timedelta(days=7))),
    ]


def test_an_endgame_item_carries_its_modes_icon_and_no_other_item_has_one():
    with_icon = {**_mode("abyss", "Spiral Abyss", 50), "header": {"icon": "/api/art/" + "a" * 32, "picture": None, "crop": None}}
    without = {**_mode("theater", "Imaginarium Theater", 60), "header": {"icon": None, "picture": None, "crop": None}}
    bare = _mode("stygian", "Stygian Onslaught", 200)  # a model with no header at all
    view = _build(_board(_notes(resin_full_at=_at(4))), modes=[with_icon, without, bare])
    assert [i["icon"] for i in _by_kind(view, "endgame")] == ["/api/art/" + "a" * 32, None, None]
    assert all(i["icon"] is None for i in view["items"] if i["kind"] != "endgame")


def test_a_banner_begins_when_it_started_and_an_endgame_mode_and_an_event_when_theirs_did():
    mode = {**_mode("abyss", "Spiral Abyss", 50), "starts_at": _at(-200)}
    view = _build(
        banners=[_banner(1, "character", ["Furina"], 72, starts_hours=-48)], modes=[mode, _mode("theater", "Theater", 60)],
        events=[_event("Running", -24, 40)],
    )
    assert _by_kind(view, "banner")[0]["started_at"] == _at(-48)
    assert [i["started_at"] for i in _by_kind(view, "endgame")] == [_at(-200), None]
    assert _by_kind(view, "event")[0]["started_at"] == _at(-24)
