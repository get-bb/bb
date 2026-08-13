import type Database from "better-sqlite3";
import type {
  SbomCacheState,
  SbomComponentSummary,
  SbomPage,
  SbomQuery,
  SbomReachability,
} from "./types.js";
import { SbomQueryError } from "./types.js";

const MAX_PAGE_SIZE = 200;

interface SyncRow {
  project_id: string;
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface QueryRow {
  component_key: string;
  purl: string | null;
  cpe: string | null;
  name: string;
  component_group: string | null;
  version: string | null;
  license: string | null;
  supplier: string | null;
  source: string | null;
  is_stale: number;
  file_locations_json: string;
  pulled_at: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  kev_count: number;
  max_epss: number | null;
  reachability_verdict: SbomReachability;
}

interface CursorValue {
  name: string;
  componentKey: string;
}

function encodeCursor(value: CursorValue): string {
  return `sq1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeCursor(value: string | undefined): CursorValue | null {
  if (value === undefined) return null;
  try {
    const [prefix, payload, extra] = value.split(".");
    if (prefix !== "sq1" || !payload || extra !== undefined) throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("name" in decoded) ||
      !("componentKey" in decoded) ||
      typeof decoded.name !== "string" ||
      typeof decoded.componentKey !== "string" ||
      decoded.name.length > 1000 ||
      decoded.componentKey.length > 1000
    ) throw new Error();
    return { name: decoded.name, componentKey: decoded.componentKey };
  } catch {
    throw new SbomQueryError("BAD_CURSOR", "The SBOM cursor is invalid; restart the query.");
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function cacheState(sync: SyncRow | undefined): SbomCacheState {
  if (!sync?.accepted_generation_id) {
    return {
      state: "empty",
      asOf: sync?.last_pull ?? null,
      message: sync?.error
        ? "The SBOM refresh failed and no complete cache is available. Retry the pull."
        : "No complete SBOM cache is available. Pull the SBOM to load it.",
      acceptedGenerationId: null,
      baseRevision: sync?.base_revision ?? 0,
    };
  }
  return {
    state: sync.error ? "stale" : "fresh",
    asOf: sync.last_pull,
    message: sync.error
      ? `${sync.error}; showing the last complete SBOM cache. Retry the pull.`
      : null,
    acceptedGenerationId: sync.accepted_generation_id,
    baseRevision: sync.base_revision,
  };
}

function parseFiles(value: string): string[] {
  const nested: unknown = JSON.parse(value);
  if (!Array.isArray(nested)) return [];
  const files = new Set<string>();
  for (const item of nested) {
    if (typeof item !== "string") continue;
    const parsed: unknown = JSON.parse(item);
    if (!Array.isArray(parsed)) continue;
    for (const file of parsed) if (typeof file === "string") files.add(file);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function queryScoped(
  db: Database.Database,
  projectId: string,
  query: SbomQuery,
): SbomPage<SbomComponentSummary> {
  const limit = query.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError(`SBOM page size must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  const cursor = decodeCursor(query.cursor);
  const sync = db.prepare<[string, string], SyncRow>(
    `SELECT project_id, accepted_generation_id, base_revision, last_pull, error
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'sbomComponent'`,
  ).get(projectId, query.projectVersionId);
  const cache = cacheState(sync);
  if (!sync?.accepted_generation_id) return { items: [], total: 0, cursor: null, cache };

  const where: string[] = [
    "c.project_id = ?",
    "c.project_version_id = ?",
    "c.generation_id = ?",
  ];
  const params: Array<string | number> = [projectId, query.projectVersionId, sync.accepted_generation_id];
  if (query.search) {
    where.push("(c.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR c.component_group LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    const pattern = `%${escapeLike(query.search)}%`;
    params.push(pattern, pattern);
  }
  if (query.purl) {
    where.push("c.purl LIKE ? ESCAPE '\\' COLLATE NOCASE");
    params.push(`%${escapeLike(query.purl)}%`);
  }
  if (query.license) {
    where.push("c.license LIKE ? ESCAPE '\\' COLLATE NOCASE");
    params.push(`%${escapeLike(query.license)}%`);
  }
  if (query.componentKey) {
    where.push("c.component_key = ?");
    params.push(query.componentKey);
  }
  if (query.minimumSeverity) {
    const columns = query.minimumSeverity === "critical"
      ? ["critical"]
      : query.minimumSeverity === "high"
        ? ["critical", "high"]
        : query.minimumSeverity === "medium"
          ? ["critical", "high", "medium"]
          : ["critical", "high", "medium", "low"];
    where.push(`(${columns.map((column) => `COALESCE(r.${column}, 0)`).join(" + ")}) > 0`);
  }
  if (query.kev !== undefined) {
    where.push(query.kev ? "COALESCE(r.kev_count, 0) > 0" : "COALESCE(r.kev_count, 0) = 0");
  }
  if (query.reachability) {
    where.push("COALESCE(r.reachability_verdict, 'unknown') = ?");
    params.push(query.reachability);
  }
  const filteredWhere = where.join(" AND ");
  const grouped = `
    SELECT c.component_key,
           MIN(c.purl) AS purl,
           MIN(c.cpe) AS cpe,
           MIN(c.name) AS name,
           MIN(c.component_group) AS component_group,
           MIN(c.version) AS version,
           MIN(c.license) AS license,
           MIN(c.supplier) AS supplier,
           MIN(c.source) AS source,
           MAX(c.is_stale) AS is_stale,
           json_group_array(COALESCE(c.file_locations, '[]')) AS file_locations_json,
           MAX(c.pulled_at) AS pulled_at,
           COALESCE(MAX(r.critical), 0) AS critical,
           COALESCE(MAX(r.high), 0) AS high,
           COALESCE(MAX(r.medium), 0) AS medium,
           COALESCE(MAX(r.low), 0) AS low,
           COALESCE(MAX(r.kev_count), 0) AS kev_count,
           MAX(r.max_epss) AS max_epss,
           COALESCE(MAX(r.reachability_verdict), 'unknown') AS reachability_verdict
      FROM sbom_components c
      LEFT JOIN sbom_vuln_rollup r
        ON r.project_id = c.project_id
       AND r.project_version_id = c.project_version_id
       AND r.generation_id = c.generation_id
       AND r.component_key = c.component_key
     WHERE ${filteredWhere}
     GROUP BY c.component_key`;
  const total = db.prepare<Array<string | number>, { count: number }>(
    `SELECT COUNT(*) AS count FROM (${grouped})`,
  ).get(...params)!.count;
  const pageWhere = cursor
    ? "WHERE name COLLATE NOCASE > ? COLLATE NOCASE OR (name = ? COLLATE NOCASE AND component_key > ?)"
    : "";
  const pageParams = cursor ? [...params, cursor.name, cursor.name, cursor.componentKey, limit + 1] : [...params, limit + 1];
  const rows = db.prepare<Array<string | number>, QueryRow>(
    `SELECT * FROM (${grouped}) ${pageWhere}
      ORDER BY name COLLATE NOCASE, component_key
      LIMIT ?`,
  ).all(...pageParams);
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map((row) => ({
      componentKey: row.component_key,
      purl: row.purl,
      cpe: row.cpe,
      name: row.name,
      group: row.component_group,
      version: row.version,
      license: row.license,
      supplier: row.supplier,
      source: row.source,
      isStale: row.is_stale === 1,
      files: parseFiles(row.file_locations_json),
      vuln: {
        critical: row.critical,
        high: row.high,
        medium: row.medium,
        low: row.low,
        kev: row.kev_count,
        maxEpss: row.max_epss,
        reachability: row.reachability_verdict,
      },
      pulledAt: row.pulled_at,
    })),
    total,
    cursor: rows.length > limit && last
      ? encodeCursor({ name: last.name, componentKey: last.component_key })
      : null,
    cache,
  };
}

export function querySbomForProject(
  db: Database.Database,
  projectId: string,
  query: SbomQuery,
): SbomPage<SbomComponentSummary> {
  return queryScoped(db, projectId, query);
}

export function querySbom(
  db: Database.Database,
  query: SbomQuery,
): SbomPage<SbomComponentSummary> {
  const projects = db.prepare<[string], { project_id: string }>(
    `SELECT project_id FROM sync_state
      WHERE project_version_id = ? AND entity_kind = 'sbomComponent'
      ORDER BY project_id`,
  ).all(query.projectVersionId);
  if (projects.length !== 1) {
    throw new Error("SBOM_QUERY_SCOPE_AMBIGUOUS: project scope is required");
  }
  return queryScoped(db, projects[0]!.project_id, query);
}
