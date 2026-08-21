import type { FixedPanelTabsState } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { threadTabsSchema, type ThreadTabsResponse } from "@bb/server-contract";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import type { ProfileClient } from "@/lib/sdk";
import { threadTabsQueryKey } from "@/lib/query/query-keys";
import { getFixedPanelTabsStore } from "./fixed-panel-tabs-storage";
import type {
  FixedPanelTabsStateUpdater,
  FixedPanelTabsStore,
} from "./fixed-panel-tabs-store";
import { useThreadTabs } from "./thread-tabs-queries";
import {
  areThreadTabListsEquivalent,
  createThreadTabsSyncer,
  reconcileTabsStateWithServerTabs,
  toSyncedThreadTabs,
  type ThreadTabsSyncer,
} from "./thread-tabs-sync";

/**
 * One write queue per profile client: every panel of that server shares it,
 * so two panels of the same thread never race their PUTs, and a write
 * outlives the panel that scheduled it.
 */
const syncers = new WeakMap<ProfileClient, ThreadTabsSyncer>();
const pendingListeners = new WeakMap<ProfileClient, Set<() => void>>();

function notifyPending(client: ProfileClient): void {
  const listeners = pendingListeners.get(client);
  if (!listeners) return;
  for (const listener of Array.from(listeners)) listener();
}

function subscribePending(
  client: ProfileClient,
  listener: () => void,
): () => void {
  let listeners = pendingListeners.get(client);
  if (!listeners) {
    listeners = new Set();
    pendingListeners.set(client, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isThreadTabsConflict(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 409 &&
    error.code === "thread_tabs_conflict"
  );
}

function getThreadTabsSyncer(client: ProfileClient): ThreadTabsSyncer {
  const existing = syncers.get(client);
  if (existing) return existing;
  const { sdk, queryClient } = client;
  const setCached = (threadId: string, response: ThreadTabsResponse) => {
    queryClient.setQueryData<ThreadTabsResponse>(
      threadTabsQueryKey(threadId),
      response,
    );
  };
  const syncer = createThreadTabsSyncer({
    transport: {
      getCached: (threadId) =>
        queryClient.getQueryData<ThreadTabsResponse>(
          threadTabsQueryKey(threadId),
        ),
      async fetch(threadId) {
        const response = await sdk.threads.tabs.get({ threadId });
        setCached(threadId, response);
        return response;
      },
      async write({ expectedRevision, tabs, threadId }) {
        const response = await sdk.threads.tabs.update({
          expectedRevision,
          // The panel model is a subset of the wire contract; validate at the
          // boundary rather than trusting the structural overlap.
          tabs: threadTabsSchema.parse(tabs),
          threadId,
        });
        setCached(threadId, response);
        return response;
      },
      isConflict: isThreadTabsConflict,
    },
    onOutcome(threadId, outcome) {
      if (outcome.kind === "conflict") {
        // The server strip stands; publishing it re-runs the reconcile below.
        setCached(threadId, outcome.server);
      }
    },
  });
  // Wrap to notify pending-state subscribers around every queued write.
  const wrapped: ThreadTabsSyncer = {
    persist(threadId, tabs) {
      const run = syncer.persist(threadId, tabs);
      notifyPending(client);
      void run.catch(() => undefined).finally(() => notifyPending(client));
      return run;
    },
    migrate(threadId, tabs) {
      const run = syncer.migrate(threadId, tabs);
      notifyPending(client);
      void run.catch(() => undefined).finally(() => notifyPending(client));
      return run;
    },
    hasPendingWrite: (threadId) => syncer.hasPendingWrite(threadId),
  };
  syncers.set(client, wrapped);
  return wrapped;
}

export interface UseSyncedPanelTabsArgs {
  /** Key of the device-local state: the thread id, or the root-compose panel id. */
  panelStateId: string;
  /** The thread whose server strip mirrors this panel; null = local only. */
  syncThreadId: string | null;
  /** Test seam; defaults to the app's MMKV store. */
  store?: FixedPanelTabsStore;
}

export interface SyncedPanelTabs {
  state: FixedPanelTabsState;
  /**
   * Apply an update to the local state; when the tab list changed and the
   * panel syncs, the new strip is persisted through the per-profile queue.
   */
  update: (updater: FixedPanelTabsStateUpdater) => void;
  /** The server strip has been read at least once (always true when local only). */
  serverTabsLoaded: boolean;
}

/**
 * The workspace panel's tab state for one panel: device-local (MMKV, the
 * web's storage key and blob) and, for a thread, mirrored against
 * `GET/PUT /threads/:id/tabs` — the mobile counterpart of the web's
 * `useFixedPanelTabsState` + `useUpdateFixedPanelTabsState` pair.
 *
 * Server tabs win on read (`reconcileTabsStateWithServerTabs`) except while
 * this client has a write in flight, so a just-opened tab is not reverted by
 * the stale strip its own PUT is about to replace. A thread whose server
 * strip is still empty (revision 0) is seeded from the local tabs once.
 */
export function useSyncedPanelTabs({
  panelStateId,
  syncThreadId,
  store: storeOverride,
}: UseSyncedPanelTabsArgs): SyncedPanelTabs {
  const client = useProfileClient();
  const store = storeOverride ?? getFixedPanelTabsStore();
  const syncer = getThreadTabsSyncer(client);

  const state = useSyncExternalStore(
    useCallback(
      (listener: () => void) => store.subscribe(panelStateId, listener),
      [panelStateId, store],
    ),
    () => store.get(panelStateId),
    () => store.get(panelStateId),
  );
  const hasPendingWrite = useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribePending(client, listener),
      [client],
    ),
    () => (syncThreadId ? syncer.hasPendingWrite(syncThreadId) : false),
    () => false,
  );

  const tabsQuery = useThreadTabs(syncThreadId, {
    enabled: syncThreadId !== null,
  });
  const serverTabs = tabsQuery.data;

  const persist = useMutation<unknown, Error, { threadId: string }>({
    mutationFn: ({ threadId }) =>
      syncer.persist(threadId, store.get(panelStateId).secondary.tabs),
    meta: { errorMessage: "Couldn't sync tabs" },
  });
  const { mutate: persistTabs } = persist;

  // Server → local.
  useEffect(() => {
    if (syncThreadId === null || serverTabs === undefined) return;
    if (hasPendingWrite) return;
    const local = store.get(panelStateId);
    if (
      serverTabs.revision === 0 &&
      toSyncedThreadTabs(local.secondary.tabs).length > 0
    ) {
      // First sight of an unsynced thread this device already has tabs for.
      // `migrate` is a once-per-thread no-op afterwards, in which case the
      // empty server strip is the truth and we fall through to adopt it.
      void syncer.migrate(syncThreadId, local.secondary.tabs).then((did) => {
        if (did) return;
        store.update(panelStateId, (current) =>
          reconcileTabsStateWithServerTabs(current, serverTabs.tabs),
        );
      });
      return;
    }
    store.update(panelStateId, (current) =>
      reconcileTabsStateWithServerTabs(current, serverTabs.tabs),
    );
  }, [hasPendingWrite, panelStateId, serverTabs, store, syncThreadId, syncer]);

  // Local → server.
  const update = useCallback(
    (updater: FixedPanelTabsStateUpdater) => {
      const current = store.get(panelStateId);
      const next = store.update(panelStateId, updater);
      if (next === current || syncThreadId === null) return;
      if (
        areThreadTabListsEquivalent(current.secondary.tabs, next.secondary.tabs)
      ) {
        return;
      }
      persistTabs({ threadId: syncThreadId });
    },
    [panelStateId, persistTabs, store, syncThreadId],
  );

  return {
    state,
    update,
    serverTabsLoaded: syncThreadId === null || serverTabs !== undefined,
  };
}
