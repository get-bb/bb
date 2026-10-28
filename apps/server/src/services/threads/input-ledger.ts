import {
  createSubmittedQueuedThreadMessageInTransaction,
  deleteSubmittedQueuedThreadMessagesInTransaction,
  getThread,
  listSubmittedQueuedThreadMessageRequests,
  returnSubmittedQueuedThreadMessagesInTransaction,
  submitClaimedQueuedThreadMessageBatchInTransaction,
  type ClaimedQueuedThreadMessageRow,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import type { ClientTurnRequestId, ThreadStatus } from "@bb/domain";
import type { AppDeps, ServerLogger } from "../../types.js";
import type { QueuedDispatchMessage } from "./queue-waits.js";
import { loadFailedTurn } from "./turn-failed.js";

export const SUBMITTED_INPUT_SETTLE_MS = 60_000;

type InputLedgerTransactionDeps = {
  db: DbTransaction;
  hub: Pick<AppDeps["hub"], "notifyThread">;
  logger: ServerLogger;
};

interface SubmittedInputRequest {
  requestId: string;
  threadId: string;
}

const liveTurnRequestIds = new Set<string>();

export function trackLiveTurnRequest(requestId: ClientTurnRequestId): void {
  liveTurnRequestIds.add(requestId);
}

export function untrackLiveTurnRequest(requestId: ClientTurnRequestId): void {
  liveTurnRequestIds.delete(requestId);
}

export function submitClaimedInputsInTransaction(
  tx: DbTransaction,
  args: {
    claimed: readonly ClaimedQueuedThreadMessageRow[];
    requestId: ClientTurnRequestId;
  },
): boolean {
  return submitClaimedQueuedThreadMessageBatchInTransaction(tx, {
    queuedMessages: args.claimed,
    requestId: args.requestId,
  });
}

export function submitInlineInputInTransaction(
  tx: DbTransaction,
  args: {
    message: QueuedDispatchMessage;
    requestId: ClientTurnRequestId;
    threadId: string;
  },
): void {
  if (args.message.input.length === 0) return;
  createSubmittedQueuedThreadMessageInTransaction(tx, {
    threadId: args.threadId,
    content: args.message.input,
    senderThreadId: args.message.senderThreadId,
    origin: args.message.origin,
    originPluginId: args.message.originPluginId,
    requestedBy: args.message.requestedBy,
    model: args.message.execution.model,
    reasoningLevel: args.message.execution.reasoningLevel,
    permissionMode: args.message.execution.permissionMode,
    serviceTier: args.message.execution.serviceTier,
    payload: args.message.payload,
    systemNotice: args.message.systemNotice,
    deliveryMode: args.message.deliveryMode,
    requestId: args.requestId,
  });
}

export function acceptSubmittedInputsInTransaction(
  deps: { db: DbTransaction; logger: ServerLogger },
  args: SubmittedInputRequest,
): void {
  const accepted = deleteSubmittedQueuedThreadMessagesInTransaction(
    deps.db,
    args,
  );
  if (accepted.length === 0) return;
  deps.logger.info(
    {
      queuedMessageIds: accepted.map((row) => row.id),
      requestId: args.requestId,
      threadId: args.threadId,
    },
    "Provider accepted submitted input",
  );
}

export function returnSubmittedInputsInTransaction(
  deps: InputLedgerTransactionDeps,
  args: SubmittedInputRequest & { reason: string },
): number {
  const returned = returnSubmittedQueuedThreadMessagesInTransaction(deps.db, {
    requestId: args.requestId,
    threadId: args.threadId,
    waitingOn: { kind: "thread-busy" },
  });
  if (returned.length === 0) return 0;
  deps.logger.info(
    {
      queuedMessageIds: returned.map((row) => row.id),
      reason: args.reason,
      requestId: args.requestId,
      threadId: args.threadId,
    },
    "Returned submitted input to the queue",
  );
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
  return returned.length;
}

export function handOffFailedTurnInputsInTransaction(
  deps: { db: DbTransaction; logger: ServerLogger },
  args: { threadId: string },
): void {
  const failed = loadFailedTurn(deps.db, args.threadId);
  if (failed === null) return;
  const handedOff = deleteSubmittedQueuedThreadMessagesInTransaction(deps.db, {
    requestId: failed.request.requestId,
    threadId: args.threadId,
  });
  if (handedOff.length === 0) return;
  deps.logger.info(
    {
      queuedMessageIds: handedOff.map((row) => row.id),
      requestId: failed.request.requestId,
      threadId: args.threadId,
    },
    "Submitted input is now owned by the failed turn",
  );
}

const RUNNING_THREAD_STATUSES: readonly ThreadStatus[] = [
  "starting",
  "active",
  "stopping",
];

export function returnUnsettledSubmittedInputs(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  now: number,
): number {
  const candidates = listSubmittedQueuedThreadMessageRequests(deps.db, {
    submittedBefore: now - SUBMITTED_INPUT_SETTLE_MS,
  }).filter((request) => !liveTurnRequestIds.has(request.requestId));
  let returned = 0;
  for (const request of candidates) {
    returned += returnSubmittedInputsIfThreadSettled(deps, request);
  }
  return returned;
}

function returnSubmittedInputsIfThreadSettled(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  request: SubmittedInputRequest,
): number {
  return transaction(deps.db, (tx) => {
    const thread = getThread(tx, request.threadId);
    if (thread === null || RUNNING_THREAD_STATUSES.includes(thread.status)) {
      return 0;
    }
    return returnSubmittedInputsInTransaction(
      { db: tx, hub: deps.hub, logger: deps.logger },
      { ...request, reason: "unsettled-after-run" },
    );
  });
}

function transaction<T>(db: DbConnection, work: (tx: DbTransaction) => T): T {
  return db.transaction(work, { behavior: "immediate" });
}
