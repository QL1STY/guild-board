# Security

## Report a problem privately

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting instead: on the repository's Security tab, choose Report a vulnerability. Say what you found, how to see it, and which version of Guild Board you used. A reply may take a few days, as this is a hobby project looked after by one person.

Anything that could expose a HoYoLAB login, a wish or Feedback key, or the online account's data counts, as does a way to make Guild Board touch the game or its folders where it must not.

## What protects you

- Every installer is built by GitHub Actions in this repository from a tagged commit, and carries an attestation that says so (below).
- Installed copies update only to an installer carrying a signature by a release key whose public half is pinned in `src/guildboard/selfupdate.py`. The private half is kept off GitHub.
- `tests/test_handsoff.py` enforces what Guild Board may and may not touch: the game's files and process, where the login lives, and the addresses it talks to. It is only ever tightened, except when the maintainer changes a rule in `CLAUDE.md`, as on 2026-11-06 to allow public pictures from outside HoYoverse.

## Check an installer before you run it

Two checks cover two things. The attestation says GitHub built this exact file from a commit of this repository. The signature says the maintainer, who alone holds the release key, published it.

1. Download the installer from the [releases page](https://github.com/QL1STY/guild-board-releases/releases/latest).
2. Install the [GitHub CLI](https://cli.github.com/) and run, in the folder that holds the file:

   ```powershell
   gh attestation verify "Guild.Board.Setup.1.0.0.exe" --repo QL1STY/guild-board
   ```

   Use the file's own name. A pass names the repository, the workflow `.github/workflows/release.yml` and the commit it was built from; read the commit on GitHub if you want to see exactly what was built. A failure, or an answer that names another repository, means the file is not one this project built: do not run it.
3. The same SHA-256 is in the workflow run's artifact, in the `.sha256` file. `Get-FileHash "Guild.Board.Setup.1.0.0.exe"` in PowerShell shows yours.

Installed copies check the release key's signature themselves: they offer an update only when the release carries a `.sig` file beside the installer that checks against the release key pinned in `src/guildboard/selfupdate.py`, and they check the downloaded file's size and SHA-256 against what GitHub says. The signature is made on the maintainer's PC by `tools/sign-release.ps1`, after it has checked the attestation and the SHA-256 of what the workflow built. The workflow has no access to the key. An attestation exists only for a public repository; a build in a private copy has none.

[`PRIVACY.md`](PRIVACY.md) says what Guild Board keeps and what the online features send.
