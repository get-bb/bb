import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  gitFilesTag,
  gitRefsTag,
  gitStatusTag,
  gitViewedTag,
} from "../contract.js";

type SubscribeArgs = Parameters<BbPluginApi["sdk"]["subscribe"]>[0];
type EnvironmentChangedEvent = Parameters<
  Extract<SubscribeArgs, { event: "environment:changed" }>["callback"]
>[0];
export type EnvironmentChangeKind = EnvironmentChangedEvent["changes"][number];

const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 500;
const MIN_FLUSH_INTERVAL_MS = 1_000;

const CACHE_KEEPING_CHANGES: ReadonlySet<EnvironmentChangeKind> = new Set([
  "metadata-changed",
  "git-branches-changed",
]);

export function tagsForEnvironmentChanges(
  environmentId: string,
  changes: readonly EnvironmentChangeKind[],
): { tags: string[]; clearCaches: boolean; refsChanged: boolean } {
  const tags = new Set<string>();
  let refsChanged = false;
  for (const change of changes) {
    switch (change) {
      case "work-status-changed":
      case "metadata-changed":
        tags.add(gitStatusTag(environmentId));
        tags.add(gitFilesTag(environmentId));
        break;
      case "git-refs-changed":
        tags.add(gitStatusTag(environmentId));
        tags.add(gitFilesTag(environmentId));
        tags.add(gitRefsTag(environmentId));
        refsChanged = true;
        break;
      case "git-branches-changed":
        tags.add(gitRefsTag(environmentId));
        break;
      case "status-changed":
      case "environment-created":
      case "environment-deleted":
        tags.add(gitStatusTag(environmentId));
        tags.add(gitFilesTag(environmentId));
        tags.add(gitRefsTag(environmentId));
        tags.add(gitViewedTag(environmentId));
        refsChanged = true;
        break;
    }
  }
  return {
    tags: [...tags],
    clearCaches: changes.some((change) => !CACHE_KEEPING_CHANGES.has(change)),
    refsChanged,
  };
}

interface PendingFlush {
  tags: Set<string>;
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export function createCoalescedInvalidator(
  publish: (tags: string[]) => void,
  now: () => number = Date.now,
) {
  const pending = new Map<string, PendingFlush>();
  const lastFlushAt = new Map<string, number>();

  function flush(environmentId: string): void {
    const entry = pending.get(environmentId);
    if (entry === undefined) return;
    pending.delete(environmentId);
    lastFlushAt.set(environmentId, now());
    publish([...entry.tags]);
  }

  function schedule(environmentId: string, entry: PendingFlush): void {
    clearTimeout(entry.timer);
    const at = Math.max(
      Math.min(now() + DEBOUNCE_MS, entry.firstAt + MAX_WAIT_MS),
      (lastFlushAt.get(environmentId) ?? Number.NEGATIVE_INFINITY) +
        MIN_FLUSH_INTERVAL_MS,
    );
    entry.timer = setTimeout(
      () => flush(environmentId),
      Math.max(0, at - now()),
    );
  }

  return {
    invalidate(environmentId: string, tags: readonly string[]): void {
      if (tags.length === 0) return;
      const existing = pending.get(environmentId);
      if (existing !== undefined) {
        for (const tag of tags) existing.tags.add(tag);
        schedule(environmentId, existing);
        return;
      }
      const entry: PendingFlush = {
        tags: new Set(tags),
        firstAt: now(),
        timer: setTimeout(() => undefined, 0),
      };
      pending.set(environmentId, entry);
      schedule(environmentId, entry);
    },
    forget(environmentId: string): void {
      const entry = pending.get(environmentId);
      if (entry !== undefined) clearTimeout(entry.timer);
      pending.delete(environmentId);
      lastFlushAt.delete(environmentId);
    },
    dispose(): void {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      lastFlushAt.clear();
    },
  };
}
