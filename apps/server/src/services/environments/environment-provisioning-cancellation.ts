import {
  environmentHasOtherStartingOrActiveThread,
  getEnvironment,
  setEnvironmentColumns,
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
  return environmentHasOtherStartingOrActiveThread(deps.db, args);
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
    environment.heldBy === "user" ||
    environment.teardownStatus !== null ||
    hasOtherLiveThreadDependingOnEnvironmentProvision(deps, args)
  )
    return false;
  setEnvironmentColumns(deps.db, environment.id, {
    heldBy: null,
    teardownStatus: "running",
    retireAt: Date.now(),
  });
  return true;
}
