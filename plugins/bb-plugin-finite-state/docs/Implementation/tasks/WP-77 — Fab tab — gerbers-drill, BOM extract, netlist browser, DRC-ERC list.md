# WP-77 — Fab tab — gerbers/drill, BOM extract, netlist browser, DRC/ERC list

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §3 Tab 3, §4, §5 (`hw_violation`), §7.2 (boundary only) · SPEC 00 §5 (binary over `bb.http`) · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-72, WP-73 · **Blocks:** WP-80 (matrix mapping consumes `hw_violation`), WP-81
**Produces a FROZEN artifact:** no — lane-local ingest and UI over the frozen contract; `hw_violation` rows are CACHED and rebuildable

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/fab/violations.ts
    plugins/bb-plugin-finite-state/lanes/hardware/fab/downloads.ts
    plugins/bb-plugin-finite-state/lanes/hardware/ui/fab/FabTab.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/fab/GerberList.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/fab/BomExtract.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/fab/NetlistBrowser.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/ui/fab/ViolationsList.tsx
    plugins/bb-plugin-finite-state/lanes/hardware/fab/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/hardware/ui/fab/**/*.test.tsx

Replace WP-74's fab stub and WP-72's placeholder at the `fab/` backend paths in place.

## Files you must not touch

`server.ts`, `app.tsx`, all frozen artifacts, `package.json`, `pnpm-lock.yaml`, `lanes/hardware/extract/**`, `lanes/hardware/parse/**`, `lanes/hardware/ui/{schematics,board}/**` beyond consuming the shared selection store, `lanes/bom/**` (WP-78 owns HBOM ingest), `lanes/product-security/**` (WP-80 owns the matrix), or any `.kicad_*` file.

## Context

This tab is the outputs that prove the loop reaches manufacturing, and the checks that make it trustworthy. Everything renders from artifacts WP-72 already cached and semantics WP-73 already parsed; this WP adds the DRC/ERC JSON→`hw_violation` ingest, the binary download path, and the four views.

Two boundaries to hold. Gerber/drill bytes go through **`bb.http`** — RPC is JSON-only and binary does not belong in it. And DRC/ERC are verification results, not just reports (SPEC 07 §3, §7.2) — but **mapping `hw_violation` into `verification_results` under the `hardware` matrix column is WP-80's job, not this one.** This WP produces clean, queryable violation rows and a UI; it does not touch the matrix, `verification_results`, or requirement keys. Likewise the BOM extract is *shown* here as the HBOM's source with a link into SPEC 04's cell view; the actual HBOM ingest with `kicad_bom` provenance is WP-78's.

## What to build

1. `violations.ts`: parse the `drc.json`/`erc.json` artifacts (from `kicad-cli … --format json`) into `hw_violation` rows — kind, severity (`error|warning|exclusion`), rule, description, affected references/nets as JSON, coordinates, `run_at`. Ingest replaces the previous run's rows for that project+kind transactionally; a malformed JSON file fails with the artifact path named and leaves prior rows intact.
2. Implement the `hardware.violations.list` handler: paged, filterable by kind and severity, ordered by severity then rule.
3. `downloads.ts`: the `bb.http` route serving gerber/drill files from the cache with correct content-disposition, plus a zip-all-gerbers convenience stream. Path-safe: requests resolve strictly inside `.fs-hw/<project-hash>/`; anything else is refused.
4. `GerberList`: enumerate cached gerber/drill artifacts with layer name, size, freshness (WP-72's `fresh` flag), and download links; stale artifacts carry the re-extract banner idiom — no auto-regeneration.
5. `BomExtract`: render the cached BOM CSV as a table — reference, value, footprint, MPN — presented explicitly as the HBOM's source, with a per-row link into the SPEC 04 HBOM cell view (`bom` nav route) and a note when WP-78 has not yet ingested it.
6. `NetlistBrowser`: browse/search `hw_net` (WP-73's tables) — net name filter, member count, expandable `[{reference, pin}]` nodes; clicking a member reference or a net writes the shared selection store and deep-links to the schematics tab with that selection (the canvas highlight itself is WP-75's behavior).
7. `ViolationsList`: virtualized list with severity (color plus label), rule, description, location; kind and severity filters; empty state distinguishes "checks passed, zero violations" from "DRC/ERC never run". Clicking a violation selects the offending part or net via the shared store and navigates to the schematic. Violations with coordinates but no `refs` fall back to a sheet-location description rather than a dead row.

## Interface contract

    export interface HwViolationRow {
      id: number;
      projectKey: string;
      kind: "drc" | "erc";
      severity: "error" | "warning" | "exclusion";
      rule: string;                    // e.g. "clearance", "isolation"
      description: string | null;
      refs: { references: string[]; nets: string[] };
      at: { x: number; y: number } | null;
      runAt: string;
    }

    export function ingestViolations(db: Database, projectKey: string,
      kind: "drc" | "erc", reportPath: string): { inserted: number };  // throws VIOLATION_REPORT_INVALID

    // hardware.violations.list → { items: HwViolationRow[]; total: number; cursor: string | null }
    // filters: { kind?: "drc" | "erc"; severity?: ("error"|"warning"|"exclusion")[] }

    // bb.http:
    // GET …/http/hw/fab/file?project=<key>&kind=gerber&name=<file>   → bytes, content-disposition
    // GET …/http/hw/fab/gerbers.zip?project=<key>                    → zip stream

## Acceptance criteria

- [ ] A real `kicad-cli` DRC JSON fixture (committed under the project's `expected/`) ingests into `hw_violation` with correct severity, rule, refs, and coordinates; re-ingest replaces rather than accumulates.
- [ ] Gerber and drill files download through `bb.http` with correct filenames; no RPC method returns file bytes.
- [ ] A traversal-shaped download request (`name=../../…`) is refused without touching the filesystem.
- [ ] The BOM table renders the cached CSV and each row links to the SPEC 04 HBOM cell view; the view labels itself as the HBOM's source.
- [ ] Netlist search finds nets by name and members by reference; clicking either writes the shared selection store and navigates to schematics.
- [ ] Clicking a violation selects the offending part/net on the canvas via the same store; a violation with no refs degrades to a location description.
- [ ] "Zero violations" and "never run" are visually distinct states; `hardware.violations.list` is paged and filtered server-side, not in JS over all rows.
- [ ] Every test needing `kicad-cli` output runs from committed fixtures and the suite passes with no KiCad installed.

## Test plan

- `violations.test.ts` — DRC and ERC fixture ingest, severity/rule/refs mapping, transactional replace, exclusion severity preserved; **error path:** malformed JSON throws `VIOLATION_REPORT_INVALID` naming the artifact and prior rows survive.
- `downloads.test.ts` — content-disposition and bytes for a fixture gerber, zip stream contains every layer; **error path:** traversal and absolute-path names refused; missing artifact yields 404, not an empty file.
- `violations-list.test.tsx` — filters, severity rendering (color plus label), click-through selection, the two distinct empty states.
- `netlist-browser.test.tsx` — search, member expansion, selection write + deep link.
- `bom-extract.test.tsx` — CSV rendering including a part with no MPN (bare-null, per WP-73's rule), HBOM link targets.

## Do not

- Do not map violations into `verification_results`, touch the `hardware` matrix column, or key anything by requirement — that is WP-80, and doing it here would collide with its owned files.
- Do not ingest the BOM into HBOM cells or assert `kicad_bom` provenance — WP-78 owns that; this tab only displays and links.
- Do not serve file bytes over RPC, run `kicad-cli` from a view, or auto-regenerate stale artifacts.
- Do not load all violations and filter client-side; the query is server-side and paged.
- Do not write `.kicad_*` files or anything inside `.fs-hw` beyond what `downloads.ts` reads.

## Open questions

1. The DRC/ERC JSON schema differs between KiCad 7 and 8 (item shape and coordinate units changed). Pin the fixture to the CLI version noted in `expected/` and decide whether to normalize both shapes now or gate on the WP-72 minimum version — record the choice in `violations.ts`.
2. `exclusion`-severity items are user-suppressed findings. Decide with WP-80's owner whether exclusions should be visible-but-muted here (recommended) given they will presumably not count against the matrix — the display choice made here becomes the precedent WP-80 inherits.
3. The full gerber layer set (paste, mask, fab layers, drill map formats) varies by project settings. Enumerate from what the extract actually produced rather than a hardcoded layer list, and confirm the zip groups them the way a fab house expects (one flat archive per project).
