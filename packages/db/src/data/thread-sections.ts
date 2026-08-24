import { asc, eq } from "drizzle-orm";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createThreadSectionId } from "../ids.js";
import type { DbNotifier } from "../notifier.js";
import { threadSections, threads } from "../schema.js";

type ThreadSectionWriteConnection = DbConnection | DbTransaction;

export type ThreadSectionRow = typeof threadSections.$inferSelect;

export interface CreateThreadSectionInput {
  name: string;
}

export interface RenameThreadSectionInput {
  id: string;
  name: string;
}

export interface DeleteThreadSectionInput {
  id: string;
}

export interface ThreadSectionMutationResult {
  id: string;
  name: string;
  updatedThreadCount: number;
}

export type CreateThreadSectionResult =
  | { status: "created"; section: ThreadSectionRow }
  | { status: "duplicate"; section: ThreadSectionRow };

export type RenameThreadSectionResult =
  | { status: "renamed"; result: ThreadSectionMutationResult }
  | { status: "duplicate"; section: ThreadSectionRow }
  | { status: "not_found" };

export function normalizeThreadSectionName(
  name: string | null | undefined,
): string | null {
  const normalized = (name ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function notifyThreadSectionListChanged(notifier: DbNotifier): void {
  notifier.notifyProject(PERSONAL_PROJECT_ID, ["threads-changed"]);
}

function notifyThreadSectionMutationProjects(
  notifier: DbNotifier,
  projectIds: ReadonlySet<string>,
): void {
  notifyThreadSectionListChanged(notifier);
  for (const projectId of projectIds) {
    notifier.notifyProject(projectId, ["threads-changed"]);
  }
}

export function getThreadSectionById(
  db: DbQueryConnection,
  id: string,
): ThreadSectionRow | null {
  return db.select().from(threadSections).where(eq(threadSections.id, id)).get()
    ?? null;
}

function getThreadSectionByName(
  db: DbQueryConnection,
  name: string,
): ThreadSectionRow | null {
  const normalized = normalizeThreadSectionName(name);
  if (!normalized) {
    return null;
  }
  return (
    db
      .select()
      .from(threadSections)
      .where(eq(threadSections.name, normalized))
      .get() ?? null
  );
}

export function listThreadSections(db: DbQueryConnection): ThreadSectionRow[] {
  return db
    .select()
    .from(threadSections)
    .orderBy(asc(threadSections.name), asc(threadSections.id))
    .all();
}

export function createThreadSection(
  db: ThreadSectionWriteConnection,
  notifier: DbNotifier,
  input: CreateThreadSectionInput,
): CreateThreadSectionResult {
  const name = normalizeThreadSectionName(input.name);
  if (!name) {
    throw new Error("Thread section name cannot be empty");
  }

  const existing = getThreadSectionByName(db, name);
  if (existing) {
    return { status: "duplicate", section: existing };
  }

  const now = Date.now();
  const section = db
    .insert(threadSections)
    .values({
      id: createThreadSectionId(),
      name,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifyThreadSectionListChanged(notifier);
  return { status: "created", section };
}

export function renameThreadSection(
  db: DbConnection,
  notifier: DbNotifier,
  input: RenameThreadSectionInput,
): RenameThreadSectionResult {
  const name = normalizeThreadSectionName(input.name);
  if (!name) {
    return { status: "not_found" };
  }

  return db.transaction(
    (tx) => {
      const existing = getThreadSectionById(tx, input.id);
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

      const duplicate = getThreadSectionByName(tx, name);
      if (duplicate && duplicate.id !== input.id) {
        return { status: "duplicate", section: duplicate };
      }

      tx.update(threadSections)
        .set({ name, updatedAt: Date.now() })
        .where(eq(threadSections.id, input.id))
        .run();
      notifyThreadSectionListChanged(notifier);
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

export function deleteThreadSection(
  db: DbConnection,
  notifier: DbNotifier,
  input: DeleteThreadSectionInput,
): ThreadSectionMutationResult | null {
  return db.transaction(
    (tx) => {
      const section = getThreadSectionById(tx, input.id);
      if (!section) {
        return null;
      }

      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
        })
        .from(threads)
        .where(eq(threads.sectionId, input.id))
        .all();

      const now = Date.now();
      const affectedProjects = new Set<string>();
      tx.update(threads)
        .set({ sectionId: null, updatedAt: now })
        .where(eq(threads.sectionId, input.id))
        .run();
      for (const thread of matchingThreads) {
        affectedProjects.add(thread.projectId);
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }

      tx.delete(threadSections).where(eq(threadSections.id, input.id)).run();
      notifyThreadSectionMutationProjects(notifier, affectedProjects);
      return {
        id: section.id,
        name: section.name,
        updatedThreadCount: matchingThreads.length,
      };
    },
    { behavior: "immediate" },
  );
}
