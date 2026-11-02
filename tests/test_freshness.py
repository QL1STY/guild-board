"""The notice that the game's history stopped updating: a link from Feedback lasts a day, and nothing else said so."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from guildboard.config import AppPaths
from guildboard.core import Core
from guildboard.freshness import STALE_AFTER, history_notice
from guildboard.tokenstore import StoredToken
from support import AccountSource, FakeClock, FakeSleep

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
FRESH = NOW - STALE_AFTER + timedelta(minutes=1)
OLD = NOW - timedelta(days=2, hours=1)
PLAYED = OLD + timedelta(hours=1)


def test_a_history_never_read_says_nothing():
    assert history_notice(None, PLAYED, NOW, "feedback") is None


def test_a_history_read_within_the_day_says_nothing():
    assert history_notice(FRESH, NOW, NOW, "failing") is None


def test_a_link_that_ran_out_says_what_to_do_once_the_player_has_played():
    assert history_notice(OLD, PLAYED, NOW, "feedback") == {
        "text": "Your primogems have not updated for 2 days. Open Feedback in the game, then press Import.",
        "page": "ledger",
    }


def test_nothing_is_missed_while_the_game_was_not_played():
    assert history_notice(OLD, OLD - timedelta(hours=1), NOW, "feedback") is None
    assert history_notice(OLD, None, NOW, "feedback") is None
    assert history_notice(OLD, None, NOW, "login") is None


def test_a_login_that_cannot_get_keys_asks_for_a_new_login():
    assert history_notice(OLD, PLAYED, NOW, "login") == {
        "text": "Your primogems have not updated for 2 days. Log in to HoYoLAB again in Settings, and they update by themselves.",
        "page": "settings",
    }


def test_updates_with_the_login_that_keep_failing_are_told_with_no_play_at_all():
    notice = history_notice(NOW - timedelta(days=1, hours=3), None, NOW, "failing")
    assert notice == {
        "text": "Your primogems have not updated for 1 day. The automatic update keeps failing. "
                "Open Feedback in the game, then press Import.",
        "page": "ledger",
    }


COOKIES = {"ltoken_v2": "v2_SECRET-VALUE-0123456789", "ltuid_v2": "1"}


class Source(AccountSource):
    def can_mint(self) -> bool:
        return False


def _core(tmp_path) -> tuple[Core, list[tuple[str, str]]]:
    clock = FakeClock(NOW)
    core = Core(
        AppPaths(tmp_path / "data"), demo=False, clock=clock, source=Source(), sleep=FakeSleep(clock),
        process_lister=lambda: set(),
    )
    core.settings.risk_acknowledged = True
    core.has_tray = True
    shown: list[tuple[str, str]] = []
    core.notifier = lambda kind, text: shown.append((kind, text)) or True
    return core, shown


def _read_on(core: Core, when: datetime) -> None:
    core.store.record_ledger_import(700000001, "primogem", when, 3, "ok", None)


def test_the_status_carries_the_notice_and_a_login_without_keys_is_told_to_log_in(tmp_path):
    core, _ = _core(tmp_path)
    assert core.status()["history_notice"] is None
    core.tokens.save(StoredToken(dict(COOKIES), 700000001, "os_euro", "Traveler"))
    _read_on(core, OLD)
    core.store.touch_session(core.store.open_session(PLAYED, False), PLAYED + timedelta(hours=1))
    assert core.status()["history_notice"]["page"] == "settings"
    core.store.close()


def test_a_notification_says_so_once_for_each_read_that_ran_out(tmp_path):
    core, shown = _core(tmp_path)
    _read_on(core, OLD)
    core.store.touch_session(core.store.open_session(PLAYED, False), PLAYED + timedelta(hours=1))
    core.tell_of_old_history()
    core.tell_of_old_history()
    assert [kind for kind, _ in shown] == ["history"]
    assert "Open Feedback in the game" in shown[0][1]
    _read_on(core, NOW)
    assert core.status()["history_notice"] is None
    core.store.close()


def test_the_demo_never_says_so(tmp_path):
    clock = FakeClock(NOW)
    core = Core(AppPaths(tmp_path / "data"), demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    assert core.status()["history_notice"] is None
    core.store.close()
