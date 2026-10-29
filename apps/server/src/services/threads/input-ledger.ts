import {
  createSubmittedQueuedThreadMessageInTransaction,
  deleteReturnedQueuedThreadMessagesInTransaction,
  deleteSubmittedQueuedThreadMessagesInTransaction,
  getThread,
  listSubmittedQueuedThreadMessageRequests,
  listSubmittedQueuedThreadMessages,
  moveSubmittedQueuedThreadMessagesInTransaction,
  returnSubmittedQueuedThreadMessagesInTransaction,
  submitClaimedQueuedThreadMessageBatchInTransaction,
  type ClaimedQueuedThreadMessageRow,
  type QueuedThreadMessageRow,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import {
  promptInputSchema,
  type ClientTurnRequestId,
  type ThreadStatus,
} from "@bb/domain";
import { z } from "zod";
import type { AppDeps, ServerLogger } from "../../types.js";
import type { QueuedDispatchMessage } from "./queue-waits.js";
import { loadFailedTurn, retryChain } from "./turn-failed.js";
import { resolveDeferredFirstTurnContext } from "./deferred-first-turn-context.js";
import type { TurnRequestDelivery } from "./turn-request-delivery.js";

export const SUBMITTED_INPUT_SETTLE_MS = 60_000;

const UNSENT_INPUT_REASON =
  "Not sent: the provider did not accept this message before its turn ended.";

type InputLedgerTransactionDeps = {
  db: DbTransaction;
  hub: Pick<AppDeps["hub"], "notifyThread">;
  logger: ServerLogger;
};

type InputLedgerDeliveryDeps = InputLedgerTransactionDeps & {
  delivery: TurnRequestDelivery;
};

interface SubmittedInputRequest {
  requestId: string;
  threadId: string;
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
  deps: InputLedgerDeliveryDeps,
  args: SubmittedInputRequest,
): void {
  deps.delivery.accepted(args.requestId);
  const accepted = [
    ...deleteSubmittedQueuedThreadMessagesInTransaction(deps.db, args),
    ...deleteReturnedQueuedThreadMessagesInTransaction(deps.db, args),
  ];
  if (accepted.length === 0) return;
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
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
  args: SubmittedInputRequest & {
    reason: string;
    returnAs: "queued" | "unsent";
  },
): number {
  const returned = returnSubmittedQueuedThreadMessagesInTransaction(deps.db, {
    requestId: args.requestId,
    threadId: args.threadId,
    outcome:
      args.returnAs === "queued"
        ? { kind: "waiting", waitingOn: { kind: "thread-busy" } }
        : { kind: "failed", failureReason: UNSENT_INPUT_REASON },
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

export function settleSupersededFailedTurnInputsInTransaction(
  deps: InputLedgerDeliveryDeps,
  args: {
    requestId: ClientTurnRequestId;
    retryOfRequestId: string | null;
    threadId: string;
  },
): void {
  if (getThread(deps.db, args.threadId)?.status !== "error") return;
  const failed = loadFailedTurn(deps.db, args.threadId);
  if (failed === null) return;
  const request = {
    requestId: failed.request.requestId,
    threadId: args.threadId,
  };
  const retriesFailedTurn =
    args.retryOfRequestId !== null &&
    retryChain(failed.request).originalRequestId === args.retryOfRequestId;
  if (
    !retriesFailedTurn &&
    resolveDeferredFirstTurnContext(deps.db, args.threadId, deps.delivery) !==
      null
  ) {
    const carried = moveSubmittedQueuedThreadMessagesInTransaction(deps.db, {
      ...request,
      ids: listSubmittedQueuedThreadMessages(deps.db, request)
        .filter(isAgentOnlyRow)
        .map((row) => row.id),
      toRequestId: args.requestId,
    });
    if (carried.length > 0) {
      deps.logger.info(
        {
          ...request,
          queuedMessageIds: carried.map((row) => row.id),
          toRequestId: args.requestId,
        },
        "The next request carries the failed turn's undelivered input",
      );
    }
  }
  if (deps.delivery.mayStillBeAccepted(failed.request.requestId)) return;
  if (retriesFailedTurn) {
    const replaced = [
      ...deleteSubmittedQueuedThreadMessagesInTransaction(deps.db, request),
      ...deleteReturnedQueuedThreadMessagesInTransaction(deps.db, request),
    ];
    if (replaced.length > 0) {
      deps.logger.info(
        { ...request, queuedMessageIds: replaced.map((row) => row.id) },
        "A replacement request carries the failed turn's submitted input",
      );
    }
    return;
  }
  returnSubmittedInputsInTransaction(deps, {
    ...request,
    reason: "failed-turn-superseded",
    returnAs: "unsent",
  });
}

export function isSupersededTurnRequest(
  db: DbTransaction,
  request: SubmittedInputRequest,
): boolean {
  const latest = loadFailedTurn(db, request.threadId);
  return latest !== null && latest.request.requestId !== request.requestId;
}

const storedPromptInputSchema = z.array(promptInputSchema);

function isAgentOnlyRow(row: QueuedThreadMessageRow): boolean {
  return storedPromptInputSchema
    .parse(JSON.parse(row.content))
    .every((item) => item.visibility === "agent-only");
}

function isRetryableFailedTurnRequest(
  db: DbTransaction,
  request: SubmittedInputRequest,
): boolean {
  return (
    getThread(db, request.threadId)?.status === "error" &&
    loadFailedTurn(db, request.threadId)?.request.requestId ===
      request.requestId
  );
}

const RUNNING_THREAD_STATUSES: readonly ThreadStatus[] = [
  "starting",
  "active",
  "stopping",
];

export function returnUnsettledSubmittedInputs(
  deps: Pick<AppDeps, "db" | "hub" | "lifecycleDedupers" | "logger">,
  now: number,
): number {
  const delivery = deps.lifecycleDedupers.turnRequestDelivery;
  const candidates = listSubmittedQueuedThreadMessageRequests(deps.db, {
    submittedBefore: now - SUBMITTED_INPUT_SETTLE_MS,
  }).filter((request) => !delivery.mayStillBeAccepted(request.requestId));
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
    if (
      thread === null ||
      RUNNING_THREAD_STATUSES.includes(thread.status) ||
      isRetryableFailedTurnRequest(tx, request)
    ) {
      return 0;
    }
    return returnSubmittedInputsInTransaction(
      { db: tx, hub: deps.hub, logger: deps.logger },
      { ...request, reason: "unsettled-after-run", returnAs: "unsent" },
    );
  });
}

function transaction<T>(db: DbConnection, work: (tx: DbTransaction) => T): T {
  return db.transaction(work, { behavior: "immediate" });
}
