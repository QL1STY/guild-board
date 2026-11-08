"""The public site (site/): a static page with no framework, no build step of its own, nothing from a third party, and no number
that is not the real release's. The page is read as text; the release reading is run in Node when it is installed."""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
HTML = (SITE / "index.html").read_text(encoding="utf-8")
CSS = (SITE / "site.css").read_text(encoding="utf-8")
JS = (SITE / "site.js").read_text(encoding="utf-8")
RELEASES = "https://github.com/QL1STY/guild-board/releases/latest"
SOURCE = "https://github.com/QL1STY/guild-board"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs Node")


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def _page() -> Page:
    page = Page()
    page.feed(HTML)
    return page


class Links(HTMLParser):
    """Each link of the page with its words, and every control or link found inside a link."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []
        self.inside: list[str] = []
        self._open: dict[str, str] | None = None

    def handle_starttag(self, tag, attrs):
        if self._open is not None and tag in {"a", "button", "input", "select", "textarea", "summary"}:
            self.inside.append(tag)
        if tag == "a":
            named = dict(attrs)
            self._open = {"href": named.get("href") or "", "class": named.get("class") or "", "text": ""}
            self.links.append(self._open)

    def handle_endtag(self, tag):
        if tag == "a":
            self._open = None

    def handle_data(self, data):
        if self._open is not None:
            self._open["text"] += data


def _links() -> Links:
    links = Links()
    links.feed(HTML)
    return links


def _words(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


def test_the_site_is_three_files_and_holds_no_picture():
    assert sorted(path.name for path in SITE.iterdir()) == ["index.html", "site.css", "site.js"]


# The two game icons of the hero's sample widgets, read by the visitor's browser from HoYoverse's own addresses (the player's
# choice of 2026-11-03), as the browser demo reads its pictures: the primogem of the check-in and the resin in its ring. No
# game picture is kept in the repository, and the page sends no referrer.
GAME_ICONS = {
    "https://upload-static.hoyoverse.com/hoyolab-wiki/2023/01/19/194600931/8902272b2dbb45cce8fbd6f596c6904b_3502391192719350131.png",
    "https://act-upload.hoyoverse.com/event-ugc-hoyowiki/2025/07/03/237301566/4328202cd795d7c4a7d5cd54e331c43b_1224981524026882289.png",
}


def test_the_page_loads_nothing_from_a_third_party_but_the_two_game_icons_and_runs_no_inline_script():
    page = _page()
    icons = []
    for tag, attrs in page.tags:
        if tag in {"script", "link", "img", "iframe", "source", "video", "audio", "embed", "object"}:
            address = attrs.get("src") or attrs.get("href") or ""
            if tag == "img" and address in GAME_ICONS:
                icons.append(address)
                assert attrs.get("referrerpolicy") == "no-referrer" and attrs.get("alt") == "", attrs
                continue
            assert address == "" or not re.match(r"(https?:)?//", address), (tag, address)
        assert "style" not in attrs, f"an inline style on <{tag}> would need 'unsafe-inline'"
        assert not any(name.startswith("on") for name in attrs), f"an inline handler on <{tag}>"
    scripts = [attrs for tag, attrs in page.tags if tag == "script"]
    assert [attrs.get("src") for attrs in scripts] == ["site.js"]
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", HTML)
    assert "@import" not in CSS and "fonts.googleapis" not in HTML + CSS
    assert not re.search(r"url\((?!['\"]?(fonts/|data:))", CSS), "the stylesheet names only its own fonts"
    policy = next(attrs["content"] for tag, attrs in page.tags if tag == "meta" and attrs.get("http-equiv") == "Content-Security-Policy")
    assert "default-src 'none'" in policy and "connect-src https://api.github.com;" in policy
    assert "unsafe" not in policy
    assert sorted(icons) == sorted(GAME_ICONS), "each game icon is on the page once"
    assert "img-src 'self' data: https://upload-static.hoyoverse.com https://act-upload.hoyoverse.com;" in policy
    # The only request the script makes is GitHub's public API, for the releases repository's latest release.
    assert re.findall(r"https?://[^'\"\s)]+", JS) == ["https://api.github.com/repos/"]
    assert "XMLHttpRequest" not in JS and "sendBeacon" not in JS and "document.cookie" not in JS
    assert "localStorage" not in JS and "sessionStorage" not in JS


def test_no_tracker_and_no_cookie():
    for word in ("analytics", "gtag", "googletagmanager", "plausible", "matomo", "pixel", "cookie"):
        assert word not in (HTML + JS + CSS).lower(), word


def test_the_download_buttons_point_to_the_latest_release():
    page = _page()
    release_links = [attrs["href"] for tag, attrs in page.tags if tag == "a" and "data-release-link" in attrs]
    assert len(release_links) == 3 and set(release_links) == {RELEASES}
    # Every other address to the downloads is the same page, and none is the old releases repository's (2.0.1 moved the
    # releases into the code's repository).
    assert set(re.findall(r"https://github\.com/QL1STY/guild-board/releases[^\"'<> ]*", HTML)) == {RELEASES}
    assert "guild-board-releases" not in HTML + JS


def test_no_number_of_the_mockup_is_written_into_the_page():
    text = re.sub(r"<[^>]+>", " ", HTML)
    assert not re.search(r"\b1\.0\.0\b", HTML + JS), "no version is written in: it comes from the release"
    assert not re.search(r"\b\d+ ?MB\b", text), "no size is written in: it comes from the release"
    assert not re.search(r"\b[0-9a-f]{64}\b", HTML)
    for hidden_until_known in ('data-release="size" hidden', 'data-release="size-facts" hidden', 'data-release="hash" hidden', 'data-release="line" hidden'):
        assert hidden_until_known in HTML, hidden_until_known


def test_the_support_part_is_there_and_off_with_no_link_in_it():
    section = re.search(r"((?:<!--(?:(?!-->).)*-->\s*)?)<section id=\"support\"([^>]*)>(.*?)</section>", HTML, flags=re.S)
    assert section, "the support part is in the page"
    comment, attributes, body = section.groups()
    assert re.search(r"\bhidden\b", attributes)
    assert "stays off until the player turns it on" in comment
    assert "<a " not in body and "href" not in body
    assert 'href="#support"' not in HTML, "nothing in the page leads to a part that is off"


def test_the_footer_links_go_to_real_files_of_the_source_repository():
    footer = re.search(r"<footer.*?</footer>", HTML, flags=re.S).group(0)
    links = re.findall(r'href="([^"]+)"', footer)
    assert links and all(link == SOURCE or link.startswith(SOURCE + "/") for link in links), links
    for link in links:
        if "/blob/main/" in link:
            name = link.split("/blob/main/", 1)[1]
            assert (ROOT / name).is_file() or name in {"PRIVACY.md", "SECURITY.md", "LICENSE", "THIRD-PARTY-NOTICES.txt"}, name
    assert {"/blob/main/PRIVACY.md", "/blob/main/LICENSE", "/blob/main/THIRD-PARTY-NOTICES.txt"} <= {
        link[len(SOURCE):] for link in links
    }
    assert "Not affiliated with or endorsed by HoYoverse or COGNOSPHERE" in footer
    assert f"{SOURCE}/blob/main/tests/test_handsoff.py" in HTML and (ROOT / "tests" / "test_handsoff.py").is_file()


def test_the_page_names_each_screenshot_the_tabs_read():
    page = _page()
    sources = [attrs["data-src"] for tag, attrs in page.tags if tag == "button" and "data-src" in attrs]
    assert sources == [f"shots/{name}.png" for name in ("board", "achievements", "pulls", "stats", "year", "overlay")]


def test_the_tabs_fill_one_row_and_wrap_only_into_even_rows():
    tabs = len(re.findall(r'<button class="tab" role="tab"', HTML))
    assert tabs == 6
    # Six equal columns where the row has room for them, and narrower an even split of them, so that no tab is left alone on
    # a row of its own. Narrower still, the tabs are one row of chips that scrolls (the test of a narrow screen, below).
    columns = [int(count) for count in re.findall(r"\.tabs \{[^}]*grid-template-columns: repeat\((\d+), minmax\(0, 1fr\)\)", CSS)]
    assert columns[0] == tabs and len(columns) > 1
    assert all(tabs % count == 0 for count in columns), columns


SCREEN = (
    '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/>'
    '<path d="M8 21h8M12 17v4"/></svg>'
)


def test_the_demo_opens_from_two_gold_buttons_of_one_look():
    links = _links()
    to_demo = [(link["class"], " ".join(link["text"].split())) for link in links.links if link["href"] == "demo/"]
    assert to_demo == [
        ("btn gold", "Try the live demo In your browser, nothing to install"),
        ("btn gold", "Open the full demo In your browser, nothing to install"),
    ]
    # The widgets stay controls of their own: no link holds a button or another link.
    assert links.inside == []
    # Each has the small screen, which does not move, and the hero's stands beside Download for Windows.
    assert HTML.count(SCREEN) == 2
    assert not re.search(r"\.(ico|gold)\b[^{}]*\{[^}]*(animation|transition)", CSS)
    pitch = HTML.split('<div class="pitch">', 1)[1].split('<div class="board"', 1)[0]
    assert re.search(r'<div class="acts">\s*<a class="btn" href="[^"]+" data-release-link>Download for Windows</a>\s*<a class="btn gold" href="demo/">', pitch)


def test_the_heros_board_is_the_apps_own_widgets_with_no_window_around_them():
    hero = HTML.split('<section class="hero" id="top">', 1)[1].split('<section id="pages">', 1)[0]
    assert not re.search(r'class="(demo|demo-bar|demo-body|demo-rail|strip)"', HTML), "no window frame and no strip"
    assert not re.search(r"\.(demo|strip)\b", CSS)
    board = hero.split('<div class="board" role="group" aria-label="A working sample of the Board, on a made-up account">', 1)[1]
    # Headed as the app heads a widget: its sign, its name and its meta.
    heads = [_words(head) for head in re.findall(r'<div class="w-head">(.*?)</div>', board, flags=re.S)]
    assert heads == ["Daily check-in 11 of 30", "Resin Read at 13:16", "Commissions 1 of 3 today"]
    assert board.count('<div class="w-head"><svg class="sign"') == 3
    # Resin's ring as the app draws it: 77 of 200 from the top, cut into ten parts of 20.
    ring = re.search(r'<svg class="ring"[^>]*>(.*?)</svg>', board, flags=re.S).group(1)
    assert ring.count('pathLength="200"') == 3 and 'stroke-dasharray="77 200"' in ring and 'stroke-dasharray="1.6 18.4"' in ring
    # The month's days come from one tile, the check-in claims with one button, and the commissions tick.
    assert re.search(r'<template id="day"><li class="day">', HTML)
    assert re.search(r'<button class="btn" id="claim" type="button">Claim</button>', board)
    assert re.findall(r'<button class="task" type="button" aria-pressed="(true|false)">', board) == ["true", "false", "false"]
    assert "for (var i = 1; i <= 30; i += 1)" in JS, "the whole month, as the app shows it"


def test_the_check_in_lays_itself_out_as_the_app_and_keeps_its_words_whole_on_a_small_phone():
    # The month stands beside today's reward from a check-in 500 wide, the app's own threshold (web/src/styles/checkin.css).
    assert re.search(r"@container \(min-width: 500px\) \{\s*\.checkin \{", CSS) and "420" not in CSS
    # Resin's ring shrinks with a narrow card, on a small phone or two cards to a row, so that how long until full fits beside
    # it, and a day's reward is left out of a tile too narrow to hold it.
    assert re.search(r"\n\.ring-wrap \{[^}]*width: min\(116px, 40cqi\)", CSS)
    assert re.search(r"\.days \{[^}]*container: month / inline-size", CSS)
    assert re.search(r"@container month \(max-width: \d+px\) \{ \.day-x \{ display: none; \} \}", CSS)


def test_buttons_in_a_row_are_one_size():
    acts = re.search(r"\n\.acts \{([^}]*)\}", CSS).group(1)
    assert "display: grid" in acts and "grid-auto-flow: column" in acts
    assert "grid-auto-columns: 1fr" in acts and "grid-auto-rows: 1fr" in acts, "one width and one height, in a row or stacked"


READS = [
    "Your account summary, exploration, resin and Real-Time Notes",
    "Your characters, builds, materials and endgame results",
    "Your wishes and primogem history, with a read-only key",
    "The current banners, events and your check-in month",
]
NEVER = [
    "Open the game's process, read its memory or hook into it",
    "Send keys or clicks to the game, or capture its screen",
    "Change anything in the game's folder",
    "Send your HoYoLAB login anywhere but HoYoverse",
]


def test_what_it_reads_and_never_does_are_two_cards_with_their_words_as_they_were():
    reads = re.search(r'<section id="reads">(.*?)</section>', HTML, flags=re.S).group(1)
    cards = re.findall(r'<div class="card( never)?">\s*<h3 class="card-head">(.*?)</h3>(.*?)</ul>', reads, flags=re.S)
    assert [(never, head) for never, head, _ in cards] == [("", "What it reads"), (" never", "What it never does")]
    for (_, _, body), words in zip(cards, (READS, NEVER)):
        items = re.findall(r"<li>(.*?)</li>", body, flags=re.S)
        assert [_words(item) for item in items] == words
        assert all(item.startswith('<span class="dot" aria-hidden="true"><svg') for item in items)
    assert re.search(r'</div>\s*</div>\s*<p class="lead">A test in the source code fails if any of this stops being true\.', reads)
    phone = _block(CSS, "@media (max-width: 860px) {")
    assert re.search(r"(^|\s)[^{}]*\.two[^{}]*\{ grid-template-columns: minmax\(0, 1fr\);", phone), "the cards stack on a phone"


def _block(css: str, opening: str) -> str:
    """The text of the `@media` block that opens with `opening`, up to its closing brace."""
    start = css.index(opening) + len(opening)
    depth, end = 1, start
    while depth:
        depth += {"{": 1, "}": -1}.get(css[end], 0)
        end += 1
    return css[start:end]


def test_on_a_narrow_screen_a_picture_keeps_a_readable_size_inside_a_frame_that_scrolls_by_itself():
    page = _page()
    by_id = {attrs["id"]: tag for tag, attrs in page.tags if "id" in attrs}
    assert by_id["shot-dialog"] == "dialog" and by_id["zoom"] == "button" and by_id["shot-close"] == "button"
    assert "Swipe the picture sideways" in HTML and "Press it to open it at full size" in HTML
    narrow = _block(CSS, "@media (max-width: 1200px) {")
    width = int(re.search(r"\.window img \{ width: (\d+)px; max-width: none;", narrow).group(1))
    assert width >= 860 and f".zoom {{ width: {width}px; }}" in narrow
    assert re.search(r"\.pane \{[^}]*overflow-x: auto", narrow), "the frame scrolls sideways by itself"
    assert re.search(r"\.tabs \{ display: flex;[^}]*overflow-x: auto", narrow), "the tabs are one row of chips that scrolls"
    assert "grid-template-columns: repeat(2" not in narrow and "grid-template-columns: repeat(2" not in _block(CSS, "@media (max-width: 860px) {").split(".foot")[0]
    assert not re.search(r"^(html|body)\s*\{[^}]*overflow-x", CSS, flags=re.M), "the page itself is never made to scroll sideways"
    # The picture opens at its own size in a dialog at every width, and a new picture is read from its left edge.
    assert "showModal" in JS and "pane.scrollLeft = 0" in JS and "event.target === dialog" in JS
    assert re.search(r"\.dialog-pane img \{[^}]*width: 1640px", CSS)


def test_a_phone_has_tap_targets_of_44_pixels_and_one_column_of_stops():
    phone = _block(CSS, "@media (max-width: 860px) {")
    assert phone.count("min-height: 44px") >= 7
    for target in (".mark", ".rail .get", ".w .btn", ".task", ".smart .more, .smart .key", ".foot .links a", ".stop h3"):
        assert re.search(re.escape(target) + r" \{[^}]*min-height: 44px", phone), target
    assert "position: sticky" in phone.split(".rail {")[1].split("}")[0], "the top bar stays in view"
    assert ".stop::after" in phone and ".route::before { display: none; }" in phone


def test_the_page_works_without_a_mouse_and_with_reduced_motion():
    assert ":focus-visible" in CSS and "prefers-reduced-motion: reduce" in CSS
    assert 'role="tablist"' in HTML and "ArrowRight" in JS
    assert re.search(r"<meta name=\"viewport\" content=\"width=device-width", HTML)


def test_the_fonts_are_self_hosted():
    names = set(re.findall(r"url\('fonts/([\w.-]+)'\)", CSS))
    spec = importlib.util.spec_from_file_location("assemble_site", ROOT / "tools" / "assemble-site.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    assert names == set(tool.font_files())


def _facts(release: object) -> object:
    program = "const s = require(process.argv[1]); console.log(JSON.stringify(s.releaseFacts(JSON.parse(process.argv[2]))))"
    done = subprocess.run(["node", "-e", program, str(SITE / "site.js"), json.dumps(release)], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


SHA = "ab" * 32


@needs_node
def test_the_release_gives_its_real_version_size_and_hash():
    release = {"tag_name": "v0.8.0", "assets": [
        {"name": "notes.txt", "size": 5},
        {"name": "Guild.Board.Setup.0.8.0.exe", "size": 157286400, "digest": f"sha256:{SHA.upper()}"},
    ]}
    assert _facts(release) == {
        "name": "Guild.Board.Setup.0.8.0.exe", "version": "0.8.0", "size": "150 MB", "sha256": SHA,
        "verify": 'gh attestation verify "Guild.Board.Setup.0.8.0.exe" -R QL1STY/guild-board',
    }


@needs_node
def test_a_part_the_release_does_not_give_is_none_and_never_a_guess():
    odd = _facts({"tag_name": "nightly", "assets": [{"name": "Guild Board Setup beta.exe", "size": 0, "digest": "md5:abc"}]})
    assert odd == {"name": "Guild Board Setup beta.exe", "version": None, "size": None, "sha256": None,
                   "verify": 'gh attestation verify "Guild Board Setup beta.exe" -R QL1STY/guild-board'}
    # The version falls back to the tag when the file's name has none.
    assert _facts({"tag_name": "v1.2.3", "assets": [{"name": "Guild Board Setup.exe", "size": 1048576}]})["version"] == "1.2.3"


@needs_node
@pytest.mark.parametrize("release", [None, "x", {}, {"assets": "no"}, {"assets": []}, {"assets": [{"name": "other.exe", "size": 3}]}, {"assets": [None]}])
def test_a_release_without_an_installer_gives_nothing(release):
    assert _facts(release) is None


# ------------------------------------------------------------------------------------------------- the rail's marker
# The rail's items, in its order: Board (#top), What it does, What it reads, Get it and Questions (#faq). Each case gives
# the sections' tops from the top of the window, how far the page is scrolled, the window's height and the page's.
def _marked(*cases: tuple[list[float], float, float, float]) -> list[int]:
    program = (
        "const s = require(process.argv[1]);"
        "console.log(JSON.stringify(JSON.parse(process.argv[2]).map((c) => s.markedSection(c[0], c[1], c[2], c[3]))))"
    )
    done = subprocess.run(["node", "-e", program, str(SITE / "site.js"), json.dumps(cases)], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


@needs_node
def test_the_rail_marks_board_at_the_very_top_and_questions_at_the_very_bottom():
    assert _marked(
        # A tall window at the top of the page: the second section's top is above the line a third of the way down (466 of
        # 1,400) already, and Board is marked all the same.
        ([40, 450, 1500, 2400, 3300], 0, 1400, 4400),
        # A page that does not scroll at all is at its top.
        ([40, 300, 500, 700, 900], 0, 1400, 1300),
        # At the bottom the last section is too short for its top to reach the line, and it is marked all the same, also
        # where the page stops a fraction short of its end, as a zoomed page does.
        ([-2960, -2550, -1500, -600, 300], 3000, 1400, 4400),
        ([-2959.5, -2549.5, -1499.5, -599.5, 300.5], 2999.5, 1400, 4400),
    ) == [0, 0, 4, 4]


@needs_node
def test_in_between_the_rail_marks_the_last_section_whose_top_has_passed_a_third_of_the_window():
    assert _marked(
        ([-500, 380, 1400, 2300, 3200], 540, 1100, 5000),  # the line is at 366: only Board's top has passed it
        ([-900, 300, 1000, 1900, 2800], 940, 1100, 5000),
        ([-900, -500, 366, 1300, 2200], 1500, 1100, 5000),  # a top on the line has passed it
        ([-3000, -2600, -1700, -800, 400], 3600, 1100, 5000),  # Questions has not reached the line yet
    ) == [0, 1, 2, 3]


def test_the_rail_follows_the_page_with_one_scroll_handler_and_marks_a_clicked_item_at_once():
    nav = re.search(r'<nav aria-label="Sections">(.*?)</nav>', HTML, flags=re.S).group(1)
    assert re.findall(r'href="#([\w-]+)"', nav) == ["top", "pages", "reads", "get", "faq"]
    ids = [attrs.get("id") for _, attrs in _page().tags]
    assert all(ids.count(section) == 1 for section in ("top", "pages", "reads", "get", "faq"))
    assert '<a href="#top" aria-current="true">Board</a>' in nav, "marked before the script runs"
    assert "IntersectionObserver" not in JS
    assert "requestAnimationFrame(look)" in JS and "addEventListener('scroll'" in JS and "aria-current" in JS
    # The window's height as it is now: where a phone's toolbar folds away while the page scrolls, the bottom is still found.
    assert "window.innerHeight" in JS and "clientHeight" not in JS


def test_the_assembled_site_holds_the_page_and_the_fonts_and_refuses_a_folder_that_holds_files(tmp_path):
    spec = importlib.util.spec_from_file_location("assemble_site", ROOT / "tools" / "assemble-site.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    if not tool.FONT_PACKAGE.is_dir():
        pytest.skip("the fonts are not installed (npm ci in web/)")
    out = tmp_path / "site"
    missing = tool.assemble(out)
    assert sorted(path.name for path in out.iterdir()) == [".nojekyll", "fonts", "index.html", "site.css", "site.js"]
    assert {path.name for path in (out / "fonts").glob("*.woff2")} == set(tool.font_files())
    assert (out / "fonts" / "LICENSE.txt").is_file()
    assert "demo/" in missing and "shots/board.png" in missing
    shots = tmp_path / "shots"
    shots.mkdir()
    (shots / "board.png").write_bytes(b"x")
    again = tool.assemble(tmp_path / "second", None, shots)
    assert "shots/board.png" not in again and "shots/pulls.png" in again


# ---------------------------------------------------------------------------------------- the screenshots the tabs read
SPEC = ROOT / "web" / "screens" / "site.spec.ts"


def test_the_screenshots_are_taken_from_the_real_interface_at_one_size_and_kept_out_of_the_repository():
    spec = SPEC.read_text(encoding="utf-8")
    package = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert package["screens:site"].endswith("--grep @site") and "@site" in package["screens"].split("--grep-invert")[1]
    assert "{ width: 1640, height: 1000 }" in spec and spec.count("setViewportSize") == 2
    assert "{ width: 1640, height: 680 }" in spec  # the overlay's own: the frame it keeps its widgets in
    assert re.findall(r"take\(page, '(\w+)'\)", spec) == ["board", "achievements", "pulls", "stats", "year", "overlay"]
    assert "from './out.ts'" in spec and "path.join(SCREENS_OUT, 'site')" in spec
    # The pictures of the demo's lists (the art cache's, and the icon cache's by the recording's icons.json) are read from the official
    # addresses by the test alone.
    assert "page.route('**/api/art/**'" in spec and "pictures.json" in spec and "route.fetch({ url })" in spec
    assert "page.route('**/api/icon/**'" in spec and "icons.json" in spec
    # No picture is written anywhere but the ignored folder, and no game's picture is kept in the site.
    assert not re.search(r"writeFile|copyFile", spec)
    done = subprocess.run(["git", "check-ignore", "-q", "screenshots/site/board.png"], cwd=ROOT)
    assert done.returncode == 0, "screenshots/ must be ignored by git"
    assert not [path for path in SITE.rglob("*") if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"}]
    tracked = subprocess.run(["git", "ls-files", "site", "screenshots", "shots"], cwd=ROOT, capture_output=True, text=True).stdout
    assert not re.search(r"\.(png|jpe?g|webp|gif|avif)$", tracked, flags=re.MULTILINE)


def test_the_overlay_tab_reads_a_picture_made_over_the_maintainers_photograph():
    page = _page()
    sources = [attrs["data-src"] for tag, attrs in page.tags if tag == "button" and "data-src" in attrs]
    assert sources[-1] == "shots/overlay.png"
    # The photograph from the game is the maintainer's: it is named by an environment variable, never kept in the repository, and
    # the test is passed over without it.
    spec = SPEC.read_text(encoding="utf-8")
    assert "process.env.GB_OVERLAY_BACKGROUND" in spec and "test.skip(photograph === undefined" in spec
    assert not re.search(r"['\"][^'\"]*\.(png|jpe?g)['\"]", spec.replace("`${name}.png`", ""))
