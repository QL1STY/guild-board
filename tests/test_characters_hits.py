"""A talent row's value read into terms: the shapes HoYoLAB's and the wiki's rows really print (verification W1, 2.3.6, and Genshin
Optimizer's `skillParamsEncoding`), which rows are damage, and the fallback kind of a hit."""
from __future__ import annotations

import pytest

from guildboard.characters.hits import Row, Term, instances, is_damage, kind_by_name, normalise, parse_choices, parse_value


def T(stat: str, mult: float) -> Term:
    return Term(stat, mult)


def flat_terms(text: str):
    parsed = parse_value(text)
    assert parsed is not None, text
    terms, flat, count = parsed
    return list(terms), flat, count


def test_the_shapes():
    assert flat_terms("235%") == ([T("atk", 2.35)], 0, 1)
    assert flat_terms("40.7% Max HP") == ([T("hp", 0.407)], 0, 1)
    assert flat_terms("240% DEF") == ([T("def", 2.4)], 0, 1)
    assert flat_terms("144.0% Elemental Mastery") == ([T("em", 1.44)], 0, 1)
    assert flat_terms("600.5% ATK+1,201.0% Elemental Mastery") == ([T("atk", 6.005), T("em", 12.01)], 0, 1)
    assert flat_terms("(121.0% ATK + 241.9% Elemental Mastery)×2") == ([T("atk", 1.21), T("em", 2.419)], 0, 2)
    assert flat_terms("2.53% Max HP ×5") == ([T("hp", 0.0253)], 0, 5)
    assert flat_terms("47.4%+88.1%") == ([T("atk", 1.355)], 0, 1)
    assert flat_terms("398.1% ATK+3051") == ([T("atk", 3.981)], 3051, 1)
    assert parse_value("18.0s") is None and parse_value("70") is None


def test_the_other_real_shapes():
    # the count as the game prints it: with or without a space, a multiplication sign or an asterisk
    assert flat_terms("158.8% ×3") == ([T("atk", 1.588)], 0, 3)
    assert flat_terms("45.2%×2") == ([T("atk", 0.452)], 0, 2)
    assert flat_terms("62.1%*4") == ([T("atk", 0.621)], 0, 4)
    assert flat_terms("20.84% Max HP") == ([T("hp", 0.2084)], 0, 1)
    assert flat_terms("66.4% DEF ×2") == ([T("def", 0.664)], 0, 2)
    # three hits on one row, and two different stats (Hu Tao's 4-Hit, Chiori's Tamoto, Dehya's Field at Lv 10)
    assert flat_terms("40.3%+43.6%+52.1%") == ([T("atk", 1.36)], 0, 1)  # shape of a three-part sum (Raiden's 4-Hit has three)
    assert flat_terms("148% ATK+185% DEF") == ([T("atk", 1.48), T("def", 1.85)], 0, 1)
    assert flat_terms("108.4% ATK+1.86% Max HP") == ([T("atk", 1.084), T("hp", 0.0186)], 0, 1)
    assert flat_terms("(121.0% ATK+241.9% Elemental Mastery)×3") == ([T("atk", 1.21), T("em", 2.419)], 0, 3)
    assert flat_terms("172.8% DEF ×2") == ([T("def", 1.728)], 0, 2)  # Linnea's Lumi Pound-Pound Pummeler
    # a flat part before the percentage (Vodyanitsa's healing prints `{{4}} + {{5}}% Max HP`), and after it (Ifa's)
    assert flat_terms("593 + 5.04% Max HP") == ([T("hp", 0.0504)], 593, 1)
    assert flat_terms("36.3% Elemental Mastery+105.9") == ([T("em", 0.363)], 105.9, 1)
    assert flat_terms("1,201.0% Elemental Mastery+3,051") == ([T("em", 12.01)], 3051, 1)  # shape: both numbers have commas
    # the stat named once, after the last part of a sum, is every bare part's (Zibai's Lunar Phase Shift 3-Hit DMG at Skill 10:
    # two hits of 62.2% DEF; found by the comparison with Genshin Optimizer, 2026-11-14)
    assert flat_terms("62.2%+62.2% DEF") == ([T("def", 1.244)], 0, 1)
    assert instances("62.2%+62.2% DEF") == 2
    # the same count on every part of a sum counts once for the sum (Varka's Azure Devour, two pairs of hits)
    assert flat_terms("168.5%×2+90.7%×2") == ([T("atk", 2.592)], 0, 2)
    # different counts fold into the numbers: `a%×2+b%` is 2a+b, once (shape only: no real row prints it)
    assert flat_terms("45%×2+30%") == ([T("atk", 1.2)], 0, 1)
    assert flat_terms("45% ATK+10% Max HP×3") == ([T("atk", 0.45), T("hp", 0.3)], 0, 1)
    # the count sign as an x or an X (shape only)
    assert flat_terms("2.53% Max HP x5") == ([T("hp", 0.0253)], 0, 5)
    assert flat_terms("45% X3") == ([T("atk", 0.45)], 0, 3)
    # the no-break space and spaces round the value that HoYoLAB sometimes leaves
    assert flat_terms("158.8% ×3") == ([T("atk", 1.588)], 0, 3)
    assert flat_terms("  235%  ") == ([T("atk", 2.35)], 0, 1)


def test_values_that_are_not_one_hit():
    # a choice of two hits (Low/High Plunge), a value per unit, a value of another stat, a duration, nothing
    for text in ("64.7%/80.8%", "7.0% DEF/8.0% DEF", "35% Max HP/Stack", "9% ATK per Fighting Spirit",
                 "45% Normal Attack DMG", "88.0% Elemental Mastery/Beacon", "30% Cryo + 20% Physical",
                 "5% Current HP", "12% Healing", "18.0s", "18", "1.5", "", "%", "x%", "50% ATK+", "(50% ATK",
                 "50% ATK)×2", "40%×0", "45%×2+30%×0", "0%/12%/12% Bond of Life", "50% Bond of Life+10% ATK"):
        assert parse_value(text) is None, text


def test_a_row_holds_its_parts():
    row = Row("Skill DMG", "elemental", (T("atk", 2.35),), 0.0, 1)
    assert row.terms[0].mult == 2.35 and row.kind == "elemental" and row.count == 1
    with pytest.raises(AttributeError):
        row.count = 2  # type: ignore[misc]


def test_damage_rows_only():
    assert is_damage("Skill DMG") and is_damage("2-Hit Hold DMG")
    assert not is_damage("Shield DMG Absorption") and not is_damage("ATK Increase") and not is_damage("CD")


def test_the_real_damage_rows():
    for name in ("1-Hit DMG", "Charged Attack DMG", "Low/High Plunge DMG", "Press DMG", "Skill DMG", "Burst DMG",
                 "Prism Shot Stellar-Conduct DMG", "Gravity Interference: Lunar-Bloom DMG", "Skill DMG: Melee",
                 "Photo DMG (Hold)", "Phantasm Performance 1-Hit DMG (Nefer)", "Sesshou Sakura DMG: Level 3",
                 "Stack 2 Conductive Hold DMG", "Steady State Core Gradient Beacon Consumption DMG",
                 "Fiery Rain DMG Per Wave", "DMG When in Power Overdrive", "Level 1 Shattering Pressure DMG",
                 "Transient Blossom DMG", "Flamestrider Normal Attack 3-Hit DMG", "Ice Lance DoT", "DoT", "Pyro DoT",
                 "Aimed Shot", "Fully-Charged Aimed Shot", "Aimed Shot Charge Level 1", "Level 1 Aimed Shot",
                 "Charged Attack", "Charged Attack: Equitable Judgment", "Riptide Slash"):
        assert is_damage(name), name


def test_the_buff_and_utility_rows_are_not_damage():
    for name in ("Shield DMG Absorption", "Base Shield DMG Absorption", "Max Shield DMG Absorption",
                 "Shield Level 2 DMG Absorption", "Seamless Shield DMG Absorption", "DMG Absorption", "DMG Bonus",
                 "Elemental Burst DMG Bonus", "Normal Attack DMG Bonus", "Charged Attack DMG Bonus",
                 "Flamestrider Charged Attack DMG Bonus", "Pyro: DMG Bonus", "DMG Reduction", "DMG Increase",
                 "Lunar-Bloom DMG Increase", "Dusk Bolt DMG Increase", "Fanfare to DMG Increase Conversion Ratio",
                 "Elemental Mastery-Based Swirl DMG Increase", "Spiritbreath Thorn DMG Interval",
                 "DMG Bonus on Hit Taken", "Stellar-Conduct DMG Bonus", "Lunar Reaction DMG Bonus",
                 "ATK Increase", "ATK Bonus", "DEF Bonus", "CD", "Skill CD", "Press CD", "Duration", "Shield Duration",
                 "Energy Cost", "Stamina Cost", "Charged Attack Stamina Cost", "Charged Attack Charging Stamina Drain",
                 "Healing", "Cast Healing", "Skill Healing", "Continuous Regeneration", "HP Restored", "HP Cost", "HP Loss",
                 "Mitigation", "Masterstroke", "Energy Regeneration", "Cryo RES Decrease", "Elemental RES Decrease",
                 "Basic Attack Instances", "Trigger Interval", "Blazing Threshold", "Max Duration", "Maximum Stacks",
                 "Nightsoul Point Limit", "Charged Attack & Swift Stormflight Stamina Cost", "", "Skill Activation Healing",
                 # a total of the row's own hits, and a bonus per stack to another hit (Kuki's and Amber's Bursts, Eula's)
                 "Total DMG", "Total Fiery Rain DMG", "DMG Per Stack"):
        assert not is_damage(name), name


def test_the_row_name_the_way_both_sources_print_it():
    assert normalise("#{LAYOUT_MOBILE#Tap}{LAYOUT_PC#Press} DMG") == "press dmg"
    assert normalise("#{LAYOUT_MOBILE#Tap}{LAYOUT_PC#Press}/#{LAYOUT_MOBILE#Hold}{LAYOUT_PC#Hold} DMG") == "press/hold dmg"
    assert normalise("  Prism Shot Stellar-Conduct   DMG ") == "prism shot stellar-conduct dmg"
    assert normalise("Skill <b>DMG</b>") == "skill dmg"
    assert normalise("<span style=\"x\">Charged Attack</span> DMG") == "charged attack dmg"
    assert normalise("Plunge DMG") == normalise("plunge  dmg")
    assert normalise("") == "" and normalise(None) == ""  # type: ignore[arg-type]


def test_the_name_fallback():
    assert kind_by_name("1-Hit DMG", "normal", "Claymore", infused=False) == "physical"
    assert kind_by_name("1-Hit DMG", "normal", "Catalyst", infused=False) == "elemental"
    assert kind_by_name("Fully-Charged Aimed Shot", "normal", "Bow", infused=False) == "elemental"
    assert kind_by_name("Prism Shot Stellar-Conduct DMG", "skill", "Claymore", infused=False) == "stellar-conduct"


def test_the_fallback_by_weapon_talent_and_infusion():
    for weapon in ("Sword", "Claymore", "Polearm"):
        assert kind_by_name("Charged Attack DMG", "normal", weapon, infused=False) == "physical"
        assert kind_by_name("Low/High Plunge DMG", "normal", weapon, infused=False) == "physical"
        assert kind_by_name("1-Hit DMG", "normal", weapon, infused=True) == "elemental"
    assert kind_by_name("Charged Attack DMG", "normal", "Catalyst", infused=False) == "elemental"
    assert kind_by_name("Plunge DMG", "normal", "Catalyst", infused=False) == "elemental"
    # a bow: its ordinary hits and the uncharged aimed shot are physical, the charged shots elemental
    assert kind_by_name("2-Hit DMG", "normal", "Bow", infused=False) == "physical"
    assert kind_by_name("Aimed Shot", "normal", "Bow", infused=False) == "physical"
    assert kind_by_name("Aimed Shot Charge Level 1", "normal", "Bow", infused=False) == "elemental"
    assert kind_by_name("Level 1 Aimed Shot", "normal", "Bow", infused=False) == "elemental"
    assert kind_by_name("Aimed Shot", "normal", "Bow", infused=True) == "elemental"
    # skills and bursts are the element's unless the row says otherwise, whatever the weapon
    assert kind_by_name("Skill DMG", "skill", "Claymore", infused=False) == "elemental"
    assert kind_by_name("Skill DMG", "burst", "Sword", infused=True) == "elemental"
    # the reaction a row names decides before anything else, in any spelling of its hyphen
    assert kind_by_name("Gravity Interference: Lunar-Charged DMG", "skill", "Catalyst", infused=False) == "lunar-charged"
    assert kind_by_name("Gravity Interference: Lunar-Bloom DMG", "skill", "Catalyst", infused=False) == "lunar-bloom"
    assert kind_by_name("Lunar-Crystallize DMG", "burst", "Sword", infused=False) == "lunar-crystallize"
    assert kind_by_name("Lunar Crystallize DMG", "burst", "Sword", infused=False) == "lunar-crystallize"
    assert kind_by_name("Prism Shot Stellar Swirl DMG", "skill", "Claymore", infused=False) == "stellar-swirl"
    assert kind_by_name("Convective Inhibition Ray Stellar-Conduct DMG", "burst", "Claymore", infused=False) == "stellar-conduct"
    assert kind_by_name("Charged Attack Condensed Beam Stellar-Conduct DMG", "normal", "Claymore", infused=False) == "stellar-conduct"


def test_the_alternatives_of_a_value():
    def choices(text: str):
        found = parse_choices(text)
        assert found is not None, text
        return [(list(terms), flat, count) for terms, flat, count in found]

    assert choices("64.7%/80.8%") == [([T("atk", 0.647)], 0, 1), ([T("atk", 0.808)], 0, 1)]
    assert choices("52.9%/76.7%") == [([T("atk", 0.529)], 0, 1), ([T("atk", 0.767)], 0, 1)]  # Clorinde's Swift Hunt, Lv 10
    # her Impale the Night: the count belongs to the last alternative only
    assert choices("65.2%/86.9%/49.6%×3") == [([T("atk", 0.652)], 0, 1), ([T("atk", 0.869)], 0, 1), ([T("atk", 0.496)], 0, 3)]
    assert choices("7.0% DEF/8.0% DEF") == [([T("def", 0.07)], 0, 1), ([T("def", 0.08)], 0, 1)]
    assert choices("3.5% Max HP/4.2% Max HP") == [([T("hp", 0.035)], 0, 1), ([T("hp", 0.042)], 0, 1)]
    # the game names the stat once, after the last alternative, for all of them (Nilou's Sword Dance/Whirling Steps 1-Hit DMG at
    # Skill 10, Kuki's Total DMG): found by the comparison with Genshin Optimizer, 2026-11-14
    assert choices("8.19%/5.87% Max HP") == [([T("hp", 0.0819)], 0, 1), ([T("hp", 0.0587)], 0, 1)]
    assert choices("45.4%/77.9% Max HP") == [([T("hp", 0.454)], 0, 1), ([T("hp", 0.779)], 0, 1)]
    # a value with no slash is its one alternative
    assert choices("235%") == [([T("atk", 2.35)], 0, 1)]
    assert choices("47.4%+88.1%") == [([T("atk", 1.355)], 0, 1)]
    assert choices("(121.0% ATK + 241.9% Elemental Mastery)×2") == [([T("atk", 1.21), T("em", 2.419)], 0, 2)]
    # every alternative must be one hit's value
    for text in ("35% Max HP/Stack", "0%/12%/12% Bond of Life", "0.0%/12.5% Bond of Life", "5% ATK/Stack", "30% ATK+10/s",
                 "88.0% Elemental Mastery/Beacon", "64.7%/", "/80.8%", "64.7%//80.8%", "", "18.0s/12.0s", "(10%/20%)×2"):
        assert parse_choices(text) is None, text


def test_the_bow_rule():
    for name in ("1-Hit DMG", "5-Hit DMG", "Aimed Shot", "Plunge DMG", "Low/High Plunge DMG"):
        assert kind_by_name(name, "normal", "Bow", infused=False) == "physical", name
    for name in ("Breakthrough Barb DMG", "Frostflake Arrow DMG", "Frostflake Arrow Bloom DMG", "Wreath Arrow DMG",
                 "Fully-Charged Aimed Shot", "Aimed Shot Charge Level 1", "Level 1 Aimed Shot", "Charged Attack DMG"):
        assert kind_by_name(name, "normal", "Bow", infused=False) == "elemental", name
    assert kind_by_name("1-Hit DMG", "normal", "Bow", infused=True) == "elemental"


def test_a_normal_attack_that_scales_on_hp_def_or_em_is_not_physical():
    hp, atk, em = (T("hp", 0.2),), (T("atk", 1.0),), (T("atk", 1.0), T("em", 0.5))
    assert kind_by_name("Charged Attack: Equitable Judgment", "normal", "Catalyst", infused=False, terms=hp) == "elemental"
    assert kind_by_name("Charged Attack DMG", "normal", "Sword", infused=False, terms=hp) == "elemental"
    assert kind_by_name("Charged Attack DMG", "normal", "Sword", infused=False, terms=em) == "elemental"
    assert kind_by_name("Charged Attack DMG", "normal", "Polearm", infused=False, terms=(T("def", 1.0),)) == "elemental"
    assert kind_by_name("1-Hit DMG", "normal", "Sword", infused=False, terms=atk) == "physical"
    assert kind_by_name("1-Hit DMG", "normal", "Sword", infused=False, terms=()) == "physical"
    assert kind_by_name("1-Hit DMG", "normal", "Sword", infused=False) == "physical"


def test_the_fallback_ignores_case():
    assert kind_by_name("1-Hit DMG", "Normal", "claymore", infused=False) == "physical"
    assert kind_by_name("1-Hit DMG", "NORMAL", "CATALYST", infused=False) == "elemental"
    assert kind_by_name("1-Hit DMG", "Auto", "sword", infused=False) == "physical"
    assert kind_by_name("Skill DMG", "Skill", "SWORD", infused=False) == "elemental"


def test_how_many_hits_one_landing_of_a_value_is():
    # A sum of parts of one stat is that many hits (Raiden's 4-Hit `40.3%+43.6%+52.1%` is three), each taking a flat bonus
    # added per hit (Aggravate, Spread): the comparison with Genshin Optimizer found the engine giving it once (2026-11-14).
    assert instances("47.4%+88.1%") == 2
    assert instances("40.3%+43.6%+52.1%") == 3
    assert instances("45%×2+30%") == 3                              # the counts fold into the numbers, so into the hits
    assert instances("168.5%×2+90.7%×2") == 2                       # the shared count is the row's count, not its hits
    # one hit that scales on two stats, or with a flat part, is one hit
    assert instances("600.5% ATK+1,201.0% Elemental Mastery") == 1
    assert instances("(121.0% ATK + 241.9% Elemental Mastery)×2") == 1
    assert instances("398.1% ATK+3051") == 1
    assert instances("235%") == 1 and instances("2.53% Max HP ×5") == 1
    assert instances("18.0s") == 1                                   # not a hit's value: nothing to split
