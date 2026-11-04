"""cloud.bin, the online account's session. It follows token.bin's rules: DPAPI, and never in the clear."""
import logging

import pytest

from guildboard import logging_setup
from guildboard.cloud import CLOUD_KEY, PIN_ORDER, SHARE_KEYS, SITE, STAT_KEYS
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.config import AppPaths
from guildboard.tokenstore import protect

ACCESS = "ACCESS-MARKER-0123456789"
REFRESH = "REFRESH-MARKER-0123456789"
SESSION = CloudSession(ACCESS, REFRESH, 1_800_000_000.5, "00000000-0000-0000-0000-00000000000a", "Nova", "5120")


@pytest.fixture(autouse=True)
def no_secrets_left():
    logging_setup.forget_secrets()
    yield
    logging_setup.forget_secrets()


def test_the_data_folder_names_the_file(tmp_path):
    assert AppPaths(tmp_path).cloud_path == tmp_path / "cloud.bin"


def test_the_constants():
    assert SITE == "https://tspjpcyhpkfetwzolzvi.supabase.co"
    assert CLOUD_KEY.startswith("sb_publishable_")
    assert SHARE_KEYS == ("status", "primogems", "playtime", "achievements", "endgame", "account", "wishes", "spending")
    assert STAT_KEYS == SHARE_KEYS[1:]
    assert PIN_ORDER == ("primogems", "playtime", "endgame", "achievements", "account", "wishes", "spending")


def test_a_session_comes_back(tmp_path):
    path = tmp_path / "cloud.bin"
    CloudStore(path).save(SESSION)
    assert CloudStore(path).load() == SESSION


def test_there_is_no_session_before_the_first_save(tmp_path):
    assert CloudStore(tmp_path / "cloud.bin").load() is None


def test_a_save_makes_its_folder(tmp_path):
    path = tmp_path / "new" / "cloud.bin"
    CloudStore(path).save(SESSION)
    assert CloudStore(path).load() == SESSION


def test_the_store_keeps_what_it_read(tmp_path):
    path = tmp_path / "cloud.bin"
    store = CloudStore(path)
    store.save(SESSION)
    path.unlink()
    assert store.load() == SESSION


def test_the_file_holds_no_token_in_the_clear(tmp_path):
    path = tmp_path / "cloud.bin"
    CloudStore(path).save(SESSION)
    data = path.read_bytes()
    assert ACCESS.encode() not in data
    assert REFRESH.encode() not in data
    assert b"access_token" not in data
    assert not list(tmp_path.glob("*.tmp"))


def test_a_session_never_shows_its_tokens():
    # The dataclass's own repr, which a careless log line or a traceback would print.
    text = repr(SESSION)
    assert ACCESS not in text and REFRESH not in text


@pytest.mark.parametrize("content", [
    b"copied from another computer, or simply damaged MARKER-IN-THE-FILE",
    protect(b"plain words MARKER-IN-THE-FILE"),
    protect(b'{"access_token": "MARKER-IN-THE-FILE"}'),
    protect(b'{"access_token": "MARKER-IN-THE-FILE", "refresh_token": "r", "expires_at": "soon", "user_id": "u", '
            b'"name": "n", "tag": "1"}'),
    protect(b"[1, 2]"),
], ids=["damaged", "plain words", "no refresh token", "a field of no kind", "a list"])  # DPAPI's bytes differ on each run
def test_an_unreadable_file_is_no_session(tmp_path, caplog, content):
    path = tmp_path / "cloud.bin"
    path.write_bytes(content)
    with caplog.at_level(logging.WARNING):
        assert CloudStore(path).load() is None
    assert path.exists()  # the file is left alone; signing in again replaces it
    assert [record.levelno for record in caplog.records] == [logging.WARNING]
    assert "MARKER-IN-THE-FILE" not in caplog.text


def test_delete_leaves_nothing(tmp_path):
    path = tmp_path / "cloud.bin"
    store = CloudStore(path)
    store.save(SESSION)
    (tmp_path / "cloud.bin.tmp").write_bytes(b"a copy a save left behind")
    store.delete()
    store.delete()
    assert store.load() is None
    assert list(tmp_path.iterdir()) == []


def test_a_save_that_fails_leaves_no_second_copy(tmp_path, monkeypatch):
    path = tmp_path / "cloud.bin"

    def refuse(*args):
        raise OSError("the disk is full")

    monkeypatch.setattr("guildboard.cloud.session.os.replace", refuse)
    with pytest.raises(OSError):
        CloudStore(path).save(SESSION)
    assert list(tmp_path.iterdir()) == []


def test_both_tokens_are_masked_in_the_log(tmp_path):
    path = tmp_path / "cloud.bin"
    CloudStore(path).save(SESSION)
    line = f"a careless line with {ACCESS} and {REFRESH}"
    assert logging_setup.redact(line) == "a careless line with [redacted] and [redacted]"


def test_a_rotated_token_is_no_longer_masked_and_the_ones_kept_still_are(tmp_path):
    # A refresh token is spent once the server rotates it; the log's mask, which has a cap, does not keep it for ever.
    store = CloudStore(tmp_path / "cloud.bin")
    store.load()
    store.save(SESSION)
    rotated = CloudSession(ACCESS, "ROTATED-REFRESH-0123456789", SESSION.expires_at, SESSION.user_id, "Nova", "5120")
    store.save(rotated)
    assert logging_setup.redact(f"{ACCESS} {REFRESH} {rotated.refresh_token}") == f"[redacted] {REFRESH} [redacted]"
    store.save(rotated)  # saved again as it is: nothing is let go
    store.save(CloudSession("NEXT-ACCESS-0123456789", rotated.refresh_token, 1.0, SESSION.user_id, "Nova", "5120"))
    assert logging_setup.redact(f"{ACCESS} {rotated.refresh_token} NEXT-ACCESS-0123456789") == (
        f"{ACCESS} [redacted] [redacted]"
    )


def test_both_tokens_are_masked_once_read_from_the_file(tmp_path):
    path = tmp_path / "cloud.bin"
    CloudStore(path).save(SESSION)
    logging_setup.forget_secrets()  # a new start: nothing is registered yet
    CloudStore(path).load()
    assert logging_setup.redact(f"{ACCESS} {REFRESH}") == "[redacted] [redacted]"
