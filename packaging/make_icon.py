"""Draws Guild Board's icon, src/guildboard/shell/icon.svg, into a Windows icon with every size Windows asks for.

Run by build-installer.ps1: python packaging/make_icon.py <out.ico>"""
from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image
from PySide6.QtCore import QBuffer, QIODevice, Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

SVG = Path(__file__).resolve().parents[1] / "src" / "guildboard" / "shell" / "icon.svg"
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)


def render(size: int) -> Image.Image:
    image = QImage(size, size, QImage.Format.Format_ARGB32)
    image.fill(Qt.GlobalColor.transparent)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    QSvgRenderer(str(SVG)).render(painter)
    painter.end()
    buffer = QBuffer()
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buffer, "PNG")
    return Image.open(io.BytesIO(bytes(buffer.data()))).convert("RGBA")


def main(out: Path) -> None:
    app = QGuiApplication([])  # QImage and QPainter need one
    images = [render(size) for size in SIZES]
    out.parent.mkdir(parents=True, exist_ok=True)
    # Each size drawn from the SVG itself, so the small ones stay sharp.
    images[-1].save(out, format="ICO", sizes=[(s, s) for s in SIZES], append_images=images[:-1])
    del app


if __name__ == "__main__":
    main(Path(sys.argv[1]))
