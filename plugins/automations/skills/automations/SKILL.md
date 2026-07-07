---
name: automations
description: Create and manage bb automations from the first-party automations plugin. Use when scheduling recurring or one-shot agent/script work with bb automation commands.
---

# Automations

An automation is a scheduled task. When due it runs in one of two modes:

  agent    Spawn a thread or re-prompt a target thread with a configured prompt.
  script   Run a stored server-side script and capture stdout/stderr/exit.

Use `bb plugin run automations ...` while the kernel `bb automation` command still exists; once the kernel command is removed, `bb automation ...` will route to this plugin command.

Pass `--project` explicitly for every automation command. Inside a thread, automations are stamped origin `agent` and record the creating thread automatically. Automation-spawned threads cannot create automations.

Choosing a mode:

Use `script` when the output is fully determined by code: watchdogs, threshold alerts, health checks, heartbeats, and API pollers with a fixed output shape. Scripts run on the bb server, with cwd inside the plugin data directory's `scripts/` area. Script automations do not have an environment field and do not accept environment flags.

Design the script to print nothing when there is nothing to report: an exit-0 run with empty stdout/stderr, or a last non-empty line of `{"wakeAgent": false}`, is recorded as a skipped silent tick. Any other output is captured; non-zero exit or timeout is recorded as a failed run.

Use `agent` when the run needs reasoning: summarize a feed, pick interesting items, draft a human-friendly message, or branch on content.

Creating:

```bash
bb plugin run automations create --project <id> --name "..." [schedule flags] [mode flags]
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
--permission-mode <mode>       full, workspace-write, or readonly
--target-thread <id>           Reuse/re-prompt an existing thread
--environment <id-or-path>     Existing environment ID or unmanaged workspace path
--new-environment <kind>       Create a new environment (worktree)
--base-branch <branch>         Base branch for new managed worktrees
```

Script mode flags:

```text
--script <inline>              Inline script content
--script-file <path>           Read script content from a local file
--interpreter <name>           bash, sh, node, or python3
--timeout <ms>                 Timeout in milliseconds, default 120000, max 900000
```

Script environment variables:

```text
BB_SERVER_URL          The bb server API base URL
BB_PROJECT_ID          The automation's project
BB_AUTOMATION_ID       The automation id
BB_AUTOMATION_RUN_ID   This run id
```

`BB_ENVIRONMENT_ID` and `BB_HOST_DAEMON_PORT` are intentionally not injected by the plugin. The plugin resolves `bb` and prepends its directory to `PATH` so scripts can call the CLI.

Managing:

```bash
bb plugin run automations list --project <id>
bb plugin run automations show <automationId> --project <id>
bb plugin run automations update <automationId> --project <id> [--name <name>] [schedule flags]
bb plugin run automations pause <automationId> --project <id>
bb plugin run automations resume <automationId> --project <id>
bb plugin run automations run <automationId> --project <id> [--idempotency-key <key>]
bb plugin run automations runs <automationId> --project <id> [--limit <count>] [--output <runId>]
bb plugin run automations delete <automationId> --project <id> --yes
```

Every command supports `--json`.
