import { useCallback, useSyncExternalStore } from "react";
import type { PromptTextMention } from "@bb/domain";
import { createKeyedListeners } from "./keyed-listeners";

export interface ComposerEditorState {
  layout: "expanded" | "compact";
  isRunning: boolean;
  isSubmitting: boolean;
  isSubmittingBlocked: boolean;
  submittingBlockedReason: string | null;
  isAttaching: boolean;
  attachmentError: string | null;
}

export interface ComposerEditorInsertValue {
  text: string;
  mentions: PromptTextMention[];
}

export interface ComposerEditorBridge {
  state: ComposerEditorState;
  insertAtCursor(value: ComposerEditorInsertValue, block: boolean): void;
}

const bridgesByKey = new Map<string, ComposerEditorBridge>();
const bridgeListeners = createKeyedListeners<string>();

export function publishComposerEditorBridge(
  key: string,
  bridge: ComposerEditorBridge,
): void {
  if (bridgesByKey.get(key) === bridge) return;
  bridgesByKey.set(key, bridge);
  bridgeListeners.notify(key);
}

export function clearComposerEditorBridge(
  key: string,
  bridge: ComposerEditorBridge,
): void {
  if (bridgesByKey.get(key) !== bridge) return;
  bridgesByKey.delete(key);
  bridgeListeners.notify(key);
}

export function getComposerEditorBridge(
  key: string,
): ComposerEditorBridge | null {
  return bridgesByKey.get(key) ?? null;
}

export function subscribeComposerEditorBridge(
  key: string,
  listener: () => void,
): () => void {
  return bridgeListeners.subscribe(key, listener);
}

export function useComposerEditorBridge(
  key: string,
): ComposerEditorBridge | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeComposerEditorBridge(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => getComposerEditorBridge(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function areComposerEditorStatesEqual(
  left: ComposerEditorState,
  right: ComposerEditorState,
): boolean {
  return (
    left.layout === right.layout &&
    left.isRunning === right.isRunning &&
    left.isSubmitting === right.isSubmitting &&
    left.isSubmittingBlocked === right.isSubmittingBlocked &&
    left.submittingBlockedReason === right.submittingBlockedReason &&
    left.isAttaching === right.isAttaching &&
    left.attachmentError === right.attachmentError
  );
}
