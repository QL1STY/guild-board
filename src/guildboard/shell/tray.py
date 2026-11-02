"""The tray icon and its menu: Open, Sync now, Pause syncing, Show pinned widgets, Move the overlay to the main
display, Quit."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from PySide6.QtCore import QObject
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QMenu, QSystemTrayIcon

log = logging.getLogger(__name__)

ICON = Path(__file__).with_name("icon.svg")


def app_icon() -> QIcon:
    return QIcon(str(ICON))


def _logged(name: str, fn: Callable[[], None]) -> None:
    # A failure goes into the log and no further: raised in a Qt slot, it would not reach the log file.
    try:
        fn()
    except Exception:
        log.exception("the tray item %s failed", name)


class Tray(QObject):
    def __init__(
        self,
        icon: QIcon,
        *,
        open_window: Callable[[], None],
        sync_now: Callable[[], None],
        set_paused: Callable[[bool], None],
        set_pinned: Callable[[bool], None],
        to_main_display: Callable[[], None],
        quit: Callable[[], None],
    ) -> None:
        super().__init__()
        self._open_window = open_window
        self._set_paused = set_paused
        self._paused = False
        self._menu = QMenu()
        self._menu.addAction("Open").triggered.connect(lambda: _logged("Open", open_window))
        self._menu.addAction("Sync now").triggered.connect(lambda: _logged("Sync now", sync_now))
        self._pause = self._menu.addAction("Pause syncing")
        self._pause.triggered.connect(lambda: _logged("Pause syncing", lambda: set_paused(not self._paused)))
        self._menu.addSeparator()
        self._pinned = self._menu.addAction("Show pinned widgets")
        self._pinned.setCheckable(True)
        self._pinned.setChecked(True)  # as the setting is by default, until the settings arrive
        self._pinned.triggered.connect(lambda checked: _logged("Show pinned widgets", lambda: set_pinned(checked)))
        self._menu.addAction("Move the overlay to the main display").triggered.connect(
            lambda: _logged("Move the overlay to the main display", to_main_display)
        )
        self._menu.addSeparator()
        self._menu.addAction("Quit").triggered.connect(lambda: _logged("Quit", quit))
        self.icon = QSystemTrayIcon(icon, self)
        self.icon.setToolTip("Guild Board")
        self.icon.setContextMenu(self._menu)
        self.icon.activated.connect(self._on_activated)

    def menu(self) -> QMenu:
        return self._menu

    def show_paused(self, paused: bool) -> None:
        self._paused = paused
        self._pause.setText("Resume syncing" if paused else "Pause syncing")

    def show_pinned(self, pinned: bool) -> None:
        self._pinned.setChecked(pinned)

    def show(self) -> None:
        self.icon.show()

    def hide(self) -> None:
        self.icon.hide()

    def _on_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason in (QSystemTrayIcon.ActivationReason.Trigger, QSystemTrayIcon.ActivationReason.DoubleClick):
            _logged("Open", self._open_window)
