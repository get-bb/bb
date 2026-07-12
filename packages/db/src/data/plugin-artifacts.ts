import { and, asc, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { installedPlugins, pluginArtifacts } from "../schema.js";

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

interface PluginArtifactInputBase {
  id: string;
  pluginId: string;
  path: string;
  contentHash: string | null;
  validationResult: "pending" | "valid" | "invalid";
  validationDetail: string | null;
  validatedAt: number | null;
}

export type CreatePluginArtifactInput = PluginArtifactInputBase &
  (
    | {
        sourceKind: "npm";
        npmResolvedVersion: string;
        gitResolvedCommit: null;
        integrity: string;
      }
    | {
        sourceKind: "git";
        npmResolvedVersion: null;
        gitResolvedCommit: string;
        integrity: string | null;
      }
  );

export function createPluginArtifact(
  db: DbConnection,
  artifact: CreatePluginArtifactInput,
): PluginArtifactRow {
  if (
    (artifact.sourceKind === "npm" &&
      (typeof artifact.npmResolvedVersion !== "string" ||
        artifact.npmResolvedVersion.length === 0 ||
        typeof artifact.integrity !== "string" ||
        artifact.integrity.length === 0 ||
        artifact.gitResolvedCommit !== null)) ||
    (artifact.sourceKind === "git" &&
      (typeof artifact.gitResolvedCommit !== "string" ||
        artifact.gitResolvedCommit.length === 0 ||
        artifact.npmResolvedVersion !== null))
  ) {
    throw new Error(
      "plugin artifact resolution fields do not match its source kind",
    );
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

export function getPluginArtifactByResolution(
  db: DbConnection,
  resolution:
    | {
        sourceKind: "npm";
        path: string;
        version: string;
        integrity: string;
      }
    | { sourceKind: "git"; path: string; commit: string },
): PluginArtifactRow | undefined {
  if (resolution.sourceKind === "npm") {
    return db
      .select()
      .from(pluginArtifacts)
      .where(
        and(
          eq(pluginArtifacts.sourceKind, "npm"),
          eq(pluginArtifacts.path, resolution.path),
          eq(pluginArtifacts.npmResolvedVersion, resolution.version),
          eq(pluginArtifacts.integrity, resolution.integrity),
        ),
      )
      .get();
  }
  return db
    .select()
    .from(pluginArtifacts)
    .where(
      and(
        eq(pluginArtifacts.sourceKind, "git"),
        eq(pluginArtifacts.path, resolution.path),
        eq(pluginArtifacts.gitResolvedCommit, resolution.commit),
      ),
    )
    .get();
}

export function setPluginArtifactValidation(
  db: DbConnection,
  id: string,
  validation: {
    contentHash: string;
    validationResult: "valid" | "invalid";
    validationDetail: string | null;
    validatedAt: number;
  },
): boolean {
  return (
    db
      .update(pluginArtifacts)
      .set({ ...validation, updatedAt: Date.now() })
      .where(eq(pluginArtifacts.id, id))
      .run().changes > 0
  );
}

export function deletePluginArtifact(db: DbConnection, id: string): boolean {
  return db.transaction((tx) => {
    tx.update(installedPlugins)
      .set({ activeArtifactId: null, updatedAt: Date.now() })
      .where(eq(installedPlugins.activeArtifactId, id))
      .run();
    return (
      tx.delete(pluginArtifacts).where(eq(pluginArtifacts.id, id)).run()
        .changes > 0
    );
  });
}
