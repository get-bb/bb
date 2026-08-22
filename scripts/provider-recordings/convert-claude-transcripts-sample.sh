#!/usr/bin/env bash
# Rebuild the committed claude-code transcript fixtures
# (plugins/provider-claude-code/src/__fixtures__/transcripts) from the private
# ~/.claude/projects transcripts: convert the listed session windows, redact,
# and write the combined manifest.
#
#   scripts/provider-recordings/convert-claude-transcripts-sample.sh [<out-dir>]
#
# Every session below is one of the owner's own bb threads (the provider
# corpus, ~/.bb/provider-corpus). The turn windows keep the committed set under
# 2 MB after redaction while covering each tool family the bridge classifies.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="${1:-$repo/plugins/provider-claude-code/src/__fixtures__/transcripts}"
projects="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# name|session id|turn window (empty = whole session)
samples=(
  "plan-mode-question|7a71324d-fcce-40f3-aca1-74b7ffc76696|"
  "web-search|b06abf67-b557-4cbc-bedf-cc6ae3ab2a01|"
  "background-agents|066f194c-e2fb-49d3-aedf-3521a8b2bcb5|"
  "bb-workflow-run|2999e5c8-91ce-4f2e-b072-a1c50e090837|"
  "task-plan-model-fallback|323f2806-8588-459c-90fc-25dda27402dd|6-6"
  "foreground-agent-api-retry|84dab3b1-7106-42a9-b51f-3cb94441afa7|1-2"
  "compaction-workflow|d4e90804-c43a-4cce-ac69-867234e18ca9|45-46"
  "schedule-wakeup-workflow|189cb3f9-8985-4b7b-93a8-dc5a0f807839|30-31"
  "send-message-edits|b6b918c7-a0f7-4b31-a905-ad1631c21bea|4-4"
  "workflow-task-stop|1db951dc-f0c6-4468-a3a8-6b172b81440f|4-4"
  "task-output|91157b32-7bc2-416d-9db0-ce14b510018e|10-10"
  "web-fetch-reads|6ed336e0-598c-4a80-a80b-6871eab34d92|"
)

mkdir -p "$work/raw"
for sample in "${samples[@]}"; do
  IFS='|' read -r name session turns <<<"$sample"
  path="$(find "$projects" -name "$session.jsonl" -print -quit)"
  if [[ -z "$path" ]]; then
    echo "missing transcript for $name ($session)" >&2
    exit 1
  fi
  args=()
  if [[ -n "$turns" ]]; then
    args=(--turns "$turns")
  fi
  node "$here/convert-claude-transcript.mjs" "$path" "$work/raw/$name.ndjson" \
    --manifest "$work/raw/$name.manifest.json" "${args[@]}" >/dev/null
done

node "$here/redact.mjs" "$work/raw" "$work/redacted"

mkdir -p "$out"
rm -f "$out"/*.ndjson
cp "$work/redacted"/*.ndjson "$out/"
node - "$work/redacted" "$out/manifest.json" <<'EOF'
const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [dir, target] = process.argv.slice(2);
const manifest = {};
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith(".manifest.json")) continue;
  manifest[name.replace(/\.manifest\.json$/, "")] = JSON.parse(
    readFileSync(join(dir, name), "utf8"),
  );
}
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
EOF

(cd "$repo" && pnpm exec oxfmt "$out/manifest.json" >/dev/null)
du -sh "$out"
