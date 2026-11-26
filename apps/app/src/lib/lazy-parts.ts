import { useEffect, useState, useSyncExternalStore } from "react";
import {
  registeredComponents,
  type CollectedPluginAppRegistrations,
} from "@get-bb/plugin-sdk/internal/plugin-app-collector";

export interface LazyPart {
  load(): Promise<void>;
  isLoaded(): boolean;
}

const parts = new WeakMap<object, LazyPart>();
const settled = new WeakSet<LazyPart>();
const inFlight = new WeakMap<LazyPart, Promise<void>>();

export const ORDERED_REVEAL_BOUND_MS = 3_000;

export function registerLazyPart(component: object, part: LazyPart): void {
  parts.set(component, part);
}

export function lazyPartOf(component: unknown): LazyPart | undefined {
  return typeof component === "function" ? parts.get(component) : undefined;
}

function isPartReady(part: LazyPart): boolean {
  return part.isLoaded() || settled.has(part);
}

export function loadLazyPart(part: LazyPart): Promise<void> {
  let pending = inFlight.get(part);
  if (pending === undefined) {
    pending = part
      .load()
      .catch(() => {})
      .finally(() => {
        settled.add(part);
        inFlight.delete(part);
        announceSettled();
      });
    inFlight.set(part, pending);
  }
  return pending;
}

export function loadLazyPartsIn(
  registrations: CollectedPluginAppRegistrations,
): Promise<void> | null {
  return loadLazyComponents(registeredComponents(registrations));
}

export function loadLazyComponents(
  components: Iterable<unknown>,
): Promise<void> | null {
  const pending: Promise<void>[] = [];
  for (const component of components) {
    const part = lazyPartOf(component);
    if (part !== undefined && !isPartReady(part)) {
      pending.push(loadLazyPart(part));
    }
  }
  return pending.length === 0 ? null : Promise.all(pending).then(() => {});
}

export interface RevealEntry {
  key: string;
  ready: boolean;
}

export interface RevealMemory {
  shown: ReadonlySet<string>;
  expired: ReadonlySet<string>;
}

export function planReveal(
  entries: readonly RevealEntry[],
  memory: RevealMemory,
): boolean[] {
  let holding = false;
  return entries.map((entry) => {
    if (!entry.ready) {
      if (!memory.expired.has(entry.key)) holding = true;
      return false;
    }
    return memory.shown.has(entry.key) || !holding;
  });
}

const NO_KEYS: ReadonlySet<string> = new Set();

const settleListeners = new Set<() => void>();
let settleVersion = 0;

function subscribeSettled(listener: () => void): () => void {
  settleListeners.add(listener);
  return () => settleListeners.delete(listener);
}

function settledVersion(): number {
  return settleVersion;
}

function announceSettled(): void {
  settleVersion += 1;
  for (const listener of settleListeners) listener();
}

class RevealDeadlines {
  private readonly expiredKeys = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.version;

  expired(): ReadonlySet<string> {
    return this.expiredKeys;
  }

  watch(keys: readonly string[], boundMs: number): void {
    for (const key of keys) {
      if (this.timers.has(key) || this.expiredKeys.has(key)) continue;
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key);
          this.expiredKeys.add(key);
          this.version += 1;
          for (const listener of this.listeners) listener();
        }, boundMs),
      );
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

function sameKeys(left: ReadonlySet<string>, right: readonly string[]) {
  return left.size === right.length && right.every((key) => left.has(key));
}

interface OrderedRevealOptions<T> {
  key: (entry: T) => string;
  parts: (entry: T) => readonly unknown[];
  boundMs?: number;
}

function waitingParts(component: unknown): LazyPart[] {
  const part = lazyPartOf(component);
  return part === undefined || isPartReady(part) ? [] : [part];
}

export function useOrderedReveal<T>(
  entries: readonly T[],
  {
    key,
    parts: partsOf,
    boundMs = ORDERED_REVEAL_BOUND_MS,
  }: OrderedRevealOptions<T>,
): readonly T[] {
  const [deadlines] = useState(() => new RevealDeadlines());
  useSyncExternalStore(subscribeSettled, settledVersion, settledVersion);
  useSyncExternalStore(
    deadlines.subscribe,
    deadlines.snapshot,
    deadlines.snapshot,
  );
  const [shown, setShown] = useState<ReadonlySet<string>>(NO_KEYS);
  const described = entries.map((entry) => ({
    entry,
    key: key(entry),
    ready: partsOf(entry).every((part) => waitingParts(part).length === 0),
  }));
  const plan = planReveal(described, {
    shown,
    expired: deadlines.expired(),
  });
  const visible = described.filter((_, index) => plan[index]);
  const visibleKeys = visible.map((item) => item.key);
  if (!sameKeys(shown, visibleKeys)) setShown(new Set(visibleKeys));
  useEffect(() => {
    const waitingKeys: string[] = [];
    for (const entry of entries) {
      const pending = partsOf(entry).flatMap(waitingParts);
      if (pending.length === 0) continue;
      waitingKeys.push(key(entry));
      for (const part of pending) void loadLazyPart(part);
    }
    deadlines.watch(waitingKeys, boundMs);
  }, [boundMs, deadlines, entries, key, partsOf]);
  useEffect(() => () => deadlines.dispose(), [deadlines]);
  return visible.map((item) => item.entry);
}

export const PLUGIN_SLOT_REVEAL = {
  key: (slot: { pluginId: string; id: string; generation: number }) =>
    `${slot.pluginId}/${slot.id}/${slot.generation}`,
  parts: (slot: { component: unknown }) => [slot.component],
};
