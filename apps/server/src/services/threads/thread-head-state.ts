import {
  getLatestCompletedThreadContextClearSequence,
  getLatestModelFallbackRowSinceTurnRequest,
  listContextWindowUsageRows,
  listLatestThreadStateEventRowsByThreadIds,
  listOpenTurnInputAcceptedRowsByThreadIds,
  listStoredClientTurnRequestRowsByKeys,
  listTodoSnapshotEventRowsForThread,
  type DbConnection,
  type StoredEventRow,
  type ThreadClientTurnRequestKey,
} from "@bb/db";
import {
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  type ProviderComposerCommand,
  type Thread,
} from "@bb/domain";
import {
  extractThreadContextWindowUsage,
  extractThreadExtensionStates,
  extractThreadProviderCommands,
  extractThreadSessionOptions,
  extractThreadTimelineActivePlanTurn,
  extractThreadTimelineModelFallback,
  extractThreadTimelinePendingTodos,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type {
  ThreadContextWindowUsage,
  ThreadHeadStateResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import {
  isCompactionOfferEnabled,
  withCompactionOffer,
} from "./compaction-offer.js";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";

export interface ThreadHeadStateOptions {
  compactionOfferEnabled: boolean;
  extensionStateKinds: readonly string[];
  planCommand: ProviderComposerCommand | null;
}

type ThreadHeadStateThread = Pick<Thread, "id" | "providerId" | "status">;

export function resolveThreadHeadStateOptions(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  providerId: string,
): ThreadHeadStateOptions {
  return {
    compactionOfferEnabled: isCompactionOfferEnabled(deps, providerId),
    extensionStateKinds: Object.entries(
      deps.providerRegistry.get(providerId)?.info.extensionKinds ?? {},
    ).flatMap(([kind, declared]) => (declared.state ? [kind] : [])),
    planCommand: resolveProviderPlanCommand(deps.providerRegistry, providerId),
  };
}

function decodeRows(
  db: DbConnection,
  rows: readonly StoredEventRow[],
): ThreadEventWithMeta[] {
  return rows.map((row) => ({
    event: decodeStoredEventRowCached(db, row),
    meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt },
  }));
}

function listLatestStateRows(
  db: DbConnection,
  threadId: string,
  kinds: readonly string[],
): StoredEventRow[] {
  return [
    ...new Set([
      ...kinds,
      THREAD_PROVIDER_COMMANDS_STATE_KIND,
      THREAD_SESSION_OPTIONS_STATE_KIND,
      THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
    ]),
  ]
    .flatMap((kind) =>
      listLatestThreadStateEventRowsByThreadIds(db, {
        threadIds: [threadId],
        kind,
      }),
    )
    .sort((left, right) => left.sequence - right.sequence);
}

export function listOpenTurnRequestRows(
  db: DbConnection,
  threadIds: readonly string[],
): StoredEventRow[] {
  const acceptedRows = listOpenTurnInputAcceptedRowsByThreadIds(db, {
    threadIds: [...threadIds],
  });
  const requestKeys: ThreadClientTurnRequestKey[] = decodeRows(
    db,
    acceptedRows,
  ).flatMap(({ event }) =>
    event.type === "turn/input/accepted"
      ? [{ requestId: event.clientRequestId, threadId: event.threadId }]
      : [],
  );
  return [
    ...acceptedRows,
    ...listStoredClientTurnRequestRowsByKeys(db, { keys: requestKeys }),
  ].sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.sequence - right.sequence,
  );
}

export function readThreadContextWindowUsage(
  db: DbConnection,
  args: {
    atOrBeforeSequence?: number;
    compactionOfferEnabled: boolean;
    threadId: string;
  },
): ThreadContextWindowUsage | null {
  const sequenceStart =
    getLatestCompletedThreadContextClearSequence(db, {
      atOrBeforeSequence: args.atOrBeforeSequence,
      threadId: args.threadId,
    }) ?? 0;
  const usage = extractThreadContextWindowUsage(
    decodeRows(
      db,
      listContextWindowUsageRows(db, {
        threadId: args.threadId,
        sequenceStart,
      }),
    ),
  );
  return usage === null
    ? null
    : withCompactionOffer(db, {
        enabled: args.compactionOfferEnabled,
        sequenceStart,
        threadId: args.threadId,
        usage,
      });
}

export function readThreadHeadState(
  db: DbConnection,
  thread: ThreadHeadStateThread,
  options: ThreadHeadStateOptions,
  atOrBeforeSequence?: number,
): ThreadHeadStateResponse {
  const decodeVisible = (rows: readonly StoredEventRow[]) =>
    decodeRows(
      db,
      atOrBeforeSequence === undefined
        ? rows
        : rows.filter((row) => row.sequence <= atOrBeforeSequence),
    );
  const stateEvents = decodeVisible(
    listLatestStateRows(db, thread.id, options.extensionStateKinds),
  );
  const todoEvents = decodeVisible(
    listTodoSnapshotEventRowsForThread(db, { threadId: thread.id }),
  );
  const fallbackRow = getLatestModelFallbackRowSinceTurnRequest(db, {
    threadId: thread.id,
  });
  const fallbackEvents = decodeVisible(
    fallbackRow === null ? [] : [fallbackRow],
  );
  const openTurnEvents =
    thread.status === "active" && options.planCommand !== null
      ? decodeVisible(listOpenTurnRequestRows(db, [thread.id]))
      : [];
  return {
    activePromptMode:
      extractThreadTimelineActivePlanTurn({
        events: openTurnEvents,
        planCommand: options.planCommand,
        providerId: thread.providerId,
        threadStatus: thread.status,
      })?.promptMode ?? null,
    contextWindowUsage: readThreadContextWindowUsage(db, {
      atOrBeforeSequence,
      compactionOfferEnabled: options.compactionOfferEnabled,
      threadId: thread.id,
    }),
    extensionStates: extractThreadExtensionStates(
      stateEvents,
      options.extensionStateKinds,
    ),
    modelFallback: extractThreadTimelineModelFallback(fallbackEvents),
    pendingTodos: extractThreadTimelinePendingTodos(thread.status, todoEvents),
    providerCommands: extractThreadProviderCommands(stateEvents),
    sessionOptions: extractThreadSessionOptions(stateEvents),
  };
}
