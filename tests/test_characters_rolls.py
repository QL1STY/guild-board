from guildboard.characters import reference, rolls


def test_roll_values_are_the_games():
    assert rolls.ROLLS[5]["cd"] == (5.44, 6.22, 6.99, 7.77)
    assert rolls.ROLLS[5]["er"] == (4.53, 5.18, 5.83, 6.48)
    assert rolls.ROLLS[5]["atk"] == (13.62, 15.56, 17.51, 19.45)


def test_main_values_at_0_and_20():
    assert rolls.main_value("hp", 20) == 4780 and rolls.main_value("hp", 0) == 717
    assert rolls.main_value("cr", 20) == 31.1 and rolls.main_value("atk_pct", 0) == 7.0
    assert rolls.main_value("em", 20) == 186.5 and rolls.main_value("physical", 20) == 58.3


def test_four_star_values():
    assert rolls.ROLLS[4]["cd"] == (4.35, 4.97, 5.60, 6.22)
    assert rolls.main_value("hp", 16, 4) == 3571 and rolls.main_value("cd", 0, 4) == 8.4


def test_a_four_star_substat_holds_at_most_four_rolls():
    # 26.1 Crit DMG is a sum of five 4-star rolls (four reach 24.88 at most): no 4-star substat can show it
    assert 26.1 in rolls._sums("cd", 4, 5) and max(rolls._sums("cd", 4, 4)) < 26.1
    assert rolls.reachable("cd", 26.1, 4) == []
    assert rolls.reachable("cd", 24.9, 4) == [4]      # four top rolls: 24.88
    assert rolls.split_rolls("cd", 26.1, 5, 4) is None
    assert rolls.reachable("cd", 46.6) == [6]         # six top rolls on a 5-star: 46.62
    assert rolls.split_rolls("cd", 21.8, 7) is None and rolls.split_rolls("cd", 21.8, 0) is None


def test_a_level_outside_the_table_is_refused():
    import pytest
    for level, rarity in ((-1, 5), (21, 5), (17, 4)):
        with pytest.raises(ValueError):
            rolls.main_value("hp", level, rarity)


def test_the_tables_agree_with_mains_20():
    tables = reference.load_tables()
    for stat, value in tables["mains_20"].items():
        assert rolls.main_value("physical" if stat == "phys" else stat, 20) == value, stat
    assert all(len(column) == 21 for column in tables["mains_by_level_5"].values())
    assert all(len(column) == 17 for column in tables["mains_by_level_4"].values())
    assert tables["start4_odds"] == {"5": 0.2, "4": 0.2}


def test_reachable_counts():
    assert rolls.reachable("cd", 21.0) == [3]
    assert rolls.reachable("cr", 3.0) == []
    assert 2 in rolls.reachable("cd", 13.2)      # 6.22 + 6.99 = 13.21
    assert 2 in rolls.reachable("atk_pct", 9.9)  # 4.66 + 5.25 = 9.91
    assert rolls.reachable("hp", 209) == [1]


def test_a_rounding_tie_accepts_both_neighbours():
    tie = next(s for s in sorted(rolls._sums("cr", 5, 5)) if abs(s * 10 - int(s * 10) - 0.5) < 1e-6)
    low, high = int(tie * 10) / 10, int(tie * 10 + 1) / 10
    assert 5 in rolls.reachable("cr", low) and 5 in rolls.reachable("cr", high)


def test_split_rolls_matches_the_value():
    tiers = rolls.split_rolls("cd", 21.8, 3)
    assert tiers is not None and round(sum(rolls.ROLLS[5]["cd"][t] for t in tiers), 1) == 21.8
    assert list(tiers) == sorted(tiers)
    assert rolls.split_rolls("cr", 3.0, 1) is None


def test_cv_tiers():
    assert rolls.cv_tier(14.9, False) == 0 and rolls.cv_tier(35.0, False) == 3
    assert rolls.cv_tier(19.4, True) == 2          # graded at 27.17
    assert rolls.cv_tier(54.4, False) == 6
    assert rolls.set_tier(179.9) == 0 and rolls.set_tier(220) == 3 and rolls.set_tier(300) == 6
