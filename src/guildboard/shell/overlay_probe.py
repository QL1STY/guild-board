"""The overlay probe answers questions about the overlay before it is built. It runs over the game in its current
fullscreen mode. Stage 1 asked two questions: is an always-on-top panel visible over the game, and does a global
hotkey arrive while the game has the focus? Stage 2 asks three more: when the panel takes the mouse and keyboard,
does the game stay full screen and get the focus back afterwards; does a see-through layer the size of the display,
with a clock that moves each second, make the game stutter; and does a Windows notification show?

The panel and the layer are windows of Guild Board's own that stay on top. The layer never takes clicks or the
focus, and the panel takes them only while the player asks it to. The hotkeys are key combinations Guild Board asks
Windows for, and the notification comes from Guild Board's own tray icon. No other process is involved, and the
game is never touched.

Run it with `uv run python -m guildboard.shell.overlay_probe`. Ctrl+Alt+G hides or shows the panel, Ctrl+Alt+I lets
the panel take clicks or lets them through again, Ctrl+Alt+K shows or hides the layer, Ctrl+Alt+T sends a test
notification, and Ctrl+Alt+Q ends the test and prints how often each combination arrived and the button was clicked.
"""
from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes
from typing import Callable

from PySide6.QtCore import QAbstractNativeEventFilter, QObject, QRectF, Qt, QTime, QTimer, Signal
from PySide6.QtGui import QColor, QGuiApplication, QPainter, QPaintEvent
from PySide6.QtWidgets import QApplication, QLabel, QLineEdit, QPushButton, QSystemTrayIcon, QVBoxLayout, QWidget

from guildboard.shell.tray import app_icon

WM_HOTKEY = 0x0312
MOD_ALT, MOD_CONTROL, MOD_NOREPEAT = 0x0001, 0x0002, 0x4000
TOGGLE, QUIT = 1, 2
INTERACT, LAYER, NOTIFY = 3, 4, 5
# On keyboards where AltGr types a letter, Ctrl+Alt with that letter is AltGr: the probe would take the letter from
# the player's typing and count it as a press. So it uses letters that AltGr leaves free on the player's Polish
# (Programmers) layout, and that no other program on the player's PC uses: another holds Ctrl+Alt+M, and Ctrl+Alt+B
# also switches on Windows' Do not disturb there. The summary names the keys in this order.
KEYS = {TOGGLE: ord("G"), INTERACT: ord("I"), LAYER: ord("K"), NOTIFY: ord("T"), QUIT: ord("Q")}
NAMES = {TOGGLE: "Ctrl+Alt+G", INTERACT: "Ctrl+Alt+I", LAYER: "Ctrl+Alt+K", NOTIFY: "Ctrl+Alt+T", QUIT: "Ctrl+Alt+Q"}
EDGE = 40  # pixels in from the display's edges
TICK_AFTER_MS = 10  # the clocks tick this long after each whole second, so the time they read has moved on


def times(count: int) -> str:
    """`1 time` or `{count} times`, for the counts the player reads."""
    return "1 time" if count == 1 else f"{count} times"


def ms_to_next_tick(now: QTime) -> int:
    """Milliseconds from `now` to the clocks' next tick, just after the next whole second."""
    return 1000 - now.msec() + TICK_AFTER_MS


class ClockTimer(QTimer):
    """Ticks just after each whole second, so a clock that moves on its ticks shows every second once. A repeating
    one-second timer drifts, and its clock now and then skips a second. This one-shot timer is aimed afresh at each
    tick, from the same reading of the time that the tick shows."""

    def __init__(self, parent: QObject, show: Callable[[QTime], None]) -> None:
        super().__init__(parent)
        self._show = show
        self.setSingleShot(True)
        self.setTimerType(Qt.TimerType.PreciseTimer)  # to the millisecond; a coarse one may be 5% off, 50 ms a second
        self.timeout.connect(self.tick)

    def tick(self) -> None:
        now = QTime.currentTime()
        self._show(now)
        self.start(ms_to_next_tick(now))


class HotkeyFilter(QAbstractNativeEventFilter):
    def __init__(self, on_hotkey: Callable[[int], None]) -> None:
        super().__init__()
        self._on_hotkey = on_hotkey

    def nativeEventFilter(self, event_type, message) -> tuple[bool, int]:  # noqa: N802, ANN001
        if bytes(event_type) != b"windows_generic_MSG":
            return False, 0
        msg = wintypes.MSG.from_address(int(message))
        if msg.message == WM_HOTKEY and msg.wParam in KEYS:
            self._on_hotkey(int(msg.wParam))
            return True, 0
        return False, 0


class ProbePanel(QWidget):
    finished = Signal()

    def __init__(self, layer: QWidget | None = None, notify: Callable[[], None] = lambda: None) -> None:
        super().__init__(
            None,
            Qt.WindowType.Tool  # no taskbar button
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.WindowTransparentForInput  # clicks go through
            | Qt.WindowType.WindowDoesNotAcceptFocus,
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)  # the game keeps the focus
        self._layer = layer
        self._notify = notify
        self._presses = dict.fromkeys(KEYS, 0)
        self.clicks = 0
        self._label = QLabel(self)
        self._label.setStyleSheet("color: #F4EAD3; font-size: 15px;")
        self._button = QPushButton("Click to test", self)
        self._button.setFocusPolicy(Qt.FocusPolicy.NoFocus)  # a click leaves the keyboard with the text box
        self._button.clicked.connect(self._count_click)
        self._text_box = QLineEdit(self)
        self._text_box.setPlaceholderText("Type here to test the keyboard")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.addWidget(self._label)
        layout.addWidget(self._button)
        layout.addWidget(self._text_box)
        self._clock = ClockTimer(self, self._show_time)
        self._clock.tick()  # shows the time now and aims the next tick

    def text(self) -> str:
        return self._label.text()

    def button(self) -> QPushButton:
        return self._button

    def interactive(self) -> bool:
        return not (self.windowFlags() & Qt.WindowType.WindowTransparentForInput)

    def set_interactive(self, on: bool) -> None:
        """Lets the panel take the mouse and keyboard, or lets them through to the game again."""
        flags = self.windowFlags()
        for flag in (Qt.WindowType.WindowTransparentForInput, Qt.WindowType.WindowDoesNotAcceptFocus):
            flags = flags & ~flag if on else flags | flag
        self.setWindowFlags(flags)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, not on)
        self.show()  # Qt hides a window whose flags change
        if on:
            self.raise_()
            self.activateWindow()
            self._text_box.setFocus()  # typing, and Space, go to the text box, not to the button

    def hotkey(self, ident: int) -> None:
        self._presses[ident] = self._presses.get(ident, 0) + 1
        if ident == TOGGLE:
            self.setVisible(not self.isVisible())
            self._redraw()
        elif ident == INTERACT:
            self.set_interactive(not self.interactive())
        elif ident == LAYER and self._layer is not None:
            self._layer.setVisible(not self._layer.isVisible())
        elif ident == NOTIFY:
            self._notify()
        elif ident == QUIT:
            self.finished.emit()

    def summary(self) -> str:
        arrived = "; ".join(f"{name} arrived {times(self._presses[ident])}" for ident, name in NAMES.items())
        return f"{arrived}; the button was clicked {times(self.clicks)}."

    def paintEvent(self, event: QPaintEvent) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor(59, 66, 85, 200))
        painter.drawRoundedRect(QRectF(self.rect()), 12, 12)

    def _count_click(self) -> None:
        self.clicks += 1

    def _show_time(self, now: QTime) -> None:
        self._time = now
        self._redraw()

    def _redraw(self) -> None:
        self._label.setText(
            "Guild Board overlay test\n"
            f"The clock moves each second: {self._time.toString('HH:mm:ss')}\n"
            f"Ctrl+Alt+G arrived {times(self._presses[TOGGLE])}. It hides or shows this panel.\n"
            "Ctrl+Alt+I: take clicks, or let them through again.\n"
            "Ctrl+Alt+K: a see-through layer over the whole display.\n"
            "Ctrl+Alt+T: a test notification.\n"
            "Ctrl+Alt+Q ends the test."
        )
        self.adjustSize()


class ProbeLayer(QWidget):
    """A see-through layer for the whole display, as the open overlay will be, with a clock that moves each second.
    It takes no clicks and no focus."""

    def __init__(self) -> None:
        super().__init__(
            None,
            Qt.WindowType.Tool  # no taskbar button
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.WindowTransparentForInput  # clicks go through
            | Qt.WindowType.WindowDoesNotAcceptFocus,
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)  # the game keeps the focus
        self._text = ""
        self._clock = ClockTimer(self, self._show_time)
        self._clock.tick()  # shows the time now and aims the next tick

    def text(self) -> str:
        return self._text

    def paintEvent(self, event: QPaintEvent) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor(59, 66, 85, 24))
        font = painter.font()
        font.setPixelSize(64)
        painter.setFont(font)
        painter.setPen(QColor("#F4EAD3"))
        corner = Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignBottom
        painter.drawText(self.rect().adjusted(EDGE, EDGE, -EDGE, -EDGE), corner, self._text)

    def _show_time(self, now: QTime) -> None:
        self._text = f"Guild Board see-through layer · {now.toString('HH:mm:ss')}"
        self.update()  # the whole layer each second, the heavier case for the stutter question


def main() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    user32 = ctypes.windll.user32
    taken = [
        ident
        for ident in KEYS
        if not user32.RegisterHotKey(None, ident, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, KEYS[ident])
    ]
    try:
        if taken:
            names = " and ".join(NAMES[ident] for ident in taken)
            print(f"Another program uses {names}; close it and start the test again.")
            return 1
        layer = ProbeLayer()
        layer.setGeometry(QGuiApplication.primaryScreen().geometry())  # all of the game's display
        tray = QSystemTrayIcon(app_icon())
        tray.show()
        panel = ProbePanel(
            layer=layer,
            notify=lambda: tray.showMessage("Guild Board overlay test", "This is a test notification."),
        )
        hotkeys = HotkeyFilter(panel.hotkey)
        app.installNativeEventFilter(hotkeys)
        panel.finished.connect(app.quit)
        screen = QGuiApplication.primaryScreen().availableGeometry()  # the game's display
        panel.adjustSize()
        panel.move(screen.right() - EDGE - panel.width(), screen.top() + EDGE)
        panel.show()
        print("The test panel is at the top right of the main display. Ctrl+Alt+Q ends the test.")
        app.exec()
        app.removeNativeEventFilter(hotkeys)
        tray.hide()
        print(panel.summary())
        return 0
    finally:
        for ident in KEYS:
            user32.UnregisterHotKey(None, ident)


if __name__ == "__main__":
    sys.exit(main())
