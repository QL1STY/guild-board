import subprocess
from pathlib import Path

SETUP = Path(__file__).resolve().parents[1] / "setup.ps1"


def test_the_setup_script_quits_installs_builds_and_makes_the_shortcut_in_that_order():
    done = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SETUP), "-DryRun"],
        capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    steps = [line[2:] for line in done.stdout.splitlines() if line.startswith("- ")]
    assert steps == [
        "Quit Guild Board, if it is running",  # its files are about to be replaced
        "Quit the demo, if it is running",
        "Install the Python packages",
        "Install the packages of the interface",
        "Build the interface",
        "Make the desktop shortcut",
    ]
    assert done.stdout.strip().endswith("Guild Board is ready. Start it from the shortcut on the desktop.")


def test_the_setup_script_is_plain_ascii_and_leaves_the_registry_and_the_game_alone():
    raw = SETUP.read_bytes()
    raw.decode("ascii")  # Windows PowerShell 5.1 reads a file without a byte order mark in the local code page
    text = raw.decode("ascii").lower()
    for forbidden in ("hklm", "hkcu", "registry::", "set-itemproperty", "reg add", "reg delete", "genshin"):
        assert forbidden not in text, forbidden
