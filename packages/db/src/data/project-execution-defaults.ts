import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

export interface UpsertProjectExecutionDefaultsArgs extends GetProjectExecutionDefaultsArgs {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  serviceTier: ServiceTier;
  updatedAt?: number;
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
    .orderBy(desc(projectExecutionDefaults.updatedAt))
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
    .where(
      and(
        inArray(projectExecutionDefaults.projectId, [...args.projectIds]),
        sql`not exists (
          select 1
          from project_execution_defaults as newer
          where newer.project_id = ${projectExecutionDefaults.projectId}
            and newer.updated_at > ${projectExecutionDefaults.updatedAt}
        )`,
      ),
    )
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
  const requestedUpdatedAt = args.updatedAt ?? Date.now();
  const updatedAt = sql<number>`max(
    coalesce(
      (
        select max(${projectExecutionDefaults.updatedAt})
        from ${projectExecutionDefaults}
        where ${projectExecutionDefaults.projectId} = ${args.projectId}
      ),
      ${requestedUpdatedAt - 1}
    ) + 1,
    ${requestedUpdatedAt}
  )`;
  const row = db
    .insert(projectExecutionDefaults)
    .values({
      projectId: args.projectId,
      providerId: args.providerId,
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      permissionMode: args.permissionMode,
      serviceTier: args.serviceTier,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        projectExecutionDefaults.projectId,
        projectExecutionDefaults.providerId,
      ],
      set: {
        providerId: args.providerId,
        model: args.model,
        reasoningLevel: args.reasoningLevel,
        permissionMode: args.permissionMode,
        serviceTier: args.serviceTier,
        updatedAt,
      },
    })
    .returning({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .get();

  return row;
}
