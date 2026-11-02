"""The chance of the featured 5★ within the pulls, the balance that moves on, the forecast and the wishlist's chain (the
Pulls design, sections 2.3 and 6.1), worked out by hand."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from guildboard.pulls.nextversion import NextVersion, Row
from guildboard.pulls.rules import pity_distribution
from guildboard.pulls.savings import (
    Balance,
    ChainEntry,
    Estimate,
    balance_now,
    certain_within,
    chain,
    chance_within,
    convolve,
    forecast,
    income_per_day,
    pulls_to_featured,
)

D = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def mixed(featured: float, pool: str, pity: int = 0) -> list[float]:
    """`featured` × X + (1 − `featured`) × (X ⊗ X0), term by term: the featured one first, or after one miss."""
    first, after_a_miss = pity_distribution(pool, pity), convolve(pity_distribution(pool, pity), pity_distribution(pool))
    first += [0.0] * (len(after_a_miss) - len(first))
    return [featured * a + (1 - featured) * b for a, b in zip(first, after_a_miss)]


def test_convolve_adds_two_counts():
    assert convolve([0.0, 0.5, 0.5], [0.0, 1.0]) == [0.0, 0.0, 0.5, 0.5]
    assert convolve([0.0, 0.5, 0.5], [0.0, 0.5, 0.5]) == [0.0, 0.0, 0.25, 0.5, 0.25]
    assert convolve([], [1.0]) == []
    # Only its first terms, for a sum asked about no further.
    assert convolve([0.0, 0.5, 0.5], [0.0, 0.5, 0.5], size=3) == [0.0, 0.0, 0.25]
    assert convolve([0.0, 0.5, 0.5], [0.0, 0.5, 0.5], size=99) == [0.0, 0.0, 0.25, 0.5, 0.25]


def test_a_guaranteed_five_star_is_certain_at_hard_pity():
    assert chance_within(pulls_to_featured("character", 61, True), 29) == pytest.approx(1.0)
    assert chance_within(pulls_to_featured("character", 61, True), 28) < 1.0
    assert certain_within("character", 61, True) == 29
    assert certain_within("character", 0, False) == 180
    assert certain_within("weapon", 23, False) == 137
    assert certain_within("weapon", 23, False, path_points=1) == 57
    assert certain_within("weapon", 23, True) == 137  # a featured weapon is certain, the charted one is not
    assert certain_within("weapon", 23, True, charted=False) == 57
    assert certain_within("chronicled", 10, True) == 80  # its point is its guarantee
    assert certain_within("chronicled", 10, False) == 170


def test_a_fifty_fifty_is_certain_only_at_twice_hard_pity():
    distribution = pulls_to_featured("character", 0, False)
    assert len(distribution) == 2 * 90 + 1
    assert 0.55 < chance_within(distribution, 90) < 1.0
    assert chance_within(distribution, 180) == pytest.approx(1.0)


def test_the_chance_grows_with_the_pulls():
    distribution = pulls_to_featured("character", 0, False)
    chances = [chance_within(distribution, pulls) for pulls in range(1, 181)]
    assert all(earlier <= later for earlier, later in zip(chances, chances[1:]))
    assert chances[0] == pytest.approx(0.006 * 0.55)
    assert chance_within(distribution, 0) == 0.0


def test_the_character_and_chronicled_featured_rates():
    # Capturing Radiance as its consolidated 55% on the character event; the chronicled wish's chosen item at 50%.
    assert pulls_to_featured("character", 0, False) == pytest.approx(mixed(0.55, "character"))
    assert pulls_to_featured("character", 61, False) == pytest.approx(mixed(0.55, "character", 61))
    assert pulls_to_featured("character", 61, True) == pytest.approx(pity_distribution("character", 61))
    assert pulls_to_featured("chronicled", 10, False) == pytest.approx(mixed(0.5, "chronicled", 10))
    assert pulls_to_featured("chronicled", 10, True) == pytest.approx(pity_distribution("chronicled", 10))


def test_the_weapon_path_counts_half_the_featured_as_charted():
    X = pity_distribution("weapon", 0)
    two = convolve(X, X)
    assert len(pulls_to_featured("weapon", 0, False)) == len(two) == 2 * 80 + 1
    assert pulls_to_featured("weapon", 0, False) == pytest.approx(mixed(0.375, "weapon"))
    assert pulls_to_featured("weapon", 0, True) == pytest.approx(mixed(0.5, "weapon"))
    assert pulls_to_featured("weapon", 0, False, charted=False) == pytest.approx(mixed(0.75, "weapon"))
    assert pulls_to_featured("weapon", 0, True, charted=False) == pytest.approx(X)
    assert pulls_to_featured("weapon", 0, False, path_points=1) == pytest.approx(X)
    assert pulls_to_featured("weapon", 0, True, path_points=1) == pytest.approx(X)


def test_the_standard_wish_has_no_featured_item():
    with pytest.raises(ValueError):
        pulls_to_featured("standard", 10, False)
    with pytest.raises(ValueError):
        certain_within("standard", 10, False)


def test_the_balance_moves_on():
    assert balance_now(Balance(9840, 14, D), 2000, 5) == Estimate(11840, 9, 2000, 5, 83)
    # Fates below 0 take 160 primogems each, and the primogems stop at 0.
    assert balance_now(Balance(500, 2, D), 0, 5) == Estimate(20, 0, 0, 5, 0)
    assert balance_now(Balance(100, 0, D), 0, 5) == Estimate(0, 0, 0, 5, 0)


TODAY = date(2026, 10, 24)
# 7.2 with the Welkin Moon on, the Gnostic Hymn off, 2,330 typed as the events and 700 as the quests: 12,980 primogems.
NEXT = NextVersion(
    "7.2", date(2026, 11, 4), date(2026, 12, 16),
    (
        Row("commissions", 2520, 0, True, False),
        Row("events", 2330, 0, True, False),
        Row("endgame", 3050, 0, True, False),
        Row("update", 600, 0, True, False),
        Row("quests", 700, 0, True, True),
        Row("welkin", 3780, 0, True, False),
        Row("gnostic_hymn", 680, 4, False, False),
    ),
)
WITH_HYMN = NextVersion(
    NEXT.number, NEXT.starts_on, NEXT.ends_on, (*NEXT.rows[:-1], Row("gnostic_hymn", 680, 4, True, False))
)
E = Estimate(9840, 14, 0, 0, 75)


def test_the_forecast_runs_through_the_next_version():
    assert NEXT.primogems == 12980
    # By the version's end: the primogems now, the diary's pace for the 11 days until 4 Nov, and all 12,980.
    assert forecast(E, 226.0, TODAY, date(2026, 12, 16), NEXT) == (9840 + 226 * 11 + 12980) // 160 + 14 == 172
    # Half way in, 21 of the 42 days: half of the version's primogems, spread evenly over its days.
    assert forecast(E, 226.0, TODAY, date(2026, 11, 25), NEXT) == (9840 + 226 * 11 + 6490) // 160 + 14 == 131
    # After the version, each day counts at the version's own rate: 12,980 over 42 days, for 63 days from 4 Nov.
    assert forecast(E, 226.0, TODAY, date(2027, 1, 6), NEXT) == (9840 + 226 * 11 + 19470) // 160 + 14 == 212
    assert forecast(E, 226.0, TODAY, date(2026, 12, 17), NEXT) == (9840 + 226 * 11 + 13289) // 160 + 14 == 174
    # Before the version starts, only the diary's pace: 6 days.
    assert forecast(E, 226.0, TODAY, date(2026, 10, 30), NEXT) == (9840 + 226 * 6) // 160 + 14 == 83
    assert forecast(E, 226.0, TODAY, date(2026, 11, 4), NEXT) == (9840 + 226 * 11) // 160 + 14 == 91  # its first day
    assert forecast(E, 226.0, TODAY, TODAY, NEXT) == 75
    assert forecast(E, 226.0, TODAY, date(2026, 10, 20), NEXT) == 75  # a day gone by adds nothing
    # With no pace read, the diary adds nothing and the version's primogems still come.
    assert forecast(E, None, TODAY, date(2026, 12, 16), NEXT) == (9840 + 12980) // 160 + 14 == 156
    assert forecast(E, None, TODAY, date(2026, 10, 30), NEXT) == 75


def test_the_gnostic_hymns_fates_come_with_the_days_of_the_version():
    assert (WITH_HYMN.primogems, WITH_HYMN.fates) == (13660, 4)
    assert forecast(E, 226.0, TODAY, date(2026, 12, 16), WITH_HYMN) == (9840 + 226 * 11 + 13660) // 160 + 14 + 4 == 180
    # 21 of 42 days: half the primogems and 2 of the 4 fates; 2 days in, 4 × 2 // 42 fates are none yet.
    assert forecast(E, 226.0, TODAY, date(2026, 11, 25), WITH_HYMN) == (9840 + 226 * 11 + 6830) // 160 + 14 + 2 == 135
    assert forecast(E, 226.0, TODAY, date(2026, 11, 6), WITH_HYMN) == (9840 + 226 * 11 + 650) // 160 + 14 == 95


def test_income_per_day_over_the_days_tracked():
    assert income_per_day(3900.0, 30) == 130.0
    assert income_per_day(None, 30) is None
    assert income_per_day(100.0, 0) is None


def test_a_chain_spends_the_earlier_entries_pulls_first():
    D0 = pity_distribution("character", 0)  # a pool whose 5★ is certain to be the featured one, for the test
    first, second = chain([ChainEntry(90, D0, D0, 1), ChainEntry(90, D0, D0, 1)])
    assert first == pytest.approx(1.0)
    assert second < 1.0
    assert second == pytest.approx(chance_within(convolve(D0, D0), 90))
    assert chain([ChainEntry(90, D0, D0, 1), ChainEntry(180, D0, D0, 1)]) == pytest.approx([1.0, 1.0])
    assert chain([ChainEntry(180, D0, D0, 2)]) == pytest.approx([1.0])
    assert chain([]) == []
    # A budget that covers the most the entries so far can need is certain, exactly.
    assert chain([ChainEntry(90, D0, D0, 1), ChainEntry(170, D0, D0, 1), ChainEntry(10**6, D0, D0, 7)])[::2] == [1.0, 1.0]
    assert chain([ChainEntry(10**6, D0, D0, 7)] * 20) == [1.0] * 20


def test_each_entry_starts_from_its_own_distribution():
    character, weapon = pity_distribution("character", 80), pity_distribution("weapon", 70)
    entries = [
        ChainEntry(10, character, pity_distribution("character"), 1),
        ChainEntry(20, weapon, pity_distribution("weapon"), 1),
    ]
    assert chain(entries) == pytest.approx([1.0, 1.0])  # the weapon's pulls are counted from its own card
    # A further copy comes from `later`: from a count of 80, two copies need up to 10 + 90 pulls.
    assert chain([ChainEntry(100, character, pity_distribution("character"), 2)]) == pytest.approx([1.0])
    assert chain([ChainEntry(99, character, pity_distribution("character"), 2)])[0] < 1.0
