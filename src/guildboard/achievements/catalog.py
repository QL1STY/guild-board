"""Paimon.moe's achievement list: reading and checking it, the bundled snapshot, and what changes between two lists."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import cached_property, lru_cache
from importlib import resources
from typing import Any

from guildboard.store import valid_text

UNEXPECTED_SHAPE = "The achievement list does not have the expected shape."
VERSION = re.compile(r"[0-9]{1,9}(?:\.[0-9]{1,9})*")  # at most 9 digits a part, so int() always reads it

# What every stage needs besides its id, in the order it is checked, and the word the player is told is missing.
NEEDED = (("name", str, "name"), ("desc", str, "description"), ("reward", int, "reward"), ("ver", str, "version"))


@dataclass(frozen=True)
class Category:
    key: str          # Paimon's key, for example "0"
    name: str
    order: int


@dataclass(frozen=True)
class Stage:
    id: int           # the game's achievement id
    group: int        # the first stage's id of its tiered achievement; its own id when it stands alone
    order: int        # 1-based place in its group
    name: str
    description: str
    reward: int       # primogems
    version: str      # the version it was added in, for example "7.1"
    category: str     # Category.key
    region: str | None = None        # Paimon's "commissions", for example "liyue"
    quests: tuple[str, ...] = ()     # Paimon's quest names
    parts: tuple[str, ...] = ()      # Paimon's checklist


@dataclass(frozen=True)
class Catalog:
    categories: tuple[Category, ...]   # sorted by order
    stages: tuple[Stage, ...]          # categories in order, stages in file order

    @property
    def version(self) -> str:
        """The highest version among the stages, or "" when there are none."""
        return max((stage.version for stage in self.stages), key=version_key, default="")

    def stage(self, stage_id: int) -> Stage | None:
        return self._by_id.get(stage_id)

    def group(self, group_id: int) -> tuple[Stage, ...]:
        """The stages of one achievement, in order. A stage that stands alone is a group of one."""
        return self._groups.get(group_id, ())

    def category(self, key: str) -> Category | None:
        return next((category for category in self.categories if category.key == key), None)

    @cached_property
    def _by_id(self) -> dict[int, Stage]:
        return {stage.id: stage for stage in self.stages}

    @cached_property
    def _groups(self) -> dict[int, tuple[Stage, ...]]:
        groups: dict[int, list[Stage]] = {}
        for stage in self.stages:
            groups.setdefault(stage.group, []).append(stage)
        return {group: tuple(stages) for group, stages in groups.items()}


class CatalogError(ValueError):
    """An achievement list was refused. The message is fit to show to the player."""


def version_key(version: str) -> tuple[int, ...]:
    """"7.10" -> (7, 10), so that 7.10 comes after 7.9. Anything that is not a version number -> (0,)."""
    if not VERSION.fullmatch(version):
        return (0,)
    return tuple(int(part) for part in version.split("."))


def _is(value: Any, kind: type) -> bool:
    """isinstance, except that JSON's true and false do not count as numbers."""
    return isinstance(value, kind) and not isinstance(value, bool)


def _strings(value: Any) -> tuple[str, ...]:
    if not (_is(value, list) and all(_is(text, str) for text in value)):
        raise CatalogError(UNEXPECTED_SHAPE)
    return tuple(valid_text(text) for text in value)


def _stage(item: Any, category: str, order: int, group: int | None) -> Stage:
    """One stage of the list. `group` is the id of its achievement's first stage, or None when this is the first."""
    if not _is(item, dict):
        raise CatalogError(UNEXPECTED_SHAPE)
    stage_id = item.get("id")
    if not _is(stage_id, int):
        raise CatalogError("An achievement in the list has no number.")
    for key, kind, word in NEEDED:
        if not _is(item.get(key), kind):
            raise CatalogError(f"Achievement {stage_id} is missing its {word}.")
    if "commissions" in item and not _is(item["commissions"], str):
        raise CatalogError(UNEXPECTED_SHAPE)
    quest = item.get("quest", {"name": []})
    if not _is(quest, dict):
        raise CatalogError(UNEXPECTED_SHAPE)
    region = item.get("commissions")
    return Stage(
        id=stage_id,
        group=stage_id if group is None else group,
        order=order,
        name=valid_text(item["name"]),
        description=valid_text(item["desc"]),
        reward=item["reward"],
        version=valid_text(item["ver"]),
        category=category,
        region=None if region is None else valid_text(region),
        quests=_strings(quest.get("name")),
        parts=_strings(item.get("checklist", [])),
    )


def parse_catalog(raw: bytes) -> Catalog:
    """Read Paimon.moe's en.json, checking everything Guild Board uses. A problem raises CatalogError.

    The list is downloaded and its text reaches the pages, so half of an emoji in any text it keeps becomes U+FFFD."""
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError):  # not UTF-8, not JSON, or JSON nested too deep to read
        raise CatalogError("The achievement list is not valid JSON.") from None
    if not _is(data, dict) or not data:
        raise CatalogError(UNEXPECTED_SHAPE)
    listed: list[tuple[Category, list[Any]]] = []
    for key, value in data.items():
        if not (
            _is(value, dict) and _is(value.get("name"), str)
            and _is(value.get("order"), int) and _is(value.get("achievements"), list)
        ):
            raise CatalogError(UNEXPECTED_SHAPE)
        listed.append((Category(valid_text(key), valid_text(value["name"]), value["order"]), value["achievements"]))
    listed.sort(key=lambda pair: pair[0].order)
    stages: list[Stage] = []
    seen: set[int] = set()
    for category, entries in listed:
        for entry in entries:
            tier = entry if _is(entry, list) else [entry]
            if not tier:
                raise CatalogError(UNEXPECTED_SHAPE)
            group: int | None = None
            for order, item in enumerate(tier, start=1):
                stage = _stage(item, category.key, order, group)
                if stage.id in seen:
                    raise CatalogError(f"Achievement {stage.id} appears twice.")
                seen.add(stage.id)
                stages.append(stage)
                group = stage.group
    return Catalog(tuple(category for category, _ in listed), tuple(stages))


def bundled_raw() -> bytes:
    """The snapshot of Paimon.moe's list that ships with Guild Board, byte for byte."""
    return resources.files("guildboard").joinpath("reference", "achievements.json").read_bytes()


@lru_cache(maxsize=1)
def bundled_catalog() -> Catalog:
    return parse_catalog(bundled_raw())


@lru_cache(maxsize=1)
def bundled_date() -> str:
    """The day the bundled snapshot was committed to Paimon.moe, for example "2026-09-23"."""
    text = resources.files("guildboard").joinpath("reference", "achievements.source.json").read_text(encoding="utf-8")
    return str(json.loads(text)["committed"])


# The fields two lists are compared on, in this order: a stage whose name, description or reward differs has changed.
COMPARED = ("name", "description", "reward")


@dataclass(frozen=True)
class CatalogDiff:
    added: tuple[Stage, ...]
    changed: tuple[tuple[Stage, Stage], ...]   # (old, new), when they differ in a field of COMPARED
    removed: tuple[Stage, ...]


def _compared(stage: Stage) -> tuple[Any, ...]:
    """A stage's values in the fields of COMPARED."""
    return tuple(getattr(stage, field) for field in COMPARED)


def diff_catalogs(old: Catalog, new: Catalog) -> CatalogDiff:
    """What the new list adds, changes and no longer lists, matching stages by id."""
    pairs = [(old.stage(stage.id), stage) for stage in new.stages]
    return CatalogDiff(
        added=tuple(after for before, after in pairs if before is None),
        changed=tuple(
            (before, after) for before, after in pairs if before is not None and _compared(before) != _compared(after)
        ),
        removed=tuple(stage for stage in old.stages if new.stage(stage.id) is None),
    )
