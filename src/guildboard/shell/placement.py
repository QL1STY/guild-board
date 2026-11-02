"""Where the dashboard window opens: on the second display the first time, then where it was left."""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
from pathlib import Path
from typing import Sequence

from PySide6.QtCore import QByteArray, QRect
from PySide6.QtWidgets import QWidget

log = logging.getLogger(__name__)

# A window can be dragged back only when this much of it lies on one display.
GRAB_WIDTH = 100
GRAB_HEIGHT = 50


def first_run_screen(geometries: Sequence[QRect], primary: int) -> int:
    """The first display that is not the primary, or the primary when it is alone."""
    for index in range(len(geometries)):
        if index != primary:
            return index
    return primary


def on_some_screen(frame: QRect, geometries: Sequence[QRect]) -> bool:
    for geometry in geometries:
        overlap = frame.intersected(geometry)
        if overlap.width() >= GRAB_WIDTH and overlap.height() >= GRAB_HEIGHT:
            return True
    return False


class WindowPlacement:
    """The window's place as Qt describes it, kept in a small file of the data folder. Python writes the file itself:
    Qt's settings files take a lock on every write, and a lock left behind makes Qt look up the process its id names,
    which may be the game by then (H2)."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def save(self, window: QWidget) -> None:
        text = json.dumps({"geometry": base64.b64encode(bytes(window.saveGeometry())).decode("ascii")})
        part = self._path.with_name(self._path.name + ".part")
        try:
            part.write_text(text, encoding="utf-8")
            os.replace(part, self._path)  # a save cut short leaves the last place as it was
        except OSError:
            log.warning("The window's place could not be kept in %s", self._path, exc_info=True)

    def restore(self, window: QWidget, geometries: Sequence[QRect]) -> bool:
        """False when nothing was saved, the file cannot be read, or the saved place is off every display."""
        try:
            saved = base64.b64decode(json.loads(self._path.read_text(encoding="utf-8"))["geometry"], validate=True)
        except (OSError, ValueError, KeyError, TypeError, binascii.Error):
            return False
        if not window.restoreGeometry(QByteArray(saved)):
            return False
        return on_some_screen(window.geometry(), geometries)
