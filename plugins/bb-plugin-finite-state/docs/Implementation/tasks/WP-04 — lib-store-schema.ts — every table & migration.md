# WP-04 — `lib/store/schema.ts` — every table & migration

**Lane:** L0 Foundation · **Spec refs:** SPEC 00 §5 · SPEC 01 §9 · SPEC 02 §4 · SPEC 03 §5 · SPEC 04 §4 · SPEC 05 A2/B10/C12 · RECON §1.2, §2.8 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** WP-05, WP-08, WP-16, WP-22, WP-27, WP-36–WP-41, WP-44–WP-47, WP-52–WP-56 — every lane that stores or projects anything
**Produces a FROZEN artifact:** **yes** — `lib/store/schema.ts` freezes on merge

## Files you own
```
plugins/bb-plugin-finite-state/lib/store/schema.ts        # FROZEN — migration array + table/view docs
plugins/bb-plugin-finite-state/lib/store/index.ts         # openStore(), typed rows, tx helper
plugins/bb-plugin-finite-state/lib/store/schema.test.ts
plugins/bb-plugin-finite-state/lib/store/index.test.ts
```

## Files you must not touch
`server.ts`, `app.tsx`, `lib/context.ts`, `shared/contract.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, or anything under `lanes/`.

## Context
Every CACHED entity and disposable YAML projection lives in one plugin database, along with sync and action-run bookkeeping. This is the most depended-upon artifact in the build. `bb.storage.migrate` applies an append-only `string[]` and records statements in `_bb_migrations`; two lanes inventing their own first migration would permanently diverge developer databases.

The schema must distinguish authority from queryability. Findings, SBOM, standards, verification evidence, runs, and upstream bodies are caches. `overlay_index`, HBOM rows, and document extractions are rebuildable projections over git-tracked YAML/evidence. `triage_runs` and `push_log` are execution journals. No table is the authoritative home of threats, requirements, VEX decisions, HBOM cells, or document bytes.

The per-product-version firmware `manifest.sqlite` is a separate database whose schema and opener are owned entirely by WP-47. This file exports **only** `MIGRATIONS` for the shared `data.db`; it does not export `MANIFEST_MIGRATIONS` or assume that `lib/context.ts` opens the sidecar.

`findings.band` is a local, nullable derived cache value, not an Assurance Studio field. Populate it only with the verified fs-report prioritization transform selected by WP-28; until that implementation is available, leave it null and surface the selector as unavailable rather than approximating a band. `finding_cwes` is the normalized query projection of the canonical `findings.cwes` JSON array and is rebuilt in the same pull transaction.

## What to build
1. Implement `MIGRATIONS: string[]` exactly in the order below. One SQL statement per array element. Before the first release the v1 statements may be corrected; after merge/freeze, never reorder or edit a shipped statement—append through the amendment protocol.
2. Group statements: shared bookkeeping → sync/review tokens → findings/triage → SBOM → HBOM mirrors → product security vocabulary → verification/bench evidence → firmware registry → document ledger.
3. Implement memoized `openStore(bb)`: obtain `bb.storage.database()`, call `bb.storage.migrate(db,MIGRATIONS)` once per plugin context, enable and verify foreign keys, and expose a synchronous `tx(fn)` helper.
4. Export a typed row interface for every table and for `hbom_docs`. Field names exactly match SQL snake_case; lane-specific domain mappers own camelCase.
5. Store JSON only in named TEXT columns (`raw`, `*_json`, `payload`) and validate it at repository boundaries. SQL checks enforce finite confidence, booleans, and closed local state vocabularies where doing so cannot reject legitimate upstream values. Preserve unrecognized upstream fields/statuses in `raw`, never promote them to trusted columns.
6. Carry freshness on every cache/projection: upstream caches use `pulled_at`; YAML projections use `indexed_at`; derived rollups use `computed_at`; action/evidence rows use `synced_at` or their run timestamps. A stale UI never has to guess.
7. Add only the access-path indices specified below: findings filters/sort; overlay joins; triage run lookup; SBOM identity/rollup; HBOM review; standard/profile lookup; attack-path signature; verification matrix/history/check mapping; run timeline/jobs; evidence/artifact lookup; firmware state; document list/search/target/source location.
8. Verify the frozen WP-05 CACHED registry names exist: `findings`, `sbom_components`, `standards_clauses`, `attack_paths`, `verification_runs`, `verification_results`, `firmware_mounts`, `document`, and filtered view `hbom_docs`. Also include the additional caches required by downstream services: `entity_review_state`, `finding_cwes`, `finding_activity`, `verification_checks`, `requirement_check_mappings`, `requirement_rollup`, `standards`, and `methodology_profiles`.
9. Write a source-of-truth comment above every mirror/journal. Rebuilding `overlay_index`, HBOM mirrors, or the document ledger projection from tracked files must not lose authored content.

## Interface contract
```ts
// lib/store/schema.ts — FROZEN on merge.
// Amendment + CONTRACT_VERSION bump + lane broadcast required after freeze.
// APPEND-ONLY after first release: never reorder/edit a shipped statement.
// This is shared data.db only. WP-47 owns every manifest.sqlite statement.

export const SCHEMA_VERSION = 1 as const;
export const CACHE_STORAGE_NAMES = [
  "findings", "sbom_components", "standards_clauses", "attack_paths",
  "verification_runs", "verification_results", "firmware_mounts", "document", "hbom_docs",
] as const;

export const MIGRATIONS: string[] = [
  // ── shared bookkeeping ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sync_state (
     entity_kind TEXT NOT NULL,
     scope       TEXT NOT NULL,
     last_pull   TEXT,
     cursor      TEXT,
     error       TEXT,
     PRIMARY KEY (entity_kind, scope)
   )`,

  `CREATE TABLE IF NOT EXISTS push_log (
     id          INTEGER PRIMARY KEY,
     run_id      TEXT NOT NULL,
     entity_kind TEXT NOT NULL,
     entity_key  TEXT NOT NULL,
     op          TEXT NOT NULL CHECK (op IN ('create','update','delete','noop','conflict')),
     status      TEXT NOT NULL CHECK (status IN ('pending','applied','failed','skipped')),
     error       TEXT,
     applied_at  TEXT,
     UNIQUE (run_id, entity_kind, entity_key)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_push_log_run ON push_log (run_id, status, id)`,

  // ── sync engine ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS base_snapshot (
     entity_kind  TEXT NOT NULL,
     entity_key   TEXT NOT NULL,
     remote_id    TEXT,
     payload      TEXT NOT NULL,
     content_hash TEXT NOT NULL,
     pulled_at    TEXT NOT NULL,
     PRIMARY KEY (entity_kind, entity_key)
   )`,

  `CREATE TABLE IF NOT EXISTS id_map (
     entity_kind TEXT NOT NULL,
     entity_key  TEXT NOT NULL,
     remote_id   TEXT NOT NULL,
     PRIMARY KEY (entity_kind, entity_key),
     UNIQUE (entity_kind, remote_id)
   )`,

  // Server-owned lifecycle state, separate from semantic base snapshots/YAML.
  `CREATE TABLE IF NOT EXISTS entity_review_state (
     project_id     TEXT NOT NULL,
     entity_kind    TEXT NOT NULL,
     entity_key     TEXT NOT NULL,
     remote_id      TEXT NOT NULL,
     review_status  TEXT,
     review_version TEXT NOT NULL,
     pulled_at      TEXT NOT NULL,
     PRIMARY KEY (project_id, entity_kind, entity_key),
     UNIQUE (project_id, entity_kind, remote_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_entity_review_state_status ON entity_review_state (project_id, entity_kind, review_status, entity_key)`,

  // ── findings + local triage projections ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS findings (
     finding_id           TEXT NOT NULL,
     project_id           TEXT NOT NULL,
     project_version_id   TEXT NOT NULL,
     stable_key           TEXT NOT NULL,
     finding_type         TEXT,
     cve                  TEXT,
     title                TEXT,
     component_name       TEXT,
     component_group      TEXT,
     component_version    TEXT,
     component_purl       TEXT,
     severity             TEXT,
     risk_score           REAL,
     band                 TEXT,
     cvss_score           REAL,
     cvss_vector          TEXT,
     epss_score           REAL,
     epss_percentile      REAL,
     in_kev               INTEGER NOT NULL DEFAULT 0 CHECK (in_kev IN (0,1)),
     in_vc_kev            INTEGER NOT NULL DEFAULT 0 CHECK (in_vc_kev IN (0,1)),
     has_exploit          INTEGER NOT NULL DEFAULT 0 CHECK (has_exploit IN (0,1)),
     exploit_maturity     TEXT,
     reachability_score   REAL,
     reachability_verdict TEXT,
     reachability_factors TEXT,
     vuln_in_dataset      INTEGER CHECK (vuln_in_dataset IS NULL OR vuln_in_dataset IN (0,1)),
     cwes                 TEXT NOT NULL DEFAULT '[]',
     warning_count        INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
     violation_count      INTEGER NOT NULL DEFAULT 0 CHECK (violation_count >= 0),
     location             TEXT,
     vex_status           TEXT,
     vex_response         TEXT,
     vex_justification    TEXT,
     vex_reason           TEXT,
     comments             TEXT NOT NULL DEFAULT '[]',
     first_seen           TEXT,
     soft_deleted         INTEGER NOT NULL DEFAULT 0 CHECK (soft_deleted IN (0,1)),
     raw                  TEXT NOT NULL,
     pulled_at            TEXT NOT NULL,
     PRIMARY KEY (project_version_id, finding_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_findings_page ON findings (project_version_id, severity, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_stable ON findings (project_version_id, stable_key, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_cve ON findings (project_version_id, cve, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_component ON findings (project_version_id, component_name COLLATE NOCASE, component_group COLLATE NOCASE, component_version, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_risk ON findings (project_version_id, risk_score DESC, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_epss ON findings (project_version_id, epss_score DESC, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_kev ON findings (project_version_id, in_kev, in_vc_kev, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_reachability ON findings (project_version_id, reachability_score, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_policy_dataset ON findings (project_version_id, vuln_in_dataset, reachability_score, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_policy_band ON findings (project_version_id, band, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_policy_flags ON findings (project_version_id, violation_count, warning_count, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_type ON findings (project_version_id, finding_type, finding_id)`,

  // Normalized, rebuildable membership index over findings.cwes JSON.
  `CREATE TABLE IF NOT EXISTS finding_cwes (
     project_version_id TEXT NOT NULL,
     finding_id         TEXT NOT NULL,
     cwe                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_version_id, finding_id, cwe),
     FOREIGN KEY (project_version_id, finding_id)
       REFERENCES findings(project_version_id, finding_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_finding_cwes_selector ON finding_cwes (project_version_id, cwe, finding_id)`,

  // Cached, paged upstream VEX/audit activity. Never authored or replayed as model state.
  `CREATE TABLE IF NOT EXISTS finding_activity (
     project_version_id TEXT NOT NULL,
     finding_id         TEXT NOT NULL,
     event_id           TEXT NOT NULL,
     stable_key         TEXT NOT NULL,
     actor              TEXT,
     event_at           TEXT NOT NULL,
     source             TEXT,
     old_tuple          TEXT,
     new_tuple          TEXT,
     raw                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_version_id, finding_id, event_id),
     FOREIGN KEY (project_version_id, finding_id)
       REFERENCES findings(project_version_id, finding_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_finding_activity_stable ON finding_activity (project_version_id, stable_key, event_at DESC, event_id)`,

  // Rebuildable projection of .fs/triage YAML. Never authoritative.
  `CREATE TABLE IF NOT EXISTS overlay_index (
     entity_kind        TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     stable_key         TEXT NOT NULL,
     component_key      TEXT,
     cve                TEXT,
     file_path          TEXT NOT NULL,
     file_sha256        TEXT NOT NULL,
     vex_status         TEXT,
     vex_response       TEXT,
     vex_justification  TEXT,
     vex_reason         TEXT,
     pin                TEXT CHECK (pin IS NULL OR pin IN ('exact_version','any_version')),
     provenance_by      TEXT,
     provenance_at      TEXT,
     evidence           TEXT,
     sync_base          TEXT,
     pushed_at          TEXT,
     local_state        TEXT NOT NULL CHECK (local_state IN ('dirty','pushed','conflict','stale','orphaned','needs_completion')),
     drift_state        TEXT CHECK (drift_state IS NULL OR drift_state IN ('reattached_noop','reapply','stale','orphaned','conflict','needs_completion')),
     match_tier         TEXT CHECK (match_tier IS NULL OR match_tier IN ('purl','nvg','ng')),
     policy_warning_count   INTEGER NOT NULL DEFAULT 0 CHECK (policy_warning_count >= 0),
     policy_violation_count INTEGER NOT NULL DEFAULT 0 CHECK (policy_violation_count >= 0),
     indexed_at         TEXT NOT NULL,
     PRIMARY KEY (entity_kind, stable_key)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_overlay_project_state ON overlay_index (project_key, entity_kind, local_state, drift_state, stable_key)`,
  `CREATE INDEX IF NOT EXISTS ix_overlay_policy_flag ON overlay_index (project_key, entity_kind, policy_violation_count, policy_warning_count, stable_key)`,
  `CREATE INDEX IF NOT EXISTS ix_overlay_file ON overlay_index (file_path, stable_key)`,

  // Durable execution summary for ::fs-triage-summary and policy/import review.
  `CREATE TABLE IF NOT EXISTS triage_runs (
     run_id             TEXT PRIMARY KEY,
     project_id         TEXT NOT NULL,
     project_version_id TEXT,
     source             TEXT NOT NULL CHECK (source IN ('manual','policy','vendor_import','drift')),
     dry_run            INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0,1)),
     status             TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed')),
     input_digest       TEXT,
     written            INTEGER NOT NULL DEFAULT 0,
     held               INTEGER NOT NULL DEFAULT 0,
     conflicts          INTEGER NOT NULL DEFAULT 0,
     skipped_existing   INTEGER NOT NULL DEFAULT 0,
     errors             INTEGER NOT NULL DEFAULT 0,
     report_json        TEXT NOT NULL,
     created_at         TEXT NOT NULL,
     finished_at        TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS ix_triage_runs_scope ON triage_runs (project_id, project_version_id, created_at DESC, run_id)`,

  // ── SBOM ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sbom_components (
     project_version_id TEXT NOT NULL,
     project_id         TEXT NOT NULL,
     component_id       TEXT NOT NULL,
     component_key      TEXT NOT NULL,
     purl               TEXT,
     name               TEXT NOT NULL,
     component_group    TEXT,
     version            TEXT,
     cpe                TEXT,
     license            TEXT,
     supplier           TEXT,
     source             TEXT,
     file_locations     TEXT,
     is_stale           INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0,1)),
     raw                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_version_id, component_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_sbom_key ON sbom_components (project_version_id, component_key, component_id)`,
  `CREATE INDEX IF NOT EXISTS ix_sbom_purl ON sbom_components (project_id, purl, component_id)`,
  `CREATE INDEX IF NOT EXISTS ix_sbom_name ON sbom_components (project_version_id, name COLLATE NOCASE, component_group COLLATE NOCASE, version, component_id)`,

  `CREATE TABLE IF NOT EXISTS sbom_vuln_rollup (
     project_version_id   TEXT NOT NULL,
     component_key        TEXT NOT NULL,
     critical             INTEGER NOT NULL DEFAULT 0,
     high                 INTEGER NOT NULL DEFAULT 0,
     medium               INTEGER NOT NULL DEFAULT 0,
     low                  INTEGER NOT NULL DEFAULT 0,
     kev_count             INTEGER NOT NULL DEFAULT 0,
     max_epss              REAL,
     reachability_verdict  TEXT NOT NULL,
     computed_at           TEXT NOT NULL,
     PRIMARY KEY (project_version_id, component_key)
   )`,

  // ── HBOM YAML mirrors ────────────────────────────────────────────────────
  // Rebuilt from product-security/hbom/hbom.yaml. The file remains authority.
  `CREATE TABLE IF NOT EXISTS hbom_cells (
     project_key   TEXT NOT NULL,
     part_key      TEXT NOT NULL,
     field         TEXT NOT NULL,
     value         TEXT,
     provenance    TEXT,
     source_ref    TEXT,
     confidence    REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
     asserted_by   TEXT,
     asserted_at   TEXT,
     note          TEXT,
     accepted_by   TEXT,
     accepted_at   TEXT,
     state         TEXT NOT NULL CHECK (state IN ('verified','proposal','conflict','unknown','not_applicable')),
     file_sha256   TEXT NOT NULL,
     indexed_at    TEXT NOT NULL,
     PRIMARY KEY (project_key, part_key, field)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_hbom_review ON hbom_cells (project_key, state, part_key, field)`,

  `CREATE TABLE IF NOT EXISTS hbom_candidates (
     candidate_id  TEXT PRIMARY KEY,
     project_key   TEXT NOT NULL,
     part_key      TEXT NOT NULL,
     field         TEXT NOT NULL,
     value         TEXT,
     provenance    TEXT NOT NULL,
     source_ref    TEXT,
     confidence    REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
     asserted_by   TEXT NOT NULL,
     asserted_at   TEXT NOT NULL,
     status        TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','superseded')),
     indexed_at    TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_hbom_candidates_review ON hbom_candidates (project_key, status, part_key, field, candidate_id)`,
  `CREATE INDEX IF NOT EXISTS ix_hbom_candidates_source ON hbom_candidates (source_ref, project_key, part_key)`,

  // ── product security caches/vocabulary ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS standards (
     standard_id    TEXT PRIMARY KEY,
     code           TEXT NOT NULL,
     name           TEXT NOT NULL,
     scope          TEXT NOT NULL,
     review_status  TEXT,
     review_version TEXT NOT NULL DEFAULT '0',
     raw            TEXT NOT NULL,
     pulled_at      TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_standards_code ON standards (code, standard_id)`,

  `CREATE TABLE IF NOT EXISTS standards_clauses (
     standard_id     TEXT NOT NULL REFERENCES standards(standard_id) ON DELETE CASCADE,
     clause_id       TEXT NOT NULL,
     clause_code     TEXT NOT NULL,
     section_path    TEXT,
     parent_clause_id TEXT,
     title           TEXT,
     body            TEXT,
     review_status   TEXT,
     review_version  TEXT NOT NULL DEFAULT '0',
     raw             TEXT NOT NULL,
     pulled_at       TEXT NOT NULL,
     PRIMARY KEY (standard_id, clause_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_standard_clauses_path ON standards_clauses (standard_id, section_path, clause_code)`,

  // Validation vocabulary; JSON fields are server/profile data, never hard-coded guesses.
  `CREATE TABLE IF NOT EXISTS methodology_profiles (
     profile_id          TEXT PRIMARY KEY,
     project_id          TEXT,
     organization_id     TEXT,
     scope               TEXT NOT NULL,
     name                TEXT NOT NULL,
     asset_properties    TEXT NOT NULL,
     impact_dimensions   TEXT NOT NULL,
     risk_scale          TEXT NOT NULL,
     assurance_levels    TEXT NOT NULL,
     ownership_labels    TEXT NOT NULL,
     stride_map          TEXT NOT NULL,
     review_version      TEXT NOT NULL DEFAULT '0',
     raw                 TEXT NOT NULL,
     pulled_at           TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_methodology_project ON methodology_profiles (project_id, scope, profile_id)`,

  // Cached attack-path body; .fs/attack-paths holds viability decisions.
  `CREATE TABLE IF NOT EXISTS attack_paths (
     project_id      TEXT NOT NULL,
     path_id         TEXT NOT NULL,
     route_signature TEXT NOT NULL,
     name            TEXT,
     threat_key      TEXT,
     steps           TEXT NOT NULL,
     edges           TEXT,
     total_steps     INTEGER,
     zones_traversed TEXT,
     exploitability TEXT,
     review_status   TEXT,
     review_version  TEXT NOT NULL DEFAULT '0',
     raw             TEXT NOT NULL,
     pulled_at       TEXT NOT NULL,
     PRIMARY KEY (project_id, path_id),
     UNIQUE (project_id, route_signature)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_attack_paths_threat ON attack_paths (project_id, threat_key, path_id)`,

  // ── verification + bench evidence ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS verification_checks (
     check_id          TEXT PRIMARY KEY,
     project_id        TEXT,
     code              TEXT NOT NULL,
     name              TEXT NOT NULL,
     check_type        TEXT NOT NULL,
     category          TEXT,
     description       TEXT,
     pass_criteria     TEXT,
     fail_criteria     TEXT,
     input_description TEXT,
     parameters        TEXT,
     default_sla_days  INTEGER,
     deleted_at        TEXT,
     review_status     TEXT,
     review_version    TEXT NOT NULL DEFAULT '0',
     raw               TEXT NOT NULL,
     pulled_at         TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ix_verification_checks_code ON verification_checks (COALESCE(project_id,''), code)`,

  // Server mapping body; authored required/suppressed/coverage decisions remain in requirement YAML/overlay.
  `CREATE TABLE IF NOT EXISTS requirement_check_mappings (
     project_id       TEXT NOT NULL,
     requirement_key  TEXT NOT NULL,
     check_id         TEXT NOT NULL REFERENCES verification_checks(check_id) ON DELETE CASCADE,
     is_required      INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
     coverage_level   TEXT,
     suppressed       INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0,1)),
     raw              TEXT NOT NULL,
     pulled_at        TEXT NOT NULL,
     PRIMARY KEY (project_id, requirement_key, check_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_req_check_check ON requirement_check_mappings (check_id, project_id, requirement_key)`,

  // Server-derived requirement status. Never authored and never written back from this table.
  `CREATE TABLE IF NOT EXISTS requirement_rollup (
     project_id             TEXT NOT NULL,
     requirement_key        TEXT NOT NULL,
     verification_status    TEXT,
     total_checks           INTEGER NOT NULL DEFAULT 0,
     verified_checks        INTEGER NOT NULL DEFAULT 0,
     failed_checks          INTEGER NOT NULL DEFAULT 0,
     error_checks           INTEGER NOT NULL DEFAULT 0,
     inconclusive_checks    INTEGER NOT NULL DEFAULT 0,
     running_checks         INTEGER NOT NULL DEFAULT 0,
     pending_checks         INTEGER NOT NULL DEFAULT 0,
     skipped_checks         INTEGER NOT NULL DEFAULT 0,
     last_run_at            TEXT,
     pulled_at              TEXT NOT NULL,
     PRIMARY KEY (project_id, requirement_key)
   )`,

  // Unified verification/bench run cache. ACTION-ONLY to start; CACHED to display.
  `CREATE TABLE IF NOT EXISTS verification_runs (
     run_id          TEXT PRIMARY KEY,
     project_id      TEXT NOT NULL,
     pv_id           TEXT,
     tier            TEXT NOT NULL CHECK (tier IN ('tier0','tier1','tier2','tier3','tier4')),
     matrix_col      TEXT NOT NULL CHECK (matrix_col IN ('static','emulation','hil','manual')),
     kind            TEXT NOT NULL,
     trigger         TEXT,
     host_id         TEXT,
     thread_id       TEXT,
     target          TEXT,
     config          TEXT,
     status          TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','timeout')),
     started_at      TEXT,
     finished_at     TEXT,
     duration_ms     INTEGER,
     firmware_digest TEXT,
     job_id          TEXT,
     log_locator     TEXT,
     log_cursor      TEXT,
     raw             TEXT NOT NULL,
     synced_at       TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_recent ON verification_runs (project_id, pv_id, started_at DESC, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_host ON verification_runs (host_id, thread_id, status, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_job ON verification_runs (job_id)`,

  // Latest + history. Status is normalized evidence truth; raw retains richer upstream values.
  `CREATE TABLE IF NOT EXISTS verification_results (
     result_id                TEXT PRIMARY KEY,
     run_id                   TEXT REFERENCES verification_runs(run_id) ON DELETE SET NULL,
     project_id               TEXT NOT NULL,
     pv_id                    TEXT,
     requirement_key          TEXT,
     check_id                 TEXT,
     tier                     TEXT NOT NULL CHECK (tier IN ('static','emulation','hil','manual')),
     status                   TEXT NOT NULL CHECK (status IN ('verified','failed','error','inconclusive','running','pending','skipped')),
     outcome                  TEXT,
     confidence               TEXT,
     evidence_summary         TEXT,
     result_data              TEXT,
     measured                 TEXT,
     executed_at              TEXT,
     executed_by              TEXT,
     failure_reason           TEXT,
     remediation_suggestion   TEXT,
     fs_version_id            TEXT,
     fs_version_name          TEXT,
     is_latest                INTEGER NOT NULL DEFAULT 0 CHECK (is_latest IN (0,1)),
     superseded_by            TEXT,
     sla_status               TEXT,
     mapping_state            TEXT NOT NULL DEFAULT 'mapped' CHECK (mapping_state IN ('mapped','unmapped')),
     raw                      TEXT NOT NULL,
     pulled_at                TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_matrix ON verification_results (project_id, pv_id, requirement_key, tier, is_latest, executed_at DESC, result_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_check ON verification_results (check_id, is_latest, executed_at DESC, result_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_run ON verification_results (run_id, result_id)`,

  `CREATE TABLE IF NOT EXISTS verification_artifacts (
     artifact_id   TEXT PRIMARY KEY,
     run_id        TEXT NOT NULL REFERENCES verification_runs(run_id) ON DELETE CASCADE,
     result_id     TEXT REFERENCES verification_results(result_id) ON DELETE SET NULL,
     name          TEXT NOT NULL,
     kind          TEXT NOT NULL,
     locator       TEXT NOT NULL,
     media_type    TEXT,
     sha256        TEXT,
     bytes         INTEGER,
     created_at    TEXT,
     pulled_at     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_verification_artifacts_run ON verification_artifacts (run_id, kind, artifact_id)`,

  // `verified` is local verification output, never trusted directly from an upstream boolean.
  `CREATE TABLE IF NOT EXISTS attestations (
     attestation_id       TEXT PRIMARY KEY,
     run_id               TEXT NOT NULL REFERENCES verification_runs(run_id) ON DELETE CASCADE,
     format               TEXT NOT NULL,
     predicate_type       TEXT,
     subject_digest       TEXT NOT NULL,
     evidence_digest      TEXT,
     verdict              TEXT,
     requirement_ids      TEXT,
     check_ids            TEXT,
     result_refs          TEXT,
     signer_identity      TEXT,
     rekor_uuid           TEXT,
     envelope_locator     TEXT,
     payload              TEXT NOT NULL,
     signature_verified   INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0,1)),
     subject_matches_run  INTEGER NOT NULL DEFAULT 0 CHECK (subject_matches_run IN (0,1)),
     verified             INTEGER NOT NULL DEFAULT 0
                            CHECK (verified IN (0,1)
                              AND (verified = 0 OR (signature_verified = 1 AND subject_matches_run = 1))),
     created_at           TEXT NOT NULL,
     pulled_at            TEXT NOT NULL,
     UNIQUE (run_id, attestation_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_attestations_run ON attestations (run_id, verified, attestation_id)`,
  `CREATE INDEX IF NOT EXISTS ix_attestations_subject ON attestations (subject_digest, verified, attestation_id)`,

  // ── firmware mount registry only; manifest.sqlite belongs to WP-47 ───────
  `CREATE TABLE IF NOT EXISTS firmware_mounts (
     pv_id               TEXT PRIMARY KEY,
     project_id          TEXT,
     source              TEXT NOT NULL CHECK (source IN ('api','standalone_unpack')),
     state               TEXT NOT NULL CHECK (state IN ('not_materialized','hashing','unpacking','validating','ingesting','ready','ready_with_gaps','metadata_only','stale','error')),
     scan_id             TEXT,
     input_sha256        TEXT,
     artifact_hash       TEXT,
     root_path           TEXT NOT NULL,
     file_count          INTEGER NOT NULL DEFAULT 0,
     materialized_files  INTEGER NOT NULL DEFAULT 0,
     error_count         INTEGER NOT NULL DEFAULT 0,
     admin_bytes_ok      INTEGER CHECK (admin_bytes_ok IS NULL OR admin_bytes_ok IN (0,1)),
     message             TEXT,
     materialized_at     TEXT,
     pulled_at           TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_firmware_mounts_state ON firmware_mounts (project_id, state, pv_id)`,

  // ── one plugin-local, project-scoped document ledger ─────────────────────
  `CREATE TABLE IF NOT EXISTS document (
     document_id      TEXT PRIMARY KEY,
     project_key      TEXT NOT NULL,
     sha256           TEXT NOT NULL,
     name             TEXT NOT NULL,
     path             TEXT NOT NULL,
     doc_kind         TEXT NOT NULL CHECK (doc_kind IN ('datasheet','bom','schematic','spec','regulatory','register_map','other')),
     mime_type        TEXT NOT NULL,
     bytes            INTEGER NOT NULL,
     withdrawn        INTEGER NOT NULL DEFAULT 0 CHECK (withdrawn IN (0,1)),
     needs_ocr        INTEGER NOT NULL DEFAULT 0 CHECK (needs_ocr IN (0,1)),
     uploaded_at      TEXT NOT NULL,
     analyzed_by      TEXT,
     analyzed_at      TEXT,
     cells_extracted  INTEGER NOT NULL DEFAULT 0,
     indexed_at       TEXT NOT NULL,
     UNIQUE (project_key, sha256)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_document_list ON document (project_key, doc_kind, withdrawn, uploaded_at DESC, document_id)`,

  // Rebuildable extraction/source-reference projection. Document bytes/files remain authority.
  `CREATE TABLE IF NOT EXISTS document_extraction (
     extraction_id    TEXT PRIMARY KEY,
     document_id      TEXT NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
     field             TEXT NOT NULL,
     value             TEXT,
     confidence        REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
     source_ref        TEXT NOT NULL,
     locator_kind      TEXT NOT NULL CHECK (locator_kind IN ('pdf','sheet','text')),
     page              INTEGER,
     bbox              TEXT,
     sheet             TEXT,
     cell              TEXT,
     line_start        INTEGER,
     line_end          INTEGER,
     target_surface    TEXT,
     target_id         TEXT,
     target_field      TEXT,
     status            TEXT NOT NULL CHECK (status IN ('proposal','accepted','rejected','withdrawn')),
     extracted_by      TEXT,
     extracted_at      TEXT NOT NULL,
     raw               TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS ix_document_extraction_source ON document_extraction (document_id, locator_kind, page, sheet, cell, line_start, extraction_id)`,
  `CREATE INDEX IF NOT EXISTS ix_document_extraction_target ON document_extraction (target_surface, target_id, target_field, status, extraction_id)`,
  `CREATE INDEX IF NOT EXISTS ix_document_extraction_search ON document_extraction (field COLLATE NOCASE, value COLLATE NOCASE, status, document_id, extraction_id)`,

  `CREATE VIEW IF NOT EXISTS hbom_docs AS
     SELECT document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
            withdrawn, needs_ocr, uploaded_at, analyzed_by, analyzed_at, cells_extracted, indexed_at
       FROM document
      WHERE doc_kind IN ('datasheet','bom','schematic')`,
];
```

```ts
// lib/store/index.ts
import type Database from "better-sqlite3";
import type { BbPluginApi } from "@bb/plugin-sdk";
import { MIGRATIONS } from "./schema";

export interface Store { readonly db: Database.Database; tx<T>(fn: () => T): T; }
export function openStore(bb: BbPluginApi): Store;

// One exact snake_case interface per table/view; no `Record<string, unknown>` rows.
export interface SyncStateRow {
  entity_kind: string; scope: string; last_pull: string | null;
  cursor: string | null; error: string | null;
}
export interface PushLogRow {
  id: number; run_id: string; entity_kind: string; entity_key: string;
  op: "create" | "update" | "delete" | "noop" | "conflict";
  status: "pending" | "applied" | "failed" | "skipped";
  error: string | null; applied_at: string | null;
}
export interface BaseSnapshotRow {
  entity_kind: string; entity_key: string; remote_id: string | null;
  payload: string; content_hash: string; pulled_at: string;
}
export interface IdMapRow {
  entity_kind: string; entity_key: string; remote_id: string;
}
export interface EntityReviewStateRow {
  project_id: string; entity_kind: string; entity_key: string; remote_id: string;
  review_status: string | null; review_version: string; pulled_at: string;
}
export interface FindingRow {
  finding_id: string; project_id: string; project_version_id: string; stable_key: string;
  finding_type: string | null; cve: string | null; title: string | null;
  component_name: string | null; component_group: string | null;
  component_version: string | null; component_purl: string | null;
  severity: string | null; risk_score: number | null; band: string | null;
  cvss_score: number | null; cvss_vector: string | null;
  epss_score: number | null; epss_percentile: number | null;
  in_kev: 0 | 1; in_vc_kev: 0 | 1; has_exploit: 0 | 1;
  exploit_maturity: string | null; reachability_score: number | null;
  reachability_verdict: string | null; reachability_factors: string | null;
  vuln_in_dataset: 0 | 1 | null; cwes: string; warning_count: number; violation_count: number;
  location: string | null;
  vex_status: string | null; vex_response: string | null;
  vex_justification: string | null; vex_reason: string | null;
  comments: string; first_seen: string | null; soft_deleted: 0 | 1; raw: string; pulled_at: string;
}
export interface FindingCweRow {
  project_version_id: string; finding_id: string; cwe: string; pulled_at: string;
}
export interface FindingActivityRow {
  project_version_id: string; finding_id: string; event_id: string; stable_key: string;
  actor: string | null; event_at: string; source: string | null;
  old_tuple: string | null; new_tuple: string | null; raw: string; pulled_at: string;
}
export interface OverlayIndexRow {
  entity_kind: string; project_key: string; stable_key: string;
  component_key: string | null; cve: string | null; file_path: string; file_sha256: string;
  vex_status: string | null; vex_response: string | null;
  vex_justification: string | null; vex_reason: string | null;
  pin: "exact_version" | "any_version" | null;
  provenance_by: string | null; provenance_at: string | null; evidence: string | null;
  sync_base: string | null; pushed_at: string | null;
  local_state: "dirty" | "pushed" | "conflict" | "stale" | "orphaned" | "needs_completion";
  drift_state: "reattached_noop" | "reapply" | "stale" | "orphaned" | "conflict" | "needs_completion" | null;
  match_tier: "purl" | "nvg" | "ng" | null;
  policy_warning_count: number; policy_violation_count: number; indexed_at: string;
}
export interface TriageRunRow {
  run_id: string; project_id: string; project_version_id: string | null;
  source: "manual" | "policy" | "vendor_import" | "drift"; dry_run: 0 | 1;
  status: "running" | "completed" | "partial" | "failed";
  input_digest: string | null; written: number; held: number; conflicts: number;
  skipped_existing: number; errors: number; report_json: string;
  created_at: string; finished_at: string | null;
}
export interface SbomComponentRow {
  project_version_id: string; project_id: string; component_id: string; component_key: string;
  purl: string | null; name: string; component_group: string | null; version: string | null;
  cpe: string | null; license: string | null; supplier: string | null;
  source: string | null; file_locations: string | null; is_stale: 0 | 1;
  raw: string; pulled_at: string;
}
export interface SbomVulnRollupRow {
  project_version_id: string; component_key: string; critical: number; high: number;
  medium: number; low: number; kev_count: number; max_epss: number | null;
  reachability_verdict: string; computed_at: string;
}
export interface HbomCellRow {
  project_key: string; part_key: string; field: string; value: string | null;
  provenance: string | null; source_ref: string | null; confidence: number | null;
  asserted_by: string | null; asserted_at: string | null; note: string | null;
  accepted_by: string | null; accepted_at: string | null;
  state: "verified" | "proposal" | "conflict" | "unknown" | "not_applicable";
  file_sha256: string; indexed_at: string;
}
export interface HbomCandidateRow {
  candidate_id: string; project_key: string; part_key: string; field: string;
  value: string | null; provenance: string; source_ref: string | null; confidence: number;
  asserted_by: string; asserted_at: string;
  status: "pending" | "accepted" | "rejected" | "superseded"; indexed_at: string;
}
export interface StandardRow {
  standard_id: string; code: string; name: string; scope: string;
  review_status: string | null; review_version: string; raw: string; pulled_at: string;
}
export interface StandardsClauseRow {
  standard_id: string; clause_id: string; clause_code: string;
  section_path: string | null; parent_clause_id: string | null;
  title: string | null; body: string | null; review_status: string | null;
  review_version: string; raw: string; pulled_at: string;
}
export interface MethodologyProfileRow {
  profile_id: string; project_id: string | null; organization_id: string | null;
  scope: string; name: string; asset_properties: string; impact_dimensions: string;
  risk_scale: string; assurance_levels: string; ownership_labels: string;
  stride_map: string; review_version: string; raw: string; pulled_at: string;
}
export interface AttackPathRow {
  project_id: string; path_id: string; route_signature: string; name: string | null;
  threat_key: string | null; steps: string; edges: string | null; total_steps: number | null;
  zones_traversed: string | null; exploitability: string | null;
  review_status: string | null; review_version: string; raw: string; pulled_at: string;
}
export interface VerificationCheckRow {
  check_id: string; project_id: string | null; code: string; name: string; check_type: string;
  category: string | null; description: string | null; pass_criteria: string | null;
  fail_criteria: string | null; input_description: string | null; parameters: string | null;
  default_sla_days: number | null; deleted_at: string | null; review_status: string | null;
  review_version: string; raw: string; pulled_at: string;
}
export interface RequirementCheckMappingRow {
  project_id: string; requirement_key: string; check_id: string;
  is_required: 0 | 1; coverage_level: string | null; suppressed: 0 | 1;
  raw: string; pulled_at: string;
}
export interface RequirementRollupRow {
  project_id: string; requirement_key: string; verification_status: string | null;
  total_checks: number; verified_checks: number; failed_checks: number;
  error_checks: number; inconclusive_checks: number; running_checks: number;
  pending_checks: number; skipped_checks: number; last_run_at: string | null; pulled_at: string;
}
export interface VerificationRunRow {
  run_id: string; project_id: string; pv_id: string | null;
  tier: "tier0" | "tier1" | "tier2" | "tier3" | "tier4";
  matrix_col: "static" | "emulation" | "hil" | "manual";
  kind: string; trigger: string | null; host_id: string | null; thread_id: string | null;
  target: string | null; config: string | null;
  status: "queued" | "running" | "completed" | "failed" | "timeout";
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
  firmware_digest: string | null; job_id: string | null; log_locator: string | null;
  log_cursor: string | null; raw: string; synced_at: string;
}
export interface VerificationResultRow {
  result_id: string; run_id: string | null; project_id: string; pv_id: string | null;
  requirement_key: string | null; check_id: string | null;
  tier: "static" | "emulation" | "hil" | "manual";
  status: "verified" | "failed" | "error" | "inconclusive" | "running" | "pending" | "skipped";
  outcome: string | null; confidence: string | null; evidence_summary: string | null;
  result_data: string | null; measured: string | null; executed_at: string | null;
  executed_by: string | null; failure_reason: string | null;
  remediation_suggestion: string | null; fs_version_id: string | null;
  fs_version_name: string | null; is_latest: 0 | 1; superseded_by: string | null;
  sla_status: string | null; mapping_state: "mapped" | "unmapped"; raw: string; pulled_at: string;
}
export interface VerificationArtifactRow {
  artifact_id: string; run_id: string; result_id: string | null; name: string; kind: string;
  locator: string; media_type: string | null; sha256: string | null; bytes: number | null;
  created_at: string | null; pulled_at: string;
}
export interface AttestationRow {
  attestation_id: string; run_id: string; format: string; predicate_type: string | null;
  subject_digest: string; evidence_digest: string | null; verdict: string | null;
  requirement_ids: string | null; check_ids: string | null; result_refs: string | null;
  signer_identity: string | null; rekor_uuid: string | null; envelope_locator: string | null;
  payload: string; signature_verified: 0 | 1; subject_matches_run: 0 | 1; verified: 0 | 1;
  created_at: string; pulled_at: string;
}
export interface FirmwareMountRow {
  pv_id: string; project_id: string | null; source: "api" | "standalone_unpack";
  state: "not_materialized" | "hashing" | "unpacking" | "validating" | "ingesting" |
    "ready" | "ready_with_gaps" | "metadata_only" | "stale" | "error";
  scan_id: string | null; input_sha256: string | null; artifact_hash: string | null;
  root_path: string; file_count: number; materialized_files: number; error_count: number;
  admin_bytes_ok: 0 | 1 | null; message: string | null;
  materialized_at: string | null; pulled_at: string;
}
export interface DocumentRow {
  document_id: string; project_key: string; sha256: string; name: string; path: string;
  doc_kind: "datasheet" | "bom" | "schematic" | "spec" | "regulatory" | "register_map" | "other";
  mime_type: string; bytes: number; withdrawn: 0 | 1; needs_ocr: 0 | 1;
  uploaded_at: string; analyzed_by: string | null; analyzed_at: string | null;
  cells_extracted: number; indexed_at: string;
}
export interface DocumentExtractionRow {
  extraction_id: string; document_id: string; field: string; value: string | null;
  confidence: number | null; source_ref: string; locator_kind: "pdf" | "sheet" | "text";
  page: number | null; bbox: string | null; sheet: string | null; cell: string | null;
  line_start: number | null; line_end: number | null; target_surface: string | null;
  target_id: string | null; target_field: string | null;
  status: "proposal" | "accepted" | "rejected" | "withdrawn";
  extracted_by: string | null; extracted_at: string; raw: string | null;
}
export interface HbomDocRow {
  document_id: string; project_key: string; sha256: string; name: string; path: string;
  doc_kind: "datasheet" | "bom" | "schematic"; mime_type: string; bytes: number;
  withdrawn: 0 | 1; needs_ocr: 0 | 1; uploaded_at: string;
  analyzed_by: string | null; analyzed_at: string | null;
  cells_extracted: number; indexed_at: string;
}
```

The implementation expands every abbreviated row interface; comments are not accepted in place of fields. SQLite integers representing booleans map to `0|1`; nullable columns map to `T|null`. `review_version` is stored as decimal TEXT to cross the JSON/JavaScript boundary without losing bigint precision.

## Acceptance criteria
- [ ] `MIGRATIONS` applies cleanly to an empty real SQLite database and `bb.storage.migrate` records each statement once; a second call is a no-op.
- [ ] All 28 tables and the `hbom_docs` view above exist; `hbom_docs` is a view over `document`, not another ledger.
- [ ] Every WP-05 CACHED registry storage name resolves and its table/view kind matches the registry.
- [ ] Finding pulls preserve nullable `vuln_in_dataset`, canonical `cwes` JSON, upstream/equivalent `risk_score`, upstream warning/violation counts, and the explicitly computed `band`; policy selectors use `ix_findings_policy_dataset`, `ix_findings_policy_band`, `ix_findings_policy_flags`, and normalized `finding_cwes`, not JSON `LIKE` scans or an invented band algorithm.
- [ ] Finding comments remain bounded canonical JSON on each cached row, while `finding_activity` supports stable-key/version-scoped, newest-first paging with actor/time/source/old/new tuple and cache freshness; neither is authored YAML truth.
- [ ] `overlay_index` carries decision tuple, pin, file/digest, provenance, sync base, pushed time, checked local state, separately checked nullable drift classification, match tier, and policy warning/violation counts required by WP-24/WP-27–30; deleting/rebuilding it from YAML loses nothing.
- [ ] `triage_runs` durably serves policy/import/manual/drift summaries for `triage.run.get` and `::fs-triage-summary` without storing finding dumps.
- [ ] Verification checks, requirement mappings/rollup, result history/latest chain, tier, run, artifacts, and attestations support WP-36–40 with `verification_status` clearly server-derived/read-only.
- [ ] Standards/clauses and methodology vocabulary carry `review_version` and freshness; there is no `entity_version` concurrency field.
- [ ] Threat, requirement, and other reviewable-row lifecycle state survives semantic payload stripping in `entity_review_state`; transitions retrieve the exact cached decimal `review_version` by project/kind/stable key.
- [ ] Unified runs carry host/thread/kind/trigger/config/job/log linkage and firmware digest; results/attestations can prove exact requirement/check evidence for a version-scoped verdict.
- [ ] An attestation cannot be marked locally verified unless repository logic proves both signature validity and subject equality to `verification_runs.firmware_digest`.
- [ ] Documents are project-scoped and unique by `(project_key,sha256)`; extraction rows preserve PDF page/bbox, sheet/cell, text line range, target, source-ref, status, actor, and time.
- [ ] HBOM mirrors include trust/review state and accepted actor/time but remain rebuildable from the one YAML artifact.
- [ ] Every cache/projection exposes a freshness timestamp of the appropriate kind.
- [ ] `openStore` memoizes per plugin context, enables foreign keys, and `tx()` fully rolls back on error.
- [ ] An exact typed row interface exists for every table/view and is mechanically compared with `PRAGMA table_info`.
- [ ] Representative 4k-finding, 10k-SBOM, 5k×4 verification-matrix, run-timeline, and document-search queries use the named indices and meet their downstream WP budgets.
- [ ] `schema.ts` exports no firmware manifest migration; WP-47 sidecar tests remain independent.

## Test plan — `shared-store-freeze`
- `empty and repeated migration` — real `better-sqlite3`, `_bb_migrations` count stable.
- `storage inventory and registry parity` — explicit 28-table/one-view list plus every WP-05 CACHED name.
- `row interfaces match SQL` — compare explicit runtime column-name fixtures to `PRAGMA table_info`; view columns included.
- `foreign keys and transaction rollback` (**error path**) — invalid extraction/check/run relation fails and no partial checkpoint remains.
- `closed-state/check constraints` (**error path**) — invalid confidence, boolean, run/tier/status, locator kind, or doc kind fails without accepting upstream fiction.
- `overlay and HBOM rebuild` — seed projection, drop rows, rebuild from YAML fixture, compare canonical query output.
- `overlay state and policy filters` — every local/drift state is distinct, drift may be null before classification, illegal/ambiguous states fail their checks, and the needs-attention/policy-flag filters use `ix_overlay_project_state`/`ix_overlay_policy_flag` (**error + query-plan path**).
- `triage run survives overlay rebuild` — execution journal remains available and bounded.
- `policy selector plans` — nullable dataset membership, risk band, warning/violation flag, KEV/severity/type, and CWE membership return the fixture truth; `EXPLAIN QUERY PLAN` names `ix_findings_policy_dataset`, `ix_findings_policy_band`, `ix_findings_policy_flags`, and `ix_finding_cwes_selector`, and malformed CWE JSON is rejected at the pull boundary (**error path**).
- `finding detail cache` — comments round-trip from the bounded JSON fixture; duplicate-timestamp audit events page without gaps through `ix_finding_activity_stable`; malformed comment/event payload is rejected without discarding the prior complete cache (**error path**).
- `review token survives semantic stripping` — requirement/threat semantic snapshots contain no review fields while lifecycle lookup returns the exact `review_version`; an absent/stale token blocks the action and requests refresh (**concurrency/error path**).
- `verification latest/history/matrix` — mapped/unmapped, superseded, four tiers, manual result, rollup freshness, and one indexed page for 5,000 requirements.
- `bench evidence checkpoint` — run/results/artifacts/attestation inserts atomically; host/thread/trigger preserved; mismatched subject cannot set verified (**trust/error path**).
- `document locator matrix` — valid page/bbox, sheet/cell, text lines, targets/status; invalid project/doc FK and malformed locator rejected by repository validation.
- `performance plans` — assert `EXPLAIN QUERY PLAN` uses the intended indices before enforcing timing thresholds.

## Do not
- Do not create `migrations/*.sql`; plugin migrations are the inline TS array.
- Do not export or import `MANIFEST_MIGRATIONS`; WP-47 owns its sidecar database and lifecycle.
- Do not edit/reorder a statement after freeze; file an amendment and append.
- Do not store authored threats, requirements, VEX/HBOM decisions, policy, or document bytes as SQLite truth.
- Do not treat `verification_status`, confidence, signature presence, `verified`, or upstream `safe` booleans as user-settable proof.
- Do not use `entity_version` for standards/review concurrency; RECON's `review_version` correction wins.
- Do not store arbitrary upstream absolute paths in artifact/browser-facing columns. `root_path`, `path`, and locators are backend-confined/worktree-relative and never returned raw to the browser.
- Do not add a duplicate `bench_*` or `hbom_docs` table.
- Do not mock SQLite.

## Open questions
1. **Attestation coverage granularity:** `result_refs`/`requirement_ids`/`check_ids` preserve the signed envelope's explicit coverage. Until the platform guarantees one mapping, WP-55 must treat missing explicit result coverage as inconclusive, never infer it.
2. **Stable-key query decomposition:** `findings` keeps identity columns plus the opaque canonical key, so WP-23 should not require a migration. If its final route-safe codec needs a materially different query index, prove it with the 39k fixture before requesting an amendment.
3. **Methodology vocabulary shape:** the profile's individual vocabularies are cached as JSON from the verified server payload. Unknown fields stay in `raw`; plan validation must fail visible on missing/unrecognized vocabulary rather than invent defaults.
