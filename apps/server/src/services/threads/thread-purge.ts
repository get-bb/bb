import {
  deleteThread,
  deleteThreadPurgeBatch,
  getThread,
  isThreadPurgeRequested,
  markThreadPurgeStarted,
  nextThreadPurge,
  type PendingThreadPurge,
} from "@bb/db";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { pluginHookProvider } from "../plugins/plugin-hook-registry.js";
import { defineScanSweep, type ItemSweep } from "../system/item-sweep.js";
import { startPacedRun } from "../system/paced-run.js";
import { decideWithinBox } from "./dispatch-hooks.js";

const PURGE_EVENT_ROWS = 64;
const PURGE_EVENT_BYTES = 512 * 1024;
const PURGE_ROWS = 128;

type ThreadPurgeDeps = Pick<AppDeps, "db" | "hub" | "logger">;

const threadPurgeHookDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("proceed") }),
  z.object({ action: z.literal("wait") }),
]);

const purgeHolds = new Map<string, { exclusive: boolean; count: number }>();

export function holdThreadPurge(
  threadId: string,
  mode: "exclusive" | "shared",
): () => void {
  const current = purgeHolds.get(threadId);
  if (current !== undefined && (mode === "exclusive" || current.exclusive)) {
    throw new ApiError(
      409,
      "thread_transfer_busy",
      `Thread ${threadId} is being imported or exported; try again in a moment`,
    );
  }
  purgeHolds.set(threadId, {
    exclusive: mode === "exclusive",
    count: (current?.count ?? 0) + 1,
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const held = purgeHolds.get(threadId);
    if (held === undefined) return;
    if (held.count <= 1) purgeHolds.delete(threadId);
    else purgeHolds.set(threadId, { ...held, count: held.count - 1 });
  };
}

async function pluginsLetPurge(
  deps: ThreadPurgeDeps,
  threadId: string,
): Promise<boolean> {
  const provider = pluginHookProvider();
  if (provider === undefined) return true;
  const hooks = provider.listHooks("thread.delete_finalize");
  if (hooks.length === 0) return true;
  const thread = getThread(deps.db, threadId);
  if (thread === null) return true;
  const context = { threadId, projectId: thread.projectId };
  let proceed = true;
  for (const hook of hooks) {
    const invocation = await provider.invokeHook(
      hook,
      "thread.delete_finalize hook",
      () =>
        decideWithinBox(
          async () => hook.handler(context),
          provider.decisionTimeoutMs,
        ),
    );
    const decision =
      invocation.ok && invocation.value.ok
        ? threadPurgeHookDecisionSchema.safeParse(invocation.value.value)
        : null;
    if (decision?.success && decision.data.action === "proceed") continue;
    proceed = false;
    if (decision === null || !decision.success) {
      deps.logger.warn(
        {
          pluginId: hook.pluginId,
          threadId,
          error: !invocation.ok
            ? invocation.error
            : !invocation.value.ok
              ? invocation.value.error
              : "returned an invalid decision",
        },
        "thread.delete_finalize hook failed; keeping the thread until it answers",
      );
    }
  }
  return proceed;
}

function purgeThreadBatch(deps: ThreadPurgeDeps, threadId: string): boolean {
  const notifications = new NotificationBuffer();
  const finished = deps.db.transaction(
    (tx) => {
      if (!isThreadPurgeRequested(tx, threadId)) return true;
      const deleted = deleteThreadPurgeBatch(tx, {
        maxEventBytes: PURGE_EVENT_BYTES,
        maxEventRows: PURGE_EVENT_ROWS,
        maxRows: PURGE_ROWS,
        threadId,
      });
      if (deleted > 0) return false;
      deleteThread(tx, notifications, threadId);
      return true;
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  return finished;
}

export function threadPurgeSweep(deps: ThreadPurgeDeps): ItemSweep {
  const paced = startPacedRun(deps);
  const waiting = new Set<string>();
  return defineScanSweep<PendingThreadPurge>({
    name: "thread-purge",
    concurrency: 1,
    list: ({ excludedKeys }) => {
      if (!paced.mayContinue()) return [];
      if (pluginHookProvider()?.isLoadingPlugins() === true) return [];
      const next = nextThreadPurge(deps.db, {
        excludedThreadIds: new Set([
          ...excludedKeys,
          ...waiting,
          ...purgeHolds.keys(),
        ]),
      });
      return next === null ? [] : [next];
    },
    key: (pending) => pending.threadId,
    process: async ({ startedAt, threadId }) => {
      if (startedAt === null) {
        if (!(await pluginsLetPurge(deps, threadId))) {
          waiting.add(threadId);
          return;
        }
        if (purgeHolds.has(threadId)) return;
        if (!markThreadPurgeStarted(deps.db, { now: Date.now(), threadId })) {
          return;
        }
      }
      await paced.run(() => purgeThreadBatch(deps, threadId));
    },
  });
}
