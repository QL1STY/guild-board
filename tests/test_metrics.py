import hashlib
from datetime import date, datetime, timedelta, timezone

import hoyolab_samples as samples
from guildboard import metrics
from guildboard.metrics import DIARY_PREFIX, EARNED_KEY, SOURCE_PREFIX, Label, Point, diary_sources, month_key
from guildboard.sources.hoyolab_normalize import normalize_notes
from guildboard.records import (
    ArchonChapter,
    Area,
    CharactersRecord,
    DiaryMonth,
    DiaryRecord,
    DiarySource,
    EndgameMode,
    EndgameRecord,
    NotesRecord,
    Offering,
    OverviewRecord,
    Region,
)


def _overview(**changes) -> OverviewRecord:
    base = dict(
        nickname="Traveler",
        server="os_euro",
        adventure_rank=60,
        counters={"achievements": 10.0, "chests.common": 5.0, "oculi.cryo": 3.0, "raw.new_thing_number": 7.0},
        regions=(
            Region(
                8, 0, "Sumeru", 93.4, "https://act-webstatic.hoyoverse.com/sumeru.png",
                (Offering("Tree of Dreams", 50),), (Area("Desert of Hadramaveth", 96.0),),
            ),
            Region(5, 3, "Chenyu Vale", 100.5),
        ),
    )
    base.update(changes)
    return OverviewRecord(**base)


def _notes(open_chapters: int, finished: bool) -> NotesRecord:
    chapters = tuple(ArchonChapter(i, "ongoing", f"Chapter {i}", "Title") for i in range(open_chapters))
    return NotesRecord(10, 200, None, 0, 2400, 0, 4, 0, 3, 0, 5, chapters, finished)


def test_slug():
    assert metrics.slug("Desert of Hadramaveth") == "desert-of-hadramaveth"
    assert metrics.slug("  Mt. Laixin!  ") == "mt-laixin"
    assert metrics.slug("Sacred Sakura's Favor") == "sacred-sakura-s-favor"
    assert metrics.slug("须弥") == "须弥"
    assert metrics.slug("!!!") == "x"


def test_overview_points_and_labels():
    points, labels = metrics.overview(_overview())
    values = {p.key: p.value for p in points}
    assert values["stats.achievements"] == 10.0
    assert values["stats.chests.common"] == 5.0
    assert values["explore.8.pct"] == 93.4
    assert values["explore.8.area.desert-of-hadramaveth.pct"] == 96.0
    assert values["explore.8.offering.tree-of-dreams.level"] == 50.0
    by_key = {label.key: label for label in labels}
    assert by_key["explore.8"] == Label(
        "explore.8", "Sumeru", "region", None, "https://act-webstatic.hoyoverse.com/sumeru.png", 0
    )
    assert by_key["explore.8.area.desert-of-hadramaveth"].parent_key == "explore.8"
    assert by_key["explore.8.offering.tree-of-dreams"].kind == "offering"
    assert by_key["explore.5"].parent_key == "explore.3"
    assert by_key["explore.5"].sort == 1


def test_percentages_are_capped_at_100():
    points, _ = metrics.overview(_overview())
    assert {p.key: p.value for p in points}["explore.5.pct"] == 100.0
    assert metrics.cap_pct(-3) == 0.0
    assert metrics.cap_pct(41.26) == 41.3


def test_unknown_counters_pass_through():
    points, _ = metrics.overview(_overview())
    assert Point("stats.raw.new_thing_number", 7.0) in points


def test_oculi_labels():
    _, labels = metrics.overview(_overview(counters={"oculi.cryo": 3.0, "oculi.luno": 9.0, "oculi.zappo": 1.0}))
    names = {label.key: label.label for label in labels if label.kind == "oculi"}
    assert names == {
        "stats.oculi.cryo": "Cryoculi",
        "stats.oculi.luno": "Lunoculi",
        "stats.oculi.zappo": "Zappoculi",
    }


def test_notes_characters_and_endgame_points():
    assert metrics.notes(_notes(2, False)) == [Point("quests.archon.open", 2.0)]
    assert metrics.notes(_notes(0, True)) == [Point("quests.archon.open", 0.0)]
    assert metrics.characters(CharactersRecord(owned=96, level90=41)) == [Point("chars.level90", 41.0)]
    record = EndgameRecord(
        (
            EndgameMode("abyss", "Spiral Abyss", True, "36 of 36 stars", 36.0, None, None, ""),
            EndgameMode("theater", "Imaginarium Theater", False, "No attempt this season", None, None, None, ""),
            EndgameMode("stygian", "Stygian Onslaught", True, "Difficulty 5 cleared", 5.0, None, None, "Season"),
        )
    )
    assert metrics.endgame(record) == [Point("endgame.abyss.stars", 36.0), Point("endgame.stygian.difficulty", 5.0)]


def _diary(*months: tuple[int, int, int]) -> DiaryRecord:
    return DiaryRecord(tuple(DiaryMonth(year, month, amount, ()) for year, month, amount in months))


def test_diary_first_sync_starts_the_total_at_zero():
    points = {p.key: p.value for p in metrics.diary(_diary((2026, 9, 7340), (2026, 10, 3180)), {})}
    assert points == {month_key(2026, 9): 7340.0, month_key(2026, 10): 3180.0, EARNED_KEY: 0.0}


def test_diary_adds_only_the_increase():
    previous = {month_key(2026, 9): 7340.0, month_key(2026, 10): 3180.0, EARNED_KEY: 0.0}
    points = {p.key: p.value for p in metrics.diary(_diary((2026, 9, 7340), (2026, 10, 3400)), previous)}
    assert points[EARNED_KEY] == 220.0


def test_diary_counts_a_month_that_began_while_tracking():
    previous = {month_key(2026, 10): 6000.0, EARNED_KEY: 500.0}
    points = {p.key: p.value for p in metrics.diary(_diary((2026, 10, 6100), (2026, 11, 60)), previous)}
    assert points[EARNED_KEY] == 500.0 + 100.0 + 60.0


NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def test_expedition_pictures_become_icon_labels_by_character():
    labels = metrics.notes_labels(normalize_notes(samples.DAILY_NOTE_FULL, NOW))
    assert [(label.key, label.label, label.kind, label.icon_url) for label in labels] == [
        ("character.side.ambor", "Ambor", "character", samples.AMBER_ICON),
        ("character.side.noel", "Noel", "character", samples.NOELLE_ICON),
    ]
    other = "https://act-webstatic.hoyoverse.com/side.png"
    assert metrics.character_icon_key(other) == "character.side." + hashlib.sha256(other.encode()).hexdigest()[:16]
    assert metrics.character_icon_key("") is None
    # The same picture on two expeditions is one label; an address without a character's name is "Character".
    twice = {**samples.DAILY_NOTE_FULL, "expeditions": [
        {"avatar_side_icon": other, "status": "Finished", "remained_time": "0"},
        {"avatar_side_icon": other, "status": "Ongoing", "remained_time": "60"},
    ]}
    assert [label.label for label in metrics.notes_labels(normalize_notes(twice, NOW))] == ["Character"]


def test_diary_never_goes_down():
    previous = {month_key(2026, 10): 3180.0, EARNED_KEY: 40.0}
    points = {p.key: p.value for p in metrics.diary(_diary((2026, 10, 3000)), previous)}
    assert points[EARNED_KEY] == 40.0


def test_the_diary_keeps_each_months_primogems_by_source():
    record = DiaryRecord(
        (DiaryMonth(2026, 9, 6000, (DiarySource("Events", 2400), DiarySource("Daily Activity", 1800))),)
    )
    points = {p.key: p.value for p in metrics.diary(record, {})}
    assert SOURCE_PREFIX == "diary.primogems.source."
    assert points == {
        month_key(2026, 9): 6000.0,  # the month's total stays, beside its sources
        "diary.primogems.source.2026-09.events": 2400.0,
        "diary.primogems.source.2026-09.daily_activity": 1800.0,
        EARNED_KEY: 0.0,
    }
    # The sources break a month down; the running total of what was earned reads the month's total alone.
    kept = {**points, month_key(2026, 9): 6000.0}
    later = DiaryRecord((DiaryMonth(2026, 9, 6100, (DiarySource("Events", 2500), DiarySource("Daily Activity", 1800))),))
    again = {p.key: p.value for p in metrics.diary(later, kept)}
    assert again[EARNED_KEY] == 100.0
    assert again["diary.primogems.source.2026-09.events"] == 2500.0


def test_diary_sources_gives_each_months_latest_value_by_source(store):
    assert diary_sources(store) == {}
    day = date(2026, 10, 13)
    first = DiaryRecord(
        (
            DiaryMonth(2026, 9, 6000, (DiarySource("Events", 2400), DiarySource("Daily Activity", 1800))),
            DiaryMonth(2026, 10, 900, (DiarySource("Events", 900),)),
        )
    )
    store.add_points(None, NOW, day, metrics.diary(first, {}))
    later = DiaryRecord((DiaryMonth(2026, 10, 1500, (DiarySource("Events", 1200), DiarySource("Quests", 300))),))
    store.add_points(None, NOW + timedelta(hours=1), day, metrics.diary(later, store.latest_values(DIARY_PREFIX)))
    assert diary_sources(store) == {
        "2026-09": {"events": 2400.0, "daily_activity": 1800.0},
        "2026-10": {"events": 1200.0, "quests": 300.0},  # the newest value of each source
    }
    assert store.latest_values(metrics.MONTH_PREFIX) == {month_key(2026, 9): 6000.0, month_key(2026, 10): 1500.0}
