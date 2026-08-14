import { z } from "zod";
import { RemoteError } from "../../../lib/remote/types.js";
import { parseKey, type EntityKind } from "../../../lib/sync/registry.js";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { canonicalJson, contentHash } from "../serialize/canonical.js";
import { BaseSnapshotStore } from "../store/base-snapshot.js";
import { IdMapStore } from "../store/id-map.js";
import {
  registeredAdapters,
  registeredResolver,
  type EntityAdapter,
  type ServerEntity,
  type SyncScope,
  type WorkingEntity,
} from "./adapter.js";
import {
  remoteScopeForKind,
  type EngineDeps,
  type PullProjectBinding,
} from "./pull.js";

/** Ordered local/upstream/conflict/orphan view of authored sync state. */
export interface StatusReport {
  local: { kind: EntityKind; key: string; fields: string[] }[];
  upstream: { kind: EntityKind; key: string; fields: string[] }[];
  conflicts: { kind: EntityKind; key: string }[];
  orphans: { kind: EntityKind; key: string; file: string }[];
}

/** One adapter that could not produce remote status without invalidating other kinds. */
export interface StatusKindUnavailable {
  kind: EntityKind;
  code: string;
  message: string;
}

/** CLI-only tolerant status result; the frozen sync.status RPC remains unchanged. */
export interface StatusPerKindReport {
  report: StatusReport;
  unavailable: StatusKindUnavailable[];
}

/** Accepted/staging generation metadata used by frozen RPC result fences. */
export interface SyncMetadata {
  acceptedGenerationIds: Record<string, string>;
  stagingGenerationIds: Record<string, string>;
  baseRevisions: Record<string, number>;
  baseStateSha256: string;
  lastPull: string | null;
}

interface ComparableEntity {
  key: string;
  payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWorkingEntity(value: unknown): value is WorkingEntity {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    isRecord(value["payload"]) &&
    typeof value["file"] === "string"
  );
}

function partialWorkingRead(error: unknown): WorkingEntity[] | null {
  if (!isRecord(error)) return null;
  const working = error["partialWorking"];
  return Array.isArray(working) && working.every(isWorkingEntity)
    ? working
    : null;
}

function compareChange(
  left: Readonly<{ kind: EntityKind; key: string }>,
  right: Readonly<{ kind: EntityKind; key: string }>,
): number {
  return (
    left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key)
  );
}

function emptyStatusReport(): StatusReport {
  return { local: [], upstream: [], conflicts: [], orphans: [] };
}

function appendStatus(report: StatusReport, next: StatusReport): void {
  report.local.push(...next.local);
  report.upstream.push(...next.upstream);
  report.conflicts.push(...next.conflicts);
  report.orphans.push(...next.orphans);
}

function sortStatus(report: StatusReport): void {
  report.local.sort(compareChange);
  report.upstream.sort(compareChange);
  report.conflicts.sort(compareChange);
  report.orphans.sort(compareChange);
}

function unavailableStatus(
  kind: EntityKind,
  error: RemoteError | z.ZodError,
): StatusKindUnavailable {
  if (error instanceof RemoteError) {
    return { kind, code: error.code, message: error.message };
  }
  const issue = error.issues[0];
  const field = issue?.path.map(String).join(".") || "payload";
  return {
    kind,
    code: "REMOTE_VALIDATION_FAILED",
    message: `${kind}.${field} failed remote validation: ${issue?.message ?? "invalid remote data"}`,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson({ value: left }) === canonicalJson({ value: right });
}

function changedFields(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): string[] {
  const fields = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {}),
  ]);
  return [...fields]
    .filter((field) => {
      const leftHas = left !== undefined && Object.hasOwn(left, field);
      const rightHas = right !== undefined && Object.hasOwn(right, field);
      if (leftHas !== rightHas) return true;
      return !sameValue(left?.[field], right?.[field]);
    })
    .sort((a, b) => a.localeCompare(b));
}

function selectedAdapters(
  deps: EngineDeps,
  kinds: readonly EntityKind[] | undefined,
): EntityAdapter[] {
  const requested = kinds === undefined ? null : new Set(kinds);
  const adapters = [...(deps.adapters ?? registeredAdapters())]
    .filter((adapter) => requested === null || requested.has(adapter.kind))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  if (kinds !== undefined) {
    const available = new Set(adapters.map((adapter) => adapter.kind));
    const missing = kinds.find((kind) => !available.has(kind));
    if (missing !== undefined)
      throw new Error(`No status adapter is registered for ${missing}`);
  }
  if (adapters.length === 0) throw new Error("No sync adapters are registered");
  return adapters;
}

function comparablePayload(
  adapter: EntityAdapter,
  payload: Record<string, unknown>,
  remoteEnvelope: boolean,
  idToSlug: (remoteId: string) => string | null,
): Record<string, unknown> {
  const normalized = remoteEnvelope
    ? adapter.serializer.semanticPayload(payload)
    : payload;
  const yaml = adapter.serializer.toYaml(normalized, {
    idToSlug,
    onWarning: () => undefined,
  });
  return adapter.serializer.fromYaml(yaml, `<status:${adapter.kind}>`);
}

function stableIdentity(key: string): string {
  const segments = parseKey(key);
  if (segments.length === 2 && segments[1] !== undefined) return segments[1];
  return key;
}

function acceptedIdResolver(
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
): (remoteId: string) => string | null {
  const resolved = new Map<string, string>();
  for (const entry of new IdMapStore(deps.db).dumpAccepted(
    scope.projectId,
    storageVersionId,
  )) {
    const identity = stableIdentity(entry.entityKey);
    const prior = resolved.get(entry.remoteId);
    if (prior !== undefined && prior !== identity) {
      throw new Error(
        `Accepted id map contains ambiguous remote id ${entry.remoteId}`,
      );
    }
    resolved.set(entry.remoteId, identity);
  }
  return (remoteId) => resolved.get(remoteId) ?? null;
}

async function remoteEntities(
  adapter: EntityAdapter,
  scope: SyncScope,
): Promise<Map<string, ServerEntity>> {
  const result = new Map<string, ServerEntity>();
  for await (const page of adapter.fetchRemote(scope, () => undefined)) {
    for (const entity of page) {
      const prior = result.get(entity.key);
      if (
        prior !== undefined &&
        (prior.remoteId !== entity.remoteId ||
          canonicalJson(prior.payload) !== canonicalJson(entity.payload))
      ) {
        throw new Error(
          `${adapter.kind}/${entity.key} has conflicting remote duplicates`,
        );
      }
      result.set(entity.key, entity);
    }
  }
  return result;
}

function mapComparable<T extends ComparableEntity>(
  values: readonly T[],
  normalize: (value: T) => Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  return new Map(values.map((value) => [value.key, normalize(value)]));
}

function localCandidates(
  adapter: EntityAdapter,
  base: ReadonlyMap<string, Record<string, unknown>>,
  working: ReadonlyMap<string, Record<string, unknown>>,
  workingAvailable: boolean,
): string[] {
  if (!workingAvailable) return [];
  if (adapter.klass === "OVERLAY") return [...working.keys()];
  return [...new Set([...base.keys(), ...working.keys()])];
}

async function statusAdapter(
  deps: EngineDeps,
  scope: SyncScope,
  remoteScope: SyncScope,
  storageVersionId: string,
  adapter: EntityAdapter,
): Promise<StatusReport> {
  const store = new BaseSnapshotStore(deps.db);
  const baseRows = store.listAccepted(
    scope.projectId,
    storageVersionId,
    adapter.kind,
  );
  const remoteRows = await remoteEntities(adapter, remoteScope);
  const worktreeRoot = deps.worktreeRoot;
  const workingAvailable = worktreeRoot !== undefined && worktreeRoot !== null;
  let workingRows: WorkingEntity[] = [];
  if (worktreeRoot !== undefined && worktreeRoot !== null) {
    try {
      workingRows = await adapter.readWorking(worktreeRoot, scope);
    } catch (error: unknown) {
      const partial = partialWorkingRead(error);
      if (partial === null) throw error;
      workingRows = partial;
    }
  }
  const idToSlug = acceptedIdResolver(deps, scope, storageVersionId);

  const base = mapComparable(
    baseRows.map((row) => ({ key: row.entityKey, payload: row.payload })),
    (row) => comparablePayload(adapter, row.payload, false, idToSlug),
  );
  const remote = mapComparable([...remoteRows.values()], (row) =>
    comparablePayload(adapter, row.payload, true, idToSlug),
  );
  const working = mapComparable(workingRows, (row) =>
    comparablePayload(adapter, row.payload, false, idToSlug),
  );
  const localChanges = localCandidates(adapter, base, working, workingAvailable)
    .map((key) => ({
      kind: adapter.kind,
      key,
      fields: changedFields(base.get(key), working.get(key)),
    }))
    .filter((change) => change.fields.length > 0);
  const upstreamChanges = [...new Set([...base.keys(), ...remote.keys()])]
    .map((key) => ({
      kind: adapter.kind,
      key,
      fields: changedFields(base.get(key), remote.get(key)),
    }))
    .filter((change) => change.fields.length > 0);
  const localKeys = new Set(localChanges.map((change) => change.key));
  const upstreamKeys = new Set(upstreamChanges.map((change) => change.key));
  const conflicts = [...localKeys]
    .filter((key) => upstreamKeys.has(key))
    .map((key) => ({ kind: adapter.kind, key }));
  const conflictKeys = new Set(conflicts.map((change) => change.key));
  const local = localChanges.filter((change) => !conflictKeys.has(change.key));
  const upstream = upstreamChanges.filter(
    (change) => !conflictKeys.has(change.key),
  );

  const orphans: StatusReport["orphans"] = [];
  if (adapter.klass === "OVERLAY") {
    const resolver = registeredResolver(adapter.kind);
    for (const row of workingRows) {
      const resolved =
        resolver === undefined
          ? remote.has(row.key)
          : (await resolver(row.key, remoteScope)).resolved;
      if (!resolved)
        orphans.push({ kind: adapter.kind, key: row.key, file: row.file });
    }
  }
  return { local, upstream, conflicts, orphans };
}

/**
 * Computes local changes first, upstream changes second, key-level conflicts
 * third, and exact-match overlay orphans last.
 */
export async function status(
  deps: EngineDeps,
  scope: SyncScope,
  kinds?: EntityKind[],
  binding: PullProjectBinding = { assuranceStudioProjectId: null },
): Promise<StatusReport> {
  if (scope.projectId.trim().length === 0)
    throw new Error("projectId must not be empty");
  const report = emptyStatusReport();
  const storageVersionId = toStorageProjectVersionId(scope.projectVersionId);
  const adapters = selectedAdapters(deps, kinds);
  const remoteScopes = new Map(
    adapters.map((adapter) => [
      adapter.kind,
      remoteScopeForKind(adapter.kind, scope, binding),
    ]),
  );
  for (const adapter of adapters) {
    const remoteScope = remoteScopes.get(adapter.kind);
    if (!remoteScope) throw new Error(`No remote scope for ${adapter.kind}`);
    const next = await statusAdapter(
      deps,
      scope,
      remoteScope,
      storageVersionId,
      adapter,
    );
    appendStatus(report, next);
  }
  sortStatus(report);
  return report;
}

/**
 * Computes status independently per adapter for the CLI so one malformed
 * remote kind is named and isolated instead of aborting every other kind.
 */
export async function statusPerKind(
  deps: EngineDeps,
  scope: SyncScope,
  kinds?: EntityKind[],
  binding: PullProjectBinding = { assuranceStudioProjectId: null },
): Promise<StatusPerKindReport> {
  if (scope.projectId.trim().length === 0)
    throw new Error("projectId must not be empty");
  const report = emptyStatusReport();
  const unavailable: StatusKindUnavailable[] = [];
  const storageVersionId = toStorageProjectVersionId(scope.projectVersionId);
  for (const adapter of selectedAdapters(deps, kinds)) {
    try {
      const remoteScope = remoteScopeForKind(adapter.kind, scope, binding);
      appendStatus(
        report,
        await statusAdapter(
          deps,
          scope,
          remoteScope,
          storageVersionId,
          adapter,
        ),
      );
    } catch (error: unknown) {
      if (!(error instanceof RemoteError) && !(error instanceof z.ZodError)) {
        throw error;
      }
      unavailable.push(unavailableStatus(adapter.kind, error));
    }
  }
  sortStatus(report);
  unavailable.sort((left, right) => left.kind.localeCompare(right.kind));
  return { report, unavailable };
}

/** Reads generation/revision fences and computes the frozen base-state digest. */
export function syncMetadata(
  deps: EngineDeps,
  scope: SyncScope,
  kinds?: readonly EntityKind[],
): SyncMetadata {
  if (scope.projectId.trim().length === 0)
    throw new Error("projectId must not be empty");
  const storageVersionId = toStorageProjectVersionId(scope.projectVersionId);
  const requested: ReadonlySet<string> | null =
    kinds === undefined ? null : new Set(kinds);
  const rows = deps.db
    .prepare(
      `SELECT entity_kind, accepted_generation_id, staging_generation_id,
            base_revision, last_pull
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ?
      ORDER BY entity_kind`,
    )
    .all(scope.projectId, storageVersionId);
  const acceptedGenerationIds: Record<string, string> = {};
  const stagingGenerationIds: Record<string, string> = {};
  const baseRevisions: Record<string, number> = {};
  let lastPull: string | null = null;
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row["entity_kind"] !== "string" ||
      (row["accepted_generation_id"] !== null &&
        typeof row["accepted_generation_id"] !== "string") ||
      (row["staging_generation_id"] !== null &&
        typeof row["staging_generation_id"] !== "string") ||
      typeof row["base_revision"] !== "number" ||
      (row["last_pull"] !== null && typeof row["last_pull"] !== "string")
    ) {
      throw new Error("sync_state contains a corrupt metadata row");
    }
    const kind = row["entity_kind"];
    if (requested !== null && !requested.has(kind)) continue;
    if (row["accepted_generation_id"] !== null) {
      acceptedGenerationIds[kind] = row["accepted_generation_id"];
    }
    if (row["staging_generation_id"] !== null) {
      stagingGenerationIds[kind] = row["staging_generation_id"];
    }
    baseRevisions[kind] = row["base_revision"];
    if (
      row["last_pull"] !== null &&
      (lastPull === null || row["last_pull"] > lastPull)
    ) {
      lastPull = row["last_pull"];
    }
  }
  return {
    acceptedGenerationIds,
    stagingGenerationIds,
    baseRevisions,
    baseStateSha256: contentHash({
      projectId: scope.projectId,
      projectVersionId: scope.projectVersionId,
      acceptedGenerationIds,
      baseRevisions,
    }),
    lastPull,
  };
}
