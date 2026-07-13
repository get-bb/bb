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

## App Settings

- Settings → General holds server-backed app-wide preferences, such as the
  macOS-only "Caffeinate" toggle. For details, read
  `references/app-settings.md` (in this skill's directory).
- Settings → Keyboard records server-backed per-command shortcut overrides.
  Reset returns to bb's current default; Clear disables the command. Non-native
  actions apply in browser and desktop clients, and desktop menu accelerators
  use the same resolved bindings. For details, read
  `references/app-settings.md`.
- Use `bb settings show`, `bb settings general`, `bb settings experiment`,
  `bb settings keyboard`, `bb settings usage`, and `bb settings version` to
  inspect or change these server-backed values from agents.

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
- Add repeatable `--file <path>` / `--image <path>` flags for structured prompt
  attachments, and `--folder <id>` to file the new thread immediately.
- Spawn creates a root thread unless you pass `--parent-thread`.
- `bb connect --code <code> --server https://<handle>.getbb.app` pairs this bb
  server for browser access at `<handle>.getbb.app` (get the code from
  https://getbb.app). It requires the "bb connect" experiment; when off the
  builtin connect plugin is not loaded. Pairing returns immediately — the
  server itself holds the tunnel and reconnects on restart, so there is no
  foreground process.
  `bb connect status` / `bb connect off` report and clear the pairing.
  Port sharing: `bb connect expose <port>` publishes a local HTTP port at
  `https://<handle>--<port>.getbb.app` (owner-session-gated, not public);
  `bb connect unexpose <port>` stops sharing; `bb connect shares` lists active
  URLs. `bb connect servers` lists every bb on the paired account (handle,
  name, url, live) so callers can discover siblings; `--json` includes
  `selfHandle` for deduping this server. When you start a local server the user should open
  remotely, expose the port and give them the share URL. Remote access is owned
  by the builtin `connect` plugin: `bb plugin disable connect` cuts it off
  entirely; with bb connect still enabled, `bb plugin enable connect` restores
  the command. Settings → Connect shows the current URL, QR code, shared ports,
  re-pair form, and disconnect control.
- Add remote execution machines from Settings → Machines. Its one-line
  installer stores the bb connect machine credential locally and configures
  both the daemon protocol and agent-launched `bb` CLI to traverse the account
  gate; revoke a lost machine from the getbb.app dashboard. The installer uses
  the server's exact `/install/bb-app.tgz` artifact (npm only on a 404) and
  enables daemon `--auto-update`; newer protocol mismatches update from that
  artifact, rate-limited to once per 15 minutes, then let launchd/systemd
  restart the daemon. Auto-update never downgrades. Remove `--auto-update` from
  the service definition and reload it to opt out.
- Run `bb machine list` to see machine names, IDs, connection status, and last
  seen time (`--json` returns the raw host list). Use `--machine <id-or-name>`
  (alias `--host`) on `bb thread spawn` to run in a personal or unmanaged
  workspace, or combine it with `--new-environment worktree`. Do not combine a
  machine selector with an existing environment ID, which already owns its
  machine.
- `bb machine show`, `join-code`, `rename`, and `remove` cover the Settings →
  Machines lifecycle. Use `bb machine provider-cli status|install` to inspect
  or install provider CLIs on a selected machine.
- Use `bb project source add <project-id> --machine <id-or-name> --path <path>`
  to register a path on another machine. Use `--clone` instead of `--path` to
  clone the project's remote there; `--remote-url` and `--target-path` are
  optional clone overrides.
- `bb project history|reorder` exposes project prompt recall and sidebar order.
- `bb environment pull-request ready|draft|merge` manages pull-request state;
  `bb environment archive-threads` bulk-archives an environment's threads.
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
  host; for example `opencode`, `omp`, Grok Build's `grok` CLI, or Hermes'
  `hermes` CLI on PATH appears as provider `acp-opencode`, `acp-omp`,
  `acp-grok`, or `acp-hermes-agent`.
- Custom ACP agents can be registered in the app data-dir `config.json` under
  `customAcpAgents`. The user supplies a slug `id`; bb exposes it as provider
  id `acp-<id>`. Custom config wins if it uses the same provider id as a known
  ACP agent, so overriding `acp-opencode` uses `"id": "opencode"`. This list
  has no set/unset CLI surface, so edit the JSON and run `bb-app config refresh`
  or restart bb. The configured command is local code execution and only works
  with a co-located daemon. Optional `logo` accepts an SVG, PNG, or WebP path;
  relative paths resolve from the bb data dir. Custom ACP agents can use
  `modelCli` for CLI model listing/selection, `reasoningCli` for launch-time
  reasoning flags, and `nativeReasoning` for ACP `session/set_config_option`
  reasoning.

Give spawned threads clear prompts: objective, constraints, expected deliverable,
validation to perform, and what to report back. Ask for outcome, changed files
or artifacts, validation performed, and blockers.

## Coordinating Work

- Use one clear owner per task.
- Spawn independent tasks separately when parallel work is useful.
- Let threads work after spawning. Do not poll with shell sleeps, repeated log
  reads, or repeated status reads.
- Use `bb thread wait <thread-id>` when you explicitly need to block until a
  thread finishes. It defaults to waiting for `idle` for up to 20 minutes;
  pass `--status` or `--event` for a different target, and `--timeout
<seconds>` when you need a shorter or longer budget.
- Use `bb thread tell <thread-id> "..."` when requirements change, a blocker
  needs clarification, or follow-up work is needed.
- By default, `bb thread tell` **queues** the message: if the agent is still
  working, delivery waits until the current turn finishes. Use
  `--mode steer` to **steer** — send the message immediately into the active
  turn. Prefer steer when the change is urgent (wrong direction, hard stop,
  critical clarification). Prefer the default queue when the note is non-urgent
  and the agent can finish its current work first.
  Example: `bb thread tell <thread-id> "Stop and use approach B" --mode steer`.

## Inspecting Results

- Use `bb thread search`, `history`, `read|unread`, and `folder` for the same
  organization and recall features as the sidebar. `bb thread queue` exposes
  queued-message list/create/send/reorder/group/delete operations.
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

## Files And Voice

- Use `bb file read|write|list|paths|mkdir|move|remove` for SDK-equivalent host
  file access. `--host` targets another machine; `--root` confines mutations.
- Use `bb voice transcribe <file>` to invoke the configured voice transcription
  service without the app composer.

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

## Memory

- The builtin `memory` plugin is disabled by default. Enable it with
  `bb plugin enable memory` before using `bb memory ...`.
- Use `bb memory catalog` to inspect the compact index, `bb memory search
<query>` to find candidates, and `bb memory get <id>` to progressively
  disclose a full record.
- Use `bb memory add --scope project ...` for repository-specific knowledge.
  Global writes require an explicit `--scope global` and should be reserved
  for durable preferences or facts that apply across projects.
- Mutations use optimistic concurrency: pass the current record version to
  `bb memory update <id> --expected-version <n>` or `bb memory forget <id>
--expected-version <n> --reason <text>`.

## Automations

- Use `bb automation ...` to manage scheduled tasks. This command is provided
  by the builtin `automations` plugin. When due, an automation runs in one of
  two modes: `agent` (spawns a thread running a prompt — uses tokens) or
  `script` (runs a stored command and captures stdout/exit — no agent, no
  tokens).
- Choosing a mode: pick `script` when the output is fully determined by code
  (watchdogs, threshold alerts, health checks, pollers with a fixed output) —
  write the check so it prints nothing when there's nothing to report, so quiet
  ticks stay silent. Pick `agent` when the run needs reasoning (summarize,
  triage, draft for a human, branch on content).
- For a "watch X and alert me when Y" request, prefer a script automation:
  author the check script (inline `--script` or a file via `--script-file`) so
  its stdout IS the alert, then create it — no model spend per tick.
- Script automations may be disabled by the plugin setting; fall back to an
  `agent` automation if script creation is rejected.
- Create an agent automation with
  `bb automation create --project <id> --name "..." --cron "0 9 * * 1-5" --timezone "America/New_York" --provider <id> --model <model> --prompt "..."`.
- Create a one-shot agent automation with
  `bb automation create --project <id> --name "..." --in "30m" --provider <id> --model <model> --prompt "..."`,
  or use `--at "2026-07-03T09:00:00-07:00"` for an absolute run time.
- Create a script automation with
  `bb automation create --project <id> --name "..." --cron "..." --timezone "..." --script-file ./watch.sh`
  (or `--script "<inline>"`). A script that exits 0 with empty stdout, or whose
  last non-empty line is `{"wakeAgent": false}`, stays silent.
- Script automations run on the server with cwd set to the plugin data
  directory. They have no environment/workspace. Injected variables are
  `BB_SERVER_URL`, `BB_PROJECT_ID`, `BB_AUTOMATION_ID`, and
  `BB_AUTOMATION_RUN_ID`.
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
- Use `bb plugin list` if `bb automation ...` is unavailable; the builtin
  automations plugin should be installed and running.

## Secrets

- Use `bb secret request <NAME...> --write-env <path>` when credentials are
  needed. Batch known names and add `--purpose <text>` plus one
  `--describe <NAME> <text>` per variable.
- The user enters values in a secure plugin form; values are written directly
  to the workspace dotenv file and never returned in CLI output or chat.
- Treat the returned path and added/updated/unchanged counts as verification.
  Do not inspect the completed file with `cat`, `sed`, `env`, or similar tools.

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
- **Enable user-installed plugins first.** Plugins are an experiment, off by
  default: turn on **"Plugins"** under Settings → Experiments. Builtin plugins
  (`builtin:<name>`) ship with bb and remain available even when the experiment
  is off, except `connect`, which is gated by the **"bb connect"**
  experiment.
- Commands:
  - `bb plugin install <src>` — local path, `builtin:<name>`,
    `git:<url>@<ref>`, or `npm:<name>@<version>` (npm on PATH required for
    `npm:`). Installs prompt for confirmation (plugins are full-trust code);
    pass `--yes` to skip.
    Plugins that declare a frontend (`bb.app`) are built at install time for
    path/git sources; npm packages must publish a prebuilt `dist/`.
  - `bb plugin list` — status, background services, schedules, handler timings,
    and each plugin's contributed `bb` command.
  - `bb plugin enable|disable <id>`, `bb plugin reload [id]`,
    `bb plugin remove <id>` (builtin removals are remembered).
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
    `@bb/plugin-sdk/app` and register UI slots (homepageSection,
    settingsSection, navPanel, threadPanelAction, composerAccessory,
    fileOpener) with hooks (useRpc, useRealtime, useSettings, useBbContext,
    useBbNavigate, useComposer); components are vendored shadcn source the
    plugin owns. Installed
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
