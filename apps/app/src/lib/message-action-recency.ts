import { useSyncExternalStore } from "react";
import { z } from "zod";

export const MESSAGE_ACTION_RECENCY_STORAGE_KEY = "bb.messageActionRecency.v1";

export type MessageActionRecencyScope = "user" | "assistant";

type MessageActionRecency = Readonly<
  Record<MessageActionRecencyScope, readonly string[]>
>;

const MAX_TRACKED_ACTIONS = 64;
const EMPTY_RECENCY: MessageActionRecency = Object.freeze({
  user: Object.freeze([]),
  assistant: Object.freeze([]),
});

const actionIdsSchema = z
  .array(z.string().min(1))
  .transform((ids) => ids.slice(0, MAX_TRACKED_ACTIONS))
  .catch([]);
const recencySchema = z.object({
  user: actionIdsSchema,
  assistant: actionIdsSchema,
});

let initialized = false;
let snapshot: MessageActionRecency = EMPTY_RECENCY;
const listeners = new Set<() => void>();

function readRecency(): MessageActionRecency {
  if (typeof window === "undefined") return EMPTY_RECENCY;
  const storedValue = window.localStorage.getItem(
    MESSAGE_ACTION_RECENCY_STORAGE_KEY,
  );
  if (storedValue === null) return EMPTY_RECENCY;

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return EMPTY_RECENCY;
  }
  const result = recencySchema.safeParse(parsedValue);
  return result.success ? result.data : EMPTY_RECENCY;
}

function getSnapshot(): MessageActionRecency {
  if (!initialized) {
    initialized = true;
    snapshot = readRecency();
  }
  return snapshot;
}

function replaceSnapshot(next: MessageActionRecency): void {
  initialized = true;
  snapshot = next;
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== MESSAGE_ACTION_RECENCY_STORAGE_KEY) return;
  replaceSnapshot(readRecency());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function recordMessageActionUse(
  scope: MessageActionRecencyScope,
  actionId: string,
): void {
  const current = getSnapshot();
  if (current[scope][0] === actionId) return;
  const next: MessageActionRecency = {
    ...current,
    [scope]: [
      actionId,
      ...current[scope].filter((id) => id !== actionId),
    ].slice(0, MAX_TRACKED_ACTIONS),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        MESSAGE_ACTION_RECENCY_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {}
  }
  replaceSnapshot(next);
}

export function useMessageActionRecency(
  scope: MessageActionRecencyScope,
): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot()[scope],
    () => EMPTY_RECENCY[scope],
  );
}

export function orderByRecency<T>(
  items: readonly T[],
  recency: readonly string[],
  idOf: (item: T) => string,
): T[] {
  const rankById = new Map(recency.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({
      item,
      rank: rankById.get(idOf(item)) ?? recency.length + index,
    }))
    .sort((left, right) => left.rank - right.rank)
    .map(({ item }) => item);
}

export function resetMessageActionRecencyForTest(): void {
  initialized = false;
  snapshot = EMPTY_RECENCY;
}
