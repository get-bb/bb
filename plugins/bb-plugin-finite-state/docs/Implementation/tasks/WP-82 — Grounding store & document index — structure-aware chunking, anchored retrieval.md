# WP-82 — Grounding store & document index — structure-aware chunking, anchored retrieval

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.2, §4.2.1, §5, decision 9.2 · SPEC 05 C11–C13 (via WP-56) · AMENDMENTS AMD-0010, AMD-0011 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-71, WP-56 · **Blocks:** WP-84, WP-85, WP-96, WP-97
**Produces a FROZEN artifact:** no — implements repositories and retrieval over the frozen AMD-0010 `ground_source`/`ground_chunk` tables and consumes the frozen WP-56 document ledger

## Files you own

    plugins/bb-plugin-finite-state/lanes/grounding/register.ts
    plugins/bb-plugin-finite-state/lanes/grounding/store/sources.ts
    plugins/bb-plugin-finite-state/lanes/grounding/store/chunks.ts
    plugins/bb-plugin-finite-state/lanes/grounding/index/pipeline.ts
    plugins/bb-plugin-finite-state/lanes/grounding/index/chunker.ts
    plugins/bb-plugin-finite-state/lanes/grounding/index/structure.ts
    plugins/bb-plugin-finite-state/lanes/grounding/retrieval/embedding.ts
    plugins/bb-plugin-finite-state/lanes/grounding/retrieval/query-documents.ts
    plugins/bb-plugin-finite-state/lanes/grounding/**/*.test.ts

The registration file replaces WP-71's grounding backend stub and wires the frozen `grounding.*` RPC seams to lane-local modules. It exports document-plane query and source-management services for WP-84, WP-64, and WP-96; it does not register CLI commands or agent tools itself.
Where WP-83 (`lanes/grounding/catalog/**`) and WP-84 (`register.app.tsx`, `app/**`) modules do not exist yet, create only compiling NOT_IMPLEMENTED placeholders at their exact future-owned paths; those WPs replace them in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/documents/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane. AMD-0010 already froze the `ground_*` DDL; changing it means a new amendment, not a local migration.

## Context

SPEC 08 §5.1 splits grounding into two planes. This WP is **plane B: project documents** — datasheets, reference manuals, errata, app notes, SDK sources — chunked, embedded, and retrieved by similarity. Plane A (the structured catalog) is WP-83 and uses no embeddings; do not blur the planes.

**There is one document store and WP-56 owns it.** `ground_source.path` points into the SPEC 05 Part C content-addressed store (`product-security/documents/<sha256>-<name>`); `source_id` is that SHA-256. Registering a grounding source means recording indexing metadata against an existing ledger row — never copying bytes, never a second upload path, never a parallel ledger.

Register tables, pin tables, and timing diagrams are not prose. A register table chunked as prose destroys exactly the rows a driver author needs, and a passage without a document/page/anchor coordinate cannot be clicked back to its page — and a citation that can't be clicked back to a page isn't a citation. Structure preservation and anchoring are therefore the acceptance bar, not niceties.

Per §4.2.1, `license` and `redistributable` are recorded per source and must be queryable: "which grounding data can ship in an air-gapped deployment" has to be computable, not remembered.

## What to build

1. Replace the grounding backend registration stub. Wire frozen `grounding.*` RPC seams (sources list, document-plane query, indexing control) to lane modules; registration is reload-safe and uses ctx.service for shared handles. Create placeholders for WP-83/WP-84 at their exact paths.
2. Implement repositories over the exact frozen AMD-0010 `ground_source` and `ground_chunk` tables using real SQLite transactions and typed rows. No duplicate tables, no schema drift.
3. Source registration: given a WP-56 document SHA already in the ledger, insert a `ground_source` row with kind (`reference_manual|datasheet|svd|errata|appnote|sdk|re_corpus`), part, title, `path` into the document store, `license` (SPDX id where possible), and `redistributable`. Status lifecycle is `pending → indexing → ready|failed`; failures record a reason and stay queryable.
4. The indexing pipeline: extract text per page, classify regions, and chunk with structure preservation. `ground_chunk.kind` uses the exact spec vocabulary `prose|register_table|pin_table|timing|figure`. Tables chunk as row groups that retain their header row and table identity; timing diagrams and figures become caption-plus-reference chunks; only prose is chunked as prose.
5. Anchoring: every chunk carries `page` and `anchor` (table id or section number). A chunk that cannot be assigned a clickable coordinate is recorded with a page-level anchor and flagged, never emitted anchorless.
6. Embeddings for plane B only, behind an `EmbeddingProvider` interface. Store vectors in `ground_chunk.embedding` BLOB. Indexing is idempotent per (source, content): re-running on an unchanged source is a no-op; a changed provider or model re-embeds and records the model id. No provider configured means indexing parks at `pending` with a grounding-lane advisory — not an error and never a plugin lifecycle change (FS-158).
7. `queryDocuments`: similarity retrieval returning passages with `{sourceId, documentName, page, anchor, kind, snippet}`, labeled `plane: "document"` with confidence ~0.72 per the §4.2.1 provenance ladder. Paged `{items, total, cursor}`, bounded snippets, never raw chunk dumps.
8. License queryability: a source filter and an aggregate ("N sources, M redistributable") that WP-84's coverage view and the CLI can consume directly.
9. Publish `grounding:changed` with `{sourceId, status}` only after a committed change; the signal is a refetch hint, not a data channel.

## Interface contract

    export type GroundSourceKind =
      | "reference_manual" | "datasheet" | "svd" | "errata" | "appnote" | "sdk" | "re_corpus";
    export type ChunkKind = "prose" | "register_table" | "pin_table" | "timing" | "figure";

    export interface GroundPassage {
      plane: "document";
      confidence: number;              // ~0.72 per SPEC 08 §4.2.1
      sourceId: string;                // document sha256
      documentName: string;
      page: number | null;
      anchor: string | null;           // table id / section number
      kind: ChunkKind;
      snippet: string;                 // bounded
    }

    export function registerSource(db: Database.Database, input: RegisterSourceInput): GroundSourceRecord;
    export function indexSource(ctx: GroundingContext, sourceId: string): Promise<IndexOutcome>;
    export function queryDocuments(
      ctx: GroundingContext,
      query: { text: string; part?: string; kinds?: ChunkKind[]; pageSize?: number; cursor?: string },
    ): Promise<Page<GroundPassage>>;

    -- Frozen AMD-0010 relational contract; do not migrate a duplicate:
    ground_source(source_id, project_key, kind, part, title, path, pages,
                  indexed_at, status, license, redistributable)
    ground_chunk(chunk_id, source_id, page, kind, anchor, text, embedding)
    -- INDEX ix_chunk_source (source_id, kind)

The `EmbeddingProvider` interface takes text batches and returns fixed-dimension vectors plus a model id; the concrete provider is configuration, not code, so an air-gapped deployment can swap it without touching this lane.

## Acceptance criteria

- [ ] `ground_source.path` always resolves into the WP-56 store; no second document ledger, upload route, or byte copy exists in this lane.
- [ ] A register-table fixture indexes as `register_table` chunks with intact header context; the same bytes never appear inside a `prose` chunk.
- [ ] Every retrieval result carries document, page, and anchor coordinates that open the exact location in the WP-56 viewer.
- [ ] `license` and `redistributable` are populated at registration and queryable through the exported service.
- [ ] Indexing is idempotent and a failed index leaves the source `failed` with a reason, not half-indexed as `ready`.
- [ ] Absent embedding provider surfaces a grounding-lane advisory while the plugin remains running; nothing throws and plane-A/catalog work is unaffected.
- [ ] Every list surface is paged `{items, total, cursor}` and snippets are bounded.
- [ ] Real SQLite in every test; the frozen tables are used exactly as declared.
- [ ] Realtime publishes tiny refetch hints only after commit.

## Test plan

- structure.test.ts — register-table, pin-table, and timing-diagram fixtures classify correctly; prose fallback; a table split across pages keeps header context in every chunk.
- pipeline.test.ts — pending→indexing→ready lifecycle, idempotent re-index, changed-content re-index, and a corrupt/unparseable PDF lands `failed` with a queryable reason (**error path**).
- query-documents.test.ts — plane/confidence labeling, kind filters, paging, bounded snippets, and anchorless-chunk flagging.
- sources.test.ts — registration against a WP-56 ledger SHA, unknown SHA rejected with hint, license aggregate math.
- embedding.test.ts — provider absent parks at `pending` with a scoped advisory and skips cleanly (CI has no embedding runtime); provider swap re-embeds and stamps the model id.

## Do not

- Do not build, copy, or shadow a document store; WP-56's ledger and paths are the single truth.
- Do not chunk register/pin/timing content as prose or emit a passage without coordinates.
- Do not embed plane-A/catalog facts — that is WP-83's explicit non-goal, for stated reasons.
- Do not return raw chunks, full pages, or document bodies through RPC or the exported services.
- Do not hardcode an embedding provider or call any hosted API from a render path.
- Do not register CLI commands, agent tools, mentions, or directives; WP-64/WP-96 consume this lane's exported services.

## Open questions

1. **The embedding model/provider is unresolved** — local (llama.cpp/ONNX-class) versus API-backed. Deployment must work air-gapped, so a local default is strongly implied, but model choice, dimension, and where the runtime comes from (host prerequisite reported through a grounding-lane advisory, per FS-158 and the no-new-npm-deps rule) need an owner decision before `ready` sources exist in production.
2. Vector search strategy at plane-B scale (tens of documents, thousands of chunks): brute-force cosine over BLOBs is likely sufficient; confirm before reaching for an index structure.
3. Image-only PDFs inherit WP-56's OCR gap: without page/region evidence they must park as unindexable rather than produce uncitable chunks. Confirm the shared `needs_ocr` handling.
