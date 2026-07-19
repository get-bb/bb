import { useCallback, useSyncExternalStore } from "react";
import type { PluginComposerTextEffect } from "@bb/plugin-sdk";

type ComposerTextEffectListener = () => void;
type ComposerTextEffectOwner = string | symbol;

const effectsByStorageKey = new Map<
  string,
  Map<
    ComposerTextEffectOwner,
    { pluginId: string; effect: PluginComposerTextEffect }
  >
>();
const listenersByStorageKey = new Map<
  string,
  Set<ComposerTextEffectListener>
>();

function notify(storageKey: string): void {
  const listeners = listenersByStorageKey.get(storageKey);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getComposerTextEffect(
  storageKey: string | null,
): PluginComposerTextEffect | null {
  if (storageKey === null) return null;
  const effects = effectsByStorageKey.get(storageKey);
  if (!effects || effects.size === 0) return null;
  return effects.values().next().value?.effect ?? null;
}

export function setComposerTextEffect(
  storageKey: string | null,
  pluginId: string,
  effect: PluginComposerTextEffect | null,
  owner: ComposerTextEffectOwner = pluginId,
): void {
  if (storageKey === null) return;
  const previous = getComposerTextEffect(storageKey);
  let effects = effectsByStorageKey.get(storageKey);

  if (effect === null) {
    effects?.delete(owner);
    if (effects?.size === 0) {
      effectsByStorageKey.delete(storageKey);
    }
  } else {
    if (!effects) {
      effects = new Map();
      effectsByStorageKey.set(storageKey, effects);
    }
    effects.set(owner, { pluginId, effect });
  }

  if (getComposerTextEffect(storageKey) !== previous) {
    notify(storageKey);
  }
}

export function subscribeComposerTextEffect(
  storageKey: string | null,
  listener: ComposerTextEffectListener,
): () => void {
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

export function useComposerTextEffect(
  storageKey: string | null,
): PluginComposerTextEffect | null {
  const subscribe = useCallback(
    (listener: ComposerTextEffectListener) =>
      subscribeComposerTextEffect(storageKey, listener),
    [storageKey],
  );
  const getSnapshot = useCallback(
    () => getComposerTextEffect(storageKey),
    [storageKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
