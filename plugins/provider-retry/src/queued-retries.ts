import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface QueuedRetry {
  id: string;
  threadId: string;
  sendAt: number | null;
}

export async function listQueuedRetries(
  bb: BbPluginApi,
  threadId?: string,
): Promise<QueuedRetry[]> {
  const rows = await bb.sdk.threads.queue.list(
    threadId === undefined ? {} : { threadId },
  );
  return rows
    .filter((row) => row.payload.kind === "retry")
    .map((row) => ({
      id: row.id,
      threadId: row.threadId,
      sendAt: row.sendAt,
    }));
}

export async function findQueuedRetry(
  bb: BbPluginApi,
  threadId: string,
): Promise<QueuedRetry | null> {
  const rows = await listQueuedRetries(bb, threadId);
  return rows[0] ?? null;
}
