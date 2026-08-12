# WP-28 — Policy-as-code engine & dry-run

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §5, §6.2, §8.7 · RECON §2.6 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-27 · **Blocks:** Agent policy tool and Golden Loop bulk proposal
**Produces a FROZEN artifact:** no — policy is a versioned local file and generator, never server state.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/policy/index.ts  # replaces WP-22 stub
plugins/bb-plugin-finite-state/lanes/findings/policy/{schema,compile,evaluate,apply,report}.ts
plugins/bb-plugin-finite-state/lanes/findings/policy/*.test.ts
```

## Files you must not touch
Composition/frozen files, cache query internals, overlay writer, UI, sync push, agent tool registry, dependencies, fixtures, and other lanes.

## Context
`.fs/triage/policy.yaml` consolidates routine reachability/band rules and human holdbacks into reviewable code. It fills gaps; it **never clobbers a local or server human decision**. Dry-run and apply use the same compiled evaluation so preview cannot lie. Results are local YAML proposals only. UUIDs are ephemeral; decisions use stable identities and WP-27's writer. `CODE_NOT_REACHABLE` always pins exact version.

## What to build
1. Validate `fs-triage-policy/v1`: ordered rules with `when` predicates, a `set` decision, holdbacks, and `overwrite_existing` fixed to false in v1.
2. Support selectors: reachability, `vuln_in_dataset`, risk/severity band, KEV/VC-KEV, EPSS threshold, severity, component, finding type, and CWE. Compile them to parameterized SQL/typed predicates; no string-eval expression language.
3. Evaluate rules in order. The first decision-producing rule wins for an untriaged finding. Holdbacks override writes and report the rule/reason, including all KEV findings and invalid NOT_AFFECTED proposals.
4. Treat any local overlay or non-null server VEX tuple as existing and skip it. Ignore an input file requesting overwrite and emit a validation error; policy never erases human judgment.
5. Expand only approved reason templates (`{factors}`, `{score}`) from cache fields with deterministic escaping. Missing evidence causes a hold, not fabricated prose.
6. Produce a complete dry-run report grouped by rule: matched, would-write, held, skipped-existing, errors, and bounded samples. Dry-run performs zero filesystem/SQLite/server mutation.
7. Apply exactly a previously evaluated candidate set through WP-27's CAS writer, rechecking existing state before each write. Report partial local failures individually and write a triage run summary for later directive use if the frozen schema supports it; otherwise persist the report under gitignored `.fs-sync/`.
8. Make policy application deterministic and idempotent. Re-running after successful writes yields only `skipped_existing`.

## Interface contract
```ts
export interface TriagePolicyV1 {
  schema: "fs-triage-policy/v1";
  rules: { name: string; when: PolicyPredicate; set: PolicyDecision }[];
  holdback: PolicyPredicate[];
  options: { overwrite_existing: false };
}
export interface PolicyReport {
  runId: string;
  dryRun: boolean;
  rules: { name: string; matched: number; wouldWrite: number; held: number; samples: string[] }[];
  written: number;
  held: { stableKey: string; rule: string; why: string }[];
  skippedExisting: number;
  errors: { stableKey?: string; code: string; message: string }[];
}
export function evaluatePolicy(db: Db, overlay: OverlayReader, policy: TriagePolicyV1, scope: PolicyScope): PolicyReport;
export function applyPolicy(deps: PolicyDeps, scope: PolicyScope, options: { dryRun: boolean }): Promise<PolicyReport>;
```

## Acceptance criteria
- [ ] Policy order is deterministic; first matching set rule wins.
- [ ] Existing local or server decisions are never changed, even if the policy file asks to overwrite.
- [ ] KEV holdback prevents automatic writes and is named in the report.
- [ ] `CODE_NOT_REACHABLE` proposals are exact-version pinned.
- [ ] Dry-run leaves YAML, SQLite, base snapshots, and mock Platform state byte-identical.
- [ ] Preview and apply evaluate the same candidate tuples against unchanged inputs.
- [ ] Apply is idempotent and per-item CAS failures are recoverable.
- [ ] Reports are bounded/paged so 39k matches do not become an unbounded tool/RPC payload.

## Test plan
`policy-engine.test.ts`
- `ordered first match`, `KEV holdback`, `existing local/server skipped`, `reason template`, `exact pin`, and `idempotent re-run`.
- **Error path:** unknown selector/template and `overwrite_existing:true` fail validation before any write.
- **Fault path:** one CAS conflict in a 40-item apply yields 39 writes plus one retryable error; it does not roll back or duplicate successes.
- `dry-run mutation spy remains zero`.

## Do not
- Do not overwrite an existing decision or add an override flag.
- Do not use eval/JavaScript expressions or interpolate values into SQL.
- Do not infer missing evidence or fabricate vendor/human rationale.
- Do not contact Forge, advance sync base, or claim decisions are applied server-side.
- Do not put full finding dumps in reports.

## Open questions
1. The exact severity/risk band algorithm should be ported from fs-report when accessible; otherwise expose band as a precomputed cache value and do not approximate it.
2. Triage-run report persistence must follow the frozen schema; `.fs-sync/policy-run-<id>.json` is the fallback, not a new migration.
