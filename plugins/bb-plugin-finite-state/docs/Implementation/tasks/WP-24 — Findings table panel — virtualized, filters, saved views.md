# WP-24 — Findings table panel — virtualized, filters, saved views

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §3.1–§3.2, §6.1 · SPEC 00 §7, §10 · AGENTS.md UI rules · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-22, WP-07 · **Blocks:** WP-25
**Produces a FROZEN artifact:** no — establishes the lane-local frontend composition; frozen `app.tsx` stays untouched.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/register.app.tsx
plugins/bb-plugin-finite-state/lanes/findings/ui/{FindingsPanel,FindingsTable,FindingsHeader,FilterBar,SavedViews,states}.tsx
plugins/bb-plugin-finite-state/lanes/findings/ui/{columns,useFindings,useSavedViews,route}.ts
plugins/bb-plugin-finite-state/lanes/findings/ui/detail/index.tsx  # compiling stub; WP-25 replaces
plugins/bb-plugin-finite-state/lanes/findings/ui/triage/index.tsx  # compiling stub; WP-26 replaces
plugins/bb-plugin-finite-state/lanes/findings/ui/*.test.tsx
```

## Files you must not touch
Composition roots, frozen interfaces, backend modules, the FSDS theme/formatters, package files, or other lanes. WP-25/26 replace only their named stubs.

## Context
The flagship surface must make 4,000 typical rows and the 39,000-row stress fixture feel local. The browser reads cursor-paged SQLite RPC results, never Forge. Use `@tanstack/react-virtual`; anything unbounded is virtualized. All chrome uses `@bb/shared-ui`, Hugeicons, and theme tokens only—no Lucide, emoji, hex, oklch, or arbitrary color classes. Design all four states: loading skeleton, empty, error/stale-with-banner, and unconfigured.

## What to build
1. Replace the frontend stub with one `findings` nav panel and subPath routing for root, `f/<stableKey>`, `view/<savedView>`, `policy`, and `import`. Wire future detail/triage stubs now.
2. Build a virtualized table with overscan and stable row keys. Columns: local state, severity, CVE, component/version, reachability, KEV, EPSS, triage, and age. Group legitimate duplicate cache rows into one stable-key row with a `×N` badge and expandable provenance. Color is always paired with label/glyph.
3. Query cursor pages ahead of scroll without loading all rows into React state. Preserve scroll/cursor/filter state when the detail route opens and closes.
4. Implement filters for severity, reachability, KEV, EPSS band/threshold, component, triage state, finding type, and local-change state. Debounce text input and make URL state serializable.
5. Persist saved views in `bb.storage.kv`: three shipped immutable defaults plus user create/rename/delete. Validate stored JSON, version it, and recover to defaults if corrupt.
6. Implement select-one, shift-range, page, and select-by-predicate semantics. Predicate selection records the filter snapshot and exclusions; it must not materialize 39k ids client-side.
7. Render local state as none/local/conflicted, plus stale/needs-completion when returned. Header pending chip deep-links to the sync review panel filtered to `vexDecision`.
8. Provide loading skeleton, pull-oriented empty state, stale data with dismissible error banner, and unconfigured setup CTA. Keyboard hooks owned by WP-26 attach through the lane-local seam.
9. Meet accessibility: semantic grid/table roles, roving focus, screen-reader labels for badges, visible focus, and no shortcut interception while typing.

## Interface contract
```ts
export interface SavedFindingView {
  schema: "fs-findings-view/v1";
  id: string;
  name: string;
  filter: Omit<FindingsFilter, "cursor" | "limit">;
  sort: { field: string; direction: "asc" | "desc" }[];
  columns: string[];
  builtIn?: boolean;
}
export type FindingSelection =
  | { mode: "explicit"; keys: Set<string> }
  | { mode: "predicate"; filter: SavedFindingView["filter"]; excluded: Set<string>; total: number };
export interface FindingsUiState {
  route: { view?: string; stableKey?: string };
  selection: FindingSelection;
  cursorKey: string | null;
}
```

## Acceptance criteria
- [ ] At the G1 gate, a scripted scroll over the 4,000-row fixture in a live bb instance, measured through `agent-browser` CDP frame tracing, shows no sustained frame time above approximately 16 ms; the 39,000-row fixture does not create 39,000 DOM nodes.
- [ ] No Forge/network request other than plugin RPC occurs while filtering, sorting, or scrolling cached data.
- [ ] Every required filter round-trips through route/view serialization and restores after back/forward.
- [ ] Built-in views are `Untriaged by risk`, `Local changes`, and `Needs attention`; corrupt KV falls back safely.
- [ ] Predicate selection includes unloaded rows and respects explicit exclusions.
- [ ] Duplicate UUID rows collapse to one stable-key decision row with a correct count and expandable row provenance.
- [ ] None/local/conflicted are visually distinct; status never relies on color alone.
- [ ] Loading, empty, error/stale, and unconfigured states have dedicated tests.
- [ ] UI imports are Hugeicons and `@bb/shared-ui` only; token lint is clean.

## Test plan
`findings-table.test.tsx`
- `virtualizer bounds mounted rows`, `cursor page appends without duplicates`, `filters issue expected RPC input`, `route preserves scroll and focus`, and `predicate selection spans unloaded results`.
- **Error path:** malformed saved-view JSON is quarantined and defaults render without a crash.
- **Fault path:** next-page RPC fails; already loaded rows remain visible with retry affordance.
- Accessibility test covers roving focus and screen-reader badge text.
- Vitest component coverage verifies the virtualization proxy (the 39,000-row fixture does not create 39,000 DOM nodes); it does not render in a real browser or measure frame rate. The G1 scripted-scroll trace supplies that evidence.

## Do not
- Do not render an unbounded `.map()` list or fetch all rows for selection.
- Do not call any remote service from React or parse YAML in the browser.
- Do not edit theme/formatter files or introduce a component-local palette/icon library.
- Do not implement finding detail or triage behavior beyond their stubs.
- Do not add push controls; review/push belongs to the sync panel and humans.

## Open questions
1. Confirm whether cursor paging can support arbitrary multi-column sort in the frozen RPC; if not, ship the validated sort subset exposed by WP-22.
2. Column customization is specified, but exact drag/reorder behavior can defer if KV persistence and visibility toggles land.
