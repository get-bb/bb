# WP-93 — Power profiler driver (PPK2, Joulescope)

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §2.5, §4.4.1 phase 3 · decisions 9.5, 9.6 · AMD-0010 (`bench_device`, `probe_run`, `build_run`) · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-88 · **Blocks:** — (independently deferrable; WP-96's `fs-instruments` skill references it when present)
**Produces a FROZEN artifact:** no — implements the `InstrumentDriver` interface owned by WP-92 (`instruments/driver.ts`); the scheduling manifest serializes this WP behind WP-92's interface commit

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/power/ppk2.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/power/joulescope.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/power/measure.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/power/correlate.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/power/fixtures/**
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/power/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/debug-bench/instruments/driver.ts and transport.ts (WP-92 — implement, never edit), lanes/debug-bench/register.ts (WP-88), lanes/debug-bench/gating/** (WP-90), package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

Phase 3 of the instrument bridge. Sleep-current regressions are a top defect class in connected products — firmware that works and quietly drains the battery ships all the time — and the questions this driver answers are exactly three: sleep current, boot energy, and active draw correlated to code paths. Vendor backends are the Nordic PPK2 (`ppk2-api`, which also supplies power to the target in source-meter mode) and the Jetperch Joulescope (`joulescope` package). Both are host-side Python prerequisites; never npm dependencies, never silently installed (WP-90's confirmation rail). Per FS-158, missing backends produce instrument-scoped advisories while the plugin remains running.

The driver implements WP-92's `InstrumentDriver` with transport-typed open (decision 9.5) — a power profiler on a rack is the same driver over a `bb-host` transport later. `instro` stays out per decision 9.6 (production bench deferred), and nothing here may foreclose it.

Correlation is what makes a current trace useful: a measurement window tied to what the firmware was doing. v1 correlates by build digest (`build_run.digest` from WP-86, so a trace names the exact image measured) and by time-aligned event marks from serial output or GDB events supplied by the caller. This remains tier D — a "sleep-current regression" found here is a `probe_run` outcome and a finding, never a `verification_results` row or an attestation. CI has no hardware: everything runs on replay fixtures.

## What to build

1. PPK2 backend: subprocess bridge over `ppk2-api` (argv arrays, no shell) implementing `InstrumentDriver` — detect, claim-verified open (WP-88 `DeviceClaim`), sampling session at configured rate, source-meter vs. ampere-meter mode selection, and bounded capture windows with AbortSignal.
2. Joulescope backend over the `joulescope` package: same surface, plus its higher dynamic range metadata in `InstrumentCapabilities.features` so the skill can prefer it for sub-µA sleep floors.
3. `measure.ts` — the three named measurements as typed operations over a session: `sleepCurrent` (windowed statistics: mean/median/p99 over a settle-then-measure protocol), `bootEnergy` (integrate current from a power-on/reset mark to a boot-complete mark), `activeDraw` (windowed profile with summary statistics). Raw sample streams go to artifact files (CSV/binary in the gitignored bench artifact root); RPC and tool surfaces get summaries only.
4. `correlate.ts` — bind a measurement to context: the `build_run` digest of the flashed image (from WP-86's records, joined not recomputed), and an ordered list of event marks `{at, label, source: "serial"|"gdb"|"manual"}` supplied by the caller, so a window like "between `boot_done` and `radio_on`" is expressible and replayable.
5. Baseline comparison for the regression workflow: store a named baseline summary per `{deviceId, measurementKind, buildDigest}`, and a compare operation returning the delta with both summaries — a diagnostic record for the agent to reason over, carrying no pass/fail authority.
6. Replay fixture backend implementing `InstrumentDriver` from recorded sample streams, so measurement math, correlation, and baseline comparison are fully CI-testable.
7. Prerequisite detection per backend behind distinct instrument-advisory keys that never change plugin status; artifacts attach to `probe_run` rows via WP-89's runs module; `probe:changed` refetch hints only; every list/query surface paged.

## Interface contract

    export interface PowerCapture extends CaptureArtifact {
      sampleRateHz: number;
      mode: "source" | "ampere";
      calibration: Record<string, string>;
    }

    export interface MeasurementSummary {
      kind: "sleep_current" | "boot_energy" | "active_draw";
      window: { fromMs: number; toMs: number };
      stats: { mean: number; median: number; p99: number; unit: "uA" | "mA" | "uJ" | "mJ" };
      artifactPath: string;                    // full-resolution trace
      buildDigest: string | null;              // join to build_run / SPEC 05 attestations context
      marks: Array<{ atMs: number; label: string; source: "serial" | "gdb" | "manual" }>;
    }

    export interface BaselineDelta {
      baseline: MeasurementSummary;
      current: MeasurementSummary;
      deltaPct: number;
      diagnostic: true;                        // literally typed: this is never a verdict
    }

    export function measureSleepCurrent(session: InstrumentSession, cfg: SleepMeasureConfig, signal: AbortSignal): Promise<MeasurementSummary>;
    export function measureBootEnergy(session: InstrumentSession, cfg: BootEnergyConfig, signal: AbortSignal): Promise<MeasurementSummary>;
    export function measureActiveDraw(session: InstrumentSession, cfg: ActiveDrawConfig, signal: AbortSignal): Promise<MeasurementSummary>;
    export function compareToBaseline(deps: PowerDeps, baselineId: string, current: MeasurementSummary): Promise<BaselineDelta>;

    export const powerDrivers: readonly InstrumentDriver[];    // ppk2, joulescope, replay-fixture

`InstrumentDriver`, `InstrumentSession`, `InstrumentTransport`, and `CaptureArtifact` come from WP-92's `instruments/driver.ts` unmodified.

## Acceptance criteria

- [ ] Both backends implement WP-92's `InstrumentDriver` unchanged and pass its conformance suite; open without a live WP-88 claim is refused with zero device I/O.
- [ ] Sleep current, boot energy, and active draw produce correct summaries on replay fixtures with known ground truth, including unit handling.
- [ ] A measurement records the `build_run` digest when the caller supplies it and never fabricates one.
- [ ] Event-mark windows select the intended sample ranges, proven against fixtures with embedded marks.
- [ ] Baseline comparison returns a `diagnostic: true` delta; nothing in this lane can write `verification_results` or attestations.
- [ ] Raw traces are artifacts outside git; RPC/tool-facing outputs are bounded summaries; all queries paged.
- [ ] PPK2 source-mode power-on is a target power action and is gated: it requires debug mode (WP-90 guard at the consuming seam) and is refused otherwise.
- [ ] Missing `ppk2-api`/`joulescope` yields distinct instrument-scoped advisories while plugin status remains running; CI passes with no Python and no hardware.
- [ ] No npm dependency; no silent host installation.

## Test plan

- ppk2.test.ts — argv bridge protocol against a scripted fake subprocess, mode selection, missing package → scoped unavailable advisory (degraded path), and abort mid-capture preserves a partial artifact with truncation marked.
- joulescope.test.ts — capability advertisement, sample-stream framing, device lost mid-stream → typed `DEVICE_LOST` (error path).
- measure.test.ts — golden statistics on fixture streams, settle-window exclusion, boot-energy integration between marks, missing boot-complete mark → `INCOMPLETE_WINDOW` rather than a wrong number (error path).
- correlate.test.ts — digest join from a fixture `build_run` row (real SQLite, never mocked), mark ordering validation, and manual marks round-tripping.
- baseline.test.ts — store/compare/delta math, unit mismatch rejected, and comparing across different devices or builds is refused rather than silently normalized (error path).

## Do not

- Do not edit WP-92's `driver.ts`/`transport.ts`; if the interface cannot express a power need, coordinate the change in WP-92 with both consumers reviewed.
- Do not turn baseline deltas into pass/fail verdicts, matrix input, or attestation subjects.
- Do not power-cycle or supply power to a target outside the WP-90-gated path.
- Do not stream raw samples through RPC, tools, or realtime; artifacts are paths, signals are refetch hints.
- Do not add npm dependencies or install Python packages without the confirmation rail.
- Do not register agent tools, CLI, or panels here.

## Open questions

1. Whether PPK2 logic-port digital channels (useful as hardware event marks) are worth wiring in v1, or serial/GDB marks suffice; decide from a real bring-up session, not speculation.
2. Raw trace format for artifacts: CSV is diffable but large at 100 ksps; a compact binary with a small reader in `measure.ts` may be needed. Measure fixture sizes before choosing.
3. The settle-then-measure protocol constants for `sleepCurrent` (settle time, window length) — take initial values from the hardware owner writing the `fs-instruments` skill (WP-96) and keep them config, not code.
