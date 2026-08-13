# WP-76 — Board tab — GLB view, 2D board SVG, stackup card

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §3 Tab 2, §4, §9 (GLB row) · SPEC 00 §5 (binary over `bb.http`) · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-72, WP-74 · **Blocks:** WP-81 (and the `::fs-board` directive it registers)
**Produces a FROZEN artifact:** no — lane-local UI plus one lane-local board parser over the frozen contract

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/parse/board.ts
    plugins/bb-plugin-finite-state/lanes/hardware/ui/board/BoardTab.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/board/GlbView.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/board/Board2d.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/board/StackupCard.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/board/**/*.test.{ts,tsx}
    plugins/bb-plugin-finite-state/lanes/hardware/parse/board.test.ts

Replace WP-74's board stub in place. `parse/board.ts` extracts footprint positions and stackup — coordinate with WP-73's parse-module conventions (transactional ingest, hash-gated).

## Files you must not touch

`server.ts`, `app.tsx`, all frozen artifacts, `package.json`, `pnpm-lock.yaml`, `lanes/hardware/extract/**`, `lanes/hardware/parse/{sheets,symbols,nets,ingest}.ts` (WP-73's), `lanes/hardware/ui/schematics/**` beyond consuming the shared selection store, `lanes/hardware/ui/fab/**`, another lane, or any `.kicad_*` file.

## Context

The 3D view renders the GLB that WP-72 exported from `.kicad_pcb`, via **`@google/model-viewer`** (declared in the AMD-0014 batch): it takes a URL and renders, with no React-reconciler entanglement. The spec explicitly flags the alternative — `@react-three/fiber` bundles the React reconciler and is pinned to React 19.0–19.2, with 19.2's internal reconciler bump *not* backward compatible with 19.1 (SPEC 07 §3 Tab 2). That hazard is why R3F is **not** used here; it remains a documented upgrade path for when scene control is actually needed, behind its own future amendment.

GLB export can be slow and large: **never generate during a demo** (SPEC 07 §9). The view renders the cached artifact or shows the not-yet-extracted empty state offering explicit extraction — it never triggers export itself.

The 2D view reuses WP-75's overlay technique, driven by footprint positions parsed from `.kicad_pcb` rather than symbol origins from the schematic. Reference designators are identical across both files — that is the join — so WP-74's shared selection store makes a part selected on the schematic arrive here already selected. Stackup and design rules come from `.kicad_pro`/`.kicad_dru`, rendered as a reference card that answers "what are the isolation requirements on this board."

## What to build

1. `parse/board.ts`: `kicadts` parse of `.kicad_pcb` for footprint placements (reference, layer, `at` x/y/rotation, footprint name) and board outline/page bounds; parse `.kicad_pro` for the stackup (layers, materials, thicknesses) and `.kicad_dru` for design rules where present. Pure TS, no KiCad required. Ingest placements keyed by `project_key` + source hash, following WP-73's transactional/hash-gated idiom.
2. `GlbView`: `<model-viewer>` wrapping the cached GLB served over `bb.http` (same artifact route family as WP-74's SVGs), with camera controls and a poster/skeleton while loading. If the GLB artifact is absent or stale, show the empty/stale state with an explicit extract action — never auto-export.
3. `Board2d`: the cached board SVG in the shared viewport idiom, with WP-75's transform/hit-target technique over footprint positions. Layer toggles (front/back at minimum: filter targets by footprint layer; the SVG itself toggles per available per-layer artifacts or renders as exported). Hover card and click-to-select reuse WP-75's components.
4. Selection persistence: on tab open, read the shared store — a part selected on the schematic is centered and ringed here; selecting here writes back the same store. Parts without a footprint (schematic-only) show a "not placed" notice instead of a silent no-op.
5. `StackupCard`: layer count and ordering, copper weights/dielectrics where declared, and the design-rule summary (clearances, track widths) from `.kicad_dru`. Absent `.kicad_dru` renders the KiCad-default note, not an error.
6. States: loading (skeleton) · empty (no `.kicad_pcb` in the project — legal, board tab says so) · error (parse or artifact failure with stderr where it exists, plus retry) · unconfigured (KiCad absent: **parsed placements and the stackup card still work; GLB and board SVG degrade** — same split as the schematic tab).

## Interface contract

    export interface FootprintPlacement {
      reference: string;             // joins hw_symbol.reference
      footprint: string;
      layer: "F.Cu" | "B.Cu" | string;
      at: { x: number; y: number; rotation: number | null };
    }

    export interface BoardStackup {
      layers: { name: string; type: string; thicknessMm: number | null; material: string | null }[];
      rules: { name: string; value: string }[];   // from .kicad_dru; empty when absent
    }

    export function parseBoard(worktreeRoot: string, projectKey: string):
      Promise<{ placements: FootprintPlacement[]; outline: { widthMm: number; heightMm: number };
                stackup: BoardStackup }>;

    // GLB/board-SVG bytes ride the WP-72 bb.http artifact route:
    // GET …/http/hw/artifact?project=<key>&kind=glb
    // GET …/http/hw/artifact?project=<key>&kind=board_svg

## Acceptance criteria

- [ ] The fixture board's GLB renders in `<model-viewer>` from the cached artifact; no code path exports a GLB at view time.
- [ ] `@react-three/fiber`, `three`, and `drei` appear nowhere; the reconciler-pinning rationale is noted where `GlbView` is defined.
- [ ] The 2D view places hit targets at footprint positions matching the parsed placements within the fixed radius; layer toggle filters front/back targets.
- [ ] Selecting a part on the schematic tab then opening the board tab shows it selected and centered; a schematic-only part yields the "not placed" notice.
- [ ] The stackup card renders the fixture's layer stack; a project with no `.kicad_dru` shows defaults language, not an error.
- [ ] A project with no `.kicad_pcb` shows a designed empty state; nothing throws.
- [ ] With KiCad absent, placements and stackup (parsed) render while GLB/SVG show unconfigured.
- [ ] Board parsing is hash-gated and transactional like WP-73's ingest.

## Test plan

- `board.test.ts` (parser) — fixture placements (reference/layer/rotation), outline bounds, stackup layers, `.kicad_dru` present and absent; **error path:** corrupt `.kicad_pcb` rejects without partial ingest and the prior generation survives.
- `glb-view.test.tsx` — cached-artifact URL wiring, loading poster, stale artifact renders the banner with explicit extract; **error path:** artifact 404 renders the error state with retry, and no extract job is started implicitly.
- `board2d.test.tsx` — target positions from placements, layer toggle filtering, selection round-trip with the shared store, "not placed" notice.
- `stackup-card.test.tsx` — layer table rendering, rules list, absent-dru default note.
- All tests run with no `kicad-cli`; artifact-dependent cases use committed `expected/` fixtures or skip cleanly per the fixture README.

## Do not

- Do not add `@react-three/fiber` or any dependency beyond the AMD-0014 batch; scene control beyond `<model-viewer>` is a future amendment.
- Do not generate GLB, SVG, or any artifact from a render path or demo flow — cached artifacts only, extraction is always explicit.
- Do not fork a second selection mechanism; the WP-74 store is the only one.
- Do not duplicate WP-75's transform/hit-target code — import it; only the position source (footprints vs. symbol origins) differs.
- Do not write `.kicad_*` files or reach into `.fs-hw` paths directly from the frontend; bytes come over `bb.http`.

## Open questions

1. GLB size for a dense board is unmeasured. If the fixture GLB exceeds a few tens of MB, the artifact route needs range/streaming support and the view a progressive poster — measure and record before optimizing.
2. Whether `kicad-cli pcb export svg` can emit per-layer SVGs worth toggling individually (vs. one composite) varies by version; decide the layer-toggle granularity from what the pinned CLI actually produces and record it with the fixture `expected/` outputs.
3. 2D board coordinates: `.kicad_pcb` uses board-space mm with its own origin conventions, not the schematic page transform. Confirm the origin/axis mapping against the fixture the same way WP-75 pinned the schematic Y axis — by assertion, not assumption.
