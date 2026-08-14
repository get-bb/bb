# WP-87 — Serial console — auto-connect after flash, regex filter, agent read, ~ send

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §2.4, §4.4, §6 · AMENDMENTS AMD-0011, AMD-0013 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-86 · **Blocks:** WP-96
**Produces a FROZEN artifact:** no — implements serial session modules behind the frozen `benchDev.*` contract; the transport helper is a host prerequisite, not a dependency

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/transport.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/session.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/ring-buffer.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/filter.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/transcript.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/fs-serial.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/app/serial-console.tsx
    plugins/bb-plugin-finite-state/lanes/debug-bench/app/serial-send-bar.tsx
    plugins/bb-plugin-finite-state/lanes/debug-bench/serial/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/app/serial-*.test.tsx

WP-88 owns `lanes/debug-bench/register.ts`/`register.app.tsx` and pre-wires the serial RPC seams and console slot to these exact paths; replace its NOT_IMPLEMENTED placeholders in place, or create the modules at these paths if WP-88 has not landed. Do not edit either registration file.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/debug-bench/register.ts, lanes/debug-bench/register.app.tsx, lanes/debug-bench/registry/**, lanes/authoring/**, test/mock-remote/fixtures/\*\*, package.json, pnpm-lock.yaml, or another lane.

## Context

The serial console is unglamorous and used more than anything else in SPEC 08 — **robustness is the feature**. Reconnect, backpressure, and bounded buffers are the acceptance bar; a console that drops the port when the UI lags, or silently loses lines, poisons every debug session built on top of it.

Serial output is **tier D — diagnostic, never evidentiary**. Transcripts never enter `verification_results` and never back an attestation.

The read/send asymmetry is AMD-0013's: **read is free, send is the guarded half.** `fs_serial` read returns bounded recent output to the agent with no gate; send goes to a physical device and sits behind confirmation — in the UI as the `~`-prefixed send path with explicit confirm, on the agent path as a confirmation token in the execution context. Send confirmation is the AMD-0013 confirmation tier, distinct from `fs_flash`'s `destructive` in-turn rule.

No npm serial library exists in the dependency freeze and none is being added. The v1 transport is a supervised host helper subprocess (Python + pyserial — Python is already a host prerequisite for probe scripts) speaking NDJSON over stdio. Per FS-158, missing helper prerequisites produce a serial-lane advisory while the plugin remains running. CI has no serial devices and no Python guarantee: every hardware path skips cleanly.

## What to build

1. Transport interface (`SerialTransport`: open/close/write/data-events/error-events) with the helper-subprocess backend: spawn per session, frame NDJSON, supervise (helper death is a transport event, not a crash), and report helper absence through the serial-lane advisory without changing plugin lifecycle. Port identity comes from the WP-88 device registry (`bench_device` kind `serial`), never a caller-supplied device path.
2. Session lifecycle: open claims the device through WP-88 claim/release; close releases it. Disconnects trigger reconnect with capped exponential backoff and jitter, surfacing state (`connected | reconnecting | closed | unconfigured`) to UI and agent alike; an explicit close stops reconnecting.
3. **Auto-connect after flash**: subscribe to WP-86's flash-completed event and open a session on the flashed device's associated serial port (registry association, falling back to the last-used port) unless a session is already open. Failure to auto-connect is a visible status, not an exception.
4. Ring buffer: bounded in-memory line buffer (default 10,000 lines / 2 MiB, configurable) with a monotonic line cursor. **A slow reader never blocks the port**: overflow drops oldest lines and records an explicit gap marker carrying the dropped count — silent loss is the one unforgivable failure here.
5. Transcript: append raw lines (pre-filter, timestamped) to a per-session file under the plugin data dir. Stated retention policy: per-session size cap (default 50 MiB, rotate), keep the most recent N sessions per device (default 10), older ones deleted on rotation. Caps and counts are configuration, and the policy is documented in the settings surface.
6. Regex filter: a display/read-time filter over lines — applied at the read path, never to what is persisted. Invalid patterns return a typed error with the regex engine's message; filter state is per consumer (UI filter box, `fs_serial` filter arg), not global.
7. `fs_serial` service (registered by WP-96): read mode takes `{device, cursor?, filter?, maxLines?}` and returns bounded lines from the ring buffer with the next cursor and any gap markers, WP-57 budget rules applied. Send mode takes `{device, data, confirmation}` and refuses without a valid confirmation token — `SEND_CONFIRMATION_REQUIRED`, fail-closed. Send appends what was sent to the transcript, marked as outbound.
8. Console UI: virtualized live tail with pause/resume (pause stops rendering, not capture), filter box, gap indicators, connection status chip, and the send bar with `~` semantics — input prefixed `~` goes to the device after an explicit inline confirm; anything else is inert. Four designed states; theme tokens and Hugeicons; monospace output.
9. Realtime: publish `serial:changed` `{deviceId, cursor}` as a tiny throttled refetch hint; the UI pulls ranges through the paged RPC. Never stream line data over realtime.

## Interface contract

    export type SerialSessionState = "connected" | "reconnecting" | "closed" | "unconfigured";

    export interface SerialReadResult {
      lines: Array<{ cursor: number; at: string; dir: "rx" | "tx"; text: string }>;
      nextCursor: number;
      gaps: Array<{ afterCursor: number; dropped: number }>;
      state: SerialSessionState;
    }

    export interface SerialTransport {
      open(port: SerialPortRef, options: { baud: number }): Promise<void>;
      write(data: Uint8Array): Promise<void>;
      close(): Promise<void>;
      onData(handler: (chunk: Uint8Array) => void): void;
      onClosed(handler: (reason: string) => void): void;
    }

    export function openSession(ctx: BenchContext, deviceId: string, opts?: { baud?: number }): Promise<SerialSession>;
    export function readSerial(
      ctx: BenchContext,
      req: { device: string; cursor?: number; filter?: string; maxLines?: number },
    ): Promise<SerialReadResult>;                                   // free — no gate
    export function sendSerial(
      ctx: BenchContext,
      req: { device: string; data: string; confirmation: SendConfirmation },
    ): Promise<{ bytes: number }>;                                  // guarded — fail-closed

RPC names/shapes come from the frozen AMD-0011 `benchDev.*` group (session metadata, paged reads); transcript bytes beyond the ring buffer serve over `bb.http`, not RPC.

## Acceptance criteria

- [ ] After a successful WP-86 flash, a session auto-connects to the associated port without user action; failure shows as status, not an error dialog.
- [ ] A reader stalled for the length of a full buffer turnover loses lines only into an explicit gap marker with an accurate dropped count; the port reader never blocks.
- [ ] Helper death and cable disconnect both produce `reconnecting` with capped backoff, then recover or land `closed` with reason; explicit close never auto-reopens.
- [ ] `fs_serial` read is unguarded and bounded; send without a confirmation token fails closed before any byte reaches the transport.
- [ ] Regex filtering never affects the transcript or ring-buffer contents; an invalid pattern is a typed, recoverable error.
- [ ] Transcript rotation enforces the stated size/session caps; outbound sends are recorded and marked.
- [ ] No serial artifact, transcript, or read result ever enters `verification_results` or any attestation path.
- [ ] Helper/Python absent ⇒ typed serial-lane advisory end to end while plugin status remains running; CI (no serial devices, no helper) passes with hardware tests skipped cleanly.
- [ ] Console UI is virtualized with all four designed states, tokens, and Hugeicons; realtime carries hints only.

## Test plan

Fake transport: an in-process `SerialTransport` scripted with data bursts, disconnects, and helper-death — the unit under test is everything above the transport. One helper-protocol test drives the real subprocess framing against a stub stdio script.

- ring-buffer.test.ts — overflow with accurate gap accounting, cursor monotonicity across gaps, burst larger than the whole buffer (**error path**), memory bound holds.
- session.test.ts — reconnect backoff and cap, explicit close stops reconnects, claim/release invoked exactly once per lifecycle, auto-connect on flash event and already-open no-op.
- filter.test.ts — filter isolation from persistence, invalid regex typed error (**error path**), per-consumer filter state.
- fs-serial.test.ts — bounded read with cursor resume and gaps in payload, budget clamp, send with token, send without token fails closed with no transport write (**safety error path**).
- transcript.test.ts — rotation at cap, per-device session retention, outbound marking, transcript survives session crash.
- serial-console.test.tsx — pause/resume semantics, gap indicator rendering, `~` send confirm flow, four states.

## Do not

- Do not add a serial npm dependency; the transport is a host-prerequisite helper whose absence is reported through the serial-lane advisory.
- Do not let send bypass confirmation from any path — UI, CLI, or agent — and do not gate read.
- Do not drop lines silently, apply filters to persisted data, or stream line content over realtime.
- Do not accept caller-supplied device paths; devices resolve through the WP-88 registry only.
- Do not feed serial output into verification results, attestations, or anything evidentiary — tier D stays diagnostic.
- Do not register agent tools, mentions, directives, or CLI; WP-96/WP-64 consume the exported services.

## Open questions

1. The helper protocol (NDJSON over stdio, one process per session) versus one multiplexing daemon per machine: per-session is simpler and matches claim semantics, but N sessions cost N Python processes. Revisit when decision 9.5's bb-host transport lands, since the fleet path likely forces the daemon shape.
2. SEGGER RTT: §4.4 mentions "serial/RTT history" in the same breath. RTT needs the debug probe (WP-89's territory), so v1 scope here is UART-serial only — confirm that split with the WP-89 owner so the console UI's source selector doesn't foreclose it.
3. Baud/framing configuration source: registry-device default, project config, or per-open override — pick one precedence order and document it before the CLI (`serial [--filter RE]`) freezes flags.
