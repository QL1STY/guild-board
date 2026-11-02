import os
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import QFileInfo

from guildboard.shell.startup import SHORTCUT_NAME, Shortcut

# The player's own profile, Roaming and Local folders, read when the tests are collected: conftest.py moves APPDATA,
# LOCALAPPDATA and USERPROFILE into each test's own folder. Only paths are worked out from them, and nothing in them is
# read or written.
PLAYERS_PROFILE = Path(os.environ["USERPROFILE"])
PLAYERS_APPDATA = Path(os.environ["APPDATA"])
PLAYERS_LOCALAPPDATA = Path(os.environ["LOCALAPPDATA"])

_WINDOWS_NAMES = """
from guildboard.shell.startup import shortcut_data_dir, startup_folder

print(startup_folder())
print(shortcut_data_dir())
"""


def _windows_names() -> tuple[Path, Path]:
    """What startup_folder() and shortcut_data_dir() answer for the player's own profile folder, with this test's APPDATA
    and LOCALAPPDATA. Asked in a process of its own: Windows works its known folders out from the profile folder, which
    conftest.py moves, and a process keeps the first answer it was given, so what a test's own process answers depends
    on which test asked first."""
    done = subprocess.run(
        [sys.executable, "-c", _WINDOWS_NAMES], env=dict(os.environ, USERPROFILE=str(PLAYERS_PROFILE)),
        capture_output=True, text=True, timeout=60,
    )
    assert done.returncode == 0, done.stderr
    startup, data_dir = done.stdout.splitlines()
    return Path(startup), Path(data_dir)


def _target(tmp_path: Path) -> Path:
    target = tmp_path / "Scripts" / "guildboard-tray.exe"
    target.parent.mkdir()
    target.write_bytes(b"MZ")
    return target


def test_start_with_windows_adds_and_removes_one_shortcut(tmp_path):
    target = _target(tmp_path)
    folder = tmp_path / "Startup"
    shortcut = Shortcut(folder, target)
    assert not shortcut.exists()
    assert shortcut.apply(True)
    assert shortcut.apply(True)  # once more: still one shortcut
    assert [path.name for path in folder.iterdir()] == [SHORTCUT_NAME]
    assert Path(QFileInfo(str(folder / SHORTCUT_NAME)).symLinkTarget()) == target
    assert shortcut.apply(False)
    assert list(folder.iterdir()) == []
    assert shortcut.apply(False)  # nothing to remove is fine


def test_without_its_program_no_shortcut_is_made(tmp_path):
    shortcut = Shortcut(tmp_path / "Startup", tmp_path / "missing" / "guildboard-tray.exe")
    assert not shortcut.apply(True)
    assert not shortcut.exists()


def test_the_shortcut_goes_in_the_players_own_startup_folder():
    expected = PLAYERS_APPDATA / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    # The function itself, in a process of its own: conftest.py replaces the module's startup_folder, not the function.
    # It does not follow the variable that conftest.py moved, which that process has, but the player's profile folder.
    assert Path(os.environ["APPDATA"]) != PLAYERS_APPDATA
    assert _windows_names()[0] == expected


def test_the_shortcut_starts_the_players_own_folder_as_windows_names_it():
    # Like the Startup folder, it does not follow the variable that conftest.py moved.
    assert Path(os.environ["LOCALAPPDATA"]) != PLAYERS_LOCALAPPDATA
    assert _windows_names()[1] == PLAYERS_LOCALAPPDATA / "GuildBoard"
