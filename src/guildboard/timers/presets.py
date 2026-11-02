"""The timers Guild Board knows before the player makes any: the Unusual Hilichurl, the teapot's three fields and the
fishing spots, read from reference/timers.json with the sources each one comes from."""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Any, Mapping

from guildboard.config import FISHING_REGION_NAMES
from guildboard.timers.rules import Rule, parse_rule


@dataclass(frozen=True)
class Preset:
    key: str                  # "hilichurl", "teapot.jade_field", "fishing.luhua_pool"
    name: str
    place: str
    rule: Rule
    about: str                # the rule in words; "" for a fishing spot, whose sentence follows the fishing setting
    stages: tuple[int, ...]   # the achievement stages it serves
    counter: int | None       # the achievement whose count goes up by one at each Cleared (the hilichurl's kills)
    group: str                # where "Add a pre-set timer" lists it
    region: str | None        # a fishing spot's region
    default: bool             # added once, at the first start, while its achievement has stages left
    icon: str | None          # official art on HoYoverse's servers, where the research found some


@dataclass(frozen=True)
class Presets:
    checked: str
    presets: Mapping[str, Preset]       # by key, in the file's order: the pre-sets, then the fishing spots
    fishing_about: Mapping[str, str]    # a fishing spot's rule in words, by fishing setting

    def about(self, preset: Preset, fishing: str) -> str:
        if preset.rule.kind != "fishing":
            return preset.about
        return self.fishing_about.get(fishing) or self.fishing_about["3_days"]


def parse_presets(data: Mapping[str, Any]) -> Presets:
    """The pre-sets from the file's JSON. Its "note" and "sources" are for people to read and are left out."""
    presets: dict[str, Preset] = {}
    for item in data["presets"]:
        counter = item.get("counter")
        presets[item["key"]] = Preset(
            key=item["key"], name=item["name"], place=item.get("place", ""), rule=parse_rule(item["rule"]),
            about=item["about"], stages=tuple(int(stage) for stage in item["stages"]),
            counter=None if counter is None else int(counter), group=item["group"], region=None,
            default=bool(item.get("default", False)), icon=item.get("icon"),
        )
    fishing = data["fishing"]
    for spot in fishing["spots"]:
        key = f"fishing.{spot['key']}"
        presets[key] = Preset(
            key=key, name=f"Fishing spot · {spot['name']}, {FISHING_REGION_NAMES[spot['region']]}", place="",
            rule=Rule("fishing"), about="", stages=tuple(int(stage) for stage in fishing["stages"]), counter=None,
            group="Fishing spots", region=spot["region"], default=False, icon=fishing.get("icon"),
        )
    return Presets(str(data["checked"]), presets, dict(fishing["about"]))


@lru_cache(maxsize=1)
def load_presets() -> Presets:
    text = resources.files("guildboard").joinpath("reference", "timers.json").read_text(encoding="utf-8")
    return parse_presets(json.loads(text))
