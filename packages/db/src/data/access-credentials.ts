import type { AccessCredentialKind } from "@bb/domain";
import { asc, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { accessCredentials } from "../schema.js";

export interface StoredAccessCredential {
  id: string;
  kind: AccessCredentialKind;
  label: string;
  secureOnly: boolean;
  origin: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface InsertAccessCredentialArgs extends StoredAccessCredential {
  tokenHash: string;
}

const storedAccessCredentialColumns = {
  id: accessCredentials.id,
  kind: accessCredentials.kind,
  label: accessCredentials.label,
  secureOnly: accessCredentials.secureOnly,
  origin: accessCredentials.origin,
  createdAt: accessCredentials.createdAt,
  lastUsedAt: accessCredentials.lastUsedAt,
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

export function listAccessCredentials(
  db: DbConnection,
): StoredAccessCredential[] {
  return db
    .select(storedAccessCredentialColumns)
    .from(accessCredentials)
    .orderBy(asc(accessCredentials.createdAt), asc(accessCredentials.id))
    .all();
}

export function deleteAccessCredential(db: DbConnection, id: string): boolean {
  return (
    db.delete(accessCredentials).where(eq(accessCredentials.id, id)).run()
      .changes > 0
  );
}

export function touchAccessCredential(
  db: DbConnection,
  args: { id: string; lastUsedAt: number },
): void {
  db.update(accessCredentials)
    .set({ lastUsedAt: args.lastUsedAt })
    .where(eq(accessCredentials.id, args.id))
    .run();
}
