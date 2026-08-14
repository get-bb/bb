# WP-74 — Schematics tab — React Flow viewport, sheet tree, SVG render (KiCanvas go/no-go spike)

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §3 Tab 1, §9, §11 · SPEC 00 §7 (panel/routing) · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-07, WP-72, WP-73 · **Blocks:** WP-75, WP-76
**Produces a FROZEN artifact:** no — implements the `hardware` nav panel against the WP-71-amended contract; establishes the lane's frontend composition that WP-75/76/77 replace stubs within

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/{HardwarePanel,HardwareHeader,route,states}.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/selection.ts
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/{SchematicsTab,SheetTree,SheetCanvas,SvgSheetNode}.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/schematics/spike/kicanvas-verdict.md
    plugins/bb-plugin-finite-state/lanes/hardware/ui/{schematics/overlay,board,fab}/index.tsx  # compiling stubs; WP-75/76/77 replace
    plugins/bb-plugin-finite-state/lanes/hardware/ui/**/*.test.tsx

## Files you must not touch

`server.ts`, `app.tsx`, all frozen artifacts, `package.json`, `pnpm-lock.yaml`, FSDS theme/formatters, `lanes/hardware/{extract,parse}/**` (WP-72/73's backend), another lane, or any `.kicad_*` file.

## What opens this WP: the KiCanvas go/no-go spike

Before building the render path, time-box **one day** testing KiCanvas against the real projects in `test/fixtures/kicad/`. KiCanvas parses `.kicad_sch`/`.kicad_pcb` in-browser with no KiCad installed; if it renders correctly, the render dependency on `kicad-cli` disappears for the viewers. It is also early alpha, apparently stalled upstream, and only "mostly" supports KiCad 7 — while current designs are KiCad 8/9.

Decision rule (SPEC 07 §11): adopt **for rendering only** and only if it renders the fixture projects correctly; the parser (WP-73), cache (WP-72), linking, and HBOM paths never depend on the renderer either way. If adopted beyond a demo, plan to vendor a fork. **`kicad-cli` SVG stays the plan of record and remains alive as the fallback regardless of the verdict. Do not make a stalled alpha load-bearing.** Record `GO`/`NO-GO` with evidence in `kicanvas-verdict.md`; the rest of this WP assumes the SVG path and is unchanged by a `GO`. Note: adopting KiCanvas would also require its own AMD-0014-style dependency amendment — factor that into the verdict.

## Context

One nav panel `hardware`, subpaths `schematics` · `board` · `fab`. This tab is the demonstrable core of L9: sheet navigator left, canvas right, inspector on demand. The canvas is a `@xyflow/react` viewport — deliberately the same interaction idiom as the TARA canvas (WP-31), so pan/zoom/fit/minimap/selection behave identically across the product. The sheet SVG (from WP-72's cache, served over `bb.http`) mounts inside a custom node; SVG because it is a DOM that WP-75 can hit-test. Selection state is a lane-level store shared across all three tabs — a part selected here stays selected on the board tab.

All data enters through typed RPC hooks; realtime `hardware:changed` is a refetch hint only. bb theme tokens and Hugeicons only; every view designs all four states.

## What to build

1. Run the spike above; write the verdict file first.
2. Replace WP-71's frontend stub: register the `hardware` nav panel with the three subpaths, a project selector in the header when two projects exist (`project_key` discriminator), and stub imports for the WP-75/76/77 paths so later ownership does not collide.
3. Sheet tree from `hardware.sheets.list`: hierarchical navigator with breadcrumb showing the sheet path; selecting a sheet loads its SVG artifact.
4. The canvas: React Flow viewport with a single custom node hosting the sheet SVG (fetched from the `.fs-hw` cache via `bb.http`), pan/zoom/fit-to-view controls, minimap. Lossless zoom — no rasterization. Lazy-load `@xyflow/react` behind the tab.
5. The shared selection store: `{projectKey, reference | netName | null}`, exposed to WP-75/76/77 and to agent-context wiring later. Selecting is possible in this WP only via the sheet tree/search results; hit-testing arrives with WP-75.
6. Stale/re-extract banner: when WP-72 marks artifacts stale (file edited while the panel is open), show a banner offering explicit re-extract. Never trigger extraction automatically.
7. The four states: loading (skeleton sheet list), empty ("No KiCad project in this workspace" with the `.worktreeinclude` hint), error (export failed, showing the `kicad-cli` stderr from WP-72's result), and lane-unavailable (KiCad not installed, shown as the FS-158 hardware advisory — **parsed sheet tree and search still render; only the canvas degrades**, per SPEC 07 §9). Missing KiCad never changes the plugin lifecycle.

## Interface contract

    export interface HardwareSelection {
      projectKey: string;
      kind: "part" | "net" | null;
      reference?: string;          // when kind === "part"
      netName?: string;            // when kind === "net"
    }
    export function useHardwareSelection(): [HardwareSelection, (s: HardwareSelection) => void];

    export interface SheetTreeNode {
      sheetPath: string;
      name: string;
      children: SheetTreeNode[];
    }

    export interface SheetCanvasProps {
      projectKey: string;
      sheetPath: string;
      svgUrl: string | null;       // bb.http artifact URL; null → unconfigured/stale
      overlay?: React.ReactNode;   // WP-75 mounts here
    }

    // bb.http route owned by the lane backend (WP-72), consumed here:
    // GET /api/v1/plugins/finite-state/http/hw/artifact?project=<key>&kind=sheet_svg&sheet=<path>

## Acceptance criteria

- [ ] `kicanvas-verdict.md` exists with a `GO` or `NO-GO`, the fixture projects tested, KiCad file versions, and rendering evidence; a `GO` does not remove the `kicad-cli` SVG path.
- [ ] The `hardware` panel registers with `schematics`/`board`/`fab` subpaths; board/fab render their WP-76/77 stubs without crashing.
- [ ] The fixture project's sheet tree renders hierarchically and clicking a sheet displays its cached SVG in the React Flow viewport with working pan/zoom/fit.
- [ ] With two fixture projects, the header selector switches `project_key` and all queries re-scope.
- [ ] With KiCad absent, the tab shows the lane-unavailable advisory for the canvas while the sheet tree (parsed data) still populates.
- [ ] A stale artifact shows the re-extract banner; no code path regenerates automatically.
- [ ] All four states exist and are tested; no raw colors, no Lucide, no emoji; the React Flow chunk loads only when the tab opens.
- [ ] Selection set from the tree persists when switching to the board tab stub and back.

## Test plan

`schematics-tab.test.tsx` (via `loadPluginApp`/`renderSlot`)

- `sheet tree renders fixture hierarchy and breadcrumb`, `svg node mounts and viewport pans/zooms`, `project selector re-scopes queries`, `selection survives tab switch`.
- **Error path:** artifact fetch 404/failed export renders the error state containing the driver stderr, with retry re-requesting status — not a blank canvas.
- **Lane-unavailable path:** capability `installed: false` renders install guidance while `hardware.sheets.list` data still displays.
- `lazy chunk absent until schematics route opens`.

## Do not

- Do not write a schematic renderer or extend the spike beyond its one-day box — a stalled alpha must not become load-bearing.
- Do not fetch SVGs through RPC (binary goes over `bb.http`), call `kicad-cli` from the frontend, or auto-regenerate anything.
- Do not build hit-testing, hover cards, search UI (WP-75), board (WP-76), or fab (WP-77) — leave their stubs.
- Do not duplicate the TARA canvas foundation wholesale; share the idiom, not the code, unless a module is genuinely lane-agnostic.
- Do not add dependencies — KiCanvas adoption, if `GO`, requires its own amendment first.

## Open questions

1. Heavy sheets: SPEC 07 §9 says measure before optimizing. Record load/zoom timing for the largest fixture sheet in the WP notes; coarse-render-then-swap is a follow-up, not this WP.
2. Single-sheet projects: does the tree collapse to nothing, or show one root node? Recommend one root node so the breadcrumb idiom stays uniform — confirm with design.
3. If the spike is `GO`, which WP owns the KiCanvas integration? Recommendation: a new gated WP after the dependency amendment, not scope creep here.
