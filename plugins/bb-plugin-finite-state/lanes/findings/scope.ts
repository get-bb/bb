import type Database from "better-sqlite3";

import { WORKSPACE_PLATFORM_PROJECT_PREDICATE } from "../../lib/store/project-scope.js";

/** Pure scope check shared by reads and writes; it never backfills bindings. */
export function assertAcceptedFindingsScope(
  db: Database.Database,
  input: {
    workspaceProjectId: string;
    platformProjectId: string;
    projectVersionId: string;
  },
): void {
  const row = db
    .prepare(
      `SELECT 1
         FROM sync_state s
        WHERE ${WORKSPACE_PLATFORM_PROJECT_PREDICATE}
          AND s.project_id = ? AND s.project_version_id = ?
          AND s.entity_kind = 'finding'
          AND s.accepted_generation_id IS NOT NULL
        LIMIT 1`,
    )
    .get(
      input.workspaceProjectId,
      input.platformProjectId,
      input.projectVersionId,
    );
  if (!row) throw new Error("FINDINGS_ACCEPTED_SCOPE_REQUIRED");
}
