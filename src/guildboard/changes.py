"""What changed in each version, for the list after an update and the notes in Settings."""
from __future__ import annotations

import json
from importlib import resources
from typing import Any, TypedDict

KINDS = ("new", "better", "fixed")


class ChangeItem(TypedDict):
    """One change: its kind (None for a plain line from before kinds), a short title and one line of text."""

    kind: str | None
    title: str
    text: str


def read_items(entries: Any) -> list[ChangeItem]:
    """The items of one version. A plain string, as the older entries are, becomes an item with no kind, so that they
    need not be rewritten. Anything else the file gets wrong is refused when it loads, not on the player's screen."""
    items: list[ChangeItem] = []
    for entry in entries:
        if isinstance(entry, str):
            items.append({"kind": None, "title": entry, "text": ""})
        elif (
            isinstance(entry, dict)
            and entry.get("kind") in KINDS
            and isinstance(entry.get("title"), str)
            and isinstance(entry.get("text"), str)
        ):
            items.append({"kind": entry["kind"], "title": entry["title"], "text": entry["text"]})
        else:
            raise ValueError(f"A change in changes.json is neither a line nor a kind, title and text: {entry!r}")
    return items


def load_changes() -> dict[str, list[ChangeItem]]:
    """The notes of each version, newest first: the order of the file, which is by version number."""
    text = resources.files("guildboard").joinpath("reference", "changes.json").read_text(encoding="utf-8")
    return {version: read_items(entries) for version, entries in json.loads(text).items()}
