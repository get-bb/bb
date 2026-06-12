export {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  clearEnvironmentCleanupRequestRecord,
  EnvironmentLifecycleEventNotAppliedError,
  listStaleDestroyingManagedEnvironments,
  recordEnvironmentCleanupRequest,
  recordProvisionedEnvironmentWorkspace,
  requireEnvironmentLifecycleEventApplied,
} from "./data/environments.js";
export type {
  ApplyEnvironmentLifecycleEventArgs,
  ApplyEnvironmentLifecycleEventNoopReason,
  ApplyEnvironmentLifecycleEventOutcome,
} from "./data/environments.js";
