# WP-46 — HBOM extraction merge engine & XLSX export

**Lane:** L5 Bill of Materials · **Spec refs:** SPEC 04 §3.4–3.5, §5.2, §5.6, §6.4–6.6, §7.2, §7.5–7.7, §9.1 · SPEC 05 C12–C13 · SPEC 00 §5, §10 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-44, WP-56 · **Blocks:** WP-59, WP-67
**Produces a FROZEN artifact:** no — writes fs-hbom/v1 and serves exports through routes pre-wired by WP-41

## Files you own

    plugins/bb-plugin-finite-state/lanes/bom/hbom/extract.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/merge.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/export/xlsx.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/export/cyclonedx.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/export/http.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/export/cli.ts
    plugins/bb-plugin-finite-state/lanes/bom/hbom/fixtures/merge-matrix.yaml
    plugins/bb-plugin-finite-state/lanes/bom/hbom/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, lanes/bom/register.ts, shared/contract.ts, frozen store/registry/remote-service files, lanes/documents/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

Extraction does not create facts. It submits cited proposals against a registered document, merges them without information loss, and leaves a CAS-protected YAML diff for human review. A proposal at confidence 0.99 is still a proposal until accepted.

XLSX is the primary deliverable and must carry provenance into the exported artifact. CycloneDX HBOM JSON is optional and cannot be described as conformant until validated against the published schema. Prefer the standard cdx:device property taxonomy where a defined property exists; use fs:hbom names only for gaps and preserve the separate per-field evidence ledger.

## What to build

1. Validate an extraction batch of at most 500 proposals. Each proposal identifies a registered document digest, a part or permitted new-part identity, a schema field, typed value, exact page/region or sheet/cell source, confidence, and extractor identity from execution context.
2. Reject invalid items individually and continue valid items. A source_ref must belong to the declared document and resolve in WP-56's ledger. Image-only sources without OCR coordinates are not acceptable evidence.
3. Implement the precedence order human > datasheet = bom_import = vendor > schematic > as_component > inferred. Confidence never changes precedence and never grants acceptance.
4. Apply the eight merge rules: empty target receives a proposal; higher-precedence proposal takes the visible slot and demotes the old claim; equal/same corroborates; equal/different conflicts; lower precedence becomes a candidate; human cells are immutable; same document/part/field replaces its own prior proposal idempotently; every batch CAS-writes.
5. Never discard candidates or corroborating source references. A proposal that loses precedence remains queryable and reviewable. Return merged, queued, conflicts, candidatesAdded, and item-level rejected counts plus the file path and diff summary.
6. Export XLSX with ExcelJS, lazy-loaded in the backend. Sheets are HBOM, Provenance, Documents, and Summary. Provenance is mandatory. Preserve arrays, unknown versus n/a, source locators, confidence, acceptance actor/time, and competing claims.
7. Full export includes every proposal with explicit proposal styling and notes. Verified-only includes only human-authored or human-accepted cells; withheld values render as an em dash and Summary records count and policy.
8. Stream XLSX through local-auth bb.http. Do not buffer through RPC. Sanitize filenames and dispose of request-owned temporary files.
9. Implement optional CycloneDX 1.7/ECMA-424 mapping as an experimental export. Use component type device, standard manufacturer/supplier/external-reference fields, and applicable cdx:device taxonomy properties. Add fs:hbom properties only where the standard has no slot.
10. Validate every CycloneDX document against a pinned official schema fixture before returning it. If the schema/taxonomy mapping has not been verified, disable the customer-facing route with CDX_HBOM_UNVERIFIED; never emit a compliance claim.
11. Export the pure applyHbomExtraction service for WP-59 to register as fs_hbom_extract. This WP does not register agent tools itself.
12. Export HBOM export command handlers for WP-64. Do not call bb.cli.register; WP-64 owns the single bb finite-state command tree.

## Interface contract

    export interface HbomProposal {
      part: { id: string } | { mpn?: string; referenceDesignator?: string };
      field: HbomField;
      value: unknown;
      sourceRef: DocumentSourceRef;
      confidence: number;
    }

    export interface ExtractionRequest {
      documentSha256: string;
      expectedHbomSha256: string;
      proposals: HbomProposal[];
      createMissingParts: boolean;
    }

    export interface ExtractionResult {
      path: "product-security/hbom/hbom.yaml";
      hbomSha256: string;
      merged: number;
      queued: number;
      conflicts: number;
      candidatesAdded: number;
      rejected: Array<{ index: number; code: string; message: string }>;
      diffSummary: string;
    }

    export function applyHbomExtraction(
      deps: ExtractionDeps,
      actor: AgentActor,
      request: ExtractionRequest,
    ): Promise<ExtractionResult>;

    export type HbomExportMode = "full" | "verified-only";
    export function createHbomWorkbook(deps: ExportDeps, mode: HbomExportMode): Promise<ExportArtifact>;
    export function createCycloneDxHbom(deps: ExportDeps, mode: HbomExportMode): Promise<ExportArtifact>;

    GET /api/v1/plugins/finite-state/http/hbom/export.xlsx
      ?project=<project-key>&mode=full|verified-only

    GET /api/v1/plugins/finite-state/http/hbom/export.cdx.json
      ?project=<project-key>&mode=full|verified-only

    bb finite-state bom hbom export --xlsx|--cdx [--verified-only] -o <file>

The caller cannot set provenance human, accepted, by, or at. The execution context supplies extractor identity and time.

## Acceptance criteria

- [ ] The complete precedence/merge matrix is table-tested and never silently overwrites a visible claim.
- [ ] Re-running the same document extraction is idempotent by document/part/field.
- [ ] Every accepted proposal cites a registered page/region or sheet/cell.
- [ ] Agent output cannot set human provenance or acceptance.
- [ ] Batch partial success reports every rejected item and performs one CAS commit for valid changes.
- [ ] XLSX contains exactly four required sheets and a mandatory complete provenance ledger.
- [ ] Verified-only excludes every unaccepted agent proposal regardless of confidence.
- [ ] XLSX streams through bb.http and not RPC.
- [ ] CycloneDX output is disabled unless official-schema validation passes; standard cdx:device taxonomy is preferred over proprietary duplicates.
- [ ] No customer-facing statement claims FCC, CRA, or CycloneDX compliance merely because an export exists.

## Test plan

- merge.test.ts — the eight rules, equal-rank conflict, human immutable, confidence does not outrank provenance, corroboration, same-source update, createMissingParts false, and stale CAS failure.
- extract.test.ts — 500 cap, partial invalid source refs, actor stamping, image-only no-locator rejection, and item error messages.
- xlsx.test.ts — sheet names, ledger rows, notes, arrays, n/a/unknown distinction, accepted audit data, withdrawn source, and verified-only withheld count.
- export-http.test.ts — auth, MIME, streaming/backpressure, safe filename, disconnect cleanup, and ExcelJS generation failure returns no partial download.
- cyclonedx.test.ts — official schema fixture validation, use of known standard device properties, proprietary fallback namespacing, and invalid mapping returns CDX_HBOM_UNVERIFIED.

## Do not

- Do not pick the highest-confidence disagreement, delete losing claims, or auto-accept.
- Do not allow an extractor to cite an unregistered document or a filename without a page/cell locator.
- Do not make ExcelJS a frontend import or send workbook bytes over RPC.
- Do not invent CycloneDX fields or represent fs:hbom placeholders as standardized.
- Do not use the outdated FCC identifiers in SPEC 04 as export/compliance metadata.
- Do not register CLI commands, agent tools, directives, or mentions from this lane.

## Open questions

1. The precise CycloneDX/ECMA-424 property mapping remains a release gate. Keep the route experimental until schema and semantic validation are both reviewed.
2. Define how multiple boards/revisions select an export scope once WP-44's multi-board model is decided.
3. Excel signing/countersigning is not specified. This WP exports an auditable workbook, not a cryptographic filing signature.
