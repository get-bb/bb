# WP-94 — Scope drivers (PicoScope USB, SCPI/LAN)

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §2.5, §4.4.1 phase 5 · decisions 9.5, 9.6 · AMD-0010 (`bench_device`, `probe_run`) · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-88 · **Blocks:** — (independently deferrable; WP-96's `fs-instruments` skill references it when present)
**Produces a FROZEN artifact:** no — implements the `InstrumentDriver` interface owned by WP-92 (`instruments/driver.ts`); the scheduling manifest serializes this WP behind WP-92's interface commit

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/scope/picoscope.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/scope/scpi.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/scope/waveform.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/scope/fixtures/**
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/scope/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/debug-bench/instruments/driver.ts and transport.ts (WP-92 — implement, never edit), lanes/debug-bench/register.ts (WP-88), lanes/debug-bench/gating/** (WP-90), package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

Phase 5 of the instrument bridge: analog integrity. The questions this driver exists to answer are the ones no other tier can see — rail droop under load, signal quality and edge rates on a bus that decodes fine but glitches in the field, ripple, ringing, and the analog face of "works on the bench, fails in the enclosure". Per SPEC 08 §4.5 these are exactly the hypothesis classes a D1/D2 result may never confirm, so this driver is where analog-class escalations from WP-91's cascade land.

Two backends behind WP-92's one `InstrumentDriver` interface. PicoScope over the vendor USB SDK (`picosdk` Python wrappers — scope, logic analyzer, and signal generator in one box). Siglent-class bench scopes over SCPI/LAN with **PyVISA as the transport floor** (`pyvisa` + `pyvisa-py`), so any SCPI scope is reachable and the `lan` transport from decision 9.5 is exercised for real. Both stacks are host-side Python prerequisites; never npm dependencies, never silently installed (WP-90's confirmation rail). Per FS-158, their absence produces backend-scoped advisories while the plugin remains running. `instro` stays out per decision 9.6 — its scope support is explicitly unstable and the production bench is deferred — but nothing here may foreclose adding it behind the same interface later.

CI has no hardware and no Python instrument stack: waveform math and both backend protocols are tested against replay fixtures and scripted fake transports. Captures land as `probe_run` artifacts. Tier D discipline holds: diagnostic, never evidentiary.

## What to build

1. PicoScope backend implementing `InstrumentDriver`: detect over USB, claim-verified open (WP-88 `DeviceClaim`), channel configuration (range, coupling, probe attenuation), edge/threshold triggering, block-mode capture with AbortSignal, and export of raw waveforms to artifact files. Signal-generator output is a target-affecting action: refuse it outside a WP-90-gated path.
2. SCPI/LAN backend: a `scpi.ts` command layer over a PyVISA subprocess bridge (argv arrays, no shell) with a Siglent SDS command dialect as the first concrete profile. Identify via `*IDN?`, map capabilities, configure/trigger/capture, and keep the dialect table data-driven so a second vendor is a table, not a fork.
3. `waveform.ts` — analog integrity measurements over captured waveforms, computed locally and deterministically: rise/fall time between configurable thresholds, overshoot/undershoot, min/max/mean/RMS, peak-to-peak ripple, and a windowed rail-droop measure (baseline vs. loaded window, using the same event-mark scheme as WP-93's `correlate.ts`). Full-resolution waveforms are artifacts; RPC/tool surfaces get bounded summaries and downsampled previews, paged.
4. Trigger-timeout semantics: a capture that never triggers returns `TRIGGER_TIMEOUT` with the armed configuration — an honest "the edge you predicted did not occur" is itself a discriminating observation for the cascade, distinct from a transport failure.
5. Replay fixture backend implementing `InstrumentDriver` from recorded waveform files, exercising the full path — session, trigger config, capture, measurement, artifact write — in CI.
6. Prerequisite detection per backend (picosdk wrappers present and the PicoSDK C libraries they bind; `pyvisa` with a working backend) under distinct lane-advisory keys with named remediation; none changes plugin status.
7. Artifacts attach to `probe_run` rows via WP-89's runs module; `probe:changed` refetch hints only; every list/query surface paged.

## Interface contract

    export interface ScopeCapture extends CaptureArtifact {
      channelConfigs: Array<{ channel: string; rangeV: number; coupling: "ac" | "dc"; attenuation: number }>;
      trigger: { channel: string; edge: "rising" | "falling"; levelV: number } | null;
      sampleRateHz: number;
      samples: number;
    }

    export interface WaveformMeasurement {
      kind: "rise_time" | "fall_time" | "overshoot" | "undershoot" | "vpp_ripple" | "rail_droop" | "stats";
      channel: string;
      value: number;
      unit: "ns" | "us" | "mV" | "V" | "pct";
      window: { fromMs: number; toMs: number } | null;
      artifactPath: string;
    }

    export interface ScpiProfile {
      readonly vendor: string;                       // "siglent-sds"
      readonly commands: Readonly<Record<string, string>>;   // dialect table, data not code
      parseWaveform(raw: Uint8Array): WaveformData;
    }

    export function measureWaveform(capture: ScopeCapture, req: MeasurementRequest): Promise<WaveformMeasurement[]>;
    export function downsampleForPreview(capture: ScopeCapture, maxPoints: number): Promise<PreviewSeries>;

    export const scopeDrivers: readonly InstrumentDriver[];   // picoscope, scpi-lan, replay-fixture

`InstrumentDriver`, `InstrumentSession`, `InstrumentTransport`, and `CaptureArtifact` come from WP-92's `instruments/driver.ts` unmodified. The SCPI backend is the lane's reference implementation of the `lan` transport.

## Acceptance criteria

- [ ] Both backends implement WP-92's `InstrumentDriver` unchanged and pass its conformance suite; open without a live WP-88 claim is refused with zero device I/O.
- [ ] The SCPI backend runs over the `lan` transport end to end against a scripted fake VISA endpoint; the dialect is a data table, demonstrated by adding a second profile in tests without code changes.
- [ ] Rise/fall, overshoot, ripple, and rail-droop measurements match ground truth on fixture waveforms within stated tolerances.
- [ ] `TRIGGER_TIMEOUT` is distinguishable from transport failure and carries the armed configuration.
- [ ] Signal-generator output cannot be enabled outside the WP-90-gated path.
- [ ] Full waveforms are gitignored artifacts; RPC/tool outputs are bounded, downsampled, and paged.
- [ ] Missing picosdk/PyVISA stacks yield distinct backend-scoped advisories while plugin status remains running; CI passes with no Python and no hardware.
- [ ] No npm dependency; no silent host installation; nothing evidentiary is written.

## Test plan

- picoscope.test.ts — subprocess bridge protocol against a scripted fake, channel/trigger configuration echo, capture abort cleanup, missing SDK → scoped unavailable advisory (degraded path), and signal-generator refusal without the gate (safety error path).
- scpi.test.ts — `*IDN?` identification and capability mapping, command/response sequencing against a fake VISA endpoint, connection drop mid-capture → typed `DEVICE_LOST` (error path), malformed waveform payload rejected without crashing.
- waveform.test.ts — golden measurements on synthetic waveforms with known rise times and droop, threshold-configuration edge cases, and downsampling preserves extremes (min/max envelope) rather than aliasing them away.
- trigger.test.ts — trigger fires, trigger timeout (error path with configuration echo), and re-arm after timeout.
- Integration (opt-in, env-gated) — one real capture per backend asserting fixture-identical shapes.

## Do not

- Do not edit WP-92's `driver.ts`/`transport.ts`; interface gaps route through WP-92 with all consumers reviewed.
- Do not implement `instro` or any production-bench category here; keep the door open, not the code.
- Do not enable outputs (signal generator, AWG) outside the WP-90-gated path — a scope that drives a pin is an actuator.
- Do not stream raw waveforms through RPC, tools, or realtime; artifacts are paths, previews are bounded, signals are refetch hints.
- Do not add npm dependencies or install Python packages without the confirmation rail.
- Do not register agent tools, CLI, or panels here, and do not write anything evidentiary.

## Open questions

1. Which PicoScope driver generation to target first (`ps2000a` vs. the newer `psospa` API) — pick from the hardware actually on the Eagle bench, and keep the generation behind the backend so a second one is additive.
2. Whether waveform math runs in TypeScript (decoded arrays crossing the subprocess boundary) or Python-side with only summaries crossing; decide by measuring a realistic 10 M-sample capture, not by preference.
3. PyVISA resource discovery (`lan` instrument enumeration) versus WP-88's registry ownership of discovery — the registry owns the device list; confirm how a user-entered SCPI address becomes a `bench_device` row without this lane growing a discovery store.
