"""The game's own history reasons, as the probe read them on the player's account (the ledger design, section 0)."""
import pytest

from guildboard.ledger import reasons
from guildboard.ledger.reasons import (
    DEFAULT_PRICES, GROUPS, PACK_IDS, domain_of, domain_runs, fates_bought, gnostic_hymns, group_of, pack_of,
)


@pytest.mark.parametrize("reason, group", [
    ("Blessing of the Welkin Moon daily reward", "welkin"),
    ("Daily Commission reward", "commissions"),
    ("Event reward", "events"),
    ("Test Run Character Trial Event reward", "events"),
    ("Claimed Hangout Event reward", "events"),
    ("Spiral Abyss reward", "endgame"),
    ("Obtained from Imaginarium Theater", "endgame"),
    ("Stygian Onslaught reward", "endgame"),
    ("Exchanged Genesis Crystals for Primogems", "bought"),
    ("HoYoverse Top-Up Center Reward", "bought"),
    ("Top-Up Center Initial Top-Up Bonus", "bought"),
    ("BP reward", "other"),
    ("Claimed reward", "other"),
    ("Opened treasure chest", "other"),
])
def test_group_of_maps_each_probed_reason(reason, group):
    assert group_of(reason) == group


def test_unknown_reason_is_other():
    assert group_of("Something the game says one day") == "other"
    assert set(GROUPS) == {"commissions", "welkin", "events", "endgame", "other"}


def test_crystal_conversion_is_bought():
    assert group_of("Exchanged Genesis Crystals for Primogems") == "bought"


def test_pack_of_knows_first_time_doubles():
    bought = "Obtained via purchase"
    assert pack_of(120, bought).id == "c60" and pack_of(60, bought).id == "c60"
    assert pack_of(600, bought).id == "c300" and pack_of(330, bought).id == "c300"
    assert pack_of(1960, bought).id == "c980" and pack_of(1090, bought).id == "c980"
    assert pack_of(3960, bought).id == "c1980" and pack_of(2240, bought).id == "c1980"
    assert pack_of(6560, bought).id == "c3280" and pack_of(3880, bought).id == "c3280"
    assert pack_of(12960, bought).id == "c6480" and pack_of(8080, bought).id == "c6480"
    assert pack_of(300, "Purchased Blessing of the Welkin Moon").id == "welkin"
    assert pack_of(777, bought) is None
    assert pack_of(-600, "Exchanged Genesis Crystals for Primogems") is None
    assert pack_of(300, "Shop purchase") is None


def test_fates_bought_from_a_fate_purchase():
    assert fates_bought("Shop purchase", -1600) == 10
    assert fates_bought("Shop purchase", -160) == 1
    assert fates_bought("Shop purchase", -100) == 0
    assert fates_bought("Daily Commission reward", 60) == 0


def test_a_gnostic_hymn_is_the_bp_reward_of_680():
    assert gnostic_hymns("BP reward", 680) == 1
    assert gnostic_hymns("BP reward", 160) == 0
    assert gnostic_hymns("Event reward", 680) == 0


def test_domain_runs_and_the_domains_name():
    assert domain_runs("Revitalized Petrified Tree (Domain)", -20) == 1
    assert domain_runs("Revitalized Petrified Tree (Domain)", -40) == 2
    assert domain_runs("Ley Line Blossom challenge reward", -20) == 0
    assert domain_runs("Revitalized Petrified Tree (Domain)", 60) == 0
    assert domain_of("Revitalized Petrified Tree (Domain)") == "Revitalized Petrified Tree"
    assert domain_of("Obtained from Mystic Offering") is None


def test_every_currency_prices_every_pack():
    assert set(DEFAULT_PRICES) == {"EUR", "USD", "PLN"}
    for prices in DEFAULT_PRICES.values():
        assert set(prices) == set(PACK_IDS)
        assert all(price > 0 for price in prices.values())
    assert reasons.PACKS["c980"].crystals == 980
