// lib/store/schema.ts — FROZEN on merge.
// Amendment + CONTRACT_VERSION bump + lane broadcast required after freeze.
// APPEND-ONLY after first release: never reorder/edit a shipped statement.
// This is shared data.db only. WP-47 owns every manifest.sqlite statement.

export const SCHEMA_VERSION = 1 as const;

export const CACHE_STORAGE_NAMES = [
  "findings",
  "sbom_components",
  "standards_clauses",
  "attack_paths",
  "verification_runs",
  "verification_results",
  "firmware_mounts",
  "document",
  "hbom_docs",
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

  // Execution journal for resumable remote applies; never authored model state.
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

  // Server-owned lifecycle cache, separate from semantic base snapshots/YAML.
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
  // Upstream findings cache; canonical authored VEX decisions live in tracked YAML.
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

  // Durable execution journal for ::fs-triage-summary and policy/import review.
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
  // Upstream SBOM cache; refresh-only and rebuildable from the selected version.
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

  // Derived rollup over cached findings and SBOM identity; safe to recompute.
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

  // Rebuildable competing-claim projection from the authoritative HBOM YAML.
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
  // Upstream standards cache; authored requirement links remain in tracked YAML.
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

  // Upstream clause cache; requirement rationale and mappings remain authored YAML.
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
  // Upstream check-body cache; authored parameters and mappings use overlays/YAML.
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

  // Latest + history cache. Status is normalized evidence truth; raw retains richer upstream values.
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

  // Rebuildable evidence-artifact cache; artifact bytes remain behind controlled locators.
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

  // Cached signed evidence. `verified` is local verification output, never an upstream assertion.
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
  // Registry/cache of mount state; firmware bytes and sidecar manifests remain on disk.
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
  // Ledger projection over git-tracked documents; document files remain authority.
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

  // Filtered projection over the one document ledger; never a second HBOM document table.
  `CREATE VIEW IF NOT EXISTS hbom_docs AS
     SELECT document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
            withdrawn, needs_ocr, uploaded_at, analyzed_by, analyzed_at, cells_extracted, indexed_at
       FROM document
      WHERE doc_kind IN ('datasheet','bom','schematic')`,
];
