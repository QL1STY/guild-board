import hashlib
import json

import pytest

from achievement_samples import SAMPLE_NOTES, SMALL_LIST, list_bytes, paimon_export
from guildboard.achievements.catalog import parse_catalog
from guildboard.achievements.importers import ImportBackupFailed, Imported, ImportFileError, apply_import, plan_import, read_file
from guildboard.achievements.progress import Progress
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.store import ProgressRow, Store
from support import FakeSleep

CATALOG = parse_catalog(list_bytes(SMALL_LIST))
SAVE = paimon_export(
    {"": {"0": {"80128": True, "80001": False, "99999": True}}}, {"": {"84508": {"0": True, "1": False}}},
)


def _import(store, clock, data: bytes, profile: str | None = None) -> dict:
    return apply_import(plan_import(read_file(data, "export.json", profile), CATALOG, store, clock.now()), store, clock.now())


def test_an_imported_part_number_past_the_lists_checklist_ticks_no_part_the_notes_add(store, clock):
    # Spec 7.2: Paimon.moe numbers parts as the list's checklist does. The parts Guild Board's notes add come after it
    # and no file numbers them, so a number past the checklist names none of them.
    save = read_file(paimon_export({"": {}}, {"": {"84508": {"2": True, "3": True}}}), "export.json")
    assert plan_import(save, CATALOG, store, clock.now()).parts == ((84508, 2),)


def test_a_paimon_export_brings_ticks_and_parts_and_keeps_what_the_list_does_not_hold(store, clock):
    summary = _import(store, clock, SAVE)
    assert {k: summary[k] for k in ("kind", "done", "in_progress", "pins", "notes", "parts", "unknown", "nothing_new")} == {
        "kind": "paimon", "done": 1, "in_progress": 0, "pins": 0, "notes": 0, "parts": 1, "unknown": [99999],
        "nothing_new": False,
    }
    rows = store.progress()
    assert rows[80128].status == "done" and rows[80128].source == "paimon" and rows[80128].done_at == clock.now()
    assert rows[99999].status == "done"  # kept, though the list does not hold it
    assert 80001 not in rows and store.parts() == {84508: {0: clock.now()}}
    [record] = store.imports()
    assert record.kind == "paimon" and record.summary["done"] == 1


def test_importing_again_changes_nothing_and_never_unticks(store, clock):
    _import(store, clock, SAVE)
    again = _import(store, clock, SAVE)
    assert again["nothing_new"] is True and again["done"] == 0 and again["parts"] == 0
    store.put_progress([ProgressRow(80128, "not_started", None, True, "Mine", "player", clock.now())])
    third = _import(store, clock, SAVE)  # the player's own un-tick is ticked again, and the pin and note stay
    assert third["done"] == 1
    assert (store.progress()[80128].pinned, store.progress()[80128].note) == (True, "Mine")
    assert len(store.imports()) == 3


def test_a_paimon_export_brings_its_ticks_and_parts_and_the_player_picks_a_profile(store, clock):
    export = paimon_export(
        {"": {"0": {"80127": True, "84508": False}, "17": {"81219": True}}, "second": {"0": {"80001": True}}},
        {"": {"84508": {"2": True}}},
    )
    source = read_file(export, "paimon-moe-local-data.json")
    assert source.kind == "paimon" and source.profiles == ("", "second") and source.profile == ""
    summary = _import(store, clock, export)
    assert summary["done"] == 2 and summary["unknown"] == []  # 81219 is read as 81222, which the list holds
    assert {i: r.status for i, r in store.progress().items()} == {80127: "done", 81222: "done"}
    assert store.parts() == {84508: {2: clock.now()}}
    assert _import(store, clock, export, "second")["done"] == 1
    assert store.progress()[80001].status == "done"


def test_paimon_values_other_than_true_are_not_guessed(store, clock):
    summary = _import(store, clock, paimon_export({"": {"0": {"80128": "true", "80129": 1, "84512": [True]}}}))
    assert summary["nothing_new"] is True


def test_paimon_categories_and_checklists_that_are_not_objects_are_skipped():
    export = paimon_export(
        {"": {"0": {"80127": True}, "1": None, "2": [True], "3": True}},
        {"": {"84508": {"1": True}, "80128": None, "80129": [True], "84512": True}},
    )
    assert read_file(export, "paimon-moe-local-data.json").stages == {
        80127: Imported("done"), 84508: Imported(None, parts=frozenset({1})),
    }
    checklist_in_a_list = paimon_export({"": {"0": {"80127": True}}}, {"": [{"84508": {"1": True}}]})
    assert read_file(checklist_in_a_list, "paimon-moe-local-data.json").stages == {80127: Imported("done")}


def test_with_no_profile_chosen_a_main_profile_without_achievements_is_passed_over():
    source = read_file(paimon_export({"": None, "second": {"0": {"80001": True}}}), "paimon-moe-local-data.json")
    assert (source.profile, source.profiles, source.stages) == ("second", ("second",), {80001: Imported("done")})


@pytest.mark.parametrize("data, message", [
    (b" " * 30_000_001, "The file is larger than 30 MB. No achievement save is that big."),
    (b"{", "The file is not valid JSON."),
    (b'{"hello": 1}', "This file is not a Paimon.moe export."),
], ids=["over 30 MB", "not JSON", "not an export"])
async def test_a_damaged_or_foreign_file_is_refused_with_a_sentence_and_changes_nothing(tmp_path, clock, data, message):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        text = paimon_export({"": {"0": {"81732": True}}}).decode("utf-8")
        preview = await core.preview_import(text, "export.json", None)
        await core.apply_import(text, "export.json", None, preview["fingerprint"])
        held = (core.store.progress(), core.store.parts(), core.store.imports())
        assert all(held)  # rows and parts, the demo's, and the import just made
        refused = data.decode("utf-8")
        for run in (
            lambda: core.preview_import(refused, "file.json", None),
            lambda: core.apply_import(refused, "file.json", None, "the fingerprint of any preview"),
        ):
            with pytest.raises(ImportFileError) as error:
                await run()
            assert str(error.value) == message
        assert (core.store.progress(), core.store.parts(), core.store.imports()) == held
    finally:
        core.store.close()


def test_a_profile_that_is_not_there_is_named(store):
    with pytest.raises(ImportFileError) as error:
        read_file(paimon_export({"": {"0": {"80127": True}}}), "p.json", "nobody")
    assert str(error.value) == "This Paimon.moe export has no profile named nobody."


def test_a_main_profile_that_is_not_there_is_called_the_main_profile():
    with pytest.raises(ImportFileError) as error:
        read_file(paimon_export({"second": {"0": {"80001": True}}}), "p.json", "")
    assert str(error.value) == "This Paimon.moe export has no main profile."


def test_half_of_an_emoji_in_a_profile_name_becomes_a_replacement_mark():
    # In the bytes, \ud83d is JSON's escape for half of an emoji. Python reads it as a lone surrogate, which no answer
    # can carry.
    export = paimon_export(
        {"": {"0": {"80127": True}}, "Lumine@": {"0": {"80001": True}}}, {"Lumine@": {"84508": {"2": True}}},
    ).replace(b"@", b"\\ud83d")
    lumine = read_file(export, "paimon-moe-local-data.json", "Lumine\ufffd")  # as the page names it, from `profiles`
    assert (lumine.profile, lumine.profiles) == ("Lumine\ufffd", ("", "Lumine\ufffd"))
    assert lumine.stages == {80001: Imported("done"), 84508: Imported(None, parts=frozenset({2}))}
    assert read_file(export, "paimon-moe-local-data.json", "Lumine\ud83d").stages == lumine.stages
    with pytest.raises(ImportFileError) as error:
        read_file(export, "paimon-moe-local-data.json", "Aether\ud83d")
    assert str(error.value) == "This Paimon.moe export has no profile named Aether\ufffd."


@pytest.mark.parametrize("data", [
    paimon_export({"": None}),
    b'{"update-time": 1, "accounts": ""}',
], ids=["a profile without achievements", "no achievements at all"])
def test_a_paimon_export_without_achievements_says_how_to_export_them(data):
    with pytest.raises(ImportFileError) as error:
        read_file(data, "paimon-moe-local-data.json")
    assert str(error.value) == "This file holds no Paimon.moe achievements. Export it from Paimon.moe: Settings, Export data."


NOT_JSON = "The file is not valid JSON."
NOT_AN_EXPORT = "This file is not a Paimon.moe export."
NO_ACHIEVEMENTS = "This file holds no Paimon.moe achievements. Export it from Paimon.moe: Settings, Export data."


def _json(value: object) -> bytes:
    return json.dumps(value).encode("utf-8")


# The other ways read_file refuses a file. With the three tests above, every sentence it can give is checked.
@pytest.mark.parametrize("data, profile, message", [
    (b" " * 30_000_000, None, NOT_JSON),  # exactly 30 MB is read, and spaces alone are not JSON
    (b'{"progress": {"80127": "\xff"}}', None, NOT_JSON),
    (b"[" * 100_000 + b"]" * 100_000, None, NOT_JSON),
    (b"[]", None, NOT_AN_EXPORT),
    (paimon_export({"": {"0": {"80127": True}}, "second": None}), "second", NO_ACHIEVEMENTS),
], ids=["exactly 30 MB", "not UTF-8", "nested too deep", "a list", "a chosen profile without achievements"])
def test_each_way_of_refusing_a_file_gives_its_sentence(data, profile, message):
    with pytest.raises(ImportFileError) as error:
        read_file(data, "file.json", profile)
    assert str(error.value) == message


def test_the_fingerprint_depends_on_the_data_and_the_profile_only():
    export = paimon_export({"": {"0": {"80127": True}}, "second": {"0": {"80001": True}}})
    main = read_file(export, "paimon-moe-local-data.json").fingerprint
    assert main == hashlib.sha256(export + b"\n").hexdigest()
    assert read_file(export, "a copy.json", "").fingerprint == main
    second = read_file(export, "paimon-moe-local-data.json", "second").fingerprint
    assert second == hashlib.sha256(export + b"\nsecond").hexdigest() and second != main
    changed = paimon_export({"": {"0": {"80127": True, "80128": True}}, "second": {"0": {"80001": True}}})
    assert read_file(changed, "paimon-moe-local-data.json").fingerprint != main
    assert read_file(SAVE, "export.json").fingerprint == hashlib.sha256(SAVE + b"\n").hexdigest()


def test_an_import_makes_a_backup_only_when_it_changes_something(tmp_path, clock):
    store = Store.open(tmp_path / "guildboard.db", tmp_path / "backups", clock.now())
    try:
        _import(store, clock, SAVE)
        clock.advance(minutes=1)  # backups are named to the second: a wrong second one must not overwrite the first
        _import(store, clock, SAVE)
        assert len(list((tmp_path / "backups").glob("guildboard-auto-import-*.db"))) == 1
    finally:
        store.close()


def test_an_import_whose_backup_fails_stops_and_writes_nothing(tmp_path, clock):
    (tmp_path / "backups").write_bytes(b"")  # a file where the backups folder goes, so no backup can be made
    store = Store.open(tmp_path / "guildboard.db", tmp_path / "backups", clock.now())
    try:
        progress = Progress(store, lambda: CATALOG, SAMPLE_NOTES, clock)
        progress.set_pinned(80128, True)
        before = store.progress()
        with pytest.raises(ImportBackupFailed) as error:
            _import(store, clock, SAVE)
        assert str(error.value) == (
            "Guild Board could not back up its database before the import, so nothing was imported. See the log file."
        )
        assert isinstance(error.value.__cause__, OSError)  # the folder for backups is a file
        assert store.progress() == before and store.parts() == {} and store.imports() == []
        assert progress.undo() == "Pinned Zoo Tycoon"  # the undo history is not ended either
    finally:
        store.close()


def test_an_import_adds_only_the_parts_a_listed_stage_has(tmp_path, clock):
    store = Store.open(tmp_path / "guildboard.db", tmp_path / "backups", clock.now())
    try:
        progress = Progress(store, lambda: CATALOG, SAMPLE_NOTES, clock)
        progress.set_pinned(81732, True)
        # Part 5 of Pirates! Argh!, which has three parts, and part 0 of Zoo Tycoon, which has none.
        summary = _import(store, clock, paimon_export({"": {}}, {"": {"84508": {"5": True}, "80127": {"0": True}}}))
        assert (summary["parts"], summary["nothing_new"]) == (0, True)
        assert store.parts() == {}
        assert list((tmp_path / "backups").glob("guildboard-auto-import-*.db")) == []
        assert progress.undo() == "Pinned Winter Night's Letter"  # the undo history is not ended
        # A stage the list does not hold keeps every part: nothing can check them.
        assert _import(store, clock, paimon_export({"": {}}, {"": {"99999": {"7": True}}}))["parts"] == 1
        assert store.parts() == {99999: {7: clock.now()}}
    finally:
        store.close()


def test_an_import_that_changes_something_ends_the_undo_history(store, clock):
    progress = Progress(store, lambda: CATALOG, SAMPLE_NOTES, clock)
    progress.set_pinned(80128, True)
    _import(store, clock, SAVE)
    assert progress.undo() is None  # an undo cannot take the imported tick away
    assert (store.progress()[80128].status, store.progress()[80128].pinned) == ("done", True)
    progress.set_pinned(80001, True)
    assert _import(store, clock, SAVE)["nothing_new"] is True
    assert progress.undo() == "Pinned The Wind and The Star Traveler"
    assert 80001 not in store.progress()
