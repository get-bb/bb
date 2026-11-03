import { and, eq } from "drizzle-orm";
import {
  environments,
  getExperiments,
  getThread,
  liveThread,
  threads,
} from "@bb/db";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { queueChildThreadTurnNotificationBestEffort } from "./child-thread-notifications.js";
import { isParentNotifiableChildThread } from "./thread-parent.js";
import { loadFailedTurn, retryChain } from "./turn-failed.js";
import { retryFailedTurn } from "./turn-retry.js";

type RestartResumeDeps = LoggedPendingInteractionWorkSessionDeps;

const RESTART_RESUME_REASON = "bb restarted";
const RESTART_RESUME_DELAY_MS = 5_000;
const MAX_RESTART_RESUME_ATTEMPT = 4;

export function planRestartResumes(
  deps: RestartResumeDeps,
  args: { hostId: string },
): Set<string> {
  const resuming = new Set<string>();
  if (!getExperiments(deps.db).continueThreadsAfterRestarts) {
    return resuming;
  }
  const running = deps.db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        eq(threads.status, "active"),
        liveThread,
      ),
    )
    .all();
  for (const { id } of running) {
    if (deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(id)) {
      deps.logger.info(
        { threadId: id },
        "Not resuming a thread a restart cut while it waited on the user",
      );
      continue;
    }
    const turn = loadFailedTurn(deps.db, id);
    if (turn === null) {
      continue;
    }
    const attempt = retryChain(turn.request).attemptNumber + 1;
    if (attempt > MAX_RESTART_RESUME_ATTEMPT) {
      deps.logger.warn(
        { attempt, requestId: turn.request.requestId, threadId: id },
        "Not resuming a turn that restarts keep cutting off",
      );
      continue;
    }
    resuming.add(id);
  }
  return resuming;
}

export async function queueRestartResumes(
  deps: RestartResumeDeps,
  args: {
    interrupted: ReadonlyArray<{
      interruptedTurnId: string | null;
      threadId: string;
    }>;
    resumingThreadIds: ReadonlySet<string>;
  },
): Promise<void> {
  const sendAt = Date.now() + RESTART_RESUME_DELAY_MS;
  for (const { interruptedTurnId, threadId } of args.interrupted) {
    if (!args.resumingThreadIds.has(threadId)) {
      continue;
    }
    const thread = getThread(deps.db, threadId);
    if (thread === null) {
      continue;
    }
    try {
      const result = await retryFailedTurn(deps, {
        thread,
        request: {
          turnRequestId: null,
          sendAt,
          reason: RESTART_RESUME_REASON,
        },
      });
      deps.logger.info(
        {
          attempt: result.attempt,
          delivery: result.delivery,
          threadId,
          turnRequestId: result.turnRequestId,
        },
        "Queued a resume for a turn a restart cut off",
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body.code === "retry_already_queued"
      ) {
        continue;
      }
      deps.logger.warn(
        { err: error, threadId },
        "Could not queue a resume for a turn a restart cut off",
      );
      const current = getThread(deps.db, threadId);
      if (
        interruptedTurnId !== null &&
        current !== null &&
        isParentNotifiableChildThread(current, "interrupted")
      ) {
        await queueChildThreadTurnNotificationBestEffort(deps, {
          childThread: current,
          parentThreadId: current.parentThreadId,
          turnStatus: "interrupted",
          turnId: interruptedTurnId,
          interruption: { reason: "host-daemon-restarted" },
        });
      }
    }
  }
}
