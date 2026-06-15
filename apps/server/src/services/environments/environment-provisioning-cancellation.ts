import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  getEnvironment,
  threads,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";

export interface EnvironmentProvisionCancellationReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionCancellationTransactionDeps extends EnvironmentProvisionCancellationReadDeps {
  db: DbTransaction;
}

interface CancelEnvironmentProvisioningForThreadStopArgs {
  environmentId: string;
  threadId: string;
}

export type EnvironmentProvisioningCancellationForThreadStopResult =
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
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
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

  // Not lifecycle: stop routing — an in-flight provision needs a host-side
  // cancel RPC before the stopped thread can finalize; settled environments
  // finalize immediately. No transition is written here.
  if (environment.status === "provisioning") {
    return "awaiting_host_cancel";
  }

  return "ready_to_finalize";
}
