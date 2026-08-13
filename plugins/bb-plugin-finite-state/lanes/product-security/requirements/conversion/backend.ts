import { join } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { PluginContext } from "../../../../lib/context.js";
import {
  fromStorageProjectVersionId,
  PROJECT_LEVEL_VERSION_ID,
  toStorageProjectVersionId,
} from "../../../../lib/store/index.js";
import { parseKey } from "../../../../lib/sync/registry.js";
import {
  HUMAN_APPROVAL_CAPABILITY_POLICY,
  jsonValueSchema,
  rpcContract,
} from "../../../../shared/contract.js";
import {
  type ConversionCheckSource,
  type ConversionDeps,
  type ConversionPullSnapshot,
  type ConversionReferenceIndex,
  type ConversionSource,
} from "./bundle.js";
import {
  getConversionReport,
  recordHumanReview,
  refreshConversion,
  startConversion,
  type ConversionReport,
} from "./report.js";
import { requirementIdSchema } from "../cards/schema.js";

const conversionDiffValueSchema = z.object({
  present: z.boolean(),
  value: jsonValueSchema,
}).strict();
const conversionDiffItemSchema = z.object({
  key: z.string().min(1).max(1000),
  label: requirementIdSchema,
  operation: z.enum(["create", "update", "delete", "noop", "conflict", "orphan"]),
  fields: z.array(z.object({
    field: z.string().min(1).max(1000),
    base: conversionDiffValueSchema,
    ours: conversionDiffValueSchema,
    theirs: conversionDiffValueSchema,
  }).strict()).max(100),
}).strict();

export const conversionRpcContract = {
  earsConversionStart: rpcContract.earsConversionStart,
  earsConversionGet: {
    input: rpcContract.earsConversionGet.input,
    output: rpcContract.earsConversionGet.output.extend({
      diff: z.array(conversionDiffItemSchema).max(500),
      diffComplete: z.boolean(),
    }).strict(),
  },
  earsConversionReview: rpcContract.earsConversionReview,
} as const;
export type ConversionRpcContract = typeof conversionRpcContract;

const REQUIREMENTS_DIRECTORY = "product-security/requirements";
const RESULT_SUMMARY_LIMIT = 20;
const DETAIL_LIMIT = 500;
const REQUIREMENT_TYPES = new Set(["security", "privacy", "safety", "regulatory", "operational"]);
const WORKFLOW_STATUSES = new Set(["draft", "approved", "implemented", "verified"]);
const VERIFICATION_METHODS = new Set([
  "config_check", "sbom_query", "binary_analysis", "binary_pattern", "vuln_absence",
  "dynamic", "external_sync", "manual", "attestation", "document_review",
]);
const VERIFICATION_TIERS = new Set(["static", "emulation", "hil", "manual"]);

interface CacheRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface VersionRow { project_version_id: string }
interface SnapshotRow { entity_key: string; remote_id: string | null; payload: string }
interface IdMapRow { entity_kind: string; entity_key: string; remote_id: string }
interface CheckRow {
  check_id: string;
  code: string;
  check_type: string;
  description: string | null;
  pass_criteria: string | null;
  fail_criteria: string | null;
  raw: string;
  is_required: 0 | 1;
  coverage_level: string | null;
  suppressed: 0 | 1;
}
interface ResultRow { tier: string; status: string; evidence_summary: string | null; executed_at: string | null }
interface VocabularyRow { slug: string; remote_id: string }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function parseRecordJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  const result = record(parsed);
  if (!result) throw new Error("Accepted requirement cache payload must be a JSON object.");
  return result;
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return null;
}

function stringList(value: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }
  }
  return [];
}

function oneOf<T extends string>(candidate: string | null, allowed: ReadonlySet<string>, fallback: T): T {
  return candidate !== null && allowed.has(candidate) ? candidate as T : fallback;
}

function stableSlug(entityKey: string): string {
  const segments = parseKey(entityKey);
  const slug = segments.at(-1);
  if (!slug) throw new Error("Accepted id_map key does not contain a stable slug.");
  return slug;
}

function decodeText(content: string, encoding: "utf8" | "base64"): string {
  return encoding === "utf8" ? content : Buffer.from(content, "base64").toString("utf8");
}

function missingFile(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b|not found|does not exist/iu.test(detail);
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

function cacheRow(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
): CacheRow | undefined {
  return db.prepare<[string, string], CacheRow>(
    `SELECT accepted_generation_id, base_revision, last_pull, error
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
  ).get(projectId, toStorageProjectVersionId(projectVersionId));
}

function referenceIndex(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  generationId: string,
  requirements: readonly SnapshotRow[],
): ConversionReferenceIndex {
  const storageVersion = toStorageProjectVersionId(projectVersionId);
  const idRows = db.prepare<[string, string, string], IdMapRow>(
    `SELECT entity_kind, entity_key, remote_id
       FROM id_map
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
      ORDER BY entity_kind, entity_key`,
  ).all(projectId, storageVersion, generationId);
  const checks = db.prepare<[string, string, string], VocabularyRow>(
    `SELECT code AS slug, check_id AS remote_id
       FROM verification_checks
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
      ORDER BY code`,
  ).all(projectId, storageVersion, generationId);
  const standards = db.prepare<[string, string, string], VocabularyRow>(
    `SELECT clause_code AS slug, clause_id AS remote_id
       FROM standards_clauses
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
      ORDER BY clause_code`,
  ).all(projectId, storageVersion, generationId);
  const requirementRefs = new Map<string, string>();
  for (const row of requirements) {
    const fields = parseRecordJson(row.payload);
    const id = stringField(fields, "id", "req_id", "reqId", "key");
    if (id && requirementIdSchema.safeParse(id).success && row.remote_id) {
      requirementRefs.set(id, row.remote_id);
    }
  }
  const mitigations = new Map<string, string>();
  const controls = new Map<string, string>();
  for (const row of idRows) {
    if (row.entity_kind === "mitigation") mitigations.set(stableSlug(row.entity_key), row.remote_id);
    if (row.entity_kind === "control") controls.set(stableSlug(row.entity_key), row.remote_id);
  }
  return {
    requirements: requirementRefs,
    checks: new Map(checks.map((row) => [row.slug, row.remote_id])),
    mitigations,
    controls,
    standards: new Map(standards.map((row) => [row.slug, row.remote_id])),
  };
}

function normalizeReferences(values: readonly string[], remoteToSlug: ReadonlyMap<string, string>): string[] {
  return [...new Set(values.map((value) => remoteToSlug.get(value) ?? value))];
}

function checkSources(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  generationId: string,
  requirementKey: string,
): ConversionCheckSource[] {
  const storageVersion = toStorageProjectVersionId(projectVersionId);
  const checks = db.prepare<[string, string, string, string], CheckRow>(
    `SELECT checks.check_id, checks.code, checks.check_type, checks.description,
            checks.pass_criteria, checks.fail_criteria, checks.raw,
            mapping.is_required, mapping.coverage_level, mapping.suppressed
       FROM requirement_check_mappings mapping
       JOIN verification_checks checks
         ON checks.project_id = mapping.project_id
        AND checks.project_version_id = mapping.project_version_id
        AND checks.generation_id = mapping.generation_id
        AND checks.check_id = mapping.check_id
      WHERE mapping.project_id = ? AND mapping.project_version_id = ?
        AND mapping.generation_id = ? AND mapping.requirement_key = ?
      ORDER BY checks.code
      LIMIT 1000`,
  ).all(projectId, storageVersion, generationId, requirementKey);
  return checks.map((check) => {
    if (!check.pass_criteria) throw new Error(`Pulled check ${check.code} has no pass criteria to preserve.`);
    const results = db.prepare<[string, string, string, string, string], ResultRow>(
      `SELECT tier, status, evidence_summary, executed_at
         FROM verification_results
        WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
          AND requirement_key = ? AND check_id = ? AND is_latest = 1
        ORDER BY executed_at DESC, result_id
        LIMIT ${RESULT_SUMMARY_LIMIT}`,
    ).all(projectId, storageVersion, generationId, requirementKey, check.check_id);
    const raw = (() => {
      try { return parseRecordJson(check.raw); } catch { return {}; }
    })();
    const tier = oneOf(
      stringField(raw, "tier") ?? results[0]?.tier ?? null,
      VERIFICATION_TIERS,
      "static" as const,
    );
    return {
      id: check.check_id,
      slug: check.code,
      method: oneOf(check.check_type, VERIFICATION_METHODS, "document_review" as const),
      tier,
      required: check.is_required === 1,
      coverage: check.coverage_level === "full" || check.coverage_level === "partial" || check.coverage_level === "none"
        ? check.coverage_level
        : null,
      suppressed: check.suppressed === 1,
      description: check.description,
      passCriteria: check.pass_criteria,
      failCriteria: check.fail_criteria,
      resultSummaries: results.map((result) => ({
        status: result.status,
        summary: result.evidence_summary,
        executedAt: result.executed_at,
      })),
    };
  });
}

function conversionSource(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  generationId: string,
  row: SnapshotRow,
  remoteToSlug: ReadonlyMap<string, string>,
): ConversionSource {
  const fields = parseRecordJson(row.payload);
  const requirementId = stringField(fields, "id", "req_id", "reqId", "key");
  if (!requirementId || !requirementIdSchema.safeParse(requirementId).success) {
    throw new Error("Pulled requirement is missing its stable REQ-* id.");
  }
  if (!row.remote_id) throw new Error(`Pulled requirement ${requirementId} is missing its remote id_map identity.`);
  const sourceDescription = stringField(
    fields,
    "source_description",
    "sourceDescription",
    "description",
    "statement",
    "title",
  );
  if (!sourceDescription) throw new Error(`Pulled requirement ${requirementId} has no source description.`);
  return {
    requirementId,
    remoteId: row.remote_id,
    targetPath: `${REQUIREMENTS_DIRECTORY}/${requirementId}.yaml`,
    sourceDescription,
    reqType: oneOf(stringField(fields, "req_type", "reqType"), REQUIREMENT_TYPES, "security" as const),
    priority: stringField(fields, "priority") ?? "P2",
    status: oneOf(stringField(fields, "status"), WORKFLOW_STATUSES, "draft" as const),
    rationale: stringField(fields, "rationale"),
    traces: {
      mitigations: normalizeReferences(stringList(fields, "mitigations", "threats", "threatIds"), remoteToSlug),
      controls: normalizeReferences(stringList(fields, "controls", "controlIds"), remoteToSlug),
      standards: normalizeReferences(stringList(fields, "standards", "standardIds"), remoteToSlug),
    },
    checks: checkSources(db, scope.projectId, scope.projectVersionId, generationId, row.entity_key),
    sourceDigest: "",
  };
}

function createConversionDeps(
  bb: BbPluginApi,
  ctx: PluginContext,
  scope: { projectId: string; projectVersionId: string | null },
): ConversionDeps {
  let sourcePromise: ReturnType<BbPluginApi["sdk"]["projects"]["get"]> | null = null;
  async function projectSource() {
    sourcePromise ??= bb.sdk.projects.get({ projectId: scope.projectId });
    const project = await sourcePromise;
    const source = project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
    if (!source) throw new Error("The project has no local workspace source.");
    return source;
  }
  return {
    ...scope,
    async loadPullSnapshot(): Promise<ConversionPullSnapshot | null> {
      const state = cacheRow(ctx.db(), scope.projectId, scope.projectVersionId);
      if (!state?.accepted_generation_id || !state.last_pull) return null;
      const generationId = state.accepted_generation_id;
      const storageVersion = toStorageProjectVersionId(scope.projectVersionId);
      const rows = ctx.db().prepare<[string, string, string], SnapshotRow>(
        `SELECT entity_key, remote_id, payload
           FROM base_snapshot
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'
            AND generation_id = ?
          ORDER BY entity_key
          LIMIT 10001`,
      ).all(scope.projectId, storageVersion, generationId);
      const references = referenceIndex(
        ctx.db(), scope.projectId, scope.projectVersionId, generationId, rows,
      );
      const remoteToSlug = new Map<string, string>();
      for (const index of [references.mitigations, references.controls, references.standards]) {
        for (const [slug, remoteId] of index) remoteToSlug.set(remoteId, slug);
      }
      return {
        projectId: scope.projectId,
        pulledAt: state.last_pull,
        requirements: rows.map((row) => conversionSource(
          ctx.db(), scope, generationId, row, remoteToSlug,
        )),
        references,
      };
    },
    async readLocalFile(path): Promise<string | null> {
      const source = await projectSource();
      try {
        const file = await bb.sdk.files.read({
          hostId: source.hostId,
          path: join(source.path, path),
          rootPath: source.path,
        });
        return decodeText(file.content, file.contentEncoding);
      } catch (error) {
        if (missingFile(error)) return null;
        throw error;
      }
    },
    async spawnOriginPluginThread(input) {
      const attachments = await Promise.all(input.bundlePages.map((page) =>
        bb.sdk.projects.attachments.upload({
          projectId: input.projectId,
          clientFile: new TextEncoder().encode(page.content),
          filename: page.filename,
          mimeType: "application/json",
        })));
      const thread = await bb.sdk.threads.spawn({
        projectId: input.projectId,
        environment: { type: "project-default" },
        title: input.title,
        input: [
          { type: "text", text: input.prompt, mentions: [] },
          ...attachments,
        ],
      });
      return { threadId: thread.id };
    },
  };
}

function safeDetail(value: string): string {
  return value.length <= DETAIL_LIMIT ? value : `${value.slice(0, DETAIL_LIMIT - 1)}…`;
}

function toRpcReport(ctx: PluginContext, report: ConversionReport) {
  const cache = cacheRow(ctx.db(), report.projectId, report.projectVersionId);
  return {
    projectId: report.projectId,
    projectVersionId: report.projectVersionId,
    id: report.id,
    threadId: report.threadId,
    snapshotSha256: report.snapshotSha256,
    state: report.state,
    requirementIds: report.requirementIds,
    errors: report.errors.map((error) => ({
      code: error.code,
      message: safeDetail(error.message),
      artifactId: error.artifactId,
      line: error.line,
    })),
    cache: {
      state: cache?.accepted_generation_id ? cache.error ? "stale" as const : "fresh" as const : "empty" as const,
      asOf: cache?.last_pull ?? null,
      message: cache?.error ? "The last pull failed; conversion remains bound to the accepted snapshot." : null,
      acceptedGenerationId: cache?.accepted_generation_id ?? null,
      baseRevision: cache?.base_revision ?? 0,
    },
  };
}

function toRpcReportWithDiff(ctx: PluginContext, report: ConversionReport) {
  return { ...toRpcReport(ctx, report), diff: report.diff, diffComplete: report.diffComplete };
}

function assertScope(
  report: ConversionReport,
  input: { projectId: string; projectVersionId: string | null },
): void {
  if (report.projectId !== input.projectId || report.projectVersionId !== input.projectVersionId) {
    throw new Error("Conversion does not belong to the requested project scope.");
  }
}

export function registerRequirementsConversionBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  bb.rpc.register(conversionRpcContract, {
    async earsConversionStart(input) {
      const projectVersionId = resolvedProjectVersionId(
        ctx.db(), input.projectId, input.projectVersionId,
      );
      const report = await startConversion(
        createConversionDeps(bb, ctx, { projectId: input.projectId, projectVersionId }),
        input.requirementIds,
      );
      return toRpcReport(ctx, report);
    },
    async earsConversionGet(input) {
      const current = getConversionReport(input.id);
      assertScope(current, input);
      return toRpcReportWithDiff(ctx, await refreshConversion(input.id));
    },
    earsConversionReview(input) {
      const current = getConversionReport(input.id);
      assertScope(current, input);
      if (input.decision === "reviewed") {
        throw new Error(
          `EARS conversion review ${HUMAN_APPROVAL_CAPABILITY_POLICY.handlerDisposition}: request input is not actor-authenticated approval evidence.`,
        );
      }
      return toRpcReport(ctx, recordHumanReview(
        input.id,
        "discarded",
        input.expectedSnapshotSha256,
      ));
    },
  });
}
