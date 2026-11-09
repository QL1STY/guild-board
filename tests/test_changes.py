import json

import pytest

from guildboard import changes
from guildboard.changes import ChangeItem, load_changes, read_items


def test_a_plain_line_is_an_item_without_a_kind():
    assert read_items(["A line."]) == [{"kind": None, "title": "A line.", "text": ""}]


def test_an_item_keeps_its_kind_title_and_text():
    item = {"kind": "fixed", "title": "T", "text": "Why."}
    assert read_items([item]) == [item]


@pytest.mark.parametrize("bad", [{"kind": "huge", "title": "T", "text": ""}, {"kind": "new", "text": ""}, 7])
def test_an_item_the_file_gets_wrong_is_refused(bad):
    with pytest.raises(ValueError):
        read_items([bad])


def test_the_shipped_notes_hold_the_five_items_of_0_4_1():
    notes = load_changes()
    assert "0.4.1" in notes
    assert [(item["kind"], item["title"]) for item in notes["0.4.1"]] == [
        ("new", "Remove a code from the history"),
        ("better", "Gift codes in a new look"),
        ("better", "Log in before the first code"),
        ("better", "Updates you can't miss"),
        ("fixed", '"Log in again" after a refused code'),
    ]
    assert all(item["text"] for item in notes["0.4.1"])
    assert notes["0.4.0"][0]["kind"] is None  # the older entry stays as plain lines


def test_every_shipped_item_is_valid():
    text = changes.resources.files("guildboard").joinpath("reference", "changes.json").read_text(encoding="utf-8")
    for items in json.loads(text).values():
        read_items(items)
    assert ChangeItem  # the type is public


def test_2_1_1_tells_of_the_steady_ledger_chart():
    notes = load_changes()
    assert next(iter(notes)) == "2.1.1"
    assert notes["2.1.1"] == [
        {
            "kind": "fixed",
            "title": "A steady Ledger chart",
            "text": "Moving the pointer along a chart on the Ledger no longer makes its card jump in height.",
        },
    ]


def test_2_1_0_tells_of_the_themes_and_the_ledger():
    notes = load_changes()
    assert notes["2.1.0"] == [
        {
            "kind": "new",
            "title": "Themes",
            "text": "Choose how the window looks in Settings: Parchment, Midnight, Slate, Dusk, Mist, or Match Windows, which follows Windows' light or dark mode. There are also seven looks, one for each nation, from Mondstadt to Snezhnaya.",
        },
        {
            "kind": "better",
            "title": "A new Ledger",
            "text": "The Ledger shows your primogems as a chart and a history of days, with what came from where, your commissions and your wishes; what you spent can be hidden.",
        },
    ]


def test_2_0_2_tells_of_the_rarity_filters():
    notes = load_changes()
    assert [(item["kind"], item["title"]) for item in notes["2.0.2"]] == [
        ("new", "Wish history by rarity"), ("new", "Characters by rarity"),
    ]
    assert "reverse" in notes["2.0.2"][1]["text"]


def test_2_0_1_tells_of_the_page_size():
    notes = load_changes()
    assert [(item["kind"], item["title"]) for item in notes["2.0.1"]] == [
        ("new", "Page size"), ("new", "A Board for a full screen"), ("better", "Updates from the code's own page"),
    ]
    assert "Ctrl" in notes["2.0.1"][0]["text"]
    assert "github.com/QL1STY/guild-board" in notes["2.0.1"][2]["text"]


def test_2_0_0_tells_of_the_new_stats_and_of_the_pictures_from_outside_hoyoverse():
    notes = load_changes()
    newest = "2.0.0"
    titles = [item["title"] for item in notes[newest]]
    # The window comes first, as the headline of 2.0.0; the earlier, unreleased entry's five follow it in their order.
    assert titles[0] == "A smoother window"
    assert titles[1:6] == ["A fuller Overview", "The Endgame card", "Months", "The Year", "Public pictures"]
    # The one-time note of the Stats design, section 1, word for word.
    picture = next(item for item in notes[newest] if item["title"] == "Public pictures")
    assert picture["text"] == (
        "Guild Board now also downloads public pictures from outside HoYoverse, such as the Endgame headers. "
        "Nothing of yours is sent with them."
    )
