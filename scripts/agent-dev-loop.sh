#!/usr/bin/env bash
# ponytail: keep the local agent worker alive across memory-pressure kills.
# tsx watch already hot-reloads on code edits; this only handles the process
# being reaped (588M free RAM on a loaded machine). Drop when RAM isn't tight.
cd "$(dirname "$0")/../agent" || exit 1
while true; do
  npm run dev
  echo "[agent-dev-loop] worker exited ($?), restarting in 3s…"
  sleep 3
done
