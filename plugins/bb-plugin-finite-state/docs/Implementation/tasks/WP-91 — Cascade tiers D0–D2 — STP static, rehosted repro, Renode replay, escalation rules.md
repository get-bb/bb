# WP-91 — Cascade tiers D0–D2 — STP static, rehosted repro, Renode replay, escalation rules

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.1, §4.5 · SPEC 05 tier model · AMD-0010 (`probe_run`) · Master Plan §5.2, §6 cross-lane joins · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-90, WP-48, WP-53 · **Blocks:** WP-96
**Produces a FROZEN artifact:** no — exports the cascade evaluation service WP-96 surfaces and the `fs-debug-bench` skill teaches; consumes WP-47/48 mounts and WP-53's rehosting

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/types.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/d0-static.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/d1-rehosted.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/d2-renode.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/escalation.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/session.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/cascade/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/firmware/** (WP-47/48), lanes/bench/execute/** (WP-53 — consume its exports), lanes/debug-bench/register.ts (WP-88), package.json, pnpm-lock.yaml, test/mock-remote/fixtures/\*\*, or another lane.

## Context

The cascade is the strongest single differentiator in SPEC 08: Embedder can only debug what it can physically instrument; we can debug statically, in emulation, deterministically, and physically — and we can read the vendor blob at every tier. The principle: answer the question at the cheapest tier that can actually answer it, and escalate only when the tier below genuinely cannot. D0 is STP disassembly/callgraph over the WP-47/48 firmware mount, plus RE-corpus comparison where WP-97 provides it. D1 reuses WP-53's tier-1 rehosting — this WP adds a reproduce-the-symptom harness over it, not a second rehoster. D2 is Renode as a narrow, deterministic scalpel for boot-chain and golden regressions only; hand-writing platform models for a modern SoC is a months-long job and is explicitly out of scope. D3 is a hand-off descriptor pointing at the WP-89 instrument surface, not an implementation.

Two rules are load-bearing and must be encoded as checkable logic, not prose. First: escalate when a tier returns _inconclusive_, not when it returns _inconvenient_ — an escalation decision always names the verdict that forced it. Second, the hard confirm/refute rule: a D1/D2 result may **refute** any hypothesis, but may never **confirm** a timing-, power-, or analog-class hypothesis; those classes escalate to D3 regardless of what emulation says, because emulated timing is not real timing.

Tier D results are diagnostic, never evidentiary. Nothing in this lane writes `verification_results`, feeds the requirement × tier matrix, or produces attestations. A hypothesis confirmed at the bench is a finding, not a proof. Renode is a host prerequisite; per FS-158 its absence produces a D2-scoped advisory while the plugin remains running. CI has no Renode, no QEMU rig, and no hardware, so every tier degrades and every test skips cleanly or runs on fixtures.

## What to build

1. The hypothesis and verdict vocabulary in `types.ts`: hypothesis class (`logic|state|timing|power|analog|environmental`), tier (`d0|d1|d2|d3`), outcome (`confirmed|refuted|inconclusive`), each verdict carrying evidence artifact paths and the exact command/inputs that produced it.
2. D0 static: run STP disassembly/callgraph queries against a readiness-checked WP-47 mount (refuse `metadata_only`/`partial` for byte-dependent queries), answer call-path and init-sequence questions, and — when WP-97's corpus is present — compare an init sequence against corpus observations for the same silicon. Corpus absence degrades D0 to blob-only analysis, visibly.
3. D1 rehosted: drive WP-53's exported tier-1 rehosting to reproduce a stated symptom (boot hang, crash signature, log pattern), with a symptom matcher over emulation output. Reuse `runBench` seams; do not duplicate host or Forge logic. D1 verdicts carry the rehosting run id.
4. D2 deterministic: a Renode driver (argv arrays, no shell) that executes a scripted boot-chain or golden-regression scenario from a checked-in `.resc`/platform description, captures the deterministic log, and diffs it against a golden. Scenario authoring is limited to boot-chain/regression replay; general platform modeling is refused with `D2_OUT_OF_SCOPE`.
5. `escalation.ts` — the rules as pure, testable functions: `nextStep(hypothesis, verdicts[])` escalates only on `inconclusive`; `validateVerdict(tier, hypothesis, outcome)` coerces a D1/D2 `confirmed` on a timing/power/analog hypothesis into `inconclusive` with a mandatory-escalation annotation and a typed error to the caller. The rule table is data, so the skill (WP-96) and the code cannot drift silently.
6. A cascade session in `session.ts`: an ordered record of hypotheses, per-tier verdicts, and escalation decisions, persisted as `probe_run`-linked rows so the investigation is replayable. The session's terminal state is a diagnosis plus its evidence — never a verification result.
7. D3 hand-off: emit a structured descriptor (hypothesis, discriminating observation needed, suggested instrument kind) that WP-96's surfaces render; instruments themselves are WP-89/92–94.
8. Prerequisite detection for Renode (and the rehosting prerequisites via WP-53's preflight) feeds typed tier-scoped advisories without changing plugin lifecycle; publish `probe:changed` refetch hints; serve session queries as paged RPC rows.

## Interface contract

    export type HypothesisClass = "logic" | "state" | "timing" | "power" | "analog" | "environmental";
    export type CascadeTier = "d0" | "d1" | "d2" | "d3";
    export type VerdictOutcome = "confirmed" | "refuted" | "inconclusive";

    export interface Hypothesis {
      id: string;
      text: string;
      class: HypothesisClass;
      likelihood: number;                  // 0–1, agent-ranked
      easeOfVerification: number;          // 0–1
    }

    export interface TierVerdict {
      tier: CascadeTier;
      hypothesisId: string;
      outcome: VerdictOutcome;
      forcedEscalation: boolean;           // true when a D1/D2 "confirm" was coerced
      evidence: Array<{ kind: string; path: string }>;
      producedBy: { command: string[]; inputs: Record<string, string> };
    }

    export type EscalationDecision =
      | { action: "answered"; verdict: TierVerdict }
      | { action: "escalate"; toTier: CascadeTier; because: "inconclusive" | "class_requires_physical" }
      | { action: "stop"; reason: string };

    // D1/D2 may refute anything; may never confirm timing/power/analog.
    export const CONFIRM_CAPABILITY: Readonly<Record<CascadeTier, readonly HypothesisClass[]>>;

    export function validateVerdict(v: TierVerdict, h: Hypothesis): TierVerdict;      // coerces illegal confirms
    export function nextStep(h: Hypothesis, verdicts: readonly TierVerdict[]): EscalationDecision;
    export function runD0(deps: CascadeDeps, q: StaticQuery, signal: AbortSignal): Promise<TierVerdict>;
    export function runD1(deps: CascadeDeps, repro: ReproRequest, signal: AbortSignal): Promise<TierVerdict>;
    export function runD2(deps: CascadeDeps, replay: RenodeReplayRequest, signal: AbortSignal): Promise<TierVerdict>;

There is no `runD3`; the D3 hand-off descriptor is data for WP-96's surfaces and WP-89's instruments.

## Acceptance criteria

- [ ] The escalation truth table is exhaustive over `{tier × class × outcome}` and matches `CONFIRM_CAPABILITY`; escalation fires only on `inconclusive` or a class rule, never on cost or convenience inputs (none exist in the signature).
- [ ] A D1/D2 `confirmed` on a timing-, power-, or analog-class hypothesis is coerced to `inconclusive` + forced escalation, and the caller receives a typed error explaining why.
- [ ] No code path in this lane can write `verification_results`, matrix rows, or attestations — proven by a test that scans the lane's imports and the harness's SQL trace.
- [ ] D0 refuses byte-dependent queries against a non-materialized mount with the WP-47 readiness code.
- [ ] D1 delegates to WP-53's exports; no second rehosting implementation exists in this lane.
- [ ] D2 executes only checked-in replay scenarios; a request to model a new platform fails with `D2_OUT_OF_SCOPE`.
- [ ] Every verdict carries reproducible provenance (command, inputs, evidence paths).
- [ ] Missing Renode degrades only D2 with an actionable advisory while plugin status remains running; CI passes with no Renode, QEMU, corpus, or hardware.
- [ ] Cascade sessions are persisted, paged, and replayable; signals are refetch hints only.

## Test plan

- escalation.test.ts — the full truth table; the coerced-confirm safety path; `inconvenient` inputs impossible by construction; rule-table/data drift detection against `CONFIRM_CAPABILITY`.
- d0-static.test.ts — callgraph query over a fixture mount, init-sequence comparison with a fixture corpus, corpus-absent degradation, and partial-mount refusal (error path).
- d1-rehosted.test.ts — symptom matched, symptom not reproduced → `refuted` vs. emulation-failed → `inconclusive` (the distinction matters), and WP-53 preflight failure propagated without dispatch.
- d2-renode.test.ts — golden replay match/diff, missing Renode → scoped unavailable advisory (degraded path), nondeterministic-output detection fails the run rather than passing it, and out-of-scope modeling refusal.
- session.test.ts — persisted ordering, replay of a recorded session, and the evidentiary-boundary scan from the acceptance criteria.

## Do not

- Do not let any tier-D result become verification evidence, however confirmed it looks.
- Do not build or accept hand-written Renode platform models for new SoCs; D2 stays a replay scalpel.
- Do not reimplement rehosting, unpacking, or mount readiness — consume WP-53/48/47.
- Do not encode escalation rules in skill prose alone; the skill quotes this WP's rule table.
- Do not add npm dependencies or shell out with interpolated strings.
- Do not register agent tools, CLI, or panels here.

## Open questions

1. The exact STP invocation surface for disassembly/callgraph over a local mount (library, CLI, or service): confirm what WP-48's driver leaves available on the host and which lane-scoped advisory reports its absence.
2. Where checked-in D2 replay scenarios live (`test/fixtures/renode/` vs. a lane-local fixtures dir) and what the golden-log normalization strips (timestamps, host paths) before diffing.
3. The corpus-comparison contract with WP-97: this WP consumes a query interface (init-sequence observations by silicon family); coordinate the shape early since WP-97 has the longest lead and this WP must degrade without it.
