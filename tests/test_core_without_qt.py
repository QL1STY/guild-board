"""The core draws its pictures with Pillow and imports no Qt (the Electron shell plan, Task 3)."""
from __future__ import annotations

import subprocess
import sys


def test_the_core_imports_no_qt():
    code = ("import sys, guildboard.core, guildboard.api.app, guildboard.gallery, guildboard.characters.art;"
            "print(sorted(m for m in sys.modules if m.startswith('PySide6')))")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=120).stdout
    assert out.strip() == "[]"


def test_a_start_does_not_import_pillow_before_a_picture_is_made():
    code = ("import sys, guildboard.core, guildboard.api.app, guildboard.gallery, guildboard.characters.art;"
            "print(sorted(m for m in sys.modules if m == 'PIL' or m.startswith('PIL.')))")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=120).stdout
    assert out.strip() == "[]"


def test_making_pictures_loads_no_qt_either():
    code = (
        "import io, sys\n"
        "from PIL import Image\n"
        "from guildboard import gallery\n"
        "from guildboard.characters import art\n"
        "raw = io.BytesIO(); Image.new('RGB', (2000, 1000), '#336699').save(raw, 'PNG'); png = raw.getvalue()\n"
        "gallery._jpeg(png); art._shrunk(png, 512); gallery._demo_picture(1, 320, 180, 'JPG')\n"
        "print(sorted(m for m in sys.modules if m.startswith('PySide6')))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=120).stdout
    assert out.strip() == "[]"
