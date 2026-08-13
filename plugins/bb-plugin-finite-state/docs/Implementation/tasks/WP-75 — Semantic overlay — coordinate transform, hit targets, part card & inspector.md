# WP-75 — Semantic overlay — coordinate transform, hit targets, part card & inspector

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §3 (semantic overlay, interactions table), §4 (the sanctioned shortcut), §6 (what the card links to) · SPEC 00 §7 (self-fetching domain components) · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-74 · **Blocks:** WP-81 (and the `::fs-part` directive it registers)
**Produces a FROZEN artifact:** no — lane-local UI over the frozen `hardware.*` read contract

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/transform.ts
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/HitLayer.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/PartCard.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/Inspector.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/SemanticSearch.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/net-highlight.ts
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/overlay/**/*.test.{ts,tsx}

Replace WP-74's overlay stub in place; `SheetCanvas` already exposes the `overlay` mount point.

## Files you must not touch

`server.ts`, `app.tsx`, all frozen artifacts, `package.json`, `pnpm-lock.yaml`, `lanes/hardware/{extract,parse}/**`, `lanes/hardware/ui/{board,fab}/**` (WP-76/77), `lanes/hardware/ui/schematics/{SheetTree,SheetCanvas}.tsx` beyond consuming their props, another lane, or any `.kicad_*` file.

## Context

KiCad's SVG export is graphics — paths and text with no component identity. Identity comes from WP-73's parsed symbol table: every symbol's `(at X Y angle)` in schematic coordinates, plus the page size and the SVG `viewBox`, yield the transform that positions transparent hit targets over the render. The result is a schematic where hovering a part shows a card and clicking selects it — without anyone having written a renderer.

The spec sanctions one shortcut and forbids its opposite (SPEC 07 §4): **fixed-radius hit targets at symbol origins**. True bounding boxes (rotation, mirroring, pin extents) cost a day and buy very little — refuse them.

`PartCard` follows the house convention: it takes `projectKey` + `reference` and self-fetches, so WP-81's `::fs-part{ref}` directive renders the identical component inside an agent message. Multi-unit symbols aggregate: one card for U3, listing units A/B with their sheets. Two card fields — HBOM confidence and open CVE count — depend on WP-78/79 data that does not exist yet; render bare-null (`—`) until those lanes populate, never a fabricated zero.

## What to build

1. `transform.ts`: pure functions mapping schematic mm coordinates → SVG user units → viewport pixels, derived from the sheet's page size (parsed by WP-73) and the artifact SVG's `viewBox`/dimensions. KiCad's Y axis grows downward in sheet coordinates — verify against the fixture and encode the answer in a test, not a comment.
2. `HitLayer`: for the active sheet, one transparent fixed-radius target per `(reference, unit)` at the transformed symbol origin, mounted over the SVG inside the React Flow node so targets pan/zoom with the render. Keyboard focusable, in natural reference order.
3. Hover card: reference, value, footprint, HBOM confidence, open CVE count (SPEC 07 §3 interactions table). Monospace identifiers, severity as color plus label, bare-null for absent joins.
4. Click-to-select: writes WP-74's shared selection store (so board/fab tabs and, later, agent context see it). Selected target gets a visible ring; `Esc` clears.
5. `Inspector`: on-demand right panel for the selected part — all parsed fields including the custom-field bag, per-unit placement, nets touching the part (from `hw_net.nodes`), and the cross-surface link section (rows appear as WP-78/79 land; until then the section states what is not yet linked).
6. Net interaction: clicking a net name (inspector or search result) highlights all member symbols' targets on the sheet and lists connected parts; selection store carries `kind: "net"`.
7. `⌘F` semantic search: opens a palette querying `hardware.symbols.list` (WP-73's backend — parsed semantics, never SVG glyphs); choosing a result navigates to the sheet, centers the viewport on the symbol, and selects it. Paged results; debounced input.

## Interface contract

    export interface SheetTransform {
      toSvg(at: { x: number; y: number }): { x: number; y: number };
      hitRadiusPx(zoom: number): number;    // fixed base radius, zoom-compensated, clamped
    }
    export function buildTransform(page: { widthMm: number; heightMm: number },
      viewBox: { x: number; y: number; w: number; h: number }): SheetTransform;

    export interface PartCardProps {
      projectKey: string;
      reference: string;            // self-fetches via hardware.part.get
    }

    // hardware.part.get response shape this UI consumes (frozen in WP-71):
    // { reference, value, footprint, mpn, manufacturer,
    //   units: [{ unit, sheetPath, at }],
    //   nets: string[],
    //   hbom: { partKey: string; confidence: number } | null,   // null until WP-78
    //   openCveCount: number | null }                            // null until WP-79

    export function highlightNet(netName: string,
      symbolsOnSheet: ParsedSymbolRef[]): string[];  // references to ring

## Acceptance criteria

- [ ] For the fixture project, every symbol's hit target lands on its rendered symbol within the fixed radius at 100% zoom — verified numerically from parsed `at` vs. expected SVG positions, not by eyeball.
- [ ] Hover shows reference, value, footprint, and bare-null (`—`) HBOM/CVE fields when unlinked; no fabricated values.
- [ ] Click selects and updates the shared store; the selection survives a tab switch and `Esc` clears it.
- [ ] A multi-unit part presents one card aggregating its units with per-unit sheet locations.
- [ ] `⌘F` finds by reference, value, and footprint via RPC; selecting a result on another sheet navigates, centers, and selects.
- [ ] Net click rings every member part on the active sheet and lists connected parts.
- [ ] Hit targets are true bounding boxes nowhere in the code; the radius shortcut is documented at the definition site.
- [ ] Targets are keyboard-reachable; all four states remain intact under the overlay.

## Test plan

- `transform.test.ts` — mm→viewBox→pixel round-trips on fixture page sizes, Y-axis orientation pinned by assertion, non-zero viewBox origin, radius clamping across zoom extremes.
- `hit-layer.test.tsx` — target count equals `(reference, unit)` rows for the sheet, positions match transform output, click writes the store; **error path:** a symbol whose sheet SVG is missing (stale cache) renders no orphan target and the banner remains visible.
- `part-card.test.tsx` — self-fetch by props, aggregated units, bare-null joins; **error path:** `hardware.part.get` failure renders the card's error state with retry, not an empty shell.
- `search.test.tsx` — RPC-backed query, cross-sheet navigation + centering, empty-result state, debounce.
- `net-highlight.test.ts` — member resolution from `hw_net.nodes`, parts absent from the active sheet listed but not ringed.

## Do not

- Do not compute rotated/mirrored bounding boxes or per-pin hit areas — the fixed-radius shortcut is the sanctioned design.
- Do not read `.kicad_sch` or parse anything in the frontend; all semantics arrive via RPC from WP-73's tables.
- Do not search SVG text nodes, scrape glyphs, or invent HBOM confidence / CVE counts before WP-78/79 populate them.
- Do not build the `::fs-part` directive registration (WP-81) — only make `PartCard` directive-ready by the id-props/self-fetch convention.
- Do not add dependencies or touch the frozen contract for missing card fields; file an amendment instead.

## Open questions

1. The fixed radius needs one tuning pass against the densest fixture sheet — a value that works on a sparse sheet may overlap on a dense one. Record the chosen base radius and its rationale; overlapping targets resolve nearest-origin-wins.
2. The card's open CVE count is only as real as the MPN→SBOM mapping, which SPEC 07 §12.1 leaves to an owner ruling that blocks WP-79 — not this WP. Keep the field nullable and make no claim about it in demos until WP-79 lands.
3. If `viewBox` metadata differs across `kicad-cli` versions (7 vs 8 output), the transform needs a per-version fixture in `expected/`. Verify while testing and record which versions are covered.
