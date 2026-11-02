"""The team builder (the design, section 7.8), as `endgame.html`'s `buildTeams` has it.

The pool is whoever is at BUILT readiness or more. Damage dealers go in order of readiness, +30 when their element leads for
the boss being fought. Each team takes, first, the best character who keeps it alive, then the best scorers up to four. A
character's score is their readiness, +30 for an element their damage dealer's card wants that is not in the team yet, +10
for an element that reacts with the damage dealer's, and -25 for another damage dealer. No one is in two teams, and the
building stops at the first damage dealer who cannot be given a full team.

`REACTIONS` is the mockup's table of which elements react with each, built in because the signatures carry no references;
the researched `Refs.reactions` is for the pages' own text."""
from __future__ import annotations

import math
from typing import Sequence

from guildboard.characters import BUILT
from guildboard.characters.models import Member, Team

REACTIONS = {
    "Cryo": ("Electro", "Hydro", "Anemo", "Pyro"),
    "Electro": ("Hydro", "Cryo", "Dendro", "Pyro", "Anemo"),
    "Hydro": ("Electro", "Dendro", "Cryo", "Pyro"),
    "Dendro": ("Hydro", "Electro", "Pyro"),
    "Pyro": ("Hydro", "Cryo", "Electro", "Dendro"),
    "Anemo": ("Pyro", "Hydro", "Electro", "Cryo"),
    "Geo": ("Geo",),
}
LEAD_BONUS = 30
WANTED_ELEMENT_BONUS = 30
REACTION_BONUS = 10
SECOND_DAMAGE_DEALER = 25
CLOSE_FROM = 30   # "close to counting": 30% up to the built line
TEAM_SIZE = 4


def _damage(member: Member) -> bool:
    return "damage" in member.roles


def build_teams(pool: Sequence[Member], max_teams: int, lead: Sequence[str] = ()) -> tuple[Team, ...]:
    """Up to `max_teams` teams of four from `pool`, each with a damage dealer, someone to keep it alive and the partners its
    card wants. `lead` names the elements that do well, which lift a damage dealer of that element."""
    free = {member.key for member in pool if member.ready >= BUILT}
    dealers = sorted(
        (member for member in pool if member.key in free and _damage(member)),
        key=lambda member: -(member.ready + (LEAD_BONUS if member.element in lead else 0)),
    )
    found: list[Team] = []
    for dealer in dealers:
        if dealer.key not in free or len(found) >= max_teams:
            continue
        team = [dealer]

        def score(member: Member) -> int:
            wanted = member.element in dealer.wants and not any(
                other is not dealer and other.element == member.element for other in team
            )
            return (
                member.ready + (WANTED_ELEMENT_BONUS if wanted else 0)
                + (REACTION_BONUS if member.element in REACTIONS.get(dealer.element, ()) else 0)
                - (SECOND_DAMAGE_DEALER if _damage(member) else 0)
            )

        def pick(candidates: list[Member]) -> Member | None:
            return min(candidates, key=lambda member: -score(member)) if candidates else None

        def left() -> list[Member]:
            return [m for m in pool if m.key in free and m.key != dealer.key and all(m.key != t.key for t in team)]

        alive = pick([member for member in left() if member.keeps_alive])
        if alive is not None:
            team.append(alive)
        while len(team) < TEAM_SIZE:
            member = pick(left())
            if member is None:
                break
            team.append(member)
        if len(team) < TEAM_SIZE:
            break
        free -= {member.key for member in team}
        found.append(Team(members=tuple(team), ready=team_ready(team)))
    return tuple(found)


def team_ready(team: Sequence[Member]) -> int:
    """A team's readiness: the damage dealer counts twice."""
    if not team:
        return 0
    return math.floor((2 * team[0].ready + sum(member.ready for member in team[1:])) / (len(team) + 1) + 0.5)


def cast(pool: Sequence[Member], elements: Sequence[str]) -> tuple[tuple[str, tuple[Member, ...], int], ...]:
    """The Theater's cast, per element of the month: (element, its characters with the most ready first, how many are ready)."""
    rows = []
    for element in elements:
        members = tuple(sorted((m for m in pool if m.element == element), key=lambda m: -m.ready))
        rows.append((element, members, sum(1 for m in members if m.ready >= BUILT)))
    return tuple(rows)


def thinnest(rows: Sequence[tuple[str, tuple[Member, ...], int]]) -> str | None:
    """The element with the fewest ready, among those that have someone not ready yet (any, if every one has everyone ready);
    None when even that one has three ready."""
    if not rows:
        return None
    short = [row for row in rows if any(m.ready < BUILT for m in row[1])]
    row = min(short or rows, key=lambda row: row[2])
    return row[0] if row[2] < 3 else None


def close(pool: Sequence[Member], elements: Sequence[str]) -> tuple[Member, ...]:
    """Who in these elements is close to counting: from 30% up to the built line, the most ready first."""
    return tuple(sorted(
        (m for m in pool if m.element in elements and CLOSE_FROM <= m.ready < BUILT), key=lambda m: -m.ready,
    ))
