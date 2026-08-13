import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../../../lib/context.js";
import {
  fromStorageProjectVersionId,
  PROJECT_LEVEL_VERSION_ID,
  toStorageProjectVersionId,
} from "../../../../lib/store/index.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../../shared/contract.js";
import type {
  RequirementDocument,
  RequirementRepository,
} from "../cards/adapter.js";
import {
  cardModelToFields,
  loadRequirementCardModel,
} from "../cards/query.js";
import {
  requirementCardModelSchema,
  type RequirementCardModel,
} from "../cards/schema.js";
import { validateRequirement } from "../cards/validator.js";
import {
  normalizeRequirementFilters,
  type RequirementFilters,
} from "./filters.js";
import { getRequirementGitHistory } from "./git-history.js";
import {
  resolveRequirementTrace,
  type RequirementTraceModel,
} from "./resolvers.js";

export interface FacetCount {
  value: string;
  count: number;
}

export interface RequirementFacets {
  pattern: FacetCount[];
  reqType: FacetCount[];
  priority: FacetCount[];
  evidenceState: FacetCount[];
  tier: FacetCount[];
  stale: number;
  localOnly: number;
}

export interface TraceabilityListFields {
  card: RequirementCardModel;
  facets: RequirementFacets;
  trace: RequirementTraceModel | null;
}

export interface RequirementsListInput {
  projectId: string;
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}

interface CacheRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface VersionRow {
  project_version_id: string;
}

interface SnapshotRow {
  entity_key: string;
  payload: string;
}

interface IndexedRow {
  requirement_id: string;
  card_json: string;
}

interface CountRow {
  value: string;
  count: number;
}

interface TraceIndexState {
  indexed: Map<string, { generationId: string | null; baseRevision: number }>;
}

const INDEX_SERVICE_KEY = "requirements-traceability:index:v1";

export function initializeTraceabilityIndex(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS fs_trace_requirements (
      project_id TEXT NOT NULL,
      project_version_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      card_json TEXT NOT NULL,
      text_index TEXT NOT NULL,
      pattern TEXT NOT NULL,
      req_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      evidence_state TEXT NOT NULL,
      stale INTEGER NOT NULL,
      local_only INTEGER NOT NULL,
      standards_json TEXT NOT NULL,
      mitigations_json TEXT NOT NULL,
      PRIMARY KEY (project_id, project_version_id, requirement_id)
    );
    CREATE INDEX IF NOT EXISTS fs_trace_req_filter
      ON fs_trace_requirements (
        project_id, project_version_id, pattern, req_type, priority,
        evidence_state, stale, local_only, requirement_id
      );
    CREATE TEMP TABLE IF NOT EXISTS fs_trace_tiers (
      project_id TEXT NOT NULL,
      project_version_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      PRIMARY KEY (project_id, project_version_id, requirement_id, tier)
    );
    CREATE INDEX IF NOT EXISTS fs_trace_tier_filter
      ON fs_trace_tiers (project_id, project_version_id, tier, requirement_id);
  `);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filtersFromInput(input: RequirementsListInput): RequirementFilters {
  const filters = isRecord(input.filters) ? input.filters : {};
  const strings = (key: string): string[] | undefined => {
    const value = filters[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : undefined;
  };
  return normalizeRequirementFilters({
    text: typeof filters.text === "string" ? filters.text : undefined,
    pattern: strings("pattern") as RequirementFilters["pattern"],
    reqType: strings("reqType"),
    priority: strings("priority"),
    evidenceState: strings("evidenceState") as RequirementFilters["evidenceState"],
    stale: filters.stale === true || undefined,
    tier: typeof filters.tier === "string" ? filters.tier as RequirementFilters["tier"] : undefined,
    standardClause: typeof filters.standardClause === "string" ? filters.standardClause : undefined,
    threat: typeof filters.threat === "string" ? filters.threat : undefined,
    localOnly: filters.localOnly === true || undefined,
    cursor: input.continuation ?? undefined,
    limit: input.pageSize,
  });
}

export function isTraceabilityListInput(input: RequirementsListInput): boolean {
  return isRecord(input.filters) && input.filters.view === "traceability";
}

function resolvedProjectVersionId(
  db: Database.Database,
  projectId: string,
  requested: string | null,
): string | null {
  if (requested !== null) return requested;
  const row = db.prepare<[string, string], VersionRow>(
    `SELECT project_version_id
       FROM sync_state
      WHERE project_id = ? AND entity_kind = 'requirement'
        AND project_version_id <> ? AND accepted_generation_id IS NOT NULL
      ORDER BY last_pull DESC, project_version_id DESC
      LIMIT 1`,
  ).get(projectId, PROJECT_LEVEL_VERSION_ID);
  return row ? fromStorageProjectVersionId(row.project_version_id) : null;
}

function cacheState(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
) {
  const row = db.prepare<[string, string], CacheRow>(
    `SELECT accepted_generation_id, base_revision, last_pull, error
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
  ).get(projectId, toStorageProjectVersionId(projectVersionId));
  if (!row?.accepted_generation_id) {
    return {
      state: "empty" as const,
      asOf: row?.last_pull ?? null,
      message: "No accepted evidence cache is available; showing the indexed tracked requirements.",
      acceptedGenerationId: null,
      baseRevision: row?.base_revision ?? 0,
    };
  }
  return {
    state: row.error ? "stale" as const : "fresh" as const,
    asOf: row.last_pull,
    message: row.error
      ? "The last evidence refresh failed; indexed accepted data and local YAML remain inspectable."
      : null,
    acceptedGenerationId: row.accepted_generation_id,
    baseRevision: row.base_revision,
  };
}

function cachedDocuments(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  generationId: string | null,
): RequirementDocument[] {
  if (!generationId) return [];
  const rows = db.prepare<[string, string, string], SnapshotRow>(
    `SELECT entity_key, payload
       FROM base_snapshot
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'
        AND generation_id = ?
      ORDER BY entity_key`,
  ).all(projectId, toStorageProjectVersionId(projectVersionId), generationId);
  return rows.flatMap((row) => {
    try {
      const validated = validateRequirement(JSON.parse(row.payload));
      if (!validated.success || row.entity_key !== reqIdKey({ reqId: validated.data.id })) return [];
      return [{
        artifactId: `product-security/requirements/${validated.data.id}.yaml`,
        requirement: validated.data,
        sha256: null,
      }];
    } catch {
      return [];
    }
  });
}

function indexKey(projectId: string, projectVersionId: string | null): string {
  return `${projectId}\0${toStorageProjectVersionId(projectVersionId)}`;
}

async function ensureIndex(
  bb: BbPluginApi,
  ctx: PluginContext,
  repository: RequirementRepository,
  scope: { projectId: string; projectVersionId: string | null },
  cache: ReturnType<typeof cacheState>,
  refresh: boolean,
): Promise<void> {
  const db = ctx.db();
  initializeTraceabilityIndex(db);
  const state = ctx.service<TraceIndexState>(INDEX_SERVICE_KEY, () => ({ indexed: new Map() }));
  const key = indexKey(scope.projectId, scope.projectVersionId);
  const current = state.indexed.get(key);
  if (
    !refresh &&
    current?.generationId === cache.acceptedGenerationId &&
    current.baseRevision === cache.baseRevision
  ) return;

  const listing = await repository.list(scope.projectId, { refresh });
  const cached = cachedDocuments(
    db,
    scope.projectId,
    scope.projectVersionId,
    cache.acceptedGenerationId,
  );
  const localById = new Map(listing.documents.map((document) => [document.requirement.id, document]));
  const documents = [
    ...cached.filter((document) => !localById.has(document.requirement.id)),
    ...listing.documents,
  ];
  const cards = documents.map((document) => ({
    document,
    card: loadRequirementCardModel(db, scope, document.requirement, document.sha256),
  }));
  const storageVersion = toStorageProjectVersionId(scope.projectVersionId);
  db.transaction(() => {
    db.prepare(
      `DELETE FROM fs_trace_tiers WHERE project_id = ? AND project_version_id = ?`,
    ).run(scope.projectId, storageVersion);
    db.prepare(
      `DELETE FROM fs_trace_requirements WHERE project_id = ? AND project_version_id = ?`,
    ).run(scope.projectId, storageVersion);
    const requirementInsert = db.prepare(
      `INSERT INTO fs_trace_requirements
         (project_id, project_version_id, requirement_id, card_json, text_index,
          pattern, req_type, priority, evidence_state, stale, local_only,
          standards_json, mitigations_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tierInsert = db.prepare(
      `INSERT INTO fs_trace_tiers
         (project_id, project_version_id, requirement_id, tier)
       VALUES (?, ?, ?, ?)`,
    );
    for (const { card } of cards) {
      const requirement = card.requirement;
      requirementInsert.run(
        scope.projectId,
        storageVersion,
        requirement.id,
        JSON.stringify(cardModelToFields(card)),
        `${requirement.id} ${requirement.ears.text} ${requirement.source_description}`.toLocaleLowerCase(),
        requirement.ears.pattern,
        requirement.req_type,
        requirement.priority,
        card.evidenceState,
        card.stale ? 1 : 0,
        card.local ? 1 : 0,
        JSON.stringify(requirement.standards),
        JSON.stringify(requirement.mitigations),
      );
      for (const tier of card.tiers.filter((item) => item.count > 0)) {
        tierInsert.run(scope.projectId, storageVersion, requirement.id, tier.tier);
      }
    }
  })();
  state.indexed.set(key, {
    generationId: cache.acceptedGenerationId,
    baseRevision: cache.baseRevision,
  });
  bb.log.debug(
    `Rebuilt bounded requirement trace index for ${scope.projectId}: ${cards.length} requirements, ${listing.diagnostics.length} diagnostics.`,
  );
}

interface SqlFilter {
  where: string;
  params: unknown[];
}

function sqlFilter(
  scope: { projectId: string; projectVersionId: string | null },
  filters: RequirementFilters,
  requirementId: string | null,
): SqlFilter {
  const where = ["req.project_id = ?", "req.project_version_id = ?"];
  const params: unknown[] = [scope.projectId, toStorageProjectVersionId(scope.projectVersionId)];
  const multi = (column: string, values: readonly string[] | undefined) => {
    if (!values || values.length === 0) return;
    where.push(`${column} IN (${Array.from({ length: values.length }, () => "?").join(", ")})`);
    params.push(...values);
  };
  if (requirementId) {
    where.push("req.requirement_id = ?");
    params.push(requirementId);
  }
  if (filters.text) {
    where.push("instr(req.text_index, ?) > 0");
    params.push(filters.text.toLocaleLowerCase());
  }
  multi("req.pattern", filters.pattern);
  multi("req.req_type", filters.reqType);
  multi("req.priority", filters.priority);
  multi("req.evidence_state", filters.evidenceState);
  if (filters.stale) where.push("req.stale = 1");
  if (filters.localOnly) where.push("req.local_only = 1");
  if (filters.tier) {
    where.push(`EXISTS (
      SELECT 1 FROM fs_trace_tiers tier
       WHERE tier.project_id = req.project_id
         AND tier.project_version_id = req.project_version_id
         AND tier.requirement_id = req.requirement_id
         AND tier.tier = ?
    )`);
    params.push(filters.tier);
  }
  if (filters.standardClause) {
    where.push(`EXISTS (
      SELECT 1 FROM json_each(req.standards_json) standard
       WHERE standard.value = ?
    )`);
    params.push(filters.standardClause);
  }
  if (filters.threat) {
    where.push(`EXISTS (
      SELECT 1
        FROM base_snapshot threat
        JOIN sync_state state
          ON state.project_id = threat.project_id
         AND state.project_version_id = threat.project_version_id
         AND state.entity_kind = 'threat'
         AND state.accepted_generation_id = threat.generation_id
        JOIN json_each(req.mitigations_json) req_mitigation
        JOIN json_each(threat.payload, '$.fields.mitigations') threat_mitigation
       WHERE threat.project_id = req.project_id
         AND threat.project_version_id = req.project_version_id
         AND threat.entity_kind = 'threat'
         AND json_extract(threat.payload, '$.fields.slug') = ?
         AND req_mitigation.value = threat_mitigation.value
    )`);
    params.push(filters.threat);
  }
  return { where: where.join(" AND "), params };
}

function facetRows(
  db: Database.Database,
  sql: SqlFilter,
  expression: string,
): FacetCount[] {
  return db.prepare<unknown[], CountRow>(
    `SELECT ${expression} AS value, COUNT(*) AS count
       FROM fs_trace_requirements req
      WHERE ${sql.where}
      GROUP BY ${expression}
      ORDER BY count DESC, value
      LIMIT 100`,
  ).all(...sql.params);
}

function facets(db: Database.Database, sql: SqlFilter): RequirementFacets {
  const scalar = db.prepare<unknown[], { stale: number; local_only: number }>(
    `SELECT COALESCE(SUM(req.stale), 0) AS stale,
            COALESCE(SUM(req.local_only), 0) AS local_only
       FROM fs_trace_requirements req WHERE ${sql.where}`,
  ).get(...sql.params) ?? { stale: 0, local_only: 0 };
  const tierRows = db.prepare<unknown[], CountRow>(
    `SELECT tier.tier AS value, COUNT(*) AS count
       FROM fs_trace_tiers tier
       JOIN fs_trace_requirements req
         ON req.project_id = tier.project_id
        AND req.project_version_id = tier.project_version_id
        AND req.requirement_id = tier.requirement_id
      WHERE ${sql.where}
      GROUP BY tier.tier ORDER BY count DESC, value`,
  ).all(...sql.params);
  return {
    pattern: facetRows(db, sql, "req.pattern"),
    reqType: facetRows(db, sql, "req.req_type"),
    priority: facetRows(db, sql, "req.priority"),
    evidenceState: facetRows(db, sql, "req.evidence_state"),
    tier: tierRows,
    stale: scalar.stale,
    localOnly: scalar.local_only,
  };
}

function fieldsJson(fields: TraceabilityListFields): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(fields);
  if (!isRecord(parsed)) throw new Error("Traceability fields must encode as an object.");
  return parsed;
}

function cursorId(cursor: string | undefined): string | null {
  if (!cursor) return null;
  const match = /^trace:v1:(REQ-[A-Za-z0-9-]+)$/u.exec(cursor);
  if (!match?.[1]) throw new Error("Traceability continuation token is no longer valid.");
  return match[1];
}

export async function queryRequirementsTraceability(args: {
  bb: BbPluginApi;
  ctx: PluginContext;
  repository: RequirementRepository;
  input: RequirementsListInput;
}) {
  const { bb, ctx, repository, input } = args;
  const projectVersionId = resolvedProjectVersionId(ctx.db(), input.projectId, input.projectVersionId);
  const scope = { projectId: input.projectId, projectVersionId };
  const cache = cacheState(ctx.db(), input.projectId, projectVersionId);
  const rawFilters = isRecord(input.filters) ? input.filters : {};
  const filters = filtersFromInput(input);
  await ensureIndex(bb, ctx, repository, scope, cache, rawFilters.refresh === true);
  const requirementId = typeof rawFilters.requirementId === "string"
    ? rawFilters.requirementId
    : null;
  const sql = sqlFilter(scope, filters, requirementId);
  const after = cursorId(filters.cursor);
  const pageWhere = after ? `${sql.where} AND req.requirement_id > ?` : sql.where;
  const pageParams = after ? [...sql.params, after] : sql.params;
  const limit = filters.limit ?? 50;
  const rows = ctx.db().prepare<unknown[], IndexedRow>(
    `SELECT req.requirement_id, req.card_json
       FROM fs_trace_requirements req
      WHERE ${pageWhere}
      ORDER BY req.requirement_id
      LIMIT ?`,
  ).all(...pageParams, limit + 1);
  const total = ctx.db().prepare<unknown[], { count: number }>(
    `SELECT COUNT(*) AS count FROM fs_trace_requirements req WHERE ${sql.where}`,
  ).get(...sql.params)?.count ?? 0;
  const page = rows.slice(0, limit);
  const pageFacets = facets(ctx.db(), sql);
  const items = await Promise.all(page.map(async (row) => {
    const card = loadCard(row.card_json);
    const trace = requirementId === row.requirement_id
      ? resolveRequirementTrace(
          ctx.db(),
          scope,
          card,
          await getRequirementGitHistory(
            bb,
            scope.projectId,
            row.requirement_id,
            card.sourceSha256,
          ),
        )
      : null;
    return {
      projectId: input.projectId,
      projectVersionId,
      kind: "requirement-trace",
      key: row.requirement_id,
      label: row.requirement_id,
      fields: fieldsJson({ card, facets: pageFacets, trace }),
    };
  }));
  return {
    items,
    total,
    next: rows.length > limit
      ? `trace:v1:${page.at(-1)?.requirement_id ?? ""}`
      : null,
    cache,
  };
}

export function loadCard(value: string): RequirementCardModel {
  return requirementCardModelSchema.parse(JSON.parse(value));
}
