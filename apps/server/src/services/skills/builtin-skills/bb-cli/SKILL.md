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

## Environment Setup Script

- To make a repo work with bb worktrees, run `bb guide environments`. It
  documents the repo-level `.bb-env-setup.sh` setup hook.

## Workspace Agent Instructions

- Add a `.bb/AGENTS.md` file at a workspace root to inject repo-specific
  instructions into every thread that runs there. bb appends the file contents
  to the thread system prompt for all providers, on start and resume; edits
  apply on the next turn.
- Only the plural `AGENTS.md` is read, only from the workspace-root `.bb/`
  directory (no parent-directory walk); an empty file is ignored. Track it with
  git so fresh managed worktrees include it. Run `bb guide agent-configuration`
  for details (it also covers project `.bb/skills/`).

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

## Finding Threads From Workspace Paths

- Use `bb thread open <path>` to find the BB thread whose workspace contains a
  path and print its thread URL.
- The path is resolved relative to the current working directory unless it is
  already absolute.
- BB chooses the non-archived thread whose workspace path is the longest prefix
  of the resolved path.

## Long-Running Commands

- Use `bb thread terminal ...` for long-running commands the user may need to
  inspect or stop later: dev servers, watch tasks, REPLs, database consoles, and
  similar processes.
- Prefer a thread terminal over a one-off foreground command for dev servers.
  The terminal is a real PTY scoped to the thread's environment and appears in
  the bb UI as a terminal tab.
- Start a server with
  `bb thread terminal start "$BB_THREAD_ID" --title "pnpm dev" --command "pnpm dev"`.
- Use `bb thread terminal wait <terminal-id> "$BB_THREAD_ID" --contains "Local:" --timeout 120`
  to wait for readiness from new output. Pass `--from-start` only when matching
  existing scrollback is intentional.
- Use `bb thread terminal output <terminal-id> "$BB_THREAD_ID" --json` to read
  bounded output, then continue with `--since-seq <nextSeq>` when polling.
- Use `bb thread terminal send <terminal-id> "$BB_THREAD_ID" --text "..." --enter`
  for interactive input, and `bb thread terminal stop <terminal-id> "$BB_THREAD_ID"`
  when the process is no longer needed.

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

## Theming

- `bb theme` controls the **app-wide color palette** — a set of CSS-variable
  overrides persisted server-side and applied live to every open window. This is
  the *palette* only; light/dark *mode* is a separate per-client setting that the
  palette layers on top of.
- Commands:
  - `bb theme list` — built-in themes and which palette is active.
  - `bb theme set <id>` — switch to a built-in: `default`, `nord`, `dracula`,
    `solarized`, `gruvbox`, `catppuccin`.
  - `bb theme set-custom --file <path.css>` — load a custom stylesheet and
    activate it. This is the only way to set custom CSS (Settings only switches
    between built-ins).
  - `bb theme show [--css]` — print the active palette; `--css` dumps the custom CSS.
  - `bb theme reset` — back to `default`, clearing the custom stylesheet.

### Authoring a theme

To write a built-in theme or a custom stylesheet, **read `references/theming.md`
(in this skill's directory) first.** It is the full design-token reference — what
every CSS variable drives, which tokens to set vs. which auto-derive — plus the
two-block light/dark structure, how to set colors and fonts, and a worked example.

The short version: a custom theme is a plain CSS file that overrides CSS custom
properties. Set the two anchors `--canvas`/`--ink` (most of the UI derives from
them by mixing ink into canvas), the `--primary` accent, the secondary text tiers
(`--muted-foreground` etc.), and the semantic colors (`--destructive`,
`--success`, …). Ship one file with a `:root, .light` block and a `.dark` block,
then load it with `bb theme set-custom --file <path.css>`.
