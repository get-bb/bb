import { and, asc, eq, gt, isNotNull, notInArray } from "drizzle-orm";
import {
  acquireProjectAttachmentOwnership,
  claimProjectAttachments,
  ensureProjectAttachmentBackfill,
  getProjectAttachment,
  nextProjectAttachmentBackfill,
  projectAttachmentBackfills,
  projectAttachments,
  readAttachmentBackfillInput,
  startAttachmentBackfillPhase,
  threads,
  updateAttachmentBackfill,
  type DbConnection,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import { defineItemSweep, type ItemSweep } from "../system/item-sweep.js";
import {
  inventoryAttachmentReference,
  walkProjectAttachmentFiles,
  deleteInventoriedAttachmentFiles,
  inventoryAttachmentReferences,
} from "./attachments.js";

type MaintenanceDeps = Pick<AppDeps, "db" | "config" | "logger">;
interface AttachmentMaintenanceState {
  inventoryWalkers: Map<string, AsyncGenerator<string>>;
  backfillRunning: boolean;
  runningPrunes: Set<string>;
  pruneCursor: string;
}

const maintenanceStates = new WeakMap<
  DbConnection,
  AttachmentMaintenanceState
>();

function getMaintenanceState(db: DbConnection): AttachmentMaintenanceState {
  let state = maintenanceStates.get(db);
  if (!state) {
    state = {
      inventoryWalkers: new Map(),
      backfillRunning: false,
      runningPrunes: new Set(),
      pruneCursor: "",
    };
    maintenanceStates.set(db, state);
  }
  return state;
}

export interface ProjectAttachmentBackfillLimits {
  elapsedBudgetMs: number;
  maxSteps: number;
}

export const PROJECT_ATTACHMENT_BACKFILL_LIMITS: ProjectAttachmentBackfillLimits =
  {
    elapsedBudgetMs: 25,
    maxSteps: 32,
  };

export function projectAttachmentBackfillSweep(
  deps: MaintenanceDeps,
  limits: ProjectAttachmentBackfillLimits,
  now: number,
): ItemSweep {
  const maintenance = getMaintenanceState(deps.db);
  return defineItemSweep({
    name: "project-attachment-backfill",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      if (maintenance.backfillRunning) return [];
      const walking = [...maintenance.inventoryWalkers.keys()].find(
        (projectId) => !excludedKeys.has(projectId),
      );
      const projectId =
        walking ??
        nextProjectAttachmentBackfill(deps.db, {
          excludedProjectIds: excludedKeys,
        });
      return projectId === null ? [] : [projectId];
    },
    key: (projectId) => projectId,
    process: async (projectId) => {
      maintenance.backfillRunning = true;
      try {
        await advanceProjectAttachmentBackfill(deps, {
          limits,
          now,
          projectId,
        });
      } catch (error) {
        const walker = maintenance.inventoryWalkers.get(projectId);
        maintenance.inventoryWalkers.delete(projectId);
        await walker?.return(undefined);
        throw error;
      } finally {
        maintenance.backfillRunning = false;
      }
    },
  });
}

async function advanceProjectAttachmentBackfill(
  deps: MaintenanceDeps,
  args: {
    limits: ProjectAttachmentBackfillLimits;
    now: number;
    projectId: string;
  },
): Promise<void> {
  const { limits, projectId } = args;
  const maintenance = getMaintenanceState(deps.db);
  let state = ensureProjectAttachmentBackfill(deps.db, projectId);
  state = { ...state, attemptedAt: args.now };
  updateAttachmentBackfill(deps.db, state);
  const started = performance.now();
  for (
    let count = 0;
    count < limits.maxSteps &&
    performance.now() - started < limits.elapsedBudgetMs;
    count += 1
  ) {
    if (state.phase === "files") {
      const walkers = maintenance.inventoryWalkers;
      let walker = walkers.get(projectId);
      if (!walker) {
        walker = walkProjectAttachmentFiles(deps.config.dataDir, projectId);
        walkers.set(projectId, walker);
      }
      const entry = await walker.next();
      if (entry.done) {
        walkers.delete(projectId);
        state = startAttachmentBackfillPhase(state, "events");
      } else if (!getProjectAttachment(deps.db, projectId, entry.value)) {
        await inventoryAttachmentReference(
          deps.db,
          deps.config.dataDir,
          projectId,
          entry.value,
        );
      }
      updateAttachmentBackfill(deps.db, state);
    } else if (state.phase !== "done") {
      const step = readAttachmentBackfillInput(deps.db, state);
      if (step.paths.length > 0)
        await inventoryAttachmentReferences(
          deps.db,
          deps.config.dataDir,
          projectId,
          step.paths,
        );
      deps.db.transaction(
        (tx) => {
          if (
            step.threadId &&
            tx
              .select({ id: threads.id })
              .from(threads)
              .where(eq(threads.id, step.threadId))
              .get()
          )
            acquireProjectAttachmentOwnership(
              tx,
              step.threadId,
              step.paths,
              "best-effort",
            );
          updateAttachmentBackfill(tx, step.next);
        },
        { behavior: "immediate" },
      );
      state = step.next;
    } else break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export async function pruneProjectAttachments(
  deps: MaintenanceDeps,
  projectId: string,
  now = Date.now(),
) {
  const state = ensureProjectAttachmentBackfill(deps.db, projectId);
  const running = getMaintenanceState(deps.db).runningPrunes;
  if (running.has(projectId))
    return {
      status: "busy" as const,
      reclaimedCount: 0,
      reclaimedBytes: 0,
      failedCount: 0,
    };
  if (state.phase !== "done")
    return {
      status: "backfill-pending" as const,
      reclaimedCount: 0,
      reclaimedBytes: 0,
      failedCount: 0,
    };
  running.add(projectId);
  let reclaimedCount = 0;
  let reclaimedBytes = 0;
  let failedCount = 0;
  try {
    for (const attachment of claimProjectAttachments(deps.db, projectId, now)) {
      try {
        await deleteInventoriedAttachmentFiles(deps.config.dataDir, attachment);
        deps.db
          .delete(projectAttachments)
          .where(
            and(
              eq(projectAttachments.id, attachment.id),
              isNotNull(projectAttachments.deletionClaimedAt),
            ),
          )
          .run();
        reclaimedCount += 1;
        reclaimedBytes += attachment.sizeBytes;
      } catch (error) {
        failedCount += 1;
        deps.logger.warn(
          { err: error, attachmentId: attachment.id, projectId },
          "Attachment deletion will retry",
        );
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (reclaimedCount > 0)
      deps.logger.info(
        { projectId, reclaimedCount, reclaimedBytes },
        "Reclaimed project attachments",
      );
    return {
      status: "complete" as const,
      reclaimedCount,
      reclaimedBytes,
      failedCount,
    };
  } finally {
    running.delete(projectId);
  }
}

export function projectAttachmentPruneSweep(
  deps: MaintenanceDeps,
  now: number,
): ItemSweep {
  const maintenance = getMaintenanceState(deps.db);
  return defineItemSweep({
    name: "project-attachment-orphan-prune",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      const row = deps.db
        .select({ id: projectAttachmentBackfills.projectId })
        .from(projectAttachmentBackfills)
        .where(
          and(
            eq(projectAttachmentBackfills.phase, "done"),
            gt(projectAttachmentBackfills.projectId, maintenance.pruneCursor),
            excludedKeys.size === 0
              ? undefined
              : notInArray(projectAttachmentBackfills.projectId, [
                  ...excludedKeys,
                ]),
          ),
        )
        .orderBy(asc(projectAttachmentBackfills.projectId))
        .limit(1)
        .get();
      maintenance.pruneCursor = row?.id ?? "";
      return row === undefined ? [] : [row.id];
    },
    key: (projectId) => projectId,
    process: async (projectId) => {
      await pruneProjectAttachments(deps, projectId, now);
    },
  });
}
