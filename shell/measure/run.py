"""Measures the packaged shell's demo window (the `electron` host only; GB_DISPLAY picks the display).

usage: run.py NAME usual|full [start] [spin] [year] [scroll] [idle] [hunt] [memwalk] [pacing] [-- ENGINE SWITCHES]

The screen is read in memory only (dxcam, a region the size of Guild Board's own window). The only pictures kept are
small crops of that window around a broken frame, in shots/ (git-ignored), and none when nothing is broken.

spin   a still page (Achievements) with a small spinner and canvas animation injected in its bottom-right corner, so
       the engine draws continuously; every frame is compared with the page's settled image outside that corner. A
       block that departs from it for at most 3 frames and comes back is a broken frame.
year   the Year tab, with its dust and aurora: frames shown per second and CPU.
scroll wheel scrolling on Achievements: frames shown per second and CPU.
idle   the Board at rest: CPU and memory.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time

import dxcam
import numpy as np
from PIL import Image

from gbwin import (EXPECTED_SIZE, HERE, OUTPUT, OUTPUT_LEFT, OUTPUT_TOP, Demo, Page, monitors, place, prime_cpu, private_mb,
                   read_cpu, refuse_if_game_runs)

CROP = (480, 270)  # half-size pixels: the most of Guild Board's window that a kept picture shows


def save_crop(image: np.ndarray, name: str) -> None:
    """The one place a picture is written: only a crop of Guild Board's own window, and only while the game does not run."""
    refuse_if_game_runs("before saving a crop")
    assert image.shape[0] <= CROP[1] and image.shape[1] <= 2 * CROP[0] + 64, "a kept picture is a small crop"
    Image.fromarray(np.ascontiguousarray(image)).save(HERE / "shots" / name)


def crop_to(image: np.ndarray, y: int, x: int) -> np.ndarray:
    """A crop of at most CROP around (y, x), so that no kept picture is of the whole window or display."""
    h, w = image.shape[:2]
    top = max(0, min(h - CROP[1], y - CROP[1] // 2))
    left = max(0, min(w - CROP[0], x - CROP[0] // 2))
    return image[top:top + CROP[1], left:left + CROP[0]]

INJECT = """(() => {
  const style = document.createElement('style');
  style.id = 'gb-spin-style';
  style.textContent = '@keyframes gbspin { to { transform: rotate(360deg) } }';
  document.head.append(style);
  const spin = document.createElement('div');
  spin.id = 'gb-spin';
  spin.style.cssText = 'position:fixed;right:8px;bottom:8px;width:44px;height:44px;border-radius:50%;' +
    'border:6px solid #c03;border-top-color:transparent;z-index:2147483647;animation:gbspin .7s linear infinite';
  document.body.append(spin);
  const canvas = document.createElement('canvas');
  canvas.id = 'gb-canvas';
  canvas.width = 56; canvas.height = 56;
  canvas.style.cssText = 'position:fixed;right:64px;bottom:8px;width:56px;height:56px;z-index:2147483647';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  window.__gbSpin = true;
  (function draw(t) {
    if (!window.__gbSpin) return;
    ctx.clearRect(0, 0, 56, 56); ctx.fillStyle = '#06c'; ctx.fillRect((t / 8) % 56, 0, 8, 56);
    requestAnimationFrame(draw);
  })(0);
  return true;
})()"""
REMOVE = """(() => { window.__gbSpin = false;
  for (const id of ['gb-spin', 'gb-canvas', 'gb-spin-style', 'gb-full', 'gb-blur', 'gb-pace', 'gb-pace-style'])
  document.getElementById(id)?.remove(); return true; })()"""
# A red bar crossing a white track at a steady 1,000 CSS pixels a second, moved by the compositor (a transform).
INJECT_PACE = """(() => {
  const style = document.createElement('style');
  style.id = 'gb-pace-style';
  style.textContent = '@keyframes gbpace { from { transform: translateX(0) } to { transform: translateX(1000px) } }';
  document.head.append(style);
  const track = document.createElement('div');
  track.id = 'gb-pace';
  track.style.cssText = 'position:fixed;left:300px;top:200px;width:1008px;height:40px;background:#fff;' +
    'z-index:2147483647;pointer-events:none';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:0;top:0;width:8px;height:40px;background:#f00;' +
    'animation:gbpace 1s linear infinite;will-change:transform';
  track.append(bar);
  document.body.append(track);
  return true;
})()"""
# Four seconds of requestAnimationFrame: the intervals between frames, in milliseconds.
RAF_PROBE = """new Promise((resolve) => {
  const stamps = [];
  const first = performance.now();
  (function tick(now) {
    stamps.push(now);
    if (now - first < 4000) requestAnimationFrame(tick);
    else resolve(stamps.slice(2).map((t, i) => t - stamps[i + 1]));
  })(first);
})"""
# Makes every frame costly for the graphics card: a blur of the whole window, all but invisible (2%), redrawn each
# frame because the canvas under it is.
INJECT_BLUR = """(() => {
  const d = document.createElement('div');
  d.id = 'gb-blur';
  d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;' +
    'backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);opacity:0.02';
  document.body.append(d);
  return true;
})()"""


def sidebar_breaks(strips: list[np.ndarray], tag: str) -> dict:
    """The sidebar is the same dark panel on every page. A frame where its dark pixels show the parchment instead was
    put on screen half drawn."""
    stack = np.stack(strips)  # (n, h, w, 3) half-size strips of the window's left edge
    s32 = stack.astype(np.float32)
    luma = s32[..., 2] * 0.299 + s32[..., 1] * 0.587 + s32[..., 0] * 0.114  # BGR
    del s32
    reference = np.median(luma[: min(len(luma), 15)], axis=0)
    dark = reference < 90
    light = (luma > 170) & dark[None]
    share = light.reshape(len(luma), -1).sum(axis=1) / max(1, int(dark.sum()))
    broken = share > 0.005
    order = np.argsort(-share)
    for rank, index in enumerate(order[:3]):
        if not broken[index]:
            break
        # The sidebar's strip alone (the window's left edge), the frame before and the broken one, cut to the top part.
        pair = np.concatenate([stack[max(0, index - 1)], stack[index]], axis=1)
        save_crop(pair[:CROP[1], :, ::-1], f"{tag}-sidebar{rank + 1}.png")
    return {
        "sidebar_frames": int(len(luma)),
        "sidebar_dark_pixels": int(dark.sum()),
        "sidebar_broken_frames": int(broken.sum()),
        "worst_sidebar_share": round(float(share.max()), 4) if len(share) else 0.0,
    }
# A canvas over the whole window, cleared every frame, so that every frame is redrawn whole; it draws only a small bar in
# the left-out corner, and the page under it stays still.
INJECT_FULL = """(() => {
  const c = document.createElement('canvas');
  c.id = 'gb-full';
  c.width = Math.round(innerWidth * devicePixelRatio); c.height = Math.round(innerHeight * devicePixelRatio);
  c.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
  document.body.append(c);
  const ctx = c.getContext('2d');
  const s = 40 * devicePixelRatio;
  window.__gbSpin = true;
  (function draw(t) {
    if (!window.__gbSpin) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#06c';
    ctx.fillRect(c.width - 3 * s + ((t / 8) % (2 * s)), c.height - 1.5 * s, 0.3 * s, s);
    requestAnimationFrame(draw);
  })(0);
  return [c.width, c.height];
})()"""
# The Year tab held still: its stylesheet's animations paused and its dust all but invisible, while the dust's canvas
# still redraws the stage every frame.
YEAR_STILL = """(() => {
  const stage = document.querySelector('.yr-stage');
  stage?.setAttribute('data-paused', '');
  const dust = document.querySelector('[data-testid=year-dust]');
  if (dust) dust.style.opacity = '0.004';
  return [!!stage, !!dust, dust?.dataset.running ?? null];
})()"""


BLACK = {"frames_with_black_blocks": 0, "most_black_blocks": 0}
BLACK_SHOTS: list[tuple[int, np.ndarray]] = []


def black_blocks(half: np.ndarray) -> int:
    """32 x 32 screen-pixel blocks that are (almost) all pure black: the interface never draws pure black."""
    dark = half[::2, ::2].max(axis=2) <= 4  # quarter size
    hb, wb = dark.shape[0] // 8, dark.shape[1] // 8
    return int((dark[: hb * 8, : wb * 8].reshape(hb, 8, wb, 8).mean(axis=(1, 3)) >= 0.9).sum())


STRIPS: list[np.ndarray] = []  # the window's left edge (the sidebar) of every frame, at half size
STRIP_W = [60]


def grab_frames(cam, seconds: float, keep: bool) -> tuple[list[np.ndarray], int, float]:
    """Every new frame of the region for `seconds`, at half size; identical neighbours are dropped. Counts pure black
    blocks in each, and keeps the frames with the most of them."""
    frames: list[np.ndarray] = []
    last = None
    unique = 0
    start = time.perf_counter()
    while time.perf_counter() - start < seconds:
        frame = cam.grab()
        if frame is None:
            time.sleep(0.0005)
            continue
        half = frame[::2, ::2, :3]
        if last is not None and np.array_equal(half, last):
            continue
        unique += 1
        last = half
        STRIPS.append(half[:, : STRIP_W[0]].copy())
        black = black_blocks(half)
        if black:
            BLACK["frames_with_black_blocks"] += 1
            BLACK["most_black_blocks"] = max(BLACK["most_black_blocks"], black)
            if len(BLACK_SHOTS) < 6 or black > min(n for n, _ in BLACK_SHOTS):
                BLACK_SHOTS.append((black, half.copy()))
                BLACK_SHOTS.sort(key=lambda item: -item[0])
                del BLACK_SHOTS[6:]
        if keep:
            frames.append(half.copy())
    elapsed = time.perf_counter() - start
    # Right after every capture and before any analysis that may save a crop: if the game has started, nothing is kept.
    refuse_if_game_runs("after a capture")  # raises, and ends the run, when the game may run
    return frames, unique, elapsed


def save_black(tag: str) -> None:
    for rank, (count, half) in enumerate(BLACK_SHOTS[:3]):
        dark = half[::2, ::2].max(axis=2) <= 4
        ys, xs = np.nonzero(dark)
        centre = (int(ys.mean()) * 2, int(xs.mean()) * 2) if len(ys) else (0, 0)
        save_crop(crop_to(half, *centre)[..., ::-1], f"{tag}-black{rank + 1}-{count}.png")
    BLACK_SHOTS.clear()


def broken_frames(frames: list[np.ndarray], dpr: float, tag: str) -> dict:
    stack = np.stack(frames)  # (n, h, w, 3) at half size
    n, h, w, _ = stack.shape
    reference = np.median(stack[:: max(1, n // 41)], axis=0).astype(np.int16)
    block = 16  # half-size pixels: 32 x 32 screen pixels
    hb, wb = h // block, w // block
    # The injected animation's corner, with room to spare, is left out.
    corner_w = int((140 * dpr) / 2) + 24
    corner_h = int((70 * dpr) / 2) + 24
    valid = np.ones((hb, wb), bool)
    valid[(h - corner_h) // block:, (w - corner_w) // block:] = False
    deviating = np.zeros((n, hb, wb), bool)
    for i in range(n):
        diff = np.abs(stack[i].astype(np.int16) - reference).max(axis=2) > 40
        frac = diff[: hb * block, : wb * block].reshape(hb, block, wb, block).mean(axis=(1, 3))
        deviating[i] = (frac > 0.2) & valid
    glitch = np.zeros_like(deviating)
    for by in range(hb):
        for bx in range(wb):
            column = deviating[:, by, bx]
            if not column.any():
                continue
            i = 0
            while i < n:
                if column[i]:
                    j = i
                    while j < n and column[j]:
                        j += 1
                    if j - i <= 3 and i > 0 and j < n:  # departs and comes back within 3 frames
                        glitch[i:j, by, bx] = True
                    i = j
                else:
                    i += 1
    per_frame = glitch.sum(axis=(1, 2))
    order = np.argsort(-per_frame)
    for rank, index in enumerate(order[:3]):
        if per_frame[index] == 0:
            break
        ys, xs = np.nonzero(np.abs(stack[index].astype(np.int16) - reference).max(axis=2) > 40)
        centre = (int(ys.mean()), int(xs.mean())) if len(ys) else (0, 0)
        sheet = np.concatenate([crop_to(reference.astype(np.uint8), *centre), crop_to(stack[index], *centre)], axis=1)
        save_crop(sheet[..., ::-1], f"{tag}-worst{rank + 1}.png")
    return {
        "frames": int(n),
        "broken_frames": int((per_frame > 0).sum()),
        "broken_4plus_blocks": int((per_frame >= 4).sum()),
        "broken_16plus_blocks": int((per_frame >= 16).sum()),
        "largest_blocks": int(per_frame.max()) if n else 0,
        "blocks_per_frame": int(hb * wb),
        "persistent_deviation_blocks": int((deviating.sum(axis=0) > 3).sum()),
    }


def main() -> None:
    args = sys.argv[1:]
    switches: list[str] = []
    if "--" in args:
        cut = args.index("--")
        args, switches = args[:cut], args[cut + 1:]
    name, size, scenarios = args[0], args[1], args[2:] or ["spin", "year", "scroll", "idle"]
    (HERE / "shots").mkdir(exist_ok=True)
    demo = Demo(name, switches)
    report: dict = {"variant": name, "host": "electron-packaged", "size": size, "switches": switches,
                    "display": OUTPUT, "monitors": monitors()}
    try:
        hwnd = demo.wait()
        report["start_to_page_target_ms"] = round((demo.page_seen - demo.started) * 1000)
        report["start_to_window_ms"] = round((demo.window_seen - demo.started) * 1000)
        page = Page()
        # Start: from the launch to the interface drawn with data. The rail (.gb-rail) is drawn only once the core has
        # answered with the status and the settings, so its presence is that point; the page's "Opening Guild Board"
        # waiting note must be gone as well.
        while not page.js("!!document.querySelector('.gb-rail') && !document.querySelector('.gb-wait')") \
                and time.time() - demo.started < 90:
            time.sleep(0.02)
        report["start_to_rail_ms"] = round((time.time() - demo.started) * 1000)
        fcp = page.js("(() => { const e = performance.getEntriesByName('first-contentful-paint')[0];"
                      " return e ? performance.timeOrigin + e.startTime : null; })()")
        report["start_to_first_paint_ms"] = round(fcp - demo.started * 1000) if fcp else None
        print("start", "window", report["start_to_window_ms"], "first-paint", report["start_to_first_paint_ms"],
              "rail", report["start_to_rail_ms"], flush=True)
        time.sleep(1)
        cx, cy, cw, ch = place(hwnd, size)
        report["client"] = [cx, cy, cw, ch]
        time.sleep(2)
        dpr = float(page.js("window.devicePixelRatio") or 1)
        report["dpr"] = round(dpr, 3)
        report["webgl"] = page.js("""(() => { const c = document.createElement('canvas');
          const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return null;
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()""")
        print("webgl", report["webgl"], "dpr", report["dpr"], flush=True)
        # The sidebar's width on screen, from the page itself, less a margin; at half size.
        sidebar = float(page.js("document.querySelector('.gb-rail')?.getBoundingClientRect().width ?? 120") or 120)
        STRIP_W[0] = max(20, int((sidebar - 12) * dpr / 2))
        report["sidebar_css_px"] = round(sidebar)
        cam = dxcam.create(output_idx=OUTPUT, output_color="BGRA",
                           region=(cx - OUTPUT_LEFT, cy - OUTPUT_TOP, cx - OUTPUT_LEFT + cw, cy - OUTPUT_TOP + ch))
        # Which display is dxcam's output? Its size and the window's place must be the expected display's.
        report["dxcam_output_size"] = [cam.width, cam.height]
        report["dxcam_output_info"] = dxcam.output_info()
        print("dxcam output", OUTPUT, report["dxcam_output_size"], "expected", list(EXPECTED_SIZE), "left", OUTPUT_LEFT,
              "top", OUTPUT_TOP, flush=True)
        if (cam.width, cam.height) != EXPECTED_SIZE:
            raise SystemExit(f"refused: dxcam output {OUTPUT} is {cam.width} x {cam.height}, not {EXPECTED_SIZE}")
        for scenario in scenarios:
            refuse_if_game_runs(f"before {scenario}")
            procs = demo.procs()
            STRIPS.clear()
            if scenario in ("spin", "spinfull", "stress", "shots"):
                page.go("#/achievements")
                time.sleep(5)
                page.js(INJECT)
                if scenario in ("spinfull", "stress", "shots"):
                    page.js(INJECT_FULL)
                if scenario == "stress":
                    page.js(INJECT_BLUR)
                time.sleep(1.5)
                stop = threading.Event()
                taken = [0]

                def screenshots() -> None:
                    # As the memory and CPU check did: the page's own picture, over CDP, one after another.
                    while not stop.is_set():
                        page.send("Page.captureScreenshot", format="png")
                        taken[0] += 1

                shooter = threading.Thread(target=screenshots, daemon=True)
                prime_cpu(procs)
                if scenario == "shots":
                    shooter.start()
                frames, unique, elapsed = grab_frames(cam, 12, keep=True)
                stop.set()
                if scenario == "shots":
                    shooter.join(5)
                cpu = read_cpu(procs)
                page.js(REMOVE)
                result = broken_frames(frames, dpr, f"{name}-{size}-{scenario}")
                result.update(shown_fps=round(unique / elapsed, 1), cpu_percent_of_a_core=cpu)
                if scenario == "shots":
                    result["cdp_screenshots"] = taken[0]
                del frames
            elif scenario == "yearstill":
                page.go("#/stats/year")
                for _ in range(30):
                    time.sleep(1)
                    if page.js("document.querySelector('[data-testid=year-dust]')?.dataset.running === 'true'"):
                        break
                time.sleep(5)  # the cards' entrance and the counters have finished
                held = page.js(YEAR_STILL)
                page.js(INJECT)  # the corner's spinner: frames go on even if the dust's canvas were left out
                time.sleep(1.5)
                prime_cpu(procs)
                frames, unique, elapsed = grab_frames(cam, 12, keep=True)
                cpu = read_cpu(procs)
                page.js(REMOVE)
                result = broken_frames(frames, dpr, f"{name}-{size}-{scenario}")
                result.update(held=held, shown_fps=round(unique / elapsed, 1), cpu_percent_of_a_core=cpu)
                del frames
            elif scenario == "year":
                page.go("#/stats/year")
                for _ in range(30):
                    time.sleep(1)
                    if page.js("document.querySelector('[data-testid=year-dust]')?.dataset.running === 'true'"):
                        break
                time.sleep(4)  # the cards' entrance has settled; the dust and aurora go on
                running = page.js("document.querySelector('[data-testid=year-dust]')?.dataset.running ?? null")
                prime_cpu(procs)
                _, unique, elapsed = grab_frames(cam, 12, keep=False)
                result = {"dust_running": running, "shown_fps": round(unique / elapsed, 1),
                          "cpu_percent_of_a_core": read_cpu(procs)}
            elif scenario == "scroll":
                page.go("#/achievements")
                time.sleep(4)
                stop = threading.Event()

                def wheel() -> None:
                    step = 0
                    while not stop.is_set():
                        direction = 1 if (step // 50) % 2 == 0 else -1
                        page.send("Input.dispatchMouseEvent", type="mouseWheel", x=cw // 2 / dpr, y=ch // 2 / dpr,
                                  deltaX=0, deltaY=100 * direction)
                        step += 1
                        time.sleep(0.03)

                driver = threading.Thread(target=wheel, daemon=True)
                prime_cpu(procs)
                driver.start()
                _, unique, elapsed = grab_frames(cam, 10, keep=False)
                stop.set()
                driver.join(2)
                result = {"shown_fps": round(unique / elapsed, 1), "cpu_percent_of_a_core": read_cpu(procs)}
            elif scenario in ("walk", "hover", "hunt"):
                page.go("#/")
                time.sleep(4)
                stop = threading.Event()
                pages = ["#/achievements", "#/characters", "#/backlog", "#/stats", "#/stats/months", "#/pulls",
                         "#/ledger", "#/friends", "#/settings", "#/"]
                if scenario == "hunt":  # a minute of pages, with the Year tab's motion between them
                    pages = [one for page_ in pages for one in (page_, "#/stats/year")]

                def act() -> None:
                    step = 0
                    while not stop.is_set():
                        if scenario in ("walk", "hunt"):
                            page.go(pages[step % len(pages)])
                            time.sleep(1.2 if scenario == "walk" else 1.5)
                        else:
                            x = (step * 17) % int(cw / dpr - 40) + 20
                            y = ((step * 17) // int(cw / dpr - 40) * 70) % int(ch / dpr - 40) + 20
                            page.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
                            time.sleep(0.016)
                        step += 1

                driver = threading.Thread(target=act, daemon=True)
                prime_cpu(procs)
                driver.start()
                _, unique, elapsed = grab_frames(cam, 60 if scenario == "hunt" else 15, keep=False)
                stop.set()
                driver.join(3)
                result = {"shown_fps": round(unique / elapsed, 1), "cpu_percent_of_a_core": read_cpu(procs)}
            elif scenario == "pacing":
                # The engine's own frame rate on this display: requestAnimationFrame's intervals while a bar moves.
                page.go("#/settings")
                time.sleep(3)
                page.js(INJECT_PACE)
                time.sleep(1.5)
                intervals = page.js(RAF_PROBE) or []
                prime_cpu(procs)
                _, unique, elapsed = grab_frames(cam, 6, keep=False)
                page.js(REMOVE)
                ordered = sorted(intervals)
                pick = (lambda q: round(ordered[min(len(ordered) - 1, int(q * len(ordered)))], 2)) if ordered else (lambda q: None)
                result = {
                    "raf_per_second": round(1000 * len(intervals) / sum(intervals), 1) if intervals else None,
                    "raf_interval_median_ms": pick(0.5),
                    "raf_interval_p05_ms": pick(0.05),
                    "raf_interval_p95_ms": pick(0.95),
                    "raf_interval_p99_ms": pick(0.99),
                    "shown_fps": round(unique / elapsed, 1),
                    "cpu_percent_of_a_core": read_cpu(procs),
                }
            elif scenario == "memwalk":
                # Thirty page changes between Stats and the Board: does memory come back without any help?
                samples = []
                for step in range(30):
                    page.go("#/stats" if step % 2 == 0 else "#/")
                    time.sleep(2)
                    samples.append(private_mb(demo.procs()))
                result = {"first_mb": samples[0], "max_mb": max(samples), "last_mb": samples[-1],
                          "every_fifth_mb": samples[::5]}
            elif scenario == "idle":
                page.go("#/")
                time.sleep(6)
                prime_cpu(procs)
                time.sleep(10)
                result = {"cpu_percent_of_a_core": read_cpu(procs)}
            else:
                continue
            result.update(BLACK)
            BLACK.update(frames_with_black_blocks=0, most_black_blocks=0)
            save_black(f"{name}-{size}-{scenario}")
            if STRIPS:
                result.update(sidebar_breaks(STRIPS, f"{name}-{size}-{scenario}"))
                STRIPS.clear()
            result["private_mb"] = private_mb(demo.procs())
            report[scenario] = result
            print(scenario, json.dumps(result), flush=True)
        del cam
    finally:
        demo.stop()
    (HERE / f"report-{name}-{size}.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
