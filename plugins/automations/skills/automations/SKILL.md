---
name: automations
description: "Schedule or manage recurring and one-shot BB agent or script automations."
---

# Automations

An automation is a scheduled task. When due it runs in one of two modes:

agent Spawn a thread or re-prompt a target thread with a configured prompt.
script Run a stored server-side script and capture stdout/stderr/exit.

Use the top-level `bb automation` command. The CLI routes it to this plugin.

Pass `--project` explicitly for every automation command. Inside a thread, automations are stamped origin `agent` and record the creating thread automatically. Automation-spawned threads cannot create automations.

Personal supports automations with `--project proj_personal`. Use `bb project list --include-personal --json` to include it in discovery; an empty default project list does not mean Personal is unavailable.

Choosing a mode:

Use `script` when the output is fully determined by code: watchdogs, threshold alerts, health checks, heartbeats, and API pollers with a fixed output shape. Scripts run on the bb server. New standard-project scripts use the server-host project source when one exists; Personal and projects without one run in the plugin's shared script storage directory. Existing scripts without a saved policy also run there. Use `--working-directory automation-storage|project|<absolute-server-path>` to select the policy. Script automations do not have an environment field and do not accept environment flags.

Design the script to print nothing when there is nothing to report: an exit-0 run with empty stdout/stderr, or a last non-empty line of `{"wakeAgent": false}`, is recorded as a skipped silent tick. Any other output is captured; non-zero exit or timeout is recorded as a failed run.

Use `agent` when the run needs reasoning: summarize a feed, pick interesting items, draft a human-friendly message, or branch on content.

Creating:

```bash
bb automation create --project <id> --name "..." [--idempotency-key <key>] [schedule flags] [mode flags]
```

For creation flags and mode-specific defaults, read
[references/creation.md](references/creation.md).

Read `references/script-runtime.md` before you use a script file, depend on
injected variables, or diagnose retries, timeouts, restarts, and silent runs.

Managing:

```bash
bb automation list --project <id>
bb automation show <automationId> --project <id>
bb automation update <automationId> --project <id> [--name <name>] [schedule flags] [complete execution flags | partial agent update flags]
bb automation pause <automationId> --project <id>
bb automation resume <automationId> --project <id>
bb automation run <automationId> --project <id> [--idempotency-key <key>]
bb automation runs <automationId> --project <id> [--limit <count>] [--output <runId>]
bb automation delete <automationId> --project <id> --yes
```

For partial updates, mode replacement, execution targets, or damaged records,
read [references/updates.md](references/updates.md). Every command supports `--json`.

`bb automation <command> --help` prints that command's exact arguments, options,
accepted values, and rules. Unknown commands, unknown options, and stray
arguments are rejected rather than ignored, and a failure under `--json` also
prints a `{"ok":false,"error":{"code","message","hint"}}` envelope on stdout.

The `automations_create` RPC accepts an optional `idempotencyKey`. Within a project, retries with the same key return the existing automation without changing it, including after restart. Different projects have separate keys. Use a fresh key for a new job; omit it for the existing always-create behavior. Setup uses this path so repeating an opt-in request never creates a second schedule.

## Local job results

Weeknight jobs offered in setup run with network access disabled. They leave
local commits and use the normal thread completion notification. Arm selection
and opt-in are available through `bb setup-job show|accept|dismiss`.

Read a completed result with `bb automation result <threadId> --json`. Review
its repository, branch, commit and diff before publishing. The result thread's
**Review result** control opens the same review and offers **Push and open draft
PR**, **Keep local**, and **Stop this job**.

Explicit CLI publication uses `bb automation publish <threadId> --snapshot
'<snapshot JSON from result>' --title '<title>' --body '<description>' --yes`.
This pushes only the reviewed commit and opens a draft PR outside the job's
restricted session. A dirty worktree, changed snapshot or active job rejects
publication. The SDK equivalents call this plugin's `automation_result` and
`automation_publish` RPCs through `sdk.plugins.callRpc` with those same inputs.
