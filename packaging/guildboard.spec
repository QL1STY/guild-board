# PyInstaller recipe for the installed copy of Guild Board. Run by build-installer.ps1, which first builds the
# interface and draws the icon into build/package/guildboard.ico.
#
# One folder, two programs that share it, named as the shortcuts in startup.py expect them:
#   guildboard-app.exe   opens the window (the Start menu and desktop shortcuts)
#   guildboard-tray.exe  starts in the tray (the Start with Windows shortcut, which carries no arguments)
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).parent
ICON = str(ROOT / "build" / "package" / "guildboard.ico")
SRC = ROOT / "src" / "guildboard"

datas = [
    (str(ROOT / "web" / "dist"), "web/dist"),
    (str(SRC / "reference"), "guildboard/reference"),
    (str(SRC / "characters" / "demo"), "guildboard/characters/demo"),
    (str(SRC / "shell" / "icon.svg"), "guildboard/shell"),
    # Settings, About shows the notices from here (notices.py); the licence and the privacy notice go with them.
    (str(ROOT / "LICENSE"), "."),
    (str(ROOT / "THIRD-PARTY-NOTICES.txt"), "."),
    (str(ROOT / "PRIVACY.md"), "."),
]
binaries = []
hiddenimports = []
for package in ("genshin", "guildboard"):
    found = collect_all(package)
    datas += found[0]
    binaries += found[1]
    hiddenimports += found[2]


def analysis(script):
    return Analysis(
        [str(Path(SPECPATH) / script)],
        pathex=[str(ROOT / "src")],
        datas=datas,
        binaries=binaries,
        hiddenimports=hiddenimports,
        excludes=["tkinter", "pytest"],
    )


app = analysis("app_entry.py")
tray = analysis("tray_entry.py")


def program(found, name):
    return EXE(
        PYZ(found.pure),
        found.scripts,
        [],
        exclude_binaries=True,
        name=name,
        icon=ICON,
        version=str(ROOT / "build" / "package" / "version.txt"),
        console=False,
        upx=False,
    )


COLLECT(
    program(app, "guildboard-app"),
    program(tray, "guildboard-tray"),
    app.binaries + tray.binaries,
    app.datas + tray.datas,
    upx=False,
    name="Guild Board",
)
