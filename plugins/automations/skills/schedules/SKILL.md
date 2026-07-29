---
name: schedules
description: Create and manage recurring or one-time bb schedules for agent and script work. Use the first-party schedules UI and bb automation compatibility command.
---

# Schedules

A schedule is recurring or one-time work. When due, it runs in one of two
modes:

agent Spawn a thread or re-prompt a target thread with a configured prompt.
script Run a stored server-side script and capture stdout/stderr/exit.

Use `bb automation ...`. The command keeps its existing name for compatibility,
even though the product surface calls these objects schedules.

Pass `--project` explicitly for every command. Inside a thread, schedules are
stamped origin `agent` and record the creating thread automatically.
Schedule-spawned threads cannot create schedules.

Choosing a mode:

Use `script` when the output is fully determined by code: watchdogs, threshold
alerts, health checks, heartbeats, and API pollers with a fixed output shape.
Scripts run on the bb server, with cwd inside the plugin data directory's
`scripts/` area. Script schedules do not have an environment field and do not
accept environment flags.

Design the script to print nothing when there is nothing to report. An exit-0
run with empty stdout/stderr, or a last non-empty line of
`{"wakeAgent": false}`, is recorded as a skipped silent tick. Any other output
is captured; non-zero exit or timeout is recorded as a failed run.

Use `agent` when the run needs reasoning: summarize a feed, pick interesting items, draft a human-friendly message, or branch on content.

Creating:

```bash
bb automation create --project <id> --name "..." [schedule flags] [mode flags]
```

Schedule flags:

```text
--cron <expr>                  Recurring 5-field cron expression
--timezone <tz>                IANA timezone for --cron
--at <datetime>                One-shot run time, preferably ISO 8601
--in <duration>                One-shot delay, e.g. 30s, 5m, 2h, 1d
```

Agent mode flags:

```text
--prompt <prompt>              Prompt to run when due
--provider <id>                Provider ID
--model <model>                Model ID
--permission-mode <mode>       accept-edits, auto, or full
--target-thread <id>           Reuse/re-prompt an existing thread
--environment <id-or-path>     Existing environment ID or unmanaged workspace path
--new-environment <kind>       Create a new environment (worktree)
--base-branch <branch>         Base branch for new managed worktrees
```

When `--permission-mode` is omitted, the plugin chooses Approve for me
(`auto`) when the provider supports it and otherwise uses Full Access
(`full`).

Script mode flags:

```text
--script <inline>              Inline script content
--script-file <path>           Read script content from a local file
--interpreter <name>           bash, sh, node, or python3
--timeout <ms>                 Timeout in milliseconds, default 120000, max 900000
--env-json <json>              Script variables as a string-to-string JSON object
```

Script environment variables:

```text
BB_SERVER_URL          The bb server API base URL
BB_PROJECT_ID          The schedule's project
BB_AUTOMATION_ID       The schedule id (compatibility variable)
BB_AUTOMATION_RUN_ID   This run id
```

`BB_ENVIRONMENT_ID` and `BB_HOST_DAEMON_PORT` are intentionally not injected by
the plugin. The plugin resolves `bb` and prepends its directory to `PATH` so
scripts can call the CLI.

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

Choose one of two execution update forms:

- A complete replacement uses `--prompt`, `--provider`, and `--model` together
  to replace the execution with an agent, or `--script`/`--script-file` to
  replace it with a script. Include every desired mode-specific setting;
  settings from the previous execution do not carry over.
- A partial agent update omits `--provider` and `--model`, preserves every
  omitted execution field, and edits the existing agent schedule in place.
  Use any combination of `--prompt` and
  `--permission-mode accept-edits|auto|full`, then choose at most one execution
  target:

```bash
bb automation update <automationId> --project <id> \
  --environment <environment-id-or-path>
bb automation update <automationId> --project <id> \
  --target-thread <thread-id>
bb automation update <automationId> --project <id> \
  --new-environment worktree [--base-branch <branch>]
```

`--target-thread`, `--environment`, and `--new-environment` are mutually
exclusive. These flags apply only to agent schedules; script schedules have no
execution environment.

Every command supports `--json`.
