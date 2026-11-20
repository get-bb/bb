import { and, eq, inArray, ne } from "drizzle-orm";
import {
  environments,
  getEnvironment,
  liveThread,
  threads,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";

interface EnvironmentProvisionCancellationReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionCancellationTransactionDeps extends EnvironmentProvisionCancellationReadDeps {
  db: DbTransaction;
}

interface CancelEnvironmentProvisioningForThreadStopArgs {
  environmentId: string;
  threadId: string;
}

type EnvironmentProvisioningCancellationForThreadStopResult =
  | "awaiting_host_cancel"
  | "ready_to_finalize";

function hasOtherLiveThreadDependingOnEnvironmentProvision(
  deps: EnvironmentProvisionCancellationReadDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): boolean {
  const row = deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        ne(threads.id, args.threadId),
        inArray(threads.status, ["starting", "active"]),
        liveThread,
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export function cancelEnvironmentProvisioningForThreadStopInTransaction(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): EnvironmentProvisioningCancellationForThreadStopResult {
  if (hasOtherLiveThreadDependingOnEnvironmentProvision(deps, args)) {
    return "ready_to_finalize";
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return "ready_to_finalize";
  }

  if (environment.status === "provisioning") {
    return "awaiting_host_cancel";
  }

  return "ready_to_finalize";
}

export function discardPendingCreateForThreadStopInTransaction(
  deps: EnvironmentProvisionCancellationTransactionDeps,
  args: CancelEnvironmentProvisioningForThreadStopArgs,
): boolean {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (
    environment === null ||
    !environment.createPending ||
    environment.heldBy !== null ||
    environment.teardownStatus !== null ||
    hasOtherLiveThreadDependingOnEnvironmentProvision(deps, args)
  )
    return false;
  deps.db
    .update(environments)
    .set({ teardownStatus: "running", retireAt: Date.now() })
    .where(eq(environments.id, environment.id))
    .run();
  return true;
}
