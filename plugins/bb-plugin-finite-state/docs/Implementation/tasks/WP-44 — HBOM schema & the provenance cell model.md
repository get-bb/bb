# WP-44 — HBOM schema & the provenance cell model

**Lane:** L5 Bill of Materials · **Spec refs:** SPEC 04 §1.2, §3.2–3.4, §4.1, §4.3–4.5, §6.1, §7.4, §7.9 · SPEC 01 §2–4 · SPEC 00 §5 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-04, WP-05 · **Blocks:** WP-45, WP-46, WP-59
**Produces a FROZEN artifact:** no — the HBOM YAML schema is versioned, but the frozen cross-lane contracts remain owned by WP-03/04/05

> **SPEC 07/08 intake note (2026-08-12).** The provenance vocabulary is now
> open-ended upward: SPEC 07 §7.1 adds `kicad_bom` (confidence 1.0, asserted
> by the design; `source_ref` = schematic path + reference designator, ingest
> in WP-78) and SPEC 08 §4.2.1 adds `svd`/`dfp`/`devicetree` (1.0, vendor-
> declared) and `re_corpus` (0.85). Model provenance as an extensible string
> with a known-values table, not a closed enum, and keep confidence semantics
> per the SPEC 04 amendment section.

## Files you own

    plugins/bb-plugin-finite-state/lanes/bom/hbom/schema.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/types.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/yaml.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/repository.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/mirror.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/seed.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/remote/types.ts, lanes/bom/register.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

No HBOM entity exists upstream. The authoritative artifact is therefore product-security/hbom/hbom.yaml, a VERSIONED, local-only model whose registry entry has server none. SQLite is only a disposable projection. The product's credibility rests on each field being a provenance cell, not a scalar.

Every meaningful cell records value, provenance, source_ref, confidence, by, and at. Agent extraction is always a proposal and requires human acceptance before it is treated as verified, regardless of confidence. Numeric confidence helps prioritization; it never grants human authority. Bare null means unknown and renders as an em dash. A human-authored null means deliberately not applicable and renders n/a.

## What to build

1. Define and validate fs-hbom/v1 with project identity, policy thresholds, stable part IDs, optional board revision, and the complete field set from SPEC 04. Do not add server UUIDs as local identity.
2. Represent each part field with the common cell grammar. Provenance values are as_component, datasheet, bom_import, schematic, inferred, vendor, and human. Confidence is numeric 0 through 1. Human provenance requires confidence 1, actor, and timestamp.
3. Require source_ref for datasheet, bom_import, schematic, and vendor claims. Validate it against the single document ledger. References must resolve to a document digest plus page/region or spreadsheet sheet/cell; a filename alone is insufficient.
4. Preserve candidates, corroborating sources, notes, and acceptance records in YAML. Parsing rejects duplicate part IDs, unknown fields, invalid dates, confidence out of range, and a human cell without the required audit fields.
5. Implement deterministic YAML read/write with compare-and-swap. All mutations supply the SHA-256 they read. A mismatch returns HBOM_STALE and the caller must reload; no last-writer-wins fallback.
6. Rebuild the frozen `hbom_cells` and `hbom_candidates` mirrors from YAML in one transaction. Derive and project `state` plus accepted actor/time from provenance, acceptance, candidates, and policy thresholds during rebuild; these columns accelerate review queries but never outrank the YAML source.
7. Watch product-security/hbom/** through the lane registration seam and rebuild on external edits. Debounce, validate before replacing the mirror, retain the prior valid mirror on malformed YAML, and publish hbom:changed with a project key only.
8. Implement idempotent seed from hardware-typed AS components: hardware, sensor, actuator, ecu, hsm, tee, and medical_device. Seed description/category/security context at modest confidence; part-like prose tokens become candidates, never MPN facts. Procurement fields remain empty.
9. Re-seed by as_component_id, add new components, mark missing seeds without deleting enriched parts, and never touch any cell no longer owned by as_component provenance.

## Interface contract

    export type HbomProvenance =
      | "as_component" | "datasheet" | "bom_import" | "schematic"
      | "inferred" | "vendor" | "human";

    export interface Acceptance {
      by: string;
      at: string;
    }

    export interface HbomCandidate<T> {
      value: T | null;
      provenance: Exclude<HbomProvenance, "human">;
      sourceRef?: DocumentSourceRef;
      confidence: number;
      by: string;
      at: string;
    }

    export interface HbomCell<T> {
      value: T | null;
      provenance?: HbomProvenance;
      sourceRef?: DocumentSourceRef;
      confidence?: number;
      by?: string;
      at?: string;
      note?: string;
      accepted?: Acceptance;
      candidates?: HbomCandidate<T>[];
    }

    import type { DocumentSourceRef } from "../../../shared/contract";

    export interface HbomDocument {
      schema: "fs-hbom/v1";
      project: string;
      asProjectId?: string;
      options: { reviewThreshold: number; exportThreshold: number };
      parts: HbomPart[];
    }

    export function readHbom(root: string): Promise<{ document: HbomDocument; sha256: string }>;
    export function writeHbomCas(root: string, expectedSha256: string, next: HbomDocument): Promise<string>;
    export function rebuildHbomMirror(db: Database.Database, document: HbomDocument): void;

    # product-security/hbom/hbom.yaml
    schema: fs-hbom/v1
    project: acme-router
    options:
      reviewThreshold: 0.90
      exportThreshold: 0.90
    parts:
      - id: HBOM-0001
        asComponentId: null
        mpn:
          value: BCM6755KFEBG
          provenance: bom_import
          sourceRef:
            documentSha256: 8a41...
            locator: { kind: sheet, sheet: Sheet1, cell: A14 }
          confidence: 0.72
          by: bb-agent
          at: 2026-07-29T14:02:11Z
        supplier:
          value: Avnet
          provenance: human
          confidence: 1.0
          by: reviewer-id
          at: 2026-07-30T09:14:00Z
        countryOfOrigin:
          value: null

If shared/contract.ts or the frozen registry names these fields differently, the frozen artifact wins at the boundary. Do not duplicate or cast around it.

## Acceptance criteria

- [ ] Every HBOM field is a provenance cell; no scalar shortcut is accepted.
- [ ] Agent/non-human cells remain proposals until a human acceptance record exists.
- [ ] Bare null and human null round-trip distinctly and derive unknown versus n/a.
- [ ] Document claims without page/region or sheet/cell references are rejected.
- [ ] YAML serialization is deterministic and CAS prevents concurrent panel/agent clobbering.
- [ ] SQLite mirrors can be dropped and rebuilt byte-equivalently from YAML.
- [ ] Seed is idempotent, leaves procurement fields empty, and never overwrites human or document evidence.
- [ ] Malformed external YAML preserves the previous mirror and publishes a recoverable validation error.
- [ ] No upstream push path is created for HBOM.

## Test plan

- schema.test.ts — every field type/enum, human confidence invariant, source-ref requirement, duplicate ID rejection, null semantics, and unknown field failure.
- yaml.test.ts — deterministic bytes, round-trip, CAS success, and stale SHA returns HBOM_STALE without changing the file.
- schema.test.ts source-ref cases — valid PDF page/bbox and sheet/cell, unknown document digest, path traversal text, and malformed cell address.
- mirror.test.ts — rebuild from fixture, candidates preserved, proposal/accepted state derivation, and malformed YAML leaves prior rows intact.
- seed.test.ts — hardware type filter, repeat seed no-op, AS-deleted mark, prose part token becomes candidate, and a human MPN survives re-seed.
- Use real SQLite; never mock it.

## Do not

- Do not let confidence auto-accept an agent claim.
- Do not create a second HBOM document ledger or store the authoritative HBOM in SQLite.
- Do not overwrite a human cell, silently choose among conflicting candidates, or drop historical claims.
- Do not populate MPN, supplier, lifecycle, or country of origin from an AS component description.
- Do not edit frozen contracts to match the older SPEC 04 SQL sketch.

## Open questions

1. Confirm whether the UI needs to expose corroborating-source count as its own derived mirror column; v1 may compute it from candidates at detail-read time if the 6,000-part performance fixture stays within budget.
2. Multi-board products reserve board revision but the one-file versus per-board file model is unresolved. Keep fs-hbom/v1 additive and do not infer a board hierarchy.
3. WP-56 owns canonical source-ref serialization. This WP consumes the frozen DocumentSourceRef shape and must share fixtures with WP-56 rather than declaring a BOM-only codec.
