import { z } from "zod";
import { resolvedThreadExecutionOptionsSchema } from "./shared-types.js";
import {
  providerEventSchema,
  providerEventTypeValues,
  systemEventSchema,
  threadEventTypeSchema,
} from "./provider-event.js";
import {
  systemEventTypeValues,
  turnRequestEventDataSchema,
  turnRequestTargetSchema,
} from "./thread-events.js";
import {
  threadEventScopeSchema,
  validateThreadEventScope,
  type ThreadEventScope,
} from "./thread-event-scope.js";
import { findLegacyClientRequestSequenceIssues } from "./thread-event-legacy.js";
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
  data: Record<string, unknown>;
}

export interface StoredThreadEventParseArgs {
  data: Record<string, unknown>;
  providerThreadId?: string | null;
  scope: ThreadEventScope;
  threadId: string;
  type: ThreadEventType;
}

export type StoredThreadEventDataByType = {
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
  data: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
});

const storedTurnRequestTypeSet = new Set<ThreadEventType>([
  "client/turn/requested",
]);
const providerThreadEventTypeSet: ReadonlySet<string> = new Set(
  providerEventTypeValues,
);
const systemThreadEventTypeSet: ReadonlySet<string> = new Set(
  systemEventTypeValues,
);

const LEGACY_TURN_REQUEST_TARGET = {
  kind: "new-turn",
} satisfies TurnRequestTarget;

// Read path: `senderThreadId` is a new field, so every pre-change persisted
// `client/turn/requested` row lacks it — defaulting to null here lets old
// rows load without a backfill migration. `initiator` was already always
// written by every call site (the prior `.optional()` was schema slack),
// so it does not need a default.
const storedTurnRequestEventDataSchema = turnRequestEventDataSchema.extend({
  senderThreadId: z.string().nullable().default(null),
  target: turnRequestTargetSchema.default(LEGACY_TURN_REQUEST_TARGET),
  execution: resolvedThreadExecutionOptionsSchema,
});

function parseStoredTurnRequestEventData(
  args: StoredThreadEventParseArgs,
): StoredThreadEventParseArgs["data"] {
  return storedTurnRequestEventDataSchema.parse(args.data);
}

function toStoredThreadEventData<TEvent extends ThreadEvent>(
  event: TEvent,
): StoredThreadEventDataFromEvent<TEvent> {
  const { scope: _scope, threadId: _threadId, type: _type, ...data } = event;
  return data;
}

function omitStoredScopeFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const { scope: _scope, turnId: _turnId, ...rest } = data;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNoLegacyClientRequestSequence(
  data: Record<string, unknown>,
): void {
  const [issue] = findLegacyClientRequestSequenceIssues(data);
  if (issue) {
    throw new Error(issue.message);
  }
}

function validateStoredThreadEventScope(event: ThreadEvent): void {
  const result = validateThreadEventScope({
    type: event.type,
    scope: event.scope,
  });
  if (!result.valid) {
    throw new Error(result.message ?? "Invalid thread event scope");
  }
}

function parseKnownStoredThreadEventType(value: unknown): ThreadEvent {
  const eventType = threadEventTypeSchema.parse(
    isRecord(value) ? value.type : undefined,
  );
  const event = providerThreadEventTypeSet.has(eventType)
    ? providerEventSchema.parse(value)
    : systemThreadEventTypeSet.has(eventType)
      ? systemEventSchema.parse(value)
      : null;
  if (event === null) {
    throw new Error(`Unknown thread event type: ${eventType}`);
  }
  validateStoredThreadEventScope(event);
  return event;
}

export function parseStoredThreadEvent(
  args: StoredThreadEventParseArgs,
): ThreadEvent {
  const scopeResult = threadEventScopeSchema.safeParse(args.scope);
  if (!scopeResult.success) {
    throw new Error("Stored thread event is missing valid scope");
  }
  const scope = scopeResult.data;
  const eventData = storedTurnRequestTypeSet.has(args.type)
    ? parseStoredTurnRequestEventData(args)
    : args.data;

  assertNoLegacyClientRequestSequence(eventData);
  return parseKnownStoredThreadEventType({
    ...omitStoredScopeFields(eventData),
    ...(args.providerThreadId != null
      ? { providerThreadId: args.providerThreadId }
      : {}),
    scope,
    threadId: args.threadId,
    type: args.type,
  });
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

export function parseThreadEventRow(value: unknown): ThreadEventRow {
  const row = threadEventRowInputSchema.parse(value);
  return parseThreadEventRowInput(row);
}

export const threadEventRowSchema =
  threadEventRowInputSchema.transform<ThreadEventRow>((row) =>
    parseThreadEventRowInput(row),
  );
