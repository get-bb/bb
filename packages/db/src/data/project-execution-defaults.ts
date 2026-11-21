import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  ProjectExecutionDefaults,
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectExecutionDefaults } from "../schema.js";

export interface GetProjectExecutionDefaultsArgs {
  projectId: string;
  providerId?: string;
}

export interface ListProjectExecutionDefaultsByProjectIdsArgs {
  projectIds: readonly string[];
}

export interface UpsertProjectExecutionDefaultsArgs {
  projectId: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  serviceTier: ServiceTier;
}

export function getProjectExecutionDefaults(
  db: DbConnection,
  args: GetProjectExecutionDefaultsArgs,
): ProjectExecutionDefaults | null {
  const row = db
    .select({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .from(projectExecutionDefaults)
    .where(
      args.providerId === undefined
        ? eq(projectExecutionDefaults.projectId, args.projectId)
        : and(
            eq(projectExecutionDefaults.projectId, args.projectId),
            eq(projectExecutionDefaults.providerId, args.providerId),
          ),
    )
    .orderBy(desc(projectExecutionDefaults.updatedAt), desc(sql`rowid`))
    .limit(1)
    .get();

  return row ?? null;
}

export function listProjectExecutionDefaultsByProjectIds(
  db: DbConnection,
  args: ListProjectExecutionDefaultsByProjectIdsArgs,
): Map<string, ProjectExecutionDefaults> {
  const byProjectId = new Map<string, ProjectExecutionDefaults>();
  if (args.projectIds.length === 0) {
    return byProjectId;
  }

  const rows = db
    .select({
      projectId: projectExecutionDefaults.projectId,
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .from(projectExecutionDefaults)
    .where(inArray(projectExecutionDefaults.projectId, [...args.projectIds]))
    .orderBy(asc(projectExecutionDefaults.updatedAt), asc(sql`rowid`))
    .all();

  for (const row of rows) {
    const { projectId, ...defaults } = row;
    byProjectId.set(projectId, defaults);
  }
  return byProjectId;
}

export function upsertProjectExecutionDefaults(
  db: DbConnection,
  args: UpsertProjectExecutionDefaultsArgs,
): ProjectExecutionDefaults {
  return db.transaction((tx) => {
    tx.delete(projectExecutionDefaults)
      .where(
        and(
          eq(projectExecutionDefaults.projectId, args.projectId),
          eq(projectExecutionDefaults.providerId, args.providerId),
        ),
      )
      .run();
    return tx
      .insert(projectExecutionDefaults)
      .values({
        projectId: args.projectId,
        providerId: args.providerId,
        model: args.model,
        reasoningLevel: args.reasoningLevel,
        permissionMode: args.permissionMode,
        serviceTier: args.serviceTier,
        updatedAt: Date.now(),
      })
      .returning({
        providerId: projectExecutionDefaults.providerId,
        model: projectExecutionDefaults.model,
        reasoningLevel: projectExecutionDefaults.reasoningLevel,
        permissionMode: projectExecutionDefaults.permissionMode,
        serviceTier: projectExecutionDefaults.serviceTier,
      })
      .get();
  });
}
