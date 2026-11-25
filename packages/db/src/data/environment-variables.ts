import { and, eq, isNull } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { environmentVariables } from "../schema.js";

export type EnvironmentVariableRow = typeof environmentVariables.$inferSelect;
export type SaveEnvironmentVariableInput = Omit<
  EnvironmentVariableRow,
  "id" | "updatedAt"
>;

export interface DeleteEnvironmentVariableArgs {
  projectId: string | null;
  name: string;
}

function scope(projectId: string | null) {
  return projectId === null
    ? isNull(environmentVariables.projectId)
    : eq(environmentVariables.projectId, projectId);
}

export function listEnvironmentVariables(
  db: DbQueryConnection,
  projectId: string | null,
): EnvironmentVariableRow[] {
  return db
    .select()
    .from(environmentVariables)
    .where(scope(projectId))
    .orderBy(environmentVariables.name)
    .all();
}

export function hasAnyEnvironmentVariable(db: DbQueryConnection): boolean {
  return (
    db
      .select({ id: environmentVariables.id })
      .from(environmentVariables)
      .limit(1)
      .get() !== undefined
  );
}

export function deleteEnvironmentVariable(
  db: DbQueryConnection,
  args: DeleteEnvironmentVariableArgs,
): void {
  db.delete(environmentVariables)
    .where(
      and(scope(args.projectId), eq(environmentVariables.name, args.name)),
    )
    .run();
}

export function saveEnvironmentVariable(
  db: DbQueryConnection,
  row: SaveEnvironmentVariableInput,
): void {
  deleteEnvironmentVariable(db, { projectId: row.projectId, name: row.name });
  db.insert(environmentVariables)
    .values({ ...row, updatedAt: Date.now() })
    .run();
}

export function deleteEnvironmentVariablesInScope(
  db: DbQueryConnection,
  projectId: string | null,
): void {
  db.delete(environmentVariables).where(scope(projectId)).run();
}
