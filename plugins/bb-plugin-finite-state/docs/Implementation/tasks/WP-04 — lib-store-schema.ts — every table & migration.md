# WP-04 — `lib/store/schema.ts` — every table & migration

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §5 · SPEC 01 §9 · SPEC 02 §4 · SPEC 03 §5 · SPEC 04 §4 · SPEC 05 A2/B10/C12 · RECON §1.2, §2.8 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** every lane that stores or projects anything
**Produces a FROZEN artifact:** **yes** — `lib/store/schema.ts` freezes on merge

## Files you own

```text
plugins/bb-plugin-finite-state/lib/store/schema.ts        # FROZEN
plugins/bb-plugin-finite-state/lib/store/index.ts
plugins/bb-plugin-finite-state/lib/store/schema.test.ts
plugins/bb-plugin-finite-state/lib/store/index.test.ts
```

## Files you must not touch

`server.ts`, `app.tsx`, `lib/context.ts`, `shared/contract.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, or anything under `lanes/`.

## Pre-release migration authority

`bb.storage.migrate` applies and records the positional `MIGRATIONS` array. D-1/D-2 authorize rewriting the original v1 statements in place before WP-02 merges because the plugin is unregistered/unreleased and a 2026-08-12 read-only search of the bb data roots and project worktrees found zero persistent finite-state `data.db` instances. D-1 belongs in the original definitions and keys; do not append corrective migrations.

Every base `CREATE TABLE` statement omits `IF NOT EXISTS`. An unexpected preexisting schema must fail loudly rather than being mistaken for an applied positional migration. This exception ends with the first frozen merge/registration. Thereafter shipped statements are immutable and every change appends through `AMENDMENTS.md`.

## Binding storage identity

- Every table is scoped by `project_id TEXT NOT NULL, project_version_id TEXT NOT NULL` as its first columns.
- Every primary key, unique constraint, foreign key, and explicit index begins with those columns in that order.
- Project-level wire scope is `{ projectId, projectVersionId: null }`. Storage maps null to exported `PROJECT_LEVEL_VERSION_ID = "@project"` only at the backend boundary.
- Empty external version ids and the literal external `"@project"` are rejected. The sentinel is never sent upstream.
- There is no workspace id, `scope_id`, `project_key`, nullable scope key, or serialized scope codec.
- Domain ids may repeat across projects and product versions without collision or leakage.

## Publication and stale-plan model

`pull_generation` records a complete requested pull. `sync_state` owns accepted/staging pointers and a monotonic `base_revision` per explicit project/version/entity kind. Remotely pulled cache, base, id-map, and review-token rows carry `generation_id` and reference `pull_generation`.

Page transactions write only the staging generation. Readers join the exact scope/kind `accepted_generation_id`; staged or failed rows are invisible. After every requested kind/page and projection validates, one transaction flips all requested accepted pointers, increments their revisions once, clears staging continuation/counters, and marks the generation accepted. Failure/cancellation retains the previous accepted generation and resumable staging metadata.

Plans bind the accepted generation, starting revision, and each operation's expected base content hash. Each successful push advances only that exact entity's base/id row, records the scoped `push_log` result, and increments the relevant revision in one transaction. Accepted generation ids do not change for per-entity pushes.

## Frozen inventories

`schema.ts` exports these literal inventories. Tests derive counts from them; no separate numeric table/index constant is allowed.

```ts
export const SCHEMA_TABLES = [
  "pull_generation", "sync_state", "push_log", "base_snapshot", "id_map",
  "entity_review_state", "findings", "finding_cwes", "finding_activity",
  "overlay_index", "triage_runs", "sbom_components", "sbom_vuln_rollup",
  "hbom_cells", "hbom_candidates", "standards", "standards_clauses",
  "methodology_profiles", "attack_paths", "verification_checks",
  "requirement_check_mappings", "requirement_rollup", "verification_runs",
  "verification_results", "verification_artifacts", "attestations",
  "firmware_mounts", "document", "document_extraction",
] as const;

export const SCHEMA_VIEWS = ["hbom_docs"] as const;

export const CACHE_STORAGE_NAMES = [
  "findings", "sbom_components", "standards_clauses", "attack_paths",
  "verification_runs", "verification_results", "firmware_mounts", "document",
  "hbom_docs",
] as const;
```

The named index inventory is exactly:

```text
ix_pull_generation_status, ix_sync_state_generation, ix_push_log_run,
ix_entity_review_state_status,
ix_findings_page, ix_findings_stable, ix_findings_cve, ix_findings_component,
ix_findings_risk, ix_findings_epss, ix_findings_kev,
ix_findings_reachability, ix_findings_policy_dataset,
ix_findings_policy_band, ix_findings_policy_flags, ix_findings_type,
ix_finding_cwes_selector, ix_finding_activity_stable,
ix_overlay_project_state, ix_overlay_policy_flag, ix_overlay_file,
ix_triage_runs_scope,
ix_sbom_key, ix_sbom_purl, ix_sbom_name,
ix_hbom_review, ix_hbom_candidates_review, ix_hbom_candidates_source,
ix_standards_code, ix_standard_clauses_path, ix_methodology_project,
ix_attack_paths_threat,
ix_verification_checks_code, ix_req_check_check,
ix_verification_runs_recent, ix_verification_runs_host,
ix_verification_runs_job, ix_verification_results_matrix,
ix_verification_results_check, ix_verification_results_run,
ix_verification_artifacts_run, ix_attestations_run,
ix_attestations_subject, ix_firmware_mounts_state,
ix_document_list, ix_document_extraction_source,
ix_document_extraction_target, ix_document_extraction_search
```

Every definition begins with the scope pair. Generation-backed cache indexes put `generation_id` immediately after it. Do not add speculative indexes.

## Table authority and freshness

| Tables | Authority/classification | Publication/freshness |
|---|---|---|
| `pull_generation`, `sync_state` | sync control only | run timestamps / `last_pull` |
| `push_log`, `triage_runs` | bounded execution journals, never model truth | apply/run timestamps |
| `base_snapshot`, `id_map`, `entity_review_state` | accepted sync machinery and server lifecycle token cache | generation + `pulled_at` |
| `findings`, `finding_cwes`, `finding_activity` | upstream cache; VEX/comments/activity are not YAML authority | generation + `pulled_at` |
| `overlay_index` | rebuildable `.fs/triage` YAML projection | `indexed_at` |
| `sbom_components`, `sbom_vuln_rollup` | upstream cache and derived rollup | generation + `pulled_at`/`computed_at` |
| `hbom_cells`, `hbom_candidates` | rebuildable `product-security/hbom/hbom.yaml` mirrors | `indexed_at` |
| `standards`, `standards_clauses`, `methodology_profiles`, `attack_paths` | upstream vocabulary/body caches; tracked decisions stay outside SQLite | generation + `pulled_at` |
| `verification_checks`, `requirement_check_mappings`, `requirement_rollup` | upstream mapping/status caches; requirement YAML remains authority | generation + `pulled_at` |
| `verification_runs`, `verification_results`, `verification_artifacts`, `attestations` | version-scoped run/evidence cache and action journal | generation/run timestamps/`synced_at`/`pulled_at` |
| `firmware_mounts` | materialization registry only; never `manifest.sqlite` | `pulled_at`/`materialized_at` |
| `document`, `document_extraction`, `hbom_docs` | rebuildable ledger/extraction projections; tracked bytes/files remain authority | `indexed_at`/extraction timestamps |

`hbom_docs` is a filtered view over `document`, never a second table. The per-product-version firmware `manifest.sqlite` and all of its migrations remain exclusively WP-47-owned.

## SQL and row contract

- Keep the pre-D-1 domain columns, nullability, checks, and state vocabularies from the accepted WP-04 candidate unless this reconciliation explicitly changes identity/publication.
- Add the scope pair to every table/row and replace `project_key`, `pv_id`, and nullable `project_version_id` aliases with the canonical columns.
- Add `generation_id TEXT NOT NULL` to remotely published base/cache/review/evidence rows. Composite child foreign keys include scope and generation.
- JSON is stored only in named TEXT columns (`raw`, `*_json`, `payload`, and the accepted domain JSON columns) and validated at repository boundaries.
- SQLite boolean integers are `0 | 1`; nullable SQL fields are `T | null`; decimal `review_version` remains TEXT.
- SQL checks enforce finite confidence, booleans, nonnegative counters, and closed local states without rejecting legitimate upstream values retained in `raw`.
- `findings.band` stays nullable until WP-28 supplies the verified transform; never invent a band algorithm.
- `finding_cwes` is rebuilt from canonical `findings.cwes` JSON in the same page transaction.
- The attestation `verified` check requires both `signature_verified = 1` and `subject_matches_run = 1`; repository logic must also compare the signed subject to the exact scoped run firmware digest.
- Source-of-truth comments sit above every cache/mirror/journal. Rebuilding projections must not lose authored content.

Export one exact snake-case row interface for each table and `HbomDocRow` for the view, including every column with no `Record<string, unknown>` placeholder. `PullGenerationRow` is additional to the original row set. Runtime fixtures mechanically compare every interface key list with `PRAGMA table_info`.

## `openStore` contract

```ts
export interface Store {
  readonly db: Database.Database;
  tx<T>(fn: () => T): T;
}

export const PROJECT_LEVEL_VERSION_ID = "@project" as const;
export function toStorageProjectVersionId(projectVersionId: string | null): string;
export function fromStorageProjectVersionId(projectVersionId: string): string | null;
export function openStore(bb: BbPluginApi): Store;
```

`openStore` memoizes per plugin API context only after migration and foreign-key verification succeed. A failed first migration is retryable on the same context. `tx(fn)` is synchronous and fully rolls back on throw.

## Acceptance criteria

- [ ] Fresh real-SQLite migration records every positional statement once; a second `bb.storage.migrate` call is a no-op.
- [ ] Manually precreating a base table makes migration fail loudly; no `CREATE TABLE IF NOT EXISTS` masks it.
- [ ] Inventory parity proves all 29 tables, 48 named indexes, and the one view exist with the declared SQLite kinds; counts are derived from the literal inventories.
- [ ] Every table, PK, unique, FK, and named index has the explicit NOT NULL scope pair in canonical order.
- [ ] Same ids across two projects, two versions, and project-level sentinel rows do not collide or cross-read.
- [ ] Null/sentinel round-trip and collision tests reject empty/external `"@project"` and prove the sentinel never reaches a remote client.
- [ ] Staging pages are invisible; aborted/page-failed pulls preserve the prior accepted generation; retry publishes exactly once; multi-kind flip/revision increment is atomic.
- [ ] Per-entity push advances only the exact scoped base/id row and revision, and stale generation/revision/content fences reject without partial writes.
- [ ] Every WP-05 cache storage name resolves with the right table/view kind.
- [ ] Foreign keys, confidence/boolean/state checks, malformed payload validation, and transaction rollback have real-SQLite error-path tests.
- [ ] Finding selectors use the four named policy/CWE indexes and preserve nullable dataset membership, canonical JSON, upstream risk/count fields, and nullable computed band.
- [ ] Overlay/HBOM/document projections rebuild from tracked fixtures without losing authored content; their journals survive rebuilds.
- [ ] Verification mapping/latest/history/run/artifact/attestation queries are scoped, indexed, and enforce evidence trust.
- [ ] Row-key fixtures exactly match `PRAGMA table_info` for all tables and the view.
- [ ] `openStore` memoization, migration retry, foreign-key enablement, and rollback regressions remain green.
- [ ] Representative findings/SBOM/verification/timeline/document queries name the intended indexes in `EXPLAIN QUERY PLAN` and meet downstream budgets under Node 22.19.0.
- [ ] No manifest-sidecar migration or shadow table/contract is exported.

## Test plan — `shared-store-freeze`

- `fresh, repeat, and unexpected-preexisting migration`
- `named inventory and WP-05 registry parity`
- `row interfaces match SQL`
- `D-1 scope shape, same-id collision isolation, and sentinel round-trip/rejection`
- `staging invisibility, failed-page preservation, atomic multi-kind flip, and retry once`
- `base revision/content CAS and per-entity advancement`
- `foreign keys, closed-state/check constraints, and transaction rollback`
- `overlay/HBOM rebuild and journal survival`
- `finding policy/CWE/comment/activity selectors and malformed-boundary rollback`
- `review token survives semantic stripping`
- `verification latest/history/matrix and bench evidence checkpoint`
- `document locator matrix and cross-scope rejection`
- `named query plans and representative performance fixtures`

## Do not

- Do not create `migrations/*.sql`; migrations are the inline TS array.
- Do not append D-1 repairs. Rewrite only the authorized unshipped v1 statements; after freeze, append through the amendment protocol.
- Do not use `CREATE TABLE IF NOT EXISTS` in the base migration.
- Do not introduce workspace/scope ids, `project_key`, `pv_id`, nullable key scope, or a scope codec.
- Do not store authored threats, requirements, VEX/HBOM decisions, policy, or document bytes as SQLite truth.
- Do not infer verification proof from status/confidence/signature presence/upstream booleans.
- Do not use `entity_version`; decimal `review_version` is the concurrency token.
- Do not expose backend paths/locators to the browser or accept browser absolute paths.
- Do not add duplicate `bench_*`, `hbom_docs`, or firmware manifest tables.
- Do not mock SQLite or change dependency/lock files.
