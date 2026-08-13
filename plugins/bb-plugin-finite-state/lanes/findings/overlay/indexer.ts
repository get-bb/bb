import type Database from "better-sqlite3";

import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { canonicalJson } from "../../sync/serialize/canonical.js";
import { PROJECT_LEVEL_VERSION_ID } from "../../../lib/store/index.js";
import { resolveFinding, type FindingResolution } from "../stable-key/index.js";
import { readOverlayFiles, type OverlayParseError, type ParsedOverlayFile } from "./reader.js";
import {
  stableKeyFor,
  type OverlayState,
  type TriageDecisionV1,
  type TriageOverlayV1,
  type VexTuple,
} from "./schema.js";

export interface OverlayIndexReport {
  indexed: number;
  errors: OverlayParseError[];
}

interface ProjectVersionRow {
  project_version_id: string;
}

interface PreservedProjectionRow {
  project_id: string;
  project_version_id: string;
  stable_key: string;
  drift_state: "reattached_noop" | "reapply" | "stale" | "orphaned" | "conflict" | "needs_completion" | null;
  policy_warning_count: number;
  policy_violation_count: number;
}

interface PreservedProjection {
  driftState: PreservedProjectionRow["drift_state"];
  policyWarningCount: number;
  policyViolationCount: number;
}

function projectVersions(db: Database.Database, project: string): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT project_version_id
       FROM sync_state
      WHERE project_id = ?
        AND entity_kind = 'finding'
        AND accepted_generation_id IS NOT NULL
      ORDER BY project_version_id`,
  ).all(project) as ProjectVersionRow[];
  return rows.length === 0 ? [PROJECT_LEVEL_VERSION_ID] : rows.map((row) => row.project_version_id);
}

function tuple(decision: TriageDecisionV1): VexTuple {
  return {
    status: decision.status,
    justification: decision.justification,
    response: decision.response,
    reason: decision.reason,
  };
}

function tupleKey(value: VexTuple | null): string {
  return canonicalJson(value ?? { status: null, justification: null, response: null, reason: null });
}

function cachedEnum<T extends string>(value: string | null, vocabulary: readonly T[], field: string): T | null {
  if (value === null) return null;
  const parsed = vocabulary.find((candidate) => candidate === value);
  if (parsed === undefined) throw new Error(`Cached finding ${field} is outside the frozen VEX vocabulary`);
  return parsed;
}

function remoteTuples(resolution: FindingResolution): VexTuple[] {
  if (resolution.state !== "resolved") return [];
  return resolution.rows.map((row) => ({
    status: cachedEnum<VexStatus>(row.vexStatus, VEX_STATUSES, "vex_status"),
    justification: cachedEnum<VexJustification>(row.vexJustification, VEX_JUSTIFICATIONS, "vex_justification"),
    response: cachedEnum<VexResponse>(row.vexResponse, VEX_RESPONSES, "vex_response"),
    reason: row.vexReason,
  }));
}

function stateFor(decision: TriageDecisionV1, resolution: FindingResolution | null): OverlayState {
  if (resolution?.state === "stale") return "stale";
  if (resolution?.state === "orphaned") return "orphaned";
  if (resolution?.state === "resolved" && decision.pin === "exact_version" && resolution.versionChanged) return "stale";
  const local = tupleKey(tuple(decision));
  const base = tupleKey(decision.sync.base);
  if (resolution === null) return local === base ? "pushed" : "dirty";
  const remote = remoteTuples(resolution).map(tupleKey);
  if (remote.length > 0 && remote.every((value) => value === local)) return "pushed";
  if (local !== base && remote.some((value) => value !== base)) return "conflict";
  return "dirty";
}

function matchTier(resolution: FindingResolution | null): "purl" | "nvg" | "ng" | null {
  if (resolution?.state !== "resolved") return null;
  return resolution.tier === 1 ? "purl" : resolution.tier === 2 ? "nvg" : "ng";
}

function resolutionFor(
  db: Database.Database,
  overlay: TriageOverlayV1,
  cve: string,
  decision: TriageDecisionV1,
  projectVersionId: string,
): FindingResolution | null {
  if (projectVersionId === PROJECT_LEVEL_VERSION_ID) return null;
  return resolveFinding(db, {
    schema: "fs-finding-key/v1",
    project: overlay.project,
    cve,
    ...overlay.component,
  }, projectVersionId, decision.pin);
}

const INSERT = `INSERT INTO overlay_index
  (project_id, project_version_id, entity_kind, stable_key, component_key, cve,
   file_path, file_sha256, vex_status, vex_response, vex_justification, vex_reason,
   pin, provenance_by, provenance_at, evidence, sync_base, pushed_at, local_state,
   drift_state, match_tier, policy_warning_count, policy_violation_count, indexed_at)
 VALUES (?, ?, 'vexDecision', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function projectionKey(project: string, projectVersionId: string, stableKey: string): string {
  return JSON.stringify([project, projectVersionId, stableKey]);
}

function preservedProjections(db: Database.Database): Map<string, PreservedProjection> {
  const rows = db.prepare(
    `SELECT project_id, project_version_id, stable_key, drift_state,
            policy_warning_count, policy_violation_count
       FROM overlay_index
      WHERE entity_kind = 'vexDecision'`,
  ).all() as PreservedProjectionRow[];
  return new Map(rows.map((row) => [
    projectionKey(row.project_id, row.project_version_id, row.stable_key),
    {
      driftState: row.drift_state,
      policyWarningCount: row.policy_warning_count,
      policyViolationCount: row.policy_violation_count,
    },
  ]));
}

function indexFile(
  db: Database.Database,
  parsed: ParsedOverlayFile,
  preserved: ReadonlyMap<string, PreservedProjection>,
  indexedAt: string,
): number {
  const insert = db.prepare(INSERT);
  let indexed = 0;
  for (const projectVersionId of projectVersions(db, parsed.overlay.project)) {
    for (const [cve, decision] of Object.entries(parsed.overlay.decisions)) {
      const resolution = resolutionFor(db, parsed.overlay, cve, decision, projectVersionId);
      const stableKey = stableKeyFor(parsed.overlay.project, parsed.overlay.component, cve);
      const prior = preserved.get(projectionKey(parsed.overlay.project, projectVersionId, stableKey));
      insert.run(
        parsed.overlay.project,
        projectVersionId,
        stableKey,
        cve,
        parsed.file,
        parsed.sha256,
        decision.status,
        decision.response,
        decision.justification,
        decision.reason,
        decision.pin,
        decision.provenance.by,
        decision.provenance.at,
        decision.provenance.evidence,
        decision.sync.base === null ? null : canonicalJson(decision.sync.base),
        decision.sync.pushed_at,
        stateFor(decision, resolution),
        prior?.driftState ?? null,
        matchTier(resolution),
        prior?.policyWarningCount ?? 0,
        prior?.policyViolationCount ?? 0,
        indexedAt,
      );
      indexed += 1;
    }
  }
  return indexed;
}

export async function rebuildOverlayIndex(db: Database.Database, root: string): Promise<OverlayIndexReport> {
  const parsed = await readOverlayFiles(root);
  const indexedAt = new Date().toISOString();
  const indexed = db.transaction(() => {
    const preserved = preservedProjections(db);
    db.prepare("DELETE FROM overlay_index WHERE entity_kind = 'vexDecision'").run();
    return parsed.files.reduce(
      (count, file) => count + indexFile(db, file, preserved, indexedAt),
      0,
    );
  })();
  return { indexed, errors: parsed.errors };
}
