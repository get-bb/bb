import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type Database from "better-sqlite3";

import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { identityFromStableKey, stripVexProvenance } from "../bulk/readback.js";
import { parseOverlayText } from "../overlay/reader.js";
import type { TriageOverlayV1, VexTuple } from "../overlay/schema.js";
import { resolveFinding, type FindingResolution, type Pin } from "../stable-key/index.js";
import {
  boundedDriftLimit,
  driftTotals,
  type DriftItem,
  type DriftReport,
  type DriftState,
} from "./report.js";

interface DriftRow {
  project_id: string;
  stable_key: string;
  file_path: string;
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  pin: string | null;
  sync_base: string | null;
  local_state: string;
}

interface PersistedDriftRow {
  stable_key: string;
  drift_state: DriftState;
  match_tier: "purl" | "nvg" | "ng" | null;
}

interface DriftRunRow {
  run_id: string;
  report_json: string;
  created_at: string;
}

interface PersistedDriftSummary {
  totals: Record<DriftState, number>;
  versions: Record<string, { previous?: string; current?: string }>;
}

export interface DriftDeps {
  db: Database.Database;
  root: string;
  projectId: string;
  limit?: number;
}

export interface DriftReportDeps {
  db: Database.Database;
  projectId: string;
  cursor?: string | null;
  limit?: number;
}

export class DriftProjectionError extends Error {
  readonly code = "DRIFT_OVERLAY_DELETED_REINDEX_REQUIRED" as const;

  constructor(readonly file: string, options?: ErrorOptions) {
    super(`Authored overlay ${file} was deleted after indexing; rebuild the overlay index before refreshing drift`, options);
    this.name = "DriftProjectionError";
  }
}

function enumOrNull<T extends string>(value: string | null, values: readonly T[], field: string): T | null {
  if (value === null) return null;
  const parsed = values.find((candidate) => candidate === value);
  if (parsed === undefined) throw new Error(`Overlay ${field} is outside the frozen VEX vocabulary`);
  return parsed;
}

function tuple(row: DriftRow): VexTuple {
  return {
    status: enumOrNull<VexStatus>(row.vex_status, VEX_STATUSES, "vex_status"),
    response: enumOrNull<VexResponse>(row.vex_response, VEX_RESPONSES, "vex_response"),
    justification: enumOrNull<VexJustification>(row.vex_justification, VEX_JUSTIFICATIONS, "vex_justification"),
    reason: row.vex_reason,
  };
}

function baseTuple(serialized: string | null): VexTuple | null {
  if (serialized === null) return null;
  const value: unknown = JSON.parse(serialized);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Overlay sync_base is not a VEX tuple");
  }
  const raw = value as Record<string, unknown>;
  return {
    status: typeof raw["status"] === "string" ? enumOrNull(raw["status"], VEX_STATUSES, "sync_base.status") : null,
    response: typeof raw["response"] === "string" ? enumOrNull(raw["response"], VEX_RESPONSES, "sync_base.response") : null,
    justification: typeof raw["justification"] === "string"
      ? enumOrNull(raw["justification"], VEX_JUSTIFICATIONS, "sync_base.justification")
      : null,
    reason: typeof raw["reason"] === "string" ? raw["reason"] : null,
  };
}

function tupleKey(value: VexTuple | null): string {
  const normalized = value ?? { status: null, justification: null, response: null, reason: null };
  return JSON.stringify([normalized.status, normalized.justification, normalized.response, normalized.reason]);
}

function remoteTuples(resolution: FindingResolution): VexTuple[] {
  if (resolution.state !== "resolved") return [];
  return resolution.rows.map((row) => ({
    status: enumOrNull<VexStatus>(row.vexStatus, VEX_STATUSES, "finding.vex_status"),
    response: enumOrNull<VexResponse>(row.vexResponse, VEX_RESPONSES, "finding.vex_response"),
    justification: enumOrNull<VexJustification>(row.vexJustification, VEX_JUSTIFICATIONS, "finding.vex_justification"),
    reason: stripVexProvenance(row.vexReason),
  }));
}

function versionOf(resolution: FindingResolution): string | undefined {
  const rows = resolution.state === "resolved"
    ? resolution.rows
    : resolution.state === "stale"
      ? resolution.candidates
      : [];
  return rows.map((row) => row.componentVersion).find((version): version is string => version !== null);
}

function rootPath(root: string): string {
  if (!isAbsolute(root)) throw new TypeError("Drift root must be absolute");
  return realpathSync(root);
}

function authoredComponents(
  db: Database.Database,
  root: string,
  projectId: string,
  pvId: string,
  files?: readonly string[],
): Map<string, TriageOverlayV1["component"]> {
  const selected = files ?? (db.prepare(
    `SELECT DISTINCT file_path
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'vexDecision'
      ORDER BY file_path ASC`,
  ).all(projectId, pvId) as Array<{ file_path: string }>).map((row) => row.file_path);
  const components = new Map<string, TriageOverlayV1["component"]>();
  for (const file of selected) {
    const absolute = resolve(root, file);
    let canonical: string;
    try {
      canonical = realpathSync(absolute);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        throw new DriftProjectionError(file, { cause: error });
      }
      throw error;
    }
    if (!absolute.startsWith(`${root}${sep}`) || canonical !== absolute) {
      throw new Error(`Overlay index path escapes the drift root: ${file}`);
    }
    let text: string;
    try {
      text = readFileSync(absolute, "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        throw new DriftProjectionError(file, { cause: error });
      }
      throw error;
    }
    const overlay = parseOverlayText(text, file);
    if (overlay.project !== projectId) throw new Error(`Overlay project differs from drift scope: ${file}`);
    components.set(file, overlay.component);
  }
  return components;
}

function identity(
  row: Pick<DriftRow, "project_id" | "stable_key" | "file_path">,
  components: ReadonlyMap<string, TriageOverlayV1["component"]>,
): { purl: string | null; name: string; group: string | null; version: string | null; cve: string } {
  const component = components.get(row.file_path);
  if (component === undefined) throw new Error(`Authored overlay identity is unavailable for ${row.file_path}`);
  const decoded = identityFromStableKey(row.project_id, row.stable_key);
  return { cve: decoded.identity.cve, ...component };
}

function staleReason(previousVersion: string | undefined, currentVersion: string | undefined): string {
  if (
    previousVersion !== undefined
    && currentVersion !== undefined
    && previousVersion !== currentVersion
    && previousVersion.toLocaleLowerCase("en-US") === currentVersion.toLocaleLowerCase("en-US")
  ) {
    return "Exact-version decision requires re-evaluation after the component version was re-cased";
  }
  return "Exact-version decision requires re-evaluation after the component version changed";
}

function classifyRow(
  db: Database.Database,
  row: DriftRow,
  pvId: string,
  components: ReadonlyMap<string, TriageOverlayV1["component"]>,
): DriftItem {
  if (row.local_state === "needs_completion") {
    return { stableKey: row.stable_key, state: "needs_completion", reason: "Local decision is incomplete and plan-blocked" };
  }
  const findingIdentity = identity(row, components);
  const pin: Pin = row.pin === "any_version" ? "any_version" : "exact_version";
  const resolution = resolveFinding(db, {
    schema: "fs-finding-key/v1",
    project: row.project_id,
    ...findingIdentity,
  }, pvId, pin);
  const previousVersion = findingIdentity.version ?? undefined;
  if (resolution.state === "stale" || (resolution.state === "resolved" && pin === "exact_version" && resolution.versionChanged)) {
    const currentVersion = versionOf(resolution);
    return {
      stableKey: row.stable_key,
      state: "stale",
      reason: staleReason(previousVersion, currentVersion),
      previousVersion,
      currentVersion,
    };
  }
  if (resolution.state === "orphaned") {
    return {
      stableKey: row.stable_key,
      state: "orphaned",
      reason: "Canonical resolver found no component/CVE match in the accepted generation",
      previousVersion,
    };
  }
  const localKey = tupleKey(tuple(row));
  const baseKey = tupleKey(baseTuple(row.sync_base));
  const remoteKeys = remoteTuples(resolution).map(tupleKey);
  const common = {
    stableKey: row.stable_key,
    tier: resolution.tier,
    previousVersion,
    currentVersion: versionOf(resolution),
  };
  if (remoteKeys.length > 0 && remoteKeys.every((remote) => remote === localKey)) {
    return { ...common, state: "reattached_noop", reason: "Resolved server VEX tuple already equals the local decision" };
  }
  const localChanged = localKey !== baseKey;
  const remoteChangedDifferently = remoteKeys.some((remote) => remote !== baseKey && remote !== localKey);
  if (localChanged && remoteChangedDifferently) {
    return { ...common, state: "conflict", reason: "Local and server VEX tuples both changed differently from the recorded base" };
  }
  return { ...common, state: "reapply", reason: "Canonical identity resolved but server carry-forward missed or differs" };
}

function parseSummary(serialized: string): PersistedDriftSummary {
  const value: unknown = JSON.parse(serialized);
  if (value === null || typeof value !== "object" || Array.isArray(value) || !("totals" in value)) {
    throw new Error("Persisted drift report is invalid");
  }
  const raw = (value as { totals: unknown }).totals;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Persisted drift totals are invalid");
  const totals = driftTotals();
  for (const state of Object.keys(totals) as DriftState[]) {
    const count = (raw as Record<string, unknown>)[state];
    if (!Number.isInteger(count) || (count as number) < 0) throw new Error(`Persisted drift total ${state} is invalid`);
    totals[state] = count as number;
  }
  const versionsValue = (value as Record<string, unknown>)["versions"];
  if (versionsValue === null || typeof versionsValue !== "object" || Array.isArray(versionsValue)) {
    throw new Error("Persisted drift versions are invalid");
  }
  const versions: PersistedDriftSummary["versions"] = {};
  for (const [stableKey, entryValue] of Object.entries(versionsValue)) {
    if (entryValue === null || typeof entryValue !== "object" || Array.isArray(entryValue)) {
      throw new Error(`Persisted drift version entry ${stableKey} is invalid`);
    }
    const entry = entryValue as Record<string, unknown>;
    if (entry["previous"] !== undefined && typeof entry["previous"] !== "string") {
      throw new Error(`Persisted previous version for ${stableKey} is invalid`);
    }
    if (entry["current"] !== undefined && typeof entry["current"] !== "string") {
      throw new Error(`Persisted current version for ${stableKey} is invalid`);
    }
    versions[stableKey] = {
      ...(typeof entry["previous"] === "string" ? { previous: entry["previous"] } : {}),
      ...(typeof entry["current"] === "string" ? { current: entry["current"] } : {}),
    };
  }
  return { totals, versions };
}

function persistedItem(
  row: PersistedDriftRow,
  version: PersistedDriftSummary["versions"][string] | undefined,
): DriftItem {
  const tier = row.match_tier === "purl" ? 1 : row.match_tier === "nvg" ? 2 : row.match_tier === "ng" ? 3 : undefined;
  if (row.drift_state === "stale") {
    return {
      stableKey: row.stable_key,
      state: row.drift_state,
      reason: staleReason(version?.previous, version?.current),
      ...(version?.previous === undefined ? {} : { previousVersion: version.previous }),
      ...(version?.current === undefined ? {} : { currentVersion: version.current }),
    };
  }
  const reason: Record<Exclude<DriftState, "stale">, string> = {
    reattached_noop: "Resolved server VEX tuple already equals the local decision",
    reapply: "Canonical identity resolved but server carry-forward missed or differs",
    orphaned: "Canonical resolver found no component/CVE match in the accepted generation",
    conflict: "Local and server VEX tuples both changed differently from the recorded base",
    needs_completion: "Local decision is incomplete and plan-blocked",
  };
  return {
    stableKey: row.stable_key,
    state: row.drift_state,
    ...(tier === undefined ? {} : { tier }),
    reason: reason[row.drift_state],
    ...(row.drift_state === "orphaned" && version?.previous !== undefined
      ? { previousVersion: version.previous }
      : {}),
  };
}

/** Serves a bounded, read-only page from the most recently refreshed drift projection. */
export function readDriftReport(deps: DriftReportDeps, pvId: string): DriftReport {
  const limit = boundedDriftLimit(deps.limit);
  const run = deps.db.prepare(
    `SELECT run_id, report_json, created_at
       FROM triage_runs
      WHERE project_id = ? AND project_version_id = ? AND source = 'drift' AND status = 'completed'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
  ).get(deps.projectId, pvId) as DriftRunRow | undefined;
  if (run === undefined) throw new Error("DRIFT_REFRESH_REQUIRED");
  const summary = parseSummary(run.report_json);
  const unclassified = deps.db.prepare(
    `SELECT COUNT(*) AS count
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'vexDecision'
        AND drift_state IS NULL`,
  ).get(deps.projectId, pvId) as { count: number };
  const rows = deps.db.prepare(
    `SELECT stable_key, drift_state, match_tier
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'vexDecision'
        AND drift_state IS NOT NULL AND (? IS NULL OR stable_key > ?)
      ORDER BY stable_key ASC
      LIMIT ?`,
  ).all(deps.projectId, pvId, deps.cursor ?? null, deps.cursor ?? null, limit + 1) as PersistedDriftRow[];
  const page = rows.slice(0, limit);
  return {
    pvId,
    runId: run.run_id,
    createdAt: run.created_at,
    unclassifiedCount: unclassified.count,
    totals: summary.totals,
    items: page.map((row) => persistedItem(row, summary.versions[row.stable_key])),
    nextCursor: rows.length > limit ? page.at(-1)?.stable_key ?? null : null,
  };
}

/** Explicitly refreshes and persists every drift classification exactly once. */
export function classifyDrift(deps: DriftDeps, pvId: string): DriftReport {
  const totals = driftTotals();
  const versions: PersistedDriftSummary["versions"] = {};
  const root = rootPath(deps.root);
  const components = authoredComponents(deps.db, root, deps.projectId, pvId);
  const update = deps.db.prepare(
    `UPDATE overlay_index
        SET drift_state = ?, match_tier = ?
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND stable_key = ?`,
  );
  const select = deps.db.prepare(
    `SELECT project_id, stable_key, file_path, vex_status, vex_response, vex_justification,
            vex_reason, pin, sync_base, local_state
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'vexDecision'
        AND (? IS NULL OR stable_key > ?)
      ORDER BY stable_key ASC
      LIMIT 200`,
  );
  const now = new Date().toISOString();
  deps.db.transaction(() => {
    let scanCursor: string | null = null;
    while (true) {
      const rows = select.all(deps.projectId, pvId, scanCursor, scanCursor) as DriftRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const item = classifyRow(deps.db, row, pvId, components);
        totals[item.state] += 1;
        if (
          (item.state === "stale" || item.state === "orphaned")
          && (item.previousVersion !== undefined || item.currentVersion !== undefined)
        ) {
          versions[item.stableKey] = {
            ...(item.previousVersion === undefined ? {} : { previous: item.previousVersion }),
            ...(item.currentVersion === undefined ? {} : { current: item.currentVersion }),
          };
        }
        const matchTier = item.tier === 1 ? "purl" : item.tier === 2 ? "nvg" : item.tier === 3 ? "ng" : null;
        update.run(item.state, matchTier, deps.projectId, pvId, item.stableKey);
      }
      scanCursor = rows.at(-1)?.stable_key ?? null;
      if (rows.length < 200) break;
    }
    deps.db.prepare(
      `INSERT INTO triage_runs
        (project_id, project_version_id, run_id, source, dry_run, status,
         input_digest, written, held, conflicts, skipped_existing, errors,
         report_json, created_at, finished_at)
       VALUES (?, ?, ?, 'drift', 0, 'completed', NULL, 0, 0, ?, 0, 0, ?, ?, ?)`,
    ).run(
      deps.projectId,
      pvId,
      `drift-${randomUUID()}`,
      // For drift runs, conflicts records semantic three-way tuple conflicts;
      // policy runs use the same generic column for writer CAS conflicts.
      totals.conflict,
      JSON.stringify({ totals, versions }),
      now,
      now,
    );
  })();
  return readDriftReport({ db: deps.db, projectId: deps.projectId, limit: deps.limit }, pvId);
}
