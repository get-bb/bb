# WP-83 — Structured catalog — catalog.db read-only attach, redistributable build, fetch & cache

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §5.1, §4.2.1, decisions 9.2, 9.7 · AMENDMENTS AMD-0010 (out-of-scope note) · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-71 · **Blocks:** WP-84, WP-96
**Produces a FROZEN artifact:** no — consumes the externally built `catalog.db` artifact read-only; the `cat_*` schema is the catalog pipeline's contract, deliberately outside `bb.storage.migrate` and outside the frozen plugin schema

## Files you own

    plugins/bb-plugin-finite-state/lanes/grounding/catalog/attach.ts
    plugins/bb-plugin-finite-state/lanes/grounding/catalog/fetch.ts
    plugins/bb-plugin-finite-state/lanes/grounding/catalog/query.ts
    plugins/bb-plugin-finite-state/lanes/grounding/catalog/coverage.ts
    plugins/bb-plugin-finite-state/lanes/grounding/catalog/versions.ts
    plugins/bb-plugin-finite-state/lanes/grounding/catalog/**/*.test.ts

WP-82 owns `lanes/grounding/register.ts` and pre-wires it to these exact paths; if its NOT_IMPLEMENTED placeholders exist, replace them in place, otherwise create the modules at these paths. Do not edit `register.ts` — export services it already points at.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/grounding/register.ts, lanes/grounding/store/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

This is plane A of SPEC 08 §5.1 and the best-specified WP in the lane: implement §5.1 as written. **The catalog builder pipeline already exists outside the plugin** (`Catalog Pipeline/` — measured: 209 devices, 2,483,791 facts, zero parse failures across eight vendors' CMSIS-SVD). This WP consumes its artifact; it does not build, parse, or regenerate SVD.

`catalog.db` is a **read-only sidecar beside `data.db`**, never inside it. It is a build artifact, not user state: opened `mode=ro` so the plugin cannot corrupt it, excluded from `bb.storage.migrate`'s append-only chain, versioned by `catalog_version`, immutable per version and therefore safe to fetch once and cache. It is fetched on first use into the plugin data dir and is re-fetchable, like the firmware mount.

**No embeddings for structured facts.** A register lookup is an exact-match query, not a similarity query — `STM32H753.USART1.CR1.UE` is an identifier. Embedding 2.5M short strings would be expensive, slow, and actively harmful: nearest-neighbour over `USART1.CR1.UE` and `USART2.CR1.UE` returns near-misses indistinguishable from hits, which is precisely the failure mode that produces a confidently wrong base address in generated code. Citation gating catches an *uncited* value; it does not catch a value cited to the wrong peripheral. So: B-tree indices for identifier lookup, FTS5 for descriptive text, nothing else.

Licensing is an enforced build boundary, not a note. Of the eight vendors built, only Raspberry Pi is redistributable; the catalog builds in two flavours — `--redistributable-only` ships as a release artifact, the full catalog is built locally by the user from their own fetch. Same schema, same code path; the plugin opens whichever is present and reports coverage honestly.

## What to build

1. Attach: open `catalog.db` from `<pluginDataDir>/catalog/<catalog_version>/catalog.db` with `mode=ro`. Verify the expected `cat_*` tables and `catalog_version` before serving a single query; a malformed or wrong-version file is `CATALOG_INVALID`, never a partial answer. Absent catalog is `needsConfiguration`, not an error — every consumer degrades to plane-B-only.
2. Fetch-on-first-use: resolve the configured artifact source (release URL or local file path for a user-built full catalog), download to a staging file while hashing, verify the published digest, and atomically promote into the versioned cache directory. Interrupted or mismatched fetches leave no partial file in the cache path.
3. Flavour detection: derive shipped-redistributable vs full from `cat_source.redistributable` composition, and prefer the full catalog when both are present. Expose the answer through coverage, never by guessing.
4. Identifier lookup — the primary path: exact and prefix queries over `(device, peripheral, register, field)` using `ix_fact_path`/`ix_fact_periph`. Resolve `register.size` at query time: **null is correct SVD behaviour meaning the register inherits `cat_device.width`** — treating null as unknown drops widths on a large fraction of registers.
5. Descriptive search — the secondary path: FTS5 over `cat_fact_fts` with bounded, ranked results. No embedding column, no vector path, ever.
6. Citation discipline: **never return a catalog fact without its `source_file`.** The exact `.svd` file IS the citation — a vendor file and a precise path, not a page number and a confidence score. Every result is labeled `plane: "catalog"`, confidence 1.0, with `{source_file, vendor}`.
7. Coverage report for WP-84 and the CLI: flavour present, `catalog_version`, device count, vendor list, redistributable/total source counts. This is the data behind the Grounding tab's honesty display.
8. Version lifecycle: list cached versions, fetch a new one, retire old ones explicitly. A version directory is immutable after promotion; updates are new versions, never in-place writes.
9. Export `queryCatalog`/`getCatalogCoverage` services for WP-84's federated query and WP-96's `fs_ground_query`; paged `{items, total, cursor}` throughout.

## Interface contract

    export interface CatalogFact {
      plane: "catalog";
      confidence: 1.0;
      kind: "peripheral" | "interrupt" | "register" | "field";
      deviceId: string;
      peripheral: string | null;
      register: string | null;
      field: string | null;
      addr: string | null;               // hex string
      bitOffset: number | null;
      bitWidth: number | null;
      access: string | null;
      resetValue: string | null;
      size: number | null;               // resolved: register size, falling back to cat_device.width
      description: string | null;
      citation: { sourceFile: string; vendor: string };
    }

    export interface CatalogCoverage {
      present: boolean;
      flavour: "redistributable" | "full" | null;
      catalogVersion: string | null;
      devices: number;
      vendors: string[];
      sources: { total: number; redistributable: number };
    }

    export function attachCatalog(dataDir: string): CatalogHandle | null;   // null = not fetched yet
    export function fetchCatalog(ctx: CatalogContext, source: CatalogSource): Promise<CatalogHandle>;
    export function queryCatalog(handle: CatalogHandle, q: CatalogQuery): Page<CatalogFact>;
    export function getCatalogCoverage(handle: CatalogHandle | null): CatalogCoverage;

    -- catalog.db — built by the external pipeline; the plugin only reads it (SPEC 08 §5.1):
    cat_device(device_id, vendor, name, cpu, width, description, source_id)
    cat_fact(fact_id, device_id, kind, peripheral, register, field, addr,
             bit_offset, bit_width, access, reset_value, description,
             source_id, source_file)
    cat_fact_fts(description, peripheral, register, field)   -- FTS5, content=cat_fact
    cat_source(source_id, vendor, kind, origin, license, redistributable, catalog_version)
    -- ix_fact_path (device_id, peripheral, register, field) · ix_fact_periph (peripheral, register)

## Acceptance criteria

- [ ] `catalog.db` opens `mode=ro`; a write attempt through the handle fails, and nothing about it ever touches `bb.storage.migrate` or `data.db`.
- [ ] Absent catalog yields `needsConfiguration` plus an honest `CatalogCoverage { present: false }`; no consumer throws.
- [ ] Fetch verifies the digest before promotion; a mismatch or interruption leaves the versioned cache path empty.
- [ ] Identifier lookup resolves `register.size` null to `cat_device.width` at query time.
- [ ] No fact crosses the service boundary without `source_file` and vendor.
- [ ] Descriptive search runs on FTS5; no embedding or vector code exists in this lane's catalog modules.
- [ ] Coverage reports the flavour actually present, never an assumed one.
- [ ] Every list is paged `{items, total, cursor}`; identifier lookups on the fixture are sub-millisecond order.
- [ ] Real SQLite fixture catalog in tests; no mocked database.

## Test plan

Build a small fixture `catalog.db` (two vendors, one redistributable) in test setup using the §5.1 schema — real SQLite, same shape the pipeline emits.

- attach.test.ts — valid attach, `mode=ro` write rejection, missing file → `needsConfiguration`, malformed schema → `CATALOG_INVALID` (**error path**), version verification.
- fetch.test.ts — staged download, digest mismatch rejected without cache pollution (**error path**), interrupted-stream cleanup, idempotent re-fetch of a cached version.
- query.test.ts — exact and prefix identifier lookup, null-size fallback to device width, `source_file` present on every row, paging, unknown device returns empty not error.
- fts.test.ts — descriptive search ranking and bounds; query terms matching descriptions, not identifiers.
- coverage.test.ts — flavour derivation from `cat_source` composition, full-preferred-over-redistributable when both cached.

## Do not

- Do not build or vendor the catalog pipeline into the plugin; it lives outside and ships an artifact.
- Do not create `cat_*` tables in `data.db`, add them to the frozen schema, or write to `catalog.db` under any circumstance.
- Do not add embeddings, vector search, or fuzzy identifier matching — the near-miss failure mode is the stated reason.
- Do not return a fact without `source_file`, and do not synthesize a citation the file does not carry.
- Do not ship non-redistributable sources in any release path; the flavour boundary is enforced upstream and reported honestly here.
- Do not register CLI commands, agent tools, or UI; WP-84/WP-96/WP-64 consume the exported services.

## Open questions

1. **On-disk size at 2.5M facts is unmeasured — measure before designing the fetch UX.** If it lands above a few hundred MB, borrow the firmware mount's progress-reporting and resumability mechanics (WP-47/WP-48) rather than inventing new ones; below that, a plain staged download suffices.
2. Where the redistributable release artifact is hosted and how its digest is published (release asset + checksum file is the working assumption) needs an owner decision before first fetch ships.
3. Whether the plugin should surface a documented pointer to the external `build_catalog.py build` full-flavour path (CLI help text only — the builder itself stays out of the plugin).
