import json
from dataclasses import asdict

from guildboard.records import (
    GROUPS,
    Area,
    DataSwitchOff,
    DiaryMonth,
    DiaryRecord,
    DiarySource,
    EndgameMode,
    EndgameRecord,
    LoginNeeded,
    Offering,
    Offline,
    OverviewRecord,
    RateLimited,
    Region,
    SourceError,
    Unexpected,
    VerificationNeeded,
)


def test_groups_are_in_fetch_order():
    assert GROUPS == ("overview", "notes", "characters", "endgame", "diary", "calendar")


def test_source_errors_carry_their_kind():
    kinds = {
        LoginNeeded: "login_needed",
        VerificationNeeded: "verification_needed",
        DataSwitchOff: "switch_off",
        Offline: "offline",
        RateLimited: "rate_limited",
        Unexpected: "error",
    }
    for error_class, kind in kinds.items():
        error = error_class("something happened")
        assert isinstance(error, SourceError)
        assert error.kind == kind
        assert str(error) == "something happened"


def test_records_turn_into_plain_json():
    overview = OverviewRecord(
        nickname="Traveler",
        server="os_euro",
        adventure_rank=60,
        counters={"achievements": 1318.0},
        regions=(Region(8, 0, "Sumeru", 93.0, "", (Offering("Tree of Dreams", 50),), (Area("Rainforest", 100.0),)),),
        abyss_progress="12-3",
    )
    text = json.dumps(asdict(overview))
    assert json.loads(text)["regions"][0]["areas"][0] == {"name": "Rainforest", "pct": 100.0}

    endgame = EndgameRecord((EndgameMode("abyss", "Spiral Abyss", True, "36 of 36 stars", 36.0, None, None, ""),))
    assert json.loads(json.dumps(asdict(endgame)))["modes"][0]["score"] == 36.0

    diary = DiaryRecord((DiaryMonth(2026, 10, 3180, (DiarySource("Events", 1240),)),))
    assert json.loads(json.dumps(asdict(diary)))["months"][0]["sources"][0]["amount"] == 1240
