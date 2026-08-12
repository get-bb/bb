# WP-31 — Canvas spike & React Flow/elkjs port foundation — GATE

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §2.1–§2.2, §6.1 · Canvas Port §1–§3 · Master Plan §11 S1 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-07 · **Blocks:** WP-32–WP-35; this is a go/no-go gate
**Produces a FROZEN artifact:** no — establishes lane-local composition and replacement stubs; plugin composition roots remain frozen.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/register.ts
plugins/bb-plugin-finite-state/lanes/product-security/register.app.tsx
plugins/bb-plugin-finite-state/lanes/product-security/ui/{ProductSecurityPanel,ProductSecurityHeader,route,states}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/canvas/foundation/{CanvasShell,CanvasViewport}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/canvas/foundation/{useCanvasData,elk-worker,types}.ts
plugins/bb-plugin-finite-state/lanes/product-security/canvas/foundation/*.test.tsx
plugins/bb-plugin-finite-state/lanes/product-security/{canvas/nodes,canvas/threat-overlay,canvas/links,canvas/editing}/index.tsx  # compiling stubs; WP-32–35 replace
plugins/bb-plugin-finite-state/lanes/product-security/{requirements/cards,requirements/traceability,requirements/conversion,verifications/matrix,verifications/run-detail}/index.tsx  # compiling stubs; WP-36–40 replace
```

## Files you must not touch
`server.ts`, `app.tsx`, all frozen artifacts, FSDS theme/formatters, dependency/lock files, Assurance Studio source, or another lane. React Flow and elkjs were declared by WP-01; do not add packages.

## Context
This gate proves the 17k-line Assurance Studio React Flow v12 canvas can run inside a bare bb panel before L4 commits. Port, do not redesign: the graph engine and layout are portable; replace the single Next.js theme dependency, Supabase fetchers, and host-specific UI imports. Earlier research allowed Lucide, but authoritative AGENTS.md forbids it: use Hugeicons, `@bb/shared-ui`, and theme tokens only. All four UI states are required. Layout is separate local data and is never pushed.

## What to build
1. Time-box the spike: one representative component node, one dataflow edge, pan/zoom/select, and one elkjs auto-layout inside the real plugin panel/test runtime. Record cold chunk size, load time, layout time, and port blockers in the WP notes.
2. Port only the foundation needed by later packages. Repoint shadcn/cn imports to `@bb/shared-ui`; replace `next-themes` with the bb theme hook; remove Supabase/realtime/permission imports from the UI boundary.
3. Make all data enter through typed plugin RPC hooks against local cache/YAML. No browser Forge calls. Keep viewport data separate from semantic model data.
4. Lazy-load `@xyflow/react`, node/edge implementations, and elkjs behind the `tara` tab. Run elkjs in a Web Worker; show progress and allow cancel/retry.
5. Establish one lane-local frontend/back-end composition now, importing compiling stubs for WP-32–40. Later WPs replace only their paths and never edit registration files.
6. Register the `product-security` nav panel with `tara`, `requirements`, and `verifications` subpaths, pending-change chip, and sync-panel deep link.
7. Create loading skeleton, no-model empty state, scoped error/stale banner, and unconfigured state. A warm-cache canvas remains readable when Forge is offline.
8. Prove performance/accessibility: visible-element rendering, keyboard focus, zoom controls with labels, reduced-motion handling, and no automatic elk layout over 200 nodes.
9. End with an explicit gate verdict. If one node plus layout cannot run reliably within four days, document the blocker and stop WP-32–35; do not conceal it with a custom graph rewrite.

## Interface contract
```ts
export interface CanvasModel {
  nodes: CanvasNodeModel[];
  edges: CanvasEdgeModel[];
  cache: { pulledAt: string | null; stale: boolean };
}
export interface CanvasViewportState { x: number; y: number; zoom: number; selectedIds: string[]; }
export interface CanvasDataSource {
  read(projectId: string): Promise<CanvasModel>;
  subscribe(onHint: () => void): () => void; // global realtime is filtered client-side
}
export interface LayoutRequest { nodes: Pick<CanvasNodeModel, "id" | "width" | "height">[]; edges: Pick<CanvasEdgeModel, "source" | "target">[]; direction: "RIGHT" | "DOWN"; }
export interface LayoutResult { positions: Record<string, { x: number; y: number }>; durationMs: number; }
```

## Acceptance criteria
- [ ] The real bb panel renders one ported AS node and edge with working pan/zoom/select.
- [ ] elkjs runs in a worker and the main thread remains responsive; 200-node fixture layout has recorded timing.
- [ ] Canvas code has no Next.js, Supabase, Lucide, emoji, raw color, or browser Forge import.
- [ ] TARA chunk is absent until the tab opens and a skeleton renders during load.
- [ ] All semantic reads go through RPC/local data source; offline warm-cache read works.
- [ ] Loading, empty, stale/error, and unconfigured states are designed and tested.
- [ ] Registration files import all WP-32–40 stubs so later ownership does not collide.
- [ ] Gate report says `GO` with measurements or `NO-GO` with a reproducible blocker.

## Test plan
`canvas-spike.test.tsx`
- `lazy chunk loads on tara route`, `one node/edge interaction`, `theme switches through host tokens`, `offline warm-cache`, and `elk worker returns stable positions`.
- **Error path:** worker crash/timeout keeps the existing layout visible and offers Retry; it does not blank the canvas.
- **Portability guard:** forbidden import scan for Next.js, Supabase, Lucide, and direct Forge.

## Do not
- Do not edit composition roots or add dependencies.
- Do not port AS autosave/realtime/permissions wholesale.
- Do not build a parallel canvas, iframe, Mermaid replacement, or custom layout engine.
- Do not store/push semantic edits in this spike.
- Do not let a failed gate drift into downstream implementation.

## Open questions
1. `html-to-image` is not required for the gate; omit export unless already declared and trivial.
2. Record whether React Flow's visible-elements option is sufficient at the 500-node target before considering additional culling.
