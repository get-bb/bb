import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
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
  PullGenerationRow,
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
  SCHEMA_INDEXES,
  SCHEMA_TABLES,
  SCHEMA_VERSION,
  SCHEMA_VIEWS,
} from "./schema.js";
import { ENTITIES } from "../sync/registry.js";

function defineColumns<Row>() {
  return <const Names extends readonly (keyof Row & string)[]>(
    names: keyof Row extends Names[number] ? Names : never,
  ): Names => names;
}

const ROW_COLUMNS = {
  pull_generation: defineColumns<PullGenerationRow>()([
    "project_id",
    "project_version_id",
    "generation_id",
    "status",
    "requested_kinds_json",
    "started_at",
    "completed_at",
    "accepted_at",
    "error",
  ]),
  sync_state: defineColumns<SyncStateRow>()([
    "project_id",
    "project_version_id",
    "entity_kind",
    "accepted_generation_id",
    "staging_generation_id",
    "base_revision",
    "staging_continuation",
    "staged_pages",
    "staged_rows",
    "last_pull",
    "error",
  ]),
  workspace_platform_project_binding: [
    "workspace_project_id",
    "platform_project_id",
  ],
  push_log: defineColumns<PushLogRow>()([
    "project_id",
    "project_version_id",
    "id",
    "run_id",
    "base_generation_id",
    "base_revision",
    "expected_base_content_hash",
    "entity_kind",
    "entity_key",
    "op",
    "status",
    "error",
    "created_at",
    "applied_at",
  ]),
  base_snapshot: defineColumns<BaseSnapshotRow>()([
    "project_id",
    "project_version_id",
    "entity_kind",
    "generation_id",
    "entity_key",
    "remote_id",
    "payload",
    "content_hash",
    "pulled_at",
  ]),
  id_map: defineColumns<IdMapRow>()([
    "project_id",
    "project_version_id",
    "entity_kind",
    "generation_id",
    "entity_key",
    "remote_id",
    "pulled_at",
  ]),
  entity_review_state: defineColumns<EntityReviewStateRow>()([
    "project_id",
    "project_version_id",
    "generation_id",
    "entity_kind",
    "entity_key",
    "remote_id",
    "review_status",
    "review_version",
    "pulled_at",
  ]),
  findings: defineColumns<FindingRow>()([
    "project_id",
    "project_version_id",
    "generation_id",
    "finding_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
    "finding_id",
    "cwe",
    "pulled_at",
  ]),
  finding_activity: defineColumns<FindingActivityRow>()([
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "entity_kind",
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
    "project_id",
    "project_version_id",
    "run_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
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
    "project_id",
    "project_version_id",
    "candidate_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
    "profile_id",
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
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
    "check_id",
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
    "project_version_id",
    "generation_id",
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
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
    "run_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
    "result_id",
    "run_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "generation_id",
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
    "project_id",
    "project_version_id",
    "document_id",
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
    "project_id",
    "project_version_id",
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
    "project_id",
    "project_version_id",
    "document_id",
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
  hw_project: [
    "project_id",
    "project_version_id",
    "project_key",
    "name",
    "sch_path",
    "pcb_path",
    "sch_hash",
    "pcb_hash",
    "kicad_version",
    "discovered_at",
    "supported",
  ],
  hw_artifact: [
    "project_id",
    "project_version_id",
    "project_key",
    "kind",
    "sheet_path",
    "path",
    "source_hash",
    "cli_version",
    "generated_at",
  ],
  hw_symbol: [
    "project_id",
    "project_version_id",
    "project_key",
    "sheet_path",
    "reference",
    "value",
    "footprint",
    "mpn",
    "manufacturer",
    "at_x",
    "at_y",
    "angle",
    "unit",
    "fields",
  ],
  hw_net: [
    "project_id",
    "project_version_id",
    "project_key",
    "net_name",
    "nodes",
  ],
  hw_sheet: [
    "project_id",
    "project_version_id",
    "project_key",
    "sheet_path",
    "name",
    "parent_sheet_path",
    "page_order",
    "width_mm",
    "height_mm",
  ],
  hw_ingest: [
    "project_id",
    "project_version_id",
    "project_key",
    "source_hash",
    "ingested_at",
    "symbol_refs",
    "connectivity_gaps",
  ],
  hw_violation: [
    "project_id",
    "project_version_id",
    "id",
    "project_key",
    "kind",
    "severity",
    "rule",
    "description",
    "refs",
    "at_x",
    "at_y",
    "run_at",
  ],
  ground_source: [
    "project_id",
    "project_version_id",
    "source_id",
    "project_key",
    "kind",
    "part",
    "title",
    "path",
    "pages",
    "indexed_at",
    "status",
    "license",
    "redistributable",
  ],
  ground_chunk: [
    "project_id",
    "project_version_id",
    "chunk_id",
    "source_id",
    "page",
    "kind",
    "anchor",
    "text",
    "embedding",
  ],
  bench_device: [
    "project_id",
    "project_version_id",
    "device_id",
    "kind",
    "make",
    "model",
    "connection",
    "transport",
    "claimed_by",
    "claimed_at",
    "claim_scope",
    "last_seen",
  ],
  probe_run: [
    "project_id",
    "project_version_id",
    "run_id",
    "script_path",
    "devices",
    "hypothesis",
    "outcome",
    "artifacts",
    "started_at",
    "finished_at",
  ],
  build_run: [
    "project_id",
    "project_version_id",
    "run_id",
    "kind",
    "target",
    "toolchain",
    "status",
    "artifact",
    "digest",
    "log_path",
    "started_at",
  ],
} satisfies Record<
  (typeof SCHEMA_TABLES)[number] | (typeof SCHEMA_VIEWS)[number],
  readonly string[]
>;

const databases: Database.Database[] = [];

function createDb(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
  return db;
}

const PRE_AMENDMENT_MIGRATION_COUNT = 78;
const AMD_0010_REBUILD_STATEMENT_COUNT = 22;
const AMD_0017_BACKFILL_STATEMENT_COUNT = 2;
const AMD_0018_HARDWARE_SEMANTIC_STATEMENT_COUNT = 2;
const AMD_0020_PROJECT_BINDING_STATEMENT_COUNT = 2;

function insertGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  generationId: string,
  status: PullGenerationRow["status"] = "accepted",
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, ?, '["finding"]', '2026-08-12T00:00:00Z',
             '2026-08-12T00:01:00Z', ?)`,
  ).run(
    projectId,
    projectVersionId,
    generationId,
    status,
    status === "accepted" ? "2026-08-12T00:01:00Z" : null,
  );
}

function planDetails(
  db: Database.Database,
  sql: string,
  ...params: (string | number | null)[]
): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => (row as { detail: string }).detail)
    .join("\n");
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("shared-store-freeze", () => {
  it("applies the positional migration once and fails loudly on a preexisting base table", async () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(MIGRATIONS).toHaveLength(
      SCHEMA_TABLES.length +
        SCHEMA_INDEXES.length +
        SCHEMA_VIEWS.length +
        AMD_0010_REBUILD_STATEMENT_COUNT +
        AMD_0017_BACKFILL_STATEMENT_COUNT,
    );
    expect(
      MIGRATIONS.filter((statement) =>
        /^CREATE TABLE\b/u.test(statement),
      ).every((statement) => !statement.includes("IF NOT EXISTS")),
    ).toBe(true);

    const host = createFakePluginHost({
      pluginId: "finite-state-schema-repeat",
    });
    const db = host.bb.storage.database();
    host.bb.storage.migrate(db, MIGRATIONS);
    const firstCount = db
      .prepare("SELECT count(*) FROM _bb_migrations")
      .pluck()
      .get();
    host.bb.storage.migrate(db, MIGRATIONS);
    expect(
      db.prepare("SELECT count(*) FROM _bb_migrations").pluck().get(),
    ).toBe(firstCount);
    expect(firstCount).toBe(MIGRATIONS.length);
    await host.harness.lifecycle.dispose();

    const collisionHost = createFakePluginHost({
      pluginId: "finite-state-schema-collision",
    });
    const collisionDb = collisionHost.bb.storage.database();
    collisionDb.exec("CREATE TABLE pull_generation (unexpected TEXT)");
    expect(() =>
      collisionHost.bb.storage.migrate(collisionDb, MIGRATIONS),
    ).toThrow(/already exists/i);
    await collisionHost.harness.lifecycle.dispose();
  });

  it("matches the named table, index, view, and cache inventories", () => {
    const db = createDb();
    const names = (type: "table" | "index" | "view") =>
      db
        .prepare(
          `SELECT name FROM sqlite_schema
            WHERE type = ? AND name NOT LIKE 'sqlite_%'
            ORDER BY name`,
        )
        .pluck()
        .all(type) as string[];

    expect(names("table")).toEqual([...SCHEMA_TABLES].sort());
    expect(names("index")).toEqual([...SCHEMA_INDEXES].sort());
    expect(names("view")).toEqual([...SCHEMA_VIEWS].sort());
    expect(SCHEMA_TABLES).toHaveLength(42);
    expect(SCHEMA_INDEXES).toHaveLength(52);

    const registryCacheNames = Object.values(ENTITIES).flatMap((entry) =>
      entry.class === "CACHED" ? [entry.table] : [],
    );
    expect([...registryCacheNames].sort()).toEqual(
      [...CACHE_STORAGE_NAMES].sort(),
    );

    for (const storageName of CACHE_STORAGE_NAMES) {
      const kind = db
        .prepare("SELECT type FROM sqlite_schema WHERE name = ?")
        .pluck()
        .get(storageName);
      expect(kind, storageName).toBe(
        storageName === "hbom_docs" ? "view" : "table",
      );
    }
  });

  it("upgrades a populated pre-amendment matrix without row or FK loss", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-schema-amd-0010",
    });
    const db = host.bb.storage.database();
    db.pragma("foreign_keys = ON");
    host.bb.storage.migrate(
      db,
      MIGRATIONS.slice(0, PRE_AMENDMENT_MIGRATION_COUNT),
    );
    insertGeneration(db, "project-a", "version-a", "generation-a");

    const oldValues = ["static", "emulation", "hil", "manual"] as const;
    for (const [index, value] of oldValues.entries()) {
      const runId = `run-${value}`;
      const resultId = `result-${value}`;
      db.prepare(
        `INSERT INTO verification_runs
           (project_id, project_version_id, generation_id, run_id, tier, matrix_col,
            kind, trigger, host_id, thread_id, target, config, status, started_at,
            finished_at, duration_ms, firmware_digest, job_id, log_locator, log_cursor,
            raw, synced_at)
         VALUES ('project-a', 'version-a', 'generation-a', ?, 'tier2', ?,
                 'bench', 'manual', 'host-a', 'thread-a', 'target-a', '{"mode":"test"}',
                 'completed', '2026-08-13T01:00:00Z', '2026-08-13T01:01:00Z', 60000,
                 'sha256:firmware', ?, 'logs/run.log', 'cursor-a', '{"run":true}',
                 '2026-08-13T01:02:00Z')`,
      ).run(runId, value, `job-${index}`);
      db.prepare(
        `INSERT INTO verification_results
           (project_id, project_version_id, generation_id, result_id, run_id,
            requirement_key, tier, status, outcome, confidence, evidence_summary,
            result_data, measured, executed_at, executed_by, failure_reason,
            remediation_suggestion, fs_version_id, fs_version_name, is_latest,
            superseded_by, sla_status, mapping_state, raw, pulled_at)
         VALUES ('project-a', 'version-a', 'generation-a', ?, ?, 'REQ-1', ?,
                 'verified', 'pass', 'high', 'summary', '{"answer":42}', '{"v":1}',
                 '2026-08-13T01:01:00Z', 'runner', NULL, NULL, 'fs-v1', 'Version 1',
                 1, NULL, 'met', 'mapped', '{"result":true}', '2026-08-13T01:02:00Z')`,
      ).run(resultId, runId, value);
      db.prepare(
        `INSERT INTO verification_artifacts
           (project_id, project_version_id, generation_id, artifact_id, run_id,
            result_id, name, kind, locator, media_type, sha256, bytes, created_at, pulled_at)
         VALUES ('project-a', 'version-a', 'generation-a', ?, ?, ?, 'report',
                 'report', 'artifacts/report.json', 'application/json', 'sha256:artifact',
                 42, '2026-08-13T01:01:00Z', '2026-08-13T01:02:00Z')`,
      ).run(`artifact-${value}`, runId, resultId);
      db.prepare(
        `INSERT INTO attestations
           (project_id, project_version_id, generation_id, attestation_id, run_id,
            format, subject_digest, payload, signature_verified, subject_matches_run,
            verified, created_at, pulled_at)
         VALUES ('project-a', 'version-a', 'generation-a', ?, ?, 'in-toto',
                 'sha256:firmware', '{"statement":true}', 1, 1, 1,
                 '2026-08-13T01:01:00Z', '2026-08-13T01:02:00Z')`,
      ).run(`attestation-${value}`, runId);
    }

    const snapshot = (table: string, orderBy: string) =>
      db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
    const before = {
      runs: snapshot("verification_runs", "run_id"),
      results: snapshot("verification_results", "result_id"),
      artifacts: snapshot("verification_artifacts", "artifact_id"),
      attestations: snapshot("attestations", "attestation_id"),
    };

    host.bb.storage.migrate(db, MIGRATIONS);

    expect(snapshot("verification_runs", "run_id")).toEqual(before.runs);
    expect(snapshot("verification_results", "result_id")).toEqual(
      before.results,
    );
    expect(snapshot("verification_artifacts", "artifact_id")).toEqual(
      before.artifacts,
    );
    expect(snapshot("attestations", "attestation_id")).toEqual(
      before.attestations,
    );
    expect(db.pragma("foreign_key_check")).toEqual([]);

    db.prepare(
      `INSERT INTO verification_runs
         (project_id, project_version_id, generation_id, run_id, tier, matrix_col,
          kind, status, raw, synced_at)
       VALUES ('project-a', 'version-a', 'generation-a', 'run-hardware', 'tier2',
               'hardware', 'bench', 'completed', '{}', 'now')`,
    ).run();
    db.prepare(
      `INSERT INTO verification_results
         (project_id, project_version_id, generation_id, result_id, run_id, tier,
          status, raw, pulled_at)
       VALUES ('project-a', 'version-a', 'generation-a', 'result-hardware',
               'run-hardware', 'hardware', 'verified', '{}', 'now')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO verification_results
           (project_id, project_version_id, generation_id, result_id, tier,
            status, raw, pulled_at)
         VALUES ('project-a', 'version-a', 'generation-a', 'result-hil2',
                 'hil2', 'verified', '{}', 'now')`,
        )
        .run(),
    ).toThrow(/check constraint failed/i);

    const appliedCount = db
      .prepare("SELECT count(*) FROM _bb_migrations")
      .pluck()
      .get();
    host.bb.storage.migrate(db, MIGRATIONS);
    expect(
      db.prepare("SELECT count(*) FROM _bb_migrations").pluck().get(),
    ).toBe(appliedCount);
    await host.harness.lifecycle.dispose();
  });

  it("backfills pre-AMD-0017 KiCad compatibility by version shape without discovery", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-schema-amd-0017",
    });
    const db = host.bb.storage.database();
    host.bb.storage.migrate(
      db,
      MIGRATIONS.slice(
        0,
        -(
          AMD_0017_BACKFILL_STATEMENT_COUNT +
          AMD_0018_HARDWARE_SEMANTIC_STATEMENT_COUNT +
          AMD_0020_PROJECT_BINDING_STATEMENT_COUNT
        ),
      ),
    );

    const insert = db.prepare(
      `INSERT INTO hw_project
         (project_id, project_version_id, project_key, name, sch_path, pcb_path,
          sch_hash, pcb_hash, kicad_version, discovered_at)
       VALUES ('project-a', '@project', ?, ?, ?, NULL, ?, NULL, ?, '2026-08-13T00:00:00Z')`,
    );
    for (const [projectKey, version] of [
      ["legacy-five.kicad_pro", "20171130"],
      ["modern-date.kicad_pro", "20231120"],
      ["dotted-five.kicad_pro", "5.1.12.3"],
      ["modern-generator.kicad_pro", "8.0.4"],
      ["unknown.kicad_pro", null],
    ] as const) {
      insert.run(
        projectKey,
        projectKey,
        projectKey.replace(".kicad_pro", ".kicad_sch"),
        "0".repeat(64),
        version,
      );
    }

    host.bb.storage.migrate(db, MIGRATIONS);

    expect(
      db
        .prepare(
          "SELECT project_key, supported FROM hw_project ORDER BY project_key",
        )
        .all(),
    ).toEqual([
      { project_key: "dotted-five.kicad_pro", supported: 0 },
      { project_key: "legacy-five.kicad_pro", supported: 0 },
      { project_key: "modern-date.kicad_pro", supported: 1 },
      { project_key: "modern-generator.kicad_pro", supported: 1 },
      { project_key: "unknown.kicad_pro", supported: 0 },
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("adds the workspace-to-Platform binding table without changing populated cache rows", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-schema-amd-0020",
    });
    const db = host.bb.storage.database();
    host.bb.storage.migrate(
      db,
      MIGRATIONS.slice(0, -AMD_0020_PROJECT_BINDING_STATEMENT_COUNT),
    );
    insertGeneration(db, "platform-project", "version-1", "generation-1");
    db.prepare(
      `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        last_pull)
       VALUES ('platform-project', 'version-1', 'finding', 'generation-1',
               '2026-08-14T00:00:00.000Z')`,
    ).run();

    host.bb.storage.migrate(db, MIGRATIONS);

    expect(
      db
        .prepare(
          `SELECT project_id, project_version_id, accepted_generation_id
             FROM sync_state`,
        )
        .all(),
    ).toEqual([
      {
        project_id: "platform-project",
        project_version_id: "version-1",
        accepted_generation_id: "generation-1",
      },
    ]);
    expect(
      db.prepare("SELECT * FROM workspace_platform_project_binding").all(),
    ).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("keeps exact snake-case row interfaces in mechanical PRAGMA parity", () => {
    const db = createDb();
    for (const [name, expected] of Object.entries(ROW_COLUMNS)) {
      const actual = db
        .prepare(`PRAGMA table_info('${name}')`)
        .all()
        .map((row) => (row as { name: string }).name);
      expect(actual, name).toEqual(expected);
    }
  });

  it("puts the non-null D-1 pair first in every table, key, FK, and named index", () => {
    const db = createDb();
    for (const table of SCHEMA_TABLES) {
      const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as {
        name: string;
        notnull: 0 | 1;
        pk: number;
      }[];
      if (table === "workspace_platform_project_binding") {
        expect(
          columns.map(({ name }) => name),
          table,
        ).toEqual(["workspace_project_id", "platform_project_id"]);
        expect(
          columns.map(({ notnull }) => notnull),
          table,
        ).toEqual([1, 1]);
        expect(
          columns
            .filter(({ pk }) => pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map(({ name }) => name),
          `${table} primary key`,
        ).toEqual(["workspace_project_id", "platform_project_id"]);
        continue;
      }
      expect(
        columns.slice(0, 2).map(({ name }) => name),
        table,
      ).toEqual(["project_id", "project_version_id"]);
      expect(
        columns.slice(0, 2).map(({ notnull }) => notnull),
        table,
      ).toEqual([1, 1]);
      expect(
        columns
          .filter(({ pk }) => pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .slice(0, 2)
          .map(({ name }) => name),
        `${table} primary key`,
      ).toEqual(["project_id", "project_version_id"]);

      const uniqueIndexes = db
        .prepare(`PRAGMA index_list('${table}')`)
        .all() as {
        name: string;
        unique: 0 | 1;
      }[];
      for (const index of uniqueIndexes.filter(({ unique }) => unique === 1)) {
        const columnsForIndex = db
          .prepare(`PRAGMA index_info('${index.name}')`)
          .all()
          .map((row) => (row as { name: string }).name);
        expect(columnsForIndex.slice(0, 2), `${table}.${index.name}`).toEqual([
          "project_id",
          "project_version_id",
        ]);
      }

      const foreignKeys = db
        .prepare(`PRAGMA foreign_key_list('${table}')`)
        .all() as {
        id: number;
        seq: number;
        from: string;
      }[];
      const groups = new Map<number, typeof foreignKeys>();
      for (const foreignKey of foreignKeys) {
        const rows = groups.get(foreignKey.id) ?? [];
        rows.push(foreignKey);
        groups.set(foreignKey.id, rows);
      }
      for (const [id, rows] of groups) {
        expect(
          [...rows]
            .sort((a, b) => a.seq - b.seq)
            .slice(0, 2)
            .map(({ from }) => from),
          `${table} foreign key ${id}`,
        ).toEqual(["project_id", "project_version_id"]);
      }
    }

    for (const index of SCHEMA_INDEXES) {
      const sql = db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?",
        )
        .pluck()
        .get(index) as string;
      if (index === "ix_workspace_platform_project_binding_platform") {
        expect(sql, index).toMatch(
          /\(platform_project_id, workspace_project_id\)/u,
        );
        continue;
      }
      expect(sql, index).toMatch(/\(project_id, project_version_id(?:,|\))/u);
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("isolates identical ids across projects, versions, and project-level rows", () => {
    const db = createDb();
    const scopes = [
      ["project-a", "version-a"],
      ["project-a", "version-b"],
      ["project-b", "version-a"],
      ["project-a", "@project"],
    ] as const;
    for (const [projectId, projectVersionId] of scopes) {
      insertGeneration(db, projectId, projectVersionId, "same-generation");
      db.prepare(
        `INSERT INTO findings
           (project_id, project_version_id, generation_id, finding_id,
            stable_key, raw, pulled_at)
         VALUES (?, ?, 'same-generation', 'same-finding', ?, '{}', 'now')`,
      ).run(projectId, projectVersionId, `${projectId}/${projectVersionId}`);
    }

    expect(
      db
        .prepare(
          `SELECT stable_key FROM findings
            WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
        )
        .pluck()
        .all("project-a", "version-a", "same-generation"),
    ).toEqual(["project-a/version-a"]);
    expect(db.prepare("SELECT count(*) FROM findings").pluck().get()).toBe(4);
  });

  it("keeps staging pages invisible and publishes a multi-kind generation atomically", () => {
    const db = createDb();
    insertGeneration(db, "project-a", "version-a", "old");
    insertGeneration(db, "project-a", "version-a", "next", "staging");
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows)
       VALUES ('project-a', 'version-a', ?, 'old', 'next', 7, 'opaque', 1, 1)`,
    ).run("finding");
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          staging_generation_id, base_revision, staged_pages, staged_rows)
       VALUES ('project-a', 'version-a', ?, 'old', 'next', 3, 1, 1)`,
    ).run("sbomComponent");
    for (const [generation, finding] of [
      ["old", "visible-old"],
      ["next", "hidden-next"],
    ]) {
      db.prepare(
        `INSERT INTO findings
           (project_id, project_version_id, generation_id, finding_id, stable_key, raw, pulled_at)
         VALUES ('project-a', 'version-a', ?, ?, ?, '{}', 'now')`,
      ).run(generation, finding, finding);
    }

    const acceptedFindings = () =>
      db
        .prepare(
          `SELECT f.finding_id
             FROM findings f
             JOIN sync_state s
               ON s.project_id = f.project_id
              AND s.project_version_id = f.project_version_id
              AND s.entity_kind = 'finding'
              AND s.accepted_generation_id = f.generation_id
            WHERE f.project_id = 'project-a' AND f.project_version_id = 'version-a'`,
        )
        .pluck()
        .all();

    expect(acceptedFindings()).toEqual(["visible-old"]);
    expect(() =>
      db.transaction(() => {
        db.prepare(
          `UPDATE sync_state
              SET accepted_generation_id = 'next', base_revision = base_revision + 1
            WHERE project_id = 'project-a' AND project_version_id = 'version-a'`,
        ).run();
        throw new Error("failed publication");
      })(),
    ).toThrow("failed publication");
    expect(acceptedFindings()).toEqual(["visible-old"]);

    db.transaction(() => {
      db.prepare(
        `UPDATE sync_state
            SET accepted_generation_id = staging_generation_id,
                staging_generation_id = NULL,
                base_revision = base_revision + 1,
                staging_continuation = NULL,
                staged_pages = 0,
                staged_rows = 0,
                last_pull = 'now',
                error = NULL
          WHERE project_id = 'project-a' AND project_version_id = 'version-a'`,
      ).run();
      db.prepare(
        `UPDATE pull_generation
            SET status = 'accepted', accepted_at = 'now', completed_at = 'now'
          WHERE project_id = 'project-a' AND project_version_id = 'version-a'
            AND generation_id = 'next'`,
      ).run();
    })();

    expect(acceptedFindings()).toEqual(["hidden-next"]);
    expect(
      db
        .prepare(
          `SELECT entity_kind, base_revision, staging_generation_id
             FROM sync_state ORDER BY entity_kind`,
        )
        .all(),
    ).toEqual([
      { entity_kind: "finding", base_revision: 8, staging_generation_id: null },
      {
        entity_kind: "sbomComponent",
        base_revision: 4,
        staging_generation_id: null,
      },
    ]);
  });

  it("advances one scoped entity base/id row and revision with content CAS", () => {
    const db = createDb();
    insertGeneration(db, "project-a", "version-a", "accepted");
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id, base_revision)
       VALUES ('project-a', 'version-a', 'threat', 'accepted', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO base_snapshot
         (project_id, project_version_id, entity_kind, generation_id, entity_key,
          remote_id, payload, content_hash, pulled_at)
       VALUES ('project-a', 'version-a', 'threat', 'accepted', ?, ?, '{}', ?, 'old')`,
    ).run("THREAT-1", "remote-1", "hash-old");
    db.prepare(
      `INSERT INTO id_map
         (project_id, project_version_id, entity_kind, generation_id, entity_key,
          remote_id, pulled_at)
       VALUES ('project-a', 'version-a', 'threat', 'accepted', ?, ?, 'old')`,
    ).run("THREAT-1", "remote-1");

    const advance = db.transaction(
      (expectedRevision: number, expectedHash: string) => {
        const base = db
          .prepare(
            `SELECT content_hash FROM base_snapshot
            WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
              AND generation_id = ? AND entity_key = ?`,
          )
          .get("project-a", "version-a", "threat", "accepted", "THREAT-1") as {
          content_hash: string;
        };
        const changed = db
          .prepare(
            `UPDATE sync_state SET base_revision = base_revision + 1
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND accepted_generation_id = ? AND base_revision = ?`,
          )
          .run(
            "project-a",
            "version-a",
            "threat",
            "accepted",
            expectedRevision,
          );
        if (changed.changes !== 1 || base.content_hash !== expectedHash) {
          throw new Error("stale base fence");
        }
        db.prepare(
          `UPDATE base_snapshot SET payload = '{"updated":true}', content_hash = 'hash-new', pulled_at = 'new'
          WHERE project_id = 'project-a' AND project_version_id = 'version-a'
            AND entity_kind = 'threat' AND generation_id = 'accepted' AND entity_key = 'THREAT-1'`,
        ).run();
        db.prepare(
          `INSERT INTO push_log
           (project_id, project_version_id, id, run_id, base_generation_id,
            base_revision, expected_base_content_hash, entity_kind, entity_key,
            op, status, created_at, applied_at)
         VALUES ('project-a', 'version-a', 1, 'run-1', 'accepted', 10,
                 'hash-old', 'threat', 'THREAT-1', 'update', 'applied', 'now', 'now')`,
        ).run();
      },
    );

    expect(() => advance(9, "hash-old")).toThrow("stale base fence");
    expect(() => advance(10, "wrong-hash")).toThrow("stale base fence");
    advance(10, "hash-old");
    expect(
      db
        .prepare(
          `SELECT base_revision, accepted_generation_id FROM sync_state
            WHERE project_id = 'project-a' AND project_version_id = 'version-a'
              AND entity_kind = 'threat'`,
        )
        .get(),
    ).toEqual({ base_revision: 11, accepted_generation_id: "accepted" });
    expect(db.prepare("SELECT count(*) FROM push_log").pluck().get()).toBe(1);
  });

  it("enforces scoped foreign keys and closed local-state constraints", () => {
    const db = createDb();
    insertGeneration(db, "project-a", "version-a", "g");
    insertGeneration(db, "project-b", "version-a", "g");
    db.prepare(
      `INSERT INTO document
         (project_id, project_version_id, document_id, sha256, name, path,
          doc_kind, mime_type, bytes, uploaded_at, indexed_at)
       VALUES ('project-a', 'version-a', 'doc', 'sha', 'doc.pdf', 'documents/doc.pdf',
               'datasheet', 'application/pdf', 1, 'now', 'now')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO document_extraction
           (project_id, project_version_id, extraction_id, document_id, field,
            source_ref, locator_kind, status, extracted_at)
         VALUES ('project-b', 'version-a', 'x', 'doc', 'mpn', 'ref', 'pdf', 'proposal', 'now')`,
        )
        .run(),
    ).toThrow(/foreign key constraint failed/i);
    expect(() =>
      db
        .prepare(
          `INSERT INTO hbom_cells
           (project_id, project_version_id, part_key, field, confidence, state,
            file_sha256, indexed_at)
         VALUES ('project-a', 'version-a', 'part', 'mpn', 1.1, 'proposal', 'sha', 'now')`,
        )
        .run(),
    ).toThrow(/check constraint failed/i);
    expect(() =>
      db
        .prepare(
          `INSERT INTO overlay_index
           (project_id, project_version_id, entity_kind, stable_key, file_path,
            file_sha256, local_state, indexed_at)
         VALUES ('project-a', 'version-a', 'vexDecision', 'key', 'f.yaml', 'sha', 'ambiguous', 'now')`,
        )
        .run(),
    ).toThrow(/check constraint failed/i);
    expect(() =>
      db
        .prepare(
          `INSERT INTO findings
           (project_id, project_version_id, generation_id, finding_id, stable_key,
            in_kev, raw, pulled_at)
         VALUES ('project-a', 'version-a', 'g', 'finding', 'key', 2, '{}', 'now')`,
        )
        .run(),
    ).toThrow(/check constraint failed/i);
  });

  it("uses the frozen policy, overlay, timeline, and document access indexes", () => {
    const db = createDb();
    const scope = ["project-a", "version-a", "g"] as const;
    const expectations: [string, string, (string | number | null)[]][] = [
      [
        `SELECT finding_id FROM findings WHERE project_id = ? AND project_version_id = ?
          AND generation_id = ? AND vuln_in_dataset = 1 AND reachability_score > 0.5`,
        "ix_findings_policy_dataset",
        [...scope],
      ],
      [
        `SELECT finding_id FROM findings WHERE project_id = ? AND project_version_id = ?
          AND generation_id = ? AND band = 'P1'`,
        "ix_findings_policy_band",
        [...scope],
      ],
      [
        `SELECT finding_id FROM findings WHERE project_id = ? AND project_version_id = ?
          AND generation_id = ? AND violation_count > 0`,
        "ix_findings_policy_flags",
        [...scope],
      ],
      [
        `SELECT finding_id FROM finding_cwes WHERE project_id = ? AND project_version_id = ?
          AND generation_id = ? AND cwe = 'CWE-79'`,
        "ix_finding_cwes_selector",
        [...scope],
      ],
      [
        `SELECT stable_key FROM overlay_index WHERE project_id = ? AND project_version_id = ?
          AND entity_kind = 'vexDecision' AND local_state = 'conflict'`,
        "ix_overlay_project_state",
        scope.slice(0, 2),
      ],
      [
        `SELECT result_id FROM verification_results WHERE project_id = ? AND project_version_id = ?
          AND generation_id = ? AND requirement_key = 'REQ-1' AND tier = 'static'
          AND is_latest = 1 ORDER BY executed_at DESC`,
        "ix_verification_results_matrix",
        [...scope],
      ],
      [
        `SELECT extraction_id FROM document_extraction WHERE project_id = ? AND project_version_id = ?
          AND field = 'mpn' AND value = 'chip' AND status = 'proposal'`,
        "ix_document_extraction_search",
        scope.slice(0, 2),
      ],
    ];
    for (const [sql, index, params] of expectations) {
      expect(planDetails(db, sql, ...params), index).toContain(index);
    }
  });

  it("keeps document view rows scoped and attestation trust relational", () => {
    const db = createDb();
    insertGeneration(db, "project-a", "version-a", "g");
    db.prepare(
      `INSERT INTO verification_runs
         (project_id, project_version_id, generation_id, run_id, tier, matrix_col,
          kind, status, firmware_digest, raw, synced_at)
       VALUES ('project-a', 'version-a', 'g', 'run', 'tier1', 'hil', 'bench',
               'completed', 'firmware-good', '{}', 'now')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO attestations
           (project_id, project_version_id, generation_id, attestation_id, run_id,
            format, subject_digest, payload, signature_verified, subject_matches_run,
            verified, created_at, pulled_at)
         VALUES ('project-a', 'version-a', 'g', 'att', 'run', 'in-toto',
                 'firmware-bad', '{}', 1, 0, 1, 'now', 'now')`,
        )
        .run(),
    ).toThrow(/check constraint failed/i);

    db.prepare(
      `INSERT INTO attestations
         (project_id, project_version_id, generation_id, attestation_id, run_id,
          format, subject_digest, payload, signature_verified, subject_matches_run,
          verified, created_at, pulled_at)
       VALUES ('project-a', 'version-a', 'g', 'att', 'run', 'in-toto',
               'firmware-good', '{}', 1, 1, 1, 'now', 'now')`,
    ).run();

    for (const [kind, id] of [
      ["datasheet", "visible"],
      ["regulatory", "hidden"],
    ]) {
      db.prepare(
        `INSERT INTO document
           (project_id, project_version_id, document_id, sha256, name, path,
            doc_kind, mime_type, bytes, uploaded_at, indexed_at)
         VALUES ('project-a', 'version-a', ?, ?, ?, ?, ?, 'application/pdf', 1, 'now', 'now')`,
      ).run(id, `sha-${id}`, `${id}.pdf`, `documents/${id}.pdf`, kind);
    }
    expect(
      db
        .prepare(
          `SELECT project_id, project_version_id, document_id FROM hbom_docs
            WHERE project_id = 'project-a' AND project_version_id = 'version-a'`,
        )
        .all(),
    ).toEqual([
      {
        project_id: "project-a",
        project_version_id: "version-a",
        document_id: "visible",
      },
    ]);
  });

  it("proves deterministic index plans for representative downstream pages", () => {
    const db = createDb();
    insertGeneration(db, "project-a", "version-a", "g");
    db.exec(`
      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 4000
      )
      INSERT INTO findings (
        project_id, project_version_id, generation_id, finding_id, stable_key,
        finding_type, severity, risk_score, band, epss_score, in_kev,
        vuln_in_dataset, reachability_score, warning_count, violation_count,
        raw, pulled_at
      )
      SELECT 'project-a', 'version-a', 'g', 'finding-' || n, 'stable-' || n,
             'cve', CASE n % 4 WHEN 0 THEN 'critical' WHEN 1 THEN 'high'
                                  WHEN 2 THEN 'medium' ELSE 'low' END,
             n / 40.0, CASE WHEN n % 10 = 0 THEN 'P1' ELSE 'P4' END,
             n / 4000.0, n % 2, CASE WHEN n % 3 = 0 THEN NULL ELSE n % 2 END,
             n % 100, n % 3, n % 5, '{}', '2026-08-12'
        FROM seq;

      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 10000
      )
      INSERT INTO sbom_components (
        project_id, project_version_id, generation_id, component_id,
        component_key, purl, name, raw, pulled_at
      )
      SELECT 'project-a', 'version-a', 'g', 'component-' || n, 'key-' || n,
             'pkg:generic/component-' || n || '@1', 'component-' || n,
             '{}', '2026-08-12'
        FROM seq;

      WITH RECURSIVE req(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM req WHERE n < 5000
      ), tiers(tier) AS (VALUES('static'),('emulation'),('hil'),('manual'))
      INSERT INTO verification_results (
        project_id, project_version_id, generation_id, result_id,
        requirement_key, tier, status, executed_at, is_latest, raw, pulled_at
      )
      SELECT 'project-a', 'version-a', 'g', 'result-' || n || '-' || tier,
             'REQ-' || n, tier,
             CASE WHEN n % 11 = 0 THEN 'failed' ELSE 'verified' END,
             printf('2026-08-12T00:%02d:00Z', n % 60), 1, '{}', '2026-08-12'
        FROM req CROSS JOIN tiers;

      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 5000
      )
      INSERT INTO verification_runs (
        project_id, project_version_id, generation_id, run_id, tier, matrix_col,
        kind, status, started_at, raw, synced_at
      )
      SELECT 'project-a', 'version-a', 'g', 'run-' || n, 'tier1', 'hil',
             'bench', CASE WHEN n % 7 = 0 THEN 'failed' ELSE 'completed' END,
             printf('2026-08-12T%02d:%02d:00Z', (n / 60) % 24, n % 60),
             '{}', '2026-08-12'
        FROM seq;

      INSERT INTO document (
        project_id, project_version_id, document_id, sha256, name, path,
        doc_kind, mime_type, bytes, uploaded_at, indexed_at
      ) VALUES (
        'project-a', 'version-a', 'doc-perf', 'sha-perf', 'perf.pdf',
        'product-security/documents/sha-perf-perf.pdf', 'datasheet',
        'application/pdf', 10000, '2026-08-12', '2026-08-12'
      );

      WITH RECURSIVE seq(n) AS (
        VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 10000
      )
      INSERT INTO document_extraction (
        project_id, project_version_id, extraction_id, document_id, field,
        value, source_ref, locator_kind, page, status, extracted_at
      )
      SELECT 'project-a', 'version-a', 'extract-' || n, 'doc-perf', 'mpn',
             'value-' || n, 'doc:sha-perf#page=' || ((n % 20) + 1), 'pdf',
             (n % 20) + 1, 'proposal', '2026-08-12'
        FROM seq;
    `);

    const pages: [string, string, (string | number)[]][] = [
      [
        "ix_findings_risk",
        `SELECT finding_id FROM findings
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
          ORDER BY risk_score DESC, finding_id LIMIT 200`,
        ["project-a", "version-a", "g"],
      ],
      [
        "ix_sbom_name",
        `SELECT component_id FROM sbom_components
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
            AND name >= ? COLLATE NOCASE
          ORDER BY name COLLATE NOCASE, component_group COLLATE NOCASE,
                   version, component_id LIMIT 200`,
        ["project-a", "version-a", "g", "component-5000"],
      ],
      [
        "ix_verification_results_matrix",
        `SELECT result_id FROM verification_results
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
            AND requirement_key = ? AND tier = ? AND is_latest = 1
          ORDER BY executed_at DESC, result_id LIMIT 200`,
        ["project-a", "version-a", "g", "REQ-2500", "hil"],
      ],
      [
        "ix_verification_runs_recent",
        `SELECT run_id FROM verification_runs
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
          ORDER BY started_at DESC, run_id LIMIT 200`,
        ["project-a", "version-a", "g"],
      ],
      [
        "ix_document_extraction_search",
        `SELECT document_id, extraction_id FROM document_extraction
          WHERE project_id = ? AND project_version_id = ?
            AND field = ? COLLATE NOCASE AND value >= ? COLLATE NOCASE
            AND status = ?
          ORDER BY value COLLATE NOCASE, document_id, extraction_id LIMIT 200`,
        ["project-a", "version-a", "mpn", "value-5000", "proposal"],
      ],
    ];

    for (const [indexName, sql, params] of pages) {
      expect(planDetails(db, sql, ...params), indexName).toContain(indexName);
      const rows = db.prepare(sql).all(...params);
      expect(rows.length, indexName).toBeGreaterThan(0);
    }
  });
});
