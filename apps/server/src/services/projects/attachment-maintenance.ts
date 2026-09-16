import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
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
import {
  inventoryAttachmentReference,
  walkProjectAttachmentFiles,
  deleteInventoriedAttachmentFiles,
  inventoryPromptAttachmentReferences,
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

export async function runProjectAttachmentBackfill(
  deps: MaintenanceDeps,
  now = Date.now(),
): Promise<void> {
  const maintenance = getMaintenanceState(deps.db);
  if (maintenance.backfillRunning) return;
  maintenance.backfillRunning = true;
  let projectId: string | null = null;
  try {
    projectId =
      maintenance.inventoryWalkers.keys().next().value ??
      nextProjectAttachmentBackfill(deps.db, now);
    if (projectId === null) return;
    let state = ensureProjectAttachmentBackfill(deps.db, projectId);
    state = { ...state, attemptedAt: now, error: null };
    updateAttachmentBackfill(deps.db, state);
    const started = performance.now();
    for (
      let count = 0;
      count < 32 && performance.now() - started < 25;
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
        if (step.input.length > 0)
          await inventoryPromptAttachmentReferences({
            db: deps.db,
            dataDir: deps.config.dataDir,
            projectId,
            input: step.input,
          });
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
                step.input,
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
  } catch (error) {
    if (projectId !== null) {
      const walker = maintenance.inventoryWalkers.get(projectId);
      maintenance.inventoryWalkers.delete(projectId);
      await walker?.return(undefined);
      deps.db
        .update(projectAttachmentBackfills)
        .set({
          error: error instanceof Error ? error.message : String(error),
          attemptedAt: now,
        })
        .where(eq(projectAttachmentBackfills.projectId, projectId))
        .run();
    }
    deps.logger.warn(
      { err: error, projectId },
      "Attachment backfill paused; cleanup remains disabled",
    );
  } finally {
    maintenance.backfillRunning = false;
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

export async function runProjectAttachmentPrune(
  deps: MaintenanceDeps,
  now: number,
): Promise<void> {
  const maintenance = getMaintenanceState(deps.db);
  const row = deps.db
    .select({ id: projectAttachmentBackfills.projectId })
    .from(projectAttachmentBackfills)
    .where(
      and(
        eq(projectAttachmentBackfills.phase, "done"),
        gt(projectAttachmentBackfills.projectId, maintenance.pruneCursor),
      ),
    )
    .orderBy(asc(projectAttachmentBackfills.projectId))
    .limit(1)
    .get();
  maintenance.pruneCursor = row?.id ?? "";
  if (row) await pruneProjectAttachments(deps, row.id, now);
}
