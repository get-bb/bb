import {
  createDeferredThreadMessage,
  type DeferredThreadMessageRow,
} from "@bb/db";
import {
  promptInputSchema,
  systemMessageKindSchema,
  systemMessageSubjectSchema,
} from "@bb/domain";
import { sendMessageRequestSchema } from "@bb/server-contract";
import { z } from "zod";
import type { AppDeps } from "../../types.js";

// A thread that awaits user interaction (an AskUserQuestion, a command
// approval, a plugin input request) cannot take a prompt. Messages addressed to
// it while blocked used to be refused with a 409 (sends) or silently dropped
// (parent system messages), so the recipient never learned they existed
// (#1650). They now wait in `deferred_thread_messages` and deliver, in arrival
// order and in the mode the sender asked for, once the interaction settles.
// `thread-send-request.ts` owns the delivery side.
export const deferredThreadMessagePayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("send"),
    /** The public `send` request exactly as the sender posted it. */
    request: sendMessageRequestSchema,
  }),
  z.object({
    kind: z.literal("parent-system"),
    input: z.array(promptInputSchema),
    systemMessageKind: systemMessageKindSchema,
    systemMessageSubject: systemMessageSubjectSchema.nullable(),
    /**
     * Set when the daemon refused the message as `thread_turn_busy`: the
     * thread's live turn at that moment (null while its start was still
     * pending). The flush skips the row while that is still the live turn,
     * so a busy thread sees one attempt per turn rather than one per sweep
     * (#2370). Null for a row held behind a pending interaction (#1650);
     * rows persisted before the field existed parse as null.
     */
    heldForTurn: z
      .object({ activeTurnId: z.string().nullable() })
      .nullable()
      .default(null),
  }),
]);
export type DeferredThreadMessagePayload = z.infer<
  typeof deferredThreadMessagePayloadSchema
>;

export type DeferThreadMessageReason = "pending-interaction" | "turn-busy";

const DEFER_LOG_MESSAGES: Record<DeferThreadMessageReason, string> = {
  "pending-interaction":
    "Thread awaits user interaction; deferred message until it settles",
  "turn-busy":
    "Thread's live turn refused the message; deferred until that turn is over",
};

export function deferThreadMessage(
  deps: Pick<AppDeps, "db" | "logger">,
  args: {
    payload: DeferredThreadMessagePayload;
    reason: DeferThreadMessageReason;
    threadId: string;
  },
): void {
  const row = createDeferredThreadMessage(deps.db, {
    threadId: args.threadId,
    kind: args.payload.kind,
    payload: JSON.stringify(args.payload),
  });
  deps.logger.info(
    {
      deferredMessageId: row.id,
      kind: args.payload.kind,
      reason: args.reason,
      threadId: args.threadId,
    },
    DEFER_LOG_MESSAGES[args.reason],
  );
}

export function parseDeferredThreadMessagePayload(
  row: DeferredThreadMessageRow,
): DeferredThreadMessagePayload {
  return deferredThreadMessagePayloadSchema.parse(JSON.parse(row.payload));
}
