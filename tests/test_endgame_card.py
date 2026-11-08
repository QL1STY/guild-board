"""The Endgame card of the Stats page's Overview (the Stats design, 3.1 to 3.4): its model, built from the newest endgame
detail, and the modes' pictures: each header's icon from the HoYoLAB wiki's Tutorial entry, and its picture, a public one
where the art cache keeps it, else the entry's own. The answers are tests/fixtures/endgame's and the trimmed copy of the
wiki's entry 7786; nothing here reaches the internet."""
import json
import urllib.error
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

import endgame_samples
from guildboard import netpolicy
from guildboard.characters.art import ArtCache
from guildboard.characters.wiki import ENTRY_URL, CharacterWiki
from guildboard.config import AppPaths, Settings, save_settings
from guildboard.core import Core
from guildboard.metrics import ENDGAME_KEYS, Point
from guildboard.records import EndgameRecord
from guildboard.sources import hoyolab_normalize as norm
from guildboard.store import WikiEntryRow
from guildboard.views.endgame_card import MODE_ART, ModeArt, build_endgame_card, header_art, short_name
from support import AccountSource, FakeClock, FakeSleep

NOW = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)  # the Stygian season has ended, and the next opens on 11 Nov
SERVER = "os_euro"  # the fixtures' account: each cycle starts at 04:00 in its zone, 03:00 UTC
PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 40
TUTORIAL_7786 = Path(__file__).parent / "fixtures" / "wiki" / "tutorial_7786.json"
UPLOAD = "https://act-upload.hoyoverse.com/event-ugc-hoyowiki"
ICONS = {  # the three entries' icons, as the wiki gives them
    "5669": f"{UPLOAD}/2024/07/04/41133912/1cfa0e3105a031053ab0b83c47888981_9054931798989265179.png",
    "5832": f"{UPLOAD}/2024/07/04/41133912/ddcd00db3613c8c39ed4d902cc43cc2e_7623522857361033099.png",
    "7786": f"{UPLOAD}/2025/07/14/41133912/b6287b34deb1f4d12e0be0599584cc70_855379148837321239.png",
}
FIRST_PICTURES = {  # each entry's first picture after its icon: its Gallery's first
    "5669": f"{UPLOAD}/2024/05/24/205556113/dc7049bf3288ad089b1e7f1d2e6ef53d_2370196706969190975.png",
    "5832": f"{UPLOAD}/2024/07/18/41133912/ec67e31a0d0484027fd003eb2d41326b_2931723463474438869.png",
    "7786": f"{UPLOAD}/2026/01/30/25567199/70a89ddfb1ce4f96097fe934d923d687_2389902169693064604.jpg",
}
FEARLESS = f"{UPLOAD}/2025/07/23/41133912/a95ba67de542cddc2d97e68089ff04c5_7557421508391672161.png"  # difficulty 5's medal


def tutorial_answer(entry: str) -> bytes:
    """The wiki's answer for one of the three Tutorial entries: 7786 as recorded, the other two cut down to their icon and
    the first picture of their Gallery."""
    if entry == "7786":
        return TUTORIAL_7786.read_bytes()
    gallery = json.dumps({"list": [{"key": "Picture", "img": FIRST_PICTURES[entry]}]})
    page = {
        "id": entry, "name": {"5669": "Spiral Abyss", "5832": "Imaginarium Theater"}[entry], "icon_url": ICONS[entry],
        "menu_id": "14", "modules": [{"name": "Gallery", "components": [{"component_id": "gallery_character", "data": gallery}]}],
    }
    return json.dumps({"retcode": 0, "message": "OK", "data": {"page": page}}).encode("utf-8")


async def tutorial_rows(store, clock) -> dict[str, WikiEntryRow]:
    """The three entries as the wiki path keeps them, by mode."""
    wiki = CharacterWiki(store, clock, lambda url, **_: tutorial_answer(url[len(ENTRY_URL):]), lambda: "7.1")
    return {mode: await wiki.entry(spec.wiki_entry, "tutorial") for mode, spec in MODE_ART.items()}


def keep_endgame(store, record: EndgameRecord, at: datetime = NOW) -> None:
    """The endgame read as a sync keeps it: the record as JSON, the newest of its group."""
    store.set_latest_doc("endgame", at, json.loads(json.dumps(asdict(record))))


def real_record() -> EndgameRecord:
    abyss, theater, stygian = endgame_samples.abyss(), endgame_samples.theater(), endgame_samples.stygian()
    summary = norm.normalize_endgame(abyss, theater, stygian)
    return replace(summary, detail=norm.normalize_endgame_detail(abyss, theater, stygian))


class Downloads:
    """Stands in for netpolicy.fetch_bytes: every address is a picture."""

    def __init__(self) -> None:
        self.asked: list[str] = []

    def __call__(self, url: str, *, max_bytes=None, hosts=None) -> bytes:
        self.asked.append(url)
        return PNG


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(NOW)


@pytest.fixture
def art(store, clock, tmp_path) -> ArtCache:
    return ArtCache(store, AppPaths(tmp_path / "data"), clock, None, False)


def card(store, art, rows, now=NOW) -> dict:
    return build_endgame_card(store, art, rows, now, SERVER)


def modes(model: dict) -> dict[str, dict]:
    return {column["mode"]: column for column in model["modes"]}


# ------------------------------------------------------------------------------------------------ the pictures


def test_each_mode_names_its_wiki_entry_its_public_picture_and_crop():
    assert MODE_ART == {
        "abyss": ModeArt("abyss", "5669", 0, None),
        "theater": ModeArt("theater", "5832", 1, None),
        "stygian": ModeArt("stygian", "7786", 2, (0.0, 0.0, 0.48, 0.84)),  # the flower at the left, never the words
    }


async def test_header_art_falls_back_from_the_public_picture_to_the_wiki_then_none(store, clock, tmp_path):
    rows = await tutorial_rows(store, clock)
    downloads = Downloads()
    art = ArtCache(store, AppPaths(tmp_path / "data"), clock, downloads, False)
    art.warm_pause = 0
    # The public picture is not kept yet: the entry's first picture after its icon, uncropped.
    for mode, spec in MODE_ART.items():
        assert header_art(mode, art, rows[mode]) == {
            "icon": art.address(ICONS[spec.wiki_entry]), "picture": art.address(FIRST_PICTURES[spec.wiki_entry]), "crop": None,
        }
    assert downloads.asked == []  # the model asks for nothing
    # Once the cache keeps the public pictures, they are the headers', with the Stygian banner's crop.
    assert await art.warm_public([spec.picture_index for spec in MODE_ART.values()]) == 3
    assert downloads.asked == list(netpolicy.PUBLIC_PICTURE_URLS)
    stygian = header_art("stygian", art, rows["stygian"])
    assert stygian == {"icon": art.address(ICONS["7786"]), "picture": art.public_address(2), "crop": [0.0, 0.0, 0.48, 0.84]}
    assert header_art("abyss", art, rows["abyss"])["picture"] == art.public_address(0)
    assert header_art("abyss", art, rows["abyss"])["crop"] is None
    # With no entry read, the public picture alone; with neither, plain parchment.
    assert header_art("theater", art, None) == {"icon": None, "picture": art.public_address(1), "crop": None}
    bare = ArtCache(store, AppPaths(tmp_path / "other"), clock, None, False)  # a cache that keeps no picture on its disk
    assert header_art("theater", bare, None) == {"icon": None, "picture": None, "crop": None}
    # A wiki picture outside HoYoverse's picture hosts is never given out, nor is the icon taken for a picture.
    outside = WikiEntryRow("5832", "tutorial", "Imaginarium Theater", {
        "name": "Imaginarium Theater", "icon": ICONS["5832"], "pictures": [ICONS["5832"], "https://example.com/a.png"],
        "captions": ["", ""],
    }, "7.1", NOW)
    assert header_art("theater", bare, outside) == {"icon": bare.address(ICONS["5832"]), "picture": None, "crop": None}
    # An entry kept as another kind is not a Tutorial entry.
    other = replace(rows["abyss"], kind="character")
    assert header_art("abyss", bare, other)["icon"] is None


def test_the_demo_without_pictures_shows_plain_headers(store, clock, tmp_path):
    demo = ArtCache(store, AppPaths(tmp_path / "data"), clock, None, True)
    demo.demo_dir = tmp_path / "nothing-here"
    keep_endgame(store, real_record())
    for column in card(store, demo, {})["modes"]:
        assert column["header"] == {"icon": None, "picture": None, "crop": None}
        assert all(rank["face"] is None for rank in column.get("ranks", []))


# ------------------------------------------------------------------------------------------------ the three columns


def test_the_abyss_shows_floor_12_or_the_highest_floor_played(store, art):
    keep_endgame(store, real_record())
    abyss = modes(card(store, art, {}))["abyss"]
    assert (abyss["label"], abyss["played"], abyss["stars"]) == ("Spiral Abyss", True, 36)
    assert (abyss["period"], abyss["battles"], abyss["wins"]) == ("16 Oct to 15 Nov", 6, 6)
    assert abyss["line"] == "16 Oct to 15 Nov · 6 battles, 6 won"
    assert abyss["chambers"][0] == {"name": "9-1", "stars": 3} and len(abyss["chambers"]) == 12
    assert abyss["floor_shown"] == 12
    assert [(group["chamber"], group["half"]) for group in abyss["foes"]] == [
        ("12-1", 1), ("12-1", 2), ("12-2", 1), ("12-2", 2), ("12-3", 1), ("12-3", 2),
    ]
    first = abyss["foes"][1]["foes"][0]
    assert (first["name"], first["level"]) == ("Iniquitous Baptist - Caller of Flood, Flame, and Fulmination", 95)
    assert first["icon"].startswith("/api/art/")  # HoYoLAB's picture, served from the art cache
    assert [rank["label"] for rank in abyss["ranks"]] == [
        "Strongest single strike", "Most defeats", "Most damage taken", "Most bursts", "Most skills", "Most played",
    ]
    strike = abyss["ranks"][0]
    assert (strike["kind"], strike["value"]) == ("strike", 1352944) and strike["face"].startswith("/api/art/")
    # Floor 12 not reached: the highest floor played, and its enemies.
    record = real_record()
    halves = tuple(half for half in record.detail.abyss_halves if not half.chamber.startswith("12-"))
    keep_endgame(store, replace(record, detail=replace(record.detail, abyss_halves=halves)))
    lower = modes(card(store, art, {}))["abyss"]
    assert lower["floor_shown"] == 11
    assert {group["chamber"] for group in lower["foes"]} == {"11-1", "11-2", "11-3"}


def test_the_theater_shows_its_month_acts_medals_and_highlights(store, art):
    keep_endgame(store, real_record())
    theater = modes(card(store, art, {}))["theater"]
    assert (theater["month"], theater["difficulty"], theater["act"]) == ("November", "Arcana Challenge", 10)
    assert theater["line"] == "November · Arcana Challenge"
    assert len(theater["medals"]) == 12 and theater["medals"][:4] == [True, False, True, True]
    assert theater["medal_count"] == 6  # HoYoLAB's own count, not the medals of the Arcana acts
    assert (theater["flowers"], theater["seconds"]) == (1285, 1002)
    assert [(rank["label"], rank["value"]) for rank in theater["ranks"]] == [
        ("Most damage", 943229), ("Most defeats", 11), ("Most damage taken", 68942),
    ]


async def test_a_stygian_season_not_started_dims_the_last_and_names_the_next(store, art, clock):
    keep_endgame(store, real_record())
    rows = await tutorial_rows(store, clock)
    model = card(store, art, rows)
    styg = model["modes"][2]
    assert styg["dimmed"] and styg["next"] == {"name": "Battle Amid the Great Waves", "starts": "11 Nov"}
    assert not styg["next_started"]
    assert (styg["season"], styg["ended"], styg["line"]) == ("Luminous Battlefront", True, "Luminous Battlefront · ended")
    assert (styg["difficulty"], styg["seconds"]) == (5, 280)
    assert styg["medal"] == art.address(FEARLESS)  # the wiki's medal for difficulty 5, from its Tutorial entry
    assert [(boss["short"], boss["seconds"]) for boss in styg["bosses"]] == [
        ("Domovoy Sculptor: Gale Hewing", 119), ("Overseer Device: Obliterator Panoply", 42),
        ("Guardian Blade of Drifting Snow", 119),
    ]
    assert styg["bosses"][0]["name"] == "Battle-Hardened Domovoy Sculptor: Gale Hewing"  # whole, for the hover
    assert all(boss["icon"].startswith("/api/art/") for boss in styg["bosses"])
    # Once the next season has opened, the note says it is on; the card still shows the last season played.
    opened = modes(card(store, art, rows, now=datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)))["stygian"]
    assert opened["dimmed"] and opened["next_started"]
    # Without the entry, or with a difficulty it has no medal for, the badge is drawn.
    assert modes(card(store, art, {}))["stygian"]["medal"] is None
    record = real_record()
    keep_endgame(store, replace(record, detail=replace(record.detail, stygian_difficulty=7, stygian_medal="UI_LeyLineChallenge_Medal_7")))
    assert modes(card(store, art, rows))["stygian"]["medal"] is None
    # A season played with no newer one waiting is shown as it is.
    keep_endgame(store, replace(record, detail=replace(record.detail, stygian_next=None)))
    plain = modes(card(store, art, rows, now=datetime(2026, 10, 20, tzinfo=timezone.utc)))["stygian"]
    assert (plain["dimmed"], plain["next"], plain["ended"], plain["line"]) == (False, None, False, "Luminous Battlefront")


def test_a_season_still_on_is_not_dimmed_though_the_next_is_announced(store, art):
    keep_endgame(store, real_record())
    on = modes(card(store, art, {}, now=datetime(2026, 10, 20, tzinfo=timezone.utc)))["stygian"]
    assert (on["ended"], on["dimmed"], on["line"]) == (False, False, "Luminous Battlefront")
    assert on["next"] == {"name": "Battle Amid the Great Waves", "starts": "11 Nov"}  # the note still names the next


def test_last_months_theater_season_shown_on_the_first_is_marked_ended(store, art):
    keep_endgame(store, real_record())
    first = modes(card(store, art, {}, now=datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)))["theater"]
    assert (first["ended"], first["line"]) == (True, "November · Arcana Challenge · ended")
    shown = modes(card(store, art, {}))["theater"]
    assert (shown["ended"], shown["line"]) == (False, "November · Arcana Challenge")


def test_a_new_cycle_with_no_tries_yet_keeps_the_best(store, art):
    # The Abyss on the 16th: HoYoLAB has the new cycle, with no battle in it yet.
    run = store.start_run("startup", NOW)
    store.add_points(run, NOW, NOW.date(), [Point(ENDGAME_KEYS["abyss"], 36.0)])
    record = real_record()
    fresh = replace(record.modes[0], has_data=False, result_text="No attempt this period", score=None)
    keep_endgame(store, replace(record, modes=(fresh, *record.modes[1:])))
    abyss = modes(card(store, art, {}))["abyss"]
    assert (abyss["played"], abyss["best"]) == (False, "36 stars")


# The endgame detail's fields as 1.0.1 kept them, before the card's: a detail it stored stays the newest until the next
# sync reads the endgame again.
FIELDS_1_0_1 = (
    "abyss_stars", "abyss_halves", "abyss_ends", "theater_difficulty", "theater_acts", "theater_ends",
    "stygian_difficulty", "stygian_bosses", "stygian_ends",
)


def keep_as_1_0_1(store, record: EndgameRecord) -> None:
    """The endgame as 1.0.1 kept it: the detail's first nine fields alone, its halves without the enemies' levels and
    pictures, and its bosses without theirs."""
    doc = json.loads(json.dumps(asdict(record)))
    detail = {name: doc["detail"][name] for name in FIELDS_1_0_1}
    for half in detail["abyss_halves"]:
        del half["foes"]
    for boss in detail["stygian_bosses"]:
        del boss["icon"], boss["level"]
    store.set_latest_doc("endgame", NOW, {**doc, "detail": detail})


def test_a_detail_kept_by_1_0_1_shows_no_made_up_zero(store, art):
    keep_as_1_0_1(store, real_record())
    model = modes(card(store, art, {}))
    abyss, theater, styg = model["abyss"], model["theater"], model["stygian"]
    # What 1.0.1 kept still shows: the stars, the floor's enemies by name, the act, the difficulty and the bosses.
    assert (abyss["stars"], abyss["floor_shown"], theater["act"], styg["difficulty"]) == (36, 12, 10, 5)
    assert abyss["foes"][1]["foes"][0] == {
        "name": "Iniquitous Baptist - Caller of Flood, Flame, and Fulmination", "level": 0, "icon": None,
    }
    assert [boss["seconds"] for boss in styg["bosses"]] == [119, 42, 119]
    # What it did not keep is None, never a 0 or an empty list that the card would show as a result.
    assert [abyss[name] for name in ("battles", "wins", "chambers", "ranks")] == [None] * 4
    assert [theater[name] for name in ("medals", "medal_count", "ranks", "flowers", "seconds")] == [None] * 5
    assert (styg["seconds"], styg["next"], styg["dimmed"]) == (None, None, False)
    assert abyss["line"] == "16 Oct to 15 Nov"  # no battles to tell
    assert theater["line"] == "November · Arcana Challenge"
    # A 0 this version read is a real 0, and an empty list a real one.
    record = real_record()
    zeros = replace(record.detail, theater_medal_count=0, theater_flowers=0, theater_seconds=0, abyss_ranks=())
    keep_endgame(store, replace(record, detail=zeros))
    read = modes(card(store, art, {}))
    assert [read["theater"][name] for name in ("medal_count", "flowers", "seconds")] == [0, 0, 0]
    assert read["abyss"]["ranks"] == [] and len(read["abyss"]["chambers"]) == 12


def test_a_bosss_short_name_drops_its_title_or_its_kind():
    assert short_name("Battle-Hardened Domovoy Sculptor: Gale Hewing") == "Domovoy Sculptor: Gale Hewing"
    assert short_name("Secret Source Automaton: Overseer Device - Obliterator Panoply") == "Overseer Device: Obliterator Panoply"
    assert short_name("Guardian Blade of Drifting Snow: Endless Reverberation") == "Guardian Blade of Drifting Snow"
    assert short_name("Chimeric Winged Lion") == "Chimeric Winged Lion"
    assert short_name("") == ""


def test_a_mode_never_played_says_so(store, art):
    nothing = replace(norm.normalize_endgame({}, {}, []), detail=norm.normalize_endgame_detail(None, {}, []))
    keep_endgame(store, nothing)
    model = card(store, art, {})
    assert [column["mode"] for column in model["modes"]] == ["abyss", "theater", "stygian"]
    for column in model["modes"]:
        assert column["played"] is False and column["label"] and set(column["header"]) == {"icon", "picture", "crop"}
        for key, value in column.items():
            if isinstance(value, list) and key != "crop":
                assert value == [], (column["mode"], key)
        # The detail carries every field, so none of them is None.
        assert all(column[key] is not None for key in ("chambers", "ranks", "medals", "medal_count") if key in column)
    styg = modes(model)["stygian"]
    assert (styg["next"], styg["dimmed"], styg["medal"]) == (None, False, None)
    assert modes(model)["abyss"]["floor_shown"] == 0


def test_no_endgame_read_yet_gives_no_modes(store, art):
    assert card(store, art, {}) == {"modes": []}


def test_best_and_result_are_todays(store, art):
    run = store.start_run("startup", NOW)
    store.add_points(run, NOW, NOW.date(), [
        Point(ENDGAME_KEYS["abyss"], 36.0), Point(ENDGAME_KEYS["theater"], 10.0), Point(ENDGAME_KEYS["stygian"], 5.0),
    ])
    keep_endgame(store, real_record())
    model = modes(card(store, art, {}))
    assert [model[mode]["best"] for mode in ("abyss", "theater", "stygian")] == ["36 stars", "Act 10", "Difficulty 5"]
    assert [model[mode]["result"] for mode in ("abyss", "theater", "stygian")] == [
        "36 of 36 stars", "Act 10 reached", "Difficulty 5 cleared",
    ]


def test_a_highlights_character_is_named_from_the_characters_read(store, art):
    keep_endgame(store, real_record())
    store.set_latest_doc("characters", NOW, {"builds": {"builds": [{"id": 10000133, "name": "Someone", "element": "Cryo"}]}})
    ranks = {rank["kind"]: rank for rank in modes(card(store, art, {}))["abyss"]["ranks"]}
    assert (ranks["strike"]["name"], ranks["strike"]["element"]) == ("Someone", "Cryo")
    assert (ranks["bursts"]["name"], ranks["bursts"]["element"]) == (None, None)  # one the read does not name


# ------------------------------------------------------------------------------------------------ the core


class _Answer:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self, amount: int) -> bytes:
        return self._data[:amount]

    def __enter__(self) -> "_Answer":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def _live_core(tmp_path, clock, monkeypatch, *, consent: bool):
    """A live core over a wire that answers the three entries and every picture, each request remembered."""
    sent: list[tuple[str, str, dict[str, str]]] = []

    def wire(request, timeout):
        sent.append((request.get_method(), request.full_url, dict(request.header_items())))
        if request.full_url.startswith(ENTRY_URL):
            return _Answer(tutorial_answer(request.full_url[len(ENTRY_URL):]))
        if request.full_url.endswith((".png", ".jpg", "/latest")):
            return _Answer(PNG)
        raise urllib.error.URLError("the tests contact nothing else")

    monkeypatch.setattr(netpolicy, "_open", wire)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    save_settings(paths.settings_path, Settings(risk_acknowledged=consent))
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set())
    core.art.warm_pause = 0
    return core, sent


async def test_after_consent_a_live_core_reads_the_three_entries_and_fetches_the_six_pictures(tmp_path, clock, monkeypatch):
    core, sent = _live_core(tmp_path, clock, monkeypatch, consent=True)
    try:
        await core.read_endgame_art()
        assert [url for _, url, _ in sent] == [
            *(ENTRY_URL + entry for entry in ("5669", "5832", "7786")),
            *ICONS.values(),
            *netpolicy.PUBLIC_PICTURE_URLS,
        ]
        # A public picture goes out as a plain GET with Guild Board's user agent and nothing else.
        for method, url, headers in sent[-3:]:
            assert (method, headers) == ("GET", {"User-agent": netpolicy.USER_AGENT}), url
        # Read once for the game's version, and fetched once.
        await core.read_endgame_art()
        assert len(sent) == 9
        keep_endgame(core.store, real_record())
        headers = [column["header"] for column in core.stats_endgame()["modes"]]
        assert [header["picture"] for header in headers] == [core.art.public_address(i) for i in range(3)]
        assert [header["icon"] for header in headers] == [core.art.address(icon) for icon in ICONS.values()]
        assert modes(core.stats_endgame())["stygian"]["medal"] == core.art.address(FEARLESS)
    finally:
        core.store.close()


async def test_the_card_asked_for_reads_ahead_at_most_once_an_hour_and_tells_the_pages(tmp_path, clock, monkeypatch):
    core, sent = _live_core(tmp_path, clock, monkeypatch, consent=True)
    heard = core.bus.subscribe()
    try:
        core.endgame_art_wanted()
        await core._endgame_art_task
        assert len(sent) == 9
        events = [heard.get_nowait()["type"] for _ in range(heard.qsize())]
        assert events == ["stats_changed"]  # the card reads its model again, with the pictures now kept
        clock.advance(minutes=59)
        core.endgame_art_wanted()
        assert core._endgame_art_task.done()  # not asked again within the hour
        clock.advance(minutes=2)
        core.endgame_art_wanted()
        await core._endgame_art_task
        assert len(sent) == 9 and heard.empty()  # everything is kept: nothing asked, nothing new to tell
    finally:
        core.bus.unsubscribe(heard)
        await core.stop()


def test_the_interface_reads_again_on_stats_changed():
    live = (Path(__file__).resolve().parents[1] / "web" / "src" / "live.ts").read_text(encoding="utf-8")
    assert "'stats_changed'" in live


async def test_before_consent_and_in_the_demo_nothing_is_asked(tmp_path, clock, monkeypatch):
    core, sent = _live_core(tmp_path, clock, monkeypatch, consent=False)
    try:
        await core.read_endgame_art()
        core.endgame_art_wanted()
        assert sent == [] and core.stats_endgame() == {"modes": []}
    finally:
        core.store.close()
    demo = Core(AppPaths(tmp_path / "demo"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        await demo.read_endgame_art()
        demo.endgame_art_wanted()
        assert sent == []
    finally:
        demo.store.close()
