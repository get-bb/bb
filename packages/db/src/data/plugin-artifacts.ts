import { asc, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginArtifacts } from "../schema.js";

export interface PluginArtifactRow {
  id: string;
  pluginId: string;
  sourceKind: "npm" | "git";
  npmResolvedVersion: string | null;
  gitResolvedCommit: string | null;
  path: string;
  integrity: string | null;
  contentHash: string | null;
  validationResult: "pending" | "valid" | "invalid";
  validationDetail: string | null;
  createdAt: number;
  updatedAt: number;
  validatedAt: number | null;
}

export type CreatePluginArtifactInput = Omit<
  PluginArtifactRow,
  "createdAt" | "updatedAt"
>;

export function createPluginArtifact(
  db: DbConnection,
  artifact: CreatePluginArtifactInput,
): PluginArtifactRow {
  if (
    (artifact.sourceKind === "npm" &&
      (artifact.npmResolvedVersion === null || artifact.gitResolvedCommit !== null)) ||
    (artifact.sourceKind === "git" &&
      (artifact.gitResolvedCommit === null || artifact.npmResolvedVersion !== null))
  ) {
    throw new Error("plugin artifact resolution fields do not match its source kind");
  }
  const now = Date.now();
  db.insert(pluginArtifacts)
    .values({ ...artifact, createdAt: now, updatedAt: now })
    .run();
  const row = getPluginArtifact(db, artifact.id);
  if (!row) throw new Error(`plugin artifact missing after insert: ${artifact.id}`);
  return row;
}

export function getPluginArtifact(
  db: DbConnection,
  id: string,
): PluginArtifactRow | undefined {
  return db.select().from(pluginArtifacts).where(eq(pluginArtifacts.id, id)).get();
}

export function listPluginArtifacts(
  db: DbConnection,
  pluginId: string,
): PluginArtifactRow[] {
  return db
    .select()
    .from(pluginArtifacts)
    .where(eq(pluginArtifacts.pluginId, pluginId))
    .orderBy(asc(pluginArtifacts.createdAt), asc(pluginArtifacts.id))
    .all();
}

export function deletePluginArtifact(db: DbConnection, id: string): boolean {
  return (
    db.delete(pluginArtifacts).where(eq(pluginArtifacts.id, id)).run().changes > 0
  );
}
