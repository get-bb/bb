# WP-90 — Debug-mode gating, safety rails & the `destructive` primitive test

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §2.2, §4.4 safety rails · decision 9.3 · AMD-0013 · ADR — bb Is Not Modified · Master Plan §5.2 fact 3, risk R13/R15 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-89 · **Blocks:** WP-91, WP-96
**Produces a FROZEN artifact:** no — implements the `destructive` runtime mechanism whose declaration lives in the AMD-0013-amended `lib/agentic/registry.ts` (WP-71 owns that file)

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/feasibility.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/mode.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/destructive.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/rate-limit.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/helper-install.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gating/destructive-allowlist.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lib/agentic/registry.ts (WP-71 amends the union; you consume it), lanes/debug-bench/register.ts (WP-88), WP-89's gdb/probe internals beyond their exported seams, package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

**This WP opens with a plugin-only feasibility check, and it is a hard gate.** SPEC 08 wants debug mode as a thread-level state with instrument tools that exist only inside it. Recon-confirmed facts constrain how that can be built: tool sets apply at session start (no hot-adding mid-session), and there is no per-tool approval UI or `requiresApproval` field. Per the ADR, if any part of this design appears to require modifying bb, stop and report it as a design problem — find the plugin-level shape or drop the capability. The candidate plugin-only shapes, in preference order: (a) session-scoped tool registration — instrument tools registered only when a workspace/thread enters debug mode, taking effect at the next session start; (b) claim-token preconditions inside every instrument tool — the tools always exist but refuse to execute without an active debug-mode claim from WP-88; (c) skill-enforced mode discipline — `fs-debug-bench` teaches entry/exit, with (b) as the mechanical backstop. Shape (b) is the enforceable floor because it depends on nothing bb does not already provide; (a) is an enhancement if session-start registration proves workable. Record the verdict in `feasibility.ts` as executable assertions, not prose.

Then the `destructive: true` primitive (decision 9.3, AMD-0013): a destructive tool executes only on an explicit human instruction **in the current turn**. Plan-inherited intent does not count — permission approved ten minutes ago is not permission now. `fs_flash` is the first user; erase, fuse programming, and factory-line actuation come later. One mechanism, one test. Not a convention, not per-tool copy-paste.

The remaining rails come from SPEC 08 §4.4: rate-limited hardware I/O (WP-89 exposed the throttle seams; this WP owns the policy), instrument arbitration consumed from WP-88 (never reimplemented), and helper libraries installed only with confirmation, never silently.

## What to build

1. The feasibility check, first: prove with harness-level tests that debug-mode gating is expressible as (b) with optional (a) — tool registration/refusal behavior under `createFakePluginHost`, session-start semantics, and zero bb-source assumptions. If a step cannot be expressed, stop and file the report; do not proceed to the rest of this WP.
2. Debug-mode state: `enterDebugMode`/`exitDebugMode` keyed to a thread/session identity, persisted in the plugin DB, holding the WP-88 device claims acquired on entry and releasing them on exit or expiry. `fs_hw_status`-driven enumeration on entry is WP-88's; you consume it.
3. The precondition guard: `requireDebugMode(ctx)` used by every instrument-tool handler (WP-96 wires it). Outside debug mode the tool returns a typed refusal with the entry instruction — it never partially executes.
4. The destructive mechanism, exactly one: a turn-scoped, single-use **destructive grant** minted only from a human-facing surface (the bench panel arm control / human confirmation interaction — never from an agent tool, CLI flag, or plan approval), bound to `{threadId, toolName, deviceId, expiresAt}`. `consumeDestructiveGrant()` is the first statement of every destructive handler; consumption is atomic and single-use; expiry is one turn / a short wall-clock bound, whichever is stricter.
5. The one test, `destructive-allowlist.test.ts`: enumerate **all nine** ACTION tools from the AMD-0013 union by name; for every tool flagged `destructive`, invoke it without a grant and assert refusal before any subprocess or hardware side effect; assert plan-context/prior-turn grants are rejected; assert grants are single-use and expire; assert the test itself fails to compile/run if the union gains a tool the test does not enumerate.
6. Rate-limit policy: per-device and per-session token-bucket values injected into WP-89's throttle seams, with a typed `RATE_LIMITED` refusal carrying the retry horizon.
7. Helper-library installation with confirmation: detection of missing Python helper packages surfaces a pending-confirmation record; installation runs only after a human confirms through the panel/interaction path, and the confirmation is recorded. No silent `pip install`, ever.
8. Publish `benchDev:changed` refetch hints on mode and grant transitions; all state queries are paged RPC from the plugin DB (real SQLite in tests — never mocked).

## Interface contract

    export interface DebugModeState {
      threadId: string;
      enteredAt: string;
      claims: DeviceClaim[];              // WP-88's type
      expiresAt: string;
    }

    export interface DestructiveGrant {
      grantId: string;
      threadId: string;
      toolName: ActionToolName;           // AMD-0013-amended union from lib/agentic/registry.ts
      deviceId: string;
      mintedAt: string;
      expiresAt: string;
      consumedAt: string | null;
    }

    export function enterDebugMode(deps: GatingDeps, threadId: string, deviceIds: string[]): Promise<DebugModeState>;
    export function exitDebugMode(deps: GatingDeps, threadId: string): Promise<void>;
    export function requireDebugMode(deps: GatingDeps, ctx: ToolExecutionCtx): Promise<DebugModeState>;   // throws typed refusal
    export function mintDestructiveGrant(deps: GatingDeps, human: HumanConfirmationEvidence, req: Omit<DestructiveGrant, "grantId" | "mintedAt" | "consumedAt">): Promise<DestructiveGrant>;
    export function consumeDestructiveGrant(deps: GatingDeps, toolName: ActionToolName, deviceId: string, ctx: ToolExecutionCtx): Promise<DestructiveGrant>;   // atomic; throws DESTRUCTIVE_REQUIRES_GRANT
    export function rateLimit(deps: GatingDeps, deviceId: string): Throttle;
    export function requestHelperInstall(deps: GatingDeps, packages: string[]): Promise<PendingConfirmation>;

`HumanConfirmationEvidence` must be producible only by a human-facing surface; its exact shape depends on what the SDK exposes (see open question 1) and is the one place a cast is forbidden.

## Acceptance criteria

- [ ] The feasibility verdict is recorded as passing harness tests before any gating code merges; a failed check produces a stop-and-report, not a workaround.
- [ ] Instrument-tool execution outside debug mode is refused with a typed error and zero side effects.
- [ ] A destructive tool cannot execute without consuming a live grant; grants are single-use, turn-scoped, and unmintable from agent tools, CLI flags, or plan approvals.
- [ ] `destructive-allowlist.test.ts` enumerates all nine ACTION tools by name and fails if any destructive-flagged tool executes without an in-turn grant — and fails on a union change it does not cover.
- [ ] Plan-inherited or previous-turn authorization is mechanically rejected, not just documented.
- [ ] Hardware I/O beyond policy rate returns `RATE_LIMITED` with a retry horizon; limits are per-device and per-session.
- [ ] Helper libraries install only after recorded human confirmation; the pending state is visible and resumable.
- [ ] Arbitration comes from WP-88 claims; this WP adds no second claim store.
- [ ] Suite is green in CI with no hardware and no Python; real SQLite throughout.

## Test plan

- feasibility.test.ts — session-start tool-set semantics under the fake host; refusal-based gating works with tools always registered; no assertion depends on bb-source behavior.
- mode.test.ts — enter/exit lifecycle, claim acquisition and release on exit and on expiry, re-entry idempotence, and `requireDebugMode` refusal outside the mode (error path).
- destructive.test.ts — mint from human evidence only; mint attempt from a tool context refused (safety error path); atomic single consumption under concurrent consumers; expiry; grant bound to the wrong device/tool refused.
- destructive-allowlist.test.ts — the nine-tool enumeration described in build step 5, including the union-drift failure.
- rate-limit.test.ts — burst then `RATE_LIMITED`, refill timing, per-device isolation.
- helper-install.test.ts — detection, pending confirmation, install runs only post-confirmation, and rejection leaves a clean record (error path).

## Do not

- Do not invent bb approval metadata, a per-tool approval prompt, or any bb-source change; the ADR verdict is stop-and-report.
- Do not let `--confirm`-style flags, environment variables, or plan text mint or substitute for a grant.
- Do not implement a second device-arbitration mechanism beside WP-88.
- Do not spread destructive enforcement across handlers as copied snippets — one mechanism, consumed at one seam.
- Do not silently install anything on the host.
- Do not register agent tools, CLI, or directives here; WP-96 wires the guards into handlers.

## Open questions

1. What turn-identity evidence does the tool execution context actually expose (turn id, triggering message id)? If none, the grant's turn scoping falls back to short expiry plus single use, and the gap is documented in the feasibility verdict rather than papered over.
2. Whether session-scoped tool registration (shape a) is worth shipping in v1 given tools apply at next session start — entering debug mode mid-conversation would not surface tools until a new session. Decide from harness behavior; refusal-gating (shape b) ships regardless.
3. The human-facing mint surface: bench panel arm control vs. a bb interaction/confirmation primitive. Verify what `submitInteraction`/panel RPC can prove about the actor before choosing; the grant must not be mintable from an agent-reachable path.
