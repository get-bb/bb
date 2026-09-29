#!/usr/bin/env bash
set -euo pipefail

if [[ "${CACHE_RESTORE_OUTCOME:-success}" != "success" ]]; then
  echo "::warning::Workspace cache restoration failed or exceeded its budget; discarding partial restores."
  node --input-type=module -e 'import { rmSync } from "node:fs"; rmSync(".turbo/cache", { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 }); rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });' "$(pnpm store path --silent)"
fi

started=$SECONDS
pnpm install --frozen-lockfile --prefer-offline \
  --fetch-timeout=30000 --fetch-retries=2 \
  --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=5000
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Dependency installation: $((SECONDS - started))s; cache restore: ${CACHE_RESTORE_OUTCOME:-unbounded shared setup}." >> "$GITHUB_STEP_SUMMARY"
fi
