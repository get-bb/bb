import { useCallback, useSyncExternalStore } from "react";
import type { PromptTextMention } from "@bb/domain";
import type { ComposerEditorState } from "@get-bb/plugin-sdk/internal/composer-handle";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { createKeyedListeners } from "./keyed-listeners";

export interface ComposerEditorInsertValue {
  text: string;
  mentions: PromptTextMention[];
}

export interface ComposerEditorBridge {
  host: PluginComposerHost;
  pluginCustomizable: boolean;
  state: ComposerEditorState;
  insertAtCursor(value: ComposerEditorInsertValue, block: boolean): boolean;
  openPopup(pluginId: string, popupId: string): boolean;
  closePopup(pluginId: string): boolean;
  isPopupOpen(): boolean;
}

const bridgesByKey = new Map<string, ComposerEditorBridge>();
const bridgeListeners = createKeyedListeners<string>();
const bridgeListListeners = new Set<() => void>();
let bridgeList: readonly ComposerEditorBridge[] = [];

function notifyBridge(key: string): void {
  bridgeList = [...bridgesByKey.values()];
  bridgeListeners.notify(key);
  for (const listener of [...bridgeListListeners]) listener();
}

export function publishComposerEditorBridge(
  key: string,
  bridge: ComposerEditorBridge,
): void {
  if (bridgesByKey.get(key) === bridge) return;
  bridgesByKey.set(key, bridge);
  notifyBridge(key);
}

export function clearComposerEditorBridge(
  key: string,
  bridge: ComposerEditorBridge,
): void {
  if (bridgesByKey.get(key) !== bridge) return;
  bridgesByKey.delete(key);
  notifyBridge(key);
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

export function getComposerEditorBridges(): readonly ComposerEditorBridge[] {
  return bridgeList;
}

export function subscribeComposerEditorBridges(
  listener: () => void,
): () => void {
  bridgeListListeners.add(listener);
  return () => {
    bridgeListListeners.delete(listener);
  };
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
