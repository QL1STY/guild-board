"""Shared by weapons.py (R4) and sets.py (R5): reading the effects notation, and checking effect values against their text.

The notation, one weapon or set per block (hand-written in effects/*.txt, because turning passive text into stats is
the judgement the scripts leave to the reader):

    @ <key>
    + <stat> <v1>/<v2>/... [*<stacks>] <always|met> [condition in words]
    = <why the check can't see these values in the text, and how they were settled by hand>   (after a + line)
    ~ <note: what the text says that is not a stat, so it is not counted>

A weapon has five values per effect (refinements 1 to 5); a set effect has one. `*3` says the values are the text's
per-stack numbers times 3: the file shows the text's numbers, the script multiplies, and the check finds the text's number.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

STATS = ("hp", "atk", "def", "hp_pct", "atk_pct", "def_pct", "em", "er", "cr", "cd", "dmg", "heal", "phys")   # phys: Physical DMG Bonus (the plan's amendment of 2026-10-29)
NUMBER = re.compile(r"\d+(?:\.\d+)?")


@dataclass
class Fx:
    stat: str
    values: list[float]
    stacks: int
    when: str
    condition: str
    line: int
    settled: str = ""


@dataclass
class Block:
    key: str
    effects: list[Fx] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def number(text: str) -> float:
    value = float(text)
    return int(value) if value == int(value) else value


def read_blocks(path: Path) -> dict[str, Block]:
    """Parse an effects file. Blank lines and lines starting with # are skipped; an error names its line."""
    blocks: dict[str, Block] = {}
    current: Block | None = None
    for no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tag, rest = line[0], line[1:].strip()
        if tag == "@":
            if rest in blocks:
                raise ValueError(f"{path.name}:{no}: {rest} twice")
            current = blocks[rest] = Block(rest)
        elif current is None:
            raise ValueError(f"{path.name}:{no}: text before the first @")
        elif tag == "+":
            parts = rest.split(None, 3)
            if len(parts) < 3:
                raise ValueError(f"{path.name}:{no}: an effect needs a stat, values and always|met")
            stat, vals, when = parts[0], parts[1], parts[2]
            condition = parts[3] if len(parts) > 3 else ""
            stacks = 1
            if "*" in vals:
                vals, times = vals.split("*")
                stacks = int(times)
            if stat not in STATS:
                raise ValueError(f"{path.name}:{no}: stat {stat!r} is not in STATS")
            if when not in ("always", "met"):
                raise ValueError(f"{path.name}:{no}: when must be always or met, got {when!r}")
            if when == "met" and not condition:
                raise ValueError(f"{path.name}:{no}: a met effect needs its condition")
            values = [number(v) * stacks for v in vals.split("/")]
            current.effects.append(Fx(stat, values, stacks, when, condition, no))
        elif tag == "=":
            if not current.effects:
                raise ValueError(f"{path.name}:{no}: = needs an effect before it")
            current.effects[-1].settled = rest
        elif tag == "~":
            current.notes.append(rest)
        else:
            raise ValueError(f"{path.name}:{no}: line starts with {tag!r}")
    return blocks


def groups(text: str) -> list[list[float]]:
    """The refinement groups in a text: runs like 28%/35%/42%/49%/56%. Several runs side by side, one per refinement
    ("16%/28% | 20%/35% | 24%/42% ..."), also give their columns: 16/20/24/.. and 28/35/42/..."""
    runs = list(re.finditer(r"\d+(?:\.\d+)?%?(?:\s*/\s*\d+(?:\.\d+)?%?)+", text))
    found: list[list[float]] = [[number(n) for n in NUMBER.findall(m.group(0))] for m in runs]
    start = 0
    while start < len(runs):
        end = start
        while end + 1 < len(runs) and re.fullmatch(r"\s*\|\s*", text[runs[end].end():runs[end + 1].start()]):
            end += 1
        side = found[start:end + 1]
        if len(side) > 1 and len({len(r) for r in side}) == 1:
            found.extend([list(col) for col in zip(*side)])
        start = end + 1
    return found


def all_numbers(text: str) -> set[float]:
    return {number(n) for n in NUMBER.findall(text)}


def check(fx: Fx, text: str, refinements: int) -> str | None:
    """None when the effect's values are in the text: the list equals a refinement group of the text (divided by the
    stacks if it has any), or, for a one-value effect, the number is in the text. Otherwise a reason."""
    if len(fx.values) != refinements:
        return f"{len(fx.values)} values, expected {refinements}"
    per = [v / fx.stacks for v in fx.values]
    per = [number(str(round(p, 6))) for p in per]
    if len(set(per)) == 1:
        per = [abs(per[0])] * refinements   # a loss, like -5% ATK per stack, is written without its sign in the text
    if refinements == 1:
        return None if per[0] in all_numbers(text) else f"{per[0]} is not in the text"
    if len(set(per)) == 1:
        return None if per[0] in all_numbers(text) else f"{per[0]} is not in the text"
    for group in groups(text):
        if len(group) == refinements and group == per:
            return None
    return f"{per} is not a refinement group of the text"
