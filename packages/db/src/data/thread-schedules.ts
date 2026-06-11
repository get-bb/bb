import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { createThreadScheduleId } from "../ids.js";
import { projects, threadSchedules, threads } from "../schema.js";
import { buildOrderedNumberCursorFilter } from "./cursor-pagination.js";

export type ThreadScheduleRow = typeof threadSchedules.$inferSelect;

export interface ThreadScheduleOverviewProjectRow {
  id: string;
  name: string;
}

export interface ThreadScheduleOverviewThreadRow {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
}

export interface ThreadScheduleWithThreadAndProjectRow {
  project: ThreadScheduleOverviewProjectRow;
  schedule: ThreadScheduleRow;
  thread: ThreadScheduleOverviewThreadRow;
}

export interface CreateThreadScheduleInput {
  cron: string;
  enabled: boolean;
  name: string;
  nextFireAt: number;
  projectId: string;
  prompt: string;
  threadId: string;
  timezone: string;
}

export interface UpdateThreadScheduleInput {
  cron?: string;
  enabled?: boolean;
  name?: string;
  nextFireAt?: number;
  prompt?: string;
  timezone?: string;
}

export interface AdvanceThreadScheduleAfterFireArgs {
  expectedNextFireAt: number;
  nextFireAt: number;
  now: number;
  scheduleId: string;
}

export interface AdvanceThreadScheduleAfterSkipArgs {
  expectedNextFireAt: number;
  nextFireAt: number;
  now: number;
  scheduleId: string;
}

export interface DisableThreadSchedulesByThreadArgs {
  now: number;
  projectId: string;
  threadId: string;
}

export interface DueThreadScheduleCursor {
  createdAt: number;
  id: string;
  nextFireAt: number;
}

export interface ListDueThreadSchedulesArgs {
  after?: DueThreadScheduleCursor;
  limit?: number;
  now: number;
}

export function createThreadSchedule(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadScheduleInput,
): ThreadScheduleRow {
  const now = Date.now();
  const schedule = db
    .insert(threadSchedules)
    .values({
      id: createThreadScheduleId(),
      projectId: input.projectId,
      threadId: input.threadId,
      name: input.name,
      enabled: input.enabled,
      kind: "cron",
      cron: input.cron,
      timezone: input.timezone,
      prompt: input.prompt,
      nextFireAt: input.nextFireAt,
      lastFiredAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  notifier.notifyProject(input.projectId, ["thread-schedules-changed"]);
  return schedule;
}

export function getThreadSchedule(
  db: DbConnection | DbTransaction,
  scheduleId: string,
): ThreadScheduleRow | null {
  return (
    db
      .select()
      .from(threadSchedules)
      .where(eq(threadSchedules.id, scheduleId))
      .get() ?? null
  );
}

export function listThreadSchedulesByThread(
  db: DbConnection,
  threadId: string,
): ThreadScheduleRow[] {
  return db
    .select()
    .from(threadSchedules)
    .where(eq(threadSchedules.threadId, threadId))
    .orderBy(asc(threadSchedules.name))
    .all();
}

export function listThreadSchedulesWithThreadAndProject(
  db: DbConnection,
): ThreadScheduleWithThreadAndProjectRow[] {
  return db
    .select({
      project: {
        id: projects.id,
        name: projects.name,
      },
      schedule: threadSchedules,
      thread: {
        id: threads.id,
        projectId: threads.projectId,
        title: threads.title,
        titleFallback: threads.titleFallback,
      },
    })
    .from(threadSchedules)
    .innerJoin(threads, eq(threadSchedules.threadId, threads.id))
    .innerJoin(projects, eq(threadSchedules.projectId, projects.id))
    .where(
      and(
        isNull(threads.deletedAt),
        isNull(threads.archivedAt),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(
      desc(threadSchedules.enabled),
      asc(threadSchedules.nextFireAt),
      asc(threadSchedules.name),
      asc(threadSchedules.id),
    )
    .all();
}

export function listDueThreadSchedules(
  db: DbConnection,
  args: ListDueThreadSchedulesArgs,
): ThreadScheduleRow[] {
  const afterFilter = buildOrderedNumberCursorFilter({
    after: args.after
      ? {
          value: args.after.nextFireAt,
          createdAt: args.after.createdAt,
          id: args.after.id,
        }
      : undefined,
    valueColumn: threadSchedules.nextFireAt,
    createdAtColumn: threadSchedules.createdAt,
    idColumn: threadSchedules.id,
  });
  const query = db
    .select()
    .from(threadSchedules)
    .where(
      and(
        eq(threadSchedules.enabled, true),
        lte(threadSchedules.nextFireAt, args.now),
        inArray(
          threadSchedules.projectId,
          db
            .select({ projectId: projects.id })
            .from(projects)
            .where(isNull(projects.deletedAt)),
        ),
        afterFilter,
      ),
    )
    .orderBy(
      threadSchedules.nextFireAt,
      threadSchedules.createdAt,
      threadSchedules.id,
    );
  return args.limit === undefined ? query.all() : query.limit(args.limit).all();
}

export function updateThreadSchedule(
  db: DbConnection,
  notifier: DbNotifier,
  scheduleId: string,
  input: UpdateThreadScheduleInput,
): ThreadScheduleRow | null {
  const existing = getThreadSchedule(db, scheduleId);
  if (!existing) {
    return null;
  }

  const updated = db
    .update(threadSchedules)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.cron !== undefined ? { cron: input.cron } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.nextFireAt !== undefined
        ? { nextFireAt: input.nextFireAt }
        : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(threadSchedules.id, scheduleId))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  notifier.notifyProject(updated.projectId, ["thread-schedules-changed"]);
  return updated;
}

export function deleteThreadSchedule(
  db: DbConnection,
  notifier: DbNotifier,
  scheduleId: string,
): boolean {
  const existing = getThreadSchedule(db, scheduleId);
  if (!existing) {
    return false;
  }

  db.delete(threadSchedules).where(eq(threadSchedules.id, scheduleId)).run();
  notifier.notifyProject(existing.projectId, ["thread-schedules-changed"]);
  return true;
}

export function disableThreadSchedulesByThread(
  db: DbConnection,
  notifier: DbNotifier,
  args: DisableThreadSchedulesByThreadArgs,
): number {
  const result = db
    .update(threadSchedules)
    .set({
      enabled: false,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(threadSchedules.threadId, args.threadId),
        eq(threadSchedules.enabled, true),
      ),
    )
    .run();

  if (result.changes > 0) {
    notifier.notifyProject(args.projectId, ["thread-schedules-changed"]);
  }
  return result.changes;
}

export function advanceThreadScheduleAfterFireInTransaction(
  db: DbTransaction,
  args: AdvanceThreadScheduleAfterFireArgs,
): boolean {
  const result = db
    .update(threadSchedules)
    .set({
      nextFireAt: args.nextFireAt,
      lastFiredAt: args.now,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(threadSchedules.id, args.scheduleId),
        eq(threadSchedules.enabled, true),
        eq(threadSchedules.nextFireAt, args.expectedNextFireAt),
      ),
    )
    .run();

  return result.changes > 0;
}

export function advanceThreadScheduleAfterSkipInTransaction(
  db: DbTransaction,
  args: AdvanceThreadScheduleAfterSkipArgs,
): boolean {
  const result = db
    .update(threadSchedules)
    .set({
      nextFireAt: args.nextFireAt,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(threadSchedules.id, args.scheduleId),
        eq(threadSchedules.enabled, true),
        eq(threadSchedules.nextFireAt, args.expectedNextFireAt),
      ),
    )
    .run();

  return result.changes > 0;
}

export function advanceThreadScheduleAfterSkip(
  db: DbConnection,
  notifier: DbNotifier,
  args: AdvanceThreadScheduleAfterSkipArgs & { projectId: string },
): boolean {
  const advanced = db.transaction(
    (tx) => advanceThreadScheduleAfterSkipInTransaction(tx, args),
    { behavior: "immediate" },
  );
  if (advanced) {
    notifier.notifyProject(args.projectId, ["thread-schedules-changed"]);
  }
  return advanced;
}
