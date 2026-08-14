# WP-65 — Golden Loop E2E harness

**Lane:** L8 Demo & E2E · **Spec:** SPEC 06 §6–9 · Master Plan G3/G4 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** G3 (all production surfaces, sync, action services, and agentic registry integrated) · **Blocks:** WP-66, WP-67, WP-68, WP-69, WP-70
**Produces a FROZEN artifact:** no

## Files you own

```
plugins/bb-plugin-finite-state/test/e2e/golden-loop/harness.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/scenario.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/assertions.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/reporter.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/golden-loop.e2e.test.ts
plugins/bb-plugin-finite-state/test/e2e/golden-loop/harness.test.ts
```

## Files you must not touch

Production source, composition roots, frozen interfaces, `test/mock-remote/fixtures/**`, dependencies, or the WP-66 demo corpus. The fixture path is excluded by ownership; the WP-08 freeze is retired.

## Context

The Golden Loop is a product acceptance test, not a narrated video script. The harness must prove each beat from observable state: files, RPC output, tool results, plans, run evidence, UI states, and git commits. It runs in a disposable worktree with deterministic clocks/ids and supports two modes: required `offline` using only warm cache/local mock services, and optional `connected` against a resettable dev tenant/bench. CI never depends on public network, Rekor, or a physical host.

## What to build

1. Define a typed fourteen-beat scenario with setup, action, assertions, artifact capture, and timing per beat. A failure reports the beat and preserves the disposable run directory.
2. Build on `createFakePluginHost({pluginId:"finite-state"})`, app test runtime, and owner-service injection points. Use public RPC/tool/CLI/UI surfaces; do not reach into private implementation merely to make tests pass.
3. Create an isolated temporary git worktree per run from the WP-66 seed. Configure a deterministic test identity and never touch the developer's checkout or global git config.
4. Add a strict network guard in offline mode: unexpected DNS/socket/HTTP calls fail with the caller/beat. Allow only in-process mock transport and loopback resources explicitly owned by the harness.
5. Capture structured artifacts: before/after tree, tool/RPC transcripts with secrets removed, plan JSON, screenshots or rendered DOM snapshots for demo cards, git diff/commit, run evidence, and timing report.
6. Provide deterministic clock, ids, job progression, realtime fanout, and interrupt hooks. Realtime remains a refetch hint; assertions read durable state after each hint.
7. Make the human-only steps used by this loop explicit harness actions (`human.reviewDiff`, `human.resolveConflict`, `human.push`), never agent tools. The harness fails if agent execution reaches those services.
8. Support connected mode only through opt-in environment/config validated at start; skip with a clear reason when unavailable. Never fall back silently from connected to fixture evidence.
9. Emit one machine-readable report and one concise rehearsal report showing pass/fail, duration, offline violations, and the four “oh moment” artifacts.

## Interface contract

```ts
export type GoldenLoopMode = "offline" | "connected";
export type BeatNumber =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14;

export interface BeatResult {
  beat: BeatNumber;
  name: string;
  status: "passed" | "failed" | "skipped";
  startedAt: string;
  durationMs: number;
  assertions: Array<{ name: string; passed: boolean; detail?: string }>;
  artifacts: string[];
}

export interface GoldenLoopHarness {
  readonly mode: GoldenLoopMode;
  readonly worktree: string;
  runBeat(number: BeatNumber): Promise<BeatResult>;
  runAll(): Promise<BeatResult[]>;
  human: {
    reviewDiff(input: unknown): Promise<void>;
    resolveConflict(input: unknown): Promise<void>;
    push(input: unknown): Promise<void>;
  };
  assertNoExternalNetwork(): void;
  preserveOnFailure(): Promise<string>;
}

export const GOLDEN_LOOP_BEATS: readonly {
  number: BeatNumber;
  name: string;
  maxMs: number;
}[];
```

## Acceptance criteria

- [ ] Fourteen ordered beats execute independently and as one scenario in a disposable worktree.
- [ ] Offline mode fails on any undeclared external network request and is the default CI mode.
- [ ] Human-only capabilities cannot be invoked through the agent-tool registry.
- [ ] Assertions use public surfaces and durable state, not test-only truth flags.
- [ ] Failures identify a beat, keep sanitized evidence, and leave the real checkout untouched.
- [ ] Connected mode is explicit, resettable, and never substitutes fixture evidence without disclosure.
- [ ] Report includes durations, evidence paths, and artifacts for beats 5, 7, 11, and 12.
- [ ] Full offline run is budgeted under fifteen minutes and deterministic across two runs.

## Running the offline regression tier

The post-merge/nightly command must force execution so an unchanged commit is
rehearsed again instead of replaying a Turbo cache entry. Set
`GOLDEN_LOOP_EVIDENCE_DIR` to retain both sanitized machine reports, rehearsal
reports, and per-beat artifacts:

```bash
GOLDEN_LOOP_EVIDENCE_DIR=/tmp/finite-state-golden-loop \
  pnpm exec turbo run test --filter=bb-plugin-finite-state --force -- \
  test/e2e/golden-loop/harness.test.ts \
  test/e2e/golden-loop/golden-loop.e2e.test.ts
```

The workflow uploads that directory even when the run is red. A fully skipped
connected-mode preflight is reported as failed, never as a passing rehearsal.

### Round-1 review disposition

- D3, D4, D5, and D6 are closed: the workflow cannot cancel an active nightly
  rehearsal, forces Turbo execution, forwards and uploads the evidence
  directory, unregisters failed worktrees, and reports an all-skipped run as
  failed.
- D1 remains intentionally semantic: production-owned UUID and wall-clock
  seams are outside this test-only WP, so the harness compares normalized
  reports while preserving real production identifiers in evidence.
- D2 is exposed through the typed clock, id, job, realtime, and interrupt
  controls. Merged journeys use durable RPC reads after realtime hints; future
  owning WPs consume the remaining controls when their beats land.
- Extending the offline guard to every possible low-level `tls`, `dgram`, or
  preconstructed socket path is deferred. The guard currently fails DNS,
  `net.connect`, HTTP(S), and `fetch`; mock transports and explicitly declared
  loopback owners remain the only allowed paths.

## Test plan

`harness.test.ts`

- `creates and disposes isolated worktree without modifying caller checkout`.
- `external request in offline mode fails with beat and caller` (**network error path**).
- `failed beat preserves sanitized artifacts`.
- `agent cannot call human push/resolve services` (**safety path**).
- `same seed and clock produce identical report excluding duration`.

`golden-loop.e2e.test.ts`

- placeholder orchestration that imports WP-67–69 beat modules and fails if any beat is missing/duplicated.
- run all beats twice from fresh warm-cache copies; compare semantic results.

## Do not

- Do not mutate the repository checkout, global git config, or live tenant by default.
- Do not mark a beat passed from canned prose; assert the underlying artifact/state.
- Do not require a public transparency log, internet, or physical host in CI.
- Do not fake human review as an agent call.
- Do not hide connected-mode skips or network fallbacks.

## Open questions

1. Confirm the app test runtime's screenshot support; DOM snapshots plus directive RPC assertions are acceptable in CI, with screenshots in rehearsal runs.
2. Pick the opt-in dev tenant reset mechanism before connected mode is enabled; until then, connected tests remain skipped rather than unsafe.
