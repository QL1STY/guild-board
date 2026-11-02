"""Guild Board's own notes on the achievement list: counters, tiers not awarded in order, wiki pages, and what is
known about the achievements that come from daily commissions."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from importlib import resources
from typing import Any, Mapping, Sequence
from urllib.parse import quote

from guildboard.achievements.catalog import Catalog, Stage

WIKI_SEARCH = "https://genshin-impact.fandom.com/wiki/Special:Search?query="
NUMBER = re.compile(r"\d{1,3}(?:,\d{3})+|\d+")  # 2,000 is one number


@dataclass(frozen=True)
class Counter:
    group: int
    targets: tuple[int, ...]   # one per stage, in stage order
    unit: str = ""             # "" when derived from the descriptions
    unit_one: str | None = None  # the unit after a target of 1, when it is not `unit`: "kill" for "kills"


@dataclass(frozen=True)
class CommissionNote:
    """What the research found about an achievement that comes from a daily commission (spec 11.2)."""

    region: str | None          # given only where the list has none
    quests: tuple[str, ...]     # the commission names, as the game's list shows them, where the list has none
    parts: tuple[str, ...]      # parts after the list's own, for a chain the list gives none (spec 7.2)
    order: bool                 # the parts are done in order, as a chain
    how: str                    # what to choose or do in the commission
    first: str                  # a prerequisite a source names
    sources: tuple[str, ...]


@dataclass(frozen=True)
class AchievementNotes:
    checked_against: str
    counters: Mapping[int, Counter]     # by group id; each is used only when it fits its group: one target per stage
    not_in_order: frozenset[int]        # group ids whose stages are not awarded in order
    wiki: Mapping[int, str]             # stage id -> a wiki page that replaces the search
    commissions: Mapping[int, CommissionNote] = field(default_factory=dict)  # by stage id
    not_commissions: frozenset[int] = frozenset()  # stages checked and found not to come from daily commissions

    def parts(self, stage: Stage) -> tuple[str, ...]:
        """The stage's checklist: the list's parts, keeping Paimon.moe's numbering, then those the notes add."""
        note = self.commissions.get(stage.id)
        return stage.parts + note.parts if note is not None else stage.parts

    def counter(self, catalog: Catalog, group: int) -> Counter | None:
        """The notes' counter for an achievement, or else one derived from its stages' descriptions.

        The notes' counter is used only while it has one target per stage: the notes are kept by hand, and a list
        update can add or drop a stage.
        """
        stages = catalog.group(group)
        noted = self.counters.get(group)
        if noted is not None and len(noted.targets) == len(stages):
            return noted
        targets = derive_targets(stages)
        return None if targets is None else Counter(group, targets)


EMPTY_NOTES = AchievementNotes("", {}, frozenset(), {})


def _counter(group: str, counter: Mapping[str, Any]) -> Counter:
    """One counter of the notes. Its "unit_one" may be left out, when the unit reads right after a target of 1."""
    unit_one = counter.get("unit_one")
    return Counter(
        int(group), tuple(int(target) for target in counter["targets"]), str(counter["unit"]),
        None if unit_one is None else str(unit_one),
    )


def _commission(note: Mapping[str, Any]) -> CommissionNote:
    region = note.get("region")
    return CommissionNote(
        region=None if region is None else str(region),
        quests=tuple(str(quest) for quest in note.get("quests", ())),
        parts=tuple(str(part) for part in note.get("parts", ())),
        order=bool(note.get("order", False)),
        how=str(note.get("how", "")),
        first=str(note.get("first", "")),
        sources=tuple(str(source) for source in note.get("sources", ())),
    )


def parse_notes(data: Mapping[str, Any]) -> AchievementNotes:
    """The notes from the file's JSON. Its "note" and "sources" are for people to read and are left out. Notes from
    before plan 2A-2 hold no commission knowledge."""
    return AchievementNotes(
        checked_against=str(data["checked_against"]),
        counters={int(group): _counter(group, counter) for group, counter in data["counters"].items()},
        not_in_order=frozenset(int(group) for group in data["not_in_order"]),
        wiki={int(stage): str(page) for stage, page in data["wiki"].items()},
        commissions={int(stage): _commission(note) for stage, note in data.get("commissions", {}).items()},
        not_commissions=frozenset(int(stage) for stage in data.get("not_commissions", ())),
    )


@lru_cache(maxsize=1)
def load_notes() -> AchievementNotes:
    text = resources.files("guildboard").joinpath("reference", "achievement_notes.json").read_text(encoding="utf-8")
    return parse_notes(json.loads(text))


def derive_targets(stages: Sequence[Stage]) -> tuple[int, ...] | None:
    """Each stage's target: the one number in the descriptions that changes from stage to stage, when it grows.

    "Catch fish successfully 100 times." ... "2,000 times." gives (100, 500, 2000). Otherwise None, for example for
    stages that count nothing and for a stage that stands alone.
    """
    rows = [[int(n.replace(",", "")) for n in NUMBER.findall(s.description)] for s in stages]
    if len(rows) < 2 or not rows[0] or any(len(r) != len(rows[0]) for r in rows):
        return None
    varying = [i for i in range(len(rows[0])) if len({r[i] for r in rows}) > 1]
    if len(varying) != 1:
        return None
    column = tuple(r[varying[0]] for r in rows)
    return column if all(a < b for a, b in zip(column, column[1:])) else None


def wiki_link(notes: AchievementNotes, stage: Stage) -> str:
    """The page the notes name for a stage, or else a search of the Genshin Impact Wiki for its name."""
    return notes.wiki.get(stage.id) or WIKI_SEARCH + quote(stage.name, safe="")
