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
  }),
]);
export type DeferredThreadMessagePayload = z.infer<
  typeof deferredThreadMessagePayloadSchema
>;

export function deferThreadMessage(
  deps: Pick<AppDeps, "db" | "logger">,
  args: { threadId: string; payload: DeferredThreadMessagePayload },
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
      threadId: args.threadId,
    },
    "Thread awaits user interaction; deferred message until it settles",
  );
}

export function parseDeferredThreadMessagePayload(
  row: DeferredThreadMessageRow,
): DeferredThreadMessagePayload {
  return deferredThreadMessagePayloadSchema.parse(JSON.parse(row.payload));
}
