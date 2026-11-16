"""The Endgame resets widget's model (the widgets design, 2.4): each mode's result and the time to its reset, from the endgame
summaries a sync keeps. No read of its own."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from guildboard.characters.art import ArtCache
from guildboard.config import AppPaths
from guildboard.records import EndgameDetailRecord, EndgameMode, EndgameRecord
from guildboard.store import WikiEntryRow, iso
from guildboard.views.endgame_card import MODE_ART, THEATER_MARKS, header_art, theater_marks
from guildboard.views.endgame_resets import build_endgame_resets
from support import FakeClock

UTC = timezone.utc
NOW = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)
SERVER = "os_euro"


def _end(days: float) -> str:
    return iso(NOW + timedelta(days=days))


def _detail(**more) -> EndgameDetailRecord:
    base = dict(
        abyss_stars=36, abyss_halves=(), abyss_ends=None, theater_difficulty="Hard", theater_acts=8, theater_ends=None,
        stygian_difficulty=5, stygian_bosses=(), stygian_ends=None,
    )
    return EndgameDetailRecord(**{**base, **more})


def _modes(abyss_days=5, theater_days=18, stygian_days=9, **played) -> tuple[EndgameMode, ...]:
    def mode(key, label, days, text, score):
        has = played.get(key, True)
        return EndgameMode(
            key, label, has, text if has else "No attempt", score if has else None, _end(days - 20), _end(days), ""
        )

    return (
        mode("abyss", "Spiral Abyss", abyss_days, "36 of 36 stars", 36.0),
        mode("theater", "Imaginarium Theater", theater_days, "Act 8 reached", 8.0),
        mode("stygian", "Stygian Onslaught", stygian_days, "Difficulty 5 cleared", 5.0),
    )


def _keep(store, modes, detail=None) -> None:
    store.set_latest_doc("endgame", NOW - timedelta(minutes=20), asdict(EndgameRecord(modes, detail)))


def test_all_three_modes_played_give_their_results_and_their_resets(store):
    _keep(store, _modes(), _detail(theater_medals=(True,) * 7 + (False,) * 3))
    view = build_endgame_resets(store, NOW, SERVER)
    assert view["read_at"] == iso(NOW - timedelta(minutes=20)) and view["not_played"] == 0
    abyss, theater, stygian = view["modes"]
    assert [(m["mode"], m["label"], m["short"]) for m in view["modes"]] == [
        ("abyss", "Spiral Abyss", "Abyss"), ("theater", "Imaginarium Theater", "Theater"),
        ("stygian", "Stygian Onslaught", "Stygian"),
    ]
    assert (abyss["played"], abyss["stars"], abyss["ends_at"], abyss["stale"]) == (True, 36, _end(5), False)
    assert (theater["acts"], theater["acts_of"], theater["ends_at"]) == (8, 10, _end(18))
    assert (stygian["difficulty"], stygian["ends_at"], stygian["next_starts_at"]) == (5, _end(9), None)
    assert (abyss["acts"], abyss["difficulty"], theater["stars"], stygian["stars"]) == (None, None, None, None)
    assert [m["starts_at"] for m in view["modes"]] == [_end(-15), _end(-2), _end(-11)]  # the period's start, for Next up's progress


def test_a_mode_not_played_says_so_and_is_counted_with_no_zeros(store):
    _keep(store, _modes(stygian=False), _detail(stygian_next=("A Season", _end(2))))
    view = build_endgame_resets(store, NOW, SERVER)
    stygian = view["modes"][2]
    assert (stygian["played"], stygian["difficulty"], stygian["stale"], stygian["ends_at"]) == (False, None, False, _end(9))
    assert stygian["next_starts_at"] == _end(2)  # the next season, when the answer names one
    assert view["not_played"] == 1


def test_a_cycle_that_has_ended_since_the_last_read_is_stale_and_not_counted_as_not_played(store):
    _keep(store, _modes(abyss_days=-0.01))  # it ended 14 minutes ago, after the read 20 minutes ago
    view = build_endgame_resets(store, NOW, SERVER)
    abyss = view["modes"][0]
    assert (abyss["stale"], abyss["played"], abyss["stars"], abyss["ends_at"]) == (True, False, None, None)
    assert view["not_played"] == 0  # "Not read since the reset" is not "not played"
    assert [m["played"] for m in view["modes"]] == [False, True, True]


def test_a_season_that_ended_before_the_read_is_not_played_in_the_current_cycle(store):
    # The read came after the reset, and the Theater's and the Stygian's summaries are of the newest season played.
    _keep(store, _modes(theater_days=-3, stygian_days=-3))
    view = build_endgame_resets(store, NOW, SERVER)
    _, theater, stygian = view["modes"]
    assert (theater["stale"], theater["played"], theater["acts"]) == (False, False, None)
    assert (stygian["stale"], stygian["played"], stygian["difficulty"]) == (False, False, None)
    assert view["not_played"] == 2
    assert theater["ends_at"] == iso(datetime(2026, 12, 1, 3, 0, tzinfo=UTC) - timedelta(seconds=1))  # 1 Dec, 04:00 Europe
    assert stygian["ends_at"] is None  # the Stygian's seasons have no schedule the app knows
    # the read's period is over: the Theater's current cycle is known from its schedule (1 Nov, 04:00 Europe); the Stygian's is not
    assert (theater["starts_at"], stygian["starts_at"]) == (iso(datetime(2026, 11, 1, 3, 0, tzinfo=UTC)), None)


def test_an_abyss_that_ended_before_the_read_ends_at_the_next_sixteenth(store):
    _keep(store, _modes(abyss_days=-1))
    abyss = build_endgame_resets(store, NOW, SERVER)["modes"][0]
    assert (abyss["stale"], abyss["played"], abyss["ends_at"]) == (False, False, iso(datetime(2026, 11, 16, 3, 0, tzinfo=UTC) - timedelta(seconds=1)))
    late = datetime(2026, 12, 20, 12, 0, tzinfo=UTC)  # past the 16th: the next is January's
    assert build_endgame_resets(store, late, SERVER)["modes"][0]["ends_at"] == iso(datetime(2027, 1, 16, 3, 0, tzinfo=UTC) - timedelta(seconds=1))


def test_next_up_and_the_calendar_follow_the_current_cycles_end(store):
    from guildboard.records import CalendarBoardRecord, CalendarRecord
    from guildboard.views.calendar import build_calendar
    from guildboard.views.nextup import build_next_up

    _keep(store, _modes(theater_days=-3))
    store.set_latest_doc("calendar", NOW - timedelta(minutes=10), asdict(CalendarRecord(2, 2, None, CalendarBoardRecord((), ()))))
    resets = build_endgame_resets(store, NOW, SERVER)
    items = build_next_up({"resets": {}, "notes": None}, {}, [], resets, None, NOW)["items"]
    assert [i["name"] for i in items if i["kind"] == "endgame"] == ["Spiral Abyss resets", "Stygian Onslaught ends", "Imaginarium Theater resets"]
    assert build_calendar(store, NOW, SERVER)["endgame"][1]["ends_at"] == resets["modes"][1]["ends_at"] is not None


def test_the_acts_of_a_season_are_only_given_where_the_detail_carries_them(store):
    _keep(store, _modes(), _detail())  # no medals kept
    assert build_endgame_resets(store, NOW, SERVER)["modes"][1]["acts_of"] is None
    _keep(store, _modes(), _detail(theater_difficulty="Arcana Challenge", theater_medals=(True,) * 4, theater_arcana=1))
    assert build_endgame_resets(store, NOW, SERVER)["modes"][1]["acts_of"] is None  # its list holds Arcana fights too


def test_a_doc_with_no_detail_still_gives_the_summaries(store):
    _keep(store, _modes(), None)
    theater = build_endgame_resets(store, NOW, SERVER)["modes"][1]
    assert (theater["acts"], theater["acts_of"]) == (8, None)


def test_no_endgame_read_gives_no_modes(store):
    assert build_endgame_resets(store, NOW, SERVER) == {"read_at": None, "modes": [], "not_played": 0}


# ------------------------------------------------------------------------------------------------ the pictures and the cycle's start


def test_each_mode_gives_the_start_of_its_cycle(store):
    _keep(store, _modes())
    abyss, theater, stygian = build_endgame_resets(store, NOW, SERVER)["modes"]
    assert (abyss["starts_at"], theater["starts_at"], stygian["starts_at"]) == (_end(5 - 20), _end(18 - 20), _end(9 - 20))


def test_a_cycle_that_ended_before_the_read_starts_at_the_reset_before_now(store):
    _keep(store, _modes(abyss_days=-1, stygian_days=-3, theater_days=-3))
    abyss, theater, stygian = build_endgame_resets(store, NOW, SERVER)["modes"]
    assert abyss["starts_at"] == iso(datetime(2026, 10, 16, 3, 0, tzinfo=UTC))
    assert theater["starts_at"] == iso(datetime(2026, 11, 1, 3, 0, tzinfo=UTC))
    assert stygian["starts_at"] is None  # no schedule the app knows


def test_a_stale_mode_has_no_start(store):
    _keep(store, _modes(abyss_days=-0.01))
    assert build_endgame_resets(store, NOW, SERVER)["modes"][0]["starts_at"] is None


def test_the_theaters_medals_are_given_only_where_the_detail_carries_them(store):
    _keep(store, _modes(), _detail(theater_medal_count=6))
    modes = build_endgame_resets(store, NOW, SERVER)["modes"]
    assert [m["medals"] for m in modes] == [None, 6, None]
    _keep(store, _modes(), None)  # a read with no detail kept
    assert build_endgame_resets(store, NOW, SERVER)["modes"][1]["medals"] is None
    _keep(store, _modes(theater=False), _detail(theater_medal_count=6))
    assert build_endgame_resets(store, NOW, SERVER)["modes"][1]["medals"] is None  # not played this cycle


def test_with_no_art_cache_no_picture_is_given(store):
    _keep(store, _modes())
    for mode in build_endgame_resets(store, NOW, SERVER)["modes"]:
        assert mode["header"] == {"icon": None, "picture": None, "crop": None} and mode["medal"] is None


async def test_the_pictures_are_the_stats_cards_through_the_art_cache(store, tmp_path):
    clock = FakeClock(NOW)
    art = ArtCache(store, AppPaths(tmp_path / "data"), clock, lambda url, **_: b"\x89PNG\r\n\x1a\n" + b"p" * 40, False)
    art.warm_pause = 0
    _keep(store, _modes())
    # Not on disk yet: no picture, the widget draws the mode's colour; the medal likewise.
    for mode in build_endgame_resets(store, NOW, SERVER, art)["modes"]:
        assert mode["header"] == {"icon": None, "picture": None, "crop": None} and mode["medal"] is None
    wanted = [spec.picture_index for spec in MODE_ART.values()] + [THEATER_MARKS["medal"]]
    assert await art.warm_public(wanted) == 4
    abyss, theater, stygian = build_endgame_resets(store, NOW, SERVER, art)["modes"]
    for mode, shown in (("abyss", abyss), ("theater", theater), ("stygian", stygian)):
        card = header_art(mode, art, None)
        assert shown["header"] == {"icon": card["icon"], "picture": card["picture"], "crop": card["crop"]}
        assert shown["header"]["picture"] == art.public_address(MODE_ART[mode].picture_index)
    assert stygian["header"]["crop"] == [0.0, 0.0, 0.48, 0.84]
    assert theater["medal"] == theater_marks(art, None)["medal"] == art.public_address(THEATER_MARKS["medal"])
    assert abyss["medal"] is None and stygian["medal"] is None


def test_the_header_gives_each_modes_icon_as_the_stats_card_has_it(store, tmp_path):
    uploads = "https://act-upload.hoyoverse.com/event-ugc-hoyowiki/2024/07/04/1"
    art = ArtCache(store, AppPaths(tmp_path / "data"), FakeClock(NOW), None, False)
    art.warm_pause = 0
    _keep(store, _modes())
    rows = {
        mode: WikiEntryRow(spec.wiki_entry, "tutorial", mode, {"name": mode, "icon": f"{uploads}/{mode}.png", "pictures": []}, "7.1", NOW)
        for mode, spec in MODE_ART.items()
    }
    for mode in build_endgame_resets(store, NOW, SERVER, art, rows)["modes"]:
        assert mode["header"]["icon"] == header_art(mode["mode"], art, rows[mode["mode"]])["icon"] == art.address(f"{uploads}/{mode['mode']}.png")
        assert mode["header"]["icon"].startswith("/api/art/")
    # No Tutorial entry kept yet: no icon, and the widget draws the mode's sign.
    for mode in build_endgame_resets(store, NOW, SERVER, art)["modes"]:
        assert mode["header"]["icon"] is None


def test_the_demo_without_pictures_gives_none(store, tmp_path):
    demo = ArtCache(store, AppPaths(tmp_path / "data"), FakeClock(NOW), None, True)
    demo.demo_dir = tmp_path / "nothing-here"
    _keep(store, _modes())
    for mode in build_endgame_resets(store, NOW, SERVER, demo)["modes"]:
        assert mode["header"] == {"icon": None, "picture": None, "crop": None} and mode["medal"] is None


def test_the_stygians_medal_is_the_stats_cards_official_one_of_its_difficulty(store, tmp_path):
    uploads = "https://act-upload.hoyoverse.com/event-ugc-hoyowiki/2025/07/23"
    art = ArtCache(store, AppPaths(tmp_path / "data"), FakeClock(NOW), None, False)
    art.warm_pause = 0
    medals = [f"{uploads}/UI_LeyLineChallenge_Medal_{level}.png" for level in range(1, 6)]
    rows = {"stygian": WikiEntryRow("7786", "tutorial", "Stygian Onslaught", {"name": "x", "icon": f"{uploads}/icon.png", "pictures": medals}, "7.1", NOW)}
    _keep(store, _modes(), _detail(stygian_medal="UI_LeyLineChallenge_Medal_5"))
    abyss, theater, stygian = build_endgame_resets(store, NOW, SERVER, art, rows)["modes"]
    assert stygian["medal"] == art.address(medals[4]) and stygian["medal"].startswith("/api/art/")
    assert abyss["medal"] is None and theater["medal"] is None  # the Theater's own is its public mark, kept or not
    # A Stygian not played this cycle shows no result, so no medal; nor does an entry with none of that name, or no entry.
    _keep(store, _modes(stygian=False), _detail(stygian_medal="UI_LeyLineChallenge_Medal_5"))
    assert build_endgame_resets(store, NOW, SERVER, art, rows)["modes"][2]["medal"] is None
    _keep(store, _modes(), _detail(stygian_medal="UI_LeyLineChallenge_Medal_5"))
    assert build_endgame_resets(store, NOW, SERVER, art, {})["modes"][2]["medal"] is None
    assert build_endgame_resets(store, NOW, SERVER, None, rows)["modes"][2]["medal"] is None
