export {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  EnvironmentLifecycleEventNotAppliedError,
  listStaleDestroyingManagedEnvironments,
  recordEnvironmentCurrentBranch,
  recordEnvironmentProvisionFailure,
  recordProvisionedEnvironmentWorkspace,
  requireEnvironmentLifecycleEventApplied,
} from "./data/environments.js";
export type {
  ApplyEnvironmentLifecycleEventArgs,
  ApplyEnvironmentLifecycleEventNoopReason,
  ApplyEnvironmentLifecycleEventOutcome,
} from "./data/environments.js";
