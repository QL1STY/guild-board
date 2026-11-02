"""Reading text that HoYoverse sends as HTML, in one pass over it. Their text is not ours to trust: a pattern such as
`<[^>]+>` looks to the end of the text from every `<` that never closes, which is quadratic on input made for it, so the
scans here use `str.find` and are linear, and a field is cut at MAX_FIELD_CHARS before anything reads it."""
from __future__ import annotations

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
