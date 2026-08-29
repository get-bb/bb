import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * A queued retry as this plugin's surfaces need it. Structural rather than
 * imported from the server contract: a plugin reads what the SDK returns, and
 * only these three fields decide anything here.
 */
export interface QueuedRetry {
  id: string;
  threadId: string;
  /** When core's due sweep will re-attempt it; null if it waits on us alone. */
  sendAt: number | null;
}

/** The wait holder core stamps on every row this plugin queues. */
export function retryWaitHolder(bb: BbPluginApi): `plugin:${string}` {
  return `plugin:${bb.pluginId}`;
}

/**
 * Every retry this plugin currently has queued, newest state from the server.
 *
 * This is the whole of the plugin's "what am I waiting on" state. It used to be
 * a Map rebuilt by replaying each thread's event log; queued rows are the
 * durable record now, so the question is one indexed query and a restart cannot
 * lose the answer.
 */
export async function listQueuedRetries(
  bb: BbPluginApi,
  threadId?: string,
): Promise<QueuedRetry[]> {
  const rows = await bb.sdk.threads.queue.list({
    waitHolder: retryWaitHolder(bb),
    ...(threadId === undefined ? {} : { threadId }),
  });
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
