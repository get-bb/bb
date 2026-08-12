#!/usr/bin/env sh
set -eu

log() {
  printf '%s\n' "[bb-env-setup] $*"
}

expected_node="v22.19.0"
actual_node="$(node --version 2>/dev/null || true)"
if [ "${actual_node}" != "${expected_node}" ] && command -v fnm >/dev/null 2>&1; then
  log "Re-executing with Node ${expected_node} through fnm"
  exec fnm exec --using=22.19.0 sh "$0" "$@"
fi
if [ "${actual_node}" != "${expected_node}" ]; then
  log "Error: expected Node ${expected_node}, found ${actual_node:-unavailable}"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  log "Error: pnpm 9.15.0 is required"
  exit 1
fi

if [ ! -f package.json ]; then
  log "Error: package.json not found"
  exit 1
fi

log "Running: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
log "Completed: pnpm install --frozen-lockfile"
