---
name: bb-cli
description: Use this when controlling bb. The bb CLI lets you inspect, create, and orchestrate bb threads, automations, projects, providers, and environments.
---

# bb CLI

Use `bb` when controlling bb itself: inspect current context, coordinate threads,
message agents, or inspect projects, providers, and environments.

## Start With Context

- Use `bb status` to identify the current project, thread, and environment.
- Prefer `--json` when command output will drive follow-up work.
- Run `bb guide` for the system overview and `bb guide <chapter>` for full
  command reference.

## Spawning Threads

- Use `bb thread spawn --project <project-id> --prompt "..."` to create another
  thread. Inside a thread, pass the current project explicitly with
  `--project "$BB_PROJECT_ID"` when appropriate.
- Spawn creates a root thread unless you pass `--parent-thread`.
- Spawned child threads inherit permission from explicit flags, then the
  parent thread's last execution, then project defaults.
- Use `--parent-self` inside a thread to parent the new thread to the current
  thread.
- Use `--parent-thread <thread-id>` to choose another specific parent.
- If provider or model choice matters, inspect options with `bb provider list`
  and `bb provider models <provider-id>`.

Give spawned threads clear prompts: objective, constraints, expected deliverable,
validation to perform, and what to report back. Ask for outcome, changed files
or artifacts, validation performed, and blockers.

## Coordinating Work

- Use one clear owner per task.
- Spawn independent tasks separately when parallel work is useful.
- Let threads work after spawning. Do not poll with shell sleeps, repeated log
  reads, or repeated status reads.
- Use `bb thread wait <thread-id>` when you explicitly need to block until a
  thread finishes. It defaults to waiting for `idle`; pass `--status` or
  `--event` for a different target.
- Use `bb thread tell <thread-id> "..."` when requirements change, a blocker
  needs clarification, or follow-up work is needed.

## Inspecting Results

- Use `bb thread show <thread-id>` for status, parent, environment, and result.
- Use `bb thread show <thread-id> --git-diff` to review file changes.
- Use `bb thread log <thread-id>` to inspect the conversation.
- Use `bb thread output <thread-id>` to read the latest final output. Inside a
  thread, omitting `<thread-id>` reads `BB_THREAD_ID`.

For review or fix pipelines, get the environment ID from
`bb thread show <thread-id> --json`, then spawn the follow-up with
`--environment <environment-id>` so it sees the same files.

## Showing Files In The IDE

- When the user asks you to open, show, or pull up a file, use
  `bb thread open <file>` so it opens in their IDE side panel (defaults to
  `BB_THREAD_ID`; pass an explicit `<thread-id>` or `--self` to target a thread).
- The path is workspace-relative by default; pass `--source thread-storage` for a
  thread-storage file and `--line <n>` to jump to a line.
- It opens for any connected client viewing the thread now, or when the user next
  switches to that thread. `delivered: 0` means no bb app is connected.

## Failures And Interruptions

- For failed threads, inspect `bb thread show <id> --json` and
  `bb thread log <id>` before deciding whether to retry, clarify, or update the
  user.
- For interrupted or stopped threads, inspect first. If the user stopped the
  thread, treat that as intentional unless they ask you to continue.
- Use `bb thread stop <id>` when a thread is stuck or no longer needed.

## Automations

- Use `bb automation ...` to manage scheduled tasks. When due, an automation
  runs in one of two modes: `agent` (spawns a thread running a prompt — uses
  tokens) or `script` (runs a stored command and captures stdout/exit — no
  agent, no tokens).
- Choosing a mode: pick `script` when the output is fully determined by code
  (watchdogs, threshold alerts, health checks, pollers with a fixed output) —
  write the check so it prints nothing when there's nothing to report, so quiet
  ticks stay silent. Pick `agent` when the run needs reasoning (summarize,
  triage, draft for a human, branch on content).
- For a "watch X and alert me when Y" request, prefer a script automation:
  author the check script (inline `--script` or a file via `--script-file`) so
  its stdout IS the alert, then create it — no model spend per tick.
- Automations cannot create automations (runs are origin-gated); never schedule
  one whose job is to make more. Host-script automations may be disabled by
  server policy — fall back to an `agent` automation if script creation is
  rejected.
- Create an agent automation with
  `bb automation create --name "..." --cron "0 9 * * 1-5" --timezone "America/New_York" --provider <id> --model <model> --prompt "..."`.
- Create a script automation with
  `bb automation create --name "..." --cron "..." --timezone "..." --script-file ./watch.sh`
  (or `--script "<inline>"`). A script that exits 0 with empty stdout, or whose
  last non-empty line is `{"wakeAgent": false}`, stays silent.
- Script automations run with the bb environment injected — `BB_SERVER_URL`,
  `BB_HOST_DAEMON_PORT`, `BB_PROJECT_ID`, `BB_ENVIRONMENT_ID`, `BB_AUTOMATION_ID`,
  `BB_AUTOMATION_RUN_ID` — and inherit the daemon's PATH, so `bb ...` and
  `node ...` work with no manual exports.
- A script run's status IS its exit code: exit 0 = succeeded; a non-zero exit is
  recorded as failed even if the script already produced a visible side effect
  (e.g. posted a message via `bb thread tell`). Make scripts exit 0 on success
  and check the exit status of each `bb` call. Captured stdout+stderr is stored
  on failed runs (see `--output <run-id>`).
- Cron accepts standard 5-field expressions, including step values like
  `*/5 * * * *` (minimum granularity is 5 minutes).
- The project defaults to `BB_PROJECT_ID`, then the personal project, so
  `--project` is never required.
- Use `bb automation list`, `bb automation show <id>`, and
  `bb automation runs <id>` to inspect; `--output <run-id>` prints a script
  run's captured stdout.
- Use `bb automation pause <id>` / `bb automation resume <id>` to toggle,
  `bb automation run <id>` to trigger now, and `bb automation delete <id> --yes`
  to remove.
- Run `bb guide automations` for the full command reference.
