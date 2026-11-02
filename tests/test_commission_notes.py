"""What Guild Board's notes know about the commission achievements, checked against the bundled list (spec 11.2)."""
import json
from datetime import date
from importlib import resources

from guildboard.achievements.catalog import bundled_catalog
from guildboard.achievements.notes import load_notes
from guildboard.config import REGIONS

# The achievements spec 11.2 names: they look as if they came from commissions, but Paimon.moe does not mark them.
CANDIDATES = (84573, 84574, 84575, 84578, 84579, 84581, 84582, 84564, 84565, 84563, 84551, 84552, 84547, 84541)


def test_every_commission_note_names_a_listed_stage_with_its_sources():
    notes, catalog = load_notes(), bundled_catalog()
    assert notes.commissions
    for stage_id, note in notes.commissions.items():
        stage = catalog.stage(stage_id)
        assert stage is not None, stage_id
        assert (note.region or stage.region) in REGIONS, stage_id  # a note gives the region when the list has none
        assert note.how and note.sources and all(source.startswith("https://") for source in note.sources), stage_id
    assert not notes.not_commissions & notes.commissions.keys()
    assert all(catalog.stage(stage_id) is not None for stage_id in notes.not_commissions)


def test_every_liyue_commission_achievement_has_its_note():
    liyue = {stage.id for stage in bundled_catalog().stages if stage.region == "liyue"}
    assert len(liyue) == 14 and liyue <= load_notes().commissions.keys()


def test_the_fourteen_candidates_are_settled():
    notes = load_notes()
    for stage_id in CANDIDATES:
        note = notes.commissions.get(stage_id)
        assert (note is not None and note.region is not None) or stage_id in notes.not_commissions, stage_id


def test_the_knowledge_says_when_it_was_checked():
    text = resources.files("guildboard").joinpath("reference", "achievement_notes.json").read_text(encoding="utf-8")
    assert date.fromisoformat(json.loads(text)["commissions_checked"])
