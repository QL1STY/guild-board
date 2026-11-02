import ctypes
from ctypes import wintypes

import pytest

from guildboard.hotkeys import parse_hotkey
from guildboard.shell.hotkey import HOTKEY_ID, WM_HOTKEY, GlobalHotkey, HotkeyFilter
from support import FakeUser32

MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x0001, 0x0002, 0x0004, 0x4000


def _message(kind: int, ident: int = 0) -> wintypes.MSG:
    # A message made by hand, as Windows would deliver it: no key is pressed and no input is sent.
    return wintypes.MSG(hWnd=None, message=kind, wParam=ident, lParam=0)


def test_register_takes_the_flags_and_key_of_the_hotkey(qtbot):
    user32 = FakeUser32()
    hotkey = GlobalHotkey(user32)
    assert hotkey.register(parse_hotkey("Ctrl+Alt+G")) is True
    # For Guild Board's own thread (no window), under id 1, held down it counts once.
    assert user32.calls == [("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, ord("G"))]
    assert hotkey.held == parse_hotkey("Ctrl+Alt+G")
    hotkey.unregister()
    assert user32.calls[-1] == ("UnregisterHotKey", None, HOTKEY_ID)
    assert hotkey.held is None


def test_a_new_hotkey_lets_the_old_one_go_first(qtbot):
    user32 = FakeUser32()
    hotkey = GlobalHotkey(user32)
    hotkey.register(parse_hotkey("Ctrl+Alt+G"))
    assert hotkey.register(parse_hotkey("Ctrl+Shift+F9")) is True
    assert user32.calls[1:] == [
        ("UnregisterHotKey", None, HOTKEY_ID),
        ("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 0x78),  # VK_F9
    ]
    assert hotkey.held == parse_hotkey("Ctrl+Shift+F9")


def test_a_refused_hotkey_returns_false_and_holds_nothing(qtbot):
    # Another program holds Ctrl+Alt+H: Windows refuses it, and the old hotkey has been let go all the same.
    user32 = FakeUser32(taken=frozenset({ord("H")}))
    hotkey = GlobalHotkey(user32)
    assert hotkey.register(parse_hotkey("Ctrl+Alt+G")) is True
    assert hotkey.register(parse_hotkey("Ctrl+Alt+H")) is False
    assert user32.calls[1:] == [
        ("UnregisterHotKey", None, HOTKEY_ID),
        ("RegisterHotKey", None, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, ord("H")),
    ]
    assert hotkey.held is None
    hotkey.unregister()
    assert len(user32.calls) == 3  # nothing is held, so there is nothing to let go


def test_the_filter_answers_wm_hotkey_for_its_id_only(qtbot):
    hotkey = GlobalHotkey(FakeUser32())
    presses: list[bool] = []
    hotkey.pressed.connect(lambda: presses.append(True))
    hotkeys = HotkeyFilter(hotkey.pressed.emit)
    ours = _message(WM_HOTKEY, HOTKEY_ID)
    assert hotkeys.nativeEventFilter(b"windows_generic_MSG", ctypes.addressof(ours)) == (True, 0)
    assert presses == [True]
    # Another hotkey id, and a key press (0x0100), go on to Qt; so does a message of another kind of event.
    for kind, message in (
        (b"windows_generic_MSG", _message(WM_HOTKEY, HOTKEY_ID + 1)),
        (b"windows_generic_MSG", _message(0x0100, HOTKEY_ID)),
        (b"windows_dispatcher_MSG", ours),
    ):
        assert hotkeys.nativeEventFilter(kind, ctypes.addressof(message)) == (False, 0), (kind, message.message)
    assert presses == [True]


def test_no_test_registers_a_hotkey_with_windows(qtbot):
    # Checked before anything is asked of Windows: without conftest.py's refusal, the call below would take the
    # player's Ctrl+Alt+G for as long as the tests run.
    refusal = getattr(ctypes.windll.user32.RegisterHotKey, "__qualname__", None)
    assert refusal == "no_global_hotkey.<locals>.refuse"
    with pytest.raises(pytest.fail.Exception, match="tried to register a global hotkey"):
        GlobalHotkey().register(parse_hotkey("Ctrl+Alt+G"))  # Windows' own user32, as Guild Board uses it
