import {
  createQueuedThreadMessageInTransaction,
  getPendingCoalescedQueuedThreadMessage,
  updateCoalescedQueuedThreadMessageInTransaction,
  type QueuedThreadMessageRow,
} from "@bb/db";
import type {
  PromptInput,
  QueuedMessageSystemNotice,
  ResolvedThreadExecutionOptions,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { emitPluginMessageQueued } from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

export interface CoalescedNotice<State> {
  input: PromptInput[];
  notice: QueuedMessageSystemNotice;
  state: State;
}

export interface PostCoalescedSystemNoticeArgs<State> {
  coalesceKey: string;
  execution: ResolvedThreadExecutionOptions;
  merge: (previous: State | null) => CoalescedNotice<State>;
  parseState: (stored: string) => State;
  threadId: string;
  windowMs: number;
}

export function postCoalescedSystemNotice<State>(
  deps: Pick<AppDeps, "db" | "hub">,
  args: PostCoalescedSystemNoticeArgs<State>,
): QueuedThreadMessageRow {
  const sendAt = Date.now() + args.windowMs;
  const { created, row } = deps.db.transaction(
    (tx) => {
      const pending = getPendingCoalescedQueuedThreadMessage(tx, {
        coalesceKey: args.coalesceKey,
        threadId: args.threadId,
      });
      const next = args.merge(
        pending?.coalesceState == null
          ? null
          : args.parseState(pending.coalesceState),
      );
      const merged =
        pending === null
          ? null
          : updateCoalescedQueuedThreadMessageInTransaction(tx, {
              coalesceState: JSON.stringify(next.state),
              content: next.input,
              id: pending.id,
              systemNotice: next.notice,
              threadId: args.threadId,
              windowEndsAt: sendAt,
            });
      if (merged !== null) return { created: false, row: merged };
      return {
        created: true,
        row: createQueuedThreadMessageInTransaction(tx, {
          threadId: args.threadId,
          content: next.input,
          senderThreadId: null,
          model: args.execution.model,
          reasoningLevel: args.execution.reasoningLevel,
          permissionMode: args.execution.permissionMode,
          serviceTier: args.execution.serviceTier,
          waitingOn: { kind: "time" },
          sendAt,
          payload: { kind: "inline" },
          systemNotice: next.notice,
          deliveryMode: "steer",
          coalesce: {
            key: args.coalesceKey,
            state: JSON.stringify(next.state),
          },
        }),
      };
    },
    { behavior: "immediate" },
  );
  if (created) emitPluginMessageQueued(toThreadQueuedMessage(row));
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
  return row;
}
