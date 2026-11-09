"""tools/record-site-demo.py records the demo core's answers for the site's browser demo (web/src/sitedemo.ts reads them): every
GET route the interface uses for each page is in the recording, the files are named as the page names them, and the recording holds
nothing of the machine it was made on."""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "record-site-demo.py"
WEB_SRC = ROOT / "web" / "src"


@pytest.fixture(scope="module")
def tool():
    spec = importlib.util.spec_from_file_location("record_site_demo", TOOL)
    module = importlib.util.module_from_spec(spec)
    sys.modules["record_site_demo"] = module
    spec.loader.exec_module(module)
    return module


def test_a_route_is_a_file_name_the_page_makes_the_same_way(tool):
    # The same pairs are in web/src/sitedemo.test.ts.
    assert tool.recording_key("/api/status") == "status-269de7a9"
    assert tool.recording_key("/api/achievements?view=left&category=0") == "achievements-view-left-category-0-b6ea23d4"
    assert tool.recording_key("/api/ledger/history?kind=primogem&limit=50") == "ledger-history-kind-primogem-limit-50-3ad40430"
    assert re.fullmatch(r"[A-Za-z0-9-]+", tool.recording_key("/api/characters/lan-yan/plan"))  # a name fit for any file system
    assert len(tool.recording_key("/api/" + "x" * 500)) < 80


def test_the_ledger_pages_routes_are_the_ones_it_asks(tool):
    # The Artifacts feed asks for the five-stars alone (web/src/api.ts `ledgerApi.history`); the site's transport matches exact routes.
    routes = tool.PAGES["ledger"]
    assert "/api/ledger" in routes
    assert "/api/ledger/history?kind=artifact&limit=50&rank=5" in routes
    assert "/api/ledger/history?kind=artifact&limit=50" not in routes
    for kind in ("primogem", "crystal", "resin"):
        assert f"/api/ledger/history?kind={kind}&limit=50" in routes


def test_the_routes_that_depend_on_an_answer_are_made_from_it(tool):
    answers = {
        "/api/achievements?view=left": {"categories": [{"name": "a"}, {"name": "b"}]},
        "/api/commissions": {"regions": [{"key": "liyue"}, {"key": "natlan"}]},
        "/api/layouts/board": {"widgets": [{"id": "start-notes"}]},
        "/api/layouts/overlay": {"widgets": [{"id": "start-ov-clock"}]},
        "/api/characters": {"entries": [{"key": "sandrone"}]},
        "/api/friends": {"friends": [{"user_id": "u1", "compare": True}, {"user_id": "u2", "compare": False}]},
        "/api/map": {"tabs": [{"id": 1}]},
        "/api/stats/month": {"months": [{"ym": "2026-09"}, {"ym": "2026-10"}]},
        "/api/stats/year": {"years": [2025, 2026], "year": {}},
    }
    get = answers.__getitem__
    achievements = tool.routes_of("achievements", get)
    for view in ("left", "done", "all"):
        for route in (f"/api/achievements?view={view}", f"/api/achievements?view={view}&pinned=true",
                      f"/api/achievements?view={view}&category=0", f"/api/achievements?view={view}&category=1"):
            assert route in achievements
        # Pinned keeps the category the page is on (modelPath in web/src/pages/achievementsview.ts), and the page always is on one
        # once it has opened, so Pinned is asked for with each category.
        for route in (f"/api/achievements?view={view}&category=0&pinned=true", f"/api/achievements?view={view}&category=1&pinned=true"):
            assert route in achievements
    assert "/api/commissions?region=natlan" in achievements and "/api/status" in achievements
    assert "/api/widgets/start-notes/data" in tool.routes_of("board", get)
    assert "/api/widgets/start-ov-clock/data" in tool.routes_of("overlay", get)
    assert tool.routes_of("characters", get)[-2:] == ["/api/characters/sandrone", "/api/characters/sandrone/plan"]
    assert tool.routes_of("friends", get)[-3:] == ["/api/friends/u1", "/api/friends/u1/compare", "/api/friends/u2"]
    assert "/api/map/tabs/1" in tool.routes_of("map", get)
    stats = tool.routes_of("stats", get)
    assert len(stats) == len(set(stats))
    assert "/api/stats/month?ym=2026-09" in stats and "/api/stats/month?ym=2026-10" in stats and "/api/stats/month" in stats
    assert "/api/stats/year" in stats and "/api/stats/year?year=2025" in stats and "/api/stats/year?year=2026" in stats


def test_your_week_and_the_endgame_are_recorded_only_while_the_core_shows_them(tool):
    get = {"/api/characters": {"entries": []}}.__getitem__
    assert "/api/week" not in tool.routes_of("week", get, False)
    assert "/api/endgame?after=1" not in tool.routes_of("characters", get, False)
    assert "/api/week" in tool.routes_of("week", get, True)
    assert "/api/endgame?after=1" in tool.routes_of("characters", get, True)


# ---------------------------------------------------------------------------------------- the pages' own routes, read from the source
def _sources() -> list[tuple[Path, str]]:
    return [(path, path.read_text(encoding="utf-8")) for path in sorted(WEB_SRC.rglob("*.ts*"))
            if ".test." not in path.name and path.suffix in {".ts", ".tsx"}]


def _reads() -> set[str]:
    """The paths the interface asks the core for, from its source: each `/api/...` written in a call that reads (api.get, useModel, a
    path a page reads from), up to its first variable part or query. A path that the call writes (post, put, delete) is not one."""
    found: set[str] = set()
    for path, text in _sources():
        for match in re.finditer(r"""(['"`])(/api/[^'"`]*)\1?""", text):
            before = text[max(0, match.start() - 60):match.start()]
            if re.search(r"\.(post|put|delete)(<[^>(]*>)?\(\s*$|request(<[^>(]*>)?\(\s*'(POST|PUT|DELETE)',\s*$", before):
                continue
            route = match.group(2)
            found.add(re.split(r"[?$`'\"]", route, maxsplit=1)[0].rstrip("/"))
    return found


def _recorded(tool) -> set[str]:
    """Every route the tool records, with the answers' routes made from sample answers, as paths without their query."""
    routes = set(tool.COMMON)
    for page_routes in tool.PAGES.values():
        routes.update(page_routes)
    routes.update(tool.WEEK_AND_ENDGAME)
    routes.update({"/api/achievements", "/api/commissions", "/api/widgets", "/api/characters", "/api/friends", "/api/map/tabs", "/api/layouts"})
    return {re.split(r"[?]", route, maxsplit=1)[0] for route in routes}


def test_every_read_the_interface_makes_is_recorded_or_given_a_reason(tool):
    recorded = _recorded(tool)
    reasons = tuple(tool.NOT_RECORDED) + tuple(tool.WRITE_ONLY)
    unaccounted = []
    for route in sorted(_reads()):
        if route in recorded or (route + "/").startswith(reasons):
            continue
        unaccounted.append(route)
    assert unaccounted == [], f"the interface reads these and the recording does not hold them: {unaccounted}"


def test_the_recorded_pages_are_the_interfaces_pages(tool):
    pages = set(re.findall(r"'([a-z]+)'", re.search(r"const PAGES: readonly string\[\] = \[(.*?)\]", (WEB_SRC / "route.ts").read_text(encoding="utf-8"), flags=re.S).group(1)))
    assert pages - set(tool.PAGES) == set(), "a page of the interface that the recording has no routes for"
    assert set(tool.PAGES) - pages == {"overlay"}


def test_the_icons_are_the_labels_the_core_holds_with_their_official_addresses(tool, tmp_path):
    from datetime import datetime, timezone

    from guildboard.metrics import Label
    from guildboard.store import Store

    db = tmp_path / "guildboard.db"
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    store = Store.open(db, tmp_path / "backups", now)
    store.upsert_labels(
        [Label("static.primogem", "Primogem", "static", None, "https://upload-static.hoyoverse.com/a.png", 0),
         Label("timer.hilichurl", "Hilichurl", "static", None, "https://bbs.hoyolab.com/b.png", 0),
         Label("banner.1", "A banner", "banner", None, "https://sdk.hoyoverse.com/c.jpg", 0),
         Label("achievement.1", "No picture", "achievement", None, "", 0)],
        now,
    )
    store.close()
    assert tool.icon_addresses(db) == {
        "banner.1": {"url": "https://sdk.hoyoverse.com/c.jpg"},
        "static.primogem": {"url": "https://upload-static.hoyoverse.com/a.png"},
        "timer.hilichurl": {"url": "https://bbs.hoyolab.com/b.png"},
    }


def test_an_icon_the_recording_names_or_the_interface_always_shows_has_an_address(tool):
    # The interface writes these two itself (the plate, the Achievements page); the others are named by the recorded answers.
    from guildboard.core import STATIC_ICONS

    assert {"static.primogem", "static.resin"} <= {label.key for label in STATIC_ICONS}


# ---------------------------------------------------------------------------------------- a real recording
def test_a_recording_holds_every_route_of_every_page_and_nothing_of_this_machine(tool, tmp_path, capsys):
    out = tmp_path / "recording"
    assert tool.main(["--out", str(out)]) == 0
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert set(index["pages"]) == set(tool.PAGES)
    for page, routes in index["pages"].items():
        for route in tool.COMMON + tool.PAGES[page]:
            if route in tool.WEEK_AND_ENDGAME and not index["week_and_endgame"]:
                continue
            assert route in routes, (page, route)
        for route in routes:
            file = out / f"{tool.recording_key(route)}.json"
            assert index["routes"][route] == tool.recording_key(route) and file.is_file(), route
            json.loads(file.read_text(encoding="utf-8"))
    # The answers a visitor sees first.
    status = json.loads((out / f"{tool.recording_key('/api/status')}.json").read_text(encoding="utf-8"))
    assert status["mode"] == "demo" and status["now"].startswith("2026-10-13T08:")
    settings = json.loads((out / f"{tool.recording_key('/api/settings')}.json").read_text(encoding="utf-8"))
    assert settings["risk_acknowledged"] is True
    # Pinned, as the Achievements page asks for it once it is on a category, holds the pinned achievements.
    pinned = json.loads((out / f"{tool.recording_key('/api/achievements?view=left&category=0&pinned=true')}.json").read_text(encoding="utf-8"))
    assert pinned["query"]["pinned"] is True and pinned["pinned"] == len(pinned["groups"]) > 0
    everything = "\n".join(path.read_text(encoding="utf-8") for path in out.glob("*.json"))
    assert "guildboard-site-demo-" not in everything, "the temp data folder's path is in the recording"
    for private in (str(Path.home()), str(tmp_path), str(ROOT)):
        assert json.dumps(private)[1:-1].lower() not in everything.lower(), private
    # Every picture the answers name is one the demo's list has an official address for (web/src/sitedemo.ts reads it from there).
    pictures = json.loads(tool.PICTURES.read_text(encoding="utf-8"))
    named = set(re.findall(r"/api/art/([A-Za-z0-9_-]+)", everything))
    assert named and named <= set(pictures)
    assert "no address in pictures.json" not in capsys.readouterr().err
