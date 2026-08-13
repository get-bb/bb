import type Database from "better-sqlite3";
import {
  fromStorageProjectVersionId,
  PROJECT_LEVEL_VERSION_ID,
  toStorageProjectVersionId,
} from "../../../../lib/store/index.js";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../../shared/contract.js";
import {
  aggregateCellForTier,
  type VerificationResult,
} from "./aggregate.js";
import {
  isVerificationResultState,
  isVerificationTier,
  type MatrixRollup,
  type MatrixRow,
  type VerificationTier,
  VERIFICATION_TIERS,
} from "./status.js";
import {
  mapCheckToTier,
  TierMappingError,
  type CheckModel,
} from "./tier-map.js";

export interface MatrixQueryInput {
  projectId: string;
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}

export interface MatrixQueryResult {
  items: Array<{
    projectId: string;
    projectVersionId: string | null;
    kind: "verification-matrix-row";
    key: string;
    label: string;
    fields: Record<string, JsonValue>;
  }>;
  total: number;
  next: string | null;
  cache: {
    state: "fresh" | "stale" | "empty";
    asOf: string | null;
    message: string | null;
    acceptedGenerationId: string | null;
    baseRevision: number;
  };
}

interface VersionRow { project_version_id: string }
interface ScopeRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}
interface MatrixSqlRow {
  requirement_key: string;
  requirement_id: string;
  title: string;
  pattern: string | null;
  requirement_type: string | null;
  priority: string | null;
  requirement_pulled_at: string;
  total_count: number;
  total_verified: number;
  total_failed: number;
  total_error: number;
  total_inconclusive: number;
  total_running: number;
  total_pending: number;
  total_skipped: number;
  unproven_rank: number;
  check_id: string | null;
  check_type: string | null;
  category: string | null;
  parameters: string | null;
  is_required: number | null;
  result_id: string | null;
  result_check_id: string | null;
  result_tier: string | null;
  result_status: string | null;
  run_id: string | null;
  executed_at: string | null;
  is_latest: number | null;
  mapping_state: string | null;
  fs_version_id: string | null;
}

interface MatrixIndexMetaRow {
  generation_id: string;
  base_revision: number;
}

interface MatrixCursor { rank: number; requirementId: string }

const STATE_RANK_SQL = `CASE vr.status
  WHEN 'failed' THEN 0 WHEN 'error' THEN 1 WHEN 'inconclusive' THEN 2
  WHEN 'running' THEN 3 WHEN 'pending' THEN 4 WHEN 'verified' THEN 7
  WHEN 'skipped' THEN 8 ELSE NULL END`;

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFilter(filters: Record<string, JsonValue>, key: string): string | null {
  const value = filters[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function booleanFilter(filters: Record<string, JsonValue>, key: string): boolean {
  return filters[key] === true;
}

function encodeCursor(cursor: MatrixCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): MatrixCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      typeof Reflect.get(parsed, "rank") !== "number" ||
      typeof Reflect.get(parsed, "requirementId") !== "string"
    ) throw new Error("shape");
    const rank = Reflect.get(parsed, "rank");
    const requirementId = Reflect.get(parsed, "requirementId");
    if (typeof rank !== "number" || typeof requirementId !== "string") {
      throw new Error("shape");
    }
    return { rank, requirementId };
  } catch {
    throw new Error("Verification matrix continuation token is invalid");
  }
}

function resolveProjectVersionId(
  db: Database.Database,
  projectId: string,
  requested: string | null,
): string | null {
  if (requested !== null) return requested;
  const row = db.prepare<[string, string], VersionRow>(
    `SELECT project_version_id FROM sync_state
      WHERE project_id = ? AND entity_kind = 'requirement'
        AND project_version_id <> ? AND accepted_generation_id IS NOT NULL
      ORDER BY last_pull DESC, project_version_id DESC LIMIT 1`,
  ).get(projectId, PROJECT_LEVEL_VERSION_ID);
  return row ? fromStorageProjectVersionId(row.project_version_id) : null;
}

function cacheState(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
): MatrixQueryResult["cache"] {
  const row = db.prepare<[string, string], ScopeRow>(
    `SELECT accepted_generation_id, base_revision, last_pull, error
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
  ).get(projectId, toStorageProjectVersionId(projectVersionId));
  if (!row?.accepted_generation_id) {
    return {
      state: "empty",
      asOf: row?.last_pull ?? null,
      message: "No accepted requirement and verification cache is available.",
      acceptedGenerationId: null,
      baseRevision: row?.base_revision ?? 0,
    };
  }
  return {
    state: row.error ? "stale" : "fresh",
    asOf: row.last_pull,
    message: row.error
      ? "The latest refresh failed; showing the last accepted verification evidence."
      : null,
    acceptedGenerationId: row.accepted_generation_id,
    baseRevision: row.base_revision,
  };
}

function tierSql(): string {
  const parameters = "CASE WHEN json_valid(vc.parameters) THEN vc.parameters ELSE '{}' END";
  return `CASE
    WHEN vc.check_type IN ('config_check','sbom_query','binary_analysis','binary_pattern','vuln_absence') THEN 'static'
    WHEN vc.check_type IN ('manual','attestation','document_review') THEN 'manual'
    WHEN vc.check_type = 'external_sync' THEN 'hil'
    WHEN vc.check_type = 'dynamic' AND lower(COALESCE(
      json_extract(${parameters}, '$.matrix_col'), json_extract(${parameters}, '$.matrixColumn'),
      json_extract(${parameters}, '$.bench_tier'), json_extract(${parameters}, '$.benchTier'),
      json_extract(${parameters}, '$.environment'), json_extract(${parameters}, '$.tier'), vc.category
    )) IN ('emulation','tier1','tier2','qemu','renode','rehosted') THEN 'emulation'
    WHEN vc.check_type = 'dynamic' AND lower(replace(COALESCE(
      json_extract(${parameters}, '$.matrix_col'), json_extract(${parameters}, '$.matrixColumn'),
      json_extract(${parameters}, '$.bench_tier'), json_extract(${parameters}, '$.benchTier'),
      json_extract(${parameters}, '$.environment'), json_extract(${parameters}, '$.tier'), vc.category
    ), '-', '_')) IN ('hil','tier3','hardware_in_the_loop') THEN 'hil'
    ELSE NULL END`;
}

function initializeMatrixIndex(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS fs_verification_matrix_meta (
      project_id TEXT NOT NULL,
      project_version_id TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      PRIMARY KEY (project_id, project_version_id)
    );
    CREATE TEMP TABLE IF NOT EXISTS fs_verification_matrix_index (
      project_id TEXT NOT NULL,
      project_version_id TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      requirement_key TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      title TEXT NOT NULL,
      pattern TEXT,
      requirement_type TEXT,
      priority TEXT,
      requirement_pulled_at TEXT NOT NULL,
      newest_evidence_at TEXT,
      unproven_rank INTEGER NOT NULL,
      PRIMARY KEY (project_id, project_version_id, requirement_id)
    );
    CREATE INDEX IF NOT EXISTS fs_verification_matrix_page
      ON fs_verification_matrix_index (
        project_id, project_version_id, unproven_rank, requirement_id
      );
    CREATE INDEX IF NOT EXISTS fs_verification_matrix_facets
      ON fs_verification_matrix_index (
        project_id, project_version_id, pattern, requirement_type, priority,
        unproven_rank, requirement_id
      );
  `);
}

function ensureMatrixIndex(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  generationId: string,
  baseRevision: number,
): void {
  initializeMatrixIndex(db);
  const storageVersion = toStorageProjectVersionId(projectVersionId);
  const current = db.prepare<[string, string], MatrixIndexMetaRow>(
    `SELECT generation_id, base_revision FROM fs_verification_matrix_meta
      WHERE project_id = ? AND project_version_id = ?`,
  ).get(projectId, storageVersion);
  if (current?.generation_id === generationId && current.base_revision === baseRevision) return;
  const mappedTier = tierSql();
  const rebuild = db.transaction(() => {
    db.prepare(
      `DELETE FROM fs_verification_matrix_index
        WHERE project_id = ? AND project_version_id = ?`,
    ).run(projectId, storageVersion);
    db.prepare(
      `INSERT INTO fs_verification_matrix_index (
         project_id, project_version_id, generation_id, requirement_key,
         requirement_id, title, pattern, requirement_type, priority,
         requirement_pulled_at, newest_evidence_at, unproven_rank
       )
       SELECT bs.project_id, bs.project_version_id, bs.generation_id, bs.entity_key,
              COALESCE(json_extract(bs.payload, '$.id'), bs.entity_key),
              COALESCE(json_extract(bs.payload, '$.ears.text'), json_extract(bs.payload, '$.title'), bs.entity_key),
              json_extract(bs.payload, '$.ears.pattern'), json_extract(bs.payload, '$.req_type'),
              json_extract(bs.payload, '$.priority'), bs.pulled_at,
              MAX(vr.executed_at),
              COALESCE(MIN(${STATE_RANK_SQL}),
                CASE WHEN COUNT(CASE WHEN ${mappedTier} IS NOT NULL THEN rcm.check_id END) > 0 THEN 5 ELSE 6 END)
         FROM base_snapshot bs
         LEFT JOIN requirement_check_mappings rcm
           ON rcm.project_id = bs.project_id AND rcm.project_version_id = bs.project_version_id
          AND rcm.generation_id = bs.generation_id AND rcm.requirement_key = bs.entity_key
          AND rcm.suppressed = 0
         LEFT JOIN verification_checks vc
           ON vc.project_id = rcm.project_id AND vc.project_version_id = rcm.project_version_id
          AND vc.generation_id = rcm.generation_id AND vc.check_id = rcm.check_id
         LEFT JOIN verification_results vr
           ON vr.project_id = bs.project_id AND vr.project_version_id = bs.project_version_id
          AND vr.generation_id = bs.generation_id AND vr.requirement_key = bs.entity_key
          AND vr.is_latest = 1 AND vr.mapping_state = 'mapped'
          AND (vr.check_id = rcm.check_id OR vr.check_id IS NULL)
        WHERE bs.project_id = ? AND bs.project_version_id = ? AND bs.generation_id = ?
          AND bs.entity_kind = 'requirement'
        GROUP BY bs.project_id, bs.project_version_id, bs.generation_id, bs.entity_key,
                 bs.payload, bs.pulled_at`,
    ).run(projectId, storageVersion, generationId);
    db.prepare(
      `INSERT INTO fs_verification_matrix_meta (
         project_id, project_version_id, generation_id, base_revision
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id, project_version_id) DO UPDATE SET
         generation_id = excluded.generation_id, base_revision = excluded.base_revision`,
    ).run(projectId, storageVersion, generationId, baseRevision);
  });
  rebuild();
}

function queryRows(
  db: Database.Database,
  input: MatrixQueryInput,
  projectVersionId: string | null,
  generationId: string,
): MatrixSqlRow[] {
  const filters = isRecord(input.filters) ? input.filters : {};
  const text = stringFilter(filters, "text")?.toLocaleLowerCase() ?? null;
  const pattern = stringFilter(filters, "pattern");
  const requirementType = stringFilter(filters, "reqType");
  const priority = stringFilter(filters, "priority");
  const tier = stringFilter(filters, "tier");
  const state = stringFilter(filters, "status");
  const staleOnly = booleanFilter(filters, "stale");
  const unprovenOnly = booleanFilter(filters, "unprovenOnly");
  const cursor = decodeCursor(input.continuation);
  const tierFilterSql = tierSql().replaceAll("vc.", "matrix_check.");
  const sql = `WITH filtered AS (
    SELECT matrix.*, COUNT(*) OVER () AS total_count,
           SUM(CASE WHEN unproven_rank = 7 THEN 1 ELSE 0 END) OVER () AS total_verified,
           SUM(CASE WHEN unproven_rank = 0 THEN 1 ELSE 0 END) OVER () AS total_failed,
           SUM(CASE WHEN unproven_rank = 1 THEN 1 ELSE 0 END) OVER () AS total_error,
           SUM(CASE WHEN unproven_rank = 2 THEN 1 ELSE 0 END) OVER () AS total_inconclusive,
           SUM(CASE WHEN unproven_rank = 3 THEN 1 ELSE 0 END) OVER () AS total_running,
           SUM(CASE WHEN unproven_rank = 4 THEN 1 ELSE 0 END) OVER () AS total_pending,
           SUM(CASE WHEN unproven_rank = 8 THEN 1 ELSE 0 END) OVER () AS total_skipped
      FROM fs_verification_matrix_index matrix
     WHERE matrix.project_id = ? AND matrix.project_version_id = ?
       AND (? IS NULL OR lower(matrix.requirement_id || ' ' || matrix.title) LIKE '%' || ? || '%')
       AND (? IS NULL OR matrix.pattern = ?)
       AND (? IS NULL OR matrix.requirement_type = ?)
       AND (? IS NULL OR matrix.priority = ?)
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM requirement_check_mappings matrix_mapping
         JOIN verification_checks matrix_check
           ON matrix_check.project_id = matrix_mapping.project_id
          AND matrix_check.project_version_id = matrix_mapping.project_version_id
          AND matrix_check.generation_id = matrix_mapping.generation_id
          AND matrix_check.check_id = matrix_mapping.check_id
         WHERE matrix_mapping.project_id = matrix.project_id
           AND matrix_mapping.project_version_id = matrix.project_version_id
           AND matrix_mapping.generation_id = matrix.generation_id
           AND matrix_mapping.requirement_key = matrix.requirement_key
           AND matrix_mapping.suppressed = 0 AND ${tierFilterSql} = ?
       ) OR EXISTS (
         SELECT 1 FROM verification_results matrix_result
         WHERE matrix_result.project_id = matrix.project_id
           AND matrix_result.project_version_id = matrix.project_version_id
           AND matrix_result.generation_id = matrix.generation_id
           AND matrix_result.requirement_key = matrix.requirement_key
           AND matrix_result.is_latest = 1 AND matrix_result.tier = ?
       ))
       AND (? = 0 OR matrix.newest_evidence_at IS NOT NULL AND matrix.requirement_pulled_at > matrix.newest_evidence_at)
       AND (? = 0 OR unproven_rank NOT IN (7, 8))
       AND (? IS NULL OR CASE ?
         WHEN 'mapped_not_run' THEN unproven_rank = 5
         WHEN 'unmapped' THEN unproven_rank = 6
         ELSE unproven_rank = CASE ?
           WHEN 'failed' THEN 0 WHEN 'error' THEN 1 WHEN 'inconclusive' THEN 2
           WHEN 'running' THEN 3 WHEN 'pending' THEN 4 WHEN 'verified' THEN 7
           WHEN 'skipped' THEN 8 ELSE -1 END END)
       AND (? IS NULL OR unproven_rank > ? OR (unproven_rank = ? AND requirement_id > ?))
     ORDER BY unproven_rank, requirement_id
     LIMIT ?
  )
  SELECT f.*, rcm.check_id, vc.check_type, vc.category, vc.parameters, rcm.is_required,
         vr.result_id, vr.check_id AS result_check_id, vr.tier AS result_tier,
         vr.status AS result_status, vr.run_id, vr.executed_at, vr.is_latest,
         vr.mapping_state, vr.fs_version_id
    FROM filtered f
    LEFT JOIN requirement_check_mappings rcm
      ON rcm.project_id = ? AND rcm.project_version_id = ? AND rcm.generation_id = ?
     AND rcm.requirement_key = f.requirement_key AND rcm.suppressed = 0
    LEFT JOIN verification_checks vc
      ON vc.project_id = rcm.project_id AND vc.project_version_id = rcm.project_version_id
     AND vc.generation_id = rcm.generation_id AND vc.check_id = rcm.check_id
    LEFT JOIN verification_results vr
      ON vr.project_id = ? AND vr.project_version_id = ? AND vr.generation_id = ?
     AND vr.requirement_key = f.requirement_key AND vr.is_latest = 1
     AND (vr.check_id = rcm.check_id OR vr.check_id IS NULL)
   ORDER BY f.unproven_rank, f.requirement_id, rcm.check_id, vr.result_id`;
  const storageVersion = toStorageProjectVersionId(projectVersionId);
  return db.prepare<unknown[], MatrixSqlRow>(sql).all(
    input.projectId, storageVersion,
    text, text, pattern, pattern, requirementType, requirementType,
    priority, priority, tier, tier, tier,
    staleOnly ? 1 : 0, unprovenOnly ? 1 : 0,
    state, state, state,
    cursor?.rank ?? null, cursor?.rank ?? null, cursor?.rank ?? null,
    cursor?.requirementId ?? null, input.pageSize,
    input.projectId, storageVersion, generationId,
    input.projectId, storageVersion, generationId,
  );
}

function emptyCells(requirementId: string): MatrixRow["cells"] {
  return {
    static: aggregateCellForTier(requirementId, "static", [], []),
    emulation: aggregateCellForTier(requirementId, "emulation", [], []),
    hil: aggregateCellForTier(requirementId, "hil", [], []),
    manual: aggregateCellForTier(requirementId, "manual", [], []),
    hardware: aggregateCellForTier(requirementId, "hardware", [], []),
  };
}

function groupRows(
  rows: readonly MatrixSqlRow[],
  targetFirmwareVersionId: string | null,
): MatrixRow[] {
  const grouped = new Map<string, MatrixSqlRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.requirement_id) ?? [];
    group.push(row);
    grouped.set(row.requirement_id, group);
  }
  return Array.from(grouped, ([requirementId, group]) => {
    const first = group[0];
    if (!first) throw new Error("Verification matrix row group is empty");
    const checks = new Map<VerificationTier, CheckModel[]>();
    const results = new Map<VerificationTier, VerificationResult[]>();
    let unknownCheckCount = 0;
    const seenChecks = new Set<string>();
    const seenResults = new Set<string>();
    for (const row of group) {
      if (row.check_id && row.check_type && !seenChecks.has(row.check_id)) {
        seenChecks.add(row.check_id);
        const check: CheckModel = {
          checkId: row.check_id,
          checkType: row.check_type,
          category: row.category,
          parameters: row.parameters,
          required: row.is_required === 1,
        };
        try {
          const checkTier = mapCheckToTier(check);
          checks.set(checkTier, [...(checks.get(checkTier) ?? []), check]);
        } catch (error) {
          if (!(error instanceof TierMappingError)) throw error;
          unknownCheckCount += 1;
        }
      }
      if (
        row.result_id && row.result_tier && row.result_status &&
        !seenResults.has(row.result_id) && isVerificationTier(row.result_tier) &&
        isVerificationResultState(row.result_status)
      ) {
        seenResults.add(row.result_id);
        const result: VerificationResult = {
          resultId: row.result_id,
          requirementId,
          checkId: row.result_check_id,
          tier: row.result_tier,
          status: row.result_status,
          runId: row.run_id,
          executedAt: row.executed_at,
          isLatest: row.is_latest === 1,
          mappingState: row.mapping_state === "unmapped" ? "unmapped" : "mapped",
          firmwareVersionId: row.fs_version_id,
        };
        results.set(result.tier, [...(results.get(result.tier) ?? []), result]);
      }
    }
    const cells = emptyCells(requirementId);
    for (const tier of VERIFICATION_TIERS) {
      cells[tier] = aggregateCellForTier(
        requirementId,
        tier,
        checks.get(tier) ?? [],
        results.get(tier) ?? [],
      );
    }
    const allResults = Array.from(results.values()).flat();
    const newestAt = allResults.reduce<string | null>(
      (latest, result) => result.executedAt && (!latest || result.executedAt > latest)
        ? result.executedAt
        : latest,
      null,
    );
    const firmwareMoved = targetFirmwareVersionId !== null && allResults.some(
      (result) => result.firmwareVersionId !== null && result.firmwareVersionId !== targetFirmwareVersionId,
    );
    return {
      requirementId,
      title: first.title,
      pattern: first.pattern,
      requirementType: first.requirement_type,
      priority: first.priority,
      stale: allResults.length > 0 && (
        firmwareMoved || (newestAt !== null && first.requirement_pulled_at > newestAt)
      ),
      unknownCheckCount,
      cells,
    };
  });
}

function rollup(rows: readonly MatrixSqlRow[]): MatrixRollup {
  const first = rows[0];
  return {
    requirements: first?.total_count ?? 0,
    verified: first?.total_verified ?? 0,
    failed: first?.total_failed ?? 0,
    error: first?.total_error ?? 0,
    inconclusive: first?.total_inconclusive ?? 0,
    running: first?.total_running ?? 0,
    pending: first?.total_pending ?? 0,
    skipped: first?.total_skipped ?? 0,
  };
}

function rowFields(row: MatrixRow, totals: MatrixRollup): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(JSON.parse(JSON.stringify({ row, rollup: totals })));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Verification matrix row did not serialize to an object");
  }
  return parsed;
}

export function queryVerificationMatrix(
  db: Database.Database,
  input: MatrixQueryInput,
): MatrixQueryResult {
  const projectVersionId = resolveProjectVersionId(db, input.projectId, input.projectVersionId);
  const cache = cacheState(db, input.projectId, projectVersionId);
  if (!cache.acceptedGenerationId) {
    return { items: [], total: 0, next: null, cache };
  }
  ensureMatrixIndex(
    db,
    input.projectId,
    projectVersionId,
    cache.acceptedGenerationId,
    cache.baseRevision,
  );
  const sqlRows = queryRows(db, input, projectVersionId, cache.acceptedGenerationId);
  const rows = groupRows(sqlRows, projectVersionId);
  const totals = rollup(sqlRows);
  const lastSqlRow = sqlRows.at(-1);
  const total = sqlRows[0]?.total_count ?? 0;
  const next = rows.length === input.pageSize && lastSqlRow
    ? encodeCursor({ rank: lastSqlRow.unproven_rank, requirementId: lastSqlRow.requirement_id })
    : null;
  return {
    items: rows.map((row) => ({
      projectId: input.projectId,
      projectVersionId,
      kind: "verification-matrix-row",
      key: row.requirementId,
      label: row.title,
      fields: rowFields(row, totals),
    })),
    total,
    next,
    cache,
  };
}
