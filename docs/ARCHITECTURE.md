# How Guild Board fits together

Guild Board is a Windows program in four parts: a **core** in Python, a **shell** in Qt, an **interface** in React, and an optional **online project** on Supabase. This page says what each does, where the data lives, how a sync and an update work, and what stops the program from doing what it must not. Rules and commands for contributors are in `CLAUDE.md`.

## The parts

**The core** (`src/guildboard/`). One Python process holds all the program's logic: the SQLite store (`store.py`), the sync of HoYoLAB data (`sync/`), the achievements, timers, pulls, ledger, characters and the other features (`achievements/`, `timers/`, `pulls/`, `ledger/`, `characters/`), the online account (`cloud/`), the update check (`selfupdate.py`) and a local HTTP API (`api/app.py`, FastAPI). `core.py` builds all of it as one `Core`. The API listens on `127.0.0.1` only, and every `/api` request needs a session cookie that the launch link gives to whoever holds a secret made at the start. The built interface is served by the same server.

**The shell** (`src/guildboard/shell/`). PySide6. It runs the core on a thread of its own (`corethread.py`), opens the interface in a Qt WebEngine window (`dashboard.py`), and adds a tray icon, the HoYoLAB login window (`login.py`), HoYoLAB's map views (`maphost.py`) and the overlay (`overlay.py`). The overlay is a see-through window of Guild Board's own over a display; it does not look for, activate or send input to the game. Only one Guild Board runs per data folder (`instance.py`). `guildboard --demo --no-shell` runs the core alone, for a browser.

**The interface** (`web/`). React, TypeScript and Vite. It is built to `web/dist`, which the core serves. It loads nothing from the internet and talks only to the core's API; every picture it shows is fetched by the core and served locally. Times on screen follow the core's clock.

**The online project** (`cloud/`). One Supabase project: Postgres tables with row level security, two Edge Functions, one for the sign-in's userinfo and one for invite links, and SQL tests. The app reaches it only through `cloud/client.py` and `netpolicy.fetch_cloud`, and only after the player signs in with Discord. Everything else in the app works without it. `cloud/README.md` says how a fork sets up its own project.

The sources of data are behind small seams: `sources/hoyolab.py` is the only module that imports the `genshin` library, and `sources/demo.py` stands in for it in the demo, which makes up an account and never contacts anything.

## Where data lives

Everything the player has lives in one folder, `%LOCALAPPDATA%\GuildBoard` (`GUILDBOARD_DATA_DIR` or `--data-dir` change it; the demo uses `GuildBoard-demo`). It holds:

- `guildboard.db`, the SQLite database. Its schema version is `PRAGMA user_version`; a migration takes a backup first.
- `token.bin`, the HoYoLAB session token, encrypted with Windows DPAPI for this Windows user (`tokenstore.py`). `cloud.bin` is the online account's session, kept the same way (`cloud/session.py`). Neither goes into a log, an API response, the database, a backup or a test fixture.
- `settings.json`, `logs/`, `backups/` (a copy a day, and the files the player makes), `cache/` (pictures read from HoYoverse's hosts), and the screenshot gallery's thumbnails when the gallery is on.

Guild Board writes only inside this folder, apart from a file the player chooses to export and the desktop shortcut. It reads the game's folders only on the player's press (Pulls and Ledger import) or while the gallery is on, read-only.

## A HoYoLAB sync

HoYoLAB data is fetched in groups (`records.py`): overview, notes, characters, endgame, diary and calendar. `sync/policy.py` holds the rules as pure functions of the clock and the history: at least five minutes between runs, at most 24 a day, a group due again after its own interval (some every run, characters every 6 hours, endgame every 12, the diary and calendar once a game day), and nothing while syncing is paused or HoYoLAB asks for a login or a verification check. `sync/scheduler.py` turns events into runs: at start, after a play session, on request and on an interval while the game runs. `sync/runner.py` fetches the due groups through `sources/hoyolab.py` and `sync/apply.py` stores each result. The pages are told by events (`events.py`) and read again.

Whether the game runs is read from the Windows process list (`gamewatch.py`); nothing else about the game is known.

## An online sync

This copies the player's own data (ticks, timers, layouts, wishlist, gift codes, character plans and so on) between their PCs through their account. It is off until the player signs in.

- **What is copied.** `KINDS` in `cloud/sync.py` lists the tables, each with the columns that name a row on every PC. Fetched or derived tables are not copied: each PC fetches those itself. A few settings are copied; the ones that belong to one PC are not.
- **Pushing.** Triggers in the store (schema 12, `store.py`) write one line in `sync_outbox` for each change the player makes. Once nothing has changed for ten seconds, the lines go up in batches through the project's `sync_push` function. The newest edit of a row wins, by its time; a delete is a row too and reaches the other PCs.
- **Pulling.** At the start and every five minutes the PC reads the rows that arrived after the last it saw. A row that arrives is applied with the store's gate shut, so that it makes no outbox line of its own.
- **Limits.** `sync_push` keeps what one player holds within a number of rows and bytes, and how much they write in an hour. The number of accounts that hold a copy is limited too: past 300 places a new account's first push is refused and its data stays on its PC, while friends and stats go on. The project's owner changes these limits in the SQL editor (`cloud/README.md`), and Settings shows each player the room their copy takes (`sync_usage`). The program itself stops syncing when its PC's clock is more than a minute off the server's, and two game accounts never share one online account.
- **Never sent.** The HoYoLAB token and cookies, wish and Feedback keys, any HoYoLAB response and anything from the game's folders. `tests/test_handsoff.py` checks this.

Besides the data sync, the signed-in program sends the player's profile (name, UID, AR, picture link), the stats they switched on, their pins and presence, and reads their friends' shared ones.

## An update

Only an installed copy updates itself; a checkout and the demo never ask. `selfupdate.py` asks the player's releases repository on GitHub (`QL1STY/guild-board-releases`, through `netpolicy.fetch_latest_release`) a minute after the start and then every 12 hours whether a newer release exists. A release is offered only when it also carries a signature, in a file named like the installer with `.sig` added: ECDSA P-256 over the release's tag and its installer's name, size and SHA-256, checked by Windows' own CNG against the public release key pinned in `selfupdate.py` (`RELEASE_KEY`). The private key stays on the maintainer's PC (`tools/make-release-key.ps1`, `tools/release-signing.ps1` and `release.ps1` make and use it), so a release put on GitHub by someone else is not offered. On the player's press the installer is downloaded into the data folder, checked against the size and SHA-256 that were signed, and started silently; it asks Guild Board to quit, installs per user with no administrator rights, and starts the new version. The player's data is left as it is. `build-installer.ps1` builds the installer with PyInstaller and Inno Setup (`packaging/`).

## What the hands-off test enforces

`tests/test_handsoff.py` turns the rules in `CLAUDE.md` into checks, and runs in the whole suite. Among them:

- **Requests.** Only `netpolicy.py` and the HoYoLAB source can open a connection, and `netpolicy` sends requests only to HoYoLAB, HoYoverse and Mihoyo hosts, one address on GitHub for Paimon.moe's achievement list, the releases repository, and the Supabase project's host. A source scan fails on any other client or socket, and every test runs with the network refused.
- **Files.** A demo session, a live start and a start with the window each write only inside their data folder. No code touches the game's install folder or the registry, and the game's files are read only by the import presses and the gallery, never written.
- **The game.** No handle to the game process, no memory access, no injection, no input, no screen capture. A scan fails on the Windows functions that would do it.
- **Secrets.** The token, the online session, wish and Feedback keys and the login's cookies never reach a log, a response, the database or the cloud. No value shaped like a login token is in any file of the repository.
- **Writes to HoYoLAB.** The calculator is only read and its sync is never switched on. Redeeming a code and claiming the check-in happen only on the player's own action.
- **Updates.** An update is offered only with a valid signature by the pinned key.
- **Imports.** `genshin` is imported in one module only.

A failing hands-off test means the code is wrong, not the test.
