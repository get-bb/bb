# Handoff: pi-bubblewrap sandboxing is silently void under bb (bash), and "Searching for…" rows come from sniffed bash commands

> **Status (2026-08-24):** historical. Bug A described the in-process Pi SDK
> bridge (`packages/agent-runtime/src/pi/…`), which #2325 replaced with a
> `pi --mode rpc` child that registers bb's tools through pi's own extension
> API, so the `customTools` precedence it analyzes no longer exists. Bug B's
> fix landed as "fix(thread-view): stop inferring shell searches". Kept for
> the production analysis.

Filed 2026-08-23 from live incident analysis on ryzen (bb 0.39.0-unstable-2026-08-23, pi 0.84.0).
Author thread: nixos-config / thr_jycipttndr. Two independent bugs, two small patches, one verification pass.

## Background (what happened in production)

1. With the pi-bubblewrap pi extension loaded and healthy (its status card rendered, its slash commands and approval dialogs worked), **bash tool calls were never sandboxed**: they spawned as plain `/bin/bash -c` direct children of the bridge worker process, with the real `$HOME` and no bwrap anywhere in the tree. Verified on two threads sharing bridge PID:
   - `ps --ppid <bridge-pid> -o pid,stat,etime,cmd` during a bash call → `/bin/bash -c …` directly, no guardian/bwrap layers.
   - Inside a bash call: `HOME=/home/mbullington` (a wrapped call would land in `*/pi-bubblewrap/state/*/home`).
   Meanwhile read/grep/find/ls **are** still extension-wrapped (a `read` outside the project root was refused with the extension's own `path escapes sandbox read roots` message). So the sandbox holds for every tool except the one that can do everything.
2. A 7-minute `nix build … | grep -vE '^warning|^Using saved|SQLite' | tail -3` bash call rendered in the thread UI as **"Exploring 2 searches / Searching for ^warning|^Using saved|SQLite"** with a spinner for the whole duration. It looked like a hung grep tool; it was a normal long build. The pattern matched the pipeline's inline grep verbatim (confirmed in `/proc/<pid>/cmdline`).

## Bug A — bridge `customTools` always replace extension-registered core tools

Mechanism chain (all verified in source):

1. `packages/agent-runtime/src/pi/session-params.ts` (~L70–86): `shellEnvOverrides` always contains `BB_THREAD_ID` (`/** Always carries BB_THREAD_ID; pi applies it as its shell env policy. */`).
2. `packages/agent-runtime/src/pi/bridge/sdk-session.ts` (~L150–190): `buildSessionCustomTools()` pushes `createBashToolWithShellEnvOverlay()` whenever `shellEnvOverrides` is non-empty → **always**, for every session on every thread. It builds pi's stock bash via `createBashToolDefinition(cwd, { commandPrefix, shellPath, spawnHook })` and returns it as a `customTools` entry named `bash`.
3. pi precedence (`@earendil-works/pi-coding-agent@0.84.0`, `dist/core/agent-session.js`, `_refreshToolRegistry` ~L1940–1975):
   ```js
   const definitionRegistry = new Map(/* baseToolDefinitions (built-ins) */);
   const allCustomTools = [ ...registeredTools /* extensions */, ...this._customTools /* sdk */ ];
   for (const tool of allCustomTools) definitionRegistry.set(tool.definition.name, tool); // later wins
   ```
   Built-ins seeded → extension `registerTool()` overwrites built-ins → SDK `customTools` overwrite extensions. So bb's bash definition replaces pi-bubblewrap's sandboxed bash every session, silently.

Why the overlay exists (keep this constraint): sdk-session.ts comment — "This is intentionally bash-only; non-bash tools must not depend on per-thread env in this shared bridge process." Multiple threads share one bridge process, so `BB_THREAD_ID`/thread env vars must be injected per-spawn, not via process env. Any fix must preserve per-thread bash env overlay semantics.

### Fix direction (recommended)

Use pi's `baseToolsOverride` session option instead of `customTools` for the bash overlay. Pi builds base tools from `_baseToolsOverride` when provided (`agent-session.js` `_buildRuntime` ~L2021: `this._baseToolsOverride ? … : createAllToolDefinitions(this._cwd, …)`), and base tools are the layer extensions overwrite — so an extension's `bash` registration wins over bb's override, while sessions without such an extension get the env-overlaid bash. That restores the documented layering (built-ins < extensions) without changing pi.

- `baseToolsOverride` replaces the **whole** base tool set, so construct the full set (`createAllToolDefinitions`, or the individual `create*ToolDefinition` builders bb already imports for `bash`) and substitute bb's env-overlay bash into it. Verify `createAllToolDefinitions` (or each needed builder) is exported from `@earendil-works/pi-coding-agent`; if not, compose the map from the exported per-tool builders.
- Document the tradeoff in the commit message: when an extension registers `bash`, bb's env overlay yields to it. That is the desired security posture (sandboxing beats env convenience); pi-bubblewrap injects `PI_*`/allowlist env into its sandbox already, and it does not know `BB_THREAD_ID` — acceptable; note `user_bash` (`!` commands) keeps its own path either way.
- Alternative (larger, upstream): ask/PR pi for an explicit compose point (e.g. a session-level `bashSpawnHook`/env overlay applied to the resolved bash tool, or documented precedence making extensions beat sdk customTools). Do not gate this fix on upstream.

### Tests for Bug A

- Extend `packages/agent-runtime/src/pi/bridge/` tests (see `bridge.conformance.test.ts`, `packages/agent-runtime/src/integration.provider-basic.test.ts`, and the fixtures under `packages/agent-runtime/src/__fixtures__/pi`): create a session with `shellEnvOverrides` plus a fake extension registering `bash`; assert the extension's definition is the one executed, and that without the extension the spawn hook still injects `BB_THREAD_ID`.
- Keep a regression test that garden/dynamic `customTools` (`buildDynamicTools` path in `bridge.ts` `applyDynamicTools`) still win over same-named extension tools, or explicitly decide they should not — thread-view/garden tools currently rely on sdk precedence; do not change that accidentally. `applyDynamicTools` currently **overwrites** `sessionOptions.customTools` (`bridge.ts` ~L655); if you move bash env-overlay out of the `customTools` channel, make sure dynamic tools continue to merge cleanly.

## Bug B — thread-view projects "search" intents out of arbitrary bash pipelines

1. `packages/thread-view/src/tool-call-parsing.ts`:
   - `classifyShellSegment` (~L589–606): any `grep`/`rg` segment of a shell command becomes an intent `{ type: "search", query: <first positional> }`.
   - `parseShellCommandIntents` (~L667–686): splits the command into segments; write-shaped segments disqualify the whole command; otherwise the **first** search/read/list intent is projected. A leading `rm -f` segment classifies as "none" (not "write"), so `rm -f … && nix build … | grep -vE '…' | tail -3` **does** project a search intent.
2. `packages/thread-view/src/exec-lifecycle.ts` (~L274–282): live `commandExecution` items carry `parsedIntents`, so the in-flight build renders as an in-flight search ("Searching for …") until it exits — minutes, with no sign a build is running.
3. The bundle header ("Exploring N searches") then aggregates these rows (see the comment at exec-lifecycle.ts ~L333–336).

### Fix direction (recommended)

Per user direction: "Searching" rows should come from structured search **tools** only (`isStructuredSearchToolName`, tool-call-parsing.ts L15 — note it only lists `Grep`/`grep`; consider `ffgrep` if desirable), not from grep-shaped segments of long-running shell commands. Two acceptable shapes:

- **Narrow (preferred):** stop projecting `search` intents from `parsedIntents` on live `commandExecution` items; bash greps stay inside the bash row. Keep structured-tool search rows exactly as they are.
- **Conservative alternative:** still summarize, but label the row with the command's verb ("Running …") while the commandExecution is in flight, and only show the past-tense "Searched for …" label after completion for genuinely search-shaped commands.

Whichever shape: the acceptance test is the incident command — a bash call running `nix build … 2>&1 \| grep -vE '^warning\|^Using saved\|SQLite' \| tail -3` must render as a command execution (ideally showing the `nix build …` headline), never as an in-flight "Searching for ^warning|^Using saved|SQLite" row.

### Tests for Bug B

- Extend/add unit tests next to `packages/thread-view/src/tool-call-parsing.ts` and `exec-lifecycle.ts` covering: piped grep filters (intent suppressed or verb-labeled), `rm -f` prefix + build pipeline (the incident command), pure `grep foo -r src` bash (decide and pin the chosen behavior), and structured `grep` tool calls (unchanged, still search rows).

## Already fixed elsewhere (do not patch)

- ffgrep/fffind/@-autocomplete missing under bb: pi-bubblewrap registers FFF only when `PI_BUBBLEWRAP_FFF` is set in the pi **process** env; bb runs as the `garden` **system** service on ryzen, which never inherits `home.sessionVariables` (`/proc/<garden>/environ` had zero `PI_*` vars). Fixed in nixos-config by adding `environment.PI_BUBBLEWRAP_FFF = "1"` to `modules/machine-ryzen/garden.nix`; FFF harness tests pass on-host. Takes effect on the next `nixos-rebuild switch` + `systemctl restart garden`. No bb change needed.
- The same analysis found bb control-plane flakiness after the 2026-08-23 02:41 update (a wedged extension question that never delivered its answer on one thread; `turn.start` JSON-RPC timeout after stop on another; a third thread's bridge killed by an uncaught stale-ctx throw in `~/.pi/agent/extensions/goal.ts` `:686` in a `Timeout` callback, exit code 1). Separate issues, not in this handoff's scope.

## Verification recipe (after both patches)

1. `pnpm vitest run` (or the repo's per-package test commands) for `packages/agent-runtime` and `packages/thread-view`.
2. Run a dev bb from this worktree; open a thread in a repo with pi-bubblewrap active (e.g. nixos-config, after the garden restart above). In that thread:
   - `ps --ppid <bridge-pid> -o pid,cmd` during a bash call → guardian + `bwrap` between bridge and `/bin/bash` (not a direct child).
   - `echo "$HOME"` in a bash tool call → points under `*/pi-bubblewrap/state/*/home`.
   - `/bubblewrap` status matches the repo policy; ffgrep appears in the tool list.
3. Run the incident command `nix build … \| grep -vE '…' \| tail -3` in a thread and confirm the UI shows a running command, not an in-flight search.

## Guardrails

- Do not change pi vendor code under `node_modules`; patch bb only (pi upstream notes belong in a comment/issue).
- Preserve `BB_THREAD_ID` injection into every bash spawn; it is load-bearing for bb's per-thread shell policy.
- Keep changes additive: dynamic (garden) tools, `shellPath`, and `commandPrefix` behaviors must be untouched.
