"""Where THIRD-PARTY-NOTICES.txt is: the file Settings' About group shows as "Open-source licences"."""
from __future__ import annotations

import sys
from pathlib import Path

NAME = "THIRD-PARTY-NOTICES.txt"


def notices_file() -> Path:
    """The notices of the installed copy: the one PyInstaller packed with the program, or else the one the installer put
    beside guildboard-app.exe. Run from source, the one at the top of the repository."""
    if getattr(sys, "frozen", False):
        packed = Path(sys._MEIPASS) / NAME
        return packed if packed.is_file() else Path(sys.executable).resolve().parent / NAME
    return Path(__file__).resolve().parents[2] / NAME
