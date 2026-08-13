import type Database from "better-sqlite3";
import type { Json } from "../../../lib/remote/types.js";
import {
  FindingsCacheError,
  type CacheMetadata,
  type CachedComment,
  type CachedFinding,
  type FindingsFilter,
  type FindingsPage,
} from "./types.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

interface StateRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface FindingRow {
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
  in_kev: number;
  in_vc_kev: number;
  has_exploit: number;
  exploit_maturity: string | null;
  reachability_score: number | null;
  reachability_verdict: string | null;
  reachability_factors: string;
  vuln_in_dataset: number | null;
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
  soft_deleted: number;
  raw: string;
  pulled_at: string;
}

interface CursorValue {
  riskScore: number | null;
  findingId: string;
}

function parseJson(value: string | null, fallback: Json): Json {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as Json;
  } catch {
    return fallback;
  }
}

function stringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function comments(value: Json, findingId: string): CachedComment[] {
  if (!Array.isArray(value)) return [];
  const result: CachedComment[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id : null;
    const textValue = typeof entry.text === "string" ? entry.text : entry.body;
    const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : null;
    if (!id || typeof textValue !== "string" || !createdAt) continue;
    result.push({
      id,
      findingId,
      actorLabel: typeof entry.actorLabel === "string"
        ? entry.actorLabel
        : typeof entry.actor === "string" ? entry.actor : null,
      text: textValue,
      createdAt,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
    });
  }
  return result;
}

export function findingFromRow(row: FindingRow): CachedFinding {
  return {
    projectId: row.project_id,
    projectVersionId: row.project_version_id,
    generationId: row.generation_id,
    findingId: row.finding_id,
    stableKey: row.stable_key,
    findingType: row.finding_type,
    cve: row.cve,
    title: row.title,
    componentName: row.component_name,
    componentGroup: row.component_group,
    componentVersion: row.component_version,
    componentPurl: row.component_purl,
    severity: row.severity,
    riskScore: row.risk_score,
    band: row.band,
    cvssScore: row.cvss_score,
    cvssVector: row.cvss_vector,
    epssScore: row.epss_score,
    epssPercentile: row.epss_percentile,
    inKev: row.in_kev === 1,
    inVcKev: row.in_vc_kev === 1,
    hasExploit: row.has_exploit === 1,
    exploitMaturity: row.exploit_maturity,
    reachabilityScore: row.reachability_score,
    reachabilityVerdict: row.reachability_verdict,
    reachabilityFactors: parseJson(row.reachability_factors, []),
    vulnInDataset: row.vuln_in_dataset === null ? null : row.vuln_in_dataset === 1,
    cwes: stringArray(parseJson(row.cwes, [])),
    warningCount: row.warning_count,
    violationCount: row.violation_count,
    location: parseJson(row.location, null),
    vexStatus: row.vex_status,
    vexResponse: row.vex_response,
    vexJustification: row.vex_justification,
    vexReason: row.vex_reason,
    comments: comments(parseJson(row.comments, []), row.finding_id),
    firstSeen: row.first_seen,
    softDeleted: row.soft_deleted === 1,
    raw: parseJson(row.raw, {}) as Record<string, Json>,
    pulledAt: row.pulled_at,
  };
}

function cacheState(db: Database.Database, projectId: string, pvId: string): CacheMetadata {
  const state = db.prepare(
    `SELECT accepted_generation_id, base_revision, last_pull, error
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'finding'`,
  ).get(projectId, pvId) as StateRow | undefined;
  if (!state || state.accepted_generation_id === null) {
    return {
      state: "empty",
      asOf: state?.last_pull ?? null,
      message: state?.error ?? null,
      acceptedGenerationId: null,
      baseRevision: state?.base_revision ?? 0,
    };
  }
  return {
    state: state.error === null ? "fresh" : "stale",
    asOf: state.last_pull,
    message: state.error,
    acceptedGenerationId: state.accepted_generation_id,
    baseRevision: state.base_revision,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/gu, character => `!${character}`);
}

function addList(
  where: string[],
  parameters: Array<string | number>,
  column: string,
  values: readonly string[] | undefined,
): void {
  if (!values || values.length === 0) return;
  if (values.length > MAX_LIMIT) throw new FindingsCacheError("FINDINGS_FILTER_INVALID", "A filter has too many values");
  where.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  parameters.push(...values);
}

function decodeCursor(value: string): CursorValue {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      (decoded.riskScore === null || (typeof decoded.riskScore === "number" && Number.isFinite(decoded.riskScore)))
      && typeof decoded.findingId === "string"
      && decoded.findingId.length > 0
    ) {
      return { riskScore: decoded.riskScore, findingId: decoded.findingId } as CursorValue;
    }
  } catch {
    // Converted to the stable public error below.
  }
  throw new FindingsCacheError("FINDINGS_BAD_CURSOR", "Findings cursor is invalid");
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function whereFor(filter: FindingsFilter, generationId: string): {
  sql: string;
  parameters: Array<string | number>;
} {
  const where = ["f.project_id = ?", "f.project_version_id = ?", "f.generation_id = ?"];
  const parameters: Array<string | number> = [filter.projectId, filter.pvId, generationId];
  addList(where, parameters, "f.severity", filter.severity);
  addList(where, parameters, "f.vex_status", filter.triage);
  addList(where, parameters, "f.finding_type", filter.findingType);
  if (filter.reachability) {
    where.push("COALESCE(f.reachability_verdict, 'unknown') = ?");
    parameters.push(filter.reachability);
  }
  if (filter.kev === "kev") where.push("f.in_kev = 1");
  if (filter.kev === "vc-kev") where.push("f.in_vc_kev = 1");
  if (filter.kev === "none") where.push("f.in_kev = 0 AND f.in_vc_kev = 0");
  if (filter.epssGte !== undefined) {
    if (!Number.isFinite(filter.epssGte)) throw new FindingsCacheError("FINDINGS_FILTER_INVALID", "EPSS threshold is invalid");
    where.push("f.epss_score >= ?");
    parameters.push(filter.epssGte);
  }
  if (filter.component) {
    where.push("(f.component_name LIKE ? ESCAPE '!' OR f.component_group LIKE ? ESCAPE '!' OR f.component_purl LIKE ? ESCAPE '!')");
    const value = `%${escapeLike(filter.component)}%`;
    parameters.push(value, value, value);
  }
  if (filter.cve) {
    where.push("f.cve LIKE ? ESCAPE '!'");
    parameters.push(`%${escapeLike(filter.cve)}%`);
  }
  if (filter.hasLocalChange !== undefined) {
    where.push(`${filter.hasLocalChange ? "" : "NOT "}EXISTS (
      SELECT 1 FROM overlay_index AS overlay
       WHERE overlay.project_id = f.project_id
         AND overlay.project_version_id = f.project_version_id
         AND overlay.stable_key = f.stable_key
    )`);
  }
  return { sql: where.join(" AND "), parameters };
}

function counts(
  db: Database.Database,
  where: { sql: string; parameters: Array<string | number> },
): { total: number; facets: Record<string, Record<string, number>> } {
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM findings AS f WHERE ${where.sql}`)
    .get(...where.parameters) as { count: number };
  const facets: Record<string, Record<string, number>> = { severity: {}, triage: {}, findingType: {} };
  for (const [name, column] of [["severity", "severity"], ["triage", "vex_status"], ["findingType", "finding_type"]] as const) {
    const rows = db.prepare(
      `SELECT COALESCE(f.${column}, 'unknown') AS value, COUNT(*) AS count
         FROM findings AS f WHERE ${where.sql}
        GROUP BY COALESCE(f.${column}, 'unknown')`,
    ).all(...where.parameters) as Array<{ value: string; count: number }>;
    for (const row of rows) facets[name][row.value] = row.count;
  }
  return { total: totalRow.count, facets };
}

export function queryFindings(db: Database.Database, filter: FindingsFilter): FindingsPage {
  const limit = filter.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new FindingsCacheError("FINDINGS_LIMIT_INVALID", "Findings limit must be between 1 and 200");
  }
  const cache = cacheState(db, filter.projectId, filter.pvId);
  if (cache.acceptedGenerationId === null) {
    return { items: [], total: 0, nextCursor: null, facets: { severity: {}, triage: {}, findingType: {} }, cache };
  }
  const baseWhere = whereFor(filter, cache.acceptedGenerationId);
  const summary = counts(db, baseWhere);
  const pageWhere = { sql: baseWhere.sql, parameters: [...baseWhere.parameters] };
  if (filter.cursor) {
    const cursor = decodeCursor(filter.cursor);
    if (cursor.riskScore === null) {
      pageWhere.sql += " AND f.risk_score IS NULL AND f.finding_id > ?";
      pageWhere.parameters.push(cursor.findingId);
    } else {
      pageWhere.sql += " AND (f.risk_score IS NULL OR f.risk_score < ? OR (f.risk_score = ? AND f.finding_id > ?))";
      pageWhere.parameters.push(cursor.riskScore, cursor.riskScore, cursor.findingId);
    }
  }
  const rows = db.prepare(
    `SELECT f.* FROM findings AS f
      WHERE ${pageWhere.sql}
      ORDER BY f.risk_score DESC, f.finding_id ASC
      LIMIT ?`,
  ).all(...pageWhere.parameters, limit + 1) as FindingRow[];
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(findingFromRow),
    total: summary.total,
    nextCursor: hasMore && last
      ? encodeCursor({ riskScore: last.risk_score, findingId: last.finding_id })
      : null,
    facets: summary.facets,
    cache,
  };
}

export function getCachedFinding(
  db: Database.Database,
  projectId: string,
  pvId: string,
  findingId: string,
): { finding: CachedFinding | null; cache: CacheMetadata } {
  const cache = cacheState(db, projectId, pvId);
  if (!cache.acceptedGenerationId) return { finding: null, cache };
  const row = db.prepare(
    `SELECT * FROM findings
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND finding_id = ?`,
  ).get(projectId, pvId, cache.acceptedGenerationId, findingId) as FindingRow | undefined;
  return { finding: row ? findingFromRow(row) : null, cache };
}

export function findingsCacheState(
  db: Database.Database,
  projectId: string,
  pvId: string,
): CacheMetadata {
  return cacheState(db, projectId, pvId);
}
