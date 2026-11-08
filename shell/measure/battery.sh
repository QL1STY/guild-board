#!/usr/bin/env bash
# Task 18's measurement of the packaged shell (shell/out/Guild Board-win32-x64/guildboard-app.exe, in its demo), on this PC.
# A: maximized on the 2K display (165 Hz): half-drawn frames in a minute of pages, the Year tab, scrolling, memory over
#    page changes, rest.
# B: frame pacing at the usual size on each display (1: 2K at 165 Hz, secondary; 0: ultrawide at 240 Hz, primary).
# C: three starts, from launch to the interface drawn with data.
# Before every run the game is looked for in the Windows process list; if it runs, nothing is measured.
cd "$(dirname "$0")" || exit 1
UV="uv run --no-project --with dxcam --with numpy --with psutil --with websocket-client --with pillow python"
rm -rf runs report-*.json shots
mkdir -p shots
safe() { $UV gamecheck.py || { echo "the game runs: stopping"; exit 3; }; }
echo "=== A electron"
safe
GB_DISPLAY=1 $UV run.py a-electron full hunt year scroll memwalk idle 2>&1 | grep -E "^(start|dxcam|hunt|year|scroll|memwalk|idle|webgl|GAME|refused:)" | cut -c1-600
for display in 1 0; do
  echo "=== B electron display $display"
  safe
  GB_DISPLAY=$display $UV run.py b-electron-d$display usual pacing 2>&1 | grep -E "^(dxcam|pacing|webgl|GAME|refused:)" | cut -c1-600
done
for run in 1 2 3; do
  echo "=== C electron start $run"
  safe
  GB_DISPLAY=1 $UV run.py c-electron-$run usual start 2>&1 | grep -E "^(start|GAME|refused:)" | cut -c1-300
done
echo "=== done"
