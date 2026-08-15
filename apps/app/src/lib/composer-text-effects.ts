import { useCallback, useSyncExternalStore } from "react";
import type { PluginComposerTextEffect } from "@get-bb/plugin-sdk";

type ComposerTextEffectListener = () => void;
type ComposerTextEffectOwner = string | symbol;

export interface ComposerTextEffectSource {
  pluginId: string;
  effect: PluginComposerTextEffect;
  order: number;
}

let fallbackOwnerOrder = 0;
const EMPTY_COMPOSER_TEXT_EFFECTS: readonly ComposerTextEffectSource[] = [];

const effectsByStorageKey = new Map<
  string,
  Map<ComposerTextEffectOwner, ComposerTextEffectSource>
>();
const snapshotsByStorageKey = new Map<
  string,
  readonly ComposerTextEffectSource[]
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

export function getComposerTextEffects(
  storageKey: string | null,
): readonly ComposerTextEffectSource[] {
  if (storageKey === null) return EMPTY_COMPOSER_TEXT_EFFECTS;
  return snapshotsByStorageKey.get(storageKey) ?? EMPTY_COMPOSER_TEXT_EFFECTS;
}

export function setComposerTextEffect(
  storageKey: string | null,
  pluginId: string,
  effect: PluginComposerTextEffect | null,
  owner: ComposerTextEffectOwner = pluginId,
  ownerOrder?: number,
): void {
  if (storageKey === null) return;
  let effects = effectsByStorageKey.get(storageKey);
  const previousEntry = effects?.get(owner);

  if (effect === null) {
    if (previousEntry === undefined) return;
    effects?.delete(owner);
    if (effects?.size === 0) {
      effectsByStorageKey.delete(storageKey);
    }
  } else {
    if (!effects) {
      effects = new Map();
      effectsByStorageKey.set(storageKey, effects);
    }
    if (
      previousEntry?.effect === effect &&
      previousEntry.pluginId === pluginId
    ) {
      return;
    }
    effects.set(owner, {
      pluginId,
      effect,
      order: previousEntry?.order ?? ownerOrder ?? fallbackOwnerOrder++,
    });
  }

  const next = [...(effectsByStorageKey.get(storageKey)?.values() ?? [])].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.order - b.order,
  );
  if (next.length === 0) snapshotsByStorageKey.delete(storageKey);
  else snapshotsByStorageKey.set(storageKey, next);
  notify(storageKey);
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

export function useComposerTextEffects(
  storageKey: string | null,
): readonly ComposerTextEffectSource[] {
  const subscribe = useCallback(
    (listener: ComposerTextEffectListener) =>
      subscribeComposerTextEffect(storageKey, listener),
    [storageKey],
  );
  const getSnapshot = useCallback(
    () => getComposerTextEffects(storageKey),
    [storageKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
