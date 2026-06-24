import { asc, eq } from "drizzle-orm";
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
  name: string;
}

export interface RenameThreadFolderInput {
  id: string;
  name: string;
}

export interface DeleteThreadFolderInput {
  id: string;
}

export interface ThreadFolderMutationResult {
  id: string;
  name: string;
  updatedThreadCount: number;
}

export type CreateThreadFolderResult =
  | { status: "created"; folder: ThreadFolderRow }
  | { status: "duplicate"; folder: ThreadFolderRow };

export type RenameThreadFolderResult =
  | { status: "renamed"; result: ThreadFolderMutationResult }
  | { status: "duplicate"; folder: ThreadFolderRow }
  | { status: "not_found" };

export function normalizeThreadFolderName(
  name: string | null | undefined,
): string | null {
  const normalized = (name ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function notifyThreadFolderListChanged(notifier: DbNotifier): void {
  notifier.notifyProject(PERSONAL_PROJECT_ID, ["threads-changed"]);
}

function notifyThreadFolderMutationProjects(
  notifier: DbNotifier,
  projectIds: ReadonlySet<string>,
): void {
  notifyThreadFolderListChanged(notifier);
  for (const projectId of projectIds) {
    notifier.notifyProject(projectId, ["threads-changed"]);
  }
}

export function getThreadFolderById(
  db: DbQueryConnection,
  id: string,
): ThreadFolderRow | null {
  return db.select().from(threadFolders).where(eq(threadFolders.id, id)).get()
    ?? null;
}

export function getThreadFolderByName(
  db: DbQueryConnection,
  name: string,
): ThreadFolderRow | null {
  const normalized = normalizeThreadFolderName(name);
  if (!normalized) {
    return null;
  }
  return (
    db
      .select()
      .from(threadFolders)
      .where(eq(threadFolders.name, normalized))
      .get() ?? null
  );
}

export function listThreadFolders(db: DbQueryConnection): ThreadFolderRow[] {
  return db
    .select()
    .from(threadFolders)
    .orderBy(asc(threadFolders.name), asc(threadFolders.id))
    .all();
}

export function createThreadFolder(
  db: ThreadFolderWriteConnection,
  notifier: DbNotifier,
  input: CreateThreadFolderInput,
): CreateThreadFolderResult {
  const name = normalizeThreadFolderName(input.name);
  if (!name) {
    throw new Error("Thread folder name cannot be empty");
  }

  const existing = getThreadFolderByName(db, name);
  if (existing) {
    return { status: "duplicate", folder: existing };
  }

  const now = Date.now();
  const folder = db
    .insert(threadFolders)
    .values({
      id: createThreadFolderId(),
      name,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifyThreadFolderListChanged(notifier);
  return { status: "created", folder };
}

export function renameThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: RenameThreadFolderInput,
): RenameThreadFolderResult {
  const name = normalizeThreadFolderName(input.name);
  if (!name) {
    return { status: "not_found" };
  }

  return db.transaction(
    (tx) => {
      const existing = getThreadFolderById(tx, input.id);
      if (!existing) {
        return { status: "not_found" };
      }

      if (existing.name === name) {
        return {
          status: "renamed",
          result: {
            id: existing.id,
            name: existing.name,
            updatedThreadCount: 0,
          },
        };
      }

      const duplicate = getThreadFolderByName(tx, name);
      if (duplicate && duplicate.id !== input.id) {
        return { status: "duplicate", folder: duplicate };
      }

      tx.update(threadFolders)
        .set({ name, updatedAt: Date.now() })
        .where(eq(threadFolders.id, input.id))
        .run();
      notifyThreadFolderListChanged(notifier);
      return {
        status: "renamed",
        result: {
          id: input.id,
          name,
          updatedThreadCount: 0,
        },
      };
    },
    { behavior: "immediate" },
  );
}

export function deleteThreadFolder(
  db: DbConnection,
  notifier: DbNotifier,
  input: DeleteThreadFolderInput,
): ThreadFolderMutationResult | null {
  return db.transaction(
    (tx) => {
      const folder = getThreadFolderById(tx, input.id);
      if (!folder) {
        return null;
      }

      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
        })
        .from(threads)
        .where(eq(threads.folderId, input.id))
        .all();

      const now = Date.now();
      const affectedProjects = new Set<string>();
      for (const thread of matchingThreads) {
        affectedProjects.add(thread.projectId);
        tx.update(threads)
          .set({ folderId: null, updatedAt: now })
          .where(eq(threads.id, thread.id))
          .run();
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }

      tx.delete(threadFolders).where(eq(threadFolders.id, input.id)).run();
      notifyThreadFolderMutationProjects(notifier, affectedProjects);
      return {
        id: folder.id,
        name: folder.name,
        updatedThreadCount: matchingThreads.length,
      };
    },
    { behavior: "immediate" },
  );
}
