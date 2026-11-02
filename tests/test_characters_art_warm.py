"""The art cache is warmed after a characters sync: the faces of the characters the player has first, then the large art of
those in the focus, then the rest, only after the player's consent, in the background, never in the demo."""
from __future__ import annotations

import asyncio
import dataclasses
from datetime import datetime, timezone

import pytest

import characters_samples as samples
from characters_service_support import build_record, keep_builds, keep_notes, make_service
from guildboard.characters.art import ArtCache
from guildboard.config import AppPaths
from support import FakeClock

NOW = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 40
HOST = "https://act-webstatic.hoyoverse.com/w"


class Downloads:
    def __init__(self) -> None:
        self.asked: list[str] = []

    def __call__(self, url: str, *, max_bytes: int | None = None, hosts=None) -> bytes:
        self.asked.append(url)
        return PNG + url.encode()[-6:]


@pytest.fixture
def clock():
    return FakeClock(NOW)


def seeded(store, clock, tmp_path, *, ready, demo=False):
    """Three characters the inventory leaves out (so each has her own pictures), "Ccc" in the focus."""
    records = [
        dataclasses.replace(
            build_record(samples.sandrone_build(), ident=n, name=name, element="Anemo", wiki_entry=None),
            icon=f"{HOST}/{name.lower()}-face.png", image=f"{HOST}/{name.lower()}-art.png",
        )
        for n, name in enumerate(("Aaa", "Bbb", "Ccc"), 1)
    ]
    keep_builds(store, clock.now(), records)
    keep_notes(store, clock.now())
    downloads = Downloads()
    art = ArtCache(store, AppPaths(tmp_path / "data"), clock, downloads, demo)
    art.warm_pause = 0
    service = make_service(store, clock, tmp_path, art=art, ready=ready)
    service._demo = demo
    store.put_focus(service.uid(), ["ccc"])
    return service, art, downloads


FACES = [f"{HOST}/{name}-face.png" for name in ("aaa", "bbb", "ccc")]
ARTS = [f"{HOST}/{name}-art.png" for name in ("ccc", "aaa", "bbb")]   # the focus first, then the rest


async def test_the_pictures_come_faces_first_then_the_focus_art_then_the_rest(store, clock, tmp_path):
    service, _, _ = seeded(store, clock, tmp_path, ready=lambda: True)
    assert service.art_to_warm() == FACES + ARTS


async def test_nothing_is_fetched_before_the_players_consent_and_then_one_picture_after_another(store, clock, tmp_path):
    consent = [False]
    service, art, downloads = seeded(store, clock, tmp_path, ready=lambda: consent[0])
    service.warm_art()
    await asyncio.sleep(0.05)
    assert downloads.asked == [] and not (tmp_path / "data" / "art").exists()
    consent[0] = True
    service.warm_art()
    await service._warmer
    assert downloads.asked == FACES + ARTS
    service.warm_art()  # again: everything is kept, so nothing is asked
    await service._warmer
    assert len(downloads.asked) == 6


async def test_the_warm_up_stops_at_the_cache_cap(store, clock, tmp_path):
    service, art, downloads = seeded(store, clock, tmp_path, ready=lambda: True)
    art.total_cap = 2 * (len(PNG) + 6) + 10   # two pictures fit, a third does not
    service.warm_art()
    await service._warmer
    assert downloads.asked == FACES[:3]   # the third is fetched, found not to fit and dropped; no fourth is asked for
    assert art.used() <= art.total_cap


async def test_the_demo_warms_nothing(store, clock, tmp_path):
    service, art, downloads = seeded(store, clock, tmp_path, ready=lambda: True, demo=True)
    service.warm_art()
    assert service._warmer is None and downloads.asked == []


async def test_a_finished_sync_starts_the_warm_up_and_a_wake_does_not(store, clock, tmp_path):
    service, art, downloads = seeded(store, clock, tmp_path, ready=lambda: True)
    gate = asyncio.Event()

    async def sleep(seconds: float) -> None:
        await gate.wait()

    service._sleep = sleep
    service._bus = bus = service._bus
    task = asyncio.create_task(service.run())
    for _ in range(50):
        await asyncio.sleep(0)
    assert downloads.asked == []          # the first look does not warm anything
    service.wake()
    for _ in range(50):
        await asyncio.sleep(0.001)
    assert downloads.asked == []          # nor does a wake
    bus.publish("sync_finished")
    for _ in range(100):
        await asyncio.sleep(0.01)
        if len(downloads.asked) == 6:
            break
    assert downloads.asked == FACES + ARTS
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await service.stop()


async def test_the_warm_up_waits_while_the_game_runs(store, clock, tmp_path):
    playing = [True]
    service, art, downloads = seeded(store, clock, tmp_path, ready=lambda: True)
    service._game_running = lambda: playing[0]
    waits: list[float] = []

    async def wait(seconds: float) -> None:
        waits.append(seconds)
        await asyncio.sleep(0)

    art.sleep = wait
    service.warm_art()
    for _ in range(20):
        await asyncio.sleep(0)
    assert downloads.asked == [] and waits and set(waits) == {art.game_pause}
    playing[0] = False
    await service._warmer
    assert downloads.asked == FACES + ARTS


def test_the_core_gives_the_warm_up_the_process_lists_answer(tmp_path):
    from guildboard.config import AppPaths
    from guildboard.core import Core

    names: set[str] = set()
    core = Core(AppPaths(tmp_path / "core"), demo=True, clock=FakeClock(NOW), process_lister=lambda: names)
    try:
        assert core.characters._game_running() is False
        names.add("genshinimpact.exe")
        core.gamewatch.poll_once()
        assert core.characters._game_running() is True
    finally:
        core.store.close()
