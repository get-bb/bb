# WP-41 — SBOM cache, pull & vuln rollup

**Lane:** L5 Bill of Materials · **Spec refs:** SPEC 04 §1.1, §2, §4.1–4.2, §5.8 · SPEC 02 §4.3 · SPEC 00 §5, §10 · RECON §2.2, §2.4–2.6 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-13, WP-04 · **Blocks:** WP-42, WP-43, WP-58
**Produces a FROZEN artifact:** no — consumes the frozen store, RPC, registry, direct-client, and mock-fixture contracts

## Files you own

    plugins/bb-plugin-finite-state/lanes/bom/register.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/pull.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/query.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/rollup.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/types.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/pull.test.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/query.test.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/rollup.test.ts

The lane registration file replaces WP-01's stub. Wire every already-declared BOM RPC and HTTP route here once. Later BOM WPs implement the imported modules; they do not reopen a composition root.
Where a later handler module does not exist yet, create only a compiling NOT_IMPLEMENTED placeholder at the exact path owned by WP-43, WP-44, WP-45, or WP-46. Those WPs replace their placeholders in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/remote/types.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

SBOM is a CACHED read surface. The Finite State Platform is the default authoritative software-inventory source; AS project-package data is used only for explicit AS linkage. The plugin keeps a disposable SQLite projection so a 10,000-component product can be filtered and joined without a remote call from a render path. The cache joins findings by the same stable identity ladder; server UUIDs remain ephemeral mappings.

The frozen WP-04 schema wins over the older SQL sketch in SPEC 04. In particular, use its exact column names and keep source-specific fields in raw when no dedicated column exists. Do not amend the schema merely to make the older sketch match.

## What to build

1. Replace the BOM backend registration stub. Register the frozen BOM RPC handlers and pre-wire the SBOM/HBOM binary HTTP routes to lane-local handler modules. Registration must be reload-safe and keep no bb object in module state.
2. Implement a resumable pull using the exact frozen `PlatformClient` SBOM/component operations for authoritative inventory. If an AS-specific join needs `listProjectSbomPackages`, call the narrow `AssuranceStudioClient` separately and record source provenance. Page normalized async iterables to completion; direct clients return pages/streams, never upstream-local paths. Stage pages in request-owned SQLite under `.fs-sync/bom/`.
3. Normalize each component into the frozen sbom_components row. Compute componentKey with the shared stable-key implementation: normalized purl, else folded name/group/version. Never fabricate a purl.
4. Commit one staging transaction per successfully decoded page. After every page succeeds, attach the staging database and replace the target project-version slice plus its sync cursor in one shared-store transaction. A failed or cancelled pull leaves the prior complete slice untouched and retains bounded staging state for resume. Publish tiny progress hints; a signal tells clients to refetch and never carries component rows.
5. Recompute sbom_vuln_rollup inside the final replacement transaction by joining the SPEC 02 findings cache. Counts are critical/high/medium/low plus KEV count and max EPSS. Reachability is reachable when any joined finding is positive, unreachable when all known findings are negative, mixed when both occur, and unknown when evidence is absent or inconclusive.
6. Implement paged cache queries for name, purl, license, minimum severity, KEV, reachability, and component key. Return summaries and IDs, not raw payload dumps. All list responses use the frozen items/total/cursor envelope and a maximum page size of 200.
7. Preserve the last complete cache if refresh fails. Mark the response stale with pulledAt, failing service, and reason; never blank a usable SBOM because Platform or AS is offline. Forge state is irrelevant.
8. Publish bom:changed with only projectVersionId after a successful atomic refresh. Use the global-fanout convention and let clients filter.

## Interface contract

    export interface SbomPullInput {
      projectId: string;
      projectVersionId: string;
      resume?: boolean;
    }

    export interface SbomPullResult {
      projectVersionId: string;
      components: number;
      pages: number;
      rollups: number;
      pulledAt: string;
      resumed: boolean;
    }

    export interface SbomQuery {
      projectVersionId: string;
      cursor?: string;
      limit?: number;
      search?: string;
      purl?: string;
      license?: string;
      minimumSeverity?: "critical" | "high" | "medium" | "low";
      kev?: boolean;
      reachability?: "reachable" | "unreachable" | "mixed" | "unknown";
    }

    export interface SbomComponentSummary {
      componentKey: string;
      purl: string | null;
      name: string;
      group: string | null;
      version: string | null;
      license: string | null;
      supplier: string | null;
      files: string[];
      vuln: {
        critical: number; high: number; medium: number; low: number;
        kev: number; maxEpss: number | null;
        reachability: "reachable" | "unreachable" | "mixed" | "unknown";
      };
      pulledAt: string;
    }

    export function pullSbom(deps: BomDeps, input: SbomPullInput): Promise<SbomPullResult>;
    export function querySbom(db: Database.Database, query: SbomQuery): Page<SbomComponentSummary>;
    export function recomputeVulnRollup(db: Database.Database, projectVersionId: string): number;

Shapes at the RPC boundary come from shared/contract.ts. Adapt these lane-local types to that contract; if the frozen contract cannot express stale data or paging, stop and file an amendment.

## Acceptance criteria

- [ ] A multi-page mock SBOM refreshes into real SQLite with no duplicate components.
- [ ] Component identity uses purl first and folded name/group/version only when purl is absent.
- [ ] A component UUID never appears in componentKey.
- [ ] Rollup counts, KEV, max EPSS, and all four reachability states match a table-driven fixture.
- [ ] Every query is paged at no more than 200 items and performs no remote call.
- [ ] A failed refresh leaves the prior complete cache readable with stale metadata and a retry affordance.
- [ ] Progress/realtime payloads contain IDs and counts only.
- [ ] The registration is reload-safe and no composition root or frozen file changed.
- [ ] Typecheck, test, lint, and build are green.

## Test plan

- pull.test.ts — multi-page staging/final replacement, cursor plus staging resume, malformed page rolls back that staging page, and 429 exhaustion preserves the old complete cache with a stale result using mock fault injection.
- query.test.ts — all filters, cursor stability under equal sort keys, no-purl identity, max-page enforcement, and an invalid cursor returns a typed BAD_CURSOR error.
- rollup.test.ts — severity/KEV/EPSS aggregation, each reachability truth-table row, and a finding without a resolvable component is ignored and logged.
- Performance test — seed 10,000 components plus findings; first page and a filtered page each complete within the SPEC 04 cache budget on the test machine.

## Do not

- Do not call Platform/AS from RPC list pagination after the cache is built or from any render path.
- Do not write SBOM data to YAML or treat it as authored intent.
- Do not invent a purl, collapse legitimate duplicate server rows without the stable key rules, or join by version-ephemeral UUID.
- Do not send upstream-local paths or transport objects to the frontend.
- Do not clear a valid cache before a replacement page has validated.

## Open questions

1. The frozen schema stores some fields only in raw. Confirm whether the frozen RPC contract expects CPE, source, and staleness as first-class fields; amend the contract only if the UI cannot derive them safely.
2. Decide with WP-23 whether its stable-key helper is directly reusable for SBOM components or exposes a finding-only wrapper. The ladder itself must not diverge.
3. Default to direct Platform inventory. Use AS project packages only for an AS-specific join, and measure/report source freshness rather than silently mixing them.
