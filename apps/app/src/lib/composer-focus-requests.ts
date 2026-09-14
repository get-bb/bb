import { createKeyedListeners } from "./keyed-listeners";

type ComposerFocusListener = () => void;

const focusRequestListeners = createKeyedListeners<string>();

export function subscribeComposerFocusRequests(
  storageKey: string | null,
  listener: ComposerFocusListener,
): () => void {
  if (storageKey === null) return () => {};
  return focusRequestListeners.subscribe(storageKey, listener);
}

export function requestComposerFocus(storageKey: string | null): void {
  if (storageKey === null) return;
  focusRequestListeners.notify(storageKey);
}
