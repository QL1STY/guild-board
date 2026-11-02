"""The page's own `Pulls` type, read from web/src/types.ts, so that a test can hold the core's model against it field for
field: every object's keys, no more and no fewer, every array's items, and every value against its union (a literal, a
primitive, null or a named type).

The Pulls second pass added fields to the model; web/src/types.ts names them since the interface's part joined (the plan's
Task 11), so the check is exact and exact alone: a key the type lacks or a key the model lacks fails it."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

TYPES_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "types.ts"
NAMES = (
    "Pulls", "Banner", "PityCard", "HistoryRow", "PullsPool", "WishKind", "FiveResult", "SavingsRowKey", "SavingsRow",
    "NextVersion", "MonthWishes",
)
FIELD = re.compile(r"([A-Za-z_]\w*)\s*:\s*")
TERM = re.compile(r"'[^']*'|-?\d+(?:\.\d+)?|[A-Za-z_]\w*")
NUMBER = re.compile(r"-?\d+(?:\.\d+)?")
PRIMITIVES = {
    "number": lambda value: isinstance(value, (int, float)) and not isinstance(value, bool),
    "string": lambda value: isinstance(value, str),
    "boolean": lambda value: isinstance(value, bool),
    "null": lambda value: value is None,
}


def _skip(text: str, i: int, chars: str) -> int:
    while i < len(text) and text[i] in chars:
        i += 1
    return i


def _object(text: str, i: int) -> tuple[dict[str, list[Any]], int]:
    """The object type that opens at text[i]: each field's union."""
    fields: dict[str, list[Any]] = {}
    i += 1
    while True:
        i = _skip(text, i, " \t\r\n;")
        if text[i] == "}":
            return fields, i + 1
        match = FIELD.match(text, i)
        if match is None:
            raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")
        fields[match.group(1)], i = _union(text, match.end())


def _union(text: str, i: int) -> tuple[list[Any], int]:
    """The union that starts at text[i]: its terms, an array as ("array", term)."""
    terms: list[Any] = []
    while True:
        i = _skip(text, i, " \t")
        if text[i] == "{":
            term, i = _object(text, i)
        else:
            match = TERM.match(text, i)
            if match is None:
                raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")
            term, i = match.group(0), match.end()
        while text.startswith("[]", i):
            term, i = ("array", term), i + 2
        terms.append(term)
        after = _skip(text, i, " \t\r\n")
        if after < len(text) and text[after] == "|":
            i = after + 1
            continue
        return terms, i


def read_types() -> dict[str, list[Any]]:
    text = TYPES_TS.read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    types = {}
    for name in NAMES:
        match = re.search(rf"export type {name} = ", text)
        if match is None:
            raise ValueError(f"types.ts has no type {name}")
        types[name], _ = _union(text, match.end())
    return types


def _fits(value: Any, term: Any, types: dict[str, list[Any]], where: str) -> str | None:
    """Why `value` does not fit `term`, or None when it does."""
    if isinstance(term, dict):
        if not isinstance(value, dict):
            return f"{where}: {value!r} is not an object"
        if set(value) != set(term):
            return f"{where}: the keys {sorted(value)} are not the type's {sorted(term)}"
        for key, union in term.items():
            problem = _fits_union(value[key], union, types, f"{where}.{key}")
            if problem is not None:
                return problem
        return None
    if isinstance(term, tuple):
        if not isinstance(value, list):
            return f"{where}: {value!r} is not an array"
        for n, item in enumerate(value):
            problem = _fits_union(item, [term[1]], types, f"{where}[{n}]")
            if problem is not None:
                return problem
        return None
    if term in PRIMITIVES:
        return None if PRIMITIVES[term](value) else f"{where}: {value!r} is not a {term}"
    if term.startswith("'"):
        return None if value == term[1:-1] else f"{where}: {value!r} is not {term}"
    if NUMBER.fullmatch(term):
        fits = PRIMITIVES["number"](value) and value == float(term)
        return None if fits else f"{where}: {value!r} is not {term}"
    if term in types:
        return _fits_union(value, types[term], types, where)
    raise ValueError(f"types.ts names a type the test does not read: {term}")


def _fits_union(value: Any, union: list[Any], types: dict[str, list[Any]], where: str) -> str | None:
    problems = [_fits(value, term, types, where) for term in union]
    if any(problem is None for problem in problems):
        return None
    return problems[0] if len(problems) == 1 else f"{where}: {value!r} fits none of its type: {'; '.join(problems)}"


def problem_with(value: Any, name: str = "Pulls") -> str | None:
    """Why `value` is not of the page's type `name`, or None when it is: the keys of every object are the type's, no more
    and no fewer."""
    types = read_types()
    return _fits_union(value, types[name], types, name)
