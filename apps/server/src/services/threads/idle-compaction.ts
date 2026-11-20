import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  findLastRootStoredTurnStarted,
  getEnvironment,
  getExperiments,
  getHost,
  getThread,
  isStoredTurnContextCompactionOnly,
  listActiveBackgroundTaskCountsByThreadIds,
  listPendingInteractionsByThread,
  listQueuedThreadMessages,
  threads,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { defineItemSweep, type ItemSweep } from "../system/item-sweep.js";
import { IDLE_COMPACTION_MIN_TTL_MS } from "./compaction-offer.js";
import { compactThreadContext } from "./dispatch-attempt.js";
import { readThreadContextWindowUsage } from "./thread-head-state.js";

const IDLE_COMPACTION_MIN_IDLE_MS = 30 * 60_000;

interface IdleCompactionWindow {
  dueAt: number;
  expiresAt: number;
}

interface IdleThreadRow {
  id: string;
  providerId: string;
  statusChangedAt: number;
}

const windows = new Map<
  string,
  { statusChangedAt: number; window: IdleCompactionWindow | null }
>();
const requestedCompactions = new Map<string, number>();

function readWindow(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): IdleCompactionWindow | null {
  const usage = readThreadContextWindowUsage(deps.db, {
    compactionOfferEnabled: true,
    idleCompactionEligible: true,
    threadId,
  });
  if (
    usage?.idleCompactionAt === undefined ||
    usage.compactionOfferAt === undefined
  ) {
    return null;
  }
  return {
    dueAt: Date.parse(usage.idleCompactionAt),
    expiresAt: Date.parse(usage.compactionOfferAt),
  };
}

function cachedWindow(
  deps: LoggedPendingInteractionWorkSessionDeps,
  row: IdleThreadRow,
): IdleCompactionWindow | null {
  const cached = windows.get(row.id);
  if (cached?.statusChangedAt === row.statusChangedAt) return cached.window;
  const window = readWindow(deps, row.id);
  windows.set(row.id, { statusChangedAt: row.statusChangedAt, window });
  return window;
}

function machineIsOnline(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: Thread,
): boolean {
  if (thread.environmentId === null) return false;
  const environment = getEnvironment(deps.db, thread.environmentId);
  if (environment === null) return false;
  const host = getHost(deps.db, environment.hostId);
  return (
    host !== null &&
    host.destroyedAt === null &&
    host.phase === "active" &&
    deps.hub.hasDaemonForHost(host.id)
  );
}

function latestTurnOnlyCompacted(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): boolean {
  const turn = findLastRootStoredTurnStarted(deps.db, { threadId });
  return (
    turn !== null &&
    isStoredTurnContextCompactionOnly(deps.db, {
      threadId,
      turnId: turn.turnId,
    })
  );
}

function hasWaitingWork(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): boolean {
  if (
    listPendingInteractionsByThread(deps.db, {
      statuses: ["pending", "resolving"],
      threadId,
    }).length > 0
  ) {
    return true;
  }
  if (listQueuedThreadMessages(deps.db, threadId).length > 0) return true;
  return listActiveBackgroundTaskCountsByThreadIds(deps.db, {
    threadIds: [threadId],
  }).some(
    (row) =>
      row.activeBackgroundAgentCount > 0 ||
      row.activeBackgroundCommandCount > 0 ||
      row.activeWorkflowCount > 0,
  );
}

function listIdleThreads(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): IdleThreadRow[] {
  return deps.db
    .select({
      id: threads.id,
      providerId: threads.providerId,
      statusChangedAt: threads.statusChangedAt,
    })
    .from(threads)
    .where(
      and(
        isNull(threads.archivedAt),
        eq(threads.status, "idle"),
        isNull(threads.deletedAt),
        isNull(threads.parentThreadId),
        eq(threads.visibility, "visible"),
        gte(threads.statusChangedAt, now - IDLE_COMPACTION_MIN_TTL_MS),
        lte(threads.statusChangedAt, now - IDLE_COMPACTION_MIN_IDLE_MS),
      ),
    )
    .all();
}

function dueWindow(
  deps: LoggedPendingInteractionWorkSessionDeps,
  row: IdleThreadRow,
  now: number,
): IdleCompactionWindow | null {
  if (!deps.providerRegistry.supportsManualCompaction(row.providerId)) {
    return null;
  }
  const window = cachedWindow(deps, row);
  if (window === null || now < window.dueAt || now >= window.expiresAt) {
    return null;
  }
  return requestedCompactions.get(row.id) === window.expiresAt ? null : window;
}

export function dueIdleCompactionWindow(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
  now: number,
): IdleCompactionWindow | null {
  const row = listIdleThreads(deps, now).find(
    (candidate) => candidate.id === threadId,
  );
  if (row === undefined) return null;
  const window = dueWindow(deps, row, now);
  const thread = getThread(deps.db, threadId);
  if (
    window === null ||
    thread === null ||
    hasWaitingWork(deps, threadId) ||
    latestTurnOnlyCompacted(deps, threadId) ||
    !machineIsOnline(deps, thread)
  ) {
    return null;
  }
  return window;
}

export function idleCompactionSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
  now: number,
): ItemSweep {
  return defineItemSweep({
    name: "idle-compaction",
    concurrency: 1,
    list: () => {
      for (const [threadId, expiresAt] of requestedCompactions)
        if (expiresAt <= now) requestedCompactions.delete(threadId);
      if (!getExperiments(deps.db).compactExpiredCache) {
        windows.clear();
        return [];
      }
      const rows = listIdleThreads(deps, now);
      const listed = new Set(rows.map((row) => row.id));
      for (const threadId of windows.keys())
        if (!listed.has(threadId)) windows.delete(threadId);
      return rows.filter((row) => dueWindow(deps, row, now) !== null);
    },
    key: (row) => row.id,
    process: async (row) => {
      const window = dueIdleCompactionWindow(deps, row.id, now);
      const thread = getThread(deps.db, row.id);
      if (window === null || thread === null) return;
      requestedCompactions.set(row.id, window.expiresAt);
      deps.logger.info(
        {
          threadId: row.id,
          promptCacheExpiresAt: new Date(window.expiresAt).toISOString(),
        },
        "Compacting idle thread before its prompt cache expires",
      );
      try {
        await compactThreadContext(deps, thread, "idle-compaction");
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        deps.logger.debug(
          { err: error, threadId: row.id },
          "Idle compaction skipped because the thread changed",
        );
      }
    },
  });
}
