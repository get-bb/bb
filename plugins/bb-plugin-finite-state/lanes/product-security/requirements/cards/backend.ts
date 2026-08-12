import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../../../lib/context.js";
import {
  fromStorageProjectVersionId,
  PROJECT_LEVEL_VERSION_ID,
  toStorageProjectVersionId,
} from "../../../../lib/store/index.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import type { JsonValue } from "../../../../shared/contract.js";
import { rpcContract } from "../../../../shared/contract.js";
import { createSdkRequirementRepository, type RequirementDocument } from "./adapter.js";
import {
  cardModelToFields,
  loadRequirementCardModel,
} from "./query.js";
import type { RequirementCardModel } from "./schema.js";
import { validateRequirement } from "./validator.js";

const requirementsRpcContract = {
  requirementsList: rpcContract.requirementsList,
  requirementsGet: rpcContract.requirementsGet,
  requirementsWrite: rpcContract.requirementsWrite,
} as const;

interface CacheRow {
  accepted_generation_id: string | null;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
}

interface SnapshotRow {
  entity_key: string;
  payload: string;
}

interface VersionRow {
  project_version_id: string;
}

const CACHE_MESSAGE_MAX_LENGTH = 500;

function truncateDetail(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

function cacheMessageWithDiagnostics(
  cacheMessage: string | null,
  diagnostics: readonly {
    artifactId: string;
    line: number;
    code: string;
    message: string;
  }[],
): string | null {
  if (diagnostics.length === 0) return cacheMessage;
  const prefix = cacheMessage ? `${truncateDetail(cacheMessage, 200)} ` : "";
  const remainingCount = diagnostics.length - 1;
  const remainder = remainingCount === 0
    ? ""
    : ` And ${remainingCount} more invalid requirement ${remainingCount === 1 ? "file" : "files"}.`;
  const available = Math.max(0, CACHE_MESSAGE_MAX_LENGTH - prefix.length - remainder.length);
  const first = diagnostics[0];
  const firstDetail = first
    ? `${first.artifactId}:${first.line} ${first.code}: ${first.message}`
    : "Invalid requirement YAML.";
  return `${prefix}${truncateDetail(firstDetail, available)}${remainder}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFilters(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) return {};
  const filters = value.filters;
  if (!isRecord(filters)) return {};
  const parsed: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(filters)) {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) parsed[key] = entry;
  }
  return parsed;
}

function matchesFilters(model: RequirementCardModel, filters: Record<string, JsonValue>): boolean {
  const { requirement } = model;
  for (const [key, value] of Object.entries(filters)) {
    if (key === "query" && typeof value === "string") {
      const query = value.toLocaleLowerCase();
      if (!`${requirement.id} ${requirement.ears.text}`.toLocaleLowerCase().includes(query)) return false;
    } else if (key === "pattern" && value !== requirement.ears.pattern) return false;
    else if (key === "req_type" && value !== requirement.req_type) return false;
    else if (key === "priority" && value !== requirement.priority) return false;
    else if (key === "evidence" && value !== model.evidenceState) return false;
    else if (key === "local" && value === true && !model.local) return false;
    else if (key === "stale" && value === true && !model.stale) return false;
  }
  return true;
}

function cacheState(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
): {
  state: "fresh" | "stale" | "empty";
  asOf: string | null;
  message: string | null;
  acceptedGenerationId: string | null;
  baseRevision: number;
} {
  const row = db
    .prepare<[string, string], CacheRow>(
      `SELECT accepted_generation_id, base_revision, last_pull, error
         FROM sync_state
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
    )
    .get(projectId, toStorageProjectVersionId(projectVersionId));
  if (!row?.accepted_generation_id) {
    return {
      state: "empty",
      asOf: row?.last_pull ?? null,
      message: "No accepted evidence cache is available; showing tracked local requirements.",
      acceptedGenerationId: null,
      baseRevision: row?.base_revision ?? 0,
    };
  }
  return {
    state: row.error ? "stale" : "fresh",
    asOf: row.last_pull,
    message: row.error
      ? "The last evidence refresh failed; showing the accepted cache and local YAML."
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
  const rows = db
    .prepare<[string, string, string], SnapshotRow>(
      `SELECT entity_key, payload
         FROM base_snapshot
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'
          AND generation_id = ?
        ORDER BY entity_key`,
    )
    .all(projectId, toStorageProjectVersionId(projectVersionId), generationId);
  return rows.flatMap((row) => {
    let value: unknown;
    try {
      value = JSON.parse(row.payload);
    } catch {
      return [];
    }
    const validated = validateRequirement(value);
    if (!validated.success) return [];
    if (row.entity_key !== reqIdKey({ reqId: validated.data.id })) {
      throw new Error(`Cached requirement ${validated.data.id} has a mismatched entity key.`);
    }
    return [{
      artifactId: `product-security/requirements/${validated.data.id}.yaml`,
      requirement: validated.data,
      sha256: null,
    }];
  });
}

async function listModels(
  ctx: PluginContext,
  documents: readonly RequirementDocument[],
  scope: { projectId: string; projectVersionId: string | null },
): Promise<RequirementCardModel[]> {
  return documents.map((document) =>
    loadRequirementCardModel(ctx.db(), scope, document.requirement, document.sha256),
  );
}

export function registerRequirementsCardsBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  const repository = createSdkRequirementRepository(bb);
  bb.rpc.register(requirementsRpcContract, {
    async requirementsList(input) {
      const projectVersionId = resolvedProjectVersionId(
        ctx.db(), input.projectId, input.projectVersionId,
      );
      const cache = cacheState(ctx.db(), input.projectId, projectVersionId);
      const filters = readFilters(input);
      const listing = await repository.list(input.projectId, { refresh: filters.refresh === true });
      const cached = cachedDocuments(
        ctx.db(),
        input.projectId,
        projectVersionId,
        cache.acceptedGenerationId,
      );
      const localById = new Map(
        listing.documents.map((document) => [document.requirement.id, document]),
      );
      const documents = [
        ...cached.filter((document) => !localById.has(document.requirement.id)),
        ...listing.documents,
      ];
      const allModels = (await listModels(
        ctx, documents, { projectId: input.projectId, projectVersionId },
      ))
        .filter((model) => matchesFilters(model, filters))
        .sort((left, right) => left.requirement.id.localeCompare(right.requirement.id));
      const after = input.continuation;
      const afterIndex = after === null
        ? -1
        : allModels.findIndex((model) => model.requirement.id === after);
      if (after !== null && afterIndex < 0) {
        throw new Error("Requirement continuation token is no longer valid.");
      }
      const start = afterIndex + 1;
      const pageSize = input.pageSize ?? 50;
      const visible = allModels.slice(start, start + pageSize);
      const next = start + pageSize < allModels.length
        ? visible.at(-1)?.requirement.id ?? null
        : null;
      return {
        items: visible.map((model) => ({
          projectId: input.projectId,
          projectVersionId,
          kind: "requirement",
          key: model.requirement.id,
          label: model.requirement.id,
          fields: cardModelToFields(model),
        })),
        total: allModels.length,
        next,
        cache: {
          ...cache,
          message: cacheMessageWithDiagnostics(cache.message, listing.diagnostics),
        },
      };
    },
    async requirementsGet(input) {
      const projectVersionId = resolvedProjectVersionId(
        ctx.db(), input.projectId, input.projectVersionId,
      );
      const cache = cacheState(ctx.db(), input.projectId, projectVersionId);
      let document = await repository.read(input.projectId, input.requirementId);
      if (!document) {
        document = cachedDocuments(
          ctx.db(), input.projectId, projectVersionId, cache.acceptedGenerationId,
        ).find((candidate) => candidate.requirement.id === input.requirementId) ?? null;
      }
      if (!document) throw new Error(`Requirement ${input.requirementId} was not found locally.`);
      const model = loadRequirementCardModel(
        ctx.db(),
        { projectId: input.projectId, projectVersionId },
        document.requirement,
        document.sha256,
      );
      return {
        projectId: input.projectId,
        projectVersionId,
        kind: "requirement",
        key: document.requirement.id,
        label: document.requirement.id,
        fields: cardModelToFields(model),
        links: [],
        cache,
      };
    },
    async requirementsWrite(input) {
      const validated = validateRequirement(input.fields);
      if (!validated.success) {
        const first = validated.errors[0];
        throw new Error(first ? `${first.code}: ${first.message}` : "Requirement is invalid.");
      }
      if (validated.data.id !== input.requirementId) {
        throw new Error("Requirement id must match the immutable RPC requirementId.");
      }
      const write = await repository.write(
        input.projectId,
        validated.data,
        input.expectedContentSha256,
      );
      if (write.outcome === "conflict") {
        throw new Error(
          `LOCAL_WRITE_CONFLICT: requirement changed on disk (current ${write.currentSha256 ?? "missing"}).`,
        );
      }
      bb.realtime.publish("requirements:changed", {
        projectId: input.projectId,
        requirementId: input.requirementId,
      });
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        stableKey: input.requirementId,
        beforeSha256: input.expectedContentSha256,
        afterSha256: write.sha256,
        changedFields: Object.keys(input.fields).sort(),
        diffSummary: `Updated product-security/requirements/${input.requirementId}.yaml with compare-and-swap; no upstream mutation.`,
      };
    },
  });
}
