"""Turns what the gb-*.spec.ts files write in a Genshin Optimizer checkout into Guild Board's kit data (kits.json).

gb-kit.json holds each Waverider sheet's effect data as trees, gb-match.json each damage hit with the datamined parameter
its multiplier is and the in-game rows that print it. Here:

- every effect a sheet adds is simplified for her alone (she is the active character and the target, the party is
  unknown), split into the terms of its sums, and read as `gate(min(rate × stat [− over], cap))`, the Effect form of
  kits.json; party-dependent terms (they read the party's tally, the non-stacking slots or another member) are listed under
  `left_out`, unless her decision file gives the team shapes her damage depends on (`party`): her sheet is then read once for
  each shape and an effect that differs by shape holds `party`. What is not of that form is listed under `left_out` with the reason;
- a term that reads one of her states (GO's conditionals) is read at the state chosen for it (her decision file, else the
  state that gives the most: "on", or the largest stack count) and written `while` that state's toggle;
- each hit's rows: GO's hit → its parameter → the rows printing it; rows with the same numbers are told apart by the
  hit's kind (go-engine.md 3);
- decided/<key>.json, one file per character written by a person (`load_decided`), says which of her toggles are on, with
  a label in our own words, and which rows are her main ones; the generator checks that every toggle of a checked
  character is decided. decided/weapons/<key>.json and decided/sets/<key>.json do the same for a weapon's or a set's toggles; with
  no file a gear toggle is off and switchable.

Units are GO's: a percentage stat is a fraction (0.466 is 46.6%), Elemental Mastery and flat stats are whole numbers."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

ELEMENTS = ("pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro")
MOVES = ("normal", "charged", "plunging", "skill", "burst")
REACTIONS = {
    "lunarbloom": "lunar-bloom", "lunarcharged": "lunar-charged", "lunarcrystallize": "lunar-crystallize",
    "stellarconduct": "stellar-conduct", "stellarswirl": "stellar-swirl",
    "vaporize": "vaporize", "melt": "melt", "aggravate": "aggravate", "spread": "spread",
}
LUNAR_STELLAR = ("lunar-bloom", "lunar-charged", "lunar-crystallize", "stellar-conduct", "stellar-swirl")
TALENT_OF_PARAMS = {"auto": "normal", "skill": "skill", "burst": "burst"}
MOVE_OF = {"normal": "normal", "charged": "charged", "plunging": "plunging", "plunging_collision": "plunging",
           "plunging_impact": "plunging", "skill": "skill", "burst": "burst"}
STAT_OF = {"atk": "atk", "hp": "hp", "def": "def", "eleMas": "em", "enerRech_": "er", "critRate_": "cr", "critDMG_": "cd"}
SIMPLE_BUCKETS = {
    "atk": "atk", "hp": "hp", "def": "def", "eleMas": "em", "enerRech_": "er", "critRate_": "cr", "critDMG_": "cd",
    "heal_": "heal", "atk_": "atk%", "hp_": "hp%", "def_": "def%", "all_dmg_": "dmg", "physical_dmg_": "physical",
    "all_dmgInc": "additive",
}
# Keys a sheet sets that are not damage the verdict counts: talent level boosts (HoYoLAB's levels have them), her own
# resistances, stamina, cooldowns, shields, speed, healing received, the transformative reactions (out of the verdict).
QUIET = re.compile(
    r"^(?:\w+Boost|\w+_res_|stamina\w*|cdRed_|\w*shield\w*|atkSPD_|moveSPD_|\w+_atkSPD_|incHeal_|healInc|"
    r"(?:overloaded|shattered|electrocharged|superconduct|swirl|burning|bloom|hyperbloom|burgeon|crystallize)\w*|"
    r"\w+_enemyRes_|enemyDefRed_|enemyDefIgn_|\w+_mult_|\w+_reactionDmgInc|\w+_cdRed_|weakspotDMG_|dmgRed_|"
    r"\w+_dmgRed_|\w+_hitRes_|\w*infusion\w*|\w*Index)$"
)
# what only the team decides: a term that reads these is the team's, whether or not the team shapes differ in it (never on the panel)
DERIVED_READS = ("tally.", "nonStacking.", "active.flags", "inactive")
PARTY_READS = ("tally.", "nonStacking.", "active.", "inactive", "flags.", "target.", "enemy.", "activeCharKey", "teamBuff.")


# ------------------------------------------------------------------------------------------------- trees


def const(value: Any) -> dict:
    return {"op": "const", "v": value}


def is_const(node: Any) -> bool:
    return isinstance(node, dict) and node.get("op") == "const"


def value_of(node: dict) -> Any:
    return node.get("v")


def show(node: Any) -> str:
    """A tree as a short expression, for `left_out` and the report."""
    if node is None:
        return "none"
    if not isinstance(node, dict) or "op" not in node:
        return json.dumps(node)
    op = node["op"]
    x = [show(n) for n in node.get("x", [])]
    if op == "const":
        v = node.get("v")
        return str(round(v, 8)) if isinstance(v, float) else json.dumps(v)
    if op == "read":
        return node["p"]
    if op == "subscript":
        items = node["list"]
        return f"[{', '.join(str(round(v, 6)) for v in items[:3])}{', …' if len(items) > 3 else ''}][{x[0]}]"
    if op == "lookup":
        table = ", ".join(f"{k}: {show(v)}" for k, v in node.get("table", {}).items())
        return f"lookup({', '.join(x)}, {{{table}}})"
    if op == "match" and len(x) == 4:
        return f"({x[0]} == {x[1]} ? {x[2]} : {x[3]})"
    if op == "threshold" and len(x) == 4:
        return f"({x[0]} >= {x[1]} ? {x[2]} : {x[3]})"
    return f"{op}({', '.join(x)})"


def reads(node: Any, found: set[str] | None = None) -> set[str]:
    found = set() if found is None else found
    if isinstance(node, dict):
        if node.get("op") == "read":
            found.add(node["p"])
        for child in node.get("x", []) or []:
            reads(child, found)
        for child in (node.get("table") or {}).values():
            reads(child, found)
    return found


def _num(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return float("nan")  # a word (an element's name) is no number: every comparison with it is false
    return float(v)


def simplify(node: Any, env: dict[str, Any]) -> Any:
    """Fold everything `env` decides: reads it knows become constants, then gates and arithmetic on constants fold."""
    if not isinstance(node, dict) or "op" not in node:
        return node
    op = node["op"]
    if op == "const":
        return node
    if op == "read":
        return const(env[node["p"]]) if node["p"] in env else node
    x = [simplify(n, env) for n in node.get("x", []) or []]
    if op == "data":
        return x[0] if x else const(None)
    if op in ("match", "threshold"):
        a, b, yes, no = (x + [const(None)] * 4)[:4]
        if is_const(a) and is_const(b):
            if op == "match":
                hit = value_of(a) == value_of(b)
            else:
                hit = value_of(a) is not None and value_of(b) is not None and _num(value_of(a)) >= _num(value_of(b))
            return yes if hit else no
        if is_const(yes) and is_const(no) and value_of(yes) == value_of(no):
            return yes
        return {**node, "x": [a, b, yes, no]}
    if op == "lookup":
        table = {k: simplify(v, env) for k, v in (node.get("table") or {}).items()}
        index = x[0]
        default = x[1] if len(x) > 1 else const(None)
        if is_const(index):
            v = value_of(index)
            key = None if v is None else (str(int(v)) if isinstance(v, (int, float)) and float(v).is_integer() else str(v))
            return table.get(key, default) if key is not None else default
        return {**node, "x": x, "table": table}
    if op == "subscript":
        if is_const(x[0]) and value_of(x[0]) is not None:
            return const(node["list"][int(value_of(x[0]))])
        return {**node, "x": x}
    if op in ("prio", "small"):
        values = []
        for n in x:
            if not is_const(n):
                return {**node, "x": x}
            if value_of(n) is not None:
                values.append(value_of(n))
        if not values:
            return const(None)
        return const(values[0] if op == "prio" else min(values))
    if op in ("add", "mul", "min", "max"):
        consts = [value_of(n) for n in x if is_const(n)]
        rest = [n for n in x if not is_const(n)]
        if op == "add":
            folded = sum(_num(v) for v in consts)
            keep = rest + ([const(folded)] if folded != 0 or not rest else [])
        elif op == "mul":
            folded = 1.0
            for v in consts:
                folded *= _num(v)
            if folded == 0:
                return const(0)
            keep = rest + ([const(folded)] if folded != 1 or not rest else [])
        else:
            nums = [_num(v) for v in consts]
            keep = rest + ([const(min(nums) if op == "min" else max(nums))] if nums else [])
        if len(keep) == 1:
            return keep[0]
        return {**node, "x": keep}
    if op == "sum_frac" and all(is_const(n) for n in x):
        a, b = _num(value_of(x[0])), _num(value_of(x[1]))
        return const(a / (a + b) if a + b else 0.0)
    return {**node, "x": x}


GATE_READS = ("asc", "constellation", "hit.move", "weaponType")


def _is_gate(node: Any) -> bool:
    """A threshold on her ascension, constellation or a set's pieces, or a match on the move or weapon type, that gives 0
    when it does not hold."""
    if not (isinstance(node, dict) and node.get("op") in ("threshold", "match") and len(node.get("x", [])) == 4):
        return False
    x = node["x"]
    if not (is_const(x[3]) and _num(value_of(x[3])) == 0):
        return False
    paths = [_read_path(x[0]), _read_path(x[1])]
    return any(p and (p in GATE_READS or p.startswith("artSet.")) for p in paths)


def normalise(node: Any, depth: int = 0) -> Any:
    """Gates lifted out of products and caps, sums multiplied out, and a gate with two values split into a base and a
    step (`c >= 6 ? 1.125 : 0.75` is 0.75 + (c >= 6 ? 0.375 : 0)), so that each term reads as one Effect."""
    if not isinstance(node, dict) or "op" not in node or depth > 40:
        return node
    op = node["op"]
    x = [normalise(n, depth + 1) for n in node.get("x", []) or []]
    node = {**node, "x": x} if "x" in node else node
    if op == "threshold" and len(x) == 4 and is_const(x[2]) and is_const(x[3]) and _num(value_of(x[3])) != 0 \
            and isinstance(value_of(x[2]), (int, float)) and isinstance(value_of(x[3]), (int, float)) \
            and (_read_path(x[0]) in ("asc", "constellation")):
        step = _num(value_of(x[2])) - _num(value_of(x[3]))
        return {"op": "add", "x": [x[3], {**node, "x": [x[0], x[1], const(step), const(0)]}]}
    if op == "add":
        flat = []
        for n in x:
            flat += n["x"] if isinstance(n, dict) and n.get("op") == "add" else [n]
        return {"op": "add", "x": flat}
    if op == "mul":
        factors = _factors(node)
        gate = next((f for f in factors if _is_gate(f)), None)
        if gate is not None:
            rest = [f for f in factors if f is not gate]
            inner = normalise({"op": "mul", "x": rest + [gate["x"][2]]}, depth + 1)
            return {**gate, "x": [gate["x"][0], gate["x"][1], inner, const(0)]}
        sums = [f for f in factors if isinstance(f, dict) and f.get("op") == "add"]
        if sums:
            first = sums[0]
            rest = [f for f in factors if f is not first]
            # a sum that counts the party is kept whole: multiplied out, Zibai's `(tally.geo − 1) × 0.15` would leave an
            # always-on −0.15 beside the party term (a gated party bonus, `1 + (hexerei >= 2 ? 0.75 : 0)`, still splits)
            counts = any(_is_party(t) and not (isinstance(t, dict) and t.get("op") in ("threshold", "match")) for t in first["x"])
            if len(first["x"]) <= 8 and not _over_shape(first) and not counts:
                return {"op": "add", "x": [normalise({"op": "mul", "x": rest + [t]}, depth + 1) for t in first["x"]]}
        return {"op": "mul", "x": factors}
    if op == "min" and len(x) == 2:
        gate = next((n for n in x if _is_gate(n)), None)
        other = next((n for n in x if n is not gate), None)
        if gate is not None and is_const(other) and _num(value_of(other)) >= 0:
            inner = normalise({"op": "min", "x": [gate["x"][2], other]}, depth + 1)
            return {**gate, "x": [gate["x"][0], gate["x"][1], inner, const(0)]}
    if op == "max" and len(x) == 2 and any(is_const(n) and _num(value_of(n)) == 0 for n in x):
        gate = next((n for n in x if _is_gate(n)), None)
        if gate is not None:
            inner = normalise({"op": "max", "x": [gate["x"][2], const(0)]}, depth + 1)
            return {**gate, "x": [gate["x"][0], gate["x"][1], inner, const(0)]}
    return node


def _over_shape(node: dict) -> bool:
    """`stat − k`: kept whole, it is an Effect's `over`."""
    return len(node["x"]) == 2 and any(is_const(n) for n in node["x"]) and any(
        _read_path(n) and _stat(n["p"]) for n in node["x"])


def terms_of(node: Any) -> list[Any]:
    """The terms of a sum, each one effect (a sum of constants stays one); a gate over a sum gates each term."""
    if isinstance(node, dict) and node.get("op") == "add" and any(not is_const(n) for n in node.get("x", [])):
        out = []
        for n in node["x"]:
            out += terms_of(n)
        return out
    if _is_gate(node) or (isinstance(node, dict) and node.get("op") == "match" and len(node.get("x", [])) == 4
                          and is_const(node["x"][3]) and _num(value_of(node["x"][3])) == 0):
        inner = terms_of(node["x"][2])
        if len(inner) > 1:
            return [{**node, "x": [node["x"][0], node["x"][1], t, const(0)]} for t in inner]
    return [node]


def conditionals(node: Any) -> dict[str, list[str]]:
    """The states each conditional this tree reads is compared with, in order of appearance."""
    found: dict[str, list[str]] = {}

    def visit(n: Any) -> None:
        if not isinstance(n, dict):
            return
        op = n.get("op")
        x = n.get("x", []) or []
        if op == "match" and len(x) >= 2:
            for a, b in ((x[0], x[1]), (x[1], x[0])):
                if isinstance(a, dict) and a.get("op") == "read" and a["p"].startswith("conditional.") and is_const(b):
                    states = found.setdefault(a["p"], [])
                    if value_of(b) is not None and str(value_of(b)) not in states:
                        states.append(str(value_of(b)))
        if op == "lookup" and x and isinstance(x[0], dict) and x[0].get("op") == "read" and x[0]["p"].startswith("conditional."):
            states = found.setdefault(x[0]["p"], [])
            for key in n.get("table", {}):
                if key not in states:
                    states.append(key)
        if op == "read" and n["p"].startswith("conditional."):
            found.setdefault(n["p"], [])
        for child in x:
            visit(child)
        for child in (n.get("table") or {}).values():
            visit(child)

    visit(node)
    return found


def conditionals_in(trees: Any) -> dict[str, list[str]]:
    """conditionals() over every tree in a nest of dicts and lists."""
    found: dict[str, list[str]] = {}

    def visit(obj: Any) -> None:
        if isinstance(obj, dict) and "op" in obj:
            for path, states in conditionals(obj).items():
                known = found.setdefault(path, [])
                known += [s for s in states if s not in known]
        elif isinstance(obj, dict):
            for value in obj.values():
                visit(value)
        elif isinstance(obj, list):
            for value in obj:
                visit(value)

    visit(trees)
    return found


def best_state(states: list[str]) -> str | None:
    """The state that gives the most when nobody decided: the largest stack count, else "on", else the first."""
    numbers = [s for s in states if re.fullmatch(r"-?\d+(\.\d+)?", s)]
    if numbers:
        return max(numbers, key=float)
    if "on" in states:
        return "on"
    return states[0] if states else None


# ------------------------------------------------------------------------------------------------- the Effect form


class NotLinear(Exception):
    pass


@dataclass
class Context:
    """What the generator knows when it reads an effect: the talent parameters (to name a talent-scaled rate's row)."""
    params: dict[str, list[list[float] | None]] = field(default_factory=dict)
    rows: dict[str, list[dict]] = field(default_factory=dict)
    elements: frozenset[str] = frozenset()   # the elements her rows deal: a bonus of two states to another element is not for them
    reach_rows: list[tuple[str, str, str, str]] = field(default_factory=list)   # (talent, row, kind, move) of her rows, for `reaches`

    def row_of(self, levels: list[float]) -> dict | None:
        for talent, arrays in self.params.items():
            for index, array in enumerate(arrays):
                if array and len(array) == len(levels) and all(abs(a - b) < 1e-9 for a, b in zip(array, levels)):
                    for row in self.rows.get(talent, []):
                        if index in row["params"]:
                            return {"talent": TALENT_OF_PARAMS[talent], "name": row["name"]}
        return None


# a second stat an effect multiplies by: GO's path → (the engine's stat, whether it is read before the conversions)
TIMES_OF = {"premod.heal_": ("heal", "premod"), "total.heal_": ("heal", "final")}


def _stat(path: str) -> tuple[str, str] | None:
    """A stat read as (stat, reads): `premod.atk` is the panel's ATK, `total.atk` the final one, `base.atk` base ATK."""
    head, _, key = path.partition(".")
    if head == "base" and key == "atk":
        return "base_atk", "premod"
    if head in ("premod", "total") and key in STAT_OF:
        return STAT_OF[key], "premod" if head == "premod" else "final"
    return None


def _read_path(node: Any) -> str | None:
    return node["p"] if isinstance(node, dict) and node.get("op") == "read" else None


def linear(node: Any, ctx: Context) -> dict:
    """`node` as an Effect's numbers and gates, or NotLinear."""
    out: dict[str, Any] = {"from": None, "reads": None, "rate": None, "cap": None, "cap_from": None, "over": None,
                           "pieces": None, "from_ascension": None, "from_constellation": None, "talents": None,
                           "weapon_types": None, "row": None, "times": None}
    # the gates, outermost first
    while isinstance(node, dict) and node.get("op") in ("threshold", "match", "lookup"):
        op, x = node["op"], node.get("x", [])
        if op == "threshold" and len(x) == 4 and is_const(x[3]) and _num(value_of(x[3])) == 0 and is_const(x[1]):
            path = _read_path(x[0])
            k = value_of(x[1])
            if path == "asc":
                out["from_ascension"] = int(k)
            elif path == "constellation":
                out["from_constellation"] = max(int(k), out["from_constellation"] or 0)
            elif path and path.startswith("artSet."):
                out["pieces"] = int(k)
            else:
                raise NotLinear(f"a gate on {show(x[0])}")
            node = x[2]
            continue
        if op == "match" and len(x) == 4 and is_const(x[3]) and _num(value_of(x[3])) == 0:
            a, b = (x[0], x[1]) if _read_path(x[0]) else (x[1], x[0])
            path = _read_path(a)
            if path == "hit.move" and is_const(b):
                out["talents"] = [MOVE_OF[value_of(b)]]
            elif path == "weaponType" and is_const(b):
                out["weapon_types"] = [value_of(b)]
            else:
                raise NotLinear(f"a gate on {show(x[0])} == {show(x[1])}")
            node = x[2]
            continue
        if op == "lookup" and _read_path(x[0]) == "weaponType":
            values = list((node.get("table") or {}).values())
            if values and all(json.dumps(v, sort_keys=True) == json.dumps(values[0], sort_keys=True) for v in values):
                out["weapon_types"] = sorted(node["table"])
                node = values[0]
                continue
        raise NotLinear(f"a {op} that is not a gate the engine reads")
    # max(x, 0) on the outside: an Effect never goes below 0
    if isinstance(node, dict) and node.get("op") == "max" and len(node["x"]) == 2 and any(
            is_const(n) and _num(value_of(n)) == 0 for n in node["x"]):
        node = next(n for n in node["x"] if not (is_const(n) and _num(value_of(n)) == 0))
    # min(linear, cap)
    if isinstance(node, dict) and node.get("op") == "min":
        x = node["x"]
        if len(x) != 2:
            raise NotLinear("a min of more than two")
        cap_side = [n for n in x if _cap(n) is not None]
        if len(cap_side) != 1:
            raise NotLinear("a min with no cap the engine reads")
        out["cap"], out["cap_from"] = _cap(cap_side[0])
        node = x[0] if x[1] is cap_side[0] else x[1]
    rate, levels, printed, refinement, stat, over = 1.0, None, None, None, None, None
    times: tuple[str, str] | None = None
    row_named: dict | None = None
    # max(a·stat − k, 0) or a·max(stat − k, 0): rate × (stat − over), never below 0
    factors = _factors(node)
    for f in factors:
        op = f.get("op") if isinstance(f, dict) else None
        if op == "const":
            rate *= _num(value_of(f))
        elif op == "subscript" and _read_path(f["x"][0]) == "weapon.refinement":
            refinement = [float(v) for v in f["list"][1:6]]  # refinements 1 to 5
        elif op == "subscript" and re.fullmatch(r"total\.(auto|skill|burst)Index", _read_path(f["x"][0]) or ""):
            levels = [float(v) for v in f["list"]]
            printed = [float(v) for v in f.get("was") or f["list"]]
            row_named = f.get("row")   # a list made here from two rows (a stack part over its base): the row is named, not found
        elif op == "read" and f["p"] in TIMES_OF:
            # a second stat of hers the effect multiplies by (Kokomi's Healing Bonus), read before or after the conversions as its first is
            if times is not None:
                raise NotLinear("two stats multiplied")
            times = TIMES_OF[f["p"]]
        elif op == "read" and _stat(f["p"]):
            if stat is not None:
                raise NotLinear("two stats multiplied")
            stat = _stat(f["p"])
        elif op in ("add", "max"):
            stat_over = _over(f)
            if stat_over is None or stat is not None:
                raise NotLinear(f"a sum the engine does not read: {show(f)}")
            stat, over = stat_over
        else:
            raise NotLinear(f"a factor the engine does not read: {show(f)}")
    if refinement and levels:
        raise NotLinear("a rate by refinement and by talent level")
    if times is not None:
        if stat is None or times[1] != stat[1]:
            raise NotLinear("a second stat read before the conversions and the first after them (or alone): premod and final differ")
        out["times"] = times[0]
    if stat:
        out["from"], out["reads"] = stat
        if stat[0] == "base_atk":
            raise NotLinear("a share of base ATK")
    out["over"] = over
    if refinement:
        out["rate"] = [round(v * rate, 10) for v in refinement]
    elif levels:
        out["rate"] = [round(v * rate, 10) for v in levels]
        out["row"] = row_named or ctx.row_of(printed)
        if out["row"] is None:
            raise NotLinear("a rate by talent level that matches no row")
    else:
        out["rate"] = round(rate, 10)
    if isinstance(out["cap"], float):
        out["cap"] = round(out["cap"], 10)
    if isinstance(out["cap"], list) and not refinement:
        raise NotLinear("a cap by refinement on a rate that is not")
    return out


def _factors(node: Any) -> list[Any]:
    if isinstance(node, dict) and node.get("op") == "mul":
        out = []
        for n in node["x"]:
            out += _factors(n)
        return out
    return [node]


def _over(node: dict) -> tuple[tuple[str, str], float] | None:
    """`add(stat, −k)` or `max(add(stat, −k), 0)`: the stat and k."""
    if node.get("op") == "max":
        x = node["x"]
        if len(x) == 2 and any(is_const(n) and _num(value_of(n)) == 0 for n in x):
            inner = next(n for n in x if not (is_const(n) and _num(value_of(n)) == 0))
            return _over(inner) if isinstance(inner, dict) else None
        return None
    if node.get("op") == "add" and len(node["x"]) == 2:
        stat = next((n for n in node["x"] if _read_path(n) and _stat(n["p"])), None)
        k = next((n for n in node["x"] if is_const(n)), None)
        if stat is not None and k is not None:
            return _stat(stat["p"]), -_num(value_of(k))
    return None


def _cap(node: Any) -> tuple[Any, str | None] | None:
    """A cap: a number, a list by refinement, or a multiple of base ATK."""
    if is_const(node):
        return _num(value_of(node)), None
    if isinstance(node, dict) and node.get("op") == "subscript" and _read_path(node["x"][0]) == "weapon.refinement":
        return [float(v) for v in node["list"][1:6]], None
    factors = _factors(node)
    if len(factors) == 2 and any(is_const(f) for f in factors) and any(_read_path(f) == "base.atk" for f in factors):
        return _num(value_of(next(f for f in factors if is_const(f)))), "base_atk"
    return None


def _distribute(node: Any) -> Any:
    """a × min(x, c) is min(a·x, a·c) for a > 0 (Alyosha's ER capped at 200% before the rate)."""
    if not (isinstance(node, dict) and node.get("op") == "mul"):
        return node
    x = node["x"]
    mins = [n for n in x if isinstance(n, dict) and n.get("op") == "min"]
    others = [n for n in x if n not in mins]
    if len(mins) == 1 and all(is_const(n) and _num(value_of(n)) > 0 for n in others):
        a = 1.0
        for n in others:
            a *= _num(value_of(n))
        return {"op": "min", "x": [{"op": "mul", "x": [const(a), n]} if not is_const(n) else const(a * _num(value_of(n)))
                                   for n in mins[0]["x"]]}
    return node


def _peel_and_distribute(node: Any) -> Any:
    """_distribute under the gates."""
    if isinstance(node, dict) and node.get("op") in ("threshold", "match") and len(node.get("x", [])) == 4:
        x = node["x"]
        return {**node, "x": [x[0], x[1], _peel_and_distribute(x[2]), x[3]]}
    if isinstance(node, dict) and node.get("op") == "min":
        return {**node, "x": [_flatten_mul(n) for n in node["x"]]}
    return _distribute(_flatten_mul(node))


def _flatten_mul(node: Any) -> Any:
    if isinstance(node, dict) and node.get("op") == "mul":
        return {"op": "mul", "x": _factors(node)}
    return node


def bucket(key: str) -> tuple[str, list[str] | None] | None:
    """GO's stat key as the engine's bucket (and the talents it is limited to), or None when the engine has none."""
    if key in SIMPLE_BUCKETS:
        return SIMPLE_BUCKETS[key], None
    found = re.fullmatch(r"([a-z]+)_(dmg_|dmgInc|directDmgInc|critRate_|critDMG_|baseDmg_|specialDmg_)", key)
    if not found:
        return None
    head, tail = found.groups()
    if head in ELEMENTS or head == "physical":
        target = {"dmg_": f"dmg:{head}", "dmgInc": f"additive:{head}", "critRate_": f"cr:{head}",
                  "critDMG_": f"cd:{head}"}.get(tail)
        if head == "physical" and tail == "dmg_":
            target = "physical"
        return (target, None) if target else None
    if head in MOVES or head in ("plunging",):
        if tail == "dmg_":
            return f"dmg:{head}", None
        if tail == "dmgInc":
            return f"additive:{head}", None
        if tail == "critRate_":
            return "cr", [head]
        if tail == "critDMG_":
            return "cd", [head]
        return None
    if head in REACTIONS:
        r = REACTIONS[head]
        target = {"baseDmg_": f"base:{r}", "dmg_": f"bonus:{r}", "dmgInc": f"additive:{r}",
                  "directDmgInc": f"additive:{r}", "specialDmg_": f"elevation:{r}", "critRate_": f"cr:{r}",
                  "critDMG_": f"cd:{r}"}.get(tail)
        return (target, None) if target else None
    return None


# GO's bonuses to the ground impact of a plunge (not its collision): the engine's plunging buckets, for the rows of the hits that are impacts
IMPACT_BUCKETS = {"dmg_": ("dmg:plunging", None), "dmgInc": ("additive:plunging", None), "critRate_": ("cr", ["plunging"]),
                  "critDMG_": ("cd", ["plunging"])}


def impact_bucket(key: str) -> tuple[str, list[str] | None] | None:
    """The bucket of GO's `plunging_impact_<stat>` key, or None for any other key."""
    found = re.fullmatch(r"plunging_impact_(dmg_|dmgInc|critRate_|critDMG_)", key)
    return IMPACT_BUCKETS[found.group(1)] if found else None


EFFECT_KEYS = ("from", "reads", "to", "rate", "cap", "cap_from", "over", "pieces", "from_ascension",
               "from_constellation", "talents", "weapon_types", "hits", "row", "while", "in_stats")
# keys an effect has only when it uses them (`party` is another): a second stat it multiplies by, and the talent its `hits` are rows of
OPTIONAL_KEYS = ("times", "in_talent", "also")


def effect(numbers: dict, to: str, talents: list[str] | None, hits: list[str] | None, while_: str | None, also: list[str] | None = None) -> dict:
    out = {**numbers, "to": to, "hits": hits, "while": while_, "in_stats": False, "also": list(also) if also else None}
    if talents:
        out["talents"] = sorted(set((out.get("talents") or []) + talents)) if out.get("talents") else talents
    return {**{key: out.get(key) for key in EFFECT_KEYS}, **{key: out[key] for key in OPTIONAL_KEYS if out.get(key) is not None}}


# ------------------------------------------------------------------------------------------------- sheets to effects


@dataclass
class Found:
    effects: list[dict] = field(default_factory=list)
    toggles: dict[str, dict] = field(default_factory=dict)  # GO's conditional path → {"states", "chosen"}
    left_out: list[dict] = field(default_factory=list)
    party: int = 0


def leaves(obj: Any, path: tuple[str, ...] = ()) -> Iterable[tuple[tuple[str, ...], Any]]:
    if isinstance(obj, dict) and "op" not in obj:
        for key, value in obj.items():
            yield from leaves(value, path + (key,))
    elif obj is not None:
        yield path, obj


def _is_party(node: Any) -> bool:
    return any(r.startswith(PARTY_READS) for r in reads(node))


def read_effects(
    effects: dict, env: dict, ctx: Context, found: Found, chosen: dict[str, str], toggle_name, hits: list[str] | None = None,
    where: str = "", base_env: dict | None = None, impact_found: dict[str, Found] | None = None, impact_here: bool = False,
) -> None:
    """Every damage-relevant stat a sheet's data adds, as Effects (or `left_out`). `base_env` (a character whose party or `reads` decide
    some of it): `env` without those reads; a term that is nothing for them but would depend on the party without them is listed.
    A bonus to the ground impact of a plunge (`plunging_impact_*`) is given to each of `impact_found`'s hits (the sheet's: every hit that
    is a ground impact, each with its own `Found`), or, in one hit's own data, kept when `impact_here` (the hit is a ground impact) and
    dropped otherwise: GO's collision hits read no impact bonus."""
    for path, tree in leaves(effects):
        if not path or path[0] not in ("premod", "total", "teamBuff"):
            continue
        if path[0] == "teamBuff":
            if len(path) < 3 or path[1] not in ("premod", "total"):
                continue
            path = path[1:]
        key = path[-1]
        if len(path) != 2:
            continue
        # a term the team's reads made (the terms the sheet states without them are the same with or without): the team's, not hers
        plain: set[str] = set()
        if base_env is not None:
            plain = {json.dumps(t, sort_keys=True) for t in terms_of(normalise(simplify(tree, base_env))) if not _is_party(t)}
        team_leaf = base_env is not None and any(p.startswith(DERIVED_READS) for p in reads(tree))
        before = (len(found.effects), len(found.left_out))
        for term in terms_of(normalise(simplify(tree, env))):
            if is_const(term) and _num(value_of(term)) == 0:
                continue
            derived = team_leaf and json.dumps(term, sort_keys=True) not in plain
            if isinstance(term, dict) and term.get("op") == "read" and term["p"] == "special":
                continue
            if reads(term) & {"weapon.main", "weapon.sub", "weapon.sub2", "special"}:
                continue  # the weapon's own base ATK and substat, the ascension stat: on the panel, stage 1 counts them
            target = bucket(key)
            label = f"{where}{'.'.join(path)}"
            if _is_party(term):
                found.party += 1
                found.left_out.append({"what": label, "expr": show(term), "why": "depends on the party"})
                continue
            if target is None and impact_bucket(key) is not None:
                if impact_found is not None:
                    for sub in impact_found.values():
                        _add(term, impact_bucket(key), ctx, sub, chosen, toggle_name, None, label, derived)
                elif impact_here:
                    _add(term, impact_bucket(key), ctx, found, chosen, toggle_name, hits, label, derived)
                continue
            if target is None:
                if not QUIET.match(key):
                    found.left_out.append({"what": label, "expr": show(term), "why": "the damage engine has no place for it"})
                continue
            _add(term, target, ctx, found, chosen, toggle_name, hits, label, derived)
        if base_env is not None and before == (len(found.effects), len(found.left_out)):
            for term in terms_of(normalise(simplify(tree, base_env))):
                if _is_party(term):
                    found.left_out.append({"what": f"{where}{'.'.join(path)}", "expr": show(term),
                                           "why": "depends on the party; it adds nothing for the team shapes given (it needs another team)"})


WHY_TEAM_MODE = ("it needs a team-mode decision (a Hexerei, Stellar or Traveler team, which the party sets) as well as one of her states, "
                 "and nothing it adds reaches a row of hers")


def _is_team_mode(path: str) -> bool:
    """A state GO names `lock...` or `...StellarRadiance...`: the mode of her team that unlocks a passive (Hexerei's Secret Rite, a Stellar
    Revelation, the Traveler's locked passive) or the kind her Stellar hits are, not a state of hers to switch."""
    name = path.rpartition(".")[2]
    return name.startswith("lock") or "StellarRadiance" in name


WHY_NOT_ALL_NEEDED = "it reads several of her states, and it still gives something when one of them is off (any of them is enough, or it is a factor that is 1 without it)"
_OFF = "(off)"   # a value no state of hers has: the state not set


def _all_needed(term: Any, states_of: dict[str, tuple[list[str], str]]) -> bool:
    """Whether a term that reads these states gives nothing when any one of them is off: it holds only while all of them hold, which is what
    an effect behind several toggles says. A sum of states any of which is enough (Durin's C2 elements) or a factor that is 1 without its
    state (Skirk's A4 stacks) is not."""
    for off in states_of:
        env = {path: state for path, (_, state) in states_of.items() if path != off}
        env[off] = _OFF
        got = simplify(term, env)
        if not (is_const(got) and _num(value_of(got)) == 0):
            return False
    return True


WHY_OTHER_ELEMENT = "it reads two of her states and is a DMG bonus to an element that none of her rows deals"

# an undecided weapon or set whose states are different bonuses the game gives at random or by turns: no one state is the honest one for
# every character (which gives the most depends on her rows), so it is left out, with its reason (the toggle is not made).
# {the item's key: (what, why)}
ONE_OF_AT_RANDOM = {
    "the-widsith": ("Debut", "the game gives one of three bonuses at random on switching in (ATK, DMG or Mastery), and which one gives the most "
                             "depends on the character"),
    "forged-by-the-golden-melody": ("movement and contra", "the game gives one of three bonuses by turns, every 10 s (ATK, Mastery or Stellar "
                                    "reaction DMG), and which one gives the most depends on the character"),
}


def fold_flat_caps(effects: list[dict]) -> list[dict]:
    """A bonus that is no share of a stat and has a cap (0.12% for each Energy, up to 40%) as the lower of the two at each refinement: the
    engine reads a cap only of a share of a stat (damage.ts, `amount`), so a flat one is held to it here."""
    out = []
    for e in effects:
        if e.get("from") is None and e.get("cap") is not None and e.get("cap_from") is None:
            rate, cap = e["rate"], e["cap"]
            size = max(len(v) if isinstance(v, list) else 1 for v in (rate, cap))
            rates = [min(rate[i] if isinstance(rate, list) else rate, cap[i] if isinstance(cap, list) else cap) for i in range(size)]
            e = {**e, "rate": [round(v, 10) for v in rates] if size > 1 else round(rates[0], 10), "cap": None}
        out.append(e)
    return out


_SPECIAL_ELEMENT = {"lunar-bloom": "dendro", "lunar-charged": "electro", "lunar-crystallize": "geo", "stellar-conduct": None, "stellar-swirl": None}


def _consts(tree: Any) -> set[Any]:
    """Every constant in a tree."""
    out, stack = set(), [tree]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("op") == "const":
                out.add(n.get("v"))
            stack.extend(n.get("x") or [])
            stack.extend((n.get("table") or {}).values())
    return out


def elements_dealt(char: dict, sheet: dict, party: dict | None) -> frozenset[str]:
    """The elements her rows can deal: hers, those a hit names (`ele`, or an element in the tree that decides it), an infusion's, and those of
    the team shapes whose rows take the team's element."""
    found = {char.get("element")}
    for hit in char.get("hits", []):
        found.add(hit.get("ele"))
        found |= _consts(hit.get("ele_tree"))
    for _, tree in leaves((sheet or {}).get("effects", {}).get("infusion") or {}):
        found |= _consts(tree)
    for option in (party or {}).get("options", []):
        found.update(option.get("elements") or [])
    return frozenset(e for e in found if e in ELEMENTS)


def reaches(made: dict, ctx: "Context") -> bool:
    """Whether an effect adds to some row of hers, as the engine's `reachesRow` says (damage.ts): its scope holds and its bucket is one that
    row reads. Every row counts, as which talents are her main ones is the player's levels. True when the rows are not known."""
    if not ctx.reach_rows:
        return True
    bucket, _, name = made["to"].partition(":")
    name = name or None
    for talent, row, kind, move in ctx.reach_rows:
        if made.get("talents") and move not in made["talents"]:
            continue
        if made.get("hits") and row not in made["hits"]:
            continue
        special = kind in _SPECIAL_ELEMENT
        possible = ctx.elements | ({"physical"} if kind == "physical" else set())
        if kind == "elemental":
            possible = ctx.elements
        if special:
            possible = {_SPECIAL_ELEMENT[kind]} if _SPECIAL_ELEMENT[kind] else ctx.elements
        if bucket == "dmg":
            if not special and (name is None or name in possible or name == move):
                return True
        elif bucket == "additive":
            if name == kind or (not special and (name == move or name in possible)):
                return True
        elif bucket in ("base", "elevation"):
            if name == kind:
                return True
        elif bucket == "bonus":
            if name == kind or (not special and name in ("vaporize", "melt", "aggravate", "spread")):
                return True
        elif bucket in ("cr", "cd"):
            if name is None or name in possible or name == kind:
                return True
        else:
            return True
    return False


def _add(term, target, ctx, found, chosen, toggle_name, hits, label, derived=False) -> None:
    to, talents = target
    conds = conditionals(term)
    team_mode = len(conds) > 1 and any(_is_team_mode(path) for path in conds)
    while_, also = None, []
    if conds:
        # each state it reads is read at the state decided for it, else the one that gives the most; the effect holds while the toggles of
        # all of them are on (`while` is the first, `also` the others)
        states_of = {}
        for path, states in conds.items():
            state = chosen.get(path) or best_state(states)
            if state is None:
                found.left_out.append({"what": label, "expr": show(term), "why": "a state with no value to set"})
                return
            states_of[path] = (states, state)
        bucket_element = to.split(":", 1)[1] if to.startswith("dmg:") else None
        if len(states_of) > 1 and bucket_element in ELEMENTS and ctx.elements and bucket_element not in ctx.elements:
            found.left_out.append({"what": label, "expr": show(term), "why": WHY_OTHER_ELEMENT})
            return
        if len(states_of) > 1 and not _all_needed(term, states_of):
            found.left_out.append({"what": label, "expr": show(term), "why": WHY_NOT_ALL_NEEDED})
            return
        term = normalise(simplify(term, {path: state for path, (_, state) in states_of.items()}))
        if is_const(term) and _num(value_of(term)) == 0:
            return
        for path, (states, state) in states_of.items():
            found.toggles.setdefault(path, {"states": states, "chosen": state})
        names = [toggle_name(path) for path in states_of]
        while_, also = names[0], names[1:]
    for piece in terms_of(term):
        if is_const(piece) and _num(value_of(piece)) == 0:
            continue
        # a count that only her constellation changes (Odette's A1) is a step at each constellation it changes at: effects that add up
        try:
            made_all = _made_of(piece, ctx, to, talents, hits, while_, also)
        except NotLinear as why:
            made_all = []   # all the parts or none: no part of a count stays beside the entry that says it is left out
            try:
                # a gate or a list that her constellation alone decides, in a form the plain gate does not say (`constellation == 6`,
                # a count of constellations): read as the gates and steps it comes to
                again = by_constellation(piece)
                if again == piece:
                    raise why
                for part in terms_of(normalise(again)):
                    if is_const(part) and _num(value_of(part)) == 0:
                        continue
                    made_all += _made_of(part, ctx, to, talents, hits, while_, also)
            except NotLinear:
                made_all = []
                found.left_out.append({"what": label, "expr": show(piece), "why": str(why)})
        if derived:
            for made in made_all:
                made["_derived"] = True   # read from the team: never on the panel (`mark_in_stats` takes it out)
        if team_mode and made_all and not label.startswith("hit ") and not any(reaches(m, ctx) for m in made_all):
            # a team mode's term that adds nothing to a row of hers: left for a team-mode decision, no toggle for it
            found.left_out.append({"what": label, "expr": show(piece), "why": WHY_TEAM_MODE})
            continue
        found.effects += made_all


def _made_of(piece: Any, ctx: "Context", to: str, talents: Any, hits: Any, while_: Any, also: list[str]) -> list[dict]:
    """The effects one term comes to (a count that only her constellation changes is one for each step), or NotLinear."""
    return [effect(linear(step, ctx), to, talents, hits, while_, also) for step in _expand_steps(_peel_and_distribute(piece))]


def _truth_by_constellation(node: dict) -> list[bool] | None:
    """Whether a gate (`threshold` or `match`) that reads her constellation and nothing else holds at each of the seven, or None when
    it does not come to a yes or no at one."""
    out = []
    for level in range(7):
        got = simplify({**node, "x": [node["x"][0], node["x"][1], const(1), const(0)]}, {"constellation": level})
        if not is_const(got) or value_of(got) not in (0, 1):
            return None
        out.append(value_of(got) == 1)
    return out


def by_constellation(node: Any) -> Any:
    """`node` with each gate that her constellation alone decides, in a form other than `constellation >= N`, written as that gate, and each
    list read by a count of her constellation written as its steps. A gate that holds from some constellation on (`constellation == 6`,
    `(constellation >= 4 ? 1 : 0) == 1`) is `constellation >= N`; one that always holds (`add(constellation >= 6 ? 1 : 0, 1.0) >= 1`) is
    its yes branch and one that never does is its no; one that holds only between two constellations is left as it is, for the reason
    `linear` gives. A list by such a count (Chasca's) is its value at the lowest constellation and a step at each one it changes at."""
    if not isinstance(node, dict) or "op" not in node:
        return node
    op, x = node["op"], node.get("x") or []
    if op in ("threshold", "match") and len(x) == 4:
        plain = op == "threshold" and _read_path(x[0]) == "constellation" and is_const(x[1])
        if not plain and reads(x[0]) | reads(x[1]) == {"constellation"}:
            truth = _truth_by_constellation(node)
            first = truth.index(True) if truth and True in truth else None
            if truth is not None and truth == [level >= (first if first is not None else 7) for level in range(7)]:
                yes, no = by_constellation(x[2]), by_constellation(x[3])
                if first is None:
                    return no
                return yes if first == 0 else {"op": "threshold", "x": [{"op": "read", "p": "constellation"}, const(first), yes, no]}
    if op == "subscript" and x and reads(node) == {"constellation"}:
        steps = constellation_steps(node)
        if steps is not None:
            parts = [const(change) if level == 0 else {"op": "threshold", "x": [{"op": "read", "p": "constellation"}, const(level), const(change), const(0)]}
                     for level, change in steps]
            return parts[0] if len(parts) == 1 else {"op": "add", "x": parts} if parts else const(0)
    if "x" in node:
        return {**node, "x": [by_constellation(n) for n in x]}
    return node


def constellation_steps(node: Any) -> list[tuple[int, float]] | None:
    """A factor that reads her constellation and nothing else as steps: [(the constellation, how much its value changes by there)], the
    first at 0 when it starts above zero (Odette's A1 count: 4 below Constellation 1, 0 from 1, 6 from 6 is [(0, 4), (1, -4), (6, 6)]);
    None when it reads anything else or gives no number."""
    if not isinstance(node, dict) or reads(node) != {"constellation"}:
        return None
    values = []
    for level in range(7):
        got = simplify(node, {"constellation": level})
        if not is_const(got) or not isinstance(value_of(got), (int, float)):
            return None
        values.append(float(value_of(got)))
    return [(level, round(values[level] - (values[level - 1] if level else 0.0), 10)) for level in range(7)
            if abs(values[level] - (values[level - 1] if level else 0.0)) > 1e-12]


def _expand_steps(node: Any) -> list[Any]:
    """`node`, or the sum of its steps when it is a product with a factor only her constellation changes: each step a term gated at its
    constellation (below the gates already on `node`)."""
    if isinstance(node, dict) and node.get("op") in ("threshold", "match") and len(node.get("x", [])) == 4 and is_const(node["x"][3])             and _num(value_of(node["x"][3])) == 0:
        a, b, inner, no = node["x"]
        return [{**node, "x": [a, b, part, no]} for part in _expand_steps(inner)]
    if isinstance(node, dict) and node.get("op") == "mul":
        factors = _factors(node)
        for factor in factors:
            if is_const(factor) or _is_gate(factor):
                continue
            steps = constellation_steps(factor)
            if steps is None:
                continue
            rest = [f for f in factors if f is not factor]
            out = []
            for level, change in steps:
                term = {"op": "mul", "x": rest + [const(change)]}
                out.append(term if level == 0 else {"op": "threshold", "x": [{"op": "read", "p": "constellation"}, const(level), term, const(0)]})
            return out
    return [node]


INFUSED_MOVES = ("normal", "charged", "plunging")


def _gates_of_infusion(term: Any) -> tuple[Any, dict[str, int]]:
    """An infusion's own gates, outermost first: `asc >= 1 ? X : null` and `constellation >= 6 ? X : null` (X with the gates off, and
    `from_ascension` or `from_constellation` for each). The infusion holds where they all hold."""
    gates: dict[str, int] = {}
    while isinstance(term, dict) and term.get("op") == "threshold" and len(term.get("x", [])) == 4:
        a, k, yes, no = term["x"]
        path = _read_path(a)
        if path not in ("asc", "constellation") or not is_const(k) or not (is_const(no) and value_of(no) is None):
            break
        name = "from_ascension" if path == "asc" else "from_constellation"
        gates[name] = max(gates.get(name, 0), int(_num(value_of(k))))
        term = yes
    return term, gates


def _infusion_of(tree: Any, env: dict, found: Found, chosen: dict[str, str], toggle_name, what: str
                 ) -> tuple[str | None, str | None, dict[str, int]] | None:
    """One tree that gives an element (an infusion, or the element of a hit): (element, the state it holds in or None, its gates), or
    None when it gives no element for her. A tree of more than one state, or one that reads more than the engine does, is left out."""
    term = simplify(tree, env)
    conds = conditionals(term)
    while_ = None
    if len(conds) > 1:
        found.left_out.append({"what": what, "expr": show(term), "why": "it depends on two of her states at once"})
        return None
    if len(conds) == 1:
        [(cpath, states)] = conds.items()
        state = chosen.get(cpath) or best_state(states)
        found.toggles.setdefault(cpath, {"states": states, "chosen": state})
        term = simplify(term, {cpath: state})
        while_ = toggle_name(cpath)
    term, gates = _gates_of_infusion(term)
    if is_const(term) and isinstance(value_of(term), str):
        return value_of(term), while_, gates
    if not (is_const(term) and value_of(term) is None):
        found.left_out.append({"what": what, "expr": show(term), "why": "an infusion the engine does not read"})
    return None


def infusions(effects: dict, env: dict, found: Found, chosen: dict[str, str], toggle_name) -> list[dict]:
    """Her own infusions: {talents, element, while} and, behind her ascension or a constellation, `from_ascension` or
    `from_constellation` (the kit gives only those that hold at hers). Party infusions (`team`) are not hers alone."""
    out = []
    for path, tree in leaves(effects.get("infusion") or {}):
        if path and path[0] == "team":
            continue
        got = _infusion_of(tree, env, found, chosen, toggle_name, "infusion." + ".".join(path))
        if got is not None:
            element, while_, gates = got
            out.append({"talents": list(INFUSED_MOVES), "element": element, "while": while_, **gates})
    return out


def hit_infusions(char: dict, env: dict, found: Found, chosen: dict[str, str], toggle_name) -> list[dict]:
    """The infusions that are a hit's own element, which a state decides (Aloy's Rushing Ice makes her Normal Attack hits Cryo,
    Yoimiya's Niwabi Fire-Dance hers Pyro): one for each element and state, of the moves of the Normal, Charged and Plunging hits
    that have it. A tree that reads no state (the hit's usual element) gives nothing."""
    by_state: dict[tuple[str, str | None, tuple], list[str]] = {}
    for hit in char.get("hits", []):
        tree = hit.get("ele_tree")
        if tree is None or hit["group"] not in INFUSED_MOVES or not conditionals(simplify(tree, env)):
            continue
        got = _infusion_of(tree, env, found, chosen, toggle_name, f"hit {hit['group']}.{hit['name']} element")
        if got is None or got[0] not in ELEMENTS:
            continue
        element, while_, gates = got
        move = MOVE_OF.get(hit.get("move") or "") or hit["group"]
        by_state.setdefault((element, while_, tuple(sorted(gates.items()))), []).append(move)
    return [{"talents": [m for m in INFUSED_MOVES if m in moves], "element": element, "while": while_, **dict(gates)}
            for (element, while_, gates), moves in by_state.items()]


# ------------------------------------------------------------------------------------------------- hits to rows


def hit_kind(hit: dict, weapon_type: str, infused: bool = False) -> tuple[str, str | None]:
    """The kind of a GO hit (and the element of a Stellar one). `infused`: the hit's own data infuses it always (Flins'
    attacks in his skill's form)."""
    if hit.get("variant"):
        kind = REACTIONS[hit["variant"]]
        return kind, hit.get("resist") if kind.startswith("stellar") else None
    ele = hit.get("ele")
    if ele is not None:
        return ("physical" if ele == "physical" else "elemental"), None
    move = MOVE_OF.get(hit.get("move") or "", None)
    if move in ("skill", "burst") or weapon_type == "catalyst" or infused:
        return "elemental", None
    return "physical", None


def aligned_rows(char: dict) -> dict[str, list[dict]]:
    """The rows with their parameters as indices into GO's `skillParam`. The encodings count the game's parameters; GO
    leaves a few out for some talents (Ayaka's Normal Attack: the encodings reach {{11}}, GO has 10 parameters). When the
    encodings name exactly as many parameters as GO has, the n-th one is GO's n-th; otherwise they are taken as they are."""
    out: dict[str, list[dict]] = {}
    for talent, rows in (char.get("rows") or {}).items():
        named = sorted({p for row in rows for p in row["params"]})
        count = len((char.get("params") or {}).get(talent) or [])
        if named and max(named) >= count and len(named) == count:
            index = {p: i for i, p in enumerate(named)}
            out[talent] = [{**row, "params": [index[p] for p in row["params"]]} for row in rows]
        else:
            out[talent] = list(rows)
    return out


def _same_list(a: Any, b: Any) -> bool:
    return isinstance(a, list) and isinstance(b, list) and len(a) == len(b) and all(
        abs(x - y) < 1e-9 for x, y in zip(a, b))


def _stack_lists(formula: Any) -> list[list[float]]:
    """The parameters a state adds to a hit's multiplier per stack (Raiden's Resolve Bonus): not the hit's own row."""
    out: list[list[float]] = []

    def visit(n: Any, parent: str | None) -> None:
        if not isinstance(n, dict):
            return
        x = n.get("x", []) or []
        if n.get("op") == "mul" and parent == "add" and any(any(p.startswith("conditional.") for p in reads(f)) for f in x):
            out.extend(f["list"] for f in x if isinstance(f, dict) and f.get("op") == "subscript")
        for child in x:
            visit(child, n.get("op"))

    visit(formula, None)
    return out


def match_rows(char: dict, kind_by_name, infused_hits: frozenset[str] = frozenset(), is_damage=lambda name: True,
               derived: list[dict] | None = None) -> tuple[dict, dict, dict, dict[str, list[tuple[str, str]]], list[dict]]:
    """hits {talent: {row: kind}}, elements {talent: {row: element}}, moves {talent: {row: move}} (every Normal Attack row, and a Skill or Burst row dealt as an attack), the rows of each GO
    hit, and what could not be matched."""
    weapon_type = char.get("weapon_type") or ""
    rows_by_param: dict[tuple[str, int], list[dict]] = {}
    for talent, rows in aligned_rows(char).items():
        for row in rows:
            for p in row["params"]:
                rows_by_param.setdefault((talent, p), []).append(row)
    row_params = {(TALENT_OF_PARAMS[talent], row["name"]): {(talent, p) for p in row["params"]}
                  for talent, rows in aligned_rows(char).items() for row in rows}
    own = _own_params(char.get("hits", []))
    candidates: dict[tuple[str, str], list[dict]] = {}
    unmatched = []
    # the rows a person gave hits no row of HoYoLAB's prints (`derived_rows` of her decision file)
    derived_of = {hit_key: (row["talent"], row["name"]) for row in derived or () for hit_key in row["hits"]}
    for hit in char.get("hits", []):
        if hit["group"] not in ("normal", "charged", "plunging", "skill", "burst"):
            continue  # hits of passives and constellations print no talent row
        kind, element = hit_kind(hit, weapon_type, f"{hit['group']}.{hit['name']}" in infused_hits)
        if f"{hit['group']}.{hit['name']}" in derived_of:
            candidates.setdefault(derived_of[f"{hit['group']}.{hit['name']}"], []).append({**hit, "kind": kind, "element": element})
            continue
        rows = []
        stacked = _stack_lists(hit.get("formula"))
        params = [p for p in hit.get("params", []) if not any(_same_list(p.get("levels"), s) for s in stacked)]
        for p in params or hit.get("params", []):
            for row in rows_by_param.get((p["talent"], p["index"]), []):
                if is_damage(row["name"]):  # a bonus per stack inside the hit's formula prints its own row: not a hit
                    rows.append((TALENT_OF_PARAMS[p["talent"]], row["name"]))
        own_talent = {"skill": "skill", "burst": "burst"}.get(hit["group"])
        if own_talent and not any(TALENT_OF_PARAMS[own_talent] == t for t, _ in rows):
            # a hit of her Skill's or Burst's form that GO reads from her Normal Attack's list (Lohen's Skill-form plunges):
            # the row of her Skill or Burst that prints the same numbers is the hit's as well
            lists = [p.get("levels") for p in params or hit.get("params", [])]
            for index, levels in enumerate((char.get("params") or {}).get(own_talent) or []):
                if any(_same_list(levels, other) for other in lists):
                    for row in rows_by_param.get((own_talent, index), []):
                        if is_damage(row["name"]):
                            rows.append((TALENT_OF_PARAMS[own_talent], row["name"]))
        if not rows:
            unmatched.append({"what": f"hit {hit['group']}.{hit['name']}", "why": "no talent row prints its multiplier"})
            continue
        for talent, name in dict.fromkeys(rows):
            candidates.setdefault((talent, name), []).append({**hit, "kind": kind, "element": element})
    hits: dict[str, dict[str, str]] = {}
    elements: dict[str, dict[str, str]] = {}
    moves: dict[str, dict[str, str]] = {}
    rows_of_hit: dict[str, list[tuple[str, str]]] = {}
    for (talent, name), cands in candidates.items():
        kinds = list(dict.fromkeys(c["kind"] for c in cands))
        if len(kinds) == 1:
            kind = kinds[0]
        else:
            named = kind_by_name(name, talent, weapon_type, False)
            if named in LUNAR_STELLAR and named in kinds:
                kind = named
            else:
                plain = [k for k in kinds if k not in LUNAR_STELLAR]
                kind = plain[0] if plain else kinds[0]
        chosen = [c for c in cands if c["kind"] == kind]
        hits.setdefault(talent, {})[name] = kind
        element = next((c["element"] for c in chosen if c["element"]), None)
        if element:
            elements.setdefault(talent, {})[name] = element
        def move_of(c: dict) -> str | None:
            return MOVE_OF.get(c.get("move") or "") or (
                "charged" if c["group"] == "charged" else "plunging" if c["group"] == "plunging" else None)

        found = list(dict.fromkeys(m for m in (move_of(c) for c in chosen) if m))
        move = found[0] if found else None
        if len(found) > 1:
            # hits with the same numbers list each other's parameters (Tartaglia's Charged Attack and Riptide Slash): the
            # move is that of the hits whose own parameter the row prints, else the talent's own
            mine = row_params.get((talent, name), set())
            theirs = list(dict.fromkeys(m for m in (move_of(c) for c in chosen if own[f"{c['group']}.{c['name']}"] & mine) if m))
            move = theirs[0] if len(theirs) == 1 else None
        if talent == "normal":
            moves.setdefault(talent, {})[name] = move or "normal"
        elif move in ("normal", "charged", "plunging"):
            # a Skill or Burst row the game deals as an attack (Clorinde's Swift Hunt is Normal Attack DMG)
            moves.setdefault(talent, {})[name] = move
        for c in chosen:
            rows_of_hit.setdefault(f"{c['group']}.{c['name']}", []).append((talent, name))
    return hits, elements, moves, rows_of_hit, unmatched


def _constellation_window(hit: dict) -> tuple[int, int | None]:
    """The constellations a GO hit is shown at, from the thresholds on `constellation` it sits behind (`gates`, as gb-match records
    them): [from, below), `below` None for no end. The threshold's first branch is the hit shown at or above the number, its
    second the hit shown under it."""
    low, high = 0, None
    for gate in hit.get("gates") or []:
        if gate.get("op") != "threshold" or (gate["x"][0].get("p") != "constellation") or gate["x"][1].get("op") != "const":
            continue
        number = int(gate["x"][1]["v"])
        if gate["branch"] == 2:
            low = max(low, number)
        else:
            high = number if high is None else min(high, number)
    return low, high


def row_gates(char: dict, rows_of_hit: dict[str, list[tuple[str, str]]]) -> dict[str, dict[str, dict[str, int]]]:
    """The rows GO deals only from a constellation (Yanfei's Charged Attack with four Scarlet Seals, `charged.4`, behind
    Constellation 6) or only below one (Yae Miko's Sesshou Sakura Level 1): {talent: {row name as the planner's block names it:
    {"from": n} and/or {"below": n}}}. A row that prints alternatives with a slash is gated at the alternative the hit's own parameter
    is (`Charged Attack (5 of 5)`); a row another hit deals at every constellation is not gated."""
    rows = {(TALENT_OF_PARAMS[talent], row["name"]): row for talent, found in aligned_rows(char).items() for row in found}
    seen: dict[tuple[str, str, str], list[tuple[int, int | None]]] = {}
    for hit in char.get("hits", []):
        key = f"{hit['group']}.{hit['name']}"
        window = _constellation_window(hit)
        for talent, name in rows_of_hit.get(key, []):
            row = rows.get((talent, name))
            if row is None:
                continue
            own = [row["params"].index(p["index"]) for p in hit.get("params", [])
                   if TALENT_OF_PARAMS.get(p["talent"]) == talent and p["index"] in row["params"]]
            # a hit that prints the whole row (a sum, or the only number) is the row; one of its alternatives is that alternative
            whole = not own or len(row["params"]) == 1 or len(set(own)) == len(row["params"])
            places = ["*"] if whole else sorted(set(own))
            for place in places:
                shown = name if place in ("*", 0) else f"{name} ({place + 1} of {len(row['params'])})"
                seen.setdefault((talent, name, shown), []).append(window)
    out: dict[str, dict[str, dict[str, int]]] = {}
    for (talent, _, shown), windows in seen.items():
        if any(low == 0 and high is None for low, high in windows):
            continue
        # hits of one row shown in two disjoint windows (one below 2, one from 4) are one row shown across their hull: no kit has this today
        low = min(low for low, _ in windows)
        high = None if any(h is None for _, h in windows) else max(h for _, h in windows)
        gate = {**({"from": low} if low else {}), **({"below": high} if high is not None else {})}
        if gate:
            out.setdefault(talent, {})[shown] = gate
    return out


def _own_params(hits: list[dict]) -> dict[str, set[tuple[str, int]]]:
    """Each hit's own parameters. Hits whose numbers are the same list the same parameters (each list equals each of them);
    in GO's order, the n-th of them is the n-th parameter's (Tartaglia's `charged1` is parameter 8, `riptideSlash` 10)."""
    key = lambda h: frozenset((p["talent"], p["index"]) for p in h.get("params", []))  # noqa: E731
    groups: dict[frozenset, list[str]] = {}
    for h in hits:
        groups.setdefault(key(h), []).append(f"{h['group']}.{h['name']}")
    out: dict[str, set[tuple[str, int]]] = {}
    for params, names in groups.items():
        ordered = sorted(params, key=lambda p: (p[0], p[1]))
        for rank, name in enumerate(names):
            out[name] = {ordered[rank]} if 1 < len(names) == len(ordered) else set(params)
    return out


def stack_parts(formula: Any) -> list[dict]:
    """The parts a state adds to a hit's multiplier for each stack, `add(base by talent level, per stack by talent level x a count a state
    gives)` (Eula's Lightfall Sword, Raiden's Resolve): {base, per (the lists by talent level), count (the tree of the state's count), index
    (the talent level it reads)}."""
    out: list[dict] = []

    def visit(n: Any) -> None:
        if not isinstance(n, dict):
            return
        x = n.get("x", []) or []
        if n.get("op") == "add":
            bases = [f for f in x if isinstance(f, dict) and f.get("op") == "subscript"]
            for f in x:
                if not (isinstance(f, dict) and f.get("op") == "mul"):
                    continue
                lists = [g for g in f["x"] if isinstance(g, dict) and g.get("op") == "subscript"]
                counts = [g for g in f["x"] if g not in lists and any(p.startswith("conditional.") for p in reads(g))]
                if len(lists) == 1 and len(bases) == 1 and counts and len(lists) + len(counts) == len(f["x"]):
                    out.append({"base": bases[0]["list"], "per": lists[0]["list"], "index": lists[0]["x"][0],
                                "count": counts[0] if len(counts) == 1 else {"op": "mul", "x": counts}})
        for child in x:
            visit(child)

    visit(formula)
    return out


def stack_multipliers(char: dict, rows_of_hit: dict, env: dict, ctx: Context, per_hit: dict[str, Found], chosen: dict, toggle_name) -> set[str]:
    """A state that adds a part to a hit's multiplier for each stack (`stack_parts`) as an Effect on the bucket `mult` of the row the hit
    prints: the parts of the row's hits added up over the sum of their bases, by talent level, times the state's count, which the state's
    toggle gives. A row with a hit that has no such part, or a hit that prints several rows, is left out with the reason. The keys of the
    hits it dealt with, so that `special_multipliers` does not list them a second time."""
    parts = {}
    by_key = {f"{hit['group']}.{hit['name']}": hit for hit in char.get("hits", [])}
    for hit_key, hit in by_key.items():
        got = stack_parts(hit.get("formula")) if rows_of_hit.get(hit_key) else []
        if got:
            parts[hit_key] = got
    row_hits: dict[tuple[str, str], list[str]] = {}
    for hit_key, rows in rows_of_hit.items():
        for row in rows:
            row_hits.setdefault(row, []).append(hit_key)
    done: set[str] = set()
    why = "a state adds to the talent's multiplier (stacks)"
    for hit_key, got in parts.items():
        if hit_key in done:
            continue
        rows = rows_of_hit[hit_key]
        if len(rows) != 1 or len(got) != 1:
            per_hit.setdefault(hit_key, Found()).left_out.append(
                {"what": f"hit {hit_key}", "expr": show(got[0]["count"]), "why": f"{why}, to a hit that prints several rows or has several parts"})
            done.add(hit_key)
            continue
        row = rows[0]
        group = row_hits[row]
        done.update(group)
        if not all(k in parts and len(parts[k]) == 1 and show(parts[k][0]["count"]) == show(got[0]["count"]) for k in group):
            for k in group:
                if k in parts:
                    per_hit.setdefault(k, Found()).left_out.append(
                        {"what": f"hit {k}", "expr": show(parts[k][0]["count"]), "why": f"{why}, but only some of the hits this row prints have it"})
            continue
        counted = group
        printed = next((r for t, rs in ctx.rows.items() if TALENT_OF_PARAMS.get(t) == row[0] for r in rs if r["name"] == row[1]), None)
        if printed is not None and re.search(r"\}\}[^{}]*/[^{}]*\{\{", printed.get("enc") or ""):
            if "low/high" in row[1].casefold():
                # the planner counts the low plunge of "Low/High Plunge DMG" alone: its hit is the one that prints the row's first parameter
                position = lambda k: min([printed["params"].index(p["index"]) for p in by_key[k].get("params", []) if p["index"] in printed["params"]], default=0)  # noqa: E731
                counted = [min(group, key=position)]
            else:
                ratios = {tuple(parts[k][0]["per"][i] / parts[k][0]["base"][i] for i in range(len(parts[k][0]["base"]))) for k in group}
                if len({tuple(round(v, 9) for v in ratio) for ratio in ratios}) > 1:
                    for k in group:
                        per_hit.setdefault(k, Found()).left_out.append(
                            {"what": f"hit {k}", "expr": show(parts[k][0]["count"]),
                             "why": f"{why}, to the alternatives of a row, which the planner counts as rows of their own"})
                    continue
        size = {len(parts[k][0]["base"]) for k in counted} | {len(parts[k][0]["per"]) for k in counted}
        if len(size) != 1:
            for k in group:
                if k in parts:
                    per_hit.setdefault(k, Found()).left_out.append(
                        {"what": f"hit {k}", "expr": show(parts[k][0]["count"]), "why": f"{why}, with lists of different lengths by talent level"})
            continue
        ratio = [sum(parts[k][0]["per"][i] for k in counted) / sum(parts[k][0]["base"][i] for k in counted) for i in range(size.pop())]
        term = {"op": "mul", "x": [{"op": "subscript", "list": ratio, "x": [got[0]["index"]], "row": {"talent": row[0], "name": row[1]}}, got[0]["count"]]}
        for k in group:
            _add(simplify(term, {}), ("mult", None), ctx, per_hit.setdefault(k, Found()), chosen, toggle_name, None, f"hit {k} stacks")
    return done


def special_multipliers(char: dict, rows_of_hit: dict, env: dict, ctx: Context, per_hit: dict[str, Found], chosen: dict,
                        toggle_name) -> None:
    """A factor of a hit's multiplier that reads a state or a passive (Neuvillette's A1 stacks, Sandrone's A1): an Effect
    on the bucket `mult`, the hit's multiplier × (1 + rate), kept per GO hit in `per_hit` until merge_per_hit."""
    stacked = stack_multipliers(char, rows_of_hit, env, ctx, per_hit, chosen, toggle_name)
    for hit in char.get("hits", []):
        hit_key = f"{hit['group']}.{hit['name']}"
        if not rows_of_hit.get(hit_key):
            continue
        found = per_hit.setdefault(hit_key, Found())
        for factor in _special_factors(hit.get("formula")):
            if factor.get("op") == "unread":
                if hit_key not in stacked:
                    found.left_out.append({"what": f"hit {hit_key}", "expr": show(factor["x"][0]),
                                           "why": "a state adds to the talent's multiplier (stacks), which the rows do not show"})
                continue
            g = _minus_one(simplify(factor, env))
            g = None if g is None else normalise(g)
            if g is None:
                found.left_out.append({"what": f"hit {hit_key}", "expr": show(factor),
                                       "why": "a multiplier the engine does not read"})
                continue
            for term in terms_of(g):
                if is_const(term) and _num(value_of(term)) == 0:
                    continue
                _add(term, ("mult", None), ctx, found, chosen, toggle_name, None, f"hit {hit_key} multiplier")


def tie_rows(char: dict, rows_of_hit: dict[str, list[tuple[str, str]]]) -> dict[str, list[tuple[str, str]]]:
    """`rows_of_hit` with the hits that list each other's parameters told apart (the Traveler (Hydro)'s Dewdrop and Spiritbreath Thorn
    hits both list parameters 0 and 2): a hit prints the rows that print one of its own parameters (`_own_params`); one with none of
    its own in any row keeps the rows it had."""
    own = _own_params(char.get("hits", []))
    printed = {(TALENT_OF_PARAMS[talent], row["name"]): {(talent, p) for p in row["params"]}
               for talent, rows in aligned_rows(char).items() for row in rows}
    out: dict[str, list[tuple[str, str]]] = {}
    for hit_key, rows in rows_of_hit.items():
        kept = [row for row in rows if own.get(hit_key, set()) & printed.get(row, set())]
        out[hit_key] = kept or list(rows)
    return out


_ALTERNATIVE = re.compile(r"^(.*) \((\d+) of (\d+)\)$")


def alternative_rows(char: dict, rows_of_hit: dict[str, list[tuple[str, str]]]) -> dict[str, list[tuple[str, str]]]:
    """`rows_of_hit` with a slash row's alternatives told apart (Nilou's "Luminous Illusion/Water Wheel DMG" prints two hits, each its own
    row in the planner): a hit that prints one alternative of a row prints the row by the name that alternative has there, `<name> (k of
    n)`. A row that is a sum ("A+B") or a Low/High plunge (the planner counts the low hit alone) is not a row of alternatives. A pair of kinds
    GO has one hit for (Odette's Stellar-Conduct/Stellar Swirl rows) is the first alternative's alone: an effect on that hit names
    `(1 of 2)`, since GO has no Swirl hit to give it to."""
    own = _own_params(char.get("hits", []))
    printed = {(TALENT_OF_PARAMS[t], row["name"]): (t, row["params"], row.get("enc") or "") for t, rows in aligned_rows(char).items() for row in rows}
    out: dict[str, list[tuple[str, str]]] = {}
    for hit_key, rows in rows_of_hit.items():
        mapped = []
        for row in rows:
            talent, params, enc = printed.get(row, (None, [], ""))
            if re.search(r"\}\}[^{}]*/[^{}]*\{\{", enc) and "low/high" not in row[1].casefold():
                places = sorted({params.index(p) for t, p in own.get(hit_key, set()) if t == talent and p in params})
                if len(places) == 1:
                    mapped.append((row[0], f"{row[1]} ({places[0] + 1} of {len(params)})"))
                    continue
            mapped.append(row)
        out[hit_key] = mapped
    return out


def _whole_alternatives(rows: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """`rows` with the alternatives of a slash row that all hold an effect given by the row's own name (`X (1 of 2)` and `X (2 of 2)` are `X`)."""
    out: list[tuple[str, str]] = []
    seen: dict[tuple[str, str, int], set[int]] = {}
    for talent, name in rows:
        found = _ALTERNATIVE.match(name)
        if found:
            seen.setdefault((talent, found.group(1), int(found.group(3))), set()).add(int(found.group(2)))
        else:
            out.append((talent, name))
    for (talent, base, count), places in seen.items():
        if places == set(range(1, count + 1)):
            out.append((talent, base))
        else:
            out += [(talent, f"{base} ({k} of {count})") for k in sorted(places)]
    return out


def merge_per_hit(per_hit: dict[str, Found], rows_of_hit: dict, found: Found, talents_of_name: dict[str, set[str]] | None = None) -> None:
    """Each GO hit's own effects onto her rows. A row printed by several GO hits (Sandrone's two Prism Shots) gets an effect only
    when every one of them has it; otherwise the effect is left out for that row, with the reason. A row is its talent and its name
    (Skirk's Normal Attack and her Skill both have a "1-Hit DMG"): an effect for the rows of one talent holds `in_talent` that talent
    when another talent has a row of the same name too (`talents_of_name`: the talents that have each row name)."""
    hits_of_row: dict[tuple[str, str], list[str]] = {}
    for hit_key, rows in rows_of_hit.items():
        for row in rows:
            hits_of_row.setdefault(row, []).append(hit_key)
    marks: dict[str, dict[str, dict]] = {}
    for hit_key, sub in per_hit.items():
        found.left_out += [item for item in sub.left_out if item not in found.left_out]   # a term of the sheet's that each impact hit left out
        found.party += sub.party
        for path, info in sub.toggles.items():
            found.toggles.setdefault(path, info)
        marks[hit_key] = {json.dumps({**e, "hits": None}, sort_keys=True): e for e in sub.effects}
    rows_of_mark: dict[str, list[tuple[str, str]]] = {}
    for (talent, name), hit_keys in sorted(hits_of_row.items()):
        seen = set().union(*(marks.get(h, {}).keys() for h in hit_keys))
        for mark in sorted(seen):
            if all(mark in marks.get(h, {}) for h in hit_keys):
                rows_of_mark.setdefault(mark, []).append((talent, name))
            else:
                e = json.loads(mark)
                found.left_out.append({"what": f"row {name}", "expr": f"{e['to']} {e['rate']}",
                                       "why": "only some of the hits this row prints have it"})
    for mark, rows in rows_of_mark.items():
        e = json.loads(mark)
        rows = _whole_alternatives(rows)
        have: dict[str, set[str]] = {}
        for talent, name in rows:
            have.setdefault(name, set()).add(talent)
        # a name every talent that has it holds the effect on is one name; a name some of them lack is scoped to the talent
        whole = sorted(name for name, talents in have.items()
                       if talents >= (talents_of_name or {}).get((_ALTERNATIVE.match(name) or [None, name])[1], talents))
        scoped: dict[str, list[str]] = {}
        for name, talents in have.items():
            if name not in whole:
                for talent in sorted(talents):
                    scoped.setdefault(talent, []).append(name)
        groups = ([(None, whole)] if whole else []) + [(talent, sorted(names)) for talent, names in sorted(scoped.items())]
        for talent, names in groups:
            made = {**e, "hits": names, **({"in_talent": talent} if talent else {})}
            found.effects.append({**{key: made.get(key) for key in EFFECT_KEYS}, **{key: made[key] for key in OPTIONAL_KEYS if made.get(key) is not None},
                                  **({"_derived": True} if made.get("_derived") else {})})


def _special_factors(formula: Any) -> list[Any]:
    """The factors beside the talent multiplier that read a state, a passive or a constellation."""
    out = []

    def visit(n: Any, in_sum: bool = False) -> None:
        if not isinstance(n, dict):
            return
        x = n.get("x", []) or []
        has_list = any(isinstance(f, dict) and f.get("op") == "subscript" for f in x)
        has_stat = any(_read_path(f) and re.fullmatch(r"total\.(atk|hp|def|eleMas)", _read_path(f)) for f in x)
        if n.get("op") == "mul" and has_list and not has_stat and any(
            any(p.startswith("conditional.") for p in reads(f)) for f in x
        ):
            if in_sum:
                # a part added to the multiplier per stack (Raiden's Resolve): not a factor of the hit
                out.append({"op": "unread", "x": [n]})
            else:
                # a count that multiplies the whole multiplier (Lauma's Verdant Dew): a factor like any other
                out.extend(f for f in x if any(p.startswith("conditional.") for p in reads(f)))
            return
        if n.get("op") == "mul" and has_list and has_stat:
            for f in n["x"]:
                if isinstance(f, dict) and f.get("op") not in ("subscript", "read", "const"):
                    r = reads(f)
                    if any(p.startswith("conditional.") or p in ("asc", "constellation") for p in r) and not any(
                        p.endswith(("_mult_", "_dmg_", "_baseDmg_", "eleMas")) for p in r
                    ):
                        out.append(f)
            return
        for child in n.get("x", []) or []:
            visit(child, n.get("op") == "add")

    visit(formula)
    return out


def _minus_one(node: Any) -> Any:
    """factor − 1, pushed into gates, so that ×(1 + x) reads as x."""
    if is_const(node):
        return const(_num(value_of(node)) - 1)
    if isinstance(node, dict) and node.get("op") in ("threshold", "match") and len(node.get("x", [])) == 4:
        x = node["x"]
        yes, no = _minus_one(x[2]), _minus_one(x[3])
        if yes is None or no is None:
            return None
        return {**node, "x": [x[0], x[1], yes, no]}
    if isinstance(node, dict) and node.get("op") == "subscript" and all(isinstance(v, (int, float)) for v in node.get("list", [])):
        # a multiplier by talent level (Yoimiya's Niwabi Fire-Dance, x1.379 at Skill level 1): the part over one, by level, with the
        # list it was made from (`was`), which is the one a talent row prints
        return {**node, "list": [v - 1 for v in node["list"]], "was": node.get("was") or list(node["list"])}
    if isinstance(node, dict) and node.get("op") == "lookup":
        table = {k: _minus_one(v) for k, v in node.get("table", {}).items()}
        default = _minus_one(node["x"][1]) if len(node.get("x", [])) > 1 else const(-1)
        if any(v is None for v in table.values()) or default is None:
            return None
        return {**node, "x": [node["x"][0], default], "table": table}
    if isinstance(node, dict) and node.get("op") == "add":
        ones = [n for n in node["x"] if is_const(n)]
        if ones:
            total = sum(_num(value_of(n)) for n in ones) - 1
            rest = [n for n in node["x"] if not is_const(n)]
            return {"op": "add", "x": rest + ([const(total)] if total else [])} if len(rest) + bool(total) > 1 else (
                rest[0] if rest else const(total))
    return None


# ------------------------------------------------------------------------------------------------- already on the panel

PANEL_BUCKETS = {"hp", "atk", "def", "hp%", "atk%", "def%", "em", "er", "cr", "cd", "heal", "physical",
                 *(f"dmg:{e}" for e in ELEMENTS)}
GATES = ("from", "while", "also", "hits", "talents", "weapon_types", "row", "from_ascension", "from_constellation", "over", "cap", "party")


def mark_in_stats(effects: list[dict], kind: str, base_stats: dict | None = None) -> None:
    """`in_stats: true` on the effects HoYoLAB's panel (and stage 1's statsWith) already holds for the gear she wears: a
    plain stat with no condition, no conversion and no limit to some hits; for a set any piece count (statsWith swaps the
    2-piece ones), for a weapon its always-on passive stats, for a character only her innate stats (GO's `baseStats`, such
    as Mitya's 100 EM: hers like base HP), and the plain stat of an ascension passive (`from_ascension`, nothing else: Xingqiu's
    A4, +20% Hydro DMG, is in the panel). Constellation stats, conversions and anything a state or a condition holds are not
    marked: HoYoLAB's panel is the out-of-combat one and leaves them out (verification.md W7, Raiden; the audit's "the panel
    question"), so the engine adds them."""
    innate = {}
    for key, value in (base_stats or {}).items():
        target = bucket(key)
        if target is not None and target[1] is None and isinstance(value, (int, float)):
            innate[target[0]] = float(value)
    for e in effects:
        if e.get("_derived"):
            e["in_stats"] = False
            continue
        plain = e["to"] in PANEL_BUCKETS and all(e.get(k) is None for k in GATES)
        if kind == "character" and e.get("from_ascension") is not None:
            e["in_stats"] = bool(
                e["to"] in PANEL_BUCKETS and e["pieces"] is None and e.get("from_constellation") is None
                and isinstance(e["rate"], (int, float))
                and all(e.get(k) is None for k in GATES if k != "from_ascension"))
            continue
        if kind == "character":
            plain = plain and e["pieces"] is None and e["to"] in innate and isinstance(e["rate"], (int, float))                 and abs(e["rate"] - innate[e["to"]]) < 1e-9
        elif kind == "weapon":
            plain = plain and e["pieces"] is None
        e["in_stats"] = bool(plain)


# ------------------------------------------------------------------------------------------------- the file


WEAPON_FOLDERS = {"sword": "Sword", "claymore": "Claymore", "polearm": "Polearm", "bow": "Bow", "catalyst": "Catalyst"}


def humanise(name: str) -> str:
    """A GO state's code name in words, for a toggle nobody has decided yet ("GuideToAfterlifeVoyage" is "Guide to
    afterlife voyage")."""
    spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", name)
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", spaced).replace("_", " ")
    text = " ".join(spaced.split()).lower()
    return (text[:1].upper() + text[1:]) if text else name


def gear_label(name: str, labels: dict[str, str] | None) -> str:
    """The label of a weapon's or set's toggle that no decision file decides: ours from `decided/_gear-labels.json` (a plain phrase in
    our own words, shown as "<item>: <label>"), the code name in words only when no table is given (a hand-made `decided` in a test)."""
    if labels is None:
        return humanise(name.split(":")[-1].split(".")[-1])
    if not isinstance(labels.get(name), str) or not labels[name].strip():
        raise SystemExit(f"decided/_gear-labels.json has no label for the toggle {name!r}: write one in our own words")
    return labels[name]


def _toggles(found: Found, toggle_name, decided: dict[str, dict] | None, where: str, who: str = "her",
             labels: dict[str, str] | None = None, awaiting: dict[str, list[str]] | None = None) -> list[dict]:
    """The toggles of an entry. A decision file that misses a toggle stops the build, unless `awaiting` is given (a run of kits.json that is
    to go on, so that a new toggle of a decided character can be seen and decided): then the toggle is written off, with its code name in
    words, the character is added to `awaiting` with its names, and she waits for a person to decide them."""
    out = []
    names = {toggle_name(path): path for path in found.toggles}
    undecided: list[str] = []
    if decided is not None:
        unknown = sorted(set(decided) - set(names))
        if unknown:
            raise SystemExit(f"{where}: {who} decision file names toggles the kit does not have: {unknown} (it has {sorted(names)})")
        undecided = sorted(set(names) - set(decided))
        if undecided and awaiting is None:
            raise SystemExit(f"{where}: {who} decision file does not decide the toggles {undecided}")
        if undecided:
            awaiting[where] = undecided
    for name, path in sorted(names.items()):
        info = found.toggles[path]
        if decided is not None and name not in undecided:
            d = decided[name]
            out.append({"name": name, "label": d["label"], "on": bool(d["on"]), "covers": list(d.get("covers", [])),
                        "state": str(info["chosen"])})
        else:
            label = gear_label(name, labels) if who == "its" else humanise(name.split(":")[-1].split(".")[-1])
            out.append({"name": name, "label": label, "on": False, "covers": [], "state": str(info["chosen"])})
    return out


# GO's key of a weapon's substat -> the key the app's weapon reference (weapons.json) gives it
REFERENCE_SUB = {"hp_": "hp_pct", "atk_": "atk_pct", "def_": "def_pct", "eleMas": "em", "enerRech_": "er", "critRate_": "cr",
                 "critDMG_": "cd", "physical_dmg_": "phys"}


def _level_90(raw: dict) -> dict:
    """A weapon's base ATK and substat at level 90, ascension 6, from GO's curves (gb-kit's `level_90`): the substat by the reference's
    key and, as every percentage here, a fraction. The wiki's numbers the reference holds are these, rounded."""
    sub = raw.get("sub_key")
    if sub is not None and sub not in REFERENCE_SUB:
        raise SystemExit(f"a weapon's substat {sub!r} has no key in the app's reference")
    return {"base_atk": round(float(raw["main"]), 4), "sub": REFERENCE_SUB.get(sub) if sub else None,
            "sub_value": round(float(raw["sub"]), 6) if sub and raw.get("sub") is not None else None}


def _gear(entries: dict, kind: str, short: str, slug, decided: dict[str, dict] | None = None, labels: dict[str, str] | None = None) -> dict:
    """The weapons' or sets' entries of kits.json. `decided` is the decision files' (`load_decided`: {key: {"toggles": ...}}): an item
    with one has its toggles as it says (on, label, covers), its effects read at the states it picks, and is `checked`; one with none
    has every toggle off, named from its code name, and its effects read at the state that gives the most."""
    out: dict[str, Any] = {}
    decided = decided or {}
    for go_key, item in sorted(entries.items()):
        if not item.get("name"):
            continue
        key = slug(item["name"])

        def toggle_name(path: str, key: str = key) -> str:
            return f"{key}:{path.split('.', 2)[2]}"

        env = {"charKey": "self", "target.charKey": "self", "activeCharKey": "self", "active.charKey": "self"}
        if kind == "weapon":
            env.update({"weapon.key": go_key, "weaponType": item.get("type")})

        def read(chosen: dict[str, str], item: dict = item, env: dict = env, toggle_name=toggle_name) -> Found:
            found = Found()
            read_effects(item.get("effects") or {}, env, Context(), found, chosen, toggle_name)
            used = {e["while"] for e in found.effects} | {n for e in found.effects for n in e.get("also") or ()}
            found.toggles = {path: info for path, info in found.toggles.items() if toggle_name(path) in used}
            return found

        mine = decided.get(key)
        # a toggle is read at one state, over the states every term of the item reads it with: a sum of one term for each stack count
        # (Kagura's Verity's 12%, 24% and 36%) is the effect at one count, never the three added together
        everywhere = conditionals_in(item.get("effects") or {})
        if mine is None and key in ONE_OF_AT_RANDOM:
            found = Found()
            found.left_out.append({"what": ONE_OF_AT_RANDOM[key][0], "expr": ", ".join(sorted(everywhere)), "why": ONE_OF_AT_RANDOM[key][1]})
        elif mine is None:
            found = read({path: best_state(states) for path, states in everywhere.items() if best_state(states) is not None})
        else:
            found = read({})
        for path, info in found.toggles.items():
            info["states"] = list(everywhere.get(path) or info["states"])
        if mine is not None:
            # the states the file picks are what the effects are read at: a second reading with each toggle's state chosen
            paths = {toggle_name(path): path for path in found.toggles}
            chosen: dict[str, str] = {}
            for name, d in (mine.get("toggles") or {}).items():
                path = paths.get(name)
                if path is None:
                    continue    # `_toggles` says which toggles the file names that the item does not have
                if str(d["state"]) not in found.toggles[path]["states"]:
                    raise SystemExit(f"{key}: its decision file reads {name} at the state {str(d['state'])!r}, "
                                     f"which is not one of {found.toggles[path]['states']}")
                chosen[path] = str(d["state"])
            found = read(chosen)
        entry: dict[str, Any] = {"go_key": go_key}
        if kind == "weapon":
            entry["type"] = item.get("type")
            if item.get("level_90"):
                entry["level_90"] = _level_90(item["level_90"])
            source =f"libs/gi/sheets/src/Weapons/{WEAPON_FOLDERS.get(item.get('type') or '', '')}/{go_key}/index.tsx"
        else:
            source = f"libs/gi/sheets/src/Artifacts/{go_key}/index.tsx"
        entry.update({
            "effects": _marked(_dedupe(fold_flat_caps(found.effects)), kind),
            "toggles": _toggles(found, toggle_name, None if mine is None else mine.get("toggles") or {}, key, "its", labels),
            "left_out": found.left_out, "source": f"GO {short} {source}",
        })
        if mine is not None:
            entry["checked"] = True
        if key in out:
            raise SystemExit(f"two GO {kind}s give the key {key}")
        out[key] = entry
    return out


def character_key(go_key: str, name: str | None, slug) -> str:
    """Guild Board's key of a GO character: the slug of her name; a Traveler by her element (traveler-anemo)."""
    if name:
        return slug(name)
    return slug(re.sub(r"([a-z])([A-Z])", r"\1 \2", go_key))


DECISION_FIELDS = frozenset({"main", "stellar", "modes", "toggles", "unsure", "party", "reads", "derived_rows"})
PARTY_FIELDS = frozenset({"default", "reason", "options", "element_rows", "only_rows"})
OPTION_FIELDS = frozenset({"id", "label", "team", "moonsign", "elements", "states"})
TALENT_KEYS = ("normal", "skill", "burst")


def check_party(where: str, party: Any) -> None:
    """A decision file's `party` is well formed: its options (each a team shape: the elements of the other members, how many other
    Moonsign characters, the elements the rows that take the team's element deal, the states GO's conditionals are set to), the
    usual one among them (`default`), why it is the usual one, and the rows the team decides."""
    if not isinstance(party, dict):
        raise SystemExit(f"{where}: party is a JSON object")
    unknown = sorted(set(party) - PARTY_FIELDS)
    if unknown:
        raise SystemExit(f"{where}: party has unknown fields {unknown} (it has {sorted(PARTY_FIELDS)})")
    if not isinstance(party.get("reason"), str) or not party["reason"].strip():
        raise SystemExit(f"{where}: party needs a reason (why its default is the usual team)")
    options = party.get("options")
    if not isinstance(options, list) or not options:
        raise SystemExit(f"{where}: party needs options")
    ids: list[str] = []
    for option in options:
        if not isinstance(option, dict) or not isinstance(option.get("id"), str) or not option["id"]:
            raise SystemExit(f"{where}: a party option needs an id")
        name = option["id"]
        unknown = sorted(set(option) - OPTION_FIELDS)
        if unknown:
            raise SystemExit(f"{where}: party option {name!r} has unknown fields {unknown}")
        if name in ids:
            raise SystemExit(f"{where}: party option {name!r} twice")
        ids.append(name)
        if not isinstance(option.get("label"), str) or not option["label"].strip():
            raise SystemExit(f"{where}: party option {name!r} needs a label")
        for field in ("team", "elements"):
            for element in option.get(field) or []:
                if element not in ELEMENTS:
                    raise SystemExit(f"{where}: party option {name!r} has an unknown element {element!r} in {field}")
        if len(option.get("team") or []) > 3:
            raise SystemExit(f"{where}: party option {name!r} has more than three other members")
        if party.get("element_rows") and "elements" not in option:
            raise SystemExit(f"{where}: party option {name!r} needs `elements` (the rows that take the team's element)")
    if party.get("default") not in ids:
        raise SystemExit(f"{where}: party default {party.get('default')!r} is not one of its options {ids}")
    for talent, names in (party.get("element_rows") or {}).items():
        if talent not in TALENT_KEYS or not isinstance(names, list):
            raise SystemExit(f"{where}: party element_rows names a talent {talent!r} (normal, skill or burst) and a list of rows")
    for talent, rows in (party.get("only_rows") or {}).items():
        if talent not in TALENT_KEYS or not isinstance(rows, dict):
            raise SystemExit(f"{where}: party only_rows names a talent {talent!r} (normal, skill or burst) and its rows")
        for row, who in rows.items():
            for name in who:
                if name not in ids:
                    raise SystemExit(f"{where}: party only_rows puts {row!r} in the option {name!r}, which is not one of its options")


def party_reads(element: str, go_key: str, party: dict, option: dict, reads_of_hers: dict | None = None) -> dict[str, Any]:
    """What her sheet reads of the party when the team is `option`: the tally of each element (hers and the others'), how many
    elements there are, how many Moonsign characters (hers, from her decision's `reads`, and the option's others), her `reads` (her
    own flags), and the states the option sets for GO's conditionals, the other options' states being off."""
    team = [element, *(option.get("team") or [])]
    env: dict[str, Any] = {f"tally.{e}": team.count(e) for e in (*ELEMENTS, "physical")}
    env["tally.ele"] = len({e for e in team if e in ELEMENTS})
    own = dict(reads_of_hers or {})
    env["tally.moonsign"] = int(own.pop("tally.moonsign", 0)) + int(option.get("moonsign", 0))
    env.update(own)

    def path(name: str) -> str:
        return f"conditional.{name}" if "." in name else f"conditional.{go_key}.{name}"

    for other in party["options"]:
        for name in other.get("states") or {}:
            env[path(name)] = "off"
    for name, state in (option.get("states") or {}).items():
        env[path(name)] = str(state)
    return env


def _reads_in(obj: Any, found: set[str] | None = None) -> set[str]:
    """The paths read anywhere in a nest of trees."""
    found = set() if found is None else found
    if isinstance(obj, dict) and "op" in obj:
        reads(obj, found)
    elif isinstance(obj, dict):
        for value in obj.values():
            _reads_in(value, found)
    elif isinstance(obj, list):
        for value in obj:
            _reads_in(value, found)
    return found


def merge_options(runs: list[tuple[dict, "Found", list[dict]]]) -> tuple["Found", list[dict]]:
    """One sheet read once for each team, as one: an effect that is the same in every team is hers, one that differs holds `party`,
    the options it holds for (two teams that give the same number share the effect), and so does an infusion. Toggles and left-out terms
    are the union."""
    ids = [option["id"] for option, _, _ in runs]
    merged = Found()
    by_mark: dict[str, tuple[dict, list[str]]] = {}
    infused_by: dict[str, tuple[dict, list[str]]] = {}
    for option, found, items in runs:
        merged.party += found.party
        for effect in found.effects:
            by_mark.setdefault(json.dumps(effect, sort_keys=True), (effect, []))[1].append(option["id"])
        for path, info in found.toggles.items():
            merged.toggles.setdefault(path, info)
        merged.left_out += [item for item in found.left_out if item not in merged.left_out]
        for item in items:
            infused_by.setdefault(json.dumps(item, sort_keys=True), (item, []))[1].append(option["id"])
    for effect, who in by_mark.values():
        merged.effects.append(effect if who == ids else {**effect, "party": who})
    return merged, [item if who == ids else {**item, "party": who} for item, who in infused_by.values()]


def party_kit(party: dict, rows: dict[str, set[str]], where: str) -> dict:
    """kits.json's `party` of a character: the usual team, why, the options (id, label, the elements the rows that take the team's
    element deal), the rows that take it and the rows only some teams deal. `rows` is her rows by talent."""
    out: dict[str, Any] = {
        "default": party["default"], "reason": party["reason"],
        "options": [{"id": o["id"], "label": o["label"], "elements": list(o.get("elements") or [])} for o in party["options"]],
        "element_rows": {}, "only_rows": {},
    }
    for field in ("element_rows", "only_rows"):
        for talent, entries in (party.get(field) or {}).items():
            for row in entries:
                if row not in rows.get(talent, set()):
                    raise SystemExit(f"{where}: her party's {field} names a row she does not have: {talent} {row!r}")
            out[field][talent] = list(entries) if field == "element_rows" else {k: list(v) for k, v in entries.items()}
    return out


GEAR_FOLDERS = ("weapons", "sets")
GEAR_FIELDS = frozenset({"toggles"})
GEAR_TOGGLE_FIELDS = frozenset({"on", "label", "state", "reason", "covers"})


def check_gear(where: str, key: str, data: Any) -> None:
    """A weapon's or set's decision file is well formed: `toggles`, each named `<key>:<name>` as kits.json names it, with `on` (true or
    false), a `label` and a `reason` in our own words, the `state` it is read at and, if wanted, `covers` (the moves it reaches)."""
    if not isinstance(data, dict):
        raise SystemExit(f"{where}: a decision file is a JSON object")
    unknown = sorted(set(data) - GEAR_FIELDS)
    if unknown:
        raise SystemExit(f"{where}: unknown fields {unknown} (a weapon's or set's decision file has {sorted(GEAR_FIELDS)})")
    toggles = data.get("toggles")
    if not isinstance(toggles, dict):
        raise SystemExit(f"{where}: `toggles` is missing: an object of the item's toggles, each decided")
    for name, d in toggles.items():
        if not name.startswith(f"{key}:"):
            raise SystemExit(f"{where}: the toggle {name!r} is not named {key}:<name>")
        if not isinstance(d, dict):
            raise SystemExit(f"{where}: toggle {name}: a decision is an object")
        unknown = sorted(set(d) - GEAR_TOGGLE_FIELDS)
        if unknown:
            raise SystemExit(f"{where}: toggle {name}: unknown fields {unknown} (it has {sorted(GEAR_TOGGLE_FIELDS)})")
        if not isinstance(d.get("on"), bool):
            raise SystemExit(f"{where}: toggle {name}: `on` is true or false")
        for field in ("label", "reason"):
            if not isinstance(d.get(field), str) or not d[field].strip():
                raise SystemExit(f"{where}: toggle {name}: `{field}` is a sentence in our own words (`reason` says why it is on or off)")
        if not isinstance(d.get("state"), (str, int)) or isinstance(d.get("state"), bool):
            raise SystemExit(f"{where}: toggle {name}: `state` is the state it is read at (a stack count or on)")
        if "covers" in d and (not isinstance(d["covers"], list) or not all(isinstance(x, str) for x in d["covers"])):
            raise SystemExit(f"{where}: toggle {name}: `covers` is a list of moves")


def load_decided(folder: Path) -> dict:
    """The decisions of tools/go-reference/decided/ as `build` reads them: {"about", "checked", "unsure": {key: sentence},
    "characters": {key: {main, stellar, modes, toggles}}, "weapons": {key: {toggles}}, "sets": {key: {toggles}}}. One file per
    character, `<key>.json`: a file with any decision in it (not only `unsure`) makes her a checked character; `unsure` is the
    sentence her verdict gives when the comparison could not prove her kit (a character can be both). `_about.json` holds the text
    that says what the files are. A weapon's or set's decisions are `weapons/<key>.json` and `sets/<key>.json`, one file for each
    item (the key of kits.json's `weapons` and `sets`), which decide every toggle of it and make it checked. The characters' reading
    never goes into those folders, nor into `_stale`."""
    out: dict[str, Any] = {"about": "", "checked": "", "unsure": {}, "characters": {}, "weapons": {}, "sets": {}, "gear_labels": {}}
    for kind in GEAR_FOLDERS:
        for path in sorted((folder / kind).glob("*.json")) if (folder / kind).is_dir() else ():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except ValueError as error:
                raise SystemExit(f"{path.name}: not JSON ({error})") from error
            check_gear(path.name, path.stem, data)
            out[kind][path.stem] = data
    for path in sorted(folder.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as error:
            raise SystemExit(f"{path.name}: not JSON ({error})") from error
        if path.stem == "_gear-labels":
            labels = data.get("labels") if isinstance(data, dict) else None
            if not isinstance(labels, dict) or not all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in labels.items()):
                raise SystemExit(f"{path.name}: `labels` is an object of toggle name -> a label in our own words")
            out["gear_labels"] = labels
            continue
        if path.stem.startswith("_"):
            out["about"], out["checked"] = data.get("about", ""), data.get("checked", "")
            continue
        if not isinstance(data, dict):
            raise SystemExit(f"{path.name}: a decision file is a JSON object")
        unknown = sorted(set(data) - DECISION_FIELDS)
        if unknown:
            raise SystemExit(f"{path.name}: unknown fields {unknown} (a decision file has {sorted(DECISION_FIELDS)})")
        if "party" in data:
            check_party(path.name, data["party"])
        sentence = data.pop("unsure", None)
        if sentence:
            out["unsure"][path.stem] = sentence
        if data:
            out["characters"][path.stem] = data
    return out


def _party_held(party: dict | None) -> dict | None:
    """A party as kits.json holds it, from a decision's party or from kits.json's: what a comparison of the two reads."""
    if not party:
        return None
    return {"default": party["default"], "reason": party["reason"],
            "options": [{"id": o["id"], "label": o["label"], "elements": list(o.get("elements") or [])} for o in party["options"]],
            "element_rows": dict(party.get("element_rows") or {}), "only_rows": dict(party.get("only_rows") or {})}


def check_derived(where: str, derived: Any, char: dict) -> None:
    """A decision's `derived_rows` are well formed and true of her sheet: each is a row of her Skill or Burst, named in our own words, that
    copies a row of another talent of hers (the numbers GO's hits read are that row's: the hits' parameters are the row's) and is dealt by
    GO hits that exist and read that row's parameters alone."""
    if not isinstance(derived, list) or not derived:
        raise SystemExit(f"{where}: `derived_rows` is a list of rows")
    hits = {f"{h['group']}.{h['name']}": h for h in char.get("hits", [])}
    rows = {(TALENT_OF_PARAMS[t], row["name"]): row for t, found in aligned_rows(char).items() for row in found}
    names: set[tuple[str, str]] = set()
    seen_hits: set[str] = set()
    for row in derived:
        if not isinstance(row, dict) or set(row) != {"talent", "name", "from_talent", "from_row", "hits"}:
            raise SystemExit(f"{where}: a derived row has talent, name, from_talent, from_row and hits: {row}")
        if row["talent"] not in ("skill", "burst") or row["from_talent"] not in TALENT_KEYS or row["from_talent"] == row["talent"]:
            raise SystemExit(f"{where}: derived row {row['name']!r}: a row of her skill or burst that copies another talent's")
        if (row["talent"], row["name"]) in names or (row["talent"], row["name"]) in rows:
            raise SystemExit(f"{where}: derived row {row['name']!r} is named like a row of hers")
        names.add((row["talent"], row["name"]))
        source = rows.get((row["from_talent"], row["from_row"]))
        if source is None:
            raise SystemExit(f"{where}: derived row {row['name']!r} copies {row['from_row']!r}, which her {row['from_talent']} does not have")
        if not row["hits"]:
            raise SystemExit(f"{where}: derived row {row['name']!r} has no hits")
        for key in row["hits"]:
            hit = hits.get(key)
            if hit is None:
                raise SystemExit(f"{where}: derived row {row['name']!r}: GO has no hit {key}")
            if key in seen_hits:
                raise SystemExit(f"{where}: the hit {key} is given to two derived rows")
            seen_hits.add(key)
            own = {p["index"] for p in hit.get("params", []) if TALENT_OF_PARAMS.get(p["talent"]) == row["from_talent"]}
            if not own or not own <= set(source["params"]) or len(own) != len(hit.get("params", [])):
                raise SystemExit(f"{where}: derived row {row['name']!r}: the hit {key} does not read parameters of {row['from_row']!r} alone")


def decision_differences(mine: dict | None, unsure: str | None, kept: dict) -> list[str]:
    """What a character's decision file says that her entry in kits.json (`kept`) does not: the fields to read again with
    `run.py kits`. `mine` is her decision (None when she has none), `unsure` her sentence. Empty when kits.json is what the
    file makes (`checked`, `main`, `stellar`, `derived_rows`, `unsure`, `party` and, for each toggle, its on, label, covers and state)."""
    out: list[str] = []
    if bool(mine) != bool(kept["checked"]):
        out.append("checked")
    elif mine:
        if (mine.get("main") or None) != (kept["main"] or None):
            out.append("main")
        if (mine.get("stellar") or None) != (kept["stellar"] or None):
            out.append("stellar")
        if [{k: v for k, v in row.items() if k != "hits"} for row in mine.get("derived_rows") or []] != (kept.get("derived_rows") or []):
            out.append("derived_rows")
    if (unsure or None) != (kept["unsure"] or None):
        out.append("unsure")
    if mine and _party_held(mine.get("party")) != _party_held(kept.get("party")):
        out.append("party")
    if mine and bool(kept["checked"]):
        wanted = mine.get("toggles") or {}
        held = {t["name"]: t for t in kept["toggles"]}
        if set(wanted) != set(held):
            out.append("toggles")
        else:
            for name, d in wanted.items():
                t = held[name]
                for field, value in (("on", bool(d["on"])), ("label", d["label"]), ("covers", list(d.get("covers", []))),
                                     ("state", str(d["state"]))):
                    if t[field] != value:
                        out.append(f"toggle {name}: {field}")
    return out


def gear_differences(mine: dict | None, kept: dict, labels: dict[str, str] | None = None) -> list[str]:
    """What a weapon's or set's decision file says that its entry in kits.json (`kept`) does not: `checked` when the file and the entry
    disagree on whether it is decided, else its toggles (the names, then each one's on, label, covers and state). With no file the entry
    must hold the undecided reading: every toggle off, with no covers and its label from `decided/_gear-labels.json`."""
    if bool(mine) != bool(kept.get("checked")):
        return ["checked"]
    out: list[str] = []
    held = {t["name"]: t for t in kept["toggles"]}
    if mine:
        wanted = mine.get("toggles") or {}
        if set(wanted) != set(held):
            return ["toggles"]
        for name, d in wanted.items():
            for field, value in (("on", bool(d["on"])), ("label", d["label"]), ("covers", list(d.get("covers", []))), ("state", str(d["state"]))):
                if held[name][field] != value:
                    out.append(f"toggle {name}: {field}")
    else:
        for name, t in held.items():
            for field, value in (("on", False), ("label", gear_label(name, labels)), ("covers", [])):
                if t[field] != value:
                    out.append(f"toggle {name}: {field}")
    return out


# GO's characters that its data holds at the pinned commit and the game does not: kits.json leaves them out, and the run says whom. {GO's key: why}
# A table and not a filter on the app's inventory file, which lacks Mitya and Valeriy, who are in the game.
NOT_IN_GAME = {"Somnia": "In Genshin Optimizer's data at the pinned commit, but not in the game (the player, 2026-11-15)."}


def build(kit: dict, match: dict, decided: dict, commit: str, slug, kind_by_name, is_damage=lambda name: True,
          notes: dict | None = None) -> dict:
    """kits.json from gb-kit.json, gb-match.json and the decisions (`load_decided`).

    `notes` (a run that goes on with what is waiting for a person, `run.py kits`): given, it is filled with `not_in_game` ({GO's key: why}, the
    characters of `NOT_IN_GAME` the data has and kits.json leaves out) and `awaiting` ({key: the names of toggles her decision file does not
    decide yet}: they are written off and she stays checked). Without it a toggle her file does not decide stops the build."""
    short = commit[:8]
    characters: dict[str, Any] = {}
    decided_characters = decided.get("characters", {})
    awaiting: dict[str, list[str]] | None = {} if notes is not None else None
    if notes is not None:
        notes["not_in_game"] = {go_key: why for go_key, why in NOT_IN_GAME.items() if go_key in match}
        notes["awaiting"] = awaiting
    for go_key, char in sorted(match.items()):
        if go_key in NOT_IN_GAME:
            continue
        key = character_key(go_key, char.get("name"), slug)
        if key in characters:
            raise SystemExit(f"two GO characters give the key {key}")
        mine = decided_characters.get(key)

        def toggle_name(path: str, go_key: str = go_key) -> str:
            _, sheet, name = path.split(".", 2)
            return name if sheet == go_key else f"{sheet}.{name}"

        chosen: dict[str, str] = {}
        for name, d in ((mine or {}).get("toggles") or {}).items():
            path = f"conditional.{name}" if "." in name else f"conditional.{go_key}.{name}"
            chosen[path] = str(d["state"])
        ctx = Context(params=char.get("params") or {}, rows=aligned_rows(char))
        env = {"charKey": go_key, "target.charKey": go_key, "activeCharKey": go_key, "active.charKey": go_key,
               "weaponType": char.get("weapon_type"), "charEle": char.get("element")}
        # a mode is a state a person fixed for her (which Stellar kind Sandrone's hits are): not a switch, always set
        for name, state in ((mine or {}).get("modes") or {}).items():
            env[f"conditional.{name}" if "." in name else f"conditional.{go_key}.{name}"] = state["state"]
        # what only she can say of the party's reads: her own flags (Linnea is a Moonsign character, and the active one)
        reads_of_hers = (mine or {}).get("reads") or {}
        env.update(reads_of_hers)
        party_free = {k: v for k, v in env.items() if k not in reads_of_hers} if (reads_of_hers or (mine or {}).get("party")) else None
        sheet = kit["characters"].get(go_key, {})
        # a state nobody decided is read at the state that gives the most, over all her sheet (Odette's A1 is compared
        # with "not set" in one place and counted in another)
        everything = [sheet.get("effects"), sheet.get("hit_data"), [h.get("formula") for h in char.get("hits", [])]]
        for path, states in conditionals_in(everything).items():
            if path not in chosen and best_state(states) is not None:
                chosen[path] = best_state(states)
        infused_hits = frozenset(
            hit_key for hit_key, data in (sheet.get("hit_data") or {}).items()
            if any(is_const(v) and isinstance(value_of(v), str) for _, v in leaves(data.get("infusion") or {}))
        )
        derived = (mine or {}).get("derived_rows")
        if derived:
            check_derived(f"{key}'s decision file", derived, char)
        hits, elements, moves, rows_of_hit, unmatched = match_rows(char, kind_by_name, infused_hits, is_damage, derived)
        rows_of_hit = tie_rows(char, rows_of_hit)
        ctx.elements = elements_dealt(char, sheet, (mine or {}).get("party"))
        ctx.reach_rows = [(talent, name, kind, (moves.get(talent) or {}).get(name) or (talent if talent != "normal" else "normal"))
                          for talent, rows in hits.items() for name, kind in rows.items()]
        talents_of_name: dict[str, set[str]] = {}
        for talent, rows in aligned_rows(char).items():
            for row in rows:
                talents_of_name.setdefault(row["name"], set()).add(TALENT_OF_PARAMS[talent])
        party = (mine or {}).get("party")
        # her sheet is read once, or once for each team her damage depends on (the Plan design 14, her `party`): the tally and the
        # states of the team are what it reads, and an effect that differs by team holds only for the teams it is read for
        runs: list[tuple[dict, Found, list[dict]]] = []
        for option in (party["options"] if party else [{"id": ""}]):
            team_env = {**env, **party_reads(char.get("element") or "", go_key, party, option, reads_of_hers)} if party else env
            if party:
                for path in _reads_in(everything):
                    if path.startswith("nonStacking.") and path not in team_env:
                        team_env[path] = ""
            run = Found()
            per_hit: dict[str, Found] = {}
            # the hits that are the ground impact of a plunge (GO's `plunging_impact` move): what the sheet gives the impact reaches them
            impacts = {f"{h['group']}.{h['name']}" for h in char.get("hits", []) if h.get("move") == "plunging_impact"}
            read_effects(sheet.get("effects") or {}, team_env, ctx, run, chosen, toggle_name, base_env=party_free,
                         impact_found={k: per_hit.setdefault(k, Found()) for k in sorted(impacts) if rows_of_hit.get(k)})
            for hit_key, data in (sheet.get("hit_data") or {}).items():
                if rows_of_hit.get(hit_key):
                    read_effects(data, team_env, ctx, per_hit.setdefault(hit_key, Found()), chosen, toggle_name, None,
                                 f"hit {hit_key}: ", base_env=party_free, impact_here=hit_key in impacts)
            special_multipliers(char, rows_of_hit, team_env, ctx, per_hit, chosen, toggle_name)
            merge_per_hit(per_hit, alternative_rows(char, rows_of_hit), run, talents_of_name)
            runs.append((option, run, infusions(sheet.get("effects") or {}, team_env, run, chosen, toggle_name)
                         + hit_infusions(char, team_env, run, chosen, toggle_name)))
        found, infused = merge_options(runs) if party else (runs[0][1], runs[0][2])
        found.left_out = unmatched + found.left_out
        # a state whose every effect was left out is no switch: only the states some effect or infusion reads
        used = {e["while"] for e in found.effects} | {n for e in found.effects for n in e.get("also") or ()} | {i["while"] for i in infused}
        found.toggles = {path: info for path, info in found.toggles.items() if toggle_name(path) in used}
        toggles = _toggles(found, toggle_name, mine.get("toggles", {}) if mine else None, key, awaiting=awaiting)
        main = (mine or {}).get("main")
        if main:
            known = {name for rows in hits.values() for name in rows}
            missing = [name for name in main if name not in known]
            if missing:
                raise SystemExit(f"{key}: her decision file's main rows are not her rows: {missing}")
        characters[key] = {
            "go_key": go_key, "name": char.get("name") or humanise(go_key), "checked": bool(mine),
            "unsure": (decided.get("unsure") or {}).get(key),
            "main": main or None, "stellar": (mine or {}).get("stellar"), "element": char.get("element"),
            "weapon_type": char.get("weapon_type"), "hits": hits, "elements": elements, "moves": moves, "infused": infused,
            "effects": _marked(_dedupe(found.effects), "character", char.get("base_stats")), "toggles": toggles,
            "left_out": found.left_out,
            "source": f"GO {short} libs/gi/sheets/src/Characters/{char['sheet']}/index.tsx",
        }
        gates = row_gates(char, rows_of_hit)
        if gates:
            characters[key]["row_gates"] = gates
        if derived:
            characters[key]["derived_rows"] = [{k: v for k, v in row.items() if k != "hits"} for row in derived]
        if party:
            characters[key]["party"] = party_kit(party, {t: set(names) for t, names in hits.items()}, key)
    missing = sorted((set(decided_characters) | set(decided.get("unsure") or {})) - set(characters))
    if missing:
        raise SystemExit(f"decided/ names characters GO does not have: {missing}")
    gear = {
        "weapons": _gear(kit.get("weapons", {}), "weapon", short, slug, decided.get("weapons"), decided.get("gear_labels")),
        "sets": _gear(kit.get("sets", {}), "set", short, slug, decided.get("sets"), decided.get("gear_labels")),
    }
    for kind, items in gear.items():
        missing = sorted(set(decided.get(kind) or {}) - set(items))
        if missing:
            raise SystemExit(f"decided/ names {kind} GO does not have: {missing}")
    labels = decided.get("gear_labels")
    if labels is not None:
        # a label no undecided toggle takes (GO dropped the toggle, or a decision file now names it) is unused: the table says only what is shown
        used = {t["name"] for items in gear.values() for item in items.values() if not item.get("checked") for t in item["toggles"]}
        unused = sorted(set(labels) - used)
        if unused:
            raise SystemExit(f"decided/_gear-labels.json has unused labels {unused}: no undecided weapon or set has these toggles; remove them")
    return {"go_commit": commit, "characters": characters, **gear}


def _marked(effects: list[dict], kind: str, base_stats: dict | None = None) -> list[dict]:
    mark_in_stats(effects, kind, base_stats)
    for e in effects:
        e.pop("_derived", None)
    return effects


def _dedupe(effects: list[dict]) -> list[dict]:
    """The same effect twice is one (GO shows some buffs on several hits that map to one row)."""
    seen, out = set(), []
    for e in effects:
        mark = json.dumps(e, sort_keys=True)
        if mark not in seen:
            seen.add(mark)
            out.append(e)
    return out


# ------------------------------------------------------------------------------------------------- the schema

_TALENTS = ["normal", "skill", "burst"]
_MOVES = ["normal", "charged", "plunging", "skill", "burst"]
_KINDS_R = "lunar-bloom|lunar-charged|lunar-crystallize|stellar-conduct|stellar-swirl"
_ELEMENTS_R = "pyro|hydro|electro|cryo|anemo|geo|dendro"
BUCKET_PATTERN = (
    r"^(?:hp|atk|def|em|er|cr|cd|dmg|physical|hp%|atk%|def%|heal|additive|mult"
    rf"|dmg:(?:{_ELEMENTS_R}|normal|charged|plunging|skill|burst)"
    rf"|additive:(?:{_ELEMENTS_R}|physical|normal|charged|plunging|skill|burst|{_KINDS_R}|vaporize|melt|aggravate|spread)"
    rf"|(?:cr|cd):(?:{_ELEMENTS_R}|physical|{_KINDS_R})"
    rf"|(?:base|bonus|elevation):(?:{_KINDS_R}|vaporize|melt|aggravate|spread))$"
)


def schema() -> dict:
    """kits.schema.json, in the part of JSON Schema tests/json_schema.py reads."""
    effect = {
        "type": "object",
        "required": list(EFFECT_KEYS),
        "additionalProperties": False,
        "properties": {
            "from": {"type": ["string", "null"], "enum": ["atk", "hp", "def", "em", "er", "cr", "cd", None]},
            "reads": {"type": ["string", "null"], "enum": ["premod", "final", None]},
            "to": {"type": "string", "pattern": BUCKET_PATTERN},
            "rate": {"type": ["number", "array"], "items": {"type": "number"}, "minItems": 5, "maxItems": 15},
            "cap": {"type": ["number", "array", "null"], "items": {"type": "number"}, "minItems": 5, "maxItems": 5},
            "cap_from": {"type": ["string", "null"], "enum": ["base_atk", None]},
            "over": {"type": ["number", "null"]},
            "pieces": {"type": ["integer", "null"], "enum": [2, 4, None]},
            "from_ascension": {"type": ["integer", "null"], "minimum": 0, "maximum": 6},
            "from_constellation": {"type": ["integer", "null"], "minimum": 0, "maximum": 6},
            "talents": {"type": ["array", "null"], "items": {"type": "string", "enum": _MOVES}},
            "weapon_types": {"type": ["array", "null"], "items": {"type": "string", "enum": list(WEAPON_FOLDERS)}},
            "hits": {"type": ["array", "null"], "items": {"type": "string", "minLength": 1}},
            "row": {
                "type": ["object", "null"], "required": ["talent", "name"], "additionalProperties": False,
                "properties": {"talent": {"type": "string", "enum": _TALENTS}, "name": {"type": "string", "minLength": 1}},
            },
            "while": {"type": ["string", "null"], "minLength": 1},
            "in_stats": {"type": "boolean"},
            "party": {"type": ["array", "null"], "items": {"type": "string", "minLength": 1}, "minItems": 1},
            "times": {"type": ["string", "null"], "enum": ["heal", None]},
            "in_talent": {"type": ["string", "null"], "enum": [*_TALENTS, None]},
            "also": {"type": ["array", "null"], "items": {"type": "string", "minLength": 1}},
        },
    }
    toggle = {
        "type": "object", "required": ["name", "label", "on", "covers", "state"], "additionalProperties": False,
        "properties": {
            "name": {"type": "string", "minLength": 1}, "label": {"type": "string", "minLength": 1},
            "on": {"type": "boolean"}, "covers": {"type": "array", "items": {"type": "string", "enum": _MOVES}},
            "state": {"type": "string", "minLength": 1},
        },
    }
    left_out = {
        "type": "array",
        "items": {
            "type": "object", "required": ["what", "why"], "additionalProperties": False,
            "properties": {"what": {"type": "string"}, "expr": {"type": "string"}, "why": {"type": "string", "minLength": 1}},
        },
    }
    source = {"type": "string", "pattern": r"^GO [0-9a-f]{8} libs/gi/sheets/src/\S+/index\.tsx$"}

    def by_talent(value: dict) -> dict:
        return {"type": "object", "additionalProperties": False,
                "properties": {t: {"type": "object", "additionalProperties": value} for t in _TALENTS}}

    by_row = {"type": "object", "additionalProperties": False,
              "properties": {t: {"type": "array", "items": {"type": "string", "minLength": 1}} for t in _TALENTS}}
    gate = {"type": "object", "additionalProperties": False,
            "properties": {"from": {"type": "integer", "minimum": 1, "maximum": 6}, "below": {"type": "integer", "minimum": 1, "maximum": 6}}}
    party = {
        "type": "object", "required": ["default", "reason", "options", "element_rows", "only_rows"], "additionalProperties": False,
        "properties": {
            "default": {"type": "string", "minLength": 1}, "reason": {"type": "string", "minLength": 1},
            "options": {
                "type": "array", "minItems": 1,
                "items": {
                    "type": "object", "required": ["id", "label", "elements"], "additionalProperties": False,
                    "properties": {"id": {"type": "string", "minLength": 1}, "label": {"type": "string", "minLength": 1},
                                   "elements": {"type": "array", "items": {"type": "string", "enum": list(ELEMENTS)}}},
                },
            },
            "element_rows": by_row,
            "only_rows": {"type": "object", "additionalProperties": False,
                          "properties": {t: {"type": "object", "additionalProperties": {
                              "type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1}} for t in _TALENTS}},
        },
    }
    character = {
        "type": "object",
        "required": ["go_key", "name", "checked", "unsure", "main", "stellar", "element", "weapon_type", "hits", "elements", "moves",
                     "infused", "effects", "toggles", "left_out", "source"],
        "additionalProperties": False,
        "properties": {
            "go_key": {"type": "string", "minLength": 1}, "name": {"type": "string", "minLength": 1},
            "checked": {"type": "boolean"},
            "unsure": {"type": ["string", "null"], "minLength": 1},
            "main": {"type": ["array", "null"], "items": {"type": "string", "minLength": 1}, "minItems": 1},
            "stellar": {"enum": [None, "stellar-conduct", "stellar-swirl"]},
            "element": {"type": "string", "enum": list(ELEMENTS)},
            "weapon_type": {"type": "string", "enum": list(WEAPON_FOLDERS)},
            "hits": by_talent({"type": "string", "enum": ["physical", "elemental", *LUNAR_STELLAR]}),
            "elements": by_talent({"type": "string", "enum": ["cryo", "electro", "anemo"]}),
            "moves": by_talent({"type": "string", "enum": ["normal", "charged", "plunging"]}),
            "infused": {
                "type": "array",
                "items": {
                    "type": "object", "required": ["talents", "element", "while"], "additionalProperties": False,
                    "properties": {
                        "talents": {"type": "array", "items": {"type": "string", "enum": _MOVES}},
                        "element": {"type": "string", "enum": list(ELEMENTS)},
                        "while": {"type": ["string", "null"]},
                        "from_ascension": {"type": "integer", "minimum": 0, "maximum": 6},
                        "from_constellation": {"type": "integer", "minimum": 0, "maximum": 6},
                        "party": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
                    },
                },
            },
            "effects": {"type": "array", "items": effect}, "toggles": {"type": "array", "items": toggle},
            "left_out": left_out, "source": source, "party": party,
            "row_gates": {"type": "object", "additionalProperties": False,
                          "properties": {t: {"type": "object", "additionalProperties": gate} for t in _TALENTS}},
            "derived_rows": {"type": "array", "items": {
                "type": "object", "required": ["talent", "name", "from_talent", "from_row"], "additionalProperties": False,
                "properties": {"talent": {"type": "string", "enum": ["skill", "burst"]}, "name": {"type": "string", "minLength": 1},
                               "from_talent": {"type": "string", "enum": _TALENTS}, "from_row": {"type": "string", "minLength": 1}}}},
        },
    }
    gear = {
        "type": "object", "required": ["go_key", "effects", "toggles", "left_out", "source"], "additionalProperties": False,
        "properties": {
            "go_key": {"type": "string", "minLength": 1}, "type": {"type": "string", "enum": list(WEAPON_FOLDERS)},
            "effects": {"type": "array", "items": effect}, "toggles": {"type": "array", "items": toggle},
            "left_out": left_out, "source": source,
            "checked": {"type": "boolean"},   # only on an item with a decision file (decided/weapons or decided/sets)
            # a weapon's base ATK and substat at level 90 (GO's curves; the reference's wiki numbers are these rounded): the planner reads these
            "level_90": {"type": "object", "required": ["base_atk", "sub", "sub_value"], "additionalProperties": False, "properties": {
                "base_atk": {"type": "number", "exclusiveMinimum": 0},
                "sub": {"type": ["string", "null"], "enum": [*sorted(REFERENCE_SUB.values()), None]},
                "sub_value": {"type": ["number", "null"]}}},
        },
    }
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": (
            "kits.json: each character's, weapon's and set's kit, generated from Genshin Optimizer's Waverider sheets by "
            "tools/go-reference (see its README); do not edit it: change the decision files (tools/go-reference/decided/) and run the tool. Percentage stats "
            "are fractions (0.466 is 46.6%). An effect adds min(rate x max(stat - over, 0), cap) to its bucket `to`: "
            "`stat` is its `from` stat (read before conversions, `premod`, the panel's; or after them, `final`), `over` "
            "is in that stat's own units, `cap` is x base ATK when `cap_from` says so, no `from` adds rate itself; it "
            "holds while its gates hold: `pieces`, `from_ascension`, "
            "`from_constellation`, `talents` (the moves it reaches), `weapon_types`, `hits` (the rows it reaches) and "
            "`while` (the toggle that must be on), and, only on the effects that have them, `times` (a second stat of hers it multiplies by, "
            "read as `reads` says: Kokomi's Healing Bonus), `in_talent` (the talent whose rows `hits` names, for a row name two talents share) and `also` (the toggles besides `while` that must be on, for a term that reads two or more of her states). A list `rate` is by refinement for a weapon, and by talent level "
            "(index: level - 1) when `row` names the talent row it is. `dmg` is DMG Bonus for every hit, `mult` "
            "multiplies the hit's multiplier by 1 + rate. `in_stats`: HoYoLAB's panel already holds it for the "
            "weapon, set or character it belongs to; the engine adds it only for a tested weapon or set that is not "
            "hers. A hit's kind is in `hits`, the element of a Stellar hit in "
            "`elements`, the move of a Normal Attack row (and of a Skill or Burst row the game deals as an attack) in `moves`. "
            "`row_gates` (some characters): a row, as the planner's block names it, that is dealt only `from` a constellation or only "
            "`below` one (Yanfei's Charged Attack with four Scarlet Seals is Constellation 6's). "
            "`derived_rows` (some characters): a row of her Skill or Burst that HoYoLAB prints no row for, named in our own words, with the "
            "numbers of `from_row`, a row of `from_talent` (Sethos's Dusk Bolts have his Normal Attack's). "
            "`party` (some characters): the team shapes her damage depends on, `default` the usual one (`reason` says why), each "
            "option with the elements the rows that take the team's element deal; `element_rows` are those rows (dealt once for each "
            "element of the option) and `only_rows` the rows only some options deal; an effect with `party` holds only in those options."
        ),
        "type": "object",
        "required": ["go_commit", "characters", "weapons", "sets"],
        "additionalProperties": False,
        "properties": {
            "go_commit": {"type": "string", "pattern": "^[0-9a-f]{40}$"},
            "characters": {"type": "object", "additionalProperties": character},
            "weapons": {"type": "object", "additionalProperties": gear},
            "sets": {"type": "object", "additionalProperties": gear},
        },
    }
