"""tools/third-party-notices.py writes THIRD-PARTY-NOTICES.txt. The committed file names every runtime package that uv.lock
locks, so that a new dependency cannot be forgotten, and it is the file the generator writes today (build-installer.ps1
runs the generator with --check before it packs anything)."""
from __future__ import annotations

import importlib.util
import re
import sys
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "third-party-notices.py"
NOTICES = ROOT / "THIRD-PARTY-NOTICES.txt"


def tool():
    spec = importlib.util.spec_from_file_location("third_party_notices", TOOL)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # a dataclass looks its module up here
    spec.loader.exec_module(module)
    return module


def _same(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _locked_runtime_names() -> set[str]:
    """Written out again here, not taken from the tool: guildboard's own dependencies and theirs, but not the
    dev or package groups."""
    locked = {_same(each["name"]): each for each in tomllib.loads((ROOT / "uv.lock").read_text("utf-8"))["package"]}
    found: set[str] = set()
    todo = [_same(each["name"]) for each in locked["guildboard"]["dependencies"]]
    while todo:
        name = todo.pop()
        if name in found:
            continue
        found.add(name)
        todo += [_same(each["name"]) for each in locked[name].get("dependencies", [])]
    return found


def _names_in_the_file() -> set[str]:
    return {_same(name) for name in re.findall(r"^== (\S+) \S+ ==$", NOTICES.read_text("utf-8"), re.MULTILINE)}


def test_every_locked_runtime_package_is_named_in_the_notices():
    missing = _locked_runtime_names() - _names_in_the_file()
    assert not missing, f"not in THIRD-PARTY-NOTICES.txt: {sorted(missing)}. Run: uv run python tools/third-party-notices.py"


def test_the_tools_runtime_packages_are_the_locked_ones():
    assert {_same(name) for name in tool().locked_runtime_packages()} == _locked_runtime_names()
    assert "pytest" not in _locked_runtime_names()  # the dev group is not shipped
    assert "pyinstaller" not in _locked_runtime_names()  # nor is the package group


@pytest.mark.skipif(not (ROOT / "web" / "node_modules").is_dir(), reason="needs npm ci in web/")
def test_the_committed_file_is_what_the_tool_writes_today():
    assert NOTICES.read_text("utf-8") == tool().render(), "Run: uv run python tools/third-party-notices.py"


@pytest.mark.skipif(not (ROOT / "web" / "node_modules").is_dir(), reason="needs npm ci in web/")
def test_check_says_whether_the_file_is_out_of_date(tmp_path, capsys):
    module = tool()
    assert module.main(["--check"]) == 0
    stale = tmp_path / "THIRD-PARTY-NOTICES.txt"
    stale.write_text("old", encoding="utf-8")
    assert module.main(["--check", "--file", str(stale)]) == 1
    assert "out of date" in capsys.readouterr().out
    assert module.main(["--file", str(stale)]) == 0
    assert stale.read_text("utf-8") == module.render()


@pytest.mark.skipif(not (ROOT / "web" / "node_modules").is_dir(), reason="needs npm ci in web/")
def test_the_interface_packages_are_the_ones_the_built_interface_uses():
    names = {entry.name for entry in tool().node_entries()}
    assert {"react", "react-dom", "scheduler", "@fontsource/alegreya-sans"} <= names
    assert not names & {"vite", "vitest", "typescript", "@playwright/test"}


@pytest.mark.skipif(not (ROOT / "web" / "node_modules").is_dir(), reason="needs npm ci in web/")
def test_what_the_tools_miss_is_written_by_hand():
    text = tool().render() if (ROOT / "web" / "node_modules").is_dir() else tool().manual_sections()
    assert "GNU LESSER GENERAL PUBLIC LICENSE" in text and "Version 3, 29 June 2007" in text
    assert "https://code.qt.io/cgit/pyside/pyside-setup.git/" in text  # where the shipped version's source is
    assert "bootloader" in text and "exception" in text
    assert "SIL OPEN FONT LICENSE Version 1.1" in text
    assert "Made Baruna" in text  # Paimon.moe's data
    assert "LicenseRef-Qt-Commercial" not in text  # the wheel's note for those who bought Qt does not apply here


def test_the_notices_name_no_real_person_and_no_private_notes():
    text = NOTICES.read_text("utf-8")
    assert ("super" + "powers") not in text
    assert "@gmail" not in text


def test_the_build_stops_when_the_notices_are_out_of_date():
    build = (ROOT / "build-installer.ps1").read_text("utf-8")
    [line] = [line for line in build.splitlines() if "third-party-notices.py" in line and "--check" in line]
    assert "uv run --locked --no-dev --group package python" in line
    # Checked after the interface's packages are installed, before anything is packed.
    assert build.index("npm ci --prefix web") < build.index("third-party-notices.py") < build.index("Pack Guild Board")
