"""Asks the Windows process list whether the game runs (tasklist.exe, by its full path). Nothing else is touched.

It fails closed: a look that does not give a clear "no" counts as "the game may run".
"""
from __future__ import annotations

import os
import subprocess

TASKLIST = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "tasklist.exe")
GAME_IMAGES = ("GenshinImpact.exe", "YuanShen.exe")


def verdict(image: str, returncode: int, out: str) -> str | None:
    """The name to report for one look at the list, or None when it clearly says the game is not there.

    A look with a non-zero return code, or with no answer at all, is "unknown: the game may run". tasklist answers a
    filter that matches nothing with an INFO line and return code 0, so a quiet, empty reply is not a "no".
    """
    if returncode != 0 or not out.strip():
        return f"{image} (tasklist gave no clear answer)"
    if image.lower() in out.lower():
        return image
    return None


def running_games() -> list[str]:
    found = []
    for image in GAME_IMAGES:
        try:
            done = subprocess.run([TASKLIST, "/FI", f"IMAGENAME eq {image}", "/NH"], capture_output=True, text=True,
                                  timeout=30, creationflags=0x08000000)
        except (OSError, subprocess.SubprocessError):
            found.append(f"{image} (tasklist could not be run)")
            continue
        answer = verdict(image, done.returncode, done.stdout)
        if answer is not None:
            found.append(answer)
    return found


if __name__ == "__main__":
    games = running_games()
    print("GAME RUNNING: " + ", ".join(games) if games else "game not running")
    raise SystemExit(1 if games else 0)
