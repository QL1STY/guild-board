"""The overlay's hotkey as text, such as "Ctrl+Alt+G": how to read one, what is wrong with one, and what Windows'
RegisterHotKey takes for it (stage 2A spec 14.1 and 14.2)."""
from __future__ import annotations

from dataclasses import dataclass

DEFAULT = "Ctrl+Alt+G"

# The modifiers in the order the text names them, each with its RegisterHotKey flag.
MODIFIERS = {"Ctrl": 0x0002, "Alt": 0x0001, "Shift": 0x0004, "Win": 0x0008}
MOD_NOREPEAT = 0x4000  # a key held down sends the hotkey once
KEYS = frozenset([*"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", *(f"F{n}" for n in range(1, 13))])
# Windows reports AltGr as Ctrl+Alt, and on the player's Polish layout AltGr with these keys types a letter (14.2).
ALTGR_LETTERS = frozenset("ACELNOSUXZ")

_MODIFIER_NAMES = {name.lower(): name for name in MODIFIERS}


@dataclass(frozen=True)
class Hotkey:
    modifiers: frozenset[str]
    key: str

    @property
    def text(self) -> str:
        return "+".join([*(name for name in MODIFIERS if name in self.modifiers), self.key])

    @property
    def flags(self) -> int:
        flags = MOD_NOREPEAT
        for name in self.modifiers:
            flags |= MODIFIERS[name]
        return flags

    @property
    def virtual_key(self) -> int:
        if self.key.startswith("F") and len(self.key) > 1:
            return 0x70 + int(self.key[1:]) - 1  # VK_F1 is 0x70
        return ord(self.key)  # a letter's or a digit's virtual key is its character


def parse_hotkey(text: str) -> Hotkey | None:
    """The hotkey a text names, in any case and order: modifiers named once each, then one key from A to Z, 0 to 9
    or F1 to F12. None when the text names no such hotkey."""
    *names, key = [part.strip() for part in text.split("+")]
    modifiers: set[str] = set()
    for name in names:
        modifier = _MODIFIER_NAMES.get(name.lower())
        if modifier is None or modifier in modifiers:
            return None
        modifiers.add(modifier)
    if key.upper() not in KEYS:
        return None
    return Hotkey(frozenset(modifiers), key.upper())


def hotkey_problem(text: str) -> str | None:
    """What is wrong with a hotkey, in a sentence for the player, or None when it can be used."""
    hotkey = parse_hotkey(text)
    if hotkey is None:
        return "Write a key with Ctrl, Alt, Shift or Win before it, such as Ctrl+Alt+G."
    if not hotkey.modifiers & {"Ctrl", "Alt", "Win"}:
        return "A hotkey needs Ctrl, Alt or Win, so that typing does not open the overlay."
    if {"Ctrl", "Alt"} <= hotkey.modifiers and hotkey.key in ALTGR_LETTERS:
        return f"{hotkey.text} types a letter on your keyboard. Choose another key."
    if hotkey.modifiers == {"Ctrl"} and hotkey.key == "0":  # Guild Board's window takes it (shell/src/dashboard.ts)
        return "Ctrl+0 sets the page size back to 100%. Choose another key."
    return None
