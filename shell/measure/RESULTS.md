# Guild Board on Electron, measured (2026-11-07)

The packaged shell, `shell\out\Guild Board-win32-x64\guildboard-app.exe` (Electron 45.2.3, Chromium 156) with the Python core
it starts, in its demo, measured on the developer's PC with the spike's harness (`shell-electron/measure/` of the
`spike/electron` branch), adapted here. The yardsticks are the spike's recorded numbers for Qt (today's PySide6 window,
Qt WebEngine 6.11.2, Chromium 140) and for the Electron spike (a throwaway shell around the same core). Both yardsticks ran
an unfrozen core from a checkout (`python -m guildboard`); this run used the frozen core the package carries, so their
start times and memory are not like for like with this run's.

The build measured: the program packaged by Task 16's build just before commit 33d2bd8 (the installer commit), on the
`electron` branch. The harness did not record the program's hash, and the file in `shell\out` is dated later than the
runs, so the folder has been packaged again since; these numbers are of the earlier build.

The PC:
- Ryzen 7 7800X3D, RTX 4070 Ti SUPER, 32 GB, Windows 11 Pro 26200.
- 3,440 x 1,440 at 240 Hz (primary) and 2,560 x 1,440 at 165 Hz.

## How it was measured

- Program: `guildboard-app.exe --demo --acknowledged --data-dir <a fresh folder under shell/measure/runs> --remote-debugging-port=9333`.
  The shell allows the port only in the demo. Only this host was run; the `qt` and `edge` hosts are not in this copy of the harness.
- Display: the 2K display, 2,560 x 1,440 at 165 Hz, maximized (client area 2,560 x 1,417, page zoom 1.561). The harness reads
  the display through DXGI desktop duplication (`dxcam`) in memory, a region the size of Guild Board's own window, and checks
  before it captures that dxcam's output 1 is 2,560 x 1,440 and that Windows has exactly one display of that size
  (`Output[0]` is the 3,440 x 1,440 primary, `Output[1]` the 2,560 x 1,440 one, which starts at x = 3,440, y = 0). The
  capture region is the window's client area less that display's left and top.
- A half-drawn frame is one where the dark sidebar shows the parchment (QTBUG-142355's signature), as in the spike. The harness
  also counts frames with blocks of pure black. The page walk is `hunt`: one minute of pages (Board, Achievements, Characters,
  Backlog, Stats, Months, Pulls, Ledger, Friends, Settings), the Year tab between each. `year`, `scroll`, `memwalk` (30 changes
  between Stats and the Board, 2 s apart, private memory of the whole process tree, no help) and `idle` are the spike's.
- Start: from the moment the harness launches the program to the page being drawn with the core's data. The harness polls
  the dashboard's page over CDP every 20 ms until `.gb-rail` exists and the "Opening Guild Board" waiting note is gone. The rail
  is drawn only after the core has answered with its status and settings, so this is the spike's end point. The real shell
  prints no `MARK` lines. First contentful paint was not available (the page returned no entry for it), so it is not
  reported. The window's own first appearance is not timed on its own: the harness looks for the window once the
  page exists (the page and the window were both there at about 3.7 s).
- Runs: the battery `battery.sh` (A: maximized on the 2K display, B: frame pacing at the usual size on each display, C: three
  starts). Every run follows a look at the Windows process list for the game, and a watchdog looks again every 3 s while a run
  goes on; the game was not running at any point. The watchdog's two `tasklist.exe` calls run outside the measured process tree.
- Pictures: none were saved. The harness saves a small crop of Guild Board's window only around a broken frame, and nothing
  was broken (`shots/` is empty). Both `runs/` and `shots/` are git-ignored.
- Every program the harness started was ended by its process id; none was left running.

## Results, maximized on the 2K display (165 Hz)

| | Qt (the spike's numbers) | Electron spike | Packaged shell (this task) |
|---|---|---|---|
| Half-drawn frames, one-minute page walk | 14 in 2,561 | 0 in 3,008 | **0 in 3,039** |
| Frames with pure black blocks, all runs | 0 | 0 | 0 |
| Half-drawn frames, Year tab | 16 in 721 | 0 in 909 | 0 in 884 |
| Half-drawn frames, scrolling | 0 in 579 | 0 in 591 | 0 in 583 |
| CPU, page walk / Year / scrolling | 0.62 / 0.59 / 0.72 core | 0.70 / 0.63 / 0.29 core | 0.73 / 0.68 / 0.31 core |
| Frames shown a second, page walk / Year / scrolling | 42.7 / 60.0 / 57.9 | 50.1 / 75.7 / 59.0 | 50.6 / 73.7 / 58.2 |
| Memory over 30 page switches, first to last (max) | 856 to 1,019 MB, growing | 646 to 714 MB (max 772) | **747 to 803 MB (max 874), +56 MB** |
| Memory at rest after the runs | 709 MB | 475 MB | 597 MB |
| CPU at rest | 0.02 core | 0.00 | 0.01 core |

The memory walk's every-fifth samples were 747, 808, 800, 801, 807, 802 MB: it rose once in the first five changes and then
stayed level. The packaged shell's memory is about 90 to 120 MB above the spike's (first sample +101, last +89, at rest +122). The cause
was not looked into: the shell and the frozen core carry more than the spike did, but that is a guess. The spike summed the
whole process tree too. The worst sidebar share in the page walk was 0.0015 of its dark pixels, against the detector's threshold of 0.005: no frame came
near a break.

## Frame rate (`requestAnimationFrame`, usual window)

| | 240 Hz primary | 165 Hz secondary |
|---|---|---|
| Qt (the spike's numbers) | 60 | 60 |
| Electron spike | 240 | 240 |
| Packaged shell | 240.1 (median step 4.2 ms, p95 4.3 ms) | 240.1 (median step 4.2 ms, p95 4.3 ms) |

As in the spike, Chromium paces both windows to the primary display. The pacing runs also counted the frames that reached
the screen, and that count was low (1.2 and 2.7 a second on the two displays) while a bar moved across the page. This is
unexplained, as it was in the spike; it is not reported as a frame rate.

## Start (launch to the interface drawn with data)

| Host | Time |
|---|---|
| Qt (the spike's numbers) | 4.0 to 4.1 s |
| Electron spike | 4.1 to 4.3 s (4.04 s in its maximized run) |
| Packaged shell | 3.60, 3.65 and 3.64 s in the three starts of run C; 3.76 s in the maximized run A; 3.62 and 3.81 s in the two pacing runs (B, display 1 and 0) |

The page target and the window were there at 3.5 to 3.7 s, so the wait is the core's start, as in the spike (which ran an
unfrozen core from a checkout; this run's frozen one is not the same code path, so the faster start is not all the shell's). Each run
used a new demo data folder, so each was a first start of that folder on a warm PC. A cold start (first run after a restart)
was not measured.

## Criteria

| Criterion | Result |
|---|---|
| The one-minute hunt has 0 half-drawn frames | **Passed**: 0 in 3,039 frames, and 0 frames with black blocks |
| The memory walk's last sample is under 100 MB above its first | **Passed**: 803 MB against 747 MB, +56 MB |
| The start is no slower than Qt's 4.0 to 4.1 s | **Passed**: 3.60 to 3.81 s over the six starts |
| The overlay over the magenta stand-in: 97.08% closed, 90.8% open, no near-black | **Not measured here.** The ruling replaced it with the comparison below and the player's check over the game. |

## The overlay's window options, against the spike's

The real overlay exists only outside the demo and shows its closed state only while the game runs, so the harness cannot
draw it. Compared instead: `shell/src/overlay.ts` (`make`) against `overlayWindow` in the spike's `src/main.ts`.

The same in both: bounds of one whole display; `transparent: true`; `backgroundColor: '#00000000'`; `frame: false`;
`type: 'toolbar'`; `focusable: false` at first; `alwaysOnTop: true` with `setAlwaysOnTop(true, 'screen-saver')`;
`setIgnoreMouseEvents(true)` with one argument, so no `forward` and no global mouse hook; `show: false` and then
`showInactive()` once the page has loaded; `skipTaskbar`, `hasShadow: false`, not resizable, movable, minimizable, maximizable
or full-screenable; `contextIsolation`, `sandbox`, no node integration; a partition of its own (`gb-overlay`); the same
Electron (45.2.3), and no Chromium switch in either (none that touches the GPU or the compositor).

The differences:

| | Spike | Packaged shell | Could it change how see-through the window is? |
|---|---|---|---|
| `title` | "Guild Board overlay spike" | "Guild Board overlay" | No. |
| `webPreferences.backgroundThrottling` | `false` | `true` (the default; on purpose, so that the hidden overlay costs nothing) | No for the alpha. It decides whether a page that is hidden or covered keeps drawing. The shown overlay is on top and visible, so it draws. If it ever showed as stale, this is the first place to look. |
| `webPreferences.webSecurity` | not set (default, on) | `true` | No. |
| `webPreferences.spellcheck` | not set | `false` | No. |
| `win.setMenu(null)` | not called (the application menu is null) | called | No. |
| When the window is made | at start | on the first show (the game runs) | No, though the first show now waits for the page's load, so the window is never shown before the page has turned see-through. The spike did the same on `did-finish-load`. |
| Closing | `setIgnoreMouseEvents(true)`, `setFocusable(false)`, then `hide()` and `showInactive()` | `setIgnoreMouseEvents(true)`, `hide()`, `setFocusable(false)`, then `showInactive()` | No; this changes the order of two focus calls so that Windows hands the focus back before the window is made not focusable. |
| Zoom | none | `setZoomFactor` from the overlay size setting | No (it scales the page, not the window). |
| Page | the core's overlay page | the same page source; shown only after the risk statement is acknowledged and the core has answered | No. The page turns its document see-through (`ov-doc`) before React draws, in both. |

None of the differences touches the options that decide a see-through window on Windows (`transparent`, the
background colour, `frame`, the window type, the always-on-top level, mouse handling). The spike's overlay measured
97.08% untouched closed and 90.8% open over the magenta stand-in, with no near-black, and the packaged shell asks for the
same window. That is an argument, not a measurement.

## Left to the player's check over the game

Nothing was captured while the game ran, and the game was not running during this task. The check is the player's, and it
runs the packaged build (not the demo) over the game, on these conditions:
- First quit the installed Guild Board from its tray. Never use `--quit` from the worktree: it quits the player's real copy.
  Two copies must not run at once (two cores, two overlays, and the hotkey would show as taken).
- Run the packaged `guildboard-app.exe` from `shell\out` with `--data-dir` on a scratch folder (not the standard data folder).
  That leaves the player's real data and their Start with Windows shortcut alone (the shortcut would otherwise be rewritten to
  point at the worktree's program). The scratch folder starts with empty widgets and no login, so pin a widget or two in it
  to see the overlay's closed state.

The player reports:
- the overlay's three states: closed (pinned widgets over the game, which keeps the clicks and the focus), open
  (dimmed, with its widgets) and open in the no-focus mode ("The game runs in full screen");
- Alt+Tab with the overlay open and closed;
- the full-screen setting: the game stays in front and keeps the focus while the overlay is open;
- quitting the game and starting it again with Guild Board still running: the overlay hides when the game stops and shows
  again, with `showInactive()`, when it starts, after `backgroundThrottling` stopped the hidden page's frames. It must
  show its closed state again and not a stale picture.

Not covered here: the non-demo start (login, sync), the map, the installed copy's own start, a cold start, and the NVIDIA
residue bug (electron#43122; none seen in the spike's 4,500 frames, and none in the 4,500 or so frames of this run's walks).
