# WP-56 — Documents store, viewer, extraction overlay & upload

**Lane:** L6 Documents · **Spec refs:** SPEC 05 C11–C13, X14–X15 · SPEC 04 §3.4, §4.4, §5.7 · SPEC 00 §5, §7, §10 · RECON §2.5–2.6, Part 3 correction 10 · **Effort:** 3.5 d · **Status:** unassigned
**Depends on:** WP-04, WP-07 · **Blocks:** WP-46, WP-58, WP-59, WP-61
**Produces a FROZEN artifact:** no — consumes the single frozen document ledger and defines a lane-local source-reference codec shared with BOM

## Files you own

    plugins/bb-plugin-finite-state/lanes/documents/register.ts
    plugins/bb-plugin-finite-state/lanes/documents/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/documents/store.ts
    plugins/bb-plugin-finite-state/lanes/documents/source-ref.ts
    plugins/bb-plugin-finite-state/lanes/documents/search.ts
    plugins/bb-plugin-finite-state/lanes/documents/http/upload.ts
    plugins/bb-plugin-finite-state/lanes/documents/http/content.ts
    plugins/bb-plugin-finite-state/lanes/documents/app/documents-panel.tsx
    plugins/bb-plugin-finite-state/lanes/documents/app/document-viewer.tsx
    plugins/bb-plugin-finite-state/lanes/documents/app/extraction-overlay.tsx
    plugins/bb-plugin-finite-state/lanes/documents/app/document-opener.tsx
    plugins/bb-plugin-finite-state/lanes/documents/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/documents/app/**/*.test.tsx

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lanes/bom/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

Documents are plugin-local in v1 because direct AS signed-upload/finalize/download operations are not yet frozen and handler-verified. Forge is not a document transport, and there is no generic raw request seam. The single tracked content-addressed store and frozen document ledger remain authoritative locally; `hbom_docs` is a view.

Documents are evidence, not a filing cabinet. A PDF extraction must cite a page and preferably a region. A spreadsheet extraction must cite sheet and cell/range. Those locators are shared with HBOM so a reviewer can open the exact evidence behind a proposal.

## What to build

1. Replace both Documents lane registration stubs. Register frozen RPC methods, local-auth upload/content HTTP routes, one Documents nav panel, and file openers for PDF, CSV/XLSX, SVD, and recognized register-map/header content. Export document command/search services for WP-64/WP-58; do not register CLI or agent tools here.
2. Implement multipart upload through bb.http. Allow PDF, CSV, XLSX, SVD/XML, and bounded text/header formats. Default cap is 50 MiB. Validate declared MIME, magic/structure where practical, size, and sanitized filename.
3. Stream upload to a request-owned staging file while hashing SHA-256. Atomically promote to `product-security/documents/<sha256>-<name>` inside the explicitly selected project/version worktree. Identity is `(projectId, projectVersionId, sha256)`; identical bytes in that scope are idempotent and return the existing ledger row.
4. Insert/update the single frozen document row only after the file is durable. Every query and row carries the explicit D-1 `projectId` plus nullable `projectVersionId` pair; only the store boundary maps null to `PROJECT_LEVEL_VERSION_ID`, and HTTP/RPC reject external `"@project"`. `doc_kind` is datasheet, bom, schematic, spec, regulatory, register_map, or other as permitted by the frozen contract; do not create a second HBOM ledger.
5. Implement safe local-auth content/download routes with range support for preview. Require the explicit project/version pair and resolve by scoped document SHA from SQLite, never by a caller path or an unscoped digest. Add nosniff and a safe Content-Disposition.
6. Define the canonical structured source reference and a reversible string codec. PDF refs include document SHA, 1-based page, and optional normalized bbox. Sheet refs include SHA, exact sheet, and A1 cell/range. Text refs include SHA and 1-based line range.
7. Populate `document_extraction` from validated proposals. Store the canonical `source_ref` plus its typed PDF page/bbox, sheet/cell, or text-line projection, field/value/confidence, review status, actor/time, and an optional validated target. HBOM/requirements files remain authoritative for target linkage; repository reads reconcile or reverse-join them instead of treating the projection as hidden truth.
8. Implement paged document list and extracted-structure search with the shared `pageSize`/`continuation` input and opaque `next` output. Search predicates begin with the explicit project/version pair and return document SHA/name/kind plus exact source refs and bounded snippets; they never return full document text or binary.
9. Build a split list/viewer. PDF uses a sandboxed authenticated content preview; XLSX/CSV renders a bounded sheet preview; SVD/register maps render structured sections. Virtualize long lists/sheets.
10. Render extraction overlays at page/region or sheet/cell. Each proposal shows value, confidence, target link when a reverse join resolves, and review state from the owning surface. Overlay coordinates never imply OCR precision that was not recorded.
11. fileOpener components self-fetch by document/file identity. A file outside the ledger offers Register document before extraction.
12. Publish the logical `documents.changed` event with `projectId`, `projectVersionId`, and document SHA only. Implement loading, empty/add-document, retryable stale/error, and unconfigured states.
13. Export pure search/record/source-ref services for WP-46/58/59. This WP does not register an extraction agent tool or upload to AS.

## Interface contract

    import type { DocumentLocator, DocumentSourceRef } from "../../../shared/contract";

    export interface DocumentScope {
      projectId: string;
      projectVersionId: string | null;
    }

    export interface DocumentRecord {
      projectId: string;
      projectVersionId: string | null;
      sha256: string;
      name: string;
      path: string;
      kind: string;
      mimeType: string;
      bytes: number;
      uploadedAt: string;
    }

    export interface DocumentSearchHit {
      projectId: string;
      projectVersionId: string | null;
      documentSha256: string;
      documentName: string;
      field: string;
      value: string;
      confidence: number | null;
      sourceRef: DocumentSourceRef;
      snippet?: string;
      target?: { surface: "hbom" | "requirements"; id: string; field?: string };
    }

    export function encodeSourceRef(ref: DocumentSourceRef): string;
    export function decodeSourceRef(value: string): DocumentSourceRef;
    export function searchDocuments(db: Database.Database, scope: DocumentScope, query: DocumentSearchQuery): Page<DocumentSearchHit>;
    export function recordDocumentExtractions(
      db: Database.Database,
      scope: DocumentScope,
      documentSha256: string,
      items: DocumentExtractionInput[],
    ): DocumentExtractionResult;

    POST /api/v1/plugins/finite-state/http/documents/upload
      multipart scope = strict JSON { projectId, projectVersionId }
    GET  /api/v1/plugins/finite-state/http/documents/<sha256>/content
      required query projectId=<id>&projectVersionId=<external-id-or-empty-for-null>

    bb finite-state doc list [--kind <kind>] [--json]
    bb finite-state doc show <sha256>
    bb finite-state doc search <query> [--kind <kind>] [--json]

RPC handles JSON metadata/search. bb.http handles multipart and bytes.

## Acceptance criteria

- [ ] Documents store under the exact content-addressed tracked path and one frozen ledger, isolated by explicit project/version scope.
- [ ] Multipart/binary never travels through RPC or a generic raw request.
- [ ] Duplicate bytes are idempotent by SHA-256.
- [ ] Upload validates size/type/name and cannot traverse outside product-security/documents.
- [ ] PDF extraction refs are page-level and sheet extraction refs are cell/range-level; codecs round-trip.
- [ ] Viewer opens the exact locator and overlays only recorded coordinates.
- [ ] Search is paged/bounded and returns citations, not document dumps.
- [ ] Identical document/extraction ids can coexist across projects and versions; every SQL/RPC/HTTP lookup requires both scope fields, project-level null round-trips only at the store boundary, and external `"@project"` is rejected.
- [ ] HBOM and requirement target links reconcile the optional indexed target with authoritative owner source refs; the projection never becomes a second truth store.
- [ ] Documents remain explicitly plugin-local in v1; no AS retention claim is shown.
- [ ] Four UI states, safe authenticated previews, Hugeicons, bb tokens, and shared UI rules are complete.

## Test plan

- upload.test.ts — PDF/CSV/XLSX acceptance, 50 MiB boundary, MIME mismatch, unsafe filename, traversal, scoped duplicate SHA, cross-project/version collision isolation, sentinel rejection, interrupted upload, and ledger rollback when promote fails.
- content.test.ts — scoped SHA lookup, local auth, safe headers, byte ranges, missing/foreign-scope file, and caller path ignored/rejected.
- source-ref.test.ts — PDF page/bbox, sheet name with spaces/quotes and A1 range, text lines, round-trip, zero page, invalid bbox, and unknown digest.
- search.test.ts — paging, kind/query filters, bounded snippets, reverse HBOM target, requirement target, and malformed extraction row skipped with diagnostic.
- document-viewer.test.tsx — exact page/cell navigation, overlay labels, unknown/withdrawn source, sandboxed preview, loading/empty/error/unconfigured.
- Fault path — ledger references a missing local blob: return DOCUMENT_CONTENT_MISSING with re-upload-heals-by-SHA guidance, never a blank viewer.

## Do not

- Do not add a raw request for upload/download; future AS retention uses named typed methods.
- Do not claim documents are retained in AS or create a second hbom_docs table.
- Do not accept a filename-only citation for extracted evidence.
- Do not key content routes by caller-supplied paths or expose absolute paths.
- Do not auto-run/accept HBOM extraction or infer an overlay region.
- Do not load a full large workbook/document into the browser.
- Do not register CLI commands, agent tools, mentions, or directives; their central WPs consume exported document services/components.

## Open questions

1. Git-tracked documents above common Git hosting limits need a product retention/LFS policy. The 50 MiB upload cap does not solve repository growth.
2. AS `doc_type` lacks datasheet/bom and direct binary methods are not frozen. Server retention is a future typed integration, not a hidden v1 dependency.
3. OCR for image-only PDFs is not established. Mark needs_ocr and block cited extraction until a verified OCR path supplies page/region evidence.
