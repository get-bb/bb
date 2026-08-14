import { createHash } from "node:crypto";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
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
import { assertWorkspacePlatformProjectBinding } from "../scope/identity.js";
import {
  createCanvasEntityAdapters,
  type AdapterSlugResolver,
} from "./adapters.js";
import {
  ASSURANCE_STUDIO_COMPONENT_TYPES,
  architectureEntityPayload,
  canvasEntityKindSchema,
  canvasEditingLoadInputSchema,
  canvasEditingLoadOutputSchema,
  canvasJsonValueSchema,
  parseAcceptedArchitectureEntity,
  parseArchitectureEntity,
  stableSlugSchema,
  type CanvasEntityKind,
  type DeletionImpact,
} from "./schema.js";
import {
  computeDeletionImpact,
  registerCanvasValidators,
  UnsupportedAssetTypeValidationAdvisory,
  UnsupportedComponentTypeValidationAdvisory,
  validateArchitecturePayload,
} from "./validators.js";
import {
  applyCanvasCommand,
  canvasDeletedMarkerKey,
  canvasDeletedMarkerPrefix,
  canvasEntityFile,
  canvasUsedSlugMarkerKey,
  createSdkCanvasFileStore,
  RetiredComponentTypeReadAdvisory,
  serializeCanvasEntity,
  type CanvasEditCommand,
  type CanvasFileListing,
  type CanvasFileStore,
  type CanvasProjectSource,
  type EditDeps,
} from "./writer.js";

async function isolatedCanvasFileListing(
  files: CanvasFileStore,
  kind: CanvasEntityKind,
): Promise<CanvasFileListing> {
  return files.listWithDiagnostics
    ? files.listWithDiagnostics(kind)
    : { entities: await files.list(kind), diagnostics: [] };
}

export const canvasEditingRpcContract = defineRpcContract({
  canvasEditingLoad: {
    input: canvasEditingLoadInputSchema,
    output: canvasEditingLoadOutputSchema,
  },
});

const versionedEditingIdentityFields = {
  workspaceProjectId: z.string().trim().min(1).max(512),
  platformProjectId: z.string().trim().min(1).max(512),
  projectVersionId: z.string().trim().min(1).max(512),
} as const;
const versionedApplyInputSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...versionedEditingIdentityFields,
      operation: z.literal("create"),
      kind: canvasEntityKindSchema,
      fields: z.record(z.string(), canvasJsonValueSchema),
      expectedContentSha256: z.null(),
    })
    .strict(),
  z
    .object({
      ...versionedEditingIdentityFields,
      operation: z.literal("update"),
      kind: canvasEntityKindSchema,
      stableKey: stableSlugSchema,
      fields: z.record(z.string(), canvasJsonValueSchema),
      expectedContentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
  z
    .object({
      ...versionedEditingIdentityFields,
      operation: z.literal("delete"),
      kind: canvasEntityKindSchema,
      stableKey: stableSlugSchema,
      mode: z.enum(["cascade", "detach"]),
      expectedContentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
]);

export const versionedCanvasEditingRpcContract = defineRpcContract({
  canvasVersionedEditingLoad: {
    input: canvasEditingLoadInputSchema
      .omit({ projectId: true, projectVersionId: true })
      .extend(versionedEditingIdentityFields),
    output: canvasEditingLoadOutputSchema,
  },
  canvasVersionedCommandApply: {
    input: versionedApplyInputSchema,
    output: rpcContract.taraCommandApply.output,
  },
  canvasVersionedDeleteImpact: {
    input: z
      .object({
        ...versionedEditingIdentityFields,
        kind: canvasEntityKindSchema,
        stableKey: stableSlugSchema,
      })
      .strict(),
    output: rpcContract.taraDeleteImpact.output,
  },
});

interface EditingScopeInput {
  projectId: string;
  projectVersionId: string | null;
  platformProjectId?: string;
}
type EditingLoadInput = z.output<typeof canvasEditingLoadInputSchema> & {
  platformProjectId?: string;
};
type EditingApplyInput = z.output<
  (typeof rpcContract)["taraCommandApply"]["input"]
> & { platformProjectId?: string };
type EditingImpactInput = z.output<
  (typeof rpcContract)["taraDeleteImpact"]["input"]
> & { platformProjectId?: string };

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

interface PlatformProjectRow {
  platform_project_id: string;
}

function platformProjectId(
  db: Database.Database,
  workspaceProjectId: string,
): string {
  const rows = db
    .prepare<[string], PlatformProjectRow>(
      `SELECT platform_project_id
         FROM workspace_platform_project_binding
        WHERE workspace_project_id = ?
        ORDER BY platform_project_id
        LIMIT 2`,
    )
    .all(workspaceProjectId);
  if (rows.length !== 1) {
    throw new Error(
      "The canvas editing scope has no unique Platform project binding.",
    );
  }
  return rows[0]!.platform_project_id;
}

function cacheProjectId(
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string | null;
    platformProjectId?: string;
  },
): string {
  if (input.platformProjectId) return input.platformProjectId;
  return input.projectVersionId === null
    ? input.projectId
    : platformProjectId(db, input.projectId);
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
  input: {
    projectId: string;
    projectVersionId: string | null;
    platformProjectId?: string;
  },
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
      cacheProjectId(db, input),
      toStorageProjectVersionId(input.projectVersionId),
      kind,
    );
}

function acceptedCanvasRow(
  db: Database.Database,
  input: EditingScopeInput,
  kind: CanvasEntityKind,
  slug: string,
): AcceptedCanvasRow | null {
  const rows = db
    .prepare<[string, string, string, string, string], AcceptedCanvasRow>(
      `SELECT snapshot.entity_key, snapshot.payload
         FROM sync_state AS state
         JOIN base_snapshot AS snapshot
           ON snapshot.project_id = state.project_id
          AND snapshot.project_version_id = state.project_version_id
          AND snapshot.entity_kind = state.entity_kind
          AND snapshot.generation_id = state.accepted_generation_id
        WHERE state.project_id = ? AND state.project_version_id = ?
          AND state.entity_kind = ?
          AND (
            snapshot.entity_key = ?
            OR json_extract(snapshot.payload, '$.slug') = ?
          )
        LIMIT 2`,
    )
    .all(
      cacheProjectId(db, input),
      toStorageProjectVersionId(input.projectVersionId),
      kind,
      ENTITIES[kind].key({ slug }),
      slug,
    );
  if (rows.length > 1) {
    throw new Error(
      `INVALID_ACCEPTED_TARA: ${kind}/${slug} has multiple accepted rows.`,
    );
  }
  return rows[0] ?? null;
}

function parseAcceptedCanvasWritableEntity(
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
  const entity = validateArchitecturePayload(kind, value);
  if (ENTITIES[kind].key({ slug: entity.slug }) !== row.entity_key) {
    throw new Error(
      `INVALID_ACCEPTED_TARA: ${kind}/${entity.slug} has a mismatched stable key.`,
    );
  }
  return entity;
}

function parseAcceptedCanvasReadableEntity(
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
  const entity = parseAcceptedArchitectureEntity(kind, value);
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
  input: EditingScopeInput,
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
  const listing = await isolatedCanvasFileListing(files, kind);
  const existing = new Set([
    ...listing.entities.map((stored) => stored.entity.slug),
    ...listing.diagnostics.map((diagnostic) => diagnostic.slug),
  ]);
  for (const row of acceptedCanvasRows(db, input, kind)) {
    let entity: ReturnType<typeof parseAcceptedCanvasWritableEntity>;
    try {
      entity = parseAcceptedCanvasWritableEntity(kind, row);
    } catch (error: unknown) {
      if (
        error instanceof UnsupportedAssetTypeValidationAdvisory ||
        error instanceof UnsupportedComponentTypeValidationAdvisory
      ) {
        continue;
      }
      throw error;
    }
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

async function deletedCanvasSlugs(
  bb: BbPluginApi,
  input: { projectId: string; projectVersionId: string | null },
  kind: CanvasEntityKind,
): Promise<Set<string>> {
  const prefix = canvasDeletedMarkerPrefix(
    input.projectId,
    input.projectVersionId,
    kind,
  );
  return new Set(
    (await bb.storage.kv.list(prefix)).map((key) => {
      try {
        return decodeURIComponent(key.slice(prefix.length));
      } catch {
        throw new Error("A local canvas deletion marker is malformed.");
      }
    }),
  );
}

async function mergedCanvasEntities(
  bb: BbPluginApi,
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string | null;
    platformProjectId?: string;
  },
  files: CanvasFileStore,
) {
  const kinds = ["component", "zone", "asset", "dataflow", "threat"] as const;
  const groups = await Promise.all(
    kinds.map(async (kind) => {
      const listing = await isolatedCanvasFileListing(files, kind);
      const merged = new Map(
        acceptedCanvasRows(db, input, kind).map((row) => {
          const entity = parseAcceptedCanvasReadableEntity(kind, row);
          return [entity.slug, entity] as const;
        }),
      );
      for (const stored of listing.entities) {
        merged.set(stored.entity.slug, stored.entity);
      }
      for (const diagnostic of listing.diagnostics) {
        merged.delete(diagnostic.slug);
      }
      for (const slug of await deletedCanvasSlugs(bb, input, kind)) {
        merged.delete(slug);
      }
      return [...merged.values()];
    }),
  );
  return groups.flat();
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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

export async function readMergedCanvasEntities(
  bb: BbPluginApi,
  db: Database.Database,
  input: {
    workspaceProjectId: string;
    platformProjectId: string;
    projectVersionId: string;
  },
) {
  const source = await projectSource(bb, input.workspaceProjectId);
  const files = createSdkCanvasFileStore(bb, source, {
    reclaimTombstones: false,
  });
  return mergedCanvasEntities(
    bb,
    db,
    {
      projectId: input.workspaceProjectId,
      platformProjectId: input.platformProjectId,
      projectVersionId: input.projectVersionId,
    },
    files,
  );
}

export async function readCanvasWorkingOverlay(
  bb: BbPluginApi,
  input: {
    workspaceProjectId: string;
    projectVersionId: string | null;
    kind: CanvasEntityKind;
  },
) {
  const source = await projectSource(bb, input.workspaceProjectId);
  const files = createSdkCanvasFileStore(bb, source, {
    reclaimTombstones: false,
  });
  const listing = await isolatedCanvasFileListing(files, input.kind);
  const excludedSlugs = new Set([
    ...listing.diagnostics.map((diagnostic) => diagnostic.slug),
    ...(await deletedCanvasSlugs(
      bb,
      {
        projectId: input.workspaceProjectId,
        projectVersionId: input.projectVersionId,
      },
      input.kind,
    )),
  ]);
  return { entities: listing.entities, excludedSlugs };
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
    input: EditingScopeInput,
    restoration?: { kind: CanvasEntityKind; slug: string },
    reclaimTombstones = true,
  ): Promise<{
    files: CanvasFileStore;
    deps: EditDeps;
    source: CanvasProjectSource;
  }> {
    const source = await projectSource(bb, input.projectId);
    const files = createSdkCanvasFileStore(bb, source, {
      reclaimTombstones,
    });
    const resolvedCacheProjectId = cacheProjectId(db, input);
    const scope: SyncScope = {
      projectId: resolvedCacheProjectId,
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
          .get(resolvedCacheProjectId, versionId, kind, key);
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
            resolvedCacheProjectId,
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
          await mergedCanvasEntities(bb, db, input, files),
        );
      },
    };
    return { files, deps, source };
  }

  async function canvasEditingLoad(input: EditingLoadInput) {
    const { files } = await dependencies(input, undefined, false);
    const file = canvasEntityFile(input.kind, input.slug);
    if ((await deletedCanvasSlugs(bb, input, input.kind)).has(input.slug)) {
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        state: "missing" as const,
        kind: input.kind,
        slug: input.slug,
        file,
      };
    }
    let stored;
    try {
      stored = await files.read(file);
    } catch (error) {
      if (!(error instanceof RetiredComponentTypeReadAdvisory)) throw error;
      const { kind: _kind, ...fields } = error.entity;
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        state: "migration_required" as const,
        kind: "component" as const,
        slug: error.entity.slug,
        file: error.file,
        sha256: error.sha256,
        fields: jsonFields(fields),
        advisory: {
          code: error.code,
          field: error.field,
          value: error.entity.component_type,
          allowedValues: [...ASSURANCE_STUDIO_COMPONENT_TYPES],
          message: error.message,
        },
      };
    }
    if (stored) {
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
    }
    const acceptedRow = acceptedCanvasRow(db, input, input.kind, input.slug);
    if (!acceptedRow) {
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        state: "missing" as const,
        kind: input.kind,
        slug: input.slug,
        file,
      };
    }
    const accepted = parseAcceptedCanvasWritableEntity(input.kind, acceptedRow);
    const content = serializeCanvasEntity(accepted);
    return {
      projectId: input.projectId,
      projectVersionId: input.projectVersionId,
      state: "ready" as const,
      kind: input.kind,
      slug: input.slug,
      file,
      sha256: sha256(content),
      fields: jsonFields(architectureEntityPayload(accepted)),
    };
  }
  bb.rpc.register(canvasEditingRpcContract, { canvasEditingLoad });

  async function taraCommandApply(input: EditingApplyInput) {
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
      input.operation === "create" ? undefined : input.expectedContentSha256,
    );
    if (result.operation !== "delete" && !result.afterSha256) {
      throw new Error("Canvas create/update completed without a content hash.");
    }
    if (result.operation === "delete" && result.afterSha256 !== null) {
      throw new Error(
        "Canvas deletion completed with an invalid content hash.",
      );
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
      workspaceProjectId: input.projectId,
      projectId: cacheProjectId(db, input),
      projectVersionId: input.projectVersionId,
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
  }
  async function taraDeleteImpact(input: EditingImpactInput) {
    const { files } = await dependencies(input, undefined, false);
    const impact: DeletionImpact = computeDeletionImpact(
      input.kind,
      input.stableKey,
      await mergedCanvasEntities(bb, db, input, files),
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
  }
  bb.rpc.register(editingCommandContract, {
    taraCommandApply,
    taraDeleteImpact,
  });
  bb.rpc.register(versionedCanvasEditingRpcContract, {
    canvasVersionedEditingLoad(input) {
      assertWorkspacePlatformProjectBinding(
        db,
        input.workspaceProjectId,
        input.platformProjectId,
      );
      return canvasEditingLoad({
        projectId: input.workspaceProjectId,
        platformProjectId: input.platformProjectId,
        projectVersionId: input.projectVersionId,
        kind: input.kind,
        slug: input.slug,
      });
    },
    canvasVersionedCommandApply(input) {
      assertWorkspacePlatformProjectBinding(
        db,
        input.workspaceProjectId,
        input.platformProjectId,
      );
      const { workspaceProjectId, platformProjectId, ...command } = input;
      return taraCommandApply({
        ...command,
        projectId: workspaceProjectId,
        platformProjectId,
      });
    },
    canvasVersionedDeleteImpact(input) {
      assertWorkspacePlatformProjectBinding(
        db,
        input.workspaceProjectId,
        input.platformProjectId,
      );
      const { workspaceProjectId, platformProjectId, ...impact } = input;
      return taraDeleteImpact({
        ...impact,
        projectId: workspaceProjectId,
        platformProjectId,
      });
    },
  });
}
