"""The artifact X-ray (the design, section 7.4): each substat's rolls classed by the card's weight, crit value, a verdict with
the rule that fired as its reason, and where all the rolls went."""
from __future__ import annotations

from guildboard.characters import SLOTS
from guildboard.characters.models import Build, Card, Piece, Verdict
from guildboard.characters.stats import label, max_level

WEIGHT_ORDER = ("wants", "some", "none")
CHOOSABLE = ("sands", "goblet", "circlet")


def _weight(card: Card, stat: str) -> str:
    return card.weights.get(stat, "none")


def _verb(card: Card) -> str:
    return "want" if card.pronouns[0] == "they" else "wants"


def _names(card: Card, stats_: tuple[str, ...]) -> str:
    names = [label(stat, card.element) for stat in stats_]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " or " + names[-1]


def crit_value(piece: Piece) -> float:
    """2 x Crit Rate + Crit DMG, from substats."""
    return sum(2 * sub.value if sub.stat == "cr" else sub.value if sub.stat == "cd" else 0.0 for sub in piece.subs)


def _verdict(piece: Piece, card: Card) -> Verdict:
    wanted = sum(sub.rolls for sub in piece.subs if _weight(card, sub.stat) == "wants")
    total = sum(sub.rolls for sub in piece.subs)
    kinds = sum(1 for sub in piece.subs if _weight(card, sub.stat) == "wants")
    she, verb = card.pronouns[0], _verb(card)
    top = max_level(piece.rarity)
    asked = card.mains.get(piece.slot) if piece.slot in CHOOSABLE else None
    if asked and piece.main not in asked:
        verdict = "replace"
        why = f"Its main stat is {label(piece.main, card.element)}; {card.pronouns[2]} card asks for {_names(card, asked)}."
    elif piece.level >= top and wanted < 2:
        verdict = "replace"
        why = f"At +{top}, only {wanted} of {total} rolls are in stats {she} {verb}."
    elif piece.level < top and kinds >= 2:
        verdict = "level"
        why = f"At +{piece.level}, with {kinds} substats {she} {verb}."
    else:
        verdict = "keep"
        why = f"{wanted} of {total} rolls in stats {she} {verb}."
    return Verdict(
        slot=piece.slot, verdict=verdict, why=why, crit_value=crit_value(piece), rolls_wanted=wanted, rolls_all=total,
    )


def verdicts(build: Build, card: Card) -> tuple[Verdict, ...]:
    """Each piece's verdict (keep, level or replace) with its reason, in the order of the slots."""
    return tuple(_verdict(build.pieces[slot], card) for slot in SLOTS if slot in build.pieces)


def roll_chart(build: Build, card: Card) -> tuple[tuple[str, int, str, str], ...]:
    """Where the rolls went: (stat key, rolls, weight, where), the stats she wants first and the most rolls first."""
    rolls: dict[str, int] = {}
    where: dict[str, list[str]] = {}
    for slot in SLOTS:
        piece = build.pieces.get(slot)
        for sub in piece.subs if piece else ():
            rolls[sub.stat] = rolls.get(sub.stat, 0) + sub.rolls
            where.setdefault(sub.stat, []).append(f"{slot.capitalize()} {sub.rolls}")
    ordered = sorted(rolls, key=lambda stat: (WEIGHT_ORDER.index(_weight(card, stat)), -rolls[stat]))
    return tuple((stat, rolls[stat], _weight(card, stat), ", ".join(where[stat])) for stat in ordered)
