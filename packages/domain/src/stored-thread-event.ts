import { z } from "zod";
import { convertLegacyStoredThreadEvent } from "./legacy-thread-events.js";
import {
  jsonObjectSchema,
  type JsonObject,
  type JsonValue,
} from "./json-value.js";
import { threadEventSchema, threadEventTypeSchema } from "./provider-event.js";
import {
  systemMessageKindSchema,
  systemMessageSubjectSchema,
  turnRequestEventDataSchema,
  turnRequestTargetSchema,
} from "./thread-events.js";
import {
  threadEventScopeSchema,
  type ThreadEventScope,
  getThreadEventScopeTurnId,
} from "./thread-event-scope.js";
import type { ThreadEvent, ThreadEventType } from "./provider-event.js";
import type { TurnRequestTarget } from "./thread-events.js";

type ThreadEventByType = {
  [TType in ThreadEventType]: Extract<ThreadEvent, { type: TType }>;
};

type ThreadEventForType<TType extends ThreadEventType> =
  ThreadEventByType[TType];

type StoredThreadEventDataFromEvent<TEvent extends ThreadEvent> = Omit<
  TEvent,
  "threadId" | "type" | "scope"
>;

interface ThreadEventRowBase {
  id: string;
  scope: ThreadEventScope;
  threadId: string;
  seq: number;
  createdAt: number;
}

interface ThreadEventRowInput extends ThreadEventRowBase {
  type: ThreadEventType;
  data: JsonObject;
}

interface StoredThreadEventParseArgs {
  data: object;
  providerThreadId?: string | null;
  scope: ThreadEventScope;
  threadId: string;
  type: ThreadEventType;
}

type StoredThreadEventDataByType = {
  [TType in ThreadEventType]: StoredThreadEventDataFromEvent<
    ThreadEventForType<TType>
  >;
};

export type StoredThreadEventDataForType<TType extends ThreadEventType> =
  StoredThreadEventDataByType[TType];

type ThreadEventRowFromEvent<TEvent extends ThreadEvent> =
  ThreadEventRowBase & {
    type: TEvent["type"];
    data: StoredThreadEventDataFromEvent<TEvent>;
  };

export type ThreadEventRowOfType<TType extends ThreadEventType> =
  ThreadEventRowFromEvent<ThreadEventForType<TType>>;

export type ThreadEventRow = {
  [TType in ThreadEventType]: ThreadEventRowOfType<TType>;
}[ThreadEventType];

const threadEventRowInputSchema = z.object({
  id: z.string(),
  scope: threadEventScopeSchema,
  threadId: z.string(),
  seq: z.number(),
  type: threadEventTypeSchema,
  data: jsonObjectSchema,
  createdAt: z.number(),
});

const storedTurnRequestTypeSet = new Set<ThreadEventType>([
  "client/turn/requested",
]);

const LEGACY_TURN_REQUEST_TARGET = {
  kind: "new-turn",
} satisfies TurnRequestTarget;

const storedTurnRequestEventDataSchema = turnRequestEventDataSchema.extend({
  senderThreadId: z.string().nullable().default(null),
  target: turnRequestTargetSchema.default(LEGACY_TURN_REQUEST_TARGET),
  systemMessageKind: systemMessageKindSchema.default("unlabeled"),
  systemMessageSubject: systemMessageSubjectSchema.nullable().default(null),
});

function parseStoredTurnRequestEventData(
  args: StoredThreadEventParseArgs,
): JsonObject {
  return jsonObjectSchema.parse(
    storedTurnRequestEventDataSchema.parse(args.data),
  );
}

function toStoredThreadEventData<TEvent extends ThreadEvent>(
  event: TEvent,
): StoredThreadEventDataFromEvent<TEvent> {
  const { scope: _scope, threadId: _threadId, type: _type, ...data } = event;
  return data;
}

function omitStoredScopeFields(data: JsonObject): JsonObject {
  const { scope: _scope, turnId: _turnId, ...rest } = data;
  return rest;
}

export function parseStoredThreadEvent(
  args: StoredThreadEventParseArgs,
): ThreadEvent {
  const scopeResult = threadEventScopeSchema.safeParse(args.scope);
  if (!scopeResult.success) {
    throw new Error("Stored thread event is missing valid scope");
  }
  const scope = scopeResult.data;
  const stored = convertLegacyStoredThreadEvent(
    { type: args.type, data: args.data },
    { turnId: getThreadEventScopeTurnId(scope) ?? null },
  );
  const eventData = storedTurnRequestTypeSet.has(stored.type)
    ? parseStoredTurnRequestEventData({ ...args, data: stored.data })
    : stored.data;

  const event = {
    ...omitStoredScopeFields(eventData),
    scope,
    threadId: args.threadId,
    type: stored.type,
  };
  if (args.providerThreadId != null) {
    return threadEventSchema.parse({
      ...event,
      providerThreadId: args.providerThreadId,
    });
  }
  return threadEventSchema.parse(event);
}

export function buildThreadEventRow(
  args: ThreadEventRowBase & { event: ThreadEvent },
): ThreadEventRow;
export function buildThreadEventRow<TEvent extends ThreadEvent>(
  args: ThreadEventRowBase & { event: TEvent },
): ThreadEventRowFromEvent<TEvent>;
export function buildThreadEventRow<TEvent extends ThreadEvent>(
  args: ThreadEventRowBase & { event: TEvent },
): ThreadEventRowFromEvent<TEvent> {
  const { event, ...row } = args;
  return {
    ...row,
    type: event.type,
    data: toStoredThreadEventData(event),
  };
}

export function buildThreadEvent(row: ThreadEventRow): ThreadEvent {
  return parseStoredThreadEvent({
    data: row.data,
    providerThreadId:
      "providerThreadId" in row.data ? row.data.providerThreadId : undefined,
    scope: row.scope,
    threadId: row.threadId,
    type: row.type,
  });
}

function parseThreadEventRowInput(row: ThreadEventRowInput): ThreadEventRow {
  return buildThreadEventRow({
    id: row.id,
    scope: row.scope,
    threadId: row.threadId,
    seq: row.seq,
    createdAt: row.createdAt,
    event: parseStoredThreadEvent({
      type: row.type,
      data: row.data,
      threadId: row.threadId,
      scope: row.scope,
    }),
  });
}

export function parseThreadEventRow(value: JsonValue): ThreadEventRow {
  const row = threadEventRowInputSchema.parse(value);
  return parseThreadEventRowInput(row);
}

export const threadEventRowSchema =
  threadEventRowInputSchema.transform<ThreadEventRow>((row) =>
    parseThreadEventRowInput(row),
  );
