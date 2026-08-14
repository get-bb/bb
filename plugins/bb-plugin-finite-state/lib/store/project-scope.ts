import type Database from "better-sqlite3";

/**
 * SQL predicate for cache catalogs whose sync_state alias is `s`.
 *
 * Bound Platform projects are visible only to their associated bb workspace.
 * Platform projects with no association remain visible so upgrading does not
 * make pre-migration cache rows disappear.
 */
export const WORKSPACE_PLATFORM_PROJECT_PREDICATE = `(
  EXISTS (
    SELECT 1
      FROM workspace_platform_project_binding binding
     WHERE binding.workspace_project_id = ?
       AND binding.platform_project_id = s.project_id
  )
  OR NOT EXISTS (
    SELECT 1
      FROM workspace_platform_project_binding any_binding
     WHERE any_binding.platform_project_id = s.project_id
  )
)`;

export function bindWorkspacePlatformProject(
  db: Database.Database,
  workspaceProjectId: string,
  platformProjectId: string,
): void {
  db.prepare<[string, string]>(
    `INSERT OR IGNORE INTO workspace_platform_project_binding
       (workspace_project_id, platform_project_id)
     VALUES (?, ?)`,
  ).run(workspaceProjectId, platformProjectId);
}

/**
 * A legacy store with exactly one Platform project has an unambiguous owner:
 * the first validated workspace that opens its catalog. Multi-project legacy
 * stores retain the compatibility visibility branch until a later pull records
 * explicit associations.
 */
export function backfillUnambiguousWorkspaceProjectBinding(
  db: Database.Database,
  workspaceProjectId: string,
): void {
  db.prepare<[string]>(
    `INSERT OR IGNORE INTO workspace_platform_project_binding
       (workspace_project_id, platform_project_id)
     SELECT ?, MIN(project_id)
       FROM sync_state
      WHERE NOT EXISTS (
        SELECT 1 FROM workspace_platform_project_binding
      )
     HAVING COUNT(DISTINCT project_id) = 1`,
  ).run(workspaceProjectId);
}
