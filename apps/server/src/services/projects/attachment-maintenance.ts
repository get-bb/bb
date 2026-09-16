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
  threads,
  updateAttachmentBackfill,
  type DbConnection,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import {
  ensureAttachmentReferenceExists,
  walkProjectAttachmentFiles,
  deleteInventoriedAttachmentFiles,
  validatePromptAttachmentReferences,
} from "./attachments.js";

type MaintenanceDeps = Pick<AppDeps, "db" | "config" | "logger">;
const inventoryWalkers = new WeakMap<
  DbConnection,
  Map<string, AsyncGenerator<string>>
>();
const runningBackfills = new WeakSet<DbConnection>();
const runningPrunes = new WeakMap<DbConnection, Set<string>>();
const pruneCursors = new WeakMap<DbConnection, string>();

export async function runProjectAttachmentBackfill(
  deps: MaintenanceDeps,
  now = Date.now(),
): Promise<void> {
  if (runningBackfills.has(deps.db)) return;
  runningBackfills.add(deps.db);
  const projectId =
    inventoryWalkers.get(deps.db)?.keys().next().value ??
    nextProjectAttachmentBackfill(deps.db, now);
  try {
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
        let walkers = inventoryWalkers.get(deps.db);
        if (!walkers) {
          walkers = new Map();
          inventoryWalkers.set(deps.db, walkers);
        }
        let walker = walkers.get(projectId);
        if (!walker) {
          walker = walkProjectAttachmentFiles(deps.config.dataDir, projectId);
          walkers.set(projectId, walker);
        }
        const entry = await walker.next();
        if (entry.done) {
          walkers.delete(projectId);
          state = { ...state, phase: "events" };
        } else if (!getProjectAttachment(deps.db, projectId, entry.value)) {
          await ensureAttachmentReferenceExists(
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
          await validatePromptAttachmentReferences({
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
              acquireProjectAttachmentOwnership(tx, step.threadId, step.input);
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
      const walker = inventoryWalkers.get(deps.db)?.get(projectId);
      inventoryWalkers.get(deps.db)?.delete(projectId);
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
    runningBackfills.delete(deps.db);
  }
}

export async function pruneProjectAttachments(
  deps: MaintenanceDeps,
  projectId: string,
  now = Date.now(),
) {
  const state = ensureProjectAttachmentBackfill(deps.db, projectId);
  let running = runningPrunes.get(deps.db);
  if (!running) {
    running = new Set();
    runningPrunes.set(deps.db, running);
  }
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
  const cursor = pruneCursors.get(deps.db) ?? "";
  const row = deps.db
    .select({ id: projectAttachmentBackfills.projectId })
    .from(projectAttachmentBackfills)
    .where(
      and(
        eq(projectAttachmentBackfills.phase, "done"),
        gt(projectAttachmentBackfills.projectId, cursor),
      ),
    )
    .orderBy(asc(projectAttachmentBackfills.projectId))
    .limit(1)
    .get();
  pruneCursors.set(deps.db, row?.id ?? "");
  if (row) await pruneProjectAttachments(deps, row.id, now);
}
