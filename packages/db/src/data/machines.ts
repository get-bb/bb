import { and, eq, inArray, isNull, or } from "drizzle-orm";
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

export function machineHasLiveThreadLaunch(
  db: Connection,
  hostId: string,
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(hosts)
      .innerJoin(threads, eq(hosts.launchKey, threads.id))
      .where(
        and(
          eq(hosts.id, hostId),
          isNull(hosts.destroyedAt),
          liveThreadCondition,
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
