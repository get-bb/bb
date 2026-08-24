/**
 * Lets screens pushed above a thread (the full-screen file preview) reach the
 * thread's follow-up composer for "Add to chat". The thread detail screen
 * registers its composer while mounted; a preview opened from it quotes into
 * that composer, otherwise it falls back to copying. Module-level because the
 * two screens are stack siblings, not ancestors. Pure and vitest-tested.
 */

export interface ThreadComposerHost {
  /** Append a `> ` quote block to the thread's draft (web `addQuoteToComposer`). */
  quote: (text: string) => void;
}

const hosts = new Map<string, ThreadComposerHost>();

/** Register the composer for `threadId`; returns the unregister function. */
export function registerThreadComposerHost(
  threadId: string,
  host: ThreadComposerHost,
): () => void {
  hosts.set(threadId, host);
  return () => {
    if (hosts.get(threadId) === host) hosts.delete(threadId);
  };
}

export function resolveThreadComposerHost(
  threadId: string,
): ThreadComposerHost | null {
  return hosts.get(threadId) ?? null;
}
