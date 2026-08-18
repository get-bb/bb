---
name: automations
description: Create and manage bb automations from the first-party automations plugin. Use when scheduling recurring or one-shot agent/script work with bb automation commands.
---

# Automations

An automation is a scheduled task. When due it runs in one of two modes:

agent Spawn a thread or re-prompt a target thread with a configured prompt.
script Run a stored server-side script and capture stdout/stderr/exit.

Use `bb plugin run automations ...` while the kernel `bb automation` command still exists; once the kernel command is removed, `bb automation ...` will route to this plugin command.

Pass `--project` explicitly for every automation command. Inside a thread, automations are stamped origin `agent` and record the creating thread automatically. Automation-spawned threads cannot create automations.

Choosing a mode:

Use `script` when the output is fully determined by code: watchdogs, threshold alerts, health checks, heartbeats, and API pollers with a fixed output shape. Scripts run on the bb server, with cwd inside the plugin data directory's `scripts/` area. Script automations do not have an environment field and do not accept environment flags.

Design the script to print nothing when there is nothing to report: an exit-0 run with empty stdout/stderr, or a last non-empty line of `{"wakeAgent": false}`, is recorded as a skipped silent tick. Any other output is captured; non-zero exit or timeout is recorded as a failed run.

Execution safety is fail-closed:

- An automation has at most one running execution. A duplicate scheduled tick or
  manual run reuses the existing run instead of starting another process tree.
- Failed recurring runs retry after exponential delays (30 seconds, then 60
  seconds). The third consecutive failure pauses the automation and clears its
  next run. A successful or skipped run resets the failure count; explicitly
  resuming an automation also resets it.
- Script timeout and output-limit termination applies to the whole spawned
  process group, including descendant processes (on Windows, to the direct
  child).
- A run interrupted by a server restart or plugin reload is settled on
  startup: script runs and agent runs that never got a thread are recorded as
  skipped, and agent runs follow their thread's state. Nothing stays "running"
  without a process behind it.

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
--script-file <path>           Copy script content from a file on a host
--host <name-or-id>            Host that owns --script-file (default: thread host or server)
--interpreter <name>           bash, sh, node, or python3
--timeout <ms>                 Timeout in milliseconds, default 120000, max 900000
--env-json <json>              Script variables as a string-to-string JSON object
```

`--script-file` reads the file through the host file API, relative to your
current directory. Inside a thread it reads from the thread's environment host;
outside a thread it reads from the server host. Pass `--host <name-or-id>` to
read from another machine. The plugin stores a private copy under
`<data dir>/plugins/automations/scripts/<automationId>/`. Runs execute that
copy. The copy is a snapshot: edits to the source file do not apply until you
run `update <automationId> --script-file <path>` again. `create` and `update`
print the exact refresh command with the current interpreter, timeout, env, and
host. `create`, `update`, and `show` print the stored copy path on the
`Script:` line; `--json` returns it as `execution.storedScriptPath`.

Script environment variables:

```text
BB_SERVER_URL          The bb server API base URL
BB_PROJECT_ID          The automation's project
BB_AUTOMATION_ID       The automation id
BB_AUTOMATION_RUN_ID   This run id
BB_CLI                 Absolute path to the bb CLI, when it could be resolved
```

`BB_ENVIRONMENT_ID` and `BB_HOST_DAEMON_PORT` are intentionally not injected by the plugin. The plugin resolves `bb` and prepends its directory to `PATH` so scripts can call the CLI. It looks at `BB_CLI`, then `BB_CLI_DIR`, then `PATH`, then the common macOS install paths.

If `bb` cannot be found, the script still runs. The run output starts with a `[bb] warning:` line, and a script that calls `bb` fails on that line rather than before its first line.

Managing:

```bash
bb plugin run automations list --project <id>
bb plugin run automations show <automationId> --project <id>
bb plugin run automations update <automationId> --project <id> [--name <name>] [schedule flags] [complete execution flags | partial agent update flags]
bb plugin run automations pause <automationId> --project <id>
bb plugin run automations resume <automationId> --project <id>
bb plugin run automations run <automationId> --project <id> [--idempotency-key <key>]
bb plugin run automations runs <automationId> --project <id> [--limit <count>] [--output <runId>]
bb plugin run automations delete <automationId> --project <id> --yes
```

Choose one of two execution update forms:

- A complete replacement uses `--prompt`, `--provider`, and `--model` together
  to replace the execution with an agent, or `--script`/`--script-file` to
  replace it with a script. Include every desired mode-specific setting;
  settings from the previous execution do not carry over.
- A partial agent update omits `--provider` and `--model`, preserves every
  omitted execution field, and edits the existing agent automation in place.
  Use any combination of `--prompt` and
  `--permission-mode accept-edits|auto|full`, then choose at most one execution
  target:

```bash
bb plugin run automations update <automationId> --project <id> \
  --environment <environment-id-or-path>
bb plugin run automations update <automationId> --project <id> \
  --target-thread <thread-id>
bb plugin run automations update <automationId> --project <id> \
  --new-environment worktree [--base-branch <branch>]
```

`--target-thread`, `--environment`, and `--new-environment` are mutually
exclusive. These flags apply only to agent automations; script automations have
no execution environment.

Every command supports `--json`.
