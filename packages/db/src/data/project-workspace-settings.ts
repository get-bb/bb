import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { projectWorkspaceSettings } from "../schema.js";

export interface ProjectWorkspaceSettings {
  runScript: string | null;
  setupScript: string | null;
}

export interface UpsertProjectWorkspaceSettingsArgs
  extends ProjectWorkspaceSettings {
  projectId: string;
}

function toProjectWorkspaceSettings(
  row: typeof projectWorkspaceSettings.$inferSelect,
): ProjectWorkspaceSettings {
  return {
    runScript: row.runScript,
    setupScript: row.setupScript,
  };
}

export function getProjectWorkspaceSettings(
  db: DbConnection,
  projectId: string,
): ProjectWorkspaceSettings {
  const row = db
    .select()
    .from(projectWorkspaceSettings)
    .where(eq(projectWorkspaceSettings.projectId, projectId))
    .get();
  return row
    ? toProjectWorkspaceSettings(row)
    : { runScript: null, setupScript: null };
}

export function upsertProjectWorkspaceSettings(
  db: DbConnection,
  notifier: DbNotifier,
  args: UpsertProjectWorkspaceSettingsArgs,
): ProjectWorkspaceSettings {
  const updatedAt = Date.now();
  const row = db
    .insert(projectWorkspaceSettings)
    .values({ ...args, updatedAt })
    .onConflictDoUpdate({
      target: projectWorkspaceSettings.projectId,
      set: {
        runScript: args.runScript,
        setupScript: args.setupScript,
        updatedAt,
      },
    })
    .returning()
    .get();
  notifier.notifyProject(args.projectId, ["project-updated"]);
  return toProjectWorkspaceSettings(row);
}
