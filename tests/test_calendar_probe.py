"""The calendar probe: it counts what HoYoLAB's event calendar holds and prints no value of it."""
import copy
import logging

import pytest
from hoyolab_samples import ACT_CALENDAR_DETAIL

from guildboard import config
from guildboard.records import FetchResult, Offline, RawResponse
from guildboard.sources import calendar_probe, hoyolab
from guildboard.tokenstore import StoredToken, TokenStore

COOKIE_VALUE = "PLANTED-COOKIE-VALUE"  # made up: plainly not a token
UID = 700000001
ICON = "https://act-webstatic.hoyoverse.com/PLANTED/path.png"
OTHER_ICON = "https://cdn.example.invalid/PLANTED/other.png"


def _sample() -> dict:
    """The calendar sample, with faces that have pictures, and three events the probe can count."""
    sample = copy.deepcopy(ACT_CALENDAR_DETAIL)
    sample["avatar_card_pool_list"][0]["avatars"][0]["icon"] = ICON
    sample["avatar_card_pool_list"][0]["avatars"][1]["icon"] = OTHER_ICON
    sample["weapon_card_pool_list"][0]["weapon"][0]["icon"] = ICON
    sample["act_list"] = [
        {
            "id": 1, "name": "An Event", "desc": "Fun.", "type": "ACT_TYPE_X", "status": "ACT_STATUS_RUNNING",
            "is_finished": False, "start_timestamp": 1, "end_timestamp": 2,
            "double_detail": {"left": 0, "total": 3, "is_finished": False},
        },
        {
            "id": 2, "name": "PLANTED-EVENT-NAME", "desc": "PLANTED-DESCRIPTION", "type": "ACT_TYPE_X",
            "status": "ACT_STATUS_RUNNING", "is_finished": True, "start_timestamp": "1", "end_timestamp": 4_000_000_000,
            "reward_list": [{"item_id": 201, "num": 420, "name": "PLANTED-REWARD"}],
            "explore_detail": {"is_finished": True, "explored": 0.5},
            "double_detail": {"left": 0, "total": 3, "is_finished": True},
        },
        {
            "id": 3, "name": "Another", "type": "ACT_TYPE_Y", "status": 3, "is_finished": False,
            "start_timestamp": 4_000_000_000, "end_timestamp": 4_000_100_000,
            "reward_list": [{"item_id": 202, "num": 1}],
            "explore_detail": {"is_finished": True},
        },
    ]
    return sample


def _keep_login(monkeypatch, tmp_path, token: bool = True) -> None:
    monkeypatch.setattr(config, "default_data_dir", lambda demo=False: tmp_path)
    kept = StoredToken({"ltoken_v2": COOKIE_VALUE, "cookie_token_v2": COOKIE_VALUE}, UID, "os_euro", "PLANTED-NAME")
    monkeypatch.setattr(TokenStore, "load", lambda self: kept if token else None)


def _answer(monkeypatch, sample: dict, *, unusable: bool = False) -> list[str]:
    asked: list[str] = []

    async def fetch(self, group, *, now, first_time=False):
        asked.append(group)
        if unusable:
            logging.getLogger(hoyolab.__name__).warning("the library could not use the answer to x (KeyError)")
        return FetchResult(group, now, (RawResponse("act_calendar", sample),), None)

    monkeypatch.setattr(hoyolab.HoyolabSource, "fetch", fetch)
    return asked


def test_the_probe_prints_counts_and_names_never_a_value(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)
    asked = _answer(monkeypatch, _sample())

    assert calendar_probe.main() == 0
    out = capsys.readouterr().out

    assert asked == ["calendar"]
    for planted in ("PLANTED", "420", str(UID), "cdn.example.invalid/", "Fun.", "An Event", "Sandrone"):
        assert planted not in out
    assert "/" not in out  # no address path
    assert "The library's model read the answer: yes" in out
    assert "avatar_card_pool_list: list of 2" in out and "mixed_card_pool_list: list of 0" in out
    assert "events finished: 1 of 3" in out
    assert "reward_list item fields: item_id, name, num" in out
    assert "explore_detail fields: explored, is_finished" in out
    assert "events with a reward of item 201: 1" in out
    assert "ACT_TYPE_X: 2" in out and "ACT_TYPE_Y: 1" in out and "ACT_STATUS_RUNNING: 2" in out
    assert "start_timestamp: int, str" in out and "end_timestamp: int" in out
    assert "act-webstatic.hoyoverse.com: 2 pictures, in the icon hosts: yes" in out
    assert "cdn.example.invalid: 1 pictures, in the icon hosts: no" in out
    assert "events with explore_detail: 2" in out and "both finished 1, neither 0, differ 1" in out
    assert "events with double_detail: 2" in out and "left 0 and finished 1, left 0 and not finished 1" in out
    assert "ended: 1, not started: 1" in out


def test_an_event_with_no_dates_is_undated_and_not_ended(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)
    sample = _sample()
    sample["act_list"] += [
        {"id": 4, "type": "ACT_TYPE_X", "start_timestamp": "0", "end_timestamp": "0"},  # HoYoLAB's "no date yet"
        {"id": 5, "type": "ACT_TYPE_X", "start_timestamp": 0, "end_timestamp": 0},
    ]
    _answer(monkeypatch, sample)

    assert calendar_probe.main() == 0
    assert "ended: 1, not started: 1, undated: 2" in capsys.readouterr().out


def test_a_host_outside_the_icon_hosts_is_said_so(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)
    sample = _sample()
    sample["avatar_card_pool_list"][0]["avatars"][1]["icon"] = "https://pictures.example.invalid/a.png"
    _answer(monkeypatch, sample)

    assert calendar_probe.main() == 0
    out = capsys.readouterr().out
    assert "pictures.example.invalid: 1 pictures, in the icon hosts: no" in out
    assert "a.png" not in out


def test_an_answer_the_library_could_not_use_is_said(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)
    _answer(monkeypatch, _sample(), unusable=True)

    assert calendar_probe.main() == 0
    assert "The library's model read the answer: no" in capsys.readouterr().out


def test_an_odd_word_where_an_enum_is_expected_is_not_printed(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)
    sample = _sample()
    sample["act_list"][0]["type"] = "PLANTED sentence with spaces"
    sample["act_list"][0]["extra field with spaces"] = 1
    _answer(monkeypatch, sample)

    assert calendar_probe.main() == 0
    out = capsys.readouterr().out
    assert "PLANTED" not in out and "spaces" not in out


def test_with_no_login_kept_it_says_so_and_asks_nothing(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path, token=False)
    asked = _answer(monkeypatch, _sample())

    assert calendar_probe.main() == 1
    out = capsys.readouterr().out
    assert len(out.strip().splitlines()) == 1 and "No HoYoLAB login is kept" in out
    assert asked == []


def test_a_source_error_prints_its_type_and_guild_boards_sentence(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)

    async def fetch(self, group, *, now, first_time=False):
        raise Offline("HoYoLAB could not be reached.")

    monkeypatch.setattr(hoyolab.HoyolabSource, "fetch", fetch)

    assert calendar_probe.main() == 1
    out = capsys.readouterr().out
    assert "Offline" in out and "HoYoLAB could not be reached." in out
    assert COOKIE_VALUE not in out and str(UID) not in out


def test_an_answer_that_is_not_an_object_is_one_line_and_a_failure(tmp_path, monkeypatch, capsys):
    _keep_login(monkeypatch, tmp_path)
    _answer(monkeypatch, ["PLANTED-EVENT-NAME"])  # type: ignore[arg-type]

    assert calendar_probe.main() == 1
    assert "PLANTED" not in capsys.readouterr().out


def test_the_probe_reads_the_tokens_where_the_app_keeps_them(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "default_data_dir", lambda demo=False: tmp_path)
    paths: list = []
    monkeypatch.setattr(TokenStore, "__init__", lambda self, path: paths.append(path))
    monkeypatch.setattr(TokenStore, "load", lambda self: None)

    assert calendar_probe.main() == 1
    assert paths == [config.AppPaths(tmp_path).token_path]

