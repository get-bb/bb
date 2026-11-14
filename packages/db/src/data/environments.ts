import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type {
  EnvironmentProviderSelection,
  EnvironmentStatus,
} from "@bb/domain";
import { areHostPathsEqual } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { environments, threads } from "../schema.js";
import { createEnvironmentId } from "../ids.js";
import { hostPathContains, hostPathEquals } from "./host-path-sql.js";
import { liveThread, threadHoldsEnvironment } from "./threads.js";

import { getEnvironment } from "./environment-lifecycle.js";

export {
  getEnvironment,
  recordEnvironmentCurrentBranch,
  updateEnvironmentMetadata,
} from "./environment-lifecycle.js";
export type {
  RecordEnvironmentCurrentBranchInput,
  UpdateEnvironmentMetadataInput,
} from "./environment-lifecycle.js";

type EnvironmentReadConnection = DbConnection | DbTransaction;
type EnvironmentWriteConnection = DbConnection | DbTransaction;
export type EnvironmentRow = typeof environments.$inferSelect;

export interface CreateEnvironmentInput {
  name?: string | null;
  projectId: string;
  hostId: string;
  path?: string | null;
  isGitRepo?: boolean;
  branchName?: string | null;
  baseBranch?: string | null;
  defaultBranch?: string | null;
  mergeBaseBranch?: string | null;
  status?: EnvironmentStatus;
  providerOwnsPath: boolean;
  environmentProvider?: {
    environmentProviderId: string;
    pluginId?: string;
    instanceKey: string | null;
    selection: EnvironmentProviderSelection;
  } | null;
}

export function createEnvironment(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  input: CreateEnvironmentInput,
) {
  const now = Date.now();
  const id = createEnvironmentId();
  const row = db
    .insert(environments)
    .values({
      id,
      name: input.name ?? null,
      projectId: input.projectId,
      hostId: input.hostId,
      path: input.path ?? null,
      isGitRepo: input.isGitRepo ?? false,
      branchName: input.branchName ?? null,
      baseBranch: input.baseBranch ?? null,
      defaultBranch: input.defaultBranch ?? null,
      mergeBaseBranch: input.mergeBaseBranch ?? null,
      environmentProviderId:
        input.environmentProvider?.environmentProviderId ?? null,
      environmentProviderPluginId: input.environmentProvider?.pluginId ?? null,
      environmentProviderSelection:
        input.environmentProvider?.selection ?? null,
      environmentProviderInstanceKey:
        input.environmentProvider?.instanceKey ?? null,
      providerOwnsPath: input.providerOwnsPath,
      status: input.status ?? "provisioning",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyEnvironment(id, ["environment-created"]);
  return row;
}

export function findProjectEnvironmentByHostPath(
  db: DbConnection,
  projectId: string,
  hostId: string,
  path: string,
) {
  return (
    db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.projectId, projectId),
          eq(environments.hostId, hostId),
          hostPathEquals(environments.path, path),
        ),
      )
      .get() ?? null
  );
}

export interface FindForeignManagedEnvironmentAtHostPathArgs {
  hostId: string;
  path: string;
  projectId: string;
}

export function findProviderEnvironmentContainingPath(
  db: DbConnection,
  path: string,
) {
  return (
    db
      .select()
      .from(environments)
      .where(
        and(
          hostPathContains(environments.path, path),
          eq(environments.providerOwnsPath, true),
          ne(environments.status, "destroyed"),
        ),
      )
      .get() ?? null
  );
}

export function findForeignManagedEnvironmentAtHostPath(
  db: DbConnection,
  args: FindForeignManagedEnvironmentAtHostPathArgs,
) {
  return (
    db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.hostId, args.hostId),
          hostPathContains(environments.path, args.path),
          eq(environments.providerOwnsPath, true),
          ne(environments.projectId, args.projectId),
          ne(environments.status, "destroyed"),
        ),
      )
      .get() ?? null
  );
}

export interface ListEnvironmentsFilters {
  environmentProviderId?: string;
  hostId?: string;
  instanceKey?: string;
  limit?: number;
  offset?: number;
  path?: string;
  projectId?: string;
  statuses?: readonly EnvironmentStatus[];
}

export function listEnvironments(
  db: DbConnection,
  filters: ListEnvironmentsFilters = {},
) {
  const conditions = [
    filters.projectId === undefined
      ? undefined
      : eq(environments.projectId, filters.projectId),
    filters.hostId === undefined
      ? undefined
      : eq(environments.hostId, filters.hostId),
    filters.environmentProviderId === undefined
      ? undefined
      : eq(environments.environmentProviderId, filters.environmentProviderId),
    filters.instanceKey === undefined
      ? undefined
      : eq(environments.environmentProviderInstanceKey, filters.instanceKey),
    filters.path === undefined
      ? undefined
      : hostPathEquals(environments.path, filters.path),
    filters.statuses === undefined
      ? undefined
      : inArray(environments.status, [...filters.statuses]),
  ].filter((condition) => condition !== undefined);
  const query = db
    .select()
    .from(environments)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(environments.createdAt), asc(environments.id))
    .$dynamic();
  const limited =
    filters.limit === undefined ? query : query.limit(filters.limit);
  const paged =
    filters.offset === undefined ? limited : limited.offset(filters.offset);
  return paged.all();
}

export function markHostEnvironmentsDestroyed(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  hostId: string,
): EnvironmentRow[] {
  const updated = db
    .update(environments)
    .set({
      path: null,
      resource: null,
      retireAt: null,
      status: "destroyed",
      teardownMessage: null,
      teardownStatus: "removed",
      updatedAt: Date.now(),
    })
    .where(eq(environments.hostId, hostId))
    .returning()
    .all();
  for (const environment of updated) {
    notifier.notifyEnvironment(environment.id, [
      "metadata-changed",
      "status-changed",
    ]);
  }
  return updated;
}

export interface ListRetiredLoadedEnvironmentIdsOnHostArgs {
  environmentIds: readonly string[];
  hostId: string;
}

export function listRetiredLoadedEnvironmentIdsOnHost(
  db: EnvironmentReadConnection,
  args: ListRetiredLoadedEnvironmentIdsOnHostArgs,
): string[] {
  const environmentIds = [...new Set(args.environmentIds)];
  if (environmentIds.length === 0) {
    return [];
  }

  const retainedRows = db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        inArray(environments.id, environmentIds),
        eq(environments.hostId, args.hostId),
        ne(environments.status, "destroyed"),
      ),
    )
    .all();
  const retainedEnvironmentIds = new Set(
    retainedRows.map((environment) => environment.id),
  );

  return environmentIds.filter(
    (environmentId) => !retainedEnvironmentIds.has(environmentId),
  );
}

export function getPreparingEnvironment(db: EnvironmentWriteConnection, threadId: string) {
  return db.select().from(environments).where(eq(environments.ownerThreadId, threadId)).get() ?? null;
}

export function reserveEnvironment(db: EnvironmentWriteConnection, input: Omit<typeof environments.$inferInsert, "id" | "createdAt" | "updatedAt">) {
  return db.transaction((tx) => {
    if (input.ownerThreadId == null) throw new Error("Missing environment preparation owner");
    const existing = getPreparingEnvironment(tx, input.ownerThreadId);
    const now = Date.now();
    if (existing !== null) {
      if (existing.teardownStatus !== "removed") throw new Error("Previous environment cleanup is incomplete");
      return tx.update(environments).set({ ...input, path: null, resource: null, claimPath: null, teardownStatus: null, teardownMessage: null, teardownAttempt: 0, retireAt: null, pendingLog: "", updatedAt: now }).where(eq(environments.id, existing.id)).returning().get()!;
    }
    return tx.insert(environments).values({ ...input, id: createEnvironmentId(), createdAt: now, updatedAt: now }).returning().get();
  });
}

export function updatePreparingEnvironment(db: EnvironmentWriteConnection, row: EnvironmentRow): boolean {
  return db.update(environments).set({ ...row, updatedAt: Date.now() }).where(and(eq(environments.id, row.id), row.ownerThreadId === null ? isNull(environments.ownerThreadId) : eq(environments.ownerThreadId, row.ownerThreadId), eq(environments.attempt, row.attempt))).run().changes > 0;
}

export function listProviderLifecycleEnvironments(db: EnvironmentWriteConnection, providerId: string, blocked: { pluginId: string; teardownMessage: string }) {
  return db.select().from(environments).where(and(eq(environments.environmentProviderId, providerId), sql`not (${environments.ownerThreadId} is null and ${environments.teardownStatus} is 'failed' and ${environments.teardownMessage} is ${blocked.teardownMessage} and ${environments.environmentProviderPluginId} is not ${blocked.pluginId})`, or(isNull(environments.ownerThreadId), sql`${environments.teardownStatus} is not null`), sql`(${environments.retireAt} is not null or ${environments.teardownStatus} is not null or not exists (select 1 from ${threads} where ${threads.environmentId} = ${environments.id} and ${liveThread}))`, sql`(${environments.status} <> 'destroyed' OR ${environments.teardownStatus} IS NOT 'removed')`)).all();
}

export function environmentHasLiveThreads(db: EnvironmentWriteConnection, environmentId: string): boolean {
  return db.select({ id: threads.id }).from(threads).where(and(eq(threads.environmentId, environmentId), threadHoldsEnvironment)).limit(1).get() !== undefined;
}

export function releaseFinishedEnvironmentPreparationOwners(db: EnvironmentWriteConnection): void {
  db.update(environments).set({ ownerThreadId: null }).where(and(isNotNull(environments.ownerThreadId), eq(environments.teardownStatus, "removed"), sql`not exists (select 1 from ${threads} where ${threads.id} = ${environments.ownerThreadId} and ${threads.deletedAt} is null)`)).run();
}

export function claimEnvironmentPath(db: DbConnection, provisioning: EnvironmentRow, path: string, allowCancelled = false): boolean {
  return db.transaction((tx) => {
    const current = getEnvironment(tx, provisioning.id);
    if (current === null || current.attempt !== provisioning.attempt || current.ownerThreadId !== provisioning.ownerThreadId || (current.status !== "creating" && !(allowCancelled && current.teardownStatus === "running"))) return false;
    if (current.claimPath !== null && !areHostPathsEqual(current.claimPath, path)) return false;
    if (findEnvironmentPathClaim(tx, current.hostId, path, current) !== null) return false;
    return updatePreparingEnvironment(tx, { ...current, claimPath: path });
  }, { behavior: "immediate" });
}

export function findEnvironmentPathClaim(db: EnvironmentWriteConnection, hostId: string, path: string | null, owner: EnvironmentRow | null): EnvironmentRow | null {
  return db.select().from(environments).where(and(
    eq(environments.hostId, hostId),
    path === null ? sql`${environments.claimPath} is not null` : hostPathEquals(environments.claimPath, path),
    owner === null ? undefined : ne(environments.id, owner.id),
    ne(environments.status, "destroyed"),
  )).limit(1).get() ?? null;
}

export function bindEnvironmentPath(db: DbConnection, provisioning: EnvironmentRow, path: string): EnvironmentRow {
  return db.transaction((tx) => {
    const current = getEnvironment(tx, provisioning.id);
    if (current === null || current.attempt !== provisioning.attempt || current.ownerThreadId !== provisioning.ownerThreadId) throw new Error("Environment preparation is no longer current");
    const existing = tx.select().from(environments).where(and(eq(environments.hostId, current.hostId), hostPathEquals(environments.path, path), eq(environments.projectId, current.projectId))).get();
    if (existing === undefined || existing.id === current.id) return current;
    if (existing.teardownStatus !== null || (existing.status !== "ready" && existing.status !== "provisioning")) throw new Error("Workspace is not ready or cleanup is still pending");
    if (existing.ownerThreadId !== null) throw new Error("Workspace is still being prepared by another thread");
    tx.update(environments).set({ ownerThreadId: null, status: "destroyed", teardownStatus: "removed", claimPath: null, resource: null, path: null }).where(eq(environments.id, current.id)).run();
    return tx.update(environments).set({ ownerThreadId: current.ownerThreadId, attempt: current.attempt, status: existing.status, teardownStatus: current.teardownStatus, retireAt: current.retireAt, statusMessage: existing.status === "provisioning" ? existing.statusMessage : current.statusMessage, pendingLog: existing.status === "provisioning" ? existing.pendingLog : current.pendingLog, claimPath: current.claimPath, environmentProviderId: existing.environmentProviderId ?? current.environmentProviderId, environmentProviderPluginId: existing.environmentProviderId === null ? current.environmentProviderPluginId : existing.environmentProviderPluginId, environmentProviderSelection: existing.environmentProviderId === null ? current.environmentProviderSelection : existing.environmentProviderSelection, environmentProviderInstanceKey: existing.environmentProviderId === null ? current.environmentProviderInstanceKey : existing.environmentProviderInstanceKey }).where(eq(environments.id, existing.id)).returning().get()!;
  }, { behavior: "immediate" });
}
