# WP-42 — SBOM table panel, row expansion & cross-links

**Lane:** L5 Bill of Materials · **Spec refs:** SPEC 04 §2, §5.1, §5.4, §7.1, §7.3, §7.8 · SPEC 00 §7, §10 · SPEC 02 §3 · SPEC 03 §2.4 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-41, WP-07 · **Blocks:** WP-45, WP-61, WP-67
**Produces a FROZEN artifact:** no — consumes frozen RPC contracts and shared UI primitives

## Files you own

    plugins/bb-plugin-finite-state/lanes/bom/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/bom-panel.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/sbom/sbom-table.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/sbom/sbom-row.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/sbom/component-detail.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/sbom/filters.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/sbom/component-card.tsx
    plugins/bb-plugin-finite-state/lanes/bom/app/sbom/routes.ts
    plugins/bb-plugin-finite-state/lanes/bom/app/hbom/hbom-routes.tsx  # compiling placeholder → WP-45
    plugins/bb-plugin-finite-state/lanes/bom/app/**/*.test.tsx

Create hbom-routes.tsx as a compiling placeholder that WP-45 replaces in place. BomPanel imports that seam, so WP-45 does not need to edit register.app.tsx or bom-panel.tsx. Do not implement HBOM behavior here.

## Files you must not touch

app.tsx, server.ts, shared/contract.ts, any frozen file, lanes/bom/register.ts, package.json, pnpm-lock.yaml, another lane, or the mock fixture corpus.

## Context

The SBOM panel turns the cache from WP-41 into a dense navigation hub: component to findings, firmware paths, architecture nodes, threats, requirements, and an optional HBOM part. Its value is the join, not another copy of the Assurance Studio table. Ten thousand rows must remain smooth, and every domain component must self-fetch by ID so the same ComponentCard can later render inside an agent directive.

The frontend cannot use bb.sdk or SQLite. It uses frozen RPC hooks only. Realtime is a refetch nudge on a global fanout. Firmware paths may exist before a local mount; a path must still be visible with a materialize affordance.

## What to build

1. Replace the BOM frontend registration stub with one Bill of Materials nav panel and subPath routing. Root redirects to software. Reserve hardware routes for WP-45.
2. Implement a TanStack Virtual table with compact rows and columns for component, version, license, severity histogram, KEV, reachability, file count, and cross-link presence. Identifiers are monospace; severity uses label plus color.
3. Fetch pages through RPC as the virtual window approaches its tail. Preserve selection and scroll position while pages append. Never load all rows merely to sort or filter.
4. Implement SQL-backed filter controls for search, severity, KEV, reachability, license, component source when available, architecture linkage, and local VEX change. Slash focuses search. Saved views persist through the backend preference RPC; shipped views are Vulnerable by severity, Copyleft, and Unlinked to architecture.
5. Expand a row inline on Enter or chevron. Show its CVEs with severity, EPSS, KEV, reachability, and VEX status, then deep-link by stable finding key to the Findings panel.
6. Implement software/<base64url-component-key> as table plus detail pane. Decode and validate the route value before requesting it. Sections are identity, vulnerabilities, files in image, referenced by, and linked HBOM part.
7. Files in image come from cached evidence. Clicking an available path reveals it in the native firmware tree. If WP-47 reports no mount, retain the exact path and offer Materialize firmware; do not make the link disappear.
8. Cross-links read the versioned link overlays from their RPC projection. Node, threat, and requirement links use bb navigation to their owning panels.
9. Implement ComponentCard with id-only props and self-fetching behavior. Design loading skeleton, actionable empty, retryable error/stale, and unconfigured states for the panel, table, detail, and card.
10. On bom:changed, filter by active project version and refetch the visible queries. Do not consume signal payloads as data.

## Interface contract

    export interface ComponentCardProps {
      id: string;
      mode?: "software" | "hardware";
    }

    export type BomRoute =
      | { tab: "software"; componentKey?: string; savedView?: string }
      | { tab: "hardware"; partId?: string; screen?: "review" | "ingest" };

    export function parseBomSubPath(subPath: string | undefined): BomRoute | null;
    export function encodeComponentRouteKey(componentKey: string): string;
    export function decodeComponentRouteKey(segment: string): string;

    export interface SbomRowView {
      id: string;
      componentKey: string;
      identityLabel: string;
      purl: string | null;
      severityCounts: Record<"critical" | "high" | "medium" | "low", number>;
      kevCount: number;
      reachability: "reachable" | "unreachable" | "mixed" | "unknown";
      fileCount: number;
      localChange: boolean;
      linked: boolean;
    }

ComponentCard receives no server payload. It validates id and fetches current data through RPC, which is required for reuse by WP-61 directives.

## Acceptance criteria

- [ ] A 10,000-row fixture is virtualized; mounted DOM rows remain bounded and scrolling stays responsive.
- [ ] Filters and sort request paged server results rather than filtering an incomplete browser page.
- [ ] Row expansion displays joined findings and navigates with stable keys.
- [ ] Detail cross-links reach Findings, firmware tree, Product Security, and HBOM without leaking server UUID assumptions.
- [ ] Missing firmware mounts show an actionable materialize state while preserving paths.
- [ ] ComponentCard accepts only id/mode and self-fetches.
- [ ] All four required UI states exist and stale data remains visible behind a banner.
- [ ] Only Hugeicons, bb theme tokens, and @bb/shared-ui components are used.
- [ ] A bom:changed hint refetches only when its project version matches the active view.

## Test plan

- routes.test.ts — route round-trip for Unicode/purl keys, invalid base64url returns null, and an overlong route segment is rejected as BAD_ROUTE.
- sbom-table.test.tsx — bounded DOM row count with 10,000 items, cursor fetch near tail, saved-view restore, keyboard expand, and selection survives refetch.
- component-detail.test.tsx — each cross-link target, no-mount affordance, empty CVE state, and stale cache banner.
- component-card.test.tsx — self-fetch by ID, unknown ID renders a designed empty card, RPC failure renders retry, and untrusted ID is never rendered as markup.
- Fault path — inject a failed second-page RPC and prove already-rendered rows remain usable while the failed page can be retried.

## Do not

- Do not import bb.sdk, better-sqlite3, backend files, or Forge into frontend code.
- Do not use Lucide, emoji, literal colors, an unvirtualized list, or a spinner-only loading state.
- Do not put complete component payloads in route segments or directive props.
- Do not claim a component-to-file mapping is authoritative when it is only finding-location evidence; label the evidence source.
- Do not silently hide no-purl components.

## Open questions

1. The frozen RPC may expose saved-view persistence generically rather than as BOM-specific methods; use the frozen shape and do not add a parallel browser-only store.
2. Confirm the shared route-key encoder chosen by Findings. If it differs, adopt the shared implementation instead of shipping a BOM-only encoding.
3. True SCA component-to-file evidence is not wrapped today. Keep the v1 source label explicit until a verified wrapper exists.
