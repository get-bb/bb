import { useCallback, useSyncExternalStore } from "react";
import { createKeyedListeners } from "./keyed-listeners";

type ComposerPlaceholderPreviewOwner = string | symbol;

interface ComposerPlaceholderPreviewEntry {
  text: string;
  sequence: number;
}

let previewSequence = 0;

const previewsByStorageKey = new Map<
  string,
  Map<ComposerPlaceholderPreviewOwner, ComposerPlaceholderPreviewEntry>
>();
const snapshotsByStorageKey = new Map<string, string>();
const previewListeners = createKeyedListeners<string>();

export function getComposerPlaceholderPreview(
  storageKey: string | null,
): string | null {
  if (storageKey === null) return null;
  return snapshotsByStorageKey.get(storageKey) ?? null;
}

function latestPreview(
  previews:
    | Map<ComposerPlaceholderPreviewOwner, ComposerPlaceholderPreviewEntry>
    | undefined,
): string | null {
  let latest: ComposerPlaceholderPreviewEntry | null = null;
  for (const entry of previews?.values() ?? []) {
    if (latest === null || entry.sequence > latest.sequence) latest = entry;
  }
  return latest?.text ?? null;
}

export function setComposerPlaceholderPreview(
  storageKey: string | null,
  owner: ComposerPlaceholderPreviewOwner,
  text: string | null,
): void {
  if (storageKey === null) return;
  let previews = previewsByStorageKey.get(storageKey);
  if (text === null) {
    if (previews?.delete(owner) !== true) return;
    if (previews.size === 0) previewsByStorageKey.delete(storageKey);
  } else {
    if (previews === undefined) {
      previews = new Map();
      previewsByStorageKey.set(storageKey, previews);
    }
    if (previews.get(owner)?.text === text) return;
    previews.set(owner, { text, sequence: previewSequence++ });
  }
  const previous = getComposerPlaceholderPreview(storageKey);
  const next = latestPreview(previewsByStorageKey.get(storageKey));
  if (next === null) snapshotsByStorageKey.delete(storageKey);
  else snapshotsByStorageKey.set(storageKey, next);
  if (next !== previous) previewListeners.notify(storageKey);
}

export function useComposerPlaceholderPreview(
  storageKey: string | null,
): string | null {
  const subscribe = useCallback(
    (listener: () => void) =>
      storageKey === null
        ? () => {}
        : previewListeners.subscribe(storageKey, listener),
    [storageKey],
  );
  const getSnapshot = useCallback(
    () => getComposerPlaceholderPreview(storageKey),
    [storageKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
