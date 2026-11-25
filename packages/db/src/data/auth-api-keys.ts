import { and, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { authApiKeys, authUsers } from "../schema.js";

export interface InsertAuthUserIfMissingArgs {
  id: string;
  name: string;
  email: string;
  now: Date;
}

export interface DisableEnabledAuthApiKeysForHostArgs {
  configId: string;
  hostId: string;
  preserveKeyId: string | null;
  updatedAt: Date;
}

export interface DeleteExpiredAuthApiKeysArgs {
  configIds: readonly string[];
  now: Date;
}

export interface FindRedeemableAuthApiKeyArgs {
  configId: string;
  hashedKey: string;
  now: Date;
}

export interface RedeemableAuthApiKey {
  hostId: string;
  enrollSource: string | null;
  expiresAt: Date | null;
}

export interface HasEnabledAuthApiKeyForHostArgs {
  configId: string;
  hostId: string;
}

export function insertAuthUserIfMissing(
  db: DbQueryConnection,
  args: InsertAuthUserIfMissingArgs,
): void {
  db.insert(authUsers)
    .values({
      id: args.id,
      name: args.name,
      email: args.email,
      emailVerified: true,
      image: null,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing()
    .run();
}

export function disableEnabledAuthApiKeysForHost(
  db: DbQueryConnection,
  args: DisableEnabledAuthApiKeysForHostArgs,
): void {
  db.update(authApiKeys)
    .set({
      enabled: false,
      updatedAt: args.updatedAt,
    })
    .where(
      and(
        eq(authApiKeys.configId, args.configId),
        eq(authApiKeys.enabled, true),
        args.preserveKeyId === null
          ? undefined
          : ne(authApiKeys.id, args.preserveKeyId),
        sql`json_extract(${authApiKeys.metadata}, '$.hostId') = ${args.hostId}`,
      ),
    )
    .run();
}

export function deleteExpiredAuthApiKeys(
  db: DbQueryConnection,
  args: DeleteExpiredAuthApiKeysArgs,
): void {
  db.delete(authApiKeys)
    .where(
      and(
        inArray(authApiKeys.configId, [...args.configIds]),
        isNotNull(authApiKeys.expiresAt),
        lt(authApiKeys.expiresAt, args.now),
      ),
    )
    .run();
}

export function findRedeemableAuthApiKey(
  db: DbQueryConnection,
  args: FindRedeemableAuthApiKeyArgs,
): RedeemableAuthApiKey | null {
  return (
    db
      .select({
        hostId: sql<string>`json_extract(${authApiKeys.metadata}, '$.hostId')`,
        enrollSource: sql<
          string | null
        >`json_extract(${authApiKeys.metadata}, '$.enrollSource')`,
        expiresAt: authApiKeys.expiresAt,
      })
      .from(authApiKeys)
      .where(
        and(
          eq(authApiKeys.configId, args.configId),
          eq(authApiKeys.key, args.hashedKey),
          eq(authApiKeys.enabled, true),
          gt(authApiKeys.remaining, 0),
          gt(authApiKeys.expiresAt, args.now),
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export function hasEnabledAuthApiKeyForHost(
  db: DbQueryConnection,
  args: HasEnabledAuthApiKeyForHostArgs,
): boolean {
  return (
    db
      .select({ id: authApiKeys.id })
      .from(authApiKeys)
      .where(
        and(
          eq(authApiKeys.configId, args.configId),
          eq(authApiKeys.enabled, true),
          sql`json_extract(${authApiKeys.metadata}, '$.hostId') = ${args.hostId}`,
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}
