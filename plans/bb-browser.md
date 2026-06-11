# bb Browser

## Goal

Add `bb browser ...` CLI commands that drive visible in-app browser automation
inside the bb desktop app.

The core requirement is that agents and users can run the same commands, and the
user can watch browser automation in the desktop app when desired.

Related plans:

- `plans/in-app-browser-open-behavior-improvements.md` covers ordinary link
  opening and default-browser bypass rules.
- `plans/bb-terminal.md` covers CLI-driven terminal control.
- `plans/bb-settings.md` covers scriptable settings.

## Current State

- The bb CLI uses Commander under `apps/cli/src/index.ts` and command modules
  under `apps/cli/src/commands/`.
- Server-side provider tool calls currently enter through
  `apps/server/src/internal/tool-calls.ts`; only `message_user` is handled
  today.
- Thread runtime config injects dynamic tools through
  `apps/server/src/services/threads/thread-runtime-config.ts`.
- The desktop app hosts in-app browser tabs as isolated Electron
  `WebContentsView` instances in `apps/desktop/src/desktop-browser-view.ts`.
- The renderer owns tab creation and activation through secondary-panel state.
  A visible automation session should first ask the renderer to open or focus an
  in-panel browser tab, then ask desktop main to operate on that tab's
  `WebContentsView`.
- `dev-browser` is an external CLI that controls Playwright browsers and can
  connect to Chrome/CDP endpoints, but bb's in-app `WebContentsView` is not
  currently exposed as a CDP endpoint or browser-testing primitive.

## Recommendation

Make `bb browser ...` the public, reproducible surface. Add dynamic tools later
as thin wrappers over the same backend commands if model-native tool use proves
materially better than shelling out to the CLI.

Avoid a production remote-debugging-port integration. It can expose all Electron
targets, including trusted bb UI. A scoped bb-owned bridge is safer and gives bb
control over target ownership, user visibility, cancellation, and audit logs.

## Command Shape

Start with:

```bash
bb browser open <url> --visible --json
bb browser list --json
bb browser snapshot <target-id> --json
bb browser click <target-id> --selector 'button[type=submit]'
bb browser click <target-id> --x 420 --y 315
bb browser type <target-id> --selector '#email' --text 'user@example.com'
bb browser eval <target-id> --script-file script.js --json
bb browser close <target-id>
```

Prefer stable target ids over implicit "active window" behavior. Commands may
default `--thread` from `BB_THREAD_ID` when available, matching existing bb CLI
context conventions.

## Architecture

Browser command path:

```text
bb browser ... CLI
  -> server browser automation API
  -> active desktop app request channel
  -> renderer opens/focuses an in-panel browser tab when visible
  -> renderer registers automation target with desktop main
  -> desktop main controls the tab's WebContentsView
  -> result returns to server
  -> CLI prints JSON or text
```

The desktop renderer remains responsible for visible app layout. Desktop main
remains responsible for native `WebContentsView` control. The server coordinates
requests and authorization. The CLI is just a client.

## Phase 1 - Browser Automation Contracts

Scope:

- Add server-contract request/response schemas for browser automation commands:
  - open
  - list
  - snapshot
  - click
  - type
  - evaluate
  - close
- Model target ownership explicitly:
  - `targetId`
  - `threadId`
  - `createdBy: "cli" | "agent"`
  - `visible`
  - `createdAt`
  - `lastUsedAt`
- Bound all attacker-influenced strings:
  - URL length
  - selector length
  - typed text length
  - eval script length
  - screenshot data size
- Keep `evaluate` explicit and auditable. It should run only in automation-owned
  browser targets, not arbitrary user tabs.

Exit criteria:

- Contracts are typed and tested.
- No accepted-but-ignored fields.
- `evaluate` has a deliberate script length cap and target ownership check.

Validation:

- `pnpm exec turbo run test --filter=@bb/server-contract`
- `pnpm exec turbo run typecheck --filter=@bb/server-contract`

## Phase 2 - Server Browser Automation API

Scope:

- Add `/api/v1/browser/...` routes or an app-control route group that receives
  CLI requests.
- Route requests only to an active desktop session for the relevant local host.
- Return clear errors when:
  - no desktop app is connected
  - no window is available
  - requested target is missing
  - target belongs to another thread/session
  - command timed out
- Persist or maintain an in-memory registry of automation targets. Start
  in-memory unless reconnect recovery is a required v1 behavior.
- Add cancellation support for in-flight automation commands.

Exit criteria:

- CLI can call server routes without knowing desktop IPC details.
- Server enforces host/thread ownership before dispatching a browser command.
- Errors are actionable and stable enough for agents.

Validation:

- `pnpm exec turbo run test --filter=@bb/server -- browser`
- `pnpm exec turbo run typecheck --filter=@bb/server`

## Phase 3 - Desktop Request Channel

Scope:

- Add a server-to-renderer request channel for browser commands. Prefer the
  existing realtime infrastructure if it can support request/response semantics;
  otherwise add a small dedicated channel.
- Renderer handles `browser.open` by opening/focusing a secondary-panel browser
  tab when `visible: true`.
- Renderer registers the browser tab with desktop main:
  - `registerAutomationTarget({ threadId, tabId, targetId })`
  - `unregisterAutomationTarget({ targetId })`
- Keep automation targets separate from ordinary user-created browser tabs.
- Show an in-tab or panel-level indication that an agent/CLI is controlling the
  tab, with a Stop control.

Exit criteria:

- `bb browser open --visible` opens a visible in-panel browser tab.
- Automation targets survive normal tab activation/switching.
- Closing the tab unregisters the automation target.
- User can stop an in-flight automation session from the app UI.

Validation:

- `pnpm exec turbo run test --filter=@bb/app -- BrowserTabDeck`
- `pnpm exec turbo run test --filter=@bb/app -- useThreadFileTabs`
- `pnpm exec turbo run typecheck --filter=@bb/app`

## Phase 4 - Desktop Main Automation Driver

Scope:

- Extend `DesktopBrowserViewManager` with automation-target lookup and commands.
- Use Electron `webContents.debugger` / CDP commands for page operations:
  - navigation: `Page.navigate`
  - DOM inspection: `Runtime.evaluate`, `Accessibility.getFullAXTree`, or
    `DOMSnapshot.captureSnapshot`
  - click/type: selectors via evaluated DOM coordinates, then
    `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`
  - screenshot: `Page.captureScreenshot` or Electron `capturePage`
- Prefer selector-based actions over coordinates. Coordinate actions should
  require a prior snapshot or explicit coordinates from the caller.
- Deny automation against non-automation-owned tabs.
- Keep the existing in-app browser network firewall unchanged.

Exit criteria:

- Open, snapshot, click, type, evaluate, and close work against a visible
  in-panel browser tab.
- The user can watch visible page navigation and interaction.
- Automation cannot target arbitrary user browser tabs.
- Browser automation errors include enough context for agents to retry.

Validation:

- `pnpm exec turbo run test --filter=@bb/desktop -- desktop-browser`
- `pnpm exec turbo run typecheck --filter=@bb/desktop`
- Manual smoke test through `scripts/bb-dev-app current`

## Phase 5 - CLI Commands

Scope:

- Add `apps/cli/src/commands/browser.ts`.
- Register it in `apps/cli/src/index.ts`.
- Use object-shaped helpers and shared output formatting consistent with other
  CLI commands.
- Support `--json` for every command agents will use.
- Print stable ids and concise errors.

Exit criteria:

- `bb browser open https://example.com --visible --json` returns a target id.
- `bb browser snapshot <target-id> --json` returns structured page state and/or
  screenshot path/data metadata.
- `bb browser click/type/eval/close` operate on that target.
- Commands are usable from an agent shell without browser-specific MCP tools.

Validation:

- `pnpm exec turbo run test --filter=@bb/cli -- browser`
- `pnpm exec turbo run typecheck --filter=@bb/cli`

## Phase 6 - Built-In Skill

Scope:

- Add `apps/server/src/services/skills/builtin-skills/bb-browser/SKILL.md`.
- Teach agents to use `bb browser ...` for visible browser QA and screenshots.
- Include usage guidance:
  - use `--visible` when the user should be able to watch
  - snapshot after each meaningful browser action
  - prefer selectors over coordinates
  - keep eval small, explicit, and explain why it is needed
- Mention related commands from the `bb terminal` and `bb settings` plans once
  they exist.
- Do not instruct agents to use `dev-browser` for bb's in-app browser. Keep
  `dev-browser` as a fallback for separate Playwright-browser QA only.

Exit criteria:

- Agents receive the built-in skill through the injected-skill pipeline.
- The skill references real bb CLI commands, not provider-specific tools.
- A user data-dir skill with the same name can override the built-in.

Validation:

- `pnpm exec turbo run test --filter=@bb/server -- builtin-skills-copy`
- `pnpm exec turbo run test --filter=@bb/server -- injected-skills`
- `pnpm exec turbo run typecheck --filter=@bb/server`

## Open Questions

- Should browser automation targets be per-thread only, or can project-level
  targets exist outside a thread?
- Should `bb browser snapshot` return screenshots as files, data URLs, or both?
- Should dynamic tools ship in v1, or should the built-in skill rely entirely
  on CLI commands first?
