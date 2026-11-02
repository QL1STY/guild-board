"""Command line entry point."""
from __future__ import annotations

import argparse
import asyncio
import logging
import socket
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, Sequence

import truststore
import uvicorn

from guildboard import characters, netpolicy
from guildboard.api.app import create_app
from guildboard.cloud import invite_code
from guildboard.config import AppPaths, default_data_dir
from guildboard.core import Core
from guildboard.logging_setup import setup_logging, shutdown_logging
from guildboard.store import StoreError


_TLS_READY = False


def use_the_windows_store() -> None:
    """Have every TLS connection of this process verified through Windows' own chain building, once, before any request. The
    certificates OpenSSL reads from the store are those the PC holds already; Windows fetches a root it lacks on the way, and a
    fresh PC could not reach HoYoverse until another program had made it fetch one. The frozen build calls this too: it is
    the one entry (main_app and main_tray come through main). Where truststore cannot, the default roots stay."""
    global _TLS_READY
    if _TLS_READY:
        return
    _TLS_READY = True
    try:
        truststore.inject_into_ssl()
        netpolicy.take_the_tls_in_use()
    except Exception:  # a connection then fails with its own reason, which the player is told
        logging.getLogger(__name__).warning("The Windows certificate store could not be used for TLS", exc_info=True)


def default_web_dir() -> Path:
    """Where the built interface lives: <project>/web/dist, or web/dist in the installed copy's own folder."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "web" / "dist"
    return Path(__file__).resolve().parents[2] / "web" / "dist"


def _announce(link: str) -> None:
    """Print the launch link at once. A program that started Guild Board reads it from a pipe, where
    output would otherwise be held back until the process ends."""
    print(link, flush=True)


async def _stop_when(stop: asyncio.Event, server: uvicorn.Server, core: Core) -> None:
    await stop.wait()
    core.bus.publish("shutdown")  # ends the open event streams, which would keep the server waiting
    server.should_exit = True


async def run_headless(
    paths: AppPaths,
    *,
    demo: bool,
    port: int = 0,
    ready: Callable[[str], None] = _announce,
    stop: asyncio.Event | None = None,
    demo_now: datetime | None = None,
    invite: str | None = None,
) -> int:
    """Run the core alone, serving the API on 127.0.0.1, until interrupted or `stop` is set. `invite` is the code of an
    invite link this start was opened with."""
    core = Core(paths, demo=demo, demo_now=demo_now)
    if invite is not None:
        await core.online.offer_invite(invite)
    await serve(core, port=port, web_dir=default_web_dir(), ready=ready, stop=stop)
    return 0


async def serve(
    core: Core,
    *,
    port: int = 0,
    web_dir: Path | None = None,
    ready: Callable[[str], None] = _announce,
    stop: asyncio.Event | None = None,
) -> None:
    """Start the core and serve the API and the interface on 127.0.0.1 until `stop` is set; then stop
    the core. `ready` receives the launch link once connections are accepted."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    watcher: asyncio.Task[None] | None = None
    try:
        listener.bind(("127.0.0.1", port))
        listener.listen(128)  # from here on a connection is queued, so the link can be announced
        bound = listener.getsockname()[1]
        app = create_app(core, bound, web_dir)
        # log_config=None: the server's own messages go to Guild Board's log file, not only to the console.
        # timeout_graceful_shutdown: a connection that stays open cannot keep Guild Board from closing.
        server = uvicorn.Server(uvicorn.Config(app, log_level="warning", log_config=None, timeout_graceful_shutdown=3))
        core.start()
        ready(f"http://127.0.0.1:{bound}/launch?k={core.launch_secret}")
        if stop is not None:
            watcher = asyncio.create_task(_stop_when(stop, server, core))
        await server.serve(sockets=[listener])
    finally:
        if watcher is not None:
            watcher.cancel()
        await core.stop()
        listener.close()


def main(argv: Sequence[str] | None = None) -> int:
    use_the_windows_store()
    parser = argparse.ArgumentParser(prog="guildboard", description="Guild Board")
    parser.add_argument("link", nargs="?", default=None, help="an invite link, which Windows hands over when one is opened")
    parser.add_argument("--demo", action="store_true", help="run on a synthetic account, with no network access")
    parser.add_argument("--no-shell", action="store_true", help="run the core alone and print a launch link")
    parser.add_argument("--port", type=int, default=0, help="port to listen on (default: any free port)")
    parser.add_argument("--data-dir", type=Path, default=None, help="folder for the database, settings and logs")
    parser.add_argument(
        "--demo-now", default=None,
        help="with --demo: the instant the demo clock starts at, for example 2026-10-13T08:00:00+00:00",
    )
    parser.add_argument("--hidden", action="store_true", help="start in the tray, without opening the window")
    parser.add_argument("--quit", action="store_true", help="ask the running Guild Board to quit, and wait until it has")
    parser.add_argument(
        "--acknowledged", action="store_true", help="with --demo: the first-run statement has been read already"
    )
    parser.add_argument(
        "--week-and-endgame", action="store_true",
        help="with --demo: show Your week and Endgame, which are hidden (the browser tests run with them shown)",
    )
    args = parser.parse_args(argv)
    if args.week_and_endgame and not args.demo:
        print("--week-and-endgame needs --demo.")
        return 2
    if args.week_and_endgame:
        characters.WEEK_AND_ENDGAME = True
    if args.acknowledged and not args.demo:
        print("--acknowledged needs --demo.")
        return 2
    if args.no_shell and (args.hidden or args.quit):
        print("--hidden and --quit are for Guild Board with its window. Leave out --no-shell.")
        return 2
    demo_now = None
    if args.demo_now is not None:
        if not args.demo:
            print("--demo-now needs --demo.")
            return 2
        try:
            demo_now = datetime.fromisoformat(args.demo_now)
        except ValueError:
            demo_now = None
        if demo_now is None or demo_now.tzinfo is None:
            print("--demo-now needs a date and time with a time zone, for example 2026-10-13T08:00:00+00:00.")
            return 2
    # Anything else in its place is ignored: another program can start Guild Board with any argument.
    invite = invite_code(args.link) if args.link is not None else None
    paths = AppPaths(args.data_dir or default_data_dir(demo=args.demo))
    paths.ensure()
    try:
        if not args.no_shell:
            # Qt is loaded only for Guild Board with its window. The shell opens the log itself, once it knows
            # that this start is the one that runs.
            from guildboard.shell import app as shell_app

            return shell_app.run_shell(
                paths, demo=args.demo, hidden=args.hidden, acknowledged=args.acknowledged, quit=args.quit,
                demo_now=demo_now, invite=invite,
            )
        setup_logging(paths.logs_dir)
        return asyncio.run(run_headless(paths, demo=args.demo, port=args.port, demo_now=demo_now, invite=invite))
    except KeyboardInterrupt:
        return 0
    except StoreError as error:
        print(str(error))
        return 1
    except Exception:
        # The log closes below, before Python reports the error, so it is written here; under pythonw nothing else
        # would show it.
        logging.getLogger("guildboard").exception("Guild Board stopped on an error nothing expected")
        raise
    finally:
        shutdown_logging()


def main_app() -> int:
    """Guild Board with its window, and no console."""
    return main(sys.argv[1:])


def main_tray() -> int:
    """Guild Board in the tray. A shortcut made by Qt carries no arguments, so starting hidden needs a program
    of its own."""
    return main(["--hidden", *sys.argv[1:]])


if __name__ == "__main__":
    sys.exit(main())
