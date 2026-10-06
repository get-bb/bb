#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../../.."
artifacts="$PWD/e2e-artifacts/android"
mkdir -p "$artifacts"

BB_MOBILE_E2E_SERVE_APP=1 pnpm exec turbo run e2e:mobile-backend \
  --filter=@bb/integration-tests --output-logs=full --log-order=stream \
  > "$artifacts/backend.log" 2>&1 &
backend_pid=$!

cleanup() {
  adb logcat -d > "$artifacts/logcat.log" 2>&1 || true
  adb exec-out screencap -p > "$artifacts/final-screen.png" 2>/dev/null || true
  if [ -d "$HOME/.maestro/tests" ]; then
    cp -R "$HOME/.maestro/tests" "$artifacts/maestro-debug" || true
  fi
  kill "$backend_pid" 2>/dev/null || true
  pkill -f 'mobile-e2e/backend.ts' || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 240); do
  if grep -q '"serverUrl"' "$artifacts/backend.log"; then
    ready=1
    break
  fi
  if ! kill -0 "$backend_pid" 2>/dev/null && ! pgrep -f 'mobile-e2e/backend.ts' >/dev/null; then
    cat "$artifacts/backend.log"
    exit 1
  fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  cat "$artifacts/backend.log"
  echo "Backend did not finish seeding"
  exit 1
fi
curl -fsS http://127.0.0.1:41999/health
adb reverse tcp:41999 tcp:41999
adb install -r apps/mobile/build-output/bb-android-local.apk
adb logcat -c
maestro test --format junit --output "$artifacts/junit.xml" \
  --test-output-dir "$artifacts/maestro" apps/mobile/e2e/android/smoke.yaml
