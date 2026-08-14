# WP-84 — Grounding tab — sources, part picker, coverage, citation trace

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.2, §5.1 (query surface), §6 · SPEC 00 §7, §10 · AMENDMENTS AMD-0011 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-07, WP-82, WP-83 · **Blocks:** WP-96
**Produces a FROZEN artifact:** no — consumes the frozen `grounding.*` RPC contract and the WP-82/WP-83 service exports

## Files you own

    plugins/bb-plugin-finite-state/lanes/grounding/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/query-federated.ts
    plugins/bb-plugin-finite-state/lanes/grounding/app/grounding-tab.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/app/sources-list.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/app/part-picker.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/app/coverage-card.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/app/citation-trace.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/app/**/*.test.tsx
    plugins/bb-plugin-finite-state/lanes/grounding/query-federated.test.ts

`register.app.tsx` replaces WP-71's grounding app stub (route `/firmware/grounding`) and consumes RPC only — no backend imports in frontend code. `query-federated.ts` replaces WP-82's placeholder in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/grounding/register.ts, lanes/grounding/store/**, lanes/grounding/catalog/**, lanes/documents/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

This is SPEC 08 §4.2's UI plus the one backend join the tab needs: the **federated grounding query**. WP-82 answers from plane B (documents, embeddings, ~0.72) and WP-83 from plane A (catalog, exact, 1.0); this WP merges them behind one `grounding.query` RPC and **labels every result with its plane**, so the confidence ladder stays legible to the agent and to whoever reviews a citation. The same service is what WP-96 registers as `fs_ground_query` — never raw chunks, always cited passages or facts.

The tab's product job is honesty. The coverage card reports **which catalog flavour is actually present** (redistributable-only vs full, per WP-83's `CatalogCoverage`), how many devices and vendors that covers, and which project sources are indexed — because "we have grounding" is a claim someone will act on. The "what does this ground?" view is the reverse trace: pick a source and see which generated values cite it, clickable back to the page.

Per-source citation counts and the citation trace read the citation overlay, which WP-85 owns. This WP defines a `CitationCountProvider` interface and renders from it, shipping a stub that returns "no citation data yet"; WP-85 replaces the implementation in place. The UI must be designed for that state, not broken by it.

## What to build

1. Replace the grounding app stub: register the `/firmware/grounding` tab route and panel shell. All data arrives via `useRpc` against the frozen `grounding.*` contract; realtime `grounding:changed` is a refetch hint only.
2. `query-federated.ts`: merge WP-83 `queryCatalog` and WP-82 `queryDocuments` behind one service. An identifier-shaped query (device/peripheral/register/field present) hits the catalog first; free text fans out to FTS and plane B. Results interleave with explicit `plane` and `confidence` on every item — catalog 1.0, document ~0.72 — and paging is preserved per plane with a combined cursor. Catalog absent degrades to plane-B-only plus a coverage note in the response envelope. Export for WP-96's `fs_ground_query`.
3. Sources list: virtualized rows showing kind, part, title, indexing status (pending/indexing/ready/failed with reason), license/redistributable badge, and per-source citation count from the `CitationCountProvider`. Failed sources expose a retry that calls the WP-82 indexing RPC.
4. Part picker: search plane A by device/part name (catalog identifier + FTS paths); selecting a catalog part records it as the project platform selection. **Add a custom part** by uploading PDFs through the WP-56 `bb.http` upload path — this WP never implements upload; it drives the existing route, then registers the resulting document SHA as a `ground_source` via the WP-82 RPC.
5. Coverage card: catalog flavour, `catalog_version`, device/vendor counts, redistributable-vs-total sources, and project-document index status — WP-83's coverage plus WP-82's license aggregate, rendered without editorializing. If only the redistributable catalog is present, say so and name the full-catalog local-build path.
6. Citation trace ("what does this ground?"): per source, the generated symbols whose citations point at it, grouped by file, each linking to the exact page/anchor in the WP-56 viewer and to the citation entry in the authoring panel. Empty state explains that traces appear once cited values exist.
7. All four designed states (skeleton loading, actionable empty, error with retry, scoped unavailable advisory when neither plane is available) on every component; per FS-158 this advisory leaves the plugin running and `needsConfiguration` remains reserved for missing required credentials. Theme tokens and Hugeicons only; monospace for identifiers and hex addresses.

## Interface contract

    export type FederatedHit =
      | (CatalogFact & { plane: "catalog"; confidence: 1.0 })
      | (GroundPassage & { plane: "document"; confidence: number });

    export interface FederatedQueryResult {
      items: FederatedHit[];
      total: number;
      cursor: string | null;
      coverage: { catalogPresent: boolean; flavour: "redistributable" | "full" | null };
    }

    export function queryGroundingFederated(
      ctx: GroundingContext,
      q: { text?: string; device?: string; peripheral?: string; register?: string; field?: string;
           pageSize?: number; cursor?: string },
    ): Promise<FederatedQueryResult>;

    export interface CitationCountProvider {
      countsBySource(projectKey: string): Promise<Record<string, number>>;   // sourceId → cited values
      tracesForSource(projectKey: string, sourceId: string): Promise<Page<CitationTraceEntry>>;
    }

    grounding.query    → FederatedQueryResult            (paged)
    grounding.sources  → Page<GroundSourceSummary>       (paged)
    grounding.coverage → CatalogCoverage & license aggregate

Exact RPC names and shapes come from the frozen AMD-0011 `grounding.*` group in shared/contract.ts; this lane implements handlers, it does not reshape the contract.

## Acceptance criteria

- [ ] Every federated result carries an explicit plane label and confidence; no unlabeled or plane-mixed item can render or cross the tool boundary.
- [ ] An identifier query answers from the catalog with `source_file` citations; the same query with the catalog absent returns document-plane results plus `coverage.catalogPresent: false`.
- [ ] The coverage card reports the flavour actually attached — a redistributable-only install never displays full-catalog coverage.
- [ ] Custom-part upload goes through the WP-56 route; no second upload path, no bytes through RPC.
- [ ] Citation counts and traces render from `CitationCountProvider` and degrade to a designed pre-WP-85 state.
- [ ] Trace entries click through to the exact page/anchor in the document viewer.
- [ ] Sources list is virtualized and paged; all four UI states exist on every component; tokens and Hugeicons only.
- [ ] Federated paging round-trips: a combined cursor resumes both planes without duplication or loss.

## Test plan

- query-federated.test.ts — plane labeling, identifier-vs-text routing, interleaving, combined-cursor round-trip, catalog-absent degradation, and a WP-83 `CATALOG_INVALID` surfacing as degraded coverage rather than a query failure (**error path**).
- sources-list.test.tsx — status rendering including `failed` with reason and retry, license badges, citation-count stub state, virtualization on a 500-source fixture.
- part-picker.test.tsx — catalog search, custom-part flow driving the mocked upload route, upload rejection (oversize/MIME from the WP-56 contract) surfaced with a designed error state (**error path**).
- coverage-card.test.tsx — redistributable vs full vs absent renderings; never claims coverage the handle does not report.
- citation-trace.test.tsx — grouped traces, viewer deep-link locator, empty state.

## Do not

- Do not import backend modules, SQLite, or clients in frontend code — RPC is the only path.
- Do not strip or average plane confidence; a document-plane hit must never look like a catalog fact.
- Do not implement upload, chunking, or catalog attach here; drive WP-56/WP-82/WP-83 surfaces.
- Do not overstate coverage anywhere — no "500+ MCUs" style copy that the attached catalog cannot substantiate.
- Do not treat realtime payloads as data; refetch through RPC.
- Do not register agent tools, mentions, or CLI; WP-96/WP-64 consume the federated query export.

## Open questions

1. Interleaving policy when both planes match a free-text query: catalog-first is the working assumption (declared beats extracted), but ranking across planes with incomparable scores needs a reviewed rule before WP-96 freezes tool output ordering.
2. Where the project's platform (MCU family) selection persists — `bb.storage.kv` per project vs a `ground_source`-adjacent row — decide with WP-85/WP-95 so bring-up workflows read one location.
3. Whether the part picker should offer catalog-driven "attach standard docs" suggestions (§2.1 platform selection) in v1 or defer to WP-97's corpus work.
