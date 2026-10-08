import { useSyncExternalStore } from "react";

export const WHATS_NEW_SECTION_ID = "whats-new";

const SEEN_VERSION_STORAGE_KEY = "bb.whats-new.seen-version";
const PREVIOUS_VERSION_STORAGE_KEY = "bb.whats-new.previous-version";

export interface WhatsNewVersionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(version);
  return match?.[1] === undefined ? null : match[1].split(".").map(Number);
}

export function compareVersions(left: string, right: string): number {
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

export function recordWhatsNewVersion(
  storage: WhatsNewVersionStorage,
  version: string,
): string | null {
  const seen = storage.getItem(SEEN_VERSION_STORAGE_KEY) ?? "";
  if (seen.length > 0 && compareVersions(seen, version) < 0) {
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
  const previous = storage.getItem(PREVIOUS_VERSION_STORAGE_KEY) ?? "";
  return previous.length === 0 ? null : previous;
}

export function isWhatsNewVersionUnseen(
  seenVersion: string,
  version: string,
): boolean {
  return seenVersion.length > 0 && compareVersions(seenVersion, version) < 0;
}

function browserStorage(): WhatsNewVersionStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const memory = new Map<string, string>();
const memoryStorage: WhatsNewVersionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
};

function storage(): WhatsNewVersionStorage {
  return browserStorage() ?? memoryStorage;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SEEN_VERSION_STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readSeenVersion(): string {
  return storage().getItem(SEEN_VERSION_STORAGE_KEY) ?? "";
}

export function useWhatsNewSeenVersion(): string {
  return useSyncExternalStore(subscribe, readSeenVersion, () => "");
}

export function recordWhatsNewBaseline(version: string): void {
  if (readSeenVersion().length > 0) {
    return;
  }
  markWhatsNewVersionSeen(version);
}

export function markWhatsNewVersionSeen(version: string): void {
  recordWhatsNewVersion(storage(), version);
  notify();
}

export function visitWhatsNewVersion(version: string): string | null {
  const previous = recordWhatsNewVersion(storage(), version);
  notify();
  return previous;
}
