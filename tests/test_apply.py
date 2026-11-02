from datetime import date, datetime, timedelta, timezone

from guildboard.metrics import EARNED_KEY, month_key
from guildboard.records import (
    Area,
    DiaryMonth,
    DiaryRecord,
    FetchResult,
    OverviewRecord,
    RawResponse,
    Region,
)
from guildboard.sources.hoyolab_normalize import normalize_notes
from guildboard.sync.apply import apply_result
import hoyolab_samples as samples

UTC = timezone.utc
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=UTC)

OVERVIEW = OverviewRecord(
    nickname="Traveler",
    server="os_euro",
    adventure_rank=60,
    counters={"achievements": 1318.0, "oculi.cryo": 3.0},
    regions=(Region(8, 0, "Sumeru", 93.0, "", (), (Area("Rainforest", 100.0),)),),
    abyss_progress="12-3",
)


def test_overview_result_writes_points_labels_and_document(store):
    run = store.start_run("manual", NOW)
    apply_result(store, run, FetchResult("overview", NOW, (RawResponse("index", {"a": 1}),), OVERVIEW), "os_euro")
    assert store.latest_point_value("stats.achievements") == 1318.0
    assert store.latest_point_value("explore.8.area.rainforest.pct") == 100.0
    assert store.labels("region")["explore.8"].label == "Sumeru"
    taken_at, doc = store.latest_doc("overview")
    assert taken_at == NOW
    assert doc["nickname"] == "Traveler"
    assert doc["regions"][0]["areas"][0]["name"] == "Rainforest"
    assert store.raw_bodies("overview") == [{"a": 1}]


def test_notes_keep_their_expedition_pictures_as_icon_labels(store):
    run = store.start_run("manual", NOW)
    record = normalize_notes(samples.DAILY_NOTE_FULL, NOW)
    apply_result(store, run, FetchResult("notes", NOW, (RawResponse("dailyNote", {"a": 1}),), record), "os_euro")
    characters = store.labels("character")
    assert sorted(characters) == ["character.side.ambor", "character.side.noel"]
    assert characters["character.side.noel"].icon_url == samples.NOELLE_ICON
    assert store.latest_doc("notes")[1]["expeditions"][1] == {"icon_url": samples.NOELLE_ICON, "back_at": "2026-10-13T10:00:00+00:00"}


def test_raw_is_archived_even_without_a_record(store):
    run = store.start_run("manual", NOW)
    result = FetchResult("overview", NOW, (RawResponse("index", {"odd": "shape"}),), None, "unexpected shape")
    apply_result(store, run, result, "os_euro")
    assert store.raw_bodies("overview") == [{"odd": "shape"}]
    assert store.latest_doc("overview") is None
    assert store.first_game_day() is None


def test_points_are_filed_under_the_game_day(store):
    run = store.start_run("manual", NOW)
    before_reset = datetime(2026, 10, 13, 2, 30, tzinfo=UTC)  # 03:30 server time: still the 12th
    apply_result(store, run, FetchResult("overview", before_reset, (), OVERVIEW), "os_euro")
    assert store.first_game_day() == date(2026, 10, 12)


def test_diary_running_total_uses_stored_values(store):
    run = store.start_run("manual", NOW)
    first = DiaryRecord((DiaryMonth(2026, 10, 3180, ()),))
    apply_result(store, run, FetchResult("diary", NOW, (), first), "os_euro")
    assert store.latest_point_value(EARNED_KEY) == 0.0
    later = DiaryRecord((DiaryMonth(2026, 10, 3400, ()),))
    apply_result(store, run, FetchResult("diary", NOW + timedelta(days=1), (), later), "os_euro")
    assert store.latest_point_value(EARNED_KEY) == 220.0
    assert store.latest_point_value(month_key(2026, 10)) == 3400.0


def test_the_characters_group_keeps_only_its_newest_ten_raw_bodies(store):
    for number in range(8):
        run = store.start_run("manual", NOW + timedelta(hours=number))
        raw = (RawResponse("character/list", {"n": number}), RawResponse("character/detail", {"n": number}))
        apply_result(store, run, FetchResult("characters", NOW + timedelta(hours=number), raw, None, "odd"), "os_euro")
        apply_result(store, run, FetchResult("notes", NOW, (RawResponse("dailyNote", {"n": number}),), None, "odd"), "os_euro")
    kept = store.raw_bodies("characters", limit=50)
    assert [body["n"] for body in kept] == [7, 7, 6, 6, 5, 5, 4, 4, 3, 3]  # the newest ten, whole runs and halves alike
    assert len(store.raw_bodies("notes", limit=50)) == 8  # only the characters group is trimmed


def test_the_characters_document_holds_the_builds_beside_the_summary(store):
    from dataclasses import replace
    from guildboard.records import CharactersRecord
    from guildboard.sources.hoyolab_normalize import normalize_builds

    record = replace(CharactersRecord(owned=3, level90=2), builds=normalize_builds(samples.CHARACTER_DETAIL))
    run = store.start_run("manual", NOW)
    apply_result(store, run, FetchResult("characters", NOW, (), record), "os_euro")
    _, doc = store.latest_doc("characters")
    assert (doc["owned"], doc["level90"]) == (3, 2) and doc["calculator"] is None
    assert doc["builds"]["builds"][0]["name"] == "Sandrone"
    assert doc["builds"]["prop_names"]["22"] == "CRIT DMG"  # a JSON object's keys are text
    assert store.latest_point_value("chars.level90") == 2.0


def test_the_endgame_and_calendar_documents_hold_their_details_beside_the_summaries(store):
    from guildboard.sources import hoyolab_normalize as norm
    from dataclasses import replace

    run = store.start_run("manual", NOW)
    endgame = replace(
        norm.normalize_endgame(samples.SPIRAL_ABYSS_FLOORS, samples.ROLE_COMBAT, samples.HARD_CHALLENGE_BOSSES),
        detail=norm.normalize_endgame_detail(samples.SPIRAL_ABYSS_FLOORS, samples.ROLE_COMBAT, samples.HARD_CHALLENGE_BOSSES),
    )
    calendar = replace(
        norm.normalize_calendar(samples.ACT_CALENDAR_DETAIL), detail=norm.normalize_calendar_detail(samples.ACT_CALENDAR_DETAIL)
    )
    apply_result(store, run, FetchResult("endgame", NOW, (), endgame), "os_euro")
    apply_result(store, run, FetchResult("calendar", NOW, (), calendar), "os_euro")
    doc = store.latest_doc("endgame")[1]
    assert doc["modes"][0]["mode"] == "abyss" and doc["detail"]["abyss_halves"][0]["chamber"] == "12-2"
    assert doc["detail"]["stygian_bosses"][0]["advantage"] == ["Cryo", "Dendro"]
    document = store.latest_doc("calendar")[1]
    assert document["banners"] == 3 and document["detail"]["banners"][0][0] == ["Sandrone"]


def _raw_rows(store):
    return store._conn.execute("SELECT grp, endpoint, fetched_at FROM raw_responses ORDER BY id").fetchall()


def test_raw_bodies_past_thirty_days_keep_one_per_endpoint_and_game_day(store):
    start = datetime(2026, 8, 1, 6, 0, tzinfo=UTC)
    run = store.start_run("manual", start)
    for hours in range(0, 24 * 60, 6):  # four syncs a day for sixty days, two endpoints
        when = start + timedelta(hours=hours)
        for endpoint in ("index", "dailyNote"):
            store.add_raw(run, "overview", endpoint, when, {"at": hours})
    now = start + timedelta(days=60)
    apply_result(store, run, FetchResult("overview", now, (RawResponse("index", {"fresh": True}),), None, "odd"), "os_euro")
    rows = _raw_rows(store)
    cutoff = (now - timedelta(days=30)).isoformat(timespec="seconds")
    recent = [row for row in rows if row[2] >= cutoff]
    old = [row for row in rows if row[2] < cutoff]
    assert len(recent) == 2 * 120 + 1  # every body of the last thirty days, and the one just stored
    # Past thirty days: the last body of each endpoint on each game day. The game day of os_euro ends at 03:00 UTC, so the
    # last body of each is the one at 00:00 UTC of the next date.
    assert len(old) == 2 * 30
    assert {row[2][11:16] for row in old} == {"00:00"}
    assert {row[1] for row in old} == {"index", "dailyNote"}


def test_the_old_raw_bodies_are_trimmed_once_a_game_day(store):
    start = datetime(2026, 8, 1, 6, 0, tzinfo=UTC)
    run = store.start_run("manual", start)
    for hours in range(0, 24 * 40, 6):
        store.add_raw(run, "overview", "index", start + timedelta(hours=hours), {"at": hours})
    now = start + timedelta(days=40)
    fresh = (RawResponse("index", {"fresh": True}),)

    def old_rows():
        return [row for row in _raw_rows(store) if row[2] < "2026-08-11T06:00"]

    before = len(old_rows())
    apply_result(store, run, FetchResult("overview", now, fresh, None, "odd"), "os_euro")
    trimmed = len(old_rows())
    assert trimmed == 10 < before  # August 1 to 10, one body each
    store.add_raw(run, "overview", "index", start + timedelta(hours=1), {"turned_up_later": True})
    apply_result(store, run, FetchResult("overview", now + timedelta(hours=1), fresh, None, "odd"), "os_euro")
    assert len(old_rows()) == trimmed + 1  # the same game day: not looked at again
    apply_result(store, run, FetchResult("overview", now + timedelta(days=1), fresh, None, "odd"), "os_euro")
    assert len(old_rows()) <= trimmed + 1 and {"turned_up_later": True} not in store.raw_bodies("overview", limit=500)
