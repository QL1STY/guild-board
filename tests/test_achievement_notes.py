from achievement_samples import SMALL_LIST, list_bytes
from guildboard.achievements.catalog import bundled_catalog, parse_catalog
from guildboard.achievements.notes import (
    EMPTY_NOTES, CommissionNote, Counter, derive_targets, load_notes, parse_notes, wiki_link,
)


def test_counter_targets_come_from_the_one_number_that_grows():
    catalog = bundled_catalog()
    for group, targets in (
        (82055, (1, 20, 50)), (81134, (100, 500, 2000)), (81087, (40, 200, 800)),
        (80221, (1, 5, 10)), (80218, (10000, 70000, 150000)),
    ):
        assert derive_targets(catalog.group(group)) == targets, group
    assert derive_targets(catalog.group(82220)) is None  # a Local Legend: its stages count nothing
    assert derive_targets(catalog.group(80001)) is None  # one stage alone counts only when the notes say so


def test_the_notes_add_the_counters_the_list_cannot_give():
    notes, catalog = load_notes(), bundled_catalog()
    assert notes.checked_against == "7.1"
    assert notes.counter(catalog, 81620) == Counter(81620, (1, 12, 22), "Lunar Arcana held at once")
    assert notes.counter(catalog, 84512) == Counter(84512, (5,), "times finished")
    assert notes.counter(catalog, 82055) == Counter(82055, (1, 20, 50), "kills", unit_one="kill")
    assert notes.counter(catalog, 81134) == Counter(81134, (100, 500, 2000), "")
    assert notes.counter(catalog, 80001) is None


def test_a_counter_may_name_its_unit_after_a_target_of_1():
    notes = parse_notes({"checked_against": "7.1", "not_in_order": [], "wiki": {}, "counters": {
        "82055": {"unit": "kills", "unit_one": "kill", "targets": [1, 20, 50]},
        "84512": {"unit": "times finished", "targets": [5]},
    }})
    assert (notes.counters[82055].unit, notes.counters[82055].unit_one) == ("kills", "kill")
    assert notes.counters[84512].unit_one is None  # the unit stays as it is
    # In the bundled notes, only the hilichurl's unit changes after a target of 1: "1 kill", "20 kills".
    assert {group: c.unit_one for group, c in load_notes().counters.items() if c.unit_one is not None} == {82055: "kill"}


def test_a_counter_in_the_notes_is_used_only_with_one_target_per_stage():
    notes = parse_notes({"checked_against": "7.1", "not_in_order": [], "wiki": {}, "counters": {
        "82055": {"unit": "kills", "targets": [1, 20]}, "84512": {"unit": "times finished", "targets": [5, 10]},
    }})
    catalog = parse_catalog(list_bytes(SMALL_LIST))
    assert notes.counter(catalog, 82055) == Counter(82055, (1, 20, 50), "")  # the list has a stage more
    assert notes.counter(catalog, 84512) is None  # the list has a stage fewer, and one stage alone derives nothing


def test_every_counter_in_the_notes_fits_the_bundled_list():
    catalog = bundled_catalog()
    for group, counter in load_notes().counters.items():
        stages = catalog.group(group)  # empty unless `group` is the first stage of an achievement
        assert stages, group
        assert len(counter.targets) == len(stages), group
        assert all(a < b for a, b in zip(counter.targets, counter.targets[1:])), group


def test_the_wiki_link_searches_the_wiki_for_the_name_unless_the_notes_name_a_page():
    stage = bundled_catalog().stage(80127)
    assert wiki_link(EMPTY_NOTES, stage) == "https://genshin-impact.fandom.com/wiki/Special:Search?query=Zoo%20Tycoon"
    notes = parse_notes({"checked_against": "7.1", "counters": {}, "not_in_order": [],
                         "wiki": {"80127": "https://genshin-impact.fandom.com/wiki/Zoo_Tycoon"}})
    assert wiki_link(notes, stage) == "https://genshin-impact.fandom.com/wiki/Zoo_Tycoon"


GOOD_SIGN = "https://genshin-impact.fandom.com/wiki/Good_Sign"
COMMISSION_NOTES = {
    "checked_against": "7.1", "counters": {}, "not_in_order": [], "wiki": {},
    "commissions": {
        "84510": {"order": True, "how": "Leave everything alone.", "sources": [GOOD_SIGN]},
        "84573": {"region": "sumeru", "quests": ["The Conformist"], "parts": ["First visit", "Second visit"],
                  "order": True, "how": "Choose the second answer.", "first": "Finish the Aranyaka.",
                  "sources": ["https://example.org/a"]},
    },
    "not_commissions": [84541],
}


def test_commission_notes_are_read():
    notes = parse_notes(COMMISSION_NOTES)
    assert notes.commissions[84510] == CommissionNote(None, (), (), True, "Leave everything alone.", "", (GOOD_SIGN,))
    assert notes.commissions[84573] == CommissionNote(
        "sumeru", ("The Conformist",), ("First visit", "Second visit"), True, "Choose the second answer.",
        "Finish the Aranyaka.", ("https://example.org/a",),
    )
    assert notes.not_commissions == frozenset({84541})
    # Notes from before plan 2A-2 have neither key.
    assert (EMPTY_NOTES.commissions, EMPTY_NOTES.not_commissions) == ({}, frozenset())


def test_the_notes_add_parts_after_the_lists_own():
    pirates = parse_catalog(list_bytes(SMALL_LIST)).stage(84508)  # the list's parts: Little Meng, Lulu and Fei
    added = {"84508": {"order": False, "how": "", "parts": ["Little Bo"], "sources": ["https://example.org/b"]}}
    notes = parse_notes({**COMMISSION_NOTES, "commissions": added})
    assert notes.parts(pirates) == (*pirates.parts, "Little Bo")
    assert EMPTY_NOTES.parts(pirates) == pirates.parts
