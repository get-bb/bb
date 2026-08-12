# WP-37 — Requirements traceability view & filters

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §3.4, §5.6 · UX Plan Product Security · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-36 · **Blocks:** Traceability demo and scoped WP-38 conversion
**Produces a FROZEN artifact:** no — replace the WP-31 traceability stub.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/requirements/traceability/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/requirements/traceability/{FilterBar,TraceabilityRail,TraceNode,RequirementDetail}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/requirements/traceability/{query,filters,git-history,resolvers}.ts
plugins/bb-plugin-finite-state/lanes/product-security/requirements/traceability/*.test.tsx
```

## Files you must not touch
Requirement schema/cards, frozen files, canvas/matrix/run modules, git contents, other lane internals, theme/dependencies, or registration.

## Context
The detail view makes the chain inspectable: threat → requirement → standard clause → git commit → check/run → signed evidence. Each segment self-fetches by stable id and degrades independently. Filters must answer compliance/security questions over up to 5,000 requirements without fetch-all. Standards are cached truth; any later standards review transition uses **`review_version`**, never `entity_version`. Verification status remains evidence-derived.

## What to build
1. Implement filters: text, EARS pattern, requirement type, priority, evidence status, stale/failing, tier presence, standard/clause, threat slug, and local-changes only. Serialize them in subPath/query state.
2. Push filters/paging into local RPC/SQLite/YAML index. Return totals/facets and stable cursors; virtualize all unbounded result/trace lists.
3. Build requirement detail with rationale, source description, inline contracts, latest evidence summaries, and links to matrix cells.
4. Build a horizontal/accessible trace rail for threat, requirement, clause, commit, check/run, and attestation. Every node shows identity, relationship, readiness, and provenance; missing nodes remain explicit gaps.
5. Resolve git provenance via bounded, safe `git log --follow` for the known requirement file. No shell input interpolation from route attributes; cache results by file digest.
6. Link threat nodes into focused canvas, clauses into cached clause detail, commits into bb diff/history, and checks/evidence into WP-39/40 routes.
7. Export a self-fetching trace rail usable by a future `::fs-req` directive. Treat all ids/attributes as untrusted strings.
8. Cover loading, no matching requirements, partial/scoped errors, and unconfigured. One failed segment must not blank the chain.

## Interface contract
```ts
export interface RequirementFilters {
  text?: string; pattern?: EarsPattern[]; reqType?: string[]; priority?: string[];
  evidenceState?: ("verified" | "partial" | "failed" | "not_run")[];
  stale?: boolean; tier?: "static" | "emulation" | "hil" | "manual";
  standardClause?: string; threat?: string; localOnly?: boolean;
  cursor?: string; limit?: number;
}
export interface TraceNodeModel {
  kind: "threat" | "requirement" | "clause" | "commit" | "check" | "run" | "attestation";
  id: string; label: string; ready: boolean; relation: string;
  provenance?: { source: string; at?: string }; error?: string;
}
export interface TraceRailModel { requirementId: string; nodes: TraceNodeModel[]; gaps: { from: string; to: string; reason: string }[]; }
```

## Acceptance criteria
- [ ] Every required filter round-trips in navigation and is executed server-side/local-cache-side, not over an in-memory fetch-all.
- [ ] The full trace fixture links threat, clause, commit, check/run, and attestation correctly.
- [ ] Missing/deleted link targets render explicit gaps with repair/readiness guidance.
- [ ] Git lookup is path-confined, bounded, cached, and safe from argument injection.
- [ ] Evidence status is read-only/derived; the view has no mark-verified action.
- [ ] Any standards lifecycle data/interface uses `review_version`, not `entity_version`.
- [ ] Unbounded lists are virtualized/paged and one segment failure is isolated.
- [ ] Four states plus Hugeicons/shared-ui/theme tokens pass.

## Test plan
`requirements-traceability.test.tsx`
- `filter serialization/query`, `complete rail`, `missing clause gap`, `threat navigation`, `commit link`, and `self-fetch by id`.
- **Error path:** malformed route id and failed git history lookup render scoped gaps without command injection or panel crash.
- Performance fixture verifies bounded card/trace DOM over 5,000 requirements.

## Do not
- Do not derive regulatory compliance from a link alone or treat a mapped clause as proof.
- Do not shell-interpolate user ids/paths or call git on an arbitrary path.
- Do not use `entity_version` for standards concurrency.
- Do not edit requirement YAML or result/status data here.
- Do not directly query another lane's private tables.

## Open questions
1. Commit navigation should use the host's supported diff/history helper; if unavailable, render the hash and safe file context without inventing a route.
2. Large many-to-many trace graphs may need a dedicated graph view later; v1 rail stays requirement-centered.

