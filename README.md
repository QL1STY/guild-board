# Guild Board

Unofficial and fan-made. Not affiliated with or endorsed by HoYoverse or COGNOSPHERE.

Guild Board is a Windows companion for Genshin Impact. It reads your HoYoLAB account, with the login you give it, and keeps what it finds on your own PC: what is left to explore, your achievements, timers and commissions, your pulls and their history, your characters and what they need, and how your play changes over time. It can show a small overlay over the game. Unless you sign in to its optional online features, nothing about you reaches its developer.

<!-- TODO: screenshots (npm run screens:readme takes them from the demo's made-up account). -->

## Download

Windows 10 or 11. Get the installer from the [latest release](https://github.com/QL1STY/guild-board-releases/releases/latest). It needs no administrator rights, and an update or an uninstall leaves your data where it is. An installed copy checks the same page for a newer version and offers it.

An installed copy updates only to an installer that carries a signature by the release key pinned in `src/guildboard/selfupdate.py`.

To check an installer before you run it, see [`SECURITY.md`](SECURITY.md): `gh attestation verify` shows which commit of this repository GitHub built it from.

Want to look around first? Guild Board has a demo mode on a made-up account that contacts nothing.

## What it reads

From HoYoLAB, with your own login:

- Your account summary and counters: achievements, days active, chests, oculi and waypoints.
- How far each region and area is explored, with its offerings and reputation.
- Resin and the other Real-Time Notes, and which Archon Quest chapters are still open.
- Your characters, your Spiral Abyss, Imaginarium Theater and Stygian Onslaught results, and your primogem income.
- The current banners and events.
- Your daily check-in: this month's rewards and how many you claimed.
- Your characters' builds, and how many materials you hold, from HoYoLAB; character, weapon and artifact pages and pictures from the HoYoLAB wiki.

Everything stays in one folder on your PC, `%LOCALAPPDATA%\GuildBoard`. Nothing is uploaded unless you sign in to an online account. What an online account sends, and what it does not, is in the [privacy notice](PRIVACY.md).

## What it never does

- It never changes, adds or deletes anything in the game's folder or in the game's Windows settings. The only things it reads there are the game's log and the wish-history links in its web cache, read-only, and only when you press Import on the Pulls page.
- It never opens the game's process, reads or writes its memory, or hooks into it. All it learns about the game is whether it is running.
- It never sends keys or clicks to the game and never captures its screen.
- Your HoYoLAB login is kept only on this PC, encrypted for your Windows user. It is never written to a log and never sent anywhere but to HoYoverse. A wish-history link's key is kept in memory only, never on disk: for the import, and for up to a day after it to fetch new wishes.
- It talks only to HoYoverse's own sites: hoyolab.com, hoyoverse.com and mihoyo.com. The exceptions are Paimon.moe's public achievement list on GitHub, downloaded only when you ask to check for new achievements, the check for a new version of Guild Board on GitHub, and, only after you sign in to an online account, Guild Board's own server.
- It only reads your account, except to redeem a gift code that you typed, pasted or clicked to redeem, and to claim the daily check-in reward when you press Claim. It never posts, claims or changes anything else for you.
- It never changes anything else on your HoYoLAB account, not even the calculator's sync setting.
- It reads your wish history and your game's own history pages (primogems, crystals, resin, artifacts) with a read-only key HoYoverse gives your HoYoLAB login, kept in memory only (or, without a login, the link the game writes when you open Feedback), and only reads.
- With the gallery on, it looks at the pictures in the game's ScreenShot folder and never moves, changes or deletes one.

`tests/test_handsoff.py` checks these rules against the code, and it may only be tightened.

## The risk

Guild Board is a third-party tool. Please read this before you use it.

Reading your account through HoYoLAB with your own login is low-risk, but not zero-risk.

The developer of the most widely used tool of this kind says that no user has ever reported a ban. Any third-party access is still technically against the Terms of Service, and if action were ever taken, it would plausibly be against the HoYoLAB account rather than the game account.

HoYoverse's terms of service restrict its services to individual, non-commercial enjoyment and bar software that gives an unfair advantage or disrupts the service, and HoYoverse tells players not to use third-party plug-ins. Guild Board gives no advantage in play and does not take part in the game, but it is not made or approved by HoYoverse, and you use it at your own risk.

The saved login cannot log in to the game, change your password or show your email address. It can act on HoYoLAB as you, which is why Guild Board keeps it encrypted and uses it only to read, apart from the two things you ask for: redeeming a gift code and claiming the daily check-in reward.

If HoYoverse asks for something here to change or stop, it changes or stops.

## Build it from source

You need Windows, [uv](https://docs.astral.sh/uv/) with Python 3.12, and Node.js 22.

```powershell
git clone https://github.com/QL1STY/guild-board.git
cd guild-board
powershell -ExecutionPolicy Bypass -File setup.ps1
```

`setup.ps1` installs the Python packages and the interface's, builds the interface and puts a shortcut on your desktop. Then:

- `uv run guildboard --demo` runs Guild Board with its window on made-up data. Add `--no-shell` to run the core alone and get a link for your browser.
- `uv run pytest` runs the Python tests. In `web/`, `npm test` runs the interface's unit tests and `npm run e2e` its browser tests.
- `powershell -ExecutionPolicy Bypass -File build-installer.ps1` makes the installer. It refuses to build until a release key is pinned in `src/guildboard/selfupdate.py`; `-WithoutReleaseKey` builds an installer that never updates.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) says how the parts fit together, and [`CONTRIBUTING.md`](CONTRIBUTING.md) how to help.

## Licence

Guild Board is free software under the [MIT licence](LICENSE). The software inside it has licences of its own, listed in [`THIRD-PARTY-NOTICES.txt`](THIRD-PARTY-NOTICES.txt) and in Settings, under About, as Open-source licences. The achievement list comes from [Paimon.moe](https://github.com/MadeBaruna/paimon-moe)'s public data, also MIT licensed.

This repository holds no game art. Guild Board reads HoYoverse's official pictures and wiki entries while it runs, into a cache on your PC; the game's text in the achievement list comes from Paimon.moe's data.

Unofficial and fan-made. Not affiliated with or endorsed by HoYoverse or COGNOSPHERE. Genshin Impact is a trademark of its owner.
