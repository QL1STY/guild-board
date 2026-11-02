"""Start with Windows is one shortcut in the player's own Startup folder, and the desktop shortcut is one
more on the desktop. Nothing else is touched: no registry and no scheduled task."""
from __future__ import annotations

import logging
import sys
from pathlib import Path

from PySide6.QtCore import QFile, QStandardPaths

from guildboard.config import APP_DIR_NAME

log = logging.getLogger(__name__)

SHORTCUT_NAME = "Guild Board.lnk"


def startup_folder() -> Path:
    programs = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.ApplicationsLocation)
    return Path(programs) / "Startup"


def shortcut_data_dir() -> Path:
    """The folder the Startup shortcut starts Guild Board on, %LOCALAPPDATA%\\GuildBoard, as Windows names it. It comes
    from where the Startup folder comes from, so it does not move when the LOCALAPPDATA variable does."""
    local = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.GenericDataLocation)
    return Path(local) / APP_DIR_NAME


def desktop_folder() -> Path:
    return Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.DesktopLocation))


def launcher(name: str) -> Path:
    """The launcher of that name next to this Python, as installed with Guild Board."""
    return Path(sys.executable).with_name(name)


class Shortcut:
    def __init__(self, folder: Path, target: Path) -> None:
        self._path = folder / SHORTCUT_NAME
        self._target = target

    def exists(self) -> bool:
        return self._path.exists()

    def apply(self, on: bool) -> bool:
        # A shortcut made by Qt carries no arguments, so it points at a launcher of its own.
        try:
            # Made again each time, so that it points at this copy of Guild Board.
            if self._path.exists():
                self._path.unlink()
            if not on:
                return True
            if not self._target.exists():
                log.warning("start with Windows needs %s, which is missing", self._target)
                return False
            self._path.parent.mkdir(parents=True, exist_ok=True)
            if not QFile.link(str(self._target), str(self._path)):
                log.warning("the shortcut %s could not be made", self._path)
                return False
            return True
        except OSError:
            log.exception("the shortcut %s could not be changed", self._path)
            return False


def make_desktop_shortcut() -> bool:
    return Shortcut(desktop_folder(), launcher("guildboard-app.exe")).apply(True)


def main(argv: list[str]) -> int:
    if argv != ["desktop"]:
        print("Usage: python -m guildboard.shell.startup desktop")
        return 2
    if make_desktop_shortcut():
        print("The desktop shortcut starts Guild Board.")
        return 0
    print("The desktop shortcut could not be made. Is Guild Board installed with setup.ps1?")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
