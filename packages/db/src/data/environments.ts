import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type {
  EnvironmentHolder,
  EnvironmentProviderSelection,
  EnvironmentStatus,
  JsonValue,
} from "@bb/domain";
import { areHostPathsEqual } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
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
  heldBy?: EnvironmentHolder;
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
    filters.heldBy === undefined
      ? undefined
      : eq(environments.heldBy, filters.heldBy),
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

type EnvironmentReservation = Omit<typeof environments.$inferInsert, "id" | "createdAt" | "updatedAt" | "environmentProviderInstanceKey"> & {
  environmentProviderInstanceKey?: (environmentId: string) => string;
};

export function reserveEnvironment(db: EnvironmentWriteConnection, input: EnvironmentReservation) {
  return db.transaction((tx) => {
    if (input.ownerThreadId == null) throw new Error("Missing environment preparation owner");
    const existing = getPreparingEnvironment(tx, input.ownerThreadId);
    const now = Date.now();
    if (existing !== null) {
      if (existing.teardownStatus !== "removed") throw new Error("Previous environment cleanup is incomplete");
      return tx.update(environments).set({ ...input, environmentProviderInstanceKey: input.environmentProviderInstanceKey?.(existing.id) ?? null, path: null, resource: null, claimPath: input.claimPath ?? null, teardownStatus: null, teardownMessage: null, teardownAttempt: 0, retireAt: null, pendingLog: "", updatedAt: now }).where(eq(environments.id, existing.id)).returning().get()!;
    }
    const id = createEnvironmentId();
    return tx.insert(environments).values({ ...input, id, environmentProviderInstanceKey: input.environmentProviderInstanceKey?.(id) ?? null, createdAt: now, updatedAt: now }).returning().get();
  });
}

export function insertHeldEnvironment(db: EnvironmentWriteConnection, input: Omit<EnvironmentReservation, "ownerThreadId" | "heldBy" | "environmentProviderInstanceKey"> & { heldBy: EnvironmentHolder; environmentProviderInstanceKey: (environmentId: string) => string }) {
  const now = Date.now();
  const id = createEnvironmentId();
  return db.insert(environments).values({ ...input, id, ownerThreadId: null, environmentProviderInstanceKey: input.environmentProviderInstanceKey(id), createdAt: now, updatedAt: now }).returning().get();
}

export function updatePreparingEnvironment(db: EnvironmentWriteConnection, row: EnvironmentRow): boolean {
  return db.update(environments).set({ ...row, updatedAt: Date.now() }).where(and(eq(environments.id, row.id), row.ownerThreadId === null ? isNull(environments.ownerThreadId) : eq(environments.ownerThreadId, row.ownerThreadId), eq(environments.attempt, row.attempt))).run().changes > 0;
}

export function listProviderLifecycleEnvironments(db: EnvironmentWriteConnection, providerId: string, blocked: { pluginId: string; teardownMessage: string }) {
  return db.select().from(environments).where(and(eq(environments.environmentProviderId, providerId), sql`not (${environments.ownerThreadId} is null and ${environments.teardownStatus} is 'failed' and ${environments.teardownMessage} is ${blocked.teardownMessage} and ${environments.environmentProviderPluginId} is not ${blocked.pluginId})`, or(isNull(environments.ownerThreadId), sql`${environments.teardownStatus} is not null`), sql`(${environments.heldBy} is null or ${environments.teardownStatus} is not null)`, sql`(${environments.retireAt} is not null or ${environments.teardownStatus} is not null or not exists (select 1 from ${threads} where ${threads.environmentId} = ${environments.id} and ${liveThread}))`, sql`(${environments.status} <> 'destroyed' OR ${environments.teardownStatus} IS NOT 'removed')`)).all();
}

export function findOtherLiveThreadAtEnvironmentPath(db: EnvironmentReadConnection, args: { hostId: string; path: string; threadId: string | null }): string | null {
  return db.select({ id: threads.id }).from(environments).innerJoin(threads, eq(threads.environmentId, environments.id)).where(and(
    eq(environments.hostId, args.hostId),
    hostPathEquals(environments.path, args.path),
    ne(environments.status, "destroyed"),
    liveThread,
    inArray(threads.status, ["starting", "active", "idle", "stopping"]),
    args.threadId === null ? undefined : ne(threads.id, args.threadId),
  )).limit(1).get()?.id ?? null;
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

export function bindEnvironmentPath(db: DbConnection, provisioning: EnvironmentRow, path: string, targetId: string | null): EnvironmentRow {
  return db.transaction((tx) => {
    const current = getEnvironment(tx, provisioning.id);
    if (current === null || current.attempt !== provisioning.attempt || current.ownerThreadId !== provisioning.ownerThreadId) throw new Error("Environment preparation is no longer current");
    const existing = tx.select().from(environments).where(and(eq(environments.hostId, current.hostId), hostPathEquals(environments.path, path), eq(environments.projectId, current.projectId))).get();
    if (existing === undefined || existing.id === current.id) return current;
    const discarded = { ownerThreadId: null, status: "destroyed", teardownStatus: "removed", claimPath: null, resource: null, path: null } as const;
    if (current.teardownStatus !== null) return tx.update(environments).set(discarded).where(eq(environments.id, current.id)).returning().get()!;
    if (existing.id !== targetId || current.ownerThreadId === null) throw new Error(`Workspace ${path} already belongs to environment ${existing.id}`);
    if (existing.teardownStatus !== null || (existing.status !== "ready" && existing.status !== "provisioning")) throw new Error("Workspace is not ready or cleanup is still pending");
    if (existing.ownerThreadId !== null) throw new Error("Workspace is still being prepared by another thread");
    if (existing.heldBy !== null && existing.heldBy !== "user") throw new Error(`Environment ${existing.id} is held by ${existing.heldBy.slice("plugin:".length)}`);
    tx.update(environments).set(discarded).where(eq(environments.id, current.id)).run();
    return tx.update(environments).set({ ownerThreadId: current.ownerThreadId, attempt: current.attempt, status: existing.status, teardownStatus: current.teardownStatus, retireAt: current.retireAt, statusMessage: existing.status === "provisioning" ? existing.statusMessage : current.statusMessage, pendingLog: existing.status === "provisioning" ? existing.pendingLog : current.pendingLog, claimPath: current.claimPath, environmentProviderId: existing.environmentProviderId ?? current.environmentProviderId, environmentProviderPluginId: existing.environmentProviderId === null ? current.environmentProviderPluginId : existing.environmentProviderPluginId, environmentProviderSelection: existing.environmentProviderId === null ? current.environmentProviderSelection : existing.environmentProviderSelection, environmentProviderInstanceKey: existing.environmentProviderId === null ? current.environmentProviderInstanceKey : existing.environmentProviderInstanceKey }).where(eq(environments.id, existing.id)).returning().get()!;
  }, { behavior: "immediate" });
}

type ThreadRow = typeof threads.$inferSelect;

export interface EnvironmentTeardownFailureInput {
  teardownMessage: string;
  retireAt: number | null;
  updatedAt: number;
}

export interface HostEnvironmentRemovalState {
  id: string;
  path: string | null;
  providerOwnsPath: boolean;
  status: EnvironmentRow["status"];
  teardownStatus: EnvironmentRow["teardownStatus"];
}

export interface UndeletedEnvironmentThread {
  environmentId: string | null;
  id: string;
  status: ThreadRow["status"];
}

export interface StoppingEnvironmentThread {
  id: string;
  status: ThreadRow["status"];
}

export interface ReadyEnvironmentWatchTarget {
  id: string;
  hostId: string;
  path: string | null;
  mergeBaseBranch: string | null;
  baseBranch: string | null;
  defaultBranch: string | null;
}

export interface LiveThreadHost {
  id: string;
  hostId: string;
}

export function setEnvironmentColumns(
  db: DbQueryConnection,
  environmentId: string,
  change: Partial<EnvironmentRow>,
): number {
  return db
    .update(environments)
    .set(change)
    .where(eq(environments.id, environmentId))
    .run().changes;
}

export function recordEnvironmentTeardownFailure(
  db: DbQueryConnection,
  environmentId: string,
  input: EnvironmentTeardownFailureInput,
): boolean {
  return (
    db
      .update(environments)
      .set({
        teardownStatus: "failed",
        teardownMessage: input.teardownMessage,
        retireAt: input.retireAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(environments.id, environmentId),
          or(
            isNull(environments.teardownStatus),
            ne(environments.teardownStatus, "removed"),
          ),
        ),
      )
      .returning({ id: environments.id })
      .all().length > 0
  );
}

export function listProvisioningEnvironmentIdsOnHost(
  db: DbQueryConnection,
  hostId: string,
): string[] {
  return db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.hostId, hostId),
        eq(environments.status, "provisioning"),
      ),
    )
    .all()
    .map((row) => row.id);
}

export function listHostEnvironmentRemovalStates(
  db: DbQueryConnection,
  hostId: string,
): HostEnvironmentRemovalState[] {
  return db
    .select({
      id: environments.id,
      path: environments.path,
      providerOwnsPath: environments.providerOwnsPath,
      status: environments.status,
      teardownStatus: environments.teardownStatus,
    })
    .from(environments)
    .where(eq(environments.hostId, hostId))
    .all();
}

export function listUndeletedEnvironmentThreads(
  db: DbQueryConnection,
  environmentId: string,
): UndeletedEnvironmentThread[] {
  return db
    .select({
      environmentId: threads.environmentId,
      id: threads.id,
      status: threads.status,
    })
    .from(threads)
    .where(
      and(eq(threads.environmentId, environmentId), isNull(threads.deletedAt)),
    )
    .all();
}

export function listStoppingLiveEnvironmentThreads(
  db: DbQueryConnection,
  environmentId: string,
): StoppingEnvironmentThread[] {
  return db
    .select({
      id: threads.id,
      status: threads.status,
    })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environmentId),
        eq(threads.status, "stopping"),
        liveThread,
      ),
    )
    .all();
}

export function listEnvironmentThreads(
  db: DbQueryConnection,
  environmentId: string,
): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .where(eq(threads.environmentId, environmentId))
    .all();
}

export function getStartingLiveEnvironmentThread(
  db: DbQueryConnection,
  environmentId: string,
): ThreadRow | null {
  return (
    db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.environmentId, environmentId),
          eq(threads.status, "starting"),
          liveThread,
        ),
      )
      .get() ?? null
  );
}

export function listStartingLiveEnvironmentThreadIds(
  db: DbQueryConnection,
  environmentId: string,
): string[] {
  return db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environmentId),
        eq(threads.status, "starting"),
        liveThread,
      ),
    )
    .all()
    .map((row) => row.id);
}

export function environmentHasOtherStartingOrActiveThread(
  db: DbQueryConnection,
  args: { environmentId: string; threadId: string },
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.environmentId, args.environmentId),
          ne(threads.id, args.threadId),
          inArray(threads.status, ["starting", "active"]),
          liveThread,
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function retryFailedEnvironmentTeardownsOnHost(
  db: DbQueryConnection,
  hostId: string,
  retireAt: number,
): string[] {
  return db
    .update(environments)
    .set({ retireAt })
    .where(
      and(
        eq(environments.hostId, hostId),
        eq(environments.teardownStatus, "failed"),
      ),
    )
    .returning({ id: environments.id })
    .all()
    .map((row) => row.id);
}

export function getFailedTeardownEnvironmentOnHost(
  db: DbQueryConnection,
  hostId: string,
): EnvironmentRow | null {
  return (
    db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.hostId, hostId),
          eq(environments.teardownStatus, "failed"),
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export function listReadyEnvironmentWatchTargets(
  db: DbQueryConnection,
  environmentIds: readonly string[],
): ReadyEnvironmentWatchTarget[] {
  return db
    .select({
      id: environments.id,
      hostId: environments.hostId,
      path: environments.path,
      mergeBaseBranch: environments.mergeBaseBranch,
      baseBranch: environments.baseBranch,
      defaultBranch: environments.defaultBranch,
    })
    .from(environments)
    .where(
      and(
        inArray(environments.id, [...environmentIds]),
        eq(environments.status, "ready"),
      ),
    )
    .all();
}

export function listLiveThreadHosts(
  db: DbQueryConnection,
  threadIds: readonly string[],
): LiveThreadHost[] {
  return db
    .select({
      id: threads.id,
      hostId: environments.hostId,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        inArray(threads.id, [...threadIds]),
        liveThread,
        ne(environments.status, "destroyed"),
      ),
    )
    .all();
}

export function listProvisioningEnvironmentIds(
  db: DbQueryConnection,
): string[] {
  return db
    .select({ id: environments.id })
    .from(environments)
    .where(
      or(
        inArray(environments.status, ["creating", "provisioning"]),
        eq(environments.createPending, true),
      ),
    )
    .all()
    .map((environment) => environment.id);
}

export function adoptHeldEnvironment(db: DbConnection, provisioning: EnvironmentRow, environmentId: string, holder: EnvironmentHolder, resource: JsonValue): EnvironmentRow {
  return db.transaction((tx) => {
    const current = getEnvironment(tx, provisioning.id);
    if (current === null || current.attempt !== provisioning.attempt || current.ownerThreadId !== provisioning.ownerThreadId || current.status !== "creating") throw new Error("Environment preparation is no longer current");
    const held = getEnvironment(tx, environmentId);
    if (held === null || held.heldBy !== holder) throw new Error(`Environment ${environmentId} is not held by ${holder.slice("plugin:".length)}`);
    if (held.projectId !== current.projectId || held.hostId !== current.hostId) throw new Error(`Environment ${environmentId} is on another project or machine`);
    if (held.teardownStatus !== null || held.status !== "ready" || held.ownerThreadId !== null) throw new Error(`Environment ${environmentId} is not ready to hand over`);
    tx.update(environments).set({ ownerThreadId: null, status: "destroyed", teardownStatus: "removed", claimPath: null, resource: null, path: null, createPending: false }).where(eq(environments.id, current.id)).run();
    return tx.update(environments).set({ ownerThreadId: current.ownerThreadId, attempt: current.attempt, createPending: true, resource, retireAt: current.retireAt, statusMessage: current.statusMessage, pendingLog: "" }).where(eq(environments.id, held.id)).returning().get()!;
  }, { behavior: "immediate" });
}

export function releaseEnvironmentHolds(db: EnvironmentWriteConnection, holder: EnvironmentHolder): string[] {
  return db.update(environments).set({ heldBy: null, updatedAt: Date.now() }).where(and(eq(environments.heldBy, holder), isNull(environments.ownerThreadId))).returning({ id: environments.id }).all().map((row) => row.id);
}
