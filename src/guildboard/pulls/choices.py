"""What Add a wish offers on the Pulls planner: every character and weapon that can be wished for, each with its face
and rank, in four groups shown in this order: coming soon, on the banners now, every 5★, every 4★; by name within each.

The names come from the Characters reference's inventory and from the HoYoLAB wiki's lists kept in the database, so a
character newer than the inventory (Mitya, 7.2) is offered as soon as the wiki lists them. The ones coming soon come
from `reference/upcoming.json`, a short list written by hand when new characters are announced; each leaves that group
by itself once the inventory or the wiki lists them. Nothing here is fetched."""
from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from importlib import resources
from typing import Any, Iterable, Mapping

from guildboard.pulls.wiki import icon_key
from guildboard.store import BannerRow, WikiItemRow

GROUPS = ("soon", "now", "five", "four")
# No wish gives these: the Traveler, the Manekins, and Aloy, who was a gift.
NOT_WISHED_FOR = ("traveler", "manekin", "aloy")
KINDS = {"character": "characters", "weapon": "weapons"}


@lru_cache(maxsize=1)
def load_upcoming() -> tuple[str, ...]:
    """The characters announced and not out yet, by name."""
    text = resources.files("guildboard").joinpath("reference", "upcoming.json").read_text(encoding="utf-8")
    return tuple(str(name) for name in json.loads(text)["characters"])


def _wished_for(kind: str, name: str, rank: int) -> bool:
    if kind == "weapon":
        return rank >= 4
    return not name.lower().startswith(NOT_WISHED_FOR)


def wish_choices(
    inventory: Mapping[str, Any],
    wiki: Mapping[tuple[str, str], WikiItemRow],
    upcoming: Iterable[str],
    banners: Iterable[BannerRow],
    now: datetime,
) -> dict[str, list[dict[str, Any]]]:
    """{"characters": [...], "weapons": [...]}, each choice {name, kind, rank, group, icon, ends_at}. The rank is the
    inventory's, else the wiki's, else 5, as the wishlist counts a name it cannot rank. `ends_at` is the end of the
    running banner that features the choice, which the form takes as its day; None for one on no banner now."""
    running: dict[tuple[str, str], datetime] = {}
    for banner in banners:
        if banner.pool in KINDS and banner.starts_at <= now < banner.ends_at:
            for name in banner.featured:
                running[(banner.pool, name)] = max(banner.ends_at, running.get((banner.pool, name), banner.ends_at))
    out: dict[str, list[dict[str, Any]]] = {}
    for kind, plural in KINDS.items():
        ranks: dict[str, int] = {}
        for entry in inventory.get(plural, ()):
            ranks[str(entry["name"])] = int(entry.get("rarity") or 0)
        for (item_kind, name), row in wiki.items():
            if item_kind == kind and name not in ranks:
                ranks[name] = row.rank
        listed = {name.lower() for name in ranks}
        choices: list[dict[str, Any]] = []
        if kind == "character":
            for name in upcoming:
                if name.lower() not in listed:
                    choices.append(_choice(name, kind, 5, "soon", None, None))
        for name, rank in ranks.items():
            rank = rank or 5
            if not _wished_for(kind, name, rank):
                continue
            ends = running.get((kind, name))
            group = "now" if ends is not None else "five" if rank >= 5 else "four"
            icon = f"/api/icon/{icon_key(kind, name)}" if (kind, name) in wiki else None
            choices.append(_choice(name, kind, rank, group, icon, ends.isoformat() if ends else None))
        order = {group: index for index, group in enumerate(GROUPS)}
        choices.sort(key=lambda choice: (order[choice["group"]], choice["name"].casefold()))
        out[plural] = choices
    return out


def _choice(name: str, kind: str, rank: int, group: str, icon: str | None, ends_at: str | None) -> dict[str, Any]:
    return {"name": name, "kind": kind, "rank": rank, "group": group, "icon": icon, "ends_at": ends_at}
