import type {
  Query,
  QueryCacheNotifyEvent,
  QueryClient,
} from "@tanstack/react-query";
import {
  queryDataHoldsThread,
  queryMayShowThread,
  writeThreadEntity,
  type ThreadEntity,
} from "./thread-entity-store";

export type ThreadReadStateIntent =
  | {
      kind: "read";
      lastReadAt: number | null;
      latestAttentionAt: number | null;
    }
  | { kind: "unread"; latestAttentionAt: number | null };

interface ThreadReadStateFence {
  threadId: string;
  settled: ThreadReadStateIntent;
  asOf: number | undefined;
  fetches: Map<Query, Promise<unknown> | undefined>;
  onDone: (() => void) | undefined;
}

interface ThreadReadStateFenceRegistry {
  fences: Set<ThreadReadStateFence>;
  unsubscribe: () => void;
}

const registries = new WeakMap<QueryClient, ThreadReadStateFenceRegistry>();

function laterOf(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  return current === null ? next : Math.max(current, next);
}

export function withThreadReadStateIntent(
  entity: ThreadEntity,
  intent: ThreadReadStateIntent,
): ThreadEntity {
  const currentReadAt = entity.thread.lastReadAt ?? null;
  const currentAttentionAt = entity.thread.latestAttentionAt ?? null;
  const lastReadAt =
    intent.kind === "unread" ? null : laterOf(currentReadAt, intent.lastReadAt);
  const latestAttentionAt = laterOf(
    currentAttentionAt,
    intent.latestAttentionAt,
  );
  if (lastReadAt === currentReadAt && latestAttentionAt === currentAttentionAt)
    return entity;
  return {
    ...entity,
    thread: {
      ...entity.thread,
      lastReadAt,
      ...(latestAttentionAt === null ? {} : { latestAttentionAt }),
    },
  };
}

function endsFetch(event: QueryCacheNotifyEvent): boolean {
  if (event.type === "removed") return true;
  if (event.type !== "updated") return false;
  const { action } = event;
  if (action.type === "success") return action.manual !== true;
  if (action.type === "error") return true;
  return action.type === "setState" && action.state.fetchStatus === "idle";
}

function removeFence(
  queryClient: QueryClient,
  registry: ThreadReadStateFenceRegistry,
  fence: ThreadReadStateFence,
): void {
  if (!registry.fences.delete(fence) || registry.fences.size > 0) return;
  registry.unsubscribe();
  registries.delete(queryClient);
}

function settleFences(
  queryClient: QueryClient,
  registry: ThreadReadStateFenceRegistry,
  event: QueryCacheNotifyEvent,
): void {
  if (!endsFetch(event)) return;
  const landed =
    event.type === "updated" && event.action.type === "success"
      ? event.action.data
      : undefined;
  for (const fence of [...registry.fences]) {
    if (!fence.fetches.has(event.query)) continue;
    if (
      fence.fetches.get(event.query) === event.query.promise &&
      queryDataHoldsThread(event.query.queryKey, landed, fence.threadId)
    )
      writeThreadEntity(queryClient, fence.threadId, (entity) =>
        fence.asOf !== undefined &&
        (entity.thread.updatedAt ?? Number.NEGATIVE_INFINITY) > fence.asOf
          ? entity
          : withThreadReadStateIntent(entity, fence.settled),
      );
    fence.fetches.delete(event.query);
    if (fence.fetches.size > 0) continue;
    removeFence(queryClient, registry, fence);
    fence.onDone?.();
  }
}

function fenceRegistry(queryClient: QueryClient): ThreadReadStateFenceRegistry {
  const existing = registries.get(queryClient);
  if (existing) return existing;
  const registry: ThreadReadStateFenceRegistry = {
    fences: new Set(),
    unsubscribe: () => {},
  };
  registry.unsubscribe = queryClient
    .getQueryCache()
    .subscribe((event) => settleFences(queryClient, registry, event));
  registries.set(queryClient, registry);
  return registry;
}

export function fenceThreadReadState(
  queryClient: QueryClient,
  {
    asOf,
    onDone,
    settled,
    threadId,
  }: {
    asOf?: number;
    onDone?: () => void;
    settled: ThreadReadStateIntent;
    threadId: string;
  },
): void {
  const fetching = queryClient
    .getQueryCache()
    .getAll()
    .filter(
      (query) =>
        query.state.fetchStatus !== "idle" &&
        queryMayShowThread(query.queryKey, threadId),
    );
  if (fetching.length === 0) {
    onDone?.();
    return;
  }
  fenceRegistry(queryClient).fences.add({
    threadId,
    settled,
    asOf,
    fetches: new Map(fetching.map((query) => [query, query.promise])),
    onDone,
  });
}

export function releaseThreadReadStateFences(
  queryClient: QueryClient,
  threadId: string,
): void {
  const registry = registries.get(queryClient);
  if (!registry) return;
  for (const fence of [...registry.fences])
    if (fence.threadId === threadId) removeFence(queryClient, registry, fence);
}

export function hasThreadReadStateFence(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  for (const fence of registries.get(queryClient)?.fences ?? [])
    if (fence.threadId === threadId) return true;
  return false;
}
