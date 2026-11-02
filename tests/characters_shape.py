"""The Characters pages' own types, read from web/src/types.ts, so that a test can hold a model (the core's or a fixture of
the interface's) against them field for field: every object's keys, no more and no fewer, every array's items, every
tuple's places, every Record's keys and values, and every value against its union (a literal, a primitive, null or a named
type). It follows pulls_shape.py, and reads what that one does not: tuples (`[number, number][]`) and `Record<K, V>` and
`Partial<Record<K, V>>` (the plan's contract uses both)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Sequence

TYPES_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "types.ts"
NAMES = (
    "Element", "WeaponType", "Slot", "Weight", "Pronouns", "CharSync", "RosterEntry", "Roster", "StatRow", "RollRow",
    "SubView", "PieceView", "WeaponView", "MaterialRow", "Readiness", "Profile", "Option", "Planner", "PlanBody",
    "WeekTask", "WeekDay", "FocusCard", "Week", "TeamView", "Endgame",
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
GENERICS = ("Record", "Partial")
WHITESPACE = " \t\r\n"


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


def _tuple(text: str, i: int) -> tuple[tuple[Any, ...], int]:
    """The tuple type that opens at text[i]: ("tuple", the union of each place)."""
    places: list[list[Any]] = []
    i += 1
    while True:
        i = _skip(text, i, " \t\r\n")
        union, i = _union(text, i)
        places.append(union)
        i = _skip(text, i, " \t\r\n")
        if text[i] == ",":
            i += 1
            continue
        if text[i] == "]":
            return ("tuple", places), i + 1
        raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")


def _generic(text: str, name: str, i: int) -> tuple[tuple[Any, ...], int]:
    """Record<K, V> as ("record", K, V, partial), Partial<Record<K, V>> as the same with partial True, and Partial<Name> as
    ("some", Name), which any of that type's fields may be missing from; i is at the '<'."""
    i += 1
    if name == "Partial":
        i = _skip(text, i, " \t\r\n")
        inner, i = _term(text, i)
        i = _skip(text, i, " \t\r\n")
        if text[i] == ">" and isinstance(inner, str):
            return ("some", inner), i + 1
        if inner[0] != "record" or text[i] != ">":
            raise ValueError("types.ts: Partial is read only around a Record or a named type")
        return ("record", inner[1], inner[2], True), i + 1
    keys, i = _union(text, _skip(text, i, " \t\r\n"))
    i = _skip(text, i, " \t\r\n")
    if text[i] != ",":
        raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")
    values, i = _union(text, _skip(text, i + 1, " \t\r\n"))
    i = _skip(text, i, " \t\r\n")
    if text[i] != ">":
        raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")
    return ("record", keys, values, False), i + 1


def _term(text: str, i: int) -> tuple[Any, int]:
    """One term of a union, with its array suffixes: an array is ("array", term)."""
    if text[i] == "(":
        inner, i = _union(text, _skip(text, i + 1, WHITESPACE))
        i = _skip(text, i, WHITESPACE)
        if text[i] != ")":
            raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")
        term, i = ("group", inner), i + 1
    elif text[i] == "{":
        term, i = _object(text, i)
    elif text[i] == "[":
        term, i = _tuple(text, i)
    else:
        match = TERM.match(text, i)
        if match is None:
            raise ValueError(f"types.ts cannot be read at {text[i:i + 40]!r}")
        term, i = match.group(0), match.end()
        if term in GENERICS and text.startswith("<", i):
            term, i = _generic(text, term, i)
    while text.startswith("[]", i):
        term, i = ("array", term), i + 2
    return term, i


def _union(text: str, i: int) -> tuple[list[Any], int]:
    """The union that starts at text[i]: its terms, an object made of two as ("both", A, B)."""
    terms: list[Any] = []
    while True:
        i = _skip(text, i, " \t")
        term, i = _term(text, i)
        after = _skip(text, i, " \t\r\n")
        while after < len(text) and text[after] == "&":
            other, i = _term(text, _skip(text, after + 1, " \t\r\n"))
            term = ("both", term, other)
            after = _skip(text, i, " \t\r\n")
        terms.append(term)
        if after < len(text) and text[after] == "|":
            i = after + 1
            continue
        return terms, i


def read_types(path: Path = TYPES_TS, names: Sequence[str] = NAMES) -> dict[str, list[Any]]:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    types = {}
    for name in names:
        match = re.search(rf"export type {name} = ", text)
        if match is None:
            raise ValueError(f"types.ts has no type {name}")
        types[name], _ = _union(text, match.end())
    return types


def _fields(term: Any, types: dict[str, list[Any]]) -> dict[str, list[Any]]:
    """The fields of an object type: written out, by its name, or made of two."""
    if isinstance(term, dict):
        return term
    if isinstance(term, tuple) and term[0] == "both":
        return {**_fields(term[1], types), **_fields(term[2], types)}
    return _fields(types[term][0], types)


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
    if isinstance(term, tuple) and term[0] == "both":
        return _fits(value, _fields(term, types), types, where)
    if isinstance(term, tuple) and term[0] == "some":
        fields = _fields(term[1], types)
        if not isinstance(value, dict):
            return f"{where}: {value!r} is not an object"
        if set(value) - set(fields):
            return f"{where}: the keys {sorted(value)} are not among the type's {sorted(fields)}"
        for key, item in value.items():
            problem = _fits_union(item, fields[key], types, f"{where}.{key}")
            if problem is not None:
                return problem
        return None
    if isinstance(term, tuple) and term[0] == "group":
        return _fits_union(value, term[1], types, where)
    if isinstance(term, tuple) and term[0] == "array":
        if not isinstance(value, list):
            return f"{where}: {value!r} is not an array"
        for n, item in enumerate(value):
            problem = _fits_union(item, [term[1]], types, f"{where}[{n}]")
            if problem is not None:
                return problem
        return None
    if isinstance(term, tuple) and term[0] == "tuple":
        places = term[1]
        if not isinstance(value, list) or len(value) != len(places):
            return f"{where}: {value!r} is not a tuple of {len(places)}"
        for n, (item, union) in enumerate(zip(value, places)):
            problem = _fits_union(item, union, types, f"{where}[{n}]")
            if problem is not None:
                return problem
        return None
    if isinstance(term, tuple) and term[0] == "record":
        _, keys, values, partial = term
        if not isinstance(value, dict):
            return f"{where}: {value!r} is not an object"
        for key, item in value.items():
            problem = _fits_union(key, keys, types, f"{where} (key {key!r})")
            if problem is not None:
                return problem
            problem = _fits_union(item, values, types, f"{where}.{key}")
            if problem is not None:
                return problem
        if not partial:
            literals = [k[1:-1] for k in keys if isinstance(k, str) and k.startswith("'")]
            if literals and len(literals) == len(keys) and set(value) != set(literals):
                return f"{where}: the keys {sorted(value)} are not the record's {sorted(literals)}"
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


def problem_with(value: Any, name: str, path: Path = TYPES_TS, names: Sequence[str] = NAMES) -> str | None:
    """Why `value` is not of the page's type `name`, or None when it is: the keys of every object are the type's, no more
    and no fewer. `path` and `names` say where to read the types, for models that keep them in another file."""
    types = read_types(path, names)
    return _fits_union(value, types[name], types, name)
