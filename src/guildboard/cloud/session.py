"""cloud.bin: the online account's session. It follows token.bin's rules: DPAPI, and never in a log, an API response, the
database, a test fixture or a commit (the online design, section 3)."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from guildboard.logging_setup import forget_secret, register_secret
from guildboard.tokenstore import protect, unprotect

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CloudSession:
    access_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    expires_at: float  # seconds since 1970, by this PC's clock (client.tokens_from)
    user_id: str
    name: str
    tag: str


def _mask_in_logs(session: CloudSession) -> None:
    register_secret(session.access_token)
    register_secret(session.refresh_token)


class CloudStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._tmp_path = path.with_name(path.name + ".tmp")
        self._cached: CloudSession | None = None
        self._loaded = False
        self._unwritten = False  # the session in memory is newer than the file's

    def save(self, session: CloudSession) -> None:
        """Keeps the session, in memory first, where every request reads it: a refresh token the server has rotated works
        once, so a file that cannot be written now (another program holding it) must not lose the new one. The next save
        writes the newest to the file. A save that fails says so, and leaves no second copy behind."""
        _mask_in_logs(session)
        if self._cached is not None:  # the session it replaces lets its tokens go, the ones kept still held by this one
            forget_secret(self._cached.access_token, self._cached.refresh_token)
        self._cached, self._loaded, self._unwritten = session, True, True
        payload = json.dumps(asdict(session)).encode("utf-8")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._tmp_path.write_bytes(protect(payload))
            os.replace(self._tmp_path, self._path)
        except BaseException:
            self._tmp_path.unlink(missing_ok=True)  # never leave a second copy of the session behind
            raise
        self._unwritten = False

    def flush(self) -> None:
        """Writes the session once more when its last save could not be written, so that the file does not keep a spent token."""
        if self._unwritten and self._cached is not None:
            try:
                self.save(self._cached)
            except OSError:
                log.warning("the online session's file could not be written")

    def load(self) -> CloudSession | None:
        if not self._loaded:
            self._cached, self._loaded = self._read(), True
        return self._cached

    def _read(self) -> CloudSession | None:
        try:
            cipher = self._path.read_bytes()
        except FileNotFoundError:
            return None
        except OSError:
            log.warning("the online session's file could not be opened; signing in again is needed")
            return None
        try:
            data = json.loads(unprotect(cipher).decode("utf-8"))
            session = CloudSession(
                str(data["access_token"]), str(data["refresh_token"]), float(data["expires_at"]), str(data["user_id"]),
                str(data["name"]), str(data["tag"]),
            )
        except (OSError, ValueError, KeyError, TypeError):
            log.warning("the stored online session could not be read; signing in again is needed")
            return None
        _mask_in_logs(session)
        return session

    def delete(self) -> None:
        self._path.unlink(missing_ok=True)
        self._tmp_path.unlink(missing_ok=True)  # a save that was interrupted may have left a copy
        self._cached, self._loaded, self._unwritten = None, True, False
