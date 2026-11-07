import {
  threadPruningSweep,
  THREAD_PRUNING_SWEEP_LIMITS,
  type ThreadPruningSweepLimits,
} from "./thread-pruning-sweep.js";
import {
  PROJECT_ATTACHMENT_BACKFILL_LIMITS,
  projectAttachmentBackfillSweep,
  projectAttachmentPruneSweep,
} from "../projects/attachment-maintenance.js";
import {
  providerLifecycleSweep,
  sweepProviderLifecycles,
} from "../environments/environment-engine.js";
import { threadPurgeSweep } from "../threads/thread-purge.js";
import {
  threadStorageOrphanSweep,
  THREAD_STORAGE_ORPHAN_SWEEP_CADENCE_MS,
} from "../threads/thread-storage-orphans.js";
import { and, eq, isNull, isNotNull, inArray, notExists } from "drizzle-orm";
import {
  machineLifecycleSweep,
  machineRemovalRequestSweep,
  sweepMachineLifecycles,
} from "../machines/provider-orchestration.js";
import {
  CLOSED_SESSION_ROW_RETENTION_MS,
  DATABASE_INCREMENTAL_VACUUM_MAX_PAGES,
  DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
  DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE,
  deleteExpiredRetainedEventOutputs,
  EXITED_TERMINAL_SESSION_ROW_RETENTION_MS,
  dropDeferredLegacyTables,
  getDatabaseAutoVacuumMode,
  getDatabaseFreelistStats,
  getDatabaseMaintenanceActivity,
  getEnvironment,
  isDatabaseMaintenanceIdle,
  releaseFinishedEnvironmentPreparationOwners,
  deleteSweepItemFailuresOfUnknownSweeps,
  listArchivedThreadsPendingTeardown,
  listDeferredLegacyTables,
  migrateNextCompletedEventItemOutput,
  migrateNextLegacyImageGenerationOutput,
  environments,
  pruneClosedSessions,
  pruneExitedTerminalSessions,
  RETAINED_EVENT_OUTPUT_TARGETS,
  runIncrementalVacuum,
  shouldRunIncrementalVacuum,
  threadPurges,
  threads,
  DEFAULT_COMPLETED_EVENT_OUTPUT_MIGRATION_SCAN_LIMIT,
  DEFAULT_LEGACY_IMAGE_GENERATION_MIGRATION_SCAN_LIMIT,
} from "@bb/db";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { advanceEnvironmentProvisioning } from "../environments/environment-engine.js";
import {
  advanceProjectDeletion,
  listProjectsPendingDeletion,
} from "../projects/project-deletion.js";
import {
  finalizeStoppedThread,
  hasLiveThreadStartInFlight,
  requestThreadStopForCurrentState,
  requestThreadStorageDeletion,
  turnStartDeadlineSweep,
} from "../threads/thread-lifecycle.js";
import {
  archiveUndoGraceKeepsTerminals,
  archiveUndoGraceKeepsTurnRunning,
} from "../threads/archive-undo-grace.js";
import { advanceThreadProvisioning } from "../threads/thread-provisioning.js";
import {
  dueScheduledQueueSweep,
  failedQueueRetrySweep,
  idleThreadQueueSweep,
  orphanedPluginWaitSweep,
  type QueueWaitPluginDirectory,
} from "../threads/queued-message-dispatch.js";
import { deliverLegacyDeferredThreadMessages } from "../threads/legacy-deferred-messages.js";
import {
  releaseOrphanedQueuedMessageDispatchClaims,
  releaseStaleQueuedMessageDispatchClaims,
} from "../threads/queued-messages.js";
import { runEventLoopWork, runEventLoopWorkSync } from "./event-loop-work.js";
import type { OpenPluginDatabase } from "../plugins/plugin-service.js";
import type Database from "better-sqlite3";
import {
  defineItemSweep,
  defineSingleItemSweep,
  type ItemSweep,
} from "./item-sweep.js";

type DatabaseMaintenanceSweepDeps = Pick<AppDeps, "db" | "logger">;

interface PluginScheduleSweeper {
  dueScheduleSweep(now: number): ItemSweep;
}

type PeriodicSweepDeps = LoggedPendingInteractionWorkSessionDeps & {
  pluginSchedules: PluginScheduleSweeper;
  /** Liveness directory for `plugin:<id>` wait holders. */
  plugins: QueueWaitPluginDirectory & PluginDatabaseDirectory;
};

interface PluginDatabaseDirectory {
  listOpenPluginDatabases(): OpenPluginDatabase[];
}

const DATABASE_MAINTENANCE_CHECK_INTERVAL_MS = 60 * 60_000;
const DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES = 256;
const EXITED_TERMINAL_SESSION_PRUNE_BATCH_SIZE = 1_000;
const COMPLETED_EVENT_OUTPUT_MIGRATION_MAX_ADVANCES_PER_SWEEP = 64;
const RETAINED_EVENT_OUTPUT_EXPIRY_MAX_ADVANCES_PER_SWEEP = 256;
const RETAINED_EVENT_OUTPUT_EXPIRY_BATCH_SIZE = 1;

type PeriodicSweepJobCategory =
  | "retention"
  | "durable-intent-retry"
  | "orphan-cleanup"
  | "maintenance"
  | "scheduler";

interface PeriodicSweepJobBase {
  cadenceMs: number;
  category: PeriodicSweepJobCategory;
  name: string;
}

export interface PeriodicSweepJob extends PeriodicSweepJobBase {
  background: boolean;
  sweep(deps: PeriodicSweepDeps, now: number): ItemSweep;
}

interface PeriodicSweepJobState {
  lastStartedAt: number;
  running: boolean;
}

type PeriodicSweepJobList = readonly PeriodicSweepJob[];
const periodicSweepJobStates = new Map<string, PeriodicSweepJobState>();

function getPeriodicSweepJobState(
  job: PeriodicSweepJob,
): PeriodicSweepJobState {
  const existing = periodicSweepJobStates.get(job.name);
  if (existing) {
    return existing;
  }

  const created: PeriodicSweepJobState = {
    lastStartedAt: 0,
    running: false,
  };
  periodicSweepJobStates.set(job.name, created);
  return created;
}

async function runPeriodicSweepJob(
  deps: PeriodicSweepDeps,
  job: PeriodicSweepJob,
  now: number,
): Promise<void> {
  const state = getPeriodicSweepJobState(job);
  if (state.running) {
    deps.logger.debug(
      { sweepJob: job.name, sweepJobCategory: job.category },
      "Periodic sweep job skipped while already running",
    );
    return;
  }

  if (job.cadenceMs > 0 && now - state.lastStartedAt < job.cadenceMs) {
    return;
  }

  state.lastStartedAt = now;
  state.running = true;
  const run = runEventLoopWork(`sweep:${job.name}`, () =>
    job.sweep(deps, now).run(deps, now),
  )
    .catch((error: unknown) => {
      deps.logger.error(
        {
          err: error,
          sweepJob: job.name,
          sweepJobCategory: job.category,
        },
        "Periodic sweep job failed",
      );
    })
    .finally(() => {
      state.running = false;
    });
  if (job.background) return;
  await run;
}

export async function runPeriodicSweepJobs(
  deps: PeriodicSweepDeps,
  jobs: PeriodicSweepJobList,
  now: number,
): Promise<void> {
  for (const job of jobs) {
    await runPeriodicSweepJob(deps, job, now);
  }
}

async function runChunkedIncrementalVacuum(
  client: Database.Database,
): Promise<ReturnType<typeof runIncrementalVacuum>> {
  let first: ReturnType<typeof runIncrementalVacuum> | null = null;
  let last: ReturnType<typeof runIncrementalVacuum> | null = null;
  for (
    let vacuumedPages = 0;
    vacuumedPages < DATABASE_INCREMENTAL_VACUUM_MAX_PAGES;
    vacuumedPages += DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES
  ) {
    if (last !== null) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    last = runIncrementalVacuum(client, {
      maxPages: Math.min(
        DATABASE_INCREMENTAL_VACUUM_CHUNK_PAGES,
        DATABASE_INCREMENTAL_VACUUM_MAX_PAGES - vacuumedPages,
      ),
    });
    first ??= last;
    if (last.after.freelistCount === 0) {
      break;
    }
  }
  if (first === null || last === null) {
    throw new Error("Incremental vacuum ran no chunks");
  }
  return { before: first.before, after: last.after };
}

interface IncrementalVacuumLogArgs {
  logFields: { pluginId?: string };
  logger: AppDeps["logger"];
}

async function runIncrementalVacuumAboveFreelistThreshold(
  client: Database.Database,
  args: IncrementalVacuumLogArgs,
): Promise<void> {
  const freelistStats = getDatabaseFreelistStats(client);
  if (
    !shouldRunIncrementalVacuum({
      minFreelistPages: DATABASE_INCREMENTAL_VACUUM_MIN_FREELIST_PAGES,
      stats: freelistStats,
    })
  ) {
    args.logger.debug(
      { ...args.logFields, freelistStats },
      "Incremental database vacuum skipped below freelist threshold",
    );
    return;
  }
  try {
    const result = await runChunkedIncrementalVacuum(client);
    args.logger.info(
      { ...args.logFields, result },
      "Incremental database vacuum completed",
    );
  } catch (error) {
    args.logger.warn(
      { ...args.logFields, err: error },
      "Incremental database vacuum failed",
    );
  }
}

export async function runPluginDatabaseMaintenanceSweep(
  deps: Pick<AppDeps, "logger"> & { plugins: PluginDatabaseDirectory },
): Promise<void> {
  for (const { database, pluginId } of deps.plugins.listOpenPluginDatabases()) {
    if (
      !database.open ||
      database.inTransaction ||
      getDatabaseAutoVacuumMode(database) !== "incremental"
    ) {
      continue;
    }
    await runIncrementalVacuumAboveFreelistThreshold(database, {
      logFields: { pluginId },
      logger: deps.logger,
    });
  }
}

export async function runDatabaseMaintenanceSweep(
  deps: DatabaseMaintenanceSweepDeps,
): Promise<void> {
  const deferredLegacyTables = listDeferredLegacyTables(deps.db);
  if (deferredLegacyTables.length > 0) {
    const activity = getDatabaseMaintenanceActivity(deps.db);
    if (!isDatabaseMaintenanceIdle(activity)) {
      deps.logger.debug(
        { activity, deferredLegacyTables },
        "Deferred legacy database table cleanup skipped while app work is active",
      );
      return;
    }

    try {
      const result = dropDeferredLegacyTables(deps.db);
      deps.logger.info(
        { result },
        "Deferred legacy database table cleanup completed",
      );
    } catch (error) {
      deps.logger.warn(
        { err: error },
        "Deferred legacy database table cleanup failed",
      );
    }
    return;
  }

  if (getDatabaseAutoVacuumMode(deps.db.$client) !== "incremental") {
    return;
  }
  await runIncrementalVacuumAboveFreelistThreshold(deps.db.$client, {
    logFields: {},
    logger: deps.logger,
  });
}

function projectDeletionSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): ItemSweep {
  return defineItemSweep({
    name: "project-deletion",
    concurrency: 1,
    list: () => listProjectsPendingDeletion(deps),
    key: (projectId) => projectId,
    process: async (projectId) => {
      await advanceProjectDeletion(deps, { projectId });
    },
  });
}

function environmentProvisioningSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): ItemSweep {
  return defineItemSweep({
    name: "environment-provisioning-orphan-cleanup",
    concurrency: 1,
    list: () =>
      deps.db
        .select({ id: environments.id })
        .from(environments)
        .where(inArray(environments.status, ["creating", "provisioning"]))
        .all(),
    key: (environment) => environment.id,
    process: async (environment) => {
      await advanceEnvironmentProvisioning(deps, {
        environmentId: environment.id,
      });
    },
  });
}

export async function runEnvironmentProvisioningSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  await environmentProvisioningSweep(deps).run(deps, Date.now());
}

function threadProvisioningSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): ItemSweep {
  return defineItemSweep({
    name: "thread-provisioning",
    concurrency: 1,
    list: () =>
      deps.db
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.status, "starting"), isNull(threads.deletedAt)))
        .all(),
    key: (thread) => thread.id,
    process: async (thread) => {
      if (hasLiveThreadStartInFlight(thread.id)) return;
      await advanceThreadProvisioning(deps, { threadId: thread.id });
    },
  });
}

function archivedThreadTeardownSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): ItemSweep {
  return defineItemSweep({
    name: "archived-thread-teardown",
    concurrency: 1,
    list: () => listArchivedThreadsPendingTeardown(deps.db),
    key: (thread) => thread.id,
    process: (thread) => {
      if (!archiveUndoGraceKeepsTerminals(thread, now)) {
        deps.terminalSessions.closeArchivedThreadTerminals({
          threadId: thread.id,
        });
      }
      if (archiveUndoGraceKeepsTurnRunning(thread, now)) return;
      requestThreadStopForCurrentState(
        deps,
        thread,
        thread.environmentId
          ? getEnvironment(deps.db, thread.environmentId)
          : null,
      );
    },
  });
}

function deletedThreadFinalizationSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): ItemSweep {
  return defineItemSweep({
    name: "deleted-thread-finalization",
    concurrency: 1,
    list: () =>
      deps.db
        .select({
          environmentId: threads.environmentId,
          id: threads.id,
          storageDeletedAt: threads.storageDeletedAt,
        })
        .from(threads)
        .where(
          and(
            isNotNull(threads.deletedAt),
            notExists(
              deps.db
                .select({ threadId: threadPurges.threadId })
                .from(threadPurges)
                .where(eq(threadPurges.threadId, threads.id)),
            ),
          ),
        )
        .all(),
    key: (thread) => thread.id,
    process: (thread) => {
      deps.terminalSessions.closeDeletedThreadTerminals({
        threadId: thread.id,
      });
      if (thread.storageDeletedAt !== null) {
        finalizeStoppedThread(deps, { threadId: thread.id });
        return;
      }
      requestThreadStorageDeletion(
        deps,
        thread,
        thread.environmentId
          ? getEnvironment(deps.db, thread.environmentId)
          : null,
      );
    },
  });
}

async function runThreadOrphanCleanupSweeps(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): Promise<void> {
  await threadProvisioningSweep(deps).run(deps, now);
  await archivedThreadTeardownSweep(deps, now).run(deps, now);
  await deletedThreadFinalizationSweep(deps).run(deps, now);
}

export async function runThreadLifecycleSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  await runThreadOrphanCleanupSweeps(deps, Date.now());
  await sweepProviderLifecycles(deps);
  await sweepMachineLifecycles(deps);
}

async function runMachineAuthPruneSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  await deps.machineAuth.pruneExpiredKeys();
}

type CompletedEventOutputMigrationTarget =
  | (typeof RETAINED_EVENT_OUTPUT_TARGETS)[number]
  | "legacy-image-generation";

function completedEventOutputMigrationKey(
  target: CompletedEventOutputMigrationTarget,
): string {
  return target === "legacy-image-generation"
    ? target
    : `${target.itemKind}.${target.outputPath}`;
}

function completedEventOutputMigrationSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): ItemSweep {
  const targets: CompletedEventOutputMigrationTarget[] = [
    ...RETAINED_EVENT_OUTPUT_TARGETS,
    "legacy-image-generation",
  ];
  const advancesPerTarget = Math.ceil(
    COMPLETED_EVENT_OUTPUT_MIGRATION_MAX_ADVANCES_PER_SWEEP / targets.length,
  );
  return defineItemSweep<CompletedEventOutputMigrationTarget>({
    name: "completed-event-output-migration",
    concurrency: 1,
    list: () => targets,
    key: completedEventOutputMigrationKey,
    process: async (target) => {
      const changedThreadIds = new Set<string>();
      try {
        for (let advance = 0; advance < advancesPerTarget; advance += 1) {
          const result = runEventLoopWorkSync(
            "sweep:completed-event-output-migration:advance",
            () =>
              target === "legacy-image-generation"
                ? migrateNextLegacyImageGenerationOutput(deps.db, {
                    limit: DEFAULT_LEGACY_IMAGE_GENERATION_MIGRATION_SCAN_LIMIT,
                    migratedAt: now,
                  })
                : migrateNextCompletedEventItemOutput(deps.db, {
                    ...target,
                    limit: DEFAULT_COMPLETED_EVENT_OUTPUT_MIGRATION_SCAN_LIMIT,
                    migratedAt: now,
                  }),
          );
          if (result.action === "migrated") {
            if (!result.threadId) {
              throw new Error("Migrated completed output has no thread");
            }
            changedThreadIds.add(result.threadId);
          } else if (result.action === "complete" || result.action === "idle") {
            return;
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } finally {
        for (const threadId of changedThreadIds) {
          deps.hub.notifyThread(threadId, ["history-compacted"]);
        }
      }
    },
  });
}

async function runRetainedEventOutputExpirySweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): Promise<void> {
  const changedThreadIds = new Set<string>();
  try {
    for (
      let advance = 0;
      advance < RETAINED_EVENT_OUTPUT_EXPIRY_MAX_ADVANCES_PER_SWEEP;
      advance += 1
    ) {
      const { deleted, threadIds } = runEventLoopWorkSync(
        "sweep:retained-event-output-expiry:delete",
        () =>
          deleteExpiredRetainedEventOutputs(deps.db, {
            expiredAtOrBefore: now,
            limit: RETAINED_EVENT_OUTPUT_EXPIRY_BATCH_SIZE,
          }),
      );
      for (const threadId of threadIds) {
        changedThreadIds.add(threadId);
      }
      if (deleted === 0) {
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    for (const threadId of changedThreadIds) {
      deps.hub.notifyThread(threadId, ["history-compacted"]);
    }
  }
}

function runExitedTerminalSessionPruneSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): void {
  pruneExitedTerminalSessions(deps.db, {
    exitedBefore: now - EXITED_TERMINAL_SESSION_ROW_RETENTION_MS,
    limit: EXITED_TERMINAL_SESSION_PRUNE_BATCH_SIZE,
  });
}

function runClosedSessionPruneSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): void {
  pruneClosedSessions(deps.db, {
    closedBefore: now - CLOSED_SESSION_ROW_RETENTION_MS,
    limit: DEFAULT_CLOSED_SESSION_PRUNE_BATCH_SIZE,
  });
}

export function createThreadEventPruningJob(
  limits: ThreadPruningSweepLimits,
): PeriodicSweepJob {
  return {
    cadenceMs: 0,
    category: "retention",
    name: "thread-event-pruning",
    background: false,
    sweep: (deps) => threadPruningSweep(deps, limits),
  };
}

export const PERIODIC_SWEEP_JOBS: readonly PeriodicSweepJob[] = [
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "environment-provider-lifecycle",
    background: false,
    sweep: providerLifecycleSweep,
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "environment-preparation-owner-release",
    background: false,
    sweep: (deps) =>
      defineSingleItemSweep({
        name: "environment-preparation-owner-release",
        process: () => releaseFinishedEnvironmentPreparationOwners(deps.db),
      }),
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "machine-removal-request",
    background: false,
    sweep: machineRemovalRequestSweep,
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "machine-provider-lifecycle",
    background: true,
    sweep: machineLifecycleSweep,
  },
  {
    cadenceMs: 0,
    category: "retention",
    name: "machine-auth-prune",
    background: false,
    sweep: (deps) =>
      defineSingleItemSweep({
        name: "machine-auth-prune",
        process: () => runMachineAuthPruneSweep(deps),
      }),
  },
  {
    cadenceMs: 0,
    category: "retention",
    name: "completed-event-output-migration",
    background: false,
    sweep: completedEventOutputMigrationSweep,
  },
  {
    cadenceMs: 0,
    category: "retention",
    name: "retained-event-output-expiry",
    background: false,
    sweep: (deps, now) =>
      defineSingleItemSweep({
        name: "retained-event-output-expiry",
        process: () => runRetainedEventOutputExpirySweep(deps, now),
      }),
  },
  {
    cadenceMs: 0,
    category: "retention",
    name: "closed-session-prune",
    background: false,
    sweep: (deps, now) =>
      defineSingleItemSweep({
        name: "closed-session-prune",
        process: () => runClosedSessionPruneSweep(deps, now),
      }),
  },
  {
    cadenceMs: 0,
    category: "retention",
    name: "exited-terminal-session-prune",
    background: false,
    sweep: (deps, now) =>
      defineSingleItemSweep({
        name: "exited-terminal-session-prune",
        process: () => runExitedTerminalSessionPruneSweep(deps, now),
      }),
  },
  {
    cadenceMs: 0,
    category: "orphan-cleanup",
    name: "environment-provisioning-orphan-cleanup",
    background: false,
    sweep: environmentProvisioningSweep,
  },
  {
    cadenceMs: 0,
    category: "orphan-cleanup",
    name: "thread-provisioning",
    background: false,
    sweep: threadProvisioningSweep,
  },
  {
    cadenceMs: 0,
    category: "orphan-cleanup",
    name: "archived-thread-teardown",
    background: false,
    sweep: archivedThreadTeardownSweep,
  },
  {
    cadenceMs: 0,
    category: "orphan-cleanup",
    name: "deleted-thread-finalization",
    background: false,
    sweep: deletedThreadFinalizationSweep,
  },
  {
    cadenceMs: 0,
    category: "orphan-cleanup",
    name: "thread-purge",
    background: true,
    sweep: threadPurgeSweep,
  },
  {
    cadenceMs: 0,
    category: "orphan-cleanup",
    name: "turn-start-deadline",
    background: false,
    sweep: turnStartDeadlineSweep,
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "queued-message-claim-release",
    background: false,
    sweep: (deps, now) =>
      defineSingleItemSweep({
        name: "queued-message-claim-release",
        process: () => releaseStaleQueuedMessageDispatchClaims(deps, now),
      }),
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "queued-message-auto-send",
    background: false,
    sweep: idleThreadQueueSweep,
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "due-scheduled-queue-dispatch",
    background: false,
    sweep: dueScheduledQueueSweep,
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "failed-queue-message-retry",
    background: false,
    sweep: failedQueueRetrySweep,
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "orphaned-queue-wait-clear",
    background: false,
    sweep: (deps) => orphanedPluginWaitSweep(deps, deps.plugins),
  },
  {
    cadenceMs: 0,
    category: "durable-intent-retry",
    name: "project-deletion",
    background: false,
    sweep: projectDeletionSweep,
  },
  {
    cadenceMs: 0,
    category: "scheduler",
    name: "plugin-schedule",
    background: false,
    sweep: (deps, now) => deps.pluginSchedules.dueScheduleSweep(now),
  },
  createThreadEventPruningJob(THREAD_PRUNING_SWEEP_LIMITS),
  {
    cadenceMs: DATABASE_MAINTENANCE_CHECK_INTERVAL_MS,
    category: "maintenance",
    name: "database-maintenance",
    background: false,
    sweep: (deps) =>
      defineSingleItemSweep({
        name: "database-maintenance",
        process: () => runDatabaseMaintenanceSweep(deps),
      }),
  },
  {
    cadenceMs: DATABASE_MAINTENANCE_CHECK_INTERVAL_MS,
    category: "maintenance",
    name: "plugin-database-maintenance",
    background: false,
    sweep: (deps) =>
      defineSingleItemSweep({
        name: "plugin-database-maintenance",
        process: () => runPluginDatabaseMaintenanceSweep(deps),
      }),
  },
  {
    cadenceMs: 0,
    category: "maintenance",
    name: "project-attachment-backfill",
    background: false,
    sweep: (deps, now) =>
      projectAttachmentBackfillSweep(
        deps,
        PROJECT_ATTACHMENT_BACKFILL_LIMITS,
        now,
      ),
  },
  {
    cadenceMs: 60_000,
    category: "retention",
    name: "project-attachment-orphan-prune",
    background: false,
    sweep: projectAttachmentPruneSweep,
  },
  {
    cadenceMs: THREAD_STORAGE_ORPHAN_SWEEP_CADENCE_MS,
    category: "orphan-cleanup",
    name: "thread-storage-orphan-cleanup",
    background: true,
    sweep: threadStorageOrphanSweep,
  },
];

async function runStartupRecoveryStep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  step: string,
  run: () => Promise<void> | void,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    deps.logger.error({ err: error, step }, "Startup recovery step failed");
  }
}

export async function runStartupRecoverySweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  await runStartupRecoveryStep(deps, "forget-unknown-sweep-failures", () => {
    deleteSweepItemFailuresOfUnknownSweeps(
      deps.db,
      PERIODIC_SWEEP_JOBS.map((job) => job.name),
    );
  });
  await runStartupRecoveryStep(deps, "release-queued-message-claims", () => {
    const releasedClaims = releaseOrphanedQueuedMessageDispatchClaims(
      deps,
      Date.now(),
    );
    if (releasedClaims > 0) {
      deps.logger.info(
        { releasedClaims },
        "Released queued message claims left by the previous server process",
      );
    }
  });
  await runStartupRecoveryStep(deps, "legacy-deferred-messages", () =>
    deliverLegacyDeferredThreadMessages(deps),
  );
  await runStartupRecoveryStep(deps, "environment-provisioning", () =>
    runEnvironmentProvisioningSweep(deps),
  );
  await runStartupRecoveryStep(deps, "thread-orphan-cleanup", () =>
    runThreadOrphanCleanupSweeps(deps, Date.now()),
  );
  await runStartupRecoveryStep(deps, "environment-provider-lifecycle", () =>
    sweepProviderLifecycles(deps),
  );
  await runStartupRecoveryStep(deps, "machine-provider-lifecycle", () =>
    sweepMachineLifecycles(deps),
  );
}

export async function runPeriodicSweeps(
  deps: PeriodicSweepDeps,
): Promise<void> {
  const now = Date.now();
  await runPeriodicSweepJobs(deps, PERIODIC_SWEEP_JOBS, now);
}
