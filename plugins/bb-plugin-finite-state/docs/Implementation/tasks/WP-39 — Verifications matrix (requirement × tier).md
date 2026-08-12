# WP-39 — Verifications matrix (requirement × tier)

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §3.3, §4.1, §5.6, §8.4 · SPEC 05 bench tier mapping · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-36 · **Blocks:** WP-40
**Produces a FROZEN artifact:** no — replace the WP-31 matrix stub and read frozen verification cache tables.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/verifications/matrix/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/verifications/matrix/{VerificationMatrix,MatrixCell,MatrixHeader,MatrixFilters,Legend}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/verifications/matrix/{query,aggregate,tier-map,status}.ts
plugins/bb-plugin-finite-state/lanes/product-security/verifications/matrix/*.test.tsx
```

## Files you must not touch
Run/action detail, verification cache schema/pullers, requirement cards/schema, frozen files, bench lane, registration, theme/dependencies, or other lanes.

## Context
The matrix answers "what is unproven?" Rows are requirements; columns are static, emulation, HIL, and optional manual. Cells summarize latest evidence, not authored claims. **Verification status is derived from results and can never be set here.** Worst latest result wins, with glyph plus token color. Rows up to 5,000 are virtualized and computed in one indexed query, not N calls.

## What to build
1. Query requirement/check mappings and `is_latest` verification results in one paged/indexed data path. Return rollup totals and one cell summary per requirement+tier.
2. Map check types deterministically: config/sbom/binary/vuln-absence → static; dynamic → emulation or HIL from parameters/category; external_sync → HIL; manual/attestation/document review → manual. Map bench tier0 → static, tier1/2 → emulation, tier3 → HIL, tier4 → manual.
3. Aggregate latest required checks with worst-wins order `failed > error > inconclusive > running > pending > verified > skipped`; display mapped-not-run separately from no mapping.
4. Build virtualized matrix rows, sticky headers, accessible grid navigation, count badges, legend, and manual-column toggle (off by default). Never rely on color alone.
5. Default sort/filter to unproven, with shared requirement filters plus tier/status. Persist harmless view preference in KV.
6. Apply requirement-level stale overlay when semantic content/target firmware moved after newest evidence. Do not replace the underlying result state.
7. Cell click navigates to `verifications/<reqId>/<tier>` for WP-40. Running hints trigger refetch; realtime never supplies result truth.
8. Cover loading skeleton, no requirements/checks empty state, stale/error-with-data, and unconfigured state.

## Interface contract
```ts
export type VerificationTier = "static" | "emulation" | "hil" | "manual";
export type MatrixCellState = "failed" | "error" | "inconclusive" | "running" | "pending" | "verified" | "skipped" | "mapped_not_run" | "unmapped";
export interface VerificationCell {
  requirementId: string; tier: VerificationTier; state: MatrixCellState;
  checkCount: number; requiredCount: number; latestAt: string | null; runIds: string[];
}
export interface MatrixRow { requirementId: string; title: string; stale: boolean; cells: Record<VerificationTier, VerificationCell>; }
export function mapCheckToTier(check: CheckModel): VerificationTier;
export function aggregateCell(checks: CheckModel[], latest: VerificationResult[]): VerificationCell;
```

## Acceptance criteria
- [ ] Type/tier mapping covers every documented check and bench tier deterministically.
- [ ] Worst-wins aggregation matches fixtures and uses latest-chain rows only.
- [ ] Mapped-not-run and unmapped are visibly/textually distinct.
- [ ] No UI/control/API can set verification status or mark verified.
- [ ] 5,000×4 matrix uses one paged/indexed query path and bounded DOM; no N+1 RPC/SQL.
- [ ] Manual column defaults hidden but remains accessible/persisted.
- [ ] Stale overlays underlying evidence state rather than replacing it.
- [ ] Four states plus Hugeicons/shared-ui/theme-token/accessibility rules pass.

## Test plan
`verification-matrix.test.tsx`
- table-driven tier mappings, worst-wins cases, latest/superseded handling, mapped-vs-unmapped, default unproven sort, manual toggle, and cell navigation.
- **Error path:** malformed dynamic check lacks disambiguating parameters/category; it is surfaced as `TIER_UNKNOWN` and excluded from false coverage, not guessed.
- Performance test asserts one query and virtualizer bounds on 5,000 rows.

## Do not
- Do not derive a green status from mapping presence or user workflow status.
- Do not write `verification_status`, results, runs, or YAML.
- Do not fetch per cell/row or render an unbounded grid.
- Do not let realtime payloads become truth; refetch the cache.
- Do not import bench internals directly.

## Open questions
1. Dynamic-check disambiguation needs a frozen vocabulary for parameter/category values; unknown values fail visible rather than defaulting to emulation.
2. Manual remains hidden by default pending regulated-customer feedback.

