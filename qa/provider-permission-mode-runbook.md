# Provider Permission Mode QA Runbook

This runbook covers provider-by-permission-mode diagnostics for Codex and
Claude Code. Use it after changes to runtime policy, provider translation,
sandbox construction, managed-worktree Git roots, or execution defaults.

## Scope

Exercise the public permission modes:

- `accept-edits`: workspace sandboxing with user-reviewed escalation
- `auto`: the same workspace sandbox with provider-native automatic review
- `full`: explicit sandbox and approval bypass

Run all three modes for `codex` and `claude-code`. Pi currently supports `full`
only; keep its unsupported-mode coverage in server/runtime tests unless its
advertised capabilities change.

The matrix checks:

- shell and file-read availability
- read-only Git inspection (`status`, `merge-base`, `diff`, and `show`)
- workspace file writes
- linked-worktree Git index writes and cleanup
- commits in a disposable QA repository
- BB CLI reads
- subagent/delegation availability
- escalation behavior for an outside-workspace write

## Prerequisites

Build through Turbo, clear any ambient generic OpenAI API-key route, and start
an isolated server/daemon pair:

```bash
pnpm exec turbo run build
codex --help
claude --help
jq --help
git --version

unset OPENAI_API_KEY
pnpm qa:standalone:cleanup
eval "$(pnpm --silent qa:standalone:start --format env)"
bb() { node apps/cli/dist/index.js "$@"; }

bb status
bb provider list
```

Resolve subscription-backed models from the live provider catalogs:

```bash
CODEX_MODEL=$(bb provider models codex --json | jq -er '([.[] | select(.isDefault)][0].model // .[0].model)')
CLAUDE_MODEL=$(bb provider models claude-code --json | jq -er '([.[] | select(.model == "claude-haiku-4-5")][0].model // [.[] | select(.isDefault)][0].model // .[0].model)')

printf 'codex: %s\nclaude-code: %s\n' "$CODEX_MODEL" "$CLAUDE_MODEL"
```

Use only isolated managed worktrees for mutation probes. The standalone project
is disposable; never run these prompts in a developer's product worktree.

## Expected Semantics

`accept-edits`:

- MUST allow reads, shell commands, and writes inside the assigned workspace.
- MUST allow the minimal linked-worktree Git metadata writes required for
  `git add`, `git reset`, and commits in that workspace.
- MUST keep outside-workspace and network escalation user-reviewed. A
  deterministic outside-workspace command should create a pending interaction.
- MUST NOT silently widen to unrestricted host access.

`auto`:

- MUST provide the same workspace and linked-worktree boundaries as
  `accept-edits`.
- MUST route provider-generated approval decisions through the provider-native
  automatic reviewer instead of pausing for a BB user interaction.
- MAY allow or deny an escalated operation according to that reviewer, but the
  result and review events must be visible in the thread log.

`full`:

- MUST allow shell, reads, workspace writes, Git index writes, commits, BB CLI
  access, and supported delegation without approval prompts.
- Use it only in the disposable standalone environment.

## Common Workspace Probe

Create one prompt per provider/mode by replacing `PROVIDER` and `MODE`:

```text
You are running a BB provider permission-mode probe for PROVIDER MODE.

Rules:
- Work only in the assigned disposable worktree.
- Use only .bb-permission-probe for file/index tests and remove it afterward.
- Report each command, exit status, and whether it matched MODE semantics.
- If a tool is unavailable or an operation is denied, include the exact error.

1. Report the workspace path and the contents of .git if it is a file.
2. Run these read-only checks separately:
   - pwd
   - git status --short
   - git --no-optional-locks status --short
   - git merge-base main HEAD
   - git diff --stat main...HEAD
   - git show --stat --oneline -1 HEAD
3. Read the first 20 lines of AGENTS.md or package.json.
4. Run `bb status` and, when BB_THREAD_ID is present,
   `bb thread show "$BB_THREAD_ID"`.
5. If supported, ask one helper/subagent to report the current directory and
   whether `git status --short` succeeds.
6. Run:
   - printf 'permission probe\n' > .bb-permission-probe
   - git status --short .bb-permission-probe
   - git add .bb-permission-probe
   - git reset -- .bb-permission-probe
   - rm .bb-permission-probe
   - git status --short .bb-permission-probe

Finish with PASS/FAIL by category.
```

## CLI Matrix

Define the six prompts from the template, then spawn fresh managed worktrees:

```bash
CODEX_ACCEPT_EDITS=$(bb thread spawn --project "$BB_PROJECT_ID" --provider codex --model "$CODEX_MODEL" --reasoning-level low --permission-mode accept-edits --new-environment worktree --prompt "$CODEX_ACCEPT_EDITS_PROMPT" --json | jq -r '.id')
CODEX_AUTO=$(bb thread spawn --project "$BB_PROJECT_ID" --provider codex --model "$CODEX_MODEL" --reasoning-level low --permission-mode auto --new-environment worktree --prompt "$CODEX_AUTO_PROMPT" --json | jq -r '.id')
CODEX_FULL=$(bb thread spawn --project "$BB_PROJECT_ID" --provider codex --model "$CODEX_MODEL" --reasoning-level low --permission-mode full --new-environment worktree --prompt "$CODEX_FULL_PROMPT" --json | jq -r '.id')

CLAUDE_ACCEPT_EDITS=$(bb thread spawn --project "$BB_PROJECT_ID" --provider claude-code --model "$CLAUDE_MODEL" --reasoning-level low --permission-mode accept-edits --new-environment worktree --prompt "$CLAUDE_ACCEPT_EDITS_PROMPT" --json | jq -r '.id')
CLAUDE_AUTO=$(bb thread spawn --project "$BB_PROJECT_ID" --provider claude-code --model "$CLAUDE_MODEL" --reasoning-level low --permission-mode auto --new-environment worktree --prompt "$CLAUDE_AUTO_PROMPT" --json | jq -r '.id')
CLAUDE_FULL=$(bb thread spawn --project "$BB_PROJECT_ID" --provider claude-code --model "$CLAUDE_MODEL" --reasoning-level low --permission-mode full --new-environment worktree --prompt "$CLAUDE_FULL_PROMPT" --json | jq -r '.id')
```

Wait and save logs:

```bash
for THREAD_ID in "$CODEX_ACCEPT_EDITS" "$CODEX_AUTO" "$CODEX_FULL" "$CLAUDE_ACCEPT_EDITS" "$CLAUDE_AUTO" "$CLAUDE_FULL"; do
  bb thread wait "$THREAD_ID" --status idle --timeout 480
  bb thread show "$THREAD_ID"
  bb thread output "$THREAD_ID"
  bb thread log "$THREAD_ID" --format verbose > "permission-probe-$THREAD_ID.log.md"
done
```

## Escalation Probe

The operating-system temp directory may already be writable in a provider
sandbox, so create the disposable target under the user home:

```bash
OUTSIDE_DIR=$(mktemp -d "${HOME:?}/.bb-permission-probe.XXXXXX")
OUTSIDE_FILE="$OUTSIDE_DIR/outside.txt"
```

On a fresh `accept-edits` thread, request this exact command and verify a
pending interaction appears before resolving it:

```text
Run this exact shell command once: printf 'outside probe' > 'OUTSIDE_FILE'. If
approval is needed, request it. Report DONE only after the command settles.
```

```bash
bb thread interactions list "$ACCEPT_EDITS_THREAD_ID" --json | jq
bb thread interactions deny "$INTERACTION_ID" "$ACCEPT_EDITS_THREAD_ID"
test ! -e "$OUTSIDE_FILE"
```

Repeat on an `auto` thread. It should not pause for a BB user interaction; its
log must instead show the provider's automatic review and the resulting allow
or deny decision. Do not require a particular reviewer decision.

Cleanup the explicit target after inspecting it:

```bash
rm -f "$OUTSIDE_FILE"
rmdir "$OUTSIDE_DIR"
```

## Optional Commit Probe

Run this only in the disposable standalone repository, once per provider/mode:

```bash
git commit --allow-empty -m "bb permission mode commit probe"
git rev-parse --short HEAD
git reset --hard HEAD~1
git status --short
```

All three public modes should support this inside the assigned worktree. A
failure in `accept-edits` or `auto` usually means the sandbox omitted the linked
worktree Git directory or required common Git metadata roots; do not fix that
by granting the entire project parent directory.

## Checklist

Record PASS, FAIL, BLOCKED, or NOT ATTEMPTED for each cell:

| Provider | Mode | Reads | Git inspect | Workspace write | Git index | Commit | BB CLI | Subagent | Escalation path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex | accept-edits | | | | | | | | user interaction |
| Codex | auto | | | | | | | | automatic review |
| Codex | full | | | | | | | | bypass |
| Claude Code | accept-edits | | | | | | | | user interaction |
| Claude Code | auto | | | | | | | | automatic review |
| Claude Code | full | | | | | | | | bypass |

## Cleanup

For every probe, inspect the worktree before archiving it:

```bash
THREAD_ID=<probe-thread-id>
ENV_ID=$(bb thread show "$THREAD_ID" --json | jq -r '.environmentId')
ENV_PATH=$(bb environment show "$ENV_ID" --json | jq -r '.path')

git -C "$ENV_PATH" status --short
rm -f "$ENV_PATH/.bb-permission-probe"
git -C "$ENV_PATH" reset -- .bb-permission-probe 2>/dev/null || true
git -C "$ENV_PATH" status --short
```

Stop the isolated harness with the cleanup command exported by standalone
setup, or `pnpm qa:standalone:stop --state "$STATE_PATH"`.
