import copy
from datetime import datetime, timezone

import pytest

from achievement_samples import (
    NOTES_WITH_A_PART, SAMPLE_NOTES, SMALL_LIST, list_bytes, paimon_export,
)
from guildboard.achievements.catalog import parse_catalog
from guildboard.achievements.importers import apply_import, plan_import, read_file
from guildboard.achievements.notes import parse_notes
from guildboard.achievements.progress import Progress
from guildboard.store import ProgressRow, iso
from guildboard.views.achievements import Query, build_achievements

NOW = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)
CATALOG = parse_catalog(list_bytes(SMALL_LIST))
WONDERS = (84508, 84512, 81732, 80127, 80128, 80129)


def _done(store, *ids: int) -> None:
    store.put_progress([ProgressRow(i, "done", NOW, False, "", "player", NOW) for i in ids])


def _build(store, **query):
    return build_achievements(CATALOG, SAMPLE_NOTES, store, Query(**query))


def test_the_left_view_opens_on_the_first_category_with_something_left(store):
    _done(store, *WONDERS)
    model = _build(store)
    assert model["query"]["category"] == "2"
    assert [g["id"] for g in model["groups"]] == [82055]
    assert model["totals"] == {"stages": 11, "done": 6, "left": 5, "primogems_left": 45}
    assert [(c["name"], c["stages"], c["left"]) for c in model["categories"]] == [
        ("Wonders of the World", 6, 0), ("Challenger: Series II", 3, 3), ("Mortal Travails: Series I", 2, 2),
    ]


def test_the_stages_of_a_tier_show_together_in_every_view(store):
    _done(store, 80127)
    left = _build(store, category="0")
    zoo = next(g for g in left["groups"] if g["id"] == 80127)
    assert [(s["id"], s["status"]) for s in zoo["stages"]] == [(80127, "done"), (80128, "not_started"), (80129, "not_started")]
    assert zoo["stages"][0]["done_at"] == iso(NOW)
    assert [g["id"] for g in _build(store, category="0", view="done")["groups"]] == [80127]
    assert len(_build(store, category="0", view="all")["groups"]) == 4


def test_search_looks_through_names_and_descriptions_in_every_category(store):
    assert [g["id"] for g in _build(store, search="hilichurl")["groups"]] == [82055]
    assert [g["id"] for g in _build(store, search="DANDELION")["groups"]] == [80001]
    assert _build(store, search="nothing like this")["groups"] == []


def test_pinned_shows_the_pinned_achievements_from_every_category(store):
    store.put_progress([
        ProgressRow(84508, "in_progress", None, True, "", "player", NOW),
        ProgressRow(82057, "not_started", None, True, "", "player", NOW),
    ])
    model = _build(store, pinned=True)
    assert [g["id"] for g in model["groups"]] == [84508, 82055]
    assert model["pinned"] == 2


def test_counters_parts_notes_and_wiki_links_are_in_the_model(store):
    store.put_counter(82055, 17, NOW)
    store.put_part(84508, 1, NOW)
    store.put_progress([ProgressRow(84508, "in_progress", None, False, "Little Fei left", "player", NOW)])
    hilichurl = _build(store, category="2")["groups"][0]
    assert hilichurl["counter"] == {"value": 17, "unit": "", "unit_one": None, "targets": [1, 20, 50]}
    pirates = _build(store, category="0")["groups"][0]
    stage = pirates["stages"][0]
    assert stage["note"] == "Little Fei left" and stage["status"] == "in_progress"
    assert stage["parts"] == [
        {"label": "Little Meng", "done_at": None}, {"label": "Little Lulu", "done_at": iso(NOW)},
        {"label": "Little Fei", "done_at": None},
    ]
    assert stage["wiki"] == "https://genshin-impact.fandom.com/wiki/Special:Search?query=Pirates%21%20Argh%21"
    godwin = next(g for g in _build(store, category="0")["groups"] if g["id"] == 84512)
    assert godwin["counter"] == {"value": 0, "unit": "times finished", "unit_one": None, "targets": [5]}


def test_a_counter_passes_on_its_unit_after_a_target_of_1(store):
    notes = parse_notes({"checked_against": "7.1", "not_in_order": [], "wiki": {}, "counters": {
        "82055": {"unit": "kills", "unit_one": "kill", "targets": [1, 20, 50]},
    }})
    hilichurl = build_achievements(CATALOG, notes, store, Query(category="2"))["groups"][0]
    assert hilichurl["counter"] == {"value": 0, "unit": "kills", "unit_one": "kill", "targets": [1, 20, 50]}


def test_progress_without_a_listed_achievement_is_counted_apart(store):
    _done(store, 81219)
    model = _build(store)
    assert model["unlisted"] == 1 and model["totals"]["done"] == 0
    rows = _build(store, unlisted=True)
    assert rows["groups"] == [] and rows["unlisted_rows"] == [
        {"id": 81219, "status": "done", "note": "", "pinned": False, "parts": 0, "count": None},
    ]


def test_parts_and_counts_on_stages_a_later_list_drops_show_under_not_in_the_current_list(store):
    store.put_part(84508, 0, NOW)
    store.put_part(84508, 2, NOW)  # Pirates! Argh!: two parts done, and no row
    store.put_counter(84512, 3, NOW)  # For the Love of Godwin: a count, and no row
    store.put_progress([ProgressRow(82055, "in_progress", None, True, "Behind the hill", "player", NOW)])
    store.put_counter(82055, 17, NOW)  # the hilichurl's count is kept under its first stage's id
    assert _build(store)["unlisted"] == 0  # the list holds every one of them
    later = copy.deepcopy(SMALL_LIST)
    del later["0"]["achievements"][:2]  # no Pirates! Argh! and no For the Love of Godwin
    later["2"]["achievements"].clear()  # and no hilichurl
    catalog = parse_catalog(list_bytes(later))
    assert build_achievements(catalog, SAMPLE_NOTES, store, Query())["unlisted"] == 3
    assert build_achievements(catalog, SAMPLE_NOTES, store, Query(unlisted=True))["unlisted_rows"] == [
        {"id": 82055, "status": "in_progress", "note": "Behind the hill", "pinned": True, "parts": 0, "count": 17},
        {"id": 84508, "status": "not_started", "note": "", "pinned": False, "parts": 2, "count": None},
        {"id": 84512, "status": "not_started", "note": "", "pinned": False, "parts": 0, "count": 3},
    ]


def test_what_keeps_nothing_is_not_progress_under_not_in_the_current_list(store):
    # Unticking leaves a row that is not started, with no pin and no note, and a count can go back to 0.
    store.put_progress([ProgressRow(99001, "not_started", None, False, "", "player", NOW)])
    store.put_counter(99002, 0, NOW)
    assert _build(store)["unlisted"] == 0
    assert _build(store, unlisted=True)["unlisted_rows"] == []


def test_a_card_lists_the_parts_the_notes_add_after_the_lists_own(store):
    pirates = build_achievements(CATALOG, NOTES_WITH_A_PART, store, Query(search="Pirates"))["groups"][0]["stages"][0]
    assert [part["label"] for part in pirates["parts"]] == ["Little Meng", "Little Lulu", "Little Fei", "Little Bo"]


def test_an_imported_part_of_an_achievement_the_list_does_not_hold_shows_under_not_in_the_current_list(store, clock):
    export = paimon_export({"": {}}, {"": {"99999": {"0": True}}})  # its only news: part 0 of an unknown id
    plan = plan_import(read_file(export, "paimon-moe-local-data.json"), CATALOG, store, clock.now())
    assert (plan.summary()["parts"], plan.summary()["unknown"], plan.nothing_new) == (1, [99999], False)
    apply_import(plan, store, clock.now())
    assert _build(store)["unlisted"] == 1
    assert _build(store, unlisted=True)["unlisted_rows"] == [
        {"id": 99999, "status": "not_started", "note": "", "pinned": False, "parts": 1, "count": None},
    ]


def test_the_model_names_the_newest_change_an_undo_would_put_back(store, clock):
    progress = Progress(store, lambda: CATALOG, SAMPLE_NOTES, clock)
    assert _build(store)["undo"] is None  # nothing to undo
    progress.set_pinned(84508, True)
    progress.set_status(81732, "done")
    assert _build(store)["undo"] == "Ticked Winter Night's Letter"
    assert _build(store)["undo"] == "Ticked Winter Night's Letter"  # reading it takes nothing out of the history
    assert progress.undo() == "Ticked Winter Night's Letter"
    assert _build(store)["undo"] == "Pinned Pirates! Argh!"
    plan = plan_import(read_file(paimon_export({"": {"0": {"80127": True}}}), "export.json"), CATALOG, store, clock.now())
    assert apply_import(plan, store, clock.now())["nothing_new"] is False
    assert _build(store)["undo"] is None  # an import that changed something ends the undo history


def test_each_stage_carries_its_own_name_and_the_group_its_first_stages(store):
    renamed = copy.deepcopy(SMALL_LIST)
    renamed["0"]["achievements"][3][1]["name"] = "Zoo Tycoon II"  # 80128, the second stage of Zoo Tycoon
    catalog = parse_catalog(list_bytes(renamed))
    model = build_achievements(catalog, SAMPLE_NOTES, store, Query(category="0"))
    zoo = next(g for g in model["groups"] if g["id"] == 80127)
    assert zoo["name"] == "Zoo Tycoon"
    assert [(s["id"], s["name"]) for s in zoo["stages"]] == [
        (80127, "Zoo Tycoon"), (80128, "Zoo Tycoon II"), (80129, "Zoo Tycoon"),
    ]
    found = build_achievements(catalog, SAMPLE_NOTES, store, Query(search="tycoon ii"))
    assert [g["id"] for g in found["groups"]] == [80127]  # a later stage's own name is searched too


def test_the_left_view_leaves_out_a_tier_with_every_stage_done(store):
    _done(store, 80127, 80128, 80129)
    assert [g["id"] for g in _build(store, category="0")["groups"]] == [84508, 84512, 81732]


def test_search_finds_a_match_in_the_name_alone(store):
    assert [g["id"] for g in _build(store, search="zoo tycoon")["groups"]] == [80127]  # not in its descriptions


def test_pinned_keeps_a_done_achievement_in_the_left_view(store):
    store.put_progress([ProgressRow(84512, "done", NOW, True, "", "player", NOW)])
    assert 84512 not in [g["id"] for g in _build(store, category="0")["groups"]]
    model = _build(store, pinned=True)
    assert model["query"]["view"] == "left"
    assert [g["id"] for g in model["groups"]] == [84512]


def test_with_every_stage_done_the_page_opens_on_the_first_category_and_shows_nothing(store):
    _done(store, *(stage.id for stage in CATALOG.stages))
    model = _build(store)
    assert model["totals"] == {"stages": 11, "done": 11, "left": 0, "primogems_left": 0}
    assert model["query"]["category"] == "0"
    assert model["groups"] == []


def test_a_search_in_the_done_view_leaves_out_a_group_with_nothing_done(store):
    _done(store, 80001)
    # "Whispers in the Wind" is in 84512's description, and "The Wind and The Star Traveler" is 80001's name.
    assert [g["id"] for g in _build(store, view="all", search="wind")["groups"]] == [84512, 80001]
    assert [g["id"] for g in _build(store, view="done", search="wind")["groups"]] == [80001]


def test_a_search_of_only_spaces_counts_as_no_search(store):
    model = _build(store, search="   ")
    assert [g["id"] for g in model["groups"]] == [84508, 84512, 81732, 80127]  # category "0", as with no search
    assert model["query"]["search"] == "   "  # given back as it came


def test_an_unknown_or_empty_category_key_resolves_as_none_does(store):
    _done(store, *WONDERS)
    opened = _build(store)
    assert opened["query"]["category"] == "2"
    assert _build(store, category="9") == opened
    assert _build(store, category="") == opened


def test_an_unknown_view_is_refused(store):
    with pytest.raises(ValueError, match="unknown view"):
        _build(store, view="later")


def _ids(model) -> list[int]:
    return [g["id"] for g in model["groups"]]


def test_a_kept_group_stays_in_the_left_view_after_its_tick(store):
    _done(store, 81732)
    assert _ids(_build(store, category="0")) == [84508, 84512, 80127]
    kept = _build(store, category="0", keep=frozenset({81732}))
    assert _ids(kept) == [84508, 84512, 81732, 80127]  # in its place in the list
    letter = next(g for g in kept["groups"] if g["id"] == 81732)
    assert [s["status"] for s in letter["stages"]] == ["done"]
    assert kept["totals"]["done"] == 1  # the totals and the counts do not change for it


def test_a_kept_group_stays_whatever_pinned_or_the_done_view_decides(store):
    store.put_progress([
        ProgressRow(84508, "in_progress", None, True, "", "player", NOW),
        ProgressRow(84512, "not_started", None, False, "", "player", NOW),  # unpinned a moment ago
    ])
    pinned = _build(store, pinned=True, keep=frozenset({84512}))
    assert _ids(pinned) == [84508, 84512]
    assert pinned["pinned"] == 1
    assert _ids(_build(store, category="0", view="done", keep=frozenset({84512}))) == [84512]  # nothing of it is done


def test_the_category_and_the_search_still_decide_for_a_kept_group(store):
    _done(store, 81732, 82055)
    assert 82055 not in _ids(_build(store, category="0", keep=frozenset({82055})))  # in another category
    assert _ids(_build(store, search="pirates", keep=frozenset({81732}))) == [84508]  # the search does not find it
    assert 82055 in _ids(_build(store, pinned=True, keep=frozenset({82055})))  # Pinned holds every category


def test_the_query_names_the_kept_groups_in_order(store):
    assert _build(store)["query"]["keep"] == []
    assert _build(store, keep=frozenset({84512, 81732}))["query"]["keep"] == [81732, 84512]
