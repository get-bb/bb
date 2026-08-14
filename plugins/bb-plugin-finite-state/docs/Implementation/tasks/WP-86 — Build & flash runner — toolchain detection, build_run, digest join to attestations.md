# WP-86 — Build & flash runner — toolchain detection, build_run, digest join to attestations

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.4, §5, §6, decision 9.3 · SPEC 05 (attestation subject binding, via WP-52) · AMENDMENTS AMD-0010, AMD-0013 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-71 · **Blocks:** WP-87, WP-95, WP-96
**Produces a FROZEN artifact:** no — implements repositories over the frozen AMD-0010 `build_run` table and consumes the AMD-0013 `destructive` primitive whose enforcement mechanism WP-90 owns

## Files you own

    plugins/bb-plugin-finite-state/lanes/authoring/register.ts
    plugins/bb-plugin-finite-state/lanes/authoring/build/toolchain.ts
    plugins/bb-plugin-finite-state/lanes/authoring/build/runner.ts
    plugins/bb-plugin-finite-state/lanes/authoring/build/flash.ts
    plugins/bb-plugin-finite-state/lanes/authoring/build/runs-store.ts
    plugins/bb-plugin-finite-state/lanes/authoring/build/logs.ts
    plugins/bb-plugin-finite-state/lanes/authoring/build/**/*.test.ts

The registration file replaces WP-71's authoring backend stub and wires frozen `authoring.*` RPC seams and the log-tail HTTP route to lane modules. It exports `fs_build`/`fs_flash` action services for WP-96 and command handlers for WP-64; it registers neither surface itself.
Where WP-85 (`citations/**`, `cite-write.ts`, app files) and WP-95 (`workflows/**`) modules do not exist yet, create only compiling NOT_IMPLEMENTED placeholders at their exact future-owned paths; those WPs replace them in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/bench/**, lanes/debug-bench/**, test/mock-remote/fixtures/\*\*, package.json, pnpm-lock.yaml, or another lane.

## Context

Build and flash are **local subprocess jobs**. Nothing here calls Platform, Assurance Studio, or Forge; toolchains (`arm-none-eabi-gcc`, cmake/ninja, `west`, vendor flashers) are host prerequisites bb cannot ship. **No toolchain is not an error — it is a scoped unavailable advisory**: per FS-158, detection leaves the plugin running and only dependent authoring consumers degrade. Plugin-global `needsConfiguration` is reserved for missing required credentials. CI has no toolchains; tests run against fixture scripts and skip real-tool paths cleanly.

`build_run.digest` is the join to SPEC 05: a firmware image built here is the subject of the attestation produced there, which is what makes _"the requirement flipped to verified because THIS build passed"_ a true statement rather than a narrative one. The digest is computed from the artifact bytes at build completion and never backfilled or reused across runs.

**Flash is destructive.** Under AMD-0013/decision 9.3 it executes only on an explicit human instruction in the current turn — intent inherited from an approved plan does not count. The enforcement mechanism (how the token is minted and threaded through the execution context) is WP-90's; **this WP's flash entry point must consume it**, refusing to run without a valid destructive-confirmation token, fail-closed from day one even while WP-90 is unbuilt. `fs_build` and `fs_flash` are ACTION tools in the amended nine-tool union — implemented here as services, registered through the agentic seam by WP-96, never by this lane.

## What to build

1. Replace the authoring backend registration stub; wire `authoring.*` build/flash/run-history RPC seams, the log-tail `bb.http` route, and background job supervision. Export action services and CLI handlers; create WP-85/WP-95 placeholders.
2. Toolchain detection: a data-driven probe table (binary name, version command, parse) evaluated against the host, cached with explicit re-detect. Result is a typed report — found toolchains with versions, missing ones with what they unlock. Missing ⇒ typed authoring-lane advisory on dependent surfaces while plugin status remains running; never a thrown error, never an auto-install.
3. Build runner: spawn the configured build command as a local subprocess with a bounded environment and the worktree root from the verified execution context (never process cwd). Capture interleaved stdout/stderr to a log file under the plugin data dir; enforce a wall-clock timeout and kill process trees cleanly on cancel.
4. `build_run` repository over the exact frozen AMD-0010 table: kind `build|flash`, target, toolchain, status, artifact path, digest, log_path, started_at. Transactional status transitions; on plugin restart, rows stuck `running` with a dead pid are marked failed with an `orphaned` reason — never left running forever, never deleted.
5. Digest: stream SHA-256 over the produced firmware image at build success and store it on the row. Multi-artifact builds record the configured primary image (see open question 2). The digest is what WP-52's attestation subject binding compares against; treat it as immutable evidence.
6. Flash entry point: resolves the target device (WP-88 registry when present, explicit port/probe config otherwise) and refuses to run without the destructive-confirmation token in the execution context — error `DESTRUCTIVE_CONFIRMATION_REQUIRED` with a hint naming the in-turn rule. The human CLI path (WP-64's `flash --confirm`) supplies its own explicit confirmation; the agent path supplies WP-90's token. There is no third path.
7. Tool-result shaping per WP-57: `fs_build` returns status, run id, duration, digest, and **the diagnostic that matters** — first error with file/line — never a full log dump. `fs_flash` returns status, device, image digest. Log access is by run id through the paged RPC and the HTTP tail route.
8. Live tail: the log route serves byte ranges from the log file; `build:changed` publishes `{runId, status, logBytes}` as a tiny refetch hint after committed writes — the log streams over HTTP, not realtime.
9. On flash success, record the run and emit the internal flash-completed event (run id, device, digest) that WP-87 consumes for serial auto-connect.
10. Paged run-history RPC `{items, total, cursor}` with kind/status filters, newest first.

## Interface contract

    export interface ToolchainReport {
      found: Array<{ id: string; version: string; path: string }>;
      missing: Array<{ id: string; unlocks: "build" | "flash" }>;
      configured: boolean;                 // false ⇒ lane-scoped advisory
    }

    export interface BuildRunRecord {
      runId: string;
      kind: "build" | "flash";
      target: string | null;
      toolchain: string | null;
      status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
      artifact: string | null;             // worktree-relative image path
      digest: string | null;               // sha256 — SPEC 05 attestation subject join
      logPath: string;
      startedAt: string;
    }

    export function detectToolchains(ctx: AuthoringContext): Promise<ToolchainReport>;
    export function runBuild(ctx: AuthoringContext, req: { target?: string }): Promise<BuildRunRecord>;
    export function runFlash(
      ctx: AuthoringContext,
      req: { runId?: string; device?: string; confirmation: DestructiveConfirmation },
    ): Promise<BuildRunRecord>;
    export function onFlashCompleted(handler: (e: { runId: string; device: string; digest: string }) => void): void;

    -- Frozen AMD-0010 relational contract; do not migrate a duplicate:
    build_run(run_id, kind, target, toolchain, status, artifact, digest, log_path, started_at)

`DestructiveConfirmation` is WP-90's type, stubbed here as an opaque validated token; this WP validates presence and rejects absence — it never mints one.

## Acceptance criteria

- [ ] With no toolchain on the host, detection reports `configured: false`, dependent RPCs return the unconfigured state, and nothing throws or auto-installs.
- [ ] A failed build stores status, log path, and the extracted first diagnostic; the tool result contains the diagnostic, not the log.
- [ ] A successful build's `digest` equals an independently computed SHA-256 of the artifact, and historical rows never adopt a newer digest.
- [ ] Flash without a destructive-confirmation token fails closed with `DESTRUCTIVE_CONFIRMATION_REQUIRED` before any subprocess spawns.
- [ ] Rows stuck `running` after a simulated crash are marked failed/orphaned on next registration, with prior log evidence intact.
- [ ] Log bytes travel over the HTTP route; realtime carries only tiny refetch hints, published after commit.
- [ ] Run history is paged `{items, total, cursor}`; real SQLite everywhere; the four-command plugin gate passes on a toolchain-less machine (CI-equivalent).
- [ ] No agent-tool, CLI, mention, or directive registration exists in this lane.

## Test plan

Fixture toolchain: committed shell scripts that emulate a compiler/flasher (success, failure with realistic diagnostics, hang) so CI needs no real toolchain.

- toolchain.test.ts — probe table against fixtures, absent binary ⇒ `configured: false`, version parse failure handled as missing (**error path**), re-detect invalidation.
- runner.test.ts — success with digest, failure with first-diagnostic extraction, timeout kills the process tree, cancel mid-run, log file completeness.
- flash.test.ts — token present succeeds against the fixture flasher; token absent fails closed with no subprocess spawn (**safety error path**); flash-completed event payload.
- runs-store.test.ts — transactional transitions, orphan recovery on restart, paged history filters, digest immutability.
- logs.test.ts — HTTP range tail, run-scoped access only (no caller paths), missing log file yields a diagnosable error, not a blank stream.

## Do not

- Do not treat a missing toolchain as an error, auto-install anything, or shell out to package managers.
- Do not let flash run on plan-inherited intent, a stored preference, or any path lacking the in-turn confirmation.
- Do not backfill, recompute, or reuse digests across runs — the attestation join depends on run-bound immutability.
- Do not return log dumps through RPC or tool results, and never write build artifacts or logs into git.
- Do not create a second run table or bench-tier semantics here; builds are not verification evidence until SPEC 05 attests them.
- Do not register agent tools, mentions, directives, or CLI; WP-96/WP-64 consume the exported services.

## Open questions

1. The exact `DestructiveConfirmation` shape and how the execution context carries it is WP-90's to freeze; this WP ships against an opaque-token interface and must be revisited in the same review that lands WP-90's mechanism and test.
2. Multi-image builds (bootloader + app, MCUboot slots): which artifact is "the" digest subject? Working assumption is a configured primary image per target; confirm against SPEC 05's attestation-subject expectations before WP-95 wires the requirement→code workflow.
3. Build-command configuration source (project `.fs` config vs detected build system) — detection can suggest, but the executed command must be explicit and reviewable. Owner ruling needed before agent-invoked builds run unattended.
