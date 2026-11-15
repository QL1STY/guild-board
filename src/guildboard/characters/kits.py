"""The kit data (reference/characters/kits.json): each character's hits and the kind of each, her infusions, the effects
her passives, constellations and states add, and her weapon's and sets', as Genshin Optimizer's Waverider sheets give them
at a pinned commit. tools/go-reference generates the file at build time; the app only reads it (spec, section 14).

`kit_of` gives one build's kit: the effects whose gates hold at her constellation, ascension, weapon refinement and set
piece counts, with a weapon's numbers taken at its refinement. Percentage stats are fractions, as in the file (its schema
says how an effect reads)."""
from __future__ import annotations

import copy
from functools import lru_cache
from typing import Any, Mapping

from guildboard.characters import reference

FILE = "kits.json"


@lru_cache(maxsize=1)
def load_kits() -> dict[str, Any]:
    """kits.json as it is: {"go_commit", "characters", "weapons", "sets"}."""
    return reference._read(FILE)


def _empty() -> dict[str, Any]:
    return {"checked": False, "main": None, "stellar": None, "hits": {}, "elements": {}, "moves": {}, "infused": [], "effects": [],
            "toggles": [], "party": None, "absent_rows": {}, "derived_rows": []}


def _absent_rows(gates: Mapping[str, Mapping[str, Mapping[str, int]]] | None, constellation: int) -> dict[str, list[str]]:
    """The rows her kit does not deal at this constellation (`row_gates`): a row dealt only from a constellation, or only below one."""
    out: dict[str, list[str]] = {}
    for talent, rows in (gates or {}).items():
        names = [name for name, gate in rows.items()
                 if constellation < gate.get("from", 0) or (gate.get("below") is not None and constellation >= gate["below"])]
        if names:
            out[talent] = names
    return out


def _holds(effect: Mapping[str, Any], constellation: int, ascension: int, weapon_type: str | None,
           pieces: int | None = None) -> bool:
    if effect.get("from_constellation") is not None and constellation < effect["from_constellation"]:
        return False
    if effect.get("from_ascension") is not None and ascension < effect["from_ascension"]:
        return False
    if effect.get("weapon_types") is not None and weapon_type not in effect["weapon_types"]:
        return False
    if effect.get("pieces") is not None and (pieces is None or pieces < effect["pieces"]):
        return False
    return True


def _at_refinement(effect: Mapping[str, Any], refinement: int) -> dict[str, Any]:
    """A weapon's effect with its numbers at `refinement` (1 to 5)."""
    out = dict(effect)
    index = min(max(int(refinement), 1), 5) - 1
    for key in ("rate", "cap"):
        if isinstance(out.get(key), list) and len(out[key]) == 5:
            out[key] = out[key][index]
    return out


def _read_by(effects: list[dict[str, Any]]) -> set[str]:
    """The toggles these effects hold behind: each one's `while` and the `also` of an effect that reads more than one state."""
    return {name for e in effects for name in ([e["while"]] if e.get("while") else []) + list(e.get("also") or ())}


def kit_key(key: str, element: str | None) -> str | None:
    """The file's key for the app's character `key`: the Traveler is one character in the app (`traveler`) and one entry per
    element in the file (`traveler-geo`), so hers is read from her record's element, and None when it has none. Any other key is
    its own."""
    if key != "traveler":
        return key
    return f"traveler-{element.casefold()}" if element else None


def kit_of(key: str, constellation: int, ascension: int, weapon: str, refinement: int,
           sets: Mapping[str, int], element: str | None = None) -> dict[str, Any]:
    """Her kit for this build: {"checked", "unsure" (why the comparison with Genshin Optimizer could not prove her kit, or None), "main", "stellar" (the Stellar kind a person fixed for her, or None), "hits", "elements", "moves", "infused", "effects", "toggles", "party", "absent_rows" (the rows she does not deal at this constellation, by talent), "derived_rows" (rows of her Skill or Burst that copy another talent's numbers: Sethos's Dusk Bolts)}. The
    effects and toggles are hers, her weapon's and her sets'; a toggle is given only when an effect or infusion that holds
    for this build reads it. A character the file does not have gives `checked: False` and nothing else. Everything given
    is a copy: changing it never changes the loaded file. `element` is her record's, for the Traveler's key (`kit_key`)."""
    data = load_kits()
    file_key = kit_key(key, element)   # `element` is her record's: only the Traveler's key needs it
    character = data["characters"].get(file_key) if file_key is not None else None
    if character is None:
        return _empty()
    weapon_type = character.get("weapon_type")
    effects = [copy.deepcopy(e) for e in character["effects"] if _holds(e, constellation, ascension, weapon_type)]
    toggles = list(character["toggles"])
    gear = data["weapons"].get(weapon)
    if gear is not None:
        effects += [_at_refinement(copy.deepcopy(e), refinement) for e in gear["effects"]
                    if _holds(e, constellation, ascension, weapon_type)]
        toggles += gear["toggles"]
    for set_key, count in sorted(sets.items()):
        piece = data["sets"].get(set_key)
        if piece is None or count < 2:
            continue
        effects += [copy.deepcopy(e) for e in piece["effects"] if _holds(e, constellation, ascension, weapon_type, count)]
        toggles += piece["toggles"]
    # an infusion behind her ascension or a constellation (Chiori's A1, Dori's C6) is given where it holds, without its gates
    infused = [{key: value for key, value in copy.deepcopy(item).items() if key not in ("from_ascension", "from_constellation")}
               for item in character["infused"] if _holds(item, constellation, ascension, None)]
    read = _read_by(effects) | {i["while"] for i in infused if i.get("while")}
    return {
        "checked": bool(character["checked"]), "unsure": character.get("unsure"), "main": copy.deepcopy(character["main"]),
        "stellar": character.get("stellar"),
        "hits": copy.deepcopy(character["hits"]), "elements": copy.deepcopy(character["elements"]),
        "moves": copy.deepcopy(character["moves"]), "infused": infused, "effects": effects,
        "toggles": [copy.deepcopy(t) for t in toggles if t["name"] in read],
        "party": copy.deepcopy(character.get("party")),
        "absent_rows": _absent_rows(character.get("row_gates"), constellation),
        "derived_rows": copy.deepcopy(character.get("derived_rows") or []),
    }


def gear_of(kind: str, key: str, constellation: int, ascension: int, weapon_type: str | None) -> dict[str, Any]:
    """A weapon's ("weapons") or a set's ("sets") effects and toggles as the planner ships them for one character: the effects
    whose gates other than the set pieces hold for her, a weapon's numbers still by refinement (the interface takes the
    tested weapon's refinement itself) and a set's piece counts left as gates for it to check, and the toggles those effects
    read. Copies; nothing for a key the file does not have."""
    item = load_kits()[kind].get(key)
    if item is None:
        return {"effects": [], "toggles": []}
    effects = [copy.deepcopy(e) for e in item["effects"] if _holds(e, constellation, ascension, weapon_type, 4)]
    read = _read_by(effects)
    return {"effects": effects, "toggles": [copy.deepcopy(t) for t in item["toggles"] if t["name"] in read]}
