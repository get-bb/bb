import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import {
  appendDaemonEventsInTransaction,
  deriveStoredEventItemFields,
  getThread,
  listCompletedTurnsByThreadIds,
  listThreadEnvironmentAssignmentsOnHost,
  MissingStoredTurnStartedError,
  events as storedEvents,
  updateThread,
} from "@bb/db";
import type {
  AcceptedDaemonEvent,
  AppendDaemonEventInput,
  AppendDaemonEventsResult,
} from "@bb/db";
import {
  hostDaemonEventBatchRequestSchema,
  typedRoutes,
  type HostDaemonEventBatchResponse,
  type HostDaemonEventEnvelope,
  type HostDaemonInternalSchema,
  type HostDaemonRejectedEvent,
} from "@bb/host-daemon-contract";
import {
  requireThreadEventScopeTurnId,
  type ThreadEventType,
  type ThreadEventTurnStatus,
} from "@bb/domain";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../types.js";
import {
  isActivePruneTriggerThreadEventType,
  maybePruneActiveThreadEventHistory,
} from "../services/system/event-pruning.js";
import { queueChildThreadTurnNotificationBestEffort } from "../services/threads/child-thread-notifications.js";
import { runQueuedMessageAutoSendForThread } from "../services/threads/queued-messages.js";
import { deferAfterResponse } from "../services/lib/response-deferral.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../services/lib/error-log-fields.js";
import { applyLoggedThreadLifecycleEvent } from "../services/threads/lifecycle-outcome.js";
import { applyTurnCompletedEvent } from "./turn-completed-events.js";
import {
  getInactiveSessionLogFields,
  requireAuthenticatedDaemonSession,
} from "./session-state.js";
import { getAuthenticatedDaemon } from "./auth.js";

interface ToStoredEventArgs {
  envelope: HostDaemonEventEnvelope;
  environmentId: string | null;
}

interface ResolvePostableEventBatchEntriesArgs {
  hostId: string;
  events: HostDaemonEventEnvelope[];
}

interface PostableEventBatchEntry {
  envelope: HostDaemonEventEnvelope;
  environmentId: string | null;
  eventIndex: number;
}

interface ResolvePostableEventBatchEntriesResult {
  entries: PostableEventBatchEntry[];
  rejectedEvents: HostDaemonEventBatchResponse["rejectedEvents"];
}

interface RejectedDaemonEventSummary {
  count: number;
  threadIds: string[];
}

interface ResolveEventsToApplyArgs {
  db: AppDeps["db"];
  events: HostDaemonEventEnvelope[];
  insertedEventIndexes: number[];
}

interface NotifyInsertedEventThreadsDeps {
  hub: AppDeps["hub"];
}

interface NotifyInsertedEventThreadsArgs {
  eventInputs: AppendDaemonEventInput[];
  insertedInputIndexes: number[];
}

interface ShouldApplyEventEffectArgs {
  completedTurnKeyLookup: Set<string>;
  entry: HostDaemonEventEnvelope;
  index: number;
  insertedEventIndexLookup: Set<number>;
}

interface ListCompletedTurnKeysForStartedEventsArgs {
  batchEvents: HostDaemonEventEnvelope[];
  db: AppDeps["db"];
  insertedEventIndexLookup: ReadonlySet<number>;
}

interface TurnKeyArgs {
  threadId: string;
  turnId: string;
}

interface HasThreadCommandFailureSystemErrorForTurnDeps {
  db: AppDeps["db"];
}

interface HasThreadCommandFailureSystemErrorForTurnArgs {
  threadId: string;
  turnId: string;
}

interface HasThreadStopBeforeTurnStartedArgs {
  threadId: string;
  turnId: string;
}

interface ActivePruneCandidate {
  latestPrunableSequence: number;
  threadId: string;
}

interface ResolveActivePruneCandidatesArgs {
  acceptedEvents: AcceptedDaemonEvent[];
  events: HostDaemonEventEnvelope[];
  insertedEventIndexes: number[];
}

interface ParentTurnNotificationFollowUp {
  kind: "parent-turn-notification";
  childThreadId: string;
  projectId: string;
  parentThreadId: string;
  title: string | null;
  turnStatus: ThreadEventTurnStatus;
}

interface QueuedMessageAutoSendFollowUp {
  kind: "queued-message-auto-send";
  threadId: string;
}

type EventEffectFollowUp =
  | ParentTurnNotificationFollowUp
  | QueuedMessageAutoSendFollowUp;

function resolveProviderIdentifiers(event: HostDaemonEventEnvelope["event"]): {
  providerThreadId: string | null;
} {
  switch (event.type) {
    case "thread/started":
    case "client/thread/start":
    case "client/turn/requested":
    case "client/turn/start":
    case "system/error":
    case "system/manager/user_message":
    case "system/thread/interrupted":
    case "system/operation":
    case "system/permissionGrant/lifecycle":
    case "system/userQuestion/lifecycle":
    case "system/thread-provisioning":
    case "system/provider-turn-watchdog":
      return { providerThreadId: null };
    case "thread/identity":
    case "thread/name/updated":
    case "provider/warning":
      return { providerThreadId: event.providerThreadId };
    case "thread/compacted":
      return { providerThreadId: event.providerThreadId };
    case "thread/goal/updated":
    case "thread/goal/cleared":
      return { providerThreadId: event.providerThreadId };
    case "turn/started":
    case "turn/completed":
    case "turn/input/accepted":
    case "item/started":
    case "item/completed":
    case "item/backgroundTask/progress":
    case "item/backgroundTask/completed":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
    case "thread/contextWindowUsage/updated":
    case "thread/tokenUsage/updated":
    case "turn/plan/updated":
    case "turn/diff/updated":
      return { providerThreadId: event.providerThreadId };
    case "provider/error":
    case "provider/unhandled":
      return { providerThreadId: event.providerThreadId };
    default: {
      const exhaustive: never = event;
      throw new Error(
        `Unsupported event type: ${String((exhaustive as { type?: string }).type)}`,
      );
    }
  }
}

function toStoredEvent(args: ToStoredEventArgs): AppendDaemonEventInput {
  const envelope = args.envelope;
  const { scope, type, threadId, ...data } = envelope.event;
  return {
    threadId: envelope.threadId,
    environmentId: args.environmentId,
    ...resolveProviderIdentifiers(envelope.event),
    scope,
    type,
    ...deriveStoredEventItemFields(envelope.event),
    data: JSON.stringify(data),
  };
}

function notifyInsertedEventThreads(
  deps: NotifyInsertedEventThreadsDeps,
  args: NotifyInsertedEventThreadsArgs,
): void {
  const eventTypesByThreadId = new Map<string, Set<ThreadEventType>>();
  for (const index of args.insertedInputIndexes) {
    const eventInput = args.eventInputs[index];
    if (eventInput) {
      const eventTypes =
        eventTypesByThreadId.get(eventInput.threadId) ??
        new Set<ThreadEventType>();
      eventTypes.add(eventInput.type);
      eventTypesByThreadId.set(eventInput.threadId, eventTypes);
    }
  }
  for (const [threadId, eventTypes] of eventTypesByThreadId) {
    deps.hub.notifyThread(threadId, ["events-appended"], {
      eventTypes: Array.from(eventTypes),
    });
  }
}

async function applyEventEffects(
  deps: LoggedPendingInteractionWorkSessionDeps,
  events: HostDaemonEventEnvelope[],
): Promise<EventEffectFollowUp[]> {
  // Apply event-owned state changes before returning so the accepted batch and
  // immediately visible thread state agree. Follow-ups that may queue daemon
  // work stay deferred to avoid command waits inside daemon ingress.
  const followUps: EventEffectFollowUp[] = [];
  for (const entry of events) {
    try {
      const event = entry.event;
      if (event.type === "turn/started") {
        const turnId = requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        });
        // Event-log staleness stays caller-side: a stop recorded before this
        // turn started means the activation is stale.
        if (
          hasThreadStopBeforeTurnStarted(deps, {
            threadId: entry.threadId,
            turnId,
          })
        ) {
          continue;
        }
        applyLoggedThreadLifecycleEvent(deps, {
          event: { type: "run.started" },
          threadId: entry.threadId,
        });
        continue;
      }

      if (event.type === "turn/completed") {
        const turnId = requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        });
        if (
          event.status !== "interrupted" &&
          hasThreadStopBeforeTurnStarted(deps, {
            threadId: entry.threadId,
            turnId,
          })
        ) {
          continue;
        }
        const turnCompleted = applyTurnCompletedEvent(deps, {
          ...event,
          threadId: entry.threadId,
        });
        if (turnCompleted.thread?.parentThreadId) {
          // Command-result failures already notify parent threads for failed turns
          // without terminal events; late terminal events still own status effects.
          const alreadyHandledByCommandFailure =
            event.status === "failed" &&
            hasThreadCommandFailureSystemErrorForTurn(deps, {
              threadId: turnCompleted.thread.id,
              turnId,
            });
          if (!alreadyHandledByCommandFailure) {
            followUps.push({
              kind: "parent-turn-notification",
              childThreadId: turnCompleted.thread.id,
              projectId: turnCompleted.thread.projectId,
              parentThreadId: turnCompleted.thread.parentThreadId,
              title: turnCompleted.thread.title,
              turnStatus: event.status,
            });
          }
        }
        if (event.status === "completed") {
          followUps.push({
            kind: "queued-message-auto-send",
            threadId: entry.threadId,
          });
        }
        continue;
      }

      if (
        event.type === "system/error" &&
        event.code === "provider_process_exited"
      ) {
        const thread = getThread(deps.db, entry.threadId);
        if (!thread) {
          continue;
        }
        deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
          threadIds: [entry.threadId],
          reason:
            "Provider process exited while awaiting user interaction; retry the thread to continue",
        });
        applyLoggedThreadLifecycleEvent(deps, {
          event: { type: "run.failed" },
          threadId: entry.threadId,
        });
        continue;
      }

      if (event.type === "thread/name/updated") {
        updateThread(deps.db, deps.hub, entry.threadId, {
          title: event.threadName,
        });
      }
    } catch (error) {
      deps.logger.error(
        {
          err: error,
          eventType: entry.event.type,
          threadId: entry.threadId,
        },
        "Failed to apply event side effects",
      );
    }
  }
  return followUps;
}

async function executeEventFollowUpBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  followUp: EventEffectFollowUp,
): Promise<void> {
  try {
    switch (followUp.kind) {
      case "parent-turn-notification":
        await queueChildThreadTurnNotificationBestEffort(deps, {
          childThread: {
            id: followUp.childThreadId,
            projectId: followUp.projectId,
            title: followUp.title,
          },
          parentThreadId: followUp.parentThreadId,
          turnStatus: followUp.turnStatus,
        });
        return;
      case "queued-message-auto-send":
        await runQueuedMessageAutoSendForThread(deps, {
          threadId: followUp.threadId,
        });
        return;
    }
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      deps.logger.warn(
        {
          followUp,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Event follow-up deferred by host timeout",
      );
      return;
    }
    deps.logger.error(
      {
        err: error,
        followUp,
      },
      "Failed to run event follow-up",
    );
  }
}

function deferEventFollowUpBatch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  followUps: EventEffectFollowUp[],
): void {
  if (followUps.length === 0) {
    return;
  }

  deferAfterResponse({
    config: deps.config,
    logger: deps.logger,
    name: "Event follow-up scheduling",
    work: async () => {
      await Promise.all(
        followUps.map((followUp) =>
          executeEventFollowUpBestEffort(deps, followUp),
        ),
      );
    },
  });
}

function toTurnKey(args: TurnKeyArgs): string {
  return `${args.threadId}:${args.turnId}`;
}

function hasThreadCommandFailureSystemErrorForTurn(
  deps: HasThreadCommandFailureSystemErrorForTurnDeps,
  args: HasThreadCommandFailureSystemErrorForTurnArgs,
): boolean {
  return (
    deps.db
      .select({ id: storedEvents.id })
      .from(storedEvents)
      .where(
        and(
          eq(storedEvents.threadId, args.threadId),
          eq(storedEvents.turnId, args.turnId),
          eq(storedEvents.scopeKind, "turn"),
          eq(storedEvents.type, "system/error"),
          sql`json_extract(${storedEvents.data}, '$.code') = 'thread_command_failed'`,
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function hasThreadStopBeforeTurnStarted(
  deps: Pick<AppDeps, "db">,
  args: HasThreadStopBeforeTurnStartedArgs,
): boolean {
  const turnStarted = deps.db
    .select({ sequence: storedEvents.sequence })
    .from(storedEvents)
    .where(
      and(
        eq(storedEvents.threadId, args.threadId),
        eq(storedEvents.turnId, args.turnId),
        eq(storedEvents.type, "turn/started"),
      ),
    )
    .limit(1)
    .get();
  if (!turnStarted) {
    return false;
  }

  const latestTurnRequest = deps.db
    .select({ sequence: storedEvents.sequence })
    .from(storedEvents)
    .where(
      and(
        eq(storedEvents.threadId, args.threadId),
        eq(storedEvents.type, "client/turn/requested"),
        lt(storedEvents.sequence, turnStarted.sequence),
      ),
    )
    .orderBy(desc(storedEvents.sequence))
    .limit(1)
    .get();
  const lowerSequence = latestTurnRequest?.sequence ?? 0;

  return (
    deps.db
      .select({ id: storedEvents.id })
      .from(storedEvents)
      .where(
        and(
          eq(storedEvents.threadId, args.threadId),
          eq(storedEvents.type, "system/thread/interrupted"),
          gt(storedEvents.sequence, lowerSequence),
          lt(storedEvents.sequence, turnStarted.sequence),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function listCompletedTurnKeysForStartedEvents(
  args: ListCompletedTurnKeysForStartedEventsArgs,
): Set<string> {
  const startedTurnKeys = new Set<string>();
  const threadIds = new Set<string>();

  for (const entry of args.batchEvents) {
    if (entry.event.type !== "turn/started") {
      continue;
    }
    startedTurnKeys.add(
      toTurnKey({
        threadId: entry.threadId,
        turnId: requireThreadEventScopeTurnId({
          type: entry.event.type,
          scope: entry.event.scope,
        }),
      }),
    );
    threadIds.add(entry.threadId);
  }

  if (startedTurnKeys.size === 0 || threadIds.size === 0) {
    return new Set<string>();
  }

  const completedTurnKeys = new Set<string>();
  for (const row of listCompletedTurnsByThreadIds(args.db, [...threadIds])) {
    const turnKey = toTurnKey({
      threadId: row.threadId,
      turnId: row.turnId,
    });
    if (startedTurnKeys.has(turnKey)) {
      completedTurnKeys.add(turnKey);
    }
  }

  for (const [index, entry] of args.batchEvents.entries()) {
    if (
      !args.insertedEventIndexLookup.has(index) ||
      entry.event.type !== "turn/completed"
    ) {
      continue;
    }
    completedTurnKeys.delete(
      toTurnKey({
        threadId: entry.threadId,
        turnId: requireThreadEventScopeTurnId({
          type: entry.event.type,
          scope: entry.event.scope,
        }),
      }),
    );
  }
  return completedTurnKeys;
}

function shouldApplyEventEffect(args: ShouldApplyEventEffectArgs): boolean {
  const { entry } = args;

  if (entry.event.type === "turn/completed") {
    return args.insertedEventIndexLookup.has(args.index);
  }

  if (entry.event.type === "turn/started") {
    return !args.completedTurnKeyLookup.has(
      toTurnKey({
        threadId: entry.threadId,
        turnId: requireThreadEventScopeTurnId({
          type: entry.event.type,
          scope: entry.event.scope,
        }),
      }),
    );
  }

  // Keep other projections replayable so a daemon retry can repair them if the
  // event insert committed before the projection side effect ran.
  return true;
}

function resolveEventsToApply(
  args: ResolveEventsToApplyArgs,
): HostDaemonEventEnvelope[] {
  const insertedEventIndexLookup = new Set(args.insertedEventIndexes);
  const completedTurnKeyLookup = listCompletedTurnKeysForStartedEvents({
    batchEvents: args.events,
    db: args.db,
    insertedEventIndexLookup,
  });

  return args.events.filter((entry, index) =>
    shouldApplyEventEffect({
      completedTurnKeyLookup,
      entry,
      index,
      insertedEventIndexLookup,
    }),
  );
}

function resolveActivePruneCandidates(
  args: ResolveActivePruneCandidatesArgs,
): ActivePruneCandidate[] {
  const latestPrunableSequenceByThreadId = new Map<string, number>();
  const insertedEventIndexLookup = new Set(args.insertedEventIndexes);

  for (const [index, entry] of args.events.entries()) {
    if (!insertedEventIndexLookup.has(index)) {
      continue;
    }
    if (!isActivePruneTriggerThreadEventType(entry.event.type)) {
      continue;
    }
    const acceptedEvent = args.acceptedEvents[index];
    if (acceptedEvent === undefined) {
      throw new Error("Missing accepted event for inserted daemon event");
    }

    const previousSequence = latestPrunableSequenceByThreadId.get(
      entry.threadId,
    );
    if (
      previousSequence === undefined ||
      acceptedEvent.sequence > previousSequence
    ) {
      latestPrunableSequenceByThreadId.set(
        entry.threadId,
        acceptedEvent.sequence,
      );
    }
  }

  return [...latestPrunableSequenceByThreadId.entries()].map(
    ([threadId, latestPrunableSequence]) => ({
      threadId,
      latestPrunableSequence,
    }),
  );
}

function summarizeRejectedDaemonEvents(
  rejectedEvents: readonly HostDaemonRejectedEvent[],
): RejectedDaemonEventSummary {
  return {
    count: rejectedEvents.length,
    threadIds: [...new Set(rejectedEvents.map((event) => event.threadId))],
  };
}

function resolvePostableEventBatchEntries(
  deps: Pick<AppDeps, "db">,
  args: ResolvePostableEventBatchEntriesArgs,
): ResolvePostableEventBatchEntriesResult {
  const threadIds = [...new Set(args.events.map((entry) => entry.threadId))];
  if (threadIds.length === 0) {
    return {
      entries: [],
      rejectedEvents: [],
    };
  }

  const ownedThreads = listThreadEnvironmentAssignmentsOnHost(deps.db, {
    hostId: args.hostId,
    threadIds,
  });

  const canonicalEnvironmentIdByThreadId = new Map<string, string | null>();
  for (const ownedThread of ownedThreads) {
    canonicalEnvironmentIdByThreadId.set(
      ownedThread.threadId,
      ownedThread.environmentId,
    );
  }

  const entries: PostableEventBatchEntry[] = [];
  const rejectedEvents: HostDaemonRejectedEvent[] = [];
  for (const [eventIndex, entry] of args.events.entries()) {
    if (!canonicalEnvironmentIdByThreadId.has(entry.threadId)) {
      rejectedEvents.push({
        eventIndex,
        reason: "thread_not_owned_by_host",
        threadId: entry.threadId,
      });
      continue;
    }
    const canonicalEnvironmentId =
      canonicalEnvironmentIdByThreadId.get(entry.threadId) ?? null;
    entries.push({
      envelope: entry,
      environmentId: canonicalEnvironmentId,
      eventIndex,
    });
  }

  return {
    entries,
    rejectedEvents,
  };
}

export function registerInternalEventRoutes(app: Hono, deps: AppDeps): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/events",
    hostDaemonEventBatchRequestSchema,
    async (context, payload) => {
      let session: ReturnType<typeof requireAuthenticatedDaemonSession>;
      try {
        session = requireAuthenticatedDaemonSession({
          context,
          db: deps.db,
          sessionId: payload.sessionId,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.body.code === "inactive_session"
        ) {
          deps.logger.info(
            getInactiveSessionLogFields(deps.db, {
              authenticatedHostId: getAuthenticatedDaemon(context).hostId,
              now: Date.now(),
              sessionId: payload.sessionId,
            }),
            "Daemon event batch for inactive session",
          );
        }
        throw error;
      }
      const { entries, rejectedEvents } = resolvePostableEventBatchEntries(
        deps,
        {
          hostId: session.hostId,
          events: payload.events,
        },
      );
      if (rejectedEvents.length > 0) {
        deps.logger.warn(
          {
            hostId: session.hostId,
            rejectedEvents: summarizeRejectedDaemonEvents(rejectedEvents),
            sessionId: session.id,
          },
          "Rejected daemon events for threads outside the session host",
        );
      }
      const eventInputs = entries.map((entry) => {
        return toStoredEvent({
          envelope: entry.envelope,
          environmentId: entry.environmentId,
        });
      });
      const postableEvents = entries.map((entry) => entry.envelope);
      let appendResult: AppendDaemonEventsResult;
      try {
        appendResult = deps.db.transaction(
          (tx) => appendDaemonEventsInTransaction(tx, eventInputs),
          { behavior: "immediate" },
        );
      } catch (error) {
        if (error instanceof MissingStoredTurnStartedError) {
          deps.logger.warn(
            {
              ...error.details,
              sessionId: session.id,
              ...runtimeErrorLogFields(deps.config, error),
            },
            "Rejected daemon event before turn/started",
          );
          throw new ApiError(409, "invalid_request", error.message);
        }
        throw error;
      }
      notifyInsertedEventThreads(deps, {
        eventInputs,
        insertedInputIndexes: appendResult.insertedInputIndexes,
      });

      const followUps = await applyEventEffects(
        deps,
        resolveEventsToApply({
          db: deps.db,
          events: postableEvents,
          insertedEventIndexes: appendResult.insertedInputIndexes,
        }),
      );
      for (const candidate of resolveActivePruneCandidates({
        acceptedEvents: appendResult.acceptedEvents,
        events: postableEvents,
        insertedEventIndexes: appendResult.insertedInputIndexes,
      })) {
        maybePruneActiveThreadEventHistory(deps, candidate);
      }

      deferEventFollowUpBatch(deps, followUps);
      return context.json({
        acceptedEvents: appendResult.acceptedEvents.map(
          (acceptedEvent, inputIndex) => {
            const entry = entries[inputIndex];
            if (entry === undefined) {
              throw new Error("Missing daemon event entry for accepted event");
            }
            return {
              eventIndex: entry.eventIndex,
              sequence: acceptedEvent.sequence,
              threadId: acceptedEvent.threadId,
            };
          },
        ),
        rejectedEvents,
      });
    },
  );
}
