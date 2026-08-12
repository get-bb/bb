# WP-34 — Canvas cross-surface links & layout persistence

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §2.4–§2.5, §5.1, §8.3 · Canvas Port §3 Phase 4 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-32 · **Blocks:** WP-35
**Produces a FROZEN artifact:** no — layout/link files are local/versioned data, excluded from sync push.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/canvas/links/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/canvas/links/{CrossSurfaceLinks,LinkReadiness,layout}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/canvas/links/{resolver,layout-store,schema}.ts
plugins/bb-plugin-finite-state/lanes/product-security/canvas/links/*.test.tsx
```

## Files you must not touch
Canvas foundation/nodes/editing, other surface implementations, sync engine/registry, frozen files, theme/dependencies, or composition roots.

## Context
One workspace pays off when a TARA node links to its SBOM component, firmware files, mitigating requirements, and verification runs. These joins use public lane contracts/readiness, not direct imports into another lane's database internals. Canvas positions live at `product-security/layout/canvas.json`, separate from semantic YAML, git-tracked by default, and **never planned or pushed**. Pan/zoom is session-only. Use CAS and minimize git churn.

## What to build
1. Resolve four link families for the selected stable component slug: SBOM entry, firmware paths, requirements/mitigations, and verification runs. Return readiness and provenance for each mapping.
2. Read explicit `.fs/links/sbom.yaml` and `.fs/links/firmware.yaml` mappings through validated schemas. SBOM links may participate in their own overlay semantics; firmware links are local-only and never pushed.
3. Render link rows in the inspector with Hugeicons/shared UI. Ready links navigate through bb APIs; unavailable surfaces explain `not pulled`, `not mapped`, or `not implemented` and offer the safe next action.
4. Define `fs-canvas-layout/v1` keyed only by stable slugs. Persist node x/y and collapsed state, integers, stable key order, CAS, and 500 ms debounce after actual node changes.
5. Never persist pan/zoom/selection. Do not write for layout results equal after rounding. Handle concurrent layout edits with reload/compare instead of overwrite.
6. Merge newly discovered nodes with stored positions: retain known nodes; place new nodes using elkjs; retain orphan positions in the file only long enough to report/prune explicitly.
7. Register layout as a `server:"none"` VERSIONED entry with `localOnly:true` and the plan exclusion seam if it is not already frozen there. Local-only is a capability, not a fifth entity class. If the frozen registry cannot represent it, write an amendment—do not edit it.
8. Cover loading links, no mappings, partial downstream errors, and unconfigured; the canvas remains usable when every linked surface is absent.

## Interface contract
```ts
export interface CanvasLayoutV1 {
  schema: "fs-canvas-layout/v1";
  project: string;
  nodes: Record<string, { x: number; y: number; collapsed?: boolean }>;
}
export interface CrossSurfaceLink {
  kind: "sbom" | "firmware" | "requirement" | "verification";
  sourceSlug: string;
  target: string;
  label: string;
  ready: boolean;
  reason?: "not_pulled" | "not_mapped" | "unavailable";
  provenance?: { source: string; at?: string };
}
export function saveLayout(root: string, next: CanvasLayoutV1, expectedSha256?: string): Promise<{ file: string; sha256: string; changed: boolean }>;
```

## Acceptance criteria
- [ ] A mapped node exposes working links to all four surfaces when their readiness contracts are available.
- [ ] Missing/unpulled surfaces never produce dead navigation or canvas failure.
- [ ] Layout file contains only stable slug positions/collapse state; no UUID, viewport, selection, or semantic fields.
- [ ] Layout is excluded from every sync plan/push test.
- [ ] Drag bursts produce at most one CAS write after 500 ms; unchanged rounded positions produce none.
- [ ] Concurrent layout edit fails closed and preserves newer bytes.
- [ ] New nodes receive layout without moving existing stored nodes.
- [ ] Four UI states and Hugeicons/shared-ui/theme-token rules pass.

## Test plan
`canvas-links-layout.test.tsx`
- `four link kinds navigate`, `readiness degradation`, `layout round-trip`, `debounced minimal write`, `new-node merge`, and `plan excludes canvasLayout`.
- **Error path:** CAS conflict shows reload/compare and never overwrites external layout edits.
- **Fault path:** SBOM link RPC fails while firmware/requirements links remain interactive.

## Do not
- Do not push canvas layout or firmware links to AS.
- Do not persist viewport/pan/zoom or write on every drag event.
- Do not reach directly into another lane's tables/components.
- Do not use UUIDs as layout keys or silently prune orphan positions.
- Do not make downstream surfaces hard dependencies.

## Open questions
1. Default is tracked shared layout; if user testing shows excessive git noise, a later setting may make it ignored—do not change the default here.
2. The exact public cross-lane readiness interface may live in the frozen contract; adapt the resolver to it rather than creating imports across lanes.
