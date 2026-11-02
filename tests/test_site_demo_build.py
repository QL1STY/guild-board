"""The interface's two builds. The installed app's holds none of the browser demo: no recorded data, no refusal sentence, no address
of HoYoverse's pictures, and no way to read from the internet that it did not have. The site's (`--mode site-demo`) holds the demo,
under the site's address. Each is built here into a temporary folder; Node and the interface's packages must be installed."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
NPX = shutil.which("npx")
pytestmark = pytest.mark.skipif(NPX is None or not (WEB / "node_modules" / "vite").is_dir(), reason="needs Node and `npm ci` in web/")


def _build(out: Path, *arguments: str) -> str:
    done = subprocess.run([NPX, "vite", "build", "--outDir", str(out), "--emptyOutDir", *arguments], cwd=WEB, capture_output=True,
                          encoding="utf-8", errors="replace", timeout=300)
    assert done.returncode == 0, done.stdout + done.stderr
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(out.rglob("*.js")))


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    out = tmp_path_factory.mktemp("app")
    return out, _build(out)


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    out = tmp_path_factory.mktemp("site")
    return out, _build(out, "--mode", "site-demo")


def test_the_installed_apps_bundle_has_no_recorded_data_and_no_picture_address(app):
    out, code = app
    pictures = json.loads((ROOT / "src" / "guildboard" / "characters" / "demo" / "pictures.json").read_text(encoding="utf-8"))
    assert pictures
    for sentence in ("This is a recording", "is not in the recording", "recording/", "This is a recording on a made-up account.", "Back to the site"):
        assert sentence not in code, sentence
    for key, entry in pictures.items():
        assert entry["url"] not in code and key not in code
    # No address of a picture host (the five hosts the core reads from) is written in the interface: it loads nothing from the internet.
    assert not re.search(r"https?://[\w.-]*(act-webstatic|act-upload|upload-static|fastcdn)\.hoyoverse\.com", code)
    assert not re.search(r"https://bbs\.hoyolab\.com", code)
    assert not list(out.rglob("recording*")) and len(list(out.glob("*.html"))) == 1
    html = (out / "index.html").read_text(encoding="utf-8")
    assert 'src="/assets/' in html and "guild-board" not in html and "no-referrer" not in html
    # The installed window fits its width to the screen; only the site's demo is laid out 1,280 wide.
    assert 'content="width=device-width, initial-scale=1.0"' in html and "width=1280" not in html


def test_the_installed_app_has_one_script_and_no_chunk_for_the_demo(app):
    out, _ = app
    scripts = sorted(path.name for path in (out / "assets").glob("*.js"))
    assert len(scripts) == 1, scripts


def test_the_sites_bundle_is_the_demo_under_the_sites_address(site):
    out, code = site
    assert "This is a recording, so nothing here changes. Install Guild Board to use it." in code
    assert "recording/" in code
    pictures = json.loads((ROOT / "src" / "guildboard" / "characters" / "demo" / "pictures.json").read_text(encoding="utf-8"))
    assert all(entry["url"] in code for entry in pictures.values())
    html = (out / "index.html").read_text(encoding="utf-8")
    assert 'src="/guild-board/demo/assets/' in html and 'href="/guild-board/demo/assets/' in html
    assert '<meta name="referrer" content="no-referrer"' in html
    # The app is about 1,040 pixels wide, so a phone is given a page 1,280 wide to show whole and pinch into, in place of a broken
    # layout; and a thin bar says the page is a recording, with the way back to the site.
    assert html.count('name="viewport"') == 1 and '<meta name="viewport" content="width=1280" />' in html
    assert "This is a recording on a made-up account." in code and "Back to the site" in code and "/guild-board/" in code
    assert "api.github.com" not in code


def test_the_demo_has_no_way_to_send_what_the_page_writes():
    # The transport answers a POST, PUT or DELETE with the refusal; nothing in the demo sends it on.
    source = (WEB / "src" / "sitedemo.ts").read_text(encoding="utf-8")
    assert "method !== 'GET') throw new ApiError(409, RECORDING_REFUSAL)" in source
    for way in ("EventSource", "WebSocket", "sendBeacon", "XMLHttpRequest"):
        assert way not in source
    assert source.count("fetch(") == 1 and "recording/" in source.split("fetch(", 1)[1].splitlines()[0]
