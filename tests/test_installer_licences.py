"""The installed copy carries Guild Board's licence, the notices of the software inside it and the privacy notice."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_the_installed_copy_carries_the_licence_the_notices_and_the_privacy_notice():
    spec = (ROOT / "packaging" / "guildboard.spec").read_text("utf-8")
    for name in ("LICENSE", "THIRD-PARTY-NOTICES.txt", "PRIVACY.md"):
        assert f'(str(ROOT / "{name}"), ".")' in spec, name
    recipe = (ROOT / "packaging" / "installer.iss").read_text("utf-8")
    assert re.search(r"^LicenseFile=\{#Root\}\\LICENSE$", recipe, re.MULTILINE)  # a page of its own
    for name in ("LICENSE", "THIRD-PARTY-NOTICES.txt", "PRIVACY.md"):
        assert re.search(rf'^Source: "\{{#Root\}}\\{re.escape(name)}"; DestDir: "\{{app\}}"', recipe, re.MULTILINE), name
