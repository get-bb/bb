# WP-33 — Canvas threat overlay (STRIDE micro-bars) & attack paths

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §2.3, §5.3, §5.6, §8.4 · Canvas Port §3 Phase 4 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-32 · **Blocks:** Product Security hero/demo surface
**Produces a FROZEN artifact:** no — replace the WP-31 threat-overlay stub.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/canvas/threat-overlay/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/canvas/threat-overlay/{StrideMicroBar,ThreatTable,AttackPathOverlay,ThreatLegend}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/canvas/threat-overlay/{aggregate,selection,path}.ts
plugins/bb-plugin-finite-state/lanes/product-security/canvas/threat-overlay/*.test.tsx
```

## Files you must not touch
Foundation/nodes, editing/links/layout, frozen files, schema/cache migrations, theme/dependencies, or other lanes.

## Context
The threat overlay makes the canvas a security model rather than a diagram. STRIDE counts are pre-aggregated, attack paths are cached bodies keyed by stable `route_signature`, and local viability decisions are overlay data. Render at most the selected path, not all 5,000. Threat table and graph selection must stay bidirectional. Use virtualized unbounded lists and shared-ui/Hugeicons/theme tokens with four designed states.

## What to build
1. Aggregate threats by affected component/dataflow and STRIDE category once per model revision. Validate category against cached methodology vocabulary; unknown categories get an explicit `Other`, not silent loss.
2. Port/adapt `StrideMicroBar` to each target node with six labeled segments, accessible counts, and theme-token states. A zero-count node stays quiet.
3. Build a virtualized threat table beside/over the canvas. Selecting a node filters it; selecting a threat focuses all affected nodes/flows.
4. Render the selected attack path as a highlighted ordered traversal over existing graph edges, including gaps where a path step cannot map. Do not render all paths simultaneously.
5. Support direct routes `tara/threats/<slug>` and focus/highlight input used later by `::fs-canvas`. Preserve selection during refetch if the slug still exists.
6. Show path exploitability as display-only derived evidence; viability/local decision state is visually separate and never inferred from score.
7. Preload bounded counts but page path/history details. Memoize aggregations and avoid per-render joins.
8. Cover loading, no-threat/no-path empty, stale/partial error, and unconfigured states.

## Interface contract
```ts
export type StrideCategory = "spoofing" | "tampering" | "repudiation" | "information_disclosure" | "denial_of_service" | "elevation_of_privilege" | "other";
export interface ThreatAggregate { targetSlug: string; counts: Record<StrideCategory, number>; total: number; }
export interface AttackPathView {
  routeSignature: string; threatSlug: string | null;
  steps: { order: number; nodeSlug?: string; edgeSlug?: string; label: string; resolved: boolean }[];
  exploitability: unknown; viability: "viable" | "not_viable" | "unknown";
}
export interface ThreatSelection { threatSlug: string | null; targetSlug: string | null; routeSignature: string | null; }
```

## Acceptance criteria
- [ ] STRIDE counts match fixtures and every segment has textual/assistive labeling.
- [ ] Node selection filters the threat list; threat selection highlights every mapped target in one state update.
- [ ] Exactly one selected attack path is rendered, ordered, with unresolved gaps called out.
- [ ] Unknown methodology category remains visible under `other`.
- [ ] Exploitability and human/local viability are not conflated.
- [ ] 2,000-threat/5,000-path fixture keeps bounded DOM and does not recompute aggregate per node.
- [ ] Deep links restore threat/path selection.
- [ ] Four UI states and UI import/token rules pass.

## Test plan
`threat-overlay.test.tsx`
- `STRIDE aggregate`, `node↔table selection`, `deep-link focus`, `one path only`, `unresolved step`, and `unknown category`.
- **Error path:** cached attack path contains malformed steps JSON; affected path shows scoped error while threats/nodes remain usable.
- Performance test asserts virtualized threat rows and memoized aggregation on 2,000 threats.

## Do not
- Do not calculate threat counts with N per-node queries.
- Do not draw all attack paths or use color without glyph/label.
- Do not treat derived exploitability as a human viability decision.
- Do not edit threats, attack paths, or overlays in this package.
- Do not add Lucide or raw colors.

## Open questions
1. If one attack-path step maps to multiple parallel dataflows, highlight all candidates and mark ambiguity; do not choose silently.
2. Confirm methodology vocabulary source/RPC supplied by the frozen cache contract.

