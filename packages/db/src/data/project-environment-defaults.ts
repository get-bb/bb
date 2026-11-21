import { eq, inArray } from "drizzle-orm";
import type { JsonValue, ProjectEnvironmentDefault } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectEnvironmentDefaults } from "../schema.js";

const projectEnvironmentDefaultColumns = {
  environmentProviderId: projectEnvironmentDefaults.environmentProviderId,
  inputs: projectEnvironmentDefaults.inputs,
};

function toProjectEnvironmentDefault(row: {
  environmentProviderId: string;
  inputs: JsonValue | null;
}): ProjectEnvironmentDefault {
  return {
    environmentProviderId: row.environmentProviderId,
    inputs: row.inputs,
  };
}

export function getProjectEnvironmentDefault(
  db: DbConnection,
  args: { projectId: string },
): ProjectEnvironmentDefault | null {
  const row = db
    .select(projectEnvironmentDefaultColumns)
    .from(projectEnvironmentDefaults)
    .where(eq(projectEnvironmentDefaults.projectId, args.projectId))
    .get();
  return row === undefined ? null : toProjectEnvironmentDefault(row);
}

export function listProjectEnvironmentDefaultsByProjectIds(
  db: DbConnection,
  args: { projectIds: readonly string[] },
): Map<string, ProjectEnvironmentDefault> {
  const byProjectId = new Map<string, ProjectEnvironmentDefault>();
  if (args.projectIds.length === 0) {
    return byProjectId;
  }
  const rows = db
    .select({
      projectId: projectEnvironmentDefaults.projectId,
      ...projectEnvironmentDefaultColumns,
    })
    .from(projectEnvironmentDefaults)
    .where(inArray(projectEnvironmentDefaults.projectId, [...args.projectIds]))
    .all();
  for (const row of rows) {
    byProjectId.set(row.projectId, toProjectEnvironmentDefault(row));
  }
  return byProjectId;
}

export function setProjectEnvironmentDefault(
  db: DbConnection,
  args: { projectId: string; value: ProjectEnvironmentDefault | null },
): void {
  if (args.value === null) {
    db.delete(projectEnvironmentDefaults)
      .where(eq(projectEnvironmentDefaults.projectId, args.projectId))
      .run();
    return;
  }
  const updatedAt = Date.now();
  db.insert(projectEnvironmentDefaults)
    .values({
      projectId: args.projectId,
      environmentProviderId: args.value.environmentProviderId,
      inputs: args.value.inputs,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [projectEnvironmentDefaults.projectId],
      set: {
        environmentProviderId: args.value.environmentProviderId,
        inputs: args.value.inputs,
        updatedAt,
      },
    })
    .run();
}
