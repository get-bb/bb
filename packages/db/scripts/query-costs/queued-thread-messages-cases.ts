import { inArray } from "drizzle-orm";
import type { DbConnection } from "../../src/connection.js";
import {
  claimNextQueuedThreadMessageGroup,
  createQueuedThreadMessage,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessageBatchInTransaction,
  deleteCoalescedQueuedThreadMessageInTransaction,
  deleteQueuedRetriesForThreadEventSuffixInTransaction,
  deleteQueuedThreadMessage,
  getFirstUnclaimedQueuedRetry,
  getPendingCoalescedQueuedThreadMessage,
  getQueuedThreadMessage,
  getQueuedThreadStartMessage,
  hasClaimedQueuedThreadMessages,
  hasLiveQueuedRetry,
  hasQueuedRetryOfTurnRequest,
  holdQueuedThreadMessageForEdit,
  listDueScheduledQueuedThreadMessages,
  listIdleThreadsWithQueuedMessages,
  listQueuedThreadMessageCountsByThreadIds,
  listQueuedThreadMessagePluginWaitRefs,
  listQueuedThreadMessages,
  listQueuedThreadMessagesByWaitHolder,
  listQueuedThreadMessagesForApi,
  listQueuedThreadMessagesWaitingOnKind,
  listReadySystemNoticesOnBusyThreads,
  listRetryableFailedQueuedThreadMessages,
  listThreadIdsWithAppUpdateQueueWaits,
  listThreadIdsWithHostOfflineQueueWaits,
  moveQueuedThreadMessageToFrontInTransaction,
  releaseQueuedThreadMessageEditHold,
  releaseStaleQueuedMessageClaims,
  reorderQueuedThreadMessage,
  setQueuedThreadMessageFailureReason,
  setQueuedThreadMessageGroupBoundary,
  supersedeQueuedRetriesInTransaction,
  updateCoalescedQueuedThreadMessageInTransaction,
  updateQueuedThreadMessage,
  type ClaimedQueuedThreadMessageRow,
  type CreateQueuedThreadMessageInput,
  type QueuedThreadMessageRow,
} from "../../src/data/queued-thread-messages.js";
import { noopNotifier } from "../../src/notifier.js";
import { threads } from "../../src/schema.js";
import type { QueryCostCase } from "./case.js";
import type { HistoryFixture, HistoryTurn } from "./fixture.js";

const QUEUED = "packages/db/src/data/queued-thread-messages.ts";
const QUEUE_DEPTH = 20;
const NEIGHBOR_QUEUE_DEPTH = 3;
const COALESCE_KEY = "child-outcomes";
const PLUGIN_WAIT_HOLDER = "plugin:github-pr-status";

const EXECUTION = {
  model: "gpt-5",
  reasoningLevel: "medium",
  permissionMode: "full" as const,
  serviceTier: "default",
};

type QueueRowOverrides = Partial<
  Omit<CreateQueuedThreadMessageInput, "threadId">
>;

function enqueue(
  db: DbConnection,
  threadId: string,
  overrides: QueueRowOverrides = {},
): QueuedThreadMessageRow {
  return createQueuedThreadMessage(db, noopNotifier, {
    ...EXECUTION,
    threadId,
    content: [
      { type: "text", text: "Then rerun the full suite.", mentions: [] },
    ],
    waitingOn: null,
    sendAt: null,
    payload: { kind: "inline" },
    systemNotice: null,
    ...overrides,
  });
}

function fillQueues(
  db: DbConnection,
  fixture: HistoryFixture,
  overrides: QueueRowOverrides = {},
): QueuedThreadMessageRow[] {
  const rows: QueuedThreadMessageRow[] = [];
  for (let index = 0; index < QUEUE_DEPTH; index += 1) {
    rows.push(enqueue(db, fixture.threadId, overrides));
  }
  for (const threadId of fixture.neighborThreadIds) {
    for (let index = 0; index < NEIGHBOR_QUEUE_DEPTH; index += 1) {
      rows.push(enqueue(db, threadId, overrides));
    }
  }
  return rows;
}

function markThreadsBusy(db: DbConnection, threadIds: readonly string[]): void {
  db.update(threads)
    .set({ status: "active" })
    .where(inArray(threads.id, [...threadIds]))
    .run();
}

function allThreadIds(fixture: HistoryFixture): string[] {
  return [fixture.threadId, ...fixture.neighborThreadIds];
}

function firstTurn(fixture: HistoryFixture): HistoryTurn {
  const turn = fixture.turns[0];
  if (turn === undefined) throw new Error("Expected history turns");
  return turn;
}

function claimLeadGroup(
  db: DbConnection,
  fixture: HistoryFixture,
): ClaimedQueuedThreadMessageRow[] {
  fillQueues(db, fixture);
  const prefix = listQueuedThreadMessages(db, fixture.threadId)
    .slice(0, 5)
    .map((row) => row.id);
  const boundary = prefix.at(-1);
  if (boundary === undefined) {
    throw new Error("Expected queued rows to group");
  }
  setQueuedThreadMessageGroupBoundary({
    db,
    notifier: noopNotifier,
    threadId: fixture.threadId,
    expectedGroupedPrefixQueuedMessageIds: prefix,
    groupBoundaryQueuedMessageId: boundary,
  });
  const claimed = claimNextQueuedThreadMessageGroup(
    db,
    noopNotifier,
    fixture.threadId,
    () => true,
  );
  if (claimed === null || claimed.length !== prefix.length) {
    throw new Error("Expected to claim the lead group");
  }
  return claimed;
}

function requireRow(db: DbConnection, id: string): QueuedThreadMessageRow {
  const row = getQueuedThreadMessage(db, id);
  if (row === null) throw new Error(`Expected queued message ${id}`);
  return row;
}

let claimedGroup: ClaimedQueuedThreadMessageRow[] = [];
let coalescedRow: QueuedThreadMessageRow | null = null;
let frontCandidate: QueuedThreadMessageRow | null = null;
let queuedMessageUpdatedAt = 0;

function requireCoalescedRow(): QueuedThreadMessageRow {
  if (coalescedRow === null) throw new Error("Expected a coalesced row");
  return coalescedRow;
}

function prepareCoalescedRow(db: DbConnection, fixture: HistoryFixture): void {
  fillQueues(db, fixture);
  coalescedRow = enqueue(db, fixture.threadId, {
    waitingOn: { kind: "time" },
    sendAt: Date.now() + 60_000,
    systemNotice: { kind: "child-outcome-batch", subject: null },
    coalesce: { key: COALESCE_KEY, state: "[]" },
  });
}

export const QUEUED_THREAD_MESSAGES_COST_CASES: readonly QueryCostCase[] = [
  {
    name: `${QUEUED}#supersedeQueuedRetriesInTransaction`,
    run: (db, fixture) =>
      db.transaction((tx) =>
        supersedeQueuedRetriesInTransaction(tx, {
          threadId: fixture.threadId,
          retryOfTurnRequestId: null,
        }),
      ),
  },
  {
    name: `${QUEUED}#deleteQueuedRetriesForThreadEventSuffixInTransaction`,
    run: (db, fixture) =>
      db.transaction((tx) =>
        deleteQueuedRetriesForThreadEventSuffixInTransaction(tx, {
          cutoffSequence: firstTurn(fixture).requestSequence,
          oldMaxSequence: fixture.latestSequence,
          threadId: fixture.threadId,
        }),
      ),
  },
  {
    name: `${QUEUED}#listIdleThreadsWithQueuedMessages`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db) => listIdleThreadsWithQueuedMessages(db),
  },
  {
    name: `${QUEUED}#listReadySystemNoticesOnBusyThreads`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, {
        systemNotice: { kind: "child-completed", subject: null },
      });
      markThreadsBusy(db, allThreadIds(fixture));
    },
    run: (db) => listReadySystemNoticesOnBusyThreads(db),
  },
  {
    name: `${QUEUED}#listQueuedThreadMessages`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) => listQueuedThreadMessages(db, fixture.threadId),
  },
  {
    name: `${QUEUED}#getQueuedThreadStartMessage`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) => getQueuedThreadStartMessage(db, fixture.threadId),
  },
  {
    name: `${QUEUED}#createQueuedThreadMessageInTransaction`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) =>
      db.transaction((tx) =>
        createQueuedThreadMessageInTransaction(tx, {
          ...EXECUTION,
          threadId: fixture.threadId,
          content: [
            { type: "text", text: "Also check the migration.", mentions: [] },
          ],
          senderThreadId: null,
          waitingOn: { kind: "thread-busy" },
          sendAt: null,
          payload: { kind: "inline" },
          systemNotice: null,
          deliveryMode: "queue",
        }),
      ),
  },
  {
    name: `${QUEUED}#getPendingCoalescedQueuedThreadMessage`,
    prepare: prepareCoalescedRow,
    run: (db, fixture) =>
      getPendingCoalescedQueuedThreadMessage(db, {
        coalesceKey: COALESCE_KEY,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${QUEUED}#updateCoalescedQueuedThreadMessageInTransaction`,
    prepare: prepareCoalescedRow,
    run: (db, fixture) =>
      db.transaction((tx) =>
        updateCoalescedQueuedThreadMessageInTransaction(tx, {
          id: requireCoalescedRow().id,
          threadId: fixture.threadId,
          content: [
            { type: "text", text: "Two child threads finished.", mentions: [] },
          ],
          systemNotice: { kind: "child-outcome-batch", subject: null },
          coalesceState: "[1,2]",
          windowEndsAt: Date.now() + 60_000,
        }),
      ),
  },
  {
    name: `${QUEUED}#deleteCoalescedQueuedThreadMessageInTransaction`,
    prepare: prepareCoalescedRow,
    run: (db) =>
      db.transaction((tx) =>
        deleteCoalescedQueuedThreadMessageInTransaction(
          tx,
          requireCoalescedRow(),
        ),
      ),
  },
  {
    name: `${QUEUED}#updateQueuedThreadMessage`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
      queuedMessageUpdatedAt = requireRow(
        db,
        fixture.queuedMessageId,
      ).updatedAt;
    },
    run: (db, fixture) =>
      updateQueuedThreadMessage(db, noopNotifier, {
        id: fixture.queuedMessageId,
        threadId: fixture.threadId,
        content: [
          { type: "text", text: "Then update the changelog.", mentions: [] },
        ],
        execution: { ...EXECUTION, reasoningLevel: "high" },
        reschedule: { sendAt: Date.now() + 60_000 },
        expectedUpdatedAt: queuedMessageUpdatedAt,
      }),
  },
  {
    name: `${QUEUED}#holdQueuedThreadMessageForEdit`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) =>
      holdQueuedThreadMessageForEdit(db, {
        id: fixture.queuedMessageId,
        threadId: fixture.threadId,
        heldUntil: Date.now() + 60_000,
      }),
  },
  {
    name: `${QUEUED}#releaseQueuedThreadMessageEditHold`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
      holdQueuedThreadMessageForEdit(db, {
        id: fixture.queuedMessageId,
        threadId: fixture.threadId,
        heldUntil: Date.now() + 60_000,
      });
    },
    run: (db, fixture) =>
      releaseQueuedThreadMessageEditHold(db, {
        id: fixture.queuedMessageId,
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${QUEUED}#getQueuedThreadMessage`,
    run: (db, fixture) => getQueuedThreadMessage(db, fixture.queuedMessageId),
  },
  {
    name: `${QUEUED}#hasClaimedQueuedThreadMessages`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) => hasClaimedQueuedThreadMessages(db, fixture.threadId),
  },
  {
    name: `${QUEUED}#reorderQueuedThreadMessage`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) =>
      reorderQueuedThreadMessage({
        db,
        notifier: noopNotifier,
        threadId: fixture.threadId,
        queuedMessageId: fixture.queuedMessageId,
        previousQueuedMessageId: null,
        nextQueuedMessageId: fixture.queuedRetryId,
      }),
  },
  {
    name: `${QUEUED}#releaseStaleQueuedMessageClaims`,
    prepare: (db, fixture) => {
      claimLeadGroup(db, fixture);
    },
    run: (db) =>
      releaseStaleQueuedMessageClaims(db, noopNotifier, {
        claimedBefore: Date.now() + 1,
        protectedClaimTokens: [],
      }),
  },
  {
    name: `${QUEUED}#deleteClaimedQueuedThreadMessageBatchInTransaction`,
    prepare: (db, fixture) => {
      claimedGroup = claimLeadGroup(db, fixture);
    },
    run: (db) =>
      db.transaction((tx) =>
        deleteClaimedQueuedThreadMessageBatchInTransaction(tx, {
          queuedMessages: claimedGroup.map(({ id, claimToken }) => ({
            id,
            claimToken,
          })),
        }),
      ),
  },
  {
    name: `${QUEUED}#listQueuedThreadMessagesForApi`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db) => listQueuedThreadMessagesForApi(db, {}),
  },
  {
    name: `${QUEUED}#listQueuedThreadMessageCountsByThreadIds`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) =>
      listQueuedThreadMessageCountsByThreadIds(db, {
        threadIds: allThreadIds(fixture),
      }),
  },
  {
    name: `${QUEUED}#listRetryableFailedQueuedThreadMessages`,
    prepare: (db, fixture) => {
      const failedAt = Date.now() - 60_000;
      for (const row of fillQueues(db, fixture)) {
        setQueuedThreadMessageFailureReason(db, noopNotifier, {
          id: row.id,
          threadId: row.threadId,
          failureReason: "Provider is still loading",
          now: failedAt,
          retryDelaysMs: [5_000, 30_000],
        });
      }
    },
    run: (db) => listRetryableFailedQueuedThreadMessages(db, Date.now()),
  },
  {
    name: `${QUEUED}#listDueScheduledQueuedThreadMessages`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, {
        waitingOn: { kind: "time" },
        sendAt: Date.now() - 1_000,
      });
    },
    run: (db) => listDueScheduledQueuedThreadMessages(db, Date.now()),
  },
  {
    name: `${QUEUED}#listQueuedThreadMessagesByWaitHolder`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, {
        waitingOn: {
          kind: "plugin",
          pluginId: "github-pr-status",
          reason: "Waiting for CI",
        },
      });
    },
    run: (db) => listQueuedThreadMessagesByWaitHolder(db, PLUGIN_WAIT_HOLDER),
  },
  {
    name: `${QUEUED}#listQueuedThreadMessagePluginWaitRefs`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, {
        waitingOn: {
          kind: "plugin",
          pluginId: "github-pr-status",
          reason: "Waiting for CI",
        },
      });
    },
    run: (db) => listQueuedThreadMessagePluginWaitRefs(db),
  },
  {
    name: `${QUEUED}#listQueuedThreadMessagesWaitingOnKind`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, { waitingOn: { kind: "turn-starting" } });
    },
    run: (db, fixture) =>
      listQueuedThreadMessagesWaitingOnKind(db, {
        threadId: fixture.threadId,
        kind: "turn-starting",
      }),
  },
  {
    name: `${QUEUED}#hasQueuedRetryOfTurnRequest`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) =>
      hasQueuedRetryOfTurnRequest(db, {
        threadId: fixture.threadId,
        retryOfTurnRequestId: fixture.pendingRequestId,
      }),
  },
  {
    name: `${QUEUED}#hasLiveQueuedRetry`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) => hasLiveQueuedRetry(db, fixture.threadId),
  },
  {
    name: `${QUEUED}#moveQueuedThreadMessageToFrontInTransaction`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
      frontCandidate = enqueue(db, fixture.threadId, {
        waitingOn: { kind: "thread-busy" },
      });
    },
    run: (db) =>
      db.transaction((tx) => {
        if (frontCandidate === null) {
          throw new Error("Expected a row to move to the front");
        }
        return moveQueuedThreadMessageToFrontInTransaction(tx, frontCandidate);
      }),
  },
  {
    name: `${QUEUED}#getFirstUnclaimedQueuedRetry`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) => getFirstUnclaimedQueuedRetry(db, fixture.threadId),
  },
  {
    name: `${QUEUED}#listThreadIdsWithHostOfflineQueueWaits`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, {
        waitingOn: { kind: "host-offline", hostName: "query-costs" },
      });
    },
    run: (db, fixture) =>
      listThreadIdsWithHostOfflineQueueWaits(db, fixture.hostId),
  },
  {
    name: `${QUEUED}#listThreadIdsWithAppUpdateQueueWaits`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture, { waitingOn: { kind: "app-update" } });
    },
    run: (db) => listThreadIdsWithAppUpdateQueueWaits(db),
  },
  {
    name: `${QUEUED}#deleteQueuedThreadMessage`,
    prepare: (db, fixture) => {
      fillQueues(db, fixture);
    },
    run: (db, fixture) =>
      deleteQueuedThreadMessage(db, noopNotifier, fixture.queuedMessageId),
  },
];
