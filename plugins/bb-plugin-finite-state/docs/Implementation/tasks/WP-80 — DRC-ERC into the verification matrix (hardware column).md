# WP-80 — DRC/ERC into the verification matrix (`hardware` column)

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §3 Tab 3, §5, §7.2 · SPEC 03 §3.3, §4.1 · SPEC 08 §4.1 (tier-D contrast) · AMD-0010/AMD-0011 · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-71, WP-77, WP-39 · **Blocks:** WP-81
**Produces a FROZEN artifact:** no — writes into the AMD-0010-rebuilt `verification_results`; owns only the hardware ingestion and binding logic

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/verification/binding.ts
    plugins/bb-plugin-finite-state/lanes/hardware/verification/ingest.ts
    plugins/bb-plugin-finite-state/lanes/hardware/verification/stale.ts
    plugins/bb-plugin-finite-state/lanes/hardware/verification/**/*.test.ts

Replace WP-72's compiling NOT_IMPLEMENTED placeholders at these exact paths in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/product-security/** (including the WP-39 matrix), lanes/bench/**, lanes/hardware/register.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

DRC and ERC are verification, not reporting. A requirement like *"the isolation barrier SHALL maintain 8mm creepage"* is verified by a DRC rule, and its result belongs in the same matrix as a firmware test — the matrix answers "what's unproven" and does not care which discipline the proof came from. This WP maps `hw_violation` rows (WP-77 parses `--format json` into them) into `verification_results` keyed by requirement, **exactly as bench results do**, in the `hardware` column that AMD-0010 adds to the tier vocabulary.

Be precise about the boundary: SPEC 08's Tier D rule — diagnostic, never evidentiary — does **not** apply here. DRC/ERC results ARE evidentiary; they are deterministic checks of the design against declared rules, not exploratory bench work. What carries over unchanged is the WP-36/39 law: **status is derived from results; there is no "mark verified" path**, and stale overlays evidence rather than replacing it. A violation set produced from an older `source_hash` than the current schematic/board marks its results stale, feeding the verified/partial/failed/not-run/stale ladder.

## What to build

1. The requirement↔rule binding shape, following the WP-36/39 check-contract idiom: a `hardware` check in the requirement's verification contract names `kind: drc_rule | erc_rule`, the `projectKey`, the KiCad `rule` identifier, and `failOn: error | warning` (default `error`; `exclusion` never fails but is recorded). Validate bindings through the requirements schema's additive extension seam; if the frozen contract cannot carry the check kind, stop and file an amendment.
2. Ingestion: after each DRC/ERC extract lands `hw_violation` rows for a `source_hash`, derive one result per bound `(requirement, rule)`: a completed run with zero violations at or above `failOn` for that rule → `verified`; matching violations → `failed`, with violation ids, severity, rule, and affected refs/nets in the evidence summary so the matrix cell click-through can select the offending part or net.
3. `not_run` when no DRC/ERC run exists for the binding's project; `stale` when the newest run's `source_hash` differs from the current `sch_hash`/`pcb_hash` — overlay the prior result state, never delete it.
4. A binding whose rule name never appears in any run's output (rule vocabulary drift, typo, KiCad version change) is reported as `rule_unmatched` and excluded from coverage — the WP-39 `TIER_UNKNOWN` idiom: fail visible, never guess.
5. Requirement-level rollup stays derived: this WP writes results only; the matrix's worst-wins aggregation and the `hardware` column rendering are WP-39's consumption of the amended vocabulary.
6. Idempotency per `(requirement, rule, source_hash)`: re-ingesting the same run is a noop; a re-extract at a new hash supersedes via the latest-chain convention the matrix already reads.
7. Serve everything through the amended `hardware.*` RPC group's paged endpoints where the panel needs lists; no unpaged list, no per-cell queries.
8. Tests consume fixture `hw_violation` rows; `kicad-cli` is never required — running DRC/ERC is WP-77's job behind `needsConfiguration`, and this WP's suite skips nothing because it needs nothing external.

## Interface contract

    export type HardwareCheckKind = "drc_rule" | "erc_rule";

    export interface HardwareCheckBinding {
      kind: HardwareCheckKind;
      projectKey: string;
      rule: string;                          // KiCad rule id, e.g. "creepage"
      failOn: "error" | "warning";           // exclusions never fail
      required: boolean;
    }

    export type HardwareResultState = "verified" | "failed" | "not_run" | "stale" | "rule_unmatched";

    export interface HardwareVerificationResult {
      requirementId: string;
      tier: "hardware";                      // the AMD-0010 column
      state: HardwareResultState;
      sourceHash: string | null;             // hash the evidence was produced from
      currentHash: string;                   // hash of the design now in the worktree
      runAt: string | null;
      evidence: Array<{ violationId: number; kind: "drc" | "erc"; severity: string; rule: string; refs: string[] }>;
    }

    export function deriveState(binding: HardwareCheckBinding, run: HwCheckRun | null, currentHash: string): HardwareResultState;
    export function ingestHardwareResults(db: Database.Database, projectKey: string): Promise<{ written: number; staleMarked: number; unmatchedRules: string[] }>;
    export function markStaleOnHashChange(db: Database.Database, projectKey: string, newHash: string): Promise<number>;

The `verification_results` row shape and the `hardware` tier value are frozen by WP-71 under AMD-0010; consume them, do not shadow them.

## Acceptance criteria

- [ ] A requirement bound to a passing DRC rule reads `verified` in the `hardware` column from derived results alone; no control anywhere can set it.
- [ ] Matching violations at or above `failOn` produce `failed` with evidence rows sufficient to select the offending part/net on the canvas.
- [ ] Evidence from an older `source_hash` than the current design reads `stale`, overlaying — not deleting — the prior state.
- [ ] An unbound-able rule name reports `rule_unmatched` and is excluded from coverage; it can never contribute a green cell.
- [ ] `exclusion`-severity violations never fail a binding but remain visible in evidence.
- [ ] Re-ingesting an identical run writes nothing; a new hash supersedes through the latest chain.
- [ ] The test suite passes with no KiCad installed and never mocks SQLite.
- [ ] Every list surface involved is paged `{items, total, cursor}`.

## Test plan

- binding.test.ts — schema validation, failOn default, unknown check kind rejected, required/optional semantics.
- ingest.test.ts — table-driven derive cases: clean pass, error fail, warning under `failOn: error` passes but stays visible, exclusion recorded, `rule_unmatched` exclusion (**vocabulary error path**), idempotent re-ingest.
- stale.test.ts — `violation set from an older source_hash marks results stale and never verified` (**staleness error path**); hash advance supersedes correctly; ERC and DRC hashes tracked independently (sch vs pcb).

## Do not

- Do not apply the Tier-D "diagnostic only" rule here — and conversely, do not let any bench Tier-D result ride in through this path.
- Do not add a mark-verified affordance, write `verification_status` directly, or let a fixture flag bypass derivation.
- Do not guess a rule mapping, default an unknown severity, or count `exclusion` as pass *or* fail.
- Do not edit the WP-39 matrix, the requirements schema file, or any frozen artifact.
- Do not run `kicad-cli` from this lane's ingestion or tests.

## Open questions

1. WP-39 shipped with a closed four-tier `VerificationTier` union predating AMD-0010. Rendering the `hardware` column is a one-line vocabulary extension in L4's tier map — confirm whether WP-71's amendment pass updates it or L4 lands it; this WP must not.
2. KiCad's rule identifiers vary across 7/8/9 (`erc.json`/`drc.json` `type` values). Pin the binding vocabulary to the versions the fixtures cover and treat unknown identifiers as `rule_unmatched` rather than maintaining a translation table speculatively.
3. Should ERC bindings default `failOn: warning`? ERC warnings are frequently real (unconnected pins). Decide from the fixture projects' noise level and record the default here.
