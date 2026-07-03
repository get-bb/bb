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
- A standalone `bb` CLI with no connection env targets the default local server
  at `http://127.0.0.1:38886` and host daemon port `38887`. Set
  `BB_SERVER_URL` and `BB_HOST_DAEMON_PORT` only for remote or non-default
  targets.

## Environment Setup Script

- To make a repo work with bb worktrees, run `bb guide environments`. It
  documents the repo-level `.bb-env-setup.sh` setup hook.

## Remote Client

- `bb-app client ssh-target set <server-origin> <ssh-target>` configures the
  local helper to open files from a remote bb server in local editors. The SSH
  target is the value that works after `ssh`, such as `devbox` or
  `user@devbox`.
- These mappings live on the client machine in `<dataDir>/client.json`;
  the CLI resolves the server's host ID when writing the mapping, and the remote
  server does not read the file.
- Use `bb-app client ssh-target list --json` to inspect mappings.

## Agent Instructions

- Add `AGENTS.md` to the bb data dir (usually `~/.bb/AGENTS.md`) to inject
  user-level default instructions for every provider-backed thread across all
  projects.
- Add `.bb/AGENTS.md` at a workspace root to inject repo-specific instructions
  into every thread that runs there. Track the workspace file with git so fresh
  managed worktrees include it.
- bb appends data-dir instructions first, then workspace instructions, to the
  thread system prompt for all providers when a provider session starts.
- Only the plural `AGENTS.md` is read, only from those exact locations (no
  parent-directory walk); an empty file is ignored. Run
  `bb guide agent-configuration` for details (it also covers project
  `.bb/skills/`).

## Spawning Threads

- Use `bb thread spawn --project <project-id> --prompt "..."` to create another
  thread. Pass the intended project explicitly; the CLI does not infer it from
  context variables.
- Spawn creates a root thread unless you pass `--parent-thread`.
- Spawned child threads inherit permission from explicit flags, then the
  parent thread's last execution, then project defaults.
- When spawning a subagent, pass `--permission-mode full` unless the user or
  task explicitly requests restricted access.
- Use `--parent-self` inside a thread to parent the new thread to the current
  thread.
- Use `--parent-thread <thread-id>` to choose another specific parent.
- If provider or model choice matters, inspect options with `bb provider list`
  and `bb provider models <provider-id>`.
- Known ACP agents can appear automatically when their CLI is installed on the
  host; for example `opencode` on PATH appears as provider `acp-opencode`.
- Custom ACP agents can be registered in the app data-dir `config.json` under
  `customAcpAgents`. The user supplies a slug `id`; bb exposes it as provider
  id `acp-<id>`. Custom config wins if it uses the same provider id as a known
  ACP agent, so overriding `acp-opencode` uses `"id": "opencode"`. This list
  has no set/unset CLI surface, so edit the JSON and run `bb-app config refresh`
  or restart bb. The configured command is local code execution and only works
  with a co-located daemon.

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

- Use `bb thread show <thread-id>` for status, parent, environment, pull request
  status, and result.
- Use `bb thread show <thread-id> --git-diff` to review file changes.
- Use `bb thread log <thread-id>` to inspect the conversation.
- Use `bb thread output <thread-id>` to read the latest final output, or
  `bb thread output --self` for the current thread.

For review or fix pipelines, get the environment ID from
`bb thread show <thread-id> --json`, then spawn the follow-up with
`--environment <environment-id>` so it sees the same files.

## Opening Files In The Thread Panel

- Use `bb thread open <path>` inside a BB thread to open a Markdown, HTML, or
  other workspace file for the user in the BB IDE's thread panel.
- Outside a BB thread, use `bb thread open <thread-id> <path>`.
- Paths can be thread-relative workspace paths, or absolute paths inside the
  target thread workspace.
- Absolute paths under `BB_THREAD_STORAGE` open as thread-storage files for the
  current thread.

## Long-Running Commands

- Use `bb thread terminal ...` for long-running commands the user may need to
  inspect or stop later: dev servers, watch tasks, REPLs, database consoles, and
  similar processes.
- Prefer a thread terminal over a one-off foreground command for dev servers.
  The terminal is a real PTY scoped to the thread's environment and appears in
  the bb UI as a terminal tab.
- Start a server with
  `bb thread terminal start <thread-id> --title "pnpm dev" --command "pnpm dev"`.
- Use `bb thread terminal wait <terminal-id> <thread-id> --contains "Local:" --timeout 120`
  to wait for readiness from new output. Pass `--from-start` only when matching
  existing scrollback is intentional.
- Use `bb thread terminal output <terminal-id> <thread-id> --json` to read
  bounded output, then continue with `--since-seq <nextSeq>` when polling.
- Use `bb thread terminal send <terminal-id> <thread-id> --text "..." --enter`
  for interactive input, and `bb thread terminal stop <terminal-id> <thread-id>`
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
  `bb automation create --project <id> --name "..." --cron "0 9 * * 1-5" --timezone "America/New_York" --provider <id> --model <model> --prompt "..."`.
- Create a one-shot agent automation with
  `bb automation create --project <id> --name "..." --in "30m" --provider <id> --model <model> --prompt "..."`,
  or use `--at "2026-07-03T09:00:00-07:00"` for an absolute run time.
- Create a script automation with
  `bb automation create --project <id> --name "..." --cron "..." --timezone "..." --script-file ./watch.sh`
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
  `* * * * *`, `*/2 * * * *`, and `*/5 * * * *`. Cron granularity is one
  minute. One-shot automations use `--at` or `--in` and fire once.
- Pass `--project <id>` explicitly for every automation command.
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
  the _palette_ only; light/dark _mode_ is a separate per-client setting that the
  palette layers on top of.
- **Custom themes live on disk** under the app data dir, one folder per theme:
  `<bb-data-dir>/theme/<name>/theme.css` (the packaged app uses `~/.bb/theme/…`).
  The folder name _is_ the theme id. This mirrors how user skills live under
  `<bb-data-dir>/skills/<name>/`.
- Commands:
  - `bb theme list` — built-in and custom themes and which palette is active.
  - `bb theme dir` — print the absolute custom-theme directory (where to create
    `<name>/theme.css`). Use this instead of guessing the path.
  - `bb theme set <id>` — activate a built-in (`default`, `nord`, `dracula`,
    `solarized`, `gruvbox`, `catppuccin`) or a custom theme by its folder name.
  - `bb theme show [--css]` — print the active palette; `--css` dumps the active
    theme's CSS.
  - `bb theme reset` — back to `default`.

### Creating or editing a custom theme

This is the BB habit: custom app-theme work belongs in
`<bb-data-dir>/theme/<name>/theme.css` — never a stray `.css` file elsewhere.

1. Find the directory: `bb theme dir` (e.g. `~/.bb/theme`).
2. Write the stylesheet to `<that-dir>/<name>/theme.css` (create the folder). Use
   a short, lowercase, hyphenated `<name>` (it must not collide with a built-in
   id). To edit an existing theme, change its `theme.css` in place.
3. Activate it: `bb theme set <name>`. Changes apply live to every open window.

To author the stylesheet, **read `references/theming.md` (in this skill's
directory) first.** It is the full design-token reference — what every CSS
variable drives, which tokens to set vs. which auto-derive — plus the two-block
light/dark structure, how to set colors and fonts, and a worked example.

The short version: a custom theme is a plain CSS file that overrides CSS custom
properties. Set the two anchors `--canvas`/`--ink` (most of the UI derives from
them by mixing ink into canvas), the `--primary` accent, the secondary text tiers
(`--muted-foreground` etc.), and the semantic colors (`--destructive`,
`--success`, …). Ship one file with a `:root, .light` block and a `.dark` block.

## Plugins

- A bb plugin is a TypeScript package running inside the bb server, extending
  it with services, schedules, HTTP/RPC endpoints, settings — and `bb` CLI
  subcommands that agents run through bash like any other command.
- **Enable it first.** Plugins are an experiment, off by default: turn on
  **"Plugins"** under Settings → Experiments. Until then, `bb plugin` commands
  report that plugins are disabled.
- Commands:
  - `bb plugin install <src>` — local path, `git:<url>@<ref>`, or
    `npm:<name>@<version>` (npm on PATH required for `npm:`). Installs prompt
    for confirmation (plugins are full-trust code); pass `--yes` to skip.
    Plugins that declare a frontend (`bb.app`) are built at install time for
    path/git sources; npm packages must publish a prebuilt `dist/`.
  - `bb plugin list` — status, background services, schedules, handler timings,
    and each plugin's contributed `bb` command.
  - `bb plugin enable|disable <id>`, `bb plugin reload [id]`,
    `bb plugin remove <id>`.
  - `bb plugin config <id> [set <key> <value> | unset <key>]` — declared
    settings. Reload the plugin after configuring (`bb plugin reload <id>`).
  - `bb plugin logs <id> [-n N] [-f]` — the plugin's `bb.log` output.
  - `bb plugin run <id> [args...]` — explicit form of a plugin's CLI command.
  - `bb plugin new <name> [--app]` — scaffold a plugin (`--app` adds a frontend
    entry plus a typecheck-only `tsconfig.json`); `bb plugin build [path]` —
    compile the plugin into `dist/`: the backend bundle (`server.js` +
    `server.meta.json`; preferred by git/npm installs over source) and, when
    `bb.app` is declared, `app.js` + `app.css` + `app.meta.json`. Neither
    needs the server.
  - `bb plugin dev [path]` — watch loop for an installed plugin (default:
    cwd): on every change it rebuilds the frontend bundle (when `bb.app` is
    declared) and reloads the plugin; open app pages pick the new UI up live.
    Build/reload failures print and keep watching; Ctrl+C stops.
  - Frontend entries default-export `definePluginApp` from
    `@bb/plugin-sdk/app` and register UI slots (homepageSection, navPanel,
    threadPanelTab, composerAccessory) with hooks (useRpc, useRealtime,
    useSettings, useBbContext, useBbNavigate) and a small UI kit. Installed
    plugins and their settings also appear under Settings → Plugins.
- Plugins can add top-level `bb` subcommands (e.g. `bb linear issues`). Run
  them directly — unknown `bb` commands are resolved against installed plugins
  and proxied to the server. Core command names always win. In agent threads,
  the injected `plugin-commands` skill lists what is available.
- **Writing a plugin?** Use the `bb-plugin-authoring` skill — the complete
  authoring reference for the backend `BbPluginApi` (settings, storage, sdk,
  http/rpc/realtime, background services and schedules, CLI commands, agent
  tools and context, host-rendered UI, lifecycle) and the frontend
  `@bb/plugin-sdk/app` contract (slots, hooks, UI kit), with working patterns
  and gotchas. `bb guide plugins` has the short walkthrough.

## Modifying the App UI

`bb ui` lets you reshape the bb frontend itself — not just colors, but layout,
copy, components, and behavior. It works from **any chat**: `bb ui fork` to start,
edit the source on disk, then `bb ui apply` to rebuild and live-reload every
window.

- **Enable it first.** UI forking is an experiment, off by default. Turn on
  **"UI forking"** under Settings → Experiments. Until then, `bb ui` commands are
  disabled and the shipped UI is always served (`bb ui status` says so).
- **`bb ui fork` creates your editable copy** of the frontend at `<bb-data-dir>/ui`
  (the packaged app uses `~/.bb/ui`) and switches to it. It is a self-contained
  Vite + React + Tailwind workspace — `src/`, `index.html`, `public/`,
  `package.json`. The first `fork` seeds it (installs + builds — slower, a minute
  or so); after that, edits are fast.
- **Add dependencies freely:** add a package to `package.json`, and `bb ui apply`
  runs `pnpm install` and rebuilds.
- **`bb ui prod` is the known-good fallback.** It switches back to the shipped UI
  instantly; your fork stays on disk. This is the escape hatch if an edit breaks
  the app — it works even when the UI is broken, because it runs server-side.
- **Builds are gated.** A build that fails to compile is never served: the live
  UI stays on the last good build and `bb ui apply` returns the build errors so
  you can fix and retry.
- **Type feedback.** `bb ui fork`/`apply` also run a scoped `tsc --noEmit` over
  your source (tests excluded) and print any type errors. It is advisory — the
  build still serves (Vite strips types) — but it catches type mistakes the build
  won't, so fix them.
- **Where it takes effect:** `bb ui` swaps what the **server** serves, so it
  applies to the packaged app and any production server build. Under `pnpm dev`
  the frontend is served by Vite, so `bb ui apply` still builds but the running
  dev page keeps coming from Vite (use Vite's own HMR there).

Workflow for a UI change:

1. `bb ui fork` — create your editable copy and switch to it (first run seeds it).
   `fork` and `status` print the **fork dir** (its absolute path) — that is where
   you edit.
2. Edit files under that fork dir (`<bb-data-dir>/ui`, e.g. `~/.bb/ui` in the
   packaged app): change `src/` for the UI and `package.json` to add deps. This
   is the real frontend source.
3. `bb ui apply` — rebuild and live-reload every window. On a build error, read
   the printed log, fix the source, and run it again.
4. `bb ui prod` to switch back to the shipped UI, or `bb ui fork --reset` to throw
   your edits away and start fresh.

Commands:

- `bb ui status` — which UI is active (`prod` / `fork`) and the last build state.
- `bb ui fork [--reset]` — create your fork and switch to it (first run seeds;
  `--reset` discards edits and re-seeds).
- `bb ui apply` — rebuild your fork after editing and reload connected clients.
- `bb ui prod` — switch back to the shipped UI (your fork stays on disk).
- `bb ui update` — rebase your fork onto a newer shipped UI after a bb update. A
  clean rebase rebuilds and serves automatically. On conflict it falls back to
  the shipped UI and reports the files to fix; resolve them and run
  `bb ui update --continue` (or `bb ui update --abort`).

Add `--json` to any `bb ui` command for machine-readable output.
