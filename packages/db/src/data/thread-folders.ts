import { asc, eq, or, sql } from "drizzle-orm";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createThreadFolderId } from "../ids.js";
import type { DbNotifier } from "../notifier.js";
import { threadFolders, threads } from "../schema.js";

type ThreadFolderWriteConnection = DbConnection | DbTransaction;

export type ThreadFolderRow = typeof threadFolders.$inferSelect;

export interface CreateThreadFolderInput {
  path: string;
}

export interface RenameThreadFolderInput {
  path: string;
  newPath: string;
}

export interface DeleteThreadFolderInput {
  path: string;
}

export interface ThreadFolderMutationResult {
  path: string;
  updatedThreadCount: number;
}

function splitFolderSegments(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function normalizeThreadFolderPath(
  path: string | null | undefined,
): string | null {
  const normalized = splitFolderSegments(path ?? "").join("/");
  return normalized.length > 0 ? normalized : null;
}

function folderAncestors(path: string): string[] {
  const segments = splitFolderSegments(path);
  const ancestors: string[] = [];
  for (let depth = 1; depth <= segments.length; depth += 1) {
    ancestors.push(segments.slice(0, depth).join("/"));
  }
  return ancestors;
}

function folderPathSubtreeFilter(
  column: typeof threadFolders.path | typeof threads.folderPath,
  path: string,
) {
  return or(
    eq(column, path),
    sql`substr(${column}, 1, ${path.length + 1}) = ${`${path}/`}`,
  );
}

function replaceFolderPathPrefix(
  value: string,
  oldPath: string,
  newPath: string,
): string {
  if (value === oldPath) {
    return newPath;
  }
  return `${newPath}/${value.slice(oldPath.length + 1)}`;
}

function notifyThreadFolderMutationProjects(
  notifier: DbNotifier,
  projectIds: ReadonlySet<string | null>,
): void {
  for (const projectId of projectIds) {
    notifier.notifyProject(projectId ?? PERSONAL_PROJECT_ID, [
      "threads-changed",
    ]);
  }
}

export function isThreadFolderDescendantPath(
  path: string | null | undefined,
  possibleDescendantPath: string | null | undefined,
): boolean {
  const normalizedPath = normalizeThreadFolderPath(path);
  const normalizedDescendant = normalizeThreadFolderPath(possibleDescendantPath);
  return Boolean(
    normalizedPath &&
      normalizedDescendant &&
      normalizedDescendant.startsWith(`${normalizedPath}/`),
  );
}

export function getThreadFolderByPath(
  db: DbQueryConnection,
  path: string,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderPath(path);
  if (!normalized) {
    return null;
  }
  return (
    db
      .select()
      .from(threadFolders)
      .where(eq(threadFolders.path, normalized))
      .get() ?? null
  );
}

export function listThreadFolders(db: DbQueryConnection): ThreadFolderRow[] {
  return db
    .select()
    .from(threadFolders)
    .orderBy(asc(threadFolders.path), asc(threadFolders.id))
    .all();
}

export function ensureThreadFolderPath(
  db: ThreadFolderWriteConnection,
  notifier: DbNotifier,
  path: string | null | undefined,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderPath(path);
  if (!normalized) {
    return null;
  }

  const now = Date.now();
  let createdAny = false;
  let deepest: ThreadFolderRow | null = null;
  for (const ancestorPath of folderAncestors(normalized)) {
    const inserted =
      db
        .insert(threadFolders)
        .values({
          id: createThreadFolderId(),
          path: ancestorPath,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning()
        .get() ?? null;
    if (inserted) {
      createdAny = true;
      deepest = inserted;
      continue;
    }
    deepest = getThreadFolderByPath(db, ancestorPath);
  }

  if (createdAny) {
    notifier.notifyProject(PERSONAL_PROJECT_ID, ["threads-changed"]);
  }
  return deepest;
}

export function createThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadFolderInput,
): ThreadFolderRow {
  const folder = ensureThreadFolderPath(db, notifier, input.path);
  if (!folder) {
    throw new Error("Thread folder path cannot be empty");
  }
  return folder;
}

export function renameThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: RenameThreadFolderInput,
): ThreadFolderMutationResult | null {
  const path = normalizeThreadFolderPath(input.path);
  const newPath = normalizeThreadFolderPath(input.newPath);
  if (!path || !newPath) {
    return null;
  }
  if (path === newPath) {
    return { path: newPath, updatedThreadCount: 0 };
  }
  if (isThreadFolderDescendantPath(path, newPath)) {
    return null;
  }

  return db.transaction(
    (tx) => {
      const matchingFolders = tx
        .select()
        .from(threadFolders)
        .where(folderPathSubtreeFilter(threadFolders.path, path))
        .all();
      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
          folderPath: threads.folderPath,
        })
        .from(threads)
        .where(folderPathSubtreeFilter(threads.folderPath, path))
        .all();

      if (matchingFolders.length === 0 && matchingThreads.length === 0) {
        return null;
      }

      tx.delete(threadFolders)
        .where(folderPathSubtreeFilter(threadFolders.path, path))
        .run();

      // Folders are a single global namespace keyed by path, so the global
      // folder list (PERSONAL_PROJECT_ID) always refreshes; each moved thread's
      // own project refreshes too.
      const affectedProjects = new Set<string | null>([null]);
      for (const folder of matchingFolders) {
        ensureThreadFolderPath(
          tx,
          notifier,
          replaceFolderPathPrefix(folder.path, path, newPath),
        );
      }

      const now = Date.now();
      for (const thread of matchingThreads) {
        if (!thread.folderPath) {
          continue;
        }
        const nextFolderPath = replaceFolderPathPrefix(
          thread.folderPath,
          path,
          newPath,
        );
        affectedProjects.add(thread.projectId);
        ensureThreadFolderPath(tx, notifier, nextFolderPath);
        tx.update(threads)
          .set({ folderPath: nextFolderPath, updatedAt: now })
          .where(eq(threads.id, thread.id))
          .run();
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }

      notifyThreadFolderMutationProjects(notifier, affectedProjects);
      return { path: newPath, updatedThreadCount: matchingThreads.length };
    },
    { behavior: "immediate" },
  );
}

export function deleteThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: DeleteThreadFolderInput,
): ThreadFolderMutationResult | null {
  const path = normalizeThreadFolderPath(input.path);
  if (!path) {
    return null;
  }

  return db.transaction(
    (tx) => {
      const matchingFolders = tx
        .select()
        .from(threadFolders)
        .where(folderPathSubtreeFilter(threadFolders.path, path))
        .all();
      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
        })
        .from(threads)
        .where(folderPathSubtreeFilter(threads.folderPath, path))
        .all();

      if (matchingFolders.length === 0 && matchingThreads.length === 0) {
        return null;
      }

      tx.delete(threadFolders)
        .where(folderPathSubtreeFilter(threadFolders.path, path))
        .run();

      const now = Date.now();
      // The global folder list (PERSONAL_PROJECT_ID) always refreshes; each
      // cleared thread's own project refreshes too.
      const affectedProjects = new Set<string | null>([null]);
      for (const thread of matchingThreads) {
        affectedProjects.add(thread.projectId);
        tx.update(threads)
          .set({ folderPath: null, updatedAt: now })
          .where(eq(threads.id, thread.id))
          .run();
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }

      notifyThreadFolderMutationProjects(notifier, affectedProjects);
      return { path, updatedThreadCount: matchingThreads.length };
    },
    { behavior: "immediate" },
  );
}
