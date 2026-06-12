import type { DbConnection, DbNotifier, DbTransaction } from "@bb/db";
import {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  type ApplyEnvironmentLifecycleEventArgs,
  type ApplyEnvironmentLifecycleEventOutcome,
} from "@bb/db/internal-environment-lifecycle";
import type { ServerLogger } from "../../types.js";

interface ApplyLoggedEnvironmentLifecycleEventDeps {
  db: DbConnection;
  hub: DbNotifier;
  logger: ServerLogger;
}

interface ApplyLoggedEnvironmentLifecycleEventTransactionDeps {
  db: DbTransaction;
  logger: ServerLogger;
}

function logUnappliedEnvironmentLifecycleEvent(
  logger: ServerLogger,
  args: ApplyEnvironmentLifecycleEventArgs,
  outcome: ApplyEnvironmentLifecycleEventOutcome,
): void {
  if (outcome.applied) {
    return;
  }
  logger.info(
    {
      detail: outcome.detail,
      environmentId: args.environmentId,
      event: args.event.type,
      reason: outcome.reason,
    },
    "Environment lifecycle event not applied",
  );
}

/**
 * Applies an environment lifecycle event in its own transaction (the db
 * writer notifies `outcome.changes` when applied) and logs every non-applied
 * outcome so stale events are observable instead of silently swallowed.
 */
export function applyLoggedEnvironmentLifecycleEvent(
  deps: ApplyLoggedEnvironmentLifecycleEventDeps,
  args: ApplyEnvironmentLifecycleEventArgs,
): ApplyEnvironmentLifecycleEventOutcome {
  const outcome = applyEnvironmentLifecycleEvent(deps.db, deps.hub, args);
  logUnappliedEnvironmentLifecycleEvent(deps.logger, args, outcome);
  return outcome;
}

/**
 * In-transaction variant: applies the event inside the caller's transaction
 * and logs non-applied outcomes. The caller owns notification — typically
 * `hub.notifyEnvironment(id, outcome.changes)` gated on `outcome.applied`.
 */
export function applyLoggedEnvironmentLifecycleEventInTransaction(
  deps: ApplyLoggedEnvironmentLifecycleEventTransactionDeps,
  args: ApplyEnvironmentLifecycleEventArgs,
): ApplyEnvironmentLifecycleEventOutcome {
  const outcome = applyEnvironmentLifecycleEventInTransaction(deps.db, args);
  logUnappliedEnvironmentLifecycleEvent(deps.logger, args, outcome);
  return outcome;
}
