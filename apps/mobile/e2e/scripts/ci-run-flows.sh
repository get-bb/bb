#!/usr/bin/env bash
# Runs the Maestro flows CI can run against a Release build of the app (the
# embedded JS bundle, no Metro) and a fresh mobile e2e backend, one `maestro
# test` per flow so each gets its own artifacts, continuing past failures and
# exiting non-zero if any flow failed.
#
# Usage:
#   SERVER_URL=http://127.0.0.1:41999 \
#   e2e/scripts/ci-run-flows.sh <simulator udid> <artifacts dir> [flow...]
#
# Default flows (in this order; later ones depend on seeds the earlier ones
# leave alone): smoke, phase1-shell, phase4a-timeline, phase3-compose,
# phase4b-send, phase6-panel. The script creates the threads the title-based
# flows open ("P4b send" idle; "P6 panel thread" with a dirty managed
# worktree) through the API first.
#
# Environment: SERVER_URL (default http://127.0.0.1:41999; the flows' own
# env blocks point at the same port), MAESTRO_FLAGS (extra `maestro test`
# flags). Needs maestro + java on PATH. Every flow gets
# `-e BB_E2E_EMBEDDED_BUNDLE=1` (see ../subflows/launch-app.yaml); pass
# `--dev-client` as the first argument to drive a dev client through Metro
# instead (local use).
# (bash 3.2 on macOS: empty arrays are expanded with the `${arr[@]+"${arr[@]}"}`
# idiom so `set -u` does not trip.)
set -uo pipefail

cd "$(dirname "$0")/.."

LAUNCH_ENV=(-e BB_E2E_EMBEDDED_BUNDLE=1)
if [ "${1:-}" = "--dev-client" ]; then
  LAUNCH_ENV=()
  shift
fi

UDID="${1:?simulator udid}"
ARTIFACTS="${2:?artifacts dir}"
shift 2
FLOWS=("$@")
if [ ${#FLOWS[@]} -eq 0 ]; then
  FLOWS=(smoke phase1-shell phase4a-timeline phase3-compose phase4b-send phase6-panel)
fi

export SERVER_URL="${SERVER_URL:-http://127.0.0.1:41999}"
mkdir -p "$ARTIFACTS"

needs() {
  local flow
  for flow in "${FLOWS[@]}"; do
    [ "$flow" = "$1" ] && return 0
  done
  return 1
}

# Seeds for the title-based flows (idempotent per title).
if needs phase4b-send; then
  THREAD_TITLE="P4b send" scripts/create-idle-thread.sh
fi
if needs phase6-panel; then
  THREAD_TITLE="P6 panel thread" scripts/phase6-diff-setup.sh
fi

failed=()
for flow in "${FLOWS[@]}"; do
  file="flows/$flow.yaml"
  out="$ARTIFACTS/$flow"
  mkdir -p "$out"
  echo "::group::maestro $flow"
  # shellcheck disable=SC2086
  if maestro --device "$UDID" test \
      ${LAUNCH_ENV[@]+"${LAUNCH_ENV[@]}"} \
      --format junit --output "$out/junit.xml" \
      --test-output-dir "$out" \
      ${MAESTRO_FLAGS:-} \
      "$file" 2>&1 | tee "$out/maestro.log"; then
    echo "PASS $flow"
  else
    echo "FAIL $flow"
    failed+=("$flow")
    # A failed flow can leave the app on any screen; the next flow cold-starts
    # it, but keep a screenshot of where this one ended.
    xcrun simctl io "$UDID" screenshot "$out/final-screen.png" >/dev/null 2>&1 || true
  fi
  echo "::endgroup::"
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed flows: ${failed[*]}" >&2
  exit 1
fi
echo "All ${#FLOWS[@]} flows passed"
