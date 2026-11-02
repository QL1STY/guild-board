# Privacy

Guild Board is an unofficial, fan-made hobby project by QL1STY, who is the one person responsible for the data described here. It is
not affiliated with or endorsed by HoYoverse or COGNOSPHERE. There are no ads and no analytics, and nothing is sold.

## Without the online features

If you never sign in with Discord, nothing about you reaches the developer. Everything stays on your PC, in
`%LOCALAPPDATA%\GuildBoard`:

- your HoYoLAB login, encrypted for your Windows user, sent only to HoYoverse;
- what HoYoLAB and the game's history pages return, your wishes, your ledger, your notes and your settings.

Guild Board talks to HoYoverse's sites to read your account. It talks to GitHub only to look for a new version, and for Paimon.moe's
achievement list when you ask. GitHub and HoYoverse see your IP address when that happens, as with any request.

## With the online features

They are optional and start only when you sign in with Discord. The data is kept in a Supabase project in Frankfurt, in the EU.
The reason for keeping it is that you asked for these features.

| When | What is stored | Who can see it |
|---|---|---|
| You sign in | Your Discord ID and display name. Discord is not asked for your e-mail address, and it is not kept. | The developer, in the project's dashboard. Never your friends. |
| Always, once signed in | Your name and tag, and your UID, Adventure Rank and HoYoLAB picture link | Friends. If you allow Find me by UID, the UID finds you. |
| You use Friends | Friend requests, who you declined (for 30 days), your pinned items | The people involved |
| Status is on | Whether you are playing, and since when | Friends |
| Each stat you switch on | Primogems, play time, achievements, endgame results, account figures, wishes, spending | Friends. Each is off until you switch it on. |
| Sync is on | Your achievement ticks, commissions, timers, Board layouts, widget notes, wishlist, gift codes, play sessions, character plans and some settings | You, on your other PCs |

The developer can read everything in this table in the project's dashboard, and will look only to keep the service working. Treat
your widget notes accordingly: do not sync anything you would not want read.

**Never sent online:** your HoYoLAB login or cookies, wish or Feedback keys, what HoYoLAB returns, and anything from the game's
folders. A test in this repository, `tests/test_handsoff.py`, enforces this.

Supabase, which hosts the project, and Discord, which signs you in, keep their own technical records, as such services do.

## How long it is kept, and how to leave

The data stays until you delete it. In Guild Board, go to Settings, Online, and delete your online data. That removes your account and
everything in the table, and cannot be undone. If you cannot reach the app, open an issue on GitHub and your data will be removed by hand.

You can ask what is held about you, have it corrected or removed, and complain to your data protection authority. In Poland that
is the UODO.

## How far this goes

This is one person's hobby project, built largely with AI tools. It has been audited, its limits are enforced by tests, and its
source is open for anyone to check, but no one can promise it is free of bugs. If a leak puts people at risk, it will be reported
to the UODO and told to those affected, here and in the app. Do not use the online features if that is not good enough for you.

The software comes with no warranty, as the MIT licence says. Reading a HoYoLAB account with a third-party tool is against the
spirit of HoYoverse's terms, and that risk to your account is yours.

## Contact

Open an issue at the project's GitHub repository, or use its private reporting for anything sensitive.

Changes to this notice are shown in the repository's history.
