"""Reading text that HoYoverse sends as HTML, in one pass over it. Their text is not ours to trust: a pattern such as
`<[^>]+>` looks to the end of the text from every `<` that never closes, which is quadratic on input made for it, so the
scans here use `str.find` and are linear, and a field is cut at MAX_FIELD_CHARS before anything reads it."""
from __future__ import annotations

import re
from typing import Any


MAX_FIELD_CHARS = 64 * 1024  # the longest wiki field or title read; real ones are a few thousand characters


def strip_tags(text: str) -> str:
    """The text without its `<...>` tags: from a `<` to the first `>` after it, however many `<` lie between. A `<` with no
    `>` after it, and an empty `<>`, are text."""
    parts: list[str] = []
    at = 0
    while True:
        start = text.find("<", at)
        if start < 0:
            break
        end = text.find(">", start + 1)
        if end < 0:  # nothing after this is a tag
            break
        if end == start + 1:  # "<>" has nothing in it to be a tag
            parts.append(text[at:start + 1])
            at = start + 1
            continue
        parts.append(text[at:start])
        at = end + 1
    parts.append(text[at:])
    return "".join(parts)


# A row's name where the wiki writes a control twice, once for each layout: "#{LAYOUT_MOBILE#Tap}{LAYOUT_PC#Press} DMG".
_LAYOUT_RUN = re.compile(r"#?((?:\{LAYOUT_[A-Z]+#[^{}]*\})+)")
_LAYOUT_ONE = re.compile(r"\{LAYOUT_([A-Z]+)#([^{}]*)\}")


def clean_row_name(name: Any) -> str:
    """A talent row's name with each layout token resolved to the PC wording (`#{LAYOUT_MOBILE#Tap}{LAYOUT_PC#Press} DMG` is
    "Press DMG"; with no PC wording the first there is) and its spaces tidied (a no-break space too)."""

    def pick(found: re.Match[str]) -> str:
        wordings = dict(_LAYOUT_ONE.findall(found.group(1)))
        return wordings.get("PC", next(iter(wordings.values()), ""))

    return " ".join(_LAYOUT_RUN.sub(pick, str(name or "")[:MAX_FIELD_CHARS]).split())
