---
name: automations
description: Create and manage bb automations from the first-party automations plugin. Use when scheduling recurring or one-shot agent/script work with bb automation commands.
---

# Automations

An automation is a scheduled task. When due it runs in one of two modes:

agent Spawn a thread or re-prompt a target thread with a configured prompt.
script Run a stored server-side script and capture stdout/stderr/exit.

Use the top-level `bb automation` command. The CLI routes it to this plugin.

Pass `--project` explicitly for every automation command. Inside a thread, automations are stamped origin `agent` and record the creating thread automatically. Automation-spawned threads cannot create automations.

Choosing a mode:

Use `script` when the output is fully determined by code: watchdogs, threshold alerts, health checks, heartbeats, and API pollers with a fixed output shape. Scripts run on the bb server, with cwd inside the plugin data directory's `scripts/` area. Script automations do not have an environment field and do not accept environment flags.

Design the script to print nothing when there is nothing to report: an exit-0 run with empty stdout/stderr, or a last non-empty line of `{"wakeAgent": false}`, is recorded as a skipped silent tick. Any other output is captured; non-zero exit or timeout is recorded as a failed run.

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
--reasoning <level>            none, low, medium, high, xhigh, ultracode, max, or ultra
--service-tier <tier>          default or fast (update also accepts none to clear)
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

`list` and `show` are diagnostic reads: a damaged record remains visible as
`Prompt required` or `Invalid data` instead of failing the whole read. A
`Prompt required` record opens in the Automations panel's standard editor,
where the user can add its prompt while reviewing the other settings. It can
also be repaired directly:

```bash
bb automation update <automationId> --project <id> --prompt "<prompt>"
```

Writes remain strict. Run, pause, and resume reject damaged records; update
succeeds only when the resulting complete record is canonical. Every successful
create/update persists the canonical format.

Choose one of two execution update forms:

- A complete replacement uses `--prompt`, `--provider`, and `--model` together
  to replace the execution with an agent, or `--script`/`--script-file` to
  replace it with a script. Add `--reasoning` and `--service-tier` when needed.
  Include every desired mode-specific setting;
  settings from the previous execution do not carry over.
- A partial agent update preserves every omitted execution field and edits the
  existing agent automation in place. Use any combination of `--prompt`,
  `--provider`, `--model`, `--reasoning`, `--service-tier`, and
  `--permission-mode accept-edits|auto|full`, then choose at most one execution
  target. When changing providers, pass the provider's coherent model,
  reasoning, tier, and permission selection together:

```bash
bb automation update <automationId> --project <id> \
  --environment <environment-id-or-path>
bb automation update <automationId> --project <id> \
  --target-thread <thread-id>
bb automation update <automationId> --project <id> \
  --new-environment worktree [--base-branch <branch>]
```

`--target-thread`, `--environment`, and `--new-environment` are mutually
exclusive. These flags apply only to agent automations; script automations have
no execution environment.

Every command supports `--json`. For `list` and `show`, the JSON result is a
union discriminated by `problem`: canonical records omit it, while degraded
records use `"missing-agent-prompt"` or `"invalid-stored-data"`. The
missing-prompt variant retains the full readable automation; the invalid-data
variant contains only `id`, `projectId`, `name`, and `problem`.
