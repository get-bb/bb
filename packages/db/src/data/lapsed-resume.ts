import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { appSettingsValues, projects, threads } from "../schema.js";

const APP_OPEN_KEY = "lapsed-resume.last-open";
const correlatedThreadId = sql`${threads}.${sql.identifier(threads.id.name)}`;

const threadPresenceAt = sql<number>`max(
  ${threads.createdAt},
  coalesce(${threads.lastReadAt}, 0),
  coalesce((
    SELECT requested.created_at FROM events AS requested
    WHERE requested.thread_id = ${correlatedThreadId}
      AND requested.type = 'client/turn/requested'
    ORDER BY requested.sequence DESC LIMIT 1
  ), 0)
)`;

export function getLapsedResumeActivity(db: DbQueryConnection) {
  const row = db
    .select({
      lastPresenceAt: sql<number | null>`max(${threadPresenceAt})`,
      lastActivityAt: sql<number | null>`max(max(
        ${threads.createdAt},
        ${threads.updatedAt},
        coalesce(${threads.lastReadAt}, 0),
        coalesce((
          SELECT latest.created_at FROM events AS latest
          WHERE latest.thread_id = ${correlatedThreadId}
          ORDER BY latest.sequence DESC LIMIT 1
        ), 0),
        coalesce((
          SELECT max(queued.updated_at) FROM queued_thread_messages AS queued
          WHERE queued.thread_id = ${correlatedThreadId}
        ), 0),
        coalesce((
          SELECT max(interaction.updated_at) FROM pending_interactions AS interaction
          WHERE interaction.thread_id = ${correlatedThreadId}
        ), 0)
      ))`,
    })
    .from(threads)
    .get();

  return {
    lastPresenceAt: row?.lastPresenceAt ?? null,
    lastActivityAt: row?.lastActivityAt ?? null,
  };
}

export function getLapsedResumeLastOpenAt(db: DbQueryConnection): number | null {
  return (
    db
      .select({ updatedAt: appSettingsValues.updatedAt })
      .from(appSettingsValues)
      .where(eq(appSettingsValues.key, APP_OPEN_KEY))
      .get()?.updatedAt ?? null
  );
}

export function recordLapsedResumeOpen(db: DbQueryConnection, now: number): void {
  db.insert(appSettingsValues)
    .values({ key: APP_OPEN_KEY, value: "1", updatedAt: now })
    .onConflictDoUpdate({
      target: appSettingsValues.key,
      set: { updatedAt: sql`max(${appSettingsValues.updatedAt}, ${now})` },
    })
    .run();
}

function resumeCandidates(db: DbQueryConnection, now: number) {
  return db
    .select({
      threadId: threads.id,
      projectId: threads.projectId,
      title:
        sql<string>`coalesce(${threads.title}, ${threads.titleFallback}, 'Untitled thread')`.as(
          "title",
        ),
      status: threads.status,
      presenceAt: threadPresenceAt.as("presence_at"),
      waiting: sql<number>`EXISTS (
        SELECT 1 FROM pending_interactions AS interaction
        WHERE interaction.thread_id = ${threads.id}
          AND interaction.status = 'pending'
          AND (interaction.expires_at IS NULL OR interaction.expires_at > ${now})
      )`.as("waiting"),
      completedAt: sql<number | null>`(
        SELECT completed.created_at FROM events AS completed
        INNER JOIN events AS started
          ON started.thread_id = completed.thread_id
          AND started.turn_id = completed.turn_id
          AND started.type = 'turn/started'
          AND started.parent_tool_call_id IS NULL
        WHERE completed.thread_id = ${threads.id}
          AND completed.type = 'turn/completed'
          AND ${threads.status} = 'idle'
          AND started.sequence = (
            SELECT max(latest.sequence) FROM events AS latest
            WHERE latest.thread_id = ${threads.id}
              AND latest.type = 'turn/started'
              AND latest.parent_tool_call_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM events AS reply
            WHERE reply.thread_id = ${threads.id}
              AND reply.type = 'client/turn/requested'
              AND reply.sequence > completed.sequence
          )
          AND NOT EXISTS (
            SELECT 1 FROM queued_thread_messages AS queued
            WHERE queued.thread_id = ${threads.id}
              AND queued.created_at > completed.created_at
          )
        ORDER BY completed.sequence DESC LIMIT 1
      )`.as("completed_at"),
    })
    .from(threads)
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(
      and(
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        isNull(projects.deletedAt),
        eq(threads.visibility, "visible"),
      ),
    )
    .as("resume_candidates");
}

export function getLastUnfinishedThread(db: DbQueryConnection, now: number) {
  const candidates = resumeCandidates(db, now);
  return (
    db
      .select({ threadId: candidates.threadId, projectId: candidates.projectId })
      .from(candidates)
      .where(or(eq(candidates.waiting, 1), isNotNull(candidates.completedAt)))
      .orderBy(desc(candidates.presenceAt), desc(candidates.threadId))
      .limit(1)
      .get() ?? null
  );
}

export function listWhileAwayThreads(
  db: DbQueryConnection,
  args: { since: number; now: number; limit: number },
) {
  const candidates = resumeCandidates(db, args.now);
  return db
    .select({
      threadId: candidates.threadId,
      projectId: candidates.projectId,
      title: candidates.title,
      status: candidates.status,
      reason: sql<"waiting" | "finished">`CASE WHEN ${candidates.waiting} = 1 THEN 'waiting' ELSE 'finished' END`,
    })
    .from(candidates)
    .where(or(eq(candidates.waiting, 1), gt(candidates.completedAt, args.since)))
    .orderBy(
      desc(candidates.waiting),
      desc(candidates.completedAt),
      desc(candidates.presenceAt),
      desc(candidates.threadId),
    )
    .limit(args.limit)
    .all();
}
