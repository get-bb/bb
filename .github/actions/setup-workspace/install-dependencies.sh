#!/usr/bin/env bash
set -euo pipefail

if [[ "${CACHE_RESTORE_OUTCOME:-success}" != "success" ]]; then
  echo "::warning::Workspace cache restoration failed or exceeded its budget; using fresh cache directories."
  fallback_cache=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bb-cache-fallback.XXXXXX")
  export npm_config_store_dir="$fallback_cache/pnpm"
  export TURBO_CACHE_DIR="$fallback_cache/turbo"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "npm_config_store_dir=$npm_config_store_dir" >> "$GITHUB_ENV"
    echo "TURBO_CACHE_DIR=$TURBO_CACHE_DIR" >> "$GITHUB_ENV"
  fi
fi

started=$SECONDS
pnpm install --frozen-lockfile --prefer-offline \
  --fetch-timeout=30000 --fetch-retries=2 \
  --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=5000
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Dependency installation: $((SECONDS - started))s; cache restore: ${CACHE_RESTORE_OUTCOME:-unbounded shared setup}." >> "$GITHUB_STEP_SUMMARY"
fi
