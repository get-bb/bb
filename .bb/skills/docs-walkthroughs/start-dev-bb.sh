#!/bin/sh
set -eu

repo=$(git rev-parse --show-toplevel)
dir="$repo/.tmp/docs-walkthrough"
port=${WALKTHROUGH_PORT:-47186}

if [ -e "$dir/bb-data" ] && [ "${WALKTHROUGH_REUSE:-0}" != 1 ]; then
  echo "start-dev-bb: $dir/bb-data exists. Delete it for a fresh bb, or set WALKTHROUGH_REUSE=1." >&2
  exit 1
fi
mkdir -p "$dir/bb-data" "$dir/skills"
cd "$repo"

echo "start-dev-bb: App and BB_SERVER_URL http://127.0.0.1:$port"
echo "start-dev-bb: Data dir $dir/bb-data"

exec env \
  -u BB_THREAD_ID -u BB_ENVIRONMENT_ID -u BB_THREAD_STORAGE -u BB_PROJECT_ID \
  -u BB_CLI -u BB_CLI_REEXEC \
  BB_DATA_DIR="$dir/bb-data" \
  BB_SERVER_PORT="$port" \
  BB_HOST_DAEMON_PORT="$((port + 1))" \
  BB_SERVER_URL="http://127.0.0.1:$port" \
  BB_INHERITED_SKILLS_ROOTS="$dir/skills" \
  BB_SKIP_ONBOARDING=1 \
  BB_TELEMETRY=false \
  NODE_ENV=production \
  node --conditions=source --import tsx scripts/start-bb.mjs --worktree-runtime-policy
