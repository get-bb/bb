export {
  createConnection,
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE_KIB,
  SQLITE_MMAP_SIZE_BYTES,
} from "./connection.js";
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
  createThreadId,
  createThreadProvisioningId,
} from "./ids.js";

export { migrate } from "./migrate.js";
export {
  isSqliteForeignKeyConstraint,
  isSqliteUniqueConstraintOnColumns,
} from "./sqlite-errors.js";
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
