"""Hand-written HoYoLAB responses, using the raw field names genshin.py 1.7.31 expects."""
from __future__ import annotations

INDEX = {
    "role": {"nickname": "Traveler", "region": "os_euro", "level": 60, "AvatarUrl": "", "game_head_icon": ""},
    "stats": {
        "achievement_number": 1318,
        "active_day_number": 1842,
        "avatar_number": 96,
        "spiral_abyss": "12-3",
        "anemoculus_number": 66,
        "geoculus_number": 131,
        "electroculus_number": 181,
        "dendroculus_number": 271,
        "hydroculus_number": 271,
        "pyroculus_number": 318,
        "moonoculus_number": 172,
        "cryoculus_number": 42,
        "common_chest_number": 2400,
        "exquisite_chest_number": 1650,
        "precious_chest_number": 560,
        "luxurious_chest_number": 200,
        "magic_chest_number": 152,
        "way_point_number": 512,
        "domain_number": 71,
        "full_fetter_avatar_num": 58,
        "brand_new_counter_number": 7,
        "some_flag": True,
        "role_combat": {"is_unlock": True, "max_round_id": 10, "has_data": True, "has_detail_data": True},
        "hard_challenge": {"difficulty": 5, "name": "Fearless", "has_data": True, "is_unlock": True},
    },
    "avatars": [],
    "world_explorations": [
        {
            "id": 15, "parent_id": 0, "name": "Sumeru", "exploration_percentage": 934, "type": "Offering", "level": 0,
            "icon": "https://act-webstatic.hoyoverse.com/game_record/genshin/city_icon/sumeru.png",
            "inner_icon": "", "background_image": "", "cover": "", "map_url": "",
            "offerings": [
                {"name": "Tree of Dreams", "level": 50, "icon": "https://act-webstatic.hoyoverse.com/x/tree.png"}
            ],
            "boss_list": [],
            "area_exploration_list": [
                {"name": "Desert of Hadramaveth", "exploration_percentage": 960},
                {"name": "Rainforest", "exploration_percentage": 1005},
            ],
        },
        {
            "id": 1, "parent_id": 0, "name": "Mondstadt", "exploration_percentage": 1000, "type": "Reputation",
            "level": 8, "icon": "", "inner_icon": "", "background_image": "", "cover": "", "map_url": "",
            "offerings": [], "boss_list": [], "area_exploration_list": [],
        },
        {
            "id": 16, "parent_id": 0, "name": "Natlan", "exploration_percentage": 780, "type": "TypeUnknown",
            "level": 0, "icon": "", "inner_icon": "", "background_image": "", "cover": "", "map_url": "",
            "offerings": [], "boss_list": [], "area_exploration_list": [],
            "natan_reputation": {
                "tribal_list": [{"icon": "", "image": "", "name": "Children of Echoes", "id": 1, "level": 4}]
            },
        },
    ],
    "homes": [],
}

DAILY_NOTE = {
    "current_resin": 142,
    "max_resin": 200,
    "resin_recovery_time": "27840",
    "finished_task_num": 4,
    "total_task_num": 4,
    "is_extra_task_reward_received": True,
    "remain_resin_discount_num": 1,
    "resin_discount_num_limit": 3,
    "max_expedition_num": 5,
    "expeditions": [
        {"avatar_side_icon": "", "status": "Finished", "remained_time": "0"},
        {"avatar_side_icon": "", "status": "Ongoing", "remained_time": "3600"},
    ],
    "current_home_coin": 1800,
    "max_home_coin": 2400,
    "home_coin_recovery_time": "21600",
    "archon_quest_progress": {
        "list": [
            {"id": 7102, "status": "StatusOngoing", "chapter_num": "Chapter VII: Act II", "chapter_title": "Sample"},
            {"id": 7103, "status": "StatusNotOpen", "chapter_num": "Chapter VII: Act III", "chapter_title": "Sample"},
        ],
        "is_open_archon_quest": True,
        "is_finish_all_mainline": False,
        "is_finish_all_interchapter": True,
    },
}

AMBER_ICON = "https://upload-os-bbs.mihoyo.com/game_record/genshin/character_side_icon/UI_AvatarIcon_Side_Ambor.png"
NOELLE_ICON = "https://upload-os-bbs.mihoyo.com/game_record/genshin/character_side_icon/UI_AvatarIcon_Side_Noel.png"
# The notes with each expedition's picture, the Parametric Transformer and realm currency's time to full.
DAILY_NOTE_FULL = {
    **DAILY_NOTE,
    "max_expedition_num": 5,
    "expeditions": [
        {"avatar_side_icon": AMBER_ICON, "status": "Finished", "remained_time": "0"},
        {"avatar_side_icon": NOELLE_ICON, "status": "Ongoing", "remained_time": "7200"},
    ],
    "transformer": {
        "obtained": True, "recovery_time": {"Day": 3, "Hour": 4, "Minute": 0, "Second": 0, "reached": False},
    },
    "current_home_coin": 1800,
    "max_home_coin": 2400,
    "home_coin_recovery_time": "36000",
}

CHARACTER_LIST = {
    "list": [
        {"id": 10000002, "name": "Kamisato Ayaka", "element": "Cryo", "rarity": 5, "level": 90, "fetter": 10},
        {"id": 10000021, "name": "Amber", "element": "Pyro", "rarity": 4, "level": 40, "fetter": 6},
        {"id": 10000089, "name": "Furina", "element": "Hydro", "rarity": 5, "level": 90, "fetter": 8},
    ]
}

# 2026-09-16 03:00:00 UTC to 2026-10-16 02:59:59 UTC
SPIRAL_ABYSS = {
    "schedule_id": 120,
    "start_time": "1789527600",
    "end_time": "1792119599",
    "total_battle_times": 12,
    "total_win_times": 12,
    "max_floor": "12-3",
    "total_star": 36,
    "is_unlock": True,
    "floors": [],
}

# The October season (2026-10-01 03:00:00 UTC to 2026-11-01 02:59:59 UTC) and the September one.
ROLE_COMBAT = {
    "is_unlock": True,
    "data": [
        {
            "has_data": True,
            "has_detail_data": False,
            "stat": {"difficulty_id": 3, "max_round_id": 8, "medal_num": 8},
            "schedule": {"schedule_id": 29, "start_time": 1788231600, "end_time": 1790823599, "schedule_type": 2},
        },
        {
            "has_data": True,
            "has_detail_data": True,
            "stat": {"difficulty_id": 4, "max_round_id": 10, "medal_num": 10},
            "schedule": {"schedule_id": 30, "start_time": 1790823600, "end_time": 1793501999, "schedule_type": 1},
        },
    ],
}

HARD_CHALLENGE = [
    {
        "schedule": {
            "schedule_id": 11, "name": "Older Season", "start_time": "1788231600", "end_time": "1790823599",
            "is_valid": True,
        },
        "single": {"has_data": True, "best": {"difficulty": 4, "second": 240, "icon": ""}, "challenge": []},
        "mp": {"has_data": False, "best": None, "challenge": []},
    },
    {
        "schedule": {
            "schedule_id": 12, "name": "Sample Season", "start_time": "1790823600", "end_time": "1793501999",
            "is_valid": True,
        },
        "single": {"has_data": True, "best": {"difficulty": 5, "second": 184, "icon": ""}, "challenge": []},
        "mp": {"has_data": False, "best": None, "challenge": []},
    },
    {
        "schedule": {"schedule_id": 0, "name": "", "start_time": "9999999999", "end_time": "0", "is_valid": False},
        "single": {"has_data": False},
        "mp": {"has_data": False},
    },
]

MONTH_INFO_OCT = {
    "uid": 700000001,
    "region": "os_euro",
    "nickname": "Traveler",
    "data_month": 10,
    "month_data": {
        "current_primogems": 3180,
        "current_mora": 2500000,
        "last_primogems": 7340,
        "last_mora": 9000000,
        "primogem_rate": -56,
        "mora_rate": -72,
        "group_by": [
            {"action_id": 2, "action": "Daily Activity", "num": 780, "percent": 25},
            {"action_id": 1, "action": "Events", "num": 1240, "percent": 39},
            {"action_id": 0, "action": "Other", "num": 0, "percent": 0},
            {"action_id": 3, "action": "Quests", "num": 1160, "percent": 36},
        ],
    },
    "day_data": {"current_primogems": 60, "current_mora": 120000},
}

MONTH_INFO_SEP = {
    "uid": 700000001,
    "region": "os_euro",
    "nickname": "Traveler",
    "data_month": 9,
    "month_data": {"current_primogems": 7340, "group_by": [{"action_id": 1, "action": "Events", "num": 7340}]},
    "day_data": {"current_primogems": 0, "current_mora": 0},
}

MONTH_INFO_AUG = {
    "uid": 700000001,
    "region": "os_euro",
    "nickname": "Traveler",
    "data_month": 8,
    "month_data": {"current_primogems": 5920, "group_by": [{"action_id": 1, "action": "Events", "num": 5920}]},
    "day_data": {"current_primogems": 0, "current_mora": 0},
}

ACT_CALENDAR = {
    "avatar_card_pool_list": [{"pool_id": 1}, {"pool_id": 2}],
    "weapon_card_pool_list": [{"pool_id": 3}],
    "mixed_card_pool_list": [],
    "act_list": [{"id": 1}, {"id": 2}, {"id": 3}],
    "fixed_act_list": [{"id": 9}],
}

ACCOUNTS = {
    "list": [
        {
            "game_biz": "hk4e_global", "game_uid": "700000001", "level": 60, "nickname": "Traveler",
            "region": "os_euro", "region_name": "Europe Server",
        },
        {
            "game_biz": "hkrpg_global", "game_uid": "700000009", "level": 70, "nickname": "Trailblazer",
            "region": "prod_official_eur", "region_name": "Europe Server",
        },
        {
            "game_biz": "hk4e_global", "game_uid": "800000002", "level": 45, "nickname": "Lumine",
            "region": "os_asia", "region_name": "Asia Server",
        },
    ]
}


# ---------------------------------------------------------------------------------------------------------------
# The Characters plan's reads. Trimmed and key-free, in the shape genshin.py 1.7.31 reads (character/detail, the batch
# calculator, the abyss floors, the Stygian bosses and the calendar's Theater entry). The ids are made up.

SANDRONE_ID = 10000114
AYAKA_ID = 10000002

PROPERTY_MAP = {
    "2000": {"property_type": 2000, "name": "Max HP", "icon": "", "filter_name": "HP"},
    "2001": {"property_type": 2001, "name": "ATK", "icon": "", "filter_name": "ATK"},
    "2002": {"property_type": 2002, "name": "DEF", "icon": "", "filter_name": "DEF"},
    "2": {"property_type": 2, "name": "HP", "icon": "", "filter_name": "HP"},
    "3": {"property_type": 3, "name": "HP%", "icon": "", "filter_name": "HP"},
    "4": {"property_type": 4, "name": "Base ATK", "icon": "", "filter_name": "ATK"},
    "5": {"property_type": 5, "name": "ATK", "icon": "", "filter_name": "ATK"},
    "6": {"property_type": 6, "name": "ATK%", "icon": "", "filter_name": "ATK"},
    "7": {"property_type": 7, "name": "DEF", "icon": "", "filter_name": "DEF"},
    "20": {"property_type": 20, "name": "CRIT\xa0Rate", "icon": "", "filter_name": "CRIT\xa0Rate"},
    "22": {"property_type": 22, "name": "CRIT\xa0DMG", "icon": "", "filter_name": "CRIT\xa0DMG"},
    "23": {"property_type": 23, "name": "Energy Recharge", "icon": "", "filter_name": "Energy Recharge"},
    "28": {"property_type": 28, "name": "Elemental Mastery", "icon": "", "filter_name": "Elemental Mastery"},
    "46": {"property_type": 46, "name": "Cryo DMG Bonus", "icon": "", "filter_name": "Cryo DMG Bonus"},
}


def _value(prop: int, base: str, add: str, final: str) -> dict:
    return {"property_type": prop, "base": base, "add": add, "final": final}


def _relic(pos: int, name: str, level: int, main: tuple, subs: list) -> dict:
    return {
        "id": 31510 + pos,
        "name": name,
        "icon": f"https://act-webstatic.hoyoverse.com/relic{pos}.png",
        "pos": pos,
        "pos_name": ("Flower of Life", "Plume of Death", "Sands of Eon", "Goblet of Eonothem", "Circlet of Logos")[pos - 1],
        "rarity": 5,
        "level": level,
        "set": {
            "id": 15041,
            "name": "Disenchantment in Deep Shadow",
            "affixes": [
                {"activation_number": 2, "effect": "ATK +18%.", "enabled": True},
                {"activation_number": 4, "effect": "Shadow effect.", "enabled": True},
            ],
        },
        "main_property": {"property_type": main[0], "value": main[1], "times": main[2]},
        "sub_property_list": [{"property_type": prop, "value": value, "times": times} for prop, value, times in subs],
    }


SANDRONE_DETAIL = {
    "base": {
        "id": SANDRONE_ID,
        "image": "https://act-webstatic.hoyoverse.com/sandrone-card.png",
        "side_icon": "https://act-webstatic.hoyoverse.com/sandrone-side.png",
        "icon": "https://act-webstatic.hoyoverse.com/sandrone-icon.png",
        "name": "Sandrone",
        "element": "Cryo",
        "fetter": 10,
        "level": 90,
        "rarity": 5,
        "actived_constellation_num": 2,
        "weapon": {"id": 14520, "name": "A Teaspoon of Transcendence", "icon": "", "type": 11, "rarity": 5, "level": 90},
    },
    "weapon": {
        "id": 14520,
        "name": "A Teaspoon of Transcendence",
        "icon": "https://act-webstatic.hoyoverse.com/teaspoon.png",
        "type": 11,
        "rarity": 5,
        "level": 90,
        "promote_level": 6,
        "affix_level": 1,
        "main_property": _value(4, "674", "", "674"),
        "sub_property": _value(22, "44.1%", "", "44.1%"),
    },
    "relics": [
        _relic(1, "Iridescence That Ceased Amidst Glory", 20, (2, "4780", 0),
               [(22, "21.8%", 2), (20, "10.5%", 2), (6, "9.9%", 1), (23, "5.2%", 0)]),
        _relic(2, "Sharpness That Ceased Upon Wondrous Creation", 16, (5, "258", 0),
               [(22, "13.2%", 1), (20, "7.0%", 1), (23, "11.0%", 1), (2, "538", 1)]),
        _relic(3, "Moment That Ceased Upon Waking From Grand Dreams", 20, (6, "46.6%", 0),
               [(22, "28.0%", 3), (20, "6.6%", 1), (28, "19", 0), (7, "23", 0)]),
        _relic(4, "Ovations That Ceased Upon Festivity", 20, (6, "46.6%", 0),
               [(7, "39", 1), (3, "9.9%", 1), (28, "40", 1), (5, "33", 1)]),
        _relic(5, "Pendulum That Ceased Amidst a Great Fall", 20, (20, "31.1%", 0),
               [(22, "19.4%", 2), (6, "14.0%", 2), (23, "6.5%", 0), (2, "299", 0)]),
    ],
    "constellations": [{"id": 1, "name": "Morrow After the Golden Dusk", "pos": 1, "is_actived": True}],
    "skills": [
        {"skill_id": 1, "skill_type": 1, "name": "Formule Phenomenale: Self-Evident Proposition", "level": 9,
         "icon": "https://act-webstatic.hoyoverse.com/normal.png", "desc": "", "skill_affix_list": [], "is_unlock": True},
        {"skill_id": 2, "skill_type": 2, "name": "Skill", "level": 10, "icon": "", "desc": "", "skill_affix_list": [],
         "is_unlock": True},
        {"skill_id": 3, "skill_type": 3, "name": "Burst", "level": 10, "icon": "", "desc": "", "skill_affix_list": [],
         "is_unlock": True},
    ],
    "base_properties": [
        _value(2000, "13226", "6926.4", "20152.4"),
        _value(2001, "1016", "1948.1", "2964.1"),
        _value(2002, "752", "62", "814"),
        _value(28, "0", "59", "59"),
        _value(20, "24.2%", "55.2%", "79.4%"),
        _value(22, "50%", "126.5%", "176.5%"),
        _value(23, "100%", "22.7%", "122.7%"),
    ],
    "extra_properties": [],
    "element_properties": [_value(46, "0%", "0%", "0%")],
    "selected_properties": [_value(2000, "13226", "6926.4", "20152.4"), _value(2001, "1016", "1948.1", "2964.1")],
}

AYAKA_DETAIL = {
    "base": {
        "id": AYAKA_ID, "image": "", "icon": "https://act-webstatic.hoyoverse.com/ayaka-icon.png",
        "name": "Kamisato Ayaka", "element": "Cryo", "fetter": 10, "level": 80, "rarity": 5,
        "actived_constellation_num": 0, "weapon": {},
    },
    "weapon": {
        "id": 11509, "name": "Mistsplitter Reforged", "icon": "", "type": 1, "rarity": 5, "level": 80, "promote_level": 5,
        "affix_level": 2, "main_property": _value(4, "608", "", "608"), "sub_property": None,
    },
    "relics": [],
    "constellations": [],
    "skills": [
        {"skill_id": 11, "skill_type": 1, "name": "Kamisato Art: Kabuki", "level": 6, "icon": "", "desc": "",
         "skill_affix_list": [], "is_unlock": True},
    ],
    "base_properties": [_value(2001, "950", "300", "1250")],
    "extra_properties": [],
    "element_properties": [],
    "selected_properties": [],
}

CHARACTER_DETAIL = {
    "list": [SANDRONE_DETAIL, AYAKA_DETAIL],
    "property_map": PROPERTY_MAP,
    "relic_property_options": {},
    "relic_wiki": {},
    "weapon_wiki": {},
    "avatar_wiki": {str(SANDRONE_ID): "https://wiki.hoyolab.com/pc/genshin/entry/10920"},
}


def _material(id: int, name: str, amount: int, lacking=None) -> dict:
    item = {"id": id, "name": name, "icon": f"https://act-webstatic.hoyoverse.com/m{id}.png", "level": 4, "num": amount,
            "wiki_url": ""}
    if lacking is not None:
        item["lack_num"] = lacking
    return item


def _batch_compute(has_user_info: bool) -> dict:
    """The batch calculator's answer for Sandrone's talent 9 to 10 and her level, with sync on or off. With it off the
    materials carry no lack_num and HoYoLAB says has_user_info is false."""

    def lack(number: int):
        return number if has_user_info else None

    mora = _material(202, "Mora", 700000, lack(200000))
    books = _material(104319, "Philosophies of Vagrancy", 16, lack(0))
    return {
        "items": [
            {
                "avatar_consume": [_material(202, "Mora", 1000000, lack(0))],
                "weapon_consume": [],
                "skills_consume": [
                    {"skill_info": {"id": 1, "level_current": 9, "level_target": 10}, "consume_list": [mora, books]}
                ],
                "reliquary_consume": [],
            }
        ],
        "available_material": [_material(202, "Mora", 800000)] if has_user_info else [],
        "overall_consume": [_material(202, "Mora", 1700000, lack(200000)), books],
        "overall_material_consume": {},
        "single_role_result": [
            {"items": [], "overall_consume": [_material(202, "Mora", 1700000, lack(200000)), books],
             "has_user_info": has_user_info}
        ],
        "has_user_info": has_user_info,
    }


BATCH_COMPUTE = _batch_compute(True)
BATCH_COMPUTE_SYNC_OFF = _batch_compute(False)


# The abyss with its floors: floor 12, chamber 3 played in both halves (2 stars), and chamber 2 played in the first only.
def _avatar(ident: int, name_level: int = 90) -> dict:
    return {"id": ident, "icon": "", "level": name_level, "rarity": 5}


SPIRAL_ABYSS_FLOORS = {
    **SPIRAL_ABYSS,
    "floors": [
        {
            "index": 12, "icon": "", "is_unlock": True, "settle_time": "0", "star": 5, "max_star": 9,
            "levels": [
                {
                    "index": 2, "star": 3, "max_star": 3,
                    "top_half_floor_monster": [{"name": "Thunder Manifestation", "icon": "", "level": 100}],
                    "bottom_half_floor_monster": [],
                    "battles": [{"index": 1, "timestamp": "1790000000", "avatars": [_avatar(10000002), _avatar(10000089)]}],
                },
                {
                    "index": 3, "star": 2, "max_star": 3,
                    "top_half_floor_monster": [{"name": "Ruin Serpent", "icon": "", "level": 100}],
                    "bottom_half_floor_monster": [
                        {"name": "Primordial Construct", "icon": "", "level": 100},
                        {"name": "Hydro Cicin Mage", "icon": "", "level": 100},
                    ],
                    "battles": [
                        {"index": 1, "timestamp": "1790000100", "avatars": [_avatar(10000002), _avatar(10000089)]},
                        {"index": 2, "timestamp": "1790000200", "avatars": [_avatar(10000021), _avatar(10000114)]},
                    ],
                },
            ],
        },
        {"index": 11, "is_unlock": True, "star": 0, "max_star": 9, "levels": [{"index": 1, "star": 0, "max_star": 3, "battles": []}]},
    ],
}

ROLE_COMBAT_ENDS = 1793501999  # the October season's end, as the latest played season of ROLE_COMBAT

# The Stygian Onslaught's latest season, with two bosses: the first weak to Cryo and Dendro, strong against Hydro and
# Pyro (HoYoLAB writes an element as a sprite in the tag's text).
HARD_CHALLENGE_BOSSES = [
    {
        "schedule": {
            "schedule_id": 12, "name": "Sample Season", "start_time": "1790823600", "end_time": "1793501999",
            "is_valid": True,
        },
        "single": {
            "has_data": True,
            "best": {"difficulty": 5, "second": 184, "icon": ""},
            "challenge": [
                {
                    "name": "Boss One", "second": 90,
                    "teams": [{"avatar_id": 10000002}, {"avatar_id": 10000089}],
                    "best_avatar": [],
                    "monster": {
                        "monster_id": 1, "name": "Boss One", "level": 90, "icon": "", "desc": [],
                        "tags": [
                            {"type": 1, "desc": "Weak to {SPRITE_PRESET#11001} and {SPRITE_PRESET#11007}"},
                            {"type": 0, "desc": "Resists {SPRITE_PRESET#11002}{SPRITE_PRESET#11003}"},
                        ],
                    },
                },
                {
                    "name": "Boss Two", "second": 94,
                    "teams": [{"avatar_id": 10000114}],
                    "best_avatar": [],
                    "monster": {"monster_id": 2, "name": "Boss Two", "level": 90, "icon": "", "desc": [], "tags": []},
                },
            ],
        },
        "mp": {"has_data": False, "best": None, "challenge": []},
    },
]

# The calendar's two challenge entries and a pool of each kind. Descriptions carry the text with an escaped newline.
ACT_CALENDAR_DETAIL = {
    "avatar_card_pool_list": [
        {
            "pool_id": 1, "pool_name": "Epitome Invocation", "start_timestamp": 1790000000, "end_timestamp": 1791000000,
            "avatars": [
                {"id": 10000114, "name": "Sandrone", "element": "Cryo", "rarity": 5},
                {"id": 10000021, "name": "Amber", "element": "Pyro", "rarity": 4},
            ],
        },
        {
            "pool_id": 2, "pool_name": "Second", "start_timestamp": 1791000000, "end_timestamp": 1792000000,
            "avatars": [{"id": 10000052, "name": "Raiden Shogun", "element": "Electro", "rarity": 5}],
        },
    ],
    "weapon_card_pool_list": [{"pool_id": 3, "weapon": [{"id": 1, "name": "A Weapon", "rarity": 5}], "start_timestamp": 1, "end_timestamp": 2}],
    "mixed_card_pool_list": [],
    "act_list": [{"id": 1, "name": "An Event", "desc": "Fun."}],
    "fixed_act_list": [
        {"id": 8, "name": "Spiral Abyss", "desc": "Floors 1 to 12.", "strategy": "", "tower_detail": {"is_unlock": True}},
        {
            "id": 9, "name": "Imaginarium Theater", "desc": "Cryo, Pyro and Anemo characters are boosted.\\nOpens daily.",
            "strategy": "", "role_combat_detail": {"is_unlock": True, "max_round_id": 8, "has_data": True},
        },
    ],
}
