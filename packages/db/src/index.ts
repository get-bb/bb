export { createConnection } from "./connection.js";
export type {
  CreateConnectionOptions,
  DbConnection,
  DbQueryConnection,
  DbTransaction,
  SlowDbQueryLogger,
  SlowDbQueryLogFields,
  SlowDbQueryOperation,
} from "./connection.js";

export * from "./schema.js";
export {
  createAutomationId,
  createQueuedThreadMessageClaimToken,
  createQueuedThreadMessageId,
  createEnvironmentId,
  createEventId,
  createEnvironmentProvisioningId,
  createHostDaemonSessionId,
  createHostId,
  createPendingInteractionId,
  createProjectId,
  createPromptHistoryEntryId,
  createProjectSourceId,
  createTerminalSessionId,
  createThreadScheduleId,
  createThreadId,
  createThreadProvisioningId,
  createWorkflowRunId,
} from "./ids.js";

export { migrate } from "./migrate.js";
export { isSqliteUniqueConstraintOnColumns } from "./sqlite-errors.js";
export type {
  FutureAppliedMigration,
  FutureAppliedMigrationWarningFields,
  MigrateOptions,
  MigrationWarningLogger,
} from "./migrate.js";
export {
  deriveStoredEventItemFields,
  deriveStoredEventItemFieldsFromSource,
} from "./stored-event-item-fields.js";
export type {
  StoredEventItemFieldSource,
  StoredEventItemFields,
} from "./stored-event-item-fields.js";

export { noopNotifier } from "./notifier.js";
export type { DbNotifier } from "./notifier.js";

export * from "./data/index.js";
