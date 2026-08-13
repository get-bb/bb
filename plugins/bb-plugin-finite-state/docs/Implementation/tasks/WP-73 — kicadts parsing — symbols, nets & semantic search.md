# WP-73 — kicadts parsing — symbols, nets & semantic search

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §3 (⌘F row), §4 (parsing), §5 (`hw_symbol`/`hw_net`), §9 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-71, WP-72 · **Blocks:** WP-74, WP-77, WP-78, WP-79, WP-81
**Produces a FROZEN artifact:** no — populates the WP-71-amended CACHED tables and implements frozen `hardware.*` read methods

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/parse/sheets.ts
    plugins/bb-plugin-finite-state/lanes/hardware/parse/symbols.ts
    plugins/bb-plugin-finite-state/lanes/hardware/parse/nets.ts
    plugins/bb-plugin-finite-state/lanes/hardware/parse/ingest.ts
    plugins/bb-plugin-finite-state/lanes/hardware/search.ts
    plugins/bb-plugin-finite-state/lanes/hardware/parse/**/*.test.ts
    plugins/bb-plugin-finite-state/test/fixtures/kicad/**  (additions only; see its README)

Replace WP-72's NOT_IMPLEMENTED placeholders at these paths in place; wiring into `register.ts` already exists.

## Files you must not touch

`server.ts`, `app.tsx`, any frozen artifact (`shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`), `package.json`, `pnpm-lock.yaml`, `lanes/hardware/extract/**` (WP-72's), `lanes/hardware/ui/**` (WP-74+'s), any other lane, or any `.kicad_*` file.

## Context

Semantics come from parsing, not from exports (SPEC 07 §4). `kicadts` (`parseKicadSch`, declared in the AMD-0014 batch) is pure TypeScript — **every capability in this WP works with no KiCad installed and must be proven under that condition, because CI has no `kicad-cli`.** The exports provide pixels and fab outputs; this parser provides meaning: the symbol table that drives the overlay (WP-75), search, HBOM ingest (WP-78), and cross-surface linking (WP-79).

`reference` is the product's join key. Multi-unit symbols (U3A/U3B) are keyed `(reference, unit)` and aggregate to one part at the card level. MPN comes from a custom field when present; parts with no MPN are common and legitimate — record null, never fabricate. KiCad 6+ embeds `(lib_symbols …)` in the sheet so geometry is local; KiCad 5 files predate S-expressions and are rejected explicitly, not best-effort parsed.

Search runs over parsed semantics, never SVG glyph text — stroke fonts plot as paths, so in-SVG search is structurally broken anyway (SPEC 07 §9).

## What to build

1. Sheet walk: from `hw_project.sch_path`, parse the root sheet, follow hierarchical sheet references recursively, and produce the ordered sheet tree (path, name, parent) that WP-74's navigator renders. Detect and refuse cycles.
2. Symbol extraction per sheet: `(at X Y angle)`, `Reference`, `Value`, `Footprint`, `unit`, MPN and Manufacturer from custom fields (case-insensitive field-name match on `MPN`/`Manufacturer`), remaining custom fields as a JSON bag. Skip power symbols and unreferenced graphics; keep DNP parts, flagged in `fields`.
3. Net extraction from the parsed schematic (labels, hierarchical pins, wires → connectivity), producing `hw_net` rows with `nodes` as `[{reference, pin}]` JSON. Where `kicadts` connectivity falls short, record the gap explicitly rather than guessing (open question 2).
4. Version gating: read the sheet's format version; files older than the S-expression format fail with `KICAD_VERSION_UNSUPPORTED` naming the file and version, per SPEC 07 §9. The project row stays discoverable so the panel can explain the rejection.
5. Transactional ingest into `hw_symbol`/`hw_net` keyed by `project_key`, stamped with the source hash from WP-72; a failed parse leaves the previous generation intact. Re-ingest only when the source hash changes.
6. Search: implement `hardware.symbols.list` filters — substring on reference/value/footprint/MPN, exact net membership, per-sheet scope — paged `{items, total, cursor}`, ordered by reference natural sort (R2 before R10). This is the backend of ⌘F (WP-75) and of `fs_hw_query` (WP-81).
7. Symbol-set drift: expose a comparison of reference sets between two source hashes of the same project (added/removed/renumbered candidates), the primitive WP-79 uses to report link drift mirroring SPEC 02's re-scan handling.

## Interface contract

    export interface ParsedSheet {
      sheetPath: string;            // project-relative
      name: string;
      parent: string | null;
      pageOrder: number;
      widthMm: number | null;
      heightMm: number | null;
      symbols: ParsedSymbol[];
    }

    export interface ParsedSymbol {
      reference: string;            // "U3" — THE JOIN KEY
      unit: number;                 // 1-based; multi-unit parts repeat reference
      value: string | null;
      footprint: string | null;
      mpn: string | null;           // custom field; never fabricated
      manufacturer: string | null;
      at: { x: number; y: number; angle: number | null };
      fields: Record<string, string>;
    }

    export interface ParsedNet {
      netName: string;
      nodes: { reference: string; pin: string }[];
    }

    export interface ConnectivityGap {
      sheetPath: string;
      kind: "unresolved_label" | "unresolved_hierarchical_pin" |
        "unsupported_bus" | "missing_pin_geometry";
      detail: string;
      at: { x: number; y: number } | null;
    }

    export interface HardwareSemanticScope {
      projectId: string;
      projectVersionId: string | null;
      projectKey: string;
    }

    export function parseProject(worktreeRoot: string, projectKey: string):
      Promise<{ sheets: ParsedSheet[]; nets: ParsedNet[];
        connectivityGaps: ConnectivityGap[] }>;                // throws KICAD_VERSION_UNSUPPORTED
    export function ingestProject(db: Database, scope: HardwareSemanticScope,
      sourceHash: string, parsed: { sheets: ParsedSheet[]; nets: ParsedNet[];
        connectivityGaps: ConnectivityGap[] }): void;
    export function diffSymbolSets(db: Database, scope: HardwareSemanticScope,
      fromHash: string, toHash: string): { added: string[]; removed: string[] };

AMD-0018 retains exactly the newest 20 `hw_ingest` snapshots per scope triple,
pruning older rows inside the replacement transaction. `diffSymbolSets` throws
`HardwareIngestHashNotRetainedError` with code `HW_INGEST_HASH_NOT_RETAINED`
when either requested hash is absent from that bounded ledger; it never returns
an empty diff for an unretained hash. Connectivity gaps are available through
the lane-local `hardwareConnectivityGapsList` read RPC and never appear as nets.

## Acceptance criteria

- [ ] The fixture project parses to `hw_symbol` rows with correct references, positions, and units — with no KiCad installed and no `.fs-hw` artifacts present.
- [ ] A multi-unit op-amp yields one row per `(reference, unit)` and a single aggregated part in the search result shape.
- [ ] A part carrying an `MPN` custom field surfaces it; a part without one has `mpn = null` — no value is invented from Value/Footprint.
- [ ] A KiCad 5 file fails with `KICAD_VERSION_UNSUPPORTED` naming the file; nothing partial lands in `hw_symbol`/`hw_net`.
- [ ] Search finds by reference, value, footprint, and MPN substring and by net membership; results are paged and naturally sorted.
- [ ] Re-parse with an unchanged source hash is a no-op; a failed parse leaves the prior generation queryable.
- [ ] Hierarchical sheets produce a correct tree; a sheet cycle is refused with a named error.

## Test plan

- `symbols.test.ts` — references, positions, angles, units, custom-field extraction, DNP flag, power-symbol exclusion; fixture-driven from `test/fixtures/kicad/`.
- `nets.test.ts` — labeled net, hierarchical connection across sheets, `nodes` JSON shape; **error path:** unresolvable connectivity records an explicit gap, not a fabricated net.
- `version-gate.test.ts` — **error path:** a checked-in KiCad-5-format fragment rejects with `KICAD_VERSION_UNSUPPORTED`; a truncated/corrupt sheet rejects without partial ingest.
- `ingest.test.ts` — transactional replace, hash-gated re-ingest, prior generation survives a mid-ingest throw; real SQLite.
- `search.test.ts` — filter matrix, natural sort (R2 < R10), pagination cursor stability, net-membership query.

## Do not

- Do not shell out to `kicad-cli` or read anything from `.fs-hw` — this WP must work when neither exists.
- Do not fabricate MPNs, references, or net names; null and explicit gaps are the honest outputs.
- Do not search SVG text or store parsed semantics anywhere but the WP-71-amended CACHED tables.
- Do not attempt KiCad 5 compatibility, write `.kicad_*` files, or build UI.
- Do not implement link drift *handling* — WP-79 owns that; you ship only the symbol-set diff primitive.

## Open questions

1. Reference renumbering between revisions is the hardware analogue of SPEC 02's stable-key problem (SPEC 07 §12.6). The diff primitive here reports added/removed; whether a rename heuristic (same value+footprint+position) is worth shipping belongs to WP-79's drift report — do not solve it here.
2. Verify during implementation how much connectivity `kicadts` derives from a `.kicad_sch` alone (wires/junctions vs. labels). If real connectivity requires the netlist export, `hw_net` gains a documented degraded mode when `kicad-cli` is absent — decide and record, don't silently mix sources.
3. KiCad 9 format drift: `kicadts` tracks upstream loosely. Pin the tested KiCad file-format versions in fixture notes so a future parse failure is diagnosable as format drift rather than regression.
