import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { and, asc, eq, gt, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  parseAttachmentEventInput,
  promptInputSchema,
  type PromptInput,
} from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import {
  events,
  projectAttachmentBackfills,
  projects,
  promptHistoryEntries,
  queuedThreadMessages,
  threads,
} from "../schema.js";

export type AttachmentBackfill = typeof projectAttachmentBackfills.$inferSelect;
const emptyCursor = {
  threadCursor: "",
  inputCursor: 0,
  inputId: "",
  inputSequence: 0,
};
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

export function startAttachmentBackfillPhase(
  state: AttachmentBackfill,
  phase: AttachmentBackfill["phase"],
  threadCursor = state.threadCursor,
): AttachmentBackfill {
  return { ...state, ...emptyCursor, phase, threadCursor };
}

export function ensureProjectAttachmentBackfill(
  db: DbConnection,
  projectId: string,
): AttachmentBackfill {
  db.insert(projectAttachmentBackfills)
    .values({
      projectId,
      phase: "files",
      ...emptyCursor,
      attemptedAt: 0,
      error: null,
    })
    .onConflictDoNothing()
    .run();
  return db
    .select()
    .from(projectAttachmentBackfills)
    .where(eq(projectAttachmentBackfills.projectId, projectId))
    .get()!;
}

export function nextProjectAttachmentBackfill(
  db: DbConnection,
  now: number,
): string | null {
  const missing = db
    .select({ id: projects.id })
    .from(projects)
    .leftJoin(
      projectAttachmentBackfills,
      eq(projectAttachmentBackfills.projectId, projects.id),
    )
    .where(sql`${projectAttachmentBackfills.projectId} IS NULL`)
    .orderBy(asc(projects.id))
    .limit(1)
    .get();
  if (missing) return missing.id;
  return (
    db
      .select({ id: projectAttachmentBackfills.projectId })
      .from(projectAttachmentBackfills)
      .where(
        and(
          ne(projectAttachmentBackfills.phase, "done"),
          or(
            isNull(projectAttachmentBackfills.error),
            lt(projectAttachmentBackfills.attemptedAt, now - 60_000),
          ),
        ),
      )
      .orderBy(
        asc(projectAttachmentBackfills.attemptedAt),
        asc(projectAttachmentBackfills.projectId),
      )
      .limit(1)
      .get()?.id ?? null
  );
}

export function updateAttachmentBackfill(
  db: DbQueryConnection,
  state: AttachmentBackfill,
): void {
  db.update(projectAttachmentBackfills)
    .set(state)
    .where(eq(projectAttachmentBackfills.projectId, state.projectId))
    .run();
}

export function readAttachmentBackfillInput(
  db: DbConnection,
  state: AttachmentBackfill,
): { input: PromptInput[]; next: AttachmentBackfill; threadId: string | null } {
  const thread = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.projectId, state.projectId),
        state.threadCursor === ""
          ? undefined
          : gte(threads.id, state.threadCursor),
      ),
    )
    .orderBy(asc(threads.id))
    .limit(1)
    .get();
  if (!thread)
    return {
      input: [],
      threadId: null,
      next: startAttachmentBackfillPhase(state, "done", ""),
    };
  if (thread.id !== state.threadCursor)
    state = startAttachmentBackfillPhase(state, "events", thread.id);
  if (state.phase === "events") {
    const row = db
      .select({ data: boundedInput(events.data), sequence: events.sequence })
      .from(events)
      .where(
        and(
          eq(events.threadId, thread.id),
          eq(events.type, "client/turn/requested"),
          gt(events.sequence, state.inputCursor),
        ),
      )
      .orderBy(asc(events.sequence))
      .limit(1)
      .get();
    if (row) {
      checkInputSize(row.data);
      return {
        input: parseAttachmentEventInput(row.data),
        threadId: thread.id,
        next: { ...state, inputCursor: row.sequence },
      };
    }
    return {
      input: [],
      threadId: thread.id,
      next: startAttachmentBackfillPhase(state, "queue"),
    };
  }
  if (state.phase === "queue") {
    const row = db
      .select({
        data: boundedInput(queuedThreadMessages.content),
        createdAt: queuedThreadMessages.createdAt,
        id: queuedThreadMessages.id,
      })
      .from(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.threadId, thread.id),
          sql`(${queuedThreadMessages.createdAt}, ${queuedThreadMessages.id}) > (${state.inputCursor}, ${state.inputId})`,
        ),
      )
      .orderBy(
        asc(queuedThreadMessages.createdAt),
        asc(queuedThreadMessages.id),
      )
      .limit(1)
      .get();
    if (row)
      return {
        input: parseInput(row.data),
        threadId: thread.id,
        next: { ...state, inputCursor: row.createdAt, inputId: row.id },
      };
    return {
      input: [],
      threadId: thread.id,
      next: startAttachmentBackfillPhase(state, "history-thread"),
    };
  }
  const scope = state.phase === "history-thread" ? "thread" : "project";
  const row = db
    .select({
      data: boundedInput(promptHistoryEntries.input),
      createdAt: promptHistoryEntries.createdAt,
      sequence: promptHistoryEntries.requestSequence,
      id: promptHistoryEntries.id,
    })
    .from(promptHistoryEntries)
    .where(
      and(
        eq(promptHistoryEntries.threadId, thread.id),
        eq(promptHistoryEntries.scope, scope),
        sql`(${promptHistoryEntries.createdAt}, ${promptHistoryEntries.requestSequence}, ${promptHistoryEntries.id}) > (${state.inputCursor}, ${state.inputSequence}, ${state.inputId})`,
      ),
    )
    .orderBy(
      asc(promptHistoryEntries.createdAt),
      asc(promptHistoryEntries.requestSequence),
      asc(promptHistoryEntries.id),
    )
    .limit(1)
    .get();
  if (row)
    return {
      input: parseInput(row.data),
      threadId: thread.id,
      next: {
        ...state,
        inputCursor: row.createdAt,
        inputSequence: row.sequence,
        inputId: row.id,
      },
    };
  if (scope === "thread")
    return {
      input: [],
      threadId: thread.id,
      next: startAttachmentBackfillPhase(state, "history-project"),
    };
  const nextThread = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(eq(threads.projectId, state.projectId), gt(threads.id, thread.id)),
    )
    .orderBy(asc(threads.id))
    .limit(1)
    .get();
  return {
    input: [],
    threadId: null,
    next: startAttachmentBackfillPhase(
      state,
      nextThread ? "events" : "done",
      nextThread?.id ?? "",
    ),
  };
}

function checkInputSize(data: string | null): asserts data is string {
  if (data === null)
    throw new Error(
      "Attachment backfill input exceeds the 4 MiB batch limit; project cleanup remains disabled",
    );
}

function parseInput(data: string | null): PromptInput[] {
  checkInputSize(data);
  return promptInputSchema.array().parse(JSON.parse(data));
}

function boundedInput(column: AnySQLiteColumn) {
  return sql<
    string | null
  >`CASE WHEN length(CAST(${column} AS BLOB)) <= ${MAX_INPUT_BYTES} THEN ${column} END`;
}
