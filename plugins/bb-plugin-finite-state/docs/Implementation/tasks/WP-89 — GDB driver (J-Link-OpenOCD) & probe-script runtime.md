# WP-89 — GDB driver (J-Link/OpenOCD) & probe-script runtime

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §2.5, §4.4, §4.4.1 phase 1, §5 (`probe_run`) · AMD-0010, AMD-0013 · decision 9.5 · Master Plan §5.2 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-88 · **Blocks:** WP-90, WP-96
**Produces a FROZEN artifact:** no — consumes the AMD-0010 `bench_device`/`probe_run` tables and exports the GDB and probe execution services that WP-90 gates and WP-96 registers as `fs_probe`

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/gdb/server.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gdb/session.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gdb/mi.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gdb/rtos.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gdb/snapshot.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/probes/store.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/probes/runtime.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/probes/runs.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/gdb/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/probes/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/debug-bench/register.ts and the device registry (WP-88), lib/agentic/registry.ts, package.json, pnpm-lock.yaml, test/mock-remote/fixtures/\*\*, or another lane.

## Context

This is phase 1 of the instrument bridge: GDB over a J-Link or OpenOCD GDB server against a claimed `bench_device`, plus the probe-script runtime that makes agent debugging inspectable. The agent writes Python probe scripts to `.fs/bench/probes/` — source, git-tracked, diffable — and runs them via the exported probe service. A probe that found a bug once becomes a regression test; an opaque tool call is gone the moment it returns.

Everything host-side is a prerequisite bb cannot ship: a Python 3 runtime, `arm-none-eabi-gdb`/`gdb-multiarch`, and OpenOCD or the J-Link tools. Per FS-158, missing prerequisites produce a debug-bench lane advisory while the plugin remains running; plugin-global `needsConfiguration` is reserved for missing required credentials. CI has no hardware and no Python instrument stack, so every test must skip or use transcript fixtures when the prerequisites are absent. There are no new npm dependencies — the GDB/MI protocol is parsed in TypeScript.

Non-destructive by default (SPEC 08 §4.4): nothing in this WP may reset, erase, or flash a target. Register/memory reads, breakpoints, RTOS task walking, and the live snapshot are read-mostly; destructive monitor commands are refused at the runtime layer with a deny-by-default filter. WP-90 supplies the only path that can ever lift that refusal. Tier D output is diagnostic, never evidentiary: nothing here writes `verification_results` or produces attestations.

## What to build

1. GDB-server lifecycle: launch OpenOCD or `JLinkGDBServer` for a claimed device using argv arrays (never a shell), with target-config selection, bounded stdout/stderr capture, health probing, and clean teardown on dispose/abort. The device's `connection` string and transport come from the WP-88 registry row.
2. A GDB/MI3 session over the server: spawn gdb in MI mode, parse MI records in `mi.ts` (typed result/async/stream records, tolerant of interleaving), and expose typed operations — breakpoint set/delete, register read, bounded memory read, backtrace, halt/continue.
3. RTOS task-list walking: use the GDB server's RTOS awareness (OpenOCD `-rtos`, J-Link RTOS plugin) when configured; fall back to symbol-driven walking for FreeRTOS and Zephyr when the ELF is available. Report which method produced the list.
4. Live target snapshot without reset: attach, briefly halt (or use non-stop reads where the server supports it), collect registers, stack, RTOS tasks, and selected memory regions, then resume. The snapshot record states exactly what perturbation occurred (halt duration, or none).
5. Probe store: create/read probe scripts under `.fs/bench/probes/<name>.py` with segment-safe, rooted path validation on the name. Each script carries a structured docstring header (hypothesis, devices, expected discriminating observation) that the store parses.
6. Probe runtime: execute a script in a Python subprocess with a device-handle API bound only to the devices in the run request, each verified against a live WP-88 claim before launch. Inject the GDB session handle; enforce a wall-clock timeout and an AbortSignal.
7. Deny-by-default command filter in the runtime bridge: `monitor reset`, erase, flash, and fuse operations are refused with a `DESTRUCTIVE_REQUIRES_GRANT` error naming the WP-90 path. The filter is on the TypeScript side of the bridge, not in the Python helper, so a script cannot bypass it.
8. Record every execution as a `probe_run` row: script path, devices JSON, hypothesis, outcome (`confirmed|refuted|inconclusive`), artifact paths, started/finished. Artifacts (captures, traces, CSV) land under the gitignored bench artifact root, not in git; only scripts are source.
9. Per-session hardware I/O throttling hooks (token bucket around GDB commands and probe device calls) with limits injected as deps; WP-90 owns the policy values.
10. Detect prerequisites (python3, gdb, OpenOCD/J-Link) and report a typed debug-bench advisory with per-tool remediation without changing plugin lifecycle; export `openGdbSession` and `runProbe` for WP-90/WP-96. Do not register agent tools, CLI, or panels here.

## Interface contract

    export type GdbServerKind = "openocd" | "jlink";

    export interface GdbSession {
      readonly deviceId: string;
      readonly serverKind: GdbServerKind;
      setBreakpoint(location: string): Promise<BreakpointRef>;
      readRegisters(): Promise<Record<string, string>>;
      readMemory(addr: string, bytes: number): Promise<Uint8Array>;   // bounded, ≤64 KiB per call
      backtrace(): Promise<StackFrame[]>;
      rtosTasks(): Promise<{ method: "server" | "symbols"; tasks: RtosTask[] }>;
      dispose(): Promise<void>;
    }

    export interface TargetSnapshot {
      deviceId: string;
      takenAt: string;
      perturbation: { halted: boolean; haltMs: number | null };
      registers: Record<string, string>;
      frames: StackFrame[];
      tasks: RtosTask[];
      memoryRegions: Array<{ addr: string; bytes: number; artifactPath: string }>;
    }

    export interface ProbeRunRequest {
      scriptPath: string;                 // relative, under .fs/bench/probes/
      deviceIds: string[];
      hypothesis: string;
      timeoutMs: number;
    }

    export interface ProbeRunRecord {
      runId: string;
      scriptPath: string;
      deviceIds: string[];
      hypothesis: string;
      outcome: "confirmed" | "refuted" | "inconclusive";
      artifacts: string[];
      startedAt: string;
      finishedAt: string | null;
    }

    export function openGdbSession(deps: DebugBenchDeps, deviceId: string, claim: DeviceClaim, signal: AbortSignal): Promise<GdbSession>;
    export function snapshotTarget(session: GdbSession): Promise<TargetSnapshot>;
    export function runProbe(deps: DebugBenchDeps, request: ProbeRunRequest, claims: DeviceClaim[], signal: AbortSignal): Promise<ProbeRunRecord>;

`DeviceClaim` is WP-88's exported claim type; do not redeclare it. Publish `probe:changed` as a refetch hint only; run detail is served by the WP-88-registered paged RPC from the `probe_run` table.

## Acceptance criteria

- [ ] A GDB session cannot open, and a probe cannot run, against a device without a live WP-88 claim held by the caller.
- [ ] All subprocess launches use argv arrays; no shell interpolation anywhere, including paths originating from probe scripts.
- [ ] The snapshot path never issues reset; the record states the exact perturbation, proven against a scripted fake GDB server transcript.
- [ ] Destructive monitor commands from a probe script are refused with `DESTRUCTIVE_REQUIRES_GRANT` before any byte reaches the GDB server.
- [ ] Every probe execution persists a `probe_run` row with outcome and artifacts; artifacts are outside git and scripts are inside it.
- [ ] Probe script names/paths cannot escape `.fs/bench/probes/`; traversal and absolute paths are rejected.
- [ ] Missing python3/gdb/OpenOCD/J-Link degrades the dependent debug-bench surface with a named-remediation advisory while plugin status remains running, never a crash.
- [ ] The full suite is green in CI with no Python, no gdb, and no hardware present; hardware-dependent tests skip cleanly and visibly.
- [ ] No agent tool, CLI command, directive, or panel is registered here; nothing writes `verification_results` or attestations.

## Test plan

- mi.test.ts — golden MI transcripts (breakpoint, registers, memory, backtrace), interleaved async records, malformed record recovery, and truncated stream mid-record.
- server.test.ts — argv construction for OpenOCD and J-Link, missing binary → scoped unavailable advisory (degraded path), nonzero exit with bounded stderr, and teardown kills the process tree on abort.
- session.test.ts — fake GDB server fixture: connect, typed operations, memory read over the 64 KiB bound rejected, RTOS fallback selection, and refusal without a claim (error path).
- runtime.test.ts — fixture probe scripts: happy path with artifacts, destructive command refusal (safety error path), timeout kill, device-handle limited to requested claims, and outcome persisted on script exception as `inconclusive` with the error captured.
- store.test.ts — docstring header parse, traversal/absolute/NUL name rejection, and idempotent re-write of an unchanged script.

## Do not

- Do not implement debug-mode gating, the destructive grant, or rate-limit policy values — WP-90 owns them; you expose the seams.
- Do not add npm dependencies; MI parsing is local TypeScript and Python-side helpers are host prerequisites.
- Do not auto-install Python helper libraries; installation-with-confirmation is WP-90's rail.
- Do not run a probe against an unclaimed device or let a script reach devices outside its request.
- Do not write probe artifacts into git or probe scripts into the artifact cache.
- Do not treat a probe outcome as verification evidence or surface it to the SPEC 03 matrix.

## Open questions

1. GDB/MI parsing in TypeScript vs. driving gdb through a Python `pygdbmi` helper: TS keeps the deny filter and parsing on our side of the boundary and avoids a Python dependency for pure GDB work — confirm MI3 quirks of `gdb-multiarch` builds we actually target before freezing `mi.ts` shapes.
2. The exact bench artifact root (`.fs-bench/` sibling to `.fs-firmware/`, or a subtree the WP-88 lane already declared) — take it from WP-88's layout helper and verify its gitignore the way WP-47 verifies `.fs-firmware`.
3. Whether J-Link RTOS-plugin task lists and OpenOCD `-rtos` output can be normalized into one `RtosTask` shape or need per-server fields; decide from real transcripts, not documentation.
