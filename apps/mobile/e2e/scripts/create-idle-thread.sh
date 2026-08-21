#!/usr/bin/env bash
# Creates (or reuses) an idle thread titled "$THREAD_TITLE" in the harness
# project of a running mobile e2e backend, for the flows that open a thread by
# a fixed title (`phase4b-send.yaml` → "P4b send", `phase4b-ask-user.yaml` →
# "P4b ask user", …). The thread runs on the harness host with no managed
# worktree, like the seeded "Idle thread"; the bootstrap turn finishes before
# the script returns. Prints `{threadId}` as JSON.
#
#   SERVER_URL=http://127.0.0.1:41999 THREAD_TITLE="P4b send" e2e/scripts/create-idle-thread.sh
#
# Requires curl + python3. Idempotent per title.
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:41999}"
THREAD_TITLE="${THREAD_TITLE:-P4b send}"
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
  thread_id="$(curl -fsS -X POST "$API/threads" -H 'content-type: application/json' -d "$(cat <<JSON
{
  "environment": {"type": "host", "hostId": "$host_id", "workspace": {"type": "unmanaged", "path": null}},
  "input": [{"type": "text", "text": "Reply with exactly READY and nothing else.", "mentions": []}],
  "origin": "app",
  "model": "fake-model",
  "projectId": "$project_id",
  "providerId": "fake",
  "title": "$THREAD_TITLE",
  "startedOnBehalfOf": null,
  "originKind": null
}
JSON
)" | json 'd["id"]')"
fi

# Wait for the bootstrap turn to finish so the flow finds an idle composer.
for _ in $(seq 1 60); do
  thread_status="$(curl -fsS "$API/threads/$thread_id" | json 'd["status"]')"
  if [ "$thread_status" = "idle" ]; then break; fi
  sleep 0.5
done
if [ "$thread_status" != "idle" ]; then
  echo "thread $thread_id did not become idle (status: $thread_status)" >&2
  exit 1
fi

python3 -c "import json; print(json.dumps({'threadId': '$thread_id', 'title': '$THREAD_TITLE'}))"
