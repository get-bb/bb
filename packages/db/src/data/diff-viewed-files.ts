import { and, eq, inArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { diffViewedFiles } from "../schema.js";

export interface DiffViewedFileScope {
  environmentId: string;
  targetKey: string;
}

export interface DiffViewedFileRecord {
  path: string;
  revision: string;
}

export function listDiffViewedFiles(
  db: DbConnection,
  scope: DiffViewedFileScope,
  paths: readonly string[] | null,
): DiffViewedFileRecord[] {
  if (paths?.length === 0) return [];
  return db
    .select({
      path: diffViewedFiles.path,
      revision: diffViewedFiles.revision,
    })
    .from(diffViewedFiles)
    .where(
      and(
        eq(diffViewedFiles.environmentId, scope.environmentId),
        eq(diffViewedFiles.targetKey, scope.targetKey),
        paths === null ? undefined : inArray(diffViewedFiles.path, [...paths]),
      ),
    )
    .orderBy(diffViewedFiles.path)
    .all();
}

export function markDiffViewedFile(
  db: DbConnection,
  args: DiffViewedFileScope & DiffViewedFileRecord,
): void {
  const updatedAt = Date.now();
  db.insert(diffViewedFiles)
    .values({ ...args, updatedAt })
    .onConflictDoUpdate({
      target: [
        diffViewedFiles.environmentId,
        diffViewedFiles.targetKey,
        diffViewedFiles.path,
      ],
      set: { revision: args.revision, updatedAt },
    })
    .run();
}

export function clearDiffViewedFiles(
  db: DbConnection,
  args: DiffViewedFileScope & { path: string | null },
): void {
  db.delete(diffViewedFiles)
    .where(
      and(
        eq(diffViewedFiles.environmentId, args.environmentId),
        eq(diffViewedFiles.targetKey, args.targetKey),
        args.path === null ? undefined : eq(diffViewedFiles.path, args.path),
      ),
    )
    .run();
}
