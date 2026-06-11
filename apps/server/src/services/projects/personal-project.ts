import {
  ensurePersonalProject,
  getProjectExecutionDefaults,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { buildInitialProjectExecutionDefaults } from "../threads/thread-default-policy.js";

export function ensurePersonalProjectBootstrap(db: DbConnection): void {
  ensurePersonalProject(db);

  const existingDefaults = getProjectExecutionDefaults(db, {
    projectId: PERSONAL_PROJECT_ID,
  });
  if (existingDefaults) {
    return;
  }

  upsertProjectExecutionDefaults(db, {
    projectId: PERSONAL_PROJECT_ID,
    ...buildInitialProjectExecutionDefaults(),
  });
}
