import { and, asc, desc, eq } from "drizzle-orm";
import type { ProjectSourceFolder } from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { projectSourceFolders, projectSources } from "../schema.js";
import { createProjectSourceFolderId } from "../ids.js";
import { createOrderKeyAfter } from "./order-keys.js";

const FIRST_FOLDER_SORT_KEY = "V";

type ProjectSourceFolderRow = typeof projectSourceFolders.$inferSelect;

function toProjectSourceFolder(
  row: ProjectSourceFolderRow,
): ProjectSourceFolder {
  return {
    id: row.id,
    projectSourceId: row.projectSourceId,
    path: row.path,
    createdAt: row.createdAt,
  };
}

export function listProjectSourceFolders(
  db: DbQueryConnection,
  projectSourceId: string,
): ProjectSourceFolder[] {
  return db
    .select()
    .from(projectSourceFolders)
    .where(eq(projectSourceFolders.projectSourceId, projectSourceId))
    .orderBy(asc(projectSourceFolders.sortKey), asc(projectSourceFolders.id))
    .all()
    .map(toProjectSourceFolder);
}

export interface ListProjectFolderPathsForHostArgs {
  projectId: string;
  hostId: string;
}

export function listProjectFolderPathsForHost(
  db: DbQueryConnection,
  args: ListProjectFolderPathsForHostArgs,
): string[] {
  return db
    .select({ path: projectSourceFolders.path })
    .from(projectSourceFolders)
    .innerJoin(
      projectSources,
      eq(projectSources.id, projectSourceFolders.projectSourceId),
    )
    .where(
      and(
        eq(projectSources.projectId, args.projectId),
        eq(projectSources.hostId, args.hostId),
      ),
    )
    .orderBy(asc(projectSourceFolders.sortKey), asc(projectSourceFolders.id))
    .all()
    .map((row) => row.path);
}

export interface CreateProjectSourceFolderInput {
  projectId: string;
  projectSourceId: string;
  path: string;
}

export function createProjectSourceFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateProjectSourceFolderInput,
): ProjectSourceFolder {
  const row = db.transaction((tx) => {
    const last = tx
      .select({ sortKey: projectSourceFolders.sortKey })
      .from(projectSourceFolders)
      .where(eq(projectSourceFolders.projectSourceId, input.projectSourceId))
      .orderBy(desc(projectSourceFolders.sortKey))
      .limit(1)
      .get();
    return tx
      .insert(projectSourceFolders)
      .values({
        id: createProjectSourceFolderId(),
        projectSourceId: input.projectSourceId,
        path: input.path,
        sortKey:
          last === undefined
            ? FIRST_FOLDER_SORT_KEY
            : createOrderKeyAfter({ previousKey: last.sortKey }),
        createdAt: Date.now(),
      })
      .returning()
      .get();
  });
  notifier.notifyProject(input.projectId, ["project-sources-changed"]);
  return toProjectSourceFolder(row);
}

export interface UpdateProjectSourceFolderPathInput {
  projectId: string;
  projectSourceId: string;
  folderId: string;
  path: string;
}

export function updateProjectSourceFolderPath(
  db: DbConnection,
  notifier: DbNotifier,
  input: UpdateProjectSourceFolderPathInput,
): ProjectSourceFolder | null {
  const row = db
    .update(projectSourceFolders)
    .set({ path: input.path })
    .where(
      and(
        eq(projectSourceFolders.id, input.folderId),
        eq(projectSourceFolders.projectSourceId, input.projectSourceId),
      ),
    )
    .returning()
    .get();
  if (row === undefined) {
    return null;
  }
  notifier.notifyProject(input.projectId, ["project-sources-changed"]);
  return toProjectSourceFolder(row);
}

export interface DeleteProjectSourceFolderInput {
  projectId: string;
  projectSourceId: string;
  folderId: string;
}

export function deleteProjectSourceFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: DeleteProjectSourceFolderInput,
): boolean {
  const deleted = db
    .delete(projectSourceFolders)
    .where(
      and(
        eq(projectSourceFolders.id, input.folderId),
        eq(projectSourceFolders.projectSourceId, input.projectSourceId),
      ),
    )
    .returning({ id: projectSourceFolders.id })
    .all();
  if (deleted.length === 0) {
    return false;
  }
  notifier.notifyProject(input.projectId, ["project-sources-changed"]);
  return true;
}
