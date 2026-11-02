import ctypes
from ctypes import wintypes
from types import SimpleNamespace

from PySide6.QtCore import Qt, QTime
from PySide6.QtWidgets import QLineEdit

from guildboard.shell import overlay_probe
from guildboard.shell.overlay_probe import (
    INTERACT,
    LAYER,
    NOTIFY,
    QUIT,
    TOGGLE,
    WM_HOTKEY,
    ClockTimer,
    HotkeyFilter,
    ProbeLayer,
    ProbePanel,
    ms_to_next_tick,
)


def _message(kind: int, ident: int = 0) -> wintypes.MSG:
    # A message made by hand, as Windows would deliver it: no key is pressed and no input is sent.
    return wintypes.MSG(hWnd=None, message=kind, wParam=ident, lParam=0)


def test_the_hotkeys_reach_the_probe_and_other_messages_pass(qtbot):
    heard: list[int] = []
    hotkeys = HotkeyFilter(heard.append)
    toggle, other = _message(WM_HOTKEY, TOGGLE), _message(0x0100)  # 0x0100 is a key press, which is not ours
    assert hotkeys.nativeEventFilter(b"windows_generic_MSG", ctypes.addressof(toggle))[0] is True
    assert hotkeys.nativeEventFilter(b"windows_generic_MSG", ctypes.addressof(other))[0] is False
    assert heard == [TOGGLE]


def test_the_panel_stays_on_top_and_takes_no_clicks_and_no_focus(qtbot):
    panel = ProbePanel()
    qtbot.addWidget(panel)
    flags = panel.windowFlags()
    for flag in (
        Qt.WindowType.WindowStaysOnTopHint,
        Qt.WindowType.WindowTransparentForInput,
        Qt.WindowType.WindowDoesNotAcceptFocus,
        Qt.WindowType.FramelessWindowHint,
        Qt.WindowType.Tool,
    ):
        assert flags & flag, flag
    assert panel.testAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)


def test_the_toggle_hotkey_hides_and_shows_the_panel_and_each_press_is_counted(qtbot):
    panel = ProbePanel()
    qtbot.addWidget(panel)
    panel.show()
    panel.hotkey(TOGGLE)
    assert not panel.isVisible()
    panel.hotkey(TOGGLE)
    assert panel.isVisible()
    assert "Ctrl+Alt+G arrived 2 times" in panel.text()
    with qtbot.waitSignal(panel.finished):
        panel.hotkey(QUIT)


def test_the_interact_hotkey_lets_the_panel_take_clicks_and_then_lets_them_through_again(qtbot):
    panel = ProbePanel()
    qtbot.addWidget(panel)
    panel.show()
    panel.hotkey(INTERACT)
    assert panel.interactive() and panel.isVisible()
    assert not panel.windowFlags() & Qt.WindowType.WindowTransparentForInput
    assert not panel.windowFlags() & Qt.WindowType.WindowDoesNotAcceptFocus
    text_box = panel.findChild(QLineEdit)
    assert panel.focusWidget() is text_box  # typing, and Space, go to the text box, not to the button
    qtbot.mouseClick(panel.button(), Qt.MouseButton.LeftButton)
    assert panel.clicks == 1
    assert panel.focusWidget() is text_box  # the click leaves the keyboard with the text box
    panel.hotkey(INTERACT)
    assert not panel.interactive() and panel.isVisible()
    assert panel.windowFlags() & Qt.WindowType.WindowTransparentForInput
    assert panel.windowFlags() & Qt.WindowType.WindowDoesNotAcceptFocus


def test_the_layer_hotkey_shows_and_hides_a_see_through_layer_that_takes_no_clicks(qtbot):
    layer = ProbeLayer()
    qtbot.addWidget(layer)
    panel = ProbePanel(layer=layer)
    qtbot.addWidget(panel)
    panel.hotkey(LAYER)
    assert layer.isVisible()
    for flag in (Qt.WindowType.WindowTransparentForInput, Qt.WindowType.WindowDoesNotAcceptFocus,
                 Qt.WindowType.WindowStaysOnTopHint):
        assert layer.windowFlags() & flag, flag
    assert layer.testAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
    assert "see-through layer" in layer.text()
    panel.hotkey(LAYER)
    assert not layer.isVisible()


def test_the_notify_hotkey_sends_a_test_notification_and_the_summary_counts_every_key(qtbot):
    sent: list[bool] = []
    panel = ProbePanel(notify=lambda: sent.append(True))
    qtbot.addWidget(panel)
    panel.hotkey(NOTIFY)
    assert sent == [True]
    summary = panel.summary()
    for line in ("Ctrl+Alt+G arrived 0 times", "Ctrl+Alt+I arrived 0 times", "Ctrl+Alt+K arrived 0 times",
                 "Ctrl+Alt+T arrived 1 time", "the button was clicked 0 times"):
        assert line in summary


def test_a_count_of_one_reads_1_time_and_any_other_count_reads_n_times(qtbot):
    panel = ProbePanel()
    qtbot.addWidget(panel)
    panel.show()
    panel.hotkey(TOGGLE)
    assert "Ctrl+Alt+G arrived 1 time. It hides or shows this panel." in panel.text()
    panel.hotkey(TOGGLE)
    assert "Ctrl+Alt+G arrived 2 times. It hides or shows this panel." in panel.text()
    panel.button().click()
    assert panel.summary() == (
        "Ctrl+Alt+G arrived 2 times; Ctrl+Alt+I arrived 0 times; Ctrl+Alt+K arrived 0 times; "
        "Ctrl+Alt+T arrived 0 times; Ctrl+Alt+Q arrived 0 times; the button was clicked 1 time."
    )


# The letters AltGr leaves free on the player's Polish (Programmers) layout, from Task 1's rulings (1): Windows reports
# AltGr as Ctrl+Alt, so Ctrl+Alt with any other letter would take that letter from the player's typing. On the player's
# PC another program holds Ctrl+Alt+M, and Ctrl+Alt+B also switches on Do not disturb.
ALTGR_FREE = set("BDFGHIJKMPQRTVWY")
TAKEN_ON_THE_PLAYERS_PC = set("MB")


def test_the_keys_the_probe_registers_are_the_ones_it_names_and_they_take_no_letter_from_typing(qtbot):
    panel = ProbePanel()
    qtbot.addWidget(panel)
    assert set(overlay_probe.KEYS) == set(overlay_probe.NAMES) == {TOGGLE, INTERACT, LAYER, NOTIFY, QUIT}
    for ident, key in overlay_probe.KEYS.items():
        letter = chr(key)
        assert overlay_probe.NAMES[ident] == "Ctrl+Alt+" + letter, ident
        assert overlay_probe.NAMES[ident] in panel.text(), ident
        assert letter in ALTGR_FREE - TAKEN_ON_THE_PLAYERS_PC, letter


def test_from_any_moment_the_next_clock_tick_is_aimed_just_after_the_next_whole_second():
    for ms in range(1000):
        now = QTime(9, 30, 15, ms)
        assert now.addMSecs(ms_to_next_tick(now)) == QTime(9, 30, 16, 10), ms


def test_both_clocks_show_the_time_they_read_and_aim_their_next_tick_from_that_reading(qtbot, monkeypatch):
    # The probe's clock reads a time of day given here, so nothing waits for a real second to pass.
    monkeypatch.setattr(overlay_probe, "QTime", SimpleNamespace(currentTime=lambda: QTime(9, 30, 15, 400)))
    layer = ProbeLayer()
    qtbot.addWidget(layer)
    panel = ProbePanel()
    qtbot.addWidget(panel)
    assert layer.text() == "Guild Board see-through layer · 09:30:15"
    assert "The clock moves each second: 09:30:15\n" in panel.text()
    for widget in (panel, layer):
        (clock,) = widget.findChildren(ClockTimer)
        assert clock.isActive() and clock.isSingleShot(), widget
        assert clock.timerType() == Qt.TimerType.PreciseTimer, widget
        assert clock.interval() == 610, widget  # 600 ms to 09:30:16, and 10 more
