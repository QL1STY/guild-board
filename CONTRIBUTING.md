# Contributing

Guild Board is a small hobby project, and help is welcome. For anything larger than a fix, open an issue first so that no work is wasted. It has a [code of conduct](CODE_OF_CONDUCT.md), and a security problem goes through [`SECURITY.md`](SECURITY.md), not an issue.

## Set up

You need Windows, [uv](https://docs.astral.sh/uv/) with Python 3.12, and Node.js 22.

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

That installs the Python packages and the interface's, builds the interface and makes a desktop shortcut. To look at the program, run `uv run guildboard --demo` (add `--no-shell` to get a link for a browser). The demo runs on a made-up account and contacts nothing. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) says how the parts fit together.

## Tests

Write the test first, and make one commit for each task.

- `uv run pytest` runs the Python tests. A few need Windows.
- In `web/`, `npm ci` once, then `npm test` for the unit tests and `npm run e2e` for the browser tests, which build the interface and run each against a fresh demo core in Microsoft Edge.

## The rules that are never broken

These are enforced by `tests/test_handsoff.py`, which may only be tightened. If it fails, fix the code, not the test. The full text is in [`CLAUDE.md`](CLAUDE.md); in short:

- Nothing is created, changed or deleted in the game's install folder or its registry key, and the only game files read, read-only, are the ones `CLAUDE.md` names.
- Guild Board never opens a handle to the game process, reads its memory, injects into it, hooks it, sends it input or captures its screen. It knows only whether the game is running.
- The HoYoLAB token lives only in `token.bin`, encrypted with DPAPI, and never reaches a log, an API response, the database, a test fixture or a commit.
- Guild Board's own requests go only to the hosts `CLAUDE.md` lists, and only read account data, apart from redeeming a gift code the player asked for and the daily check-in they press Claim on.
- `genshin` is imported only in `src/guildboard/sources/hoyolab.py`.
- The online features reach one host, the player's Supabase project, and never carry the HoYoLAB login, a wish or Feedback key, or anything from the game's folders.

A new table the player makes rows in needs a decision about sync: a kind of its own with a migration, or a reason why it stays on the PC.

## Releases

Only the maintainer releases; a contributor needs none of this. A release is built in the open and signed in private, so that anyone can see which commit an installer came from and the release key never leaves the maintainer's PC.

1. Set the version in `pyproject.toml` and `src/guildboard/__init__.py`, run `uv lock`, add the version's entry to `src/guildboard/reference/changes.json`, and commit.
2. Tag that commit and push the tag: `git tag -a v1.0.0 -m "Guild Board 1.0.0"`, then `git push origin v1.0.0`.
3. The workflow `.github/workflows/release.yml` starts. It stops with a plain sentence if the tag is not the version in `pyproject.toml`. Otherwise it runs the Python and interface tests, builds the installer with `build-installer.ps1`, attests it (a public repository only) and keeps the installer and a text file of its SHA-256 as a workflow artifact. It holds no secret and no token, and it publishes nothing.
4. When the run has succeeded, on the maintainer's PC: `powershell -ExecutionPolicy Bypass -File tools\sign-release.ps1 -Tag v1.0.0`. It needs `gh` logged in as `QL1STY` and `GUILDBOARD_RELEASE_KEY` naming the release key's file. It downloads the installer into a new folder outside the repository, checks its SHA-256 and `gh attestation verify`, makes a draft in `QL1STY/guild-board-releases`, signs the installer with the release key, and publishes the draft only when GitHub shows the signature beside the installer. At any failure it stops with nothing published.
5. A trial on a private copy of the repository: run the workflow on a tag, then `tools\sign-release.ps1 -Tag v1.0.0 -Repo <owner>/<name> -NoAttestation`. `-NoAttestation` is refused for a public repository, where the attestation is the proof.

Every action in a workflow is pinned to a full commit SHA, with its version in a comment, and a workflow never reads a secret (`tests/test_release_workflow.py`).

## Messages

Anything a player can read is plain, factual English: say what happened and what to do, with no jokes and no blame. Commit messages are short and say what changed and why.

## Pull requests

Keep one change in each, with its tests, and say what you ran. A pull request is licensed under the project's [MIT licence](LICENSE). If HoYoverse asks for something to change or stop, it changes or stops, and the maintainer decides how.
