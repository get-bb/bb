import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProviderRetryView } from "./contract.js";

/**
 * A parked retry as this plugin's surfaces need it. Structural rather than
 * imported from the server contract: a plugin reads what the SDK returns, and
 * only these three fields decide anything here.
 */
export interface ParkedRetry {
  id: string;
  threadId: string;
  /** When core's due sweep will re-attempt it; null if it waits on us alone. */
  sendAt: number | null;
}

/** The wait holder core stamps on every row this plugin parks. */
export function retryWaitHolder(bb: BbPluginApi): `plugin:${string}` {
  return `plugin:${bb.pluginId}`;
}

/**
 * Every retry this plugin currently has parked, newest state from the server.
 *
 * This is the whole of the plugin's "what am I waiting on" state. It used to be
 * a Map rebuilt by replaying each thread's event log; parked rows are the
 * durable record now, so the question is one indexed query and a restart cannot
 * lose the answer.
 */
export async function listParkedRetries(
  bb: BbPluginApi,
  threadId?: string,
): Promise<ParkedRetry[]> {
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

export async function findParkedRetry(
  bb: BbPluginApi,
  threadId: string,
): Promise<ParkedRetry | null> {
  const rows = await listParkedRetries(bb, threadId);
  return rows[0] ?? null;
}

/**
 * The banner's view of a parked retry.
 *
 * The provider id comes from the thread rather than the row because that is
 * where it lives — a parked row is about a dispatch, not about who will serve
 * it — and the banner only wants it to name the provider in its sentence.
 */
export async function retryViewForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<ProviderRetryView | null> {
  const parked = await findParkedRetry(bb, threadId);
  if (parked === null) return null;
  const thread = await bb.sdk.threads.get({ threadId });
  return {
    threadId,
    providerId: thread.providerId,
    retryAtMs: parked.sendAt,
  };
}
