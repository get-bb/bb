import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import { environments, hosts, threads } from "../schema.js";

type Connection = DbConnection | DbTransaction;

const liveThreadCondition = or(
  and(isNull(threads.archivedAt), isNull(threads.deletedAt)),
  eq(threads.status, "stopping"),
  eq(threads.status, "active"),
);

export function listProviderMachines(db: Connection, providerId: string) {
  return db
    .select()
    .from(hosts)
    .where(eq(hosts.machineProviderId, providerId))
    .all();
}

export function machineHasLiveThreads(db: Connection, hostId: string): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(and(eq(environments.hostId, hostId), liveThreadCondition))
      .limit(1)
      .get() !== undefined
  );
}

function machineHasThreadLaunchWhere(
  db: Connection,
  hostId: string,
  threadCondition: SQL | undefined,
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(hosts)
      .innerJoin(threads, eq(hosts.launchKey, threads.id))
      .where(
        and(eq(hosts.id, hostId), isNull(hosts.destroyedAt), threadCondition),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function machineHasLiveThreadLaunch(
  db: Connection,
  hostId: string,
): boolean {
  return machineHasThreadLaunchWhere(db, hostId, liveThreadCondition);
}

export function machineHasPendingThreads(
  db: Connection,
  hostId: string,
): boolean {
  const intent = sql`case json_extract(${threads.startupContext}, '$.kind')
    when 'pending' then json_extract(${threads.startupContext}, '$.environmentIntent')
    when 'provisioning' then json_extract(${threads.startupContext}, '$.request.environmentIntent')
  end`;
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .leftJoin(
        environments,
        or(
          and(
            eq(environments.ownerThreadId, threads.id),
            eq(threads.status, "starting"),
          ),
          and(
            sql`json_extract(${intent}, '$.type') = 'reuse'`,
            eq(
              environments.id,
              sql`json_extract(${intent}, '$.environmentId')`,
            ),
          ),
        ),
      )
      .where(
        and(
          inArray(threads.status, ["pending", "starting"]),
          isNull(threads.archivedAt),
          isNull(threads.deletedAt),
          or(
            and(
              eq(environments.hostId, hostId),
              inArray(environments.status, [
                "creating",
                "provisioning",
                "ready",
              ]),
              isNull(environments.teardownStatus),
            ),
            sql`json_extract(${intent}, '$.type') = 'provider'
          and json_extract(${intent}, '$.machine.type') = 'existing'
          and json_extract(${intent}, '$.machine.hostId') = ${hostId}`,
          ),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function machineHasProvisioningEnvironment(
  db: Connection,
  hostId: string,
): boolean {
  return (
    db
      .select({ id: environments.id })
      .from(environments)
      .where(
        and(
          eq(environments.hostId, hostId),
          inArray(environments.status, ["creating", "provisioning"]),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

export function machineHasStartingThreadLaunch(
  db: Connection,
  hostId: string,
): boolean {
  return machineHasThreadLaunchWhere(
    db,
    hostId,
    and(
      eq(threads.status, "starting"),
      isNull(threads.archivedAt),
      isNull(threads.deletedAt),
    ),
  );
}
