# WP-78 — HBOM ingest with `kicad_bom` provenance

**Lane:** L9 Hardware Design Plane · **Spec refs:** SPEC 07 §5, §7.1, §9 · SPEC 04 §4.3–4.5 · SPEC 01 §2 · AMD-0010/AMD-0012 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-73, WP-44 · **Blocks:** WP-81
**Produces a FROZEN artifact:** no — consumes the WP-71-amended schema/registry and the L5 `fs-hbom/v1` document; owns only the ingest path

## Files you own

    plugins/bb-plugin-finite-state/lanes/hardware/hbom/ingest.ts
    plugins/bb-plugin-finite-state/lanes/hardware/hbom/field-map.ts
    plugins/bb-plugin-finite-state/lanes/hardware/hbom/source-ref.ts
    plugins/bb-plugin-finite-state/lanes/hardware/hbom/reextract.ts
    plugins/bb-plugin-finite-state/lanes/hardware/hbom/**/*.test.ts

Replace WP-72's compiling NOT_IMPLEMENTED placeholders at these exact paths in place. The wiring in `lanes/hardware/register.ts` is WP-72's; consume its exported seam, do not edit it.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/bom/**, lanes/hardware/register.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

This WP is the SPEC 04 amendment made real: the HBOM stops being assembled and becomes *derived*, with the design as its citation. Parsed `hw_symbol` rows (WP-73) carry reference, value, footprint, and custom fields including MPN/manufacturer; each becomes a WP-44 provenance cell `{value, provenance, source_ref, confidence, by, at}` with provenance `kicad_bom`, confidence 1.0, and a source ref naming the schematic path plus the reference designator — every HBOM value can name the exact symbol on the exact sheet it came from.

`kicad_bom` values enter as **facts, asserted by the design** — not proposals awaiting acceptance like `document` extractions. But design assertion never outranks a human: an existing `human` or accepted cell is never clobbered; the disagreement surfaces in the review queue with both values and both source refs. The bare-null (`—`, never asserted) versus human-null (`n/a`, deliberately empty) distinction is preserved exactly: a part with no MPN field stays bare-null — never fabricate, never write an empty cell. Ingest works with no KiCad installed; `kicadts` parsing needs no `kicad-cli`.

## What to build

1. A pure field map from `hw_symbol` rows to cell claims: `mpn`, `manufacturer`, `value`, `footprint`, and `description` where a custom field supplies it. Multi-unit symbols (U3A/U3B) collapse to one part's claims keyed by `(project_key, reference)`; two projects with the same refdes stay separate.
2. Part resolution ladder, in order: an explicit `links/hardware.yaml` `hbom_part` mapping (WP-79) when present → exact MPN match against existing parts → create a new part through the L5 service's `createMissingParts` semantics. Never merge two references into one part on value/footprint alone.
3. Route every write through the L5 HBOM repository/merge service via `ctx.service(...)`. CAS, deterministic YAML, and mirror rebuild belong to L5; this WP never writes `hbom.yaml` bytes directly and never reads L5 tables when a service exists.
4. Mark `kicad_bom` cells design-asserted: confidence 1.0, mandatory `KicadSourceRef`, `by` a fixed machine actor, `at` the extraction time. They do not enter the below-threshold review queue on write and need no acceptance record to display as trusted.
5. Conflict handling: an incoming claim that disagrees with a `human` cell, an accepted cell, or a different design-asserted value produces a review-queue conflict entry and leaves the existing cell bytes unchanged.
6. Re-extract on schematic change: given a new `sch_hash`, update only cells whose `sourceRef.sourceHash` differs; identical claims are `noop`. Symbols that vanished mark their `kicad_bom` cells stale in the report — never silently deleted.
7. Make the whole ingest convergent: re-running against the same hash writes nothing and returns the same report shape.
8. Report `{written, unchanged, conflicts, bareNull, staleMarked}` so the panel banner and CLI can state exactly what the design asserted.

## Interface contract

    export interface KicadSourceRef {
      kind: "kicad";
      schPath: string;        // worktree-relative .kicad_sch
      sheetPath: string;
      reference: string;      // U3 — the join key
      sourceHash: string;     // the sch_hash this claim was read from
    }

    export interface KicadCellClaim {
      reference: string;
      field: "mpn" | "manufacturer" | "value" | "footprint" | "description";
      value: string;          // absent field ⇒ no claim, never a null claim
      provenance: "kicad_bom";
      confidence: 1.0;
      sourceRef: KicadSourceRef;
      by: "fs-hardware-ingest";
      at: string;
    }

    export interface IngestReport {
      projectKey: string;
      sourceHash: string;
      written: number;
      unchanged: number;
      conflicts: Array<{ partId: string; field: string; existing: "human" | "accepted" | "kicad_bom"; reference: string }>;
      bareNull: number;       // symbols with no MPN left untouched
      staleMarked: number;    // cells whose symbol vanished at this hash
    }

    export function mapSymbolsToClaims(rows: HwSymbolRow[]): KicadCellClaim[];
    export function ingestKicadBom(services: { hbom: HbomMergeService; links: HardwareLinkReader }, projectKey: string): Promise<IngestReport>;
    export function reextractOnChange(services: { hbom: HbomMergeService }, projectKey: string, newHash: string): Promise<IngestReport>;

If the frozen contract or the L5 schema names these fields differently, the owner's shape wins at the boundary. Do not duplicate or cast around it.

## Acceptance criteria

- [ ] Every ingested value is a full provenance cell; no scalar shortcut is accepted by the L5 boundary.
- [ ] `kicad_bom` cells display as design-asserted facts without an acceptance record and never join the review queue merely for being non-human.
- [ ] An existing human or accepted cell is never modified; the disagreement lands in the review queue with both source refs.
- [ ] A symbol without an MPN field produces no `mpn` cell; bare-null and human `n/a` round-trip untouched.
- [ ] Re-ingest after a schematic edit updates exactly the cells whose `sourceHash` changed, and nothing else.
- [ ] Multi-unit symbols produce one part's claims; duplicate refdes across two projects stays disjoint.
- [ ] Ingest runs with no KiCad installed and never invokes `kicad-cli`.
- [ ] Real SQLite in tests; no cross-lane table reads where an L5 service exists.

## Test plan

- field-map.test.ts — table-driven symbol→claim cases: custom-field MPN, missing MPN, multi-unit merge, per-project isolation, unknown custom fields ignored.
- ingest.test.ts — create/update/noop paths; `human cell conflict routes to review queue and leaves cell bytes unchanged` (**conflict error path**); part-resolution ladder order including the WP-79 link short-circuit.
- reextract.test.ts — hash-scoped update, vanished-symbol stale report, convergent re-run writes zero cells.
- source-ref.test.ts — rejects refs missing schPath/reference/sourceHash and path-traversal text in schPath (**input error path**).

## Do not

- Do not fabricate an MPN, invent a manufacturer from a value string, or let confidence arithmetic auto-accept anything.
- Do not write `hbom.yaml` directly, bypass the L5 CAS/merge path, or create a second HBOM store or ledger.
- Do not delete or overwrite cells for symbols that disappeared; report the drift.
- Do not run `kicad-cli`, add a dependency, or touch frozen files or composition roots.
- Do not create any push path; the HBOM remains local-only per its registry entry.

## Open questions

1. `kicad_bom` versus WP-44's existing `schematic` provenance member: the `HbomProvenance` union lives in L5's `schema.ts`, which this WP must not edit. Prefer an additive `kicad_bom` member landed by the L5 owner before dispatch; if refused, map onto `schematic` with `sourceRef.kind: "kicad"` and record the alias here.
2. Can the frozen `DocumentSourceRef` represent a worktree-schematic locator, or does `KicadSourceRef` stay a lane-local shape beside it? If the frozen shape must carry it and cannot, file an amendment — do not cast.
3. The WP-44 mirror derives proposal/accepted state from provenance plus acceptance; design-asserted-without-acceptance needs a derivation carve-out so the review UI does not render `kicad_bom` cells as pending proposals. Coordinate the rule with L5.
