import {
  getLatestCompletedThreadContextClearSequence,
  listStoredEventRows,
  type DbConnection,
} from "@bb/db";
import { THREAD_CONTEXT_CLEAR_OPERATION } from "@bb/domain";
import { z } from "zod";
import { parseStoredEvent } from "./thread-data.js";

const providerSwitchHistorySchema = z.object({
  providerSwitch: z.object({ toProviderId: z.string() }),
  visibleHistoryStartSequence: z.number().int().nonnegative(),
});

export function resolveVisibleThreadHistoryStart(
  db: DbConnection,
  args: { threadId: string; atOrBeforeSequence?: number },
): number {
  const clearSequence = getLatestCompletedThreadContextClearSequence(db, args);
  if (clearSequence === null) return 0;
  const [row] = listStoredEventRows(db, {
    threadId: args.threadId,
    afterSequence: clearSequence - 1,
    types: ["system/operation"],
    limit: 1,
  });
  if (!row || row.sequence !== clearSequence) return clearSequence;
  const event = parseStoredEvent(row);
  if (
    event.type !== "system/operation" ||
    event.operation !== THREAD_CONTEXT_CLEAR_OPERATION
  ) {
    return clearSequence;
  }
  const metadata = providerSwitchHistorySchema.safeParse(event.metadata);
  return metadata.success
    ? metadata.data.visibleHistoryStartSequence
    : clearSequence;
}
