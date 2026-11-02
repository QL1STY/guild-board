"""The HoYoLAB session token, encrypted with Windows DPAPI for the current Windows user (H4)."""
from __future__ import annotations

import ctypes
import json
import logging
import os
from ctypes import wintypes
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from guildboard.logging_setup import register_secret

log = logging.getLogger(__name__)

_crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


_BLOB_P = ctypes.POINTER(_Blob)
_crypt32.CryptProtectData.argtypes = [
    _BLOB_P, wintypes.LPCWSTR, _BLOB_P, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, _BLOB_P,
]
_crypt32.CryptProtectData.restype = wintypes.BOOL
_crypt32.CryptUnprotectData.argtypes = [
    _BLOB_P, ctypes.c_void_p, _BLOB_P, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, _BLOB_P,
]
_crypt32.CryptUnprotectData.restype = wintypes.BOOL
_kernel32.LocalFree.argtypes = [ctypes.c_void_p]
_kernel32.LocalFree.restype = ctypes.c_void_p

_ENTROPY = b"GuildBoard token v1"
_UI_FORBIDDEN = 0x1

# The cookies a HoYoLAB login is made of, as the login window and a pasted login hand them over (shell/cookies.py), and
# the older names of a login pasted from before HoYoLAB's v2 cookies.
SESSION_COOKIES = ("ltoken_v2", "ltuid_v2", "ltmid_v2", "cookie_token_v2", "account_id_v2", "account_mid_v2")
OLDER_SESSION_COOKIES = ("ltoken", "ltuid", "cookie_token", "account_id")
# What the stored login keeps of the cookies HoYoLAB sets later: those, and lrsag, which the mint of history keys takes
# beside the cookie token when the login has it (netpolicy.MINT_COOKIES).
LOGIN_COOKIES = (*SESSION_COOKIES, *OLDER_SESSION_COOKIES, "lrsag")
# The cookies that name the account a login is for.
ACCOUNT_COOKIES = ("ltuid_v2", "account_id_v2", "ltuid", "account_id")
# The cookies that are the login itself: a new login of the same account holds another.
LOGIN_TOKENS = ("ltoken_v2", "ltoken")


def _blob(data: bytes) -> tuple[_Blob, ctypes.Array]:
    """A DATA_BLOB pointing at `data`. The buffer is returned too, so the caller keeps it alive."""
    buffer = ctypes.create_string_buffer(data, len(data))
    return _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer


def _take(blob: _Blob) -> bytes:
    try:
        return ctypes.string_at(blob.pbData, blob.cbData)
    finally:
        _kernel32.LocalFree(ctypes.cast(blob.pbData, ctypes.c_void_p))


def protect(plain: bytes) -> bytes:
    source, _keep_source = _blob(plain)
    entropy, _keep_entropy = _blob(_ENTROPY)
    out = _Blob()
    ok = _crypt32.CryptProtectData(
        ctypes.byref(source), None, ctypes.byref(entropy), None, None, _UI_FORBIDDEN, ctypes.byref(out)
    )
    if not ok:
        raise OSError(ctypes.get_last_error(), "CryptProtectData failed")
    return _take(out)


def unprotect(cipher: bytes) -> bytes:
    source, _keep_source = _blob(cipher)
    entropy, _keep_entropy = _blob(_ENTROPY)
    out = _Blob()
    ok = _crypt32.CryptUnprotectData(
        ctypes.byref(source), None, ctypes.byref(entropy), None, None, _UI_FORBIDDEN, ctypes.byref(out)
    )
    if not ok:
        raise OSError(ctypes.get_last_error(), "CryptUnprotectData failed")
    return _take(out)


@dataclass(frozen=True)
class StoredToken:
    cookies: dict[str, str] = field(repr=False)  # the login itself: a printed token shows its account alone
    uid: int
    server: str
    nickname: str


def _mask_in_logs(token: StoredToken) -> None:
    """Every cookie value that exists on this PC is masked in the log, however it got here."""
    for value in token.cookies.values():
        register_secret(value)


class TokenStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._tmp_path = path.with_name(path.name + ".tmp")
        self._cached: StoredToken | None = None
        self._loaded = False

    def save(self, token: StoredToken) -> None:
        _mask_in_logs(token)
        payload = json.dumps(
            {"cookies": token.cookies, "uid": token.uid, "server": token.server, "nickname": token.nickname}
        ).encode("utf-8")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._tmp_path.write_bytes(protect(payload))
            os.replace(self._tmp_path, self._path)
        except BaseException:
            self._tmp_path.unlink(missing_ok=True)  # never leave a second copy of the token behind
            raise
        self._cached, self._loaded = token, True

    def load(self) -> StoredToken | None:
        if not self._loaded:
            self._cached, self._loaded = self._read(), True
        elif self._cached is not None:
            # Registered again at each read, so that they stay the newest of the log's mask, whose oldest values go
            # first past its cap (logging_setup.MOST_SECRETS).
            _mask_in_logs(self._cached)
        return self._cached

    def _read(self) -> StoredToken | None:
        try:
            cipher = self._path.read_bytes()
        except FileNotFoundError:
            return None
        except OSError:
            log.warning("the token file could not be opened; a new login is needed")
            return None
        try:
            data = json.loads(unprotect(cipher).decode("utf-8"))
            cookies = {str(name): str(value) for name, value in dict(data["cookies"]).items()}
            token = StoredToken(cookies, int(data["uid"]), str(data["server"]), str(data["nickname"]))
        except (OSError, ValueError, KeyError, TypeError):
            log.warning("the stored token could not be read; a new login is needed")
            return None
        _mask_in_logs(token)
        return token

    def update_cookies(self, cookies: Mapping[str, str], since: StoredToken | None = None) -> None:
        """Keep the cookies a HoYoLAB answer set. The library merges them into the cookies its client was made with and
        hands the whole lot over; of them the stored login keeps the cookies a login is made of alone, and only for its
        own account: an update that names another account, or none, is ignored. `since` is the login the client was
        made with. When the stored login holds another token than it does, and the answer holds another than the stored
        one too, the player logged in again while the client ran, the same account or not, and nothing of that answer
        is kept (an answer that holds the stored token is of that login, though the client was made before a rotation
        of it); else only the cookies the answer changed are taken."""
        current = self.load()
        if current is None:
            return
        offered = {name: value for name, value in cookies.items() if name in LOGIN_COOKIES and value}
        if any(offered.get(name) != value for name, value in current.cookies.items() if name in ACCOUNT_COOKIES):
            log.warning("HoYoLAB's answer set cookies of another login than the one stored; they are not kept.")
            return
        if since is not None:
            since_is_stored = all(since.cookies.get(name) == current.cookies.get(name) for name in LOGIN_TOKENS)
            answer_is_stored = any(
                offered.get(name) == current.cookies.get(name) for name in LOGIN_TOKENS if name in offered
            )
            if not (since_is_stored or answer_is_stored):
                log.info("HoYoLAB's answer set cookies of the login before the one stored; they are not kept.")
                return
            offered = {name: value for name, value in offered.items() if since.cookies.get(name) != value}
        kept = {name: value for name, value in current.cookies.items() if name in LOGIN_COOKIES} | offered
        if kept != current.cookies:
            self.save(StoredToken(kept, current.uid, current.server, current.nickname))

    def delete(self) -> None:
        self._path.unlink(missing_ok=True)
        self._tmp_path.unlink(missing_ok=True)  # a save that was interrupted may have left a copy
        self._cached, self._loaded = None, True
