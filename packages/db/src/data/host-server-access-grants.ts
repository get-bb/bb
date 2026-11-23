import { and, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { hostServerAccessGrants } from "../schema.js";

export type HostServerAccessGrantRow =
  typeof hostServerAccessGrants.$inferSelect;

export interface HostServerAccessGrantKey {
  hostId: string;
  providerId: string;
}

export function listHostServerAccessGrants(
  db: DbConnection,
  hostId: string,
): HostServerAccessGrantRow[] {
  return db
    .select()
    .from(hostServerAccessGrants)
    .where(eq(hostServerAccessGrants.hostId, hostId))
    .all();
}

export function getHostServerAccessGrant(
  db: DbConnection,
  key: HostServerAccessGrantKey,
): HostServerAccessGrantRow | null {
  return (
    db
      .select()
      .from(hostServerAccessGrants)
      .where(
        and(
          eq(hostServerAccessGrants.hostId, key.hostId),
          eq(hostServerAccessGrants.providerId, key.providerId),
        ),
      )
      .get() ?? null
  );
}

export function upsertHostServerAccessGrant(
  db: DbConnection,
  input: HostServerAccessGrantKey & { grantId: string | null },
): void {
  const now = Date.now();
  db.insert(hostServerAccessGrants)
    .values({ ...input, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [hostServerAccessGrants.hostId, hostServerAccessGrants.providerId],
      set: { grantId: input.grantId, updatedAt: now },
    })
    .run();
}

export function deleteHostServerAccessGrant(
  db: DbConnection,
  key: HostServerAccessGrantKey,
): void {
  db.delete(hostServerAccessGrants)
    .where(
      and(
        eq(hostServerAccessGrants.hostId, key.hostId),
        eq(hostServerAccessGrants.providerId, key.providerId),
      ),
    )
    .run();
}
