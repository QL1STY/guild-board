"""Writes THIRD-PARTY-NOTICES.txt: the name, version, licence and licence text of everything Guild Board ships that is not its own.

Run it from the repository, with the Python packages synced (uv sync) and the interface's packages installed (npm ci in web/):

    uv run python tools/third-party-notices.py            writes THIRD-PARTY-NOTICES.txt
    uv run python tools/third-party-notices.py --check    says whether the file in the repository is what this writes today

The Python packages are those uv.lock locks for Guild Board itself (its dependencies and theirs, not the dev or package
groups), read from the installed copies with importlib.metadata. The interface's are the packages of web/package-lock.json that
are not dev dependencies, read from web/node_modules. What those cannot say (Qt, Chromium, PyInstaller's bootloader, Paimon.moe's
data) is written below in `manual_sections`. The output depends on nothing else, so it is the same on any PC."""
from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "uv.lock"
WEB = ROOT / "web"
OUT = ROOT / "THIRD-PARTY-NOTICES.txt"
LICENCES = ROOT / "packaging" / "licenses"
PAIMON = ROOT / "src" / "guildboard" / "reference" / "LICENSE-paimon-moe.txt"

# Qt for Python's four wheels. Their own licence file says only what a buyer of a commercial Qt licence may do, which is
# not how Guild Board uses them; they are described in `manual_sections` instead.
QT_PACKAGES = ("pyside6", "pyside6-essentials", "pyside6-addons", "shiboken6")
LICENCE_FILE = re.compile(r"(?i)^(licen[cs]es?|copying|notice)([._-].*)?$")
RULE = "=" * 78


@dataclass(frozen=True)
class Entry:
    name: str
    version: str
    licence: str
    text: str


def _same(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _clean(text: str) -> str:
    """The text with Unix line ends and no space at the ends of lines or of the whole."""
    return "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip("\n")


def locked_runtime_packages(lock: Path = LOCK) -> list[str]:
    """The names uv.lock locks for Guild Board itself: its dependencies and theirs. A name appears whatever its marker says."""
    locked = {_same(each["name"]): each for each in tomllib.loads(lock.read_text("utf-8"))["package"]}
    found: dict[str, str] = {}
    todo = [each["name"] for each in locked["guildboard"]["dependencies"]]
    while todo:
        name = todo.pop()
        if _same(name) in found:
            continue
        found[_same(name)] = name
        todo += [each["name"] for each in locked[_same(name)].get("dependencies", [])]
    return sorted(found.values(), key=_same)


def python_entry(name: str) -> Entry:
    dist = metadata.distribution(name)
    fields = dist.metadata
    texts = []
    for file in sorted(dist.files or [], key=str):
        parts = file.parts
        if len(parts) > 1 and parts[0].endswith(".dist-info") and LICENCE_FILE.match(parts[-1]):
            text = Path(str(dist.locate_file(file))).read_text("utf-8", errors="replace")
            texts.append((file.as_posix().split(".dist-info/", 1)[1], _clean(text)))
    licence = fields.get("License-Expression")
    declared = (fields.get("License") or "").strip()
    if not licence and declared and "\n" not in declared:
        licence = declared
    if not licence:
        classifiers = [each.split(" :: ")[-1] for each in fields.get_all("Classifier") or [] if each.startswith("License ::")]
        licence = classifiers[-1] if classifiers else None
    if not licence and declared:  # the package puts its licence's text in the field itself
        licence = declared.split("\n", 1)[0].strip()
    if not texts and "\n" in declared:
        texts.append(("the package's own metadata", _clean(declared)))
    if not texts:
        texts.append(("", "This package ships no licence file."))
    body = "\n\n".join(text if len(texts) == 1 else f"--- {where} ---\n{text}" for where, text in texts)
    return Entry(fields["Name"], dist.version, licence or "see the text", body)


def python_entries() -> list[Entry]:
    names = [name for name in locked_runtime_packages() if _same(name) not in QT_PACKAGES]
    return [python_entry(name) for name in names]


def node_entries(web: Path = WEB) -> list[Entry]:
    """The packages the built interface uses: the lock's entries that are not dev dependencies."""
    lock = json.loads((web / "package-lock.json").read_text("utf-8"))
    found = []
    for path, each in lock["packages"].items():
        if not path or each.get("dev") or each.get("devOptional"):
            continue
        folder = web / path
        if not folder.is_dir():
            raise SystemExit(f"{folder} is missing. Run npm ci in web/ first.")
        files = sorted(file for file in folder.iterdir() if file.is_file() and LICENCE_FILE.match(file.name))
        text = "\n\n".join(_clean(file.read_text("utf-8", errors="replace")) for file in files)
        found.append(Entry(path.split("node_modules/", 1)[1], each["version"], each.get("license", "see the text"),
                           text or "This package ships no licence file."))
    return sorted(found, key=lambda entry: entry.name.lower())


def _installed(name: str) -> str:
    return metadata.version(name)


def manual_sections() -> str:
    """What the package metadata cannot say. Each part opens as the generated ones do: `== name version ==`."""
    qt = _installed("pyside6")
    tag = f"v{qt}"
    lgpl = _clean((LICENCES / "LGPL-3.0.txt").read_text("utf-8"))
    gpl = _clean((LICENCES / "GPL-3.0.txt").read_text("utf-8"))
    qt_heads = "\n".join(f"== {name} {_installed(name)} ==" for name in ("PySide6", "PySide6-Essentials", "PySide6-Addons", "shiboken6"))
    parts = [
        f"""{qt_heads}
Licence: LGPL-3.0-only (the packages are offered under LGPL-3.0, GPL-2.0 or GPL-3.0; Guild Board uses them under LGPL-3.0)

Qt for Python (PySide6 and shiboken6) and the Qt libraries inside them, version {qt}, are free software under the GNU Lesser
General Public License, version 3. Guild Board uses them unchanged. The installed copy keeps them as separate files, the
DLLs and Python modules in the program's own folder (the "_internal" folder beside guildboard-app.exe), so that you can
replace them with another build of the same libraries.

The exact source of the version shipped:
  PySide6 and shiboken6 {qt}:  https://code.qt.io/cgit/pyside/pyside-setup.git/ (the tag {tag})
  Qt, the libraries inside the wheels:  https://download.qt.io/official_releases/qt/ (the Qt release that the wheels' version
  matches), and https://code.qt.io/cgit/qt/ for the repositories
If you cannot get the source from there, ask in an issue at https://github.com/QL1STY/guild-board/issues and the source of the
version you have will be given to you, for as long as that version is offered.

Qt is a trademark of The Qt Company Ltd. The Qt wheels also carry a note for holders of a commercial Qt licence. It does not
apply to Guild Board.

The licence's text follows, and the text of the GNU General Public License, version 3, which it refers to.

{lgpl}

{RULE}
GNU General Public License, version 3 (referred to by the GNU Lesser General Public License above)
{RULE}

{gpl}""",
        f"""== Qt WebEngine (inside PySide6-Addons) {_installed("pyside6-addons")} ==
Licence: LGPL-3.0-only, with the licences of the third-party code that Chromium contains

Guild Board's window shows its interface with Qt WebEngine, which is built on Chromium. It is used unchanged and kept as
separate files, as described above for Qt. The wheel does not carry a file of Chromium's own notices, so they are not repeated
here. The notices for the Chromium code in Qt WebEngine, and for the third-party code in it, are in the Qt source and in
Qt's documentation:
  https://doc.qt.io/qt-6/qtwebengine-licensing.html
  https://code.qt.io/cgit/qt/qtwebengine-chromium.git/ (the files "LICENSE" and the "third_party" folders)
Chromium itself is under the BSD 3-clause licence: Copyright 2015 The Chromium Authors. The licence's text is in the Chromium
source at https://chromium.googlesource.com/chromium/src/+/main/LICENSE""",
        """== PyInstaller (bootloader) ==
Licence: GPL-2.0-or-later, with an exception for programs it bundles

The installed copy is packed with PyInstaller, which puts its bootloader into guildboard-app.exe and guildboard-tray.exe. The
bootloader is under the GNU General Public License, version 2 or later, with a special exception: it may be used to bundle and
distribute a program under any licence, and the bundled program is not changed by it. Guild Board is such a program, so the
GPL does not reach it. PyInstaller's licence is at https://github.com/pyinstaller/pyinstaller/blob/develop/COPYING.txt""",
        f"""== Paimon.moe achievement data ==
Licence: MIT

The list of achievements, with their names and descriptions, comes from Paimon.moe's public data
(https://github.com/MadeBaruna/paimon-moe). Guild Board keeps a copy and reads the newest list from there only when you ask.
Paimon.moe is not affiliated with Guild Board. Its licence:

{_clean(PAIMON.read_text("utf-8"))}""",
        """== Alegreya Sans ==
Licence: SIL Open Font License, Version 1.1

The interface's typeface is Alegreya Sans, by The Alegreya Sans Project Authors, which the interface carries as the package
@fontsource/alegreya-sans (listed below with the font's licence in full). The font is not sold by itself and is not
renamed or changed.""",
    ]
    return ("\n\n" + RULE + "\n").join(parts)


def _block(entry: Entry) -> str:
    return f"== {entry.name} {entry.version} ==\nLicence: {entry.licence}\n\n{entry.text}"


def render() -> str:
    intro = """THIRD-PARTY NOTICES

Guild Board is MIT licensed (see LICENSE). It contains and is built with the free software below. Each entry gives the name,
the version, the licence and the licence's text. This file is written by tools/third-party-notices.py: do not edit it by hand.

Guild Board is an unofficial, fan-made tool. It is not affiliated with or endorsed by HoYoverse or COGNOSPHERE. Genshin
Impact is a trademark of its owner.

Part 1: Qt, Chromium, PyInstaller, Paimon.moe's data and the typeface
Part 2: Python packages
Part 3: the interface's packages
"""
    part2 = ("\n\n" + RULE + "\n").join(_block(entry) for entry in python_entries())
    part3 = ("\n\n" + RULE + "\n").join(_block(entry) for entry in node_entries())
    sections = [
        intro.rstrip("\n"),
        "PART 1: QT, CHROMIUM, PYINSTALLER, PAIMON.MOE AND THE TYPEFACE\n\n" + manual_sections(),
        "PART 2: PYTHON PACKAGES\n\n" + part2,
        "PART 3: THE INTERFACE'S PACKAGES\n\n" + part3,
    ]
    return ("\n\n" + RULE + "\n" + RULE + "\n").join(sections) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write THIRD-PARTY-NOTICES.txt, or check that it is up to date.")
    parser.add_argument("--check", action="store_true", help="change nothing; fail if the file differs from what this writes")
    parser.add_argument("--file", type=Path, default=OUT, help="the file to write or check (default: THIRD-PARTY-NOTICES.txt)")
    arguments = parser.parse_args(argv)
    text = render()
    if arguments.check:
        current = arguments.file.read_text("utf-8") if arguments.file.is_file() else None
        if current != text:
            print(f"{arguments.file.name} is out of date. Run: uv run python tools/third-party-notices.py")
            return 1
        print(f"{arguments.file.name} is up to date.")
        return 0
    arguments.file.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {arguments.file}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
