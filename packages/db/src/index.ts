export { afterCommit, createConnection } from "./connection.js";
export type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
  QueryPlanExecutionObserver,
  SlowDbQueryLogger,
  SlowDbQueryLogFields,
} from "./connection.js";
export {
  createQueryPlanAuditor,
  openQueryPlanAuditDatabase,
} from "./query-plan-guard.js";
export type {
  QueryPlanAuditor,
  QueryPlanFindingReport,
} from "./query-plan-guard.js";
export { startWalCheckpointer } from "./wal-checkpointer.js";
export type {
  WalCheckpointer,
  WalCheckpointLogger,
} from "./wal-checkpointer.js";

export * from "./schema.js";
export {
  createQueuedThreadMessageId,
  createEventId,
  createHostId,
  createThreadProvisioningId,
} from "./ids.js";

export { countAppliedMigrations, migrate } from "./migrate.js";
export {
  isSqliteBusyError,
  isSqliteForeignKeyConstraint,
  isSqliteUniqueConstraintOnColumns,
} from "./sqlite-errors.js";
export type { MigrationWarningLogger } from "./migrate.js";
export { deriveStoredEventItemFields } from "./stored-event-item-fields.js";
export { noopNotifier } from "./notifier.js";
export type { DbNotifier } from "./notifier.js";

export * from "./data/index.js";
