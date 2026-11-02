"""Settings, About shows the open-source licences from THIRD-PARTY-NOTICES.txt: next to the program in the installed copy,
at the top of the repository when run from source."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from guildboard import notices
from guildboard.api.app import create_app
from guildboard.config import AppPaths
from guildboard.core import Core
from support import FakeSleep

PORT = 4322
BASE = f"http://127.0.0.1:{PORT}"
ROOT = Path(__file__).resolve().parents[1]


def test_from_source_the_file_is_the_one_at_the_top_of_the_repository():
    assert notices.notices_file() == ROOT / "THIRD-PARTY-NOTICES.txt"
    assert notices.notices_file().is_file()


def test_in_the_installed_copy_the_file_is_the_one_the_build_packed(tmp_path, monkeypatch):
    (tmp_path / "THIRD-PARTY-NOTICES.txt").write_text("packed", encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert notices.notices_file() == tmp_path / "THIRD-PARTY-NOTICES.txt"


def test_in_the_installed_copy_the_file_beside_the_program_serves_when_the_packed_one_is_gone(tmp_path, monkeypatch):
    beside = tmp_path / "Guild Board"
    beside.mkdir()
    (beside / "THIRD-PARTY-NOTICES.txt").write_text("beside", encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(beside / "_internal"), raising=False)
    monkeypatch.setattr(sys, "executable", str(beside / "guildboard-app.exe"))
    assert notices.notices_file() == beside / "THIRD-PARTY-NOTICES.txt"


@pytest.fixture
def client(tmp_path, clock):
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            assert client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False).status_code == 303
            yield client
    finally:
        core.store.close()


def test_the_route_gives_the_files_text(client, tmp_path, monkeypatch):
    file = tmp_path / "notes.txt"
    file.write_text("== react 19.3.0 ==\nMIT\n", encoding="utf-8")
    monkeypatch.setattr(notices, "notices_file", lambda: file)
    answer = client.get("/api/notices")
    assert answer.status_code == 200
    assert answer.json() == {"text": "== react 19.3.0 ==\nMIT\n"}


def test_the_route_says_so_when_the_file_is_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(notices, "notices_file", lambda: tmp_path / "gone.txt")
    answer = client.get("/api/notices")
    assert answer.status_code == 404
    assert answer.json() == {"error": "The list of open-source licences is not next to the program."}


def test_the_route_needs_the_session(client):
    client.cookies.clear()
    assert client.get("/api/notices").status_code == 401
