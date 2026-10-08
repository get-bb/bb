import { useSyncExternalStore } from "react";
import { rawStringLocalStorage } from "@/lib/browser-storage";

export const WHATS_NEW_SECTION_ID = "whats-new";

const SEEN_VERSION_STORAGE_KEY = "bb.settings.updates.whats-new-seen-version";
const PREVIOUS_VERSION_STORAGE_KEY =
  "bb.settings.updates.whats-new-previous-version";

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(version);
  return match?.[1] === undefined ? null : match[1].split(".").map(Number);
}

export function compareChangelogVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (leftParts === null || rightParts === null) {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export interface WhatsNewVersionStorage {
  getItem: (key: string, initialValue: string) => string;
  setItem: (key: string, value: string) => void;
}

export function recordWhatsNewVersion(
  storage: WhatsNewVersionStorage,
  version: string,
): string | null {
  const seen = storage.getItem(SEEN_VERSION_STORAGE_KEY, "");
  if (seen.length > 0 && compareChangelogVersions(seen, version) < 0) {
    storage.setItem(PREVIOUS_VERSION_STORAGE_KEY, seen);
    storage.setItem(SEEN_VERSION_STORAGE_KEY, version);
    return seen;
  }
  if (seen.length === 0) {
    storage.setItem(SEEN_VERSION_STORAGE_KEY, version);
    return null;
  }
  if (seen !== version) {
    return null;
  }
  const previous = storage.getItem(PREVIOUS_VERSION_STORAGE_KEY, "");
  return previous.length === 0 ? null : previous;
}

export function isWhatsNewVersionUnseen(
  seenVersion: string,
  version: string,
): boolean {
  return (
    seenVersion.length === 0 ||
    compareChangelogVersions(seenVersion, version) < 0
  );
}

const seenVersionListeners = new Set<() => void>();

function subscribeToSeenVersion(listener: () => void): () => void {
  seenVersionListeners.add(listener);
  const unsubscribeStorage = rawStringLocalStorage.subscribe?.(
    SEEN_VERSION_STORAGE_KEY,
    listener,
    "",
  );
  return () => {
    seenVersionListeners.delete(listener);
    unsubscribeStorage?.();
  };
}

function readSeenVersion(): string {
  return rawStringLocalStorage.getItem(SEEN_VERSION_STORAGE_KEY, "");
}

export function useWhatsNewSeenVersion(): string {
  return useSyncExternalStore(
    subscribeToSeenVersion,
    readSeenVersion,
    () => "",
  );
}

export function notifyWhatsNewSeenVersionChanged(): void {
  for (const listener of seenVersionListeners) {
    listener();
  }
}

export function markWhatsNewVersionSeen(version: string): void {
  recordWhatsNewVersion(rawStringLocalStorage, version);
  notifyWhatsNewSeenVersionChanged();
}
