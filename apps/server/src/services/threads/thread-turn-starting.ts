import { createQueuedThreadMessageInTransaction, getThread } from "@bb/db";
import type {
  PromptInput,
  QueuedMessagePayload,
  QueuedMessageSystemNotice,
  ResolvedThreadExecutionOptions,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { emitPluginMessageQueued } from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

interface TurnStartingQueuedInput {
  content: PromptInput[];
  execution: ResolvedThreadExecutionOptions;
  payload: QueuedMessagePayload;
  senderThreadId: string | null;
  systemNotice: QueuedMessageSystemNotice | null;
}

type TurnStartingDeps = Pick<AppDeps, "db" | "hub" | "logger">;

export function queueInputForStartingTurn(
  deps: TurnStartingDeps,
  args: { input: TurnStartingQueuedInput; threadId: string },
): void {
  if (args.input.content.length === 0) return;
  const queued = deps.db.transaction(
    (tx) => {
      const thread = getThread(tx, args.threadId);
      if (!thread || thread.deletedAt !== null) return null;
      return createQueuedThreadMessageInTransaction(tx, {
        threadId: args.threadId,
        content: args.input.content,
        senderThreadId: args.input.senderThreadId,
        model: args.input.execution.model,
        reasoningLevel: args.input.execution.reasoningLevel,
        permissionMode: args.input.execution.permissionMode,
        serviceTier: args.input.execution.serviceTier,
        waitingOn: { kind: "turn-starting" },
        sendAt: null,
        payload: args.input.payload,
        systemNotice: args.input.systemNotice,
      });
    },
    { behavior: "immediate" },
  );
  if (queued === null) return;
  emitPluginMessageQueued(toThreadQueuedMessage(queued));
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
  deps.logger.info(
    { queuedMessageId: queued.id, threadId: args.threadId },
    "Queued input until the current turn starts",
  );
}
