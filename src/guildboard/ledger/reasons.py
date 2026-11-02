"""What the game's own history reasons mean (the ledger design, section 0).

The reasons are the English ones the probe read on the player's account on 2026-10-27, matched exactly where the game
gives one fixed text, and by a word where it gives many (every event's reward names "Event", every domain's resin and
artifacts "(Domain)"). A reason this does not know is Other. The HoYoLAB diary's own action names go through the same
mapping, by the same words.
"""
from __future__ import annotations

from dataclasses import dataclass

# The five groups of earned primogems, in the order the chart stacks them.
GROUPS = ("commissions", "welkin", "events", "endgame", "other")
GROUP_LABELS = {
    "commissions": "Daily commissions",
    "welkin": "Blessing of the Welkin Moon",
    "events": "Events",
    "endgame": "Spiral Abyss and Theater",
    "other": "Other",
}
BOUGHT = "bought"  # primogems paid for: never counted as earned

WELKIN_DAILY = "Blessing of the Welkin Moon daily reward"
COMMISSIONS = "Daily Commission reward"
ENDGAME = ("Spiral Abyss reward", "Obtained from Imaginarium Theater")
STYGIAN = "Stygian Onslaught"
BOUGHT_REASONS = (
    "Exchanged Genesis Crystals for Primogems", "HoYoverse Top-Up Center Reward", "Top-Up Center Initial Top-Up Bonus",
)
SHOP = "Shop purchase"  # primogems out for Fates, 160 each; crystals out in the shop
BP_REWARD = "BP reward"  # +680 primogems once for each Gnostic Hymn bought
GNOSTIC_HYMN_PRIMOGEMS = 680
FATE_PRIMOGEMS = 160

TOP_UP = "Obtained via purchase"  # a crystal top-up, its first-time bonus in the same entry
WELKIN_BOUGHT = "Purchased Blessing of the Welkin Moon"  # +300 crystals
WELKIN_CRYSTALS = 300

DOMAIN = " (Domain)"  # "Revitalized Petrified Tree (Domain)": a domain's resin and its artifacts
RESIN_PER_RUN = 20


def group_of(reason: str) -> str:
    """The group of earned primogems a reason belongs to, or "bought"; a reason not known is "other"."""
    if reason in BOUGHT_REASONS or "Top-Up" in reason:
        return BOUGHT
    folded = reason.casefold()
    if "welkin" in folded:
        return "welkin"
    if "commission" in folded:
        return "commissions"
    if reason in ENDGAME or STYGIAN in reason or "abyss" in folded or "theater" in folded:
        return "endgame"
    if "event" in folded:
        return "events"
    return "other"


def fates_bought(reason: str, amount: int) -> int:
    """The Fates a primogem entry bought: a shop purchase of a whole number of 160s; 0 for any other entry."""
    if reason == SHOP and amount < 0 and amount % FATE_PRIMOGEMS == 0:
        return -amount // FATE_PRIMOGEMS
    return 0


def gnostic_hymns(reason: str, amount: int) -> int:
    """The Gnostic Hymns a primogem entry shows: 1 for the Battle Pass's 680, else 0."""
    return 1 if reason == BP_REWARD and amount == GNOSTIC_HYMN_PRIMOGEMS else 0


@dataclass(frozen=True)
class Pack:
    id: str
    label: str
    crystals: int  # the pack's own crystals, before any bonus


# The top-up packs and what else is bought, in the order the Spending panel lists them. A pack's amounts: the crystals
# with the usual bonus, and the first purchase's double.
PACKS: dict[str, Pack] = {
    "welkin": Pack("welkin", "Blessing of the Welkin Moon", 300),
    "c60": Pack("c60", "60 Genesis Crystals", 60),
    "c300": Pack("c300", "300 + 30 Genesis Crystals", 300),
    "c980": Pack("c980", "980 + 110 Genesis Crystals", 980),
    "c1980": Pack("c1980", "1980 + 260 Genesis Crystals", 1980),
    "c3280": Pack("c3280", "3280 + 600 Genesis Crystals", 3280),
    "c6480": Pack("c6480", "6480 + 1600 Genesis Crystals", 6480),
    "gnostic_hymn": Pack("gnostic_hymn", "Gnostic Hymn", 0),
}
PACK_IDS = tuple(PACKS)
_TOP_UPS = {
    60: "c60", 120: "c60", 330: "c300", 600: "c300", 1090: "c980", 1960: "c980",
    2240: "c1980", 3960: "c1980", 3880: "c3280", 6560: "c3280", 8080: "c6480", 12960: "c6480",
}

# Each pack's price on PC and Android, the player correcting them in Settings when their shop differs; only the price is
# an estimate, the packs themselves are read exactly. Checked on 2026-10-27:
# - The packs: the Genshin Impact Wiki's "Genesis Crystal" price tables (genshin-impact.fandom.com/wiki/Genesis_Crystal,
#   "Normal Purchases (USD)", "EUR" and "PLN"): USD and EUR alike on most platforms, iOS dearer. HoYoverse's top-up
#   centre answers only its whole list of price tiers without a login (sdk-os-static.hoyoverse.com
#   …/shopwindow/listPriceTier), which holds every one of these figures, and the older €16.99 to €109.99 too, so it
#   does not say which tier is which pack.
# - The Welkin: the wiki's "Blessing of the Welkin Moon" (US$4.99, €4.99, 25,99 zł, its table of 2026-09-12).
# - The Gnostic Hymn: the wiki's "Battle Pass" (US$9.99). EUR and PLN are not listed: €9.99 follows the packs' parity,
#   and 46.99 zł is an estimate from the packs' złoty prices.
# The PLN figures are the wiki's alone: HoYoverse's centre answered no złoty tiers without a login.
DEFAULT_PRICES: dict[str, dict[str, float]] = {
    "USD": {
        "welkin": 4.99, "c60": 0.99, "c300": 4.99, "c980": 14.99, "c1980": 29.99, "c3280": 49.99, "c6480": 99.99,
        "gnostic_hymn": 9.99,
    },
    "EUR": {
        "welkin": 4.99, "c60": 0.99, "c300": 4.99, "c980": 14.99, "c1980": 29.99, "c3280": 49.99, "c6480": 99.99,
        "gnostic_hymn": 9.99,
    },
    "PLN": {
        "welkin": 25.99, "c60": 4.99, "c300": 23.99, "c980": 69.99, "c1980": 139.99, "c3280": 239.99, "c6480": 479.99,
        "gnostic_hymn": 46.99,
    },
}
CURRENCIES = tuple(DEFAULT_PRICES)


def pack_of(amount: int, reason: str) -> Pack | None:
    """The pack a crystal entry bought, read exactly from its amount; None for an entry that bought none."""
    if reason == WELKIN_BOUGHT and amount == WELKIN_CRYSTALS:
        return PACKS["welkin"]
    if reason == TOP_UP and amount in _TOP_UPS:
        return PACKS[_TOP_UPS[amount]]
    return None


def domain_of(reason: str) -> str | None:
    """The domain a reason names, the text before " (Domain)"; None when it names none."""
    return reason[: -len(DOMAIN)] if reason.endswith(DOMAIN) and len(reason) > len(DOMAIN) else None


def domain_runs(reason: str, amount: int) -> int:
    """The domain runs a resin entry stands for: 20 resin is one, a condensed run's 40 two; 0 for any other entry."""
    if domain_of(reason) is None or amount >= 0 or amount % RESIN_PER_RUN:
        return 0
    runs = -amount // RESIN_PER_RUN
    return runs if runs in (1, 2) else 0
