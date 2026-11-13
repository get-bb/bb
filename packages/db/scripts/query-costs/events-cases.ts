import { turnScope, type ThreadEventType } from "@bb/domain";
import type { DbConnection } from "../../src/connection.js";
import {
  advanceTimelineWindowBudgetFloorSequence,
  appendStoredThreadEventsInTransaction,
  deleteThreadEventSuffixInTransaction,
  findLastCompletedRootStoredTurn,
  findLastRootStoredTurnStarted,
  findLatestUnresolvedClientTurnRequestIdAfterSequence,
  findStoredEventRow,
  findStoredTimelineWindowByteBudgetFloor,
  findTimelineWindowBudgetFloorSequence,
  getActiveStoredTurnId,
  getFirstParentedTimelineBoundarySequence,
  getHighWaterMarks,
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
  isTimelineCursorSequencePresent,
  listActiveBackgroundTaskCountsByThreadIds,
  listAppendedEventRows,
  listCommandItemDataByItemIds,
  listEvents,
  listItemEventSpansByItems,
  listLatestBackgroundTaskStateRowsByItemIds,
  listLatestOpenBackgroundTaskStateRowsForThread,
  listLatestTurnFinalAgentMessageEventRows,
  listOpenBackgroundTaskItemRowsForHost,
  listOpenBackgroundTaskItemRowsForThread,
  listOpenTurnInputAcceptedRowsByThreadIds,
  listOwnerStoppedBackgroundTaskRowsForHost,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredClientTurnRequestIdsInRange,
  listStoredClientTurnRequestRowsByKeys,
  listStoredDelegatingItemRowsByItemIds,
  listStoredEventRowMetadata,
  listStoredEventRows,
  listStoredEventRowsByParentToolCallIds,
  listStoredEventRowsInSequenceRange,
  listStoredItemLifecycleRowsByItems,
  listStoredTaskTurnRequestEvents,
  listStoredTimelineThreadWindowEventRows,
  listStoredTimelineTurnEventRows,
  listStoredTimelineWindowEventRows,
  listStoredTurnCompletedRowsByTurnIds,
  listStoredTurnInputAcceptedRowsByClientRequestIds,
  listStoredTurnRejectedRowsByClientRequestIds,
  listStoredTurnStartedRowsByTurnIdsUpToSequence,
  listThreadEventSuffixBackgroundSettlementRows,
  listThreadIdsStoppedSinceLastTurnStart,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  listThreadTurnInterruptionEventStates,
  listTimelineInterruptionRows,
  listTimelineOrderingContext,
  listTimelineRootWindowTurnIds,
  listTimelineWindowHintsDescending,
  listTodoSnapshotEventRowsForThread,
  wouldRemoveSharedProviderSessionClaim,
  type ScopedItemRef,
} from "../../src/data/events.js";
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
    name: `${EVENTS}#listEvents`,
    ceilingMs: 2_000,
    reason: "Returns every row of the thread by design; only tests call it",
    run: (db, fixture) => listEvents(db, { threadId: fixture.threadId }),
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
    ceilingMs: 500,
    reason:
      "Known linear cost: a cold timeline open reads four rows per turn and checks each request's visible input with json_each; the grouping-context cache serves later opens",
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
];
