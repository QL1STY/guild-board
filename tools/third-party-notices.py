"""Writes THIRD-PARTY-NOTICES.txt: the name, version, licence and licence text of everything Guild Board ships that is not its own.

Run it from the repository, with the Python packages synced (uv sync) and the interface's packages installed (npm ci in web/):

    uv run python tools/third-party-notices.py            writes THIRD-PARTY-NOTICES.txt
    uv run python tools/third-party-notices.py --check    says whether the file in the repository is what this writes today

The Python packages are those uv.lock locks for Guild Board itself (its dependencies and theirs, not the dev or package
groups), read from the installed copies with importlib.metadata. The interface's are the packages of web/package-lock.json that
are not dev dependencies, read from web/node_modules. What those cannot say (Electron and Chromium, PyInstaller's bootloader, Paimon.moe's
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
SHELL = ROOT / "shell"
PAIMON = ROOT / "src" / "guildboard" / "reference" / "LICENSE-paimon-moe.txt"

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
    return [python_entry(name) for name in locked_runtime_packages()]


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


def electron_version() -> str:
    """The Electron that shell/package.json pins, which the installed copy carries."""
    return json.loads((SHELL / "package.json").read_text("utf-8"))["devDependencies"]["electron"]


# The Chromium that each Electron is built on (process.versions.chrome of that Electron), written out so that the file depends
# on nothing installed. A new Electron needs its line, and the build stops here until it has one.
CHROMIUM_OF = {"45.2.3": "156.0.8078.80"}


def chromium_version() -> str:
    electron = electron_version()
    if electron not in CHROMIUM_OF:
        raise SystemExit(f"Electron {electron} is not in CHROMIUM_OF of tools/third-party-notices.py. Add the Chromium it is built on.")
    return CHROMIUM_OF[electron]


def manual_sections() -> str:
    """What the package metadata cannot say. Each part opens as the generated ones do: `== name version ==`."""
    parts = [
        f"""== Electron (with Chromium and Node.js) {electron_version()} ==
Licence: MIT, with the licences of the code that Chromium and Node.js contain

Guild Board's window is Electron, used unchanged. Electron is under the MIT licence: Copyright (c) Electron contributors,
Copyright (c) 2013-2020 GitHub Inc. It is built on Chromium and Node.js, which contain third-party code under many licences.
Electron carries those licences with it: the files "LICENSE" and "LICENSES.chromium.html" lie in the installed copy's own
folder, beside guildboard-app.exe, and are kept there. The source of the version shipped:
  https://github.com/electron/electron (the tag v{electron_version()})
Chromium itself is under the BSD 3-clause licence: Copyright 2015 The Chromium Authors. Its text is in the Chromium source at
https://chromium.googlesource.com/chromium/src/+/main/LICENSE""",
        f"""== ffmpeg (inside Electron) {chromium_version()} ==
Licence: LGPL-2.1-or-later

Electron carries the media library ffmpeg as the file ffmpeg.dll, beside guildboard-app.exe in the installed copy's own folder.
It is Electron's build of Chromium's copy of FFmpeg, with Electron's patches, free software under the GNU Lesser General Public
License, version 2.1 or later. Guild Board uses it unchanged, as a separate file, so that you can replace it with another build
of the same library.

The exact source of the version shipped is Chromium's copy of FFmpeg, at the Chromium that Electron {electron_version()} is built on, {chromium_version()},
with the patches that Electron applies to it:
  https://chromium.googlesource.com/chromium/third_party/ffmpeg (the commit that Chromium's file DEPS names, below)
  https://chromium.googlesource.com/chromium/src/+/refs/tags/{chromium_version()}/DEPS (the DEPS of Chromium {chromium_version()})
  https://github.com/electron/electron/tree/v{electron_version()}/patches/ffmpeg (the patches Electron applies to it, in the order of the file .patches)
  https://ffmpeg.org/ for FFmpeg itself
If you cannot get the source from there, ask in an issue at https://github.com/QL1STY/guild-board/issues and the source of the
version you have will be given to you, for as long as that version is offered, and for at least three years from the release
that shipped that copy.

The licence's text is in the FFmpeg source (COPYING.LGPLv2.1) and in the file LICENSES.chromium.html beside guildboard-app.exe.""",
        """== PyInstaller (bootloader) ==
Licence: GPL-2.0-or-later, with an exception for programs it bundles

The installed copy packs its core with PyInstaller, which puts its bootloader into guildboard-core.exe. The
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

Part 1: Electron, Chromium, PyInstaller, Paimon.moe's data and the typeface
Part 2: Python packages
Part 3: the interface's packages
"""
    part2 = ("\n\n" + RULE + "\n").join(_block(entry) for entry in python_entries())
    part3 = ("\n\n" + RULE + "\n").join(_block(entry) for entry in node_entries())
    sections = [
        intro.rstrip("\n"),
        "PART 1: ELECTRON, CHROMIUM, PYINSTALLER, PAIMON.MOE AND THE TYPEFACE\n\n" + manual_sections(),
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
