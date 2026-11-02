"""A small JSON Schema check for the Characters reference files, so that no dependency is added for it. It reads the part
of JSON Schema the files' schemas use: type (one name or a list), enum, properties, required, additionalProperties (false,
true or a schema, for the values of a map), items, minItems, maxItems, minimum, maximum, minLength and pattern."""
from __future__ import annotations

import re
from typing import Any

TYPES = {
    "object": lambda value: isinstance(value, dict),
    "array": lambda value: isinstance(value, list),
    "string": lambda value: isinstance(value, str),
    "integer": lambda value: isinstance(value, int) and not isinstance(value, bool),
    "number": lambda value: isinstance(value, (int, float)) and not isinstance(value, bool),
    "boolean": lambda value: isinstance(value, bool),
    "null": lambda value: value is None,
}


def problem_with(value: Any, schema: dict[str, Any], where: str = "$") -> str | None:
    """Why `value` does not fit `schema`, or None when it does."""
    wanted = schema.get("type")
    if wanted is not None:
        names = [wanted] if isinstance(wanted, str) else list(wanted)
        for name in names:
            if name not in TYPES:
                raise ValueError(f"{where}: the schema names a type this check does not read: {name}")
        if not any(TYPES[name](value) for name in names):
            return f"{where}: {value!r} is not {' or '.join(names)}"
    if "enum" in schema and value not in schema["enum"]:
        return f"{where}: {value!r} is not one of {schema['enum']}"
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            return f"{where}: {value!r} is shorter than {schema['minLength']}"
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            return f"{where}: {value!r} does not match {schema['pattern']}"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            return f"{where}: {value!r} is below {schema['minimum']}"
        if "maximum" in schema and value > schema["maximum"]:
            return f"{where}: {value!r} is above {schema['maximum']}"
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            return f"{where}: {len(value)} items, at least {schema['minItems']} wanted"
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            return f"{where}: {len(value)} items, at most {schema['maxItems']} wanted"
        if "items" in schema:
            for n, item in enumerate(value):
                problem = problem_with(item, schema["items"], f"{where}[{n}]")
                if problem is not None:
                    return problem
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                return f"{where}: {name} is missing"
        extra = schema.get("additionalProperties", True)
        for name, item in value.items():
            if name in properties:
                problem = problem_with(item, properties[name], f"{where}.{name}")
            elif extra is False:
                problem = f"{where}: {name} is not a field here"
            elif isinstance(extra, dict):
                problem = problem_with(item, extra, f"{where}.{name}")
            else:
                problem = None
            if problem is not None:
                return problem
    return None
