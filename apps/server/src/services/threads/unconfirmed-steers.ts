import {
  getThread,
  hasStoredTerminalClientTurnRequestEvent,
  type DbTransaction,
} from "@bb/db";
import { threadScope, type ClientTurnRequestId } from "@bb/domain";
import { STEER_UNCONFIRMED_ERROR_CODE } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import {
  appendThreadEvent,
  appendThreadEventInTransaction,
  getActiveTurnId,
} from "./thread-events.js";

const UNCONFIRMED_STEER_MESSAGE =
  "The turn ended before the agent confirmed this steer";

const unconfirmedSteerRequestIdsByThreadId = new Map<
  string,
  Set<ClientTurnRequestId>
>();

interface SettleUnconfirmedSteerArgs {
  requestId: ClientTurnRequestId;
  threadId: string;
}

function unconfirmedSteerRejection(args: {
  environmentId: string | null;
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
      reason: STEER_UNCONFIRMED_ERROR_CODE,
      message: UNCONFIRMED_STEER_MESSAGE,
    },
  };
}

export function settleUnconfirmedSteerInTransaction(
  db: DbTransaction,
  args: SettleUnconfirmedSteerArgs,
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
    unconfirmedSteerRejection({
      environmentId: thread.environmentId,
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
      unconfirmedSteerRejection({
        environmentId: thread.environmentId,
        requestId,
        threadId,
      }),
    );
  }
}
