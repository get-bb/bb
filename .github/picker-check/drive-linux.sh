#!/usr/bin/env bash
set -euo pipefail
action=$1
target=${2:-}
shots=$3
wid=$(timeout 30 xdotool search --sync --name "Choose a project folder" | head -1)
sleep 2
import -window root "$shots/linux-$action-open.png"
xdotool windowfocus --sync "$wid" || true
if [ "$action" = cancel ]; then
  xdotool key --window "$wid" Escape
else
  xdotool key --window "$wid" ctrl+l
  sleep 0.5
  xdotool type --window "$wid" --delay 30 "$target"
  sleep 0.5
  import -window root "$shots/linux-$action-typed.png"
  xdotool key --window "$wid" Return
  for _ in 1 2 3; do
    sleep 1.5
    xdotool search --name "Choose a project folder" >/dev/null 2>&1 || break
    xdotool key --window "$wid" Return
  done
fi
