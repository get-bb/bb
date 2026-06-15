export {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  EnvironmentLifecycleEventNotAppliedError,
  listStaleDestroyingManagedEnvironments,
  recordProvisionedEnvironmentWorkspace,
  requireEnvironmentLifecycleEventApplied,
} from "./data/environments.js";
export type {
  ApplyEnvironmentLifecycleEventArgs,
  ApplyEnvironmentLifecycleEventNoopReason,
  ApplyEnvironmentLifecycleEventOutcome,
} from "./data/environments.js";
