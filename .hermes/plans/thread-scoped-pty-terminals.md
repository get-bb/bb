# Thread-Scoped PTY Terminal Sessions

## Goal

Add tmux-compatible, thread-scoped terminal sessions to BB and the BB CLI.

Users and agents should be able to start real PTY-backed terminal sessions for a
thread, keep them running after the initiating client detaches, see them in the
thread UI, and control them from the CLI.

Required capabilities:

- spawn shell or command PTY sessions for a specific thread
- list thread terminal sessions
- attach interactively from the CLI
- send input non-interactively
- resize
- stop/close
- read recent output without scraping the browser
- let agents use the same sessions for background work

## Current State

BB already has most of the browser terminal plumbing. The implementation should
extend it instead of adding a second PTY system.

Existing terminal surfaces:

- Domain constraints live in `packages/domain/src/terminal.ts`.
- Public terminal contracts live in `packages/server-contract/src/api/terminals.ts`.
- Public routes are already registered in `packages/server-contract/src/public-api.ts`
  under `/threads/:id/terminals`.
- Server routes live in `apps/server/src/routes/threads/terminals.ts`.
- Server lifecycle ownership lives in
  `apps/server/src/services/terminals/terminal-session-lifecycle.ts`.
- The terminal websocket bridge lives in `apps/server/src/ws/terminal-protocol.ts`
  and `/ws/threads/:threadId/terminals/:terminalId` in `apps/server/src/server.ts`.
- Terminal metadata is stored in `terminal_sessions` via
  `packages/db/src/schema.ts` and `packages/db/src/data/terminal-sessions.ts`.
- The daemon PTY owner is `apps/host-daemon/src/terminals/terminal-manager.ts`,
  backed by `node-pty`.
- Daemon terminal websocket messages are defined in
  `packages/host-daemon-contract/src/session.ts`.
- The app renders terminals through:
  - `apps/app/src/components/thread/terminal/ThreadTerminalPanel.tsx`
  - `apps/app/src/components/thread/terminal/ThreadTerminalContent.tsx`
  - `apps/app/src/components/thread/terminal/ThreadTerminalView.tsx`
  - `apps/app/src/views/thread-detail/threadTerminalTabs.ts`
- The app already uses xterm and syncs server terminal sessions into thread
  secondary-panel tabs.

Important gaps:

- CLI has no terminal commands.
- `@bb/sdk` does not expose the terminal routes even though the routes exist.
- Terminal creation only opens the user's default shell; it cannot start a
  specific command.
- Terminal PTY env only adds `BB_TERMINAL_SESSION_ID`. It does not mirror the
  agent shell env (`BB_THREAD_ID`, `BB_PROJECT_ID`, `BB_ENVIRONMENT_ID`,
  `BB_THREAD_STORAGE`).
- Output replay is daemon-memory-only. The server forwards chunks but does not
  persist terminal output, so a CLI `output` or `wait` command has no bounded
  read model today.
- UI policy closes clean terminals when the right panel closes. That is correct
  for UI-created scratch shells but wrong for CLI or agent background sessions.
- `/internal/session/tool-call` currently verifies daemon/thread ownership and
  returns `Unsupported tool`; no first-party terminal tools exist.

## Recommendation

Use the existing BB terminal lifecycle as the base.

Do not build `bb tmux` as the primary v1 command, and do not embed tmux as the
first backend unless product explicitly requires survival across host-daemon
process restarts. The existing node-pty manager already matches BB's server /
daemon boundary and UI. Extend it with command start, persisted output, SDK/CLI
control, thread env injection, and first-party agent tools.

Recommended command surface:

- canonical: `bb thread terminal ...`
- convenience alias: `bb terminal ...`
- defer literal `bb tmux ...` until BB has a deliberate tmux compatibility
  table and behavior for unsupported tmux concepts.

Mapping to tmux semantics:

- BB thread ~= tmux session namespace
- BB terminal session ~= tmux window for v1
- panes are not supported in v1
- attach/detach, send input, resize, list, and kill map naturally

This keeps the product thread-scoped while leaving room for future aliases like
`bb tmux ls`, `bb tmux attach`, `bb tmux send-keys`, and `bb tmux kill-session`
that translate to BB-native terminal APIs.

## Architecture

### Ownership Boundaries

Server owns:

- product policy and defaults
- terminal metadata and persisted recent output
- thread/environment/host authorization
- public HTTP routes and websocket fanout
- dynamic tool definitions and agent-facing terminal tool policy
- UI-visible terminal status/source/title

Host daemon owns:

- local PTY creation and teardown
- shell resolution
- PTY process lifecycle
- PTY input, resize, and output chunks
- host-local workspace resolution through the existing runtime manager

The daemon should keep returning raw PTY facts. The server should assemble BB
product behavior around them.

### Lifecycle

1. Client calls server to create a terminal for a thread.
2. Server resolves thread, environment, host session, workspace context, project
   id, and thread storage path.
3. Server creates a `terminal_sessions` row in `starting`.
4. Server sends `terminal.open` to the connected daemon.
5. Daemon resolves workspace path, spawns a PTY, starts output streaming, and
   sends `terminal.opened`.
6. Server marks the row `running`, broadcasts `terminals-changed`, and returns
   the session.
7. Browser or CLI attaches over `/ws/threads/:threadId/terminals/:terminalId`.
8. Daemon output flows to server, server persists bounded chunks, and server
   broadcasts to terminal websocket clients.
9. Close can be initiated by UI, CLI, agent, lifecycle cleanup, daemon exit, or
   process exit. Server marks the row `exited` and notifies clients.

### Persistence And Reconnect

Define the v1 guarantee clearly:

- terminal sessions survive browser and CLI detach/reattach while the host
  daemon and PTY process are alive
- terminal metadata and recent output are persisted in the server database
- a host-daemon process restart does not resurrect node-pty child processes in
  v1; sessions become disconnected/exited as they do today

If true process survival across daemon restart is a requirement, add a later
backend phase that runs PTYs under a durable local multiplexer, likely tmux or a
BB-owned PTY supervisor. Do not block the CLI/API/UI feature on that unless
Sawyer explicitly chooses it.

## Data Model

### Extend `terminal_sessions`

Add a migration after the current latest migration, likely
`packages/db/drizzle/0041_thread_terminal_sessions.sql`.

Proposed new columns:

- `source text not null default 'ui'`
  - enum: `ui`, `cli`, `agent`
- `start_mode text not null default 'shell'`
  - enum: `shell`, `command`
- `start_command text`
  - null for shell sessions
  - exact command string for command sessions
- `shell_path text`
  - filled from daemon `terminal.opened.shell`
- `auto_close_on_panel_hide integer not null default 1`
  - `1` for legacy/UI scratch terminals
  - `0` for CLI and agent sessions by default
- `created_from_turn_id text`
  - nullable, agent-created sessions only
- `created_from_tool_call_id text`
  - nullable, agent-created sessions only

Update:

- `packages/db/src/schema.ts`
- `packages/db/src/data/terminal-sessions.ts`
- `packages/db/test/data/terminal-sessions.test.ts`
- `packages/domain/src/terminal.ts`
- `packages/domain/test/terminal.test.ts`
- `packages/server-contract/src/api/terminals.ts`
- `packages/server-contract/test/contract.test.ts`

Backcompat:

- existing sessions migrate to `source='ui'`, `start_mode='shell'`,
  `auto_close_on_panel_hide=1`
- existing create requests with only `{ cols, rows }` continue to open a shell

### Add `terminal_output_chunks`

Persist recent terminal output on the server so CLI and agents can read output
without a websocket replay.

Proposed table:

```sql
CREATE TABLE terminal_output_chunks (
  terminal_id text NOT NULL,
  thread_id text NOT NULL,
  seq integer NOT NULL,
  data_base64 text NOT NULL,
  byte_length integer NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (terminal_id, seq),
  FOREIGN KEY (terminal_id) REFERENCES terminal_sessions(id) ON DELETE cascade,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE cascade
);
CREATE INDEX terminal_output_chunks_thread_terminal_seq_idx
  ON terminal_output_chunks(thread_id, terminal_id, seq);
```

Add a DB helper file, for example
`packages/db/src/data/terminal-output-chunks.ts`, with helpers to:

- insert one output chunk idempotently by `(terminalId, seq)`
- list chunks after `sinceSeq`
- list a bounded tail by chunk count and/or byte budget
- prune old chunks per terminal

Retention policy:

- start with the daemon's existing scrollback budget: 4 MiB or 10,000 chunks per
  terminal
- prune after insert in the same write path
- keep retention server-owned and explicit

## Contracts And API Shape

### Public Terminal Session Contract

Extend `terminalSessionSchema` with explicit fields:

```ts
source: "ui" | "cli" | "agent";
startMode: "shell" | "command";
startCommand: string | null;
shellPath: string | null;
autoCloseOnPanelHide: boolean;
createdFromTurnId: string | null;
createdFromToolCallId: string | null;
```

Keep all defaulting at the route/service boundary. Internal create code should
receive a resolved terminal start request with explicit values.

### Create Request

Extend `createThreadTerminalRequestSchema`:

```ts
{
  cols: number;
  rows: number;
  title?: string;
  source?: "ui" | "cli";
  start?: {
    mode: "shell";
  } | {
    mode: "command";
    command: string;
  };
  attachBehavior?: "none" | "attach-after-open";
  autoCloseOnPanelHide?: boolean;
}
```

Notes:

- Public API should accept `ui` and `cli`; server-internal agent creation sets
  `source='agent'`.
- `attachBehavior` is optional sugar for clients. The server does not attach;
  it returns metadata and clients decide whether to open the websocket.
- `command` is run by a shell inside a PTY, not by `execFile`.
- Validate command is non-empty and bounded, for example 16 KiB.

### Input, Resize, Output Routes

Add REST routes in `packages/server-contract/src/public-api.ts` and
`apps/server/src/routes/threads/terminals.ts`:

- `GET /threads/:id/terminals/:terminalId`
- `POST /threads/:id/terminals/:terminalId/input`
- `POST /threads/:id/terminals/:terminalId/resize`
- `GET /threads/:id/terminals/:terminalId/output`

Request/response sketches:

```ts
terminalInputRequest = {
  dataBase64: terminalDataBase64Schema
}

terminalResizeRequest = {
  cols: terminalColsSchema,
  rows: terminalRowsSchema
}

terminalOutputQuery = {
  sinceSeq?: string;
  tailBytes?: string;
  limitChunks?: string;
}

terminalOutputResponse = {
  session: TerminalSession;
  chunks: TerminalOutputChunk[];
  nextSeq: number;
  truncated: boolean;
}
```

Rationale:

- CLI `send` should not need to open a websocket.
- CLI/agent `output` and `wait` need an HTTP read path.
- Browser attach can continue using the existing terminal websocket.

### Daemon Terminal Protocol

Extend `hostDaemonTerminalOpenMessageSchema` in
`packages/host-daemon-contract/src/session.ts`:

```ts
{
  type: "terminal.open";
  requestId: string;
  terminalId: string;
  threadId: string;
  projectId: string;
  environmentId: string;
  threadStoragePath?: string;
  workspaceContext: WorkspaceContext;
  cols: number;
  rows: number;
  title?: string;
  start:
    | { mode: "shell" }
    | { mode: "command"; command: string };
}
```

Extend `terminal.opened`:

```ts
{
  shell: string;
  title: string;
  initialCwd: string;
  cols: number;
  rows: number;
}
```

The opened message already has these fields except `shell` should be persisted
as `shellPath`.

Bump `HOST_DAEMON_PROTOCOL_VERSION` in
`packages/host-daemon-contract/src/commands.ts`.

## Server Implementation

Main files:

- `apps/server/src/routes/threads/terminals.ts`
- `apps/server/src/services/terminals/terminal-session-lifecycle.ts`
- new `apps/server/src/services/terminals/terminal-output.ts`
- new `apps/server/src/services/terminals/terminal-tools.ts`
- `apps/server/src/ws/terminal-protocol.ts`
- `apps/server/src/types.ts`
- tests under `apps/server/test` or colocated route/service tests

### Creation

Update `TerminalSessionLifecycle.createThreadTerminal` to:

1. resolve the thread with `requirePublicThread`
2. require attached ready environment
3. require connected host session
4. require workspace command target
5. resolve thread storage path with `requireThreadStoragePath`
6. fill defaults:
   - source defaults to `ui`
   - start defaults to `{ mode: "shell" }`
   - title defaults to `Terminal N` for shell or a shortened command for
     command sessions
   - `autoCloseOnPanelHide` defaults to true only for `source='ui'` and shell
     start
7. create `terminal_sessions` row
8. send daemon `terminal.open` with project/thread/env/thread storage context
9. mark running on `terminal.opened`

### Output Persistence

In `handleDaemonTerminalMessage` for `terminal.output`:

1. validate terminal belongs to the daemon session if needed
2. insert the chunk into `terminal_output_chunks`
3. prune old chunks for that terminal
4. forward to websocket clients

Keep websocket forwarding order the same as today. If DB insertion fails, prefer
failing visibly in logs while still forwarding live output, then evaluate
whether to fail hard after tests.

### Input And Resize

Add server lifecycle methods:

- `sendThreadTerminalInput({ threadId, terminalId, payload })`
- `resizeThreadTerminal({ threadId, terminalId, payload })`
- `readThreadTerminalOutput({ threadId, terminalId, query })`

These methods should:

- validate thread ownership via `getTerminalSessionForThread`
- reject exited/disconnected sessions for input/resize with stable API errors
- forward daemon messages only when `daemonSessionId` is present
- update `lastUserInputAt` for input
- update stored cols/rows for resize

### Close Semantics

Keep the current `closeThreadTerminal` shape:

- `mode: "force"` always closes
- `mode: "if-clean"` only closes when there has been no user input

Adjust UI cleanup to also require `autoCloseOnPanelHide === true`.

## Host Daemon Implementation

Main files:

- `apps/host-daemon/src/terminals/terminal-manager.ts`
- `apps/host-daemon/src/terminals/terminal-manager.test.ts`
- `apps/host-daemon/src/runtime-manager.ts`
- `apps/host-daemon/src/runtime-shell-env.ts` only if shared env helpers are
  useful

### PTY Spawn

Extend `TerminalPtyAdapter.spawn` to accept args:

```ts
export interface SpawnTerminalPtyArgs {
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  file: string;
  args: string[];
  logger: HostDaemonLogger;
  rows: number;
}
```

For shell start:

- `file = resolvedShell`
- `args = []`

For command start:

- `file = resolvedShell`
- `args = ["-lc", command]` for zsh/bash/sh-compatible shells
- command exits should produce `terminal.exited` with the real PTY exit code

If shell-specific command flags need to vary, keep the resolver local and
minimal. Do not build a shell registry unless tests prove it is needed.

### PTY Environment

Update `buildTerminalEnv` to include:

- `BB_TERMINAL_SESSION_ID`
- `BB_THREAD_ID`
- `BB_PROJECT_ID`
- `BB_ENVIRONMENT_ID`
- `BB_THREAD_STORAGE` when provided
- existing `BB_SERVER_URL`, `BB_HOST_DAEMON_PORT`, and PATH from
  `runtimeManager.getShellEnv()`
- existing terminal rendering variables (`TERM`, `COLORTERM`,
  `DISABLE_AUTO_TITLE`, `PROMPT_EOL_MARK`)

This should mirror `packages/agent-runtime/src/thread-shell-environment.ts`
where possible.

### Scrollback

Keep daemon in-memory scrollback for websocket attach. Server output persistence
is for HTTP reads and reconnect-visible history. Do not remove daemon replay in
v1.

## SDK Implementation

Main files:

- `packages/sdk/src/areas/threads.ts`
- `packages/sdk/src/realtime-url.ts`
- `packages/sdk/src/node-websocket.ts`
- `packages/sdk/src/transport.ts`
- `packages/sdk/src/node.ts`
- SDK tests if existing patterns fit

Add a terminal sub-area under `threads`:

```ts
sdk.threads.terminals.list({ threadId })
sdk.threads.terminals.create({ threadId, ...request })
sdk.threads.terminals.get({ threadId, terminalId })
sdk.threads.terminals.rename({ threadId, terminalId, title })
sdk.threads.terminals.input({ threadId, terminalId, dataBase64 })
sdk.threads.terminals.resize({ threadId, terminalId, cols, rows })
sdk.threads.terminals.output({ threadId, terminalId, sinceSeq, tailBytes })
sdk.threads.terminals.close({ threadId, terminalId, mode })
```

Add a runtime-agnostic websocket helper:

```ts
sdk.threads.terminals.attachSocket({ threadId, terminalId })
```

The helper should derive the terminal websocket URL from the existing realtime
URL logic by replacing `/ws` with
`/ws/threads/:threadId/terminals/:terminalId`, preserving path prefixes behind
reverse proxies.

## CLI Design

Main files:

- new `apps/cli/src/commands/thread/terminals.ts`
- update `apps/cli/src/commands/thread/index.ts`
- optional new `apps/cli/src/commands/terminal.ts` alias
- update `apps/cli/src/index.ts` if adding top-level `bb terminal`
- CLI tests under `apps/cli/src/__tests__/command-output`

### Recommended Commands

Canonical:

```bash
bb thread terminal list [threadId]
bb thread terminal start [threadId] [--title <title>] [--cols <n>] [--rows <n>] [--attach] [--json]
bb thread terminal start [threadId] -- <command...>
bb thread terminal attach <terminalId> [threadId]
bb thread terminal send <terminalId> [threadId] --text <text>
bb thread terminal send <terminalId> [threadId] --stdin
bb thread terminal resize <terminalId> [threadId] --cols <n> --rows <n>
bb thread terminal output <terminalId> [threadId] [--tail-bytes <n>] [--since-seq <n>] [--json]
bb thread terminal wait <terminalId> [threadId] --contains <text> [--timeout <seconds>]
bb thread terminal stop <terminalId> [threadId] [--if-clean] [--json]
```

Convenience alias:

```bash
bb terminal list [threadId]
bb terminal start [threadId] -- pnpm dev
bb terminal attach <terminalId> [threadId]
```

Thread ID resolution:

- use explicit positional thread id when present
- otherwise use `BB_THREAD_ID`
- support `--self` where it matches existing thread command conventions
- print the existing context label for human output when env fallback is used
- JSON output never prints extra context text

### Attach Behavior

`attach` should:

- require an interactive stdin/stdout TTY
- open the terminal websocket
- set stdin raw mode
- write terminal output bytes to stdout
- send stdin bytes as `input` messages
- send initial and SIGWINCH-driven resize messages from `stdout.columns` and
  `stdout.rows`
- restore raw mode on exit
- exit when the websocket closes or the user detaches

Potential detach sequence:

- default to tmux-like `Ctrl-B d`
- make it overridable later with `--detach-key`

Open question: `Ctrl-B` can be meaningful to terminal apps. Decide whether v1
uses tmux compatibility by default or a safer explicit escape like `~.`.

### Non-Interactive Send

`send` should:

- accept exactly one of `--text` or `--stdin`
- send bytes unchanged after UTF-8 encoding
- add no implicit newline unless `--enter` is provided
- support `--json`

### Output And Wait

`output` should:

- decode base64 chunks to stdout for human mode
- return chunks and `nextSeq` in JSON mode
- support bounded tails so agents do not pull unbounded logs

`wait` should:

- poll the output route, starting from the current `nextSeq` unless
  `--from-start` is provided
- support `--contains`, `--regex`, `--exit`, and timeout
- return non-zero on timeout

## UI Design

Main files:

- `apps/app/src/hooks/queries/thread-terminal-queries.ts`
- `apps/app/src/hooks/cache-owners/terminal-cache-owner.ts`
- `apps/app/src/components/thread/terminal/useThreadTerminalController.ts`
- `apps/app/src/components/thread/terminal/ThreadTerminalContent.tsx`
- `apps/app/src/components/thread/terminal/ThreadTerminalView.tsx`
- `apps/app/src/views/thread-detail/threadTerminalTabs.ts`
- `apps/app/src/views/thread-detail/ThreadDetailView.tsx`

Use the existing xterm rendering path. Do not add a second terminal UI.

UI changes:

- show CLI/agent-created terminal sessions as ordinary terminal tabs
- preserve CLI/agent terminal tabs when the right panel closes by honoring
  `autoCloseOnPanelHide`
- optionally show subtle source/status in existing tab status label:
  - `running`
  - `agent`
  - `cli`
  - `disconnected`
  - `exited`
- for command sessions, default tab title should be a concise command label
- keep rename-on-xterm-title-change for interactive shell sessions, but avoid
  overwriting explicit command titles unless the user renames
- ensure terminal list invalidation still happens through existing
  `terminals-changed` cache flow

Open behavior:

- v1 does not need to force-open the right panel when a CLI/agent terminal is
  created
- if product wants `--show`, add a desktop/app-control request later that opens
  the thread and activates the terminal tab

## Agent Tool Integration

Main files:

- `apps/server/src/services/threads/thread-runtime-config.ts`
- `apps/server/src/internal/tool-calls.ts`
- new `apps/server/src/services/terminals/terminal-tools.ts`
- `packages/domain/src/provider-types.ts` only if tool result contracts need
  refinement
- provider/runtime tests where dynamic tools are already covered

### Dynamic Tools

Add first-party dynamic tools from server runtime config:

- `bb_terminal_start`
- `bb_terminal_list`
- `bb_terminal_output`
- `bb_terminal_send`
- `bb_terminal_resize`
- `bb_terminal_stop`
- optional `bb_terminal_wait`

Tool descriptions should tell agents:

- use terminals for long-running/background commands
- keep output reads bounded
- return terminal ids to the user when useful
- stop terminal sessions when they are no longer needed

Tool handling should live server-side in the internal tool-call route or a
terminal-tool service called by that route. The host daemon remains unaware of
agent tool names.

### Tool Policy

Terminal tools can execute host commands. They must not bypass BB's execution
permission model.

Recommended v1 policy:

- list/output are read-only and allowed when the tool belongs to the same thread
- stop is allowed for same-thread agent-created sessions, and user-created
  sessions only if product wants agents to control them
- start command and send input are denied in readonly mode
- start command and send input in workspace-write/full require the same command
  approval semantics as provider shell execution, or an explicit server-owned
  terminal permission grant
- record `createdFromTurnId` and `createdFromToolCallId` for agent-created
  terminals

If command-approval reuse is too large for v1, ship CLI/user terminal support
first and expose only read/list/stop tools to agents until approval is in place.

### Tool Results

Return concise structured text:

- start: terminal id, title, status, attach/list commands
- output: decoded recent output plus `nextSeq`
- wait: matched text or timeout status
- stop: final status

Do not stream unbounded PTY output into a single tool response.

## Tmux Compatibility

Do not promise full tmux compatibility in v1.

Potential future alias table:

| tmux-ish command | BB mapping |
| --- | --- |
| `bb tmux ls -t <thread>` | `bb thread terminal list <thread>` |
| `bb tmux new-session -t <thread> -- <cmd>` | `bb thread terminal start <thread> -- <cmd>` |
| `bb tmux attach -t <thread>:<terminal>` | `bb thread terminal attach <terminal> <thread>` |
| `bb tmux send-keys -t <thread>:<terminal> ...` | `bb thread terminal send <terminal> <thread> --text ...` |
| `bb tmux kill-session -t <thread>:<terminal>` | `bb thread terminal stop <terminal> <thread>` |

Open questions before literal `bb tmux`:

- Does `session` mean BB thread or terminal session?
- Do users expect windows/panes and layout commands?
- Should target syntax accept `thread:terminal`, terminal id only, or names?
- Should BB create stable human names in addition to ids?
- Is underlying tmux required for daemon-restart survival?

## Security And Permissions

Server-side validation:

- every terminal operation must validate thread ownership
- terminal id must belong to the supplied thread
- thread must have a ready environment for create
- daemon session host must match environment host
- input/resize must require a running daemon-owned session
- command strings must be length-bounded
- base64 input/output payloads keep using `terminalDataBase64Schema`

Daemon-side validation:

- continue resolving workspace through `requireResolvedWorkspaceForCommand`
- keep PTY cwd confined to the resolved workspace target
- do not accept arbitrary cwd from public clients in v1
- sanitize inherited process env as today

Agent-specific security:

- dynamic tool start/send must respect permission mode
- commands started by agents should be auditable via source and tool-call
  columns
- agents should not silently take over user-created terminals unless explicitly
  allowed

## Migration And Backcompat

- Existing UI terminal behavior must keep working with `{ cols, rows }`.
- Existing rows migrate to UI shell sessions.
- Existing websocket clients continue to work because `terminalClientMessage`
  does not need to change for attach/input/resize.
- New daemon message fields require a protocol version bump and coordinated
  server/daemon update.
- If a terminal has no persisted output chunks, the output route returns an
  empty chunk list with `nextSeq=0`; live websocket attach can still replay from
  daemon memory.
- Windows remains unsupported for native terminals unless `node-pty` support is
  intentionally added later.

## Phased Rollout

### Phase 1: Contracts And Persistence

Implement:

- domain terminal enums/fields
- server-contract terminal schemas/routes
- host-daemon terminal message schema changes
- DB migration for session metadata
- DB table/helpers for terminal output chunks
- SDK terminal area stubs if contract work is easiest to type through SDK

Exit criteria:

- contracts parse old and new terminal create requests
- DB migration covers existing rows
- output chunks can be inserted, tailed, and pruned

Validation:

```bash
pnpm exec turbo run test --filter=@bb/domain -- terminal
pnpm exec turbo run test --filter=@bb/server-contract -- terminals
pnpm exec turbo run test --filter=@bb/host-daemon-contract -- terminal
pnpm exec turbo run test --filter=@bb/db -- terminal
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/server-contract --filter=@bb/host-daemon-contract --filter=@bb/db
```

### Phase 2: Server Lifecycle And Routes

Implement:

- create defaults and metadata
- command-start request handling
- input/resize/output route handlers
- output persistence on daemon output
- close behavior with `autoCloseOnPanelHide`

Exit criteria:

- REST API can create shell and command terminals
- REST API can send input, resize, read output, and close
- ownership and disconnected-host errors are stable

Validation:

```bash
pnpm exec turbo run test --filter=@bb/server -- terminals
pnpm exec turbo run typecheck --filter=@bb/server
```

### Phase 3: Daemon PTY Enhancements

Implement:

- PTY args support
- command start through shell `-lc`
- thread/project/env/thread-storage env injection
- tests for shell start, command start, input, resize, output, exit, and close

Exit criteria:

- command PTY starts in the thread workspace
- `bb` run inside the PTY sees `BB_THREAD_ID`, `BB_PROJECT_ID`,
  `BB_ENVIRONMENT_ID`, and `BB_THREAD_STORAGE`
- daemon still serializes terminal operations per terminal id

Validation:

```bash
pnpm exec turbo run test --filter=@bb/host-daemon -- terminal-manager
pnpm exec turbo run test --filter=@bb/host-daemon -- runtime-manager
pnpm exec turbo run typecheck --filter=@bb/host-daemon
```

### Phase 4: SDK And CLI

Implement:

- `sdk.threads.terminals`
- terminal websocket URL helper
- `bb thread terminal ...`
- `bb terminal ...` alias if accepted
- CLI attach raw-mode implementation
- CLI output/wait polling implementation

Exit criteria:

- CLI can start a shell and attach
- CLI can start `-- pnpm dev`, detach, list, read output, send input, resize,
  and stop
- JSON output is complete and machine-readable

Validation:

```bash
pnpm exec turbo run test --filter=@bb/sdk -- terminal
pnpm exec turbo run test --filter=@bb/cli -- terminal
pnpm exec turbo run typecheck --filter=@bb/sdk --filter=@bb/cli
```

Manual smoke:

```bash
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread terminal start "$BB_THREAD_ID" -- echo hello
pnpm bb:dev thread terminal list "$BB_THREAD_ID"
pnpm bb:dev thread terminal output <terminal-id>
pnpm bb:dev thread terminal stop <terminal-id>
```

### Phase 5: App Polish

Implement:

- UI respects `autoCloseOnPanelHide`
- CLI/agent sessions show as terminal tabs
- source/command title display is understandable
- disconnected/exited behavior remains stable

Exit criteria:

- terminal sessions created outside the app appear in the thread terminal tabs
- app does not reap CLI/agent background sessions when the panel closes
- UI-created scratch terminals still close-if-clean on panel hide

Validation:

```bash
pnpm exec turbo run test --filter=@bb/app -- ThreadTerminal
pnpm exec turbo run test --filter=@bb/app -- threadTerminalTabs
pnpm exec turbo run typecheck --filter=@bb/app
```

Manual app smoke:

```bash
scripts/bb-dev-app current
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread terminal start "$BB_THREAD_ID" -- sleep 60
```

Then open the thread and verify the terminal tab appears and remains after the
right panel closes.

### Phase 6: Agent Tools

Implement:

- first-party dynamic terminal tool definitions
- terminal tool dispatch in internal tool-call handling
- permission enforcement
- audit fields for agent-created sessions
- bounded output/wait behavior

Exit criteria:

- an agent can start a long-running command terminal and continue the turn
- the terminal appears in the UI and CLI list
- the agent can poll bounded output and stop its terminal
- readonly threads cannot use terminal tools to execute commands

Validation:

```bash
pnpm exec turbo run test --filter=@bb/server -- terminal-tools
pnpm exec turbo run test --filter=@bb/agent-runtime -- dynamic
pnpm exec turbo run test --filter=@bb/host-daemon -- thread-dispatch
pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/agent-runtime --filter=@bb/host-daemon
```

Manual smoke:

```bash
eval "$(scripts/bb-dev-app env)"
pnpm bb:dev thread spawn --project proj_personal --provider codex --permission-mode workspace-write --title "Terminal smoke" --prompt "Start a terminal running a short loop, read one output chunk, then stop it." --json
```

### Phase 7: Docs And Compatibility Aliases

Implement:

- update CLI guide templates in `packages/templates`
- add examples for CLI and agent usage
- decide whether to add `bb tmux` aliases
- if aliases are added, keep unsupported tmux commands explicit and non-magical

Validation:

```bash
pnpm exec turbo run test --filter=@bb/cli -- guide
pnpm exec turbo run test --filter=@bb/server -- injected-skills
pnpm exec turbo run typecheck --filter=@bb/cli --filter=@bb/server
```

## Open Questions

1. Is daemon-restart survival required for v1?
   - If yes, node-pty is insufficient. Use tmux or a daemon-independent PTY
     supervisor as the backend.
   - If no, extend the existing node-pty manager and document that sessions
     survive client detach but not daemon restart.

2. What is the canonical command group?
   - Recommendation: document `bb thread terminal ...` as canonical and provide
     `bb terminal ...` as a convenience alias.
   - Avoid `bb tmux ...` until target syntax and unsupported pane/window
     semantics are settled.

3. Should command-start terminals close immediately on command exit or stay open
   in a shell?
   - Recommendation: command sessions exit when the command exits.
   - Add `--keep-open` later if users ask for it.

4. What detach sequence should CLI attach use?
   - tmux-like `Ctrl-B d` is familiar but can conflict with terminal apps.
   - `~.` is less tmux-like but common in SSH-style clients.

5. Should agents be allowed to send input to user-created terminals?
   - Recommendation: no by default. Allow list/output and agent-owned terminal
     control first.

6. How large should persisted terminal output be?
   - Recommendation: start with 4 MiB or 10,000 chunks per terminal, matching
     daemon scrollback, and expose config only if needed.

7. Should `wait` be CLI-only polling or a server route?
   - Recommendation: CLI-only polling in v1. Add server-side wait only if
     multiple clients need it or polling becomes expensive.

8. Should terminal output be added to the normal thread timeline?
   - Recommendation: no for v1. Terminals are visible in terminal tabs and
     controllable through CLI/tools. Timeline can show a compact system/tool
     event for agent-created terminals later if needed.

## Implementation Notes

- Keep changes local to existing terminal modules where possible.
- Do not introduce a generic process/session framework.
- Do not load all terminal output chunks and filter in JavaScript; use targeted
  `WHERE terminal_id = ? AND seq >= ?` queries.
- Add indexes only for the new output read paths.
- All validation and defaults should happen at server boundaries.
- Use Turbo validation commands, not package scripts directly.
