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
  targets. The Add machine installer injects its enrolled daemon's selected
  local API port automatically and atomically reserves it across default and
  custom machine data directories.
- The main server and source Vite app bind to loopback by default. Use bb
  connect or a private Tailscale Serve URL for remote browsers and execution
  machines. `--server-bind-host 0.0.0.0` is a compatibility escape hatch only:
  the public API is unauthenticated and permits command execution and file
  reads, so wildcard binding requires a trusted network boundary.

## Environment Setup Script

- To make a repo work with bb worktrees, run `bb guide environments`. It
  documents the repo-level `.bb-env-setup.sh` setup hook and the
  `.worktreeinclude` file.
- A new worktree checks out tracked files only. Commit a `.worktreeinclude`
  file at the repo root to list untracked files, such as `.env`, that bb must
  copy from the source checkout. It uses gitignore pattern syntax. bb copies
  the matches before it runs `.bb-env-setup.sh`.

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

- `BB_INFERENCE` selects the shared model for server-side helper completions,
  including thread titles and commit subjects. It defaults to
  `codex/gpt-5.6-luna`; set an override with
  `bb-app config set BB_INFERENCE <provider/model>`.
- `BB_TRANSCRIPTION` selects the voice transcription model. It defaults to
  `codex/gpt-transcribe`; set an override with
  `bb-app config set BB_TRANSCRIPTION <provider/model>`.
- `bb-app config` and `bb-app env` reload runtime settings in a running server,
  but the CLI identifies server and launcher settings that are startup-only,
  including binding/ports, data and the dev-app port, telemetry, inherited skill
  roots, and `BB_FF_*` flags. `BB_LOG_LEVEL` is also startup-only. Use
  `bb-app config`, not `bb-app env`, to change `BB_APP_URL`, `BB_INFERENCE`, or
  `BB_TRANSCRIPTION` live. After a startup-only change, run
  `bb-app stop && bb-app start` or restart the desktop app. Until then, a server
  previously bound to `0.0.0.0` remains exposed even if
  `BB_SERVER_BIND_HOST` was changed or unset.
- Settings → General holds server-backed app-wide preferences, such as the
  macOS-only "Caffeinate" toggle. For details, read
  `references/app-settings.md` (in this skill's directory).
- The `showUnhandledProviderEvents` General preference defaults to false and
  exposes raw provider events that bb does not yet understand in packaged
  builds. Development builds always show those diagnostic rows. Update it with
  `bb settings general showUnhandledProviderEvents <true|false>`.
- The `steerActiveThreadOnEnter` General preference defaults to false. Enable
  it to make Enter steer a running thread and Command+Enter queue a
  follow-up; when disabled, those actions are reversed. Update it with
  `bb settings general steerActiveThreadOnEnter <true|false>`.
- Settings → Keyboard records server-backed per-command shortcut overrides.
  The `showKeyboardHints` preference controls the delayed badges shown while
  holding Command or Control and defaults to true; update it with
  `bb settings keyboard hints <true|false>`.
  Reset returns to bb's current default; Clear disables the command. Non-native
  actions apply in browser and desktop clients, and desktop menu accelerators
  use the same resolved bindings. For details, read
  `references/app-settings.md`.
- Use `bb settings show`, `bb settings general`, `bb settings experiment`,
  `bb settings keyboard`, `bb settings usage`, and `bb settings version` to
  inspect or change these server-backed values from agents. Pass
  `bb settings usage --machine <id-or-name>` to read provider limits from a
  specific connected machine instead of the primary machine.
- The default-off `toolsHub` experiment exposes the unified Skills, Plugins,
  and Automations management UI. Change it with
  `bb settings experiment toolsHub <true|false>`. It does not load or unload
  tools.
- The default-off `newOnboarding` experiment exposes the first-run agent and
  project setup guide. Change it with
  `bb settings experiment newOnboarding <true|false>`. Use
  `bb settings replay-onboarding` to enable it and show the guide again.
- Thread timeline windows are capped by event count as well as by user-message
  count (`BB_FF_TIMELINE_WINDOW_EVENT_BUDGET`, default 1500), because a thread
  with few user messages but many events would otherwise reproject its whole
  history on every timeline request, blocking the server event loop and
  delaying the daemon endpoints the agent awaits between tool calls. A turn
  still running is cut at the budget as well, so a very long turn costs the
  budget per update rather than growing without limit; a finished turn is
  rendered whole. Older activity loads automatically as you scroll toward the
  top; nothing becomes unreachable.

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

## Skills

- Use `bb skill list` to inspect installed and discovered skills. It defaults to
  `BB_PROJECT_ID`, then the personal project; pass `--project` or
  `--environment` to select another workspace.
- Copy the opaque ID from `bb skill list`, then use `bb skill show <skill-id>`
  or `bb skill files <skill-id>` to read that exact skill.
- `bb skill show <skill-id> --json` returns the revision. Pass that revision,
  plus `--file`, to `bb skill update <skill-id>`. Use update or delete only when
  the list says editable.
- Use `bb skill search [query]` for live skills.sh results. Inspect metadata and
  the bounded file preview with `bb skill registry detail <registry-skill-id>`.
  Install with `bb skill install <registry-skill-id>`; never infer an install
  source from a display name.
- `bb skill install-cli-skills` copies bb's built-in CLI skills into a machine's
  global agent skill roots (`~/.agents/skills` and `~/.claude/skills`) so agents
  outside bb can drive bb. It targets every connected machine unless you pass
  the repeatable `--machine <id-or-name>`, and reports each machine's outcome.
  Settings → Skills has the same action; it confirms first, and asks which
  machines only when more than one is enrolled.
- `bb skill cli-skills-status` reports per machine whether the installed copy is
  `installed`, `outdated`, `missing`, or `unknown` (disconnected or unreachable).

## Spawning Threads

- Use `bb thread spawn --project <project-id> --prompt "..."` to create another
  thread. Pass the intended project explicitly; the CLI does not infer it from
  context variables. Omitted execution flags use remembered project defaults;
  without a remembered model, bb uses the explicitly requested provider or
  Codex and resolves its provider-reported default model on the target machine.
- Add repeatable `--file <path>` / `--image <path>` flags for structured prompt
  attachments, and `--section <id>` to add the new thread to a section. These
  flags pass host-readable absolute paths (or relative server-upload tokens)
  through to the runtime; they do not read files on the CLI machine.
- Spawn creates a root thread unless you pass `--parent-thread`.
- Use `bb thread fork <source-thread-id>` to clone a provider session. It
  creates an idle fork by default; add `--prompt`, select `--workspace
isolated|reuse`, or anchor with `--source-seq-end`. Permission mode inherits
  the source thread unless explicitly overridden.
- Pass `--visibility hidden` for background/plugin workers that should remain
  out of sidebar organization without contributing unread/pending favicon
  attention. `bb thread list` excludes them by
  default; pass `--include-hidden` when a hidden worker must be discovered.
  Direct-ID lifecycle and messaging operations remain available. A root thread
  is visible by default; a child thread inherits its parent's visibility, so a
  hidden thread's subagents are hidden too. Pass `--visibility` to override the
  inherited value. A hidden child still reports its turns and blockers to its
  parent thread; only forks and side chats stay silent. Promote or hide an
  existing thread with `bb thread update <id> --visibility visible|hidden`.
- `bb connect --code <code> --server https://<handle>.getbb.app` pairs this bb
  server for browser access at `<handle>.getbb.app` (get the code from
  https://getbb.app). Pairing returns immediately — the
  server itself holds the tunnel and reconnects on restart, so there is no
  foreground process.
  `bb connect status` / `bb connect off` report and clear the pairing.
  Port sharing works from a thread on any enrolled host. `bb connect expose
<port>` resolves that thread's environment host and returns its public URL;
  outside a thread it defaults to the server host. Pass `--host
<name-or-id>` to override expose, unexpose, or shares. Server-host URLs use
  the server label; machine-host URLs use the machine label and proxy directly
  through its daemon. Shares are owner-session-gated, not public.
  `bb connect status` shows every share's host and URL; `shares --json` includes
  the resolved host plus `hostId`, `hostName`, `port`, and `url` per row.
  `bb connect servers` lists every bb on the paired account (handle,
  name, url, live) so callers can discover siblings; `--json` includes
  `selfHandle` for deduping this server. When you start a local server the user
  should open remotely, expose the port and give them the share URL. Remote
  access is owned by the builtin `connect` plugin: `bb plugin disable connect`
  cuts it off entirely; with bb connect still enabled, `bb plugin enable
  connect` restores the command. Plugins → Connect shows the current URL, QR
  code, shared ports, re-pair form, and disconnect control.
- Add remote execution machines from Settings → Machines. Its one-line
  installer stores the bb connect machine credential locally and configures
  both the daemon protocol and agent-launched `bb` CLI to traverse the account
  gate; revoke a lost machine from the getbb.app dashboard. The installer uses
  the server's exact `/install/bb-app.tgz` artifact (npm only on a 404) and
  enables daemon `--auto-update`; newer protocol mismatches update from that
  artifact with a persisted exponential retry backoff from 5 seconds to 5
  minutes, then let launchd/systemd restart the daemon. Auto-update never
  downgrades. Use `bb machine retry-update <id-or-name>` to bypass the current
  backoff after a transient failure. Remove `--auto-update` from the service
  definition and reload it to opt out.
- Run `bb machine list` to see machine names, IDs, connection status, and last
  seen time (`--json` returns the raw host list). Use `--machine <id-or-name>`
  (alias `--host`) on `bb thread spawn` to run in a personal or unmanaged
  workspace, or combine it with `--new-environment worktree`. Do not combine a
  machine selector with an existing environment ID, which already owns its
  machine.
- Each machine carries a permission limit (`maxPermissionMode`, default
  `full`): the highest permission mode a thread on that machine may run with.
  The server resolves any higher request down to it, and refuses a provider
  that supports no mode under it. Only the owner can change it, on the machine
  page at Settings → Machines → the machine — there is no CLI, SDK, or API
  surface that sets it, and machine credentials are refused — so read it from
  `bb machine list --json` or `bb machine show` and ask the user to change it
  in the app.
- `bb machine show`, `join-code`, `rename`, `retry-update`, and `remove` cover
  the Settings → Machines lifecycle. Use `bb machine provider-cli
status|install` to inspect or install provider CLIs on a selected machine.
- `bb updates` (alias for `bb updates status`) aggregates bb-app and provider
  CLI update state across every machine — the CLI counterpart of Settings →
  Updates. `bb updates apply [--machine <id-or-name>]` runs every available
  provider CLI install/update sequentially; update bb-app itself with the
  printed upgrade command or the desktop relaunch.
- Use `bb project create --name <name> --root <path> --machine <id-or-name>`
  to bind a new project's local path to a connected enrolled machine. Use
  `--host` as an alias. Omitting both selectors preserves the existing local
  CLI machine fallback (normally the primary machine).
- `bb project list` preserves the ordinary-project-only default. Pass
  `--include-personal` when the singleton personal project must be discoverable.
- Use `bb project source add <project-id> --machine <id-or-name> --path <path>`
  to register a path on another connected machine. It uses the same selector
  resolution and fallback as project create. Use `--clone` instead of `--path`
  to clone the project's remote there; `--remote-url` and `--target-path` are
  optional clone overrides.
- `bb project paths|files|content|commands` accept `--machine <id-or-name>`
  (`--host` alias) or `--environment <id>`, but not both. An environment uses
  its owning machine and workspace; an explicit machine uses that machine's
  project source; omitting both intentionally uses the primary machine source.
  `bb project content --json` returns UTF-8 text or base64 binary content with
  an explicit `contentEncoding`.
- Use `bb project attachment upload <project-id> --client-file <path>` when the
  bytes live on the CLI machine, including when the CLI and bb server are on
  different hosts. It reads locally and sends multipart bytes through the
  configured `BB_SERVER_URL` (and its enrolled-machine authentication proxy),
  returning the stable server attachment DTO. Optional `--filename` and
  `--mime-type` override inferred metadata. Pass the returned relative `path`
  to thread `--file` or `--image`; image MIME types are capped at 10MB and
  other files at 25MB. `bb project attachment download <project-id>
<attachment-path> --client-file <path>` writes existing attachment bytes on
  the CLI machine. There is no project-attachment list or per-file remove API.
- `bb project history|reorder` exposes project prompt recall and sidebar order.
- Direct environment inspection accepts any environment ID: use `bb environment
status|branches|paths|diff|diff-files|diff-file|diff-patch <id>` and `bb
environment pull-request show <id>`. Diff commands require an explicit target
  and the matching merge-base or commit flags; all support `--json`.
- `bb environment pull-request ready|draft|merge` manages pull-request state;
  `bb environment archive-threads` bulk-archives an environment's threads.
- Spawned child threads inherit permission from explicit flags, then the
  parent thread's last execution, then project defaults.
- Public permission modes are `accept-edits`, `auto`, and `full`.
  `accept-edits` keeps workspace sandboxing and asks the user to review
  escalations. `auto` keeps the same workspace sandbox while using the
  provider's automatic reviewer. `full` explicitly bypasses sandbox and
  approval protections. Plan mode remains separate. The product default is
  `auto` when no inherited or project default applies.
- When spawning a subagent, pass `--permission-mode full` unless the user or
  task explicitly requests restricted access.
- Use `--parent-self` inside a thread to parent the new thread to the current
  thread.
- Use `--parent-thread <thread-id>` to choose another specific parent.
- If provider or model choice matters, inspect options with `bb provider list`
  and `bb provider models <provider-id>`. Both accept `--machine <id-or-name>`
  (alias `--host`) or `--environment <id>` to inspect the machine where work
  will run; the selectors cannot be combined. With neither selector they
  intentionally inspect the primary machine.
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
- `bb thread tell` steers by default, delivering the message immediately into
  the active turn. Use `--mode queue` when the message is non-urgent and the
  agent can finish its current work first. Steer is especially important for a
  wrong direction, hard stop, or critical clarification.
  Example: `bb thread tell <thread-id> "Stop and use approach B" --mode steer`.

## Inspecting Results

- Use `bb thread search`, `history`, `read|unread`, and `section` for the same
  organization and recall features as the sidebar. `bb thread queue` exposes
  queued-message list/create/update/send/reorder/group/delete operations. Queue
  updates use the listed message version to prevent overwriting a concurrent
  edit and accept repeatable `--file` and `--image` attachment options.
- Use `bb thread show <thread-id>` for status, parent, environment, pull request
  status, and result.
- Use `bb thread show <thread-id> --git-diff` to review file changes.
- Use `bb thread log <thread-id>` to inspect the conversation.
- Use `bb thread output <thread-id>` to read the latest final output, or
  `bb thread output --self` for the current thread.

For review or fix pipelines, get the environment ID from
`bb thread show <thread-id> --json`, then spawn the follow-up with
`--environment <environment-id>` so it sees the same files.

## Opening Threads And Files In The App

- Use `bb thread open <path>` inside a BB thread to open a Markdown, HTML, or
  other workspace file for the user in the BB IDE's thread panel.
- Use `bb thread open <thread-id> --split right|down|left|top|replace` to open
  or focus a thread in the current app split layout. `replace` is the default;
  an already-open thread is focused. Edge splits create panes through the
  eighth pane; at eight panes, they replace the focused pane.
- A file path is optional when a thread ID is explicit:
  `bb thread open <thread-id> [path] [--split <placement>]`.
- Paths can be thread-relative workspace paths, or absolute paths inside the
  target thread workspace.
- Absolute paths under `BB_THREAD_STORAGE` open as thread-storage files for the
  current thread.
- Use `bb thread pane maximize|restore|toggle [thread-id]` to change a matching
  already-open pane in every connected BB app window. Inside a BB thread, omit
  the id to use `BB_THREAD_ID`. The command reports how many connected clients
  received the ephemeral action. The SDK equivalent is
  `sdk.threads.paneAction({ threadId, action })`.
- Users can also toggle the focused pane from its header or with the configurable
  `pane.maximize.toggle` app command (default `Mod+Shift+E`).

## Files And Voice

- Use `bb file read|write|list|paths|mkdir|move|remove` for SDK-equivalent host
  file access. `--host` targets another machine; `--root` confines mutations.
- Use `bb voice transcribe <file>` to invoke the configured voice transcription
  service without the app composer.

## Long-Running Commands

- Use `bb terminal ...` for long-running commands the user may need to inspect
  or stop later: dev servers, watch tasks, REPLs, database consoles, and similar
  processes. The terminal is a real persistent PTY shown in the bb UI.
- `list` and `create` require exactly one explicit scope: `--thread <id>`,
  `--environment <id>`, or `--machine <id-or-name>` (`--host` is an alias).
  Add `--cwd <path>` only to a machine scope. Machine targets resolve to an
  explicit host ID; terminal commands never silently fall back to primary.
- Start a server with
  `bb terminal create --thread <thread-id> --title "pnpm dev" --command "pnpm dev"`.
- All existing-session operations need only the terminal ID. Use
  `bb terminal wait <terminal-id> --contains "Local:" --timeout 120` to wait
  for readiness from new output. Pass `--from-start` only when matching existing
  scrollback is intentional.
- Use `bb terminal output <terminal-id> --json` to read bounded output, then
  continue with `--since-seq <nextSeq>` when polling. Use
  `bb terminal send <terminal-id> --text "..." --enter` for interactive input,
  `bb terminal rename <terminal-id> <title>` to rename, and
  `bb terminal close <terminal-id>` when the process is no longer needed.
- `bb terminal restart <terminal-id>` replaces the session with a shell in the
  same scope, size, and title. It does not replay the original launch command.

## Failures And Interruptions

- For failed threads, inspect `bb thread show <id> --json` and
  `bb thread log <id>` before deciding whether to retry, clarify, or update the
  user.
- The opt-in Provider retry plugin automatically waits for structured Codex and
  Claude Code subscription-window resets when the failed turn was accepted and
  its execution settings remain available. Prior output or tool activity does
  not block recovery. Enable it with
  `bb plugin enable provider-retry` or under Extensions → Plugins. Its timers
  last only while the current bb server/plugin process is running. Inspect it
  with `bb provider-retry status [thread-id]`, or cancel one with
  `bb provider-retry cancel <thread-id>`. Automatic waits default to six hours;
  configure longer waits with
  `bb plugin config provider-retry set maximumWait "24 hours"` or select
  `No limit` in the plugin settings. Resets beyond the configured horizon are
  not scheduled.
- Use `bb thread retry [id] [--request-id <id>]` for the same core
  continuation when no plugin timer remains. It sends agent-only “Please
  continue.” on the existing provider conversation and declines when input was
  not accepted, execution settings are unavailable, a newer request exists, or
  the provider still owns the retry.
- For interrupted or stopped threads, inspect first. If the user stopped the
  thread, treat that as intentional unless they ask you to continue.
- Use `bb thread stop <id>` when a thread is stuck or no longer needed.
- Use `bb thread cancel-plan <id>` to exit an active Plan turn without
  optimistically clearing its banner. Use `bb thread clear-goal <id>` to clear
  a Codex thread's durable active Goal. Both wait for provider confirmation.

## Memory

- Memory is an opt-in official plugin bundled with the app. Install it with
  `bb plugin install memory` before using `bb memory ...`.
- Use `bb memory catalog` to inspect the compact index, `bb memory search
<query>` to find candidates, and `bb memory get <id>` to progressively
  disclose a full record.
- Use `bb memory add --scope project ...` for repository-specific knowledge.
  Global writes require an explicit `--scope global` and should be reserved
  for durable preferences or facts that apply across projects.
- Mutations use optimistic concurrency: pass the current record version to
  `bb memory update <id> --expected-version <n>` or `bb memory forget <id>
--expected-version <n> --reason <text>`.

## Tasks

- Tasks is an opt-in official plugin bundled with the app. Install it with
  `bb plugin install tasks` before using `bb tasks ...`.
- Start tracked work with `bb tasks show <key-or-id> --json`. Fetch relevant
  files with `bb tasks attachment get <attachment-id> --out <path>`.
- Leave substantive milestone updates with `bb tasks comment <key-or-id>
--body <markdown>` and attach result artifacts with `bb tasks attachment
add <key-or-comment-id> --file <path>` (task key = task-level; comment ID
  = that comment). Avoid progress spam.
- Delegated threads are attached automatically. For work started independently,
  run `bb tasks attach <key-or-id>` from the working thread.
- When implementation is ready for review, run `bb tasks update <key-or-id>
--status in_review`; if blocked, leave the status accurate and explain the
  blocker in a comment.
- Change task hierarchy with `bb tasks update <key-or-id> --parent
<parent-key-or-id>` or promote a subtask with `--no-parent`. The flags are
  mutually exclusive, and both task keys and IDs are accepted.
- Add `--json` when command output will drive follow-up work. Run `bb tasks
--help` for project, folder, task, label, attachment, preset, delegation,
  attached-thread, and demo-data commands.
- `bb tasks list` defaults to 100 rows and accepts `--limit 1-500` plus the
  opaque `--cursor` returned as `nextCursor` in JSON (or printed after a human
  page). Keep the same filters and sort. A task-list mutation makes the cursor
  stale; restart without it.

## Docs

- Docs is an opt-in official plugin. Keep read-only discovery small with
  `bb docs vaults`, `list`, and `read`.
- Edit through a sync workspace: `bb docs pull <path> --into <dir>` for one
  file, add `--folder` for a subtree, or use `bb docs pull --all`. Edit the
  resulting ordinary files, inspect `bb docs status <dir> --diff`, then run
  `bb docs push <dir>`.
- `.bb-docs-state.json` is versioned identity/concurrency state; do not edit it.
  Concurrent local and remote changes fail closed with exit 3. Pull and merge,
  then retry.
- Local deletions are ignored unless `push --delete` is explicit. Use
  `push --dry-run --diff` before destructive mirroring. Standalone callers can
  select the local workspace machine with `--workspace-host <id>`.
- Direct `write`, `mkdir`, `move`, and `remove` commands are deprecated and
  retained temporarily for compatibility. Agents should use pull/edit/push.

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
- Partially update an existing agent automation in place by omitting
  `--provider` and `--model` and using `bb automation update <id> --project <id>
--prompt "..."`, `--permission-mode accept-edits|auto|full`, or exactly one
  target option:
  `--target-thread <id>`, `--environment <id-or-path>`, or
  `--new-environment worktree [--base-branch <branch>]`. Omitted execution
  fields are preserved; target options are mutually exclusive.
- Use `bb automation pause <id>` / `bb automation resume <id>` to toggle,
  `bb automation run <id>` to trigger now, and `bb automation delete <id> --yes`
  to remove.
- Use `bb automation update <id> --project <id>` with `--name` or schedule
  flags for metadata changes. To change what runs, provide a complete
  replacement execution: `--prompt` + `--provider` + `--model` for an agent,
  or `--script`/`--script-file` for a script. Script replacements also accept
  `--interpreter`, `--timeout`, and `--env-json '{"KEY":"value"}'`.
- Use `bb plugin list` if `bb automation ...` is unavailable; the builtin
  automations plugin should be installed and running.

## Secrets

- Use `bb secret request <NAME...> --write-env <path>` when credentials are
  needed. Batch known names and add `--purpose <text>` plus one
  `--describe <NAME> <text>` per variable.
- The user enters values in a secure plugin form; values are written directly
  to the dotenv file and never returned in CLI output or chat. Relative paths
  resolve from the CLI working directory; absolute paths may point anywhere on
  the thread's host.
- Treat the returned path and added/updated/unchanged counts as verification.
  Do not inspect the completed file with `cat`, `sed`, `env`, or similar tools.

## Ask User Question

- The builtin `ask-user-question` plugin gives providers that lack a native
  one an `AskUserQuestion` tool — multiple-choice questions answered in a
  composer form. It is disabled on fresh installations; enable it under
  Extensions → Plugins or with `bb plugin enable ask-user-question`.
- It contributes no CLI command. Once enabled the tool appears in the agent's
  own tool list, and only for providers without a native equivalent: Claude
  Code threads keep using Claude's built-in `AskUserQuestion`, so the plugin
  withholds its copy there.
- Answering is UI-only. `bb thread interactions list <thread-id>` shows the
  request as kind `plugin`, but `bb thread interactions answer` resolves
  provider questions only, so a pending plugin question cannot be answered
  from the CLI.

## Workflows

- The builtin `workflows` plugin runs durable provider-independent JavaScript
  orchestration and is disabled on fresh installations. Enable it under
  Extensions → Plugins or with `bb plugin enable workflows` before using its
  command.
- Author and check sources with `bb workflows validate (--script <javascript>|
--source <javascript>|--file <path>|--name <name>)`; start a background run
  with the same selector via `bb workflows run ... [--args <json>] [--resume
<run-id>]`.
- Poll compact progress with `bb workflows status <run-id>` and list compact
  run summaries with `bb workflows list [--limit <1-50>]`. For details,
  redirect one bounded
  `bb workflows history <run-id> [--cursor <call-index>] [--limit <1-100>]`
  JSONL page into `$BB_THREAD_STORAGE`, inspect it with file tools, and continue
  from the final page record's `nextCursor`. This shell redirection writes on
  the thread's execution host, including remote hosts; do not print the raw
  history into the agent transcript. Cancel with `bb workflows stop <run-id>`.
- Before choosing an explicit provider/model/reasoning tuple, run `bb provider
list --environment "$BB_ENVIRONMENT_ID" --json`, then query only the chosen
  provider with `bb provider models <provider-id> --environment
"$BB_ENVIRONMENT_ID" --json`. Never guess ACP model IDs. Run every Workflows
  command from a BB project thread.
- Configure its six settings with `bb plugin config workflows set <key>
<value>`: `maxActiveRuns` (default 4, range 1–32), `maxConcurrentAgents` (8,
  1–64), `maxAgentCalls` (100, 1–1000), `totalRunTimeoutMs` (86400000,
  60000–604800000),
  `retentionDays` (30, 1–3650), and `maxNotificationBytes` (16384,
  1024–262144). `maxActiveRuns` applies live; the other five are snapshotted per
  run. No plugin reload is needed after changing them.

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
  - `bb theme set <id> [--favicon-color <color>]` — activate a built-in
    (`default`, `nord`, `dracula`, `solarized`, `gruvbox`, `catppuccin`), custom,
    or plugin-contributed theme. Without the flag it preserves the favicon
    color; with the flag it updates the complete appearance selection.
  - `bb theme show [--css]` — print the active palette; `--css` dumps the active
    theme's CSS.
  - `bb theme reset` — back to `default` while preserving the favicon color.
  - `bb theme favicon set <color>` — set the favicon color while preserving the
    active theme. Colors: `default`, `red`, `orange`, `yellow`, `green`, `teal`,
    `blue`, `purple`, `pink`.
  - `bb theme favicon reset` — reset the favicon color to `default` while
    preserving the active theme.

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
- Plugins are on by default. Auto-installed builtin plugins ship with bb
  (except `side-chat`, which is gated by the **"Side chat plugin"**
  experiment); official plugins install from the bundled store on demand.
- **BB Official plugins** (store under `/api/v1/plugin-catalog`):
  - BB's official plugins (GitHub, Docs, Memory, and Tasks) ship
    bundled inside the app and install from the local copy — no network. Installed official
    plugins are pinned to the bundled copy and update with BB app releases.
  - `bb plugin search <query> [--json]` — search the official plugins by id,
    name, description, or category; status shows installed / compatible /
    requires newer bb.
- Commands:
  - `bb plugin install <src>` — official plugin name (github, docs, memory,
    tasks), local path, `builtin:<name>`,
    `git:<url>@<ref>`, or `npm:<package>[@<version|tag|range>]` (npm on PATH
    required for `npm:`). Prefixes `path:` / `npm:` / `git:` / `builtin:` skip
    official-plugin resolution. To pin or range an npm package, install with
    `npm:<package>@…`.
    Omit the npm spec to track compatible stable releases; ranges and dist-tags
    track, while exact versions are pinned. Git branches track;
    tags and commits are pinned. Installs prompt for confirmation (plugins are full-trust code);
    pass `--yes` to skip. Reinstalling an already-installed managed plugin is
    refused — use `bb plugin update`. Plugins that declare a frontend (`bb.app`)
    are built at install time for path sources and git sources without a
    prebuilt app when their imported dependencies are already available;
    git/npm packages can also ship a metadata-validated prebuilt `dist/`, and
    npm packages must. Managed git/npm installs refuse `engines.bb` /
    `engines.bbPluginSdk` mismatches, manifest vs. artifact identity mismatches,
    and ids reserved by bundled plugins.
  - `bb plugin outdated` — check installed plugins for compatible updates
    (table; `--json` for raw results). Shows latest compatible candidate and
    any blocked incompatible newer release. Dev builds (bb `0.0.0`) annotate
    that `engines.bb` is not enforced.
  - `bb plugin update <id>` / `bb plugin update --all` — apply compatible
    updates for tracking sources. Same full-trust confirmation as install
    (`--yes` skips; non-TTY refuses without it). Use `bb plugin outdated` to
    preview available updates; changing a pinned source requires reinstalling
    it after removal.
  - `bb plugin list` — status, background services, schedules, handler timings,
    and each plugin's contributed `bb` command.
  - `bb plugin source <id> [--json]` — requested and resolved source, engine
    ranges, install time, integrity/registry details, and recent activation
    history.
  - `bb plugin enable|disable <id>`, `bb plugin reload [id]`,
    `bb plugin remove <id>` (builtin removals are remembered).
  - `bb plugin config <id> [set <key> <value> | unset <key>]` — declared
    settings. Reload the plugin after configuring (`bb plugin reload <id>`).
  - `bb plugin logs <id> [-n N] [-f]` — the plugin's `bb.log` output.
  - `bb plugin run <id> [args...]` — explicit form of a plugin's CLI command.
  - `bb plugin new <name> [--app]` — scaffold a plugin (`--app` adds a frontend
    entry plus a typecheck-only `tsconfig.json`; scaffold sets
    `engines.bbPluginSdk` to `^0.4.1`); `bb plugin build [path]` —
    compile the plugin into `dist/`: the backend bundle (`server.js` +
    `server.meta.json` stamped with SDK/identity metadata; preferred by
    git/npm installs over source) and, when `bb.app` is declared, `app.js` +
    `app.css` + `app.meta.json`. Neither needs the server.
  - `bb plugin types [path]` — rewrite the plugin's `types/*.d.ts` from the
    running bb's `@bb/plugin-sdk` declarations, creating `types/` when absent.
    Run it in a cloned or older plugin: the scaffold seeds those files once and
    the SDK surface grows every release. `--check` reports staleness and exits
    non-zero without writing (for CI). `bb plugin build` and `bb plugin dev`
    refresh them automatically. Needs no server.
  - `bb plugin dev [path]` — watch loop for an installed plugin (default:
    cwd): on every change it rebuilds the frontend bundle (when `bb.app` is
    declared) and reloads the plugin; open app pages pick the new UI up live.
    Build/reload failures print and keep watching; Ctrl+C stops.
  - Frontend entries default-export `definePluginApp` from
    `@bb/plugin-sdk/app` and register UI slots (homepageSection,
    settingsSection, navPanel, threadPanelAction, fileOpener) with hooks
    (useRpc, useRealtime, useRealtimeConnectionState,
    useSettings, useBbContext,
    useBbNavigate, useComposer for scoped text editing / quote / mention /
    focus access); components are vendored shadcn source the
    plugin owns. Installed
    plugins and their settings also appear under Extensions → Plugins.
- Plugins can add top-level `bb` subcommands (e.g. `bb linear issues`). Run
  them directly — unknown `bb` commands are resolved against installed plugins
  and proxied to the server. Core command names always win. In agent threads,
  the injected `plugin-commands` skill lists what is available.
- Plugin commands share a 1,048,576-byte combined stdout/stderr ceiling. An
  oversized result is rejected in full as `plugin_cli_output_too_large` (valid
  JSON for `--json` callers), never truncated. Use pagination or file/streaming
  commands for large results.
- **Writing a plugin?** Use the `bb-plugin-authoring` skill — the complete
  authoring reference for the backend `BbPluginApi` (settings, storage, sdk,
  http/rpc/realtime, background services and schedules, CLI commands, agent
  tools and context, host-rendered UI, lifecycle) and the frontend
  `@bb/plugin-sdk/app` contract (slots, hooks, UI kit), with working patterns
  and gotchas. `bb guide plugins` has the short walkthrough.
