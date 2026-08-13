# WP-92 — Logic analyzer driver (Saleae, Digilent)

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §2.5, §4.4.1 phase 2 · decisions 9.5, 9.6 · AMD-0010 (`bench_device`, `probe_run`) · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-88 · **Blocks:** WP-93, WP-94 (interface only — all three drivers remain independently deferrable)
**Produces a FROZEN artifact:** no — owns the lane-shared `InstrumentDriver` interface that WP-93/94 implement; changing it after they land follows ordinary cross-WP coordination, not an amendment

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/driver.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/transport.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/logic/saleae.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/logic/digilent.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/logic/decode.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/logic/fixtures/**
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/driver.test.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/instruments/logic/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/debug-bench/register.ts and the device registry (WP-88), lanes/debug-bench/gating/** (WP-90), package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

Phase 2 of the instrument bridge: bus-level truth. This WP also establishes the one `InstrumentDriver` interface every instrument in the lane implements (WP-93 power, WP-94 scope), so vendor choices stay implementation details. Per decision 9.5 the interface takes a **transport** — local USB, local network, or a bb host — because the same probe script must run on a desk and, later, on a rack. Per decision 9.6 the production bench is deferred and `instro` stays out of this lane, but the interface must not foreclose it: nothing in `driver.ts` may assume USB, a local process, or the debug-bench instrument categories.

Vendor backends: Saleae via `logic2-automation` (a Python gRPC client that talks to a running Logic 2 application) and Digilent via `dwfpy` over WaveForms. Both are host-side Python prerequisites behind `needsConfiguration` — never npm dependencies, never silently installed (WP-90's confirmation rail). CI has no hardware and no Python instrument stack, ever: every capture and decode test runs against recorded replay fixtures, and live-hardware tests are opt-in and skip cleanly.

Captures land as `probe_run` artifacts in the gitignored bench artifact root, so a logic capture taken during a WP-89 probe is attached to the run's hypothesis and outcome. Everything here is tier D: diagnostic, never evidentiary — no `verification_results`, no attestations.

## What to build

1. `driver.ts` — the shared interface: transport-typed open/detect, claim-verified sessions (WP-88's `DeviceClaim` is a required parameter to `open`), capability description, capture with AbortSignal, and typed close. Keep it category-agnostic: capabilities are declared data, not subclasses, so a PSU or DMM driver fits later without interface change.
2. `transport.ts` — the transport union and its resolution: `usb` (host-local device path/serial), `lan` (host/port), `bb-host` (hostId + remote invocation seam). v1 implements `usb` and `lan` end to end; `bb-host` must typecheck and fail with `TRANSPORT_NOT_IMPLEMENTED`, not be absent.
3. The Saleae backend: drive `logic2-automation` through a supervised Python subprocess (argv arrays, no shell), configure digital channels/sample rate, run bounded captures, export raw + decoded data to artifact files.
4. The Digilent backend over `dwfpy`: same session/capture surface, device enumeration reconciled against the WP-88 registry rather than a second discovery store.
5. Protocol decode in `decode.ts`: SPI, I²C, UART, and CAN at minimum — prefer the vendor's own decoders (Logic 2 analyzers, WaveForms protocol interpreters) and normalize their output into one framed shape; only fall back to local decoding where a vendor path does not exist. Decoded frames are paged, never returned unbounded.
6. Replay fixtures: recorded capture sessions (vendor-format exports plus expected decoded frames) checked into `fixtures/`, with a replay backend implementing `InstrumentDriver` so the whole stack — session, capture, decode, artifact writing — runs in CI with no hardware.
7. Prerequisite detection per backend (Python package present, Logic 2 reachable, WaveForms runtime present) behind distinct `needsConfiguration` keys with named remediation.
8. Artifact plumbing: captures and decode outputs recorded as `probe_run` artifact paths via WP-89's runs module; publish `probe:changed` refetch hints only.

## Interface contract

    export type InstrumentTransport =
      | { kind: "usb"; serial: string | null; path: string | null }
      | { kind: "lan"; host: string; port: number }
      | { kind: "bb-host"; hostId: string; remotePath: string };

    export interface InstrumentCapabilities {
      kind: "logic" | "power" | "scope" | "probe" | "serial" | string;   // open set — decision 9.6
      channels: number;
      maxSampleRateHz: number | null;
      features: readonly string[];        // e.g. "decode:i2c", "trigger:edge"
    }

    export interface InstrumentSession {
      readonly deviceId: string;
      readonly capabilities: InstrumentCapabilities;
      capture(config: CaptureConfig, signal: AbortSignal): Promise<CaptureArtifact>;
      close(): Promise<void>;
    }

    export interface InstrumentDriver {
      readonly id: string;                                     // "saleae-logic2", "digilent-dwf", ...
      detect(transport: InstrumentTransport): Promise<InstrumentCapabilities | null>;
      open(transport: InstrumentTransport, claim: DeviceClaim, signal: AbortSignal): Promise<InstrumentSession>;
      prerequisites(): PrerequisiteReport;                     // feeds needsConfiguration
    }

    export interface CaptureArtifact {
      path: string;                        // gitignored artifact root
      format: string;                      // vendor export format id
      durationMs: number;
      channels: number;
    }

    export type DecodedProtocol = "spi" | "i2c" | "uart" | "can";
    export function decodeCapture(artifact: CaptureArtifact, protocol: DecodedProtocol, opts: DecodeOptions): Promise<Paged<DecodedFrame>>;

    export const logicDrivers: readonly InstrumentDriver[];    // saleae, digilent, replay-fixture

WP-93 and WP-94 implement `InstrumentDriver` and must not fork or redeclare it; if it needs a change after they land, the change lands here with both consumers reviewed.

## Acceptance criteria

- [ ] One `InstrumentDriver` interface serves logic capture and is demonstrably category-agnostic (the replay backend plus a test double of a non-debug-bench category both implement it unchanged).
- [ ] `open` requires a live WP-88 claim; an unclaimed or foreign-claim open is refused with zero device I/O.
- [ ] All three transport kinds typecheck; `usb` and `lan` work end to end; `bb-host` fails with `TRANSPORT_NOT_IMPLEMENTED`.
- [ ] SPI, I²C, UART, and CAN decode produce the expected framed output on replay fixtures, paged with cursors.
- [ ] Captures attach to `probe_run` rows as artifact paths outside git.
- [ ] Missing vendor SDK / unreachable Logic 2 / missing WaveForms each yield a distinct `needsConfiguration` report, never a crash.
- [ ] CI is green with no hardware and no Python; live-hardware tests are opt-in and skip visibly.
- [ ] No npm dependency added; no silent host installation; nothing evidentiary is written.

## Test plan

- driver.test.ts — interface conformance suite run against the replay backend and both vendor backends' subprocess boundaries (mocked at the process seam, not the DB); claim refusal (safety error path); transport dispatch including `bb-host` refusal.
- saleae.test.ts — argv/gRPC bridge protocol against a scripted fake subprocess, Logic 2 unreachable → `needsConfiguration` (error path), capture cancellation mid-run cleans up the session.
- digilent.test.ts — enumeration reconciled to registry rows, capture bound overrun rejected, device disappearing mid-capture yields a typed `DEVICE_LOST` with a partial artifact preserved (error path).
- decode.test.ts — golden decoded frames for all four protocols, malformed vendor export rejected without crashing, and pagination over a large frame set.
- Integration (opt-in, env-gated) — one real capture per vendor path, asserting the same shapes as the replay fixtures.

## Do not

- Do not bake USB or process-locality assumptions into `driver.ts`; the rack (decision 9.5) and `instro` (decision 9.6) must remain implementable behind it.
- Do not add `instro`, sigrok, or any production-bench category implementation in this WP.
- Do not add npm dependencies or pip-install anything without the WP-90 confirmation rail.
- Do not build a second device discovery/claim store beside WP-88.
- Do not return unbounded capture bytes or frames through RPC or tools; artifacts are paths, frames are paged.
- Do not register agent tools, CLI, or panels here.

## Open questions

1. `logic2-automation` requires the Logic 2 desktop application running; decide whether the driver launches it, or treats "not running" purely as a `needsConfiguration` state with instructions. Leaning the latter — owning a GUI app lifecycle from a plugin is fragile.
2. The exact vendor export formats to standardize on for artifacts (Saleae `.sal` + CSV export vs. raw binary): pick what the decode path and the replay fixtures can both consume, and record the choice in `decode.ts`.
3. Whether the WP-88 `bench_device.kind` vocabulary needs a per-driver `driverId` column or a reconciliation map in this lane; take the registry's existing shape as authoritative and adapt here.
