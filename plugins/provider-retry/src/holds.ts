import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProviderRetryView } from "./contract.js";

/**
 * A dispatch hold as this plugin's surfaces need it. Structural rather than
 * imported from the server contract: a plugin reads what the SDK returns, and
 * only these four fields decide anything here.
 */
export interface RetryHold {
  id: string;
  threadId: string;
  resumeAt: number | null;
  releasedAt: number | null;
  payload: { kind: string };
}

/** The holder string core stamps on every hold this plugin creates. */
export function retryHoldHolder(bb: BbPluginApi): `plugin:${string}` {
  return `plugin:${bb.pluginId}`;
}

/**
 * Every retry this plugin currently has parked, newest state from the server.
 *
 * This is the whole of the plugin's "what am I waiting on" state. It used to be
 * a Map rebuilt by replaying each thread's event log; holds are the durable
 * record now, so the question is a query and a restart cannot lose the answer.
 */
export async function listRetryHolds(
  bb: BbPluginApi,
  threadId?: string,
): Promise<RetryHold[]> {
  const holds = await bb.sdk.threads.holds.list({
    holder: retryHoldHolder(bb),
    ...(threadId === undefined ? {} : { threadId }),
  });
  return holds
    .filter((hold) => hold.releasedAt === null && hold.payload.kind === "retry")
    .map((hold) => ({
      id: hold.id,
      threadId: hold.threadId,
      resumeAt: hold.resumeAt,
      releasedAt: hold.releasedAt,
      payload: { kind: hold.payload.kind },
    }));
}

export async function findRetryHold(
  bb: BbPluginApi,
  threadId: string,
): Promise<RetryHold | null> {
  const holds = await listRetryHolds(bb, threadId);
  return holds[0] ?? null;
}

/**
 * The banner's view of a parked retry.
 *
 * The provider id comes from the thread rather than the hold because that is
 * where it lives — a hold is about a dispatch, not about who will serve it —
 * and the banner only wants it to name the provider in its sentence.
 */
export async function retryViewForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<ProviderRetryView | null> {
  const hold = await findRetryHold(bb, threadId);
  if (hold === null) return null;
  const thread = await bb.sdk.threads.get({ threadId });
  return {
    threadId,
    providerId: thread.providerId,
    retryAtMs: hold.resumeAt,
  };
}
