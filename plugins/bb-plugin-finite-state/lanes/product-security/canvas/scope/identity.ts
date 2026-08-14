import type Database from "better-sqlite3";

interface BindingRow {
  found: number;
}

export function workspacePlatformProjectIsBound(
  db: Database.Database,
  workspaceProjectId: string,
  platformProjectId: string,
): boolean {
  return (
    db
      .prepare<[string, string], BindingRow>(
        `SELECT 1 AS found
           FROM workspace_platform_project_binding
          WHERE workspace_project_id = ? AND platform_project_id = ?
          LIMIT 1`,
      )
      .get(workspaceProjectId, platformProjectId)?.found === 1
  );
}

export function assertWorkspacePlatformProjectBinding(
  db: Database.Database,
  workspaceProjectId: string,
  platformProjectId: string,
): void {
  if (
    !workspacePlatformProjectIsBound(db, workspaceProjectId, platformProjectId)
  ) {
    throw new Error(
      "The selected workspace is not associated with that Platform project. Open Sync and select the project before using version-scoped TARA.",
    );
  }
}
