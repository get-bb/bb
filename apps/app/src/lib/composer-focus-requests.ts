/**
 * Focus-request bus between plugin composer writes and the composer mounts.
 * The draft store (usePromptDraftStorage) is module-level and shared, but
 * "focus the caret" is per-view state (ThreadDetailView's focus nonce, the
 * root compose prompt box ref) — this bus carries the request across that
 * gap, keyed by the same draft storage key both sides already share.
 */
type ComposerFocusListener = () => void;

const listenersByStorageKey = new Map<string, Set<ComposerFocusListener>>();

export function subscribeComposerFocusRequests(
  storageKey: string | null,
  listener: ComposerFocusListener,
): () => void {
  // Null = the draft scope is incomplete (matching the draft store's own
  // null storage keys); there is nothing to focus.
  if (storageKey === null) return () => {};
  let listeners = listenersByStorageKey.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    listenersByStorageKey.set(storageKey, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByStorageKey.delete(storageKey);
    }
  };
}

export function requestComposerFocus(storageKey: string | null): void {
  if (storageKey === null) return;
  const listeners = listenersByStorageKey.get(storageKey);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener();
  }
}
