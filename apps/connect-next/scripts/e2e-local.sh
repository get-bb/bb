#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
keep=(BB_E2E_DIR BB_E2E_SCREENSHOT_DIR BB_E2E_PLAYWRIGHT_DIR BB_FRP_CACHE_DIR BB_E2E_OLD_DAEMON_REPO)
for name in $(compgen -e | grep -E "^(BB_|CLOUDFLARE_|FLY_)" || true); do
  case " ${keep[*]} " in *" $name "*) ;; *) unset "$name" ;; esac
done
exec node --conditions=source --import tsx apps/connect-next/scripts/e2e-local.ts "$@"
