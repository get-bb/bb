import {
  THREAD_SESSION_OPTIONS_STATE_KIND,
  threadScope,
  turnScope,
  type ThreadEventType,
} from "@bb/domain";
import type { DbConnection } from "../../src/connection.js";
import {
  isThreadAwaitingTurnStartPastDeadline,
  listTurnStartDeadlineCandidates,
} from "../../src/data/threads.js";
import {
  findLatestEditableUserTurnRequestRow,
  findStoredEditMessageOperationRow,
  hasStoredCancelledThreadProvisioning,
  hasStoredProviderTurnCompletedSince,
  hasStoredThreadInterruptedSince,
  advanceTimelineWindowBudgetFloorSequence,
  appendDaemonEventsInTransaction,
  appendStoredThreadEvent,
  appendStoredThreadEventInTransaction,
  appendStoredThreadEventsInTransaction,
  classifyStoredProviderThreadClaim,
  copyStoredThreadEventsInTransaction,
  deleteThreadEventSuffixInTransaction,
  findLastCompletedRootStoredTurn,
  findLastRootStoredTurnStarted,
  findLatestUnresolvedClientTurnRequestIdAfterSequence,
  findStoredEventRow,
  findStoredTimelineWindowByteBudgetFloor,
  findTimelineWindowBudgetFloorSequence,
  getActiveStoredTurnId,
  getContextWindowUsagePruningBoundarySequence,
  getFirstParentedTimelineBoundarySequence,
  getHighWaterMarks,
  getLastStoredProviderThreadId,
  getLastStoredTurnRequestEvent,
  getLatestCompletedThreadContextClearSequence,
  getLatestModelFallbackRowSinceTurnRequest,
  getLatestStoredConversationOutlineSequence,
  getLatestStoredRateLimitsEvent,
  getLatestStoredThreadEventOfTypes,
  getLatestThreadInterruptedReason,
  getLatestThreadSequence,
  getLatestThreadSystemErrorEventRow,
  getLatestTokenUsageRow,
  getStoredConversationOutlineProjectionState,
  getStoredItemLifecycleSequenceRange,
  getStoredProviderSession,
  getStoredTurnRequestEventForTurn,
  getTimelineGroupingContextChangesInRange,
  getTurnFinalAgentMessageEventRow,
  getUnfinishedCommandItemData,
  hasRootStoredTurnStarted,
  hasStoredSpawnAgentToolCall,
  hasStoredTerminalClientTurnRequestEvent,
  hasStoredTurnCompleted,
  hasStoredTurnRequestEventSince,
  hasStoredTurnStarted,
  isStoredTurnContextCompactionOnly,
  isStoredTurnMainRunIdle,
  isStoredTurnProviderCompactionRunning,
  insertEvents,
  isTimelineCursorSequencePresent,
  listActiveBackgroundTaskCountsByThreadIds,
  listAppendedEventRows,
  listCommandItemDataByItemIds,
  listContextWindowUsageRows,
  listItemEventSpansByItems,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listLatestThreadStateEventRowsByThreadIds,
  listLatestTurnFinalAgentMessageEventRows,
  listOpenBackgroundTaskItemRowsForHost,
  listOpenBackgroundTaskItemRowsForThread,
  listOpenTurnInputAcceptedRowsByThreadIds,
  listOwnerStoppedBackgroundTaskRowsForHost,
  listStartedBackgroundItemRowsByItemIds,
  listStoredStandaloneThreadTimelineRows,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredClientTurnRequestIdsInRange,
  listStoredClientTurnRequestRowsByKeys,
  listStoredConversationOutlineEventRows,
  listStoredDelegatingItemRowsByItemIds,
  listStoredEventRowMetadata,
  listStoredEventRows,
  listStoredEventRowsByParentToolCallIds,
  listStoredEventRowsInSequenceRange,
  listStoredItemLifecycleRowsByItems,
  listStoredRootConversationOutlineEventRows,
  listStoredTaskTurnRequestEvents,
  listStoredTimelineThreadWindowEventRows,
  listStoredTimelineTurnEventRows,
  listStoredTimelineWindowEventRows,
  listStoredTurnCompletedKeys,
  listStoredTurnCompletedRowsByTurnIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnStartedKeys,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listThreadEventSuffixBackgroundSettlementRows,
  listThreadIdsStoppedSinceLastTurnStart,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  listThreadTurnInterruptionEventStates,
  listTimelineInterruptionRows,
  listTimelineOrderingContext,
  listTimelineRootWindowTurnIds,
  listTimelineWindowHintsDescending,
  listTimelineWindowParentToolCallIds,
  listTodoSnapshotEventRowsForThread,
  pruneContextWindowUsageEventsInTransaction,
  pruneTokenUsageEventsInTransaction,
  resolveStoredProviderSessions,
  wouldRemoveSharedProviderSessionClaim,
  type AppendDaemonEventInput,
  type PruneTokenUsageEventsArgs,
  type ScopedItemRef,
  type StoredEventRowMetadata,
} from "../../src/data/events.js";
import { noopNotifier } from "../../src/notifier.js";
import type { QueryCostCase } from "./case.js";
import type { HistoryFixture, HistoryTurn } from "../../src/history-fixture.js";

const EVENTS = "packages/db/src/data/events.ts";
const TIMELINE_EXCLUDED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/diff/updated",
  "turn/mainRun/updated",
] as const satisfies readonly ThreadEventType[];
const FORK_INHERITED_EVENT_TYPES = [
  "client/turn/requested",
  "turn/started",
  "turn/input/accepted",
  "item/completed",
  "item/backgroundTask/completed",
  "turn/completed",
  "thread/compacted",
  "system/manager/user_message",
] as const satisfies readonly ThreadEventType[];
const MAX_INLINE_OUTPUT_CHARS = 32_000;
const TIMELINE_EVENT_DATA_BYTE_LIMIT = 4 * 1024 * 1024;
const TIMELINE_WINDOW_EVENT_BUDGET = 1_500;
const TIMELINE_WINDOW_TURNS = 90;
const ACTIVE_TURN_ID = "h-active";

function lastTurn(fixture: HistoryFixture): HistoryTurn {
  const turn = fixture.turns.at(-1);
  if (turn === undefined) throw new Error("Expected history turns");
  return turn;
}

function turnAt(fixture: HistoryFixture, index: number): HistoryTurn {
  const turn = fixture.turns.at(index);
  if (turn === undefined) throw new Error(`Expected history turn ${index}`);
  return turn;
}

function windowTurns(fixture: HistoryFixture): HistoryTurn[] {
  return fixture.turns.slice(-TIMELINE_WINDOW_TURNS);
}

function windowStart(fixture: HistoryFixture): number {
  return turnAt(fixture, -TIMELINE_WINDOW_TURNS).requestSequence;
}

function allThreadIds(fixture: HistoryFixture): string[] {
  return [fixture.threadId, ...fixture.neighborThreadIds];
}

function turnItems(turn: HistoryTurn): ScopedItemRef[] {
  return [
    `${turn.turnId}-reasoning`,
    ...turn.commandItemIds,
    turn.agentMessageItemId,
  ].map((itemId) => ({ itemId, scopeKind: "turn", turnId: turn.turnId }));
}

function timelineWindowArgs(fixture: HistoryFixture) {
  return {
    beforeSequence: fixture.latestSequence + 1,
    excludeDiagnosticEvents: true,
    excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
    sequenceStart: windowStart(fixture),
    threadId: fixture.threadId,
  };
}

function turnDetailsWindow(fixture: HistoryFixture) {
  const turn = turnAt(fixture, 0);
  return {
    beforeSequence: turn.completedSequence + 1,
    excludeDiagnosticEvents: true,
    excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
    sequenceStart: turn.requestSequence,
    threadId: fixture.threadId,
  };
}

function startPendingTurn(db: DbConnection, fixture: HistoryFixture): void {
  db.transaction((tx) =>
    appendStoredThreadEventsInTransaction(tx, [
      {
        threadId: fixture.threadId,
        providerThreadId: fixture.providerThreadId,
        scope: turnScope(ACTIVE_TURN_ID),
        type: "turn/started",
        data: { providerThreadId: fixture.providerThreadId },
      },
      {
        threadId: fixture.threadId,
        providerThreadId: fixture.providerThreadId,
        scope: turnScope(ACTIVE_TURN_ID),
        type: "turn/input/accepted",
        data: {
          providerThreadId: fixture.providerThreadId,
          clientRequestId: fixture.pendingRequestId,
        },
      },
    ]),
  );
}

const DAEMON_BACKLOG_EVENTS = 512;
const FORK_COPY_BATCH_ROWS = 10;
const PRUNING_CHUNK_SIZE = 16;

type UsageEventType =
  | "thread/contextWindowUsage/updated"
  | "thread/tokenUsage/updated";

let forkCopyRows: StoredEventRowMetadata[] = [];
let pruningWindow: PruneTokenUsageEventsArgs | null = null;

function daemonEvent(
  fixture: HistoryFixture,
  type: ThreadEventType,
  data: Record<string, unknown>,
  item: { itemId: string; itemKind: AppendDaemonEventInput["itemKind"] } | null,
): AppendDaemonEventInput {
  return {
    data: JSON.stringify({
      providerThreadId: fixture.providerThreadId,
      ...data,
    }),
    environmentId: fixture.environmentId,
    itemId: item?.itemId ?? null,
    itemKind: item?.itemKind ?? null,
    parentToolCallId: null,
    providerThreadId: fixture.providerThreadId,
    scope: turnScope(ACTIVE_TURN_ID),
    threadId: fixture.threadId,
    type,
  };
}

function daemonBacklog(fixture: HistoryFixture): AppendDaemonEventInput[] {
  const head = [
    daemonEvent(fixture, "turn/started", {}, null),
    daemonEvent(
      fixture,
      "turn/input/accepted",
      { clientRequestId: fixture.pendingRequestId },
      null,
    ),
  ];
  const agentMessageId = `${ACTIVE_TURN_ID}-agent`;
  const agentMessage = {
    itemId: agentMessageId,
    itemKind: "agentMessage" as const,
  };
  const tail = [
    daemonEvent(
      fixture,
      "item/agentMessage/delta",
      { itemId: agentMessageId, delta: "The build passes now." },
      agentMessage,
    ),
    daemonEvent(
      fixture,
      "item/completed",
      {
        item: {
          type: "agentMessage",
          id: agentMessageId,
          text: "The build passes now. I changed the failing query.",
        },
      },
      agentMessage,
    ),
    daemonEvent(fixture, "turn/completed", { status: "completed" }, null),
  ];
  const commands: AppendDaemonEventInput[] = [];
  for (
    let index = 0;
    head.length + commands.length + 3 + tail.length <= DAEMON_BACKLOG_EVENTS;
    index += 1
  ) {
    const itemId = `${ACTIVE_TURN_ID}-cmd${index}`;
    const command = {
      type: "commandExecution",
      id: itemId,
      command: `pnpm exec turbo run test --filter=@bb/db -- test/${index}.test.ts`,
      cwd: "/workspace/bb",
      approvalStatus: null,
    };
    const item = { itemId, itemKind: "commandExecution" as const };
    commands.push(
      daemonEvent(
        fixture,
        "item/started",
        { item: { ...command, status: "pending" } },
        item,
      ),
      daemonEvent(
        fixture,
        "item/commandExecution/outputDelta",
        {
          itemId,
          delta: "\u2713 test/query-plan-audit.test.ts (6 tests) 12ms\n",
        },
        item,
      ),
      daemonEvent(
        fixture,
        "item/completed",
        {
          item: {
            ...command,
            status: "completed",
            exitCode: 0,
            durationMs: 1800,
            aggregatedOutput:
              "\u2713 test/query-plan-audit.test.ts (6 tests) 12ms\n",
          },
        },
        item,
      ),
    );
  }
  return [...head, ...commands, ...tail];
}

function selectForkCopyRows(db: DbConnection, fixture: HistoryFixture): void {
  forkCopyRows = listStoredEventRowMetadata(db, {
    afterSequence: 0,
    beforeSequence: fixture.latestSequence + 1,
    limit: FORK_COPY_BATCH_ROWS,
    threadId: fixture.threadId,
    types: FORK_INHERITED_EVENT_TYPES,
  }).map((row) => ({ ...row, providerThreadId: null }));
}

function latestUsageSequence(
  db: DbConnection,
  fixture: HistoryFixture,
  type: UsageEventType,
): number {
  return (
    db.$client
      .prepare<[string, string], { sequence: number }>(
        "SELECT sequence FROM events WHERE thread_id = ? AND type = ? ORDER BY sequence DESC LIMIT 1",
      )
      .get(fixture.threadId, type)?.sequence ?? 0
  );
}

function selectPruningWindow(
  db: DbConnection,
  fixture: HistoryFixture,
  type: UsageEventType,
): void {
  const chunk = db.$client
    .prepare<[string, string, number], { id: string; sequence: number }>(
      "SELECT id, sequence FROM events INDEXED BY events_thread_type_sequence_idx WHERE thread_id = ? AND type = ? AND sequence > 0 ORDER BY sequence LIMIT ?",
    )
    .all(fixture.threadId, type, PRUNING_CHUNK_SIZE);
  const last = chunk.at(-1);
  if (last === undefined) throw new Error(`Expected ${type} events`);
  const contextStep = type === "thread/contextWindowUsage/updated";
  const latestRootSequence = latestUsageSequence(db, fixture, type);
  pruningWindow = {
    afterSequence: 0,
    candidateIds: chunk.map((row) => row.id),
    threadId: fixture.threadId,
    throughSequence: last.sequence,
    usageKeepers: {
      boundarySequence: contextStep
        ? getContextWindowUsagePruningBoundarySequence(db, fixture.threadId)
        : 0,
      latestContextSequence: contextStep ? latestRootSequence : 0,
      latestRootSequence,
    },
  };
}

function selectedPruningWindow(): PruneTokenUsageEventsArgs {
  if (pruningWindow === null) throw new Error("Expected a pruning window");
  return pruningWindow;
}

function batchTurnKeys(fixture: HistoryFixture) {
  return [
    ...fixture.turns
      .slice(-4)
      .map((turn) => ({ threadId: fixture.threadId, turnId: turn.turnId })),
    ...fixture.neighborThreadIds.map((threadId, index) => ({
      threadId,
      turnId: `n${index}-t1`,
    })),
  ];
}

const TURN_START_DEADLINE_MS = 5 * 60_000;
const THREADS = "packages/db/src/data/threads.ts";

function markThreadAwaitingTurnStart(
  db: DbConnection,
  fixture: HistoryFixture,
): void {
  db.$client
    .prepare(
      "UPDATE threads SET status = 'active', status_changed_at = 0 WHERE id = ?",
    )
    .run(fixture.threadId);
}

const LIVE_TURN = "open long turn";
const LIVE_DELTA_BATCH = 40;
let liveWindowStart = 0;

function liveItems(fixture: HistoryFixture): ScopedItemRef[] {
  const { liveTurn } = fixture;
  return [liveTurn.runningCommandItemId, liveTurn.streamingMessageItemId].map(
    (itemId) => ({ itemId, scopeKind: "turn", turnId: liveTurn.turnId }),
  );
}

function liveTimelineArgs(fixture: HistoryFixture) {
  return {
    beforeSequence: fixture.liveTurn.latestSequence + 1,
    excludeDiagnosticEvents: true,
    excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
    maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
    sequenceStart: liveWindowStart,
    threadId: fixture.liveTurn.threadId,
  };
}

function selectLiveWindowStart(db: DbConnection, fixture: HistoryFixture) {
  liveWindowStart =
    findTimelineWindowBudgetFloorSequence(db, {
      beforeSequence: fixture.liveTurn.latestSequence + 1,
      eventBudget: TIMELINE_WINDOW_EVENT_BUDGET,
      excludeDiagnosticEvents: true,
      excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
      sequenceStart: 0,
      threadId: fixture.liveTurn.threadId,
    }) ?? 0;
}

function liveDeltaBatch(fixture: HistoryFixture): AppendDaemonEventInput[] {
  const { liveTurn } = fixture;
  const event = (
    type: ThreadEventType,
    itemId: string,
    itemKind: AppendDaemonEventInput["itemKind"],
    delta: string,
  ): AppendDaemonEventInput => ({
    data: JSON.stringify({
      providerThreadId: liveTurn.providerThreadId,
      itemId,
      delta,
    }),
    environmentId: fixture.environmentId,
    itemId,
    itemKind,
    parentToolCallId: null,
    providerThreadId: liveTurn.providerThreadId,
    scope: turnScope(liveTurn.turnId),
    threadId: liveTurn.threadId,
    type,
  });
  return Array.from({ length: LIVE_DELTA_BATCH }, (_, index) =>
    index % 2 === 0
      ? event(
          "item/agentMessage/delta",
          liveTurn.streamingMessageItemId,
          "agentMessage",
          "Still checking. ",
        )
      : event(
          "item/commandExecution/outputDelta",
          liveTurn.runningCommandItemId,
          "commandExecution",
          "\u2713 test/query-plan-audit.test.ts (6 tests) 12ms\n",
        ),
  );
}

const LIVE_TURN_COST_CASES: readonly QueryCostCase[] = [
  {
    name: `${EVENTS}#getActiveStoredTurnId`,
    variant: LIVE_TURN,
    run: (db, fixture) => getActiveStoredTurnId(db, fixture.liveTurn.threadId),
  },
  {
    name: `${EVENTS}#isStoredTurnMainRunIdle`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      isStoredTurnMainRunIdle(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#isStoredTurnProviderCompactionRunning`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      isStoredTurnProviderCompactionRunning(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#isStoredTurnContextCompactionOnly`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      isStoredTurnContextCompactionOnly(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#getStoredTurnRequestEventForTurn`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      getStoredTurnRequestEventForTurn(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#getUnfinishedCommandItemData`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      getUnfinishedCommandItemData(db, {
        afterSequence: fixture.liveTurn.requestSequence,
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredTurnStarted`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      hasStoredTurnStarted(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredTurnCompleted`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      hasStoredTurnCompleted(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#getTurnFinalAgentMessageEventRow`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      getTurnFinalAgentMessageEventRow(db, {
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#listOpenTurnInputAcceptedRowsByThreadIds`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listOpenTurnInputAcceptedRowsByThreadIds(db, {
        threadIds: [fixture.liveTurn.threadId],
      }),
  },
  {
    name: `${EVENTS}#findLatestUnresolvedClientTurnRequestIdAfterSequence`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      findLatestUnresolvedClientTurnRequestIdAfterSequence(db, {
        threadId: fixture.liveTurn.threadId,
        afterSequence: 0,
      }),
  },
  {
    name: `${EVENTS}#getLastStoredTurnRequestEvent`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      getLastStoredTurnRequestEvent(db, fixture.liveTurn.threadId),
  },
  {
    name: `${EVENTS}#listCommandItemDataByItemIds`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listCommandItemDataByItemIds(db, {
        itemIds: [fixture.liveTurn.runningCommandItemId],
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#findTimelineWindowBudgetFloorSequence`,
    variant: LIVE_TURN,
    run: selectLiveWindowStart,
  },
  {
    name: `${EVENTS}#listStoredTimelineThreadWindowEventRows`,
    variant: LIVE_TURN,
    prepare: selectLiveWindowStart,
    run: (db, fixture) =>
      listStoredTimelineThreadWindowEventRows(db, liveTimelineArgs(fixture)),
  },
  {
    name: `${EVENTS}#listTimelineRootWindowTurnIds`,
    variant: LIVE_TURN,
    prepare: selectLiveWindowStart,
    run: (db, fixture) =>
      listTimelineRootWindowTurnIds(db, liveTimelineArgs(fixture)),
  },
  {
    name: `${EVENTS}#listTimelineWindowParentToolCallIds`,
    variant: LIVE_TURN,
    prepare: selectLiveWindowStart,
    run: (db, fixture) =>
      listTimelineWindowParentToolCallIds(db, liveTimelineArgs(fixture)),
  },
  {
    name: `${EVENTS}#listTimelineWindowHintsDescending`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listTimelineWindowHintsDescending(db, {
        beforeSequence: fixture.liveTurn.latestSequence + 1,
        limit: 21,
        sequenceStart: 0,
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#listTimelineOrderingContext`,
    variant: LIVE_TURN,
    prepare: selectLiveWindowStart,
    run: (db, fixture) =>
      listTimelineOrderingContext(db, {
        maxSeq: fixture.liveTurn.latestSequence,
        sequenceStart: liveWindowStart,
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#listTimelineInterruptionRows`,
    variant: LIVE_TURN,
    prepare: selectLiveWindowStart,
    run: (db, fixture) =>
      listTimelineInterruptionRows(db, {
        maxSeq: fixture.liveTurn.latestSequence,
        sequenceStart: liveWindowStart,
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#listItemEventSpansByItems`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listItemEventSpansByItems(db, {
        items: liveItems(fixture),
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredItemLifecycleRowsByItems`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listStoredItemLifecycleRowsByItems(db, {
        items: liveItems(fixture),
        maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredBufferedTextDeltaRowsByItems`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listStoredBufferedTextDeltaRowsByItems(db, {
        beforeSequence: fixture.liveTurn.latestSequence + 1,
        items: liveItems(fixture),
        threadId: fixture.liveTurn.threadId,
      }),
  },
  {
    name: `${EVENTS}#getStoredItemLifecycleSequenceRange`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      getStoredItemLifecycleSequenceRange(db, {
        itemId: fixture.liveTurn.streamingMessageItemId,
        threadId: fixture.liveTurn.threadId,
        turnId: fixture.liveTurn.turnId,
      }),
  },
  {
    name: `${EVENTS}#appendDaemonEventsInTransaction`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      db.transaction((tx) =>
        appendDaemonEventsInTransaction(tx, liveDeltaBatch(fixture)),
      ),
  },
  {
    name: `${EVENTS}#listTodoSnapshotEventRowsForThread`,
    variant: LIVE_TURN,
    run: (db, fixture) =>
      listTodoSnapshotEventRowsForThread(db, {
        threadId: fixture.liveTurn.threadId,
      }),
  },
];

export const EVENTS_COST_CASES: readonly QueryCostCase[] = [
  {
    name: `${EVENTS}#deleteThreadEventSuffixInTransaction`,
    run: (db, fixture) =>
      db.transaction((tx) =>
        deleteThreadEventSuffixInTransaction(tx, {
          cutoffSequence: lastTurn(fixture).requestSequence,
          oldMaxSequence: fixture.latestSequence,
          threadId: fixture.threadId,
        }),
      ),
  },
  {
    name: `${EVENTS}#listThreadEventSuffixBackgroundSettlementRows`,
    run: (db, fixture) =>
      listThreadEventSuffixBackgroundSettlementRows(db, {
        cutoffSequence: turnAt(fixture, 0).requestSequence,
        oldMaxSequence: fixture.latestSequence,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getHighWaterMarks`,
    run: (db, fixture) => getHighWaterMarks(db, allThreadIds(fixture)),
  },
  {
    name: `${EVENTS}#listStoredEventRowMetadata`,
    run: (db, fixture) =>
      listStoredEventRowMetadata(db, {
        afterSequence: 0,
        beforeSequence: fixture.latestSequence + 1,
        limit: 2_000,
        threadId: fixture.threadId,
        types: FORK_INHERITED_EVENT_TYPES,
      }),
  },
  {
    name: `${EVENTS}#listStoredEventRows`,
    run: (db, fixture) =>
      listStoredEventRows(db, {
        afterSequence: 0,
        beforeSequence: fixture.latestSequence + 1,
        limit: 2_000,
        threadId: fixture.threadId,
        types: ["turn/input/accepted", "client/turn/requested"],
      }),
  },
  {
    name: `${EVENTS}#listOpenTurnInputAcceptedRowsByThreadIds`,
    prepare: startPendingTurn,
    run: (db, fixture) =>
      listOpenTurnInputAcceptedRowsByThreadIds(db, {
        threadIds: allThreadIds(fixture),
      }),
  },
  {
    name: `${EVENTS}#listStoredClientTurnRequestRowsByKeys`,
    run: (db, fixture) =>
      listStoredClientTurnRequestRowsByKeys(db, {
        keys: [
          {
            requestId: lastTurn(fixture).requestId,
            threadId: fixture.threadId,
          },
        ],
      }),
  },
  {
    name: `${EVENTS}#findStoredEventRow`,
    run: (db, fixture) =>
      findStoredEventRow(db, {
        afterSequence: fixture.latestSequence,
        threadId: fixture.threadId,
        type: "turn/started",
      }),
  },
  {
    name: `${EVENTS}#listStoredEventRowsByParentToolCallIds`,
    run: (db, fixture) =>
      listStoredEventRowsByParentToolCallIds(db, {
        beforeSequence: fixture.latestSequence + 1,
        excludeDiagnosticEvents: true,
        excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
        maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
        parentToolCallIds: fixture.delegationItemIds.slice(-1),
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredDelegatingItemRowsByItemIds`,
    run: (db, fixture) =>
      listStoredDelegatingItemRowsByItemIds(db, {
        itemIds: fixture.delegationItemIds.slice(-1),
        maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#isTimelineCursorSequencePresent`,
    run: (db, fixture) =>
      isTimelineCursorSequencePresent(db, {
        sequence: turnAt(fixture, 0).requestSequence,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listItemEventSpansByItems`,
    run: (db, fixture) =>
      listItemEventSpansByItems(db, {
        items: windowTurns(fixture).flatMap(turnItems),
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getStoredItemLifecycleSequenceRange`,
    run: (db, fixture) => {
      const turn = turnAt(fixture, 0);
      return getStoredItemLifecycleSequenceRange(db, {
        itemId: turn.agentMessageItemId,
        threadId: fixture.threadId,
        turnId: turn.turnId,
      });
    },
  },
  {
    name: `${EVENTS}#listStoredItemLifecycleRowsByItems`,
    run: (db, fixture) =>
      listStoredItemLifecycleRowsByItems(db, {
        items: turnItems(turnAt(fixture, -TIMELINE_WINDOW_TURNS - 1)),
        maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredBufferedTextDeltaRowsByItems`,
    run: (db, fixture) =>
      listStoredBufferedTextDeltaRowsByItems(db, {
        beforeSequence: windowStart(fixture),
        items: turnItems(turnAt(fixture, -TIMELINE_WINDOW_TURNS - 1)),
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredClientTurnRequestIdsInRange`,
    run: (db, fixture) => {
      const turn = turnAt(fixture, 0);
      return listStoredClientTurnRequestIdsInRange(db, {
        seqEnd: turn.completedSequence,
        seqStart: turn.requestSequence,
        threadId: fixture.threadId,
      });
    },
  },
  {
    name: `${EVENTS}#getStoredTurnRequestEventForTurn`,
    prepare: startPendingTurn,
    run: (db, fixture) =>
      getStoredTurnRequestEventForTurn(db, {
        threadId: fixture.threadId,
        turnId: ACTIVE_TURN_ID,
      }),
  },
  {
    name: `${EVENTS}#getLatestStoredThreadEventOfTypes`,
    run: (db, fixture) =>
      getLatestStoredThreadEventOfTypes(db, {
        afterSequence: lastTurn(fixture).requestSequence,
        threadId: fixture.threadId,
        types: ["provider/error"],
      }),
  },
  {
    name: `${EVENTS}#getLatestStoredRateLimitsEvent`,
    run: (db, fixture) =>
      getLatestStoredRateLimitsEvent(db, { threadId: fixture.threadId }),
  },
  {
    name: `${EVENTS}#listStoredTurnInputAcceptedRowsByClientRequestIds`,
    run: (db, fixture) => {
      const turn = turnAt(fixture, 0);
      return listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
        afterSequence: turn.completedSequence,
        clientRequestIds: [turn.requestId],
        threadId: fixture.threadId,
      });
    },
  },
  {
    name: `${EVENTS}#listStoredTurnRejectedRowsByClientRequestIds`,
    run: (db, fixture) =>
      listStoredTurnRejectedRowsByClientRequestIds(db, {
        afterSequence: -1,
        clientRequestIds: [fixture.pendingRequestId],
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getLatestThreadInterruptedReason`,
    run: (db, fixture) =>
      getLatestThreadInterruptedReason(db, { threadId: fixture.threadId }),
  },
  {
    name: `${EVENTS}#listStoredTurnStartedRowsByTurnIdsUpToSequence`,
    run: (db, fixture) =>
      listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        sequenceCutoff: Number.MAX_SAFE_INTEGER,
        threadId: fixture.threadId,
        turnIds: [lastTurn(fixture).turnId],
      }),
  },
  {
    name: `${EVENTS}#listStoredTurnCompletedRowsByTurnIds`,
    run: (db, fixture) =>
      listStoredTurnCompletedRowsByTurnIds(db, {
        threadId: fixture.threadId,
        turnIds: [lastTurn(fixture).turnId],
      }),
  },
  {
    name: `${EVENTS}#listTodoSnapshotEventRowsForThread`,
    run: (db, fixture) =>
      listTodoSnapshotEventRowsForThread(db, { threadId: fixture.threadId }),
  },
  {
    name: `${EVENTS}#listLatestBackgroundTaskStateRowsByItemIds`,
    run: (db, fixture) =>
      listLatestBackgroundTaskStateRowsByItemIds(db, {
        beforeSequence: fixture.latestSequence + 1,
        itemIds: [
          ...fixture.backgroundTaskItemIds,
          ...fixture.delegationItemIds.slice(-1),
        ],
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredStandaloneThreadTimelineRows`,
    run: (db, fixture) =>
      listStoredStandaloneThreadTimelineRows(db, {
        threadId: fixture.threadId,
        sequenceStart: Math.max(0, fixture.latestSequence - 2_000),
        beforeSequence: fixture.latestSequence + 1,
        excludeDiagnosticEvents: true,
        maxInlineOutputChars: 32_000,
      }),
  },
  {
    name: `${EVENTS}#listStartedBackgroundItemRowsByItemIds`,
    run: (db, fixture) =>
      listStartedBackgroundItemRowsByItemIds(db, {
        backgroundTaskItemIds: fixture.backgroundTaskItemIds,
        delegatingItemIds: fixture.delegationItemIds.slice(-1),
        maxInlineOutputChars: 32_000,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listLatestOpenBackgroundTaskStateRowsForThread`,
    run: (db, fixture) =>
      listLatestOpenBackgroundTaskStateRowsForThread(db, {
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listActiveBackgroundTaskCountsByThreadIds`,
    run: (db, fixture) =>
      listActiveBackgroundTaskCountsByThreadIds(db, {
        threadIds: allThreadIds(fixture),
      }),
  },
  {
    name: `${EVENTS}#hasStoredSpawnAgentToolCall`,
    run: (db, fixture) => hasStoredSpawnAgentToolCall(db, fixture.threadId),
  },
  {
    name: `${EVENTS}#hasStoredTurnStarted`,
    run: (db, fixture) =>
      hasStoredTurnStarted(db, {
        threadId: fixture.threadId,
        turnId: lastTurn(fixture).turnId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredTurnCompleted`,
    run: (db, fixture) =>
      hasStoredTurnCompleted(db, {
        threadId: fixture.threadId,
        turnId: lastTurn(fixture).turnId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredTerminalClientTurnRequestEvent`,
    run: (db, fixture) =>
      hasStoredTerminalClientTurnRequestEvent(db, {
        requestId: fixture.pendingRequestId,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#findLatestUnresolvedClientTurnRequestIdAfterSequence`,
    run: (db, fixture) =>
      findLatestUnresolvedClientTurnRequestIdAfterSequence(db, {
        threadId: fixture.threadId,
        afterSequence: 0,
      }),
  },
  {
    name: `${EVENTS}#hasRootStoredTurnStarted`,
    run: (db, fixture) =>
      hasRootStoredTurnStarted(db, {
        threadId: fixture.threadId,
        turnId: lastTurn(fixture).turnId,
      }),
  },
  {
    name: `${EVENTS}#findLastCompletedRootStoredTurn`,
    run: (db, fixture) =>
      findLastCompletedRootStoredTurn(db, { threadId: fixture.threadId }),
  },
  {
    name: `${EVENTS}#findLastRootStoredTurnStarted`,
    run: (db, fixture) =>
      findLastRootStoredTurnStarted(db, {
        atOrBeforeSequence: turnAt(fixture, 0).completedSequence,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getLatestStoredConversationOutlineSequence`,
    run: (db, fixture) =>
      getLatestStoredConversationOutlineSequence(db, {
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getStoredConversationOutlineProjectionState`,
    run: (db, fixture) =>
      getStoredConversationOutlineProjectionState(db, {
        classificationSequenceStart: 0,
        sequenceStart: 0,
        summaryCompactionDeltaThreshold: 1_000,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#findTimelineWindowBudgetFloorSequence`,
    run: (db, fixture) =>
      findTimelineWindowBudgetFloorSequence(db, {
        beforeSequence: fixture.latestSequence + 1,
        eventBudget: TIMELINE_WINDOW_EVENT_BUDGET,
        excludeDiagnosticEvents: true,
        excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#advanceTimelineWindowBudgetFloorSequence`,
    run: (db, fixture) =>
      advanceTimelineWindowBudgetFloorSequence(db, {
        appendedEventCount:
          lastTurn(fixture).completedSequence -
          lastTurn(fixture).requestSequence +
          1,
        excludeDiagnosticEvents: true,
        excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
        floorSequence: windowStart(fixture),
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listTimelineInterruptionRows`,
    run: (db, fixture) =>
      listTimelineInterruptionRows(db, {
        maxSeq: fixture.latestSequence,
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listTimelineOrderingContext`,
    run: (db, fixture) =>
      listTimelineOrderingContext(db, {
        maxSeq: fixture.latestSequence,
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getTimelineGroupingContextChangesInRange`,
    run: (db, fixture) =>
      getTimelineGroupingContextChangesInRange(db, {
        afterSequence: turnAt(fixture, -2).completedSequence,
        threadId: fixture.threadId,
        throughSequence: fixture.latestSequence,
      }),
  },
  {
    name: `${EVENTS}#listStoredEventRowsInSequenceRange`,
    run: (db, fixture) =>
      listStoredEventRowsInSequenceRange(db, {
        afterSequence: lastTurn(fixture).requestSequence - 1,
        limit: 513,
        maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
        threadId: fixture.threadId,
        throughSequence: fixture.latestSequence,
      }),
  },
  {
    name: `${EVENTS}#listAppendedEventRows`,
    run: (db, fixture) =>
      listAppendedEventRows(db, {
        afterSequence: lastTurn(fixture).requestSequence - 1,
        limit: 513,
        maxInlineOutputChars: MAX_INLINE_OUTPUT_CHARS,
        threadId: fixture.threadId,
        throughSequence: fixture.latestSequence,
      }),
  },
  {
    name: `${EVENTS}#getFirstParentedTimelineBoundarySequence`,
    run: (db, fixture) =>
      getFirstParentedTimelineBoundarySequence(db, {
        maxSeq: fixture.latestSequence,
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listTimelineWindowHintsDescending`,
    run: (db, fixture) =>
      listTimelineWindowHintsDescending(db, {
        beforeSequence: fixture.latestSequence + 1,
        limit: 21,
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#findStoredTimelineWindowByteBudgetFloor`,
    run: (db, fixture) =>
      findStoredTimelineWindowByteBudgetFloor(db, {
        ...turnDetailsWindow(fixture),
        maxDataBytes: TIMELINE_EVENT_DATA_BYTE_LIMIT,
        maxInlineOutputChars: null,
      }),
  },
  {
    name: `${EVENTS}#listStoredTimelineTurnEventRows`,
    run: (db, fixture) =>
      listStoredTimelineTurnEventRows(db, {
        ...timelineWindowArgs(fixture),
        sequenceStart: 0,
        turnIds: windowTurns(fixture).map((turn) => turn.turnId),
      }),
  },
  {
    name: `${EVENTS}#listTimelineRootWindowTurnIds`,
    run: (db, fixture) =>
      listTimelineRootWindowTurnIds(db, timelineWindowArgs(fixture)),
  },
  {
    name: `${EVENTS}#listStoredTimelineThreadWindowEventRows`,
    run: (db, fixture) =>
      listStoredTimelineThreadWindowEventRows(db, timelineWindowArgs(fixture)),
  },
  {
    name: `${EVENTS}#listStoredTimelineWindowEventRows`,
    run: (db, fixture) =>
      listStoredTimelineWindowEventRows(db, {
        ...turnDetailsWindow(fixture),
        maxInlineOutputChars: null,
      }),
  },
  {
    name: `${EVENTS}#getLatestTokenUsageRow`,
    run: (db, fixture) =>
      getLatestTokenUsageRow(db, {
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getTurnFinalAgentMessageEventRow`,
    run: (db, fixture) =>
      getTurnFinalAgentMessageEventRow(db, {
        threadId: fixture.threadId,
        turnId: lastTurn(fixture).turnId,
      }),
  },
  {
    name: `${EVENTS}#listLatestTurnFinalAgentMessageEventRows`,
    run: (db, fixture) =>
      listLatestTurnFinalAgentMessageEventRows(db, {
        limit: 32,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getLatestThreadSystemErrorEventRow`,
    run: (db, fixture) =>
      getLatestThreadSystemErrorEventRow(db, { threadId: fixture.threadId }),
  },
  {
    name: `${EVENTS}#getLatestModelFallbackRowSinceTurnRequest`,
    run: (db, fixture) =>
      getLatestModelFallbackRowSinceTurnRequest(db, {
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getLatestThreadSequence`,
    run: (db, fixture) =>
      getLatestThreadSequence(db, { threadId: fixture.threadId }),
  },
  {
    name: `${EVENTS}#getActiveStoredTurnId`,
    prepare: startPendingTurn,
    run: (db, fixture) => getActiveStoredTurnId(db, fixture.threadId),
  },
  {
    name: `${EVENTS}#isStoredTurnMainRunIdle`,
    prepare: startPendingTurn,
    run: (db, fixture) =>
      isStoredTurnMainRunIdle(db, {
        threadId: fixture.threadId,
        turnId: ACTIVE_TURN_ID,
      }),
  },
  {
    name: `${EVENTS}#isStoredTurnProviderCompactionRunning`,
    prepare: startPendingTurn,
    run: (db, fixture) =>
      isStoredTurnProviderCompactionRunning(db, {
        threadId: fixture.threadId,
        turnId: ACTIVE_TURN_ID,
      }),
  },
  {
    name: `${EVENTS}#isStoredTurnContextCompactionOnly`,
    run: (db, fixture) =>
      isStoredTurnContextCompactionOnly(db, {
        threadId: fixture.threadId,
        turnId: lastTurn(fixture).turnId,
      }),
  },
  {
    name: `${EVENTS}#getLatestCompletedThreadContextClearSequence`,
    run: (db, fixture) =>
      getLatestCompletedThreadContextClearSequence(db, {
        atOrBeforeSequence: fixture.latestSequence,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#wouldRemoveSharedProviderSessionClaim`,
    run: (db, fixture) =>
      wouldRemoveSharedProviderSessionClaim(db, {
        cutoffSequence: turnAt(fixture, 0).requestSequence,
        oldMaxSequence: fixture.latestSequence,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listThreadTurnInterruptionEventStates`,
    run: (db, fixture) =>
      listThreadTurnInterruptionEventStates(db, {
        threadIds: [fixture.threadId],
      }),
  },
  {
    name: `${EVENTS}#listThreadIdsStoppedSinceLastTurnStart`,
    run: (db, fixture) =>
      listThreadIdsStoppedSinceLastTurnStart(db, {
        threadIds: [fixture.threadId],
      }),
  },
  {
    name: `${EVENTS}#listThreadIdsWithLatestHostDaemonRestartInterruption`,
    run: (db, fixture) =>
      listThreadIdsWithLatestHostDaemonRestartInterruption(db, {
        threadIds: allThreadIds(fixture),
      }),
  },
  {
    name: `${EVENTS}#getLastStoredTurnRequestEvent`,
    run: (db, fixture) => getLastStoredTurnRequestEvent(db, fixture.threadId),
  },
  {
    name: `${EVENTS}#hasStoredTurnRequestEventSince`,
    run: (db, fixture) =>
      hasStoredTurnRequestEventSince(db, {
        since: Date.now(),
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredTaskTurnRequestEvents`,
    run: (db, fixture) =>
      listStoredTaskTurnRequestEvents(db, {
        limit: 8,
        order: "newest",
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listOpenBackgroundTaskItemRowsForHost`,
    run: (db, fixture) =>
      listOpenBackgroundTaskItemRowsForHost(db, { hostId: fixture.hostId }),
  },
  {
    name: `${EVENTS}#listOwnerStoppedBackgroundTaskRowsForHost`,
    run: (db, fixture) =>
      listOwnerStoppedBackgroundTaskRowsForHost(db, {
        hostId: fixture.hostId,
        settledSinceMs: 0,
      }),
  },
  {
    name: `${EVENTS}#listOpenBackgroundTaskItemRowsForThread`,
    run: (db, fixture) =>
      listOpenBackgroundTaskItemRowsForThread(db, {
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getUnfinishedCommandItemData`,
    run: (db, fixture) =>
      getUnfinishedCommandItemData(db, {
        afterSequence: lastTurn(fixture).requestSequence,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listCommandItemDataByItemIds`,
    run: (db, fixture) =>
      listCommandItemDataByItemIds(db, {
        itemIds: lastTurn(fixture).commandItemIds,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#insertEvents`,
    run: (db, fixture) =>
      insertEvents(
        db,
        noopNotifier,
        daemonBacklog(fixture).map((input, index) => ({
          ...input,
          sequence: fixture.latestSequence + 1 + index,
        })),
      ),
  },
  {
    name: `${EVENTS}#appendDaemonEventsInTransaction`,
    run: (db, fixture) =>
      db.transaction((tx) =>
        appendDaemonEventsInTransaction(tx, daemonBacklog(fixture)),
      ),
  },
  {
    name: `${EVENTS}#copyStoredThreadEventsInTransaction`,
    prepare: selectForkCopyRows,
    run: (db, fixture) =>
      db.transaction((tx) =>
        copyStoredThreadEventsInTransaction(tx, {
          rows: forkCopyRows,
          targetEnvironmentId: fixture.environmentId,
          targetThreadId: fixture.neighborThreadIds[0] ?? fixture.threadId,
        }),
      ),
  },
  {
    name: `${EVENTS}#appendStoredThreadEventInTransaction`,
    run: (db, fixture) =>
      db.transaction((tx) =>
        appendStoredThreadEventInTransaction(tx, {
          threadId: fixture.threadId,
          environmentId: fixture.environmentId,
          scope: threadScope(),
          type: "client/turn/requested",
          data: {
            direction: "outbound",
            source: "tell",
            initiator: "user",
            senderThreadId: null,
            requestId: fixture.pendingRequestId,
            input: [
              {
                type: "text",
                text: "Then update the docs and rerun the targeted tests.",
                mentions: [],
              },
            ],
            target: { kind: "new-turn" },
            request: { method: "turn/start", params: {} },
            execution: {
              model: "gpt-5",
              reasoningLevel: "medium",
              permissionMode: "full",
              source: "client/turn/requested",
              serviceTier: "default",
            },
          },
        }),
      ),
  },
  {
    name: `${EVENTS}#appendStoredThreadEventsInTransaction`,
    run: (db, fixture) => startPendingTurn(db, fixture),
  },
  {
    name: `${EVENTS}#appendStoredThreadEvent`,
    run: (db, fixture) =>
      appendStoredThreadEvent(db, noopNotifier, {
        threadId: fixture.threadId,
        environmentId: fixture.environmentId,
        scope: threadScope(),
        type: "system/thread/interrupted",
        data: { reason: "manual-stop" },
      }),
  },
  {
    name: `${EVENTS}#listLatestThreadStateEventRowsByThreadIds`,
    run: (db, fixture) =>
      listLatestThreadStateEventRowsByThreadIds(db, {
        kind: THREAD_SESSION_OPTIONS_STATE_KIND,
        threadIds: allThreadIds(fixture),
      }),
  },
  {
    name: `${EVENTS}#listStoredTurnStartedKeys`,
    run: (db, fixture) =>
      listStoredTurnStartedKeys(db, { keys: batchTurnKeys(fixture) }),
  },
  {
    name: `${EVENTS}#listStoredTurnCompletedKeys`,
    run: (db, fixture) =>
      listStoredTurnCompletedKeys(db, { keys: batchTurnKeys(fixture) }),
  },
  {
    name: `${EVENTS}#listStoredConversationOutlineEventRows`,
    ceilingMs: 750,
    reason:
      "Known linear cost: returns every outline row since the last context clear (60,000 at 10,000 turns); only cold outline loads and message lookups read it",
    run: (db, fixture) =>
      listStoredConversationOutlineEventRows(db, {
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listStoredRootConversationOutlineEventRows`,
    ceilingMs: 750,
    reason:
      "Known linear cost: returns every outline row since the last context clear (60,000 at 10,000 turns); only cold outline loads and message lookups read it",
    run: (db, fixture) =>
      listStoredRootConversationOutlineEventRows(db, {
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#listContextWindowUsageRows`,
    run: (db, fixture) =>
      listContextWindowUsageRows(db, {
        sequenceStart: 0,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#resolveStoredProviderSessions`,
    run: (db, fixture) =>
      resolveStoredProviderSessions(db, { threadIds: allThreadIds(fixture) }),
  },
  {
    name: `${EVENTS}#getStoredProviderSession`,
    run: (db, fixture) => getStoredProviderSession(db, fixture.threadId),
  },
  {
    name: `${EVENTS}#getLastStoredProviderThreadId`,
    run: (db, fixture) => getLastStoredProviderThreadId(db, fixture.threadId),
  },
  {
    name: `${EVENTS}#classifyStoredProviderThreadClaim`,
    run: (db, fixture) =>
      classifyStoredProviderThreadClaim(db, {
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#getContextWindowUsagePruningBoundarySequence`,
    run: (db, fixture) =>
      getContextWindowUsagePruningBoundarySequence(db, fixture.threadId),
  },
  {
    name: `${EVENTS}#pruneContextWindowUsageEventsInTransaction`,
    prepare: (db, fixture) =>
      selectPruningWindow(db, fixture, "thread/contextWindowUsage/updated"),
    run: (db) =>
      db.transaction((tx) =>
        pruneContextWindowUsageEventsInTransaction(tx, selectedPruningWindow()),
      ),
  },
  {
    name: `${EVENTS}#pruneTokenUsageEventsInTransaction`,
    prepare: (db, fixture) =>
      selectPruningWindow(db, fixture, "thread/tokenUsage/updated"),
    run: (db) =>
      db.transaction((tx) =>
        pruneTokenUsageEventsInTransaction(tx, selectedPruningWindow()),
      ),
  },
  {
    name: `${EVENTS}#findStoredEditMessageOperationRow`,
    run: (db, fixture) =>
      findStoredEditMessageOperationRow(db, {
        operationId: "edit-operation-not-yet-committed",
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#findLatestEditableUserTurnRequestRow`,
    run: (db, fixture) =>
      findLatestEditableUserTurnRequestRow(db, {
        beforeSequence: null,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredThreadInterruptedSince`,
    run: (db, fixture) =>
      hasStoredThreadInterruptedSince(db, {
        createdAt: Date.now() - 60_000,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredProviderTurnCompletedSince`,
    run: (db, fixture) =>
      hasStoredProviderTurnCompletedSince(db, {
        createdAt: Date.now() - 60_000,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${EVENTS}#hasStoredCancelledThreadProvisioning`,
    run: (db, fixture) =>
      hasStoredCancelledThreadProvisioning(db, {
        environmentId: fixture.environmentId,
        provisioningId: "provisioning-in-flight",
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${THREADS}#listTurnStartDeadlineCandidates`,
    prepare: markThreadAwaitingTurnStart,
    run: (db) =>
      listTurnStartDeadlineCandidates(db, {
        deadline: Date.now() - TURN_START_DEADLINE_MS,
      }),
  },
  {
    name: `${THREADS}#isThreadAwaitingTurnStartPastDeadline`,
    prepare: markThreadAwaitingTurnStart,
    run: (db, fixture) =>
      isThreadAwaitingTurnStartPastDeadline(db, {
        deadline: Date.now() - TURN_START_DEADLINE_MS,
        threadId: fixture.threadId,
      }),
  },
  ...LIVE_TURN_COST_CASES,
];
