import { eq, inArray } from "drizzle-orm";
import type { EnvironmentProviderSelection } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { projectDefaultEnvironments } from "../schema.js";

export interface ProjectDefaultEnvironmentRecord {
  environmentProviderId: string;
  selection: EnvironmentProviderSelection;
}

export interface SetProjectDefaultEnvironmentArgs
  extends ProjectDefaultEnvironmentRecord {
  projectId: string;
}

const recordColumns = {
  environmentProviderId: projectDefaultEnvironments.environmentProviderId,
  selection: projectDefaultEnvironments.selection,
};

export function getProjectDefaultEnvironment(
  db: DbConnection,
  projectId: string,
): ProjectDefaultEnvironmentRecord | null {
  return (
    db
      .select(recordColumns)
      .from(projectDefaultEnvironments)
      .where(eq(projectDefaultEnvironments.projectId, projectId))
      .get() ?? null
  );
}

export function listProjectDefaultEnvironmentsByProjectIds(
  db: DbConnection,
  projectIds: readonly string[],
): Map<string, ProjectDefaultEnvironmentRecord> {
  const byProjectId = new Map<string, ProjectDefaultEnvironmentRecord>();
  if (projectIds.length === 0) {
    return byProjectId;
  }
  const rows = db
    .select({ projectId: projectDefaultEnvironments.projectId, ...recordColumns })
    .from(projectDefaultEnvironments)
    .where(inArray(projectDefaultEnvironments.projectId, [...projectIds]))
    .all();
  for (const { projectId, ...record } of rows) {
    byProjectId.set(projectId, record);
  }
  return byProjectId;
}

export function setProjectDefaultEnvironment(
  db: DbConnection,
  notifier: DbNotifier,
  args: SetProjectDefaultEnvironmentArgs,
): ProjectDefaultEnvironmentRecord {
  const updatedAt = Date.now();
  const record = db
    .insert(projectDefaultEnvironments)
    .values({
      projectId: args.projectId,
      environmentProviderId: args.environmentProviderId,
      selection: args.selection,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [projectDefaultEnvironments.projectId],
      set: {
        environmentProviderId: args.environmentProviderId,
        selection: args.selection,
        updatedAt,
      },
    })
    .returning(recordColumns)
    .get();
  notifier.notifyProject(args.projectId, ["project-updated"]);
  return record;
}

export function deleteProjectDefaultEnvironment(
  db: DbConnection,
  notifier: DbNotifier,
  projectId: string,
): boolean {
  const deleted = db
    .delete(projectDefaultEnvironments)
    .where(eq(projectDefaultEnvironments.projectId, projectId))
    .returning({ projectId: projectDefaultEnvironments.projectId })
    .get();
  if (deleted === undefined) {
    return false;
  }
  notifier.notifyProject(projectId, ["project-updated"]);
  return true;
}
