import re
from pathlib import Path

import guildboard

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_version_is_set_and_matches_the_project():
    # release.ps1 writes both; the installed copy compares this one with the newest release's.
    assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", guildboard.__version__)
    assert f'version = "{guildboard.__version__}"' in PYPROJECT.read_text(encoding="utf-8")
