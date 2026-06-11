# bb Terminal

## Goal

Add `bb terminal ...` CLI commands that drive thread terminal sessions and make
terminals visible in the desktop app when requested.

This gives users and agents a shared, scriptable way to create terminals, send
input, inspect output, and close sessions without scraping browser UI.

Related plans:

- `plans/bb-browser.md` covers visible in-app browser automation.
- `plans/bb-settings.md` covers scriptable settings.

## Current State

- Server terminal routes are under `apps/server/src/routes/threads/terminals.ts`.
- Terminal lifecycle ownership lives in server/host-daemon terminal modules,
  including `apps/server/src/services/terminals/terminal-session-lifecycle.ts`
  and `apps/host-daemon/src/terminals/terminal-manager.ts`.
- The app renders terminals through `ThreadTerminalPanel`,
  `ThreadTerminalContent`, and `ThreadTerminalView`.
- The UI talks to terminals over websocket; the CLI does not currently expose a
  first-class terminal command group.

## Recommendation

Build `bb terminal ...` on the existing terminal lifecycle model. Do not create
a separate pseudo-terminal implementation for the CLI. The CLI should request
the same server/host-daemon terminal sessions that the app uses.

Use `--visible` as a desktop-app hint: create or focus the terminal in the
thread's terminal panel when an active desktop app is connected, but still allow
headless CLI terminal operations when no desktop is open.

## Command Shape

Start with:

```bash
bb terminal list --thread <thread-id> --json
bb terminal open --thread <thread-id> --visible --json
bb terminal input <terminal-id> --text 'pnpm test\n'
bb terminal snapshot <terminal-id> --json
bb terminal close <terminal-id>
```

Potential later commands:

```bash
bb terminal wait <terminal-id> --contains 'ready' --timeout 30s --json
bb terminal resize <terminal-id> --cols 120 --rows 40
```

Commands should default `--thread` from `BB_THREAD_ID` when available.

## Phase 1 - Contract And API Audit

Scope:

- Audit existing terminal HTTP and websocket contracts.
- Decide whether `snapshot` should read from persisted terminal output chunks,
  server state, or a new terminal transcript endpoint.
- Add any missing typed contracts for:
  - terminal open response
  - terminal output snapshot
  - terminal input request
  - terminal close request
- Ensure all commands operate on terminal ids and validate thread ownership.

Exit criteria:

- Terminal CLI requirements map to existing lifecycle boundaries.
- Any new contract fields have real semantics and validation.
- `snapshot` has a bounded output size.

Validation:

- `pnpm exec turbo run test --filter=@bb/server-contract`
- `pnpm exec turbo run typecheck --filter=@bb/server-contract`

## Phase 2 - Server Terminal CLI Routes

Scope:

- Add or reuse server routes for:
  - list terminals by thread
  - create/open terminal
  - send input
  - read recent output snapshot
  - close terminal
- Keep terminal lifecycle advancement in existing lifecycle modules.
- Make `--visible` a request to focus/open the terminal panel when the desktop
  app is available; do not make terminal creation depend on desktop UI.
- Return stable errors for missing terminal, wrong thread, disconnected host,
  and terminal already exited.

Exit criteria:

- Server routes can perform all planned terminal CLI operations.
- Host-daemon terminal manager remains the owner of PTY/session primitives.
- Server route tests cover success and ownership failures.

Validation:

- `pnpm exec turbo run test --filter=@bb/server -- terminals`
- `pnpm exec turbo run typecheck --filter=@bb/server`

## Phase 3 - Desktop Visibility Hook

Scope:

- Add app-control request handling for terminal visibility:
  - focus/open terminal panel for a thread
  - activate a specific terminal tab
  - optionally create a terminal from the app request if server already created
    the session
- Ensure `--visible` does not close or recreate terminal sessions.
- Keep terminal tab state consistent if the user manually closes the terminal
  panel while the CLI is interacting with a terminal.

Exit criteria:

- `bb terminal open --visible` opens/focuses a terminal in the desktop app.
- `bb terminal input` can be watched in the visible terminal.
- Closing through CLI uses the same lifecycle path as UI close.

Validation:

- `pnpm exec turbo run test --filter=@bb/app -- ThreadTerminalPanel`
- `pnpm exec turbo run test --filter=@bb/app -- ThreadTerminalView`
- Manual desktop smoke test through `scripts/bb-dev-app current`

## Phase 4 - CLI Commands

Scope:

- Add `apps/cli/src/commands/terminal.ts`.
- Register it in `apps/cli/src/index.ts`.
- Support `--json` for all agent-facing commands.
- Use consistent table/text output for non-JSON mode.
- Ensure `input --text` handles literal newlines predictably and documents shell
  quoting expectations.

Exit criteria:

- CLI can create a terminal for a thread and make it visible in the desktop app.
- CLI can send input and read output without requiring browser UI scraping.
- CLI can close a terminal using the same lifecycle as the app.

Validation:

- `pnpm exec turbo run test --filter=@bb/cli -- terminal`
- `pnpm exec turbo run typecheck --filter=@bb/cli`

## Phase 5 - Built-In Skill Update

Scope:

- Add or update a built-in skill section that teaches agents to use
  `bb terminal ...` for terminal-driven workflows.
- Guidance should prefer:
  - `bb terminal snapshot` over scraping UI
  - `bb terminal wait` once available for readiness checks
  - `--visible` when the user should be able to watch
- Keep terminal guidance separate from browser guidance unless the skill is
  intentionally a broader "bb app control" skill.

Exit criteria:

- Agents know when to use `bb terminal ...` instead of ad hoc shell sessions.
- Skill examples match implemented CLI commands.

Validation:

- `pnpm exec turbo run test --filter=@bb/server -- injected-skills`

## Open Questions

- Should `snapshot` return the last N bytes, last N lines, or both?
- Should `input` accept stdin as well as `--text` for larger payloads?
- Should `wait` ship in v1, or should agents poll `snapshot` initially?
- Should terminal visibility target the bottom panel only, or later respect
  flexible layout placement?
