import {
  findLastCompletedRootStoredTurn,
  getThread,
  hasStoredTerminalClientTurnRequestEvent,
  findLatestUnresolvedClientTurnRequestIdAfterSequence,
  type DbTransaction,
} from "@bb/db";
import { threadScope, type ClientTurnRequestId } from "@bb/domain";
import {
  STEER_UNCONFIRMED_ERROR_CODE,
  TURN_START_UNCONFIRMED_ERROR_CODE,
} from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import {
  appendThreadEvent,
  appendThreadEventInTransaction,
  getActiveTurnId,
} from "./thread-events.js";

const UNCONFIRMED_STEER_MESSAGE =
  "The turn ended before the agent confirmed this steer";
const UNSTARTED_TURN_MESSAGE = "The agent did not start a turn for this message";

type UnconfirmedRejectionReason =
  | typeof STEER_UNCONFIRMED_ERROR_CODE
  | typeof TURN_START_UNCONFIRMED_ERROR_CODE;

const unconfirmedSteerRequestIdsByThreadId = new Map<
  string,
  Set<ClientTurnRequestId>
>();

interface SettleUnconfirmedRequestArgs {
  requestId: ClientTurnRequestId;
  threadId: string;
}

function unconfirmedRejection(args: {
  environmentId: string | null;
  reason: UnconfirmedRejectionReason;
  requestId: ClientTurnRequestId;
  threadId: string;
}) {
  return {
    threadId: args.threadId,
    environmentId: args.environmentId,
    type: "client/turn/rejected" as const,
    scope: threadScope(),
    data: {
      requestId: args.requestId,
      reason: args.reason,
      message:
        args.reason === STEER_UNCONFIRMED_ERROR_CODE
          ? UNCONFIRMED_STEER_MESSAGE
          : UNSTARTED_TURN_MESSAGE,
    },
  };
}

export function settleUnconfirmedSteerInTransaction(
  db: DbTransaction,
  args: SettleUnconfirmedRequestArgs,
): void {
  const thread = getThread(db, args.threadId);
  if (!thread) {
    return;
  }
  if (getActiveTurnId({ db }, thread.id) !== null) {
    const requestIds =
      unconfirmedSteerRequestIdsByThreadId.get(thread.id) ?? new Set();
    requestIds.add(args.requestId);
    unconfirmedSteerRequestIdsByThreadId.set(thread.id, requestIds);
    return;
  }
  appendThreadEventInTransaction(
    db,
    unconfirmedRejection({
      environmentId: thread.environmentId,
      reason: STEER_UNCONFIRMED_ERROR_CODE,
      requestId: args.requestId,
      threadId: thread.id,
    }),
  );
}

export function rejectUnconfirmedSteersAfterTurnCompleted(
  deps: Pick<AppDeps, "db" | "hub">,
  threadId: string,
): void {
  const requestIds = unconfirmedSteerRequestIdsByThreadId.get(threadId);
  if (!requestIds) {
    return;
  }
  unconfirmedSteerRequestIdsByThreadId.delete(threadId);
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    return;
  }
  for (const requestId of requestIds) {
    if (
      hasStoredTerminalClientTurnRequestEvent(deps.db, { requestId, threadId })
    ) {
      continue;
    }
    appendThreadEvent(
      deps,
      unconfirmedRejection({
        environmentId: thread.environmentId,
        reason: STEER_UNCONFIRMED_ERROR_CODE,
        requestId,
        threadId,
      }),
    );
  }
}

export function settleUnconfirmedTurnStartInTransaction(
  db: DbTransaction,
  args: SettleUnconfirmedRequestArgs,
): void {
  const thread = getThread(db, args.threadId);
  if (!thread || thread.status === "active") {
    return;
  }
  appendThreadEventInTransaction(
    db,
    unconfirmedRejection({
      environmentId: thread.environmentId,
      reason: TURN_START_UNCONFIRMED_ERROR_CODE,
      requestId: args.requestId,
      threadId: thread.id,
    }),
  );
}

export function rejectUnstartedTurnRequest(
  deps: Pick<AppDeps, "db" | "hub">,
  threadId: string,
): void {
  const thread = getThread(deps.db, threadId);
  if (!thread) {
    return;
  }
  const lastCompletedTurn = findLastCompletedRootStoredTurn(deps.db, {
    threadId,
  });
  const requestId = findLatestUnresolvedClientTurnRequestIdAfterSequence(
    deps.db,
    {
      afterSequence: lastCompletedTurn?.completedSequence ?? 0,
      threadId,
    },
  );
  if (requestId === null) {
    return;
  }
  appendThreadEvent(
    deps,
    unconfirmedRejection({
      environmentId: thread.environmentId,
      reason: TURN_START_UNCONFIRMED_ERROR_CODE,
      requestId,
      threadId,
    }),
  );
}
