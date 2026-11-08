"""A live core starts without the HoYoLAB library, which loads in a thread after the start and is waited for by what uses
it (the Electron shell plan, Task 4): importing genshin takes about a second, and the demo never needs it."""
from __future__ import annotations

import asyncio
import subprocess
import sys
import threading
import time

import pytest

from guildboard import core as core_module
from guildboard.config import AppPaths, Settings, save_settings
from guildboard.core import Core, SourceBuildFailed
from guildboard.records import Unexpected
from guildboard.tokenstore import StoredToken, TokenStore
from support import FakeSleep


def test_a_live_core_starts_without_importing_genshin(tmp_path):
    code = ("import sys; from pathlib import Path; from guildboard.config import AppPaths; from guildboard.core import Core;"
            f"paths = AppPaths(Path(r'{tmp_path}')); paths.ensure(); Core(paths, demo=False);"
            "print('genshin' in sys.modules)")
    assert subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True, timeout=120).stdout.strip() == "False"


def _live_core(tmp_path, clock, monkeypatch, source_class, *, login: bool = False, **options) -> Core:
    monkeypatch.setattr(core_module, "_hoyolab_source_class", lambda cache_dir: source_class)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    if login:
        TokenStore(paths.token_path).save(StoredToken(
            {"ltoken_v2": "made-up-ltoken", "ltuid_v2": "123456", "cookie_token_v2": "made-up-cookie-token",
             "account_id_v2": "123456"}, 700000001, "os_euro", "Traveler",
        ))
        save_settings(paths.settings_path, Settings(risk_acknowledged=True))
    return Core(paths, demo=False, clock=clock, process_lister=lambda: set(), **options)


def test_a_live_source_is_made_the_first_time_core_source_is_read_and_once(tmp_path, clock, monkeypatch):
    made: list[tuple] = []

    class Source:
        def __init__(self, tokens, **options) -> None:
            made.append((tokens, options))
            self.fault = None

        def can_mint(self) -> bool:
            return True

    core = _live_core(tmp_path, clock, monkeypatch, Source, sleep=FakeSleep(clock))
    try:
        assert made == []  # nothing used it yet: not the auth, not the sync runner, not the check-in
        assert core.source.can_mint() is True
        assert core.source is core.source
        assert len(made) == 1 and made[0][0] is core.tokens
        core.source = "another"  # a test or the demo may hand the core a source
        assert core.source == "another" and len(made) == 1
    finally:
        core.store.close()


async def test_the_login_check_lists_accounts_through_the_lazy_source(tmp_path, clock, monkeypatch):
    class Source:
        def __init__(self, tokens, **options) -> None:
            pass

        async def list_accounts(self, cookies):
            return ["an account"]

    core = _live_core(tmp_path, clock, monkeypatch, Source, sleep=FakeSleep(clock))
    try:
        assert await core.auth._list_accounts({"made-up": "cookie"}) == ["an account"]
    finally:
        core.store.close()


async def test_a_start_answers_before_the_source_exists_and_the_sync_then_uses_it(tmp_path, clock, monkeypatch):
    built = threading.Event()
    fetched: list[str] = []

    class Source:
        def __init__(self, tokens, **options) -> None:
            time.sleep(1.5)  # the library's import, which the player's start must not wait for
            built.set()

        def can_mint(self) -> bool:
            return False

        async def fetch(self, group, *, now, first_time):
            assert built.is_set()
            fetched.append(group)
            raise Unexpected("made up")

    core = _live_core(tmp_path, clock, monkeypatch, Source, login=True)

    async def no_banners() -> None:  # the announcements' reads and the wiki's are other tests': none touches the network here
        return None

    core.banners.run = no_banners
    core.characters.wanted = lambda *keys: None
    core.characters.warm_art = lambda: None
    try:
        began = time.monotonic()
        core.start()
        ticks = 0
        while time.monotonic() - began < 0.6:  # the loop stays free while the library loads
            await asyncio.sleep(0.05)
            ticks += 1
        assert ticks >= 8 and not built.is_set()
        asked = time.monotonic()
        status, _ = core.status(), core._login_refresh_on()  # what the API's first answers ask of the core
        assert time.monotonic() - asked < 0.3 and not built.is_set()
        for _ in range(200):
            if fetched:
                break
            await asyncio.sleep(0.1)
        assert built.is_set() and fetched  # the startup sync waited for the source, and then used it
        assert status["mode"] == "live"
    finally:
        await core.stop()


async def test_a_source_that_cannot_be_made_says_so_once_and_is_not_tried_again(tmp_path, clock, monkeypatch, caplog):
    tries: list[int] = []

    class Source:
        def __init__(self, tokens, **options) -> None:
            tries.append(1)
            raise AttributeError("the library is not what was expected")  # must not look like a missing capability

    core = _live_core(tmp_path, clock, monkeypatch, Source, sleep=FakeSleep(clock))
    try:
        with caplog.at_level("ERROR", logger="guildboard.core"):
            for _ in range(3):
                with pytest.raises(SourceBuildFailed):
                    core.source  # noqa: B018
        assert tries == [1]
        assert len([record for record in caplog.records if record.levelname == "ERROR"]) == 1
        assert core.status()["sync"]["state"] == "login_needed"  # the pages still answer
    finally:
        core.store.close()
