import { useCallback, useEffect, useState } from "react";
import type { BbPluginApi } from "@bb/plugin-sdk";
import { useBbContext, useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../../../lib/context.js";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";
import type { JsonValue } from "../../../../shared/contract.js";
import { rpcContract } from "../../../../shared/contract.js";
import { createSdkRequirementRepository, type RequirementDocument } from "./adapter.js";
import { RequirementList, type RequirementListState } from "./RequirementList.js";
import {
  cardModelFromFields,
  cardModelToFields,
  loadRequirementCardModel,
} from "./query.js";
import { requirementCardModelSchema, type RequirementCardModel } from "./schema.js";
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
  content_hash: string;
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
      `SELECT entity_key, payload, content_hash
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
    return [{
      artifactId: `product-security/requirements/${validated.data.id}.yaml`,
      requirement: validated.data,
      sha256: row.content_hash,
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
      const cache = cacheState(ctx.db(), input.projectId, input.projectVersionId);
      let documents = await repository.list(input.projectId);
      if (documents.length === 0) {
        documents = cachedDocuments(
          ctx.db(),
          input.projectId,
          input.projectVersionId,
          cache.acceptedGenerationId,
        );
      }
      const filters = readFilters(input);
      const allModels = (await listModels(ctx, documents, input))
        .filter((model) => matchesFilters(model, filters))
        .sort((left, right) => left.requirement.id.localeCompare(right.requirement.id));
      const after = input.continuation;
      const start = after === null
        ? 0
        : Math.max(0, allModels.findIndex((model) => model.requirement.id === after) + 1);
      const pageSize = input.pageSize ?? 50;
      const visible = allModels.slice(start, start + pageSize);
      const next = start + pageSize < allModels.length
        ? visible.at(-1)?.requirement.id ?? null
        : null;
      return {
        items: visible.map((model) => ({
          projectId: input.projectId,
          projectVersionId: input.projectVersionId,
          kind: "requirement",
          key: model.requirement.id,
          label: model.requirement.id,
          fields: cardModelToFields(model),
        })),
        total: allModels.length,
        next,
        cache,
      };
    },
    async requirementsGet(input) {
      const cache = cacheState(ctx.db(), input.projectId, input.projectVersionId);
      let document = await repository.read(input.projectId, input.requirementId);
      if (!document) {
        document = cachedDocuments(
          ctx.db(), input.projectId, input.projectVersionId, cache.acceptedGenerationId,
        ).find((candidate) => candidate.requirement.id === input.requirementId) ?? null;
      }
      if (!document) throw new Error(`Requirement ${input.requirementId} was not found locally.`);
      const model = loadRequirementCardModel(ctx.db(), input, document.requirement, document.sha256);
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
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

function payloadProjectId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.projectId === "string" ? value.projectId : null;
}

export function RequirementsCards(): React.JSX.Element {
  const { projectId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<RequirementListState>(projectId ? "loading" : "unconfigured");
  const [models, setModels] = useState<RequirementCardModel[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async (continuation: string | null) => {
    if (!projectId) return;
    if (continuation === null) setState("loading");
    const request = {
      projectId,
      projectVersionId: null,
      pageSize: 100,
      continuation,
      filters: {},
    };
    try {
      const page = await rpc.call("requirementsList", request);
      const pageModels = page.items.map((item) => requirementCardModelSchema.parse(item.fields));
      setModels((current) => continuation === null
        ? pageModels
        : [...current, ...pageModels.filter((nextModel) =>
            !current.some((currentModel) => currentModel.requirement.id === nextModel.requirement.id),
          )]);
      setNext(page.next);
      setMessage(page.cache.message);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Requirements could not be read.");
      setState("error");
    }
  }, [projectId, rpc]);

  useRealtime("requirements:changed", (payload) => {
    if (projectId && payloadProjectId(payload) === projectId) setRevision((value) => value + 1);
  });

  useEffect(() => {
    if (!projectId) {
      setState("unconfigured");
      setModels([]);
      return;
    }
    void load(null);
  }, [load, projectId, revision]);

  return (
    <section className="h-full min-h-0 bg-background text-foreground" aria-label="EARS requirements">
      <RequirementList
        hasNextPage={next !== null}
        message={message}
        models={models}
        onLoadMore={() => void load(next)}
        onRetry={() => setRevision((value) => value + 1)}
        state={state}
      />
    </section>
  );
}

export { cardModelFromFields };
