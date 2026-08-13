import type Database from "better-sqlite3";

import { RemoteLimiter } from "../../../lib/remote/rate-limit.js";
import {
  RemoteError,
  type AsCreatableEntityKind,
  type AsEntity,
  type AsEntityKind,
  type AssuranceStudioClient,
  type Json,
} from "../../../lib/remote/types.js";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import {
  ENTITIES,
  isRemotePushable,
  parseKey,
  type EntityKind,
} from "../../../lib/sync/registry.js";
import {
  registerPusher,
  registeredPusher,
} from "../engine/adapter.js";
import type { PlanItem } from "../plan/index.js";
import { canonicalJson } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";
import { IdMapStore } from "../store/id-map.js";
import {
  PushExecutionError,
  type ApplyResult,
  type EntityPusher,
  type PushContext,
  type ReadBackResult,
} from "./types.js";

const AS_KIND: Readonly<Partial<Record<EntityKind, AsEntityKind>>> = {
  asset: "asset",
  attackPath: "attack-path",
  component: "component",
  dataflow: "dataflow",
  mitigation: "mitigation",
  requirement: "requirement",
  threat: "threat",
  zone: "zone",
};

export interface RemoteFieldContext {
  resolveId(kind: EntityKind, key: string): string | null;
}

export interface AssuranceStudioPusherOptions {
  db: Database.Database;
  client: Pick<
    AssuranceStudioClient,
    "listEntities" | "getEntity" | "createEntity" | "updateEntity" | "deleteEntity"
  >;
  limiter: RemoteLimiter;
  kind: EntityKind;
  maxConcurrency?: number;
  toRemoteFields?(
    fields: Readonly<Record<string, Json>>,
    context: RemoteFieldContext,
  ): Record<string, Json>;
  deleteMode?(item: PlanItem): "cascade" | "detach" | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEntityPusher(value: unknown): value is EntityPusher {
  return isRecord(value)
    && typeof value["kind"] === "string"
    && Object.hasOwn(ENTITIES, value["kind"])
    && typeof value["maxConcurrency"] === "number"
    && typeof value["apply"] === "function"
    && typeof value["readBack"] === "function"
    && (value["beginGroup"] === undefined || typeof value["beginGroup"] === "function")
    && (value["commitGroup"] === undefined || typeof value["commitGroup"] === "function");
}

function validatePusher(pusher: EntityPusher): void {
  if (!isRemotePushable(pusher.kind)) {
    throw new Error(`${pusher.kind} is not a remote semantic entity and cannot register a pusher`);
  }
  if (
    !Number.isSafeInteger(pusher.maxConcurrency)
    || pusher.maxConcurrency < 1
    || pusher.maxConcurrency > 64
  ) {
    throw new Error(`${pusher.kind} pusher maxConcurrency must be an integer from 1 through 64`);
  }
  if ((pusher.beginGroup === undefined) !== (pusher.commitGroup === undefined)) {
    throw new Error(`${pusher.kind} pusher must register both TARA group hooks or neither`);
  }
}

/** Registers a typed facade through WP-17's change-controlled unknown seam. */
export function registerTypedPusher(pusher: EntityPusher): void {
  validatePusher(pusher);
  if (registeredPusher(pusher.kind) !== undefined) {
    throw new Error(`Sync pusher already registered for ${pusher.kind}`);
  }
  registerPusher(pusher.kind, pusher);
}

export function pusherFor(
  kind: EntityKind,
  overrides?: readonly EntityPusher[],
): EntityPusher | null {
  const value = overrides?.find((candidate) => candidate.kind === kind) ?? registeredPusher(kind);
  if (value === undefined) return null;
  if (!isEntityPusher(value) || value.kind !== kind) {
    throw new Error(`Registered ${kind} pusher does not satisfy the typed facade`);
  }
  validatePusher(value);
  return value;
}

export function assertPusherItem(pusher: EntityPusher, item: PlanItem, context: PushContext): void {
  if (pusher.kind !== item.kind) {
    throw new Error(`${pusher.kind} pusher cannot apply ${item.kind}/${item.key}`);
  }
  if (
    item.projectId !== context.scope.projectId
    || item.projectVersionId !== context.scope.projectVersionId
  ) {
    throw new Error(`${item.kind}/${item.key} is outside the push scope`);
  }
}

function asJson(value: unknown, path: string): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => asJson(entry, `${path}[${index}]`));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      asJson(entry, `${path}.${key}`),
    ]));
  }
  throw new Error(`Plan field ${path} is not JSON-safe`);
}

function localFields(item: PlanItem): Record<string, Json> {
  const result: Record<string, Json> = {};
  for (const field of item.fields) {
    const locallyChanged = field.base.present !== field.ours.present
      || canonicalJson(field.base.value) !== canonicalJson(field.ours.value);
    if (!locallyChanged) continue;
    result[field.field] = field.ours.present ? asJson(field.ours.value, field.field) : null;
  }
  return result;
}

function stableIdentity(key: string): string {
  try {
    return parseKey(key).at(-1) ?? key;
  } catch {
    return key;
  }
}

function keyFor(kind: EntityKind, payload: Readonly<Record<string, unknown>>): string {
  const entry = ENTITIES[kind];
  if (!("key" in entry)) throw new Error(`${kind} has no stable-key function`);
  return entry.key(payload);
}

function envelope(entity: AsEntity): Record<string, unknown> {
  return {
    id: entity.id,
    projectId: entity.projectId,
    kind: entity.kind,
    reviewVersion: entity.reviewVersion,
    reviewStatus: entity.reviewStatus,
    humanEdited: entity.humanEdited,
    fields: entity.fields,
  };
}

function semanticEntity(
  db: Database.Database,
  kind: EntityKind,
  projectId: string,
  projectVersionId: string,
  entity: AsEntity,
): Record<string, unknown> {
  const serializer = createSerializer(kind);
  const remoteToSlug = new Map<string, string>();
  for (const entry of new IdMapStore(db).dumpAccepted(projectId, projectVersionId)) {
    remoteToSlug.set(entry.remoteId, stableIdentity(entry.entityKey));
  }
  const semantic = serializer.semanticPayload(envelope(entity));
  return serializer.fromYaml(serializer.toYaml(semantic, {
    idToSlug: (remoteId) => remoteToSlug.get(remoteId) ?? null,
    onWarning: () => undefined,
  }), `<push-read-back:${kind}>`);
}

function asKind(kind: EntityKind): AsEntityKind {
  const mapped = AS_KIND[kind];
  if (mapped === undefined) {
    throw new Error(`${kind} has no verified Assurance Studio entity route`);
  }
  return mapped;
}

function isCreatable(kind: AsEntityKind): kind is AsCreatableEntityKind {
  return kind !== "attack-path";
}

function reviewVersion(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  kind: EntityKind,
  key: string,
): string {
  const row = db.prepare(
    `SELECT review.review_version
       FROM entity_review_state review
       JOIN sync_state state
         ON state.project_id = review.project_id
        AND state.project_version_id = review.project_version_id
        AND state.entity_kind = review.entity_kind
        AND state.accepted_generation_id = review.generation_id
      WHERE review.project_id = ? AND review.project_version_id = ?
        AND review.entity_kind = ? AND review.entity_key = ?`,
  ).get(projectId, projectVersionId, kind, key);
  if (!isRecord(row) || typeof row["review_version"] !== "string") {
    throw new PushExecutionError(
      "REVIEW_VERSION_REQUIRED",
      `Accepted review_version is missing for ${kind}/${key}`,
    );
  }
  return row["review_version"];
}

async function findEntity(
  options: AssuranceStudioPusherOptions,
  remoteKind: AsEntityKind,
  item: PlanItem,
  context: PushContext,
): Promise<AsEntity | null> {
  const storageVersionId = toStorageProjectVersionId(context.scope.projectVersionId);
  const mappedId = new IdMapStore(options.db).resolveAccepted(
    context.scope.projectId,
    storageVersionId,
    item.kind,
    item.key,
  );
  const getById = async (id: string): Promise<AsEntity | null> => {
    try {
      return await options.client.getEntity(remoteKind, {
        projectId: context.scope.projectId,
        id,
      }, { signal: context.signal });
    } catch (error: unknown) {
      if (error instanceof RemoteError && error.status === 404) return null;
      throw error;
    }
  };
  if (mappedId !== null) {
    return await options.limiter.run(() => getById(mappedId), context.signal, "assurance-studio");
  }
  return await options.limiter.run(async () => {
    for await (const page of options.client.listEntities(remoteKind, {
      projectId: context.scope.projectId,
      page: { pageSize: 200 },
    }, { signal: context.signal })) {
      for (const entity of page.items) {
        const payload = semanticEntity(
          options.db,
          item.kind,
          context.scope.projectId,
          storageVersionId,
          entity,
        );
        if (keyFor(item.kind, payload) === item.key) return entity;
      }
    }
    return null;
  }, context.signal, "assurance-studio");
}

/** Creates a narrow, limiter-bound pusher for a verified AS CRUD entity. */
export function createAssuranceStudioPusher(
  options: AssuranceStudioPusherOptions,
): EntityPusher {
  const remoteKind = asKind(options.kind);
  const storageVersionId = (context: PushContext): string => (
    toStorageProjectVersionId(context.scope.projectVersionId)
  );
  const fieldContext = (context: PushContext): RemoteFieldContext => ({
    resolveId: (kind, key) => new IdMapStore(options.db).resolveAccepted(
      context.scope.projectId,
      storageVersionId(context),
      kind,
      key,
    ),
  });
  const remoteFields = (item: PlanItem, context: PushContext): Record<string, Json> => {
    const fields = localFields(item);
    return options.toRemoteFields?.(fields, fieldContext(context)) ?? fields;
  };

  const pusher: EntityPusher = {
    kind: options.kind,
    maxConcurrency: options.maxConcurrency ?? 1,
    async apply(item, context): Promise<ApplyResult> {
      assertPusherItem(pusher, item, context);
      if (item.operation === "create") {
        if (!isCreatable(remoteKind)) {
          throw new PushExecutionError(
            "REMOTE_OPERATION_UNVERIFIED",
            `${item.kind} create has no verified Assurance Studio route`,
          );
        }
        const result = await options.limiter.run(() => options.client.createEntity(remoteKind, {
          projectId: context.scope.projectId,
          fields: remoteFields(item, context),
        }, { signal: context.signal }), context.signal, "assurance-studio");
        return {
          remoteId: result.entity.id,
          serverPayload: semanticEntity(
            options.db,
            item.kind,
            context.scope.projectId,
            storageVersionId(context),
            result.entity,
          ),
          verification: "required",
        };
      }

      const current = await findEntity(options, remoteKind, item, context);
      if (current === null) {
        throw new PushExecutionError(
          "REMOTE_ENTITY_NOT_FOUND",
          `Remote ${item.kind}/${item.key} no longer exists`,
          false,
          true,
        );
      }
      if (item.operation === "update") {
        const fields = {
          ...remoteFields(item, context),
          review_version: reviewVersion(
            options.db,
            context.scope.projectId,
            storageVersionId(context),
            item.kind,
            item.key,
          ),
        };
        const result = await options.limiter.run(() => options.client.updateEntity(remoteKind, {
          projectId: context.scope.projectId,
          id: current.id,
          fields,
        }, { signal: context.signal }), context.signal, "assurance-studio");
        return {
          remoteId: result.entity.id,
          serverPayload: semanticEntity(
            options.db,
            item.kind,
            context.scope.projectId,
            storageVersionId(context),
            result.entity,
          ),
          verification: "required",
        };
      }
      if (item.operation === "delete") {
        const result = await options.limiter.run(() => options.client.deleteEntity(remoteKind, {
          projectId: context.scope.projectId,
          id: current.id,
          mode: options.deleteMode?.(item),
        }, { signal: context.signal }), context.signal, "assurance-studio");
        if (!result.success) {
          throw new PushExecutionError(
            "DELETE_IMPACT_CHANGED",
            `Delete impact changed for ${item.kind}/${item.key}; allowed modes: ${result.impact.allowedActions.join(", ") || "none"}`,
            false,
            true,
          );
        }
        return { remoteId: null, serverPayload: null, verification: "required" };
      }
      throw new PushExecutionError(
        "PLAN_ITEM_NON_APPLICABLE",
        `${item.operation} cannot be sent to Assurance Studio`,
      );
    },
    async readBack(item, context): Promise<ReadBackResult> {
      assertPusherItem(pusher, item, context);
      const entity = await findEntity(options, remoteKind, item, context);
      if (entity === null) return { exists: false, remoteId: null, payload: null };
      return {
        exists: true,
        remoteId: entity.id,
        payload: semanticEntity(
          options.db,
          item.kind,
          context.scope.projectId,
          storageVersionId(context),
          entity,
        ),
      };
    },
  };
  validatePusher(pusher);
  return pusher;
}
