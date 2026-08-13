import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../../shared/contract.js";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";
import {
  aggregateThreats,
  categoryFromVocabulary,
  methodologyVocabulary,
  type StrideSegment,
  type StrideVocabulary,
  type ThreatSummary,
} from "./aggregate.js";
import { parseAttackPathSteps, parseExploitability } from "./path.js";

const MAX_THREATS = 2_000;
const MAX_TARGETS_PER_THREAT = 100;
const MAX_AGGREGATES = 10_000;
const MAX_PATH_PAGE_SIZE = 100;

const projectScopeSchema = z
  .object({
    projectId: z.string().trim().min(1).max(512),
    projectVersionId: z.string().trim().min(1).max(512).nullable(),
  })
  .strict();
const pathPageInputSchema = projectScopeSchema
  .extend({
    threatSlug: z.string().trim().min(1).max(512),
    pageSize: z.number().int().min(1).max(MAX_PATH_PAGE_SIZE).default(50),
    continuation: z.string().min(1).max(4096).nullable().default(null),
  })
  .strict();
const pathInputSchema = projectScopeSchema
  .extend({ routeSignature: z.string().trim().min(1).max(2048) })
  .strict();
const strideCategorySchema = z.enum([
  "spoofing",
  "tampering",
  "repudiation",
  "information_disclosure",
  "denial_of_service",
  "elevation_of_privilege",
  "other",
]);
const strideLabelsSchema = z
  .object({
    spoofing: z.string().min(1).max(200),
    tampering: z.string().min(1).max(200),
    repudiation: z.string().min(1).max(200),
    information_disclosure: z.string().min(1).max(200),
    denial_of_service: z.string().min(1).max(200),
    elevation_of_privilege: z.string().min(1).max(200),
  })
  .strict();
const threatSummarySchema = z
  .object({
    slug: z.string().min(1).max(512),
    title: z.string().min(1).max(1_000),
    rawCategory: z.string().max(500),
    category: strideCategorySchema,
    severity: z.string().max(200).nullable(),
    targetSlugs: z.array(z.string().min(1).max(512)).max(MAX_TARGETS_PER_THREAT),
    attackPathCount: z.number().int().nonnegative(),
  })
  .strict();
const aggregateSchema = z
  .object({
    targetSlug: z.string().min(1).max(512),
    counts: z.record(strideCategorySchema, z.number().int().nonnegative()),
    total: z.number().int().nonnegative(),
  })
  .strict();
const cacheSchema = z
  .object({
    state: z.enum(["fresh", "stale", "empty"]),
    asOf: z.string().nullable(),
    message: z.string().max(500).nullable(),
  })
  .strict();
const pathSummarySchema = z
  .object({
    routeSignature: z.string().min(1).max(2048),
    label: z.string().min(1).max(1_000),
    totalSteps: z.number().int().nonnegative().nullable(),
  })
  .strict();
const cachedStepSchema = z
  .object({
    order: z.number().int().nonnegative(),
    label: z.string().min(1).max(2_000),
    nodeSlug: z.string().max(512).nullable(),
    edgeSlug: z.string().max(512).nullable(),
    sourceSlug: z.string().max(512).nullable(),
    targetSlug: z.string().max(512).nullable(),
  })
  .strict();

export const threatOverlayRpcContract = defineRpcContract({
  threatOverlaySnapshot: {
    input: projectScopeSchema,
    output: z
      .object({
        revision: z.string().min(1).max(4096),
        threats: z.array(threatSummarySchema).max(MAX_THREATS),
        aggregates: z.array(aggregateSchema).max(MAX_AGGREGATES),
        methodology: z
          .object({
            configured: z.boolean(),
            labels: strideLabelsSchema,
          })
          .strict(),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
        partialError: z.string().max(500).nullable(),
        cache: cacheSchema,
      })
      .strict(),
  },
  threatOverlayPaths: {
    input: pathPageInputSchema,
    output: z
      .object({
        items: z.array(pathSummarySchema).max(MAX_PATH_PAGE_SIZE),
        total: z.number().int().nonnegative(),
        next: z.string().min(1).max(4096).nullable(),
        cache: cacheSchema,
      })
      .strict(),
  },
  threatOverlayPath: {
    input: pathInputSchema,
    output: z
      .object({
        path: z
          .object({
            routeSignature: z.string().min(1).max(2048),
            threatSlug: z.string().max(512).nullable(),
            steps: z.array(cachedStepSchema).max(10_000),
            exploitability: jsonValueSchema,
            viability: z.enum(["viable", "not_viable", "unknown"]),
          })
          .strict()
          .nullable(),
        error: z.string().max(500).nullable(),
        cache: cacheSchema,
      })
      .strict(),
  },
});

type ThreatSnapshot = z.output<
  (typeof threatOverlayRpcContract)["threatOverlaySnapshot"]["output"]
>;
type ProjectScope = z.output<typeof projectScopeSchema>;
type PathPageInput = z.output<typeof pathPageInputSchema>;
type PathInput = z.output<typeof pathInputSchema>;

interface SyncRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface SnapshotRow {
  entity_key: string;
  payload: string;
}

interface MethodologyRow {
  generation_id: string;
  stride_map: string;
}

interface PathCountRow {
  threat_key: string;
  count: number;
}

interface PathRow {
  route_signature: string;
  name: string | null;
  threat_key: string | null;
  steps: string;
  total_steps: number | null;
  exploitability: string | null;
}

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(encoded: string): Record<string, JsonValue> | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return null;
  }
  const parsed = jsonValueSchema.safeParse(decoded);
  return parsed.success && isJsonRecord(parsed.data) ? parsed.data : null;
}

function firstString(
  fields: Readonly<Record<string, JsonValue>>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function stringValues(
  fields: Readonly<Record<string, JsonValue>>,
  ...keys: string[]
): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length > 0) {
      values.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          values.push(entry.trim());
        }
      }
    }
  }
  return [...new Set(values)].slice(0, MAX_TARGETS_PER_THREAT);
}

function isOpenThreat(fields: Readonly<Record<string, JsonValue>>): boolean {
  const status = firstString(
    fields,
    "status",
    "threat_status",
    "disposition",
  )?.toLocaleLowerCase();
  return !status || !["closed", "resolved", "dismissed", "archived"].includes(status);
}

function syncRow(
  db: Database.Database,
  scope: ProjectScope,
  ...entityKinds: string[]
): SyncRow | undefined {
  const placeholders = entityKinds.map(() => "?").join(",");
  return db
    .prepare<unknown[], SyncRow>(
      `SELECT accepted_generation_id, base_revision, last_pull, error
         FROM sync_state
        WHERE project_id = ?
          AND project_version_id = ?
          AND entity_kind IN (${placeholders})
        ORDER BY CASE entity_kind WHEN ? THEN 0 ELSE 1 END
        LIMIT 1`,
    )
    .get(
      scope.projectId,
      toStorageProjectVersionId(scope.projectVersionId),
      ...entityKinds,
      entityKinds[0],
    );
}

function cacheState(sync: SyncRow | undefined) {
  if (!sync?.accepted_generation_id) {
    return {
      state: "empty" as const,
      asOf: null,
      message: "No accepted threat-overlay cache is available.",
    };
  }
  return {
    state: sync.error ? ("stale" as const) : ("fresh" as const),
    asOf: sync.last_pull,
    message: sync.error
      ? "The last threat-overlay refresh failed; showing accepted cache."
      : null,
  };
}

function acceptedPathGeneration(
  db: Database.Database,
  scope: ProjectScope,
): { generationId: string | null; sync: SyncRow | undefined } {
  const sync = syncRow(db, scope, "attack_path", "attack-path");
  if (sync?.accepted_generation_id) {
    return { generationId: sync.accepted_generation_id, sync };
  }
  const fallback = db
    .prepare<
      [string, string],
      { generation_id: string; accepted_at: string | null }
    >(
      `SELECT paths.generation_id, generation.accepted_at
         FROM attack_paths AS paths
         JOIN pull_generation AS generation
           ON generation.project_id = paths.project_id
          AND generation.project_version_id = paths.project_version_id
          AND generation.generation_id = paths.generation_id
        WHERE paths.project_id = ?
          AND paths.project_version_id = ?
          AND generation.status = 'accepted'
        ORDER BY generation.accepted_at DESC, paths.generation_id DESC
        LIMIT 1`,
    )
    .get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId));
  return { generationId: fallback?.generation_id ?? null, sync };
}

function readMethodology(
  db: Database.Database,
  scope: ProjectScope,
): { generationId: string; vocabulary: StrideVocabulary; malformed: boolean } {
  const row = db
    .prepare<[string, string], MethodologyRow>(
      `SELECT profile.generation_id, profile.stride_map
         FROM methodology_profiles AS profile
         JOIN pull_generation AS generation
           ON generation.project_id = profile.project_id
          AND generation.project_version_id = profile.project_version_id
          AND generation.generation_id = profile.generation_id
        WHERE profile.project_id = ?
          AND profile.project_version_id = ?
          AND generation.status = 'accepted'
        ORDER BY CASE profile.scope WHEN 'project' THEN 0 ELSE 1 END,
                 generation.accepted_at DESC,
                 profile.profile_id
        LIMIT 1`,
    )
    .get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId));
  if (!row) {
    return {
      generationId: "unconfigured",
      vocabulary: methodologyVocabulary(null),
      malformed: false,
    };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.stride_map);
  } catch {
    return {
      generationId: row.generation_id,
      vocabulary: methodologyVocabulary(null),
      malformed: true,
    };
  }
  return {
    generationId: row.generation_id,
    vocabulary: methodologyVocabulary(decoded),
    malformed: false,
  };
}

function labelsForOutput(
  vocabulary: StrideVocabulary,
): Record<StrideSegment, string> {
  return {
    spoofing: vocabulary.labels.spoofing,
    tampering: vocabulary.labels.tampering,
    repudiation: vocabulary.labels.repudiation,
    information_disclosure: vocabulary.labels.information_disclosure,
    denial_of_service: vocabulary.labels.denial_of_service,
    elevation_of_privilege: vocabulary.labels.elevation_of_privilege,
  };
}

function readPathCounts(
  db: Database.Database,
  scope: ProjectScope,
  generationId: string | null,
): Map<string, number> {
  if (!generationId) return new Map();
  const rows = db
    .prepare<[string, string, string], PathCountRow>(
      `SELECT threat_key, COUNT(*) AS count
         FROM attack_paths
        WHERE project_id = ?
          AND project_version_id = ?
          AND generation_id = ?
          AND threat_key IS NOT NULL
        GROUP BY threat_key`,
    )
    .all(
      scope.projectId,
      toStorageProjectVersionId(scope.projectVersionId),
      generationId,
    );
  return new Map(rows.map((row) => [row.threat_key, row.count]));
}

function memoizeSnapshot(
  cache: Map<string, ThreatSnapshot>,
  revision: string,
  snapshot: ThreatSnapshot,
): ThreatSnapshot {
  cache.set(revision, snapshot);
  if (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return snapshot;
}

export function readThreatSnapshot(
  db: Database.Database,
  scope: ProjectScope,
  snapshotCache: Map<string, ThreatSnapshot> = new Map(),
): ThreatSnapshot {
  const sync = syncRow(db, scope, "threat");
  const methodology = readMethodology(db, scope);
  const pathGeneration = acceptedPathGeneration(db, scope).generationId;
  const revision = `${scope.projectId}:${scope.projectVersionId ?? "@project"}:${sync?.accepted_generation_id ?? "empty"}:${sync?.base_revision ?? 0}:${methodology.generationId}:${pathGeneration ?? "empty-paths"}`;
  const cached = snapshotCache.get(revision);
  if (cached) return cached;

  if (!sync?.accepted_generation_id) {
    const snapshot: ThreatSnapshot = {
      revision,
      threats: [],
      aggregates: [],
      methodology: {
        configured: methodology.vocabulary.configured,
        labels: labelsForOutput(methodology.vocabulary),
      },
      total: 0,
      truncated: false,
      partialError: methodology.malformed
        ? "The cached methodology STRIDE map is malformed. Categories remain visible under Other."
        : null,
      cache: cacheState(sync),
    };
    return memoizeSnapshot(snapshotCache, revision, snapshot);
  }

  const rows = db
    .prepare<[string, string, string, number], SnapshotRow>(
      `SELECT entity_key, payload
         FROM base_snapshot
        WHERE project_id = ?
          AND project_version_id = ?
          AND entity_kind = 'threat'
          AND generation_id = ?
        ORDER BY entity_key
        LIMIT ?`,
    )
    .all(
      scope.projectId,
      toStorageProjectVersionId(scope.projectVersionId),
      sync.accepted_generation_id,
      MAX_THREATS + 1,
    );
  const pathCounts = readPathCounts(db, scope, pathGeneration);
  let malformedThreats = 0;
  const threats: ThreatSummary[] = [];
  for (const row of rows.slice(0, MAX_THREATS)) {
    const fields = parseJsonRecord(row.payload);
    if (!fields) {
      malformedThreats += 1;
      continue;
    }
    if (!isOpenThreat(fields)) continue;
    const rawCategory =
      firstString(fields, "category", "stride", "threat_category") ??
      "unknown";
    threats.push({
      slug: row.entity_key,
      title:
        firstString(fields, "title", "name", "label") ?? row.entity_key,
      rawCategory,
      category: categoryFromVocabulary(rawCategory, methodology.vocabulary),
      severity: firstString(fields, "severity", "risk", "priority"),
      targetSlugs: stringValues(
        fields,
        "affected_components",
        "affectedComponents",
        "component_slugs",
        "componentSlugs",
        "component_slug",
        "componentSlug",
        "component_id",
        "componentId",
        "affected_assets",
        "affectedAssets",
        "asset_slugs",
        "assetSlugs",
        "asset_slug",
        "assetSlug",
        "asset_id",
        "assetId",
        "dataflows",
        "dataflow_slugs",
        "dataflowSlugs",
        "dataflow_slug",
        "dataflowSlug",
        "dataflow_id",
        "dataflowId",
      ),
      attackPathCount: pathCounts.get(row.entity_key) ?? 0,
    });
  }
  const truncated = rows.length > MAX_THREATS;
  const allAggregates = aggregateThreats(threats);
  const aggregates = allAggregates.slice(0, MAX_AGGREGATES);
  const issues = [
    methodology.malformed
      ? "The cached methodology STRIDE map is malformed; unmapped categories are shown under Other."
      : null,
    malformedThreats > 0
      ? `${malformedThreats} cached threat ${malformedThreats === 1 ? "row is" : "rows are"} malformed and omitted.`
      : null,
    truncated
      ? `Threat display is capped at ${MAX_THREATS}; refine the accepted model before relying on complete counts.`
      : null,
    allAggregates.length > MAX_AGGREGATES
      ? `STRIDE target display is capped at ${MAX_AGGREGATES}; additional targets remain available from their threat rows.`
      : null,
  ].filter((issue): issue is string => Boolean(issue));
  const snapshot: ThreatSnapshot = {
    revision,
    threats,
    aggregates,
    methodology: {
      configured: methodology.vocabulary.configured,
      labels: labelsForOutput(methodology.vocabulary),
    },
    total: rows.length,
    truncated,
    partialError: issues.length > 0 ? issues.join(" ").slice(0, 500) : null,
    cache: cacheState(sync),
  };
  return memoizeSnapshot(snapshotCache, revision, snapshot);
}

function encodeContinuation(routeSignature: string): string {
  return Buffer.from(routeSignature, "utf8").toString("base64url");
}

function decodeContinuation(continuation: string | null): string {
  if (!continuation) return "";
  try {
    const decoded = Buffer.from(continuation, "base64url").toString("utf8");
    if (decoded.length === 0 || decoded.length > 2048) throw new Error();
    return decoded;
  } catch {
    throw new Error("Attack-path continuation token is invalid.");
  }
}

function readPathPage(db: Database.Database, input: PathPageInput) {
  const { generationId, sync } = acceptedPathGeneration(db, input);
  if (!generationId) {
    return { items: [], total: 0, next: null, cache: cacheState(sync) };
  }
  const after = decodeContinuation(input.continuation);
  const rows = db
    .prepare<[string, string, string, string, string, number], PathRow>(
      `SELECT route_signature, name, threat_key, steps, total_steps, exploitability
         FROM attack_paths
        WHERE project_id = ?
          AND project_version_id = ?
          AND generation_id = ?
          AND threat_key = ?
          AND route_signature > ?
        ORDER BY route_signature
        LIMIT ?`,
    )
    .all(
      input.projectId,
      toStorageProjectVersionId(input.projectVersionId),
      generationId,
      input.threatSlug,
      after,
      input.pageSize + 1,
    );
  const total =
    db
      .prepare<[string, string, string, string], { count: number }>(
        `SELECT COUNT(*) AS count
           FROM attack_paths
          WHERE project_id = ?
            AND project_version_id = ?
            AND generation_id = ?
            AND threat_key = ?`,
      )
      .get(
        input.projectId,
        toStorageProjectVersionId(input.projectVersionId),
        generationId,
        input.threatSlug,
      )?.count ?? 0;
  const visible = rows.slice(0, input.pageSize);
  return {
    items: visible.map((row) => ({
      routeSignature: row.route_signature,
      label: row.name ?? row.route_signature,
      totalSteps: row.total_steps,
    })),
    total,
    next:
      rows.length > input.pageSize && visible.length > 0
        ? encodeContinuation(visible[visible.length - 1]!.route_signature)
        : null,
    cache: cacheState(sync),
  };
}

function readPath(db: Database.Database, input: PathInput) {
  const { generationId, sync } = acceptedPathGeneration(db, input);
  if (!generationId) {
    return {
      path: null,
      error: "No accepted attack-path cache is available.",
      cache: cacheState(sync),
    };
  }
  const row = db
    .prepare<[string, string, string, string], PathRow>(
      `SELECT route_signature, name, threat_key, steps, total_steps, exploitability
         FROM attack_paths
        WHERE project_id = ?
          AND project_version_id = ?
          AND generation_id = ?
          AND route_signature = ?
        LIMIT 1`,
    )
    .get(
      input.projectId,
      toStorageProjectVersionId(input.projectVersionId),
      generationId,
      input.routeSignature,
    );
  if (!row) {
    return {
      path: null,
      error: "The selected attack path is no longer in the accepted cache.",
      cache: cacheState(sync),
    };
  }
  const parsed = parseAttackPathSteps(row.steps);
  if (parsed.error) {
    return {
      path: null,
      error: `${parsed.error} Threats and architecture remain usable.`,
      cache: cacheState(sync),
    };
  }
  return {
    path: {
      routeSignature: row.route_signature,
      threatSlug: row.threat_key,
      steps: parsed.steps,
      exploitability: parseExploitability(row.exploitability),
      viability: "unknown" as const,
    },
    error: null,
    cache: cacheState(sync),
  };
}

export function registerThreatOverlayBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  const snapshotCache = ctx.service(
    "product-security:threat-overlay:snapshots",
    () => new Map<string, ThreatSnapshot>(),
  );
  bb.rpc.register(threatOverlayRpcContract, {
    threatOverlaySnapshot(input) {
      return readThreatSnapshot(ctx.db(), input, snapshotCache);
    },
    threatOverlayPaths(input) {
      return readPathPage(ctx.db(), input);
    },
    threatOverlayPath(input) {
      return readPath(ctx.db(), input);
    },
  });
}
