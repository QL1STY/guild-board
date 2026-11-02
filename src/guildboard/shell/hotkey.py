"""The overlay's hotkey (stage 2A spec 14.1). It is registered with Windows, as in the overlay probe: Windows sends it
to Guild Board's own thread whichever program is in front, the game too, and Qt hands its message to the filter here.
Nothing listens to the keyboard itself."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from typing import Any, Callable

from PySide6.QtCore import QAbstractNativeEventFilter, QObject, Signal

from guildboard.hotkeys import Hotkey

WM_HOTKEY = 0x0312
HOTKEY_ID = 1  # the overlay's hotkey, the only one Guild Board holds


class GlobalHotkey(QObject):
    """Holds one hotkey at a time with Windows. It is registered for the thread that registers it, with no window, so
    it is registered on Qt's thread, which reads that thread's messages. `pressed` is emitted by a HotkeyFilter."""

    pressed = Signal()

    def __init__(self, user32: Any = None) -> None:
        super().__init__()
        self._user32 = user32 if user32 is not None else ctypes.windll.user32
        self._held: Hotkey | None = None

    @property
    def held(self) -> Hotkey | None:
        """The hotkey Windows holds for Guild Board, or None."""
        return self._held

    def register(self, hotkey: Hotkey) -> bool:
        """Lets the hotkey held go, then asks Windows for this one. False when Windows refuses it, as it does when
        another program holds it: Guild Board then holds no hotkey."""
        self.unregister()
        if not self._user32.RegisterHotKey(None, HOTKEY_ID, hotkey.flags, hotkey.virtual_key):
            return False
        self._held = hotkey
        return True

    def unregister(self) -> None:
        if self._held is not None:
            self._user32.UnregisterHotKey(None, HOTKEY_ID)
            self._held = None


class HotkeyFilter(QAbstractNativeEventFilter):
    """Hears the overlay's hotkey among the messages Windows sends Qt's thread, and calls `on_hotkey` for it. Every
    other message goes on to Qt."""

    def __init__(self, on_hotkey: Callable[[], object]) -> None:
        super().__init__()
        self._on_hotkey = on_hotkey

    def nativeEventFilter(self, event_type, message) -> tuple[bool, int]:  # noqa: N802, ANN001
        if bytes(event_type) != b"windows_generic_MSG":
            return False, 0
        msg = wintypes.MSG.from_address(int(message))
        if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
            self._on_hotkey()
            return True, 0
        return False, 0
