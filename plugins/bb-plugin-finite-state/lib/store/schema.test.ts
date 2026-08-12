import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import type {
  AttackPathRow,
  AttestationRow,
  BaseSnapshotRow,
  DocumentExtractionRow,
  DocumentRow,
  EntityReviewStateRow,
  FindingActivityRow,
  FindingCweRow,
  FindingRow,
  FirmwareMountRow,
  HbomCandidateRow,
  HbomCellRow,
  HbomDocRow,
  IdMapRow,
  MethodologyProfileRow,
  OverlayIndexRow,
  PushLogRow,
  RequirementCheckMappingRow,
  RequirementRollupRow,
  SbomComponentRow,
  SbomVulnRollupRow,
  StandardRow,
  StandardsClauseRow,
  SyncStateRow,
  TriageRunRow,
  VerificationArtifactRow,
  VerificationCheckRow,
  VerificationResultRow,
  VerificationRunRow,
} from "./index.js";
import {
  CACHE_STORAGE_NAMES,
  MIGRATIONS,
  SCHEMA_VERSION,
} from "./schema.js";

const TABLE_NAMES = [
  "attack_paths",
  "attestations",
  "base_snapshot",
  "document",
  "document_extraction",
  "entity_review_state",
  "finding_activity",
  "finding_cwes",
  "findings",
  "firmware_mounts",
  "hbom_candidates",
  "hbom_cells",
  "id_map",
  "methodology_profiles",
  "overlay_index",
  "push_log",
  "requirement_check_mappings",
  "requirement_rollup",
  "sbom_components",
  "sbom_vuln_rollup",
  "standards",
  "standards_clauses",
  "sync_state",
  "triage_runs",
  "verification_artifacts",
  "verification_checks",
  "verification_results",
  "verification_runs",
] as const;

const VIEW_NAMES = ["hbom_docs"] as const;

const INDEX_NAMES = [
  "ix_attack_paths_threat",
  "ix_attestations_run",
  "ix_attestations_subject",
  "ix_document_extraction_search",
  "ix_document_extraction_source",
  "ix_document_extraction_target",
  "ix_document_list",
  "ix_entity_review_state_status",
  "ix_finding_activity_stable",
  "ix_finding_cwes_selector",
  "ix_findings_component",
  "ix_findings_cve",
  "ix_findings_epss",
  "ix_findings_kev",
  "ix_findings_page",
  "ix_findings_policy_band",
  "ix_findings_policy_dataset",
  "ix_findings_policy_flags",
  "ix_findings_reachability",
  "ix_findings_risk",
  "ix_findings_stable",
  "ix_findings_type",
  "ix_firmware_mounts_state",
  "ix_hbom_candidates_review",
  "ix_hbom_candidates_source",
  "ix_hbom_review",
  "ix_methodology_project",
  "ix_overlay_file",
  "ix_overlay_policy_flag",
  "ix_overlay_project_state",
  "ix_push_log_run",
  "ix_req_check_check",
  "ix_sbom_key",
  "ix_sbom_name",
  "ix_sbom_purl",
  "ix_standard_clauses_path",
  "ix_standards_code",
  "ix_triage_runs_scope",
  "ix_verification_artifacts_run",
  "ix_verification_checks_code",
  "ix_verification_results_check",
  "ix_verification_results_matrix",
  "ix_verification_results_run",
  "ix_verification_runs_host",
  "ix_verification_runs_job",
  "ix_verification_runs_recent",
] as const;

function defineColumns<Row>() {
  return <const Names extends readonly (keyof Row & string)[]>(
    names: keyof Row extends Names[number] ? Names : never,
  ): Names => names;
}

const ROW_COLUMNS = {
  sync_state: defineColumns<SyncStateRow>()([
    "entity_kind",
    "scope",
    "last_pull",
    "cursor",
    "error",
  ]),
  push_log: defineColumns<PushLogRow>()([
    "id",
    "run_id",
    "entity_kind",
    "entity_key",
    "op",
    "status",
    "error",
    "applied_at",
  ]),
  base_snapshot: defineColumns<BaseSnapshotRow>()([
    "entity_kind",
    "entity_key",
    "remote_id",
    "payload",
    "content_hash",
    "pulled_at",
  ]),
  id_map: defineColumns<IdMapRow>()([
    "entity_kind",
    "entity_key",
    "remote_id",
  ]),
  entity_review_state: defineColumns<EntityReviewStateRow>()([
    "project_id",
    "entity_kind",
    "entity_key",
    "remote_id",
    "review_status",
    "review_version",
    "pulled_at",
  ]),
  findings: defineColumns<FindingRow>()([
    "finding_id",
    "project_id",
    "project_version_id",
    "stable_key",
    "finding_type",
    "cve",
    "title",
    "component_name",
    "component_group",
    "component_version",
    "component_purl",
    "severity",
    "risk_score",
    "band",
    "cvss_score",
    "cvss_vector",
    "epss_score",
    "epss_percentile",
    "in_kev",
    "in_vc_kev",
    "has_exploit",
    "exploit_maturity",
    "reachability_score",
    "reachability_verdict",
    "reachability_factors",
    "vuln_in_dataset",
    "cwes",
    "warning_count",
    "violation_count",
    "location",
    "vex_status",
    "vex_response",
    "vex_justification",
    "vex_reason",
    "comments",
    "first_seen",
    "soft_deleted",
    "raw",
    "pulled_at",
  ]),
  finding_cwes: defineColumns<FindingCweRow>()([
    "project_version_id",
    "finding_id",
    "cwe",
    "pulled_at",
  ]),
  finding_activity: defineColumns<FindingActivityRow>()([
    "project_version_id",
    "finding_id",
    "event_id",
    "stable_key",
    "actor",
    "event_at",
    "source",
    "old_tuple",
    "new_tuple",
    "raw",
    "pulled_at",
  ]),
  overlay_index: defineColumns<OverlayIndexRow>()([
    "entity_kind",
    "project_key",
    "stable_key",
    "component_key",
    "cve",
    "file_path",
    "file_sha256",
    "vex_status",
    "vex_response",
    "vex_justification",
    "vex_reason",
    "pin",
    "provenance_by",
    "provenance_at",
    "evidence",
    "sync_base",
    "pushed_at",
    "local_state",
    "drift_state",
    "match_tier",
    "policy_warning_count",
    "policy_violation_count",
    "indexed_at",
  ]),
  triage_runs: defineColumns<TriageRunRow>()([
    "run_id",
    "project_id",
    "project_version_id",
    "source",
    "dry_run",
    "status",
    "input_digest",
    "written",
    "held",
    "conflicts",
    "skipped_existing",
    "errors",
    "report_json",
    "created_at",
    "finished_at",
  ]),
  sbom_components: defineColumns<SbomComponentRow>()([
    "project_version_id",
    "project_id",
    "component_id",
    "component_key",
    "purl",
    "name",
    "component_group",
    "version",
    "cpe",
    "license",
    "supplier",
    "source",
    "file_locations",
    "is_stale",
    "raw",
    "pulled_at",
  ]),
  sbom_vuln_rollup: defineColumns<SbomVulnRollupRow>()([
    "project_version_id",
    "component_key",
    "critical",
    "high",
    "medium",
    "low",
    "kev_count",
    "max_epss",
    "reachability_verdict",
    "computed_at",
  ]),
  hbom_cells: defineColumns<HbomCellRow>()([
    "project_key",
    "part_key",
    "field",
    "value",
    "provenance",
    "source_ref",
    "confidence",
    "asserted_by",
    "asserted_at",
    "note",
    "accepted_by",
    "accepted_at",
    "state",
    "file_sha256",
    "indexed_at",
  ]),
  hbom_candidates: defineColumns<HbomCandidateRow>()([
    "candidate_id",
    "project_key",
    "part_key",
    "field",
    "value",
    "provenance",
    "source_ref",
    "confidence",
    "asserted_by",
    "asserted_at",
    "status",
    "indexed_at",
  ]),
  standards: defineColumns<StandardRow>()([
    "standard_id",
    "code",
    "name",
    "scope",
    "review_status",
    "review_version",
    "raw",
    "pulled_at",
  ]),
  standards_clauses: defineColumns<StandardsClauseRow>()([
    "standard_id",
    "clause_id",
    "clause_code",
    "section_path",
    "parent_clause_id",
    "title",
    "body",
    "review_status",
    "review_version",
    "raw",
    "pulled_at",
  ]),
  methodology_profiles: defineColumns<MethodologyProfileRow>()([
    "profile_id",
    "project_id",
    "organization_id",
    "scope",
    "name",
    "asset_properties",
    "impact_dimensions",
    "risk_scale",
    "assurance_levels",
    "ownership_labels",
    "stride_map",
    "review_version",
    "raw",
    "pulled_at",
  ]),
  attack_paths: defineColumns<AttackPathRow>()([
    "project_id",
    "path_id",
    "route_signature",
    "name",
    "threat_key",
    "steps",
    "edges",
    "total_steps",
    "zones_traversed",
    "exploitability",
    "review_status",
    "review_version",
    "raw",
    "pulled_at",
  ]),
  verification_checks: defineColumns<VerificationCheckRow>()([
    "check_id",
    "project_id",
    "code",
    "name",
    "check_type",
    "category",
    "description",
    "pass_criteria",
    "fail_criteria",
    "input_description",
    "parameters",
    "default_sla_days",
    "deleted_at",
    "review_status",
    "review_version",
    "raw",
    "pulled_at",
  ]),
  requirement_check_mappings: defineColumns<RequirementCheckMappingRow>()([
    "project_id",
    "requirement_key",
    "check_id",
    "is_required",
    "coverage_level",
    "suppressed",
    "raw",
    "pulled_at",
  ]),
  requirement_rollup: defineColumns<RequirementRollupRow>()([
    "project_id",
    "requirement_key",
    "verification_status",
    "total_checks",
    "verified_checks",
    "failed_checks",
    "error_checks",
    "inconclusive_checks",
    "running_checks",
    "pending_checks",
    "skipped_checks",
    "last_run_at",
    "pulled_at",
  ]),
  verification_runs: defineColumns<VerificationRunRow>()([
    "run_id",
    "project_id",
    "pv_id",
    "tier",
    "matrix_col",
    "kind",
    "trigger",
    "host_id",
    "thread_id",
    "target",
    "config",
    "status",
    "started_at",
    "finished_at",
    "duration_ms",
    "firmware_digest",
    "job_id",
    "log_locator",
    "log_cursor",
    "raw",
    "synced_at",
  ]),
  verification_results: defineColumns<VerificationResultRow>()([
    "result_id",
    "run_id",
    "project_id",
    "pv_id",
    "requirement_key",
    "check_id",
    "tier",
    "status",
    "outcome",
    "confidence",
    "evidence_summary",
    "result_data",
    "measured",
    "executed_at",
    "executed_by",
    "failure_reason",
    "remediation_suggestion",
    "fs_version_id",
    "fs_version_name",
    "is_latest",
    "superseded_by",
    "sla_status",
    "mapping_state",
    "raw",
    "pulled_at",
  ]),
  verification_artifacts: defineColumns<VerificationArtifactRow>()([
    "artifact_id",
    "run_id",
    "result_id",
    "name",
    "kind",
    "locator",
    "media_type",
    "sha256",
    "bytes",
    "created_at",
    "pulled_at",
  ]),
  attestations: defineColumns<AttestationRow>()([
    "attestation_id",
    "run_id",
    "format",
    "predicate_type",
    "subject_digest",
    "evidence_digest",
    "verdict",
    "requirement_ids",
    "check_ids",
    "result_refs",
    "signer_identity",
    "rekor_uuid",
    "envelope_locator",
    "payload",
    "signature_verified",
    "subject_matches_run",
    "verified",
    "created_at",
    "pulled_at",
  ]),
  firmware_mounts: defineColumns<FirmwareMountRow>()([
    "pv_id",
    "project_id",
    "source",
    "state",
    "scan_id",
    "input_sha256",
    "artifact_hash",
    "root_path",
    "file_count",
    "materialized_files",
    "error_count",
    "admin_bytes_ok",
    "message",
    "materialized_at",
    "pulled_at",
  ]),
  document: defineColumns<DocumentRow>()([
    "document_id",
    "project_key",
    "sha256",
    "name",
    "path",
    "doc_kind",
    "mime_type",
    "bytes",
    "withdrawn",
    "needs_ocr",
    "uploaded_at",
    "analyzed_by",
    "analyzed_at",
    "cells_extracted",
    "indexed_at",
  ]),
  document_extraction: defineColumns<DocumentExtractionRow>()([
    "extraction_id",
    "document_id",
    "field",
    "value",
    "confidence",
    "source_ref",
    "locator_kind",
    "page",
    "bbox",
    "sheet",
    "cell",
    "line_start",
    "line_end",
    "target_surface",
    "target_id",
    "target_field",
    "status",
    "extracted_by",
    "extracted_at",
    "raw",
  ]),
  hbom_docs: defineColumns<HbomDocRow>()([
    "document_id",
    "project_key",
    "sha256",
    "name",
    "path",
    "doc_kind",
    "mime_type",
    "bytes",
    "withdrawn",
    "needs_ocr",
    "uploaded_at",
    "analyzed_by",
    "analyzed_at",
    "cells_extracted",
    "indexed_at",
  ]),
} as const;

interface SqliteObjectRow {
  name: string;
  type: "index" | "table" | "view";
}

interface PragmaColumnRow {
  name: string;
}

interface QueryPlanRow {
  detail: string;
}

const openDatabases: Database.Database[] = [];

function migratedDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) db.exec(migration);
  openDatabases.push(db);
  return db;
}

function plan(db: Database.Database, sql: string, ...params: unknown[]): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => (row as QueryPlanRow).detail)
    .join("\n");
}

function expectConstraint(fn: () => unknown): void {
  expect(fn).toThrow(/constraint failed/i);
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close();
});

describe("shared store schema freeze", () => {
  it("applies every migration once and a repeated migration is a no-op", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-schema" });
    const db = host.bb.storage.database();

    host.bb.storage.migrate(db, MIGRATIONS);
    const firstCount = db
      .prepare("SELECT count(*) FROM _bb_migrations")
      .pluck()
      .get();
    host.bb.storage.migrate(db, MIGRATIONS);
    const secondCount = db
      .prepare("SELECT count(*) FROM _bb_migrations")
      .pluck()
      .get();

    expect(SCHEMA_VERSION).toBe(1);
    expect(firstCount).toBe(MIGRATIONS.length);
    expect(secondCount).toBe(firstCount);
    await host.harness.lifecycle.dispose();
  });

  it("contains exactly 28 tables, one filtered view, and the frozen cache registry", () => {
    const db = migratedDatabase();
    const objects = db
      .prepare(
        `SELECT type, name
           FROM sqlite_schema
          WHERE name NOT LIKE 'sqlite_%'
            AND type IN ('table','view')
          ORDER BY type, name`,
      )
      .all() as SqliteObjectRow[];

    expect(objects.filter((row) => row.type === "table").map((row) => row.name)).toEqual(
      TABLE_NAMES,
    );
    expect(objects.filter((row) => row.type === "view").map((row) => row.name)).toEqual(
      VIEW_NAMES,
    );
    expect(CACHE_STORAGE_NAMES).toEqual([
      "findings",
      "sbom_components",
      "standards_clauses",
      "attack_paths",
      "verification_runs",
      "verification_results",
      "firmware_mounts",
      "document",
      "hbom_docs",
    ]);
    for (const storageName of CACHE_STORAGE_NAMES) {
      const object = objects.find((row) => row.name === storageName);
      expect(object?.type).toBe(storageName === "hbom_docs" ? "view" : "table");
    }

    db.prepare(
      `INSERT INTO document
         (document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
          uploaded_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "doc-data",
      "project-a",
      "sha-data",
      "datasheet.pdf",
      "product-security/documents/sha-data-datasheet.pdf",
      "datasheet",
      "application/pdf",
      12,
      "2026-08-12T00:00:00Z",
      "2026-08-12T00:00:00Z",
    );
    db.prepare(
      `INSERT INTO document
         (document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
          uploaded_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "doc-spec",
      "project-a",
      "sha-spec",
      "spec.pdf",
      "product-security/documents/sha-spec-spec.pdf",
      "spec",
      "application/pdf",
      13,
      "2026-08-12T00:00:00Z",
      "2026-08-12T00:00:00Z",
    );
    expect(db.prepare("SELECT document_id FROM hbom_docs").pluck().all()).toEqual([
      "doc-data",
    ]);
  });

  it("exports a complete snake_case row contract for every table and view", () => {
    const db = migratedDatabase();
    for (const [name, expectedColumns] of Object.entries(ROW_COLUMNS)) {
      const actualColumns = db
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((row) => (row as PragmaColumnRow).name);
      expect(actualColumns, name).toEqual(expectedColumns);
    }
  });

  it("creates only the frozen named access-path indices", () => {
    const db = migratedDatabase();
    const actualIndices = (
      db
        .prepare(
          `SELECT name
             FROM sqlite_schema
            WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
            ORDER BY name`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(actualIndices).toEqual(INDEX_NAMES);
  });

  it("isolates project/version scopes and enforces every foreign-key relation", () => {
    const db = migratedDatabase();
    const insertFinding = db.prepare(
      `INSERT INTO findings
         (finding_id, project_id, project_version_id, stable_key, raw, pulled_at)
       VALUES (?, ?, ?, ?, '{}', ?)`,
    );
    insertFinding.run("finding-1", "project-a", "pv-a", "stable-a", "2026-08-12");
    insertFinding.run("finding-1", "project-a", "pv-b", "stable-a", "2026-08-12");
    expect(db.prepare("SELECT count(*) FROM findings").pluck().get()).toBe(2);

    db.prepare(
      `INSERT INTO entity_review_state
         (project_id, entity_kind, entity_key, remote_id, review_version, pulled_at)
       VALUES (?, 'requirement', 'REQ-1', ?, ?, '2026-08-12')`,
    ).run("project-a", "remote-1", "900719925474099312345");
    db.prepare(
      `INSERT INTO entity_review_state
         (project_id, entity_kind, entity_key, remote_id, review_version, pulled_at)
       VALUES (?, 'requirement', 'REQ-1', ?, ?, '2026-08-12')`,
    ).run("project-b", "remote-1", "900719925474099312346");
    expect(
      db
        .prepare(
          `SELECT review_version FROM entity_review_state
            WHERE project_id = 'project-a' AND entity_kind = 'requirement'
              AND entity_key = 'REQ-1'`,
        )
        .pluck()
        .get(),
    ).toBe("900719925474099312345");

    db.prepare(
      `INSERT INTO document
         (document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
          uploaded_at, indexed_at)
       VALUES (?, ?, 'shared-sha', ?, ?, 'other', 'text/plain', 1, 'now', 'now')`,
    ).run("doc-a", "project-a", "a.txt", "product-security/documents/a.txt");
    db.prepare(
      `INSERT INTO document
         (document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
          uploaded_at, indexed_at)
       VALUES (?, ?, 'shared-sha', ?, ?, 'other', 'text/plain', 1, 'now', 'now')`,
    ).run("doc-b", "project-b", "b.txt", "product-security/documents/b.txt");

    expectConstraint(() =>
      db.prepare(
        `INSERT INTO finding_cwes
           (project_version_id, finding_id, cwe, pulled_at)
         VALUES ('pv-missing', 'finding-1', 'CWE-79', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO finding_activity
           (project_version_id, finding_id, event_id, stable_key, event_at, raw, pulled_at)
         VALUES ('pv-a', 'missing', 'event-1', 'stable-a', 'now', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO standards_clauses
           (standard_id, clause_id, clause_code, raw, pulled_at)
         VALUES ('missing', 'clause-1', '1', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO requirement_check_mappings
           (project_id, requirement_key, check_id, raw, pulled_at)
         VALUES ('project-a', 'REQ-1', 'missing', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO verification_results
           (result_id, run_id, project_id, tier, status, raw, pulled_at)
         VALUES ('result-1', 'missing', 'project-a', 'static', 'pending', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO verification_artifacts
           (artifact_id, run_id, name, kind, locator, pulled_at)
         VALUES ('artifact-1', 'missing', 'log', 'log', 'artifacts/log', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO attestations
           (attestation_id, run_id, format, subject_digest, payload, created_at, pulled_at)
         VALUES ('att-1', 'missing', 'dsse', 'sha256:x', '{}', 'now', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO document_extraction
           (extraction_id, document_id, field, source_ref, locator_kind, status, extracted_at)
         VALUES ('extract-1', 'missing', 'mpn', '#p1', 'pdf', 'proposal', 'now')`,
      ).run(),
    );

    db.prepare(
      `INSERT INTO finding_cwes
         (project_version_id, finding_id, cwe, pulled_at)
       VALUES ('pv-a', 'finding-1', 'CWE-79', 'now')`,
    ).run();
    db.prepare(
      `INSERT INTO finding_activity
         (project_version_id, finding_id, event_id, stable_key, event_at, raw, pulled_at)
       VALUES ('pv-a', 'finding-1', 'event-1', 'stable-a', 'now', '{}', 'now')`,
    ).run();
    db.prepare("DELETE FROM findings WHERE project_version_id = 'pv-a'").run();
    expect(db.prepare("SELECT count(*) FROM finding_cwes").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM finding_activity").pluck().get()).toBe(0);
  });

  it("rejects invalid local states, confidence, booleans, tiers, locators, and trust claims", () => {
    const db = migratedDatabase();
    const insertOverlay = db.prepare(
      `INSERT INTO overlay_index
         (entity_kind, project_key, stable_key, file_path, file_sha256, local_state,
          drift_state, pin, match_tier, indexed_at)
       VALUES ('vexDecision', 'project-a', ?, '.fs/triage/a.yaml', 'sha', ?, ?, ?, ?, 'now')`,
    );
    const localStates = [
      "dirty",
      "pushed",
      "conflict",
      "stale",
      "orphaned",
      "needs_completion",
    ];
    for (const [index, state] of localStates.entries()) {
      insertOverlay.run(`local-${index}`, state, null, null, null);
    }
    const driftStates = [
      "reattached_noop",
      "reapply",
      "stale",
      "orphaned",
      "conflict",
      "needs_completion",
    ];
    for (const [index, state] of driftStates.entries()) {
      insertOverlay.run(`drift-${index}`, "dirty", state, null, null);
    }
    insertOverlay.run("valid-classification", "dirty", null, "exact_version", "purl");
    expectConstraint(() =>
      insertOverlay.run("bad-local", "ambiguous", null, null, null),
    );
    expectConstraint(() =>
      insertOverlay.run("bad-drift", "dirty", "ambiguous", null, null),
    );
    expectConstraint(() =>
      insertOverlay.run("bad-pin", "dirty", null, "loose", null),
    );
    expectConstraint(() =>
      insertOverlay.run("bad-tier", "dirty", null, null, "name"),
    );

    expectConstraint(() =>
      db.prepare(
        `INSERT INTO hbom_cells
           (project_key, part_key, field, confidence, state, file_sha256, indexed_at)
         VALUES ('project-a', 'part-1', 'mpn', 1.01, 'proposal', 'sha', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO hbom_candidates
           (candidate_id, project_key, part_key, field, provenance, confidence,
            asserted_by, asserted_at, status, indexed_at)
         VALUES ('candidate-1', 'project-a', 'part-1', 'mpn', 'datasheet', -0.1,
                 'agent', 'now', 'pending', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO findings
           (finding_id, project_id, project_version_id, stable_key, in_kev, raw, pulled_at)
         VALUES ('finding-bool', 'project-a', 'pv-a', 'stable-bool', 2, '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO verification_runs
           (run_id, project_id, tier, matrix_col, kind, status, raw, synced_at)
         VALUES ('run-tier', 'project-a', 'tier5', 'static', 'static', 'queued', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO verification_runs
           (run_id, project_id, tier, matrix_col, kind, status, raw, synced_at)
         VALUES ('run-matrix', 'project-a', 'tier0', 'dynamic', 'static', 'queued', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO verification_runs
           (run_id, project_id, tier, matrix_col, kind, status, raw, synced_at)
         VALUES ('run-status', 'project-a', 'tier0', 'static', 'static', 'passed', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO verification_results
           (result_id, project_id, tier, status, mapping_state, raw, pulled_at)
         VALUES ('result-status', 'project-a', 'static', 'safe', 'mapped', '{}', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO firmware_mounts
           (pv_id, source, state, root_path, admin_bytes_ok, pulled_at)
         VALUES ('pv-mount', 'api', 'ready', '.fs-firmware/pv-mount/rootfs', 2, 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO document
           (document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
            uploaded_at, indexed_at)
         VALUES ('doc-kind', 'project-a', 'sha', 'x', 'x', 'executable',
                 'application/octet-stream', 1, 'now', 'now')`,
      ).run(),
    );

    db.prepare(
      `INSERT INTO document
         (document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
          uploaded_at, indexed_at)
       VALUES ('doc-1', 'project-a', 'sha-1', 'x.pdf',
               'product-security/documents/x.pdf', 'datasheet', 'application/pdf', 1,
               'now', 'now')`,
    ).run();
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO document_extraction
           (extraction_id, document_id, field, confidence, source_ref, locator_kind,
            status, extracted_at)
         VALUES ('extract-confidence', 'doc-1', 'mpn', 2, '#p1', 'pdf',
                 'proposal', 'now')`,
      ).run(),
    );
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO document_extraction
           (extraction_id, document_id, field, source_ref, locator_kind, status, extracted_at)
         VALUES ('extract-locator', 'doc-1', 'mpn', '#p1', 'image', 'proposal', 'now')`,
      ).run(),
    );

    db.prepare(
      `INSERT INTO verification_runs
         (run_id, project_id, tier, matrix_col, kind, status, firmware_digest, raw, synced_at)
       VALUES ('run-1', 'project-a', 'tier1', 'emulation', 'rehost', 'completed',
               'sha256:firmware', '{}', 'now')`,
    ).run();
    expectConstraint(() =>
      db.prepare(
        `INSERT INTO attestations
           (attestation_id, run_id, format, subject_digest, payload,
            signature_verified, subject_matches_run, verified, created_at, pulled_at)
         VALUES ('att-bad', 'run-1', 'dsse', 'sha256:other', '{}', 1, 0, 1, 'now', 'now')`,
      ).run(),
    );
    db.prepare(
      `INSERT INTO attestations
         (attestation_id, run_id, format, subject_digest, payload,
          signature_verified, subject_matches_run, verified, created_at, pulled_at)
       VALUES ('att-good', 'run-1', 'dsse', 'sha256:firmware', '{}', 1, 1, 1, 'now', 'now')`,
    ).run();
  });

  it("uses the named indices for policy, overlay, evidence, firmware, and document access", () => {
    const db = migratedDatabase();
    const expectations: Array<[string, string, unknown[]]> = [
      [
        "ix_findings_policy_dataset",
        `SELECT finding_id FROM findings
          WHERE project_version_id = ? AND vuln_in_dataset = ? AND reachability_score >= ?
          ORDER BY reachability_score, finding_id`,
        ["pv-a", 1, 0],
      ],
      [
        "ix_findings_policy_band",
        `SELECT finding_id FROM findings
          WHERE project_version_id = ? AND band = ? ORDER BY finding_id`,
        ["pv-a", "critical"],
      ],
      [
        "ix_findings_policy_flags",
        `SELECT finding_id FROM findings
          WHERE project_version_id = ? AND violation_count > ?
          ORDER BY violation_count, warning_count, finding_id`,
        ["pv-a", 0],
      ],
      [
        "ix_finding_cwes_selector",
        `SELECT finding_id FROM finding_cwes
          WHERE project_version_id = ? AND cwe = ? ORDER BY finding_id`,
        ["pv-a", "CWE-79"],
      ],
      [
        "ix_overlay_project_state",
        `SELECT stable_key FROM overlay_index
          WHERE project_key = ? AND entity_kind = ? AND local_state = ? AND drift_state = ?
          ORDER BY stable_key`,
        ["project-a", "vexDecision", "dirty", "reapply"],
      ],
      [
        "ix_overlay_policy_flag",
        `SELECT stable_key FROM overlay_index
          WHERE project_key = ? AND entity_kind = ? AND policy_violation_count > ?
          ORDER BY policy_violation_count, policy_warning_count, stable_key`,
        ["project-a", "vexDecision", 0],
      ],
      [
        "ix_triage_runs_scope",
        `SELECT run_id FROM triage_runs
          WHERE project_id = ? AND project_version_id = ?
          ORDER BY created_at DESC, run_id LIMIT 50`,
        ["project-a", "pv-a"],
      ],
      [
        "ix_sbom_purl",
        `SELECT component_id FROM sbom_components
          WHERE project_id = ? AND purl = ? ORDER BY component_id`,
        ["project-a", "pkg:generic/a@1"],
      ],
      [
        "ix_hbom_review",
        `SELECT part_key, field FROM hbom_cells
          WHERE project_key = ? AND state = ? ORDER BY part_key, field`,
        ["project-a", "proposal"],
      ],
      [
        "ix_verification_results_matrix",
        `SELECT result_id FROM verification_results
          WHERE project_id = ? AND pv_id = ? AND requirement_key = ? AND tier = ?
            AND is_latest = 1
          ORDER BY executed_at DESC, result_id`,
        ["project-a", "pv-a", "REQ-1", "static"],
      ],
      [
        "ix_verification_runs_recent",
        `SELECT run_id FROM verification_runs
          WHERE project_id = ? AND pv_id = ? ORDER BY started_at DESC, run_id LIMIT 50`,
        ["project-a", "pv-a"],
      ],
      [
        "ix_verification_artifacts_run",
        `SELECT artifact_id FROM verification_artifacts
          WHERE run_id = ? AND kind = ? ORDER BY artifact_id`,
        ["run-1", "log"],
      ],
      [
        "ix_attestations_subject",
        `SELECT attestation_id FROM attestations
          WHERE subject_digest = ? AND verified = 1 ORDER BY attestation_id`,
        ["sha256:firmware"],
      ],
      [
        "ix_firmware_mounts_state",
        `SELECT pv_id FROM firmware_mounts
          WHERE project_id = ? AND state = ? ORDER BY pv_id`,
        ["project-a", "ready"],
      ],
      [
        "ix_document_list",
        `SELECT document_id FROM document
          WHERE project_key = ? AND doc_kind = ? AND withdrawn = 0
          ORDER BY uploaded_at DESC, document_id LIMIT 50`,
        ["project-a", "datasheet"],
      ],
      [
        "ix_document_extraction_source",
        `SELECT extraction_id FROM document_extraction
          WHERE document_id = ? AND locator_kind = ? AND page = ?
          ORDER BY sheet, cell, line_start, extraction_id`,
        ["doc-1", "pdf", 1],
      ],
      [
        "ix_document_extraction_target",
        `SELECT extraction_id FROM document_extraction
          WHERE target_surface = ? AND target_id = ? AND target_field = ? AND status = ?
          ORDER BY extraction_id`,
        ["hbom", "HBOM-1", "mpn", "proposal"],
      ],
      [
        "ix_document_extraction_search",
        `SELECT document_id, extraction_id FROM document_extraction
          WHERE field = ? COLLATE NOCASE AND value = ? COLLATE NOCASE AND status = ?
          ORDER BY document_id, extraction_id`,
        ["mpn", "BCM", "proposal"],
      ],
    ];

    for (const [indexName, sql, params] of expectations) {
      expect(plan(db, sql, ...params), indexName).toContain(indexName);
    }
  });

  it("keeps representative downstream pages indexed and under the 200ms cache budget", () => {
    const db = migratedDatabase();
    db.exec(`
      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 4000
      )
      INSERT INTO findings (
        finding_id, project_id, project_version_id, stable_key, finding_type,
        severity, risk_score, band, epss_score, in_kev, vuln_in_dataset,
        reachability_score, warning_count, violation_count, raw, pulled_at
      )
      SELECT 'finding-' || n, 'project-a', 'pv-a', 'stable-' || n, 'cve',
             CASE n % 4 WHEN 0 THEN 'critical' WHEN 1 THEN 'high'
                        WHEN 2 THEN 'medium' ELSE 'low' END,
             n / 40.0, CASE WHEN n % 10 = 0 THEN 'critical' ELSE 'routine' END,
             n / 4000.0, n % 2, CASE WHEN n % 3 = 0 THEN NULL ELSE n % 2 END,
             n % 100, n % 3, n % 5, '{}', '2026-08-12'
        FROM seq;

      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 10000
      )
      INSERT INTO sbom_components (
        project_version_id, project_id, component_id, component_key, purl, name,
        raw, pulled_at
      )
      SELECT 'pv-a', 'project-a', 'component-' || n, 'key-' || n,
             'pkg:generic/component-' || n || '@1', 'component-' || n, '{}', '2026-08-12'
        FROM seq;

      WITH RECURSIVE req(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM req WHERE n < 5000
      ), tiers(tier) AS (VALUES('static'),('emulation'),('hil'),('manual'))
      INSERT INTO verification_results (
        result_id, project_id, pv_id, requirement_key, tier, status,
        executed_at, is_latest, raw, pulled_at
      )
      SELECT 'result-' || n || '-' || tier, 'project-a', 'pv-a', 'REQ-' || n,
             tier, CASE WHEN n % 11 = 0 THEN 'failed' ELSE 'verified' END,
             printf('2026-08-12T00:%02d:00Z', n % 60), 1, '{}', '2026-08-12'
        FROM req CROSS JOIN tiers;

      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 5000
      )
      INSERT INTO verification_runs (
        run_id, project_id, pv_id, tier, matrix_col, kind, status, started_at,
        raw, synced_at
      )
      SELECT 'run-' || n, 'project-a', 'pv-a', 'tier1', 'emulation', 'rehost',
             'completed', printf('2026-08-%02dT00:00:00Z', (n % 28) + 1), '{}', '2026-08-12'
        FROM seq;

      INSERT INTO document (
        document_id, project_key, sha256, name, path, doc_kind, mime_type, bytes,
        uploaded_at, indexed_at
      ) VALUES (
        'doc-perf', 'project-a', 'sha-perf', 'perf.pdf',
        'product-security/documents/sha-perf-perf.pdf', 'datasheet',
        'application/pdf', 10000, '2026-08-12', '2026-08-12'
      );

      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 10000
      )
      INSERT INTO document_extraction (
        extraction_id, document_id, field, value, source_ref, locator_kind,
        page, status, extracted_at
      )
      SELECT 'extract-' || n, 'doc-perf', 'mpn', 'value-' || n, '#p' || n,
             'pdf', (n % 200) + 1, 'proposal', '2026-08-12'
        FROM seq;
    `);

    const pages: Array<[string, string, unknown[]]> = [
      [
        "ix_findings_policy_band",
        `SELECT finding_id, risk_score FROM findings
          WHERE project_version_id = ? AND band = ?
          ORDER BY finding_id LIMIT 200`,
        ["pv-a", "critical"],
      ],
      [
        "ix_sbom_name",
        `SELECT component_id, name FROM sbom_components
          WHERE project_version_id = ? AND name >= ? COLLATE NOCASE
          ORDER BY name COLLATE NOCASE, component_group COLLATE NOCASE, version, component_id
          LIMIT 200`,
        ["pv-a", "component-500"],
      ],
      [
        "ix_verification_results_matrix",
        `SELECT requirement_key, tier, status FROM verification_results
          WHERE project_id = ? AND pv_id = ? AND requirement_key >= ? AND is_latest = 1
          ORDER BY requirement_key, tier LIMIT 200`,
        ["project-a", "pv-a", "REQ-2500"],
      ],
      [
        "ix_verification_runs_recent",
        `SELECT run_id, status FROM verification_runs
          WHERE project_id = ? AND pv_id = ?
          ORDER BY started_at DESC, run_id LIMIT 200`,
        ["project-a", "pv-a"],
      ],
      [
        "ix_document_extraction_search",
        `SELECT document_id, extraction_id FROM document_extraction
          WHERE field = ? COLLATE NOCASE AND value >= ? COLLATE NOCASE AND status = ?
          ORDER BY value COLLATE NOCASE, document_id, extraction_id LIMIT 200`,
        ["mpn", "value-5000", "proposal"],
      ],
    ];

    for (const [indexName, sql, params] of pages) {
      expect(plan(db, sql, ...params), indexName).toContain(indexName);
      const startedAt = performance.now();
      const rows = db.prepare(sql).all(...params);
      const elapsedMs = performance.now() - startedAt;
      expect(rows.length, indexName).toBeGreaterThan(0);
      expect(elapsedMs, `${indexName} took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(200);
    }
  });
});
