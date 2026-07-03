import {
  applyThreadLifecycleEvent,
  applyThreadLifecycleEventInTransaction,
  type ApplyThreadLifecycleEventArgs,
  type ApplyThreadLifecycleEventOutcome,
  type DbConnection,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import type { ServerLogger } from "../../types.js";
import { emitPluginThreadLifecycleOutcome } from "../plugins/plugin-thread-events.js";

interface ApplyLoggedThreadLifecycleEventDeps {
  db: DbConnection;
  hub: DbNotifier;
  logger: ServerLogger;
}

interface ApplyLoggedThreadLifecycleEventTransactionDeps {
  db: DbTransaction;
  logger: ServerLogger;
}

function logUnappliedThreadLifecycleEvent(
  logger: ServerLogger,
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (outcome.applied) {
    return;
  }
  logger.info(
    {
      detail: outcome.detail,
      event: args.event.type,
      reason: outcome.reason,
      threadId: args.threadId,
    },
    "Thread lifecycle event not applied",
  );
}

/**
 * Applies a thread lifecycle event in its own transaction (the db writer
 * notifies status-changed when applied) and logs every non-applied outcome so
 * stale events are observable instead of silently swallowed.
 */
export function applyLoggedThreadLifecycleEvent(
  deps: ApplyLoggedThreadLifecycleEventDeps,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = applyThreadLifecycleEvent(deps.db, deps.hub, args);
  logUnappliedThreadLifecycleEvent(deps.logger, args, outcome);
  emitPluginThreadLifecycleOutcome(outcome);
  return outcome;
}

/**
 * In-transaction variant: applies the event inside the caller's transaction
 * and logs non-applied outcomes. The caller owns notification — typically a
 * status-changed notify gated on `outcome.applied`.
 */
export function applyLoggedThreadLifecycleEventInTransaction(
  deps: ApplyLoggedThreadLifecycleEventTransactionDeps,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = applyThreadLifecycleEventInTransaction(deps.db, args);
  logUnappliedThreadLifecycleEvent(deps.logger, args, outcome);
  // Plugin dispatch is deferred to the next macrotask, i.e. after the
  // caller's synchronous transaction has committed.
  emitPluginThreadLifecycleOutcome(outcome);
  return outcome;
}
