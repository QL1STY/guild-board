"""The game's own history reasons, as the probe read them on the player's account (the ledger design, section 0)."""
import pytest

from guildboard.ledger import reasons
from guildboard.ledger.reasons import (
    DEFAULT_PRICES, GROUPS, PACK_IDS, domain_of, domain_runs, fates_bought, gnostic_hymns, group_of, pack_of,
    plain_title, source_of,
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


def test_plain_title_makes_the_games_reasons_plain():
    assert plain_title("Obtained from Imaginarium Theater") == "Imaginarium Theater"
    assert plain_title("Blessing of the Welkin Moon daily reward") == "Blessing of the Welkin Moon"
    assert plain_title("Daily Commission reward") == "Daily commissions"
    assert plain_title("Spiral Abyss reward") == "Spiral Abyss"
    assert plain_title("Stygian Onslaught reward") == "Stygian Onslaught"
    assert plain_title("Revitalized Petrified Tree (Domain)") == "Revitalized Petrified Tree"
    assert plain_title("Event reward") == "Event reward"
    assert plain_title("Some reason the game adds later") == "Some reason the game adds later"


def test_source_of_tells_the_shop_from_bought_and_the_groups():
    assert source_of("Shop purchase", -1600) == "shop"
    assert source_of("Shop purchase", -50) == "shop"  # a negative shop entry, whatever it bought
    assert source_of("Exchanged Genesis Crystals for Primogems", 300) == "bought"
    assert source_of("Spiral Abyss reward", 600) == "endgame"
    assert source_of("Opened treasure chest", 5) == "other"
    assert source_of("Daily Commission reward", 60) == "commissions"


@pytest.mark.parametrize("reason, amount, source", [
    ("Purchased Blessing of the Welkin Moon", 300, "bought"),
    ("Obtained via purchase", 1090, "bought"),
    ("Exchanged Genesis Crystals for Primogems", -1090, "exchange"),
    ("Purchased Fragile Resin", -60, "shop"),
    ("Something else", 5, "other"),
])
def test_crystal_source(reason, amount, source):
    assert reasons.crystal_source(reason, amount) == source
    assert source_of(reason, amount, "crystal") == source


@pytest.mark.parametrize("reason, amount, use", [
    ("Revitalized Petrified Tree (Domain)", -20, "domain"),
    ("Violet Court (Domain)", -40, "domain"),  # a condensed run
    ("Confront Stormterror (Domain)", -30, "weekly"),  # a weekly boss's Trounce Domain: written "(Domain)" too
    ("Confront Stormterror (Domain)", -60, "weekly"),
    ("Ley Line Blossom challenge reward", -20, "ley"),
    ("Trounce Blossom challenge reward", -40, "boss"),  # the player's log: a boss, not a ley line, not a weekly boss
    ("Anemo Hypostasis challenge reward", -40, "boss"),
    ("Item crafting material", -40, "condensed"),
    ("Stygian Onslaught", -20, "other"),
    ("Something the game says one day", -20, "other"),
])
def test_resin_use(reason, amount, use):
    assert reasons.resin_use(reason, amount) == use
    assert source_of(reason, amount, "resin") == use


@pytest.mark.parametrize("reason, amount, source", [
    ("Sanctum of Rainbow Spirits (Domain)", 1, "domain"),
    ("Obtained from Mystic Offering", 1, "elsewhere"),
    ("Artifact enhancement material", -1, "fed"),
    ("Artifact decomposition", -1, "salvaged"),
    ("Something else", -1, "other"),
])
def test_artifact_source(reason, amount, source):
    assert reasons.artifact_source(reason, amount) == source
    assert source_of(reason, amount, "artifact") == source


def test_a_resin_refill_with_primogems_is_the_resins_not_the_shops():
    assert source_of("Original Resin replenishment", -50) == "resin"
    assert source_of("Shop purchase", -1600) == "shop"
