"""Key-free samples of HoYoverse's answers, for the tests of the Pulls import and its sources (the Pulls plan, Task 6).

- The wish history (getGachaLog): pages in the shape HoYoverse gives them, with made-up records, and its answers for a
  key that is wrong (-100), a key that is too old (-101) and too many requests (-110), as the API gives them.
- The announcements (getAnnList, getAnnContent) and the wiki's lists: cut from the answers HoYoverse gave on 2026-10-24
  (the same three wishes as on 2026-10-23) to a request with no key and nothing of the player's (uid=1, level=60): the
  three wishes running, another event that names a wish, one entry of each other group, and a few of the wiki's
  characters and weapons.

Every key here is made up, and the links are built by the tests that use them.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlencode, urlsplit

from guildboard.pulls.gamecache import WishLink

# ---------------------------------------------------------------- the link the game caches, with a made-up key

UID = "700000001"
LINK_PAGE = "https://gs.hoyoverse.com/genshin/event/e20190909gacha-v3/index.html"


def wish_link(
    key: str = "MADE-UP-KEY-0123456789", region: str | None = "os_euro", timestamp: str = "1760000000"
) -> WishLink:
    """A wish-history link as the game's Wish → History page caches it, with the parameters of the facts table, `key`
    as its key, and made at `timestamp` (seconds since 1970). Without a region when `region` is None."""
    query = {
        "win_mode": "fullscreen", "authkey_ver": "1", "sign_type": "2", "auth_appid": "webview_gacha",
        "init_type": "301", "gacha_id": "made-up", "timestamp": timestamp, "lang": "en", "device_type": "pc",
        "game_version": "OSRELWin6.0.0_R1_S1", "plat_type": "pc",
        **({"region": region} if region is not None else {}), "authkey": key, "game_biz": "hk4e_global",
    }
    return WishLink(f"{LINK_PAGE}?{urlencode(query)}#/log", query, Path("data_2"))


# Bytes that are no printable ASCII, so that they never join the link beside them in the cache.
_NOISE = bytes(range(0x00, 0x20)) + bytes(range(0x7F, 0x100))
LOG_PARTS = ("AppData", "LocalLow", "miHoYo", "Genshin Impact", "output_log.txt")


def cache_holding(*links: WishLink) -> bytes:
    """A web cache's bytes holding the links in the order given, each behind binary noise, as the game's cache holds
    them."""
    return b"".join(_NOISE + b"1/0/" + link.url.encode("ascii") + b"\x00" + _NOISE for link in links)


def made_up_game(home: Path, *keys: str) -> tuple[Path, Path]:
    """The game's two files, made up under `home`, which the test sets as USERPROFILE: a log naming a data folder in
    home/game, and that folder's web cache holding a wish-history link for each key, the last given last in the file.
    Gives (the log, the cache)."""
    folder = home / "game" / "GenshinImpact_Data"
    log = home.joinpath(*LOG_PARTS)
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(f"Initialize engine version: 6.0.0f1\nLoading player data from {folder}/data.unity3d\n",
                   encoding="utf-8")
    cache = folder / "webCaches" / "2.33.0.0" / "Cache" / "Cache_Data" / "data_2"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(cache_holding(*(wish_link(key) for key in keys)))
    return log, cache


def picture_bytes(kind: str = "PNG", width: int = 320, height: int = 180, colour: str = "#9fc3e6") -> bytes:
    """A small made-up picture's bytes, as Pillow writes one."""
    import io

    from PIL import Image

    written = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(written, "JPEG" if kind == "JPG" else kind)
    return written.getvalue()


def made_up_screenshots(home: Path) -> Path:
    """The made-up game's ScreenShot folder, next to its data folder (made_up_game's): two pictures named as the game
    names them, one with no time in its name, and what the gallery leaves alone: a picture in a subfolder and a text
    file. Gives the folder."""
    folder = home / "game" / "ScreenShot"
    (folder / "older").mkdir(parents=True, exist_ok=True)
    (folder / "20261012211403.png").write_bytes(picture_bytes("PNG", 1280, 720))
    (folder / "20260930080000.jpg").write_bytes(picture_bytes("JPG", colour="#d66f4f"))
    (folder / "Photo (2).jpg").write_bytes(picture_bytes("JPG", colour="#3b8f9a"))
    (folder / "older" / "20250101120000.png").write_bytes(picture_bytes())
    (folder / "notes.txt").write_text("not a picture", encoding="utf-8")
    return folder


class History:
    """HoYoverse's wish history, standing in behind wishapi.fetch_page: each wish type's records, answered 20 a page
    below end_id and newest first, as getGachaLog gives them, to the keys it knows; any other key is answered as expired.
    Every request is remembered as its parameters. `refuse` may give an answer in place of a page, for a request it
    chooses."""

    def __init__(self, records: dict[str, list[dict[str, str]]] | None = None, keys: Iterable[str] = ()) -> None:
        self.records: dict[str, list[dict[str, str]]] = {}
        for gacha_type, listed in (records or {}).items():
            self.add(gacha_type, listed)
        self.keys: dict[str, bytes | None] = {key: None for key in keys}  # a key's answer when it is not a page
        self.asked: list[dict[str, str]] = []
        self.refuse: Any = None  # a function of a request's parameters: an answer in its place, or None

    def add(self, gacha_type: str, listed: Iterable[dict[str, str]]) -> None:
        self.records[gacha_type] = sorted(
            [*self.records.get(gacha_type, []), *listed], key=lambda kept: int(kept["id"]), reverse=True
        )

    def __call__(self, url: str) -> bytes:
        query = {name: values[0] for name, values in parse_qs(urlsplit(url).query).items()}
        self.asked.append(query)
        answer = self.keys.get(query.get("authkey", ""), KEY_EXPIRED)
        if answer is None and self.refuse is not None:
            answer = self.refuse(query)
        if answer is not None:
            return answer
        end_id = int(query["end_id"])
        older = [kept for kept in self.records.get(query["gacha_type"], []) if end_id == 0 or int(kept["id"]) < end_id]
        return gacha_page(older[:20])


# ---------------------------------------------------------------- the wish history (getGachaLog)

def record(
    wish_id: int,
    gacha_type: str = "301",
    time: str = "2026-10-12 21:14:03",
    name: str = "Fischl",
    item_type: str = "Character",
    rank: int = 4,
    uid: str = UID,
) -> dict[str, str]:
    """One record, as HoYoverse gives it: every field a string."""
    return {
        "uid": uid, "gacha_type": gacha_type, "item_id": "", "count": "1", "time": time, "name": name,
        "lang": "en-us", "item_type": item_type, "rank_type": str(rank), "id": str(wish_id),
    }


def gacha_page(records: Iterable[dict[str, str]], region: str = "os_euro", region_time_zone: int = 1) -> bytes:
    """A page of the history as getGachaLog answers it: the records newest first."""
    return json.dumps({
        "retcode": 0, "message": "OK",
        "data": {"page": "0", "size": "20", "total": "0", "list": list(records), "region": region,
                 "region_time_zone": region_time_zone},
    }).encode("utf-8")


# A full page: twenty records of the character event, newest first, a minute apart, the newest the brief's Fischl.
_TWENTY = (
    ("Fischl", "Character", 4), ("Cool Steel", "Weapon", 3), ("Slingshot", "Weapon", 3),
    ("Debate Club", "Weapon", 3), ("Skirk", "Character", 5), ("Thrilling Tales of Dragon Slayers", "Weapon", 3),
    ("Bennett", "Character", 4), ("Black Tassel", "Weapon", 3), ("Emerald Orb", "Weapon", 3),
    ("Ferrous Shadow", "Weapon", 3), ("Magic Guide", "Weapon", 3), ("Raven Bow", "Weapon", 3),
    ("Sharpshooter's Oath", "Weapon", 3), ("Xingqiu", "Character", 4), ("Bloodtainted Greatsword", "Weapon", 3),
    ("Harbinger of Dawn", "Weapon", 3), ("Skyrider Sword", "Weapon", 3), ("Cool Steel", "Weapon", 3),
    ("Slingshot", "Weapon", 3), ("Debate Club", "Weapon", 3),
)
_NEWEST = datetime(2026, 10, 12, 21, 14, 3)
PAGE_OF_TWENTY = [
    record(1760000000000000020 - index, "301", f"{_NEWEST - timedelta(minutes=index):%Y-%m-%d %H:%M:%S}",
           name, item_type, rank)
    for index, (name, item_type, rank) in enumerate(_TWENTY)
]
PAGE = gacha_page(PAGE_OF_TWENTY)

# The answers HoYoverse gives with HTTP 200 for a wrong or missing key, a key older than a day, and too many requests.
KEY_INVALID = b'{"data":null,"message":"authkey error","retcode":-100}'
KEY_EXPIRED = b'{"data":null,"message":"authkey timeout","retcode":-101}'
TOO_FREQUENT = b'{"data":null,"message":"visit too frequently","retcode":-110}'


# ---------------------------------------------------------------- the announcements (getAnnList, getAnnContent)

_TAG_ICON = "https://sdk.hoyoverse.com/upload/announcement/2020/03/05/2cf7327b5fb2c050872ead29e338e368_7400353291716098710.png"


def _list_entry(ann_id: int, title: str, subtitle: str, banner: str, type_label: str, type_id: int, tag: str,
                start: str, end: str) -> dict[str, Any]:
    """An entry of getAnnList, with its fields as HoYoverse gives them; its content is empty there."""
    return {
        "ann_id": ann_id, "title": title, "subtitle": subtitle, "banner": banner, "content": "",
        "type_label": type_label, "tag_label": tag, "tag_icon": _TAG_ICON, "login_alert": 1, "lang": "en-us",
        "start_time": start, "end_time": end, "type": type_id, "remind": 1, "alert": 0,
        "tag_start_time": "2000-01-02 15:04:05", "tag_end_time": "2030-01-02 15:04:05", "remind_ver": 1,
        "has_content": True, "extra_remind": 0, "tag_icon_hover": "", "logout_remind": 0, "logout_remind_ver": 1,
        "country": "", "need_remind_text": 0, "remind_text": "", "weak_remind": 1, "remind_consumption_type": 0,
    }


SKIRK_ART = "https://sdk.hoyoverse.com/upload/ann/2026/09/23/8668a2e84580c1426c290a447320bcd9_5708783295049261864_transformed.jpg"
ESCOFFIER_ART = "https://sdk.hoyoverse.com/upload/ann/2026/09/23/e77eb5aab52127e55989bb8162d671d8_5676769242945454268_transformed.jpg"
EPITOME_ART = "https://sdk.hoyoverse.com/upload/ann/2026/09/23/ccc187c09296b4a1990c8cf98dcadb46_5421147638874447905_transformed.jpg"
FROZEN_WILDS_ART = "https://sdk.hoyoverse.com/upload/ann/2026/09/11/d353f2681a2b4a56d9db56c863201430_5948218306514774688_transformed.jpg"

SKIRK_TITLE = 'Event Wish "Void Star\'s Advent" - Boosted Drop Rate for "Void Star" Skirk (Cryo)!'
ESCOFFIER_TITLE = 'Event Wish "La Chanson Cerise" - Boosted Drop Rate for "Tasteful Excellence" Escoffier (Cryo)!'
EPITOME_TITLE = (
    'Event Wish "Epitome Invocation" - Boosted Drop Rates for Azurelight (Sword) and Symphonist of Scents (Polearm)!'
)
FROZEN_WILDS_TITLE = (
    '"Across the Frozen Wilds, Honing One\'s Edge" Event: Invite a 5-Star Character of Your Choice From the '
    '"Wanderlust Invocation" Standard Wish'
)

# The announcement's own times, which are not the banner's: it shows from the 8th, and the banner runs from the 13th.
ANN_START, ANN_END = "2026-10-08 03:00:00", "2026-11-03 14:59:59"


def ann_list(*events: dict[str, Any], timezone: int = 1) -> bytes:
    """getAnnList's answer: the groups Game, Event (holding `events`) and Miliastra Wonderland, and the server's offset
    from UTC in hours."""
    game = _list_entry(21947, "New Content Overview", "Version 7.1 Now Available", "", "Game", 2, "3",
                       "2026-09-22 18:00:00", "2026-11-03 17:00:00")
    wonderland = _list_entry(
        21908, "Visit the Starlit Gala Web Event to Unlock Your Wonderland Year in Review Report!",
        "Starlit Gala: Genshin Impact Miliastra Wonderland Web Event Update!",
        "https://sdk.hoyoverse.com/upload/ann/2026/10/15/17ce4718f54a3a21719e7d07731a1b21_1092535759659879610_transformed.jpg",
        "Miliastra Wonderland", 26, "3", "2026-10-21 23:00:00", "2026-11-02 15:00:00",
    )
    groups = [
        {"list": [game], "type_id": 2, "type_label": "Game"},
        {"list": list(events), "type_id": 1, "type_label": "Event"},
        {"list": [wonderland], "type_id": 26, "type_label": "Miliastra Wonderland"},
    ]
    return json.dumps({
        "retcode": 0, "message": "OK",
        "data": {
            "list": groups, "total": 2 + len(events),
            "type_list": [{"id": 2, "name": "游戏系统公告", "mi18n_name": "Game"},
                          {"id": 1, "name": "活动公告", "mi18n_name": "Event"},
                          {"id": 26, "name": "千星奇域", "mi18n_name": "Miliastra Wonderland"}],
            "alert": False, "alert_id": 0, "timezone": timezone, "t": "1792823540", "pic_list": [], "pic_total": 0,
            "pic_type_list": [], "pic_alert": False, "pic_alert_id": 0, "static_sign": "", "banner": "",
            "calendar_type": 0, "use_webp": False,
        },
    }, ensure_ascii=False).encode("utf-8")


SKIRK_ENTRY = _list_entry(21888, SKIRK_TITLE, 'Event Wish "Void Star\'s Advent"', SKIRK_ART, "Event", 1, "2",
                          ANN_START, ANN_END)
ESCOFFIER_ENTRY = _list_entry(21889, ESCOFFIER_TITLE, 'Event Wish "La Chanson Cerise"', ESCOFFIER_ART, "Event", 1,
                              "2", ANN_START, ANN_END)
EPITOME_ENTRY = _list_entry(21890, EPITOME_TITLE, 'Event Wish "Epitome Invocation"', EPITOME_ART, "Event", 1, "2",
                            ANN_START, ANN_END)
FROZEN_WILDS_ENTRY = _list_entry(21885, FROZEN_WILDS_TITLE, "Across the Frozen Wilds, Honing One's Edge",
                                 FROZEN_WILDS_ART, "Event", 1, "3", "2026-09-20 23:00:00", ANN_END)


def _t_lc(text: str) -> str:
    """A time the game shows in the server's time, as the content holds it: the tag's angle brackets escaped."""
    return f'&lt;t class="t_lc" contenteditable="false"&gt;{text}&lt;/t&gt;'


def wish_content(intro: str, header: str, featured: str, start: str = "2026/10/13 18:00",
                 end: str = "2026/11/03 14:59") -> str:
    """A wish's content, cut from HoYoverse's: the first lines, then the table that gives the banner's own run."""
    span = '<span style="color: rgb(85, 85, 85);">'
    cell = '<p style="white-space: pre-wrap; text-align: center;">'
    return (
        f'<p style="white-space: pre-wrap; text-align: left;">{span}{intro}</span></p>'
        f'<table><tbody><tr><td data-colwidth="213">{cell}{span}Wish Duration</span></p></td>'
        f'<td data-colwidth="213">{cell}{span}{header}</span></p></td></tr>'
        f'<tr><td rowspan="3" data-colwidth="213">{cell}{_t_lc(start)}</p>{cell}{span}– </span></p>'
        f'{cell}{_t_lc(end)}</p></td><td rowspan="3" data-colwidth="213">{cell}{span}{featured}</span></p></td>'
        "</tr></tbody></table>"
    )


IN_COMBAT = "Travelers, stock up on weapons and characters in the event wish to make your party stronger in combat!"
SKIRK_CONTENT = wish_content(IN_COMBAT, "Featured Characters (5-Star)", '"Void Star" Skirk (Cryo)')
ESCOFFIER_CONTENT = wish_content(IN_COMBAT, "Featured Characters (5-Star)", '"Tasteful Excellence" Escoffier (Cryo)')
EPITOME_CONTENT = wish_content(
    'Travelers, stock up on weapons and characters in "Epitome Invocation" to make your party stronger in combat!',
    "Featured Weapons (5-Star)", "Azurelight (Sword)",
)
FROZEN_WILDS_CONTENT = (
    '<p style="white-space: pre-wrap;"><span style="color: rgb(85, 85, 85);">〓Event Duration〓</span></p>'
    '<p style="white-space: pre-wrap;"><span style="color: rgb(204, 146, 85);">After the Version 7.1 update – '
    f'{_t_lc("2026/11/03 14:59")}</span></p>'
)


def first_half_content(end: str, later: str) -> str:
    """A wish's content in a version's first half, made up in the wording of the real ones: its run starts with the
    update, so the table says "After the Version 7.2 update – <end>", as the Frozen Wilds event's content says its own,
    and the time of something else follows further down, as another event's or a maintenance note's."""
    span = '<span style="color: rgb(85, 85, 85);">'
    cell = '<p style="white-space: pre-wrap; text-align: center;">'
    return (
        f'<p style="white-space: pre-wrap; text-align: left;">{span}{IN_COMBAT}</span></p>'
        f'<table><tbody><tr><td data-colwidth="213">{cell}{span}Wish Duration</span></p></td>'
        f'<td data-colwidth="213">{cell}{span}Featured Characters (5-Star)</span></p></td></tr>'
        f'<tr><td rowspan="3" data-colwidth="213">{cell}{span}After the Version 7.2 update – </span>{_t_lc(end)}</p></td>'
        f'<td rowspan="3" data-colwidth="213">{cell}{span}"Void Star" Skirk (Cryo)</span></p></td></tr></tbody></table>'
        f'<p style="white-space: pre-wrap;">{span}The next event starts on {_t_lc(later)}.</span></p>'
    )


def content_entry(ann_id: int, title: str, subtitle: str, banner: str, content: str) -> dict[str, Any]:
    return {"ann_id": ann_id, "title": title, "subtitle": subtitle, "banner": banner, "content": content,
            "lang": "en-us", "remind_text": ""}


def ann_content(*entries: dict[str, Any]) -> bytes:
    """getAnnContent's answer: each announcement's content."""
    return json.dumps({
        "retcode": 0, "message": "OK",
        "data": {"list": list(entries), "total": len(entries), "pic_list": [], "pic_total": 0},
    }, ensure_ascii=False).encode("utf-8")


ANN_LIST = ann_list(SKIRK_ENTRY, ESCOFFIER_ENTRY, EPITOME_ENTRY, FROZEN_WILDS_ENTRY)
ANN_CONTENT = ann_content(
    content_entry(21947, "New Content Overview", "Version 7.1 Now Available", "", "<p>Version 7.1</p>"),
    content_entry(21888, SKIRK_TITLE, 'Event Wish "Void Star\'s Advent"', SKIRK_ART, SKIRK_CONTENT),
    content_entry(21889, ESCOFFIER_TITLE, 'Event Wish "La Chanson Cerise"', ESCOFFIER_ART, ESCOFFIER_CONTENT),
    content_entry(21890, EPITOME_TITLE, 'Event Wish "Epitome Invocation"', EPITOME_ART, EPITOME_CONTENT),
    content_entry(21885, FROZEN_WILDS_TITLE, "Across the Frozen Wilds, Honing One's Edge", FROZEN_WILDS_ART,
                  FROZEN_WILDS_CONTENT),
)


# ---------------------------------------------------------------- the HoYoLAB wiki's lists (get_entry_page_list)

def _filter(name: str, value: str, ident: str, enum: str = "") -> dict[str, Any]:
    return {name: {"values": [value], "value_types": [
        {"id": ident, "value": value, "mi18n_key": f"filter_{ident}", "icon": "", "enum_string": enum}
    ], "key": None}}


def wiki_entry(entry_page_id: str, name: str, icon_url: str, **filters: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for one in filters.values():
        merged.update(one)
    return {"entry_page_id": entry_page_id, "name": name, "icon_url": icon_url, "display_field": {},
            "filter_values": merged, "desc": ""}


_STATIC = "https://act-webstatic.hoyoverse.com/event-static-hoyowiki-admin"
SKIRK_ICON = f"{_STATIC}/2025/06/16/48dba0c10560a3ef573f17d97408b5a0_2527001828446746987.png"
CHARACTERS = [
    wiki_entry(  # a character the wiki has just added, with no rarity yet
        "11828", "Valeriy",
        "https://act-upload.hoyoverse.com/event-ugc-hoyowiki/2026/10/18/151578876/61ca571621e816ccb2544625177f28ba_2693351999029496571.png",
        region=_filter("character_region", "Snezhnaya", "1413"), vision=_filter("character_vision", "Electro", "773"),
    ),
    wiki_entry("7707", "Dahlia", f"{_STATIC}/2025/06/16/255dedc5048565aec2c5af510c6f74a5_7726536808309970424.png",
               rarity=_filter("character_rarity", "4-Star", "14", "4"),
               vision=_filter("character_vision", "Hydro", "751")),
    wiki_entry("7706", "Skirk", SKIRK_ICON, rarity=_filter("character_rarity", "5-Star", "2", "5"),
               vision=_filter("character_vision", "Cryo", "802")),
    wiki_entry("7624", "Escoffier", f"{_STATIC}/2025/04/30/ddbc128157d69479f61747f0918f9e72_2470321636402108639.png",
               vision=_filter("character_vision", "Cryo", "802"),
               rarity=_filter("character_rarity", "5-Star", "2", "5")),
]
WEAPONS = [
    wiki_entry("11733", "Breezeborne Refrain",
               f"{_STATIC}/2026/09/18/08697d01729fc9e1be80b7ca81f237a2_4427393545344341155.png",
               kind=_filter("weapon_type", "Bow", "417"), rarity=_filter("weapon_rarity", "4-Star", "689", "4")),
    wiki_entry("10758", "Disaster and Remorse",
               f"{_STATIC}/2026/05/15/173531aa00de724260fb5c8ce21ce625_742789739843295350.png",
               kind=_filter("weapon_type", "Polearm", "448"), rarity=_filter("weapon_rarity", "5-Star", "671", "5")),
    wiki_entry("7785", "Azurelight", f"{_STATIC}/2025/06/12/0809293ee527b40073c4c9636eff6dd0_2992571952915882222.png",
               kind=_filter("weapon_type", "Sword", "403"), rarity=_filter("weapon_rarity", "5-Star", "671", "5")),
    wiki_entry("7640", "Symphonist of Scents",
               f"{_STATIC}/2025/04/24/f1928d012621b1f03577efc4f619894a_6810995251642628479.png",
               rarity=_filter("weapon_rarity", "5-Star", "671", "5"), kind=_filter("weapon_type", "Polearm", "448")),
]


def wiki_page(entries: Iterable[dict[str, Any]], total: int) -> bytes:
    """A page of the wiki's list as get_entry_page_list answers it, with the length of the whole list, which the wiki
    gives in text ("132" on 2026-10-24, read again at the check with the player)."""
    return json.dumps({"retcode": 0, "message": "OK", "data": {"list": list(entries), "total": str(total)}},
                      ensure_ascii=False).encode("utf-8")


WIKI_CHARACTERS = wiki_page(CHARACTERS, 132)  # the wiki listed 132 characters on 2026-10-24
WIKI_WEAPONS = wiki_page(WEAPONS, 252)  # and 252 weapons
