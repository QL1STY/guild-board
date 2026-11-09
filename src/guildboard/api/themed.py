"""The built page with the player's theme written on its <html>, so that the first paint is already in that theme."""
from __future__ import annotations

from guildboard.config import THEMES

DEFAULT_THEME = THEMES[0]
_OPENING = '<html lang="en">'


def themed_index(html: str, theme: str) -> str:
    """The page with data-theme on its first <html lang="en">; a theme that is not one of THEMES counts as parchment."""
    chosen = theme if theme in THEMES else DEFAULT_THEME
    return html.replace(_OPENING, f'<html lang="en" data-theme="{chosen}">', 1)
