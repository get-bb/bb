import { useMemo, useSyncExternalStore } from "react";
import {
  hashKey,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Environment, ThreadWithRuntime } from "@bb/domain";
import { isThreadRead } from "@bb/client-core";
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";
import { environmentQueryKey } from "@/hooks/queries/query-keys";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import {
  useSidebarThreadEntriesStore,
  type SidebarThreadEntriesStore,
} from "@/lib/sidebar-thread-entries";
import { threadReadSource, useThreadState } from "@/lib/thread-state";

interface SnapshotSource<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

function toThreadActionTarget(
  thread: ThreadWithRuntime,
  environmentPath: string | null,
): PluginThreadActionTarget {
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    parentNotifications: thread.parentNotifications,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: !isThreadRead(thread),
    isHidden: thread.visibility === "hidden",
    status: thread.status,
    environment:
      thread.environmentId === null
        ? null
        : { id: thread.environmentId, path: environmentPath },
  };
}

function sameTarget(
  left: PluginThreadActionTarget,
  right: PluginThreadActionTarget,
): boolean {
  return (
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.parentThreadId === right.parentThreadId &&
    left.parentNotifications === right.parentNotifications &&
    left.archivedAt === right.archivedAt &&
    left.pinnedAt === right.pinnedAt &&
    left.sectionId === right.sectionId &&
    left.isUnread === right.isUnread &&
    left.isHidden === right.isHidden &&
    left.status === right.status &&
    left.environment?.id === right.environment?.id &&
    left.environment?.path === right.environment?.path
  );
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

type EnvironmentPath =
  | { status: "ready"; path: string | null }
  | { status: "loading" };

function readEnvironmentPath(
  queryClient: QueryClient,
  environmentId: string,
): EnvironmentPath {
  const state = queryClient.getQueryState<Environment>(
    environmentQueryKey(environmentId),
  );
  if (state?.data !== undefined) {
    return { status: "ready", path: state.data.path };
  }
  return state?.status === "error"
    ? { status: "ready", path: null }
    : { status: "loading" };
}

function targetSource(
  store: SidebarThreadEntriesStore,
  queryClient: QueryClient,
  threadId: string,
): SnapshotSource<PluginThreadActionTarget | null> {
  const thread = threadReadSource(store, queryClient, threadId);
  let environmentHash: string | null = null;
  let last: PluginThreadActionTarget | null = null;
  const resolve = (): PluginThreadActionTarget | null => {
    const read = thread.getSnapshot();
    if (read.status !== "ready") return null;
    const environmentId = read.thread.environmentId;
    environmentHash =
      read.entry === null && environmentId !== null
        ? hashKey(environmentQueryKey(environmentId))
        : null;
    if (read.entry !== null || environmentId === null) {
      return toThreadActionTarget(
        read.thread,
        read.entry?.environmentPath ?? null,
      );
    }
    const environment = readEnvironmentPath(queryClient, environmentId);
    if (environment.status === "loading") return last;
    return toThreadActionTarget(read.thread, environment.path);
  };
  return {
    subscribe: (listener) => {
      const releaseThread = thread.subscribe(listener);
      const releaseEnvironment = queryClient
        .getQueryCache()
        .subscribe((event) => {
          if (event.query.queryHash === environmentHash) listener();
        });
      return () => {
        releaseThread();
        releaseEnvironment();
      };
    },
    getSnapshot: () => {
      const next = resolve();
      if (next === null || last === null || !sameTarget(next, last)) {
        last = next;
      }
      return last;
    },
  };
}

function targetsSource(
  store: SidebarThreadEntriesStore,
  queryClient: QueryClient,
  threadIds: readonly string[],
): SnapshotSource<readonly PluginThreadActionTarget[]> {
  const sources = threadIds.map((threadId) =>
    targetSource(store, queryClient, threadId),
  );
  let last: readonly PluginThreadActionTarget[] = [];
  return {
    subscribe: (listener) => {
      const releases = sources.map((source) => source.subscribe(listener));
      return () => {
        for (const release of releases) release();
      };
    },
    getSnapshot: () => {
      const next = sources.flatMap((source) => source.getSnapshot() ?? []);
      if (!sameItems(next, last)) last = next;
      return last;
    },
  };
}

function unheldSource(
  store: SidebarThreadEntriesStore,
  threadIds: readonly string[],
): SnapshotSource<readonly string[]> {
  let last: readonly string[] = [];
  return {
    subscribe: store.subscribeAll,
    getSnapshot: () => {
      const next = threadIds.filter((threadId) => store.get(threadId) === null);
      if (!sameItems(next, last)) last = next;
      return last;
    },
  };
}

function useSnapshotSource<T>(source: SnapshotSource<T>): T {
  return useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot,
  );
}

export function useThreadActionTarget(
  threadId: string,
): PluginThreadActionTarget | null {
  const store = useSidebarThreadEntriesStore();
  const queryClient = useQueryClient();
  const source = useMemo(
    () => targetSource(store, queryClient, threadId),
    [queryClient, store, threadId],
  );
  return useSnapshotSource(source);
}

export function useThreadActionTargets(
  threadIds: readonly string[],
): readonly PluginThreadActionTarget[] {
  const store = useSidebarThreadEntriesStore();
  const queryClient = useQueryClient();
  const source = useMemo(
    () => targetsSource(store, queryClient, threadIds),
    [queryClient, store, threadIds],
  );
  return useSnapshotSource(source);
}

function ThreadActionTargetLoader({ threadId }: { threadId: string }) {
  const state = useThreadState(threadId);
  useEnvironment(state.thread?.environmentId ?? null);
  return null;
}

export function ThreadActionTargetLoaders({
  threadIds,
}: {
  threadIds: readonly string[];
}) {
  const store = useSidebarThreadEntriesStore();
  const source = useMemo(
    () => unheldSource(store, threadIds),
    [store, threadIds],
  );
  return useSnapshotSource(source).map((threadId) => (
    <ThreadActionTargetLoader key={threadId} threadId={threadId} />
  ));
}

export function useStableThreadIds(
  threads: readonly { id: string }[],
): readonly string[] {
  const key = threads.map((thread) => thread.id).join("\n");
  return useMemo(() => (key === "" ? [] : key.split("\n")), [key]);
}
