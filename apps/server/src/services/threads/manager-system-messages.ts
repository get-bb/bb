import { getThread } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { hasLiveThreadStartInFlight } from "./thread-lifecycle.js";
import { queueParentSystemMessage } from "./parent-system-messages.js";

/**
 * Outcome of a manager system message queue attempt.
 * "skipped-pending-command" is the one TRANSIENT skip: the manager thread has
 * a live `thread.start` RPC in flight, so dispatching another turn now would
 * race the start — a caller holding durable notification intent
 * (workflow-run-pending-notifications.ts) keeps the intent and retries on its
 * next sweep instead of dropping the message. Every other skip —
 * missing/archived/deleted thread, pending interaction, a mid-flight
 * thread-state change — stays best-effort: callers treat "skipped" as
 * consumed.
 */
export type QueueManagerSystemMessageOutcome =
  | "queued"
  | "skipped-pending-command"
  | "skipped";

interface QueueManagerSystemMessageArgs {
  managerThreadId: string;
  messageText: string;
}

function buildSystemInput(messageText: string): PromptInput[] {
  return [{ type: "text", text: messageText, mentions: [] }];
}

/**
 * Queues a `[bb system]` text turn on a workflow run's anchor (manager)
 * thread — a thin guard over the shared parent-system-message dispatch, with
 * the transient in-flight-start skip surfaced separately so durable-intent
 * callers can retry. Host connectivity failures (`host_unavailable`,
 * `command_timeout`) propagate as ApiErrors — the durable-notification sweep
 * treats those as transient too.
 */
export async function queueManagerSystemMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueManagerSystemMessageArgs,
): Promise<QueueManagerSystemMessageOutcome> {
  const managerThread = getThread(deps.db, args.managerThreadId);
  if (!managerThread) {
    return "skipped";
  }
  if (hasLiveThreadStartInFlight(managerThread.id)) {
    return "skipped-pending-command";
  }
  const queued = await queueParentSystemMessage(deps, {
    parentThreadId: args.managerThreadId,
    input: buildSystemInput(args.messageText),
  });
  return queued ? "queued" : "skipped";
}
