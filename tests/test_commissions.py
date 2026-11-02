"""Daily commissions: which achievements come from them, the model by region, and Appeared today (spec 11)."""
import re
from dataclasses import asdict, replace
from datetime import date, datetime, timezone

import pytest

from achievement_samples import list_bytes
from guildboard.achievements.catalog import parse_catalog
from guildboard.achievements.commissions import AlreadyToday, Commissions, NotACommission, commission_stages
from guildboard.achievements.notes import parse_notes
from guildboard.achievements.progress import Progress
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.gameday import game_day
from guildboard.metrics import Label
from guildboard.sources.demo import build
from guildboard.store import ProgressRow
from guildboard.views.achievements import Query
from guildboard.views.commissions import build_commissions
from support import FakeSleep

UTC = timezone.utc
SERVER = "os_euro"  # its 04:00 is 03:00 UTC

# Commission achievements as the bundled list holds them, in Paimon.moe's shape, with Swordseeker and The Conformist,
# which it does not mark. Made up: this list marks The Conformist as a Liyue one, which the notes found it is not. Geo
# Archon Anecdotes comes last in the list's order, though its number is the lowest: its category comes later.
LIST = {"12": {"name": "Stone Harbor's Nostalgia: Series I", "order": 30, "achievements": [
    {"id": 84505, "name": "Geo Archon Anecdotes",
     "desc": "Collect all the stories about Rex Lapis in the \"Geo Travel Diary.\"", "reward": 5, "ver": "1.0",
     "commissions": "liyue", "quest": {"id": ["Geo Travel Diary"], "name": ["Geo Travel Diary"]},
     "checklist": ["The Groundbreaker (Plants and Ingredients)", "God of the Stove (Ores)", "God of History (Dishes)",
                   "God of Wealth (Glaze Lily)"]},
]}, "0": {"name": "Wonders of the World", "order": 1, "achievements": [
    {"id": 81732, "name": "Winter Night's Letter", "desc": "Complete \"Secret Tsarist Assignment: Part I.\"",
     "reward": 5, "ver": "7.1"},
    {"id": 84508, "name": "Pirates! Argh!",
     "desc": "Play a game of pirates with Little Lulu, Little Fei, and Little Meng.", "reward": 5, "ver": "1.0",
     "commissions": "liyue",
     "quest": {"id": ["Pirate Invasion, in Liyue Harbor!"], "name": ["Pirate Invasion, in Liyue Harbor!"]},
     "checklist": ["Little Meng", "Little Lulu", "Little Fei"]},
    {"id": 84509, "name": "A Nourishing Friendship", "desc": "Complete \"Fishing Jiangxue\" and \"Yanxiao's Dilemma.\"",
     "reward": 5, "ver": "1.0", "commissions": "liyue",
     "quest": {"id": ["Fishing Jiangxue", "Yanxiao's Dilemma"], "name": ["Fishing Jiangxue", "Yanxiao's Dilemma"]}},
    {"id": 84510, "name": "Love Is All Around",
     "desc": "In \"Good Sign,\" help Zhihua find 5 signs that romance is coming his way.", "reward": 5, "ver": "1.0",
     "commissions": "liyue", "quest": {"id": ["Good Sign"], "name": ["Good Sign"]},
     "checklist": ["Seeing that Granny Shan has good business", "Leaving the pigeons alone", "Leaving the dogs alone",
                   "Leaving the cat and fish alone", "Leaving the leaves alone"]},
    {"id": 84512, "name": "For the Love of Godwin", "desc": "Finish \"Whispers in the Wind\" 5 times.", "reward": 5,
     "ver": "1.0", "commissions": "mondstadt",
     "quest": {"id": ["Whispers in the Wind"], "name": ["Whispers in the Wind"]}},
    {"id": 84520, "name": "In the Name of Favonius", "desc": "Witness Jilliana's tale.", "reward": 5, "ver": "1.0",
     "commissions": "mondstadt", "quest": {"id": ["A Surprise Gift"], "name": ["A Surprise Gift"]},
     "checklist": ["Marjorie", "Quinn", "Sara", "Vile"]},
    {"id": 84526, "name": "Open to Interpretation", "desc": "Ruin 4 signs of an imminent romance.", "reward": 5,
     "ver": "1.0", "commissions": "liyue", "quest": {"id": ["Good Sign"], "name": ["Good Sign"]},
     "checklist": ["Killing the pigeons", "Scaring the dogs away", "Harvesting or killing the fish or the cat",
                   "Burning or blowing away the leaves"]},
    {"id": 84564, "name": "Swordseeker", "desc": "Witness the tale of Lan and the \"Unseen Razor.\"", "reward": 5,
     "ver": "3.3"},
    {"id": 84573, "name": "The Conformist", "desc": "Witness a certain story regarding light, shadow and hydrology...",
     "reward": 5, "ver": "4.4", "commissions": "liyue"},
]}}
CATALOG = parse_catalog(list_bytes(LIST))
NOTES = parse_notes({
    "checked_against": "7.1", "counters": {}, "not_in_order": [], "wiki": {},
    "commissions": {
        "84520": {"order": True, "how": "Choose Vile's option when A Surprise Gift offers it.",
                  "first": "Vile's option is offered from the fourth time A Surprise Gift appears.",
                  "sources": ["https://genshin-impact.fandom.com/wiki/In_the_Name_of_Favonius"]},
        "84564": {"region": "liyue", "quests": ["Where Is the Unseen Razor?"],
                  "parts": ["Ruin Hunter version", "Follow-up version"], "order": True,
                  "how": "In the follow-up version, give the Hilt-Like Object to Lan.",
                  "sources": ["https://genshin-impact.fandom.com/wiki/Swordseeker"]},
    },
    "not_commissions": [84573],
})


@pytest.fixture
def progress(store, clock):
    return Progress(store, lambda: CATALOG, NOTES, clock)


@pytest.fixture
def commissions(store, clock, progress):
    return Commissions(store, lambda: CATALOG, NOTES, progress, clock, lambda: SERVER)


def _model(store, clock, region: str) -> dict:
    now = clock.now()
    return build_commissions(CATALOG, NOTES, store, region, game_day(now, SERVER), SERVER, now)


def _card(store, clock, region: str, stage_id: int) -> dict:
    model = _model(store, clock, region)
    return next(card for card in model["cards"] + model["done"] if card["id"] == stage_id)


def _tick(store, clock, *stage_ids: int) -> None:
    now = clock.now()
    store.put_progress([ProgressRow(stage_id, "done", now, False, "", "player", now) for stage_id in stage_ids])


def _notes_read(at: datetime, done: int) -> dict:
    """HoYoLAB's Real-Time Notes as the sync keeps them, read at `at`, with `done` of the 4 commissions finished."""
    return asdict(replace(build("notes", at), commissions_done=done))


def test_the_model_lists_what_is_left_in_a_region_and_folds_the_done_ones(store, clock):
    now = clock.now()  # 2026-10-13 08:00 UTC, 09:00 on the Europe server
    _tick(store, clock, 84509, 84512)
    store.put_progress([ProgressRow(84508, "in_progress", None, True, "", "player", now)])
    store.put_part(84508, 1, now)
    store.put_appearance(84508, date(2026, 10, 10), datetime(2026, 10, 10, 9, 0, tzinfo=UTC))
    model = _model(store, clock, "liyue")
    assert (model["region"], model["today"]) == ("liyue", "2026-10-13")
    assert model["regions"] == [
        {"key": "mondstadt", "name": "Mondstadt", "left": 1}, {"key": "liyue", "name": "Liyue", "left": 5},
        {"key": "inazuma", "name": "Inazuma", "left": 0}, {"key": "sumeru", "name": "Sumeru", "left": 0},
        {"key": "fontaine", "name": "Fontaine", "left": 0}, {"key": "natlan", "name": "Natlan", "left": 0},
    ]
    # In the list's order. Swordseeker is a Liyue one by the notes; The Conformist, which this list marks, is not.
    assert [card["id"] for card in model["cards"]] == [84508, 84510, 84526, 84564, 84505]
    assert [card["id"] for card in model["done"]] == [84509]
    assert model["cards"][0] == {
        "id": 84508, "name": "Pirates! Argh!",
        "description": "Play a game of pirates with Little Lulu, Little Fei, and Little Meng.", "reward": 5,
        "quests": ["Pirate Invasion, in Liyue Harbor!"],
        "parts": [
            {"index": 0, "name": "Little Meng", "done_at": None},
            {"index": 1, "name": "Little Lulu", "done_at": "2026-10-13T08:00:00+00:00"},
            {"index": 2, "name": "Little Fei", "done_at": None},
        ],
        "order": False, "next_part": None, "how": None, "first": None,
        "status": "in_progress", "pinned": True, "appeared_today": False, "last_appeared": "2026-10-10",
    }
    assert model["done"][0]["status"] == "done"
    with pytest.raises(ValueError):
        _model(store, clock, "snezhnaya")


def test_commissions_to_look_for_name_each_commission_once_from_what_is_left(store, clock):
    def looking_for() -> list[str]:
        return _model(store, clock, "liyue")["looking_for"]

    # Love Is All Around and Open to Interpretation both come from Good Sign. Swordseeker's commission is the notes'.
    assert looking_for() == [
        "Fishing Jiangxue", "Geo Travel Diary", "Good Sign", "Pirate Invasion, in Liyue Harbor!",
        "Where Is the Unseen Razor?", "Yanxiao's Dilemma",
    ]
    _tick(store, clock, 84510)
    assert "Good Sign" in looking_for()  # Open to Interpretation still needs it
    _tick(store, clock, 84526, 84509)
    assert looking_for() == ["Geo Travel Diary", "Pirate Invasion, in Liyue Harbor!", "Where Is the Unseen Razor?"]


def test_the_commissions_model_names_the_regions_emblem(store, clock):
    emblem = "https://act-webstatic.hoyoverse.com/x.png"
    # Before exploration is read there are no regions at all, and so no emblem.
    assert _model(store, clock, "liyue")["region_icon"] is None
    store.upsert_labels(
        [
            Label("explore.1", "Mondstadt", "region", None, "https://act-webstatic.hoyoverse.com/m.png", 0),
            Label("explore.2", "Liyue", "region", None, emblem, 1),
            # A sub-region has a parent, and Liyue's emblem is the region's own, not the sub-region's.
            Label("explore.3", "Liyue", "region", "explore.2", "https://act-webstatic.hoyoverse.com/sub.png", 2),
            # A label of another kind with the region's name is no region.
            Label("explore.2.area.liyue", "Liyue", "area", "explore.2", "https://act-webstatic.hoyoverse.com/a.png", 0),
        ],
        clock.now(),
    )
    assert _model(store, clock, "liyue")["region_icon"] == "/api/icon/explore.2"
    assert _model(store, clock, "mondstadt")["region_icon"] == "/api/icon/explore.1"
    assert _model(store, clock, "inazuma")["region_icon"] is None  # no region of that name is read yet


def test_a_region_without_a_picture_has_no_emblem(store, clock):
    # HoYoLAB gave the region no picture (the demo's regions have none), so there is no address to load.
    store.upsert_labels([Label("explore.2", "Liyue", "region", None, "", 0)], clock.now())
    assert _model(store, clock, "liyue")["region_icon"] is None


def test_appeared_today_is_once_per_game_day_and_undoes(store, clock, commissions, progress):
    clock.set(datetime(2026, 10, 21, 2, 59, tzinfo=UTC))  # 03:59 on the Europe server: still the game day of the 20th
    assert commissions.appeared(84510) == "Marked Love Is All Around as appeared today"
    assert store.appearances() == {84510: {date(2026, 10, 20): datetime(2026, 10, 21, 2, 59, tzinfo=UTC)}}
    with pytest.raises(AlreadyToday, match=re.escape("It is marked as appeared today already.")):
        commissions.appeared(84510)
    card = _card(store, clock, "liyue", 84510)
    assert (card["appeared_today"], card["last_appeared"]) == (True, "2026-10-20")
    clock.set(datetime(2026, 10, 21, 3, 0, tzinfo=UTC))  # 04:00 server time: a new game day
    card = _card(store, clock, "liyue", 84510)
    assert (card["appeared_today"], card["last_appeared"]) == (False, "2026-10-20")
    commissions.appeared(84510)
    assert sorted(store.appearances()[84510]) == [date(2026, 10, 20), date(2026, 10, 21)]
    card = _card(store, clock, "liyue", 84510)
    assert (card["appeared_today"], card["last_appeared"]) == (True, "2026-10-21")  # the latest of its days
    assert progress.undo() == "Marked Love Is All Around as appeared today"
    assert sorted(store.appearances()[84510]) == [date(2026, 10, 20)]
    assert _card(store, clock, "liyue", 84510)["last_appeared"] == "2026-10-20"
    assert progress.undo() == "Marked Love Is All Around as appeared today"
    assert store.appearances() == {}
    assert progress.undo() is None  # the refused press recorded nothing


def test_a_chain_names_its_next_part(store, clock):
    def favonius() -> dict:
        return _card(store, clock, "mondstadt", 84520)

    assert (favonius()["order"], favonius()["next_part"]) == (True, 0)
    assert (favonius()["how"], favonius()["first"]) == (
        "Choose Vile's option when A Surprise Gift offers it.",
        "Vile's option is offered from the fourth time A Surprise Gift appears.",
    )
    store.put_part(84520, 0, clock.now())
    assert favonius()["next_part"] == 1
    store.put_part(84520, 2, clock.now())  # a later part ticked first: the chain still waits for Quinn
    assert favonius()["next_part"] == 1
    store.put_part(84520, 1, clock.now())
    store.put_part(84520, 3, clock.now())
    assert favonius()["next_part"] is None  # every part is done
    # The parts the notes add come after the list's, here none, and a chain of them names its next part too.
    assert _card(store, clock, "liyue", 84564) == {
        "id": 84564, "name": "Swordseeker", "description": "Witness the tale of Lan and the \"Unseen Razor.\"",
        "reward": 5, "quests": ["Where Is the Unseen Razor?"],
        "parts": [
            {"index": 0, "name": "Ruin Hunter version", "done_at": None},
            {"index": 1, "name": "Follow-up version", "done_at": None},
        ],
        "order": True, "next_part": 0, "how": "In the follow-up version, give the Hilt-Like Object to Lan.",
        "first": None, "status": "not_started", "pinned": False, "appeared_today": False, "last_appeared": None,
    }
    assert _card(store, clock, "liyue", 84510)["next_part"] is None  # parts done in any order have no next one


def test_hoyolabs_count_is_shown_only_from_today(store, clock):
    assert _model(store, clock, "liyue")["hoyolab"] is None  # nothing read yet
    before_reset = datetime(2026, 10, 13, 2, 59, tzinfo=UTC)  # 03:59 server time: the game day before
    store.set_latest_doc("notes", before_reset, _notes_read(before_reset, 4))
    assert _model(store, clock, "liyue")["hoyolab"] is None
    after_reset = datetime(2026, 10, 13, 3, 0, tzinfo=UTC)
    store.set_latest_doc("notes", after_reset, _notes_read(after_reset, 2))
    assert _model(store, clock, "liyue")["hoyolab"] == {"done": 2, "of": 4, "at": "2026-10-13T03:00:00+00:00"}
    clock.set(datetime(2026, 10, 14, 3, 0, tzinfo=UTC))  # the next game day: that count is the day before's
    assert _model(store, clock, "liyue")["hoyolab"] is None


def test_appeared_today_takes_an_achievement_that_only_the_notes_name(store, commissions):
    # The bundled list marks no Natlan achievement, so that whole region rests on the notes, as Swordseeker does here.
    assert commissions.appeared(84564) == "Marked Swordseeker as appeared today"
    assert list(store.appearances()) == [84564]


def test_an_achievement_that_is_not_a_commission_one_is_refused(store, commissions):
    assert commission_stages(CATALOG, NOTES) == {
        84505: "liyue", 84508: "liyue", 84509: "liyue", 84510: "liyue", 84512: "mondstadt", 84520: "mondstadt",
        84526: "liyue", 84564: "liyue",
    }
    # Winter Night's Letter comes from no commission; the notes found that The Conformist does not either, though this
    # list marks it; and 999 is no achievement.
    for stage_id in (81732, 84573, 999):
        with pytest.raises(NotACommission, match=re.escape("This achievement is not a daily commission one.")):
            commissions.appeared(stage_id)
    assert store.appearances() == {} and store.newest_change_label() is None


def test_the_achievements_model_counts_the_commissions_left_in_the_setting_region(tmp_path, clock):
    paths = AppPaths(tmp_path / "data")
    core = Core(paths, demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        def left() -> int:
            return core.achievements(Query())["special"]["commissions_left"]

        # The demo has three left in Liyue, where Settings starts: Pirates! Argh!, in progress, All's Well That Ends
        # Well and Swordseeker.
        assert left() == 3
        core.update_settings({"commission_region": "mondstadt"})
        assert left() == 4  # Telling It How It Is, For the Love of Godwin, Making Do and In the Name of Favonius
        core.progress.set_status(84512, "done")
        assert left() == 3
    finally:
        core.store.close()
