# WP-32 — Canvas node types, dataflows & inspector

**Lane:** L4 Product Security · **Spec refs:** SPEC 03 §2.1–§2.2, §2.6, §5.4–§5.5 · Canvas Port §3 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-31 · **Blocks:** WP-33, WP-34
**Produces a FROZEN artifact:** no — replace the WP-31 node module only.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/product-security/canvas/nodes/index.tsx  # replaces stub
plugins/bb-plugin-finite-state/lanes/product-security/canvas/nodes/{ComponentNode,ZoneNode,AssetNode,DataflowEdge,Inspector,Stencil,ContextMenu}.tsx
plugins/bb-plugin-finite-state/lanes/product-security/canvas/nodes/{adapters,selection,useNodeData}.ts
plugins/bb-plugin-finite-state/lanes/product-security/canvas/nodes/*.test.tsx
```

## Files you must not touch
Registration/foundation, frozen contracts, YAML editing, threat overlay, cross-links/layout, theme/dependencies, other lanes, or AS source.

## Context
The canvas reads VERSIONED architecture entities by stable slugs, never server UUID references in authored content. Ship typed component, zone, asset, and dataflow renderers with the familiar AS interaction model. Dataflow YAML uses domain fields, while push adapters later absorb AS POST/PATCH name mismatches. This WP is read/inspect only; WP-35 owns writes. Use Hugeicons/shared-ui/theme tokens and all four states.

## What to build
1. Adapt cached/YAML architecture entities into React Flow nodes/edges keyed by slug. Resolve `id_map` only on the backend; UI models never depend on AS UUIDs.
2. Render component types (`software`, `hardware`, `sensor`, `actuator`, `ecu`, `hsm`, `tee`, `medical_device`, `network`) with a shared accessible visual grammar.
3. Render zones as containers and assets as inspectable nodes/badges. Preserve parent/child layout and clearly flag unresolved slug references.
4. Render dataflows with direction, protocol, encryption, authentication, and bidirectionality. Pair every visual state with text/icon labels.
5. Implement selection, multiselect, fit-to-selection, node/edge focus routes, stencil browsing, context menu shells, and an inspector. Mutating menu items call WP-35 stubs and remain disabled until it lands.
6. Inspector sections: identity, description, criticality, interfaces/technologies, zone, connected flows, affected assets/threat counts, and source file link.
7. Keep large neighbor/threat lists virtualized or paged. Precompute adjacency once per model revision; never join SQLite per node render.
8. Handle loading skeleton, empty architecture CTA, partial/error state with unresolved refs, and unconfigured state.

## Interface contract
```ts
export type ArchitectureKind = "component" | "zone" | "asset" | "dataflow";
export interface ArchitectureNodeData {
  slug: string; kind: Exclude<ArchitectureKind, "dataflow">; name: string;
  componentType?: string; criticality?: string; zone?: string;
  interfaces?: { name: string; protocol?: string; port?: number; direction?: string }[];
  sourceFile: string;
}
export interface ArchitectureEdgeData {
  slug: string; sourceSlug: string; targetSlug: string; protocol?: string;
  encrypted: boolean; authenticated: boolean; bidirectional: boolean; sourceFile: string;
}
export function toCanvasGraph(model: ArchitectureModel): { nodes: Node<ArchitectureNodeData>[]; edges: Edge<ArchitectureEdgeData>[]; unresolved: UnresolvedRef[] };
```

## Acceptance criteria
- [ ] All listed node types and dataflows render from stable-slug fixture data.
- [ ] No AS UUID is displayed or serialized as the authored identity.
- [ ] Zone containment and dataflow directions survive adapter round-trip.
- [ ] Inspector selection is bidirectional with route/focus state and source-file navigation.
- [ ] Unresolved refs are visible and do not crash the graph.
- [ ] Adjacency is computed once per revision; unbounded inspector lists are virtualized/paged.
- [ ] Mutation affordances are disabled/stubbed until WP-35.
- [ ] Loading, empty, error/partial, and unconfigured states use shared UI/tokens/Hugeicons.

## Test plan
`canvas-nodes.test.tsx`
- `each node type`, `zone nesting`, `dataflow semantics`, `selection route`, `inspector content`, and `unresolved ref badge`.
- **Error path:** edge references a missing component; canvas retains valid graph and inspector offers source-file repair path.
- Performance fixture asserts one adjacency build and bounded mounted inspector rows.

## Do not
- Do not write YAML/server data or make context-menu deletion functional.
- Do not expose UUIDs as keys or reimplement layout persistence.
- Do not make per-node RPC/SQL calls.
- Do not use Lucide/custom palette/unbounded DOM lists.

## Open questions
1. Damage scenarios/goals are not first-class v1 nodes; show counts/links in inspector only unless the authoritative registry says otherwise.
2. Confirm whether zone nodes are true React Flow parents in the port or visual hulls; preserve AS behavior where possible.

