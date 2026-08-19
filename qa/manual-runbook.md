# Real-Provider CLI/API E2E Manual Runbook

This runbook covers the thorough non-app end-to-end validation pass for bb's
server, host daemon, CLI, API, database state, and real provider paths. It is
written against the current standalone persistent-host setup and intentionally
does not claim generic "Full QA" or release readiness by itself.

Use this when you need to validate real-provider CLI/API behavior with
standalone server + daemon infrastructure: prompts, follow-ups, managed
worktrees, thread lifecycle, restart/reconnect behavior, API responses, DB
state, and logs. This pass does not cover app UI, Electron, or browser behavior.

## QA Gate Taxonomy

- **CI validation** runs Turbo/build/typecheck/lint/unit/integration/package
  smoke checks. It is automated validation, not manual product QA.
- **Regression validation** reruns targeted or broad checks after a specific
  change. Its verdict is scoped to the changed behavior.
- **Real-provider CLI/API E2E** is this non-app provider gate. The automated
  companion is `pnpm exec turbo run test:integration`, including real-provider
  coverage under `tests/integration/real/**` and `@bb/agent-runtime`; this
  manual runbook adds operator-driven CLI/API, standalone server + daemon,
  restart, lifecycle, API, DB, and log checks.
- **Smoke QA** is a shallow liveness check on a running app or surface. It is
  useful for quick confidence but does not establish release readiness.
- **Release QA / Full QA** combines CI/regression validation, Real-provider
  CLI/API E2E where applicable, and app-driven manual/browser/Electron product
  flows with an explicit pass/fail/NA matrix. Any required release row that is
  not run makes the release verdict incomplete.

## Not Covered By This Runbook

Pair this runbook with app QA whenever a release or change needs product-flow,
visual, or shell confidence. App QA should cover the rich prompt editor,
mentions, sidebar pinning/collapse/drag-and-drop, settings/provider UI,
Electron shell behavior, browser routing, visual layout, and other in-app flows.

This runbook can find server/daemon/provider/CLI/API regressions that app QA may
miss, but it will not catch visual regressions, broken browser interactions,
Electron packaging or window behavior, or UI-only provider-selection issues.

## CLI/API Surface Matrix Scope

Treat the CLI matrix as a product-surface check, not a wishlist of possible
commands.

- Thread recovery is validated with the existing lifecycle commands:
  `bb thread stop`, `bb thread tell`, `bb thread spawn`, archive/unarchive, and
  the recovery checks below. When the provider-retry plugin is installed,
  `bb provider-retry retry <thread-id>` is the manual path for a failed,
  accepted provider rate-limit turn; inspect the thread before using it. For
  other failed or interrupted threads, send a fresh turn with `bb thread tell`,
  or create a replacement with `bb thread spawn` when a new thread is the right
  recovery path.

## Prerequisites

Build the server, daemon, and CLI:

```bash
pnpm build
```

Verify provider CLIs are installed before running real-provider checks:

```bash
codex --help
claude --help
pi --help
jq --help
sqlite3 --version
```

Default-path QA must not use generic OpenAI API-key routes. Clear ambient
`OPENAI_API_KEY` before a normal pass. To intentionally validate API-key routes,
set `BB_QA_OPENAI_API_KEY` and record that the pass is opt-in.

```bash
if [ -n "${OPENAI_API_KEY:-}" ] && [ -z "${BB_QA_OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY is set. Unset it for default-path QA, or set BB_QA_OPENAI_API_KEY for an explicit API-key route pass."
  false
fi
```

## Standalone Setup

Before starting, clear any leftover standalone QA processes or temp roots from a prior run:

```bash
pnpm qa:standalone:cleanup
```

Start an isolated server + daemon pair and load the exported QA environment:

```bash
eval "$(pnpm --silent qa:standalone:start --format env)"
jq . "$STATE_PATH"
SERVER_DB_PATH=$(jq -er '.server.dataDir + "/bb.db"' "$STATE_PATH")
SERVER_LOG_DIR=$(jq -er '(.paths.serverDataDir // .server.dataDir) + "/logs"' "$STATE_PATH")
DAEMON_LOG_DIR=$(jq -er '(.paths.daemonDataDir // .daemon.dataDir) + "/logs"' "$STATE_PATH")
DAEMON_RESTART_PID_PATH=$(jq -er '.paths.daemonRestartPidPath' "$STATE_PATH")

bb() { env -u BB_CLI node apps/cli/dist/index.js "$@"; }
```

The machine-facing contract is the exported env block. The state file at `$STATE_PATH`
is the diagnostics contract for humans and debugging.

Basic health checks:

```bash
curl -fsS "$BB_SERVER_URL/api/v1/system/config" | jq
curl -fsS "$BB_SERVER_URL/api/v1/hosts" | jq
bb status
bb provider list
```

Resolve current provider models before spawning real-provider threads:

```bash
CODEX_MODEL=$(bb provider models codex --json | jq -er '([.[] | select(.isDefault)][0].model // .[0].model)')
CLAUDE_MODEL=$(bb provider models claude-code --json | jq -er '([.[] | select(.model == "claude-haiku-4-5")][0].model // [.[] | select(.isDefault)][0].model // .[0].model)')
PI_MODELS_JSON=$(bb provider models pi --json)
# Keep Pi preference order in sync with packages/test-helpers/src/provider-models.ts.
PI_MODEL=$(printf '%s\n' "$PI_MODELS_JSON" | jq -er '
  [.[] | select(.model == "openai-codex/gpt-5.5")][0].model
  // [.[] | select(.model == "openai-codex/gpt-5.4")][0].model
  // [.[] | select(.model == "openai-codex/gpt-5.4-mini")][0].model
  // [.[] | select(.model == "openai-codex/gpt-5.3-codex")][0].model
  // [.[] | select(.model == "anthropic/claude-haiku-4-5")][0].model
  // [.[] | select(.model | startswith("anthropic/")) | select(.isDefault)][0].model
  // [.[] | select(.model | startswith("openai-codex/")) | select(.isDefault)][0].model
  // [.[] | select(.model | startswith("openai-codex/"))][0].model
  // [.[] | select(.model | startswith("anthropic/"))][0].model
  // [.[] | select(.isDefault)][0].model
  // .[0].model
')

printf 'codex: %s\nclaude-code: %s\npi: %s\n' "$CODEX_MODEL" "$CLAUDE_MODEL" "$PI_MODEL"

case "$PI_MODEL" in
  openai/*)
    if [ "${BB_QA_ALLOW_OPENAI_API_KEY_MODELS:-}" != "1" ]; then
      echo "Pi resolved to generic OpenAI API-key model $PI_MODEL. Pick a subscription-backed model or set BB_QA_ALLOW_OPENAI_API_KEY_MODELS=1 for an explicit API-key route pass."
      false
    fi
    ;;
esac
```

## API Prompt Attachments

Public API `localFile` and `localImage` prompt parts use one of two path
forms:

- Absolute or URI-like paths are passed through to the runtime as already
  readable paths.
- Relative paths are project attachment references returned by
  `POST /api/v1/projects/:id/attachments`. They are not workspace-relative file
  paths. Do not submit `{ "type": "localFile", "path": "alpha.txt" }` for
  `$PROJECT_ROOT/alpha.txt`; upload the file first and use the returned `path`.

Validate the upload-and-reference flow before any prompt/timeline attachment QA:

```bash
ATTACHMENT_JSON=$(
  curl -fsS \
    -X POST "$BB_SERVER_URL/api/v1/projects/$BB_PROJECT_ID/attachments" \
    -F "file=@$PROJECT_ROOT/alpha.txt"
)
echo "$ATTACHMENT_JSON" | jq

PROMPT_TEXT='Review @alpha.txt and reply exactly ATTACHMENT OK.'
MENTION_TEXT='@alpha.txt'
THREAD_CREATE_BODY=$(
  jq -n \
    --arg projectId "$BB_PROJECT_ID" \
    --arg hostId "$HOST_ID" \
    --arg model "$CODEX_MODEL" \
    --arg text "$PROMPT_TEXT" \
    --arg mention "$MENTION_TEXT" \
    --argjson attachment "$ATTACHMENT_JSON" '
      ($text | index($mention)) as $start |
      {
        origin: "app",
        projectId: $projectId,
        providerId: "codex",
        model: $model,
        input: [
          {
            type: "text",
            text: $text,
            mentions: [
              {
                start: $start,
                end: ($start + ($mention | length)),
                resource: {
                  kind: "path",
                  source: "workspace",
                  entryKind: "file",
                  path: "alpha.txt",
                  label: "alpha.txt"
                }
              }
            ]
          },
          (
            if $attachment.type == "localFile" then
              {
                type: "localFile",
                path: $attachment.path,
                name: $attachment.name,
                sizeBytes: $attachment.sizeBytes
              } + (if $attachment.mimeType then { mimeType: $attachment.mimeType } else {} end)
            else
              { type: "localImage", path: $attachment.path }
            end
          )
        ],
        environment: {
          type: "host",
          hostId: $hostId,
          workspace: {
            type: "unmanaged",
            path: null
          }
        }
      }
    '
)
THREAD_JSON=$(
  curl -fsS \
    -H 'content-type: application/json' \
    -d "$THREAD_CREATE_BODY" \
    "$BB_SERVER_URL/api/v1/threads"
)
THREAD_ID=$(echo "$THREAD_JSON" | jq -er '.id')
curl -fsS "$BB_SERVER_URL/api/v1/threads/$THREAD_ID/timeline" |
  jq '.rows[] | select(.kind == "conversation" and .role == "user") | {mentions, attachments}'
```

For exact-output checks, use prompts in the form `Say exactly: <EXPECTED TEXT>`.
Avoid phrasing like "reply only in chat with..." because providers can interpret that
as a behavioral constraint rather than the expected response text.

For Pi checks, prefer subscription-backed `openai-codex/...` models from Codex
subscription auth first, then `anthropic/...` models from Claude/Anthropic auth,
over generic `openai/...` API-key models. Generic `openai/...` Pi models are
only acceptable in an explicitly recorded API-key route pass.

Teardown:

```bash
pnpm qa:standalone:stop --state "$STATE_PATH"
pnpm qa:standalone:cleanup
```

## CLI/API Thread Smoke Pass

Spawn an unmanaged Codex thread and wait for it to finish:

```bash
SMOKE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Say hello from the smoke pass" \
  --json | jq -r '.id')

bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
bb thread show "$SMOKE_THREAD_ID"
bb thread output "$SMOKE_THREAD_ID"
bb thread log "$SMOKE_THREAD_ID" --format json | jq '.[-10:]'
```

Send a follow-up after idle:

```bash
bb thread tell "$SMOKE_THREAD_ID" "Now say goodbye from the smoke pass"
bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
bb thread output "$SMOKE_THREAD_ID"
```

Create a parent thread and child thread, then verify the first bootstrap reaches
idle without protocol disconnect symptoms. This is a user-facing smoke check;
malformed host-RPC message invariants require automated boundary tests.

```bash
THREAD_PROTOCOL_STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M")
PROTOCOL_PARENT_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --title "QA protocol smoke parent" \
  --prompt "Say hello from the parent protocol smoke check." \
  --json | jq -r '.id')

bb thread wait "$PROTOCOL_PARENT_ID" --status idle --timeout 240

PROTOCOL_CHILD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --parent-thread "$PROTOCOL_PARENT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --title "QA protocol smoke child" \
  --prompt "Say hello from the child protocol smoke check." \
  --json | jq -r '.id')

bb thread wait "$PROTOCOL_CHILD_ID" --status idle --timeout 240
bb thread show "$PROTOCOL_PARENT_ID" --json | jq '.thread | {id, parentThreadId, providerId, status}'
bb thread show "$PROTOCOL_CHILD_ID" --json | jq '.thread | {id, parentThreadId, providerId, status}'
bb thread output "$PROTOCOL_CHILD_ID"
if bb manager list; then
  echo "expected bb manager list to fail"
  exit 1
fi
bb manager list 2>&1 | rg "Managers were replaced by parent threads|bb thread"
printf 'thread protocol smoke started at UTC minute: %s\n' "$THREAD_PROTOCOL_STARTED_AT"
rg -n "invalid-message|1008|host_unavailable|command_result_type_mismatch|Ignoring host RPC response" \
  "$SERVER_LOG_DIR" "$DAEMON_LOG_DIR" || true
```

Expected result:

- the parent and child threads reach `idle`
- the child thread reports the parent thread ID
- `bb manager list` exits non-zero with a parent-thread replacement message
- server and daemon logs have no matching protocol disconnect or host-RPC
  mismatch entries at or after `$THREAD_PROTOCOL_STARTED_AT`

Create a managed worktree thread and inspect workspace status:

```bash
WORKTREE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Create a file named smoke.txt and briefly confirm it" \
  --json | jq -r '.id')

bb thread wait "$WORKTREE_THREAD_ID" --status idle --timeout 120
WORKTREE_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$WORKTREE_THREAD_ID" | jq -r '.environmentId')

bb thread show "$WORKTREE_THREAD_ID"
bb thread output "$WORKTREE_THREAD_ID"
bb thread show "$WORKTREE_THREAD_ID" --work-status
bb thread show "$WORKTREE_THREAD_ID" --git-diff --diff-target uncommitted
bb thread show "$WORKTREE_THREAD_ID" --git-diff --diff-target branch_committed
bb thread show "$WORKTREE_THREAD_ID" --git-diff --diff-target all
curl -fsS "$BB_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID" | jq
curl -fsS "$BB_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID/status" | jq
curl -fsS "$BB_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID/diff/branches" | jq
```

Verify Codex-backed helper inference for environment commit. This catches
regressions where the default helper path accidentally falls back to generic
OpenAI API-key inference.

```bash
WORKTREE_ENV_PATH=$(curl -fsS "$BB_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID" | jq -er '.path')
printf 'helper inference commit smoke\n' > "$WORKTREE_ENV_PATH/helper-inference-smoke.txt"

bb environment commit "$WORKTREE_ENV_ID" --json | jq -e '.action == "commit" and (.commitSha | type == "string")'
```

Verify merge-base environment metadata:

```bash
MERGE_BASE_BRANCH=$(curl -fsS "$BB_SERVER_URL/api/v1/environments/$WORKTREE_ENV_ID" | jq -er '.defaultBranch // "main"')

bb environment update "$WORKTREE_ENV_ID" --merge-base-branch "$MERGE_BASE_BRANCH"
bb environment show "$WORKTREE_ENV_ID" --json | jq -e --arg branch "$MERGE_BASE_BRANCH" '.mergeBaseBranch == $branch'
bb thread show "$WORKTREE_THREAD_ID" --work-status --git-diff --diff-target all

bb environment update "$WORKTREE_ENV_ID" --clear-merge-base-branch
bb environment show "$WORKTREE_ENV_ID" --json | jq -e '.mergeBaseBranch == null'
```

Archive and unarchive the smoke thread:

```bash
bb thread archive "$SMOKE_THREAD_ID"
curl -fsS "$BB_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq

if bb thread tell "$SMOKE_THREAD_ID" "This should fail while archived"; then
  echo "expected archived thread tell to fail"
  false
else
  echo "archived thread tell was blocked"
fi

bb thread unarchive "$SMOKE_THREAD_ID"
bb thread tell "$SMOKE_THREAD_ID" "Say something after unarchive"
bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
bb thread output "$SMOKE_THREAD_ID"
```

Verify archive cleanup for a dirty managed worktree:

```bash
DIRTY_ARCHIVE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: dirty archive setup" \
  --json | jq -r '.id')

bb thread wait "$DIRTY_ARCHIVE_THREAD_ID" --status idle --timeout 120
DIRTY_ARCHIVE_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$DIRTY_ARCHIVE_THREAD_ID" | jq -r '.environmentId')
DIRTY_ARCHIVE_ENV_PATH=$(curl -fsS "$BB_SERVER_URL/api/v1/environments/$DIRTY_ARCHIVE_ENV_ID" | jq -er '.path')
printf 'dirty archive safety\n' > "$DIRTY_ARCHIVE_ENV_PATH/dirty-archive.txt"
bb thread show "$DIRTY_ARCHIVE_THREAD_ID" --work-status

bb thread archive "$DIRTY_ARCHIVE_THREAD_ID"

curl -fsS "$BB_SERVER_URL/api/v1/threads/$DIRTY_ARCHIVE_THREAD_ID" | jq -e '.archivedAt != null'
DIRTY_ARCHIVE_ENV_STATUS=$(curl -fsS "$BB_SERVER_URL/api/v1/environments/$DIRTY_ARCHIVE_ENV_ID" | jq -r '.status')
test "$DIRTY_ARCHIVE_ENV_STATUS" = "retiring"
test -e "$DIRTY_ARCHIVE_ENV_PATH"

# A last-live archived managed environment remains revivable during the five-minute
# archive grace period. Permanently deleting the thread removes that revival path
# and makes the environment immediately eligible for destruction.
bb thread delete "$DIRTY_ARCHIVE_THREAD_ID" --yes

for i in $(seq 1 60); do
  DIRTY_ARCHIVE_ENV_STATUS=$(curl -fsS "$BB_SERVER_URL/api/v1/environments/$DIRTY_ARCHIVE_ENV_ID" | jq -r '.status')
  test "$DIRTY_ARCHIVE_ENV_STATUS" = "destroyed" && break
  sleep 1
done
test "$DIRTY_ARCHIVE_ENV_STATUS" = "destroyed"
test ! -e "$DIRTY_ARCHIVE_ENV_PATH"
```

Expected result:

- The unmanaged thread reaches `idle`, shows output, and accepts a follow-up.
- The worktree thread reaches `idle`, the environment reports `isWorktree: true`, and workspace status/diff routes return data for uncommitted, branch-committed, and combined targets.
- `bb environment commit` succeeds with helper-generated commit text without requiring `OPENAI_API_KEY`.
- Environment merge-base metadata can be set, reflected by `bb environment show`, used by thread status/diff output, and cleared.
- Archiving blocks `bb thread tell`; unarchiving restores normal operation.
- Archiving the last live dirty managed worktree puts it in `retiring` and preserves it during the undo grace period; permanently deleting its archived thread then destroys the environment and removes the worktree even while uncommitted or unmerged work remains.

## Multi-Thread and Shared Environment

Create thread A and capture its environment:

```bash
THREAD_A_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Say exactly: THREAD A HELLO" \
  --json | jq -r '.id')

bb thread wait "$THREAD_A_ID" --status idle --timeout 120
THREAD_A_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$THREAD_A_ID" | jq -r '.environmentId')
bb thread output "$THREAD_A_ID"
```

Create thread B in the same project source path and let the server reuse the ready direct-workspace environment implicitly:

```bash
THREAD_B_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Say exactly: THREAD B WORLD" \
  --json | jq -r '.id')

bb thread wait "$THREAD_B_ID" --status idle --timeout 120
THREAD_B_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$THREAD_B_ID" | jq -r '.environmentId')

printf 'thread A env: %s\nthread B env: %s\n' "$THREAD_A_ENV_ID" "$THREAD_B_ENV_ID"
bb thread output "$THREAD_B_ID"
```

Alternate follow-ups across the two sibling threads:

```bash
bb thread tell "$THREAD_A_ID" "Say exactly: FOLLOW UP A"
bb thread wait "$THREAD_A_ID" --status idle --timeout 120

bb thread tell "$THREAD_B_ID" "Say exactly: FOLLOW UP B"
bb thread wait "$THREAD_B_ID" --status idle --timeout 120

bb thread output "$THREAD_A_ID"
bb thread output "$THREAD_B_ID"
bb thread log "$THREAD_A_ID" --format json | jq '.[-8:]'
bb thread log "$THREAD_B_ID" --format json | jq '.[-8:]'
```

Archive thread A and verify thread B still works:

```bash
bb thread archive "$THREAD_A_ID"
bb thread tell "$THREAD_B_ID" "Say exactly: STILL WORKING"
bb thread wait "$THREAD_B_ID" --status idle --timeout 120
bb thread output "$THREAD_B_ID"
bb thread unarchive "$THREAD_A_ID"
```

Run a mixed-provider pass in separate environments:

```bash
CLAUDE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider claude-code \
  --model "$CLAUDE_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: CLAUDE THREAD" \
  --json | jq -r '.id')

PI_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider pi \
  --model "$PI_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: PI THREAD" \
  --json | jq -r '.id')

bb thread wait "$CLAUDE_THREAD_ID" --status idle --timeout 120
bb thread wait "$PI_THREAD_ID" --status idle --timeout 180
CLAUDE_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$CLAUDE_THREAD_ID" | jq -r '.environmentId')
PI_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$PI_THREAD_ID" | jq -r '.environmentId')

printf 'claude env: %s\npi env: %s\n' "$CLAUDE_ENV_ID" "$PI_ENV_ID"
bb thread output "$CLAUDE_THREAD_ID"
bb thread output "$PI_THREAD_ID"
```

Expected result:

- Thread A and B share the same environment ID via implicit same-path reuse.
- Alternating follow-ups complete and return the requested exact outputs.
- Archiving one sibling does not break the other.
- Mixed-provider threads succeed without event cross-contamination.

## Recovery

Graceful daemon restart:

```bash
kill -TERM "$DAEMON_PID"
curl -fsS "$BB_SERVER_URL/api/v1/system/config" | jq
curl -fsS "$BB_SERVER_URL/api/v1/hosts" | jq

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$(cat "$DAEMON_RESTART_PID_PATH")

curl -fsS "$BB_SERVER_URL/api/v1/hosts" | jq
bb thread tell "$SMOKE_THREAD_ID" "Check recovery after daemon restart"
bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
bb thread output "$SMOKE_THREAD_ID"
```

Provisioning failure and next-message retry:

```bash
# Commit a supported setup hook that fails exactly once across worktrees in the
# disposable repository. The marker lives in the shared Git directory, so the
# first failed worktree can be removed without losing it.
cat > "$PROJECT_ROOT/.bb-env-setup.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
MARKER="$(git rev-parse --path-format=absolute --git-common-dir)/bb-qa-provision-failed-once"
if [ ! -e "$MARKER" ]; then
  touch "$MARKER"
  echo "intentional one-time QA setup failure" >&2
  exit 42
fi
EOF
git -C "$PROJECT_ROOT" add .bb-env-setup.sh
git -C "$PROJECT_ROOT" commit -m "qa: fail one worktree setup"

PROVISION_RETRY_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Say exactly: initial provisioning should fail" \
  --json | jq -r '.id')

bb thread wait "$PROVISION_RETRY_THREAD_ID" --status error --timeout 120
PROVISION_RETRY_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$PROVISION_RETRY_THREAD_ID" | jq -er '.environmentId')
curl -fsS "$BB_SERVER_URL/api/v1/environments/$PROVISION_RETRY_ENV_ID" | jq -e '.status == "error"'
bb thread log "$PROVISION_RETRY_THREAD_ID" --format json \
  | jq -e 'any(.[]; .type == "system/error" and (.data.code // .code // null) == "thread_provisioning_failed")'

# Retry only after the first provisioning RPC has completed as a real failure.
# This next message starts a fresh provision; it does not recover an in-flight
# RPC or rely on a persisted provisioning-attempt identifier.
bb thread tell "$PROVISION_RETRY_THREAD_ID" "Say exactly: provisioning retry ok" --mode auto
bb thread wait "$PROVISION_RETRY_THREAD_ID" --status idle --timeout 180
bb thread output "$PROVISION_RETRY_THREAD_ID"
curl -fsS "$BB_SERVER_URL/api/v1/environments/$PROVISION_RETRY_ENV_ID" | jq -e '.status == "ready"'

PROVISION_RETRY_MARKER="$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir)/bb-qa-provision-failed-once"
rm -f "$PROVISION_RETRY_MARKER"
git -C "$PROJECT_ROOT" rm .bb-env-setup.sh
git -C "$PROJECT_ROOT" commit -m "qa: remove one-time setup failure"
```

Expected result:

- The first setup hook failure completes with the thread and environment in
  `error` and records `thread_provisioning_failed`.
- Sending the next message with `--mode auto` starts a fresh provisioning
  attempt for the same thread and environment, which reaches `ready` before the
  turn runs.
- Nothing in this scenario promises recovery of an in-flight provisioning RPC
  across a server restart.

Host offline before send:

```bash
kill -TERM "$DAEMON_PID"
for _ in $(seq 1 60); do
  HOST_STATUS=$(curl -fsS "$BB_SERVER_URL/api/v1/hosts" | jq -r --arg host "$HOST_ID" '.[] | select(.id == $host) | .status')
  [ "$HOST_STATUS" != "connected" ] && break
  sleep 1
done
test "$HOST_STATUS" != "connected"

if bb thread tell "$SMOKE_THREAD_ID" "This should fail while the host is offline"; then
  echo "expected offline host send to fail"
  false
else
  echo "offline host send failed fast"
fi

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$(cat "$DAEMON_RESTART_PID_PATH")
bb thread tell "$SMOKE_THREAD_ID" "Say exactly: offline retry ok"
bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
bb thread output "$SMOKE_THREAD_ID"
```

Expected result:

- Sending while the host is offline fails fast.
- No new host command/request queue row is inserted. Upgraded large databases may
  retain retired queue tables as inert migration debris, but the live-RPC path
  must not write to them.
- Retrying after the daemon reconnects works as a fresh live RPC request.

Daemon hot-replace mid-RPC:

```bash
HOT_REPLACE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --prompt "Write 80 detailed bullet points about the history of operating systems." \
  --json | jq -r '.id')

bb thread wait "$HOT_REPLACE_THREAD_ID" --status active --timeout 30
OLD_DAEMON_PID=$DAEMON_PID
eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$(cat "$DAEMON_RESTART_PID_PATH")
test "$DAEMON_PID" != "$OLD_DAEMON_PID"

curl -fsS "$BB_SERVER_URL/api/v1/hosts" | jq
bb thread show "$HOT_REPLACE_THREAD_ID"
bb thread log "$HOT_REPLACE_THREAD_ID" --format json | jq '.[-12:]'
```

Expected result:

- The old live waiter is rejected or settled when the old daemon session drops.
- Any late response from the old session is ignored and is not mis-routed to the
  replacement daemon session.
- The thread remains inspectable and records a `thread_command_failed` system
  error, or an equivalent explicit interruption/error event, for the interrupted
  RPC.

Kill the daemon during active work:

```bash
bb thread tell "$SMOKE_THREAD_ID" "Write 80 detailed bullet points about the history of computing."
bb thread wait "$SMOKE_THREAD_ID" --status active --timeout 30

kill -TERM "$DAEMON_PID"
bb thread show "$SMOKE_THREAD_ID"

eval "$RESTART_DAEMON_COMMAND"
DAEMON_PID=$(cat "$DAEMON_RESTART_PID_PATH")

THREAD_STATE=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq -r '.status')

if [ "$THREAD_STATE" = "active" ]; then
  # The disconnect settlement can race this snapshot: `wait` may observe that
  # the thread already became `error` and correctly return non-zero. Re-read
  # state instead of treating that expected terminal transition as a QA failure.
  bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 180 || true
fi

THREAD_STATE=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq -r '.status')
if [ "$THREAD_STATE" != "idle" ]; then
  bb thread tell "$SMOKE_THREAD_ID" "Say exactly: recovery ok" --mode auto
  bb thread wait "$SMOKE_THREAD_ID" --status idle --timeout 120
fi

bb thread output "$SMOKE_THREAD_ID"
bb thread log "$SMOKE_THREAD_ID" --format json | jq '.[-12:]'
bb thread log "$SMOKE_THREAD_ID" --format json \
  | jq -e 'any(.[]; .type == "system/error" and (.data.code // .code // null) == "thread_command_failed")'
```

Inspect logs and state:

```bash
tail -n 200 "$SERVER_LOG_DIR"/server*.log
tail -n 200 "$DAEMON_LOG_DIR"/host-daemon*.log
curl -fsS "$BB_SERVER_URL/api/v1/threads/$SMOKE_THREAD_ID" | jq
```

Expected result:

- The server stays up while the daemon is restarted.
- Threads remain inspectable during and after daemon loss.
- After an interruption mid-turn, the thread records a `thread_command_failed`
  system error, or an equivalent explicit interruption/error event, and then
  reaches `idle`/`error` and accepts a short new turn after restart.

## Provider-Specific Pass

Repeat this section for `codex`, `claude-code`, and `pi`:

Use the resolved model for each provider:

- `codex`: `--model "$CODEX_MODEL"`
- `claude-code`: `--model "$CLAUDE_MODEL"`
- `pi`: `--model "$PI_MODEL"`

```bash
PROVIDER_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider <provider-id> \
  --model <provider-model> \
  --reasoning-level low \
  --prompt "Say exactly: hello world" \
  --json | jq -r '.id')

bb thread wait "$PROVIDER_THREAD_ID" --status idle --timeout 120
bb thread output "$PROVIDER_THREAD_ID"

bb thread tell "$PROVIDER_THREAD_ID" "Repeat the previous answer in uppercase"
bb thread wait "$PROVIDER_THREAD_ID" --status idle --timeout 120
bb thread output "$PROVIDER_THREAD_ID"

bb thread tell "$PROVIDER_THREAD_ID" "Write a very long essay about computing history"
bb thread wait "$PROVIDER_THREAD_ID" --status active --timeout 30
bb thread stop "$PROVIDER_THREAD_ID"
bb thread wait "$PROVIDER_THREAD_ID" --status idle --timeout 120
bb thread show "$PROVIDER_THREAD_ID"
bb thread log "$PROVIDER_THREAD_ID" --format json | jq '.[-10:]'
```

For workspace interaction, repeat on a worktree thread:

```bash
PROVIDER_WORKTREE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider <provider-id> \
  --model <provider-model> \
  --reasoning-level low \
  --new-environment worktree \
  --prompt "Create hello.txt containing hello world" \
  --json | jq -r '.id')

bb thread wait "$PROVIDER_WORKTREE_THREAD_ID" --status idle --timeout 120
PROVIDER_WORKTREE_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$PROVIDER_WORKTREE_THREAD_ID" | jq -r '.environmentId')

bb thread output "$PROVIDER_WORKTREE_THREAD_ID"
curl -fsS "$BB_SERVER_URL/api/v1/environments/$PROVIDER_WORKTREE_ENV_ID/status" | jq
```

Run a pending-interaction pass with permission-restricted turns:

```bash
# Codex sandboxes commonly permit the OS temp directory. Put the disposable
# target under the user home so it is reliably outside the managed worktree.
APPROVAL_DIR=$(mktemp -d "${HOME:?}/.bb-approval-smoke.XXXXXX")
APPROVAL_FILE="$APPROVAL_DIR/approval-smoke.txt"
APPROVAL_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --permission-mode accept-edits \
  --prompt "Run this exact shell command: printf 'APPROVED' > '$APPROVAL_FILE'. If approval is needed, request approval. After the command finishes, reply with exactly DONE." \
  --json | jq -r '.id')

APPROVAL_INTERACTION_ID=
for _ in {1..60}; do
  APPROVAL_INTERACTION_ID=$(bb thread interactions list "$APPROVAL_THREAD_ID" --json | jq -r '.[0].id // empty')
  if [ -n "$APPROVAL_INTERACTION_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$APPROVAL_INTERACTION_ID"

bb thread interactions show "$APPROVAL_INTERACTION_ID" "$APPROVAL_THREAD_ID"

if bb thread tell "$APPROVAL_THREAD_ID" "This should be blocked while an interaction is pending"; then
  echo "expected tell to be blocked while the interaction is pending"
  false
else
  echo "tell was blocked while the interaction was pending"
fi

bb thread interactions approve "$APPROVAL_INTERACTION_ID" "$APPROVAL_THREAD_ID"
bb thread wait "$APPROVAL_THREAD_ID" --status idle --timeout 180
bb thread output "$APPROVAL_THREAD_ID"
bb thread interactions list "$APPROVAL_THREAD_ID" --json | jq
test "$(cat "$APPROVAL_FILE")" = "APPROVED"
```

Verify denial handling with a separate interaction:

```bash
DENY_DIR=$(mktemp -d "${HOME:?}/.bb-denial-smoke.XXXXXX")
DENY_FILE="$DENY_DIR/denied-smoke.txt"
DENY_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model "$CODEX_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --permission-mode accept-edits \
  --prompt "Run this exact shell command: printf 'DENIED' > '$DENY_FILE'. If approval is denied, reply with exactly DENIED." \
  --json | jq -r '.id')

DENY_INTERACTION_ID=
for _ in {1..60}; do
  DENY_INTERACTION_ID=$(bb thread interactions list "$DENY_THREAD_ID" --json | jq -r '.[0].id // empty')
  if [ -n "$DENY_INTERACTION_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$DENY_INTERACTION_ID"

bb thread interactions show "$DENY_INTERACTION_ID" "$DENY_THREAD_ID"
bb thread interactions deny "$DENY_INTERACTION_ID" "$DENY_THREAD_ID"
if bb thread wait "$DENY_THREAD_ID" --status idle --timeout 180; then
  bb thread output "$DENY_THREAD_ID"
else
  bb thread show "$DENY_THREAD_ID"
fi
bb thread log "$DENY_THREAD_ID" --format json | jq '.[-12:]'
test ! -e "$DENY_FILE"
```

For `claude-code`, also verify grant semantics with a permission-grant interaction:

```bash
GRANT_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider claude-code \
  --model "$CLAUDE_MODEL" \
  --reasoning-level low \
  --new-environment worktree \
  --permission-mode accept-edits \
  --prompt "Use WebFetch to fetch https://example.com, then reply with exactly GRANTED." \
  --json | jq -r '.id')

GRANT_INTERACTION_ID=
for _ in {1..60}; do
  GRANT_INTERACTION_ID=$(bb thread interactions list "$GRANT_THREAD_ID" --json | jq -r '.[0].id // empty')
  if [ -n "$GRANT_INTERACTION_ID" ]; then
    break
  fi
  sleep 2
done
test -n "$GRANT_INTERACTION_ID"

bb thread interactions show "$GRANT_INTERACTION_ID" "$GRANT_THREAD_ID"
bb thread interactions grant "$GRANT_INTERACTION_ID" "$GRANT_THREAD_ID" --scope turn
bb thread wait "$GRANT_THREAD_ID" --status idle --timeout 180
bb thread output "$GRANT_THREAD_ID"

rm -f "$APPROVAL_FILE" "$DENY_FILE"
rmdir "$APPROVAL_DIR" "$DENY_DIR"
```

Expected result:

- `accept-edits` turns allow workspace changes but surface pending interactions
  for the explicit outside-workspace probes; inspect them with
  `bb thread interactions list/show`.
- `bb thread tell` is rejected while the thread is awaiting user interaction.
- `approve`, `deny`, and `grant` resolve their matching interaction kinds.
- Approved/granted threads continue to `idle`; denied threads either reply with the denial handling text or clearly record the denied approval in the log.

## Recording Results

Record each pass with:

- Date and operator
- Gate name: Real-provider CLI/API E2E
- Standalone state path
- Provider(s) used
- Credential mode: default subscription-backed path, or explicitly opt-in API-key route path
- Thread IDs and environment IDs
- Whether smoke, multi-thread, and recovery passed
- Any unexpected output, missing events, or log findings
- Whether this pass was paired with app QA; if not, state that app UI,
  Electron, and browser behavior were not covered
