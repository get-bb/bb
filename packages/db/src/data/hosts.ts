import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { HostChangeKind, JsonValue, PermissionMode } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { hosts } from "../schema.js";
import { createHostId } from "../ids.js";

type HostWriteConnection = DbConnection | DbTransaction;

export interface UpsertHostInput {
  connectMachineId?: string | null;
  id?: string;
  name: string;
  type?: "persistent" | "ephemeral";
  destroyedAt?: number | null;
}

export interface UpdateHostInput {
  type?: "persistent" | "ephemeral";
  machineOperationId?: string | null;
  launchKey?: string | null;
  inputs?: JsonValue | null;
  attempt?: number;
  pendingLog?: string;
  destroyedAt?: number | null;
  lastRejectedProtocolVersion?: number | null;
  maxPermissionMode?: PermissionMode;
  name?: string;
  machineProviderId?: string | null;
  phase?:
    | "creating"
    | "active"
    | "suspending"
    | "suspended"
    | "resuming"
    | "removing"
    | "destroyed";
  resource?: JsonValue | null;
  removeRetryAt?: number | null;
  statusMessage?: string | null;
  suspendRetryAt?: number | null;
  suspendedAt?: number | null;
  teardownAttempt?: number;
  teardownStatus?: "running" | "failed" | "removed" | null;
}

function notifyHostMutation(
  notifier: DbNotifier,
  previous: ReturnType<typeof getHost>,
  next: ReturnType<typeof getHost>,
): void {
  if (!previous || !next) {
    return;
  }

  const hostChange = getHostConnectionChange(previous, next);
  if (!hostChange) {
    return;
  }

  notifier.notifyHost(next.id, [hostChange]);
}

function getHostConnectionChange(
  previous: NonNullable<ReturnType<typeof getHost>>,
  next: NonNullable<ReturnType<typeof getHost>>,
): HostChangeKind | null {
  if (previous.destroyedAt === null && next.destroyedAt !== null) {
    return "host-disconnected";
  }

  if (previous.destroyedAt !== null && next.destroyedAt === null) {
    return "host-connected";
  }

  return null;
}

export function upsertHost(
  db: HostWriteConnection,
  notifier: DbNotifier,
  input: UpsertHostInput,
) {
  const now = Date.now();
  const id = input.id ?? createHostId();
  const existing = db.select().from(hosts).where(eq(hosts.id, id)).get();

  if (existing) {
    const updated = db
      .update(hosts)
      .set({
        type: input.type ?? existing.type,
        connectMachineId:
          input.connectMachineId !== undefined
            ? input.connectMachineId
            : existing.connectMachineId,
        destroyedAt:
          input.destroyedAt !== undefined
            ? input.destroyedAt
            : existing.destroyedAt,
        lastSeenAt: existing.lastSeenAt,
        lastRejectedProtocolVersion: existing.lastRejectedProtocolVersion,
        updatedAt: now,
      })
      .where(eq(hosts.id, id))
      .returning()
      .get()!;
    notifyHostMutation(notifier, existing, updated);
    return updated;
  } else {
    const row = db
      .insert(hosts)
      .values({
        id,
        name: input.name,
        type: input.type ?? "persistent",
        connectMachineId: input.connectMachineId ?? null,
        machineProviderId: null,
        resource: null,
        phase: "active",
        suspendedAt: null,
        statusMessage: null,
        suspendRetryAt: null,
        removeRetryAt: null,
        teardownAttempt: 0,
        teardownStatus: null,
        destroyedAt: input.destroyedAt ?? null,
        lastSeenAt: null,
        lastRejectedProtocolVersion: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    notifier.notifyHost(id, ["host-connected"]);
    return row;
  }
}

export function markHostSeen(
  db: HostWriteConnection,
  hostId: string,
  at: number = Date.now(),
): void {
  db.update(hosts)
    .set({ lastSeenAt: at, updatedAt: at })
    .where(eq(hosts.id, hostId))
    .run();
}

export function getHost(db: HostWriteConnection, id: string) {
  return db.select().from(hosts).where(eq(hosts.id, id)).get() ?? null;
}

export function getNonDestroyedHost(db: DbConnection, id: string) {
  return (
    db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, id), isNull(hosts.destroyedAt)))
      .get() ?? null
  );
}

export function getNonDestroyedHostByLaunchKey(
  db: HostWriteConnection,
  launchKey: string,
) {
  return (
    db
      .select()
      .from(hosts)
      .where(and(eq(hosts.launchKey, launchKey), isNull(hosts.destroyedAt)))
      .get() ?? null
  );
}

export function listHosts(db: DbConnection) {
  return db.select().from(hosts).all();
}

export function listPublicHosts(
  db: DbConnection,
  options?: { includeCreating?: boolean },
) {
  return db
    .select()
    .from(hosts)
    .where(
      and(
        isNull(hosts.destroyedAt),
        ...(options?.includeCreating ? [] : [ne(hosts.phase, "creating")]),
      ),
    )
    .all();
}

export function listNonDestroyedHostsByIds(
  db: DbConnection,
  hostIds: readonly string[],
) {
  if (hostIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(hosts)
    .where(and(inArray(hosts.id, [...hostIds]), isNull(hosts.destroyedAt)))
    .all();
}

export function updateHost(
  db: DbConnection,
  notifier: DbNotifier,
  hostId: string,
  input: UpdateHostInput,
) {
  const existing = getHost(db, hostId);
  if (!existing) {
    return null;
  }

  const now = Date.now();
  db.update(hosts)
    .set({
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.destroyedAt !== undefined
        ? { destroyedAt: input.destroyedAt }
        : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.maxPermissionMode !== undefined
        ? { maxPermissionMode: input.maxPermissionMode }
        : {}),
      ...(input.lastRejectedProtocolVersion !== undefined
        ? { lastRejectedProtocolVersion: input.lastRejectedProtocolVersion }
        : {}),
      ...(input.machineProviderId !== undefined
        ? { machineProviderId: input.machineProviderId }
        : {}),
      ...(input.machineOperationId !== undefined
        ? { machineOperationId: input.machineOperationId }
        : {}),
      ...(input.launchKey !== undefined ? { launchKey: input.launchKey } : {}),
      ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
      ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
      ...(input.pendingLog !== undefined
        ? { pendingLog: input.pendingLog }
        : {}),
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
      ...(input.resource !== undefined ? { resource: input.resource } : {}),
      ...(input.removeRetryAt !== undefined
        ? { removeRetryAt: input.removeRetryAt }
        : {}),
      ...(input.suspendedAt !== undefined
        ? { suspendedAt: input.suspendedAt }
        : {}),
      ...(input.statusMessage !== undefined
        ? { statusMessage: input.statusMessage }
        : {}),
      ...(input.suspendRetryAt !== undefined
        ? { suspendRetryAt: input.suspendRetryAt }
        : {}),
      ...(input.teardownAttempt !== undefined
        ? { teardownAttempt: input.teardownAttempt }
        : {}),
      ...(input.teardownStatus !== undefined
        ? { teardownStatus: input.teardownStatus }
        : {}),
      updatedAt: now,
    })
    .where(eq(hosts.id, hostId))
    .run();

  const updated = getHost(db, hostId);
  notifyHostMutation(notifier, existing, updated);
  return updated;
}
