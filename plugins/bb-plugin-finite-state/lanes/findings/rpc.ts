import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "../../shared/contract.js";
import { rpcContract } from "../../shared/contract.js";
import { listFindingActivity } from "./cache/activity.js";
import {
  commentMutationAuthorizationUnavailable,
  listFindingComments,
} from "./cache/comments.js";
import { getCachedFinding, queryFindings } from "./cache/query.js";
import { findingsCacheState } from "./cache/query.js";
import type { CachedFinding, FindingsFilter } from "./cache/types.js";
import {
  parseEncodedFindingKey,
  resolveEncodedFinding,
} from "./stable-key/index.js";

const findingsRpcContract = {
  findingsList: rpcContract.findingsList,
  findingsGet: rpcContract.findingsGet,
  findingsActivityList: rpcContract.findingsActivityList,
  findingsCommentsList: rpcContract.findingsCommentsList,
  findingsCommentsCreate: rpcContract.findingsCommentsCreate,
  findingsCommentsUpdate: rpcContract.findingsCommentsUpdate,
  findingsCommentsDelete: rpcContract.findingsCommentsDelete,
  findingsFacets: rpcContract.findingsFacets,
} as const;

const savedFilterSchema = z.object({
  severity: z.array(z.string().min(1).max(100)).max(20).optional(),
  reachability: z.enum(["reachable", "unreachable", "unknown"]).optional(),
  kev: z.enum(["kev", "vc-kev", "none"]).optional(),
  epssGte: z.number().min(0).max(1).optional(),
  component: z.string().max(512).optional(),
  cve: z.string().max(512).optional(),
  triage: z.array(z.string().min(1).max(100)).max(50).optional(),
  findingType: z.array(z.string().min(1).max(100)).max(50).optional(),
  localState: z.array(z.enum(["none", "local", "conflicted", "stale", "needs_completion"])).max(5).optional(),
}).strict();
const savedViewSchema = z.object({
  schema: z.literal("fs-findings-view/v1"),
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(100),
  filter: savedFilterSchema,
  sort: z.array(z.object({ field: z.literal("risk"), direction: z.literal("desc") }).strict()).length(1),
  columns: z.array(z.string().min(1).max(100)).min(1).max(20),
}).strict();
const savedViewsDocumentSchema = z.object({
  schema: z.literal("fs-findings-views/v1"),
  views: z.array(savedViewSchema).max(100),
}).strict();
const savedViewsResultSchema = z.object({
  views: z.array(savedViewSchema),
  sha256: z.string().length(64).nullable(),
  recoveredFromCorrupt: z.boolean(),
}).strict();
const findingsUiListInputSchema = z.object({
  projectId: z.string().min(1).max(512),
  projectVersionId: z.string().min(1).max(512),
  pageSize: z.number().int().min(1).max(200),
  continuation: z.string().min(1).max(4096).nullable(),
  filters: savedFilterSchema,
}).strict();

export const findingsUiRpcContract = defineRpcContract({
  findingsUiList: {
    input: findingsUiListInputSchema,
    output: rpcContract.findingsList.output,
  },
  cachedProjectVersions: {
    input: z.object({ projectId: z.string().min(1).max(512) }).strict(),
    output: z.object({
      versions: z.array(z.object({
        platformProjectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        asOf: z.string().nullable(),
        state: z.enum(["fresh", "stale"]),
      }).strict()),
      selectedPlatformProjectId: z.string().min(1).max(512).nullable(),
      selectedProjectVersionId: z.string().min(1).max(512).nullable(),
    }).strict(),
  },
  findingsSavedViewsGet: {
    input: z.object({ projectId: z.string().min(1).max(512) }).strict(),
    output: savedViewsResultSchema,
  },
  findingsSavedViewsPut: {
    input: z.object({
      projectId: z.string().min(1).max(512),
      expectedSha256: z.string().length(64).nullable(),
      views: z.array(savedViewSchema).max(100),
    }).strict(),
    output: savedViewsResultSchema,
  },
  findingDetailGet: {
    input: z.object({
      projectId: z.string().min(1).max(512),
      projectVersionId: z.string().min(1).max(512),
      stableKey: z.string().min(1).max(512),
    }).strict(),
    output: z.object({
      state: z.enum(["resolved", "stale", "orphaned"]),
      tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
      rows: z.array(rpcContract.findingsGet.output).max(200),
      cache: rpcContract.findingsList.output.shape.cache,
    }).strict(),
  },
  findingActivityRefresh: {
    input: z.object({
      projectId: z.string().min(1).max(512),
      projectVersionId: z.string().min(1).max(512),
      findingId: z.string().min(1).max(512),
    }).strict(),
    output: z.object({ hydrated: z.number().int().nonnegative() }).strict(),
  },
});

const SAVED_VIEWS_PATH = "product-security/findings/views.json";

async function projectSource(bb: BbPluginApi, projectId: string) {
  const project = await bb.sdk.projects.get({ projectId });
  const source = project.sources.find(candidate => candidate.isDefault) ?? project.sources[0];
  if (!source) throw new Error("FINDINGS_PROJECT_SOURCE_REQUIRED");
  return source;
}

function missingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b|not found|does not exist/iu.test(message);
}

function decodeFile(content: string, encoding: "utf8" | "base64"): string {
  return encoding === "utf8" ? content : Buffer.from(content, "base64").toString("utf8");
}

async function readSavedViews(bb: BbPluginApi, projectId: string) {
  const source = await projectSource(bb, projectId);
  const path = join(source.path, SAVED_VIEWS_PATH);
  try {
    const file = await bb.sdk.files.read({ hostId: source.hostId, path, rootPath: source.path });
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeFile(file.content, file.contentEncoding));
    } catch {
      decoded = null;
    }
    const parsed = savedViewsDocumentSchema.safeParse(decoded);
    if (parsed.success) {
      return { views: parsed.data.views, sha256: file.sha256, recoveredFromCorrupt: false };
    }

    const quarantinePath = `${path}.corrupt-${file.sha256.slice(0, 12)}.json`;
    try {
      await bb.sdk.files.write({
        hostId: source.hostId,
        path: quarantinePath,
        rootPath: source.path,
        content: decodeFile(file.content, file.contentEncoding),
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256: null,
      });
    } catch {
      // A previous read may already have quarantined these exact bytes.
    }
    const repaired = await bb.sdk.files.write({
      hostId: source.hostId,
      path,
      rootPath: source.path,
      content: `${JSON.stringify({ schema: "fs-findings-views/v1", views: [] }, null, 2)}\n`,
      contentEncoding: "utf8",
      createParents: true,
      expectedSha256: file.sha256,
    });
    if (repaired.outcome !== "written") throw new Error("FINDINGS_SAVED_VIEWS_CONFLICT");
    return { views: [], sha256: repaired.sha256, recoveredFromCorrupt: true };
  } catch (error) {
    if (missingFile(error)) return { views: [], sha256: null, recoveredFromCorrupt: false };
    throw error;
  }
}

async function writeSavedViews(
  bb: BbPluginApi,
  input: { projectId: string; expectedSha256: string | null; views: z.output<typeof savedViewSchema>[] },
) {
  const source = await projectSource(bb, input.projectId);
  const result = await bb.sdk.files.write({
    hostId: source.hostId,
    path: join(source.path, SAVED_VIEWS_PATH),
    rootPath: source.path,
    content: `${JSON.stringify({ schema: "fs-findings-views/v1", views: input.views }, null, 2)}\n`,
    contentEncoding: "utf8",
    createParents: true,
    expectedSha256: input.expectedSha256,
  });
  if (result.outcome !== "written") throw new Error("FINDINGS_SAVED_VIEWS_CONFLICT");
  return { views: input.views, sha256: result.sha256, recoveredFromCorrupt: false };
}

function requireVersion(projectVersionId: string | null): string {
  if (projectVersionId === null) throw new Error("FINDINGS_PROJECT_VERSION_REQUIRED");
  return projectVersionId;
}

function stringArray(filters: Record<string, JsonValue>, key: string): string[] | undefined {
  const value = filters[key];
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === "string");
  return result.length > 0 ? result : undefined;
}

function stringValue(filters: Record<string, JsonValue>, key: string): string | undefined {
  const value = filters[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(filters: Record<string, JsonValue>, key: string): number | undefined {
  const value = filters[key];
  return typeof value === "number" ? value : undefined;
}

function booleanValue(filters: Record<string, JsonValue>, key: string): boolean | undefined {
  const value = filters[key];
  return typeof value === "boolean" ? value : undefined;
}

function findingFilter(input: {
  projectId: string;
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}): FindingsFilter {
  const filters = input.filters ?? {};
  const reachability = stringValue(filters, "reachability");
  const kev = stringValue(filters, "kev");
  if (reachability && reachability !== "reachable" && reachability !== "unreachable" && reachability !== "unknown") {
    throw new Error("FINDINGS_FILTER_INVALID: reachability");
  }
  if (kev && kev !== "kev" && kev !== "vc-kev" && kev !== "none") {
    throw new Error("FINDINGS_FILTER_INVALID: kev");
  }
  const normalizedReachability = reachability as FindingsFilter["reachability"];
  const normalizedKev = kev as FindingsFilter["kev"];
  return {
    projectId: input.projectId,
    pvId: requireVersion(input.projectVersionId),
    limit: input.pageSize,
    ...(input.continuation ? { cursor: input.continuation } : {}),
    ...(stringArray(filters, "severity") ? { severity: stringArray(filters, "severity") } : {}),
    ...(normalizedReachability ? { reachability: normalizedReachability } : {}),
    ...(normalizedKev ? { kev: normalizedKev } : {}),
    ...(numberValue(filters, "epssGte") !== undefined ? { epssGte: numberValue(filters, "epssGte") } : {}),
    ...(stringValue(filters, "component") ? { component: stringValue(filters, "component") } : {}),
    ...(stringValue(filters, "cve") ? { cve: stringValue(filters, "cve") } : {}),
    ...(stringArray(filters, "triage") ? { triage: stringArray(filters, "triage") } : {}),
    ...(stringArray(filters, "findingType") ? { findingType: stringArray(filters, "findingType") } : {}),
    ...(booleanValue(filters, "hasLocalChange") !== undefined
      ? { hasLocalChange: booleanValue(filters, "hasLocalChange") }
      : {}),
    ...(stringArray(filters, "localState") ? {
      localState: stringArray(filters, "localState")?.filter(
        (value): value is NonNullable<FindingsFilter["localState"]>[number] =>
          value === "none" || value === "local" || value === "conflicted" || value === "stale" || value === "needs_completion",
      ),
    } : {}),
  };
}

function fields(finding: CachedFinding): Record<string, JsonValue> {
  return {
    stableKey: finding.stableKey,
    findingType: finding.findingType,
    cve: finding.cve,
    title: finding.title,
    componentName: finding.componentName,
    componentGroup: finding.componentGroup,
    componentVersion: finding.componentVersion,
    componentPurl: finding.componentPurl,
    severity: finding.severity,
    riskScore: finding.riskScore,
    band: finding.band,
    cvssScore: finding.cvssScore,
    cvssVector: finding.cvssVector,
    epssScore: finding.epssScore,
    epssPercentile: finding.epssPercentile,
    inKev: finding.inKev,
    inVcKev: finding.inVcKev,
    hasExploit: finding.hasExploit,
    exploitMaturity: finding.exploitMaturity,
    reachabilityScore: finding.reachabilityScore,
    reachabilityVerdict: finding.reachabilityVerdict,
    reachabilityFactors: finding.reachabilityFactors,
    vulnInDataset: finding.vulnInDataset,
    cwes: finding.cwes,
    warningCount: finding.warningCount,
    violationCount: finding.violationCount,
    location: finding.location,
    vexStatus: finding.vexStatus,
    vexResponse: finding.vexResponse,
    vexJustification: finding.vexJustification,
    vexReason: finding.vexReason,
    commentCount: finding.comments.length,
    firstSeen: finding.firstSeen,
    softDeleted: finding.softDeleted,
    pulledAt: finding.pulledAt,
    localState: finding.localState,
    localFile: finding.localFile,
  };
}

interface LocalVexRow {
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  evidence: string | null;
  file_path: string;
  local_state: string;
  drift_state: string | null;
}

function projectedLocalState(row: LocalVexRow | undefined): "none" | "local" | "conflicted" | "stale" | "needs_completion" {
  if (!row) return "none";
  if (row.local_state === "conflict" || row.drift_state === "conflict") return "conflicted";
  if (row.local_state === "needs_completion" || row.drift_state === "needs_completion") return "needs_completion";
  if (row.local_state === "stale" || row.drift_state === "stale" || row.drift_state === "orphaned") return "stale";
  return "local";
}

function localVexFields(
  db: Database.Database,
  finding: CachedFinding,
): Record<string, JsonValue> {
  const row = db.prepare(
    `SELECT vex_status, vex_response, vex_justification, vex_reason, evidence,
            file_path, local_state, drift_state
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND stable_key = ?`,
  ).get(finding.projectId, finding.projectVersionId, finding.stableKey) as LocalVexRow | undefined;
  return {
    ...fields(finding),
    localVexStatus: row?.vex_status ?? null,
    localVexResponse: row?.vex_response ?? null,
    localVexJustification: row?.vex_justification ?? null,
    localVexReason: row?.vex_reason ?? null,
    localEvidence: row?.evidence ?? null,
    localState: projectedLocalState(row),
    localFile: row?.file_path ?? null,
    componentSlug: typeof finding.raw["componentSlug"] === "string"
      ? finding.raw["componentSlug"]
      : typeof finding.raw["architectureComponentSlug"] === "string"
        ? finding.raw["architectureComponentSlug"]
        : null,
    remediation: typeof finding.raw["remediation"] === "string"
      ? finding.raw["remediation"]
      : typeof finding.raw["recommendation"] === "string"
        ? finding.raw["recommendation"]
        : null,
  };
}

function summary(finding: CachedFinding) {
  return {
    projectId: finding.projectId,
    projectVersionId: finding.projectVersionId,
    kind: "finding",
    key: finding.findingId,
    label: finding.title ?? finding.cve ?? finding.findingId,
    fields: fields(finding),
  };
}

function findingsListResult(db: Database.Database, input: z.output<typeof findingsUiListInputSchema>) {
  const page = queryFindings(db, findingFilter(input));
  return {
    items: page.items.map(summary),
    total: page.total,
    next: page.nextCursor,
    cache: page.cache,
  };
}

export function registerFindingsRpc(
  bb: BbPluginApi,
  db: Database.Database,
  deps: {
    hydrateActivity?: (input: {
      projectId: string;
      projectVersionId: string;
      findingId: string;
    }) => Promise<number>;
  } = {},
): void {
  bb.rpc.register(findingsRpcContract, {
    findingsList(input) {
      const page = queryFindings(db, findingFilter(input));
      return {
        items: page.items.map(summary),
        total: page.total,
        next: page.nextCursor,
        cache: page.cache,
      };
    },
    findingsGet(input) {
      const pvId = requireVersion(input.projectVersionId);
      const cached = getCachedFinding(db, input.projectId, pvId, input.findingId);
      if (!cached.finding) throw new Error("FINDING_NOT_FOUND");
      return { ...summary(cached.finding), links: [], cache: cached.cache };
    },
    findingsActivityList(input) {
      // pagedScopedInput's frozen helper erases its extra-field type while its
      // runtime schema still validates and retains findingId.
      const findingId = (input as typeof input & { findingId: string }).findingId;
      const pvId = requireVersion(input.projectVersionId);
      const page = listFindingActivity(db, {
        projectId: input.projectId,
        projectVersionId: pvId,
        findingId,
        limit: input.pageSize,
        ...(input.continuation ? { cursor: input.continuation } : {}),
      });
      return {
        items: page.items.map(item => ({
          projectId: item.projectId,
          projectVersionId: item.projectVersionId,
          kind: "findingActivity",
          key: item.eventId,
          label: item.source ?? item.eventId,
          fields: {
            findingId: item.findingId,
            stableKey: item.stableKey,
            actor: item.actor,
            at: item.eventAt,
            source: item.source,
            old: item.oldTuple,
            new: item.newTuple,
            pulledAt: item.pulledAt,
          },
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    findingsCommentsList(input) {
      // See the frozen pagedScopedInput type-erasure note above.
      const findingId = (input as typeof input & { findingId: string }).findingId;
      const pvId = requireVersion(input.projectVersionId);
      const page = listFindingComments(db, {
        projectId: input.projectId,
        projectVersionId: pvId,
        findingId,
        limit: input.pageSize,
        ...(input.continuation ? { cursor: input.continuation } : {}),
      });
      return {
        items: page.items.map(comment => ({
          projectId: input.projectId,
          projectVersionId: pvId,
          id: comment.id,
          findingId: comment.findingId,
          actorLabel: comment.actorLabel,
          text: comment.text,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          carriesAcrossVersions: false as const,
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    findingsCommentsCreate() { return commentMutationAuthorizationUnavailable(); },
    findingsCommentsUpdate() { return commentMutationAuthorizationUnavailable(); },
    findingsCommentsDelete() { return commentMutationAuthorizationUnavailable(); },
    findingsFacets(input) {
      const pvId = requireVersion(input.projectVersionId);
      const page = queryFindings(db, { projectId: input.projectId, pvId, limit: 1 });
      return {
        projectId: input.projectId,
        projectVersionId: pvId,
        severity: page.facets.severity ?? {},
        triage: page.facets.triage ?? {},
        total: page.total,
        cache: page.cache,
      };
    },
  });
  bb.rpc.register(findingsUiRpcContract, {
    findingsUiList(input) {
      return findingsListResult(db, input);
    },
    cachedProjectVersions(input) {
      // The input is a bb workspace project id; validate that local project
      // boundary, then derive remote cache scopes from SQLite. Never reuse a
      // bb id as the Platform project id stored in sync_state.
      const project = projectSource(bb, input.projectId);
      const rows = db.prepare(
        `SELECT project_id, project_version_id, MAX(last_pull) AS as_of,
                MAX(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS stale
           FROM sync_state
          WHERE entity_kind = 'finding'
            AND accepted_generation_id IS NOT NULL
          GROUP BY project_id, project_version_id
          ORDER BY as_of DESC, project_id ASC, project_version_id ASC`,
      ).all() as Array<{ project_id: string; project_version_id: string; as_of: string | null; stale: number }>;
      return project.then(() => {
        const versions = rows.map(row => ({
          platformProjectId: row.project_id,
          projectVersionId: row.project_version_id,
          asOf: row.as_of,
          state: row.stale === 1 ? "stale" as const : "fresh" as const,
        }));
        return {
          versions,
          selectedPlatformProjectId: versions[0]?.platformProjectId ?? null,
          selectedProjectVersionId: versions[0]?.projectVersionId ?? null,
        };
      });
    },
    findingsSavedViewsGet(input) {
      return readSavedViews(bb, input.projectId);
    },
    findingsSavedViewsPut(input) {
      return writeSavedViews(bb, input);
    },
    findingDetailGet(input) {
      // Stable route attributes are untrusted. The frozen codec must reject
      // them before the first cache read or prepared statement.
      parseEncodedFindingKey(input.stableKey);
      const resolution = resolveEncodedFinding(
        db,
        input.stableKey,
        input.projectId,
        input.projectVersionId,
      );
      const cache = findingsCacheState(db, input.projectId, input.projectVersionId);
      const rows = resolution.state === "orphaned"
        ? []
        : resolution.state === "stale"
          ? resolution.candidates
          : resolution.rows;
      const tier = resolution.state === "resolved" ? resolution.tier : null;
      return {
        state: resolution.state,
        tier,
        rows: rows.map(finding => ({
          ...summary(finding),
          fields: localVexFields(db, finding),
          links: [],
          cache,
        })),
        cache,
      };
    },
    async findingActivityRefresh(input) {
      if (!deps.hydrateActivity) throw new Error("FINDING_ACTIVITY_REFRESH_UNAVAILABLE");
      return { hydrated: await deps.hydrateActivity(input) };
    },
  });
}
