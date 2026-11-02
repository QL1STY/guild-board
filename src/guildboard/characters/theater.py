"""The Imaginarium Theater's elements (the design, section 7.10): read from the description of the event calendar's Theater
entry, as the element names found in it."""
from __future__ import annotations

import re

from guildboard.characters import ELEMENTS

_ELEMENT = re.compile(r"\b(" + "|".join(ELEMENTS) + r")\b", re.IGNORECASE)


def elements(text: str) -> tuple[str, ...]:
    """The month's three elements from the calendar's text, in the order they are named, each once; none when the text names
    fewer or more than three different ones."""
    found: list[str] = []
    for match in _ELEMENT.finditer(text or ""):
        element = match.group(1).capitalize()
        if element not in found:
            found.append(element)
    return tuple(found) if len(found) == 3 else ()
