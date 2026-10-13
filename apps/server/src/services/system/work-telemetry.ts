import { captureFeatureUsed } from "./feature-telemetry.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  afterCommit,
  events,
  pendingInteractions,
  getThread,
  telemetryThreads,
  telemetryMessages,
  telemetryOrigins,
  type DbQueryConnection,
} from "@bb/db";
import type {
  PendingInteraction,
  Thread,
  TurnRequestEventData,
} from "@bb/domain";
import { z } from "zod";
import { turnRequestEventDataSchema } from "@bb/domain";
import type { TelemetryTrigger } from "@bb/server-contract";
import type { TelemetryEvent, TelemetryService } from "./telemetry.js";

export interface AnalyticsThreadProperties {
  thread_analytics_id: string;
  parent_analytics_id?: string;
  parent_link: "root" | "child" | "unknown";
}

export type MessageSource = "thread_create" | "thread_send" | "queued_message";
export type WorkOriginProperties = {
  request_link: "single" | "grouped" | "none" | "unavailable";
  request_analytics_id?: string;
  request_analytics_ids?: string[];
  attempt_kind: "initial" | "retry" | "unknown";
  trigger: TelemetryTrigger;
  message_source?: MessageSource;
};

type WorkDeps = { db: DbQueryConnection; telemetry: TelemetryService };
let workDeps: WorkDeps | undefined;

export function setWorkTelemetryDeps(deps: WorkDeps | undefined): void {
  workDeps = deps;
}

interface MessageOrigin {
  threadId: string;
  ids: string[];
  source: MessageSource;
  trigger: TelemetryTrigger;
  captureMessage: boolean;
  fresh: boolean;
}

const originStorage = new AsyncLocalStorage<MessageOrigin>();
const tokenListSchema = z
  .array(z.string().regex(/^[0-9a-f]{32}$/))
  .min(1)
  .max(100);

function enabled(): boolean {
  return workDeps?.telemetry.isEnabled() === true;
}

function token(db: DbQueryConnection, threadId: string): string {
  const existing = db
    .select()
    .from(telemetryThreads)
    .where(eq(telemetryThreads.threadId, threadId))
    .get();
  if (existing) return existing.analyticsId;
  const id = randomBytes(16).toString("hex");
  db.insert(telemetryThreads)
    .values({ threadId, analyticsId: id })
    .onConflictDoNothing({ target: telemetryThreads.threadId })
    .run();
  return db
    .select()
    .from(telemetryThreads)
    .where(eq(telemetryThreads.threadId, threadId))
    .get()!.analyticsId;
}

export function analyticsThreadProperties(
  db: DbQueryConnection,
  thread: Pick<Thread, "id" | "parentThreadId">,
): AnalyticsThreadProperties {
  const id = token(db, thread.id);
  if (thread.parentThreadId === null)
    return { thread_analytics_id: id, parent_link: "root" };
  const parent = getThread(db, thread.parentThreadId);
  return parent && parent.deletedAt === null
    ? {
        thread_analytics_id: id,
        parent_analytics_id: token(db, parent.id),
        parent_link: "child",
      }
    : { thread_analytics_id: id, parent_link: "unknown" };
}

export function captureWorkEvent(
  db: DbQueryConnection,
  event: TelemetryEvent,
  occurredAt: number,
): void {
  const deps = workDeps;
  if (!deps?.telemetry.isEnabled()) return;
  afterCommit(db, () => {
    try {
      deps.telemetry.capture(event, occurredAt);
    } catch {}
  });
}

function originIds(
  db: DbQueryConnection,
  threadId: string,
  kind: "queue" | "request",
  key: string,
): string[] {
  const row = db
    .select()
    .from(telemetryOrigins)
    .where(
      and(
        eq(telemetryOrigins.threadId, threadId),
        eq(telemetryOrigins.kind, kind),
        eq(telemetryOrigins.key, key),
      ),
    )
    .get();
  return tokenListSchema.safeParse(row?.messageIds).data ?? [];
}

export function withMessageOrigin<T>(
  args: {
    threadId: string;
    source: MessageSource;
    trigger: TelemetryTrigger;
    captureMessage: boolean;
    queuedIds?: readonly string[];
    retryRequestId?: string;
    reuse?: boolean;
  },
  run: () => T,
): T {
  if (args.reuse && originStorage.getStore()?.threadId === args.threadId)
    return run();
  const deps = workDeps;
  if (!deps || !enabled()) return run();
  let ids: string[] = [];
  const fresh =
    args.queuedIds === undefined && args.retryRequestId === undefined;
  try {
    if (
      args.retryRequestId !== undefined &&
      (args.queuedIds?.length ?? 1) === 1
    )
      ids = originIds(deps.db, args.threadId, "request", args.retryRequestId);
    else if (args.queuedIds !== undefined) {
      const groups = args.queuedIds.map((id) =>
        originIds(deps.db, args.threadId, "queue", id),
      );
      if (groups.every((group) => group.length > 0))
        ids = [...new Set(groups.flat())];
    } else ids = [randomBytes(16).toString("hex")];
  } catch {}
  return originStorage.run(
    {
      threadId: args.threadId,
      ids,
      source: args.source,
      trigger: args.trigger,
      captureMessage: args.captureMessage,
      fresh,
    },
    run,
  );
}

function bindOrigin(
  db: DbQueryConnection,
  threadId: string,
  kind: "queue" | "request",
  key: string,
  fallback?: MessageOrigin,
): void {
  if (!enabled()) return;
  const origin = originStorage.getStore() ?? fallback;
  if (
    !origin ||
    origin.threadId !== threadId ||
    !tokenListSchema.safeParse(origin.ids).success
  )
    return;
  const thread = getThread(db, threadId);
  if (!thread) return;
  const identity = analyticsThreadProperties(db, thread);
  if (origin.fresh) {
    const id = origin.ids[0]!;
    const acceptedAt = Date.now();
    const inserted = db
      .insert(telemetryMessages)
      .values({
        analyticsId: id,
        threadId,
        acceptedAt,
        trigger: origin.trigger,
        messageSource: origin.source,
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (inserted && origin.captureMessage)
      captureWorkEvent(
        db,
        {
          name: "user_message_sent",
          properties: {
            ...identity,
            request_analytics_id: id,
            is_child_thread: thread.parentThreadId !== null,
            message_source: origin.source,
            provider: thread.providerId,
          },
        },
        acceptedAt,
      );
  }
  const stored = db
    .select({ id: telemetryMessages.analyticsId })
    .from(telemetryMessages)
    .where(
      and(
        eq(telemetryMessages.threadId, threadId),
        inArray(telemetryMessages.analyticsId, origin.ids),
      ),
    )
    .all();
  if (stored.length !== origin.ids.length) return;
  db.insert(telemetryOrigins)
    .values({ threadId, kind, key, messageIds: origin.ids })
    .onConflictDoNothing()
    .run();
}

export function recordMessageRequest(
  db: DbQueryConnection,
  threadId: string,
  request: TurnRequestEventData,
): void {
  try {
    if (!enabled()) return;
    const fallback: MessageOrigin = {
      threadId,
      ids: request.retryOfRequestId
        ? originIds(db, threadId, "request", request.retryOfRequestId)
        : [],
      source: request.source === "spawn" ? "thread_create" : "thread_send",
      trigger:
        request.initiator === "agent"
          ? "agent"
          : request.initiator === "system"
            ? "system"
            : "unknown",
      captureMessage: false,
      fresh: false,
    };
    if (request.input.length > 0)
      bindOrigin(db, threadId, "request", request.requestId, fallback);
    if (
      request.target.kind === "thread-start" ||
      request.target.kind === "new-turn" ||
      (request.target.kind === "auto" && request.target.expectedTurnId === null)
    ) {
      token(db, threadId);
      db.update(telemetryThreads)
        .set({ pendingRequestId: request.requestId })
        .where(eq(telemetryThreads.threadId, threadId))
        .run();
    }
  } catch {}
}

export function recordQueuedMessageOrigin(
  db: DbQueryConnection,
  threadId: string,
  queueId: string,
): void {
  try {
    bindOrigin(db, threadId, "queue", queueId);
  } catch {}
}

export function workOriginProperties(
  db: DbQueryConnection,
  threadId: string,
  requestId: string | null,
): WorkOriginProperties {
  if (requestId === null)
    return {
      request_link: "unavailable",
      attempt_kind: "unknown",
      trigger: "unknown",
    };
  const row = db
    .select({ data: events.data })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "client/turn/requested"),
        sql`json_extract(${events.data}, '$.requestId') = ${requestId}`,
      ),
    )
    .get();
  const request = row
    ? turnRequestEventDataSchema.safeParse(JSON.parse(row.data)).data
    : undefined;
  const attempt =
    request === undefined
      ? "unknown"
      : request.retryOfRequestId === undefined
        ? "initial"
        : "retry";
  if (request?.input.length === 0)
    return { request_link: "none", attempt_kind: attempt, trigger: "unknown" };
  const ids = originIds(db, threadId, "request", requestId);
  const messages =
    ids.length === 0
      ? []
      : db
          .select()
          .from(telemetryMessages)
          .where(
            and(
              eq(telemetryMessages.threadId, threadId),
              inArray(telemetryMessages.analyticsId, ids),
            ),
          )
          .all();
  const first = messages[0];
  const consistent = first !== undefined && messages.length === ids.length;
  const trigger =
    consistent && messages.every((message) => message.trigger === first.trigger)
      ? first.trigger
      : "unknown";
  const source =
    consistent &&
    messages.every((message) => message.messageSource === first.messageSource)
      ? first.messageSource
      : undefined;
  return {
    request_link: !consistent
      ? "unavailable"
      : ids.length === 1
        ? "single"
        : "grouped",
    ...(consistent
      ? ids.length === 1
        ? { request_analytics_id: ids[0]! }
        : { request_analytics_ids: ids }
      : {}),
    attempt_kind: attempt,
    trigger,
    ...(source === undefined ? {} : { message_source: source }),
  };
}

export function captureThreadCreated(thread: Thread): void {
  const deps = workDeps;
  if (!deps || !enabled()) return;
  try {
    if (thread.parentThreadId !== null)
      afterCommit(deps.db, () =>
        captureFeatureUsed(deps.telemetry, {
          feature: "child_thread",
          feature_scope: "core",
          interaction: "invoked",
          trigger: "unknown",
        }),
      );
    captureWorkEvent(
      deps.db,
      {
        name: "thread_created",
        properties: {
          ...analyticsThreadProperties(deps.db, thread),
          is_child_thread: thread.parentThreadId !== null,
          provider: thread.providerId,
        },
      },
      thread.createdAt,
    );
  } catch {}
}

type ThreadTransition =
  | "thread_stopped"
  | "thread_archived"
  | "thread_unarchived"
  | "thread_deleted"
  | "parent_changed";
export function captureThreadTransition(
  thread: Thread,
  transition: ThreadTransition,
): void {
  const deps = workDeps;
  if (!deps || !enabled()) return;
  try {
    const properties = {
      ...analyticsThreadProperties(deps.db, thread),
      transition,
    };
    captureWorkEvent(
      deps.db,
      { name: "thread_lifecycle", properties },
      thread.updatedAt,
    );
    if (transition === "thread_deleted") {
      deps.db
        .delete(telemetryThreads)
        .where(eq(telemetryThreads.threadId, thread.id))
        .run();
      deps.db
        .delete(telemetryOrigins)
        .where(eq(telemetryOrigins.threadId, thread.id))
        .run();
      deps.db
        .delete(telemetryMessages)
        .where(eq(telemetryMessages.threadId, thread.id))
        .run();
    }
  } catch {}
}

export function captureInteractionWait(
  db: DbQueryConnection,
  interaction: PendingInteraction,
  entering: boolean,
): void {
  if (!enabled() || interaction.turnId === null) return;
  if (
    !entering &&
    interaction.status !== "resolved" &&
    interaction.status !== "interrupted"
  )
    return;
  try {
    const active = db
      .select({ id: pendingInteractions.id })
      .from(pendingInteractions)
      .where(
        and(
          eq(pendingInteractions.threadId, interaction.threadId),
          isNotNull(pendingInteractions.turnId),
          inArray(pendingInteractions.status, ["pending", "resolving"]),
        ),
      )
      .all();
    const waiting = active.length > 0;
    token(db, interaction.threadId);
    const previous = db
      .select()
      .from(telemetryThreads)
      .where(eq(telemetryThreads.threadId, interaction.threadId))
      .get();
    if (previous?.waiting === waiting) return;
    db.update(telemetryThreads)
      .set({ waiting })
      .where(eq(telemetryThreads.threadId, interaction.threadId))
      .run();
    const thread = getThread(db, interaction.threadId);
    if (!thread) return;
    captureWorkEvent(
      db,
      {
        name: "thread_lifecycle",
        properties: {
          ...analyticsThreadProperties(db, thread),
          transition: waiting ? "waiting_on_user" : "waiting_cleared",
          wait_kind:
            interaction.payload.kind === "user_question"
              ? "question"
              : interaction.payload.kind === "approval"
                ? "approval"
                : "other",
        },
      },
      Date.now(),
    );
  } catch {}
}

export function clearActiveWorkTelemetry(db: DbQueryConnection): void {
  try {
    db.update(telemetryThreads)
      .set({ activeRequestId: null, pendingRequestId: null, waiting: false })
      .run();
  } catch {}
}
