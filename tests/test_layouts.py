import re

import pytest

from guildboard.board.layouts import (
    STARTING,
    LayoutChanged,
    LayoutError,
    Layouts,
    UnknownPlace,
    UnknownWidget,
)

SHAPE = "A layout is a list of at most 60 widgets, each with an id, a type, a size and its settings."


@pytest.fixture
def layouts(store, clock):
    return Layouts(store, clock)


def test_the_board_starts_with_the_eight_widgets_of_spec_13_2(store, clock):
    layout = Layouts(store, clock).get("board")
    assert (layout["place"], layout["revision"], layout["saved"]) == ("board", 0, False)
    assert [(widget["type"], widget["w"], widget["h"]) for widget in layout["widgets"]] == [
        ("timers", 4, 3), ("commissions", 3, 3), ("pinned", 4, 3), ("resin", 2, 1),
        ("expeditions", 3, 2), ("resets", 2, 1), ("clock", 2, 1), ("notes", 3, 3),
    ]
    assert [widget["id"] for widget in layout["widgets"]] == [
        "start-timers", "start-commissions", "start-pinned", "start-resin",
        "start-expeditions", "start-resets", "start-clock", "start-notes",
    ]
    assert all(widget["settings"] == {} for widget in layout["widgets"])


def test_a_saved_layout_comes_back_at_the_next_revision(store, clock):
    layouts = Layouts(store, clock)
    clock_widget = {"id": "clock-1", "type": "clock", "w": 2, "h": 1, "settings": {"seconds": True}}
    saved = {"place": "board", "revision": 1, "widgets": [clock_widget], "saved": True}
    assert layouts.save("board", 0, [clock_widget]) == saved
    assert Layouts(store, clock).get("board") == saved
    assert layouts.save("board", 1, [])["revision"] == 2


def test_a_save_over_a_newer_layout_is_refused(store, clock):
    layouts = Layouts(store, clock)
    layouts.save("board", 0, [])
    with pytest.raises(LayoutChanged, match="The Board changed meanwhile. Look at it again."):
        layouts.save("board", 0, [])


def test_a_layout_of_the_wrong_shape_is_refused_in_one_sentence(store, clock):
    good = {"id": "a", "type": "clock", "w": 2, "h": 1, "settings": {}}
    cases = [
        {"widgets": []}, [{**good, "id": f"w{n}"} for n in range(61)],
        [{**good, "id": "Bad Id"}], [{**good, "type": ""}], [{**good, "w": 0}], [{**good, "h": 9}],
        [{**good, "w": True}], [{**good, "w": 2.0}], [{**good, "settings": []}],
        [{key: good[key] for key in ("id", "type", "w", "h")}], [{**good, "settings": {"text": "x" * 2_000}}],
        ["clock"], None,
    ]
    for widgets in cases:
        with pytest.raises(LayoutError, match=re.escape(SHAPE)):
            Layouts(store, clock).save("board", 0, widgets)
    with pytest.raises(LayoutError, match="Two widgets on one board have the same id."):
        Layouts(store, clock).save("board", 0, [good, good])
    assert Layouts(store, clock).get("board")["saved"] is False  # nothing was half-saved


@pytest.mark.parametrize("place", [{"x": -1, "y": 0}, {"x": 100, "y": 0}, {"x": 0, "y": 200}, {"x": "3", "y": 0}, {"x": True, "y": 0}])
def test_a_widget_place_is_whole_cells_from_zero(layouts, place):
    with pytest.raises(LayoutError):
        layouts.save("board", 0, [{"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, **place}])


def test_a_widget_place_is_kept(layouts):
    saved = layouts.save("board", 0, [{"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, "x": 3, "y": 5}])
    assert saved["widgets"][0] | {} == {"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, "x": 3, "y": 5}


@pytest.mark.parametrize("place", [{"x": 0, "y": 0}, {"x": 99, "y": 199}, {"x": 4}, {"y": 7}])
def test_a_place_at_the_edges_or_half_given_is_kept(layouts, place):
    saved = layouts.save("board", 0, [{"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, **place}])
    assert saved["widgets"][0] == {"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, **place}


def test_a_refused_place_is_refused_in_the_layouts_sentence(layouts):
    for place in ({"x": 2.0}, {"y": None}, {"x": 0, "y": -3}):
        with pytest.raises(LayoutError, match=re.escape(SHAPE)):
            layouts.save("board", 0, [{"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, **place}])
    assert layouts.get("board")["saved"] is False


def test_a_widgets_place_in_a_maximized_window_is_kept_beside_its_place_in_a_window(layouts):
    widget = {
        "id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, "x": 3, "y": 5,
        "full": {"x": 7, "y": 0, "w": 3, "h": 2},
    }
    assert layouts.save("board", 0, [widget])["widgets"] == [widget]
    unplaced = {"id": "d", "type": "clock", "w": 2, "h": 1, "settings": {}, "full": {"x": 99, "y": 199, "w": 8, "h": 8}}
    assert layouts.save("board", 1, [unplaced])["widgets"] == [unplaced]  # added there: no place in a window yet


@pytest.mark.parametrize("full", [
    {"x": 0, "y": 0, "w": 0, "h": 1}, {"x": 100, "y": 0, "w": 1, "h": 1}, {"x": 0, "y": 200, "w": 1, "h": 1},
    {"x": 0, "y": 0, "w": 9, "h": 1}, {"x": -1, "y": 0, "w": 1, "h": 1}, {"x": 0, "y": 0, "w": 1},
    {"x": "1", "y": 0, "w": 1, "h": 1}, {"x": True, "y": 0, "w": 1, "h": 1}, {"x": 0, "y": 0, "w": 1.0, "h": 1},
    {"x": 0, "y": 0, "w": 1, "h": 1, "z": 2}, [0, 0, 1, 1], None,
])
def test_a_place_in_a_maximized_window_is_whole_cells_with_a_size_or_is_refused(layouts, full):
    with pytest.raises(LayoutError, match=re.escape(SHAPE)):
        layouts.save("board", 0, [{"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, "full": full}])


def test_a_type_or_a_key_this_version_does_not_know_is_kept(store, clock):
    later = {"id": "map-1", "type": "map", "w": 6, "h": 4, "settings": {"tab": "fishing"}, "anchor": "top-right"}
    layouts = Layouts(store, clock)
    layouts.save("board", 0, [later])
    assert Layouts(store, clock).get("board")["widgets"] == [later]


def test_an_unknown_place_is_refused(store, clock):
    with pytest.raises(UnknownPlace):
        Layouts(store, clock).get("elsewhere")
    with pytest.raises(UnknownPlace):
        Layouts(store, clock).save("elsewhere", 0, [])


def test_the_overlay_starts_with_four_widgets_and_the_timers_pinned(store, clock):
    layout = Layouts(store, clock).get("overlay")
    assert (layout["place"], layout["revision"], layout["saved"]) == ("overlay", 0, False)
    assert layout["widgets"] == [
        {"id": "start-ov-timers", "type": "timers", "w": 3, "h": 2, "x": 0, "y": 3, "settings": {}, "pinned": True},
        {"id": "start-ov-clock", "type": "clock", "w": 2, "h": 1, "x": 0, "y": 5, "settings": {}},
        {"id": "start-ov-quick", "type": "quick-timer", "w": 2, "h": 2, "x": 0, "y": 6, "settings": {}},
        {"id": "start-ov-commissions", "type": "commissions", "w": 2, "h": 3, "x": 3, "y": 3, "settings": {}},
    ]
    assert [widget["id"] for widget in layout["widgets"] if "pinned" in widget] == ["start-ov-timers"]


def test_the_boards_starting_widgets_have_no_place_and_are_not_pinned(store, clock):
    assert all(not {"x", "y", "pinned"} & widget.keys() for widget in Layouts(store, clock).get("board")["widgets"])


@pytest.mark.parametrize("pinned", ["yes", 1, 0, None, [], {}])
def test_pinned_is_true_or_false(layouts, pinned):
    with pytest.raises(LayoutError, match=re.escape(SHAPE)):
        layouts.save("overlay", 0, [{"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}, "pinned": pinned}])
    assert layouts.get("overlay")["saved"] is False


def test_pinned_true_and_false_are_kept(layouts):
    clock_widget = {"id": "c", "type": "clock", "w": 2, "h": 1, "settings": {}}
    widgets = [{**clock_widget, "pinned": True}, {**clock_widget, "id": "d", "pinned": False}, {**clock_widget, "id": "e"}]
    saved = layouts.save("overlay", 0, widgets)
    assert saved["widgets"] == widgets
    assert layouts.get("overlay") == saved


def test_each_place_keeps_its_own_revision(layouts):
    layouts.save("board", 0, [])
    assert layouts.get("overlay")["revision"] == 0  # the Board's save left the overlay as it was
    assert layouts.save("overlay", 0, [])["revision"] == 1
    assert layouts.get("board")["revision"] == 1
    with pytest.raises(LayoutChanged, match="The overlay changed meanwhile. Look at it again."):
        layouts.save("overlay", 0, [])


def test_widget_data_stays_while_either_place_holds_the_widget(layouts):
    note = {"id": "note-1", "type": "notes", "w": 3, "h": 3, "settings": {}}
    layouts.save("board", 0, [note])
    layouts.save("overlay", 0, [note])
    layouts.put_data("note-1", {"text": "Mint"})
    layouts.save("board", 1, [])
    assert layouts.data("note-1") == {"text": "Mint"}  # the overlay still holds it
    layouts.save("overlay", 1, [])
    assert layouts.data("note-1") is None


def test_widget_data_can_be_kept_for_a_widget_of_the_starting_overlay(layouts):
    layouts.put_data("start-ov-quick", {"text": "kept"})
    layouts.save("board", 0, [])  # the Board's save does not take the overlay's widgets' data with it
    assert layouts.data("start-ov-quick") == {"text": "kept"}


def test_widget_data_is_kept_and_goes_with_its_widget(store, clock):
    layouts = Layouts(store, clock)
    layouts.put_data("start-notes", {"text": "Buy Sweet Flowers"})  # on the starting Board, never saved
    assert layouts.data("start-notes") == {"text": "Buy Sweet Flowers"}
    layouts.put_data("start-clock", {"text": "kept"})
    layouts.save("board", 0, [w for w in layouts.get("board")["widgets"] if w["id"] != "start-notes"])
    assert (layouts.data("start-notes"), layouts.data("start-clock")) == (None, {"text": "kept"})


def test_widget_data_for_no_widget_or_too_long_is_refused(store, clock):
    with pytest.raises(UnknownWidget, match="There is no widget with this id."):
        Layouts(store, clock).put_data("notes-9", {"text": ""})
    with pytest.raises(LayoutError, match="A widget keeps at most 20,000 characters."):
        Layouts(store, clock).put_data("start-notes", {"text": "x" * 20_000})
    assert Layouts(store, clock).data("notes-9") is None


def test_the_pin_adds_one_one_timer_widget_and_takes_it_off(store, clock):
    layouts = Layouts(store, clock)
    assert layouts.pin_timer(7, True) is True
    board = layouts.get("board")
    one_timer = {"id": "pin-7", "type": "one-timer", "w": 2, "h": 2, "settings": {"timer": 7}}
    assert (board["revision"], board["saved"], board["widgets"][-1]) == (1, True, one_timer)
    assert layouts.pin_timer(7, True) is False and layouts.pinned_timers() == {7}
    assert layouts.pin_timer(7, False) is True and layouts.pinned_timers() == frozenset()
    assert layouts.pin_timer(7, False) is False
    assert [w["id"] for w in layouts.get("board")["widgets"]] == [w["id"] for w in STARTING["board"]]


def test_a_pin_takes_the_next_free_id(store, clock):
    layouts = Layouts(store, clock)
    taken = {"id": "pin-7", "type": "clock", "w": 2, "h": 1, "settings": {}}
    layouts.save("board", 0, [taken])
    layouts.pin_timer(7, True)
    assert [w["id"] for w in layouts.get("board")["widgets"]] == ["pin-7", "pin-7-2"]


def test_half_an_emoji_in_a_widgets_data_or_settings_becomes_a_replacement_character(store, clock):
    # The page's JSON can carry half of an emoji, which neither SQLite nor the answers to the page can write.
    layouts = Layouts(store, clock)
    layouts.put_data("start-notes", {"text": "Fish \ud83d"})
    assert layouts.data("start-notes") == {"text": "Fish \ufffd"}
    widget = {"id": "clock-1", "type": "clock", "w": 2, "h": 1, "settings": {"label": "\ud83d"}}
    assert layouts.save("board", 0, [widget])["widgets"][0]["settings"] == {"label": "\ufffd"}
