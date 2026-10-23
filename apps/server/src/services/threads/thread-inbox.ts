import {
  createQueuedThreadMessageInTransaction,
  deleteThreadInboxReceiptsCreatedBefore,
  getPendingCoalescedQueuedThreadMessage,
  getQueuedThreadMessage,
  getThreadInboxReceipt,
  insertThreadInboxReceiptInTransaction,
  updateCoalescedQueuedThreadMessageInTransaction,
  type DbConnection,
  type DbTransaction,
  type QueuedThreadMessageRow,
} from "@bb/db";
import type {
  PromptInput,
  QueuedMessageDeliveryMode,
  QueuedMessageSystemNotice,
  ResolvedThreadExecutionOptions,
  ThreadQueuedMessage,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { emitPluginMessageQueued } from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

const INBOX_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class InboxMessageAlreadyAcceptedError extends Error {
  constructor(readonly threadId: string) {
    super(`Thread ${threadId} already accepted a message with this key`);
    this.name = "InboxMessageAlreadyAcceptedError";
  }
}

export type AcceptedInboxOutcome =
  | { kind: "dispatched" }
  | { kind: "queued"; entry: ThreadQueuedMessage };

export function deliveryModeForSendMode(
  mode: SendMessageRequest["mode"],
): QueuedMessageDeliveryMode {
  return mode === "queue-if-active" || mode === "start" ? "queue" : "steer";
}

export function sendModeForDeliveryMode(
  mode: QueuedMessageDeliveryMode,
): SendMessageRequest["mode"] {
  return mode === "queue" ? "queue-if-active" : "auto";
}

export function recordInboxReceiptInTransaction(
  tx: DbTransaction,
  args: {
    idempotencyKey: string | null;
    queuedMessageId: string | null;
    threadId: string;
  },
): void {
  if (args.idempotencyKey === null) return;
  const inserted = insertThreadInboxReceiptInTransaction(tx, {
    idempotencyKey: args.idempotencyKey,
    now: Date.now(),
    queuedMessageId: args.queuedMessageId,
    threadId: args.threadId,
  });
  if (!inserted) throw new InboxMessageAlreadyAcceptedError(args.threadId);
}

export function findAcceptedInboxOutcome(
  deps: Pick<AppDeps, "db">,
  args: { idempotencyKey: string; threadId: string },
): AcceptedInboxOutcome | null {
  const receipt = getThreadInboxReceipt(deps.db, args);
  if (receipt === null) return null;
  if (receipt.queuedMessageId === null) return { kind: "dispatched" };
  const row = getQueuedThreadMessage(deps.db, receipt.queuedMessageId);
  return row === null
    ? { kind: "dispatched" }
    : { kind: "queued", entry: toThreadQueuedMessage(row) };
}

export function pruneInboxReceipts(
  deps: { db: DbConnection },
  now: number,
): number {
  return deleteThreadInboxReceiptsCreatedBefore(
    deps.db,
    now - INBOX_RECEIPT_RETENTION_MS,
  );
}

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
): QueuedThreadMessageRow & { sendAt: number } {
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
              sendAt,
              systemNotice: next.notice,
              threadId: args.threadId,
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
  return { ...row, sendAt };
}
