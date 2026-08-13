import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../../../lib/context.js";
import type { Json, RemoteServices } from "../../../../lib/remote/types.js";
import { ENTITIES, parseKey } from "../../../../lib/sync/registry.js";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";
import { rpcContract } from "../../../../shared/contract.js";
import {
  registerAdapter,
  registeredAdapters,
  type SyncScope,
} from "../../../sync/engine/adapter.js";
import { IdMapStore } from "../../../sync/store/id-map.js";
import {
  categoryFromVocabulary,
  methodologyVocabulary,
} from "../threat-overlay/aggregate.js";
import {
  createCanvasEntityAdapters,
  type AdapterSlugResolver,
} from "./adapters.js";
import {
  architectureEntityPayload,
  canvasEditingLoadInputSchema,
  canvasEditingLoadOutputSchema,
  parseArchitectureEntity,
  type CanvasEntityKind,
  type DeletionImpact,
} from "./schema.js";
import {
  computeDeletionImpact,
  registerCanvasValidators,
} from "./validators.js";
import {
  applyCanvasCommand,
  canvasDeletedMarkerKey,
  canvasDeletedMarkerPrefix,
  canvasEntityFile,
  canvasUsedSlugMarkerKey,
  createSdkCanvasFileStore,
  serializeCanvasEntity,
  type CanvasEditCommand,
  type CanvasFileStore,
  type CanvasProjectSource,
  type EditDeps,
} from "./writer.js";

export const canvasEditingRpcContract = defineRpcContract({
  canvasEditingLoad: {
    input: canvasEditingLoadInputSchema,
    output: canvasEditingLoadOutputSchema,
  },
});

const editingCommandContract = {
  taraCommandApply: rpcContract.taraCommandApply,
  taraDeleteImpact: rpcContract.taraDeleteImpact,
} as const;

interface UsedSlugRow {
  found: number;
}

interface MethodologyRow {
  stride_map: string;
}

interface AcceptedCanvasRow {
  entity_key: string;
  payload: string;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectVersionId(scope: SyncScope): string {
  return toStorageProjectVersionId(scope.projectVersionId);
}

function slugFromEntityKey(key: string): string | null {
  const segments = parseKey(key);
  return segments.length === 2 && segments[0] === "slug"
    ? (segments[1] ?? null)
    : null;
}

function idMapResolver(idMap: IdMapStore): AdapterSlugResolver {
  return {
    remoteToSlug(scope, kind, remoteId) {
      const key = idMap.reverseAccepted(
        scope.projectId,
        projectVersionId(scope),
        kind,
        remoteId,
      );
      return key ? slugFromEntityKey(key) : null;
    },
    slugToRemote(scope, kind, slug) {
      return idMap.resolveAccepted(
        scope.projectId,
        projectVersionId(scope),
        kind,
        ENTITIES[kind].key({ slug }),
      );
    },
  };
}

function isMethodologyCategoryAllowed(
  db: Database.Database,
  scope: SyncScope,
  category: string,
): boolean {
  const row = db
    .prepare<[string, string], MethodologyRow>(
      `SELECT profile.stride_map
         FROM methodology_profiles AS profile
         JOIN pull_generation AS generation
           ON generation.project_id = profile.project_id
          AND generation.project_version_id = profile.project_version_id
          AND generation.generation_id = profile.generation_id
        WHERE profile.project_id = ? AND profile.project_version_id = ?
          AND generation.status = 'accepted'
        ORDER BY CASE profile.scope WHEN 'project' THEN 0 ELSE 1 END,
                 generation.accepted_at DESC, profile.profile_id
        LIMIT 1`,
    )
    .get(scope.projectId, projectVersionId(scope));
  if (!row) return true;
  try {
    return (
      categoryFromVocabulary(
        category,
        methodologyVocabulary(JSON.parse(row.stride_map)),
      ) !== "other"
    );
  } catch {
    return false;
  }
}

function acceptedCanvasRows(
  db: Database.Database,
  input: { projectId: string; projectVersionId: string | null },
  kind: CanvasEntityKind,
): AcceptedCanvasRow[] {
  return db
    .prepare<[string, string, string], AcceptedCanvasRow>(
      `SELECT snapshot.entity_key, snapshot.payload
         FROM sync_state AS state
         JOIN base_snapshot AS snapshot
           ON snapshot.project_id = state.project_id
          AND snapshot.project_version_id = state.project_version_id
          AND snapshot.entity_kind = state.entity_kind
          AND snapshot.generation_id = state.accepted_generation_id
        WHERE state.project_id = ? AND state.project_version_id = ?
          AND state.entity_kind = ?
        ORDER BY snapshot.entity_key`,
    )
    .all(
      input.projectId,
      toStorageProjectVersionId(input.projectVersionId),
      kind,
    );
}

function parseAcceptedCanvasEntity(
  kind: CanvasEntityKind,
  row: AcceptedCanvasRow,
) {
  let value: unknown;
  try {
    value = JSON.parse(row.payload);
  } catch {
    throw new Error(
      `INVALID_ACCEPTED_TARA: ${kind}/${row.entity_key} is not valid JSON.`,
    );
  }
  if (!isUnknownRecord(value)) {
    throw new Error(
      `INVALID_ACCEPTED_TARA: ${kind}/${row.entity_key} must be a mapping.`,
    );
  }
  const entity = parseArchitectureEntity(kind, value);
  if (ENTITIES[kind].key({ slug: entity.slug }) !== row.entity_key) {
    throw new Error(
      `INVALID_ACCEPTED_TARA: ${kind}/${entity.slug} has a mismatched stable key.`,
    );
  }
  return entity;
}

async function materializeAcceptedCanvasKind(
  bb: BbPluginApi,
  db: Database.Database,
  input: { projectId: string; projectVersionId: string | null },
  kind: CanvasEntityKind,
  files: CanvasFileStore,
): Promise<void> {
  const deletedPrefix = canvasDeletedMarkerPrefix(
    input.projectId,
    input.projectVersionId,
    kind,
  );
  const deleted = new Set(
    (await bb.storage.kv.list(deletedPrefix)).map((key) =>
      key.slice(deletedPrefix.length),
    ),
  );
  const existing = new Set(
    (await files.list(kind)).map((stored) => stored.entity.slug),
  );
  for (const row of acceptedCanvasRows(db, input, kind)) {
    const entity = parseAcceptedCanvasEntity(kind, row);
    if (deleted.has(encodeURIComponent(entity.slug))) continue;
    const file = canvasEntityFile(kind, entity.slug);
    if (existing.has(entity.slug)) continue;
    const result = await files.write(file, serializeCanvasEntity(entity), null);
    if (result.outcome === "conflict" && (await files.read(file)) === null) {
      throw new Error(
        `LOCAL_WRITE_CONFLICT: ${file} changed while the accepted editing baseline was materialized. Reload and compare.`,
      );
    }
  }
}

async function projectSource(
  bb: BbPluginApi,
  projectId: string,
): Promise<CanvasProjectSource> {
  const project = await bb.sdk.projects.get({ projectId });
  const source =
    project.sources.find((candidate) => candidate.isDefault) ??
    project.sources[0];
  if (!source) throw new Error("The project has no local workspace source.");
  return { hostId: source.hostId, path: source.path };
}

function isMissingFile(error: unknown): boolean {
  return /\bENOENT\b|not found|does not exist/iu.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function mitigationFileExists(
  bb: BbPluginApi,
  source: CanvasProjectSource,
  slug: string,
): Promise<boolean> {
  const entry = ENTITIES.mitigation;
  try {
    await bb.sdk.files.read({
      hostId: source.hostId,
      path: join(source.path, `${entry.dir}/${slug}.yaml`),
      rootPath: source.path,
    });
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function allCanvasEntities(files: CanvasFileStore) {
  const groups = await Promise.all(
    (["component", "zone", "asset", "dataflow", "threat"] as const).map(
      (kind) => files.list(kind),
    ),
  );
  return groups.flatMap((group) => group.map((stored) => stored.entity));
}

function jsonValue(value: unknown, path: string): Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([field, item]) => [
        field,
        jsonValue(item, `${path}.${field}`),
      ]),
    );
  }
  throw new Error(`${path} is not JSON serializable.`);
}

function jsonFields(fields: Record<string, unknown>): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      jsonValue(value, field),
    ]),
  );
}

function commandDiffSummary(
  operation: "create" | "update" | "delete",
  kind: CanvasEntityKind,
  slug: string,
  changedFields: readonly string[],
): string {
  return `${operation} ${kind}/${slug}: ${changedFields.length === 0 ? "no semantic field changes" : changedFields.join(", ")}`;
}

export function registerCanvasEditingBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  const db = ctx.db();
  const idMap = new IdMapStore(db);
  const resolver = idMapResolver(idMap);
  let remote: RemoteServices | null = null;
  try {
    remote = ctx.service<RemoteServices>("remote-services", () => {
      throw new Error("Canvas editing registration requires remote services.");
    });
  } catch {
    // Isolated read-surface harnesses intentionally omit L1. Production
    // registration always has L1, while local RPCs remain independently usable.
  }
  if (remote) {
    const registered = new Set(
      registeredAdapters().map((adapter) => adapter.kind),
    );
    for (const adapter of createCanvasEntityAdapters(
      remote.assuranceStudio,
      resolver,
    )) {
      if (!registered.has(adapter.kind)) registerAdapter(adapter);
    }
  }
  registerCanvasValidators({
    exists(scope, kind, slug) {
      return (
        idMap.resolveAccepted(
          scope.projectId,
          projectVersionId(scope),
          kind,
          ENTITIES[kind].key({ slug }),
        ) !== null
      );
    },
    methodologyCategoryAllowed(scope, category) {
      return isMethodologyCategoryAllowed(db, scope, category);
    },
  });

  const usedSlugs = new Set<string>();
  const restorableDeletes = new Map<
    string,
    ReturnType<typeof parseArchitectureEntity>
  >();
  const editIdentity = (
    input: { projectId: string; projectVersionId: string | null },
    kind: CanvasEntityKind,
    slug: string,
  ) =>
    `${input.projectId}\u0000${toStorageProjectVersionId(input.projectVersionId)}\u0000${kind}\u0000${slug}`;
  const rememberDelete = (
    identity: string,
    entity: ReturnType<typeof parseArchitectureEntity>,
  ) => {
    restorableDeletes.delete(identity);
    restorableDeletes.set(identity, entity);
    if (restorableDeletes.size > 500) {
      const oldest = restorableDeletes.keys().next().value;
      if (oldest !== undefined) restorableDeletes.delete(oldest);
    }
  };
  async function dependencies(
    input: {
      projectId: string;
      projectVersionId: string | null;
    },
    restoration?: { kind: CanvasEntityKind; slug: string },
  ): Promise<{
    files: CanvasFileStore;
    deps: EditDeps;
    source: CanvasProjectSource;
  }> {
    const source = await projectSource(bb, input.projectId);
    const files = createSdkCanvasFileStore(bb, source);
    const scope: SyncScope = {
      projectId: input.projectId,
      projectVersionId: input.projectVersionId,
    };
    const versionId = projectVersionId(scope);
    const deps: EditDeps = {
      files,
      async slugWasUsed(kind, slug) {
        if (restoration?.kind === kind && restoration.slug === slug) {
          return false;
        }
        const memoryKey = `${input.projectId}\u0000${versionId}\u0000${kind}\u0000${slug}`;
        if (usedSlugs.has(memoryKey)) return true;
        if (
          (await bb.storage.kv.get<boolean>(
            canvasUsedSlugMarkerKey(
              input.projectId,
              input.projectVersionId,
              kind,
              slug,
            ),
          )) === true
        ) {
          return true;
        }
        const key = ENTITIES[kind].key({ slug });
        const row = db
          .prepare<[string, string, string, string], UsedSlugRow>(
            `SELECT 1 AS found
               FROM id_map
              WHERE project_id = ? AND project_version_id = ?
                AND entity_kind = ? AND entity_key = ?
              LIMIT 1`,
          )
          .get(input.projectId, versionId, kind, key);
        return row?.found === 1;
      },
      recordSlugUse(kind, slug) {
        usedSlugs.add(
          `${input.projectId}\u0000${versionId}\u0000${kind}\u0000${slug}`,
        );
        return bb.storage.kv.set(
          canvasUsedSlugMarkerKey(
            input.projectId,
            input.projectVersionId,
            kind,
            slug,
          ),
          true,
        );
      },
      async referenceExists(kind, slug) {
        if (kind === "mitigation") {
          if (await mitigationFileExists(bb, source, slug)) return true;
        } else if ((await files.read(canvasEntityFile(kind, slug))) !== null) {
          return true;
        }
        return (
          idMap.resolveAccepted(
            input.projectId,
            versionId,
            kind,
            ENTITIES[kind].key({ slug }),
          ) !== null
        );
      },
      async methodologyCategoryAllowed(category) {
        return isMethodologyCategoryAllowed(db, scope, category);
      },
      async deletionImpact(kind, slug) {
        return computeDeletionImpact(
          kind,
          slug,
          await allCanvasEntities(files),
        );
      },
    };
    return { files, deps, source };
  }

  bb.rpc.register(canvasEditingRpcContract, {
    async canvasEditingLoad(input) {
      const { files } = await dependencies(input);
      await materializeAcceptedCanvasKind(bb, db, input, input.kind, files);
      const file = canvasEntityFile(input.kind, input.slug);
      const stored = await files.read(file);
      if (!stored) {
        return {
          projectId: input.projectId,
          projectVersionId: input.projectVersionId,
          state: "missing" as const,
          kind: input.kind,
          slug: input.slug,
          file,
        };
      }
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        state: "ready" as const,
        kind: input.kind,
        slug: input.slug,
        file,
        sha256: stored.sha256,
        fields: jsonFields(architectureEntityPayload(stored.entity)),
      };
    },
  });

  bb.rpc.register(editingCommandContract, {
    async taraCommandApply(input) {
      let command: CanvasEditCommand;
      let identity: string;
      let restoration: { kind: CanvasEntityKind; slug: string } | undefined;
      if (input.operation === "create") {
        const entity = parseArchitectureEntity(input.kind, input.fields);
        command = { kind: "create", entity };
        identity = editIdentity(input, input.kind, entity.slug);
        const deletedSnapshot = restorableDeletes.get(identity);
        if (
          deletedSnapshot &&
          serializeCanvasEntity(deletedSnapshot) === serializeCanvasEntity(entity)
        ) {
          restoration = { kind: entity.kind, slug: entity.slug };
        }
      } else if (input.operation === "update") {
        command = {
          kind: "update",
          entityKind: input.kind,
          slug: input.stableKey,
          patch: input.fields,
        };
        identity = editIdentity(input, input.kind, input.stableKey);
      } else {
        command = {
          kind: "delete",
          entityKind: input.kind,
          slug: input.stableKey,
          mode: input.mode,
        };
        identity = editIdentity(input, input.kind, input.stableKey);
      }
      const { deps, files } = await dependencies(input, restoration);
      await materializeAcceptedCanvasKind(bb, db, input, input.kind, files);
      const beforeDelete =
        command.kind === "delete"
          ? await files.read(canvasEntityFile(command.entityKind, command.slug))
          : null;
      const result = await applyCanvasCommand(
        deps,
        command,
        input.operation === "create"
          ? undefined
          : input.expectedContentSha256,
      );
      if (result.operation !== "delete" && !result.afterSha256) {
        throw new Error(
          "Canvas create/update completed without a content hash.",
        );
      }
      if (result.operation === "delete" && result.afterSha256 !== null) {
        throw new Error("Canvas deletion completed with an invalid content hash.");
      }
      const resultIdentity = identity;
      usedSlugs.add(identity);
      await bb.storage.kv.set(
        canvasUsedSlugMarkerKey(
          input.projectId,
          input.projectVersionId,
          input.kind,
          result.slug,
        ),
        true,
      );
      if (result.operation === "delete") {
        if (beforeDelete) rememberDelete(resultIdentity, beforeDelete.entity);
        await bb.storage.kv.set(
          canvasDeletedMarkerKey(
            input.projectId,
            input.projectVersionId,
            input.kind,
            result.slug,
          ),
          true,
        );
      } else {
        restorableDeletes.delete(resultIdentity);
        await bb.storage.kv.delete(
          canvasDeletedMarkerKey(
            input.projectId,
            input.projectVersionId,
            input.kind,
            result.slug,
          ),
        );
      }
      bb.realtime.publish("tara:changed", {
        projectId: input.projectId,
        kind: input.kind,
        slug: result.slug,
        file: result.file,
      });
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        stableKey: result.slug,
        beforeSha256: result.beforeSha256,
        afterSha256: result.afterSha256,
        changedFields: result.changedFields,
        diffSummary: commandDiffSummary(
          result.operation,
          input.kind,
          result.slug,
          result.changedFields,
        ),
      };
    },
    async taraDeleteImpact(input) {
      const { deps, files } = await dependencies(input);
      await Promise.all(
        (["component", "zone", "asset", "dataflow", "threat"] as const).map(
          (kind) => materializeAcceptedCanvasKind(bb, db, input, kind, files),
        ),
      );
      const impact: DeletionImpact = await deps.deletionImpact(
        input.kind,
        input.stableKey,
      );
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        stableKey: impact.slug,
        referrers: impact.referrers.map((referrer) => ({
          kind: referrer.kind,
          stableKey: referrer.slug,
          effect: referrer.effect,
        })),
        allowedActions: impact.allowedActions,
        restorable: impact.restorable,
      };
    },
  });
}
