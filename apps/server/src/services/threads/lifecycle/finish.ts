import { getThread, hasThreadStartTurnRequest } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../../types.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../../system/event-pruning.js";
import { abortPluginToolCallsForThreads } from "../../plugins/plugin-tool-calls.js";
import {
  emitPluginThreadStatusEntered,
  emitPluginTurnFailed,
} from "../../plugins/plugin-thread-events.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../../hosts/live-command.js";
import { queueChildThreadTurnNotificationBestEffort } from "../child-thread-notifications.js";
import { isParentNotifiableChildThread } from "../thread-parent.js";
import { requestQueuedMessageDispatch } from "../queued-message-dispatch.js";
import { clearThreadProvisionSchedule } from "../thread-startup-store.js";
import {
  buildThreadStopCommand,
  dispatchArchivedThreadProviderArchiveCommand,
  dispatchThreadRenameCommand,
} from "../thread-commands.js";
import { buildThreadStatusChangeMetadata } from "../thread-runtime-display.js";
import { runReleasedTurnFollowUps } from "../turn-end-follow-ups.js";
import type { ThreadLifecycleEffect, ThreadLifecycleInput } from "./machine.js";
import {
  environmentForThread,
  pendingInteractionStopReason,
  runThreadLifecycleTransaction,
  type ThreadLifecycleOutcome,
} from "./run.js";

type FinishDeps = LoggedPendingInteractionWorkSessionDeps;

export interface FinishThreadLifecycleOptions {
  skip?: ReadonlySet<ThreadLifecycleEffect["kind"]>;
}

export function dispatchSettledArchivedThreadProviderArchiveCommand(
  deps: FinishDeps,
  args: { threadId: string },
): boolean {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.status === "active" || thread.status === "stopping") {
    return false;
  }
  if (hasThreadStartTurnRequest(deps.db, thread.id)) {
    return false;
  }
  return dispatchArchivedThreadProviderArchiveCommand(deps, {
    threadId: thread.id,
  });
}

export function sendThreadStopCommand(
  deps: FinishDeps,
  args: { environment: { hostId: string; id: string }; threadId: string },
): void {
  startLiveHostCommand(deps, {
    command: buildThreadStopCommand({
      environmentId: args.environment.id,
      hostId: args.environment.hostId,
      intent: "interrupt",
      threadId: args.threadId,
    }),
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: args.threadId },
        "Live thread stop command failed",
      );
    },
  });
}

async function runEffect(
  deps: FinishDeps,
  outcome: ThreadLifecycleOutcome,
  effect: ThreadLifecycleEffect,
): Promise<void> {
  const { threadId } = outcome;
  switch (effect.kind) {
    case "abort-plugin-tool-calls":
      abortPluginToolCallsForThreads([threadId], effect.reason);
      return;
    case "archive-provider-session":
      dispatchSettledArchivedThreadProviderArchiveCommand(deps, { threadId });
      return;
    case "clear-provision-schedule":
      clearThreadProvisionSchedule(threadId);
      return;
    case "drain-queue":
      requestQueuedMessageDispatch(deps, { kind: effect.wake, threadId });
      return;
    case "end-pending-interactions":
      deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
        threadIds: [threadId],
        reason: pendingInteractionStopReason(effect.reason),
      });
      return;
    case "notify-parent": {
      const thread = getThread(deps.db, threadId);
      if (
        thread === null ||
        !isParentNotifiableChildThread(thread, effect.notice.turnStatus)
      ) {
        return;
      }
      const { notice } = effect;
      await queueChildThreadTurnNotificationBestEffort(deps, {
        childThread: thread,
        parentThreadId: thread.parentThreadId,
        turnStatus: notice.turnStatus,
        turnId: notice.turnId,
        ...(notice.turnStatus === "failed" && notice.failureContext !== null
          ? { failureContext: notice.failureContext }
          : {}),
        ...(notice.turnStatus === "interrupted"
          ? {
              interruption: {
                reason: notice.interruption.reason,
                ...(notice.interruption.cause !== null
                  ? { cause: notice.interruption.cause }
                  : {}),
              },
            }
          : {}),
      });
      return;
    }
    case "prune-idle":
      pruneThreadEventHistoryBestEffort(deps, { mode: "idle", threadId });
      return;
    case "send-stop": {
      const thread = getThread(deps.db, threadId);
      const environment =
        thread === null ? null : environmentForThread(deps.db, thread);
      if (environment === null) {
        await runThreadLifecycle(deps, threadId, {
          type: "stop.answered",
          answer: { kind: "gone" },
          now: Date.now(),
        });
        return;
      }
      sendThreadStopCommand(deps, { environment, threadId });
      return;
    }
    case "sync-title": {
      const thread = getThread(deps.db, threadId);
      const environment =
        thread === null ? null : environmentForThread(deps.db, thread);
      if (thread?.title == null || environment === null) return;
      dispatchThreadRenameCommand(deps, {
        environment,
        providerId: thread.providerId,
        threadId,
        title: thread.title,
      });
      return;
    }
    case "turn-ended":
      if (effect.disposition === "released") {
        await runReleasedTurnFollowUps(deps, {
          status: effect.status,
          threadId,
          turnId: effect.turnId,
        });
      }
      return;
    case "redeliver-steer":
      return;
    default:
      return;
  }
}

export function announceThreadStatusChange(
  deps: Pick<FinishDeps, "db" | "hub" | "providerRegistry">,
  thread: Thread,
): void {
  resetActiveThreadEventPruningState(thread.id);
  deps.hub.notifyThread(
    thread.id,
    ["status-changed"],
    buildThreadStatusChangeMetadata(deps, thread),
  );
  emitPluginThreadStatusEntered(thread);
  if (thread.status === "error") {
    emitPluginTurnFailed(thread.id);
  }
}

export async function finishThreadLifecycle(
  deps: FinishDeps,
  outcome: ThreadLifecycleOutcome,
  options: FinishThreadLifecycleOptions = {},
): Promise<void> {
  const thread = outcome.thread;
  if (outcome.statusChanged && thread !== null) {
    announceThreadStatusChange(deps, thread);
  }
  for (const effect of outcome.effects) {
    if (options.skip?.has(effect.kind)) continue;
    try {
      await runEffect(deps, outcome, effect);
    } catch (error) {
      deps.logger.error(
        { err: error, effect: effect.kind, threadId: outcome.threadId },
        "Thread lifecycle effect failed",
      );
    }
  }
}

export function finishThreadLifecycleInBackground(
  deps: FinishDeps,
  outcome: ThreadLifecycleOutcome,
): void {
  void finishThreadLifecycle(deps, outcome).catch((error) => {
    deps.logger.error(
      { err: error, threadId: outcome.threadId },
      "Thread lifecycle follow-up failed",
    );
  });
}

export async function runThreadLifecycle(
  deps: FinishDeps,
  threadId: string,
  input: ThreadLifecycleInput,
  options: FinishThreadLifecycleOptions = {},
): Promise<ThreadLifecycleOutcome> {
  const outcome = runThreadLifecycleTransaction(deps, threadId, input);
  await finishThreadLifecycle(deps, outcome, options);
  return outcome;
}
