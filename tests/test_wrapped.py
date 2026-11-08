"""The year model (the Stats design, section 6): every fact the year's data gives, scored for the player, the character
of the year, the cards chosen and the poster. The year's data is built in code with the numbers of the player's 2026
that the accepted mockup shows (`wrapped-year.html`); the store is used only where the loader itself is tested."""
import json
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.gameday import game_day_start
from guildboard.history import History
from guildboard.metrics import Point
from guildboard.pulls.rules import Wish, pool_state
from guildboard.store import LedgerRow, ProgressRow, WishRow
from guildboard.views import wrapped
from guildboard.views.wrapped import (
    FACTS, Cycle, Fact, Five, Person, Profile, Span, YearData, build_year, character_of_year, choose, year_data,
    year_facts, year_list,
)
from support import FakeSleep

UID = 700000001
SERVER = "os_euro"
EURO = timezone(timedelta(hours=1))
SANDRONE, FLINS, COLUMBINA = 10000133, 10000120, 10000125
PROFILE = Profile(name="Traveler", ar=60, server="Europe")


# ---------------------------------------------------------------------------------------------- the player's 2026


def five(name: str, day: date, pity: int | None, kind: str = "character", order: int | None = None) -> Five:
    return Five(name, kind, day, order if order is not None else day.toordinal() * 100, pity, f"/api/icon/{name}")


FIVES_2026 = (
    five("Columbina", date(2026, 1, 16), 75, order=1),
    five("Skyward Blade", date(2026, 1, 16), 41, "weapon", order=2),
    five("Nocturne's Curtain Call", date(2026, 1, 16), 12, "weapon", order=3),
    five("Ineffa", date(2026, 1, 16), 60, order=4),
    five("Tighnari", date(2026, 2, 3), 70, order=5),
    five("Flins", date(2026, 2, 25), 66, order=6),
    five("Skyward Spine", date(2026, 2, 25), 74, "weapon", order=7),
    five("Sandrone", date(2026, 7, 1), 40, order=8),
    five("A Teaspoon of Transcendence", date(2026, 7, 1), 63, "weapon", order=9),
    five("Qiqi", date(2026, 7, 1), 6, order=10),
    five("Sandrone", date(2026, 7, 1), 22, order=11),
    five("Sandrone", date(2026, 7, 1), 9, order=12),
    five("Tighnari", date(2026, 8, 2), 62, order=13),
    five("Jean", date(2026, 8, 12), 71, order=14),
    five("Odette", date(2026, 8, 12), 8, order=15),
    five("Qiqi", date(2026, 9, 2), 55, order=16),
)
WISH_MONTHS_2026 = {1: 268, 2: 141, 3: 0, 4: 0, 5: 0, 6: 11, 7: 300, 8: 199, 9: 21, 10: 50, 11: 13}
RESIN_2026 = {
    "Item crafting material": 12960,
    "Trounce Blossom challenge reward": 5550,
    "Revitalized Petrified Tree (Domain)": 5220,
    "Ley Line Blossom challenge reward": 4240,
    '"Stygian Onslaught" Challenge Rewards': 3580,
}
ABYSS_124 = {
    "stars": 36,
    "halves": [
        {"chamber": "12-1", "half": 1, "stars": 3, "characters": [COLUMBINA, 10000116, 10000043, FLINS]},
        {"chamber": "12-1", "half": 2, "stars": 3, "characters": [10000058, 10000150, 10000035, SANDRONE]},
        {"chamber": "12-2", "half": 1, "stars": 3, "characters": [COLUMBINA, 10000116, 10000043, FLINS]},
        {"chamber": "12-2", "half": 2, "stars": 3, "characters": [10000058, 10000150, 10000035, SANDRONE]},
    ],
    "ranks": [
        {"kind": "strike", "value": 1352944, "avatar_id": SANDRONE, "icon": ""},
        {"kind": "defeats", "value": 22, "avatar_id": SANDRONE, "icon": ""},
        {"kind": "bursts", "value": 13, "avatar_id": 10000107, "icon": ""},
    ],
}
PEOPLE = {
    SANDRONE: Person("Sandrone", "/api/art/sandrone-face", "/api/art/sandrone"),
    FLINS: Person("Flins", "/api/art/flins-face", "/api/art/flins"),
    COLUMBINA: Person("Columbina", None, None),
}


def data_2026(**changes) -> YearData:
    """The player's 2026 as the mockup counts it, seen on 30 November: wishes all year, the game's logs from 1 May, the
    sessions from 19 October and the Abyss from the cycle of 16 October."""
    today = date(2026, 11, 30)
    data = YearData(
        year=2026,
        today=today,
        profile=PROFILE,
        spans={
            "wishes": Span(date(2026, 1, 1), date(2026, 11, 28)),
            "primogems": Span(date(2026, 5, 1), today),
            "ledger": Span(date(2026, 5, 1), today),
            "resin": Span(date(2026, 5, 1), today),
            "artifacts": Span(date(2026, 5, 1), today),
            "sessions": Span(date(2026, 10, 19), today),
            "abyss": Span(date(2026, 10, 16), today),
        },
        wish_months=WISH_MONTHS_2026,
        fives=FIVES_2026,
        primogem_months={5: 13000, 6: 14000, 7: 15000, 8: 16000, 9: 15000, 10: 16201, 11: 9000},
        primogem_sources={
            "Events": 30111, "Blessing of the Welkin Moon": 15750, "Daily commissions": 12000, "Other": 40340,
        },
        welkin=15750,
        resin=RESIN_2026,
        artifacts_in=1915,
        artifacts_used=1723,
        fed=3303,
        salvaged=1587,
        longest_session=(454, date(2026, 11, 6)),
        cycles=(Cycle("abyss", date(2026, 11, 16), ABYSS_124),),
        people=PEOPLE,
    )
    return replace(data, **changes)


def data_2025() -> YearData:
    """The player's 2025: wishes from 13 October to the year's end, and nothing else."""
    return YearData(
        year=2025,
        today=date(2026, 11, 30),
        profile=PROFILE,
        spans={"wishes": Span(date(2025, 10, 13), date(2025, 12, 31))},
        wish_months={10: 1, 11: 0, 12: 237},
        fives=(
            five("Durin", date(2025, 12, 3), 70, order=1),
            five("Athame Artis", date(2025, 12, 3), 40, "weapon", order=2),
            five("Xilonen", date(2025, 12, 24), 51, order=3),
        ),
    )


def kinds(year: dict) -> list[str]:
    return [card["kind"] for card in year["cards"]]


def card(year: dict, kind: str) -> dict:
    return next(c for c in year["cards"] if c["kind"] == kind)


# ---------------------------------------------------------------------------------------------- the year chosen


def test_the_players_2026_picks_the_mockups_cards():
    year = build_year(data_2026())
    assert year["hero"]["character"] == {"name": "Sandrone", "picture": "/api/art/sandrone"}
    mockup = {"character", "luckiest", "biggest_month", "resin", "longest_session", "artifacts", "welkin"}
    assert mockup <= set(kinds(year))
    assert len(kinds(year)) == len(set(kinds(year))) and 6 <= len(kinds(year)) <= 9
    assert kinds(year)[0] == "character"
    assert year["year"] == 2026 and year["so_far"] is True


def test_the_words_are_the_mockups():
    year = build_year(data_2026())
    assert year["hero"]["line"] == "The year Sandrone came home three times, and the Abyss never stood a chance."
    character = card(year, "character")
    assert (character["heading"], character["big"]) == ("Character of the year", "Sandrone")
    assert character["line"] == "Three copies on 1 July, and your strongest hit in the Spiral Abyss: 1,352,944."
    luckiest = card(year, "luckiest")
    assert (luckiest["heading"], luckiest["big"]) == ("Luckiest pull", "6 wishes")
    # Five-stars in a day tells 1 July: the luckiest does not tell it a third time, nor count that day's five-stars.
    assert "five_in_a_day" in kinds(year)
    assert luckiest["line"] == "Qiqi, the quickest five-star of your year."
    assert sum("1 July" in c["line"] for c in year["cards"]) == 2
    assert FACTS["luckiest"](data_2026()).line == "Qiqi on 1 July. The same day brought four more five-stars."
    assert card(year, "biggest_month")["big"] == "July · 300 wishes"
    resin = card(year, "resin")
    assert (resin["heading"], resin["big"]) == ("Where your resin went · since 1 May", "31,550")
    assert resin["line"] == "12,960 into Condensed Resin. Favourite stop: Trounce Blossoms."
    artifacts = card(year, "artifacts")
    assert (artifacts["big"], artifacts["line"]) == (
        "1,915", "five-star artifacts picked up. Most of them, honestly, fodder."
    )
    assert card(year, "longest_session")["big"] == "7 h 34 min"
    assert card(year, "longest_session")["line"] == "6 November. Teyvat didn't let go."
    assert card(year, "welkin")["line"] == "primogems from it this year, one login at a time."


def test_a_line_claims_only_what_the_numbers_show():
    # Few of the five-star artifacts were fed or salvaged: they are not called fodder.
    artifacts = FACTS["artifacts"](data_2026(artifacts_used=300))
    assert artifacts.line == "five-star artifacts picked up."
    # The Abyss not cleared whole: the hero does not say it never stood a chance.
    cycle = Cycle("abyss", date(2026, 11, 16), {**ABYSS_124, "stars": 33})
    year = build_year(data_2026(cycles=(cycle,)))
    assert year["hero"]["line"] == "The year Sandrone came home three times."
    # Copies on different days are not said to be on one.
    spread = tuple(
        replace(f, day=date(2026, 7, 2)) if f.name == "Sandrone" and f.order == 12 else f for f in FIVES_2026
    )
    line = FACTS["character"](data_2026(fives=spread)).line
    assert line == "Three copies this year, and your strongest hit in the Spiral Abyss: 1,352,944."
    # 237 wishes of 238 are not all of them.
    assert FACTS["biggest_month"](data_2025()).line == "99% of your year's wishes in one month."
    # No other five-star that day: the luckiest says nothing of one.
    alone = tuple(f for f in FIVES_2026 if f.day != date(2026, 7, 1) or f.name == "Qiqi")
    assert FACTS["luckiest"](data_2026(fives=alone)).line == "Qiqi on 1 July, the quickest five-star of your year."
    # A five-star whose count is not known may have come quicker, or later: no "of your year".
    unknown = tuple(replace(f, pity=None) if f.name == "Skyward Spine" else f for f in alone)
    assert FACTS["luckiest"](data_2026(fives=unknown)).line == "Qiqi on 1 July."
    assert FACTS["unluckiest"](data_2026(fives=unknown)).line == "Columbina on 16 January."
    assert FACTS["unluckiest"](data_2026(fives=alone)).line == "Columbina on 16 January, the longest wait of your year."
    # Another day told by five-stars in a day: the luckiest keeps its date, without counting its own day's five-stars.
    assert wrapped._luckiest(data_2026(), told=date(2026, 2, 1)).line == (
        "Qiqi on 1 July, the quickest five-star of your year."
    )
    assert wrapped._luckiest(data_2026(fives=unknown), told=date(2026, 7, 1)).line == (
        "Qiqi, on the day of your most five-stars."
    )


def test_a_share_is_never_rounded_to_all_or_nothing():
    assert wrapped._share(1, 500) == 1
    assert wrapped._share(237, 238) == 99
    assert (wrapped._share(0, 10), wrapped._share(10, 10), wrapped._share(300, 1003)) == (0, 100, 30)


def test_an_endgame_source_under_30_days_gives_the_character_nothing():
    # The Abyss kept from 16 October, seen on 6 November: 22 days, too few to count its teams, highlights and strike.
    data = data_2026(spans={**data_2026().spans, "abyss": Span(date(2026, 10, 16), date(2026, 11, 6))})
    best = character_of_year(data)
    assert best is not None and best["name"] == "Sandrone"
    assert best["score_parts"] == {"copies": 3, "teams": 0, "highlights": 0, "points": 9}
    fact = FACTS["character"](data)
    assert fact.line == "Three copies on 1 July." and "strike" not in fact.numbers
    year = build_year(data)
    assert year["hero"]["line"] == "The year Sandrone came home three times."
    assert "strike" not in kinds(year) and "abyss" not in kinds(year)


def test_a_fact_from_part_of_the_year_says_since():
    year = build_year(data_2026())
    assert card(year, "longest_session")["heading"] == "Longest session · since 19 Oct"
    assert card(year, "luckiest")["heading"] == "Luckiest pull"  # the wishes cover the whole year
    fact = FACTS["longest_session"](data_2026())
    assert fact.since == date(2026, 10, 19)
    all_year = {**data_2026().spans, "sessions": Span(date(2026, 1, 1), date(2026, 11, 30))}
    whole = FACTS["longest_session"](data_2026(spans=all_year))
    assert whole.since is None and fact.score == pytest.approx(whole.score * wrapped.PARTIAL)


def test_a_fact_with_under_30_days_is_not_offered():
    spans = data_2026().spans
    short = data_2026(spans={**spans, "sessions": Span(date(2026, 11, 2), date(2026, 11, 30))})  # 29 days
    assert FACTS["longest_session"](short) is None
    assert "longest_session" not in [fact.kind for fact in year_facts(short)]
    enough = data_2026(spans={**spans, "sessions": Span(date(2026, 11, 1), date(2026, 11, 30))})  # 30 days
    assert FACTS["longest_session"](enough) is not None
    # A source the year does not reach at all gives nothing of its kinds.
    assert FACTS["resin"](data_2026(spans={k: v for k, v in spans.items() if k != "resin"})) is None


def test_a_thin_year():
    year = build_year(data_2025())
    assert 3 <= len(year["cards"]) < 6
    assert len(year["poster"]["numbers"]) == 4
    assert [n["label"] for n in year["poster"]["numbers"]][:2] == ["wishes", "five-stars"]
    assert all(n["since"] == "since Oct" for n in year["poster"]["numbers"])
    assert year["so_far"] is False
    # Its hero says from when, as every number of it is from part of the year.
    assert year["hero"]["line"] == "Since 13 Oct: the year Xilonen came home."
    assert year["hero"]["counters"] == [
        {"label": "wishes", "value": 238, "since": "since 13 Oct"},
        {"label": "five-stars", "value": 3, "since": "since 13 Oct"},
        {"label": "days with data", "value": 80, "since": "since 13 Oct"},
    ]


def test_an_endgame_only_year_has_four_poster_numbers_and_three_counters():
    year_long = Span(date(2026, 1, 1), date(2026, 11, 30))
    data = YearData(
        year=2026, today=date(2026, 11, 30), profile=PROFILE,
        spans={"abyss": year_long, "theater": year_long, "stygian": year_long},
        cycles=(
            Cycle("abyss", date(2026, 3, 16), ABYSS_124),
            Cycle("theater", date(2026, 4, 1), {"acts": 10, "medals": [True] * 10}),
            Cycle("stygian", date(2026, 5, 1), {"difficulty": 5, "bosses": []}),
        ),
        people=PEOPLE,
    )
    assert [fact.kind for fact in year_facts(data)] == ["character", "abyss", "theater", "stygian"]
    year = build_year(data)
    assert [(n["label"], n["value"]) for n in year["poster"]["numbers"]] == [
        ("Abyss stars", "36"), ("Theater act", "10"), ("Stygian difficulty", "5"), ("endgame cycles", "3"),
    ]
    assert year["hero"]["counters"] == [
        {"label": "endgame cycles", "value": 3, "since": None},
        {"label": "days with data", "value": 334, "since": None},
        {"label": "Abyss stars", "value": 36, "since": None},
    ]


def test_the_hero_counts_and_the_poster():
    year = build_year(data_2026())
    assert year["hero"]["counters"] == [
        {"label": "wishes", "value": 1003, "since": None},
        {"label": "five-stars", "value": 16, "since": None},
        {"label": "primogems earned", "value": 98201, "since": "since 1 May"},
    ]
    poster = year["poster"]
    assert (poster["name"], poster["ar"], poster["server"]) == ("Traveler", 60, "Europe")
    assert poster["character"] == {"name": "Sandrone", "picture": "/api/art/sandrone"}
    assert poster["numbers"] == [
        {"label": "wishes", "value": "1,003", "since": None},
        {"label": "five-stars", "value": "16", "since": None},
        {"label": "primogems earned", "value": "98,201", "since": "since May"},
        {"label": "biggest month", "value": "July", "since": None},
        {"label": "luckiest 5★ (Qiqi)", "value": "6", "since": None},
        {"label": "longest session", "value": "7 h 34", "since": "since Oct"},
    ]


def test_a_rich_year_without_one_of_the_six_still_has_six_numbers():
    # No sessions yet: five of the six are there, and the first chosen card's number is the sixth.
    data = data_2026(spans={k: v for k, v in data_2026().spans.items() if k != "sessions"})
    year = build_year(data)
    assert len(year["cards"]) >= 6
    assert [(n["label"], n["value"], n["since"]) for n in year["poster"]["numbers"]] == [
        ("wishes", "1,003", None), ("five-stars", "16", None), ("primogems earned", "98,201", "since May"),
        ("biggest month", "July", None), ("luckiest 5★ (Qiqi)", "6", None), ("five-stars in a day", "5", None),
    ]


def test_the_poster_never_holds_the_uid():
    poster = json.dumps(build_year(data_2026())["poster"])
    assert str(UID) not in poster
    assert set(build_year(data_2026())["poster"]) == {"name", "ar", "server", "character", "numbers"}


# ---------------------------------------------------------------------------------------------- the scores


def test_pity_scores_against_the_games_odds():
    assert wrapped.luck_score(6) == pytest.approx((62.5 - 6) / 62.5)
    assert wrapped.unluck_score(85) == pytest.approx((85 - 62.5) / 62.5)
    assert FACTS["luckiest"](data_2026()).score == pytest.approx((62.5 - 6) / 62.5)
    unluckiest = FACTS["unluckiest"](data_2026())
    assert unluckiest.numbers["pity"] == 75 and unluckiest.numbers["name"] == "Columbina"


def test_an_unknown_pity_is_never_lucky_or_unlucky():
    unknown = tuple(replace(f, pity=None) for f in FIVES_2026)
    assert FACTS["luckiest"](data_2026(fives=unknown)) is None
    assert FACTS["unluckiest"](data_2026(fives=unknown)) is None
    one = (five("Qiqi", date(2026, 7, 1), 6),)
    assert FACTS["unluckiest"](data_2026(fives=one)) is None  # the luckiest is the unluckiest: no second card


def test_the_biggest_month_says_which_month_the_year_has_reached():
    # The page draws a month after the core's today as nothing, and a month gone by without a number as not tracked.
    assert FACTS["biggest_month"](data_2026()).numbers["through"] == 11  # seen on 30 November
    assert FACTS["biggest_month"](data_2025()).numbers["through"] == 12  # a year gone by has reached all twelve


def test_a_month_scores_in_standard_deviations_from_the_others():
    others = [268, 141, 0, 0, 0, 11, 199, 21, 50, 13]
    mean = sum(others) / len(others)
    sd = (sum((v - mean) ** 2 for v in others) / len(others)) ** 0.5
    assert wrapped.month_score(300, others) == pytest.approx(min((300 - mean) / sd, wrapped.Z_CAP) / wrapped.Z_CAP)
    assert FACTS["biggest_month"](data_2026()).score == pytest.approx(wrapped.month_score(300, others))
    assert wrapped.month_score(5, [5, 5]) == 0


def test_totals_score_by_their_size():
    assert wrapped.total_score(1000, 1000) == pytest.approx(1.0)
    assert wrapped.total_score(100, 1000) == pytest.approx(0.0)
    assert wrapped.total_score(10_000, 1000) == pytest.approx(2.0)


def test_the_character_of_the_year_weighs_copies_teams_and_highlights():
    best = character_of_year(data_2026())
    # Sandrone: 3 copies (9), one team in the Abyss (1), the strike and the defeats (4).
    assert best == {
        "name": "Sandrone", "picture": "/api/art/sandrone",
        "score_parts": {"copies": 3, "teams": 1, "highlights": 2, "points": 14},
    }


def test_endgame_alone_can_make_the_character_of_the_year():
    data = data_2026(fives=(five("Skyward Blade", date(2026, 1, 16), 41, "weapon"),))
    best = character_of_year(data)
    assert best is not None and best["name"] == "Sandrone"
    line = FACTS["character"](data).line
    assert line == "In one of your endgame teams, and your strongest hit in the Spiral Abyss: 1,352,944."


def test_the_character_of_the_year_says_since_of_the_part_its_line_speaks_of():
    # Wishes from 11 January and the Abyss from 16 October. Teams alone speak of the endgame: its since, not the wishes'.
    spans = {**data_2026().spans, "wishes": Span(date(2026, 1, 11), date(2026, 11, 28))}
    teams = data_2026(spans=spans, fives=(five("Skyward Blade", date(2026, 1, 16), 41, "weapon"),))
    fact = FACTS["character"](teams)
    assert fact.line.startswith("In one of your endgame teams")
    assert (fact.since, fact.heading) == (date(2026, 10, 16), "Character of the year · since 16 Oct")
    assert build_year(teams)["hero"]["line"] == "Since 16 Oct: the year Sandrone stood in one of your endgame teams."
    # Copies speak of the wishes.
    copies = FACTS["character"](data_2026(spans=spans))
    assert copies.line.startswith("Three copies on 1 July")
    assert (copies.since, copies.heading) == (date(2026, 1, 11), "Character of the year · since 11 Jan")
    # Highlights alone speak of the modes that give them: here the Theater, from 1 August.
    theater = {"ranks": [{"kind": "damage", "value": 943229, "avatar_id": FLINS, "icon": ""}]}
    highlights = data_2026(
        spans={"wishes": spans["wishes"], "theater": Span(date(2026, 8, 1), date(2026, 11, 30))},
        fives=(five("Skyward Blade", date(2026, 1, 16), 41, "weapon"),),
        cycles=(Cycle("theater", date(2026, 11, 1), theater),),
    )
    led = FACTS["character"](highlights)
    assert led.big == "Flins" and led.since == date(2026, 8, 1)


def test_a_tie_goes_to_the_most_copies_then_the_most_recent_pull():
    year = Span(date(2026, 1, 1), date(2026, 11, 30))
    data = YearData(
        year=2026, today=date(2026, 11, 30), profile=PROFILE, spans={"wishes": year, "abyss": year},
        wish_months={1: 10},
        fives=(five("Flins", date(2026, 2, 1), 50, order=1),),
        # Columbina has 3 points from the endgame alone (a team and the strike), as Flins has from one copy.
        cycles=(Cycle("abyss", date(2026, 3, 16), {"stars": 30, "halves": [
            {"chamber": "12-1", "half": 1, "stars": 3, "characters": [COLUMBINA]}], "ranks": [
            {"kind": "strike", "value": 10, "avatar_id": COLUMBINA, "icon": ""}]}),),
        people={COLUMBINA: Person("Columbina", None, None)},
    )
    assert character_of_year(data)["name"] == "Flins"  # the most copies
    later = replace(data, fives=data.fives + (five("Odette", date(2026, 3, 1), 50, order=2),))
    assert character_of_year(later)["name"] == "Odette"  # one copy each: Odette was pulled last


def test_the_strike_of_the_character_of_the_year_is_no_second_card():
    assert FACTS["strike"](data_2026()) is None
    other = {**ABYSS_124, "ranks": [{"kind": "strike", "value": 1352944, "avatar_id": FLINS, "icon": ""}]}
    strike = FACTS["strike"](data_2026(cycles=(Cycle("abyss", date(2026, 11, 16), other),)))
    assert strike is not None and strike.big == "1,352,944" and strike.faces == ("/api/art/flins-face",)


# ---------------------------------------------------------------------------------------------- the choice


def fact(kind: str, score: float) -> Fact:
    return Fact(kind, score, None, kind, "1", "", (), {})


def test_choose_never_repeats_a_kind_and_spreads_the_kinds():
    facts = [
        fact("luckiest", 0.99), fact("unluckiest", 0.98), fact("biggest_month", 0.97), fact("five_in_a_day", 0.96),
        fact("resin", 0.7), fact("longest_session", 0.69), fact("abyss", 0.68), fact("welkin", 0.67),
        fact("artifacts", 0.66), fact("theater", 0.65),
    ]
    chosen = [f.kind for f in choose(facts)]
    # Three of the pulls while others remain, the highest first.
    assert chosen[:3] == ["luckiest", "unluckiest", "biggest_month"]
    assert "five_in_a_day" not in chosen and len(chosen) == 9
    # Once nothing else remains, a fourth of the pulls is taken.
    assert [f.kind for f in choose(facts[:5])] == ["luckiest", "unluckiest", "biggest_month", "five_in_a_day", "resin"]


def test_choose_takes_weak_facts_only_to_reach_six():
    facts = [fact("luckiest", 0.9), fact("resin", 0.8), fact("abyss", 0.2), fact("favourite_hour", 0.1),
             fact("longest_session", 0.7), fact("welkin", 0.6), fact("theater", 0.05)]
    chosen = [f.kind for f in choose(facts)]
    assert chosen == ["luckiest", "resin", "longest_session", "welkin", "abyss", "favourite_hour"]
    assert len(choose(facts[:3])) == 3


def test_siblings_are_shown_together_only_to_reach_six():
    facts = [fact("resin", 0.9), fact("condensed", 0.85), fact("artifacts", 0.8), fact("fed", 0.75),
             fact("luckiest", 0.7), fact("longest_session", 0.6), fact("abyss", 0.55), fact("theater", 0.52)]
    chosen = [f.kind for f in choose(facts)]
    assert "condensed" not in chosen and "fed" not in chosen and len(chosen) == 6


# ---------------------------------------------------------------------------------------------- the store


def at(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EURO).astimezone(timezone.utc)


_ids = iter(range(1, 1_000_000))


def import_run(store, finished: str = "2026-11-05 12:00:00") -> int:
    run = store.start_wish_import(at(finished) - timedelta(minutes=1))
    store.finish_wish_import(run, at(finished), "ok", UID, 0, 1, None, ())
    return run


def add_wishes(store, when: str, count: int, *, rank: int = 3, name: str = "Item", pool: str = "character") -> None:
    run = import_run(store)
    gacha = {"character": "301", "weapon": "302", "standard": "200"}[pool]
    start = datetime.strptime(when, "%Y-%m-%d %H:%M:%S")
    store.add_wishes([
        WishRow(next(_ids), UID, gacha, pool, name, "Character", rank,
                (start + timedelta(seconds=n)).strftime("%Y-%m-%d %H:%M:%S"),
                at((start + timedelta(seconds=n)).strftime("%Y-%m-%d %H:%M:%S")), run)
        for n in range(count)
    ])


def states_of(store) -> dict:
    rows = store.wishes(UID)
    return {
        pool: pool_state(
            pool, [Wish(r.id, r.pool, r.gacha_type, r.name, "character", r.rank, r.at, r.import_id) for r in rows
                   if r.pool == pool], window_start=None, correction=None,
        )
        for pool in ("character", "weapon", "standard", "chronicled", "novice")
    }


def load(store, year: int, today: date = date(2026, 11, 6)) -> YearData:
    now = game_day_start(today, SERVER) + timedelta(hours=12)
    return year_data(store, History(store), UID, SERVER, year, today, states_of(store), now, PROFILE)


def listed(store, today: date = date(2026, 11, 6)) -> list[int]:
    now = game_day_start(today, SERVER) + timedelta(hours=12)
    return year_list(store, History(store), UID, SERVER, today, states_of(store), now, PROFILE)


def test_a_year_needs_three_facts_to_be_listed(store):
    # 2024: wishes from 20 December only, under 30 days of the year: no fact.
    add_wishes(store, "2024-12-20 10:00:00", 5)
    # 2025: wishes from October, with a five-star: the character, the luckiest and the biggest month.
    add_wishes(store, "2025-10-13 10:00:00", 1)
    add_wishes(store, "2025-12-03 12:00:00", 30)
    add_wishes(store, "2025-12-03 13:00:00", 1, rank=5, name="Durin")
    assert listed(store) == [2025]
    assert len(year_facts(load(store, 2025))) >= 3 and len(year_facts(load(store, 2024))) < 3


def test_the_year_is_read_in_game_days(store):
    # Two wishes at 02:00 on 1 January belong to the game day before: to 2025.
    add_wishes(store, "2025-10-13 10:00:00", 1)
    add_wishes(store, "2026-01-01 02:00:00", 2)
    add_wishes(store, "2026-01-01 05:00:00", 3)
    add_wishes(store, "2026-07-01 09:38:51", 1, rank=5, name="Sandrone")
    data = load(store, 2026)
    assert sum(data.wish_months.values()) == 4 and data.wish_months[1] == 3 and data.wish_months[7] == 1
    assert data.spans["wishes"] == Span(date(2026, 1, 1), date(2026, 11, 5))
    # Its pity is the Pulls page's: every wish of the pool since the history starts, itself included.
    assert [(f.name, f.day, f.pity) for f in data.fives] == [("Sandrone", date(2026, 7, 1), 7)]
    assert sum(load(store, 2025).wish_months.values()) == 3


def test_the_logs_of_the_year(store):
    entries = [
        ("resin", "2026-04-30 08:59:32", -20, "Ley Line Blossom challenge reward", "", 0),
        ("resin", "2026-05-02 10:00:00", -40, "Item crafting material", "", 0),
        ("resin", "2026-05-03 10:00:00", -40, "Trounce Blossom challenge reward", "", 0),
        ("resin", "2026-11-06 12:00:00", -20, "Revitalized Petrified Tree (Domain)", "", 0),
        ("artifact", "2026-04-30 09:00:00", 1, "Revitalized Petrified Tree (Domain)", "Flower", 5),
        ("artifact", "2026-05-02 10:00:00", 1, "Revitalized Petrified Tree (Domain)", "Flower", 5),
        ("artifact", "2026-05-02 10:01:00", 1, "Revitalized Petrified Tree (Domain)", "Plume", 5),
        ("artifact", "2026-05-02 10:02:00", 1, "Revitalized Petrified Tree (Domain)", "Plume", 4),
        ("artifact", "2026-05-03 10:00:00", -1, "Artifact enhancement material", "Flower", 5),
        ("artifact", "2026-05-03 10:01:00", -1, "Artifact decomposition", "Plume", 4),
        ("primogem", "2026-04-30 08:59:00", 90, "Blessing of the Welkin Moon daily reward", "", 0),
        ("primogem", "2026-05-02 05:00:00", 90, "Blessing of the Welkin Moon daily reward", "", 0),
        ("primogem", "2026-05-03 05:00:00", 90, "Blessing of the Welkin Moon daily reward", "", 0),
        ("primogem", "2026-05-03 06:00:00", 60, "Daily Commission reward", "", 0),
        ("primogem", "2026-11-06 05:00:00", 90, "Blessing of the Welkin Moon daily reward", "", 0),
    ]
    store.keep_ledger_entries(
        LedgerRow(UID, kind, next(_ids), time, at(time), amount, reason, name, rarity)
        for kind, time, amount, reason, name, rarity in entries
    )
    data = load(store, 2026)
    # The logs cover whole days from the day after their oldest entry.
    assert data.spans["resin"] == Span(date(2026, 5, 1), date(2026, 11, 6))
    assert data.spans["artifacts"].first == date(2026, 5, 1)
    assert data.resin == {"Item crafting material": 40, "Trounce Blossom challenge reward": 40,
                          "Revitalized Petrified Tree (Domain)": 20}
    assert (data.artifacts_in, data.artifacts_used, data.fed, data.salvaged) == (2, 1, 1, 1)
    assert data.welkin == 270
    assert sum(data.primogem_months.values()) == 330


def test_imported_achievements_count_in_no_year(store):
    imported = at("2026-10-20 19:43:13")
    store.add_import("astra", "save.json", "f1", {}, imported)
    store.put_progress([
        *(ProgressRow(i, "done", imported, False, "", "astra", imported) for i in (1, 2, 3)),
        ProgressRow(10, "done", at("2026-10-21 10:00:00"), False, "", "player", at("2026-10-21 10:00:00")),
        ProgressRow(11, "done", at("2026-10-25 10:00:00"), False, "", "player", at("2026-10-25 10:00:00")),
        ProgressRow(12, "done", imported, False, "", "player", at("2026-10-22 10:00:00")),
    ])
    store.add_points(None, game_day_start(date(2026, 9, 1), SERVER) + timedelta(hours=1), date(2026, 9, 1),
                     [Point("stats.days_active", 1.0)])
    data = load(store, 2026)
    assert data.achievements == 2
    assert data.spans["achievements"].first == date(2026, 9, 1)
    assert FACTS["achievements"](data).numbers["done"] == 2


def test_the_endgame_cycles_of_the_year(store):
    from guildboard.store import EndgameCycleRow

    read = at("2026-11-06 12:00:00")
    store.put_endgame_cycle(EndgameCycleRow("abyss", "124", "2026-10-16T03:00:00+00:00", "2026-11-16T02:59:59+00:00",
                                            ABYSS_124, read))
    store.put_endgame_cycle(EndgameCycleRow("theater", "29", "2026-09-01T03:00:00+00:00", "2026-10-01T02:59:59+00:00",
                                            {"acts": 10, "medals": [True] * 8 + [False] * 2}, read))
    # A season that ended at 04:30 on 1 January 2026, server time: on that game day.
    store.put_endgame_cycle(EndgameCycleRow("theater", "1", "2025-12-01T03:00:00+00:00", "2026-01-01T03:30:00+00:00",
                                            {"acts": 8}, read))
    data = load(store, 2026)
    # The open cycle counts on the day it is read, today; an ended one on the game day it ended.
    assert sorted((c.mode, c.day) for c in data.cycles) == [
        ("abyss", date(2026, 11, 6)), ("theater", date(2026, 1, 1)), ("theater", date(2026, 9, 30)),
    ]
    assert data.spans["abyss"] == Span(date(2026, 10, 16), date(2026, 11, 6))
    assert data.spans["theater"].first == date(2026, 1, 1)


# ---------------------------------------------------------------------------------------------- the core and the API


@pytest.fixture
def core(tmp_path, clock):
    core = Core(
        AppPaths(tmp_path / "data"), demo=True, clock=clock, source=None, sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    yield core
    core.store.close()


@pytest.fixture
def client(core):
    with TestClient(create_app(core, 4321), base_url="http://127.0.0.1:4321") as client:
        response = client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        assert response.status_code == 303
        yield client


def test_an_unknown_year_falls_back_to_the_newest(client, core):
    client.post("/api/sync")
    newest = client.get("/api/stats/year").json()
    assert newest["years"], "the demo has a year for Wrapped"
    assert newest["year"]["year"] == newest["years"][-1]
    assert newest["current_year"] == core.today().year  # the core's own year: the tab marks "so far" from it
    assert newest["year"]["so_far"] == (newest["year"]["year"] == newest["current_year"])
    for year in ("1999", "banana", "", "20260"):
        assert client.get("/api/stats/year", params={"year": year}).json()["year"]["year"] == newest["years"][-1]
    oldest = newest["years"][0]
    assert client.get("/api/stats/year", params={"year": oldest}).json()["year"]["year"] == oldest
    assert str(core.ledger_uid()) not in json.dumps(newest["year"]["poster"])
    assert newest["year"]["poster"]["name"] == "Traveler"
