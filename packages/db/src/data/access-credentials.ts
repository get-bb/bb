import type { AccessCredentialKind } from "@bb/domain";
import { and, asc, eq, lte, ne } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { accessCredentials } from "../schema.js";

export interface StoredAccessCredential {
  id: string;
  kind: AccessCredentialKind;
  label: string;
  dpopJkt: string | null;
  parentId: string | null;
  secureOnly: boolean;
  origin: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

export interface InsertAccessCredentialArgs extends StoredAccessCredential {
  tokenHash: string | null;
}

const storedAccessCredentialColumns = {
  id: accessCredentials.id,
  kind: accessCredentials.kind,
  label: accessCredentials.label,
  dpopJkt: accessCredentials.dpopJkt,
  parentId: accessCredentials.parentId,
  secureOnly: accessCredentials.secureOnly,
  origin: accessCredentials.origin,
  createdAt: accessCredentials.createdAt,
  lastUsedAt: accessCredentials.lastUsedAt,
  expiresAt: accessCredentials.expiresAt,
};

export function insertAccessCredential(
  db: DbConnection,
  args: InsertAccessCredentialArgs,
): void {
  db.insert(accessCredentials).values(args).run();
}

export function getAccessCredentialByTokenHash(
  db: DbConnection,
  tokenHash: string,
): StoredAccessCredential | null {
  return (
    db
      .select(storedAccessCredentialColumns)
      .from(accessCredentials)
      .where(eq(accessCredentials.tokenHash, tokenHash))
      .get() ?? null
  );
}

export function getAccessCredential(
  db: DbConnection,
  id: string,
): StoredAccessCredential | null {
  return (
    db
      .select(storedAccessCredentialColumns)
      .from(accessCredentials)
      .where(eq(accessCredentials.id, id))
      .get() ?? null
  );
}

export function listAccessCredentials(
  db: DbConnection,
): StoredAccessCredential[] {
  return db
    .select(storedAccessCredentialColumns)
    .from(accessCredentials)
    .where(ne(accessCredentials.kind, "device-browser"))
    .orderBy(asc(accessCredentials.createdAt), asc(accessCredentials.id))
    .all();
}

export function deleteAccessCredential(db: DbConnection, id: string): boolean {
  return (
    db.delete(accessCredentials).where(eq(accessCredentials.id, id)).run()
      .changes > 0
  );
}

export function deleteAccessCredentialsByKindAndLabel(
  db: DbConnection,
  args: { kind: AccessCredentialKind; label: string },
): string[] {
  return db
    .delete(accessCredentials)
    .where(
      and(
        eq(accessCredentials.kind, args.kind),
        eq(accessCredentials.label, args.label),
      ),
    )
    .returning({ id: accessCredentials.id })
    .all()
    .map((row) => row.id);
}

export function deleteExpiredAccessCredentials(
  db: DbConnection,
  now: number,
): string[] {
  return db
    .delete(accessCredentials)
    .where(lte(accessCredentials.expiresAt, now))
    .returning({ id: accessCredentials.id })
    .all()
    .map((row) => row.id);
}

export function touchAccessCredential(
  db: DbConnection,
  args: { id: string; lastUsedAt: number; expiresAt: number },
): void {
  db.update(accessCredentials)
    .set({ lastUsedAt: args.lastUsedAt, expiresAt: args.expiresAt })
    .where(eq(accessCredentials.id, args.id))
    .run();
}
