import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SETUP = ROOT / "setup.ps1"


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
        "Install the packages of the shell",
        "Fetch the Electron program, if npm left it out",
        "Make a copy of the Electron program named for Guild Board",
        "Build the shell",
        "Make the desktop shortcut",
    ]
    assert done.stdout.strip().endswith("Guild Board is ready. Start it from the shortcut on the desktop.")


def _listed_step(out: str, name: str) -> str:
    """What a dry run prints for one step: its code, up to the next step."""
    return out.split(f"- {name}\n", 1)[1].split("\n- ", 1)[0]


def test_the_desktop_shortcut_starts_the_copy_of_electron_named_for_guild_board_on_the_shell_folder():
    # Electron's own program says "Electron" in Task Manager, on the taskbar and on the balloons; the copy in shell\app-dev
    # says "Guild Board". It keeps the name electron.exe, so the shell stays in development mode and starts the core from .venv.
    text = SETUP.read_text(encoding="ascii")
    assert "$branded = Join-Path $PSScriptRoot 'shell\\app-dev\\electron.exe'" in text
    out = _dry_run_in(ROOT)
    made = _listed_step(out, "Make a copy of the Electron program named for Guild Board")
    assert "node (Join-Path $PSScriptRoot 'shell\\scripts\\make-app-dev.mjs')" in made
    assert (ROOT / "shell" / "scripts" / "make-app-dev.mjs").is_file()
    shortcut = _listed_step(out, "Make the desktop shortcut")
    for line in (
        "$link.TargetPath = $branded",
        "$link.Arguments = 'shell'",
        "$link.WorkingDirectory = $PSScriptRoot",
        "$link.IconLocation = (Join-Path $PSScriptRoot 'shell\\assets\\icon.ico') + ',0'",
    ):
        assert line in shortcut, line
    assert "$electron" not in shortcut


def _shell_program_found_in(checkout: Path, scratch: Path) -> str:
    # setup.ps1 runs its steps when it is started, so its Find-ShellProgram is read out of it with PowerShell's own parser
    # and run alone.
    runner = scratch / "find.ps1"
    runner.write_text(
        "param([string]$Setup, [string]$Checkout)\n"
        "$ErrorActionPreference = 'Stop'\n"
        "$ast = [System.Management.Automation.Language.Parser]::ParseFile($Setup, [ref]$null, [ref]$null)\n"
        "$found = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] "
        "-and $node.Name -eq 'Find-ShellProgram' }, $true)\n"
        "if ($null -eq $found) { throw 'setup.ps1 has no function Find-ShellProgram.' }\n"
        ". ([scriptblock]::Create($found.Extent.Text))\n"
        "Find-ShellProgram $Checkout\n",
        encoding="ascii",
    )
    done = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(runner), str(SETUP), str(checkout)],
        capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout.strip()


def test_the_quit_steps_ask_with_the_copy_named_for_guild_board_when_there_is_one_and_else_with_electrons_own(tmp_path):
    # A Guild Board started from the desktop shortcut runs from the copy, so the copy asks it to quit; with no copy yet,
    # Electron's own program asks, as before; on a fresh checkout nothing can run, and nothing asks.
    checkout = tmp_path / "checkout"
    electron = checkout / "shell" / "node_modules" / "electron" / "dist" / "electron.exe"
    branded = checkout / "shell" / "app-dev" / "electron.exe"
    assert _shell_program_found_in(checkout, tmp_path) == ""
    electron.parent.mkdir(parents=True)
    electron.write_bytes(b"")
    assert _shell_program_found_in(checkout, tmp_path) == str(electron)
    branded.parent.mkdir(parents=True)
    branded.write_bytes(b"")
    assert _shell_program_found_in(checkout, tmp_path) == str(branded)
    electron.unlink()
    assert _shell_program_found_in(checkout, tmp_path) == str(branded)
    # Both quit steps run the program it found, with the same arguments as before.
    text = SETUP.read_text(encoding="ascii")
    assert "$quitter = Find-ShellProgram $PSScriptRoot" in text
    assert "Start-Process -FilePath $quitter " in text
    out = _dry_run_in(ROOT)
    assert _listed_step(out, "Quit Guild Board, if it is running").strip() == "if ($quitter) { Invoke-Shell @('shell', '--quit') }"
    assert _listed_step(out, "Quit the demo, if it is running").strip() == "if ($quitter) { Invoke-Shell @('shell', '--demo', '--quit') }"


def test_a_checkout_with_a_venv_and_only_the_copy_named_for_guild_board_runs_no_qt_copy(tmp_path):
    # The note for a Qt Guild Board is for a checkout with no Electron program at all: the copy is one.
    shutil.copy(SETUP, tmp_path / "setup.ps1")
    (tmp_path / ".venv").mkdir()
    (tmp_path / "shell" / "app-dev").mkdir(parents=True)
    (tmp_path / "shell" / "app-dev" / "electron.exe").write_bytes(b"")
    assert "quit it from its tray" not in _dry_run_in(tmp_path)


@pytest.mark.skipif(
    shutil.which("node") is None or not (ROOT / "shell" / "node_modules" / "resedit").is_dir(),
    reason="needs Node and npm ci in shell/",
)
def test_the_script_makes_the_copy_in_the_folder_that_setup_ps1_starts_and_git_leaves_out():
    # Given a made-up Electron folder inside shell\app-dev and no target, the script refuses before it reads or writes
    # anything, and the refusal names the folder it makes the copy in by default.
    nowhere = ROOT / "shell" / "app-dev" / "no-electron-here"
    done = subprocess.run(
        ["node", str(ROOT / "shell" / "scripts" / "make-app-dev.mjs"), "--dist", str(nowhere)],
        capture_output=True, text=True, timeout=60,
    )
    assert done.returncode == 1, done.stdout + done.stderr
    assert "\\shell\\app-dev must lie outside Electron's folder" in done.stderr
    assert not nowhere.exists()
    # The desktop shortcut and the quit steps start the program there, and git leaves the folder out.
    text = SETUP.read_text(encoding="ascii")
    assert "$branded = Join-Path $PSScriptRoot 'shell\\app-dev\\electron.exe'" in text
    assert "foreach ($program in 'shell\\app-dev\\electron.exe', " in text
    assert "/shell/app-dev/" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()


def test_the_copy_of_electron_named_for_guild_board_stays_out_of_git():
    paths = ["shell/app-dev/electron.exe", "shell/app-dev/resources/default_app.asar"]
    done = subprocess.run(["git", "check-ignore", *paths], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.split() == paths  # each one is ignored


def test_the_setup_script_is_plain_ascii_and_leaves_the_registry_and_the_game_alone():
    raw = SETUP.read_bytes()
    raw.decode("ascii")  # Windows PowerShell 5.1 reads a file without a byte order mark in the local code page
    text = raw.decode("ascii").lower()
    for forbidden in ("hklm", "hkcu", "registry::", "set-itemproperty", "reg add", "reg delete", "genshin"):
        assert forbidden not in text, forbidden


def _dry_run_in(folder: Path) -> str:
    done = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(folder / "setup.ps1"), "-DryRun"],
        capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout


def test_a_fresh_checkout_with_no_electron_program_still_lists_both_quit_steps(tmp_path):
    # Electron's npm package fetches its program on first use, so right after npm ci it is missing; the steps stay, and test inside.
    shutil.copy(SETUP, tmp_path / "setup.ps1")
    assert not (tmp_path / "shell").exists()
    out = _dry_run_in(tmp_path)
    steps = [line[2:] for line in out.splitlines() if line.startswith("- ")]
    assert steps[:2] == ["Quit Guild Board, if it is running", "Quit the demo, if it is running"]
    assert "quit it from its tray" not in out  # no .venv here, so no Qt copy can be running from it


def test_a_checkout_with_a_venv_but_no_electron_program_says_to_quit_a_running_copy_from_its_tray(tmp_path):
    shutil.copy(SETUP, tmp_path / "setup.ps1")
    (tmp_path / ".venv").mkdir()
    out = _dry_run_in(tmp_path)
    assert "If Guild Board is running from this folder, quit it from its tray icon first." in out
    assert out.index("quit it from its tray") < out.index("- Install the Python packages")


def test_the_switch_from_qt_waits_for_the_player_before_the_sync_and_never_in_a_dry_run(tmp_path):
    # `uv sync` removes PySide6 from under a Qt Guild Board that may still run from this .venv: the player's rule is never
    # to sync .venv while the app runs. A real run waits at the note; a dry run lists the steps and asks nothing.
    text = SETUP.read_text(encoding="ascii")
    note = text.index("quit it from its tray icon first.")
    wait = text.index("Read-Host", note)
    assert "if (-not $DryRun)" in text[note:wait]
    assert wait < text.index("Step 'Install the Python packages'")
    assert text.count("Read-Host") == 1
    shutil.copy(SETUP, tmp_path / "setup.ps1")
    (tmp_path / ".venv").mkdir()
    assert "Press Enter" not in _dry_run_in(tmp_path)  # and it returned, so it did not wait on the console
