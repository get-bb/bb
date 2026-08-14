// lib/store/schema.ts — FROZEN on merge.
// Amendment + CONTRACT_VERSION bump + lane broadcast required after freeze.
// APPEND-ONLY after first release: never reorder/edit a shipped statement.
// This is shared data.db only. WP-47 owns every manifest.sqlite statement.

export const SCHEMA_VERSION = 3 as const;

export const SCHEMA_TABLES = [
  "pull_generation",
  "sync_state",
  "workspace_platform_project_binding",
  "push_log",
  "base_snapshot",
  "id_map",
  "entity_review_state",
  "findings",
  "finding_cwes",
  "finding_activity",
  "overlay_index",
  "triage_runs",
  "sbom_components",
  "sbom_vuln_rollup",
  "hbom_cells",
  "hbom_candidates",
  "standards",
  "standards_clauses",
  "methodology_profiles",
  "attack_paths",
  "verification_checks",
  "requirement_check_mappings",
  "requirement_rollup",
  "verification_runs",
  "verification_results",
  "verification_artifacts",
  "attestations",
  "firmware_mounts",
  "document",
  "document_extraction",
  "hw_project",
  "hw_artifact",
  "hw_symbol",
  "hw_net",
  "hw_sheet",
  "hw_ingest",
  "hw_violation",
  "ground_source",
  "ground_chunk",
  "bench_device",
  "probe_run",
  "build_run",
] as const;

export const SCHEMA_INDEXES = [
  "ix_pull_generation_status",
  "ix_sync_state_generation",
  "ix_workspace_platform_project_binding_platform",
  "ix_push_log_run",
  "ix_entity_review_state_status",
  "ix_findings_page",
  "ix_findings_stable",
  "ix_findings_cve",
  "ix_findings_component",
  "ix_findings_risk",
  "ix_findings_epss",
  "ix_findings_kev",
  "ix_findings_reachability",
  "ix_findings_policy_dataset",
  "ix_findings_policy_band",
  "ix_findings_policy_flags",
  "ix_findings_type",
  "ix_finding_cwes_selector",
  "ix_finding_activity_stable",
  "ix_overlay_project_state",
  "ix_overlay_policy_flag",
  "ix_overlay_file",
  "ix_triage_runs_scope",
  "ix_sbom_key",
  "ix_sbom_purl",
  "ix_sbom_name",
  "ix_hbom_review",
  "ix_hbom_candidates_review",
  "ix_hbom_candidates_source",
  "ix_standards_code",
  "ix_standard_clauses_path",
  "ix_methodology_project",
  "ix_attack_paths_threat",
  "ix_verification_checks_code",
  "ix_req_check_check",
  "ix_verification_runs_recent",
  "ix_verification_runs_host",
  "ix_verification_runs_job",
  "ix_verification_results_matrix",
  "ix_verification_results_check",
  "ix_verification_results_run",
  "ix_verification_artifacts_run",
  "ix_attestations_run",
  "ix_attestations_subject",
  "ix_firmware_mounts_state",
  "ix_document_list",
  "ix_document_extraction_source",
  "ix_document_extraction_target",
  "ix_document_extraction_search",
  "ix_hw_symbol_ref",
  "ix_hw_symbol_mpn",
  "ix_chunk_source",
] as const;

export const SCHEMA_VIEWS = ["hbom_docs"] as const;

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
  "hw_project",
  "hw_artifact",
  "hw_symbol",
  "hw_net",
  "hw_sheet",
  "hw_ingest",
  "hw_violation",
  "ground_source",
  "ground_chunk",
  "bench_device",
  "probe_run",
  "build_run",
] as const;

export type CacheStorageName = (typeof CACHE_STORAGE_NAMES)[number];

export const MIGRATIONS: string[] = [
  // ── shared bookkeeping + atomic pull publication ─────────────────────────
  // Pull execution control only; never semantic or authored model state.
  `CREATE TABLE pull_generation (
     project_id           TEXT NOT NULL,
     project_version_id   TEXT NOT NULL,
     generation_id        TEXT NOT NULL,
     status               TEXT NOT NULL CHECK (status IN ('staging','accepted','superseded','failed','cancelled')),
     requested_kinds_json TEXT NOT NULL,
     started_at           TEXT NOT NULL,
     completed_at         TEXT,
     accepted_at          TEXT,
     error                TEXT,
     PRIMARY KEY (project_id, project_version_id, generation_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_pull_generation_status ON pull_generation (project_id, project_version_id, status, started_at DESC, generation_id)`,

  // Per-kind publication pointers and stale-plan revision fence; never model state.
  `CREATE TABLE sync_state (
     project_id              TEXT NOT NULL,
     project_version_id      TEXT NOT NULL,
     entity_kind             TEXT NOT NULL,
     accepted_generation_id  TEXT,
     staging_generation_id   TEXT,
     base_revision           INTEGER NOT NULL DEFAULT 0 CHECK (base_revision >= 0),
     staging_continuation    TEXT,
     staged_pages            INTEGER NOT NULL DEFAULT 0 CHECK (staged_pages >= 0),
     staged_rows             INTEGER NOT NULL DEFAULT 0 CHECK (staged_rows >= 0),
     last_pull               TEXT,
     error                   TEXT,
     PRIMARY KEY (project_id, project_version_id, entity_kind),
     FOREIGN KEY (project_id, project_version_id, accepted_generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id),
     FOREIGN KEY (project_id, project_version_id, staging_generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_sync_state_generation ON sync_state (project_id, project_version_id, accepted_generation_id, staging_generation_id, entity_kind)`,

  // Durable, resumable per-entity apply journal; never authored model state.
  `CREATE TABLE push_log (
     project_id                TEXT NOT NULL,
     project_version_id        TEXT NOT NULL,
     id                        INTEGER NOT NULL,
     run_id                    TEXT NOT NULL,
     base_generation_id        TEXT NOT NULL,
     base_revision             INTEGER NOT NULL CHECK (base_revision >= 0),
     expected_base_content_hash TEXT,
     entity_kind               TEXT NOT NULL,
     entity_key                TEXT NOT NULL,
     op                        TEXT NOT NULL CHECK (op IN ('create','update','delete','noop','conflict')),
     status                    TEXT NOT NULL CHECK (status IN ('pending','applied','failed','skipped')),
     error                     TEXT,
     created_at                TEXT NOT NULL,
     applied_at                TEXT,
     PRIMARY KEY (project_id, project_version_id, id),
     UNIQUE (project_id, project_version_id, run_id, entity_kind, entity_key),
     FOREIGN KEY (project_id, project_version_id, base_generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_push_log_run ON push_log (project_id, project_version_id, run_id, status, id)`,

  // ── sync engine + review tokens ─────────────────────────────────────
  // Immutable semantic base rows for one pull generation; gitignored machinery.
  `CREATE TABLE base_snapshot (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     entity_kind        TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     entity_key         TEXT NOT NULL,
     remote_id          TEXT,
     payload            TEXT NOT NULL,
     content_hash       TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, entity_kind, generation_id, entity_key),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,

  // Generation-scoped business-key/remote-id cache; never authored identity truth.
  `CREATE TABLE id_map (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     entity_kind        TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     entity_key         TEXT NOT NULL,
     remote_id          TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, entity_kind, generation_id, entity_key),
     UNIQUE (project_id, project_version_id, entity_kind, generation_id, remote_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,

  // Server-owned lifecycle cache, separate from semantic base snapshots/YAML.
  `CREATE TABLE entity_review_state (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     entity_kind        TEXT NOT NULL,
     entity_key         TEXT NOT NULL,
     remote_id          TEXT NOT NULL,
     review_status      TEXT,
     review_version     TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, entity_kind, entity_key),
     UNIQUE (project_id, project_version_id, generation_id, entity_kind, remote_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_entity_review_state_status ON entity_review_state (project_id, project_version_id, generation_id, entity_kind, review_status, entity_key)`,

  // ── findings + local triage projections ────────────────────────────
  // Upstream findings cache; canonical authored VEX decisions live in tracked YAML.
  `CREATE TABLE findings (
     project_id           TEXT NOT NULL,
     project_version_id   TEXT NOT NULL,
     generation_id        TEXT NOT NULL,
     finding_id           TEXT NOT NULL,
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
     PRIMARY KEY (project_id, project_version_id, generation_id, finding_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_findings_page ON findings (project_id, project_version_id, generation_id, severity, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_stable ON findings (project_id, project_version_id, generation_id, stable_key, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_cve ON findings (project_id, project_version_id, generation_id, cve, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_component ON findings (project_id, project_version_id, generation_id, component_name COLLATE NOCASE, component_group COLLATE NOCASE, component_version, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_risk ON findings (project_id, project_version_id, generation_id, risk_score DESC, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_epss ON findings (project_id, project_version_id, generation_id, epss_score DESC, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_kev ON findings (project_id, project_version_id, generation_id, in_kev, in_vc_kev, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_reachability ON findings (project_id, project_version_id, generation_id, reachability_score, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_policy_dataset ON findings (project_id, project_version_id, generation_id, vuln_in_dataset, reachability_score, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_policy_band ON findings (project_id, project_version_id, generation_id, band, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_policy_flags ON findings (project_id, project_version_id, generation_id, violation_count, warning_count, finding_id)`,
  `CREATE INDEX IF NOT EXISTS ix_findings_type ON findings (project_id, project_version_id, generation_id, finding_type, finding_id)`,

  // Rebuildable normalized membership index over findings.cwes JSON.
  `CREATE TABLE finding_cwes (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     finding_id         TEXT NOT NULL,
     cwe                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, finding_id, cwe),
     FOREIGN KEY (project_id, project_version_id, generation_id, finding_id)
       REFERENCES findings(project_id, project_version_id, generation_id, finding_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_finding_cwes_selector ON finding_cwes (project_id, project_version_id, generation_id, cwe, finding_id)`,

  // Cached upstream VEX/audit activity; never authored or replayed as model state.
  `CREATE TABLE finding_activity (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
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
     PRIMARY KEY (project_id, project_version_id, generation_id, finding_id, event_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, finding_id)
       REFERENCES findings(project_id, project_version_id, generation_id, finding_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_finding_activity_stable ON finding_activity (project_id, project_version_id, generation_id, stable_key, event_at DESC, event_id)`,

  // Rebuildable projection of .fs/triage YAML. Never authoritative.
  `CREATE TABLE overlay_index (
     project_id               TEXT NOT NULL,
     project_version_id       TEXT NOT NULL,
     entity_kind              TEXT NOT NULL,
     stable_key               TEXT NOT NULL,
     component_key            TEXT,
     cve                      TEXT,
     file_path                TEXT NOT NULL,
     file_sha256              TEXT NOT NULL,
     vex_status               TEXT,
     vex_response             TEXT,
     vex_justification        TEXT,
     vex_reason               TEXT,
     pin                      TEXT CHECK (pin IS NULL OR pin IN ('exact_version','any_version')),
     provenance_by            TEXT,
     provenance_at            TEXT,
     evidence                 TEXT,
     sync_base                TEXT,
     pushed_at                TEXT,
     local_state              TEXT NOT NULL CHECK (local_state IN ('dirty','pushed','conflict','stale','orphaned','needs_completion')),
     drift_state              TEXT CHECK (drift_state IS NULL OR drift_state IN ('reattached_noop','reapply','stale','orphaned','conflict','needs_completion')),
     match_tier               TEXT CHECK (match_tier IS NULL OR match_tier IN ('purl','nvg','ng')),
     policy_warning_count     INTEGER NOT NULL DEFAULT 0 CHECK (policy_warning_count >= 0),
     policy_violation_count   INTEGER NOT NULL DEFAULT 0 CHECK (policy_violation_count >= 0),
     indexed_at               TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, entity_kind, stable_key)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_overlay_project_state ON overlay_index (project_id, project_version_id, entity_kind, local_state, drift_state, stable_key)`,
  `CREATE INDEX IF NOT EXISTS ix_overlay_policy_flag ON overlay_index (project_id, project_version_id, entity_kind, policy_violation_count, policy_warning_count, stable_key)`,
  `CREATE INDEX IF NOT EXISTS ix_overlay_file ON overlay_index (project_id, project_version_id, file_path, stable_key)`,

  // Durable execution summary for triage/policy/import review; never a finding dump.
  `CREATE TABLE triage_runs (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     run_id             TEXT NOT NULL,
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
     finished_at        TEXT,
     PRIMARY KEY (project_id, project_version_id, run_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_triage_runs_scope ON triage_runs (project_id, project_version_id, created_at DESC, run_id)`,

  // ── SBOM ────────────────────────────────────────────────────────────────
  // Upstream SBOM cache; refresh-only and rebuildable from the selected version.
  `CREATE TABLE sbom_components (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
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
     PRIMARY KEY (project_id, project_version_id, generation_id, component_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_sbom_key ON sbom_components (project_id, project_version_id, generation_id, component_key, component_id)`,
  `CREATE INDEX IF NOT EXISTS ix_sbom_purl ON sbom_components (project_id, project_version_id, generation_id, purl, component_id)`,
  `CREATE INDEX IF NOT EXISTS ix_sbom_name ON sbom_components (project_id, project_version_id, generation_id, name COLLATE NOCASE, component_group COLLATE NOCASE, version, component_id)`,

  // Rebuildable derived rollup over one accepted SBOM/findings generation.
  `CREATE TABLE sbom_vuln_rollup (
     project_id            TEXT NOT NULL,
     project_version_id    TEXT NOT NULL,
     generation_id         TEXT NOT NULL,
     component_key         TEXT NOT NULL,
     critical              INTEGER NOT NULL DEFAULT 0,
     high                  INTEGER NOT NULL DEFAULT 0,
     medium                INTEGER NOT NULL DEFAULT 0,
     low                   INTEGER NOT NULL DEFAULT 0,
     kev_count             INTEGER NOT NULL DEFAULT 0,
     max_epss              REAL,
     reachability_verdict  TEXT NOT NULL,
     computed_at           TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, component_key),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,

  // ── HBOM YAML mirrors ─────────────────────────────────────────────
  // Rebuilt from product-security/hbom/hbom.yaml. The file remains authority.
  `CREATE TABLE hbom_cells (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     part_key           TEXT NOT NULL,
     field              TEXT NOT NULL,
     value              TEXT,
     provenance         TEXT,
     source_ref         TEXT,
     confidence         REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
     asserted_by        TEXT,
     asserted_at        TEXT,
     note               TEXT,
     accepted_by        TEXT,
     accepted_at        TEXT,
     state              TEXT NOT NULL CHECK (state IN ('verified','proposal','conflict','unknown','not_applicable')),
     file_sha256        TEXT NOT NULL,
     indexed_at         TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, part_key, field)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_hbom_review ON hbom_cells (project_id, project_version_id, state, part_key, field)`,

  // Rebuildable candidate review projection over the authoritative HBOM YAML/evidence.
  `CREATE TABLE hbom_candidates (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     candidate_id       TEXT NOT NULL,
     part_key           TEXT NOT NULL,
     field              TEXT NOT NULL,
     value              TEXT,
     provenance         TEXT NOT NULL,
     source_ref         TEXT,
     confidence         REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
     asserted_by        TEXT NOT NULL,
     asserted_at        TEXT NOT NULL,
     status             TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','superseded')),
     indexed_at         TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, candidate_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_hbom_candidates_review ON hbom_candidates (project_id, project_version_id, status, part_key, field, candidate_id)`,
  `CREATE INDEX IF NOT EXISTS ix_hbom_candidates_source ON hbom_candidates (project_id, project_version_id, source_ref, part_key, candidate_id)`,

  // ── product security caches/vocabulary ───────────────────────────────
  // Upstream standard vocabulary cache; never authored locally.
  `CREATE TABLE standards (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     standard_id        TEXT NOT NULL,
     code               TEXT NOT NULL,
     name               TEXT NOT NULL,
     scope              TEXT NOT NULL,
     review_status      TEXT,
     review_version     TEXT NOT NULL DEFAULT '0',
     raw                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, standard_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_standards_code ON standards (project_id, project_version_id, generation_id, code, standard_id)`,

  // Upstream standard clause cache; parent/body remain server-owned.
  `CREATE TABLE standards_clauses (
     project_id          TEXT NOT NULL,
     project_version_id  TEXT NOT NULL,
     generation_id       TEXT NOT NULL,
     standard_id         TEXT NOT NULL,
     clause_id           TEXT NOT NULL,
     clause_code         TEXT NOT NULL,
     section_path        TEXT,
     parent_clause_id    TEXT,
     title               TEXT,
     body                TEXT,
     review_status       TEXT,
     review_version      TEXT NOT NULL DEFAULT '0',
     raw                 TEXT NOT NULL,
     pulled_at           TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, standard_id, clause_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, standard_id)
       REFERENCES standards(project_id, project_version_id, generation_id, standard_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_standard_clauses_path ON standards_clauses (project_id, project_version_id, generation_id, standard_id, section_path, clause_code)`,

  // Server validation vocabulary cache; JSON fields are never hard-coded guesses.
  `CREATE TABLE methodology_profiles (
     project_id          TEXT NOT NULL,
     project_version_id  TEXT NOT NULL,
     generation_id       TEXT NOT NULL,
     profile_id          TEXT NOT NULL,
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
     pulled_at           TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, profile_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_methodology_project ON methodology_profiles (project_id, project_version_id, generation_id, scope, profile_id)`,

  // Cached attack-path body; .fs/attack-paths holds viability decisions.
  `CREATE TABLE attack_paths (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     path_id            TEXT NOT NULL,
     route_signature    TEXT NOT NULL,
     name               TEXT,
     threat_key         TEXT,
     steps              TEXT NOT NULL,
     edges              TEXT,
     total_steps        INTEGER,
     zones_traversed    TEXT,
     exploitability    TEXT,
     review_status      TEXT,
     review_version     TEXT NOT NULL DEFAULT '0',
     raw                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, path_id),
     UNIQUE (project_id, project_version_id, generation_id, route_signature),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_attack_paths_threat ON attack_paths (project_id, project_version_id, generation_id, threat_key, path_id)`,

  // ── verification + bench evidence ───────────────────────────────────
  // Upstream verification-check cache; check definitions remain server-owned.
  `CREATE TABLE verification_checks (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     check_id           TEXT NOT NULL,
     code               TEXT NOT NULL,
     name               TEXT NOT NULL,
     check_type         TEXT NOT NULL,
     category           TEXT,
     description        TEXT,
     pass_criteria      TEXT,
     fail_criteria      TEXT,
     input_description  TEXT,
     parameters         TEXT,
     default_sla_days   INTEGER,
     deleted_at         TEXT,
     review_status      TEXT,
     review_version     TEXT NOT NULL DEFAULT '0',
     raw                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, check_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ix_verification_checks_code ON verification_checks (project_id, project_version_id, generation_id, code)`,

  // Server mapping body; authored requirement decisions remain in YAML/overlay.
  `CREATE TABLE requirement_check_mappings (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     requirement_key    TEXT NOT NULL,
     check_id           TEXT NOT NULL,
     is_required        INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
     coverage_level     TEXT,
     suppressed         INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0,1)),
     raw                TEXT NOT NULL,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, requirement_key, check_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, check_id)
       REFERENCES verification_checks(project_id, project_version_id, generation_id, check_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_req_check_check ON requirement_check_mappings (project_id, project_version_id, generation_id, check_id, requirement_key)`,

  // Server-derived requirement status; never authored or written back from here.
  `CREATE TABLE requirement_rollup (
     project_id             TEXT NOT NULL,
     project_version_id     TEXT NOT NULL,
     generation_id          TEXT NOT NULL,
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
     PRIMARY KEY (project_id, project_version_id, generation_id, requirement_key),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,

  // Unified verification/bench run cache and action journal; never authored intent.
  `CREATE TABLE verification_runs (
     project_id       TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id    TEXT NOT NULL,
     run_id           TEXT NOT NULL,
     tier             TEXT NOT NULL CHECK (tier IN ('tier0','tier1','tier2','tier3','tier4')),
     matrix_col       TEXT NOT NULL CHECK (matrix_col IN ('static','emulation','hil','manual')),
     kind             TEXT NOT NULL,
     trigger          TEXT,
     host_id          TEXT,
     thread_id        TEXT,
     target           TEXT,
     config           TEXT,
     status           TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','timeout')),
     started_at       TEXT,
     finished_at      TEXT,
     duration_ms      INTEGER,
     firmware_digest  TEXT,
     job_id           TEXT,
     log_locator      TEXT,
     log_cursor       TEXT,
     raw              TEXT NOT NULL,
     synced_at        TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, run_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_recent ON verification_runs (project_id, project_version_id, generation_id, started_at DESC, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_host ON verification_runs (project_id, project_version_id, generation_id, host_id, thread_id, status, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_job ON verification_runs (project_id, project_version_id, generation_id, job_id, run_id)`,

  // Latest + history evidence cache; raw retains richer upstream statuses.
  `CREATE TABLE verification_results (
     project_id               TEXT NOT NULL,
     project_version_id       TEXT NOT NULL,
     generation_id            TEXT NOT NULL,
     result_id                TEXT NOT NULL,
     run_id                   TEXT,
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
     pulled_at                TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, result_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, run_id)
       REFERENCES verification_runs(project_id, project_version_id, generation_id, run_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, check_id)
       REFERENCES verification_checks(project_id, project_version_id, generation_id, check_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_matrix ON verification_results (project_id, project_version_id, generation_id, requirement_key, tier, is_latest, executed_at DESC, result_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_check ON verification_results (project_id, project_version_id, generation_id, check_id, is_latest, executed_at DESC, result_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_run ON verification_results (project_id, project_version_id, generation_id, run_id, result_id)`,

  // Rebuildable artifact locator cache; artifact bytes remain external evidence.
  `CREATE TABLE verification_artifacts (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id      TEXT NOT NULL,
     artifact_id        TEXT NOT NULL,
     run_id             TEXT NOT NULL,
     result_id          TEXT,
     name               TEXT NOT NULL,
     kind               TEXT NOT NULL,
     locator            TEXT NOT NULL,
     media_type         TEXT,
     sha256             TEXT,
     bytes              INTEGER,
     created_at         TEXT,
     pulled_at          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, artifact_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, run_id)
       REFERENCES verification_runs(project_id, project_version_id, generation_id, run_id) ON DELETE CASCADE,
     FOREIGN KEY (project_id, project_version_id, generation_id, result_id)
       REFERENCES verification_results(project_id, project_version_id, generation_id, result_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_verification_artifacts_run ON verification_artifacts (project_id, project_version_id, generation_id, run_id, kind, artifact_id)`,

  // Verification evidence cache; verified is local output, never an upstream boolean.
  `CREATE TABLE attestations (
     project_id          TEXT NOT NULL,
     project_version_id  TEXT NOT NULL,
     generation_id       TEXT NOT NULL,
     attestation_id      TEXT NOT NULL,
     run_id              TEXT NOT NULL,
     format              TEXT NOT NULL,
     predicate_type      TEXT,
     subject_digest      TEXT NOT NULL,
     evidence_digest     TEXT,
     verdict             TEXT,
     requirement_ids     TEXT,
     check_ids           TEXT,
     result_refs         TEXT,
     signer_identity     TEXT,
     rekor_uuid          TEXT,
     envelope_locator    TEXT,
     payload             TEXT NOT NULL,
     signature_verified  INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0,1)),
     subject_matches_run INTEGER NOT NULL DEFAULT 0 CHECK (subject_matches_run IN (0,1)),
     verified            INTEGER NOT NULL DEFAULT 0
                           CHECK (verified IN (0,1)
                             AND (verified = 0 OR (signature_verified = 1 AND subject_matches_run = 1))),
     created_at          TEXT NOT NULL,
     pulled_at           TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, attestation_id),
     UNIQUE (project_id, project_version_id, generation_id, run_id, attestation_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, run_id)
       REFERENCES verification_runs(project_id, project_version_id, generation_id, run_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_attestations_run ON attestations (project_id, project_version_id, generation_id, run_id, verified, attestation_id)`,
  `CREATE INDEX IF NOT EXISTS ix_attestations_subject ON attestations (project_id, project_version_id, generation_id, subject_digest, verified, attestation_id)`,

  // ── firmware mount registry only; manifest.sqlite belongs to WP-47 ──────────────
  // Materialization registry/cache only; never firmware manifest or file authority.
  `CREATE TABLE firmware_mounts (
     project_id          TEXT NOT NULL,
     project_version_id  TEXT NOT NULL,
     generation_id       TEXT NOT NULL,
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
     pulled_at           TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_firmware_mounts_state ON firmware_mounts (project_id, project_version_id, generation_id, state)`,

  // ── one plugin-local, project/version-scoped document ledger ───────────────────────
  // Rebuildable ledger over tracked document files; bytes/files remain authority.
  `CREATE TABLE document (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     document_id        TEXT NOT NULL,
     sha256             TEXT NOT NULL,
     name               TEXT NOT NULL,
     path               TEXT NOT NULL,
     doc_kind           TEXT NOT NULL CHECK (doc_kind IN ('datasheet','bom','schematic','spec','regulatory','register_map','other')),
     mime_type          TEXT NOT NULL,
     bytes              INTEGER NOT NULL,
     withdrawn          INTEGER NOT NULL DEFAULT 0 CHECK (withdrawn IN (0,1)),
     needs_ocr          INTEGER NOT NULL DEFAULT 0 CHECK (needs_ocr IN (0,1)),
     uploaded_at        TEXT NOT NULL,
     analyzed_by        TEXT,
     analyzed_at        TEXT,
     cells_extracted    INTEGER NOT NULL DEFAULT 0,
     indexed_at         TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, document_id),
     UNIQUE (project_id, project_version_id, sha256)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_document_list ON document (project_id, project_version_id, doc_kind, withdrawn, uploaded_at DESC, document_id)`,

  // Rebuildable extraction/source-reference projection; tracked files remain authority.
  `CREATE TABLE document_extraction (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     extraction_id      TEXT NOT NULL,
     document_id        TEXT NOT NULL,
     field              TEXT NOT NULL,
     value              TEXT,
     confidence         REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
     source_ref         TEXT NOT NULL,
     locator_kind       TEXT NOT NULL CHECK (locator_kind IN ('pdf','sheet','text')),
     page               INTEGER,
     bbox               TEXT,
     sheet              TEXT,
     cell               TEXT,
     line_start         INTEGER,
     line_end           INTEGER,
     target_surface     TEXT,
     target_id          TEXT,
     target_field       TEXT,
     status             TEXT NOT NULL CHECK (status IN ('proposal','accepted','rejected','withdrawn')),
     extracted_by       TEXT,
     extracted_at       TEXT NOT NULL,
     raw                TEXT,
     PRIMARY KEY (project_id, project_version_id, extraction_id),
     FOREIGN KEY (project_id, project_version_id, document_id)
       REFERENCES document(project_id, project_version_id, document_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_document_extraction_source ON document_extraction (project_id, project_version_id, document_id, locator_kind, page, sheet, cell, line_start, extraction_id)`,
  `CREATE INDEX IF NOT EXISTS ix_document_extraction_target ON document_extraction (project_id, project_version_id, target_surface, target_id, target_field, status, extraction_id)`,
  `CREATE INDEX IF NOT EXISTS ix_document_extraction_search ON document_extraction (project_id, project_version_id, field COLLATE NOCASE, value COLLATE NOCASE, status, document_id, extraction_id)`,

  `CREATE VIEW IF NOT EXISTS hbom_docs AS
     SELECT project_id, project_version_id, document_id, sha256, name, path,
            doc_kind, mime_type, bytes, withdrawn, needs_ocr, uploaded_at,
            analyzed_by, analyzed_at, cells_extracted, indexed_at
       FROM document
      WHERE doc_kind IN ('datasheet','bom','schematic')`,

  // ── AMD-0010: hardware and grounding caches ──────────────────────────────
  `CREATE TABLE hw_project (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     name               TEXT NOT NULL,
     sch_path           TEXT NOT NULL,
     pcb_path           TEXT,
     sch_hash           TEXT NOT NULL,
     pcb_hash           TEXT,
     kicad_version      TEXT,
     discovered_at      TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, project_key)
   )`,
  `CREATE TABLE hw_artifact (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     kind               TEXT NOT NULL CHECK (kind IN ('sheet_svg','board_svg','glb','bom','netlist','gerber','drill','drc','erc')),
     sheet_path         TEXT,
     path               TEXT NOT NULL,
     source_hash        TEXT NOT NULL,
     cli_version        TEXT,
     generated_at       TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, project_key, kind, sheet_path),
     FOREIGN KEY (project_id, project_version_id, project_key)
       REFERENCES hw_project(project_id, project_version_id, project_key) ON DELETE CASCADE
   )`,
  `CREATE TABLE hw_symbol (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     sheet_path         TEXT NOT NULL,
     reference          TEXT NOT NULL,
     value              TEXT,
     footprint          TEXT,
     mpn                TEXT,
     manufacturer       TEXT,
     at_x               REAL NOT NULL,
     at_y               REAL NOT NULL,
     angle              REAL,
     unit               INTEGER,
     fields             TEXT,
     PRIMARY KEY (project_id, project_version_id, project_key, sheet_path, reference, unit),
     FOREIGN KEY (project_id, project_version_id, project_key)
       REFERENCES hw_project(project_id, project_version_id, project_key) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_hw_symbol_ref ON hw_symbol (project_id, project_version_id, reference, project_key, sheet_path, unit)`,
  `CREATE INDEX IF NOT EXISTS ix_hw_symbol_mpn ON hw_symbol (project_id, project_version_id, mpn, project_key, sheet_path, reference, unit)`,
  `CREATE TABLE hw_net (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     net_name           TEXT NOT NULL,
     nodes              TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, project_key, net_name),
     FOREIGN KEY (project_id, project_version_id, project_key)
       REFERENCES hw_project(project_id, project_version_id, project_key) ON DELETE CASCADE
   )`,
  `CREATE TABLE hw_violation (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     id                 INTEGER NOT NULL,
     project_key        TEXT NOT NULL,
     kind               TEXT NOT NULL CHECK (kind IN ('drc','erc')),
     severity           TEXT NOT NULL CHECK (severity IN ('error','warning','exclusion')),
     rule               TEXT NOT NULL,
     description        TEXT,
     refs               TEXT,
     at_x               REAL,
     at_y               REAL,
     run_at             TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, id),
     FOREIGN KEY (project_id, project_version_id, project_key)
       REFERENCES hw_project(project_id, project_version_id, project_key) ON DELETE CASCADE
   )`,
  `CREATE TABLE ground_source (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     source_id          TEXT NOT NULL,
     project_key        TEXT,
     kind               TEXT NOT NULL CHECK (kind IN ('reference_manual','datasheet','svd','errata','appnote','sdk','re_corpus')),
     part               TEXT,
     title              TEXT,
     path               TEXT NOT NULL,
     pages              INTEGER,
     indexed_at         TEXT,
     status             TEXT NOT NULL CHECK (status IN ('pending','indexing','ready','failed')),
     license            TEXT,
     redistributable    INTEGER NOT NULL DEFAULT 0 CHECK (redistributable IN (0,1)),
     PRIMARY KEY (project_id, project_version_id, source_id)
   )`,
  `CREATE TABLE ground_chunk (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     chunk_id           TEXT NOT NULL,
     source_id          TEXT NOT NULL,
     page               INTEGER,
     kind               TEXT NOT NULL CHECK (kind IN ('prose','register_table','pin_table','timing','figure')),
     anchor             TEXT,
     text               TEXT NOT NULL,
     embedding          BLOB,
     PRIMARY KEY (project_id, project_version_id, chunk_id),
     FOREIGN KEY (project_id, project_version_id, source_id)
       REFERENCES ground_source(project_id, project_version_id, source_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_chunk_source ON ground_chunk (project_id, project_version_id, source_id, kind, chunk_id)`,
  `CREATE TABLE bench_device (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     device_id          TEXT NOT NULL,
     kind               TEXT NOT NULL CHECK (kind IN ('probe','logic','power','scope','serial')),
     make               TEXT,
     model              TEXT,
     connection         TEXT,
     transport          TEXT NOT NULL CHECK (transport IN ('local-usb','local-net','bb-host')),
     claimed_by         TEXT,
     claimed_at         TEXT,
     claim_scope        TEXT NOT NULL CHECK (claim_scope IN ('machine','fleet')),
     last_seen          TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, device_id)
   )`,
  `CREATE TABLE probe_run (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     run_id             TEXT NOT NULL,
     script_path        TEXT NOT NULL,
     devices            TEXT NOT NULL,
     hypothesis         TEXT,
     outcome            TEXT CHECK (outcome IS NULL OR outcome IN ('confirmed','refuted','inconclusive')),
     artifacts          TEXT,
     started_at         TEXT NOT NULL,
     finished_at        TEXT,
     PRIMARY KEY (project_id, project_version_id, run_id)
   )`,
  `CREATE TABLE build_run (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     run_id             TEXT NOT NULL,
     kind               TEXT NOT NULL CHECK (kind IN ('build','flash')),
     target             TEXT,
     toolchain          TEXT,
     status             TEXT NOT NULL,
     artifact           TEXT,
     digest             TEXT,
     log_path           TEXT,
     started_at         TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, run_id)
   )`,

  // The following statements are intentionally positional and transactional.
  // Deferral preserves artifact/attestation FKs while their parent tables swap.
  `PRAGMA defer_foreign_keys = ON`,
  `CREATE TEMP TABLE verification_artifacts_amd0010_backup AS SELECT * FROM verification_artifacts`,
  `CREATE TEMP TABLE attestations_amd0010_backup AS SELECT * FROM attestations`,
  `CREATE TABLE verification_runs_v2 (
     project_id       TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     generation_id    TEXT NOT NULL,
     run_id           TEXT NOT NULL,
     tier             TEXT NOT NULL CHECK (tier IN ('tier0','tier1','tier2','tier3','tier4')),
     matrix_col       TEXT NOT NULL CHECK (matrix_col IN ('static','emulation','hil','manual','hardware')),
     kind             TEXT NOT NULL,
     trigger          TEXT,
     host_id          TEXT,
     thread_id        TEXT,
     target           TEXT,
     config           TEXT,
     status           TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','timeout')),
     started_at       TEXT,
     finished_at      TEXT,
     duration_ms      INTEGER,
     firmware_digest  TEXT,
     job_id           TEXT,
     log_locator      TEXT,
     log_cursor       TEXT,
     raw              TEXT NOT NULL,
     synced_at        TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, run_id),
     FOREIGN KEY (project_id, project_version_id, generation_id)
       REFERENCES pull_generation(project_id, project_version_id, generation_id) ON DELETE CASCADE
   )`,
  `INSERT INTO verification_runs_v2 SELECT * FROM verification_runs`,
  `CREATE TABLE verification_results_v2 (
     project_id               TEXT NOT NULL,
     project_version_id       TEXT NOT NULL,
     generation_id            TEXT NOT NULL,
     result_id                TEXT NOT NULL,
     run_id                   TEXT,
     requirement_key          TEXT,
     check_id                 TEXT,
     tier                     TEXT NOT NULL CHECK (tier IN ('static','emulation','hil','manual','hardware')),
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
     pulled_at                TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, generation_id, result_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, run_id)
       REFERENCES verification_runs(project_id, project_version_id, generation_id, run_id),
     FOREIGN KEY (project_id, project_version_id, generation_id, check_id)
       REFERENCES verification_checks(project_id, project_version_id, generation_id, check_id)
   )`,
  `INSERT INTO verification_results_v2 SELECT * FROM verification_results`,
  `DROP TABLE verification_runs`,
  `DROP TABLE verification_results`,
  `ALTER TABLE verification_runs_v2 RENAME TO verification_runs`,
  `ALTER TABLE verification_results_v2 RENAME TO verification_results`,
  `INSERT OR IGNORE INTO verification_artifacts SELECT * FROM verification_artifacts_amd0010_backup`,
  `INSERT OR IGNORE INTO attestations SELECT * FROM attestations_amd0010_backup`,
  `DROP TABLE verification_artifacts_amd0010_backup`,
  `DROP TABLE attestations_amd0010_backup`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_recent ON verification_runs (project_id, project_version_id, generation_id, started_at DESC, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_host ON verification_runs (project_id, project_version_id, generation_id, host_id, thread_id, status, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_runs_job ON verification_runs (project_id, project_version_id, generation_id, job_id, run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_matrix ON verification_results (project_id, project_version_id, generation_id, requirement_key, tier, is_latest, executed_at DESC, result_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_check ON verification_results (project_id, project_version_id, generation_id, check_id, is_latest, executed_at DESC, result_id)`,
  `CREATE INDEX IF NOT EXISTS ix_verification_results_run ON verification_results (project_id, project_version_id, generation_id, run_id, result_id)`,
  `PRAGMA defer_foreign_keys = OFF`,

  // AMD-0017: discovered KiCad project compatibility
  `ALTER TABLE hw_project ADD COLUMN supported INTEGER NOT NULL DEFAULT 0 CHECK (supported IN (0,1))`,
  `UPDATE hw_project
    SET supported = CASE
      WHEN kicad_version IS NULL THEN 0
      WHEN length(kicad_version) = 8 AND kicad_version NOT LIKE '%.%'
        THEN CASE WHEN CAST(substr(kicad_version, 1, 4) AS INTEGER) >= 2021 THEN 1 ELSE 0 END
      WHEN CAST(kicad_version AS INTEGER) >= 6 THEN 1
      ELSE 0
    END`,

  // AMD-0018: bounded hardware semantic sheet cache and ingest ledger
  `CREATE TABLE hw_sheet (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     sheet_path         TEXT NOT NULL,
     name               TEXT NOT NULL,
     parent_sheet_path  TEXT,
     page_order         INTEGER NOT NULL CHECK (page_order >= 0),
     width_mm           REAL CHECK (width_mm IS NULL OR width_mm > 0),
     height_mm          REAL CHECK (height_mm IS NULL OR height_mm > 0),
     PRIMARY KEY (project_id, project_version_id, project_key, sheet_path),
     FOREIGN KEY (project_id, project_version_id, project_key)
       REFERENCES hw_project(project_id, project_version_id, project_key) ON DELETE CASCADE
   )`,
  `CREATE TABLE hw_ingest (
     project_id         TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     project_key        TEXT NOT NULL,
     source_hash        TEXT NOT NULL CHECK (length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
     ingested_at        TEXT NOT NULL,
     symbol_refs        TEXT NOT NULL CHECK (json_valid(symbol_refs) AND json_type(symbol_refs) = 'array'),
     connectivity_gaps  TEXT NOT NULL CHECK (json_valid(connectivity_gaps) AND json_type(connectivity_gaps) = 'array'),
     PRIMARY KEY (project_id, project_version_id, project_key, source_hash),
     FOREIGN KEY (project_id, project_version_id, project_key)
       REFERENCES hw_project(project_id, project_version_id, project_key) ON DELETE CASCADE
   )`,

  // AMD-0020: bind bb workspace projects to Platform projects without
  // conflating their identifier spaces.
  `CREATE TABLE workspace_platform_project_binding (
     workspace_project_id TEXT NOT NULL,
     platform_project_id  TEXT NOT NULL,
     PRIMARY KEY (workspace_project_id, platform_project_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_workspace_platform_project_binding_platform
     ON workspace_platform_project_binding (platform_project_id, workspace_project_id)`,

  // AMD-0021: retain finding quarantine accounting across resumed pull
  // invocations in the generation-owned staging checkpoint.
  `ALTER TABLE sync_state ADD COLUMN staged_quarantined INTEGER NOT NULL DEFAULT 0 CHECK (staged_quarantined >= 0)`,

  // AMD-0022: record the operator-selected AS sibling beside the existing
  // bb-to-Platform binding. Existing rows remain explicitly unselected.
  `ALTER TABLE workspace_platform_project_binding ADD COLUMN assurance_studio_project_id TEXT CHECK (assurance_studio_project_id IS NULL OR length(assurance_studio_project_id) > 0)`,
];
