import type Database from "better-sqlite3";
import type {
  SbomCacheState,
  SbomComponentSummary,
  SbomPage,
  SbomQuery,
  SbomReachability,
} from "./types.js";
import { SbomQueryError } from "./types.js";
import { componentKeyFromIdentity } from "./rollup.js";

const MAX_PAGE_SIZE = 200;

export type SbomSort = "name" | "severity" | "kev" | "license";
export type SbomSortDirection = "asc" | "desc";

export interface SbomFindingSummary {
  stableKey: string;
  cve: string | null;
  title: string | null;
  severity: string | null;
  epss: number | null;
  kev: boolean;
  reachability: string | null;
  vexStatus: string | null;
  localChange: boolean;
}

export interface SbomLinkSummary {
  kind: string;
  key: string;
  label: string;
}

export interface SbomUiQuery extends SbomQuery {
  source?: string;
  linked?: boolean;
  localChange?: boolean;
  sort?: SbomSort;
  direction?: SbomSortDirection;
}

export interface SbomUiComponentSummary extends SbomComponentSummary {
  upstreamStale: boolean;
  localChange: boolean;
  linked: boolean;
}

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
  local_change: number;
  linked: number;
  severity_sort: number;
  sort_value: string | number;
}

interface CursorValue {
  sort: SbomSort;
  direction: SbomSortDirection;
  value: string | number;
  componentKey: string;
}

function encodeCursor(value: CursorValue): string {
  return `sq1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeCursor(
  value: string | undefined,
  sort: SbomSort,
  direction: SbomSortDirection,
): CursorValue | null {
  if (value === undefined) return null;
  try {
    const [prefix, payload, extra] = value.split(".");
    if (prefix !== "sq1" || !payload || extra !== undefined) throw new Error();
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("sort" in decoded) ||
      !("direction" in decoded) ||
      !("value" in decoded) ||
      !("componentKey" in decoded) ||
      decoded.sort !== sort ||
      decoded.direction !== direction ||
      (typeof decoded.value !== "string" &&
        typeof decoded.value !== "number") ||
      (typeof decoded.value === "number" && !Number.isFinite(decoded.value)) ||
      typeof decoded.componentKey !== "string" ||
      (typeof decoded.value === "string" && decoded.value.length > 1000) ||
      decoded.componentKey.length > 1000
    )
      throw new Error();
    return {
      sort,
      direction,
      value: decoded.value,
      componentKey: decoded.componentKey,
    };
  } catch {
    throw new SbomQueryError(
      "BAD_CURSOR",
      "The SBOM cursor is invalid; restart the query.",
    );
  }
}

function installComponentKeyFunction(db: Database.Database): void {
  db.function(
    "fs_sbom_component_key",
    { deterministic: true },
    (purl: unknown, name: unknown, group: unknown, version: unknown) => {
      if (purl !== null && typeof purl !== "string") return null;
      if (typeof name !== "string") return null;
      if (group !== null && typeof group !== "string") return null;
      if (version !== null && typeof version !== "string") return null;
      try {
        return componentKeyFromIdentity({ purl, name, group, version });
      } catch {
        return null;
      }
    },
  );
}

const SORT_EXPRESSIONS: Record<SbomSort, string> = {
  name: "lower(name)",
  severity: "severity_sort",
  kev: "kev_count",
  license: "lower(COALESCE(license, ''))",
};

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
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
  query: SbomUiQuery,
): SbomPage<SbomUiComponentSummary> {
  const limit = query.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError(
      `SBOM page size must be between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  const sort = query.sort ?? "name";
  const direction = query.direction ?? "asc";
  const cursor = decodeCursor(query.cursor, sort, direction);
  const sync = db
    .prepare<[string, string], SyncRow>(
      `SELECT project_id, accepted_generation_id, base_revision, last_pull, error
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'sbomComponent'`,
    )
    .get(projectId, query.projectVersionId);
  const cache = cacheState(sync);
  if (!sync?.accepted_generation_id)
    return { items: [], total: 0, cursor: null, cache };

  const where: string[] = [
    "c.project_id = ?",
    "c.project_version_id = ?",
    "c.generation_id = ?",
  ];
  const params: Array<string | number> = [
    projectId,
    query.projectVersionId,
    sync.accepted_generation_id,
  ];
  if (query.search) {
    where.push(
      "(c.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR c.component_group LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
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
    const columns =
      query.minimumSeverity === "critical"
        ? ["critical"]
        : query.minimumSeverity === "high"
          ? ["critical", "high"]
          : query.minimumSeverity === "medium"
            ? ["critical", "high", "medium"]
            : ["critical", "high", "medium", "low"];
    where.push(
      `(${columns.map((column) => `COALESCE(r.${column}, 0)`).join(" + ")}) > 0`,
    );
  }
  if (query.kev !== undefined) {
    where.push(
      query.kev
        ? "COALESCE(r.kev_count, 0) > 0"
        : "COALESCE(r.kev_count, 0) = 0",
    );
  }
  if (query.reachability) {
    where.push("COALESCE(r.reachability_verdict, 'unknown') = ?");
    params.push(query.reachability);
  }
  if (query.source) {
    where.push("c.source = ? COLLATE NOCASE");
    params.push(query.source);
  }
  if (query.localChange !== undefined) {
    where.push(`${query.localChange ? "" : "NOT "}EXISTS (
      SELECT 1 FROM overlay_index oi
       WHERE oi.project_id = c.project_id
         AND oi.project_version_id = c.project_version_id
         AND oi.entity_kind = 'vexDecision'
         AND oi.component_key = c.component_key
         AND oi.local_state <> 'pushed'
    )`);
  }
  if (query.linked !== undefined) {
    where.push(`${query.linked ? "" : "NOT "}EXISTS (
      SELECT 1 FROM base_snapshot bl
      JOIN sync_state bs
        ON bs.project_id = bl.project_id
       AND bs.project_version_id = bl.project_version_id
       AND bs.entity_kind = bl.entity_kind
       AND bs.accepted_generation_id = bl.generation_id
     WHERE bl.project_id = c.project_id
       AND bl.project_version_id = c.project_version_id
       AND bl.entity_kind = 'sbomLink'
       AND json_extract(bl.payload, '$.purl') = c.purl
    )`);
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
           COALESCE(MAX(r.reachability_verdict), 'unknown') AS reachability_verdict,
           (COALESCE(MAX(r.critical), 0) * 1000000000
             + COALESCE(MAX(r.high), 0) * 1000000
             + COALESCE(MAX(r.medium), 0) * 1000
             + COALESCE(MAX(r.low), 0)) AS severity_sort,
           MAX(EXISTS (
             SELECT 1 FROM overlay_index oi
              WHERE oi.project_id = c.project_id
                AND oi.project_version_id = c.project_version_id
                AND oi.entity_kind = 'vexDecision'
                AND oi.component_key = c.component_key
                AND oi.local_state <> 'pushed'
           )) AS local_change,
           MAX(EXISTS (
             SELECT 1 FROM base_snapshot bl
             JOIN sync_state bs
               ON bs.project_id = bl.project_id
              AND bs.project_version_id = bl.project_version_id
              AND bs.entity_kind = bl.entity_kind
              AND bs.accepted_generation_id = bl.generation_id
            WHERE bl.project_id = c.project_id
              AND bl.project_version_id = c.project_version_id
              AND bl.entity_kind = 'sbomLink'
              AND json_extract(bl.payload, '$.purl') = c.purl
           )) AS linked
      FROM sbom_components c
      LEFT JOIN sbom_vuln_rollup r
        ON r.project_id = c.project_id
       AND r.project_version_id = c.project_version_id
       AND r.generation_id = c.generation_id
       AND r.component_key = c.component_key
     WHERE ${filteredWhere}
     GROUP BY c.component_key`;
  const total = db
    .prepare<
      Array<string | number>,
      { count: number }
    >(`SELECT COUNT(*) AS count FROM (${grouped})`)
    .get(...params)!.count;
  const sortExpression = SORT_EXPRESSIONS[sort];
  const comparator = direction === "asc" ? ">" : "<";
  const pageWhere = cursor
    ? `WHERE ${sortExpression} ${comparator} ? OR (${sortExpression} = ? AND component_key > ?)`
    : "";
  const pageParams = cursor
    ? [...params, cursor.value, cursor.value, cursor.componentKey, limit + 1]
    : [...params, limit + 1];
  const rows = db
    .prepare<Array<string | number>, QueryRow>(
      `SELECT *, ${sortExpression} AS sort_value FROM (${grouped}) ${pageWhere}
      ORDER BY ${sortExpression} ${direction.toUpperCase()}, component_key
      LIMIT ?`,
    )
    .all(...pageParams);
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
      upstreamStale: row.is_stale === 1 && cache.state !== "stale",
      files: parseFiles(row.file_locations_json),
      localChange: row.local_change === 1,
      linked: row.linked === 1,
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
    cursor:
      rows.length > limit && last
        ? encodeCursor({
            sort,
            direction,
            value: last.sort_value,
            componentKey: last.component_key,
          })
        : null,
    cache,
  };
}

export function querySbomForProject(
  db: Database.Database,
  projectId: string,
  query: SbomUiQuery,
): SbomPage<SbomUiComponentSummary> {
  return queryScoped(db, projectId, query);
}

export function querySbom(
  db: Database.Database,
  query: SbomUiQuery,
): SbomPage<SbomUiComponentSummary> {
  const projects = db
    .prepare<[string], { project_id: string }>(
      `SELECT project_id FROM sync_state
      WHERE project_version_id = ? AND entity_kind = 'sbomComponent'
      ORDER BY project_id`,
    )
    .all(query.projectVersionId);
  if (projects.length !== 1) {
    throw new Error("SBOM_QUERY_SCOPE_AMBIGUOUS: project scope is required");
  }
  return queryScoped(db, projects[0]!.project_id, query);
}

interface FindingRow {
  stable_key: string;
  cve: string | null;
  title: string | null;
  severity: string | null;
  epss_score: number | null;
  in_kev: number;
  in_vc_kev: number;
  reachability_verdict: string | null;
  vex_status: string | null;
  local_status: string | null;
  local_change: number;
}

interface AcceptedGenerationRow {
  accepted_generation_id: string | null;
}

interface ComponentAliasRow {
  fallback_key: string | null;
}

function ensureFindingKeyProjection(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
): string | null {
  const sync = db
    .prepare<[string, string], AcceptedGenerationRow>(
      `SELECT accepted_generation_id
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'finding'`,
    )
    .get(projectId, projectVersionId);
  const generationId = sync?.accepted_generation_id ?? null;
  if (generationId === null) return null;

  installComponentKeyFunction(db);
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS fs_sbom_query_finding_keys (
      project_id TEXT NOT NULL,
      project_version_id TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      component_key TEXT,
      PRIMARY KEY (project_id, project_version_id, generation_id, finding_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS fs_sbom_query_finding_keys_component
      ON fs_sbom_query_finding_keys (
        project_id, project_version_id, generation_id, component_key, finding_id
      );
  `);
  const projected = db
    .prepare<[string, string, string], { found: number }>(
      `SELECT 1 AS found
       FROM fs_sbom_query_finding_keys
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
      LIMIT 1`,
    )
    .get(projectId, projectVersionId, generationId);
  if (projected) return generationId;

  const publish = db.transaction(() => {
    db.prepare(
      `DELETE FROM fs_sbom_query_finding_keys
        WHERE project_id = ? AND project_version_id = ?`,
    ).run(projectId, projectVersionId);
    db.prepare(
      `INSERT INTO fs_sbom_query_finding_keys (
         project_id, project_version_id, generation_id, finding_id, component_key
       )
       SELECT f.project_id, f.project_version_id, f.generation_id, f.finding_id,
              fs_sbom_component_key(
                f.component_purl, f.component_name,
                f.component_group, f.component_version
              )
         FROM findings f
        WHERE f.project_id = ? AND f.project_version_id = ?
          AND f.generation_id = ?`,
    ).run(projectId, projectVersionId, generationId);
  });
  publish();
  return generationId;
}

export function queryComponentFindings(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  componentKey: string,
): SbomFindingSummary[] {
  const generationId = ensureFindingKeyProjection(
    db,
    projectId,
    projectVersionId,
  );
  if (generationId === null) return [];
  const component = db
    .prepare<[string, string, string], ComponentAliasRow>(
      `SELECT fs_sbom_component_key(
                NULL, c.name, c.component_group, c.version
              ) AS fallback_key
         FROM sbom_components c
         JOIN sync_state s
           ON s.project_id = c.project_id
          AND s.project_version_id = c.project_version_id
          AND s.entity_kind = 'sbomComponent'
          AND s.accepted_generation_id = c.generation_id
        WHERE c.project_id = ? AND c.project_version_id = ?
          AND c.component_key = ?
        LIMIT 1`,
    )
    .get(projectId, projectVersionId, componentKey);
  const fallbackKey = component?.fallback_key ?? componentKey;
  return db
    .prepare<[string, string, string, string, string], FindingRow>(
      `SELECT f.stable_key, f.cve, f.title, f.severity, f.epss_score,
            f.in_kev, f.in_vc_kev, f.reachability_verdict, f.vex_status,
            oi.vex_status AS local_status,
            CASE WHEN oi.local_state IS NOT NULL AND oi.local_state <> 'pushed'
                 THEN 1 ELSE 0 END AS local_change
       FROM findings f
       JOIN fs_sbom_query_finding_keys k
         ON k.project_id = f.project_id
        AND k.project_version_id = f.project_version_id
        AND k.generation_id = f.generation_id
        AND k.finding_id = f.finding_id
       LEFT JOIN overlay_index oi
         ON oi.project_id = f.project_id
        AND oi.project_version_id = f.project_version_id
        AND oi.entity_kind = 'vexDecision'
        AND oi.stable_key = f.stable_key
      WHERE f.project_id = ? AND f.project_version_id = ?
        AND f.generation_id = ? AND k.component_key IN (?, ?)
      ORDER BY CASE lower(COALESCE(f.severity, ''))
                 WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
               f.cve, f.stable_key`,
    )
    .all(projectId, projectVersionId, generationId, componentKey, fallbackKey)
    .map((row) => ({
      stableKey: row.stable_key,
      cve: row.cve,
      title: row.title,
      severity: row.severity,
      epss: row.epss_score,
      kev: row.in_kev === 1 || row.in_vc_kev === 1,
      reachability: row.reachability_verdict,
      vexStatus: row.local_status ?? row.vex_status,
      localChange: row.local_change === 1,
    }));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function appendLink(
  links: Map<string, SbomLinkSummary>,
  kind: string,
  key: unknown,
  label?: unknown,
): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return;
  const safeKind = kind.length > 0 && kind.length <= 512 ? kind : "component";
  const safeLabel =
    typeof label === "string" && label.length > 0 && label.length <= 1000
      ? label
      : key;
  links.set(`${safeKind}\u0000${key}`, {
    kind: safeKind,
    key,
    label: safeLabel,
  });
}

function linksFromPayload(payload: string): SbomLinkSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const record = objectValue(parsed);
  if (!record) return [];
  const links = new Map<string, SbomLinkSummary>();
  const nested = record.links;
  if (Array.isArray(nested)) {
    for (const candidate of nested) {
      const link = objectValue(candidate);
      if (!link || typeof link.kind !== "string") continue;
      appendLink(links, link.kind, link.key, link.label);
    }
  }
  appendLink(links, "component", record.componentSlug, record.componentLabel);
  appendLink(links, "threat", record.threatSlug, record.threatLabel);
  appendLink(
    links,
    "requirement",
    record.requirementId,
    record.requirementLabel,
  );
  appendLink(links, "hbomPart", record.hbomPartId, record.hbomPartLabel);
  return [...links.values()];
}

export function queryComponentLinks(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  purl: string | null,
): SbomLinkSummary[] {
  if (purl === null) return [];
  const rows = db
    .prepare<[string, string, string], { payload: string }>(
      `SELECT b.payload
       FROM base_snapshot b
       JOIN sync_state s
         ON s.project_id = b.project_id
        AND s.project_version_id = b.project_version_id
        AND s.entity_kind = b.entity_kind
        AND s.accepted_generation_id = b.generation_id
      WHERE b.project_id = ? AND b.project_version_id = ?
        AND b.entity_kind = 'sbomLink'
        AND json_extract(b.payload, '$.purl') = ?
      ORDER BY b.entity_key`,
    )
    .all(projectId, projectVersionId, purl);
  const links = new Map<string, SbomLinkSummary>();
  for (const row of rows) {
    for (const link of linksFromPayload(row.payload)) {
      links.set(`${link.kind}\u0000${link.key}`, link);
    }
  }
  return [...links.values()];
}
