"""What to do next (the design, section 7.5).

The candidates are: replace each piece the X-ray says to replace (with an average good piece: the right main stat at +20 and 2
rolls each in her two most wanted substats), level each piece below +20, raise each talent one level, level her and her
weapon, and change weapon (offered only as "if you have it", and only for a weapon the card ranks above the one she holds). A damage role ranks them by damage gain, and a role without a
damage estimate by readiness gain. Leveling her and her weapon has no damage model (her stats at another level need the wiki),
so for a damage role those two only fill the list after every candidate that gains damage, ranked by readiness."""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass

from guildboard.characters import damage, readiness, stats, xray
from guildboard.characters.models import Build, Card, Plan, Refs, Step, TypedPiece
from guildboard.characters.stats import label, max_level

TALENT_NAMES = {"normal": "Normal Attack", "skill": "Elemental Skill", "burst": "Elemental Burst"}
FIXED_MAINS = {"flower": "hp", "plume": "atk"}


@dataclass(frozen=True)
class _Candidate:
    text: str
    plan: Plan
    weapon_rank: int | None = None   # a weapon change: its place in the card's list


def _wanted(card: Card, excluding: str) -> list[str]:
    return [stat for stat, weight in card.weights.items() if weight == "wants" and stat != excluding]


def _replacement(build: Build, card: Card, refs: Refs, slot: str) -> _Candidate:
    piece = build.pieces[slot]
    asked = card.mains.get(slot) if slot in xray.CHOOSABLE else None
    main = asked[0] if asked else FIXED_MAINS.get(slot, piece.main)
    best = _wanted(card, main)[:2]
    subs = tuple((stat, 2 * refs.roll_avg[stat]) for stat in best if stat in refs.roll_avg)
    typed = TypedPiece(slot=slot, main=main, subs=subs, use=True)
    names = " or ".join(label(stat, card.element) for stat in best)
    kind = slot.capitalize()
    if slot in FIXED_MAINS:
        text = f"Replace the {kind} with one that has {names}." if names else f"Replace the {kind}."
    else:
        text = f"Replace the {kind} with a {label(main, card.element)} {slot}" + (f" that has {names}." if names else ".")
    return _Candidate(text, dataclasses.replace(stats.now_plan(build), typed=typed))


def _candidates(build: Build, card: Card, refs: Refs) -> list[_Candidate]:
    now = stats.now_plan(build)
    poss = card.pronouns[2]
    found: list[_Candidate] = []
    replaced = set()
    for verdict in xray.verdicts(build, card):
        if verdict.verdict == "replace":
            replaced.add(verdict.slot)
            found.append(_replacement(build, card, refs, verdict.slot))
    for slot, piece in build.pieces.items():
        if slot not in replaced and piece.rarity >= 5 and piece.level < max_level(piece.rarity):
            found.append(_Candidate(
                f"Level the {slot.capitalize()} from +{piece.level} to +20.",
                dataclasses.replace(now, level_pieces=(slot,)),
            ))
    for kind, name in TALENT_NAMES.items():
        level = build.talents.get(kind, 10)
        if level < 10:
            found.append(_Candidate(
                f"Raise {poss} {name} to {level + 1}.", dataclasses.replace(now, talents={**now.talents, kind: level + 1}),
            ))
    current = build.weapon
    # Only a weapon the card ranks above the one she holds: the damage estimate leaves out many passives (Nightsoul, Moonsign
    # and the like), so it cannot say that a signature weapon is worse than the card's lower picks. A weapon that is not on
    # the card ranks below all of them.
    held = card.weapons.index(current.key) if current is not None and current.key in card.weapons else len(card.weapons)
    for place, key in enumerate(card.weapons[:held]):
        ref = refs.weapons.get(key)
        if ref is None or ref.type != card.weapon_type:
            continue
        text = f"If you have {ref.name}: use it in place of {current.name}." if current else f"If you have {ref.name}: equip it."
        found.append(_Candidate(text, dataclasses.replace(now, weapon=key, weapon_level=90, refinement=1), place))
    return found


def _weapons_in_cards_order(steps: list[tuple[Step, int | None]]) -> list[Step]:
    """The weapon changes keep the places they won in the ranking, but take them in the card's order."""
    places = [i for i, (_, place) in enumerate(steps) if place is not None]
    ordered = sorted((steps[i] for i in places), key=lambda pair: pair[1])
    for i, pair in zip(places, ordered):
        steps[i] = pair
    return [step for step, _ in steps]


def _gain_of(build: Build, card: Card, refs: Refs, candidate: _Candidate, base_est: float, base_raw: float, damage_role: bool) -> float:
    after = stats.apply_plan(build, candidate.plan, card, refs)
    combat = stats.combat(build, candidate.plan, card, refs)
    if damage_role:
        estimate = damage.estimate(combat, card, readiness.talent_level(after, card), refs)
        return estimate / base_est - 1 if base_est > 0 else 0.0
    plan = candidate.plan
    result = readiness.score(after, card, refs, combat, weapon_level=plan.weapon_level)
    return readiness.raw(result.parts) - base_raw


def _levels(build: Build, card: Card, refs: Refs, base_raw: float) -> list[Step]:
    """Level her and her weapon, by the readiness each gains."""
    combat = stats.combat_now(build, card, refs)
    steps = []
    obj = card.pronouns[1]
    if build.level < 90:
        gain = readiness.raw(readiness.score(dataclasses.replace(build, level=90), card, refs, combat).parts) - base_raw
        steps.append(Step(f"Raise {obj} to level 90.", _points(gain), gain))
    if build.weapon is not None and build.weapon.level < 90:
        gain = readiness.raw(readiness.score(build, card, refs, combat, weapon_level=90).parts) - base_raw
        steps.append(Step(f"Raise {build.weapon.name} to level 90.", _points(gain), gain))
    return [step for step in steps if step.value > 0 and round(step.value * 100) >= 1]


def _points(gain: float) -> str:
    return f"about +{round(gain * 100)} readiness"


def rank(build: Build, card: Card, refs: Refs, n: int = 3) -> tuple[Step, ...]:
    """The `n` steps that gain her the most, best first."""
    damage_role = "damage" in card.roles
    combat = stats.combat_now(build, card, refs)
    base_est = damage.estimate(combat, card, readiness.talent_level(build, card), refs) if damage_role else 0.0
    base_raw = readiness.raw(readiness.score(build, card, refs, combat).parts)
    steps = []
    for candidate in _candidates(build, card, refs):
        gain = _gain_of(build, card, refs, candidate, base_est, base_raw, damage_role)
        if round(gain * 100) >= 1:
            steps.append((Step(candidate.text, f"about +{round(gain * 100)}% damage" if damage_role else _points(gain), gain),
                          candidate.weapon_rank))
    levels = [(step, None) for step in _levels(build, card, refs, base_raw)]
    if damage_role:
        steps.sort(key=lambda pair: -pair[0].value)
        steps = _weapons_in_cards_order(steps)
        steps.extend(step for step, _ in sorted(levels, key=lambda pair: -pair[0].value))
        return tuple(steps[:n])
    steps.extend(levels)
    steps.sort(key=lambda pair: -pair[0].value)
    return tuple(_weapons_in_cards_order(steps)[:n])
