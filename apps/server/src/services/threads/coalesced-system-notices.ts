import {
  createQueuedThreadMessageInTransaction,
  deleteCoalescedQueuedThreadMessageInTransaction,
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
import {
  emitPluginMessageCancelled,
  emitPluginMessageQueued,
} from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

export interface CoalescedNotice<State> {
  input: PromptInput[];
  notice: QueuedMessageSystemNotice;
  state: State;
}

export interface PostCoalescedSystemNoticeArgs<State> {
  coalesceKey: string;
  execution: ResolvedThreadExecutionOptions;
  merge: (previous: State | null) => CoalescedNotice<State> | null;
  parseState: (stored: string) => State;
  threadId: string;
  windowMs: number;
}

type CoalescedNoticeWrite =
  | { kind: "created"; row: QueuedThreadMessageRow }
  | { kind: "merged"; row: QueuedThreadMessageRow }
  | { kind: "withdrawn"; row: QueuedThreadMessageRow }
  | { kind: "none" };

export function postCoalescedSystemNotice<State>(
  deps: Pick<AppDeps, "db" | "hub">,
  args: PostCoalescedSystemNoticeArgs<State>,
): QueuedThreadMessageRow | null {
  const sendAt = Date.now() + args.windowMs;
  const write = deps.db.transaction(
    (tx): CoalescedNoticeWrite => {
      const pending = getPendingCoalescedQueuedThreadMessage(tx, {
        coalesceKey: args.coalesceKey,
        threadId: args.threadId,
      });
      const next = args.merge(
        pending?.coalesceState == null
          ? null
          : args.parseState(pending.coalesceState),
      );
      if (next === null) {
        const withdrawn =
          pending === null
            ? null
            : deleteCoalescedQueuedThreadMessageInTransaction(tx, pending);
        return withdrawn === null
          ? { kind: "none" }
          : { kind: "withdrawn", row: withdrawn };
      }
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
      if (merged !== null) return { kind: "merged", row: merged };
      return {
        kind: "created",
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
  switch (write.kind) {
    case "none":
      return null;
    case "withdrawn":
      emitPluginMessageCancelled(toThreadQueuedMessage(write.row));
      deps.hub.notifyThread(args.threadId, ["queue-changed"]);
      return null;
    case "created":
      emitPluginMessageQueued(toThreadQueuedMessage(write.row));
      deps.hub.notifyThread(args.threadId, ["queue-changed"]);
      return write.row;
    case "merged":
      deps.hub.notifyThread(args.threadId, ["queue-changed"]);
      return write.row;
  }
}
