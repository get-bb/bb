#!/usr/bin/env bash
# Seeds the Phase 6 Diff tab flow against a running mobile e2e backend:
# creates a managed-worktree thread titled "$THREAD_TITLE" (default "P6 diff")
# in the harness project, waits for its environment, then dirties the worktree
# (appends to the first tracked file, deletes the second, adds a new file) so
# the Diff tab has modified / deleted / added cards to show. Prints the thread id,
# environment id and worktree path as JSON.
#
#   SERVER_URL=http://127.0.0.1:41999 e2e/scripts/phase6-diff-setup.sh
#   maestro test e2e/flows/phase6-diff.yaml
#
# Requires curl + python3 (for JSON). The fake provider never edits files, so
# the worktree is dirtied from this shell. Idempotent per title: re-running
# reuses an existing thread with that title and re-dirties its worktree.
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:41999}"
THREAD_TITLE="${THREAD_TITLE:-P6 diff}"
API="$SERVER_URL/api/v1"

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

project_id="$(curl -fsS "$API/projects" | json 'd[0]["id"] if isinstance(d, list) else d["projects"][0]["id"]')"
host_id="$(curl -fsS "$API/hosts" | json 'd[0]["id"] if isinstance(d, list) else d["hosts"][0]["id"]')"

existing="$(curl -fsS "$API/threads?projectId=$project_id" | python3 -c "
import json,sys
d=json.load(sys.stdin)
threads=d if isinstance(d, list) else d.get('threads', d.get('items', []))
for t in threads:
    if t.get('title') == '$THREAD_TITLE' and not t.get('archivedAt'):
        print(t['id']); break
")"

if [ -n "$existing" ]; then
  thread_id="$existing"
else
  thread_id="$(curl -fsS -X POST "$API/threads" -H 'content-type: application/json' -d "$(cat <<EOF
{
  "environment": {"type": "host", "hostId": "$host_id", "workspace": {"type": "managed-worktree", "baseBranch": {"kind": "default"}}},
  "input": [{"type": "text", "text": "Reply with exactly READY and nothing else.", "mentions": []}],
  "origin": "app",
  "model": "fake-model",
  "projectId": "$project_id",
  "providerId": "fake",
  "title": "$THREAD_TITLE",
  "startedOnBehalfOf": null,
  "originKind": null
}
EOF
)" | json 'd["id"]')"
fi

# Wait for the thread to settle and its environment to be ready.
for _ in $(seq 1 60); do
  thread_json="$(curl -fsS "$API/threads/$thread_id?include=environment")"
  env_status="$(printf '%s' "$thread_json" | json '(d.get("environment") or {}).get("status", "")')"
  thread_status="$(printf '%s' "$thread_json" | json 'd["status"]')"
  if [ "$env_status" = "ready" ] && [ "$thread_status" = "idle" ]; then break; fi
  sleep 0.5
done
environment_id="$(printf '%s' "$thread_json" | json 'd["environment"]["id"]')"
worktree="$(printf '%s' "$thread_json" | json 'd["environment"]["path"]')"
if [ -z "$worktree" ] || [ ! -d "$worktree" ]; then
  echo "worktree not found for thread $thread_id: '$worktree'" >&2
  exit 1
fi

# Dirty the worktree (after resetting it so re-runs start clean): modify
# the first tracked file, delete the second, add a new one.
git -C "$worktree" checkout -- . >/dev/null 2>&1 || true
git -C "$worktree" clean -fdq >/dev/null 2>&1 || true
modified=""; deleted=""
while IFS= read -r tracked; do
  [ -z "$tracked" ] && continue
  # A previous run may have committed the added file; never pick it.
  [ "$tracked" = "phase6-added.ts" ] && continue
  if [ -z "$modified" ]; then
    printf '\nPhase 6 diff tab check: %s\n' "$(date +%s)" >> "$worktree/$tracked"
    modified="$tracked"
  elif [ -z "$deleted" ]; then
    rm -f "$worktree/$tracked"; deleted="$tracked"
  fi
done < <(git -C "$worktree" ls-files)
printf 'export const phase6 = "diff tab %s";\n' "$(date +%s)" > "$worktree/phase6-added.ts"

python3 -c "import json; print(json.dumps({'threadId': '$thread_id', 'environmentId': '$environment_id', 'worktree': '$worktree', 'modified': '$modified', 'deleted': '$deleted', 'added': 'phase6-added.ts'}))"
