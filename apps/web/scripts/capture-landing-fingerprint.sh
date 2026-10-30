#!/usr/bin/env bash
set -euo pipefail

repo_dir="$1"
port="$2"
out_file="$3"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$repo_dir"
pnpm exec turbo run build --filter=@bb/web --output-logs=errors-only

cd apps/web
pnpm exec vite preview --port "$port" --strictPort --host 127.0.0.1 >"$out_file.preview.log" 2>&1 &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fs -o /dev/null "http://127.0.0.1:$port/"; then
    break
  fi
  sleep 1
done

node "$script_dir/landing-fingerprint.mjs" capture "http://127.0.0.1:$port" "$out_file"
