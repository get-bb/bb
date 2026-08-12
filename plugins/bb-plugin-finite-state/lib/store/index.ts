import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { MIGRATIONS } from "./schema.js";

export const PROJECT_LEVEL_VERSION_ID = "@project" as const;

export function toStorageProjectVersionId(
  projectVersionId: string | null,
): string {
  if (projectVersionId === null) return PROJECT_LEVEL_VERSION_ID;
  if (projectVersionId.length === 0) {
    throw new Error("projectVersionId must be non-empty or null");
  }
  if (projectVersionId === PROJECT_LEVEL_VERSION_ID) {
    throw new Error("@project is reserved for backend storage");
  }
  return projectVersionId;
}

export function fromStorageProjectVersionId(
  projectVersionId: string,
): string | null {
  if (projectVersionId.length === 0) {
    throw new Error("stored project_version_id must be non-empty");
  }
  return projectVersionId === PROJECT_LEVEL_VERSION_ID
    ? null
    : projectVersionId;
}

export interface Store {
  readonly db: Database.Database;
  tx<T>(fn: () => T): T;
}

const stores = new WeakMap<BbPluginApi, Store>();

export function openStore(bb: BbPluginApi): Store {
  const current = stores.get(bb);
  if (current) return current;

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  db.pragma("foreign_keys = ON");
  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  if (foreignKeys !== 1) {
    throw new Error("Finite State store requires SQLite foreign keys");
  }

  const store: Store = {
    db,
    tx<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
  stores.set(bb, store);
  return store;
}

export interface PullGenerationRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  status: "staging" | "accepted" | "superseded" | "failed" | "cancelled";
  requested_kinds_json: string;
  started_at: string;
  completed_at: string | null;
  accepted_at: string | null;
  error: string | null;
}

export interface SyncStateRow {
  project_id: string;
  project_version_id: string;
  entity_kind: string;
  accepted_generation_id: string | null;
  staging_generation_id: string | null;
  base_revision: number;
  staging_continuation: string | null;
  staged_pages: number;
  staged_rows: number;
  last_pull: string | null;
  error: string | null;
}

export interface PushLogRow {
  project_id: string;
  project_version_id: string;
  id: number;
  run_id: string;
  base_generation_id: string;
  base_revision: number;
  expected_base_content_hash: string | null;
  entity_kind: string;
  entity_key: string;
  op: "create" | "update" | "delete" | "noop" | "conflict";
  status: "pending" | "applied" | "failed" | "skipped";
  error: string | null;
  created_at: string;
  applied_at: string | null;
}

export interface BaseSnapshotRow {
  project_id: string;
  project_version_id: string;
  entity_kind: string;
  generation_id: string;
  entity_key: string;
  remote_id: string | null;
  payload: string;
  content_hash: string;
  pulled_at: string;
}

export interface IdMapRow {
  project_id: string;
  project_version_id: string;
  entity_kind: string;
  generation_id: string;
  entity_key: string;
  remote_id: string;
  pulled_at: string;
}

export interface EntityReviewStateRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  entity_kind: string;
  entity_key: string;
  remote_id: string;
  review_status: string | null;
  review_version: string;
  pulled_at: string;
}

export interface FindingRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  finding_id: string;
  stable_key: string;
  finding_type: string | null;
  cve: string | null;
  title: string | null;
  component_name: string | null;
  component_group: string | null;
  component_version: string | null;
  component_purl: string | null;
  severity: string | null;
  risk_score: number | null;
  band: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
  epss_score: number | null;
  epss_percentile: number | null;
  in_kev: 0 | 1;
  in_vc_kev: 0 | 1;
  has_exploit: 0 | 1;
  exploit_maturity: string | null;
  reachability_score: number | null;
  reachability_verdict: string | null;
  reachability_factors: string | null;
  vuln_in_dataset: 0 | 1 | null;
  cwes: string;
  warning_count: number;
  violation_count: number;
  location: string | null;
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  comments: string;
  first_seen: string | null;
  soft_deleted: 0 | 1;
  raw: string;
  pulled_at: string;
}

export interface FindingCweRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  finding_id: string;
  cwe: string;
  pulled_at: string;
}

export interface FindingActivityRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  finding_id: string;
  event_id: string;
  stable_key: string;
  actor: string | null;
  event_at: string;
  source: string | null;
  old_tuple: string | null;
  new_tuple: string | null;
  raw: string;
  pulled_at: string;
}

export interface OverlayIndexRow {
  project_id: string;
  project_version_id: string;
  entity_kind: string;
  stable_key: string;
  component_key: string | null;
  cve: string | null;
  file_path: string;
  file_sha256: string;
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  pin: "exact_version" | "any_version" | null;
  provenance_by: string | null;
  provenance_at: string | null;
  evidence: string | null;
  sync_base: string | null;
  pushed_at: string | null;
  local_state:
    | "dirty"
    | "pushed"
    | "conflict"
    | "stale"
    | "orphaned"
    | "needs_completion";
  drift_state:
    | "reattached_noop"
    | "reapply"
    | "stale"
    | "orphaned"
    | "conflict"
    | "needs_completion"
    | null;
  match_tier: "purl" | "nvg" | "ng" | null;
  policy_warning_count: number;
  policy_violation_count: number;
  indexed_at: string;
}

export interface TriageRunRow {
  project_id: string;
  project_version_id: string;
  run_id: string;
  source: "manual" | "policy" | "vendor_import" | "drift";
  dry_run: 0 | 1;
  status: "running" | "completed" | "partial" | "failed";
  input_digest: string | null;
  written: number;
  held: number;
  conflicts: number;
  skipped_existing: number;
  errors: number;
  report_json: string;
  created_at: string;
  finished_at: string | null;
}

export interface SbomComponentRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  component_id: string;
  component_key: string;
  purl: string | null;
  name: string;
  component_group: string | null;
  version: string | null;
  cpe: string | null;
  license: string | null;
  supplier: string | null;
  source: string | null;
  file_locations: string | null;
  is_stale: 0 | 1;
  raw: string;
  pulled_at: string;
}

export interface SbomVulnRollupRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  component_key: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  kev_count: number;
  max_epss: number | null;
  reachability_verdict: string;
  computed_at: string;
}

export interface HbomCellRow {
  project_id: string;
  project_version_id: string;
  part_key: string;
  field: string;
  value: string | null;
  provenance: string | null;
  source_ref: string | null;
  confidence: number | null;
  asserted_by: string | null;
  asserted_at: string | null;
  note: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  state: "verified" | "proposal" | "conflict" | "unknown" | "not_applicable";
  file_sha256: string;
  indexed_at: string;
}

export interface HbomCandidateRow {
  project_id: string;
  project_version_id: string;
  candidate_id: string;
  part_key: string;
  field: string;
  value: string | null;
  provenance: string;
  source_ref: string | null;
  confidence: number;
  asserted_by: string;
  asserted_at: string;
  status: "pending" | "accepted" | "rejected" | "superseded";
  indexed_at: string;
}

export interface StandardRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  standard_id: string;
  code: string;
  name: string;
  scope: string;
  review_status: string | null;
  review_version: string;
  raw: string;
  pulled_at: string;
}

export interface StandardsClauseRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  standard_id: string;
  clause_id: string;
  clause_code: string;
  section_path: string | null;
  parent_clause_id: string | null;
  title: string | null;
  body: string | null;
  review_status: string | null;
  review_version: string;
  raw: string;
  pulled_at: string;
}

export interface MethodologyProfileRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  profile_id: string;
  organization_id: string | null;
  scope: string;
  name: string;
  asset_properties: string;
  impact_dimensions: string;
  risk_scale: string;
  assurance_levels: string;
  ownership_labels: string;
  stride_map: string;
  review_version: string;
  raw: string;
  pulled_at: string;
}

export interface AttackPathRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  path_id: string;
  route_signature: string;
  name: string | null;
  threat_key: string | null;
  steps: string;
  edges: string | null;
  total_steps: number | null;
  zones_traversed: string | null;
  exploitability: string | null;
  review_status: string | null;
  review_version: string;
  raw: string;
  pulled_at: string;
}

export interface VerificationCheckRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  check_id: string;
  code: string;
  name: string;
  check_type: string;
  category: string | null;
  description: string | null;
  pass_criteria: string | null;
  fail_criteria: string | null;
  input_description: string | null;
  parameters: string | null;
  default_sla_days: number | null;
  deleted_at: string | null;
  review_status: string | null;
  review_version: string;
  raw: string;
  pulled_at: string;
}

export interface RequirementCheckMappingRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  requirement_key: string;
  check_id: string;
  is_required: 0 | 1;
  coverage_level: string | null;
  suppressed: 0 | 1;
  raw: string;
  pulled_at: string;
}

export interface RequirementRollupRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  requirement_key: string;
  verification_status: string | null;
  total_checks: number;
  verified_checks: number;
  failed_checks: number;
  error_checks: number;
  inconclusive_checks: number;
  running_checks: number;
  pending_checks: number;
  skipped_checks: number;
  last_run_at: string | null;
  pulled_at: string;
}

export interface VerificationRunRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  run_id: string;
  tier: "tier0" | "tier1" | "tier2" | "tier3" | "tier4";
  matrix_col: "static" | "emulation" | "hil" | "manual";
  kind: string;
  trigger: string | null;
  host_id: string | null;
  thread_id: string | null;
  target: string | null;
  config: string | null;
  status: "queued" | "running" | "completed" | "failed" | "timeout";
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  firmware_digest: string | null;
  job_id: string | null;
  log_locator: string | null;
  log_cursor: string | null;
  raw: string;
  synced_at: string;
}

export interface VerificationResultRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  result_id: string;
  run_id: string | null;
  requirement_key: string | null;
  check_id: string | null;
  tier: "static" | "emulation" | "hil" | "manual";
  status:
    | "verified"
    | "failed"
    | "error"
    | "inconclusive"
    | "running"
    | "pending"
    | "skipped";
  outcome: string | null;
  confidence: string | null;
  evidence_summary: string | null;
  result_data: string | null;
  measured: string | null;
  executed_at: string | null;
  executed_by: string | null;
  failure_reason: string | null;
  remediation_suggestion: string | null;
  fs_version_id: string | null;
  fs_version_name: string | null;
  is_latest: 0 | 1;
  superseded_by: string | null;
  sla_status: string | null;
  mapping_state: "mapped" | "unmapped";
  raw: string;
  pulled_at: string;
}

export interface VerificationArtifactRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  artifact_id: string;
  run_id: string;
  result_id: string | null;
  name: string;
  kind: string;
  locator: string;
  media_type: string | null;
  sha256: string | null;
  bytes: number | null;
  created_at: string | null;
  pulled_at: string;
}

export interface AttestationRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  attestation_id: string;
  run_id: string;
  format: string;
  predicate_type: string | null;
  subject_digest: string;
  evidence_digest: string | null;
  verdict: string | null;
  requirement_ids: string | null;
  check_ids: string | null;
  result_refs: string | null;
  signer_identity: string | null;
  rekor_uuid: string | null;
  envelope_locator: string | null;
  payload: string;
  signature_verified: 0 | 1;
  subject_matches_run: 0 | 1;
  verified: 0 | 1;
  created_at: string;
  pulled_at: string;
}

export interface FirmwareMountRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  source: "api" | "standalone_unpack";
  state:
    | "not_materialized"
    | "hashing"
    | "unpacking"
    | "validating"
    | "ingesting"
    | "ready"
    | "ready_with_gaps"
    | "metadata_only"
    | "stale"
    | "error";
  scan_id: string | null;
  input_sha256: string | null;
  artifact_hash: string | null;
  root_path: string;
  file_count: number;
  materialized_files: number;
  error_count: number;
  admin_bytes_ok: 0 | 1 | null;
  message: string | null;
  materialized_at: string | null;
  pulled_at: string;
}

export interface DocumentRow {
  project_id: string;
  project_version_id: string;
  document_id: string;
  sha256: string;
  name: string;
  path: string;
  doc_kind:
    | "datasheet"
    | "bom"
    | "schematic"
    | "spec"
    | "regulatory"
    | "register_map"
    | "other";
  mime_type: string;
  bytes: number;
  withdrawn: 0 | 1;
  needs_ocr: 0 | 1;
  uploaded_at: string;
  analyzed_by: string | null;
  analyzed_at: string | null;
  cells_extracted: number;
  indexed_at: string;
}

export interface DocumentExtractionRow {
  project_id: string;
  project_version_id: string;
  extraction_id: string;
  document_id: string;
  field: string;
  value: string | null;
  confidence: number | null;
  source_ref: string;
  locator_kind: "pdf" | "sheet" | "text";
  page: number | null;
  bbox: string | null;
  sheet: string | null;
  cell: string | null;
  line_start: number | null;
  line_end: number | null;
  target_surface: string | null;
  target_id: string | null;
  target_field: string | null;
  status: "proposal" | "accepted" | "rejected" | "withdrawn";
  extracted_by: string | null;
  extracted_at: string;
  raw: string | null;
}

export interface HbomDocRow {
  project_id: string;
  project_version_id: string;
  document_id: string;
  sha256: string;
  name: string;
  path: string;
  doc_kind: "datasheet" | "bom" | "schematic";
  mime_type: string;
  bytes: number;
  withdrawn: 0 | 1;
  needs_ocr: 0 | 1;
  uploaded_at: string;
  analyzed_by: string | null;
  analyzed_at: string | null;
  cells_extracted: number;
  indexed_at: string;
}
