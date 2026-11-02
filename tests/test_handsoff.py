"""The hands-off rules, enforced. If one of these fails, fix the code, not the test."""
import ast
import asyncio
import base64
import collections
import functools
import inspect
import json
import logging
import os
import re
import socket
import sqlite3
import subprocess
import sys
import time
import types
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

import guildboard
from achievement_samples import paimon_export
from cloud_fakes import FakeCloud, answer, token_answer
from guildboard import logging_setup, netpolicy
from guildboard.api.app import create_app
from guildboard.cloud.session import CloudSession, CloudStore
from guildboard.config import AppPaths, Settings, default_data_dir, save_settings, standard_data_dir
from guildboard.core import Core
from guildboard.logging_setup import setup_logging, shutdown_logging
from guildboard.characters.wiki import ENTRY_URL
from guildboard.pulls import gamecache, wishapi, wiki as wiki_urls
from guildboard.pulls.banners import ANN_CONTENT_URL, ANN_LIST_URL
from guildboard.records import FetchResult, GameAccount, RawResponse, Unexpected
from guildboard.shell import app as shell_app, startup as shell_startup
from guildboard.store import ProgressRow, Store
from guildboard.tokenstore import StoredToken, TokenStore
from guildboard.ledger import LEDGER_URL
from ledger_samples import Ledgers, csc_url, entry as ledger_entry
from pulls_samples import History, made_up_game, made_up_screenshots, record
from support import AccountSource, FakeSleep, FakeSource, beyond_this_pc, ok_result

SRC = Path(guildboard.__file__).resolve().parent
PORT = 4321
BASE = f"http://127.0.0.1:{PORT}"
MARKER = "v2_MARKER-TOKEN-0123456789-ABCDEFGH"
CSC_MARKER = "FEEDBACK-CSC-0123456789-ZYXWVUTS"  # a made-up key of the Feedback page's link
# The addresses a Feedback link's key may reach: the four history logs, and the account it belongs to.
LEDGER_ADDRESSES = ("GetPrimogemLog", "GetCrystalLog", "GetResinLog", "GetArtifactLog", "GetUserInfo")

# H2 and H3: Guild Board never opens a handle to the game, reads or writes its memory, injects into it, hooks it,
# sends it input or captures its screen, and no code path may locate the game's window. These functions (Windows',
# and Qt's and Pillow's for the screen) do one of those to another program, so none is named anywhere in
# src/guildboard, comments included.
FORBIDDEN_NAMES = (
    # Another process: a handle to it, its memory, its modules, a thread of ours inside it. Python's os.kill opens the
    # process its id names.
    "OpenProcess", "ReadProcessMemory", "WriteProcessMemory", "NtReadVirtualMemory", "CreateRemoteThread",
    "VirtualAllocEx", "Module32First", "MiniDumpWriteDump", "os.kill",
    # Input sent to another program or its windows, and hooks on what happens in them.
    "SetWindowsHookEx", "SetWinEventHook", "SendInput", "keybd_event", "mouse_event", "SetCursorPos", "BlockInput",
    "PostMessage", "PostThreadMessage", "SendMessage", "SendNotifyMessage", "AttachThreadInput",
    # The screen: each of these can capture the whole display, and the game with it.
    "BitBlt", "StretchBlt", "PrintWindow", "GetWindowDC", "GetDesktopWindow", "grabWindow", "ImageGrab",
    "GetDC", "GetPixel", "DuplicateOutput", "GraphicsCapture", "Graphics.Capture", "graphics.capture",
    "QScreenCapture", "QWindowCapture",
    # Finding or inspecting other windows.
    "FindWindow", "EnumWindows", "EnumChildWindows", "EnumThreadWindows", "EnumDesktopWindows",
    "GetForegroundWindow", "WindowFromPoint", "WindowFromPhysicalPoint", "GetTopWindow", "GetShellWindow",
    "GetGUIThreadInfo", "GetWindowThreadProcessId", "GetWindowText", "GetClassName", "GetWindowRect",
    # Qt's QLockFile opens the process a stale lock names: on Windows it calls OpenProcess on the id written in the
    # lock and reads that process's module name, and the id of a Guild Board that ended may belong to the game.
    # QSettings takes a QLockFile on every write of an INI file, and keeps its other format in the registry.
    "QLockFile", "QSettings",
)
# Bringing a window to the front activates it, and Guild Board never activates the game's window (spec 4). It only
# lets the Guild Board it hands over to come to the front itself, with AllowSetForegroundWindow (shell/instance.py).
FOREGROUND = r"(?<!Allow)SetForegroundWindow"

# H5: ways of making an outgoing request: importing a client library or calling one, opening a connection, or Qt's
# networking classes. Guild Board uses Qt's networking module only for the local socket of shell/instance.py and the
# login's cookies.
HTTP_CLIENT_PATTERNS = (
    r"^\s*(?:import|from)\s+(?:urllib\.request|http\.client|aiohttp|httpx2?|requests|websockets?)\b",
    r"^\s*from\s+http\s+import\s+\(?\s*(?:\w+\s*(?:as\s+\w+\s*)?,\s*)*client\b",
    r"\burlopen\(",
    r"\bbuild_opener\(",
    r"\bClientSession\(",
    r"\bcreate_connection\(",
    r"\bopen_connection\(",
    r"\burllib3\b",
    r"\b(?:QNetworkAccessManager|QTcpSocket|QSslSocket|QWebSocket|QUdpSocket)\b",
    r"\bHTTPS?Connection\(",
)
HTTP_MODULES = {"netpolicy.py", "sources/hoyolab.py"}
# A socket of Guild Board's own is made only for the local listener of __main__.py, bound to 127.0.0.1.
SOCKET_PATTERNS = (r"\bsocket\s*\.\s*socket\s*\(", r"^\s*from\s+socket\s+import\b")
SOCKET_MODULES = {"__main__.py"}
# The Pulls design (section 4, approved 2026-10-23): the two folder names appear only in the module that reads the game's
# log and web cache, read-only, on Import.
GAME_FOLDER_MODULES = {"pulls/gamecache.py"}

# Never anything in the game's install folder or its registry key. The game's folders, by the names of the two
# clients' data folders and of the install folder, and every way into the registry: Python's winreg, Windows'
# registry functions and their library, a registry path, and Qt's settings kept in the registry. Matched in any case,
# as Windows reads them. The install folder's name is too, except in "Genshin Impact game account", which the player
# reads in the login's sentences. The two data folders' names are allowed in GAME_FOLDER_MODULES alone; the install
# folder's name and every name of the registry stay forbidden there too.
GAME_FOLDER_NAMES = ("GenshinImpact_Data", "YuanShen_Data")
GAME_AND_REGISTRY_NAMES = (
    *GAME_FOLDER_NAMES,
    "winreg", "advapi32", "RegOpenKey", "RegSetValue", "RegCreateKey", "RegDeleteKey", "HKEY_", "NativeFormat",
)
INSTALL_FOLDER = re.compile(r"genshin impact game(?! account)", re.IGNORECASE)


def _sources() -> list[tuple[str, str]]:
    return [(path.relative_to(SRC).as_posix(), path.read_text(encoding="utf-8")) for path in sorted(SRC.rglob("*.py"))]


# Credit lines for the list's source, and the release notes, which say once that Astra's import is gone.
ASTRA_CREDITS = {"reference/achievements.json", "reference/achievement_notes.json", "reference/changes.json"}


def test_nothing_reads_astra_any_more():
    # Astra, the player's old app, is gone: no code, text or setting of Guild Board names it. What it once gave is in the
    # database already, and the list's two reference files still credit it as a source.
    found = []
    for root in (SRC, SRC.parents[1] / "web" / "src"):
        for path in sorted(root.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts or path.suffix in {".pyc", ".woff2", ".png", ".svg"}:
                continue
            name = path.relative_to(root).as_posix()
            if root == SRC and name in ASTRA_CREDITS:
                continue
            # "Astral" is the game's own word, as in the weapon Astral Vulture's Crimson Plumage (the Characters
            # inventory); "astra" anywhere else still counts.
            if re.search(rb"astra(?!l)", path.read_bytes().lower()):
                found.append(f"{root.name}/{name}")
    assert found == []


def test_the_scan_sees_the_package():
    names = {name for name, _ in _sources()}
    assert {
        "gamewatch.py", "netpolicy.py", "sources/hoyolab.py", "core.py", "api/app.py", "pulls/gamecache.py",
        "gallery.py",
    } <= names


def test_no_forbidden_windows_function_is_named_anywhere():
    for name, text in _sources():
        for forbidden in FORBIDDEN_NAMES:
            assert forbidden not in text, f"{forbidden} appears in {name}"
        assert not re.search(FOREGROUND, text), f"SetForegroundWindow appears in {name}"
    assert re.search(FOREGROUND, "user32.SetForegroundWindow(window)")
    assert not re.search(FOREGROUND, "user32.AllowSetForegroundWindow(pid)")


def test_only_two_modules_can_make_outgoing_requests():
    for name, text in _sources():
        patterns = (() if name in HTTP_MODULES else HTTP_CLIENT_PATTERNS) + (
            () if name in SOCKET_MODULES else SOCKET_PATTERNS
        )
        for pattern in patterns:
            assert not re.search(pattern, text, flags=re.MULTILINE), f"{pattern} appears in {name}"
    # The one socket of Guild Board's own: __main__.py's local listener, bound to 127.0.0.1.
    assert 'listener.bind(("127.0.0.1", port))' in dict(_sources())["__main__.py"]
    found = [
        any(re.search(pattern, text, flags=re.MULTILINE) for pattern in HTTP_CLIENT_PATTERNS + SOCKET_PATTERNS)
        for text in (
            "http.client.HTTPSConnection(host)", "socket.socket(socket.AF_INET)",
            "from socket import create_connection", "import socket\nsocket.gethostname()",
        )
    ]
    assert found == [True, True, True, False]
    # The http pattern looks for the client, not for every name in http.
    found = [
        any(re.search(pattern, text, flags=re.MULTILINE) for pattern in HTTP_CLIENT_PATTERNS) for text in (
            "from http import client", "from http import HTTPStatus, client as wire",
            "from http import (\n    cookies,\n    client,\n)", "from http import HTTPStatus",
            "from http import HTTPStatus\nclient = None",
        )
    ]
    assert found == [True, True, True, False, False]


# L33: every module that can open a connection, and the functions that do by name (asyncio's, and a loop's), as a module
# imports them, reaches them through a name it imported, or imports them by a string. Qt's networking module counts but
# for the names that open nothing beyond this PC: a cookie, and the local pipe of shell/instance.py. Only netpolicy.py
# and the HoYoLAB source reach any of them, and __main__.py the socket of its local listener. The regex scan above is
# the second net.
CONNECTING_MODULES = (
    "socket", "ssl", "socketserver", "http.client", "http.server", "urllib.request", "urllib.robotparser", "ftplib",
    "smtplib", "poplib", "imaplib", "nntplib", "telnetlib", "xmlrpc", "wsgiref.simple_server",
    "multiprocessing.connection", "multiprocessing.managers", "aiohttp", "httpx", "httpx2", "httpcore", "httpcore2",
    "requests", "urllib3", "websocket", "websockets", "genshin", "PySide6.QtNetwork", "PySide6.QtWebSockets",
    "PySide6.QtNetworkAuth", "PySide6.QtHttpServer",
    "truststore",  # changes whose roots every TLS connection trusts, so it is named where it is used, once (the audit's L37)
)
CONNECTING_FUNCTIONS = {
    "open_connection", "open_unix_connection", "create_connection", "create_unix_connection", "create_datagram_endpoint",
    "sock_connect", "getaddrinfo", "getnameinfo", "start_server", "start_unix_server", "create_server",
}
QT_LOCAL_NAMES = {"QNetworkCookie", "QLocalServer", "QLocalSocket"}
# Windows' own networking libraries, which ctypes could load and call: sockets, WinHTTP, WinINet and URL Moniker's
# downloads, the older socket library, name lookups and the HTTP server API. Named as ctypes.<library>, by a loader's
# string or by the attribute ctypes.windll gives for one.
NETWORK_LIBRARIES = {"ws2_32", "winhttp", "wininet", "urlmon", "wsock32", "dnsapi", "httpapi"}
LIBRARY_LOADERS = {"WinDLL", "CDLL", "OleDLL", "PyDLL", "LoadLibrary"}
CONNECTING_ALLOWED: dict[str, set[str] | None] = {"netpolicy.py": None, "sources/hoyolab.py": None, "__main__.py": {"socket", "truststore"}}


def _dotted(node: ast.expr, aliases: dict[str, str]) -> str:
    """The dotted name an attribute chain spells, its first name read through the module's imports, so that `import
    urllib as u` then `u.request.urlopen` is urllib.request.urlopen. A chain on anything else, a name the module did not
    import (a variable, such as shell/instance.py's local `socket`) or a call, is its attributes alone."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name) and node.id in aliases:
        parts.append(aliases[node.id])
    return ".".join(reversed(parts))


def _connecting(dotted: str) -> str | None:
    """The module, or the function, that can open a connection which `dotted` is or lies inside; None when none is."""
    parts = dotted.split(".")
    if parts[-1] in CONNECTING_FUNCTIONS:
        return dotted
    if parts[0] == "ctypes" and parts[-1] in NETWORK_LIBRARIES:
        return dotted
    for end in range(1, len(parts) + 1):
        if ".".join(parts[:end]) in CONNECTING_MODULES:
            if parts[:end] == ["PySide6", "QtNetwork"] and end < len(parts) and parts[end] in QT_LOCAL_NAMES:
                return None
            return ".".join(parts[:end])
    return None


def _connections(text: str) -> set[str]:
    """What a module's source reaches that can open a connection: each module imported, and each name imported from
    one; each attribute chain, read through the names the module imported; each module imported by a string, given
    first or as `name=`; and each of Windows' networking libraries loaded through ctypes."""
    tree = ast.parse(text)
    aliases: dict[str, str] = {}
    named: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.partition(".")[0]
                aliases[alias.asname or top] = alias.name if alias.asname else top
                named.append(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            for alias in node.names:
                aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
                named.append(f"{node.module}.{alias.name}")
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            named.append(_dotted(node, aliases))
            if node.attr.lower() in NETWORK_LIBRARIES:  # ctypes.windll.ws2_32, oledll.urlmon
                named.append(f"ctypes.{node.attr.lower()}")
        elif isinstance(node, ast.Call):
            called = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            given = [arg.value for arg in node.args[:1] if isinstance(arg, ast.Constant)]
            given += [kw.value.value for kw in node.keywords if kw.arg == "name" and isinstance(kw.value, ast.Constant)]
            if called in ("import_module", "__import__"):
                named.extend(str(value) for value in given)
            elif called in LIBRARY_LOADERS:  # a library by its name or its path, with or without ".dll"
                named.extend(
                    "ctypes." + re.split(r"[\\/]", str(value))[-1].lower().removesuffix(".dll") for value in given
                )
    return {found for found in map(_connecting, named) if found is not None}


CONNECTION_BYPASSES = (
    "from urllib import request\nrequest.urlretrieve('https://example.invalid/', 'x')",
    "import urllib\nurllib.request.urlretrieve('https://example.invalid/', 'x')",
    "import urllib.parse\nurllib.request.urlopen('https://example.invalid/')",
    "import socket as sk\nsk.socket()",
    "import ftplib", "import smtplib", "import poplib", "import imaplib", "import xmlrpc.client", "import telnetlib",
    "import nntplib", "from xmlrpc import client", "import ssl", "import socketserver", "import http.server",
    "import asyncio\nasyncio.open_connection('example.invalid', 443)",
    "import asyncio as aio\nreader = aio.open_connection",
    "loop.create_connection(protocol, 'example.invalid', 443)",
    "asyncio.get_running_loop().getaddrinfo('example.invalid', 443)", "from asyncio import open_connection",
    "from PySide6 import QtNetwork", "import PySide6.QtNetwork",
    "from PySide6.QtNetwork import QNetworkAccessManager", "from PySide6.QtNetwork import *",
    "from PySide6.QtWebSockets import QWebSocket", "import httpx", "import requests", "import urllib3",
    "import websockets", "import aiohttp", "import genshin", "import truststore", "from truststore import SSLContext",
    "importlib.import_module('socket')", "__import__('ssl')",
    "from PySide6.QtNetworkAuth import QOAuth2AuthorizationCodeFlow", "from PySide6.QtHttpServer import QHttpServer",
    "from wsgiref.simple_server import make_server", "import urllib.robotparser",
    "from multiprocessing.managers import BaseManager", "importlib.import_module(name='socket')",
    "import ctypes\nctypes.WinDLL('ws2_32')", "import ctypes\nctypes.windll.wininet.InternetOpenW(None, 0, None, None, 0)",
    "from ctypes import windll\nwindll.urlmon.URLDownloadToFileW(None, url, path, 0, None)",
    "ctypes.CDLL(name='winhttp.dll')", "ctypes.windll.LoadLibrary('C:\\\\Windows\\\\System32\\\\WS2_32.dll')",
    "import ctypes\nctypes.WinDLL('wsock32')", "import ctypes\nctypes.windll.dnsapi.DnsQuery_W(name, 1, 0, None, None, None)",
    "import ctypes\nctypes.CDLL('httpapi.dll')",
)


def test_only_netpolicy_and_the_hoyolab_source_import_what_can_open_a_connection():
    # L33: the regex scan above misses ordinary ways in, such as `from urllib import request` or `import socket as sk`.
    # This one reads each module's tree: no module but the three reaches anything that can open a connection, and
    # those three reach only what they are allowed.
    sources = dict(_sources())
    for name, text in sources.items():
        allowed = CONNECTING_ALLOWED.get(name, set())
        if allowed is not None:
            assert _connections(text) - allowed == set(), name
    # The allowances are used, and the scan sees what they are for.
    assert {"http.client", "urllib.request"} <= _connections(sources["netpolicy.py"])
    assert {"aiohttp", "genshin"} <= _connections(sources["sources/hoyolab.py"])
    assert _connections(sources["__main__.py"]) == {"socket", "truststore"}
    # Each way in is found, and what opens nothing is left alone.
    for text in CONNECTION_BYPASSES:
        assert _connections(text), text
    for text in (
        "from urllib.parse import urlsplit", "import urllib.parse\nurllib.parse.quote('x')",
        "from urllib.error import HTTPError", "from http import HTTPStatus", "import http\nhttp.HTTPStatus.OK",
        "from PySide6.QtNetwork import QNetworkCookie, QLocalServer, QLocalSocket",
        "from PySide6.QtNetwork import QLocalSocket\nQLocalSocket.LocalSocketState.ConnectedState",
        "import asyncio\nasyncio.sleep(1)", "from importlib import resources\nresources.files('guildboard')",
        "listener.socket_name = 'x'", "from guildboard import netpolicy\nnetpolicy.fetch_bytes(url)",
        "import ctypes\nctypes.WinDLL('crypt32', use_last_error=True)", "ctypes.windll.user32.MessageBeep(0)",
        "importlib.import_module(name='guildboard.codes')",
    ):
        assert _connections(text) == set(), text


def test_the_only_addresses_outside_hoyoverse_are_the_list_the_updates_and_the_cloud():
    assert netpolicy.ALLOWED_DOMAINS == ("hoyolab.com", "hoyoverse.com", "mihoyo.com")
    assert netpolicy.ALLOWED_URLS == (
        "https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/achievement/en.json",
    )
    # The installed copy's updates (the player's choice, 2026-10-25): the player's own releases repository, its newest
    # release and its installers' assets, and GitHub's download host for those alone.
    assert netpolicy.LATEST_RELEASE_URL == "https://api.github.com/repos/QL1STY/guild-board-releases/releases/latest"
    assert netpolicy.INSTALLER_ASSET.pattern == (
        r"https://api\.github\.com/repos/QL1STY/guild\-board\-releases/releases/assets/[0-9]+"
    )
    assert netpolicy.DOWNLOAD_HOSTS == ("release-assets.githubusercontent.com", "objects.githubusercontent.com")
    # The online features (the online design, section 3): one exact host, the player's Supabase project, and of it the
    # Auth and REST paths alone. A fork changes the host and pins its own here.
    assert netpolicy.CLOUD_HOST == "tspjpcyhpkfetwzolzvi.supabase.co"
    assert netpolicy.CLOUD_PATHS == ("/auth/v1/", "/rest/v1/")


# H4 (the audit of 2026-11-01): an installed Guild Board offers an update only when its installer comes with a signature
# by the player's release key, whose public half the app pins. The key is made once with tools/make-release-key.ps1,
# which prints the line for both places, and it changes only on purpose, here and in selfupdate.py together. While it is
# empty no update is offered, and release.ps1 publishes nothing.
RELEASE_KEY = "044d6934e90d6bf5628c147472250a93be80b6dc69af5476df335a7b9380acc6b101d92a01f0eb46b3dee516ebcae864ff3c8cab86b3ab56574d2474821fc124ba"


def test_an_update_is_offered_only_with_a_signature_by_the_pinned_release_key():
    from guildboard import selfupdate

    assert selfupdate.RELEASE_KEY == RELEASE_KEY
    assert RELEASE_KEY == "" or re.fullmatch(r"04[0-9a-f]{128}", RELEASE_KEY)  # P-256's uncompressed point, in hex
    # The check uses the pinned key unless a test gives it another.
    assert inspect.signature(selfupdate.newer_release).parameters["key"].default == RELEASE_KEY
    assert inspect.signature(selfupdate.Updater).parameters["key"].default == RELEASE_KEY
    # Windows' own CNG checks the signature: no library of the release's choosing is trusted with it.
    assert "BCryptVerifySignature" in (SRC / "selfupdate.py").read_text(encoding="utf-8")


def _from_netpolicy(name: str) -> str:
    """netpolicy's `name`, used through the module or imported from it."""
    return rf"\bnetpolicy\s*\.\s*{name}\b|^\s*from\s+[\w.]*netpolicy\s+import\s+(?:\([^)]*|[^\n(]*)\b{name}\b"


# Outside netpolicy.py, the list's address and the wide address check, which lets it through, are named only where
# they are used, as built: the list update downloads the list from its address, the core builds that download, and the
# icon cache downloads HoYoverse's icons behind is_hoyoverse. The HoYoLAB client checks with check_hoyoverse. Nothing
# calls netpolicy's check, is_allowed or _open from outside. Another use needs a change here (spec 4).
WIDE_ADDRESS_NAMES = {
    r"\bACHIEVEMENT_LIST_URL\b": {"achievements/updates.py"},
    r"\bgithub_fetch\b": {"achievements/updates.py", "core.py"},
    # characters/art.py: The Characters design, H6: the art cache, 8 MB a picture.
    r"\bfetch_bytes\b": {"achievements/updates.py", "api/icons.py", "characters/art.py"},
    r"\bfetch_latest_release\b": {"selfupdate.py"},
    r"\bdownload_installer\b": {"selfupdate.py"},
    r"\bfetch_cloud\b": {"cloud/client.py"},
    r"\bis_allowed\b": set(),
    _from_netpolicy("check"): set(),
    _from_netpolicy("_open"): set(),
}


def test_the_lists_address_and_the_wide_address_check_are_named_only_where_they_are_used():
    for pattern, used_in in WIDE_ADDRESS_NAMES.items():
        named = {
            name for name, text in _sources()
            if name != "netpolicy.py" and re.search(pattern, text, flags=re.MULTILINE)
        }
        assert named == used_in, pattern
    # The netpolicy patterns find what they look for, and not check_hoyoverse or the list update's own check.
    found = [
        bool(re.search(_from_netpolicy("check"), text, flags=re.MULTILINE)) for text in (
            "netpolicy.check(url)", "from guildboard.netpolicy import HostNotAllowed, check",
            "from .netpolicy import (\n    HostNotAllowed,\n    check,\n)",
            "netpolicy.check_hoyoverse(url)", "from guildboard.netpolicy import check_hoyoverse", "core.lists.check()",
        )
    ]
    assert found == [True, True, True, False, False, False]


def test_the_calculator_auth_names_appear_nowhere():
    # The Characters design, H2: the calculator is read as the player set it up. The name of the library's call that
    # switches its sync on, and the address it posts to, are written nowhere in src/guildboard, comments included.
    for name, text in _sources():
        for forbidden in ("_enable_calculator_sync", "avatar/auth"):
            assert forbidden not in text, f"{forbidden} appears in {name}"


def test_fetch_bytes_in_the_art_cache_is_used_not_forgotten():
    # The Characters design, H6: the art cache downloads pictures through netpolicy's fetch_bytes, up to 8 MB, and the
    # allowance in WIDE_ADDRESS_NAMES is for this module alone, which must use it. The core gives the cache that download
    # through the cache's own function, never by naming it.
    sources = dict(_sources())
    art = sources["characters/art.py"]
    assert re.search(r"from guildboard\.netpolicy import fetch_bytes as _download\b", art)
    assert re.search(r"def live_download\(\)[^\n]*\n(?:[^\n]*\n)*?\s+return _download\b", art)
    assert "characters/art.py" in WIDE_ADDRESS_NAMES[r"\bfetch_bytes\b"]
    assert "live_download()" in sources["core.py"] and not re.search(r"\bfetch_bytes\b", sources["core.py"])
    # And holds every download to the five picture hosts, redirects included (the audit's NET-8).
    assert "hosts=ART_HOSTS" in art


def test_genshin_is_imported_in_one_module_only():
    for name, text in _sources():
        if name == "sources/hoyolab.py":
            continue
        assert not re.search(r"^\s*(import genshin|from genshin)\b", text, flags=re.MULTILINE), name


def test_no_registry_and_no_game_folder_access():
    for name, text in _sources():
        for forbidden in GAME_AND_REGISTRY_NAMES:
            if name in GAME_FOLDER_MODULES and forbidden in GAME_FOLDER_NAMES:
                continue  # the module that reads the game's log and web cache names the folders it looks for
            assert forbidden.casefold() not in text.casefold(), f"{forbidden} appears in {name}"
        assert not INSTALL_FOLDER.search(text), f"the install folder's name appears in {name}"
    # That module does name both, and the allowance is for no other module.
    sources = dict(_sources())
    for name in GAME_FOLDER_MODULES:
        for folder_name in GAME_FOLDER_NAMES:
            assert folder_name.casefold() in sources[name].casefold(), f"{folder_name} does not appear in {name}"
    found = [bool(INSTALL_FOLDER.search(text)) for text in (
        "Genshin Impact Game", r"C:\Program Files\HoYoPlay\games\Genshin Impact game\GenshinImpact.exe",
        "This HoYoLAB account has no Genshin Impact game account.",
    )]
    assert found == [True, True, False]


# ---------------------------------------------------------------- H1: where files are written

_written: list[str] = []
# And every opening for reading of the one file named here, and of every file inside the one folder named here (a
# made-up game's), for the tests of when they are read.
_reads: list[str] = []
_read_under: str | None = None
_watching = False
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _file_key(path: str | bytes | os.PathLike) -> str:
    return os.path.normcase(os.path.abspath(os.fsdecode(path)))


def _audit(event: str, args: tuple) -> None:
    if not _watching:
        return
    try:
        if event == "open":
            path, mode, flags = args[0], args[1], args[2]
            writes = any(letter in mode for letter in "wax+") if isinstance(mode, str) else bool(flags & _WRITE_FLAGS)
            if writes and isinstance(path, (str, bytes, os.PathLike)):
                _written.append(os.fsdecode(path))
            elif not writes and isinstance(path, (str, bytes, os.PathLike)):
                key = _file_key(path)
                if _read_under is not None and key.startswith(_read_under + os.sep):
                    _reads.append(os.fsdecode(path))
        elif event == "sqlite3.connect":
            _written.append(os.fsdecode(args[0]))
        elif event in ("os.mkdir", "os.remove", "os.rmdir"):
            _written.append(os.fsdecode(args[0]))
        elif event == "os.rename":
            _written.extend(os.fsdecode(part) for part in args[:2])
    except Exception:  # an audit hook must never raise
        pass


sys.addaudithook(_audit)  # audit hooks cannot be removed; `_watching` switches this one off


def _wait_until_idle(client) -> None:
    for _ in range(200):
        if client.get("/api/status").json()["sync"]["state"] != "syncing":
            return
        time.sleep(0.01)
    raise AssertionError("the sync did not finish")


def _inside(path: str, folder: Path) -> bool:
    try:
        return Path(path).resolve().is_relative_to(folder.resolve())
    except (OSError, ValueError):
        return False


def _pulls_pages(app) -> list[str]:
    """The Pulls page's routes the core answers (GET): /api/pulls and /api/pulls/history, the planner's."""
    return sorted(
        route.path for route in app.routes
        if route.path.startswith("/api/pulls") and "GET" in getattr(route, "methods", ())
    )


def _characters_pages(app) -> list[str]:
    """The Characters pages' routes the core answers (GET): the roster, a character's profile and planner (for Sandrone, in
    the demo), the week and the endgame. Their pictures, at /api/art, are not pages."""
    return sorted(
        route.path.replace("{key}", "sandrone") for route in app.routes
        if (route.path.startswith("/api/characters") or route.path in ("/api/week", "/api/endgame"))
        and "GET" in getattr(route, "methods", ())
    )


def _wait_for_the_import(core) -> None:
    for _ in range(1000):
        if not core.wish_import.running:
            return
        time.sleep(0.01)
    raise AssertionError("the import did not end")


def test_a_demo_session_writes_only_inside_its_data_folder(tmp_path, clock):
    global _watching
    data = tmp_path / "data"
    _written.clear()
    _watching = True
    try:
        paths = AppPaths(data)
        paths.ensure()
        setup_logging(paths.logs_dir)
        core = Core(paths, demo=True, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            # The Characters pages are read too: the demo's own characters, from its own data folder, nothing of the game's.
            assert len(_characters_pages(client.app)) == 5
            for url in ("/api/status", "/api/backlog", "/api/stats?range=90", "/api/synclog", "/api/settings",
                        "/api/achievements", *_pulls_pages(client.app), *_characters_pages(client.app)):
                assert client.get(url).status_code == 200, url
            # The demo's import runs on its stand-ins: it reads no file of the game's, and writes only its history.
            assert client.post("/api/pulls/import").json() == {"started": True}
            _wait_for_the_import(core)
            assert core.wish_import.state()["state"] == "done"
            assert client.post("/api/achievements/stage/84508", json={"pinned": False}).status_code == 200
            checked = client.post("/api/achievements/list/check")
            assert checked.status_code == 200
            installed = client.post("/api/achievements/list/install", json={"sha256": checked.json()["sha256"]})
            assert installed.status_code == 200
            assert client.get("/api/achievements/list").json()["version"] == "7.2"  # the demo's newer list is in
            assert client.post("/api/sync").json()["started"] is True
            _wait_until_idle(client)
            client.put("/api/settings", json={"in_session_interval_min": 30})
            client.post("/api/sync/pause")
            client.post("/api/backup")
        core.store.close()
    finally:
        _watching = False
        shutdown_logging()
    outside = [
        path for path in _written
        if not _inside(path, data) and "__pycache__" not in path and not path.endswith(".pyc")
    ]
    assert outside == []
    # The trace did see the session's own writes: the backup it asked for, which setting up the folder and the log,
    # traced too, would not show.
    assert any(
        _inside(path, paths.backups_dir) and Path(path).name.startswith("guildboard-manual-") for path in _written
    )


_LIVE_START = """
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[2])  # the tests folder
import test_handsoff as checks

from guildboard.config import AppPaths
from guildboard.core import Core

checks._watching = True
core = Core(AppPaths(Path(sys.argv[1])), demo=False, process_lister=lambda: set())
core.store.close()
checks._watching = False
print(json.dumps(checks._written))
"""


def test_a_live_start_writes_only_inside_its_data_folder(tmp_path):
    # In a process of its own: the HoYoLAB library picks its cache folder, and writes, when it is first imported.
    data = tmp_path / "data"
    script = tmp_path / "live_start.py"
    script.write_text(_LIVE_START, encoding="utf-8")
    done = subprocess.run(
        [sys.executable, str(script), str(data), str(Path(__file__).resolve().parent)],
        capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stderr
    written = json.loads(done.stdout.strip().splitlines()[-1])
    outside = [
        path for path in written
        if not _inside(path, data) and "__pycache__" not in path and not path.endswith(".pyc")
    ]
    assert outside == []
    assert any(_inside(path, data) for path in written)


_QT_PLACES = """
from PySide6.QtCore import QCoreApplication, QStandardPaths

QCoreApplication.setApplicationName("Guild Board")
QCoreApplication.setOrganizationName("")
for kind in ("AppDataLocation", "AppLocalDataLocation", "AppConfigLocation", "CacheLocation"):
    print(QStandardPaths.writableLocation(getattr(QStandardPaths.StandardLocation, kind)))
"""


def _qt_places(env: dict[str, str]) -> list[Path]:
    """Where Qt, and Qt WebEngine with it, would keep files for an application named Guild Board in a run with this
    environment. Windows names these places in the profile folder, which conftest.py moves into the test's own, and it
    keeps its answer for the rest of a process: so they are asked in a process of their own, with the run's environment."""
    done = subprocess.run([sys.executable, "-c", _QT_PLACES], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    return [Path(line) for line in done.stdout.splitlines()]


def test_guild_board_with_its_window_writes_only_inside_its_data_folder(tmp_path):
    # Qt writes from C++, out of sight of the trace above. So this runs Guild Board with its window in a process
    # of its own, quits it the way the setup script does, and looks where Qt and the temporary files would be.
    temp = tmp_path / "temp"
    temp.mkdir()
    data = tmp_path / "data"
    env = dict(os.environ, QT_QPA_PLATFORM="offscreen", TEMP=str(temp), TMP=str(temp))
    places = [place for place in _qt_places(env) if not place.exists()]
    command = [sys.executable, "-m", "guildboard", "--demo", "--data-dir", str(data)]
    # The browser's own messages go nowhere: a pipe nobody reads would fill up and stop Guild Board.
    shell = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        log = data / "logs" / "guildboard.log"
        deadline = time.monotonic() + 60
        while not (log.exists() and "Guild Board is running" in log.read_text(encoding="utf-8", errors="replace")):
            assert shell.poll() is None and time.monotonic() < deadline, "Guild Board did not start"
            time.sleep(0.1)
        time.sleep(3)  # the window shows the interface
        quitter = subprocess.run(command + ["--quit"], env=env, capture_output=True, text=True, timeout=90)
        assert quitter.returncode == 0, quitter.stdout + quitter.stderr
        assert shell.wait(timeout=60) == 0
    finally:
        if shell.poll() is None:
            shell.kill()
            shell.wait(10)
    assert [place for place in places if place.exists()] == []
    assert list(temp.rglob("*")) == []
    # Nor in the folders APPDATA and LOCALAPPDATA named for this run (conftest.py), which Qt's places above do not follow.
    # (The profile folder USERPROFILE names is where the graphics driver keeps its shader cache, so it may exist.)
    named = [Path(env["APPDATA"]), Path(env["LOCALAPPDATA"])]
    assert [folder for folder in named if not folder.is_relative_to(tmp_path) or folder.exists()] == []
    assert Path(env["USERPROFILE"]).is_relative_to(tmp_path)  # the run could not find the player's own profile folder
    assert (data / "window.json").exists()  # the run did happen: quitting kept the window's place


# ---------------------------------------------------------------- H4: the token stays in token.bin

class LeakySource(FakeSource):
    """A source that carelessly puts the cookie value into an error message and into a response body."""

    async def list_accounts(self, cookies):
        return [GameAccount(700000001, "Traveler", "os_euro", 60)]


def test_the_token_never_reaches_a_log_a_response_or_the_database(tmp_path, clock):
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    logging_setup.forget_secrets()
    setup_logging(paths.logs_dir)
    bodies: list[str] = []
    try:
        TokenStore(paths.token_path).save(
            StoredToken(
                {"ltoken_v2": MARKER, "ltuid_v2": "123456789", "ltmid_v2": "1a2b3c4d5e_hy"},
                700000001, "os_euro", "Traveler",
            )
        )
        source = LeakySource()
        source.will("notes", Unexpected(f"something odd happened with {MARKER}"))
        echoed = RawResponse("index", {"echo": f"your cookie is {MARKER}"})
        source.will("overview", FetchResult("overview", clock.now(), (echoed,), ok_result("overview", clock.now()).record))
        core = Core(paths, demo=False, clock=clock, source=source, sleep=FakeSleep(clock), process_lister=lambda: set())
        logging.getLogger("guildboard.test").warning("a careless log line with %s", MARKER)
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            bodies.append(client.post("/api/sync").text)
            _wait_until_idle(client)
            for url in ("/api/status", "/api/backlog", "/api/stats", "/api/synclog", "/api/settings"):
                response = client.get(url)
                assert response.status_code == 200
                bodies.append(response.text)
            bodies.append(client.post("/api/backup").text)
        core.store.close()
    finally:
        shutdown_logging()
        logging_setup.forget_secrets()
    log_text = (paths.logs_dir / "guildboard.log").read_text(encoding="utf-8")
    assert MARKER not in log_text
    assert "[redacted]" in log_text
    assert all(MARKER not in body for body in bodies)
    assert any("[redacted]" in body for body in bodies)  # the leaked message was stored, masked
    for file in paths.data_dir.rglob("*"):
        if file.is_file():
            assert MARKER.encode() not in file.read_bytes(), file.name
    # The raw archive is compressed, so the byte scan above cannot see inside it.
    archive = sqlite3.connect(paths.db_path)
    try:
        archived = [zlib.decompress(row[0]).decode("utf-8") for row in archive.execute("SELECT body FROM raw_responses")]
    finally:
        archive.close()
    assert archived and all(MARKER not in body for body in archived)
    assert any("[redacted]" in body for body in archived)  # the echoed cookie was stored, masked


ONLINE_ACCESS = "ONLINE-ACCESS-MARKER-0123456789"  # made up, as a test's tokens are
ONLINE_REFRESH = "ONLINE-REFRESH-MARKER-0123456789"


def test_the_online_session_never_reaches_a_log_a_response_or_the_database(tmp_path, clock):
    # The online design, section 3: the account's session follows the token's rules. A live core signed in with made-up
    # tokens in cloud.bin, and a server that carelessly says the token back in a failure's body.
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    logging_setup.forget_secrets()
    setup_logging(paths.logs_dir)
    bodies: list[str] = []
    online_rows = FakeCloud({
        ("GET", "/rest/v1/profiles"): [
            answer(500, {"echo": f"your token is {ONLINE_ACCESS}"}), answer(400, {"message": f"refused {ONLINE_REFRESH}"}),
            answer(200, [{"name": "Nova", "discriminator": "5120"}]),
        ],
        ("POST", "/rest/v1/rpc/delete_my_account"): answer(400, {"message": f"refused {ONLINE_ACCESS}"}),
        ("POST", "/rest/v1/rpc/friends_overview"): answer(400, {"message": f"refused {ONLINE_REFRESH}"}),
        ("POST", "/auth/v1/logout"): answer(500, {"echo": ONLINE_REFRESH}),
    })
    try:
        CloudStore(paths.cloud_path).save(
            CloudSession(ONLINE_ACCESS, ONLINE_REFRESH, clock.now().timestamp() + 3600, "made-up-user", "Nova", "5120")
        )
        logging_setup.forget_secrets()  # a new start: the file alone has to be enough
        core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                    process_lister=lambda: set(), cloud_fetch=online_rows, open_browser=lambda address: None)
        logging.getLogger("guildboard.test").warning("a careless log line with %s and %s", ONLINE_ACCESS, ONLINE_REFRESH)
        heard = core.bus.subscribe()
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            for _ in range(3):  # the server's failures first, then the look that works
                client.portal.call(core.online.look)
            for url in (
                "/api/online", "/api/status", "/api/settings", "/api/backlog", "/api/stats", "/api/synclog", "/api/profile",
                "/api/friends",
            ):
                response = client.get(url)
                assert response.status_code == 200
                bodies.append(response.text)
            bodies.append(client.post("/api/online/sign-in").text)
            bodies.append(client.post("/api/online/delete", json={"confirm": True}).text)
            bodies.append(client.portal.call(_hello, client.app))
            bodies.append(client.post("/api/backup").text)
            while not heard.empty():
                bodies.append(json.dumps(heard.get_nowait()))
            bodies.append(client.post("/api/online/sign-out").text)
        core.store.close()
    finally:
        shutdown_logging()
        logging_setup.forget_secrets()
    # The tokens went to the project alone: that is the file's whole purpose, and the test would prove nothing without it.
    assert any(f"Bearer {ONLINE_ACCESS}" in str(headers) for _, _, headers, _ in online_rows.requests)
    log_text = (paths.logs_dir / "guildboard.log").read_text(encoding="utf-8")
    assert "[redacted]" in log_text  # the careless line was written, masked
    for marker in (ONLINE_ACCESS, ONLINE_REFRESH):
        assert marker not in log_text
        assert all(marker not in body for body in bodies)
        for file in paths.data_dir.rglob("*"):
            if file.is_file():
                assert marker.encode() not in file.read_bytes(), file.name
    # Signing out took the file with it, and no copy of it stayed.
    assert not paths.cloud_path.exists()
    assert not paths.cloud_path.with_name("cloud.bin.tmp").exists()
    archive = sqlite3.connect(paths.db_path)
    try:
        for (name,) in archive.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall():
            for row in archive.execute(f'SELECT * FROM "{name}"'):
                assert ONLINE_ACCESS not in str(row) and ONLINE_REFRESH not in str(row), name
    finally:
        archive.close()


def test_nothing_of_the_login_goes_to_the_cloud(tmp_path, clock):
    # The online design, section 3: what goes to the project is the stats switched on, the profile's UID, AR and picture, and
    # the player's presence. A live core with a login stored and a key of the Feedback page in its log, signed in, with
    # every stat switched on: not a cookie's name or value, not the token and not the key is in anything it sends.
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(
        StoredToken({**LOGIN_COOKIES, "ltoken_v2": MARKER, "csc": CSC_MARKER}, 700000001, "os_euro", "Traveler")
    )
    everything = ["status", "primogems", "playtime", "achievements", "endgame", "account", "wishes", "spending"]
    profile = {
        "name": "Nova", "discriminator": "5120", "uid": None, "ar": None, "picture_url": None, "find_by_uid": False, "pins": [],
    }
    cloud = FakeCloud({
        ("POST", "/auth/v1/token?grant_type=pkce"): token_answer(metadata={"custom_claims": {"global_name": "Nova"}}),
        ("POST", "/rest/v1/rpc/ensure_profile"): answer(200, {"name": "Nova", "discriminator": "5120"}),
        ("GET", "/rest/v1/profiles"): [answer(200, [{**profile, "sharing": []}]), answer(200, [{**profile, "sharing": everything}])],
        ("PATCH", "/rest/v1/profiles"): answer(204),
        ("POST", "/rest/v1/rpc/set_uid"): answer(204),
        ("POST", "/rest/v1/rpc/set_sharing"): answer(204),
        ("POST", "/rest/v1/shared_stats"): answer(201),
        ("POST", "/rest/v1/rpc/heartbeat"): answer(204),
        ("POST", "/rest/v1/rpc/friends_overview"): answer(200, {"friends": [], "incoming": [], "outgoing": []}),
        ("GET", "/rest/v1/sync_rows"): answer(200, []),
        ("POST", "/rest/v1/rpc/sync_push"): answer(200, 1),
    })
    opened: list[str] = []
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
                cloud_fetch=cloud, open_browser=opened.append)
    core.store.set_latest_doc("overview", clock.now(), {
        "adventure_rank": 58, "nickname": "Traveler", "picture_url": "https://act-webstatic.hoyoverse.com/a.png",
    })
    core.store.put_layout("board", "[]", 1, clock.now())  # the player's own data, which goes up with the first sync
    core.update_settings({"commission_region": "inazuma"})
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        client.post("/api/online/sign-in")
        nonce = urlsplit(parse_qs(urlsplit(opened[-1]).query)["redirect_to"][0]).path.rsplit("/", 1)[-1]
        assert client.get(f"/auth/callback/{nonce}", params={"code": "THE-CODE-0123456789"}).status_code == 200
        assert client.put("/api/profile/sharing", json={"keys": everything}).status_code == 200
        client.portal.call(core.online.turn)
        client.portal.call(core.online.sync_turn)  # the first look: an account with nothing in it takes this PC's data
        clock.advance(seconds=11)
        client.portal.call(core.online.sync_turn)  # and ten quiet seconds later it goes up
    core.store.close()
    sent = {line.split("?", 1)[0] for line in cloud.sent()}
    assert {
        "PATCH /rest/v1/profiles", "POST /rest/v1/shared_stats", "POST /rest/v1/rpc/set_sharing", "POST /rest/v1/rpc/heartbeat",
        "GET /rest/v1/sync_rows", "POST /rest/v1/rpc/sync_push", "POST /rest/v1/rpc/set_uid",
    } <= sent
    pushed = [row for index, line in enumerate(cloud.sent()) if "sync_push" in line for row in cloud.body(index)["p_rows"]]
    assert {"layouts", "settings"} <= {row["kind"] for row in pushed}  # the test would prove nothing without the rows
    uploaded = [json.loads(body) for method, path, _, body in cloud.requests if path == "/rest/v1/shared_stats"]
    assert {row["key"] for rows in uploaded for row in rows} == set(everything) - {"status"}
    for method, path, headers, body in cloud.requests:
        text = f"{method} {path} {headers} {body!r}"
        for name, value in LOGIN_COOKIES.items():
            assert name not in text, (name, path)
            if len(value) >= 10:
                assert value not in text, (name, path)
        assert MARKER not in text and CSC_MARKER not in text, path


# What each PC fetches for itself, or keeps about itself: HoYoLAB's answers, the numbers made of them, the game's own histories
# and the pictures of its folders. None of it is the player's own data, and none of it is a kind that sync sends.
FETCHED = (
    "raw_responses", "points", "labels", "latest_docs", "wishes", "ledger_entries", "sync_runs", "achievement_changes",
    "gallery_favourites", "timer_events", "char_notices",
)


def test_nothing_fetched_goes_up(tmp_path, clock):
    # The online design, section 8: sync sends the player's own rows, and each fetched table is fetched again by every PC.
    from guildboard.cloud.sync import KINDS

    assert not {kind.table for kind in KINDS} & set(FETCHED)
    assert len(KINDS) == 18

    fetched = "FETCHED-MARKER-9f3a1c0b"
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(StoredToken({**LOGIN_COOKIES, "ltoken_v2": MARKER}, 700000001, "os_euro", "Traveler"))
    cloud = FakeCloud({
        ("POST", "/auth/v1/token?grant_type=pkce"): token_answer(),
        ("POST", "/rest/v1/rpc/ensure_profile"): answer(200, {"name": "Nova", "discriminator": "5120"}),
        ("GET", "/rest/v1/profiles"): answer(200, [{
            "name": "Nova", "discriminator": "5120", "uid": None, "ar": None, "picture_url": None, "find_by_uid": False, "pins": [],
            "sharing": [],
        }]),
        ("GET", "/rest/v1/sync_rows"): answer(200, []),
        ("POST", "/rest/v1/rpc/sync_push"): answer(200, 1),
    })
    opened: list[str] = []
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock), process_lister=lambda: set(),
                cloud_fetch=cloud, open_browser=opened.append)
    store = core.store
    now = clock.now()
    # Something in every fetched table, marked, and some of the player's own to send.
    run = store.start_run("manual", now)
    store._conn.execute(
        "INSERT INTO raw_responses (sync_run_id, grp, endpoint, fetched_at, body) VALUES (?, 'x', 'e', 'now', ?)",
        (run, fetched.encode()),
    )
    store._conn.execute("INSERT INTO points (key, taken_at, game_day, value) VALUES (?, 't', 'd', 1)", (fetched,))
    store._conn.execute("INSERT INTO labels (key, label, kind, updated_at) VALUES ('a', ?, 'static', 'x')", (fetched,))
    store.set_latest_doc("overview", now, {"nickname": fetched})
    store._conn.execute(
        "INSERT INTO wish_imports (uid, started_at, outcome) VALUES (700000001, 'x', 'ok')"
    )
    store._conn.execute(
        "INSERT INTO wishes (id, uid, gacha_type, pool, name, item_type, rank, time, at, import_id) "
        "VALUES (1, 700000001, '301', 'character', ?, 'Character', 5, 't', 'a', 1)", (fetched,)
    )
    store._conn.execute(
        "INSERT INTO ledger_entries (uid, kind, id, time, at, amount, reason, name) VALUES (700000001, 'primogem', 1, 't', 'a', 1, ?, ?)",
        (fetched, fetched),
    )
    store._conn.execute("INSERT INTO achievement_changes (at, label, before) VALUES ('a', ?, '{}')", (fetched,))
    store._conn.execute("INSERT INTO gallery_favourites (name, at) VALUES (?, 'a')", (fetched,))
    store._conn.execute("INSERT INTO timer_events (timer_id, at, recorded_at, source) VALUES (1, 'a', 'b', ?)", (fetched,))
    store._conn.execute("INSERT INTO char_notices (uid, kind, day, sent_at) VALUES (700000001, ?, 'd', 's')", (fetched,))
    store._conn.commit()
    store.put_layout("board", "[]", 1, now)
    store.put_progress([ProgressRow(1402, "done", now, False, "", "player", now)])
    with TestClient(create_app(core, PORT), base_url=BASE) as client:
        client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
        client.post("/api/online/sign-in")
        nonce = urlsplit(parse_qs(urlsplit(opened[-1]).query)["redirect_to"][0]).path.rsplit("/", 1)[-1]
        assert client.get(f"/auth/callback/{nonce}", params={"code": "THE-CODE-0123456789"}).status_code == 200
        client.portal.call(core.online.sync_turn)
        clock.advance(seconds=11)
        client.portal.call(core.online.sync_turn)
    store.close()
    pushed = [row for index, line in enumerate(cloud.sent()) if "sync_push" in line for row in cloud.body(index)["p_rows"]]
    assert {"layouts", "achievement_progress"} <= {row["kind"] for row in pushed}  # something did go up
    assert {row["kind"] for row in pushed} <= {kind.table for kind in KINDS} | {"settings"}
    for method, path, headers, body in cloud.requests:
        assert fetched not in f"{method} {path} {body!r}", path


def test_live_mode_builds_the_hoyolab_source_without_contacting_anything(tmp_path, clock, refused_requests):
    paths = AppPaths(tmp_path / "data")
    core = Core(paths, demo=False, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    assert type(core.source).__name__ == "HoyolabSource"
    assert core.status()["sync"]["state"] == "login_needed"
    core.store.close()
    # Nothing was opened through netpolicy, nor looked up or connected to beyond this PC: conftest.py refuses both.
    assert refused_requests == []


async def test_the_calculator_is_read_only_and_never_switches_sync_on(tmp_path, clock, monkeypatch):
    # The Characters design, H2: a live core on a fake wire, with a focus. After a `characters` run the requests are the
    # character list, the details and the batch calculator's amounts; nothing goes to the calculator's auth address.
    import yarl
    from genshin.client.manager import managers

    import characters_samples as samples
    from characters_service_support import build_record, keep_builds
    from test_hoyolab_wire import COOKIES, Wire, _Session

    wire = Wire()
    monkeypatch.setattr(
        managers.BaseCookieManager, "create_session",
        lambda self, **kwargs: _Session(wire, kwargs.get("trace_configs", [])),
    )
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(StoredToken(dict(COOKIES), 700000001, "os_euro", "Traveler"))
    core = Core(paths, demo=False, clock=clock, sleep=FakeSleep(clock), process_lister=lambda: set())
    try:
        keep_builds(core.store, clock.now(), [build_record(samples.sandrone_build())])
        core.characters.put_focus(["sandrone"])
        assert core.characters.calculator_targets()
        await core.runner.run("manual", ("characters",))
        assert wire.sent() == [("POST", "list"), ("POST", "detail"), ("POST", "batch_compute")]
        assert not [url for _, url in wire.requests if "auth" in yarl.URL(url).path]
        assert all(netpolicy.is_hoyoverse(url) for _, url in wire.requests)
        # with sync off, it asks for the amounts alone
        wire.requests.clear()
        wire.sync_off = True
        await core.runner.run("manual", ("characters",))
        assert wire.sent() == [("POST", "list"), ("POST", "detail"), ("POST", "batch_compute")]
        assert not [url for _, url in wire.requests if "auth" in yarl.URL(url).path]
        assert core.characters.calculator_state() == "off"
    finally:
        core.store.close()


async def test_importing_a_paimon_export_writes_only_inside_the_data_folder(tmp_path, clock):
    global _watching
    export = paimon_export({"": {"1": {"80127": True}}})
    data = tmp_path / "data"
    core = Core(AppPaths(data), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())
    _written.clear()
    _watching = True
    try:
        preview = await core.preview_import(export.decode("utf-8"), "export.json", None)
        summary = await core.apply_import(export.decode("utf-8"), "export.json", None, preview["fingerprint"])
    finally:
        _watching = False
    try:
        assert (preview["done"], summary["done"]) == (1, 1)
        rows = core.store.progress()
        assert 80127 in rows and rows[80127].status == "done"  # the import did write
    finally:
        core.store.close()
    assert [p for p in _written if not _inside(p, data)] == []
    # The trace did see the import's writes: the backup made before them, in the data folder's backups.
    assert any(_inside(p, data) and Path(p).name.startswith("guildboard-auto-import-") for p in _written)


async def test_an_export_writes_only_the_chosen_file(tmp_path, clock):
    global _watching
    data = tmp_path / "data"
    chosen = tmp_path / "elsewhere" / "x.gbbackup"
    chosen.parent.mkdir()  # the Save dialog gives a place in a folder that is there
    core = Core(AppPaths(data), demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())
    _written.clear()
    _watching = True
    try:
        assert await core.export_backup(chosen) == "x.gbbackup"
    finally:
        _watching = False
        core.store.close()
    assert chosen.is_file()
    outside = [Path(p).resolve() for p in _written if not _inside(p, data)]
    # The file, and the file's name with .tmp, which is renamed to it when whole. No folder is made for it.
    assert set(outside) == {chosen.resolve(), chosen.with_name("x.gbbackup.tmp").resolve()}


# ---------------------------------------------------------------- H5 and spec 8.1: only when the player asks

LIST_DOWNLOAD_FAILED = "The achievement list could not be downloaded. Check the connection and try again."
# The requests a live core makes on its own, once the player has given the first run's consent: HoYoverse's
# announcements, for the banners running now, read at a start and after each sync (the Pulls plan, calls, item 12;
# ruling R15). Nothing of the player's goes with them but the account's uid.
ANNOUNCEMENTS = {("GET", ANN_LIST_URL), ("GET", ANN_CONTENT_URL)}
# And the Characters pages' (the Characters design, H6): the HoYoLAB wiki's lists (the POST that only asks for a list) and
# entries, and the pictures at the five hosts of HoYoverse's, each through netpolicy and nothing else.
WIKI_LISTS = ("POST", wiki_urls.WIKI_URL)
WIKI_ENTRY = ("GET", ENTRY_URL.partition("?")[0])
# The five hosts, written out here and not taken from the code, so that a longer list in the code does not widen this test.
# fastcdn.hoyoverse.com holds the pictures of the characters the wiki's inventory leaves out (the Traveler, Manekin,
# Manekina); the player approved it on 2026-10-30.
ART_HOSTS = (
    "act-webstatic.hoyoverse.com", "act-upload.hoyoverse.com", "upload-static.hoyoverse.com", "bbs.hoyolab.com",
    "fastcdn.hoyoverse.com",
)


def _beyond_the_announcements(requests: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """What a live core asked for besides the announcements, the wiki's lists and entries, and the art hosts' pictures."""
    def allowed(method: str, url: str) -> bool:
        bare = url.partition("?")[0]
        if (method, bare) in ANNOUNCEMENTS or (method, bare) == WIKI_LISTS or (method, bare) == WIKI_ENTRY:
            return True
        host = urlsplit(url)
        return method == "GET" and host.scheme == "https" and host.hostname in ART_HOSTS

    return [(method, url) for method, url in requests if not allowed(method, url)]


def test_the_core_downloads_the_list_only_when_the_player_asks(tmp_path, clock, monkeypatch, refused_requests):
    # Spec 4: the list is fetched only when the player presses "Check for new achievements". A live core, started as
    # Guild Board starts it, with a login and a stand-in for HoYoLAB, reads every page and syncs before the player asks.
    # The player has not given the first run's consent, so not even the announcements are asked for (ruling R15).
    global _watching
    requests: list[tuple[str, str]] = []

    def refuse(request, timeout):  # stands in for the network: each request is recorded, and nothing is sent
        requests.append((request.get_method(), request.full_url))
        raise urllib.error.URLError("the tests contact nothing")

    monkeypatch.setattr(netpolicy, "_open", refuse)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(
        StoredToken({"ltoken_v2": "v2_MADE-UP-0123456789", "ltuid_v2": "123456"}, 700000001, "os_euro", "Traveler")
    )
    source = AccountSource()
    core = Core(paths, demo=False, clock=clock, source=source, process_lister=lambda: set())
    _reads.clear()
    _watching = True
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.portal.call(core.start)  # game detection, and the sync a start asks for
            try:
                client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
                _wait_until_idle(client)
                for url in ("/api/status", "/api/backlog", "/api/stats", "/api/synclog", "/api/settings",
                            "/api/achievements", "/api/achievements/list"):
                    assert client.get(url).status_code == 200, url
                client.post("/api/sync")  # the sync at the start has just run, so this one may wait its turn
                _wait_until_idle(client)
                assert source.calls  # the syncs ran, on the stand-in
                # Nothing else was looked up or connected to beyond this PC either: conftest.py refuses it.
                assert (requests, _reads, refused_requests) == ([], [], [])

                checked = client.post("/api/achievements/list/check")
                assert (checked.status_code, checked.json()) == (503, {"error": LIST_DOWNLOAD_FAILED})
                assert requests == [("GET", netpolicy.ACHIEVEMENT_LIST_URL)]
                assert (requests, refused_requests) == ([("GET", netpolicy.ACHIEVEMENT_LIST_URL)], [])
            finally:
                client.portal.call(core.stop)
    finally:
        _watching = False


# ---------------------------------------------------------------- H1 and H4: the import's two reads (the Pulls design, 4)

MARKER_KEY = "MARKER-KEY-0123456789-ABCDEFGH"


class _Answer:
    """An answer of HoYoverse's, as netpolicy reads it."""

    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self, amount: int) -> bytes:
        return self._data[:amount]

    def __enter__(self) -> "_Answer":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


async def _hello(app) -> str:
    """The event stream's hello, as a page reads it first."""
    [route] = [route for route in app.routes if route.path == "/api/events"]
    stream = (await route.endpoint()).body_iterator
    try:
        return await anext(stream)
    finally:
        await stream.aclose()


async def _quick(seconds: float) -> None:
    await asyncio.sleep(0)


def test_the_import_reads_exactly_the_games_log_and_cache_and_only_on_the_press(tmp_path, clock, monkeypatch):
    # The Pulls design, section 4: the only two files of the game's Guild Board reads, read-only and only when the player
    # presses Import, are its log, for its data folder, and the web cache in that folder, for the wish-history links.
    # A live core, started as Guild Board starts it, with a login, the first run's consent (only then can the player
    # reach Import) and a stand-in for HoYoLAB, over a made-up game whose link holds a made-up key; HoYoverse's history
    # is a stand-in, and every other address is refused.
    global _watching, _read_under
    home = tmp_path / "home"  # the profile folder: the game's log under it, and the made-up game in it
    monkeypatch.setenv("USERPROFILE", str(home))
    log_file, cache = made_up_game(home, MARKER_KEY)
    # The ledger design, section 0: the game writes the Feedback page's link, with its own key, into its log; the same
    # two reads find it, and its key goes only to the history logs and GetUserInfo.
    with log_file.open("a", encoding="utf-8") as file:
        file.write(f"OpenURL {csc_url(CSC_MARKER)}\n")
    first = 1_760_000_000_000_000_000
    history = History({
        "301": [record(first + 1, "301", "2026-10-12 21:14:03", "Fischl", "Character", 4),
                record(first + 2, "301", "2026-10-12 21:15:03", "Skirk", "Character", 5)],
        "302": [record(first + 3, "302", "2026-10-12 21:16:03", "Cool Steel", "Weapon", 3)],
    }, keys=[MARKER_KEY])
    ledgers = Ledgers({"GetPrimogemLog": [ledger_entry(5)], "GetResinLog": [ledger_entry(6, amount=-20)]},
                      keys=[CSC_MARKER])
    requests: list[tuple[str, str]] = []

    def wire(request, timeout):  # stands in for the network: each request recorded, only the histories answered
        requests.append((request.get_method(), request.full_url))
        if request.full_url.startswith(wishapi.HISTORY_URL):
            return _Answer(history(request.full_url))
        if ledgers.handles(request.full_url):
            return _Answer(ledgers(request.full_url))
        raise urllib.error.URLError("the tests contact nothing")

    monkeypatch.setattr(netpolicy, "_open", wire)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(
        StoredToken({"ltoken_v2": "v2_MADE-UP-0123456789", "ltuid_v2": "123456"}, 700000001, "os_euro", "Traveler")
    )
    save_settings(paths.settings_path, Settings(risk_acknowledged=True))
    logging_setup.forget_secrets()
    setup_logging(paths.logs_dir)
    bodies: list[str] = []
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), process_lister=lambda: set())
    core.wish_import._sleep = _quick  # the half second between two pages, without the wait
    _reads.clear()
    _written.clear()
    _read_under = _file_key(home)
    _watching = True
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.portal.call(core.start)  # game detection, the banners, and the sync a start asks for
            try:
                client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
                _wait_until_idle(client)
                assert {"/api/pulls", "/api/pulls/history"} <= set(_pulls_pages(client.app))
                pages = ("/api/status", "/api/backlog", "/api/stats", "/api/synclog", "/api/settings",
                         "/api/achievements", *_pulls_pages(client.app), "/api/ledger",
                         *(f"/api/ledger/history?kind={kind}" for kind in ("primogem", "resin")))
                for url in pages:
                    response = client.get(url)
                    assert response.status_code == 200, url
                    bodies.append(response.text)
                client.post("/api/sync")
                _wait_until_idle(client)
                # Before the press, nothing of the game's was read, and the history was not asked for: the only
                # requests are for the announcements, and, now that the first run's consent is given, the wiki's lists
                # (and entries and pictures, which a page of the Characters would ask for), all through netpolicy.
                assert _reads == []
                assert requests and _beyond_the_announcements(requests) == []
                assert WIKI_LISTS in {(method, url.partition("?")[0]) for method, url in requests}

                heard = core.bus.subscribe()  # every event the run publishes
                pressed = client.post("/api/pulls/import")
                bodies.append(pressed.text)
                assert pressed.json() == {"started": True}
                _wait_for_the_import(core)
                assert core.wish_import.state()["state"] == "done"
                assert core.wish_import.ledger_state()["state"] == "done"
                for url in pages:
                    bodies.append(client.get(url).text)
                bodies.append(client.portal.call(_hello, client.app))
                bodies.append(json.dumps(core.wish_import.state()))
                events = []
                while not heard.empty():
                    events.append(heard.get_nowait())
                assert {"pulls_import", "pulls_changed"} <= {event["type"] for event in events}
                bodies.extend(json.dumps(event) for event in events)
            finally:
                client.portal.call(core.stop)
    finally:
        _watching = False
        _read_under = None
        shutdown_logging()
        logging_setup.forget_secrets()
    # The press read exactly the game's log and its web cache, each once, each opened for reading.
    assert sorted(map(_file_key, _reads)) == sorted(map(_file_key, (log_file, cache)))
    # Nothing was written outside the data folder: nothing in the game's folders.
    outside = [
        path for path in _written
        if not _inside(path, paths.data_dir) and "__pycache__" not in path and not path.endswith(".pyc")
    ]
    assert outside == []
    # The key went only to HoYoverse's history address, and it is in no file of the data folder, in no log line and in
    # no answer.
    with_the_key = [url for _, url in requests if MARKER_KEY in url]
    assert with_the_key and all(url.startswith(wishapi.HISTORY_URL + "?") for url in with_the_key)
    # The Feedback link's key went only to the four history logs and GetUserInfo, each asked for, and no further.
    with_the_csc_key = [url for _, url in requests if CSC_MARKER in url]
    assert with_the_csc_key and all(_a_ledger_address(url) for url in with_the_csc_key)
    assert {_log_name(url) for url in with_the_csc_key} == {
        "GetUserInfo", "GetPrimogemLog", "GetCrystalLog", "GetResinLog", "GetArtifactLog",
    }
    log_text = (paths.logs_dir / "guildboard.log").read_text(encoding="utf-8")
    for marker in (MARKER_KEY, CSC_MARKER):
        assert marker not in log_text
        assert all(marker not in body for body in bodies)
        for file in paths.data_dir.rglob("*"):
            if file.is_file():
                assert marker.encode() not in file.read_bytes(), file.name
    # The wishes are kept.
    kept = sqlite3.connect(paths.db_path)
    try:
        assert kept.execute("SELECT COUNT(*) FROM wishes WHERE uid = 700000001").fetchone()[0] == 3
        assert kept.execute("SELECT COUNT(*) FROM ledger_entries WHERE uid = 700000001").fetchone()[0] == 2
    finally:
        kept.close()


# ---------------------------------------------------------------- H1: the gallery's reads (the ledger design, 7)

def _files_with_times(folder: Path) -> dict[str, tuple[bytes, int]]:
    return {
        str(path): (path.read_bytes(), path.stat().st_mtime_ns) for path in sorted(folder.rglob("*")) if path.is_file()
    }


def test_the_gallery_reads_only_pictures_in_the_screenshot_folder_and_never_writes_there(tmp_path, clock, monkeypatch):
    # Only while the player has the gallery turned on, Guild Board reads the game's log, for its data folder, and the
    # pictures directly inside the ScreenShot folder next to it: listed and read, never written, moved or deleted. A
    # live core over a made-up game with pictures, a picture in a subfolder and a text file; Explorer is a stand-in.
    global _watching, _read_under
    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    log_file, _ = made_up_game(home)
    folder = made_up_screenshots(home)
    pictures = {_file_key(path) for path in folder.iterdir() if path.suffix.lower() in (".png", ".jpg")}
    before = _files_with_times(home)
    started: list[Path] = []
    paths = AppPaths(tmp_path / "data")
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), sleep=FakeSleep(clock),
                process_lister=lambda: set())
    core.gallery._show = started.append
    _reads.clear()
    _written.clear()
    _read_under = _file_key(home)
    _watching = True
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
            # Off, as it is by default: nothing of the game's is read.
            assert client.get("/api/gallery").json() == {"enabled": False}
            assert client.get("/api/gallery/20261012211403.png/full").status_code == 404
            assert _reads == []
            # On: the log once, then the pictures asked for.
            assert client.put("/api/settings", json={"gallery_enabled": True}).status_code == 200
            model = client.post("/api/gallery/rescan").json()
            assert model["count"] == 3
            for picture in (picture for month in model["months"] for picture in month["pictures"]):
                assert client.get(f"/api/gallery/{picture['id']}/thumb").status_code == 200
            assert client.get("/api/gallery/20261012211403.png/full").status_code == 200
            assert client.put("/api/gallery/20261012211403.png/favourite", json={"on": True}).status_code == 200
            assert client.post("/api/gallery/20261012211403.png/show").status_code == 200
            assert client.post("/api/gallery/rescan").json()["count"] == 3  # the kept folder: no second read of the log
            client.put("/api/settings", json={"gallery_enabled": False})
            assert client.get("/api/gallery").json() == {"enabled": False}
        core.store.close()
    finally:
        _watching = False
        _read_under = None
    read = list(map(_file_key, _reads))
    assert set(read) == {_file_key(log_file)} | pictures
    assert read.count(_file_key(log_file)) == 1
    assert not any(_file_key(path).startswith(_file_key(folder / "older")) for path in _reads)
    # Nothing written, renamed or deleted in the game's folders; the thumbnails are in Guild Board's own.
    assert [path for path in _written if _inside(path, home)] == []
    assert any(_inside(path, paths.data_dir / "gallery-thumbs") for path in _written)
    assert _files_with_times(home) == before
    assert started == [folder / "20261012211403.png"]


def _log_name(url: str) -> str:
    return url.partition("?")[0].rsplit("/", 1)[-1]


def _a_ledger_address(url: str) -> bool:
    """Whether a keyed address is one of the history logs' five: Get{Primogem,Crystal,Resin,Artifact}Log or
    GetUserInfo, on the logs' own host, with its query."""
    return url.startswith(LEDGER_URL + "Get") and _log_name(url) in LEDGER_ADDRESSES and "?" in url


def test_the_ledger_addresses_are_the_five():
    assert LEDGER_URL == "https://public-operation-hk4e-sg.hoyoverse.com/common/hk4e_self_help_query/User/"
    assert _a_ledger_address(LEDGER_URL + "GetPrimogemLog?a=1")
    assert not _a_ledger_address(LEDGER_URL + "GetWeaponLog?a=1")
    assert not _a_ledger_address("https://example.invalid/User/GetPrimogemLog?a=1")


# ---------------------------------------------------------------- H4: the key's life (the second pass design, 5)

def _cell_contents(function: types.FunctionType):
    for cell in function.__closure__ or ():
        try:
            yield cell.cell_contents
        except ValueError:  # an empty cell
            continue


def _holds(root: object, needle: str) -> bool:
    """Whether `needle` is held anywhere `root` reaches: in a text or bytes, in a container, in an object's attributes,
    or in what a function holds (its closure, its defaults, a partial's arguments). The core and the store, classes,
    modules and bound methods are not walked: the files they write are scanned instead."""
    seen: set[int] = set()
    stack: list[object] = [root]
    while stack:
        value = stack.pop()
        if id(value) in seen:
            continue
        seen.add(id(value))
        if isinstance(value, str):
            if needle in value:
                return True
        elif isinstance(value, (bytes, bytearray)):
            if needle.encode() in value:
                return True
        elif isinstance(value, dict):
            stack.extend(part for pair in value.items() for part in pair)
        elif isinstance(value, (list, tuple, set, frozenset, collections.deque)):
            stack.extend(value)
        elif isinstance(value, (type, types.ModuleType, types.MethodType, Core, Store)):
            continue
        elif isinstance(value, functools.partial):
            stack.extend((value.func, value.args, value.keywords))
        elif isinstance(value, types.FunctionType):
            stack.extend(_cell_contents(value))
            stack.extend((value.__defaults__, value.__kwdefaults__))
        else:
            stack.extend(vars(value).values() if hasattr(value, "__dict__") else ())
            stack.extend(getattr(value, name, None) for name in getattr(type(value), "__slots__", ()))
    return False


def _registered(marker: str) -> bool:
    """Whether a form of `marker`, as written, decoded or encoded again, is registered with the log's mask."""
    return any(marker in secret for secret in logging_setup._secrets)


def test_the_walk_finds_a_key_wherever_it_is_held():
    link = gamecache.WishLink("https://example.invalid/?k=" + MARKER_KEY, {"k": MARKER_KEY}, Path())
    holder = type("Holder", (), {})()
    holder.kept = [{"link": link}]  # in an attribute, a list, a dict and an object
    holder.callback = lambda: link  # and in a closure
    assert _holds(holder, MARKER_KEY)
    holder.kept.clear()
    assert _holds(holder, MARKER_KEY)  # still, through the closure
    del holder.callback
    assert not _holds(holder, MARKER_KEY)


async def test_the_kept_key_lives_only_in_memory_and_its_ticks_read_no_file(tmp_path, clock, monkeypatch):
    # From a press that ended well the link's key is kept in memory, never on disk, until HoYoverse refuses it, 24 hours
    # pass or Guild Board closes. It is used only to import new wishes, and that reads none of the game's files. A live
    # core, started as Guild Board starts it, over a made-up game whose link holds a made-up key; HoYoverse's history is
    # a stand-in, and every other address is refused.
    global _watching, _read_under
    home = tmp_path / "home"  # the profile folder: the game's log under it, and the made-up game in it
    monkeypatch.setenv("USERPROFILE", str(home))
    log_file, cache = made_up_game(home, MARKER_KEY)
    with log_file.open("a", encoding="utf-8") as file:  # and the Feedback page's link, with its own key
        file.write(f"OpenURL {csc_url(CSC_MARKER)}\n")
    first = 1_760_000_000_000_000_000
    history = History({"301": [record(first + 1, "301", "2026-10-12 21:14:03", "Fischl", "Character", 4)]},
                      keys=[MARKER_KEY])
    ledgers = Ledgers({"GetPrimogemLog": [ledger_entry(5)]}, keys=[CSC_MARKER])
    requests: list[str] = []

    def wire(request, timeout):  # stands in for the network: each request recorded, only the histories answered
        requests.append(request.full_url)
        if request.full_url.startswith(wishapi.HISTORY_URL):
            return _Answer(history(request.full_url))
        if ledgers.handles(request.full_url):
            return _Answer(ledgers(request.full_url))
        raise urllib.error.URLError("the tests contact nothing")

    monkeypatch.setattr(netpolicy, "_open", wire)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    save_settings(paths.settings_path, Settings(risk_acknowledged=True))
    logging_setup.forget_secrets()
    setup_logging(paths.logs_dir)
    core = Core(paths, demo=False, clock=clock, source=AccountSource(), process_lister=lambda: set())
    importer = core.wish_import
    importer._sleep = _quick  # the half second between two pages, without the wait
    heard = core.bus.subscribe()  # every event the runs publish
    bodies: list[str] = []
    _reads.clear()
    _read_under = _file_key(home)
    _watching = True
    try:
        # The press reads the game's two files, and keeps the link.
        await importer.run()
        assert importer.state()["state"] == "done" and importer.state()["auto"] is not None
        assert sorted(map(_file_key, _reads)) == sorted(map(_file_key, (log_file, cache)))
        assert _holds(importer, MARKER_KEY)  # in memory, and the walk sees it there
        assert _holds(importer, CSC_MARKER) and importer.ledger_state()["auto"] is not None
        assert _registered(MARKER_KEY) and _registered(CSC_MARKER)  # masked in the log while a link holds it
        # An update with the kept links imports what is new and opens none of the game's files.
        _reads.clear()
        requests.clear()
        history.add("301", [record(first + 2, "301", "2026-10-12 21:15:03", "Skirk", "Character", 5)])
        ledgers.add("GetPrimogemLog", [ledger_entry(6)])
        assert await importer.auto_update() is True
        assert importer.state()["found"] == 1 and importer.state()["auto"]["last_at"] is not None
        assert importer.ledger_state()["found"] == 1 and importer.ledger_state()["auto"]["last_at"] is not None
        assert _reads == []
        # The keys went only to HoYoverse's history addresses.
        with_the_key = [url for url in requests if MARKER_KEY in url]
        assert with_the_key and all(url.startswith(wishapi.HISTORY_URL + "?") for url in with_the_key)
        with_the_csc_key = [url for url in requests if CSC_MARKER in url]
        assert with_the_csc_key and all(_a_ledger_address(url) for url in with_the_csc_key)
        # Not in an answer of the importer, nor in an event.
        bodies.append(json.dumps(importer.state()))
        bodies.append(json.dumps(importer.ledger_state()))
        while not heard.empty():
            bodies.append(json.dumps(heard.get_nowait()))
        assert any('"pulls_changed"' in body for body in bodies)
        # drop_link() forgets it: no attribute of the importer holds the key, and no update asks for it again.
        importer.drop_link()
        assert not _holds(importer, MARKER_KEY) and not _holds(importer, CSC_MARKER)
        assert not _registered(MARKER_KEY) and not _registered(CSC_MARKER)  # nor the log's mask: no form of either
        requests.clear()
        assert await importer.auto_update() is False
        assert requests == [] and importer.state()["auto"] is None and importer.ledger_state()["auto"] is None
        # Guild Board's closing ends the key's life as well: a new press keeps a link, and closing drops it.
        _watching = False
        await importer.run()
        assert _holds(importer, MARKER_KEY) and _holds(importer, CSC_MARKER)
        await core.stop()
        assert not _holds(importer, MARKER_KEY) and not _holds(importer, CSC_MARKER)
        assert not _registered(MARKER_KEY) and not _registered(CSC_MARKER)
    finally:
        _watching = False
        _read_under = None
        shutdown_logging()
        logging_setup.forget_secrets()
    # The markers are in no log line and in no file of the data folder: not in the database.
    log_text = (paths.logs_dir / "guildboard.log").read_text(encoding="utf-8")
    assert "Updating the wish history with the link kept from the last import." in log_text
    for marker in (MARKER_KEY, CSC_MARKER):
        assert marker not in log_text
        assert all(marker not in body for body in bodies)
        for file in paths.data_dir.rglob("*"):
            if file.is_file():
                assert marker.encode() not in file.read_bytes(), file.name
    kept = sqlite3.connect(paths.db_path)
    try:
        assert kept.execute("SELECT COUNT(*) FROM wishes WHERE uid = 700000001").fetchone()[0] == 2
    finally:
        kept.close()


# ---------------------------------------------------------------- H1, H4 and H5: the keys from the login

MINTED_WISH_KEY = "MINTED-WISH-0123456789-ABCDEFGH"  # made up: the keys HoYoverse gives the login
MINTED_CSC_KEY = "MINTED-CSC-0123456789-ZYXWVUTS"
LOGIN_COOKIES = {
    "ltoken_v2": "v2_LTOKEN-MARKER-0123456789", "ltuid_v2": "123456", "ltmid_v2": "LTMID-MARKER-0123456789",
    "cookie_token_v2": "v2_COOKIE-MARKER-0123456789", "account_id_v2": "123456",
    "account_mid_v2": "ACCOUNT-MID-MARKER-0123456789", "lrsag": "LRSAG-MARKER-0123456789",
}
MINT_SENT = {"account_id_v2", "account_mid_v2", "cookie_token_v2", "lrsag"}  # the only cookies the mint may carry


def test_the_logins_keys_go_only_to_the_histories_and_the_refresh_reads_no_game_file(tmp_path, clock, monkeypatch):
    # The histories update themselves with read-only keys HoYoverse gives the stored login (genAuthKeyByCookieToken):
    # the request for a key goes to that one address alone, with the four cookies it needs and no other; a key reaches
    # only the wish history's address or the game history's logs; the refresh opens none of the game's files, though a
    # made-up game lies where the game's would; and a key reaches no log, answer, event or file of the data folder. A
    # live core, started as Guild Board starts it, with a login, the first run's consent and HoYoLAB's sync a stand-in;
    # the source's mint is the real one, through netpolicy, and HoYoverse is a stand-in that refuses every other address.
    global _watching, _read_under
    from guildboard.sources import hoyolab

    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    log_file, cache = made_up_game(home, MARKER_KEY)
    first = 1_760_000_000_000_000_000
    history = History({"301": [record(first + 1, "301", "2026-10-12 21:14:03", "Fischl", "Character", 4)]},
                      keys=[MINTED_WISH_KEY])
    ledgers = Ledgers({"GetPrimogemLog": [ledger_entry(5)], "GetResinLog": [ledger_entry(6, amount=-20)]},
                      keys=[MINTED_CSC_KEY])
    requests: list[tuple[str, str, dict[str, str], bytes | None]] = []

    def wire(request, timeout):  # stands in for the network: each request recorded, only HoYoverse's answered
        url = request.full_url
        requests.append((request.get_method(), url, dict(request.header_items()), request.data))
        if url == netpolicy.MINT_URL:
            kind = json.loads(request.data)["auth_appid"]
            key = MINTED_WISH_KEY if kind == "webview_gacha" else MINTED_CSC_KEY
            return _Answer(json.dumps({"retcode": 0, "message": "OK", "data": {"authkey": key}}).encode())
        if url.startswith(wishapi.HISTORY_URL):
            return _Answer(history(url))
        if ledgers.handles(url):
            return _Answer(ledgers(url))
        raise urllib.error.URLError("the tests contact nothing")

    monkeypatch.setattr(netpolicy, "_open", wire)
    paths = AppPaths(tmp_path / "data")
    paths.ensure()
    TokenStore(paths.token_path).save(StoredToken(dict(LOGIN_COOKIES), 700000001, "os_euro", "Traveler"))
    save_settings(paths.settings_path, Settings(risk_acknowledged=True))

    class LoginSource(AccountSource):  # the sync's stand-in, with the real mint of the HoYoLAB source
        def __init__(self) -> None:
            super().__init__()
            self.real = hoyolab.HoyolabSource(TokenStore(paths.token_path))

        def can_mint(self) -> bool:
            return self.real.can_mint()

        async def mint_key(self, auth_appid):
            return await self.real.mint_key(auth_appid)

    logging_setup.forget_secrets()
    setup_logging(paths.logs_dir)
    bodies: list[str] = []
    core = Core(paths, demo=False, clock=clock, source=LoginSource(), process_lister=lambda: set())
    core.wish_import._sleep = _quick
    heard = core.bus.subscribe()
    _reads.clear()
    _written.clear()
    _read_under = _file_key(home)
    _watching = True
    try:
        with TestClient(create_app(core, PORT), base_url=BASE) as client:
            client.portal.call(core.start)  # the first sync, then the histories with the login
            try:
                client.get("/launch", params={"k": core.launch_secret}, follow_redirects=False)
                for _ in range(1000):
                    if core.wish_import.ledger_state()["state"] == "done" and not core.wish_import.running:
                        break
                    time.sleep(0.01)
                assert core.wish_import.state()["state"] == "done" and core.wish_import.state()["login"] == "on"
                for url in ("/api/status", "/api/pulls", "/api/ledger", "/api/ledger/history?kind=primogem",
                            "/api/settings", "/api/synclog"):
                    response = client.get(url)
                    assert response.status_code == 200, url
                    bodies.append(response.text)
                bodies.append(client.portal.call(_hello, client.app))
                while not heard.empty():
                    bodies.append(json.dumps(heard.get_nowait()))
                assert _holds(core.wish_import, MINTED_WISH_KEY) and _holds(core.wish_import, MINTED_CSC_KEY)
                assert _registered(MINTED_WISH_KEY) and _registered(MINTED_CSC_KEY)
            finally:
                client.portal.call(core.stop)
        forgotten = not _registered(MINTED_WISH_KEY) and not _registered(MINTED_CSC_KEY)  # closing let both go
    finally:
        _watching = False
        _read_under = None
        shutdown_logging()
        logging_setup.forget_secrets()
    # No file of the game's was opened: neither its log nor its web cache.
    assert _reads == []
    assert [path for path in _written if _inside(path, home)] == []
    # The mint went to its one address alone, as a POST, carrying only the four cookies it needs.
    mints = [(method, headers) for method, url, headers, _ in requests if "genAuthKey" in url]
    assert len(mints) == 2 and all(url == netpolicy.MINT_URL for _, url, _, _ in requests if "genAuthKey" in url)
    for method, headers in mints:
        assert method == "POST"
        assert {part.split("=", 1)[0] for part in headers["Cookie"].split("; ")} == MINT_SENT
    # No cookie of the login went anywhere else, nor any cookie the mint does not need even there.
    for method, url, headers, data in requests:
        sent = f"{url} {headers} {data!r}"
        for name, value in LOGIN_COOKIES.items():
            if len(value) < 10 or (url == netpolicy.MINT_URL and name in MINT_SENT):
                continue
            assert value not in sent, (name, url)
    # Each key went only to its history's addresses, and both were read with.
    with_the_wish_key = [url for _, url, _, _ in requests if MINTED_WISH_KEY in url]
    assert with_the_wish_key and all(url.startswith(wishapi.HISTORY_URL + "?") for url in with_the_wish_key)
    with_the_csc_key = [url for _, url, _, _ in requests if MINTED_CSC_KEY in url]
    assert with_the_csc_key and all(_a_ledger_address(url) for url in with_the_csc_key)
    # Closing forgot them, in memory and in the log's mask, and neither is in a log line, an answer, an event or a file
    # of the data folder.
    assert not _holds(core.wish_import, MINTED_WISH_KEY) and not _holds(core.wish_import, MINTED_CSC_KEY)
    assert forgotten
    log_text = (paths.logs_dir / "guildboard.log").read_text(encoding="utf-8")
    assert "HoYoverse gave the wish history's key for the stored login." in log_text
    for marker in (MINTED_WISH_KEY, MINTED_CSC_KEY, LOGIN_COOKIES["cookie_token_v2"]):
        assert marker not in log_text
        assert all(marker not in body for body in bodies)
        for file in paths.data_dir.rglob("*"):
            if file.is_file() and file.name != "token.bin":
                assert marker.encode() not in file.read_bytes(), file.name
    kept = sqlite3.connect(paths.db_path)
    try:
        assert kept.execute("SELECT COUNT(*) FROM wishes WHERE uid = 700000001").fetchone()[0] == 1
        assert kept.execute("SELECT COUNT(*) FROM ledger_entries WHERE uid = 700000001").fetchone()[0] == 2
    finally:
        kept.close()


def test_the_mint_is_the_only_request_that_carries_the_logins_cookies_outside_the_library():
    # netpolicy sends a cookie in one place alone, the mint's, and names the address and the four cookies there.
    text = (SRC / "netpolicy.py").read_text(encoding="utf-8")
    assert text.count('"Cookie"') == 1 and '"Cookie"' in _module_function_text(text, "fetch_authkey")
    assert netpolicy.MINT_COOKIES == ("account_id_v2", "account_mid_v2", "cookie_token_v2", "lrsag")
    assert netpolicy.MINT_URL == "https://api-account-os.hoyoverse.com/binding/api/genAuthKeyByCookieToken"
    # Only the HoYoLAB source asks for a key, and only through netpolicy.fetch_authkey.
    users = {name for name, source in _sources() if re.search(r"\bfetch_authkey\b", source)}
    assert users == {"netpolicy.py", "sources/hoyolab.py"}


def _module_function_text(text: str, name: str) -> str:
    match = re.search(rf"^def {name}\(.*?(?=^def |\Z)", text, re.S | re.M)
    assert match, name
    return match.group(0)


# ---------------------------------------------------------------- the ledger probe, run by hand (the ledger design, 9)

OTHER_PAGE_KEY = "OTHER-PAGE-KEY-0123456789-QWERTY"  # made up: the key of a page that is neither the wish history nor Feedback


def test_the_ledger_probe_sends_a_wish_key_nowhere_but_the_wish_history(tmp_path, monkeypatch, capsys):
    # The ledger probe, run by hand, asks the game's history logs with the Feedback links' keys alone. A wish link's key
    # goes only to the wish history, which the probe never asks, and another page's key goes nowhere; it counts those
    # links and names their pages, never a key. A made-up game whose web cache holds a wish link and another page's
    # link with a key, and whose log holds the Feedback link. The history logs are a stand-in that refuses the Feedback
    # key at first, as an expired one is, so that the probe has every reason to try another, then accepts it.
    from guildboard.ledger import probe

    home = tmp_path / "home"
    monkeypatch.setenv("USERPROFILE", str(home))
    log_file, cache = made_up_game(home, MARKER_KEY)
    other_page = f"https://webstatic.hoyoverse.com/ys/event/e20230928review/index.html?authkey={OTHER_PAGE_KEY}&authkey_ver=1"
    cache.write_bytes(cache.read_bytes() + b"\x00" + other_page.encode("ascii") + b"\x00")
    with log_file.open("a", encoding="utf-8") as file:
        file.write(f"OpenURL {csc_url(CSC_MARKER)}\n")
    ledgers = Ledgers({"GetPrimogemLog": [ledger_entry(5)], "GetResinLog": [ledger_entry(6, amount=-20)]})
    requests: list[str] = []

    def wire(request, timeout):  # stands in for the network: each request recorded, only the history logs answered
        requests.append(request.full_url)
        if ledgers.handles(request.full_url):
            return _Answer(ledgers(request.full_url))
        raise urllib.error.URLError("the tests contact nothing")

    monkeypatch.setattr(netpolicy, "_open", wire)
    monkeypatch.setattr(probe, "PAUSE_SECONDS", 0)
    monkeypatch.setattr("sys.argv", ["probe"])
    refused = probe.main()  # every key refused
    ledgers.keys.add(CSC_MARKER)
    accepted = probe.main()  # the Feedback key accepted
    out = capsys.readouterr().out
    # A wish key went nowhere but the wish history, and the other page's key nowhere at all.
    assert [url for url in requests if MARKER_KEY in url and not url.startswith(wishapi.HISTORY_URL + "?")] == []
    assert [url for url in requests if OTHER_PAGE_KEY in url] == []
    # Every request asked a history log with the Feedback key, and every log was read with it once it was accepted.
    assert requests and all(CSC_MARKER in url and _a_ledger_address(url) for url in requests)
    assert {_log_name(url) for url in requests} >= {"GetPrimogemLog", "GetCrystalLog", "GetResinLog", "GetArtifactLog"}
    assert (refused, accepted) == (1, 0)
    # The other links are counted, and named by their page alone; no key is printed.
    assert "Wish links found: 1" in out
    assert "https://webstatic.hoyoverse.com/ys/event/e20230928review/index.html x1" in out
    for marker in (MARKER_KEY, CSC_MARKER, OTHER_PAGE_KEY):
        assert marker not in out


def test_no_source_but_netpolicy_builds_a_cookie_header():
    # The login's cookies go out in two ways alone: the library's own session in sources/hoyolab.py, which names no
    # header, and the mint's request, which netpolicy.fetch_authkey builds with the four cookies it needs. No other
    # module names a Cookie header, in any case, so none builds one of its own (the ledger probe's --login once did).
    header = re.compile(r"""["']cookie["']""", re.IGNORECASE)
    assert {name for name, text in _sources() if header.search(text)} == {"netpolicy.py"}
    found = [bool(header.search(text)) for text in (
        'headers = {"Cookie": sent}', "request.add_header('cookie', sent)", '{"COOKIE": sent}',
        "the line named Cookie", "cookies = {}", '"cookie_token_v2"',
    )]
    assert found == [True, True, True, False, False, False]


# ---------------------------------------------------------------- the token in the repository (rule 3)

# The start of a HoYoLAB login token: "v2_", then base64 of a protobuf whose field 1 holds a small number (2 in an
# ltoken_v2) and whose field 2, the account's id, follows: the bytes 08, the number and 12. Its first four characters
# tell. The repository's own markers are made up and say so ("v2_MARKER-TOKEN-..."), so none is shaped so.
TOKEN_START = re.compile(rb"v2_([A-Za-z0-9+/_-]{4})")
REPOSITORY = SRC.parents[1]
SCANNED_FOLDERS = ("tests", "docs", "src", "cloud", "tools", "packaging", "web/src", "web/e2e", "web/screens")
NOT_SCANNED = {"__pycache__", "node_modules", ".venv", "dist"}


def _token_shaped(data: bytes) -> list[int]:
    """Where in `data` a value shaped like the start of a real login token begins, by its line; never the value."""
    lines = []
    for match in TOKEN_START.finditer(data):
        head = match.group(1).replace(b"+", b"-").replace(b"/", b"_")
        decoded = base64.urlsafe_b64decode(head)
        if decoded[0] == 0x08 and decoded[1] < 0x80 and decoded[2] == 0x12:
            lines.append(data.count(b"\n", 0, match.start()) + 1)
    return lines


def test_no_token_shaped_value_is_in_tests_or_docs():
    # Rule 3: the HoYoLAB token never goes into a test fixture or a commit, nor a part of one. Every file of the
    # repository's own folders, and the files beside them, is read for a value shaped like a real token's start; a
    # value found is named by its file and line alone, so that this test never repeats it.
    files = [path for path in REPOSITORY.iterdir() if path.is_file()]
    files += [path for path in (REPOSITORY / "web").iterdir() if path.is_file()]  # index.html, the configs, package.json
    for folder in SCANNED_FOLDERS:
        files += [
            path for path in (REPOSITORY / folder).rglob("*")
            if path.is_file() and not NOT_SCANNED.intersection(path.relative_to(REPOSITORY).parts)
        ]
    assert len(files) > 500 and REPOSITORY / "tests" / "test_logging_setup.py" in files  # the scan sees the repository
    assert {REPOSITORY / "web" / name for name in ("index.html", "package.json", "vite.config.ts")} <= set(files)
    found = [
        f"{path.relative_to(REPOSITORY).as_posix()}:{line}" for path in files for line in _token_shaped(path.read_bytes())
    ]
    assert found == []
    # Made here, so that no such value is written in this file: an ltoken_v2's start, another cookie's, and the markers.
    def shaped(header: bytes) -> bytes:
        return b"v2_" + base64.urlsafe_b64encode(header + b"MADEUPMADEUP\x1a$").rstrip(b"=")

    assert _token_shaped(b"ltoken_v2=" + shaped(b"\x08\x02\x12\x0c") + b";\n") == [1]
    assert _token_shaped(b"\n\n" + shaped(b"\x08\x04\x12\x0c").replace(b"-", b"+")) == [3]
    assert _token_shaped(b"v2_MARKER-TOKEN-0123456789-ABCDEFGH v2_COOKIE-MARKER-0123456789 v2_LTOKEN-MARKER") == []
    assert _token_shaped(shaped(b"\x08\x92\x12\x0c") + shaped(b"\x0a\x02\x12\x0c")) == []


# ---------------------------------------------------------------- the tests themselves (conftest.py)

def test_every_test_runs_away_from_the_players_own_folders(tmp_path):
    # Only paths are worked out here: nothing is read or written in any of these folders.
    assert os.environ["APPDATA"] == str(tmp_path / "Roaming")
    assert os.environ["LOCALAPPDATA"] == str(tmp_path / "Local")
    assert os.environ["USERPROFILE"] == str(tmp_path / "Profile")  # where the game's log is looked for
    assert gamecache.log_path() == tmp_path / "Profile" / "AppData" / "LocalLow" / "miHoYo" / "Genshin Impact" / "output_log.txt"
    assert standard_data_dir() == tmp_path / "Local" / "GuildBoard"
    assert default_data_dir() == tmp_path / "default-data"
    # Qt finds the Startup folder and the desktop without the variables, so the functions that ask Qt are replaced
    # where they are used. The folder the Startup shortcut starts is Windows' own, and no test's folder is that one.
    assert shell_startup.startup_folder() == shell_app.startup_folder() == tmp_path / "Startup"
    assert shell_startup.desktop_folder() == tmp_path / "Desktop"
    assert shell_startup.shortcut_data_dir() not in (standard_data_dir(), default_data_dir())


def test_a_tests_own_undo_does_not_give_the_players_folders_back(tmp_path, monkeypatch):
    # conftest.py holds the three folders in a patch of its own, so that what a test undoes is only what the test patched.
    monkeypatch.setenv("APPDATA", str(tmp_path / "Other"))
    monkeypatch.undo()
    names = ("APPDATA", "LOCALAPPDATA", "USERPROFILE")
    for name in names:
        assert Path(os.environ[name]).is_relative_to(tmp_path), name
    # A process the test starts inherits them, so a core started there never finds the player's folders either.
    shown = subprocess.run(
        [sys.executable, "-I", "-c", "import os; print(*(os.environ[name] for name in %r), sep='\\n')" % (names,)],
        capture_output=True, text=True, timeout=60,
    )
    assert shown.returncode == 0, shown.stderr
    assert shown.stdout.splitlines() == [os.environ[name] for name in names]


def test_the_desktop_shortcut_of_a_test_goes_on_the_tests_own_desktop(tmp_path):
    # setup.ps1 makes it with make_desktop_shortcut, which finds the desktop through desktop_folder only.
    assert shell_startup.desktop_folder() == tmp_path / "Desktop"  # checked first: the player's desktop is never touched
    assert shell_startup.make_desktop_shortcut()
    assert [path.name for path in (tmp_path / "Desktop").iterdir()] == [shell_startup.SHORTCUT_NAME]


def test_every_test_runs_off_the_internet(refused_requests):
    proxies = urllib.request.getproxies()
    assert (proxies.get("https"), proxies.get("http")) == ("http://127.0.0.1:9", "http://127.0.0.1:9")
    assert "no" not in proxies and "NO_PROXY" not in os.environ
    # Checked before anything is sent: without conftest.py's refusal, the call below would reach HoYoLAB.
    assert netpolicy._open.__qualname__ == "refused_requests.<locals>.refuse"
    with pytest.raises(pytest.fail.Exception, match="tried to contact https://www.hoyolab.com/"):
        netpolicy.fetch_bytes("https://www.hoyolab.com/")
    # Whatever else looks a host up or connects to it is stopped before anything is sent. 192.0.2.1 is an address kept
    # for examples, which reaches no computer.
    with pytest.raises(PermissionError, match="tried to reach 192.0.2.1"):
        socket.getaddrinfo("192.0.2.1", 443, flags=socket.AI_NUMERICHOST)
    with socket.socket() as connection, pytest.raises(PermissionError, match="tried to reach 192.0.2.1"):
        connection.settimeout(1)
        connection.connect(("192.0.2.1", 443))
    assert socket.getaddrinfo("127.0.0.1", 9, flags=socket.AI_NUMERICHOST)  # this PC stays open
    assert refused_requests == ["https://www.hoyolab.com/", "socket.getaddrinfo 192.0.2.1", "socket.connect 192.0.2.1"]
    refused_requests.clear()  # these were made on purpose; conftest.py fails a test that leaves one behind


def test_only_no_host_localhost_and_loopback_addresses_stay_on_this_pc():
    hosts = (None, "", "localhost", b"LOCALHOST", "127.0.0.1", "127.8.9.10", "::1",
             "127.example.net", "192.0.2.1", "::ffff:192.0.2.1", "www.hoyolab.com", b"github.com")
    assert [beyond_this_pc(host) for host in hosts] == [False] * 7 + [True] * 5


def test_the_map_views_stay_on_hoyoverse_and_keep_the_session_in_memory_only():
    from guildboard import maptabs

    assert netpolicy.is_hoyoverse(maptabs.DEFAULT_URL)
    views = (SRC / "shell/maphost.py").read_text(encoding="utf-8")
    assert "netpolicy.is_hoyoverse" in views  # a view navigates to HoYoLAB's own pages only
    assert "QWebEngineProfile()" in views  # without a name: kept in memory only
    for persistent in ("setPersistentStoragePath", "setPersistentCookiesPolicy", "setCachePath", "QWebEngineProfile(\""):
        assert persistent not in views
    assert "map_session" not in (SRC / "api/app.py").read_text(encoding="utf-8")  # no route hands out the session


# L30 (the audit of 2026-11-01), an accepted exception. Qt WebEngine 140 never collects the documents of the interface's
# pages left behind, and the window grew by 10 to 25 MB with each page change until the interface could ask for a
# collection (the Characters design, 11.7: 287 MB after ten cards, 79 with it). The engine's flag for it is the whole
# engine's, so HoYoverse's pages in the login, the verify page and the map can ask for a collection too. Accepted: a
# collection reveals nothing of a page and changes nothing outside its memory, those views go to HoYoverse's own pages
# alone, and the page lifecycle cannot do the same while the window shows (Qt neither freezes nor discards a visible
# page, and the window's view is let go of already when it hides); recreating the view every few pages would reload the
# interface in front of the player. The flag is pinned here under its private name, and the shell opens nothing else of
# the engine to pages.
ACCEPTED_ENGINE_FLAG = "--js-flags=--expose-gc-as=gbCollect"


def test_the_engine_opens_nothing_to_pages_but_the_accepted_collection(monkeypatch):
    assert shell_app.COLLECTION_FLAG == ACCEPTED_ENGINE_FLAG
    # Set, not deleted, so that what configure_qt writes goes when the test does.
    for name in ("QTWEBENGINE_CHROMIUM_FLAGS", "QTWEBENGINE_REMOTE_DEBUGGING", "QTWEBENGINE_DISABLE_SANDBOX"):
        monkeypatch.setenv(name, "")
    shell_app.configure_qt()
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == ACCEPTED_ENGINE_FLAG  # no other switch of the shell's own
    # And on the player's own data no switch reaches the engine from the environment (L31).
    monkeypatch.setenv("QTWEBENGINE_CHROMIUM_FLAGS", "--remote-debugging-port=9222 --js-flags=--allow-natives-syntax")
    shell_app.configure_qt()
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == ACCEPTED_ENGINE_FLAG
    # The one other switch is the player's Smooth animations, which only takes the frame limit away.
    assert shell_app.FRAME_LIMIT_FLAG == "--disable-frame-rate-limit"
    shell_app.configure_qt(smooth=True)
    assert os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] == f"{ACCEPTED_ENGINE_FLAG} --disable-frame-rate-limit"
    named = {
        name for name, text in _sources() if re.search(r"QTWEBENGINE_CHROMIUM_FLAGS|--js-flags|expose-gc", text)
    }
    assert named == {"shell/app.py"}


def test_the_login_and_verify_views_stay_on_hoyoverse_and_keep_the_login_in_memory_only():
    # L17: the login window and the verification window show HoYoLAB's pages in a browser with no address bar. Their
    # main frame goes to HoYoverse's sites and the sign-in pages HoYoLAB offers alone (by their exact hosts, over
    # https), the login's pop-ups open only there, never empty, and two at most, no address of another scheme is handed
    # to a program of Windows', and their profiles keep nothing on disk. No caller loosens that: no module passes an
    # `allowed` of its own to either window, so their own default is what runs.
    from guildboard.shell import login

    assert login.SIGN_IN_HOSTS == (
        "accounts.google.com", "www.facebook.com", "m.facebook.com", "appleid.apple.com", "x.com", "twitter.com",
        "api.twitter.com", "discord.com",
    )
    sources = dict(_sources())
    assert "netpolicy.is_hoyoverse(url)" in _module_function_text(sources["shell/login.py"], "sign_in_site")
    for name in ("shell/login.py", "shell/verify.py"):
        views = sources[name]
        assert "def acceptNavigationRequest(" in views and "DisallowUnknownUrlSchemes" in views, name
        assert "allowed: Callable[[str], bool] = sign_in_site," in views, name  # the window's own default
        assert "QWebEngineProfile(" in views, name  # without a name: kept in memory only
        for persistent in ("setPersistentStoragePath", "setPersistentCookiesPolicy", "setCachePath", "QWebEngineProfile(\""):
            assert persistent not in views, (name, persistent)
    assert re.search(r"^MOST_POPUPS = 2\b", sources["shell/login.py"], flags=re.MULTILINE)
    # No call passes `allowed=` to a window, nor binds one to it, as functools.partial would.
    windows = {"LoginWindow", "VerifyWindow"}
    for name, text in sources.items():
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, ast.Call) and any(keyword.arg == "allowed" for keyword in node.keywords):
                called = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                assert not ({called} | {arg.id for arg in node.args if isinstance(arg, ast.Name)}) & windows, name
    # The shell makes each with its own default: the class itself.
    app = sources["shell/app.py"]
    assert "login: Callable[[], QWidget] = LoginWindow\n" in app
    assert "verify: Callable[[Mapping[str, str]], QWidget] = VerifyWindow\n" in app


def _function_text(text: str, name: str) -> str:
    """The source of the method `name`, up to the next method or section of the class."""
    match = re.search(rf"^    (?:async )?def {name}\(.*?(?=^    (?:async )?def |^    # ---|\Z)", text, re.S | re.M)
    assert match, name
    return match.group(0)


def test_the_check_in_claim_goes_only_on_the_players_press():
    # The second exception to "only read account data" (the daily check-in design): the day's reward, when the player
    # presses Claim. Never by a timer, a sync or a start: the library's claim is named once, in HoyolabSource.claim_checkin,
    # which CheckIn.claim alone calls, which the one POST route alone calls.
    sources = dict(_sources())
    assert {name for name, text in sources.items() if re.search(r"\bclaim_daily_reward\b", text)} == {"sources/hoyolab.py"}
    assert len(re.findall(r"\bclaim_daily_reward\b", sources["sources/hoyolab.py"])) == 1
    assert {name for name, text in sources.items() if re.search(r"\.claim_checkin\(", text)} == {"checkin.py"}
    checkin = sources["checkin.py"]
    assert len(re.findall(r"\.claim_checkin\(", checkin)) == 1
    assert ".claim_checkin(" in _function_text(checkin, "claim")
    assert {name for name, text in sources.items() if re.search(r"\.checkin\.claim\b", text)} == {"api/app.py"}
    app = sources["api/app.py"]
    assert len(re.findall(r"\.checkin\.claim\b", app)) == 1
    assert 'app.post("/api/checkin/claim")' in app and "core.checkin.claim" in _route_text(app, "checkin_claim")
    assert re.findall(r"[\w.]*\bclaim\(", checkin) == ["claim("]  # its definition: nothing inside the module calls it


def test_redeeming_is_only_on_the_players_action_and_the_only_write_beside_the_check_in():
    # The first exception to "only read account data" (the gift codes design, section 1): a gift code the player typed,
    # pasted or clicked to redeem. The test above has the second.
    sources = dict(_sources())
    where = {name for name, text in sources.items() if re.search(r"\bredeem_code\b", text)}
    assert where == {"sources/hoyolab.py"}
    assert len(re.findall(r"\bredeem_code\b", sources["sources/hoyolab.py"])) == 1
    # HoyolabSource.redeem is called from Core's sender alone, which only _start_codes starts, which only the two
    # methods the player's two POST routes reach call.
    calls = {name for name, text in sources.items() if re.search(r"\.redeem\(", text)}
    assert calls == {"core.py"}
    core = sources["core.py"]
    assert len(re.findall(r"\.redeem\(", core)) == 1 and ".redeem(" in _function_text(core, "_send_codes")
    assert re.findall(r"\b_send_codes\(", core) == ["_send_codes(", "_send_codes("]  # its definition and one call
    assert "_send_codes(" in _function_text(core, "_start_codes")
    starts = re.findall(r"self\._start_codes\(", core)
    assert len(starts) == 2
    assert "_start_codes(" in _function_text(core, "redeem_codes") and "_start_codes(" in _function_text(core, "redeem_live")
    for name, text in sources.items():
        for method in ("redeem_codes", "redeem_live"):
            if name == "core.py":
                assert len(re.findall(rf"\b{method}\b", text)) == 1, method  # the definition alone
            elif name == "api/app.py":
                continue
            else:
                assert not re.search(rf"\b{method}\b", text), f"{method} appears in {name}"
    app = sources["api/app.py"]
    assert re.findall(r"core\.redeem_(?:codes|live)\b", app) == ["core.redeem_codes", "core.redeem_live"]
    assert 'app.post("/api/codes/redeem")' in app and 'app.post("/api/codes/redeem-live")' in app
    assert "core.redeem_codes" in _route_text(app, "codes_redeem")
    assert "core.redeem_live" in _route_text(app, "codes_redeem_live")
    # No other method of the library that changes anything is named: not redeem*, claim*, sign*, set_* or update_*.
    for name, text in sources.items():
        if name == "sources/hoyolab.py":
            text = text.replace("client.redeem_code(", "").replace("client.claim_daily_reward(", "")
            assert not re.search(r"\.(?:redeem|claim|sign|set_|update_)\w*\(", re.sub(r"self\._tokens\.update_cookies", "", text)), name
            assert not re.search(r"""["'](?:(?:redeem|claim|sign)_|set_|update_)\w+["']""", text), name


def _route_text(text: str, name: str) -> str:
    match = re.search(rf"^    async def {name}\(.*?(?=^    @app\.|\Z)", text, re.S | re.M)
    assert match, name
    return match.group(0)
